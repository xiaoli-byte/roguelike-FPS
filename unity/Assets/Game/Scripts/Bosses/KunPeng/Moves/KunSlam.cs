using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 猛砸冰浪（Three.js KunPeng.ts 'slam'，2.5 s）：
    ///   前摇 1.1 s：人立蓄力（act_slamWind，slam 片段接在后面），落点 5 m 圆形预警 + 冰浪扇形（26 m、半角 31.5°）；鲲怒时两侧再各一道窄扇（± 43°、半角 17°、18 m）；
    ///   出手 0.85 s（1.1–1.95）：整个前身砸在环台上（hit 事件）——落点重击（30，击退 9 / 上抛 7），掀起一道沿扇形扩散的贴地冰浪（20，跳起躲开、掩体挡得住）；
    ///     鲲怒时两侧两道（16）、0.45 s 后再补一道（wave2 事件，18 m/s）。头趴在环台上的这 0.85 s 额头鲛珠离地最近、大亮，是一阶段最好的输出窗口；
    ///   收招 0.55 s：抬头收回。
    /// 冰浪对刚被落点重击打中的玩家不再伤害（BossWaveSpec.spare：不连吃两段）。
    /// </summary>
    public sealed class KunSlam : KunPengMove
    {
        public const string MoveId = "slam";
        public const float BlastRadius = 5f, WaveRange = 28f, WaveHalf = 31.5f, SideYaw = 43f, SideHalf = 17.2f, SideRange = 18f, Wave2At = 0.45f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 猛砸冰浪";

        /// <summary>本次的落点、朝向、是否鲲怒、放出的冰浪道数、落点重击打中没有</summary>
        public Vector3 Impact { get; private set; }
        public float Yaw { get; private set; }
        public bool Fury { get; private set; }
        public int Waves { get; private set; }
        public bool BlastHit { get; private set; }

        bool wave2;

        public KunSlam()
        {
            forms = new[] { KunPengDef.KunForm };
            cooldown = 7f;
            recovery = 1.1f;
            firstDelay = 0.5f;
            weight = 2.6f;
            windup = 1.1f;
            active = 0.85f;
            recover = 0.55f;
        }

        protected override void OnStart()
        {
            if (KP) KP.AimKunAtPlayer(0.9f);
            Yaw = Brain.transform.eulerAngles.y;
            float reach = (KDef != null ? KDef.kunInset : 4.6f) + 3.2f;
            Impact = AtFloor(Brain.transform.position + Dir(Yaw) * reach);
            Fury = KP && KP.KunFury;
            Waves = 0;
            BlastHit = wave2 = false;
        }

        protected override void OnTelegraph()
        {
            WarnCircle(Impact, BlastRadius, WindupTime);
            Hazards.SectorWarning(Impact, Yaw, WaveHalf, WaveRange, WindupTime, KunPengDef.Warn);
            CountWarning();
            if (Fury)
                foreach (float s in new[] { -1f, 1f })
                {
                    Hazards.SectorWarning(Impact, Yaw + SideYaw * s, SideHalf, SideRange, WindupTime, KunPengDef.Warn);
                    CountWarning();
                }
            Act("slamWind", WindupTime);
            CuedSfx("boss_roar", 0.8f, 0.8f);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnWindup(float dt) => KP?.PlaceKun();

        protected override void OnActiveBegin()
        {
            if (KP) KP.PearlBright = true;
            int hits0 = Hazards.PlayerHits;
            Hazards.Blast(Impact, BlastRadius, Dmg(30), new BossBlastOpts { maxHeight = 3f, knockback = 9f, knockUp = 7f });
            BlastHit = Hazards.PlayerHits > hits0;
            Wave(Yaw, WaveHalf, 15f, WaveRange, Dmg(20), 1.2f, 9f);
            if (Fury)
                foreach (float s in new[] { -1f, 1f })
                    Wave(Yaw + SideYaw * s, SideHalf, 13f, SideRange, Dmg(16), 1.1f, 8f);
            Fx.Explosion(Impact + Vector3.up * 0.6f, 4.5f, KunPengDef.Ice);
            Fx.Burst(Impact + Vector3.up * 0.6f, KunPengDef.Ice, 40, 11f, 1f, 0.45f, 16f);
            Fx.Ring(Impact + Vector3.up * 0.1f, 9f, KunPengDef.Warn, 0.7f);
            Brain.Shake(0.7f, 0.5f);
            CuedSfx("boss_slam");
            Sfx("explosion", 0.8f, 0.7f);
        }

        protected override void OnActive(float dt)
        {
            KP?.PlaceKun();
            if (!Fury || wave2 || !Cue("wave2", WindupTime + Wave2At)) return;
            wave2 = true;
            Wave(Yaw, WaveHalf, 18f, WaveRange, Dmg(16), 1.1f, 8f);
            Sfx("boss_slam", 0.6f, 1.3f);
        }

        void Wave(float yaw, float half, float speed, float range, float dmg, float width, float knock)
        {
            Hazards.Wave(new BossWaveSpec(Impact, speed, range, dmg, KunPengDef.Warn)
            {
                startRadius = 2.5f, width = width, height = 0.9f, arcYaw = yaw, arcHalf = half, knockback = knock, dust = true, dustColor = KunPengDef.Ice, spare = BlastHit,
            });
            Waves++;
        }

        protected override void OnRecoverBegin()
        {
            if (KP) KP.PearlBright = false;
        }

        protected override void OnRecover(float dt) => KP?.PlaceKun();

        protected override void OnEnd(bool cancelled)
        {
            if (KP) KP.PearlBright = false;
        }
    }
}
