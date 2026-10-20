using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灵宠面板的挂点（docs/pet-system.md 第 5 节）：<see cref="PetBootstrap"/> 把它挂到 HUD 物体上，表示这一局开了灵宠系统。
    /// U2 起面板本体是 UI Toolkit 的 <see cref="PetPanelWidget"/>（左下、生命框上方）：没有挂点或没有灵宠时不显示。
    /// 全屏闪光（神兽现世、白泽图、杀蚩尤）转发到 <see cref="GameUI.ScreenFlash"/>。
    /// </summary>
    public sealed class PetHud : MonoBehaviour
    {
        public static PetHud Instance { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        void Awake() => Instance = this;

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>全屏闪光（颜色带透明度），seconds 秒淡出</summary>
        public void Flash(Color c, float seconds) => GameUI.ScreenFlash(c, seconds);
    }
}
