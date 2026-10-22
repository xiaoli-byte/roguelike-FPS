using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 吐冰（Three.js KunPeng.ts 'spit'，1.3 s）：只在玩家离得远（&gt; 12 m）时出。
    ///   前摇 0.7 s：扬头蓄力（act_spit，projectile 事件），一路转头盯着玩家；
    ///   出手：朝玩家 0.6 s 后的位置和两侧（± 3.2 m，鲲怒时再加一块 6.2 m）各吐一块抛物线冰弹（1.15 s 落地、拱高 7 m、落点 2.6 m、16 伤），
    ///     落点都有预警，都夹在环台上（冰窟外 1 m、外缘内 1.5 m）；
    ///   收招 0.5 s。
    /// </summary>
    public sealed class KunSpit : KunPengMove
    {
        public const string MoveId = "spit";
        public const float MinRange = 12f, Lead = 0.6f, Flight = 1.15f, Arc = 7f, Radius = 2.6f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 吐冰";

        /// <summary>本次吐了几块；累计</summary>
        public int Lobs { get; private set; }
        public int TotalLobs { get; private set; }

        public KunSpit()
        {
            forms = new[] { KunPengDef.KunForm };
            cooldown = 5f;
            recovery = 0.9f;
            firstDelay = 3f;
            weight = 1.6f;
            windup = 0.7f;
            active = 0.1f;
            recover = 0.5f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > MinRange ? weight : 0;

        protected override void OnStart()
        {
            Lobs = 0;
            Act("spit", WindupTime + active + recover);
            CuedSfx("enemy_charge", 1f, 0.7f);
        }

        protected override void OnWindup(float dt)
        {
            if (!KP) return;
            KP.TurnKunToward(69f, dt);
            KP.PlaceKun();
        }

        protected override bool WindupDone => Cue("projectile", WindupTime);

        protected override void OnActiveBegin()
        {
            var from = KP ? KP.Muzzle : Brain.BodyCenter + Vector3.up * 2f;
            int n = KP && KP.KunFury ? 4 : 3;
            var aim = AtFloor(Brain.Predict(Lead));
            var to = aim - Brain.transform.position;
            to.y = 0;
            float yaw = to.sqrMagnitude > 1e-4f ? KunPengMath.Yaw(to) : Brain.transform.eulerAngles.y;
            var side = Dir(yaw + 90f);
            for (int i = 0; i < n; i++)
            {
                float s = i == 0 ? 0 : (i % 2 == 1 ? 1 : -1) * (3.2f + Mathf.Floor((i - 1) / 2f) * 3f);
                var target = aim + side * s;
                if (Hole.found) target = Hole.ClampToRing(target);
                Hazards.Lob(new BossLobSpec(from, target, Flight, Arc, Radius, Dmg(16), KunPengDef.Warn, LobKind.Ice) { scale = 1.4f });
                CountWarning();
                Lobs++;
                TotalLobs++;
            }
            Sfx("enemy_shot", 0.9f, 0.6f);
        }

        protected override void OnActive(float dt) => KP?.PlaceKun();
        protected override void OnRecover(float dt) => KP?.PlaceKun();
    }
}
