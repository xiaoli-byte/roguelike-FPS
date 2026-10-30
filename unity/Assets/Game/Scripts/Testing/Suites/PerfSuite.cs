using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Spiritfire.Art;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 固定机位性能基线（docs/unity-parity.md I4，协议见 docs/performance.md「Unity 固定机位基线」；bridge.sh playtest perf [场景]，默认 1-1，任何 [LevelBuilder] 关卡都能跑）：
    ///   · 机位：玩家出生点眼高看向最近的地点，之后从这个地点看向下一个最近的（LevelMeta 的必经地点按最近邻串成主线），最多 8 个；
    ///   · 测量相机单独一台，参数同玩家主相机（70°、远裁 1500 m、后处理、SMAA 高，不含第一人称层），渲染到固定的 1920×1080，和 Game 视图大小无关；
    ///     不限帧（测量期间关掉垂直同步和帧率上限）；每档设置先把所有机位各过 20 帧，再逐个机位预热 30 帧、记录 240 帧：帧时、主线程、渲染线程、GPU（拿得到时）的 P50 / P95，绘制调用 / 批次 / SetPass / 三角面均值，每帧 GC；
    ///   · 对照：先按项目设置测一遍，再换成「GRD + GPU 遮挡剔除 / 只开 GRD / 关 GRD」里另外两档（项目没开 GRD 时只对照开了的一档）把所有机位再测，测完还原管线设置；
    ///   · 预算：按项目设置那一遍逐机位比对 <see cref="PerfBudget"/>（GPU P95、主线程 P95、绘制调用、三角面），超出不合格；
    ///   · 结果：每个机位一行、一张截图（perf_&lt;关卡&gt;_&lt;序号&gt;），原始数据 shotDir/perf_&lt;关卡&gt;.json。
    /// 编辑器 Play 模式的主线程含编辑器自身的开销，比独立包高；帧时还受编辑器的刷新节流（Game 视图常停在显示器刷新率），所以预算只看主线程和 GPU。
    /// 只跟同一台机器、同一协议的上一次比。批次计数器在编辑器里读不到（记 0、不显示）。玩家留在出生点不动，遭遇不会被触发。
    /// </summary>
    public sealed class PerfSuite : PlaytestSuite
    {
        public override string Id => "perf";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        const int Warmup = 30, Frames = 240, Width = 1920, Height = 1080, MaxViews = 8;
        const float EyeHeight = 1.7f;

        struct View
        {
            public string name;
            public Vector3 eye, target;
        }

        /// <summary>一个机位、一种管线设置下的统计（毫秒；计数为 240 帧均值；拿不到的为 NaN）</summary>
        sealed class Sample
        {
            public string view, mode;
            public float frameP50, frameP95, mainP50, mainP95, renderP95, gpuP50, gpuP95;
            public float drawCalls, batches, setPass, triangles, gcBytes;
        }

        UniversalRenderPipelineAsset urp;
        GPUResidentDrawerMode grd0;
        bool occlusion0;
        int vSync0, frameRate0;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(2f);
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            if (!motor)
            {
                Fail("没有 PlayerMotor");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            if (vitals) vitals.invulnerableUntil = float.PositiveInfinity;

            var meta = LevelMeta.Current;
            string level = meta ? meta.levelId : UnityEngine.SceneManagement.SceneManager.GetActiveScene().name;
            var views = Views(meta, motor.transform.position);
            if (views.Count == 0)
            {
                Fail("没有可用的机位（当前关卡没有 LevelMeta 或地点）");
                yield break;
            }
            urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (urp)
            {
                grd0 = urp.gpuResidentDrawerMode;
                occlusion0 = urp.gpuResidentDrawerEnableOcclusionCullingInCameras;
                Application.quitting += Restore;
            }
            // 不限帧：垂直同步 / 帧率上限会把帧时卡在 16.7 ms
            vSync0 = QualitySettings.vSyncCount;
            frameRate0 = Application.targetFrameRate;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            Line($"关卡 {level}：机位 {views.Count} 个，{Width}×{Height}，预热 {Warmup} 帧 + 记录 {Frames} 帧；画质 {QualitySettings.names[QualitySettings.GetQualityLevel()]}，" +
                 $"GPU Resident Drawer {(urp ? $"{grd0}，GPU 遮挡剔除 {(occlusion0 ? "开" : "关")}" : "（不是 URP）")}");

            var rt = new RenderTexture(Width, Height, 24) { name = "Perf RT" };
            var cam = new GameObject("Perf Camera") { tag = "MainCamera" }.AddComponent<Camera>();
            cam.fieldOfView = 70f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 1500f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            cam.targetTexture = rt;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            var others = FindObjectsByType<Camera>().Where(c => c != cam && c.enabled).ToList();
            foreach (var c in others) c.enabled = false;

            // 对照：GRD + GPU 遮挡 / 只开 GRD / 关 GRD 三档里项目设置以外的两档
            var modes = new List<(string name, GPUResidentDrawerMode grd, bool occlusion)> { ("项目设置", grd0, occlusion0) };
            if (urp)
            {
                var on = GPUResidentDrawerMode.InstancedDrawing;
                if (grd0 == GPUResidentDrawerMode.Disabled) modes.Add(("开 GRD + GPU 遮挡", on, true));
                else modes.Add(occlusion0 ? ("GRD 不开遮挡", on, false) : ("GRD + GPU 遮挡", on, true));
                if (grd0 != GPUResidentDrawerMode.Disabled) modes.Add(("关 GRD", GPUResidentDrawerMode.Disabled, false));
            }
            var samples = new List<Sample>();
            foreach (var (mode, grd, occlusion) in modes)
            {
                if (urp && (urp.gpuResidentDrawerMode != grd || urp.gpuResidentDrawerEnableOcclusionCullingInCameras != occlusion))
                {
                    urp.gpuResidentDrawerMode = grd;
                    urp.gpuResidentDrawerEnableOcclusionCullingInCameras = occlusion;
                    for (int i = 0; i < 60; i++) yield return null;
                }
                // 先把每个机位过一遍：首次看到的着色器变体 / 贴图流送会让第一个机位的 GPU 出尖峰
                foreach (var view in views)
                {
                    cam.transform.SetPositionAndRotation(view.eye, Quaternion.LookRotation(view.target - view.eye));
                    for (int i = 0; i < 20; i++) yield return null;
                }
                for (int v = 0; v < views.Count; v++)
                {
                    var s = new Sample { view = views[v].name, mode = mode };
                    yield return Measure(cam, views[v], s);
                    samples.Add(s);
                    Line(Format(s));
                    if (mode == modes[0].name)
                    {
                        Shot(cam, $"perf_{level}_{v}");
                        cam.targetTexture = rt;
                    }
                }
            }
            Restore();
            Application.quitting -= Restore;
            foreach (var c in others)
                if (c) c.enabled = true;
            Destroy(cam.gameObject);
            rt.Release();

            Summarize(level, samples, modes.Select(m => m.name).ToList());
            WriteJson(level, views, samples);
        }

        /// <summary>出生点 + 必经地点按最近邻串成主线，相邻两点一个机位（眼高 1.7 m 看向下一个地点 1.2 m 高处）</summary>
        static List<View> Views(LevelMeta meta, Vector3 spawn)
        {
            var left = meta ? meta.pois.Where(p => !p.optional).Select(p => (p.name, pos: p.position)).ToList() : new List<(string name, Vector3 pos)>();
            var chain = new List<(string name, Vector3 pos)> { ("出生点", spawn) };
            while (left.Count > 0)
            {
                var last = chain[^1].pos;
                int k = 0;
                for (int i = 1; i < left.Count; i++)
                    if ((left[i].pos - last).sqrMagnitude < (left[k].pos - last).sqrMagnitude) k = i;
                chain.Add(left[k]);
                left.RemoveAt(k);
            }
            var views = new List<View>();
            for (int i = 0; i + 1 < chain.Count && views.Count < MaxViews; i++)
            {
                var eye = Ground(chain[i].pos) + Vector3.up * EyeHeight;
                var target = Ground(chain[i + 1].pos) + Vector3.up * 1.2f;
                if ((target - eye).sqrMagnitude < 25) continue;
                views.Add(new View { name = $"{chain[i].name} → {chain[i + 1].name}", eye = eye, target = target });
            }
            return views;
        }

        /// <summary>地点记的是地面位置；往下 10 m 内贴一下地，免得落在台阶 / 平台边上悬空</summary>
        static Vector3 Ground(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 2, Vector3.down, out var hit, 10, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point : p;

        IEnumerator Measure(Camera cam, View v, Sample s)
        {
            cam.transform.SetPositionAndRotation(v.eye, Quaternion.LookRotation(v.target - v.eye));
            for (int i = 0; i < Warmup; i++) yield return null;
            var main = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "CPU Main Thread Frame Time");
            var render = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "CPU Render Thread Frame Time");
            var gpu = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "GPU Frame Time");
            var draws = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
            var batches = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Batches Count");
            var setPass = ProfilerRecorder.StartNew(ProfilerCategory.Render, "SetPass Calls Count");
            var tris = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles Count");
            var gc = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
            var timings = new FrameTiming[1];
            float[] frame = new float[Frames], mainMs = new float[Frames], renderMs = new float[Frames], gpuMs = new float[Frames];
            double drawSum = 0, batchSum = 0, setPassSum = 0, triSum = 0, gcSum = 0;
            yield return null;
            for (int i = 0; i < Frames; i++)
            {
                yield return null;
                FrameTimingManager.CaptureFrameTimings();
                double gpuTiming = FrameTimingManager.GetLatestTimings(1, timings) > 0 ? timings[0].gpuFrameTime : 0;
                frame[i] = Time.unscaledDeltaTime * 1000f;
                mainMs[i] = Ms(main);
                renderMs[i] = Ms(render);
                gpuMs[i] = gpuTiming > 0 ? (float)gpuTiming : Ms(gpu);
                double d = Last(draws), b = Last(batches);
#if UNITY_EDITOR
                // 编辑器里绘制调用计数器读出来是 0（SetPass / 三角面正常），改读编辑器的渲染统计；批次没有对应的统计，拿不到就记 0
                if (d <= 0) d = UnityEditor.UnityStats.drawCalls;
#endif
                drawSum += d;
                batchSum += b;
                setPassSum += Last(setPass);
                triSum += Last(tris);
                gcSum += Last(gc);
            }
            foreach (var r in new[] { main, render, gpu, draws, batches, setPass, tris, gc }) r.Dispose();
            s.frameP50 = Percentile(frame, 0.5f);
            s.frameP95 = Percentile(frame, 0.95f);
            s.mainP50 = Percentile(mainMs, 0.5f);
            s.mainP95 = Percentile(mainMs, 0.95f);
            s.renderP95 = Percentile(renderMs, 0.95f);
            s.gpuP50 = Percentile(gpuMs, 0.5f);
            s.gpuP95 = Percentile(gpuMs, 0.95f);
            s.drawCalls = (float)(drawSum / Frames);
            s.batches = (float)(batchSum / Frames);
            s.setPass = (float)(setPassSum / Frames);
            s.triangles = (float)(triSum / Frames);
            s.gcBytes = (float)(gcSum / Frames);
        }

        static float Ms(ProfilerRecorder r) => r.Valid && r.LastValue > 0 ? r.LastValue * 1e-6f : float.NaN;
        static double Last(ProfilerRecorder r) => r.Valid ? r.LastValue : 0;

        /// <summary>分位数（忽略 NaN；全是 NaN 时为 NaN）</summary>
        static float Percentile(float[] values, float q)
        {
            var v = values.Where(x => !float.IsNaN(x)).OrderBy(x => x).ToArray();
            return v.Length == 0 ? float.NaN : v[Mathf.Clamp(Mathf.CeilToInt(v.Length * q) - 1, 0, v.Length - 1)];
        }

        void Restore()
        {
            QualitySettings.vSyncCount = vSync0;
            Application.targetFrameRate = frameRate0;
            if (!urp) return;
            urp.gpuResidentDrawerMode = grd0;
            urp.gpuResidentDrawerEnableOcclusionCullingInCameras = occlusion0;
        }

        static string F(float v) => float.IsNaN(v) ? "—" : v.ToString("F2", CultureInfo.InvariantCulture);

        static string Format(Sample s) =>
            $"{s.mode}｜{s.view}：帧 P50 {F(s.frameP50)} / P95 {F(s.frameP95)} ms，主线程 P50 {F(s.mainP50)} / P95 {F(s.mainP95)}，渲染线程 P95 {F(s.renderP95)}，" +
            $"GPU P50 {F(s.gpuP50)} / P95 {F(s.gpuP95)}；绘制 {s.drawCalls:F0}{(s.batches > 0 ? $"、批次 {s.batches:F0}" : "")}、SetPass {s.setPass:F0}、{s.triangles / 1000f:F0}k 面，GC {s.gcBytes:F0} B/帧";

        /// <summary>预算比对（只看项目设置那一遍）+ A/B 汇总（各机位均值）</summary>
        void Summarize(string level, List<Sample> samples, List<string> modes)
        {
            var budget = PerfBudget.For(level);
            var baseline = samples.Where(s => s.mode == modes[0]).ToList();
            foreach (var s in baseline)
            {
                if (!float.IsNaN(s.gpuP95) && s.gpuP95 > budget.gpuP95Ms) Fail($"{s.view}：GPU P95 {F(s.gpuP95)} ms，超出预算 {budget.gpuP95Ms} ms");
                if (!float.IsNaN(s.mainP95) && s.mainP95 > budget.mainP95Ms) Fail($"{s.view}：主线程 P95 {F(s.mainP95)} ms，超出预算 {budget.mainP95Ms} ms");
                if (s.drawCalls > budget.drawCalls) Fail($"{s.view}：绘制调用 {s.drawCalls:F0}，超出预算 {budget.drawCalls}");
                if (s.triangles > budget.triangles) Fail($"{s.view}：{s.triangles:N0} 面，超出预算 {budget.triangles:N0}");
            }
            Line($"预算（{level}）：GPU P95 ≤ {budget.gpuP95Ms} ms、主线程 P95 ≤ {budget.mainP95Ms} ms、绘制 ≤ {budget.drawCalls}、三角面 ≤ {budget.triangles:N0}");
            foreach (var m in modes)
            {
                var g = samples.Where(s => s.mode == m).ToList();
                if (g.Count == 0) continue;
                float Avg(System.Func<Sample, float> f) => g.Select(f).Where(x => !float.IsNaN(x)).DefaultIfEmpty(float.NaN).Average();
                Line($"均值｜{m}：帧 P95 {F(Avg(s => s.frameP95))} ms，主线程 P95 {F(Avg(s => s.mainP95))}，GPU P95 {F(Avg(s => s.gpuP95))}；" +
                     $"绘制 {Avg(s => s.drawCalls):F0}、SetPass {Avg(s => s.setPass):F0}、{Avg(s => s.triangles) / 1000f:F0}k 面；最重机位 GPU P95 {F(g.Max(s => float.IsNaN(s.gpuP95) ? 0 : s.gpuP95))} ms");
            }
        }

        void WriteJson(string level, List<View> views, List<Sample> samples)
        {
            string dir = !string.IsNullOrEmpty(ShotDir) ? ShotDir : !string.IsNullOrEmpty(ResultPath) ? Path.GetDirectoryName(ResultPath) : null;
            if (string.IsNullOrEmpty(dir)) return;
            var inv = CultureInfo.InvariantCulture;
            string J(float v) => float.IsNaN(v) ? "null" : v.ToString("0.###", inv);
            string V(Vector3 p) => $"[{p.x.ToString("0.##", inv)},{p.y.ToString("0.##", inv)},{p.z.ToString("0.##", inv)}]";
            var sb = new StringBuilder();
            sb.Append($"{{\"level\":\"{level}\",\"width\":{Width},\"height\":{Height},\"warmup\":{Warmup},\"frames\":{Frames},");
            sb.Append($"\"quality\":\"{QualitySettings.names[QualitySettings.GetQualityLevel()]}\",\"device\":\"{SystemInfo.graphicsDeviceName}\",\"cpu\":\"{SystemInfo.processorType}\",\"views\":[");
            sb.Append(string.Join(",", views.Select(v => $"{{\"name\":\"{v.name}\",\"eye\":{V(v.eye)},\"target\":{V(v.target)}}}")));
            sb.Append("],\"samples\":[");
            sb.Append(string.Join(",", samples.Select(s =>
                $"{{\"view\":\"{s.view}\",\"mode\":\"{s.mode}\",\"frameP50\":{J(s.frameP50)},\"frameP95\":{J(s.frameP95)},\"mainP50\":{J(s.mainP50)},\"mainP95\":{J(s.mainP95)}," +
                $"\"renderP95\":{J(s.renderP95)},\"gpuP50\":{J(s.gpuP50)},\"gpuP95\":{J(s.gpuP95)},\"drawCalls\":{J(s.drawCalls)},\"batches\":{J(s.batches)}," +
                $"\"setPass\":{J(s.setPass)},\"triangles\":{J(s.triangles)},\"gcBytes\":{J(s.gcBytes)}}}")));
            sb.Append("]}");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, $"perf_{level}.json");
            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            Line($"原始数据 {path}");
        }
    }
}
