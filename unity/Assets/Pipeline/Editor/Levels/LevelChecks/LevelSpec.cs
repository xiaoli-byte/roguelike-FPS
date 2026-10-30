using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 一张图交给验收规则集（<see cref="LevelValidator"/>）的声明数据（docs/unity-parity.md 4.9「代码本身就是 LevelSpec」）：
    /// 出生点、主线路点、场地、额外锚点 / 交互点、地标视线、坡度路径、可玩区遮罩、预算、占位策略。
    /// 构建器在场景生成、烘焙 NavMesh 之后填好它，调 <see cref="LevelValidator.Run"/>。场景里能自己找到的东西不用声明：
    /// EncounterSite 的锚点和敌人编制、IInteractable（传送门、宝箱…）、场地肃清后的宝箱落点、占位件、渲染器都由检查项自己扫。
    /// 没声明的项对应的检查只报告或跳过，不判不合格（例如场地不写 minCover 就只报掩体数）。
    /// </summary>
    public sealed class LevelSpec
    {
        /// <summary>关卡 id（与 [LevelBuilder] 一致：1-1、arena…），决定俯视图文件名 level_&lt;id&gt;_map.png</summary>
        public string id;
        public string title;
        /// <summary>玩家出生点（地面）；不填 = 场景里的 PlayerSpawn 标记</summary>
        public Vector3 playerSpawn;
        /// <summary>验收区域（世界 XZ）：可达性栅格、防越界只在这块里算；不填 = 有遮罩时取界内外扩，否则取地形范围</summary>
        public Rect bounds;
        /// <summary>
        /// 可玩区遮罩（与 LevelKit.Boundary 用同一个函数）：值 ≥ <see cref="playableThreshold"/> 算界内。
        /// null = 不做防越界检查，俯视图取 <see cref="bounds"/>。
        /// </summary>
        public Func<Vector2, float> playable;
        public float playableThreshold = 0.2f;
        /// <summary>落到界外多远（米）算越界成功（边界线附近的沙脊顶、坡脚不算）</summary>
        public float escapeMargin = 3f;

        /// <summary>主线路点（按顺序）：NavMesh 依次连通；每个路点不靠二段跳就能到</summary>
        public List<Waypoint> route = new();
        /// <summary>战斗 / 缓冲场地：尺寸、掩体数、高差层数</summary>
        public List<SiteSpec> sites = new();
        /// <summary>额外的刷怪锚点（场景里 EncounterSite 的锚点自动收集，这里只放没挂在场地上的，如测试场的刷怪台）</summary>
        public List<AnchorSpec> anchors = new();
        /// <summary>额外的交互点（场景里的 IInteractable 和场地宝箱落点自动收集，这里放还没有组件的，如商店摊位）</summary>
        public List<InteractSpec> interactables = new();
        /// <summary>地标视线：入口眼高 → 地标，中途不被挡</summary>
        public List<SightSpec> sightLines = new();
        /// <summary>沿路径的坡度上限（古道、栈道）</summary>
        public List<SlopePath> slopePaths = new();
        /// <summary>预算估算的额外机位（主线路点之间的机位自动生成）</summary>
        public List<View> views = new();
        public Budget budget = Budget.Default;
        public PlaceholderPolicy placeholders = PlaceholderPolicy.Fail;
        /// <summary>俯视图范围（世界 XZ）：不填 = 界内外扩 12 m（没有遮罩时取 <see cref="bounds"/>）</summary>
        public Rect mapArea;
        /// <summary>俯视图长边像素</summary>
        public int mapPixels = 2048;
        /// <summary>跳过的检查项 id（<see cref="ILevelCheck.Id"/>）</summary>
        public HashSet<string> skip = new();

        public LevelSpec Route(string name, Vector3 pos)
        {
            route.Add(new Waypoint { name = name, pos = pos });
            return this;
        }

        public LevelSpec Site(SiteSpec site)
        {
            sites.Add(site);
            return this;
        }

        public LevelSpec Sight(string what, Vector3 eye, Vector3 target, float tolerance = 4f, string landmark = null)
        {
            sightLines.Add(new SightSpec { what = what, eye = eye, target = target, tolerance = tolerance, landmark = landmark });
            return this;
        }
    }

    public struct Waypoint
    {
        public string name;
        /// <summary>地面位置</summary>
        public Vector3 pos;
    }

    /// <summary>一个场地（docs/level-design/unity-maps-v1.md 第 0 节尺度表：战斗场地 40–60 m，三层高度）</summary>
    public sealed class SiteSpec
    {
        public string name;
        /// <summary>场地中心（地面）</summary>
        public Vector3 center;
        /// <summary>设计尺寸（米，直径；长方形场地取两边平均）：在这个直径的圆里量可走面积</summary>
        public float size = 40f;
        /// <summary>战斗场地（缓冲 / 出口不是）：尺寸小于 40 m 时提醒</summary>
        public bool combat = true;
        /// <summary>至少几处掩体（−1 = 只报告）</summary>
        public int minCover = -1;
        /// <summary>至少几层高度（地面 / 台阶 1–2.5 m / 俯射 ≥ 2.5 m；−1 = 只报告）</summary>
        public int minLayers = -1;
        /// <summary>要有不靠二段跳就能上去的俯射层（≥ 2.5 m）</summary>
        public bool overlook;

        public float Radius => size * 0.5f;
    }

    /// <summary>刷怪锚点：enemies = 会在这里出生的敌人 id（null = 名册里最大的体型）</summary>
    public sealed class AnchorSpec
    {
        public string name;
        public Vector3 pos;
        public string[] enemies;
        /// <summary>飞行单位的空中锚点：不要求 NavMesh 有路</summary>
        public bool flying;
    }

    /// <summary>交互点（宝箱、传送门、商店摊位…）：radius = 交互半径</summary>
    public sealed class InteractSpec
    {
        public string name, kind;
        /// <summary>交互焦点（物体中心，不是地面）</summary>
        public Vector3 focus;
        public float radius = 2.5f;
        /// <summary>物体自身要占的空间（半尺寸，底面在 focus 下方的地面上）；零 = 场景里已经摆好的物体，不查自身</summary>
        public Vector3 footprint;
        /// <summary>这个物体自己的碰撞体（视线打到它们算看到）</summary>
        public Transform owner;
    }

    public sealed class SightSpec
    {
        public string what;
        public Vector3 eye, target;
        public float tolerance = 4f;
        /// <summary>地标资产 ID：视线先打到它的任一实例也算看到</summary>
        public string landmark;
    }

    /// <summary>沿一条折线（关卡 XZ）采样坡度</summary>
    public sealed class SlopePath
    {
        public string name;
        public IReadOnlyList<Vector2> points;
        public float maxSlope = 24f;
    }

    /// <summary>预算估算机位（眼高位置 → 看向目标）</summary>
    public struct View
    {
        public string name;
        public Vector3 eye, target;
    }

    /// <summary>
    /// 面数 / 批次预算（粗估）：view* = 主线机位里最重的一个画面（视锥剔除 + LOD 选择，不含阴影、地形、遮挡剔除）；scene* = 全场景 LOD0 合计。
    /// I4 按 12 关的实测收紧（docs/performance-unity.md「预算」）：最重的是 2-2 昆仑天阙，机位 165 万面、315 次绘制，全场景 171 万面（玉石挡墙单件 5962 面，
    /// 2-2 摆了 177 次、一项 103 万）。机位留约 25%；全场景留到 250 万，因为 3-1 / 3-2 还有白盒占位，换正式件会涨。
    /// 按画质档、阴影、按层剔除距离算的固定机位预算另见 PerfBudgetCheck（阈值在 Spiritfire.Game.PerfBudget，和运行时的性能套件共用）。
    /// </summary>
    public struct Budget
    {
        public int viewTriangles, viewDrawCalls;
        public int sceneTriangles;

        public static Budget Default => new() { viewTriangles = 2_000_000, viewDrawCalls = 400, sceneTriangles = 2_500_000 };
    }

    /// <summary>占位件（LevelKit.PlaceOrBox 放的白盒、名字带 Placeholder / 占位的物体）怎么判</summary>
    public enum PlaceholderPolicy
    {
        /// <summary>有就不合格（正式图验收：docs/unity-parity.md 7.4「没有 Placeholder」）</summary>
        Fail,
        /// <summary>只列清单（白盒阶段、测试场）</summary>
        Warn,
    }
}
