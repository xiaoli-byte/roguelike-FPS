using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称玩家移动（关卡走查用，数值即关卡设计尺度表的来源，见 docs/level-design/unity-maps-v1.md）：
    ///   WASD 移动 7.5 m/s · 空格 跳（起跳 8.6 m/s、重力 26 → 1.42 m；airJumps &gt; 0 时空中再跳 ×0.94，总高约 2.7 m）
    ///   Shift 冲刺（22 m/s × 0.18 s ≈ 4 m，结束保留 45% 速度）。数值与 Three.js 版 PlayerController / Stats 一致，
    ///   基础英雄没有二段跳（只有鼯与「额外跳跃」卷轴给），所以主线不能要求二段跳。
    ///   鼠标 视角（点击锁定指针，Esc 释放）· 超过 slopeLimit 的陡坡会滑下（沙丘背风面、岩丘侧壁不能硬爬）
    ///   按键全部走 <see cref="GameInput"/>（方向键、手柄同样可用；改键后这里不用改）
    /// 手感细节：土狼时间（离地 0.1 s 内仍算地面起跳）、跳跃缓冲（落地前 0.12 s 按下也会起跳）、空中保留 35% 的转向控制。
    /// 战斗相关：冲刺开始给 0.12 s 无敌帧、按充能计（默认 1 格，每格 1.6 s）；枪的后坐抬枪记成「回正债」，
    /// 停火 0.03 s 后按 92% 回正，玩家主动下压时抵消待回正量（不会回正过头）；受击击退 0.3 s 内地面摩擦降低。
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerMotor : MonoBehaviour
    {
        public Transform eye;
        public float walkSpeed = 7.5f;
        public float acceleration = 60f;
        public float airControl = 0.35f;
        public float gravity = 26f;
        public float jumpVelocity = 8.6f;
        public float airJumpMult = 0.94f;
        public int airJumps;
        public float dashSpeed = 22f, dashTime = 0.18f, dashCooldown = 1.6f, dashExitKeep = 0.45f, dashIFrames = 0.12f;
        public int dashCharges = 1;
        public float lookSpeed = 0.1f;
        /// <summary>设置里的鼠标灵敏度（倍数）与反转 Y：由玩法层（GameSettings）写入，这个程序集不认识设置表</summary>
        public static float Sensitivity = 1f;
        public static bool InvertY;
        /// <summary>开镜时由武器调低（按视角缩放比例），视角灵敏度与画面缩放一致</summary>
        [NonSerialized] public float lookScale = 1f;
        public float coyoteTime = 0.1f, jumpBuffer = 0.12f;
        /// <summary>死亡 / 菜单时关闭移动与视角</summary>
        [NonSerialized] public bool inputEnabled = true;

        // 后坐全部回正（Three.js 版是 0.92，会越打越往上漂）：停火后准星回到原来瞄的位置
        const float RecoilRecoverFraction = 1f, RecoilRecoverDelay = 0.03f, RecoilRecoverRate = 11f;
        const float KnockbackTime = 0.3f, KnockbackFriction = 12f;

        CharacterController cc;
        Vector3 velocity, groundNormal = Vector3.up;
        float yaw, pitch, lastGrounded = -1, lastJumpPress = -1, dashUntil = -1, iframeUntil = -1, knockbackUntil = -1;
        float recoilDebtPitch, recoilDebtYaw, lastRecoil = -1;
        float dashCharge;
        int airJumpsLeft;
        Vector3 dashDir;

        public Vector3 Velocity => velocity;
        public bool Grounded => cc && cc.isGrounded;
        public bool Dashing => Time.time < dashUntil;
        /// <summary>冲刺无敌帧（受击判定读取）</summary>
        public bool Invulnerable => Time.time < iframeUntil;
        /// <summary>剩余冲刺充能（含小数：0.5 = 下一格充了一半），HUD 读取</summary>
        public float DashChargeLevel => dashCharge;
        /// <summary>最近一次冲刺的方向（水平单位向量；Dashed 事件里读到的就是这一次的）</summary>
        public Vector3 DashDirection => dashDir;
        public event Action Dashed;
        /// <summary>起跳（true = 空中再跳）</summary>
        public event Action<bool> Jumped;
        /// <summary>落地（下落速度 m/s，≥ 1.5 才算）</summary>
        public event Action<float> Landed;
        /// <summary>脚步：地面上每走 2.05 m 一步（同 Three.js CameraRig 的 STEP_LENGTH），参数 = 速度 / 移速</summary>
        public event Action<float> Footstep;
        const float StepLength = 2.05f;
        float stepAcc, airFall;
        bool wasGrounded = true;

        /// <summary>武器后坐：pitch / yaw 为角度（度），正 pitch = 枪口上抬</summary>
        public void AddRecoil(float pitchDeg, float yawDeg)
        {
            float before = pitch;
            pitch = Mathf.Clamp(pitch - pitchDeg, -88f, 88f);
            yaw += yawDeg;
            recoilDebtPitch += (before - pitch) * RecoilRecoverFraction;
            recoilDebtYaw += yawDeg * RecoilRecoverFraction;
            lastRecoil = Time.time;
        }

        /// <summary>击退：水平冲量（m/s），0.3 s 内地面摩擦降低，让击退真的有位移</summary>
        public void AddImpulse(Vector3 v)
        {
            velocity += v;
            knockbackUntil = Time.time + KnockbackTime;
        }

        public void SetLook(float yawDeg, float pitchDeg)
        {
            yaw = yawDeg;
            pitch = pitchDeg;
        }

        void Awake()
        {
            cc = GetComponent<CharacterController>();
            yaw = transform.eulerAngles.y;
            dashCharge = dashCharges;
        }

        void OnControllerColliderHit(ControllerColliderHit hit)
        {
            if (hit.normal.y > 0.1f && hit.point.y < transform.position.y + cc.radius) groundNormal = hit.normal;
        }

        void Update()
        {
            float dt = Time.deltaTime, now = Time.time;

            if (GameInput.Pressed(GameAction.Fire)) Cursor.lockState = CursorLockMode.Locked;
            if (GameInput.Pressed(GameAction.Pause)) Cursor.lockState = CursorLockMode.None;
            if (Cursor.lockState == CursorLockMode.Locked && inputEnabled)
            {
                var d = GameInput.LookDelta * (lookSpeed * lookScale * Sensitivity);
                if (InvertY) d.y = -d.y;
                yaw += d.x;
                float dPitch = -d.y;
                pitch = Mathf.Clamp(pitch + dPitch, -88f, 88f);
                // 玩家主动压枪（向下 = pitch 增大）时抵消待回正量
                if (recoilDebtPitch > 0 && dPitch > 0) recoilDebtPitch = Mathf.Max(0, recoilDebtPitch - dPitch);
                if (recoilDebtYaw != 0 && Mathf.Sign(d.x) == -Mathf.Sign(recoilDebtYaw))
                {
                    float r = recoilDebtYaw + d.x;
                    recoilDebtYaw = Mathf.Sign(r) == Mathf.Sign(recoilDebtYaw) ? r : 0;
                }
            }
            UpdateRecoil(dt, now);
            transform.rotation = Quaternion.Euler(0, yaw, 0);
            if (eye) eye.localRotation = Quaternion.Euler(pitch, 0, 0);
            if (dashCharge < dashCharges) dashCharge = Mathf.Min(dashCharges, dashCharge + dt / Mathf.Max(0.05f, dashCooldown));

            var input = inputEnabled ? Vector2.ClampMagnitude(GameInput.Move, 1) : Vector2.zero;
            var wish = (transform.forward * input.y + transform.right * input.x) * walkSpeed;

            bool grounded = cc.isGrounded;
            float slope = Vector3.Angle(groundNormal, Vector3.up);
            bool steep = grounded && slope > cc.slopeLimit;
            if (grounded && !steep)
            {
                lastGrounded = now;
                airJumpsLeft = airJumps;
            }

            // 水平速度：地面全加速度，空中只给一部分转向
            var planar = new Vector3(velocity.x, 0, velocity.z);
            float accel = grounded && !steep ? acceleration : acceleration * airControl;
            if (now < knockbackUntil && grounded) accel = KnockbackFriction;
            planar = Vector3.MoveTowards(planar, wish, accel * dt);

            if (GameInput.Pressed(GameAction.Jump) && inputEnabled) lastJumpPress = now;
            if (now - lastJumpPress <= jumpBuffer)
            {
                bool canGround = now - lastGrounded <= coyoteTime;
                if (canGround || airJumpsLeft > 0)
                {
                    if (!canGround) airJumpsLeft--;
                    velocity.y = canGround ? jumpVelocity : jumpVelocity * airJumpMult;
                    lastGrounded = -1;
                    lastJumpPress = -1;
                    Jumped?.Invoke(!canGround);
                }
            }

            if (GameInput.Pressed(GameAction.Dash) && inputEnabled && dashCharge >= 1f)
            {
                dashDir = wish.sqrMagnitude > 0.01f ? wish.normalized : transform.forward;
                dashUntil = now + dashTime;
                iframeUntil = now + dashIFrames;
                dashCharge -= 1f;
                Dashed?.Invoke();
            }

            bool dashing = now < dashUntil;
            if (!dashing && dashUntil > 0)
            {
                planar = dashDir * dashSpeed * dashExitKeep;
                dashUntil = -1;
            }
            if (dashing)
            {
                planar = dashDir * dashSpeed;
                velocity.y = Mathf.Max(velocity.y, 0); // 冲刺期间不下坠，冲过 3–4 m 的缺口
            }
            else if (planar.magnitude > walkSpeed && grounded)
                planar = Vector3.MoveTowards(planar, planar.normalized * walkSpeed, 24f * dt); // 超速（冲刺余速）在地面逐渐回落

            velocity.x = planar.x;
            velocity.z = planar.z;
            if (grounded && velocity.y < 0) velocity.y = -2f; // 贴地，下坡不弹跳
            else velocity.y -= gravity * dt;
            if (steep)
            {
                // 陡坡：沿坡面向下滑，不能靠走硬爬上去
                var down = Vector3.ProjectOnPlane(Vector3.down, groundNormal).normalized;
                velocity += down * gravity * dt;
                var into = Vector3.Dot(velocity, -new Vector3(groundNormal.x, 0, groundNormal.z).normalized);
                if (into > 0) velocity += new Vector3(groundNormal.x, 0, groundNormal.z).normalized * into;
            }

            groundNormal = Vector3.up;
            if (!grounded) airFall = Mathf.Max(airFall, -velocity.y);
            var flags = cc.Move(velocity * dt);
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0) velocity.y = 0;
            // 落地 / 脚步（音效、镜头由玩法层订阅）
            bool nowGrounded = cc.isGrounded;
            if (nowGrounded && !wasGrounded && airFall >= 1.5f) Landed?.Invoke(airFall);
            if (nowGrounded) airFall = 0;
            wasGrounded = nowGrounded;
            if (nowGrounded && !dashing)
            {
                float sp = new Vector3(velocity.x, 0, velocity.z).magnitude;
                stepAcc += sp * dt;
                if (stepAcc >= StepLength)
                {
                    stepAcc -= StepLength;
                    Footstep?.Invoke(sp / Mathf.Max(1, walkSpeed));
                }
            }
        }

        void UpdateRecoil(float dt, float now)
        {
            if (recoilDebtPitch == 0 && recoilDebtYaw == 0) return;
            if (now - lastRecoil < RecoilRecoverDelay) return;
            float k = 1 - Mathf.Exp(-RecoilRecoverRate * dt);
            float dp = recoilDebtPitch * k, dy = recoilDebtYaw * k;
            pitch = Mathf.Clamp(pitch + dp, -88f, 88f);
            yaw -= dy;
            recoilDebtPitch -= dp;
            recoilDebtYaw -= dy;
            if (Mathf.Abs(recoilDebtPitch) < 1e-4f) recoilDebtPitch = 0;
            if (Mathf.Abs(recoilDebtYaw) < 1e-4f) recoilDebtYaw = 0;
        }
    }
}
