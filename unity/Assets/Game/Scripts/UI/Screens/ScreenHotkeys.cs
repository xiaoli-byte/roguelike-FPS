using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局内开界面的热键（U4）：Tab / 手柄 Back 开行囊面板（<see cref="InventoryPanel"/>）。
    /// 只在正常游玩时响应（没有暂停 / 模态 / 换关，玩家活着）；关掉由面板自己处理（Gameplay 表关着时它直接读按键）。
    /// Esc 暂停仍由 GameSession 处理。[GameSystem]：自动挂到 Core 的 Game Systems 上。
    /// </summary>
    [GameSystem(60)]
    public sealed class ScreenHotkeys : MonoBehaviour
    {
        int closedFrame = -1;

        void OnEnable() => UIRouter.Closed += OnClosed;
        void OnDisable() => UIRouter.Closed -= OnClosed;
        // 面板刚被同一个键关掉的那一帧不重新打开
        void OnClosed(IScreen _) => closedFrame = Time.frameCount;

        void Update()
        {
            if (!GameStateMachine.IsPlaying || UIRouter.Blocking || closedFrame == Time.frameCount) return;
            if (SceneFlow.Instance && SceneFlow.Instance.Busy) return;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            if (GameInput.Pressed(GameAction.Inventory)) UIRouter.Open(InventoryPanel.ScreenId);
        }
    }
}
