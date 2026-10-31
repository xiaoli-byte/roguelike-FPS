using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>SF_FxSigil 的模式</summary>
    public enum SigilMode
    {
        /// <summary>沙印（第一章出生法阵）</summary>
        Sand = 0,
        /// <summary>冰晶（第二章出生法阵）</summary>
        Frost = 1,
        /// <summary>火卦（第三章出生法阵）</summary>
        Fire = 2,
        /// <summary>熔铜泼溅（白热 → 橙 → 暗壳 + 发光裂缝）</summary>
        Molten = 3,
        /// <summary>湿痕（出水后脚下的深色湿沙，慢慢干掉）</summary>
        Wet = 4,
        /// <summary>雷纹（第四章出生法阵：紫红外环 + 折线雷纹 + 四枚雷齿 + 粉白雷心，靛紫暗底）</summary>
        Thunder = 5,
    }

    /// <summary>
    /// 首领 / 章节贴花池（特效打磨 C 路，SF_FxSigil）：池化的 URP DecalProjector + 一份共享材质（开 GPU Instancing），
    /// 每个投影器的参数（进度、模式、种子、附加）写进 DecalProjector 的 uvScale / uvBias（同 <see cref="FxDecals"/> 的做法），变化超过阈值才写。
    /// 渲染器没有贴花特性、或材质缺失时什么都不画（纯装饰）。换关清场；句柄 Cancel = 0.15 s 收掉。
    /// </summary>
    public sealed class SigilDecals : MonoBehaviour
    {
        const int Max = 32;

        internal sealed class Slot : FxSlot
        {
            public GameObject go;
            public DecalProjector proj;
            public SigilMode mode;
            public float age, life, seed, extra;
            public Vector4 sent = new(float.NaN, 0, 0, 0);
            public float sentFade = -1;
            public int stamp;

            public override void CancelFx()
            {
                if (!active) return;
                life = Mathf.Min(life, age + 0.15f);
            }

            public override void MoveFx(Vector3 position)
            {
                if (go) go.transform.position = position;
            }
        }

        static SigilDecals instance;
        readonly List<Slot> slots = new();
        int stamp;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => instance = null;

        static SigilDecals Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<SigilDecals>();
            return instance;
        }

        void Awake() => SceneManager.sceneUnloaded += OnUnloaded;

        void OnDestroy()
        {
            SceneManager.sceneUnloaded -= OnUnloaded;
            if (instance == this) instance = null;
        }

        void OnUnloaded(Scene _) => ClearAll();

        /// <summary>此刻亮着的某种贴花数（测试用）</summary>
        public static int ActiveOf(SigilMode mode)
        {
            if (!instance) return 0;
            int n = 0;
            foreach (var s in instance.slots)
                if (s.active && s.mode == mode)
                    n++;
            return n;
        }

        /// <summary>能画（渲染器有贴花特性、材质在、着色器能用）</summary>
        public static bool Available
        {
            get
            {
                if (!Telegraph.DecalsSupported) return false;
                var m = FxMaterials.Get(FxMaterialKind.Sigil);
                return FxMaterials.Usable(m) && m.shader.name == FxMaterials.ShaderSigil;
            }
        }

        /// <summary>
        /// 在 center 处贴一块（半径 radius 米、life 秒）：mode 选样式；extra = 法阵的精英金边（1）/ 熔铜的初始余热（0..1）。
        /// 法阵：缓出放大 → 停留 → 80% 处闪一下 → 最后 14% 淡出；熔铜：泼开 → 冷却 → 最后 20% 淡出；湿痕：铺开 → 慢慢干掉
        /// </summary>
        public static FxHandle Place(SigilMode mode, Vector3 center, float radius, float life, float extra = 0, float roll = float.NaN)
        {
            if (!Fx.Finite(center) || !(radius > 0) || !(life > 0) || !Available) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            var s = self.Take();
            if (s == null) return FxHandle.None;
            s.Claim();
            s.mode = mode;
            s.age = 0;
            s.life = life;
            s.seed = Random.value * 10f;
            s.extra = extra;
            s.sent = new Vector4(float.NaN, 0, 0, 0);
            s.sentFade = -1;
            s.stamp = ++self.stamp;
            float depth = mode is SigilMode.Molten or SigilMode.Wet ? 2.4f : 1.8f;
            var rot = Quaternion.LookRotation(Vector3.down, Vector3.forward) * Quaternion.Euler(0, 0, float.IsNaN(roll) ? Random.value * 360f : roll);
            s.go.transform.SetPositionAndRotation(center, rot);
            s.proj.size = new Vector3(radius * 2, radius * 2, depth);
            s.proj.material = FxMaterials.Get(FxMaterialKind.Sigil);
            Write(s);
            s.go.SetActive(true);
            s.proj.enabled = true;
            return new FxHandle(s);
        }

        Slot Take()
        {
            Slot oldest = null;
            foreach (var s in slots)
            {
                if (!s.active) return s;
                if (oldest == null || s.stamp < oldest.stamp) oldest = s;
            }
            if (slots.Count < Max)
            {
                var go = new GameObject("Sigil");
                go.transform.SetParent(transform, false);
                go.SetActive(false);
                var proj = go.AddComponent<DecalProjector>();
                proj.enabled = false;
                proj.pivot = Vector3.zero;
                proj.scaleMode = DecalScaleMode.ScaleInvariant;
                proj.drawDistance = 200;
                proj.fadeScale = 0.95f;
                proj.startAngleFade = 180;
                proj.endAngleFade = 180;
                var s = new Slot { go = go, proj = proj };
                slots.Add(s);
                return s;
            }
            // 满了：挤掉最老的
            if (oldest != null) Release(oldest);
            return oldest;
        }

        static void Write(Slot s)
        {
            float t = s.life > 0 ? Mathf.Clamp01(s.age / s.life) : 1;
            var P = new Vector4(t, (int)s.mode, s.seed, s.extra);
            const float fade = 1f;
            if (Mathf.Abs(fade - s.sentFade) > 0.02f)
            {
                s.sentFade = fade;
                s.proj.fadeFactor = fade;
            }
            if (float.IsNaN(s.sent.x) || (P - s.sent).sqrMagnitude > 0.0001f)
            {
                s.sent = P;
                s.proj.uvScale = new Vector2(P.x, P.y);
                s.proj.uvBias = new Vector2(P.z, P.w);
            }
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var s in slots)
            {
                if (!s.active) continue;
                s.age += dt;
                if (s.age >= s.life || !s.proj)
                {
                    Release(s);
                    continue;
                }
                Write(s);
            }
        }

        static void Release(Slot s)
        {
            s.active = false;
            if (s.proj) s.proj.enabled = false;
            if (s.go) s.go.SetActive(false);
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            if (!instance) return;
            foreach (var s in instance.slots)
                if (s.active)
                    Release(s);
        }
    }
}
