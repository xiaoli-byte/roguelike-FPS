using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.AI;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>一个刷怪锚点（声明的 + 场景里 EncounterSite 的），带按编制算出的最大体型</summary>
    public sealed class AnchorInfo
    {
        public string name, site;
        public Vector3 pos;
        public string[] enemies;
        public bool flying;
        /// <summary>会在这里出生的最大体型（半径、身高，已乘 scale 和精英 ×1.25）与它的 id</summary>
        public float radius, height;
        public string largest;
    }

    /// <summary>
    /// 规则集共享的上下文：声明数据、场景扫描结果（锚点、场地、交互点）、NavMesh 小工具，以及按需建一次的玩家可达性栅格
    /// （<see cref="Grid"/> + <see cref="Reach"/>；几条检查共用，只算一次）。
    /// </summary>
    public sealed class LevelContext
    {
        public readonly LevelSpec spec;
        /// <summary>可站立面 = 世界层（不含 Ignore Raycast 上的不可见墙）</summary>
        public static int StandMask => Layers.WorldMask;
        /// <summary>挡玩家的东西 = 世界层 + 不可见墙</summary>
        public static int BlockMask => Layers.WorldMask | (1 << Layers.IgnoreRaycast);

        public LevelContext(LevelSpec spec)
        {
            this.spec = spec;
            Physics.SyncTransforms();
            // 没声明出生点：用场景里的 PlayerSpawn 标记（L1）
            if (spec.playerSpawn == Vector3.zero)
            {
                var ps = Object.FindAnyObjectByType<PlayerSpawn>();
                if (ps) spec.playerSpawn = ps.transform.position;
            }
        }

        // ───────────── 尺度、栅格、洪泛 ─────────────
        MoveScale scale;
        JumpEnvelope envelope;
        ReachGrid grid;
        ReachFlood reach, reachNoWalls;
        bool noWallsDone;
        int startSpan = -2;
        Rect? insideBounds;
        public bool ReachBuilt { get; private set; }
        public double ReachSeconds { get; private set; }

        public MoveScale Scale => scale ??= MoveScale.FromScene();
        public JumpEnvelope Envelope => envelope ??= JumpEnvelope.Build(Scale);

        /// <summary>界内范围（遮罩 ≥ 阈值的格子的包围盒；没有遮罩时为空）</summary>
        public Rect InsideBounds
        {
            get
            {
                if (insideBounds.HasValue) return insideBounds.Value;
                var r = Rect.zero;
                if (spec.playable != null)
                {
                    var b = WorldBounds;
                    float step = Mathf.Max(1f, Mathf.Sqrt(b.width * b.height / 250_000f));
                    float x0 = float.MaxValue, z0 = float.MaxValue, x1 = float.MinValue, z1 = float.MinValue;
                    for (float z = b.yMin; z <= b.yMax; z += step)
                    for (float x = b.xMin; x <= b.xMax; x += step)
                    {
                        if (spec.playable(new Vector2(x, z)) < spec.playableThreshold) continue;
                        x0 = Mathf.Min(x0, x); x1 = Mathf.Max(x1, x);
                        z0 = Mathf.Min(z0, z); z1 = Mathf.Max(z1, z);
                    }
                    if (x0 <= x1) r = Rect.MinMaxRect(x0 - step, z0 - step, x1 + step, z1 + step);
                }
                insideBounds = r;
                return r;
            }
        }

        /// <summary>声明的验收区域；没声明就取地形（全部 Terrain 的并集），再没有就取出生点周围 200 m</summary>
        public Rect WorldBounds
        {
            get
            {
                if (spec.bounds.width > 0 && spec.bounds.height > 0) return spec.bounds;
                var ts = Terrain.activeTerrains;
                if (ts.Length > 0)
                {
                    float x0 = float.MaxValue, z0 = float.MaxValue, x1 = float.MinValue, z1 = float.MinValue;
                    foreach (var t in ts)
                    {
                        var p = t.transform.position;
                        var s = t.terrainData.size;
                        x0 = Mathf.Min(x0, p.x); z0 = Mathf.Min(z0, p.z);
                        x1 = Mathf.Max(x1, p.x + s.x); z1 = Mathf.Max(z1, p.z + s.z);
                    }
                    return Rect.MinMaxRect(x0, z0, x1, z1);
                }
                return new Rect(spec.playerSpawn.x - 200, spec.playerSpawn.z - 200, 400, 400);
            }
        }

        /// <summary>俯视图范围：声明的 → 界内外扩 12 m → 验收区域</summary>
        public Rect MapArea
        {
            get
            {
                if (spec.mapArea.width > 0 && spec.mapArea.height > 0) return spec.mapArea;
                var inside = InsideBounds;
                if (inside.width > 0) return Rect.MinMaxRect(inside.xMin - 12, inside.yMin - 12, inside.xMax + 12, inside.yMax + 12);
                return WorldBounds;
            }
        }

        /// <summary>可站立面栅格（界内外扩到够得着越界的范围；格子 1 m，太大的图自动放粗到 ≤ 20 万列）</summary>
        public ReachGrid Grid
        {
            get
            {
                if (grid != null) return grid;
                var sw = Stopwatch.StartNew();
                var world = WorldBounds;
                var inside = InsideBounds;
                var area = world;
                if (inside.width > 0)
                {
                    float pad = spec.escapeMargin + 16f;
                    area = Rect.MinMaxRect(Mathf.Max(world.xMin, inside.xMin - pad), Mathf.Max(world.yMin, inside.yMin - pad),
                        Mathf.Min(world.xMax, inside.xMax + pad), Mathf.Min(world.yMax, inside.yMax + pad));
                }
                float cell = Mathf.Max(1f, Mathf.Sqrt(area.width * area.height / 200_000f));
                grid = ReachGrid.Build(area, cell, Scale, StandMask, spec.playable, spec.playableThreshold);
                ReachSeconds += sw.Elapsed.TotalSeconds;
                ReachBuilt = true;
                return grid;
            }
        }

        /// <summary>出生点所在的可站立面（找不到为 −1）</summary>
        public int StartSpan
        {
            get
            {
                if (startSpan == -2) startSpan = Grid.Near(spec.playerSpawn, 2.5f, 2.5f);
                return startSpan;
            }
        }

        /// <summary>现在的样子（不可见墙也挡路），全部能力（含二段跳）</summary>
        public ReachFlood Reach
        {
            get
            {
                if (reach != null) return reach;
                var sw = Stopwatch.StartNew();
                reach = ReachFlood.Run(Grid, Envelope, Scale, StartSpan, BlockMask, Move.DoubleJump, spec.escapeMargin);
                ReachSeconds += sw.Elapsed.TotalSeconds;
                return reach;
            }
        }

        /// <summary>场景里有没有不可见墙（Ignore Raycast 层上的实体碰撞体）</summary>
        public bool HasInvisibleWalls =>
            Object.FindObjectsByType<Collider>().Any(c => c.enabled && !c.isTrigger && c.gameObject.layer == Layers.IgnoreRaycast);

        /// <summary>撤掉不可见墙之后（软边界就绪检查）；没有不可见墙时为 null</summary>
        public ReachFlood ReachWithoutWalls
        {
            get
            {
                if (noWallsDone) return reachNoWalls;
                noWallsDone = true;
                if (!HasInvisibleWalls) return null;
                var sw = Stopwatch.StartNew();
                reachNoWalls = ReachFlood.Run(Grid, Envelope, Scale, StartSpan, StandMask, Move.DoubleJump, spec.escapeMargin);
                ReachSeconds += sw.Elapsed.TotalSeconds;
                return reachNoWalls;
            }
        }

        /// <summary>某个地面点在可达性洪泛里的档位：附近 searchRadius 米、高差 ≤ maxDy 的面里取最弱的档位</summary>
        public Move TierAt(ReachFlood f, Vector3 p, float searchRadius = 2f, float maxDy = 2.5f)
        {
            var best = Move.None;
            foreach (var i in f.grid.InDisc(p, searchRadius + f.grid.cell * 0.5f))
                if (Mathf.Abs(f.grid.spanY[i] - p.y) <= maxDy && f.tier[i] < (byte)best) best = (Move)f.tier[i];
            return best;
        }

        /// <summary>p 附近（水平 searchRadius、高差 maxDy）有没有可站立面（不管到不到得了）</summary>
        public bool AnySpan(Vector3 p, float searchRadius, float maxDy)
        {
            foreach (var i in Grid.InDisc(p, searchRadius + Grid.cell * 0.5f))
                if (Mathf.Abs(Grid.spanY[i] - p.y) <= maxDy) return true;
            return false;
        }

        /// <summary>场地圆盘（直径 = 设计尺寸）里不靠二段跳就能到的可站立面</summary>
        public List<int> SiteSpans(SiteSpec site, Move atMost = Move.Dash)
        {
            var f = Reach;
            var list = new List<int>();
            foreach (var s in Grid.InDisc(site.center, site.Radius))
                if (f.Reached(s, atMost)) list.Add(s);
            return list;
        }

        // ───────────── NavMesh ─────────────
        Vector3? spawnNav;
        bool spawnNavDone;

        /// <summary>出生点在 NavMesh 上的投影（没有为 null）</summary>
        public Vector3? SpawnNav
        {
            get
            {
                if (spawnNavDone) return spawnNav;
                spawnNavDone = true;
                if (NavPoint(spec.playerSpawn, 4f, out var p)) spawnNav = p;
                return spawnNav;
            }
        }

        public static bool NavPoint(Vector3 p, float radius, out Vector3 onNav)
        {
            onNav = p;
            if (!NavMesh.SamplePosition(p, out var hit, radius, NavMesh.AllAreas)) return false;
            onNav = hit.position;
            return true;
        }

        /// <summary>NavMesh 路径：返回状态与长度</summary>
        public static NavMeshPathStatus NavPath(Vector3 from, Vector3 to, out float length)
        {
            var path = new NavMeshPath();
            NavMesh.CalculatePath(from, to, NavMesh.AllAreas, path);
            length = 0;
            for (int k = 0; k + 1 < path.corners.Length; k++) length += Vector3.Distance(path.corners[k], path.corners[k + 1]);
            return path.status;
        }

        // ───────────── 场景扫描 ─────────────
        List<AnchorInfo> anchors;
        List<SiteSpec> sites;
        List<InteractSpec> interactables;

        /// <summary>声明的锚点 + 场景里每个 EncounterSite 的锚点（敌人 = 该场地全部编制）</summary>
        public IReadOnlyList<AnchorInfo> Anchors
        {
            get
            {
                if (anchors != null) return anchors;
                anchors = new List<AnchorInfo>();
                foreach (var a in spec.anchors)
                    anchors.Add(Sized(new AnchorInfo { name = a.name, site = "", pos = a.pos, enemies = a.enemies, flying = a.flying }, null));
                foreach (var site in Object.FindObjectsByType<EncounterSite>().OrderBy(s => s.name))
                {
                    var ids = site.squads.Where(q => q != null && !string.IsNullOrEmpty(q.enemy)).Select(q => q.enemy).Distinct().ToArray();
                    foreach (var t in site.anchors)
                    {
                        if (!t) continue;
                        anchors.Add(Sized(new AnchorInfo { name = t.name, site = site.title, pos = t.position, enemies = ids }, site.squads));
                    }
                }
                return anchors;
            }
        }

        static AnchorInfo Sized(AnchorInfo a, EncounterSite.Squad[] squads)
        {
            IEnumerable<(EnemyDef def, bool elite)> roster;
            if (squads != null && squads.Length > 0)
                roster = squads.Where(q => q != null).Select(q => (EnemyRoster.Get(q.enemy), q.elite)).Where(x => x.Item1 != null);
            else if (a.enemies != null && a.enemies.Length > 0)
                roster = a.enemies.Select(id => (EnemyRoster.Get(id), false)).Where(x => x.Item1 != null);
            else roster = EnemyRoster.All.Select(d => (d, false));
            foreach (var (def, elite) in roster)
            {
                float k = def.scale * (elite ? 1.25f : 1f);
                if (def.radius * k > a.radius) { a.radius = def.radius * k; a.largest = def.id + (elite ? "（精英）" : ""); }
                a.height = Mathf.Max(a.height, def.height * k);
            }
            if (a.radius <= 0) { a.radius = 0.5f; a.height = 1.8f; a.largest = "（默认）"; }
            return a;
        }

        /// <summary>声明的场地；没声明就用场景里的 EncounterSite（尺寸 = 场地半径 × 2）</summary>
        public IReadOnlyList<SiteSpec> Sites
        {
            get
            {
                if (sites != null) return sites;
                sites = spec.sites.Count > 0
                    ? new List<SiteSpec>(spec.sites)
                    : Object.FindObjectsByType<EncounterSite>().OrderBy(s => s.name)
                        .Select(s => new SiteSpec { name = s.title, center = s.transform.position, size = s.arenaRadius * 2 }).ToList();
                return sites;
            }
        }

        /// <summary>声明的交互点 + 场景里的 IInteractable + 场地肃清后宝箱的落点（同 LootDirector：场地中心 + chestOffset，吸附到 NavMesh）</summary>
        public IReadOnlyList<InteractSpec> Interactables
        {
            get
            {
                if (interactables != null) return interactables;
                interactables = new List<InteractSpec>(spec.interactables);
                foreach (var mb in Object.FindObjectsByType<MonoBehaviour>())
                {
                    if (mb is not IInteractable it) continue;
                    interactables.Add(new InteractSpec
                    {
                        name = mb.name, kind = mb.GetType().Name, focus = it.Focus, radius = it.Radius, owner = mb.transform,
                    });
                }
                foreach (var site in Object.FindObjectsByType<EncounterSite>().OrderBy(s => s.name))
                {
                    if (string.IsNullOrEmpty(site.reward)) continue;
                    var p = site.transform.position + site.chestOffset;
                    if (NavPoint(p, 4f, out var onNav)) p = onNav;
                    if (Physics.Raycast(p + Vector3.up * 4, Vector3.down, out var hit, 12, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
                    interactables.Add(new InteractSpec
                    {
                        name = $"{site.title} 宝箱（{site.reward}）", kind = "Chest", focus = p + Vector3.up * 0.6f, radius = 2.6f,
                        footprint = new Vector3(0.6f, 0.4f, 0.6f),
                    });
                }
                return interactables;
            }
        }

        /// <summary>地面高度（世界层自上而下射线；打不到返回 p.y）</summary>
        public static float GroundY(Vector3 p, float above = 30f)
        {
            return Physics.Raycast(p + Vector3.up * above, Vector3.down, out var hit, above + 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : p.y;
        }

        public static string At(Vector3 p) => $"({p.x:F0}, {p.z:F0})";
    }
}
