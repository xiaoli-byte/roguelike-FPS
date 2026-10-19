using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 管线桥：编辑器开着时也能从外部（命令行 / 自动化）驱动美术管线，不必关掉编辑器跑 -batchmode。
    /// 外部写 Library/SpiritfireBridge/queue/&lt;id&gt;.json：{ "id": "...", "command": "all" }（id 以毫秒时间戳开头，
    /// 先写同目录的临时文件再改名），编辑器每秒轮询一次，按文件名顺序一次处理一个：
    /// 先 AssetDatabase.Refresh（脚本有改动就编译、域重载，重载后接着处理同一个请求），再执行命令，
    /// 结果写 Library/SpiritfireBridge/response-&lt;id&gt;.json（状态、耗时、期间的日志），然后只删掉这一条请求。
    /// 多个会话共用一个编辑器：执行期间别人提交的请求留在队列里排队，不会互相覆盖或被删。
    /// 旧版 bridge.sh 的单槽 request.json 仍然接受（排在队列前面），过渡期用。
    /// 命令：refresh / sync / scenes / capture / sheets / motion / all（sync → scenes → capture → sheets → motion）/ level11 / playtest /
    /// pets（导入 Assets/Art/Pets 下的灵宠模型，生成 Resources/Pets 预制体）/ petcompare（灵宠与现有角色同场景画风对比截图）/ fur（毛发画质 低 / 中 / 高 对比截图）。
    /// 安全：Play 模式中、或当前场景有未保存的修改时拒绝执行（不替用户丢弃修改）；执行完重新打开用户原来的场景。
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
        }

        static void Poll()
        {
            if (running || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1.0;
            // 冒烟测试在 Play 模式里跑：队列等它写完回应再继续，不当成「用户在 Play」拒掉后面的请求
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || Playtest.Active) return;
            string path = NextRequest();
            if (path == null) return;
            JObject req;
            try { req = JObject.Parse(File.ReadAllText(path)); }
            catch { return; } // 外部还没写完
            string id = (string)req["id"] ?? "noid";
            string command = (string)req["command"] ?? "all";

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
                Playtest.Begin(id);
                return;
            }
            Run(id, command);
        }

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

        static void Run(string id, string command)
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
                if (command == "level11" && Levels.Level_1_1.Build(true) > 0) status = "level-checks-failed";
                if (command == "pets") errors += PetArtImport.ImportAll();
                if (command == "petcompare") PetStyleCompare.Run();
                if (command == "fur") FurReview.Run();
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
                Respond(id, command, status, error, log, EditorApplication.timeSinceStartup - t0);
                running = false;
            }
        }

        internal static void Respond(string id, string command, string status, string error, List<string> log, double seconds)
        {
            var res = new JObject
            {
                ["id"] = id, ["command"] = command, ["status"] = status, ["error"] = error,
                ["seconds"] = Math.Round(seconds, 1), ["finished"] = DateTime.Now.ToString("s"),
                ["log"] = new JArray(log ?? new List<string>()),
            };
            File.WriteAllText(Path.Combine(Dir, $"response-{id}.json"), res.ToString());
            // 只删这一条请求：执行期间别的会话排进来的请求不能跟着丢
            if (RequestFile(id) is { } path) File.Delete(path);
            if (SessionState.GetString(CurrentKey, "") == id) SessionState.EraseString(CurrentKey);
        }
    }
}
