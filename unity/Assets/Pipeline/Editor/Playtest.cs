using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using Spiritfire.Game.Testing;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 冒烟测试的编辑器一侧（bridge.sh playtest [套件] [场景]）：按套件找场景（命令行给了就用命令行的）→ 打开场景 →
    /// 进 Play 模式（域重载后 SessionState 里还记着请求）→ 放一个 PlaytestRunner 跑这个套件 → 退出 Play → 把结果写回 Bridge 的 response 文件。
    /// 不带套件 = slice11（1-1 切片冒烟，场景 1-1 古道穿越戈壁）。场景可写 Assets/… .unity 路径、关卡 id（1-1）或 Assets/Scenes 下的场景名。
    /// 超时 600 s 强制退出；60 s 内没能进 Play（编译错误等）也写失败回应，免得 Bridge 的队列一直等它。
    /// </summary>
    [InitializeOnLoad]
    public static class Playtest
    {
        const string Key = "Spiritfire.Playtest.Id", StartKey = "Spiritfire.Playtest.Start", BgKey = "Spiritfire.Playtest.RunInBackground",
            EnteredKey = "Spiritfire.Playtest.Entered", SuiteKey = "Spiritfire.Playtest.Suite", SceneKey = "Spiritfire.Playtest.Scene",
            LockedKey = "Spiritfire.Playtest.ReloadLocked";
        static readonly string Dir = Path.Combine(Directory.GetCurrentDirectory(), "Library", "SpiritfireBridge");
        static string ResultPath => Path.Combine(Dir, "playtest-result.txt");

        /// <summary>冒烟测试进行中（从 Begin 到写完回应）：Bridge 期间不处理别的请求。</summary>
        public static bool Active => SessionState.GetString(Key, "") != "";

        static Playtest()
        {
            EditorApplication.playModeStateChanged += OnChange;
            EditorApplication.update += Update;
        }

        /// <param name="suite">套件 id，空 = <see cref="PlaytestSuites.Default"/></param>
        /// <param name="scene">场景（路径 / 关卡 id / 场景名），空 = 套件的默认场景</param>
        public static void Begin(string id, string suite = null, string scene = null)
        {
            if (string.IsNullOrWhiteSpace(suite)) suite = PlaytestSuites.Default;
            if (!PlaytestSuites.Exists(suite))
            {
                PipelineBridge.Respond(id, "playtest", "failed", $"没有登记冒烟测试套件「{suite}」（已登记：{string.Join("、", PlaytestSuites.Ids)}）", null, 0);
                return;
            }
            string scenePath = ResolveScene(string.IsNullOrWhiteSpace(scene) ? PlaytestSuites.SceneOf(suite) : scene);
            if (scenePath == null)
            {
                PipelineBridge.Respond(id, "playtest", "failed", $"找不到场景「{scene ?? PlaytestSuites.SceneOf(suite)}」（可写 Assets/… .unity、关卡 id 或 Assets/Scenes 下的场景名）", null, 0);
                return;
            }
            SessionState.SetString(Key, id);
            SessionState.SetString(SuiteKey, suite);
            SessionState.SetString(SceneKey, scenePath);
            SessionState.SetFloat(StartKey, (float)EditorApplication.timeSinceStartup);
            SessionState.SetBool(EnteredKey, false);
            if (File.Exists(ResultPath)) File.Delete(ResultPath);
            EditorSceneManager.OpenScene(scenePath);
            EditorApplication.EnterPlaymode();
        }

        /// <summary>场景参数 → 存在的场景路径：Assets/… .unity 原样；关卡 id 查 [LevelBuilder] 登记；否则当 Assets/Scenes 下的场景名</summary>
        static string ResolveScene(string scene)
        {
            if (string.IsNullOrWhiteSpace(scene)) return null;
            scene = scene.Trim().Replace('\\', '/');
            if (scene.EndsWith(".unity")) return File.Exists(scene) ? scene : null;
            if (Levels.LevelBuilders.Find(scene) is { } level && File.Exists(level.ScenePath)) return level.ScenePath;
            string named = $"Assets/Scenes/{scene}.unity";
            return File.Exists(named) ? named : null;
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
                // 别的会话 / 代理在测试期间改了脚本也不导入、不重载程序集（重载会杀掉 PlaytestRunner）：退出 Play 后再放开
                if (!SessionState.GetBool(LockedKey, false))
                {
                    AssetDatabase.DisallowAutoRefresh();
                    EditorApplication.LockReloadAssemblies();
                    SessionState.SetBool(LockedKey, true);
                }
                PlaytestRunner.Done = false;
                var go = new GameObject("Playtest Runner");
                var runner = go.AddComponent<PlaytestRunner>();
                runner.resultPath = ResultPath;
                runner.shotDir = Path.Combine(Directory.GetCurrentDirectory(), "Assets", "Art", "_Review");
                runner.suite = SessionState.GetString(SuiteKey, "");
            }
            else if (state == PlayModeStateChange.EnteredEditMode)
            {
                PlayerSettings.runInBackground = SessionState.GetBool(BgKey, false);
                Unlock();
                SessionState.EraseString(Key);
                var lines = File.Exists(ResultPath) ? new List<string>(File.ReadAllLines(ResultPath)) : new List<string> { "没有结果（超时或 Play 模式被中断）" };
                string status = lines.Count > 0 && lines[0] == "全部通过" ? "ok" : "playtest-failed";
                double secs = EditorApplication.timeSinceStartup - SessionState.GetFloat(StartKey, 0);
                PipelineBridge.Respond(id, "playtest", status, null, lines, secs, Extra());
            }
        }

        /// <summary>放开测试期间锁住的自动刷新和程序集重载（攒下的脚本改动这时才导入、重编译）</summary>
        static void Unlock()
        {
            if (!SessionState.GetBool(LockedKey, false)) return;
            SessionState.SetBool(LockedKey, false);
            EditorApplication.UnlockReloadAssemblies();
            AssetDatabase.AllowAutoRefresh();
        }

        static JObject Extra() => new()
        {
            ["suite"] = SessionState.GetString(SuiteKey, PlaytestSuites.Default),
            ["scene"] = SessionState.GetString(SceneKey, ""),
        };

        static void Update()
        {
            if (!Active) return;
            double elapsed = EditorApplication.timeSinceStartup - SessionState.GetFloat(StartKey, 0);
            if (!EditorApplication.isPlayingOrWillChangePlaymode && !SessionState.GetBool(EnteredKey, false) && elapsed > 60)
            {
                string id = SessionState.GetString(Key, "");
                SessionState.EraseString(Key);
                PipelineBridge.Respond(id, "playtest", "failed", "没能进入 Play 模式（编译错误？见 Console）", null, elapsed, Extra());
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
