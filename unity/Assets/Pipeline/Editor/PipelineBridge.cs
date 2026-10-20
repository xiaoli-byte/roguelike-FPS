using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using Spiritfire.Art.Editor.Levels;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 管线桥：编辑器开着时也能从外部（命令行 / 自动化）驱动美术管线，不必关掉编辑器跑 -batchmode。
    /// 外部写 Library/SpiritfireBridge/queue/&lt;id&gt;.json：{ "id": "...", "command": "level", "args": ["1-1"] }（id 以毫秒时间戳开头，
    /// 先写同目录的临时文件再改名；args 可省略），编辑器每秒轮询一次，按文件名顺序一次处理一个：
    /// 先 AssetDatabase.Refresh（脚本有改动就编译、域重载，重载后接着处理同一个请求），再执行命令，
    /// 结果写 Library/SpiritfireBridge/response-&lt;id&gt;.json（状态、耗时、期间的日志，部分命令另带汇总字段），然后只删掉这一条请求。
    /// 多个会话共用一个编辑器：执行期间别人提交的请求留在队列里排队，不会互相覆盖或被删。
    /// 旧版 bridge.sh 的单槽 request.json 仍然接受（排在队列前面），过渡期用。
    /// 命令：refresh / sync / scenes / capture / sheets / motion / all（sync → scenes → capture → sheets → motion）/
    /// level &lt;id&gt;（按 [LevelBuilder] 登记生成一张关卡 + 验收 + 截图；level11 = level 1-1）/
    /// core（常驻 Core 场景 + GameDatabase，构建设置 Core 排第 0、关卡按 RunPlan 排，见 CoreSceneBuilder）/ levels（先 core，再全部登记的关卡）/
    /// tests [过滤]（EditMode 测试，过滤 = 测试全名的正则；汇总写进回应的 tests 字段，明细 Assets/Art/_Review/tests_report.txt）/
    /// playtest [套件] [场景]（Play 模式冒烟测试，默认 slice11，见 Playtest.cs）/
    /// pets（导入 Assets/Art/Pets 下的灵宠模型，生成 Resources/Pets 预制体）/ petcompare（灵宠与现有角色同场景画风对比截图）/ fur（毛发画质 低 / 中 / 高 对比截图）/ furbench（毛发三档帧耗时）/
    /// ui（UI Toolkit 基座资产：SDF 字体、分层 PanelSettings、文本设置，见 UIBuilder.cs）。
    /// 安全：Play 模式中、或当前场景有未保存的修改时拒绝执行（不替用户丢弃修改）；执行完重新打开用户原来的场景。
    /// 编辑器没开时 bridge.sh 用 -batchmode -executeMethod <see cref="BatchRun"/> 跑 level / levels（命令和参数走命令行）。
    /// </summary>
    [InitializeOnLoad]
    public static class PipelineBridge
    {
        static readonly string Dir = Path.Combine(Directory.GetCurrentDirectory(), "Library", "SpiritfireBridge");
        static readonly string QueueDir = Path.Combine(Dir, "queue");
        static string LegacyPath => Path.Combine(Dir, "request.json");
        // 正在处理的请求 id：刷新引起域重载后接着处理它，不被期间新排进来的请求插队
        const string CurrentKey = "Spiritfire.Bridge.Current";
        static double nextPoll;
        static bool running;

        static PipelineBridge()
        {
            Directory.CreateDirectory(QueueDir);
            EditorApplication.update += Poll;
            BridgeTests.Resume();
        }

        static void Poll()
        {
            if (running || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1.0;
            // 冒烟测试在 Play 模式里跑、EditMode 测试跨好几帧跑：队列等它们写完回应再继续，不当成「用户在 Play」拒掉后面的请求
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || Playtest.Active || BridgeTests.Active) return;
            string path = NextRequest();
            if (path == null) return;
            JObject req;
            try { req = JObject.Parse(File.ReadAllText(path)); }
            catch { return; } // 外部还没写完
            string id = (string)req["id"] ?? "noid";
            string command = (string)req["command"] ?? "all";
            string[] args = req["args"] is JArray a ? a.Select(t => (string)t).Where(s => !string.IsNullOrWhiteSpace(s)).ToArray() : Array.Empty<string>();

            if (EditorApplication.isPlayingOrWillChangePlaymode) { Respond(id, command, "rejected", "编辑器在 Play 模式中", null, 0); return; }
            for (int i = 0; i < EditorSceneManager.sceneCount; i++)
                if (EditorSceneManager.GetSceneAt(i).isDirty) { Respond(id, command, "rejected", "当前场景有未保存的修改，请先保存", null, 0); return; }

            // 第一阶段：刷新资源（可能触发编译与域重载，重载后静态构造函数重新挂上轮询，再进第二阶段）
            if ((int?)req["stage"] != 1)
            {
                req["stage"] = 1;
                File.WriteAllText(path, req.ToString());
                SessionState.SetString(CurrentKey, id);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                return;
            }
            if (EditorUtility.scriptCompilationFailed) { Respond(id, command, "failed", "脚本编译失败，见 Console", null, 0); return; }
            if (command == "playtest")
            {
                // 冒烟测试要进 Play 模式（会域重载），由 Playtest 自己在退出 Play 后写回应；请求文件留到那时再删
                Playtest.Begin(id, Arg(args, 0), Arg(args, 1));
                return;
            }
            if (command == "tests")
            {
                // EditMode 测试由测试框架逐帧推进，跑完由 BridgeTests 写回应；请求文件留到那时再删
                BridgeTests.Begin(id, Arg(args, 0));
                return;
            }
            Run(id, command, args);
        }

        static string Arg(string[] args, int i) => args != null && i < args.Length ? args[i] : null;

        /// <summary>下一个要处理的请求文件：正在处理的那条 → 旧版单槽 request.json → 队列里文件名最小（最早提交）的。</summary>
        static string NextRequest()
        {
            string current = SessionState.GetString(CurrentKey, "");
            if (current != "" && RequestFile(current) is { } p) return p;
            if (File.Exists(LegacyPath)) return LegacyPath;
            if (!Directory.Exists(QueueDir)) return null;
            string first = null;
            foreach (var f in Directory.GetFiles(QueueDir, "*.json"))
                if (f.EndsWith(".json", StringComparison.Ordinal) && (first == null || string.CompareOrdinal(f, first) < 0)) first = f;
            return first;
        }

        static string RequestFile(string id)
        {
            string p = Path.Combine(QueueDir, id + ".json");
            if (File.Exists(p)) return p;
            try { if (File.Exists(LegacyPath) && (string)JObject.Parse(File.ReadAllText(LegacyPath))["id"] == id) return LegacyPath; }
            catch { } // 旧版 bridge.sh 正在写
            return null;
        }

        /// <summary>同步执行一条命令，写回应；返回状态（ok / failed / level-checks-failed / qa-errors …）</summary>
        static string Run(string id, string command, string[] args)
        {
            running = true;
            var log = new List<string>();
            void OnLog(string msg, string stack, LogType type)
            {
                if (type is LogType.Error or LogType.Exception) log.Add($"[{type}] {msg}\n{stack}");
                else if (msg.StartsWith("[")) log.Add(msg);
            }
            Application.logMessageReceived += OnLog;
            string previousScene = EditorSceneManager.GetActiveScene().path;
            var t0 = EditorApplication.timeSinceStartup;
            string status = "ok", error = null;
            var extra = new JObject();
            try
            {
                int errors = 0;
                bool all = command == "all";
                if (all || command == "sync") ArtSync.Sync(out errors);
                if (all || command == "scenes") ShowcaseSceneBuilder.BuildAll();
                if (all || command == "capture") ReviewCapture.CaptureAll();
                if (all || command == "sheets") AnimReviewSheet.RenderAll();
                if (all || command == "motion")
                    foreach (var t in ShowcaseTheme.All)
                        if (File.Exists(t.ScenePath)) foreach (bool ik in new[] { false, true }) ShowcaseSimulator.Simulate(t, ik);
                // level11 是 level 1-1 的旧名
                if (command == "level11") status = BuildLevels(new[] { "1-1" }, extra, ref error);
                if (command == "level")
                {
                    if (args.Length == 0)
                    {
                        status = "failed";
                        error = $"用法：bridge.sh level <id>（已登记：{string.Join("、", LevelBuilders.Ids)}）";
                    }
                    else status = BuildLevels(args, extra, ref error);
                }
                // core：常驻 Core 场景 + GameDatabase + 构建设置（Core 排第 0）；levels 先跑它再生成全部关卡
                if (command == "core" || command == "levels")
                {
                    int coreFails = CoreSceneBuilder.Build();
                    extra["core"] = new JObject { ["scene"] = CoreSceneBuilder.ScenePath, ["failures"] = coreFails };
                    if (coreFails > 0) status = "level-checks-failed";
                }
                if (command == "levels")
                {
                    string levels = BuildLevels(LevelBuilders.Ids.ToArray(), extra, ref error);
                    if (levels != "ok") status = levels;
                    LevelBuilders.SyncBuildSettings();
                }
                if (command == "pets") errors += PetArtImport.ImportAll();
                if (command == "petcompare") PetStyleCompare.Run();
                if (command == "fur") FurReview.Run();
                if (command == "furbench") FurBench.Run();
                if (command == "ui") errors += UIBuilder.Build();
                // 临时诊断：调用 Spiritfire.Art.Editor.Diag.Run()（存在时），排查问题用，用完删掉那个类
                if (command == "diag")
                    Type.GetType("Spiritfire.Art.Editor.Diag, Spiritfire.Art.Editor")?.GetMethod("Run")?.Invoke(null, null);
                if (errors > 0) status = "qa-errors";
            }
            catch (Exception e)
            {
                status = "failed";
                error = e.ToString();
            }
            finally
            {
                Application.logMessageReceived -= OnLog;
                if (!string.IsNullOrEmpty(previousScene) && File.Exists(previousScene) && EditorSceneManager.GetActiveScene().path != previousScene)
                    EditorSceneManager.OpenScene(previousScene);
                Respond(id, command, status, error, log, EditorApplication.timeSinceStartup - t0, extra.Count > 0 ? extra : null);
                running = false;
            }
            return status;
        }

        /// <summary>
        /// 按 [LevelBuilder] 登记依次生成关卡（生成 + 烘焙 + 验收检查 + 截图），每张图的结果写进回应的 levels 字段。
        /// 某一张抛异常不影响后面的；有异常 → failed，否则有不合格项 → level-checks-failed。
        /// </summary>
        static string BuildLevels(string[] ids, JObject extra, ref string error)
        {
            var results = new JArray();
            var errors = new List<string>();
            int fails = 0;
            foreach (var levelId in ids)
            {
                var entry = LevelBuilders.Find(levelId);
                if (entry == null)
                {
                    errors.Add($"没有登记关卡「{levelId}」（已登记：{string.Join("、", LevelBuilders.Ids)}）");
                    results.Add(new JObject { ["id"] = levelId, ["error"] = "未登记" });
                    continue;
                }
                try
                {
                    int n = entry.Build(true);
                    fails += n;
                    results.Add(new JObject { ["id"] = entry.Id, ["scene"] = entry.ScenePath, ["failures"] = n });
                }
                catch (Exception e) when (ids.Length > 1)
                {
                    errors.Add($"{entry.Id}：{e}");
                    results.Add(new JObject { ["id"] = entry.Id, ["scene"] = entry.ScenePath, ["error"] = e.Message });
                }
            }
            extra["levels"] = results;
            if (errors.Count > 0)
            {
                error = string.Join("\n", errors);
                return "failed";
            }
            return fails > 0 ? "level-checks-failed" : "ok";
        }

        /// <summary>
        /// 编辑器没开时 bridge.sh 的入口：Unity.exe -batchmode -projectPath … -executeMethod Spiritfire.Art.Editor.PipelineBridge.BatchRun
        /// -bridgeCommand level -bridgeArg 1-1（-bridgeArg 可重复）。和编辑器里一样执行，回应写 Library/SpiritfireBridge/response-batch-&lt;命令&gt;.json，
        /// 退出码 0 = ok，1 = 其它状态。只用于同步命令（level / levels 等），playtest / tests 不走这里。
        /// </summary>
        public static void BatchRun()
        {
            var argv = Environment.GetCommandLineArgs();
            string command = null;
            var args = new List<string>();
            for (int i = 0; i + 1 < argv.Length; i++)
            {
                if (argv[i] == "-bridgeCommand") command = argv[++i];
                else if (argv[i] == "-bridgeArg") args.Add(argv[++i]);
            }
            if (string.IsNullOrEmpty(command))
            {
                Debug.LogError("[Bridge] BatchRun 缺少 -bridgeCommand");
                EditorApplication.Exit(1);
                return;
            }
            string status = Run($"batch-{command}", command, args.ToArray());
            EditorApplication.Exit(status == "ok" ? 0 : 1);
        }

        internal static void Respond(string id, string command, string status, string error, List<string> log, double seconds, JObject extra = null)
        {
            var res = new JObject
            {
                ["id"] = id, ["command"] = command, ["status"] = status, ["error"] = error,
                ["seconds"] = Math.Round(seconds, 1), ["finished"] = DateTime.Now.ToString("s"),
                ["log"] = new JArray(log ?? new List<string>()),
            };
            if (extra != null)
                foreach (var p in extra.Properties())
                    res[p.Name] = p.Value;
            Directory.CreateDirectory(Dir);
            File.WriteAllText(Path.Combine(Dir, $"response-{id}.json"), res.ToString());
            // 只删这一条请求：执行期间别的会话排进来的请求不能跟着丢
            if (RequestFile(id) is { } path) File.Delete(path);
            if (SessionState.GetString(CurrentKey, "") == id) SessionState.EraseString(CurrentKey);
        }
    }

    /// <summary>
    /// bridge.sh tests [过滤]：用 TestRunnerApi 跑 EditMode 测试。过滤是测试全名（命名空间.类.方法）的正则，如 StatSheet、^Spiritfire\.Game\.Tests\.Damage。
    /// 测试框架逐帧推进：收到 RunFinished 先把结果存进 SessionState，等这次测试任务（还原场景等收尾步骤）真正结束再写回应，
    /// 期间 Bridge 不处理别的请求。万一中途域重载，静态构造里重新挂回调；15 分钟没结束算失败。
    /// 回应的 tests 字段：总数 / 通过 / 失败 / 跳过 / 未定 / 失败项；明细（每个测试的结果、失败信息与堆栈）写 Assets/Art/_Review/tests_report.txt。
    /// </summary>
    static class BridgeTests
    {
        const string Key = "Spiritfire.Tests.Id", FilterKey = "Spiritfire.Tests.Filter", StartKey = "Spiritfire.Tests.Start",
            JobKey = "Spiritfire.Tests.Job", PendingKey = "Spiritfire.Tests.Pending", PendingAtKey = "Spiritfire.Tests.PendingAt";
        const string ReportPath = "Assets/Art/_Review/tests_report.txt";
        const double Timeout = 900;
        static Callbacks callbacks;

        /// <summary>测试请求进行中（从 Begin 到写完回应）</summary>
        public static bool Active => SessionState.GetString(Key, "") != "";

        /// <summary>PipelineBridge 的静态构造里调用：挂上逐帧检查；域重载前有测试在跑就重新挂回调</summary>
        public static void Resume()
        {
            EditorApplication.update += Update;
            if (Active && SessionState.GetString(PendingKey, "") == "") Register();
        }

        public static void Begin(string id, string filter)
        {
            filter = filter?.Trim() ?? "";
            SessionState.SetString(Key, id);
            SessionState.SetString(FilterKey, filter);
            SessionState.SetFloat(StartKey, (float)EditorApplication.timeSinceStartup);
            SessionState.EraseString(PendingKey);
            SessionState.EraseString(JobKey);
            Register();
            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            try
            {
                var f = new Filter { testMode = TestMode.EditMode };
                if (filter != "") f.groupNames = new[] { filter };
                SessionState.SetString(JobKey, api.Execute(new ExecutionSettings(f)) ?? "");
            }
            catch (Exception e)
            {
                Finish("failed", $"启动测试失败：{e}", null, null);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(api);
            }
        }

        static void Register()
        {
            if (callbacks != null) return;
            callbacks = new Callbacks();
            TestRunnerApi.RegisterTestCallback(callbacks);
        }

        static void Update()
        {
            if (!Active) return;
            double now = EditorApplication.timeSinceStartup;
            string pending = SessionState.GetString(PendingKey, "");
            if (pending != "")
            {
                // 等测试任务的收尾步骤（还原场景、撤销记录…）跑完再放行下一个请求；判断不了就等 3 秒
                bool? running = JobRunning();
                if (running == true && now - SessionState.GetFloat(PendingAtKey, 0) < 30) return;
                if (running == null && now - SessionState.GetFloat(PendingAtKey, 0) < 3) return;
                var p = JObject.Parse(pending);
                Finish((string)p["status"], (string)p["error"], p["log"]?.ToObject<List<string>>(), p["extra"] as JObject);
                return;
            }
            double elapsed = now - SessionState.GetFloat(StartKey, 0);
            if (elapsed > Timeout) Finish("failed", $"{Timeout / 60:F0} 分钟内测试没有跑完（中途被打断？）", null, null);
            else if (elapsed > 10 && JobRunning() == false) Finish("failed", "测试任务已经结束，但没有收到结果（见 Console）", null, null);
        }

        /// <summary>这次测试任务是否还在跑（测试框架的内部接口，反射取；取不到返回 null）</summary>
        static bool? JobRunning()
        {
            string job = SessionState.GetString(JobKey, "");
            var m = typeof(TestRunnerApi).GetMethod("IsRunning", BindingFlags.NonPublic | BindingFlags.Static, null, new[] { typeof(string) }, null);
            if (job == "" || m == null) return null;
            try { return (bool)m.Invoke(null, new object[] { job }); }
            catch { return null; }
        }

        /// <summary>结果先存起来（见 Update），不在测试框架的回调里直接放行</summary>
        static void Stash(string status, string error, List<string> log, JObject extra)
        {
            if (!Active || SessionState.GetString(PendingKey, "") != "") return;
            var p = new JObject { ["status"] = status, ["error"] = error, ["log"] = new JArray(log ?? new List<string>()), ["extra"] = extra };
            SessionState.SetString(PendingKey, p.ToString());
            SessionState.SetFloat(PendingAtKey, (float)EditorApplication.timeSinceStartup);
        }

        static void Finish(string status, string error, List<string> log, JObject extra)
        {
            string id = SessionState.GetString(Key, "");
            if (id == "") return;
            double seconds = EditorApplication.timeSinceStartup - SessionState.GetFloat(StartKey, 0);
            SessionState.EraseString(Key);
            SessionState.EraseString(PendingKey);
            SessionState.EraseString(JobKey);
            if (callbacks != null)
            {
                TestRunnerApi.UnregisterTestCallback(callbacks);
                callbacks = null;
            }
            PipelineBridge.Respond(id, "tests", status, error, log, seconds, extra);
        }

        static void Report(ITestResultAdaptor root)
        {
            var leaves = new List<ITestResultAdaptor>();
            Collect(root, leaves);
            int Count(TestStatus s) => leaves.Count(r => r.TestStatus == s);
            int passed = Count(TestStatus.Passed), failed = Count(TestStatus.Failed), skipped = Count(TestStatus.Skipped), inconclusive = Count(TestStatus.Inconclusive);
            string filter = SessionState.GetString(FilterKey, "");
            string summary = $"EditMode 测试（过滤：{(filter == "" ? "无" : filter)}）：{leaves.Count} 个，通过 {passed}，失败 {failed}，跳过 {skipped}，未定 {inconclusive}，用时 {root.Duration:F1} s";

            var log = new List<string> { summary };
            var failures = new JArray();
            var sb = new StringBuilder().AppendLine(summary);
            foreach (var r in leaves)
            {
                string mark = r.TestStatus switch { TestStatus.Passed => "✓", TestStatus.Failed => "✗", _ => "-" };
                sb.AppendLine($"{mark} {r.FullName}（{r.Duration:F2} s）");
                if (r.TestStatus == TestStatus.Passed) continue;
                if (!string.IsNullOrWhiteSpace(r.Message)) sb.AppendLine("    " + r.Message.Trim().Replace("\n", "\n    "));
                if (r.TestStatus != TestStatus.Failed) continue;
                if (!string.IsNullOrWhiteSpace(r.StackTrace)) sb.AppendLine("    " + r.StackTrace.Trim().Replace("\n", "\n    "));
                log.Add($"✗ {r.FullName}：{r.Message?.Trim()}");
                failures.Add(new JObject { ["name"] = r.FullName, ["message"] = r.Message?.Trim() });
            }
            string verdict = failed > 0 ? $"不合格 {failed} 项" : leaves.Count == 0 ? "没有匹配的测试" : "全部通过";
            sb.AppendLine(verdict);
            log.Add(verdict);
            Directory.CreateDirectory(Path.GetDirectoryName(ReportPath)!);
            File.WriteAllText(ReportPath, sb.ToString());

            var extra = new JObject
            {
                ["tests"] = new JObject
                {
                    ["filter"] = filter, ["total"] = leaves.Count, ["passed"] = passed, ["failed"] = failed, ["skipped"] = skipped,
                    ["inconclusive"] = inconclusive, ["seconds"] = Math.Round(root.Duration, 2), ["report"] = ReportPath, ["failures"] = failures,
                },
            };
            Stash(failed > 0 ? "tests-failed" : leaves.Count == 0 ? "no-tests" : "ok", null, log, extra);
        }

        /// <summary>叶子 = 单个测试用例（参数化测试的每组参数各算一个）；空的测试类 / 程序集不算</summary>
        static void Collect(ITestResultAdaptor r, List<ITestResultAdaptor> leaves)
        {
            if (r.HasChildren)
                foreach (var c in r.Children) Collect(c, leaves);
            else if (r.Test == null || !r.Test.IsSuite) leaves.Add(r);
        }

        sealed class Callbacks : IErrorCallbacks
        {
            public void RunStarted(ITestAdaptor testsToRun) { }
            public void RunFinished(ITestResultAdaptor result) => Report(result);
            public void TestStarted(ITestAdaptor test) { }
            public void TestFinished(ITestResultAdaptor result) { }
            public void OnError(string message) => Stash("failed", $"测试框架报错：{message}", null, null);
        }
    }
}
