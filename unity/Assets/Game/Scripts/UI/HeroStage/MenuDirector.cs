using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 主菜单场景的总控（U5；场景由 P/Editor/Levels/MenuSceneBuilder 生成：章节展示场景的沙漠城门广场做远景，去掉展示用的角色排和机位，
    /// 加上这个物体、<see cref="MenuCamera"/>、祭台 <see cref="HeroStage"/>）：
    ///   进场：清掉上一局残留的时间请求 / 模态栈，状态切到 Menu，放开鼠标，配乐 menu，祭台上站好上次出征的英雄，打开 <see cref="MainMenuScreen"/>，黑幕淡出；
    ///   常驻：保持鼠标可见（一局里锁过鼠标）；<see cref="Home"/> = 镜头回远景、祭台换回上次的英雄（主菜单本体重新露出来时调）。
    /// 主菜单场景里没有局（<see cref="RunState.Current"/> 为 null）：魂晶 / 天赋 / 生涯读正式档（调试档开关开着时读调试档）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MenuDirector : MonoBehaviour
    {
        public static MenuDirector Instance { get; private set; }

        public MenuCamera menuCamera;
        public HeroStage stage;
        [Tooltip("进场时黑幕淡出的秒数")] public float fadeIn = 0.8f;

        /// <summary>主菜单已经打开（测试用）</summary>
        public bool Ready { get; private set; }

        void Awake()
        {
            Instance = this;
            TimeScaleArbiter.Clear();
            GameStateMachine.Clear();
            GameStateMachine.SetBase(GameState.Menu);
            RunState.Current = null;
            if (!menuCamera) menuCamera = FindAnyObjectByType<MenuCamera>();
            if (!menuCamera && Camera.main) menuCamera = Camera.main.gameObject.AddComponent<MenuCamera>();
            if (!stage) stage = FindAnyObjectByType<HeroStage>();
        }

        void Start()
        {
            UnlockCursor();
            GameAudio.SetMusic("menu");
            if (stage && menuCamera)
            {
                menuCamera.heroesAnchor = stage.CameraAnchor;
                menuCamera.heroesFov = stage.fov;
            }
            UIRouter.CloseAll();
            UIRouter.Open(MainMenuScreen.ScreenId);
            Home();
            _ = GameUI.Fade(0, fadeIn);
            Ready = true;
        }

        void Update() => UnlockCursor();

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        static void UnlockCursor()
        {
            if (Cursor.lockState != CursorLockMode.None) Cursor.lockState = CursorLockMode.None;
            if (!Cursor.visible) Cursor.visible = true;
        }

        /// <summary>主菜单本体重新露出来：镜头回远景，祭台上换回上次出征的英雄（不闪光）</summary>
        public void Home()
        {
            if (menuCamera) menuCamera.Go(MenuCamera.Pose.Home);
            if (stage) stage.Show(MenuFlow.LastHero, false);
        }

        /// <summary>进选英雄：镜头推到祭台</summary>
        public void Heroes()
        {
            if (menuCamera) menuCamera.Go(MenuCamera.Pose.Heroes);
        }
    }
}
