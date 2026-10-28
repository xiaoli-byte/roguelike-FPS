using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效打磨 B 路的材质表（卡通序列帧粒子、护盾球壳、状态皮）：名字、着色器、设置。
    /// FxBlastBuilder（编辑器，bridge.sh fx 时一起跑）按这张表写 Assets/Game/Resources/Fx/Materials/&lt;名字&gt;.mat；运行时按名字从 Resources 取。
    /// 资产缺失时：编辑器里按同一份设置现场建（贴图从 Assets/Art/Fx 读），打包后退回普通粒子材质（形状不对，但绝不是粉色）。
    /// 序列帧图集 T_Fx_Blast（2048 × 2048，8 × 8 格）由 scripts/unity/fx_blast_atlas.py 生成，帧号见下面的常量。
    /// </summary>
    public static class FxToon
    {
        public const string ShaderToon = "Spiritfire/FxToon";
        public const string ShaderShield = "Spiritfire/FxShield";
        public const string ShaderStatusSkin = "Spiritfire/FxStatusSkin";

        /// <summary>序列帧图集（Assets/Art/Fx/T_Fx_Blast.png）</summary>
        public const string Atlas = "T_Fx_Blast";
        public const string AtlasPath = "Assets/Art/Fx/T_Fx_Blast.png";

        // ── 材质名 ──
        /// <summary>火团：快速冷却、整团啃掉</summary>
        public const string Fire = "M_Fx_ToonFire";
        /// <summary>火舌：不怎么冷却、只在最后收一点</summary>
        public const string Flame = "M_Fx_ToonFlame";
        /// <summary>烟团：实心、慢慢啃掉</summary>
        public const string Smoke = "M_Fx_ToonSmoke";
        /// <summary>平涂发光：冲击环、爆闪星、刻符</summary>
        public const string Glow = "M_Fx_ToonGlow";
        /// <summary>护盾球壳（SF_FxShield）</summary>
        public const string Shield = "M_Fx_ShieldBubble";
        /// <summary>状态皮（SF_FxStatusSkin：冰壳 / 蚀斑 / 电纹 / 炭火纹 + 状态色轮廓光）</summary>
        public const string StatusSkin = "M_Fx_StatusSkin";

        // ── 图集帧号（8 × 8，左上角为 0）──
        public const int FireFirst = 0, SmokeFirst = 16, FlameFirst = 48, SeqFrames = 16;
        public const int RingFrame = 32, BurstFrame = 33, DustRingFrame = 34, SealFrame = 35, CracksFrame = 36, CrownFrame = 37;

        public sealed class Def
        {
            public string name, shader;
            /// <summary>用不用序列帧图集</summary>
            public bool atlas;
            public Action<Material> setup;
        }

        static readonly int ModeId = Shader.PropertyToID("_Mode");
        static readonly int ErodeId = Shader.PropertyToID("_Erode");
        static readonly int CoolId = Shader.PropertyToID("_Cool");
        static readonly int BrightId = Shader.PropertyToID("_Bright");
        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");

        static Def Toon(string name, int mode, Vector4 erode, Vector4 cool, float bright, int queueOffset) => new()
        {
            name = name, shader = ShaderToon, atlas = true,
            setup = m =>
            {
                m.SetFloat(ModeId, mode);
                m.SetVector(ErodeId, erode);
                m.SetVector(CoolId, cool);
                m.SetFloat(BrightId, bright);
                m.SetFloat("_QueueOffset", queueOffset);
                m.SetOverrideTag("RenderType", "Transparent");
                // 烟最先、火团其次、发光的最后（和普通粒子的 Alpha +2 / Add +4 交错）
                m.renderQueue = (int)RenderQueue.Transparent + queueOffset;
                m.enableInstancing = false;
            },
        };

        /// <summary>全部材质定义（FxBlastBuilder 按这张表生成资产）</summary>
        public static readonly Def[] Defs =
        {
            Toon(Smoke, 1, new Vector4(0.03f, 0.96f, 1.35f, 0.015f), new Vector4(0, 0, 1, 0), 1f, 1),
            // HDR 亮度压一档（风格审查：火团 / 发光件不比旁边的手绘模型亮一截，Bloom 只吃亮芯）
            Toon(Fire, 0, new Vector4(0.02f, 0.97f, 1.9f, 0.015f), new Vector4(1.0f, 1.05f, 0.94f, 0), 1.45f, 3),
            Toon(Flame, 0, new Vector4(0.02f, 0.5f, 2.2f, 0.015f), new Vector4(0.25f, 1.1f, 0.82f, 0), 1.45f, 3),
            Toon(Glow, 2, new Vector4(0.02f, 0.95f, 1.0f, 0.01f), new Vector4(0.2f, 1f, 0.22f, 0), 1.2f, 5),
            new Def
            {
                name = Shield, shader = ShaderShield,
                setup = m =>
                {
                    m.SetOverrideTag("RenderType", "Transparent");
                    m.renderQueue = (int)RenderQueue.Transparent - 10;
                    m.enableInstancing = false;
                },
            },
            new Def
            {
                name = StatusSkin, shader = ShaderStatusSkin,
                setup = m =>
                {
                    m.SetOverrideTag("RenderType", "Transparent");
                    m.renderQueue = (int)RenderQueue.Transparent - 30;
                    m.enableInstancing = false;
                },
            },
        };

        static readonly Dictionary<string, Material> cache = new();
        static bool warned;

        public static Def Find(string name)
        {
            foreach (var d in Defs)
                if (d.name == name)
                    return d;
            return null;
        }

        /// <summary>按名字取材质；缺资产时编辑器现场建，打包后退回普通粒子材质（blend 决定加法 / 透明）</summary>
        public static Material Material(string name, FxBlend blend = FxBlend.Alpha)
        {
            if (string.IsNullOrEmpty(name)) return blend == FxBlend.Additive ? FxMaterials.ParticleAdd : FxMaterials.ParticleAlpha;
            if (cache.TryGetValue(name, out var m) && m) return m;
            m = Resources.Load<Material>($"{FxMaterials.ResourcesDir}/{name}");
            if (!FxMaterials.Usable(m)) m = Fallback(name, blend);
            cache[name] = m;
            return m;
        }

        /// <summary>材质资产是不是真的（不是兜底）：测试 / 冒烟用</summary>
        public static bool HasAsset(string name) => FxMaterials.Usable(Resources.Load<Material>($"{FxMaterials.ResourcesDir}/{name}"));

        static Material Fallback(string name, FxBlend blend)
        {
            if (!warned)
            {
                warned = true;
                Debug.LogWarning($"[Fx] 卡通特效材质 {name} 缺失（还没跑 bridge.sh fx），先用临时材质");
            }
            Material m = null;
#if UNITY_EDITOR
            var def = Find(name);
            var shader = def != null ? Shader.Find(def.shader) : null;
            if (shader && shader.isSupported)
            {
                m = new Material(shader) { name = name + " (fallback)", hideFlags = HideFlags.DontSave };
                def.setup?.Invoke(m);
                if (def.atlas)
                {
                    var tex = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(AtlasPath);
                    if (tex) m.SetTexture(BaseMapId, tex);
                }
            }
#endif
            return m ? m : blend == FxBlend.Additive ? FxMaterials.ParticleAdd : FxMaterials.ParticleAlpha;
        }

        /// <summary>序列帧描述：材质 + 一段帧</summary>
        public static FxFlipbook Seq(string material, int first, int count = SeqFrames, float cycles = 1) =>
            new() { material = material, columns = 8, rows = 8, first = first, count = count, cycles = cycles };
    }
}
