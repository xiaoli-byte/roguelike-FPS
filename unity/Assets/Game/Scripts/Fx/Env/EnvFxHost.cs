using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 环境特效的常驻根（D 路，「Env Fx」，跨关不销毁）：每帧推进水面涟漪（<see cref="EnvWater"/>），换关时清场。
    /// </summary>
    [DefaultExecutionOrder(70)]
    public sealed class EnvFxHost : MonoBehaviour
    {
        static EnvFxHost instance;
        static bool quitting;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            quitting = false;
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
            Ensure();
        }

        static void OnQuit() => quitting = true;

        void Awake()
        {
            if (instance && instance != this)
            {
                Destroy(gameObject);
                return;
            }
            instance = this;
            SceneManager.sceneUnloaded += OnSceneUnloaded;
        }

        void OnDestroy()
        {
            SceneManager.sceneUnloaded -= OnSceneUnloaded;
            if (instance == this) instance = null;
        }

        void OnSceneUnloaded(Scene _) => EnvWater.Clear();

        void Update() => EnvWater.Tick();
    }

    /// <summary>
    /// 环境特效发粒子的小工具：走 FxRuntime 的共享发射器（同屏统计、每种风格的上限都算进去），数量先过 <see cref="FxBudget"/>。
    /// 常驻氛围用 <see cref="AllowAmbient"/>：战斗特效多的时候先让——同屏粒子过了上限的 45% 就开始减，到 70% 停发。
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

        /// <summary>常驻氛围：先按 <see cref="Headroom"/> 缩（小数部分按概率取整），再过预算闸门</summary>
        public static int AllowAmbient(float n)
        {
            n *= Headroom;
            if (!(n > 0)) return 0;
            int whole = (int)n;
            if (Random.value < n - whole) whole++;
            return whole > 0 ? FxBudget.Allow(whole, false) : 0;
        }

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
