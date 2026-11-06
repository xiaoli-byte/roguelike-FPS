using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-4 祝融炉心 · 火麒麟（docs/level-design/maps/3-4.md；第三章 v2 第 5.4 节；终章首领场）。
    /// 关卡坐标 = 世界 XZ（米），北 = +Z，炉心殿地面 y = 0；熔池圆心 = 世界原点。地形 160 × 320 m（2 × 4 块），火口壁顶 y ≈ 30–38。
    ///
    ///   第三章 v2：圆殿、护城渠、桥原样；前殿缩成补给营，往南加一段沿火口壁盘下的祝融神道和两处守关（见 Level_3_4.Shrine.cs）：
    ///   出生 · 火口南沿眺台（+24）→ 神道上段（路遇）→ ① 铜人神道（+14）→ 山门 → 神道下段 → ② 熔流闸口（+6）→ 补给营 · 铸神前殿（+1：祝融像、商店、安全区）
    ///   → 熔铁护城渠（东西横贯，熔岩面 y −0.6，渠床 −2.4）上唯一的一座桥（10 m 宽）；
    ///   → 南门（熔铁闸门门框 SM_Tripo_InfernoMoltenGateFrame；开战后熔铁闸从地下升起封死）→ 祝融炉心殿：
    ///     直径 48 m 的圆殿（外壳 = 八段 22 m 高的弧墙，南门是熔铁闸门门框、北神龛口是门阙；背后是 30 m 高的火山岩），殿心半径 7 m 的熔池（浅碟，熔岩面 y −0.1），
    ///     熔池上方吊着青铜巨鼎（<see cref="QilinCauldron"/>，鼎身中心离地 7.2 m），四条巨链从鼎角拉到东南西北四面外墙 12 m 高处的锁扣（<see cref="QilinLock"/>）；
    ///     四条 1.6 m 宽的放射状熔岩渠（西北 / 东北 / 东南 / 西南，与地面齐平的熔岩带）把地面切成四个象限，半径 10–14 m 处是没有熔岩的窄桥；
    ///     八根玄武岩柱在半径 13 m（每象限两根，唯一挡得住张鳞的东西）；半径 18–24 m 是外环跑道（不放任何东西）；
    ///     东北偏东 / 西北偏西各一段炉口墙（SM_Tripo_InfernoRoundHallFurnace：饮熔时炭童钻出），东南偏南 / 西南偏南两处高排烟口（二阶段神火飞鸦，BS5）；
    ///     北面一个神龛凹室（门阙下 11 m 宽的口），两侧各一座 2.6 m 的祭台（靠侧墙，从中间走道横着上坡，俯射层），神龛（SM_Tripo_InfernoPortalShrine）居中。
    ///
    /// 第三章正式件（66b52e57、门框 3c29e9fa，docs/art/ch3-kit.md）全部到位：圆殿弧墙 / 炉口墙段、门框 + 熔铁闸门、门阙、吊鼎（SM_Prop_QilinCauldron，四角 SOCKET_Chain* 拴链）、
    /// 锁扣（SM_Prop_QilinChainLock，FX_CoreGlow = 锁芯弱点）都是正式件，各自挂在 QilinCauldron / QilinLock 的 Model 子物体上；
    /// 巨链用已发布的链环 SM_Prop_InfernoChainLink（关卡里摆一个停用的模板，运行时按链长实例化）。占位件一律不合格（PlaceholderPolicy.Fail）。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、自举标记、补给营、首领场地（<see cref="BossArena"/> + <see cref="QilinFurnace"/>）、
    /// 吊鼎与四个锁扣、首领关流程（<see cref="BossEncounter"/>，首领 boss_qilin，熔铁闸是它的门；3-4 是最后一关，打完走胜利链）；
    /// 神道的两处必清场地（<see cref="EncounterSite"/> + <see cref="LevelObjective"/>）、路遇、熔岩洞藏宝，首领门槛（<see cref="FoundryLordGate"/>）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-4 祝融炉心（或 bridge.sh level 3-4）。
    /// </summary>
    [LevelBuilder("3-4", ScenePath)]
    public static partial class Level_3_4
    {
        public const string Dir = "Assets/Levels/L3_4_Zhurong";
        public const string ScenePath = "Assets/Scenes/L3_4_Zhurong.unity";
        const string Name = "L3_4";
        /// <summary>首领（QilinDef.Id 的字面量：构建器不依赖首领单元的文件）</summary>
        const string BossId = "boss_qilin";

        // ── 高度（世界 y）──
        const float Base = 8f, HeightRange = 56f, RockTop = 30f;
        static readonly Vector2 Origin = new(-80, -276), Size = new(160, 320);

        // ── 炉心殿 ──
        const float HallR = 24f, FloorR = 27.5f, PoolR = 7f, PoolBed = 1.0f, PoolLava = -0.1f, TrackR = 20.8f;
        const float PillarR = 13f, PillarSpread = 20f, PillarH = 6f;
        const float BridgeIn = 10f, BridgeOut = 14f, ChannelHalf = 0.8f;
        static readonly float[] ChannelYaws = { -135f, -45f, 45f, 135f };
        /// <summary>锁扣：离地高度、离圆心（锁身中心）；吊鼎鼎身中心离地</summary>
        const float LockHeight = 12f, LockR = 23.1f, HangHeight = 7.2f;
        /// <summary>
        /// 圆殿外壳：一圈十个 36° 的格，南（180°）北（0°）两格是门（南门框、北门阙），其余八格各一段弧墙（段心 ±36 / ±72 / ±108 / ±144°，±72° 是炉口墙段）。
        /// 弧墙段原点（底面、凹面正中往后）离圆心 <see cref="SegR"/>：实测网格（docs/art/ch3-kit.md）在 0.25–3.5 m 高度最靠里的是两端铁柱，离圆心 23.64 m，
        /// 外环跑道（到 23 m、探测胶囊半径 0.5）留 0.14 m；每段实际占 ±20°，相邻两段端头的铁柱叠成一根（接缝在 ±18 / ±54 / ±90 / ±126 / ±162°）
        /// </summary>
        static readonly float[] SegmentYaws = { 36f, 72f, 108f, 144f, -36f, -72f, -108f, -144f };
        const float SegR = 25.4f;
        /// <summary>炉口、排烟口方位（度，左右对称）；炉口召唤点离圆心 MouthR（炉口墙段的炉膛在 SegR + 1.6 m）</summary>
        const float FurnaceYaw = 72f, MouthR = 21.5f, VentYaw = 110f, VentR = 23.5f, VentY = 12f;
        /// <summary>
        /// 南门：熔铁闸门门框 SM_Tripo_InfernoMoltenGateFrame + 闸板 SM_Tripo_InfernoMoltenGate，同原点（门洞底面正中，z = <see cref="GateZ"/>）、同朝向（正面朝殿外）。
        /// 闸板 W × H = 10 × 10.6（和桥同宽；高到盖住门楣下缘）→ 闸板 X ×1.46、Y ×1.18；门框 X = W / 8.35 = 1.2、Y = H / 8.8 = 1.2（docs/art/ch3-kit.md 第 3.1 节末），
        /// 外廓 16.6 × 14.5，开闸后柱脚箍带处净宽 7.7 m（原门阙 6.6 m），门楣 10–13.3 m（南锁扣 10.8–13.2 m 挂在上面）。
        /// 门框柱脚往殿里凸到原点 + 1.66 m：原点放在 z −25.2，柱脚离圆心 ≥ 23.54 m，不压外环跑道
        /// </summary>
        static readonly Vector3 GatePlate = new(10f, 10.6f, 1.33f);
        static readonly Vector3 MoltenGateScale = new(10f / 6.83f, 10.6f / 9f, 1f), GateFrameScale = new(10f / 8.35f, 10.6f / 8.8f, 1f);
        /// <summary>
        /// 北神龛口：门阙 SM_Tripo_InfernoGateway 当门框（门洞实测 6.6 × 6.67、原点在门洞底面正中），X ×1.7、Y ×1.55 = 门洞 11.2 × 10.3
        /// （原来两扶壁之间 11.3 m 宽、门楣 10.5 m 高：祭台观台隔着它看殿心），外廓 19.2 × 16.7，正面朝殿心；北锁扣挂在 10.3–16.7 m 的门楣上
        /// </summary>
        static readonly Vector3 NorthGateScale = new(1.7f, 1.55f, 1f);
        const float ApseGateZ = 24.9f;

        // ── 神龛凹室（北）──
        static readonly Vector2 ApseC = new(0, 30), ApseHalf = new(10, 9);
        const float PlatH = 2.6f;
        static readonly Vector2 PlatC = new(8.3f, 32f), PlatHalf = new(1.7f, 4.5f);
        /// <summary>
        /// 祭台前端往里伸出的观台（同高）：祭台本身藏在北口扶壁背后，从祭台上望殿心被扶壁挡住；观台的内沿伸到北口里（x ±4.6），
        /// 站在观台上隔着北口看得到熔池、巨鼎和对面半个殿（俯射层名副其实）。观台在坡道（z 30–33）南边，不挡坡道
        /// </summary>
        static readonly Vector2 BalconyC = new(5.7f, 28f), BalconyHalf = new(1.1f, 1.4f);
        static readonly Vector2 RampFoot = new(0.3f, 31.5f), RampTop = new(6.9f, 31.5f);
        const float RampWidth = 3f;
        static readonly Vector2 ShrineAt = new(0, 37.6f);
        const float ShrineScale = 0.9f;

        // ── 门楼、桥、护城渠、护城渠南岸（南）──
        static readonly Vector2 GateC = new(0, -25.5f), GateHalf = new(5.5f, 3.5f);
        const float GateZ = -25.2f, BridgeHalfW = 5f, BridgeZ0 = -46.5f, BridgeZ1 = -27.5f;
        const float MoatZ0 = -45.5f, MoatZ1 = -28f, MoatBed = 2.4f, MoatLava = -0.6f;
        /// <summary>护城渠一带（原前殿的北段，x ±36、z −52…−28）：渠、桥、南岸一条 6 m 的岸；再往南是补给营（+1，见 Shrine）</summary>
        static readonly Vector2 ApronC = new(0, -40), ApronHalf = new(36, 12);

        // ── 标记 ──
        static readonly Vector2 ForecourtN = new(0, -52);
        static readonly Vector2 BossSpawn = new(0, 11.5f), PlayerEntry = new(0, -19.5f), RewardAt = new(0, -12), ExitAt = new(0, 35f);
        const float ArenaRadius = 23.5f;

        // ── 美术 ID ──
        const string GatewayId = "SM_Tripo_InfernoGateway",
            FurnaceId = "SM_Tripo_InfernoFurnaceTower", ColumnId = "SM_Tripo_InfernoColumn", ShrineId = "SM_Tripo_InfernoPortalShrine",
            StatueId = "SM_Tripo_InfernoZhurong", AltarId = "SM_Tripo_InfernoFireAltar", BarricadeId = "SM_Tripo_InfernoBarricade",
            StallId = "SM_Tripo_InfernoForgeStall", IngotId = "SM_Tripo_InfernoIngotPile", HoardId = "SM_Tripo_InfernoTreasureHoard",
            BasaltId = "SM_Env_InfernoBasalt", CrucibleId = "SM_Prop_InfernoCrucible", ChainLinkId = "SM_Prop_InfernoChainLink",
            // 吊鼎、锁扣（挂到 QilinCauldron / QilinLock 的 Model 上）；熔铁闸门；圆殿外壳（弧墙段 / 炉口墙段）
            CauldronId = "SM_Prop_QilinCauldron", LockId = "SM_Prop_QilinChainLock", MoltenGateId = "SM_Tripo_InfernoMoltenGate",
            RoundHallId = "SM_Tripo_InfernoRoundHallWall", RoundFurnaceId = "SM_Tripo_InfernoRoundHallFurnace", GateFrameId = "SM_Tripo_InfernoMoltenGateFrame";

        static readonly Vector3 RoundWallSize = new(17.03f, 22f, 5.47f), RoundFurnaceSize = new(17.16f, 22f, 4.85f), GatewaySize = new(11.31f, 10.75f, 2.2f),
            FurnaceSize = new(6.13f, 12.86f, 4.99f), ShrineSize = new(7.59f, 10.68f, 2.15f), MoltenGateSize = new(6.83f, 9f, 1.33f), GateFrameSize = new(13.89f, 12f, 3.32f), LockArtSize = new(1.29f, 2.4f, 0.59f);

        // ───────────── 地貌 ─────────────

        static float BoxSdf(Vector2 p, Vector2 c, Vector2 half)
        {
            float dx = Mathf.Abs(p.x - c.x) - half.x, dz = Mathf.Abs(p.y - c.y) - half.y;
            return new Vector2(Mathf.Max(dx, 0), Mathf.Max(dz, 0)).magnitude + Mathf.Min(Mathf.Max(dx, dz), 0);
        }

        /// <summary>圆殿一带（殿内、神龛、门楼、桥 + 护城渠 + 南岸）的有符号距离：里面为负</summary>
        static float HallOpen(Vector2 p)
        {
            // 殿墙那一圈（墙板 / 扶壁背面到 26.8 m）也是平地：墙立在地上，岩体从墙背后起
            float hall = p.magnitude - FloorR;
            float apse = BoxSdf(p, ApseC, ApseHalf);
            float gate = BoxSdf(p, GateC, GateHalf);
            float apron = BoxSdf(p, ApronC, ApronHalf - new Vector2(6, 6)) - 6f;
            return Mathf.Min(Mathf.Min(hall, apse), Mathf.Min(gate, apron));
        }

        /// <summary>开阔区（圆殿一带 + 神道：台、路、坡、火口坑）的有符号距离：里面为负，岩壁从 0 开始起</summary>
        static float Open(Vector2 p) => Mathf.Min(HallOpen(p), ShrineOpen(p));

        /// <summary>可玩区（防越界 / 俯视图 / 软边界）：开阔区（含火口坑）往岩壁里 2 m 以内算界内（岩壁 3–4 m 内陡升到 30 m 以上，爬不上去，没有空气墙）</summary>
        static float Playable(Vector2 p) => 1 - Smooth(0, 2f, Open(p));

        /// <summary>软边界：火狱主题</summary>
        static LevelKit.BoundarySpec Bounds
        {
            get
            {
                var b = LevelKit.BoundarySpec.Default;
                b.theme = "Inferno";
                return b;
            }
        }

        /// <summary>点在第几条熔岩渠上（池外到窄桥内沿、窄桥外沿到殿墙这两段；不在渠上返回 0）</summary>
        static float ChannelMask(Vector2 p)
        {
            float best = 0;
            foreach (float y in ChannelYaws)
            {
                float a = y * Mathf.Deg2Rad;
                var d = new Vector2(Mathf.Sin(a), Mathf.Cos(a));
                float along = Vector2.Dot(p, d), across = Mathf.Abs(p.x * d.y - p.y * d.x);
                bool inner = along > PoolR - 0.6f && along < BridgeIn - ChannelHalf;
                bool outer = along > BridgeOut + ChannelHalf && along < HallR + 1f;
                if (!inner && !outer) continue;
                best = Mathf.Max(best, 1 - Smooth(ChannelHalf - 0.15f, ChannelHalf + 0.25f, across));
            }
            return best;
        }

        /// <summary>两座祭台（含观台）的台面高度；shrink = 往岩壁里的距离（岩壁从贴着它的台面起坡时用）</summary>
        static float PlatRaise(Vector2 p, float shrink)
        {
            float best = 0;
            foreach (float sx in new[] { -1f, 1f })
            {
                float sdf = Mathf.Min(BoxSdf(p, new Vector2(PlatC.x * sx, PlatC.y), PlatHalf), BoxSdf(p, new Vector2(BalconyC.x * sx, BalconyC.y), BalconyHalf));
                best = Mathf.Max(best, PlatH * (1 - Smooth(0, 0.3f, sdf - shrink)));
            }
            return best;
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float dHall = HallOpen(p), dShrine = ShrineOpen(p);
            float d = Mathf.Min(dHall, dShrine);
            float r = p.magnitude;
            float h;
            if (d > 0)
            {
                // 岩壁：殿外 3 m、其余 4 m 内陡升，壁顶有起伏；从贴着岩壁的那片开阔区的顶面起坡（祭台、眺台、神道……），
                // 不从 0 起——否则台子和崖脚之间会夹出一道缝
                float w = Mathf.Lerp(4f, 3f, Smooth(-60f, -38f, p.y));
                float foot = Mathf.Max(PlatRaise(p, dHall) - 3f * (dHall - d), ShrineFoot(p, d));
                float top = Mathf.Max(RockTop + Fbm(p, 30, 3, 5) * 4f, foot + 10f);
                h = foot + (top - foot) * Mathf.Pow(Smooth(0, w, d), 0.7f);
                s.rock = Smooth(0.2f, 1.2f, d);
            }
            else if (dHall <= 0)
            {
                h = 0;
                bool south = p.y < MoatZ0;
                if (south) h += Fbm(p, 14, 3, 2) * 0.12f * Smooth(0, 3, -dHall);
                // 熔池：浅碟，熔岩面 −0.1，池心 −1.0
                float pool = 1 - Smooth(PoolR - 1.4f, PoolR, r);
                h -= PoolBed * pool;
                // 护城渠：东西横贯（桥除外），渠床 −2.4、南岸陡坎
                float moat = 0;
                if (p.y > MoatZ0 - 1f && p.y < MoatZ1 && BoxSdf(p, ApronC, ApronHalf) <= 0)
                {
                    moat = Smooth(MoatZ0, MoatZ0 + 0.7f, p.y);
                    float bridge = p.y > BridgeZ0 && p.y < BridgeZ1 ? 1 - Smooth(BridgeHalfW, BridgeHalfW + 0.6f, Mathf.Abs(p.x)) : 0;
                    moat *= 1 - bridge;
                    h -= MoatBed * moat;
                }
                // 神龛两侧的祭台（2.6 m，靠凹室侧墙，前端伸出观台）+ 从中间走道横着上去的坡道（21°）
                float raise = PlatRaise(p, 0);
                foreach (float sx in new[] { -1f, 1f })
                {
                    var (t, mask) = Ramp(p, new Vector2(RampFoot.x * sx, RampFoot.y), new Vector2(RampTop.x * sx, RampTop.y), RampWidth, 0.4f);
                    raise = Mathf.Max(raise, PlatH * t * mask);
                }
                // 只在祭台 / 坡道上抬高（Max 到 0 会把熔池、护城渠挖下去的坑全部填平）
                if (raise > 1e-3f) h = Mathf.Max(h, raise);
                // 补给营（+1）的缓坡伸到护城渠南岸：只在渠外抬
                if (moat < 1e-3f && p.y < MoatZ0)
                {
                    float camp = ShrineHeight(p, out _, out _);
                    if (camp > h) h = camp;
                }
                float channel = r < HallR + 1f ? ChannelMask(p) : 0;
                s.fluid = Mathf.Max(Mathf.Max(Smooth(0.5f, 1f, pool), moat), channel);
                s.shore = Mathf.Max(Smooth(PoolR + 1.2f, PoolR, r) * (1 - pool), 0);
                bool inHall = r < HallR + 0.5f || BoxSdf(p, ApseC, ApseHalf) < 0 || BoxSdf(p, GateC, GateHalf) < 0 || (p.y > BridgeZ0 && Mathf.Abs(p.x) < BridgeHalfW);
                s.packed = inHall ? 0.85f : 0.35f;
            }
            else
            {
                h = ShrineHeight(p, out float fluid, out float shore);
                s.fluid = fluid;
                s.shore = shore;
                s.packed = ShrinePacked(p);
            }
            s.h = h + Base;
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-4 祝融炉心", priority = 74)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh（人形 + 熔岩生物）→ 验收检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Inferno;
            ShowcaseSceneBuilder.ConfigureProject();
            System.IO.Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            // 火山口里：主光抬到 55°，殿内地面才照得到；暗部靠环境光与熔岩的辉光
            if (RenderSettings.sun) RenderSettings.sun.transform.rotation = Quaternion.Euler(55f, 30f, 0);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 257, splatRes = 256, tiles = new Vector2Int(2, 4), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            // 远景：火口壁顶之上露出的玄武岩脊和火山锥（同 3-3 的章节远景）
            LevelKit.Backdrop(LevelKit.BackdropFor(theme, Dir, Name, new Vector2(0, -100), -2f, 760, 7), env);
            // 软边界（没有空气墙）：火口壁本身翻不上去，等值线外热风推回 + 兜底环
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            LevelKit.Weather(env, theme, new Vector2(0.3f, 1f), 0.15f);

            var lava = BuildLava(env);
            var shrineLava = BuildShrineLava(env);
            var hall = BuildHall(set, props);
            BuildPillars(set, props);
            BuildApse(set, props);
            var gate = BuildGate(props);
            BuildBridgeAndForecourt(set, props);
            var shrine = BuildShrineProps(set, props);
            var furnace = BuildArena(set, markers, out var arena, out var exitPoint, out var rewardPoint);
            var cauldron = BuildCauldron(markers, furnace);
            var enc = BuildEncounter(markers, arena, gate, exitPoint, rewardPoint);
            var camp = BuildCamp(set, markers);
            var sites = BuildShrineSites(set, markers);
            sites.lordGate = BuildLordGate(enc, sites.objective);
            (sites.knock1, sites.knock2, sites.sluice) = BuildShrineMarkers(set, markers, sites.site2, sites.geysers);
            BuildShrineGuides(set, props);
            BuildPerches(set, markers, shrine);
            BuildLights(env, furnace);
            BuildShrineLights(set, env);

            // 玩家在 Core 场景（L1）：这里只放出生标记 + 自举标记；出生在火口南沿眺台，面朝北俯瞰整口火口和炉心殿
            var spawnAt = set.OnGround(SpawnAt.x, SpawnAt.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(Flat(new Vector3(0, 0, -60) - spawnAt));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            // 熔铁闸门开战才升起：烘导航时不能挡着门洞（BossEncounter.Start 也会把它收起）
            if (gate) gate.SetActive(false);
            LevelKit.BakeNavMesh(Dir, Name, env);
            // 火鼍网格按体积收集碰撞体（走物理场景）：这一帧刚摆好的地形块、殿墙还没同步进物理场景时收不到地面，烘出来是空的
            Physics.SyncTransforms();
            LevelKit.BakeLavaNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("3-4 祝融炉心 · 验收");
            CheckGeometry(rep, set, lava, hall, furnace, cauldron, gate, camp);
            CheckShrine(rep, set, shrineLava, shrine, sites, enc);
            CheckNavIslands(rep, set);
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线、节拍 + L5 规则集（占位只提醒：第三章 v2 新件到货前白盒）
            LevelKit.ValidateLava(rep);
            CheckSceneContents(rep, scene, sites);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_3-4_report.txt");

            if (review)
            {
                Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                var ding = new Vector3(0, HangHeight, 0);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_3-4", new[]
                    {
                        ("Aerial", new Vector3(95, 130, -250), new Vector3(0, 0, -110), false),
                        ("Map", new Vector3(0, 420, -100), new Vector3(0, 0, -99.9f), false),
                        ("Spawn", E(SpawnAt), new Vector3(0, 8, -60), true),
                        ("Camp", E(new Vector2(-8, -70)), G(CampAt, 1), false),
                        ("Statue", E(new Vector2(-2, -60)), G(StatueAt, 8f), false),
                        ("Bridge", E(new Vector2(0, -50)), new Vector3(0, 6, -25), false),
                        ("Entry", E(PlayerEntry), ding, true),
                        ("Track", E(new Vector2(-14, -14)), G(new Vector2(14, 14), 2), false),
                        ("Pillars", E(new Vector2(17, 4)), G(new Vector2(-12, 0), 2), false),
                        ("LockWest", E(new Vector2(17, -8.5f)), new Vector3(-LockR, LockHeight, 0), false),
                        ("Apse", E(new Vector2(0, 14)), G(ShrineAt, 5), false),
                        ("Overlook", E(BalconyC + new Vector2(-0.6f, -0.6f)), ding, false),
                        ("Roadside", E(new Vector2(13, -215)), G(new Vector2(27, -196), 3f), false),
                        ("Site1", E(new Vector2(6.5f, -186.5f)), G(new Vector2(1, -150), 3f), true),
                        ("Site1Terrace", E(new Vector2(-15, -147)), G(new Vector2(6, -172), 1f), false),
                        ("LowerRoad", E(LandingAt), G(new Vector2(-14, -104), 0f), false),
                        ("Site2", E(new Vector2(-23, -112.5f)), G(new Vector2(12, -100), 3f), true),
                        ("Sluice", E(new Vector2(17.5f, -116)), G(new Vector2(-14, -96), 0f), false),
                        ("Cave", E(new Vector2(-28, -118)), G(CacheAt, 1f), false),
                        ("CampFromRamp", E(new Vector2(-13, -79)), new Vector3(0, 3, -30), false),
                        ("CraterView", E(new Vector2(-9, -218.5f)), new Vector3(6, 2, -165), false),
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

        // ───────────── 熔岩 ─────────────

        sealed class LavaSet
        {
            public LavaVolume pool;
            public readonly List<LavaVolume> moat = new(), channels = new();
        }

        /// <summary>熔岩渠的熔岩面材质：渠只有 1.6 m 宽，共用熔岩材质的岸边硬壳（形状边缘往里 1.5 m）会把整条渠盖成黑壳，这里收窄到 0.3 m</summary>
        const string ChannelLavaMat = Dir + "/M_Lava_Channel.mat";
        const float ChannelShoreWidth = 0.3f;

        /// <summary>
        /// 熔池（浅碟里的圆）、八段熔岩渠（与地面齐平的熔岩带，流向殿墙）、护城渠（东西横贯，桥两侧各一片：桥高出熔岩面 0.6 m，不算熔岩，
        /// 熔岩体也不跨过桥——否则桥面在熔岩体的形状里、它的中心落在桥上）
        /// </summary>
        static LavaSet BuildLava(Transform env)
        {
            var root = new GameObject("Lava").transform;
            root.SetParent(env, false);
            var l = new LavaSet
            {
                pool = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Molten Pool", center = new Vector3(0, PoolLava, 0), shape = LavaShape.Disc, size = new Vector2(PoolR, PoolR), depth = PoolBed + 0.5f,
                }, root),
            };
            float moatOut = ApronHalf.x + 2f, moatW = moatOut - BridgeHalfW;
            foreach (float sx in new[] { -1f, 1f })
                l.moat.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = $"Molten Moat {(sx < 0 ? "W" : "E")}", center = new Vector3(sx * (BridgeHalfW + moatW * 0.5f), MoatLava, (MoatZ0 + MoatZ1) * 0.5f),
                    size = new Vector2(moatW, MoatZ1 - MoatZ0 + 1f), depth = MoatBed + 0.3f, flow = new Vector2(0.25f * sx, 0),
                }, root));
            int i = 0;
            foreach (float yaw in ChannelYaws)
            {
                foreach (var (r0, r1, tag) in new[] { (PoolR - 0.6f, BridgeIn - ChannelHalf, "Inner"), (BridgeOut + ChannelHalf, HallR + 1f, "Outer") })
                {
                    float a = yaw * Mathf.Deg2Rad, mid = (r0 + r1) * 0.5f;
                    l.channels.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                    {
                        name = $"Channel {i} {tag}", center = new Vector3(Mathf.Sin(a) * mid, 0, Mathf.Cos(a) * mid), size = new Vector2(ChannelHalf * 2, r1 - r0),
                        yaw = yaw, depth = 0.6f, depthShore = false, flow = new Vector2(0, 0.4f),
                    }, root));
                }
                i++;
            }
            var mat = ChannelMaterial();
            if (mat)
                foreach (var v in l.channels)
                    if (v && v.surface)
                        v.surface.sharedMaterial = mat;
            return l;
        }

        /// <summary>熔岩渠材质：共用熔岩材质的副本（每次构建同步一遍），只把岸边硬壳收窄</summary>
        static Material ChannelMaterial()
        {
            var src = LevelKit.LavaMaterial();
            if (!src) return null;
            var mat = AssetDatabase.LoadAssetAtPath<Material>(ChannelLavaMat);
            if (!mat)
            {
                mat = new Material(src) { name = "M_Lava_Channel" };
                AssetDatabase.CreateAsset(mat, ChannelLavaMat);
            }
            else
            {
                mat.shader = src.shader;
                mat.CopyPropertiesFromMaterial(src);
            }
            if (mat.HasProperty("_ShoreWidth")) mat.SetFloat("_ShoreWidth", ChannelShoreWidth);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        // ───────────── 圆殿 ─────────────

        sealed class HallSet
        {
            public readonly List<GameObject> walls = new(), furnaces = new();
            public GameObject gateway, apseGate;
        }

        static Vector3 Ring(float yawDeg, float r, float y = 0)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a) * r, y, Mathf.Cos(a) * r);
        }

        static bool Near(float a, float b, float tol = 1f) => Mathf.Abs(Mathf.DeltaAngle(a, b)) < tol;

        /// <summary>
        /// 圆殿外壳：八段弧墙（SM_Tripo_InfernoRoundHallWall ×6、±72° 两段换炉口墙段 SM_Tripo_InfernoRoundHallFurnace，凹面朝殿心）+ 南门框 + 北门阙。
        /// 南门框（正面朝殿外）和熔铁闸（<see cref="BuildGate"/>）同原点；北神龛口的门阙正面朝殿心。南北两个锁扣挂在门楣上，东西两个挂在弧墙接缝的铁柱上
        /// </summary>
        static HallSet BuildHall(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Round Hall").transform;
            root.SetParent(props, false);
            var h = new HallSet();
            foreach (float yaw in SegmentYaws)
            {
                bool kiln = Near(Mathf.Abs(yaw), FurnaceYaw);
                var go = LevelKit.PlaceOrBox(kiln ? RoundFurnaceId : RoundHallId, root, Ring(yaw, SegR), kiln ? RoundFurnaceSize : RoundWallSize, yaw + 180f);
                if (!go) continue;
                go.name = $"{go.name}（{(kiln ? "炉口" : "弧墙")} {yaw:F0}°）";
                (kiln ? h.furnaces : h.walls).Add(go);
            }
            h.gateway = PlaceScaled(GateFrameId, root, new Vector3(0, 0, GateZ), GateFrameSize, 180f, GateFrameScale);
            h.apseGate = PlaceScaled(GatewayId, root, new Vector3(0, 0, ApseGateZ), GatewaySize, 180f, NorthGateScale);
            if (h.apseGate) h.apseGate.name = $"{h.apseGate.name}（北神龛口）";
            return h;
        }

        /// <summary>摆一件正式件并按 scale 非等比缩放（门框 / 门阙、闸板按门洞）；没有 Prefab 时白盒按缩放后的尺寸</summary>
        static GameObject PlaceScaled(string id, Transform parent, Vector3 baseCenter, Vector3 size, float yaw, Vector3 scale)
        {
            var go = LevelKit.PlaceOrBox(id, parent, baseCenter, Vector3.Scale(size, scale), yaw);
            if (go && !go.CompareTag(LevelKit.PlaceholderTag)) go.transform.localScale = scale;
            return go;
        }

        /// <summary>八根玄武岩柱（半径 13 m，每象限中线左右各 20°，直径约 2.4 m、高 6 m）：张鳞时唯一挡得住鳞刃的东西</summary>
        static void BuildPillars(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Basalt Pillars").transform;
            root.SetParent(props, false);
            float scale = PillarH / Mathf.Max(0.5f, ShowcaseSceneBuilder.DesignBounds(ColumnId).size.y);
            int i = 0;
            foreach (float q in new[] { 0f, 90f, 180f, -90f })
            foreach (float s in new[] { -1f, 1f })
            {
                var at = Ring(q + s * PillarSpread, PillarR);
                var go = LevelKit.PlaceOrBox(ColumnId, root, set.OnGround(at.x, at.z, -0.15f), new Vector3(2.4f, PillarH, 2.4f), i * 47f, scale);
                if (go) go.name = $"Pillar {++i} ({go.name})";
            }
        }

        /// <summary>北神龛凹室：神龛居中（正面朝南），两座祭台的边上各一座火坛</summary>
        static void BuildApse(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Shrine Apse").transform;
            root.SetParent(props, false);
            LevelKit.PlaceOrBox(ShrineId, root, set.OnGround(ShrineAt.x, ShrineAt.y, -0.1f), ShrineSize * ShrineScale, 180f, ShrineScale);
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(AltarId, root, set.OnGround(PlatC.x * sx, PlatC.y - 3.6f, -0.05f), new Vector3(1.13f, 2.36f, 1.15f), 180f);
        }

        /// <summary>熔铁闸门（BossEncounter 的门：开战从地下升起封死南门，结算后沉回地下）：闸板 10 × 10.6，和门框同原点、同朝向</summary>
        static GameObject BuildGate(Transform props)
        {
            var gate = PlaceScaled(MoltenGateId, props, new Vector3(0, 0, GateZ), MoltenGateSize, 180f, MoltenGateScale);
            if (gate) gate.isStatic = false;
            return gate;
        }

        /// <summary>护城渠桥两侧的矮栏（拒马件）、桥头两座火坛（祝融像、锻摊、货堆挪到补给营：见 Shrine）</summary>
        static void BuildBridgeAndForecourt(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Forecourt").transform;
            root.SetParent(props, false);
            for (float z = BridgeZ0 + 2.2f; z < BridgeZ1 - 1.5f; z += 3.7f)
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(BarricadeId, root, set.OnGround(sx * (BridgeHalfW - 0.4f), z, -0.05f), new Vector3(3.56f, 1.18f, 0.47f), 90f);
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(AltarId, root, set.OnGround(sx * 8.5f, BridgeZ0 - 3.5f, -0.05f), new Vector3(1.13f, 2.36f, 1.15f), 0f);
        }

        // ───────────── 标记 ─────────────

        static Transform Point(Transform parent, string name, Vector3 pos, Vector3 facing)
        {
            var p = new GameObject(name).transform;
            p.SetParent(parent, false);
            p.position = pos;
            facing.y = 0;
            if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(facing);
            return p;
        }

        /// <summary>
        /// 首领场地（<see cref="BossArena"/>，只给 boss_qilin）：圆心 = 熔池圆心、半径 23.5 m；同一物体上挂炉心殿几何（<see cref="QilinFurnace"/>）。
        /// 出生点在熔池北沿（池外 4.5 m，面朝南：麒麟从池心跃出落在这里）；玩家入场点在门楼里侧；召唤点 = 两座炉口前（炭童）；
        /// 掩体点 = 八根柱子背后；栖落点 = 神龛两座祭台、两处高排烟口；边缘点 = 外环跑道一圈 8 个。另给出口点（神龛前）与宝箱落点（熔池南侧）
        /// </summary>
        static QilinFurnace BuildArena(LevelKit.TerrainSet set, Transform markers, out BossArena arena, out Transform exitPoint, out Transform rewardPoint)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var root = new GameObject("BossArena").transform;
            root.SetParent(markers, false);
            root.position = Vector3.zero;
            arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Circle;
            arena.radius = ArenaRadius;
            arena.bossSpawn = Point(root, "BossSpawn", G(BossSpawn), Vector3.back);
            arena.playerEntry = Point(root, "PlayerEntry", G(PlayerEntry), Vector3.forward);
            var mouths = new List<Transform>();
            foreach (float s in new[] { -1f, 1f })
            {
                var m = Ring(s * FurnaceYaw, MouthR);
                mouths.Add(Point(root, $"Summon_Mouth{(s < 0 ? "W" : "E")}", G(new Vector2(m.x, m.z)), -m));
            }
            arena.summonPoints = mouths.ToArray();
            var covers = new List<Transform>();
            int ci = 0;
            foreach (float q in new[] { 0f, 90f, 180f, -90f })
            foreach (float s in new[] { -1f, 1f })
            {
                var c = Ring(q + s * PillarSpread, PillarR + 2.2f);
                covers.Add(Point(root, $"Cover_Pillar{++ci}", G(new Vector2(c.x, c.z)), c));
            }
            arena.coverPoints = covers.ToArray();
            var vents = new List<Transform>();
            foreach (float s in new[] { -1f, 1f })
            {
                var v = Ring(s * VentYaw, VentR, VentY);
                vents.Add(Point(root, $"Perch_Vent{(s < 0 ? "W" : "E")}", v, -v));
            }
            arena.perchPoints = new[]
            {
                // 栖落点在两座祭台伸进北口的观台上（隔着北口看得到殿心）
                Point(root, "Perch_AltarW", G(new Vector2(-BalconyC.x, BalconyC.y)), Vector3.back), Point(root, "Perch_AltarE", G(BalconyC), Vector3.back), vents[0], vents[1],
            };
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                var e = Ring(i * 45f + 22.5f, TrackR);
                return Point(root, $"Edge_{i + 1}", G(new Vector2(e.x, e.z)), -e);
            }).ToArray();
            var furnace = root.gameObject.AddComponent<QilinFurnace>();
            furnace.poolRadius = PoolR;
            furnace.wallRadius = HallR;
            furnace.trackRadius = TrackR;
            furnace.bridgeInner = BridgeIn;
            furnace.bridgeOuter = BridgeOut;
            furnace.channelHalfWidth = ChannelHalf;
            furnace.channelYaws = ChannelYaws.ToArray();
            furnace.mouths = mouths.ToArray();
            furnace.vents = vents.ToArray();
            exitPoint = Point(markers, "Boss Exit", G(ExitAt), Vector3.back);
            rewardPoint = Point(markers, "Boss Reward", G(RewardAt), Vector3.back);
            return furnace;
        }

        /// <summary>
        /// 吊鼎 + 四个锁扣：鼎在熔池圆心（挂 7.2 m），正式件 SM_Prop_QilinCauldron 作为 Model 子物体摆在吊着的姿势上（足底 = 鼎身中心往下 <see cref="QilinCauldron.ModelDrop"/>，
        /// 朝向 <see cref="QilinCauldron.RestRotation"/>），巨链运行时拴在它的 SOCKET_Chain* 上；锁扣在四个象限中线上、离圆心 23.1 m、离地 12 m，正面朝殿心，
        /// 正式件 SM_Prop_QilinChainLock 作为 Model 子物体背面贴墙（往外打五条射线找墙面：南是门框门楣、北是门阙门楣，东西是弧墙接缝的铁柱）。
        /// 两件都会动（吊鼎摆、坠；锁扣碎了往下掉）：清掉静态标记、删掉自带的网格碰撞体（不进导航；锁扣只认 Character 层的锁身 / 锁芯）。
        /// 链环模板（SM_Prop_InfernoChainLink）停用摆在鼎下，运行时按链长实例化。没有 Prefab 时退回运行时程序几何 + 占位标记（占位清单里不合格）
        /// </summary>
        static QilinCauldron BuildCauldron(Transform markers, QilinFurnace furnace)
        {
            LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var go = new GameObject("Qilin Cauldron");
            go.transform.SetParent(markers, false);
            go.transform.position = furnace.Center;
            var c = go.AddComponent<QilinCauldron>();
            c.hangHeight = HangHeight;
            c.furnace = furnace;
            c.linkScale = 1.5f;
            var ding = MovableModel(CauldronId, go.transform);
            if (ding)
                ding.transform.SetPositionAndRotation(furnace.Center + Vector3.up * (HangHeight - QilinCauldron.ModelDrop), QilinCauldron.RestRotation(furnace));
            else Marker(go.transform, $"Placeholder · {CauldronId}（运行时程序方鼎）", Vector3.up * HangHeight);
            if (ShowcaseSceneBuilder.Prefab(ChainLinkId))
            {
                var link = ShowcaseSceneBuilder.Place(ChainLinkId, go.transform, new Vector3(0, -3, 0));
                if (link)
                {
                    link.name = "Chain Link Template";
                    foreach (var t in link.GetComponentsInChildren<Transform>(true)) GameObjectUtility.SetStaticEditorFlags(t.gameObject, 0);
                    link.SetActive(false);
                    c.linkTemplate = link;
                }
            }
            Physics.SyncTransforms();
            var locks = new QilinLock[furnace.QuadrantCount];
            for (int i = 0; i < locks.Length; i++)
            {
                float yaw = furnace.QuadrantYaw(i);
                var at = Ring(yaw, LockR, LockHeight);
                var lgo = new GameObject($"Qilin Lock {i} ({Compass(yaw)})");
                lgo.transform.SetParent(markers, false);
                lgo.transform.SetPositionAndRotation(at, Quaternion.LookRotation(Flat(-at)));
                var l = lgo.AddComponent<QilinLock>();
                l.index = i;
                var art = MovableModel(LockId, lgo.transform);
                if (art)
                {
                    // 锁身中心 = 件的半高处；件的背面（局部 z −0.296）贴到墙面上
                    float back = WallBehind(lgo.transform);
                    art.transform.localPosition = new Vector3(0, -LockArtSize.y * 0.5f, LockArtSize.z * 0.5f - back);
                    art.transform.localRotation = Quaternion.identity;
                }
                else Marker(lgo.transform, $"Placeholder · {LockId}（运行时程序锁扣）", Vector3.zero);
                locks[i] = l;
            }
            c.locks = locks;
            return c;
        }

        /// <summary>摆一件会动的正式件，名字叫 Model（QilinCauldron / QilinLock 认这个名字）：清静态标记（静态合批会把它钉死），删掉自带的碰撞体</summary>
        static GameObject MovableModel(string id, Transform parent)
        {
            if (!ShowcaseSceneBuilder.Prefab(id)) return null;
            var go = ShowcaseSceneBuilder.Place(id, parent, Vector3.zero);
            if (!go) return null;
            go.name = "Model";
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) GameObjectUtility.SetStaticEditorFlags(t.gameObject, 0);
            foreach (var col in go.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(col);
            return go;
        }

        /// <summary>
        /// 锁扣背后的墙面离锁身中心多远（米）：从锁身中心和四个角（件的 ±0.55 × ±1.1）往殿外打射线（3 m 内），取最近的一条——件贴着最靠前的墙面，哪儿都不嵌进墙里。
        /// 一条都没打到返回 −1（验收里不合格：锁扣悬在半空）
        /// </summary>
        static float WallBehind(Transform lockT)
        {
            float best = float.PositiveInfinity;
            foreach (var (x, y) in new[] { (0f, 0f), (-0.55f, -1.1f), (0.55f, -1.1f), (-0.55f, 1.1f), (0.55f, 1.1f) })
            {
                var from = lockT.TransformPoint(new Vector3(x, y, 0));
                if (Physics.Raycast(from, -lockT.forward, out var hit, 3f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && !(hit.collider is TerrainCollider))
                    best = Mathf.Min(best, hit.distance);
            }
            return float.IsInfinity(best) ? -1f : best;
        }

        static void Marker(Transform parent, string name, Vector3 local)
        {
            var m = new GameObject(name);
            m.transform.SetParent(parent, false);
            m.transform.localPosition = local;
            m.tag = LevelKit.PlaceholderTag;
        }

        static string Compass(float yaw) => (Mathf.RoundToInt(Mathf.Repeat(yaw, 360f) / 90f) % 4) switch { 0 => "N", 1 => "E", 2 => "S", _ => "W" };

        /// <summary>首领关流程：走过门楼进殿 → 熔铁闸升起封门 → 登场预警 2.5 s → 火麒麟从熔池跃出；拴绳 6 m；倒下 → 溃散 → 结算 → 最后一关：胜利链</summary>
        static BossEncounter BuildEncounter(Transform markers, BossArena arena, GameObject gate, Transform exitPoint, Transform rewardPoint)
        {
            var go = new GameObject("Boss Encounter · 火麒麟");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2.5f;
            enc.gates = gate ? new[] { gate } : System.Array.Empty<GameObject>();
            enc.gateRise = 0.9f;
            enc.warnSeconds = 2.5f;
            enc.warnText = "熔池翻涌、熔铁闸落——火麒麟自炉心跃出！";
            enc.tetherSlack = 6f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
            return enc;
        }

        /// <summary>铸神前殿补给营（B2 / R3）：补给营台地中线偏东，正面朝西（玩家从 ② 的坡道由西南下来），商店弧排在中心东边 6.4 m；安全区半径 10 m（主线从里面穿过，到桥头）</summary>
        static SupplyCamp BuildCamp(LevelKit.TerrainSet set, Transform markers)
        {
            var go = new GameObject("SupplyCamp");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(set.OnGround(CampAt.x, CampAt.y), Quaternion.Euler(0, -90f, 0));
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 10f;
            zone.height = 6f;
            var camp = go.AddComponent<SupplyCamp>();
            camp.label = "铸神前殿 · 补给营";
            camp.safeRadius = 10f;
            camp.openShop = true;
            camp.restoreOnArrive = false;
            return camp;
        }

        /// <summary>熔池上一盏橙色点光（照亮鼎底和柱脚）、两座炉口各一盏；都不投影</summary>
        static void BuildLights(Transform env, QilinFurnace furnace)
        {
            void Add(string name, Vector3 at, float range, float intensity)
            {
                var l = new GameObject(name).AddComponent<Light>();
                l.transform.SetParent(env, false);
                l.transform.position = at;
                l.type = LightType.Point;
                l.color = LevelKit.InfernoPalette.FireLight;
                l.range = range;
                l.intensity = intensity;
                l.shadows = LightShadows.None;
            }
            Add("Pool Glow", furnace.Center + Vector3.up * 2f, 22f, 4f);
            foreach (var m in furnace.mouths)
                if (m)
                    Add($"Furnace Glow {m.name}", m.position + Vector3.up * 2f, 10f, 3f);
        }

        // ───────────── 验收 ─────────────

        /// <summary>
        /// 白盒自查：关键高度（殿内 0、池心 −1、渠床 −2.4、桥面 0、祭台 2.8、前殿 0）；熔岩渠与地面齐平、窄桥上没有熔岩；
        /// 外环跑道（半径 18.5 / 20.8 / 23）与熔池边（7.5–9.5）没有任何碰撞体；八根柱子在半径 13；
        /// 锁扣可见：殿内一圈采样点（半径 10 / 16 / 21，每 30°）各自至少看得到两个锁扣；八段弧墙（两段炉口）、南门框、北门阙、熔铁闸门；
        /// 吊鼎 / 锁扣是正式件：鼎上四个 SOCKET_Chain*、每个锁扣上有 FX_CoreGlow 且背面贴墙（离墙 ≤ 0.1 m）
        /// </summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, LavaSet lava, HallSet hall, QilinFurnace furnace, QilinCauldron cauldron, GameObject gate, SupplyCamp camp)
        {
            rep.Section("地形与熔岩");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("殿内地面（东象限）", Y(new Vector2(16, 0)), 0, 0.3f);
            var trackSW = Ring(-160f, 20f);
            Near("外环跑道（西南偏南）", Y(new Vector2(trackSW.x, trackSW.z)), 0, 0.3f);
            Near("熔池心", Y(Vector2.zero), -PoolBed, 0.3f);
            Near("护城渠床", Y(new Vector2(-18, -37)), -MoatBed, 0.4f);
            Near("护城渠桥面", Y(new Vector2(0, -37)), 0, 0.3f);
            Near("门楼门洞", Y(new Vector2(0, GateZ)), 0, 0.3f);
            Near("神龛西祭台", Y(new Vector2(-PlatC.x, PlatC.y)), PlatH, 0.35f);
            Near("护城渠南岸（桥头）", Y(ForecourtN + new Vector2(0, 3)), 0, 0.5f);
            float rockE = Y(new Vector2(30, 0)), rockS = Y(new Vector2(-44, -40));
            if (rockE < 15f || rockS < 15f) rep.Fail($"岩壁不够高：殿外（30, 0）y = {rockE:F1}，护城渠西头外（−44, −40）y = {rockS:F1}（应 ≥ 15，地形本身是边界）");
            else rep.Line($"✓ 岩壁：殿外 y = {rockE:F1}，护城渠西头外 y = {rockS:F1}");
            rep.Line($"熔岩：熔池 r {PoolR}（熔岩面 {PoolLava}）、护城渠桥两侧 {lava.moat.Count} 片 {(lava.moat.Count > 0 && lava.moat[0] ? $"{lava.moat[0].size.x:F0} × {lava.moat[0].size.y:F1}" : "?")} m（熔岩面 {MoatLava}）、" +
                     $"熔岩渠 {lava.channels.Count} 段（宽 {ChannelHalf * 2} m，齐地，岸壳 {ChannelShoreWidth} m）");
            if (lava.moat.Count != 2) rep.Fail($"护城渠应为桥两侧 2 片熔岩，现在 {lava.moat.Count}");
            foreach (var m in lava.moat)
                if (m && m.Body.Contains(0, (MoatZ0 + MoatZ1) * 0.5f))
                    rep.Fail($"{m.name} 盖到了桥面上");
            if (lava.channels.Count != 8) rep.Fail($"熔岩渠应为 8 段（4 条 × 内外两段），现在 {lava.channels.Count}");
            // 窄桥（半径 12 m）上没有熔岩、渠上有
            int bridgeLava = 0, channelDry = 0;
            foreach (float yaw in ChannelYaws)
            {
                var b = Ring(yaw, (BridgeIn + BridgeOut) * 0.5f);
                foreach (var v in lava.channels)
                    if (v && v.Body.Contains(b.x, b.z))
                        bridgeLava++;
                var o = Ring(yaw, 19f);
                if (!lava.channels.Any(v => v && v.Body.Contains(o.x, o.z))) channelDry++;
            }
            if (bridgeLava > 0) rep.Fail($"{bridgeLava} 座窄桥（半径 12 m）上有熔岩");
            if (channelDry > 0) rep.Fail($"{channelDry} 条熔岩渠的外段（半径 19 m）没有熔岩");
            if (bridgeLava == 0 && channelDry == 0) rep.Line("✓ 四条熔岩渠：池边到半径 9.2 m、14.8 m 到殿墙是熔岩，半径 10–14 m 的窄桥没有");

            rep.Section("圆殿 / 跑道 / 锁扣");
            rep.Line($"圆殿外壳：弧墙 {hall.walls.Count} 段、炉口墙段 {hall.furnaces.Count} 段（原点离圆心 {SegR} m，每段 36°），" +
                     $"南门框 {(hall.gateway ? hall.gateway.name : "（没有）")}、北神龛口门阙 {(hall.apseGate ? hall.apseGate.name : "（没有）")}");
            if (hall.walls.Count + hall.furnaces.Count != 8) rep.Fail($"圆殿外壳应为八段弧墙，现在 {hall.walls.Count + hall.furnaces.Count}");
            if (hall.furnaces.Count != 2) rep.Fail($"炉口墙段应为 2 段，现在 {hall.furnaces.Count}");
            if (!hall.gateway || !hall.apseGate) rep.Fail("南门框 / 北神龛口门阙没有摆出来");
            // 外环跑道与熔池边：竖直胶囊探一圈，打到任何碰撞体（地形以外）都不合格
            var blocked = new List<string>();
            foreach (var (r, radius) in new[] { (18.5f, 0.5f), (TrackR, 1.2f), (23f, 0.5f), (7.6f, 0.5f), (8.6f, 0.5f), (9.5f, 0.5f) })
                for (float yaw = 0; yaw < 360f; yaw += 4f)
                {
                    var p = Ring(yaw, r);
                    p.y = Y(new Vector2(p.x, p.z));
                    var hits = Physics.OverlapCapsule(p + Vector3.up * (radius + 0.25f), p + Vector3.up * 3f, radius, Layers.WorldMask, QueryTriggerInteraction.Ignore);
                    foreach (var h in hits)
                        if (h && !(h is TerrainCollider))
                        {
                            blocked.Add($"r {r:F1} @ {yaw:F0}°：{h.name}");
                            break;
                        }
                }
            if (blocked.Count > 0) rep.Fail($"外环跑道 / 熔池边有 {blocked.Count} 处被挡：{string.Join("；", blocked.Take(8))}");
            else rep.Line("✓ 外环跑道（半径 18.5–23 m）与熔池边（7.6–9.5 m）一圈没有任何碰撞体");
            // 锁扣可见：殿内采样点（眼高）到每个锁扣，世界层射线不被挡（柱子会挡一些）
            var locks = cauldron ? cauldron.locks : System.Array.Empty<QilinLock>();
            int worst = int.MaxValue;
            string worstAt = null;
            int samples = 0;
            foreach (float r in new[] { 10f, 16f, 21f })
                for (float yaw = 0; yaw < 360f; yaw += 30f)
                {
                    var p = Ring(yaw + 15f, r);
                    var eye = new Vector3(p.x, Y(new Vector2(p.x, p.z)) + 1.62f, p.z);
                    int seen = 0;
                    foreach (var l in locks)
                    {
                        if (!l) continue;
                        var to = l.transform.position - eye;
                        if (!Physics.Raycast(eye, to.normalized, to.magnitude - 1.0f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) seen++;
                    }
                    samples++;
                    if (seen >= worst) continue;
                    worst = seen;
                    worstAt = $"r {r:F0} @ {yaw + 15f:F0}°";
                }
            if (locks.Length != 4 || locks.Any(l => !l)) rep.Fail($"锁扣应为 4 个，现在 {locks.Count(l => l)}");
            if (worst < 2) rep.Fail($"有采样点只看得到 {worst} 个锁扣（{worstAt}）：环台任何位置都应至少看得到两个");
            else rep.Line($"✓ 锁扣（离地 {LockHeight} m）：殿内 {samples} 个采样点每处至少看得到 {worst} 个");
            if (!cauldron) rep.Fail("没有吊鼎");
            else
            {
                rep.Line($"吊鼎：鼎身中心离地 {cauldron.hangHeight} m，链环模板 {(cauldron.linkTemplate ? cauldron.linkTemplate.name : "（没有：运行时程序链环）")}，锁扣 {string.Join(" / ", locks.Where(l => l).Select(l => l.name))}");
                var ding = cauldron.transform.Find("Model");
                int sockets = ding ? ding.GetComponentsInChildren<Transform>(true).Count(t => t.name.StartsWith(QilinCauldron.ChainSocketPrefix)) : 0;
                if (!ding) rep.Fail("吊鼎没有正式件 Model（运行时会退回程序方鼎）");
                else if (sockets != 4) rep.Fail($"吊鼎正式件上的巨链挂点 {QilinCauldron.ChainSocketPrefix}* 有 {sockets} 个（应为 4）");
                else if (ding.GetComponentsInChildren<Collider>(true).Length > 0) rep.Fail("吊鼎正式件还带着碰撞体（会烘进导航、挡子弹）");
                else rep.Line($"✓ 吊鼎正式件 {CauldronId}：足底离地 {ding.position.y - cauldron.transform.position.y:F1} m，四角 {sockets} 个巨链挂点");
            }
            var lockArt = new List<string>();
            foreach (var l in locks)
            {
                if (!l) continue;
                var art = l.transform.Find("Model");
                if (!art)
                {
                    rep.Fail($"{l.name} 没有正式件 Model（运行时会退回程序锁扣）");
                    continue;
                }
                if (!art.GetComponentsInChildren<Transform>(true).Any(t => t.name == QilinLock.CoreGlowPoint)) rep.Fail($"{l.name} 的正式件上没有 {QilinLock.CoreGlowPoint}（锁芯弱点没处放）");
                if (art.GetComponentsInChildren<Collider>(true).Length > 0) rep.Fail($"{l.name} 的正式件还带着碰撞体（子弹会被它截住，打不到锁身 / 锁芯）");
                // 件背面到墙：背面在锁扣局部 z = 件原点 z − 半厚
                float back = -(art.localPosition.z - LockArtSize.z * 0.5f);
                float wall = WallBehind(l.transform);
                if (wall < 0) rep.Fail($"{l.name} 背后 3 m 内没有墙（悬在半空）");
                else if (Mathf.Abs(wall - back) > 0.1f) rep.Fail($"{l.name} 的件背面离墙 {wall - back:F2} m（应贴墙）");
                lockArt.Add($"{l.name} 离墙 {wall:F2} m");
            }
            if (lockArt.Count == 4) rep.Line($"✓ 锁扣正式件 {LockId} 背面贴墙：{string.Join("、", lockArt)}");
            if (!gate) rep.Fail("没有熔铁闸门");
            else rep.Line($"{(gate.CompareTag(LevelKit.PlaceholderTag) ? "⚠ 白盒" : "✓ 正式件")} 熔铁闸门 {gate.name}（BossEncounter 的门，开战升起）");
            if (!camp) rep.Fail("没有补给营");
            else rep.Line($"✓ 补给营「{camp.label}」安全区 {camp.safeRadius} m");
            if (!furnace) rep.Fail("没有炉心殿几何（QilinFurnace）");
            else rep.Line($"✓ 炉心殿：熔池 {furnace.poolRadius} m、殿墙 {furnace.wallRadius} m、跑道 {furnace.trackRadius} m、窄桥 {furnace.bridgeInner}–{furnace.bridgeOuter} m，" +
                          $"象限中线 {string.Join(" / ", Enumerable.Range(0, furnace.QuadrantCount).Select(i => $"{furnace.QuadrantYaw(i):F0}°"))}，炉口 {furnace.mouths.Length}、排烟口 {furnace.vents.Length}");
        }

        /// <summary>
        /// 导航孤岛（同 3-2 的 CheckSteps；第三章 v2 S1：出场站位要走得到玩家，玩家站在导航孤岛上时待出场的单位会卡 6 s 才放宽）：
        /// 人形网格（<see cref="LevelContext.Walker"/>）按顶点焊接分块，和出生点不连通的每一块里取一点，看玩家上不上得去（可达性洪泛：附近 1.5 m、高差 0.8 m 内的可站立面档位）——
        /// 步行 / 单跳 / 冲刺上得去的孤岛不合格（要么修坡连通，要么那块顶面不进导航）；只有二段跳上得去的提醒；玩家上不去的（墙顶、柱顶、岩壁上的碎块）只列数
        /// </summary>
        static void CheckNavIslands(LevelKit.Report rep, LevelKit.TerrainSet set)
        {
            rep.Section("导航孤岛（台顶 / 台阶：要么连通，要么不进导航）");
            var ctx = new LevelContext(Spec(set));
            if (ctx.SpawnNav is not Vector3 start)
            {
                rep.Fail("出生点附近没有导航网格");
                return;
            }
            var filter = LevelContext.Walker;
            var tri = UnityEngine.AI.NavMesh.CalculateTriangulation();
            var v = tri.vertices;
            var idx = tri.indices;
            // 顶点焊接（tile 边界上的顶点各存一份）→ 并查集分块；只算过滤器认的区域（熔岩区不算路）
            var weld = new Dictionary<Vector3Int, int>();
            var root = new int[v.Length];
            for (int i = 0; i < v.Length; i++)
            {
                var key = new Vector3Int(Mathf.RoundToInt(v[i].x * 50f), Mathf.RoundToInt(v[i].y * 50f), Mathf.RoundToInt(v[i].z * 50f));
                if (!weld.TryGetValue(key, out int w)) weld[key] = w = i;
                root[i] = w;
            }
            int Find(int a)
            {
                while (root[a] != a) a = root[a] = root[root[a]];
                return a;
            }
            for (int t = 0; t + 2 < idx.Length; t += 3)
            {
                if ((filter.areaMask & (1 << tri.areas[t / 3])) == 0) continue;
                int a = Find(idx[t]), b = Find(idx[t + 1]), c = Find(idx[t + 2]);
                root[b] = a;
                root[Find(c)] = Find(a);
            }
            // 每块：面积、面积最大的三角形的重心（一定落在这块上）
            var blocks = new Dictionary<int, (float area, float best, Vector3 at)>();
            for (int t = 0; t + 2 < idx.Length; t += 3)
            {
                if ((filter.areaMask & (1 << tri.areas[t / 3])) == 0) continue;
                Vector3 a = v[idx[t]], b = v[idx[t + 1]], c = v[idx[t + 2]];
                float area = Vector3.Cross(b - a, c - a).magnitude * 0.5f;
                int k = Find(idx[t]);
                blocks.TryGetValue(k, out var e);
                e.area += area;
                if (area > e.best)
                {
                    e.best = area;
                    e.at = (a + b + c) / 3f;
                }
                blocks[k] = e;
            }
            var reach = ctx.Reach;
            var lavas = Object.FindObjectsByType<LavaVolume>();
            int linked = 0, unreachable = 0, doubleJump = 0, bad = 0, underLava = 0;
            var notes = new List<string>();
            foreach (var e in blocks.Values.OrderByDescending(b => b.area))
            {
                if (e.area < 0.25f) continue;
                if (!UnityEngine.AI.NavMesh.SamplePosition(e.at, out var hit, 0.3f, filter)) continue; // 不是人形代理的网格（火鼍）
                if (LevelContext.NavPath(start, hit.position, out _) == UnityEngine.AI.NavMeshPathStatus.PathComplete)
                {
                    linked++;
                    continue;
                }
                // 熔岩底下的网格（火口坑底、护城渠床）：玩家掉进去照 L7 扣血托回，站不住，不算
                var hp = hit.position;
                if (lavas.Any(l => l && l.Body.Contains(hp.x, hp.z) && hp.y < l.transform.position.y + 0.3f))
                {
                    underLava++;
                    continue;
                }
                var tier = ctx.TierAt(reach, hit.position, 1.5f, 0.8f);
                string at = $"{LevelContext.At(hit.position)} y {hit.position.y:F1}（{e.area:F1} m²）";
                if (tier <= Move.Dash)
                {
                    bad++;
                    rep.Fail($"导航孤岛 {at}：玩家{ReachFlood.Label(tier)}上得去，出场站位走不到（修坡连通，或这块顶面不进导航）");
                }
                else if (tier == Move.DoubleJump)
                {
                    doubleJump++;
                    rep.Warn($"导航孤岛 {at}：只有二段跳上得去");
                }
                else
                {
                    unreachable++;
                    if (notes.Count < 6) notes.Add(at);
                }
            }
            rep.Line($"人形导航网格 {linked} 块和出生点连通；孤岛：玩家上得去 {bad} 块、只有二段跳 {doubleJump} 块、玩家上不去 {unreachable} 块、熔岩底下 {underLava} 块（不算）" +
                     (notes.Count > 0 ? $"（{string.Join("；", notes)}{(unreachable > notes.Count ? " …" : "")}）" : ""));
            if (bad == 0) rep.Line("✓ 玩家步行 / 跳 / 冲刺站得上去的地方没有导航孤岛（S1 出场站位都走得到玩家）");
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查 3-4 自己的件（BossArena + QilinFurnace、BossEncounter、SupplyCamp 各 1，吊鼎 1、锁扣 4，没有 ExitPortal）。顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, ShrineSites sites)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), arenas = Count<BossArena>(), furnaces = Count<QilinFurnace>(), encounters = Count<BossEncounter>(),
                camps = Count<SupplyCamp>(), cauldrons = Count<QilinCauldron>(), locks = Count<QilinLock>(), portals = Count<ExitPortal>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (arenas != 1 || furnaces != 1 || encounters != 1 || camps != 1) rep.Fail($"BossArena {arenas} / QilinFurnace {furnaces} / BossEncounter {encounters} / SupplyCamp {camps}（各应为 1）");
            if (cauldrons != 1 || locks != 4) rep.Fail($"吊鼎 {cauldrons}（应 1）、锁扣 {locks}（应 4）");
            // 最后一关：打完走胜利链，不立出口；场景里也不放 ExitPortal（没有目标的出口开局就会自己开着）
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（首领关的去向由 BossEncounter 结算后决定）");
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
            var stage = RunPlan.ForScene(ScenePath);
            rep.Line($"RunPlan：{(stage != null ? $"{stage.code} {stage.Label}，最后一关 {(RunPlan.IsFinal(stage) ? "✓（打完走胜利链）" : "✗")}" : "（不在 RunPlan 里）")}");
            if (stage == null || !RunPlan.IsFinal(stage)) rep.Warn("3-4 不是 RunPlan 的最后一关：BossEncounter 打完会立出口（Boss Exit 点在神龛前）");
            int objectives = Count<LevelObjective>(), lordGates = Count<FoundryLordGate>(), encSites = Count<EncounterSite>(), caches = Count<CachePOI>();
            if (objectives != 1 || lordGates != 1 || encSites != 3 || caches != 1)
                rep.Fail($"LevelObjective {objectives}（应 1）/ FoundryLordGate {lordGates}（应 1）/ EncounterSite {encSites}（应 3：①、②、路遇）/ CachePOI {caches}（应 1）");
            else rep.Line("✓ 神道：LevelObjective ×1（①②）、FoundryLordGate ×1、EncounterSite ×3（①、②、路遇）、CachePOI ×1（熔岩洞）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1、BossArena / QilinFurnace / BossEncounter / SupplyCamp 各 1、吊鼎 1、锁扣 4，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给 L5 规则集的声明：
        ///   主线（关键路线，到入场点为止）：出生 · 眺台 → 神道上段 → ① 南口 → ① 中 → 山门 → 神道下段 → ② 西口 → ② 西桥 → ② 北岸 → 坡道 → 补给营 → 桥头 → 护城渠桥 → 门楼 → 入场点；
        ///   殿内（入场点 → 东柱旁 → 神龛西祭台 → 神龛前）在 CheckGeometry 里单独查连通，不算进关键路线长度；
        ///   节拍（S5 PacingCheck）：出生 → 路遇 → ① → 山门俯瞰 → 熔岩洞岔口 → ② → 补给营 → 首领；
        ///   坡度（两条祭台坡道、祝融像祭台、牌坊台两阶、闸楼台两坡、② → 补给营坡道、两段神道）；
        ///   地标视线（出生望炉心殿门楼 / 祝融像 / ①，山门望闸楼，② 望门洞，补给营望熔池，殿内原有几条）；
        ///   场地：① ② 战斗场地（≥ 6 处全遮、3 层、要有坡 / 阶上得去的俯射层、CoverReach ≥ 80%、熔岩 ≤ 35%）、补给营（缓冲）、炉心殿（首领场，不查 CoverReach）；
        ///   炉口召唤点按炭童查净空 / 有路；补给营的 7 个摊位按 ShopLayout 声明成交互点。
        /// 可玩区 = 开阔区（含火口坑）往岩壁里 2 m，软边界兜底；第三章正式件全部到位，占位件一律不合格
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var spec = new LevelSpec
                {
                    id = "3-4", title = "祝融炉心", playerSpawn = G(SpawnAt), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin, placeholders = PlaceholderPolicy.Fail,
                    slopePaths =
                    {
                        new SlopePath { name = "神龛西祭台坡道", points = new[] { new Vector2(-RampFoot.x, RampFoot.y), new Vector2(-RampTop.x, RampTop.y) } },
                        new SlopePath { name = "神龛东祭台坡道", points = new[] { RampFoot, RampTop } },
                        new SlopePath { name = "祝融像祭台", points = new[] { StatueAt + new Vector2(0, 9f), StatueAt + new Vector2(0, 3.5f) } },
                    },
                    sites =
                    {
                        new SiteSpec
                        {
                            name = "① 铜人神道", center = G(Site1C + new Vector2(0, 2)), size = 44, minCover = 6, minLayers = 3, overlook = true, minCoverReach = 0.8f, maxLavaShare = 0.35f,
                        },
                        new SiteSpec
                        {
                            name = "② 熔流闸口", center = G(Site2C), size = 46, minCover = 6, minLayers = 3, overlook = true, minCoverReach = 0.8f, maxLavaShare = 0.35f,
                        },
                        new SiteSpec { name = "铸神前殿补给营（缓冲）", center = G(CampAt), size = 24, combat = false },
                        new SiteSpec { name = "祝融炉心殿（首领场）", center = G(new Vector2(0, 2)), size = 60, minCover = 4, minLayers = 2, overlook = true, boss = true },
                    },
                }
                .Route("出生 · 火口南沿眺台", G(SpawnAt)).Route("神道上段 · 拐弯", G(new Vector2(29, -201)))
                .Route("① 南口", G(new Vector2(6, -183))).Route("① 神道中", G(new Vector2(0, -160))).Route("山门", G(new Vector2(GatehouseC.x, -142)))
                .Route("神道下段", G(new Vector2(-15, -135.5f))).Route("神道下段 · 西头", G(new Vector2(-33, -124))).Route("② 西口", G(new Vector2(-24, -115)))
                .Route("② 西桥", G(new Vector2(ChannelBridges[0], ChannelZ))).Route("② 北岸", G(new Vector2(-10, -90)))
                .Route("② → 补给营坡道", G(new Vector2(-13, -76))).Route("补给营 · 商店前", G(CampAt + new Vector2(3, 0))).Route("护城渠南岸 · 桥头", G(ForecourtN))
                .Route("护城渠桥", G(new Vector2(0, -37))).Route("门楼", G(new Vector2(0, -24))).Route("入场点", G(PlayerEntry))
                .Sight("出生 → 炉心殿南门", G(SpawnAt, 1.62f), new Vector3(0, 12f, GateZ), 5, GateFrameId)
                .Sight("出生 → 补给营祝融像", G(SpawnAt, 1.62f), G(StatueAt, 12f), 5, StatueId)
                .Sight("出生 → ① 山门（西城台）", G(SpawnAt, 1.62f), new Vector3(GatehouseC.x - 6f, Site1H + 8.5f, GatehouseC.y - GatehouseSize.z * 0.5f + 0.5f), 4, GatehouseId)
                .Sight("山门 → ② 闸楼", G(LandingAt, 1.62f), G(SluiceTowerAt, 7f), 4, FurnaceId)
                .Sight("② → 炉心殿门洞", G(new Vector2(-4, -88), 1.62f), new Vector3(0, 4.5f, GateZ), 4, GateFrameId)
                .Sight("补给营 → 门洞后的熔池红光", G(new Vector2(0, -56), 1.62f), new Vector3(0, 0.6f, PoolR - 1f), 3)
                .Sight("护城渠南岸 → 南门", G(ForecourtN + new Vector2(0, -4), 1.62f), new Vector3(0, 11.5f, GateZ), 4, GateFrameId)
                .Sight("入场点 → 巨鼎", G(PlayerEntry, 1.62f), new Vector3(0, HangHeight, 0), 3)
                .Sight("入场点 → 神龛", G(PlayerEntry, 1.62f), G(ShrineAt, 6f), 5, ShrineId)
                .Sight("东南象限 → 西锁扣（隔着熔池、从巨鼎旁边）", G(new Vector2(17, -8.5f), 1.62f), new Vector3(-LockR + 0.8f, LockHeight, 0), 3)
                .Sight("东祭台观台 → 熔池（隔着北口）", G(BalconyC + new Vector2(-0.6f, -0.6f), 1.62f), new Vector3(0, 0.5f, PoolR - 1f), 2)
                .Sight("西祭台观台 → 熔池（隔着北口）", G(new Vector2(-BalconyC.x + 0.6f, BalconyC.y - 0.6f), 1.62f), new Vector3(0, 0.5f, PoolR - 1f), 2);
            foreach (var sl in Slopes) spec.slopePaths.Add(new SlopePath { name = sl.name, points = new[] { sl.foot, sl.top } });
            foreach (var rd in Roads) spec.slopePaths.Add(new SlopePath { name = rd.name, points = rd.Points.ToArray(), maxSlope = 18f });
            ShrineBeats(spec, (q, dy) => G(q, dy));
            for (int i = 0; i < 2; i++)
            {
                var m = Ring((i == 0 ? -1 : 1) * FurnaceYaw, MouthR);
                spec.anchors.Add(new AnchorSpec { name = $"炉口召唤点 {(i == 0 ? "西" : "东")}（炭童）", pos = G(new Vector2(m.x, m.z)), enemies = new[] { "tantong" } });
            }
            var center = G(CampAt);
            var stations = ShopLayout.Build(center, -90f, 7, 3);
            for (int i = 0; i < stations.Count; i++)
                spec.interactables.Add(new InteractSpec
                {
                    name = $"补给营摊位 {i + 1}", kind = "ShopStall", focus = stations[i].position + Vector3.up * (i == 3 ? 0.95f : 1.15f), radius = 2.3f,
                    footprint = new Vector3(ShopLayout.StallHalfWidth, 0.55f, 0.5f),
                });
            return spec;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }
    }
}
