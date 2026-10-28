using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 焦裂（二阶段「焦土」起，unity-maps-v1 第 3 节：手掌按地，裂缝沿直线蔓延后爆开）。
    ///   前摇（1.2 s ÷ 阶段节奏）：右手扬起（ART2 crackPalm，hit 事件落在前摇结束），朝玩家亮一条长条预警（宽 2.6 m、长 = 玩家距离 + 8 m，14–28 m）；
    ///     三阶段起左右再各一条（±28°），三条成扇。
    ///   出手：俯冲按掌，掌下炸一团；裂缝从掌下沿每条线以 <see cref="CrackSpeed"/> m/s 蔓延（每 1.5 m 一段：地面裂开、透出火光、扬沙），
    ///     走到头后停 <see cref="ExplodeDelay"/> s，再从近到远逐段爆开（每段半径 <see cref="BlastRadius"/>、2.5 m 高以内；不看掩体，从地里炸出来）——
    ///     同一次施放最多伤玩家一次（被第一段炸飞就不会再连吃后面几段）。裂缝走地形：爬上岩岛、下到泉床都贴着地。
    ///     蔓延与爆炸挂在危险物时钟上：招式被打断（转阶段、硬直）后，已经裂开的照样爆。
    ///   收招 0.9 s：泉珠露出。
    /// 躲法：看长条预警横移出去；裂缝蔓延比人跑得快，别顺着线跑。
    /// </summary>
    public sealed class Phase2CrackLine : HanbaMove
    {
        public const string MoveId = "scorch_crack";
        /// <summary>裂缝蔓延速度（m/s）、分段长、走到头后多久爆、逐段爆开的间隔、每段爆炸半径、伤害倍率、长条半宽、长度范围、扇形张角</summary>
        public const float CrackSpeed = 18f, Step = 1.5f, ExplodeDelay = 0.45f, ChainGap = 0.035f, BlastRadius = 1.7f, DamageMult = 1.25f,
            HalfWidth = 1.3f, MinLength = 14f, MaxLength = 28f, FanAngle = 28f;
        static readonly Color CrackColor = Hex.Rgb(0xff8a2a), BlastColor = Hex.Rgb(0xffa040);

        public override string Id => MoveId;
        public override string Name => "焦裂";

        /// <summary>本次：裂缝条数、每条长度；累计：爆开的段数、打中玩家的次数</summary>
        public int Lines { get; private set; }
        public float Length { get; private set; }
        public int Explosions { get; private set; }
        public int TotalHits { get; private set; }
        /// <summary>本次已经爆开的段数</summary>
        public int CastExplosions { get; private set; }

        float wind, yaw;
        Vector3 origin;
        HazardVolley volley;
        readonly List<float> yaws = new();

        public Phase2CrackLine()
        {
            cooldown = 8f;
            recovery = 1.0f;
            weight = 2.2f;
            minPhase = 1;
            windup = 1.2f;
            active = 1.4f;
            recover = 0.9f;
        }

        /// <summary>出手 = 掌按在地上，等最长的一条蔓延到头、爆完（按平均 22 m 的线估）</summary>
        public override HanbaMovePlan Plan(float pace) =>
            new(Mathf.Max(0.25f, windup / Mathf.Max(0.5f, pace)), ActiveSeconds(22f), recover);

        /// <summary>一条长 length 的裂缝从按掌到爆完要多久</summary>
        public static float ActiveSeconds(float length) => length / CrackSpeed + ExplodeDelay + Mathf.CeilToInt(length / Step) * ChainGap + 0.15f;

        /// <summary>这一阶段几条（二阶段 1 条，三阶段起 3 条成扇）</summary>
        public int CountFor(BossBrain b) => b && b.Phase >= 2 ? 3 : 1;

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 4f ? weight : weight * 0.3f;

        protected override void Prepare()
        {
            Brain.Halt();
            yaw = YawToPlayer;
            SetFacing(yaw);
            wind = Windup(windup);
            Length = Mathf.Clamp(Brain.DistanceToPlayer + 8f, MinLength, MaxLength);
            Lines = CountFor(Brain);
            CastExplosions = 0;
            volley = new HazardVolley();
            yaws.Clear();
            yaws.Add(yaw);
            if (Lines >= 3)
            {
                yaws.Add(yaw - FanAngle);
                yaws.Add(yaw + FanAngle);
            }
            origin = Ground(Brain.transform.position + Dir(yaw) * (Brain.BodyRadius + 0.6f));
            if (Ring) Ring.SetBlaze(0.75f, 1.8f);
        }

        protected override void OnTelegraph()
        {
            foreach (var a in yaws)
            {
                Hazards.LineWarning(origin, a, Length, HalfWidth, wind, HanbaDef.Warn, ActiveSeconds(Length) - 0.1f);
                CountWarning();
            }
            // 片段 2.8 s，hit 在 1.2 s（42.86%）：整段拉伸到 wind ÷ 0.4286
            Act("crackPalm", wind / 0.4286f);
            Sfx("telegraph", 1f, 0.75f);
        }

        protected override bool WindupDone => Cue("hit", wind);

        protected override void OnWindup(float dt)
        {
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind)));
            if (Rng.Value < 0.3f) Fx.Burst(origin + Vector3.up * 0.2f, CrackColor, 2, 1.2f, 0.5f, 0.12f, -0.6f);
        }

        protected override void OnActiveBegin()
        {
            Fx.Burst(origin + Vector3.up * 0.3f, HanbaDef.Sand, 20, 6f, 0.9f, 0.35f, 5f);
            Fx.Ring(origin + Vector3.up * 0.1f, 3.5f, CrackColor, 0.5f);
            Brain.Shake(0.5f, 0.4f, 40f);
            Sfx("boss_slam", 0.9f, 0.9f);
            if (Ring) Ring.Flash(0.8f);
            foreach (var a in yaws) Spread(a);
        }

        /// <summary>沿 a 方向排一条裂缝：逐段裂开，走到头后逐段爆开（都在危险物时钟上）</summary>
        void Spread(float a)
        {
            var dir = Dir(a);
            int n = Mathf.Max(1, Mathf.CeilToInt(Length / Step));
            float end = Length / CrackSpeed + ExplodeDelay;
            for (int i = 1; i <= n; i++)
            {
                var p = Ground(origin + dir * Mathf.Min(Length, i * Step));
                float at = i * Step / CrackSpeed;
                bool sound = i % 4 == 1;
                Hazards.Later(at, () => Split(p, sound));
                Hazards.Later(end + i * ChainGap, () => Explode(p, sound));
            }
        }

        static void Split(Vector3 p, bool sound)
        {
            Fx.Burst(p + Vector3.up * 0.15f, CrackColor, 4, 2.2f, 0.6f, 0.14f, -0.5f);
            Fx.Burst(p + Vector3.up * 0.1f, HanbaDef.Sand, 3, 2.5f, 0.5f, 0.2f, 4f);
            // 裂口：沙地上一段发亮的日火裂痕（一路亮到爆开），从缝里往上冒火星
            FxDecals.Fire(p + Vector3.up * 0.02f, 1.05f, 3.2f, FireBed.Sunfire);
            if (sound) GameAudio.PlayAt("skill_earth", p, 0.45f, 1.4f);
        }

        void Explode(Vector3 p, bool sound)
        {
            if (Brain.Dead) return;
            Explosions++;
            CastExplosions++;
            if (!volley.hit && Hazards.Blast(p, BlastRadius, Damage(DamageMult), new BossBlastOpts { maxHeight = 2.5f, knockUp = 5.5f, knockback = 3f, element = Element.Fire, ignoreCover = true }))
            {
                volley.hit = true;
                TotalHits++;
            }
            Fx.Explosion(p + Vector3.up * 0.3f, BlastRadius, BlastColor);
            // 焦裂喷火：裂口里一道火柱窜起 + 沙往外炸
            FlameTongues.Pillar(p, 0.55f, 3.2f);
            Fx.SandBlast(p + Vector3.up * 0.2f, 1.1f);
            if (sound)
            {
                GameAudio.PlayAt("explosion", p + Vector3.up * 0.3f, 0.6f, 1.1f);
                CameraShake.Quake(p, 0.22f, 20f, 0.2f);
            }
        }

        protected override void OnActive(float dt) => Brain.Glow(0, 1f - Mathf.Clamp01(StageT / 0.6f));

        /// <summary>贴地：从首领脚下高度往上 20 m 往下找（裂缝会爬上沙丘坡、下到泉床）</summary>
        Vector3 Ground(Vector3 p)
        {
            p.y = Brain.transform.position.y;
            p.y = GroundY(p, 20f);
            return p;
        }

        protected override bool ActiveDone => StageT >= ActiveSeconds(Length);
    }
}
