using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>身上淌下来的是什么</summary>
    public enum StreamKind
    {
        /// <summary>水：水珠一串串往下滴、偶尔一缕水雾（出水的旱魃、鲲）</summary>
        Water,
        /// <summary>沙：细沙往下泻、几团沙尘（旱魃出水时身上挂的沙）</summary>
        Sand,
        /// <summary>熔浆：亮橙的熔滴往下掉、发红的炭渣（跃出熔池的火麒麟）</summary>
        Molten,
    }

    /// <summary>
    /// 身上流泻（特效打磨 C 路：首领出水 / 出熔池后身上淌下来的水、沙、熔浆）。挂到模型上 duration 秒：
    /// 每帧从模型的骨骼（没有骨骼就从渲染器包围盒表面）随机挑点往下发粒子，频率随时间衰减（刚出来时哗哗地淌，最后只剩零星几滴）。
    /// 粒子走共享发射器（Drop / Spray / Grit / Dust / Molten / Cinder / Powder），数量乘画质密度、过 <see cref="FxBudget"/>。
    /// 每种流泻是模型下一个子物体（「BodyStreams 水 / 沙 / 熔浆」），同一个模型可以同时淌水又泻沙；同一种重复挂会刷新时长。首领被销毁时自然停止。
    /// </summary>
    public sealed class BodyStreams : MonoBehaviour
    {
        StreamKind kind;
        Transform source;
        float age, duration, rate, acc, mistAcc;
        Color color;
        readonly List<Transform> points = new();
        Renderer[] renderers;

        /// <summary>
        /// 给 model 挂上流泻：duration 秒，rate = 起始每秒多少串（会衰减到 15%），color 缺省按材质（水青白、沙黄、熔浆橙）
        /// </summary>
        public static BodyStreams Attach(GameObject model, StreamKind kind, float duration, float rate = 60f, Color? color = null)
        {
            if (!model || !(duration > 0) || !Application.isPlaying) return null;
            string name = "BodyStreams " + kind;
            var child = model.transform.Find(name);
            if (!child)
            {
                child = new GameObject(name).transform;
                child.SetParent(model.transform, false);
            }
            if (!child.TryGetComponent(out BodyStreams s)) s = child.gameObject.AddComponent<BodyStreams>();
            s.source = model.transform;
            s.kind = kind;
            s.age = 0;
            s.duration = duration;
            s.rate = Mathf.Max(1, rate);
            s.color = color ?? DefaultColor(kind);
            s.Collect();
            s.enabled = true;
            return s;
        }

        public static Color DefaultColor(StreamKind k) => k switch
        {
            StreamKind.Water => new Color(0.78f, 0.93f, 0.96f, 1),
            StreamKind.Sand => new Color(0.86f, 0.68f, 0.42f, 1),
            _ => InfernoPalette.Molten,
        };

        void Collect()
        {
            points.Clear();
            var root = source ? source : transform;
            renderers = System.Array.FindAll(root.GetComponentsInChildren<Renderer>(false), r => r is MeshRenderer or SkinnedMeshRenderer);
            foreach (var r in renderers)
                if (r is SkinnedMeshRenderer sk && sk.bones != null)
                    foreach (var b in sk.bones)
                        if (b && !points.Contains(b))
                            points.Add(b);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            age += dt;
            if (age >= duration)
            {
                enabled = false;
                return;
            }
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float k = 1f - age / duration;
            float now = rate * (0.15f + 0.85f * k * k) * Fx.Density;
            acc += now * dt;
            int n = Mathf.Min(24, (int)acc);
            if (n <= 0) return;
            acc -= n;
            n = FxBudget.Allow(n, false);
            if (n <= 0) return;
            string main = kind switch { StreamKind.Water => "Drop", StreamKind.Sand => "Grit", _ => "Molten" };
            string streak = kind == StreamKind.Molten ? "Cinder" : "Spray";
            var e = rt.GetEmitter(main);
            var e2 = rt.GetEmitter(streak);
            for (int i = 0; i < n; i++)
            {
                if (!Pick(out var p, out var outward)) return;
                // 往外一点、往下淌：水珠和熔滴带一点外抛，沙是往下泻
                var v = outward * Random.Range(0.3f, 1.2f) + Vector3.down * Random.Range(0.5f, 2.5f);
                bool alt = (i & 1) == 1 && e2 != null;
                var em = alt ? e2 : e;
                if (em == null) continue;
                float size = kind switch
                {
                    StreamKind.Water => alt ? Random.Range(0.05f, 0.08f) : Random.Range(0.07f, 0.13f),
                    StreamKind.Sand => alt ? Random.Range(0.05f, 0.09f) : Random.Range(0.04f, 0.07f),
                    _ => alt ? Random.Range(0.06f, 0.11f) : Random.Range(0.08f, 0.15f),
                };
                var c = color * Random.Range(0.85f, 1.1f);
                c.a = 1;
                rt.EmitOne(em, p, v, size, Random.Range(0.5f, 0.95f), c, 0);
            }
            // 偶尔一缕水雾 / 沙尘 / 黑烟
            mistAcc += dt * (kind == StreamKind.Water ? 3f : 4f) * k * Fx.Density;
            if (mistAcc >= 1 && Pick(out var mp, out var mo))
            {
                mistAcc -= 1;
                string mist = kind switch { StreamKind.Water => "Powder", StreamKind.Sand => "Dust", _ => "Soot" };
                var me = rt.GetEmitter(mist);
                if (me != null && FxBudget.Allow(1, false) > 0)
                {
                    var mc = kind == StreamKind.Molten ? InfernoPalette.Soot : color;
                    rt.EmitOne(me, mp, mo * 0.4f + Vector3.down * 0.3f, Random.Range(0.35f, 0.6f), Random.Range(0.8f, 1.3f), mc, 0);
                }
            }
        }

        /// <summary>挑一个发射点：骨骼位置（离身体中心往外 5 cm），没有骨骼时在渲染器包围盒的侧面上随机取</summary>
        bool Pick(out Vector3 p, out Vector3 outward)
        {
            var center = source ? source.position : transform.position;
            if (renderers != null && renderers.Length > 0 && renderers[0]) center = renderers[0].bounds.center;
            for (int tries = 0; tries < 4; tries++)
            {
                if (points.Count > 0)
                {
                    var b = points[Random.Range(0, points.Count)];
                    if (!b) continue;
                    p = b.position;
                }
                else
                {
                    Renderer r = renderers != null && renderers.Length > 0 ? renderers[Random.Range(0, renderers.Length)] : null;
                    if (!r) break;
                    var bb = r.bounds;
                    float a = Random.value * Mathf.PI * 2;
                    p = bb.center + new Vector3(Mathf.Cos(a) * bb.extents.x, Random.Range(-0.6f, 0.9f) * bb.extents.y, Mathf.Sin(a) * bb.extents.z);
                }
                var o = p - center;
                o.y = 0;
                outward = o.sqrMagnitude > 1e-4f ? o.normalized : Random.insideUnitSphere.normalized;
                p += outward * 0.05f;
                return true;
            }
            p = transform.position;
            outward = Vector3.up;
            return false;
        }
    }
}
