using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using static Spiritfire.Art.Editor.Levels.Landform;
using static Spiritfire.Game.InfernoSquads;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-4 v2 · 祝融神道（docs/level-design/ch3-v2.md 第 5.4 节、maps/3-4.md）：圆殿以南的整段前序路线——
    ///   出生 · 火口南沿眺台（+24，脚下是火口熔岩坑）→ 神道上段（绕火口东沿盘下，+24 → +14；路遇 · 神火鸦群）
    ///   → ① 铜人神道（+14，48 × 42：六尊铜人、牌坊台 +18.5、山门关楼；精英场 G13 + G04）
    ///   → 神道下段（山门后沿 ② 南崖往西盘下，+14 → +6；俯瞰 ②、补给营暖光和门洞红光）
    ///   → ② 熔流闸口（+6，50 × 49：东西横穿的 10 m 闸渠 + 两座小桥、东侧闸楼台 +11；G10 + G03）；西岔熔岩洞藏宝
    ///   → 坡道下到补给营（+1，铸神前殿：祝融像、商店、安全区）→ 护城渠桥 → 门楼 → 圆殿（原样）。
    /// 地形 = 一组「台」（圆角矩形，平顶 + 陡边）、「路」（样条，沿弧长从 h0 插到 h1）、「坡」（直坡道）取最高值；台外是火口壁（陡升到 30 m 以上），
    /// 眺台北面是火口熔岩坑（−8，熔岩面 −6）。熔岩：① 西南熔池、② 闸渠（三段，被两座桥隔开）+ 西端熔岩洞、火口坑。
    /// 首领门槛：①② 肃清前首领关流程停用（复用 3-3 的 <see cref="FoundryLordGate"/>：提示文字、目标栏、不落清关宝箱都配成 3-4 的）。
    /// 出场方式（S1）按 4.2 接好站位（增援门 / 埋伏 / 余烬起身 / 熔岩爬出 / 飞临 / 跃下）；S1 的表现落地之前退回现身。
    /// S3 熔泉、S4 熔流闸还没落地：② 里留了接口位置（Slot 标记），落地后由本文件接上。
    /// </summary>
    public static partial class Level_3_4
    {
        // ───────────── 高度（相对殿内地面 y = 0）─────────────
        const float OverlookH = 24f, Site1H = 14f, Site2H = 6f, CampH = 1f, SluiceH = 11f, TerraceH = 18.5f;
        const float PlinthRise = 1.2f, SlabRise = 1.2f, DaisRise = 1f;
        const float PitFloor = -8f, PitLava = -6f;
        /// <summary>① 熔池：熔岩面、池底</summary>
        const float PoolLava1 = 13.3f, PoolBed1 = 12.4f;
        /// <summary>② 闸渠：熔岩面、渠底、中线 z、熔岩半宽（渠底平段）、岸顶半宽、东端（闸楼台西壁）、西端（熔岩洞）</summary>
        const float SluiceLava = 5.3f, SluiceBed = 4.4f, ChannelZ = -104f, ChannelIn = 3.5f, ChannelOut = 6.5f, ChannelEast = 14f, ChannelWest = -46f;
        /// <summary>② 两座小桥（地形堤，宽 7 m）的中线 x</summary>
        static readonly float[] ChannelBridges = { -12f, 4f };
        const float ChannelBridgeHalf = 3.5f;

        // ───────────── 关键点 ─────────────
        static readonly Vector2 SpawnAt = new(-1, -220.5f);
        static readonly Vector2 OverlookC = new(0, -227);
        static readonly Vector2 RoadsideC = new(25, -201);
        static readonly Vector2 Site1C = new(0, -163), Site1Half = new(24, 21);
        static readonly Vector2 Site2C = new(0, -104.5f), Site2Half = new(25, 24.5f);
        /// <summary>② 的 EncounterSite 放在东桥上（场地正中是闸渠熔岩）：从西南口进来要走进 ② 十来米才开打，先看清闸楼台上的傩巫</summary>
        static readonly Vector2 Site2Trigger = new(4, -104);
        static readonly Vector2 CampC = new(0, -66), CampHalf = new(18, 14);
        /// <summary>SupplyCamp 的位置（商店弧在它东边 6.4 m，正面朝西）、祝融像（东南角，面朝北望着炉心殿）</summary>
        static readonly Vector2 CampAt = new(5, -60), StatueAt = new(10, -76.5f);
        static readonly Vector2 GatehouseC = new(16, -142), LandingAt = new(16, -134);
        static readonly Vector2 CacheAt = new(-42, -113.5f), CaveFork = new(-30, -117);
        static readonly Vector2 SluiceTowerAt = new(22.5f, -104), SluiceLever = new(16.5f, -104);
        /// <summary>
        /// ② 熔流闸（S4，M33 的 LavaSluice，拉闸方式）：闸楼台上一根拉杆（按 F），熔流从闸楼台西壁脚下沿北岸往西冲 6 s、一场一次——
        /// 正好扫过东洞口增援进来的祸斗 / 炭童走的北岸（熔流道 8 m 宽，地形里挖一条 0.6 m 的浅槽，敌人走得进去；不压进闸渠的熔岩）
        /// </summary>
        static readonly LevelKit.LavaSluiceSpec Sluice = new()
        {
            name = "闸口熔流闸", path = new[] { new Vector2(12.5f, -94.5f), new Vector2(-4, -94.5f), new Vector2(-22, -94) }, width = 8f,
            troughHalf = 2f, troughDepth = 0.6f, trigger = LavaSluice.Trigger.Lever, leverAt = new Vector2(17, -95), leverYaw = -90f,
            warn = 1f, duration = 6f, uses = 1,
        };

        /// <summary>① 六尊铜人（铜人基座 = 地形抬高 1.2 m 的 5 × 5 台，铜人本体立在中间）</summary>
        static readonly Vector2[] Statues =
        {
            new(-11, -178), new(11, -178), new(-11, -167.5f), new(11, -167.5f), new(-11, -157), new(11, -157),
        };

        // ───────────── 美术 ID（第三章 v2 新件：A3 登记了尺寸，到货前 PlaceOrBox 白盒）─────────────
        const string GatehouseId = "SM_Tripo_InfernoGatehouse", BasaltColumnsId = "SM_Tripo_InfernoBasaltColumns", GuardianId = "SM_Tripo_InfernoGuardianStatue",
            MouldId = "SM_Tripo_InfernoCastingMould", CoverWallId = "SM_Tripo_InfernoCoverWall", ObeliskId = "SM_Prop_InfernoChainObelisk",
            RuinId = "SM_Tripo_InfernoCauldronRuin", KilnMouthId = "SM_Tripo_InfernoKilnMouth", SpoutId = "SM_Tripo_InfernoSpout";
        /// <summary>正式件实测尺寸（docs/art/ch3-kit.md 第 0 节，发布尺度）；铜人按 ch3-kit 建议 ×1.21（基座 2.6 全遮、总高 9.1）</summary>
        static readonly Vector3 GatehouseSize = new(17.31f, 12, 8.97f), BasaltColumnsSize = new(6.63f, 9, 6.52f), GuardianSize = new(2.97f, 7.5f, 2.34f),
            MouldSize = new(2.33f, 2.8f, 1.25f), CoverWallSize = new(3.42f, 2.48f, 0.89f), ObeliskSize = new(1.08f, 2.13f, 1.08f),
            RuinSize = new(3.11f, 1.54f, 1.53f), AltarSize = new(1.13f, 2.36f, 1.15f), StallSize = new(2.6f, 3.47f, 1.63f),
            IngotSize = new(2.18f, 1.52f, 1.81f), HoardSize = new(2.31f, 1.71f, 1.56f), CrucibleSize = new(1.27f, 0.99f, 1.28f),
            BarricadeSize = new(3.56f, 1.18f, 0.47f), KilnMouthSize = new(14.29f, 12, 5.05f), SpoutSize = new(3.87f, 4, 3.68f);
        const float GuardianScale = 1.21f;

        // ───────────── 地形：台 / 路 / 坡 ─────────────

        sealed class Pad
        {
            public string name;
            public Vector2 c, half;
            /// <summary>圆角半径、顶面高、陡边（米 / 米：6 ≈ 80°，0.25 ≈ 14° 缓坡）、边缘起伏（米）</summary>
            public float r, h, steep = 6f, wobble;
            public int seed;

            public float Sdf(Vector2 p)
            {
                float d = BoxSdf(p, c, half - new Vector2(r, r)) - r;
                if (wobble > 0) d += Fbm(p, 7f, 3, seed) * wobble;
                return d;
            }
        }

        sealed class Road
        {
            public string name;
            public Vector2[] ctrl;
            /// <summary>半宽、起点 / 终点高、开头保持 h0 的米数、陡边</summary>
            public float half, h0, h1, hold, steep = 6f;
            List<Vector2> pts;
            float length;

            public IReadOnlyList<Vector2> Points
            {
                get
                {
                    Init();
                    return pts;
                }
            }

            public float Length
            {
                get
                {
                    Init();
                    return length;
                }
            }

            void Init()
            {
                if (pts != null) return;
                pts = Spline(ctrl, 8);
                length = 0;
                for (int i = 0; i + 1 < pts.Count; i++) length += Vector2.Distance(pts[i], pts[i + 1]);
            }

            public (float sdf, float h) Eval(Vector2 p)
            {
                Init();
                var (d, t) = Polyline(p, pts);
                float k = Mathf.Clamp01((t * length - hold) / Mathf.Max(1f, length - hold));
                return (d - half, Mathf.Lerp(h0, h1, k));
            }

            /// <summary>沿路 s 米处的点</summary>
            public Vector2 At(float s)
            {
                Init();
                float acc = 0;
                for (int i = 0; i + 1 < pts.Count; i++)
                {
                    float seg = Vector2.Distance(pts[i], pts[i + 1]);
                    if (acc + seg >= s) return Vector2.Lerp(pts[i], pts[i + 1], (s - acc) / Mathf.Max(1e-4f, seg));
                    acc += seg;
                }
                return pts[^1];
            }
        }

        sealed class Slope
        {
            public string name;
            public Vector2 foot, top;
            public float width, h0, h1, steep = 6f;

            public (float sdf, float h) Eval(Vector2 p)
            {
                var ab = top - foot;
                float len2 = Mathf.Max(1e-4f, ab.sqrMagnitude);
                float t = Mathf.Clamp01(Vector2.Dot(p - foot, ab) / len2);
                return (Vector2.Distance(p, foot + ab * t) - width * 0.5f, Mathf.Lerp(h0, h1, t));
            }
        }

        static readonly Pad[] Pads =
        {
            // 出生 · 火口南沿眺台
            new() { name = "火口南沿眺台", c = OverlookC, half = new Vector2(12, 10), r = 5, h = OverlookH, wobble = 1f, seed = 41 },
            // ① 铜人神道
            new() { name = "① 铜人神道", c = Site1C, half = Site1Half, r = 5, h = Site1H, wobble = 1f, seed = 42 },
            new() { name = "① 牌坊台", c = new Vector2(-12.75f, -146.5f), half = new Vector2(10.25f, 4.5f), r = 0.5f, h = TerraceH, steep = 8 },
            // 山门门洞（关楼的 8 m 门洞穿过 ① 北沿）与门后落脚台
            new() { name = "山门门洞", c = new Vector2(GatehouseC.x, -138f), half = new Vector2(4, 7), r = 0.5f, h = Site1H, steep = 8 },
            // ② 熔流闸口
            new() { name = "② 熔流闸口", c = Site2C, half = Site2Half, r = 4, h = Site2H, wobble = 0.5f, seed = 43 },
            new() { name = "② 闸楼台", c = new Vector2(20, -104), half = new Vector2(6, 17), r = 1.5f, h = SluiceH, steep = 8 },
            new() { name = "② 北桥头台", c = new Vector2(-2, -84), half = new Vector2(4, 2.5f), r = 0.8f, h = Site2H + SlabRise, steep = 8 },
            // 南桥头台往西南收（原 (−2, −124) 8 × 6）：北沿和闸楼台南坡之间原来只剩 1.25 m，坡南那一条（x 2–25、z −129…−120）烘成了导航孤岛
            new() { name = "② 南桥头台", c = new Vector2(-3.5f, -125.8f), half = new Vector2(3.5f, 2f), r = 0.8f, h = Site2H + SlabRise, steep = 8 },
            new() { name = "② 东洞口", c = new Vector2(29, -84), half = new Vector2(4.5f, 3), r = 1.5f, h = Site2H, steep = 8 },
            // 闸渠西段（出 ② 西沿进熔岩洞）、熔岩洞岸台（藏宝）
            new() { name = "闸渠西段", c = new Vector2(-36, ChannelZ), half = new Vector2(11, ChannelOut), r = 3, h = Site2H, wobble = 0.6f, seed = 44 },
            new() { name = "熔岩洞岸台", c = new Vector2(-38, -113.5f), half = new Vector2(7.5f, 4.5f), r = 2.5f, h = Site2H, wobble = 0.6f, seed = 45 },
            // 补给营 · 铸神前殿（+1，四周 4 m 缓坡）、祝融像祭台
            new() { name = "补给营", c = CampC, half = CampHalf, r = 5, h = CampH, steep = 0.25f, wobble = 0.6f, seed = 46 },
            new() { name = "祝融像祭台", c = StatueAt, half = new Vector2(5.5f, 4.5f), r = 1f, h = CampH + DaisRise, steep = 0.3f },
        };

        /// <summary>
        /// 台顶不进导航的「没坡的台阶」（S1：出场站位要走得到玩家；玩家跳上去时敌人在台下够得着，不会被导航孤岛卡住）：② 两座桥头台、① 六座铜人基座。
        /// 每块一个不可走的导航修饰体积，只罩台顶（台顶下 0.5 m 到上 2 m、台面外扩 0.2 m），台下地面不受影响
        /// </summary>
        static IEnumerable<Pad> NoNavTops => Pads.Where(p => p.name.Contains("桥头台")).Concat(Plinths);

        static void BuildNoNavTops(Transform parent)
        {
            var root = new GameObject("NoNav · 台顶（没坡的台阶）").transform;
            root.SetParent(parent, false);
            int notWalkable = NavMesh.GetAreaFromName("Not Walkable");
            foreach (var pad in NoNavTops)
            {
                var go = new GameObject($"NoNav · {pad.name}");
                go.transform.SetParent(root, false);
                go.transform.position = new Vector3(pad.c.x, pad.h + 0.75f, pad.c.y);
                var v = go.AddComponent<NavMeshModifierVolume>();
                v.center = Vector3.zero;
                v.size = new Vector3(pad.half.x * 2f + 0.4f, 2.5f, pad.half.y * 2f + 0.4f);
                v.area = notWalkable;
            }
        }

        /// <summary>① 铜人基座（5 × 5，+1.2）</summary>
        static readonly Pad[] Plinths = Statues.Select((s, i) => new Pad { name = $"铜人基座 {i + 1}", c = s, half = new Vector2(2.2f, 2.2f), r = 0.4f, h = Site1H + PlinthRise, steep = 10 }).ToArray();

        static readonly Road UpperRoad = new()
        {
            name = "神道上段", ctrl = new[] { new Vector2(6, -220), new Vector2(22, -214), new Vector2(31, -201), new Vector2(24, -189), new Vector2(8, -185) },
            half = 6.5f, h0 = OverlookH, h1 = Site1H, hold = 7.5f,
        };

        static readonly Road LowerRoad = new()
        {
            name = "神道下段", ctrl = new[] { new Vector2(17, -134), new Vector2(2, -135.5f), new Vector2(-15, -135.5f), new Vector2(-31, -131), new Vector2(-36, -123), new Vector2(-27, -115.5f) },
            half = 6.5f, h0 = Site1H, h1 = Site2H, hold = 6f,
        };

        static readonly Road[] Roads = { UpperRoad, LowerRoad };

        static readonly Slope[] Slopes =
        {
            // 坡顶正好落在台边（台边以内是台面、以外是坡），不然接缝处会多出一道坎
            new() { name = "牌坊台西阶", foot = new Vector2(-20.5f, -164f), top = new Vector2(-20.5f, -151f), width = 4, h0 = Site1H, h1 = TerraceH },
            new() { name = "牌坊台东阶", foot = new Vector2(-4.5f, -164f), top = new Vector2(-4.5f, -151f), width = 4, h0 = Site1H, h1 = TerraceH },
            new() { name = "闸楼台南坡", foot = new Vector2(-0.5f, -117.5f), top = new Vector2(14, -117.5f), width = 4.5f, h0 = Site2H, h1 = SluiceH },
            new() { name = "闸楼台北坡", foot = new Vector2(-0.5f, -89.5f), top = new Vector2(14, -89.5f), width = 4.5f, h0 = Site2H, h1 = SluiceH },
            new() { name = "② → 补给营坡道", foot = new Vector2(-13, -66), top = new Vector2(-13, -80), width = 7, h0 = CampH, h1 = Site2H },
        };

        /// <summary>火口熔岩坑（眺台北面、神道上段西面、① 南面）：椭圆</summary>
        static readonly Vector2 PitC = new(-6, -201), PitR = new(22, 17);

        static float PitSdf(Vector2 p)
        {
            var q = new Vector2((p.x - PitC.x) / PitR.x, (p.y - PitC.y) / PitR.y);
            return (q.magnitude - 1f) * Mathf.Min(PitR.x, PitR.y) + Fbm(p, 9f, 3, 47) * 1.5f;
        }

        /// <summary>神道部分的开阔区有符号距离（走得到的台 / 路 / 坡 + 火口坑；里面为负）</summary>
        static float ShrineOpen(Vector2 p) => Mathf.Min(WalkSdf(p), PitSdf(p));

        static float WalkSdf(Vector2 p)
        {
            float d = float.MaxValue;
            foreach (var a in Pads) d = Mathf.Min(d, a.Sdf(p));
            foreach (var r in Roads) d = Mathf.Min(d, r.Eval(p).sdf);
            foreach (var s in Slopes) d = Mathf.Min(d, s.Eval(p).sdf);
            return d;
        }

        /// <summary>神道部分的地面高：各台 / 路 / 坡顶面减去陡边取最高（火口坑里垫底 PitFloor），再挖 ① 熔池和 ② 闸渠</summary>
        static float ShrineHeight(Vector2 p, out float fluid, out float shore)
        {
            float h = PitSdf(p) <= 0.5f ? PitFloor : float.NegativeInfinity;
            foreach (var a in Pads) h = Mathf.Max(h, a.h - a.steep * Mathf.Max(0, a.Sdf(p)));
            foreach (var a in Plinths) h = Mathf.Max(h, a.h - a.steep * Mathf.Max(0, a.Sdf(p)));
            foreach (var r in Roads)
            {
                var (d, rh) = r.Eval(p);
                h = Mathf.Max(h, rh - r.steep * Mathf.Max(0, d));
            }
            foreach (var s in Slopes)
            {
                var (d, sh) = s.Eval(p);
                h = Mathf.Max(h, sh - s.steep * Mathf.Max(0, d));
            }
            fluid = 0;
            shore = 0;
            // ① 西南熔池：池边 2.5 m 缓坡进熔岩（击退推得进去）
            float pool = PoolSdf(p);
            if (pool < 1f)
            {
                float k = 1 - Smooth(-2.5f, 0.5f, pool);
                h -= (Site1H - PoolBed1) * k;
                fluid = Mathf.Max(fluid, Smooth(-1.2f, -1.8f, pool));
                shore = Mathf.Max(shore, Smooth(1f, -0.6f, pool) * (1 - fluid));
            }
            // ② 闸渠：岸顶 ±6.5 → 渠底平段 ±4（岸坡约 36°：导航网格从岸上连进熔岩，击退推得下去）；两座桥处不挖；东端到闸楼台西壁、西端进熔岩洞
            float ck = ChannelCarve(p);
            if (ck > 0)
            {
                h -= (Site2H - SluiceBed) * ck;
                fluid = Mathf.Max(fluid, Smooth(0.55f, 0.75f, ck));
                shore = Mathf.Max(shore, Smooth(0.05f, 0.45f, ck) * (1 - fluid));
            }
            // ② 熔流闸的浅槽（S4：只挖不填）
            h = LevelKit.SluiceTrough(p, Sluice.path, h, Sluice.troughHalf, Sluice.troughDepth, out float trough);
            shore = Mathf.Max(shore, trough * 0.6f);
            if (h < PitLava + 0.3f) fluid = 1;
            return h;
        }

        static float PoolSdf(Vector2 p) => BoxSdf(p, new Vector2(-19.25f, -177.5f), new Vector2(2.25f, 3.5f)) - 2f;

        /// <summary>闸渠下挖权重（0 = 岸上 / 桥面，1 = 渠底）</summary>
        static float ChannelCarve(Vector2 p)
        {
            if (p.x < ChannelWest - 3f || p.x > ChannelEast + 1f) return 0;
            float dz = Mathf.Abs(p.y - ChannelZ);
            if (dz > ChannelOut) return 0;
            float k = 1 - Smooth(ChannelIn, ChannelOut, dz);
            foreach (float bx in ChannelBridges) k *= Smooth(ChannelBridgeHalf, ChannelBridgeHalf + 0.6f, Mathf.Abs(p.x - bx));
            k *= 1 - Smooth(ChannelEast - 1.5f, ChannelEast, p.x);
            k *= Smooth(ChannelWest - 2.5f, ChannelWest, p.x);
            return k;
        }

        /// <summary>岩壁的起坡高度：离 p 最近的那片开阔区的顶面（相邻几片平滑过渡，不会在岩体里劈出缝）</summary>
        static float ShrineFoot(Vector2 p, float d)
        {
            float pd = PitSdf(p);
            float foot = pd < d + 6f ? PitFloor - 3f * (pd - d) : float.NegativeInfinity;
            foreach (var a in Pads) foot = Mathf.Max(foot, a.h - 3f * (a.Sdf(p) - d));
            foreach (var r in Roads)
            {
                var (sd, rh) = r.Eval(p);
                foot = Mathf.Max(foot, rh - 3f * (sd - d));
            }
            foreach (var s in Slopes)
            {
                var (sd, sh) = s.Eval(p);
                foot = Mathf.Max(foot, sh - 3f * (sd - d));
            }
            return foot;
        }

        /// <summary>神道部分的地面硬度（铺装 = 0.85：眺台、①、补给营、两段神道；② 0.6；熔岩洞 0.3）</summary>
        static float ShrinePacked(Vector2 p)
        {
            if (Pads[1].Sdf(p) < 0 || Pads[0].Sdf(p) < 0 || Pads[11].Sdf(p) < 0) return 0.85f;
            foreach (var r in Roads)
                if (r.Eval(p).sdf < 0) return 0.75f;
            if (Pads[4].Sdf(p) < 0 || Pads[5].Sdf(p) < 0) return 0.6f;
            return 0.3f;
        }

        // ───────────── 熔岩 ─────────────

        sealed class ShrineLava
        {
            public LavaVolume pit, pool1;
            public readonly List<LavaVolume> channel = new();
        }

        /// <summary>火口坑（大片，熔岩面 −6）、① 熔池（13.3）、② 闸渠三段（被两座桥隔开，5.3；西段一直流进熔岩洞）</summary>
        static ShrineLava BuildShrineLava(Transform env)
        {
            var root = new GameObject("Lava · 神道").transform;
            root.SetParent(env, false);
            var l = new ShrineLava
            {
                pit = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Crater Pit", center = new Vector3(PitC.x, PitLava, PitC.y), size = new Vector2(PitR.x * 2 + 6, PitR.y * 2 + 6), depth = 3f, flow = new Vector2(0.1f, 0.15f),
                }, root),
                pool1 = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Site1 Pool", center = new Vector3(-19.25f, PoolLava1, -177.5f), size = new Vector2(9f, 12f), depth = 1.6f, flow = new Vector2(0, -0.1f),
                }, root),
            };
            // 闸渠：桥把渠切成三段，熔岩体不跨过桥面（同护城渠）
            var cuts = new List<float> { ChannelWest - 2.5f };
            foreach (float bx in ChannelBridges)
            {
                cuts.Add(bx - ChannelBridgeHalf);
                cuts.Add(bx + ChannelBridgeHalf);
            }
            cuts.Add(ChannelEast);
            for (int i = 0; i + 1 < cuts.Count; i += 2)
            {
                float x0 = cuts[i], x1 = cuts[i + 1];
                l.channel.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = $"Sluice Channel {i / 2 + 1}", center = new Vector3((x0 + x1) * 0.5f, SluiceLava, ChannelZ), size = new Vector2(x1 - x0, ChannelOut * 2 - 1.5f),
                    depth = 1.6f, flow = new Vector2(-0.35f, 0),
                }, root));
            }
            return l;
        }

        // ───────────── 摆件 ─────────────

        sealed class ShrineProps
        {
            public readonly List<GameObject> statues = new(), placeholders = new();
            public GameObject gatehouse, sluiceTower, statue;
            public readonly List<Vector3> statueTops = new();
        }

        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, Vector3 size, float scale = 1f, float sink = 0.05f)
        {
            var go = LevelKit.PlaceOrBox(id, parent, set.OnGround(at.x, at.y, -sink), size * scale, yaw, scale);
            return go;
        }

        /// <summary>
        /// 眺台火坛、神道上段柱丛；① 六尊铜人（神道铜人到货前用玄武岩柱顶替，头顶平：毕方栖点）、两处柱丛、火坛、山门关楼（到货前三段白盒：两座墩 + 门楣，留 8 m 门洞）、
        /// 东侧女墙；② 矮墙 ×3、拒马 ×2、铸范 ×2、闸楼（炉塔件）与闸链柱、东洞口门框；熔岩洞藏宝堆；补给营祝融像、火坛、锻摊、货堆、坩埚
        /// </summary>
        static ShrineProps BuildShrineProps(LevelKit.TerrainSet set, Transform props)
        {
            var sp = new ShrineProps();
            var root = new GameObject("Shrine Path · 神道").transform;
            root.SetParent(props, false);

            // 眺台
            foreach (float sx in new[] { -1f, 1f }) Put(AltarId, root, set, new Vector2(sx * 6.5f, -217.5f), 0, AltarSize);
            foreach (var (at, yaw, s) in new[] { (new Vector2(-9, -233.5f), 30f, 1.1f), (new Vector2(8.5f, -234.5f), 200f, 0.9f), (new Vector2(-10, -222), 120f, 0.8f) })
                Put(BasaltId, root, set, at, yaw, new Vector3(2.6f, 2.9f, 2.4f), s, 0.3f);

            // 神道上段：柱丛 ×2（路遇的掩体，路外沿）
            Put(BasaltColumnsId, root, set, new Vector2(37, -203), 70, BasaltColumnsSize, 0.8f, 0.3f);
            Put(BasaltColumnsId, root, set, new Vector2(20, -221.5f), -20, BasaltColumnsSize, 0.7f, 0.3f);

            // ① 铜人神道
            var s1 = new GameObject("① 铜人神道").transform;
            s1.SetParent(root, false);
            bool guardian = ShowcaseSceneBuilder.Prefab(GuardianId);
            float colScale = 7f / Mathf.Max(0.5f, ShowcaseSceneBuilder.DesignBounds(ColumnId).size.y);
            for (int i = 0; i < Statues.Length; i++)
            {
                var at = Statues[i];
                float yaw = at.x < 0 ? 90f : -90f; // 面朝神道中线
                GameObject go;
                float top;
                if (guardian)
                {
                    go = Put(GuardianId, s1, set, at, yaw, GuardianSize, GuardianScale, 0.05f);
                    // 毕方栖点 = 铜人头顶的 SOCKET_Perch（ch3-kit 3.2：发布尺度 7.5 m，×1.21 → 9.1）
                    var perch = go ? go.GetComponentsInChildren<Transform>(true).FirstOrDefault(t => t.name == "SOCKET_Perch") : null;
                    top = perch ? perch.position.y - set.GroundY(at.x, at.y) : GuardianSize.y * GuardianScale - 0.05f;
                }
                else
                {
                    go = LevelKit.PlaceOrBox(ColumnId, s1, set.OnGround(at.x, at.y, -0.1f), new Vector3(2.8f, 7f, 2.6f), yaw + i * 23f, colScale);
                    top = 7f - 0.1f;
                }
                if (!go) continue;
                go.name = $"铜人 {i + 1} · {go.name}";
                sp.statues.Add(go);
                sp.statueTops.Add(set.OnGround(at.x, at.y, top));
            }
            // 柱丛：一处立在神道中线偏东（打断 40 m 的纵向视线，又不挡出生点望炉心殿门楼的那条线），一处贴东壁
            Put(BasaltColumnsId, s1, set, new Vector2(3.2f, -172), 15, BasaltColumnsSize, 0.7f, 0.3f);
            Put(BasaltColumnsId, s1, set, new Vector2(21.5f, -174), -40, BasaltColumnsSize, 0.65f, 0.3f);
            foreach (float sx in new[] { -1f, 1f }) Put(AltarId, s1, set, new Vector2(sx * 3f, -182.5f), 180, AltarSize);
            // 余烬渣堆（炭童余烬起身的站位旁）
            Put(RuinId, s1, set, new Vector2(4.5f, -176.8f), 30, RuinSize);
            Put(IngotId, s1, set, new Vector2(0, -161), 200, IngotSize);
            Put(RuinId, s1, set, new Vector2(7f, -152f), 160, RuinSize);
            // 牌坊台：火坛 ×2、坩埚（铜匠的浇铜位）
            foreach (float x in new[] { -21.5f, -4.5f }) Put(AltarId, s1, set, new Vector2(x, -143f), 180, AltarSize);
            Put(CrucibleId, s1, set, new Vector2(-17.5f, -143.2f), 20, CrucibleSize, 1.4f);
            // 牌坊台东端到山门西墩之间的女墙（2.5 m，挡住从 ① 北沿直接跳下神道下段；台上的人看得过去）
            foreach (float x in new[] { -0.8f, 2.6f, 6f }) Put(CoverWallId, s1, set, new Vector2(x, -142.6f), 0, CoverWallSize, 1f, 0.15f);
            sp.gatehouse = BuildGatehouse(set, s1, sp);

            // ② 熔流闸口
            var s2 = new GameObject("② 熔流闸口").transform;
            s2.SetParent(root, false);
            foreach (var (at, yaw) in new[] { (new Vector2(-17, -122), 10f), (new Vector2(-9, -119.2f), -15f), (new Vector2(8, -124.6f), 5f), (new Vector2(5.5f, -84), 0f) })
                Put(CoverWallId, s2, set, at, yaw, CoverWallSize, 1f, 0.15f);
            foreach (var (at, yaw) in new[] { (new Vector2(-3, -93.5f), 0f), (new Vector2(-20, -94), 15f) })
                Put(BarricadeId, s2, set, at, yaw, BarricadeSize, 1f, 0.05f);
            foreach (var (at, yaw) in new[] { (new Vector2(-14, -88.5f), 10f), (new Vector2(-21.5f, -116.5f), -25f) })
            {
                var m = Put(MouldId, s2, set, at, yaw, MouldSize, 1f, 0.05f);
                if (m && m.CompareTag(LevelKit.PlaceholderTag)) sp.placeholders.Add(m);
            }
            // 闸楼（熔流闸的楼：炉塔件，炉口朝西对着闸渠）+ 两根闸链柱
            sp.sluiceTower = Put(FurnaceId, s2, set, SluiceTowerAt, -90, FurnaceSize, 1f, 0.05f);
            if (sp.sluiceTower) sp.sluiceTower.name = $"闸楼 · {sp.sluiceTower.name}";
            Put(ObeliskId, s2, set, new Vector2(15.2f, -110.5f), -90, ObeliskSize, 1.5f);
            Put(CrucibleId, s2, set, new Vector2(18, -114), 60, CrucibleSize, 1.3f);
            Put(IngotId, s2, set, new Vector2(-15, -84.5f), 110, IngotSize);
            // 东洞口：门框（增援门），炭火光
            // 东洞口：炉窟门脸（拱门贯通，背面贴岩壁；×0.5 → 7 m 宽）
            Put(KilnMouthId, s2, set, new Vector2(33.4f, -84), -90, KilnMouthSize, 0.5f, 0.1f);
            // 闸渠口：闸楼台西壁上的兽首熔流口，嘴对着闸渠（熔岩本来就在渠里流，不另加特效）
            var spout = LevelKit.PlaceOrBox(SpoutId, s2, new Vector3(ChannelEast + 0.9f, SluiceLava + 0.4f, ChannelZ), SpoutSize * 1.3f, -90f, 1.3f);
            if (spout) spout.name = $"闸渠口 · {spout.name}";
            // 熔岩洞：藏宝堆
            Put(HoardId, s2, set, CacheAt + new Vector2(-2.6f, 0.4f), 80, HoardSize);
            Put(BasaltId, s2, set, new Vector2(-46, -116), 40, new Vector3(2.6f, 2.9f, 2.4f), 1.2f, 0.3f);

            // 补给营 · 铸神前殿：祝融像（东南角祭台上，面朝北望着炉心殿）
            var camp = new GameObject("补给营 · 铸神前殿").transform;
            camp.SetParent(root, false);
            const float statueScale = 1.2f;
            sp.statue = Put(StatueId, camp, set, StatueAt + new Vector2(0, -1f), 0, new Vector3(7.8f, 15.4f, 6.8f) * statueScale, statueScale, 0.1f);
            foreach (float sx in new[] { -1f, 1f }) Put(AltarId, camp, set, StatueAt + new Vector2(sx * 4.5f, 4f), 0, AltarSize);
            Put(StallId, camp, set, new Vector2(15.5f, -54), -90, StallSize);
            Put(IngotId, camp, set, new Vector2(15, -67), 200, IngotSize);
            Put(HoardId, camp, set, new Vector2(16, -50.5f), 250, HoardSize);
            Put(CrucibleId, camp, set, new Vector2(-14, -60), 30, CrucibleSize);
            Put(CrucibleId, camp, set, new Vector2(-12.5f, -61.5f), 110, CrucibleSize);
            Put(BasaltId, camp, set, new Vector2(-17.5f, -57), 10, new Vector3(2.6f, 2.9f, 2.4f), 1.1f, 0.3f);

            // 白盒顶上不烘导航：整块白盒的平顶（山门门楣 26 m、柱丛 7 m）会烘出孤岛，敌人 / 机器人采样采到上面就下不来。正式件到货后按网格照常烘
            foreach (var c in root.GetComponentsInChildren<Collider>(true))
            {
                if (!c.CompareTag(LevelKit.PlaceholderTag) || c.GetComponent<NavMeshModifier>()) continue;
                var mod = c.gameObject.AddComponent<NavMeshModifier>();
                mod.overrideArea = true;
                mod.area = NavMesh.GetAreaFromName("Not Walkable");
            }
            BuildNoNavTops(root);
            return sp;
        }

        /// <summary>
        /// 山门关楼（16 × 12 × 14，门洞 8 m）：正式件到货就整件摆；到货前白盒拆成两座墩 + 门楣（整块白盒会把门洞堵死），都标占位。
        /// 熔铁闸（增援门的门）先收在门楣里，只露 1.5 m 闸齿——S1 增援门落地后改成开战升起
        /// </summary>
        static GameObject BuildGatehouse(LevelKit.TerrainSet set, Transform parent, ShrineProps sp)
        {
            var at = set.OnGround(GatehouseC.x, GatehouseC.y, -0.1f);
            at.y = Site1H - 0.1f;
            if (ShowcaseSceneBuilder.Prefab(GatehouseId))
            {
                var go = LevelKit.PlaceOrBox(GatehouseId, parent, at, GatehouseSize, 180f);
                if (go) go.name = $"山门 · {go.name}";
                return go;
            }
            LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var root = new GameObject($"山门 · Placeholder · {GatehouseId}").transform;
            root.SetParent(parent, false);
            root.position = at;
            var mat = LevelKit.Ch3Placeholder(Dir);
            const float pier = 4f, opening = 8f, passH = 8f;
            foreach (float sx in new[] { -1f, 1f })
            {
                var b = LevelKit.Box($"Placeholder · {GatehouseId}（{(sx < 0 ? "西" : "东")}墩）", root, at + new Vector3(sx * (opening + pier) * 0.5f, 0, 0),
                    new Vector3(pier, GatehouseSize.y, GatehouseSize.z), 0, mat, 0.1f);
                b.tag = LevelKit.PlaceholderTag;
                sp.placeholders.Add(b);
            }
            var lintel = LevelKit.Box($"Placeholder · {GatehouseId}（门楣 · 城台）", root, at + new Vector3(0, passH, 0), new Vector3(opening + 0.2f, GatehouseSize.y - passH, GatehouseSize.z), 0, mat, 0f);
            lintel.tag = LevelKit.PlaceholderTag;
            sp.placeholders.Add(lintel);
            var gate = LevelKit.PlaceOrBox(MoltenGateId, root, at + new Vector3(0, passH - 1.5f, -GatehouseSize.z * 0.5f + 1.2f), new Vector3(opening - 0.4f, 1.6f, 0.8f), 0f);
            if (gate)
            {
                gate.name = $"山门熔铁闸（收起） · {gate.name}";
                if (gate.CompareTag(LevelKit.PlaceholderTag)) sp.placeholders.Add(gate);
            }
            return root.gameObject;
        }

        // ───────────── 遭遇 ─────────────

        sealed class ShrineSites
        {
            public EncounterSite site1, site2, roadside;
            public LevelObjective objective;
            public CachePOI cache;
            public FoundryLordGate lordGate;
            public Transform knock1, knock2;
            public LavaSluice sluice;
            public readonly List<LavaGeyser> geysers = new();
        }

        static Transform Mark(Transform parent, string name, Vector3 pos, Vector3 facing = default)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.position = pos;
            facing.y = 0;
            if (facing.sqrMagnitude > 1e-4f) t.rotation = Quaternion.LookRotation(facing.normalized);
            return t;
        }

        /// <summary>
        /// 遭遇（第三章 v2 编组库）：
        ///   路遇 · 神道上段：G07 轻（神火飞鸦 ×4，从火口坑里飞临）；
        ///   ① 铜人神道（精英场）：一 G13 炉心守将（精英铁牛·狂暴 从山门出 + 铜匠埋伏在牌坊台 + 祸斗 ×3 走三条 lane）；二 G04（毕方 ×2 飞临到铜人头顶 + 炭童 ×4 余烬起身）；奖励强化；
        ///   ② 熔流闸口：一 G10 三面傩阵（精英傩巫·坚盾 埋伏在闸楼台 + 祸斗 ×3 / 炭童 ×3 从东洞口、熔岩洞增援）；二 G03 熔湖伏鼍（火鼍从闸渠爬出 + 马面从闸楼台跃下 + 炭童 ×2 从渠里爬出）；
        ///     奖励武器（保底精良）；
        ///   熔岩洞藏宝（无守军，秘卷）。
        /// 必清 22 只（① 11、② 11）、精英 2；路遇 4。①② 是关卡目标，肃清后 FoundryLordGate 放开炉心殿。
        /// </summary>
        static ShrineSites BuildShrineSites(LevelKit.TerrainSet set, Transform markers)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var ss = new ShrineSites();
            var root = new GameObject("Encounters · 神道").transform;
            root.SetParent(markers, false);

            EncounterSite Site(string name, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset, params SpawnAnchor[] anchors)
            {
                var site = new GameObject(name).AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = G(center);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                foreach (var a in anchors) a.transform.SetParent(site.transform, true);
                site.anchors = anchors.Select(a => a.transform).ToArray();
                return site;
            }
            SpawnAnchor A(string name, Vector2 at, StationRole role, int lane = 0, bool elevated = false, float dy = 0) =>
                SpawnAnchor.Create(root, name, G(at, dy), role, lane, elevated);

            // ── 路遇 · 神道上段：神火飞鸦 ×4 从火口坑里盘上来 ──
            // 入场点在火口坑上空、比神道上段高几米（从坑里盘上来的弧线由 S1 飞临做；入场点太低会贴着坑壁上不来）
            var crowEntry = new Vector3(PitC.x + 6, OverlookH + 4f, PitC.y);
            var rA = A("Enemy_R_CrowA", new Vector2(24, -205), StationRole.Auto).Via(SpawnMode.FlyIn).Entry(crowEntry);
            var rB = A("Enemy_R_CrowB", new Vector2(25, -195), StationRole.Auto, 1).Via(SpawnMode.FlyIn).Entry(crowEntry + new Vector3(-6, 3, 8));
            var roadSpec = EncounterSpec.Of(G07(fireCrow: 4, firecracker: 0).Named("火口鸦群")).Gather(0.3f).Distance(6, 30);
            ss.roadside = Site("Roadside · 神道上段", "神道上段 · 火口鸦群", RoadsideC, 13, 16, roadSpec, "", Vector3.zero, rA, rB);
            ss.roadside.AsRoadside(13f, 16f);

            // ── ① 铜人神道 ──
            var gateOut = new Vector2(GatehouseC.x, -149.5f);
            var a1 = new List<SpawnAnchor>
            {
                // 精英铁牛：山门门洞后（落脚台）走出来
                A("Enemy_1_Gate", gateOut, StationRole.Assault).Via(SpawnMode.Gate).Gate(G(LandingAt)).LookAt(G(Site1C)),
                // 祸斗三条 lane：西（牌坊台西阶下）、东（柱丛后）、南（身后的神道口）
                A("Enemy_1_LaneW", new Vector2(-15, -161), StationRole.Flank, 1).Via(SpawnMode.Gate).Gate(G(new Vector2(-21, -167))),
                A("Enemy_1_LaneE", new Vector2(17, -165), StationRole.Flank, 2).Via(SpawnMode.Gate).Gate(G(new Vector2(21.5f, -160))),
                A("Enemy_1_LaneS", new Vector2(-1, -179), StationRole.Flank, 0).Via(SpawnMode.Gate).Gate(G(new Vector2(6, -187))),
                // 铜匠：牌坊台上的坩埚旁（俯射层，绕后 / 从东阶上去打它）
                A("Enemy_1_Terrace", new Vector2(-12, -145.8f), StationRole.Support, 0, true).Via(SpawnMode.Ambush).LookAt(G(Site1C)),
                // 毕方：飞到铜人旁（它自己挑铜人头顶的 PerchPoint 栖），从火口坑方向飞进来
                A("Enemy_1_PerchW", new Vector2(-5, -166.5f), StationRole.Precision, 1).Via(SpawnMode.FlyIn).Entry(new Vector3(-10, 22, -192)),
                A("Enemy_1_PerchE", new Vector2(6.5f, -166), StationRole.Precision, 2).Via(SpawnMode.FlyIn).Entry(new Vector3(8, 24, -194)),
                // 炭童：三处渣堆
                A("Enemy_1_SlagA", new Vector2(-5, -177.5f), StationRole.Assault, 0).Via(SpawnMode.Ember),
                A("Enemy_1_SlagB", new Vector2(-3.5f, -165), StationRole.Assault, 1).Via(SpawnMode.Ember),
                A("Enemy_1_SlagC", new Vector2(2f, -154f), StationRole.Assault, 2).Via(SpawnMode.Ember),
            };
            var w1b = G04(bifang: 2, tantong: 4);
            foreach (var e in w1b.entries)
                if (e.enemy == Bifang) e.Via(SpawnMode.FlyIn);
            var spec1 = EncounterSpec.Of(
                    G13(Frenzied, founder: 1, huodou: 3).Hint("山门熔铁闸升起，精英铁牛低头走出——先杀牌坊台上浇铜的铜匠，还是趁它吸气打炉门？"),
                    w1b.Named("铜人栖火").Hint("毕方落在铜人头顶点射——打腿把它摔下来；炭童从渣堆里拼起来").After(1, 1.8f))
                .Gather(0.6f).Distance(8, 34);
            ss.site1 = Site("Site 1 · 铜人神道", "铜人神道", Site1C, 20, 26, spec1, "upgrade", new Vector3(0, 0, -4), a1.ToArray());

            // ── ② 熔流闸口 ──
            var eastGate = G(new Vector2(30.5f, -84));
            var caveGate = G(new Vector2(-37, -114));
            var a2 = new List<SpawnAnchor>
            {
                // 傩巫：闸楼台上跳傩（精英·坚盾）
                A("Enemy_2_Sluice", new Vector2(17, -97.5f), StationRole.Support, 0, true).Via(SpawnMode.Ambush).LookAt(G(Site2C)),
                // 增援门：东洞口（北半）、熔岩洞（南半）
                A("Enemy_2_GateE", new Vector2(21, -83.5f), StationRole.Flank, 1).Via(SpawnMode.Gate).Gate(eastGate),
                A("Enemy_2_GateE2", new Vector2(12, -84), StationRole.Assault, 1).Via(SpawnMode.Gate).Gate(eastGate),
                A("Enemy_2_GateW", new Vector2(-16.5f, -114.5f), StationRole.Assault, 2).Via(SpawnMode.Gate).Gate(caveGate),
                A("Enemy_2_GateW2", new Vector2(-12.5f, -125.5f), StationRole.Flank, 2).Via(SpawnMode.Gate).Gate(caveGate),
                // 火鼍：西段闸渠里潜行进场（只用这个站位，见下面 w2b）；
                // 炭童 ×2：从渠里爬上北岸，正落在熔流道的槽底中线上（槽壁有一串烘不进导航的小洞，槽底中线离边 ≥ 1.5 m）——
                // 第二波一开就是「北岸熔流道上一群怪」的拉闸时机；玩家站上闸楼台拉闸，它们得沿熔流道往东绕到北坡道，正迎着熔流头。
                // 两个站位都是第二波的主 lane（1），原来南岸那个（10, −113）离边 1.0 m，拿掉
                A("Enemy_2_Tuo", new Vector2(-24, -111.8f), StationRole.Flank, 0).Via(SpawnMode.LavaCrawl).Entry(new Vector3(-20, SluiceLava, ChannelZ)),
                A("Enemy_2_CrawlN", new Vector2(-10, -94), StationRole.Assault, 1).Via(SpawnMode.LavaCrawl).Entry(new Vector3(-6, SluiceLava, -102)),
                A("Enemy_2_CrawlNW", new Vector2(-14, -95.2f), StationRole.Assault, 1).Via(SpawnMode.LavaCrawl).Entry(new Vector3(-18, SluiceLava, -101.5f)),
                // 马面：从闸楼台西沿跃下（落在南半）
                A("Enemy_2_Drop", new Vector2(-6.5f, -113.5f), StationRole.Ranged, 0).Via(SpawnMode.Drop).DropFrom(G(new Vector2(15.5f, -112), 0.2f)),
            };
            var w2b = G03(tuo: 1, mamian: 1, tantong: 2);
            foreach (var e in w2b.entries)
            {
                if (e.enemy == Mamian) e.Via(SpawnMode.Drop);
                // 火鼍只用自己的站位（西段闸渠，角色 Flank + lane 0）：原来它和炭童同是 Assault、跟着第二波的主 lane 挑熔岩爬出站位，
                // 会生在两桥之间 9 m 的小池或东段 6.5 m 的池子里（11-08 冒烟：生在东段、玩家在西南岸，每一扑都撞东桥的陡侧壁落回熔岩）
                if (e.enemy == Tuo) e.As(StationRole.Flank, 0);
            }
            var spec2 = EncounterSpec.Of(
                    G10(nuo: 1, huodou: 3, tantong: 3, eliteAffix: Shielded).Hint("闸楼台上的傩巫在换脸——先碎面具；祸斗从东洞口和熔岩洞两头包过来"),
                    w2b.Named("闸渠伏鼍").Hint("火鼍从闸渠里爬出来——离岸远点，先缴跃下来的马面的索，再把火鼍引上岸").After(1, 1.8f))
                .Gather(0.6f).Distance(8, 34);
            ss.site2 = Site("Site 2 · 熔流闸口", "熔流闸口", Site2Trigger, 20, 26, spec2, "weapon:min=1", new Vector3(-8, 0, 12), a2.ToArray());

            // ── 目标：①② 必清；路遇不计 ──
            ss.objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            ss.objective.transform.SetParent(root, false);
            ss.objective.title = "肃清祝融神道";
            ss.objective.required = new[] { ss.site1, ss.site2 };
            ss.objective.optional = Array.Empty<EncounterSite>();
            ss.objective.autoCollect = false;

            // ── 熔岩洞藏宝（无守军）──
            var poi = new GameObject("Cache · 熔岩洞").AddComponent<CachePOI>();
            poi.transform.SetParent(markers, false);
            poi.transform.SetPositionAndRotation(G(CacheAt), Quaternion.Euler(0, 80, 0));
            poi.title = "熔岩洞秘藏";
            poi.reward = "scroll";
            poi.discoverRadius = 14f;
            ss.cache = poi;

            return ss;
        }

        /// <summary>毕方栖点（PerchPoint）：铜人头顶、牌坊台两角、闸楼台两端</summary>
        static void BuildPerches(LevelKit.TerrainSet set, Transform markers, ShrineProps sp)
        {
            var root = new GameObject("Perches · 神道").transform;
            root.SetParent(markers, false);
            int i = 0;
            foreach (var top in sp.statueTops) Mark(root, $"PerchPoint_Statue_{++i}", top).gameObject.AddComponent<PerchPoint>();
            foreach (var at in new[] { new Vector2(-21.5f, -143.5f), new Vector2(-2f, -143.5f), new Vector2(24.5f, -88.5f), new Vector2(24.5f, -119.5f) })
                Mark(root, $"PerchPoint_{++i}", set.OnGround(at.x, at.y, 0.05f)).gameObject.AddComponent<PerchPoint>();
        }

        /// <summary>
        /// 首领门槛（第 5.4 节）：①② 肃清前首领关流程停用，复用 3-3 的 <see cref="FoundryLordGate"/>——
        /// 提前踏进炉心殿提示「先肃清神道」；目标完成 → 横幅「炉心 · 火麒麟苏醒」、目标栏「前往炉心殿 · 击败火麒麟」；3-4 打完走胜利链，不落清关宝箱
        /// </summary>
        static FoundryLordGate BuildLordGate(BossEncounter enc, LevelObjective objective)
        {
            enc.enabled = false;
            var g = enc.gameObject.AddComponent<FoundryLordGate>();
            g.objective = objective;
            g.encounter = enc;
            g.lockedHint = "炉心殿还在沉睡——先肃清祝融神道（铜人神道、熔流闸口）";
            g.wakeTitle = "炉心";
            g.wakeSub = "火麒麟苏醒 · 熔池翻涌";
            g.wakeObjective = "前往炉心殿 · 击败火麒麟";
            g.clearChest = false;
            return g;
        }

        /// <summary>
        /// 标记：击退冒烟点（① 熔池东岸、② 闸渠南岸，各一处正对熔岩）；② 熔流闸（S4 已落地：LevelKit.PlaceLavaSluice）；
        /// S3 熔泉 ×4 的接口位置（M32 的 LavaGeyser 没落地前只是空标记）
        /// </summary>
        static (Transform knock1, Transform knock2, LavaSluice sluice) BuildShrineMarkers(LevelKit.TerrainSet set, Transform markers, EncounterSite site2,
            List<LavaGeyser> geyserList)
        {
            var root = new GameObject("Markers · 神道").transform;
            root.SetParent(markers, false);
            var k1 = KnockMark(set, root, "Knock_Edge_1", new Vector2(-12.5f, -177.5f), Vector2.left, PoolLava1);
            var k2 = KnockMark(set, root, "Knock_Edge_2", new Vector2(-24.5f, -113f), Vector2.up, SluiceLava);
            // 间歇熔泉（S3，M32 的 LavaGeyser）：闸渠岸边四口，只在 ② 交战时喷，周期 8 s 错开四分之一
            var geysers = new GameObject("Lava Geysers · 闸渠").transform;
            geysers.SetParent(root, false);
            for (int i = 0; i < GeyserSlots.Length; i++)
            {
                var at = GeyserSlots[i];
                var g = LevelKit.PlaceLavaGeyser(Dir, $"Lava Geyser {i + 1}", geysers, set.OnGround(at.x, at.y), new LevelKit.GeyserSpec
                {
                    period = 8f, phase = i * 0.25f, startActive = false, activeSite = site2, ventRadius = 2.2f, radius = 2f, seed = 40 + i,
                });
                if (g) geyserList.Add(g);
            }
            // 熔流闸：熔流道在 ② 地面（+6），拉杆在闸楼台上（+11）
            var sluice = LevelKit.PlaceLavaSluice(Dir, Sluice, root, q => (q - Sluice.leverAt).sqrMagnitude < 0.01f ? set.GroundY(q.x, q.y) : Site2H);
            return (k1, k2, sluice);
        }

        /// <summary>S3 间歇熔泉的位置（闸渠岸边：北岸西头 1 口、南岸三段各 1 口——两桥之间、西桥以西、东桥以东；不压熔流闸的熔流道、不堵桥头）</summary>
        static readonly Vector2[] GeyserSlots = { new(-26, -98.5f), new(-19.5f, -110f), new(-4, -110f), new(10.8f, -110f) };

        /// <summary>
        /// 青金引导灯（S6，M33 的 LevelKit.GuideLamp）：主路岔口、场地出口、桥头，每 25–40 m 一盏，支路（熔岩洞）不放。
        /// 眺台下坡口 → 神道上段拐弯 → ① 山门门洞口 → 山门后落脚台 → 神道下段中 → 熔岩洞岔口（主路一侧）→ ② 北坡道口 → 护城渠桥头。
        /// 交战场地里面不放（构图准则第 6 节：交战场地保持干净，明度留给怪）：原来 ② 西桥两头各一盏，去色后是 ② 画面里最亮的竖柱，比怪还跳，拿掉了
        /// </summary>
        static List<GameObject> BuildShrineGuides(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Guide Lamps · 青金").transform;
            root.SetParent(props, false);
            Vector3 G(Vector2 q) => set.OnGround(q.x, q.y);
            var spots = new List<(Vector3, float)>
            {
                (G(new Vector2(8.5f, -214.5f)), 60),     // 眺台 → 神道上段
                (G(new Vector2(24, -193)), -45),         // 神道上段拐弯（路遇）
                (G(new Vector2(11.4f, -150.4f)), 0),     // ① 出口：山门门洞口
                (G(new Vector2(19.5f, -130.5f)), -90),   // 山门后落脚台
                (G(new Vector2(-15, -140.2f)), -90),     // 神道下段中
                (G(new Vector2(-25, -120)), 45),         // 熔岩洞岔口（主路一侧）
                (G(new Vector2(-8.6f, -81)), 0),         // ② 出口：北坡道口
                (G(new Vector2(6.4f, -49)), 0),          // 补给营 → 护城渠桥头
            };
            return LevelKit.GuideLamps(Dir, root, spots);
        }

        /// <summary>岸上离熔岩面高 ≤ 0.5 m、正对熔岩的点（从 start 沿 dir 往熔岩方向走）</summary>
        static Transform KnockMark(LevelKit.TerrainSet set, Transform root, string name, Vector2 start, Vector2 dir, float lava)
        {
            var p = start;
            for (float s = 0; s < 6f; s += 0.1f)
            {
                var q = start + dir * s;
                if (set.GroundY(q.x, q.y) <= lava + 0.5f)
                {
                    p = q - dir * 0.2f;
                    break;
                }
            }
            return Mark(root, name, set.OnGround(p.x, p.y), new Vector3(dir.x, 0, dir.y));
        }

        // ───────────── 自查 ─────────────

        /// <summary>
        /// 神道自查：关键高度（眺台 24、① 14、牌坊台 18.5、铜人基座 15.2、② 6、闸楼台 11、补给营 1、火口坑 −8）、火口壁够高；
        /// 闸渠：渠底、桥面、熔岩宽 ≥ 8 m（火鼍游得开）；击退点往外是熔岩且导航网格连到 Lava 区；
        /// 编组自查（每波 ≤ 3 种、远程 ≤ 3）、必清只数 / 精英；首领门槛接线；接口位置
        /// </summary>
        static void CheckShrine(LevelKit.Report rep, LevelKit.TerrainSet set, ShrineLava lava, ShrineProps sp, ShrineSites ss, BossEncounter enc)
        {
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, Vector2 at, float want, float tol)
            {
                float got = Y(at);
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what} {LevelContext.At(new Vector3(at.x, 0, at.y))}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            CheckHallLoop(rep, set);
            rep.Section("神道地形（3-4 v2）");
            Near("出生 · 火口南沿眺台", SpawnAt, OverlookH, 0.4f);
            Near("① 铜人神道（神道中线）", new Vector2(0, -170), Site1H, 0.3f);
            Near("① 牌坊台", new Vector2(-12, -145.8f), TerraceH, 0.3f);
            Near("① 铜人基座", Statues[2] + new Vector2(-1.8f, 0), Site1H + PlinthRise, 0.3f);
            Near("① 熔池心", new Vector2(-19.25f, -177.5f), PoolBed1, 0.4f);
            Near("山门门洞", new Vector2(GatehouseC.x, -140), Site1H, 0.3f);
            Near("② 熔流闸口（南半）", new Vector2(-8, -114), Site2H, 0.3f);
            Near("② 熔流闸口（北半）", new Vector2(-8, -90), Site2H, 0.3f);
            Near("② 闸楼台", new Vector2(21, -112), SluiceH, 0.3f);
            Near("② 闸渠底", new Vector2(-4, ChannelZ), SluiceBed, 0.3f);
            foreach (float bx in ChannelBridges) Near($"② 小桥（x {bx:F0}）", new Vector2(bx, ChannelZ), Site2H, 0.3f);
            Near("熔岩洞岸台（藏宝）", CacheAt, Site2H, 0.4f);
            Near("补给营", CampAt, CampH, 0.3f);
            Near("火口坑底", PitC, PitFloor, 0.6f);
            // 熔岩宽：闸渠中段（两桥之间）熔岩面以下的宽度 ≥ 8 m（火鼍只在 ≥ 8 m 宽的熔岩里）
            float wet = 0;
            for (float z = ChannelZ - ChannelOut; z <= ChannelZ + ChannelOut; z += 0.1f)
                if (Y(new Vector2(-24, z)) < SluiceLava) wet += 0.1f;
            if (wet < 8f) rep.Fail($"闸渠西段熔岩只有 {wet:F1} m 宽（火鼍要 ≥ 8 m）");
            else rep.Line($"✓ 闸渠西段熔岩宽 {wet:F1} m（火鼍游得开）");
            // 火口壁：东、西、南都比旁边的台高 ≥ 12 m（地形本身是边界）
            var walls = new[] { ("眺台南", new Vector2(0, -250), OverlookH), ("① 东", new Vector2(33, -165), Site1H), ("① 西", new Vector2(-33, -160), Site1H),
                ("② 东", new Vector2(36, -104), SluiceH), ("② 西北", new Vector2(-34, -88), Site2H), ("补给营东", new Vector2(26, -66), CampH) };
            var low = walls.Where(w => Y(w.Item2) < w.Item3 + 9f).Select(w => $"{w.Item1} y = {Y(w.Item2):F1}").ToList();
            if (low.Count > 0) rep.Fail($"火口壁不够高（应比旁边的台高 ≥ 9 m）：{string.Join("；", low)}");
            else rep.Line($"✓ 火口壁：{string.Join("、", walls.Select(w => $"{w.Item1} {Y(w.Item2):F0}"))}");
            rep.Line($"熔岩：火口坑 {(lava.pit ? "✓" : "✗")}、① 熔池 {(lava.pool1 ? "✓" : "✗")}、② 闸渠 {lava.channel.Count} 段");
            foreach (var v in lava.channel)
                foreach (float bx in ChannelBridges)
                    if (v && v.Body.Contains(bx, ChannelZ))
                        rep.Fail($"{v.name} 盖到了 x {bx:F0} 的桥面上");

            // 击退点：往外 2.5 m 是熔岩，人形导航网格从标记连到 Lava 区
            int area = LevelKit.LavaNavArea;
            foreach (var (k, body) in new[] { (ss.knock1, lava.pool1), (ss.knock2, lava.channel.FirstOrDefault()) })
            {
                if (!k)
                {
                    rep.Fail("缺 Knock_Edge 标记");
                    continue;
                }
                var kp = k.position;
                var outside = kp + k.forward * 2.5f;
                float og = Y(new Vector2(outside.x, outside.z));
                bool lavaGeom = body && body.Body.Contains(outside.x, outside.z) && og <= body.transform.position.y + LavaTuning.StandRise;
                string where = $"{k.name} {LevelContext.At(kp)} 地面 y {kp.y:F2}，往外 2.5 m 地面 y {og:F2}";
                if (!lavaGeom)
                {
                    rep.Fail($"{where}：往外不是熔岩");
                    continue;
                }
                if (area < 0)
                {
                    rep.Line($"· {where}（没有 Lava 区域，导航连通没查）");
                    continue;
                }
                var path = new NavMeshPath();
                bool from = NavMesh.SamplePosition(kp, out var kh, 1.5f, LavaField.WalkerFilter());
                bool to = NavMesh.SamplePosition(outside + Vector3.up * 0.3f, out var lh, 2f, LavaField.WalkerFilter(1 << area));
                bool linked = from && to && NavMesh.CalculatePath(kh.position, lh.position, LavaField.WalkerFilter(), path) && path.status == NavMeshPathStatus.PathComplete;
                if (linked) rep.Line($"✓ {where}：岸上的导航网格连到 Lava 区（击退推得下去）");
                else rep.Fail($"{where}：岸上的导航网格连不到 Lava 区（起点 {from}、熔岩点 {to}、路径 {path.status}）——岸坡太陡，击退推不下去");
            }

            rep.Section("神道遭遇（编组库 G07 / G13 / G04 / G10 / G03）");
            int problems = 0;
            foreach (var s in new[] { ss.roadside, ss.site1, ss.site2 })
            {
                if (!s)
                {
                    rep.Fail("缺场地");
                    continue;
                }
                problems += Check(s.spec, $"3-4 {s.title}", rep.Fail);
                int elites = s.spec.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count));
                rep.Line($"{s.title}：{s.spec.waves.Length} 波 {s.spec.Total} 只（精英 {elites}），站位 {s.anchors.Length}（" +
                         $"{string.Join(" / ", s.anchors.Select(a => a.GetComponent<SpawnAnchor>()).Where(a => a).GroupBy(a => a.mode).Select(g => $"{SpawnModes.Label(g.Key)} {g.Count()}"))}），" +
                         $"触发 {s.triggerRadius} m{(s.roadside ? "，路遇" : $"，奖励 {s.reward}")}");
                foreach (var w in s.spec.waves) rep.Line($"    · {Describe(w)}");
            }
            CheckAnchorEdges(rep, ss);
            if (ss.objective)
            {
                int total = ss.objective.required.Sum(s => s ? s.spec.Total : 0);
                int elites = ss.objective.required.Sum(s => s ? s.spec.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count)) : 0);
                string msg = $"必清 {ss.objective.required.Length} 处 / {total} 只 / 精英 {elites}（目标：2 / 约 22 / 2）";
                if (ss.objective.required.Length != 2 || elites != 2 || total < 20 || total > 24) rep.Fail(msg);
                else rep.Line($"✓ {msg}");
            }
            // 路遇离必清场地 ≥ 触发 + 场地半径（同一时间只打一处）
            if (ss.roadside && ss.site1)
            {
                float d = Vector3.Distance(Flat3(ss.roadside.transform.position), Flat3(ss.site1.transform.position));
                float need = ss.roadside.triggerRadius + ss.site1.arenaRadius;
                if (d < need) rep.Fail($"路遇离 ① {d:F0} m < 触发 + 场地半径 {need:F0} m");
                else rep.Line($"✓ 路遇离 ① {d:F0} m（≥ {need:F0}）");
            }

            rep.Section("首领门槛（①② → 炉心殿）");
            var lg = ss.lordGate;
            if (!lg || !enc) rep.Fail("没有 FoundryLordGate / BossEncounter");
            else
            {
                if (enc.enabled) rep.Fail("首领关流程开局就开着（应等 ①② 肃清，由 FoundryLordGate 打开）");
                if (lg.encounter != enc || lg.objective != ss.objective) rep.Fail("FoundryLordGate 没接上 BossEncounter / 关卡目标");
                if (lg.clearChest) rep.Fail("3-4 是章末首领关（打完走胜利链），不该落清关宝箱");
                if (!enc.enabled && lg.encounter == enc && lg.objective == ss.objective && !lg.clearChest)
                    rep.Line($"✓ 首领关流程停用，目标「{ss.objective.title}」完成后解锁：提示「{lg.lockedHint}」、横幅「{lg.wakeTitle} · {lg.wakeSub}」、目标栏「{lg.wakeObjective}」");
            }
            rep.Section("② 熔流闸（S4）· 熔泉（S3）· 引导灯（S6）");
            LevelKit.CheckLavaSluice(rep, ss.sluice);
            var gs = ss.geysers.Where(g => g).ToList();
            string gmsg = $"间歇熔泉（S3）{gs.Count} 口：周期 {string.Join(" / ", gs.Select(g => $"{g.period:F0} s @ {g.phase:F2}"))}，只在「{(gs.Count > 0 && gs[0].activeSite ? gs[0].activeSite.title : "?")}」交战时喷";
            if (gs.Count != GeyserSlots.Length || gs.Any(g => g.activeSite != ss.site2)) rep.Fail(gmsg);
            else rep.Line($"✓ {gmsg}");
            foreach (var g in gs)
                if (ss.sluice && ss.sluice.Covers(g.transform.position, 2f))
                    rep.Fail($"{g.name} 压在熔流闸的熔流道上");
            int lamps = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include).Count(t => t.name == LevelKit.GuideLampName);
            if (lamps < 8) rep.Fail($"青金引导灯只有 {lamps} 盏（主路岔口、场地出口、桥头）");
            else rep.Line($"✓ 青金引导灯 {lamps} 盏（主路岔口、场地出口、桥头；支路、交战场地里面不放）");
            rep.Line($"白盒（神道）：{sp.placeholders.Count} 个 —— {string.Join("、", sp.placeholders.Where(p => p).Select(p => p.name).Take(8))}");
        }

        /// <summary>地面站位离人形导航网格边缘至少这么远（米）：贴边的站位出生的怪容易卡边、被挤下网格</summary>
        const float AnchorEdgeMin = 1.5f;

        /// <summary>
        /// 站位离导航边缘：路遇、①、② 的地面站位（飞临的站位是飞行目的地，不查）离人形导航网格边缘 ≥ <see cref="AnchorEdgeMin"/> m。
        /// 11-07 的构建报告里 ② 的 Enemy_2_CrawlN 离边 0.0 m（压在熔流槽的槽壁上：槽壁 0.8 m 宽、0.6 m 深，最陡处超过 45° 烘不进导航，槽两侧一串小洞）
        /// </summary>
        static void CheckAnchorEdges(LevelKit.Report rep, ShrineSites ss)
        {
            var tight = new List<string>();
            int n = 0;
            float nearest = float.PositiveInfinity;
            string nearestName = "";
            foreach (var s in new[] { ss.roadside, ss.site1, ss.site2 })
            {
                if (!s) continue;
                foreach (var t in s.anchors)
                {
                    if (!t || SpawnAnchor.ModeOf(t) == SpawnMode.FlyIn) continue;
                    if (!LevelContext.NavPoint(t.position, 2.5f, out var p))
                    {
                        rep.Fail($"{s.title} / {t.name} {LevelContext.At(t.position)}：2.5 m 内没有导航网格");
                        continue;
                    }
                    n++;
                    if (!NavMesh.FindClosestEdge(p, out var edge, LevelContext.Walker)) continue;
                    if (edge.distance < nearest)
                    {
                        nearest = edge.distance;
                        nearestName = t.name;
                    }
                    if (edge.distance < AnchorEdgeMin) tight.Add($"{t.name} {LevelContext.At(p)} 离边 {edge.distance:F1} m（边在 {LevelContext.At(edge.position)}）");
                }
            }
            if (tight.Count > 0) rep.Fail($"地面站位离导航边缘不到 {AnchorEdgeMin} m：{string.Join("；", tight)}");
            else rep.Line($"✓ {n} 个地面站位离导航边缘都 ≥ {AnchorEdgeMin} m（最近：{nearestName} {nearest:F1} m）");
            // 第二波炭童的两个熔岩爬出站位要落在熔流道上（拉闸时机，见 BuildShrineSites）
            if (ss.site2 && ss.sluice)
                foreach (var t in ss.site2.anchors)
                    if (t && t.name.StartsWith("Enemy_2_CrawlN") && !ss.sluice.Covers(t.position))
                        rep.Fail($"{t.name} {LevelContext.At(t.position)} 不在熔流闸的熔流道上");
        }

        static Vector3 Flat3(Vector3 v) => new(v.x, 0, v.z);

        /// <summary>殿内连通（不算进关键路线）：入场点 → 东柱旁 → 神龛西祭台（坡道上去）→ 神龛前</summary>
        static void CheckHallLoop(LevelKit.Report rep, LevelKit.TerrainSet set)
        {
            rep.Section("殿内连通（不算进关键路线长度）");
            Vector3 G(Vector2 q) => set.OnGround(q.x, q.y);
            var pts = new[] { ("入场点", G(PlayerEntry)), ("东柱旁", G(new Vector2(15.5f, 6))), ("神龛西祭台", G(new Vector2(-PlatC.x, PlatC.y))), ("神龛前", G(ExitAt)) };
            float total = 0;
            for (int i = 0; i + 1 < pts.Length; i++)
            {
                if (!LevelContext.NavPoint(pts[i].Item2, 4f, out var a) || !LevelContext.NavPoint(pts[i + 1].Item2, 4f, out var b))
                {
                    rep.Fail($"路点不在 NavMesh 上：{pts[i].Item1} 或 {pts[i + 1].Item1}");
                    continue;
                }
                var st = LevelContext.NavPath(a, b, out float len);
                if (st != NavMeshPathStatus.PathComplete) rep.Fail($"{pts[i].Item1} → {pts[i + 1].Item1} 不连通（{st}）");
                else rep.Line($"✓ {pts[i].Item1} → {pts[i + 1].Item1}：{len:F0} m");
                total += len;
            }
            rep.Line($"殿内一圈 {total:F0} m");
        }

        /// <summary>灯：眺台火坛、① 山门门洞（炉火）、② 闸楼炉口、熔岩洞（金）、补给营（暖光，安静）；档位见 LevelKit.InfernoGlows，都不投影</summary>
        static void BuildShrineLights(LevelKit.TerrainSet set, Transform env)
        {
            var root = new GameObject("Lights · 神道").transform;
            root.SetParent(env, false);
            void Add(string name, Vector2 at, float dy, LevelKit.Ch3PointGlow glow, Color? color = null) =>
                LevelKit.Ch3PointLight(root, name, set.OnGround(at.x, at.y, dy), glow, color);
            var lamp = LevelKit.InfernoPalette.LampLight;
            Add("Overlook Altars", new Vector2(0, -218), 2.5f, LevelKit.InfernoGlows.Altar);
            Add("Gatehouse Glow", new Vector2(GatehouseC.x, -138), 4f, LevelKit.InfernoGlows.Gate);
            Add("Sluice Furnace", SluiceTowerAt + new Vector2(-3.5f, 0), 3f, LevelKit.InfernoGlows.Furnace);
            Add("Lava Cave", CacheAt + new Vector2(0, 2), 2.5f, LevelKit.InfernoGlows.Cave, lamp);
            Add("Camp Warm", CampAt + new Vector2(2, -2), 4.5f, LevelKit.InfernoGlows.Camp, lamp);
        }

        /// <summary>主线节拍（S5 PacingCheck）：出生 → 路遇 → ① → 山门俯瞰 → 熔岩洞岔口 → ② → 补给营 → 首领</summary>
        static void ShrineBeats(LevelSpec spec, Func<Vector2, float, Vector3> G)
        {
            spec.Beat("出生 · 火口远景", G(SpawnAt, 0), BeatKind.Reveal)
                .Beat("路遇 · 神道上段鸦群", G(RoadsideC, 0), BeatKind.Roadside, 11)
                .Beat("① 铜人神道", G(Site1C, 0), BeatKind.Fight, 18)
                .Beat("山门 · 俯瞰熔流闸口", G(LandingAt, 0), BeatKind.Reveal)
                .Beat("熔岩洞岔口（藏宝）", G(CaveFork, 0), BeatKind.Cache)
                .Beat("② 熔流闸口", G(Site2C + new Vector2(0, -6), 0), BeatKind.Fight, 18)
                .Beat("补给营", G(CampAt, 0), BeatKind.Supply, 10)
                .Beat("炉心殿 · 火麒麟", G(PlayerEntry, 0), BeatKind.Boss);
        }
    }
}
