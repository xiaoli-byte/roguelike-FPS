using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第四章 VP_Plateau 的单遍调色核对（bridge.sh playtest look-plateau；F 路，2026-11-01）。
    /// 第四章没有「两遍后处理时代」的改前画面，不做拟合：用 fp-look 同一套机位（PerfViews 的出生、中段远眺、主线两段，第一人称、枪模和世界同一遍后处理），
    /// 在 4-1 的关卡 Volume 运行时副本上依次套几组候选值，报上半屏（去掉右下枪模区）的绝对平均亮度 / 饱和度 / 亮度标准差（0–255），每组存出生和远眺两张图；
    /// 再到 1-1、2-1 用工程里的值量一遍同样的数，作「同一个游戏」的亮度参照（第一章亮沙、第二章雪）。天气导演、场地、首领遭遇停掉，天气 Volume 归零。
    /// 只读不写：资产不动，候选值写在 <see cref="Candidates"/>，结论人工挑了再写回 ShowcaseTheme.Plateau。
    /// </summary>
    public sealed class PlateauLookSuite : PlaytestSuite
    {
        public override string Id => "look-plateau";
        public override string Scene => "Assets/Scenes/L4_1_Zheduo.unity";

        const int W = 1280, H = 720, Sub = 4;
        /// <summary>顺带量 1-1、2-1 的工程值作参照（第一轮量过：1-1 亮 101 / 饱 124 / 对 33，2-1 亮 57 / 饱 162 / 对 24）</summary>
        const bool WithReference = false;
        const float ReadyTimeout = 90f;

        struct Look
        {
            public string name;
            public float exposure, contrast, saturation, temperature, tint, vignette, bloom, lift, gamma, gain;

            public override string ToString() =>
                $"{name}：曝光 {exposure:+0.00;-0.00}、对比 {contrast:0}、饱和 {saturation:+0;-0}、色温 {temperature:+0;-0}、色调 {tint:+0;-0}、暗角 {vignette:0.00}、Bloom {bloom:0.00}、提升 {lift:+0.00;-0.00} / 伽马 {gamma:+0.00;-0.00} / 增益 {gain:+0.00;-0.00}";
        }

        /// <summary>候选：A = 工程里现在的值（读资产），其余是围着它的几组</summary>
        static readonly Look[] Candidates =
        {
            // 第一轮（2026-11-01）：A = 关卡构建器的本地值（−0.15 / 10 / −4）偏亮偏黄绿、白塔和雪顶发白；C（−0.45 / 20 / +8）天更深、雪有层次；
            // 第二轮围着 C 往「青绿草甸」（色温更冷、色调往品红拉一点压荧光绿）和「深蓝天」收
            new() { name = "F 冷青", exposure = -0.4f, contrast = 18, saturation = 4, temperature = -10, tint = 4, vignette = 0.18f, bloom = 0.45f },
            new() { name = "G 更冷", exposure = -0.35f, contrast = 20, saturation = 0, temperature = -14, tint = 6, vignette = 0.18f, bloom = 0.45f },
            new() { name = "H 压亮", exposure = -0.5f, contrast = 16, saturation = 6, temperature = -8, tint = 3, vignette = 0.18f, bloom = 0.45f },
            new() { name = "C 压一点", exposure = -0.45f, contrast = 20, saturation = 8, temperature = -7, vignette = 0.18f, bloom = 0.5f },
        };

        Camera main;
        RenderTexture rt;
        Texture2D tex;
        Volume volume;
        VolumeProfile shared, clone;
        readonly List<VolumeComponent> cloned = new();
        readonly List<string> report = new();

        protected override IEnumerator Steps()
        {
            var quality = ArtQuality.Level;
            try
            {
                yield return Level("4-1", true);
                if (WithReference)
                {
                    yield return Level("1-1", false);
                    yield return Level("2-1", false);
                }
            }
            finally
            {
                Restore();
                ArtQuality.Set(quality, false);
                if (rt)
                {
                    rt.Release();
                    Destroy(rt);
                }
                if (tex) Destroy(tex);
                if (!string.IsNullOrEmpty(ShotDir)) File.WriteAllLines(Path.Combine(ShotDir, "look_plateau.txt"), report);
            }
        }

        void Out(string s)
        {
            report.Add(s);
            Line(s);
        }

        IEnumerator Level(string code, bool candidates)
        {
            var stage = RunPlan.Get(code);
            yield return WaitReady();
            var flow = SceneFlow.Instance;
            if (!flow || stage == null)
            {
                Fail($"没有 SceneFlow / RunPlan 里没有 {code}");
                yield break;
            }
            if (flow.Current != stage)
            {
                int before = flow.Transitions;
                if (!flow.GoTo(stage))
                {
                    Fail($"去不了 {code}");
                    yield break;
                }
                float t0 = Time.realtimeSinceStartup;
                while (Time.realtimeSinceStartup - t0 < ReadyTimeout && (flow.Busy || flow.Transitions <= before || flow.Player == null)) yield return null;
                if (flow.Busy || flow.Current != stage)
                {
                    Fail($"换到 {code} 超时");
                    yield break;
                }
                yield return new WaitForSecondsRealtime(1f);
            }
            Restore();
            var rig = flow.Player;
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
            PlateauStorm.StopAll();
            foreach (var v in FindObjectsByType<Volume>())
                if (v.name.StartsWith("Weather Volume") || v.name.StartsWith("Plateau Storm"))
                    v.weight = 0;
            volume = FindObjectsByType<Volume>().FirstOrDefault(v => v.isGlobal && v.sharedProfile && v.sharedProfile.name.StartsWith("VP_") && v.gameObject.scene == scene);
            if (!volume)
            {
                Fail($"{code}：找不到关卡的 Volume（VP_*）");
                yield break;
            }
            shared = volume.sharedProfile;
            clone = ScriptableObject.CreateInstance<VolumeProfile>();
            clone.name = shared.name + " (look-plateau)";
            foreach (var c in shared.components)
            {
                if (!c) continue;
                var copy = Instantiate(c);
                copy.name = c.name;
                clone.components.Add(copy);
                cloned.Add(copy);
            }
            clone.isDirty = true;
            volume.sharedProfile = clone;
            var current = Read(clone);
            current.name = $"A 工程里的 {shared.name}";
            ArtQuality.Set(ArtQualityLevel.High, false);
            yield return new WaitForSecondsRealtime(1.5f);

            var meta = LevelMeta.Current;
            var (spawnPos, spawnRot) = PlayerSpawn.Resolve(scene);
            var pois = meta ? (IReadOnlyList<LevelPoi>)meta.pois : LevelMeta.Collect(scene);
            var all = PerfViews.Compute(spawnPos, spawnRot, pois, meta ? meta.mapArea : default, true);
            var picked = all.Where(v => v.name == PerfViews.Spawn || v.name == PerfViews.Vista).ToList();
            var chain = all.Where(v => v.chain).ToList();
            if (chain.Count > 0) picked.Add(chain[0]);
            if (chain.Count > 2) picked.Add(chain[Math.Min(chain.Count - 1, chain.Count / 2 + 1)]);
            var shots = picked.Select(v =>
            {
                var stand = PerfViews.Ground(v.stand);
                var eye = stand + Vector3.up * PlayerFactory.EyeHeight;
                var dir = v.look - eye;
                return (v.name, eye, rot: Quaternion.LookRotation(dir.sqrMagnitude > 1e-4f ? dir : Vector3.forward));
            }).ToList();
            if (!rt) rt = new RenderTexture(W, H, 24) { name = "LookPlateau RT" };
            if (!tex) tex = new Texture2D(W, H, TextureFormat.RGB24, false);
            Out($"── {code}「{meta?.title}」：机位 {string.Join("、", shots.Select(s => s.name))}");

            var looks = new List<Look> { current };
            if (candidates) looks.AddRange(Candidates);
            foreach (var l in looks)
            {
                Apply(l);
                yield return null;
                double lum = 0, sat = 0, con = 0;
                var per = new List<string>();
                for (int i = 0; i < shots.Count; i++)
                {
                    var px = Capture(shots[i].eye, shots[i].rot);
                    var (m, s, c) = Moments(px);
                    lum += m;
                    sat += s;
                    con += c;
                    per.Add($"{shots[i].name} {m:0}/{s:0}/{c:0}");
                    if (i < 2) Save($"look_{code}_{l.name.Substring(0, 1)}_{i}", px);
                }
                int n = Math.Max(1, shots.Count);
                Out($"  {l}");
                Out($"    上半屏 亮度 {lum / n:0.0}、饱和度 {sat / n:0.0}、对比度 {con / n:0.0}（各机位 亮/饱/对：{string.Join("，", per)}）");
            }
        }

        void Restore()
        {
            if (volume && shared) volume.sharedProfile = shared;
            foreach (var c in cloned)
                if (c) Destroy(c);
            cloned.Clear();
            if (clone) Destroy(clone);
            clone = null;
            volume = null;
            shared = null;
        }

        static Look Read(VolumeProfile p)
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
            return l;
        }

        void Apply(Look l)
        {
            if (!clone) return;
            if (!clone.TryGet<ColorAdjustments>(out var ca)) cloned.Add(ca = clone.Add<ColorAdjustments>());
            ca.postExposure.Override(l.exposure);
            ca.contrast.Override(l.contrast);
            ca.saturation.Override(l.saturation);
            if (!clone.TryGet<WhiteBalance>(out var wb)) cloned.Add(wb = clone.Add<WhiteBalance>());
            wb.temperature.Override(l.temperature);
            wb.tint.Override(l.tint);
            if (!clone.TryGet<Vignette>(out var vg)) cloned.Add(vg = clone.Add<Vignette>());
            vg.intensity.Override(l.vignette);
            if (!clone.TryGet<Bloom>(out var bl)) cloned.Add(bl = clone.Add<Bloom>());
            bl.intensity.Override(l.bloom);
            if (!clone.TryGet<LiftGammaGain>(out var lgg)) cloned.Add(lgg = clone.Add<LiftGammaGain>());
            lgg.lift.Override(new Vector4(1, 1, 1, l.lift));
            lgg.gamma.Override(new Vector4(1, 1, 1, l.gamma));
            lgg.gain.Override(new Vector4(1, 1, 1, l.gain));
        }

        Color32[] Capture(Vector3 eye, Quaternion rot)
        {
            main.transform.SetPositionAndRotation(eye, rot);
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

        /// <summary>上半屏（去掉右下的枪模区）的平均亮度、平均饱和度、亮度标准差（0–255；同 fp-look 的口径）</summary>
        static (float lum, float sat, float con) Moments(Color32[] a)
        {
            double l = 0, s = 0, q = 0;
            long n = 0;
            for (int y = H / 2; y < H; y += Sub)
            for (int x = 0; x < W; x += Sub)
            {
                int i = y * W + x;
                float ya = 0.2126f * a[i].r + 0.7152f * a[i].g + 0.0722f * a[i].b;
                l += ya;
                q += ya * ya;
                int max = Math.Max(a[i].r, Math.Max(a[i].g, a[i].b)), min = Math.Min(a[i].r, Math.Min(a[i].g, a[i].b));
                s += max == 0 ? 0 : 255f * (max - min) / max;
                n++;
            }
            if (n == 0) return (0, 0, 0);
            double m = l / n;
            return ((float)m, (float)(s / n), (float)Math.Sqrt(Math.Max(0, q / n - m * m)));
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
}
