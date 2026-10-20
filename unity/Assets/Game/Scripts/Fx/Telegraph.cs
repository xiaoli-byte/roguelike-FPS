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
        /// <summary>颜色（元素色：火橙、冰蓝、雷青、蚀绿…；alpha 乘整体不透明度）</summary>
        public Color color;
        /// <summary>加法混合（冲击环默认加法；浅色雪地上预警要用普通混合才读得出）</summary>
        public bool additive;
        /// <summary>冲击环线性扩散（与玩法判定同步的冲击波）；否则缓出</summary>
        public bool linear;
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

        public static implicit operator FxHandle(TelegraphHandle h) => h.slot != null ? new FxHandle(h.slot, h.gen) : FxHandle.None;
    }

    /// <summary>
    /// 地面预警（F2，Three.js fx.groundWarning / Hazards.lineWarning / sectorWarning / NovaSpokes）：URP 贴花投射，贴合坡面与台阶，
    /// 不再是平面 Quad 在坡上穿地。形状：圆 / 环 / 扇形 / 长条 / 辐条 / 正多边形；样式：预警 / 冲击环 / 持续区域。
    ///   预警：由内向外填满（紧迫度 = 进度²，脉动 10 → 32 rad/s，即 Three.js 的 sin(t·(10 + 22u))），填满后闪一下、略放大、消失；
    ///         撤回时停在当前进度、0.1 s 淡出（不闪不放大，读作「这一下不会来了」）。
    ///   冲击环：线性（与冲击波判定同步）或缓出扩散，越往外越细，淡出。
    /// 每个预警一个 DecalProjector + 一份材质实例（SF_Telegraph，FxBuilder 生成 M_Fx_Telegraph），池化（上限 64，满了先挤掉正在淡出的，再挤最老的）。
    /// 投影盒的高度按形状覆盖范围内 9 个点的地面高度定：平地上只有约 1.4 m 高（只染到脚踝），坡上自动加高。
    /// 渲染器没有贴花特性（还没跑 FxBuilder）时退回平放的 Quad（同一着色器的网格通道）；连着色器都没有时退回程序贴图的普通透明 Quad。
    /// 旧接口 Circle / Wave / Line（LineHandle）签名不变；成组撤回用 <see cref="WarnScope"/>。
    /// </summary>
    public sealed class Telegraph : MonoBehaviour
    {
        const int MaxSlots = 64;
        const float CancelFade = 0.1f, Outro = 0.14f;
        public const string MaterialResource = "Fx/Materials/M_Fx_Telegraph";
        public const string ShaderName = "Spiritfire/Telegraph";
        const string MeshPass = "UniversalForwardOnly";
        static readonly string[] DecalPasses = { "DecalScreenSpaceProjector", "DecalProjectorForwardEmissive" };

        static readonly int ColorId = Shader.PropertyToID("_Color");
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
            public Material mat;
            /// <summary>材质是 SF_Telegraph（否则是程序贴图的普通透明兜底）</summary>
            public bool shaderMat;
            public bool decal;
            public TelegraphSpec spec;
            public float age, phase, fade = -1, fadeFrom, progress, opacity, pulse = 1, flash, grow, seed;
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
        public static TelegraphHandle Circle(Vector3 center, float radius, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Circle, center = center, radius = radius, duration = duration, color = color });

        /// <summary>圆环预警（inner 以内安全）</summary>
        public static TelegraphHandle Annulus(Vector3 center, float inner, float outer, float duration, Color color) =>
            Spawn(new TelegraphSpec { shape = TelegraphShape.Annulus, center = center, radius = outer, inner = Mathf.Clamp(inner, 0, outer * 0.98f), duration = duration, color = color });

        /// <summary>扇形预警：中线朝 yaw（度），半角 halfAngle（度），可带内半径</summary>
        public static TelegraphHandle Sector(Vector3 center, float yawDeg, float halfAngleDeg, float radius, float duration, Color color, float inner = 0) =>
            Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Sector, center = center, yaw = yawDeg, halfAngle = halfAngleDeg, radius = radius,
                inner = Mathf.Clamp(inner, 0, radius * 0.98f), duration = duration, color = color,
            });

        /// <summary>长条预警（新接口，返回值类型句柄）：从 from 到 to、全宽 width，由近到远填满；hold = 填满后再亮几秒</summary>
        public static TelegraphHandle Lane(Vector3 from, Vector3 to, float width, float duration, Color color, float hold = 0)
        {
            var d = to - from;
            d.y = 0;
            float len = d.magnitude;
            float yaw = len > 1e-3f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : 0;
            return Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Line, center = from, yaw = yaw, radius = Mathf.Max(0.1f, len), width = Mathf.Max(0.05f, width),
                duration = duration, hold = hold, color = color,
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

        /// <summary>向外线性扩散的冲击波环（与冲击波判定同步）：半径以 speed 增长到 maxRadius</summary>
        public static TelegraphHandle Wave(Vector3 center, float maxRadius, float speed, Color color) =>
            Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Circle, style = TelegraphStyle.Ring, center = center, radius = maxRadius,
                duration = maxRadius / Mathf.Max(0.1f, speed), color = color, additive = true, linear = true,
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
        public static LineHandle Line(Vector3 from, Vector3 to, float width, float duration, Color color) =>
            new() { h = Lane(from, to, width, duration, color) };

        /// <summary>元素色（预警用元素的颜色：火 / 冰 / 雷 / 蚀…）</summary>
        public static Color ElementColor(Element e) => DamageTable.ElementColor(e);

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
            if (s.decal) s.projector.enabled = true;
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

        /// <summary>选投射方式：有贴花特性 → DecalProjector；否则平放的 Quad（同一材质的网格通道 / 程序贴图）</summary>
        void ChooseMode(Slot s)
        {
            bool decal = s.shaderMat && DecalsSupported;
            s.decal = decal;
            var m = s.mat;
            if (s.shaderMat)
            {
                // 投影时关掉网格通道（否则投影立方体会被前向通道当普通网格画出来）；平放时关掉贴花通道
                m.SetShaderPassEnabled(MeshPass, !decal);
                foreach (var p in DecalPasses) m.SetShaderPassEnabled(p, decal);
                int order = s.spec.style switch { TelegraphStyle.Zone => -1, TelegraphStyle.Ring => 1, _ => 0 };
                m.SetFloat(DrawOrderId, order);
                // 贴花必须在不透明队列范围内（URP 的贴花通道按 RenderQueueRange.opaque 过滤）
                m.renderQueue = decal ? 2010 + order : (int)RenderQueue.Transparent - 10 + order;
                bool add = s.spec.additive;
                m.SetFloat(SrcBlendId, (float)BlendMode.SrcAlpha);
                m.SetFloat(DstBlendId, (float)(add ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            }
            else
            {
                m.renderQueue = (int)RenderQueue.Transparent - 10;
                var tex = s.spec.shape == TelegraphShape.Line ? RectTexture() : CircleTexture();
                if (m.HasProperty(BaseMapId)) m.SetTexture(BaseMapId, tex);
                if (m.HasProperty(MainTexId)) m.SetTexture(MainTexId, tex);
            }

            if (decal)
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
            }
            else
            {
                if (!s.quad)
                {
                    var q = new GameObject("Quad");
                    q.transform.SetParent(s.go.transform, false);
                    q.AddComponent<MeshFilter>().sharedMesh = QuadMesh();
                    s.quad = q.AddComponent<MeshRenderer>();
                    s.quad.sharedMaterial = m;
                    s.quad.shadowCastingMode = ShadowCastingMode.Off;
                    s.quad.receiveShadows = false;
                    s.quad.lightProbeUsage = LightProbeUsage.Off;
                    s.quad.reflectionProbeUsage = ReflectionProbeUsage.Off;
                    s.quad.enabled = false;
                }
                if (s.projector) s.projector.enabled = false;
            }
        }

        internal void ApplyColor(Slot s)
        {
            var c = s.spec.color;
            if (s.shaderMat) s.mat.SetColor(ColorId, c);
        }

        // ───────────── 摆放：投影盒尺寸 + 贴合地面的高度 ─────────────

        const float Pad = 0.35f;
        static readonly Vector2[] SamplePoints =
        {
            new(0, 0), new(-1, -1), new(1, -1), new(-1, 1), new(1, 1), new(0, -1), new(0, 1), new(-1, 0), new(1, 0),
        };

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
                    rim = Mathf.Clamp(sp.width * 0.15f, 0.06f, 0.3f);
                    break;
                case TelegraphShape.Spokes:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 2;
                    rim = Mathf.Clamp(sp.width * 0.25f, 0.04f, 0.2f);
                    break;
                case TelegraphShape.Polygon:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 3;
                    rim = Mathf.Clamp(sp.radius * 0.1f, 0.1f, 0.45f);
                    break;
                default:
                    size = Vector2.one * (sp.radius + Pad) * 2;
                    origin = Vector2.zero;
                    kind = 0;
                    rim = Mathf.Clamp(sp.radius * 0.1f, 0.1f, 0.45f);
                    break;
            }

            // 覆盖范围内 9 个点的地面高度：平地上盒子很矮（只染到脚踝），坡上 / 台阶自动加高
            float g0 = GroundAt(sp.center, sp.center.y, out bool hit0);
            float lo = g0, hi = g0;
            float hx = size.x * 0.5f - Pad, hz = size.y * 0.5f - Pad;
            foreach (var p in SamplePoints)
            {
                var at = boxCenter + right * (p.x * hx) + fwd * (p.y * hz);
                float y = GroundAt(at, g0, out bool hit);
                if (!hit) continue;
                lo = Mathf.Min(lo, y);
                hi = Mathf.Max(hi, y);
            }
            // 不让一根柱子 / 一堵墙把盒子拉到半空（坡度上限约 35°）
            float reach = 0.7f * Mathf.Max(size.x, size.y) * 0.5f + 0.6f;
            lo = Mathf.Max(lo, g0 - reach) - 0.6f;
            hi = Mathf.Min(hi, g0 + reach) + 0.8f;
            float depth = Mathf.Max(1.2f, hi - lo);

            var m = s.mat;
            if (s.shaderMat)
            {
                float halfAngle = sp.shape == TelegraphShape.Sector && sp.halfAngle < 179.5f ? sp.halfAngle * Mathf.Deg2Rad : 4f;
                float inner = sp.shape is TelegraphShape.Annulus or TelegraphShape.Sector or TelegraphShape.Spokes ? sp.inner : 0;
                m.SetVector(ExtentId, new Vector4(size.x, size.y, origin.x, origin.y));
                m.SetVector(Shape0Id, new Vector4(sp.radius, inner, halfAngle, sp.count));
                m.SetVector(Shape1Id, new Vector4(sp.width * 0.5f, 0, rim, 0));
                m.SetVector(ModeId, new Vector4(kind, (int)sp.style, 0, 0));
            }

            var t = s.go.transform;
            if (s.decal)
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

        /// <summary>(x, z) 处、参考高度 refY 附近的地面高度；没有命中返回 refY</summary>
        static float GroundAt(Vector3 p, float refY, out bool hit)
        {
            hit = Physics.Raycast(new Vector3(p.x, refY + 4f, p.z), Vector3.down, out var h, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            return hit ? h.point.y : refY;
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
            s.go.SetActive(false);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var s in slots)
            {
                if (!s.active) continue;
                if (!Step(s, dt))
                {
                    Hide(s);
                    continue;
                }
                Animate(s);
            }
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
                        s.progress = s.age / sp.duration;
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
            var c = s.spec.color;
            float a = Mathf.Clamp01(s.opacity * (s.spec.style == TelegraphStyle.Warning ? Mathf.Lerp(0.35f, 1f, s.progress) * s.pulse : 1f) * c.a);
            var col = new Color(c.r, c.g, c.b, a);
            m.SetColor(BaseColorId, col);
            m.SetColor(ColorId, col);
        }

        // ───────────── 兜底网格 / 贴图 ─────────────

        static Mesh quadMesh;

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
