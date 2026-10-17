using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称玩家移动（关卡走查用，数值即关卡设计尺度表的来源，见 docs/level-design/unity-maps-v1.md）：
    ///   WASD 移动 7.5 m/s · 空格 跳（起跳 8.6 m/s、重力 26 → 1.42 m；airJumps &gt; 0 时空中再跳 ×0.94，总高约 2.7 m）
    ///   Shift 冲刺（22 m/s × 0.18 s ≈ 4 m，结束保留 45% 速度）。数值与 Three.js 版 PlayerController / Stats 一致，
    ///   基础英雄没有二段跳（只有鼯与「额外跳跃」卷轴给），所以主线不能要求二段跳。
    ///   鼠标 视角（点击锁定指针，Esc 释放）· 超过 slopeLimit 的陡坡会滑下（沙丘背风面、岩丘侧壁不能硬爬）
    /// 手感细节：土狼时间（离地 0.1 s 内仍算地面起跳）、跳跃缓冲（落地前 0.12 s 按下也会起跳）、空中保留 35% 的转向控制。
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
        public float dashSpeed = 22f, dashTime = 0.18f, dashCooldown = 0.8f, dashExitKeep = 0.45f;
        public float lookSpeed = 0.1f;
        public float coyoteTime = 0.1f, jumpBuffer = 0.12f;

        CharacterController cc;
        Vector3 velocity, groundNormal = Vector3.up;
        float yaw, pitch, lastGrounded = -1, lastJumpPress = -1, dashUntil = -1, nextDash;
        int airJumpsLeft;
        Vector3 dashDir;

        public Vector3 Velocity => velocity;
        public bool Grounded => cc && cc.isGrounded;

        void Awake()
        {
            cc = GetComponent<CharacterController>();
            yaw = transform.eulerAngles.y;
        }

        void OnControllerColliderHit(ControllerColliderHit hit)
        {
            if (hit.normal.y > 0.1f && hit.point.y < transform.position.y + cc.radius) groundNormal = hit.normal;
        }

        void Update()
        {
            var kb = Keyboard.current;
            var mouse = Mouse.current;
            if (kb == null || mouse == null) return;
            float dt = Time.deltaTime, now = Time.time;

            if (mouse.leftButton.wasPressedThisFrame) Cursor.lockState = CursorLockMode.Locked;
            if (kb.escapeKey.wasPressedThisFrame) Cursor.lockState = CursorLockMode.None;
            if (Cursor.lockState == CursorLockMode.Locked)
            {
                var d = mouse.delta.ReadValue();
                yaw += d.x * lookSpeed;
                pitch = Mathf.Clamp(pitch - d.y * lookSpeed, -88f, 88f);
            }
            transform.rotation = Quaternion.Euler(0, yaw, 0);
            if (eye) eye.localRotation = Quaternion.Euler(pitch, 0, 0);

            var input = Vector2.zero;
            if (kb.wKey.isPressed) input.y += 1;
            if (kb.sKey.isPressed) input.y -= 1;
            if (kb.dKey.isPressed) input.x += 1;
            if (kb.aKey.isPressed) input.x -= 1;
            input = Vector2.ClampMagnitude(input, 1);
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
            planar = Vector3.MoveTowards(planar, wish, accel * dt);

            if (kb.spaceKey.wasPressedThisFrame) lastJumpPress = now;
            if (now - lastJumpPress <= jumpBuffer)
            {
                bool canGround = now - lastGrounded <= coyoteTime;
                if (canGround || airJumpsLeft > 0)
                {
                    if (!canGround) airJumpsLeft--;
                    velocity.y = canGround ? jumpVelocity : jumpVelocity * airJumpMult;
                    lastGrounded = -1;
                    lastJumpPress = -1;
                }
            }

            if (kb.leftShiftKey.wasPressedThisFrame && now >= nextDash)
            {
                dashDir = wish.sqrMagnitude > 0.01f ? wish.normalized : transform.forward;
                dashUntil = now + dashTime;
                nextDash = now + dashCooldown;
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
            var flags = cc.Move(velocity * dt);
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0) velocity.y = 0;
        }
    }
}
