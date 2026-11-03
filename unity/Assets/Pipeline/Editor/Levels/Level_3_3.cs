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
    /// 3-3 铸范大坊 · 铸范梯坊与火神王座（docs/level-design/maps/3-3.md；上位设计 docs/level-design/ch3-v2.md 第 5.3 节，M33）。
    /// 祝融的铸坊是一面朝王座爬升的三级梯坊：王座的熔岩柱落进神范台熔池，熔铜沿十字渠、主渠流出，在 (100, 110) 翻过梯坊边一级级跌下去（熔铜瀑，0 → −4 → −8 → −12），
    /// 在南闸楼前汇成熔铜潭。玩家从最低处（南闸楼，T0 −12）进来，逆着熔铜往上走，抬头永远是王座。
    ///   T0 −12 南闸前地（出生）→ T1 −8 ① 范场（西）、③ 浇包吊坊（东，熔流闸 S4），熔铜瀑把两边切开，B1 瀑下桥（路遇）
    ///   → T2 −4 东中台（③ 的俯射层）→ B2 瀑上桥 → 殿东道 → ②④ 鼓风正殿 → 殿北坡 → T3 0 风闸（俯瞰殿内）→ ④ → ⑥ 神范前庭 → B5 → ⑤ 神范台（首领场，原样）。
    /// 梯坊之间是 4 m 的陡坎，场地之外是火山口壁伸进来的玄武岩岩丘（翻不上去）——没有空气墙，边界和分隔都是地形。
    /// 神范台块（x 104–200、z 106–214：首领场、十字浅渠、熔池、四座小桥、神范台、前庭瞭望台、火神王座、主渠、横渠东段、B5、B6、两扇领主熔铁闸）按原坐标保留，
    /// 首领场西、南两侧外 12 m（主渠西岸 x 84–96、横渠南岸 z 94–106）保持 0 m（风险 5）。
    /// 场景只放环境和标记（D17 / L1）。第三章新件（ART6 + v2 新增）没到货前都是 PlaceOrBox 白盒（PlaceholderPolicy 先 Warn）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-3 铸范大坊（或 bridge.sh level 3-3）。
    /// </summary>
    [LevelBuilder("3-3", ScenePath)]
    public static partial class Level_3_3
    {
        public const string Dir = "Assets/Levels/L3_3_Foundry";
        public const string ScenePath = "Assets/Scenes/L3_3_Foundry.unity";
        const string Name = "L3_3";
        /// <summary>领主（WarlordDef.Id；写字面量，构建器不依赖首领单元的文件）</summary>
        const string BossId = "boss_warlord";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（T0 −12、熔铜潭底 −14.4 都在范围内）；地形外缘落回远景地面 FarY</summary>
        const float Base = 18f, HeightRange = 64f, FarY = 2f;
        static readonly Vector2 Origin = new(-68, -61), Size = new(336, 336);
        /// <summary>火山口底（可玩区）与火山口壁：壁在 RimWall 米内从地面升到 RimTop</summary>
        static readonly Vector2 FloorMin = new(0, 0), FloorMax = new(200, 214);
        const float RimTop = 24f, RimWall = 9f;
        /// <summary>热风从北壁王座往南吹（火星、灰烬的方向）</summary>
        static readonly Vector2 Wind = new Vector2(0.15f, -1f).normalized;

        /// <summary>梯坊四级：T0 南闸前地、T1 范场 / 吊坊、T2 殿 / 东中台、T3 神范台 / 前庭</summary>
        const float T0 = -12f, T1 = -8f, T2 = -4f, T3 = 0f;
        /// <summary>陡坎坡比（4 m 的坎 1.6 m 宽，约 68°：人和地面敌人上不去，二段跳 2.68 m 也翻不上 4 m）、岩丘从场地边升起的宽度</summary>
        const float CliffSlope = 2.5f, RockWall = 3f;

        static LevelKit.BoundarySpec Bounds
        {
            get
            {
                var b = LevelKit.BoundarySpec.Default;
                b.theme = "Inferno";
                return b;
            }
        }

        // ───────────── 梯坊（可走区）─────────────

        /// <summary>一块可走区：圆角矩形（round 米圆角）+ 边缘起伏（wobble 米，神范台块、桥头、闸台附近不起伏），台面高 level</summary>
        sealed class Zone
        {
            public string name;
            public float level, round, wobble;
            public Vector2 min, max;
            public int seed;

            public float Sdf(Vector2 p)
            {
                float r = Mathf.Min(round, Mathf.Min(max.x - min.x, max.y - min.y) * 0.5f - 0.05f);
                float d = LevelKit.BoxSdf(p, min + Vector2.one * r, max - Vector2.one * r) - r;
                if (wobble > 0 && d > -8f && d < 8f) d += wobble * Fbm(p, 11f, 2, seed) * WobbleMask(p);
                return d;
            }
        }

        static int zoneSeed;
        static Zone Z(string name, float level, Vector2 min, Vector2 max, float round = 3f, float wobble = 1.2f) =>
            new() { name = name, level = level, min = min, max = max, round = round, wobble = wobble, seed = 101 + 7 * zoneSeed++ };

        static readonly Zone[] Zones =
        {
            // T0 −12：南闸前地（出生）、熔铜潭岸
            Z("南闸前地", T0, new(72, 2), new(146, 18), 5, 1.5f),
            Z("闸楼坡前", T0, new(82, 2), new(106, 28), 3, 0),
            Z("熔铜潭岸", T0, new(100, 8), new(136, 40), 6, 1.2f),
            // T1 −8：① 范场（西）、③ 浇包吊坊（东），中间是熔铜瀑与 B1 瀑下桥
            Z("① 范场", T1, new(26, 27), new(76, 74), 5, 1.5f),
            Z("瀑前台", T1, new(74, 30), new(100, 46), 4, 1.2f),
            Z("① 去 B1", T1, new(74, 44), new(100, 58), 3, 1f),
            Z("B1 去 ③（瀑池东岸）", T1, new(105, 44), new(128, 70), 3, 1f),
            Z("③ 浇包吊坊", T1, new(126, 34), new(182, 72), 5, 1.5f),
            Z("③ 铸门后", T1, new(178, 42), new(194, 66), 4, 1f),
            // T2 −4：西坡顶、殿东道、鼓风正殿、殿西北口、废范龛、东中台（③ 的俯射层，东引坡从这里接南岸台）
            Z("西坡顶", T2, new(22, 92), new(42, 128), 6, 2f),
            Z("殿东道", T2, new(74, 84), new(100, 108), 5, 1.2f),
            Z("殿东道北", T2, new(74, 104), new(86, 130), 4, 1.2f),
            Z("鼓风正殿", T2, new(14, 128), new(84, 164), 2, 0),
            Z("殿西北口", T2, new(12, 160), new(34, 186), 3, 1f),
            Z("废范龛", T2, new(8, 182), new(38, 208), 6, 2f),
            Z("东中台", T2, new(98, 72), new(198, 92), 3, 1f),
            // T3 0：神范前庭、主渠西岸（东廊）、神范台块（首领场 + 主渠 + 横渠）、横渠南岸
            Z("神范前庭", T3, new(56, 166), new(96, 212), 3, 1.5f),
            Z("主渠西岸", T3, new(84, 106), new(96, 170), 0, 0),
            Z("神范台块", T3, new(96, 106), new(200, 214), 0, 0),
            Z("横渠南岸", T3, new(104, 94), new(200, 106), 0, 0),
        };

        /// <summary>一段坡道（可走区的一种）：坡脚 → 坡顶，剖面 30% 缓入缓出 + 70% 直坡；两侧是陡坎</summary>
        sealed class RampZone
        {
            public string name;
            public Vector2 foot, top;
            public float footY, topY, width;
            public float Y(float t) => Mathf.Lerp(footY, topY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
            public float Sdf(Vector2 p, out float t) => LevelKit.SegmentDistance(p, foot, top, out t) - width * 0.5f;
            public float Length => Vector2.Distance(foot, top);
        }

        static RampZone R(string name, Vector2 foot, Vector2 top, float footY, float topY, float width) =>
            new() { name = name, foot = foot, top = top, footY = footY, topY = topY, width = width };

        static readonly RampZone[] Ramps =
        {
            R("西南坡", new(74, 16), new(60, 34), T0, T1, 10),
            R("东南坡", new(138, 14), new(150, 36), T0, T1, 10),
            R("西坡", new(34, 70), new(32, 96), T1, T2, 10),
            R("吊坊西北坡", new(122, 50), new(122, 75), T1, T2, 9),
            R("东引坡", new(192, 72), new(192, 94), T2, T3, 8),
            R("殿北坡", new(38, 168), new(62, 168), T2, T3, 8),
        };

        static RampZone RampByName(string n) => Ramps.First(r => r.name == n);

        // ───────────── 熔铜渠 ─────────────
        /// <summary>
        /// 一条直渠：中线两端（地形沿它挖槽）、半宽、熔岩基准面、渠底、熔岩沿轴的范围、渠岸（领主战的漫溢带）。
        /// 铸坊的渠（field）：8 m 宽、约 54° 的斜壁（2.6 m 内从渠底升到床面）、熔岩面低于床面 1 m——只能走桥；
        /// 神范台的十字浅渠（arena）：8 m 宽、缓坡（魔将冲锋能冲过去）、熔岩面低于床面 0.45 m，两侧各 3 m 渠岸会被魔将引得漫上来
        /// </summary>
        sealed class Channel
        {
            public string name;
            public Vector2 a, b;
            public float half, lava, floor, strip, lo, hi;
            public bool arena;
            /// <summary>熔岩沿轴的流向（+1 = 朝 b 端）</summary>
            public float flow;
            public bool NS => Mathf.Abs(b.x - a.x) < 0.01f;
            public float Yaw => NS ? 0f : 90f;
            public Vector2 At(float t) => NS ? new Vector2(a.x, t) : new Vector2(t, a.y);
        }

        const float FieldHalf = 4f, FieldLava = -1.0f, FieldFloor = -2.4f, FieldWall = 2.6f;
        const float ArenaHalf = 4f, ArenaLava = -0.45f, ArenaFloor = -0.6f, ArenaBank = 2f, BankStrip = 3f;
        /// <summary>领主战漫溢：比基准面高 0.75 m（熔岩面 +0.3，渠岸床面上的人站进熔岩）</summary>
        const float SurgeRise = 0.75f;
        /// <summary>铸坊渠 / 熔铜瀑的自动涨落（风闸拉开后才开）：只在渠里涨 0.6 m，漫不上梯坊</summary>
        const float TideHeight = 0.6f;

        // 神范台块里的直渠（原坐标）：主渠 x 96–104 南流到 (100, 110)；横渠只剩东段 x 104–200，西流汇进主渠口
        static readonly Channel Cross = new() { name = "横渠", a = new(100, 110), b = new(208, 110), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = 104, hi = 203, flow = -1 };
        static readonly Channel Trunk = new() { name = "主渠", a = new(100, 110), b = new(100, 222), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = 114, hi = 217, flow = -1 };
        static readonly Channel ArenaX = new()
        {
            name = "神范南北渠", a = new(152, 110), b = new(152, 222), half = ArenaHalf, lava = ArenaLava, floor = ArenaFloor, strip = BankStrip, lo = 114, hi = 217, arena = true, flow = -1,
        };
        static readonly Channel ArenaZ = new()
        {
            name = "神范东西渠", a = new(100, 164), b = new(208, 164), half = ArenaHalf, lava = ArenaLava, floor = ArenaFloor, strip = BankStrip, lo = 104, hi = 203, arena = true, flow = -1,
        };
        static readonly Channel[] Channels = { Cross, Trunk, ArenaX, ArenaZ };
        /// <summary>神范台中央熔池：渠半径 7 m，漫溢圈 10 m</summary>
        static readonly Vector2 Basin = new(152, 164);
        const float BasinR = 7f;

        /// <summary>
        /// 熔铜瀑：从主渠口 (100, 110) 翻过梯坊边一级级跌到熔铜潭。每个点带所在台面高度（渠底 = 台面 − 2.4，熔岩面 = 台面 − 1）；
        /// 相邻两点台面不同的那一小段（2.5 m）就是瀑口——渠底在这里陡落 4 m，没有熔岩判定，画一片熔瀑
        /// </summary>
        static readonly (Vector2 p, float level)[] Falls =
        {
            (new(100, 110), T3), (new(100, 107.5f), T3),
            (new(99.8f, 105), T2), (new(99, 96), T2), (new(99, 86), T2), (new(102, 80), T2), (new(102, 76.5f), T2),
            (new(102, 74), T1), (new(102, 66), T1), (new(102, 60), T1), (new(103, 52), T1), (new(105, 45), T1), (new(106, 42.5f), T1),
            (new(107, 40), T0), (new(111, 33), T0), (new(117, 29), T0), (new(124, 26), T0),
        };
        /// <summary>瀑池（T1，D2 瀑下）与熔铜潭（T0，南闸楼前）</summary>
        static readonly (string name, Vector2 c, float r, float level)[] Pools =
        {
            ("瀑池", new(102, 66), 6.5f, T1),
            ("熔铜潭", new(124, 26), 8.5f, T0),
        };
        /// <summary>① 溢流槽：瀑池往西分出一股，穿过岩丘流进 ① 东侧的废铜池（① 的击退熔岩岸）</summary>
        static readonly Vector2[] Spill = { new(97, 64.5f), new(86, 63.5f), new(77, 64.5f), new(72.5f, 65.5f) };
        const float SpillHalf = 2.5f;
        static readonly Vector2 SpillPit = new(70, 66);
        const float SpillPitR = 3.5f;
        /// <summary>炉前熔池（鼓风正殿西头大炉前，殿里的击退熔岩岸）：浅池，熔岩面低于殿地 0.8 m</summary>
        static readonly Vector2 FurnacePit = new(19, 146);
        const float FurnacePitR = 3.5f;

        // ───────────── 桥 ─────────────
        /// <summary>桥：中心、沿桥方向（桥长）、桥长、桥宽、桥所在台面。铸坊的桥 0.8 m 厚，神范台的 0.4 m；桥面比台面高 5 cm</summary>
        sealed class Bridge
        {
            public string id, name;
            public Vector2 center, along;
            public float span, width, level;
            public bool arena;
            /// <summary>跨的直渠（熔铜瀑上的桥为 null）与沿渠轴的位置</summary>
            public Channel ch;
            public float at;
            public float Thick => arena ? 0.4f : 0.8f;
            public float DeckY => level + DeckTop;
        }

        static Bridge OnChannel(string id, string name, Channel ch, float at, float width) => new()
        {
            id = id, name = name, ch = ch, at = at, center = ch.At(at), along = ch.NS ? Vector2.right : Vector2.up, span = ch.half * 2f + 4f, width = width,
            level = T3, arena = ch.arena,
        };

        static Bridge OnFalls(string id, string name, Vector2 center, float level, float width) => new()
        {
            id = id, name = name, center = center, along = Vector2.right, span = FieldHalf * 2f + 4f, width = width, level = level,
        };

        /// <summary>桥面比台面高 5 cm（压在台面上，不和地形面打架）</summary>
        const float DeckTop = 0.05f;

        static readonly Bridge[] Bridges =
        {
            OnFalls("B1", "瀑下桥", new Vector2(103, 52), T1, 12),
            OnFalls("B2", "瀑上桥", new Vector2(99, 88), T2, 10),
            OnChannel("B5", "闸前桥", Trunk, 176, 10),
            OnChannel("B6", "东铸北桥", Cross, 178, 12),
            OnChannel("AN", "神范北桥", ArenaX, 190, 8),
            OnChannel("AS", "神范南桥", ArenaX, 138, 8),
            OnChannel("AW", "神范西桥", ArenaZ, 126, 8),
            OnChannel("AE", "神范东桥", ArenaZ, 178, 8),
        };

        static Bridge BridgeById(string id) => Bridges.First(b => b.id == id);

        // ───────────── 台 ─────────────
        /// <summary>台（地形）：矩形台面高 base + h，坡道（坡脚 → 台顶，宽）</summary>
        sealed class Platform
        {
            public string name;
            public Vector2 min, max;
            public float h, baseY;
            public (Vector2 foot, Vector2 top, float width)[] ramps;
            public Vector2 Center => (min + max) * 0.5f;
            public Vector2 Half => (max - min) * 0.5f;
            public float Top => baseY + h;
        }

        static Platform P(string name, float baseY, Vector2 min, Vector2 max, float h, params (Vector2 foot, Vector2 top, float width)[] ramps) =>
            new() { name = name, baseY = baseY, min = min, max = max, h = h, ramps = ramps };

        /// <summary>出生闸台 3.5 m（顶 −8.5）：站高一点，从出生点越过横渠南岸的崖边看得到神范</summary>
        static readonly Platform GatePlatform = P("南闸楼闸台", T0, new(84, 0), new(102, 12), 3.5f, (new Vector2(93, 23f), new Vector2(93, 12.2f), 8f));
        static readonly Platform PierWest = P("范场吊梁西墩", T1, new(26, 46), new(32, 56), 5f, (new Vector2(29, 72f), new Vector2(29, 56.2f), 5f));
        static readonly Platform PierEast = P("范场吊梁东墩", T1, new(69, 46), new(75, 56), 5f, (new Vector2(72, 31f), new Vector2(72, 45.8f), 5f));
        static readonly Platform AltarNorth = P("炉坛（北）", T2, new(14, 150), new(22, 160), 3.5f, (new Vector2(32, 155), new Vector2(22.2f, 155), 5f));
        static readonly Platform AltarSouth = P("炉坛（南）", T2, new(14, 128), new(24, 136), 3.5f, (new Vector2(34, 132), new Vector2(24.2f, 132), 5f));
        static readonly Platform Service = P("检修台", T2, new(74, 150), new(82, 162), 3f, (new Vector2(78, 140.5f), new Vector2(78, 149.8f), 5f));
        static readonly Platform GateTower = P("闸前楼台", T3, new(82, 182), new(94, 194), 3.5f, (new Vector2(88, 205f), new Vector2(88, 194.2f), 5f));
        static readonly Platform Dais = P("神范台", T3, new(176, 192), new(198, 212), 3.5f, (new Vector2(184, 181f), new Vector2(184, 191.8f), 6f));
        static readonly Platform ForecourtRise = P("前庭瞭望台", T3, new(130, 182), new(138, 190), 3f, (new Vector2(124, 176), new Vector2(130, 184), 4f));
        static readonly Platform[] Platforms = { GatePlatform, PierWest, PierEast, AltarNorth, AltarSouth, Service, GateTower, Dais, ForecourtRise };

        // ───────────── 场地 / 标记 ─────────────
        static readonly Vector2 Spawn = new(93, 6);
        static readonly Vector2 FanSite = new(51, 52), RoadSite = new(103, 52), LadleSite = new(154, 54), HallSite = new(49, 146), ForecourtSite = new(78, 190),
            ScrapSite = new(23, 196), ArenaCenter = new(152, 164);
        /// <summary>神范台首领场地：矩形半宽 44 m（x 108–196、z 120–208，西、南两边外面就是主渠和横渠）</summary>
        static readonly Vector2 ArenaHalfSize = new(44, 44);
        static readonly Vector2 BossSpawnAt = new(174, 182), PlayerEntryAt = new(128, 144), ExitAt = new(184, 197), BossRewardAt = new(166, 192), ClearChestAt = new(172, 186);
        /// <summary>神范（巨型铸范，出口在它前面）</summary>
        static readonly Vector2 MouldAt = new(192, 207);
        const float MouldYaw = 225f, MouldScale = 3f;

        // ───────────── 鼓风正殿 ─────────────
        static readonly Vector2 BellowsA = new(36, 146), BellowsB = new(62, 146);
        static readonly Vector3 BellowsSize = new(18, 5, 8);
        const float BellowsRest = 0.56f;
        static readonly float[] ButtressSouthX = { 12, 46, 70 }, ButtressNorthX = { 18, 70 };
        const float ButtressSouthZ = 127f, ButtressNorthZ = 165.5f, ButtressEastX = 84.5f;
        static readonly float[] ButtressEastZ = { 136, 156 };
        static readonly Vector2[] HallColumns = { new(42, 131), new(56, 131), new(70, 131), new(42, 161), new(56, 161), new(70, 161) };
        /// <summary>殿顶屋架：架在南北两排铁柱上（跨 30 m），下缘离殿地 14 m</summary>
        static readonly float[] TrussX = { 42, 56, 70 };
        /// <summary>炉门喷火的两条风箱道（第二次进殿）</summary>
        static readonly (Vector2 from, Vector2 to)[] FireLanes = { (new Vector2(26, 137), new Vector2(76, 137)), (new Vector2(26, 156), new Vector2(72, 156)) };
        static readonly Vector2 FurnaceAt = new(10, 146);
        /// <summary>风闸：殿北坡顶旁、前庭西南角的崖边，朝南俯瞰鼓风正殿（拉开就看得见风箱鼓起来）</summary>
        static readonly Vector2 WindGateAt = new(67, 173.5f);
        const float WindGateYaw = 200f;
        /// <summary>主渠渠头的炉闸（北壁正中，王座下）</summary>
        static readonly Vector2 SluiceAt = new(100, 215.5f);

        // ───────────── ③ 浇包吊坊 · 熔流闸 ─────────────
        /// <summary>浇包吊车：横梁走道南北向架在 x = CraneX，北端搭在东中台崖边（走道顶 = 东中台 −4，玩家走得上去），南端立柱在 ③ 里</summary>
        const float CraneX = 172f, CraneNorthZ = 73.5f, CraneSouthZ = 45f, CraneDeckW = 3.5f, CraneDeckThick = 0.8f;
        static readonly float[] CraneLegZ = { 44.5f, 67.5f };
        /// <summary>两口浇包：吊在横梁下，各倒向一条浇铸槽（熔流往西冲，迎着从工棚后冲过来的敌人）</summary>
        static readonly LevelKit.LavaSluiceSpec SluiceSouth = new()
        {
            name = "南浇包", path = new[] { new Vector2(CraneX - 1.5f, 50), new Vector2(150, 50), new Vector2(134, 44) },
            hangAt = new Vector3(CraneX, T2 - CraneDeckThick - 0.05f, 50), ladleScale = 2f,
        };
        static readonly LevelKit.LavaSluiceSpec SluiceNorth = new()
        {
            name = "北浇包", path = new[] { new Vector2(CraneX - 1.5f, 62), new Vector2(150, 62), new Vector2(137, 60) },
            hangAt = new Vector3(CraneX, T2 - CraneDeckThick - 0.05f, 62), ladleScale = 2f,
        };
        static readonly LevelKit.LavaSluiceSpec[] Sluices = { SluiceSouth, SluiceNorth };

        // ───────────── 美术 ID ─────────────
        // 第三章件（ART6 + v2 新增，docs/art/ch3-kit.md、ch3-v2.md 第 6 节）：到货前都是 PlaceOrBox 白盒
        const string MouldId = "SM_Tripo_InfernoCastingMould", BedId = "SM_Tripo_InfernoCastingBed", BellowsId = "SM_Tripo_InfernoBellows",
            GateId = "SM_Tripo_InfernoMoltenGate", BridgeId = "SM_Tripo_InfernoIronBridge", CraneId = "SM_Tripo_InfernoLadleCrane",
            TrussId = "SM_Tripo_InfernoHallTruss", ShedId = "SM_Tripo_InfernoWorkShed";
        /// <summary>必须到齐才把占位检查收紧成不合格的件（锦上添花件缺了有替代：工棚 → 锻铺放大）</summary>
        static readonly string[] Ch3Kit = { MouldId, BedId, BellowsId, GateId, BridgeId, CraneId, TrussId };
        // 已有的祝融套件
        const string ColumnId = "SM_Tripo_InfernoColumn", ButtressId = "SM_Tripo_InfernoHallButtress", HallWallId = "SM_Tripo_InfernoHallWall",
            FurnaceId = "SM_Tripo_InfernoFurnaceTower", AltarId = "SM_Tripo_InfernoFireAltar", IngotsId = "SM_Tripo_InfernoIngotPile",
            CoverWallId = "SM_Tripo_InfernoCoverWall", BarricadeId = "SM_Tripo_InfernoBarricade", RuinId = "SM_Tripo_InfernoCauldronRuin",
            StallId = "SM_Tripo_InfernoForgeStall", HoardId = "SM_Tripo_InfernoTreasureHoard", CrucibleId = "SM_Prop_InfernoCrucible",
            ObeliskId = "SM_Prop_InfernoChainObelisk", GatewayId = "SM_Tripo_InfernoGateway";
        static readonly Vector3 MouldSize = new(3.2f, 2.8f, 2.2f), BedSize = new(8f, 1.4f, 5f), GateSize = new(10f, 9f, 1.4f),
            TrussSize = new(24f, 9f, 8f), ShedSize = new(10f, 7f, 8f),
            ColumnSize = new(1.97f, 4.93f, 1.81f), ButtressSize = new(4.51f, 17.84f, 3.74f), HallWallSize = new(8.17f, 15.8f, 2.57f),
            FurnaceSize = new(6.13f, 12.86f, 4.99f), AltarSize = new(1.13f, 2.36f, 1.15f), IngotsSize = new(2.18f, 1.52f, 1.81f),
            CoverWallSize = new(3.42f, 2.48f, 0.89f), BarricadeSize = new(3.56f, 1.18f, 0.47f), RuinSize = new(3.11f, 1.54f, 1.53f),
            StallSize = new(2.6f, 3.47f, 1.63f), HoardSize = new(2.31f, 1.71f, 1.56f), CrucibleSize = new(1.27f, 0.99f, 1.28f),
            ObeliskSize = new(1.08f, 2.13f, 1.08f), GatewaySize = new(11.31f, 10.75f, 2.2f);

        // ───────────── 地貌 ─────────────

        static float SegDist(Vector2 p, Vector2 a, Vector2 b) => LevelKit.SegmentDistance(p, a, b, out _);

        /// <summary>神范台块（床面压平：渠岸的漫溢判定按床面 y 0 算）</summary>
        static float ArenaMask(Vector2 p) => 1 - Smooth(0, 6, LevelKit.BoxSdf(p, new Vector2(104, 114), new Vector2(200, 214)));

        /// <summary>可玩区：火山口底往壁里 1 m 以内（壁本身翻不上去；等值线外由软边界推回）</summary>
        static float Playable(Vector2 p) => 1 - Smooth(0, 4, LevelKit.BoxSdf(p, FloorMin + Vector2.one, FloorMax - Vector2.one));

        /// <summary>可走区边缘起伏的遮罩：神范台块、主渠西岸、横渠南岸（风险 5 要压平）、桥头、闸台附近为 0</summary>
        static float WobbleMask(Vector2 p)
        {
            float d = LevelKit.BoxSdf(p, new Vector2(84, 94), new Vector2(200, 214));
            foreach (var b in Bridges) d = Mathf.Min(d, Vector2.Distance(p, b.center) - b.span * 0.5f - 3f);
            d = Mathf.Min(d, LevelKit.BoxSdf(p, GatePlatform.min, GatePlatform.max) - 2f);
            return Smooth(0, 6, d);
        }

        /// <summary>
        /// 梯坊：所有可走区（含坡道）的台面取最高（高的那一级从边上陡落 CliffSlope 坡比的坎）；
        /// edge = 离最近一块可走区的有符号距离（区内为负），near = 那一块的台面高，high = 附近最高的台面（岩丘高度的基准）
        /// </summary>
        static float Terraces(Vector2 p, out float edge, out float near, out float high, out float rampMask)
        {
            float h = float.NegativeInfinity;
            edge = float.MaxValue;
            near = T0;
            high = float.NegativeInfinity;
            rampMask = 0;
            foreach (var z in Zones)
            {
                float d = z.Sdf(p);
                h = Mathf.Max(h, z.level - CliffSlope * Mathf.Max(0, d));
                high = Mathf.Max(high, z.level - 0.5f * Mathf.Max(0, d - 8f));
                if (d < edge)
                {
                    edge = d;
                    near = z.level;
                }
            }
            // 坡道：坡道走廊里压成坡面（下半段填、上半段在上一级台面里切一道坡口），走廊外两侧是陡坎
            foreach (var r in Ramps)
            {
                float d = r.Sdf(p, out float t);
                float y = r.Y(t);
                h = Mathf.Max(h, y - CliffSlope * Mathf.Max(0, d));
                if (d < 0) h = Mathf.Lerp(h, y, Smooth(0, 1.2f, -d));
                high = Mathf.Max(high, y - 0.5f * Mathf.Max(0, d - 8f));
                if (d < 0) rampMask = Mathf.Max(rampMask, Smooth(0, 1.5f, -d));
                if (d < edge)
                {
                    edge = d;
                    near = y;
                }
            }
            // 台（吊梁墩、炉坛、楼台…）的顶也算进岩丘基准：岩丘要比附近最高的站立面高 3 m 以上，二段跳（2.68 m）也上不去
            foreach (var pl in Platforms)
                high = Mathf.Max(high, pl.Top - 0.5f * Mathf.Max(0, LevelKit.BoxSdf(p, pl.min, pl.max) - 8f));
            return h;
        }

        /// <summary>熔铜瀑的渠底（按最近一段插值台面 − 2.4）与离中线的距离</summary>
        static float FallsFloor(Vector2 p, out float dist)
        {
            dist = float.MaxValue;
            float floor = 0;
            for (int i = 0; i + 1 < Falls.Length; i++)
            {
                float d = LevelKit.SegmentDistance(p, Falls[i].p, Falls[i + 1].p, out float t);
                if (d >= dist) continue;
                dist = d;
                floor = Mathf.Lerp(Falls[i].level, Falls[i + 1].level, t) + FieldFloor;
            }
            return floor;
        }

        /// <summary>挖一条渠（斜壁深槽）：d = 离中线的距离；返回挖过的高度，trench = 槽遮罩</summary>
        static float Carve(float h, float d, float half, float wall, float floor, ref float trench)
        {
            if (d > half + 0.5f) return h;
            float k = Smooth(half - wall, half, d);
            trench = Mathf.Max(trench, 1 - k);
            return Mathf.Min(h, Mathf.Lerp(floor, h, k));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float arena = ArenaMask(p);

            // ── 梯坊 + 坡道 ──
            float h = Terraces(p, out float edge, out float near, out float high, out float rampMask);
            h += 0.08f * Fbm(p, 30, 2, 3) * (1 - arena) * (1 - rampMask);

            // ── 岩丘：可走区外 RockWall 米内升起，比附近最高的站立面高 3.2–7.7 m（二段跳上不去，又不至于把梯坊挡成一圈高墙），大块起伏、不做细碎裂纹 ──
            float rock = 0;
            if (edge > 0)
            {
                float top = Mathf.Max(near, high) + 3.2f + 3f * Ridged(p, 11, 3, 9) + 1.5f * Smooth(-0.3f, 0.5f, Fbm(p, 30, 2, 5));
                float k = Smooth(0, RockWall, edge);
                h = Mathf.Max(h, Mathf.Lerp(near, top, k));
                rock = Smooth(0.4f, 2.4f, edge);
            }

            // ── 台（闸台、吊梁墩、炉坛、检修台、闸前楼台、神范台、前庭瞭望台），坡道一起 ──
            float plat = 0;
            foreach (var pl in Platforms)
            {
                float v = Plateau(p, pl.Center, pl.Half, 0, pl.h, 0.6f, pl.ramps);
                if (v <= 0) continue;
                h = Mathf.Max(h, pl.baseY + v);
                plat = Mathf.Max(plat, Smooth(pl.h - 0.4f, pl.h - 0.05f, v));
                foreach (var (foot, tp, w) in pl.ramps)
                {
                    var (_, m) = Ramp(p, foot, tp, w, 0.6f);
                    rampMask = Mathf.Max(rampMask, m);
                }
            }

            // ── ③ 浇铸槽（熔流闸的熔流道，浅槽，敌人走得进去）──
            float sluice = 0;
            foreach (var sp in Sluices)
            {
                h = LevelKit.SluiceTrough(p, sp.path, h, sp.troughHalf, sp.troughDepth, out float m);
                sluice = Mathf.Max(sluice, m);
            }

            // ── 熔铜渠：神范台块的直渠、熔铜瀑（随梯坊跌落）、瀑池 / 熔铜潭、① 溢流槽、炉前熔池 ──
            float trench = 0;
            foreach (var c in Channels)
                h = Carve(h, SegDist(p, c.a, c.b), c.half, c.arena ? ArenaBank : FieldWall, c.floor, ref trench);
            float fallsFloor = FallsFloor(p, out float fallsDist);
            h = Carve(h, fallsDist, FieldHalf, FieldWall, fallsFloor, ref trench);
            foreach (var (_, c, r, level) in Pools)
                h = Carve(h, Vector2.Distance(p, c), r, FieldWall, level + FieldFloor, ref trench);
            {
                var (d, _) = Polyline(p, Spill);
                h = Carve(h, d, SpillHalf, FieldWall, T1 + FieldFloor, ref trench);
                h = Carve(h, Vector2.Distance(p, SpillPit), SpillPitR, FieldWall, T1 + FieldFloor, ref trench);
            }
            h = Carve(h, Vector2.Distance(p, FurnacePit), FurnacePitR, 2f, T2 - 1.6f, ref trench);
            h = Carve(h, Vector2.Distance(p, Basin), BasinR, ArenaBank, ArenaFloor, ref trench);

            // ── 火山口壁：可玩区外 RimWall 米内升起（60–75°，翻不上去），大尺度高低差形成锯齿轮廓 ──
            float outside = LevelKit.BoxSdf(p, FloorMin, FloorMax);
            if (outside > -0.5f)
            {
                float rim = RimTop + 7f * Fbm(p, 22, 3, 7) + 8f * Ridged(p, 15, 3, 11);
                float k = Smooth(0, RimWall, outside);
                h = Mathf.Lerp(h, Mathf.Max(h, rim), k);
                rock = Mathf.Max(rock, Smooth(0.5f, 3f, outside));
            }
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY, h, Smooth(0, 36, edgeDist));
            s.h = Base + h;

            // ── 分层倾向：渠里结壳熔岩、渠边余烬岸、浇铸槽、台面与坡道踩出的灰路、岩丘与火山口壁玄武岩 ──
            float de = fallsDist - FieldHalf;
            foreach (var c in Channels) de = Mathf.Min(de, SegDist(p, c.a, c.b) - c.half);
            float bank = de > 0 ? 1 - Smooth(0, 3.5f, de) : 0;
            s.fluid = Mathf.Max(Smooth(0.3f, 0.8f, trench), sluice * 0.7f);
            s.shore = bank * 0.8f * (1 - rock);
            s.packed = Mathf.Max(plat, rampMask * 0.9f) * (1 - rock);
            float patches = Smooth(0.1f, 0.5f, Fbm(p, 22, 3, 9)) * 0.6f;
            s.sand = patches * (1 - s.fluid) * (1 - plat) * (1 - rock);
            s.rock = rock;
            return s;
        }

    }
}
