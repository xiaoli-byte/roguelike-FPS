using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>章节主题（环境氛围用；Desert / Frost / Inferno 同 WeatherDirector.theme）</summary>
    public enum EnvTheme
    {
        None,
        Desert,
        Frost,
        Inferno,
    }

    /// <summary>
    /// 一关的空气粒子（D 路；<see cref="EnvFxHost"/> 进关后按主题挂上，跟关卡场景一起卸载；按 docs/art/fx-style.md：数量少、个头大一点、动得慢，颜色跟章节底色）。全部绕着相机前方发、走共享发射器（<see cref="FxEnvStyles"/> 的 Env 风格），
    /// 数量 = 每秒颗数 × 画质密度 × 战斗余量（<see cref="EnvParticles.Headroom"/>：同屏粒子多了先停氛围），离相机 1.5 m 以内不发——不挡准星、不糊屏：
    ///   第一章沙漠：阳光里的浮尘（小暖色亮点慢慢飘）；隔 10–20 s 一阵贴地掠过的沙帘（沙丝 + 淡沙雾，顺风扫过玩家前方，区域沙暴进行时不出）；
    ///   第二章冰原：轻飘雪（顺风斜落）、空气里一闪一闪的冰晶、脚边冰面 / 雪面上的反光点；
    ///   第三章火狱：慢慢上升的余烬、零星的落灰（3-1 的周期落灰仍由天气导演管）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvAmbience : MonoBehaviour
    {
        public EnvTheme theme;

        /// <summary>每秒颗数（画质高、余量满时）</summary>
        public const float MoteRate = 7f, SnowRate = 20f, AirGlintRate = 3.5f, GroundGlintRate = 5f, EmberRate = 8f, AshRate = 3f;
        public const float GustMin = 10f, GustMax = 20f, GustSeconds = 2.8f, GustRate = 120f;

        static readonly int WindDirId = Shader.PropertyToID("_WindDir");

        public static EnvAmbience Current { get; private set; }
        /// <summary>累计发出的颗数 / 刮过的沙帘（测试用）</summary>
        public int Emitted { get; private set; }
        public int Gusts { get; private set; }
        /// <summary>正在刮沙帘</summary>
        public bool Gusting => gustT >= 0;

        float moteDebt, snowDebt, airDebt, groundDebt, emberDebt, ashDebt, gustDebt, dustDebt;
        float nextGust = -1, gustT = -1;
        Vector3 gustDir, gustSide, gustOrigin;
        uint seed = 0x9E3779B9u;

        void OnEnable() => Current = this;

        void OnDisable()
        {
            if (Current == this) Current = null;
        }

        /// <summary>立刻刮一阵沙帘（调试 / 测试）</summary>
        public void ForceGust() => nextGust = Time.time;

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0 || theme == EnvTheme.None) return;
            var cam = Camera.main;
            if (!cam) return;
            var eye = cam.transform.position;
            var fwd = cam.transform.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            fwd.Normalize();
            var right = new Vector3(fwd.z, 0, -fwd.x);
            var w4 = Shader.GetGlobalVector(WindDirId);
            var wind = new Vector3(w4.x, 0, w4.y);
            if (wind.sqrMagnitude < 1e-4f) wind = Vector3.right;
            wind.Normalize();
            float windK = Mathf.Clamp01(w4.z);
            float k = Fx.Density * EnvParticles.Headroom * dt;

            switch (theme)
            {
                case EnvTheme.Desert:
                    Motes(eye, fwd, right, wind, windK, k);
                    Gust(eye, fwd, wind, windK, dt);
                    break;
                case EnvTheme.Frost:
                    Snow(eye, fwd, wind, windK, k);
                    AirGlints(eye, fwd, right, k);
                    GroundGlints(eye, fwd, right, k);
                    break;
                case EnvTheme.Inferno:
                    Embers(eye, fwd, right, wind, windK, k);
                    Ash(eye, fwd, wind, windK, k);
                    break;
            }
        }

        // ───────────── 第一章 ─────────────

        void Motes(Vector3 eye, Vector3 fwd, Vector3 right, Vector3 wind, float windK, float k)
        {
            int n = Take(ref moteDebt, MoteRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = InView(eye, fwd, right, 2f, 13f, -1.2f, 2.6f);
                var v = wind * (0.1f + 0.25f * windK) + new Vector3(R(-0.08f, 0.08f), R(-0.03f, 0.06f), R(-0.08f, 0.08f));
                Emit("EnvMote", p, v, R(0.1f, 0.18f), R(3.5f, 5f), FxEnvStyles.Mote);
            }
        }

        /// <summary>沙帘：上风处一条横线（垂直风向、宽 30 m）不停往下风方向发沙丝，扫过玩家前方 6–16 m 的地面，贴地 0–1.6 m 高</summary>
        void Gust(Vector3 eye, Vector3 fwd, Vector3 wind, float windK, float dt)
        {
            float now = Time.time;
            if (nextGust < 0) nextGust = now + R(4f, 9f);
            if (gustT < 0)
            {
                if (now < nextGust) return;
                nextGust = now + R(GustMin, GustMax);
                // 区域沙暴正在刮、或者战斗特效正多：这一阵不刮
                if (WeatherDirector.StormAt(eye) > 0.15f || EnvParticles.Headroom < 0.5f) return;
                gustT = 0;
                Gusts++;
                gustDir = wind;
                gustSide = new Vector3(wind.z, 0, -wind.x);
                // 扫过玩家前方：横线的中点放在「玩家前方 10 m」往上风退 14 m
                gustOrigin = eye + fwd * R(6f, 14f) - gustDir * 14f;
            }
            gustT += dt;
            if (gustT > GustSeconds)
            {
                gustT = -1;
                return;
            }
            float env = Mathf.Sin(Mathf.Clamp01(gustT / GustSeconds) * Mathf.PI);
            float k = Fx.Density * EnvParticles.Headroom * dt * env;
            int n = Take(ref gustDebt, GustRate * k);
            float speed = 9f + 5f * windK;
            for (int i = 0; i < n; i++)
            {
                var p = gustOrigin + gustSide * R(-15f, 15f) + gustDir * R(-2f, 2f);
                // 会从镜头上擦过去的那几条不发（贴脸的沙丝会变成横过屏幕的大白弧）
                if (Mathf.Abs(Vector3.Dot(p - eye, gustSide)) < 5f) continue;
                float g = Ground(p, eye.y);
                // 打到屋顶、墙头上的不发（沙帘贴着地面走）
                if (g > eye.y + 0.5f) continue;
                p.y = g + R(0.05f, 1.6f) * R(0.3f, 1f);
                var v = gustDir * speed * R(0.8f, 1.2f) + new Vector3(0, R(-0.2f, 0.5f), 0);
                Emit("EnvSand", p, v, R(0.12f, 0.24f), R(1.6f, 2.4f), FxEnvStyles.Sand);
            }
            // 淡淡的沙雾垫在沙丝下面（普通混合的尘团，贴地、很淡）
            int m = Take(ref dustDebt, 16f * k);
            for (int i = 0; i < m; i++)
            {
                var p = gustOrigin + gustSide * R(-14f, 14f);
                if (Mathf.Abs(Vector3.Dot(p - eye, gustSide)) < 7f) continue;
                float g = Ground(p, eye.y);
                if (g > eye.y + 0.5f) continue;
                p.y = g + R(0.2f, 0.8f);
                Emit("Dust", p, gustDir * speed * R(0.6f, 0.9f), R(0.8f, 1.4f), R(1.6f, 2.4f), FxEnvStyles.SandVeil);
            }
        }

        // ───────────── 第二章 ─────────────

        void Snow(Vector3 eye, Vector3 fwd, Vector3 wind, float windK, float k)
        {
            int n = Take(ref snowDebt, SnowRate * k);
            var drift = wind * (0.4f + 2.2f * windK);
            for (int i = 0; i < n; i++)
            {
                // 相机上方一个 28 × 28 m 的盒子（往前挪 6 m，顺风往上风挪：落到眼前时正好在视野里）
                var p = eye + fwd * 6f - drift * 6f + new Vector3(R(-14f, 14f), R(5f, 8f), R(-14f, 14f));
                var v = drift + new Vector3(R(-0.2f, 0.2f), R(-0.95f, -0.6f), R(-0.2f, 0.2f));
                Emit("EnvSnow", p, v, R(0.1f, 0.18f), R(8f, 11f), FxEnvStyles.Snow);
            }
        }

        void AirGlints(Vector3 eye, Vector3 fwd, Vector3 right, float k)
        {
            int n = Take(ref airDebt, AirGlintRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = InView(eye, fwd, right, 2.5f, 11f, -1f, 2.5f);
                Emit("EnvGlint", p, new Vector3(R(-0.04f, 0.04f), R(-0.06f, 0.02f), R(-0.04f, 0.04f)), R(0.12f, 0.2f), R(1.2f, 2f), FxEnvStyles.Glint);
            }
        }

        /// <summary>冰面 / 雪面上的反光点：前方 3–15 m 随机往下打射线，落在冰或雪上就在那一点闪一下</summary>
        void GroundGlints(Vector3 eye, Vector3 fwd, Vector3 right, float k)
        {
            int n = Take(ref groundDebt, GroundGlintRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = InView(eye, fwd, right, 3f, 15f, 0f, 0f);
                if (!Physics.Raycast(new Vector3(p.x, eye.y + 3f, p.z), Vector3.down, out var hit, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (Surfaces.Classify(in hit) != SurfaceKind.Ice) continue;
                Emit("EnvGlint", hit.point + hit.normal * 0.06f, Vector3.zero, R(0.16f, 0.26f), R(0.7f, 1.1f), FxEnvStyles.Glint);
            }
        }

        // ───────────── 第三章 ─────────────

        void Embers(Vector3 eye, Vector3 fwd, Vector3 right, Vector3 wind, float windK, float k)
        {
            int n = Take(ref emberDebt, EmberRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = InView(eye, fwd, right, 3f, 20f, -2.5f, 1.5f);
                var v = wind * (0.15f + 0.35f * windK) + new Vector3(R(-0.15f, 0.15f), R(0.25f, 0.6f), R(-0.15f, 0.15f));
                var c = Color.Lerp(FxEnvStyles.Ember, new Color(1f, 0.72f, 0.35f, 1f), R(0f, 0.4f));
                Emit("EnvEmber", p, v, R(0.07f, 0.12f), R(3.5f, 5.5f), c);
            }
        }

        void Ash(Vector3 eye, Vector3 fwd, Vector3 wind, float windK, float k)
        {
            int n = Take(ref ashDebt, AshRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = eye + fwd * 6f + new Vector3(R(-12f, 12f), R(4f, 7f), R(-12f, 12f));
                var v = wind * (0.3f + 0.8f * windK) + new Vector3(R(-0.2f, 0.2f), R(-0.9f, -0.5f), R(-0.2f, 0.2f));
                Emit("EnvAsh", p, v, R(0.07f, 0.12f), R(5f, 7f), FxEnvStyles.Ash);
            }
        }

        // ───────────── 工具 ─────────────

        /// <summary>相机前方的一块扇形里随机一点（水平 near..far 米，左右按距离张开 ±0.85 × 距离，高 yMin..yMax 相对眼高）</summary>
        Vector3 InView(Vector3 eye, Vector3 fwd, Vector3 right, float near, float far, float yMin, float yMax)
        {
            float d = Mathf.Lerp(near, far, Mathf.Sqrt(R(0f, 1f)));
            return eye + fwd * d + right * (R(-0.85f, 0.85f) * d) + Vector3.up * R(yMin, yMax);
        }

        static float Ground(Vector3 p, float fallback) =>
            Physics.Raycast(new Vector3(p.x, fallback + 8f, p.z), Vector3.down, out var h, 30f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : fallback - 1.6f;

        static int Take(ref float debt, float add)
        {
            debt = Mathf.Min(debt + add, 12f);
            int n = (int)debt;
            if (n <= 0) return 0;
            debt -= n;
            return FxBudget.Allow(n, false);
        }

        void Emit(string style, Vector3 p, Vector3 v, float size, float life, Color c)
        {
            if (EnvParticles.Emit(style, p, v, size, life, c)) Emitted++;
        }

        /// <summary>xorshift32：表现用，不占用对局随机数</summary>
        float R(float a, float b)
        {
            uint s = seed;
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            seed = s;
            return a + (b - a) * (s / 4294967296f);
        }
    }
}
