using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 夔的行为（<see cref="KuiDef"/>；网页版 bosses.ts KuiBoss）：
    ///   · 一足：招式间隙不走路——原地转身对着玩家；位移全在招式里（小跳 / 大跳 / 转身跳在空中位移，拄拳绕拉则挪位）。
    ///   · 选招（网页版 think）：二阶段起每隔几招捶一次胸；玩家绕到身后 &gt; 115° 且 12 m 内转身跳；8 m 内大概率雷掌；每四跳一次大跳（三阶段换连环大跳），
    ///     远于 16 m 直接大跳；远于 12 m 偶尔拄拳；其余小跳。权重写在各招式的 Weight 里，这里只记计数。
    ///   · 一直带电（雷兽，F 路 Charge.Hold）：火一碰就是焚雷。雷暴（高原雷暴，F 路 PlateauStorm）是出场条件：登场演出开头起、死亡 1.5 s 后退。
    ///   · 召鼓（二阶段）：跳上拉则旁、吼，两只连鼓灵（E 路）从擂台边飞来护驾，擂台内的经幡杆一齐通电 3 秒。
    ///   · 风雨（三阶段）：擂台外圈（20–32 m）每 1.2 s 一道落雷。
    ///   · 经幡杆回劈：大跳 / 连环大跳落在带电的杆 4.5 m 内 → 杆放电、三道粗雷劈回胸口：200（换算）+ 破防条 + 硬直 1.5 s。
    ///   · 捶胸：鼓心倍率 × 1.4（网页 2.5 → 3.5）；破鼓：鼓面竖裂光 + 单膝跪地（kneel）。
    ///   · 死亡「雷息」：鼓面炸开一道光 → 跪下往后倒进残鼓（sink 片段 + 体型缩到 25%）、身体化成雷云散开 → 雷暴 4 s 内退去。
    /// </summary>
    public sealed class KuiBrain : LordBrain
    {
        public KuiDef KDef => Def as KuiDef;
        public KuiDrum Drum { get; private set; }

        /// <summary>选招计数：小跳次数、距上次捶胸几招</summary>
        public int Hops { get; internal set; }
        public int SinceDrum { get; internal set; }
        /// <summary>被回劈过几次、三阶段外圈落过几道雷（测试用）</summary>
        public int Backlashes { get; private set; }
        public int RingStrikes { get; private set; }
        /// <summary>召鼓召出来的连鼓灵只数（没登记连鼓灵时为 0）</summary>
        public int DrumsSummoned { get; private set; }
        /// <summary>鼓心正张开（捶胸中 / 破鼓中）：弱点倍率 × drumOpenMult</summary>
        public bool DrumOpen => Current is KuiChestDrum || (Break != null && Break.Broken);

        IDisposable chargeHold, drumMod;
        PlateauStorm.Ticket storm;
        float ringT, deathScale0 = 1f;
        bool landedIntro, deathBurst;
        Vector3 perchFrom, perchTo;
        bool perchLanded;

        /// <summary>这一场的雷暴票（登场演出开头要，死亡后退）</summary>
        public static PlateauStorm.Ticket StormTicket { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => StormTicket = null;

        /// <summary>要一场高原雷暴（登场演出开头 / 没演出时生成那一刻）：已经有了就复用</summary>
        public static PlateauStorm.Ticket EnsureStorm(Vector3 center, UnityEngine.Object source = null)
        {
            if (StormTicket != null && !StormTicket.Done && StormTicket.Stage != PlateauStorm.Stage.FadingOut) return StormTicket;
            StormTicket = WeatherDirector.BeginPlateauStorm(new PlateauStormSpec
            {
                center = center, aroundPlayer = false, strikeMin = 36f, strikeMax = 90f, intervalMin = 2.5f, intervalMax = 6f, damage = 0f, chargeFoes = 8f,
                fadeIn = 3f, fadeOut = 4f, darken = 0.75f, rain = 1f, source = source,
            });
            return StormTicket;
        }

        // ───────────── 生成 / 登场 ─────────────

        protected override void OnLordSpawn()
        {
            var a = Arena;
            Drum = KuiDrum.Ensure(a, a ? a.BossSpawnPoint : transform.position, transform.rotation);
            chargeHold?.Dispose();
            chargeHold = null;
            storm = EnsureStorm(a ? a.Center : transform.position, this);
            drumMod?.Dispose();
            drumMod = hp.Incoming.Add((in IncomingHit h) => DrumOpen && h.info.weakpoint && KDef != null ? KDef.drumOpenMult : 1f);
            Hops = SinceDrum = 0;
            ringT = 0;
            landedIntro = false;
            SetModelScale(0.25f);
        }

        void SetModelScale(float s)
        {
            if (Model?.root) Model.root.transform.localScale = Vector3.one * s;
        }

        /// <summary>登场（4.3 s）：0–2.2 s 从残鼓里一节节长出来（25% → 100%，鼓长到 55% 时藏起）→ 2.2 s 一足落地、双拳砸地 → 仰头吼</summary>
        protected override void IntroTick(float t, float dt)
        {
            float sec = t * Mathf.Max(0.01f, Def.intro.seconds);
            float k = Smooth(sec / 2.2f);
            SetModelScale(Mathf.Lerp(0.25f, 1f, k));
            if (Drum) Drum.SetVisible(k < 0.55f);
            if (sec < 2.2f)
            {
                if (UnityEngine.Random.value < dt * 10f) Fx.KuiCloud(transform.position + Vector3.up * (1f + 4f * k), 1.4f, 1, true);
                return;
            }
            if (!landedIntro)
            {
                landedIntro = true;
                var feet = transform.position;
                Fx.KuiDrumRing(feet, 10f, 0.5f);
                Fx.KuiDust(feet, 2.2f, 8);
                Shake(0.5f, 0.5f);
                PlayAct("roar", 2.1f, 0.12f);
                Sfx("boss_slam", 0.9f, 0.7f);
            }
            if (sec > 2.7f && sec < 4.1f && UnityEngine.Random.value < dt * 6f)
            {
                var head = BonePos("head");
                Fx.Lightning(head, head + new Vector3(UnityEngine.Random.Range(-3f, 3f), 8f, UnityEngine.Random.Range(-3f, 3f)), KuiPalette.Thunder, 0.08f);
            }
        }

        protected override void OnIntroEnd()
        {
            SetModelScale(1f);
            if (Drum) Drum.SetVisible(false);
            Tell("kui_tip", "打它胸口的鼓心——大跳砸地、拄拳挪位的时候胸口最低", KuiDef.Thunder, 60f, 4f);
        }

        // ───────────── 招式间隙 ─────────────

        /// <summary>一足：间隙不走路，原地转身对着玩家</summary>
        protected override void Idle(float dt)
        {
            Halt();
            FacePlayer(110f, dt);
        }

        protected override void Passive(float dt)
        {
            // 雷兽一直带电（登场时不可选中拿不到电：开打后补上，被清掉了也补）
            if (!Charge.IsCharged(hp))
            {
                chargeHold?.Dispose();
                chargeHold = Charge.Hold(hp, this);
            }
            if (Phase >= 2 && KDef != null)
            {
                ringT -= dt;
                if (ringT <= 0)
                {
                    ringT = KDef.ringEvery;
                    var c = Arena ? Arena.Center : transform.position;
                    float a = UnityEngine.Random.value * Mathf.PI * 2, r = UnityEngine.Random.Range(KDef.ringBand.x, KDef.ringBand.y);
                    var p = c + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
                    LightningStrike.Strike(p, new StrikeOptions
                    {
                        warn = KDef.ringWarn, radius = KDef.ringRadius, damage = MoveDamage(KDef.ringDamage / Mathf.Max(1f, Def.damage)), source = this,
                    });
                    RingStrikes++;
                }
            }
            if (DrumOpen) Fx.KuiCoreGlow(BonePos(KuiDef.WeakBone), dt, Break != null && Break.Broken ? 0.6f : 1f);
            if (Break != null && Break.Broken) Fx.KuiDrumSeam(BonePos(KuiDef.WeakBone), dt);
        }

        // ───────────── 阶段 ─────────────

        protected override void OnLordPhase(int phase)
        {
            perchLanded = phase != 1;
            if (phase != 1) return;
            // 召鼓：跳上拉则旁
            perchFrom = transform.position;
            var target = Arena ? (Arena.perchPoints != null && Arena.perchPoints.Length > 0 && Arena.perchPoints[0] ? Arena.perchPoints[0].position : Arena.Center + (transform.position - Arena.Center).normalized * 4f) : transform.position;
            target.y = GroundAt(target);
            perchTo = target;
            BeginDash(Vector3.zero, 0);
        }

        protected override void TransitionTick(float t, float dt)
        {
            if (Phase == 1 && !perchLanded)
            {
                float k = Smooth(t / 1.1f);
                var p = Vector3.Lerp(perchFrom, perchTo, k);
                p.y += 6f * 4f * k * (1 - k);
                transform.position = p;
                if (t < 0.05f) PlayAct("leap", 1.6f, 0.06f);
                if (t >= 1.1f)
                {
                    perchLanded = true;
                    transform.position = perchTo;
                    EndDash();
                    Fx.KuiDrumRing(perchTo, 12f, 0.5f);
                    Fx.KuiDust(perchTo, 2.4f, 8);
                    Shake(0.4f, 0.4f);
                    PlayAct("roar", 2f, 0.1f);
                    SummonDrums();
                    foreach (var c in Conductor.All)
                        if (c && Arena && Arena.Contains(c.Base, -2f))
                            c.AddCharge(KDef != null ? KDef.drumsPoleCharge : 0.3f);
                }
            }
            else if (Phase == 2 && UnityEngine.Random.value < dt * 3f && Arena)
            {
                float a = UnityEngine.Random.value * Mathf.PI * 2, r = UnityEngine.Random.Range(25f, 40f);
                LightningStrike.Strike(Arena.Center + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r), new StrikeOptions { warn = 0, noTelegraph = true, source = this });
            }
        }

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            if (!perchLanded)
            {
                perchLanded = true;
                EndDash();
            }
            if (Phase == 1) Tell("kui_poles", "经幡杆旁 2–5 m 能躲雷；带电的杆子会回劈落在旁边的夔", KuiDef.Thunder, 60f, 4f);
            if (Phase == 2) Tell("kui_storm", "外圈落雷越来越密——往山顶收", KuiDef.Thunder, 60f, 3f);
        }

        void SummonDrums()
        {
            var d = KDef;
            if (d == null || string.IsNullOrEmpty(d.lianguId)) return;
            if (EnemyRoster.Get(d.lianguId) == null)
            {
                Debug.LogWarning($"[Kui] 名册里没有连鼓灵（{d.lianguId}），召鼓只出演出");
                return;
            }
            var o = SummonOptions.Default;
            o.warn = 0.6f;
            o.minRadius = 18f;
            o.maxRadius = 24f;
            o.cap = d.lianguCount;
            o.usePoints = true;
            o.noReward = false;
            DrumsSummoned += Summons.Spawn(d.lianguId, d.lianguCount, o);
        }

        // ───────────── 场地：经幡杆回劈 ─────────────

        /// <summary>大跳落地时调：落在带电的经幡杆 4.5 m 内 → 回劈（硬直、伤害、破防条）。返回是否回劈了</summary>
        public bool TryBacklash()
        {
            var d = KDef;
            if (d == null || Dead) return false;
            var pole = Conductor.NearestCharged(transform.position, d.backlashRadius);
            if (!pole) return false;
            pole.Discharge();
            var chest = BonePos("chest");
            Fx.KuiBacklash(pole.Top, chest);
            Shake(0.5f, 0.4f);
            Backlashes++;
            var info = new DamageInfo
            {
                amount = d.backlashDamage * WebScale, element = Element.Shock, source = DamageSource.Environment, point = chest,
                direction = (chest - pole.Top).normalized, instigator = pole,
            };
            Combat.DamageEnemy(hp, info);
            Break?.Add(d.backlashBreak * WebScale);
            if (!Staggered) Stagger(d.backlashStun, "kneel", 1f);
            Tell("kui_backlash", "落在带电的经幡杆旁——被回劈了！", KuiDef.Thunder, 6f, 2f);
            return true;
        }

        // ───────────── 破防 / 倒下 ─────────────

        protected override void OnLordBreak(int count)
        {
            Fx.KuiBreakDrum(BonePos(KuiDef.WeakBone), transform.forward);
            Shake(0.4f, 0.4f);
            if (DashGrounded == false) EndDash();
            var p = transform.position;
            p.y = GroundAt(p);
            transform.position = p;
            Tell("kui_break", "破鼓！夔单膝跪地——全力输出", KuiDef.Thunder, 4f, 2.5f);
        }

        protected override void OnLordDefeated(DamageInfo info)
        {
            chargeHold?.Dispose();
            chargeHold = null;
            drumMod?.Dispose();
            drumMod = null;
            deathBurst = false;
            deathScale0 = Model?.root ? Model.root.transform.localScale.x : 1f;
        }

        /// <summary>雷息：0.3 s 鼓面炸开 → 1.6–4.0 s 往后倒进残鼓（体型缩到 25%、化成雷云）→ 1.5 s 起雷暴退去 → 4 s 后隐去</summary>
        public override void DeathTick(float t, float dt)
        {
            if (t > 0.3f && !deathBurst)
            {
                deathBurst = true;
                Fx.KuiBreakDrum(BonePos(KuiDef.WeakBone), transform.forward);
            }
            float sink = Smooth((t - 1.6f) / 2.4f);
            SetModelScale(deathScale0 * (1f - 0.75f * sink));
            if (Drum && sink > 0.5f) Drum.SetVisible(true);
            if (sink > 0 && sink < 1 && UnityEngine.Random.value < dt * 12f) Fx.KuiCloud(BonePos("chest"), 1.2f, 2, true);
            if (t > 1.5f && StormTicket != null && StormTicket.Stage is PlateauStorm.Stage.FadingIn or PlateauStorm.Stage.Full or PlateauStorm.Stage.Waiting) StormTicket.End();
            if (t > 4f && Model?.root && Model.root.activeSelf)
            {
                Fx.KuiCloud(Drum ? Drum.Center : transform.position, 1.5f, 6, true);
                Model.root.SetActive(false);
            }
        }

        static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }
}
