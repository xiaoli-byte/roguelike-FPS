using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 移动特效（Three.js PlayerController：冲刺时身后扬起气流、二段跳脚下一圈英雄色的环 + 火星）：
    ///   冲刺：视线前方一圈拉长的风痕迎面掠过（第一人称看得见；Three.js 的「身后气流」在第一人称里看不到）+ 脚下一小团扬尘；
    ///   二段跳：脚下英雄色的扩散环 + 一小撮火星；
    ///   落地：按下落速度扬起一圈尘土（≥ 6 m/s 才有，越重越大），重落地另加一个扩散环。
    /// 两个池化的粒子系统，运行时生成材质（F1 的 FxPreset 落地后换成预设）。镜头的冲刺 FOV 冲击、落地下沉归 CameraFeel（F3）。
    /// PlayerVitals 在 Awake 里确保它挂在玩家身上。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MovementFx : MonoBehaviour
    {
        /// <summary>英雄主题色（二段跳的环）：没设时读 HeroSkills 的英雄</summary>
        public Color accent = new(1f, 0.62f, 0.3f);
        public Color dustColor = new(0.78f, 0.68f, 0.55f, 0.55f);
        public Color windColor = new(0.91f, 0.95f, 1f, 0.5f);

        PlayerMotor motor;
        ParticleSystem streaks, dust;
        bool accentResolved;

        void Awake()
        {
            motor = GetComponent<PlayerMotor>();
        }

        void OnEnable()
        {
            if (!motor) return;
            motor.Dashed += OnDashed;
            motor.Jumped += OnJumped;
            motor.Landed += OnLanded;
        }

        void OnDisable()
        {
            if (!motor) return;
            motor.Dashed -= OnDashed;
            motor.Jumped -= OnJumped;
            motor.Landed -= OnLanded;
        }

        void OnDestroy()
        {
            if (streaks) Destroy(streaks.gameObject);
            if (dust) Destroy(dust.gameObject);
        }

        Vector3 Feet => transform.position;

        Vector3 EyePos => motor && motor.eye ? motor.eye.position : transform.position + Vector3.up * 1.62f;

        void OnDashed()
        {
            Ensure();
            var dir = motor.DashDirection;
            if (dir.sqrMagnitude < 1e-4f) dir = transform.forward;
            // 风痕：在视线前方 2–5 m、偏离视轴 0.6–1.6 m 的一圈点上生成，逆着冲刺方向飞过镜头
            var eye = EyePos;
            var right = Vector3.Cross(Vector3.up, dir).normalized;
            for (int i = 0; i < 14; i++)
            {
                float a = Random.value * Mathf.PI * 2, r = Random.Range(0.6f, 1.6f);
                var p = eye + dir * Random.Range(2f, 5f) + right * (Mathf.Cos(a) * r) + Vector3.up * (Mathf.Sin(a) * r * 0.7f);
                Emit(streaks, p, -dir * Random.Range(26f, 34f), windColor, Random.Range(0.035f, 0.06f), Random.Range(0.14f, 0.22f));
            }
            // 脚下扬尘（在地上冲刺时）
            if (motor.Grounded)
                for (int i = 0; i < 8; i++)
                {
                    var v = (-dir * Random.Range(1.5f, 3.5f) + Random.insideUnitSphere * 1.2f);
                    v.y = Mathf.Abs(v.y) * 0.6f + 0.4f;
                    Emit(dust, Feet - dir * 0.4f + Vector3.up * 0.1f, v, dustColor, Random.Range(0.25f, 0.45f), Random.Range(0.35f, 0.6f));
                }
        }

        void OnJumped(bool air)
        {
            if (!air) return;
            Ensure();
            var c = Accent();
            Telegraph.Wave(Feet + Vector3.up * 0.05f, 1.3f, 6f, new Color(c.r, c.g, c.b, 0.85f));
            for (int i = 0; i < 10; i++)
            {
                var v = Random.insideUnitSphere * 3f;
                v.y = -Mathf.Abs(v.y) - 0.5f;
                Emit(streaks, Feet + Vector3.up * 0.05f, v, new Color(c.r, c.g, c.b, 0.9f), 0.05f, 0.35f);
            }
        }

        void OnLanded(float fall)
        {
            if (fall < 6f) return;
            Ensure();
            float k = Mathf.Clamp01((fall - 6f) / 14f);
            int n = Mathf.RoundToInt(Mathf.Lerp(8, 22, k));
            for (int i = 0; i < n; i++)
            {
                float a = i / (float)n * Mathf.PI * 2 + Random.value * 0.3f;
                var outDir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var v = outDir * Random.Range(2f, 4f + 3f * k) + Vector3.up * Random.Range(0.3f, 1.2f);
                Emit(dust, Feet + outDir * 0.3f + Vector3.up * 0.08f, v, dustColor, Random.Range(0.3f, 0.55f + 0.3f * k), Random.Range(0.45f, 0.8f));
            }
            if (fall >= 14f) Telegraph.Wave(Feet + Vector3.up * 0.04f, 1.6f + 1.2f * k, 9f, new Color(dustColor.r, dustColor.g, dustColor.b, 0.7f));
        }

        Color Accent()
        {
            if (!accentResolved)
            {
                accentResolved = true;
                var skills = GetComponent<HeroSkills>();
                var hero = skills ? HeroLibrary.Get(skills.heroId) : null;
                if (hero != null) accent = hero.color;
            }
            return accent;
        }

        static void Emit(ParticleSystem ps, Vector3 pos, Vector3 vel, Color c, float size, float life)
        {
            var e = new ParticleSystem.EmitParams
            {
                position = pos, velocity = vel, startColor = c, startSize = size, startLifetime = life, applyShapeToPosition = false,
            };
            ps.Emit(e, 1);
        }

        void Ensure()
        {
            if (!streaks) streaks = Make("Dash Streaks", true, ParticleSystemRenderMode.Stretch, 0f);
            if (!dust) dust = Make("Move Dust", false, ParticleSystemRenderMode.Billboard, 0.35f);
        }

        /// <summary>世界空间、不自动发射的粒子池：只靠 Emit(EmitParams) 一颗颗发</summary>
        static ParticleSystem Make(string name, bool additive, ParticleSystemRenderMode mode, float gravity)
        {
            var go = new GameObject(name);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = false;
            main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = gravity;
            main.maxParticles = 300;
            var em = ps.emission;
            em.enabled = false;
            var shape = ps.shape;
            shape.enabled = false;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(additive ? 1 : 0.9f, 0), new GradientAlphaKey(0, 1) });
            col.color = g;
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1, additive ? AnimationCurve.Linear(0, 1, 1, 0.6f) : AnimationCurve.Linear(0, 0.6f, 1, 1.6f));
            if (!additive)
            {
                var vel = ps.limitVelocityOverLifetime;
                vel.enabled = true;
                vel.limit = 0.5f;
                vel.dampen = 0.12f;
            }
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = mode;
            if (mode == ParticleSystemRenderMode.Stretch)
            {
                r.velocityScale = 0.05f;
                r.lengthScale = 1f;
            }
            var m = new Material(FxMaterials.Glow);
            if (!additive)
            {
                m.SetFloat("_Blend", 0);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            }
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return ps;
        }
    }
}
