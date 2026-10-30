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
    /// 动作与特效（docs/art/vfx/hanba.md「焦裂」）：片段 150 帧——起手右手往下后方一甩 → 扬到头顶、上浮后仰（过冲）→ 蓄力顶点五指成爪 →
    ///   2 帧俯冲按掌（hit = 释放帧，片段 36 帧，下沉 0.66 m）→ 压缩过冲 → 掌一直按在地上推着裂缝走（出手段）→ 拔掌（fx:palmOut）→ 起身。
    ///   前摇：扬起的手里攥着一团越来越大的日火（<see cref="Fx.HanbaPalmCharge"/>），按掌处一圈收紧的灼点印（倒计时）；
    ///   释放帧：顿帧 0.08 s + 掌下爆闪、贴地冲击环、龟裂星、崩起的石块、矮宽尘团（<see cref="Fx.HanbaPalmSlam"/>）+ 震屏；
    ///   持续段：每裂开一段，裂缝最前头一颗白金火头往前甩火星（<see cref="Fx.HanbaCrackHead"/>）；收招：拔掌的沙尘和掉下来的火星。
    /// </summary>
    public sealed class Phase2CrackLine : HanbaMove
    {
        public const string MoveId = "scorch_crack";
        /// <summary>裂缝蔓延速度（m/s）、分段长、走到头后多久爆、逐段爆开的间隔、每段爆炸半径、伤害倍率、长条半宽、长度范围、扇形张角</summary>
        public const float CrackSpeed = 18f, Step = 1.5f, ExplodeDelay = 0.45f, ChainGap = 0.035f, BlastRadius = 1.7f, DamageMult = 1.25f,
            HalfWidth = 1.3f, MinLength = 14f, MaxLength = 28f, FanAngle = 28f;
        static readonly Color CrackColor = Hex.Rgb(0xff8a2a), BlastColor = Hex.Rgb(0xffa040);
        /// <summary>片段 crackPalm 150 帧，hit 在 36 帧（hanba_anims.py；按掌之后一直按到裂缝爆完）</summary>
        public const float ClipHit = 36f / 150f;

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
            // 按掌处的灼点印：和预警同一刻收完
            Fx.HanbaFocusSeal(origin, 1.4f, wind);
            // 片段 150 帧，hit 在 36 帧：整段拉伸到 wind ÷ ClipHit，出手事件正好落在前摇结束
            ActAt("crackPalm", ClipHit, wind);
            Sfx("telegraph", 1f, 0.75f);
        }

        protected override bool WindupDone => Cue("hit", wind);

        protected override void OnWindup(float dt)
        {
            float u = Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind));
            Brain.Glow(0, u);
            // 扬起的手攥着一团日火（起手那一拍手还在往下收，先不点火）
            if (u > 0.18f) Fx.HanbaPalmCharge(Hanba ? Hanba.Hand(true) : Brain.BodyCenter + Vector3.up, (u - 0.18f) / 0.82f, dt);
        }

        protected override void OnActiveBegin()
        {
            // 释放帧：掌下爆闪 + 冲击环 + 龟裂星 + 石块 + 尘团 + 顿帧 + 震屏（同一帧：动画的 hit）
            Fx.HanbaPalmSlam(origin, yaw);
            Impact(0.08f, 0.55f, 0.4f, 40f, "hit");
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
                Hazards.Later(at, () => Split(p, dir, sound));
                Hazards.Later(end + i * ChainGap, () => Explode(p, sound));
            }
        }

        static void Split(Vector3 p, Vector3 dir, bool sound)
        {
            Fx.HanbaCrackHead(p, dir);
            Fx.Burst(p + Vector3.up * 0.15f, CrackColor, 3, 2.2f, 0.6f, 0.14f, -0.5f);
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

        /// <summary>fx:palmOut（收招第一拍把掌拔出来）：掌下一小团沙、掌上掉火星</summary>
        protected override void OnFxCue(string cue)
        {
            if (cue == "palmOut") Fx.HanbaPalmOut(Hanba ? Hanba.Hand(true) : Brain.BodyCenter, origin);
        }

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
