using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 从角色根节点的实际运动推导动画参数，玩法只管移动根节点（Three.js 版每只怪都在自己的代码里手工喂速度、步态参数）：
    ///   Speed      水平速度；原地转身时取「脚掌绕身体转动的弧速度」，混合树播一个慢步态，配合脚步锁定就是原地小碎步
    ///   MoveScale  超过最快片段的录制速度时加快播放（阈值之内为 1，混合树负责）
    ///   倾斜        偏航角速度 × 速度 → 身体压向弯内侧（CreatureRig.lean）
    /// 执行顺序：移动根节点的脚本 → CreatureLocomotion → Animator → CreatureRig。
    /// </summary>
    [DefaultExecutionOrder(10)]
    public sealed class CreatureLocomotion : MonoBehaviour
    {
        [Tooltip("最快的移动片段录制速度（米/秒）；0 = 取 ArtAssetInfo.moveSpeed")] public float maxClipSpeed;
        [Tooltip("原地转身时，弧速度 = 角速度 × 这个半径（米）；0 = 取腿长")] public float turnRadius;
        [Tooltip("转弯倾斜：度 / (弧度每秒 × 米每秒)")] public float leanPerTurn = 2.2f;
        public float maxLean = 12f;
        public bool autoTick = true;
        /// <summary>
        /// 由玩法直接指定动画速度（≥ 0 时生效，替代实测水平速度）：位移本身不均匀的步态用，
        /// 例如蜃楼蟾只在腾空段前进——实测速度一跳之内在 0.5–7 m/s 之间跳动，喂给混合树会忽而待机忽而加速
        /// </summary>
        [System.NonSerialized] public float speedOverride = -1f;

        static readonly int SpeedId = Animator.StringToHash("Speed");
        static readonly int MoveScaleId = Animator.StringToHash("MoveScale");

        Animator animator;
        CreatureRig rig;
        Vector3 lastPos;
        float lastYaw, speedSmoothed;
        bool hasMoveScale, inited;

        public float PlanarSpeed { get; private set; }
        public float YawRate { get; private set; }

        public void Init()
        {
            if (inited) return;
            inited = true;
            animator = GetComponentInChildren<Animator>();
            rig = GetComponentInChildren<CreatureRig>();
            if (maxClipSpeed <= 0) { var info = GetComponent<ArtAssetInfo>(); maxClipSpeed = info && info.moveSpeed > 0 ? info.moveSpeed : 2f; }
            if (turnRadius <= 0) turnRadius = rig ? Mathf.Max(0.2f, rig.legLength * 0.8f) : 0.4f;
            if (animator && animator.runtimeAnimatorController)
                foreach (var p in animator.parameters) if (p.nameHash == MoveScaleId) hasMoveScale = true;
            lastPos = transform.position;
            lastYaw = transform.eulerAngles.y;
        }

        void Awake() => Init();

        void Update()
        {
            if (autoTick && Application.isPlaying) Tick(Time.deltaTime);
        }

        /// <summary>根节点被瞬移（重生、对象池复用）后调用，避免算出一帧巨大的速度</summary>
        public void Teleported()
        {
            lastPos = transform.position;
            lastYaw = transform.eulerAngles.y;
            speedSmoothed = 0;
        }

        public void Tick(float dt)
        {
            Init();
            if (dt <= 0) return;
            var d = transform.position - lastPos;
            d.y = 0;
            PlanarSpeed = d.magnitude / dt;
            YawRate = Mathf.DeltaAngle(lastYaw, transform.eulerAngles.y) * Mathf.Deg2Rad / dt;
            lastPos = transform.position;
            lastYaw = transform.eulerAngles.y;
            if (PlanarSpeed > 20f) PlanarSpeed = 0; // 瞬移

            // 原地转身：几乎没有平移、但在转 → 用脚掌的弧速度驱动一个慢步态
            float turnStep = Mathf.Abs(YawRate) * turnRadius;
            float planar = speedOverride >= 0 ? speedOverride : PlanarSpeed;
            float want = planar < 0.3f && turnStep > 0.15f ? Mathf.Max(planar, Mathf.Min(turnStep, maxClipSpeed * 0.5f)) : planar;
            speedSmoothed = Mathf.Lerp(speedSmoothed, want, 1 - Mathf.Exp(-12f * dt));
            if (animator && animator.runtimeAnimatorController && animator.enabled)
            {
                animator.SetFloat(SpeedId, speedSmoothed);
                if (hasMoveScale) animator.SetFloat(MoveScaleId, speedSmoothed > maxClipSpeed ? Mathf.Min(2.5f, speedSmoothed / maxClipSpeed) : 1f);
            }
            if (rig) rig.lean = Mathf.Clamp(YawRate * planar * leanPerTurn, -maxLean, maxLean);
        }
    }
}
