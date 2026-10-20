using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 运动调参（数值即关卡尺度表的来源，docs/level-design/unity-maps-v1.md 第 0 节）。PlayerMotor 每帧把自己的公开字段拷进来；测试直接用 <see cref="Default"/>。
    /// 地面 / 空中的加速与阻力分开（Three.js PlayerController：78 / 60 / 20 / 1.2）：地面跟手，空中几乎不刹车——冲刺跳的惯性留得住。
    /// </summary>
    [Serializable]
    public struct MotorTuning
    {
        /// <summary>走路最高速（m/s；修饰器的速度倍率乘在它上面）</summary>
        public float walkSpeed;
        /// <summary>地面：有输入时的加速度 / 无输入时的刹车减速度（m/s²）</summary>
        public float groundAccel, groundFriction;
        /// <summary>空中：有输入时的控制加速度 / 无输入时的阻力（m/s²）</summary>
        public float airAccel, airDrag;
        /// <summary>超过最高速（冲刺余速、击飞、技能位移）时在地面 / 空中回落的速度（m/s²）：空中只回落 3，冲刺跳不掉速</summary>
        public float overspeedGround, overspeedAir;
        public float gravity, maxFallSpeed, jumpVelocity;
        /// <summary>空中再跳的起跳速度倍率；再跳时水平速度向输入方向转向的比例</summary>
        public float airJumpMult, airJumpRedirect;
        public int airJumps;
        public float coyoteTime, jumpBuffer;
        public float dashSpeed, dashTime, dashExitKeep, dashIFrames, dashLockout, dashCooldown;
        public int dashCharges;
        /// <summary>被击退后地面摩擦降低的时长与降到的值</summary>
        public float knockbackTime, knockbackFriction;
        /// <summary>站在地上时每帧往下贴的速度（m/s，只算位移不进速度）：保证角色控制器每帧都碰到地面</summary>
        public float groundStick;

        public static MotorTuning Default => new()
        {
            walkSpeed = 7.5f,
            groundAccel = 78, groundFriction = 60, airAccel = 20, airDrag = 1.2f, overspeedGround = 24, overspeedAir = 3,
            gravity = 26, maxFallSpeed = 42, jumpVelocity = 8.6f, airJumpMult = 0.94f, airJumpRedirect = 0.65f, airJumps = 0,
            coyoteTime = 0.1f, jumpBuffer = 0.12f,
            dashSpeed = 22, dashTime = 0.18f, dashExitKeep = 0.45f, dashIFrames = 0.12f, dashLockout = 0.06f, dashCooldown = 1.6f, dashCharges = 1,
            knockbackTime = 0.3f, knockbackFriction = 12, groundStick = 2,
        };
    }

    /// <summary>一帧的输入：wish = 世界空间的水平移动意图（模长 ≤ 1，手柄可以半推），facing = 没有输入时冲刺朝哪</summary>
    public struct MotorInput
    {
        public Vector3 wish, facing;
        public bool jumpPressed, jumpHeld, dashPressed;
    }

    /// <summary>这一帧发生的事（音效、特效、事件总线据此派发）</summary>
    [Flags]
    public enum MotorEvents
    {
        None = 0,
        Jumped = 1 << 0,
        AirJumped = 1 << 1,
        Dashed = 1 << 2,
        DashEnded = 1 << 3,
        Landed = 1 << 4,
        LungeEnded = 1 << 5,
    }

    /// <summary><see cref="MotorCore.Step"/> 的结果：本帧位移、要不要贴地吸附、发生的事</summary>
    public struct MotorStep
    {
        public Vector3 delta;
        /// <summary>帧初站在地上、没起跳、没被抛起：移动后离了地就往下吸附（下坡、下台阶不腾空）</summary>
        public bool snap;
        public MotorEvents events;
    }

    /// <summary>移动之后的碰撞结果（由角色控制器 / 测试里的平地世界给出）</summary>
    public struct MotorFeedback
    {
        /// <summary>脚下碰到了地面（含陡坡）</summary>
        public bool touching;
        /// <summary>碰到的是超过坡度上限的陡坡（会滑下，不算站稳）</summary>
        public bool steep;
        public Vector3 groundNormal;
        public bool hitCeiling;
        /// <summary>侧面撞到的墙的法线（没撞为零向量）</summary>
        public Vector3 wallNormal;
        /// <summary>预定位移 / 实际位移</summary>
        public Vector3 intended, actual;
    }

    /// <summary>
    /// 第一人称运动状态机（纯 C#，不碰组件与物理查询）：PlayerMotor 每帧 <see cref="Step"/> 拿到位移，交给角色控制器移动，再把碰撞结果 <see cref="AfterMove"/> 喂回来。
    /// 这样运动规则可以在 EditMode 里按平地世界逐帧模拟（MotorTests 断言尺度表：跳 1.42 m、二段跳 ≈ 2.7 m、冲刺 ≈ 4 m、冲刺跳 ≈ 6 m）。
    /// 规则（Three.js PlayerController.updateMovement 为基准，改进处注明）：
    ///   · 水平：地面加速 78 / 刹车 60，空中控制 20 / 阻力 1.2；超速时地面按 24、空中按 3 m/s² 回落（不把冲刺 / 击飞的惯性一下夹掉）；
    ///   · 竖直：梯形积分（本帧初末速度取平均）——跳跃高度、滞空时间与帧率无关；下落上限 42 m/s，修饰器可改（滑翔）；
    ///   · 跳：土狼时间 0.1 s、跳跃缓冲 0.12 s；空中再跳（额外跳跃）只认这一帧按下，起跳 ×0.94，水平速度向输入方向转 65%；
    ///   · 冲刺：22 m/s × 0.18 s（按帧内剩余时间精确结算 = 3.96 m，与帧率无关），结束保留 45%，之后 0.06 s 不能再冲；
    ///     冲刺期间不下坠（上升照常减速，借冲刺爬不了高）；跳跃打断冲刺并带着冲刺余速起跳；
    ///   · 突进（Lunge）：硬突进匀速、悬停、无视输入与外力，被墙挡住提前结束；软突进只抬高沿方向的速度下限；
    ///   · 冲量 / 抛射：向上 &gt; 0.5 m/s 的冲量让角色离地（这一帧不贴地吸附）；水平 &gt; 3 m/s 的冲量 0.3 s 内地面摩擦降到 12。
    /// </summary>
    public sealed class MotorCore
    {
        /// <summary>突进本帧沿方向的实际推进不足期望的这个比例且撞墙 = 被挡住</summary>
        public const float LungeBlockFrac = 0.35f;
        /// <summary>落地事件的最小下落速度（m/s）</summary>
        public const float LandEventSpeed = 1.5f;

        public MotorTuning t = MotorTuning.Default;
        public Vector3 velocity;
        /// <summary>站在可走的地面上（上一次移动之后）</summary>
        public bool grounded;
        /// <summary>脚下碰到地面（含陡坡）</summary>
        public bool touching;
        public bool steep;
        public Vector3 groundNormal = Vector3.up;
        public bool dashing;
        public Vector3 dashDir = Vector3.forward;
        /// <summary>冲刺充能（含小数）</summary>
        public float dashCharge = 1;
        public int airJumpsLeft;
        /// <summary>剩余无敌时间（冲刺无敌帧、技能 / 托回给的无敌）</summary>
        public float invuln;

        float coyote, jumpBuf, dashLeft, lockout, knock, preMoveVy;
        bool forceAirborne;
        float lungeLeft, lungeSpeed, lungeExit, lungeEntryAlong;
        Vector3 lungeDir = Vector3.forward;
        bool lungeSoft;

        public bool Lunging => lungeLeft > 0;
        public bool HardLunging => lungeLeft > 0 && !lungeSoft;
        public float LungeSpeed => lungeSpeed;
        public float DashCooldownLeft => lockout;

        // ───────────── 每帧 ─────────────

        /// <summary>推进一帧：返回位移（交给角色控制器）。dt ≤ 0（暂停）时什么都不做</summary>
        public MotorStep Step(in MotorInput input, in MotorFrame f, float dt)
        {
            var r = new MotorStep();
            if (!(dt > 0)) return r;
            if (!Finite(velocity)) velocity = Vector3.zero;

            Countdown(ref coyote, dt);
            Countdown(ref jumpBuf, dt);
            Countdown(ref lockout, dt);
            Countdown(ref knock, dt);
            Countdown(ref invuln, dt);
            RechargeDash(dt);
            if (airJumpsLeft > t.airJumps) airJumpsLeft = Mathf.Max(0, t.airJumps);

            // 输入
            var wish = f.Locked(MotorLock.Move) ? Vector3.zero : Flat(input.wish);
            float wishMag = Mathf.Min(1, wish.magnitude);
            bool hasInput = wishMag > 1e-3f;
            var wishDir = hasInput ? wish.normalized : Vector3.zero;
            bool jumpPressed = input.jumpPressed && !f.Locked(MotorLock.Jump);
            if (jumpPressed) jumpBuf = t.jumpBuffer;
            float maxSpeed = Mathf.Max(0, t.walkSpeed * f.speedMult);
            // 帧初站在地上：决定这一帧用地面还是空中手感（与 Three.js 同：起跳那一帧仍按地面算）
            bool onG = grounded && !forceAirborne;

            bool lunging = lungeLeft > 0, hard = lunging && !lungeSoft;
            float lungeStep = hard ? Mathf.Min(dt, lungeLeft) : 0;

            // 冲刺开始（硬突进期间不响应；冲刺结束后有 0.06 s 锁定）
            if (!hard && input.dashPressed && !f.Locked(MotorLock.Dash) && dashCharge >= 1 && !dashing && lockout <= 0)
            {
                if (lunging)
                {
                    lungeLeft = 0; // 冲刺打断软突进（不施加出口速度）
                    lunging = false;
                    r.events |= MotorEvents.LungeEnded;
                }
                var face = Flat(input.facing);
                StartDash(hasInput ? wishDir : face.sqrMagnitude > 1e-6f ? face.normalized : Vector3.forward);
                r.events |= MotorEvents.Dashed;
            }

            // 先判定这一帧能不能起跳：跳跃打断冲刺时，这一帧就按冲刺余速走，不再按冲刺速度算位移
            bool groundJump = !hard && jumpBuf > 0 && (onG || coyote > 0);
            bool airJump = !hard && !groundJump && jumpPressed && airJumpsLeft > 0;
            bool dashJump = false;
            if ((groundJump || airJump) && dashing)
            {
                EndDash();
                dashJump = true;
                r.events |= MotorEvents.DashEnded;
            }

            // 水平
            var vh = Flat(velocity);
            Vector3 dh;
            if (hard)
            {
                vh = lungeDir * lungeSpeed;
                dh = vh * lungeStep;
            }
            else if (dashing)
            {
                // 冲刺按帧内剩余时间精确结算：最后一帧前一段按冲刺速度、后一段按出口速度，总位移与帧率无关
                float inDash = Mathf.Min(dt, dashLeft);
                dashLeft -= dt;
                vh = dashDir * t.dashSpeed;
                dh = vh * inDash;
                if (dashLeft <= 0)
                {
                    // 剩下的那一小段按出口速度、照常加速 / 刹车
                    EndDash();
                    float rest = dt - inDash;
                    var exit = Flat(velocity);
                    vh = rest > 0 ? ApplyHorizontal(exit, wishDir, wishMag, maxSpeed, onG, knock > 0, f.airAccel, t, rest) : exit;
                    dh += (exit + vh) * (0.5f * rest);
                    r.events |= MotorEvents.DashEnded;
                }
            }
            else if (dashJump)
            {
                // 冲刺跳：这一帧完整保留冲刺出口速度（不先吃一帧地面刹车），起跳后空中只按 3 m/s² 回落
                dh = vh * dt;
            }
            else
            {
                var vh0 = vh;
                vh = ApplyHorizontal(vh, wishDir, wishMag, maxSpeed, onG, knock > 0, f.airAccel, t, dt);
                if (lunging)
                {
                    // 软突进：沿方向的速度不低于突进速度（已经更快时不变），侧向保留
                    float along = Vector3.Dot(vh, lungeDir);
                    if (along < lungeSpeed) vh += lungeDir * (lungeSpeed - along);
                }
                dh = (vh0 + vh) * (0.5f * dt);
            }
            velocity.x = vh.x;
            velocity.z = vh.z;

            // 起跳
            bool jumped = false;
            if (groundJump)
            {
                DoJump(false, hasInput, wishDir, maxSpeed);
                jumped = true;
                r.events |= MotorEvents.Jumped;
            }
            else if (airJump)
            {
                if (DoJump(true, hasInput, wishDir, maxSpeed)) dh = Flat(velocity) * dt; // 转向后这一帧就按新方向走
                jumped = true;
                r.events |= MotorEvents.AirJumped;
            }

            // 竖直（梯形积分）
            float vy0 = velocity.y, dy;
            if (hard)
            {
                velocity.y = 0;
                dy = 0;
            }
            else if (dashing)
            {
                // 冲刺期间不下坠：上升照常按重力减速，下落被托住（冲过 3–4 m 的缺口，但借冲刺爬不了更高）
                float g = t.gravity * f.gravityScale;
                float vy1 = vy0 > 0 ? Mathf.Max(0, vy0 - g * dt) : 0;
                dy = vy0 > 0 ? (vy0 + vy1) * 0.5f * dt : 0;
                velocity.y = vy1;
            }
            else
            {
                float g = t.gravity * f.gravityScale, cap = f.maxFallSpeed;
                float vy1;
                if (vy0 >= -cap) vy1 = Mathf.Max(-cap, vy0 - g * dt);
                else vy1 = f.fallBrake > 0 ? Mathf.Lerp(vy0, -cap, 1 - Mathf.Exp(-f.fallBrake * dt)) : -cap;
                velocity.y = vy1;
                dy = (vy0 + vy1) * 0.5f * dt;
            }

            // 站在地上：往下贴一点（只算位移），移动后离了地由调用方吸附
            bool stick = onG && !jumped && velocity.y <= 0;
            if (stick) dy = Mathf.Min(dy, -t.groundStick * dt);
            r.snap = stick;

            // 陡坡：去掉压进坡面的速度分量，重力的切向分量照常加速——沿坡滑下，不能靠走硬爬上去
            if (steep && !jumped && !hard)
            {
                float into = Vector3.Dot(velocity, groundNormal);
                if (into < 0) velocity -= groundNormal * into;
            }

            preMoveVy = velocity.y;
            r.delta = new Vector3(dh.x, dy, dh.z);
            if (!Finite(r.delta)) r.delta = Vector3.zero;
            return r;
        }

        /// <summary>移动之后：落地 / 撞顶 / 撞墙 / 突进结束。返回这一步新发生的事（Landed / LungeEnded），landFall = 落地时的下落速度</summary>
        public MotorEvents AfterMove(in MotorFeedback fb, float dt, out float landFall)
        {
            var ev = MotorEvents.None;
            landFall = 0;
            bool was = grounded;
            touching = fb.touching;
            steep = fb.touching && fb.steep;
            grounded = fb.touching && !fb.steep;
            groundNormal = fb.touching && fb.groundNormal.sqrMagnitude > 1e-6f ? fb.groundNormal.normalized : Vector3.up;
            forceAirborne = false;
            if (grounded && velocity.y < 0) velocity.y = 0;
            if (fb.hitCeiling && velocity.y > 0) velocity.y = 0;

            // 撞墙：没走完预定的水平位移时，去掉指向墙内的速度（冲刺余速不一直顶在墙上，斜着撞墙沿墙滑开）。
            // 只在确实被挡住时处理：上台阶时控制器也会报侧面碰撞，但位移走满了，不能把速度吃掉
            var want = Flat(fb.intended);
            var got = Flat(fb.actual);
            bool blocked = fb.wallNormal.sqrMagnitude > 1e-6f && want.sqrMagnitude > 1e-8f && got.magnitude < want.magnitude - 1e-3f;
            if (blocked)
            {
                var n = Flat(fb.wallNormal);
                if (n.sqrMagnitude > 1e-6f)
                {
                    n.Normalize();
                    float vn = Vector3.Dot(Flat(velocity), n);
                    if (vn < 0) velocity -= n * vn;
                }
            }

            if (lungeLeft > 0)
            {
                float step = lungeSoft ? dt : Mathf.Min(dt, lungeLeft);
                float prog = Vector3.Dot(got, lungeDir);
                lungeLeft -= dt;
                if (lungeLeft <= 0 || (blocked && prog < LungeBlockFrac * lungeSpeed * step))
                {
                    EndLunge();
                    ev |= MotorEvents.LungeEnded;
                }
            }

            if (grounded)
            {
                coyote = t.coyoteTime;
                airJumpsLeft = Mathf.Max(0, t.airJumps);
                if (!was)
                {
                    landFall = Mathf.Max(0, -preMoveVy);
                    if (landFall >= LandEventSpeed) ev |= MotorEvents.Landed;
                }
            }
            return ev;
        }

        // ───────────── 外部操作 ─────────────

        /// <summary>叠加速度冲量（击退 / 爆炸掀开）。冲刺中水平部分会被冲刺覆盖（等于闪开）；硬突进忽略外力，软突进被打断</summary>
        public void AddImpulse(Vector3 v)
        {
            if (!Finite(v)) return;
            if (lungeLeft > 0)
            {
                if (!lungeSoft) return;
                lungeLeft = 0;
            }
            velocity += v;
            if (v.y > 0.5f) Airborne();
            if (v.x * v.x + v.z * v.z > 9) knock = t.knockbackTime;
        }

        /// <summary>抛射：结束冲刺 / 突进，速度直接设成 v（起跳台、裂地重击起跳、被首领掀飞）。超出走路速度的部分在空中按 3 m/s² 慢慢回落</summary>
        public void Launch(Vector3 v)
        {
            if (!Finite(v)) return;
            if (dashing)
            {
                dashing = false;
                dashLeft = 0;
                lockout = t.dashLockout;
            }
            lungeLeft = 0;
            velocity = v;
            if (v.y > 0.5f) Airborne();
        }

        /// <summary>立即结束冲刺（保留冲刺出口速度）；不在冲刺中无效果</summary>
        public void CancelDash() => EndDash();

        /// <summary>
        /// 受控突进：沿水平方向 dir 以 speed 移动 time 秒。iframes &gt; 0 为硬突进（匀速、悬停、无视输入与外力，同时给这么久的无敌）；
        /// 否则为软突进（正常移动 / 跳跃 / 重力，只把沿 dir 的速度抬到 speed）。结束时水平速度 = dir × exitSpeed（软突进只回落到 max(出口, 开始时的沿向速度)）。
        /// </summary>
        public bool Lunge(Vector3 dir, float speed, float time, float iframes = 0, float exitSpeed = 0)
        {
            dir = Flat(dir);
            if (!(speed > 0) || !(time > 0) || !float.IsFinite(speed) || !float.IsFinite(time) || dir.sqrMagnitude < 1e-8f) return false;
            EndDash();
            lungeDir = dir.normalized;
            lungeLeft = time;
            lungeSpeed = speed;
            lungeExit = exitSpeed > 0 && float.IsFinite(exitSpeed) ? exitSpeed : 0;
            lungeSoft = !(iframes > 0);
            lungeEntryAlong = Vector3.Dot(Flat(velocity), lungeDir);
            if (iframes > 0) invuln = Mathf.Max(invuln, iframes);
            return true;
        }

        public void CancelLunge()
        {
            if (lungeLeft > 0) EndLunge();
        }

        /// <summary>传送后：清空速度、冲刺、突进、跳跃缓冲、击退</summary>
        public void ResetMotion(bool onGround)
        {
            velocity = Vector3.zero;
            dashing = false;
            dashLeft = 0;
            lungeLeft = 0;
            jumpBuf = 0;
            knock = 0;
            forceAirborne = false;
            grounded = touching = onGround;
            steep = false;
            groundNormal = Vector3.up;
            coyote = onGround ? t.coyoteTime : 0;
            if (onGround) airJumpsLeft = Mathf.Max(0, t.airJumps);
            preMoveVy = 0;
        }

        // ───────────── 规则 ─────────────

        /// <summary>
        /// 水平速度（Three.js applyHorizontal）：有输入时朝 输入 × 目标速度 以加速度逼近（地面 78 / 空中 airAccel），无输入时地面刹车 60、空中阻力 1.2；
        /// 超速时目标速度按地面 24 / 空中 3 m/s² 回落，所以冲刺、击飞的余速不会被一帧夹掉。被击退期间地面加速度降到 12。
        /// </summary>
        public static Vector3 ApplyHorizontal(Vector3 vh, Vector3 wishDir, float wishMag, float maxSpeed, bool onGround, bool knockback, float airAccel,
            in MotorTuning t, float dt)
        {
            Vector3 target;
            float rate;
            if (wishMag > 1e-3f)
            {
                float speed = vh.magnitude, cap = maxSpeed * Mathf.Min(1, wishMag);
                float wishSpeed = speed > cap ? Mathf.Max(cap, speed - (onGround ? t.overspeedGround : t.overspeedAir) * dt) : cap;
                target = wishDir * wishSpeed;
                rate = onGround ? t.groundAccel : airAccel;
            }
            else
            {
                target = Vector3.zero;
                rate = onGround ? t.groundFriction : t.airDrag;
            }
            if (onGround && knockback) rate = Mathf.Min(rate, t.knockbackFriction);
            return Vector3.MoveTowards(vh, target, rate * dt);
        }

        bool DoJump(bool air, bool hasInput, Vector3 wishDir, float maxSpeed)
        {
            float jv = Mathf.Max(0, t.jumpVelocity);
            velocity.y = air ? jv * t.airJumpMult : jv;
            jumpBuf = 0;
            coyote = 0;
            grounded = touching = false;
            if (!air) return false;
            airJumpsLeft--;
            if (!hasInput) return false;
            // 二段跳可以改变方向：速度至少是走路速度（或当前速度的 90%），向输入方向转 65%
            var vh = Flat(velocity);
            float sp = Mathf.Max(maxSpeed, vh.magnitude * 0.9f);
            vh = Vector3.Lerp(vh, wishDir * sp, t.airJumpRedirect);
            velocity.x = vh.x;
            velocity.z = vh.z;
            return true;
        }

        void StartDash(Vector3 dir)
        {
            dashCharge -= 1;
            dashDir = dir;
            dashing = true;
            dashLeft = t.dashTime;
            invuln = Mathf.Max(invuln, t.dashIFrames);
        }

        void EndDash()
        {
            if (!dashing) return;
            dashing = false;
            dashLeft = 0;
            lockout = t.dashLockout;
            var keep = dashDir * (t.dashSpeed * t.dashExitKeep);
            velocity.x = keep.x;
            velocity.z = keep.z;
        }

        void EndLunge()
        {
            lungeLeft = 0;
            var vh = Flat(velocity);
            if (lungeSoft)
            {
                float along = Vector3.Dot(vh, lungeDir), cap = Mathf.Max(lungeExit, lungeEntryAlong);
                if (along > cap) vh -= lungeDir * (along - cap);
            }
            else vh = lungeDir * lungeExit;
            velocity.x = vh.x;
            velocity.z = vh.z;
        }

        void RechargeDash(float dt)
        {
            int max = Mathf.Max(1, t.dashCharges);
            if (dashCharge > max) dashCharge = max;
            if (dashCharge < max) dashCharge = Mathf.Min(max, dashCharge + dt / Mathf.Max(0.2f, t.dashCooldown));
        }

        void Airborne()
        {
            grounded = touching = false;
            forceAirborne = true;
            coyote = 0;
        }

        static void Countdown(ref float timer, float dt)
        {
            if (timer > 0) timer = Mathf.Max(0, timer - dt);
        }

        public static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
