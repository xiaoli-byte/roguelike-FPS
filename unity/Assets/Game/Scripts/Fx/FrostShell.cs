using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 霜甲壳（FX3；Three.js FrostSupportFx.FrostShell）：九尾狐巫给同伴结的那层冰壳——罩在身体外面的多面冰（<see cref="FxIceMeshes.Shell"/>，
    /// SF_FxIce：半透明冰体 + 棱边冷光 + 菲涅尔），刚结上时 0.35 s 从脚下往上冻（前沿一道亮线），之后轻轻起伏、慢慢转；
    /// 霜甲没了（到期、来源碎镜 / 死亡）就 <see cref="Shatter"/>：碎冰 + 雪花，冰壳 0.12 s 内消失。目标死亡 / 被销毁时自动碎掉。
    /// 大小按目标的角色碰撞体包围盒（脚底、水平半径 × 1.35、高 × 1.12）每帧重算，跟着走。同一个目标只有一层（再结一次只是刷新）。
    /// 对象池复用，挂在常驻的特效根下；换关清场（<see cref="ClearAll"/>）。
    /// </summary>
    public sealed class FrostShell : MonoBehaviour
    {
        const float FreezeTime = 0.35f, BreakTime = 0.12f;

        static readonly Dictionary<Damageable, FrostShell> live = new();
        static readonly Stack<FrostShell> pool = new();
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly List<Damageable> scratch = new();

        Damageable target, key;
        Collider col;
        MeshRenderer mr;
        MaterialPropertyBlock block;
        float age, show, breakAt = -1, seed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            pool.Clear();
        }

        /// <summary>场上的霜甲壳数（测试用）</summary>
        public static int ActiveCount
        {
            get
            {
                int n = 0;
                foreach (var kv in live)
                    if (kv.Value && kv.Value.breakAt < 0)
                        n++;
                return n;
            }
        }

        /// <summary>这个目标身上的霜甲壳（没有 / 正在碎返回 null）</summary>
        public static FrostShell Of(Damageable d) => d && live.TryGetValue(d, out var s) && s && s.breakAt < 0 ? s : null;

        /// <summary>给目标结一层霜甲壳（已有就原样返回；正在碎的重新冻上）。目标没有碰撞体时按 1 m 宽、1.8 m 高估</summary>
        public static FrostShell Cover(Damageable d)
        {
            if (!d || d.Dead || !Application.isPlaying) return null;
            if (live.TryGetValue(d, out var s) && s)
            {
                if (s.breakAt >= 0)
                {
                    s.breakAt = -1;
                    s.show = 0;
                    s.age = 0;
                }
                return s;
            }
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            s = Take(rt.transform);
            s.Begin(d);
            live[d] = s;
            return s;
        }

        /// <summary>碎掉目标的霜甲壳（fx = 放碎冰）；没有返回 false</summary>
        public static bool Shatter(Damageable d, bool fx = true)
        {
            if (!d || !live.TryGetValue(d, out var s) || !s) return false;
            s.Shatter(fx);
            return true;
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            scratch.Clear();
            scratch.AddRange(live.Keys);
            foreach (var d in scratch)
                if (live.TryGetValue(d, out var s) && s)
                    s.Release();
            live.Clear();
        }

        static FrostShell Take(Transform parent)
        {
            while (pool.Count > 0)
            {
                var p = pool.Pop();
                if (!p) continue;
                p.gameObject.SetActive(true);
                return p;
            }
            var go = new GameObject("Frost Shell");
            go.transform.SetParent(parent, false);
            var s = go.AddComponent<FrostShell>();
            go.AddComponent<MeshFilter>().sharedMesh = FxIceMeshes.Shell;
            s.mr = go.AddComponent<MeshRenderer>();
            s.mr.sharedMaterial = FxMaterials.Get(FxMaterialKind.Ice);
            s.mr.shadowCastingMode = ShadowCastingMode.Off;
            s.mr.receiveShadows = false;
            s.mr.lightProbeUsage = LightProbeUsage.BlendProbes;
            s.block = new MaterialPropertyBlock();
            return s;
        }

        void Begin(Damageable d)
        {
            target = key = d;
            col = d.GetComponent<Collider>();
            age = 0;
            show = 0;
            breakAt = -1;
            seed = Random.value * 10f;
            transform.rotation = Quaternion.Euler(0, Random.value * 360f, 0);
            Place();
            Write();
        }

        /// <summary>碎掉（fx = 放碎冰）</summary>
        public void Shatter(bool fx = true)
        {
            if (breakAt >= 0) return;
            breakAt = age;
            if (!fx) return;
            Body(out var feet, out float r, out float h);
            var c = feet + Vector3.up * h * 0.5f;
            Fx.FrostShatter(c, Mathf.Clamp(r * 1.2f, 0.5f, 2.5f), FrostPalette.Ice);
            Fx.Play("FrostVapour", c, Vector3.up, FrostPalette.Mist, Mathf.Clamp(r, 0.5f, 2f));
        }

        void Release()
        {
            // 目标可能已经被销毁（Unity 的假 null）：按登记时的引用删
            if (key is not null && live.TryGetValue(key, out var s) && ReferenceEquals(s, this)) live.Remove(key);
            target = key = null;
            col = null;
            gameObject.SetActive(false);
            pool.Push(this);
        }

        void Body(out Vector3 feet, out float r, out float h)
        {
            if (col && col.enabled)
            {
                var b = col.bounds;
                feet = new Vector3(b.center.x, b.min.y, b.center.z);
                r = Mathf.Clamp(Mathf.Max(b.extents.x, b.extents.z), 0.3f, 3f);
                h = Mathf.Clamp(b.size.y, 0.6f, 8f);
                return;
            }
            feet = target ? target.transform.position : transform.position;
            r = 0.5f;
            h = 1.8f;
        }

        void Place()
        {
            Body(out var feet, out float r, out float h);
            float breathe = 1 + 0.025f * Mathf.Sin(age * 2.3f + seed);
            transform.position = feet + Vector3.down * 0.04f * h;
            transform.localScale = new Vector3(r * 1.35f * breathe, h * 1.12f, r * 1.35f * breathe);
            transform.Rotate(0, 8f * Time.deltaTime, 0, Space.World);
        }

        void Write()
        {
            float k = FreezeTime > 0 ? Mathf.Clamp01(age / FreezeTime) : 1;
            show = 1 - (1 - k) * (1 - k);
            float alpha = 0.9f + 0.1f * Mathf.Sin(age * 3.1f + seed);
            if (breakAt >= 0) alpha *= 1 - Mathf.Clamp01((age - breakAt) / BreakTime);
            float glow = 0.8f * (1 - k) + 0.15f + 0.1f * Mathf.Sin(age * 4.7f + seed);
            mr.GetPropertyBlock(block);
            block.SetVector(ParamsId, new Vector4(alpha, show, breakAt >= 0 ? 1 : 0, glow));
            block.SetColor(BaseColorId, new Color(0.62f, 0.86f, 1f, 0.9f));
            mr.SetPropertyBlock(block);
        }

        void LateUpdate()
        {
            age += Time.deltaTime;
            // 目标死了：碎冰；目标被销毁 / 停用（回收、换关）：直接收起
            if (breakAt < 0 && (!target || target.Dead || !target.isActiveAndEnabled))
            {
                bool fx = target && target.isActiveAndEnabled;
                Shatter(fx);
            }
            if (breakAt >= 0 && age - breakAt >= BreakTime)
            {
                Release();
                return;
            }
            if (target) Place();
            Write();
        }
    }
}
