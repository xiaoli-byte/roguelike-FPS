using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 挡弹区（Three.js 版 ProjectileWard / setWard，碎刃「碎刃屏障」、各种护盾用）：敌方投射物的运动线段穿过它时被销毁，先于打玩家的判定。
    ///   Disc：圆盘，圆心 = 本物体位置，法线 = 本物体 forward（两面都挡，同 TS crossesWard）；
    ///   Sphere：球罩，只挡从外面飞进来的（罩子里面打出去的不挡）。
    /// 被挡下的投射物不触发落地回调（onImpact），改调它自己的 onBlocked；爆炸弹在挡弹面上引爆（爆炸伤害仍按到玩家的距离结算）。
    /// 挡下时发 <see cref="Blocked"/>（挡弹点、那一发对玩家的伤害）：屏障按它扣刃气、加杀意。
    /// 可以同时有多个；启用即生效，停用即撤掉。
    /// </summary>
    public sealed class ProjectileWard : MonoBehaviour
    {
        public enum Shape { Disc, Sphere }

        public Shape shape = Shape.Disc;
        public float radius = 1f;

        /// <summary>挡下一发敌方投射物：挡弹区、挡弹点、那一发对玩家的伤害</summary>
        public event Action<ProjectileWard, Vector3, float> Blocked;

        static readonly List<ProjectileWard> active = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => active.Clear();

        /// <summary>当前生效的挡弹区数量</summary>
        public static int ActiveCount => active.Count;

        void OnEnable()
        {
            if (!active.Contains(this)) active.Add(this);
        }

        void OnDisable() => active.Remove(this);

        /// <summary>这一段（origin + dir × [0, segLen]，dir 为单位向量）是否被这个挡弹区挡下；t = 挡弹点沿线段的距离</summary>
        public bool Intersects(Vector3 origin, Vector3 dir, float segLen, out float t)
        {
            t = 0;
            if (!(radius > 0)) return false;
            return shape == Shape.Disc
                ? ProjectileMath.CrossesDisc(transform.position, transform.forward, radius, origin, dir, segLen, out t)
                : ProjectileMath.EntersSphere(transform.position, radius, origin, dir, segLen, out t);
        }

        /// <summary>沿线段找最先挡下它的挡弹区；point = 挡弹点</summary>
        public static bool TryBlock(Vector3 origin, Vector3 dir, float segLen, out ProjectileWard ward, out Vector3 point)
        {
            ward = null;
            point = default;
            float best = float.PositiveInfinity;
            for (int i = active.Count - 1; i >= 0; i--)
            {
                var w = active[i];
                if (!w)
                {
                    active.RemoveAt(i);
                    continue;
                }
                if (w.Intersects(origin, dir, segLen, out float t) && t < best)
                {
                    best = t;
                    ward = w;
                }
            }
            if (!ward) return false;
            point = origin + dir * best;
            return true;
        }

        /// <summary>投射物系统调用：通知挡下了一发（监听者异常不影响投射物回收）</summary>
        internal void NotifyBlocked(Vector3 point, float damage)
        {
            var h = Blocked;
            if (h == null) return;
            foreach (Action<ProjectileWard, Vector3, float> fn in h.GetInvocationList())
                try
                {
                    fn(this, point, damage);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(0.4f, 0.8f, 1f, 0.8f);
            if (shape == Shape.Sphere)
            {
                Gizmos.DrawWireSphere(transform.position, radius);
                return;
            }
            Gizmos.matrix = Matrix4x4.TRS(transform.position, transform.rotation, new Vector3(1, 1, 0.01f));
            Gizmos.DrawWireSphere(Vector3.zero, radius);
        }
    }
}
