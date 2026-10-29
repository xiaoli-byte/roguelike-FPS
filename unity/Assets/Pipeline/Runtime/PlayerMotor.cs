using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称玩家移动（数值即关卡设计尺度表的来源，见 docs/level-design/unity-maps-v1.md 第 0 节）：
    ///   WASD 移动 7.5 m/s · 空格 跳（起跳 8.6 m/s、重力 26 → 1.42 m；airJumps &gt; 0 时空中再跳 ×0.94，总高约 2.68 m）
    ///   Shift 冲刺（22 m/s × 0.18 s = 3.96 m，结束保留 45% 速度；原地冲刺接跳 ≈ 5.9 m）。基础英雄没有二段跳（只有鼯与「额外跳跃」卷轴给），主线不能要求二段跳。
    ///   鼠标 视角（点击锁定指针，Esc 释放）· 超过 slopeLimit 的陡坡会滑下（沙丘背风面、岩丘侧壁不能硬爬）
    ///   按键全部走 <see cref="GameInput"/>（方向键、手柄同样可用；改键后这里不用改）
    /// 运动规则在 <see cref="MotorCore"/>（纯 C#，EditMode 测试逐帧模拟）：地面 / 空中加速与阻力分开、超速慢慢回落（冲刺跳的惯性留得住）、
    /// 梯形积分、二段跳转向、冲刺按帧内剩余时间精确结算、冲刺后 0.06 s 锁定、跳跃打断冲刺。这里只负责输入、视角、后坐回正、角色控制器与贴地吸附。
    /// 修饰器栈 <see cref="Modifiers"/>：速度倍率（寒意、机炮预热、技能）、重力倍率（滑翔、砸地）、输入锁。
    /// 运动 API：<see cref="AddImpulse"/> / <see cref="Launch"/> / <see cref="CancelDash"/> / <see cref="Teleport"/> / <see cref="GrantInvulnerability"/> / <see cref="Lunge"/>。
    /// 手感细节：土狼时间 0.1 s、跳跃缓冲 0.12 s；冲刺开始给 0.12 s 无敌帧、按充能计（默认 1 格，每格 1.6 s）；
    /// 枪的后坐抬枪记成「回正债」，停火 0.03 s 后全部回正，玩家主动下压时抵消待回正量（不会回正过头）；受击击退 0.3 s 内地面摩擦降低。
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerMotor : MonoBehaviour
    {
        public Transform eye;
        public float walkSpeed = 7.5f;
        /// <summary>地面：有输入时的加速度 / 无输入时的刹车（m/s²）</summary>
        public float groundAccel = 78f, groundFriction = 60f;
        /// <summary>空中：有输入时的控制加速度 / 无输入时的阻力（m/s²）——以前地面空中共用 60 × 0.35 = 21，空中刹车会吃掉冲刺跳的惯性</summary>
        public float airAccel = 20f, airDrag = 1.2f;
        /// <summary>超速（冲刺余速、击飞）在地面 / 空中回落的速度（m/s²）</summary>
        public float overspeedDecelGround = 24f, overspeedDecelAir = 3f;
        public float gravity = 26f;
        public float maxFallSpeed = 42f;
        public float jumpVelocity = 8.6f;
        public float airJumpMult = 0.94f;
        /// <summary>空中再跳时水平速度向输入方向转向的比例</summary>
        public float airJumpRedirect = 0.65f;
        public int airJumps;
        public float dashSpeed = 22f, dashTime = 0.18f, dashCooldown = 1.6f, dashExitKeep = 0.45f, dashIFrames = 0.12f;
        /// <summary>冲刺结束后多久不能再冲（防止连按把两格充能连成一次长冲刺）</summary>
        public float dashLockout = 0.06f;
        public int dashCharges = 1;
        public float lookSpeed = 0.1f;
        /// <summary>设置里的鼠标灵敏度（倍数）与反转 Y：由玩法层（GameSettings）写入，这个程序集不认识设置表</summary>
        public static float Sensitivity = 1f;
        public static bool InvertY;
        /// <summary>
        /// 手柄瞄准辅助（I7，玩法层的 AimAssist 写入）：只在右摇杆转视角的帧调用；参数 = 这一帧的视角增量（度：x 往右、y 往上）与视点，
        /// 返回改过的增量（准星压在敌人身上时减速、往目标拉一点）。鼠标输入不经过它
        /// </summary>
        public static Func<Vector2, Transform, Vector2> StickAssist;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStickAssist() => StickAssist = null;
        /// <summary>开镜时由武器调低（按视角缩放比例），视角灵敏度与画面缩放一致</summary>
        [NonSerialized] public float lookScale = 1f;
        public float coyoteTime = 0.1f, jumpBuffer = 0.12f;
        /// <summary>死亡 / 菜单时关闭移动与视角</summary>
        [NonSerialized] public bool inputEnabled = true;

        // 后坐全部回正（Three.js 版是 0.92，会越打越往上漂）：停火后准星回到原来瞄的位置
        const float RecoilRecoverFraction = 1f, RecoilRecoverDelay = 0.03f, RecoilRecoverRate = 11f;
        const float StepLength = 2.05f;

        readonly MotorCore core = new();
        readonly MotorModifierStack modifiers = new();
        CharacterController cc;
        Vector3 hitGroundNormal = Vector3.up, hitWallNormal;
        float yaw, pitch;
        float recoilDebtPitch, recoilDebtYaw, lastRecoil = -1;
        float stepAcc;
        int groundMask = ~0;
        MotorFrame frame = MotorFrame.Neutral(MotorTuning.Default);

        /// <summary>修饰器栈（速度倍率、重力倍率、输入锁）。也可以用 <see cref="AddModifier(IMotorModifier, int)"/></summary>
        public MotorModifierStack Modifiers => modifiers;
        /// <summary>运动状态机（调试、测试）</summary>
        public MotorCore Core => core;
        /// <summary>上一帧修饰器求值后的参数（HUD / 镜头读速度倍率、锁）</summary>
        public MotorFrame Frame => frame;

        public Vector3 Velocity => core.velocity;
        /// <summary>脚下碰到地面（含陡坡；同以前的 cc.isGrounded）</summary>
        public bool Grounded => core.touching;
        /// <summary>站在可走的地面上（不含陡坡）：安全落脚点、技能落地判定用</summary>
        public bool OnWalkableGround => core.grounded;
        public bool Dashing => core.dashing;
        /// <summary>正在被 <see cref="Lunge"/> 驱动</summary>
        public bool Lunging => core.Lunging;
        /// <summary>无敌（冲刺无敌帧、<see cref="GrantInvulnerability"/>、硬突进）：受击判定读取</summary>
        public bool Invulnerable => core.invuln > 0;
        /// <summary>剩余无敌秒数</summary>
        public float InvulnerableTime => core.invuln;
        /// <summary>剩余冲刺充能（含小数：0.5 = 下一格充了一半），HUD 读取</summary>
        public float DashChargeLevel => core.dashCharge;
        /// <summary>最近一次冲刺的方向（水平单位向量；Dashed 事件里读到的就是这一次的）</summary>
        public Vector3 DashDirection => core.dashDir;
        /// <summary>现在的走路最高速（walkSpeed × 修饰器的速度倍率）</summary>
        public float MaxSpeed => walkSpeed * frame.speedMult;
        public float Yaw => yaw;
        public float Pitch => pitch;

        public event Action Dashed;
        /// <summary>起跳（true = 空中再跳）</summary>
        public event Action<bool> Jumped;
        /// <summary>落地（下落速度 m/s，≥ 1.5 才算）</summary>
        public event Action<float> Landed;
        /// <summary>脚步：地面上每走 2.05 m 一步（同 Three.js CameraRig 的 STEP_LENGTH），参数 = 速度 / 移速</summary>
        public event Action<float> Footstep;
        /// <summary>冲刺结束（自然结束、被跳跃打断、被技能取消）</summary>
        public event Action DashEnded;
        /// <summary>被 <see cref="Teleport"/> 传送</summary>
        public event Action Teleported;

        // ───────────── 运动 API ─────────────

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

        /// <summary>
        /// 叠加速度冲量（击退、爆炸掀开）：水平 &gt; 3 m/s 时 0.3 s 内地面摩擦降低，让击退真的有位移；向上 &gt; 0.5 m/s 时离地。
        /// 冲刺中水平部分会被冲刺覆盖（冲刺穿过爆炸 = 闪开）；需要在冲刺中生效的自身位移先 <see cref="CancelDash"/> 或直接用 <see cref="Launch"/>。
        /// </summary>
        public void AddImpulse(Vector3 v) => core.AddImpulse(v);

        /// <summary>抛射：结束冲刺 / 突进，速度直接设成 v（起跳台、技能跃起、被首领掀飞）；超出走路速度的部分在空中慢慢回落</summary>
        public void Launch(Vector3 velocity)
        {
            bool wasDashing = core.dashing;
            core.Launch(velocity);
            if (wasDashing) Raise(DashEnded);
        }

        /// <summary>立即结束冲刺（保留冲刺出口速度）；不在冲刺中无效果</summary>
        public void CancelDash()
        {
            if (!core.dashing) return;
            core.CancelDash();
            Raise(DashEnded);
        }

        /// <summary>无敌 seconds 秒（与已有的无敌取较长者）：技能、托回安全点、复活保护</summary>
        public void GrantInvulnerability(float seconds)
        {
            if (seconds > 0 && float.IsFinite(seconds)) core.invuln = Mathf.Max(core.invuln, seconds);
        }

        /// <summary>立即结束无敌（危险地面的伤害要无视冲刺 / 托回的短无敌时用，用完可以再 Grant 回去）</summary>
        public void ClearInvulnerability() => core.invuln = 0;

        /// <summary>
        /// 受控突进：沿水平方向 dir 以 speed（m/s）移动 time 秒。iframes &gt; 0 = 硬突进（匀速、悬停、无视输入与外力，并无敌这么久）；
        /// 否则软突进（正常移动 / 跳跃，只抬高沿 dir 的速度下限）。被墙挡住提前结束；结束时水平速度 = dir × exitSpeed。返回是否开始
        /// </summary>
        public bool Lunge(Vector3 dir, float speed, float time, float iframes = 0, float exitSpeed = 0)
        {
            bool wasDashing = core.dashing;
            bool ok = core.Lunge(dir, speed, time, iframes, exitSpeed);
            if (ok && wasDashing) Raise(DashEnded);
            return ok;
        }

        public void CancelLunge() => core.CancelLunge();

        /// <summary>
        /// 传送（托回安全点、出生、剧情）：清空速度、冲刺、突进、跳跃缓冲、后坐回正量；yawDeg 有值时同时转向并把俯仰归零。
        /// 按脚下有没有地面设好落地状态，不会误触发落地事件。
        /// </summary>
        public void Teleport(Vector3 position, float? yawDeg = null)
        {
            if (!cc) cc = GetComponent<CharacterController>();
            bool was = cc.enabled;
            cc.enabled = false;
            transform.position = position;
            cc.enabled = was;
            if (yawDeg.HasValue && float.IsFinite(yawDeg.Value))
            {
                yaw = yawDeg.Value;
                pitch = 0;
                transform.rotation = Quaternion.Euler(0, yaw, 0);
                if (eye) eye.localRotation = Quaternion.identity;
            }
            recoilDebtPitch = recoilDebtYaw = 0;
            stepAcc = 0;
            SyncTuning();
            core.ResetMotion(ProbeGround(position, 0.12f));
            Raise(Teleported);
        }

        public void SetLook(float yawDeg, float pitchDeg)
        {
            yaw = yawDeg;
            pitch = pitchDeg;
        }

        /// <summary>登记运动修饰器；返回的句柄 Dispose 即撤销</summary>
        public IDisposable AddModifier(IMotorModifier mod, int priority = 0) => modifiers.Add(mod, priority);

        /// <summary>登记运动修饰器，seconds 秒后自动撤销（按游戏时间）</summary>
        public IDisposable AddModifier(IMotorModifier mod, float seconds, int priority = 0) =>
            modifiers.Add(mod, priority, seconds > 0 ? Time.time + seconds : float.PositiveInfinity);

        public IDisposable AddModifier(MotorModify fn, int priority = 0) => modifiers.Add(MotorMods.From(fn), priority);

        // ───────────── 生命周期 ─────────────

        void Awake()
        {
            cc = GetComponent<CharacterController>();
            yaw = transform.eulerAngles.y;
            SyncTuning();
            core.dashCharge = Mathf.Max(1, dashCharges);
            core.airJumpsLeft = Mathf.Max(0, airJumps);
            frame = MotorFrame.Neutral(core.t);
            // 贴地吸附 / 落地探测用的层：与角色控制器会碰撞的层，去掉自己这一层（角色：敌人）与 Ignore Raycast（边界墙）
            int layer = gameObject.layer, mask = 0;
            for (int i = 0; i < 32; i++)
                if (!Physics.GetIgnoreLayerCollision(layer, i))
                    mask |= 1 << i;
            groundMask = mask & ~(1 << layer) & ~(1 << 2);
        }

        void OnControllerColliderHit(ControllerColliderHit hit)
        {
            float foot = transform.position.y + cc.center.y - cc.height * 0.5f;
            if (hit.normal.y > 0.1f && hit.point.y < foot + cc.radius) hitGroundNormal = hit.normal;
            else if (hit.normal.y < 0.7f && hit.normal.y > -0.7f) hitWallNormal = hit.normal;
        }

        void SyncTuning()
        {
            core.t = new MotorTuning
            {
                walkSpeed = walkSpeed, groundAccel = groundAccel, groundFriction = groundFriction, airAccel = airAccel, airDrag = airDrag,
                overspeedGround = overspeedDecelGround, overspeedAir = overspeedDecelAir,
                gravity = gravity, maxFallSpeed = maxFallSpeed, jumpVelocity = jumpVelocity, airJumpMult = airJumpMult, airJumpRedirect = airJumpRedirect,
                airJumps = airJumps, coyoteTime = coyoteTime, jumpBuffer = jumpBuffer,
                dashSpeed = dashSpeed, dashTime = dashTime, dashExitKeep = dashExitKeep, dashIFrames = dashIFrames, dashLockout = dashLockout,
                dashCooldown = dashCooldown, dashCharges = dashCharges,
                knockbackTime = 0.3f, knockbackFriction = 12f, groundStick = 2f,
            };
        }

        void Update()
        {
            float dt = Time.deltaTime, now = Time.time;
            SyncTuning();

            // 输入
            var input = new MotorInput { facing = transform.forward };
            if (inputEnabled)
            {
                var m = Vector2.ClampMagnitude(GameInput.Move, 1);
                input.wish = transform.forward * m.y + transform.right * m.x;
                input.jumpPressed = GameInput.Pressed(GameAction.Jump);
                input.jumpHeld = GameInput.Down(GameAction.Jump);
                input.dashPressed = GameInput.Pressed(GameAction.Dash);
            }

            // 本帧参数：缺省值 + 上下文 → 修饰器栈
            var f = MotorFrame.Neutral(core.t);
            f.grounded = core.grounded;
            f.velocity = core.velocity;
            f.dashing = core.dashing;
            f.jumpHeld = input.jumpHeld;
            f.jumpPressed = input.jumpPressed;
            f.dt = dt;
            modifiers.Apply(ref f, now);
            f.Sanitize(core.t);
            frame = f;

            // 视角
            if (GameInput.Pressed(GameAction.Fire)) Cursor.lockState = CursorLockMode.Locked;
            if (GameInput.Pressed(GameAction.Pause)) Cursor.lockState = CursorLockMode.None;
            if (Cursor.lockState == CursorLockMode.Locked && inputEnabled && !f.Locked(MotorLock.Look))
            {
                var d = GameInput.LookDelta * (lookSpeed * lookScale * Sensitivity);
                if (InvertY) d.y = -d.y;
                if (StickAssist != null && eye && GameInput.StickLooking) d = StickAssist(d, eye);
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
            if (!(dt > 0) || !cc || !cc.enabled) return;

            // 运动：状态机给位移 → 角色控制器移动 → 贴地吸附 → 碰撞结果喂回去
            var step = core.Step(input, f, dt);
            hitGroundNormal = Vector3.up;
            hitWallNormal = Vector3.zero;
            var start = transform.position;
            var flags = cc.Move(step.delta);
            bool touching = cc.isGrounded;
            if (!touching && step.snap) touching = SnapDown(cc.stepOffset);
            if (RescueFromGround(start)) touching = true;
            bool steep = touching && Vector3.Angle(hitGroundNormal, Vector3.up) > cc.slopeLimit;
            var fb = new MotorFeedback
            {
                touching = touching, steep = steep, groundNormal = hitGroundNormal, hitCeiling = (flags & CollisionFlags.Above) != 0,
                wallNormal = (flags & CollisionFlags.Sides) != 0 ? hitWallNormal : Vector3.zero,
                intended = step.delta, actual = transform.position - start,
            };
            var ev = step.events | core.AfterMove(fb, dt, out float landFall);

            // 事件（音效、特效、事件总线由玩法层订阅）
            if ((ev & MotorEvents.Dashed) != 0) Raise(Dashed);
            if ((ev & MotorEvents.DashEnded) != 0) Raise(DashEnded);
            if ((ev & MotorEvents.Jumped) != 0) Raise(Jumped, false);
            if ((ev & MotorEvents.AirJumped) != 0) Raise(Jumped, true);
            if ((ev & MotorEvents.Landed) != 0) Raise(Landed, landFall);

            // 脚步
            if (core.grounded && !core.dashing)
            {
                float sp = MotorCore.Flat(core.velocity).magnitude;
                stepAcc += sp * dt;
                if (stepAcc >= StepLength)
                {
                    stepAcc -= StepLength;
                    Raise(Footstep, sp / Mathf.Max(1, MaxSpeed));
                }
            }
        }

        /// <summary>
        /// 贴地吸附（Three.js moveBody 的 STEP_HEIGHT 下探）：帧初站在地上、移动后离了地时，脚下 maxDrop 米内有可走的地面就贴上去——
        /// 跑下坡、下台阶不会一路小跳（也不会误报落地、不会切成空中手感）；更深的落差照常腾空。
        /// </summary>
        bool SnapDown(float maxDrop)
        {
            if (!ProbeGroundBelow(transform.position, maxDrop, out var hit)) return false;
            cc.Move(Vector3.down * (hit.distance + 0.02f));
            if (cc.isGrounded) hitGroundNormal = hit.normal;
            return cc.isGrounded;
        }

        /// <summary>
        /// 防穿地：角色控制器的重叠恢复会把胶囊沿最短方向推出压着它的静态碰撞体（敌人根节点的角色胶囊没有刚体），这一步不扫掠——
        /// 方向朝下时（敌人身体压在头顶、旋壳撞过来时罩住上半身）直接把人推进地形，第一人称看到地面背面，随后掉出世界。
        /// 三个条件同时成立才算穿下去了：① 这一帧往下走了；② 帧初的胶囊中心到现在的脚底之间隔着一层朝上的世界地面，且比脚底高出 5 cm 以上；
        /// ③ 现在的胶囊（半径收 2 cm）和世界几何重叠。扫掠过的正常移动（走下台阶 / 崖边 / 坡顶、冲刺、击飞、跟着下降的平台）停在皮肤厚度外，
        /// ③ 永远不成立——哪怕 ② 的射线擦过了台阶沿、上一层楼板；掉进洞里、深水 / 熔岩托回（Teleport，不在这里）中间没有地面，② 不成立。
        /// 成立时：脚底放回穿过的那层地面（现在的水平位置处，找不到就用射线穿过的那一点），下落速度清零；
        /// 放的时候胶囊底球沿地面法线贴在皮肤厚度外（坡上不会一半埋进坡里），还和世界几何重叠就往上抬一点再试，都不行就不动。
        /// </summary>
        bool RescueFromGround(Vector3 start)
        {
            var end = transform.position;
            if (end.y >= start.y - 1e-4f) return false;
            var from = start + Vector3.up * cc.center.y;
            var seg = end - from;
            float len = seg.magnitude;
            if (len < 1e-4f) return false;
            if (!Physics.Raycast(from, seg / len, out var hit, len, groundMask, QueryTriggerInteraction.Ignore)) return false;
            if (hit.normal.y < RescueMinNormalY || hit.point.y < end.y + RescueSlack) return false;
            if (!OverlapsWorld(end)) return false;
            // 现在的水平位置处的那层地面（从穿过点上方 0.5 m 往下找）；找不到 / 放不下就用射线穿过的那一点
            Vector3 feet, normal;
            if (Physics.Raycast(new Vector3(end.x, hit.point.y + 0.5f, end.z), Vector3.down, out var g, 0.5f + (hit.point.y - end.y), groundMask, QueryTriggerInteraction.Ignore)
                && g.normal.y >= RescueMinNormalY && g.point.y > end.y + RescueSlack && RestOn(g.point, g.normal, out feet))
                normal = g.normal;
            else if (RestOn(hit.point, hit.normal, out feet))
                normal = hit.normal;
            else return false;
            LastRescueDepth = feet.y - end.y;
            GroundRescues++;
            if (Time.unscaledTime >= rescueLogAt)
            {
                rescueLogAt = Time.unscaledTime + 0.5f;
                Debug.Log($"[PlayerMotor] 防穿地托回 #{GroundRescues}：脚底本来要陷进地面 {LastRescueDepth:F2} m（{end} → {feet}，地面 {(normal.y >= 0.999f ? "平" : $"{Vector3.Angle(normal, Vector3.up):F0}°")}）");
            }
            cc.enabled = false;
            transform.position = feet;
            cc.enabled = true;
            if (core.velocity.y < 0) core.velocity.y = 0;
            hitGroundNormal = normal;
            return true;
        }

        /// <summary>胶囊底球沿法线 n 贴在地面点 point 的皮肤厚度外时的脚底位置；和世界几何重叠就往上抬（最多 0.3 m）再试</summary>
        bool RestOn(Vector3 point, Vector3 n, out Vector3 feet)
        {
            float r = cc.radius;
            float bottom = cc.center.y - Mathf.Max(0, cc.height * 0.5f - r);
            var basis = point + n.normalized * (r + cc.skinWidth) - Vector3.up * bottom;
            foreach (float lift in RescueLifts)
            {
                feet = basis + Vector3.up * lift;
                if (!OverlapsWorld(feet)) return true;
            }
            feet = default;
            return false;
        }

        static readonly float[] RescueLifts = { 0, 0.08f, 0.18f, 0.3f };
        float rescueLogAt;

        /// <summary>脚底在 feet 时的胶囊（半径收 2 cm，不算皮肤厚度内的贴靠）和世界几何重叠</summary>
        bool OverlapsWorld(Vector3 feet)
        {
            float r = Mathf.Max(0.05f, cc.radius - 0.02f);
            float half = Mathf.Max(0, cc.height * 0.5f - cc.radius);
            var c = feet + cc.center;
            return Physics.CheckCapsule(c - Vector3.up * half, c + Vector3.up * half, r, groundMask, QueryTriggerInteraction.Ignore);
        }

        const float RescueSlack = 0.05f, RescueMinNormalY = 0.3f;

        /// <summary>防穿地托回的次数、最近一次脚底陷进地面的深度（米）：测试 / 调试读</summary>
        public int GroundRescues { get; private set; }
        public float LastRescueDepth { get; private set; }

        /// <summary>从胶囊底部球心往下扫一个略小的球：找到坡度不超过 slopeLimit 的地面</summary>
        bool ProbeGroundBelow(Vector3 position, float maxDrop, out RaycastHit hit)
        {
            float r = cc.radius, probe = r * 0.9f;
            var bottom = position + cc.center - Vector3.up * Mathf.Max(0, cc.height * 0.5f - r);
            var origin = bottom + Vector3.up * 0.05f;
            float dist = maxDrop + 0.05f + cc.skinWidth + (r - probe);
            if (!Physics.SphereCast(origin, probe, Vector3.down, out hit, dist, groundMask, QueryTriggerInteraction.Ignore)) return false;
            return hit.normal.y >= Mathf.Cos(cc.slopeLimit * Mathf.Deg2Rad);
        }

        bool ProbeGround(Vector3 position, float maxDrop)
        {
            if (!cc) return false;
            return ProbeGroundBelow(position, maxDrop, out _);
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

        // 监听者抛异常只报错，不打断运动
        static void Raise(Action a)
        {
            if (a == null) return;
            try { a(); }
            catch (Exception e) { Debug.LogException(e); }
        }

        static void Raise<T>(Action<T> a, T arg)
        {
            if (a == null) return;
            try { a(arg); }
            catch (Exception e) { Debug.LogException(e); }
        }
    }
}
