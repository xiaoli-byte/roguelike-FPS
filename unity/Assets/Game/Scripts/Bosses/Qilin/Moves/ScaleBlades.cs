using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 张鳞（TS Qilin 'scales'）：
    ///   前摇 1 s 人立（手 K 片段 rear：蹲 → 起 → 人立顶点 → 抖 → 前蹄砸下，最后一帧砸地 = 出手；脚下 6.5 m 预警圈）→ 360° 射出一圈 36 片红热鳞刃（离地 1.2 m 的竖薄片，21 m/s，飞到殿墙两倍远）；
    ///   生命 85% 以下 0.4 s 后再射一圈，错开半格（两圈之间没有缝可钻）。
    ///   鳞刃是敌方投射物：撞到石柱 / 墙就碎（世界层挡得住）——躲到玄武岩柱后面；打中玩家 20（火）并往外推一下。
    /// Q 路（2026-10-31，设计单 docs/art/vfx/qilin.md「张鳞」）：
    ///   · 鳞冠（<see cref="QilinScaleCrown"/>）：前摇里一圈鳞片从身上竖起、张开到每片鳞刃的出手位置，暗赭 → 暗金 → 顶点暖白金——前摇就读得出「从哪来、往哪飞、什么时候飞」；
    ///   · 出手由 rear 片段的 hit 事件接住（<see cref="BossMove.Cue"/>，按时间兜底，两者按设计在同一帧）：鳞冠收掉、鳞刃在同一位置接上，暗金冲击环 + 暖白金一闪 + 玄铁鳞屑 + 砸地尘环；
    ///   · 鳞刃改成赭金、光晕小一档的 quill 弹体、外观缩一号、不拖尾（原来是金黄 0xffd070 的 shard × 1.8，36 片 2.9 m 长的光晕叠在一起刷成一朵白花）；
    ///     第二圈前鳞冠错开半格再张一次（0.4 s）。
    /// </summary>
    public sealed class ScaleBlades : QilinMove
    {
        public const string MoveId = "scales";
        public const int Count = 36;
        public const float Speed = 21f, StartRadius = 2.2f, Height = 1.2f, BladeRadius = 0.5f, SecondRingAt = 0.85f, SecondDelay = 0.4f;

        public override string Id => MoveId;
        public override string Name => "张鳞";

        /// <summary>累计：射出的圈数、鳞刃数、打中玩家的鳞刃、被挡下 / 撞碎的</summary>
        public int Rings { get; private set; }
        public int BladesFired { get; private set; }
        public int BladeHits { get; private set; }
        /// <summary>本次出招会不会射第二圈</summary>
        public bool TwoRings { get; private set; }

        float fxAcc;

        public ScaleBlades()
        {
            cooldown = 11f;
            recovery = 1.2f;
            weight = 2f;
            firstDelay = 2.5f;
            windup = 1f;
            active = 0.55f;
            recover = 0.7f;
            forms = new[] { QilinDef.XuanForm };
        }

        protected override void Prepare()
        {
            Brain.Halt();
            TwoRings = Brain.PhaseFraction <= SecondRingAt;
        }

        /// <summary>出手：rear 片段砸地那一帧的 hit 事件，没有片段（代理 / 占位体）按前摇时长</summary>
        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnTelegraph()
        {
            var feet = OnFloor(Brain.transform.position);
            WarnCircle(feet, 6.5f, WindupTime);
            Brain.PlayAct("rear", WindupTime, 0.08f);
            Sfx("telegraph", 1f, 0.75f);
            Sfx("boss_roar", 0.8f, 0.9f);
            if (Qilin) Qilin.Crown.Begin(Brain.transform, Count, StartRadius, Height, WindupTime);
            Qilin?.Tell("scales", "火麒麟人立张鳞——躲到玄武岩柱后面！", Hex.Rgb(0xff9a4a));
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            fxAcc += dt;
            if (fxAcc < 0.09f) return;
            fxAcc = 0;
            // 人立时鳞缝里冒暗金火星（点缀，主形是鳞冠）
            var c = Brain.BodyCenter + new Vector3(Rng.Range(-1f, 1f), Rng.Range(0f, 2f), Rng.Range(-1f, 1f));
            Fx.Burst(c, QilinPalette.Gold, 2, 3f, 0.45f, 0.16f, -2f);
        }

        protected override void OnActiveBegin()
        {
            FireRing(0);
            // 第二圈：鳞冠错开半格再张一次，0.4 s 后出手
            if (TwoRings && Qilin) Qilin.Crown.Begin(Brain.transform, Count, StartRadius, Height, SecondDelay, 0.5f);
        }

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            if (TwoRings && StageAt(SecondDelay)) FireRing(0.5f);
        }

        protected override void OnEnd(bool cancelled)
        {
            if (Qilin) Qilin.Crown.Release();
        }

        /// <summary>以脚下为圆心射一圈鳞刃（offsetFrac：起始角偏移，格）</summary>
        void FireRing(float offsetFrac)
        {
            if (Qilin) Qilin.Crown.Release();
            Brain.PlayAct("scalesFire", 0.6f, 0.03f);
            var feet = OnFloor(Brain.transform.position);
            var origin = feet + Vector3.up * Height;
            float range = (Furnace ? Furnace.wallRadius : 24f) * 2.2f;
            float dmg = Dmg(20);
            for (int i = 0; i < Count; i++)
            {
                float yaw = Facing + (i + offsetFrac) * 360f / Count;
                var d = Dir(yaw);
                var push = new Vector3(d.x * 4f, 2f, d.z * 4f);
                EnemyProjectile.Spawn(new EnemyProjectileSpec(origin + d * StartRadius, d * Speed, dmg, BladeRadius, range / Speed)
                {
                    color = QilinPalette.Blade, visual = "quill", scale = 0.85f, element = Element.Fire, source = Brain, blockable = true,
                    // 外观缩一号、不拖尾：原来 shard × 1.8 每片光晕 2.9 m 长，36 片在 2.2 m 圈上连成一圈白色尖瓣（「白花」）；
                    // 判定半径 BladeRadius 不变，只是看起来的鳞刃变成 1.4 m 长的赭金尖片
                    trail = ProjectileTrail.Off,
                    onImpact = (_, hitPlayer) =>
                    {
                        if (!hitPlayer) return;
                        BladeHits++;
                        Push(push);
                    },
                });
                BladesFired++;
            }
            Rings++;
            Fx.QilinScaleRelease(feet, 6.5f);
            if (offsetFrac == 0) Fx.QilinStamp(feet + Brain.transform.forward * 1.6f, 2.4f);
            Brain.Shake(0.35f, 0.3f);
            Sfx("enemy_shot", 1f, 0.55f);
            Sfx("shield_break", 0.6f, 1.4f);
        }
    }
}
