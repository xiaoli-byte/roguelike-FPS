using System;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Spiritfire.Art;
using UnityEditor;
using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// F4 画质档 / 显示设置 / 玩法屏效，F5 混音 / 压低 / 密集音节流（docs/unity-parity.md 3.13）：
    ///   画质表三档单调、「高」= 工程里 PC 资产与 PC 画质级的原值（观感不变）、写 URP 资产、FX 预算跟着档位走；
    ///   显示与音量设置存进共享设置文件、重开后还在；屏效与压低的纯规则；混音台的组 / 快照 / 暴露参数 / 限幅器 / 快照电平。
    /// 存档根目录指到临时目录；切画质只用 ArtQuality.Set(…, save: false)，测完还原（不碰编辑器里共享的 PlayerPrefs）。
    /// </summary>
    public sealed class GraphicsAudioTests
    {
        string root;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(Path.GetTempPath(), "spiritfire-gfx-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            SaveService.UseRoot(root);
        }

        [TearDown]
        public void TearDown()
        {
            SaveService.UseRoot(null);
            try { Directory.Delete(root, true); }
            catch (Exception) { /* 临时目录 */ }
        }

        // ───────────── 画质表 ─────────────

        [Test]
        public void QualityTiersAreMonotonic()
        {
            var t = QualityProfile.All;
            Assert.AreEqual(3, t.Length);
            for (int i = 1; i < t.Length; i++)
            {
                var lo = t[i - 1];
                var hi = t[i];
                string at = $"{lo.label} → {hi.label}";
                Assert.LessOrEqual(lo.renderScale, hi.renderScale, at + " 渲染比例");
                Assert.LessOrEqual(lo.msaa, hi.msaa, at + " MSAA");
                Assert.LessOrEqual(lo.shadowDistance, hi.shadowDistance, at + " 阴影距离");
                Assert.LessOrEqual(lo.shadowCascades, hi.shadowCascades, at + " 级联");
                Assert.LessOrEqual(lo.shadowResolution, hi.shadowResolution, at + " 阴影分辨率");
                Assert.LessOrEqual(lo.particleDensity, hi.particleDensity, at + " 粒子密度");
                Assert.LessOrEqual(lo.particleCap, hi.particleCap, at + " 粒子上限");
                Assert.LessOrEqual(lo.decalCap, hi.decalCap, at + " 贴花上限");
                Assert.LessOrEqual(lo.fxLights, hi.fxLights, at + " 闪光灯");
                Assert.LessOrEqual(lo.lodBias, hi.lodBias, at + " lodBias");
                Assert.GreaterOrEqual(lo.textureMipLimit, hi.textureMipLimit, at + " mip");
                Assert.LessOrEqual((int)lo.fur, (int)hi.fur, at + " 毛发");
            }
            foreach (var p in t)
            {
                Assert.IsFalse(p.stp, $"{p.label}：STP 在叠加相机下不生效，不该开");
                Assert.That(p.renderScale, Is.InRange(0.5f, 1f));
                if (p.renderScale < 0.999f) Assert.AreEqual(UpscalingFilterSelection.FSR, p.upscaling, $"{p.label}：降分辨率要用 FSR 放大");
                Assert.That(p.fxLights, Is.InRange(1, FxLightPool.MaxLights));
            }
            Assert.AreEqual(QualityProfile.Low, QualityProfile.For(ArtQualityLevel.Low));
            Assert.AreEqual(QualityProfile.Medium, QualityProfile.For(ArtQualityLevel.Medium));
            Assert.AreEqual(QualityProfile.High, QualityProfile.For(ArtQualityLevel.High));
        }

        /// <summary>「高」= 工程里的原值：切到高档不改关卡观感</summary>
        [Test]
        public void HighTierMatchesProjectAssets()
        {
            var pc = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
            Assert.IsNotNull(pc, "PC_RPAsset 不在了？");
            var h = QualityProfile.High;
            Assert.AreEqual(pc.renderScale, h.renderScale, 1e-4f);
            Assert.AreEqual(pc.msaaSampleCount, h.msaa);
            Assert.AreEqual(pc.shadowDistance, h.shadowDistance, 1e-3f);
            Assert.AreEqual(pc.shadowCascadeCount, h.shadowCascades);
            Assert.AreEqual(pc.mainLightShadowmapResolution, h.shadowResolution);
            Assert.AreEqual(pc.supportsSoftShadows, h.softShadows);
            Assert.AreEqual(pc.supportsAdditionalLightShadows, h.additionalLightShadows);
            var ao = QualityProfile.FindSsao(pc);
            Assert.IsNotNull(ao, "PC 渲染器上应有 SSAO");
            Assert.AreEqual(ao.isActive, h.ssao);

            // PC 画质级的 lodBias / mip（读 ProjectSettings，不切当前级）
            var qs = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/QualitySettings.asset").FirstOrDefault();
            Assert.IsNotNull(qs);
            var so = new SerializedObject(qs);
            var levels = so.FindProperty("m_QualitySettings");
            bool found = false;
            for (int i = 0; i < levels.arraySize; i++)
            {
                var l = levels.GetArrayElementAtIndex(i);
                if (l.FindPropertyRelative("name").stringValue != "PC") continue;
                found = true;
                Assert.AreEqual(l.FindPropertyRelative("lodBias").floatValue, h.lodBias, 1e-4f, "PC 级 lodBias");
                Assert.AreEqual(l.FindPropertyRelative("globalTextureMipmapLimit").intValue, h.textureMipLimit, "PC 级贴图 mip");
            }
            Assert.IsTrue(found, "没有 PC 画质级");
        }

        [Test]
        public void ProfileWritesPipelineAsset()
        {
            var a = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
            try
            {
                QualityProfile.Low.ApplyTo(a);
                Assert.AreEqual(0.7f, a.renderScale, 1e-4f);
                Assert.AreEqual(UpscalingFilterSelection.FSR, a.upscalingFilter);
                Assert.IsTrue(a.fsrOverrideSharpness);
                Assert.AreEqual(1, a.msaaSampleCount);
                Assert.AreEqual(45f, a.shadowDistance, 1e-3f);
                Assert.AreEqual(1, a.shadowCascadeCount);
                Assert.AreEqual(1024, a.mainLightShadowmapResolution);
                Assert.IsFalse(a.supportsSoftShadows);
                Assert.IsFalse(a.supportsAdditionalLightShadows);

                QualityProfile.High.ApplyTo(a);
                Assert.AreEqual(1f, a.renderScale, 1e-4f);
                Assert.AreEqual(UpscalingFilterSelection.Auto, a.upscalingFilter, "原生分辨率不放大");
                Assert.AreEqual(4, a.msaaSampleCount);
                Assert.AreEqual(90f, a.shadowDistance, 1e-3f);
                Assert.AreEqual(4, a.shadowCascadeCount);
                Assert.IsTrue(a.supportsSoftShadows, "软阴影 setter 是 internal，反射要写得进去");
                Assert.IsTrue(a.supportsAdditionalLightShadows);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(a);
            }
        }

        [Test]
        public void FxBudgetFollowsQualityTier()
        {
            var before = ArtQuality.Level;
            try
            {
                foreach (var p in QualityProfile.All)
                {
                    ArtQuality.Set(p.level, false);
                    Assert.AreSame(p, QualityProfile.Current);
                    Assert.AreEqual(p.particleCap, FxBudget.ParticleCap, p.label);
                    Assert.AreEqual(p.styleCapScale, FxBudget.StyleCapScale, 1e-5f, p.label);
                    Assert.AreEqual(p.decalCap, FxBudget.DecalCap, p.label);
                    Assert.AreEqual(p.statusEmitPerFrame, FxBudget.StatusEmitPerFrame, p.label);
                    Assert.AreEqual(p.particleDensity, Fx.Density, 1e-5f, p.label);
                    Assert.AreEqual(p.fxLights, FxLightPool.Capacity, p.label);
                    Assert.AreEqual(p.fur == FurTier.Shells ? 16 : 0, ArtQuality.FurShells(16), p.label + " 毛发壳层");
                    Assert.AreEqual(p.fur != FurTier.None, ArtQuality.FurFins, p.label + " 轮廓发丝");
                }
                // 数值与 FX1 原来的三档一致
                Assert.AreEqual(new[] { 1500, 3000, 5000 }, QualityProfile.All.Select(p => p.particleCap).ToArray());
                Assert.AreEqual(new[] { 3, 6, 8 }, QualityProfile.All.Select(p => p.fxLights).ToArray());
            }
            finally
            {
                ArtQuality.Set(before, false);
            }
        }

        // ───────────── 显示 / 音量设置持久化 ─────────────

        [Test]
        public void DisplayAndVolumeSettingsPersist()
        {
            Assert.IsFalse(GameSettings.All.Contains(GameSettings.ResolutionWidth), "分辨率是隐藏项，不自动生成控件");
            Assert.AreSame(GameSettings.ResolutionWidth, GameSettings.Find("resolutionWidth"));
            CollectionAssert.IsSubsetOf(new[] { GameSettings.DisplayMode, GameSettings.VSync, GameSettings.FrameCap, GameSettings.ScreenEffects,
                GameSettings.AmbienceVolume, GameSettings.UiVolume }, GameSettings.All.ToArray());
            Assert.AreEqual(GraphicsQuality.DisplayModes.Length, GameSettings.DisplayMode.options.Length);
            Assert.AreEqual(GraphicsQuality.FrameCaps.Length, GameSettings.FrameCap.options.Length);

            GameSettings.DisplayMode.Set(2);
            GameSettings.VSync.Set(false);
            GameSettings.FrameCap.Set(1);
            GameSettings.ResolutionWidth.Set(1280);
            GameSettings.ResolutionHeight.Set(720);
            GameSettings.ScreenEffects.Set(0.5f);
            GameSettings.AmbienceVolume.Set(0.3f);
            GameSettings.UiVolume.Set(0.6f);
            GameSettings.MusicVolume.Set(0.25f);
            SaveService.Flush();

            SaveService.UseRoot(root);   // 丢掉内存里的文件，重新读盘
            Assert.AreEqual(2, GameSettings.DisplayMode.Index);
            Assert.AreEqual(FullScreenMode.Windowed, GraphicsQuality.SavedDisplayMode);
            Assert.IsFalse(GameSettings.VSync.Bool);
            Assert.AreEqual(1, GameSettings.FrameCap.Index);
            Assert.AreEqual(new Vector2Int(1280, 720), GraphicsQuality.SavedResolution);
            Assert.AreEqual(0.5f, GameSettings.ScreenEffects.Value, 1e-4f);
            Assert.AreEqual(0.3f, GameSettings.AmbienceVolume.Value, 1e-4f);
            Assert.AreEqual(0.6f, GameSettings.UiVolume.Value, 1e-4f);
            Assert.AreEqual(0.25f, GameSettings.MusicVolume.Value, 1e-4f);

            // 默认值（不调 ResetAll：它会连画质一起写回 ArtQuality 的 PlayerPrefs，那是编辑器里大家共用的）
            Assert.AreEqual(1f, GameSettings.DisplayMode.defaultValue, "默认无边框");
            Assert.AreEqual(1f, GameSettings.VSync.defaultValue, "默认垂直同步");
            Assert.AreEqual(GraphicsQuality.FrameCaps.Length - 1, (int)GameSettings.FrameCap.defaultValue, "默认不限帧");
            Assert.AreEqual(0f, GameSettings.ResolutionWidth.defaultValue, "默认 = 桌面分辨率");
        }

        [Test]
        public void FrameCapRules()
        {
            Assert.AreEqual(-1, GraphicsQuality.TargetFrameRate(true, 1), "垂直同步开着时不限帧（交给显示器）");
            Assert.AreEqual(60, GraphicsQuality.TargetFrameRate(false, 1));
            Assert.AreEqual(144, GraphicsQuality.TargetFrameRate(false, 4));
            Assert.AreEqual(-1, GraphicsQuality.TargetFrameRate(false, GraphicsQuality.FrameCaps.Length - 1), "不限");
            Assert.AreEqual(30, GraphicsQuality.TargetFrameRate(false, -5), "越界夹住");
        }

        // ───────────── 玩法屏效 ─────────────

        [Test]
        public void GameplayVolumeRules()
        {
            Assert.AreEqual(0f, GameplayVolumes.LowHealthTarget(0.5f, false));
            Assert.AreEqual(0f, GameplayVolumes.LowHealthTarget(0.35f, false), 1e-4f);
            Assert.AreEqual(1f, GameplayVolumes.LowHealthTarget(0.1f, false), 1e-4f);
            Assert.AreEqual(1f, GameplayVolumes.LowHealthTarget(0.02f, false), 1e-4f);
            Assert.That(GameplayVolumes.LowHealthTarget(0.2f, false), Is.InRange(0.3f, 0.9f));
            Assert.AreEqual(0f, GameplayVolumes.LowHealthTarget(0.05f, true), "阵亡交给慢动作");

            float small = GameplayVolumes.HurtStrength(5, 0, 200), big = GameplayVolumes.HurtStrength(60, 0, 200);
            Assert.That(small, Is.InRange(0.35f, 0.5f));
            Assert.AreEqual(1f, big, 1e-4f);
            Assert.Less(GameplayVolumes.HurtStrength(0, 5, 200), small, "只扣护盾弱一些");
            Assert.AreEqual(0f, GameplayVolumes.HurtStrength(0, 0, 200));

            Assert.AreEqual(1f, GameplayVolumes.HurtEnvelope(GameplayVolumes.HurtAttack), 1e-4f);
            Assert.Less(GameplayVolumes.HurtEnvelope(0.35f), 0.12f, "0.35 s 基本褪完");
            Assert.AreEqual(0f, GameplayVolumes.HurtEnvelope(1f), "不拖尾");
            Assert.AreEqual(1f, GameplayVolumes.DashEnvelope(GameplayVolumes.DashHold), 1e-4f);
            Assert.AreEqual(0f, GameplayVolumes.DashEnvelope(0.4f), "冲刺屏效 0.32 s 收完");

            Assert.AreEqual(1f, GameplayVolumes.SlowTarget(0.3f, TimeScaleArbiter.Priority.DeathSlowMo), 1e-4f);
            Assert.AreEqual(0f, GameplayVolumes.SlowTarget(0.05f, TimeScaleArbiter.Priority.HitStop), "顿帧不算慢动作");
            Assert.AreEqual(0f, GameplayVolumes.SlowTarget(0f, TimeScaleArbiter.Priority.Pause), "暂停不算慢动作");
            Assert.AreEqual(0f, GameplayVolumes.SlowTarget(1f, TimeScaleArbiter.Priority.DeathSlowMo));

            // 克制：色差上限
            Assert.LessOrEqual(GameplayVolumes.HurtAberration, 0.4f);
            Assert.LessOrEqual(GameplayVolumes.DashAberration, GameplayVolumes.HurtAberration);
        }

        // ───────────── 混音 ─────────────

        [Test]
        public void DuckRulesMatchThreeJs()
        {
            Assert.AreEqual(0.45f, AudioDuck.DuckFor(GameState.Paused), 1e-5f);
            Assert.AreEqual(0.45f, AudioDuck.DuckFor(GameState.Modal), 1e-5f);
            Assert.AreEqual(0.8f, AudioDuck.DuckFor(GameState.Summary), 1e-5f);
            Assert.AreEqual(1f, AudioDuck.DuckFor(GameState.Playing));
            Assert.AreEqual(1f, AudioDuck.DuckFor(GameState.Menu));
            Assert.AreEqual(AudioMix.SnapshotPaused, AudioDuck.SnapshotFor(GameState.Modal));
            Assert.AreEqual(AudioMix.SnapshotSummary, AudioDuck.SnapshotFor(GameState.Summary));
            Assert.AreEqual(AudioMix.SnapshotGameplay, AudioDuck.SnapshotFor(GameState.Transition));

            Assert.AreEqual(0f, AudioMix.LinearToDb(1f), 1e-4f);
            Assert.AreEqual(-6.936f, AudioMix.LinearToDb(0.45f), 0.01f);
            Assert.AreEqual(-80f, AudioMix.LinearToDb(0f));
            Assert.AreEqual(0.45f, AudioMix.DbToLinear(AudioMix.LinearToDb(0.45f)), 1e-4f);
            Assert.AreEqual(0f, AudioMix.DbToLinear(-80f));
        }

        [Test]
        public void DenseSoundsAreThrottled()
        {
            Assert.IsTrue(GameAudio.DenseAllow("burn_tick", 0, 1f, out float g0));
            Assert.AreEqual(1f, g0, 1e-5f);
            Assert.IsTrue(GameAudio.DenseAllow("burn_tick", 2, 1f, out float g2));
            Assert.AreEqual(1f / 1.7f, g2, 1e-4f, "已有 2 声在响：× 1 / (1 + 0.35 × 2)");
            Assert.IsFalse(GameAudio.DenseAllow("burn_tick", 3, 1f, out _), "同时最多 3 声");
            Assert.IsFalse(GameAudio.DenseAllow("shock_zap", 0, 0.03f, out _), "雷弧最小间隔 0.07 s");
            Assert.IsFalse(GameAudio.DenseAllow("corrode_tick", 1, 0.05f, out _));
            Assert.IsTrue(GameAudio.DenseAllow("shot_smg", 40, 0f, out float g), "不在表里的音不受限");
            Assert.AreEqual(1f, g);
        }

        const string MixerPath = "Assets/Game/Resources/Audio/Spiritfire.mixer";

        [Test]
        public void MixerHasBusesSnapshotsAndLimiter()
        {
            var mixer = AssetDatabase.LoadAssetAtPath<AudioMixer>(MixerPath);
            Assert.IsNotNull(mixer, "没有混音台（bridge.sh audio 生成）");
            Assert.AreSame(mixer, Resources.Load<AudioMixer>(AudioMix.ResourcePath), "运行时按 Resources 路径载入");
            foreach (var path in AudioMix.GroupPaths) Assert.IsNotNull(AudioMix.Find(mixer, path), $"缺组 {path}");
            foreach (var s in AudioMix.Snapshots) Assert.IsNotNull(mixer.FindSnapshot(s), $"缺快照 {s}");
            Assert.AreEqual(AudioMixerUpdateMode.UnscaledTime, mixer.updateMode, "暂停时快照也要能过渡");

            const BindingFlags any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            object Prop(object o, string name) => o.GetType().GetProperty(name, any)!.GetValue(o);
            var exposed = ((Array)Prop(mixer, "exposedParameters")).Cast<object>()
                .Select(e => (string)e.GetType().GetField("name", any)!.GetValue(e)).ToArray();
            CollectionAssert.IsSubsetOf(AudioMix.ExposedParams, exposed);

            var world = AudioMix.Find(mixer, AudioMix.PathWorld);
            float Vol(string snap)
            {
                var m = world.GetType().GetMethod("GetValueForVolume", any)!;
                return (float)m.Invoke(world, new object[] { mixer, mixer.FindSnapshot(snap) });
            }
            Assert.AreEqual(0f, Vol(AudioMix.SnapshotGameplay), 0.05f);
            Assert.AreEqual(AudioMix.LinearToDb(0.45f), Vol(AudioMix.SnapshotPaused), 0.05f, "暂停压到 0.45");
            Assert.AreEqual(AudioMix.LinearToDb(0.8f), Vol(AudioMix.SnapshotSummary), 0.05f, "结算压到 0.8");

            var master = AudioMix.Find(mixer, AudioMix.PathMaster);
            var effects = ((Array)Prop(master, "effects")).Cast<object>().Select(fx => (string)Prop(fx, "effectName")).ToArray();
            CollectionAssert.Contains(effects, "Compressor", "Master 上要有限幅器");
            // UI 不在 World 下面：按钮音不被暂停压低
            Assert.IsNotNull(AudioMix.Find(mixer, AudioMix.PathUi));
            Assert.IsEmpty(mixer.FindMatchingGroups("Master/World/UI"));
        }
    }
}
