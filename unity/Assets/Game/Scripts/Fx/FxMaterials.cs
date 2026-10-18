using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 运行时特效共用的材质与贴图（弹丸、掉落物、宝箱光柱…）：全部惰性创建一次，按 MaterialPropertyBlock 改色。
    ///   Unlit：不透明纯色（热核、宝石）；Additive：加色、读顶点色（拖尾）；Glow：径向衰减光晕；Beam：自下而上淡出的光柱
    /// </summary>
    public static class FxMaterials
    {
        static Material unlit, additive, glow, beam;

        public static Material Unlit => unlit ? unlit : unlit = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
        public static Material Additive => additive ? additive : additive = MakeAdditive(null);
        public static Material Glow => glow ? glow : glow = MakeAdditive(RadialTexture());
        public static Material Beam => beam ? beam : beam = MakeAdditive(VerticalFadeTexture());

        public static Material MakeAdditive(Texture2D tex)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit"));
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 2);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.One);
            m.SetFloat("_ZWrite", 0);
            m.SetFloat("_Cull", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = 3000;
            if (tex) m.SetTexture("_BaseMap", tex);
            return m;
        }

        /// <summary>给一个渲染器上色（不复制材质）</summary>
        public static void Tint(Renderer r, Color c)
        {
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", c);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = ShadowCastingMode.Off;
        }

        /// <summary>朝向相机的光晕片（挂到 parent 下）</summary>
        public static Transform GlowSprite(Transform parent, float size, Color c)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(q.GetComponent<Collider>());
            q.name = "Glow";
            q.transform.SetParent(parent, false);
            q.transform.localScale = Vector3.one * size;
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = Glow;
            Tint(r, c);
            q.AddComponent<Billboard>();
            return q.transform;
        }

        static Texture2D RadialTexture()
        {
            const int n = 64;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = new Vector2(x - n / 2 + 0.5f, y - n / 2 + 0.5f).magnitude / (n / 2);
                tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Pow(Mathf.Clamp01(1 - d), 2.2f)));
            }
            tex.Apply();
            return tex;
        }

        /// <summary>光柱：两片十字交叉的竖直面片（底部在 parent 原点），横向中间亮、纵向自下而上淡出</summary>
        public static Transform BeamSprite(Transform parent, float width, float height, Color c)
        {
            var root = new GameObject("Beam").transform;
            root.SetParent(parent, false);
            for (int i = 0; i < 2; i++)
            {
                var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Object.Destroy(q.GetComponent<Collider>());
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

        static Texture2D VerticalFadeTexture()
        {
            const int w = 32, h = 64;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float u = Mathf.Abs((x + 0.5f) / w * 2 - 1), v = y / (h - 1f);
                float a = Mathf.Pow(1 - u, 2.2f) * Mathf.Pow(1 - v, 1.4f) * Mathf.SmoothStep(0, 1, v * 12);
                tex.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            tex.Apply();
            return tex;
        }
    }
}
