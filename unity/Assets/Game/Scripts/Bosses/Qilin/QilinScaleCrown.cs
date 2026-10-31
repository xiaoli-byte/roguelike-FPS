using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 张鳞的「鳞冠」（Q 路，2026-10-31；设计单 docs/art/vfx/qilin.md「张鳞」）：前摇里，一圈玄铁鳞片从麒麟身上竖起、张开，正好立在每一片鳞刃要射出的位置上
    /// （同样的片数、同样的方位、离地 1.2 m、半径 2.2 m）——玩家在前摇里就看得见「鳞刃从哪来、往哪飞、什么时候飞」：
    ///   起（0–25%）：鳞片贴着身体冒出来，暗赭；张（25–85%）：往外推到出手半径、向外翻开 40°，暗金越来越亮；
    ///   顶点（最后 15%）：暖白金、微微一颤；出手那一帧 <see cref="Release"/> 收掉，鳞刃弹丸在同一位置接上。
    /// 一张程序网格（每片一个竖直的鳞形四边形，朝外）+ 一份透明材质（墨边 + 两阶暗金 + 亮脊的鳞形贴图，HDR 着色），不发粒子；
    /// 低画质（粒子密度 &lt; 0.6）只画一半片数。每个首领一个，跟着首领销毁。
    /// </summary>
    public sealed class QilinScaleCrown : MonoBehaviour
    {
        public static readonly Color Ochre = Hex.Rgb(0x8a5a1c), Gold = Hex.Rgb(0xd9a441), GoldHot = Hex.Rgb(0xffe6a8);
        /// <summary>每片鳞的宽 / 高（米）</summary>
        public const float ScaleW = 0.5f, ScaleH = 0.85f;

        static Material material;
        static Texture2D texture;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        Transform follow;
        Mesh mesh;
        MeshRenderer mr;
        MaterialPropertyBlock block;
        Vector3[] verts;
        int count;
        float t, seconds, radius, height, yawOffset;
        bool live;

        /// <summary>正在张（测试 / 图集用）</summary>
        public bool Live => live;

        /// <summary>建一个鳞冠（parent = 首领的父节点，随关卡卸载）</summary>
        public static QilinScaleCrown Create(Transform parent)
        {
            var go = new GameObject("Qilin Scale Crown");
            go.transform.SetParent(parent, false);
            var c = go.AddComponent<QilinScaleCrown>();
            c.mesh = new Mesh { name = "Qilin Scale Crown" };
            c.mesh.MarkDynamic();
            go.AddComponent<MeshFilter>().sharedMesh = c.mesh;
            c.mr = go.AddComponent<MeshRenderer>();
            c.mr.sharedMaterial = Material;
            c.mr.shadowCastingMode = ShadowCastingMode.Off;
            c.mr.receiveShadows = false;
            c.mr.lightProbeUsage = LightProbeUsage.Off;
            c.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            c.block = new MaterialPropertyBlock();
            c.mr.enabled = false;
            return c;
        }

        /// <summary>
        /// 开始张鳞：follow = 首领（取它的位置和朝向；鳞刃按出手时的朝向排），n 片、出手半径 r、离地 h，seconds 秒后出手；offsetFrac = 起始角偏移（格，第二圈错开半格）
        /// </summary>
        public void Begin(Transform followT, int n, float r, float h, float secondsToRelease, float offsetFrac = 0f)
        {
            follow = followT;
            count = Fx.Density < 0.6f ? Mathf.Max(6, n / 2) : Mathf.Max(6, n);
            radius = r;
            height = h;
            seconds = Mathf.Max(0.05f, secondsToRelease);
            yawOffset = offsetFrac * 360f / Mathf.Max(1, n);
            t = 0;
            live = true;
            if (verts == null || verts.Length != count * 4) BuildMesh();
            mr.enabled = true;
            Step(0);
        }

        /// <summary>出手：鳞冠收掉（鳞刃弹丸在同一位置接上）</summary>
        public void Release()
        {
            live = false;
            if (mr) mr.enabled = false;
        }

        void BuildMesh()
        {
            verts = new Vector3[count * 4];
            var uv = new Vector2[count * 4];
            var tris = new int[count * 6];
            for (int i = 0; i < count; i++)
            {
                int v = i * 4;
                uv[v] = new Vector2(0, 0);
                uv[v + 1] = new Vector2(1, 0);
                uv[v + 2] = new Vector2(1, 1);
                uv[v + 3] = new Vector2(0, 1);
                int k = i * 6;
                tris[k] = v;
                tris[k + 1] = v + 2;
                tris[k + 2] = v + 1;
                tris[k + 3] = v;
                tris[k + 4] = v + 3;
                tris[k + 5] = v + 2;
            }
            mesh.Clear();
            mesh.vertices = verts;
            mesh.uv = uv;
            mesh.triangles = tris;
            mesh.bounds = new Bounds(Vector3.up * 2f, Vector3.one * 12f);
        }

        void LateUpdate()
        {
            if (!live) return;
            if (!follow)
            {
                Release();
                return;
            }
            t += Time.deltaTime;
            Step(t);
        }

        void Step(float time)
        {
            float k = Mathf.Clamp01(time / seconds);
            // 起 → 张 → 顶点
            float emerge = Mathf.SmoothStep(0, 1, Mathf.Clamp01(k / 0.25f));
            float open = Mathf.SmoothStep(0, 1, Mathf.Clamp01((k - 0.15f) / 0.7f));
            float hold = Mathf.Clamp01((k - 0.85f) / 0.15f);
            float r = Mathf.Lerp(0.9f, radius, open);
            float tilt = Mathf.Lerp(-8f, 40f, open) * Mathf.Deg2Rad;
            float size = Mathf.Lerp(0.35f, 1f, emerge) * (1f + 0.06f * hold * Mathf.Sin(time * 70f));
            float y = Mathf.Lerp(height + 1.1f, height, open);
            var pos = follow.position;
            transform.position = pos;
            transform.rotation = Quaternion.identity;
            float baseYaw = follow.eulerAngles.y + yawOffset;
            float w = ScaleW * size * 0.5f, h = ScaleH * size;
            for (int i = 0; i < count; i++)
            {
                float a = (baseYaw + i * 360f / count) * Mathf.Deg2Rad;
                var outDir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                var side = new Vector3(outDir.z, 0, -outDir.x);
                // 鳞片底边在出手点下方一点，往外翻 tilt（顶端朝外上）
                var up = Vector3.up * Mathf.Cos(tilt) + outDir * Mathf.Sin(tilt);
                var b = outDir * r + Vector3.up * (y - h * 0.45f);
                int v = i * 4;
                verts[v] = b - side * w;
                verts[v + 1] = b + side * w;
                verts[v + 2] = b + side * w + up * h;
                verts[v + 3] = b - side * w + up * h;
            }
            mesh.vertices = verts;
            // 两阶色：暗赭 → 暗金 → 顶点暖白金（HDR，微泛光；不刷白）
            Color c = k < 0.85f ? Color.Lerp(Ochre * 0.9f, Gold * 1.5f, open) : Color.Lerp(Gold * 1.5f, GoldHot * 2.4f, hold);
            c.a = Mathf.Lerp(0.2f, 1f, emerge);
            block.Clear();
            block.SetColor(BaseColorId, c);
            mr.SetPropertyBlock(block);
        }

        // ───────────── 鳞形贴图 / 材质 ─────────────

        static Material Material
        {
            get
            {
                if (material) return material;
                material = FxMaterials.MakeAlpha(Texture);
                material.name = "Qilin Scale Crown (runtime)";
                material.renderQueue = (int)RenderQueue.Transparent;
                if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
                return material;
            }
        }

        /// <summary>
        /// 一片鳞（64 × 96）：圆底尖顶的鱼鳞形，墨色勾边；鳞面两阶（下半暗金、上半亮金）+ 中线一道亮脊，尖上最亮。RGB = 明度（着色走 _BaseColor），A = 覆盖
        /// </summary>
        static Texture2D Texture
        {
            get
            {
                if (texture) return texture;
                const int W = 64, H = 96;
                texture = new Texture2D(W, H, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = "Qilin Scale", hideFlags = HideFlags.DontSave };
                var px = new Color32[W * H];
                for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    float u = (x + 0.5f) / W * 2f - 1f, v = (y + 0.5f) / H;
                    // 鳞形：宽度随高度——底部是半圆（v 0–0.35），往上收成尖（v 1）
                    float half = v < 0.35f ? Mathf.Sqrt(Mathf.Max(0, 1f - Mathf.Pow((0.35f - v) / 0.35f, 2f))) * 0.92f : 0.92f * Mathf.Pow(1f - (v - 0.35f) / 0.65f, 0.8f);
                    float sd = Mathf.Abs(u) - half;
                    float aa = 2.5f / W;
                    float cover = Mathf.Clamp01(0.5f - (sd - 0.1f) / aa);
                    float fill = Mathf.Clamp01(0.5f - sd / aa);
                    float lum = v > 0.5f ? 1f : 0.72f;
                    lum += Mathf.Clamp01(1f - Mathf.Abs(u) / 0.12f) * 0.25f * (v > 0.15f ? 1f : 0f);
                    lum = Mathf.Min(1f, lum) * fill;
                    px[y * W + x] = new Color(lum, lum, lum, Mathf.Max(cover * 0.95f, fill));
                }
                texture.SetPixels32(px);
                texture.Apply(true, true);
                return texture;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            material = null;
            texture = null;
        }
    }
}
