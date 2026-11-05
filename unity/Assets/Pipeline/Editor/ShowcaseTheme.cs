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
        /// <summary>渐变天空的地平线锐度 / 地平线辉光（Spiritfire/SkyGradient 的默认值 2.5 / 0.4）：锐度越大，地平线色越贴着地平线、天顶色占得越多</summary>
        public float skyHorizonSharpness = 2.5f, skyHorizonGlow = 0.4f;
        /// <summary>渐变天空里的太阳：颜色 = 主光色 × skySunTint，日面大小 / 光晕（Spiritfire/SkyGradient 的默认值 0.03 / 0.6）</summary>
        public Color skySunTint = Color.white;
        public float skySunSize = 0.03f, skySunHalo = 0.6f;
        public Color ambientSky, ambientEquator, ambientGround;
        public Color fogColor;
        public float fogStart, fogEnd;
        public Color fireColor = new(1f, 0.55f, 0.22f);
        public float fireIntensity = 6f;

        // ── 后处理（单遍：第二批 E 路起枪模不再是叠加相机，世界只后处理一遍）──
        // 以前世界被主相机和枪模相机各后处理一遍。前三章的值是按「那时第一人称看到的样子」重新拟合的（playtest fp-grade-ch1/2/3：
        // 同一帧里拍两遍后处理的参照、在单遍上拟合 曝光 / 对比 / 饱和 / 色温 / 色调 / 暗角 / Bloom / 提升 / 伽马 / 增益，
        // scripts/unity/fp_grade_combine.py 按各关的敏感度合成每章一套；改前的值留在 FpGradeSuite.Old）。新章节直接按单遍调。
        public float postExposure, contrast, saturation, temperature, tint;
        public float bloomIntensity = 0.55f, bloomThreshold = 1f;
        public Color bloomTint = Color.white;
        public float vignette = 0.2f;
        /// <summary>LiftGammaGain 的整体分量（w）：提升 / 伽马 / 增益，0 = 不变</summary>
        public float lift, gamma, gain;
        /// <summary>
        /// 第一人称曝光补偿（Spiritfire.Game.FirstPersonExposure）：上面的调色为了世界变重了，枪模、手、枪口火焰进后处理之前提亮回改前的亮度——
        /// 颜色 = fpExposure × 颜色^fpGamma（枪模和手臂），刀光 / 枪口火焰这些粒子特效 × fpEffects，枪口火焰颜色饱和度 × fpEffectsSaturation，白芯再 × fpFlash。
        /// 全部 1 = 不补偿（新章节按单遍调色，不用它）
        /// </summary>
        public float fpExposure = 1f, fpGamma = 1f, fpEffects = 1f, fpEffectsSaturation = 1f, fpFlash = 1f;

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
            postExposure = -0.919f, contrast = 24.4f, saturation = -11, temperature = -9.5f, tint = -0.5f, lift = -0.007f, gamma = 0.258f, gain = -0.084f, fpExposure = 2.755f, fpGamma = 1.2f, fpEffects = 1.3f, fpEffectsSaturation = 1.15f, fpFlash = 1, vignette = 0.276f, bloomIntensity = 0.496f, bloomTint = new(1f, 0.9f, 0.78f),
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
            postExposure = -0.827f, contrast = 17.2f, saturation = -6.1f, temperature = -21.8f, tint = 3.6f, lift = -0.004f, gamma = 0.111f, gain = -0.107f, fpExposure = 2.86f, fpGamma = 1.2f, fpEffects = 1.4f, fpEffectsSaturation = 1.15f, fpFlash = 1, vignette = 0.278f, bloomTint = new(0.85f, 0.93f, 1f),
            bloomIntensity = 0.311f,
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
            // 色彩脚本（2026-11-04 美术清理，docs/art/ch3-look.md、docs/art/composition.md 第 6 节；fx-style §2.2「暗紫玄武岩，配铜色和橙色」）：
            //   冷暗部：岩、地是低饱和偏冷的暗紫灰玄武岩；暖光只来自熔岩、铜器、火盆、引导灯——所以主光是烟里透下来的淡紫白，不再是橙光，
            //   暖色留给熔岩点光和自发光，冷暖才分得开。三块主色 631：暗紫玄武岩 / 铜褐（路面、铸铁件）/ 熔岩橙；青金只给引导灯、灵火。
            //   明暗：一盏主光（1.45）定阴影形状，环境光只托住暗部（偏紫、不发黑），后处理对比 30 把明度拉开——崖面和背光面是大块暗部，受光的地、路是中间调，熔岩最亮。
            //   天：上部压成靛紫烟（天顶色占大半，地平线锐度 14），只有贴着地平线的一窄条泛暖橙；雾是暗紫暮色，50 → 340 m 把近、中、远三层拉开。
            //   以前是满屏同一个红褐：橙色主光 + 饱和红天 + 红褐雾 + 对比 40.8 / 饱和 +6 / 色温 +8.7 的后处理，色相和明暗全挤在中暗调。
            // 主光仰角 38°（以前 20°：大半个地面压在长影里，路面的铜色出不来；3-2 / 3-3 / 3-4 各自另抬）
            sunColor = new(0.93f, 0.86f, 0.87f), sunIntensity = 1.45f, sunEuler = new(38, 30, 0),
            // 天的混色在线性空间里做：地平线的暖橙比天顶亮一个数量级，锐度不够大的话一成的地平线色就把整片天染成红褐——
            // 所以地平线色压暗一档、锐度 14，暖色靠贴地平线的辉光（0.5）出一窄条；仰角 8° 以上就是靛紫烟
            gradientSky = true, skyTop = new(0.13f, 0.11f, 0.23f), skyHorizon = new(0.5f, 0.24f, 0.13f), skyBottom = new(0.1f, 0.075f, 0.12f), skyExposure = 1f,
            skyHorizonSharpness = 14f, skyHorizonGlow = 0.5f,
            // 烟里的太阳只是一团暗暖的光晕：以前日面是主光色 × 6 的 HDR 白盘，一抬头就是画面里最亮、最跳的东西，抢了怪（composition.md 第 6 节）
            skySunTint = new(0.2f, 0.16f, 0.14f), skySunSize = 0.05f, skySunHalo = 0.35f,
            ambientSky = new(0.18f, 0.17f, 0.3f), ambientEquator = new(0.2f, 0.17f, 0.24f), ambientGround = new(0.3f, 0.17f, 0.11f),
            fogColor = new(0.2f, 0.16f, 0.23f), fogStart = 50, fogEnd = 340,
            fireColor = new(1f, 0.45f, 0.15f), fireIntensity = 9f,
            // 单遍后处理，直接按观感调（不再拟合两遍时代的红褐调）：曝光 +0.25 一次定死（之后的明暗靠主光 → 环境 → 点光，不拿曝光补布光）、对比 30 拉开明度、
            // 色温往冷、色调往品红一点（暗部偏紫），提升一点黑位（暗部是紫灰，不是死黑）；Bloom 阈值 1.05——只有 HDR 自发光（熔岩、火盆、灯）过阈值
            postExposure = 0.25f, contrast = 30f, saturation = 4f, temperature = -4f, tint = 3, lift = 0.01f, gamma = 0, gain = 0, fpExposure = 2, fpGamma = 1.08f, fpEffects = 1.1f, fpEffectsSaturation = 1, fpFlash = 1, bloomTint = new(1f, 0.78f, 0.55f),
            bloomIntensity = 0.55f, bloomThreshold = 1.05f, vignette = 0.22f,
            groundA = new(0.2f, 0.18f, 0.23f), groundB = new(0.3f, 0.26f, 0.3f), groundShadowTint = new(0.55f, 0.5f, 0.74f),
            groundPattern = GroundPattern.LavaCracks,
        };

        /// <summary>
        /// 第四章 · 雪域天路（docs/unity-ch4-port.md；fx-style §2.2 第四章底色）：高原的强日光、深蓝天、青绿草甸、白雪、白墙赭红、五色经幡。
        /// 4-1 的构建器（LevelKit.PlateauTheme）用它建光照、天空、雾和 VP_Plateau.asset；bridge.sh volumes（LevelVolumes）按它重写 VP_Plateau。
        /// 光照、天空、雾、地表照 M1 按网页 backdrop.ts 调的值（深蓝天顶、浅色地平线、雾很远——贡嘎在 1 km 外也看得见）。
        /// 后处理是单遍（枪模和世界同一遍，8ee2a54d 之后）下直接按观感调的：第四章没有两遍时代的「改前」，不拟合、不做第一人称补偿（FirstPersonExposure 全 1）。
        ///   2026-11-01 F 路用 playtest look-plateau（fp-look 同一套机位：出生、中段远眺、主线两段，第一人称、上半屏去掉枪模区）比了 8 组：
        ///   构建器原来的本地值（曝光 −0.15、对比 10、饱和 −4、色温 −3）亮度 140、饱和 88，草偏黄绿荧光、白塔和雪顶发白；
        ///   定下的值：曝光 −0.35、对比 20、饱和 0、色温 −14、色调 +6、暗角 0.18、Bloom 0.45 / 阈值 1.0、提升 / 伽马 / 增益 0——
        ///   上半屏亮度 134.5、饱和度 115.6、对比度 25.9（参照：1-1 为 101 / 124 / 33，2-1 为 57 / 162 / 24）。色温往冷、色调往品红一点，
        ///   把草从黄绿拉到青绿、天压成深蓝，雪顶和白墙留住层次；高原比沙寺、霜山都亮一档是有意的（强日光、空气透）。
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
            // 高原（M1 照网页 backdrop.ts / SKY.sunDir）：太阳高而白、天顶深蓝、浅色地平线；草甸和雪的反弹让环境光地面一侧偏亮绿灰
            sunColor = new(1f, 0.96f, 0.88f), sunIntensity = 1.45f, sunEuler = new(48, 51, 0),
            gradientSky = true, skyTop = new(0.16f, 0.39f, 0.78f), skyHorizon = new(0.79f, 0.88f, 0.95f), skyBottom = new(0.62f, 0.7f, 0.74f), skyExposure = 1f,
            ambientSky = new(0.46f, 0.58f, 0.82f), ambientEquator = new(0.62f, 0.68f, 0.72f), ambientGround = new(0.36f, 0.4f, 0.3f),
            // 空气稀薄：雾很远很淡，偏天蓝（贡嘎在 1 km 外也看得见）
            fogColor = new(0.79f, 0.88f, 0.95f), fogStart = 160, fogEnd = 1300,
            fireColor = new(0.62f, 0.94f, 1f), fireIntensity = 5f,
            // 单遍后处理（见上）
            postExposure = -0.35f, contrast = 20, saturation = 0, temperature = -14, tint = 6, bloomTint = new(0.95f, 0.97f, 1f),
            bloomIntensity = 0.45f, bloomThreshold = 1f, vignette = 0.18f,
            groundA = new(0.36f, 0.58f, 0.21f), groundB = new(0.5f, 0.64f, 0.27f), groundShadowTint = new(0.56f, 0.64f, 0.86f),
            groundPattern = GroundPattern.Drifts,
        };

        public static readonly ShowcaseTheme[] All = { Desert, Frost, Inferno };
    }
}
