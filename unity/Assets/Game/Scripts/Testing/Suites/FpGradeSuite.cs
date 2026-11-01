using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 单遍后处理的调色对齐（第二批 E 路；docs/performance-unity.md「第一人称渲染」）。
    /// 以前枪模是叠加相机，世界被主相机和枪模相机各后处理一遍（色调映射、调色、暗角、Bloom 都叠了两次）；改成 <see cref="FirstPersonView"/> 之后只剩一遍，
    /// 所以各章的 Volume（<c>ShowcaseTheme</c> → 各关 VP_&lt;章&gt;.asset）要重调，让第一人称看到的世界和以前一样。
    ///   · fp-grade-ch1/2/3（拟合）：每关 4 个机位（出生、中段远眺、两段主线），同一帧里先用以前的做法（叠加相机 + 两遍后处理 + 改前的 Volume 值，<see cref="Old"/>）拍参照，
    ///     再切到单遍，在关卡 Volume 的运行时副本上按坐标下降调 曝光 / 对比 / 饱和 / 色温 / 色调 / 暗角 / Bloom 强度，让世界区域（去掉右下的枪模）的逐像素均方差最小；
    ///     报每关的最优值和残差（逐像素平均差、上半屏平均亮度 / 饱和度 / 对比度之差）。
    ///   · fp-look-ch1/2/3（核对）：不拟合，直接拿工程里的 Volume 值（单遍）和参照比，高 / 低两档；每个机位存一对截图（改前 / 改后），
    ///     本章第一关另拍一张第三人称机位（单遍，改前的 Volume 值 / 现在的值），scripts/unity 里的拼图脚本拼成对比图。
    /// 拍图都在同一帧里做（时间不走，粒子、动画、天气都一样），所以差值只来自后处理。天气导演、场地、首领遭遇停掉，天气 / 玩法 Volume 权重归零。
    /// </summary>
    public abstract class FpGradeSuite : PlaytestSuite
    {
        protected abstract string[] Stages { get; }
        /// <summary>true = 拟合；false = 核对工程里的值</summary>
        protected abstract bool Fit { get; }
        /// <summary>true = 只拍开火 / 换弹 / 技能（每关都拍，不核对世界）：fp-shots</summary>
        protected virtual bool ActionsOnly => false;

        const int W = 1280, H = 720, Sub = 4;
        const float ReadyTimeout = 90f;

        /// <summary>一套要调的后处理参数</summary>
        [Serializable]
        public struct Look
        {
            public float exposure, contrast, saturation, temperature, tint, vignette, bloom, lift, gamma, gain;
            /// <summary>第一人称曝光补偿（<see cref="FirstPersonExposure"/>：系数 / 伽马 / 火焰；不参与世界的拟合，0 当 1）</summary>
            public float fp, fpGamma, fpFlash, fpFx, fpSat;
            public float Fp => fp > 0 ? fp : 1f;
            public float FpGamma => fpGamma > 0 ? fpGamma : 1f;
            public float FpFlash => fpFlash > 0 ? fpFlash : 1f;
            public float FpFx => fpFx > 0 ? fpFx : 1f;
            public float FpSat => fpSat > 0 ? fpSat : 1f;

            public float this[int i]
            {
                get => i switch
                {
                    0 => exposure, 1 => contrast, 2 => saturation, 3 => temperature, 4 => tint, 5 => vignette, 6 => bloom, 7 => lift, 8 => gamma, _ => gain,
                };
                set
                {
                    switch (i)
                    {
                        case 0: exposure = Mathf.Clamp(value, -3, 3); break;
                        case 1: contrast = Mathf.Clamp(value, -100, 100); break;
                        case 2: saturation = Mathf.Clamp(value, -100, 100); break;
                        case 3: temperature = Mathf.Clamp(value, -100, 100); break;
                        case 4: tint = Mathf.Clamp(value, -100, 100); break;
                        case 5: vignette = Mathf.Clamp01(value); break;
                        case 6: bloom = Mathf.Max(0, value); break;
                        case 7: lift = Mathf.Clamp(value, -1, 1); break;
                        case 8: gamma = Mathf.Clamp(value, -1, 1); break;
                        default: gain = Mathf.Clamp(value, -1, 1); break;
                    }
                }
            }

            public const int Count = 10;

            /// <summary>有限差分的步长（输出是 8 位，步子太小差不出来）</summary>
            public static readonly float[] Step = { 0.04f, 2f, 2f, 2f, 2f, 0.02f, 0.05f, 0.01f, 0.02f, 0.02f };

            public override string ToString() =>
                $"曝光 {exposure:+0.000;-0.000}、对比 {contrast:0.##}、饱和 {saturation:0.##}、色温 {temperature:0.##}、色调 {tint:0.##}、暗角 {vignette:0.###}、Bloom {bloom:0.###}" +
                $"、提升 {lift:+0.000;-0.000}、伽马 {gamma:+0.000;-0.000}、增益 {gain:+0.000;-0.000}、第一人称补偿 ×{Fp:0.000} ^{FpGamma:0.000} 特效 ×{FpFx:0.000} 饱和 ×{FpSat:0.00} 火焰 ×{FpFlash:0.00}";

            public string Raw()
            {
                var self = this;
                return string.Join(" ", Enumerable.Range(0, Count).Select(i => self[i].ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture)));
            }
        }

        /// <summary>改前（两遍后处理时代）的各章 Volume 值 = 当时的 ShowcaseTheme</summary>
        public static Look Old(string chapterKey) => chapterKey switch
        {
            "Frost" => new Look { exposure = -0.35f, contrast = 14, saturation = -10, temperature = -14, vignette = 0.2f, bloom = 0.5f },
            "Inferno" => new Look { exposure = 0, contrast = 18, saturation = 4, temperature = 6, vignette = 0.28f, bloom = 1f },
            _ => new Look { exposure = -0.25f, contrast = 16, saturation = -6, temperature = -4, vignette = 0.2f, bloom = 0.55f },
        };

        /// <summary>拟合的起点：每一项「叠两次」的近似</summary>
        static Look Doubled(Look o) => new()
        {
            exposure = o.exposure * 2,
            contrast = ((1 + o.contrast / 100f) * (1 + o.contrast / 100f) - 1) * 100,
            saturation = ((1 + o.saturation / 100f) * (1 + o.saturation / 100f) - 1) * 100,
            temperature = o.temperature * 2,
            tint = 0,
            vignette = 1 - (1 - o.vignette) * (1 - o.vignette),
            bloom = o.bloom,
        };

        sealed class ViewShot
        {
            public string name;
            public Vector3 eye;
            public Quaternion rot;
            public Color32[] reference;
        }

        PlayerRig rig;
        Camera main;
        RenderTexture rt;
        Texture2D tex;
        Volume volume;
        VolumeProfile shared, clone;
        readonly List<VolumeComponent> clonedComponents = new();
        readonly List<string> report = new();
        string FilePrefix => Fit ? "fp_grade" : "fp_look";

        protected override IEnumerator Steps()
        {
            var quality = ArtQuality.Level;
            bool legacy0 = FirstPersonView.LegacyOverlay;
            try
            {
                foreach (var code in Stages)
                    yield return Level(code);
            }
            finally
            {
                Restore();
                FirstPersonView.LegacyOverlay = legacy0;
                ArtQuality.Set(quality, false);
                if (rt)
                {
                    rt.Release();
                    Destroy(rt);
                }
                if (tex) Destroy(tex);
            }
            File.WriteAllLines(Path.Combine(ShotDir, $"{FilePrefix}_{Id}.txt"), report);
        }

        void Out(string s)
        {
            report.Add(s);
            Line(s);
        }

        void Restore()
        {
            if (volume && shared) volume.sharedProfile = shared;
            foreach (var c in clonedComponents)
                if (c) Destroy(c);
            clonedComponents.Clear();
            if (clone) Destroy(clone);
            clone = null;
            volume = null;
            shared = null;
            if (main) main.targetTexture = null;
        }

        IEnumerator Level(string code)
        {
            var stage = RunPlan.Get(code);
            if (stage == null)
            {
                Fail($"RunPlan 里没有 {code}");
                yield break;
            }
            yield return WaitReady();
            var flow = SceneFlow.Instance;
            if (!flow) yield break;
            if (flow.Current != stage)
            {
                int before = flow.Transitions;
                if (!flow.GoTo(stage))
                {
                    Fail($"去不了 {stage.Label}");
                    yield break;
                }
                float t0 = Time.realtimeSinceStartup;
                while (Time.realtimeSinceStartup - t0 < ReadyTimeout && (flow.Busy || flow.Transitions <= before || flow.Player == null)) yield return null;
                if (flow.Busy || flow.Current != stage)
                {
                    Fail($"换到 {stage.Label} 超时");
                    yield break;
                }
                yield return new WaitForSecondsRealtime(1f);
            }
            rig = flow.Player;
            if (rig == null || !rig.root)
            {
                Fail("没有玩家");
                yield break;
            }
            main = rig.cam;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            rig.vitals.invulnerableUntil = Time.time + 99999;
            var scene = flow.CurrentScene;
            foreach (var s in FindObjectsByType<EncounterSite>())
                if (s.gameObject.scene == scene) s.enabled = false;
            foreach (var b in FindObjectsByType<BossEncounter>())
                if (b.gameObject.scene == scene) b.enabled = false;
            foreach (var w in FindObjectsByType<WeatherDirector>()) w.enabled = false;
            // 天气 Volume 归零（只看关卡自己的 Volume；玩法 Volume 平时权重就是 0，画质档那个留着）
            foreach (var v in FindObjectsByType<Volume>())
                if (v.name.StartsWith("Weather Volume")) v.weight = 0;

            volume = FindObjectsByType<Volume>().FirstOrDefault(v => v.isGlobal && v.sharedProfile && v.sharedProfile.name.StartsWith("VP_") && v.gameObject.scene == scene)
                     ?? FindObjectsByType<Volume>().FirstOrDefault(v => v.isGlobal && v.sharedProfile && v.sharedProfile.name.StartsWith("VP_"));
            if (!volume)
            {
                Fail($"{code}：找不到关卡的 Volume（VP_*）");
                yield break;
            }
            shared = volume.sharedProfile;
            string chapter = shared.name.Replace("VP_", "");
            // 深拷贝（组件也各复制一份）：只改运行时副本，资产不动
            clone = ScriptableObject.CreateInstance<VolumeProfile>();
            clone.name = shared.name + " (fp-grade)";
            foreach (var c in shared.components)
            {
                if (!c) continue;
                var copy = Instantiate(c);
                copy.name = c.name;
                clone.components.Add(copy);
                clonedComponents.Add(copy);
            }
            clone.isDirty = true;
            volume.sharedProfile = clone;
            var current = Read(clone);
            if (!Fit && Overrides().TryGetValue(chapter, out var ov))
            {
                current = ov;
                Line($"  用 _Review/fp_grade_theta.txt 里的 {chapter} 值核对：{ov}");
            }
            var old = Old(chapter);

            ArtQuality.Set(ArtQualityLevel.High, false);
            // 让玩家站到出生点附近，枪模待机；等几帧让画质档、枪模姿态稳定
            yield return new WaitForSecondsRealtime(1.5f);

            var meta = LevelMeta.Current;
            var (spawnPos, spawnRot) = PlayerSpawn.Resolve(scene);
            var pois = meta ? (IReadOnlyList<LevelPoi>)meta.pois : LevelMeta.Collect(scene);
            var all = PerfViews.Compute(spawnPos, spawnRot, pois, meta ? meta.mapArea : default, true);
            var picked = all.Where(v => v.name == PerfViews.Spawn || v.name == PerfViews.Vista).ToList();
            var chain = all.Where(v => v.chain).ToList();
            if (chain.Count > 0) picked.Add(chain[0]);
            if (chain.Count > 2) picked.Add(chain[chain.Count / 2 + 1 < chain.Count ? chain.Count / 2 + 1 : chain.Count - 1]);
            var shots = picked.Select(v =>
            {
                var stand = PerfViews.Ground(v.stand);
                var eye = stand + Vector3.up * PlayerFactory.EyeHeight;
                var dir = v.look - eye;
                if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
                return new ViewShot { name = v.name, eye = eye, rot = Quaternion.LookRotation(dir) };
            }).ToList();
            Out($"── {code}「{meta?.title}」（{chapter}）：机位 {string.Join("、", shots.Select(s => s.name))}；工程里的值 {current}；改前的值 {old}");

            if (!rt) rt = new RenderTexture(W, H, 24) { name = "FpGrade RT" };
            if (!tex) tex = new Texture2D(W, H, TextureFormat.RGB24, false);

            // 参照：以前的做法（叠加相机、两遍后处理）+ 改前的 Volume 值。同一帧里拍完全部
            FirstPersonView.LegacyOverlay = true;
            Apply(old);
            foreach (var s in shots) s.reference = Capture(s);

            FirstPersonView.LegacyOverlay = false;
            Apply(old);
            var stats0 = Stats(shots, out var gun0);
            Out($"  单遍 + 改前的值（不调）：{stats0}；枪模区 {gun0:F2}");

            if (ActionsOnly)
            {
                Apply(current);
                yield return Actions(code, old, current, shots[0]);
            }
            else if (Fit)
            {
                float t0 = Time.realtimeSinceStartup;
                var best = Marquardt(shots, Doubled(old), out float loss, out var hess);
                Apply(best);
                var stats1 = Stats(shots, out var gun1);
                Out($"  拟合：{best}");
                Out($"  单遍 + 拟合值：{stats1}；枪模区 {gun1:F2}（均方差 {loss:F2}）");
                Out($"  FIT {code} {chapter} {best.Raw()}");
                var hs = new StringBuilder();
                for (int i = 0; i < Look.Count; i++)
                for (int j = 0; j < Look.Count; j++)
                    hs.Append(hess[i, j].ToString("0.######E+0", System.Globalization.CultureInfo.InvariantCulture)).Append(' ');
                Out($"  HESS {code} {chapter} {hs.ToString().Trim()}");
                Out($"  （拟合用了 {Time.realtimeSinceStartup - t0:F0} s）");
            }
            else
            {
                foreach (var tier in new[] { ArtQualityLevel.High, ArtQualityLevel.Low })
                {
                    ArtQuality.Set(tier, false);
                    yield return null;
                    yield return null;
                    FirstPersonView.LegacyOverlay = true;
                    Apply(old);
                    foreach (var s in shots) s.reference = Capture(s);
                    FirstPersonView.LegacyOverlay = false;
                    Apply(current);
                    var st = Stats(shots, out var gun, save: tier == ArtQualityLevel.High ? code : null);
                    Out($"  {ArtQuality.Label(tier)}档 · 单遍 + 工程里的值：{st}；枪模区 {gun:F2}");
                }
                ArtQuality.Set(ArtQualityLevel.High, false);
                if (code == Stages[0])
                {
                    yield return ThirdPerson(code, old, current, shots[0]);
                    yield return Actions(code, old, current, shots[0]);
                }
            }
            FirstPersonView.LegacyOverlay = true;
            Restore();
        }

        /// <summary>第三人称机位（单遍后处理，和图集一样）：改前的 Volume 值 / 现在的值各拍一张</summary>
        IEnumerator ThirdPerson(string code, Look old, Look current, ViewShot near)
        {
            var go = new GameObject("FpGrade Third Person Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 50;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 1500f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            cam.enabled = false;
            var fwd = near.rot * Vector3.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var target = near.eye + fwd * 6f - Vector3.up * 0.8f;
            go.transform.position = near.eye - fwd * 2.5f + side * 3f + Vector3.up * 1.2f;
            go.transform.LookAt(target);
            var prevMain = main;
            main = cam;
            var shot = new ViewShot { name = "第三人称", eye = go.transform.position, rot = go.transform.rotation };
            yield return null;
            Apply(old);
            var a = Capture(shot);
            Apply(current);
            var b = Capture(shot);
            Save($"{FilePrefix}_{code}_third_before", a);
            Save($"{FilePrefix}_{code}_third_after", b);
            var (lum, sat, con) = Moments(a, b, false);
            Out($"  第三人称（单遍，改前的值 → 现在的值）：上半屏 亮度 {lum:+0.00;-0.00}、饱和度 {sat:+0.00;-0.00}、对比度 {con:+0.00;-0.00}（0–255）");
            main = prevMain;
            Destroy(go);
        }

        /// <summary>
        /// 开火 / 换弹 / 技能出手（第一人称特效与 HC3 出手动作）：玩家站在出生机位，各触发一次，在同一帧里拍 改前（叠加相机 + 改前的值）/ 改后（单遍 + 现在的值）
        /// </summary>
        IEnumerator Actions(string code, Look old, Look current, ViewShot at)
        {
            var wc = rig.weapons;
            var motor = rig.motor;
            var cc = motor.GetComponent<CharacterController>();
            cc.enabled = false;
            motor.transform.position = at.eye - Vector3.up * PlayerFactory.EyeHeight + Vector3.up * 0.05f;
            cc.enabled = true;
            var look = at.eye + at.rot * Vector3.forward * 20f;
            Aim(motor, wc.eye.transform, look);
            yield return new WaitForSecondsRealtime(0.5f);
            var shot = new ViewShot { name = "动作" };
            curves.Clear();

            // 开火：按住扳机几帧，拍有枪口火焰的那一帧
            if (wc.Active != null) wc.Active.reserve = wc.Active.def.reserve;
            wc.testFire = true;
            for (int i = 0; i < 4; i++) yield return null;
            yield return Pair(code, "fire", old, current, shot);
            // 枪口火焰白芯：连开 12 帧，每帧在同一帧里比 改前（叠加相机 + 改前的值 + 火焰原色）/ 改后（单遍 + 现在的值 + 火焰 × 系数 × 候选倍数）
            yield return FlashFrames(code, old, current, shot);
            wc.testFire = false;

            // 换弹：打掉几发再换，拍换弹动作中段
            yield return new WaitForSecondsRealtime(0.4f);
            wc.testReload = true;
            yield return new WaitForSecondsRealtime(0.35f);
            yield return Pair(code, "reload", old, current, shot);
            wc.testReload = false;
            yield return new WaitForSecondsRealtime(1.5f);

            // 技能出手（主技能）
            var skills = rig.skills;
            if (skills)
            {
                skills.testQ = true;
                yield return new WaitForSecondsRealtime(0.22f);
                yield return Pair(code, "skill", old, current, shot);
            }
            yield return new WaitForSecondsRealtime(1f);
            ChooseExposure(code, current);
        }

        // ───────────── 第一人称曝光补偿 ─────────────

        /// <summary>补偿系数的候选（同一帧里逐个拍，看枪模和手的平均亮度）</summary>
        static readonly float[] Grid = Enumerable.Range(0, 31).Select(i => 1f + 0.075f * i).ToArray();
        /// <summary>伽马的候选</summary>
        static readonly float[] Gammas = { 1f, 1.04f, 1.08f, 1.12f, 1.16f, 1.2f };

        sealed class Curve
        {
            public string what;
            public float before;
            public float[][] after;
            public int pixels;
        }

        readonly List<Curve> curves = new();

        /// <summary>
        /// 枪模和手的像素：单遍下藏掉第一人称（枪模视图停用）拍一张、只藏枪口火焰拍一张，差出来的就是枪模和手（不含火焰）。
        /// 在这些像素上比改前（叠加相机 + 改前的值）和改后（单遍 + 现在的 Volume + 各候选补偿）的平均亮度；两边都藏掉枪口火焰
        /// （火焰的颜色是这一帧开头按当时的补偿系数算好的，同一帧里切回叠加相机时它不是改前的亮度，所以不比火焰本身，火焰另看白芯）
        /// </summary>
        void MeasureCurve(string what, ViewShot shot, Look old, Look current)
        {
            var vmCam = FirstPersonView.ViewCamera(main);
            if (!vmCam) return;
            var flash = new List<Renderer>();
            foreach (var r in vmCam.transform.root.GetComponentsInChildren<Renderer>(false))
                if (r.enabled && r.gameObject.layer == Layers.FirstPerson && InMuzzle(r.transform)) flash.Add(r);
            foreach (var mf in FindObjectsByType<MuzzleFlashes>())
                foreach (var r in mf.GetComponentsInChildren<Renderer>(false))
                    if (r.enabled && r.gameObject.layer == Layers.FirstPerson && !flash.Contains(r)) flash.Add(r);
            FirstPersonView.LegacyOverlay = false;
            var probe = current;
            probe.fp = 1;
            Apply(probe);
            foreach (var r in flash) r.enabled = false;
            FirstPersonView.LegacyOverlay = true;
            Apply(old);
            var before = Capture(shot);
            FirstPersonView.LegacyOverlay = false;
            Apply(probe);
            var gun = Capture(shot);
            vmCam.enabled = false;
            var none = Capture(shot);
            vmCam.enabled = true;
            foreach (var r in flash) r.enabled = true;
            var mask = new bool[W * H];
            int n = 0;
            for (int i = 0; i < mask.Length; i++)
            {
                var a = gun[i];
                var b = none[i];
                if (Math.Abs(a.r - b.r) + Math.Abs(a.g - b.g) + Math.Abs(a.b - b.b) > 9)
                {
                    mask[i] = true;
                    n++;
                }
            }
            if (n < 500)
            {
                Line($"    {what}：枪模像素太少（{n}），不参与补偿拟合");
                return;
            }
            var c = new Curve { what = what, before = MeanLuma(before, mask), after = new float[Gammas.Length][], pixels = n };
            foreach (var r in flash) r.enabled = false;
            for (int gi = 0; gi < Gammas.Length; gi++)
            {
                c.after[gi] = new float[Grid.Length];
                probe.fpGamma = Gammas[gi];
                for (int g = 0; g < Grid.Length; g++)
                {
                    probe.fp = Grid[g];
                    Apply(probe);
                    c.after[gi][g] = MeanLuma(Capture(shot), mask);
                }
            }
            foreach (var r in flash) r.enabled = true;
            Apply(current);
            curves.Add(c);
        }

        static readonly float[] FlashGrid = Enumerable.Range(0, 27).Select(i => 0.8f + 0.2f * i).ToArray();
        /// <summary>火焰颜色拟合的特效系数候选</summary>
        static readonly float[] FxGrid = Enumerable.Range(0, 13).Select(i => 0.8f + 0.1f * i).ToArray();
        /// <summary>火焰颜色拟合的饱和度候选</summary>
        static readonly float[] SatGrid = { 1f, 1.15f, 1.3f, 1.45f, 1.6f, 1.8f };

        static Color Sat(Color c, float s)
        {
            if (Mathf.Approximately(s, 1f)) return c;
            float l = 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
            return new Color(Mathf.Max(0, l + (c.r - l) * s), Mathf.Max(0, l + (c.g - l) * s), Mathf.Max(0, l + (c.b - l) * s), c.a);
        }

        static double Sse(Color32[] a, Color32[] b, bool[] mask)
        {
            double s = 0;
            long n = 0;
            for (int i = 0; i < a.Length; i++)
            {
                if (!mask[i]) continue;
                int dr = a[i].r - b[i].r, dg = a[i].g - b[i].g, db = a[i].b - b[i].b;
                s += dr * dr + dg * dg + db * db;
                n++;
            }
            return n > 0 ? s / n : 0;
        }
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        /// <summary>
        /// 枪口火焰：第一人称那份火焰的颜色在 LateUpdate 里按当时的 <see cref="FirstPersonView.FlashExposure"/> 写进属性块，
        /// 这里每帧把它除回原色，改前用原色、改后用 原色 × 系数 × 候选倍数，同一帧里拍，比白芯（火焰像素里最亮 100 个的平均亮度）。
        /// 每帧找出白芯不低于改前的最小倍数，取 12 帧里最大的那个（最难的一帧也不暗）；报现在的值下每帧的 改前 / 改后
        /// </summary>
        IEnumerator FlashFrames(string code, Look old, Look current, ViewShot shot)
        {
            var wc = rig.weapons;
            float need = FlashGrid[0], worstBefore = 0, worstAfter = 0, minMargin = float.MaxValue;
            Color32[] bestBefore = null, bestAfter = null;
            float bestPeak = 0, starBefore = 0, starAfter = 0;
            var fxSse = new double[SatGrid.Length, FxGrid.Length];
            var fxStar = new double[SatGrid.Length, FxGrid.Length];
            int frames = 0, coreFrames = 0;
            FirstPersonView.LegacyOverlay = false;
            Apply(current);
            for (int f = 0; f < 3; f++) yield return null;
            for (int f = 0; f < 12; f++)
            {
                if (wc.Active != null) wc.Active.reserve = wc.Active.def.reserve;
                yield return null;
                shot.eye = main.transform.position;
                shot.rot = main.transform.rotation;
                // 先空拍一张：这一帧开的那一枪在第一次渲染时才生成（见 Pair）
                Capture(shot);
                var parts = FlashParts();
                if (parts.Count == 0) continue;
                // 属性块里的颜色 = 原色 × 当时的补偿（白芯 FlashExposure，星芒 EffectsExposure）：除回原色
                float kHot = FirstPersonView.FlashExposure, kSide = FirstPersonView.EffectsExposure, sNow = FirstPersonView.EffectsSaturation;
                var mpb = new MaterialPropertyBlock();
                var hot = parts.Select(MuzzleFlashes.IsHotPart).ToList();
                var baseCols = parts.Select((r, i) =>
                {
                    r.GetPropertyBlock(mpb);
                    var c = mpb.GetColor(BaseColorId);
                    float k = hot[i] ? kHot : kSide;
                    return Sat(new Color(c.r / k, c.g / k, c.b / k, c.a), 1f / sNow);
                }).ToList();
                // s = 星芒的倍数，h = 白芯在星芒之外再乘的倍数，sat = 饱和度
                void SetScale(float s, float h = 1f, float sat = 1f)
                {
                    for (int i = 0; i < parts.Count; i++)
                    {
                        parts[i].GetPropertyBlock(mpb);
                        var c = Sat(baseCols[i], sat);
                        float m = hot[i] ? s * h : s;
                        mpb.SetColor(BaseColorId, new Color(c.r * m, c.g * m, c.b * m, c.a));
                        parts[i].SetPropertyBlock(mpb);
                    }
                }
                // 火焰的像素：叠加相机 + 改前的值下火焰开 / 关
                FirstPersonView.LegacyOverlay = true;
                Apply(old);
                SetScale(1f);
                var before = Capture(shot);
                foreach (var r in parts) r.enabled = false;
                var noFlash = Capture(shot);
                foreach (var r in parts) r.enabled = true;
                var mask = Diff(before, noFlash);
                float sb = MeanMasked(before, mask);
                if (sb <= 0) continue;
                // 白芯的像素：只关白芯那几片
                bool[] core = null;
                if (hot.Any(h => h))
                {
                    for (int i = 0; i < parts.Count; i++)
                        if (hot[i]) parts[i].enabled = false;
                    var noCore = Capture(shot);
                    for (int i = 0; i < parts.Count; i++) parts[i].enabled = true;
                    core = Diff(before, noCore);
                    if (core.Count(c => c) < TopN) core = null;
                }
                frames++;
                starBefore += sb;
                FirstPersonView.LegacyOverlay = false;
                Apply(current);
                // 特效系数、饱和度按火焰像素的 RGB 均方差拟合（只看亮度会把橙色星芒推成淡黄：颜色也要对）；同时记各组合的星芒平均亮度
                for (int si = 0; si < SatGrid.Length; si++)
                for (int fi = 0; fi < FxGrid.Length; fi++)
                {
                    SetScale(FxGrid[fi], 1f, SatGrid[si]);
                    var px = Capture(shot);
                    fxSse[si, fi] += Sse(before, px, mask);
                    fxStar[si, fi] += MeanMasked(px, mask);
                }
                SetScale(current.FpFx, current.FpFlash, current.FpSat);
                var after = Capture(shot);
                starAfter += MeanMasked(after, mask);
                if (core == null)
                {
                    SetScale(kSide, kHot / Mathf.Max(1e-4f, kSide), sNow);
                    continue;
                }
                coreFrames++;
                float pb = TopLuma(before, core);
                float pa = TopLuma(after, core);
                float needHere = FlashGrid[^1];
                var trace = new StringBuilder();
                foreach (var g in FlashGrid)
                {
                    SetScale(current.FpFx, g, current.FpSat);
                    float pg = TopLuma(Capture(shot), core);
                    if (coreFrames == 1) trace.Append($" ×{g:0.0}→{pg:F0}");
                    if (pg + 0.5f >= pb)
                    {
                        needHere = g;
                        break;
                    }
                }
                if (coreFrames == 1) Line($"    第一个有白芯的帧：改前 {pb:F0}；改后{trace}（火焰 {parts.Count} 片、其中白芯 {hot.Count(h => h)} 片、{core.Count(c => c)} 个像素）");
                if (coreFrames == 1)
                {
                    // 诊断：属性块到底有没有生效（全黑 / 原样 / 全部 ×4），以及白芯片的原色
                    SetScale(0f, 0f);
                    float z0 = TopLuma(Capture(shot), core), m0 = MeanMasked(Capture(shot), mask);
                    SetScale(current.FpFx, 1f);
                    float z1 = TopLuma(Capture(shot), core), m1 = MeanMasked(Capture(shot), mask);
                    SetScale(current.FpFx * 4f, 4f);
                    float z4 = TopLuma(Capture(shot), core), m4 = MeanMasked(Capture(shot), mask);
                    var hc = baseCols.Where((c, i) => hot[i]).Select(c => $"({c.r:F2},{c.g:F2},{c.b:F2},{c.a:F2})");
                    Line($"    诊断：火焰全黑 白芯 {z0:F0} / 火焰平均 {m0:F0}；原样 {z1:F0} / {m1:F0}；全部 ×4 {z4:F0} / {m4:F0}；白芯原色 {string.Join(" ", hc)}；kHot {kHot:F2} kSide {kSide:F2}");
                }
                need = Mathf.Max(need, needHere);
                if (pa - pb < minMargin)
                {
                    minMargin = pa - pb;
                    worstBefore = pb;
                    worstAfter = pa;
                }
                if (pb > bestPeak)
                {
                    bestPeak = pb;
                    bestBefore = before;
                    bestAfter = after;
                }
                SetScale(kSide, kHot / Mathf.Max(1e-4f, kSide), sNow);
            }
            FirstPersonView.LegacyOverlay = false;
            Apply(current);
            if (bestBefore != null) Save($"{FilePrefix}_{code}_flash_before", bestBefore);
            if (bestAfter != null) Save($"{FilePrefix}_{code}_flash_after", bestAfter);
            Out($"  枪口火焰星芒（火焰像素的平均亮度，{frames} 帧平均）：改前 {starBefore / Math.Max(1, frames):F0} → 改后 {starAfter / Math.Max(1, frames):F0}");
            Out($"  枪口火焰白芯（白芯像素里最亮 {TopN} 个的平均亮度，{coreFrames} 帧有白芯，每帧同一帧比）：现在的值（星芒 ×{current.FpFx:0.00}、白芯再 ×{current.FpFlash:0.0}）最吃亏的一帧 改前 {worstBefore:F0} → 改后 {worstAfter:F0}" +
                $"{(minMargin >= -0.5f ? "" : "（变暗）")}；12 帧都不低于改前需要白芯倍数 ≥ {need:0.0}（在特效系数之外）");
            Out($"  FLASH {code} {volume?.sharedProfile?.name?.Replace("VP_", "").Replace(" (fp-grade)", "")} {need.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)}");
            // 星芒平均亮度不低于改前的组合里，RGB 均方差最小的那个
            int bs = 0, bf = 0;
            double bestSse = double.MaxValue, starRef = starBefore / Math.Max(1, frames);
            for (int si = 0; si < SatGrid.Length; si++)
            for (int fi = 0; fi < FxGrid.Length; fi++)
            {
                if (fxStar[si, fi] / Math.Max(1, frames) + 0.5 < starRef) continue;
                if (fxSse[si, fi] < bestSse)
                {
                    bestSse = fxSse[si, fi];
                    bs = si;
                    bf = fi;
                }
            }
            var ci = System.Globalization.CultureInfo.InvariantCulture;
            for (int si = 0; si < SatGrid.Length; si++)
                Out($"  火焰颜色 饱和 ×{SatGrid[si]:0.00}（RGB 均方差 / 星芒亮度）：" +
                    string.Join(" ", FxGrid.Select((g, fi) => $"×{g:0.0}:{fxSse[si, fi] / Math.Max(1, frames):0}/{fxStar[si, fi] / Math.Max(1, frames):0}")));
            Out($"  FXRGB {code} {volume?.sharedProfile?.name?.Replace("VP_", "").Replace(" (fp-grade)", "")} {FxGrid[bf].ToString("0.0", ci)} {SatGrid[bs].ToString("0.00", ci)}" +
                $"（星芒不低于改前 {starRef:F0} 的组合里 RGB 均方差最小：{bestSse / Math.Max(1, frames):0}）");
        }

        List<Renderer> FlashParts()
        {
            var list = new List<Renderer>();
            foreach (var mf in FindObjectsByType<MuzzleFlashes>())
                foreach (var r in mf.GetComponentsInChildren<Renderer>(false))
                    if (r.enabled && r.gameObject.layer == Layers.FirstPerson && InMuzzle(r.transform)) list.Add(r);
            var vmCam = FirstPersonView.ViewCamera(main);
            if (vmCam)
                foreach (var r in vmCam.transform.root.GetComponentsInChildren<Renderer>(false))
                    if (r.enabled && r.gameObject.layer == Layers.FirstPerson && InMuzzle(r.transform) && !list.Contains(r)) list.Add(r);
            return list;
        }

        static float TopLuma(Color32[] px, bool[] mask)
        {
            var lum = new List<float>();
            for (int i = 0; i < px.Length; i++)
                if (mask[i]) lum.Add(Luma(px[i]));
            if (lum.Count == 0) return 0;
            lum.Sort();
            int n = Math.Min(TopN, lum.Count);
            float s = 0;
            for (int i = 0; i < n; i++) s += lum[lum.Count - 1 - i];
            return s / n;
        }

        /// <summary>白芯 = 火焰像素里最亮的这么多个（1280×720 下白芯大约这么大）</summary>
        const int TopN = 24;

        /// <summary>星芒 = 火焰像素的平均亮度（星芒读不读得出来）</summary>
        static bool[] Diff(Color32[] a, Color32[] b)
        {
            var m = new bool[a.Length];
            for (int i = 0; i < m.Length; i++)
                m[i] = Math.Abs(a[i].r - b[i].r) + Math.Abs(a[i].g - b[i].g) + Math.Abs(a[i].b - b[i].b) > 12;
            return m;
        }

        static float MeanMasked(Color32[] px, bool[] mask)
        {
            double s = 0;
            long n = 0;
            for (int i = 0; i < px.Length; i++)
                if (mask[i])
                {
                    s += Luma(px[i]);
                    n++;
                }
            return n > 0 ? (float)(s / n) : 0;
        }

        /// <summary>这一帧的枪口火焰白芯：火焰开 / 关各拍一张，差出来的像素里最亮 100 个的平均亮度（没有火焰 = 0）</summary>
        float FlashPeak(ViewShot shot, out Color32[] withFlash)
        {
            var flash = new List<Renderer>();
            foreach (var mf in FindObjectsByType<MuzzleFlashes>())
                foreach (var r in mf.GetComponentsInChildren<Renderer>(false))
                    if (r.enabled && r.gameObject.layer == Layers.FirstPerson) flash.Add(r);
            var vmCam = FirstPersonView.ViewCamera(main);
            if (vmCam)
                foreach (var r in vmCam.transform.root.GetComponentsInChildren<Renderer>(false))
                    if (r.enabled && r.gameObject.layer == Layers.FirstPerson && InMuzzle(r.transform) && !flash.Contains(r)) flash.Add(r);
            withFlash = Capture(shot);
            if (flash.Count == 0) return 0;
            foreach (var r in flash) r.enabled = false;
            var without = Capture(shot);
            foreach (var r in flash) r.enabled = true;
            var lum = new List<float>();
            for (int i = 0; i < withFlash.Length; i++)
            {
                var a = withFlash[i];
                var b = without[i];
                if (Math.Abs(a.r - b.r) + Math.Abs(a.g - b.g) + Math.Abs(a.b - b.b) > 12) lum.Add(Luma(a));
            }
            if (lum.Count == 0) return 0;
            lum.Sort();
            int n = Math.Min(100, lum.Count);
            float s = 0;
            for (int i = 0; i < n; i++) s += lum[lum.Count - 1 - i];
            return s / n;
        }

        static bool InMuzzle(Transform t)
        {
            for (; t; t = t.parent)
                if (t.name.StartsWith("Muzzle Flash")) return true;
            return false;
        }

        static float MeanLuma(Color32[] px, bool[] mask)
        {
            double s = 0;
            long n = 0;
            for (int i = 0; i < px.Length; i++)
            {
                if (!mask[i]) continue;
                s += Luma(px[i]);
                n++;
            }
            return n > 0 ? (float)(s / n) : 0;
        }

        /// <summary>
        /// 选补偿：每个伽马候选上找系数，让三个动作里相对亮度误差最大的那个最小（系数在网格上线性插值到 0.005；要求 ≤ 3%）；
        /// 伽马取最大误差最小的那个，并列时取更接近 1 的
        /// </summary>
        void ChooseExposure(string code, Look current)
        {
            if (curves.Count == 0) return;
            float Err(int gi, float k)
            {
                float worst = 0;
                foreach (var c in curves) worst = Mathf.Max(worst, Mathf.Abs(Interp(c, gi, k) / Mathf.Max(1, c.before) - 1));
                return worst;
            }
            int bestG = 0;
            float best = 1, bestErr = float.MaxValue;
            for (int gi = 0; gi < Gammas.Length; gi++)
                for (float k = Grid[0]; k <= Grid[^1] + 1e-4f; k += 0.005f)
                {
                    float e = Err(gi, k);
                    if (e < bestErr - 0.001f)
                    {
                        bestErr = e;
                        best = k;
                        bestG = gi;
                    }
                }
            int curG = 0;
            for (int gi = 1; gi < Gammas.Length; gi++)
                if (Mathf.Abs(Gammas[gi] - current.FpGamma) < Mathf.Abs(Gammas[curG] - current.FpGamma)) curG = gi;
            foreach (var c in curves)
                Out($"  {c.what}：枪模和手 {c.pixels} 个像素，改前平均亮度 {c.before:F1}；改后 不补偿 {c.after[0][0]:F1}（{c.after[0][0] / c.before - 1:+0.0%;-0.0%}）、" +
                    $"×{best:0.000} ^{Gammas[bestG]:0.00} {Interp(c, bestG, best):F1}（{Interp(c, bestG, best) / c.before - 1:+0.0%;-0.0%}）；" +
                    $"现在的值 ×{current.Fp:0.000} ^{Gammas[curG]:0.00} {Interp(c, curG, current.Fp):F1}（{Interp(c, curG, current.Fp) / c.before - 1:+0.0%;-0.0%}）");
            float fxK = 1, fxErr = float.MaxValue;
            for (float k = Grid[0]; k <= Grid[^1] + 1e-4f; k += 0.005f)
            {
                float e = Err(0, k);
                if (e < fxErr)
                {
                    fxErr = e;
                    fxK = k;
                }
            }
            var ci = System.Globalization.CultureInfo.InvariantCulture;
            Out($"  FPK {code} {volume?.sharedProfile?.name?.Replace("VP_", "").Replace(" (fp-grade)", "")} " +
                $"{best.ToString("0.000", ci)} {Gammas[bestG].ToString("0.00", ci)} {fxK.ToString("0.000", ci)}" +
                $"（三个动作里最大误差 {bestErr:0.0%}；只用系数（伽马 1，特效用它）×{fxK:0.000} 时 {fxErr:0.0%}）");
        }

        static float Interp(Curve c, int gi, float k)
        {
            var a = c.after[gi];
            if (k <= Grid[0]) return a[0];
            for (int i = 1; i < Grid.Length; i++)
                if (k <= Grid[i])
                {
                    float t = (k - Grid[i - 1]) / (Grid[i] - Grid[i - 1]);
                    return Mathf.Lerp(a[i - 1], a[i], t);
                }
            return a[^1];
        }

        IEnumerator Pair(string code, string what, Look old, Look current, ViewShot shot)
        {
            shot.eye = main.transform.position;
            shot.rot = main.transform.rotation;
            // 这一帧第一次渲染时 MuzzleFlashes 才把这一帧开的那一枪生成出来（beginContextRendering）：先空拍一张，后面几张画面里的火焰才是同一套
            FirstPersonView.LegacyOverlay = false;
            Apply(current);
            Capture(shot);
            FirstPersonView.LegacyOverlay = true;
            Apply(old);
            var a = Capture(shot);
            FirstPersonView.LegacyOverlay = false;
            Apply(current);
            var b = Capture(shot);
            Save($"{FilePrefix}_{code}_{what}_before", a);
            Save($"{FilePrefix}_{code}_{what}_after", b);
            var (lum, sat, con) = Moments(a, b, true);
            Out($"  {what}（改前 → 改后）：上半屏 亮度 {lum:+0.00;-0.00}、饱和度 {sat:+0.00;-0.00}、对比度 {con:+0.00;-0.00}；枪模区 {GunMae(a, b):F2}；" +
                $"右下最亮 200 个像素的平均亮度（枪口火焰白芯）{Peak(a):F0} → {Peak(b):F0}");
            MeasureCurve(what, shot, old, current);
            yield return null;
        }

        /// <summary>右下（枪模、枪口所在）最亮的 200 个像素的平均亮度：开火那一帧就是枪口火焰的白芯</summary>
        static float Peak(Color32[] px)
        {
            var l = new List<float>(W * H / 4);
            for (int y = 0; y < H / 2; y++)
            for (int x = W / 2; x < W; x++)
                l.Add(Luma(px[y * W + x]));
            l.Sort();
            float s = 0;
            int n = Math.Min(200, l.Count);
            for (int i = 0; i < n; i++) s += l[l.Count - 1 - i];
            return n > 0 ? s / n : 0;
        }

        static float GunMae(Color32[] a, Color32[] b)
        {
            double sum = 0;
            long n = 0;
            for (int y = 0; y < H / 2; y += Sub)
            for (int x = W / 2; x < W; x += Sub)
            {
                int i = y * W + x;
                sum += (Math.Abs(a[i].r - b[i].r) + Math.Abs(a[i].g - b[i].g) + Math.Abs(a[i].b - b[i].b)) / 3.0;
                n++;
            }
            return n > 0 ? (float)(sum / n) : 0;
        }

        // ───────────── 拟合 ─────────────

        /// <summary>
        /// Levenberg–Marquardt：残差 = 各机位世界区域（隔 <see cref="Sub"/> 个像素取一个、去掉枪模）的 RGB 差，雅可比用有限差分（每次迭代 10 次求值）。
        /// hessian 输出 JᵀJ / 残差数，章节的共同值按各关的 JᵀJ 加权平均（scripts/unity/fp_grade_combine.py）
        /// </summary>
        Look Marquardt(List<ViewShot> shots, Look start, out float loss, out double[,] hessian)
        {
            const int n = Look.Count;
            var x = start;
            var r = Residual(shots, x);
            double l = Dot(r, r);
            double lambda = 1e-3;
            int evals = 1;
            hessian = new double[n, n];
            var cols = new float[n][];
            for (int it = 0; it < 12; it++)
            {
                for (int i = 0; i < n; i++)
                {
                    var y = x;
                    y[i] = x[i] + Look.Step[i];
                    float h = y[i] - x[i];
                    if (Mathf.Abs(h) < 1e-6f)
                    {
                        y[i] = x[i] - Look.Step[i];
                        h = y[i] - x[i];
                    }
                    var ri = Residual(shots, y);
                    evals++;
                    var c = cols[i] ??= new float[r.Length];
                    for (int k = 0; k < r.Length; k++) c[k] = (ri[k] - r[k]) / h;
                }
                var a = new double[n, n];
                var g = new double[n];
                for (int i = 0; i < n; i++)
                {
                    g[i] = Dot(cols[i], r);
                    for (int j = i; j < n; j++) a[i, j] = a[j, i] = Dot(cols[i], cols[j]);
                }
                for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    hessian[i, j] = a[i, j] / r.Length;
                bool stepped = false;
                for (int tries = 0; tries < 5; tries++)
                {
                    var m = (double[,])a.Clone();
                    for (int i = 0; i < n; i++) m[i, i] += lambda * Math.Max(a[i, i], 1e-9);
                    var d = Solve(m, g.Select(v => -v).ToArray());
                    if (d == null) break;
                    var y = x;
                    for (int i = 0; i < n; i++) y[i] = x[i] + (float)d[i];
                    var ry = Residual(shots, y);
                    evals++;
                    double ly = Dot(ry, ry);
                    if (ly < l)
                    {
                        bool small = (l - ly) / l < 0.002;
                        x = y;
                        r = ry;
                        l = ly;
                        lambda = Math.Max(1e-6, lambda * 0.3);
                        stepped = !small;
                        break;
                    }
                    lambda *= 8;
                }
                if (!stepped) break;
            }
            loss = (float)(l / r.Length);
            Line($"    Levenberg–Marquardt {evals} 次求值，均方差 {loss:F2}");
            return x;
        }

        static double Dot(float[] a, float[] b)
        {
            double s = 0;
            for (int i = 0; i < a.Length; i++) s += (double)a[i] * b[i];
            return s;
        }

        /// <summary>高斯消元（部分主元）；奇异时返回 null</summary>
        static double[] Solve(double[,] a, double[] b)
        {
            int n = b.Length;
            var m = (double[,])a.Clone();
            var x = (double[])b.Clone();
            for (int c = 0; c < n; c++)
            {
                int p = c;
                for (int r = c + 1; r < n; r++)
                    if (Math.Abs(m[r, c]) > Math.Abs(m[p, c])) p = r;
                if (Math.Abs(m[p, c]) < 1e-12) return null;
                if (p != c)
                {
                    for (int k = 0; k < n; k++) (m[c, k], m[p, k]) = (m[p, k], m[c, k]);
                    (x[c], x[p]) = (x[p], x[c]);
                }
                for (int r = c + 1; r < n; r++)
                {
                    double f = m[r, c] / m[c, c];
                    for (int k = c; k < n; k++) m[r, k] -= f * m[c, k];
                    x[r] -= f * x[c];
                }
            }
            for (int r = n - 1; r >= 0; r--)
            {
                double s = x[r];
                for (int k = r + 1; k < n; k++) s -= m[r, k] * x[k];
                x[r] = s / m[r, r];
            }
            return x;
        }

        /// <summary>残差向量：候选 − 参照（世界区域，隔 Sub 取样）</summary>
        float[] Residual(List<ViewShot> shots, Look look)
        {
            Apply(look);
            var res = new List<float>(shots.Count * (W / Sub) * (H / Sub) * 3);
            foreach (var s in shots)
            {
                var px = Capture(s);
                for (int y = 0; y < H; y += Sub)
                for (int x = 0; x < W; x += Sub)
                {
                    if (Gun(x, y)) continue;
                    int i = y * W + x;
                    var a = s.reference[i];
                    var b = px[i];
                    res.Add(b.r - a.r);
                    res.Add(b.g - a.g);
                    res.Add(b.b - a.b);
                }
            }
            return res.ToArray();
        }

        /// <summary>枪模所在的右下角（纹理行从下往上）</summary>
        static bool Gun(int x, int y) => x > W * 0.5f && y < H * 0.5f;

        string Stats(List<ViewShot> shots, out float gunMae, string save = null)
        {
            double mae = 0, gun = 0;
            long n = 0, ng = 0;
            float lum = 0, sat = 0, con = 0;
            var per = new List<string>();
            foreach (var s in shots)
            {
                var px = Capture(s);
                if (save != null)
                {
                    Save($"{FilePrefix}_{save}_{shots.IndexOf(s)}_before", s.reference);
                    Save($"{FilePrefix}_{save}_{shots.IndexOf(s)}_after", px);
                }
                for (int y = 0; y < H; y += Sub)
                for (int x = 0; x < W; x += Sub)
                {
                    int i = y * W + x;
                    var a = s.reference[i];
                    var b = px[i];
                    int d = Math.Abs(a.r - b.r) + Math.Abs(a.g - b.g) + Math.Abs(a.b - b.b);
                    if (Gun(x, y))
                    {
                        gun += d / 3.0;
                        ng++;
                    }
                    else
                    {
                        mae += d / 3.0;
                        n++;
                    }
                }
                var (l, sa, c) = Moments(s.reference, px, true);
                lum += l / shots.Count;
                sat += sa / shots.Count;
                con += c / shots.Count;
                per.Add($"{s.name} {l:+0.0;-0.0}/{sa:+0.0;-0.0}/{c:+0.0;-0.0}");
            }
            gunMae = ng > 0 ? (float)(gun / ng) : 0;
            return $"世界逐像素平均差 {mae / Math.Max(1, n):F2}；上半屏 亮度 {lum:+0.00;-0.00}、饱和度 {sat:+0.00;-0.00}、对比度 {con:+0.00;-0.00}（各机位 亮/饱/对：{string.Join("，", per)}）";
        }

        /// <summary>上半屏（去掉枪模）b 相对 a 的平均亮度、平均饱和度、亮度标准差之差（0–255）</summary>
        static (float lum, float sat, float con) Moments(Color32[] a, Color32[] b, bool skipGun)
        {
            double la = 0, lb = 0, sa = 0, sb = 0, qa = 0, qb = 0;
            long n = 0;
            for (int y = H / 2; y < H; y += Sub)
            for (int x = 0; x < W; x += Sub)
            {
                if (skipGun && Gun(x, y)) continue;
                int i = y * W + x;
                float ya = Luma(a[i]), yb = Luma(b[i]);
                la += ya;
                lb += yb;
                qa += ya * ya;
                qb += yb * yb;
                sa += Sat(a[i]);
                sb += Sat(b[i]);
                n++;
            }
            if (n == 0) return (0, 0, 0);
            double ma = la / n, mb = lb / n;
            double sda = Math.Sqrt(Math.Max(0, qa / n - ma * ma)), sdb = Math.Sqrt(Math.Max(0, qb / n - mb * mb));
            return ((float)(mb - ma), (float)((sb - sa) / n), (float)(sdb - sda));
        }

        static float Luma(Color32 c) => 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;

        static float Sat(Color32 c)
        {
            int max = Math.Max(c.r, Math.Max(c.g, c.b)), min = Math.Min(c.r, Math.Min(c.g, c.b));
            return max == 0 ? 0 : 255f * (max - min) / max;
        }

        /// <summary>核对用的覆盖值：Assets/Art/_Review/fp_grade_theta.txt，每行「章 v0 … v9」（同 <see cref="Look.Raw"/>）；没有这个文件就用工程里的 Volume 值</summary>
        Dictionary<string, Look> Overrides()
        {
            var d = new Dictionary<string, Look>();
            var path = Path.Combine(ShotDir ?? "", "fp_grade_theta.txt");
            if (!File.Exists(path)) return d;
            foreach (var line in File.ReadAllLines(path))
            {
                var t = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (t.Length < Look.Count + 1 || t[0].StartsWith("#")) continue;
                var l = new Look();
                for (int i = 0; i < Look.Count; i++) l[i] = float.Parse(t[i + 1], System.Globalization.CultureInfo.InvariantCulture);
                if (t.Length > Look.Count + 1) l.fp = float.Parse(t[Look.Count + 1], System.Globalization.CultureInfo.InvariantCulture);
                if (t.Length > Look.Count + 2) l.fpGamma = float.Parse(t[Look.Count + 2], System.Globalization.CultureInfo.InvariantCulture);
                if (t.Length > Look.Count + 3) l.fpFlash = float.Parse(t[Look.Count + 3], System.Globalization.CultureInfo.InvariantCulture);
                if (t.Length > Look.Count + 4) l.fpFx = float.Parse(t[Look.Count + 4], System.Globalization.CultureInfo.InvariantCulture);
                if (t.Length > Look.Count + 5) l.fpSat = float.Parse(t[Look.Count + 5], System.Globalization.CultureInfo.InvariantCulture);
                d[t[0]] = l;
            }
            return d;
        }

        // ───────────── Volume ─────────────

        Look Read(VolumeProfile p)
        {
            var l = new Look();
            if (p.TryGet<ColorAdjustments>(out var ca))
            {
                l.exposure = ca.postExposure.value;
                l.contrast = ca.contrast.value;
                l.saturation = ca.saturation.value;
            }
            if (p.TryGet<WhiteBalance>(out var wb))
            {
                l.temperature = wb.temperature.value;
                l.tint = wb.tint.value;
            }
            if (p.TryGet<Vignette>(out var vg)) l.vignette = vg.intensity.value;
            if (p.TryGet<Bloom>(out var bl)) l.bloom = bl.intensity.value;
            if (p.TryGet<LiftGammaGain>(out var lgg))
            {
                l.lift = lgg.lift.value.w;
                l.gamma = lgg.gamma.value.w;
                l.gain = lgg.gain.value.w;
            }
            if (p.TryGet<FirstPersonExposure>(out var fpe))
            {
                l.fp = fpe.multiplier.overrideState ? fpe.multiplier.value : 1f;
                l.fpGamma = fpe.gamma.overrideState ? fpe.gamma.value : 1f;
                l.fpFlash = fpe.flash.overrideState ? fpe.flash.value : 1f;
                l.fpFx = fpe.effects.overrideState ? fpe.effects.value : 1f;
                l.fpSat = fpe.effectsSaturation.overrideState ? fpe.effectsSaturation.value : 1f;
            }
            return l;
        }

        void Apply(Look l)
        {
            if (!clone) return;
            if (!clone.TryGet<ColorAdjustments>(out var ca)) clonedComponents.Add(ca = clone.Add<ColorAdjustments>());
            ca.postExposure.Override(l.exposure);
            ca.contrast.Override(l.contrast);
            ca.saturation.Override(l.saturation);
            if (!clone.TryGet<WhiteBalance>(out var wb)) clonedComponents.Add(wb = clone.Add<WhiteBalance>());
            wb.temperature.Override(l.temperature);
            wb.tint.Override(l.tint);
            if (!clone.TryGet<Vignette>(out var vg)) clonedComponents.Add(vg = clone.Add<Vignette>());
            vg.intensity.Override(l.vignette);
            if (!clone.TryGet<Bloom>(out var bl)) clonedComponents.Add(bl = clone.Add<Bloom>());
            bl.intensity.Override(l.bloom);
            if (!clone.TryGet<LiftGammaGain>(out var lgg)) clonedComponents.Add(lgg = clone.Add<LiftGammaGain>());
            lgg.lift.Override(new Vector4(1, 1, 1, l.lift));
            lgg.gamma.Override(new Vector4(1, 1, 1, l.gamma));
            lgg.gain.Override(new Vector4(1, 1, 1, l.gain));
            if (!clone.TryGet<FirstPersonExposure>(out var fpe)) clonedComponents.Add(fpe = clone.Add<FirstPersonExposure>());
            fpe.multiplier.Override(l.Fp);
            fpe.gamma.Override(l.FpGamma);
            fpe.flash.Override(l.FpFlash);
            fpe.effects.Override(l.FpFx);
            fpe.effectsSaturation.Override(l.FpSat);
        }

        // ───────────── 拍图 ─────────────

        Color32[] Capture(ViewShot s)
        {
            main.transform.SetPositionAndRotation(s.eye, s.rot);
            var prev = main.targetTexture;
            main.targetTexture = rt;
            main.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            main.targetTexture = prev;
            return tex.GetPixels32();
        }

        void Save(string name, Color32[] px)
        {
            if (string.IsNullOrEmpty(ShotDir)) return;
            var t = new Texture2D(W, H, TextureFormat.RGB24, false);
            t.SetPixels32(px);
            t.Apply();
            File.WriteAllBytes(Path.Combine(ShotDir, $"{name}.png"), t.EncodeToPNG());
            Destroy(t);
        }

        IEnumerator WaitReady()
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < ReadyTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(1f);
        }
    }

    public sealed class FpGradeCh1Suite : FpGradeSuite
    {
        public override string Id => "fp-grade-ch1";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "1-2", "1-3", "1-4" };
        protected override bool Fit => true;
    }

    public sealed class FpGradeCh2Suite : FpGradeSuite
    {
        public override string Id => "fp-grade-ch2";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";
        protected override string[] Stages => new[] { "2-1", "2-2", "2-3", "2-4" };
        protected override bool Fit => true;
    }

    public sealed class FpGradeCh3Suite : FpGradeSuite
    {
        public override string Id => "fp-grade-ch3";
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";
        protected override string[] Stages => new[] { "3-1", "3-2", "3-3", "3-4" };
        protected override bool Fit => true;
    }

    /// <summary>开火 / 换弹 / 技能（第一人称补偿和枪口火焰白芯）：三章各第一关，不核对世界</summary>
    public sealed class FpShotsSuite : FpGradeSuite
    {
        public override string Id => "fp-shots";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "2-1", "3-1" };
        protected override bool Fit => false;
        protected override bool ActionsOnly => true;
    }

    public sealed class FpLookCh1Suite : FpGradeSuite
    {
        public override string Id => "fp-look-ch1";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "1-2", "1-3", "1-4" };
        protected override bool Fit => false;
    }

    public sealed class FpLookCh2Suite : FpGradeSuite
    {
        public override string Id => "fp-look-ch2";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";
        protected override string[] Stages => new[] { "2-1", "2-2", "2-3", "2-4" };
        protected override bool Fit => false;
    }

    public sealed class FpLookCh3Suite : FpGradeSuite
    {
        public override string Id => "fp-look-ch3";
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";
        protected override string[] Stages => new[] { "3-1", "3-2", "3-3", "3-4" };
        protected override bool Fit => false;
    }
}
