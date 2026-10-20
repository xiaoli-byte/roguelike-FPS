using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称镜头手感（Three.js 版 src/player/CameraRig.ts；docs/unity-parity.md 3.13 / F3）：<b>渲染相机姿态与 FOV 的唯一写入方</b>。
    /// 层级：Player（PlayerMotor 写偏航）→ Eye（= motor.eye，PlayerMotor 写俯仰；开枪、射线、敌人视线都用它，<b>不抖</b>）
    ///   → Head（主相机，这里每帧写局部位姿）→ 枪模相机 / 第一人称 rig。PlayerFactory 直接搭成这样；
    ///   旧场景里烘好的玩家（主相机自己就是 motor.eye）在 Awake 里插入 Eye 节点，主相机降为 Head。
    /// 每帧（LateUpdate）叠加：
    ///   · 行走晃动：相位与 PlayerMotor 的脚步同一个累计规则（每 2.05 m 一步，踩下去正好在最低点，脚步声来时再对齐一次）；
    ///     竖直 4.5 cm、侧摆 3.2 cm、横滚 0.34°，按 速度 / 移速 加权，开镜时收到 35%；
    ///   · 侧移倾斜：横向速度 / 移速 × 0.8°（空中 × 0.6），往移动方向歪；
    ///   · 弹簧（K 140 / C 17，冲量后约 0.09 s 到峰再回弹）：落地下沉（下落速度 × 0.28 的向下初速度，俯仰跟着点头 0.35 rad/m）、
    ///     受击冲击（<see cref="Impact"/>：按伤害来向——头被打向远离来源的一侧、正面来的往上仰、背后来的往前点，再被推开一点）、<see cref="Punch"/>、开枪的向后一顿；
    ///   · 震屏：<see cref="CameraShake"/> 的强度 × 设置「震屏强度」，6 轴 Perlin 噪声（位移 x / y / z + 俯仰 / 偏航 / 横滚）；
    ///   · 阵亡倒地：0.8 s（真实时间，不随阵亡慢动作变慢）下沉到离地约 0.45 m（先往下探地面）、低头 11°、向左歪 29°；复活时 0.35 s 回来。
    /// FOV = 设置「视野」（默认 80°）+ 开镜层（<see cref="WeaponController.FovKick"/>，负数 = 放大）+ 冲刺 6° / 高速（超过移速 8% 起每 m/s 0.55°，最多 6°），
    /// 冲刺 + 高速合计 ≤ 8°，开镜时按放大程度压掉；整体 λ 16 平滑。
    /// 震屏、冲击只改渲染：准星（屏幕中心）可能暂时偏离真实弹道零点几度，所以俯仰 / 偏航保持克制；噪声零均值，不会让弹道系统性偏。
    /// 武器的后坐抬枪仍走 PlayerMotor（会回正、手感轻），这里只接开枪的震屏和向后一顿（<see cref="FireKick"/>，WeaponController 调）。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-40)]
    public sealed class CameraFeel : MonoBehaviour
    {
        /// <summary>当前玩家的镜头（没有玩家时为 null）</summary>
        public static CameraFeel Instance { get; private set; }

        /// <summary>渲染相机（Head）。缺省 = WeaponController.eye，再没有就取子物体里的第一台相机</summary>
        public Camera cam;

        // ── Three.js CameraRig 常数（角度换成度；Unity 俯仰 + = 低头，横滚 + = 向左歪，与 Three.js 横滚同向、俯仰反向）──
        const float StepLength = 2.05f;
        const float BobVertical = 0.045f, BobSide = 0.032f, BobRoll = 0.006f * Mathf.Rad2Deg, StrafeRoll = 0.014f * Mathf.Rad2Deg;
        const float SpringK = 140f, SpringC = 17f;
        /// <summary>K 140 / C 17 的弹簧：给初速度 v，约 0.093 s 后到峰，峰值 ≈ v × 0.0382</summary>
        const float PeakPerVelocity = 0.0382f;
        /// <summary>落地：下落速度（≤ 22 m/s）× 0.28 = 向下初速度；俯仰跟着下沉点头（0.35 rad / m）</summary>
        const float LandImpulse = 0.28f, DipPitch = 0.35f * Mathf.Rad2Deg;
        /// <summary>受击（强度 1）：横滚 1.1 rad/s、俯仰 0.6 rad/s（同 Three.js），再被推开约 2.5 cm</summary>
        const float HurtRoll = 1.1f * Mathf.Rad2Deg, HurtPitch = 0.6f * Mathf.Rad2Deg, HurtPush = 0.025f / PeakPerVelocity;
        /// <summary>开枪：头沿视线向后一顿 = 枪模后坐距离 × 0.25（平移不移动准星）</summary>
        const float FireBack = 0.25f / PeakPerVelocity;
        const float DashFov = 6f, SpeedFovMax = 6f, ExtraFovMax = 8f, AimSuppressKick = 8f, FovLambda = 16f;
        /// <summary>硬突进速度超过这个（m/s）也给一次冲刺 FOV（同 Three.js LUNGE_FAST）</summary>
        const float LungeFovSpeed = 15f;
        const float DeathTime = 0.8f, ReviveTime = 0.35f, DeathDrop = 1.1f, DeathPitch = 0.2f * Mathf.Rad2Deg, DeathRoll = 0.5f * Mathf.Rad2Deg;
        /// <summary>震屏强度 1 时各轴的标称幅度：位移（米）、转角（度）；Perlin 噪声实际多在标称的 ±70% 内</summary>
        static readonly Vector3 ShakePos = new(0.055f, 0.055f, 0.025f), ShakeRot = new(2.0f, 1.6f, 2.4f);
        const float ShakePosFreq = 20f, ShakeRotFreq = 16f, ShakeAmpMax = 1.8f;
        /// <summary>弹簧子步长：编辑器卡顿时 dt 可能到 0.1 s，显式积分会发散</summary>
        const float SpringStep = 1f / 120f;

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Transform eye, head;
        float bobPhase, bobWeight, strafeRoll;
        float dip, dipVel;
        /// <summary>头部平移弹簧（Eye 父物体空间 = 偏航空间，米）</summary>
        Vector3 push, pushVel;
        /// <summary>转角弹簧（度）：x 俯仰（+ 低头）、y 偏航、z 横滚（+ 向左歪）</summary>
        Vector3 punch, punchVel;
        float dashFov, speedFov, fov = float.NaN, baseFov = 80f, shakeSetting = 1f;
        float deathT, deathDrop = DeathDrop, shakeClock;
        bool wasHardLunge, wasDead;
        Vector3 seed;

        /// <summary>现在的 FOV（平滑后、已写进相机）</summary>
        public float Fov => float.IsNaN(fov) ? baseFov : fov;
        /// <summary>渲染节点（主相机）</summary>
        public Transform Head => head;

        /// <summary>取玩家身上的 CameraFeel，没有就挂一个（旧场景烘好的玩家由 WeaponController 在 Awake 里补）</summary>
        public static CameraFeel Ensure(GameObject player)
        {
            if (!player) return null;
            var f = player.GetComponent<CameraFeel>();
            return f ? f : player.AddComponent<CameraFeel>();
        }

        void Awake()
        {
            motor = GetComponent<PlayerMotor>();
            vitals = GetComponent<PlayerVitals>();
            weapons = GetComponent<WeaponController>();
            if (!cam) cam = weapons && weapons.eye ? weapons.eye : GetComponentInChildren<Camera>(true);
            seed = new Vector3(Random.value, Random.value, Random.value) * 100f;
            baseFov = GameSettings.Fov.Value;
            shakeSetting = GameSettings.ScreenShake.Value;
            InsertHead();
        }

        /// <summary>保证 Player → Eye（motor.eye）→ Head（主相机）：主相机自己就是 motor.eye 时在中间插一个 Eye</summary>
        void InsertHead()
        {
            if (!cam || !motor)
            {
                Debug.LogWarning($"[CameraFeel] {name} 上没有相机或 PlayerMotor，镜头手感关闭");
                enabled = false;
                return;
            }
            head = cam.transform;
            if (!motor.eye || motor.eye == head)
            {
                var e = new GameObject("Eye").transform;
                e.SetParent(head.parent, false);
                e.SetLocalPositionAndRotation(head.localPosition, head.localRotation);
                e.gameObject.layer = head.gameObject.layer;
                head.SetParent(e, false);
                head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                motor.eye = e;
            }
            eye = motor.eye;
            if (head.parent != eye)
            {
                Debug.LogWarning($"[CameraFeel] 主相机 {head.name} 不是 motor.eye（{eye.name}）的直接子物体，镜头手感关闭");
                enabled = false;
            }
        }

        void OnEnable()
        {
            Instance = this;
            if (motor)
            {
                motor.Landed += OnLanded;
                motor.Dashed += OnDashed;
                motor.Teleported += OnTeleported;
                motor.Footstep += OnFootstep;
            }
            GameEvents.PlayerHit += OnPlayerHit;
            GameEvents.StageLoaded += OnStageLoaded;
            GameEvents.Reacted += OnReacted;
            GameEvents.EnemyKilled += OnEnemyKilled;
            GameSettings.Changed += OnSetting;
        }

        void OnDisable()
        {
            if (Instance == this) Instance = null;
            if (motor)
            {
                motor.Landed -= OnLanded;
                motor.Dashed -= OnDashed;
                motor.Teleported -= OnTeleported;
                motor.Footstep -= OnFootstep;
            }
            GameEvents.PlayerHit -= OnPlayerHit;
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.Reacted -= OnReacted;
            GameEvents.EnemyKilled -= OnEnemyKilled;
            GameSettings.Changed -= OnSetting;
            if (head) head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
        }

        void OnSetting(SettingDef d)
        {
            if (d == null || d == GameSettings.Fov) baseFov = GameSettings.Fov.Value;
            if (d == null || d == GameSettings.ScreenShake) shakeSetting = GameSettings.ScreenShake.Value;
        }

        // ───────────── 冲击 API ─────────────

        /// <summary>
        /// 镜头冲击（斩击命中、技能落地、首领吼叫…）：给转角弹簧一个冲量，约 0.09 s 后到峰、峰值约为给的度数，然后自然回弹。
        /// pitchDeg + = 往下点头，rollDeg + = 向左歪。只改渲染，不影响瞄准
        /// </summary>
        public void Punch(float pitchDeg, float rollDeg, float yawDeg = 0)
        {
            if (float.IsFinite(pitchDeg)) punchVel.x += pitchDeg / PeakPerVelocity;
            if (float.IsFinite(yawDeg)) punchVel.y += yawDeg / PeakPerVelocity;
            if (float.IsFinite(rollDeg)) punchVel.z += rollDeg / PeakPerVelocity;
        }

        /// <summary>
        /// 来自 from（世界坐标）的冲击，strength 0–1（受伤时 = 伤害 / 生命上限 × 4，至少 0.15）：头被打向远离来源的一侧（横滚约 2.4°）、
        /// 正面来的往上仰（约 1.3°）、背后来的往前点，再被推开约 2.5 cm。from 与玩家重合（没有方向）时随机一侧
        /// </summary>
        public void Impact(Vector3 from, float strength)
        {
            if (!(strength > 0)) return;
            float s = Mathf.Clamp(strength, 0.15f, 1f);
            var to = from - transform.position;
            to.y = 0;
            float side = 0, front = 1;
            bool directed = float.IsFinite(to.x) && float.IsFinite(to.z) && to.sqrMagnitude > 0.01f;
            if (directed)
            {
                to.Normalize();
                side = Vector3.Dot(to, transform.right);
                front = Vector3.Dot(to, transform.forward);
            }
            float dir = Mathf.Abs(side) < 0.15f ? (Random.value < 0.5f ? -1f : 1f) : Mathf.Sign(side);
            punchVel.z += dir * HurtRoll * s;
            punchVel.x += -HurtPitch * s * (front >= -0.3f ? 1f : -0.6f);
            if (directed) pushVel -= transform.InverseTransformDirection(to) * (HurtPush * s);
        }

        /// <summary>开枪的镜头反馈（WeaponController.Feedback 调）：枪的震屏（开镜减半）+ 头沿视线向后一顿（back = 枪模后坐距离，米）</summary>
        public void FireKick(float shake, float shakeTime, float back)
        {
            float aim = weapons ? weapons.AimT : 0;
            if (shake > 0) CameraShake.Add(shake * (1 - 0.5f * aim), shakeTime);
            if (back > 0 && float.IsFinite(back) && eye) pushVel += eye.localRotation * (Vector3.back * (back * FireBack));
        }

        /// <summary>冲刺式的 FOV 冲击（6°，λ 5 收回）：冲刺、硬突进自动给；技能位移也可以调</summary>
        public void DashKick() => dashFov = DashFov;

        /// <summary>传送 / 换关：清掉残留的弹簧与冲刺 / 高速 FOV（不影响震屏和阵亡倒地：托回安全点时特意给的那一震要留着）</summary>
        public void Calm()
        {
            dip = dipVel = 0;
            push = pushVel = punch = punchVel = Vector3.zero;
            dashFov = speedFov = 0;
        }

        // ───────────── 事件 ─────────────

        void OnLanded(float fall)
        {
            if (!float.IsFinite(fall)) return;
            dipVel -= Mathf.Clamp(fall, 0, 22f) * LandImpulse;
            // 重落地（> 14 m/s）再震一下（同 Three.js onLand）
            if (fall > 14f) CameraShake.Add(Mathf.Min(0.5f, (fall - 14f) * 0.04f), 0.18f);
        }

        void OnDashed() => DashKick();

        void OnTeleported()
        {
            Calm();
            // PlayerMotor 传送时脚步累计清零：晃动相位跟着回到「踩下」
            bobPhase = 0;
        }

        /// <summary>脚步声来的时候相位应在 kπ（最低点）：对齐一次，免得冲量 / 修饰器让两边慢慢错开</summary>
        void OnFootstep(float run) => bobPhase = Mathf.Round(bobPhase / Mathf.PI) * Mathf.PI;

        /// <summary>换关：连上一关残留的震屏一起清掉，FOV 直接跳到目标值</summary>
        void OnStageLoaded(StageSpec s)
        {
            Calm();
            CameraShake.Clear();
            fov = float.NaN;
        }

        void OnPlayerHit(in PlayerHitEvent e)
        {
            if (!vitals || !(e.amount > 0)) return;
            float frac = e.amount / Mathf.Max(1, vitals.MaxHealth);
            Impact(e.from, frac * 4f);
            // 重击（一下 ≥ 8% 生命上限）再震一下：比 Three.js 多的一层，挨揍要有分量
            if (frac >= 0.08f) CameraShake.Add(Mathf.Min(0.45f, frac * 1.6f), 0.18f);
        }

        /// <summary>元素反应的震屏（按与玩家的距离衰减，20 m 外没有；连锁出来的减半，同一帧的并成一下）</summary>
        void OnReacted(in ReactionEvent e)
        {
            if (e.hits <= 0) return;
            float s = e.id switch
            {
                Reaction.Thunderfire => 0.3f,
                Reaction.Abyss => 0.26f,
                Reaction.Meltdown => 0.22f,
                _ => 0.16f,
            };
            if (e.depth > 0) s *= 0.5f;
            CameraShake.Quake(e.point, s, 20f, 0.25f);
        }

        /// <summary>首领倒下：一记长震（精英的爆散震屏在 KillResolver 里）</summary>
        void OnEnemyKilled(in KillEvent e)
        {
            if (e.enemy && e.enemy.IsBoss) CameraShake.Add(0.7f, 0.6f);
        }

        // ───────────── 每帧 ─────────────

        void LateUpdate()
        {
            if (!head || !eye || !motor) return;
            float dt = Mathf.Max(0, Time.deltaTime);
            // 倒地按真实时间走（阵亡慢动作 ×0.3 时不会慢吞吞），暂停（时间为 0）时不动
            float realDt = Time.timeScale > 0 ? Mathf.Min(Time.unscaledDeltaTime, 0.1f) : 0;
            bool alive = !vitals || !vitals.Dead;
            float aim = weapons ? weapons.AimT : 0;
            var v = motor.Velocity;
            v.y = 0;
            float speedH = v.magnitude, maxSpeed = Mathf.Max(1, motor.MaxSpeed);
            if (!float.IsFinite(speedH)) speedH = 0;

            // ── 行走晃动：同 PlayerMotor 的脚步累计（站在可走的地面上、不在冲刺）──
            bool onFoot = alive && motor.OnWalkableGround && !motor.Dashing;
            if (onFoot)
            {
                bobPhase += speedH * dt / StepLength * Mathf.PI;
                if (bobPhase > 200 * Mathf.PI) bobPhase -= 200 * Mathf.PI;
            }
            bobWeight = Damp(bobWeight, onFoot && speedH > 0.8f ? Mathf.Clamp01(speedH / maxSpeed) : 0, 10, dt);
            float bw = bobWeight * (1 - 0.65f * aim);
            float bobY = -Mathf.Cos(bobPhase * 2) * 0.5f * BobVertical * bw;
            float swayX = Mathf.Sin(bobPhase) * BobSide * bw;
            float bobRoll = Mathf.Sin(bobPhase) * BobRoll * bw;

            // ── 侧移倾斜：往移动方向歪 ──
            float strafe = Mathf.Clamp(Vector3.Dot(v, transform.right) / maxSpeed, -1, 1);
            strafeRoll = Damp(strafeRoll, alive ? -strafe * StrafeRoll * (motor.Grounded ? 1 : 0.6f) * (1 - 0.5f * aim) : 0, 8, dt);

            // ── 弹簧：落地下沉 / 受击 / 冲击 / 开枪一顿（子步积分）──
            for (float rem = Mathf.Min(dt, 0.1f); rem > 0; rem -= SpringStep)
            {
                float h = Mathf.Min(rem, SpringStep);
                Spring(ref dip, ref dipVel, h);
                Spring(ref push.x, ref pushVel.x, h);
                Spring(ref push.y, ref pushVel.y, h);
                Spring(ref push.z, ref pushVel.z, h);
                Spring(ref punch.x, ref punchVel.x, h);
                Spring(ref punch.y, ref punchVel.y, h);
                Spring(ref punch.z, ref punchVel.z, h);
            }

            // ── 震屏：trauma² × 设置，6 轴噪声 ──
            shakeClock += dt;
            if (shakeClock > 1000f) shakeClock -= 1000f;
            Vector3 shPos = Vector3.zero, shRot = Vector3.zero;
            float amp = Mathf.Min(ShakeAmpMax, CameraShake.Current * Mathf.Max(0, shakeSetting));
            if (amp > 1e-4f)
            {
                float tp = shakeClock * ShakePosFreq, tr = shakeClock * ShakeRotFreq;
                shPos = new Vector3(Noise(seed.x, tp) * ShakePos.x, Noise(seed.y, tp) * ShakePos.y, Noise(seed.z, tp) * ShakePos.z) * amp;
                shRot = new Vector3(Noise(seed.x + 37f, tr) * ShakeRot.x, Noise(seed.y + 37f, tr) * ShakeRot.y, Noise(seed.z + 37f, tr) * ShakeRot.z) * amp;
            }

            // ── 阵亡倒地 ──
            if (!alive)
            {
                if (!wasDead) deathDrop = ProbeDeathDrop();
                deathT = Mathf.Min(1, deathT + realDt / DeathTime);
            }
            else deathT = Mathf.Max(0, deathT - realDt / ReviveTime);
            wasDead = !alive;
            float de = 1 - Mathf.Pow(1 - deathT, 3);
            // 本来就在往下看时少低一点头（别翻过头顶）
            float deathPitch = Mathf.Clamp(80f - motor.Pitch, 0, DeathPitch);

            // ── 写入 Head：偏航空间的平移换到 Eye 局部（Eye 只带俯仰），震屏平移直接在视线空间 ──
            var offset = new Vector3(swayX, bobY + dip - de * deathDrop, 0) + push;
            var pos = Quaternion.Inverse(eye.localRotation) * offset + shPos;
            var rot = new Vector3(
                -dip * DipPitch + punch.x + shRot.x + de * deathPitch,
                punch.y + shRot.y,
                bobRoll + strafeRoll + punch.z + shRot.z + de * DeathRoll);
            if (!Finite(pos) || !Finite(rot))
            {
                Calm();
                CameraShake.Clear();
                pos = rot = Vector3.zero;
            }
            head.SetLocalPositionAndRotation(pos, Quaternion.Euler(rot));

            // ── FOV：设置 + 开镜 + 冲刺 / 高速 ──
            bool hardLunge = motor.Core.HardLunging && motor.Core.LungeSpeed > LungeFovSpeed;
            if (hardLunge && !wasHardLunge) DashKick();
            wasHardLunge = hardLunge;
            dashFov = Damp(dashFov, 0, 5, dt);
            // 冲刺本身已有冲刺 FOV，冲刺中不再叠高速 FOV
            float speedTarget = alive && !motor.Dashing ? Mathf.Clamp((speedH - maxSpeed * 1.08f) * 0.55f, 0, SpeedFovMax) : 0;
            speedFov = Damp(speedFov, speedTarget, 6, dt);
            float kick = weapons ? weapons.FovKick : 0;
            if (!float.IsFinite(kick)) kick = 0;
            // 开镜（kick < 0）时压掉冲刺 / 高速带来的变宽：狙击镜里画面不「呼吸」
            float aimK = kick < 0 ? Mathf.Clamp01(1 + kick / AimSuppressKick) : 1;
            float extra = Mathf.Min(ExtraFovMax, dashFov + speedFov) * aimK;
            float target = Mathf.Clamp((float.IsFinite(baseFov) ? baseFov : 80f) + kick + extra, 20f, 130f);
            fov = float.IsNaN(fov) ? target : Damp(fov, target, FovLambda, dt);
            if (cam && Mathf.Abs(cam.fieldOfView - fov) > 0.005f) cam.fieldOfView = fov;
        }

        /// <summary>阵亡时眼睛往下能落多少：脚下（或身边的坡、箱子）离眼睛不到 1.1 m 时少落一点，头离地至少约 0.45 m</summary>
        float ProbeDeathDrop()
        {
            if (Physics.SphereCast(eye.position, 0.15f, Vector3.down, out var hit, DeathDrop + 0.4f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return Mathf.Clamp(hit.distance - 0.3f, 0, DeathDrop);
            return DeathDrop;
        }

        static void Spring(ref float x, ref float v, float h)
        {
            v += (-x * SpringK - v * SpringC) * h;
            x += v * h;
        }

        static float Damp(float a, float b, float lambda, float dt) => Mathf.Lerp(a, b, 1 - Mathf.Exp(-lambda * dt));

        /// <summary>Perlin 噪声换到 −1..1</summary>
        static float Noise(float s, float t) => (Mathf.PerlinNoise(s, t) - 0.5f) * 2f;

        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
