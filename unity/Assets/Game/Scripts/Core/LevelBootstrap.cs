using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡场景的自举标记（docs/unity-parity.md 4.6，L1）：关卡场景只放环境和标记，玩家、HUD、各系统在常驻的 Core 场景里。
    /// 正常流程里关卡由 <see cref="SceneFlow"/> 叠加加载，这里什么都不做；在编辑器里直接打开关卡场景按 Play（或冒烟测试直接开 L1_1）时，
    /// Awake 把 Core 叠加加载进来（构建设置里没有 Core 时编辑器按路径加载，连 Core.unity 都没生成时运行时临时搭一个），
    /// Core 的 SceneFlow 认领这个已经在场的关卡：开一个调试局（<see cref="RunState.Ensure"/>），在 <see cref="PlayerSpawn"/> 组装玩家。
    /// 由关卡构建器摆放（Level_x_y），一个关卡场景一个。
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    [DisallowMultipleComponent]
    public sealed class LevelBootstrap : MonoBehaviour
    {
        [Tooltip("RunPlan 里查不到本场景时的关卡标题（测试关卡）")]
        public string stageTitle;
        [Tooltip("直接打开本场景时调试局用的英雄 id（空 = SceneFlow 的默认英雄）")]
        public string heroId;

        void Awake() => SceneFlow.EnsureCore();

        /// <summary>场景里的自举标记；没有则 null</summary>
        public static LevelBootstrap In(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            foreach (var root in scene.GetRootGameObjects())
            {
                var b = root.GetComponentInChildren<LevelBootstrap>(true);
                if (b) return b;
            }
            return null;
        }
    }
}
