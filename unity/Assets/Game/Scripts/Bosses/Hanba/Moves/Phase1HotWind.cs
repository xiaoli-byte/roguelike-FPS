using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 旱风（一阶段「烈日」，unity-maps-v1 第 3 节：扇形热浪推开玩家并扬沙）。
    ///   前摇（1.1 s ÷ 阶段节奏）：双臂后收蓄力（ART2 droughtGale，hit 事件落在前摇结束），前半段还跟着玩家转；地面亮一片 22 m、半角 38° 的沙色扇区。
    ///   出手：向前推掌，掀起一道扇形热浪（<see cref="BossHazards.Wave"/>：26 m/s 扩到 22 m，环带 3 m 厚、4.5 m 高——跳不过去，只能躲到掩体后或出扇区），
    ///     打中：灼伤 + 水平 15 m/s 推开 + 扬沙（沙色闪屏）+ 热浪烤身（额外叠 2 层日晒）。二阶段起（节奏 &gt; 1）0.35 s 后补一道余波（半伤、推力减半）。
    ///   收招 0.9 s：泉珠露出。
    /// 被推进光柱里正好被晒：配合日晒机制逼走位。
    /// </summary>
    public sealed class Phase1HotWind : HanbaMove
    {
        public const string MoveId = "hot_wind";
        /// <summary>扇区半径、半角（度）、扩散速度、环带厚度、可命中的高度、推力、伤害倍率、额外日晒秒数</summary>
        public const float Range = 22f, HalfAngle = 38f, Speed = 26f, Width = 3f, Height = 4.5f, Knockback = 15f, DamageMult = 1f, BurnSeconds = 1f;
        static readonly Color HeatColor = Hex.Rgb(0xffc070);

        public override string Id => MoveId;
        public override string Name => "旱风";

        /// <summary>本次打中了没有（玩家被推开）、本次的朝向；累计打中</summary>
        public bool HitThisCast { get; private set; }
        public float Yaw { get; private set; }
        public int TotalHits { get; private set; }
        /// <summary>本次放出的热浪道数</summary>
        public int Waves { get; private set; }

        float wind;
        int hits0;
        bool aftershock;


        public Phase1HotWind()
        {
            cooldown = 7f;
            recovery = 1.1f;
            weight = 2.6f;
            windup = 1.1f;
            active = Range / Speed + 0.25f;
            recover = 0.9f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < Range - 2f ? weight : weight * 0.25f;

        /// <summary>出手 = 热浪扩到 22 m（二阶段起多一道余波）</summary>
        public override HanbaMovePlan Plan(float pace) => new(Mathf.Max(0.25f, windup / Mathf.Max(0.5f, pace)), Range / Speed + (pace > 1.01f ? 0.45f : 0.25f), recover);

        protected override void Prepare()
        {
            Brain.Halt();
            Yaw = YawToPlayer;
            SetFacing(Yaw);
            wind = Windup(windup);
            HitThisCast = aftershock = false;
            Waves = 0;
            hits0 = Hazards.PlayerHits;
            if (Ring) Ring.SetBlaze(0.7f, 1.6f);
        }

        protected override void OnTelegraph()
        {
            Hazards.SectorWarning(OnGround(Brain.transform.position), Yaw, HalfAngle, Range, wind, HanbaDef.Sand);
            CountWarning();
            // 片段 2.4 s，hit 在 1.0 s（41.7%）：整段拉伸到 wind ÷ 0.4167
            Act("droughtGale", wind * 2.4f);
            Sfx("telegraph", 1f, 0.8f);
        }

        protected override bool WindupDone => Cue("hit", wind);

        protected override void OnWindup(float dt)
        {
            // 前半段跟着玩家转（扇区预警是在出招第一帧画的，转身只微调手感，不超出预警太多）
            if (StageT < wind * 0.5f)
            {
                float want = YawToPlayer;
                float d = Mathf.DeltaAngle(Yaw, want);
                Yaw += Mathf.Clamp(d, -12f, 12f) * Mathf.Min(1f, dt * 4f);
                TurnToward(Yaw, 180f, dt);
            }
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind)));
            if (Rng.Value < 0.35f)
            {
                var p = Brain.transform.position + Dir(Yaw + Rng.Range(-HalfAngle, HalfAngle)) * Rng.Range(2f, 6f);
                Fx.Burst(OnGround(p) + Vector3.up * 0.3f, HanbaDef.Sand, 2, 1.5f, 0.6f, 0.2f, -0.5f);
            }
        }

        protected override void OnActiveBegin()
        {
            SetFacing(Yaw);
            Gust(Damage(DamageMult), Knockback);
            if (Ring) Ring.Flash(0.9f);
            Brain.Shake(0.45f, 0.4f, 40f);
            Sfx("boss_roar", 0.55f, 1.45f);
            Sfx("explosion", 0.4f, 0.6f);
        }

        void Gust(float damage, float knock)
        {
            var o = OnGround(Brain.transform.position) + Dir(Yaw) * (Brain.BodyRadius * 0.5f);
            o.y = LipY(o, Yaw);
            Hazards.Wave(new BossWaveSpec(o, Speed, Range, damage, HeatColor)
            {
                startRadius = Brain.BodyRadius + 0.5f, width = Width, height = Height, arcYaw = Yaw, arcHalf = HalfAngle, knockback = knock,
                element = Element.Fire, dust = true, dustColor = HanbaDef.Sand,
            });
            Waves++;
            // 旱风的「墙」：一道贴着冲击波前沿往外推的沙幕（弧幕体积，半径和前沿同速扩大）+ 一片顺风飞出去的沙线
            float r0 = Brain.BodyRadius + 0.5f, life = Range / Speed;
            Surge.Sheet(o, Yaw, r0, HalfAngle * 2f, Height * 0.75f, SurgeKind.Sand, 0.12f, Mathf.Max(0.05f, life - 0.42f), 0.3f, null, null, 1.6f, 0.9f,
                grow: 1f + Range / r0);
            Fx.SandGust(o + Vector3.up * 0.6f, Yaw, HalfAngle, Range, Speed);
            // 沿扇区扬一片沙
            for (int i = 0; i < 6; i++)
            {
                var p = o + Dir(Yaw + Rng.Range(-HalfAngle, HalfAngle)) * Rng.Range(3f, Range * 0.7f);
                Fx.Burst(OnGround(p) + Vector3.up * 0.5f, HanbaDef.Sand, 5, 5f, 0.8f, 0.3f, -0.3f);
            }
        }

        /// <summary>
        /// 热浪贴地铺开的高度：她悬在低洼里（月牙泉的泉床、吸干后的泉底，比岸上低 1.4 m）时，正前方 8 m 内地面比脚下高，热浪按那道岸坎的高度铺出去——
        /// 不然整道热浪埋在岸坡下面画不出来，挡波判定的那条线（离地 0.45 m）也撞在岸坡上，岸上的人永远打不到。顺着泉床朝前放时前方一样低，照旧贴着泉底走。
        /// 最多抬 2 m（不爬上沙丘、楼阁台基）
        /// </summary>
        float LipY(Vector3 o, float yaw)
        {
            float y = o.y;
            var dir = Dir(yaw);
            for (float d = 1f; d <= 8f; d += 1f)
                y = Mathf.Max(y, GroundY(new Vector3(o.x, o.y, o.z) + dir * d));
            return Mathf.Min(y, o.y + 2f);
        }

        protected override void OnActive(float dt)
        {
            if (!aftershock && PaceNow > 1.01f && StageT >= 0.35f)
            {
                aftershock = true;
                Gust(Damage(DamageMult * 0.5f), Knockback * 0.5f);
            }
            if (HitThisCast || Hazards.PlayerHits <= hits0) return;
            // 热浪打中：扬沙闪屏 + 烤身
            HitThisCast = true;
            TotalHits++;
            GameUI.ScreenFlash(new Color(0.85f, 0.66f, 0.4f, 0.45f), 0.6f);
            Exposure?.Burn(BurnSeconds, Brain.BodyCenter);
        }

        protected override bool ActiveDone => StageT >= Range / Speed + (PaceNow > 1.01f ? 0.45f : 0.25f);
    }
}
