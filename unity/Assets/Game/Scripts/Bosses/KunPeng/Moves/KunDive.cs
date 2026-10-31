using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 潜袭（Three.js KunPeng.ts 'dive'，3.0 s）：
    ///   前摇 2.0 s：沉入冰窟（act_sink，erupt 片段接在后面；0–0.7 s 沉下去，0.5 s 起不可选中）；0.7 s 时在玩家所在那一侧（± 20°）的冰沿外 1.5 m
    ///     亮 4.5 m 的破冰预警（1.3 s）、那一侧的水面冒泡；1.6 s 在水下换到新方位、面朝冰沿外；
    ///   出手 0.3 s：破冰而出（hit 事件）——爆点重击（26，击退 10 / 上抛 8）+ 向外 ± 69° 的冰浪（14）；可选中；
    ///   收招 0.7 s：浮出水面（2.0–2.7 s 升起）。
    /// 环台上没有安全的角落：玩家离鲲越远（方位差 &gt; 69°）越爱出这一招（权重 4，否则 1.6）。
    /// 特效（K 路，docs/art/vfx/kunpeng.md 第 3 节）：破冰前 0.45 s 那片水面隆起一个穹顶（<see cref="Fx.KunBreachDome"/>：「要从这里出来」）；
    /// 释放帧冰沿崩起一圈冰板（<see cref="Fx.KunBreach"/>）+ 水柱 + 北冥浪墙（<see cref="Fx.KunWave"/>），顿帧 0.06 s。
    /// </summary>
    public sealed class KunDive : KunPengMove
    {
        public const string MoveId = "dive";
        public const float SubmergeAt = 0.5f, WarnAt = 0.7f, RelocateAt = 1.6f, Spread = 20f, BlastRadius = 4.5f, WaveHalf = 68.75f, FarOff = 68.75f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 潜袭";

        /// <summary>本次的破冰点、新方位、是否已在水下换位、破冰重击打中没有</summary>
        public Vector3 Impact { get; private set; }
        public float NextTheta { get; private set; }
        public bool Relocated { get; private set; }
        public bool BlastHit { get; private set; }

        float bubbleAcc;
        bool domed;
        /// <summary>破冰前多久水面开始隆起（秒）</summary>
        public const float DomeLead = 0.45f;

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
            CuedSfx("boss_slam", 0.6f, 0.6f);
            bubbleAcc = 0;
            Relocated = BlastHit = domed = false;
            NextTheta = KP ? KP.Theta : 0;
            Impact = AtFloor(Hole.Point(NextTheta, Hole.radius + 1.5f));
        }

        /// <summary>沉浮曲线（Three.js animateKun 的 dive 分支）：0–0.7 s 沉下去，出手时刻起 0.7 s 浮上来</summary>
        float SunkAt(float t) => t < WindupTime
            ? KunPengMath.EaseInOut(KunPengMath.Span(t, 0, 0.7f))
            : 1 - KunPengMath.EaseOutCubic(KunPengMath.Span(t, WindupTime, WindupTime + 0.7f));

        protected override void OnWindup(float dt)
        {
            if (!KP) return;
            KP.Sunk = SunkAt(T);
            if (StageT >= SubmergeAt) KP.Submerged = true;
            if (StageAt(WarnAt))
            {
                NextTheta = KP.PlayerAngle + Rng.Range(-Spread, Spread);
                Impact = AtFloor(Hole.Point(NextTheta, Hole.radius + 1.5f));
                WarnCircle(Impact, BlastRadius, Mathf.Max(0.2f, WindupTime - WarnAt));
                Sfx("telegraph", 1f, 0.6f);
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
            if (!domed && StageT >= WindupTime - DomeLead)
            {
                domed = true;
                var w = Hole.Point(NextTheta, Mathf.Max(1f, Hole.radius - 4.6f));
                w.y = Hole.waterY;
                Fx.KunBreachDome(w, 4.2f, DomeLead);
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

        protected override bool WindupDone => StageT >= WindupTime;

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
            // 破冰探头（原来是染成冰蓝的火焰爆炸）：冰沿上冰爆 + 冰刺环；鲲出水的那片水面炸起水柱、水冠、大涟漪，冰浪跟着冲击波往外推
            Fx.FrostNova(Impact + Vector3.up * 0.8f, 4f);
            Fx.IceRing(Impact, 3.5f, 12);
            Fx.KunBreach(Impact, NextTheta);
            var water = Hole.Point(KP ? KP.Theta : NextTheta, Mathf.Max(1f, Hole.radius - 4.6f));
            water.y = Hole.waterY;
            Fx.WaterDisturb(water, 8f, 1.5f);
            Fx.Splash(water, 3.6f, Fx.NorthSea);
            Fx.WaterSpout(water, 2.2f, 9f, 0.3f, Fx.NorthSea);
            Fx.KunWave(Impact, NextTheta, WaveHalf * 2f, 2f, 12f, 12f, 1.8f);
            KP?.ImpactHold(0.06f);
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
