using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 4-1 领主的死亡演出（chuanzang-combat-v1.md 4.0「死亡演出」、docs/art/ch4-boss-intros.json 每个领主第三段）：领主倒下时由 <see cref="LordBrain"/> 开一段，
    /// 自己一个物体（首领的行为组件那时已停用、物体几秒后回收，演出不跟着它走）。
    ///   · 接管：锁玩家输入（MotorLock.All，每帧重申）、玩家无敌、HUD 隐藏、收枪、上下黑边；开头 slowSeconds 秒 slowScale 倍慢放（TimeScaleArbiter，按真实时间撤销）。
    ///   · show：绕倒下的领主转半圈（看点 = 倒下那一刻的身体中心，避免跟着下沉的模型乱晃）；名字卡「夔 · 平息」cardAt 起；每帧回调 <see cref="LordBrain.DeathTick"/>。
    ///   · land：切到玩家身后的过肩机位（后 3.2 m、上 0.9 m、右 0.9 m）看着领主，landSeconds 秒 smootherstep 推进玩家眼睛——
    ///     <see cref="IntroMath.Land"/> 在 u ≥ 时长时原样返回眼睛的姿态：交还那一帧误差为 0（和登场演出同一条约定）。
    ///   · 交还：解锁输入、HUD 回来、黑边收起、抬枪；死亡演出随时能跳（按住交互键 0.6 s：从当前机位落回）。
    /// 玩家阵亡、物体销毁时立刻把镜头 / 输入 / 时间缩放恢复。
    /// </summary>
    [DefaultExecutionOrder(-35)]
    public sealed class LordCinema : MonoBehaviour
    {
        public const float SkipHoldSeconds = 0.6f, ShoulderBack = 3.2f, ShoulderUp = 0.9f, ShoulderRight = 0.9f, ShoulderFov = 60f;
        const float StowPitch = 55f, StowLift = 0.22f;

        public enum Stage { Show, Land, Outro, Done }

        /// <summary>正在放的死亡演出（没有为 null）</summary>
        public static LordCinema Current { get; private set; }
        /// <summary>本次 Play 里放过几段</summary>
        public static int Played { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Current = null;
            Played = 0;
        }

        LordBrain boss;
        LordDeathSpec spec;
        PlayerMotor motor;
        PlayerVitals vitals;
        CameraFeel feel;
        Camera cam, vmCam;
        Transform head, eye;
        CinematicOverlay overlay;
        IDisposable motorLock;
        TimeScaleArbiter.Handle slow;
        Vector3 center;
        float baseYaw, t, landT, startFov, slowUntil, skipHold, raiseT = -1, stowT, vmLocalPitch;
        bool released, cardShown, vmWasEnabled, inputWas, hasCam, landStarted;
        CamPose landFrom, lastPose;

        public Stage Phase { get; private set; }
        public float Elapsed => t;
        public LordBrain Boss => boss;
        public bool Skipped { get; private set; }
        /// <summary>交还那一帧相机与眼睛的误差（米 / 度 / 度）；还没交还为 NaN</summary>
        public float HandoffMeters { get; private set; } = float.NaN;
        public float HandoffDegrees { get; private set; } = float.NaN;
        public float HandoffFov { get; private set; } = float.NaN;
        /// <summary>落回段单帧最大位移（米）</summary>
        public float LandMaxStep { get; private set; }
        public bool NameCardShown => cardShown;
        public bool Released => released;

        /// <summary>开一段死亡演出（没有玩家镜头时只跑 DeathTick，不接管镜头）</summary>
        public static LordCinema Play(LordBrain boss, LordDeathSpec spec)
        {
            if (!boss || spec == null) return null;
            if (Current) Current.Abort();
            var go = new GameObject($"LordCinema ({boss.Def?.id})");
            if (boss.gameObject.scene.IsValid()) UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(go, boss.gameObject.scene);
            var c = go.AddComponent<LordCinema>();
            c.Begin(boss, spec);
            return c;
        }

        void Begin(LordBrain b, LordDeathSpec s)
        {
            boss = b;
            spec = s;
            Current = this;
            Played++;
            center = b.BodyCenter;
            vitals = PlayerVitals.Instance;
            motor = vitals ? vitals.GetComponent<PlayerMotor>() : null;
            feel = vitals ? vitals.GetComponent<CameraFeel>() : null;
            cam = feel && feel.cam ? feel.cam : Camera.main;
            head = cam ? cam.transform : null;
            eye = motor ? motor.eye : null;
            hasCam = motor && eye && head && cam && vitals && !vitals.Dead;
            var toPlayer = (vitals ? vitals.transform.position : center + Vector3.back) - center;
            toPlayer.y = 0;
            baseYaw = toPlayer.sqrMagnitude > 1e-4f ? Mathf.Atan2(toPlayer.x, toPlayer.z) : 0;
            if (s.slowScale > 0 && s.slowScale < 1 && s.slowSeconds > 0)
            {
                slow = TimeScaleArbiter.Request(this, s.slowScale, TimeScaleArbiter.Priority.HitStop + 60);
                slowUntil = Time.unscaledTime + s.slowSeconds;
            }
            Phase = Stage.Show;
            if (!hasCam) return;
            inputWas = motor.inputEnabled;
            startFov = cam.fieldOfView;
            lastPose = CamPose.Of(head, startFov);
            foreach (var c in cam.GetComponentsInChildren<Camera>(true))
                if (c != cam && (c.cullingMask & (1 << Layers.FirstPerson)) != 0)
                {
                    vmCam = c;
                    break;
                }
            vmWasEnabled = vmCam && vmCam.enabled;
            LockInput();
            if (feel) feel.Calm();
            GameUI.HudHidden = true;
            overlay = CinematicOverlay.Create();
            if (overlay != null) overlay.BarsTarget = 1;
        }

        void LockInput()
        {
            if (!motor) return;
            motor.inputEnabled = false;
            motorLock ??= motor.AddModifier((ref MotorFrame f) => f.locks |= MotorLock.All, 1000);
            if (vitals && !vitals.Dead) vitals.invulnerableUntil = Mathf.Max(vitals.invulnerableUntil, Time.time + 0.4f);
        }

        void Update()
        {
            if (Phase == Stage.Done) return;
            float udt = Time.unscaledDeltaTime, dt = Time.deltaTime;
            if (slow != null && Time.unscaledTime >= slowUntil)
            {
                slow.Dispose();
                slow = null;
            }
            if (Phase == Stage.Outro)
            {
                TickOutro(udt);
                return;
            }
            t += dt;
            if (boss)
                try
                {
                    boss.DeathTick(t, dt);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            if (!hasCam)
            {
                if (t >= spec.seconds) Finish();
                return;
            }
            if (!vitals || vitals.Dead || !motor || !head)
            {
                Abort();
                return;
            }
            LockInput();
            if (!cardShown && t >= spec.cardAt && overlay != null)
            {
                cardShown = true;
                overlay.ShowCaption(spec.cardTitle ?? boss?.Def?.name, spec.cardSub, spec.epithet, spec.cardSeconds);
            }
            AimPlayer();
            if (Phase == Stage.Show)
            {
                bool held = Time.timeScale > 0 && !GameStateMachine.Blocked && GameInput.Down(GameAction.Interact);
                skipHold = held ? skipHold + udt : Mathf.Max(0, skipHold - udt * 3f);
                if (skipHold >= SkipHoldSeconds) RequestSkip();
                if (t >= spec.ShowSeconds) BeginLand(false);
            }
            else if (Phase == Stage.Land) landT += dt;
            StepWeapon(udt);
            overlay?.Tick(udt);
        }

        /// <summary>跳过：从当前机位落回眼睛（同样零误差）</summary>
        public bool RequestSkip()
        {
            if (Phase != Stage.Show || !hasCam) return false;
            Skipped = true;
            overlay?.HideCaption();
            BeginLand(true);
            return true;
        }

        void BeginLand(bool skip)
        {
            Phase = Stage.Land;
            landT = 0;
            // 落回：正常结束切到过肩机位再推进；跳过从当前画面推进
            landFrom = skip ? lastPose : ShoulderPose();
            GameAudio.Play("dash", 0.4f, 0.75f);
        }

        CamPose ShoulderPose()
        {
            var e = eye.position;
            var look = boss ? boss.BodyCenter : center;
            var f = look - e;
            f.y = 0;
            f = f.sqrMagnitude > 1e-4f ? f.normalized : eye.forward;
            var right = new Vector3(f.z, 0, -f.x);
            var pos = e - f * ShoulderBack + Vector3.up * ShoulderUp + right * ShoulderRight;
            return CamPose.Look(pos, look, ShoulderFov);
        }

        void AimPlayer()
        {
            if (!motor || !eye || !boss) return;
            IntroMath.YawPitch(eye.position, center, BossIntroDirector.AimMaxPitch, out float yaw, out float pitch);
            if (Phase == Stage.Show) motor.SetLook(yaw, pitch);
        }

        CamPose FirstPerson() => new(eye.position, eye.rotation, feel && feel.isActiveAndEnabled ? feel.Fov : startFov);

        void LateUpdate()
        {
            if (!hasCam || Phase is Stage.Done or Stage.Outro || !head) return;
            CamPose pose;
            var fp = FirstPerson();
            if (Phase == Stage.Show)
            {
                float k = IntroMath.Ease(IntroEase.InOut, Mathf.Clamp01(t / spec.ShowSeconds));
                float a = baseYaw + Mathf.Lerp(spec.orbitFrom, spec.orbitTo, k);
                var pos = center + new Vector3(Mathf.Sin(a) * spec.radius, spec.height - 1.5f, Mathf.Cos(a) * spec.radius);
                var look = center + Vector3.up * (spec.lookHeight - 1.5f);
                pose = CamPose.Look(Clear(look, pos), look, 55f);
            }
            else
            {
                float u = landT;
                pose = IntroMath.Land(landFrom, fp, u, spec.landSeconds);
                // 切到过肩机位的那一帧是设计好的硬切，不算进「落回单帧最大位移」
                if (Phase == Stage.Land && landStarted) LandMaxStep = Mathf.Max(LandMaxStep, Vector3.Distance(lastPose.position, pose.position));
                landStarted = true;
                float p = Mathf.Clamp01(u / Mathf.Max(0.01f, spec.landSeconds));
                if (overlay != null && p >= BossIntroDirector.BarsOutAt) overlay.BarsTarget = 0;
                if (p >= 0.5f) overlay?.HideCaption();
                if (p >= BossIntroDirector.HudInAt) GameUI.HudHidden = false;
                if (p >= BossIntroDirector.RaiseAt && raiseT < 0) BeginRaise();
            }
            if (!pose.Finite) pose = fp;
            head.SetPositionAndRotation(pose.position, pose.rotation);
            if (float.IsFinite(pose.fov) && pose.fov > 1f) cam.fieldOfView = pose.fov;
            lastPose = pose;
            if (Phase == Stage.Land && landT >= spec.landSeconds) Handoff(fp);
        }

        /// <summary>机位被地形 / 建筑挡住时往看点收</summary>
        static Vector3 Clear(Vector3 look, Vector3 pos)
        {
            var d = pos - look;
            float len = d.magnitude;
            if (!(len > 0.5f)) return pos;
            if (Physics.SphereCast(look, 0.3f, d / len, out var hit, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                pos = look + d / len * Mathf.Max(0.8f, hit.distance - 0.2f);
            if (Physics.Raycast(pos + Vector3.up * 2.5f, Vector3.down, out var g, 3.2f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && pos.y < g.point.y + 0.45f)
                pos.y = g.point.y + 0.45f;
            return pos;
        }

        void Handoff(CamPose fp)
        {
            IntroMath.Error(new CamPose(head.position, head.rotation, cam.fieldOfView), fp, out float m, out float a, out float f);
            HandoffMeters = m;
            HandoffDegrees = a;
            HandoffFov = f;
            head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            cam.fieldOfView = fp.fov;
            Release();
            Phase = Stage.Outro;
        }

        void Release()
        {
            if (released) return;
            released = true;
            motorLock?.Dispose();
            motorLock = null;
            if (motor && GameStateMachine.Base != GameState.Transition)
                motor.inputEnabled = inputWas && !GameStateMachine.Blocked && !(vitals && vitals.Dead);
            if (vitals && !vitals.Dead) vitals.invulnerableUntil = Mathf.Max(vitals.invulnerableUntil, Time.time + 0.5f);
            GameUI.HudHidden = false;
            CameraShake.Clear();
            if (feel) feel.Calm();
            slow?.Dispose();
            slow = null;
            if (Current == this) Current = null;
        }

        void BeginRaise()
        {
            raiseT = 0;
            if (vmCam) vmCam.enabled = vmWasEnabled;
        }

        void StepWeapon(float udt)
        {
            if (!vmCam) return;
            float k;
            if (raiseT >= 0)
            {
                raiseT += udt;
                k = 1 - IntroMath.Ease(IntroEase.Out, raiseT / BossIntroDirector.RaiseSeconds);
            }
            else
            {
                stowT += udt;
                k = IntroMath.Ease(IntroEase.In, stowT / BossIntroDirector.StowSeconds);
                if (k >= 1 && vmCam.enabled) vmCam.enabled = false;
            }
            vmLocalPitch = StowPitch * Mathf.Clamp01(k);
            vmCam.transform.SetLocalPositionAndRotation(new Vector3(0, StowLift * Mathf.Clamp01(k), 0), Quaternion.Euler(-vmLocalPitch, 0, 0));
        }

        void TickOutro(float udt)
        {
            if (raiseT < 0) BeginRaise();
            StepWeapon(udt);
            if (overlay != null)
            {
                overlay.BarsTarget = 0;
                overlay.HideCaption();
                overlay.Tick(udt);
            }
            bool barsDone = overlay == null || (overlay.Bars <= 0 && !overlay.CaptionVisible);
            bool weaponDone = !vmCam || raiseT >= BossIntroDirector.RaiseSeconds;
            if (barsDone && weaponDone) Finish();
        }

        void Finish()
        {
            if (vmCam)
            {
                vmCam.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                vmCam.enabled = vmWasEnabled;
            }
            Release();
            overlay?.Dispose();
            overlay = null;
            Phase = Stage.Done;
            Destroy(gameObject);
        }

        /// <summary>打断（玩家阵亡、新演出顶掉）：立刻恢复镜头、枪模、黑边、输入、时间缩放</summary>
        public void Abort()
        {
            if (Phase == Stage.Done) return;
            if (!released && head) head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            if (!released && cam && feel) cam.fieldOfView = feel.Fov;
            Finish();
        }

        void OnDisable()
        {
            if (Phase == Stage.Done) return;
            if (!released && head) head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            if (vmCam)
            {
                vmCam.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                vmCam.enabled = vmWasEnabled;
            }
            Release();
            overlay?.Dispose();
            overlay = null;
            Phase = Stage.Done;
        }
    }
}
