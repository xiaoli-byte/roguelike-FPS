using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 祭台的氛围粒子（U6；Three.js src/ui/heroPreview/ambience.ts 的飘升灵火 / 微尘，Shuriken 代替 CPU 粒子）：
    ///   · 灵火：自台顶一圈缓缓飘升、轻微扰动、淡入淡出的英雄色光点（每秒十几颗）；
    ///   · <see cref="Burst"/>：切换英雄时自台顶向上喷一把（「从光中升起」）。
    /// 粒子系统在代码里配（不存预制体），材质用特效的径向光晕（<see cref="FxMaterials.Glow"/>，加色、读顶点色）。不缩放时间：选英雄时时间照走，但主菜单也可能被暂停叠住。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StageAmbience : MonoBehaviour
    {
        [Tooltip("每秒飘升的灵火数")] public float rate = 14f;
        [Tooltip("发射圈半径（米）")] public float radius = 0.95f;

        ParticleSystem motes;
        Color color = Color.white;

        void Awake() => Build();

        /// <summary>建粒子系统（幂等）</summary>
        public void Build()
        {
            if (motes) return;
            var go = new GameObject("Motes");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(0, HeroAltar.Top + 0.05f, 0);
            go.transform.localRotation = Quaternion.Euler(-90, 0, 0);
            motes = go.AddComponent<ParticleSystem>();
            motes.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

            var main = motes.main;
            main.loop = true;
            main.playOnAwake = true;
            main.duration = 5f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(2.8f, 4.6f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(0.18f, 0.55f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.035f, 0.09f);
            main.maxParticles = 160;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.useUnscaledTime = true;
            main.gravityModifier = -0.02f;

            var emission = motes.emission;
            emission.rateOverTime = rate;

            var shape = motes.shape;
            // 圆锥沿 +Y（物体绕 X 转了 −90°）：自台顶外圈发射、几乎竖直往上飘
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 6f;
            shape.radius = radius;
            shape.radiusThickness = 0.3f;

            var noise = motes.noise;
            noise.enabled = true;
            noise.strength = 0.22f;
            noise.frequency = 0.6f;
            noise.scrollSpeed = 0.25f;

            var col = motes.colorOverLifetime;
            col.enabled = true;
            var grad = new Gradient();
            grad.SetKeys(
                new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(1, 0.18f), new GradientAlphaKey(0.75f, 0.7f), new GradientAlphaKey(0, 1) });
            col.color = grad;

            var size = motes.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.EaseInOut(0, 1, 1, 0.35f));

            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Billboard;
            r.sharedMaterial = FxMaterials.Glow;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            SetColor(color);
            motes.Play();
        }

        /// <summary>换颜色（英雄色；新发射的粒子用新颜色）</summary>
        public void SetColor(Color c)
        {
            color = c;
            if (!motes) return;
            var main = motes.main;
            var a = Color.Lerp(c, Color.white, 0.25f);
            var b = Color.Lerp(c, new Color(1f, 0.8f, 0.45f), 0.35f);
            main.startColor = new ParticleSystem.MinMaxGradient(a, b);
        }

        /// <summary>向上喷一把（切换英雄）</summary>
        public void Burst(int count = 28)
        {
            if (!motes) return;
            var ep = new ParticleSystem.EmitParams
            {
                applyShapeToPosition = true,
                startLifetime = 1.6f,
                startColor = Color.Lerp(color, Color.white, 0.4f),
            };
            for (int i = 0; i < count; i++)
            {
                ep.velocity = new Vector3(Random.Range(-0.25f, 0.25f), Random.Range(1.1f, 2.4f), Random.Range(-0.25f, 0.25f));
                ep.startSize = Random.Range(0.04f, 0.11f);
                motes.Emit(ep, 1);
            }
        }

        /// <summary>当前活着的粒子数（测试用）</summary>
        public int Alive => motes ? motes.particleCount : 0;
    }
}
