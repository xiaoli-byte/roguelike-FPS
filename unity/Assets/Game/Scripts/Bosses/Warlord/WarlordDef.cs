using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将（3-3 铸范大坊终点的领主战，D5；Three.js src/enemies/bosses/Warlord.ts；docs/level-design/maps/3-3.md 第 6 节）。
    /// 熔火深渊的统帅：一身玄铁甲、角盔、一柄焰刃；模型是 E5 的部件骨架（SK_Boss_Warlord，18 段采样片段 + act_ 触发器，受击 / 倒下片段等 ART8），
    /// 美术缺失时用熔炉铁牛 × 1.6 当代理（4.11）。
    ///   招式（剑士化 v2，2026-11-01，docs/art/vfx/warlord.md 第 13 章：重剑剑术大师——挥砍多、连段有节奏、剑光是主角）：
    ///     焰刃连斩（<see cref="WarlordBladeCombo"/>：贴身三 / 四 / 五刀，二阶段起上挑接下劈）、居合一闪（<see cref="WarlordIai"/>）、熔铜剑气（<see cref="WarlordSwordWave"/>，
    ///     狂怒十字剑气）、突刺冲锋（<see cref="WarlordThrust"/>，替代烈焰冲锋：沿途留火保留，刹住后收刀横斩）、回旋斩（<see cref="WarlordSpin"/>，二阶段起，狂怒二连）；
    ///     B1 参考招式里保留扇形火焰横扫（二阶段反手再扫 + 火弹）、跃击（落点重击 + 冲击波）、陨石雨（改成二阶段起才出：号令天火是场地压力，不是剑术），
    ///     熔铜渠涨落（<see cref="WarlordChannelSurge"/>，替代 TS 的方场熔岩涌动：神范台的十字浅渠和熔池漫上渠岸，<see cref="FoundryChannels"/>）。
    ///     动作由招式自己调 <see cref="WarlordBrain.Act"/>（剑士化招式）或 <see cref="WarlordBrain"/> 按招式时间轴触发（参考招式）。
    ///   阶段（D23：血条刻度就是这两道阈值）：教招（100–50%）→ 50% 引动熔铜渠（转换后第一招就是涨落；回旋斩、陨石雨解锁、连斩四刀、剑气横竖两道）→
    ///     20% 狂怒（压缩）——喘息 / 前摇缩短、大剑燃成熔铜长刃（射程 × 1.15、刀光多一层残月）、连斩五刀、十字剑气、回旋二连、居合回身再斩、
    ///     陨石冷却 7 s、战斗中持续落零星陨石；狂怒后第一招是回旋二连。
    ///   弱点：胸口的地火之心（新模型的挂点 socket_core，半径 0.45 m；2026-11-01 模型路定的新骨架）；另有肩甲、膝甲两组命中区（TS hitShapes）。
    ///     新模型落地之前仍是旧部件骨架（j_*）：WarlordBrain 认出旧骨架时弱点退回角盔、命中区挂回旧骨（<see cref="Legacy"/>）。
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
        /// <summary>
        /// 新模型（人形骨架，模型路 2026-11-01 定的骨名 / 挂点；挂点不变形、绑定矩阵是单位阵）：弱点 = 胸口地火之心 socket_core（挂在 chest 下）、头骨 head
        /// </summary>
        public const string WeakBone = "socket_core", HeadBone = "head";
        /// <summary>腰以上（上身）的骨：转身时目光领先叠在它和头上（WarlordBrain.LateUpdate）</summary>
        public const string TorsoBone = "spine";
        /// <summary>
        /// 熔心大剑的握点（右手掌心挂点，大剑按单位变换挂上去就是剑尖朝下、剑面朝前）与剑尖挂点（WarlordBlade 校朝向、拖影取剑长）。
        /// 故意不叫 socket_greatsword：那个名字会让 Bosses.AttachParts 再挂一把不带 WarlordBlade 的剑
        /// </summary>
        public const string GripBone = "socket_sword", TipBone = "socket_sword_tip";
        /// <summary>角盔盔脊、两肩甲顶（狂怒火舌挂在这里）</summary>
        public const string HelmBone = "socket_helm", PauldronL = "socket_pauldron_L", PauldronR = "socket_pauldron_R";

        /// <summary>旧部件骨架（j_*，新模型落地前的过渡；WarlordBrain 找不到 <see cref="GripBone"/> 而找得到这里的握点时按它走）</summary>
        public static class Legacy
        {
            public const string WeakBone = "j_0_1_24_8", HeadBone = "j_0_1_24", TorsoBone = "j_0_1", GripBone = "j_0_1_21_1_5", TipBone = "j_0_1_21_1_5_11";
            public const string PauldronL = "j_0_1_13", PauldronR = "j_0_1_18", KneeL = "j_0_0_11_1", KneeR = "j_0_0_12_1";

            /// <summary>新命中区 id → 旧骨名</summary>
            public static string ZoneBone(string zoneId) => zoneId switch
            {
                "pauldron_l" => PauldronL,
                "pauldron_r" => PauldronR,
                "knee_l" => KneeL,
                "knee_r" => KneeR,
                _ => null,
            };
        }

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
            // TS hitShapes：肩甲、膝甲（胸、髋在角色胶囊里）；BossModel.FindBone 是子串匹配、深度优先取第一个：pauldron_L 先命中肩甲骨本身，不会落到 socket_pauldron_L
            hitZones.Add(new BossHitZoneDef { id = "pauldron_l", bone = "pauldron_L", radius = 0.46f });
            hitZones.Add(new BossHitZoneDef { id = "pauldron_r", bone = "pauldron_R", radius = 0.46f });
            hitZones.Add(new BossHitZoneDef { id = "knee_l", bone = "shin_L", radius = 0.3f, height = 1.44f });
            hitZones.Add(new BossHitZoneDef { id = "knee_r", bone = "shin_R", radius = 0.3f, height = 1.44f });

            phases.Add(new BossPhaseDef
            {
                at = ChannelsAt, seconds = 2.2f, anim = "roar", sfx = "boss_roar", shake = 0.5f, toast = "熔心魔将引动了熔铜渠！", restScale = 0.8f,
                firstMove = WarlordChannelSurge.MoveId,
            });
            phases.Add(new BossPhaseDef
            {
                // 狂怒的提示由 enrageToast 打（生命层跌破 20% 立刻狂怒，转换演出等当前招式收尾）
                at = FuryAt, seconds = 2.2f, anim = "roar", sfx = "boss_roar", shake = 0.6f, toast = null, restScale = 0.85f, firstMove = WarlordSpin.MoveId,
            });

            // 剑士化 v2 的剑术招式（Bosses/Warlord/Moves，动作由招式自己调 WarlordBrain.Act）
            moves.Add(() => new WarlordBladeCombo());
            moves.Add(() => new WarlordIai());
            moves.Add(() => new WarlordSwordWave());
            moves.Add(() => new WarlordThrust());
            moves.Add(() => new WarlordSpin());
            // 保留的 B1 参考招式（TS 原值，见 Reference/WarlordMoves.cs）；它们的前摇动作名是参考样机的，这里清掉，动作由 WarlordBrain 按时间轴触发
            moves.Add(() => new WarlordSweep { windupAnim = null });
            moves.Add(() => new WarlordLeap { windupAnim = null });
            // 陨石雨（号令天火）二阶段起才出：一阶段只教剑术
            moves.Add(() => new WarlordMeteor { windupAnim = null, minPhase = 1 });
            moves.Add(() => new WarlordChannelSurge());

            summonCap = 0;
            enrageAfter = 0;
            enrageBelow = FuryAt;
            // 20% 狂怒（TS 三阶段 restFactor 0.6）：阶段 0.85 × 狂怒 0.7 ≈ 0.6
            enrageRestScale = 0.7f;
            enrageWindupScale = 0.9f;
            enrageDamageScale = 1.1f;
            enrageToast = "熔心魔将陷入狂怒——大剑燃成熔铜长刃！";
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
