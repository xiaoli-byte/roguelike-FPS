using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃屏障的挡弹面（docs/demon-blade-v2.md 第 5 节；TS DemonBlade 的 ward）：包一个圆盘形 <see cref="ProjectileWard"/>，
    /// 控制器每帧按盾心 / 朝向 / 半径摆好，碎片到齐（35%）后才启用。敌方投射物穿过盾面即被销毁（两面都挡，同 TS crossesWard），
    /// 每挡下一发派发 <see cref="Blocked"/>（挡弹点）：屏障据此扣刃气、加杀意、局部闪光。
    /// </summary>
    public sealed class BladeWard : MonoBehaviour
    {
        ProjectileWard ward;

        /// <summary>挡下一发敌方投射物（挡弹点、那一发对玩家的伤害）</summary>
        public event Action<Vector3, float> Blocked;

        public static BladeWard Create(Transform parent)
        {
            var go = new GameObject("DemonBlade Ward");
            if (parent) go.transform.SetParent(parent, false);
            go.SetActive(false);
            var w = go.AddComponent<BladeWard>();
            w.ward = go.AddComponent<ProjectileWard>();
            w.ward.shape = ProjectileWard.Shape.Disc;
            w.ward.Blocked += w.OnBlocked;
            return w;
        }

        void OnDestroy()
        {
            if (ward) ward.Blocked -= OnBlocked;
        }

        void OnBlocked(ProjectileWard _, Vector3 point, float damage) => Blocked?.Invoke(point, damage);

        /// <summary>盾心、盾面朝外的法线、挡弹半径（世界坐标）</summary>
        public void Frame(Vector3 center, Vector3 normal, float radius)
        {
            if (normal.sqrMagnitude < 1e-8f) normal = Vector3.forward;
            transform.SetPositionAndRotation(center, Quaternion.LookRotation(normal));
            if (ward) ward.radius = radius;
        }

        /// <summary>生效中（停用时投射物照常穿过）</summary>
        public bool Active
        {
            get => gameObject.activeSelf;
            set
            {
                if (gameObject.activeSelf != value) gameObject.SetActive(value);
            }
        }
    }
}
