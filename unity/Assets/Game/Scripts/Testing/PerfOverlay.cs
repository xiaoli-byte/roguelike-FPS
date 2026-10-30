using System;
using System.Text;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>一次性能采样（<see cref="PerfOverlay.Current"/>）：帧时分位数（毫秒）、渲染计数、每帧 GC 分配（字节；−1 = 拿不到）</summary>
    public struct PerfSnapshot
    {
        public float p50, p95, worst;
        public int frames;
        public long drawCalls, batches, setPass, triangles, vertices;
        public long gcPerFrame;
    }

    /// <summary>
    /// 性能叠层（开发版专用，L5）：屏幕右上角显示最近 300 帧的帧时 P50 / P95 / 最差、主相机绘制调用 / 批次 / SetPass、三角面 / 顶点、每帧 GC 分配。
    /// F11 开关（调试命令 perf，走 <see cref="DevCommands"/>），冒烟套件也可以直接设 <see cref="Visible"/> 或 <see cref="Sampling"/> 后读 <see cref="Current"/>
    /// （I2 整局通关断言「帧时 P95 在预算内」用它）。渲染计数用 ProfilerRecorder，只在采样时开着；正式包（非 Development Build）里什么都不做。
    /// GC 一栏包含叠层自己的 IMGUI 开销（几百字节），关掉叠层、只开 Sampling 时没有这部分。由 <see cref="SystemsBootstrap"/> 自动挂到 Game Systems。
    /// </summary>
    [GameSystem(900)]
    public sealed class PerfOverlay : MonoBehaviour
    {
        /// <summary>显示叠层（F11 切换）</summary>
        public static bool Visible;
        /// <summary>不显示也采样（冒烟测试读 <see cref="Current"/>）</summary>
        public static bool Sampling;
        /// <summary>最近一次刷新的采样（叠层或 Sampling 开着时每 0.25 s 更新）</summary>
        public static PerfSnapshot Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Visible = false;
            Sampling = false;
            Current = default;
        }

        const int Window = 300;
        readonly float[] frameMs = new float[Window];
        readonly float[] sorted = new float[Window];
        int head, count;
        float nextRefresh;
        bool recording;
        ProfilerRecorder drawCalls, batches, setPass, triangles, vertices, gcAlloc;
        /// <summary>Unity 6.5 起「Draw Calls Count / Batches Count」没了，绘制调用按路径分开计（SRP Batcher / 普通 / 实例化 / BRG…），这里相加</summary>
        readonly ProfilerRecorder[] drawParts = new ProfilerRecorder[PerfProbeNames.Length];
        static readonly string[] PerfProbeNames = Spiritfire.Game.Testing.PerfProbe.DrawCallNames;

        readonly StringBuilder sb = new(256);
        string text = "";
        GUIStyle style;
        readonly GUIContent content = new();

        void OnDisable()
        {
            if (recording) StopRecorders();
        }

        void Update()
        {
            if (!Debug.isDebugBuild) return;
            bool on = Visible || Sampling;
            if (!on)
            {
                if (recording) StopRecorders();
                count = 0;
                return;
            }
            if (!recording) StartRecorders();
            frameMs[head] = Time.unscaledDeltaTime * 1000f;
            head = (head + 1) % Window;
            count = Mathf.Min(count + 1, Window);
            float now = Time.unscaledTime;
            if (now < nextRefresh) return;
            nextRefresh = now + 0.25f;
            Current = Measure();
            if (Visible) text = Format(Current);
        }

        PerfSnapshot Measure()
        {
            var s = new PerfSnapshot { frames = count, gcPerFrame = -1 };
            if (count > 0)
            {
                Array.Copy(frameMs, sorted, count);
                Array.Sort(sorted, 0, count);
                s.p50 = sorted[(count - 1) / 2];
                s.p95 = sorted[Mathf.Min(count - 1, Mathf.CeilToInt(count * 0.95f) - 1)];
                s.worst = sorted[count - 1];
            }
            s.drawCalls = Last(drawCalls);
            s.batches = Last(batches);
            if (s.drawCalls < 0)
            {
                long sum = -1;
                foreach (var r in drawParts)
                    if (r.Valid) sum = Mathf.Max(0, (int)sum) + r.LastValue;
                s.drawCalls = sum;
            }
            s.setPass = Last(setPass);
            s.triangles = Last(triangles);
            s.vertices = Last(vertices);
            if (gcAlloc.Valid) s.gcPerFrame = gcAlloc.LastValue;
            return s;
        }

        static long Last(ProfilerRecorder r) => r.Valid ? r.LastValue : -1;

        string Format(PerfSnapshot s)
        {
            sb.Clear();
            sb.Append("性能（F11 关）  ").Append(s.frames).Append(" 帧\n");
            sb.Append("帧时 P50 ").Append(s.p50.ToString("F1")).Append(" ms  P95 ").Append(s.p95.ToString("F1"))
                .Append(" ms  最差 ").Append(s.worst.ToString("F1")).Append(" ms");
            if (s.p50 > 0) sb.Append("  (").Append(Mathf.RoundToInt(1000f / s.p50)).Append(" fps)");
            sb.Append('\n');
            sb.Append("绘制 ").Append(N(s.drawCalls)).Append("  批次 ").Append(N(s.batches)).Append("  SetPass ").Append(N(s.setPass)).Append('\n');
            sb.Append("三角面 ").Append(K(s.triangles)).Append("  顶点 ").Append(K(s.vertices)).Append('\n');
            sb.Append("GC 每帧 ").Append(s.gcPerFrame < 0 ? "—" : s.gcPerFrame < 1024 ? s.gcPerFrame + " B" : (s.gcPerFrame / 1024f).ToString("F1") + " KB");
            return sb.ToString();
        }

        static string N(long v) => v < 0 ? "—" : v.ToString();
        static string K(long v) => v < 0 ? "—" : v >= 1_000_000 ? (v / 1_000_000f).ToString("F2") + "M" : v >= 1000 ? (v / 1000f).ToString("F1") + "k" : v.ToString();

        void StartRecorders()
        {
            drawCalls = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
            batches = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Batches Count");
            setPass = ProfilerRecorder.StartNew(ProfilerCategory.Render, "SetPass Calls Count");
            triangles = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles Count");
            vertices = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Vertices Count");
            gcAlloc = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
            for (int i = 0; i < drawParts.Length; i++) drawParts[i] = ProfilerRecorder.StartNew(ProfilerCategory.Render, PerfProbeNames[i]);
            recording = true;
        }

        void StopRecorders()
        {
            drawCalls.Dispose();
            batches.Dispose();
            setPass.Dispose();
            triangles.Dispose();
            vertices.Dispose();
            gcAlloc.Dispose();
            for (int i = 0; i < drawParts.Length; i++) drawParts[i].Dispose();
            recording = false;
        }

        void OnGUI()
        {
            if (!Visible || !Debug.isDebugBuild || string.IsNullOrEmpty(text)) return;
            style ??= new GUIStyle(GUI.skin.box)
            {
                alignment = TextAnchor.UpperLeft, fontSize = 14, richText = false, wordWrap = false,
                normal = { textColor = new Color(0.95f, 0.95f, 0.9f) },
            };
            content.text = text;
            var size = style.CalcSize(content);
            GUI.Box(new Rect(Screen.width - size.x - 20, 12, size.x + 8, size.y + 4), content, style);
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>F11 性能叠层（再按一次关）</summary>
    [Defs]
    public sealed class PerfOverlayCommand : DevCommand
    {
        public override string Id => "perf";
        public override string Label => "性能叠层";
        public override Key Hotkey => Key.F11;
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            PerfOverlay.Visible = !PerfOverlay.Visible;
            DevCommands.Say(PerfOverlay.Visible ? "性能叠层：开" : "性能叠层：关");
        }
    }
#endif
}
