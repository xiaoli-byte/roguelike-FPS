namespace Spiritfire.Game
{
    /// <summary>
    /// 出场方式（第三章 v2 S1，docs/level-design/ch3-v2.md 第 4.2 节）：编制条目 <see cref="WaveEntry.via"/> 写想要的方式，
    /// 站位 <see cref="SpawnAnchor.mode"/> 写这个站位给哪种方式用。默认都是 <see cref="Appear"/>（现身）——旧场景、旧编排不受影响。
    ///
    /// 选点规则（<see cref="SpawnStations.Pick"/>）：
    ///   · 条目是某种特殊方式、场地里有同一方式的站位 → 只在这些站位里选；
    ///   · 场地里没有这种方式的站位 → 退回「现身」，用普通站位（站位没摆好也能先跑通）；
    ///   · 现身条目只用现身站位；场地里一个现身站位都没有时才用全部站位。
    ///
    /// 各方式里站位的含义：
    ///   <see cref="Appear"/>    站位 = 出生点（地面法阵 0.8 s）。
    ///   <see cref="Ambush"/>    站位 = 摆放点（朝向 = 站位的 forward）；场地启用时预生成并休眠，进触发圈 / 开战 / 被打中时整组苏醒（吼 / 铃 + 头顶「！」）。
    ///   <see cref="Ember"/>     站位 = 渣堆（余烬起身，炭童专用；别的怪按现身处理）：一堆冒烟的炭，1.0 s 越闪越快后拼起来站起。
    ///   <see cref="LavaCrawl"/> 站位 = 爬上岸后的落脚点（干地导航网格上）；<see cref="SpawnAnchor.entry"/> = 熔岩里的冒出点（空 = 自动在站位外 3–6 m 找熔岩）。
    ///                           熔岩面 0.8 s 鼓泡 + 品红圈，爬上岸 1.2 s，上岸前无敌；火鼍直接在冒出点潜行进场。
    ///   <see cref="FlyIn"/>     站位 = 目的地（毕方的栖点附近）；<see cref="SpawnAnchor.entry"/> = 入场点（排烟口 / 天空 / 王座方向），在那里生成、沿弧线飞到站位。
    ///   <see cref="Drop"/>      站位 = 落点（场地里的导航网格）；<see cref="SpawnAnchor.dropFrom"/> = 起跳的高点（墙头 / 台沿），先露头 0.6 s 再跳下、落地一震。
    ///   <see cref="Gate"/>      站位 = 门外的集结点；<see cref="SpawnAnchor.gate"/> = 门后导航网格上的出生点（空 = 站位本身），
    ///                           <see cref="SpawnAnchor.gateDoor"/>（IActivatable）先开门，门缝发光 ≥ 1 s 后从门后沿 lane 冲进来。
    /// 「路遇」不是条目的方式，而是场地的身份：<see cref="EncounterSite.AsRoadside"/>（不计目标、小触发圈）+ 条目用 <see cref="Ambush"/>。
    /// </summary>
    public enum SpawnMode
    {
        /// <summary>现身（默认）：站位上闪 0.8 s 地面法阵后出现</summary>
        Appear = 0,
        /// <summary>埋伏：开局就摆在场上、休眠，玩家先看见；进触发圈 / 开战 / 被打中时整组苏醒</summary>
        Ambush = 1,
        /// <summary>余烬起身（炭童）：渣堆冒烟、闪光越来越快，然后拼起来站起</summary>
        Ember = 2,
        /// <summary>熔岩爬出：熔岩鼓泡 + 品红圈，敌人从熔岩里爬上岸（火鼍直接潜行进场）</summary>
        LavaCrawl = 3,
        /// <summary>飞临：飞行敌人从入场点沿弧线飞进来</summary>
        FlyIn = 4,
        /// <summary>跃下：从墙头 / 台上跳进场地，落地一震</summary>
        Drop = 5,
        /// <summary>增援门：门先亮再开，敌人从门后冲进来</summary>
        Gate = 6,
    }

    /// <summary>出场方式的小工具</summary>
    public static class SpawnModes
    {
        /// <summary>中文名（横幅、报告、调试面板用）</summary>
        public static string Label(SpawnMode m) => m switch
        {
            SpawnMode.Ambush => "埋伏",
            SpawnMode.Ember => "余烬起身",
            SpawnMode.LavaCrawl => "熔岩爬出",
            SpawnMode.FlyIn => "飞临",
            SpawnMode.Drop => "跃下",
            SpawnMode.Gate => "增援门",
            _ => "现身",
        };

        /// <summary>这种方式在开战前就把单位摆上场（休眠）：目前只有埋伏</summary>
        public static bool PrePlaced(SpawnMode m) => m == SpawnMode.Ambush;

        /// <summary>
        /// 站位能不能给这个条目用：anchorMode = 站位的方式，want = 条目实际要用的方式（已按「场地里有没有这种站位」退回过，见 <see cref="SpawnStations.Pick"/>）；
        /// anyOfWant = 场地里有没有 want 方式的站位（没有时现身条目可以用全部站位）
        /// </summary>
        public static bool Accepts(SpawnMode anchorMode, SpawnMode want, bool anyOfWant) => !anyOfWant || anchorMode == want;
    }
}
