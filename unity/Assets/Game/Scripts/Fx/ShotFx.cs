using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 射击特效的兼容层（F1 之前的入口，几十处调用照旧可用）：全部转发到 <see cref="Fx"/>，自己不再持有粒子 / 灯。
    ///   Impact(flesh = false) → Fx.Impact（反射火花 + 闪光 + 尘土 + 碎屑）；size &gt; 4 的大冲击再加一团尘土爆发；
    ///   Impact(flesh = true)  → Fx.EnemyHit（打中敌人 / 火焰类的橙色溅射）；size &gt; 2.5 的再加一团下坠的火花爆发；
    ///   MuzzleFlash → 池化闪光灯（开枪那一次另出第一人称火焰，见 <see cref="MuzzleFlashes"/>）；Tracer → 池化曳光。
    /// <see cref="Instance"/> 在 Play 中永远可用：场景里放了（PlayerRigBuilder 挂在 Game Systems 上）就用场景里的，
    /// 没放就挂到常驻的 Fx 根物体上。新代码直接用 <see cref="Fx"/>。
    /// </summary>
    public sealed class ShotFx : MonoBehaviour
    {
        /// <summary>旧版「Hit Sparks」的暖黄</summary>
        public static readonly Color SparkColor = new(1f, 0.82f, 0.45f);
        /// <summary>旧版「Hit Flesh」的橙红（打中敌人、火焰）</summary>
        public static readonly Color FleshColor = new(1f, 0.55f, 0.32f);
        /// <summary>旧版「Hit Dust」的沙土色（走烟尘粒子）</summary>
        public static readonly Color DustColor = new(0.78f, 0.64f, 0.48f);
        /// <summary>枪口闪光灯色</summary>
        public static readonly Color FlashColor = new(1f, 0.75f, 0.4f);

        static ShotFx instance;

        /// <summary>Play 中永远非空（编辑器非 Play / 退出中为 null，调用方的 ?. 照常跳过）</summary>
        public static ShotFx Instance
        {
            get
            {
                if (instance) return instance;
                var rt = FxRuntime.Ensure();
                if (!rt) return null;
                if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<ShotFx>();
                return instance;
            }
        }

        void Awake()
        {
            if (!instance) instance = this;
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        /// <summary>命中点特效：flesh = 打中敌人（或火焰类的橙色溅射），否则打在地形 / 建筑上；size 是规模（旧版按它放大粒子数）</summary>
        public FxHandle Impact(Vector3 point, Vector3 normal, bool flesh, float size = 1f)
        {
            if (!Fx.Finite(size) || size <= 0) size = 1;
            if (flesh)
            {
                var h = Fx.EnemyHit(point, FleshColor, false, Mathf.Clamp(size, 0.4f, 2.5f));
                if (size > 2.5f)
                    Fx.Burst(point, FleshColor, Mathf.RoundToInt(4 * size), 3 + 0.6f * size, 0.55f, 0.1f * Mathf.Sqrt(size), 4);
                return h;
            }
            var hit = Fx.Impact(point, normal, SparkColor, Mathf.Clamp(size, 0.2f, 4f));
            if (size > 4f)
                Fx.Burst(point, DustColor, Mathf.RoundToInt(3 * size), 2 + 0.4f * size, 0.8f, 0.12f * Mathf.Sqrt(size), 1);
            return hit;
        }

        /// <summary>
        /// 枪口 / 落点闪光灯：strength 1 ≈ 强度 6、半径 6 m。
        /// at 正好是 WeaponController 的常数枪口位置时（就是开枪）改走 <see cref="Fx.MuzzleFlash"/>：第一人称火焰 + 灯，
        /// 颜色按当前武器元素，和挂点回调同一帧到时合成一次（W3/W4 落地前，现有的开枪调用也有火焰）。其余调用（爆炸、技能落点）照旧只闪灯。
        /// </summary>
        public FxHandle MuzzleFlash(Vector3 at, float strength)
        {
            if (!(strength > 0)) return FxHandle.None;
            if (MuzzleFlashes.IsMuzzlePoint(at))
            {
                var cam = Camera.main;
                MuzzleFlashes.Request(null, at, cam ? cam.transform.forward : Vector3.forward, FlashColor, strength, false);
                return FxHandle.None;
            }
            return FxLightPool.Flash(at, FlashColor, Mathf.Min(30f, 6f * strength), 6f * Mathf.Clamp(Mathf.Sqrt(strength), 1f, 2.5f), 0.07f);
        }

        /// <summary>弹道曳光（width = 弹头宽度，米）</summary>
        public FxHandle Tracer(Vector3 from, Vector3 to, Color color, float width) => Fx.Tracer(from, to, color, width);
    }
}
