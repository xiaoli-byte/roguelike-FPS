using Spiritfire.Art;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-1 古道穿越戈壁（docs/level-design/unity-maps-v1.md §1-1；收尾设计见 docs/level-design/maps/1-1.md，M11）：地形 + 第一章正式套件 + 散布 + 遭遇。
    /// 关卡坐标 = 世界 XZ（米），游玩区约 260 × 200 m，地形向外各扩 70 m 给边界沙丘与远景（雾里淡出，看不到地形边）。
    ///
    ///   出生·驿站废墟 (26,38) → 汉长城缺口 → ① 黑戈壁砾石滩 (80,58)，东侧干河床陡坎 1.5 m
    ///   → ② 雅丹石阵 (120,100)：三座岩丘 3.5 / 6 / 9 m，最矮一座背风沙坡可走上顶
    ///   → ③ 烽燧台地 (180,142)：6 m 夯土台，西坡道上、东南坡道下，台顶 14 m 烽燧 + 狼烟（全图地标）
    ///   → ④ 驼队残骸营地 (220,74)：沙丘围合的盆地，周期沙暴 → 出口 (250,58)，升起后通往 1-2（RunPlan）
    ///   ② ③ 先后不限（都只要求 ①）：② 南侧有一条绕行路通到烽燧西坡道脚；④ 要 ② ③ 都肃清。
    ///   藏宝点：① 北侧长城转角「戍卒窖藏」（无守军）、② 南侧绕行路「商队遗货」（有守军）。
    ///
    /// 主风向从东北吹向西南：雅丹长轴、沙丘脊线、狼烟的偏斜都按它排，地貌读起来是同一场风塑造的。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、场地与刷怪标记、遭遇战、藏宝点、出口、自举标记 <see cref="Spiritfire.Game.LevelBootstrap"/>；
    /// 玩家、HUD、各系统在常驻的 Core 场景（CoreSceneBuilder），敌人 / 武器 Prefab 在 GameDatabase。直接打开本场景按 Play 时自举标记把 Core 叠加进来。
    /// 关卡件全部走 LevelKit.PlaceOrBox：缺 Prefab 时放带 Placeholder 标签的白盒，验收报告列出来。
    /// 生成：Spiritfire ▸ Levels ▸ Build 1-1 古道穿越戈壁（或 bridge.sh level 1-1，旧名 level11）。
    /// </summary>
    [LevelBuilder("1-1", Level_1_1.ScenePath)]
    public static class Level_1_1
    {
        public const string Dir = "Assets/Levels/L1_1_GobiRoad";
        public const string ScenePath = "Assets/Scenes/L1_1_GobiRoad.unity";
        const string Name = "L1_1";

        // 高度场里 Base 米 = 世界 y 0（河床、盆地挖到 0 以下也还在高度场范围内）
        const float Base = 10f;
        static readonly Vector2 Origin = new(-70, -70), Size = new(400, 340);
        static readonly Vector2 Wind = new Vector2(-0.82f, -0.57f).normalized;
        static readonly Vector2 WindAxis = new(0.82f, 0.57f); // 雅丹长轴（35°）
        /// <summary>软边界（L3，D14：没有空气墙）：等值线外起风推回、白化，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = LevelKit.BoundarySpec.Default;

        // ── 场地 ──
        static readonly Vector2 Spawn = new(26, 38), Gravel = new(80, 58), Yardang = new(120, 100), Beacon = new(180, 142),
            Camp = new(220, 74), Exit = new(250, 58);
        /// <summary>出口祭坛门洞相对祭坛中心沿正面的距离（米）</summary>
        const float ExitDoorOffset = 1.2f;

        static readonly (Vector2 c, float r)[] Sites =
        {
            (Spawn, 16), (Gravel, 34), (Yardang, 32), (Beacon, 28), (Camp, 26), (Exit, 14),
        };

        // ── 古道（穿过坡道脚、坡道顶，台顶段走在台面上）──
        static readonly Vector2 RampWFoot = new(152, 126), RampWTop = new(168, 136), RampEFoot = new(204, 118), RampETop = new(190.4f, 133.4f); // 坡顶正好落在台沿上，否则台面平台会悬出一个台阶

        static readonly List<Vector2> Road = Spline(new[]
        {
            new Vector2(14, 34), new Vector2(34, 40), new Vector2(54, 48), new Vector2(72, 54), new Vector2(90, 62),
            new Vector2(104, 76), new Vector2(114, 92), new Vector2(124, 106), new Vector2(138, 118), RampWFoot, RampWTop,
            new Vector2(180, 140), RampETop, RampEFoot, new Vector2(212, 100), new Vector2(218, 82), new Vector2(228, 68),
            new Vector2(240, 60), new Vector2(256, 57),
        });

        /// <summary>
        /// ② 南侧绕行路（不是修出来的路，是开阔地上的一条走法）：过河床浅滩后沿 ② 南、东侧走，离 ② 中心 28–31 m（触发圈 18 m 之外），
        /// 经「商队遗货」到烽燧西坡道脚——先打 ③ 再回头打 ② 就走这里。验收主线和 map-1-1 机器人都走它
        /// </summary>
        static readonly Vector2 BypassSouth = new(128, 72), BypassEast = new(148, 104);

        /// <summary>古道过干河床的浅滩（古道上离河床中线最近的点）：① 北侧（戍卒窖藏）去 ② 南侧绕行路要从这里过河床，别处是 1.5 m 陡坎</summary>
        static Vector2 Ford
        {
            get
            {
                Vector2 best = Road[0];
                float bd = float.MaxValue;
                foreach (var q in Road)
                {
                    float d = Polyline(q, River).dist;
                    if (d < bd)
                    {
                        bd = d;
                        best = q;
                    }
                }
                return best;
            }
        }

        // ── 干河床（① 东缘，自西北向东南，起点淡出）──
        static readonly List<Vector2> River = Spline(new[]
        {
            new Vector2(78, 100), new Vector2(90, 82), new Vector2(96, 66), new Vector2(100, 46), new Vector2(110, 26), new Vector2(118, 0),
        });

        // ── 汉长城（自南向北斜穿 ①，古道从缺口穿过；北端是墩台转角，向西折进沙丘）──
        // M11：北端从 (86, 92) 收到 (80.5, 77)——原来最后 3 m 斜插进干河床（转角会悬在 1.4 m 深的河槽上），现在转角离河床中线 10.7 m
        static readonly Vector2[] HanWall =
        {
            new(60, 16), new(66, 34), new(72, 53), new(80.5f, 77),
        };

        // ── 雅丹（中心、半长、半宽、高、侧壁宽、种子）──
        static readonly (Vector2 c, float len, float wid, float h, float edge, int seed)[] Mesas =
        {
            (new Vector2(104, 108), 10, 4.5f, 3.5f, 1.5f, 1), // 低丘：背风沙坡可上，② 的俯射位
            (new Vector2(136, 90), 9, 4f, 6f, 1.7f, 2),
            (new Vector2(124, 124), 14, 5.5f, 9f, 2.0f, 3),
            // 远景雅丹群（北侧，边界沙丘之外；烽燧台上望得到 = 下一张图「雅丹迷城」的方向）
            (new Vector2(70, 196), 16, 6, 12, 2.4f, 11), (new Vector2(110, 206), 22, 7, 16, 2.8f, 12),
            (new Vector2(150, 220), 26, 8, 20, 3.2f, 13), (new Vector2(192, 208), 18, 6, 14, 2.4f, 14), (new Vector2(228, 226), 14, 5, 11, 2.2f, 15),
        };

        static Vector2 MesaFoot => Mesas[0].c - WindAxis * (Mesas[0].len + 8);
        static Vector2 MesaRampTop => Mesas[0].c - WindAxis * (Mesas[0].len - 4);

        // ── 烽燧台 ──
        static readonly Vector2 PlateauHalf = new(13, 10);
        const float PlateauAngle = 10, PlateauHeight = 6, PlateauEdge = 2.4f;
        static readonly (Vector2 foot, Vector2 top, float width)[] PlateauRamps = { (RampWFoot, RampWTop, 8), (RampEFoot, RampETop, 8) };
        static readonly (Vector2, Vector2, float)[] NoRamps = System.Array.Empty<(Vector2, Vector2, float)>();
        static readonly Vector2 BeaconTower = new(185, 146);
        const float BeaconYaw = 235;
        /// <summary>烽燧 Prefab 局部坐标里柴笼顶部的位置（概念图正视图左上角）</summary>
        static readonly Vector3 BeaconBasketLocal = new(2.3f, 14.2f, 0.4f);

        // ── 第一章套件（docs/art/ch1-map-kit.md；尺寸 = 发布后的包围盒 宽 × 高 × 深，正面朝 +Z）──
        const string HanWallId = "SM_Tripo_DesertHanWall", HanWallEndId = "SM_Tripo_DesertHanWallEnd", HanWallCornerId = "SM_Tripo_DesertHanWallCorner",
            PosthouseWallId = "SM_Tripo_DesertPosthouseWall", ParapetId = "SM_Tripo_DesertBeaconParapet", BrushwoodId = "SM_Tripo_DesertBrushwoodPile",
            BeaconTowerId = "SM_Tripo_DesertBeaconTower", CartRutsId = "SM_Decal_DesertCartRuts", ColossusId = "SM_Tripo_DesertSeatedColossus",
            ShrineId = "SM_Tripo_DesertPortalShrine";
        static readonly Vector3 HanWallSize = new(5.33f, 3.5f, 1.37f), HanWallEndSize = new(5.65f, 3.5f, 2.17f);
        static readonly Vector3 PosthouseWallSize = new(4.87f, 3.2f, 0.99f), ParapetSize = new(1.89f, 1.1f, 0.38f);
        /// <summary>断口资产的坍塌端在局部 X 的哪一侧（+1 / −1）</summary>
        const float HanWallEndCollapseX = -1;
        const float BreachHalf = 3.5f;
        /// <summary>长城转角：中线交点在原点，两臂各 4 m 沿局部 −X、−Z（Unity 轴）；露出 2.6 m（墩台转角全遮）</summary>
        const float CornerArm = 4f, CornerHeight = 2.6f;
        /// <summary>车辙贴花一片的长度（米，沿局部 Z，贴图沿 Z 循环）</summary>
        const float RutLength = 8f;

        // ── 驿站废墟（缓冲）：夯土院墙的西、北两面（北墙有门洞）+ 南面残基；h = 露出地面的高度 ──
        static readonly (Vector2 a, Vector2 b, float h)[] StationWalls =
        {
            (new(14, 28), new(14, 44), 3.2f),           // 西墙：全高，带木窗
            (new(14, 44), new(18.4f, 46.4f), 2.6f),     // 西北角
            (new(24, 49), new(33.2f, 52.9f), 1.8f),     // 门洞东侧的北墙残段
            (new(20, 30), new(24.7f, 28.4f), 1.2f),     // 南墙残基（低掩体）
        };
        static readonly Vector2 StationYard = new(22, 38);

        // ── 盆地 ──
        static readonly Vector2 BasinRadius = new(22, 19);

        // ── 藏宝点（docs/level-design/maps/1-1.md §3）──
        /// <summary>商队遗货：② 南侧绕行路、中雅丹东南的背风处（守军两只跳鼠 + 一只蝎卫）</summary>
        static readonly Vector2 CacheWreck = new(142, 78);
        /// <summary>戍卒窖藏：长城北端转角的内侧（约 (77, 75)，离两臂中线约 2.5 m，箱子放得下、从西南开口进；离 ① 中心 18 m，在 ① 的触发圈外）</summary>
        static Vector2 CacheCellar
        {
            get
            {
                var (at, along, west) = WallCorner();
                return at + (west - along).normalized * 3.5f;
            }
        }

        // ───────────── 地貌 ─────────────
        static float BaseGround(Vector2 p) => Base + Fbm(p, 70, 4, 1) * 1.4f + Fbm(p, 18, 3, 2) * 0.35f;

        static float RiverDepth(Vector2 p)
        {
            var (d, t) = Polyline(p, River);
            float taper = Smooth(0, 0.12f, t);
            return 1.5f * taper * (1 - Smooth(3.5f, 4.6f, d + Fbm(p, 6, 2, 4) * 0.6f));
        }

        static float Ground0(Vector2 p) => BaseGround(p) - RiverDepth(p);

        static float RoadDist(Vector2 p) => Polyline(p, Road).dist;

        // 古道纵断面：沿线每米取 Ground0，±8 m 滑动平均 → 过河床处是一段缓坡浅滩，而不是跟着陡坎上下
        static readonly float[] RoadProfile = BuildProfile();
        static float RoadLength;

        static float[] BuildProfile()
        {
            float len = 0;
            for (int i = 0; i + 1 < Road.Count; i++) len += Vector2.Distance(Road[i], Road[i + 1]);
            RoadLength = len;
            int n = Mathf.CeilToInt(len) + 1;
            var raw = new float[n];
            for (int k = 0; k < n; k++) raw[k] = Ground0(RoadAt(k / (float)(n - 1)));
            var o = new float[n];
            for (int k = 0; k < n; k++)
            {
                float s = 0;
                int c = 0;
                for (int j = Mathf.Max(0, k - 8); j <= Mathf.Min(n - 1, k + 8); j++) { s += raw[j]; c++; }
                o[k] = s / c;
            }
            return o;
        }

        static Vector2 RoadAt(float t)
        {
            float total = 0;
            for (int i = 0; i + 1 < Road.Count; i++) total += Vector2.Distance(Road[i], Road[i + 1]);
            float target = t * total, acc = 0;
            for (int i = 0; i + 1 < Road.Count; i++)
            {
                float l = Vector2.Distance(Road[i], Road[i + 1]);
                if (acc + l >= target) return Vector2.Lerp(Road[i], Road[i + 1], (target - acc) / Mathf.Max(1e-4f, l));
                acc += l;
            }
            return Road[^1];
        }

        static float Profile(float t)
        {
            float f = t * (RoadProfile.Length - 1);
            int i = Mathf.Clamp((int)f, 0, RoadProfile.Length - 2);
            return Mathf.Lerp(RoadProfile[i], RoadProfile[i + 1], f - i);
        }

        static float Playable(Vector2 p, float roadDist)
        {
            float v = 1 - Smooth(14, 26, roadDist);
            foreach (var (c, r) in Sites) v = Mathf.Max(v, 1 - Smooth(r, r + 14, Vector2.Distance(p, c)));
            return v;
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            var (roadDist, roadT) = Polyline(p, Road);
            float river = RiverDepth(p);
            float h = BaseGround(p) - river;

            // 古道：路面 3 m 内贴合纵断面，6 m 外回到原地形
            float roadMask = 1 - Smooth(3, 6, roadDist);
            h = Mathf.Lerp(h, Profile(roadT), roadMask);

            // 出生点驿站：压平一块
            h = Mathf.Lerp(h, Ground0(Spawn), Disc(p, Spawn, 10, 8));

            // 游玩区之外：沙海抬升 + 大沙丘（脊高 12 m，迎风缓背风陡）——自然边界（软边界的风沙把人推回，D14）
            float play = Playable(p, roadDist);
            float outer = 1 - play;
            float bigDunes = Dunes(p, Wind, 60, 10, 5, 0.7f) * Smooth(0, 0.7f, outer);
            h += Smooth(0, 1, outer) * 3f + bigDunes;

            // 游玩区内的小沙垄：② 雅丹之间与 ④ 营地多，① 黑戈壁少；路面上没有
            float driftZone = Mathf.Max(Disc(p, Yardang, 30, 12), Disc(p, Camp, 30, 12));
            float driftMask = Smooth(0.3f, 0.65f, Fbm(p, 45, 2, 11) * 0.5f + 0.5f) * Smooth(2, 7, roadDist) * play;
            float drifts = Dunes(p, Wind, 13, 1.1f, 9) * driftMask * Mathf.Lerp(0.25f, 1f, driftZone);
            h += drifts;

            // 雅丹
            float mesaTop = 0, mesaBody = 0;
            foreach (var (c, len, wid, mh, edge, seed) in Mesas)
            {
                float m = Mesa(p, c, len, wid, 35, mh, edge, seed);
                h += m;
                mesaBody = Mathf.Max(mesaBody, Smooth(0.4f, 1.2f, m));
                mesaTop = Mathf.Max(mesaTop, Smooth(0.9f, 0.97f, m / mh));
            }

            // 低丘的背风沙坡（迎着主风的反方向拖出的沙尾）：坡脚地面 → 丘顶
            var (rt, rmask) = Ramp(p, MesaFoot, MesaRampTop, 5, 3);
            float footH = Ground0(MesaFoot), topH = Ground0(MesaRampTop) + Mesas[0].h;
            float rampTarget = Mathf.Lerp(footH, topH, Smooth(0, 1, rt) * 0.3f + rt * 0.7f);
            h = Mathf.Max(h, Mathf.Lerp(h, rampTarget, rmask));

            // 烽燧台（夯土台 + 两条坡道）：只填高。坡道按绝对高度从坡脚的实际地面升到台面，坡脚不留台阶
            float pv = Plateau(p, Beacon, PlateauHalf, PlateauAngle, PlateauHeight, PlateauEdge, NoRamps);
            float pBase = Ground0(Beacon);
            h = Mathf.Max(h, Mathf.Lerp(h, pBase + pv, Smooth(0, 0.8f, pv)));
            float rampAny = 0;
            foreach (var (foot, rtop, width) in PlateauRamps)
            {
                var (t, mask) = Ramp(p, foot, rtop, width, PlateauEdge * 0.6f);
                float target = Mathf.Lerp(Profile(Polyline(foot, Road).t), pBase + PlateauHeight, t);
                h = Mathf.Max(h, Mathf.Lerp(h, target, mask));
                rampAny = Mathf.Max(rampAny, mask);
            }

            // 驼队营地盆地 + 围合的沙丘环（古道进出口处断开）
            var bd = p - Camp;
            float br = Mathf.Sqrt(bd.x * bd.x / (BasinRadius.x * BasinRadius.x) + bd.y * bd.y / (BasinRadius.y * BasinRadius.y));
            float basin = -Basin(p, Camp, BasinRadius, 2.5f, 10);
            h -= basin;
            float ring = Smooth(1.05f, 1.35f, br) * (1 - Smooth(1.8f, 2.3f, br)) * Smooth(5, 12, roadDist);
            float ringDunes = (Dunes(p, Wind, 26, 4.5f, 13, 0.7f) + 1.5f) * ring;
            h += ringDunes;

            // 地形外缘 40 m 内落回世界 y = 2（与远景地面相接）
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(Base + 2, h, Smooth(0, 40, edgeDist));
            s.h = h;

            // ── 分层倾向 ──
            float n = Fbm(p, 9, 2, 21);
            float rutsCore = 1 - Smooth(2.2f, 3.4f, roadDist + n * 0.7f);
            // 车辙：路中两条夯土带（±1 m），中间隆起处混一点砾石
            float hump = (1 - Smooth(0.25f, 0.6f, roadDist)) * 0.45f;
            float riverBed = Smooth(0.5f, 1.0f, river);
            float plateauTop = Mathf.Max(Smooth(PlateauHeight - 0.6f, PlateauHeight - 0.1f, pv), rampAny * 0.8f);
            s.packed = Mathf.Max(Mathf.Max(rutsCore * (1 - hump), riverBed * 0.9f), Mathf.Max(plateauTop * 0.85f, mesaTop * 0.75f));
            float dunesAll = bigDunes + ringDunes + drifts * 1.6f;
            float sandPatches = Smooth(0.15f, 0.45f, Fbm(p, 30, 3, 7)) * 0.7f;
            s.sand = Mathf.Max(Mathf.Max(Smooth(0.25f, 1.4f, dunesAll), sandPatches * (1 - mesaBody)),
                Mathf.Max(Smooth(0.3f, 2f, basin) * 0.85f, rmask * 0.95f));
            // 游玩区外是连续的沙海（不让砾石在丘间露成一道道斑马纹）
            s.sand = Mathf.Max(s.sand, Smooth(0.1f, 0.45f, outer));
            // ① 黑戈壁：砾石为主，沙斑更少
            s.sand *= Mathf.Lerp(1, 0.35f, Disc(p, Gravel, 26, 12) * (1 - Smooth(0.25f, 1.4f, dunesAll)));
            s.rock = mesaBody * (1 - mesaTop) * Smooth(0.2f, 0.8f, 1 - rmask);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-1 古道穿越戈壁", priority = 60)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh → 验收检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var built = new GameObject("Structures").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = 48,
                layers = TerrainTextureGen.Desert(), eval = Eval, shadowTint = theme.groundShadowTint,
            }, env);
            var terrain = set.First;
            BuildBackdrop(env, theme);
            // 散布（L4）：砾石、骆驼刺、红柳是 Terrain 细节（GPU instancing，没有碰撞），按 ScatterRules 的密度图撒
            var scatter = LevelKit.ScatterDetails(set, ScatterRules(), RoadDist, 1f, 160f);

            LevelKit.Boundary(Dir, Name, env, p => Playable(p, RoadDist(p)), new Rect(Origin, Size), Bounds);
            // 天气：东北盛行风；④ 驼队营地的周期沙暴从东侧涌入，能见度 25 m（unity-maps-v1 1-1「动态环境：沙暴」，maps/1-1.md §6）
            LevelKit.Weather(env, theme, Wind, 0.25f, Sandstorm(terrain));
            BuildStation(terrain, built, props);
            BuildHanWall(terrain, built);
            int ruts = BuildCartRuts(terrain, props);
            BuildGravelField(terrain, props);
            BuildYardang(terrain, props);
            var smokeAt = BuildBeacon(terrain, built);
            BuildCamp(terrain, built, props);
            BuildCacheDressing(terrain, props);
            var exit = LevelKit.PlaceOrBox(ShrineId, props, terrain, Exit.x, Exit.y, -100, new Vector3(6, 6, 4));
            // 远景地标：敦煌坐像（替换题材不对的胡狼头巨像），面朝游玩区
            var colossusAt = new Vector2(150, 248);
            var toPlay = new Vector2(130, 100) - colossusAt;
            var colossus = LevelKit.PlaceOrBox(ColossusId, env, LevelKit.OnGround(terrain, colossusAt.x, colossusAt.y, -2), new Vector3(26, 44, 21),
                Mathf.Atan2(toPlay.x, toPlay.y) * Mathf.Rad2Deg, 2.2f);
            colossus.name = IsPlaceholder(colossus) ? colossus.name : "Seated Colossus (far)";
            // 远景「舰队」雅丹（正式资产，长轴沿 Z）：顺主风向排在北侧沙丘外，烽燧台上望得到，指向下一张图「雅丹迷城」
            foreach (var (p, yaw, scale) in new[] { (new Vector2(92, 176), 215f, 1.5f), (new Vector2(172, 186), 210f, 1.9f), (new Vector2(212, 178), 220f, 1.3f) })
                LevelKit.PlaceOrBox("SM_Tripo_DesertYardangFleet", env, LevelKit.OnGround(terrain, p.x, p.y, -1.5f), new Vector3(16, 20, 40) * scale, yaw, scale);
            BuildMarkers(terrain, markers);

            // 玩家、HUD、各系统都在常驻的 Core 场景（L1）：这里只放出生标记（SceneFlow 在这里组装玩家，燎、冲锋枪起手；第二把枪从 ① 的宝箱里拿）
            // + 自举标记（直接打开本场景按 Play 时把 Core 叠加进来）
            var spawnAt = LevelKit.OnGround(terrain, Spawn.x, Spawn.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(new Vector3(Gravel.x - Spawn.x, 0, Gravel.y - Spawn.y));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<Spiritfire.Game.PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<Spiritfire.Game.LevelBootstrap>();
            var objective = BuildEncounters(terrain, markers);
            // 出口传送门：嵌在出口祭坛正面，关卡目标完成后升起、落清关宝箱；下一关读 RunPlan（1-1 → 1-2 雅丹迷城）
            var portal = new GameObject("Exit Portal").AddComponent<Spiritfire.Game.ExitPortal>();
            var face = exit.transform.forward;
            portal.transform.SetPositionAndRotation(LevelKit.OnGround(terrain, Exit.x + face.x * ExitDoorOffset, Exit.y + face.z * ExitDoorOffset, 0),
                Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = IsPlaceholder(exit); // 祭坛缺资产时自己立石门框

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            if (!EditorBuildSettings.scenes.Any(s => s.path == ScenePath))
                EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

            var rep = new LevelKit.Report();
            rep.Line("1-1 古道穿越戈壁 · 验收");
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            float top = LevelKit.GroundY(terrain, Beacon.x, Beacon.y);
            rep.Line($"烽燧台面 y = {top:F1}（台脚 {LevelKit.GroundY(terrain, RampWFoot.x, RampWFoot.y):F1}），雅丹低丘顶 y = {LevelKit.GroundY(terrain, Mesas[0].c.x, Mesas[0].c.y):F1}");
            rep.Line($"散布：{string.Join("、", scatter.Select(kv => $"{kv.Key} {kv.Value}"))}；古道车辙贴花 {ruts} 片");
            LevelValidator.Run(Spec(terrain, smokeAt), rep); // 主线、坡度、视线 + L5 规则集，见文件末尾的 Spec
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_1-1_report.txt");

            if (review)
            {
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                // 审核截图用临时机位（与玩家同一套相机 + 冲锋枪第一人称 rig），截完删掉，不留在关卡场景里
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_1-1", new[]
                    {
                        ("Aerial", new Vector3(40, 95, -60), new Vector3(150, 0, 110), false),
                        ("Map", new Vector3(130, 330, 99), new Vector3(130, 0, 100), false),
                        ("Spawn", E(Spawn), smokeAt + Vector3.up * 4, true),
                        ("Station", E(new Vector2(30, 34)), G(new Vector2(14, 40), 1.5f), false),
                        ("GravelField", E(new Vector2(58, 50)), G(new Vector2(100, 66), 1), false),
                        ("WallBreach", E(WallBreach().at + new Vector2(-14, -6)), G(WallBreach().at, 1.2f), false),
                        ("CacheCellar", E(CacheCellar + new Vector2(-9, -6)), G(CacheCellar, 0.8f), false),
                        ("Riverbed", E(new Vector2(92, 40), 2.2f), G(new Vector2(98, 72), 0), false),
                        ("Yardang", E(new Vector2(106, 80)), G(new Vector2(126, 116), 4), false),
                        ("LowMesaTop", E(Mesas[0].c), G(new Vector2(136, 92), 2), false),
                        ("Bypass", E(BypassSouth), G(CacheWreck, 0.8f), false),
                        ("BeaconApproach", E(new Vector2(146, 120)), smokeAt - Vector3.up * 6, false),
                        ("BeaconTop", E(new Vector2(186, 138)), G(Camp, 0), false),
                        ("BeaconClose", E(new Vector2(173, 132), 2), G(BeaconTower, 7), false),
                        ("Camp", E(new Vector2(206, 94)), G(new Vector2(234, 64), 1), false),
                        ("NorthView", E(new Vector2(180, 150)), G(new Vector2(150, 220), 10), false),
                    });
                }
                finally
                {
                    Object.DestroyImmediate(preview);
                }
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        /// <summary>
        /// L1 规则：关卡场景只有环境和标记——一个 PlayerSpawn、一个自举标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录（这些在 Core 场景和 GameDatabase）；
        /// M11：测试武器架已撤。顺带重新生成 GameDatabase，报告里列出敌人 / 武器 Prefab 是否齐全
        /// </summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<Spiritfire.Game.PlayerSpawn>();
            int boots = Count<Spiritfire.Game.LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            void None<T>(string what) where T : Component
            {
                int n = Count<T>();
                if (n > 0) rep.Fail($"场景里有 {n} 个 {what}（应在 Core 场景）");
            }
            None<Spiritfire.Game.PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<Spiritfire.Game.Hud>("HUD");
            None<Spiritfire.Game.GameSession>("会话");
            None<Spiritfire.Game.EnemyCatalog>("敌人目录（改由 GameDatabase 提供）");
            int racks = Count<Spiritfire.Game.WeaponRack>();
            if (racks > 0) rep.Fail($"场景里还有 {racks} 个测试武器架（M11 撤掉了：第二把枪从 ① 的宝箱里拿）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话 / 测试武器架");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>PlaceOrBox 放的占位白盒（缺 Prefab）</summary>
        static bool IsPlaceholder(GameObject go) => !go || go.name.StartsWith("Placeholder");

        /// <summary>
        /// 摆一件要非均匀缩放 / 往沙里埋的套件：有 Prefab 时放到 ground − sink 处、按 scale 缩放；没有时在地面上放 box 大小的占位白盒
        /// （露出的样子，打 Placeholder 标签）。yaw 同时作用于两者。
        /// </summary>
        static GameObject Piece(string id, Transform parent, Vector3 ground, float yaw, Vector3 scale, float sink, Vector3 box)
        {
            if (!ShowcaseSceneBuilder.Prefab(id)) return LevelKit.PlaceOrBox(id, parent, ground, box, yaw);
            var go = LevelKit.PlaceOrBox(id, parent, ground - Vector3.up * sink, box, yaw);
            go.transform.localScale = scale;
            return go;
        }

        /// <summary>远景：地形外的远景地面（顶面 y = 2，与地形外缘相接）+ 远景环（近沙丘、两圈赭红台地；正北压低一道缺口，露出雅丹群和坐像的剪影）</summary>
        static void BuildBackdrop(Transform env, ShowcaseTheme theme)
        {
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), 2f, new Color(0.82f, 0.64f, 0.45f));
            var ring = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(130, 100), 2f, 760, 11);
            ring.gapAngle = 90;
            ring.gapWidth = 40;
            LevelKit.Backdrop(ring, env);
        }

        /// <summary>
        /// ④ 驼队营地的周期沙暴（maps/1-1.md §6）：营地 85 m 内（烽燧台顶、台南坡脚）开始计时，6 s 后第一次预警；
        /// 平静 22 → 预警 7 → 风暴 18 → 消退 6 s；从东侧涌入。WorldSuite 读第一个区域，这里只放这一个
        /// </summary>
        static Spiritfire.Game.WeatherDirector.Region Sandstorm(Terrain t) => new()
        {
            name = "④ 驼队营地沙暴", center = LevelKit.OnGround(t, Camp.x, Camp.y), radius = 28, fade = 24, from = Vector2.right,
            calm = 22, warn = 7, storm = 18, abate = 6, firstDelay = 6, armRadius = 85,
        };

        // ───────────── 散布 ─────────────

        /// <summary>
        /// 散布规则（L4 戈壁预设 + 本图密度图）：黑戈壁砾石在 ① 满密度、放大到 1.5 倍，别处 0.55；骆驼刺再加干河床两岸、④ 盆地；
        /// 红柳再加河床两岸。驿站院子、出口、烽燧台面与坡道上不撒（<see cref="ScatterKeep"/>）
        /// </summary>
        static LevelKit.ScatterRule[] ScatterRules()
        {
            var rules = LevelKit.ScatterPresets.DesertDetails();
            foreach (var r in rules)
            {
                var preset = r.where;
                float Preset(LevelKit.ScatterPoint pt) => preset?.Invoke(pt) ?? 1f;
                switch (r.name)
                {
                    case "DesertPebbles":
                        r.perHundredSqm = 5f;
                        r.scale = new Vector2(0.7f, 1.5f);
                        r.where = pt => ScatterKeep(pt.p) * Preset(pt) * Mathf.Lerp(0.55f, 1f, Disc(pt.p, Gravel, 30, 16));
                        break;
                    case "DesertCamelthorn":
                        r.where = pt => ScatterKeep(pt.p) * Mathf.Max(Preset(pt), RiverBank(pt.p) * 0.8f, Disc(pt.p, Camp, 20, 8) * 0.5f * (1 - pt.s.rock));
                        break;
                    case "DesertTamarisk":
                        r.where = pt => ScatterKeep(pt.p) * Mathf.Max(Preset(pt), RiverBank(pt.p) * 0.7f);
                        break;
                    default:
                        r.where = pt => ScatterKeep(pt.p) * Preset(pt);
                        break;
                }
            }
            return rules;
        }

        /// <summary>干河床两岸（陡坎外 0–5 m，河床起点淡出段不算）</summary>
        static float RiverBank(Vector2 p)
        {
            var (d, t) = Polyline(p, River);
            return Smooth(3.2f, 4.6f, d) * (1 - Smooth(6f, 10f, d)) * Smooth(0.06f, 0.18f, t);
        }

        /// <summary>散布 / 车辙的保留遮罩：驿站院子、出口祭坛前、烽燧台面与两条坡道上为 0</summary>
        static float ScatterKeep(Vector2 p)
        {
            float built = Mathf.Max(Disc(p, StationYard, 10, 4), Disc(p, Exit, 7, 3));
            built = Mathf.Max(built, Smooth(0.05f, 0.3f, Plateau(p, Beacon, PlateauHalf, PlateauAngle, 1, PlateauEdge, NoRamps)));
            foreach (var (foot, rtop, width) in PlateauRamps) built = Mathf.Max(built, Ramp(p, foot, rtop, width, PlateauEdge * 0.6f).mask);
            return 1 - built;
        }

        /// <summary>
        /// 古道车辙贴花（SM_Decal_DesertCartRuts，2.4 × 8 m，贴图沿 Z 循环）：沿古道每 8 m 一片，首尾相接，按两端地面高度顺坡倾斜；
        /// 出生点附近、烽燧台面与坡道上不铺。贴花不挡人、不挡子弹、不投影：碰撞体关掉。返回片数
        /// </summary>
        static int BuildCartRuts(Terrain t, Transform parent)
        {
            var root = new GameObject("Cart Ruts").transform;
            root.SetParent(parent, false);
            int n = Mathf.FloorToInt(RoadLength / RutLength), placed = 0;
            for (int i = 0; i < n; i++)
            {
                var a = RoadAt(i * RutLength / RoadLength);
                var b = RoadAt((i + 1) * RutLength / RoadLength);
                var mid = (a + b) * 0.5f;
                if (ScatterKeep(mid) < 0.5f || Vector2.Distance(mid, Spawn) < 12f) continue;
                var d = b - a;
                float run = d.magnitude;
                if (run < 1f) continue;
                float ya = LevelKit.GroundY(t, a.x, a.y), yb = LevelKit.GroundY(t, b.x, b.y);
                float yaw = Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg, pitch = -Mathf.Atan2(yb - ya, run) * Mathf.Rad2Deg;
                float y = Mathf.Max((ya + yb) * 0.5f, LevelKit.GroundY(t, mid.x, mid.y)) + 0.03f;
                var go = LevelKit.PlaceOrBox(CartRutsId, root, new Vector3(mid.x, y, mid.y), new Vector3(2.4f, 0.05f, run), yaw);
                if (IsPlaceholder(go)) continue;
                go.name = $"Cart Ruts {i:00}";
                go.transform.SetPositionAndRotation(new Vector3(mid.x, y, mid.y), Quaternion.Euler(pitch, yaw, 0));
                go.transform.localScale = new Vector3(1, 1, run / RutLength);
                foreach (var c in go.GetComponentsInChildren<Collider>(true)) c.enabled = false;
                foreach (var r in go.GetComponentsInChildren<Renderer>(true)) r.shadowCastingMode = ShadowCastingMode.Off;
                placed++;
            }
            return placed;
        }

        // ───────────── 摆放 ─────────────

        static void BuildStation(Terrain t, Transform parent, Transform props)
        {
            // 驿站废墟：夯土院墙（SM_Tripo_DesertPosthouseWall，两端平切可连排）。每段按长度分几块、块长拉伸到正好；矮段按高度缩放（不低于 0.6 倍）、
            // 余下的埋进沙里。正面（窗、门框那面）朝院子
            var root = new GameObject("Station Ruin").transform;
            root.SetParent(parent, false);
            int k = 0;
            foreach (var (a, b, h) in StationWalls)
            {
                var d = b - a;
                float len = d.magnitude;
                var dir = d / len;
                int pieces = Mathf.Max(1, Mathf.RoundToInt(len / PosthouseWallSize.x));
                float pieceLen = len / pieces;
                float sy = Mathf.Max(0.6f, h / PosthouseWallSize.y), sink = PosthouseWallSize.y * sy - h;
                // 局部 +Z 朝院子（yaw = 走向 + 90° 时 +Z 是走向的右侧；院子在左侧就转 180°）
                float yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg + 90;
                var right = new Vector2(dir.y, -dir.x);
                if (Vector2.Dot(right, StationYard - (a + b) * 0.5f) < 0) yaw += 180;
                for (int i = 0; i < pieces; i++)
                {
                    var c = a + dir * ((i + 0.5f) * pieceLen);
                    var go = Piece(PosthouseWallId, root, LevelKit.OnGround(t, c.x, c.y), yaw,
                        new Vector3(pieceLen / PosthouseWallSize.x, sy, 1), sink, new Vector3(pieceLen, h, PosthouseWallSize.z));
                    if (!IsPlaceholder(go)) go.name = $"Station Wall {k:00}";
                    k++;
                }
            }
            LevelKit.PlaceOrBox("SM_Tripo_DesertGoodsPile", props, t, 18, 40, 30, new Vector3(2.5f, 1.6f, 2f));
            LevelKit.PlaceOrBox("SM_Prop_DesertUrns", props, t, 17, 33, 120, new Vector3(1.5f, 1.2f, 1.5f));
            LevelKit.PlaceOrBox("SM_Env_DesertRuin", props, t, 8, 52, 20, new Vector3(6, 4, 6));
        }

        static void BuildHanWall(Terrain t, Transform parent)
        {
            // 汉长城：断续的夯土墙段，多数 1.2 m（低掩体，可跳上），少数残高 2.6 m（全遮）；古道穿过的地方是 6 m 宽的缺口；
            // 北端是墩台转角（SM_Tripo_DesertHanWallCorner），向西折进沙丘
            var root = new GameObject("Han Wall").transform;
            root.SetParent(parent, false);
            var rng = new System.Random(7);
            int seg = 0;
            var (breach, breachDir) = WallBreach();
            float endReach = BreachHalf + HanWallEndSize.x;
            for (int i = 0; i + 1 < HanWall.Length; i++)
            {
                var a = HanWall[i];
                var b = HanWall[i + 1];
                float len = Vector2.Distance(a, b);
                var dir = (b - a) / len;
                // 最后一段停在转角的回臂之前（回臂占末端 4 m，再留 0.6 m 的断口）
                float limit = i == HanWall.Length - 2 ? len - CornerArm - 0.6f : len;
                float s = (float)rng.NextDouble() * 2;
                while (s < limit)
                {
                    float l = 5 + (float)rng.NextDouble() * 4;
                    float e = Mathf.Min(limit, s + l);
                    if (e - s < 2.5f) break;
                    var mid = a + dir * ((s + e) / 2);
                    if (Polyline(mid, Road).dist > 3 + (e - s) / 2 && Vector2.Distance(mid, breach) > endReach + (e - s) / 2)
                    {
                        bool tall = seg % 4 == 2;
                        float h = tall ? 2.6f : 1.2f;
                        // 正式资产（长轴沿 X，高 3.5 m）：不压扁高度，整段埋进沙里只露出 h——夯层贴图不变形，半埋的残墙也正是戈壁汉长城的样子。
                        // 长度方向拉到墙段长，厚度放到约 2 m
                        float yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;
                        var wall = Piece(HanWallId, root, LevelKit.OnGround(t, mid.x, mid.y), yaw + 90,
                            new Vector3((e - s) / HanWallSize.x, 1, 2f / HanWallSize.z), HanWallSize.y - h, new Vector3(e - s, h, 2f));
                        if (!IsPlaceholder(wall)) wall.name = $"Han Wall {seg:00}";
                        seg++;
                    }
                    s = e + 2 + (float)rng.NextDouble() * 3;
                }
            }

            // 古道穿过的缺口：两侧各一段断口端头（SM_Tripo_DesertHanWallEnd），坍塌的一头朝向古道，完整的一头接回墙身
            foreach (int side in new[] { -1, 1 })
            {
                var p = breach + breachDir * side * (BreachHalf + HanWallEndSize.x / 2);
                var toRoad = (breach - p).normalized;
                // 断口资产的坍塌端在局部 +X（见 HanWallEndCollapseX）；Unity 绕 Y 转 yaw 后局部 +X = (cos yaw, −sin yaw)
                float yaw = Mathf.Atan2(-toRoad.y, toRoad.x) * Mathf.Rad2Deg + (HanWallEndCollapseX > 0 ? 0 : 180);
                var end = Piece(HanWallEndId, root, LevelKit.OnGround(t, p.x, p.y), yaw, new Vector3(1, 1, 2f / HanWallEndSize.z),
                    HanWallEndSize.y - 2.7f, new Vector3(HanWallEndSize.x, 2.7f, 2f));
                if (!IsPlaceholder(end)) end.name = side < 0 ? "Han Wall Breach W" : "Han Wall Breach E";
            }

            // 北端墩台转角：局部 −Z 臂沿墙身往回、−X 臂向西折（yaw = 墙走向时局部 +Z = 走向、−X = 走向的左侧 = 西）；露出 2.6 m，
            // 西臂外再接一段 4.5 m 的墙身没进沙丘。转角内侧是「戍卒窖藏」
            var (corner, along, west) = WallCorner();
            float cy = Mathf.Atan2(along.x, along.y) * Mathf.Rad2Deg;
            var cg = Piece(HanWallCornerId, root, LevelKit.OnGround(t, corner.x, corner.y), cy, Vector3.one, HanWallSize.y - CornerHeight,
                new Vector3(1.4f, CornerHeight, 1.4f));
            if (!IsPlaceholder(cg)) cg.name = "Han Wall Corner N";
            var tail = corner + west * (CornerArm + 0.5f + 2.25f);
            float ty = Mathf.Atan2(west.x, west.y) * Mathf.Rad2Deg;
            var tw = Piece(HanWallId, root, LevelKit.OnGround(t, tail.x, tail.y), ty + 90, new Vector3(4.5f / HanWallSize.x, 1, 2f / HanWallSize.z),
                HanWallSize.y - 2.0f, new Vector3(4.5f, 2.0f, 2f));
            if (!IsPlaceholder(tw)) tw.name = "Han Wall Tail W";
        }

        /// <summary>古道与汉长城的交点（缺口中心）和该处墙的走向</summary>
        static (Vector2 at, Vector2 dir) WallBreach()
        {
            float best = float.MaxValue;
            Vector2 at = HanWall[0], dir = Vector2.up;
            for (int i = 0; i + 1 < HanWall.Length; i++)
            {
                var a = HanWall[i];
                var b = HanWall[i + 1];
                for (float k = 0; k <= 1; k += 0.01f)
                {
                    var q = Vector2.Lerp(a, b, k);
                    float d = Polyline(q, Road).dist;
                    if (d < best) { best = d; at = q; dir = (b - a).normalized; }
                }
            }
            return (at, dir);
        }

        /// <summary>长城北端的转角：位置、最后一段墙的走向、走向的左侧（西）</summary>
        static (Vector2 at, Vector2 along, Vector2 west) WallCorner()
        {
            var along = (HanWall[^1] - HanWall[^2]).normalized;
            return (HanWall[^1], along, new Vector2(-along.y, along.x));
        }

        static void BuildGravelField(Terrain t, Transform props)
        {
            // ① 散布巨砾（2.6 m 高掩体），避开古道、长城（含北端转角向西的尾段）、河床、戍卒窖藏
            var rng = new System.Random(11);
            int placed = 0;
            var (corner, _, west) = WallCorner();
            var tail = new[] { corner, corner + west * (CornerArm + 7) };
            for (int tries = 0; tries < 200 && placed < 9; tries++)
            {
                float ang = (float)rng.NextDouble() * Mathf.PI * 2, r = 6 + (float)rng.NextDouble() * 22;
                var p = Gravel + new Vector2(Mathf.Cos(ang), Mathf.Sin(ang)) * r;
                if (Polyline(p, Road).dist < 5 || Polyline(p, HanWall).dist < 4 || Polyline(p, River).dist < 6) continue;
                if (Polyline(p, tail).dist < 4 || Vector2.Distance(p, CacheCellar) < 6) continue;
                float yaw = (float)rng.NextDouble() * 360, h = 1.6f + (float)rng.NextDouble() * 1.2f; // 取随机数的顺序同白盒版：布局不变
                LevelKit.PlaceOrBox("SM_Env_DesertSandstone", props, t, p.x, p.y, yaw, new Vector3(2.2f, h, 2.2f), h, 0.3f);
                placed++;
            }
        }

        static void BuildYardang(Terrain t, Transform props)
        {
            // ② 倒伏石柱 + 碎石（掩体），岩丘本身是地形
            LevelKit.PlaceOrBox("SM_Tripo_DesertColumnRuin", props, t, 116, 96, 20, new Vector3(1.6f, 4f, 1.6f));
            LevelKit.PlaceOrBox("SM_Tripo_DesertColumnRuin", props, t, 128, 108, 140, new Vector3(1.6f, 4f, 1.6f));
            var fallen = LevelKit.PlaceOrBox("SM_Tripo_DesertColumn", props, t, 110, 100, 0, new Vector3(6f, 1.2f, 1.2f));
            if (!IsPlaceholder(fallen))
            {
                fallen.transform.rotation = Quaternion.Euler(0, 55, 88);
                fallen.transform.position += Vector3.up * 0.6f;
            }
            var rng = new System.Random(5);
            foreach (var p in new[] { new Vector2(112, 88), new Vector2(130, 104), new Vector2(120, 114), new Vector2(98, 96) })
            {
                float yaw = (float)rng.NextDouble() * 360, h = 1.3f + (float)rng.NextDouble();
                LevelKit.PlaceOrBox("SM_Env_DesertSandstone", props, t, p.x, p.y, yaw, new Vector3(2f, h, 2f), h, 0.3f);
            }
        }

        static Vector3 BuildBeacon(Terrain t, Transform parent)
        {
            // 烽燧（SM_Tripo_DesertBeaconTower，14 m，望楼与柴笼在顶上，正面朝西坡道来的方向）+ 台沿垛墙 + 三堆积薪
            var root = new GameObject("Beacon").transform;
            root.SetParent(parent, false);
            float gy = LevelKit.GroundY(t, BeaconTower.x, BeaconTower.y);
            var b = new Vector3(BeaconTower.x, gy, BeaconTower.y);
            var tower = LevelKit.PlaceOrBox(BeaconTowerId, root, b - Vector3.up * 0.3f, new Vector3(6, 14, 6), BeaconYaw);

            // 垛墙（SM_Tripo_DesertBeaconParapet，1.89 m 一块，两垛一口）：沿台沿每 5.5 m 一组两块，组间留空隙可穿行；坡道顶两侧不放；
            // 局部 +Z 朝台外（垛口朝外，蹲在后面能射台下）
            float rad = PlateauAngle * Mathf.Deg2Rad;
            var ax = new Vector2(Mathf.Cos(rad), Mathf.Sin(rad));
            var az = new Vector2(-Mathf.Sin(rad), Mathf.Cos(rad));
            Vector2 L(float x, float z) => Beacon + ax * x + az * z;
            float hx = PlateauHalf.x - 0.6f, hz = PlateauHalf.y - 0.6f;
            var edges = new[] { (L(-hx, -hz), L(hx, -hz)), (L(hx, -hz), L(hx, hz)), (L(hx, hz), L(-hx, hz)), (L(-hx, hz), L(-hx, -hz)) };
            int groups = 0;
            foreach (var (a, c) in edges)
            {
                float len = Vector2.Distance(a, c);
                var dir = (c - a) / len;
                var outward = new Vector2(dir.y, -dir.x);
                if (Vector2.Dot(outward, (a + c) * 0.5f - Beacon) < 0) outward = -outward;
                float yaw = Mathf.Atan2(outward.x, outward.y) * Mathf.Rad2Deg;
                for (float s = 1; s + 3 < len; s += 5.5f)
                {
                    var mid = a + dir * (s + 1.9f);
                    if (PlateauRamps.Any(r => Vector2.Distance(mid, r.top) < 6)) continue;
                    foreach (int k in new[] { -1, 1 })
                    {
                        var p = mid + dir * (k * ParapetSize.x * 0.5f);
                        var go = LevelKit.PlaceOrBox(ParapetId, root, LevelKit.OnGround(t, p.x, p.y, -0.08f), ParapetSize, yaw);
                        if (!IsPlaceholder(go)) go.name = $"Parapet {groups:00}{(k < 0 ? "a" : "b")}";
                    }
                    groups++;
                }
            }
            // 积薪（SM_Tripo_DesertBrushwoodPile，放大 1.7 倍 ≈ 2 m 见方、2.2 m 高）
            foreach (var p in new[] { L(-7, 4), L(-4, 6), L(-8, -3) })
                LevelKit.PlaceOrBox(BrushwoodId, root, LevelKit.OnGround(t, p.x, p.y, -0.1f), new Vector3(2.2f, 2.2f, 2.2f), 35, 1.7f);
            // 狼烟从柴笼里冒出来（柴笼在烽燧顶上的一角）
            var smoke = IsPlaceholder(tower) ? b + Vector3.up * 14.8f : tower.transform.TransformPoint(BeaconBasketLocal);
            LevelKit.Smoke(Dir, root, smoke, new Color(0.24f, 0.21f, 0.2f, 0.7f));
            return smoke + Vector3.up * 6;
        }

        static void BuildCamp(Terrain t, Transform parent, Transform props)
        {
            // 驼队残骸：两套 SM_Tripo_DesertCaravanWreck（大车 + 货包 + 半埋驼骨），外加散落的货堆、陶罐、残帐
            var root = new GameObject("Caravan Wreck").transform;
            root.SetParent(parent, false);
            foreach (var (p, yaw, scale) in new[] { (new Vector2(214, 70), 30f, 1.4f), (new Vector2(228, 82), -65f, 1.25f) })
            {
                var wreck = LevelKit.PlaceOrBox("SM_Tripo_DesertCaravanWreck", root, t, p.x, p.y, yaw, new Vector3(6, 2.5f, 3) * scale, 0, 0.2f);
                if (!IsPlaceholder(wreck)) wreck.transform.localScale = Vector3.one * scale;
            }
            LevelKit.PlaceOrBox("SM_Tripo_DesertGoodsPile", props, t, 222, 66, 200, new Vector3(2.5f, 1.6f, 2f));
            LevelKit.PlaceOrBox("SM_Tripo_DesertGoodsPile", props, t, 208, 80, 70, new Vector3(2.5f, 1.6f, 2f), 1.6f);
            LevelKit.PlaceOrBox("SM_Prop_DesertUrns", props, t, 218, 78, 10, new Vector3(1.5f, 1.2f, 1.5f));
            LevelKit.PlaceOrBox("SM_Tripo_DesertMarketStall", props, t, 230, 70, -30, new Vector3(3, 3, 2.5f));
            LevelKit.PlaceOrBox("SM_Tripo_DesertBarricade", props, t, 212, 62, 100, new Vector3(3, 1.2f, 1));
        }

        /// <summary>
        /// 「商队遗货」的陈设：一车货翻在雅丹背风处——货堆、陶罐在沙里露一角，拒马挡在蝎卫那一侧当掩体。
        /// 都离藏宝点 ≥ 3.9 m（宝箱从藏宝点原地冒出来，接近位要留空）。「戍卒窖藏」的标志就是长城转角本身
        /// </summary>
        static void BuildCacheDressing(Terrain t, Transform props)
        {
            var root = new GameObject("Cache Dressing").transform;
            root.SetParent(props, false);
            LevelKit.PlaceOrBox("SM_Tripo_DesertGoodsPile", root, t, CacheWreck.x + 4, CacheWreck.y + 3, 40, new Vector3(2.5f, 1.4f, 2f), 1.4f, 0.4f);
            LevelKit.PlaceOrBox("SM_Prop_DesertUrns", root, t, CacheWreck.x - 3.6f, CacheWreck.y + 2.6f, 160, new Vector3(1.5f, 1.2f, 1.5f), 0, 0.3f);
            LevelKit.PlaceOrBox("SM_Tripo_DesertBarricade", root, t, CacheWreck.x - 1.5f, CacheWreck.y - 4.6f, 120, new Vector3(3, 1.2f, 1));
        }

        /// <summary>
        /// 遭遇战（遭遇框架 v2，docs/encounter-design.md「Unity 遭遇框架 v2」；场地、波次、奖励见 maps/1-1.md §2）：
        ///   ① 黑戈壁砾石滩：跳鼠群 + 蝎尾弩卫远程压制（玩家从长城缺口进来就开打）——单波
        ///   ② 雅丹石阵：蜃楼蟾在岩丘后吊射 + 跳鼠；第二波跳鼠绕岩伏击，其中一只换成沙魇（EN1，全游戏第一只：蟾大多倒下后才开波，单只、预警清楚）
        ///   ③ 烽燧台地：镇墓兽冲锋上坡 + 邪飞天在台顶支援；第二波台下援军
        ///   ④ 驼队残骸营地：沙暴前锋（火浣鼠滚进来逼走位，精英蝎卫压制）→ 风沙压境（精英镇墓兽）
        /// 目标图 <see cref="Spiritfire.Game.LevelObjective"/>：四个场地必清；② ③ 只要求 ①（先后不限），④ 要求 ② ③。
        /// 藏宝点 <see cref="Spiritfire.Game.CachePOI"/>：「戍卒窖藏」无守军；「商队遗货」的守军是 autoTrigger 关掉的可选场地，调查时开战。
        /// 出生锚点用 BuildMarkers 摆的 Enemy_&lt;场地&gt;_* 标记，挂 <see cref="Spiritfire.Game.SpawnAnchor"/>（<see cref="AnchorRoles"/>），运行时按角色挑站位。
        /// 敌人 Prefab / 挂件运行时从 GameDatabase 取（L1 起场景里不再放敌人目录）。
        /// </summary>
        static Spiritfire.Game.LevelObjective BuildEncounters(Terrain t, Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            Spiritfire.Game.EncounterSite Site(string name, string marker, string anchors, string title, float trigger, float arena,
                Spiritfire.Game.EncounterSpec spec, params Spiritfire.Game.EncounterSite[] requires)
            {
                var site = new GameObject(name).AddComponent<Spiritfire.Game.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = markers.Find(marker).position;
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.requires = requires ?? System.Array.Empty<Spiritfire.Game.EncounterSite>();
                var list = new List<Transform>();
                foreach (Transform m in markers)
                    if (m.name.StartsWith(anchors))
                    {
                        Anchor(m);
                        list.Add(m);
                    }
                site.anchors = list.ToArray();
                return site;
            }
            Spiritfire.Game.WaveEntry E(string enemy, int count, float delay = -1) => Spiritfire.Game.EncounterSpec.E(enemy, count, delay);
            Spiritfire.Game.WaveSpec Wave(string label, params Spiritfire.Game.WaveEntry[] entries) => Spiritfire.Game.EncounterSpec.Wave(label, entries);
            // 出生点离玩家 10–28 m（1-1 的场地 40–60 m，远程站位在场地边上）；沿路遭遇首波集结 0.4 s
            Spiritfire.Game.EncounterSpec Of(params Spiritfire.Game.WaveSpec[] waves) =>
                Spiritfire.Game.EncounterSpec.Of(waves).Gather(0.4f).Distance(10, 28);

            // 奖励节奏：① 雷弧发射器（雷，配燎的火技能出焚雷），② 灵兽封印（按品阶权重抽一只灵宠，docs/pet-system.md），
            //          ③ 青冥雷蛊（精良，蚀 + 雷：封脉 / 熔金 / 归墟），④ 秘卷；② ③ 先后不限，奖励跟场地走
            var s1 = Site("Site 1 · 黑戈壁砾石滩", "Site_1_GravelField", "Enemy_1_", "黑戈壁砾石滩", 17, 28,
                Of(Wave("黑戈壁砾石滩", E("jerboa_blade", 4), E("scorpion_archer", 2, 1.2f)).Hint("蝎卫在河岸上压制：贴着长城残墙推进")));
            s1.reward = "weapon:beam";
            var s2 = Site("Site 2 · 雅丹石阵", "Site_2_Yardang", "Enemy_2_", "雅丹石阵", 18, 30,
                Of(Wave("雅丹石阵", E("mirage_toad", 2), E("jerboa_blade", 3, 0.6f)).Hint("蜃楼蟾在岩丘后吊射：低丘顶能看到它们"),
                    Wave("绕岩伏击", E("jerboa_blade", 2), E("sand_wraith", 1)).After(2, 1.2f).Hint("跳鼠从岩丘背后绕过来，沙魇在沙下潜行——脚下亮圈就跑开")), s1);
            s2.reward = "pet"; // 旧场景没重建时由 PetBootstrap 在运行时把 ② 的 scroll 换成 pet
            var s3 = Site("Site 3 · 烽燧台地", "Site_3_BeaconPlateau", "Enemy_3_", "烽燧台地", 20, 30,
                Of(Wave("冲坡", E("tomb_beast", 1), E("apsara", 1, 1.5f)).Hint("镇墓兽冲上坡：侧闪，打背后的裂缝；先打台顶的飞天"),
                    Wave("台下援军", E("jerboa_blade", 3), E("scorpion_archer", 1)).After(1, 1.5f)), s1);
            s3.reward = "weapon:stormpod:1";
            var s4 = Site("Site 4 · 驼队残骸营地", "Site_4_CaravanCamp", "Enemy_4_", "驼队残骸营地", 18, 30,
                Of(Wave("沙暴前锋", E("fire_rat", 3), E("jerboa_blade", 3, 1f), E("scorpion_archer", 1, 2f).Elite()).Hint("沙暴将至：火浣鼠滚进来逼走位"),
                    Wave("风沙压境", E("mirage_toad", 1), E("fire_rat", 3), E("tomb_beast", 1).Elite()).After(2, 1.5f)
                        .Hint("沙暴里远程看不清，近战借风沙逼近")), s2, s3);
            s4.reward = "scroll";

            // 藏宝点（可选，不影响出口；maps/1-1.md §3）
            var guard = Site("Cache Guard · 商队遗货", "Cache_2_Caravan", "Enemy_C2_", "商队遗货守军", 12, 22,
                Spiritfire.Game.EncounterSpec.Of(Wave("商队遗货守军", E("jerboa_blade", 2), E("scorpion_archer", 1)).Hint("击败守军后收取遗货"))
                    .Gather(0.4f).Distance(8, 24));
            guard.autoTrigger = false;
            guard.optional = true;
            guard.reward = ""; // 奖励在藏宝点的宝箱里，场地肃清不另落箱
            Spiritfire.Game.CachePOI Cache(string name, string marker, string title, string reward, Spiritfire.Game.EncounterSite by)
            {
                var c = new GameObject(name).AddComponent<Spiritfire.Game.CachePOI>();
                c.transform.SetParent(root, false);
                c.transform.position = markers.Find(marker).position;
                c.title = title;
                c.reward = reward;
                c.discoverRadius = 14f;
                c.guard = by;
                return c;
            }
            Cache("Cache 1 · 戍卒窖藏", "Cache_1_HanWall", "戍卒窖藏", "coins", null);
            Cache("Cache 2 · 商队遗货", "Cache_2_Caravan", "商队遗货", "upgrade", guard);

            var objective = new GameObject("Level Objective").AddComponent<Spiritfire.Game.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿越古道";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { guard };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 锚点标记的站位（标记名 → 角色、lane、高台）：跳鼠两处侧翼位分两条 lane，蝎卫站东岸远程位，蜃楼蟾站岩丘后的炮击位，
        /// 镇墓兽站西坡道脚的正面位（冲上坡），飞天站台顶（高台）；④ 的两个混编位不限角色；藏宝守军两处侧翼位 + 一处远程位。
        /// 没列出的标记不限角色、lane 0、地面。
        /// </summary>
        static readonly Dictionary<string, (Spiritfire.Game.StationRole role, int lane, bool elevated)> AnchorRoles = new()
        {
            ["Enemy_1_Jerboa_A"] = (Spiritfire.Game.StationRole.Flank, 0, false),
            ["Enemy_1_Jerboa_B"] = (Spiritfire.Game.StationRole.Flank, 1, false),
            ["Enemy_1_ScorpionArcher_EastBank"] = (Spiritfire.Game.StationRole.Ranged, 0, false),
            ["Enemy_2_MirageToad_A"] = (Spiritfire.Game.StationRole.Artillery, 0, false),
            ["Enemy_2_Jerboa_Flank"] = (Spiritfire.Game.StationRole.Flank, 1, false),
            ["Enemy_3_TombBeast_RampW"] = (Spiritfire.Game.StationRole.Assault, 0, false),
            ["Enemy_3_Apsara_Top"] = (Spiritfire.Game.StationRole.Support, 0, true),
            ["Enemy_4_EliteWave_A"] = (Spiritfire.Game.StationRole.Auto, 0, false),
            ["Enemy_4_EliteWave_B"] = (Spiritfire.Game.StationRole.Auto, 1, false),
            ["Enemy_C2_Jerboa_A"] = (Spiritfire.Game.StationRole.Flank, 0, false),
            ["Enemy_C2_Jerboa_B"] = (Spiritfire.Game.StationRole.Flank, 1, false),
            ["Enemy_C2_Scorpion"] = (Spiritfire.Game.StationRole.Ranged, 0, false),
        };

        static void Anchor(Transform marker)
        {
            var a = marker.GetComponent<Spiritfire.Game.SpawnAnchor>();
            if (!a) a = marker.gameObject.AddComponent<Spiritfire.Game.SpawnAnchor>();
            if (AnchorRoles.TryGetValue(marker.name, out var r)) (a.role, a.lane, a.elevated) = r;
        }

        static void BuildMarkers(Terrain t, Transform root)
        {
            // 场地、藏宝点与刷怪标记：名字 = 场地 / 角色，位置在地面
            void Mk(string name, Vector2 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = LevelKit.OnGround(t, p.x, p.y);
            }
            Mk("Site_Spawn", Spawn);
            Mk("Site_1_GravelField", Gravel);
            Mk("Site_2_Yardang", Yardang);
            Mk("Site_3_BeaconPlateau", Beacon);
            Mk("Site_4_CaravanCamp", Camp);
            Mk("Site_Exit", Exit);
            Mk("Cache_1_HanWall", CacheCellar);
            Mk("Cache_2_Caravan", CacheWreck);
            Mk("Route_Ford", Ford);
            Mk("Route_BypassSouth", BypassSouth);
            Mk("Route_BypassEast", BypassEast);
            Mk("Route_RampWFoot", RampWFoot);
            Mk("Route_RampEFoot", RampEFoot);
            Mk("Enemy_1_Jerboa_A", new Vector2(86, 64));
            Mk("Enemy_1_Jerboa_B", new Vector2(80, 44));
            Mk("Enemy_1_ScorpionArcher_EastBank", new Vector2(104, 60));
            Mk("Enemy_2_MirageToad_A", new Vector2(130, 112));
            Mk("Enemy_2_Jerboa_Flank", new Vector2(100, 116));
            Mk("Enemy_3_TombBeast_RampW", new Vector2(160, 132));
            Mk("Enemy_3_Apsara_Top", Beacon + new Vector2(4, -2));
            Mk("Enemy_4_EliteWave_A", Camp + new Vector2(5, -1)); // 离货摊 ≥ 3.5 m：精英镇墓兽半径约 1.9 m（L5 出生净空）
            Mk("Enemy_4_EliteWave_B", Camp + new Vector2(-8, 6));
            // 藏宝守军：离遗货 11–16 m，都在可玩区遮罩 ≥ 0.9 的地方（再往东南就是界外沙丘）
            Mk("Enemy_C2_Jerboa_A", new Vector2(134, 70));
            Mk("Enemy_C2_Jerboa_B", new Vector2(150, 92));
            Mk("Enemy_C2_Scorpion", new Vector2(128, 70));
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，docs/unity-parity.md L5）的声明：主线（含 ② 南侧绕行和两个藏宝点）、古道坡度、6 条地标视线；
        /// 可玩区遮罩与 LevelKit.Boundary 同一个；软边界没有空气墙，越界按远处的兜底环算（escapeMargin = 兜底距离 + 2 m）。
        /// 场地尺寸取 unity-maps-v1.md 1-1 表。掩体 / 层数阈值只防退化，实测数字看报告。
        /// 锚点（含藏宝守军）、宝箱落点、藏宝点、出口传送门、占位件、渲染器由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec(Terrain terrain, Vector3 smokeAt)
        {
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            return new LevelSpec
                {
                    id = "1-1", title = "古道穿越戈壁", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = p => Playable(p, RoadDist(p)), escapeMargin = Bounds.EscapeMargin,
                    slopePaths = { new SlopePath { name = "古道", points = Road } },
                    sites =
                    {
                        S("驿站废墟（缓冲）", Spawn, 30, combat: false),
                        S("① 黑戈壁砾石滩", Gravel, 55, cover: 4),
                        S("② 雅丹石阵", Yardang, 50, cover: 3, layers: 2, overlook: true),
                        S("③ 烽燧台地", Beacon, 40, cover: 2, layers: 2, overlook: true),
                        S("④ 驼队残骸营地", Camp, 45, cover: 3),
                    },
                }
                .Route("出生·驿站", G(Spawn)).Route("① 黑戈壁", G(Gravel)).Route("藏宝·戍卒窖藏", G(CacheCellar)).Route("河床浅滩", G(Ford))
                .Route("② 雅丹", G(Yardang)).Route("② 低丘顶", G(Mesas[0].c)).Route("② 雅丹", G(Yardang))
                .Route("② 南侧绕行", G(BypassSouth)).Route("藏宝·商队遗货", G(CacheWreck)).Route("② 东南", G(BypassEast))
                .Route("西坡道脚", G(RampWFoot)).Route("③ 烽燧台顶", G(Beacon)).Route("④ 营地", G(Camp)).Route("出口", G(Exit))
                .Sight("出生点 → 烽燧狼烟", G(Spawn, 1.62f), smokeAt + Vector3.up * 8)
                .Sight("① 入口 → 雅丹高丘", G(new Vector2(58, 50), 1.62f), G(Mesas[2].c, Mesas[2].h - 0.5f), 8)
                .Sight("② 出口 → 烽燧", G(new Vector2(140, 118), 1.62f), smokeAt, 6)
                .Sight("③ 台顶 → ④ 营地", G(new Vector2(188, 136), 1.62f), G(Camp, 1.5f), 6)
                .Sight("③ 台顶 → 远景雅丹群", G(new Vector2(182, 150), 1.62f), G(Mesas[5].c, Mesas[5].h * 0.8f), 14, "SM_Tripo_DesertYardangFleet")
                .Sight("④ 入口 → 出口祭坛", G(new Vector2(212, 96), 1.62f), G(Exit, 2.5f), 6);
        }
    }
}
