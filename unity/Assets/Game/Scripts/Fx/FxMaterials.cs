using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>运行时特效共用的材质种类（每种一个 Resources/Fx/Materials/M_Fx_*.mat）</summary>
    public enum FxMaterialKind
    {
        /// <summary>不透明纯色（热核、宝石）：URP Unlit</summary>
        Unlit,
        /// <summary>加色、读顶点色、无贴图（拖尾、轨迹线）</summary>
        Additive,
        /// <summary>普通透明、读顶点色、无贴图</summary>
        AlphaBlend,
        /// <summary>径向衰减光晕片</summary>
        Glow,
        /// <summary>自下而上淡出的光柱（两片十字交叉）</summary>
        Beam,
        /// <summary>冲击环的竖直光墙（圆柱面，底亮上淡）</summary>
        Band,
        /// <summary>线状特效（曳光、光束、闪电）：柔和横截面，HDR 偏亮让 Bloom 吃到</summary>
        Line,
        /// <summary>加法粒子（贴图集，Shuriken 按帧选格）</summary>
        ParticleAdd,
        /// <summary>普通透明粒子（烟、尘、碎屑；贴图集）</summary>
        ParticleAlpha,
        /// <summary>第一人称枪口火焰（FirstPerson 层的面片，加色、没有贴脸淡出，T_Fx_Muzzle）</summary>
        Muzzle,
        /// <summary>贴花：图集格（弹孔 / 焦痕 / 溅痕），每个投影器的格号 / 余热 / 发光色走 DecalProjector 的 uvScale / uvBias（SF_FxDecal 模式 0）</summary>
        DecalSprite,
        /// <summary>贴花：熔池（程序纹理，流动的熔铜 + 蚀绿冒泡，SF_FxDecal 模式 1）</summary>
        DecalPool,
        /// <summary>贴花：出生法阵（双环 + 刻度 + 转动的符段，敌人色，SF_FxDecal 模式 2）</summary>
        DecalRune,
        /// <summary>贴花：归墟涡旋（三色旋臂向中心收拢，SF_FxDecal 模式 3）</summary>
        DecalVortex,
        /// <summary>贴花：流动霜纹（FX3 冻雾 / 冰环 / 滑冰带：羽状白霜 + 冰晶闪点，SF_FxDecal 模式 4）</summary>
        DecalFrost,
        /// <summary>冰（FX3 霜甲壳、冰刺：半透明多面冰 + 棱边高光 + 菲涅尔，Assets/Art/Shaders/SF_FxIce.shader）</summary>
        Ice,
        /// <summary>火舌（FX4：朝镜头的噪声火苗面片，半加法 HDR，Assets/Art/Shaders/SF_FxFlame.shader）</summary>
        Flame,
        /// <summary>贴花：地火（FX4 余烬 / 纸灰 / 熔铜 / 熔岩溅 / 日火裂痕，SF_FxDecal 模式 5）</summary>
        DecalFire,
        /// <summary>铁链（FX4 马面勾魂索：程序化链环，受光的冷铁 + 按顶点色烧红，Assets/Art/Shaders/SF_FxChain.shader）</summary>
        Chain,
    }

    /// <summary>
    /// 运行时特效共用的材质（弹丸、掉落物、宝箱光柱、拖尾、粒子…）。
    /// 材质来自 FxBuilder 生成的资产（Assets/Game/Resources/Fx/Materials/M_Fx_*.mat，贴图在 Assets/Art/Fx/），
    /// 打包时随 Resources 带上着色器和用到的变体，运行时不再 Shader.Find（3.0 P0：打包可能被剥离 → 粉色）。
    /// 资产缺失或着色器不可用时的兜底：编辑器里按同一份设置现场建；打包后只用 UI 默认材质（永远存在、永远不是粉色）。
    /// 改色一律走 MaterialPropertyBlock（<see cref="Tint"/>），不复制材质。
    /// </summary>
    public static class FxMaterials
    {
        public const string ResourcesDir = "Fx/Materials";
        public const string ShaderUnlit = "Universal Render Pipeline/Unlit";
        public const string ShaderParticles = "Universal Render Pipeline/Particles/Unlit";
        public const string ShaderDecal = "Spiritfire/FxDecal";
        public const string ShaderIce = "Spiritfire/FxIce";
        public const string ShaderFlame = "Spiritfire/FxFlame";
        public const string ShaderChain = "Spiritfire/FxChain";

        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        static readonly int MainTexId = Shader.PropertyToID("_MainTex");
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ColorId = Shader.PropertyToID("_Color");

        static readonly Material[] cache = new Material[Enum.GetValues(typeof(FxMaterialKind)).Length];
        static readonly Texture2D[] fallbackTex = new Texture2D[FxTextures.All.Length];
        static MaterialPropertyBlock block;
        static bool warned;

        public static Material Unlit => Get(FxMaterialKind.Unlit);
        public static Material Additive => Get(FxMaterialKind.Additive);
        public static Material AlphaBlend => Get(FxMaterialKind.AlphaBlend);
        public static Material Glow => Get(FxMaterialKind.Glow);
        public static Material Beam => Get(FxMaterialKind.Beam);
        public static Material Band => Get(FxMaterialKind.Band);
        public static Material Line => Get(FxMaterialKind.Line);
        public static Material ParticleAdd => Get(FxMaterialKind.ParticleAdd);
        public static Material ParticleAlpha => Get(FxMaterialKind.ParticleAlpha);
        public static Material Muzzle => Get(FxMaterialKind.Muzzle);

        /// <summary>贴花材质（SF_FxDecal）；资产缺失 / 着色器不可用时为 null（贴花是纯装饰，没有就不画）</summary>
        public static Material Decal(FxMaterialKind kind)
        {
            if (!IsDecal(kind)) return null;
            var m = Get(kind);
            return m && m.shader && m.shader.name == ShaderDecal && m.shader.isSupported ? m : null;
        }

        /// <summary>资产名（不含扩展名）：M_Fx_Unlit、M_Fx_ParticleAdd…</summary>
        public static string AssetName(FxMaterialKind kind) => "M_Fx_" + kind;

        /// <summary>这种材质用的着色器名（FxBuilder 建材质用；运行时只在编辑器兜底时用）</summary>
        public static string ShaderName(FxMaterialKind kind) => kind switch
        {
            FxMaterialKind.Unlit => ShaderUnlit,
            _ when IsDecal(kind) => ShaderDecal,
            FxMaterialKind.Ice => ShaderIce,
            FxMaterialKind.Flame => ShaderFlame,
            FxMaterialKind.Chain => ShaderChain,
            _ => ShaderParticles,
        };

        /// <summary>SF_FxDecal 的几种材质（贴花投影，不走粒子 / 网格）</summary>
        public static bool IsDecal(FxMaterialKind kind) =>
            kind is FxMaterialKind.DecalSprite or FxMaterialKind.DecalPool or FxMaterialKind.DecalRune or FxMaterialKind.DecalVortex or FxMaterialKind.DecalFrost
                or FxMaterialKind.DecalFire;

        /// <summary>SF_FxDecal 的 _Mode</summary>
        public static int DecalMode(FxMaterialKind kind) => kind switch
        {
            FxMaterialKind.DecalPool => 1,
            FxMaterialKind.DecalRune => 2,
            FxMaterialKind.DecalVortex => 3,
            FxMaterialKind.DecalFrost => 4,
            FxMaterialKind.DecalFire => 5,
            _ => 0,
        };

        /// <summary>这种材质用的贴图（<see cref="FxTextures"/> 的名字；null = 不用贴图）</summary>
        public static string TextureName(FxMaterialKind kind) => kind switch
        {
            FxMaterialKind.Glow => FxTextures.Glow,
            FxMaterialKind.Beam => FxTextures.BeamFade,
            FxMaterialKind.Band => FxTextures.Band,
            FxMaterialKind.Line => FxTextures.Line,
            FxMaterialKind.ParticleAdd or FxMaterialKind.ParticleAlpha => FxTextures.Atlas,
            FxMaterialKind.Muzzle => FxTextures.Muzzle,
            FxMaterialKind.DecalSprite => FxTextures.DecalAtlas,
            _ => null,
        };

        public static Material Get(FxMaterialKind kind)
        {
            int i = (int)kind;
            var m = cache[i];
            if (m) return m;
            m = Resources.Load<Material>($"{ResourcesDir}/{AssetName(kind)}");
            if (!Usable(m)) m = Fallback(kind);
            cache[i] = m;
            return m;
        }

        /// <summary>材质能用：存在、着色器没被剥离（被剥离时 Unity 换成粉色的 InternalErrorShader）、当前平台支持</summary>
        public static bool Usable(Material m) =>
            m && m.shader && m.shader.isSupported && m.shader.name != "Hidden/InternalErrorShader";

        /// <summary>
        /// 按种类设置一份材质（FxBuilder 建 .mat 与编辑器兜底共用，保证两条路径一样）。
        /// 粒子着色器的透明设置照 URP BaseShaderGUI / ParticleGUI 的做法手写（编辑器程序集不引用 URP Editor）。
        /// </summary>
        public static void Setup(Material m, FxMaterialKind kind, Texture tex)
        {
            switch (kind)
            {
                case FxMaterialKind.Unlit:
                    m.SetColor(BaseColorId, Color.white);
                    m.renderQueue = (int)RenderQueue.Geometry;
                    return;
                case FxMaterialKind.Additive:
                    SetupParticle(m, true, null, 0, 1f, false);
                    return;
                case FxMaterialKind.AlphaBlend:
                    SetupParticle(m, false, null, 0, 1f, false);
                    return;
                case FxMaterialKind.Glow:
                case FxMaterialKind.Beam:
                    SetupParticle(m, true, tex, 0, 1f, false);
                    return;
                case FxMaterialKind.Band:
                    SetupParticle(m, true, tex, 2, 1.25f, false);
                    return;
                case FxMaterialKind.Line:
                    SetupParticle(m, true, tex, 6, 1.5f, false);
                    return;
                case FxMaterialKind.ParticleAdd:
                    // 加法粒子排在透明粒子之后（烟先画，发光的叠在上面），HDR 偏亮一点让火花 / 闪光吃到 Bloom
                    SetupParticle(m, true, tex, 4, 1.35f, true);
                    return;
                case FxMaterialKind.ParticleAlpha:
                    SetupParticle(m, false, tex, 2, 1f, true);
                    return;
                case FxMaterialKind.Muzzle:
                    // 第一人称面片离镜头只有半米多：不能有贴脸淡出；HDR 偏亮让 Bloom 吃到
                    SetupParticle(m, true, tex, 8, 2f, false);
                    return;
                case FxMaterialKind.DecalSprite:
                case FxMaterialKind.DecalPool:
                case FxMaterialKind.DecalRune:
                case FxMaterialKind.DecalVortex:
                case FxMaterialKind.DecalFrost:
                case FxMaterialKind.DecalFire:
                    SetupDecal(m, kind, tex);
                    return;
                case FxMaterialKind.Ice:
                    SetupIce(m);
                    return;
                case FxMaterialKind.Flame:
                    m.SetOverrideTag("RenderType", "Transparent");
                    m.renderQueue = (int)RenderQueue.Transparent + 5;
                    m.enableInstancing = false;
                    return;
                case FxMaterialKind.Chain:
                    // 线性值直接写（SetColor 会把 HDR 色再做一遍伽马换算）
                    m.SetVector("_HeatLow", new Vector4(0.6f, 0.07f, 0.01f, 1f));
                    m.SetVector("_HeatHigh", new Vector4(1.9f, 0.78f, 0.22f, 1f));
                    m.renderQueue = (int)RenderQueue.Geometry;
                    m.enableInstancing = false;
                    return;
            }
        }

        static readonly int DecalModeId = Shader.PropertyToID("_Mode");
        static readonly int DecalMapId = Shader.PropertyToID("_DecalMap");
        static readonly int DrawOrderId = Shader.PropertyToID("_DrawOrder");

        /// <summary>
        /// SF_FxDecal：预乘 alpha（Blend One OneMinusSrcAlpha，压暗与发光一次画完）；贴花通道按不透明队列过滤（2000 + 绘制顺序），
        /// 弹孔在最下面、法阵 / 涡旋在上面。每个投影器自己的参数走 _NormalToWorld（DecalProjector 的 fadeFactor / uvScale / uvBias），
        /// 所以同一种贴花共用一份材质、可以合批。
        /// </summary>
        static void SetupDecal(Material m, FxMaterialKind kind, Texture tex)
        {
            int mode = DecalMode(kind);
            m.SetFloat(DecalModeId, mode);
            if (tex && m.HasProperty(DecalMapId)) m.SetTexture(DecalMapId, tex);
            // 弹孔最下；霜纹在弹孔之上、熔池 / 法阵之下
            int order = mode switch { 0 => -2, 1 => 1, 4 => 0, 5 => 0, _ => 2 };
            m.SetFloat(DrawOrderId, order);
            m.renderQueue = 2010 + order;
            m.enableInstancing = true;
        }

        /// <summary>SF_FxIce：透明队列（在粒子之前画）、不写深度，颜色 / 参数走 MaterialPropertyBlock</summary>
        static void SetupIce(Material m)
        {
            m.SetColor(BaseColorId, new Color(0.62f, 0.86f, 1f, 1f));
            m.SetOverrideTag("RenderType", "Transparent");
            m.renderQueue = (int)RenderQueue.Transparent - 20;
            m.enableInstancing = false;
        }

        /// <summary>URP Particles/Unlit 的透明设置：加法 / 普通混合、不写深度、双面、可选贴脸淡出</summary>
        public static void SetupParticle(Material m, bool additive, Texture tex, int queueOffset, float brightness, bool cameraFade)
        {
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", additive ? 2 : 0);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_DstBlendAlpha", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetFloat("_ZWrite", 0);
            m.SetFloat("_Cull", (float)CullMode.Off);
            m.SetFloat("_ColorMode", 0);
            m.SetFloat("_QueueOffset", queueOffset);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.DisableKeyword("_ALPHAMODULATE_ON");
            m.DisableKeyword("_COLOROVERLAY_ON");
            m.DisableKeyword("_COLORCOLOR_ON");
            m.DisableKeyword("_COLORADDSUBDIFF_ON");
            m.SetOverrideTag("RenderType", "Transparent");
            m.SetShaderPassEnabled("DepthOnly", false);
            m.renderQueue = (int)RenderQueue.Transparent + queueOffset;
            m.SetColor(BaseColorId, new Color(brightness, brightness, brightness, 1));
            if (tex) m.SetTexture(BaseMapId, tex);
            // 贴脸淡出（Three.js 粒子：smoothstep(0.12, 0.9, 深度)），避免满屏大光斑；只用相机深度，不需要深度图
            m.SetFloat("_CameraFadingEnabled", cameraFade ? 1 : 0);
            m.SetFloat("_CameraNearFadeDistance", 0.12f);
            m.SetFloat("_CameraFarFadeDistance", 0.9f);
            m.SetVector("_CameraFadeParams", cameraFade ? new Vector4(0.12f, 1f / (0.9f - 0.12f), 0, 0) : new Vector4(0, float.PositiveInfinity, 0, 0));
            if (cameraFade) m.EnableKeyword("_FADING_ON");
            else m.DisableKeyword("_FADING_ON");
        }

        static Material Fallback(FxMaterialKind kind)
        {
            if (!warned)
            {
                warned = true;
                Debug.LogWarning("[Fx] 特效材质资产缺失（还没跑 FxBuilder：bridge.sh fx 或菜单 Spiritfire/特效/生成特效资产），先用临时材质");
            }
            var tex = FallbackTexture(TextureName(kind));
            Material m = null;
#if UNITY_EDITOR
            // 只在编辑器里按名字找着色器；打包后找不到的着色器会被剥离，Shader.Find 只会拿到 null
            var shader = Shader.Find(ShaderName(kind));
            if (shader && shader.isSupported)
            {
                m = new Material(shader);
                Setup(m, kind, tex);
            }
#endif
            if (!m)
            {
                // UI 默认材质永远在包里（顶点色 × 贴图，普通透明）：颜色可能不完全对，但绝不是粉色
                m = new Material(Canvas.GetDefaultCanvasMaterial());
                if (tex) m.SetTexture(MainTexId, tex);
            }
            m.name = AssetName(kind) + " (fallback)";
            m.hideFlags = HideFlags.DontSave;
            return m;
        }

        static Texture2D FallbackTexture(string name)
        {
            if (name == null) return null;
            int i = Array.IndexOf(FxTextures.All, name);
            if (i < 0) return null;
            if (!fallbackTex[i])
            {
                fallbackTex[i] = FxTextures.Create(name);
                fallbackTex[i].hideFlags = HideFlags.DontSave;
            }
            return fallbackTex[i];
        }

        /// <summary>复制加色材质并换一张贴图（每种用途建一次，别每帧调）</summary>
        public static Material MakeAdditive(Texture2D tex) => Derive(Additive, tex);

        /// <summary>复制普通透明材质并换一张贴图（每种用途建一次，别每帧调）</summary>
        public static Material MakeAlpha(Texture2D tex) => Derive(AlphaBlend, tex);

        static Material Derive(Material template, Texture2D tex)
        {
            var m = new Material(template);
            if (tex)
            {
                if (m.HasProperty(BaseMapId)) m.SetTexture(BaseMapId, tex);
                if (m.HasProperty(MainTexId)) m.SetTexture(MainTexId, tex);
            }
            return m;
        }

        /// <summary>给一个渲染器上色（不复制材质；共用一个 MaterialPropertyBlock，不产生垃圾）</summary>
        public static void Tint(Renderer r, Color c)
        {
            if (!r) return;
            block ??= new MaterialPropertyBlock();
            block.Clear();
            block.SetColor(BaseColorId, c);
            block.SetColor(ColorId, c);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = ShadowCastingMode.Off;
        }

        /// <summary>朝向相机的光晕片（挂到 parent 下）</summary>
        public static Transform GlowSprite(Transform parent, float size, Color c)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            UnityEngine.Object.Destroy(q.GetComponent<Collider>());
            q.name = "Glow";
            q.transform.SetParent(parent, false);
            q.transform.localScale = Vector3.one * size;
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = Glow;
            Tint(r, c);
            q.AddComponent<Billboard>();
            return q.transform;
        }

        /// <summary>光柱：两片十字交叉的竖直面片（底部在 parent 原点），横向中间亮、纵向自下而上淡出</summary>
        public static Transform BeamSprite(Transform parent, float width, float height, Color c)
        {
            var root = new GameObject("Beam").transform;
            root.SetParent(parent, false);
            for (int i = 0; i < 2; i++)
            {
                var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
                UnityEngine.Object.Destroy(q.GetComponent<Collider>());
                q.transform.SetParent(root, false);
                q.transform.localPosition = Vector3.up * height * 0.5f;
                q.transform.localRotation = Quaternion.Euler(0, i * 90, 0);
                q.transform.localScale = new Vector3(width, height, 1);
                var r = q.GetComponent<Renderer>();
                r.sharedMaterial = Beam;
                Tint(r, c);
            }
            return root;
        }
    }
}
