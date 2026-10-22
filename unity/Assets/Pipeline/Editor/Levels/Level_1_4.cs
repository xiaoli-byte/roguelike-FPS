using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-4 鸣沙山月牙泉 · 旱魃（docs/level-design/maps/1-4.md；unity-maps-v1.md 第 1 节 1-4、第 3 节场地）：第一章的首领场，露天。
    /// 照甘肃敦煌鸣沙山月牙泉的实景缩成游戏尺度：一圈刀刃脊的大沙山围出一片开阔的沙洼，洼底偏南一弯月牙泉（凸顶朝北、两角朝南），
    /// 泉的南岸、月牙怀里是月泉阁一组楼阁（月牙阁 + 回廊 + 白杨林），泉边芦苇、红柳，盆底两座新月形沙丘。
    /// 关卡坐标 = 世界 XZ（米），盆底 y ≈ 0。地形 400 × 400 m，沙山脊高约 25–43 m，环外是起伏的沙海，外缘 40 m 落回远景地面。
    ///
    ///   出生 · 鸣沙山观景台：北面沙山伸进盆地的一道支脊上，16 m 高的平台（安全区，不开店——补给营在上一关 1-3 的寺院塔院）；
    ///   → 两条下山路：顺支脊脊线直下的木梯（约 28°，踏板 0.36 m 一级）、往西绕沙山坡面的驼道（≤ 18°）；沙坡本身也能直接跑下去
    ///   → 盆底（约 112 × 92 m，西缘紧贴西环沙山的坡脚）：首领场是圆心 (−2, 4)、半径 44 m 的圆，月牙泉、月牙阁、两座新月丘都在里面。
    ///
    /// 日晒与荫蔽（旱魃核心机制）：主光 = 午后的太阳，从西南偏西（方位 242°）、仰角 31° 照进来，影子是真实投影，判定是同一套几何上的射线。
    ///   · 全影：月牙阁敞厅东半、二层后半（屋顶在）、回廊廊下、白杨的树影（朝东北偏东拖出 15–19 m）、西环沙山的坡脚（落沙坡背着太阳，盆底西缘）；
    ///   · 半影：两座新月丘的落沙坡脚——落沙坡（36°）只比日光陡 5°，影子是一道薄楔，胸口在影子里、头露在外（半份灼烧）；
    ///     新月丘主要是挡日轮直射的掩体（日轮在旱魃身后 4 m 高，躲到丘背后就照不到）和走得上去的俯射层；
    ///   · 全晒：泉北的开阔沙地、东半场；泉水里站着灼烧减半（WaterVolume，名字带 CrescentSpring，二阶段被吸干）；
    ///   · 三阶段旱魃把太阳推到头顶（约 85°，BS2 HanbaSunDriver）：沙丘、树的影子缩到脚下，只剩楼阁、回廊的顶下还有深影。
    /// 场景里不放 SunShaft（露天 = 没有穴顶开口）。
    ///
    /// 边界（D14，没有空气墙）：可玩区 = 盆底 + 沙山坡脚往上 18 m + 观景台 / 木梯 / 驼道；坡脚以上是沙山的直坡（落沙坡 36°、迎风坡 27°），
    /// 等值线外风沙推回、白化，26 m 外兜底碰撞环。沙山本身走得上去（坡度 &lt; 45°），所以「出不去」靠软边界 + 兜底环，不靠地形挡死。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、自举标记、观景台安全区（<see cref="SafeZone"/>，没有 SupplyCamp / 商店）、首领场地（<see cref="BossArena"/>）、
    /// 首领关流程（<see cref="BossEncounter"/>，首领 boss_hanba；出口在打完后由它升起）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 1-4 鸣沙山月牙泉（或 bridge.sh level 1-4）。
    /// </summary>
    [LevelBuilder("1-4", ScenePath)]
    public static class Level_1_4
    {
        public const string Dir = "Assets/Levels/L1_4_Crescent";
        public const string ScenePath = "Assets/Scenes/L1_4_Crescent.unity";
        const string Name = "L1_4";
        /// <summary>首领（HanbaDef.Id；编辑器程序集也引用得到，这里写字面量免得构建器依赖首领单元的文件顺序）</summary>
        const string BossId = "boss_hanba";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（泉床挖到 −1.6 也还在范围内）；远景地面 y = FarY（环外沙海的平均高）</summary>
        const float Base = 10f, HeightRange = 72f, FarY = 12f;
        static readonly Vector2 Origin = new(-200, -200), Size = new(400, 400);
        /// <summary>软边界（L3，D14）：等值线外起风推回、白化，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = LevelKit.BoundarySpec.Default;

        // ───────────── 风与太阳 ─────────────
        /// <summary>盛行风吹去的方位（度，0 = 北 +Z，顺时针）：从西南偏西吹向东北偏东。落沙坡、新月丘的两角都朝这边</summary>
        const float WindBearing = 62f;
        static readonly Vector2 Wind = new(Mathf.Sin(WindBearing * Mathf.Deg2Rad), Mathf.Cos(WindBearing * Mathf.Deg2Rad));
        /// <summary>
        /// 主光（午后的太阳）：仰角 31°，光朝方位 62° 走 = 太阳在西南偏西（242°），和风来的方向一致——落沙坡正好背着太阳。
        /// BS2 约定一阶段 30–40°、三阶段由 HanbaSunDriver 推到约 <see cref="RisenPitch"/>。
        /// </summary>
        const float SunPitch = 31f, SunYaw = WindBearing, RisenPitch = 85f;

        static Quaternion SunRotation => Quaternion.Euler(SunPitch, SunYaw, 0);
        static Vector3 ToSun(float pitch) => -(Quaternion.Euler(pitch, SunYaw, 0) * Vector3.forward);

        // ───────────── 盆底与环形沙山 ─────────────
        /// <summary>盆底椭圆（中心、半轴）；可玩区 = 盆底边缘往沙山坡脚上多 FloorGrow 米</summary>
        static readonly Vector2 FloorCenter = new(10, 2), FloorAxes = new(56, 46);
        const float FloorGrow = 18f;

        /// <summary>
        /// 沙山的峰（方位角度，0 = +X、逆时针；加高；角宽）：南面月泉阁背后的大沙山最高（鸣沙山的主体在泉南），北面次之（观景台所在），
        /// 西环是落沙坡、东环是迎风坡、东北一座小峰接观景台支脊。脊高 = 27 m ± 3 m 起伏 + 各峰。
        /// </summary>
        static readonly (float deg, float amp, float width)[] Peaks =
        {
            (262, 14, 22), (98, 9, 20), (176, 6, 16), (336, 3, 18), (66, 5, 14), (212, 4, 14),
        };

        static float CrestHeight(float ang)
        {
            float h = 27f + 3f * Loop(ang, 7, 2, 21);
            float deg = ang * Mathf.Rad2Deg;
            foreach (var (pd, amp, w) in Peaks)
            {
                float k = Mathf.DeltaAngle(deg, pd) / w;
                h += amp * Mathf.Exp(-k * k);
            }
            return h;
        }

        /// <summary>环外的沙海：顺风向的横向沙丘（波长 70 m、高 12 m），底面 16 m</summary>
        static float Sea(Vector2 p) => 16f + Dunes(p, Wind, 70, 12, 41, 0.76f);

        static readonly LevelKit.DuneRingSpec Ring = new()
        {
            center = FloorCenter, axes = FloorAxes, wind = Wind, crest = CrestHeight, outside = Sea,
            innerWindward = 27f, innerSlip = 36f, outerWindward = 16f, outerSlip = 32f, apron = 0.2f, crestWobble = 7f, seed = 5,
        };

        // ───────────── 月牙泉 ─────────────
        /// <summary>泉水 WaterVolume 的名字标记（BS2 HanbaSpring 按名字里含 CrescentSpring 认泉水，二阶段吸干）</summary>
        const string SpringName = "CrescentSpring";
        /// <summary>
        /// 泉的中线：圆心 (0, −36)、半径 44 m 的圆弧，凸顶朝北 (0, 8)，两角各离凸顶 50°（尖角在 (±33.7, −7.7)），尖到尖约 67 m；
        /// 凸顶处宽 13 m，往两头收尖——长宽比约 5 : 1，像实景那弯细长的月牙。
        /// </summary>
        static readonly LevelKit.CrescentArc Spring = new(new Vector2(0, -36), 44f, 90f, 50f, 6.5f, 0.6f);
        /// <summary>水面（世界 y）、泉床最深处（东深西浅，实景「泉水东深西浅」）</summary>
        const float WaterY = -0.85f, BedDepthEast = 1.55f, BedDepthWest = 1.3f;
        /// <summary>水体竖条宽（米，沿 x）</summary>
        const float WaterStrip = 3f;
        static Vector2 SpringApex => Spring.At(0);

        // ───────────── 盆底的新月形沙丘 ─────────────
        /// <summary>
        /// 西北「沙丘岛」：脊高 7 m，迎风背 26 m（≤ 20°，走得上去 = 俯射层），落沙坡 36° 朝东北偏东（背着太阳）。
        /// 太阳 31° 时落沙坡只比日光陡 5°，影子是一道薄楔：坡脚 2 m 内胸口在影子里、头露在外（半份灼烧）——沙丘主要是挡日轮直射的掩体
        /// </summary>
        static readonly LevelKit.Barchan DuneA = new(new Vector2(-30, 27), Wind, 7f, 15f, 26f, 9f, 36f, 31);
        /// <summary>
        /// 东沙丘：泉凸顶东北、梯脚西南，脊高 5.5 m、迎风背 18 m（≤ 22°）。迎风背的坡脚离泉边湿沙带还有 7 m 以上——
        /// 湿沙带里沙丘被压平，坡脚伸进去的话迎风背会在那里断成 30° 的陡坎（旧位置 (30, 19) 验收报 31°）
        /// </summary>
        static readonly LevelKit.Barchan DuneB = new(new Vector2(26, 30), Wind, 5.5f, 11f, 18f, 6f, 36f, 32);

        // ───────────── 观景台、支脊、木梯、驼道 ─────────────
        /// <summary>观景台（出生、安全区）：支脊上半径 10 m 的平台，台面 16 m，四周 31° 沙坡</summary>
        static readonly Vector2 Platform = new(24, 78);
        const float PlatformY = 16f, PlatformR = 10f, SpurFlank = 31f, SpurTopHalf = 3f;
        /// <summary>木梯：从台沿顺支脊脊线直下到盆底 (10, 40)，约 30.6 m、落差 16 m（28°）；踏板每级 0.36 m（&lt; 台阶 0.45 m）</summary>
        static readonly Vector2 StairFoot = new(10, 40);
        static readonly Vector2 StairTop = Platform + (StairFoot - Platform).normalized * (PlatformR - 0.5f);
        const float StairHalf = 1.6f, StairShoulder = 2f, StairWidth = 2.6f, TreadRise = 0.36f;
        static readonly PathSpline StairPath = new PathSpline(new[] { StairTop, StairFoot }, 1).WithHeights(new[] { PlatformY, 0f });
        /// <summary>支脊：北面沙山伸下来的一道刀刃脊，脊线 = 木梯 → 观景台 → 往上接进沙山（顶宽 6 m，两侧 31°）</summary>
        static readonly PathSpline SpurPath = new PathSpline(new[] { StairFoot, StairTop, Platform, new Vector2(31, 94), new Vector2(40, 112) }, 6)
            .WithHeights(new[] { 0f, PlatformY, PlatformY, 19f, 30f });
        /// <summary>驼道：从台的西沿横切北面沙山坡面往西、再折下到盆底 (−21, 45)，约 56 m、≤ 18°</summary>
        static readonly PathSpline TrailPath = new PathSpline(new[]
            {
                new Vector2(14.5f, 81), new Vector2(2, 78), new Vector2(-12, 68), new Vector2(-20, 56), new Vector2(-21, 45),
            }, 6)
            .WithHeights(new[] { PlatformY, 13f, 8f, 3.5f, 0f });
        const float TrailHalf = 2.2f, TrailShoulder = 4.5f;

        // ───────────── 月泉阁（泉南岸、月牙怀里）─────────────
        const string PavilionId = "SM_Tripo_DesertCrescentPavilion";
        /// <summary>月牙阁正面朝北临水，前沿离水边约 6 m；× 1.2（设计包围盒 8.5 × 11 × 7.6 m → 10.2 × 13.2 × 9.2 m）</summary>
        static readonly Vector2 Pavilion = new(0, -8);
        const float PavilionYaw = 0f, PavilionScale = 1.2f;
        /// <summary>没有 Prefab 时的白盒尺寸；二层台高（资产描述 11 m 高里 6 m 处 × 1.2）</summary>
        static readonly Vector3 PavilionSize = new(10.2f, 13.2f, 9.2f);
        const float PavilionDeck = 7.2f, PavilionTerrace = 1.2f;
        /// <summary>
        /// 敞厅里的深影点（相对阁心）：一层四面敞开，31° 的斜阳从西南偏西钻到二层台底下——敞厅西半边站着头会被晒到；
        /// 东北角（离东、北两边各约 1 m）离西面出口约 9 m，日光走到出口前已升过台底、被二层台挡住。三阶段太阳在头顶时整个敞厅都在台下
        /// </summary>
        static readonly Vector2 PavilionShadeOffset = new(3.5f, 3f);
        /// <summary>回廊（二层廊屋，正面朝北开敞）：三间，中线 z = −24，× 1.2</summary>
        const string CloisterId = "SM_Tripo_DesertCloister";
        const float CloisterZ = -24f, CloisterHalfLen = 11.2f, CloisterScale = 1.2f;
        static readonly Vector3 CloisterSize = new(6.17f, 7.5f, 2.85f);
        /// <summary>庭院（月牙阁背后、回廊前）：出口升起的地方</summary>
        static readonly Vector2 Courtyard = new(0, -17.5f);
        static readonly Vector2 TempleMin = new(-15, -28), TempleMax = new(15, -2);
        /// <summary>白杨（还没有资产：占位轮廓 = 细干 + 柱状冠，带碰撞，挡日晒，见 PoplarSilhouette）：月泉阁两侧与南岸</summary>
        const string PoplarId = "SM_Tripo_DesertPoplar";
        static readonly (Vector2 at, float h)[] Poplars =
        {
            (new Vector2(-17, -12), 12.5f), (new Vector2(-22, -21), 11f), (new Vector2(-14, -32), 12f), (new Vector2(-31, -15), 10.5f),
            (new Vector2(17, -11), 12f), (new Vector2(22, -21), 13f), (new Vector2(15, -32), 11.5f), (new Vector2(31, -14), 11f),
        };
        /// <summary>红柳（大丛，带碰撞）：泉两角与南岸</summary>
        static readonly (Vector2 at, float h)[] Tamarisks =
        {
            (new Vector2(-27, -8), 3.0f), (new Vector2(27, -8), 2.8f), (new Vector2(-37, -11), 3.4f), (new Vector2(38, -10), 3.2f),
            (new Vector2(-7, -36), 2.6f), (new Vector2(8, -37), 3.0f), (new Vector2(-24, -31), 2.8f), (new Vector2(25, -31), 3.1f),
        };
        /// <summary>盆底的风蚀砂岩（掩体）</summary>
        static readonly (Vector2 at, float h)[] Boulders =
        {
            (new Vector2(-8, 30), 1.8f), (new Vector2(44, 18), 1.6f), (new Vector2(-44, 12), 2.2f), (new Vector2(46, -6), 2.0f),
            (new Vector2(-40, -26), 1.8f), (new Vector2(40, -28), 2.1f),
        };

        // ───────────── 标记 ─────────────
        /// <summary>
        /// 出生点站在观景台前沿（离台沿 3.5 m，正对木梯口）：台面是平的，站在台心时 10 m 宽的台面会挡住往下 15° 的视线，泉心正好在这个俯角上。
        /// 站到前沿，视线越过台沿顺着木梯落下去，整弯泉水都在眼前（这张图的招牌镜头）
        /// </summary>
        static readonly Vector2 PlayerSpawnAt = Platform + (StairFoot - Platform).normalized * (PlatformR - 3.5f);
        static readonly Vector2 ArenaCenter = new(-2, 4);
        const float ArenaRadius = 44f;
        /// <summary>旱魃从泉心（凸顶）升起；玩家从木梯脚往前几步进圈</summary>
        static readonly Vector2 BossSpawn = new(0, 8), PlayerEntry = new(6, 36), RewardAt = new(8, 22);
        static readonly Vector2[] SummonPoints = { new(-36, 4), new(-6, 36), new(40, 12), new(30, -24) };

        // ───────────── 地貌 ─────────────

        /// <summary>泉床：东深西浅，往两角变浅；平底宽 = 半宽 − 岸坡（岸坡 ≤ 2.6 m）。bedMask = 泉床遮罩</summary>
        static float SpringBed(float along, float across, float hw, out float bedMask)
        {
            bedMask = 0;
            if (Mathf.Abs(along) >= 1 || hw <= 0) return 0;
            float depth = BedDepth(along, hw);
            float bank = Mathf.Min(2.6f, 0.55f * hw);
            bedMask = 1 - Smooth(hw - bank, hw + 0.3f, Mathf.Abs(across));
            return -depth * bedMask;
        }

        /// <summary>泉床平底的深度（along −1 = 东角、+1 = 西角）</summary>
        static float BedDepth(float along, float hw) => Mathf.Lerp(BedDepthEast, BedDepthWest, (along + 1) * 0.5f) * Smooth(0.5f, 4f, hw);

        /// <summary>湿沙带：泉边 7 m 内（尖角外再延一点就淡出）</summary>
        static float Damp(float along, float across, float hw) =>
            (1 - Smooth(0, 7, Mathf.Abs(across) - hw)) * (1 - Smooth(1f, 1.15f, Mathf.Abs(along)));

        /// <summary>
        /// 可玩区（软边界 / 防越界 / 俯视图）：盆底边缘往沙山坡脚上 18 m（坡脚是凹形缓坡，那里高 3–5 m）∪ 观景台 13 m ∪ 木梯两侧 9 m ∪ 驼道两侧 6 m
        /// </summary>
        static float Playable(Vector2 p)
        {
            var d = p - FloorCenter;
            float basin = d.magnitude - (LevelKit.DuneRingFloorRadius(Ring, Mathf.Atan2(d.y, d.x)) + FloorGrow);
            float plat = Vector2.Distance(p, Platform) - 13f;
            float stair = LevelKit.SegmentDistance(p, Platform, StairFoot, out _) - 9f;
            float trail = TrailPath.Nearest(p, 20).dist - 6f;
            return 1 - Smooth(0, 4, Mathf.Min(Mathf.Min(basin, plat), Mathf.Min(stair, trail)));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float ring = LevelKit.DuneRing(p, Ring, out var rq);
            LevelKit.CrescentLocal(p, Spring, out float along, out float across, out float hw);
            float damp = Damp(along, across, hw);

            // 盆底的轻微起伏（泉边压平）+ 环形沙山
            float floorY = 0.3f * Fbm(p, 28, 3, 4) * (1 - 0.85f * damp);
            float h = floorY + ring;
            // 新月形沙丘（湿沙带里不长）
            float dune = Mathf.Max(LevelKit.BarchanHeight(p, DuneA, out _), LevelKit.BarchanHeight(p, DuneB, out _)) * (1 - damp);
            h += dune;
            // 月牙泉床
            float bed = SpringBed(along, across, hw, out float bedMask);
            h += bed;
            // 支脊（刀刃脊：脊线高 − 离脊顶的距离 × tan 31°）
            var (sd, st) = SpurPath.Nearest(p, 70);
            if (sd < float.MaxValue) h = Mathf.Max(h, SpurPath.HeightAt(st) - Mathf.Max(0, sd - SpurTopHalf) * Mathf.Tan(SpurFlank * Mathf.Deg2Rad));
            // 观景台：半径 10 m 的平台。往下的一侧台沿利落地落成 31° 沙坡（不留缓坎，台沿外就看得见坡下的泉）；
            // 往上的一侧（北沿背靠沙山）外沿 5 m 内线性接回沙坡（1–2 m 的缓沙坡；smoothstep 会在中段陡过 45°）
            float dp = Vector2.Distance(p, Platform);
            float around = Mathf.Max(h, PlatformY - Mathf.Max(0, dp - PlatformR) * Mathf.Tan(SpurFlank * Mathf.Deg2Rad));
            h = dp <= PlatformR ? PlatformY : around > PlatformY ? Mathf.Lerp(PlatformY, around, Mathf.Clamp01((dp - PlatformR) / 5f)) : around;
            float raised = h - floorY - bed;
            // 木梯、驼道：沿纵断面压平（又挖又填）
            h = StairPath.Flatten(p, h, StairHalf, StairShoulder, PathSpline.Mode.Both, out float stairMask);
            h = TrailPath.Flatten(p, h, TrailHalf, TrailShoulder, PathSpline.Mode.Both, out float trailMask);
            // 地形外缘 40 m 内落回远景地面
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY, h, Smooth(0, 40, edgeDist));
            s.h = Base + h;

            // ── 分层倾向：沙山、沙丘、支脊全是沙；盆底大半是沙、夹几片砾石；泉床龟裂（夯土层），泉边一圈湿沙；庭院、观景台、木梯、驼道是踩实的沙 ──
            float court = 1 - Smooth(0, 3, LevelKit.BoxSdf(p, TempleMin, TempleMax));
            float platTop = 1 - Smooth(PlatformR - 1, PlatformR + 1, dp);
            s.fluid = Smooth(0.3f, 0.8f, bedMask);
            s.shore = damp * (1 - s.fluid);
            s.packed = Mathf.Max(Mathf.Max(stairMask, trailMask) * 0.85f, Mathf.Max(court * 0.75f, platTop * 0.7f));
            float floorSand = 0.55f + 0.35f * Smooth(-0.2f, 0.4f, Fbm(p, 22, 3, 7));
            // 湿沙带不压低沙的倾向（不然砾石散布会挤到水边）：湿沙的颜色由 DampDesert 按 shore 混出来
            s.sand = Mathf.Max(Smooth(0.3f, 2f, raised), floorSand);
            return s;
        }

        /// <summary>分层：戈壁规则（沙 / 砾 / 夯土 / 岩）+ 泉边湿沙——沙与夯土各半，读起来是被水浸暗的沙</summary>
        static Vector4 DampDesert(in LevelKit.Sample s, in LevelKit.SplatContext c)
        {
            var w = LevelKit.Splat.Desert(s, c);
            float wet = Mathf.Clamp01(s.shore) * 0.85f;
            return wet > 0 ? Vector4.Lerp(w, new Vector4(0.4f, 0.05f, 0.55f, 0), wet) : w;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-4 鸣沙山月牙泉", priority = 63)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 软边界 → 烘焙 NavMesh → 验收（白盒自查 + L5 规则集）→ 截图；返回不合格项数</summary>
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
            var sun = OpenSkyLighting(theme);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange, heightRes = 1025, splatRes = 1024,
                ground = LevelKit.Ground.Desert, eval = Eval, splat = DampDesert,
            }, env);

            // 远景：近处一圈连绵沙山、再远一圈更高的沙山，最远保留赭红台地（三危山方向的远山）；地形外的远景地面在雾里接上
            var backdrop = LevelKit.BackdropFor(theme, Dir, Name, FloorCenter, FarY - 0.5f, 760, 4);
            backdrop.rings[0].height = 70;
            backdrop.rings[0].freq = 16;
            backdrop.rings[1].style = LevelKit.BackdropStyle.Dunes;
            backdrop.rings[1].height = 120;
            backdrop.rings[1].freq = 11;
            LevelKit.Backdrop(backdrop, env);
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY - 0.05f, theme.groundA);

            // 软边界（没有空气墙）：沙山坡脚以上起风推回 + 兜底环；天气：西南偏西的盛行风，常态风力 0.25（脊线上扬沙）
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            LevelKit.Weather(env, theme, Wind, 0.25f);

            var waters = BuildSpring(set, env, props);
            var pavilion = BuildTemple(set, arch, props, out var cloisters);
            var trees = BuildGroves(set, props);
            BuildStair(set, props);
            BuildScatter(set, env);
            var start = BuildPlatform(set, props, markers);
            var arena = BuildArena(set, markers, out var exitPoint, out var rewardPoint);
            BuildEncounter(markers, arena, exitPoint, rewardPoint);

            // 玩家在 Core 场景（L1）：这里只放出生标记（SceneFlow 带着上一关的局状态组装）+ 自举标记
            var spawnAt = set.OnGround(PlayerSpawnAt.x, PlayerSpawnAt.y, 0.05f);
            var pavilionTop = set.OnGround(Pavilion.x, Pavilion.y, 9f);
            var spawnRot = Quaternion.LookRotation(Flat(pavilionTop - spawnAt));
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
            rep.Line("1-4 鸣沙山月牙泉 · 验收");
            CheckGeometry(rep, set, sun, waters, pavilion, cloisters, trees, start, arena);
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线 + L5 规则集（含防越界：没有空气墙，软边界 + 兜底环）
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_1-4_report.txt");

            if (review)
            {
                Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_1-4", new[]
                    {
                        ("Aerial", new Vector3(95, 120, 135), new Vector3(0, 0, -2), false),
                        ("Map", new Vector3(6, 420, 2), new Vector3(6, 0, 3), false),
                        ("Spawn", E(PlayerSpawnAt), new Vector3(0, 2, -1), true),
                        ("StairTop", E(StairTop + (StairFoot - StairTop).normalized * 2f), G(SpringApex, 1f), false),
                        ("Trail", E(new Vector2(-12, 68)), G(DuneA.crest, 3f), false),
                        ("Entry", E(PlayerEntry), G(BossSpawn, 3f), true),
                        ("NorthShore", E(SpringApex + new Vector2(-6, 9)), pavilionTop - Vector3.up * 3f, false),
                        ("DuneIsland", E(DuneA.crest + new Vector2(0, 0.5f)), G(Pavilion, 5f), false),
                        ("DuneLee", E(DuneA.Lee(10f)), G(DuneA.crest, 4f), false),
                        ("Pavilion", E(new Vector2(-14, 4)), G(Pavilion, 6f), false),
                        ("Courtyard", E(Courtyard + new Vector2(-6, -2)), G(Pavilion, 4f), false),
                        ("Cloister", E(new Vector2(4, CloisterZ + 0.5f)), G(new Vector2(-8, CloisterZ + 0.5f), 1.5f), false),
                        ("BossSide", E(BossSpawn + new Vector2(0, 2)), G(Platform, 2f), false),
                        ("WestApron", E(new Vector2(-50, 4)), G(new Vector2(-110, 4), 20f), false),
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

        static float YawOf(Vector2 dir) => Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;

        /// <summary>
        /// 露天的光：主光转到午后（仰角 31°、太阳在西南偏西），偏暖、硬影；环境光沿用章节主题。雾推远（盆地里视线 130 m 上下，沙山脊在 60–130 m 外）。返回主光
        /// </summary>
        static Light OpenSkyLighting(ShowcaseTheme theme)
        {
            var sun = RenderSettings.sun;
            if (sun)
            {
                sun.transform.rotation = SunRotation;
                sun.color = new Color(1f, 0.87f, 0.7f);
                sun.intensity = theme.sunIntensity * 1.1f;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 1f;
            }
            RenderSettings.fogStartDistance = 70f;
            RenderSettings.fogEndDistance = 420f;
            return sun;
        }

        /// <summary>按 id 摆到地形上（底面往下埋 sink）；缺 Prefab 时放 size 的占位白盒（验收会列出来）</summary>
        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, Vector3 size, float targetHeight = 0, float sink = 0.15f)
        {
            var go = LevelKit.PlaceOrBox(id, parent, set.At(at.x, at.y), at.x, at.y, yaw, size, targetHeight, sink);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>
        /// 月牙泉的水（L8 WaterVolume，水面 y −0.85，东段深约 0.7 m、西段约 0.45 m；尖角处泉床比水面浅，是干的）。
        /// 沿 x 每 3 m 切一条竖条，条与条首尾相接、互不重叠：每条的 z 范围 = 这一条里泉床低于水面的范围外扩 0.7 m（外扩的部分埋在岸坡下），
        /// 底面 = 这一条泉床的最低处。水体本身不画，只在顶面挂一块水面片（内置 Quad，不投影）——
        /// 以前沿弧线转着摆、互相重叠的水块，透明叠加会画出一道道深浅条纹，水块的侧面也会透过水面露出来。
        /// 水面片是水体的子物体：BS2 吸干时把水体的 y 缩放降到 0（底面不动），水面跟着一起落下去；相邻两条底面差不多高，吸干时的高低差只有几厘米。
        /// 根节点与每条的名字都带 CrescentSpring（BS2 二阶段按名字找泉水；不给标签：工程里没定义这个标签）。泉床沿中线铺龟裂贴花（吸干后露出来）。
        /// </summary>
        static List<WaterVolume> BuildSpring(LevelKit.TerrainSet set, Transform env, Transform props)
        {
            LevelKit.EnsureWorldMaterials();
            var waterMat = AssetDatabase.LoadAssetAtPath<Material>($"{LevelKit.WorldMaterialDir}/{WorldMaterials.AssetName(WorldMaterialKind.Water)}.mat");
            var root = new GameObject(SpringName).transform;
            root.SetParent(env, false);
            var waters = new List<WaterVolume>();
            float xFrom = Mathf.Floor((Spring.center.x - Spring.radius - Spring.halfWidth) / WaterStrip) * WaterStrip;
            float xTo = Spring.center.x + Spring.radius + Spring.halfWidth;
            float zFrom = Spring.center.y, zTo = Spring.center.y + Spring.radius + Spring.halfWidth + 1f;
            int seg = 0;
            for (float xa = xFrom; xa < xTo; xa += WaterStrip)
            {
                float zMin = float.MaxValue, zMax = float.MinValue, bottom = float.MaxValue;
                for (float x = xa; x <= xa + WaterStrip + 1e-3f; x += 0.5f)
                for (float z = zFrom; z <= zTo; z += 0.25f)
                {
                    LevelKit.CrescentLocal(new Vector2(x, z), Spring, out float along, out float across, out float hw);
                    if (Mathf.Abs(along) >= 1 || Mathf.Abs(across) > hw + 0.5f) continue;
                    float y = set.GroundY(x, z);
                    if (y >= WaterY - 0.02f) continue;
                    zMin = Mathf.Min(zMin, z);
                    zMax = Mathf.Max(zMax, z);
                    bottom = Mathf.Min(bottom, y);
                }
                if (zMin > zMax) continue;
                zMin -= 0.7f;
                zMax += 0.7f;
                bottom -= 0.03f;
                float depth = WaterY - bottom;
                var go = new GameObject($"{SpringName} Water {++seg:00}");
                go.transform.SetParent(root, false);
                go.transform.position = new Vector3(xa + WaterStrip * 0.5f, bottom + depth * 0.5f, (zMin + zMax) * 0.5f);
                go.transform.localScale = new Vector3(WaterStrip, depth, zMax - zMin);
                var w = go.AddComponent<WaterVolume>();
                w.shallow = 0.15f;
                w.deep = 1.3f;
                var surface = GameObject.CreatePrimitive(PrimitiveType.Quad);
                surface.name = "Water Surface";
                Object.DestroyImmediate(surface.GetComponent<Collider>());
                surface.transform.SetParent(go.transform, false);
                surface.transform.localPosition = new Vector3(0, 0.5f, 0);
                surface.transform.localRotation = Quaternion.Euler(90, 0, 0); // 内置 Quad 朝 −Z，转 90° 朝上
                var r = surface.GetComponent<MeshRenderer>();
                r.sharedMaterial = waterMat;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
                waters.Add(w);
            }
            var rng = new System.Random(14);
            for (float a = -0.8f; a <= 0.81f; a += 0.2f)
            {
                var c = Spring.At(a);
                var go = ShowcaseSceneBuilder.Place("SM_Decal_DesertCrackedBed", props, set.OnGround(c.x, c.y, 0.02f), (float)rng.NextDouble() * 360f);
                if (go) go.isStatic = true;
            }
            return waters;
        }

        /// <summary>
        /// 月泉阁一组（泉南岸、月牙怀里）：月牙阁正面朝北临水；背后 10 m 的庭院（出口在这里升起）、香炉、龟趺碑；庭院南面一排三间二层回廊，正面朝北开敞。
        /// 月牙阁一层是敞厅（二层台 7.2 m 盖着）、二层后半有屋顶——深影；回廊廊下也是深影（三阶段太阳到头顶也还在）。返回月牙阁
        /// </summary>
        static GameObject BuildTemple(LevelKit.TerrainSet set, Transform arch, Transform props, out List<GameObject> cloisters)
        {
            var root = new GameObject("Crescent Spring Temple · 月泉阁").transform;
            root.SetParent(arch, false);
            var pavilion = Put(PavilionId, root, set, Pavilion, PavilionYaw, PavilionSize);
            if (pavilion && pavilion.tag != LevelKit.PlaceholderTag) pavilion.transform.localScale = Vector3.one * PavilionScale;
            var row = new GameObject("Cloister").transform;
            row.SetParent(root, false);
            cloisters = LevelKit.FacadeRow(row, new Vector2(-CloisterHalfLen, CloisterZ), new Vector2(CloisterHalfLen, CloisterZ), Vector2.up,
                c => set.GroundY(c.x, c.y) - 0.1f, CloisterSize, CloisterScale, CloisterId);
            foreach (var go in cloisters) go.isStatic = true;
            Put("SM_Prop_DesertIncenseBurner", props, set, new Vector2(-6, -16), 0, new Vector3(1.3f, 2.6f, 1.2f), 0, 0.05f);
            Put("SM_Prop_DesertIncenseBurner", props, set, new Vector2(6, -16), 0, new Vector3(1.3f, 2.6f, 1.2f), 0, 0.05f);
            Put("SM_Prop_DesertStele", props, set, new Vector2(-9.5f, -14), 0, new Vector3(1.7f, 3.8f, 2.1f), 0, 0.05f);
            Put("SM_Prop_DesertStele", props, set, new Vector2(9.5f, -14), 0, new Vector3(1.7f, 3.8f, 2.1f), 0, 0.05f);
            Put("SM_Tripo_DesertBrazier", props, set, new Vector2(-5.5f, -1.5f), 0, new Vector3(1.3f, 2.4f, 1.2f), 0, 0.05f);
            Put("SM_Tripo_DesertBrazier", props, set, new Vector2(5.5f, -1.5f), 0, new Vector3(1.3f, 2.4f, 1.2f), 0, 0.05f);
            Put("SM_Prop_DesertUrns", props, set, new Vector2(-12.5f, -23), 30, new Vector3(0.8f, 0.8f, 0.8f), 0, 0.05f);
            Put("SM_Tripo_DesertGoodsPile", props, set, new Vector2(12.5f, -23.5f), -15, new Vector3(1.7f, 1.6f, 1.3f), 0, 0.1f);
            return pavilion;
        }

        /// <summary>
        /// 树和石：白杨（有正式件用正式件，没有就是细干 + 柱状冠的占位轮廓，带碰撞）围着月泉阁与南岸，树影朝东北偏东拖 15–19 m；红柳大丛（带碰撞）在泉两角与南岸；盆底六块风蚀砂岩当掩体；
        /// 北坡脚一辆半埋的驼队残车（来路的故事）。返回白杨与红柳（验收查碰撞体）
        /// </summary>
        static List<GameObject> BuildGroves(LevelKit.TerrainSet set, Transform props)
        {
            var trees = new List<GameObject>();
            var grove = new GameObject("Groves").transform;
            grove.SetParent(props, false);
            var rng = new System.Random(24);
            bool poplarAsset = ShowcaseSceneBuilder.Prefab(PoplarId);
            foreach (var (at, h) in Poplars)
            {
                float yaw = (float)rng.NextDouble() * 360f;
                var go = poplarAsset ? Put(PoplarId, grove, set, at, yaw, new Vector3(3.2f, h, 3.2f), h, 0.2f) : PoplarSilhouette(grove, set, at, h);
                if (go) trees.Add(go);
            }
            foreach (var (at, h) in Tamarisks)
            {
                var go = Put("SM_Env_DesertTamarisk", grove, set, at, (float)rng.NextDouble() * 360f, new Vector3(1.7f, h, 2f), h, 0.15f);
                if (go) trees.Add(go);
            }
            foreach (var (at, h) in Boulders) Put("SM_Env_DesertSandstone", props, set, at, (float)rng.NextDouble() * 360f, new Vector3(2.2f, h, 2.2f), h, 0.3f);
            Put("SM_Tripo_DesertCaravanWreck", props, set, new Vector2(-32, 52), 115, new Vector3(3.8f, 1.8f, 4f), 0, 0.5f);
            return trees;
        }

        /// <summary>
        /// 白杨的占位轮廓（还没有 SM_Tripo_DesertPoplar）：灰褐细干（半径 0.22 m、到 1/3 树高）+ 灰绿柱状树冠（胶囊，半径 1.6 m，从 1/4 树高到树顶），
        /// 新疆杨那种窄高的样子；干、冠都带碰撞（冠挡日晒射线，树影才算数）。根物体名字带 Placeholder、打 Placeholder 标签——验收照样列进占位清单
        /// </summary>
        static GameObject PoplarSilhouette(Transform parent, LevelKit.TerrainSet set, Vector2 at, float h)
        {
            LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var root = new GameObject($"Placeholder · {PoplarId}");
            root.transform.SetParent(parent, false);
            root.transform.position = set.OnGround(at.x, at.y, -0.2f);
            root.tag = LevelKit.PlaceholderTag;
            root.isStatic = true;
            var bark = LevelKit.Mat(Dir, "PoplarBark", new Color(0.42f, 0.38f, 0.33f));
            var leaf = LevelKit.Mat(Dir, "PoplarCrown", new Color(0.44f, 0.5f, 0.3f), 0.95f);
            var trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            trunk.name = "Trunk";
            trunk.transform.SetParent(root.transform, false);
            trunk.transform.localPosition = new Vector3(0, h / 6f, 0);
            trunk.transform.localScale = new Vector3(0.44f, h / 6f, 0.44f);
            trunk.GetComponent<MeshRenderer>().sharedMaterial = bark;
            trunk.isStatic = true;
            float crownBottom = h * 0.25f, crownHeight = h - crownBottom;
            var crown = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            crown.name = "Crown";
            crown.transform.SetParent(root.transform, false);
            crown.transform.localPosition = new Vector3(0, crownBottom + crownHeight * 0.5f, 0);
            crown.transform.localScale = new Vector3(3.2f, crownHeight * 0.5f, 3.2f);
            crown.GetComponent<MeshRenderer>().sharedMaterial = leaf;
            crown.isStatic = true;
            return root;
        }

        /// <summary>
        /// 木梯（鸣沙山上那种顺沙脊直上的木板梯）：沿木梯纵断面每 0.68 m 一级，踏板 2.6 m 宽、顶面齐这一级上沿的沙面，下沿露出 0.36 m 的踢面；
        /// 每四级一对扶栏立柱。程序化木件（还没有资产），带碰撞，人走在踏板上
        /// </summary>
        static void BuildStair(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Dune Stair · 木梯").transform;
            root.SetParent(props, false);
            var wood = LevelKit.Mat(Dir, "DuneStairTimber", new Color(0.47f, 0.33f, 0.21f), 0.9f);
            var dir = (StairFoot - StairTop).normalized;
            var side = new Vector2(dir.y, -dir.x);
            float len = Vector2.Distance(StairTop, StairFoot), run = TreadRise * len / PlatformY;
            int n = Mathf.FloorToInt(len / run);
            float yaw = YawOf(dir);
            for (int i = 0; i < n; i++)
            {
                var up = StairTop + dir * (i * run);
                var c = up + dir * (run * 0.5f);
                float top = set.GroundY(up.x, up.y) + 0.03f;
                LevelKit.Box($"Tread {i + 1:00}", root, new Vector3(c.x, top - 0.18f, c.y), new Vector3(StairWidth, 0.18f, run + 0.04f), yaw, wood, 0.45f);
                if (i % 4 != 0) continue;
                foreach (int k in new[] { -1, 1 })
                {
                    var post = up + side * (k * (StairWidth * 0.5f + 0.12f));
                    LevelKit.Box($"Post {i + 1:00}{(k < 0 ? "L" : "R")}", root, set.OnGround(post.x, post.y), new Vector3(0.14f, 1.05f, 0.14f), yaw, wood, 0.4f);
                }
            }
        }

        /// <summary>
        /// 散布：戈壁三件（砾石、骆驼刺、红柳）避开泉水、庭院、观景台、木梯和驼道；泉边加一条芦苇（南岸密、北岸稀、尖角成丛，月牙阁正前方留出水岸）。
        /// 芦苇还没有资产（SM_Env_DesertReeds），先用散布系统的程序化灌丛占位网格
        /// </summary>
        static void BuildScatter(LevelKit.TerrainSet set, Transform env)
        {
            float Clear(Vector2 p)
            {
                LevelKit.CrescentLocal(p, Spring, out float along, out float across, out float hw);
                float d = Mathf.Abs(along) < 1 ? Mathf.Abs(across) - hw : 50f;
                d = Mathf.Min(d, LevelKit.BoxSdf(p, TempleMin, TempleMax));
                d = Mathf.Min(d, Vector2.Distance(p, Platform) - PlatformR - 1);
                d = Mathf.Min(d, StairPath.Nearest(p, 30).dist - StairHalf);
                d = Mathf.Min(d, TrailPath.Nearest(p, 30).dist - TrailHalf);
                return Mathf.Max(0, d);
            }
            var rules = LevelKit.ScatterPresets.Details("Desert").ToList();
            rules.Add(new LevelKit.ScatterRule
            {
                name = "DesertReeds", prefab = "SM_Env_DesertReeds", placeholder = LevelKit.Placeholder.Shrub, lod = 1,
                perHundredSqm = 9f, scale = new Vector2(1.1f, 1.8f), slope = new Vector2(0, 22), clump = 0.45f, clumpScale = 10, seed = 17,
                castShadows = true, alignToGround = 0.15f,
                where = pt =>
                {
                    LevelKit.CrescentLocal(pt.p, Spring, out float along, out float across, out float hw);
                    if (Mathf.Abs(along) > 1.12f) return 0;
                    // 水边：水里 1.2 m 到岸上 4 m；南岸（月牙怀里，across < 0）密、北岸稀、尖角成丛；月牙阁正前方的水岸空着
                    float band = Smooth(-1.2f, 0, Mathf.Abs(across) - hw) * (1 - Smooth(2.5f, 4.5f, Mathf.Abs(across) - hw));
                    float bank = across < 0 ? 1f : 0.35f;
                    float tips = 1 + 0.6f * Smooth(0.65f, 0.95f, Mathf.Abs(along));
                    return band * bank * tips * (1 - Disc(pt.p, new Vector2(0, -1), 7, 3));
                },
            });
            var counts = LevelKit.ScatterDetails(set, rules, Clear, 1f, 180f);
            Debug.Log($"[Level] 1-4 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}");
        }

        /// <summary>
        /// 鸣沙山观景台（出生）：一块安全的起步台——只有安全区（<see cref="SafeZone"/>，半径 11 m：敌人进不来，首领关门槛在台上不触发），
        /// 不开店（补给营在 1-3 寺院塔院，刚买完补给，不再连着来一家店）。台沿立一通碑、一对火盆夹着木梯口；货堆、陶罐、柴捆是驼队歇脚的样子
        /// </summary>
        static SafeZone BuildPlatform(LevelKit.TerrainSet set, Transform props, Transform markers)
        {
            var at = set.OnGround(Platform.x, Platform.y);
            var go = new GameObject("Start Platform · 观景台");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(Flat(set.OnGround(Pavilion.x, Pavilion.y) - at)));
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 11f;
            var root = new GameObject("Start Platform Props").transform;
            root.SetParent(props, false);
            var dir = (StairFoot - Platform).normalized;
            var side = new Vector2(dir.y, -dir.x);
            foreach (int k in new[] { -1, 1 })
                Put("SM_Tripo_DesertBrazier", root, set, Platform + dir * 8.8f + side * (k * 3f), 0, new Vector3(1.3f, 2.4f, 1.2f), 0, 0.05f);
            Put("SM_Prop_DesertStele", root, set, Platform + new Vector2(7.5f, 2.7f), YawOf(-dir), new Vector3(1.7f, 3.8f, 2.1f), 0, 0.05f);
            Put("SM_Tripo_DesertGoodsPile", root, set, Platform + new Vector2(4f, 7f), 20, new Vector3(1.7f, 1.6f, 1.3f), 0, 0.1f);
            Put("SM_Prop_DesertUrns", root, set, Platform + new Vector2(-0.5f, 8f), 0, new Vector3(0.8f, 0.8f, 0.8f), 0, 0.05f);
            Put("SM_Tripo_DesertBrushwoodPile", root, set, Platform + new Vector2(7.5f, -2.7f), 40, new Vector3(1.2f, 1.3f, 1.2f), 0, 0.05f);
            return zone;
        }

        /// <summary>
        /// 首领场地（<see cref="BossArena"/>，只给 boss_hanba）：圆心 (−2, 4)、半径 44 m（盆底 112 × 92 m 里，西缘就是西环沙山的坡脚）。
        /// 出生点 = 泉心（凸顶），面朝入场点；入场点 = 木梯脚往前几步；召唤点四个，避开泉水、楼阁和沙丘；
        /// 掩体点：月牙阁敞厅（Cover_Pavilion，BS2 三阶段查深影用它）、回廊廊下、沙丘岛与东沙丘的落沙坡脚、两侧白杨树影；
        /// 栖落点：沙丘岛顶、东沙丘顶、月牙阁二层台；边缘点一圈 8 个。另给出口点（庭院）与宝箱落点（泉北沙地）。
        /// 名字里带 Island 的栖落 / 掩体点给 boss-hanba 套件的日轮荫蔽冒烟用（盆底的新月丘就是这张图的「岛」）
        /// </summary>
        static BossArena BuildArena(LevelKit.TerrainSet set, Transform markers, out Transform exitPoint, out Transform rewardPoint)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var root = new GameObject("BossArena").transform;
            root.SetParent(markers, false);
            root.position = new Vector3(ArenaCenter.x, 0, ArenaCenter.y);
            var arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Circle;
            arena.radius = ArenaRadius;
            Transform Point(string name, Vector3 pos, Vector2 facing)
            {
                var p = new GameObject(name).transform;
                p.SetParent(root, false);
                p.position = pos;
                if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(new Vector3(facing.x, 0, facing.y));
                return p;
            }
            arena.bossSpawn = Point("BossSpawn", G(BossSpawn), PlayerEntry - BossSpawn);
            arena.playerEntry = Point("PlayerEntry", G(PlayerEntry), BossSpawn - PlayerEntry);
            arena.summonPoints = SummonPoints.Select((q, i) => Point($"Summon_{i + 1}", G(q), ArenaCenter - q)).ToArray();
            arena.coverPoints = new[]
            {
                Point("Cover_Pavilion", G(Pavilion + PavilionShadeOffset, PavilionTerrace), Vector2.up),
                Point("Cover_Cloister", G(new Vector2(0, CloisterZ + 0.5f)), Vector2.up),
                Point("Cover_DuneIsland", G(DuneA.Lee(DuneA.SlipRun - 0.6f)), Wind),
                Point("Cover_DuneEast", G(DuneB.Lee(DuneB.SlipRun - 0.6f)), Wind),
                Point("Cover_PoplarWest", G(Poplars[0].at + Wind * 4.5f), Wind),
                Point("Cover_PoplarEast", G(Poplars[4].at + Wind * 4.5f), Wind),
            };
            arena.perchPoints = new[]
            {
                Point("Perch_DuneIsland", G(DuneA.crest), -Wind), Point("Perch_DuneEast", G(DuneB.crest), -Wind),
                Point("Perch_Pavilion", G(Pavilion) + Vector3.up * PavilionDeck, Vector2.up),
            };
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                float a = i * 45f * Mathf.Deg2Rad;
                var off = new Vector2(Mathf.Sin(a), Mathf.Cos(a)) * (ArenaRadius - 2f);
                return Point($"Edge_{i + 1}", G(ArenaCenter + off), -off);
            }).ToArray();
            exitPoint = Point("Boss Exit", G(Courtyard), Vector2.up);
            exitPoint.SetParent(markers, true);
            rewardPoint = Point("Boss Reward", G(RewardAt), PlayerEntry - RewardAt);
            rewardPoint.SetParent(markers, true);
            return arena;
        }

        /// <summary>首领关流程：走进场地 → 登场预警 2.5 s → 旱魃自泉心升起；拴绳 8 m；倒下 → 溃散 → 结算宝箱落在泉北沙地 → 月泉阁庭院升起出口（下一关 2-1）</summary>
        static void BuildEncounter(Transform markers, BossArena arena, Transform exitPoint, Transform rewardPoint)
        {
            var go = new GameObject("Boss Encounter · 旱魃");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2f;
            enc.warnSeconds = 2.5f;
            enc.warnText = "泉水翻涌，沙山轰鸣——旱魃自月牙泉中苏醒！";
            enc.tetherSlack = 8f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
        }

        // ───────────── 验收 ─────────────

        /// <summary>
        /// 一个站立的人被晒到多少（同 SunExposure：胸口 55% 身高、眼高两个探针各占一半，朝太阳打射线，世界几何挡住 = 影子）：0 全影 · 0.5 半影 · 1 全晒
        /// </summary>
        static float Exposure(Vector3 feet, Vector3 toSun)
        {
            float e = 0;
            foreach (float y in new[] { 1.8f * 0.55f, PlayerFactory.EyeHeight })
                if (!Physics.Raycast(feet + Vector3.up * y, toSun, 400f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    e += 0.5f;
            return e;
        }

        /// <summary>
        /// 白盒自查：关键点高度、木梯 / 驼道坡度、露天（没有 SunShaft、主光仰角在 BS2 约定的 30–40°）、日晒与荫蔽（一阶段 31° / 三阶段 85° 的影子比例与关键掩体点）、
        /// 泉水段数与名字、月牙阁 / 回廊 / 树的碰撞体、观景台安全区
        /// </summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, Light sun, List<WaterVolume> waters, GameObject pavilion, List<GameObject> cloisters,
            List<GameObject> trees, SafeZone start, BossArena arena)
        {
            rep.Section("地形");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("盆底（泉北沙地）", Y(new Vector2(0, 26)), 0, 0.6f);
            Near("泉心（凸顶）泉床", Y(SpringApex), -BedDepth(0, Spring.halfWidth), 0.35f);
            Near("观景台", Y(Platform), PlatformY, 0.3f);
            Near("木梯脚", Y(StairFoot), 0, 0.6f);
            Near("驼道脚", Y(TrailPath.At(1)), 0, 0.6f);
            Near("沙丘岛顶", Y(DuneA.crest), DuneA.height, 1.2f);
            Near("东沙丘顶", Y(DuneB.crest), DuneB.height, 1.2f);
            float crestMin = float.MaxValue, crestMax = 0;
            for (int i = 0; i < 36; i++)
            {
                float a = i * 10f * Mathf.Deg2Rad;
                var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                float top = 0;
                for (float r = 40; r < 175; r += 2) top = Mathf.Max(top, Y(FloorCenter + dir * r));
                crestMin = Mathf.Min(crestMin, top);
                crestMax = Mathf.Max(crestMax, top);
            }
            rep.Line($"环形沙山脊高 {crestMin:F0}–{crestMax:F0} m（每 10° 取一条径向线上的最高点）");
            if (crestMin < 20f) rep.Fail($"环形沙山最低处脊高只有 {crestMin:F1} m（应 ≥ 20 m：盆地四面要被沙山围住）");
            float Worst(PathSpline path)
            {
                float worst = 0;
                for (int i = 0; i + 1 < path.points.Count; i++)
                {
                    var a = path.points[i];
                    var b = path.points[i + 1];
                    float d = Vector2.Distance(a, b);
                    if (d < 0.05f) continue;
                    worst = Mathf.Max(worst, Mathf.Atan(Mathf.Abs(Y(b) - Y(a)) / d) * Mathf.Rad2Deg);
                }
                return worst;
            }
            float trailWorst = Worst(TrailPath);
            if (trailWorst > 24f) rep.Fail($"驼道最陡 {trailWorst:F0}°（> 24°），纵断面 {TrailPath.MaxGrade():F0}°");
            else rep.Line($"✓ 驼道长 {TrailPath.length:F0} m、落差 {PlatformY:F0} m，最陡 {trailWorst:F0}°（纵断面 {TrailPath.MaxGrade():F0}°）");
            rep.Line($"木梯长 {StairPath.length:F0} m、落差 {PlatformY:F0} m（{Mathf.Atan(PlatformY / StairPath.length) * Mathf.Rad2Deg:F0}°），踏板每级 {TreadRise} m");

            rep.Section("露天日晒与荫蔽");
            int shafts = Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include).Count(m => m && m.GetType().Name == "SunShaft");
            if (shafts > 0) rep.Fail($"场景里有 {shafts} 个 SunShaft（露天场地不放穴顶开口）");
            if (!sun) rep.Fail("场景里没有主方向光（RenderSettings.sun）");
            float pitch = sun ? Vector3.Angle(sun.transform.forward, Vector3.ProjectOnPlane(sun.transform.forward, Vector3.up)) : SunPitch;
            if (pitch < 30f || pitch > 40f) rep.Fail($"主光仰角 {pitch:F0}°（BS2 约定一阶段 30–40°）");
            else rep.Line($"✓ 主光仰角 {pitch:F0}°、太阳在方位 {(SunYaw + 180) % 360:F0}°（西南偏西）；没有 SunShaft = 露天");
            var toSun1 = sun ? -sun.transform.forward : ToSun(SunPitch);
            var toSun3 = ToSun(RisenPitch);
            int cells = 0;
            float full1 = 0, half1 = 0, full3 = 0;
            for (float x = -ArenaRadius; x <= ArenaRadius; x += 2f)
            for (float z = -ArenaRadius; z <= ArenaRadius; z += 2f)
            {
                if (x * x + z * z > ArenaRadius * ArenaRadius) continue;
                var q = ArenaCenter + new Vector2(x, z);
                var feet = set.OnGround(q.x, q.y);
                cells++;
                float e1 = Exposure(feet, toSun1);
                if (e1 <= 0) full1++;
                else if (e1 < 1) half1++;
                if (Exposure(feet, toSun3) <= 0) full3++;
            }
            float f1 = full1 / Mathf.Max(1, cells), h1 = half1 / Mathf.Max(1, cells), f3 = full3 / Mathf.Max(1, cells);
            rep.Line($"场地里（{cells} 个点，2 m 一格，地面站立）：一阶段 全影 {f1:P0} · 半影 {h1:P0}；三阶段（太阳 {RisenPitch:F0}°）全影 {f3:P0}");
            if (f1 < 0.04f) rep.Fail($"一阶段场地里的全影只有 {f1:P0}（楼阁、回廊、树影应给出可躲的影子）");
            if (f1 > 0.6f) rep.Fail($"一阶段场地里 {f1:P0} 在影子里（日晒失去压力）");
            if (f3 >= f1 && f1 > 0) rep.Fail("太阳推到头顶后影子没有缩小");
            Transform Cover(string name) => arena && arena.coverPoints != null ? arena.coverPoints.FirstOrDefault(t => t && t.name == name) : null;
            bool realPavilion = pavilion && pavilion.tag != LevelKit.PlaceholderTag;
            var pc = Cover("Cover_Pavilion");
            if (!pc) rep.Fail("没有 Cover_Pavilion 掩体点（BS2 三阶段查楼阁深影用）");
            else if (!realPavilion) rep.Warn("月牙阁是占位白盒：掩体点在白盒里面，射线判不出影子，楼阁深影没法查");
            else
            {
                float e1 = Exposure(pc.position, toSun1), e3 = Exposure(pc.position, toSun3);
                if (e3 > 0) rep.Fail($"月牙阁敞厅 {pc.position} 三阶段（太阳 {RisenPitch:F0}°）被晒到 {e3:F1}：二层台没挡住（0 = 全影）");
                if (e1 > 0) rep.Warn($"月牙阁敞厅 {pc.position} 一阶段被晒到 {e1:F1}：斜阳从敞厅西面钻进来——把 PavilionShadeOffset 往东北挪");
                if (e1 <= 0 && e3 <= 0) rep.Line("✓ 月牙阁敞厅一、三阶段都是全影");
            }
            var cc = Cover("Cover_Cloister");
            if (cc)
            {
                float e1 = Exposure(cc.position, toSun1), e3 = Exposure(cc.position, toSun3);
                if (e3 > 0) rep.Warn($"回廊廊下 {cc.position} 三阶段被晒到 {e3:F1}（廊下应是深影：查回廊件的朝向）");
                rep.Line($"回廊廊下：一阶段 {e1:F1}、三阶段 {e3:F1}");
            }
            foreach (var name in new[] { "Cover_DuneIsland", "Cover_DuneEast", "Cover_PoplarWest", "Cover_PoplarEast" })
            {
                var t = Cover(name);
                if (t) rep.Line($"{name}：一阶段 {Exposure(t.position, toSun1):F1}、三阶段 {Exposure(t.position, toSun3):F1}");
            }
            float apex = Exposure(set.OnGround(SpringApex.x, SpringApex.y), toSun1);
            if (apex < 1) rep.Warn($"泉心一阶段只晒到 {apex:F1}（泉心应在太阳下：踩水减半是给全晒的人的）");

            rep.Section("月牙泉 / 月泉阁 / 观景台");
            int named = waters.Count(w => w && w.name.Contains(SpringName));
            rep.Line($"泉水 {waters.Count} 段（水面 y {WaterY}，东深西浅），名字带 {SpringName} 的 {named} 段");
            if (waters.Count < 8) rep.Fail($"泉水只有 {waters.Count} 段（月牙泉应有一弯 ≥ 8 段）");
            if (named != waters.Count) rep.Fail("有泉水段的名字不带 CrescentSpring（BS2 二阶段认不出来、吸不干）");
            bool HasCollider(GameObject go) => go && go.GetComponentsInChildren<Collider>(true).Any(c => c.enabled && !c.isTrigger);
            if (!pavilion) rep.Fail("月牙阁没有摆出来");
            else
            {
                rep.Line($"{(realPavilion ? "✓ 正式件" : "⚠ 白盒")} 月牙阁 {pavilion.name} × {pavilion.transform.localScale.x:F1}，二层台约 {PavilionDeck} m");
                if (!HasCollider(pavilion)) rep.Fail("月牙阁没有碰撞体（日晒判定朝太阳打射线，挡不住）");
            }
            if (cloisters == null || cloisters.Count == 0) rep.Fail("回廊没有摆出来");
            else if (cloisters.Any(c => !HasCollider(c))) rep.Fail("有回廊件没有碰撞体");
            else rep.Line($"✓ 回廊 {cloisters.Count} 间（{cloisters.Count(c => c.tag == LevelKit.PlaceholderTag)} 间白盒）");
            int noCol = trees.Count(t => !HasCollider(t));
            if (noCol > 0) rep.Fail($"{noCol} 棵树没有碰撞体（BS2 约定：沙丘、楼阁、树都要挡得住日晒射线）");
            else rep.Line($"✓ 树 {trees.Count} 棵都有碰撞体（白杨 {trees.Count(t => t.tag == LevelKit.PlaceholderTag)} 棵是占位白盒）");
            if (!start) rep.Fail("观景台上没有起步安全区");
            else rep.Line($"✓ 观景台安全区 {start.radius} m，不开店（补给营在 1-3 寺院塔院）");
        }

        /// <summary>L1 规则（同 1-1）：关卡场景只有环境和标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录；顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), arenas = Count<BossArena>(), encounters = Count<BossEncounter>(),
                camps = Count<SupplyCamp>(), zones = Count<SafeZone>(), portals = Count<ExitPortal>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (arenas != 1 || encounters != 1 || zones != 1) rep.Fail($"BossArena {arenas} / BossEncounter {encounters} / SafeZone {zones}（各应为 1）");
            // 补给营在 1-3 结尾（寺院塔院）：1-4 不再摆店，免得连着两家
            if (camps != 0) rep.Fail($"场景里有 {camps} 个 SupplyCamp（1-4 观景台不开店，补给营在 1-3）");
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1、BossArena / BossEncounter / 观景台 SafeZone 各 1、没有 SupplyCamp，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给 L5 规则集的声明：主线 出生 → 观景台 → 驼道（顶 / 弯 / 脚）→ 入场点 → 沙丘岛顶 → 泉心 → 月牙阁前 → 庭院 → 东沙丘顶 → 首领出生点；
        /// 坡度：驼道（≤ 24°）、木梯（有踏板，放宽到 30°）、两座新月丘的迎风背；地标视线（观景台看月牙阁与泉心、驼道脚看沙丘岛、入场点看首领出生点）；
        /// 场地：观景台（缓冲）、月牙泉首领场（≥ 3 处掩体、两层以上、走得上去的俯射层 = 沙丘岛）；召唤点当刷怪锚点查净空 / 有路（跳鼠刀兵、蝎尾弩卫）。
        /// 软边界没有空气墙：越界按远处的兜底环算（escapeMargin = 兜底距离 + 2 m）。白杨、芦苇还没有资产：占位只列清单（Warn）
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var summonEnemies = new[] { "jerboa_blade", "scorpion_archer" };
            var spec = new LevelSpec
                {
                    id = "1-4", title = "鸣沙山月牙泉", playerSpawn = G(PlayerSpawnAt), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin, placeholders = PlaceholderPolicy.Warn,
                    slopePaths =
                    {
                        new SlopePath { name = "驼道", points = TrailPath.points },
                        new SlopePath { name = "木梯（有踏板）", points = StairPath.points, maxSlope = 30f },
                        new SlopePath { name = "沙丘岛迎风背", points = new[] { DuneA.Back(DuneA.windward - 3f), DuneA.Back(1f) } },
                        new SlopePath { name = "东沙丘迎风背", points = new[] { DuneB.Back(DuneB.windward - 3f), DuneB.Back(1f) } },
                    },
                    sites =
                    {
                        new SiteSpec { name = "鸣沙山观景台（缓冲）", center = G(Platform), size = 20, combat = false },
                        new SiteSpec { name = "月牙泉（首领场）", center = G(ArenaCenter), size = 88, minCover = 3, minLayers = 2, overlook = true },
                    },
                }
                .Route("出生 · 观景台", G(PlayerSpawnAt)).Route("观景台", G(Platform)).Route("驼道顶", G(TrailPath.At(0.08f)))
                .Route("驼道弯", G(TrailPath.At(0.55f))).Route("驼道脚", G(TrailPath.At(1))).Route("入场点", G(PlayerEntry))
                .Route("沙丘岛顶", G(DuneA.crest)).Route("泉心", G(SpringApex)).Route("月牙阁前", G(new Vector2(0, -1)))
                .Route("庭院", G(Courtyard)).Route("东沙丘顶", G(DuneB.crest)).Route("首领出生点", G(BossSpawn))
                .Sight("观景台 → 月牙阁", G(PlayerSpawnAt, 1.62f), G(Pavilion, 9f), 6, PavilionId)
                .Sight("观景台 → 泉心", G(PlayerSpawnAt, 1.62f), new Vector3(SpringApex.x, WaterY + 0.3f, SpringApex.y), 5)
                .Sight("驼道脚 → 沙丘岛顶", G(TrailPath.At(1), 1.62f), G(DuneA.crest, 0.8f), 4)
                .Sight("入场点 → 首领出生点", G(PlayerEntry, 1.62f), G(BossSpawn, 4f), 6);
            for (int i = 0; i < SummonPoints.Length; i++)
                spec.anchors.Add(new AnchorSpec { name = $"Summon_{i + 1}（沙魇召唤点）", pos = G(SummonPoints[i]), enemies = summonEnemies });
            return spec;
        }
    }
}
