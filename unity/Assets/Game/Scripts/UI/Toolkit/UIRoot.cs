using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// UI Toolkit 的根（docs/unity-parity.md 3.12 / 4.8 / U1）：运行时按 <see cref="UILayer"/> 建四个 UIDocument（每层一个面板），
    /// 挂主题样式表和打包字体，托管全局的提示组件（<see cref="Toasts"/> / <see cref="Banner"/> / <see cref="Curtain"/> / <see cref="Flash"/>），
    /// 每帧推进它们和 <see cref="UIRouter"/>（全部用不缩放时间：暂停中照常淡出）。
    ///   · 第一次用到时（<see cref="Ensure"/>）建，DontDestroyOnLoad：换场景 / R 重开不丢，黑幕能盖住场景切换。
    ///   · 面板设置取 Resources/UI/Panels/&lt;层&gt;（编辑器 UIBuilder 生成）的运行时副本，缩放改成 Three.js 的 computeUiScale（<see cref="UILayers.Scale"/>）；
    ///     资产还没生成时按 <see cref="UILayers.Configure"/> 在内存里建（功能一样）。
    ///   · 只有界面层（Modal）接输入，其余层整层不挡点击。每层根元素：类 sf-layer + sf-layer--&lt;层名小写&gt;，正文字体内联在根上。
    /// 截图：UI Toolkit 叠层直接画在屏幕上，相机渲染到贴图拍不到——冒烟测试截图见 <see cref="UICapture"/>。
    /// </summary>
    [DefaultExecutionOrder(-50)]
    public sealed class UIRoot : MonoBehaviour
    {
        public static UIRoot Instance { get; private set; }
        static bool quitting;

        readonly UIDocument[] docs = new UIDocument[UILayers.Count];
        readonly VisualElement[] layers = new VisualElement[UILayers.Count];
        readonly PanelSettings[] panels = new PanelSettings[UILayers.Count];
        Vector2Int screenSize;
        StyleSheet theme;

        /// <summary>提示队列（左侧，最多 4 条，相同的合并 ×N）</summary>
        public UIToasts Toasts { get; private set; }
        /// <summary>大横幅（区域肃清、关卡名…）</summary>
        public UIBanner Banner { get; private set; }
        /// <summary>黑幕（最上层）</summary>
        public UICurtain Curtain { get; private set; }
        /// <summary>全屏闪光（叠层，HUD 之上、界面之下）</summary>
        public UIFlash Flash { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Instance = null;
            quitting = false;
        }

        /// <summary>取（没有就建）UI 根；编辑模式下、退出中返回 null</summary>
        public static UIRoot Ensure()
        {
            if (Instance) return Instance;
            if (!Application.isPlaying || quitting) return null;
            var go = new GameObject("UI Root");
            DontDestroyOnLoad(go);
            return go.AddComponent<UIRoot>();
        }

        /// <summary>某一层的内容容器（往里加元素）</summary>
        public VisualElement Layer(UILayer layer) => layers[(int)layer];

        /// <summary>某一层的 UIDocument（拿面板 / 焦点控制器用）</summary>
        public UIDocument Document(UILayer layer) => docs[(int)layer];

        /// <summary>面板设置（运行时副本）</summary>
        public PanelSettings Panel(UILayer layer) => panels[(int)layer];

        /// <summary>有看得见的 UI Toolkit 内容（提示、横幅、黑幕、闪光、打开的界面、HUD 层里显示着的元素）：截图要不要走屏幕抓取看这个</summary>
        public bool HasVisibleContent
        {
            get
            {
                if (Toasts.Count > 0 || Banner.Visible || Curtain.Value > 0.001f || Flash.Active || UIRouter.Count > 0) return true;
                foreach (var l in new[] { layers[(int)UILayer.Hud], layers[(int)UILayer.Overlay] })
                    foreach (var child in l.Children())
                        if (child.resolvedStyle.display != DisplayStyle.None && child.resolvedStyle.visibility == Visibility.Visible && child.resolvedStyle.opacity > 0.01f
                            && child != Banner.Root && child != Flash.Root)
                            return true;
                return false;
            }
        }

        void Awake()
        {
            if (Instance && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            theme = Resources.Load<StyleSheet>(UILayers.StylePath);
            if (!theme) Debug.LogWarning($"[UI] 找不到 Resources/{UILayers.StylePath}.uss");
            screenSize = new Vector2Int(Screen.width, Screen.height);
            for (int i = 0; i < UILayers.Count; i++) BuildLayer((UILayer)i);

            Toasts = new UIToasts(layers[(int)UILayer.Toast]);
            Curtain = new UICurtain(layers[(int)UILayer.Toast]);   // 黑幕在 toast 之后加 → 画在 toast 上面
            Banner = new UIBanner(layers[(int)UILayer.Overlay]);
            Flash = new UIFlash(layers[(int)UILayer.Overlay]);
            UIRouter.InstallNavigationFilter(docs[(int)UILayer.Modal].rootVisualElement);
            // 常用字先生成，第一次弹提示不卡
            UIFonts.Warmup("0123456789+-×%/:.,·…！？、。，「」灵石魂晶秘卷武器区域肃清出口已开启");
            SceneManager.sceneLoaded += OnSceneLoaded;
        }

        void BuildLayer(UILayer layer)
        {
            int i = (int)layer;
            string name = UILayers.Name(layer);
            panels[i] = MakePanel(layer);
            var go = new GameObject("UI " + name);
            go.SetActive(false);
            go.transform.SetParent(transform, false);
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = panels[i];
            go.SetActive(true);
            docs[i] = doc;

            var top = doc.rootVisualElement;
            top.pickingMode = PickingMode.Ignore;
            if (theme) top.styleSheets.Add(theme);
            if (UIFonts.Body) top.style.unityFontDefinition = FontDefinition.FromSDFFont(UIFonts.Body);
            var c = new VisualElement { name = "layer-" + name.ToLowerInvariant(), pickingMode = PickingMode.Ignore };
            c.AddToClassList(UITheme.Layer);
            c.AddToClassList(UITheme.Layer + "--" + name.ToLowerInvariant());
            top.Add(c);
            layers[i] = c;
            UISound.Attach(top);
        }

        PanelSettings MakePanel(UILayer layer)
        {
            var asset = Resources.Load<PanelSettings>(UILayers.ResourcePath(layer));
            PanelSettings ps;
            if (asset) ps = Instantiate(asset); // 副本：运行时改缩放不写回资产
            else
            {
                ps = ScriptableObject.CreateInstance<PanelSettings>();
                // 没有 PanelTextSettings 资产时用 UI Toolkit 的默认文本设置，字体靠根元素上内联的正文（自带回退链）
                UILayers.Configure(ps, layer, Resources.Load<ThemeStyleSheet>(UILayers.ThemePath), null);
                if (layer == UILayer.Hud) Debug.Log("[UI] 面板设置资产还没生成（bash scripts/unity/bridge.sh ui），本次在内存里建");
            }
            ps.name = "UI " + UILayers.Name(layer) + " (runtime)";
            ps.hideFlags = HideFlags.DontSave;
            ps.scaleMode = PanelScaleMode.ConstantPixelSize;
            ps.scale = UILayers.Scale(layer, Screen.width, Screen.height);
            return ps;
        }

        void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            // 整个换场景（R 重开 / 旧式换关）：GameStateMachine 已被新场景清空，路由里的界面也一起关掉，免得两边对不上
            if (mode == LoadSceneMode.Single) UIRouter.CloseAll();
        }

        void Update()
        {
            var size = new Vector2Int(Screen.width, Screen.height);
            if (size != screenSize && size.x > 0 && size.y > 0)
            {
                screenSize = size;
                for (int i = 0; i < UILayers.Count; i++)
                    if (panels[i]) panels[i].scale = UILayers.Scale((UILayer)i, size.x, size.y);
            }
            float now = Time.unscaledTime, dt = Time.unscaledDeltaTime;
            Toasts.Tick(now);
            Banner.Tick(now);
            Flash.Tick(now);
            UIRouter.Tick(dt);
        }

        void OnApplicationQuit() => quitting = true;

        void OnDestroy()
        {
            if (Instance != this) return;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            Instance = null;
            foreach (var p in panels)
                if (p) Destroy(p);
        }
    }
}
