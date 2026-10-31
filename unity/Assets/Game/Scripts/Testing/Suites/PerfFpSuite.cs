using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第一人称渲染开销的对照（第二批 E 路；bridge.sh playtest perf-fp）：和 perf 套件不同，这里测的是<b>玩家自己的相机栈</b>
    /// （主相机 + 枪模），固定渲染到 1920×1080，玩家站在机位上、枪模照常显示。每关两个机位（出生、战斗：6 只敌人着火感电 + 暴击连射），
    /// 每个机位把各个配置轮流测 <see cref="Rounds"/> 轮（同一会话交替，取中位数），记主线程 P50 / P95、整条相机栈、各相机自己的 URP 采样、
    /// 后处理和体积更新的分段。出生机位另外每个配置拍一张，算出和第一个配置的逐像素差（上半屏 = 世界，右下 = 枪模）；
    /// 「再拍一次」的配置只拍图不计时，给出同配置两张图之间的噪声（枪模待机晃动、粒子）。
    /// 结果写结果文件和 Assets/Art/_Review/perf_fp.txt。只报数字，不判不合格（除了运行时报错）。
    /// </summary>
    public sealed class PerfFpSuite : PlaytestSuite
    {
        public override string Id => "perf-fp";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        static readonly string[] Stages = { "1-1", "2-1", "3-1" };
        const int Rounds = 5, Width = 1920, Height = 1080, ShotW = 960, ShotH = 540, CombatEnemies = 6;
        const float Warm = 0.5f, Sample = 1.5f, ReadyTimeout = 90f;

        const string MainName = "Main Camera", VmName = "Viewmodel Camera";
        static string CamMarker(string cam) => $"Inl_UniversalRenderPipeline.RenderSingleCameraInternal: {cam}";

        static readonly string[] Extra =
        {
            CamMarker(MainName), CamMarker(VmName), "Inl_UpdateVolumeFramework", "Inl_RenderCameraStack",
            "Inl_RG_UberPost", "Inl_RG_BloomSetup", "Inl_ScreenSpaceAmbientOcclusion", "Inl_UberPostProcess", "Inl_Bloom",
        };

        sealed class Config
        {
            public string name;
            public Action apply, revert;
            /// <summary>只拍图、不计时（比如「改前」再拍一次，看两张同配置截图之间的噪声）</summary>
            public bool shotOnly;
        }

        sealed class Row
        {
            public string level, view, config;
            public readonly List<float> mainP50 = new(), mainP95 = new(), stack = new(), mainCam = new(), vmCam = new(), volume = new(), gpu = new(), render = new();
            public readonly List<float> draws = new(), setPass = new();
        }

        PlayerRig rig;
        Camera main, vm;
        UniversalAdditionalCameraData vmData;
        RenderTexture rt;
        readonly List<string> report = new();
        readonly List<Row> rows = new();

        protected override IEnumerator Steps()
        {
            var quality = ArtQuality.Level;
            int vSync0 = QualitySettings.vSyncCount, frameRate0 = Application.targetFrameRate;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            Out($"环境：{PerfProbe.Environment()}");
            try
            {
                foreach (var code in Stages)
                    yield return Level(code);
            }
            finally
            {
                ViewmodelCameraTrim.Disabled = false;
                if (main) main.targetTexture = null;
                if (rt)
                {
                    rt.Release();
                    Destroy(rt);
                }
                ArtQuality.Set(quality, false);
                QualitySettings.vSyncCount = vSync0;
                Application.targetFrameRate = frameRate0;
                if (rig?.weapons) rig.weapons.testFire = false;
            }
            Summary();
            File.WriteAllLines(Path.Combine(ShotDir, "perf_fp.txt"), report);
        }

        void Out(string s)
        {
            report.Add(s);
            Line(s);
        }

        // ───────────── 配置 ─────────────

        List<Config> Configs() => new()
        {
            new Config
            {
                name = "改前（叠加相机不裁剪）",
                apply = () =>
                {
                    ViewmodelCameraTrim.Disabled = true;
                    vmData.requiresDepthOption = CameraOverrideOption.UsePipelineSettings;
                },
                revert = () =>
                {
                    ViewmodelCameraTrim.Disabled = false;
                    vmData.requiresDepthOption = CameraOverrideOption.Off;
                },
            },
            new Config { name = "改前（再拍一次，看噪声）", apply = () =>
                {
                    ViewmodelCameraTrim.Disabled = true;
                    vmData.requiresDepthOption = CameraOverrideOption.UsePipelineSettings;
                },
                revert = () =>
                {
                    ViewmodelCameraTrim.Disabled = false;
                    vmData.requiresDepthOption = CameraOverrideOption.Off;
                },
                shotOnly = true,
            },
            new Config { name = "裁剪（现行：叠加相机不要深度图、不跑 SSAO / 贴花）" },
            new Config { name = "不画枪模（叠加相机停用）", apply = () => vm.enabled = false, revert = () => vm.enabled = true },
        };

        // ───────────── 一关 ─────────────

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
                if (main) main.targetTexture = null;
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
            vm = main.GetComponentsInChildren<Camera>(true).FirstOrDefault(c => c != main && c.cullingMask == 1 << Layers.FirstPerson);
            if (!vm)
            {
                Fail($"{code}：找不到枪模相机");
                yield break;
            }
            vmData = vm.GetUniversalAdditionalCameraData();
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

            if (!rt) rt = new RenderTexture(Width, Height, 24) { name = "PerfFp RT" };
            main.targetTexture = rt;
            ArtQuality.Set(ArtQualityLevel.High, false);

            var meta = LevelMeta.Current;
            var (spawnPos, spawnRot) = PlayerSpawn.Resolve(scene);
            var pois = meta ? (IReadOnlyList<LevelPoi>)meta.pois : LevelMeta.Collect(scene);
            var views = PerfViews.Compute(spawnPos, spawnRot, pois, meta ? meta.mapArea : default).Where(v => v.name == PerfViews.Spawn || v.combat).ToList();
            Out($"── {code}：机位 {string.Join("、", views.Select(v => v.name))}");
            foreach (var v0 in views)
            {
                var v = v0;
                v.stand = PerfViews.Ground(v.stand);
                yield return View(code, v);
            }
            main.targetTexture = null;
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

        // ───────────── 一个机位 ─────────────

        IEnumerator View(string code, PerfView v)
        {
            Place(v.stand);
            yield return null;
            var eye = rig.weapons ? rig.weapons.eye.transform : main.transform;
            Aim(rig.motor, eye, v.look);
            var enemies = new List<EnemyAI>();
            if (v.combat)
            {
                var ids = new[] { "jerboa_blade" };
                for (int i = 0; i < CombatEnemies; i++)
                {
                    float a = i * Mathf.PI * 2 / CombatEnemies;
                    var p = v.look - Vector3.up + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 4f;
                    if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
                    var ai = EnemyRoster.Spawn(ids[0], p, Quaternion.LookRotation(Flat(v.stand - p).normalized + Vector3.forward * 1e-3f), 1f, false);
                    if (!ai) continue;
                    ai.Health.maxHealth = 1e6f;
                    ai.Health.ResetVitals();
                    enemies.Add(ai);
                }
                yield return new WaitForSecondsRealtime(1f);
                foreach (var ai in enemies)
                {
                    if (!ai) continue;
                    ai.enabled = false;
                    EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                    EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
                }
                rig.vitals.stats.Add("perf_fp_crit", Stat.CritChance, 1f);
                rig.weapons.testFire = true;
            }
            yield return new WaitForSecondsRealtime(1f);

            var all = Configs();
            var configs = all.Where(c => !c.shotOnly).ToList();
            var byConfig = configs.ToDictionary(c => c.name, c => new Row { level = code, view = v.name, config = c.name });
            int k = 0;
            for (int round = 0; round < Rounds; round++)
            {
                // 每轮换一下起点，免得某个配置总排在第一个
                for (int j = 0; j < configs.Count; j++)
                {
                    var c = configs[(j + round) % configs.Count];
                    c.apply?.Invoke();
                    float t0 = Time.realtimeSinceStartup;
                    while (Time.realtimeSinceStartup - t0 < Warm)
                    {
                        Tick(v, enemies, eye, ref k);
                        yield return null;
                    }
                    using (var probe = new PerfProbe(Extra))
                    {
                        t0 = Time.realtimeSinceStartup;
                        while (Time.realtimeSinceStartup - t0 < Sample)
                        {
                            Tick(v, enemies, eye, ref k);
                            yield return null;
                            probe.Sample();
                        }
                        Add(byConfig[c.name], probe.Result());
                    }
                    c.revert?.Invoke();
                }
            }
            foreach (var c in configs) Report(byConfig[c.name]);
            rows.AddRange(configs.Select(c => byConfig[c.name]));

            if (!v.combat)
            {
                // 每个配置一张：和第一个配置逐像素比
                Color32[] baseline = null;
                foreach (var c in all)
                {
                    c.apply?.Invoke();
                    yield return null;
                    yield return null;
                    var px = Capture($"perffp_{code}_{all.IndexOf(c)}");
                    c.revert?.Invoke();
                    if (baseline == null) baseline = px;
                    else Out($"    画面差（和「{all[0].name}」比，0–255 平均绝对差）· {c.name}：{Diff(baseline, px)}");
                }
            }

            if (v.combat)
            {
                rig.weapons.testFire = false;
                rig.vitals.stats.Remove("perf_fp_crit");
                EnemyRegistry.PurgeAll();
                yield return new WaitForSecondsRealtime(1.5f);
            }
        }

        void Tick(PerfView v, List<EnemyAI> enemies, Transform eye, ref int k)
        {
            if (!v.combat) return;
            if (rig.weapons.Active != null) rig.weapons.Active.reserve = rig.weapons.Active.def.reserve;
            var alive = enemies.Where(x => x && x.Health && !x.Health.Dead).ToList();
            if (alive.Count == 0) return;
            Aim(rig.motor, eye, BodyCenter(alive[(k++ / 8) % alive.Count].Health));
        }

        void Place(Vector3 p)
        {
            var cc = rig.motor.GetComponent<CharacterController>();
            cc.enabled = false;
            rig.motor.transform.position = p + Vector3.up * 0.05f;
            cc.enabled = true;
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        static void Add(Row row, PerfProbe.Stats r)
        {
            row.mainP50.Add((float)r.MainP50);
            row.mainP95.Add((float)r.MainP95);
            row.stack.Add((float)r.Get("Inl_RenderCameraStack"));
            row.mainCam.Add((float)r.Get(CamMarker(MainName)));
            row.vmCam.Add((float)r.Get(CamMarker(VmName)));
            row.volume.Add((float)r.Get("Inl_UpdateVolumeFramework"));
            row.gpu.Add((float)r.GpuP50);
            row.render.Add((float)r.RenderP95);
            row.draws.Add((float)r.DrawCalls);
            row.setPass.Add((float)r.SetPass);
        }

        static float Median(List<float> xs)
        {
            var s = xs.Where(x => x >= 0).OrderBy(x => x).ToList();
            if (s.Count == 0) return -1;
            return s.Count % 2 == 1 ? s[s.Count / 2] : (s[s.Count / 2 - 1] + s[s.Count / 2]) * 0.5f;
        }

        static string Ms(float v) => v >= 0 ? $"{v:F2}" : "—";

        void Report(Row r)
        {
            Out($"  {r.level} · {r.view} · {r.config}：主线程 P50 {Ms(Median(r.mainP50))}（各轮 {string.Join("/", r.mainP50.Select(x => x.ToString("F2")))}）/ P95 {Ms(Median(r.mainP95))}；" +
                $"相机栈 {Ms(Median(r.stack))}（主相机 {Ms(Median(r.mainCam))}、枪模相机 {Ms(Median(r.vmCam))}、体积更新 {Ms(Median(r.volume))}）；" +
                $"渲染线程 P95 {Ms(Median(r.render))}、GPU P50 {Ms(Median(r.gpu))}；绘制 {Median(r.draws):F0}、SetPass {Median(r.setPass):F0}");
        }

        void Summary()
        {
            Out("── 汇总（主线程 P50 中位数，和同一机位第一个配置的差）");
            foreach (var g in rows.GroupBy(r => (r.level, r.view)))
            {
                var baseRow = g.First();
                float b = Median(baseRow.mainP50);
                var sb = new StringBuilder($"  {g.Key.level} · {g.Key.view}：{baseRow.config} {Ms(b)}");
                foreach (var r in g.Where(r => r != baseRow))
                    sb.Append($"；{r.config} {Ms(Median(r.mainP50))}（{Median(r.mainP50) - b:+0.00;-0.00}）");
                Out(sb.ToString());
            }
        }

        // ───────────── 截图与逐像素比 ─────────────

        Color32[] Capture(string name)
        {
            var shot = new RenderTexture(ShotW, ShotH, 24);
            var tex = new Texture2D(ShotW, ShotH, TextureFormat.RGB24, false);
            var prev = main.targetTexture;
            main.targetTexture = shot;
            main.Render();
            RenderTexture.active = shot;
            tex.ReadPixels(new Rect(0, 0, ShotW, ShotH), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            main.targetTexture = prev;
            var px = tex.GetPixels32();
            if (!string.IsNullOrEmpty(ShotDir)) File.WriteAllBytes(Path.Combine(ShotDir, $"playtest_{name}.png"), tex.EncodeToPNG());
            Destroy(shot);
            Destroy(tex);
            return px;
        }

        /// <summary>上 45%（世界）和右下四分之一（枪模所在）的平均绝对差；纹理行从下往上</summary>
        static string Diff(Color32[] a, Color32[] b)
        {
            double top = 0, gun = 0, lum = 0;
            int nTop = 0, nGun = 0;
            for (int y = 0; y < ShotH; y++)
            for (int x = 0; x < ShotW; x++)
            {
                int i = y * ShotW + x;
                int d = Math.Abs(a[i].r - b[i].r) + Math.Abs(a[i].g - b[i].g) + Math.Abs(a[i].b - b[i].b);
                if (y > ShotH * 0.55f)
                {
                    top += d / 3.0;
                    lum += (b[i].r + b[i].g + b[i].b - a[i].r - a[i].g - a[i].b) / 3.0;
                    nTop++;
                }
                else if (y < ShotH * 0.5f && x > ShotW * 0.5f)
                {
                    gun += d / 3.0;
                    nGun++;
                }
            }
            return $"世界 {top / Math.Max(1, nTop):F2}（亮度 {lum / Math.Max(1, nTop):+0.00;-0.00}）、枪模区 {gun / Math.Max(1, nGun):F2}";
        }
    }
}
