using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Unity.Profiling;
using Unity.Profiling.LowLevel.Unsafe;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 性能采样器（I4，冒烟套件用；docs/performance-unity.md 的协议）：开着的时候每帧调一次 <see cref="Sample"/>，
    /// 用 ProfilerRecorder 读上一帧的主线程 / 渲染线程 / GPU 时间、PlayerLoop 与 EditorLoop（编辑器自己每帧花掉的时间）、
    /// 几个分段（脚本 Update、物理、粒子、渲染提交、等 GPU / 等目标帧率）和渲染计数（批次、SetPass、三角面、绘制调用、投影体、可见蒙皮），
    /// 结束时 <see cref="Result"/> 出平均 / P95。拿不到的计数是 −1（比如编辑器里没开帧时统计时的 GPU 时间）。
    /// 只读计数器，不改任何东西；Dispose 时停掉全部记录器。
    /// </summary>
    public sealed class PerfProbe : IDisposable
    {
        /// <summary>按名字找的计数器 / 标记（找不到的跳过）。时间类单位是纳秒，计数类是个数</summary>
        public static readonly string[] Names =
        {
            // 线程 / 帧
            "Main Thread", "Render Thread", "PlayerLoop", "EditorLoop",
            "CPU Total Frame Time", "CPU Main Thread Frame Time", "CPU Render Thread Frame Time", "GPU Frame Time",
            // 分段
            "Update.ScriptRunBehaviourUpdate", "PreLateUpdate.ScriptRunBehaviourLateUpdate", "FixedUpdate.ScriptRunBehaviourFixedUpdate",
            "FixedUpdate.PhysicsFixedUpdate", "PreLateUpdate.ParticleSystemBeginUpdateAll", "PostLateUpdate.ParticleSystemEndUpdateAll",
            "PostLateUpdate.UpdateAllRenderers", "PostLateUpdate.FinishFrameRendering", "PreUpdate.AIUpdatePostScript", "Update.DirectorUpdate",
            "PreLateUpdate.DirectorUpdateAnimationBegin", "PreLateUpdate.DirectorUpdateAnimationEnd",
            "PostLateUpdate.UpdateAllSkinnedMeshes", "PreLateUpdate.UIElementsUpdatePanels", "PostLateUpdate.UIElementsRepaintPanels",
            "PostLateUpdate.UpdateAudio", "PreLateUpdate.AIUpdatePostScript", "PostLateUpdate.PlayerUpdateCanvases",
            "Panel.Render", "UIR.DrawChain", "UIElements.UpdateRenderData", "UIR.GenerateEntries", "UIR.ConvertEntriesToCommands",
            "UIR.NudgeVertices", "UIR.UpdateOpacityId", "UIR.WaitOnFence", "GUI.Repaint", "TextCoreRendering.Render",
            // 渲染（URP：整条相机栈、RenderGraph 录制 / 编译 / 执行、剔除、相机开始回调）
            "Inl_RenderCameraStack", "Inl_RecordRenderGraph", "Inl_CompileRenderGraph", "Inl_ExecuteRenderGraph",
            "Inl_RenderPipeline.BeginCameraRendering", "Inl_RenderPipeline.BeginContextRendering", "Inl_RenderPipeline.EndContextRendering",
            "CullScriptable", "CullShadowCastersScriptable", "RenderLoop.DrawSRPBatcher", "Shadows.DrawSRPBatcher",
            "Gfx.WaitForPresentOnGfxThread", "Gfx.WaitForRenderThread", "Gfx.WaitForGfxCommandsFromMainThread", "WaitForTargetFPS",
            "Gfx.PresentFrame", "GC.Collect",
            // 渲染计数
            "Batches Count", "SetPass Calls Count", "Triangles Count", "Draw Calls Count", "Vertices Count",
            "Shadow Casters Count", "Visible Skinned Meshes Count", "GC Allocated In Frame",
            "BRG Draw Calls Count", "BRG Instances Count",
            // Unity 6.5 起绘制调用按路径分开计（旧的「Draw Calls Count / Batches Count」不在了），合计见 Stats.DrawCalls
            "SRP Batcher Draw Calls Count", "Standard Draw Calls Count", "Standard Instanced Draw Calls Count",
            "Standard Indirect Draw Calls Count", "BRG Indirect Draw Calls Count", "Null Geometry Draw Calls Count",
            "SRP Batcher Instances Count", "Standard Instances Count", "Standard Instanced Instances Count", "BRG Indirect Instances Count",
            "Static Batches Count", "Static Batched Draw Calls Count",
        };

        /// <summary>按路径分开计的绘制调用（合计 = 这一帧的绘制调用数，含阴影 / 后处理 / 枪模相机）</summary>
        public static readonly string[] DrawCallNames =
        {
            "SRP Batcher Draw Calls Count", "Standard Draw Calls Count", "Standard Instanced Draw Calls Count",
            "Standard Indirect Draw Calls Count", "BRG Draw Calls Count", "BRG Indirect Draw Calls Count", "Null Geometry Draw Calls Count",
        };

        /// <summary>按路径分开计的实例（被画出来的网格实例，含阴影投射）</summary>
        public static readonly string[] InstanceNames =
        {
            "SRP Batcher Instances Count", "Standard Instances Count", "Standard Instanced Instances Count", "BRG Instances Count", "BRG Indirect Instances Count",
        };

        sealed class Track
        {
            public string name;
            public ProfilerRecorder rec;
            public bool time;
            public readonly List<double> values = new(512);
        }

        readonly List<Track> tracks = new();
        readonly List<float> frameMs = new(512);

        public PerfProbe() : this(null) { }

        /// <summary>extra：在 <see cref="Names"/> 之外再记的计数器 / 标记（比如按相机名的 URP 采样「Inl_UniversalRenderPipeline.RenderSingleCameraInternal: Main Camera」）</summary>
        public PerfProbe(IEnumerable<string> extra)
        {
            var handles = new List<ProfilerRecorderHandle>();
            ProfilerRecorderHandle.GetAvailable(handles);
            var byName = new Dictionary<string, ProfilerRecorderHandle>();
            foreach (var h in handles)
            {
                var d = ProfilerRecorderHandle.GetDescription(h);
                if (!byName.ContainsKey(d.Name)) byName[d.Name] = h;
            }
            var names = extra == null ? Names : Names.Concat(extra).Distinct();
            foreach (var n in names)
            {
                if (!byName.TryGetValue(n, out var h)) continue;
                var d = ProfilerRecorderHandle.GetDescription(h);
                var rec = new ProfilerRecorder(h, 1, ProfilerRecorderOptions.Default | ProfilerRecorderOptions.StartImmediately);
                tracks.Add(new Track { name = n, rec = rec, time = d.UnitType == ProfilerMarkerDataUnit.TimeNanoseconds });
            }
        }

        /// <summary>全部可用的计数器 / 标记名（排查用：哪些名字在这个版本 / 编辑器里存在）</summary>
        public static List<string> AvailableNames()
        {
            var handles = new List<ProfilerRecorderHandle>();
            ProfilerRecorderHandle.GetAvailable(handles);
            return handles.Select(h =>
            {
                var d = ProfilerRecorderHandle.GetDescription(h);
                return $"{d.Category.Name}/{d.Name} [{d.UnitType}]";
            }).Distinct().OrderBy(s => s, StringComparer.Ordinal).ToList();
        }

        /// <summary>丢掉已经记下的帧（预热结束时调）</summary>
        public void Reset()
        {
            frameMs.Clear();
            foreach (var t in tracks) t.values.Clear();
        }

        /// <summary>记一帧（每帧调一次，读的是上一帧的值）</summary>
        public void Sample()
        {
            frameMs.Add(Time.unscaledDeltaTime * 1000f);
            foreach (var t in tracks)
                if (t.rec.Valid) t.values.Add(t.rec.LastValue);
        }

        public int Frames => frameMs.Count;

        public void Dispose()
        {
            foreach (var t in tracks) t.rec.Dispose();
            tracks.Clear();
        }

        /// <summary>一段采样的结果：帧时平均 / P95 / 最差，各计数的平均（时间换算成毫秒），拿不到的是 −1</summary>
        public sealed class Stats
        {
            public int frames;
            public float frameAvg, frameP50, frameP95, frameWorst;
            public readonly Dictionary<string, double> avg = new();
            public readonly Dictionary<string, double> p95 = new();
            public readonly Dictionary<string, double> p50 = new();

            public double Get(string name) => avg.TryGetValue(name, out var v) ? v : -1;
            public double GetP95(string name) => p95.TryGetValue(name, out var v) ? v : -1;
            public double GetP50(string name) => p50.TryGetValue(name, out var v) ? v : -1;

            /// <summary>主线程（CPU Main Thread Frame Time，不含编辑器自己的那段）P50 / P95</summary>
            public double MainP50 => GetP50("CPU Main Thread Frame Time");
            public double MainP95 => GetP95("CPU Main Thread Frame Time");
            public double RenderP95 => GetP95("CPU Render Thread Frame Time");
            /// <summary>GPU 帧时 P50 / P95（帧时统计；拿不到 = −1）</summary>
            public double GpuP50 => Positive(GetP50("GPU Frame Time")) ?? -1;
            public double GpuP95 => Positive(GetP95("GPU Frame Time")) ?? -1;
            /// <summary>每帧 GC 分配（字节，平均）</summary>
            public double GcBytes => Get("GC Allocated In Frame");

            /// <summary>主线程 ms：优先「CPU Main Thread Frame Time」，没有就「Main Thread」</summary>
            public double MainMs => Positive(Get("CPU Main Thread Frame Time")) ?? Positive(Get("Main Thread")) ?? -1;
            public double RenderMs => Positive(Get("CPU Render Thread Frame Time")) ?? Positive(Get("Render Thread")) ?? -1;
            public double GpuMs => Positive(Get("GPU Frame Time")) ?? -1;
            public double EditorMs => Get("EditorLoop");
            public double PlayerLoopMs => Get("PlayerLoop");
            /// <summary>PlayerLoop 减去等待（等 GPU / 渲染线程 / 目标帧率）：游戏自己在主线程上的工作量</summary>
            public double PlayerWorkMs
            {
                get
                {
                    double pl = Get("PlayerLoop");
                    if (pl < 0) return -1;
                    double wait = 0;
                    foreach (var n in WaitNames)
                    {
                        double w = Get(n);
                        if (w > 0) wait += w;
                    }
                    return pl - wait;
                }
            }

            static double? Positive(double v) => v > 0 ? v : null;

            /// <summary>绘制调用合计（Unity 6.5 的分路径计数相加；一个都取不到时退回旧的 Draw Calls Count，再没有 = −1）</summary>
            public double DrawCalls => Sum(DrawCallNames, "Draw Calls Count");
            /// <summary>画出来的网格实例合计（含阴影投射）</summary>
            public double Instances => Sum(InstanceNames, null);
            public double SetPass => Get("SetPass Calls Count");
            public double Triangles => Get("Triangles Count");
            public double ShadowCasters => Get("Shadow Casters Count");
            public double BrgDrawCalls => Get("BRG Draw Calls Count");

            double Sum(string[] names, string legacy)
            {
                double sum = 0;
                bool any = false;
                foreach (var n in names)
                {
                    double v = Get(n);
                    if (v < 0) continue;
                    sum += v;
                    any = true;
                }
                return any ? sum : legacy != null ? Get(legacy) : -1;
            }

            public string Summary()
            {
                var sb = new StringBuilder();
                sb.Append($"帧 {frames} 个，帧时 平均 {frameAvg:F2} / P50 {frameP50:F2} / P95 {frameP95:F2} / 最差 {frameWorst:F1} ms");
                sb.Append($"；主线程 {Ms(MainMs)}、渲染线程 {Ms(RenderMs)}、GPU {Ms(GpuMs)}；PlayerLoop {Ms(PlayerLoopMs)}（去掉等待 {Ms(PlayerWorkMs)}）、EditorLoop {Ms(EditorMs)}");
                sb.Append($"；绘制调用 {N(DrawCalls)}（BRG {N(BrgDrawCalls)}）、SetPass {N(SetPass)}、实例 {N(Instances)}、三角面 {K(Triangles)}、投影体 {N(ShadowCasters)}");
                return sb.ToString();
            }

            /// <summary>分段明细（毫秒，平均 / P95），只列取得到的</summary>
            public string Breakdown()
            {
                var parts = new List<string>();
                foreach (var kv in avg)
                {
                    if (!timeNames.Contains(kv.Key)) continue;
                    if (kv.Value < 0.005 && (!p95.TryGetValue(kv.Key, out var q) || q < 0.005)) continue;
                    parts.Add($"{kv.Key} {kv.Value:F2}/{(p95.TryGetValue(kv.Key, out var p) ? p : 0):F2}");
                }
                return string.Join("；", parts);
            }

            internal readonly HashSet<string> timeNames = new();

            static string Ms(double v) => v < 0 ? "—" : $"{v:F2} ms";
            static string N(double v) => v < 0 ? "—" : $"{v:F0}";
            static string K(double v) => v < 0 ? "—" : v >= 1e6 ? $"{v / 1e6:F2}M" : v >= 1e3 ? $"{v / 1e3:F0}k" : $"{v:F0}";
        }

        /// <summary>主线程上的等待：等 GPU 交换链、等渲染线程、等目标帧率</summary>
        public static readonly string[] WaitNames = { "Gfx.WaitForPresentOnGfxThread", "Gfx.WaitForRenderThread", "WaitForTargetFPS" };

        public Stats Result()
        {
            var s = new Stats { frames = frameMs.Count };
            if (frameMs.Count > 0)
            {
                var sorted = frameMs.OrderBy(x => x).ToArray();
                s.frameAvg = frameMs.Average();
                s.frameP50 = sorted[(sorted.Length - 1) / 2];
                s.frameP95 = sorted[Mathf.Clamp(Mathf.CeilToInt(sorted.Length * 0.95f) - 1, 0, sorted.Length - 1)];
                s.frameWorst = sorted[^1];
            }
            foreach (var t in tracks)
            {
                if (t.values.Count == 0) continue;
                double k = t.time ? 1e-6 : 1;
                var sorted = t.values.OrderBy(x => x).ToArray();
                s.avg[t.name] = t.values.Average() * k;
                s.p95[t.name] = sorted[Mathf.Clamp(Mathf.CeilToInt(sorted.Length * 0.95f) - 1, 0, sorted.Length - 1)] * k;
                s.p50[t.name] = sorted[(sorted.Length - 1) / 2] * k;
                if (t.time) s.timeNames.Add(t.name);
            }
            return s;
        }

        /// <summary>
        /// 主相机视锥里的渲染器数（估算，同 L5 的 PerfBudgetCheck：视锥 + 远裁 + 按层剔除距离 <see cref="Camera.layerCullDistances"/> + 相机层遮罩；
        /// 不算遮挡剔除、阴影投射；第一人称层不算）。GPU 常驻绘制下 Renderer.isVisible 不可靠，所以自己算
        /// </summary>
        public static int FrustumRenderers(Camera cam, List<Renderer> all)
        {
            if (!cam) return -1;
            var planes = GeometryUtility.CalculateFrustumPlanes(cam);
            var dists = cam.layerCullDistances;
            var pos = cam.transform.position;
            var fwd = cam.transform.forward;
            int n = 0;
            foreach (var r in all)
            {
                if (!r || !r.enabled || r.forceRenderingOff || !r.gameObject.activeInHierarchy) continue;
                int layer = r.gameObject.layer;
                if (layer == Layers.FirstPerson || (cam.cullingMask & (1 << layer)) == 0) continue;
                var b = r.bounds;
                if (!GeometryUtility.TestPlanesAABB(planes, b)) continue;
                float d = dists != null && layer < dists.Length ? dists[layer] : 0;
                if (d > 0)
                {
                    float dist = cam.layerCullSpherical ? Vector3.Distance(pos, b.center) : Vector3.Dot(b.center - pos, fwd);
                    if (dist > d) continue;
                }
                n++;
            }
            return n;
        }

        /// <summary>编辑器 / 机器信息：Game 视图分辨率、目标帧率、垂直同步、图形 API、GPU、CPU</summary>
        public static string Environment() =>
            $"{SystemInfo.graphicsDeviceType} · {SystemInfo.graphicsDeviceName} · {SystemInfo.processorType}（{SystemInfo.processorCount} 线程）· 内存 {SystemInfo.systemMemorySize / 1024f:F0} GB；" +
            $"画面 {Screen.width}×{Screen.height}，targetFrameRate {Application.targetFrameRate}，vSyncCount {QualitySettings.vSyncCount}，" +
            $"画质级 {QualitySettings.names[QualitySettings.GetQualityLevel()]}，{(Application.isEditor ? "编辑器" : "独立程序")}，" +
            $"SRP Batcher {(GraphicsSettings.useScriptableRenderPipelineBatching ? "开" : "关")}";
    }
}
