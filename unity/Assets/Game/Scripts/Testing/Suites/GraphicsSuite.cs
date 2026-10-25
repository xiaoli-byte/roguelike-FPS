using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using Unity.Profiling;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 画质档 / 屏效 / 混音冒烟（bridge.sh playtest graphics [场景]；默认 2-1 冰瀑栈道：雪地着色器 + 地形细节 + 雾，最挑画质档）——F4 / F5：
    ///   画质：高 → 中 → 低 逐档切（ArtQuality.Set(…, save: false)，不改编辑器里共享的档位），核对 URP 资产（渲染比例 / FSR / MSAA / 阴影 / SSAO）、
    ///     QualitySettings（lodBias / mip / 地形覆盖）、FX 预算、低档 Bloom 覆盖 Volume；同一机位各拍一张，各测 3 s 帧时间（主线程 / GPU / 帧率）；
    ///   屏效：低血量、受击（真扣血）、冲刺（GameEvents.PlayerDashed）、慢动作（仲裁器 DeathSlowMo）各拍一张并核对权重起落；
    ///     顿帧不触发慢动作屏效；设置「屏幕特效」= 0 时全部不出；
    ///   混音：声道接在 Mixer 上、玩家音量写进暴露参数；暂停 → World −6.9 dB（0.45）、结算 → −1.9 dB（0.8）、回到游玩 0 dB；
    ///     跳伤连发同时最多 3 声；8 个爆炸 + 一串命中同帧炸开时监听器输出峰值 &lt; 1（限幅器起作用、不爆音）。
    /// 结束时还原画质档、屏效设置、玩家状态。
    /// </summary>
    public sealed class GraphicsSuite : PlaytestSuite
    {
        public override string Id => "graphics";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";

        const string StatKey = "playtest_graphics";

        Camera cam;
        PlayerVitals vitals;
        PlayerMotor motor;
        Transform eye;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(2f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.eye.transform;
            cam = weapons.eye;
            vitals.stats.Add(StatKey, Stat.MaxHp, 5000);
            vitals.Heal(999999);
            vitals.invulnerableUntil = float.MaxValue;
            motor.inputEnabled = false;

            var quality = ArtQuality.Level;
            float effects = GameSettings.ScreenEffects.Value;
            if (effects < 0.99f) GameSettings.ScreenEffects.Set(1f);
            Line($"场景 {UnityEngine.SceneManagement.SceneManager.GetActiveScene().name}，原画质 {ArtQuality.Label(quality)}，屏幕特效 {effects:0.##}");

            if (!GameplayVolumes.Instance) Fail("GameplayVolumes 没有自动创建");

            yield return Tiers();
            ArtQuality.Set(ArtQualityLevel.High, false);
            yield return new WaitForSecondsRealtime(0.5f);
            yield return ScreenEffects();
            yield return Mixer();
            yield return SettingsPages();

            ArtQuality.Set(quality, false);
            if (!Mathf.Approximately(GameSettings.ScreenEffects.Value, effects)) GameSettings.ScreenEffects.Set(effects);
            vitals.stats.Remove(StatKey);
            vitals.invulnerableUntil = -1;
            vitals.Heal(999999);
            motor.inputEnabled = true;
        }

        // ───────────── 画质三档 ─────────────

        IEnumerator Tiers()
        {
            var perf = new List<string>();
            foreach (var level in new[] { ArtQualityLevel.High, ArtQualityLevel.Medium, ArtQualityLevel.Low })
            {
                ArtQuality.Set(level, false);
                yield return new WaitForSecondsRealtime(1.2f);
                var p = QualityProfile.For(level);
                var applied = GraphicsQuality.AppliedProfile;
                if (applied != p) Fail($"{p.label}：GraphicsQuality 没有写上这一档（写的是 {applied?.label ?? "无"}）");
                var a = GraphicsQuality.ActiveAsset;
                if (!a) Fail("没有在用的 URP 资产");
                else
                {
                    string got = $"渲染 {a.renderScale:0.##} {a.upscalingFilter}、MSAA {a.msaaSampleCount}、阴影 {a.shadowDistance:0} m / {a.shadowCascadeCount} 级 / {a.mainLightShadowmapResolution}" +
                                 $"{(a.supportsSoftShadows ? " 软" : " 硬")}、附加光投影 {(a.supportsAdditionalLightShadows ? "开" : "关")}、SSAO {(QualityProfile.FindSsao(a)?.isActive == true ? "开" : "关")}";
                    Line($"{p.label}档 URP 资产「{a.name}」：{got}");
                    if (!Mathf.Approximately(a.renderScale, p.renderScale) || a.msaaSampleCount != p.msaa || !Mathf.Approximately(a.shadowDistance, p.shadowDistance)
                        || a.shadowCascadeCount != p.shadowCascades || a.supportsSoftShadows != p.softShadows || a.supportsAdditionalLightShadows != p.additionalLightShadows)
                        Fail($"{p.label}：URP 资产和画质表对不上（表：{p}）");
                    if (QualityProfile.FindSsao(a) is { } ao && ao.isActive != p.ssao) Fail($"{p.label}：SSAO 应为 {(p.ssao ? "开" : "关")}");
                }
                if (QualitySettings.names[QualitySettings.GetQualityLevel()] != "PC") Fail($"{p.label}：没有用 PC 画质级（{QualitySettings.names[QualitySettings.GetQualityLevel()]}）");
                if (!Mathf.Approximately(QualitySettings.lodBias, p.lodBias) || QualitySettings.globalTextureMipmapLimit != p.textureMipLimit)
                    Fail($"{p.label}：lodBias {QualitySettings.lodBias} / mip {QualitySettings.globalTextureMipmapLimit}，应为 {p.lodBias} / {p.textureMipLimit}");
                if (FxBudget.ParticleCap != p.particleCap || FxLightPool.Capacity != p.fxLights) Fail($"{p.label}：FX 预算没跟着档位走");
                bool wantQ = p.bloomQuarter || p.bloomMaxIterations > 0;
                if (GameplayVolumes.Instance && GameplayVolumes.Instance.QualityVolumeActive != wantQ) Fail($"{p.label}：Bloom 画质 Volume 应为 {(wantQ ? "开" : "关")}");
                Shot(cam, $"graphics_{level.ToString().ToLowerInvariant()}");

                // 帧时间：先等 0.8 s 让切档的重分配 / 贴图重传和截图回读过去，再测 3 s（编辑器里含编辑器开销，只看三档之间的相对差）
                yield return new WaitForSecondsRealtime(0.8f);
                var frames = new List<float>();
                using var gpu = ProfilerRecorder.StartNew(ProfilerCategory.Render, "GPU Frame Time", 240);
                using var main = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 240);
                var gpuSamples = new List<double>();
                var mainSamples = new List<double>();
                float until = Time.realtimeSinceStartup + 3f;
                while (Time.realtimeSinceStartup < until)
                {
                    yield return null;
                    frames.Add(Time.unscaledDeltaTime * 1000f);
                    if (gpu.Valid && gpu.LastValue > 0) gpuSamples.Add(gpu.LastValue / 1e6);
                    if (main.Valid && main.LastValue > 0) mainSamples.Add(main.LastValue / 1e6);
                }
                frames.Sort();
                float avg = frames.Average(), median = frames[frames.Count / 2], p95 = frames[Mathf.Min(frames.Count - 1, (int)(frames.Count * 0.95f))];
                string gpuText = gpuSamples.Count > 0 ? $"{gpuSamples.Average():0.00} ms" : "n/a";
                string mainText = mainSamples.Count > 0 ? $"{mainSamples.Average():0.00} ms" : "n/a";
                string line = $"{p.label}：帧中位 {median:0.00} ms（{1000f / median:0} fps），平均 {avg:0.00} ms，p95 {p95:0.00} ms，GPU {gpuText}，主线程 {mainText}，{frames.Count} 帧";
                perf.Add(line);
                Line("性能 " + line);
            }
            Line("性能对比（同一机位静止 3 s）：" + string.Join(" ｜ ", perf));
        }

        // ───────────── 玩法屏效 ─────────────

        IEnumerator ScreenEffects()
        {
            var gv = GameplayVolumes.Instance;
            if (!gv) yield break;
            yield return WaitClear(gv, 1.5f);
            Line($"屏效起始权重：低血量 {gv.LowHealthWeight:0.00} 受击 {gv.HurtWeight:0.00} 冲刺 {gv.DashWeight:0.00} 慢动作 {gv.SlowWeight:0.00}");
            Shot(cam, "graphics_fx_none");

            // 低血量
            vitals.health = vitals.MaxHealth * 0.08f;
            yield return new WaitForSecondsRealtime(0.3f);
            Line($"低血量（8%）权重 {gv.LowHealthWeight:0.00}");
            if (gv.LowHealthWeight < 0.9f) Fail("低血量屏效没起来");
            Shot(cam, "graphics_fx_lowhp");
            vitals.Heal(999999);
            yield return new WaitForSecondsRealtime(0.2f);
            if (gv.LowHealthWeight > 0.01f) Fail("回血后低血量屏效没退");

            // 受击（真扣血：先关无敌）
            vitals.invulnerableUntil = -1;
            float dealt = vitals.TakeDamage(vitals.MaxHealth * 0.12f, eye.position + eye.forward * 6f);
            vitals.invulnerableUntil = float.MaxValue;
            yield return new WaitForSecondsRealtime(0.05f);
            float hurtW = gv.HurtWeight;
            Line($"受击 {dealt:0} 点，权重 {hurtW:0.00}");
            if (dealt <= 0) Fail("扣血没生效（无敌？）");
            else if (hurtW < 0.5f) Fail("受击屏效没起来");
            Shot(cam, "graphics_fx_hurt");
            yield return new WaitForSecondsRealtime(0.6f);
            if (gv.HurtWeight > 0.01f) Fail($"受击屏效 0.65 s 后还有 {gv.HurtWeight:0.00}");
            vitals.Heal(999999);

            // 冲刺
            GameEvents.RaisePlayerDashed(motor.transform.forward);
            yield return new WaitForSecondsRealtime(0.06f);
            float dashW = gv.DashWeight;
            Line($"冲刺权重 {dashW:0.00}");
            if (dashW < 0.6f) Fail("冲刺屏效没起来");
            Shot(cam, "graphics_fx_dash");
            yield return new WaitForSecondsRealtime(0.45f);
            if (gv.DashWeight > 0.01f) Fail("冲刺屏效没退");

            // 顿帧不算慢动作
            var stop = TimeScaleArbiter.Request(this, 0.05f, TimeScaleArbiter.Priority.HitStop);
            yield return new WaitForSecondsRealtime(0.15f);
            float stopW = gv.SlowWeight;
            stop.Dispose();
            if (stopW > 0.01f) Fail($"顿帧触发了慢动作屏效（{stopW:0.00}）");

            // 慢动作
            var slow = TimeScaleArbiter.Request(this, 0.3f, TimeScaleArbiter.Priority.DeathSlowMo);
            yield return new WaitForSecondsRealtime(0.6f);
            float slowW = gv.SlowWeight;
            Line($"慢动作（0.3×）权重 {slowW:0.00}");
            if (slowW < 0.9f) Fail("慢动作屏效没起来");
            Shot(cam, "graphics_fx_slowmo");
            slow.Dispose();
            yield return new WaitForSecondsRealtime(0.8f);
            if (gv.SlowWeight > 0.01f) Fail("慢动作结束后屏效没退");

            // 设置「屏幕特效」= 0
            GameSettings.ScreenEffects.Set(0f);
            gv.PulseHurt(1f);
            gv.PulseDash();
            yield return new WaitForSecondsRealtime(0.05f);
            if (gv.HurtWeight > 0 || gv.DashWeight > 0) Fail("屏幕特效设为 0 时仍有屏效");
            GameSettings.ScreenEffects.Set(1f);
            yield return WaitClear(gv, 1f);
        }

        static IEnumerator WaitClear(GameplayVolumes gv, float max)
        {
            float until = Time.realtimeSinceStartup + max;
            while (Time.realtimeSinceStartup < until && gv.LowHealthWeight + gv.HurtWeight + gv.DashWeight + gv.SlowWeight > 0.01f) yield return null;
        }

        // ───────────── 设置页（画面 / 声音）─────────────

        IEnumerator SettingsPages()
        {
            if (!UIRouter.Open(SettingsScreen.ScreenId, GameSettings.GroupVideo))
            {
                Fail("设置界面打不开");
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.5f);
            if (UIRouter.Find(SettingsScreen.ScreenId) is SettingsScreen settings)
            {
                Line($"设置：页签 {settings.CurrentTab}，自动生成控件 {settings.GeneratedControls} 个（GameSettings {GameSettings.All.Count} 条）");
                if (settings.CurrentTab != GameSettings.GroupVideo) Fail("没有切到「画面」页");
                if (settings.GeneratedControls != GameSettings.All.Count) Fail("设置控件数和 GameSettings 条目数对不上");
                Shot(cam, "graphics_settings_video");
                yield return new WaitForSecondsRealtime(0.2f);   // 截图在帧末抓屏：同一帧里切页签会拍成下一页
                settings.Select(GameSettings.GroupAudio);
                yield return new WaitForSecondsRealtime(0.3f);
                Shot(cam, "graphics_settings_audio");
                yield return new WaitForSecondsRealtime(0.2f);
            }
            else Fail("设置界面没有打开");
            UIRouter.Close(SettingsScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.3f);
        }

        // ───────────── 混音 ─────────────

        IEnumerator Mixer()
        {
            GameAudio.Play("ui_hover", 0.01f);
            yield return null;
            yield return null;
            if (!AudioMix.Active)
            {
                Fail("没有混音台 Resources/Audio/Spiritfire.mixer（bridge.sh audio）");
                yield break;
            }
            if (!GameAudio.Routed) Fail("GameAudio 的声道没接到 Mixer 组上");
            yield return new WaitForSecondsRealtime(0.2f);
            float master = AudioMix.Read(AudioMix.ParamMaster), want = AudioMix.LinearToDb(GameSettings.MasterVolume.Value);
            Line($"主音量设置 {GameSettings.MasterVolume.Value:0.##} → Mixer {master:0.##} dB；音效 {AudioMix.Read(AudioMix.ParamSfx):0.##} dB，音乐 {AudioMix.Read(AudioMix.ParamMusic):0.##} dB，" +
                 $"界面 {AudioMix.Read(AudioMix.ParamUi):0.##} dB，环境 {AudioMix.Read(AudioMix.ParamAmbience):0.##} dB");
            if (float.IsNaN(master) || Mathf.Abs(master - want) > 0.1f) Fail($"主音量没写进 Mixer（{master} dB，应为 {want:0.##} dB）");

            // 压低：暂停 / 结算 / 回到游玩
            float World() => AudioMix.Read(AudioMix.ParamWorld);
            Line($"游玩时 World {World():0.##} dB，快照 {AudioDuck.Current}");
            GameStateMachine.Push(this, GameState.Paused, false);
            yield return new WaitForSecondsRealtime(0.6f);
            float paused = World();
            Line($"暂停：快照 {AudioDuck.Current}，World {paused:0.##} dB（{AudioMix.DbToLinear(paused):0.00}）");
            if (AudioDuck.Current != AudioMix.SnapshotPaused || Mathf.Abs(paused - AudioMix.LinearToDb(0.45f)) > 0.3f) Fail("暂停没压到 0.45");
            GameStateMachine.Pop(this);
            GameStateMachine.Push(this, GameState.Summary, false);
            yield return new WaitForSecondsRealtime(0.6f);
            float summary = World();
            Line($"结算：快照 {AudioDuck.Current}，World {summary:0.##} dB（{AudioMix.DbToLinear(summary):0.00}）");
            if (AudioDuck.Current != AudioMix.SnapshotSummary || Mathf.Abs(summary - AudioMix.LinearToDb(0.8f)) > 0.3f) Fail("结算没压到 0.8");
            GameStateMachine.Pop(this);
            yield return new WaitForSecondsRealtime(0.6f);
            float back = World();
            Line($"回到游玩：快照 {AudioDuck.Current}，World {back:0.##} dB");
            if (Mathf.Abs(back) > 0.3f) Fail("回到游玩后没恢复 0 dB");

            // 跳伤连发：1 s 里每帧 6 个敌人同时跳一下
            var at = eye.position + eye.forward * 4f;
            int maxTick = 0;
            float until = Time.realtimeSinceStartup + 1f;
            while (Time.realtimeSinceStartup < until)
            {
                for (int i = 0; i < 6; i++) GameAudio.PlayAt("burn_tick", at + Random.insideUnitSphere * 2f, 0.6f);
                maxTick = Mathf.Max(maxTick, GameAudio.VoicesOf("burn_tick"));
                yield return null;
            }
            Line($"跳伤连发（每帧 6 声 × 1 s）：同时最多 {maxTick} 声");
            if (maxTick > 3) Fail("跳伤同时超过 3 声");

            // 峰值：8 个爆炸 + 命中 + 暴击同帧（监听器的最终输出）
            yield return new WaitForSecondsRealtime(0.5f);
            for (int i = 0; i < 8; i++) GameAudio.PlayAt("explosion", eye.position + eye.forward * (2f + i * 0.3f), 1.5f);
            GameAudio.Play("hit_crit", 1.2f);
            GameAudio.Play("kill", 1.2f);
            GameAudio.Play("shield_break", 1.2f);
            float peak = 0;
            var buf = new float[1024];
            until = Time.realtimeSinceStartup + 0.6f;
            while (Time.realtimeSinceStartup < until)
            {
                for (int ch = 0; ch < 2; ch++)
                {
                    AudioListener.GetOutputData(buf, ch);
                    foreach (float s in buf) peak = Mathf.Max(peak, Mathf.Abs(s));
                }
                yield return null;
            }
            Line($"同帧 8 爆炸 + 命中：输出峰值 {peak:0.000}（{AudioMix.LinearToDb(peak):0.0} dBFS），活跃声道 {GameAudio.ActiveVoices}");
            if (peak >= 1f) Fail("输出削波（峰值 ≥ 1）");
            if (peak <= 0.0001f) Line("（监听器没有输出：编辑器静音或没有音频设备，峰值检查跳过）");
        }
    }
}
