using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 射击特效：曳光（细长发光线段，0.06 s 淡出）、命中点火花 / 尘土（粒子池）、枪口闪光（点光源）。
    /// 全部池化，运行时生成材质，不依赖美术资产（之后可以换成正式特效）。
    /// </summary>
    public sealed class ShotFx : MonoBehaviour
    {
        public static ShotFx Instance { get; private set; }

        sealed class TracerLine
        {
            public LineRenderer line;
            public float life, max;
        }

        readonly List<TracerLine> tracers = new();
        ParticleSystem sparks, dust, blood;
        Light flash;
        float flashUntil;
        Material tracerMat;

        void Awake()
        {
            Instance = this;
            tracerMat = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit"));
            tracerMat.SetFloat("_Surface", 1);
            tracerMat.SetFloat("_Blend", 2); // additive
            tracerMat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            tracerMat.SetFloat("_DstBlend", (float)BlendMode.One);
            tracerMat.SetFloat("_ZWrite", 0);
            tracerMat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            tracerMat.renderQueue = (int)RenderQueue.Transparent;

            sparks = MakeBurst("Hit Sparks", new Color(1f, 0.82f, 0.45f), 0.06f, 9f, 0.25f, true);
            dust = MakeBurst("Hit Dust", new Color(0.78f, 0.64f, 0.48f, 0.8f), 0.18f, 2.5f, 0.6f, false);
            blood = MakeBurst("Hit Flesh", new Color(1f, 0.5f, 0.3f), 0.09f, 5f, 0.3f, true);

            flash = new GameObject("Muzzle Flash").AddComponent<Light>();
            flash.transform.SetParent(transform, false);
            flash.type = LightType.Point;
            flash.range = 6;
            flash.color = new Color(1f, 0.75f, 0.4f);
            flash.intensity = 0;
            flash.shadows = LightShadows.None;
        }

        ParticleSystem MakeBurst(string name, Color color, float size, float speed, float life, bool additive)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = false;
            main.playOnAwake = false;
            main.startLifetime = new ParticleSystem.MinMaxCurve(life * 0.6f, life);
            main.startSpeed = new ParticleSystem.MinMaxCurve(speed * 0.4f, speed);
            main.startSize = new ParticleSystem.MinMaxCurve(size * 0.6f, size);
            main.startColor = color;
            main.gravityModifier = additive ? 1.5f : 0.2f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = 400;
            var em = ps.emission;
            em.rateOverTime = 0;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 35;
            shape.radius = 0.02f;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(1, 0), new GradientAlphaKey(0, 1) });
            col.color = g;
            var r = go.GetComponent<ParticleSystemRenderer>();
            var m = new Material(tracerMat);
            if (!additive)
            {
                m.SetFloat("_Blend", 0);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            }
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            return ps;
        }

        public void Tracer(Vector3 from, Vector3 to, Color color, float width)
        {
            TracerLine t = null;
            foreach (var x in tracers)
                if (x.life <= 0) { t = x; break; }
            if (t == null)
            {
                var go = new GameObject("Tracer");
                go.transform.SetParent(transform, false);
                var lr = go.AddComponent<LineRenderer>();
                lr.sharedMaterial = tracerMat;
                lr.positionCount = 2;
                lr.shadowCastingMode = ShadowCastingMode.Off;
                lr.receiveShadows = false;
                lr.numCapVertices = 2;
                t = new TracerLine { line = lr };
                tracers.Add(t);
            }
            t.line.enabled = true;
            t.line.SetPosition(0, from);
            t.line.SetPosition(1, to);
            t.line.startWidth = width * 0.6f;
            t.line.endWidth = width;
            t.line.startColor = new Color(color.r, color.g, color.b, 0);
            t.line.endColor = color;
            t.max = t.life = 0.06f;
        }

        public void Impact(Vector3 point, Vector3 normal, bool flesh, float size = 1f)
        {
            var ps = flesh ? blood : sparks;
            Emit(ps, point, normal, Mathf.RoundToInt((flesh ? 6 : 8) * size));
            if (!flesh) Emit(dust, point, normal, Mathf.RoundToInt(3 * size));
        }

        static void Emit(ParticleSystem ps, Vector3 point, Vector3 normal, int count)
        {
            ps.transform.SetPositionAndRotation(point + normal * 0.02f, Quaternion.LookRotation(normal));
            ps.Emit(count);
        }

        public void MuzzleFlash(Vector3 at, float strength)
        {
            flash.transform.position = at;
            flash.intensity = 6f * strength;
            flashUntil = Time.time + 0.045f;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            foreach (var t in tracers)
            {
                if (t.life <= 0) continue;
                t.life -= dt;
                if (t.life <= 0)
                {
                    t.line.enabled = false;
                    continue;
                }
                float a = t.life / t.max;
                var c = t.line.endColor;
                t.line.endColor = new Color(c.r, c.g, c.b, a);
            }
            if (Time.time > flashUntil) flash.intensity = 0;
        }
    }
}
