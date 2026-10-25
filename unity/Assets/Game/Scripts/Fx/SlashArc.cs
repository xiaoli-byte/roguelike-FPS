using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刀光弧（Three.js 版 src/enemies/fx/SlashArc.ts）：沿弧线扫过的月牙形刀光，加色、白热刃口 → 彩色拖尾。
    /// 纯视觉，不做伤害判定。弧在「刀光平面」里展开：默认水平（绕世界 Y 扫），tilt 绕前方轴倾斜（斜劈 / X 字斩）。
    /// 前 55% 刀头从起点扫到终点（缓出），之后整体淡出并略向外扩。网格是 40 段 × 4 圈（内 → 刃口 → 外缘），颜色写顶点色。
    /// 池化（上限 24 道）：网格顶点数固定，复用时只重写顶点位置 / 颜色，不再每刀 new 一个 GameObject + Mesh。
    /// 敌方刀光（hostile）：刀带加宽 1.5 倍、刃口略提亮（仍是暖色，不冲成白）、多留 25% 时长，并在下面垫一道普通混合的暗月牙
    /// （自己的一份顶点色：整条刀带都压暗，放大 12%）——纯加法的刀光在亮沙 / 雪地上几乎加不出亮度，暗月牙把亮刃托出来（审阅图集问题清单：交叉斩刀光太淡）。
    /// </summary>
    public sealed class SlashArc : MonoBehaviour, IFxSlot
    {
        const int Segments = 40, MaxArcs = 24;
        static readonly float[] Rows = { 0f, 0.6f, 0.9f, 1f };
        /// <summary>每一圈的亮度（内圈透明 → 刃口最亮 → 外缘收掉）与白热程度</summary>
        static readonly float[] RowEdge = { 0f, 0.75f, 1f, 0f };
        static readonly float[] RowHot = { 0f, 0.1f, 1f, 0.6f };

        static readonly List<SlashArc> pool = new();

        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        /// <summary>敌方刀光的刃口亮度倍率、暗边颜色（乘顶点色；alpha = 暗边浓度）</summary>
        static readonly Color HostileBoost = new(1.3f, 1.3f, 1.3f, 1f), UnderColor = new(0.11f, 0.035f, 0.015f);
        /// <summary>暗月牙每一圈的浓度（内圈也压一点，外缘留一道暗边）</summary>
        static readonly float[] UnderRow = { 0.35f, 0.85f, 1f, 0.7f };

        Mesh mesh, underMesh;
        MeshRenderer main, under;
        Color[] underColors;
        bool hostile;
        static MaterialPropertyBlock block;
        Vector3[] positions;
        Color[] colors;
        Color tint;
        float age, duration;
        int gen;
        bool active;

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;
        void IFxSlot.CancelFx() => duration = Mathf.Min(duration, age + 0.06f);
        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) { }
        void IFxSlot.MoveFx(Vector3 position) => transform.position = position;

        /// <param name="yawDeg">刀光中线朝向（世界 yaw）</param>
        /// <param name="arc">弧长（弧度）</param>
        /// <param name="dir">1 = 从右往左扫（俯视逆时针），-1 = 从左往右</param>
        /// <param name="tilt">绕前方轴的倾斜（弧度）</param>
        /// <param name="hostile">敌方刀光：刃口提亮、垫暗边、多留 25%</param>
        public static FxHandle Spawn(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float duration, Color color,
            bool hostile = false)
        {
            if (!Fx.Finite(center)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            var s = Take(rt.transform);
            s.gen++;
            s.active = true;
            s.age = 0;
            s.duration = Mathf.Max(0.05f, duration) * (hostile ? 1.25f : 1f);
            s.tint = color;
            s.SetHostile(hostile);
            s.transform.SetPositionAndRotation(center, Quaternion.Euler(0, yawDeg, 0) * Quaternion.AngleAxis(-tilt * Mathf.Rad2Deg, Vector3.forward));
            s.transform.localScale = Vector3.one;
            s.Build(radius, arc, Mathf.Max(0.02f, width) * (hostile ? 1.5f : 1f), dir);
            s.Paint(0, 1);
            s.gameObject.SetActive(true);
            return new FxHandle(s);
        }

        static SlashArc Take(Transform parent)
        {
            SlashArc oldest = null;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.active) return x;
                if (!oldest || x.age / x.duration > oldest.age / oldest.duration) oldest = x;
            }
            if (pool.Count >= MaxArcs && oldest) return oldest;
            var go = new GameObject("Slash Arc");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var s = go.AddComponent<SlashArc>();
            s.Init();
            s.main = AddRenderer(go, s.mesh, FxMaterials.Additive, 0);
            // 暗边：同一网格放大 10%，普通混合，排在刀光前面画
            var u = new GameObject("Slash Underlay");
            u.transform.SetParent(go.transform, false);
            u.transform.localScale = new Vector3(1.12f, 1f, 1.12f);
            s.under = AddRenderer(u, s.underMesh, FxMaterials.AlphaBlend, -1);
            pool.Add(s);
            return s;
        }

        static MeshRenderer AddRenderer(GameObject go, Mesh mesh, Material mat, int order)
        {
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            return r;
        }

        void SetHostile(bool on)
        {
            hostile = on;
            block ??= new MaterialPropertyBlock();
            block.Clear();
            block.SetColor(BaseColor, on ? HostileBoost : Color.white);
            main.SetPropertyBlock(block);
            under.enabled = on;
        }

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            foreach (var s in pool)
                if (s) s.Hide();
        }

        void Init()
        {
            int rows = Rows.Length, n = (Segments + 1) * rows;
            positions = new Vector3[n];
            colors = new Color[n];
            var uv = new Vector2[n];
            for (int i = 0; i <= Segments; i++)
            for (int k = 0; k < rows; k++)
                uv[i * rows + k] = new Vector2(i / (float)Segments, Rows[k]);
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
            mesh.MarkDynamic();
            mesh.vertices = positions;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = idx;
            underColors = new Color[n];
            underMesh = new Mesh { name = "Slash Arc Underlay" };
            underMesh.MarkDynamic();
            underMesh.vertices = positions;
            underMesh.uv = uv;
            underMesh.colors = underColors;
            underMesh.triangles = idx;
        }

        void Build(float radius, float arc, float width, int dir)
        {
            int rows = Rows.Length;
            float inner = Mathf.Max(0.05f, radius - width);
            for (int i = 0; i <= Segments; i++)
            {
                float t = i / (float)Segments;
                float a = (t - 0.5f) * arc * -dir;
                float s = Mathf.Sin(a), c = Mathf.Cos(a);
                for (int k = 0; k < rows; k++)
                {
                    float r = Mathf.Lerp(inner, radius, Rows[k]);
                    positions[i * rows + k] = new Vector3(s * r, 0, c * r);
                }
            }
            mesh.vertices = positions;
            mesh.RecalculateBounds();
            underMesh.vertices = positions;
            underMesh.RecalculateBounds();
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
                    if (hostile)
                    {
                        var u = UnderColor;
                        u.a = Mathf.Clamp01(tail * fade * UnderRow[k] * 0.8f);
                        underColors[i * rows + k] = u;
                    }
                }
            }
            mesh.colors = colors;
            if (hostile) underMesh.colors = underColors;
        }

        void Hide()
        {
            active = false;
            gameObject.SetActive(false);
        }

        void Update()
        {
            if (!active) return;
            age += Time.deltaTime;
            float t = age / duration;
            float head = 1.25f * (1 - Mathf.Pow(1 - Mathf.Min(1, t / 0.55f), 2.2f));
            float fade = t < 0.55f ? 1 : Mathf.Max(0, 1 - (t - 0.55f) / 0.45f);
            transform.localScale = Vector3.one * (1 + 0.12f * t);
            Paint(head, fade);
            if (t >= 1) Hide();
        }

        void OnDestroy()
        {
            pool.Remove(this);
            if (mesh) Destroy(mesh);
            if (underMesh) Destroy(underMesh);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => pool.Clear();
    }
}
