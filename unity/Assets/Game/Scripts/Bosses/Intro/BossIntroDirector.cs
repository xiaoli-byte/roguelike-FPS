using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>登场演出放不放：Auto = 正常游玩时放、冒烟测试（场景里有 PlaytestRunner）时不放；Always / Never = 测试开关</summary>
    public enum BossIntroPolicy { Auto, Always, Never }

    /// <summary>
    /// 首领登场演出的导演（docs/level-design/boss-intros.md）：BossEncounter 开战时挂到首领关物体上，按 <see cref="BossIntroScript"/> 的镜头表接管镜头，最后连续地落回玩家眼睛。
    ///   接管：锁玩家输入（motor.inputEnabled + MotorLock.All，每帧重申）、玩家无敌、场上小怪待机且不可选中（<see cref="HoldsEnemy"/>）、HUD 淡出（<see cref="GameUI.HudHidden"/>）、
    ///     第一人称武器收起（枪模相机上仰后停用）、上下黑边、名字卡、跳过提示（<see cref="CinematicOverlay"/>）。
    ///   镜头：每帧在 CameraFeel 之后（执行顺序 −35 &gt; −40）直接写主相机（Head）的世界位姿与 FOV；手持晃动 + 震屏由这里叠（权重随落地淡到 0）；机位被地形挡住时往看点收。
    ///   首领：<see cref="BossIntroScript.spawnAt"/> 秒时 <see cref="SpawnDue"/>，BossEncounter 刷首领；首领自己的登场动作（BossIntroDef）照常跑完后停在登场里
    ///     （<see cref="HoldsIntro"/>，不可选中、不出招），直到镜头交还才 IntroDone、开打。
    ///   交接：镜头表播完（或跳过）→ 用 landSeconds 秒把位置、朝向、视角从当前镜头插值到 Eye 与 CameraFeel 的 FOV（smootherstep，最后一帧 w = 1 原样等于 Eye：零误差）；
    ///     玩家视线在演出里已经转向首领。落地过半黑边收起、HUD 淡入，72% 时抬枪；到达那一帧解锁输入、放开首领、清震屏、记「看过」，之后只剩抬枪 / 黑边的收尾动画。
    ///   跳过：按住交互键 <see cref="SkipHoldSeconds"/> 秒；第一次看要先看满 <see cref="FirstViewLock"/> 秒，看过的（<see cref="BossIntroLog"/>）一开始就能跳。跳过同样平滑落回。
    ///   安全：时间缩放只走 <see cref="TimeScaleArbiter"/>（演出慢动作优先级 = 顿帧 + 60，让给阵亡慢动作和场景过渡）；暂停时演出跟着停；
    ///     玩家阵亡、场景卸载（物体销毁）、首领丢失、超时都会把上面这些全部恢复（<see cref="Abort"/> / OnDisable）。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-35)]
    public sealed class BossIntroDirector : MonoBehaviour
    {
        /// <summary>第一次看至少多少秒（真实时间，不含暂停）才能跳；按住多久算跳过</summary>
        public const float FirstViewLock = 1.5f, SkipHoldSeconds = 0.6f;
        /// <summary>首领在登场里最多被多等多少秒（导演出错时的保险）；演出超出计划多少秒算超时</summary>
        public const float MaxIntroHold = 25f, Watchdog = 8f;
        /// <summary>演出慢动作的优先级：压过顿帧，让给阵亡慢动作</summary>
        public const int SlowMoPriority = TimeScaleArbiter.Priority.HitStop + 60;
        /// <summary>落地进度到这里收黑边 / HUD 淡入 / 抬枪（0–1）；抬枪用时；收枪用时</summary>
        public const float BarsOutAt = 0.55f, HudInAt = 0.6f, RaiseAt = 0.72f, RaiseSeconds = 0.4f, StowSeconds = 0.25f;
        /// <summary>玩家视线俯仰的上限（度）：看巨大的首领时不至于仰到天上</summary>
        public const float AimMaxPitch = 32f;
        /// <summary>收枪时枪模相机上仰多少度、抬高多少米（枪移出画面）</summary>
        const float StowPitch = 55f, StowLift = 0.22f;
        /// <summary>手持晃动（handheld = 1）：位移（米）、转角（度）、频率；震屏（强度 1）：位移、转角</summary>
        const float HandPos = 0.035f, HandFreq = 0.55f, ShakeFreq = 18f;
        static readonly Vector3 HandRot = new(0.55f, 0.75f, 0.35f), ShakePos = new(0.04f, 0.04f, 0.02f), ShakeRot = new(1.4f, 1.1f, 1.7f);
        public const string OverlayChannel = "bossIntro";

        public enum Stage { Shots, Landing, Outro, Done }

        // ───────────── 全局 ─────────────

        /// <summary>正在接管镜头的演出（交还之后为 null，即使收尾动画还在播）</summary>
        public static BossIntroDirector Current { get; private set; }
        /// <summary>测试开关（每次进 Play 回到 Auto）</summary>
        public static BossIntroPolicy Policy { get; set; }
        /// <summary>开始 / 交还镜头（正常结束、跳过、被打断都会发 Ended）</summary>
        public static event Action<BossIntroDirector> Began, Ended;
        /// <summary>本次 Play 里开过几段演出</summary>
        public static int Played { get; private set; }

        static BossIntroDirector outro;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Current = null;
            outro = null;
            Policy = BossIntroPolicy.Auto;
            Began = Ended = null;
            Played = 0;
        }

        /// <summary>现在开战会不会放演出（看测试开关；Auto 时有冒烟测试宿主就不放）</summary>
        public static bool Enabled => Policy switch
        {
            BossIntroPolicy.Always => true,
            BossIntroPolicy.Never => false,
            _ => !FindAnyObjectByType<Testing.PlaytestRunner>(),
        };

        /// <summary>
        /// 开演（<see cref="BossEncounter.Begin"/> 调）：测试开关关着、没有演出脚本、没有玩家 / 镜头时返回 null，首领关照旧走预警 → 生成
        /// </summary>
        public static BossIntroDirector Play(BossEncounter enc)
        {
            if (!enc || !Enabled) return null;
            var script = BossIntroScript.For(enc.bossId);
            if (script == null) return null;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return null;
            var motor = pv.GetComponent<PlayerMotor>();
            if (!motor || !motor.eye) return null;
            var feel = pv.GetComponent<CameraFeel>();
            var weapons = pv.GetComponent<WeaponController>();
            var cam = feel && feel.cam ? feel.cam : weapons && weapons.eye ? weapons.eye : motor.eye.GetComponentInChildren<Camera>();
            if (!cam || !cam.transform.IsChildOf(pv.transform)) return null;
            if (Current) Current.Abort("新的演出开始");
            if (outro) outro.EndOutro();
            var d = enc.gameObject.AddComponent<BossIntroDirector>();
            d.Begin(enc, script, pv, motor, feel, weapons, cam);
            return d;
        }

        /// <summary>这只首领的登场由演出接管（名字卡由演出打，BossBrain 不再打横幅）</summary>
        public static bool Directs(BossBrain b) => Current && !Current.released && Current.Claims(b);

        /// <summary>首领的登场动作播完了也先别结束（镜头还没交还）。overtime = 已经超出 BossIntroDef.seconds 多少秒</summary>
        public static bool HoldsIntro(BossBrain b, float overtime) => overtime < MaxIntroHold && Directs(b);

        /// <summary>演出期间敌人待机（不追、不出招）；正在登场的首领除外（它的登场动作照常跑）</summary>
        public static bool HoldsEnemy(EnemyAI e) => Current && Current.holdEnemies && !(e is BossBrain b && !b.IntroDone);

        // ───────────── 状态（测试 / 调试读） ─────────────

        BossEncounter enc;
        BossIntroScript script;
        BossIntroContext ctx;
        PlayerVitals vitals;
        PlayerMotor motor;
        CameraFeel feel;
        Camera cam, vmCam;
        Transform head, eye;
        CinematicOverlay overlay;
        IDisposable motorLock;
        TimeScaleArbiter.Handle slow;
        float slowUntil;
        readonly List<Damageable> heldTargets = new();
        float[] nextAt;
        readonly HashSet<string> reported = new();

        Stage stage;
        float t, realT, landT, landSeconds = 1f, skipHold, stowT, raiseT = -1, startFov, aimYaw, aimPitch, clearDist = float.PositiveInfinity, seed;
        int shotIndex = -1;
        bool released, holdEnemies, spawnDue, skipped, seen, nameCardShown, vmWasEnabled, inputWas = true, aimed, raisedSfx;
        CamPose startPose, lastPose, skipFrom;
        bool hasLast;
        Vector3 modelOffset, appliedOffset;
        float modelScale = 1f, appliedScale = 1f;
        Transform appliedRoot;

        public BossIntroScript Script => script;
        public BossIntroContext Context => ctx;
        public BossEncounter Encounter => enc;
        public Stage Phase => stage;
        /// <summary>演出已进行的秒数（游戏时间）与真实秒数（不含暂停）</summary>
        public float Elapsed => t;
        public float RealElapsed => realT;
        /// <summary>当前镜头（落地 / 收尾时为 "land" / "outro"）</summary>
        public string ShotName => stage == Stage.Shots && shotIndex >= 0 && shotIndex < script.shots.Count ? script.shots[shotIndex].name : stage == Stage.Landing ? "land" : "outro";
        public int ShotIndex => shotIndex;
        /// <summary>落回第一人称的进度 0–1（镜头表里为 0，交还后为 1）</summary>
        public float LandProgress => stage == Stage.Landing ? Mathf.Clamp01(landT / Mathf.Max(0.01f, landSeconds)) : stage == Stage.Shots ? 0f : 1f;
        /// <summary>该刷首领了（BossEncounter 每帧问）</summary>
        public bool SpawnDue => spawnDue;
        public bool Skipped => skipped;
        /// <summary>玩家输入锁着（交还之前）</summary>
        public bool InputLocked => !released;
        /// <summary>镜头交还了（之后只剩收尾动画）</summary>
        public bool Released => released;
        /// <summary>看过这只首领的演出（开演时读的存档）</summary>
        public bool SeenBefore => seen;
        /// <summary>现在能跳过：还在镜头表里、没跳过，且看过或已经看满 <see cref="FirstViewLock"/> 秒</summary>
        public bool CanSkip => stage == Stage.Shots && !skipped && !released && SkipAllowed(seen, realT);

        /// <summary>跳过规则：看过的随时能跳；第一次看要先看满 <see cref="FirstViewLock"/> 秒（真实时间，不含暂停）</summary>
        public static bool SkipAllowed(bool seenBefore, float realElapsed) => seenBefore || realElapsed >= FirstViewLock;
        /// <summary>按住跳过的进度 0–1</summary>
        public float SkipProgress => Mathf.Clamp01(skipHold / SkipHoldSeconds);
        /// <summary>最后一次写进相机的姿态</summary>
        public CamPose LastPose => lastPose;
        /// <summary>交接那一帧相机与 Eye 的误差（米 / 度 / 度）；还没交接为 NaN</summary>
        public float HandoffMeters { get; private set; } = float.NaN;
        public float HandoffDegrees { get; private set; } = float.NaN;
        public float HandoffFov { get; private set; } = float.NaN;
        /// <summary>落地过程里单帧最大的位移（米）、转角（度），以及落地起点到 Eye 的距离 / 角度（测试判「没有硬切」）</summary>
        public float LandMaxStep { get; private set; }
        public float LandMaxTurn { get; private set; }
        public float LandDistance { get; private set; }
        public float LandAngle { get; private set; }
        /// <summary>落地过程里「这一帧实际走的 / 平滑落地这一帧最多该走的」的最大值（位移 / 转角）：≤ 1 左右 = 平滑，硬切是几十</summary>
        public float LandStepRatio { get; private set; }
        public float LandTurnRatio { get; private set; }
        /// <summary>演出里写过相机的帧数、镜头表里切过几次镜</summary>
        public int Frames { get; private set; }
        public int Cuts { get; private set; }
        /// <summary>结束原因（"done" / "skipped" / 打断原因）</summary>
        public string EndReason { get; private set; }
        public CinematicOverlay Overlay => overlay;
        public Camera Camera => cam;
        public Camera ViewmodelCamera => vmCam;

        // ───────────── 开始 ─────────────

        void Begin(BossEncounter e, BossIntroScript s, PlayerVitals pv, PlayerMotor m, CameraFeel f, WeaponController w, Camera c)
        {
            enc = e;
            script = s;
            vitals = pv;
            motor = m;
            feel = f;
            cam = c;
            head = c.transform;
            eye = m.eye;
            seed = UnityEngine.Random.value * 100f;
            vmCam = FindViewmodelCamera(c);
            vmWasEnabled = vmCam && vmCam.enabled;
            inputWas = m.inputEnabled;
            startFov = c.fieldOfView;
            startPose = CamPose.Of(head, startFov);
            lastPose = startPose;

            var arena = e.arena ? e.arena : BossArena.Find(e.bossId, e.transform.position);
            var spawn = arena ? arena.BossSpawnPoint : e.transform.position;
            IntroMath.DuelBasis(pv.transform.position, spawn, arena ? spawn - arena.PlayerEntryPoint : e.transform.forward, out var fwd, out var right);
            ctx = new BossIntroContext
            {
                director = this, Script = s, Encounter = e, Arena = arena, Def = e.Def, Spawn = spawn, Forward = fwd, Right = right,
                eye = m.eye, player = pv.transform,
            };
            nextAt = new float[s.cues.Count];
            for (int i = 0; i < nextAt.Length; i++) nextAt[i] = s.cues[i] != null ? s.cues[i].at : float.PositiveInfinity;
            try
            {
                seen = BossIntroLog.Current.Seen(e.bossId);
            }
            catch (Exception ex)
            {
                ReportOnce("seen", ex);
            }

            Current = this;
            Played++;
            stage = Stage.Shots;
            LockInput();
            holdEnemies = true;
            HoldTargets();
            if (feel) feel.Calm();
            GameUI.HudHidden = true;
            overlay = CinematicOverlay.Create();
            if (overlay != null) overlay.BarsTarget = 1;
            Guard("onBegin", () => s.onBegin?.Invoke(ctx));
            Raise(Began);
        }

        static Camera FindViewmodelCamera(Camera main)
        {
            foreach (var c in main.GetComponentsInChildren<Camera>(true))
                if (c != main && (c.cullingMask & (1 << Layers.FirstPerson)) != 0)
                    return c;
            return null;
        }

        bool Claims(BossBrain b) => b && b.Def != null && enc && b.Def.id == enc.bossId;

        // ───────────── 每帧 ─────────────

        void Update()
        {
            if (stage == Stage.Done) return;
            float udt = Time.unscaledDeltaTime;
            if (stage == Stage.Outro)
            {
                TickOutro(udt);
                return;
            }
            if (!motor || !vitals || !head || !cam || !enc)
            {
                Abort("玩家或首领关没了");
                return;
            }
            if (vitals.Dead)
            {
                Abort("玩家阵亡");
                return;
            }
            UndoModelPose();
            LockInput();
            bool running = Time.timeScale > 0 && !GameStateMachine.Blocked;
            if (running) realT += udt;
            if (slow != null && Time.unscaledTime >= slowUntil) ReleaseSlow();

            float dt = Time.deltaTime, prev = t;
            t += dt;
            ctx.Elapsed = t;
            if (!spawnDue && t >= script.spawnAt) spawnDue = true;
            BindBoss();
            if (stage == Stage.Shots && !skipped) FireCues(prev, t);
            else if (stage == Stage.Landing && !skipped) FireCues(prev, t);
            Guard("onTick", () => script.onTick?.Invoke(ctx, dt));
            ctx.RefreshSize();
            if (stage == Stage.Landing) landT += dt;
            else if (t >= script.ShotsSeconds) BeginLanding(script.landSeconds, false);
            PollSkip(udt, running);
            AimPlayer(dt);
            if (t > script.Seconds + Watchdog) Abort("超时");
        }

        void LateUpdate()
        {
            if (stage is Stage.Done or Stage.Outro || !head || !cam) return;
            ApplyModelPose();
            var fp = FirstPersonPose();
            CamPose pose;
            float w = 0, u = 0;
            if (stage == Stage.Shots) pose = EvalTimeline();
            else
            {
                var from = skipped ? skipFrom : EvalShot(script.shots.Count - 1, script.shots[^1].seconds, true);
                w = IntroMath.LandWeight(landT, landSeconds);
                u = Mathf.Clamp01(landT / Mathf.Max(0.01f, landSeconds));
                if (!hasLandStart)
                {
                    hasLandStart = true;
                    IntroMath.Error(from, fp, out float d0, out float a0, out _);
                    LandDistance = d0;
                    LandAngle = a0;
                }
                pose = IntroMath.Land(from, fp, landT, landSeconds);
            }
            if (w < 1) pose = Perturb(pose, 1 - w, stage == Stage.Shots ? CurrentHandheld() : script.shots.Count > 0 ? script.shots[^1].handheld : 0);
            if (!pose.Finite) pose = fp;
            if (stage == Stage.Landing && hasLast)
            {
                float step = Vector3.Distance(lastPose.position, pose.position), turn = Quaternion.Angle(lastPose.rotation, pose.rotation);
                LandMaxStep = Mathf.Max(LandMaxStep, step);
                LandMaxTurn = Mathf.Max(LandMaxTurn, turn);
                // smootherstep 的最大速度是平均速度的 1.875 倍：按这一帧的 dt 算出「平滑落地最多该走多远」，再留一点手持 / 震屏的余量；硬切会是几十倍
                float k = 1.9f * Mathf.Max(Time.deltaTime, 1e-4f) / Mathf.Max(0.05f, landSeconds);
                LandStepRatio = Mathf.Max(LandStepRatio, step / (LandDistance * k + 0.08f));
                LandTurnRatio = Mathf.Max(LandTurnRatio, turn / (LandAngle * k + 1.5f));
            }
            Write(pose);
            Present(u);
            if (stage == Stage.Landing && w >= 1f) Handoff(fp);
        }

        bool hasLandStart;

        CamPose FirstPersonPose() => new(eye.position, eye.rotation, feel && feel.isActiveAndEnabled ? feel.Fov : startFov);

        void Write(CamPose pose)
        {
            head.SetPositionAndRotation(pose.position, pose.rotation);
            if (float.IsFinite(pose.fov) && pose.fov > 1f) cam.fieldOfView = pose.fov;
            lastPose = pose;
            hasLast = true;
            Frames++;
        }

        // ───────────── 镜头表 ─────────────

        CamPose EvalTimeline()
        {
            int i = script.ShotIndexAt(t, out float u);
            if (i < 0)
            {
                i = script.shots.Count - 1;
                u = script.shots[i].seconds;
            }
            if (i != shotIndex)
            {
                if (shotIndex >= 0) Cuts++;
                shotIndex = i;
                clearDist = float.PositiveInfinity;
            }
            var s = script.shots[i];
            var pose = EvalShot(i, u, true);
            if (s.blendIn > 0 && u < s.blendIn)
            {
                var prev = i == 0 ? startPose : EvalShot(i - 1, script.shots[i - 1].seconds, false);
                pose = IntroMath.Blend(prev, pose, IntroMath.Ease(IntroEase.InOut, u / s.blendIn));
            }
            return pose;
        }

        /// <summary>第 i 镜、镜头内第 u 秒的姿态（stateful = 用当前镜头的避让平滑状态）</summary>
        CamPose EvalShot(int i, float u, bool stateful)
        {
            var s = script.shots[i];
            IntroMath.ShotFrame(s, u, ctx, out var pos, out var look, out float fov, out float roll);
            if (s.clearance) pos = Clear(look, pos, stateful);
            return CamPose.Look(pos, look, fov, roll);
        }

        float CurrentHandheld() => shotIndex >= 0 && shotIndex < script.shots.Count ? script.shots[shotIndex].handheld : 0;

        /// <summary>
        /// 避让：从看点往机位打一个 0.3 m 的球，被世界几何挡住就把机位收到挡板前面（收得快、放得慢，不来回跳）；机位贴地太低时抬到离地 0.45 m
        /// </summary>
        Vector3 Clear(Vector3 look, Vector3 pos, bool stateful)
        {
            var origin = look + Vector3.up * 0.4f;
            var d = pos - origin;
            float len = d.magnitude;
            if (!(len > 0.5f) || !float.IsFinite(len)) return pos;
            var dir = d / len;
            float allowed = len;
            if (Physics.SphereCast(origin, 0.3f, dir, out var hit, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                allowed = Mathf.Max(0.6f, hit.distance - 0.2f);
            float use = allowed;
            if (stateful)
            {
                clearDist = allowed <= clearDist ? allowed : IntroMath.Damp(clearDist, allowed, 3f, Time.deltaTime);
                use = Mathf.Min(len, clearDist);
            }
            var p = origin + dir * use;
            if (Physics.Raycast(p + Vector3.up * 2.5f, Vector3.down, out var g, 3.2f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && p.y < g.point.y + 0.45f)
                p.y = g.point.y + 0.45f;
            return p;
        }

        /// <summary>手持晃动 + 震屏（weight = 1 − 落地权重：交接那一帧正好是 0）</summary>
        CamPose Perturb(CamPose p, float weight, float handheld)
        {
            if (!(weight > 0)) return p;
            float time = Time.time;
            float hk = Mathf.Clamp01(handheld) * weight;
            Vector3 dp = Vector3.zero, dr = Vector3.zero;
            if (hk > 0)
            {
                var n = IntroMath.Noise3(seed, time * HandFreq);
                var m = IntroMath.Noise3(seed + 13.1f, time * HandFreq * 0.8f);
                dp += n * (HandPos * hk);
                dr += Vector3.Scale(m, HandRot) * hk;
            }
            float shake = Mathf.Min(1.6f, CameraShake.Current * Mathf.Max(0, GameSettings.ScreenShake.Value)) * weight;
            if (shake > 1e-4f)
            {
                var n = IntroMath.Noise3(seed + 51f, time * ShakeFreq);
                var m = IntroMath.Noise3(seed + 97f, time * ShakeFreq * 0.85f);
                dp += Vector3.Scale(n, ShakePos) * shake;
                dr += Vector3.Scale(m, ShakeRot) * shake;
            }
            return new CamPose(p.position + p.rotation * dp, p.rotation * Quaternion.Euler(dr), p.fov);
        }

        // ───────────── 事件 ─────────────

        void FireCues(float prev, float now)
        {
            var cues = script.cues;
            for (int i = 0; i < cues.Count; i++)
            {
                var c = cues[i];
                if (c == null || c.run == null) continue;
                if (c.Repeats)
                {
                    while (nextAt[i] <= now && nextAt[i] < c.until)
                    {
                        nextAt[i] += c.every;
                        Run(c);
                    }
                    if (nextAt[i] >= c.until) nextAt[i] = float.PositiveInfinity;
                }
                else if (nextAt[i] <= now)
                {
                    nextAt[i] = float.PositiveInfinity;
                    Run(c);
                }
            }
        }

        void Run(IntroCue c) => Guard(c.label ?? c.kind, () => c.run(ctx));

        void BindBoss()
        {
            var b = enc ? enc.Boss : null;
            if (ctx.Boss == null && b) ctx.BindBoss(b);
            // 首领丢了（生成失败 / 被删 / 演出里死了）：镜头直接落回
            bool lost = ctx.Boss != null ? !ctx.Boss || ctx.Boss.Dead : spawnDue && enc && enc.State != BossEncounter.Phase.Warning && !b;
            if (lost && stage == Stage.Shots)
            {
                EndReason = "首领丢失";
                skipFrom = hasLast ? lastPose : startPose;
                skipped = true;
                BeginLanding(script.skipLandSeconds, true);
            }
        }

        // ───────────── 跳过 ─────────────

        void PollSkip(float udt, bool running)
        {
            bool can = CanSkip;
            bool held = can && running && GameInput.Down(GameAction.Interact);
            skipHold = held ? skipHold + udt : Mathf.Max(0, skipHold - udt * 3f);
            if (overlay != null) overlay.SetHint(can, SkipProgress, can ? skipText ??= SkipText() : null);
            if (skipHold >= SkipHoldSeconds) RequestSkip();
        }

        string skipText;

        static string SkipText()
        {
            string key = GameInput.BindingLabel(GameAction.Interact);
            if (Gamepad.current != null) key += " / " + GameInput.BindingLabel(GameAction.Interact, GameInput.GamepadScheme);
            return $"按住 {key} 跳过";
        }

        /// <summary>
        /// 跳过（按住交互键走这里；测试直接调）：作废后面的镜头与非必需事件，必需事件立刻补放，首领立刻生成，从当前画面用 skipLandSeconds 秒落回第一人称。返回是否接受
        /// </summary>
        public bool RequestSkip()
        {
            if (!CanSkip) return false;
            skipped = true;
            EndReason = "skipped";
            spawnDue = true;
            var cues = script.cues;
            for (int i = 0; i < cues.Count; i++)
            {
                var c = cues[i];
                if (c == null || c.run == null || !c.essential || float.IsPositiveInfinity(nextAt[i])) continue;
                nextAt[i] = float.PositiveInfinity;
                Run(c);
            }
            skipFrom = hasLast ? lastPose : startPose;
            overlay?.HideCaption();
            BeginLanding(script.skipLandSeconds, true);
            return true;
        }

        void BeginLanding(float seconds, bool skip)
        {
            if (stage != Stage.Shots) return;
            stage = Stage.Landing;
            landT = 0;
            landSeconds = Mathf.Max(0.05f, seconds);
            hasLandStart = false;
            LandMaxStep = LandMaxTurn = LandStepRatio = LandTurnRatio = 0;
            // 震屏不在这里清（会跳一下）：它的权重随落地淡到 0，交还那一刻再清
            GameAudio.Play("dash", skip ? 0.35f : 0.45f, 0.75f);
        }

        // ───────────── 玩家 ─────────────

        void LockInput()
        {
            if (!motor) return;
            motor.inputEnabled = false;
            motorLock ??= motor.AddModifier((ref MotorFrame f) => f.locks |= MotorLock.All, 1000);
            if (vitals && !vitals.Dead) vitals.invulnerableUntil = Mathf.Max(vitals.invulnerableUntil, Time.time + 0.3f);
        }

        /// <summary>视线转向首领：镜头表里直接转（玩家看不见），落地时平滑跟着（落地目标就是 Eye，所以画面是连续的）</summary>
        void AimPlayer(float dt)
        {
            if (!motor || !eye) return;
            var target = ctx.Boss && !ctx.Boss.Dead ? ctx.Boss.BodyCenter : ctx.Spawn + Vector3.up * 2f;
            IntroMath.YawPitch(eye.position, target, AimMaxPitch, out float yaw, out float pitch);
            if (!aimed || stage == Stage.Shots)
            {
                aimYaw = yaw;
                aimPitch = pitch;
                aimed = true;
            }
            else
            {
                float k = 1 - Mathf.Exp(-5f * Mathf.Max(0, dt));
                aimYaw = Mathf.LerpAngle(aimYaw, yaw, k);
                aimPitch = Mathf.Lerp(aimPitch, pitch, k);
            }
            motor.SetLook(aimYaw, aimPitch);
        }

        void HoldTargets()
        {
            heldTargets.Clear();
            foreach (var e in EnemyRegistry.Live)
            {
                if (!e || e is BossBrain || !e.Health || e.Health.Dead || e.Health.untargetable) continue;
                e.Health.untargetable = true;
                heldTargets.Add(e.Health);
            }
        }

        void ReleaseTargets()
        {
            foreach (var h in heldTargets)
                if (h && !h.Dead)
                    h.untargetable = false;
            heldTargets.Clear();
        }

        // ───────────── 画面元素：黑边、HUD、武器、名字卡 ─────────────

        void Present(float landU)
        {
            float udt = Time.unscaledDeltaTime;
            bool landing = stage == Stage.Landing;
            if (overlay != null)
            {
                if (landing && landU >= BarsOutAt) overlay.BarsTarget = 0;
                if (landing && landU >= 0.5f) overlay.HideCaption();
                if (landing) overlay.SetHint(false, 0, null);
                overlay.Tick(udt);
            }
            if (landing && landU >= HudInAt) GameUI.HudHidden = false;
            if (landing && landU >= RaiseAt && raiseT < 0) BeginRaise();
            StepWeapon(udt);
        }

        void BeginRaise()
        {
            raiseT = 0;
            if (vmCam) vmCam.enabled = vmWasEnabled;
            if (!raisedSfx)
            {
                raisedSfx = true;
                GameAudio.Play("weapon_switch", 0.5f);
            }
        }

        /// <summary>枪模相机：收枪 = 上仰 + 抬高（枪往画面下方沉出去），收满后停用；抬枪反过来，ease-out</summary>
        void StepWeapon(float udt)
        {
            if (!vmCam) return;
            float k;
            if (raiseT >= 0)
            {
                raiseT += udt;
                k = 1 - IntroMath.Ease(IntroEase.Out, raiseT / RaiseSeconds);
            }
            else
            {
                stowT += udt;
                k = IntroMath.Ease(IntroEase.In, stowT / StowSeconds);
                if (k >= 1 && vmCam.enabled) vmCam.enabled = false;
            }
            var tr = vmCam.transform;
            if (k <= 0)
            {
                tr.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                return;
            }
            tr.SetLocalPositionAndRotation(new Vector3(0, StowLift * k, 0), Quaternion.Euler(-StowPitch * k, 0, 0));
        }

        /// <summary>枪抬完了</summary>
        public bool WeaponReady => !vmCam || (raiseT >= RaiseSeconds && vmCam.transform.localRotation == Quaternion.identity);

        internal void ShowNameCard(float seconds)
        {
            var def = ctx.Def;
            if (def == null || nameCardShown) return;
            nameCardShown = true;
            overlay?.ShowCaption(def.name, def.title, script.epithet, seconds);
        }

        /// <summary>名字卡打过了（演出里的电影字幕，或跳过后补的横幅）</summary>
        public bool NameCardShown => nameCardShown;

        // ───────────── 交接 ─────────────

        void Handoff(CamPose fp)
        {
            // 最后一帧：相机就是 Eye（Blend 在 w = 1 时原样返回），量一下实际写进去的误差
            IntroMath.Error(new CamPose(head.position, head.rotation, cam.fieldOfView), fp, out float m, out float a, out float f);
            HandoffMeters = m;
            HandoffDegrees = a;
            HandoffFov = f;
            // 交还给 CameraFeel：Head 回到 Eye 的局部原点（它下一帧照常叠晃动 / 冲击，此刻都已清零）
            head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            cam.fieldOfView = fp.fov;
            if (string.IsNullOrEmpty(EndReason)) EndReason = "done";
            Release(true);
            stage = Stage.Outro;
            outro = this;
        }

        /// <summary>交还操作（正常结束、跳过、打断都走这里，只走一次）：解锁输入、放开小怪和首领、撤慢动作、HUD 回来、清震屏、记「看过」、脚本撤掉临时改动</summary>
        void Release(bool completed)
        {
            if (released) return;
            released = true;
            UndoModelPose();
            motorLock?.Dispose();
            motorLock = null;
            // 恢复开演前的输入状态；换场景（SceneFlow 关着输入）/ 有模态 / 阵亡时不开，交给 GameSession / PlayerVitals 按状态开
            if (motor && GameStateMachine.Base != GameState.Transition)
                motor.inputEnabled = inputWas && !GameStateMachine.Blocked && !(vitals && vitals.Dead);
            if (vitals && !vitals.Dead) vitals.invulnerableUntil = Mathf.Max(vitals.invulnerableUntil, Time.time + 0.5f);
            holdEnemies = false;
            ReleaseTargets();
            ReleaseSlow();
            GameUI.HudHidden = false;
            CameraShake.Clear();
            if (feel) feel.Calm();
            if (ctx?.Boss && ctx.Boss.Body) ctx.Boss.Body.ClearOverlay(OverlayChannel);
            if (completed && enc)
            {
                // 跳得太早、名字卡还没打：补一张普通横幅（同没有演出时）
                var def = ctx?.Def;
                if (!nameCardShown && def != null) GameUI.Banner(def.name, def.title ?? "首领", 2.4f);
                nameCardShown = true;
                try
                {
                    BossIntroLog.Current.MarkSeen(enc.bossId);
                }
                catch (Exception ex)
                {
                    ReportOnce("markSeen", ex);
                }
            }
            if (script != null && ctx != null) Guard("onEnd", () => script.onEnd?.Invoke(ctx));
            if (Current == this) Current = null;
            Raise(Ended);
        }

        void TickOutro(float udt)
        {
            if (overlay != null)
            {
                overlay.BarsTarget = 0;
                overlay.SetHint(false, 0, null);
                overlay.HideCaption();
                overlay.Tick(udt);
            }
            if (raiseT < 0) BeginRaise();
            StepWeapon(udt);
            bool barsDone = overlay == null || (overlay.Bars <= 0 && !overlay.CaptionVisible);
            if (barsDone && WeaponReady) EndOutro();
        }

        void EndOutro()
        {
            RestoreViewmodel();
            overlay?.Dispose();
            overlay = null;
            stage = Stage.Done;
            if (outro == this) outro = null;
            Destroy(this);
        }

        /// <summary>
        /// 打断（玩家阵亡、物体销毁、首领关没了、超时、新演出顶掉）：不等动画，立刻把一切恢复——镜头交还 CameraFeel、枪模相机复位、黑边拿掉、HUD 回来、输入（活着且在游玩时）解锁
        /// </summary>
        public void Abort(string reason)
        {
            if (stage == Stage.Done) return;
            if (string.IsNullOrEmpty(EndReason) || EndReason == "done") EndReason = reason;
            RestoreNow();
            Release(false);
            stage = Stage.Done;
            if (outro == this) outro = null;
            if (this) Destroy(this);
        }

        void RestoreNow()
        {
            if (!released && head) head.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            if (!released && cam && float.IsFinite(startFov)) cam.fieldOfView = feel && feel.isActiveAndEnabled ? feel.Fov : startFov;
            RestoreViewmodel();
            overlay?.Dispose();
            overlay = null;
        }

        void RestoreViewmodel()
        {
            if (!vmCam) return;
            vmCam.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            vmCam.enabled = vmWasEnabled;
        }

        void OnDisable()
        {
            if (stage == Stage.Done) return;
            if (string.IsNullOrEmpty(EndReason)) EndReason = "物体停用 / 场景卸载";
            RestoreNow();
            Release(false);
            stage = Stage.Done;
            if (outro == this) outro = null;
        }

        // ───────────── 慢动作 / 模型姿态 ─────────────

        internal void SlowMo(float scale, float realSeconds)
        {
            if (!(scale > 0 && scale < 1) || !(realSeconds > 0) || released) return;
            ReleaseSlow();
            slow = TimeScaleArbiter.Request(this, scale, SlowMoPriority);
            slowUntil = Time.unscaledTime + realSeconds;
        }

        void ReleaseSlow()
        {
            slow?.Dispose();
            slow = null;
        }

        /// <summary>演出慢动作正在生效</summary>
        public bool Slowing => slow != null && slow.Live;

        internal void AddModelOffset(Vector3 worldOffset)
        {
            if (IntroMath.Finite(worldOffset)) modelOffset += worldOffset;
        }

        internal void AddModelScale(float k)
        {
            if (k > 0.01f && float.IsFinite(k)) modelScale *= k;
        }

        void ApplyModelPose()
        {
            var root = ctx.Boss && ctx.Boss.Model?.root ? ctx.Boss.Model.root.transform : null;
            if (!root || (modelOffset == Vector3.zero && Mathf.Approximately(modelScale, 1f))) return;
            root.position += modelOffset;
            if (!Mathf.Approximately(modelScale, 1f)) root.localScale *= modelScale;
            appliedRoot = root;
            appliedOffset = modelOffset;
            appliedScale = modelScale;
        }

        /// <summary>撤掉上一帧加的模型位移 / 缩放（Update 开头、首领自己写模型根节点之前；首领每帧重写也好、不写也好，都不会累积）</summary>
        void UndoModelPose()
        {
            if (appliedRoot)
            {
                appliedRoot.position -= appliedOffset;
                if (!Mathf.Approximately(appliedScale, 1f)) appliedRoot.localScale /= appliedScale;
            }
            appliedRoot = null;
            appliedOffset = Vector3.zero;
            appliedScale = 1f;
            modelOffset = Vector3.zero;
            modelScale = 1f;
        }

        // ───────────── 杂项 ─────────────

        void Guard(string what, Action a)
        {
            try
            {
                a();
            }
            catch (Exception e)
            {
                ReportOnce(what, e);
            }
        }

        internal void ReportOnce(string what, Exception e)
        {
            if (reported.Add(what)) Debug.LogException(new Exception($"[BossIntro] {script?.id} 的 {what} 出错：{e.Message}", e));
        }

        void Raise(Action<BossIntroDirector> ev)
        {
            if (ev == null) return;
            try
            {
                ev(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }
    }
}
