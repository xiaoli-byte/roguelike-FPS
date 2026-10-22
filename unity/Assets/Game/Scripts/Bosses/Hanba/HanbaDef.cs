using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃（第一章首领，1-4 干涸月牙泉；docs/level-design/unity-maps-v1.md 第 3 节，docs/level-design/maps/1-4.md，D2 / D5 / D26）。
    /// 悬浮的干瘦女神，背后 6 m 白金日轮；只有一个形态（SK_Boss_Hanba × 1，美术缺失时 SK_Enemy_Apsara × 3.5 当代理 + 白盒日轮，4.11）。
    ///   阶段（D23：血条刻度就是这两道阈值）：
    ///     一 · 烈日 100–60%（BS1）：日轮扫射、旱风、召沙魇；日晒与荫蔽（<see cref="SunExposure"/>）。
    ///     二 · 焦土 60–30%、三 · 赤地千里 30–0%（BS2：吸干泉水 + 喷气裂缝、焦裂、飞天之殇、日轮升顶、日蚀露出泉珠 ×3；D26 以 unity-maps-v1 为准）。
    ///     BS2 落地之前，二、三阶段先占位：照出一阶段的三招，但按 <see cref="pace"/> 更快（前摇缩短、扫得更快、沙魇多一只），喘息按 restScale 缩短。
    ///   弱点：心口的泉珠（socket_core，正式美术的半径约 0.12 m），只在招式后摇（施法后摇）和硬直时露出（<see cref="HanbaBrain"/> 开关弱点球与泉珠发光壳）；
    ///     其余时间只能打身体。BS2 的日蚀再加一个 3 s × 3 的窗口。
    ///   数值：1-4 的难度 1.48 下定档约 4400 生命 + 2200 护盾（docs/unity-parity.md BS2，最终定档在 BS2 按模拟秒伤复核，目标 60–120 s）。
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
        /// <summary>1-4 的难度与定档（BS2 复核）</summary>
        public const float StageDifficulty = 1.48f;

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

        // ───────────── 阶段节奏（BS2 之前的占位）─────────────

        /// <summary>
        /// 每个阶段的出招节奏（一阶段 = 1）：前摇 ÷ pace、扫射角速度 × pace、旱风二阶段起补一道余波、沙魇二阶段起 4 只。
        /// BS2 换成各阶段自己的招式后，这张表只管一阶段招式在后面阶段的变体
        /// </summary>
        public readonly float[] pace = { 1f, 1.2f, 1.4f };

        // ───────────── 沙魇（EN1 的沙魇变体还没做：第一章杂兵 + 沙色材质变体）─────────────

        /// <summary>每次召唤按顺序取前 n 只（一阶段 3、之后 4）</summary>
        public readonly string[] wraithRoster = { "jerboa_blade", "jerboa_blade", "scorpion_archer", "jerboa_blade" };
        /// <summary>沙魇着色：反照率乘色（MaterialPropertyBlock 的 _Tint 通道）与覆盖色</summary>
        public Color wraithTint = new(0.95f, 0.8f, 0.55f), wraithOverlay = new(0.85f, 0.66f, 0.4f);
        public float wraithOverlayAmount = 0.38f;

        public HanbaDef()
        {
            id = Id;
            name = "旱魃";
            title = "赤地之源";
            brain = typeof(HanbaBrain);
            // 难度 1 的参考值 = 定档 ÷ 1.48（定档表优先，见 VitalsAt）
            vitals = new BossVitals(3000, 1500);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(4400, 2200)));
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
            // 二、三阶段：BS2 换成吸干泉水 / 日轮升顶的演出；现在用召沙魇那段「双臂高举 → 下压」当转换动作
            phases.Add(new BossPhaseDef
            {
                at = ScorchedAt, seconds = 2.8f, anim = "summonWraiths", sfx = "boss_roar", shake = 0.5f, toast = "旱魃的日轮愈发灼烈——焦土！", restScale = 0.85f,
            });
            phases.Add(new BossPhaseDef
            {
                at = RedEarthAt, seconds = 2.8f, anim = "summonWraiths", sfx = "boss_roar", shake = 0.6f, toast = "赤地千里——日轮燃到了极致！", restScale = 0.7f,
            });

            moves.Add(() => new Phase1SunSweep());
            moves.Add(() => new Phase1HotWind());
            moves.Add(() => new Phase1SandWraiths());

            summonCap = 6;
            enrageAfter = 240f;
            enrageToast = "旱魃狂怒——烈日焚天！";
            intro.seconds = 4f;
            intro.anim = "intro";
            intro.sfx = "boss_roar";
            intro.shake = 0.5f;
            intro.firstRest = 1.2f;
            defeat.seconds = 4.2f;
            defeat.toast = "旱魃伏诛——泉眼复涌";
        }

        /// <summary>某个阶段的出招节奏（越界取两端）</summary>
        public float PaceAt(int phase) => pace.Length == 0 ? 1f : pace[Mathf.Clamp(phase, 0, pace.Length - 1)];
    }
}
