using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    [DefaultExecutionOrder(100)]
    public sealed class GunfireOriginalMotion : MonoBehaviour
    {
        public string weaponId;
        public GunfireWeaponMotionDocument source;
        public int fireCount;

        WeaponController controller;
        Vector3 recoilPositionTarget, recoilRotationTarget, position, positionVelocity, rotation, rotationVelocity;
        float lastFire = -100f;

        public bool HasMotion => source?.motion != null;
        public Vector3 RecoilPosition => position;
        public Vector3 RecoilRotation => rotation;

        public void Bind(string id, WeaponController weapon)
        {
            if (controller) controller.Fired -= OnFired;
            weaponId = id;
            controller = weapon;
            var text = Resources.Load<TextAsset>($"Gunfire/Motion/{id}");
            source = text ? JsonUtility.FromJson<GunfireWeaponMotionDocument>(text.text) : null;
            if (controller && HasMotion) controller.Fired += OnFired;
        }

        void Start() => Bind(weaponId, GetComponentInParent<WeaponController>());

        void OnDestroy()
        {
            if (controller) controller.Fired -= OnFired;
        }

        void OnDisable()
        {
            recoilPositionTarget = recoilRotationTarget = Vector3.zero;
            position = positionVelocity = rotation = rotationVelocity = Vector3.zero;
        }

        void OnFired(WeaponInstance weapon)
        {
            if (!HasMotion || weapon?.def == null || weapon.def.prefab != $"SK_Weapon_Gunfire{weaponId}") return;
            var motion = source.motion;
            if (Time.time - lastFire < motion.MotionRecoilInterval) return;
            lastFire = Time.time;
            fireCount++;
            if (!motion.FixedPoint) recoilPositionTarget += motion.MotionPositionRecoil;
            recoilRotationTarget += motion.MotionRotationRecoil;
            recoilPositionTarget = Vector3.Min(motion.MotionPositionMaxState, Vector3.Max(-motion.MotionPositionMaxState, recoilPositionTarget));
            if (recoilRotationTarget.magnitude < motion.MotionRotationRecoilDeadZone) recoilRotationTarget = Vector3.zero;
        }

        static void Step(ref Vector3 value, ref Vector3 velocity, Vector3 target, float stiffness, float damping, float dt)
        {
            int steps = Mathf.Max(1, Mathf.CeilToInt(dt * 240));
            float h = dt / steps;
            for (int i = 0; i < steps; i++)
            {
                velocity += (target - value) * (stiffness * 60 * h);
                velocity *= Mathf.Exp(-damping * 60 * h);
                value += velocity * h;
            }
        }

        void LateUpdate()
        {
            if (!HasMotion) return;
            float dt = Mathf.Min(Time.deltaTime, 0.1f);
            var motion = source.motion;
            recoilPositionTarget *= Mathf.Exp(-motion.MotionPositionReset * dt);
            recoilRotationTarget *= Mathf.Exp(-motion.MotionRotationReset * dt);
            Step(ref position, ref positionVelocity, recoilPositionTarget, motion.PositionSpring2Stiffness, motion.PositionSpring2Damping, dt);
            Step(ref rotation, ref rotationVelocity, recoilRotationTarget, motion.RotationSpring2Stiffness, motion.RotationSpring2Damping, dt);
            transform.localPosition += position;
            transform.localRotation *= Quaternion.Euler(rotation);
        }
    }
}
