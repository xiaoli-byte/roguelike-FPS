using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将（3-3 铸范大坊终点的领主战，D5；Three.js src/enemies/bosses/Warlord.ts；docs/level-design/maps/3-3.md 第 6 节）。
    /// 熔火深渊的统帅：一身玄铁甲、角盔、一柄焰刃；模型是 E5 的部件骨架（SK_Boss_Warlord，18 段采样片段 + act_ 触发器，受击 / 倒下片段等 ART8），
    /// 美术缺失时用熔炉铁牛 × 1.6 当代理（4.11）。
    ///   招式（Three.js 原值，B1 已移植成参考招式 <see cref="WarlordCharge"/> 等，这里直接装上；动作由 <see cref="WarlordBrain"/> 按招式时间轴触发）：
    ///     烈焰冲锋（沿途留火、撞墙硬直，二阶段起连冲两次）、扇形火焰横扫（二阶段反手再扫 + 火弹）、陨石雨（10 / 14 / 20 颗，二阶段起落点留火）、
    ///     跃击（落点重击 + 冲击波，二阶段起落点燃火）、焰刃连斩（贴身 3 / 三阶段 4 斩）、
    ///     熔铜渠涨落（<see cref="WarlordChannelSurge"/>，替代 TS 的方场熔岩涌动：神范台的十字浅渠和熔池漫上渠岸，<see cref="FoundryChannels"/>）。
    ///   阶段（D23：血条刻度就是这两道阈值）：50% 引动熔铜渠（转换后第一招就是涨落）；20% 狂怒——喘息 / 前摇缩短、陨石冷却 7 s、战斗中持续落零星陨石、连斩 4 斩。
    ///   弱点：角盔（部件骨架的 j_0_1_24_8 锚点，半径 0.45 m）；另有肩甲、膝甲两组命中区（TS hitShapes）。
    ///   数值：3-3 的难度 2.92 下定档 18000 生命 + 4600 护盾 + 5000 护甲（I3 按首领浸泡实测秒伤重定：BS6 的 9000 / 2300 / 2500 是按「约 200 秒伤」估的，
    ///     代表配装实测可选中时约 435 秒伤，36 s 就倒下；翻倍后浸泡估算约 85 s，<see cref="WarlordBalance"/> 约 90 s，EditMode 测试 WarlordBalanceTests 守着 60–120 s。
    ///     TS 原值 4000 / 1000 / 1100 × 难度在实测秒伤下不到 60 s）。
    /// </summary>
    [Defs(13)]
    public sealed class WarlordDef : BossDef
    {
        public const string Id = "boss_warlord";
        public const string FormId = "warlord";
        public const string PrefabId = "SK_Boss_Warlord", ProxyPrefabId = "SK_Enemy_IronOx";
        /// <summary>阶段阈值（生命层比例）：引动熔铜渠、狂怒</summary>
        public const float ChannelsAt = 0.5f, FuryAt = 0.2f;
        /// <summary>3-3 的难度（RunPlan：1 + 0.8 × 2 + 0.16 × 2）</summary>
        public const float StageDifficulty = 2.92f;
        /// <summary>3-3 难度下的定档（I3，见类注释）</summary>
        public const float TierHp = 18000f, TierShield = 4600f, TierArmor = 5000f;
        /// <summary>部件骨架的弱点锚点（角盔）与头骨</summary>
        public const string WeakBone = "j_0_1_24_8", HeadBone = "j_0_1_24";

        // ───────────── 运行时层 ─────────────

        /// <summary>登场：从多高砸下来（米）、下落占登场时长的比例、吼叫时刻（比例）</summary>
        public float dropHeight = 34f, dropFraction = 0.4f, roarAt = 0.7f;
        /// <summary>狂怒的零星陨石：间隔（秒）、落在玩家周围的距离带（米）</summary>
        public float ambientMeteorEvery = 2.4f;
        public Vector2 ambientMeteorRange = new(1.5f, 6f);
        /// <summary>狂怒后陨石雨的冷却（秒，TS 7）</summary>
        public float furyMeteorCooldown = 7f;
        /// <summary>熔铜渠涨落：高位停多久（秒，一阶段被强制出招时 / 二阶段 / 三阶段）</summary>
        public readonly float[] surgeHold = { 6f, 6f, 8f };

        public static readonly Color Fire = Hex.Rgb(0xff6a1f), Embers = Hex.Rgb(0xffa040), Warn = Hex.Rgb(0xff4a1a), Rage = Hex.Rgb(0xff3010);

        public WarlordDef()
        {
            id = Id;
            name = "熔心魔将";
            title = "熔火深渊的统帅";
            brain = typeof(WarlordBrain);
            // 难度 1 的参考值 = 定档 ÷ 2.92（定档表优先，见 VitalsAt）
            vitals = new BossVitals(6160, 1580, 1710);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp, TierShield, TierArmor)));
            damage = 24f;
            speed = 4.6f;
            element = Element.Fire;
            color = Hex.Rgb(0xff5a1f);
            warnColor = Warn;
            radius = 1.3f;
            height = 3.6f;
            idleMinRange = 5f;
            idleMaxRange = 9f;
            repeatWeight = 0.2f;

            forms.Add(new BossFormDef
            {
                id = FormId, name = null, prefab = PrefabId, scale = 1f, proxyPrefab = ProxyPrefabId, proxyScale = 1.6f,
                weakBone = WeakBone, weakRadius = 0.45f,
            });
            // TS hitShapes：肩甲、膝甲（胸、髋在角色胶囊里）
            hitZones.Add(new BossHitZoneDef { id = "pauldron_l", bone = "j_0_1_13", radius = 0.46f });
            hitZones.Add(new BossHitZoneDef { id = "pauldron_r", bone = "j_0_1_18", radius = 0.46f });
            hitZones.Add(new BossHitZoneDef { id = "knee_l", bone = "j_0_0_11_1", radius = 0.3f, height = 1.44f });
            hitZones.Add(new BossHitZoneDef { id = "knee_r", bone = "j_0_0_12_1", radius = 0.3f, height = 1.44f });

            phases.Add(new BossPhaseDef
            {
                at = ChannelsAt, seconds = 2.2f, anim = "roar", sfx = "boss_roar", shake = 0.5f, toast = "熔心魔将引动了熔铜渠！", restScale = 0.8f,
                firstMove = WarlordChannelSurge.MoveId,
            });
            phases.Add(new BossPhaseDef
            {
                // 狂怒的提示由 enrageToast 打（生命层跌破 20% 立刻狂怒，转换演出等当前招式收尾）
                at = FuryAt, seconds = 2.2f, anim = "roar", sfx = "boss_roar", shake = 0.6f, toast = null, restScale = 0.85f, firstMove = "warlord_meteor",
            });

            // B1 的参考招式（TS 原值，见 Reference/WarlordMoves.cs）；它们的前摇动作名是参考样机的，这里清掉，动作由 WarlordBrain 按时间轴触发
            moves.Add(() => new WarlordCharge { windupAnim = null });
            moves.Add(() => new WarlordSweep { windupAnim = null });
            moves.Add(() => new WarlordMeteor { windupAnim = null });
            moves.Add(() => new WarlordLeap { windupAnim = null });
            moves.Add(() => new WarlordCombo { windupAnim = null });
            moves.Add(() => new WarlordChannelSurge());

            summonCap = 0;
            enrageAfter = 0;
            enrageBelow = FuryAt;
            // 20% 狂怒（TS 三阶段 restFactor 0.6）：阶段 0.85 × 狂怒 0.7 ≈ 0.6
            enrageRestScale = 0.7f;
            enrageWindupScale = 0.9f;
            enrageDamageScale = 1.1f;
            enrageToast = "熔心魔将陷入狂怒——陨石将更加频繁！";
            intro.seconds = 2.6f;
            intro.anim = null;
            intro.sfx = null;
            intro.shake = 0f;
            intro.banner = true;
            intro.firstRest = 1f;
            defeat.seconds = 3.2f;
            defeat.toast = "熔心魔将伏诛——熔铜渠归于平静";
        }

        /// <summary>某个阶段熔铜渠高位停多久（越界取两端）</summary>
        public float SurgeHoldAt(int phase) => surgeHold.Length == 0 ? 6f : surgeHold[Mathf.Clamp(phase, 0, surgeHold.Length - 1)];
    }
}
