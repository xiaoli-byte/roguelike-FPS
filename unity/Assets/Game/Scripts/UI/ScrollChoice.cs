using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷三选一的旧入口（S7 起转发到 UI Toolkit 的 <see cref="ScrollChoiceScreen"/>，id「scroll-choice」）：
    /// LootDirector 调 <see cref="Show"/>，冒烟测试用 <see cref="Open"/> / <see cref="Pick"/>，调用方都不用改。
    /// 停时间、放开鼠标、关玩家输入都由路由压的模态状态负责（GameSession 跟着 GameStateMachine 走）。
    /// </summary>
    public static class ScrollChoice
    {
        /// <summary>三选一开着（等玩家选）</summary>
        public static bool Open => UIRouter.IsOpen(ScrollChoiceScreen.ScreenId);

        /// <summary>弹出三选一：choices 最多 3 张，inv = 本局持有（卡面的层数），onPick 在选中时同步调用</summary>
        public static void Show(List<ScrollDef> choices, ScrollInventory inv, Action<ScrollDef> onPick)
        {
            if (Open || choices == null || choices.Count == 0) return;
            UIRouter.Open(ScrollChoiceScreen.ScreenId, new ScrollChoiceArgs { choices = new List<ScrollDef>(choices), inventory = inv, onPick = onPick });
        }

        /// <summary>测试用：直接选第 index 张（同点击，但不受刚弹出时的误触保护限制）</summary>
        public static void Pick(int index)
        {
            if (UIRouter.Find(ScrollChoiceScreen.ScreenId) is ScrollChoiceScreen s) s.Choose(index, true);
        }

        /// <summary>当前的选项（没开着为 null；测试用）</summary>
        public static IReadOnlyList<ScrollDef> Choices => (UIRouter.Find(ScrollChoiceScreen.ScreenId) as ScrollChoiceScreen)?.Choices;
    }
}
