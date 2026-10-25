using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一把枪的第一人称 rig（W4；原来在 PlayerFactory.BuildWeaponRig，签名不变，PlayerFactory 转调这里）：
    ///   rig（相机下，<see cref="FirstPersonViewmodel"/>，绕 Y 转 180° 让枪管朝相机前方）→ 枪模 Prefab（缩放 VM_SCALE 0.76）→ 英雄手臂。
    ///   · 腰射 = viewOffset + HIP_SHIFT(0.024, −0.02)，开镜 = aimOffset × VM_SCALE；
    ///   · 右手在握把（武器表 rightHand / rightPitch）；左手放在枪模的 leftGrip 挂点上（W3；旧 Prefab 没有挂点时用武器表 leftHand），横滚 = leftRoll；
    ///   · 持握与换弹（<see cref="HandlingProfile"/>）：枪重 / 晃动倍率 / 换弹姿态写进 FirstPersonViewmodel，挂 <see cref="WeaponPartAnimator"/>（弹匣、转轮、泵）
    ///     和 <see cref="WeaponHandRig"/>（左手跟握点、换弹手位、加弹事件、前臂 IK）；碎刃没有 HandlingProfile，不挂；
    ///   · 只用 LOD0、不投影、去掉碰撞体，整套放 FirstPerson 层。没有枪模 Prefab 时返回 null（这把枪没有第一人称画面）。
    /// 特殊零件（瞄具、弩弦、灵炮线圈、霰铳折开……）仍由 <see cref="WeaponRigParts"/> 在玩家组装好后按武器 id 补挂。
    /// </summary>
    public static class WeaponRigFactory
    {
        /// <summary>腰射锚点的额外右下偏移（Three.js HIP_SHIFT_X / Y）</summary>
        public static readonly Vector3 HipShift = new(0.024f, -0.02f, 0);

        public static FirstPersonViewmodel Build(WeaponDef def, HeroDef hero, Transform cam, PrefabPlacer place = null)
        {
            place ??= GameDatabase.Place;
            var rig = new GameObject($"FP Rig {def.id}");
            rig.transform.SetParent(cam, false);
            var gun = Place(place, def.prefab, rig.transform, Vector3.zero, PlayerFactory.ViewmodelScale);
            if (!gun)
            {
                PlayerFactory.Kill(rig);
                return null;
            }
            var vm = rig.AddComponent<FirstPersonViewmodel>();
            vm.hipOffset = def.viewHip + HipShift;
            vm.aimOffset = def.viewAim * PlayerFactory.ViewmodelScale;
            var profile = def.IsBlade ? null : HandlingProfile.For(def.id);
            Configure(vm, profile);
            rig.transform.SetLocalPositionAndRotation(vm.hipOffset, Quaternion.Euler(0, 180, 0));

            var r = Place(place, hero.armR, gun.transform, def.rightHand, 1);
            if (r) r.transform.localRotation = Quaternion.Euler(def.rightPitch * Mathf.Rad2Deg, 0, 0);
            var grip = WeaponSockets.Find(gun.transform, WeaponSockets.LeftGrip);
            var leftPos = grip ? gun.transform.InverseTransformPoint(grip.position) : def.leftHand;
            var l = Place(place, hero.armL, gun.transform, leftPos, 1);
            if (l) l.transform.localRotation = Quaternion.Euler(0, 0, -def.leftRoll * Mathf.Rad2Deg);

            foreach (var lg in rig.GetComponentsInChildren<LODGroup>(true))
            {
                var lods = lg.GetLODs();
                for (int i = 1; i < lods.Length; i++)
                    foreach (var rr in lods[i].renderers) if (rr) rr.enabled = false;
                PlayerFactory.Kill(lg);
            }
            // 运行时 Destroy 要到帧末才生效：先停掉，免得这一帧挡住玩家自己的角色控制器
            foreach (var c in rig.GetComponentsInChildren<Collider>(true))
            {
                c.enabled = false;
                PlayerFactory.Kill(c);
            }
            foreach (var rr in rig.GetComponentsInChildren<Renderer>(true)) rr.shadowCastingMode = ShadowCastingMode.Off;

            if (profile != null)
            {
                rig.AddComponent<WeaponPartAnimator>().Bind(def, profile, gun.transform);
                if (l) rig.AddComponent<WeaponHandRig>().Bind(def, profile, gun.transform, l.transform);
            }
            PlayerFactory.SetLayer(rig, Layers.FirstPerson);
            rig.SetActive(def.id == hero.startWeapon);
            return vm;
        }

        /// <summary>把持握手感写进第一人称姿态（枪重、晃动倍率、换弹姿态、弹匣入位时刻）</summary>
        public static void Configure(FirstPersonViewmodel vm, HandlingProfile profile)
        {
            if (!vm || profile == null) return;
            vm.weight = profile.weight;
            vm.swayScale = profile.swayScale;
            vm.bobScale = profile.bobScale;
            vm.seatAt = profile.loadAt;
            if (profile.Shell)
            {
                vm.shellTiltRot = profile.tiltRot;
                vm.shellTiltPos = profile.tiltPos;
                vm.reloadTiltRot = vm.reloadTiltPos = Vector3.zero;
            }
            else
            {
                vm.reloadTiltRot = profile.tiltRot;
                vm.reloadTiltPos = profile.tiltPos;
            }
        }

        static GameObject Place(PrefabPlacer place, string id, Transform parent, Vector3 localPos, float scale)
        {
            if (string.IsNullOrEmpty(id)) return null;
            var go = place(id, parent);
            if (!go) return null;
            go.transform.SetLocalPositionAndRotation(localPos, Quaternion.identity);
            go.transform.localScale = Vector3.one * scale;
            return go;
        }
    }
}
