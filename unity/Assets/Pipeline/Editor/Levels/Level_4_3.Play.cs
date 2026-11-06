using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // 4-3 彩林海子 · 玩法：五处据点（任意顺序，各一座灵火坛，守卫肃清后才点得着）+ 谷口经幡门的守卫；点亮任意三处灵火，经幡门里的出口升起。
    // 规则同 4-1（C4-3：开放图、据点任意顺序、点亮 3 处灵火开出口），只是没有领主。设计见 docs/level-design/maps/4-3.md 第 3 节
    public static partial class Level_4_3
    {
        /// <summary>点亮几处灵火开出口</summary>
        const int FiresToUnlock = 3;

        /// <summary>
        /// 一处据点：中心（世界 XZ）、领地半径、灵火坛位置、兽群（kind、相对中心的偏移、是不是哨兵）。
        /// 半径 = 场地半径（触发圈 0.75 倍）；领地里不种树（0.6 倍以内是空地，往外渐渐回到林子）
        /// </summary>
        sealed class SiteDef
        {
            public string id, name, title, hint, reward;
            public Vector2 c;
            public float r;
            public Vector2? altar;
            public (string kind, float dx, float dz, bool sentinel)[] units;
        }

        static readonly SiteDef[] Sites =
        {
            new()
            {
                id = "s1", name = "① 东岸塌方", title = "东岸塌方兽群", c = new(192, 70), r = 34, altar = new(170, 52), reward = "weapon",
                hint = "连鼓灵给同伴上护盾——先打它；举父蹲在塌方的大石后面扔石头",
                units = new[] { ("tiangou", -8f, -10f, false), ("tiangou", 4f, -14f, false), ("tiangou", 10f, -6f, false), ("jufu", 7f, 9f, false), ("jufu", -7f, 12f, false), ("liangu", 0f, 18f, false) },
            },
            new()
            {
                id = "s2", name = "② 北岸金林", title = "北岸金林兽群", c = new(-20, 128), r = 36, altar = new(-8, 100), reward = "scroll",
                hint = "先点倒木上的哨兵，别让它尖啸叫醒一窝；帝江在林子里绕着你跳",
                units = new[]
                {
                    ("marmot", 4f, 6f, true), ("marmot", -6f, 2f, false), ("marmot", 8f, -4f, false), ("marmot", -10f, 12f, false), ("marmot", 12f, 14f, false),
                    ("dijiang", -14f, -12f, false), ("dijiang", 16f, -10f, false), ("dijiang", 0f, 22f, false),
                },
            },
            new()
            {
                id = "s3", name = "③ 西岸霜滩", title = "西岸霜滩兽群", c = new(-205, -15), r = 34, altar = new(-198, -44), reward = "upgrade",
                hint = "蛮蛮在水面上空盘旋，站到大石后面躲它的俯冲",
                units = new[] { ("manman", -4f, 8f, false), ("manman", 8f, 2f, false), ("tiangou", 10f, -10f, false), ("tiangou", -10f, -8f, false), ("tiangou", 2f, -16f, false), ("liangu", -12f, 14f, false) },
            },
            new()
            {
                id = "s4", name = "④ 玛尼石滩", title = "玛尼石滩兽群", c = new(-75, 330), r = 38, altar = new(-58, 312), reward = "scroll",
                hint = "獓狠冲锋前有冲撞线——横移让开，玛尼墙是掩体",
                units = new[] { ("aoyin", 0f, 12f, false), ("leiyak", -10f, 0f, false), ("leiyak", 10f, -4f, false), ("dijiang", -14f, 16f, false), ("dijiang", 14f, 18f, false) },
            },
            new()
            {
                id = "s5", name = "⑤ 南坡猎人营地", title = "猎人营地兽群", c = new(80, -255), r = 34, altar = new(66, -236), reward = "scroll",
                hint = "营地边上的哨兵先点掉；举父在帐篷后面",
                units = new[]
                {
                    ("jufu", 7f, 9f, false), ("jufu", -9f, 10f, false), ("marmot", -4f, -10f, true), ("marmot", 6f, -12f, false), ("marmot", -10f, -4f, false), ("marmot", 12f, 0f, false),
                    ("tiangou", 0f, 16f, false), ("tiangou", -14f, 14f, false),
                },
            },
            new()
            {
                id = "pass", name = "⑥ 谷口经幡门", title = "谷口守卫", c = new(-112, 528), r = 30, altar = null, reward = "",
                hint = "出口前的考试：獓狠和雷牦一起冲，举父在后面",
                units = new[] { ("aoyin", 0f, -6f, false), ("leiyak", -8f, -12f, false), ("jufu", 8f, -10f, false) },
            },
        };

        /// <summary>谷口经幡门（出口）：两根经幡杆之间，门朝南（玩家从湖那边走上来）</summary>
        static readonly Vector2 GateAt = new(-118, 552);

        static SiteDef SiteById(string id) => Sites.First(s => s.id == id);

        static StationRole RoleOf(string kind) => kind switch
        {
            "tiangou" => StationRole.Flank,
            "jufu" => StationRole.Artillery,
            "manman" => StationRole.Ranged,
            "liangu" => StationRole.Support,
            _ => StationRole.Assault,
        };

        /// <summary>据点、灵火坛、经幡门周围不种树（0..1：0 = 空地）</summary>
        static float SiteClearing(float x, float z)
        {
            var p = new Vector2(x, z);
            float k = 1;
            foreach (var s in Sites)
            {
                float d = Vector2.Distance(p, s.c);
                if (d < s.r * 1.05f) k = Mathf.Min(k, S(s.r * 0.6f, s.r * 1.05f, d));
                if (s.altar is { } a) k = Mathf.Min(k, S(7, 12, Vector2.Distance(p, a)));
            }
            k = Mathf.Min(k, S(12, 22, Vector2.Distance(p, GateAt)));
            return k;
        }

        static Vector3 G(float x, float z, float dy = 0) => new(x, GroundY(x, z) + dy, z);
        static Vector3 G(Vector2 p, float dy = 0) => G(p.x, p.y, dy);

        /// <summary>离 (x, z) 最近的一处能站的地面：不在湖里、坡度 ≤ 20°、放得下第四章最大的雷魅（半径 1.2 m、高 2.4 m），螺旋往外找 20 m</summary>
        static Vector3 DryNear(float x, float z)
        {
            for (float r = 0; r <= 20; r += 1.5f)
            {
                int n = r < 0.1f ? 1 : Mathf.Max(6, Mathf.RoundToInt(r * 2.5f));
                for (int i = 0; i < n; i++)
                {
                    float a = i * Mathf.PI * 2 / n;
                    float px = x + Mathf.Cos(a) * r, pz = z + Mathf.Sin(a) * r;
                    if (Eval(px, pz).lakeR < 1.1f || ts.Slope(new Vector2(px, pz)) > 20) continue;
                    var g = G(px, pz);
                    if (Physics.CheckCapsule(g + Vector3.up * 1.6f, g + Vector3.up * 2.4f, 1.2f, ~0, QueryTriggerInteraction.Ignore)) continue;
                    return g;
                }
            }
            return G(x, z);
        }

        // ───────────── 掩体与场景件（白盒，资产 id 沿用第四章的 SM_Tripo_Plateau*，正式件到了自动换上）─────────────

        static LevelKit.PrayerFlags flags;
        static Vector3 gateCenter;

        const string IdBoulder = "SM_Tripo_PlateauBoulder", IdManiWall = "SM_Tripo_PlateauManiWall", IdManiPile = "SM_Tripo_PlateauManiPile",
            IdBlackTent = "SM_Tripo_PlateauBlackTent", IdPole = "SM_Tripo_PlateauFlagPole", IdAltarPosts = "SM_Tripo_PlateauAltarPosts",
            IdLog = "SM_Tripo_LarchFallenLog", IdLogPile = "SM_Tripo_LarchLogPile", IdRack = "SM_Tripo_LarchHunterRack";

        static GameObject Boulder(Transform parent, float x, float z, float size, int seed, string label)
        {
            string key = size > 2.2f ? "larchBoulderL" : size > 1.5f ? "larchBoulderM" : "larchBoulderS";
            float r = size > 2.2f ? 2.6f : size > 1.5f ? 1.8f : 1.2f;
            return LevelKit.PlateauPiece(Dir, IdBoulder, key, parent, G(x, z, -0.35f), Landform.Hash(seed, 7, 3) * 360, 0, b =>
            {
                b.Seed(seed);
                b.Rock("rock", Vector3.zero, r, 0.72f, seed);
                b.Rock("rockDark", new Vector3(r * 0.55f, 0, r * 0.3f), r * 0.55f, 0.6f, seed + 1);
                b.ColCyl(Vector3.zero, r * 0.9f, r * 1.4f);
            }, label);
        }

        static GameObject Log(Transform parent, float x, float z, float yaw, string label) =>
            LevelKit.PlateauPiece(Dir, IdLog, "larchLog", parent, G(x, z, -0.1f), yaw, 0, b =>
            {
                b.Rod("woodDark", new Vector3(-4.2f, 0.4f, 0), new Vector3(4.2f, 0.45f, 0), 0.42f, 8);
                b.Rod("woodDark", new Vector3(1.5f, 0.45f, 0), new Vector3(2.6f, 1.2f, 0.7f), 0.14f);
                b.Cyl("wood", new Vector3(-4.3f, 0, 0), 0.6f, 0.5f, 0.9f, 8);
                b.ColBox(new Vector3(0, 0, 0), new Vector3(8.6f, 0.85f, 0.9f));
            }, label);

        /// <summary>
        /// 据点的掩体：① 塌方的大石和断木横在车路上；② 林间空地的倒木、木柴垛；③ 霜滩的大石；④ 玛尼墙、玛尼堆、经幡杆；⑤ 黑帐篷、猎架、火塘；
        /// ⑥ 谷口经幡门（两根经幡杆 + 横拉的经幡）
        /// </summary>
        static void BuildSiteProps(Transform props)
        {
            flags = new LevelKit.PrayerFlags { wind = new Vector2(0.85f, 0.5f) };
            var root = new GameObject("Site Props · 据点").transform;
            root.SetParent(props, false);

            // ① 东岸塌方：车路上一堆滚石 + 两根断木
            var s1 = SiteById("s1").c;
            (float dx, float dz, float size)[] rocks1 = { (-4, 4, 2.6f), (6, 2, 1.9f), (2, 10, 2.4f), (-9, 13, 1.6f), (10, 12, 1.4f), (-2, -6, 1.2f), (14, -2, 2.0f) };
            int i = 0;
            foreach (var (dx, dz, size) in rocks1) Boulder(root, s1.x + dx, s1.y + dz, size, 101 + i++, "塌方滚石");
            Log(root, s1.x - 10, s1.y - 4, 70, "塌方断木");
            Log(root, s1.x + 5, s1.y + 18, 20, "塌方断木");

            // ② 北岸金林：倒木、木柴垛、两块大石
            var s2 = SiteById("s2").c;
            Log(root, s2.x - 8, s2.y + 2, 35, "倒木");
            Log(root, s2.x + 10, s2.y + 8, -20, "倒木");
            Log(root, s2.x - 2, s2.y - 14, 95, "倒木");
            LevelKit.PlateauPiece(Dir, IdLogPile, "larchLogPile", root, G(s2.x + 14, s2.y - 6), 60, 0, b =>
            {
                for (int row = 0; row < 3; row++)
                for (int k = 0; k < 4 - row; k++)
                    b.Rod("wood", new Vector3(-2.4f, 0.3f + row * 0.55f, -0.9f + k * 0.6f + row * 0.3f), new Vector3(2.4f, 0.3f + row * 0.55f, -0.9f + k * 0.6f + row * 0.3f), 0.28f, 7);
                b.ColBox(Vector3.zero, new Vector3(5f, 1.7f, 2.6f));
            }, "木柴垛");
            Boulder(root, s2.x + 2, s2.y + 18, 2.3f, 121, "林间大石");
            Boulder(root, s2.x - 16, s2.y + 14, 1.7f, 122, "林间大石");

            // ③ 西岸霜滩：大石成群
            var s3 = SiteById("s3").c;
            (float dx, float dz, float size)[] rocks3 = { (-6, 6, 2.5f), (8, -2, 2.0f), (0, 14, 1.6f), (-12, -8, 1.9f), (14, 10, 1.4f), (4, -14, 2.3f) };
            i = 0;
            foreach (var (dx, dz, size) in rocks3) Boulder(root, s3.x + dx, s3.y + dz, size, 131 + i++, "霜滩大石");
            Log(root, s3.x + 12, s3.y - 10, 120, "冲上岸的枯木");

            // ④ 玛尼石滩：一道玛尼墙、三堆玛尼石、两根经幡杆拉着经幡
            var s4 = SiteById("s4").c;
            var wallAt = G(s4.x, s4.y - 4, -0.2f);
            LevelKit.PlateauPiece(Dir, IdManiWall, "larchManiWall", root, wallAt, 15, 0, b =>
            {
                b.Box("stoneDark", Vector3.zero, new Vector3(16f, 0.5f, 1.8f));
                b.Box("mani", new Vector3(0, 0.5f, 0), new Vector3(15.4f, 0.9f, 1.4f));
                for (int k = 0; k < 9; k++) b.Box(k % 2 == 0 ? "white" : "mani", new Vector3(-7f + k * 1.75f, 1.4f, 0), new Vector3(1.4f, 0.35f + (k % 3) * 0.1f, 1.1f), k * 7);
                b.ColBox(Vector3.zero, new Vector3(16f, 1.7f, 1.8f));
            }, "玛尼墙");
            foreach (var (dx, dz) in new[] { (-14f, 10f), (13f, 12f), (2f, 20f) })
                LevelKit.PlateauPiece(Dir, IdManiPile, "larchManiPile", root, G(s4.x + dx, s4.y + dz, -0.1f), dx * 9, 0, b =>
                {
                    b.Frustum("stoneDark", Vector3.zero, new Vector2(2.4f, 2.2f), new Vector2(1.5f, 1.3f), 0.8f);
                    b.Frustum("mani", new Vector3(0, 0.8f, 0), new Vector2(1.5f, 1.3f), new Vector2(0.6f, 0.5f), 0.7f);
                    b.Box("white", new Vector3(0, 1.5f, 0), new Vector3(0.45f, 0.35f, 0.4f), 20);
                    b.ColBox(Vector3.zero, new Vector3(2.3f, 1.5f, 2.1f));
                }, "玛尼堆");
            Vector3 Pole(float x, float z, float h)
            {
                var at = G(x, z, -0.2f);
                LevelKit.PlateauPiece(Dir, IdPole, "larchPole", root, at, 0, 0, b =>
                {
                    b.Cyl("pole", Vector3.zero, 0.16f, 0.11f, 7.5f, 8);
                    b.Cyl("gold", new Vector3(0, 7.5f, 0), 0.18f, 0.02f, 0.5f, 8);
                    b.ColCyl(Vector3.zero, 0.25f, 7.5f);
                }, "经幡杆");
                return at + Vector3.up * h;
            }
            var pa = Pole(s4.x - 18, s4.y - 10, 7.2f);
            var pb = Pole(s4.x + 18, s4.y - 2, 7.2f);
            flags.Line(pa, pb, 0.1f);
            flags.Line(pa + Vector3.down * 1.4f, pb + Vector3.down * 1.4f, 0.12f);

            // ⑤ 南坡猎人营地：黑帐篷、猎架、火塘、几个木箱
            var s5 = SiteById("s5").c;
            LevelKit.PlateauPiece(Dir, IdBlackTent, "larchBlackTent", root, G(s5.x - 2, s5.y + 6, -0.15f), 25, 0, b =>
            {
                b.Frustum("tentBlack", Vector3.zero, new Vector2(7f, 5.6f), new Vector2(1.2f, 1.0f), 2.8f);
                b.Box("woodDark", new Vector3(0, 0, -2.9f), new Vector3(1.6f, 1.8f, 0.2f));
                b.Rod("pole", new Vector3(-3.6f, 0, 0), new Vector3(-1f, 3.1f, 0), 0.06f);
                b.Rod("pole", new Vector3(3.6f, 0, 0), new Vector3(1f, 3.1f, 0), 0.06f);
                b.ColBox(Vector3.zero, new Vector3(6.4f, 2.6f, 5.0f));
            }, "黑帐篷");
            LevelKit.PlateauPiece(Dir, IdRack, "larchRack", root, G(s5.x + 9, s5.y - 3, -0.1f), -40, 0, b =>
            {
                b.Rod("wood", new Vector3(-2f, 0, 0), new Vector3(-2f, 2.4f, 0), 0.1f);
                b.Rod("wood", new Vector3(2f, 0, 0), new Vector3(2f, 2.4f, 0), 0.1f);
                b.Rod("wood", new Vector3(-2.2f, 2.3f, 0), new Vector3(2.2f, 2.3f, 0), 0.08f);
                for (int k = 0; k < 4; k++) b.Box("yakBrown", new Vector3(-1.4f + k * 0.95f, 1.1f, 0), new Vector3(0.6f, 1.1f, 0.12f));
                b.ColBox(Vector3.zero, new Vector3(4.4f, 2.4f, 0.5f));
            }, "猎架");
            Boulder(root, s5.x - 12, s5.y - 8, 1.5f, 151, "营地大石");
            Boulder(root, s5.x + 4, s5.y + 18, 2.2f, 152, "营地大石");
            Log(root, s5.x + 14, s5.y + 10, 80, "营地倒木");

            // ⑥ 谷口经幡门：两根高杆，门洞 6 m 宽，横拉三道经幡，杆脚各一堆玛尼石
            var gl = new Vector2(GateAt.x - 3.2f, GateAt.y);
            var gr = new Vector2(GateAt.x + 3.2f, GateAt.y);
            float gy = Mathf.Max(GroundY(gl.x, gl.y), GroundY(gr.x, gr.y));
            Vector3 GatePole(Vector2 p)
            {
                var at = new Vector3(p.x, GroundY(p.x, p.y) - 0.3f, p.y);
                LevelKit.PlateauPiece(Dir, IdPole, "larchGatePole", root, at, 0, 0, b =>
                {
                    b.Cyl("pole", Vector3.zero, 0.22f, 0.14f, 9.5f, 8);
                    b.Cyl("gold", new Vector3(0, 9.5f, 0), 0.24f, 0.02f, 0.6f, 8);
                    b.Frustum("stoneDark", Vector3.zero, new Vector2(1.6f, 1.6f), new Vector2(1.0f, 1.0f), 0.9f);
                    b.ColCyl(Vector3.zero, 0.5f, 9.5f);
                }, "经幡门杆");
                return at;
            }
            var a0 = GatePole(gl);
            var a1 = GatePole(gr);
            for (int k = 0; k < 3; k++) flags.Line(a0 + Vector3.up * (8.8f - k * 1.1f), a1 + Vector3.up * (8.8f - k * 1.1f), 0.08f);
            flags.Line(a0 + Vector3.up * 9f, a0 + new Vector3(-6, 0.3f, -4), 0.05f);
            flags.Line(a1 + Vector3.up * 9f, a1 + new Vector3(6, 0.3f, -4), 0.05f);
            gateCenter = new Vector3(GateAt.x, gy, GateAt.y);
        }

        // ───────────── 遇敌、灵火坛、目标、出口 ─────────────

        /// <summary>
        /// 六处遇敌：每处一个 EncounterSite，兽群一波；触发圈 = 领地半径 × 0.75，场地半径 = 领地半径。都是可选场地（目标只看灵火）；
        /// ①–⑤ 的守卫场地肃清后才能点灵火，⑥ 谷口守卫是出口前的考试。肃清宝箱落在灵火坛旁边
        /// </summary>
        static Dictionary<string, EncounterSite> BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            var result = new Dictionary<string, EncounterSite>();
            foreach (var e in Sites)
            {
                var site = new GameObject($"Site {e.id} · {e.title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = G(e.c);
                site.title = e.title;
                site.triggerRadius = e.r * 0.75f;
                site.arenaRadius = e.r;
                site.optional = true;
                site.requires = Array.Empty<EncounterSite>();
                site.reward = e.reward;
                if (e.altar is { } al)
                {
                    var toC = (e.c - al).normalized;
                    var chest = DryNear(al.x + toC.x * 3.5f, al.y + toC.y * 3.5f);
                    site.chestOffset = chest - site.transform.position;
                }
                var entries = e.units.GroupBy(u => u.kind).Select(g => EncounterSpec.E(g.Key, g.Count())).ToArray();
                site.spec = EncounterSpec.Of(EncounterSpec.Wave(e.title, entries).Hint(e.hint)).Gather(0.4f).Distance(6, e.r + 10);
                var anchors = new List<Transform>();
                int k = 0;
                foreach (var u in e.units)
                {
                    var at = DryNear(e.c.x + u.dx, e.c.y + u.dz);
                    var go = new GameObject($"Enemy_{e.id}_{++k}_{u.kind}{(u.sentinel ? "_sentinel" : "")}");
                    go.transform.SetParent(markers, false);
                    go.transform.position = at;
                    var sa = go.AddComponent<SpawnAnchor>();
                    float ang = Mathf.Atan2(at.z - e.c.y, at.x - e.c.x);
                    sa.role = u.sentinel ? StationRole.Precision : RoleOf(u.kind);
                    sa.lane = Mathf.FloorToInt(Mathf.Repeat(ang + Mathf.PI, Mathf.PI * 2) / (Mathf.PI * 2 / 3)) % 3;
                    sa.spread = 2f;
                    anchors.Add(go.transform);
                }
                site.anchors = anchors.ToArray();
                result[e.id] = site;
            }
            return result;
        }

        /// <summary>五座灵火坛（SpiritAltar：按住点亮，点亮回满血 + 复活点），面朝据点中心；守卫 = 本据点的遇敌，肃清前点不着</summary>
        static Dictionary<string, SpiritAltar> BuildAltars(Transform markers, Dictionary<string, EncounterSite> sites)
        {
            var root = new GameObject("Spirit Altars · 灵火坛").transform;
            root.SetParent(markers, false);
            var result = new Dictionary<string, SpiritAltar>();
            int i = 0;
            foreach (var s in Sites.Where(s => s.altar.HasValue))
            {
                var a = s.altar.Value;
                var at = G(a);
                var face = s.c - a;
                var alt = new GameObject($"Altar_{++i}_{s.id}").AddComponent<SpiritAltar>();
                alt.transform.SetParent(root, false);
                alt.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(face.x, 0, face.y).normalized));
                alt.title = $"灵火坛 · {s.name}";
                alt.guard = sites[s.id];
                alt.lightOnGuardCleared = false;
                LevelKit.PlateauPiece(Dir, IdAltarPosts, "larchAltarPosts", alt.transform, at, alt.transform.eulerAngles.y, 0, b =>
                {
                    for (int k = 0; k < 4; k++)
                    {
                        float ang = k / 4f * Mathf.PI * 2 + Mathf.PI / 4;
                        b.Box("stoneDark", new Vector3(Mathf.Cos(ang) * 2.2f, -0.2f, Mathf.Sin(ang) * 2.2f), new Vector3(0.35f, 1.3f, 0.35f));
                    }
                }, "灵火坛四角石柱");
                for (int k = 0; k < 4; k++)
                {
                    float ang = k / 4f * Mathf.PI * 2 + Mathf.PI / 4;
                    flags.Banner(at + new Vector3(Mathf.Cos(ang) * 2.2f, 1.6f, Mathf.Sin(ang) * 2.2f), 0.9f, 0.35f, k, ang * Mathf.Rad2Deg);
                }
                result[s.id] = alt;
            }
            return result;
        }

        static LevelObjective BuildObjective(Transform markers, Dictionary<string, EncounterSite> sites, Dictionary<string, SpiritAltar> altars)
        {
            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(markers, false);
            objective.title = "点亮三处灵火 · 开谷口";
            objective.required = Array.Empty<EncounterSite>();
            objective.optional = sites.Values.ToArray();
            objective.altars = altars.Values.ToArray();
            objective.altarsNeeded = FiresToUnlock;
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>出口传送门：立在经幡门的两根杆之间（门洞 5.6 × 6 m），朝南；目标完成（3 处灵火）后升起，下一关读 RunPlan</summary>
        static ExitPortal BuildExit(Transform markers, LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<ExitPortal>();
            portal.transform.SetParent(markers, false);
            portal.transform.SetPositionAndRotation(gateCenter, Quaternion.LookRotation(Vector3.back));
            portal.objective = objective;
            portal.doorSize = new Vector2(5.6f, 6f);
            portal.buildFrame = false;
            return portal;
        }

        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector3 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = p;
            }
            foreach (var s in Sites) Mk($"Site_{s.id}", G(s.c));
            Mk("Route_Gate", gateCenter);
            Mk("Landmark_MainPeak", PeakTarget);
            // 软边界冲刺测试的方向：谷底中心往外
            foreach (var (name, x, z) in new[] { ("North", -130f, 700f), ("East", 420f, 60f), ("South", 40f, -640f), ("West", -420f, 40f) }) Mk($"Escape_{name}", new Vector3(x, 0, z));
        }

        // ───────────── 本关的检查 ─────────────

        /// <summary>L1 规则：关卡场景只有环境和标记；另查本关的件（灵火坛 5、遇敌 6、守卫对应、出口接上目标、RunPlan 前后关）</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, ExitPortal portal, LevelObjective objective,
            Dictionary<string, SpiritAltar> altars, Dictionary<string, EncounterSite> sites)
        {
            rep.Section("场景内容（L1：只有环境和标记，玩家在 Core 场景）");
            int Count<T>() where T : Component => Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            void None<T>(string what) where T : Component
            {
                int c = Count<T>();
                if (c > 0) rep.Fail($"场景里有 {c} 个 {what}（应在 Core 场景）");
            }
            None<PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<Hud>("HUD");
            None<GameSession>("会话");
            int nAltars = Count<SpiritAltar>(), nSites = Count<EncounterSite>();
            rep.Line($"灵火坛 {nAltars}（要点亮 {objective.AltarsNeeded}），遇敌 {nSites}（全部可选），兽群共 {Sites.Sum(s => s.units.Length)} 只，遗物 {Count<LoreNote>()}，藏宝点 {Count<CachePOI>()}");
            if (Count<LoreNote>() != 1 || Count<CachePOI>() != 0) rep.Fail("应有 1 份遗物（修鼓旧簿）、没有灵石窖藏");
            if (nAltars != 5 || objective.AltarsNeeded != FiresToUnlock || objective.altars.Length != 5) rep.Fail("灵火坛应 5 座、要点亮 3 座");
            if (nSites != 6 || objective.RequiredTotal != 0) rep.Fail("遇敌应 6 处、都不是必清（目标只看灵火）");
            foreach (var s in Sites.Where(s => s.altar.HasValue))
                if (!altars[s.id].guard || altars[s.id].guard != sites[s.id]) rep.Fail($"{altars[s.id].title} 的守卫不是本据点的遇敌");
            if (!portal || portal.objective != objective) rep.Fail("出口传送门没接上 LevelObjective");
            else
            {
                var stage = RunPlan.Get("4-3");
                rep.Line(stage != null
                    ? $"✓ 出口在谷口经幡门里；RunPlan：{RunPlan.Stages.FirstOrDefault(x => x.order == stage.order - 1)?.Label} → {stage.Label} → {RunPlan.Stages.FirstOrDefault(x => x.order == stage.order + 1)?.Label ?? "无"}"
                    : "✓ 出口在谷口经幡门里（RunPlan 里还没有 4-3）");
                if (stage == null || stage.scene != ScenePath) rep.Fail($"RunPlan 的 4-3 应指向 {ScenePath}");
            }
        }

        /// <summary>守鼓人鼓楼：修鼓旧簿（LoreNote）在门前（离出生点有路由交互净空检查管），上台地的坡道不陡于 26°</summary>
        static void CheckDrumTower(LevelKit.Report rep, LoreNote note)
        {
            rep.Section("守鼓人鼓楼");
            rep.Line($"台地中心 ({TowerAt.x:F0}, {towerY:F1}, {TowerAt.y:F0})，比谷底高 {towerY - FloorY(TowerAt.y):F1} m；坡道 {LevelKit.RampGrade(RampFoot, rampFootY, RampTop, towerY):F1}°（{Vector2.Distance(RampFoot, RampTop):F0} m）");
            if (!note || note.lines.Length == 0) rep.Fail("修鼓旧簿（LoreNote）没摆上");
            else rep.Line($"✓ 修鼓旧簿：{note.lines.Length} 行，横幅「{note.bannerTitle}」，台词 {note.afterLines.Length} 句");
            if (LevelKit.RampGrade(RampFoot, rampFootY, RampTop, towerY) > 26) rep.Fail("上鼓楼的坡道超过 26°");
        }

        // ───────────── 验收声明 ─────────────

        /// <summary>
        /// 交给 L5 规则集的声明：主线路点（出生 → ③ 西岸 → ② 北岸 → ① 东岸车路 → ④ 玛尼石滩 → 谷口），⑤ 在出生点身后、可选；
        /// 场地尺寸取据点直径；出生点 / 谷口望主峰的视线；车路坡度；可玩区遮罩与软边界同一个
        /// </summary>
        static LevelSpec Spec()
        {
            SiteSpec Site(string id, bool combat = true)
            {
                var s = SiteById(id);
                return new SiteSpec { name = s.name, center = G(s.c), size = s.r * 2, combat = combat };
            }
            var spec = new LevelSpec
                {
                    id = "4-3", title = Title, playerSpawn = spawnAt, bounds = new Rect(Origin, Size),
                    playable = Playable, playableThreshold = 0.2f, escapeMargin = boundary.EscapeMargin, placeholders = PlaceholderPolicy.Warn,
                    sites = { Site("s1"), Site("s2"), Site("s3"), Site("s4"), Site("s5"), Site("pass") },
                }
                .Route("出生 · 南岸", spawnAt).Route("③ 西岸霜滩", G(SiteById("s3").altar.Value)).Route("② 北岸金林", G(SiteById("s2").altar.Value))
                .Route("① 东岸塌方", G(SiteById("s1").altar.Value)).Route("④ 玛尼石滩", G(SiteById("s4").altar.Value)).Route("⑥ 谷口经幡门", gateCenter)
                .Sight("出生 → 谷口主峰", spawnAt + Vector3.up * Eye, PeakTarget, 30)
                .Sight("④ 玛尼石滩 → 谷口主峰", G(SiteById("s4").altar.Value, Eye), PeakTarget, 30)
                .Sight("谷口草甸 → 守鼓人鼓楼", G(-165, 476, Eye), TowerTop, 8);
            spec.slopePaths.Add(new SlopePath { name = "上鼓楼的坡道", points = new List<Vector2> { RampFoot, Vector2.Lerp(RampFoot, RampTop, 0.5f), RampTop }, maxSlope = 26f });
            spec.slopePaths.Add(new SlopePath { name = "东岸车路", points = road.Where((p, i) => i % 3 == 0 && p.y > -420 && p.y < 560).ToList(), maxSlope = 14f });
            return spec;
        }
    }
}
