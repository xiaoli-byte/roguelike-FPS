using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃（第一章首领，1-4 鸣沙山月牙泉——露天：高沙丘环抱的洼地、一弯月牙泉、南岸月泉阁一组楼阁；docs/level-design/unity-maps-v1.md 第 3 节，
    /// docs/level-design/maps/1-4.md，D2 / D5 / D26）。
    /// 悬浮的干瘦女神，背后 6 m 白金日轮；只有一个形态（SK_Boss_Hanba × 1，美术缺失时 SK_Enemy_Apsara × 3.5 当代理 + 白盒日轮，4.11）。
    ///   阶段（D23：血条刻度就是这两道阈值）：
    ///     一 · 烈日 100–60%（BS1）：日轮扫射、旱风、召沙魇；日晒与荫蔽（<see cref="SunExposure"/>：午后的低太阳，沙丘背阴面、楼阁、树拖出长影子），泉水里灼烧减半。
    ///     二 · 焦土 60–30%（BS2）：转阶段时吸干泉水、泉床龟裂，之后裂缝间歇喷气（<see cref="Phase2Scorch"/>，地面预警）；
    ///       新增焦裂（<see cref="Phase2CrackLine"/>）、飞天之殇（<see cref="Phase2ApsaraCall"/>：邪飞天给她套琵琶护体，打碎琵琶解除——转阶段后的第一招）。
    ///     三 · 赤地千里 30–0%（BS2，D26 以 unity-maps-v1 为准）：转阶段时日轮升到头顶、太阳被推到约 85°（<see cref="Phase3SunRise"/>），影子缩到脚下，
    ///       只剩楼阁里、沙丘檐下的深影；新增日蚀（<see cref="Phase3Eclipse"/>：日轮熄灭、天暗 3 s，泉珠露出、伤害 ×3，之后强光覆盖全场——转阶段后的第一招）。
    ///     前一阶段的招式都留着，按 <see cref="pace"/> 变快（前摇 ÷ 节奏、扫得更快、沙魇 4 只、旱风补余波、焦裂三条成扇），喘息按 restScale 缩短。
    ///   弱点：心口的泉珠（socket_core，正式美术的半径约 0.12 m），只在招式后摇（施法后摇）、硬直和日蚀窗口露出（<see cref="HanbaBrain"/> 开关弱点球与泉珠发光壳）；
    ///     其余时间只能打身体。
    ///   数值：1-4 的难度 1.48 下定档 7700 生命 + 3850 护盾（BS2 定的 4400 + 2200 按「约 100 秒伤」估，I3 首领浸泡实测代表配装可选中时约 200 秒伤，
    ///     40 s 就倒下，按实测重定 ×1.75：浸泡估算约 67–79 s，模拟的下沿打法约 115 s）。按模拟秒伤（<see cref="HanbaBalance"/>，EditMode 测试 HanbaBalanceTests）
    ///     算击杀用时：1-4 预期装备下秒伤带下沿 / 中位 / 上沿三种打法都落在 60–120 s。
    ///   演出：登场名字卡（框架）+ 长啸那一下震屏、日轮炸亮、短慢动作；转阶段打阶段名卡 + 慢动作 + 震屏；倒下时日轮坠落碎裂、身体落地、泉眼复涌、
    ///     太阳回到午后（<see cref="HanbaCinematics"/>、<see cref="HanbaSunDriver"/>）。
    /// 动作：ART2 的手工关键帧（AC_SK_Boss_Hanba：Idle / Hit + act_&lt;状态&gt; 触发的 8 个招式状态，events.json 叠加表给出手时刻），
    /// 招式经 <see cref="HanbaBrain.Act"/> 触发、按实际前摇拉伸，出手跟动画事件（<see cref="BossMove"/> 的 Cue），没有事件的代理模型按时间兜底。
    /// 悬浮升降、日轮旋转、残衣 / 长发弹簧都在运行时层（片段里没有烘）。
    /// </summary>
    [Defs(10)]
    public sealed class HanbaDef : BossDef
    {
        public const string Id = "boss_hanba";
        public const string FormId = "hanba";
        public const string PrefabId = "SK_Boss_Hanba", ProxyPrefabId = "SK_Enemy_Apsara";
        /// <summary>阶段阈值（生命层比例）：焦土、赤地千里</summary>
        public const float ScorchedAt = 0.6f, RedEarthAt = 0.3f;
        /// <summary>1-4 的难度（定档就定在这里）</summary>
        public const float StageDifficulty = 1.48f;
        /// <summary>1-4 的定档：生命 / 护盾（BS2「约 4.4k + 2.2k」→ I3 按首领浸泡实测 ×1.75，docs/balance.md 第 3 节；HanbaBalanceTests 按模拟秒伤复核）</summary>
        public const float TierHp = 7700f, TierShield = 3850f;

        public static readonly Color Sun = Hex.Rgb(0xffe2a0), Sand = Hex.Rgb(0xd9b27a), Warn = Hex.Rgb(0xffa23d);

        // ───────────── 悬浮（运行时层）─────────────

        /// <summary>悬浮高度（米，模型整体抬高；残衣下摆在 z = 0）、上下起伏幅度与频率</summary>
        public float hover = 0.55f, bob = 0.12f, bobRate = 1.1f;

        // ───────────── 日晒（SunExposure）─────────────

        /// <summary>光柱 / 日轮整份暴露的叠层增益；日轮平时 / 最炽时的直射距离；浅水倍率；每层每跳伤害（难度 1）</summary>
        public float shaftGain = 1f, ringGain = 0.6f, ringRange = 14f, ringBlazeRange = 24f, waterFactor = 0.5f, sunDamagePerStack = SunburnStatus.DamagePerStack;

        // ───────────── 弱点 ─────────────

        /// <summary>招式收招后泉珠再露多久（秒）</summary>
        public float weakGrace = 0.6f;

        // ───────────── 阶段节奏 ─────────────

        /// <summary>
        /// 每个阶段的出招节奏（一阶段 = 1）：所有招式的前摇 ÷ pace（日蚀除外：片段原速，3 s 窗口固定）、扫射角速度 × pace、
        /// 旱风二阶段起补一道余波、沙魇二阶段起 4 只、焦裂三阶段起三条
        /// </summary>
        public readonly float[] pace = { 1f, 1.2f, 1.4f };

        // ───────────── 沙魇（EN1：沙魇本体 sand_wraith + 换了沙魇皮的蝎尾弩卫）─────────────

        /// <summary>每次召唤按顺序取前 n 只（一阶段 3、之后 4）：沙魇 ×2 + 蝎尾弩卫（沙魇·），二阶段起再加一只沙魇</summary>
        public readonly string[] wraithRoster = { Enemy_SandWraith.Id, Enemy_SandWraith.Id, "scorpion_archer", Enemy_SandWraith.Id };
        /// <summary>沙魇着色（叠在 EnemyVariant 的皮上）：反照率乘色（MaterialPropertyBlock 的 _Tint 通道）与覆盖色</summary>
        public Color wraithTint = new(0.95f, 0.8f, 0.55f), wraithOverlay = new(0.85f, 0.66f, 0.4f);
        public float wraithOverlayAmount = 0.38f;

        // ───────────── 焦土：喷气裂缝（Phase2Scorch）─────────────

        /// <summary>二 / 三阶段每隔多久喷一轮（秒）、每轮几个裂口；地面预警时长、喷气半径、伤害倍率</summary>
        public float ventEvery2 = 4.5f, ventEvery3 = 3.2f, ventWarn = 1.1f, ventRadius = 2.2f, ventDamage = 0.6f;
        public int ventCount2 = 2, ventCount3 = 3;

        // ───────────── 飞天之殇：琵琶护体（ApsaraWard）─────────────

        /// <summary>召出的邪飞天（敌人名册 id）与名字；护体承伤倍率；琵琶碎后的踉跄（秒）与其间的承伤倍率</summary>
        public string apsaraId = "apsara", apsaraName = "日灼·邪飞天";
        public float wardTaken = 0.2f, wardBreakStagger = 2.5f, wardBreakTaken = 1.3f;
        /// <summary>被腐化的邪飞天身上那层暗赤金</summary>
        public Color apsaraOverlay = new(0.85f, 0.32f, 0.12f);
        public float apsaraOverlayAmount = 0.35f;

        // ───────────── 午后的低太阳（一阶段，露天场地）─────────────

        /// <summary>露天场地的太阳仰角高过 lowSunMax（度）时，登场演出里压到 lowSunElevation（关卡本来就是低太阳时不动）</summary>
        public float lowSunElevation = 30f, lowSunMax = 42f;

        // ───────────── 赤地千里：日轮升到头顶（Phase3SunRise）─────────────

        /// <summary>露天：太阳推到的仰角（度）与用时（秒）、日轮离场地中心多远（沿太阳方向，米）、日轮放大倍率、日光增益（日轮直射并入日光）</summary>
        public float risenElevation = 85f, sunDriveSeconds = 3.2f, risenDistance = 45f, risenSkyScale = 2.4f, risenSunGain = 1.4f;
        /// <summary>旧的地下巨穴版（有穴顶开口标记）：轮心在开口之下多少米；日轮直射距离、增益、放大倍率</summary>
        public float riseDrop = 8.5f, risenRange = 70f, risenGain = 0.8f, risenScale = 1.5f;

        // ───────────── 日蚀（Phase3Eclipse）─────────────

        /// <summary>窗口时长（秒，= 片段 eclipseStart → eclipseEnd）、窗口里泉珠伤害倍率（弱点必暴之外再乘）、复燃强光的伤害倍率与额外日晒秒数</summary>
        public float eclipseSeconds = 3f, eclipseWeakMult = 3f, flareDamage = 1.6f, flareBurn = 2.5f;
        /// <summary>露天：日蚀时主光压到原亮度的多少、复燃时猛亮到几倍</summary>
        public float eclipseDim = 0.12f, flareBright = 2.4f;

        // ───────────── 演出（HanbaCinematics）─────────────

        /// <summary>登场长啸 / 转阶段的慢动作（倍率、真实秒数）；长啸在 intro 片段里的位置（70 / 120 帧）</summary>
        public float introSlowMo = 0.45f, introSlowMoSeconds = 0.35f, phaseSlowMo = 0.5f, phaseSlowMoSeconds = 0.45f, roarAt = 0.5833f;
        /// <summary>阶段名卡（进入二、三阶段时打）</summary>
        public readonly string[] phaseCards = { "二 · 焦土", "三 · 赤地千里" };
        public readonly string[] phaseCardSubs = { "泉水尽涸 · 泉床龟裂", "烈日当头 · 影子缩到脚下" };

        public HanbaDef()
        {
            id = Id;
            name = "旱魃";
            title = "赤地之源";
            brain = typeof(HanbaBrain);
            // 难度 1 的参考值 = 定档 ÷ 1.48（定档表优先，见 VitalsAt）
            vitals = new BossVitals(TierHp / StageDifficulty, TierShield / StageDifficulty);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp, TierShield)));
            damage = 15f;
            speed = 4.2f;
            element = Element.Fire;
            color = Hex.Rgb(0xffd27a);
            warnColor = Warn;
            // 占位胶囊的设计尺寸：身高 4.5 m（不含日轮）
            radius = 0.9f;
            height = 4.5f;
            idleMinRange = 10f;
            idleMaxRange = 18f;
            repeatWeight = 0.15f;

            forms.Add(new BossFormDef
            {
                id = FormId, name = null, prefab = PrefabId, scale = 1f, proxyPrefab = ProxyPrefabId, proxyScale = 3.5f,
                weakBone = "socket_core", weakRadius = 0.2f,
            });
            // 二阶段：双手捧到心口把泉水吸进泉珠（apsaraCall 那段）；演出里吸干、龟裂，结束后先召邪飞天
            phases.Add(new BossPhaseDef
            {
                at = ScorchedAt, seconds = 3.2f, anim = "apsaraCall", sfx = "boss_roar", shake = 0.6f, restScale = 0.85f, firstMove = Phase2ApsaraCall.MoveId,
                toast = "旱魃吸干了月牙泉——泉床裂缝会喷出热气，看地面预警！",
            });
            // 三阶段：蜷起再舒展长啸（intro 那段），日轮升到头顶、太阳推到 85°；结束后先放日蚀
            phases.Add(new BossPhaseDef
            {
                at = RedEarthAt, seconds = 3.6f, anim = "intro", sfx = "boss_roar", shake = 0.7f, restScale = 0.7f, firstMove = Phase3Eclipse.MoveId,
                toast = "日轮升到头顶——影子几乎没了，躲进楼阁里或沙丘檐下的深影！",
            });

            moves.Add(() => new Phase1SunSweep());
            moves.Add(() => new Phase1HotWind());
            moves.Add(() => new Phase1SandWraiths());
            moves.Add(() => new Phase2CrackLine());
            moves.Add(() => new Phase2ApsaraCall());
            moves.Add(() => new Phase3Eclipse());

            summonCap = 6;
            enrageAfter = 240f;
            enrageToast = "旱魃狂怒——烈日焚天！";
            intro.seconds = 4f;
            intro.anim = "intro";
            intro.sfx = "boss_roar";
            intro.shake = 0.5f;
            intro.firstRest = 1.2f;
            defeat.seconds = 4.2f;
            defeat.slowMo = 0.3f;
            defeat.slowMoSeconds = 0.8f;
            defeat.toast = "旱魃伏诛——泉眼复涌";
        }

        /// <summary>某个阶段的出招节奏（越界取两端）</summary>
        public float PaceAt(int phase) => pace.Length == 0 ? 1f : pace[Mathf.Clamp(phase, 0, pace.Length - 1)];

        /// <summary>某个阶段每隔多久喷一轮气（一阶段没有，按二阶段算）</summary>
        public float VentEveryAt(int phase) => Mathf.Max(0.5f, phase >= 2 ? ventEvery3 : ventEvery2);

        /// <summary>某个阶段每轮喷几个裂口</summary>
        public int VentCountAt(int phase) => Mathf.Max(1, phase >= 2 ? ventCount3 : ventCount2);

        /// <summary>进入第 phase 阶段（1 = 焦土、2 = 赤地千里）时的名卡标题与副标题（没有为 null）</summary>
        public string CardTitle(int phase) => phase >= 1 && phase - 1 < phaseCards.Length ? phaseCards[phase - 1] : null;
        public string CardSub(int phase) => phase >= 1 && phase - 1 < phaseCardSubs.Length ? phaseCardSubs[phase - 1] : null;
    }
}
