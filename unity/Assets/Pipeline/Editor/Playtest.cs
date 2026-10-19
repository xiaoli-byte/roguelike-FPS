using System.Collections.Generic;
using System.IO;
using Spiritfire.Game.Testing;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 冒烟测试的编辑器一侧（bridge.sh playtest）：打开 1-1 场景 → 进 Play 模式（域重载后 SessionState 里还记着请求）→
    /// 放一个 PlaytestRunner 跑完 → 退出 Play → 把结果写回 Bridge 的 response 文件。超时 600 s 强制退出；
    /// 60 s 内没能进 Play（编译错误等）也写失败回应，免得 Bridge 的队列一直等它。
    /// </summary>
    [InitializeOnLoad]
    public static class Playtest
    {
        const string Key = "Spiritfire.Playtest.Id", StartKey = "Spiritfire.Playtest.Start", BgKey = "Spiritfire.Playtest.RunInBackground",
            EnteredKey = "Spiritfire.Playtest.Entered";
        static readonly string Dir = Path.Combine(Directory.GetCurrentDirectory(), "Library", "SpiritfireBridge");
        static string ResultPath => Path.Combine(Dir, "playtest-result.txt");

        /// <summary>冒烟测试进行中（从 Begin 到写完回应）：Bridge 期间不处理别的请求。</summary>
        public static bool Active => SessionState.GetString(Key, "") != "";

        static Playtest()
        {
            EditorApplication.playModeStateChanged += OnChange;
            EditorApplication.update += Update;
        }

        public static void Begin(string id)
        {
            SessionState.SetString(Key, id);
            SessionState.SetFloat(StartKey, (float)EditorApplication.timeSinceStartup);
            SessionState.SetBool(EnteredKey, false);
            if (File.Exists(ResultPath)) File.Delete(ResultPath);
            EditorSceneManager.OpenScene(Levels.Level_1_1.ScenePath);
            EditorApplication.EnterPlaymode();
        }

        static void OnChange(PlayModeStateChange state)
        {
            string id = SessionState.GetString(Key, "");
            if (id == "") return;
            if (state == PlayModeStateChange.EnteredPlayMode)
            {
                // 编辑器窗口不在前台时，runInBackground 关着的话 Play 模式会停在第一帧：测试期间强制后台运行（退出 Play 时还原）
                SessionState.SetBool(EnteredKey, true);
                SessionState.SetBool(BgKey, PlayerSettings.runInBackground);
                Application.runInBackground = true;
                PlaytestRunner.Done = false;
                var go = new GameObject("Playtest Runner");
                var runner = go.AddComponent<PlaytestRunner>();
                runner.resultPath = ResultPath;
                runner.shotDir = Path.Combine(Directory.GetCurrentDirectory(), "Assets", "Art", "_Review");
            }
            else if (state == PlayModeStateChange.EnteredEditMode)
            {
                PlayerSettings.runInBackground = SessionState.GetBool(BgKey, false);
                SessionState.EraseString(Key);
                var lines = File.Exists(ResultPath) ? new List<string>(File.ReadAllLines(ResultPath)) : new List<string> { "没有结果（超时或 Play 模式被中断）" };
                string status = lines.Count > 0 && lines[0] == "全部通过" ? "ok" : "playtest-failed";
                double secs = EditorApplication.timeSinceStartup - SessionState.GetFloat(StartKey, 0);
                PipelineBridge.Respond(id, "playtest", status, null, lines, secs);
            }
        }

        static void Update()
        {
            if (!Active) return;
            double elapsed = EditorApplication.timeSinceStartup - SessionState.GetFloat(StartKey, 0);
            if (!EditorApplication.isPlayingOrWillChangePlaymode && !SessionState.GetBool(EnteredKey, false) && elapsed > 60)
            {
                string id = SessionState.GetString(Key, "");
                SessionState.EraseString(Key);
                PipelineBridge.Respond(id, "playtest", "failed", "没能进入 Play 模式（编译错误？见 Console）", null, elapsed);
                return;
            }
            if (!EditorApplication.isPlaying) return;
            bool timeout = elapsed > 600;
            if (PlaytestRunner.Done || timeout)
            {
                PlaytestRunner.Done = false;
                EditorApplication.ExitPlaymode();
            }
        }
    }
}
