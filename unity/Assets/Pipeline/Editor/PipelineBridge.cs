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
    /// 外部写 Library/SpiritfireBridge/request.json：{ "id": "...", "command": "all" }，编辑器每秒轮询一次，
    /// 先 AssetDatabase.Refresh（脚本有改动就编译、域重载，重载后接着处理同一个请求），再执行命令，
    /// 结果写 Library/SpiritfireBridge/response-&lt;id&gt;.json（状态、耗时、期间的日志）。
    /// 命令：refresh / sync / scenes / capture / sheets / motion / all（sync → scenes → capture → sheets → motion）。
    /// 安全：Play 模式中、或当前场景有未保存的修改时拒绝执行（不替用户丢弃修改）；执行完重新打开用户原来的场景。
    /// </summary>
    [InitializeOnLoad]
    public static class PipelineBridge
    {
        static readonly string Dir = Path.Combine(Directory.GetCurrentDirectory(), "Library", "SpiritfireBridge");
        static string RequestPath => Path.Combine(Dir, "request.json");
        static double nextPoll;
        static bool running;

        static PipelineBridge()
        {
            Directory.CreateDirectory(Dir);
            EditorApplication.update += Poll;
        }

        static void Poll()
        {
            if (running || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1.0;
            if (!File.Exists(RequestPath) || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            JObject req;
            try { req = JObject.Parse(File.ReadAllText(RequestPath)); }
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
                File.WriteAllText(RequestPath, req.ToString());
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                return;
            }
            if (EditorUtility.scriptCompilationFailed) { Respond(id, command, "failed", "脚本编译失败，见 Console", null, 0); return; }
            Run(id, command);
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

        static void Respond(string id, string command, string status, string error, List<string> log, double seconds)
        {
            var res = new JObject
            {
                ["id"] = id, ["command"] = command, ["status"] = status, ["error"] = error,
                ["seconds"] = Math.Round(seconds, 1), ["finished"] = DateTime.Now.ToString("s"),
                ["log"] = new JArray(log ?? new List<string>()),
            };
            File.WriteAllText(Path.Combine(Dir, $"response-{id}.json"), res.ToString());
            File.Delete(RequestPath);
        }
    }
}
