using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 挂在骨骼上的冰晶星芒（FX3；Three.js FrostRangedFx.createFrostGlow 的十字星光点）：朝向相机的一片六芒星芒（粒子图集的 IceStar 格，加法），
    /// 调用方每帧给亮度 / 大小（夫诸角尖、冰鲸喷气孔蓄力时变大变亮）；自己会慢慢转、微微闪。亮度 0 时不画。
    /// 挂在 parent 下跟着动画走，parent 销毁时一起没。一次性的「叮」见 <see cref="Fx.FrostGlint"/>。
    /// </summary>
    public sealed class FrostGlint : MonoBehaviour
    {
        static Mesh quad;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        MeshRenderer mr;
        MaterialPropertyBlock block;
        Color color;
        float alpha, size = 1, seed, spin;

        /// <summary>当前亮度（0..1）</summary>
        public float Alpha => alpha;

        /// <summary>在 parent 的局部坐标 local 处挂一片星芒；size = 直径（米，世界尺寸），color = 星芒色</summary>
        public static FrostGlint Attach(Transform parent, Vector3 local, float size, Color color)
        {
            if (!parent || !Application.isPlaying) return null;
            var go = new GameObject("Frost Glint");
            go.layer = parent.gameObject.layer;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            go.AddComponent<MeshFilter>().sharedMesh = Quad;
            var g = go.AddComponent<FrostGlint>();
            g.mr = go.AddComponent<MeshRenderer>();
            g.mr.sharedMaterial = FxMaterials.ParticleAdd;
            g.mr.shadowCastingMode = ShadowCastingMode.Off;
            g.mr.receiveShadows = false;
            g.mr.lightProbeUsage = LightProbeUsage.Off;
            g.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            g.block = new MaterialPropertyBlock();
            g.color = color;
            g.size = size;
            g.seed = Random.value * 10f;
            g.Set(0, 1);
            return g;
        }

        /// <summary>亮度 0..1 与大小倍率（1 = Attach 时的直径）</summary>
        public void Set(float alpha01, float scale)
        {
            alpha = Mathf.Clamp01(alpha01);
            spin = scale;
            if (mr) mr.enabled = alpha > 0.003f;
        }

        public void SetColor(Color c) => color = c;

        /// <summary>
        /// 一片四边形，UV 落在粒子图集的 IceStar 格（4 × 8 图集，第 0 行在贴图上半部分）；顶点色白、法线朝 −z（面向相机时正面朝相机）
        /// </summary>
        static Mesh Quad
        {
            get
            {
                if (quad) return quad;
                int cell = (int)FxTexture.IceStar;
                int cols = FxTextures.AtlasColumns, rows = FxTextures.AtlasRows;
                float u0 = (cell % cols) / (float)cols, u1 = u0 + 1f / cols;
                float v1 = 1f - (cell / cols) / (float)rows, v0 = v1 - 1f / rows;
                quad = new Mesh { name = "Frost Glint Quad" };
                quad.vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0) };
                quad.uv = new[] { new Vector2(u0, v0), new Vector2(u1, v0), new Vector2(u0, v1), new Vector2(u1, v1) };
                quad.colors32 = new[] { new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255) };
                quad.normals = new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back };
                quad.triangles = new[] { 0, 2, 1, 2, 3, 1 };
                quad.RecalculateBounds();
                return quad;
            }
        }

        void LateUpdate()
        {
            if (!mr || !mr.enabled) return;
            var cam = Camera.main;
            float t = Time.time;
            float twinkle = 0.85f + 0.15f * Mathf.Sin(t * 13f + seed) + 0.08f * Mathf.Sin(t * 31f + seed * 2f);
            if (cam) transform.rotation = cam.transform.rotation * Quaternion.Euler(0, 0, t * 25f + seed * 30f);
            // 世界尺寸：抵消父骨骼的缩放
            var ps = transform.parent ? transform.parent.lossyScale : Vector3.one;
            float k = size * spin * (0.9f + 0.1f * twinkle) / Mathf.Max(1e-4f, Mathf.Abs(ps.x));
            transform.localScale = Vector3.one * k;
            var c = color * (alpha * twinkle);
            c.a = Mathf.Clamp01(alpha);
            mr.GetPropertyBlock(block);
            block.SetColor(BaseColorId, new Color(c.r * 1.6f, c.g * 1.6f, c.b * 1.6f, c.a));
            mr.SetPropertyBlock(block);
        }
    }
}
