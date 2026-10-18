using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人 / 环境引起的震屏（Three.js 版 fx.shake + 各敌人的 quake）：强度同 Three.js 的数值（0–1，1 ≈ 视角抖 ±3°），
    /// 同时有多个时取最强的那个，随剩余时间衰减；由 WeaponController 在视角写完之后叠到相机上（和开枪的后坐抖动合并）。
    /// </summary>
    public static class CameraShake
    {
        const float Max = 1.2f, MaxTime = 0.8f;
        static float amp, until, length = 1;

        /// <summary>当前抖动强度</summary>
        public static float Current => Time.time < until ? amp * Mathf.Clamp01((until - Time.time) / length) : 0;

        public static void Add(float strength, float duration = 0.3f)
        {
            if (!(strength > 0) || !(duration > 0)) return;
            duration = Mathf.Min(duration, MaxTime);
            if (strength >= Current)
            {
                amp = Mathf.Min(Max, strength);
                length = duration;
                until = Time.time + duration;
            }
        }

        /// <summary>以 at 为中心的震动：玩家离得越远越弱，range 米外没有</summary>
        public static void Quake(Vector3 at, float strength, float range, float duration = 0.3f)
        {
            var p = PlayerVitals.Instance;
            if (!p) return;
            var d = p.transform.position - at;
            d.y = 0;
            float k = Mathf.Clamp01(1 - d.magnitude / range);
            if (k > 0) Add(strength * k, duration);
        }
    }
}
