using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 震屏前端（Three.js 版 fx.shake + 各敌人的 quake；docs/unity-parity.md 3.13 / F3）：调用方只说「多强、多久」，
    /// 真正把抖动写到镜头上的是 <see cref="CameraFeel"/>（渲染姿态的唯一写入方；瞄准用的 motor.eye 不抖，所以震屏不影响弹道）。
    /// trauma 模型：强度 s（0–1.2，同以前的数值：1 ≈ 很强）换算成 trauma = √(s / 1.2)；每个来源占一个「声部」，trauma 在 duration 内线性降到 0，
    /// 画面幅度 ∝ trauma²（开头猛、收尾柔）。单个来源时 <see cref="Current"/> 就等于传进来的强度。
    /// 多个来源：最强的那个 + 其余之和 × 0.35（叠起来更凶，但不会翻倍），上限 1。
    /// 0.06 s 内的连续调用（同一次爆炸被两处各报一遍、每帧调用的持续震动）并进同一个声部、取较强者（同 Three.js 的「取 max」）。
    /// 设置「震屏强度」由 CameraFeel 出画面时乘上（0 = 关掉）；这里存原始强度。
    /// </summary>
    public static class CameraShake
    {
        /// <summary>强度上限（= trauma 1）</summary>
        public const float MaxStrength = 1.2f;
        /// <summary>单次最长时长（秒）</summary>
        public const float MaxTime = 1.5f;
        const int VoiceCount = 8;
        const float MergeWindow = 0.06f, StackShare = 0.35f;

        struct Voice
        {
            public float trauma, start, length;

            public readonly float Level(float now)
            {
                if (!(length > 0)) return 0;
                float age = now - start;
                return age < 0 || age >= length ? 0 : trauma * (1 - age / length);
            }
        }

        static readonly Voice[] voices = new Voice[VoiceCount];
        static int latest = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Clear();

        /// <summary>清掉所有震动（换关、传送）</summary>
        public static void Clear()
        {
            for (int i = 0; i < VoiceCount; i++) voices[i] = default;
            latest = -1;
        }

        /// <summary>当前 trauma（0–1）：最强声部 + 其余之和 × 0.35</summary>
        public static float Trauma
        {
            get
            {
                float now = Time.time, max = 0, sum = 0;
                for (int i = 0; i < VoiceCount; i++)
                {
                    float l = voices[i].Level(now);
                    if (l <= 0) continue;
                    sum += l;
                    if (l > max) max = l;
                }
                return Mathf.Min(1, max + (sum - max) * StackShare);
            }
        }

        /// <summary>当前抖动强度（与 <see cref="Add"/> 的 strength 同单位 = trauma² × 1.2）</summary>
        public static float Current
        {
            get
            {
                float t = Trauma;
                return t * t * MaxStrength;
            }
        }

        /// <summary>震一下：strength 0–1.2（0.25 ≈ 护盾被打空，0.5 ≈ 近处爆炸，0.9 ≈ 首领砸地），duration 秒（≤ 1.5）</summary>
        public static void Add(float strength, float duration = 0.3f)
        {
            if (!(strength > 0) || !(duration > 0)) return;
            AddTrauma(Mathf.Sqrt(Mathf.Min(strength, MaxStrength) / MaxStrength), duration);
        }

        /// <summary>直接按 trauma（0–1）加一个声部</summary>
        public static void AddTrauma(float trauma, float duration = 0.3f)
        {
            // NaN / 负数直接丢掉：写进镜头会让整个画面消失
            if (!(trauma > 0) || !(duration > 0)) return;
            trauma = Mathf.Min(1, trauma);
            duration = Mathf.Min(duration, MaxTime);
            float now = Time.time;

            // 刚开始不久的声部：并进去（取较强者、时长取较长的剩余）
            if (latest >= 0)
            {
                ref var v = ref voices[latest];
                float age = now - v.start;
                if (age >= 0 && age < MergeWindow && age < v.length)
                {
                    v.trauma = Mathf.Max(v.Level(now), trauma);
                    v.length = Mathf.Max(v.length - age, duration);
                    v.start = now;
                    return;
                }
            }

            // 找空位；满了就顶掉现在最弱的（比新来的还强就不加了）
            int slot = -1;
            float weakest = float.MaxValue;
            for (int i = 0; i < VoiceCount; i++)
            {
                float l = voices[i].Level(now);
                if (l <= 0)
                {
                    slot = i;
                    break;
                }
                if (l < weakest)
                {
                    weakest = l;
                    slot = i;
                }
            }
            if (slot < 0 || (voices[slot].Level(now) > 0 && weakest >= trauma)) return;
            voices[slot] = new Voice { trauma = trauma, start = now, length = duration };
            latest = slot;
        }

        /// <summary>以 at 为中心的震动：玩家离得越远越弱（线性），range 米外没有</summary>
        public static void Quake(Vector3 at, float strength, float range, float duration = 0.3f)
        {
            var p = PlayerVitals.Instance;
            if (!p || !(range > 0)) return;
            var d = p.transform.position - at;
            d.y = 0;
            float k = Mathf.Clamp01(1 - d.magnitude / range);
            if (k > 0) Add(strength * k, duration);
        }
    }
}
