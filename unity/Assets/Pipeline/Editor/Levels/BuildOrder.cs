using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 构建设置的场景顺序（I1；docs/unity-parity.md 4.9「构建设置里的场景顺序按 RunPlan 生成」，4.12「EditorBuildSettings 只按 RunPlan 重写」）：
    ///   0. Core（常驻场景：打包后从它启动，MenuFlow.Boot 再转去主菜单；SceneFlow 叠加加载关卡）
    ///   1. MainMenu（主菜单 + 选英雄）
    ///   2… RunPlan 的 12 关，按主线顺序（试玩开关开着时 <see cref="RunPlan.DemoEnd"/> 之后的关卡留在表里但不打进包）
    ///   之后：其余已登记的关卡（测试场等）按登记顺序 → 其它场景（展示场景等）原顺序，启用状态不动。
    /// 磁盘上有、却不在构建设置里的 Core / 主菜单 / 关卡场景补进来（SceneFlow / MenuFlow 打包后只能加载构建设置里的场景）。
    /// 顺序和启用状态都没变就不写（不弄脏 EditorBuildSettings.asset）。
    /// 谁调：<see cref="LevelBuilders.SyncBuildSettings"/>（level / levels / core / menu 命令生成场景之后）；编辑器每次脚本重载后自动对一遍
    /// （不在 Play / 打包中时）；菜单 Spiritfire/构建设置/按 RunPlan 排序。试玩包：菜单 Spiritfire/构建设置/试玩版 打开编译符号 SPIRITFIRE_DEMO。
    /// </summary>
    [InitializeOnLoad]
    public static class BuildOrder
    {
        public const string DemoDefine = "SPIRITFIRE_DEMO";
        const string MenuRoot = "Spiritfire/构建设置/";

        static BuildOrder()
        {
            EditorApplication.delayCall -= AutoApply;
            EditorApplication.delayCall += AutoApply;
        }

        static void AutoApply()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || BuildPipeline.isBuildingPlayer || EditorApplication.isCompiling) return;
            try
            {
                Apply();
                Save();
            }
            catch (System.Exception e) { Debug.LogException(e); }
        }

        const string SettingsPath = "ProjectSettings/EditorBuildSettings.asset";

        /// <summary>
        /// 把改过的构建设置写回 ProjectSettings/EditorBuildSettings.asset（只写这一个对象，不像 SaveAssets 那样顺带保存别人改到一半的资产）。
        /// 没改过（不脏）什么都不做
        /// </summary>
        public static void Save()
        {
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(SettingsPath))
                if (o && EditorUtility.IsDirty(o)) AssetDatabase.SaveAssetIfDirty(o);
        }

        /// <summary>游戏本体的场景（按构建顺序）：Core → 主菜单 → RunPlan 的关卡</summary>
        public static IReadOnlyList<string> GameScenes
        {
            get
            {
                var list = new List<string> { SceneFlow.CorePath, MenuFlow.MenuScenePath };
                list.AddRange(RunPlan.Stages.Select(s => s.scene));
                return list;
            }
        }

        /// <summary>按规则排好的构建设置（不写）：每项 = 路径 + 是否启用</summary>
        public static List<EditorBuildSettingsScene> Compute(IEnumerable<EditorBuildSettingsScene> current, IReadOnlyList<string> registered = null)
        {
            var scenes = current.Select(s => new EditorBuildSettingsScene(s.path, s.enabled)).ToList();
            var game = GameScenes;
            foreach (var p in game)
                if (File.Exists(p) && !scenes.Any(s => s.path == p))
                    scenes.Add(new EditorBuildSettingsScene(p, true));
            registered ??= LevelBuilders.All.Select(e => e.ScenePath).ToList();
            int Rank(string path, int original)
            {
                int i = IndexOf(game, path);
                if (i >= 0) return i;
                i = IndexOf(registered, path);
                if (i >= 0) return 1000 + i;
                return 100000 + original;
            }
            var sorted = scenes.Select((s, i) => (s, i)).OrderBy(x => Rank(x.s.path, x.i)).Select(x => x.s).ToList();
            // 游戏场景：Core / 主菜单 / 路线上的关卡启用，试玩版终点之后的关卡不打进包
            foreach (var s in sorted)
            {
                var stage = RunPlan.ForScene(s.path);
                if (stage != null) s.enabled = RunPlan.InPlay(stage);
                else if (s.path == SceneFlow.CorePath || s.path == MenuFlow.MenuScenePath) s.enabled = true;
            }
            return sorted;
        }

        static int IndexOf(IReadOnlyList<string> list, string path)
        {
            for (int i = 0; i < list.Count; i++)
                if (string.Equals(list[i], path, System.StringComparison.OrdinalIgnoreCase)) return i;
            return -1;
        }

        /// <summary>按规则重写构建设置；有改动返回 true</summary>
        public static bool Apply()
        {
            var before = EditorBuildSettings.scenes;
            var sorted = Compute(before);
            bool same = sorted.Count == before.Length && sorted.Select((s, i) => s.path == before[i].path && s.enabled == before[i].enabled).All(x => x);
            if (same) return false;
            EditorBuildSettings.scenes = sorted.ToArray();
            Debug.Log($"[BuildOrder] 构建设置按 RunPlan 重排{(RunPlan.IsDemo ? $"（试玩版，到 {RunPlan.DemoEnd} 为止）" : "")}：" +
                      string.Join(" → ", sorted.Where(s => s.enabled).Select(s => Path.GetFileNameWithoutExtension(s.path))));
            return true;
        }

        /// <summary>一行描述（报告用）：启用的场景按顺序</summary>
        public static string Describe() =>
            string.Join(" → ", EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => Path.GetFileNameWithoutExtension(s.path)));

        [MenuItem(MenuRoot + "按 RunPlan 排序")]
        static void ApplyMenu()
        {
            bool changed = Apply();
            Save();
            Debug.Log(changed ? "[BuildOrder] 已重排" : $"[BuildOrder] 顺序本来就对：{Describe()}");
        }

        // ───────────── 试玩版编译符号 ─────────────

        static NamedBuildTarget Target => NamedBuildTarget.FromBuildTargetGroup(EditorUserBuildSettings.selectedBuildTargetGroup);

        public static bool DemoDefined => PlayerSettings.GetScriptingDefineSymbols(Target).Split(';').Contains(DemoDefine);

        [MenuItem(MenuRoot + "试玩版（到 1-4 为止）", false, 20)]
        static void ToggleDemo()
        {
            var defs = PlayerSettings.GetScriptingDefineSymbols(Target).Split(';').Where(d => !string.IsNullOrWhiteSpace(d)).ToList();
            if (defs.Contains(DemoDefine)) defs.Remove(DemoDefine);
            else defs.Add(DemoDefine);
            PlayerSettings.SetScriptingDefineSymbols(Target, string.Join(";", defs));
            Debug.Log($"[BuildOrder] 编译符号 {DemoDefine} 已{(defs.Contains(DemoDefine) ? "打开：试玩版到 " + RunPlan.DemoDefault + " 为止（重编译后构建设置自动重排）" : "关掉：完整版")}");
        }

        [MenuItem(MenuRoot + "试玩版（到 1-4 为止）", true)]
        static bool ToggleDemoCheck()
        {
            Menu.SetChecked(MenuRoot + "试玩版（到 1-4 为止）", DemoDefined);
            return true;
        }
    }
}
