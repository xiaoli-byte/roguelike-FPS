using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 2-4 北冥冰台 · 鲲鹏（docs/level-design/maps/2-4.md；V2 白盒 frost-5-v2，docs/unity-parity.md D3 / D5 / M24）：第二章的首领场。
    /// 关卡坐标 = 世界 XZ（米），冰窟圆心在原点，环台地面 y = 0，北 = +Z。地形 176 × 176 m。
    ///
    ///   出生 · 雪岭营地：西南方低处的雪岭碗（地面 −8 m），补给营（<see cref="SupplyCamp"/>，霜山商摊 SM_Tripo_FrostMarketStall）开店——
    ///     第二章的补给营就在首领场前（同 1-3 寺院前庭之于旱魃）；四周雪岭 18 m，看不到冰台
    ///   → 冰崖通道：营地东门出，宽 10 m，在 (−32, −49) 转一次弯折向北，约 27 m 爬 8 m（≤ 18°），两侧是切开的冰崖
    ///   → 北冥冰台：内径 15、外径 44 的环形冰台绕中央冰窟一整圈；外缘 12 m 内冰崖陡升到 18 m（60–70°，爬不上去，也不立空气墙）。
    ///     冰窟是地形洞（碰撞与渲染都开口），里面一块 L8 深水（落水 = 扣 10% 生命、托回安全落脚点），水底兜底碰撞；
    ///     冰窟一圈 20 段冰窟边缘（SM_Tripo_FrostIceHoleRim，正面朝圆心，前后沿都互相插进去）；冰沿外四段 L8 冰面（吞吸时打滑）；
    ///     r 29 四根冰柱（SM_Tripo_FrostIcePillar × 6 m）；东西两座 2.5 m 祭台（朝冰窟一侧 4 m 宽的阶梯坡，台上鲸骨灯）；两道 1.2 m 矮墙；
    ///     南缘挖出一个门洞平台，北冥冰门（SM_Tripo_FrostSeaGateway）背靠冰崖，结算后 BossEncounter 在门前立出口。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、自举标记、补给营、首领场地（<see cref="BossArena"/>）、首领关流程（<see cref="BossEncounter"/>，首领 boss_kunpeng）、
    /// 冰窟（<see cref="IceHole"/>：半径、外缘、水面；运行时铺水面遮罩，鲲鹏按它找冰窟）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 2-4 北冥冰台（或 bridge.sh level 2-4）。
    /// </summary>
    [LevelBuilder("2-4", ScenePath)]
    public static class Level_2_4
    {
        public const string Dir = "Assets/Levels/L2_4_Beiming";
        public const string ScenePath = "Assets/Scenes/L2_4_Beiming.unity";
        const string Name = "L2_4";
        /// <summary>首领（KunPengDef.Id；写字面量，构建器不依赖首领单元的文件顺序）</summary>
        const string BossId = "boss_kunpeng";

        // ── 高度（世界 y）──
        /// <summary>高度场里 Base 米 = 世界 y 0（营地 −8、冰窟洞底 −3 也在范围内）</summary>
        const float Base = 12f, HeightRange = 50f;
        /// <summary>四周冰崖 / 雪岭顶面</summary>
        const float Top = 18f;
        static readonly Vector2 Origin = new(-104, -100), Size = new(176, 176);

        // ── 冰台与冰窟 ──
        static readonly Vector2 Hole = Vector2.zero;
        /// <summary>冰窟半径（地形洞随方位 ± HoleWobble 起伏）、环台外缘（± OuterWobble）、外缘冰崖宽</summary>
        const float HoleR = 15f, HoleWobble = 0.4f, Outer = 44f, OuterWobble = 1.2f, Wall = 12f;
        /// <summary>冰沿：r LipInner–LipOuter 高出环台 LipHeight（水面方块的四角藏在它下面），再 LipFade 米落回环台；洞里压到 HoleFloor</summary>
        const float LipHeight = 0.25f, LipOuter = 23f, LipFade = 3f, HoleFloor = -3f;
        /// <summary>水面（相对环台地面，同 Three.js 海面 +0.06）、水深、水底兜底碰撞的顶面</summary>
        const float WaterLevel = IceHole.DefaultWaterLevel, WaterDepth = 6f, SeabedTop = -7f;

        // ── 冰窟边缘段（ART5：正面朝冰窟中心）──
        // 段是直的，一圈围成多边形。ART5 建议的 16 段 × 1.55 只按前沿（r 15）的弦长放大，后沿（r 17.8）每处接缝都留 1 m 上下的楔形缺口。
        // 改成 20 段、按后沿弦长再放大一成（约 1.63 倍）：前后沿都互相插进去，段与段之间再交替偏航 ±4°、隔段镜像，接缝不成一条直线
        const string RimId = "SM_Tripo_FrostIceHoleRim";
        const int RimSegments = 20;
        const float RimOverlap = 1.1f, RimJitter = 4f;
        static readonly Vector3 RimSize = new(3.79f, 2.2f, 2.76f);

        // ── 冰柱（r 29，四个斜角）──
        const string PillarId = "SM_Tripo_FrostIcePillar";
        const float PillarR = 29f, PillarHeight = 6f;
        static readonly float[] PillarAz = { 45, 135, 225, 315 };
        static readonly Vector3 PillarSize = new(2.8f, PillarHeight, 3f);

        // ── 祭台（径向 8 × 切向 14 m、2.5 m 高，朝冰窟一侧 4 m 宽的阶梯坡）──
        static readonly (string name, Vector2 c, Vector2 foot, Vector2 top)[] Altars =
        {
            ("西祭台", new Vector2(-36, 0), new Vector2(-25, 0), new Vector2(-32, 0)),
            ("东祭台", new Vector2(36, 0), new Vector2(25, 0), new Vector2(32, 0)),
        };
        static readonly Vector2 AltarHalf = new(4, 7);
        const float AltarHeight = 2.5f, AltarEdge = 0.8f, AltarStairWidth = 4f;

        // ── 矮墙（V2 的两道 1.2 m 矮墙：南侧东西向、东侧南北向）──
        static readonly (Vector2 c, float yaw)[] LowWalls = { (new Vector2(1, -28.6f), 0), (new Vector2(16.6f, -7), 90) };

        // ── 冰面（L8：冰沿外四段 40° 弧，避开矮墙）──
        static readonly float[] IceAz = { 0, 60, 180, 270 };
        const float IceArc = 40f, IceInner = 18f, IceOuter = 21.5f;

        // ── 雪岭营地 ──
        static readonly Vector2 Camp = new(-60, -54), CampRadius = new(16, 14);
        const float CampFloor = -8f, CampWall = 9f;
        static readonly Vector2 ShopAt = new(-58, -53), SpawnAt = new(-68, -60);

        // ── 冰崖通道（转一次弯）──
        static readonly Vector2[] PassCtrl = { new(-50, -51), new(-40, -50), new(-32, -49), new(-28, -39), new(-25, -31), new(-22, -26) };
        static readonly float[] PassHeights = { CampFloor, -7.5f, -5f, -2.2f, 0f, 0f };
        const float PassHalfWidth = 5f, PassShoulder = 3f;
        static readonly PathSpline PassPath = new PathSpline(PassCtrl, 6).WithHeights(PassHeights, 4);

        // ── 南缘出口 ──
        static readonly Vector2 ExitAt = new(0, -40), GateAt = new(0, -47.5f), Apron = new(0, -45);
        const float ApronR = 6f;
        const string GateId = "SM_Tripo_FrostSeaGateway";

        // ── 标记 ──
        static readonly Vector2 BossSpawn = new(0, 17), PlayerEntry = new(-22, -27), RewardAt = new(14, -33);
        static readonly float[] PerchAz = { 0, 110, 180, 250 };

        // ───────────── 地貌 ─────────────

        /// <summary>环台外缘半径（随方位起伏，az 弧度）</summary>
        static float RingEdge(float az) => Outer + Loop(az, 7, 2, 3) * OuterWobble;

        /// <summary>冰窟地形洞半径（随方位起伏，略小于 HoleR：边缘段的正面压在洞沿上）</summary>
        static float HoleEdge(float az) => HoleR - 0.3f + Loop(az, 11, 2, 9) * HoleWobble;

        /// <summary>可玩区（防越界 / 俯视图）：环台往冰崖里 3 m、营地往雪岭里 3 m、通道两侧 3 m、南缘门洞以内算界内</summary>
        static float Playable(Vector2 p)
        {
            float r = (p - Hole).magnitude;
            float ring = 1 - Smooth(Outer, Outer + 3, r);
            var d = p - Camp;
            float rr = Mathf.Sqrt(d.x * d.x / (CampRadius.x * CampRadius.x) + d.y * d.y / (CampRadius.y * CampRadius.y));
            float camp = 1 - Smooth(1, 1 + 3f / Mathf.Min(CampRadius.x, CampRadius.y), rr);
            var (pd, _) = PassPath.Nearest(p, PassHalfWidth + 8);
            float pass = 1 - Smooth(PassHalfWidth + 2, PassHalfWidth + 4, pd);
            float apron = Disc(p, Apron, ApronR, 2);
            return Mathf.Max(Mathf.Max(ring, camp), Mathf.Max(pass, apron));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float top = Top + Fbm(p, 40, 3, 1) * 1.5f;
            var d = p - Hole;
            float r = d.magnitude, az = Mathf.Atan2(d.x, d.y);

            // 冰台：外缘以内是平的环台（极轻的起伏），外缘外 Wall 米内陡升到岩顶（同 1-4 的洞穴碗壁曲线）
            float x = r - RingEdge(az);
            float k = Smooth(0, 1, Mathf.Clamp01(x / Wall));
            float ringFloor = 1 - Smooth(0, 3, x);
            float wallA = Smooth(0.5f, 3, x) * (1 - Smooth(Wall * 0.8f, Wall * 1.1f, x));
            float floorA = Fbm(p, 22, 2, 4) * 0.06f;
            float hA = Mathf.Lerp(floorA, top, Mathf.Pow(k, 0.65f));
            // 南缘门洞：外缘在冰门前挖出一块平台
            float apron = Disc(p, Apron, ApronR, 4);
            hA = Mathf.Lerp(hA, floorA, apron);

            // 雪岭营地：一个浅碗（地面 −8，雪岭到岩顶）
            float campDepth = Top - CampFloor;
            float bowl = CaveBowl(p, Camp, CampRadius, campDepth, CampWall, 0, 1, 7, out float campFloor, out float wallB);
            float hB = Mathf.Lerp(CampFloor + Fbm(p, 18, 2, 6) * 0.25f, top, (bowl + campDepth) / campDepth);
            float h = Mathf.Min(hA, hB);
            bool inCamp = hB < hA;

            // 冰沿：r < LipOuter 高出 LipHeight，再落回环台；冰窟里卷进水下
            float lip = LipHeight * (1 - Smooth(LipOuter, LipOuter + LipFade, r)) * ringFloor;
            h += lip;
            float edge = HoleEdge(az);
            h = Mathf.Lerp(h, HoleFloor, Smooth(HoleR + 0.4f, HoleR - 0.8f, r));
            s.hole = r < edge ? 1 : 0;

            // 祭台（只在环台上）
            float altars = 0, altarTop = 0;
            foreach (var a in Altars)
            {
                float v = Plateau(p, a.c, AltarHalf, 0, AltarHeight, AltarEdge, new[] { (a.foot, a.top, AltarStairWidth) });
                altars = Mathf.Max(altars, v);
                altarTop = Mathf.Max(altarTop, Smooth(AltarHeight - 0.4f, AltarHeight - 0.05f, v));
            }
            h += altars * ringFloor;

            // 冰崖通道：沿纵断面压平（又挖又填），两侧是切开的冰崖
            h = PassPath.Flatten(p, h, PassHalfWidth, PassShoulder, PathSpline.Mode.Both, out float passMask);
            s.h = h + Base;

            // ── 分层（冰原：0 雪 / 1 冻土 / 2 冰 / 3 岩）──
            float rim = Smooth(LipOuter + 1f, LipOuter - 1f, r) * ringFloor;
            s.fluid = Mathf.Max(rim, Smooth(HoleR + 0.5f, HoleR - 0.5f, r));
            // 环台是压实的雪面，只在风刮秃的几片露出冻土碎石（整圈都铺冻土时碎石点满地，像豹纹）
            float scoured = Smooth(0.15f, 0.6f, Fbm(p, 9, 2, 12));
            // 冰崖通道的冻土路面走上环台后几米内淡回雪面（登台口一眼看过去不是一片碎石点）
            float pathSoil = passMask * (1 - Smooth(-2f, -8f, x));
            s.packed = Mathf.Max(Mathf.Max(pathSoil * 0.85f, altarTop * 0.9f), ringFloor * (1 - apron * 0.3f) * 0.5f * scoured);
            float drift = Smooth(Outer - 9, Outer - 1, r) * ringFloor * (0.6f + 0.4f * (Fbm(p, 7, 2, 13) * 0.5f + 0.5f));
            // 祭台的侧壁和台面不铺（侧壁留岩、台面是冻土）
            float ringSnow = ringFloor * (1 - Smooth(0.02f, 0.2f, altars)) * (0.85f - 0.25f * scoured);
            s.sand = Mathf.Max(Mathf.Max(Mathf.Max(drift, ringSnow), inCamp ? campFloor * 0.8f : 0), apron * 0.6f) * (1 - pathSoil);
            s.rock = Mathf.Max(wallA, wallB) * (1 - passMask) * (1 - apron);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 2-4 北冥冰台", priority = 70)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh → 验收检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Frost;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange, heightRes = 513, splatRes = 512,
                ground = LevelKit.Ground.Frost, eval = Eval,
            }, env);
            var terrain = set.First;

            // 远景：冰原的近处岩脊 + 两圈雪峰，环脚压在冰崖顶下；北风（风从冰窟方向吹向营地），常态风力 0.35
            LevelKit.Backdrop(LevelKit.BackdropFor(theme, Dir, Name, Hole, Top - 4f, 760, 24), env);
            LevelKit.Weather(env, theme, new Vector2(-0.45f, -0.9f), 0.35f);

            var hole = BuildIceHole(set, env, markers, out var water, out int rimArt);
            var pillars = BuildRing(set, props, out int iceSegments);
            BuildAltars(set, props);
            var gate = BuildExitGate(set, props);
            var camp = BuildCamp(set, props, markers);
            BuildPassage(set, props);
            var arena = BuildArena(set, markers, out var exitPoint, out var rewardPoint);
            BuildEncounter(markers, arena, exitPoint, rewardPoint);

            // 玩家在 Core 场景（L1）：这里只放出生标记 + 自举标记
            var spawnAt = set.OnGround(SpawnAt.x, SpawnAt.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(Flat(set.OnGround(ShopAt.x, ShopAt.y) - spawnAt));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("2-4 北冥冰台 · 白盒验收");
            CheckGeometry(rep, set, hole, water, rimArt, pillars, iceSegments, gate, camp);
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线 + L5 规则集（含防越界：没有空气墙，冰崖本身是边界）
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_2-4_report.txt");

            if (review)
            {
                Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_2-4", new[]
                    {
                        ("Aerial", new Vector3(-70, 95, -110), new Vector3(-10, 0, -10), false),
                        ("Map", new Vector3(-16, 230, -12), new Vector3(-16, 0, -11), false),
                        ("Spawn", E(SpawnAt), G(ShopAt, 1.5f), true),
                        ("Camp", E(new Vector2(-66, -46)), G(PassCtrl[1], 1f), false),
                        ("PassageTurn", E(PassCtrl[1]), G(PassCtrl[3], 1f), false),
                        ("Entry", E(PlayerEntry), new Vector3(0, 2f, 0), true),
                        ("RimNorth", E(new Vector2(-8, 24)), new Vector3(0, 0.5f, 6), false),
                        ("AltarWest", E(new Vector2(-36, 3), AltarHeight + 1.62f), G(Altars[1].c, 3f), false),
                        ("Pillar", E(new Vector2(14, 30)), G(new Vector2(20.5f, 20.5f), 3f), false),
                        ("ExitGate", E(new Vector2(0, -24)), G(GateAt, 5f), false),
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

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        static Vector2 Polar(float azDeg, float dist)
        {
            float a = azDeg * Mathf.Deg2Rad;
            return Hole + new Vector2(Mathf.Sin(a), Mathf.Cos(a)) * dist;
        }

        // ───────────── 冰窟 ─────────────

        /// <summary>
        /// 冰窟：标记（<see cref="IceHole"/>：半径、外缘、水面）+ L8 深水（32 × 32 m 方块，顶面 = 水面；四角藏在冰沿下面；深水按坠落处理，扣 10% 托回）
        /// + 水底兜底碰撞 + 冰窟上空的 Not Walkable 条带 + 一圈 20 段冰窟边缘（正面朝圆心）。返回标记；rimArt = 摆成正式件的段数
        /// </summary>
        static IceHole BuildIceHole(LevelKit.TerrainSet set, Transform env, Transform markers, out WaterVolume water, out int rimArt)
        {
            var root = new GameObject("Beiming Ice Hole").transform;
            root.SetParent(env, false);

            // 深水：方块底面在 −WaterDepth，顶面 = 水面
            float half = HoleR + 1f;
            var block = LevelKit.Box("Beiming Sea", root, new Vector3(Hole.x, -WaterDepth, Hole.y), new Vector3(half * 2, WaterDepth + WaterLevel, half * 2), 0, null, 0);
            water = LevelKit.WaterBody(block, -WaterDepth, WaterDepth + WaterLevel);
            water.deep = 1.3f;
            water.drownBurst = 0.1f;
            water.wadeSlow = 0.45f;

            // 水底兜底：不渲染的碰撞块（托回失败时人不会一直往下掉）
            var seabed = LevelKit.Box("Seabed (failsafe)", root, new Vector3(Hole.x, SeabedTop - 1f, Hole.y), new Vector3(half * 2 + 2, 1f, half * 2 + 2), 0, null, 0);
            seabed.GetComponent<MeshRenderer>().enabled = false;

            // 冰窟上空：1 m 宽的 Not Walkable 条带拼成圆（不依赖烘焙器会不会扣掉地形洞；水底兜底块上也不铺网格）
            var nav = new GameObject("Ice Hole Nav Blockers (Not Walkable)").transform;
            nav.SetParent(root, false);
            int notWalkable = NavMesh.GetAreaFromName("Not Walkable");
            if (notWalkable < 0) notWalkable = 1;
            for (float x0 = -HoleR; x0 < HoleR; x0 += 1f)
            {
                float near = Mathf.Min(Mathf.Abs(x0), Mathf.Abs(x0 + 1f));
                if (x0 < 0 && x0 + 1f > 0) near = 0;
                float hz = Mathf.Sqrt(Mathf.Max(0, HoleR * HoleR - near * near));
                if (hz < 0.3f) continue;
                var go = new GameObject($"Not Walkable {x0:+0;-0}");
                go.transform.SetParent(nav, false);
                go.transform.position = new Vector3(Hole.x + x0 + 0.5f, 0, Hole.y);
                go.isStatic = true;
                var v = go.AddComponent<NavMeshModifierVolume>();
                v.center = Vector3.zero;
                v.size = new Vector3(1f, 60f, hz * 2f);
                v.area = notWalkable;
            }

            // 冰窟边缘：RimSegments 段，段心在 r = HoleR + 进深 / 2，正面（+Z）朝圆心，X 放大到后沿弦长 × RimOverlap（见常量的说明）
            var rim = new GameObject("Ice Hole Rim").transform;
            rim.SetParent(root, false);
            float chord = 2f * (HoleR + RimSize.z) * Mathf.Tan(Mathf.PI / RimSegments) * RimOverlap;
            float sx = chord / RimSize.x;
            rimArt = 0;
            for (int i = 0; i < RimSegments; i++)
            {
                float az = (i + 0.5f) * 360f / RimSegments;
                var c = Polar(az, HoleR + RimSize.z * 0.5f);
                var at = new Vector3(c.x, LipHeight - 0.2f, c.y);
                float jitter = (i % 2 == 0 ? 1 : -1) * RimJitter;
                var piece = LevelKit.PlaceOrBox(RimId, rim, at, new Vector3(chord, RimSize.y, RimSize.z), az + 180f + jitter);
                if (!piece) continue;
                if (piece.name.StartsWith(RimId))
                {
                    // 隔段镜像（X 取反）：同一块网格不连着重复
                    piece.transform.localScale = new Vector3(i % 2 == 0 ? sx : -sx, 1f, 1f);
                    rimArt++;
                }
                piece.name = $"{(piece.name.StartsWith(RimId) ? "Rim" : piece.name)} {i + 1:00}";
            }

            var go2 = new GameObject("IceHole");
            go2.transform.SetParent(markers, false);
            go2.transform.position = new Vector3(Hole.x, 0, Hole.y);
            var hole = go2.AddComponent<IceHole>();
            hole.radius = HoleR;
            hole.outer = Outer;
            hole.waterLevel = WaterLevel;
            hole.water = water;
            hole.rimRoot = rim;
            return hole;
        }

        // ───────────── 环台 ─────────────

        /// <summary>
        /// 环台上的件：四根冰柱（6 m）、两道矮墙（各两段 1.2 m 的北冥拒马）、冰沿外四段 L8 冰面（每段 3 块，顶面高出冰沿 0.12 m）、
        /// 外缘三处船桅残骸。返回冰柱；iceSegments = 冰面块数
        /// </summary>
        static List<GameObject> BuildRing(LevelKit.TerrainSet set, Transform props, out int iceSegments)
        {
            var t = set.First;
            var rng = new System.Random(24);
            var pillars = new List<GameObject>();
            foreach (float az in PillarAz)
            {
                var c = Polar(az, PillarR);
                var go = LevelKit.PlaceOrBox(PillarId, props, t, c.x, c.y, (float)rng.NextDouble() * 360f, PillarSize, PillarHeight, 0.3f);
                if (!go) continue;
                go.name = $"Ice Pillar {az:0}";
                pillars.Add(go);
            }
            foreach (var (c, yaw) in LowWalls)
            {
                var dir = Quaternion.Euler(0, yaw, 0) * Vector3.right;
                foreach (float s in new[] { -1.35f, 1.35f })
                {
                    var p = new Vector2(c.x + dir.x * s, c.y + dir.z * s);
                    var go = LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBarricade", props, t, p.x, p.y, yaw, new Vector3(2.7f, 1.2f, 0.8f), 1.2f, 0.1f);
                    if (go) go.name = $"Low Wall ({c.x:0}, {c.y:0})";
                }
            }

            // 冰面：每段弧 3 块，块的局部 Z 沿径向（yaw = 方位角），X 沿切向
            var iceRoot = new GameObject("Ice Sheets").transform;
            iceRoot.SetParent(props, false);
            iceSegments = 0;
            float rMid = (IceInner + IceOuter) * 0.5f, step = IceArc / 3f;
            float len = rMid * step * Mathf.Deg2Rad * 1.08f;
            foreach (float az0 in IceAz)
            for (int i = -1; i <= 1; i++)
            {
                float az = az0 + i * step;
                var c = Polar(az, rMid);
                var block = LevelKit.Box($"Ice Sheet {az0:0}/{i + 1}", iceRoot, set.OnGround(c.x, c.y), new Vector3(len, 0.12f, IceOuter - IceInner), az, null, 0.3f);
                LevelKit.IceSurface(block);
                iceSegments++;
            }

            foreach (var (az, yaw) in new[] { (62f, 30f), (198f, 140f), (322f, 250f) })
            {
                var c = Polar(az, Outer - 3f);
                LevelKit.PlaceOrBox("SM_Tripo_FrostSeaMastRuin", props, t, c.x, c.y, yaw, new Vector3(2.2f, 1.6f, 1.2f), 1.6f, 0.15f);
            }
            return pillars;
        }

        /// <summary>祭台的件：每座台上两盏鲸骨灯（阶梯一侧的两角）、台后一堆供品</summary>
        static void BuildAltars(LevelKit.TerrainSet set, Transform props)
        {
            var t = set.First;
            foreach (var a in Altars)
            {
                float inward = Mathf.Sign(a.foot.x - a.c.x);
                foreach (float z in new[] { -5.5f, 5.5f })
                    LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBoneLantern", props, t, a.c.x + inward * 2.6f, a.c.y + z, inward > 0 ? 90 : -90, new Vector3(1f, 2.4f, 0.7f), 2.4f, 0.1f);
                LevelKit.PlaceOrBox("SM_Tripo_FrostOfferings", props, t, a.c.x - inward * 2.4f, a.c.y, inward > 0 ? 90 : -90, new Vector3(1.7f, 1.5f, 1.3f), 1.5f, 0.1f);
            }
        }

        /// <summary>南缘冰门：门洞平台后面，背靠冰崖，正面（+Z）朝冰窟；门前两盏鲸骨灯</summary>
        static GameObject BuildExitGate(LevelKit.TerrainSet set, Transform props)
        {
            var t = set.First;
            var gate = LevelKit.PlaceOrBox(GateId, props, t, GateAt.x, GateAt.y, 0, new Vector3(10.8f, 10.8f, 3f), 0, 0.2f);
            foreach (float x in new[] { -4.5f, 4.5f })
                LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBoneLantern", props, t, ExitAt.x + x, ExitAt.y - 2.5f, 0, new Vector3(1f, 2.4f, 0.7f), 2.4f, 0.1f);
            return gate;
        }

        // ───────────── 雪岭营地 / 冰崖通道 ─────────────

        /// <summary>
        /// 雪岭营地补给营：商店正面朝出生点（霜山商摊作摊位美术、铁砧作强化台美术），两顶毡帐、鱼架、鲸骨灯、营火点光、雪岭上几棵雪松
        /// </summary>
        static SupplyCamp BuildCamp(LevelKit.TerrainSet set, Transform props, Transform markers)
        {
            var t = set.First;
            var at = set.OnGround(ShopAt.x, ShopAt.y);
            var go = new GameObject("SupplyCamp");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(Flat(set.OnGround(SpawnAt.x, SpawnAt.y) - at)));
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 11f;
            zone.height = 6f;
            var camp = go.AddComponent<SupplyCamp>();
            camp.label = "雪岭营地 · 补给营";
            camp.safeRadius = 11f;
            camp.openShop = true;
            camp.restoreOnArrive = false;
            camp.stallArt = ShowcaseSceneBuilder.Prefab("SM_Tripo_FrostMarketStall");
            camp.benchArt = ShowcaseSceneBuilder.Prefab("SM_Prop_Anvil");
            if (!camp.stallArt) Debug.LogWarning("[Level] 缺少霜山商摊 SM_Tripo_FrostMarketStall：补给营摊位用程序摊桌");

            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaYurt", props, t, -70, -48, 110, new Vector3(3.2f, 3.4f, 3.1f), 0, 0.15f);
            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaYurt", props, t, -52, -63, -40, new Vector3(3.2f, 3.4f, 3.1f), 0, 0.15f);
            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaFishRack", props, t, -66, -45, 150, new Vector3(1.4f, 1.5f, 0.7f), 0, 0.1f);
            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBoneLantern", props, t, -64, -57, 60, new Vector3(1f, 2.4f, 0.7f), 2.4f, 0.1f);
            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBoneLantern", props, t, -53, -60, -30, new Vector3(1f, 2.4f, 0.7f), 2.4f, 0.1f);
            LevelKit.Prop("SM_Prop_FrostPrayerCairn", props, t, -73, -55, 20);
            foreach (var (x, z, s) in new[] { (-78f, -40f, 1.1f), (-82f, -60f, 0.9f), (-56f, -74f, 1.2f), (-46f, -70f, 1f), (-72f, -76f, 1f) })
                LevelKit.Prop("SM_Env_FrostPine", props, t, x, z, (x * 7 + z * 3) % 360, 4.5f * s, 0.3f);

            var light = new GameObject("Camp Light").AddComponent<Light>();
            light.transform.SetParent(props, false);
            light.transform.position = at + Vector3.up * 3f;
            light.type = LightType.Point;
            light.color = new Color(1f, 0.66f, 0.38f);
            light.intensity = 2.6f;
            light.range = 16f;
            light.shadows = LightShadows.None;
            return camp;
        }

        /// <summary>冰崖通道的件：转角外侧贴两片峡谷崖壁（SM_Tripo_FrostCanyonCliff，正面朝通道），营地东门一座祈福石堆，登台口一盏鲸骨灯</summary>
        static void BuildPassage(LevelKit.TerrainSet set, Transform props)
        {
            var t = set.First;
            foreach (var (p, face) in new[] { (new Vector2(-23f, -58f), PassCtrl[2]), (new Vector2(-18f, -44f), PassCtrl[3]) })
            {
                // 离通道中线至少路宽 + 路肩 + 2 m，只贴在切开的冰崖上
                var (dist, _) = PassPath.Nearest(p);
                if (dist < PassHalfWidth + PassShoulder + 2f) continue;
                var dir = face - p;
                LevelKit.PlaceOrBox("SM_Tripo_FrostCanyonCliff", props, t, p.x, p.y, Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg, new Vector3(14f, 19.7f, 7.8f), 0, 2f);
            }
            LevelKit.Prop("SM_Prop_FrostPrayerCairn", props, t, -44, -44.5f, 200);
            LevelKit.PlaceOrBox("SM_Tripo_FrostSeaBoneLantern", props, t, -27, -24, 120, new Vector3(1f, 2.4f, 0.7f), 2.4f, 0.1f);
        }

        // ───────────── 首领场标记 ─────────────

        /// <summary>
        /// 首领场地（<see cref="BossArena"/>，只给 boss_kunpeng）：圆心 = 冰窟圆心、半径 = 环台外缘 44 m。
        /// 出生点在冰沿北侧（鲲按它相对冰窟的方位第一次探头）；入场点 = 登台口；掩体点 = 四根冰柱外侧、两道矮墙背后、两座祭台的阶梯脚；
        /// 栖落点 = 环台中线上两柱之间的四处平地（鹏落台的参考）；边缘点 8 个。没有召唤点（鲲鹏不召小怪）。另给出口点与宝箱落点
        /// </summary>
        static BossArena BuildArena(LevelKit.TerrainSet set, Transform markers, out Transform exitPoint, out Transform rewardPoint)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var root = new GameObject("BossArena").transform;
            root.SetParent(markers, false);
            root.position = new Vector3(Hole.x, 0, Hole.y);
            var arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Circle;
            arena.radius = Outer;
            Transform Point(string name, Vector3 pos, Vector2 facing)
            {
                var p = new GameObject(name).transform;
                p.SetParent(root, false);
                p.position = pos;
                if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(new Vector3(facing.x, 0, facing.y));
                return p;
            }
            arena.bossSpawn = Point("BossSpawn", G(BossSpawn), new Vector2(0, -1));
            arena.playerEntry = Point("PlayerEntry", G(PlayerEntry), Hole - PlayerEntry);
            arena.summonPoints = new Transform[0];
            var covers = new List<Transform>();
            foreach (float az in PillarAz) covers.Add(Point($"Cover_Pillar{az:0}", G(Polar(az, PillarR + 3.2f)), -Polar(az, 1f)));
            covers.Add(Point("Cover_WallS", G(LowWalls[0].c + new Vector2(0, -1.4f)), Vector2.down));
            covers.Add(Point("Cover_WallE", G(LowWalls[1].c + new Vector2(1.4f, 0)), Vector2.right));
            foreach (var a in Altars) covers.Add(Point($"Cover_{(a.c.x < 0 ? "AltarW" : "AltarE")}", G(a.foot), a.c - a.foot));
            arena.coverPoints = covers.ToArray();
            arena.perchPoints = PerchAz.Select(az => Point($"Perch_{az:0}", G(Polar(az, (HoleR + Outer) * 0.5f)), -Polar(az, 1f))).ToArray();
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                var q = Polar(i * 45f + 22.5f, Outer - 2f);
                return Point($"Edge_{i + 1}", G(q), Hole - q);
            }).ToArray();
            exitPoint = Point("Boss Exit", G(ExitAt), new Vector2(0, -1));
            exitPoint.SetParent(markers, true);
            rewardPoint = Point("Boss Reward", G(RewardAt), PlayerEntry - RewardAt);
            rewardPoint.SetParent(markers, true);
            return arena;
        }

        /// <summary>首领关流程：走上环台 → 登场预警 2.5 s → 鲲自冰窟北侧探头；拴绳 8 m；倒下 → 溃散 → 结算宝箱落在南缘 → 冰门前升起出口（下一关 3-1，换章）</summary>
        static void BuildEncounter(Transform markers, BossArena arena, Transform exitPoint, Transform rewardPoint)
        {
            var go = new GameObject("Boss Encounter · 鲲鹏");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2f;
            enc.warnSeconds = 2.5f;
            enc.warnText = "北冥翻涌——鲲自冰窟醒来！";
            enc.tetherSlack = 8f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
        }

        // ───────────── 验收 ─────────────

        /// <summary>
        /// 白盒自查：关键点高度（环台、冰沿、营地、祭台顶、通道转角、门洞）、冰窟是地形洞（圆心、r 12 开口，r 16.5 实地）、水面高度与深水参数、
        /// 冰窟标记、边缘段 / 冰柱 / 冰面数量、营地看不到冰台（营地眼高到冰窟上空 / 北环台的连线被地形挡住）、通道坡度、补给营
        /// </summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, IceHole hole, WaterVolume water, int rimArt, List<GameObject> pillars, int iceSegments,
            GameObject gate, SupplyCamp camp)
        {
            rep.Section("地形与冰窟");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("北环台", Y(new Vector2(0, 31)), 0, 0.3f);
            Near("西环台（祭台与冰窟之间）", Y(new Vector2(-21, 8)), 0, 0.35f);
            Near("冰沿", Y(new Vector2(0, -19.5f)), LipHeight, 0.2f);
            Near("雪岭营地", Y(ShopAt), CampFloor, 0.5f);
            Near("西祭台顶", Y(new Vector2(-37, 4)), AltarHeight, 0.35f);
            Near("东祭台顶", Y(new Vector2(37, -4)), AltarHeight, 0.35f);
            Near("通道转角", Y(PassCtrl[2]), PassHeights[2], 0.8f);
            Near("南缘门洞", Y(new Vector2(0, -44)), 0, 0.6f);

            bool h0 = set.IsHole(Hole.x, Hole.y), h12 = set.IsHole(Hole.x + 12f, Hole.y), h16 = set.IsHole(Hole.x, Hole.y + 16.5f);
            if (!h0 || !h12) rep.Fail($"冰窟没有挖成地形洞（圆心 {h0}，r 12 {h12}）");
            else if (h16) rep.Fail("r 16.5（冰沿）也是地形洞：冰窟挖大了");
            else rep.Line($"✓ 冰窟是地形洞：圆心、r 12 开口，r 16.5 是实地（半径 {HoleR} ± {HoleWobble} m）");

            if (!water) rep.Fail("冰窟里没有水体（WaterVolume）");
            else
            {
                float surface = water.Surface;
                if (Mathf.Abs(surface - WaterLevel) > 0.02f) rep.Fail($"水面 y = {surface:F2}（应为 {WaterLevel:F2}）");
                else rep.Line($"✓ 水面 y = {surface:F2}，深水 ≥ {water.deep} m 按坠落处理（扣 {water.drownBurst:P0}、托回安全落脚点），水底兜底碰撞 y = {SeabedTop}");
                if (!water.deepIsHazard) rep.Fail("冰窟的水不是深水危险区（掉进去不会托回）");
                // 冰沿要盖住水面方块的四角：方块角上的地面高过水面
                float corner = Y(new Vector2(Hole.x + HoleR + 0.9f, Hole.y + HoleR + 0.9f));
                if (corner <= WaterLevel + 0.05f) rep.Fail($"水面方块的角露出来了：角上地面 y = {corner:F2}，水面 {WaterLevel:F2}");
            }
            if (!hole) rep.Fail("没有冰窟标记（IceHole）");
            else rep.Line($"✓ 冰窟标记：{hole.Info}；边缘段 {RimSegments} 段（正式件 {rimArt}）");
            if (rimArt < RimSegments) rep.Warn($"冰窟边缘有 {RimSegments - rimArt} 段是白盒（{RimId} 缺 Prefab）");
            if (pillars.Count != PillarAz.Length) rep.Fail($"冰柱只摆了 {pillars.Count} 根（应 {PillarAz.Length}）");
            else rep.Line($"✓ 冰柱 {pillars.Count} 根（{string.Join("、", pillars.Select(p => p.name.StartsWith("Placeholder") ? "白盒" : "正式件").Distinct())}），r {PillarR} m、{PillarHeight} m 高");
            if (iceSegments < IceAz.Length * 3) rep.Fail($"冰面只有 {iceSegments} 块");
            else rep.Line($"✓ 冰面 {IceAz.Length} 段弧 × 3 块（L8 SurfaceZone），r {IceInner}–{IceOuter} m");
            if (!gate) rep.Fail("南缘冰门没有摆出来");

            // 营地看不到冰台：营地眼高 → 冰窟上空 / 北环台，连线被地形挡住
            rep.Section("营地 / 冰崖通道");
            var eye = set.OnGround(ShopAt.x, ShopAt.y, 1.62f);
            foreach (var (what, target) in new[] { ("冰窟上空", new Vector3(Hole.x, 3f, Hole.y)), ("北环台", set.OnGround(0, 30, 2f)), ("东祭台", set.OnGround(36, 0, 4f)) })
            {
                bool blocked = Physics.Linecast(eye, target, Layers.WorldMask, QueryTriggerInteraction.Ignore);
                if (!blocked) rep.Fail($"从营地看得到{what}（营地应看不到冰台）");
                else rep.Line($"✓ 营地看不到{what}");
            }
            float worst = 0;
            for (int i = 0; i + 1 < PassPath.points.Count; i++)
            {
                var a = PassPath.points[i];
                var b = PassPath.points[i + 1];
                float d = Vector2.Distance(a, b);
                if (d < 0.05f) continue;
                worst = Mathf.Max(worst, Mathf.Atan(Mathf.Abs(Y(b) - Y(a)) / d) * Mathf.Rad2Deg);
            }
            if (worst > 24f) rep.Fail($"冰崖通道最陡 {worst:F0}°（> 24°），纵断面 {PassPath.MaxGrade():F0}°");
            else rep.Line($"✓ 冰崖通道长 {PassPath.length:F0} m、爬 {-CampFloor:F0} m，最陡 {worst:F0}°（纵断面 {PassPath.MaxGrade():F0}°）");
            if (!camp) rep.Fail("没有补给营标记");
            else rep.Line($"✓ 补给营「{camp.label}」安全区 {camp.safeRadius} m，摊位美术 {(camp.stallArt ? camp.stallArt.name : "（程序摊桌）")}，强化台 {(camp.benchArt ? camp.benchArt.name : "（程序）")}");
        }

        /// <summary>L1 规则（同 1-4）：关卡场景只有环境和标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录；顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), arenas = Count<BossArena>(), encounters = Count<BossEncounter>(),
                camps = Count<SupplyCamp>(), holes = Count<IceHole>(), portals = Count<ExitPortal>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (arenas != 1 || encounters != 1 || camps != 1 || holes != 1)
                rep.Fail($"BossArena {arenas} / BossEncounter {encounters} / SupplyCamp {camps} / IceHole {holes}（各应为 1）");
            // 场景里不放 ExitPortal：没有目标的出口开局就会自己开着，首领关的出口由 BossEncounter 打完后立
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（首领关的出口由 BossEncounter 结算后立）");
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1、BossArena / BossEncounter / SupplyCamp / IceHole 各 1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给 L5 规则集的声明：主线 出生 → 补给营 → 通道转角 → 登台口 → 西祭台顶 → 北环台 → 东祭台顶 → 南缘出口；
        /// 坡度（冰崖通道、两座祭台的阶梯坡）；地标视线（登台口 → 冰窟上空 / 东祭台，通道转角上段 → 登台口）；
        /// 场地：雪岭营地（缓冲）、北冥冰台（≥ 3 处掩体、两层以上、要有坡道上得去的俯射层）；补给营的 7 个摊位运行时才开店，按 ShopLayout 声明成交互点。
        /// 可玩区遮罩 = 环台 + 营地 + 通道 + 门洞，冰崖 60–70° 爬不上去，没有空气墙（escapeMargin 3 m）。白盒阶段占位只列清单（Warn）
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var spec = new LevelSpec
                {
                    id = "2-4", title = "北冥冰台", playerSpawn = G(SpawnAt), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = 3f, placeholders = PlaceholderPolicy.Warn,
                    slopePaths =
                    {
                        new SlopePath { name = "冰崖通道", points = PassPath.points },
                        new SlopePath { name = "西祭台阶梯坡", points = new[] { Altars[0].foot + new Vector2(1.5f, 0), Altars[0].top } },
                        new SlopePath { name = "东祭台阶梯坡", points = new[] { Altars[1].foot - new Vector2(1.5f, 0), Altars[1].top } },
                    },
                    sites =
                    {
                        new SiteSpec { name = "雪岭营地（缓冲）", center = G(ShopAt), size = 24, combat = false },
                        // 圆心在冰窟上（环台地面高度）、直径 = 外缘直径：冰窟本身站不了人，可站立面积仍有九成上下
                        new SiteSpec { name = "北冥冰台（首领场）", center = new Vector3(Hole.x, 0, Hole.y), size = Outer * 2, minCover = 3, minLayers = 2, overlook = true },
                    },
                }
                .Route("出生 · 雪岭营地", G(SpawnAt)).Route("补给营", G(ShopAt + new Vector2(-3, -3))).Route("通道转角", G(PassCtrl[2]))
                .Route("通道上段", G(PassCtrl[3])).Route("登台口", G(PlayerEntry)).Route("西祭台顶", G(new Vector2(-36, 4)))
                .Route("北环台", G(new Vector2(0, 31))).Route("东祭台顶", G(new Vector2(36, -4))).Route("南缘出口", G(ExitAt))
                .Sight("登台口 → 冰窟上空", G(PlayerEntry, 1.62f), new Vector3(Hole.x, 3f, Hole.y), 6)
                .Sight("登台口 → 东祭台", G(PlayerEntry, 1.62f), G(Altars[1].c, AltarHeight + 1f), 6)
                .Sight("通道上段 → 登台口", G(PassCtrl[3], 1.62f), G(PlayerEntry, 1f), 4);
            // 补给营的摊位运行时才开店：按 ShopLayout 声明（7 个摊位，强化台居中），商店正面朝出生点
            var center = G(ShopAt);
            var toSpawn = G(SpawnAt) - center;
            float yaw = Mathf.Atan2(toSpawn.x, toSpawn.z) * Mathf.Rad2Deg;
            var stations = ShopLayout.Build(center, yaw, 7, 3);
            for (int i = 0; i < stations.Count; i++)
                spec.interactables.Add(new InteractSpec
                {
                    name = $"补给营摊位 {i + 1}", kind = "ShopStall", focus = stations[i].position + Vector3.up * (i == 3 ? 0.95f : 1.15f), radius = 2.3f,
                    footprint = new Vector3(ShopLayout.StallHalfWidth, 0.55f, 0.5f),
                });
            return spec;
        }
    }
}
