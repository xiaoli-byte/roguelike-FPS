using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 峡谷（M21 2-1 冰瀑栈道新增，其他峡谷 / 阶地图也能用）：矩形台面 + 陡坎（台面外按固定坡率陡落，取各台面的最大值）、
    // 一刀切到底的直坡道（坡道里挖填都做，切进上一级台面的陡坎）、显式的桥面 / 栈道面碰撞盒、只要外观的摆件去碰撞、按碰撞体探方向。
    // Landform.TerracedValley 是沿谷轴等宽的阶地（画廊样例）；这里的台面位置、宽度逐块写死，好让桥头、栈道、站位按它排。
    public static partial class LevelKit
    {
        /// <summary>一级台面：世界 XZ 的轴对齐矩形，顶面世界 y = height；矩形外按坡率陡落，落到下一级为止就是两级之间的陡坎</summary>
        public readonly struct Shelf
        {
            public readonly string name;
            public readonly Vector2 min, max;
            public readonly float height;

            public Shelf(string name, Vector2 min, Vector2 max, float height)
            {
                this.name = name;
                this.min = min;
                this.max = max;
                this.height = height;
            }

            /// <summary>离矩形边的有符号距离（界内为正，米）</summary>
            public float Inside(Vector2 p) => -BoxSdf(p, min, max);
        }

        /// <summary>
        /// 一级台面在 p 处的高度贡献：界内 = 顶面，界外每米落 slope 米（slope 3.5 ≈ 74°，10 m 的坎水平 2.9 m）。
        /// 各台面取最大值就是「台面 + 陡坎」：高台的陡坎一直落到旁边低台的顶面。wobble = 边线往外推的米数（噪声摆动，正 = 台面变大）
        /// </summary>
        public static float ShelfHeight(Vector2 p, in Shelf s, float slope, float wobble = 0) =>
            s.height - slope * Mathf.Max(0, -(s.Inside(p) + wobble));

        /// <summary>
        /// 一刀切到底的直坡道（挖填都做）：坡道芯里地面 = 两端高度的线性插值（坡度处处一样，验收的坡度路径就是它），
        /// 两侧 edge 米内渐变回原地面——切进陡坎时两侧是陡壁，架在低处时两侧是陡的填方。
        /// 和 <see cref="Landform.Ramp"/> 不同：那个只填不挖，斜着穿过陡坎时会被坎顶「压住」，坡度就不对了。返回新高度，mask = 坡道遮罩（分层用）
        /// </summary>
        public static float CutRamp(Vector2 p, float h, Vector2 foot, float footY, Vector2 top, float topY, float width, float edge, out float mask)
        {
            var (t, m) = Landform.Ramp(p, foot, top, width, edge);
            mask = m;
            if (m <= 0) return h;
            return Mathf.Lerp(h, Mathf.Lerp(footY, topY, t), m);
        }

        /// <summary>直坡道中线的坡度（度）</summary>
        public static float RampGrade(Vector2 foot, float footY, Vector2 top, float topY) =>
            Mathf.Atan2(Mathf.Abs(topY - footY), Mathf.Max(0.01f, Vector2.Distance(foot, top))) * Mathf.Rad2Deg;

        // ───────────── 桥面 / 栈道面 ─────────────

        /// <summary>
        /// 显式的走行面碰撞（桥面、栈道面）：一个没有渲染器的盒子，顶面正好过 a → b 这条中线（世界坐标），宽 width、厚 thick；
        /// footExtend = 在 a 端再往前延伸的米数（顺坡往下埋进地面，接缝不露台阶），b 端不延伸（坡顶和台面齐平，不冒出一道坎）。
        /// 外观件（模型 / 占位）一律去掉碰撞，走起来只认这个盒子——网格碰撞的凹凸不进导航网格，模型换了也不改手感。
        /// </summary>
        public static GameObject Deck(string name, Transform parent, Vector3 a, Vector3 b, float width, float thick, float footExtend = 0)
        {
            var d = b - a;
            float len = d.magnitude;
            var fwd = len > 1e-4f ? d / len : Vector3.forward;
            var rot = Quaternion.LookRotation(fwd, Vector3.up);
            var up = rot * Vector3.up;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation((a + b) * 0.5f - fwd * (footExtend * 0.5f) - up * (thick * 0.5f), rot);
            var box = go.AddComponent<BoxCollider>();
            box.size = new Vector3(width, thick, len + footExtend);
            go.isStatic = true;
            return go;
        }

        /// <summary>水平桥面：x0 → x1（世界 X）、中心 z、顶面 top，宽 width（沿 Z）、厚 thick</summary>
        public static GameObject DeckX(string name, Transform parent, float x0, float x1, float z, float top, float width, float thick) =>
            Deck(name, parent, new Vector3(x0, top, z), new Vector3(x1, top, z), width, thick);

        // ───────────── 外观件 ─────────────

        /// <summary>
        /// 只要外观：Prefab 实例先解包（预制体实例上不能删组件），再删掉全部碰撞体（占位白盒同样删），并标成非导航。
        /// 栈道直段、桥的冰体这类「走行面另有显式碰撞」的件用它。
        /// </summary>
        public static void VisualOnly(GameObject go)
        {
            if (!go) return;
            if (PrefabUtility.IsPartOfPrefabInstance(go))
                PrefabUtility.UnpackPrefabInstance(PrefabUtility.GetOutermostPrefabInstanceRoot(go), PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            foreach (var c in go.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
        }

        /// <summary>
        /// 用实例自己的碰撞体探高度：从局部点 local（未缩放的模型坐标）上方 / 下方竖直打一条射线，只认这个实例的碰撞体。
        /// fromBelow = 从下往上打（量底面）。打不到返回 NaN。用来判断不对称件的朝向（冰桥厚的一头、栈道有栏杆的一侧、断口那头）。
        /// </summary>
        public static float ProbeY(GameObject go, Vector3 local, bool fromBelow = false, float reach = 60f)
        {
            if (!go) return float.NaN;
            Physics.SyncTransforms();
            var p = go.transform.TransformPoint(local);
            var origin = p + (fromBelow ? Vector3.down : Vector3.up) * reach * 0.5f;
            var ray = new Ray(origin, fromBelow ? Vector3.up : Vector3.down);
            float best = float.NaN;
            foreach (var c in go.GetComponentsInChildren<Collider>(true))
            {
                if (!c.enabled || !c.Raycast(ray, out var hit, reach)) continue;
                if (float.IsNaN(best) || (fromBelow ? hit.point.y < best : hit.point.y > best)) best = hit.point.y;
            }
            return best;
        }

        /// <summary>沿局部 X 两头各取几处探顶面 / 底面，返回 (−X 头的平均, +X 头的平均)；打不到的点不算</summary>
        public static (float minus, float plus) ProbeEnds(GameObject go, float halfX, IReadOnlyList<float> zs, float y0, bool fromBelow)
        {
            float Avg(float x)
            {
                float sum = 0;
                int n = 0;
                foreach (var z in zs)
                {
                    float y = ProbeY(go, new Vector3(x, y0, z), fromBelow);
                    if (float.IsNaN(y)) continue;
                    sum += y;
                    n++;
                }
                return n > 0 ? sum / n : float.NaN;
            }
            return (Avg(-halfX), Avg(halfX));
        }
    }
}
