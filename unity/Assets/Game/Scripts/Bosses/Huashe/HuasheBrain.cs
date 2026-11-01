using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 化蛇的行为（<see cref="HuasheDef"/>；网页版 bosses.ts HuasheBoss）：
    ///   · 游：在湖里绕湖心岛游（<see cref="HuasheLake"/> 的游线，0.35 rad/s 往玩家那一侧的湖岸），浮在水面下 0.3 m；不走导航网格（NavMeshAgent 关掉）。
    ///   · 嘴：只在张嘴时（吐水、扑咬、吼叫、潜游扑出、噎住）露出弱点（嘴 ×3 的弱点球开关），破防条也只在张嘴时填。
    ///   · 湿身：身体在水里（中心低于水面 + 0.6 m）——雷殛伤害 × 1.5、灼烧只烧一半时长；玩家自己站在 6 m 内的水里打雷殛会电到自己。
    ///   · 涨水：二阶段湖水常驻 +1.2 m；吼叫再 +0.8 m（6 s 后退）；泡在涨水里每秒 2；三阶段湖心起漩涡、泡在水里的人往湖心拉。
    ///   · 死亡「水退」：翻肚子挣扎（choke）→ 慢慢沉下去 3 m → 湖水 4 s 内退回原位。
    /// </summary>
    public sealed class HuasheBrain : LordBrain
    {
        public HuasheDef HDef => Def as HuasheDef;
        public HuasheLake Lake { get; private set; }
        /// <summary>游线参数（弧度）</summary>
        public float SwimAngle { get; set; }
        /// <summary>招式接管位置（扑岸、潜游）：不按游线摆</summary>
        public bool Driven { get; set; }
        /// <summary>嘴张着（招式写；噎住时也算）</summary>
        public bool MouthForced { get; set; }
        public bool MouthOpen => MouthForced || (Break != null && Break.Broken);
        /// <summary>身体泡在水里（湿身）</summary>
        public bool Wet => Lake != null && BodyCenter.y < Lake.Level + 0.6f;
        /// <summary>吼叫涨水剩余的停留秒数</summary>
        public float SurgeHold { get; set; }
        /// <summary>湿身加成生效过几次、电到玩家自己几次、泡水掉过几次血（测试用）</summary>
        public int WetShocks { get; private set; }
        public int SelfShocks { get; private set; }
        public int Soaks { get; private set; }

        IDisposable wetMod;
        float soakT, burnSince = -1, phaseFlood0, deathFlood0, deathSurge0, deathY0;
        FxHandle whirl;
        float whirlT;
        bool breached;

        // ───────────── 生成 / 登场 ─────────────

        protected override void OnLordSpawn()
        {
            if (agent) agent.enabled = false;
            Lake = new HuasheLake(Arena, transform.position);
            Lake.Flood = Lake.Surge = 0;
            SurgeHold = 0;
            var feet = vitals ? vitals.transform.position : transform.position;
            SwimAngle = Lake.AngleOf(feet) - 0.5f;
            PlaceOnSwim(-3f);
            wetMod?.Dispose();
            wetMod = hp.Incoming.Add((in IncomingHit h) => WetMult(h));
            hp.Damaged += OnHurt;
            GameEvents.StatusApplied -= OnStatus;
            GameEvents.StatusApplied += OnStatus;
            breached = false;
            SetVisible(false);
        }

        float WetMult(in IncomingHit h)
        {
            if (h.element != Element.Shock || !Wet || HDef == null) return 1f;
            WetShocks++;
            return HDef.wetShock;
        }

        void OnHurt(DamageInfo info, DamageResult r)
        {
            // 玩家自己泡在 6 m 内的水里打雷殛：电到自己
            if (info.element != Element.Shock || !Wet || HDef == null || r.total <= 0) return;
            if (info.source is DamageSource.Status or DamageSource.Environment) return;
            if (!PlayerFeet(out var feet) || !Lake.PlayerInWater(feet)) return;
            var d = feet - transform.position;
            d.y = 0;
            if (d.magnitude > HDef.selfShockRange) return;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || pv.invulnerableUntil > Time.time) return;
            pv.TakeDamage(MoveDamage(HDef.selfShockDamage / Mathf.Max(1f, Def.damage)), transform.position, Element.Shock, this);
            SelfShocks++;
            Fx.Lightning(feet + Vector3.up * 0.2f, BodyCenter, HuashePalette.Mouth, 0.06f);
            Tell("huashe_selfshock", "水导电——你也泡在水里", HuashePalette.Mouth, 5f, 1.6f);
        }

        void OnStatus(Damageable d, StatusId id, int stacks)
        {
            if (!this || d != hp) return;
            if (id == StatusId.Burn) burnSince = Time.time;
        }

        void SetVisible(bool on)
        {
            if (Model?.root) Model.root.SetActive(on);
        }

        /// <summary>摆到游线上（depth = 水面下多深）</summary>
        public void PlaceOnSwim(float depth)
        {
            var p = Lake.SwimPoint(SwimAngle, depth, out float yaw);
            transform.SetPositionAndRotation(p, Quaternion.Euler(0, yaw, 0));
        }

        /// <summary>
        /// 登场（5.6 s）：0–2.2 s 水下一道长黑影 S 形游向冒头的地方（模型藏着，水面黑影 + 涟漪）→ 2.2 s 破水而出（水帘、张翼，rise 片段）→ 张嘴吼
        /// </summary>
        protected override void IntroTick(float t, float dt)
        {
            float sec = t * Mathf.Max(0.01f, Def.intro.seconds);
            var feet = vitals ? vitals.transform.position : transform.position;
            float target = Lake.AngleOf(feet);
            if (sec < 2.2f)
            {
                SwimAngle += Mathf.DeltaAngle(SwimAngle * Mathf.Rad2Deg, target * Mathf.Rad2Deg) * Mathf.Deg2Rad * Mathf.Min(1, dt * 1.2f);
                PlaceOnSwim(-3f + 1.2f * Mathf.Clamp01(sec / 2.2f));
                var surf = new Vector3(transform.position.x, Lake.Level, transform.position.z);
                Fx.HuasheShadow(surf, 7f, transform.eulerAngles.y);
                if (UnityEngine.Random.value < dt * 8f) Fx.HuasheRipple(surf + UnityEngine.Random.insideUnitSphere * 2f, 1.6f);
                return;
            }
            if (!breached)
            {
                breached = true;
                SetVisible(true);
                Fx.HuasheBreach(new Vector3(transform.position.x, Lake.Level, transform.position.z), 1.6f);
                Shake(0.4f, 0.4f);
                PlayAct("rise", 3.0f, 0.05f);
            }
            PlaceOnSwim(Mathf.Lerp(-1.5f, -0.3f, Mathf.Clamp01((sec - 2.2f) / 0.8f)));
            FacePlayer(115f, dt);
            if (sec > 3.4f) Fx.HuasheMouth(BonePos(HuasheDef.MouthBone), dt);
        }

        protected override void OnIntroEnd()
        {
            SetVisible(true);
            Tell("huashe_tip", "它张嘴的时候打嘴；引它扑上岸——搁浅时最好打", HuashePalette.Water, 60f, 4f);
        }

        // ───────────── 每帧 ─────────────

        /// <summary>间隙：往玩家那一侧的湖岸游</summary>
        protected override void Idle(float dt)
        {
            if (!PlayerFeet(out var feet)) feet = PlayerPosition;
            float target = Lake.AngleOf(feet);
            float d = Mathf.DeltaAngle(SwimAngle * Mathf.Rad2Deg, target * Mathf.Rad2Deg) * Mathf.Deg2Rad;
            float rate = (HDef != null ? HDef.swimRate : 0.35f) * (EnemyStatus.Of(hp) && EnemyStatus.Of(hp).SlowMult < 1 ? 0.6f : 1f);
            SwimAngle += Mathf.Clamp(d, -rate * dt, rate * dt);
            PlaceOnSwim(-0.3f);
        }

        protected override void Update()
        {
            base.Update();
            if (Dead || Lake == null) return;
            float dt = Time.deltaTime;
            // 吼叫涨水停留 → 退
            var h = HDef;
            if (SurgeHold > 0 && !(Current is HuasheRoar))
            {
                SurgeHold -= dt;
            }
            else if (SurgeHold <= 0 && !(Current is HuasheRoar)) Lake.Surge = Mathf.Max(0, Lake.Surge - dt * (h != null ? h.surgeFall : 0.3f));
            Lake.Tick(dt, transform.parent);
            // 弱点（嘴）只在张嘴时开
            Body.SetWeakPointActive(MouthOpen && IntroDone);
            if (MouthOpen && IntroDone) Fx.HuasheMouth(BonePos(HuasheDef.MouthBone), dt);
            // 不出招也不在转阶段时浮在水面附近
            if (IntroDone && Current == null && !Transitioning && !Staggered && !Driven)
            {
                var p = transform.position;
                p.y += (Lake.Level - 0.3f - p.y) * Mathf.Min(1, dt * 3f);
                transform.position = p;
            }
            if (Break != null && Break.Broken)
            {
                var p = transform.position;
                p.y += (Lake.Level - 0.2f - p.y) * Mathf.Min(1, dt * 3f);
                transform.position = p;
            }
            // 湿身：灼烧只烧一半时长
            if (Wet && burnSince > 0 && h != null && Time.time - burnSince > EnemyStatus.BurnDuration * h.wetBurn)
            {
                var st = EnemyStatus.Of(hp);
                var burn = st ? st.Instance<StatusInstance>(StatusId.Burn) : null;
                if (burn != null && burn.Active) burn.Clear();
                burnSince = -1;
            }
            Soak(dt);
            Whirl(dt);
        }

        void Soak(float dt)
        {
            var h = HDef;
            if (h == null || !IntroDone || Lake.Flood + Lake.Surge < 0.3f || !PlayerFeet(out var feet)) return;
            bool inWater = Lake.PlayerInWater(feet);
            soakT -= dt;
            if (inWater && soakT <= 0)
            {
                soakT = 0.5f;
                if (BossHazards.For(this).Hurt(MoveDamage(h.soakDamage * 0.5f / Mathf.Max(1f, Def.damage)), Element.None, feet + Vector3.down) > 0) Soaks++;
            }
            if (inWater && Phase >= 2)
            {
                var to = Lake.Center - feet;
                to.y = 0;
                if (to.sqrMagnitude > 1f) BlowPlayer(to.normalized * h.whirlPull, dt);
            }
        }

        void Whirl(float dt)
        {
            if (Phase < 2 || !IntroDone) return;
            whirlT -= dt;
            if (whirlT > 0) return;
            whirlT = 3.5f;
            var c = new Vector3(Lake.Center.x, Lake.Level, Lake.Center.z);
            whirl = Fx.HuasheWhirl(c, Mathf.Min(Lake.Rx, Lake.Rz) * 0.5f, 4f);
        }

        // ───────────── 阶段 ─────────────

        protected override void OnLordPhase(int phase)
        {
            phaseFlood0 = Lake.Flood;
            Driven = false;
            MouthForced = true;
        }

        protected override void TransitionTick(float t, float dt)
        {
            PlaceOnSwim(-0.2f);
            if (Phase == 1 && HDef != null) Lake.Flood = phaseFlood0 + (HDef.flood - phaseFlood0) * Smooth((t - 0.6f) / 2.4f);
            if (UnityEngine.Random.value < dt * 2.5f) Fx.HuasheRoarRing(BonePos(HuasheDef.MouthBone));
        }

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            MouthForced = false;
            if (Phase == 1 && HDef != null) Lake.Flood = HDef.flood;
            if (Phase == 1) Tell("huashe_flood", "湖水涨上来了——上塔林、巨石、玛尼堆，泡在水里会掉血", HuashePalette.Water, 60f, 4f);
            if (Phase == 2) Tell("huashe_deluge", "湖水打漩——泡在水里会被往湖心拉", HuashePalette.Water, 60f, 3f);
        }

        // ───────────── 破防 / 倒下 ─────────────

        protected override void OnLordBreak(int count)
        {
            Fx.HuasheChoke(BonePos(HuasheDef.MouthBone));
            Lake.Surge = Mathf.Min(Lake.Surge, 0.2f);
            SurgeHold = 0;
            Driven = false;
            Tell("huashe_break", "噎住了！化蛇翻着肚子浮在水面——打", HuashePalette.Water, 4f, 2.5f);
        }

        protected override void OnLordDefeated(DamageInfo info)
        {
            wetMod?.Dispose();
            wetMod = null;
            hp.Damaged -= OnHurt;
            GameEvents.StatusApplied -= OnStatus;
            deathFlood0 = Lake.Flood;
            deathSurge0 = Lake.Surge;
            deathY0 = transform.position.y;
            whirl.Cancel();
        }

        /// <summary>水退：翻肚子挣扎 → 1.6–4.6 s 沉下去 3 m → 1–5 s 湖水退回原位；4.6 s 后隐去</summary>
        public override void DeathTick(float t, float dt)
        {
            if (Lake == null) return;
            float sink = Smooth((t - 1.6f) / 3f);
            var p = transform.position;
            p.y = deathY0 - 3f * sink;
            transform.position = p;
            Lake.Flood = deathFlood0 * (1 - Smooth((t - 1f) / 4f));
            Lake.Surge = deathSurge0 * (1 - Smooth((t - 1f) / 2f));
            Lake.Tick(dt, transform.parent);
            if (sink > 0 && UnityEngine.Random.value < dt * 6f) Fx.HuasheRipple(new Vector3(p.x, Lake.Level, p.z) + UnityEngine.Random.insideUnitSphere * 2f, 2f);
            if (t > 4.6f && Model?.root && Model.root.activeSelf) SetVisible(false);
            if (t > 5.4f) Lake.Dispose();
        }

        static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }
}
