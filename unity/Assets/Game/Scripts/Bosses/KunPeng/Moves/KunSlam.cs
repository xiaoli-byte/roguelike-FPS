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
    /// 动作 / 特效（K 路，docs/art/vfx/kunpeng.md 第 1 节）：slamWind / slam 是手 K 片段——往后一抽 → 人立（脊椎后弯、仰头、鳍张开）→ 顶点颤一下（apex）
    /// → 4 帧下砸拖影 → slam 第 1 帧 hit：头砸上环台（释放帧，顿帧 0.08 s）→ 趴着 0.85 s → 撑起（pushOff）。
    /// 起手身上泻水、身下水退（<see cref="Fx.KunRear"/>），前摇里落点的冰屑往回收（<see cref="Fx.KunSlamGather"/>），顶点一记冰晶星；
    /// 释放帧 = 「水击三千里」：冰晶星 + 水冠 + 冰板扇（<see cref="Fx.KunSlamImpact"/>）+ 双层浪墙和浪头白沫（<see cref="Fx.KunWave"/>）。
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

        bool wave2, apexed, pushed;
        /// <summary>蓄力顶点在前摇里的时刻（slamWind 第 19 帧 / 33 帧 × 前摇；没有 apex 事件时按它兜底）</summary>
        const float ApexAt = 19f / 33f;

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
            BlastHit = wave2 = apexed = pushed = false;
        }

        public override void OnAnimEvent(string name)
        {
            base.OnAnimEvent(name);
            if (name == "apex") Apex();
            else if (name == "pushOff") PushOff();
        }

        void Apex()
        {
            if (apexed || Stage != MoveStage.Windup) return;
            apexed = true;
            Fx.KunSlamApex(Impact, BlastRadius);
        }

        /// <summary>撑起：头离开台面带起一圈水帘、冰屑往下掉</summary>
        void PushOff()
        {
            if (pushed) return;
            pushed = true;
            Surge.Crown(Impact, 1.6f, 1.6f, SurgeKind.Water, 0.55f, Fx.KunWater, Fx.KunFoam, 0.9f);
            Fx.FrostShatter(Impact + Vector3.up * 0.8f, 1.2f);
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
            if (KP) Fx.KunRear(Brain.Model?.root, KP.WaterUnderKun, WindupTime);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnWindup(float dt)
        {
            KP?.PlaceKun();
            Fx.KunSlamGather(Impact, BlastRadius, StageT / Mathf.Max(0.1f, WindupTime), dt);
            if (!apexed && StageT >= WindupTime * ApexAt + 0.05f) Apex();
        }

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
            // 释放帧（水击三千里）：冰晶星 + 爆闪 + 冷光、北冥水冠、冰板扇、贴地冲击环、霜斑；冰刺环；浪墙在 Wave 里。顿帧和震屏同一帧
            Fx.KunSlamImpact(Impact, Yaw, WaveHalf);
            Fx.IceRing(Impact, 4.5f, 14);
            KP?.ImpactHold(0.08f);
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
            // 北冥浪墙：前沿一堵翻白沫的浪头 + 后面低一层的深青浪身，和冲击波前沿同速往外推，浪头一路翻白沫、甩碎冰
            Fx.KunWave(Impact, yaw, half * 2f, 2.5f, range, speed, half > 20f ? 2.6f : 2f);
        }

        protected override void OnRecoverBegin()
        {
            if (KP) KP.PearlBright = false;
        }

        protected override void OnRecover(float dt)
        {
            KP?.PlaceKun();
            // 撑起兜底（片段第 29 帧 = 收招 0.12 s；代理没有 pushOff 事件）
            if (!pushed && StageT >= 0.15f) PushOff();
        }

        protected override void OnEnd(bool cancelled)
        {
            if (KP) KP.PearlBright = false;
        }
    }
}
