using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 活动零件动画（W4，同 TS Viewmodel.animateParts；docs/unity-parity.md 3.3「活动零件」）。挂在每把枪的 rig 上（<see cref="WeaponRigFactory"/>），
    /// 转 W3 导出的语义零件骨骼（<see cref="WeaponSockets"/>），参数来自 <see cref="HandlingProfile"/>：
    ///   · 弹匣 / 能量罐 / 弹箱 / 箭匣 / 灯芯（mag，与转轮不是同一根骨骼时）：整匣换弹按 <see cref="HandlingProfile.MagOut"/> 离位
    ///     （枪模空间偏移 <see cref="HandlingProfile.magOffset"/> + 绕枪模横轴俯仰 <see cref="HandlingProfile.magPitch"/>），管式装填塞进去后隐藏（骨骼缩到零）；
    ///   · 转轮 / 转鼓（cylinder，<see cref="HandlingProfile.cylinderSteps"/> &gt; 0）：每发转一格（阻尼 25），换弹时向左甩出并自转（14 rad/s）；
    ///     三才转轮由 <see cref="TrinityCycle"/> 负责（cylinderSteps = 0，这里不碰）；
    ///   · 泵动护木（pump）：开枪后 0.12–0.44 s、逐发装填上膛（<see cref="WeaponNote.Racked"/>）0.3 s 各往后拉一次（行程 <see cref="HandlingProfile.pumpStroke"/>）。
    /// 转管（<see cref="BarrelSpinner"/>）、灵炮线圈（<see cref="RailgunCharge"/>）、霰铳枪管（<see cref="BreakAction"/>）、弩弦（<see cref="CrossbowString"/>）各有零件，这里不重复。
    /// 偏移和旋转都按枪模空间算、换到骨骼父节点的局部空间写，不依赖导出时骨骼的朝向。
    /// </summary>
    [DefaultExecutionOrder(110)]
    public sealed class WeaponPartAnimator : MonoBehaviour
    {
        /// <summary>绑定（存进场景 / Prefab，编辑器里烘好的玩家重新加载后也能用）</summary>
        [SerializeField] string weaponId;
        [SerializeField] Transform gun;

        WeaponController wc;
        WeaponDef def;
        HandlingProfile profile;
        Transform mag, cylinder, pump;
        Vector3 magRest, magRestScale, cylRest, pumpRest;
        Quaternion magRestRot, cylRestRot;
        Vector3 cylAxis;
        float magOut, cylAngle, cylTarget, sinceShot = 99, rackT = 99;
        bool magHidden;

        /// <summary>弹匣离位程度（测试读）</summary>
        public float MagOut => magOut;
        public Transform Mag => mag;
        public Transform Cylinder => cylinder;
        public Transform Pump => pump;
        public float CylinderAngle => cylAngle;

        public void Bind(WeaponDef weapon, HandlingProfile handling, Transform gunRoot)
        {
            weaponId = weapon?.id;
            gun = gunRoot;
            Init(weapon, handling);
        }

        void Init(WeaponDef weapon, HandlingProfile handling)
        {
            def = weapon;
            profile = handling;
            if (def == null || !gun) return;
            var s = WeaponSockets.Of(gun);
            Transform Part(string n) => s ? s.Part(n) : WeaponRigPart.FindDeep(gun, n);
            cylinder = profile != null && profile.cylinderSteps > 0 ? Part("cylinder") : null;
            var m = Part("mag");
            // 转轮兼弹匣（左轮、榴弹鼓、雷蛊、三才）：只按转轮处理（同 TS g.mag !== g.cylinder）
            mag = m && m != Part("cylinder") ? m : null;
            pump = profile != null && profile.pumpStroke > 0 ? Part("pump") : null;
            if (mag)
            {
                magRest = mag.localPosition;
                magRestRot = mag.localRotation;
                magRestScale = mag.localScale;
            }
            if (cylinder)
            {
                cylRest = cylinder.localPosition;
                cylRestRot = cylinder.localRotation;
                var axis = Quaternion.Inverse(cylinder.rotation) * gun.TransformDirection(Vector3.forward);
                cylAxis = axis.sqrMagnitude > 1e-6f ? axis.normalized : Vector3.forward;
            }
            if (pump) pumpRest = pump.localPosition;
        }

        void Awake()
        {
            wc = GetComponentInParent<WeaponController>();
            if (def == null && !string.IsNullOrEmpty(weaponId)) Init(WeaponLibrary.Get(weaponId), HandlingProfile.For(weaponId));
        }

        void OnEnable()
        {
            if (!wc) wc = GetComponentInParent<WeaponController>();
            if (!wc) return;
            wc.Fired += OnFired;
            wc.Noted += OnNoted;
        }

        void OnDisable()
        {
            if (wc)
            {
                wc.Fired -= OnFired;
                wc.Noted -= OnNoted;
            }
            magOut = 0;
            sinceShot = rackT = 99;
            if (cylinder) cylAngle = cylTarget = Mathf.Repeat(cylTarget, 360f);
            Apply();
        }

        bool Mine(WeaponInstance w) => w != null && def != null && w.def == def;

        void OnFired(WeaponInstance w)
        {
            if (!Mine(w)) return;
            sinceShot = 0;
            if (cylinder && profile.cylinderSteps > 0) cylTarget += 360f / profile.cylinderSteps;
        }

        void OnNoted(WeaponNote note, WeaponInstance w)
        {
            if (note == WeaponNote.Racked && Mine(w)) rackT = 0;
        }

        void LateUpdate()
        {
            if (!gun || profile == null) return;
            float dt = Time.deltaTime;
            sinceShot += dt;
            rackT += dt;
            var a = wc ? wc.Active : null;
            var sm = wc ? wc.Machine : null;
            bool full = Mine(a) && sm.Reloading && !sm.ShellReload;
            float target = full ? profile.MagOut(sm.ReloadProgress) : 0;
            magOut = Mathf.Lerp(magOut, target, 1 - Mathf.Exp(-20f * dt));
            if (cylinder)
            {
                if (magOut > 0.3f)
                {
                    cylAngle += dt * profile.cylinderSpin * Mathf.Rad2Deg;
                    cylTarget = cylAngle;
                }
                else cylAngle = Mathf.Lerp(cylAngle, cylTarget, 1 - Mathf.Exp(-25f * dt));
            }
            Apply();
        }

        /// <summary>枪模空间的偏移（Three.js 坐标，x 取反）→ 骨骼父节点的局部偏移</summary>
        Vector3 Offset(Transform bone, Vector3 tsOffset)
        {
            var world = gun.TransformVector(new Vector3(-tsOffset.x, tsOffset.y, tsOffset.z));
            return bone.parent ? bone.parent.InverseTransformVector(world) : world;
        }

        void Apply()
        {
            if (!gun || profile == null) return;
            if (mag)
            {
                mag.localPosition = magRest + Offset(mag, profile.magOffset) * magOut;
                var axis = mag.parent ? mag.parent.InverseTransformDirection(gun.right) : gun.right;
                mag.localRotation = Quaternion.AngleAxis(profile.magPitch * magOut * Mathf.Rad2Deg, axis) * magRestRot;
                // 弹匣是蒙皮网格的一段（没有自己的渲染器）：隐藏 = 把骨骼缩到几乎为零
                bool hide = magOut >= profile.magHideAt;
                if (hide != magHidden)
                {
                    magHidden = hide;
                    mag.localScale = hide ? magRestScale * 1e-3f : magRestScale;
                }
            }
            if (cylinder)
            {
                cylinder.localPosition = cylRest + Offset(cylinder, new Vector3(profile.cylinderSwing, 0, 0)) * magOut;
                cylinder.localRotation = cylRestRot * Quaternion.AngleAxis(cylAngle, cylAxis);
            }
            if (pump)
            {
                float pz = 0;
                float t1 = (sinceShot - 0.12f) / 0.32f;
                if (t1 > 0 && t1 < 1) pz = Mathf.Sin(t1 * Mathf.PI) * profile.pumpStroke;
                float t2 = rackT / 0.3f;
                if (t2 < 1) pz = Mathf.Max(pz, Mathf.Sin(t2 * Mathf.PI) * profile.pumpStroke);
                pump.localPosition = pumpRest + Offset(pump, new Vector3(0, 0, pz));
            }
        }
    }
}
