using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 导体（第四章，combat 1.3；docs/unity-ch4-port.md 第 2 节契约）：经幡杆、拉则、碉楼、雷桩、导雷石柱、铁索桥都挂它。
    ///   · 引雷：<see cref="LightningStrike.Strike(Vector3, float, float, float, UnityEngine.Object)"/> 的落点在某个导体的 <see cref="attractRadius"/> 内、
    ///     且导体顶比落点高时，雷改劈导体（多个时劈顶最高的，见 <see cref="Best"/>）；导体底下 <see cref="splashRadius"/> 米溅电 <see cref="splashDamage"/>——
    ///     站在导体旁 2–5 m 能躲雷。
    ///   · 充电：每被劈一次加 <see cref="chargePerStrike"/>（夹到 0..1），之后每秒掉 <see cref="drainPerSecond"/>（0 = 不掉，导雷石柱攒满等人打）；
    ///     也可以由场地机关直接 <see cref="AddCharge"/>（大鹗的雷桩在雷暴里慢慢攒）。<see cref="canCharge"/> = false 的导体只引雷、不带电（碉楼）。
    ///   · 放电：<see cref="Discharge"/> 清空电量并返回放掉的量，效果（回劈夔、劈雷神、电铁索）由调用方做。
    ///   · 事件：<see cref="Struck"/>（被雷劈中，带落雷信息）、<see cref="Discharged"/>（放电）；静态 <see cref="AnyStruck"/> 给场地脚本统一监听。
    /// 组件位置 = 导体底座（地面）；顶点 = 底座 + 上 × <see cref="height"/>（<see cref="Top"/>）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Conductor : MonoBehaviour
    {
        [Tooltip("顶离底座的高度（米）：落雷劈在顶上，「更高的导体」按顶的世界高度比")]
        public float height = 6f;
        [Tooltip("引雷半径（米）：落点在这个水平距离内就被引走")]
        public float attractRadius = 5f;
        [Tooltip("被劈中后能不能带电（碉楼只引雷）")]
        public bool canCharge = true;
        [Tooltip("每被劈一次充多少电（0..1）")]
        [Range(0, 1)] public float chargePerStrike = 1f;
        [Tooltip("每秒掉多少电（0 = 不掉；经幡杆 0.1 = 带电 10 秒）")]
        public float drainPerSecond = 0.1f;
        [Tooltip("电量 ≥ 它算「带电」（发紫光、能回劈）")]
        [Range(0, 1)] public float chargedAt = 0.05f;
        [Tooltip("被劈中时导体底下溅电的半径（米）与伤害")]
        public float splashRadius = 2f, splashDamage = 12f;

        /// <summary>电量 0..1</summary>
        [NonSerialized] public float charge;

        /// <summary>被雷劈中（导体, 落雷信息）</summary>
        public event Action<Conductor, StrikeInfo> Struck;
        /// <summary>放电（导体, 放掉的电量）</summary>
        public event Action<Conductor, float> Discharged;
        /// <summary>场上任何一个导体被劈中</summary>
        public static event Action<Conductor, StrikeInfo> AnyStruck;

        static readonly List<Conductor> all = new();

        /// <summary>场上启用的导体</summary>
        public static IReadOnlyList<Conductor> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            AnyStruck = null;
        }

        /// <summary>顶点（世界坐标）：落雷劈在这里</summary>
        public Vector3 Top => transform.position + Vector3.up * height;
        /// <summary>底座（世界坐标）：溅电的圆心</summary>
        public Vector3 Base => transform.position;
        /// <summary>此刻带电（电量 ≥ <see cref="chargedAt"/>）</summary>
        public bool Charged => canCharge && charge >= chargedAt && charge > 0;
        /// <summary>被劈过几次（测试 / 调试）</summary>
        public int Strikes { get; private set; }
        /// <summary>最近一次被劈中的时间（没被劈过为 −∞）</summary>
        public float LastStruckAt { get; private set; } = float.NegativeInfinity;

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        void Update()
        {
            if (charge > 0 && drainPerSecond > 0) charge = Mathf.Max(0, charge - drainPerSecond * Time.deltaTime);
        }

        /// <summary>充电（夹到 0..1）；不能带电的导体忽略</summary>
        public void AddCharge(float amount)
        {
            if (!canCharge || !float.IsFinite(amount)) return;
            charge = Mathf.Clamp01(charge + amount);
        }

        /// <summary>放电：清空电量，返回放掉的量（0 = 没电），发 <see cref="Discharged"/></summary>
        public float Discharge()
        {
            float k = charge;
            charge = 0;
            if (k > 0 && Discharged != null)
                try
                {
                    Discharged(this, k);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            return k;
        }

        /// <summary>被劈中（<see cref="LightningStrike"/> 调）：充电、计数、发事件</summary>
        internal void OnStruck(in StrikeInfo info)
        {
            Strikes++;
            LastStruckAt = Time.time;
            AddCharge(chargePerStrike);
            var copy = info;
            try
            {
                Struck?.Invoke(this, copy);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            try
            {
                AnyStruck?.Invoke(this, copy);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>
        /// 引雷：落点 point 在哪个导体的引雷半径内（水平距离）、且导体顶比落点高 1 m 以上——多个时取顶最高的；没有返回 null。
        /// exclude 可以排除一个（雷从这个导体放出来时不再劈回它自己）
        /// </summary>
        public static Conductor Best(Vector3 point, Conductor exclude = null)
        {
            Conductor best = null;
            float bestY = float.NegativeInfinity;
            foreach (var c in all)
            {
                if (!c || c == exclude || !c.isActiveAndEnabled) continue;
                var b = c.transform.position;
                float dx = b.x - point.x, dz = b.z - point.z;
                if (dx * dx + dz * dz > c.attractRadius * c.attractRadius) continue;
                float top = c.Top.y;
                if (top < point.y + 1f || top <= bestY) continue;
                best = c;
                bestY = top;
            }
            return best;
        }

        /// <summary>离 point 最近的带电导体（水平距离 ≤ radius；夔落在带电的经幡杆 4 m 内会被回劈）；没有返回 null</summary>
        public static Conductor NearestCharged(Vector3 point, float radius)
        {
            Conductor best = null;
            float bd = radius * radius;
            foreach (var c in all)
            {
                if (!c || !c.Charged) continue;
                var b = c.transform.position;
                float dx = b.x - point.x, dz = b.z - point.z, d = dx * dx + dz * dz;
                if (d > bd) continue;
                bd = d;
                best = c;
            }
            return best;
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.35f, 0.85f, 0.8f);
            Gizmos.DrawLine(transform.position, Top);
            Gizmos.DrawWireSphere(Top, 0.3f);
            Gizmos.color = new Color(1f, 0.35f, 0.85f, 0.25f);
            Gizmos.DrawWireSphere(transform.position, attractRadius);
        }
    }
}
