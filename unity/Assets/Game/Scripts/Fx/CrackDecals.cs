using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第三章砸地的方形裂纹贴花池（第二批收尾 C 路，2026-10-31）：SF_FxCrack + T_Fx_CrackCh3（scripts/unity/fx_crack_ch3.py，2 × 2 个变体），
    /// 材质 Resources/Fx/Materials/M_Fx_CrackCh3。中间压塌的方坑、方折主裂纹、一圈断续的方石板缝；裂光铜橙、亮芯白热、紫褐焦边，
    /// 前 3% 的寿命里从坑心往外蔓延，余热慢慢冷成暗铜缝，最后 20% 淡出。
    /// 熔心魔将的重击落地（<see cref="Fx.WarlordImpact"/>：竖劈入地、跃击落地、插剑、登场落地）和第三章精英的砸地（<see cref="Fx.EliteCh3Impact"/>）用，
    /// 取代以前借的通用裂纹（白色放射纹读成旱魃的日轮）/ 熔铜泼溅。
    /// 做法同 <see cref="SigilDecals"/>：池化的 URP DecalProjector，每个投影器的参数（进度、变体、余热、狂怒）写进 uvScale / uvBias，同一份材质能合批。
    /// 同时存在的个数按画质（<see cref="FxBudget.DecalCap"/> 的 1/10，4–12 块），满了挤掉最老的；渲染器没有贴花特性或材质缺失时什么都不画。换关清场。
    /// </summary>
    public sealed class CrackDecals : MonoBehaviour
    {
        public const string MaterialName = "M_Fx_CrackCh3";
        /// <summary>贴图的变体数（2 × 2）</summary>
        public const int Variants = 4;

        /// <summary>总开关（审阅截图切改前 / 改后用；关掉时 <see cref="Place"/> 什么都不做）</summary>
        public static bool Enabled = true;

        sealed class Slot : FxSlot
        {
            public GameObject go;
            public DecalProjector proj;
            public float age, life, heat, fury;
            public int variant, stamp;
            public Vector4 sent = new(float.NaN, 0, 0, 0);

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

        static CrackDecals instance;
        static Material material;
        static bool materialLooked;
        readonly List<Slot> slots = new();
        int stamp;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            material = null;
            materialLooked = false;
            Enabled = true;
            Placed = 0;
        }

        /// <summary>累计贴过几块（测试用）</summary>
        public static int Placed { get; private set; }

        /// <summary>此刻亮着的块数（测试用）</summary>
        public static int Active
        {
            get
            {
                if (!instance) return 0;
                int n = 0;
                foreach (var s in instance.slots)
                    if (s.active)
                        n++;
                return n;
            }
        }

        /// <summary>同时存在的上限：画质贴花上限的 1/10，夹在 4–12</summary>
        public static int Cap => Mathf.Clamp(FxBudget.DecalCap / 10, 4, 12);

        static Material Mat
        {
            get
            {
                if (materialLooked) return material;
                materialLooked = true;
                var m = Resources.Load<Material>($"{FxMaterials.ResourcesDir}/{MaterialName}");
                material = FxMaterials.Usable(m) ? m : null;
                if (!material) Debug.LogWarning($"[Fx] 没有方形裂纹材质 {FxMaterials.ResourcesDir}/{MaterialName}（或着色器 Spiritfire/FxCrack 不可用），第三章砸地不留裂纹");
                return material;
            }
        }

        /// <summary>能画（渲染器有贴花特性、材质在）</summary>
        public static bool Available => Telegraph.DecalsSupported && Mat;

        static CrackDecals Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<CrackDecals>();
            return instance;
        }

        void Awake() => SceneManager.sceneUnloaded += OnUnloaded;

        void OnDestroy()
        {
            SceneManager.sceneUnloaded -= OnUnloaded;
            if (instance == this) instance = null;
        }

        void OnUnloaded(Scene _) => ClearAll();

        /// <summary>
        /// 在地面点 ground 贴一块方形裂纹：radius = 半径（米，裂纹最远约到 0.9 × radius），life = 秒，heat = 初始余热 0..1（刚砸下去最热），
        /// fury = 狂怒白热 0..1（熔心魔将狂怒后裂光更白）；roll = 绕竖轴的角度（NaN = 随机），variant = 变体（−1 = 随机）
        /// </summary>
        public static FxHandle Place(Vector3 ground, float radius, float life = 6f, float heat = 1f, float fury = 0f, float roll = float.NaN, int variant = -1)
        {
            if (!Enabled || !Fx.Finite(ground) || !(radius > 0) || !(life > 0) || !Available) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            var s = self.Take();
            if (s == null) return FxHandle.None;
            s.Claim();
            s.age = 0;
            s.life = life;
            s.heat = Mathf.Clamp01(heat);
            s.fury = Mathf.Clamp01(fury);
            s.variant = variant >= 0 ? variant % Variants : Random.Range(0, Variants);
            s.sent = new Vector4(float.NaN, 0, 0, 0);
            s.stamp = ++self.stamp;
            var rot = Quaternion.LookRotation(Vector3.down, Vector3.forward) * Quaternion.Euler(0, 0, float.IsNaN(roll) ? Random.value * 360f : roll);
            s.go.transform.SetPositionAndRotation(ground + Vector3.up * 0.05f, rot);
            s.proj.size = new Vector3(radius * 2, radius * 2, 2.2f);
            s.proj.material = Mat;
            Write(s);
            s.go.SetActive(true);
            s.proj.enabled = true;
            Placed++;
            return new FxHandle(s);
        }

        Slot Take()
        {
            Slot oldest = null;
            int live = 0;
            foreach (var s in slots)
            {
                if (!s.active) continue;
                live++;
                if (oldest == null || s.stamp < oldest.stamp) oldest = s;
            }
            // 到上限：挤掉最老的那块
            if (live >= Cap && oldest != null)
            {
                Release(oldest);
                return oldest;
            }
            foreach (var s in slots)
                if (!s.active)
                    return s;
            var go = new GameObject("Crack Ch3");
            go.transform.SetParent(transform, false);
            go.SetActive(false);
            var proj = go.AddComponent<DecalProjector>();
            proj.enabled = false;
            proj.pivot = Vector3.zero;
            proj.scaleMode = DecalScaleMode.ScaleInvariant;
            proj.drawDistance = 160;
            proj.fadeScale = 0.95f;
            proj.startAngleFade = 180;
            proj.endAngleFade = 180;
            var slot = new Slot { go = go, proj = proj };
            slots.Add(slot);
            return slot;
        }

        static void Write(Slot s)
        {
            float t = s.life > 0 ? Mathf.Clamp01(s.age / s.life) : 1;
            var P = new Vector4(t, s.variant, s.heat, s.fury);
            if (float.IsNaN(s.sent.x) || (P - s.sent).sqrMagnitude > 0.0001f)
            {
                s.sent = P;
                s.proj.fadeFactor = 1f;
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
