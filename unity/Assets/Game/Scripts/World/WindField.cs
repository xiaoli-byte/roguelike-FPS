using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>某点的风（<see cref="WindField.Sample"/>）：水平单位风向 + 强度 0..1</summary>
    public struct WindSample
    {
        /// <summary>风吹去的方向（水平单位向量，y = 0）</summary>
        public Vector3 dir;
        /// <summary>强度 0..1（1 = 吸引点附近的狂风）</summary>
        public float strength;

        /// <summary>风向 × 强度</summary>
        public Vector3 Vector => dir * strength;

        public WindSample(Vector3 dir, float strength)
        {
            this.dir = dir;
            this.strength = strength;
        }
    }

    /// <summary>
    /// 风的吸引点（飞廉，combat 4.2；4-1 地图 2.5「整片盆地的风都吹向它」）：<see cref="strength"/> &gt; 0 往里吸、&lt; 0 往外推（飞廉一阶段从它那里往外推，
    /// 三阶段风眼往里吸）。<see cref="radius"/> 是能影响到的最远距离（远处只是轻轻偏过去），<see cref="core"/> 以内是满强度。
    /// 字段可以随时改（挪位置、反向、渐弱）；Dispose 撤掉。
    /// </summary>
    public sealed class WindAttractor : IDisposable
    {
        public Vector3 center;
        /// <summary>影响半径（米）：之外不受它影响</summary>
        public float radius = 260f;
        /// <summary>满强度半径（米）：之内几乎完全朝向 / 背向它</summary>
        public float core = 30f;
        /// <summary>强度（−1..1）：正 = 吸向它，负 = 从它往外推</summary>
        public float strength = 1f;
        public bool Active { get; private set; } = true;

        public void Dispose()
        {
            if (!Active) return;
            Active = false;
            WindField.Remove(this);
        }

        /// <summary>它在 p 处的影响程度 0..1（远 → 近 smoothstep）</summary>
        public float Weight(Vector3 p)
        {
            float d = new Vector2(p.x - center.x, p.z - center.z).magnitude;
            if (d >= radius) return 0;
            float t = Mathf.Clamp01((radius - d) / Mathf.Max(0.01f, radius - core));
            return t * t * (3 - 2 * t);
        }
    }

    /// <summary>
    /// 风场（第四章，docs/unity-ch4-port.md 第 2 节契约「天气与风」）：基础风向 + 吸引点（<see cref="WindAttractor"/>）；4-2 峡谷风顺河吹用 <see cref="Override"/>。
    ///   · 采样：<see cref="Sample"/> 给经幡、草、粒子、桑烟、风痕用（水平风向 + 强度 0..1）；越靠近吸引点风越强、方向越朝它（网页版 wind.ts windAt）。
    ///   · 基础风：没设 <see cref="BaseDir"/> 时读 <see cref="WeatherDirector"/> 的盛行风（windDir / baseWind），都没有时为 (−0.82, −0.57) × 0.25。
    ///   · 推玩家：<see cref="PlayerPush"/>（m/s²，0 = 不推）× 玩家处的风强沿风向持续推；顺风走快、逆风走慢 <see cref="PlayerSpeedK"/>（飞廉擂台 0.25）。
    ///   · 着色器：每帧写全局 <c>_WindAttract</c>（xyz = 最强吸引点中心，w = 半径；没有时 w = 0），配合 WeatherDirector 写的 <c>_WindDir</c>。
    /// 换关时清空吸引点、覆盖和推力。
    /// </summary>
    public static class WindField
    {
        static readonly List<WindAttractor> attractors = new();
        static readonly Vector2 FallbackDir = new(-0.82f, -0.57f);
        const float FallbackStrength = 0.25f;

        /// <summary>基础风向（XZ，风吹去的方向；null = 读天气导演）</summary>
        public static Vector2? BaseDir;
        /// <summary>基础风强 0..1（null = 读天气导演）</summary>
        public static float? BaseStrength;
        /// <summary>整张图的风场覆盖（4-2 峡谷风）：给了就不再按基础风 + 吸引点算</summary>
        public static Func<Vector3, WindSample> Override;
        /// <summary>推玩家的加速度（m/s²，乘玩家处的风强；0 = 不推）</summary>
        public static float PlayerPush;
        /// <summary>顺风走快 / 逆风走慢的比例（0.25 = ±25%，乘风强；0 = 不影响步速）</summary>
        public static float PlayerSpeedK;

        /// <summary>场上的吸引点</summary>
        public static IReadOnlyList<WindAttractor> Attractors => attractors;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Reset();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook() => GameEvents.StageLoaded += OnStageLoaded;

        static void OnStageLoaded(StageSpec s) => Reset();

        /// <summary>清空吸引点、覆盖、推力、基础风（换关；测试）</summary>
        public static void Reset()
        {
            foreach (var a in attractors.ToArray()) a.Dispose();
            attractors.Clear();
            BaseDir = null;
            BaseStrength = null;
            Override = null;
            PlayerPush = 0;
            PlayerSpeedK = 0;
        }

        /// <summary>加一个吸引点（strength 正 = 吸、负 = 推）；返回它，改字段即时生效，Dispose 撤掉</summary>
        public static WindAttractor AddAttractor(Vector3 center, float radius, float strength = 1f, float core = 30f)
        {
            var a = new WindAttractor { center = center, radius = Mathf.Max(1f, radius), core = Mathf.Clamp(core, 0, Mathf.Max(1f, radius) - 0.5f), strength = strength };
            attractors.Add(a);
            WindRunner.Ensure();
            return a;
        }

        internal static void Remove(WindAttractor a) => attractors.Remove(a);

        /// <summary>基础风（水平单位风向 + 强度）</summary>
        public static WindSample Base
        {
            get
            {
                var w = WeatherDirector.Instance;
                var d = BaseDir ?? (w ? w.windDir : FallbackDir);
                float s = BaseStrength ?? (w ? w.baseWind : FallbackStrength);
                var v = d.sqrMagnitude > 1e-6f ? d.normalized : FallbackDir.normalized;
                return new WindSample(new Vector3(v.x, 0, v.y), Mathf.Clamp01(s));
            }
        }

        /// <summary>
        /// p 处的风：有 <see cref="Override"/> 用它；否则基础风按各吸引点的影响程度往「朝向 / 背向吸引点」偏（近处几乎完全偏过去），
        /// 强度取基础风强与各吸引点 |strength| × 影响程度的较大者
        /// </summary>
        public static WindSample Sample(Vector3 p)
        {
            if (Override != null)
            {
                var o = Override(p);
                o.dir.y = 0;
                o.dir = o.dir.sqrMagnitude > 1e-6f ? o.dir.normalized : Base.dir;
                o.strength = Mathf.Clamp01(o.strength);
                return o;
            }
            var b = Base;
            var dir = b.dir;
            float strength = b.strength;
            foreach (var a in attractors)
            {
                if (a == null || !a.Active || a.strength == 0) continue;
                float w = a.Weight(p);
                if (w <= 0) continue;
                var to = new Vector3(a.center.x - p.x, 0, a.center.z - p.z);
                float d = to.magnitude;
                if (d < 1e-3f) continue;
                to /= d;
                if (a.strength < 0) to = -to;
                float k = Mathf.Min(1, w * 1.6f);
                dir = Vector3.Lerp(dir, to, k);
                strength = Mathf.Max(strength, Mathf.Abs(a.strength) * w);
            }
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-6f ? dir.normalized : b.dir;
            return new WindSample(dir, Mathf.Clamp01(strength));
        }

        /// <summary>
        /// 给粒子（桑烟、风痕、雪尘）加风：在粒子系统的位置采样，写 Force over Lifetime（世界空间，m/s² = 风向 × 强度 × gain）。
        /// 每帧或每隔几帧调一次即可；粒子系统没开 forceOverLifetime 时自动打开
        /// </summary>
        public static void ApplyTo(ParticleSystem ps, float gain = 6f)
        {
            if (!ps) return;
            var w = Sample(ps.transform.position);
            var f = ps.forceOverLifetime;
            if (!f.enabled) f.enabled = true;
            f.space = ParticleSystemSimulationSpace.World;
            var v = w.Vector * gain;
            f.x = new ParticleSystem.MinMaxCurve(v.x);
            f.y = new ParticleSystem.MinMaxCurve(0);
            f.z = new ParticleSystem.MinMaxCurve(v.z);
        }

        /// <summary>
        /// 经幡 / 草这类摆动物件的偏转：返回风向上的摆幅（0..1，= 强度 × (0.75 + 0.25 × 阵风)），阵风用位置错开相位，一片经幡不会齐刷刷一起摆
        /// </summary>
        public static float Sway(Vector3 at, float time)
        {
            var w = Sample(at);
            float gust = Mathf.Sin(time * 1.7f + at.x * 0.11f + at.z * 0.07f) * 0.5f + Mathf.Sin(time * 3.9f + at.z * 0.23f) * 0.5f;
            return Mathf.Clamp01(w.strength * (0.75f + 0.25f * gust));
        }

        /// <summary>最强的吸引点（着色器用）；没有为 null</summary>
        public static WindAttractor Strongest
        {
            get
            {
                WindAttractor best = null;
                foreach (var a in attractors)
                    if (a != null && a.Active && (best == null || Mathf.Abs(a.strength) > Mathf.Abs(best.strength)))
                        best = a;
                return best;
            }
        }

        /// <summary>
        /// 玩家步速倍率：顺风 1 + k × 风强 × cos，逆风 1 − …（k = <see cref="PlayerSpeedK"/>；moveDir 是玩家想走的水平方向）
        /// </summary>
        public static float SpeedMult(Vector3 at, Vector3 moveDir)
        {
            if (!(PlayerSpeedK > 0)) return 1f;
            moveDir.y = 0;
            if (moveDir.sqrMagnitude < 1e-4f) return 1f;
            var w = Sample(at);
            return Mathf.Max(0.2f, 1 + PlayerSpeedK * w.strength * Vector3.Dot(moveDir.normalized, w.dir));
        }
    }

    /// <summary>风场的每帧工作（<see cref="WindField"/> 有吸引点 / 推力时挂到 Fx 根物体上）：推玩家、改步速、写着色器全局量</summary>
    public sealed class WindRunner : MonoBehaviour
    {
        static readonly int AttractId = Shader.PropertyToID("_WindAttract");
        static WindRunner instance;
        IDisposable speedMod;
        PlayerMotor motor;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => instance = null;

        internal static void Ensure()
        {
            if (instance) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            instance = rt.gameObject.GetComponent<WindRunner>();
            if (!instance) instance = rt.gameObject.AddComponent<WindRunner>();
        }

        void OnDestroy()
        {
            speedMod?.Dispose();
            if (instance == this) instance = null;
        }

        void Update()
        {
            var a = WindField.Strongest;
            Shader.SetGlobalVector(AttractId, a != null ? new Vector4(a.center.x, a.center.y, a.center.z, a.radius * Mathf.Sign(a.strength)) : Vector4.zero);
            var vitals = PlayerVitals.Instance;
            var m = vitals ? vitals.GetComponent<PlayerMotor>() : null;
            if (m != motor)
            {
                speedMod?.Dispose();
                speedMod = null;
                motor = m;
            }
            if (!motor || vitals.Dead) return;
            if (WindField.PlayerSpeedK > 0 && speedMod == null)
                speedMod = motor.AddModifier((ref MotorFrame f) => f.speedMult *= WindField.SpeedMult(motor.transform.position, f.velocity));
            else if (!(WindField.PlayerSpeedK > 0) && speedMod != null)
            {
                speedMod.Dispose();
                speedMod = null;
            }
            if (WindField.PlayerPush > 0 && !motor.Dashing)
            {
                var w = WindField.Sample(motor.transform.position);
                motor.AddImpulse(w.dir * (WindField.PlayerPush * w.strength * Time.deltaTime));
            }
        }
    }
}
