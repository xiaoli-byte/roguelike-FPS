using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>粒子混合方式：加法（发光类）/ 普通透明（烟、尘、碎屑）</summary>
    public enum FxBlend
    {
        Additive,
        Alpha,
    }

    /// <summary>
    /// 程序贴图集 T_FxAtlas 的格子（4 × 8，每格 256 px，第 0 格在左上角，与 Shuriken 的帧序一致）。
    /// 贴图由 <see cref="FxTextures"/> 生成，FxBuilder 写成 Assets/Art/Fx/T_FxAtlas.png。0–7 是 F1 的，8–15 是 FX1 / FX2 加的，
    /// 16–22 是 FX3（冰霜）/ FX4（火狱）加的，23–31 留空。
    /// </summary>
    public enum FxTexture
    {
        /// <summary>柔光：平方衰减 + 白热核心</summary>
        Glow = 0,
        /// <summary>火花：小而硬的亮核 + 光晕</summary>
        Spark = 1,
        /// <summary>拉丝：窄的高斯亮条（圆对称，拉伸广告牌按速度拉长）</summary>
        Streak = 2,
        /// <summary>烟团：噪声起伏的柔边圆，上亮下暗</summary>
        Smoke = 3,
        /// <summary>细圆环（冲击环、光环）</summary>
        Ring = 4,
        /// <summary>碎屑：硬边菱形，上亮下暗</summary>
        Chunk = 5,
        /// <summary>四角星芒（暴击）</summary>
        Flare = 6,
        /// <summary>尘团：比烟更散更淡</summary>
        Dust = 7,
        /// <summary>碎片：尖三角，一条边亮（护盾碎片、冰碴、玻璃）</summary>
        Shard = 8,
        /// <summary>六边形护盾格：亮边 + 淡芯</summary>
        Hex = 9,
        /// <summary>卡通五角星（眩晕绕头、暴击小星）</summary>
        Star = 10,
        /// <summary>水滴（蚀化滴落、液体飞溅；拉伸广告牌沿速度方向）</summary>
        Drop = 11,
        /// <summary>火舌：下宽上尖、边缘被噪声啃过（灼烧火苗，竖直不旋转）</summary>
        Flame = 12,
        /// <summary>电弧碎纹：一小段折线（感电噼啪）</summary>
        Crackle = 13,
        /// <summary>甲片：带一道高光边的四边形（破甲碎片）</summary>
        Plate = 14,
        /// <summary>符文：小篆式的方折笔画（出生法阵里升起的符点）</summary>
        Glyph = 15,
        /// <summary>冰晶星芒：三道长光芒（六个尖）+ 三道短光芒 + 白热核心（FX3 星芒、霜晶一闪）</summary>
        IceStar = 16,
        /// <summary>雪花：六臂带分叉的雪晶 + 中心六边形（冻雾里飘的雪、霜甲碎开）</summary>
        Snowflake = 17,
        /// <summary>冰块：竖长的六棱柱剪影，左暗右亮、中间一道棱光（碎冰的大块）</summary>
        Crystal = 18,
        /// <summary>纸屑：卷起一角的长方纸片（FX4 火药爆的红纸屑）</summary>
        Paper = 19,
        /// <summary>炭渣：边缘不规则的小块，外壳暗、裂缝亮（加法：一颗发红的炭火 / 熔渣）</summary>
        Cinder = 20,
        /// <summary>链环：椭圆铁环（断链散落）</summary>
        Link = 21,
        /// <summary>液团：圆润的液滴，边缘稍暗、左上一点高光（熔铜流、熔铁飞溅）</summary>
        Blob = 22,
    }

    /// <summary>粒子朝向：面向相机 / 沿速度拉伸（火花拉丝）/ 水平贴地</summary>
    public enum FxRender
    {
        Billboard,
        Stretched,
        Horizontal,
    }

    /// <summary>透明度随寿命的曲线（同 Three.js Particles.ts 的 FADE_*）</summary>
    public enum FxFade
    {
        /// <summary>线性淡出</summary>
        Linear,
        /// <summary>平方淡出（闪光球）</summary>
        Quadratic,
        /// <summary>快速淡入、缓慢淡出（烟、尘）</summary>
        Smoke,
        /// <summary>保持不透明，最后 30% 淡出（碎屑）</summary>
        Hold,
        /// <summary>先亮后暗的闪烁（余烬、光点）</summary>
        Flicker,
        /// <summary>拉丝：(1 − t)(1 − 0.4t)</summary>
        Streak,
        /// <summary>慢慢浮现、停留、慢慢散（FX3 冷雾：前 25% 淡入，最后 35% 淡出）</summary>
        Linger,
    }

    /// <summary>发射方向</summary>
    public enum FxShape
    {
        /// <summary>均匀球面</summary>
        Sphere,
        /// <summary>上半球（y 取绝对值：烟、碎石不往地里钻）</summary>
        UpperSphere,
        /// <summary>球面，但 y &lt; −0.2 的翻上来减半（爆炸火花）</summary>
        MostlyUp,
        /// <summary>法线一侧的半球，再朝法线偏 <see cref="FxLayer.normalBias"/>（弹着点反射火花）</summary>
        Hemisphere,
        /// <summary>以法线为轴、半角 <see cref="FxLayer.coneAngle"/> 度的圆锥</summary>
        Cone,
        /// <summary>水平一圈（暴击星芒），y 只带一点抖动</summary>
        Disc,
        /// <summary>原地不动（闪光、光晕）</summary>
        Point,
    }

    /// <summary>每颗粒子的颜色取法</summary>
    public enum FxColor
    {
        /// <summary>调用方颜色</summary>
        Tint,
        /// <summary>调用方颜色混向白色 <see cref="FxLayer.mix"/>（白热）</summary>
        Hot,
        /// <summary>每 <see cref="FxLayer.every"/> 颗一颗白热，其余调用方颜色</summary>
        Alternate,
        /// <summary>纯白</summary>
        White,
        /// <summary>固定色 <see cref="FxLayer.fixedColor"/> 混入调用方颜色 <see cref="FxLayer.mix"/>（烟 = 深灰 + 18% 主色）</summary>
        Fixed,
        /// <summary>在固定色与调用方颜色之间随机（爆炸火团：亮黄 ↔ 主色）</summary>
        RandomMix,
        /// <summary>章节环境色：<see cref="FxLayer.fixedColor"/> 写沙寺的颜色，按当前章节换成霜山 / 熔火的同明暗色（<see cref="FxTone"/>），再混入调用方颜色 mix（烟、尘、碎屑）</summary>
        Ground,
    }

    /// <summary>
    /// 随规模变化的系数：value(s) = clamp(c + k · s^p, min, max)。
    /// 规模 s 的含义由入口决定：弹着点 = size，爆炸 = 半径，命中 = 1（暴击 1.7）。
    /// </summary>
    [Serializable]
    public struct FxScale
    {
        public float c, k, p, min, max;
        /// <summary>false = 定义里没写（default 结构体），按常数 1 处理</summary>
        public bool set;

        public FxScale(float c, float k, float p = 1, float min = float.NegativeInfinity, float max = float.PositiveInfinity)
        {
            this.c = c;
            this.k = k;
            this.p = p;
            this.min = min;
            this.max = max;
            set = true;
        }

        /// <summary>常数（不随规模变）</summary>
        public static FxScale Const(float v) => new(v, 0);

        /// <summary>c + k·s，可钳上限</summary>
        public static FxScale Lin(float c, float k, float max = float.PositiveInfinity) => new(c, k, 1, float.NegativeInfinity, max);

        /// <summary>k · s^p（p = 0.5 即开方：大命中速度只按 √s 变快）</summary>
        public static FxScale Pow(float p, float k = 1) => new(0, k, p);

        public float Eval(float s)
        {
            if (!set) return 1;
            float v = c + (k == 0 ? 0 : k * (p == 1 ? s : Mathf.Pow(Mathf.Max(0, s), p)));
            return Mathf.Clamp(v, min, max);
        }
    }

    /// <summary>
    /// 一种粒子风格 = 一个共享的 Shuriken 发射器（世界空间、代码逐颗 Emit）：贴图格、混合、朝向、重力、阻尼、
    /// 大小随寿命、透明度曲线、是否与地形碰撞弹跳。FxBuilder 据此生成 Resources/Fx/Presets/&lt;Id&gt;.prefab；
    /// 预制体缺失时运行时按同一份描述现场搭（<see cref="FxSetup.Configure"/>），两条路径结果一致。
    /// </summary>
    public sealed class FxParticle
    {
        public FxBlend blend = FxBlend.Additive;
        public FxTexture texture = FxTexture.Glow;
        public FxRender render = FxRender.Billboard;
        /// <summary>重力（m/s²，向下为正；负值上浮）</summary>
        public float gravity;
        /// <summary>速度阻尼（每秒指数衰减系数，同 Three.js drag）</summary>
        public float drag;
        /// <summary>寿命结束时的大小倍率（&lt;1 缩小，&gt;1 膨胀）</summary>
        public float grow = 1;
        public FxFade fade = FxFade.Linear;
        /// <summary>峰值不透明度</summary>
        public float alpha = 1;
        /// <summary>与地形 / 建筑碰撞弹跳（火花、碎屑）</summary>
        public bool bounce;
        /// <summary>拉伸广告牌：长度 = 大小 × lengthScale + 速度 × velocityScale</summary>
        public float stretchVelocity = 0.02f, stretchLength = 1f;
        /// <summary>随机自转速度上限（度 / 秒，碎屑）；初始角度随机</summary>
        public float spin;
        /// <summary>同屏上限（超出时新发射的丢弃）；运行时再乘画质系数（<see cref="FxBudget.StyleCapScale"/>）</summary>
        public int maxParticles = 1000;
        /// <summary>出生时随机转一个角度（火舌、符文这类有上下的贴图关掉，保持竖直）</summary>
        public bool randomRotation = true;
        /// <summary>同一混合方式内的先后（大的后画、盖在上面）。贴脸淡出在共用材质上（0.12–0.9 m），不按风格分</summary>
        public int sortOrder;
        /// <summary>序列帧（非 null 时不用 T_FxAtlas 的 <see cref="texture"/> 格，改播一段序列帧、用它自己的材质；见 <see cref="FxFlipbook"/>）</summary>
        public FxFlipbook flipbook;
    }

    /// <summary>
    /// 粒子的序列帧（特效打磨 B 路）：材质（Resources/Fx/Materials 下的名字，贴图是一整张 columns × rows 的图集）+ 播哪一段帧。
    /// 一颗粒子在寿命里从 first 播到 first + count − 1（cycles 遍），开帧混合；另外把年龄比例、稳定随机数作为顶点流送进着色器
    /// （SF_FxToon 靠年龄比例做「硬边啃掉」的消散和冷却）。
    /// </summary>
    public sealed class FxFlipbook
    {
        public string material;
        public int columns = 8, rows = 8;
        public int first, count = 1;
        public float cycles = 1;
    }

    /// <summary>
    /// 一层发射：往哪个风格里、发几颗、什么方向、多快、多大、活多久、什么颜色。
    /// 数量 / 速度 / 大小 / 散布都可以随规模 s 变（<see cref="FxScale"/>）；数量还乘画质密度（<see cref="Fx.Density"/>）。
    /// </summary>
    public sealed class FxLayer
    {
        /// <summary>发射进哪个风格预设（null = 预设自己的风格）</summary>
        public string style;
        public FxScale count = FxScale.Const(1);
        /// <summary>数量上限（乘密度之后再钳）</summary>
        public int maxCount = 240;
        /// <summary>数量乘画质密度（闪光核心这类「只有一颗」的不乘）</summary>
        public bool density = true;

        public FxShape shape = FxShape.Sphere;
        /// <summary>圆锥半角（度）</summary>
        public float coneAngle = 35;
        /// <summary>半球发射时朝法线的偏置（Three.js impact：0.7）</summary>
        public float normalBias;

        /// <summary>初速度区间（m/s）× speedScale(s)</summary>
        public Vector2 speed = new(1, 3);
        public FxScale speedScale;
        /// <summary>额外向上的初速度（m/s）</summary>
        public float up;
        /// <summary>向上初速度的随机抖动 ±upJitter（m/s，暴击星芒）</summary>
        public float upJitter;

        /// <summary>直径区间（m）× sizeScale(s)</summary>
        public Vector2 size = new(0.1f, 0.2f);
        public FxScale sizeScale;
        /// <summary>寿命区间（s）</summary>
        public Vector2 life = new(0.3f, 0.6f);

        /// <summary>出生点沿法线外移（m）</summary>
        public float offset;
        /// <summary>出生点沿发射方向随机外移 [0, spread(s)]（m）</summary>
        public FxScale spread = FxScale.Const(0);
        /// <summary>出生点竖直方向的散布倍率（爆炸余烬：横向 0.4r、竖向 0.3r）</summary>
        public float spreadY = 1;
        /// <summary>散布的下限比例：出生点外移 [spreadMin, 1] × spread(s)（0.85 ≈ 贴在半径 spread 的球壳上：护盾格从身体表面崩开）</summary>
        public float spreadMin;

        public FxColor color = FxColor.Tint;
        public Color fixedColor = Color.white;
        /// <summary>Hot / Fixed 的混合比例</summary>
        public float mix = 0.45f;
        /// <summary>Alternate：每几颗一颗白热</summary>
        public int every = 2;
        /// <summary>亮度随机倍率区间（烟、碎屑的深浅不一）；(1,1) = 不变</summary>
        public Vector2 shade = Vector2.one;
        public float alpha = 1;

        /// <summary>延迟发射（s）：二段爆、余波</summary>
        public float delay;
    }

    /// <summary>闪光灯（<see cref="FxLightPool"/>）：强度 / 范围随规模变，起亮极快、二次衰减</summary>
    public sealed class FxLightSpec
    {
        public FxScale intensity = FxScale.Const(4);
        public FxScale range = FxScale.Const(6);
        public float life = 0.3f;
        public FxColor color = FxColor.Tint;
        public Color fixedColor = Color.white;
        public float mix = 0.3f;
        /// <summary>沿法线抬高（m），免得灯埋进墙里</summary>
        public float lift = 0.3f;
    }

    /// <summary>贴地冲击环（离地太高的爆炸不画）</summary>
    public sealed class FxRingSpec
    {
        public FxScale radius = FxScale.Lin(0, 1.5f);
        public float duration = 0.42f;
        /// <summary>中心离地高度 &lt; heightFactor × s 才画（爆炸在半空就不贴地）</summary>
        public float heightFactor = 0.9f;
        /// <summary>中小型环（2–8 m）带一圈竖直光墙</summary>
        public bool band;
    }

    /// <summary>贴花（焦痕、弹孔）：离地太高的爆炸不画，见 <see cref="FxDecals"/></summary>
    public sealed class FxDecalSpec
    {
        public FxDecalKind kind = FxDecalKind.Scorch;
        /// <summary>直径（米）随规模变</summary>
        public FxScale size = FxScale.Lin(0, 2.6f);
        /// <summary>中心离地高度 &lt; heightFactor × s 才画</summary>
        public float heightFactor = 0.9f;
        /// <summary>初始余热 0..1（发光的灼痕，几秒内冷却）</summary>
        public float heat = 1f;
        /// <summary>存在时长（秒，最后 2 s 淡出）</summary>
        public float life = 16f;
    }

    /// <summary>按距离的震屏：k = 1 − 距离 / range(s)，强度 strength(s) · k²，时长 duration(s) + durationPerK · k</summary>
    public sealed class FxShakeSpec
    {
        public FxScale strength = FxScale.Const(0.3f);
        public FxScale range = FxScale.Const(12);
        public FxScale duration = FxScale.Const(0.22f);
        public float durationPerK = 0.2f;
    }

    /// <summary>
    /// 特效预设（docs/unity-parity.md 4.3：一条预设 = 一个 G/Fx/Presets/&lt;Id&gt;.cs，带 [Defs] 自动登记）。
    ///   <see cref="Particle"/> 非空 → 这是一种粒子风格，FxBuilder 生成 Resources/Fx/Presets/&lt;Id&gt;.prefab（共享发射器）；
    ///   <see cref="Layers"/> → 播放时按层发射（可以发进别的风格）；再加可选的闪光灯、贴地环、震屏。
    /// 播放入口：<see cref="Fx.Play(string, Vector3, Vector3, Color, float)"/>，组合特效（Impact / EnemyHit / Explosion）也走这里。
    /// </summary>
    public abstract class FxPreset : IDef
    {
        public abstract string Id { get; }

        /// <summary>本预设自己的粒子风格；null = 只组合别的风格</summary>
        public FxParticle Particle { get; protected set; }

        public FxLayer[] Layers { get; protected set; } = Array.Empty<FxLayer>();

        /// <summary>播放时先把这些预设的层一起发出（同一个句柄、同样的颜色 / 规模；只取层，不取它们的灯 / 环 / 震屏）</summary>
        public string[] Includes { get; protected set; }
        public FxLightSpec Light { get; protected set; }
        public FxRingSpec Ring { get; protected set; }
        public FxShakeSpec Shake { get; protected set; }
        /// <summary>落地的贴花（爆炸焦痕）</summary>
        public FxDecalSpec Decal { get; protected set; }

        /// <summary>调用方不给颜色时的默认色</summary>
        public Color DefaultColor { get; protected set; } = Color.white;

        /// <summary>规模钳制区间（防止调用方传离谱的值）</summary>
        public float ScaleMin { get; protected set; } = 0.05f;
        public float ScaleMax { get; protected set; } = 40f;

        public override string ToString() => Id;
    }

    /// <summary>纯粒子风格预设（风格组文件 Presets/Styles.cs 用）：自带一层默认发射，Fx.Play(风格名) 也能直接用</summary>
    public sealed class FxStylePreset : FxPreset
    {
        readonly string id;

        public override string Id => id;

        public FxStylePreset(string id, FxParticle particle, FxLayer defaultLayer = null, Color? color = null)
        {
            this.id = id;
            Particle = particle;
            Layers = defaultLayer != null ? new[] { defaultLayer } : Array.Empty<FxLayer>();
            if (color.HasValue) DefaultColor = color.Value;
        }
    }
}
