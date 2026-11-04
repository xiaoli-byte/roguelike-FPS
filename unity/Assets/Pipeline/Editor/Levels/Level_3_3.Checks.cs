using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.AI;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // 3-3 自查、L5 声明（LevelSpec）、截图机位
    public static partial class Level_3_3
    {
        /// <summary>白盒自查：梯坊台面、渠底、熔铜瀑落差、桥面贴台、熔岩分组（漫溢只碰神范台）、涨落参数、风闸 / 领主战 / 熔流闸接线、首领场西南 12 m、第三章占位件清单</summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, LavaSet lava, List<GameObject> decks, Hall hall, FoundryWindGate gate, Lord lord, List<LavaSluice> sluices)
        {
            rep.Section("地形 · 梯坊 · 熔铜瀑 · 桥");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("T0 南闸前地", Y(new Vector2(80, 10)), T0, 0.3f);
            Near("T1 ① 范场", Y(new Vector2(47, 52)), T1, 0.3f);
            Near("T1 ③ 浇包吊坊（槽间）", Y(new Vector2(165, 56)), T1, 0.3f);
            Near("T2 鼓风正殿", Y(new Vector2(47, 140)), T2, 0.3f);
            Near("T2 东中台", Y(new Vector2(130, 82)), T2, 0.3f);
            Near("T2 废范龛", Y(new Vector2(23, 196)), T2, 0.3f);
            Near("T3 神范前庭", Y(new Vector2(72, 192)), T3, 0.3f);
            Near("神范台床面", Y(new Vector2(118, 176)), 0, 0.05f);
            foreach (var pl in Platforms) Near($"{pl.name}台顶", Y(pl.Center + new Vector2(0.5f, 0.5f)), pl.Top, 0.35f);
            foreach (var r in Ramps)
            {
                float maxGrade = 0;
                for (float t = 0; t < 1f; t += 0.02f)
                {
                    var a = Vector2.Lerp(r.foot, r.top, t);
                    var b = Vector2.Lerp(r.foot, r.top, t + 0.02f);
                    maxGrade = Mathf.Max(maxGrade, Mathf.Atan2(Mathf.Abs(Y(b) - Y(a)), Vector2.Distance(a, b)) * Mathf.Rad2Deg);
                }
                if (maxGrade > 24f) rep.Fail($"{r.name}（{r.footY:0} → {r.topY:0}，{r.Length:F0} m）最陡 {maxGrade:F0}°（应 ≤ 24°）");
                else rep.Line($"✓ {r.name}：{r.footY:0} → {r.topY:0}，{r.Length:F0} m，最陡 {maxGrade:F0}°");
            }
            Near("主渠渠底", Y(new Vector2(100, 150)), FieldFloor, 0.3f);
            Near("横渠渠底", Y(new Vector2(150, 110)), FieldFloor, 0.3f);
            Near("神范南北渠渠底", Y(new Vector2(152, 200)), ArenaFloor, 0.3f);
            Near("神范熔池池底", Y(Basin), ArenaFloor, 0.2f);
            Near("熔铜瀑上段渠底（T2）", Y(new Vector2(99, 96)), T2 + FieldFloor, 0.35f);
            Near("熔铜瀑中段渠底（T1）", Y(new Vector2(102, 62)), T1 + FieldFloor, 0.35f);
            Near("熔铜瀑下段渠底（T0）", Y(new Vector2(113, 31.5f)), T0 + FieldFloor, 0.35f);
            // 三处瀑口：上一级渠底 → 下一级渠底，各落 4 m
            for (int i = 0; i + 1 < Falls.Length; i++)
            {
                if (Mathf.Abs(Falls[i].level - Falls[i + 1].level) < 0.01f) continue;
                var dir = (Falls[i + 1].p - Falls[i].p).normalized;
                float up = Y(Falls[i].p - dir * 1.5f), down = Y(Falls[i + 1].p + dir * 1.5f);
                float drop = up - down, want = Falls[i].level - Falls[i + 1].level;
                if (Mathf.Abs(drop - want) > 0.6f) rep.Fail($"瀑口 {Falls[i].p}：渠底落差 {drop:F1} m（应 {want:F0} m）");
                else rep.Line($"✓ 瀑口 ({Falls[i].p.x:0}, {Falls[i].p.y:0})：{Falls[i].level:0} → {Falls[i + 1].level:0}，渠底落 {drop:F1} m");
            }

            // 编辑器里 LavaVolume 不登记进 LavaField（OnEnable 不跑）：自己收一份判定体
            var bodies = lava.All.Where(v => v).Select(v => v.Body).ToList();

            // 桥：桥面贴台（两头落脚点与桥面高差 ≤ 0.2 m），桥面不在任何熔岩判定里
            int badDeck = 0;
            foreach (var b in Bridges)
            {
                var c = b.center;
                float half = b.span * 0.5f;
                float y0 = Y(c - b.along * (half + 0.8f)), y1 = Y(c + b.along * (half + 0.8f));
                var top = new Vector3(c.x, b.DeckY, c.y);
                bool dry = !LavaGeometry.Touches(bodies, top + Vector3.up * 0.02f);
                if (Mathf.Abs(y0 - b.DeckY) > 0.2f || Mathf.Abs(y1 - b.DeckY) > 0.2f || !dry)
                {
                    badDeck++;
                    rep.Fail($"{b.id} {b.name}：两头台面 y {y0:F2} / {y1:F2}，桥面 {b.DeckY:F2}{(dry ? "" : "，桥面在熔岩判定里")}");
                }
            }
            if (badDeck == 0) rep.Line($"✓ {Bridges.Length} 座铁桥：桥面与两头台面齐平（±0.2 m），桥面干燥（熔铜瀑 {Bridges.Count(b => b.ch == null)} 座、主渠 / 横渠 {Bridges.Count(b => b.ch != null && !b.arena)} 座、神范台 {Bridges.Count(b => b.arena)} 座）");
            int placeholderDecks = decks.Count(IsPlaceholder);
            rep.Line($"熔岩：涨落 {lava.tides.Count} 段（主渠、横渠东段、熔铜瀑三级、瀑池、熔铜潭；风闸拉开前关着，涨 {TideHeight} m 只在渠里）、" +
                     $"神范台 {lava.surge.Count} 片（领主战漫溢 +{SurgeRise} m）、静止 {lava.still.Count} 片（桥下、溢流槽、废铜池、炉前熔池）");
            foreach (var v in lava.tides)
                if (v.tide.enabled || !(v.tide.height > 0)) rep.Fail($"{v.name}：自动涨落应写好参数、开局关着（enabled {v.tide.enabled}，height {v.tide.height}）");
            // 风险 5：领主战漫溢只碰神范台（十字浅渠 + 熔池都在神范台块里），熔铜瀑 / 主渠 / 横渠不在漫溢表里
            var outside = lava.surge.Where(v => v.transform.position.x < 104 || v.transform.position.z < 114).ToList();
            if (outside.Count > 0) rep.Fail($"领主战漫溢的熔岩里有神范台块之外的：{string.Join("、", outside.Select(v => v.name))}");
            else if (lava.surge.Any(v => lava.tides.Contains(v))) rep.Fail("同一片熔岩既在漫溢表又在涨落表");
            else rep.Line($"✓ 领主战漫溢只碰神范台（{lava.surge.Count} 片都在 x ≥ 104、z ≥ 114），熔铜瀑段和神范台段分开");
            // 渠岸在基准面时是干的，漫溢后是熔岩
            var strip = new Vector3(ArenaX.a.x + ArenaHalf + 1.5f, 0.02f, 200f);
            bool dryLow = !LavaGeometry.Touches(bodies, strip);
            var saved = bodies.Select(b => (b, b.level)).ToList();
            foreach (var v in lava.surge) v.Body.level = v.BaseLevel + SurgeRise;
            bool wetHigh = LavaGeometry.Touches(bodies, strip);
            foreach (var (b, l) in saved) b.level = l;
            if (!dryLow || !wetHigh) rep.Fail($"神范台渠岸：基准面时干燥 {dryLow}、漫溢后算熔岩 {wetHigh}（应为 true / true）");
            else rep.Line($"✓ 神范台渠岸 ({strip.x:F1}, {strip.z:F0})：基准面时干燥，漫溢 +{SurgeRise} m 后算熔岩");
            // 风险 5：首领场西、南两侧外 12 m（主渠西岸 x 84–96、横渠南岸 z 94–106）不低于 0 m——从首领场跳出去不会多掉一级
            int low = 0, probes = 0;
            float lowest = float.MaxValue;
            Vector2 lowAt = default;
            void Probe(Vector2 q)
            {
                probes++;
                float y = Y(q);
                if (y < lowest)
                {
                    lowest = y;
                    lowAt = q;
                }
                if (y < -0.15f) low++;
            }
            for (float z = 120; z <= 208; z += 2) for (float x = 85; x <= 95; x += 2) Probe(new Vector2(x, z));
            for (float x = 106; x <= 199; x += 2) for (float z = 95; z <= 105; z += 2) Probe(new Vector2(x, z));
            if (low > 0) rep.Fail($"首领场西、南两侧外 12 m 有 {low}/{probes} 个点低于 0 m（最低 {lowest:F2} @ {lowAt}）");
            else rep.Line($"✓ 首领场西、南两侧外 12 m 保持 0 m：{probes} 个点最低 {lowest:F2}（主渠西岸 x 84–96、横渠南岸 z 94–106）");
            SwimmerOnDryLand(rep, bodies, Y);
            WalkableArea(rep);

            rep.Section("鼓风正殿 · 风闸 · 熔流闸 · 领主战");
            rep.Line($"风箱 {hall.bellows.Length} 台（瘪着 × {BellowsRest}），风闸接线：第一次 {gate.firstVisit?.title}、第二次 {gate.secondVisit?.title}（autoTrigger {gate.secondVisit?.autoTrigger}），" +
                     $"风箱道 {gate.laneFrom.Length} 条、涨落渠 {gate.tides.Length} 段");
            if (hall.bellows.Length != 2 || gate.laneFrom.Length != 2 || gate.tides.Length != lava.tides.Count) rep.Fail("风闸接线不全（风箱 2 台、风箱道 2 条、涨落渠 = 涨落段数）");
            if (gate.secondVisit && gate.secondVisit.autoTrigger) rep.Fail("第二次进殿开局就会自动触发（应等风闸）");
            foreach (var s in sluices) LevelKit.CheckLavaSluice(rep, s);
            if (sluices.Count != 2) rep.Fail($"③ 熔流闸 {sluices.Count} 道（应 2：南浇包、北浇包）");
            var enc = lord.encounter;
            rep.Line($"领主战：{enc.bossId}，场地 {lord.arena.halfSize.x * 2:F0} × {lord.arena.halfSize.y * 2:F0} m，熔铜渠 {lord.channels.Count} 片，熔铁闸 {lord.gates.Length} 扇，" +
                     $"首领关流程开局{(enc.enabled ? "开着 ✗" : "关着 ✓")}，出口点 {enc.exitPoint?.position}");
            if (enc.enabled) rep.Fail("首领关流程开局就开着（应等关卡目标完成，由 FoundryLordGate 打开）");
            if (lord.gates.Length != 2) rep.Fail($"熔铁闸 {lord.gates.Length} 扇（应 2：闸前桥、东铸北桥）");
            if (lord.gates.Any(g => g.activeSelf)) rep.Fail("熔铁闸在场景里是开着的（会挡导航烘焙，应关着由 BossEncounter 升起）");

            rep.Section("第三章专用件（ART6 + v2，docs/art/ch3-kit.md、ch3-v2.md 第 6 节）");
            var missing = Ch3Kit.Where(id => !ShowcaseSceneBuilder.Prefab(id)).ToList();
            int boxes = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None).Count(t => t.CompareTag(LevelKit.PlaceholderTag));
            rep.Line(missing.Count == 0
                ? "✓ 第三章专用件都有 Prefab"
                : $"⚠ 缺 {missing.Count} 件第三章专用件的 Prefab：{string.Join("、", missing)}——摆成 PlaceOrBox 白盒 {boxes} 个（铁桥 {placeholderDecks} 座），占位检查只列清单；到齐后自动收紧成不合格");
        }

        /// <summary>
        /// 可走区面积（设计口径，ch3-v2 2.2「干地可走」）：1 m 网格扫火山口底，落在梯坊 / 坡道里、又不在渠 / 池里的格子。
        /// L5 防越界的「可达」把二段跳能落脚的岩丘顶、掩体顶、台顶都算进去，比这个大
        /// </summary>
        static void WalkableArea(LevelKit.Report rep)
        {
            int all = 0, arena = 0;
            for (float x = FloorMin.x + 0.5f; x < FloorMax.x; x += 1f)
            for (float z = FloorMin.y + 0.5f; z < FloorMax.y; z += 1f)
            {
                var p = new Vector2(x, z);
                Terraces(p, out float edge, out _, out _, out _);
                if (edge >= 0) continue;
                FallsFloor(p, out float fd);
                if (fd < FieldHalf) continue;
                bool wet = false;
                foreach (var c in Channels)
                    if (SegDist(p, c.a, c.b) < c.half)
                        wet = true;
                foreach (var (_, c, r, _) in Pools)
                    if (Vector2.Distance(p, c) < r)
                        wet = true;
                if (wet || Vector2.Distance(p, Basin) < BasinR || Polyline(p, Spill).dist < SpillHalf || Vector2.Distance(p, SpillPit) < SpillPitR ||
                    Vector2.Distance(p, FurnacePit) < FurnacePitR) continue;
                all++;
                if (x >= 104 && z >= 114) arena++;
            }
            rep.Line($"可走区（梯坊 + 坡道，去掉渠和池）：{all:N0} m²，其中神范台块（x ≥ 104、z ≥ 114）{arena:N0} m²、其余 {all - arena:N0} m²（ch3-v2：2.4–2.6 万，含神范台 0.77 万）");
        }

        /// <summary>
        /// 火鼍网格（LavaSwimmer）在干地上的残留，按 1 m 网格扫整个火山口底：人形干地网格上比熔岩顶（该处熔岩 + 站立判定）高 0.4 m 以上、
        /// 0.6 m 内（高差 0.5 m 内）又采得到火鼍网格的点（按 8 m 格归并列出）
        /// </summary>
        static void SwimmerOnDryLand(LevelKit.Report rep, List<LavaBody> bodies, Func<Vector2, float> groundY)
        {
            var swim = LevelKit.LavaSwimmerAgentType();
            if (!swim.HasValue || bodies.Count == 0) return;
            var dryF = LavaField.WalkerFilter(LavaField.DryAreaMask);
            var swimF = new NavMeshQueryFilter { agentTypeID = swim.Value, areaMask = NavMesh.AllAreas };
            var cells = new Dictionary<Vector2Int, (int n, Vector3 at)>();
            int total = 0;
            for (float x = FloorMin.x - 4f; x <= FloorMax.x + 4f; x += 1f)
            for (float z = FloorMin.y - 4f; z <= FloorMax.y + 4f; z += 1f)
            {
                var p = new Vector3(x, groundY(new Vector2(x, z)), z);
                if (!NavMesh.SamplePosition(p, out var h, 0.5f, dryF)) continue;
                float lavaTop = float.NegativeInfinity;
                foreach (var b in bodies)
                    if (b.Contains(x, z, 6f))
                        lavaTop = Mathf.Max(lavaTop, b.level);
                if (float.IsNegativeInfinity(lavaTop) || h.position.y < lavaTop + LavaTuning.StandRise + 0.4f) continue;
                if (!NavMesh.SamplePosition(h.position, out var s, 0.6f, swimF) || Mathf.Abs(s.position.y - h.position.y) >= 0.5f) continue;
                total++;
                var key = new Vector2Int(Mathf.FloorToInt(x / 8f), Mathf.FloorToInt(z / 8f));
                cells[key] = cells.TryGetValue(key, out var c) ? (c.n + 1, c.at) : (1, h.position);
            }
            if (total == 0) rep.Line("✓ 火鼍网格在干地上没有残留（1 m 网格扫火山口底，人形干地网格旁 0.6 m 内采不到火鼍网格）");
            else
                rep.Line($"· 火鼍网格在干地上还有 {total} 处（1 m 网格；3-3 没有火鼍，只记录）：" +
                         string.Join("、", cells.OrderByDescending(kv => kv.Value.n).Take(10).Select(kv => $"({kv.Value.at.x:F0}, {kv.Value.at.y:F2}, {kv.Value.at.z:F0}) ×{kv.Value.n}")));
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查 3-3 自己的件（目标图、风闸、领主战、藏宝、熔流闸，没有场景出口）。顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, Sites sites, FoundryWindGate gate, Lord lord, List<LavaSluice> sluices)
        {
            var objective = sites.objective;
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include, FindObjectsSortMode.None).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            void None<T>(string what) where T : Component
            {
                int n = Count<T>();
                if (n > 0) rep.Fail($"场景里有 {n} 个 {what}（应在 Core 场景）");
            }
            None<PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<Hud>("HUD");
            None<GameSession>("会话");
            None<EnemyCatalog>("敌人目录（改由 GameDatabase 提供）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");

            int arenas = Count<BossArena>(), encs = Count<BossEncounter>(), gates = Count<FoundryLordGate>(), winds = Count<FoundryWindGate>(),
                chans = Count<FoundryChannels>(), portals = Count<ExitPortal>(), caches = Count<CachePOI>(), objectives = Count<LevelObjective>(),
                sl = Count<LavaSluice>(), lamps = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None)
                    .Count(t => t.gameObject.scene == scene && t.name == LevelKit.GuideLampName);
            if (arenas != 1 || encs != 1 || gates != 1 || winds != 1 || chans != 1 || objectives != 1)
                rep.Fail($"BossArena {arenas} / BossEncounter {encs} / FoundryLordGate {gates} / FoundryWindGate {winds} / FoundryChannels {chans} / LevelObjective {objectives}（各应为 1）");
            // 场景里不放 ExitPortal：它会接上关卡目标、肃清据点就开门；出口由领主战结算后立在神范前（同 1-4）
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（3-3 的出口由领主战结算后立）");
            if (caches != 2) rep.Fail($"藏宝点 {caches} 处（应为 2）");
            if (sl != 2) rep.Fail($"熔流闸 {sl} 道（应为 2）");
            if (lamps < 10) rep.Fail($"青金引导灯只有 {lamps} 盏（主路每 25–40 m 一盏，应 ≥ 10）");
            if (objective.required.Length != 5 || objective.optional.Length != 1) rep.Fail($"目标图：必清 {objective.required.Length}、可选 {objective.optional.Length}（应为 5 / 1）");
            else
                rep.Line($"✓ 目标图：必清 {string.Join("、", objective.required.Select(s => s.title))}；可选 {objective.optional[0].title}；路遇 {sites.road.title}（不计目标）；" +
                         $"藏宝 {caches} 处；熔流闸 {sl} 道；青金引导灯 {lamps} 盏；下一关 {RunPlan.Next(RunPlan.Get("3-3"))?.Label ?? "?"}");
            // 编组自查（ch3-v2 4.1，InfernoSquads.Check）：每波 ≤ 3 种怪（精英算原种）、同时出场的远程 ≤ 3
            int must = 0, elites = 0, waves = 0, bad = 0;
            foreach (var s in new[] { sites.fan, sites.road, sites.ladle, sites.hall, sites.hall2, sites.forecourt, sites.scrap })
            {
                bad += InfernoSquads.Check(s.spec, s.title, msg => rep.Fail(msg));
                foreach (var w in s.spec.waves)
                {
                    waves++;
                    if (!objective.required.Contains(s)) continue;
                    must += w.entries.Sum(e => e.count);
                    elites += w.entries.Where(e => e.elite).Sum(e => e.count);
                }
            }
            if (bad == 0) rep.Line($"✓ 编组：{waves} 波都 ≤ 3 种怪、远程 ≤ 3；必清 {must} 只、精英 {elites} 只");
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 交给 L5 规则集的声明：主线（出生 → ① → B1 → ③ → 吊坊西北坡 → B2 → 殿东道 → ②④ → 殿北坡 → 风闸 → ⑥ → B5 → ⑤ → 神范台顶出口；
        /// 风闸之后回殿打 ④ 的那一趟往返不计，同原来的口径），主线节拍（S5 PacingCheck），坡度路径（台和坡道），地标视线，场地尺寸取 maps/3-3.md 场地表。
        /// 第三章新件到齐前占位只列清单（Warn），到齐后收紧成 Fail。软边界没有空气墙：越界按兜底环算，火山口壁本身翻不出去
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            // 桥上的路点取桥面（地形在桥下是渠底：按地形贴地会落进渠里，采到渠底的熔岩导航区）
            Vector3 Deck(string id)
            {
                var b = BridgeById(id);
                return new Vector3(b.center.x, b.DeckY, b.center.y);
            }
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true, bool boss = false) =>
                new()
                {
                    name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat, boss = boss,
                    minCoverReach = combat && !boss ? 0.8f : -1f, maxLavaShare = combat && !boss ? 0.35f : -1f,
                };
            var mouldTop = G(MouldAt, 7.8f);
            var windFront = WindGateAt + new Vector2(Mathf.Sin(WindGateYaw * Mathf.Deg2Rad), Mathf.Cos(WindGateYaw * Mathf.Deg2Rad)) * 2f;
            bool kitReady = Ch3Kit.All(id => ShowcaseSceneBuilder.Prefab(id));
            var spec = new LevelSpec
                {
                    id = "3-3", title = "铸范大坊", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    placeholders = kitReady ? PlaceholderPolicy.Fail : PlaceholderPolicy.Warn,
                    sites =
                    {
                        S("南闸楼（缓冲）", Spawn + new Vector2(0, 8), 24, combat: false),
                        S("① 范场", FanSite, 50, cover: 6, layers: 3, overlook: true),
                        S("B1 瀑下桥（路遇）", RoadSite, 24, combat: false),
                        S("③ 浇包吊坊", LadleSite, 48, cover: 6, layers: 3, overlook: true),
                        S("②④ 鼓风正殿", HallSite, 60, cover: 6, layers: 3, overlook: true),
                        S("⑥ 神范前庭", ForecourtSite, 40, cover: 6, layers: 3, overlook: true),
                        S("⑤ 神范台（领主战）", ArenaCenter, 80, cover: 4, layers: 2, overlook: true, boss: true),
                        S("废范龛（可选）", ScrapSite, 28, cover: 2, combat: false),
                    },
                }
                .Route("出生 · 南闸楼", G(Spawn)).Route("闸台坡脚", G(GatePlatform.ramps[0].foot + new Vector2(0, 2)))
                .Route("西南坡顶", G(RampByName("西南坡").top))
                .Route("① 范场", G(FanSite)).Route("B1 瀑下桥", Deck("B1")).Route("③ 浇包吊坊", G(LadleSite))
                .Route("吊坊西北坡顶 · 东中台", G(RampByName("吊坊西北坡").top)).Route("B2 瀑上桥", Deck("B2"))
                .Route("殿东道", G(new Vector2(80, 112))).Route("②④ 鼓风正殿", G(HallSite))
                .Route("殿北坡顶", G(RampByName("殿北坡").top)).Route("风闸", G(windFront))
                .Route("⑥ 神范前庭", G(ForecourtSite)).Route("B5 闸前桥", Deck("B5"))
                .Route("⑤ 神范台（领主战）", G(ArenaCenter)).Route("⑤ 神范台顶（出口）", G(ExitAt))
                .Beat("① 范场", G(FanSite), BeatKind.Fight, 24)
                .Beat("B1 瀑下桥（路遇）", Deck("B1"), BeatKind.Roadside, 9)
                .Beat("③ 浇包吊坊", G(LadleSite), BeatKind.Fight, 26)
                .Beat("B2 瀑上桥（揭示：殿顶屋架与王座同框）", Deck("B2"), BeatKind.Reveal)
                .Beat("② 鼓风正殿", G(HallSite), BeatKind.Fight, 28)
                .Beat("风闸（演出）", G(windFront), BeatKind.Reveal)
                .Beat("④ 鼓风正殿（二）", G(HallSite), BeatKind.Fight, 28)
                .Beat("炉工私藏", G(ForgeCache), BeatKind.Cache)
                .Beat("⑥ 神范前庭", G(ForecourtSite), BeatKind.Fight, 20)
                .Beat("⑤ 熔心魔将", G(PlayerEntryAt), BeatKind.Boss, 10)
                .Beat("神范前出口", G(ExitAt), BeatKind.Exit)
                .Sight("南闸楼 → 火神王座", G(Spawn, 1.62f), FireGodRing, 10, "FireGodThrone")
                .Sight("南闸楼 → 神范", G(Spawn, 1.62f), mouldTop, 8, MouldId)
                .Sight("① 吊梁东墩 → 浇包吊车", new Vector3(PierEast.Center.x, PierEast.Top + 1.62f, PierEast.Center.y),
                    ShowcaseSceneBuilder.Prefab(CraneId) ? new Vector3(CraneX, T1 + 11f, 56) : new Vector3(CraneX, T2 - 0.4f, 58), 6, CraneId)
                .Sight("B2 瀑上桥 → 殿顶屋架", Deck("B2") + Vector3.up * 1.62f, new Vector3(TrussX[0], T2 + 15.5f, 146), 6, TrussId)
                .Sight("殿南口 → 大炉", G(new Vector2(32, 122), 1.62f), G(FurnaceAt, 14f), 6, FurnaceId)
                // 风闸看神范的视线会被闸前桥的熔铁闸门框（12 m 高）挡住：风闸改看王座，神范从闸前楼台看
                .Sight("风闸 → 火神王座", G(windFront, 1.62f), FireGodRing, 10, "FireGodThrone")
                .Sight("⑥ 闸前楼台 → 神范", new Vector3(GateTower.Center.x, GateTower.Top + 1.62f, GateTower.Center.y), mouldTop, 8, MouldId)
                .Sight("⑥ 闸前楼台 → 火神王座", new Vector3(GateTower.Center.x, GateTower.Top + 1.62f, GateTower.Center.y), FireGodRing, 10, "FireGodThrone");
            foreach (var pl in Platforms)
                foreach (var (foot, top, _) in pl.ramps)
                    spec.slopePaths.Add(new SlopePath { name = $"{pl.name}坡道", points = new[] { foot + (foot - top).normalized * 1.5f, top } });
            foreach (var r in Ramps) spec.slopePaths.Add(new SlopePath { name = r.name, points = new[] { r.foot, r.top } });
            return spec;
        }

        // ───────────── 截图 ─────────────
        /// <summary>改后截图（docs/art/review/ch3-v2/3-3/after/，和 before/ 按 pairs.txt 配对）</summary>
        static void Capture(LevelKit.TerrainSet set, Vector3 spawnAt, Quaternion spawnRot)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
            var mouldTop = G(MouldAt, 7.8f);
            var b2 = BridgeById("B2");
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-3", new[]
                {
                    ("Aerial", new Vector3(100, 170, -70), new Vector3(100, -4, 110), false),
                    ("Map", new Vector3(100, 400, 107), new Vector3(100, 0, 107.5f), false),
                    ("Spawn", E(Spawn), new Vector3(102, -1, 82), true),
                    ("SpawnMould", E(Spawn), mouldTop, false),
                    ("SpawnThrone", E(Spawn), FireGodRing, false),
                    ("ArenaThrone", E(new Vector2(152, 121), 2.2f), new Vector3(Basin.x, 22f, 190f), false),
                    ("Fan", E(new Vector2(67, 36)), G(new Vector2(44, 58), 2), false),
                    ("RoadBridge", E(new Vector2(88, 50)), new Vector3(112, T1 + 2, 52), false),
                    ("LadleYard", E(new Vector2(131, 51)), new Vector3(CraneX, T1 + 2.5f, 56), false),
                    ("Crane", E(new Vector2(CraneX - 1, 77)), G(new Vector2(148, 50), 0), false),
                    ("UpperBridge", new Vector3(b2.center.x + 3, b2.DeckY + 1.62f, b2.center.y), new Vector3(TrussX[1], T2 + 14f, 146), false),
                    ("HallSouth", E(new Vector2(32, 122)), G(FurnaceAt, 9), false),
                    ("HallLanes", E(new Vector2(80, 137)), G(new Vector2(24, 146), 3), false),
                    ("Altar", E(AltarNorth.Center, AltarNorth.h + 1.62f), G(BellowsB, 3), false),
                    ("WindGate", E(WindGateAt), G(HallSite, 2), false),
                    ("Forecourt", E(new Vector2(62, 173)), G(new Vector2(90, 190), 3), false),
                    ("Sluice", E(new Vector2(92, 200)), G(SluiceAt, 4), false),
                    ("ArenaNW", E(new Vector2(112, 176)), G(ArenaCenter, 1), false),
                    ("ArenaDais", E(ExitAt, Dais.h + 1.62f), G(ArenaCenter, 0), false),
                    ("ScrapNiche", E(new Vector2(36, 186)), G(ScrapSite, 1), false),
                    // 闸前桥东头的熔铁闸门框（门洞开着：闸板平时沉在地下，开战才升起）
                    ("GateFrameB5", new Vector3(97, BridgeById("B5").DeckY + 1.62f, 172.5f), new Vector3(108, 4.5f, 176), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }
    }
}
