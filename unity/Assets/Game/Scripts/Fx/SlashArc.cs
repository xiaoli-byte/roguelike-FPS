using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刀光弧（Three.js 版 src/enemies/fx/SlashArc.ts）：沿弧线扫过的月牙形刀光，加色、白热刃口 → 彩色拖尾。
    /// 纯视觉，不做伤害判定。弧在「刀光平面」里展开：默认水平（绕世界 Y 扫），tilt 绕前方轴倾斜（斜劈 / X 字斩）。
    /// 前 55% 刀头从起点扫到终点（缓出），之后整体淡出并略向外扩。网格是 40 段 × 4 圈（内 → 刃口 → 外缘），颜色写顶点色。
    /// </summary>
    public sealed class SlashArc : MonoBehaviour
    {
        const int Segments = 40;
        static readonly float[] Rows = { 0f, 0.6f, 0.9f, 1f };
        /// <summary>每一圈的亮度（内圈透明 → 刃口最亮 → 外缘收掉）与白热程度</summary>
        static readonly float[] RowEdge = { 0f, 0.75f, 1f, 0f };
        static readonly float[] RowHot = { 0f, 0.1f, 1f, 0.6f };

        Mesh mesh;
        Color[] colors;
        Color tint;
        float age, duration;

        /// <param name="yawDeg">刀光中线朝向（世界 yaw）</param>
        /// <param name="arc">弧长（弧度）</param>
        /// <param name="dir">1 = 从右往左扫（俯视逆时针），-1 = 从左往右</param>
        /// <param name="tilt">绕前方轴的倾斜（弧度）</param>
        public static void Spawn(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float duration, Color color)
        {
            var go = new GameObject("Slash Arc");
            go.transform.SetPositionAndRotation(center, Quaternion.Euler(0, yawDeg, 0) * Quaternion.AngleAxis(-tilt * Mathf.Rad2Deg, Vector3.forward));
            var s = go.AddComponent<SlashArc>();
            s.duration = Mathf.Max(0.05f, duration);
            s.tint = color;
            s.Build(radius, arc, Mathf.Max(0.02f, width), dir);
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = FxMaterials.Additive;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            go.AddComponent<MeshFilter>().sharedMesh = s.mesh;
            s.Paint(0, 1);
        }

        void Build(float radius, float arc, float width, int dir)
        {
            int rows = Rows.Length, n = (Segments + 1) * rows;
            var pos = new Vector3[n];
            var uv = new Vector2[n];
            colors = new Color[n];
            float inner = Mathf.Max(0.05f, radius - width);
            for (int i = 0; i <= Segments; i++)
            {
                float t = i / (float)Segments;
                float a = (t - 0.5f) * arc * -dir;
                float s = Mathf.Sin(a), c = Mathf.Cos(a);
                for (int k = 0; k < rows; k++)
                {
                    float r = Mathf.Lerp(inner, radius, Rows[k]);
                    pos[i * rows + k] = new Vector3(s * r, 0, c * r);
                    uv[i * rows + k] = new Vector2(t, Rows[k]);
                }
            }
            var idx = new int[Segments * (rows - 1) * 6];
            int w = 0;
            for (int i = 0; i < Segments; i++)
            for (int k = 0; k < rows - 1; k++)
            {
                int a = i * rows + k, b = a + rows;
                idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
            }
            mesh = new Mesh { name = "Slash Arc" };
            mesh.vertices = pos;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = idx;
            mesh.RecalculateBounds();
        }

        void Paint(float head, float fade)
        {
            int rows = Rows.Length;
            var hot = new Color(1f, 0.97f, 0.88f);
            for (int i = 0; i <= Segments; i++)
            {
                float behind = head - i / (float)Segments;
                float tail = behind < 0 ? 0 : Mathf.Exp(-behind * 3.2f);
                float heat = behind < 0 ? 0 : Mathf.Exp(-behind * 7f);
                for (int k = 0; k < rows; k++)
                {
                    float a = tail * RowEdge[k] * fade;
                    var c = Color.Lerp(tint, hot, RowHot[k] * heat);
                    c.a = Mathf.Clamp01(a * 1.3f);
                    colors[i * rows + k] = c;
                }
            }
            mesh.colors = colors;
        }

        void Update()
        {
            age += Time.deltaTime;
            float t = age / duration;
            float head = 1.25f * (1 - Mathf.Pow(1 - Mathf.Min(1, t / 0.55f), 2.2f));
            float fade = t < 0.55f ? 1 : Mathf.Max(0, 1 - (t - 0.55f) / 0.45f);
            transform.localScale = Vector3.one * (1 + 0.12f * t);
            Paint(head, fade);
            if (t >= 1) Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (mesh) Destroy(mesh);
        }
    }
}
