using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 飞廉（4-1 ⑤ 冰川口领主，风伯；chuanzang-combat-v1.md 4.2，设计单 docs/art/vfx/feilian.md，网页版 bosses.ts FeilianBoss）。
    /// 鹿身雀头、鹿角、蛇尾羽扇；鹿角间悬着风雷珠（弱点，程序化的珠 <see cref="FeilianOrb"/>）。只在冰舌顶上活动（擂台 34 m，不下冰崖）。
    ///   风：擂台里一直有风——一二阶段从它那里往外推、三阶段往里吸（F 路 WindField 吸引点 + 顺风 / 逆风 ±25% 步速）。
    ///   一阶段 · 风伯：蓄风狂风（50° 锥 40 m，躲在冰脊 / 巨石后不挨）、低头冲撞（撞上冰脊 / 巨石晕 2 s）、风刃、侧跃；
    ///   二阶段 · 龙卷（66%）：加龙卷风柱（被火打中变火龙卷，被风吸回去烧它）、回旋冲撞；
    ///   三阶段 · 风眼（33%）：风向反过来往里吸；加风雷爆（4 s 蓄力，前摇里打满破防条 = 珠碎打断）。
    ///   破防条 800（网页值，按耐久换算）：「珠碎」侧倒 4 s、风停 6 s，25 s 后珠子重新长出来。
    /// 数值：4-1 难度 3.4 下定档 31500 生命（第 0 档约 72 s、第 2 档约 92 s）。动作：AC_SK_Boss_Feilian（采样 + feilian_anims.py 手 K）。
    /// </summary>
    [Defs(41)]
    public sealed class FeilianDef : LordDef
    {
        public const string Id = "boss_feilian";
        public const string FormId = "feilian";
        public const string PrefabId = "SK_Boss_Feilian", ProxyPrefabId = "SK_Enemy_IronOx";
        public const float TornadoAt = 0.66f, EyeAt = 0.33f;
        public const float TierHp = 31500f, Web = 11000f;
        public const string WeakBone = "orb";

        // ───────────── 运行时层（网页版原值）─────────────

        /// <summary>擂台风：影响半径、满强度半径（米）、吹着人走的速度（m/s，F 路 WindField.PlayerPush；网页 1.6，风雷爆蓄力时 2.6）、顺风 / 逆风步速比例；狂风猛推（m/s）</summary>
        public float windRadius = 42f, windCore = 10f, windPush = 1.6f, stormPush = 2.6f, windSpeedK = 0.25f, gustPush = 9f;
        /// <summary>珠碎：风停几秒、珠子多久重新长出来</summary>
        public float breakWindOff = 6f, orbRegrow = 25f;
        /// <summary>侧跃：2 s 内挨打超过这么多（网页值，按耐久换算）就侧跳</summary>
        public float sidestepDamage = 700f;
        /// <summary>龙卷：寿命、追人速度、火龙卷寿命 / 被吸回去的速度、烧它的间隔 / 伤害（网页值）/ 半径</summary>
        public float tornadoLife = 9f, tornadoSpeed = 3.5f, fireLife = 8f, fireSpeed = 6f, fireTick = 0.5f, fireDamage = 40f, fireRadius = 3.5f;
        /// <summary>冰脊 / 巨石的碰撞体名前缀（M1 摆；低头冲撞撞上就晕）</summary>
        public static readonly string[] ObstaclePrefixes = { "IceRidge", "Boulder" };

        public FeilianDef()
        {
            id = Id;
            name = "飞廉";
            title = "风伯";
            brain = typeof(FeilianBrain);
            webHp = Web;
            vitals = new BossVitals(TierHp / StageDifficulty);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp)));
            damage = 16f;
            speed = 7f;
            element = Element.None;
            color = FeilianPalette.Wind;
            core = FeilianPalette.WindCore;
            edge = FeilianPalette.WindEdge;
            radius = 1.6f;
            height = 5f;
            idleMinRange = 12f;
            idleMaxRange = 18f;
            repeatWeight = 0.35f;

            forms.Add(new BossFormDef
            {
                id = FormId, prefab = PrefabId, scale = 1f, proxyPrefab = ProxyPrefabId, proxyScale = 2f, weakBone = WeakBone, weakRadius = 0.6f,
            });
            phases.Add(new BossPhaseDef { at = TornadoAt, seconds = 3.0f, anim = "tornado", sfx = "boss_roar", shake = 0.4f, toast = "二 · 龙卷", restScale = 0.9f });
            phases.Add(new BossPhaseDef { at = EyeAt, seconds = 2.6f, anim = "roar", sfx = "boss_roar", shake = 0.4f, toast = "三 · 风眼", restScale = 0.75f });

            hitZones.Add(new BossHitZoneDef { id = "chest", bone = "chest", radius = 1.0f });
            hitZones.Add(new BossHitZoneDef { id = "hips", bone = "hips", radius = 0.9f });
            hitZones.Add(new BossHitZoneDef { id = "neck", bone = "neck", radius = 0.5f });
            hitZones.Add(new BossHitZoneDef { id = "head", bone = "head", radius = 0.45f, multiplier = 1.5f, priority = 2 });

            breakBar = new BreakBarDef { max = 800f * TierHp / Web, seconds = 4f, pose = "down", label = "珠碎", takenMult = 1.3f };

            moves.Add(() => new FeilianGust());
            moves.Add(() => new FeilianCharge());
            moves.Add(() => new FeilianWheel());
            moves.Add(() => new FeilianBlades());
            moves.Add(() => new FeilianSidestep());
            moves.Add(() => new FeilianTornadoMove());
            moves.Add(() => new FeilianStormBurst());

            intro.seconds = 5.4f;
            intro.anim = "sidestep";
            intro.sfx = null;
            intro.shake = 0f;
            intro.firstRest = 0.8f;

            deathAnim = "down";
            death.name = "飞廉 · 风止";
            death.cardTitle = "飞廉 · 风止";
            death.cardSub = "盆地的风停了";
            death.epithet = "4-1 · 冰川口";
            death.radius = 14f;
            death.height = 5f;
            death.lookHeight = 2f;
            death.orbitFrom = -0.4f;
            death.orbitTo = 0.8f;
        }
    }
}
