using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 环境特效的常驻根（D 路，「Env Fx」，跨关不销毁）：每帧推进水面涟漪（<see cref="EnvWater"/>），每 0.25 s 给离相机最近的几盏火盆分点光，换关时清场；
    /// 关卡场景加载好之后（两帧后扫一遍、2 s 后再补扫一遍运行时才生成的东西）按场景里已有的东西自动挂环境特效——不用重新生成关卡：
    ///   · 主题（天气导演的 theme；没有就按 LevelMeta 的关卡号）→ 关卡里一个「Env Fx · 氛围」：<see cref="EnvAmbience"/>（各章空气粒子）；
    ///     有熔岩再加 <see cref="EnvLavaFx"/>（冒泡溅火星）+ <see cref="EnvHeatHaze"/>（热浪，按画质）；
    ///   · 火盆 / 火坛 / 香炉 / 冰灯 / 鲸骨灯（ArtAssetInfo.assetId）→ <see cref="EnvFlame"/>；
    ///   · Spiritfire/Water 水面（不含流沙）→ <see cref="EnvWaterBody"/>；流沙 → <see cref="EnvQuicksand"/>；
    ///   · 「冰瀑」→ <see cref="EnvIcefall"/>；「Lava Fall」下的熔瀑带 → <see cref="EnvLavaFall"/>。
    /// <see cref="Enabled"/> 关掉时不再挂新的（已有的照常跑；测试 / 对比用；编辑器里 Library/SpiritfireBridge/envfx_off 存在时整次 Play 都不挂）。
    /// </summary>
    [DefaultExecutionOrder(70)]
    public sealed class EnvFxHost : MonoBehaviour
    {
        public const string AmbienceName = "Env Fx · 氛围";
        public const string IcefallName = "冰瀑", LavaFallName = "Lava Fall";

        static EnvFxHost instance;
        static bool quitting;

        /// <summary>进关时自动挂环境特效（默认开）</summary>
        public static bool Enabled = true;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            quitting = false;
            Enabled = true;
        }

        /// <summary>取（必要时创建）常驻根；编辑器非 Play、正在退出时返回 null</summary>
        public static EnvFxHost Ensure()
        {
            if (instance) return instance;
            if (quitting || !Application.isPlaying) return null;
            var go = new GameObject("Env Fx");
            DontDestroyOnLoad(go);
            instance = go.AddComponent<EnvFxHost>();
            return instance;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            Application.quitting -= OnQuit;
            Application.quitting += OnQuit;
#if UNITY_EDITOR
            // 性能对照：unity/Library/SpiritfireBridge/envfx_off 存在时这次 Play 不挂环境特效（只在编辑器里认）
            if (System.IO.File.Exists(System.IO.Path.Combine(Application.dataPath, "..", "Library", "SpiritfireBridge", "envfx_off"))) Enabled = false;
#endif
            var h = Ensure();
            // 直接打开关卡场景：开场时关卡已经在了
            if (h)
                for (int i = 0; i < SceneManager.sceneCount; i++)
                    h.Schedule(SceneManager.GetSceneAt(i));
        }

        static void OnQuit() => quitting = true;

        float nextLights;

        /// <summary>最近一次扫描挂上的东西（测试 / 冒烟读）</summary>
        public static string LastScan { get; private set; } = "";

        void Awake()
        {
            if (instance && instance != this)
            {
                Destroy(gameObject);
                return;
            }
            instance = this;
            SceneManager.sceneUnloaded += OnSceneUnloaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
        }

        void OnDestroy()
        {
            SceneManager.sceneUnloaded -= OnSceneUnloaded;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            if (instance == this) instance = null;
        }

        void OnSceneUnloaded(Scene _) => EnvWater.Clear();

        void OnSceneLoaded(Scene s, LoadSceneMode _) => Schedule(s);

        void Schedule(Scene s)
        {
            if (s.IsValid() && isActiveAndEnabled) StartCoroutine(ScanLater(s));
        }

        IEnumerator ScanLater(Scene s)
        {
            yield return null;
            yield return null;
            if (s.IsValid() && s.isLoaded) Scan(s);
            yield return new WaitForSeconds(2f);
            if (s.IsValid() && s.isLoaded) Scan(s);
        }

        void Update()
        {
            EnvWater.Tick();
            if (Time.unscaledTime >= nextLights)
            {
                nextLights = Time.unscaledTime + 0.25f;
                var cam = Camera.main;
                if (cam) EnvFlame.AssignLights(cam.transform.position);
            }
        }

        // ───────────── 扫场景 ─────────────

        /// <summary>这个场景的主题：天气导演的 theme，没有就按 LevelMeta 的关卡号（1- 沙漠 / 2- 冰原 / 3- 火狱）</summary>
        public static EnvTheme ThemeOf(Scene s)
        {
            foreach (var root in s.GetRootGameObjects())
            {
                var wd = root.GetComponentInChildren<WeatherDirector>(true);
                if (wd) return Parse(wd.theme);
            }
            foreach (var root in s.GetRootGameObjects())
            {
                var meta = root.GetComponentInChildren<LevelMeta>(true);
                if (!meta || string.IsNullOrEmpty(meta.levelId)) continue;
                if (meta.levelId.StartsWith("1-")) return EnvTheme.Desert;
                if (meta.levelId.StartsWith("2-")) return EnvTheme.Frost;
                if (meta.levelId.StartsWith("3-")) return EnvTheme.Inferno;
            }
            return EnvTheme.None;
        }

        static EnvTheme Parse(string theme) => theme switch
        {
            "Frost" => EnvTheme.Frost,
            "Inferno" => EnvTheme.Inferno,
            "Desert" => EnvTheme.Desert,
            _ => EnvTheme.None,
        };

        /// <summary>拆掉一个场景里自动挂上的环境特效（测试拍「改前」对照、调试用；拆完要再挂就 <see cref="Scan"/>）</summary>
        public static void Strip(Scene s)
        {
            if (!s.IsValid() || !s.isLoaded) return;
            foreach (var root in s.GetRootGameObjects())
            {
                if (root.name == AmbienceName)
                {
                    Destroy(root);
                    continue;
                }
                foreach (var c in root.GetComponentsInChildren<EnvFlame>(true)) Destroy(c);
                foreach (var c in root.GetComponentsInChildren<EnvWaterBody>(true)) Destroy(c);
                foreach (var c in root.GetComponentsInChildren<EnvQuicksand>(true)) Destroy(c);
                foreach (var c in root.GetComponentsInChildren<EnvIcefall>(true)) Destroy(c);
                foreach (var c in root.GetComponentsInChildren<EnvLavaFall>(true)) Destroy(c);
            }
            EnvWater.Clear();
        }

        static readonly List<Renderer> rbuf = new();

        /// <summary>扫一个场景，给认得的东西挂环境特效（重复扫只补新的）</summary>
        public static void Scan(Scene s)
        {
            if (!Enabled || !s.IsValid() || !s.isLoaded || s.name == SceneFlow.CoreName) return;
            var theme = ThemeOf(s);
            int flames = 0, waters = 0, sands = 0, falls = 0;
            bool lava = false;
            foreach (var root in s.GetRootGameObjects())
            {
                foreach (var a in root.GetComponentsInChildren<ArtAssetInfo>())
                    if (EnvFlame.KindOf(a.assetId, out var kind) && EnvFlame.Attach(a, kind))
                        flames++;
                foreach (var q in root.GetComponentsInChildren<Quicksand>())
                    if (EnvQuicksand.Attach(q))
                        sands++;
                if (root.GetComponentInChildren<LavaVolume>()) lava = true;
                rbuf.Clear();
                root.GetComponentsInChildren(rbuf);
                foreach (var r in rbuf)
                {
                    var m = r ? r.sharedMaterial : null;
                    if (!m || !m.shader) continue;
                    if (m.shader.name == "Spiritfire/Water")
                    {
                        if (m.HasProperty("_Swirl") && m.GetFloat("_Swirl") > 0.01f) continue;
                        if (EnvWaterBody.Attach(r, theme)) waters++;
                    }
                }
                foreach (var t in root.GetComponentsInChildren<Transform>())
                {
                    if (t.name == IcefallName)
                    {
                        if (EnvIcefall.Attach(t.gameObject)) falls++;
                    }
                    else if (t.name == LavaFallName)
                    {
                        foreach (var r in t.GetComponentsInChildren<Renderer>())
                            if (EnvLavaFall.Attach(r))
                                falls++;
                    }
                }
            }
            lava |= LavaField.Any;
            if (theme != EnvTheme.None || lava)
            {
                GameObject host = null;
                foreach (var root in s.GetRootGameObjects())
                    if (root.name == AmbienceName)
                        host = root;
                if (!host)
                {
                    host = new GameObject(AmbienceName);
                    SceneManager.MoveGameObjectToScene(host, s);
                }
                if (theme != EnvTheme.None)
                {
                    var amb = host.GetComponent<EnvAmbience>();
                    if (!amb) amb = host.AddComponent<EnvAmbience>();
                    amb.theme = theme;
                }
                if (lava)
                {
                    if (!host.GetComponent<EnvLavaFx>()) host.AddComponent<EnvLavaFx>();
                    if (!host.GetComponent<EnvHeatHaze>()) host.AddComponent<EnvHeatHaze>();
                }
            }
            LastScan = $"{s.name}：主题 {theme}，火 {flames}，水面 {waters}，流沙 {sands}，瀑布 {falls}，熔岩 {(lava ? "有" : "无")}";
        }
    }

    /// <summary>
    /// 环境特效发粒子的小工具：走 FxRuntime 的共享发射器（同屏统计、每种风格的上限都算进去），数量先过 <see cref="FxBudget"/>。
    /// 常驻氛围再乘 <see cref="Headroom"/>：战斗特效多的时候先让——同屏粒子过了上限的 45% 就开始减，到 70% 停发。
    /// </summary>
    internal static class EnvParticles
    {
        /// <summary>常驻氛围还能用多少（0..1）：同屏粒子在上限 45% 以下全给，70% 时为 0</summary>
        public static float Headroom
        {
            get
            {
                int cap = Mathf.Max(1, FxBudget.ParticleCap);
                return Mathf.Clamp01((cap * 0.7f - FxBudget.Live) / (cap * 0.25f));
            }
        }

        /// <summary>一次性的环境特效（水花、溅起的火星）：直接过预算闸门</summary>
        public static int Allow(int n) => FxBudget.Allow(n, false);

        /// <summary>从某个粒子风格（G/Fx/Presets 的 FxStylePreset id）发一颗；size 是直径（米）</summary>
        public static bool Emit(string style, Vector3 pos, Vector3 vel, float size, float life, Color color)
        {
            if (!Fx.Finite(pos) || !Fx.Finite(vel)) return false;
            var rt = FxRuntime.Ensure();
            if (!rt) return false;
            var e = rt.GetEmitter(style);
            if (e == null) return false;
            rt.EmitOne(e, pos, vel, size, life, color, 0);
            return true;
        }
    }
}
