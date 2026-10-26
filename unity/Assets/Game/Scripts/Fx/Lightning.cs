using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 闪电弧（雷殛弹射、焚雷、封脉导流、归墟天雷、灵宠雷击；Three.js src/fx/Trails.ts 的 lightning）：
    /// 主干折线 + 一条斜伸的分叉，每 0.035 s 重新抖一次折线，寿命约 0.15–0.19 s，亮度 (1 − k²) × 随机闪烁；
    /// 每条线画两遍（外层光晕 + 白热细芯）。两端溅电火花和光团，落点闪一下灯。
    /// 池化（上限 40 道，满了复用最老的）：每道闪电 4 条 LineRenderer，常驻在 Fx 根物体下，不再每道 new 一个 GameObject。
    /// 兼容旧接口 <see cref="Spawn"/>（现在返回句柄，旧的语句调用不受影响）。
    /// </summary>
    public sealed class Lightning : MonoBehaviour
    {
        const int MaxBolts = 40, Segments = 16, BranchSegments = 5, MaxWaypoints = 6;
        const float DefaultWidth = 0.07f;

        sealed class Bolt : FxSlot
        {
            public LineRenderer glow, core, branchGlow, branchCore;
            public Vector3 a, b;
            public Color color;
            public float age, life, rejitter, flicker, widthK;
            public int n, bn;
            public readonly Vector3[] pts = new Vector3[Segments + 1];
            public readonly Vector3[] bpts = new Vector3[BranchSegments + 1];
            /// <summary>折线骨架（<see cref="Lightning.Chain"/>：贴着骨骼跳的电弧）；wayN &lt; 2 = 普通两点闪电</summary>
            public readonly Vector3[] way = new Vector3[MaxWaypoints];
            public int wayN;

            public override void CancelFx() => life = Mathf.Min(life, age + 0.05f);

            public override void RetargetFx(Vector3 from, Vector3 to)
            {
                a = from;
                b = to;
            }
        }

        static Lightning instance;
        readonly List<Bolt> bolts = new();

        /// <summary>从 from 到 to 劈一道闪电（width 是旧接口的线宽，0.07 = 标准粗细，按比例缩放光晕和细芯）</summary>
        public static FxHandle Spawn(Vector3 from, Vector3 to, Color color, float width = DefaultWidth)
        {
            if (!Fx.Finite(from) || !Fx.Finite(to)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            if (!instance) instance = rt.gameObject.AddComponent<Lightning>();
            return instance.Take(from, to, color, width, null, 0, true);
        }

        /// <summary>
        /// 沿一串点（骨骼位置）劈一道贴着走的电弧（B 路：感电的电弧贴着骨骼跳）：每两点之间细碎地抖，不分叉、不闪灯，末端只溅两三颗电火花。
        /// points 取前 count 个（2..6）
        /// </summary>
        public static FxHandle Chain(Vector3[] points, int count, Color color, float width = 0.04f)
        {
            if (points == null || count < 2) return FxHandle.None;
            count = Mathf.Min(count, Mathf.Min(points.Length, MaxWaypoints));
            for (int i = 0; i < count; i++)
                if (!Fx.Finite(points[i])) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            if (!instance) instance = rt.gameObject.AddComponent<Lightning>();
            return instance.Take(points[0], points[count - 1], color, width, points, count, false);
        }

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (!instance) return;
            foreach (var bo in instance.bolts) instance.Hide(bo);
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        FxHandle Take(Vector3 from, Vector3 to, Color color, float width, Vector3[] way, int wayN, bool full)
        {
            Bolt bo = null, oldest = null;
            foreach (var x in bolts)
            {
                if (!x.active)
                {
                    bo = x;
                    break;
                }
                if (oldest == null || x.age / x.life > oldest.age / oldest.life) oldest = x;
            }
            if (bo == null)
            {
                if (bolts.Count < MaxBolts)
                {
                    bo = new Bolt
                    {
                        glow = Line("Bolt Glow", Segments + 1), core = Line("Bolt Core", Segments + 1),
                        branchGlow = Line("Bolt Branch Glow", BranchSegments + 1), branchCore = Line("Bolt Branch Core", BranchSegments + 1),
                    };
                    bolts.Add(bo);
                }
                else bo = oldest;
            }
            bo.Claim();
            bo.a = from;
            bo.b = to;
            bo.color = color;
            bo.age = 0;
            bo.life = 0.15f + Random.value * 0.04f;
            bo.rejitter = 0.035f;
            bo.widthK = Mathf.Clamp(width / DefaultWidth, 0.3f, 4f);
            bo.wayN = way != null ? wayN : 0;
            for (int i = 0; i < bo.wayN; i++) bo.way[i] = way[i];
            Jag(bo);
            Draw(bo, 1);

            var rt = FxRuntime.Ensure();
            if (!full)
            {
                // 贴骨电弧：末端两三颗电火花，不闪灯（身上一秒好几道，灯会把整个人照花）
                var sp = rt ? rt.GetEmitter("StreakLight") : null;
                if (sp != null)
                    for (int i = 0; i < 3; i++)
                        rt.EmitOne(sp, to, Random.onUnitSphere * Random.Range(2f, 4.5f), 0.03f, Random.Range(0.08f, 0.16f), color, 0);
                return new FxHandle(bo);
            }

            // 两端的电火花 + 光团，落点闪一下灯
            if (rt)
            {
                var sparks = rt.GetEmitter("StreakLight");
                if (sparks != null)
                    for (int i = 0; i < 5; i++)
                    {
                        var v = new Vector3(Random.Range(-6f, 6f), Random.Range(-1f, 5f), Random.Range(-6f, 6f));
                        rt.EmitOne(sparks, to, v, 0.036f, Random.Range(0.12f, 0.28f), color, 0);
                    }
                var glow = rt.GetEmitter("Glow");
                if (glow != null)
                {
                    var bright = new Color(Mathf.Min(1, color.r * 1.6f), Mathf.Min(1, color.g * 1.6f), Mathf.Min(1, color.b * 1.6f), 1);
                    rt.EmitOne(glow, to, Vector3.zero, 0.9f * Mathf.Sqrt(bo.widthK), 0.12f, bright, 0);
                    rt.EmitOne(glow, from, Vector3.zero, 0.5f * Mathf.Sqrt(bo.widthK), 0.1f, color, 0);
                }
            }
            FxLightPool.Flash(to, Color.Lerp(color, Color.white, 0.3f), 7.2f, 6f, 0.1f);
            return new FxHandle(bo);
        }

        LineRenderer Line(string name, int points)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var lr = go.AddComponent<LineRenderer>();
            FxLines.ConfigureLine(lr, points);
            lr.numCapVertices = 1;
            lr.enabled = false;
            return lr;
        }

        /// <summary>重新生成闪电折线（主干随机游走 + 正弦包络，端点固定；八成概率带一条分叉）</summary>
        static void Jag(Bolt bo)
        {
            if (bo.wayN >= 2)
            {
                JagPath(bo);
                return;
            }
            var d = bo.b - bo.a;
            float dist = d.magnitude;
            if (dist < 1e-4f)
            {
                bo.n = 0;
                bo.bn = 0;
                return;
            }
            d /= dist;
            var reference = Mathf.Abs(d.y) < 0.95f ? Vector3.up : Vector3.right;
            var u = Vector3.Cross(d, reference).normalized;
            var w = Vector3.Cross(d, u).normalized;
            int n = Mathf.Clamp(Mathf.RoundToInt(dist / 0.65f), 5, Segments);
            float amp = Mathf.Min(1.1f, 0.12f + dist * 0.08f);
            bo.n = n;
            float ou = 0, ow = 0;
            for (int i = 0; i <= n; i++)
            {
                float t = i / (float)n;
                ou = ou * 0.45f + Random.Range(-amp, amp);
                ow = ow * 0.45f + Random.Range(-amp, amp);
                float k = i == 0 || i == n ? 0 : Mathf.Sin(Mathf.PI * t);
                bo.pts[i] = bo.a + d * (dist * t) + (u * ou + w * ow) * k;
            }
            if (n >= 6 && Random.value < 0.8f)
            {
                int from = Mathf.FloorToInt(n * Random.Range(0.25f, 0.7f));
                bo.bn = BranchSegments;
                float bl = dist * Random.Range(0.18f, 0.32f);
                float su = Random.Range(-1f, 1f), sw = Random.Range(-1f, 1f);
                var p = bo.pts[from];
                bo.bpts[0] = p;
                float step = bl / BranchSegments;
                var f = d * 0.6f + (u * su + w * sw) * 0.8f;
                for (int i = 1; i <= BranchSegments; i++)
                {
                    p += f * step + Random.insideUnitSphere * (step * 0.5f);
                    bo.bpts[i] = p;
                }
            }
            else bo.bn = 0;
            bo.flicker = Random.Range(0.55f, 1f);
        }

        /// <summary>沿骨架折线：每两点之间均分几段、垂直方向细碎抖动（两端固定在骨架点上），不分叉</summary>
        static void JagPath(Bolt bo)
        {
            int legs = bo.wayN - 1;
            int per = Mathf.Max(1, Segments / legs);
            int w = 0;
            bo.pts[w++] = bo.way[0];
            for (int l = 0; l < legs && w <= Segments; l++)
            {
                var p0 = bo.way[l];
                var p1 = bo.way[l + 1];
                var d = p1 - p0;
                float dist = d.magnitude;
                var dn = dist > 1e-4f ? d / dist : Vector3.up;
                var u = Vector3.Cross(dn, Mathf.Abs(dn.y) < 0.95f ? Vector3.up : Vector3.right).normalized;
                var v = Vector3.Cross(dn, u);
                float amp = Mathf.Clamp(dist * 0.22f, 0.02f, 0.09f);
                for (int j = 1; j <= per && w <= Segments; j++)
                {
                    float t = j / (float)per;
                    float k = j == per ? 0 : Mathf.Sin(Mathf.PI * t);
                    bo.pts[w++] = p0 + d * t + (u * Random.Range(-amp, amp) + v * Random.Range(-amp, amp)) * k;
                }
            }
            bo.n = w - 1;
            bo.bn = 0;
            bo.flicker = Random.Range(0.6f, 1f);
        }

        void Draw(Bolt bo, float alpha)
        {
            var c = bo.color;
            var coreC = new Color(Mathf.Min(1, 0.75f + c.r * 0.5f), Mathf.Min(1, 0.75f + c.g * 0.5f), Mathf.Min(1, 0.75f + c.b * 0.5f), alpha);
            var glowC = new Color(c.r, c.g, c.b, alpha * 0.55f);
            Poly(bo.glow, bo.pts, bo.n, 0.09f * bo.widthK, glowC);
            Poly(bo.core, bo.pts, bo.n, 0.02f * bo.widthK, coreC);
            if (bo.bn > 0)
            {
                Poly(bo.branchGlow, bo.bpts, bo.bn, 0.055f * bo.widthK, new Color(glowC.r, glowC.g, glowC.b, glowC.a * 0.7f));
                Poly(bo.branchCore, bo.bpts, bo.bn, 0.012f * bo.widthK, new Color(coreC.r, coreC.g, coreC.b, coreC.a * 0.7f));
            }
            else bo.branchGlow.enabled = bo.branchCore.enabled = false;
        }

        static void Poly(LineRenderer lr, Vector3[] pts, int n, float width, Color c)
        {
            if (n <= 0)
            {
                lr.enabled = false;
                return;
            }
            lr.enabled = true;
            lr.positionCount = n + 1;
            lr.SetPositions(pts);
            lr.widthMultiplier = width;
            lr.startColor = c;
            lr.endColor = c;
        }

        void Hide(Bolt bo)
        {
            bo.active = false;
            bo.glow.enabled = bo.core.enabled = bo.branchGlow.enabled = bo.branchCore.enabled = false;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var bo in bolts)
            {
                if (!bo.active) continue;
                bo.age += dt;
                if (bo.age >= bo.life)
                {
                    Hide(bo);
                    continue;
                }
                bo.rejitter -= dt;
                if (bo.rejitter <= 0)
                {
                    bo.rejitter = 0.035f;
                    Jag(bo);
                }
                float k = bo.age / bo.life;
                Draw(bo, (1 - k * k) * bo.flicker);
            }
        }
    }
}
