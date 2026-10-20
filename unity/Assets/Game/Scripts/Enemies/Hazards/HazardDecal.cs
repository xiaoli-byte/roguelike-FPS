using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 危险区的地面贴片（地火、法阵、毒区）：贴地的圆（外圈亮边 + 半透明填充），挂在危险物下面跟着它销毁，颜色 / 透明度每帧可改。
    /// 预警（<see cref="Telegraph"/>，F2 改贴花）管「招式还没落下」；这个管「已经生效、还在烧」的区域——要能提前熄灭（地火被祸斗吃掉），
    /// 所以不借用预警的对象池。材质与贴图全场共用一份，颜色走 MaterialPropertyBlock。
    /// </summary>
    public sealed class HazardDecal
    {
        static Material material;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        readonly Renderer renderer;
        readonly MaterialPropertyBlock block = new();
        Color color;

        public Transform Transform { get; }

        HazardDecal(Transform t, Renderer r, Color c)
        {
            Transform = t;
            renderer = r;
            color = c;
        }

        /// <summary>在 center 脚下的地面上铺一块半径 radius 的圆（parent 销毁时一起销毁）</summary>
        public static HazardDecal Create(Transform parent, Vector3 center, float radius, Color color)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            var col = q.GetComponent<Collider>();
            // 先停用：Destroy 要到帧末才生效，这一帧里的射线（地面检测、视线）不该打到贴片
            col.enabled = false;
            if (Application.isPlaying) Object.Destroy(col);
            else Object.DestroyImmediate(col);
            q.name = "Hazard Decal";
            q.transform.SetParent(parent, true);
            float y = GroundY(center) + 0.05f;
            q.transform.SetPositionAndRotation(new Vector3(center.x, y, center.z), Quaternion.Euler(90, 0, 0));
            q.transform.localScale = new Vector3(radius * 2, radius * 2, 1);
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = Material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            var d = new HazardDecal(q.transform, r, color);
            d.SetAlpha(0);
            return d;
        }

        /// <summary>透明度 0..1（乘颜色自带的 alpha）</summary>
        public void SetAlpha(float alpha)
        {
            if (!renderer) return;
            renderer.enabled = alpha > 0.001f;
            block.SetColor(BaseColorId, new Color(color.r, color.g, color.b, color.a * Mathf.Clamp01(alpha)));
            renderer.SetPropertyBlock(block);
        }

        public void SetColor(Color c) => color = c;

        static float GroundY(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var h, 10f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        static Material Material
        {
            get
            {
                if (material) return material;
                material = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = "Hazard Decal (runtime)" };
                material.SetTexture("_BaseMap", RingTexture());
                material.SetFloat("_Surface", 1);
                material.SetFloat("_Blend", 0);
                material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                material.SetFloat("_ZWrite", 0);
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                material.renderQueue = (int)RenderQueue.Transparent - 12;
                return material;
            }
        }

        /// <summary>外圈亮边（半径 0.86–1）+ 往中心淡下去的填充（边上 0.42 → 中心 0.18）</summary>
        static Texture2D RingTexture()
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = "Hazard Ring" };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                float rim = Mathf.Clamp01(1 - Mathf.Abs(d - 0.93f) / 0.07f);
                float fill = d < 0.93f ? Mathf.Lerp(0.18f, 0.42f, d * d) : 0;
                px[y * n + x] = new Color(1, 1, 1, Mathf.Max(rim, fill));
            }
            tex.SetPixels32(px);
            tex.Apply();
            return tex;
        }
    }
}
