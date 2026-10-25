using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 剑指的两根手指（WC7）。英雄的第一人称左手（SM_Arms_&lt;英雄&gt;L）是握护木姿势的一整块静态网格，没有手指骨骼，拳头张不开——
    /// 所以剑指用程序姿态模拟：在拳头前沿食指、中指的指根处补两根伸直并拢的手指（8 棱锥台 + 圆头），其余三指与拇指仍是美术拳头里扣着的样子。
    /// 手指直接用手臂自己的材质（同一张贴图、同一套风格化光照 / 毛发），UV 钉在贴图里手套与指尖皮肤的两块纯色区域上：指根一截是手套色、指尖一截是皮肤色。
    /// 指根位置、手指方向、两处 UV 按英雄登记（<see cref="For"/>，数据来自对三只手臂网格的测量：拳头前沿的指节一排、贴图里颜色最匀的一块），
    /// 没登记的手臂退回赤熊猫（燎）的数值。坐标都是手臂局部空间（Unity 导入后的，单位米）。
    /// </summary>
    public static class BladeSwordSign
    {
        /// <summary>一只左手的剑指数据：食指 / 中指指根、手指方向、手套 / 皮肤 UV</summary>
        public sealed class Fit
        {
            public Vector3 index, middle, dir;
            public Vector2 gloveUv, skinUv;
        }

        /// <summary>食指 / 中指长度与半径（米，手臂局部）</summary>
        public const float IndexLength = 0.068f, MiddleLength = 0.075f, IndexRadius = 0.0105f, MiddleRadius = 0.011f;
        /// <summary>指根这一截是手套（占指长的比例）</summary>
        public const float GloveFrac = 0.42f;
        const int Sides = 8;

        static readonly Vector3 Dir = new Vector3(0.02f, 0.18f, -1f).normalized;

        static readonly Fit RedPanda = new()
        {
            index = new Vector3(0.006f, -0.04f, -0.05f), middle = new Vector3(-0.019f, -0.042f, -0.052f), dir = Dir,
            gloveUv = new Vector2(0.3894f, 0.4328f), skinUv = new Vector2(0.0222f, 0.8736f),
        };

        static readonly Fit Pangolin = new()
        {
            index = new Vector3(0f, -0.045f, -0.045f), middle = new Vector3(-0.024f, -0.047f, -0.05f), dir = Dir,
            gloveUv = new Vector2(0.7381f, 0.3609f), skinUv = new Vector2(0.2696f, 0.2311f),
        };

        static readonly Fit FlyingSquirrel = new()
        {
            index = new Vector3(-0.026f, -0.04f, -0.024f), middle = new Vector3(-0.047f, -0.042f, -0.026f), dir = Dir,
            gloveUv = new Vector2(0.6809f, 0.4018f), skinUv = new Vector2(0.5218f, 0.5782f),
        };

        /// <summary>按左手臂 Prefab id 取剑指数据（没登记的用燎的）</summary>
        public static Fit For(string armId) => armId switch
        {
            "SM_Arms_PangolinL" => Pangolin,
            "SM_Arms_FlyingSquirrelL" => FlyingSquirrel,
            _ => RedPanda,
        };

        /// <summary>食指指尖（手臂局部）</summary>
        public static Vector3 IndexTip(Fit f) => f.index + f.dir * IndexLength;

        /// <summary>
        /// 在左手臂下建「Sword Sign」（默认不显示，剑指时由视图打开）：两根手指的网格 + 手臂自己的材质。arm = 手臂 Prefab 实例的根
        /// </summary>
        public static MeshRenderer Attach(Transform arm, string armId, out Mesh mesh)
        {
            mesh = null;
            if (!arm) return null;
            var src = arm.GetComponentInChildren<MeshRenderer>(true);
            var mat = src ? src.sharedMaterial : null;
            if (!mat) return null;
            var f = For(armId);
            mesh = Build(f);
            var go = new GameObject("Sword Sign");
            go.layer = arm.gameObject.layer;
            go.transform.SetParent(arm, false);
            // 手指网格就在手臂根（Prefab 根）的局部空间里：测量数据也是按 Prefab 根取的
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = src.lightProbeUsage;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return r;
        }

        /// <summary>两根手指的网格（手臂局部坐标）；指根一截 UV 钉在手套色、指尖一截钉在皮肤色（交界处两圈重合的顶点各用一种 UV）</summary>
        public static Mesh Build(Fit f)
        {
            var verts = new System.Collections.Generic.List<Vector3>();
            var uvs = new System.Collections.Generic.List<Vector2>();
            var tris = new System.Collections.Generic.List<int>();
            Finger(f.index, f.dir, IndexLength, IndexRadius, f, verts, uvs, tris);
            Finger(f.middle, f.dir, MiddleLength, MiddleRadius, f, verts, uvs, tris);
            var m = new Mesh { name = "Sword Sign Fingers", hideFlags = HideFlags.DontSave };
            m.SetVertices(verts);
            m.SetUVs(0, uvs);
            m.SetTriangles(tris, 0);
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>一根手指：指根略粗的 8 棱台 → 手套 / 皮肤交界（两圈）→ 指尖前一圈 → 半球形圆头</summary>
        static void Finger(Vector3 b, Vector3 dir, float len, float r, Fit f, System.Collections.Generic.List<Vector3> V,
            System.Collections.Generic.List<Vector2> U, System.Collections.Generic.List<int> T)
        {
            dir = dir.normalized;
            var a = Vector3.Cross(dir, Vector3.up);
            if (a.sqrMagnitude < 1e-6f) a = Vector3.Cross(dir, Vector3.right);
            a.Normalize();
            var c = Vector3.Cross(dir, a);
            // (沿指长比例, 半径倍率, 皮肤?)
            var rings = new (float t, float k, bool skin)[]
            {
                (0f, 1.08f, false), (GloveFrac, 1f, false), (GloveFrac, 1f, true), (1 - r * 0.9f / len, 0.92f, true), (1 - r * 0.35f / len, 0.6f, true),
            };
            int start = V.Count;
            foreach (var ring in rings)
            {
                for (int s = 0; s < Sides; s++)
                {
                    float ang = s * Mathf.PI * 2 / Sides;
                    V.Add(b + dir * (ring.t * len) + (a * Mathf.Cos(ang) + c * Mathf.Sin(ang)) * (r * ring.k));
                    U.Add(ring.skin ? f.skinUv : f.gloveUv);
                }
            }
            for (int k = 0; k < rings.Length - 1; k++)
            {
                if (k == 1) continue; // 交界两圈重合：不连面
                for (int s = 0; s < Sides; s++)
                {
                    int i0 = start + k * Sides + s, i1 = start + k * Sides + (s + 1) % Sides;
                    int j0 = i0 + Sides, j1 = i1 + Sides;
                    T.Add(i0); T.Add(i1); T.Add(j0);
                    T.Add(i1); T.Add(j1); T.Add(j0);
                }
            }
            // 圆头：最后一圈收到指尖一点
            int tip = V.Count;
            V.Add(b + dir * len);
            U.Add(f.skinUv);
            int last = start + (rings.Length - 1) * Sides;
            for (int s = 0; s < Sides; s++)
            {
                T.Add(last + s);
                T.Add(last + (s + 1) % Sides);
                T.Add(tip);
            }
        }
    }
}
