using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称左手（W4，同 TS Viewmodel.animateHands + WeaponHandling.sampleLoadingHand，前臂加两骨 IK）。挂在每把枪的 rig 上（<see cref="WeaponRigFactory"/>）：
    ///   · 平时：手按在枪模的 leftGrip 挂点上，刚性跟着挂点走（霰弹枪推泵时手跟着护木走；赤蛟霰铳的握点在枪管组上）；
    ///     换完弹回到握点时只让「离握点的偏差」按 20/s 衰减，不会拖在挂点后面；
    ///   · 换弹：按 <see cref="HandlingProfile.SampleHand"/> 在 握点 → 送弹口（load 挂点，整匣换弹时跟着弹匣离位）→ 收尾点（finish）→ 握点 之间走，
    ///     逐发装填在 握点 / 送弹口 → 弹药袋 → 送弹口 之间来回，手里拿着一发弹（霰弹枪；赤蛟霰铳的弹壳由 <see cref="BreakAction"/> 画）；
    ///   · 加弹的动画事件：整匣换弹进度过了 <see cref="HandlingProfile.loadAt"/>（弹匣入位）就 <see cref="WeaponStateMachine.CommitLoad"/>，
    ///     弹药数在那一刻跳上去；切枪打断在这之后也保留这一匣（没有 rig 时状态机在换弹结束才加，结果一样）；
    ///   · 前臂：在相机空间里用两骨 IK 解出肘（肩固定在相机左下方，肘往左下外侧弯，上臂 0.42 m、前臂 0.40 m），
    ///     手在握点时的肘方向就是摆好的握持姿势；手离开握点后，前臂按「当前肘方向相对握点时肘方向」的转动跟着摆，
    ///     转动取 70%、最多 35°（手臂网格是一整块，转多了袖子会扫进镜头）。枪模随开镜 / 晃动移动时肩不动，所以肘的弯法也跟着变。
    /// 手的位置、手型都在枪模根的局部空间（手臂是枪模的子物体，跟着枪模缩放）；IK 在相机空间。
    /// </summary>
    [DefaultExecutionOrder(120)]
    public sealed class WeaponHandRig : MonoBehaviour
    {
        /// <summary>左肩、肘的弯向提示点（相机空间，米：x 右、y 上、z 前）</summary>
        public Vector3 shoulder = new(-0.19f, -0.26f, -0.05f), pole = new(-0.55f, -0.6f, 0.3f);
        /// <summary>上臂 / 前臂长（米，第一人称手臂比真人略长：枪模放在眼前 0.6 m 左右）</summary>
        public float upperArmLength = 0.42f, forearmLength = 0.40f;
        /// <summary>前臂跟 IK 摆动的比例与上限（度）</summary>
        public float ikWeight = 0.7f, maxSwing = 35f;
        static readonly Color ShellColor = Hex.Rgb(0xb86b32);

        /// <summary>绑定（存进场景 / Prefab，编辑器里烘好的玩家重新加载后也能用）</summary>
        [SerializeField] string weaponId;
        [SerializeField] Transform gun, arm;

        WeaponController wc;
        WeaponDef def;
        HandlingProfile profile;
        Transform grip, load, finish, round;
        Vector3 handPos, restOffset;
        float roll, pitch;

        public string WeaponId => def?.id;
        /// <summary>左手（测试读）</summary>
        public Transform Arm => arm;
        /// <summary>左手此刻的目标与实际位置（枪模空间）</summary>
        public Vector3 HandPosition => handPos;
        /// <summary>IK 解出的肘（枪模空间；没有相机父物体时不解，为握点）</summary>
        public Vector3 Elbow { get; private set; }
        /// <summary>前臂此刻相对握持姿势的摆动（度）</summary>
        public float Swing { get; private set; }

        /// <summary>接上枪模和左手（WeaponRigFactory 建 rig 时调）。arm 的原点是握点（手掌），初始旋转 = 握持横滚</summary>
        public void Bind(WeaponDef weapon, HandlingProfile handling, Transform gunRoot, Transform leftArm)
        {
            weaponId = weapon?.id;
            gun = gunRoot;
            arm = leftArm;
            Init(weapon, handling);
        }

        void Init(WeaponDef weapon, HandlingProfile handling)
        {
            def = weapon;
            profile = handling;
            if (def == null || !gun) return;
            grip = WeaponSockets.Find(gun, WeaponSockets.LeftGrip);
            load = WeaponSockets.Find(gun, WeaponSockets.Load);
            finish = WeaponSockets.Find(gun, WeaponSockets.Finish);
            handPos = Support();
            restOffset = Vector3.zero;
            roll = def.leftRoll;
            pitch = 0;
            Elbow = handPos;
            if (arm && profile != null && profile.action == LoadingAction.Shell)
            {
                round = WeaponRigPart.FindDeep(arm, "reload.round");
                if (!round)
                {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    go.name = "reload.round";
                    var c = go.GetComponent<Collider>();
                    if (Application.isPlaying) Destroy(c);
                    else DestroyImmediate(c);
                    round = go.transform;
                    round.SetParent(arm, false);
                    round.localPosition = new Vector3(0, 0.014f, -0.025f);
                    round.localScale = new Vector3(0.013f, 0.013f, 0.052f);
                    go.layer = arm.gameObject.layer;
                    FxMaterials.Tint(go.GetComponent<Renderer>(), ShellColor);
                }
                round.gameObject.SetActive(false);
            }
            Apply();
        }

        void Awake()
        {
            wc = GetComponentInParent<WeaponController>();
            if (def == null && !string.IsNullOrEmpty(weaponId)) Init(WeaponLibrary.Get(weaponId), HandlingProfile.For(weaponId));
        }

        /// <summary>手型（枪模空间）：俯仰绕 X（不随镜像变号），横滚绕 Z（Three.js 枪模 X 镜像后变号）</summary>
        static Quaternion HandRotation(float rollRad, float pitchRad) =>
            Quaternion.AngleAxis(pitchRad * Mathf.Rad2Deg, Vector3.right) * Quaternion.AngleAxis(-rollRad * Mathf.Rad2Deg, Vector3.forward);

        Vector3 Local(Transform t, Vector3 fallback) => t && gun ? gun.InverseTransformPoint(t.position) : fallback;

        Vector3 Support() => Local(grip, def != null ? def.leftHand : Vector3.zero);

        void LateUpdate()
        {
            if (!arm || !gun || def == null) return;
            if (!wc) wc = GetComponentInParent<WeaponController>();
            float dt = Time.deltaTime;
            var support = Support();
            var a = wc ? wc.Active : null;
            bool live = a != null && a.def == def && wc.Takeover == null;
            var sm = wc ? wc.Machine : null;
            bool reloading = live && sm.Reloading && profile != null;
            bool showRound = false;
            if (reloading)
            {
                bool shell = sm.ShellReload;
                float p = shell ? sm.ShellProgress : sm.ReloadProgress;
                bool first = !shell || sm.ShellsInserted == 0;
                profile.SampleHand(p, support, Local(load, support), Local(finish, support), first, def.leftRoll, out handPos, out roll, out pitch);
                restOffset = handPos - support;
                // 加弹的动画事件：弹匣入位
                if (!shell && p >= profile.loadAt) sm.CommitLoad();
                showRound = shell && p > 0.22f && p < 0.98f;
            }
            else
            {
                // 刚性跟着握点走，只让离握点的偏差衰减（推泵时手不拖后）
                float k = 1 - Mathf.Exp(-20f * dt);
                restOffset = Vector3.Lerp(restOffset, Vector3.zero, k);
                handPos = support + restOffset;
                roll = Mathf.Lerp(roll, def.leftRoll, k);
                pitch = Mathf.Lerp(pitch, 0, k);
            }
            if (round && round.gameObject.activeSelf != showRound) round.gameObject.SetActive(showRound);
            Apply();
        }

        void Apply()
        {
            if (!arm) return;
            var hand = HandRotation(roll, pitch);
            var delta = Quaternion.identity;
            var cam = transform.parent;
            Elbow = handPos;
            Swing = 0;
            if (cam && gun && ikWeight > 0)
            {
                // 相机空间：手在当前位置 / 在握点时各解一次肘，前臂按两个肘方向之间的转动摆
                var h = cam.InverseTransformPoint(gun.TransformPoint(handPos));
                var h0 = cam.InverseTransformPoint(gun.TransformPoint(Support()));
                var e = TwoBoneIK.Solve(shoulder, h, upperArmLength, forearmLength, pole, out _);
                var e0 = TwoBoneIK.Solve(shoulder, h0, upperArmLength, forearmLength, pole, out _);
                Elbow = gun.InverseTransformPoint(cam.TransformPoint(e));
                var d = Quaternion.FromToRotation(e0 - h0, e - h);
                d.ToAngleAxis(out float angle, out var axis);
                if (angle > 180) angle -= 360;
                if (float.IsFinite(angle) && axis.sqrMagnitude > 1e-6f && Mathf.Abs(angle) > 1e-3f)
                {
                    angle = Mathf.Clamp(angle * ikWeight, -maxSwing, maxSwing);
                    Swing = Mathf.Abs(angle);
                    // 相机空间的转动换到枪模局部
                    var camToGun = Quaternion.Inverse(gun.rotation) * cam.rotation;
                    delta = Quaternion.AngleAxis(angle, camToGun * axis);
                }
            }
            arm.localPosition = handPos;
            arm.localRotation = delta * hand;
        }
    }
}
