using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 水面涟漪与扰动（D 路）：一张全场共用的涟漪表，每帧把最多 <see cref="MaxRings"/> 道正在扩散的涟漪写进全局 _SFRipple[]
    /// （x, z, 当前半径, 振幅），Spiritfire/Water 着色器按它在所有水面上画出一圈圈波峰 / 波谷和波峰上的白沫——水面网格不用知道谁在扰动它。
    ///   <see cref="Disturb"/>：一下（三道涟漪 + 白沫 + 水花水雾）；<see cref="Churn"/>：持续翻涌（一阵阵冒泡、小涟漪、水雾），句柄可取消 / 挪动；
    ///   <see cref="Ripple"/>：只荡一道涟漪（涉水、落物，不带水花）。
    /// 水花和水雾走共享发射器（Drop / Powder 风格），受 <see cref="FxBudget"/> 管。换关清场。
    /// </summary>
    public static class EnvWater
    {
        public const int MaxRings = 8;

        static readonly int RippleId = Shader.PropertyToID("_SFRipple"), RippleCountId = Shader.PropertyToID("_SFRippleCount");
        public static readonly Color Spray = new(0.84f, 0.94f, 1f, 0.9f), Foam = new(0.92f, 0.97f, 1f, 0.75f);

        struct Ring
        {
            public float x, z, born, speed, maxR, amp;
        }

        static readonly List<Ring> rings = new();
        static readonly Vector4[] packed = new Vector4[MaxRings];
        static readonly List<ChurnSlot> churns = new();
        static readonly Stack<ChurnSlot> freeChurns = new();
        static int shownCount = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            rings.Clear();
            churns.Clear();
            freeChurns.Clear();
            shownCount = -1;
        }

        /// <summary>正在扩散的涟漪数（测试用）</summary>
        public static int RingCount => rings.Count;
        /// <summary>正在翻涌的水面数（测试用）</summary>
        public static int ChurnCount => churns.Count;
        /// <summary>累计放出的涟漪数（测试用）</summary>
        public static int RingsSpawned { get; private set; }

        sealed class ChurnSlot : FxSlot
        {
            public Vector3 at;
            public float radius, strength, until, next;
            public int pendingRings;
            public float ringAt;

            public override void CancelFx()
            {
                until = Mathf.Min(until, Time.time);
                pendingRings = 0;
            }

            public override void MoveFx(Vector3 position)
            {
                if (Fx.Finite(position)) at = position;
            }
        }

        /// <summary>只荡一道涟漪：at 处，扩到 radius 米，振幅 amp（0..1.5），speed 米 / 秒（≤ 0 按半径取）</summary>
        public static void Ripple(Vector3 at, float radius, float amp = 0.6f, float speed = 0)
        {
            if (!Application.isPlaying || !Fx.Finite(at) || !(radius > 0.05f)) return;
            EnvFxHost.Ensure();
            radius = Mathf.Min(radius, 40f);
            if (!(speed > 0)) speed = Mathf.Clamp(1.6f + radius * 0.35f, 1.6f, 9f);
            if (rings.Count >= 24) rings.RemoveAt(0);
            rings.Add(new Ring { x = at.x, z = at.z, born = Time.time, speed = speed, maxR = radius, amp = Mathf.Clamp(amp, 0.05f, 1.5f) });
            RingsSpawned++;
        }

        /// <summary>水面扰动（一下）：见 <see cref="Fx.WaterDisturb"/></summary>
        public static FxHandle Disturb(Vector3 at, float radius, float strength)
        {
            if (!Application.isPlaying || !Fx.Finite(at)) return FxHandle.None;
            radius = Mathf.Clamp(Fx.Finite(radius) ? radius : 3f, 0.5f, 40f);
            strength = Mathf.Clamp(Fx.Finite(strength) ? strength : 1f, 0.1f, 2f);
            var s = Take(at, radius, strength, 0);
            s.pendingRings = 3;
            s.ringAt = Time.time;
            Splash(at, radius, strength);
            return new FxHandle(s);
        }

        /// <summary>水面持续翻涌：见 <see cref="Fx.WaterChurn"/></summary>
        public static FxHandle Churn(Vector3 at, float radius, float seconds, float strength)
        {
            if (!Application.isPlaying || !Fx.Finite(at) || !(seconds > 0)) return FxHandle.None;
            radius = Mathf.Clamp(Fx.Finite(radius) ? radius : 3f, 0.5f, 40f);
            strength = Mathf.Clamp(Fx.Finite(strength) ? strength : 1f, 0.1f, 2f);
            var s = Take(at, radius, strength, Mathf.Min(seconds, 60f));
            return new FxHandle(s);
        }

        static ChurnSlot Take(Vector3 at, float radius, float strength, float seconds)
        {
            EnvFxHost.Ensure();
            var s = freeChurns.Count > 0 ? freeChurns.Pop() : new ChurnSlot();
            s.Claim();
            s.at = at;
            s.radius = radius;
            s.strength = strength;
            s.until = Time.time + seconds;
            s.next = Time.time;
            s.pendingRings = 0;
            churns.Add(s);
            return s;
        }

        /// <summary>破水的水花：中心水柱般的水滴、四周的水雾、贴水面的一圈白沫</summary>
        static void Splash(Vector3 at, float radius, float strength)
        {
            float k = strength * Mathf.Sqrt(Mathf.Clamp(radius, 0.5f, 16f) / 3f);
            int drops = EnvParticles.Allow(Mathf.RoundToInt(10 + 26 * k));
            for (int i = 0; i < drops; i++)
            {
                var d = Random.insideUnitCircle;
                float up = Random.Range(2.5f, 6.5f) * Mathf.Sqrt(k);
                var v = new Vector3(d.x * Random.Range(1f, 3.2f) * Mathf.Sqrt(k), up, d.y * Random.Range(1f, 3.2f) * Mathf.Sqrt(k));
                var p = at + new Vector3(d.x, 0, d.y) * radius * 0.25f;
                EnvParticles.Emit("Drop", p, v, Random.Range(0.07f, 0.16f) * Mathf.Clamp(k, 0.6f, 2f), Random.Range(0.6f, 1.1f), Spray);
            }
            int mist = EnvParticles.Allow(Mathf.RoundToInt(4 + 8 * k));
            for (int i = 0; i < mist; i++)
            {
                var d = Random.insideUnitCircle;
                var p = at + new Vector3(d.x, 0.1f, d.y) * radius * 0.45f;
                EnvParticles.Emit("Powder", p, new Vector3(d.x * 1.2f, Random.Range(0.6f, 1.8f), d.y * 1.2f), Random.Range(0.6f, 1.2f) * Mathf.Clamp(k, 0.7f, 2.2f),
                    Random.Range(0.9f, 1.6f), Foam);
            }
            if (EnvParticles.Allow(1) > 0)
                EnvParticles.Emit("RingFlat", at + Vector3.up * 0.04f, Vector3.zero, Mathf.Max(0.8f, radius * 0.35f), 0.6f, new Color(0.8f, 0.92f, 1f, 0.7f));
        }

        /// <summary>每帧（<see cref="EnvFxHost"/>）：翻涌的冒泡 / 涟漪、涟漪表写进全局着色器数组</summary>
        internal static void Tick()
        {
            float now = Time.time;
            for (int i = churns.Count - 1; i >= 0; i--)
            {
                var s = churns[i];
                if (s.pendingRings > 0 && now >= s.ringAt)
                {
                    // 一下扰动：三道涟漪先后荡开，一道比一道远、一道比一道弱
                    int n = 3 - s.pendingRings;
                    Ripple(s.at, s.radius * (1f + 0.35f * n), (0.9f - 0.22f * n) * Mathf.Min(1.4f, s.strength), 0);
                    s.pendingRings--;
                    s.ringAt = now + 0.22f + 0.1f * n;
                }
                if (now < s.until && now >= s.next)
                {
                    s.next = now + Random.Range(0.18f, 0.4f) / Mathf.Max(0.5f, s.strength);
                    var d = Random.insideUnitCircle * s.radius * 0.6f;
                    var p = s.at + new Vector3(d.x, 0, d.y);
                    Ripple(p, s.radius * Random.Range(0.35f, 0.7f), Random.Range(0.35f, 0.6f) * Mathf.Min(1.3f, s.strength), 0);
                    Bubble(p, s.strength);
                }
                if (s.pendingRings <= 0 && now >= s.until)
                {
                    s.active = false;
                    churns.RemoveAt(i);
                    freeChurns.Push(s);
                }
            }

            // 过期的涟漪
            for (int i = rings.Count - 1; i >= 0; i--)
            {
                var r = rings[i];
                if ((now - r.born) * r.speed > r.maxR * 1.15f) rings.RemoveAt(i);
            }
            int count = 0;
            // 新的优先（列表尾部是最新的）
            for (int i = rings.Count - 1; i >= 0 && count < MaxRings; i--)
            {
                var r = rings[i];
                float age = now - r.born;
                float rad = age * r.speed;
                float life01 = Mathf.Clamp01(rad / (r.maxR * 1.15f));
                float amp = r.amp * (1 - life01) * (1 - life01) * Mathf.Clamp01(age * 8f);
                packed[count++] = new Vector4(r.x, r.z, rad, amp);
            }
            for (int i = count; i < MaxRings; i++) packed[i] = Vector4.zero;
            if (count > 0 || shownCount != 0)
            {
                Shader.SetGlobalVectorArray(RippleId, packed);
                Shader.SetGlobalFloat(RippleCountId, count);
                shownCount = count;
            }
        }

        static void Bubble(Vector3 p, float strength)
        {
            int n = EnvParticles.Allow(Mathf.RoundToInt(2 + 3 * strength));
            for (int i = 0; i < n; i++)
            {
                var d = Random.insideUnitCircle * 0.6f;
                EnvParticles.Emit("Drop", p + new Vector3(d.x, 0.02f, d.y), new Vector3(d.x, Random.Range(1.2f, 2.8f) * Mathf.Sqrt(strength), d.y),
                    Random.Range(0.05f, 0.11f), Random.Range(0.35f, 0.6f), Spray);
            }
            if (EnvParticles.Allow(1) > 0)
                EnvParticles.Emit("Powder", p + Vector3.up * 0.15f, new Vector3(0, Random.Range(0.4f, 1f), 0), Random.Range(0.5f, 0.9f) * Mathf.Max(0.8f, strength),
                    Random.Range(0.8f, 1.3f), Foam);
        }

        /// <summary>换关清场</summary>
        internal static void Clear()
        {
            rings.Clear();
            foreach (var s in churns)
            {
                s.active = false;
                freeChurns.Push(s);
            }
            churns.Clear();
            for (int i = 0; i < MaxRings; i++) packed[i] = Vector4.zero;
            Shader.SetGlobalVectorArray(RippleId, packed);
            Shader.SetGlobalFloat(RippleCountId, 0);
            shownCount = 0;
        }
    }
}
