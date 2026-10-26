using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 死亡表现（FX2「死亡迸散 + 溶解」）：挂在敌人身上（FxDirector 在出生时挂；没经过出生登记的在击杀时补挂），
    ///   倒下那一刻：<see cref="Fx.Death"/> 迸散（敌人色碎块、发光碎屑、魂火、贴地小环）；
    ///   尸体（布娃娃）留到 EnemyBody 回收前 1.1 s 开始溶解：SF_StylizedLit 的 _DissolveParams（UV 噪声 + 上面先溶的高度渐变），
    ///   前沿一圈敌人色的 HDR 发光，同时往上飘灰烬光点；回收时正好溶完（不再是尸体凭空消失）。
    /// 材质不支持溶解的渲染器（毛发壳层、羽片）在溶到一半时关掉渲染。打靶木桩（respawnAfter &gt; 0）只迸散不溶解。
    /// 写 MaterialPropertyBlock 前先 Get，和 EnemyBody 的闪白 / 着色、EnemyVariant 的变体参数互不覆盖。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DeathDissolve : MonoBehaviour
    {
        /// <summary>溶解时长（秒）</summary>
        public const float Duration = 1.1f;

        static readonly int ParamsId = Shader.PropertyToID("_DissolveParams");
        static readonly int PlaneId = Shader.PropertyToID("_DissolvePlane");
        static readonly int EdgeId = Shader.PropertyToID("_DissolveEdgeColor");

        Damageable hp;
        EnemyBody body;
        bool triggered;
        float diedAt = -1, emitAcc;
        Color color, edge;
        /// <summary>击杀那一下的元素（元素色迸散、灰烬掺元素色）</summary>
        Element killElement;
        readonly List<Renderer> targets = new(), others = new();
        MaterialPropertyBlock block;

        /// <summary>此刻的溶解量（测试用）：0 = 完整，1 = 溶完</summary>
        public float Amount { get; private set; }

        public static DeathDissolve Attach(Damageable d)
        {
            if (!d) return null;
            if (!d.TryGetComponent(out DeathDissolve dd)) dd = d.gameObject.AddComponent<DeathDissolve>();
            return dd;
        }

        void Awake()
        {
            hp = GetComponent<Damageable>();
            body = GetComponent<EnemyBody>();
            if (hp) hp.Died += OnDied;
            enabled = false;
        }

        void OnDestroy()
        {
            if (hp) hp.Died -= OnDied;
        }

        void OnDied(DamageInfo info)
        {
            killElement = info.element;
            TriggerNow();
        }

        /// <summary>立刻按「刚死」处理：迸散，开始倒计时溶解</summary>
        public void TriggerNow()
        {
            if (triggered || !hp) return;
            triggered = true;
            var c = FxDirector.Body(hp, out float r);
            color = FxDirector.EnemyColor(hp);
            Fx.Death(c, color, Mathf.Clamp(r * 2f, 0.6f, 6f));
            // B 路：元素击杀再叠一层元素色迸散
            var elementId = DeathElementPreset.IdOf(killElement);
            if (elementId != null) Fx.Play(elementId, c, Vector3.up, Fx.ElementColor(killElement), Mathf.Clamp(r * 2f, 0.6f, 6f));
            FxDirector.CountDeath();
            diedAt = Time.time;
            // 溶解前沿：HDR 敌人色 + 白热底（B 路：亮一档，Bloom 吃得到一圈清楚的亮边）
            edge = new Color(color.r * 4f + 0.6f, color.g * 4f + 0.5f, color.b * 4f + 0.4f, 1);
            Collect(gameObject, targets, others);
            emitAcc = 0;
            enabled = true;
        }

        /// <summary>按材质有没有 _DissolveParams 分成两组（粒子 / 拖尾 / 连线不管）</summary>
        internal static void Collect(GameObject root, List<Renderer> dissolvable, List<Renderer> rest)
        {
            dissolvable.Clear();
            rest.Clear();
            foreach (var r in root.GetComponentsInChildren<Renderer>())
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer) continue;
                bool ok = false;
                foreach (var m in r.sharedMaterials)
                    if (m && m.HasProperty(ParamsId))
                    {
                        ok = true;
                        break;
                    }
                (ok ? dissolvable : rest).Add(r);
            }
        }

        /// <summary>写溶解参数：amount 0..1，plane = 渐变（起点高度、每米变化），weight = 高度渐变权重</summary>
        internal static void Apply(List<Renderer> list, MaterialPropertyBlock block, float amount, Vector4 plane, float weight, Color edge, float edgeWidth)
        {
            var p = new Vector4(amount, edgeWidth, 9f, weight);
            foreach (var r in list)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetVector(ParamsId, p);
                block.SetVector(PlaneId, plane);
                block.SetColor(EdgeId, edge);
                r.SetPropertyBlock(block);
            }
        }

        /// <summary>一组渲染器的合并包围盒</summary>
        internal static Bounds BoundsOf(List<Renderer> list, Vector3 fallback)
        {
            bool any = false;
            var b = new Bounds(fallback, Vector3.one * 0.5f);
            foreach (var r in list)
            {
                if (!r || !r.enabled) continue;
                if (!any) b = r.bounds;
                else b.Encapsulate(r.bounds);
                any = true;
            }
            return b;
        }

        void Update()
        {
            if (!hp) return;
            // 打靶木桩：只迸散；复活后可以再死一次
            if (body && body.respawnAfter > 0)
            {
                if (!hp.Dead)
                {
                    triggered = false;
                    enabled = false;
                }
                return;
            }
            float despawn = body ? body.despawnAfter : 6f;
            float start = Mathf.Max(0.3f, despawn - Duration - 0.1f);
            float t = (Time.time - diedAt - start) / Duration;
            if (t <= 0) return;
            float k = Mathf.Clamp01(t);
            Amount = k;
            block ??= new MaterialPropertyBlock();
            var b = BoundsOf(targets, transform.position + Vector3.up * 0.5f);
            float h = Mathf.Max(0.3f, b.size.y);
            // 上面先溶（g = (顶 − y) / 高，前沿从上往下走），权重 0.35：主要还是噪声斑驳地化掉
            Apply(targets, block, k, new Vector4(b.max.y, -1f / h, 0, 0), 0.35f, edge, 0.13f);
            if (k > 0.45f)
                foreach (var r in others)
                    if (r) r.forceRenderingOff = true;
            // 灰烬：前沿往上飘的光点
            var rt = k < 0.95f ? FxRuntime.Ensure() : null;
            if (!rt) return;
            emitAcc += Time.deltaTime * (14f + 10f * b.extents.magnitude) * Fx.Density;
            var e = emitAcc >= 1 ? rt.GetEmitter("Mote") : null;
            while (emitAcc >= 1)
            {
                emitAcc -= 1;
                if (e == null) continue;
                var p = new Vector3(Random.Range(b.min.x, b.max.x), Random.Range(b.min.y, b.max.y), Random.Range(b.min.z, b.max.z));
                var c = Color.Lerp(killElement != Element.None && Random.value < 0.45f ? Fx.ElementColor(killElement) : color, Color.white, Random.value * 0.4f);
                rt.EmitOne(e, p, new Vector3(Random.Range(-0.3f, 0.3f), Random.Range(0.6f, 1.6f), Random.Range(-0.3f, 0.3f)), Random.Range(0.06f, 0.12f),
                    Random.Range(0.5f, 0.9f), c, 0);
            }
        }
    }
}
