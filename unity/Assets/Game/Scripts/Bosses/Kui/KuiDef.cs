using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 夔（4-1 ⑥ 经幡山头领主；chuanzang-combat-v1.md 4.1，设计单 docs/art/vfx/kui.md，网页版 src/world/plateau/play/bosses.ts KuiBoss）。
    /// 一足巨兽，皮早被做成了鼓：胸口一面残破的雷鼓（鼓心是弱点）。只在雷暴里现身——擂台中心是拉则，经幡杆一圈在 14–23 m（都是导体）。
    ///   一阶段 · 一足：小跳、大跳（鼓皮冲击环 16 m，跳起来躲）、转身跳、拄拳、雷掌；
    ///   二阶段 · 雷鼓（66%）：召鼓——跳上拉则旁、两只连鼓灵护驾、经幡杆通电；加捶胸引雷（每捶一下两道雷，落点 5 m 内有经幡杆就劈杆）；
    ///   三阶段 · 风雨（33%）：擂台外圈落雷越来越密；连环大跳、捶胸五下、收招变短。
    ///   场地：大跳落在带电的经幡杆 4.5 m 内被回劈（硬直 1.5 s + 200 + 破防条）；登场从残鼓里长出来、死时倒回残鼓。
    ///   破防条 900（网页值，按耐久比例换算）：「破鼓」单膝跪地 4 s。
    /// 数值：4-1 难度 3.4 下定档 34400 生命（I3 参考秒伤 × 1.1 的弱点加成，第 0 档约 78 s、第 2 档约 100 s，KuiTests 守着 60–120 s）。
    /// 动作：AC_SK_Boss_Kui（采样打底 + kui_anims.py 手 K），招式状态名 = ch4-move-events.json 的招式 id；死亡倒回残鼓是新状态 sink。
    /// </summary>
    [Defs(40)]
    public sealed class KuiDef : LordDef
    {
        public const string Id = "boss_kui";
        public const string FormId = "kui";
        public const string PrefabId = "SK_Boss_Kui", ProxyPrefabId = "SK_Enemy_IronOx", DrumPrefabId = "SM_Prop_KuiBrokenDrum";
        /// <summary>阶段阈值（生命层比例）</summary>
        public const float DrumsAt = 0.66f, StormAt = 0.33f;
        /// <summary>4-1 难度下的定档、网页版血量</summary>
        public const float TierHp = 34400f, Web = 12000f;
        /// <summary>弱点：胸口鼓心（drum_core 骨，离地约 3.4 m）</summary>
        public const string WeakBone = "drum_core";

        // ───────────── 运行时层（网页版 bosses.ts 原值）─────────────

        /// <summary>走到残鼓多近开打（米，BossEncounter 的门槛由 M1 摆，这里给测试场 / 兜底用）</summary>
        public float triggerRadius = 22f;
        /// <summary>捶胸：每隔几招捶一次（二 / 三阶段）</summary>
        public int drumEvery = 5, drumEvery3 = 4;
        /// <summary>大跳：每几次小跳接一次；超过这么远直接大跳（米）</summary>
        public int leapEvery = 4;
        public float leapBeyond = 16f;
        /// <summary>三阶段外圈落雷：间隔（秒）、离擂台中心的距离带（米）、预警、半径、伤害（网页值）</summary>
        public float ringEvery = 1.2f;
        public Vector2 ringBand = new(20f, 32f);
        public float ringWarn = 1.2f, ringRadius = 3.5f, ringDamage = 16f;
        /// <summary>经幡杆回劈：落点离带电杆多近（米）、硬直秒数、伤害 / 破防条（网页值，按耐久比例换算）</summary>
        public float backlashRadius = 4.5f, backlashStun = 1.5f, backlashDamage = 200f, backlashBreak = 150f;
        /// <summary>召鼓：连鼓灵的敌人 id、只数；经幡杆一齐通电的电量（导体每秒掉 0.1：网页 3 秒，这里 0.5 ≈ 5 秒，转阶段演出放完还剩 2 秒多能用）</summary>
        public string lianguId = "liangu";
        public int lianguCount = 2;
        public float drumsPoleCharge = 0.5f;
        /// <summary>捶胸时鼓心的倍率（网页 3.5，平时 2.5：弱点区的倍率乘 1.4）</summary>
        public float drumOpenMult = 1.4f;

        public static readonly Color Thunder = KuiPalette.Thunder, Skin = KuiPalette.Skin;

        public KuiDef()
        {
            id = Id;
            name = "夔";
            title = "一足之雷";
            brain = typeof(KuiBrain);
            webHp = Web;
            // 难度 1 的参考值 = 定档 ÷ 3.4（定档表优先）
            vitals = new BossVitals(TierHp / StageDifficulty);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp)));
            damage = 16f;
            speed = 2.5f;
            element = Element.Shock;
            color = Thunder;
            core = KuiPalette.ThunderCore;
            edge = KuiPalette.ThunderEdge;
            radius = 2.5f;
            height = 6f;
            idleMinRange = 6f;
            idleMaxRange = 16f;

            forms.Add(new BossFormDef
            {
                id = FormId, prefab = PrefabId, scale = 1f, proxyPrefab = ProxyPrefabId, proxyScale = 2.4f, weakBone = WeakBone, weakRadius = 0.75f,
            });
            phases.Add(new BossPhaseDef { at = DrumsAt, seconds = 3.2f, anim = "roar", sfx = "boss_roar", shake = 0.5f, toast = "二 · 雷鼓", restScale = 0.9f });
            phases.Add(new BossPhaseDef { at = StormAt, seconds = 2.6f, anim = "drum", sfx = "boss_roar", shake = 0.45f, toast = "三 · 风雨", restScale = 0.75f });

            // 受击球（网页版 KuiBoss 的 sphereSpec，挂骨骼原点）
            hitZones.Add(new BossHitZoneDef { id = "chest", bone = "chest", radius = 1.5f });
            hitZones.Add(new BossHitZoneDef { id = "hips", bone = "hips", radius = 1.0f });
            hitZones.Add(new BossHitZoneDef { id = "head", bone = "head", radius = 0.7f, multiplier = 1.5f, priority = 2 });
            hitZones.Add(new BossHitZoneDef { id = "shin", bone = "shin", radius = 0.5f });

            breakBar = new BreakBarDef { max = 900f * TierHp / Web, seconds = 4f, pose = "kneel", label = "破鼓", takenMult = 1.3f };

            moves.Add(() => new KuiHop());
            moves.Add(() => new KuiLeap());
            moves.Add(() => new KuiLeapChain());
            moves.Add(() => new KuiTurnLeap());
            moves.Add(() => new KuiKnuckle());
            moves.Add(() => new KuiClap());
            moves.Add(() => new KuiChestDrum());
            moves.Add(() => new KuiChestDrum5());

            intro.seconds = 4.3f;
            intro.anim = "rise";
            intro.sfx = "boss_roar";
            intro.shake = 0f;
            intro.firstRest = 0.8f;

            deathAnim = "sink";
            death.name = "夔 · 雷息";
            death.cardTitle = "夔 · 平息";
            death.cardSub = "雷暴退去";
            death.epithet = "4-1 · 经幡山头";
            death.radius = 13f;
            death.height = 4f;
            death.lookHeight = 3f;
            death.orbitFrom = -0.3f;
            death.orbitTo = 0.9f;
        }
    }
}
