using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 闪光点光源池（3.13「光源池：全局只有 1 盏 → 6–8 盏」）：爆炸、枪口、雷击、技能落点的瞬间照亮。
    /// Three.js 版为避免材质重编译只能常驻 2 盏；Unity 的 Forward+ 没有这个包袱，空闲的灯直接关掉（不参与光照）。
    /// 同时亮着的上限按画质：低 3、中 6、高 8；满了挤掉当前最暗的那盏。亮度曲线同 Three.js：起亮极快（8% 寿命），之后二次衰减。
    /// 灯挂在 Fx 根物体下（常驻、换关清空），全部池化，运行时零分配。
    /// </summary>
    public sealed class FxLightPool : MonoBehaviour
    {
        public const int MaxLights = 8;

        sealed class Slot : FxSlot
        {
            public Light light;
            public float age, life, peak, fade = -1, fadeFrom;
            public Transform follow;
            public Vector3 followOffset;

            public override void CancelFx()
            {
                if (!active || fade >= 0) return;
                fade = 0;
                fadeFrom = light ? light.intensity : 0;
            }

            public override void MoveFx(Vector3 position)
            {
                if (light) light.transform.position = position;
            }
        }

        static FxLightPool instance;
        readonly Slot[] slots = new Slot[MaxLights];
        int count;

        /// <summary>当前画质下同时亮着的上限</summary>
        public static int Capacity => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 3,
            ArtQualityLevel.Medium => 6,
            _ => MaxLights,
        };

        internal static FxLightPool Instance => instance;

        void Awake()
        {
            instance = this;
            ArtQuality.Changed += OnQuality;
        }

        void OnDestroy()
        {
            ArtQuality.Changed -= OnQuality;
            if (instance == this) instance = null;
        }

        void OnQuality(ArtQualityLevel _)
        {
            // 降档时把超出上限的灯立刻熄掉
            int cap = Capacity;
            for (int i = cap; i < count; i++) Release(slots[i]);
        }

        /// <summary>
        /// 闪一下：peak = 峰值强度（URP 灯光强度），range = 照明半径（米），life = 总时长（秒）。
        /// follow 非空时每帧跟着它走（枪口、技能手部）。
        /// </summary>
        public static FxHandle Flash(Vector3 position, Color color, float peak, float range, float life, Transform follow = null)
        {
            if (!(peak > 0) || !(range > 0) || !(life > 0) || !Fx.Finite(position)) return FxHandle.None;
            var pool = FxRuntime.Ensure()?.Lights;
            return pool ? pool.Take(position, color, peak, range, life, follow) : FxHandle.None;
        }

        FxHandle Take(Vector3 position, Color color, float peak, float range, float life, Transform follow)
        {
            int cap = Mathf.Min(Capacity, MaxLights);
            if (cap <= 0) return FxHandle.None;
            Slot s = null;
            // 空闲的优先；没有就挤掉当前最暗的（快灭的那盏）
            for (int i = 0; i < Mathf.Min(count, cap); i++)
                if (!slots[i].active)
                {
                    s = slots[i];
                    break;
                }
            if (s == null && count < cap)
            {
                s = Create(count);
                slots[count] = s;
                count++;
            }
            if (s == null)
            {
                float dim = float.MaxValue;
                for (int i = 0; i < cap; i++)
                {
                    float v = slots[i].light ? slots[i].light.intensity : 0;
                    if (v < dim)
                    {
                        dim = v;
                        s = slots[i];
                    }
                }
            }
            if (s == null || !s.light) return FxHandle.None;
            s.Claim();
            s.age = 0;
            s.life = life;
            s.peak = peak;
            s.fade = -1;
            s.follow = follow;
            s.followOffset = follow ? position - follow.position : Vector3.zero;
            var l = s.light;
            l.transform.position = position;
            l.color = new Color(color.r, color.g, color.b, 1);
            l.range = range;
            l.intensity = peak * 0.15f;
            l.enabled = true;
            return new FxHandle(s);
        }

        Slot Create(int index)
        {
            var go = new GameObject($"Fx Light {index}");
            go.transform.SetParent(transform, false);
            var l = go.AddComponent<Light>();
            l.type = LightType.Point;
            l.shadows = LightShadows.None;
            l.renderMode = LightRenderMode.ForcePixel;
            l.enabled = false;
            l.intensity = 0;
            return new Slot { light = l };
        }

        void Release(Slot s)
        {
            if (s == null) return;
            s.active = false;
            s.follow = null;
            if (s.light)
            {
                s.light.intensity = 0;
                s.light.enabled = false;
            }
        }

        /// <summary>全部熄灭（换关清场）</summary>
        internal void Clear()
        {
            for (int i = 0; i < count; i++) Release(slots[i]);
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            for (int i = 0; i < count; i++)
            {
                var s = slots[i];
                if (!s.active) continue;
                var l = s.light;
                if (!l)
                {
                    s.active = false;
                    continue;
                }
                if (s.follow) l.transform.position = s.follow.position + s.followOffset;
                if (s.fade >= 0)
                {
                    s.fade += dt;
                    float o = s.fade / 0.1f;
                    if (o >= 1) Release(s);
                    else l.intensity = s.fadeFrom * (1 - o) * (1 - o);
                    continue;
                }
                s.age += dt;
                float t = s.age / s.life;
                if (t >= 1)
                {
                    Release(s);
                    continue;
                }
                // 起亮极快、二次衰减（Three.js Flash.ts）
                float k = t < 0.08f ? t / 0.08f : (1 - t) * (1 - t) / (0.92f * 0.92f);
                l.intensity = s.peak * Mathf.Min(1, k);
            }
        }
    }
}
