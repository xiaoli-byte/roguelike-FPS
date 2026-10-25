using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>地点的实时状态：未动 / 进行中（交战、点火、出口已开）/ 已完成（肃清、调查完、点亮、首领伏诛）</summary>
    public enum MarkerState { Idle, Active, Done }

    /// <summary>罗盘条 / 全图上的一个地点（<see cref="MapMarkers"/> 每帧刷新状态）</summary>
    public sealed class MapMarker
    {
        public MapPoiKind kind;
        public string name;
        public Vector3 position;
        public bool optional;
        /// <summary>场景里的组件（读实时状态；没有 / 已销毁时状态停在 Idle）</summary>
        public Component source;
        /// <summary>玩家发现过（走近 / 看到 / 已经开打），本关内不会再变回 false</summary>
        public bool discovered;
        public MarkerState state;
        /// <summary>离玩家的水平距离（米，最近一次 Tick）</summary>
        public float distance;

        /// <summary>显示：发现过，或者是当前目标</summary>
        public bool Visible => discovered || MapMarkers.Target == this;
    }

    /// <summary>
    /// 行旅图地点表（docs/unity-parity.md U7；Three.js AdventureHUD 的目标 / 已发现地点逻辑的移植），罗盘条（<see cref="CompassStrip"/>）与 M 键全图（<see cref="MapScreen"/>）共用：
    ///   · 地点来自当前关卡的 <see cref="LevelMeta"/>（构建器写的）；没有时按活动场景扫一遍（<see cref="LevelMeta.Collect"/>）。换关（活动场景变了）就重建、发现记录清零；
    ///     运行时才立起来的出口（首领伏诛后 <see cref="BossEncounter"/> 立的）每秒补扫一次。
    ///   · 发现：场地走到触发圈外 20 m 内（至少 36 m）或已开打；藏宝点用它自己的发现（走近且看得见）；灵火坛 30 m；补给营 40 m；出口 40 m 或已开启；首领场地边缘 30 m 内或已开战。
    ///   · 目标（<see cref="Target"/>）：交战中的场地 → 首领战 → 已开启的出口 → 还没肃清的必清场地（前置都清了的优先）/ 还要点的灵火坛里最近的一个（选定后到完成前不换）
    ///     → 首领场地 → 出口。目标不用发现就显示。
    /// </summary>
    public static class MapMarkers
    {
        const float SiteMargin = 20f, SiteMin = 36f, AltarRadius = 30f, CampRadius = 40f, ExitRadius = 40f, BossMargin = 30f, RescanEvery = 1f;

        static readonly List<MapMarker> markers = new();
        static Scene scene;
        static bool built;
        static LevelMeta meta;
        static LevelObjective objective;
        static float nextScan;

        /// <summary>全部地点（含没发现的；显示前看 <see cref="MapMarker.Visible"/>）</summary>
        public static IReadOnlyList<MapMarker> All => markers;
        /// <summary>当前关卡的元数据（没有为 null）</summary>
        public static LevelMeta Meta => meta ? meta : null;
        /// <summary>当前目标（没有为 null）</summary>
        public static MapMarker Target { get; private set; }
        /// <summary>目标的动词（「前往」「交战中」「首领」「前往出口」…）</summary>
        public static string TargetVerb { get; private set; } = "";
        /// <summary>地点表重建的次数（界面据此重建元素）</summary>
        public static int Version { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            markers.Clear();
            scene = default;
            built = false;
            meta = null;
            objective = null;
            Target = null;
            TargetVerb = "";
            Version = 0;
            nextScan = 0;
        }

        /// <summary>玩家脚下（没有玩家为 null）</summary>
        public static Vector3? PlayerPosition
        {
            get
            {
                var pv = PlayerVitals.Instance;
                return pv ? pv.transform.position : null;
            }
        }

        /// <summary>按玩家位置刷新：换关重建、补扫出口、更新发现 / 状态、选目标。每帧调也很便宜</summary>
        public static void Tick(Vector3 player)
        {
            var active = SceneManager.GetActiveScene();
            var m = LevelMeta.Current;
            if (!built || active != scene || m != meta) Rebuild(active, m);
            if (Time.unscaledTime >= nextScan)
            {
                nextScan = Time.unscaledTime + RescanEvery;
                ScanRuntimeExits(active);
                if (!objective) objective = LevelObjective.For(meta ? meta.gameObject.scene : active);
            }
            foreach (var k in markers) Refresh(k, player);
            PickTarget(player);
        }

        /// <summary>立刻重建（测试用）</summary>
        public static void Reset() => built = false;

        static void Rebuild(Scene active, LevelMeta m)
        {
            scene = active;
            built = true;
            meta = m;
            markers.Clear();
            Target = null;
            TargetVerb = "";
            objective = LevelObjective.For(m ? m.gameObject.scene : active);
            nextScan = Time.unscaledTime + RescanEvery;
            var pois = m && m.pois != null && m.pois.Length > 0 ? new List<LevelPoi>(m.pois) : LevelMeta.Collect(m ? m.gameObject.scene : active);
            foreach (var p in pois)
                markers.Add(new MapMarker { kind = p.kind, name = p.name, position = p.position, optional = p.optional, source = p.source });
            Version++;
        }

        static void ScanRuntimeExits(Scene active)
        {
            foreach (var e in Object.FindObjectsByType<ExitPortal>(FindObjectsSortMode.None))
            {
                if (!e || (e.gameObject.scene != active && (!meta || e.gameObject.scene != meta.gameObject.scene))) continue;
                bool known = false;
                foreach (var k in markers)
                    if (k.source == e)
                    {
                        known = true;
                        break;
                    }
                if (known) continue;
                markers.Add(new MapMarker { kind = MapPoiKind.Exit, name = "出口", position = e.transform.position, source = e });
                Version++;
            }
        }

        static float Flat(Vector3 a, Vector3 b)
        {
            float dx = a.x - b.x, dz = a.z - b.z;
            return Mathf.Sqrt(dx * dx + dz * dz);
        }

        static void Refresh(MapMarker k, Vector3 player)
        {
            k.distance = Flat(k.position, player);
            var src = k.source;
            if (!src)
            {
                k.state = MarkerState.Idle;
                return;
            }
            switch (k.kind)
            {
                case MapPoiKind.Site when src is EncounterSite s:
                    k.state = s.phase == EncounterSite.Phase.Cleared ? MarkerState.Done : s.phase == EncounterSite.Phase.Active ? MarkerState.Active : MarkerState.Idle;
                    if (s.phase != EncounterSite.Phase.Idle || k.distance <= Mathf.Max(SiteMin, s.triggerRadius + SiteMargin)) k.discovered = true;
                    break;
                case MapPoiKind.Cache when src is CachePOI c:
                    bool guardFighting = c.guard && c.guard.phase == EncounterSite.Phase.Active;
                    bool done = c.Claimed || (c.Investigated && (!c.guard || c.guard.phase == EncounterSite.Phase.Cleared));
                    k.state = done ? MarkerState.Done : guardFighting ? MarkerState.Active : MarkerState.Idle;
                    if (c.Discovered || c.Investigated) k.discovered = true;
                    break;
                case MapPoiKind.Altar when src is SpiritAltar a:
                    k.state = a.Lit ? MarkerState.Done : a.Kindling || (a.guard && a.guard.phase == EncounterSite.Phase.Active) ? MarkerState.Active : MarkerState.Idle;
                    if (a.Lit || k.distance <= AltarRadius) k.discovered = true;
                    break;
                case MapPoiKind.Camp:
                    k.state = MarkerState.Idle;
                    if (k.distance <= CampRadius) k.discovered = true;
                    break;
                case MapPoiKind.Exit when src is ExitPortal e:
                    k.state = e.IsOpen ? MarkerState.Active : MarkerState.Idle;
                    if (e.IsOpen || k.distance <= ExitRadius) k.discovered = true;
                    break;
                case MapPoiKind.Boss when src is BossEncounter b:
                    k.state = b.State switch
                    {
                        BossEncounter.Phase.Waiting => MarkerState.Idle,
                        BossEncounter.Phase.Settled => MarkerState.Done,
                        _ => MarkerState.Active,
                    };
                    float edge = b.arena ? b.arena.Extent : 20f;
                    if (b.State != BossEncounter.Phase.Waiting || k.distance <= edge + BossMargin) k.discovered = true;
                    break;
            }
        }

        static MapMarker First(MapPoiKind kind, MarkerState state)
        {
            foreach (var k in markers)
                if (k.kind == kind && k.state == state) return k;
            return null;
        }

        static void PickTarget(Vector3 player)
        {
            // 1 交战中的场地 / 守军
            var t = First(MapPoiKind.Site, MarkerState.Active) ?? First(MapPoiKind.Cache, MarkerState.Active);
            if (t != null)
            {
                Set(t, "交战中");
                return;
            }
            // 2 首领战
            t = First(MapPoiKind.Boss, MarkerState.Active);
            if (t != null)
            {
                Set(t, "首领战");
                return;
            }
            // 3 出口已开
            t = First(MapPoiKind.Exit, MarkerState.Active);
            if (t != null)
            {
                Set(t, "前往出口");
                return;
            }
            // 4 必清场地 / 还要点的灵火坛：当前目标还没完成就不换；否则挑最近的（前置都清了的优先）
            bool altarsNeeded = objective && objective.AltarsLit < objective.AltarsNeeded;
            if (Target != null && Target.state != MarkerState.Done && markers.Contains(Target) && Candidate(Target, altarsNeeded, false))
            {
                Set(Target, Verb(Target));
                return;
            }
            MapMarker best = null;
            float bestD = float.MaxValue;
            for (int pass = 0; pass < 2 && best == null; pass++)
                foreach (var k in markers)
                {
                    if (!Candidate(k, altarsNeeded, pass == 0) || k.distance >= bestD) continue;
                    best = k;
                    bestD = k.distance;
                }
            if (best != null)
            {
                Set(best, Verb(best));
                return;
            }
            // 5 首领场地 → 出口
            t = First(MapPoiKind.Boss, MarkerState.Idle) ?? First(MapPoiKind.Exit, MarkerState.Idle);
            Set(t, t == null ? "" : t.kind == MapPoiKind.Boss ? "首领" : "出口");
        }

        static string Verb(MapMarker k) => k.kind == MapPoiKind.Altar ? "点亮" : "前往";

        /// <summary>目标候选：没肃清的必清场地（strict = 前置场地都肃清了），或还要点亮的灵火坛</summary>
        static bool Candidate(MapMarker k, bool altarsNeeded, bool strict)
        {
            if (k.state == MarkerState.Done) return false;
            if (k.kind == MapPoiKind.Altar) return altarsNeeded;
            if (k.kind != MapPoiKind.Site || k.optional) return false;
            if (!strict || !(k.source is EncounterSite s) || s.requires == null) return true;
            foreach (var r in s.requires)
                if (r && r.phase != EncounterSite.Phase.Cleared) return false;
            return true;
        }

        static void Set(MapMarker t, string verb)
        {
            Target = t;
            TargetVerb = verb ?? "";
        }

        /// <summary>发现过的地点数 / 总数（不含出口与首领：它们是目的地，不算探索）</summary>
        public static (int found, int total) Discovery()
        {
            int f = 0, n = 0;
            foreach (var k in markers)
            {
                if (k.kind is MapPoiKind.Exit or MapPoiKind.Boss) continue;
                n++;
                if (k.discovered) f++;
            }
            return (f, n);
        }

        /// <summary>某种地点完成数 / 总数（必清场地传 requiredOnly）</summary>
        public static (int done, int total) Progress(MapPoiKind kind, bool requiredOnly = false)
        {
            int d = 0, n = 0;
            foreach (var k in markers)
            {
                if (k.kind != kind || (requiredOnly && k.optional)) continue;
                n++;
                if (k.state == MarkerState.Done) d++;
            }
            return (d, n);
        }

        /// <summary>世界水平方位角（度，0 = 北 +Z，顺时针到 90 = 东 +X）</summary>
        public static float Bearing(Vector3 from, Vector3 to) => Mathf.Atan2(to.x - from.x, to.z - from.z) * Mathf.Rad2Deg;

        /// <summary>相机水平朝向（度，0 = 北）；没有相机为 0</summary>
        public static float Heading(Transform cam)
        {
            if (!cam) return 0;
            var f = cam.forward;
            if (Mathf.Abs(f.x) + Mathf.Abs(f.z) < 1e-4f) f = cam.up; // 正上 / 正下看时用头顶方向
            return Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg;
        }

        /// <summary>地点种类的图标字（罗盘 / 全图的小徽记）</summary>
        public static string Glyph(MapPoiKind k) => k switch
        {
            MapPoiKind.Site => "战",
            MapPoiKind.Cache => "宝",
            MapPoiKind.Camp => "营",
            MapPoiKind.Exit => "门",
            MapPoiKind.Boss => "首",
            MapPoiKind.Altar => "火",
            _ => "·",
        };

        /// <summary>徽记颜色（Three.js AdventureHUD：交战红、肃清青绿、未动琥珀；藏宝纸白、出口青、首领朱砂、灵火冰蓝）</summary>
        public static Color Color(MapMarker k)
        {
            if (k.state == MarkerState.Done) return new Color(0.569f, 0.843f, 0.745f, 0.75f);
            return k.kind switch
            {
                MapPoiKind.Site => k.state == MarkerState.Active ? Hex.Rgb(0xff9476) : Hex.Rgb(0xe6b679),
                MapPoiKind.Cache => k.state == MarkerState.Active ? Hex.Rgb(0xff9476) : Hex.Rgb(0xefe4cc),
                MapPoiKind.Camp => UITheme.GoldHi,
                MapPoiKind.Exit => UITheme.JadeHi,
                MapPoiKind.Boss => Hex.Rgb(0xff6a4d),
                MapPoiKind.Altar => SpiritAltar.FlameColor,
                _ => UITheme.Paper,
            };
        }
    }
}
