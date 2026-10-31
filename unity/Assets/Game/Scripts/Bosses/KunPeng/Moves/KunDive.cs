using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 潜袭（Three.js KunPeng.ts 'dive'，3.0 s）：
    ///   前摇 2.0 s：沉入冰窟（act_sink，erupt 片段接在后面；0.15–0.8 s 侧身一头扎下去，0.5 s 起不可选中）；0.7 s 时在玩家所在那一侧（± 20°）的冰沿外 1.5 m
    ///     亮 4.5 m 的破冰预警（1.3 s）、那一侧的水面冒泡，水面上一道 V 形尾迹从原方位游过去；1.2 s 在水下换到新方位、面朝冰沿外；
    ///     1.2 s 那片水面隆起；1.6 s 破水而出（breach 事件：穹顶炸成水柱，鲲在柱里竖着冲上来，可选中），1.8 s 出水到顶人立（apex）；
    ///   出手 0.3 s：扑咬（erupt 第 1 帧 hit 事件，兜底 2.0 s）——头砸上冰沿外一口咬合 = 爆点重击（26，击退 10 / 上抛 8）+ 向外 ± 69° 的冰浪（14）；
    ///   收招 0.7 s：趴在冰沿上 → 撑起。
    /// 环台上没有安全的角落：玩家离鲲越远（方位差 &gt; 69°）越爱出这一招（权重 4，否则 1.6）。
    /// 动作 / 特效（K 路 + 第二批 A 路，docs/art/vfx/kunpeng.md 第 3、12 节）：sink / erupt 是手 K 片段；下潜那一下水冠白沫（plunge）、潜游尾迹（<see cref="Fx.KunSwim"/>）、
    /// 穹顶（<see cref="Fx.KunBreachDome"/>：「要从这里出来」）、破水水柱（<see cref="Fx.KunBreachOut"/>）、人立顶点落点一记冰晶星（apex）；
    /// 释放帧咬合双月牙（<see cref="Fx.KunBite"/>）+ 冰沿崩起一圈冰板（<see cref="Fx.KunBreach"/>）+ 北冥浪墙（<see cref="Fx.KunWave"/>），顿帧 0.07 s。
    /// 沉浮（<see cref="SunkAt"/>）是代码按时间写的，和片段的姿势一起对过：破水前整只在水下，扑咬那一帧完全出水（art/source/characters/SK_Boss_Kun/anim/kun_anims.py 的 dive_sunk）。
    /// </summary>
    public sealed class KunDive : KunPengMove
    {
        public const string MoveId = "dive";
        public const float SubmergeAt = 0.5f, WarnAt = 0.7f, RelocateAt = 1.2f, Spread = 20f, BlastRadius = 4.5f, WaveHalf = 68.75f, FarOff = 68.75f;
        /// <summary>沉：0.15 s 起、0.8 s 沉到底；下潜水花（plunge 事件兜底）；破水而出（breach 事件兜底）、升到顶</summary>
        public const float SinkFrom = 0.15f, SinkTo = 0.8f, PlungeAt = 0.43f, BreachAt = 1.6f, RiseTo = 1.9f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 潜袭";

        /// <summary>本次的破冰点、新方位、是否已在水下换位、破冰重击打中没有</summary>
        public Vector3 Impact { get; private set; }
        public float NextTheta { get; private set; }
        public bool Relocated { get; private set; }
        public bool BlastHit { get; private set; }

        float bubbleAcc;
        bool domed, apexed;
        /// <summary>破水前多久水面开始隆起（秒）</summary>
        public const float DomeLead = 0.4f;
        /// <summary>破水而出了没有（测试用）</summary>
        public bool Breached { get; private set; }

        public KunDive()
        {
            forms = new[] { KunPengDef.KunForm };
            cooldown = 9f;
            recovery = 0.8f;
            firstDelay = 6f;
            weight = 1.6f;
            windup = 2f;
            active = 0.3f;
            recover = 0.7f;
        }

        public override float Weight(BossBrain b)
        {
            var kp = b as KunPengBrain;
            if (!kp) return weight;
            return Mathf.Abs(Mathf.DeltaAngle(kp.Theta, kp.PlayerAngle)) > FarOff ? 4f : 1.6f;
        }

        protected override void OnStart()
        {
            Act("sink", WindupTime);
            CuedSfx("telegraph", 1f, 0.6f);
            bubbleAcc = 0;
            Relocated = BlastHit = domed = apexed = Breached = false;
            NextTheta = KP ? KP.Theta : 0;
            Impact = AtFloor(Hole.Point(NextTheta, Hole.radius + 1.5f));
        }

        /// <summary>
        /// 沉浮曲线：0.15–0.8 s 沉下去（EaseInOut，起手那一抽露在水面上）；1.6 s 破水、0.3 s 冲到顶（1 − EaseOutCubic），扑咬那一帧已经整只出水。
        /// 改前是出手时刻起 0.7 s 才浮上来——释放帧那一刻鲲还整只沉在水下，玩家只看到一团水
        /// </summary>
        public static float SunkAt(float t) => t < BreachAt
            ? KunPengMath.EaseInOut(KunPengMath.Span(t, SinkFrom, SinkTo))
            : 1 - KunPengMath.EaseOutCubic(KunPengMath.Span(t, BreachAt, RiseTo));

        public override void OnAnimEvent(string name)
        {
            base.OnAnimEvent(name);
            if (name == "apex") Apex();
        }

        /// <summary>出水到顶人立（apex）：落点一记冰晶星「叮」——就咬这里</summary>
        void Apex()
        {
            if (apexed || Stage != MoveStage.Windup || !Breached) return;
            apexed = true;
            Fx.KunSlamApex(Impact, BlastRadius * 0.8f);
        }

        /// <summary>鲲身下（方位 theta）的水面点</summary>
        Vector3 WaterAt(float theta)
        {
            var w = Hole.Point(theta, Mathf.Max(1f, Hole.radius - (KDef != null ? KDef.kunInset : 4.6f)));
            w.y = Hole.waterY;
            return w;
        }

        /// <summary>破水而出：穹顶炸成水柱、鲲竖着冲出来（之后可选中）</summary>
        void Breach()
        {
            Breached = true;
            if (KP)
            {
                KP.Submerged = false;
                if (!Relocated)
                {
                    Relocated = true;
                    KP.Theta = NextTheta;
                    KP.SetFacing(NextTheta);
                }
            }
            Fx.KunBreachOut(WaterAt(NextTheta));
            Sfx("boss_slam", 0.8f, 0.75f);
        }

        protected override void OnWindup(float dt)
        {
            // 下潜那一下的水冠白沫（片段 plunge 事件，代理按时间）
            if (Cue("plunge", PlungeAt)) Fx.KunPlunge(WaterAt(KP ? KP.Theta : NextTheta));
            if (!Breached && Cue("breach", BreachAt)) Breach();
            if (!KP) return;
            KP.Sunk = SunkAt(T);
            if (StageT >= SubmergeAt && !Breached) KP.Submerged = true;
            if (StageAt(WarnAt))
            {
                float from = KP.Theta;
                NextTheta = KP.PlayerAngle + Rng.Range(-Spread, Spread);
                Impact = AtFloor(Hole.Point(NextTheta, Hole.radius + 1.5f));
                WarnCircle(Impact, BlastRadius, Mathf.Max(0.2f, WindupTime - WarnAt));
                Sfx("telegraph", 1f, 0.6f);
                // 潜游：水面上一道尾迹从原方位游到破冰那一侧（换位那一刻到）
                var c = Hole.center;
                c.y = Hole.waterY;
                Fx.KunSwim(c, Mathf.Max(1f, Hole.radius - (KDef != null ? KDef.kunInset : 4.6f)), from, NextTheta, Mathf.Max(0.2f, RelocateAt - WarnAt));
            }
            if (StageT > WarnAt)
            {
                bubbleAcc += dt;
                if (bubbleAcc >= 0.12f)
                {
                    bubbleAcc = 0;
                    var p = Hole.Point(NextTheta, Hole.radius - 1.5f - Rng.Value * 3f);
                    p.y = Hole.waterY + 0.3f;
                    Fx.Burst(p, KunPengDef.Ice, 5, 4f, 0.6f, 0.3f, 6f);
                }
            }
            if (!domed && StageT >= BreachAt - DomeLead)
            {
                domed = true;
                Fx.KunBreachDome(WaterAt(NextTheta), 4.2f, DomeLead);
            }
            if (!Relocated && StageT >= RelocateAt)
            {
                // 水下换位：鲲在新方位、面朝冰沿外
                Relocated = true;
                KP.Theta = NextTheta;
                KP.SetFacing(NextTheta);
            }
            KP.PlaceKun();
        }

        /// <summary>扑咬跟 erupt 片段的 hit 事件走（第 1 帧，≈ 1.99 s），兜底 2.0 s</summary>
        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            if (KP)
            {
                KP.Submerged = false;
                if (!Relocated)
                {
                    Relocated = true;
                    KP.Theta = NextTheta;
                    KP.SetFacing(NextTheta);
                }
                KP.PlaceKun();
            }
            int hits0 = Hazards.PlayerHits;
            Hazards.Blast(Impact, BlastRadius, Dmg(26), new BossBlastOpts { maxHeight = 4f, knockback = 10f, knockUp = 8f });
            BlastHit = Hazards.PlayerHits > hits0;
            Hazards.Wave(new BossWaveSpec(Impact, 12f, 12f, Dmg(14), KunPengDef.Warn)
            {
                startRadius = 2f, width = 1f, height = 0.85f, arcYaw = NextTheta, arcHalf = WaveHalf, knockback = 7f, dust = true, dustColor = KunPengDef.Ice,
                spare = BlastHit,
            });
            if (!Breached) Breach();
            // 扑咬（释放帧）：头砸上冰沿外一口咬合——上下两道咬合月牙 + 冰沿上冰爆、冰刺环、崩起一圈冰板，冰浪跟着冲击波往外推；
            // 水柱、水冠、大涟漪已经在 0.4 s 前破水那一下出过（Breach）
            Fx.KunBite(Impact, NextTheta, 1.1f);
            Fx.FrostNova(Impact + Vector3.up * 0.8f, 4f);
            Fx.IceRing(Impact, 3.5f, 12);
            Fx.KunBreach(Impact, NextTheta);
            Fx.WaterDisturb(WaterAt(NextTheta), 6f, 1f);
            Fx.KunWave(Impact, NextTheta, WaveHalf * 2f, 2f, 12f, 12f, 1.8f);
            KP?.ImpactHold(0.07f);
            Brain.Shake(0.55f, 0.45f);
            CuedSfx("boss_roar", 1f, 0.9f);
        }

        protected override void OnActive(float dt)
        {
            if (!KP) return;
            KP.Sunk = SunkAt(T);
            KP.PlaceKun();
        }

        protected override void OnRecover(float dt) => OnActive(dt);

        protected override void OnEnd(bool cancelled)
        {
            if (KP) KP.Submerged = false;
        }
    }
}
