using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火苗着色（FX4 _FLAMEKEY；Three.js FlameFx.applyFlameFur）：火浣鼠 / 祸斗 / 炭童这类「雕塑感的火苗毛」——贴图里浅金 / 亮橙的那部分毛
    /// 在 SF_StylizedLit 里按色键认出来、叠一层往上流的闪烁自发光。这里每帧把亮度（调用方给的公式：平时微亮、前摇 / 滚动最亮）和火光颜色
    /// 写进身体渲染器的 _FlameKey / _FlameKeyColor（MaterialPropertyBlock，不改共享材质）；亮度 0 时着色器整段跳过。
    /// 挂法：敌人 AI 在 Awake 里 <see cref="Attach"/>。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FlameKey : MonoBehaviour
    {
        static readonly int KeyId = Shader.PropertyToID("_FlameKey");
        static readonly int ColorId = Shader.PropertyToID("_FlameKeyColor");

        /// <summary>Three.js applyFlameFur 的缺省火光色 0xffa040</summary>
        public static readonly Color DefaultColor = Hex.Rgb(0xffa040);

        readonly List<Renderer> renderers = new();
        MaterialPropertyBlock block;
        Func<float> glow;
        Color color = DefaultColor;
        float widen, last = -1;
        int scannedFrame = -1;

        /// <summary>当前亮度（测试用）</summary>
        public float Glow { get; private set; }

        /// <summary>身体上认出来的渲染器数（测试用）</summary>
        public int Renderers => renderers.Count;

        /// <summary>给 target（敌人）挂火苗着色：glow = 每帧的亮度（约 0.35 平时 ~ 1.1 最旺），color = 火光色，widen = 色键放宽 0..1（贴图偏暗的火苗毛）</summary>
        public static FlameKey Attach(Component target, Func<float> glow, Color? color = null, float widen = 0)
        {
            if (!target) return null;
            var k = target.GetComponent<FlameKey>() ?? target.gameObject.AddComponent<FlameKey>();
            k.glow = glow;
            k.color = color ?? DefaultColor;
            k.widen = Mathf.Clamp01(widen);
            k.last = -1;
            return k;
        }

        void Awake() => block = new MaterialPropertyBlock();

        void Scan()
        {
            renderers.Clear();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer || r.name.Contains("GlowShell")) continue;
                var m = r.sharedMaterial;
                if (m && m.HasProperty(KeyId)) renderers.Add(r);
            }
            scannedFrame = Time.frameCount;
        }

        void LateUpdate()
        {
            if (scannedFrame < 0 || (Time.frameCount - scannedFrame == 30)) Scan();
            float g = 0;
            try
            {
                g = glow != null ? Mathf.Max(0, glow()) : 0;
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                glow = null;
            }
            Glow = g;
            if (Mathf.Abs(g - last) < 0.004f) return;
            last = g;
            var col = color.linear;
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetVector(KeyId, new Vector4(g, 1, 9, widen));
                block.SetVector(ColorId, new Vector4(col.r, col.g, col.b, 1));
                r.SetPropertyBlock(block);
            }
        }

        void OnDisable()
        {
            // 停用（尸体回收、池化）时关掉，免得别的实例借到这块 MPB
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetVector(KeyId, Vector4.zero);
                r.SetPropertyBlock(block);
            }
            last = -1;
        }
    }
}
