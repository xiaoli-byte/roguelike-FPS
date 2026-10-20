using Spiritfire.Art;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-1 古道穿越戈壁（docs/level-design/unity-maps-v1.md §1-1）的白盒：地形 + 现有资产 + 白盒体块。
    /// 关卡坐标 = 世界 XZ（米），游玩区约 260 × 200 m，地形向外各扩 70 m 给边界沙丘与远景（雾里淡出，看不到地形边）。
    ///
    ///   出生·驿站废墟 (26,38) → 汉长城缺口 → ① 黑戈壁砾石滩 (80,58)，东侧干河床陡坎 1.5 m
    ///   → ② 雅丹石阵 (120,100)：三座岩丘 3.5 / 6 / 9 m，最矮一座背风沙坡可走上顶
    ///   → ③ 烽燧台地 (180,142)：6 m 夯土台，西坡道上、东南坡道下，台顶 14 m 烽燧 + 狼烟（全图地标）
    ///   → ④ 驼队残骸营地 (220,74)：沙丘围合的盆地 → 出口 (250,58)
    ///
    /// 主风向从东北吹向西南：雅丹长轴、沙丘脊线、狼烟的偏斜都按它排，地貌读起来是同一场风塑造的。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、场地与刷怪标记、遭遇战、出口、测试武器架、自举标记 <see cref="Spiritfire.Game.LevelBootstrap"/>；
    /// 玩家、HUD、各系统在常驻的 Core 场景（CoreSceneBuilder），敌人 / 武器 Prefab 在 GameDatabase。直接打开本场景按 Play 时自举标记把 Core 叠加进来。
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

        // ── 干河床（① 东缘，自西北向东南，起点淡出）──
        static readonly List<Vector2> River = Spline(new[]
        {
            new Vector2(78, 100), new Vector2(90, 82), new Vector2(96, 66), new Vector2(100, 46), new Vector2(110, 26), new Vector2(118, 0),
        });

        // ── 汉长城（自南向北斜穿 ①，古道从缺口穿过）──
        static readonly Vector2[] HanWall =
        {
            new(60, 16), new(66, 34), new(72, 53), new(79, 72), new(86, 92),
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
        static readonly Vector2 BeaconTower = new(185, 146);
        const float BeaconYaw = 235;
        /// <summary>烽燧 Prefab 局部坐标里柴笼顶部的位置（概念图正视图左上角）</summary>
        static readonly Vector3 BeaconBasketLocal = new(2.3f, 14.2f, 0.4f);
        const string HanWallId = "SM_Tripo_DesertHanWall", HanWallEndId = "SM_Tripo_DesertHanWallEnd";
        static readonly Vector3 HanWallEndSize = new(5.65f, 3.5f, 2.17f);
        /// <summary>断口资产的坍塌端在局部 X 的哪一侧（+1 / −1）</summary>
        const float HanWallEndCollapseX = -1;
        const float BreachHalf = 3.5f;
        static readonly Vector3 HanWallSize = new(5.33f, 3.5f, 1.37f);

        // ── 盆地 ──
        static readonly Vector2 BasinRadius = new(22, 19);

        // ───────────── 地貌 ─────────────
        static float BaseGround(Vector2 p) => Base + Fbm(p, 70, 4, 1) * 1.4f + Fbm(p, 18, 3, 2) * 0.35f;

        static float RiverDepth(Vector2 p)
        {
            var (d, t) = Polyline(p, River);
            float taper = Smooth(0, 0.12f, t);
            return 1.5f * taper * (1 - Smooth(3.5f, 4.6f, d + Fbm(p, 6, 2, 4) * 0.6f));
        }

        static float Ground0(Vector2 p) => BaseGround(p) - RiverDepth(p);

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

            // 游玩区之外：沙海抬升 + 大沙丘（脊高 12 m，迎风缓背风陡）——自然边界，翻不过去
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
            float pv = Plateau(p, Beacon, PlateauHalf, PlateauAngle, PlateauHeight, PlateauEdge, System.Array.Empty<(Vector2, Vector2, float)>());
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

            // 地形外缘 40 m 内落回世界 y = 2（与远景沙地平面相接）
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
            var wb = new GameObject("Whitebox").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var terrain = LevelKit.BuildTerrain(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = 48,
                layers = TerrainTextureGen.Desert(), eval = Eval, shadowTint = theme.groundShadowTint,
            }, env, out _);

            BuildFarGround(env);
            LevelKit.Boundary(Dir, Name, env, p => Playable(p, Polyline(p, Road).dist), new Rect(Origin, Size));
            var m = new Materials();
            BuildStation(terrain, wb, props, m);
            BuildHanWall(terrain, wb, m);
            BuildGravelField(terrain, props);
            BuildYardang(terrain, props);
            var smokeAt = BuildBeacon(terrain, wb, m);
            BuildCamp(terrain, wb, props, m);
            var exit = LevelKit.Prop("SM_Tripo_DesertPortalShrine", props, terrain, Exit.x, Exit.y, -100);
            ShowcaseSceneBuilder.Place("SM_Tripo_DesertColossus", env, LevelKit.OnGround(terrain, 150, 248, -2), 200, 3.2f);
            // 远景「舰队」雅丹（正式资产，长轴沿 Z）：顺主风向排在北侧沙丘外，烽燧台上望得到，指向下一张图「雅丹迷城」
            foreach (var (p, yaw, scale) in new[] { (new Vector2(92, 176), 215f, 1.5f), (new Vector2(172, 186), 210f, 1.9f), (new Vector2(212, 178), 220f, 1.3f) })
            {
                var fleet = ShowcaseSceneBuilder.Place("SM_Tripo_DesertYardangFleet", env, LevelKit.OnGround(terrain, p.x, p.y, -1.5f), yaw, scale);
                if (fleet) fleet.isStatic = true;
            }
            BuildMarkers(terrain, markers);

            // 玩家、HUD、各系统都在常驻的 Core 场景（L1）：这里只放出生标记（SceneFlow 在这里组装玩家，燎、冲锋枪起手）
            // + 自举标记（直接打开本场景按 Play 时把 Core 叠加进来）
            var spawnAt = LevelKit.OnGround(terrain, Spawn.x, Spawn.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(new Vector3(Gravel.x - Spawn.x, 0, Gravel.y - Spawn.y));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<Spiritfire.Game.PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<Spiritfire.Game.LevelBootstrap>();
            var objective = BuildEncounters(markers);
            // 武器架（测试便利，做完随机掉落后撤掉）：出生点前方 4.5 m 横排左轮 / 霰弹 / 榴弹
            var fwd = new Vector3(Gravel.x - Spawn.x, 0, Gravel.y - Spawn.y).normalized;
            var rack = new GameObject("Weapon Rack (test)").AddComponent<Spiritfire.Game.WeaponRack>();
            var rackAt = Spawn + new Vector2(fwd.x, fwd.z) * 4.5f;
            rack.transform.SetPositionAndRotation(LevelKit.OnGround(terrain, rackAt.x, rackAt.y, 0), Quaternion.LookRotation(-fwd));
            // 出口传送门：嵌在出口祭坛正面，关卡目标（四个场地肃清）完成后升起
            if (exit)
            {
                var portal = new GameObject("Exit Portal").AddComponent<Spiritfire.Game.ExitPortal>();
                var face = exit.transform.forward;
                portal.transform.SetPositionAndRotation(LevelKit.OnGround(terrain, Exit.x + face.x * ExitDoorOffset, Exit.y + face.z * ExitDoorOffset, 0),
                    Quaternion.LookRotation(-face));
                portal.objective = objective;
            }

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            if (!EditorBuildSettings.scenes.Any(s => s.path == ScenePath))
                EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

            var rep = new LevelKit.Report();
            rep.Line("1-1 古道穿越戈壁 · 白盒验收");
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            float top = LevelKit.GroundY(terrain, Beacon.x, Beacon.y);
            rep.Line($"烽燧台面 y = {top:F1}（台脚 {LevelKit.GroundY(terrain, RampWFoot.x, RampWFoot.y):F1}），雅丹低丘顶 y = {LevelKit.GroundY(terrain, Mesas[0].c.x, Mesas[0].c.y):F1}");
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
                        ("GravelField", E(new Vector2(58, 50)), G(new Vector2(100, 66), 1), false),
                        ("WallBreach", E(WallBreach().at + new Vector2(-14, -6)), G(WallBreach().at, 1.2f), false),
                        ("Riverbed", E(new Vector2(92, 40), 2.2f), G(new Vector2(98, 72), 0), false),
                        ("Yardang", E(new Vector2(106, 80)), G(new Vector2(126, 116), 4), false),
                        ("LowMesaTop", E(Mesas[0].c), G(new Vector2(136, 92), 2), false),
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
        /// 顺带重新生成 GameDatabase，报告里列出敌人 / 武器 Prefab 是否齐全
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        sealed class Materials
        {
            public readonly Material earth = LevelKit.Mat(Dir, "RammedEarth", new Color(0.74f, 0.58f, 0.42f));
            public readonly Material earthDark = LevelKit.Mat(Dir, "RammedEarthDark", new Color(0.6f, 0.45f, 0.33f));
            public readonly Material wood = LevelKit.Mat(Dir, "Wood", new Color(0.42f, 0.3f, 0.21f));
            public readonly Material reed = LevelKit.Mat(Dir, "Brushwood", new Color(0.62f, 0.52f, 0.34f));
            public readonly Material cloth = LevelKit.Mat(Dir, "Cloth", new Color(0.62f, 0.24f, 0.16f));
            public readonly Material indigo = LevelKit.Mat(Dir, "Indigo", new Color(0.2f, 0.27f, 0.45f));
            public readonly Material bone = LevelKit.Mat(Dir, "Bone", new Color(0.86f, 0.8f, 0.68f));
        }

        static void BuildFarGround(Transform env)
        {
            // 地形外的远景沙地：四块薄板围成一圈，顶面 y = 2 与地形外缘相接
            var m = LevelKit.Mat(Dir, "FarSand", new Color(0.82f, 0.64f, 0.45f));
            float x0 = Origin.x, z0 = Origin.y, x1 = Origin.x + Size.x, z1 = Origin.y + Size.y, far = 2500;
            var slabs = new[]
            {
                (new Vector3((x0 - far + x0) / 2, 0, (z0 + z1) / 2), new Vector3(far, 1, Size.y + 2 * far)),
                (new Vector3((x1 + x1 + far) / 2, 0, (z0 + z1) / 2), new Vector3(far, 1, Size.y + 2 * far)),
                (new Vector3((x0 + x1) / 2, 0, (z0 - far + z0) / 2), new Vector3(Size.x, 1, far)),
                (new Vector3((x0 + x1) / 2, 0, (z1 + z1 + far) / 2), new Vector3(Size.x, 1, far)),
            };
            foreach (var (c, s) in slabs)
            {
                var go = LevelKit.Box("FarSand", env, c + Vector3.up * 1f, s, 0, m, 0);
                Object.DestroyImmediate(go.GetComponent<Collider>());
            }
        }

        static void BuildStation(Terrain t, Transform wb, Transform props, Materials m)
        {
            // 驿站废墟：夯土院墙的一角（L 形，西、北两面，北墙有门洞），院里货堆与陶罐
            var root = new GameObject("Station Ruin").transform;
            root.SetParent(wb, false);
            void Wall(Vector2 a, Vector2 b, float h, float thick = 1f)
            {
                var c = (a + b) / 2;
                var d = b - a;
                LevelKit.Box("Station Wall", root, new Vector3(c.x, LevelKit.GroundY(t, c.x, c.y), c.y), new Vector3(thick, h, d.magnitude), Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg, m.earth, 0.6f);
            }
            Wall(new Vector2(14, 28), new Vector2(14, 44), 3.2f);
            Wall(new Vector2(14, 44), new Vector2(20, 47), 2.6f);
            Wall(new Vector2(24, 49), new Vector2(31, 52), 1.8f);
            Wall(new Vector2(20, 30), new Vector2(26, 28), 1.2f);
            LevelKit.Prop("SM_Tripo_DesertGoodsPile", props, t, 18, 40, 30);
            LevelKit.Prop("SM_Prop_DesertUrns", props, t, 17, 33, 120);
            LevelKit.Prop("SM_Env_DesertRuin", props, t, 8, 52, 20);
        }

        static void BuildHanWall(Terrain t, Transform wb, Materials m)
        {
            // 汉长城：断续的夯土墙段，多数 1.2 m（低掩体，可跳上），少数残高 2.6 m（全遮）；古道穿过的地方是 6 m 宽的缺口
            var root = new GameObject("Han Wall").transform;
            root.SetParent(wb, false);
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
                float s = (float)rng.NextDouble() * 2;
                while (s < len)
                {
                    float l = 5 + (float)rng.NextDouble() * 4;
                    float e = Mathf.Min(len, s + l);
                    var mid = a + dir * ((s + e) / 2);
                    if (Polyline(mid, Road).dist > 3 + (e - s) / 2 && Vector2.Distance(mid, breach) > endReach + (e - s) / 2)
                    {
                        bool tall = seg % 4 == 2;
                        float h = tall ? 2.6f : 1.2f;
                        // 夯土墙段：墙身略收分（上窄下宽用两层表达），顶面风蚀成不齐
                        var basePos = new Vector3(mid.x, LevelKit.GroundY(t, mid.x, mid.y), mid.y);
                        float yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;
                        // 正式资产 SM_Tripo_DesertHanWall（长轴沿 X，高 3.5 m）：不压扁高度，整段埋进沙里只露出 h——夯层贴图不变形，
                        // 半埋的残墙也正是戈壁汉长城的样子。长度方向拉到墙段长，厚度放到约 2 m
                        var wall = ShowcaseSceneBuilder.Place(HanWallId, root, basePos - Vector3.up * (HanWallSize.y - h), yaw + 90);
                        if (wall)
                        {
                            wall.name = $"Han Wall {seg:00}";
                            wall.transform.localScale = new Vector3((e - s) / HanWallSize.x, 1, 2f / HanWallSize.z);
                            wall.isStatic = true;
                        }
                        else LevelKit.Box($"Han Wall {seg:00}", root, basePos, new Vector3(2.4f, h, e - s), yaw, m.earth, 0.6f);
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
                var basePos = new Vector3(p.x, LevelKit.GroundY(t, p.x, p.y), p.y);
                var end = ShowcaseSceneBuilder.Place(HanWallEndId, root, basePos - Vector3.up * (HanWallEndSize.y - 2.7f), yaw);
                if (end)
                {
                    end.name = side < 0 ? "Han Wall Breach W" : "Han Wall Breach E";
                    end.transform.localScale = new Vector3(1, 1, 2f / HanWallEndSize.z);
                    end.isStatic = true;
                }
            }
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

        static void BuildGravelField(Terrain t, Transform props)
        {
            // ① 散布巨砾（2.6 m 高掩体），避开古道、长城、河床
            var rng = new System.Random(11);
            int placed = 0;
            for (int tries = 0; tries < 200 && placed < 9; tries++)
            {
                float ang = (float)rng.NextDouble() * Mathf.PI * 2, r = 6 + (float)rng.NextDouble() * 22;
                var p = Gravel + new Vector2(Mathf.Cos(ang), Mathf.Sin(ang)) * r;
                if (Polyline(p, Road).dist < 5 || Polyline(p, HanWall).dist < 4 || Polyline(p, River).dist < 6) continue;
                LevelKit.Prop("SM_Env_DesertSandstone", props, t, p.x, p.y, (float)rng.NextDouble() * 360, 1.6f + (float)rng.NextDouble() * 1.2f, 0.3f);
                placed++;
            }
        }

        static void BuildYardang(Terrain t, Transform props)
        {
            // ② 倒伏石柱 + 碎石（掩体），岩丘本身是地形
            LevelKit.Prop("SM_Tripo_DesertColumnRuin", props, t, 116, 96, 20);
            LevelKit.Prop("SM_Tripo_DesertColumnRuin", props, t, 128, 108, 140);
            var fallen = LevelKit.Prop("SM_Tripo_DesertColumn", props, t, 110, 100, 0);
            if (fallen)
            {
                fallen.transform.rotation = Quaternion.Euler(0, 55, 88);
                fallen.transform.position += Vector3.up * 0.6f;
            }
            var rng = new System.Random(5);
            foreach (var p in new[] { new Vector2(112, 88), new Vector2(130, 104), new Vector2(120, 114), new Vector2(98, 96) })
                LevelKit.Prop("SM_Env_DesertSandstone", props, t, p.x, p.y, (float)rng.NextDouble() * 360, 1.3f + (float)rng.NextDouble(), 0.3f);
        }

        static Vector3 BuildBeacon(Terrain t, Transform wb, Materials m)
        {
            // 烽燧：方形夯土墩台收分三段（6 → 4 m），共 14 m；顶上望楼 + 狼烟。台面边缘一圈 1 m 垛墙（有缺口），三堆积薪
            var root = new GameObject("Beacon").transform;
            root.SetParent(wb, false);
            float gy = LevelKit.GroundY(t, BeaconTower.x, BeaconTower.y);
            var b = new Vector3(BeaconTower.x, gy, BeaconTower.y);
            // 正式资产 SM_Tripo_DesertBeaconTower（14 m，望楼与柴笼在顶上）：正面朝西坡道来的方向
            var tower = ShowcaseSceneBuilder.Place("SM_Tripo_DesertBeaconTower", root, b - Vector3.up * 0.3f, BeaconYaw);
            if (tower) tower.isStatic = true;
            else
            {
                LevelKit.Box("Beacon Base", root, b, new Vector3(6, 5, 6), PlateauAngle, m.earth, 0.5f);
                LevelKit.Box("Beacon Mid", root, b + Vector3.up * 5, new Vector3(5, 5, 5), PlateauAngle, m.earthDark, 0.05f);
                LevelKit.Box("Beacon Top", root, b + Vector3.up * 10, new Vector3(4.2f, 3, 4.2f), PlateauAngle, m.earth, 0.05f);
            }

            float rad = PlateauAngle * Mathf.Deg2Rad;
            var ax = new Vector2(Mathf.Cos(rad), Mathf.Sin(rad));
            var az = new Vector2(-Mathf.Sin(rad), Mathf.Cos(rad));
            Vector2 L(float x, float z) => Beacon + ax * x + az * z;
            float hx = PlateauHalf.x - 0.8f, hz = PlateauHalf.y - 0.8f;
            var edges = new[] { (L(-hx, -hz), L(hx, -hz)), (L(hx, -hz), L(hx, hz)), (L(hx, hz), L(-hx, hz)), (L(-hx, hz), L(-hx, -hz)) };
            foreach (var (a, c) in edges)
            {
                float len = Vector2.Distance(a, c);
                var dir = (c - a) / len;
                for (float s = 1; s + 3 < len; s += 5.5f)
                {
                    var mid = a + dir * (s + 1.75f);
                    if (PlateauRamps.Any(r => Vector2.Distance(mid, r.top) < 6)) continue;
                    LevelKit.Box("Parapet", root, new Vector3(mid.x, LevelKit.GroundY(t, mid.x, mid.y), mid.y), new Vector3(0.7f, 1.0f, 3.5f),
                        Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg, m.earthDark, 0.3f);
                }
            }
            foreach (var p in new[] { L(-7, 4), L(-4, 6), L(-8, -3) })
            {
                var g = new Vector3(p.x, LevelKit.GroundY(t, p.x, p.y), p.y);
                LevelKit.Box("Brushwood Pile", root, g, new Vector3(2.2f, 1.3f, 2.2f), 35, m.reed, 0.2f);
            }
            // 狼烟从柴笼里冒出来（柴笼在烽燧顶上的一角）
            var smoke = tower ? tower.transform.TransformPoint(BeaconBasketLocal) : b + Vector3.up * 14.8f;
            LevelKit.Smoke(Dir, root, smoke, new Color(0.24f, 0.21f, 0.2f, 0.7f));
            return smoke + Vector3.up * 6;
        }

        static void BuildCamp(Terrain t, Transform wb, Transform props, Materials m)
        {
            // 驼队残骸：两套 SM_Tripo_DesertCaravanWreck（大车 + 货包 + 半埋驼骨），外加散落的货堆、陶罐、残帐
            var root = new GameObject("Caravan Wreck").transform;
            root.SetParent(wb, false);
            foreach (var (p, yaw, scale) in new[] { (new Vector2(214, 70), 30f, 1.4f), (new Vector2(228, 82), -65f, 1.25f) })
            {
                var wreck = LevelKit.Prop("SM_Tripo_DesertCaravanWreck", root, t, p.x, p.y, yaw, 0, 0.2f);
                if (wreck) wreck.transform.localScale = Vector3.one * scale;
            }
            LevelKit.Prop("SM_Tripo_DesertGoodsPile", props, t, 222, 66, 200);
            LevelKit.Prop("SM_Tripo_DesertGoodsPile", props, t, 208, 80, 70, 1.6f);
            LevelKit.Prop("SM_Prop_DesertUrns", props, t, 218, 78, 10);
            LevelKit.Prop("SM_Tripo_DesertMarketStall", props, t, 230, 70, -30);
            LevelKit.Prop("SM_Tripo_DesertBarricade", props, t, 212, 62, 100);
        }

        /// <summary>
        /// 遭遇战（docs/level-design/unity-maps-v1.md 1-1 的四个场地，按顺序解锁；遭遇框架 v2，docs/unity-parity.md L2）：
        ///   ① 黑戈壁砾石滩：跳鼠群 + 蝎尾弩卫远程压制（玩家从长城缺口进来就开打）
        ///   ② 雅丹石阵：蜃楼蟾在岩丘后吊射 + 跳鼠绕岩伏击
        ///   ③ 烽燧台地：镇墓兽冲锋上坡 + 邪飞天在台顶支援（先打琵琶）
        ///   ④ 驼队残骸营地：混编精英波——火浣鼠滚进来逼走位，精英蝎卫压制
        /// 编制、到场时间、锚点、奖励与 v1 相同：每个场地一波（<see cref="Spiritfire.Game.EncounterSpec"/>），条目写死到场延迟、不集结、不升格，
        /// slice11 冒烟照旧。出生锚点用 BuildMarkers 摆的 Enemy_N_* 标记，这里给它们挂 <see cref="Spiritfire.Game.SpawnAnchor"/>（<see cref="AnchorRoles"/>）：
        /// 运行时按角色挑站位（跳鼠站侧翼位、蝎卫站河岸远程位、飞天站台顶），不再随机挑锚点。
        /// 关卡目标 <see cref="Spiritfire.Game.LevelObjective"/>：四个场地必清，完成后出口传送门升起、落清关宝箱。
        /// 敌人 Prefab / 挂件运行时从 GameDatabase 取（L1 起场景里不再放敌人目录）。
        /// </summary>
        static Spiritfire.Game.LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            Spiritfire.Game.EncounterSite Site(int index, string marker, string title, float trigger, float arena,
                Spiritfire.Game.EncounterSite prev, Spiritfire.Game.EncounterSpec spec)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<Spiritfire.Game.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = markers.Find(marker).position;
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.requires = prev ? new[] { prev } : System.Array.Empty<Spiritfire.Game.EncounterSite>();
                var anchors = new List<Transform>();
                foreach (Transform m in markers)
                    if (m.name.StartsWith($"Enemy_{index}_"))
                    {
                        Anchor(m);
                        anchors.Add(m);
                    }
                site.anchors = anchors.ToArray();
                return site;
            }
            // 一个场地一波：条目的到场延迟写死（0 = 开战即到），首波不集结，出生点离玩家 10–28 m——出场时间与距离带同 v1 的 Squad 编制
            Spiritfire.Game.WaveEntry E(string enemy, int count, float delay = 0) => Spiritfire.Game.EncounterSpec.E(enemy, count, delay);
            Spiritfire.Game.EncounterSpec One(string label, params Spiritfire.Game.WaveEntry[] entries) =>
                Spiritfire.Game.EncounterSpec.Of(Spiritfire.Game.EncounterSpec.Wave(label, entries).After(0, 0)).Gather(0).Distance(10, 28);

            // 奖励节奏：① 雷弧发射器（雷，配燎的火技能出焚雷），② 灵兽封印（按品阶权重抽一只灵宠，docs/pet-system.md），
            //          ③ 青冥雷蛊（精良，蚀 + 雷：封脉 / 熔金 / 归墟），④ 秘卷
            var s1 = Site(1, "Site_1_GravelField", "黑戈壁砾石滩", 17, 28, null,
                One("黑戈壁砾石滩", E("jerboa_blade", 4), E("scorpion_archer", 2, 1.2f)));
            s1.reward = "weapon:beam";
            var s2 = Site(2, "Site_2_Yardang", "雅丹石阵", 18, 30, s1,
                One("雅丹石阵", E("mirage_toad", 2), E("jerboa_blade", 3, 0.6f), E("jerboa_blade", 3, 6f)));
            s2.reward = "pet"; // 旧场景没重建时由 PetBootstrap 在运行时把 ② 的 scroll 换成 pet
            var s3 = Site(3, "Site_3_BeaconPlateau", "烽燧台地", 20, 30, s2,
                One("烽燧台地", E("tomb_beast", 1), E("apsara", 1, 1.5f), E("jerboa_blade", 3, 4f), E("scorpion_archer", 1, 8f)));
            s3.reward = "weapon:stormpod:1";
            var s4 = Site(4, "Site_4_CaravanCamp", "驼队残骸营地", 18, 30, s3,
                One("驼队残骸营地", E("fire_rat", 3), E("jerboa_blade", 3, 1f), E("scorpion_archer", 1, 2f).Elite(),
                    E("mirage_toad", 1, 6f), E("fire_rat", 3, 9f), E("tomb_beast", 1, 12f).Elite()));
            s4.reward = "scroll";

            var objective = new GameObject("Level Objective").AddComponent<Spiritfire.Game.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿越古道";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 锚点标记的站位（标记名 → 角色、lane、高台）：跳鼠两处侧翼位分两条 lane，蝎卫站东岸远程位，蜃楼蟾站岩丘后的炮击位，
        /// 镇墓兽站西坡道脚的正面位（冲上坡），飞天站台顶（高台）；④ 的两个混编位不限角色。没列出的标记不限角色、lane 0、地面。
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
        };

        static void Anchor(Transform marker)
        {
            var a = marker.GetComponent<Spiritfire.Game.SpawnAnchor>();
            if (!a) a = marker.gameObject.AddComponent<Spiritfire.Game.SpawnAnchor>();
            if (AnchorRoles.TryGetValue(marker.name, out var r)) (a.role, a.lane, a.elevated) = r;
        }

        static void BuildMarkers(Terrain t, Transform root)
        {
            // 场地与刷怪标记（之后接战斗系统时读取）：名字 = 场地 / 角色，位置在地面
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
            Mk("Enemy_1_Jerboa_A", new Vector2(86, 64));
            Mk("Enemy_1_Jerboa_B", new Vector2(80, 44));
            Mk("Enemy_1_ScorpionArcher_EastBank", new Vector2(104, 60));
            Mk("Enemy_2_MirageToad_A", new Vector2(130, 112));
            Mk("Enemy_2_Jerboa_Flank", new Vector2(100, 116));
            Mk("Enemy_3_TombBeast_RampW", new Vector2(160, 132));
            Mk("Enemy_3_Apsara_Top", Beacon + new Vector2(4, -2));
            Mk("Enemy_4_EliteWave_A", Camp + new Vector2(5, -1)); // 离货摊 ≥ 3.5 m：精英镇墓兽半径约 1.9 m（L5 出生净空）
            Mk("Enemy_4_EliteWave_B", Camp + new Vector2(-8, 6));
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，docs/unity-parity.md L5）的声明：主线、古道坡度、6 条地标视线沿用白盒验收；
        /// 可玩区遮罩与 LevelKit.Boundary 同一个；场地尺寸取 unity-maps-v1.md 1-1 表。掩体 / 层数阈值只防退化，实测数字看报告。
        /// 锚点、宝箱落点、出口传送门、占位件、渲染器由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec(Terrain terrain, Vector3 smokeAt)
        {
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            return new LevelSpec
                {
                    id = "1-1", title = "古道穿越戈壁", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = p => Playable(p, Polyline(p, Road).dist),
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
                .Route("出生·驿站", G(Spawn)).Route("① 黑戈壁", G(Gravel)).Route("② 雅丹", G(Yardang)).Route("② 低丘顶", G(Mesas[0].c))
                .Route("② 雅丹", G(Yardang)).Route("③ 烽燧台顶", G(Beacon)).Route("④ 营地", G(Camp)).Route("出口", G(Exit))
                .Sight("出生点 → 烽燧狼烟", G(Spawn, 1.62f), smokeAt + Vector3.up * 8)
                .Sight("① 入口 → 雅丹高丘", G(new Vector2(58, 50), 1.62f), G(Mesas[2].c, Mesas[2].h - 0.5f), 8)
                .Sight("② 出口 → 烽燧", G(new Vector2(140, 118), 1.62f), smokeAt, 6)
                .Sight("③ 台顶 → ④ 营地", G(new Vector2(188, 136), 1.62f), G(Camp, 1.5f), 6)
                .Sight("③ 台顶 → 远景雅丹群", G(new Vector2(182, 150), 1.62f), G(Mesas[5].c, Mesas[5].h * 0.8f), 14, "SM_Tripo_DesertYardangFleet")
                .Sight("④ 入口 → 出口祭坛", G(new Vector2(212, 96), 1.62f), G(Exit, 2.5f), 6);
        }
    }
}
