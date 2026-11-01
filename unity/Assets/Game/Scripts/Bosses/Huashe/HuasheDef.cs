using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 化蛇（4-1 ④ 圣湖海子领主；chuanzang-combat-v1.md 4.3，设计单 docs/art/vfx/huashe.md，网页版 bosses.ts HuasheBoss）。
    /// 《中山经》「人面豺身、鸟翼蛇行，其音如叱呼，见则其邑大水」。在湖里绕湖心岛游，弱点是嘴（只在张嘴时露出来：吐水、扑咬、吼叫、潜游扑出、噎住）。
    ///   水：在水里时湿身——灼烧时长减半、雷殛 +50%；玩家自己站在 6 m 内的水里打出雷殛会电到自己（5，网页值）。
    ///   一阶段 · 游：吐水弹、扑岸（搁浅 1.2 s 是最大的窗口）、翼拍浪（1 m 高的浪推到 30 m，跳过）；
    ///   二阶段 · 涨水（66%）：湖水常驻 +1.2 m，岸边低处被淹（泡在水里每秒 2）；加吼叫涨水（再 +0.8 m，6 s 后退）、潜游突袭；
    ///   三阶段 · 大水（33%）：湖水打漩，泡在水里往湖心拉；加尾扫，吼叫更勤。
    ///   破防条 700（只在张嘴时填）：「噎住」翻肚子浮在水面 4 s、打断涨水。
    /// 数值：4-1 难度 3.4 下定档 30000 生命（第 0 档约 69 s、第 2 档约 88 s）。动作：AC_SK_Boss_Huashe（采样 + huashe_anims.py 手 K）。
    /// 导航：化蛇在水里游，位置全由代码驱动（不走导航网格）。
    /// </summary>
    [Defs(42)]
    public sealed class HuasheDef : LordDef
    {
        public const string Id = "boss_huashe";
        public const string FormId = "huashe";
        public const string PrefabId = "SK_Boss_Huashe", ProxyPrefabId = "SK_Enemy_IceWhale";
        public const float FloodAt = 0.66f, DelugeAt = 0.33f;
        public const float TierHp = 30000f, Web = 10500f;
        public const string MouthBone = "mouth";

        // ───────────── 运行时层（网页值）─────────────

        /// <summary>常驻涨水（二阶段，米）、吼叫涨水（米）与停留秒数、退水速度（米 / 秒）</summary>
        public float flood = 1.2f, surge = 0.8f, surgeHold = 6f, surgeFall = 0.3f;
        /// <summary>泡在涨水里每秒的伤害（网页值）、三阶段往湖心拉的速度（m/s，网页 1.6）</summary>
        public float soakDamage = 2f, whirlPull = 1.6f;
        /// <summary>湿身：灼烧时长倍率、雷殛倍率；玩家在 selfShockRange 米内的水里打雷殛电到自己（网页值）</summary>
        public float wetBurn = 0.5f, wetShock = 1.5f, selfShockRange = 6f, selfShockDamage = 5f;
        /// <summary>游速（弧度 / 秒，朝玩家那一侧的湖岸）</summary>
        public float swimRate = 0.35f;

        public HuasheDef()
        {
            id = Id;
            name = "化蛇";
            title = "人面豺身 · 鸟翼蛇行";
            brain = typeof(HuasheBrain);
            webHp = Web;
            vitals = new BossVitals(TierHp / StageDifficulty);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp)));
            damage = 16f;
            speed = 6f;
            element = Element.None;
            color = HuashePalette.Water;
            core = HuashePalette.Foam;
            edge = HuashePalette.Deep;
            radius = 1.6f;
            height = 3.2f;
            repeatWeight = 0.35f;

            forms.Add(new BossFormDef
            {
                id = FormId, prefab = PrefabId, scale = 1f, proxyPrefab = ProxyPrefabId, proxyScale = 1f, weakBone = MouthBone, weakRadius = 0.5f, flying = true,
            });
            phases.Add(new BossPhaseDef { at = FloodAt, seconds = 3.2f, anim = "roar", sfx = "boss_roar", shake = 0.4f, toast = "二 · 涨水", restScale = 0.9f });
            phases.Add(new BossPhaseDef { at = DelugeAt, seconds = 2.6f, anim = "roar", sfx = "boss_roar", shake = 0.4f, toast = "三 · 大水", restScale = 0.75f });

            hitZones.Add(new BossHitZoneDef { id = "chest", bone = "chest", radius = 1.1f });
            hitZones.Add(new BossHitZoneDef { id = "head", bone = "head", radius = 0.7f, multiplier = 1.6f, priority = 2 });
            hitZones.Add(new BossHitZoneDef { id = "spine", bone = "spine2", radius = 1.0f });
            hitZones.Add(new BossHitZoneDef { id = "hips", bone = "hips", radius = 0.9f });
            hitZones.Add(new BossHitZoneDef { id = "tail", bone = "tail_3", radius = 0.6f });

            breakBar = new BreakBarDef
            {
                max = 700f * TierHp / Web, seconds = 4f, pose = "choke", label = "噎住", takenMult = 1.3f,
                fillWhen = b => b is HuasheBrain h && h.MouthOpen,
            };

            moves.Add(() => new HuasheSpit());
            moves.Add(() => new HuasheLunge());
            moves.Add(() => new HuasheDive());
            moves.Add(() => new HuasheWingSlap());
            moves.Add(() => new HuasheRoar());
            moves.Add(() => new HuasheTailSweep());

            intro.seconds = 5.6f;
            intro.anim = null;
            intro.sfx = null;
            intro.shake = 0f;
            intro.firstRest = 0.8f;

            deathAnim = "choke";
            death.name = "化蛇 · 水退";
            death.cardTitle = "化蛇 · 水退";
            death.cardSub = "湖面平了";
            death.epithet = "4-1 · 圣湖海子";
            death.radius = 16f;
            death.height = 6f;
            death.lookHeight = 1f;
            death.orbitFrom = -0.3f;
            death.orbitTo = 0.7f;
        }
    }
}
