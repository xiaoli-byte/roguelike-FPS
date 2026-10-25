using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰刺（FX3；Three.js FrostPackFx.spawnIceRing 的冰刺部分）：贴地一圈向外斜的五棱冰锥，0.12 s 冒出（带一点过冲）→ 停留 → 缩回地里。
    /// 纯视觉（伤害、挡路由调用方结算）。每簇 ≤ 16 根，对象池复用，挂在常驻的特效根下，换关清场。
    /// 冰刺用 SF_FxIce 的「实冰」（厚度 2.4，几乎不透明，棱边冷光）。
    /// </summary>
    public sealed class IceSpikes : MonoBehaviour
    {
        const int MaxSpikes = 16;

        static readonly List<IceSpikes> live = new();
        static readonly Stack<IceSpikes> pool = new();
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        readonly MeshRenderer[] spikes = new MeshRenderer[MaxSpikes];
        readonly Vector3[] full = new Vector3[MaxSpikes];
        MaterialPropertyBlock block;
        int count;
        float age, duration, hold;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            pool.Clear();
        }

        /// <summary>场上的冰刺簇（测试用）</summary>
        public static int ActiveCount
        {
            get
            {
                live.RemoveAll(s => !s);
                return live.Count;
            }
        }

        /// <summary>
        /// 一圈冰刺：ground = 圆心（地面），radius = 半径（冰刺在 0.72–0.9 r 上交错），count 根（≤ 16），duration 秒（缺省 0.75），
        /// size = 冰刺大小倍率（1 = 底半径 0.16、高 0.7 m，每根再随机 0.7–1.3），lean = 向外倾斜（弧度）
        /// </summary>
        public static IceSpikes Ring(Vector3 ground, float radius, int count = 12, float duration = 0.75f, float size = 1f, float lean = 0.45f)
        {
            if (!Fx.Finite(ground) || !(radius > 0) || !Application.isPlaying) return null;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            var s = Take(rt.transform);
            count = Mathf.Clamp(count, 1, MaxSpikes);
            float rot = Random.value * Mathf.PI * 2;
            for (int i = 0; i < count; i++)
            {
                float a = rot + i / (float)count * Mathf.PI * 2;
                float r = radius * (0.72f + 0.18f * (i % 2));
                var outDir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var p = ground + outDir * r;
                float gy = Fx.GroundY(p + Vector3.up * 1.2f, 3f);
                if (!float.IsNegativeInfinity(gy) && Mathf.Abs(gy - ground.y) < 1.2f) p.y = gy;
                s.Place(i, p, outDir, lean, size * Random.Range(0.7f, 1.3f));
            }
            s.Begin(count, duration);
            return s;
        }

        /// <summary>
        /// 一簇散开的冰刺（冰棱阵、残刺阵的外观）：center 周围 inner–outer 米随机撒 count 根，向外斜 lean，duration 秒后缩回
        /// </summary>
        public static IceSpikes Cluster(Vector3 ground, float inner, float outer, int count, float duration, float size = 1f, float lean = 0.3f)
        {
            if (!Fx.Finite(ground) || !(outer > 0) || !Application.isPlaying) return null;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            var s = Take(rt.transform);
            count = Mathf.Clamp(count, 1, MaxSpikes);
            for (int i = 0; i < count; i++)
            {
                float a = Random.value * Mathf.PI * 2;
                float r = Mathf.Lerp(inner, outer, Mathf.Sqrt(Random.value));
                var outDir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var p = ground + outDir * r;
                float gy = Fx.GroundY(p + Vector3.up * 1.2f, 3f);
                if (!float.IsNegativeInfinity(gy) && Mathf.Abs(gy - ground.y) < 1.2f) p.y = gy;
                s.Place(i, p, outDir, lean * Random.Range(0.5f, 1.3f), size * Random.Range(0.7f, 1.3f));
            }
            s.Begin(count, duration);
            return s;
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            foreach (var s in live)
                if (s)
                {
                    s.gameObject.SetActive(false);
                    pool.Push(s);
                }
            live.Clear();
        }

        static IceSpikes Take(Transform parent)
        {
            IceSpikes s = null;
            while (pool.Count > 0 && !s) s = pool.Pop();
            if (!s)
            {
                var go = new GameObject("Ice Spikes");
                go.transform.SetParent(parent, false);
                s = go.AddComponent<IceSpikes>();
                s.block = new MaterialPropertyBlock();
                var mat = FxMaterials.Get(FxMaterialKind.Ice);
                for (int i = 0; i < MaxSpikes; i++)
                {
                    var c = new GameObject("Spike");
                    c.transform.SetParent(go.transform, false);
                    c.AddComponent<MeshFilter>().sharedMesh = FxIceMeshes.Spike;
                    var r = c.AddComponent<MeshRenderer>();
                    r.sharedMaterial = mat;
                    r.shadowCastingMode = ShadowCastingMode.Off;
                    r.receiveShadows = false;
                    s.spikes[i] = r;
                }
            }
            s.gameObject.SetActive(true);
            live.Add(s);
            return s;
        }

        void Place(int i, Vector3 p, Vector3 outDir, float lean, float size)
        {
            var axis = (Vector3.up * Mathf.Cos(lean) + outDir * Mathf.Sin(lean)).normalized;
            var t = spikes[i].transform;
            t.SetPositionAndRotation(p + Vector3.down * 0.05f, Quaternion.FromToRotation(Vector3.up, axis) * Quaternion.Euler(0, Random.value * 72f, 0));
            full[i] = new Vector3(0.16f, 0.7f, 0.16f) * size;
            t.localScale = full[i] * 0.01f;
        }

        void Begin(int n, float dur)
        {
            count = n;
            duration = Mathf.Max(0.3f, dur);
            // Three.js：0.45 / 0.75 处开始缩回
            hold = duration * 0.6f;
            age = 0;
            for (int i = 0; i < MaxSpikes; i++) spikes[i].gameObject.SetActive(i < count);
            Write(1);
        }

        void Write(float alpha)
        {
            block.SetVector(ParamsId, new Vector4(alpha, 1, 0, 0.25f));
            block.SetColor(BaseColorId, new Color(0.68f, 0.9f, 1f, 2.4f));
            for (int i = 0; i < count; i++) spikes[i].SetPropertyBlock(block);
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= duration)
            {
                gameObject.SetActive(false);
                live.Remove(this);
                pool.Push(this);
                return;
            }
            float up = Mathf.Clamp01(age / 0.12f);
            float down = Mathf.Clamp01((age - hold) / Mathf.Max(0.05f, duration - hold));
            float grow = up * (2 - up) * (1 + 0.12f * Mathf.Sin(up * Mathf.PI)) * (1 - down);
            for (int i = 0; i < count; i++)
            {
                var f = full[i];
                spikes[i].transform.localScale = new Vector3(Mathf.Max(0.01f, f.x * grow), Mathf.Max(0.01f, f.y * grow * (1 - 0.6f * down)), Mathf.Max(0.01f, f.z * grow));
            }
            Write(1 - down * down);
        }
    }
}
