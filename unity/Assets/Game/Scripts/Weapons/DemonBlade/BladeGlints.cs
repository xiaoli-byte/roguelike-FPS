using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称视图里的小光点（WC7）：刚归位的碎片闪一下（归位闪）、剑指指尖的灵光、判定帧刃口的白热一闪。
    /// 每帧 <see cref="Begin"/> → 若干 <see cref="Add"/>（父物体局部坐标，近似相机空间）→ <see cref="End"/>：拼成一块面向镜头的方片网格，
    /// 柔光贴图（M_Fx_Glow，加色、没有贴脸淡出），顶点色带每颗的亮度；FirstPerson 层，跟刀模同一台枪模相机画。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BladeGlints : MonoBehaviour
    {
        public const int Max = 160;

        Mesh mesh;
        MeshRenderer meshRenderer;
        readonly Vector3[] verts = new Vector3[Max * 4];
        readonly Color[] colors = new Color[Max * 4];
        int count;

        /// <summary>上一帧画了几颗（测试 / 套件读）</summary>
        public int LastCount { get; private set; }

        public static BladeGlints Create(Transform parent)
        {
            var go = new GameObject("Blade Glints");
            go.transform.SetParent(parent, false);
            var g = go.AddComponent<BladeGlints>();
            g.Init();
            return g;
        }

        void Init()
        {
            var uv = new Vector2[Max * 4];
            var idx = new int[Max * 6];
            for (int i = 0; i < Max; i++)
            {
                int v = i * 4;
                uv[v] = new Vector2(0, 0);
                uv[v + 1] = new Vector2(1, 0);
                uv[v + 2] = new Vector2(1, 1);
                uv[v + 3] = new Vector2(0, 1);
                int o = i * 6;
                idx[o] = v;
                idx[o + 1] = v + 2;
                idx[o + 2] = v + 1;
                idx[o + 3] = v;
                idx[o + 4] = v + 3;
                idx[o + 5] = v + 2;
            }
            mesh = new Mesh { name = "Blade Glints", hideFlags = HideFlags.DontSave };
            mesh.MarkDynamic();
            mesh.vertices = verts;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.SetIndices(idx, MeshTopology.Triangles, 0, false);
            gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
            meshRenderer = gameObject.AddComponent<MeshRenderer>();
            meshRenderer.sharedMaterial = FxMaterials.Glow;
            meshRenderer.shadowCastingMode = ShadowCastingMode.Off;
            meshRenderer.receiveShadows = false;
            meshRenderer.lightProbeUsage = LightProbeUsage.Off;
            meshRenderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            meshRenderer.enabled = false;
        }

        void OnDestroy()
        {
            if (mesh) Destroy(mesh);
        }

        public void Begin() => count = 0;

        /// <summary>一颗光点：中心（父物体局部坐标）、直径（米）、颜色（HDR，alpha = 强度）</summary>
        public void Add(Vector3 center, float size, Color color)
        {
            if (count >= Max || !(size > 1e-4f) || !(color.a > 0.004f)) return;
            float h = size * 0.5f;
            // 父物体是相机空间（只带一点晃动）：方片直接立在局部 XY 平面里，正对镜头
            int v = count * 4;
            verts[v] = center + new Vector3(-h, -h, 0);
            verts[v + 1] = center + new Vector3(h, -h, 0);
            verts[v + 2] = center + new Vector3(h, h, 0);
            verts[v + 3] = center + new Vector3(-h, h, 0);
            colors[v] = colors[v + 1] = colors[v + 2] = colors[v + 3] = color;
            count++;
        }

        public void End()
        {
            LastCount = count;
            if (count == 0)
            {
                if (meshRenderer.enabled) meshRenderer.enabled = false;
                return;
            }
            // 用不到的方片缩成一点（不画）
            for (int v = count * 4; v < verts.Length; v++)
            {
                verts[v] = verts[0];
                colors[v] = Color.clear;
            }
            mesh.vertices = verts;
            mesh.colors = colors;
            mesh.RecalculateBounds();
            if (!meshRenderer.enabled) meshRenderer.enabled = true;
        }

        public void Clear()
        {
            count = 0;
            LastCount = 0;
            if (meshRenderer) meshRenderer.enabled = false;
        }
    }
}
