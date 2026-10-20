using System;
using Spiritfire.Art;

namespace Spiritfire.Game
{
    /// <summary>
    /// 暂停菜单的旧入口（U4 起转发到 UI Toolkit 的 <see cref="PauseScreen"/>，id「pause」；设置在 <see cref="SettingsScreen"/>）：
    /// GameSession 调 <see cref="Show"/> / <see cref="Hide"/>，冒烟测试用 <see cref="Open"/> / <see cref="Pick"/>，调用方都不用改。
    /// </summary>
    public static class PauseMenu
    {
        static bool hiding;

        /// <summary>暂停菜单开着（含叠在上面的设置页）</summary>
        public static bool Open => UIRouter.IsOpen(PauseScreen.ScreenId);

        /// <summary>弹出暂停菜单；onResume 在玩家「继续游戏」（按钮 / Esc / 手柄 B / Start）关掉菜单时调用</summary>
        public static void Show(Action onResume)
        {
            if (Open) return;
            UIRouter.Open(PauseScreen.ScreenId, onResume);
        }

        /// <summary>收起暂停菜单和叠在上面的设置页（不调 onResume：调用方自己在恢复游戏）</summary>
        public static void Hide()
        {
            if (hiding) return;
            hiding = true;
            try
            {
                if (UIRouter.IsOpen(SettingsScreen.ScreenId) && Open) UIRouter.Close(SettingsScreen.ScreenId);
                UIRouter.Close(PauseScreen.ScreenId);
            }
            finally
            {
                hiding = false;
            }
        }

        /// <summary>正在 <see cref="Hide"/>（PauseScreen 关上时据此不回调 onResume）</summary>
        internal static bool Hiding => hiding;

        /// <summary>测试用：选画质，和设置页里点「画质」分段按钮走同一条路径（<see cref="GameSettings.Quality"/>）</summary>
        public static void Pick(ArtQualityLevel level)
        {
            if (!Open) return;
            GameSettings.Set(GameSettings.Quality, (float)level);
        }
    }
}
