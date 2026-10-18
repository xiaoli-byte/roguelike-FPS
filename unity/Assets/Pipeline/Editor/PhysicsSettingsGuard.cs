using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 物理设置保护：项目设置里的物理模拟模式必须是 FixedUpdate。
    /// ShowcaseSimulator 离线模拟时会临时切到 Script（手动步进），以前结束时「还原成开始时的值」，一旦有一次中途被打断，
    /// Script 就被存进 ProjectSettings 并一代代传下去——Play 模式里物理从此不跑：布娃娃冻成雕像，
    /// 移动的敌人碰撞体留在原地（射线打的是它出生的位置，看着打中了却不掉血）。编辑器每次加载脚本时检查一次并改回。
    /// </summary>
    [InitializeOnLoad]
    public static class PhysicsSettingsGuard
    {
        static PhysicsSettingsGuard()
        {
            // 用 update 跑一次（delayCall 在编辑器窗口不在前台时可能一直不触发）
            EditorApplication.update += Once;
        }

        static void Once()
        {
            EditorApplication.update -= Once;
            Check();
        }

        const string SettingsPath = "ProjectSettings/DynamicsManager.asset";

        /// <summary>检查并修正（加载时自动调用；也可以手动调用，返回修正前的状态）</summary>
        public static string Check()
        {
            string before = $"内存 {Physics.simulationMode}，设置文件 {(System.IO.File.Exists(SettingsPath) && System.IO.File.ReadAllText(SettingsPath).Contains("m_SimulationMode: 0") ? "FixedUpdate" : "不是 FixedUpdate")}";
            if (EditorApplication.isPlayingOrWillChangePlaymode) return before + "（Play 模式中，跳过）";
            // 内存里的值可能已经被改对（GameSession 运行时会改），但设置文件还是旧的：两边都要对
            bool fileWrong = System.IO.File.Exists(SettingsPath) &&
                             !System.IO.File.ReadAllText(SettingsPath).Contains("m_SimulationMode: 0");
            if (Physics.simulationMode == SimulationMode.FixedUpdate && !fileWrong) return before;
            Debug.LogWarning($"[Physics] 物理模拟模式是 {Physics.simulationMode}（设置文件{(fileWrong ? "不是" : "是")} FixedUpdate），已改回 FixedUpdate 并保存（否则 Play 模式里物理不运行）");
            Physics.simulationMode = SimulationMode.FixedUpdate;
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(SettingsPath)) EditorUtility.SetDirty(o);
            AssetDatabase.SaveAssets();
            return before;
        }
    }
}
