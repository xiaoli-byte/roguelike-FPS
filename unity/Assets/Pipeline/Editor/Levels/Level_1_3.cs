using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-3 沉沙古城（docs/level-design/maps/1-3.md；unity-maps-v1.md §1-3；docs/unity-parity.md M13）：丝路古城被西北的沙山吞掉一角，
    /// 沙从被压断的城墙倒灌进城。关卡坐标 = 世界 XZ（米），城墙中线围出 200 × 180 m（x 10–210、z −10–170），城外西北 / 北侧还有一条
    /// 迎风积沙带（出生点在沙山上），沙带外缘是雅丹崖。地形 384 × 384 m，外缘 40 m 落回远景地面。
    ///
    ///   出生·沙山 (4,194) → ① 灌沙城门 (44,150)：沙山漫过西北墙角，城门楼只露出顶，沙扇一路泻到长街口
    ///   → ② 三路长街 (104,144)：墙头（8 m）/ 店铺背后的沙台（4 m，屋顶层）/ 街面沙舌（西高东低）三路并行，马道、巷口沙坡、城门沙扇互通
    ///   → ③ 集市井台 (162,100)：下沉 2 m 的圆广场 + 1 m 台阶环 + 四条坡道，东侧商铺台是俯射位
    ///   → ④ 寺院前庭 (100,70)：东侧巨像台（4 m）、西侧二层回廊、南面 3 m 台基与寺塔（全图地标）
    ///   → 补给营（台基上、寺塔背后的塔院，SupplyCamp + SafeZone + 商店）→ ⑤ 下行坑：贴坑壁绕半圈下到坑底，出口祭坛通往 1-4。
    /// ①–④ 必清、顺序不限；西南埋屋坊的藏宝点有一队守军（可选），北墙墙头还有一处无人看守的藏宝。
    ///
    /// 边界（D14，没有空气墙）：城内由四面城墙芯（地形，8 m 高、翻不上去）围住；北、西两面被沙埋的墙头能走，走出去是城外积沙带，
    /// 沙带外缘是崖顶 21–27 m 的雅丹崖（地形，比沙带高 16 m 以上，崖面 &gt; 75°）。北墙东段、西墙南段各有一处 ≥ 19 m 的断口，把能走的墙头和东、南两面翻不上去的墙隔开。
    /// 遮罩等值线外再由软边界（风沙推回、白化）与远处的兜底环收尾。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、场地与刷怪标记、遭遇、藏宝点、补给营、出口、自举标记 <see cref="LevelBootstrap"/>。
    /// 生成：Spiritfire ▸ Levels ▸ Build 1-3 沉沙古城（或 bridge.sh level 1-3）。
    /// </summary>
    [LevelBuilder("1-3", ScenePath)]
    public static class Level_1_3
    {
        public const string Dir = "Assets/Levels/L1_3_SunkenCity";
        public const string ScenePath = "Assets/Scenes/L1_3_SunkenCity.unity";
        const string Name = "L1_3";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（下行坑挖到 −10 也还在高度场范围内）；远景地面 y = FarY</summary>
        const float Base = 16f, HeightRange = 64f, FarY = 1f;
        static readonly Vector2 Origin = new(-84, -64), Size = new(384, 384);
        /// <summary>风吹去的方向：从西北偏北吹向东南偏南——北、西两面城墙是迎风面，沙山从西北压进城</summary>
        static readonly Vector2 Wind = new Vector2(0.6f, -0.8f).normalized;
        /// <summary>软边界（L3，D14）：等值线外起风推回、白化，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = LevelKit.BoundarySpec.Default;

        // ───────────── 城墙 ─────────────
        const float WallX0 = 10, WallX1 = 210, WallZ0 = -10, WallZ1 = 170;
        /// <summary>墙芯：高 8 m、顶宽 7 m（中线两侧各 3.5 m）、侧壁 1.2 m（≈ 81°）</summary>
        const float WallH = 8f, WallHalf = 3.5f, WallEdge = 1.2f;
        static readonly Vector2[] WallN = { new(WallX0, WallZ1), new(WallX1, WallZ1) };
        static readonly Vector2[] WallW = { new(WallX0, WallZ0), new(WallX0, WallZ1) };
        static readonly Vector2[] WallS = { new(WallX0, WallZ0), new(WallX1, WallZ0) };
        static readonly Vector2[] WallE = { new(WallX1, WallZ0), new(WallX1, WallZ1) };
        static readonly Vector2 CityMin = new(WallX0, WallZ0), CityMax = new(WallX1, WallZ1);
        /// <summary>北墙：墙头走道到 x 172，172–186 是塌下来的土坡，186–190.6 是缺口地面，191 以东墙芯陡起（墙头够不着）</summary>
        const float WalkNEnd = 172, RubbleNFoot = 186, SheerN0 = 190.6f, SheerN1 = 191.6f;
        /// <summary>西墙：墙头走道到 z 58，58–44 是土坡，44–40 是缺口地面，40 以南墙芯陡起</summary>
        const float WalkWEnd = 58, RubbleWFoot = 44, SheerW0 = 40.2f, SheerW1 = 39.2f;
        /// <summary>城墙立面件（SM_Tripo_DesertRampart，8 × 9 × 2.85 m）贴墙芯摆，前脸离中线 3.5 + 2.85 m</summary>
        const float FacadeDepth = 2.85f;
        const float FacadeFront = WallHalf + FacadeDepth;
        static readonly Vector3 RampartSize = new(7.97f, 9f, 2.85f);

        /// <summary>迎风积沙贴墙高度（北墙按 x）：西段漫过墙顶（8.8），往东渐退到只埋墙脚</summary>
        static float CrestN(float t) => LevelKit.Piecewise(Mathf.Lerp(WallX0, WallX1, t),
            new Vector2(10, 8.8f), new Vector2(66, 8.8f), new Vector2(110, 7.6f), new Vector2(150, 5f), new Vector2(172, 4f), new Vector2(210, 3f));

        /// <summary>迎风积沙贴墙高度（西墙按 z）：北段埋到垛口，南段只埋墙脚（断口以南 ≤ 3.5 m，墙头高出 4.5 m 以上）</summary>
        static float CrestW(float t) => LevelKit.Piecewise(Mathf.Lerp(WallZ0, WallZ1, t),
            new Vector2(-10, 2f), new Vector2(40, 3.5f), new Vector2(58, 5.5f), new Vector2(100, 7.8f), new Vector2(130, 8.8f), new Vector2(170, 8.8f));

        static readonly Func<float, float> CrestNFn = CrestN, CrestWFn = CrestW;

        // ───────────── 城外：沙山、积沙带、雅丹崖 ─────────────
        static readonly Vector2 MountainAt = new(-10, 204);
        const float MountainPeak = 15f, MountainR = 28f;
        /// <summary>出生点所在的西北沙坳（椭圆）</summary>
        static readonly Vector2 LobeAt = new(-6, 192), LobeR = new(30, 28);

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = new(4, 194), Gate = new(46, 170);
        static readonly Vector2 GateSite = new(44, 150), StreetSite = new(104, 144), Market = new(162, 100), Court = new(100, 70), Camp = new(100, 12);
        static readonly Vector2 Pagoda = new(100, 27);
        /// <summary>寺院台基：3 m，北面正中一条 10 m 宽的坡道 + 两侧台阶件，东面通往下行坑、西面通往埋屋坊各一条坡道；南边贴着南城墙</summary>
        static readonly Vector2 PlatformAt = new(100, 17), PlatformHalf = new(30, 23);
        const float PlatformH = 3f;
        static readonly (Vector2 foot, Vector2 top, float width)[] PlatformRamps =
        {
            (new Vector2(100, 54.5f), new Vector2(100, 40.3f), 10), (new Vector2(140.3f, 22), new Vector2(130.3f, 22), 6), (new Vector2(57.7f, 12), new Vector2(69.7f, 12), 6),
        };
        /// <summary>巨像台：4 m，巨像坐在东半，西半 6 m 宽的台面是前庭的俯射位，北面一条坡道</summary>
        static readonly Vector2 ColossusBase = new(122, 72), ColossusHalf = new(8, 9);
        const float ColossusBaseH = 4f;
        static readonly Vector2 ColossusAt = new(125.5f, 72);
        static readonly (Vector2 foot, Vector2 top) ColossusRamp = (new Vector2(116, 96), new Vector2(116, 81.3f));
        /// <summary>集市井台：井底半径 14 m（−2 m）、台阶环到 17.5 m（−1 m），四条坡道（北、西北、西南、东南偏东）从井底升到街面</summary>
        const float PlazaR = 14f, TerraceR = 17.5f, LaneR0 = 11f, LaneR1 = 20.5f, LaneHalf = 2.25f;
        static readonly float[] LaneAngles = { 90, 135, 225, 330 };
        /// <summary>集市东侧商铺台：2.2 m（比井底高 4.2 m，俯射层），北头一条坡道</summary>
        static readonly Vector2 MerchantTerrace = new(188, 106), MerchantHalf = new(5, 9);
        const float MerchantH = 2.2f;
        static readonly (Vector2 foot, Vector2 top) MerchantRamp = (new Vector2(188, 124.8f), new Vector2(188, 115.3f));
        /// <summary>下行坑（坑底古暗渠出城，通往鸣沙山月牙泉 · 1-4）：椭圆坑底 15 × 13 m、深 10 m，坑壁 6 m</summary>
        static readonly Vector2 Sink = new(164, 22), SinkR = new(15, 13);
        const float SinkDepth = 10f, SinkWall = 6f;
        static readonly Vector2 ShrineAt = new(154, 22);
        /// <summary>出口祭坛正面朝东（坡道从坑的东侧落到坑底）；传送门在门洞里，离祭坛中心沿正面 1.2 m</summary>
        const float ShrineYaw = 90, ExitDoorOffset = 1.2f;

        static readonly (Vector2 foot, Vector2 top, float width)[] NoRamps = Array.Empty<(Vector2, Vector2, float)>();

        // ───────────── 灌沙扇（扇顶 = 墙中线，往城里铺）─────────────
        static readonly (Vector2 a, Vector2 b, Vector2 into, float top, float lenA, float lenB, float power)[] Fans =
        {
            // 北墙西段：沙山漫过墙头，盖住城门，一直泻到长街口
            (new Vector2(WallX0, WallZ1), new Vector2(66, WallZ1), Vector2.down, 9f, 48, 24, 1.35f),
            // 西墙北段
            (new Vector2(WallX0, WallZ1), new Vector2(WallX0, 118), Vector2.right, 9f, 48, 20, 1.35f),
            // 西墙中段：埋屋坊这一侧的沙坡（直坡，接得上西墙墙头）
            (new Vector2(WallX0, 112), new Vector2(WallX0, 68), Vector2.right, 8.6f, 30, 30, 1f),
        };

        // ───────────── 长街：城门灌进来的沙舌（西高东低，一端埋到二层）─────────────
        static readonly PathSpline StreetPath = new PathSpline(new[]
            {
                new Vector2(30, 140), new Vector2(56, 136), new Vector2(90, 134), new Vector2(120, 133), new Vector2(146, 131), new Vector2(156, 127),
            })
            .WithHeights(new[] { 4.0f, 3.5f, 2.6f, 1.4f, 0.4f, 0.15f }, 4);
        const float StreetHalf = 10f, StreetShoulder = 10f;
        /// <summary>北排店铺之间的巷口（沙坡：街面 → 背后沙台）</summary>
        static readonly float[] AlleyX = { 86, 118, 142 };
        static readonly float[] AlleyFootH = AlleyX.Select(x => StreetPath.HeightAt(StreetPath.Nearest(new Vector2(x, 140)).t)).ToArray();
        /// <summary>北排店铺背后的沙台（屋顶层）：4 m，北接城墙，西接城门沙扇，东头一条沙坡下到东北坊</summary>
        const float BenchH = 4f;
        /// <summary>马道：沙台 → 北墙墙头（4 → 8 m，约 11°）</summary>
        static readonly (Vector2 foot, Vector2 top)[] Madao = { (new Vector2(98, 158.8f), new Vector2(118, 163.6f)), (new Vector2(146, 158.8f), new Vector2(166, 163.6f)) };

        // ───────────── 店铺 ─────────────
        const float ShopScale = 1.25f;
        /// <summary>北排（正面朝南）、南排（正面朝北）的店铺中心 x；南排在 86–106、122–134 留空，从长街望得见寺塔和巨像</summary>
        static readonly float[] NorthShops = { 70, 78, 94, 102, 110, 126, 134, 150, 158 }, SouthShops = { 66, 74, 82, 110, 118, 138 };
        const float NorthShopZ = 150 - 3.09f * ShopScale * 0.5f, SouthShopZ = 120.1f + 3.09f * ShopScale * 0.5f;

        // ───────────── 下行坑坡道：从坑口西北贴坑壁顺时针绕半圈落到坑底东南 ─────────────
        static readonly PathSpline SinkRamp = BuildSinkRamp();

        static PathSpline BuildSinkRamp()
        {
            var ctrl = new (float deg, float f, float h)[]
            {
                (160, 1.5f, 0), (125, 1.38f, -1.6f), (90, 1.27f, -3.3f), (55, 1.17f, -5f), (20, 1.08f, -6.7f), (-15, 0.99f, -8.4f), (-45, 0.86f, -9.7f),
            };
            var pts = ctrl.Select(c => Sink + new Vector2(Mathf.Cos(c.deg * Mathf.Deg2Rad) * SinkR.x * c.f, Mathf.Sin(c.deg * Mathf.Deg2Rad) * SinkR.y * c.f)).ToArray();
            return new PathSpline(pts, 6).WithHeights(ctrl.Select(c => c.h).ToArray(), 4);
        }

        static Vector2 SinkRampStart => SinkRamp.At(0);
        static Vector2 SinkRampEnd => SinkRamp.At(1);

        // ───────────── 地貌 ─────────────
        /// <summary>城里的原地面（世界 y ≈ 0，±0.3 m 起伏）：店铺、城墙立面件都摆在它上面，让积沙埋住脚</summary>
        static float Ground0(Vector2 p) => 0.3f * Fbm(p, 60, 3, 1) + 0.12f * Fbm(p, 14, 2, 2);

        /// <summary>某面墙在 p 处的墙芯高度（相对原地面）；f = 断口系数（1 = 完整，0 = 塌平），塌下来的部分侧壁变缓（土坡）</summary>
        static float Core(Vector2 p, Vector2[] wall, float f)
        {
            if (f <= 0) return 0;
            var (d, _) = Polyline(p, wall);
            float edge = WallEdge + (1 - f) * 4f;
            return WallH * f * (1 - Smooth(WallHalf, WallHalf + edge, d));
        }

        /// <summary>塌落土坡：从 top（1）到 foot（0）线性下降（两端稍缓）</summary>
        static float Rubble(float x, float top, float foot)
        {
            float u = Mathf.Clamp01((x - top) / (foot - top));
            return 1 - Mathf.Lerp(u, Smooth(0, 1, u), 0.3f);
        }

        static float WallNFactor(float x) => Mathf.Max(Rubble(x, WalkNEnd, RubbleNFoot), Smooth(SheerN0, SheerN1, x));
        static float WallWFactor(float z) => Mathf.Max(Rubble(z, WalkWEnd, RubbleWFoot), 1 - Smooth(SheerW1, SheerW0, z));

        static float WallCore(Vector2 p) =>
            Mathf.Max(Mathf.Max(Core(p, WallN, WallNFactor(Mathf.Clamp(p.x, WallX0, WallX1))), Core(p, WallW, WallWFactor(Mathf.Clamp(p.y, WallZ0, WallZ1)))),
                Mathf.Max(Core(p, WallS, 1), Core(p, WallE, 1)));

        /// <summary>
        /// 城外能走的积沙带（北墙外、西墙外、西北沙坳）的有符号距离（米，带内为负）：带子从墙中线算起（墙外半边算带里，崖不会长到墙头上），
        /// 外缘加 ±2.5 m 的噪声（贴墙的内缘不加）。雅丹崖就立在带外 0–3.5 m；可玩区遮罩也用它。
        /// </summary>
        static float ASdf(Vector2 p)
        {
            float d = Mathf.Min(Mathf.Min(LevelKit.BoxSdf(p, new Vector2(-30, 168), new Vector2(200, 196)), LevelKit.BoxSdf(p, new Vector2(-20, 34), new Vector2(12, 170))),
                LevelKit.EllipseSdf(p, LobeAt, LobeR));
            float far = Smooth(4, 12, Mathf.Max(0, LevelKit.BoxSdf(p, CityMin, CityMax)));
            return d + 2.5f * Fbm(p, 26, 2, 61) * far;
        }

        /// <summary>北排店铺背后的沙台遮罩（0–1）：南沿（z 146.5–149）藏在店铺里，东头 10 m 沙坡下到东北坊</summary>
        static float BenchMask(Vector2 p) =>
            Smooth(146.5f, 149, p.y) * Smooth(54, 60, p.x) * (1 - Smooth(168, 178, p.x)) * (1 - Smooth(WallZ1 - WallHalf, WallZ1, p.y));

        /// <summary>城里各坊的小沙垄（取最大值叠上去，不压平台、广场）：西南埋屋坊最厚，东北坊、东坊薄</summary>
        static float QuarterDunes(Vector2 p)
        {
            float sw = (1 - Smooth(0, 6, LevelKit.BoxSdf(p, new Vector2(16, -4), new Vector2(66, 116)))) * (1 - Disc(p, PlatformRamps[2].foot, 8, 6));
            float ne = 1 - Smooth(0, 5, LevelKit.BoxSdf(p, new Vector2(152, 120), new Vector2(196, 160)));
            float ea = 1 - Smooth(0, 4, LevelKit.BoxSdf(p, new Vector2(134, 46), new Vector2(198, 76)));
            float d = 0;
            if (sw > 0) d = Mathf.Max(d, Dunes(p, Wind, 20, 2.2f, 9, 0.76f) * sw);
            if (ne > 0) d = Mathf.Max(d, Dunes(p, Wind, 16, 1.2f, 10, 0.76f) * ne);
            if (ea > 0) d = Mathf.Max(d, Dunes(p, Wind, 16, 0.9f, 11, 0.76f) * ea);
            return d;
        }

        /// <summary>集市井台剖面（相对原地面）：井底 −2、台阶 −1、街面 0；坡道里按离中心的距离从 −2 升到 0。mask = 覆盖权重</summary>
        static float MarketProfile(Vector2 p, out float mask, out float lane)
        {
            var d = p - Market;
            float r = d.magnitude;
            mask = 1 - Smooth(18.6f, 20.5f, r);
            lane = 0;
            if (r > LaneR1 + 2) return 0;
            float prof = r < PlazaR ? -2 : r < PlazaR + 0.6f ? Mathf.Lerp(-2, -1, Smooth(PlazaR, PlazaR + 0.6f, r))
                : r < TerraceR ? -1 : Mathf.Lerp(-1, 0, Smooth(TerraceR, TerraceR + 0.6f, r));
            float laneProf = 0;
            foreach (float deg in LaneAngles)
            {
                var dir = new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad));
                float along = Vector2.Dot(d, dir);
                if (along < 0) continue;
                float side = Mathf.Abs(dir.x * d.y - dir.y * d.x);
                float m = (1 - Smooth(LaneHalf, LaneHalf + 1.25f, side)) * (1 - Smooth(LaneR1, LaneR1 + 1.5f, along));
                if (m <= lane) continue;
                lane = m;
                laneProf = Mathf.Lerp(-2, 0, Mathf.Clamp01((along - LaneR0) / (LaneR1 - LaneR0)));
            }
            mask = Mathf.Max(mask, lane);
            return Mathf.Lerp(prof, laneProf, lane);
        }

        static float Playable(Vector2 p)
        {
            float s = Mathf.Min(LevelKit.BoxSdf(p, new Vector2(WallX0 + FacadeFront, WallZ0 + FacadeFront), new Vector2(WallX1 - FacadeFront, WallZ1 - FacadeFront)), ASdf(p));
            // 能走的墙头（北墙到断口东壁、西墙到断口南壁）也在界内：敌人站墙头要有导航网格
            s = Mathf.Min(s, Mathf.Min(LevelKit.BoxSdf(p, new Vector2(WallX0, WallZ1 - 4.7f), new Vector2(SheerN0, WallZ1 + 4.7f)),
                LevelKit.BoxSdf(p, new Vector2(WallX0 - 4.7f, SheerW0), new Vector2(WallX0 + 4.7f, WallZ1))));
            return 1 - Smooth(0, 4, s);
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float g = Ground0(p);

            // ── 1. 墙外：迎风积沙（墙内侧是一道矮沙尾）、西北沙山、沙海 ──
            float driftN = SandDrift(p, WallN, Wind, CrestNFn, 30, 10, WallHalf, 31, out _);
            float driftW = SandDrift(p, WallW, Wind, CrestWFn, 30, 10, WallHalf, 32, out _);
            float distOut = Mathf.Max(0, LevelKit.BoxSdf(p, CityMin, CityMax));
            float sea = distOut > 0 ? (Dunes(p, Wind, 40, 3.6f, 5, 0.74f) + 0.8f) * Smooth(2, 16, distOut) : 0;
            float mountain = MountainPeak * Mathf.Exp(-(p - MountainAt).sqrMagnitude / (MountainR * MountainR));
            float outSand = Mathf.Max(Mathf.Max(driftN, driftW), Mathf.Max(mountain, sea));
            float h = g + outSand;

            // ── 2. 城墙芯（地形本身就是墙：东、南两面和断口另一侧翻不上去）──
            float core = WallCore(p);
            h = Mathf.Max(h, g + core);

            // ── 3. 灌沙扇：沙山把西北墙角压断，从墙头泻进城 ──
            float fan = 0;
            foreach (var f in Fans) fan = Mathf.Max(fan, LevelKit.SpillFan(p, f.a, f.b, f.into, f.top, f.lenA, f.lenB, f.power));
            h = Mathf.Max(h, g + fan);

            // ── 4. 各坊小沙垄 ──
            float dunes = QuarterDunes(p);
            h = Mathf.Max(h, g + dunes);

            // ── 5. 长街沙舌（只填）──
            h = StreetPath.Flatten(p, h, StreetHalf, StreetShoulder, PathSpline.Mode.FillOnly, out float streetMask);

            // ── 6. 沙台（屋顶层）、巷口沙坡、马道 ──
            float bench = BenchMask(p);
            if (bench > 0) h = Mathf.Max(h, g + BenchH * bench + 0.25f * bench * Fbm(p, 9, 2, 41));
            float rampSand = 0;
            for (int i = 0; i < AlleyX.Length; i++)
            {
                var (t, m) = Ramp(p, new Vector2(AlleyX[i], 140), new Vector2(AlleyX[i], 149.5f), 6, 2);
                if (m <= 0) continue;
                float target = Mathf.Lerp(AlleyFootH[i], g + BenchH, Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                rampSand = Mathf.Max(rampSand, m);
            }
            foreach (var (foot, top) in Madao)
            {
                var (t, m) = Ramp(p, foot, top, 5, 1.5f);
                if (m <= 0) continue;
                h = Mathf.Max(h, Mathf.Lerp(h, g + Mathf.Lerp(BenchH, WallH, t), m));
                rampSand = Mathf.Max(rampSand, m);
            }

            // ── 7. 集市井台（下沉广场 + 台阶 + 坡道）与东侧商铺台 ──
            float market = MarketProfile(p, out float marketMask, out _);
            if (marketMask > 0) h = Mathf.Lerp(h, g + market, marketMask);
            float mt = Plateau(p, MerchantTerrace, MerchantHalf, 0, MerchantH, 0.6f, NoRamps);
            float mtBase = Ground0(MerchantTerrace);
            if (mt > 0) h = Mathf.Max(h, Mathf.Lerp(g, mtBase + MerchantH, mt / MerchantH));
            {
                var (t, m) = Ramp(p, MerchantRamp.foot, MerchantRamp.top, 5, 1.2f);
                if (m > 0) h = Mathf.Max(h, Mathf.Lerp(h, Mathf.Lerp(g, mtBase + MerchantH, t), m));
            }

            // ── 8. 寺院：台基、巨像台与坡道 ──
            float pv = Plateau(p, PlatformAt, PlatformHalf, 0, PlatformH, 0.6f, NoRamps);
            float pBase = Ground0(PlatformAt);
            if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(g, pBase + PlatformH, pv / PlatformH));
            foreach (var (foot, top, width) in PlatformRamps)
            {
                var (t, m) = Ramp(p, foot, top, width, 1.5f);
                if (m > 0) h = Mathf.Max(h, Mathf.Lerp(h, Mathf.Lerp(g, pBase + PlatformH, t), m));
            }
            float cb = Plateau(p, ColossusBase, ColossusHalf, 0, ColossusBaseH, 0.6f, NoRamps);
            float cBase = Ground0(ColossusBase);
            if (cb > 0) h = Mathf.Max(h, Mathf.Lerp(g, cBase + ColossusBaseH, cb / ColossusBaseH));
            {
                var (t, m) = Ramp(p, ColossusRamp.foot, ColossusRamp.top, 4.5f, 1.2f);
                if (m > 0) h = Mathf.Max(h, Mathf.Lerp(h, Mathf.Lerp(g, cBase + ColossusBaseH, t), m));
            }

            // ── 9. 下行坑（坑底古暗渠出城，通往鸣沙山月牙泉 · 1-4）+ 贴壁坡道 ──
            var sd = p - Sink;
            float rn = Mathf.Sqrt(sd.x * sd.x / (SinkR.x * SinkR.x) + sd.y * sd.y / (SinkR.y * SinkR.y));
            float sinkFloor = 0, sinkWall = 0, sinkRampMask = 0;
            if (rn < 2.2f)
            {
                float bowl = CaveBowl(p, Sink, SinkR, SinkDepth, SinkWall, 0.8f, 4, 7, out sinkFloor, out sinkWall);
                // 叠加（不是插值）：坑口外沿只多一道矮唇，不抹掉台基东坡道的坡脚
                h += bowl * (1 - Smooth(1.8f, 2.1f, rn));
                h = SinkRamp.Flatten(p, h, 3.2f, 3f, PathSpline.Mode.Both, out sinkRampMask);
            }

            // ── 10. 城外雅丹崖：积沙带外 0–3.5 m 立起崖顶 21–27 m 的崖（翻不上去），往外 30–60 m 落回沙海 ──
            float dA = ASdf(p);
            float rock = 0;
            if (dA > 0)
            {
                float inRect = 1 - Smooth(0, 0.6f, LevelKit.BoxSdf(p, CityMin, CityMax));
                float cliff = Smooth(0, 3.5f, dA) * (1 - Smooth(30, 60, dA)) * (1 - inRect);
                if (cliff > 0)
                {
                    float rim = 21 + 6 * Disc(p, MountainAt, 40, 40) + 2 * Fbm(p, 40, 2, 51) + Dunes(p, Wind, 30, 3, 71) * Smooth(8, 16, dA);
                    h = Mathf.Lerp(h, Mathf.Max(h, g + rim), cliff);
                    rock = Smooth(0, 1, cliff) * (1 - Smooth(10, 24, dA));
                }
            }

            // ── 11. 地形外缘 40 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY, h, Smooth(0, 40, edgeDist));
            s.h = Base + h;

            // ── 分层倾向 ──
            float walkTop = Smooth(7.2f, 7.9f, core) * (1 - Smooth(0.3f, 1.2f, Mathf.Max(outSand, fan) - core));
            float court = 1 - Smooth(0, 3, LevelKit.BoxSdf(p, new Vector2(72, 42), new Vector2(132, 98)));
            float platTop = Mathf.Max(Smooth(PlatformH - 0.5f, PlatformH - 0.1f, pv), Mathf.Max(Smooth(ColossusBaseH - 0.5f, ColossusBaseH - 0.1f, cb),
                Smooth(MerchantH - 0.4f, MerchantH - 0.1f, mt)));
            s.packed = Mathf.Max(Mathf.Max(walkTop * 0.9f, marketMask * 0.95f), Mathf.Max(Mathf.Max(court * 0.8f, platTop), Mathf.Max(sinkRampMask * 0.9f, sinkFloor * 0.6f)));
            float sandy = Mathf.Max(Mathf.Max(Smooth(0.4f, 2f, outSand) * (1 - walkTop), Smooth(0.3f, 1.5f, fan)), Mathf.Max(Smooth(0.4f, 1.4f, dunes) * 0.9f,
                Mathf.Max(streetMask * 0.9f, Mathf.Max(bench, rampSand * 0.9f))));
            float patches = 0.45f * Smooth(0.2f, 0.55f, Fbm(p, 24, 3, 7) * 0.5f + 0.5f);
            s.sand = Mathf.Max(sandy, patches) * (1 - Mathf.Max(court * 0.7f, marketMask)) * (1 - platTop) * (1 - sinkRampMask);
            s.rock = Mathf.Max(rock, sinkWall * 0.6f);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-3 沉沙古城", priority = 62)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 软边界 → 烘焙 NavMesh → 验收（L5 规则集）→ 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var arch = new GameObject("Architecture").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                ground = LevelKit.Ground.Desert, eval = Eval,
            }, env);

            // 远景：沙丘 + 两圈赭红台地；地形外的远景地面在雾里接上环脚；西北方向两座雅丹「舰队」剪影（来路 1-2）
            var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(110, 90), FarY - 0.5f, 760, 3);
            LevelKit.Backdrop(backdrop, env);
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY - 0.05f, theme.groundA);
            LevelKit.BackdropImpostor(backdrop, "SM_Tripo_DesertYardangFleet", env, new Vector3(-150, FarY - 2, 390), 210, 2.4f, 0.45f);
            LevelKit.BackdropImpostor(backdrop, "SM_Tripo_DesertYardangFleet", env, new Vector3(30, FarY - 2, 460), 200, 2.8f, 0.55f);

            // 软边界（没有空气墙）：城内靠城墙芯、城外积沙带靠雅丹崖，等值线外风沙推回 + 兜底环
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            // 天气：西北盛行风，常态风力 0.3（沙从墙头扬下来）；本图不设区域风暴（动态环境留给 1-1 沙暴、1-2 流沙）
            LevelKit.Weather(env, theme, Wind, 0.3f);

            BuildWalls(set, arch);
            BuildGate(set, arch, props);
            BuildStreet(set, arch, props);
            BuildMarket(set, arch, props);
            BuildTemple(set, arch, props);
            BuildQuarters(set, arch, props);
            BuildOutside(set, env, props);
            BuildScatter(set, env);
            var shrine = BuildSink(set, arch, props);
            BuildMarkers(set, markers);

            // 玩家、HUD、各系统都在 Core 场景（L1）：这里只放出生标记 + 自举标记
            var spawnAt = set.OnGround(Spawn.x, Spawn.y, 0.05f);
            var pagodaTop = set.OnGround(Pagoda.x, Pagoda.y, 18);
            var spawnRot = Quaternion.LookRotation(Flat(pagodaTop - spawnAt));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            var objective = BuildEncounters(set, markers);
            BuildCaches(set, markers, objective);
            var camp = BuildSupplyCamp(set, markers);
            // 出口传送门：嵌在坑底出口祭坛的门洞里，四个必清场地肃清后升起、落清关宝箱（RunPlan 1-3 的 clearReward）；下一关读 RunPlan = 1-4
            ExitPortal portal = null;
            {
                var face = shrine ? shrine.transform.forward : Quaternion.Euler(0, ShrineYaw, 0) * Vector3.forward;
                face.y = 0;
                face.Normalize();
                portal = new GameObject("Exit Portal").AddComponent<ExitPortal>();
                portal.transform.SetParent(markers, false);
                portal.transform.SetPositionAndRotation(set.OnGround(ShrineAt.x + face.x * ExitDoorOffset, ShrineAt.y + face.z * ExitDoorOffset), Quaternion.LookRotation(-face));
                portal.objective = objective;
                portal.buildFrame = !shrine;
            }

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("1-3 沉沙古城 · 验收");
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            rep.Line($"北墙墙头 y = {set.GroundY(130, WallZ1):F1}，沙台 y = {set.GroundY(108, 156):F1}，长街西口 / 东口 y = {set.GroundY(60, 134):F1} / {set.GroundY(146, 131):F1}");
            rep.Line($"井底 y = {set.GroundY(Market.x - 6, Market.y):F1}，商铺台 y = {set.GroundY(MerchantTerrace.x, MerchantTerrace.y):F1}，台基 y = {set.GroundY(Camp.x, Camp.y):F1}，" +
                     $"巨像台 y = {set.GroundY(117, ColossusBase.y):F1}，坑底 y = {set.GroundY(Sink.x, Sink.y):F1}（下行坡道最陡 {SinkRamp.MaxGrade():F0}°）");
            rep.Line($"断口：北墙走道端 y = {set.GroundY(WalkNEnd - 1, WallZ1):F1} / 东壁 y = {set.GroundY(SheerN1 + 2, WallZ1):F1}；" +
                     $"西墙走道端 y = {set.GroundY(WallX0, WalkWEnd + 1):F1} / 南壁 y = {set.GroundY(WallX0, SheerW1 - 2):F1}");
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线 + L5 规则集，见文件末尾的 Spec
            CheckSceneContents(rep, scene, camp, portal);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_1-3_report.txt");

            if (review)
            {
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_1-3", new[]
                    {
                        ("Aerial", new Vector3(-40, 150, -60), new Vector3(110, 0, 90), false),
                        ("Map", new Vector3(100, 380, 89), new Vector3(100, 0, 90), false),
                        ("Spawn", E(Spawn), pagodaTop, true),
                        ("GateFan", E(new Vector2(30, 160)), G(new Vector2(70, 132), 2), false),
                        ("StreetWest", E(new Vector2(66, 134)), G(new Vector2(130, 134), 2), false),
                        ("StreetPagoda", E(new Vector2(100, 136)), pagodaTop, false),
                        ("Walkway", E(new Vector2(84, WallZ1)), G(new Vector2(150, 160), 3), false),
                        ("Bench", E(new Vector2(92, 156)), G(new Vector2(140, 150), 2), false),
                        ("Market", E(new Vector2(147, 115)), G(Market, 0), false),
                        ("MarketTerrace", E(new Vector2(189, 108)), G(new Vector2(150, 92), 0), false),
                        ("Forecourt", E(new Vector2(100, 100)), pagodaTop - Vector3.up * 6, false),
                        ("ColossusBase", E(new Vector2(117, 76)), G(new Vector2(84, 60), 1), false),
                        ("Camp", E(new Vector2(113, 19)), G(Camp, 1), false),
                        ("SinkRim", E(SinkRampStart), G(Sink, 0), false),
                        ("SinkFloor", E(new Vector2(166, 22)), G(ShrineAt, 3), false),
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

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v : Vector3.forward;
        }

        /// <summary>
        /// L1 规则：关卡场景只有环境和标记——一个 PlayerSpawn、一个自举标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录；
        /// 另查 1-3 自己的件：补给营（SupplyCamp + SafeZone，安全区盖住商店弧）、出口传送门。顺带重新生成 GameDatabase。
        /// </summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, SupplyCamp camp, ExitPortal portal)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>();
            int boots = Count<LevelBootstrap>();
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

            int camps = Count<SupplyCamp>(), zones = Count<SafeZone>(), portals = Count<ExitPortal>(), caches = Count<CachePOI>();
            var zone = camp ? camp.GetComponent<SafeZone>() : null;
            if (camps != 1 || !zone) rep.Fail($"补给营 {camps} 个、安全区 {zones} 个（应各 1，安全区挂在补给营上）");
            else if (zone.radius < ShopLayout.ArcRadius + ShopLayout.CounterFront + 1f) rep.Fail($"安全区半径 {zone.radius:F1} m 盖不住商店弧（{ShopLayout.ArcRadius} m）和顾客站位");
            else rep.Line($"✓ 补给营「{camp.label}」：安全区半径 {zone.radius:F0} m，开店 {camp.openShop}（运行时 Shop.Spawn，摊位按 ShopLayout 排在营地中心后方 {ShopLayout.ArcRadius} m 的弧上）");
            if (portals != 1 || !portal || !portal.objective) rep.Fail($"出口传送门 {portals} 个（应 1，且接上 LevelObjective）");
            else rep.Line($"✓ 出口传送门在坑底，接关卡目标（必清 {portal.objective.required.Length} 处，可选 {portal.objective.optional.Length} 处）；下一关 {RunPlan.Next(RunPlan.Get("1-3"))?.Label ?? "?"}");
            rep.Line($"藏宝点 {caches} 处");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        // ───────────── 摆放 ─────────────
        /// <summary>按 id 摆到地形上（底面往下埋 sink × scale）；缺 Prefab 时放 size × scale 的占位白盒（验收会列出来）</summary>
        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, Vector3? size = null)
        {
            var go = LevelKit.PlaceOrBox(id, parent, set.OnGround(at.x, at.y, -sink * scale), (size ?? new Vector3(3, 3, 3)) * scale, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>摆在原地面上（不随积沙抬高）：城墙立面、店铺、城门——让沙子埋住它们的脚，同一批资产就是「半埋」的样子</summary>
        static GameObject PutOnGround0(string id, Transform parent, Vector2 at, float yaw, float scale, float sink, Vector3 size)
        {
            var go = LevelKit.PlaceOrBox(id, parent, new Vector3(at.x, Ground0(at) - sink, at.y), size * scale, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        static float YawToward(Vector2 from, Vector2 to) => Mathf.Atan2(to.x - from.x, to.y - from.y) * Mathf.Rad2Deg;

        static void BuildWalls(LevelKit.TerrainSet set, Transform arch)
        {
            // 城墙芯是地形（夯土层理，侧壁按坡度上岩石层）；看得见的墙面贴 Rampart 立面件（摆在原地面上，被沙埋住的部分自然埋掉）。
            // 立面件只贴城里看得见的一面：东、南两面的内侧，北墙沙台段的内侧、北墙东段与西墙中段露出来的外侧（城外积沙带看得见）。
            var root = new GameObject("City Walls").transform;
            root.SetParent(arch, false);
            float BaseY(Vector2 c) => Ground0(c) - 0.3f;
            string[] kit = { "SM_Tripo_DesertRampart", "SM_Tripo_DesertRampartPlain", "SM_Tripo_DesertRampart" };
            void Row(string name, Vector2 a, Vector2 b, Vector2 facing)
            {
                var row = new GameObject(name).transform;
                row.SetParent(root, false);
                foreach (var go in LevelKit.FacadeRow(row, a, b, facing, BaseY, RampartSize, 1f, kit)) go.isStatic = true;
            }
            float inner = FacadeDepth * 0.5f + WallHalf;
            // 东墙、南墙内侧（整面）
            Row("East Wall · Inner", new Vector2(WallX1 - inner, WallZ0 + 6), new Vector2(WallX1 - inner, WallZ1 - 6), Vector2.left);
            Row("South Wall · Inner", new Vector2(WallX0 + 6, WallZ0 + inner), new Vector2(WallX1 - 6, WallZ0 + inner), Vector2.up);
            // 北墙内侧：沙台段（马道两处留空，露出夯土墙芯），断口以东
            Row("North Wall · Inner A", new Vector2(66, WallZ1 - inner), new Vector2(94, WallZ1 - inner), Vector2.down);
            Row("North Wall · Inner B", new Vector2(122, WallZ1 - inner), new Vector2(140, WallZ1 - inner), Vector2.down);
            Row("North Wall · Inner East", new Vector2(SheerN1 + 1, WallZ1 - inner), new Vector2(WallX1 - 6, WallZ1 - inner), Vector2.down);
            // 北墙外侧（积沙退到墙脚的东段）、西墙外侧（断口以北、积沙还没埋到垛口的一段）、西墙内侧（埋屋坊南段）
            Row("North Wall · Outer", new Vector2(124, WallZ1 + inner), new Vector2(WalkNEnd, WallZ1 + inner), Vector2.up);
            Row("West Wall · Outer", new Vector2(WallX0 - inner, WalkWEnd + 1), new Vector2(WallX0 - inner, 92), Vector2.left);
            Row("West Wall · Inner South", new Vector2(WallX0 + inner, WallZ0 + 6), new Vector2(WallX0 + inner, SheerW1 - 1), Vector2.right);

            // 角楼：东南、西南、东北（西北角埋在沙山下）
            foreach (var (c, yaw) in new[] { (new Vector2(WallX1, WallZ0), 0f), (new Vector2(WallX0, WallZ0), 0f), (new Vector2(WallX1, WallZ1), 0f) })
                PutOnGround0("SM_Tripo_DesertCornerTower", root, c, yaw, 1f, 0.3f, new Vector3(7.4f, 13, 5.3f));

            // 北墙墙头外沿的垛口（低掩体），沙台段的墙头上走得到
            var parapets = new GameObject("Walkway Parapets").transform;
            parapets.SetParent(root, false);
            foreach (float x in new[] { 72f, 74f, 90f, 92f, 106f, 108f, 140f, 142f })
                Put("SM_Tripo_DesertBeaconParapet", parapets, set, new Vector2(x, WallZ1 + WallHalf - 0.5f), 0, 1.2f, 0.1f, new Vector3(1.9f, 1.1f, 0.4f));
        }

        static void BuildGate(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            // ① 灌沙城门：城门楼摆在原地面上，被沙扇埋到只剩楼顶；沙坡上的大车残骸、塌柱、半埋塔刹是掩体
            var root = new GameObject("① Gate").transform;
            root.SetParent(arch, false);
            PutOnGround0("SM_Tripo_DesertGateway", root, Gate, 0, 1f, 0.2f, new Vector3(13.5f, 11, 4));
            var wreckA = Put("SM_Tripo_DesertCaravanWreck", props, set, new Vector2(30, 150), 20, 1.4f, 0.25f, new Vector3(3.8f, 1.8f, 4));
            var wreckB = Put("SM_Tripo_DesertCaravanWreck", props, set, new Vector2(58, 140), -50, 1.3f, 0.25f, new Vector3(3.8f, 1.8f, 4));
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(50, 156), 15, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(30, 136), 40, 1f, 0.2f, new Vector3(4.2f, 1.6f, 3.4f));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(40, 134), 10, 1.2f, 0.15f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Tripo_DesertFinial", props, set, new Vector2(22, 158), 25, 1f, 1.2f, new Vector3(2.5f, 5.5f, 2.3f));
            if (wreckA) wreckA.name = "Caravan Wreck (gate)";
            if (wreckB) wreckB.name = "Caravan Wreck (street mouth)";
        }

        static void BuildStreet(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            // ② 三路长街：两排二层店铺（摆在原地面上，西头被沙舌埋到二层）、店铺背后沙台上露出的埋屋屋顶、街面的摊位与货堆
            var root = new GameObject("② Street").transform;
            root.SetParent(arch, false);
            var shopSize = new Vector3(6.32f, 8, 3.09f);
            foreach (float x in NorthShops) PutOnGround0("SM_Tripo_DesertShopHouse", root, new Vector2(x, NorthShopZ), 180, ShopScale, 0.1f, shopSize);
            foreach (float x in SouthShops) PutOnGround0("SM_Tripo_DesertShopHouse", root, new Vector2(x, SouthShopZ), 0, ShopScale, 0.1f, shopSize);
            // 沙台上：被沙埋到屋面的平顶土坯房（屋面与沙台齐平，屋顶小间露出来当掩体）
            foreach (var (at, yaw) in new[] { (new Vector2(76, 156), 5f), (new Vector2(130, 156), -8f) })
            {
                var house = LevelKit.PlaceOrBox("SM_Tripo_DesertBuriedRoofFlat", root, new Vector3(at.x, Ground0(at) + BenchH - 2.0f * 1.4f, at.y), new Vector3(3.6f, 3.6f, 3.9f) * 1.4f, yaw, 1.4f);
                if (house) house.isStatic = true;
            }
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(88, 157), 5, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            // 街面：摊位、货堆、拒马、陶罐（中线留空，长街望得到东口）
            Put("SM_Tripo_DesertMarketStall", props, set, new Vector2(90, 141), 180, 1f, 0.15f, new Vector3(3.7f, 3.6f, 2.2f));
            Put("SM_Tripo_DesertMarketStall", props, set, new Vector2(122, 127.5f), 0, 1f, 0.15f, new Vector3(3.7f, 3.6f, 2.2f));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(76, 128), 30, 1.2f, 0.15f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(132, 141), -20, 1.2f, 0.15f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Tripo_DesertBarricade", props, set, new Vector2(98, 129), 5, 1f, 0.15f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Prop_DesertUrns", props, set, new Vector2(112, 141), 0, 1.2f, 0.1f, new Vector3(0.8f, 0.8f, 0.8f));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(84, 142), 70, 1f, 0.2f, new Vector3(4.2f, 1.6f, 3.4f));
        }

        static void BuildMarket(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            // ③ 集市井台：井亭在正中（放大 2 倍：井台 1 m），台阶环上一圈摊位朝里，井底散放货堆与拒马，坑沿三座店铺朝里，东侧商铺台
            var root = new GameObject("③ Market").transform;
            root.SetParent(arch, false);
            Put("SM_Tripo_DesertWell", root, set, Market, 0, 2f, 0.05f, new Vector3(2.8f, 3.4f, 2.5f));
            foreach (float deg in new[] { 20f, 55f, 112f, 165f, 255f, 290f })
            {
                var at = Market + new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad)) * 16.05f;
                Put("SM_Tripo_DesertMarketStall", root, set, at, YawToward(at, Market), 1f, 0.1f, new Vector3(3.7f, 3.6f, 2.2f));
            }
            foreach (float deg in new[] { 60f, 165f, 300f })
            {
                var at = Market + new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad)) * 25.5f;
                Put("SM_Tripo_DesertShopHouse", root, set, at, YawToward(at, Market), ShopScale, 0.1f, new Vector3(6.32f, 8, 3.09f));
            }
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(156, 107), 15, 1.3f, 0.1f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(171, 94), -40, 1.3f, 0.1f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Tripo_DesertBarricade", props, set, new Vector2(154, 88), -30, 1f, 0.1f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Tripo_DesertBarricade", props, set, new Vector2(170, 106), 60, 1f, 0.1f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Prop_DesertUrns", props, set, new Vector2(166, 108), 0, 1.2f, 0.1f, new Vector3(0.8f, 0.8f, 0.8f));
            // 商铺台沿口的矮墙 + 货堆
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(184.5f, 104), 90, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(191, 101), 0, 1.2f, 0.1f, new Vector3(1.7f, 1.6f, 1.3f));
        }

        static void BuildTemple(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            // ④ 寺院前庭 + 台基：西侧一排二层回廊，东侧巨像台上坐着沙王巨像，正中两对香炉、两通龟趺碑，台基正面坡道两侧各一段台阶件；
            // 台基上寺塔居中，塔两侧的回廊挡住前庭望向塔院（补给营）的视线
            var root = new GameObject("④ Temple").transform;
            root.SetParent(arch, false);
            float top = Ground0(PlatformAt) + PlatformH;
            var cloisterSize = new Vector3(6.17f, 7.5f, 2.85f);
            float BaseY(Vector2 c) => Ground0(c) - 0.1f;
            float TopY(Vector2 c) => top - 0.1f;
            var west = new GameObject("West Cloister").transform;
            west.SetParent(root, false);
            LevelKit.FacadeRow(west, new Vector2(74, 48), new Vector2(74, 93), Vector2.right, BaseY, cloisterSize, 1.2f, "SM_Tripo_DesertCloister");
            var rear = new GameObject("Platform Cloisters").transform;
            rear.SetParent(root, false);
            LevelKit.FacadeRow(rear, new Vector2(74.8f, 30), new Vector2(89.7f, 30), Vector2.up, TopY, cloisterSize, 1.2f, "SM_Tripo_DesertCloister");
            LevelKit.FacadeRow(rear, new Vector2(110.3f, 30), new Vector2(125.2f, 30), Vector2.up, TopY, cloisterSize, 1.2f, "SM_Tripo_DesertCloister");

            var pagoda = LevelKit.PlaceOrBox("SM_Tripo_DesertTemplePagoda", root, new Vector3(Pagoda.x, top - 0.2f, Pagoda.y), new Vector3(9.9f, 22.2f, 10.1f), 0);
            if (pagoda) pagoda.isStatic = true;
            var colossus = LevelKit.PlaceOrBox("SM_Tripo_DesertSeatedColossus", root, new Vector3(ColossusAt.x, Ground0(ColossusBase) + ColossusBaseH - 0.2f, ColossusAt.y),
                new Vector3(12, 20, 9.8f), -90);
            if (colossus) colossus.isStatic = true;

            Put("SM_Prop_DesertIncenseBurner", props, set, new Vector2(100, 35.5f), 0, 1.4f, 0.05f, new Vector3(1.3f, 2.6f, 1.2f));
            Put("SM_Prop_DesertIncenseBurner", props, set, new Vector2(94, 60), 0, 1.3f, 0.05f, new Vector3(1.3f, 2.6f, 1.2f));
            Put("SM_Prop_DesertIncenseBurner", props, set, new Vector2(106, 60), 0, 1.3f, 0.05f, new Vector3(1.3f, 2.6f, 1.2f));
            Put("SM_Prop_DesertStele", props, set, new Vector2(86, 48), 0, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            Put("SM_Prop_DesertStele", props, set, new Vector2(114, 48), 0, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            foreach (float x in new[] { 86f, 114f })
                PutOnGround0("SM_Tripo_DesertStairs", root, new Vector2(x, PlatformAt.y + PlatformHalf.y + 1.6f), 0, 1f, 0.02f, new Vector3(3.6f, 3, 3.2f));
            foreach (var at in new[] { new Vector2(74, 37), new Vector2(126, 37), new Vector2(91, 16), new Vector2(109, 16) })
                Put("SM_Tripo_DesertBrazier", props, set, at, 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(88, 82), -20, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(106, 92), 10, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(90, 68), 30, 1f, 0.2f, new Vector3(4.2f, 1.6f, 3.4f));
            // 塔院（补给营）：两侧货堆、陶罐（不进商店弧和顾客站位）
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(87, 21), 20, 1.2f, 0.1f, new Vector3(1.7f, 1.6f, 1.3f));
            Put("SM_Prop_DesertUrns", props, set, new Vector2(113, 21), 0, 1.2f, 0.1f, new Vector3(0.8f, 0.8f, 0.8f));
        }

        static void BuildQuarters(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            // 西南埋屋坊：沙垄里露出屋顶的民居、殿堂与塔刹；东坊、东北坊：残墙、半埋平顶房、货堆
            var root = new GameObject("Quarters").transform;
            root.SetParent(arch, false);
            var roofs = new (string id, Vector2 at, float yaw, float scale, float sink)[]
            {
                ("SM_Tripo_DesertBuriedRoofHall", new Vector2(26, 98), 15, 1.4f, 1.8f),
                ("SM_Tripo_DesertBuriedRoofHouse", new Vector2(52, 102), -12, 1.4f, 1.6f),
                ("SM_Tripo_DesertBuriedRoofFlat", new Vector2(22, 52), 5, 1.6f, 1.2f),
                ("SM_Tripo_DesertBuriedRoofHouse", new Vector2(60, 34), 80, 1.4f, 1.6f),
                ("SM_Tripo_DesertBuriedRoofHall", new Vector2(32, 20), -20, 1.4f, 1.8f),
                ("SM_Tripo_DesertBuriedRoofFlat", new Vector2(44, 8), 30, 1.6f, 1.2f),
                ("SM_Tripo_DesertBuriedRoofFlat", new Vector2(194, 54), 10, 1.5f, 1.4f),
                ("SM_Tripo_DesertBuriedRoofHouse", new Vector2(170, 142), 15, 1.4f, 1.6f),
            };
            foreach (var (id, at, yaw, scale, sink) in roofs) Put(id, root, set, at, yaw, scale, sink / scale, new Vector3(4.5f, 4.5f, 3.5f));
            Put("SM_Tripo_DesertFinial", props, set, new Vector2(26, 72), 60, 1f, 1.5f, new Vector3(2.5f, 5.5f, 2.3f));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(46, 86), -15, 1f, 0.2f, new Vector3(4.2f, 1.6f, 3.4f));
            var wall = new Vector3(4.9f, 3.2f, 1f);
            Put("SM_Tripo_DesertPosthouseWall", props, set, new Vector2(146, 62), 30, 1f, 0.2f, wall);
            Put("SM_Tripo_DesertPosthouseWall", props, set, new Vector2(186, 66), -15, 1f, 0.2f, wall);
            Put("SM_Tripo_DesertPosthouseWall", props, set, new Vector2(186, 150), 90, 1f, 0.2f, wall);
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(160, 56), 70, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(192, 128), 0, 1f, 0.3f, new Vector3(4.9f, 2.6f, 1));
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(178, 134), 0, 1.2f, 0.1f, new Vector3(1.7f, 1.6f, 1.3f));
        }

        static void BuildOutside(LevelKit.TerrainSet set, Transform env, Transform props)
        {
            // 城外：出生点背后半埋在沙山里的岩拱（1-2 的出口，来路；埋下 5 m，拱顶离崖顶还有近 10 m，不当梯子）、积沙带上几座小雅丹
            var root = new GameObject("Outside").transform;
            root.SetParent(env, false);
            Put("SM_Tripo_DesertRockArch", root, set, new Vector2(-8, 213), 170, 1f, 5f, new Vector3(15.7f, 13, 6.6f));
            foreach (var (at, yaw, scale) in new[] { (new Vector2(60, 190), 30f, 1.3f), (new Vector2(130, 188), 15f, 1.2f), (new Vector2(-12, 120), 100f, 1.3f) })
                Put("SM_Tripo_DesertYardangSmall", root, set, at, yaw, scale, 0.4f, new Vector3(3.8f, 4, 5.7f));
        }

        static void BuildScatter(LevelKit.TerrainSet set, Transform env)
        {
            // 散布：砾石、骆驼刺、红柳避开街面、广场、台基、墙头和坑；巨砾只撒在城外积沙带（不贴墙、不挡出生点）
            float Clear(Vector2 p)
            {
                float d = StreetPath.Nearest(p, 30).dist - StreetHalf * 0.6f;
                d = Mathf.Min(d, LevelKit.BoxSdf(p, new Vector2(70, 40), new Vector2(132, 98)));
                d = Mathf.Min(d, LevelKit.BoxSdf(p, PlatformAt - PlatformHalf, PlatformAt + PlatformHalf));
                d = Mathf.Min(d, LevelKit.BoxSdf(p, ColossusBase - ColossusHalf, ColossusBase + ColossusHalf));
                d = Mathf.Min(d, Vector2.Distance(p, Market) - 21);
                d = Mathf.Min(d, LevelKit.BoxSdf(p, MerchantTerrace - MerchantHalf, MerchantTerrace + MerchantHalf));
                d = Mathf.Min(d, LevelKit.EllipseSdf(p, Sink, SinkR * 1.6f));
                d = Mathf.Min(d, Mathf.Abs(p.y - WallZ1) - WallHalf - 1);
                d = Mathf.Min(d, Mathf.Abs(p.x - WallX0) - WallHalf - 1);
                return Mathf.Max(0, d);
            }
            var counts = LevelKit.ScatterDetails(set, LevelKit.ScatterPresets.Details("Desert"), Clear, 1f, 180f);
            var boulders = LevelKit.ScatterPresets.Boulders("Desert");
            var where = boulders.where;
            boulders.where = pt => (where?.Invoke(pt) ?? 1) * (ASdf(pt.p) < -2 ? 1 : 0) * Smooth(6, 10, LevelKit.BoxSdf(pt.p, CityMin, CityMax))
                                   * (1 - Disc(pt.p, Spawn, 8, 4));
            var big = LevelKit.ScatterProps(set, env, boulders, new Rect(-40, 30, 250, 200), 9f, Clear);
            Debug.Log($"[Level] 1-3 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}；城外巨砾 {big.Count}");
        }

        /// <summary>⑤ 下行坑：坑底出口祭坛（正面朝东，门洞里是出口传送门）+ 坑沿碎石；返回祭坛（没有 Prefab 时为 null，传送门自己立门框）</summary>
        static GameObject BuildSink(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("⑤ Sink").transform;
            root.SetParent(arch, false);
            var shrine = ShowcaseSceneBuilder.Prefab("SM_Tripo_DesertPortalShrine")
                ? Put("SM_Tripo_DesertPortalShrine", root, set, ShrineAt, ShrineYaw, 1f, 0.15f, new Vector3(9.7f, 11, 3.3f))
                : null;
            int i = 0;
            foreach (float deg in new[] { 200f, 250f, 300f, 340f })
            {
                var at = Sink + new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad) * SinkR.x, Mathf.Sin(deg * Mathf.Deg2Rad) * SinkR.y) * 1.75f;
                Put("SM_Env_DesertSandstone", props, set, at, i * 47, 1f, 0.3f, new Vector3(3.4f, 2.9f, 2.5f));
                i++;
            }
            return shrine;
        }

        // ───────────── 遭遇 ─────────────
        /// <summary>
        /// 刷怪站位（标记名 → 位置、角色、lane、高台）。高台站位只给邪飞天（第一章其余敌人都贴地，EnemyDef.groundOnly）；
        /// 墙头、沙台、商铺台、巨像台是坡道走得上去的地面站位，蝎卫 / 蜃楼蟾按「远程 / 炮击」角色站上去。
        /// 每个站位离掩体件 ≥ 2 m（精英镇墓兽 / 蝎卫半径约 1.9 m，L5 出生净空）。
        /// </summary>
        static readonly (string name, Vector2 at, StationRole role, int lane, bool elevated)[] AnchorDefs =
        {
            // ① 灌沙城门：沙坡两翼跳鼠包抄，长街口正面，北墙墙头一名蝎卫压制
            ("Enemy_1_FanWest", new Vector2(22, 144), StationRole.Flank, 0, false),
            ("Enemy_1_FanEast", new Vector2(58, 154), StationRole.Assault, 1, false),
            ("Enemy_1_StreetMouth", new Vector2(64, 134), StationRole.Assault, 0, false),
            ("Enemy_1_Walkway", new Vector2(80, WallZ1), StationRole.Ranged, 2, false),
            // ② 三路长街：街面两头正面，沙台、墙头远程，南排巷口侧翼，墙头上空飞天
            ("Enemy_2_StreetWest", new Vector2(84, 133), StationRole.Assault, 0, false),
            ("Enemy_2_StreetEast", new Vector2(128, 132), StationRole.Assault, 1, false),
            ("Enemy_2_Bench", new Vector2(110, 156), StationRole.Ranged, 0, false),
            ("Enemy_2_Walkway", new Vector2(134, WallZ1), StationRole.Ranged, 1, false),
            ("Enemy_2_AlleySouth", new Vector2(96, 116), StationRole.Flank, 2, false),
            ("Enemy_2_WalkwayAir", new Vector2(112, WallZ1), StationRole.Support, 1, true),
            // ③ 集市井台：井底正面 / 侧翼，北沿、商铺台炮击（蜃楼蟾），东沿远程，西南沿侧翼
            ("Enemy_3_FloorWest", new Vector2(151, 96), StationRole.Assault, 0, false),
            ("Enemy_3_FloorSouth", new Vector2(166, 89), StationRole.Flank, 1, false),
            ("Enemy_3_RimNorth", new Vector2(163, 123), StationRole.Artillery, 1, false),
            ("Enemy_3_Terrace", new Vector2(189, 108), StationRole.Artillery, 0, false),
            ("Enemy_3_RimSouthWest", new Vector2(143, 80), StationRole.Flank, 2, false),
            ("Enemy_3_RimEast", new Vector2(182, 84), StationRole.Ranged, 2, false),
            // ④ 寺院前庭：前庭南北正面，东西侧翼，巨像台、台基远程，台基上空飞天
            ("Enemy_4_CourtNorth", new Vector2(100, 88), StationRole.Assault, 0, false),
            ("Enemy_4_CourtSouth", new Vector2(100, 54), StationRole.Assault, 1, false),
            ("Enemy_4_CourtWest", new Vector2(84, 64), StationRole.Flank, 1, false),
            ("Enemy_4_CourtEast", new Vector2(108, 78), StationRole.Flank, 2, false),
            ("Enemy_4_ColossusBase", new Vector2(117.3f, 70), StationRole.Ranged, 0, false),
            ("Enemy_4_Platform", new Vector2(118, 37), StationRole.Ranged, 1, false),
            ("Enemy_4_PlatformAir", new Vector2(82, 37), StationRole.Support, 0, true),
            // 西南埋屋坊藏宝守军（可选）
            ("Enemy_5_Ranged", new Vector2(34, 78), StationRole.Ranged, 0, false),
            ("Enemy_5_FlankA", new Vector2(54, 76), StationRole.Flank, 1, false),
            ("Enemy_5_FlankB", new Vector2(50, 54), StationRole.Assault, 2, false),
        };

        /// <summary>埋屋藏宝的位置（守军场地的中心）</summary>
        static readonly Vector2 BuriedCache = new(44, 66), WallCache = new(156, WallZ1 + 1);

        static void BuildMarkers(LevelKit.TerrainSet set, Transform root)
        {
            void Mk(string name, Vector2 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = set.OnGround(p.x, p.y);
            }
            Mk("Site_Spawn", Spawn);
            Mk("Site_1_Gate", GateSite);
            Mk("Site_2_Street", StreetSite);
            Mk("Site_3_Market", Market);
            Mk("Site_4_Forecourt", Court);
            Mk("Site_5_BuriedCache", BuriedCache);
            Mk("Site_Camp", Camp);
            Mk("Site_Exit", ShrineAt);
            foreach (var a in AnchorDefs)
            {
                var go = new GameObject(a.name);
                go.transform.SetParent(root, false);
                go.transform.position = set.OnGround(a.at.x, a.at.y);
                var sa = go.AddComponent<SpawnAnchor>();
                (sa.role, sa.lane, sa.elevated) = (a.role, a.lane, a.elevated);
            }
        }

        /// <summary>
        /// 遭遇（遭遇框架 v2，docs/encounter-design.md「Unity 遭遇框架 v2」；第一章 V2 阵容：跳鼠刀兵 = 刀客、蝎尾弩卫 = 弩手、三彩镇墓兽 = 盾卫、
        /// 火浣鼠 = 爆骸、蜃楼蟾 = 炮击、邪飞天 = 护佑）。1-3 是盾卫首次成规模出现的一关（encounter-design 解锁顺序）：
        ///   ① 灌沙城门 7：开场伏击，跳鼠从沙坡两翼和长街口扑上来，墙头蝎卫压制；第二波火浣鼠顺着沙坡滚下来；
        ///   ② 三路长街 9：街面跳鼠、沙台与墙头蝎卫交叉；第二波镇墓兽沿街冲锋、飞天在墙头赐福——逼玩家换路（街面 / 沙台 / 墙头）；
        ///   ③ 集市井台 10：蜃楼蟾在北沿 / 商铺台吊射，跳鼠下井；第二波火浣鼠滚进井底；升格 1 只精英；
        ///   ④ 寺院前庭 14：三波，最后一波「沙王卫队」写死精英镇墓兽 + 精英蝎卫（Three.js 首章精英上限 0/0/1/1 是按关算的；Unity 一关四个场地，按场地放：③ 升格 1 只，④ 首领前最后一战 2 只，同 1-1 ④）；
        ///   ⑤ 埋屋守军 4（可选，调查藏宝点时惊动）。
        /// 必清 40 只，可选 4 只。奖励：① 秘卷、② 武器、③ 秘卷、④ 武器（保底精良）、埋屋藏宝 武器（保底精良）、墙头藏宝 强化。
        /// 关卡目标：①–④ 必清、顺序不限；埋屋守军是可选场地。完成后出口传送门升起，落清关宝箱（RunPlan 1-3：秘卷）。
        /// </summary>
        static LevelObjective BuildEncounters(LevelKit.TerrainSet set, Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset = default)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = set.OnGround(center.x, center.y);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                var anchors = new List<Transform>();
                foreach (Transform m in markers)
                    if (m.name.StartsWith($"Enemy_{index}_"))
                        anchors.Add(m);
                site.anchors = anchors.ToArray();
                return site;
            }
            WaveEntry E(string enemy, int count, float delay = -1) => EncounterSpec.E(enemy, count, delay);

            var s1 = Site(1, "灌沙城门", GateSite, 20, 26, EncounterSpec.Of(
                    EncounterSpec.Wave("灌沙伏击", E("jerboa_blade", 3), E("scorpion_archer", 1)).Hint("跳鼠从沙坡两翼扑上来，墙头有弩卫"),
                    EncounterSpec.Wave("沙坡滚火", E("fire_rat", 2), E("jerboa_blade", 1)).After(1, 1.6f).Hint("火浣鼠顺坡滚下，往高处让开"))
                .Gather(0.4f).Distance(10, 30), "scroll");
            var s2 = Site(2, "三路长街", StreetSite, 22, 30, EncounterSpec.Of(
                    EncounterSpec.Wave("长街伏兵", E("jerboa_blade", 3), E("scorpion_archer", 2)).Hint("弩卫在沙台和墙头，走马道绕上去"),
                    EncounterSpec.Wave("墙头与屋檐", E("tomb_beast", 1), E("apsara", 1), E("jerboa_blade", 2)).After(1, 1.6f).Hint("镇墓兽顺街冲锋——上沙台躲开，先打飞天的琵琶"))
                .Gather(0.4f).Distance(10, 34), "weapon", new Vector3(0, 0, -8));
            var s3 = Site(3, "集市井台", Market, 22, 28, EncounterSpec.Of(
                    EncounterSpec.Wave("井台蜃影", E("mirage_toad", 2), E("jerboa_blade", 3)).Hint("蜃楼蟾在井沿上吊射，分身打不坏真身"),
                    EncounterSpec.Wave("集市乱战", E("fire_rat", 3), E("jerboa_blade", 1), E("scorpion_archer", 1)).After(1, 1.6f).Hint("火浣鼠滚进井底，上台阶或坡道"))
                .Gather(0.4f).Distance(10, 32).Elites(1), "scroll", new Vector3(0, 0, -8));
            var s4 = Site(4, "寺院前庭", Court, 24, 30, EncounterSpec.Of(
                    EncounterSpec.Wave("前庭守卫", E("tomb_beast", 1), E("jerboa_blade", 2), E("scorpion_archer", 2)).Hint("镇墓兽正面格挡——绕到背后打裂缝"),
                    EncounterSpec.Wave("飞天赐福", E("apsara", 1), E("fire_rat", 3), E("mirage_toad", 1)).After(2, 1.6f).Hint("先打飞天的琵琶，再清火浣鼠"),
                    EncounterSpec.Wave("沙王卫队", E("tomb_beast", 1).Elite(), E("scorpion_archer", 1).Elite(), E("jerboa_blade", 2)).After(1, 2f).Hint("精英卫队——巨像台上有俯射位"))
                .Gather(0.6f).Distance(10, 34), "weapon:min=1");
            var guard = Site(5, "埋屋守军", BuriedCache, 16, 22, EncounterSpec.Of(
                    EncounterSpec.Wave("埋屋守军", E("scorpion_archer", 1), E("jerboa_blade", 3)).Hint("守着藏宝的一小队"))
                .Gather(0.4f).Distance(8, 26), "");
            guard.autoTrigger = false;
            guard.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿过沉沙古城";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { guard };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 支路藏宝（CachePOI）：西南埋屋坊一处有守军（调查时惊动「埋屋守军」，肃清后出宝箱，武器保底精良）；北墙墙头断口前一处无人看守（强化）——
        /// 奖励走高路的人。模型用资产（Model 子物体：舍利龛 / 宝藏堆），放在藏宝点旁 2 m，宝箱从藏宝点本身冒出来，不和模型重叠。
        /// </summary>
        static void BuildCaches(LevelKit.TerrainSet set, Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            CachePOI Cache(string title, Vector2 at, float yaw, string reward, EncounterSite guardSite, string modelId, Vector2 modelOffset, float modelScale, Vector3 size)
            {
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                poi.transform.SetPositionAndRotation(set.OnGround(at.x, at.y), Quaternion.Euler(0, yaw, 0));
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = 14;
                var mAt = at + modelOffset;
                var model = LevelKit.PlaceOrBox(modelId, poi.transform, set.OnGround(mAt.x, mAt.y, -0.1f), size * modelScale, yaw, modelScale);
                if (model)
                {
                    model.name = "Model";
                    model.transform.SetPositionAndRotation(set.OnGround(mAt.x, mAt.y, -0.1f), Quaternion.Euler(0, yaw, 0));
                    model.isStatic = true;
                }
                return poi;
            }
            Cache("埋屋藏宝", BuriedCache, 90, "weapon:min=1", guard, "SM_Prop_DesertReliquary", new Vector2(-2, 0), 1f, new Vector3(1.5f, 2.5f, 0.6f));
            Cache("墙头藏宝", WallCache, 180, "upgrade", null, "SM_Tripo_DesertTreasureHoard", new Vector2(3, 0.8f), 0.7f, new Vector3(2.6f, 1.8f, 1.9f));
        }

        /// <summary>
        /// 补给营（B2 / R3）：台基上寺塔背后的塔院，营地中心 (100, 12)、正面朝北（玩家绕过寺塔走来），商店弧排在中心后方 6.4 m；
        /// 安全区半径 10 m（敌人进不来、不在这里出生）。补给是付费服务（战备药剂），到达不白给回满（同 Three.js）。
        /// 前庭在台基下 3 m、中间隔着寺塔和两段回廊，看不到营地。
        /// </summary>
        static SupplyCamp BuildSupplyCamp(LevelKit.TerrainSet set, Transform markers)
        {
            var go = new GameObject("SupplyCamp");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(set.OnGround(Camp.x, Camp.y), Quaternion.identity);
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 10f;
            zone.height = 6f;
            var camp = go.AddComponent<SupplyCamp>();
            camp.label = "寺院前庭 · 补给营";
            camp.safeRadius = 10f;
            camp.openShop = true;
            camp.restoreOnArrive = false;
            return camp;
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 交给 L5 规则集（<see cref="LevelValidator"/>）的声明：主线 13 个路点（出生 → ① → 墙头 → 沙台 → 长街 → 井底 → 商铺台 → 前庭 → 巨像台 → 台基 → 补给营 → 坑口 → 坑底出口），
        /// 坡度路径（长街沙舌、两条马道、台基正面坡道、下行坑坡道），7 条地标视线（寺塔从出生点、灌沙坡、长街巷口、前庭、墙头都看得见；井底望得见巨像；坑口望得见坑底的出口祭坛），
        /// 场地尺寸取 maps/1-3.md 场地表；补给营的 7 个摊位运行时才生成，按 ShopLayout 声明成交互点。
        /// 软边界没有空气墙：越界按远处的兜底环算（escapeMargin = 兜底距离 + 2 m），而城墙芯与雅丹崖本身就翻不出去。
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var pagodaTop = G(Pagoda, 18);
            var spec = new LevelSpec
                {
                    id = "1-3", title = "沉沙古城", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    slopePaths =
                    {
                        new SlopePath { name = "长街沙舌", points = StreetPath.points },
                        new SlopePath { name = "西马道", points = new[] { Madao[0].foot, Madao[0].top } },
                        new SlopePath { name = "东马道", points = new[] { Madao[1].foot, Madao[1].top } },
                        new SlopePath { name = "台基正面坡道", points = new[] { PlatformRamps[0].foot, PlatformRamps[0].top } },
                        new SlopePath { name = "下行坑坡道", points = SinkRamp.points },
                    },
                    sites =
                    {
                        S("① 灌沙城门", GateSite, 36, cover: 2, layers: 2, overlook: true),
                        S("② 三路长街", StreetSite, 48, cover: 4, layers: 2, overlook: true),
                        S("③ 集市井台", Market, 50, cover: 4, layers: 2, overlook: true),
                        S("④ 寺院前庭", Court, 55, cover: 4, layers: 2, overlook: true),
                        S("补给营（塔院）", Camp, 24, combat: false),
                    },
                }
                .Route("出生·沙山", G(Spawn)).Route("① 灌沙坡", G(GateSite)).Route("北墙墙头", G(new Vector2(80, WallZ1)))
                .Route("屋顶沙台", G(new Vector2(108, 156))).Route("② 长街", G(new Vector2(104, 134))).Route("③ 井底", G(new Vector2(152, 100)))
                .Route("③ 商铺台", G(new Vector2(189, 108))).Route("④ 前庭", G(new Vector2(100, 82))).Route("④ 巨像台", G(new Vector2(117.3f, 72)))
                .Route("台基", G(new Vector2(88, 36))).Route("补给营", G(Camp + new Vector2(0, 4))).Route("下行坑口", G(SinkRampStart))
                .Route("坑底出口", G(new Vector2(ShrineAt.x + 4.7f, ShrineAt.y)))
                .Sight("出生点 → 寺塔", G(Spawn, 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("① 灌沙坡顶 → 寺塔", G(new Vector2(36, 158), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("② 长街巷口 → 寺塔", G(new Vector2(100, 136), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("北墙墙头 → 寺塔", G(new Vector2(130, WallZ1), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("③ 井底 → 沙王巨像", G(new Vector2(154, 104), 1.62f), G(ColossusAt, ColossusBaseH + 15), 6, "SM_Tripo_DesertSeatedColossus")
                .Sight("④ 前庭入口 → 寺塔", G(new Vector2(100, 100), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("下行坑口 → 坑底出口祭坛", G(SinkRampStart, 1.62f), G(ShrineAt, 6), 4, "SM_Tripo_DesertPortalShrine");
            // 补给营的摊位运行时才开店：按 ShopLayout 声明（7 个摊位，强化台居中）
            var center = G(Camp);
            var stations = ShopLayout.Build(center, 0, 7, 3);
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
