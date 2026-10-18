using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 死亡布娃娃：编辑器 CreatureRigBuilder 按每根骨骼实际蒙皮的网格厚度生成胶囊碰撞体、刚体与 CharacterJoint，平时全部关闭。
    /// Activate 时关掉 Animator 与 CreatureRig，刚体接管，并在受击点附近的部件上加冲量；Restore 恢复动画（重生 / 对象池复用）。
    /// （Three.js 版的死亡是程序化瘫倒；这里是真实物理，会顺着坡滚、挂在台阶边上。）
    /// </summary>
    public sealed class CreatureRagdoll : MonoBehaviour
    {
        [Serializable]
        public sealed class Part
        {
            public Rigidbody body;
            public Collider collider;
        }

        public Part[] parts = Array.Empty<Part>();
        public bool Active { get; private set; }

        void Awake() => SetPhysics(false);

        void SetPhysics(bool on)
        {
            foreach (var p in parts)
            {
                if (p.body)
                {
                    p.body.isKinematic = !on;
                    p.body.detectCollisions = on;
                    p.body.interpolation = on ? RigidbodyInterpolation.Interpolate : RigidbodyInterpolation.None;
                }
                if (p.collider) p.collider.enabled = on;
            }
        }

        /// <summary>impulse：世界空间冲量（方向 × 力度）；point：受击点（冲量加在最近的部件上，其余部件带一点同向速度）</summary>
        public void Activate(Vector3 impulse, Vector3 point)
        {
            if (Active) return;
            Active = true;
            var animator = GetComponentInChildren<Animator>();
            if (animator) animator.enabled = false;
            foreach (var rig in GetComponentsInChildren<CreatureRig>()) rig.enabled = false;
            foreach (var c in GetComponents<Collider>()) c.enabled = false; // 角色胶囊让位给布娃娃
            SetPhysics(true);
            Part nearest = null;
            float best = float.MaxValue;
            foreach (var p in parts)
            {
                if (!p.body) continue;
                p.body.linearVelocity = impulse / Mathf.Max(1f, TotalMass()) * 0.6f;
                float d = (p.body.worldCenterOfMass - point).sqrMagnitude;
                if (d < best) { best = d; nearest = p; }
            }
            nearest?.body.AddForceAtPosition(impulse, point, ForceMode.Impulse);
        }

        /// <summary>
        /// 按速度激活（战斗击杀用）：所有部件统一带上 velocity（米 / 秒），受击点最近的部件再多一半，让尸体顺着受击方向翻倒；
        /// 和体重无关，大块头和小怪被同样的击退打出去的距离一致
        /// </summary>
        public void ActivateWithVelocity(Vector3 velocity, Vector3 point)
        {
            if (Active) return;
            Activate(Vector3.zero, point);
            Part nearest = null;
            float best = float.MaxValue;
            foreach (var p in parts)
            {
                if (!p.body) continue;
                p.body.linearVelocity = velocity;
                float d = (p.body.worldCenterOfMass - point).sqrMagnitude;
                if (d < best) { best = d; nearest = p; }
            }
            nearest?.body.AddForceAtPosition(velocity * 0.5f, point, ForceMode.VelocityChange);
        }

        public void Restore()
        {
            if (!Active) return;
            Active = false;
            SetPhysics(false);
            foreach (var c in GetComponents<Collider>()) c.enabled = true;
            var animator = GetComponentInChildren<Animator>();
            if (animator) { animator.enabled = true; animator.Rebind(); }
            foreach (var rig in GetComponentsInChildren<CreatureRig>()) { rig.enabled = true; rig.ResetState(); }
        }

        float TotalMass()
        {
            float m = 0;
            foreach (var p in parts) if (p.body) m += p.body.mass;
            return m;
        }
    }
}
