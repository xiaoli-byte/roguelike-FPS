using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 月牙泉的泉水（1-4 鸣沙山月牙泉：沙丘环抱的洼地里一弯泉水；unity-maps-v1.md 第 3 节二阶段「她把剩下的泉水吸干，泉床龟裂」）。
    /// 旱魃二阶段把它吸干（<see cref="Drain"/>），倒下后泉眼复涌（<see cref="Refill"/>）。
    /// 场景标记：泉水是一组 <see cref="WaterVolume"/>，由关卡给出（这里不改关卡构建器）。<see cref="Find"/> 依次认——
    ///   ① 场景里已有的 HanbaSpring 组件（关卡可以直接挂在泉水根节点上，管它下面的全部 WaterVolume）；
    ///   ② 标签为 <see cref="Tag"/>（"CrescentSpring"）的 WaterVolume，或者它自己 / 上级物体名字里带 "CrescentSpring" / "Crescent Spring" 的
    ///     （只读 GameObject.tag 字符串比较，不调 CompareTag：工程里还没定义这个标签时也不报错）——运行时挂一个 HanbaSpring 管它们；
    ///   都没有时返回 null：二阶段照常龟裂、喷气（裂口按场地中心排一圈），只是没有水可吸。不会去抓场地里别的水。
    /// 吸干：每段水的高度（Transform 的 y 缩放）从原来的水深降到 0、底面不动，降到底后整段停用——停用的 WaterVolume 退出 <see cref="WaterVolume.All"/>，
    /// 日晒判定（<see cref="SunExposure"/>）随之认不出浅水，踩水减半就没了；涉水减速、深水托回也一并消失。吸的过程中各段水面朝 sink（旱魃心口）飘水珠。
    /// 复涌：反过来，先启用、再从 0 涨回原水深。<see cref="Beds"/> = 泉底上均匀取的点（每段水按面积每约 6 m 一个，泉床最低处），二阶段的喷气裂缝沿它们排。
    /// 画面：水段自己的子物体水面片跟着缩放一起落；关卡给整弯泉一张共用水面（泉水根节点下名字带 <see cref="SurfaceName"/>、不在水段里面的渲染器，1-4 是这样）时，
    /// 它从原高度按水位落到泉床最低处、水位 0 时停用（浅的地方先露底）。根节点下的 <see cref="CrackedBedName"/> 组（龟裂贴花）平时停用，吸干时打开、复涌完再收起。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HanbaSpring : MonoBehaviour
    {
        /// <summary>关卡给泉水 WaterVolume 打的标签；名字标记（物体或上级物体名字里带它们就算）</summary>
        public const string Tag = "CrescentSpring";
        public static readonly string[] Names = { "CrescentSpring", "Crescent Spring" };
        /// <summary>泉底取点的间距（米）</summary>
        public const float BedStep = 6f;
        /// <summary>整弯泉共用水面的名字标记、吸干后才露出来的龟裂贴花组的名字（都在泉水根节点下）</summary>
        public const string SurfaceName = "Surface", CrackedBedName = "Cracked Bed";
        static readonly Color Droplet = new(0.6f, 0.86f, 1f);

        sealed class Body
        {
            public WaterVolume water;
            public Transform t;
            public float depth, bottom;
            public Vector3 scale;
        }

        readonly List<Body> bodies = new();
        readonly List<Vector3> beds = new();
        /// <summary>共用水面（原高度）与吸干后露出来的组</summary>
        readonly List<(Transform t, float y)> surfaces = new();
        readonly List<GameObject> reveals = new();
        float lowest;
        float level = 1f, from = 1f, to = 1f, t, seconds, dropAcc;
        bool animating;
        Vector3 sink;

        /// <summary>水位（1 = 原水深，0 = 吸干）</summary>
        public float Level => level;
        public bool Drained => level <= 0.001f && !animating;
        public bool Draining => animating && to < from;
        public bool Refilling => animating && to > from;
        /// <summary>管着的水段数、此刻还启用着的段数</summary>
        public int Count => bodies.Count;
        public int ActiveWaters
        {
            get
            {
                int n = 0;
                foreach (var b in bodies)
                    if (b.water && b.water.isActiveAndEnabled)
                        n++;
                return n;
            }
        }

        /// <summary>每段水的底面中心（世界），喷气裂缝沿它们排</summary>
        public IReadOnlyList<Vector3> Beds => beds;
        /// <summary>吸干 / 复涌过几次（测试用）</summary>
        public int Drains { get; private set; }
        public int Refills { get; private set; }
        /// <summary>来源："component"（场景里挂好的）/ "marker"（按标签 / 名字认出来的）</summary>
        public string Origin { get; private set; }

        /// <summary>这一段水归不归它管</summary>
        public bool Owns(WaterVolume w)
        {
            foreach (var b in bodies)
                if (b.water == w)
                    return true;
            return false;
        }

        // ───────────── 找泉水 ─────────────

        /// <summary>这段水是不是月牙泉（标签或名字标记，见类说明）</summary>
        public static bool IsSpringWater(WaterVolume w)
        {
            if (!w) return false;
            if (w.gameObject.tag == Tag) return true;
            for (var t = w.transform; t; t = t.parent)
                foreach (var n in Names)
                    if (t.name.IndexOf(n, System.StringComparison.OrdinalIgnoreCase) >= 0)
                        return true;
            return false;
        }

        /// <summary>找这片场地的泉水（见类说明；arena 只用来在有几处挂好的泉水时挑离场地最近的）；都没有返回 null</summary>
        public static HanbaSpring Find(BossArena arena)
        {
            HanbaSpring best = null;
            float bd = float.PositiveInfinity;
            foreach (var s in FindObjectsByType<HanbaSpring>(FindObjectsSortMode.None))
            {
                if (!s) continue;
                if (s.bodies.Count == 0) s.Collect(s.GetComponentsInChildren<WaterVolume>(true), s.Origin ?? "component");
                if (s.bodies.Count == 0) continue;
                float d = arena ? (s.CenterOfBeds() - arena.Center).sqrMagnitude : 0;
                if (d >= bd) continue;
                bd = d;
                best = s;
            }
            if (best) return best;
            var list = new List<WaterVolume>();
            foreach (var w in WaterVolume.All)
                if (IsSpringWater(w))
                    list.Add(w);
            if (list.Count == 0) return null;
            // 挂在这些水的共同上级上（没有共同上级就挂一个运行时物体），随关卡场景一起卸载
            var host = CommonParent(list);
            HanbaSpring sp;
            if (host) sp = host.gameObject.AddComponent<HanbaSpring>();
            else
            {
                var go = new GameObject("Hanba Spring (runtime)");
                go.transform.SetParent(list[0].transform.parent, false);
                sp = go.AddComponent<HanbaSpring>();
            }
            sp.Collect(list, "marker");
            return sp;
        }

        static Transform CommonParent(List<WaterVolume> list)
        {
            var p = list[0].transform.parent;
            for (; p; p = p.parent)
            {
                bool all = true;
                foreach (var w in list)
                    if (!w.transform.IsChildOf(p))
                    {
                        all = false;
                        break;
                    }
                if (all) return p.GetComponent<HanbaSpring>() ? null : p;
            }
            return null;
        }

        void Collect(IEnumerable<WaterVolume> list, string origin)
        {
            bodies.Clear();
            beds.Clear();
            Origin = origin;
            foreach (var w in list)
            {
                if (!w) continue;
                var tr = w.transform;
                var sc = tr.localScale;
                float depth = Mathf.Abs(tr.lossyScale.y);
                float bottom = tr.TransformPoint(0, -0.5f, 0).y;
                bodies.Add(new Body { water = w, t = tr, depth = depth, bottom = bottom, scale = sc });
                // 泉底取点：按水平尺寸每 BedStep 米一个（至少 1 个，每边至多 6 个）
                var ls = tr.lossyScale;
                int nx = Mathf.Clamp(Mathf.RoundToInt(Mathf.Abs(ls.x) / BedStep), 1, 6), nz = Mathf.Clamp(Mathf.RoundToInt(Mathf.Abs(ls.z) / BedStep), 1, 6);
                for (int i = 0; i < nx; i++)
                for (int j = 0; j < nz; j++)
                {
                    var p = tr.TransformPoint((i + 0.5f) / nx - 0.5f, -0.5f, (j + 0.5f) / nz - 0.5f);
                    beds.Add(p);
                }
            }
            CollectVisuals();
        }

        /// <summary>泉水根节点下的共用水面（名字带 Surface、不在水段里面的渲染器）与龟裂贴花组；lowest = 各段水底面的最低处</summary>
        void CollectVisuals()
        {
            surfaces.Clear();
            reveals.Clear();
            lowest = float.PositiveInfinity;
            foreach (var b in bodies) lowest = Mathf.Min(lowest, b.bottom);
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r || r.name.IndexOf(SurfaceName, System.StringComparison.OrdinalIgnoreCase) < 0 || r.GetComponentInParent<WaterVolume>(true)) continue;
                surfaces.Add((r.transform, r.transform.position.y));
            }
            foreach (var tr in GetComponentsInChildren<Transform>(true))
                if (tr && tr != transform && tr.name == CrackedBedName)
                    reveals.Add(tr.gameObject);
        }

        /// <summary>共用水面此刻的高度（世界 y；没有共用水面为 NaN，测试用）</summary>
        public float SurfaceY => surfaces.Count > 0 && surfaces[0].t ? surfaces[0].t.position.y : float.NaN;
        /// <summary>共用水面的个数、此刻还显示着的个数（测试用）</summary>
        public int Surfaces => surfaces.Count;
        public int SurfacesShown
        {
            get
            {
                int n = 0;
                foreach (var (st, _) in surfaces)
                    if (st && st.gameObject.activeInHierarchy)
                        n++;
                return n;
            }
        }
        /// <summary>龟裂贴花露着（测试用）</summary>
        public bool BedRevealed => reveals.Count > 0 && reveals[0] && reveals[0].activeSelf;

        Vector3 CenterOfBeds()
        {
            if (beds.Count == 0) return transform.position;
            var c = Vector3.zero;
            foreach (var b in beds) c += b;
            return c / beds.Count;
        }

        // ───────────── 吸干 / 复涌 ─────────────

        /// <summary>seconds 秒内吸干：水面降到底、整段停用；sink = 水珠飘向的点（旱魃心口）</summary>
        public void Drain(float seconds, Vector3 sinkAt)
        {
            if (bodies.Count == 0) return;
            sink = sinkAt;
            Drains++;
            foreach (var g in reveals)
                if (g)
                    g.SetActive(true);
            Begin(0f, seconds);
        }

        /// <summary>seconds 秒内复涌：整段启用、水面涨回原水深</summary>
        public void Refill(float seconds)
        {
            if (bodies.Count == 0) return;
            Refills++;
            foreach (var b in bodies)
                if (b.water)
                    b.water.gameObject.SetActive(true);
            Begin(1f, seconds);
            foreach (var p in beds) Fx.Burst(p + Vector3.up * 0.2f, Droplet, 6, 3f, 0.7f, 0.12f, 6f);
        }

        /// <summary>立刻设到某个水位（测试 / 重开）：0 = 停用，&gt; 0 = 启用</summary>
        public void SetLevel(float value)
        {
            animating = false;
            level = Mathf.Clamp01(value);
            Apply();
        }

        void Begin(float target, float duration)
        {
            from = level;
            to = target;
            t = 0;
            seconds = Mathf.Max(0.01f, duration);
            animating = true;
        }

        void Update()
        {
            if (!animating) return;
            float dt = Time.deltaTime;
            t += dt;
            float u = Mathf.Clamp01(t / seconds);
            level = Mathf.Lerp(from, to, u * u * (3 - 2 * u));
            if (to < from) Droplets(dt);
            if (u >= 1f)
            {
                animating = false;
                // 复涌到满：龟裂贴花收回去（水里看得见龟裂不对）
                if (level >= 0.999f)
                    foreach (var g in reveals)
                        if (g)
                            g.SetActive(false);
            }
            Apply();
        }

        /// <summary>按水位摆每段水：底面不动、高度 = 原水深 × 水位；水位 0 时整段停用</summary>
        void Apply()
        {
            foreach (var b in bodies)
            {
                if (!b.t) continue;
                bool on = level > 0.001f || animating && to > from;
                if (b.t.gameObject.activeSelf != on) b.t.gameObject.SetActive(on);
                if (!on) continue;
                float k = Mathf.Max(0.02f, level);
                b.t.localScale = new Vector3(b.scale.x, b.scale.y * k, b.scale.z);
                var p = b.t.position;
                b.t.position = new Vector3(p.x, b.bottom + b.depth * k * 0.5f, p.z);
            }
            // 共用水面：从原高度按水位落到泉床最低处（浅的地方先露底），水位 0 时停用
            bool show = level > 0.001f || animating && to > from;
            foreach (var (st, y0) in surfaces)
            {
                if (!st) continue;
                if (st.gameObject.activeSelf != show) st.gameObject.SetActive(show);
                if (!show) continue;
                float floor = float.IsFinite(lowest) ? Mathf.Min(lowest, y0) : y0;
                var p = st.position;
                st.position = new Vector3(p.x, Mathf.Lerp(floor, y0, level), p.z);
            }
        }

        /// <summary>吸水：每 0.06 s 从一段水面起一串水珠，沿直线飘向 sink</summary>
        void Droplets(float dt)
        {
            dropAcc += dt;
            if (dropAcc < 0.06f || bodies.Count == 0) return;
            dropAcc = 0;
            var b = bodies[Random.Range(0, bodies.Count)];
            if (!b.t) return;
            var top = new Vector3(b.t.position.x, b.bottom + b.depth * level, b.t.position.z);
            for (int i = 0; i < 4; i++)
            {
                float k = (i + Random.value * 0.6f) / 4f;
                var p = Vector3.Lerp(top, sink, k) + Vector3.up * Mathf.Sin(k * Mathf.PI) * 2.5f;
                Fx.Burst(p, Droplet, 2, 0.6f, 0.35f, 0.14f, -0.5f);
            }
        }
    }
}
