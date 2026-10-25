using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 按 <see cref="FxParticle"/> 配置一个 Shuriken 共享发射器。FxBuilder 生成预制体、运行时缺预制体现场搭，两边都调这里，结果一致。
    /// 发射器是世界空间、不自己发射（emission / shape 关闭）：粒子全部由代码逐颗 Emit（位置、速度、大小、寿命、颜色），
    /// Shuriken 负责积分（重力、阻尼、碰撞弹跳）、随寿命的大小 / 透明度、渲染（贴图集按帧选格）。
    /// </summary>
    public static class FxSetup
    {
        /// <summary>Physics.gravity 的模（重力倍率换算用；不读 Physics.gravity，免得项目改了重力特效也跟着变）</summary>
        public const float G = 9.81f;

        public static void Configure(ParticleSystem ps, FxParticle p, Material material)
        {
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed = true;

            var main = ps.main;
            main.duration = 1;
            main.loop = true;
            main.playOnAwake = true;
            main.startDelay = 0;
            main.startLifetime = 1;
            main.startSpeed = 0;
            main.startSize = 0.1f;
            main.startRotation = 0;
            main.startColor = Color.white;
            main.gravityModifier = p.gravity / G;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.scalingMode = ParticleSystemScalingMode.Hierarchy;
            main.maxParticles = Mathf.Max(16, p.maxParticles);
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            main.ringBufferMode = ParticleSystemRingBufferMode.Disabled;
            main.stopAction = ParticleSystemStopAction.None;

            var emission = ps.emission;
            emission.enabled = false;
            var shape = ps.shape;
            shape.enabled = false;

            // 阻尼：线性 drag（不乘大小、不乘速度）≈ Three.js 的 v *= exp(−drag·dt)
            var limit = ps.limitVelocityOverLifetime;
            limit.enabled = p.drag > 0;
            limit.separateAxes = false;
            limit.limit = 1000;
            limit.dampen = 0;
            limit.drag = p.drag;
            limit.multiplyDragByParticleSize = false;
            limit.multiplyDragByParticleVelocity = false;

            var col = ps.colorOverLifetime;
            col.enabled = true;
            col.color = new ParticleSystem.MinMaxGradient(FadeGradient(p.fade, p.alpha));

            var size = ps.sizeOverLifetime;
            size.enabled = Mathf.Abs(p.grow - 1) > 1e-3f;
            if (size.enabled)
            {
                float m = Mathf.Max(1, p.grow);
                size.size = new ParticleSystem.MinMaxCurve(m, AnimationCurve.Linear(0, 1 / m, 1, p.grow / m));
            }

            var rot = ps.rotationOverLifetime;
            rot.enabled = p.spin > 0;
            if (rot.enabled)
            {
                rot.separateAxes = false;
                float s = p.spin * Mathf.Deg2Rad;
                rot.z = new ParticleSystem.MinMaxCurve(-s, s);
            }

            var collision = ps.collision;
            collision.enabled = p.bounce;
            if (p.bounce)
            {
                collision.type = ParticleSystemCollisionType.World;
                collision.mode = ParticleSystemCollisionMode.Collision3D;
                collision.quality = ParticleSystemCollisionQuality.Medium;
                collision.collidesWith = Layers.WorldMask;
                collision.enableDynamicColliders = false;
                collision.dampen = 0.45f;
                collision.bounce = 0.32f;
                collision.lifetimeLoss = 0;
                collision.minKillSpeed = 0;
                collision.radiusScale = 0.5f;
                collision.maxCollisionShapes = 64;
                collision.sendCollisionMessages = false;
            }

            var sheet = ps.textureSheetAnimation;
            sheet.enabled = true;
            sheet.mode = ParticleSystemAnimationMode.Grid;
            sheet.numTilesX = FxTextures.AtlasColumns;
            sheet.numTilesY = FxTextures.AtlasRows;
            sheet.animation = ParticleSystemAnimationType.WholeSheet;
            sheet.cycleCount = 1;
            sheet.startFrame = 0;
            // frameOverTime 是归一化的（0..1 覆盖全部帧）：取格子正中，向下取整就是这一格
            int frames = FxTextures.AtlasColumns * FxTextures.AtlasRows;
            sheet.frameOverTime = new ParticleSystem.MinMaxCurve(((int)p.texture + 0.5f) / frames);

            var r = ps.GetComponent<ParticleSystemRenderer>();
            r.renderMode = p.render switch
            {
                FxRender.Stretched => ParticleSystemRenderMode.Stretch,
                FxRender.Horizontal => ParticleSystemRenderMode.HorizontalBillboard,
                _ => ParticleSystemRenderMode.Billboard,
            };
            if (p.render == FxRender.Stretched)
            {
                r.velocityScale = p.stretchVelocity;
                r.lengthScale = p.stretchLength;
                r.cameraVelocityScale = 0;
            }
            r.alignment = ParticleSystemRenderSpace.View;
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.minParticleSize = 0;
            // 贴脸的大闪光最多占半屏（Three.js 点精灵上限 320 px）
            r.maxParticleSize = 0.6f;
            r.sortingFudge = 0;
            r.sortingOrder = p.sortOrder;
            r.allowRoll = true;
        }

        /// <summary>透明度曲线 → 渐变（颜色全白，透明度 = 曲线 × 峰值）。Gradient 最多 8 个关键帧</summary>
        public static Gradient FadeGradient(FxFade fade, float a0)
        {
            var g = new Gradient { mode = GradientMode.Blend };
            var colors = new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) };
            GradientAlphaKey[] alphas;
            switch (fade)
            {
                case FxFade.Quadratic:
                    alphas = Keys(a0, t => (1 - t) * (1 - t), 0, 0.15f, 0.35f, 0.6f, 1);
                    break;
                case FxFade.Smoke:
                    // min(1, 7t) · (1 − t) · (1 − 0.3t)
                    alphas = Keys(a0, t => Mathf.Min(1, t * 7) * (1 - t) * (1 - t * 0.3f), 0, 0.143f, 0.3f, 0.5f, 0.7f, 0.85f, 1);
                    break;
                case FxFade.Hold:
                    alphas = new[] { new GradientAlphaKey(a0, 0), new GradientAlphaKey(a0, 0.7f), new GradientAlphaKey(0, 1) };
                    break;
                case FxFade.Flicker:
                    // (1 − t) × 0.65..1 交替：每颗粒子按自己的年龄走，彼此相位不同，看起来是各自在闪
                    alphas = new GradientAlphaKey[8];
                    for (int i = 0; i < 8; i++)
                    {
                        float t = i / 7f;
                        alphas[i] = new GradientAlphaKey(a0 * (1 - t) * (i % 2 == 0 ? 1f : 0.62f), t);
                    }
                    break;
                case FxFade.Streak:
                    alphas = Keys(a0, t => (1 - t) * (1 - t * 0.4f), 0, 0.5f, 1);
                    break;
                case FxFade.Linger:
                    alphas = Keys(a0, t => Mathf.SmoothStep(0, 1, t / 0.25f) * Mathf.SmoothStep(0, 1, (1 - t) / 0.35f), 0, 0.12f, 0.25f, 0.45f, 0.65f, 0.82f, 1);
                    break;
                default:
                    alphas = new[] { new GradientAlphaKey(a0, 0), new GradientAlphaKey(0, 1) };
                    break;
            }
            g.SetKeys(colors, alphas);
            return g;
        }

        static GradientAlphaKey[] Keys(float a0, System.Func<float, float> f, params float[] ts)
        {
            var k = new GradientAlphaKey[ts.Length];
            for (int i = 0; i < ts.Length; i++) k[i] = new GradientAlphaKey(a0 * f(ts[i]), ts[i]);
            return k;
        }
    }
}
