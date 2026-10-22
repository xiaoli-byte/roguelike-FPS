using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 张鳞（TS Qilin 'scales'）：
    ///   前摇 1 s 人立（全身鳞缝喷火星、火珠大亮、脚下 6.5 m 预警圈）→ 360° 射出一圈 36 片红热鳞刃（离地 1.2 m 的竖薄片，21 m/s，飞到殿墙两倍远）；
    ///   生命 85% 以下 0.4 s 后再射一圈，错开半格（两圈之间没有缝可钻）。
    ///   鳞刃是敌方投射物：撞到石柱 / 墙就碎（世界层挡得住）——躲到玄武岩柱后面；打中玩家 20（火）并往外推一下。
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

        protected override void OnTelegraph()
        {
            var feet = OnFloor(Brain.transform.position);
            WarnCircle(feet, 6.5f, WindupTime);
            Brain.PlayAct("rear", WindupTime);
            Fx.Ring(feet + Vector3.up * 0.1f, 24f, QilinDef.Warn, WindupTime);
            Sfx("telegraph", 1f, 0.75f);
            Sfx("boss_roar", 0.8f, 0.9f);
            Qilin?.Tell("scales", "火麒麟人立张鳞——躲到玄武岩柱后面！", Hex.Rgb(0xff9a4a));
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            fxAcc += dt;
            if (fxAcc < 0.05f) return;
            fxAcc = 0;
            // 人立时鳞缝喷火星
            var c = Brain.BodyCenter + new Vector3(Rng.Range(-1f, 1f), Rng.Range(0f, 2f), Rng.Range(-1f, 1f));
            Fx.Burst(c, QilinDef.Ember, 3, 4f, 0.5f, 0.18f, -2f);
        }

        protected override void OnActiveBegin() => FireRing(0);

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            if (TwoRings && StageAt(SecondDelay)) FireRing(0.5f);
        }

        /// <summary>以脚下为圆心射一圈鳞刃（offsetFrac：起始角偏移，格）</summary>
        void FireRing(float offsetFrac)
        {
            Brain.PlayAct("scalesFire", 0.6f);
            var origin = OnFloor(Brain.transform.position) + Vector3.up * Height;
            float range = (Furnace ? Furnace.wallRadius : 24f) * 2.2f;
            float dmg = Dmg(20);
            for (int i = 0; i < Count; i++)
            {
                float yaw = Facing + (i + offsetFrac) * 360f / Count;
                var d = Dir(yaw);
                var push = new Vector3(d.x * 4f, 2f, d.z * 4f);
                EnemyProjectile.Spawn(new EnemyProjectileSpec(origin + d * StartRadius, d * Speed, dmg, BladeRadius, range / Speed)
                {
                    color = QilinDef.Hot, visual = "shard", scale = 1.8f, element = Element.Fire, source = Brain, blockable = true,
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
            Fx.Burst(origin + Vector3.up * 1.8f, QilinDef.Ember, 30, 10f, 0.6f, 0.3f, 6f);
            Brain.Shake(0.35f, 0.3f);
            Sfx("enemy_shot", 1f, 0.55f);
            Sfx("shield_break", 0.6f, 1.4f);
        }
    }
}
