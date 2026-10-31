using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 展示场景的章节主题：同一套广场布局（城门 + 城墙套件 + 集市 + 高台 + 远景），按「角色」换成各章资产，
    /// 再配各章的光照、天空、雾、后处理与地表。新增章节只加一个主题，不复制布局代码。
    /// 美术方向见 art/README.md：沙寺暖砂岩 + 靛青 / 赤陶点缀；霜山蓝灰石木 + 积雪、少量暖色；熔火暗紫玄武岩 + 铜 / 橙。
    /// </summary>
    public sealed class ShowcaseTheme
    {
        public string key, title;
        public string ScenePath => $"Assets/Scenes/Showcase_{key}.unity";

        // ── 布局角色 → 资产 ID（缺的角色跳过）──
        public string gateway, cornerTower, panel, plainPanel, endL, endR;
        public string column, columnRuin, barricade, coverWall, stall, goods, hoard, brazier, platform, stairs, shrine;
        public string landmark, rock, cliff, statue, farWall, farWallPlain;
        public float statueScale = 1.3f, cliffScale = 1f;

        /// <summary>中央角色排：(资产 ID, 离地高度)。漂浮角色给正值。</summary>
        public (string id, float hover)[] actors;
        public string weapon = "SK_Weapon_Revolver", armR, armL;
        /// <summary>章节 Boss（放在城门前的空地上，同样按演示周期出招）；没有原生骨架 Boss 的章节留空</summary>
        public string boss;

        // ── 光照 ──
        public Color sunColor;
        public float sunIntensity;
        public Vector3 sunEuler;
        public Color skyTint, skyGround;
        public float skyExposure, atmosphere;
        /// <summary>设了就用 Spiritfire/SkyGradient（天顶 / 地平线 / 地面三色），否则用 Skybox/Procedural。</summary>
        public bool gradientSky;
        public Color skyTop, skyHorizon, skyBottom;
        public Color ambientSky, ambientEquator, ambientGround;
        public Color fogColor;
        public float fogStart, fogEnd;
        public Color fireColor = new(1f, 0.55f, 0.22f);
        public float fireIntensity = 6f;

        // ── 后处理 ──
        public float postExposure, contrast, saturation, temperature;
        public float bloomIntensity = 0.55f, bloomThreshold = 1f;
        public Color bloomTint = Color.white;
        public float vignette = 0.2f;

        // ── 地表：两色手绘色斑 + 纹理笔触；熔火加岩浆裂纹自发光 ──
        public Color groundA, groundB, groundShadowTint;
        public enum GroundPattern { Ripples, Drifts, LavaCracks }
        public GroundPattern groundPattern;
        public Color lavaColor = new(2.6f, 0.85f, 0.2f);

        public static readonly ShowcaseTheme Desert = new()
        {
            key = "Desert", title = "第一章 · 赤沙古道",
            gateway = "SM_Tripo_DesertGateway", cornerTower = "SM_Tripo_DesertCornerTower",
            panel = "SM_Tripo_DesertRampartPanel", plainPanel = "SM_Tripo_DesertRampartPlainPanel",
            endL = "SM_Tripo_DesertRampartEndL", endR = "SM_Tripo_DesertRampartEndR",
            column = "SM_Tripo_DesertColumn", columnRuin = "SM_Tripo_DesertColumnRuin", barricade = "SM_Tripo_DesertBarricade",
            coverWall = "SM_Tripo_DesertCoverWall", stall = "SM_Tripo_DesertMarketStall", goods = "SM_Tripo_DesertGoodsPile",
            hoard = "SM_Tripo_DesertTreasureHoard", brazier = "SM_Tripo_DesertBrazier", platform = "SM_Tripo_DesertPlatformBlock",
            stairs = "SM_Tripo_DesertStairs", shrine = "SM_Tripo_DesertPortalShrine", landmark = "SM_Env_DesertRuin",
            rock = "SM_Env_DesertSandstone", cliff = "SM_Env_DesertCliff", statue = "SM_Tripo_DesertColossus",
            farWall = "SM_Tripo_DesertRampart", farWallPlain = "SM_Tripo_DesertRampartPlain", cliffScale = 1f,
            actors = new[]
            {
                ("SK_Enemy_JerboaBlade", 0f), ("SK_Enemy_Apsara", 0.35f), ("SK_Hero_RedPanda", 0f), ("SK_Enemy_MirageToad", 0f),
                ("SK_Enemy_ScorpionArcher", 0f), ("SK_Enemy_TombBeast", 0f),
            },
            armR = "SM_Arms_RedPandaR", armL = "SM_Arms_RedPandaL",
            sunColor = new(1f, 0.91f, 0.8f), sunIntensity = 1.45f, sunEuler = new(36, 58, 0),
            skyTint = new(0.6f, 0.62f, 0.7f), skyGround = new(0.62f, 0.5f, 0.38f), skyExposure = 1.3f, atmosphere = 0.8f,
            ambientSky = new(0.44f, 0.52f, 0.7f), ambientEquator = new(0.58f, 0.5f, 0.42f), ambientGround = new(0.34f, 0.27f, 0.21f),
            fogColor = new(0.88f, 0.76f, 0.6f), fogStart = 40, fogEnd = 260,
            postExposure = -0.25f, contrast = 16, saturation = -6, temperature = -4, bloomTint = new(1f, 0.9f, 0.78f),
            groundA = new(0.62f, 0.47f, 0.33f), groundB = new(0.78f, 0.64f, 0.47f), groundShadowTint = new(0.7f, 0.64f, 0.82f),
            groundPattern = GroundPattern.Ripples,
        };

        public static readonly ShowcaseTheme Frost = new()
        {
            key = "Frost", title = "第二章 · 昆仑雪墟",
            gateway = "SM_Tripo_FrostGateway", cornerTower = "SM_Tripo_FrostCornerTower",
            panel = "SM_Tripo_FrostRampartPanel", plainPanel = "SM_Tripo_FrostRampartPlainPanel",
            endL = "SM_Tripo_FrostRampartEndL", endR = "SM_Tripo_FrostRampartEndR",
            column = "SM_Tripo_FrostColumn", columnRuin = "SM_Tripo_FrostColumnRuin", barricade = "SM_Tripo_FrostBarricade",
            coverWall = "SM_Tripo_FrostCoverWall", stall = "SM_Tripo_FrostPrayerTent", goods = "SM_Tripo_FrostOfferings",
            hoard = "SM_Tripo_FrostJadeHoard", brazier = "SM_Tripo_FrostIceLantern", platform = "SM_Tripo_FrostPlatformBlock",
            stairs = "SM_Tripo_FrostStairs", shrine = "SM_Tripo_FrostPortalShrine", landmark = "SM_Env_FrostWayshrine",
            rock = "SM_Env_FrostPine", cliff = "SM_Env_FrostCliff", statue = "SM_Tripo_FrostKaiming", statueScale = 1.2f,
            farWall = "SM_Tripo_FrostRampart", farWallPlain = "SM_Tripo_FrostRampartPlain", cliffScale = 1.1f,
            actors = new[]
            {
                ("SK_Enemy_Fuzhu", 0f), ("SK_Enemy_FoxWitch", 0f), ("SK_Hero_Pangolin", 0f), ("SK_Enemy_Qingniao", 0f),
                ("SK_Enemy_XuanGui", 0f), ("SK_Enemy_FrostCrab", 0f),
            },
            armR = "SM_Arms_PangolinR", armL = "SM_Arms_PangolinL", boss = "SK_Boss_Peng",
            // 低角度冷白日光，雪地强反弹：地面环境色亮、暗部蓝
            sunColor = new(0.9f, 0.95f, 1f), sunIntensity = 1.25f, sunEuler = new(24, 140, 0),
            skyTint = new(0.52f, 0.6f, 0.72f), skyGround = new(0.7f, 0.74f, 0.8f), skyExposure = 1.15f, atmosphere = 0.6f,
            ambientSky = new(0.42f, 0.52f, 0.72f), ambientEquator = new(0.56f, 0.6f, 0.68f), ambientGround = new(0.5f, 0.54f, 0.62f),
            fogColor = new(0.76f, 0.83f, 0.9f), fogStart = 25, fogEnd = 210,
            fireColor = new(0.55f, 0.85f, 1f), fireIntensity = 4f,
            postExposure = -0.35f, contrast = 14, saturation = -10, temperature = -14, bloomTint = new(0.85f, 0.93f, 1f),
            bloomIntensity = 0.5f,
            groundA = new(0.66f, 0.72f, 0.8f), groundB = new(0.84f, 0.88f, 0.93f), groundShadowTint = new(0.55f, 0.64f, 0.9f),
            groundPattern = GroundPattern.Drifts,
        };

        public static readonly ShowcaseTheme Inferno = new()
        {
            key = "Inferno", title = "第三章 · 祝融火狱",
            gateway = "SM_Tripo_InfernoGateway", cornerTower = "SM_Tripo_InfernoFurnaceTower",
            panel = "SM_Tripo_InfernoRampartPanel", plainPanel = "SM_Tripo_InfernoRampartPlainPanel",
            endL = "SM_Tripo_InfernoRampartEndL", endR = "SM_Tripo_InfernoRampartEndR",
            column = "SM_Tripo_InfernoColumn", columnRuin = "SM_Tripo_InfernoCauldronRuin", barricade = "SM_Tripo_InfernoBarricade",
            coverWall = "SM_Tripo_InfernoCoverWall", stall = "SM_Tripo_InfernoForgeStall", goods = "SM_Tripo_InfernoIngotPile",
            hoard = "SM_Tripo_InfernoTreasureHoard", brazier = "SM_Tripo_InfernoFireAltar", platform = "SM_Tripo_InfernoPlatformBlock",
            stairs = "SM_Tripo_InfernoStairs", shrine = "SM_Tripo_InfernoPortalShrine", landmark = "SM_Env_InfernoFoundry",
            rock = "SM_Env_InfernoBasalt", cliff = "SM_Env_InfernoCliff", statue = "SM_Tripo_InfernoZhurong", statueScale = 1.2f,
            farWall = "SM_Tripo_InfernoRampart", farWallPlain = "SM_Tripo_InfernoRampartPlain", cliffScale = 1.1f,
            actors = new[]
            {
                ("SK_Enemy_Mamian", 0f), ("SK_Enemy_Nuo", 0f), ("SK_Hero_FlyingSquirrel", 0f), ("SK_Enemy_Firecracker", 0f),
                ("SK_Enemy_Founder", 0f), ("SK_Enemy_IronOx", 0f),
            },
            armR = "SM_Arms_FlyingSquirrelR", armL = "SM_Arms_FlyingSquirrelL", boss = "SK_Boss_Qilin",
            // 暗红高空光 + 岩浆地面反弹：环境光自下而上是橙，天顶暗紫；Bloom 更强，让岩浆与火坛发光
            sunColor = new(1f, 0.62f, 0.42f), sunIntensity = 1.1f, sunEuler = new(20, 30, 0),
            gradientSky = true, skyTop = new(0.1f, 0.05f, 0.08f), skyHorizon = new(0.78f, 0.3f, 0.12f), skyBottom = new(0.16f, 0.06f, 0.04f), skyExposure = 1f,
            ambientSky = new(0.24f, 0.18f, 0.3f), ambientEquator = new(0.42f, 0.24f, 0.2f), ambientGround = new(0.55f, 0.24f, 0.1f),
            fogColor = new(0.34f, 0.17f, 0.15f), fogStart = 18, fogEnd = 170,
            fireColor = new(1f, 0.45f, 0.15f), fireIntensity = 9f,
            postExposure = 0f, contrast = 18, saturation = 4, temperature = 6, bloomTint = new(1f, 0.75f, 0.55f),
            bloomIntensity = 1.0f, bloomThreshold = 0.9f, vignette = 0.28f,
            groundA = new(0.16f, 0.12f, 0.16f), groundB = new(0.3f, 0.22f, 0.24f), groundShadowTint = new(0.5f, 0.3f, 0.55f),
            groundPattern = GroundPattern.LavaCracks,
        };

        /// <summary>
        /// 第四章 · 雪域天路（docs/unity-ch4-port.md；fx-style §2.2 第四章底色）：高原的强日光、深蓝天、青绿草甸、白雪、白墙赭红、五色经幡。
        /// 关卡构建器 <c>ShowcaseSceneBuilder.BuildLighting(ShowcaseTheme.Plateau, Dir)</c> 生成本关的 VP_Plateau.asset。
        /// 后处理（2026-10-31 F 路，按前三章的数值体系推定，还没在 4-1 场景里对照截图；第一人称渲染一路改成单遍后处理后统一再对一次）：
        ///   曝光 −0.3（雪地反光强，同第二章一档）、对比 18（高原空气透、明暗硬）、饱和 +8（草甸、经幡、深蓝天要鲜）、色温 −6（偏冷但不青）、
        ///   Bloom 0.5 / 阈值 1.0（雪面不糊、只让雷光和灵火发光）、暗角 0.18。
        /// 不在 <see cref="All"/> 里：展示广场没有第四章的建筑套件（第一期只有夔的残鼓），不生成 Showcase_Plateau
        /// </summary>
        public static readonly ShowcaseTheme Plateau = new()
        {
            key = "Plateau", title = "第四章 · 雪域天路",
            actors = new[]
            {
                ("SK_Enemy_Marmot", 0f), ("SK_Enemy_Tiangou", 0f), ("SK_Hero_RedPanda", 0f), ("SK_Enemy_Jufu", 0f),
                ("SK_Enemy_Aoyin", 0f), ("SK_Enemy_Dijiang", 0.35f),
            },
            armR = "SM_Arms_RedPandaR", armL = "SM_Arms_RedPandaL", boss = "SK_Boss_Kui",
            // 高原：太阳高而白、天顶深蓝；草甸和雪的反弹让环境光地面一侧偏亮绿灰
            sunColor = new(1f, 0.97f, 0.92f), sunIntensity = 1.6f, sunEuler = new(48, 210, 0),
            gradientSky = true, skyTop = new(0.07f, 0.2f, 0.55f), skyHorizon = new(0.62f, 0.76f, 0.92f), skyBottom = new(0.52f, 0.58f, 0.6f), skyExposure = 1.1f,
            ambientSky = new(0.38f, 0.52f, 0.8f), ambientEquator = new(0.56f, 0.6f, 0.64f), ambientGround = new(0.34f, 0.38f, 0.27f),
            // 空气稀薄：雾远而淡，偏天蓝（远山贡嘎要看得见）
            fogColor = new(0.7f, 0.8f, 0.92f), fogStart = 60, fogEnd = 420,
            fireColor = new(1f, 0.6f, 0.3f), fireIntensity = 5f,
            postExposure = -0.3f, contrast = 18, saturation = 8, temperature = -6, bloomTint = new(0.94f, 0.96f, 1f),
            bloomIntensity = 0.5f, bloomThreshold = 1f, vignette = 0.18f,
            groundA = new(0.34f, 0.46f, 0.22f), groundB = new(0.5f, 0.58f, 0.3f), groundShadowTint = new(0.5f, 0.58f, 0.86f),
            groundPattern = GroundPattern.Drifts,
        };

        public static readonly ShowcaseTheme[] All = { Desert, Frost, Inferno };
    }
}
