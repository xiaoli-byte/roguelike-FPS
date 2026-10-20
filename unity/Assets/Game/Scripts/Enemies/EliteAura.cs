using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英的金环（Three.js 版 EnemyBase.addEliteAura：脚下一圈金色细环，半径 1.6 × 身体半径，随体型放大）：
    /// 一眼认出「这只是精英」；带词缀时环里再套一圈词缀色的细环（<see cref="SetAccent"/>，迅捷青、坚盾蓝、爆裂橙、狂暴红）。
    /// 金环缓慢呼吸，死亡时收起。环是根节点下两块贴地面片（不投影、没有碰撞体），材质全场共用一份、颜色走 MaterialPropertyBlock。
    /// 只在 Play 里建面片；EditMode 里组件照常挂上（记下半径与词缀色）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EliteAura : MonoBehaviour
    {
        /// <summary>金环颜色（TS 0xffc233，不透明度 0.85）与半径（× 身体半径，设计尺寸）</summary>
        public static readonly Color Gold = new(1f, 0.76f, 0.2f, 0.85f);
        public const float RadiusMult = 1.6f;

        static Material material;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        Damageable hp;
        Renderer ring, accent;
        MaterialPropertyBlock block;

        /// <summary>环半径（设计尺寸，根节点的缩放会再乘上去）</summary>
        public float Radius { get; private set; }
        /// <summary>词缀色（没有词缀为 null）</summary>
        public Color? Accent { get; private set; }

        /// <summary>给敌人挂金环（已挂过返回原来的）；bodyRadius = 定义里的身体半径（设计尺寸）</summary>
        public static EliteAura Attach(EnemyAI ai, float bodyRadius)
        {
            if (!ai) return null;
            if (ai.TryGetComponent<EliteAura>(out var a)) return a;
            a = ai.gameObject.AddComponent<EliteAura>();
            a.hp = ai.Health;
            a.Radius = Mathf.Max(0.2f, bodyRadius) * RadiusMult;
            a.Build();
            return a;
        }

        /// <summary>词缀色的内圈（null = 去掉）</summary>
        public void SetAccent(Color? c)
        {
            Accent = c;
            if (accent) accent.gameObject.SetActive(c.HasValue);
        }

        void Build()
        {
            if (!Application.isPlaying) return;
            block = new MaterialPropertyBlock();
            ring = Quad("Elite Ring", Radius);
            accent = Quad("Elite Affix Ring", Radius * 0.84f);
            accent.gameObject.SetActive(Accent.HasValue);
        }

        Renderer Quad(string quadName, float radius)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            var col = q.GetComponent<Collider>();
            col.enabled = false;
            Destroy(col);
            q.name = quadName;
            q.layer = Layers.IgnoreRaycast;
            q.transform.SetParent(transform, false);
            q.transform.localPosition = new Vector3(0, 0.05f, 0);
            q.transform.localRotation = Quaternion.Euler(90, 0, 0);
            q.transform.localScale = new Vector3(radius * 2, radius * 2, 1);
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = Material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return r;
        }

        void LateUpdate()
        {
            if (!ring) return;
            bool show = !hp || !hp.Dead;
            ring.enabled = show;
            if (accent) accent.enabled = show && Accent.HasValue;
            if (!show) return;
            float t = Time.time;
            var g = Gold;
            g.a *= 0.8f + 0.2f * Mathf.Sin(t * 2.4f);
            block.SetColor(BaseColorId, g);
            ring.SetPropertyBlock(block);
            if (accent && Accent.HasValue)
            {
                var c = Accent.Value;
                c.a = 0.55f + 0.25f * Mathf.Sin(t * 3.1f + 1f);
                block.SetColor(BaseColorId, c);
                accent.SetPropertyBlock(block);
            }
        }

        /// <summary>细环材质（加色，从 FxMaterials 的模板派生，不运行时 Shader.Find）</summary>
        static Material Material
        {
            get
            {
                if (material) return material;
                material = FxMaterials.MakeAdditive(RingTexture());
                material.name = "Elite Ring (runtime)";
                material.renderQueue = (int)RenderQueue.Transparent - 10;
                return material;
            }
        }

        /// <summary>细环：半径 0.94 处一道亮边（宽 0.06），里外都透明</summary>
        static Texture2D RingTexture()
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = "Elite Ring" };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                float rim = Mathf.Clamp01(1 - Mathf.Abs(d - 0.94f) / 0.06f);
                px[y * n + x] = new Color(1, 1, 1, rim * rim * (3 - 2 * rim));
            }
            tex.SetPixels32(px);
            tex.Apply();
            return tex;
        }
    }
}
