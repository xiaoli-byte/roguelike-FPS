using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 飞廉的行为（<see cref="FeilianDef"/>；网页版 bosses.ts FeilianBoss）：
    ///   · 招式间隙小跑到离玩家 12–18 m（BossBrain 默认走位的距离带），只在擂台里（冰舌顶）；
    ///   · 擂台风（F 路 WindField）：开打时加一个跟着它走的吸引点——一二阶段 strength −1（往外推）、三阶段 +1（往里吸）；推人加速度 PlayerPush、
    ///     顺风 / 逆风 ±25% 步速（PlayerSpeedK）都是全局量，开打时记下原值、倒下时还回去；风雷爆蓄力时加倍吸；珠碎风停 6 s；
    ///     玩家身边贴地刮风线（风向 = 采样到的风），风影（掩体后）不刮。
    ///   · 风雷珠（<see cref="FeilianOrb"/>，orb 骨）：弱点；二阶段起珠子攒满时带电（F 路 Charge.Hold，火一碰焚雷）；珠碎后弱点关掉、25 s 后重新长出来。
    ///   · 侧跃：2 s 内挨打太多（700，按耐久换算）就出侧跃（权重写在招式里，这里记最近受伤）。
    ///   · 龙卷：二阶段转阶段时风涡分出两根、之后龙卷招每次两根（三阶段三根）；火龙卷被吸回来烧它（<see cref="FeilianTornado"/>）。
    ///   · 风涡柱：开打时在 WindVortex 锚点（没有就在出生点）立一根 40 m 的螺旋带柱，死时一圈圈松开散掉。
    ///   · 死亡「风止」：珠子散成一团风 → 侧倒（down 片段）→ 风涡柱散掉、盆地的风停下（吸引点撤掉）。
    /// </summary>
    public sealed class FeilianBrain : LordBrain
    {
        public FeilianDef FDef => Def as FeilianDef;
        public FeilianOrb Orb { get; private set; }
        public FeilianSpiral Vortex { get; private set; }
        /// <summary>擂台风的吸引点（开打后才有）</summary>
        public WindAttractor Wind { get; private set; }
        /// <summary>珠子还在（没碎 / 已长回来）</summary>
        public bool OrbIntact => orbGone <= 0;
        /// <summary>2 s 内挨的打（侧跃用）</summary>
        public float RecentDamage { get; private set; }
        /// <summary>场上的龙卷、被点着过几根（测试用）</summary>
        public IReadOnlyList<FeilianTornado> Tornadoes => tornadoes;
        public int FireTornadoes { get; internal set; }
        /// <summary>风雷爆蓄力 0..1（招式写，吸力 / 珠子用）</summary>
        public float Storm { get; set; }
        /// <summary>狂风出手段剩余秒数（猛推，招式写）</summary>
        public float GustLeft { get; set; }
        public Vector3 GustDir { get; set; }
        /// <summary>撞晕过几次（测试用）</summary>
        public int Crashes { get; internal set; }

        readonly List<FeilianTornado> tornadoes = new();
        IDisposable chargeHold;
        float orbGone, windOff, groundAcc, pushWas, speedKWas;
        bool windSet, landedIntro, deathBurst;
        Vector3 vortexAt;

        // ───────────── 生成 / 登场 ─────────────

        protected override void OnLordSpawn()
        {
            var bone = Bone(FeilianDef.WeakBone);
            if (bone && !Orb) Orb = FeilianOrb.Attach(bone, 0.42f);
            orbGone = 0;
            RecentDamage = 0;
            hp.Damaged += OnHurt;
            vortexAt = Arena ? AnchorOr("WindVortex", Arena.BossSpawnPoint) : transform.position;
            if (!Vortex)
            {
                Vortex = FeilianSpiral.Create(vortexAt + Vector3.up * 6f, 3f, 9f, 40f, 90f);
                Own(Vortex.gameObject);
            }
            landedIntro = false;
        }

        Vector3 AnchorOr(string name, Vector3 fallback)
        {
            foreach (var t in Arena.GetComponentsInChildren<Transform>(true))
                if (t != Arena.transform && t.name.StartsWith(name, StringComparison.OrdinalIgnoreCase))
                    return t.position;
            return fallback;
        }

        void OnHurt(DamageInfo info, DamageResult r)
        {
            if (IntroDone && !Dead) RecentDamage += r.total;
        }

        /// <summary>登场（5.4 s）：0–3.0 s 从 40 m 高的风涡里盘旋落下（半径 6 → 0、8 圈）→ 3.0 s 落地炸开一圈雪 → 人立长嘶</summary>
        protected override void IntroTick(float t, float dt)
        {
            float sec = t * Mathf.Max(0.01f, Def.intro.seconds);
            var root = Model?.root ? Model.root.transform : null;
            if (sec < 3f)
            {
                float k = Smooth(sec / 3f);
                float spin = (1 - k) * 8f;
                if (root)
                {
                    root.localPosition = new Vector3(Mathf.Sin(spin) * 6f * (1 - k), 40f * (1 - k), Mathf.Cos(spin) * 6f * (1 - k)) / Mathf.Max(0.01f, transform.localScale.x);
                    root.localRotation = Quaternion.Euler(0, spin * Mathf.Rad2Deg + 90f, 0);
                }
                if (UnityEngine.Random.value < dt * 20f && root) Fx.FeilianGather(root.position + Vector3.up * 2f, null, 4f, 0.3f, dt);
                return;
            }
            if (root)
            {
                root.localPosition = Vector3.zero;
                root.localRotation = Quaternion.identity;
            }
            if (landedIntro) return;
            landedIntro = true;
            Fx.FeilianSnowCrown(transform.position, 2.2f);
            Fx.Ring(transform.position + Vector3.up * 0.1f, 14f, FeilianPalette.Snow, 0.5f);
            Shake(0.4f, 0.4f);
            PlayAct("roar", 2.4f, 0.1f);
        }

        protected override void OnIntroEnd()
        {
            var root = Model?.root ? Model.root.transform : null;
            if (root)
            {
                root.localPosition = Vector3.zero;
                root.localRotation = Quaternion.identity;
            }
            SetWind(true);
            Tell("feilian_tip", "风一直把人往外推——打鹿角间的风雷珠；引它撞上冰脊、巨石", FeilianPalette.Wind, 60f, 4f);
        }

        void SetWind(bool on)
        {
            if (on && !windSet)
            {
                windSet = true;
                pushWas = WindField.PlayerPush;
                speedKWas = WindField.PlayerSpeedK;
                var d = FDef;
                Wind = WindField.AddAttractor(transform.position, d != null ? d.windRadius : 42f, -1f, d != null ? d.windCore : 10f);
                WindField.PlayerPush = d != null ? d.windPush : 1.6f;
                WindField.PlayerSpeedK = d != null ? d.windSpeedK : 0.25f;
            }
            else if (!on && windSet)
            {
                windSet = false;
                Wind?.Dispose();
                Wind = null;
                WindField.PlayerPush = pushWas;
                WindField.PlayerSpeedK = speedKWas;
            }
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Dead) return;
            float dt = Time.deltaTime;
            RecentDamage = Mathf.Max(0, RecentDamage - dt * 200f * WebScale);
            if (orbGone > 0)
            {
                orbGone -= dt;
                if (Orb) Orb.Grow = orbGone > 3f ? 0f : 1f - orbGone / 3f;
                if (orbGone <= 0) OrbBack();
            }
            if (Orb)
            {
                Orb.SetVisible(orbGone <= 3f && Model?.root && Model.root.activeSelf);
                Orb.Storm = Storm;
            }
            windOff = Mathf.Max(0, windOff - dt);
            if (Wind != null)
            {
                Wind.center = transform.position;
                float s = Phase >= 2 ? 1f : -1f;
                if (Storm > 0) s = 1f;
                if (GustLeft > 0) s = -1f;
                Wind.strength = windOff > 0 || Transitioning ? 0f : s;
                float push = FDef != null ? FDef.windPush : 1.6f, storm = FDef != null ? FDef.stormPush : 2.6f;
                WindField.PlayerPush = windOff > 0 ? 0f : Storm > 0 ? Mathf.Lerp(push, storm, Storm) : push;
            }
            // 狂风出手段：顺风猛推（9 m/s 量级），掩体后不推
            if (GustLeft > 0)
            {
                GustLeft -= dt;
                if (!Covered(BonePos(FeilianDef.WeakBone))) BlowPlayer(GustDir * (FDef != null ? FDef.gustPush : 9f), dt);
            }
            // 带电：二阶段起、珠子在的时候
            bool charged = Phase >= 1 && OrbIntact && IntroDone;
            if (charged && !Charge.IsCharged(hp))
            {
                chargeHold?.Dispose();
                chargeHold = Charge.Hold(hp, this);
            }
            else if (!charged && chargeHold != null)
            {
                chargeHold.Dispose();
                chargeHold = null;
            }
            GroundWind(dt);
        }

        void GroundWind(float dt)
        {
            if (Wind == null || Wind.strength == 0 || !PlayerFeet(out var feet)) return;
            groundAcc += dt;
            if (groundAcc < (Fx.Density < 0.6f ? 0.5f : 0.25f)) return;
            groundAcc = 0;
            var to = feet - transform.position;
            to.y = 0;
            if (to.magnitude > (FDef != null ? FDef.windRadius : 42f)) return;
            var at = feet + new Vector3(UnityEngine.Random.Range(-10f, 10f), 0, UnityEngine.Random.Range(-10f, 10f));
            at.y = GroundAt(at);
            if (!Combat.LineClear(BonePos(FeilianDef.WeakBone), at + Vector3.up)) return;
            var w = WindField.Sample(at);
            Fx.FeilianGroundWind(at, w.dir, w.strength);
        }

        /// <summary>从 from（风雷珠）到玩家胸口之间被冰脊 / 巨石挡住：狂风吹不到</summary>
        public bool Covered(Vector3 from)
        {
            if (!PlayerFeet(out var feet)) return false;
            return !Combat.LineClear(from, feet + Vector3.up * 1.1f);
        }

        // ───────────── 龙卷 ─────────────

        public FeilianTornado SpawnTornado(Vector3 at)
        {
            var d = FDef;
            var t = FeilianTornado.Spawn(this, at, d != null ? d.tornadoLife : 9f);
            tornadoes.Add(t);
            return t;
        }

        internal void Forget(FeilianTornado t) => tornadoes.Remove(t);

        // ───────────── 阶段 ─────────────

        bool phaseTornadoes;

        protected override void OnLordPhase(int phase)
        {
            phaseTornadoes = phase != 1;
            if (phase == 2 && Vortex) Vortex.Reverse();
        }

        protected override void TransitionTick(float t, float dt)
        {
            // 龙卷：跃上风涡底、悬停嘶鸣，1.2 s 时风涡分出两根龙卷落下
            if (Phase == 1)
            {
                var root = Model?.root ? Model.root.transform : null;
                float k = Smooth(t / 0.8f), back = Smooth((t - 2.2f) / 0.8f);
                if (root) root.localPosition = Vector3.up * 6f * k * (1 - back) / Mathf.Max(0.01f, transform.localScale.x);
                if (!phaseTornadoes && t >= 1.2f)
                {
                    phaseTornadoes = true;
                    foreach (float a in new[] { 70f, -70f })
                        SpawnTornado(transform.position + Quaternion.Euler(0, transform.eulerAngles.y + a, 0) * Vector3.forward * 12f);
                }
            }
        }

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            var root = Model?.root ? Model.root.transform : null;
            if (root) root.localPosition = Vector3.zero;
            if (Phase == 1) Tell("feilian_tornado", "龙卷风柱追人——用火点着它，火龙卷会被风吸回去烧飞廉", FeilianPalette.Wind, 60f, 4f);
            if (Phase == 2) Tell("feilian_eye", "风向反了——风往它那里吸", FeilianPalette.Wind, 60f, 3f);
        }

        // ───────────── 破防 / 倒下 ─────────────

        protected override void OnLordBreak(int count)
        {
            var orb = BonePos(FeilianDef.WeakBone);
            Fx.FeilianOrbShatter(orb);
            Shake(0.35f, 0.35f);
            orbGone = FDef != null ? FDef.orbRegrow : 25f;
            windOff = FDef != null ? FDef.breakWindOff : 6f;
            Storm = 0;
            if (Orb) Orb.Grow = 0;
            Body.SetWeakPointActive(false);
            Tell("feilian_break", "珠碎！飞廉侧倒，风停了", FeilianPalette.Wind, 4f, 2.5f);
        }

        void OrbBack()
        {
            orbGone = 0;
            if (Orb) Orb.Grow = 1f;
            Body.SetWeakPointActive(true);
            Fx.LdOne("ToonBurst", BonePos(FeilianDef.WeakBone), Vector3.zero, 1.6f, 0.15f, FeilianPalette.OrbCore);
        }

        protected override void OnLordDefeated(DamageInfo info)
        {
            hp.Damaged -= OnHurt;
            chargeHold?.Dispose();
            chargeHold = null;
            SetWind(false);
            deathBurst = false;
        }

        /// <summary>风止：0.2 s 珠子散成一团风 → 侧倒 → 1–5 s 风涡柱一圈圈松开、散掉；龙卷 0.5 s 内散掉</summary>
        public override void DeathTick(float t, float dt)
        {
            if (t > 0.2f && !deathBurst)
            {
                deathBurst = true;
                Fx.FeilianOrbShatter(BonePos(FeilianDef.WeakBone));
                if (Orb) Orb.SetVisible(false);
                foreach (var tr in tornadoes.ToArray())
                    if (tr)
                        tr.Dissipate();
            }
            if (Vortex)
            {
                float k = Smooth((t - 1f) / 4f);
                Vortex.SetAlpha(1f - k);
                Vortex.transform.localScale = new Vector3(1f + k * 0.8f, 1f - k * 0.3f, 1f + k * 0.8f);
                if (k >= 1f)
                {
                    Destroy(Vortex.gameObject);
                    Vortex = null;
                }
            }
        }

        static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }
}
