using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 转管零件（WC2，挂在 rig 上的 <see cref="WeaponRigPart"/>，由 <see cref="WeaponRigParts"/> 按武器 id 自动补挂）：
    /// 显示的是这把枪时，按当前开火模式的预热量（<see cref="IFireMode.Spin"/>，机炮按住预热 0..1、松手 0.9 s 转停）× 满转速
    /// 绕枪管轴转登记的骨骼（<see cref="WeaponSpinner"/>）。轴 = 枪模根的 z（TS 枪管方向），换到骨骼自己的空间，不依赖导出时骨骼的朝向。
    /// 骨骼找不到（重导后编号变了）时只警告一次、什么都不转。
    /// 登记：进入 Play 前把每条 <see cref="WeaponSpinner"/> 登记成这个零件（每把枪只能有一种零件）。
    /// </summary>
    public sealed class BarrelSpinner : WeaponRigPart
    {
        WeaponSpinner spec;
        Transform bone;
        Quaternion rest;
        Vector3 axis;
        float angle, spin;

        /// <summary>转管骨骼（测试读；没找到为 null）</summary>
        public Transform SpinBone => bone;
        /// <summary>当前累计转角（度，0..360）</summary>
        public float SpinAngle => angle;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void RegisterAll()
        {
            foreach (var s in Registry<WeaponSpinner>.All) WeaponRigParts.Register(s.weaponId, typeof(BarrelSpinner));
        }

        protected override void Build()
        {
            spec = WeaponSpinner.For(weaponId);
            if (spec == null) return;
            bone = Bone(spec.bone);
            if (!bone)
            {
                Debug.LogWarning($"[BarrelSpinner] {weaponId} 的枪模里没有转管骨骼 {spec.bone}（重导后编号变了？）");
                return;
            }
            rest = bone.localRotation;
            var a = Quaternion.Inverse(bone.rotation) * gun.TransformDirection(Vector3.forward);
            axis = a.sqrMagnitude > 1e-6f ? a.normalized : Vector3.forward;
        }

        void LateUpdate()
        {
            if (!bone || spec == null || !wc) return;
            // 显示的是手上这把：跟开火模式的预热量；收枪阶段 / 不是这把：按 0.9 s 自己转停
            float target = Live ? wc.ActiveMode?.Spin ?? 0 : 0;
            spin = target >= spin ? target : Mathf.Max(target, spin - Time.deltaTime / WeaponTiming.SpinDown);
            if (!(spin > 0)) return;
            angle = Mathf.Repeat(angle + spin * spec.rate * Time.deltaTime * Mathf.Rad2Deg, 360f);
            bone.localRotation = rest * Quaternion.AngleAxis(angle, axis);
        }
    }
}
