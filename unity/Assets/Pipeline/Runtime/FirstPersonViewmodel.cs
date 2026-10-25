using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称枪模的姿态（W4；同 Three.js 版 src/weapons/Viewmodel.ts 的 update，幅度沿用它，跟随改成弹簧阻尼）。挂在 rig 上（相机下，枪模是子物体，枪管朝 −Z，所以 rig 绕 Y 转 180°）。
    /// 每帧（LateUpdate）叠加，内部按 Three.js 相机空间约定算（x 右、y 上、z 朝后；rx + 枪口上抬、ry + 枪口左摆、rz + 右侧上翻），最后换成 Unity：
    ///   · 腰射 ↔ 开镜：<see cref="hipOffset"/> → <see cref="aimOffset"/>，按开镜程度的 smoothstep 混合；
    ///   · 呼吸、行走摆动（相位按水平速度累计，横摆 / 下沉 / 横滚，开镜收到 15%）；
    ///   · 鼠标滞后：转视角时枪往反方向拖、松手后带一点回弹（弹簧 ω 14 / ζ 0.62，按枪重放慢）；鼠标速度换成 60 帧当量，帧率不影响幅度；
    ///   · 侧倾（横移时往移动方向歪）、前后滞后、竖直滞后（起跳往下拖、下落往上飘）；
    ///   · 落地：按下落速度给竖直弹簧一个向下的冲量（ζ 0.42，压下去再弹一下）；起跳轻轻往上一抬；
    ///   · 冲刺姿态（往右下压、枪口低、右侧下翻）、滞空姿态（略抬）；
    ///   · 后坐：<see cref="Kick"/> 每发叠加、上限单发 2.4 倍、指数回位，再过一个欠阻尼弹簧显示（回位末尾有一点回弹，打击感）；带一点随机横滚；
    ///   · 持续开火颤动（光束 / 机炮 / 蓄力，<see cref="firing"/> + <see cref="jitter"/>）、空仓抖动（<see cref="DryKick"/>）；
    ///   · 换弹姿态：整匣换弹按包络（进 0–15%、出 82–100%）叠 <see cref="reloadTiltRot"/> / <see cref="reloadTiltPos"/>；弹匣入位那一刻（<see cref="seatAt"/>）枪身一顿；
    ///     逐发装填时整体左倾、每压一发（<see cref="ShellBump"/>）往下一磕；
    ///   · 切枪收放：<see cref="lower"/> 下沉 + 枪口下压。
    /// 输入：武器（Spiritfire.Game 的 WeaponController）每帧写 <see cref="aim"/> / <see cref="lower"/> / <see cref="reloading"/> 等字段；
    /// 移动读同一玩家身上的 <see cref="PlayerMotor"/>（展示场景没有 motor 时按相机位移估速度）。
    /// </summary>
    [DefaultExecutionOrder(50)]
    public sealed class FirstPersonViewmodel : MonoBehaviour
    {
        public Vector3 hipOffset = new(0.224f, -0.19f, 0.42f);
        /// <summary>开镜位置（相机局部坐标）；0 向量 = 不支持开镜混合</summary>
        public Vector3 aimOffset;
        /// <summary>鼠标滞后系数（Three.js 0.00042 / 像素）</summary>
        public float swayAmount = 0.00042f;
        /// <summary>枪重（1 = 冲锋枪）、晃动倍率、摆动倍率（<c>HandlingProfile</c> 写入）</summary>
        public float weight = 1f, swayScale = 1f, bobScale = 1f;
        /// <summary>换弹姿态（Three.js 相机空间：x 抬枪口 / y 左摆 / z 右侧上翻，弧度；位置 x 右 y 上 z 朝后，米）</summary>
        public Vector3 reloadTiltRot, reloadTiltPos;
        /// <summary>逐发装填的整体姿态</summary>
        public Vector3 shellTiltRot = new(0.1f, 0, -0.38f), shellTiltPos = new(-0.015f, 0.015f, 0);
        /// <summary>整匣换弹进度到这里（弹匣入位）枪身一顿</summary>
        public float seatAt = 0.8f;

        /// <summary>开镜程度 0–1（武器每帧写入）</summary>
        [System.NonSerialized] public float aim;
        /// <summary>切枪下沉程度 0–1（武器每帧写入）</summary>
        [System.NonSerialized] public float lower;
        /// <summary>换弹中、是不是逐发装填、进度（整匣 = 整体进度；逐发 = 当前这一发）</summary>
        [System.NonSerialized] public bool reloading, shellReload;
        [System.NonSerialized] public float reloadProgress;
        /// <summary>持续开火（光束 / 机炮 / 蓄力中）与颤动幅度（米）</summary>
        [System.NonSerialized] public bool firing;
        [System.NonSerialized] public float jitter = 0.003f;

        // Three.js 常数
        const float BobAmp = 0.011f, BobRoll = 0.018f, Breath = 0.0032f, SwayClampX = 0.05f, SwayClampY = 0.04f;
        const float RollPerSpeed = 0.009f, RollClamp = 0.07f, FwdPerSpeed = 0.0022f, FwdClamp = 0.02f, VyPerSpeed = 0.0022f, VyClamp = 0.03f;
        const float LandPerSpeed = 0.0035f, LandMax = 0.05f, JumpLift = 0.012f;
        const float KickCap = 2.4f;
        const float SubStep = 1f / 240f;

        PlayerMotor motor;
        Vector3 lastCamPos;
        float bobPhase, move, dashT, airT, shellT, reloadT, shellBump, prevProgress;
        // 弹簧：值 + 速度
        Vector2 sway, swayVel;
        float roll, rollVel, fwd, fwdVel, vy, vyVel, land, landVel;
        float kickZ, kickRot, kickRoll, shownZ, shownZVel, shownRot, shownRotVel, shownRoll, shownRollVel;
        Vector3 jitterNow;

        /// <summary>现在的落地下沉量（米，测试 / 调试读）</summary>
        public float LandOffset => land;
        /// <summary>现在显示的后坐（向后米数、枪口上抬弧度）</summary>
        public float ShownKickBack => shownZ;
        public float ShownKickRot => shownRot;

        void OnEnable()
        {
            lastCamPos = transform.parent ? transform.parent.position : Vector3.zero;
            if (!motor) motor = GetComponentInParent<PlayerMotor>();
            if (motor)
            {
                motor.Landed += OnLanded;
                motor.Jumped += OnJumped;
            }
        }

        void OnDisable()
        {
            if (motor)
            {
                motor.Landed -= OnLanded;
                motor.Jumped -= OnJumped;
            }
            // 收起来的枪下次掏出时不带着上一把的残余动作
            kickZ = kickRot = kickRoll = 0;
            shownZ = shownRot = shownRoll = shownZVel = shownRotVel = shownRollVel = 0;
            land = landVel = 0;
            shellBump = 0;
            reloadT = shellT = 0;
        }

        void OnLanded(float fallSpeed) => Land(fallSpeed);
        void OnJumped(bool air) => landVel -= JumpLift * Omega(11f) * 1.6f;

        /// <summary>落地冲量（下落速度 m/s）：压下 ≈ min(5 cm, 速度 × 0.0035) × 枪重^0.3，之后回弹</summary>
        public void Land(float fallSpeed)
        {
            float d = Mathf.Min(LandMax, Mathf.Max(0, fallSpeed) * LandPerSpeed) * Mathf.Pow(Mathf.Max(0.3f, weight), 0.3f);
            landVel += d * Omega(11f) * 1.6f;
        }

        /// <summary>
        /// 开枪后坐：back 米（向后），rot 弧度（枪口上抬），与 Three.js 武器表的 kick.back / kick.rot 同义。
        /// 同 Three.js 版 Viewmodel.onShot：每发直接叠加、上限为单发的 2.4 倍（连射不会越叠越高），另加一点随机横滚；之后指数回位
        /// </summary>
        public void Kick(float back, float rot)
        {
            kickZ = Mathf.Min(kickZ + back, back * KickCap);
            kickRot = Mathf.Min(kickRot + rot, rot * KickCap);
            kickRoll += (Random.value - 0.5f) * rot * 0.4f;
        }

        /// <summary>空仓扣扳机：枪口轻轻一挑 + 一点横滚抖动</summary>
        public void DryKick()
        {
            kickRot += 0.02f;
            kickRoll += (Random.value - 0.5f) * 0.03f;
        }

        /// <summary>逐发装填压进一发：枪身往下一磕</summary>
        public void ShellBump() => shellBump = 1;

        /// <summary>弹匣入位的一顿（整匣换弹到 <see cref="seatAt"/> 时自动调；外部动画事件也可以调）</summary>
        public void Seat()
        {
            kickRot -= 0.05f;
            landVel += 0.01f * Omega(11f) * 1.6f;
        }

        float Omega(float w) => w / Mathf.Sqrt(Mathf.Max(0.3f, weight));

        static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }

        static float Damp(float a, float b, float lambda, float dt) => Mathf.Lerp(a, b, 1 - Mathf.Exp(-lambda * dt));

        /// <summary>弹簧一步（半隐式欧拉，子步长 1/240 s，编辑器卡顿时也不发散）</summary>
        static void Spring(ref float x, ref float v, float target, float omega, float zeta, float dt)
        {
            float k = omega * omega, c = 2 * zeta * omega;
            for (float t = dt; t > 1e-6f; t -= SubStep)
            {
                float h = Mathf.Min(SubStep, t);
                v += (k * (target - x) - c * v) * h;
                x += v * h;
            }
        }

        void LateUpdate()
        {
            var cam = transform.parent;
            if (!cam) return;
            float dt = Mathf.Clamp(Time.deltaTime, 1e-4f, 0.1f);

            // ── 速度（玩家 motor；展示场景按相机位移估）──
            Vector3 v;
            bool grounded = true, dashing = false;
            if (motor)
            {
                v = motor.Velocity;
                grounded = motor.Grounded;
                dashing = motor.Dashing;
            }
            else v = (cam.position - lastCamPos) / dt;
            lastCamPos = cam.position;
            var flat = new Vector3(v.x, 0, v.z);
            float hs = flat.magnitude;
            var right = cam.right;
            right.y = 0;
            right = right.sqrMagnitude > 1e-6f ? right.normalized : Vector3.right;
            var fwdDir = new Vector3(-right.z, 0, right.x);
            float lateral = Vector3.Dot(flat, right), forward = Vector3.Dot(flat, fwdDir);

            float a = Smooth(aim);
            float aimK = 1 - 0.85f * a, swayK = 1 - 0.6f * a;

            // ── 行走摆动 / 呼吸 ──
            move = Damp(move, grounded ? Mathf.Clamp01(hs / 7.5f) : 0, 10, dt);
            if (grounded) bobPhase += dt * hs * 1.55f;
            float bob = bobScale / Mathf.Sqrt(Mathf.Max(0.3f, weight));
            float bobX = Mathf.Sin(bobPhase) * BobAmp * move * aimK * bob;
            float bobY = -Mathf.Abs(Mathf.Cos(bobPhase)) * BobAmp * move * aimK * bob;
            float bobRoll = Mathf.Sin(bobPhase) * BobRoll * move * aimK * bob;
            float breath = Mathf.Sin(Time.time * 1.6f) * Breath * aimK;

            // ── 鼠标滞后（弹簧，带回弹）：鼠标速度换成 60 帧当量 ──
            var d = Application.isPlaying ? GameInput.LookDelta : Vector2.zero;
            float perFrame = 1f / (60f * dt);
            float k = swayAmount * swayScale;
            var swayTarget = new Vector2(Mathf.Clamp(-d.x * perFrame * k, -SwayClampX, SwayClampX),
                Mathf.Clamp(-d.y * perFrame * k, -SwayClampY, SwayClampY));
            Spring(ref sway.x, ref swayVel.x, swayTarget.x, Omega(14f), 0.62f, dt);
            Spring(ref sway.y, ref swayVel.y, swayTarget.y, Omega(14f), 0.62f, dt);

            // ── 侧倾 / 前后 / 竖直滞后、落地 ──
            Spring(ref roll, ref rollVel, Mathf.Clamp(-lateral * RollPerSpeed, -RollClamp, RollClamp), Omega(9f), 0.8f, dt);
            Spring(ref fwd, ref fwdVel, Mathf.Clamp(forward * FwdPerSpeed, -FwdClamp, FwdClamp), Omega(8f), 0.75f, dt);
            Spring(ref vy, ref vyVel, Mathf.Clamp(-v.y * VyPerSpeed, -VyClamp, VyClamp), Omega(8f), 0.75f, dt);
            Spring(ref land, ref landVel, 0, Omega(11f), 0.42f, dt);
            dashT = Damp(dashT, dashing ? 1 : 0, 14, dt);
            airT = Damp(airT, grounded ? 0 : 1, 7, dt);

            // ── 后坐：指数回位（枪越重回得越慢），欠阻尼弹簧显示 ──
            float rec = 1 / Mathf.Pow(Mathf.Max(0.3f, weight), 0.3f);
            kickZ *= Mathf.Exp(-15f * rec * dt);
            kickRot *= Mathf.Exp(-12f * rec * dt);
            kickRoll *= Mathf.Exp(-12f * rec * dt);
            Spring(ref shownZ, ref shownZVel, kickZ, 42f, 0.55f, dt);
            Spring(ref shownRot, ref shownRotVel, kickRot, 40f, 0.55f, dt);
            Spring(ref shownRoll, ref shownRollVel, kickRoll, 36f, 0.6f, dt);
            shellBump = Damp(shellBump, 0, 10, dt);

            // ── 换弹 ──
            bool full = reloading && !shellReload;
            float rp = full ? reloadProgress : 0;
            reloadT = Damp(reloadT, full ? Envelope(rp) : 0, 18, dt);
            shellT = Damp(shellT, reloading && shellReload ? 1 : 0, 10, dt);
            if (full && prevProgress < seatAt && rp >= seatAt) Seat();
            prevProgress = rp;

            // ── 开火颤动 ──
            jitterNow = firing ? new Vector3(Random.value - 0.5f, Random.value - 0.5f, 0) * jitter : Vector3.Lerp(jitterNow, Vector3.zero, 1 - Mathf.Exp(-30 * dt));

            // ── 组合（Three.js 相机空间约定）──
            float lowE = Smooth(lower);
            float x = bobX + sway.x * 0.5f * swayK + dashT * 0.015f + jitterNow.x;
            float y = bobY + breath + sway.y * 0.5f * swayK + vy - land - lowE * 0.3f + shownZ * 0.15f - dashT * 0.02f + airT * 0.008f + jitterNow.y;
            float z = shownZ + fwd + lowE * 0.05f;
            float rx = shownRot + breath * 1.2f + sway.y * swayK - lowE * 0.9f - dashT * 0.12f + airT * 0.05f;
            float ry = -sway.x * 1.3f * swayK;
            float rz = roll * swayK + bobRoll + shownRoll - dashT * 0.3f;

            x += reloadTiltPos.x * reloadT + shellTiltPos.x * shellT;
            y += reloadTiltPos.y * reloadT + shellTiltPos.y * shellT - shellBump * 0.012f;
            z += reloadTiltPos.z * reloadT + shellTiltPos.z * shellT;
            rx += reloadTiltRot.x * reloadT + shellTiltRot.x * shellT - shellBump * 0.06f;
            ry += reloadTiltRot.y * reloadT + shellTiltRot.y * shellT;
            rz += reloadTiltRot.z * reloadT + shellTiltRot.z * shellT;

            var basePos = aimOffset != Vector3.zero ? Vector3.Lerp(hipOffset, aimOffset, a) : hipOffset;
            transform.localPosition = basePos + new Vector3(x, y, -z);
            // Unity 相机空间：绕 +X 正转 = 枪口向下、绕 +Y 正转 = 枪口向右、绕 +Z 正转 = 右侧上翻；枪模绕 Y 转 180°（枪管朝 −Z）
            transform.localRotation = Quaternion.AngleAxis(-rx * Mathf.Rad2Deg, Vector3.right) *
                                      Quaternion.AngleAxis(-ry * Mathf.Rad2Deg, Vector3.up) *
                                      Quaternion.AngleAxis(rz * Mathf.Rad2Deg, Vector3.forward) *
                                      Quaternion.Euler(0, 180, 0);
        }

        /// <summary>换弹姿态包络（同 TS reloadEnvelope）：进 0–15%，保持，82–100% 退出</summary>
        public static float Envelope(float p) => Smooth(p / 0.15f) * (1 - Smooth((p - 0.82f) / 0.18f));
    }
}
