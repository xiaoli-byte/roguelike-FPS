using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>预警形状</summary>
    public enum TelegraphShape
    {
        /// <summary>实心圆（落点、出生点）</summary>
        Circle,
        /// <summary>圆环（内半径以内安全：环形冲击、甜甜圈）</summary>
        Annulus,
        /// <summary>扇形（吐息、横扫；可带内半径 = 扇环）</summary>
        Sector,
        /// <summary>长条（冲锋路径、光束、成排地刺）：从 center 朝 yaw 延伸 radius 米</summary>
        Line,
        /// <summary>辐条（新星冰刺、放射弹幕）：count 条，从 inner 伸到 radius</summary>
        Spokes,
        /// <summary>正多边形（八角台、阵法）：外接圆半径 radius、count 条边</summary>
        Polygon,
    }

    /// <summary>预警样式</summary>
    public enum TelegraphStyle
    {
        /// <summary>预警：由内向外（长条由近到远）填满，紧迫脉动越来越快，填满闪一下消失；可撤回</summary>
        Warning,
        /// <summary>冲击环：亮环扩散到边缘后淡出（线性 = 玩法同步的冲击波，缓出 = 装饰性的爆发范围）</summary>
        Ring,
        /// <summary>持续区域：流动的火焰 / 熔岩纹理，持续 duration 秒（地火、熔池）</summary>
        Zone,
    }

    /// <summary>预警配色</summary>
    public enum TelegraphTone
    {
        /// <summary>按样式：预警 = <see cref="Danger"/>；冲击环、持续区域 = <see cref="Own"/></summary>
        Auto,
        /// <summary>
        /// 危险（会挨打的地方）：不管传进来的元素色，统一用 <see cref="TelegraphPalette.Danger"/> 的高饱和危险色 + 暗衬边，普通混合（不加法——加法在亮沙、冰雪上读不出来）。
        /// 敌人 / 首领的伤害预警默认就是它；元素身份交给出手的特效。
        /// </summary>
        Danger,
        /// <summary>原色：传进来的颜色原样用（灵宠 / 友方技能、出生点、增益圈这类不是「会挨打」的提示，冲击环、持续区域的默认）</summary>
        Own,
    }

    /// <summary>
    /// 预警的统一色板（D21 整改，见 docs/art/review/unity-combat 问题清单）：危险预警全游戏一个色义——
    /// 赤红在亮沙、冰雪、石地上都跳得出来，和沙黄、冰蓝、火元素橙都拉开色相；火狱关（熔岩、火光都是橙红）换电光品红。
    /// 暗衬边是危险色的近黑，铺在亮地表上把亮边托出来。
    /// 特效打磨 C 路：赤红从偏玫瑰（0xff1e46）挪到正红（0xff1c24）；亮沙、冰雪上的淡底改成「地面乘色」（<see cref="DangerMultiply"/>，SF_Telegraph 的乘色通道），
    /// 普通混合的淡红铺在亮地表上只会是粉色，乘色之后是正红、地面纹理还在。
    /// </summary>
    public static class TelegraphPalette
    {
        /// <summary>赤红：沙地、冰雪、石地（正红略偏冷一点，和火元素橙拉开）</summary>
        public static readonly Color Crimson = Hex.Rgb(0xff1c24);
        /// <summary>电光品红：火狱（第三章）——熔岩和火光是橙红，赤红会混进去</summary>
        public static readonly Color Magenta = Hex.Rgb(0xff2bd6);
        /// <summary>危险预警的暗衬边（alpha = 强度）</summary>
        public static readonly Color DangerBacking = new(0.05f, 0f, 0.025f, 0.62f);
        /// <summary>测试 / 演示时强制指定危险色（null = 按关卡）</summary>
        public static Color? Override;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Override = null;

        /// <summary>当前关卡的危险色：第三章（关卡 id 3-x）品红，其余赤红</summary>
        public static Color Danger => Override ?? (InfernoLevel ? Magenta : Crimson);

        /// <summary>
        /// 危险区里地面的乘色（SF_Telegraph 乘色通道，形状内的地面 × 它）：危险色按最亮通道归一后往白里退 10%——
        /// 赤红 ≈ (1, 0.2, 0.22)：亮沙、冰雪乘完是正红；品红 ≈ (1, 0.25, 0.86)
        /// </summary>
        public static Color DangerMultiply => MultiplyFor(Danger);

        public static Color MultiplyFor(Color d)
        {
            float m = Mathf.Max(1e-3f, Mathf.Max(d.r, Mathf.Max(d.g, d.b)));
            return Color.Lerp(new Color(d.r / m, d.g / m, d.b / m, 1), Color.white, 0.1f);
        }

        /// <summary>当前关卡是火狱章（Level Meta 的关卡 id 以「3-」开头）</summary>
        public static bool InfernoLevel
        {
            get
            {
                var meta = LevelMeta.Current;
                return meta && !string.IsNullOrEmpty(meta.levelId) && meta.levelId.StartsWith("3-");
            }
        }

        /// <summary>原色预警的暗衬边：同色压暗</summary>
        public static Color BackingFor(Color c) => new(c.r * 0.12f, c.g * 0.12f, c.b * 0.12f, 0.45f);
    }

    /// <summary>一个预警的全部参数（<see cref="Telegraph.Spawn"/>；常用形状有便捷方法）</summary>
    public struct TelegraphSpec
    {
        public TelegraphShape shape;
        public TelegraphStyle style;
        /// <summary>圆类 / 辐条 / 多边形的中心；长条的起点（y 取附近地面）</summary>
        public Vector3 center;
        /// <summary>朝向（世界 yaw，度）：扇形中线、长条方向、第一条辐条、多边形一条边的法线</summary>
        public float yaw;
        /// <summary>外半径 / 长条长度 / 辐条长度（米）</summary>
        public float radius;
        /// <summary>内半径（环、扇环、辐条起点；米）</summary>
        public float inner;
        /// <summary>扇形半角（度；≥ 180 = 整圈）</summary>
        public float halfAngle;
        /// <summary>长条 / 辐条全宽（米）</summary>
        public float width;
        /// <summary>辐条数 / 多边形边数</summary>
        public int count;
        /// <summary>预警：填满用时；冲击环：扩散用时；区域：持续时间（秒）</summary>
        public float duration;
        /// <summary>预警填满后继续亮着的秒数（沿线依次破土的地刺）</summary>
        public float hold;
        /// <summary>颜色（<see cref="tone"/> = 原色时才用它的 rgb；alpha 乘整体不透明度，0 = 隐形）</summary>
        public Color color;
        /// <summary>配色：默认按样式（预警 = 统一危险色，冲击环 / 区域 = 原色）</summary>
        public TelegraphTone tone;
        /// <summary>加法混合（冲击环默认加法；危险配色一律普通混合）</summary>
        public bool additive;
        /// <summary>冲击环线性扩散（与玩法判定同步的冲击波）；否则缓出</summary>
        public bool linear;

        /// <summary>实际配色（Auto 按样式解析）</summary>
        public readonly bool Danger => tone == TelegraphTone.Danger || tone == TelegraphTone.Auto && style == TelegraphStyle.Warning;
    }

    /// <summary>
    /// 预警句柄（值类型）：查询进度、撤回、改位置 / 朝向 / 半径 / 颜色。槽位被复用或预警结束后所有操作都是空操作。
    /// 可以隐式转换成 <see cref="FxHandle"/>（交给 Fx 作业或 <see cref="WarnScope"/> 统一管理）。
    /// </summary>
    public readonly struct TelegraphHandle
    {
        readonly Telegraph.Slot slot;
        readonly int gen;

        internal TelegraphHandle(Telegraph.Slot slot)
        {
            this.slot = slot;
            gen = slot.gen;
        }

        public static TelegraphHandle None => default;

        /// <summary>还在显示（没结束、没被收起、槽位没被复用）</summary>
        public bool Alive => slot != null && slot.gen == gen && slot.active;

        /// <summary>预警还在填充（没填满、没被撤回）：只有这时候撤回才算数</summary>
        public bool Pending => Alive && slot.Pending;

        /// <summary>填充 / 扩散进度 0..1</summary>
        public float Progress => Alive ? slot.progress : 0;

        /// <summary>撤回（攻击被打断）：只撤还没填满的预警（填满即视为已兑现），停止填充、约 0.1 s 淡出；冲击环 / 区域直接淡出</summary>
        public void Cancel()
        {
            if (Alive) slot.CancelFx();
        }

        /// <summary>不管填没填满，约 0.1 s 淡出</summary>
        public void FadeOut()
        {
            if (Alive) slot.owner.Fade(slot);
        }

        /// <summary>立刻收起（不淡出）</summary>
        public void End()
        {
            if (Alive) slot.owner.Hide(slot);
        }

        /// <summary>挪到新中心（长条：新起点，方向和长度不变）</summary>
        public void MoveTo(Vector3 center)
        {
            if (!Alive || !Fx.Finite(center)) return;
            slot.spec.center = center;
            slot.owner.Place(slot);
        }

        /// <summary>长条：改起点、终点、全宽（蓄力期间跟着朝向更新）</summary>
        public void SetLine(Vector3 from, Vector3 to, float width)
        {
            if (!Alive || !Fx.Finite(from) || !Fx.Finite(to)) return;
            var d = to - from;
            d.y = 0;
            slot.spec.center = from;
            slot.spec.radius = Mathf.Max(0.1f, d.magnitude);
            if (d.sqrMagnitude > 1e-6f) slot.spec.yaw = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            if (width > 0) slot.spec.width = width;
            slot.owner.Place(slot);
        }

        /// <summary>改朝向（世界 yaw，度）</summary>
        public void SetYaw(float yawDeg)
        {
            if (!Alive || !Fx.Finite(yawDeg)) return;
            slot.spec.yaw = yawDeg;
            slot.owner.Place(slot);
        }

        /// <summary>改外半径 / 长度（inner &lt; 0 = 不改内半径）</summary>
        public void SetRadius(float outer, float inner = -1)
        {
            if (!Alive || !(outer > 0)) return;
            slot.spec.radius = outer;
            if (inner >= 0) slot.spec.inner = Mathf.Min(inner, outer * 0.98f);
            slot.owner.Place(slot);
        }

        public void SetColor(Color color)
        {
            if (!Alive) return;
            slot.spec.color = color;
            slot.owner.ApplyColor(slot);
        }

        /// <summary>
        /// 预警：改成从现在起再过 remaining 秒填满（进度从当前值平滑接着走，不跳）。
        /// 前摇一开始就画、真正出手时刻要等到位才知道的招式用它（落点预警交给抛射物时按飞行时间重算、飞到位才开始蓄势的吐息）
        /// </summary>
        public void Retime(float remaining)
        {
            if (!Alive || slot.spec.style != TelegraphStyle.Warning || slot.fade >= 0 || !Fx.Finite(remaining)) return;
            slot.spec.duration = slot.age + Mathf.Clamp(remaining, 0.05f, 60f);
        }

        internal Telegraph.Slot Slot => slot != null && slot.gen == gen ? slot : null;

        /// <summary>两个句柄指向同一个预警（同一槽位、同一代）</summary>
        public bool Same(TelegraphHandle other) => slot != null && slot == other.slot && gen == other.gen;

        public static implicit operator FxHandle(TelegraphHandle h) => h.slot != null ? new FxHandle(h.slot, h.gen) : FxHandle.None;
    }

    /// <summary>
    /// 地面预警（F2，Three.js fx.groundWarning / Hazards.lineWarning / sectorWarning / NovaSpokes）：投影盒投射，贴合坡面与台阶，
    /// 不再是平面 Quad 在坡上穿地。形状：圆 / 环 / 扇形 / 长条 / 辐条 / 正多边形；样式：预警 / 冲击环 / 持续区域。
    ///   预警：倒计时填充（圆类从外沿往里收，长条 / 辐条由近到远推；紧迫度 = 进度²，亮边随之变亮，脉动 10 → 32 rad/s，即 Three.js 的 sin(t·(10 + 22u))），
    ///         填满后闪一下、略放大、消失；撤回时停在当前进度、0.1 s 淡出（不闪不放大，读作「这一下不会来了」）。
    ///         配色默认是统一的危险色（<see cref="TelegraphPalette"/>，见 <see cref="TelegraphTone"/>）：亮边 + 暗衬边，线宽按屏幕像素保底。
    ///   冲击环：线性（与冲击波判定同步）或缓出扩散，越往外越细，淡出。
    /// 每个预警一个投影盒 + 一份材质实例（SF_Telegraph，FxBuilder 生成 M_Fx_Telegraph），池化（上限 64，满了先挤掉正在淡出的，再挤最老的）。投射方式：
    ///   · 体积投射（管线开着深度图时，PC）：单位立方体 MeshRenderer，透明队列 <see cref="VolumeQueue"/>——画在熔岩面 / 冰面 / 水面（透明队列的地表）之后、
    ///     冰晶特效和粒子之前，所以熔岩渠、冰面上的预警不会被盖住 / 洗白；液面不在深度图里，按液面高度改投到液面上（<see cref="Place"/>）。
    ///   · URP 贴花（没有深度图、渲染器有贴花特性时）：DecalProjector，绘制顺序在 FX 贴花（弹孔、焦痕、霜纹、地火、熔池、法阵）之上。
    ///   · 平放的 Quad（都没有时，同一着色器的网格通道）；连着色器都没有时退回程序贴图的普通透明 Quad。
    /// 投影盒的高度按形状覆盖范围内的地面高度采样定（大形状 5 × 5、小形状 3 × 3）：平地上只有约 1.15 m 高、顶在地面上 0.42 m（只染到脚踝），坡上自动加高。
    /// 旧接口 Circle / Wave / Line（LineHandle）签名不变（多了可选的配色参数）；成组撤回用 <see cref="WarnScope"/>。
    /// </summary>
    public sealed class Telegraph : MonoBehaviour
    {
        const int MaxSlots = 64;
        const float CancelFade = 0.1f, Outro = 0.14f;
        public const string MaterialResource = "Fx/Materials/M_Fx_Telegraph";
        public const string ShaderName = "Spiritfire/Telegraph";
        const string MeshPass = "UniversalForwardOnly";
        static readonly string[] DecalPasses = { "DecalScreenSpaceProjector", "DecalProjectorForwardEmissive" };

        /// <summary>
        /// 体积投射的透明队列：熔岩面（Transparent−100）、冰面（−50）、水面（−40）之后，冰晶特效（−20）、粒子（0 起）之前。
        /// 持续区域 −1、冲击环 +1（预警叠在持续区域上，冲击环叠在预警上）
        /// </summary>
        public const int VolumeQueue = (int)RenderQueue.Transparent - 30;
        /// <summary>贴花退路的绘制顺序：FX 贴花在 −2（弹孔）… 2（法阵 / 涡旋），预警一律在它们之上</summary>
        public const int DecalOrderZone = 3, DecalOrderWarning = 5, DecalOrderRing = 6;

        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int Color2Id = Shader.PropertyToID("_Color2");
        static readonly int PlaneId = Shader.PropertyToID("_Plane");
        static readonly int MulId = Shader.PropertyToID("_Mul");
        static readonly int OccId = Shader.PropertyToID("_Occ");
        static readonly int OccYId = Shader.PropertyToID("_OccY");
        const string MulPass = "SRPDefaultUnlit";
        static readonly int VolumeId = Shader.PropertyToID("_Volume");
        static readonly int CullId = Shader.PropertyToID("_Cull");
        static readonly int ZTestId = Shader.PropertyToID("_ZTest");
        static readonly int OffsetFactorId = Shader.PropertyToID("_OffsetFactor");
        static readonly int OffsetUnitsId = Shader.PropertyToID("_OffsetUnits");
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int AnimId = Shader.PropertyToID("_Anim");
        static readonly int Anim2Id = Shader.PropertyToID("_Anim2");
        static readonly int Shape0Id = Shader.PropertyToID("_Shape0");
        static readonly int Shape1Id = Shader.PropertyToID("_Shape1");
        static readonly int ExtentId = Shader.PropertyToID("_Extent");
        static readonly int ModeId = Shader.PropertyToID("_Mode");
        static readonly int SrcBlendId = Shader.PropertyToID("_SrcBlend");
        static readonly int DstBlendId = Shader.PropertyToID("_DstBlend");
        static readonly int DrawOrderId = Shader.PropertyToID("_DrawOrder");
        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        static readonly int MainTexId = Shader.PropertyToID("_MainTex");

        static Telegraph instance;

        internal sealed class Slot : FxSlot
        {
            public Telegraph owner;
            public GameObject go;
            public DecalProjector projector;
            public MeshRenderer quad;
            /// <summary>体积投射用的单位立方体</summary>
            public MeshRenderer volume;
            public Material mat;
            /// <summary>材质是 SF_Telegraph（否则是程序贴图的普通透明兜底）</summary>
            public bool shaderMat;
            public bool decal;
            /// <summary>体积投射（透明队列，深度图重建）</summary>
            public bool vol;
            public TelegraphSpec spec;
            public float age, phase, fade = -1, fadeFrom, progress, opacity, pulse = 1, flash, grow, seed;
            /// <summary>投影盒的水平包围框（世界 xz 最小 / 最大）和盒底 / 盒顶高度：挑要排除的角色用</summary>
            public Vector2 boxMin, boxMax;
            public float boxLo, boxHi;
            /// <summary>上次写进材质的角色遮罩（只在变了的时候重写）</summary>
            public readonly Vector4[] occ = new Vector4[OccMax], occY = new Vector4[OccMax];
            public int occCount = -1;
            public int stamp;

            public bool Pending => active && fade < 0 && spec.style == TelegraphStyle.Warning && age < spec.duration;

            /// <summary>预警只撤回还没填满的；冲击环 / 区域直接淡出</summary>
            public override void CancelFx()
            {
                if (!active || fade >= 0) return;
                if (spec.style == TelegraphStyle.Warning && age >= spec.duration) return;
                owner.Fade(this);
            }

            public override void MoveFx(Vector3 position)
            {
                spec.center = position;
                owner.Place(this);
            }

            public override void RetargetFx(Vector3 from, Vector3 to) => new TelegraphHandle(this).SetLine(from, to, spec.width);
        }

        readonly List<Slot> slots = new();
        int stamp;
        Material template;
        bool templateLoaded;
        static Texture2D circleTex, rectTex;

        // ───────────── 入口 ─────────────

        static Telegraph Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<Telegraph>();
            if (!rt.TryGetComponent<TelegraphUnderfoot>(out _)) rt.gameObject.AddComponent<TelegraphUnderfoot>();
            return instance;
        }

        /// <summary>按完整参数生成一个预警</summary>
        public static TelegraphHandle Spawn(in TelegraphSpec spec)
        {
            if (!Fx.Finite(spec.center) || !(spec.radius > 0) || !Fx.Finite(spec.radius)) return TelegraphHandle.None;
            var g = Get();
            return g ? g.Take(spec) : TelegraphHandle.None;
        }

        /// <summary>圆形落点预警：duration 秒内由内向外填满</summary>
        public static TelegraphHandle Circle(Vector3 center, float radius, float duration, Color color, TelegraphTone tone = TelegraphTone.Auto) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Circle, center = center, radius = radius, duration = duration, color = color, tone = tone });

        /// <summary>圆环预警（inner 以内安全）</summary>
        public static TelegraphHandle Annulus(Vector3 center, float inner, float outer, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Annulus, center = center, radius = outer, inner = Mathf.Clamp(inner, 0, outer * 0.98f), duration = duration, color = color });

        /// <summary>扇形预警：中线朝 yaw（度），半角 halfAngle（度），可带内半径</summary>
        public static TelegraphHandle Sector(Vector3 center, float yawDeg, float halfAngleDeg, float radius, float duration, Color color, float inner = 0,
            TelegraphTone tone = TelegraphTone.Auto) =>
            Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Sector, center = center, yaw = yawDeg, halfAngle = halfAngleDeg, radius = radius,
                inner = Mathf.Clamp(inner, 0, radius * 0.98f), duration = duration, color = color, tone = tone,
            });

        /// <summary>长条预警（新接口，返回值类型句柄）：从 from 到 to、全宽 width，由近到远填满；hold = 填满后再亮几秒</summary>
        public static TelegraphHandle Lane(Vector3 from, Vector3 to, float width, float duration, Color color, float hold = 0, TelegraphTone tone = TelegraphTone.Auto)
        {
            var d = to - from;
            d.y = 0;
            float len = d.magnitude;
            float yaw = len > 1e-3f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : 0;
            return Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Line, center = from, yaw = yaw, radius = Mathf.Max(0.1f, len), width = Mathf.Max(0.05f, width),
                duration = duration, hold = hold, color = color, tone = tone,
            });
        }

        /// <summary>辐条预警：count 条、长 length、全宽 width，第一条朝 yaw（度）</summary>
        public static TelegraphHandle Spokes(Vector3 center, int count, float length, float width, float yawDeg, float duration, Color color, float inner = 0) =>
            Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Spokes, center = center, count = Mathf.Max(1, count), radius = length, width = Mathf.Max(0.05f, width), yaw = yawDeg,
                inner = Mathf.Clamp(inner, 0, length * 0.9f), duration = duration, color = color,
            });

        /// <summary>正多边形预警：外接圆半径 radius、sides 条边，一条边的法线朝 yaw（度）</summary>
        public static TelegraphHandle Polygon(Vector3 center, int sides, float radius, float yawDeg, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Polygon, center = center, count = Mathf.Max(3, sides), radius = radius, yaw = yawDeg, duration = duration, color = color });

        /// <summary>向外线性扩散的冲击波环（与冲击波判定同步）：半径以 speed 增长到 maxRadius；敌人 / 首领伤人的冲击波传 tone = Danger</summary>
        public static TelegraphHandle Wave(Vector3 center, float maxRadius, float speed, Color color, TelegraphTone tone = TelegraphTone.Auto) =>
            Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Circle, style = TelegraphStyle.Ring, center = center, radius = maxRadius,
                duration = maxRadius / Mathf.Max(0.1f, speed), color = color, additive = true, linear = true, tone = tone,
            });

        /// <summary>缓出扩散的冲击环（装饰：这一下的爆发范围；Fx.Ring 用）</summary>
        public static TelegraphHandle Ring(Vector3 center, float radius, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Circle, style = TelegraphStyle.Ring, center = center, radius = radius, duration = duration, color = color, additive = true });

        /// <summary>持续区域（地火、熔池）：流动纹理，持续 duration 秒</summary>
        public static TelegraphHandle Zone(Vector3 center, float radius, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Circle, style = TelegraphStyle.Zone, center = center, radius = radius, duration = duration, color = color });

        /// <summary>旧接口：预警线句柄（引用类型，镇墓兽冲锋时每帧 Move）</summary>
        public sealed class LineHandle
        {
            internal TelegraphHandle h;

            public bool Alive => h.Alive;

            /// <summary>值类型句柄（交给 WarnScope / Fx）</summary>
            public TelegraphHandle Handle => h;

            public void Move(Vector3 from, Vector3 to, float width) => h.SetLine(from, to, width);

            public void End() => h.End();
        }

        /// <summary>旧接口：长条预警，返回可每帧 Move 的句柄</summary>
        public static LineHandle Line(Vector3 from, Vector3 to, float width, float duration, Color color, TelegraphTone tone = TelegraphTone.Auto) =>
            new() { h = Lane(from, to, width, duration, color, 0, tone) };

        /// <summary>元素色（预警用元素的颜色：火 / 冰 / 雷 / 蚀…）</summary>
        public static Color ElementColor(Element e) => DamageTable.ElementColor(e);

        /// <summary>测试 / 诊断：一个预警当前的投射方式、投影盒（世界中心、尺寸）、液面</summary>
        public static string Describe(TelegraphHandle h)
        {
            if (!h.Alive || h.Slot == null) return "（已结束）";
            var s = h.Slot;
            var t = s.go.transform;
            var scale = s.vol && s.volume ? s.volume.transform.localScale : s.decal && s.projector ? s.projector.size : Vector3.zero;
            var plane = s.shaderMat ? s.mat.GetVector(PlaneId) : Vector4.zero;
            return $"{(s.vol ? "体积" : s.decal ? "贴花" : "平放")}，盒心 {t.position:F1}，盒 {scale:F1}，液面 {(plane.y > 0.5f ? plane.x.ToString("F2") : "无")}，" +
                   $"进度 {s.progress:F2}，不透明 {s.opacity:F2}，配色 {(s.spec.Danger ? "危险" : "原色")}，乘色 {(UsesMultiply(s) ? "开" : "关")}，排除角色 {Mathf.Max(0, s.occCount)} 只";
        }

        /// <summary>这个预警现在排除了几只角色（不染色；测试用）</summary>
        public static int OccluderCount(TelegraphHandle h) => h.Alive && h.Slot != null ? Mathf.Max(0, h.Slot.occCount) : 0;

        /// <summary>预热：在 at 处放一个全透明的预警（0.05 s），提前建好槽位、材质实例和贴花的绘制状态</summary>
        internal static void WarmUp(Vector3 at) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Circle, center = at, radius = 1, duration = 0.05f, color = new Color(1, 1, 1, 0) });

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (!instance) return;
            foreach (var s in instance.slots)
                if (s.active) instance.Hide(s);
        }

        // ───────────── 脚下的危险（第一人称提示 TelegraphUnderfoot 用） ─────────────

        /// <summary>
        /// p（玩家脚底点）落在哪些还在倒计时的危险预警里（预警样式、危险配色、看得见、没撤回；带 hold 的长条亮着期间也算）：
        /// 返回其中最高的进度 0..1，不在任何危险预警里返回 −1。margin = 水平外扩（米，玩家半径）
        /// </summary>
        public static float DangerAt(Vector3 p, float margin = 0.3f) => DangerAt(p, margin, out _);

        /// <summary>同上；core = 最紧迫的那个预警里离 p 最近的「核心」点（圆 / 多边形的圆心、环带的中线、长条 / 辐条 / 扇形的中轴线），没有时 = p</summary>
        public static float DangerAt(Vector3 p, float margin, out Vector3 core)
        {
            core = p;
            if (!instance) return -1;
            float best = -1;
            foreach (var s in instance.slots)
            {
                if (!s.active || s.fade >= 0) continue;
                var sp = s.spec;
                if (sp.style != TelegraphStyle.Warning || !sp.Danger || !(sp.color.a > 0) || s.age >= sp.duration + sp.hold) continue;
                if (Mathf.Abs(p.y - sp.center.y) > 3f) continue;
                if (!Contains(sp, p, margin) || s.progress <= best) continue;
                best = s.progress;
                core = CoreNear(sp, p);
            }
            return best;
        }

        /// <summary>形状里离 p 最近的核心点（躲的方向 = 背离它）</summary>
        static Vector3 CoreNear(in TelegraphSpec sp, Vector3 p)
        {
            var c = sp.center;
            var d = new Vector3(p.x - c.x, 0, p.z - c.z);
            float yaw = sp.yaw * Mathf.Deg2Rad;
            var fwd = new Vector3(Mathf.Sin(yaw), 0, Mathf.Cos(yaw));
            switch (sp.shape)
            {
                case TelegraphShape.Line:
                case TelegraphShape.Sector when sp.halfAngle < 179.5f:
                    return c + fwd * Mathf.Clamp(Vector3.Dot(d, fwd), 0, sp.radius);
                case TelegraphShape.Spokes:
                {
                    int n = Mathf.Max(1, sp.count);
                    float bestD = float.MaxValue;
                    var best = c;
                    for (int i = 0; i < n; i++)
                    {
                        float a = yaw + i * Mathf.PI * 2f / n;
                        var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                        var q = c + dir * Mathf.Clamp(Vector3.Dot(d, dir), sp.inner, sp.radius);
                        float dd = (new Vector3(p.x - q.x, 0, p.z - q.z)).sqrMagnitude;
                        if (dd < bestD)
                        {
                            bestD = dd;
                            best = q;
                        }
                    }
                    return best;
                }
                case TelegraphShape.Annulus:
                    return d.sqrMagnitude > 1e-6f ? c + d.normalized * ((sp.inner + sp.radius) * 0.5f) : c;
                default:
                    return c;
            }
        }

        /// <summary>水平面上 p 在不在预警形状里（与着色器同一套几何：yaw = 前方，长条原点在近端中点；外扩 margin 米）</summary>
        public static bool Contains(in TelegraphSpec sp, Vector3 p, float margin = 0)
        {
            var d = new Vector2(p.x - sp.center.x, p.z - sp.center.z);
            float yaw = sp.yaw * Mathf.Deg2Rad;
            var fwd = new Vector2(Mathf.Sin(yaw), Mathf.Cos(yaw));
            var right = new Vector2(fwd.y, -fwd.x);
            float dist = d.magnitude;
            switch (sp.shape)
            {
                case TelegraphShape.Line:
                {
                    float along = Vector2.Dot(d, fwd), lane = Vector2.Dot(d, right);
                    return along >= -margin && along <= sp.radius + margin && Mathf.Abs(lane) <= sp.width * 0.5f + margin;
                }
                case TelegraphShape.Spokes:
                {
                    int n = Mathf.Max(1, sp.count);
                    for (int i = 0; i < n; i++)
                    {
                        float a = yaw + i * Mathf.PI * 2f / n;
                        var dir = new Vector2(Mathf.Sin(a), Mathf.Cos(a));
                        float along = Vector2.Dot(d, dir), across = Mathf.Abs(dir.x * d.y - dir.y * d.x);
                        if (along >= sp.inner - margin && along <= sp.radius + margin && across <= sp.width * 0.5f + margin) return true;
                    }
                    return false;
                }
                case TelegraphShape.Polygon:
                {
                    int n = Mathf.Max(3, sp.count);
                    float seg = Mathf.PI * 2f / n;
                    float rel = Mathf.Atan2(Vector2.Dot(d, right), Vector2.Dot(d, fwd));
                    float a = rel - Mathf.Round(rel / seg) * seg;
                    return dist * Mathf.Cos(a) <= sp.radius * Mathf.Cos(Mathf.PI / n) + margin;
                }
                default:
                {
                    // 圆 / 环 / 扇形
                    if (dist > sp.radius + margin) return false;
                    float inner = sp.shape is TelegraphShape.Annulus or TelegraphShape.Sector ? sp.inner : 0;
                    if (inner > 0 && dist < inner - margin) return false;
                    if (sp.shape != TelegraphShape.Sector || sp.halfAngle >= 179.5f || dist < 1e-3f) return true;
                    float off = Mathf.Abs(Mathf.DeltaAngle(sp.yaw, Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg)) - sp.halfAngle;
                    return off <= 0 || dist * Mathf.Sin(Mathf.Min(off, 90f) * Mathf.Deg2Rad) <= margin;
                }
            }
        }

        // ───────────── 槽位 ─────────────

        TelegraphHandle Take(TelegraphSpec spec)
        {
            if (spec.style == TelegraphStyle.Warning && !(spec.duration > 0)) spec.duration = 0.5f;
            spec.duration = Mathf.Clamp(Fx.Finite(spec.duration) ? spec.duration : 0.5f, 0.05f, 60f);
            spec.hold = Mathf.Max(0, Fx.Finite(spec.hold) ? spec.hold : 0);
            spec.radius = Mathf.Min(spec.radius, 80f);
            if (spec.shape == TelegraphShape.Line || spec.shape == TelegraphShape.Spokes) spec.width = Mathf.Max(0.05f, spec.width);
            if (spec.shape == TelegraphShape.Sector && !(spec.halfAngle > 0)) spec.halfAngle = 45;

            Slot s = null, fading = null, oldest = null;
            foreach (var x in slots)
            {
                if (!x.active)
                {
                    s = x;
                    break;
                }
                if (x.fade >= 0 && (fading == null || x.stamp < fading.stamp)) fading = x;
                if (oldest == null || x.stamp < oldest.stamp) oldest = x;
            }
            if (s == null) s = slots.Count < MaxSlots ? Create() : fading ?? oldest;
            if (s == null) return TelegraphHandle.None;
            s.Claim();
            s.stamp = ++stamp;
            s.spec = spec;
            s.age = 0;
            s.phase = 0;
            s.fade = -1;
            s.progress = 0;
            s.flash = 0;
            s.grow = 0;
            s.pulse = 1;
            s.seed = Random.value * 10;
            s.opacity = spec.style == TelegraphStyle.Ring ? 1 : 0;
            ChooseMode(s);
            ApplyColor(s);
            Place(s);
            Animate(s);
            s.go.SetActive(true);
            if (s.vol) s.volume.enabled = true;
            else if (s.decal) s.projector.enabled = true;
            else if (s.quad) s.quad.enabled = true;
            return new TelegraphHandle(s);
        }

        Slot Create()
        {
            var go = new GameObject($"Telegraph {slots.Count}");
            go.transform.SetParent(transform, false);
            go.SetActive(false);
            var s = new Slot { owner = this, go = go };
            LoadTemplate();
            if (template)
            {
                s.mat = new Material(template) { name = "Telegraph (instance)", enableInstancing = false };
                s.shaderMat = true;
            }
            else
            {
                s.mat = FxMaterials.MakeAlpha(null);
                s.mat.name = "Telegraph (fallback)";
            }
            s.mat.hideFlags = HideFlags.DontSave;
            slots.Add(s);
            return s;
        }

        void LoadTemplate()
        {
            if (templateLoaded) return;
            templateLoaded = true;
            var m = Resources.Load<Material>(MaterialResource);
            if (FxMaterials.Usable(m))
            {
                template = m;
                return;
            }
#if UNITY_EDITOR
            // 还没跑 FxBuilder：编辑器里按名字找着色器（打包后不找，缺了就退回程序贴图）
            var shader = Shader.Find(ShaderName);
            if (shader && shader.isSupported)
            {
                template = new Material(shader) { name = "M_Fx_Telegraph (fallback)", hideFlags = HideFlags.DontSave };
                return;
            }
#endif
            Debug.LogWarning("[Telegraph] 没有预警材质 M_Fx_Telegraph（先跑 FxBuilder：bridge.sh fx），退回程序贴图的平面预警");
        }

        static int supportFrame = -1;
        static bool supportCached;

        /// <summary>当前渲染管线的渲染器里有启用的 URP 贴花特性（FxBuilder 加的）</summary>
        public static bool DecalsSupported
        {
            get
            {
                if (Time.frameCount == supportFrame) return supportCached;
                supportFrame = Time.frameCount;
                supportCached = false;
                if (GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset asset)
                    foreach (var data in asset.rendererDataList)
                        if (data && data.TryGetRendererFeature<DecalRendererFeature>(out var f) && f.isActive)
                        {
                            supportCached = true;
                            break;
                        }
                return supportCached;
            }
        }

        static int depthFrame = -1;
        static bool depthCached;

        /// <summary>当前管线开着相机深度图（体积投射要从深度图重建坐标）</summary>
        public static bool DepthTextureAvailable
        {
            get
            {
                if (Time.frameCount == depthFrame) return depthCached;
                depthFrame = Time.frameCount;
                depthCached = GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset asset && asset.supportsCameraDepthTexture;
                return depthCached;
            }
        }

        /// <summary>
        /// 选投射方式：开着深度图 → 体积投射（透明队列，压在熔岩 / 冰 / 水面之上）；否则有贴花特性 → DecalProjector；否则平放的 Quad（同一材质的网格通道 / 程序贴图）
        /// </summary>
        void ChooseMode(Slot s)
        {
            bool vol = s.shaderMat && DepthTextureAvailable;
            bool decal = !vol && s.shaderMat && DecalsSupported;
            s.vol = vol;
            s.decal = decal;
            var m = s.mat;
            if (s.shaderMat)
            {
                // 投影时关掉网格通道（否则投影立方体会被前向通道当普通网格画出来）；网格通道（体积 / 平放）时关掉贴花通道
                m.SetShaderPassEnabled(MeshPass, !decal);
                foreach (var p in DecalPasses) m.SetShaderPassEnabled(p, decal);
                int order = s.spec.style switch { TelegraphStyle.Zone => -1, TelegraphStyle.Ring => 1, _ => 0 };
                int decalOrder = s.spec.style switch { TelegraphStyle.Zone => DecalOrderZone, TelegraphStyle.Ring => DecalOrderRing, _ => DecalOrderWarning };
                m.SetFloat(DrawOrderId, decalOrder);
                // 贴花必须在不透明队列范围内（URP 的贴花通道按 RenderQueueRange.opaque 过滤）
                m.renderQueue = decal ? 2000 + decalOrder : vol ? VolumeQueue + order : (int)RenderQueue.Transparent - 10 + order;
                m.SetFloat(VolumeId, vol ? 1 : 0);
                m.SetFloat(CullId, (float)(vol ? CullMode.Front : CullMode.Off));
                m.SetFloat(ZTestId, (float)(vol ? CompareFunction.Greater : CompareFunction.LessEqual));
                m.SetFloat(OffsetFactorId, vol ? 0 : -2);
                m.SetFloat(OffsetUnitsId, vol ? 0 : -2);
                // 危险配色一律普通混合：加法在亮沙、冰雪上读不出来，也画不了暗衬边
                bool add = s.spec.additive && !s.spec.Danger;
                m.SetFloat(SrcBlendId, (float)BlendMode.SrcAlpha);
                m.SetFloat(DstBlendId, (float)(add ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
                // 乘色通道：危险预警在体积投射 / 平放 Quad 时开（贴花投影没有这个通道）
                m.SetShaderPassEnabled(MulPass, UsesMultiply(s));
                s.occCount = -1;
            }
            else
            {
                m.renderQueue = (int)RenderQueue.Transparent - 10;
                var tex = s.spec.shape == TelegraphShape.Line ? RectTexture() : CircleTexture();
                if (m.HasProperty(BaseMapId)) m.SetTexture(BaseMapId, tex);
                if (m.HasProperty(MainTexId)) m.SetTexture(MainTexId, tex);
            }

            if (vol)
            {
                if (!s.volume)
                {
                    var v = new GameObject("Volume");
                    v.transform.SetParent(s.go.transform, false);
                    v.AddComponent<MeshFilter>().sharedMesh = CubeMesh();
                    s.volume = MakeRenderer(v, m);
                }
                if (s.quad) s.quad.enabled = false;
                if (s.projector) s.projector.enabled = false;
            }
            else if (decal)
            {
                if (!s.projector)
                {
                    s.projector = s.go.AddComponent<DecalProjector>();
                    s.projector.enabled = false;
                    s.projector.material = m;
                    s.projector.pivot = Vector3.zero;
                    s.projector.scaleMode = DecalScaleMode.ScaleInvariant;
                    s.projector.drawDistance = 250;
                    s.projector.fadeScale = 0.95f;
                    s.projector.startAngleFade = 180;
                    s.projector.endAngleFade = 180;
                }
                if (s.quad) s.quad.enabled = false;
                if (s.volume) s.volume.enabled = false;
            }
            else
            {
                if (!s.quad)
                {
                    var q = new GameObject("Quad");
                    q.transform.SetParent(s.go.transform, false);
                    q.AddComponent<MeshFilter>().sharedMesh = QuadMesh();
                    s.quad = MakeRenderer(q, m);
                }
                if (s.projector) s.projector.enabled = false;
                if (s.volume) s.volume.enabled = false;
            }
        }

        static MeshRenderer MakeRenderer(GameObject go, Material m)
        {
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            r.allowOcclusionWhenDynamic = false;
            r.enabled = false;
            return r;
        }

        /// <summary>实际用的主色：危险配色 = 当前关卡的危险色（alpha 沿用传进来的；0 = 隐形，其余不低于 0.85——危险预警不许画得淡）</summary>
        static Color MainColor(in TelegraphSpec sp)
        {
            if (!sp.Danger) return sp.color;
            var d = TelegraphPalette.Danger;
            d.a = sp.color.a <= 0 ? 0 : Mathf.Max(0.85f, Mathf.Min(1f, sp.color.a));
            return d;
        }

        internal void ApplyColor(Slot s)
        {
            if (!s.shaderMat) return;
            s.mat.SetColor(ColorId, MainColor(s.spec));
            s.mat.SetColor(Color2Id, s.spec.Danger ? TelegraphPalette.DangerBacking : TelegraphPalette.BackingFor(s.spec.color));
            var mul = TelegraphPalette.DangerMultiply;
            s.mat.SetVector(MulId, UsesMultiply(s) ? new Vector4(1, mul.r, mul.g, mul.b) : new Vector4(0, 1, 1, 1));
        }

        /// <summary>这个预警用乘色通道：危险配色的预警（不是冲击环 / 持续区域），体积投射或平放 Quad（贴花投影没有乘色通道）</summary>
        static bool UsesMultiply(Slot s) => s.shaderMat && !s.decal && s.spec.Danger && s.spec.style == TelegraphStyle.Warning;

        // ───────────── 摆放：投影盒尺寸 + 贴合地面的高度 ─────────────

        /// <summary>投影盒在形状外留的余量（米）：暗衬边画在这里面</summary>
        const float Pad = 0.6f;
        /// <summary>盒子顶在采样到的最高地面之上多少米（再往上是角色身体，不染）</summary>
        const float BoxTop = 0.42f;
        static readonly Vector2[] SamplePoints =
        {
            new(0, 0), new(-1, -1), new(1, -1), new(-1, 1), new(1, 1), new(0, -1), new(0, 1), new(-1, 0), new(1, 0),
        };
        static readonly Vector2[] SamplePointsWide = BuildGrid(5);
        static readonly List<float> heights = new(32);

        static Vector2[] BuildGrid(int n)
        {
            var pts = new Vector2[n * n];
            int k = 0;
            for (int z = 0; z < n; z++)
            for (int x = 0; x < n; x++)
                pts[k++] = new Vector2(x / (n - 1f) * 2 - 1, z / (n - 1f) * 2 - 1);
            return pts;
        }

        internal void Place(Slot s)
        {
            var sp = s.spec;
            var rot = Quaternion.Euler(0, sp.yaw, 0);
            var fwd = rot * Vector3.forward;
            var right = rot * Vector3.right;
            Vector2 size, origin;
            Vector3 boxCenter = sp.center;
            int kind;
            float rim;
            switch (sp.shape)
            {
                case TelegraphShape.Line:
                    size = new Vector2(sp.width + Pad * 2, sp.radius + Pad * 2);
                    origin = new Vector2(0, -sp.radius * 0.5f);
                    boxCenter = sp.center + fwd * (sp.radius * 0.5f);
                    kind = 1;
                    rim = Mathf.Clamp(sp.width * 0.16f, 0.1f, 0.4f);
                    break;
                case TelegraphShape.Spokes:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 2;
                    rim = Mathf.Clamp(sp.width * 0.25f, 0.05f, 0.2f);
                    break;
                case TelegraphShape.Polygon:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 3;
                    rim = Mathf.Clamp(sp.radius * 0.08f, 0.16f, 0.5f);
                    break;
                default:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 0;
                    rim = Mathf.Clamp(sp.radius * 0.08f, 0.16f, 0.5f);
                    break;
            }

            // 覆盖范围内的地面高度（大形状 5 × 5、小形状 3 × 3）：平地上盒子很矮（只染到脚踝），坡上 / 台阶自动加高。
            // 熔岩 / 水面没有碰撞（射线打到的是床）：记下液面高度——盒子往下包住床（深度图里是床），着色器把落在液面以下一截的点改投到液面上
            // 参考高度 g0：形状中心处的地面。中心悬在坑 / 冰窟 / 没认出液面的水洞上方（射线打到的比调用方给的高度低 1.5 m 以上）时，
            // 覆盖范围里只要有地面落在调用方高度附近，就改以调用方高度为准——否则环台中间是冰窟的大环带（扇翼狂风的冻风带）
            // 会把整个盒子放到窟底，环台上一点都画不出来；都没有（中心给在半空）照旧按中心下方的地面
            float c0 = SurfaceAt(sp.center, sp.center.y, out bool hit0, out float bed0, out float liquid0);
            float g0 = c0;
            float hx = size.x * 0.5f - Pad, hz = size.y * 0.5f - Pad;
            var pts = Mathf.Max(hx, hz) > 5f ? SamplePointsWide : SamplePoints;
            if (hit0 && c0 < sp.center.y - 1.5f)
                foreach (var p in pts)
                {
                    float y = SurfaceAt(boxCenter + right * (p.x * hx) + fwd * (p.y * hz), sp.center.y, out bool h, out _, out _);
                    if (!h || Mathf.Abs(y - sp.center.y) > 1.5f) continue;
                    g0 = sp.center.y;
                    break;
                }
            float lo = Mathf.Min(g0, Mathf.Min(c0, bed0)), liquid = liquid0;
            heights.Clear();
            heights.Add(g0);
            foreach (var p in pts)
            {
                var at = boxCenter + right * (p.x * hx) + fwd * (p.y * hz);
                float y = SurfaceAt(at, g0, out bool hit, out float bed, out float lq);
                if (!hit) continue;
                lo = Mathf.Min(lo, y);
                heights.Add(y);
                if (!float.IsNaN(lq))
                {
                    liquid = float.IsNaN(liquid) ? lq : Mathf.Max(liquid, lq);
                    lo = Mathf.Min(lo, bed);
                }
            }
            // 采样点没落进去的窄水带（1-4 月牙泉是一条条 3 m 宽的水体）：按水体的包围盒补上液面和床（包围盒粗筛：多算进来的代价是盒子往下多包一截、低于液面 0.3 m 的点改投到液面上）
            float reachR = 0.5f * Mathf.Sqrt(size.x * size.x + size.y * size.y);
            foreach (var w in WaterVolume.All)
            {
                if (!w) continue;
                var wt = w.transform;
                Vector3 ax = wt.TransformVector(0.5f, 0, 0), ay = wt.TransformVector(0, 0.5f, 0), az = wt.TransformVector(0, 0, 0.5f);
                float wx = Mathf.Abs(ax.x) + Mathf.Abs(ay.x) + Mathf.Abs(az.x), wz = Mathf.Abs(ax.z) + Mathf.Abs(ay.z) + Mathf.Abs(az.z);
                var wc = wt.position;
                if (Mathf.Abs(wc.x - boxCenter.x) > wx + reachR || Mathf.Abs(wc.z - boxCenter.z) > wz + reachR) continue;
                float surface = w.Surface, bottom = wt.TransformPoint(0, -0.5f, 0).y;
                if (surface < g0 - 3f || surface > g0 + 3f) continue;
                liquid = float.IsNaN(liquid) ? surface : Mathf.Max(liquid, surface);
                lo = Mathf.Min(lo, bottom);
                heights.Add(surface);
            }
            // 同理补上采样点没落进去的窄熔岩渠（3-4 祝融殿的渠）
            foreach (var b in LavaField.Bodies)
            {
                if (b == null || !b.enabled) continue;
                float br = b.shape == LavaShape.Disc ? b.size.x : 0.5f * Mathf.Sqrt(b.size.x * b.size.x + b.size.y * b.size.y);
                if (Mathf.Abs(b.center.x - boxCenter.x) > br + reachR || Mathf.Abs(b.center.z - boxCenter.z) > br + reachR) continue;
                float surface = b.level + LavaTuning.SurfaceLift;
                if (surface < g0 - 3f || surface > g0 + 3f) continue;
                liquid = float.IsNaN(liquid) ? surface : Mathf.Max(liquid, surface);
                lo = Mathf.Min(lo, b.level - Mathf.Min(b.depth, 3f));
                heights.Add(surface);
            }
            // 盒顶：取采样高度的第 80 百分位、最多再让 1 m 给最高点——柱顶、祭台、屋顶这类少数高点不把盒子拉高
            // （否则柱身上的箍、台阶边沿这些朝上的面都会被染上预警色）；坡地、台阶的高差是连续的，照样包得住
            heights.Sort();
            float top = heights[heights.Count - 1];
            float p80 = heights[Mathf.Clamp(Mathf.CeilToInt(heights.Count * 0.8f) - 1, 0, heights.Count - 1)];
            float hi = Mathf.Min(top, p80 + 1f);
            // 不让一堵墙把盒子拉到半空（坡度上限约 35°）；液面下的床不受这个限制
            float reach = 0.7f * Mathf.Max(size.x, size.y) * 0.5f + 0.6f;
            lo = (float.IsNaN(liquid) ? Mathf.Max(lo, g0 - reach) : lo) - 0.6f;
            hi = Mathf.Min(hi, g0 + reach) + BoxTop;
            // 盒子至少 1.15 m 高，往下补（往上补会把盒顶抬到角色腿上）
            lo = Mathf.Min(lo, hi - 1.15f);
            float depth = hi - lo;

            var m = s.mat;
            if (s.shaderMat)
            {
                float halfAngle = sp.shape == TelegraphShape.Sector && sp.halfAngle < 179.5f ? sp.halfAngle * Mathf.Deg2Rad : 4f;
                float inner = sp.shape is TelegraphShape.Annulus or TelegraphShape.Sector or TelegraphShape.Spokes ? sp.inner : 0;
                bool add = sp.additive && !sp.Danger;
                m.SetVector(ExtentId, new Vector4(size.x, size.y, origin.x, origin.y));
                m.SetVector(Shape0Id, new Vector4(sp.radius, inner, halfAngle, sp.count));
                m.SetVector(Shape1Id, new Vector4(sp.width * 0.5f, 0, rim, Pad - 0.08f));
                m.SetVector(ModeId, new Vector4(kind, (int)sp.style, add ? 1 : 0, 0));
                m.SetVector(PlaneId, float.IsNaN(liquid) ? new Vector4(0, 0, depth, 0) : new Vector4(liquid, 1, depth, 0));
            }

            // 水平包围框 + 盒底 / 盒顶：每帧挑要排除的角色（UpdateOccluders）
            float bx = Mathf.Abs(right.x) * size.x * 0.5f + Mathf.Abs(fwd.x) * size.y * 0.5f;
            float bz = Mathf.Abs(right.z) * size.x * 0.5f + Mathf.Abs(fwd.z) * size.y * 0.5f;
            s.boxMin = new Vector2(boxCenter.x - bx, boxCenter.z - bz);
            s.boxMax = new Vector2(boxCenter.x + bx, boxCenter.z + bz);
            s.boxLo = lo;
            s.boxHi = hi;

            var t = s.go.transform;
            if (s.vol)
            {
                // 单位立方体：x 右、y 上、z 前（着色器里 uv = xz + 0.5，与贴花投影同一套形状坐标）
                t.SetPositionAndRotation(new Vector3(boxCenter.x, (lo + hi) * 0.5f, boxCenter.z), rot);
                var want = new Vector3(size.x, depth, size.y);
                if (s.volume.transform.localScale != want) s.volume.transform.localScale = want;
            }
            else if (s.decal)
            {
                t.SetPositionAndRotation(new Vector3(boxCenter.x, (lo + hi) * 0.5f, boxCenter.z), Quaternion.LookRotation(Vector3.down, fwd));
                var want = new Vector3(size.x, size.y, depth);
                if (s.projector.size != want) s.projector.size = want;
            }
            else
            {
                // 平放兜底：贴着中心处地面略抬高（坡上会穿地，这是没有贴花时的已知局限）
                t.SetPositionAndRotation(new Vector3(boxCenter.x, (hit0 ? g0 : sp.center.y) + 0.06f, boxCenter.z), Quaternion.Euler(90, sp.yaw, 0));
                if (s.quad) s.quad.transform.localScale = new Vector3(size.x, size.y, 1);
            }
        }

        /// <summary>
        /// (x, z) 处、参考高度 refY 附近能站上去 / 看得到的表面高度：射线打到的地面，上面有熔岩 / 水面时取液面（liquid = 液面高度，bed = 射线打到的床；
        /// 没有液面时 liquid = NaN、bed = 地面）。没有命中返回 refY
        /// </summary>
        static float SurfaceAt(Vector3 p, float refY, out bool hit, out float bed, out float liquid)
        {
            liquid = float.NaN;
            hit = Physics.Raycast(new Vector3(p.x, refY + 4f, p.z), Vector3.down, out var h, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            bed = hit ? h.point.y : refY;
            if (!hit) return refY;
            float y = bed;
            if (LavaField.Any && LavaField.TrySurfaceHeight(new Vector3(p.x, bed, p.z), out float ly) && ly > bed + 0.05f && ly < bed + 12f) liquid = ly;
            var w = WaterVolume.At(new Vector3(p.x, bed + 0.05f, p.z), out _);
            if (w)
            {
                float wy = w.Surface;
                if (wy > bed + 0.05f && (float.IsNaN(liquid) || wy > liquid)) liquid = wy;
            }
            return float.IsNaN(liquid) ? y : liquid;
        }

        // ───────────── 动画 ─────────────

        internal void Fade(Slot s)
        {
            if (!s.active || s.fade >= 0) return;
            s.fade = 0;
            s.fadeFrom = s.opacity;
            s.flash = 0;
        }

        internal void Hide(Slot s)
        {
            s.active = false;
            if (s.projector) s.projector.enabled = false;
            if (s.quad) s.quad.enabled = false;
            if (s.volume) s.volume.enabled = false;
            s.go.SetActive(false);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            bool gathered = false;
            foreach (var s in slots)
            {
                if (!s.active) continue;
                if (!Step(s, dt))
                {
                    Hide(s);
                    continue;
                }
                Animate(s);
                if (!s.shaderMat) continue;
                if (!gathered)
                {
                    GatherOccluders();
                    gathered = true;
                }
                UpdateOccluders(s);
            }
        }

        // ───────────── 角色不染色（特效打磨 C 路） ─────────────

        /// <summary>对照开关：关掉角色排除（telegraph-look 拍改前 / 改后、性能开关对照用；缺省 false = 开着）</summary>
        public static bool OccludersOff;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetOccluders()
        {
            OccludersOff = false;
            occluders.Clear();
            occCache.Clear();
        }

        /// <summary>每个预警最多排除几只角色（SF_Telegraph 的 _Occ / _OccY 数组长度）</summary>
        public const int OccMax = 4;
        /// <summary>包围框水平尺寸超过这个（米）的不排除：鲲、鹏这种巨物的框太大，会把框里抬高的地面（冰柱、台沿）也一起挖掉</summary>
        const float OccMaxSize = 8f;

        struct Occluder
        {
            public EnemyAI ai;
            public Vector2 min, max;
            public float bottom, top, ground;
            public bool grounded;
        }

        sealed class OccCache
        {
            public Renderer[] renderers;
            public int frame;
        }

        static readonly List<Occluder> occluders = new(32);
        static readonly Dictionary<EnemyAI, OccCache> occCache = new();
        static readonly List<Renderer> occScratch = new(16);
        static readonly List<EnemyAI> occDead = new(8);
        static readonly List<int> occPick = new(OccMax);

        /// <summary>这一帧所有敌人（不含巨型首领）的身体包围框：只取网格 / 蒙皮网格渲染器（粒子、拖尾的世界空间包围盒会大得离谱）</summary>
        static void GatherOccluders()
        {
            occluders.Clear();
            var all = EnemyAI.All;
            if (all == null) return;
            int frame = Time.frameCount;
            foreach (var ai in all)
            {
                if (!ai || !ai.gameObject.activeInHierarchy) continue;
                if (!occCache.TryGetValue(ai, out var c))
                {
                    c = new OccCache { frame = -1000 };
                    occCache[ai] = c;
                }
                // 换模型（化形、换形态）、挂件增减：每 1.5 s 左右重新收一次渲染器；中间有被销毁的立刻重收
                bool stale = frame - c.frame > 90 || c.renderers == null;
                if (!stale)
                    foreach (var r in c.renderers)
                        if (!r)
                        {
                            stale = true;
                            break;
                        }
                if (stale)
                {
                    occScratch.Clear();
                    ai.GetComponentsInChildren(false, occScratch);
                    int n = 0;
                    foreach (var r in occScratch)
                        if (r is MeshRenderer or SkinnedMeshRenderer)
                            n++;
                    c.renderers = new Renderer[n];
                    n = 0;
                    foreach (var r in occScratch)
                        if (r is MeshRenderer or SkinnedMeshRenderer)
                            c.renderers[n++] = r;
                    c.frame = frame;
                }
                bool any = false;
                var b = default(Bounds);
                foreach (var r in c.renderers)
                {
                    if (!r || !r.enabled || r.forceRenderingOff || !r.gameObject.activeInHierarchy) continue;
                    if (!any)
                    {
                        b = r.bounds;
                        any = true;
                    }
                    else b.Encapsulate(r.bounds);
                }
                if (!any || b.size.x > OccMaxSize || b.size.z > OccMaxSize) continue;
                occluders.Add(new Occluder
                {
                    ai = ai, min = new Vector2(b.min.x, b.min.z), max = new Vector2(b.max.x, b.max.z), bottom = b.min.y, top = b.max.y,
                });
            }
            // 已经不在场上的敌人从缓存里清掉
            if (occCache.Count > all.Count + 8)
            {
                occDead.Clear();
                foreach (var kv in occCache)
                    if (!kv.Key || !all.Contains(kv.Key))
                        occDead.Add(kv.Key);
                foreach (var k in occDead) occCache.Remove(k);
            }
        }

        /// <summary>挑出和这个预警投影盒重叠的角色（最多 <see cref="OccMax"/> 只，离盒心近的优先），写进材质；和上次一样就不写</summary>
        static void UpdateOccluders(Slot s)
        {
            occPick.Clear();
            var mid = (s.boxMin + s.boxMax) * 0.5f;
            for (int i = 0; i < (OccludersOff ? 0 : occluders.Count); i++)
            {
                var o = occluders[i];
                if (o.max.x < s.boxMin.x || o.min.x > s.boxMax.x || o.max.y < s.boxMin.y || o.min.y > s.boxMax.y) continue;
                if (o.top < s.boxLo || o.bottom > s.boxHi) continue;
                if (occPick.Count < OccMax)
                {
                    occPick.Add(i);
                    continue;
                }
                // 满了：换掉离盒心最远的那只
                int far = 0;
                float farD = -1;
                for (int k = 0; k < occPick.Count; k++)
                {
                    var p = occluders[occPick[k]];
                    float d = ((p.min + p.max) * 0.5f - mid).sqrMagnitude;
                    if (d > farD)
                    {
                        farD = d;
                        far = k;
                    }
                }
                if (((o.min + o.max) * 0.5f - mid).sqrMagnitude < farD) occPick[far] = i;
            }
            bool changed = s.occCount != occPick.Count;
            for (int k = 0; k < OccMax; k++)
            {
                Vector4 box = Vector4.zero, yy = Vector4.zero;
                if (k < occPick.Count)
                {
                    int i = occPick[k];
                    var o = occluders[i];
                    if (!o.grounded)
                    {
                        // 脚下地面：身体中心往下打一条射线（埋进沙里的沙魇、站在台阶上的都按真实地面算，不按根节点）
                        var c = o.ai.transform.position;
                        o.ground = Physics.Raycast(new Vector3(c.x, Mathf.Max(c.y, o.bottom) + 0.6f, c.z), Vector3.down, out var h, 3f, Layers.WorldMask,
                            QueryTriggerInteraction.Ignore)
                            ? h.point.y
                            : c.y;
                        o.grounded = true;
                        occluders[i] = o;
                    }
                    box = new Vector4(o.min.x, o.min.y, o.max.x, o.max.y);
                    yy = new Vector4(o.ground, o.top, 1, 0);
                }
                if ((box - s.occ[k]).sqrMagnitude > 0.0004f || (yy - s.occY[k]).sqrMagnitude > 0.0004f)
                {
                    s.occ[k] = box;
                    s.occY[k] = yy;
                    changed = true;
                }
            }
            if (!changed) return;
            s.occCount = occPick.Count;
            s.mat.SetVectorArray(OccId, s.occ);
            s.mat.SetVectorArray(OccYId, s.occY);
        }

        /// <summary>推进一帧；返回 false = 该收起了</summary>
        static bool Step(Slot s, float dt)
        {
            var sp = s.spec;
            if (s.fade >= 0)
            {
                // 被撤回：进度停在原处，从撤回时的不透明度淡到 0（不闪、不放大）
                s.fade += dt;
                float o = s.fade / CancelFade;
                if (o >= 1) return false;
                s.opacity = s.fadeFrom * (1 - o) * (1 - o);
                return true;
            }
            // 预警的进度按「剩下的部分 / 剩下的时间」积分：时长固定时就是 age / duration；中途 Retime 改了时长也从当前进度平滑接着走
            if (sp.style == TelegraphStyle.Warning && s.age < sp.duration)
                s.progress += (1 - s.progress) * Mathf.Min(1, dt / Mathf.Max(1e-4f, sp.duration - s.age));
            s.age += dt;
            switch (sp.style)
            {
                case TelegraphStyle.Ring:
                {
                    float t = s.age / sp.duration;
                    if (t >= 1) return false;
                    s.progress = sp.linear ? t : 1 - (1 - t) * (1 - t) * (1 - t);
                    s.opacity = Mathf.Pow(1 - t, 1.3f) * (sp.linear ? 1f : 1.2f);
                    return true;
                }
                case TelegraphStyle.Zone:
                {
                    if (s.age >= sp.duration) return false;
                    s.progress = 1;
                    s.opacity = Mathf.Min(1, s.age / 0.2f) * Mathf.Min(1, (sp.duration - s.age) / 0.3f);
                    return true;
                }
                default:
                {
                    if (s.age < sp.duration)
                    {
                        s.progress = Mathf.Clamp01(s.progress);
                        s.opacity = Mathf.Min(1, s.age / 0.1f) * 0.95f;
                    }
                    else if (s.age < sp.duration + sp.hold)
                    {
                        s.progress = 1;
                        s.opacity = 0.95f;
                    }
                    else
                    {
                        // 收尾：填满后亮一下并略微放大，然后消失
                        float o = (s.age - sp.duration - sp.hold) / Outro;
                        if (o >= 1) return false;
                        s.progress = 1;
                        s.opacity = (1 - o) * 1.25f;
                        s.flash = 1 - o;
                        s.grow = o;
                    }
                    // 紧迫脉动：角频率随紧迫度（进度²）从 10 升到 32 rad/s，相位逐帧积分（不会因为变频跳相）
                    float u = s.progress * s.progress;
                    s.phase += dt * (10f + 22f * u);
                    s.pulse = 0.7f + 0.3f * Mathf.Sin(s.phase);
                    return true;
                }
            }
        }

        void Animate(Slot s)
        {
            var m = s.mat;
            if (s.shaderMat)
            {
                float u = s.progress * s.progress;
                m.SetVector(AnimId, new Vector4(s.progress, s.opacity, s.pulse, s.flash));
                m.SetVector(Anim2Id, new Vector4(s.grow, s.age + s.seed, s.seed, u));
                return;
            }
            // 程序贴图兜底：只能整体调亮度
            var c = MainColor(s.spec);
            float a = Mathf.Clamp01(s.opacity * (s.spec.style == TelegraphStyle.Warning ? Mathf.Lerp(0.35f, 1f, s.progress) * s.pulse : 1f) * c.a);
            var col = new Color(c.r, c.g, c.b, a);
            m.SetColor(BaseColorId, col);
            m.SetColor(ColorId, col);
        }

        // ───────────── 兜底网格 / 贴图 ─────────────

        static Mesh quadMesh, cubeMesh;

        /// <summary>体积投射用的单位立方体（中心在原点，边长 1；只用背面）</summary>
        static Mesh CubeMesh()
        {
            if (cubeMesh) return cubeMesh;
            cubeMesh = new Mesh { name = "Telegraph Volume", hideFlags = HideFlags.DontSave };
            var v = new Vector3[8];
            for (int i = 0; i < 8; i++) v[i] = new Vector3((i & 1) == 0 ? -0.5f : 0.5f, (i & 2) == 0 ? -0.5f : 0.5f, (i & 4) == 0 ? -0.5f : 0.5f);
            cubeMesh.vertices = v;
            cubeMesh.uv = new Vector2[8];
            // 六个面，外法线方向逆时针看为正面（Unity 顺时针为正面：这里按顺时针写）
            cubeMesh.triangles = new[]
            {
                0, 2, 3, 0, 3, 1, // −z
                4, 5, 7, 4, 7, 6, // +z
                0, 4, 6, 0, 6, 2, // −x
                1, 3, 7, 1, 7, 5, // +x
                0, 1, 5, 0, 5, 4, // −y
                2, 6, 7, 2, 7, 3, // +y
            };
            cubeMesh.RecalculateBounds();
            return cubeMesh;
        }

        /// <summary>XY 平面上 1×1 的方片（uv 0..1），双面</summary>
        static Mesh QuadMesh()
        {
            if (quadMesh) return quadMesh;
            quadMesh = new Mesh { name = "Telegraph Quad", hideFlags = HideFlags.DontSave };
            quadMesh.vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0) };
            quadMesh.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) };
            quadMesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            quadMesh.RecalculateBounds();
            return quadMesh;
        }

        /// <summary>没有预警着色器时的圆形贴图：亮边 + 淡底</summary>
        static Texture2D CircleTexture()
        {
            if (circleTex) return circleTex;
            const int n = 128;
            circleTex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.DontSave };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f) * (1 + Pad);
                float rim = Mathf.Clamp01(1 - Mathf.Abs(d - 0.95f) / 0.06f);
                float fill = d < 0.95f ? 0.25f : 0;
                px[y * n + x] = new Color(1, 1, 1, Mathf.Max(rim, fill));
            }
            circleTex.SetPixels32(px);
            circleTex.Apply();
            return circleTex;
        }

        /// <summary>没有预警着色器时的长条贴图：两侧亮边 + 淡底</summary>
        static Texture2D RectTexture()
        {
            if (rectTex) return rectTex;
            const int n = 64;
            rectTex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.DontSave };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float u = Mathf.Abs((x + 0.5f) / n * 2 - 1);
                float edge = Mathf.Clamp01(1 - Mathf.Abs(u - 0.85f) / 0.1f);
                px[y * n + x] = new Color(1, 1, 1, Mathf.Max(edge, u < 0.85f ? 0.25f : 0));
            }
            rectTex.SetPixels32(px);
            rectTex.Apply();
            return rectTex;
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
            foreach (var s in slots)
                if (s.mat) Destroy(s.mat);
        }
    }
}
