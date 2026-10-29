using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃的第一人称（WC7；Three.js BladeView.ts 的移植 + 改进，docs/demon-blade-v2.md 第 9 节）。挂在主相机下、FirstPerson 层（60° 枪模相机画）：
    ///   层级：DemonBlade View（这里）→ Sway（<see cref="FirstPersonViewmodel"/>：呼吸、走路摆动、鼠标滞后、落地、切枪下沉——和枪的 W4 手感同一套）
    ///         → Unflip（抵消 Sway 的 180°，以下就是相机空间）→ Hold（刀姿：握持点 + 刀身朝向）→ Grip（×0.72）→ 碎刃模型 + 英雄右手；
    ///         Unflip 下另有英雄左手（剑指）、刀光 <see cref="BladeTrail"/>、光点 <see cref="BladeGlints"/>。
    ///   · 三段斩：<see cref="BladeSwingClip"/>（代码生成的剪辑，时间轴 = 这一段的时长，判定帧事件在 windup 秒）按控制器给的进度采样；
    ///     蓄势段从当前姿态（上一段收势 / 手势）平滑转进剪辑；命中时视觉进度停 40 ms（第三段 70 ms，真实时间，和全局 HitStop 同时生效、不叠成更长），之后追上；
    ///     剪辑的三个事件按视觉进度越过它们时派发：<see cref="OnBladeWindup"/>（刀光起）、<see cref="OnBladeStrike"/>（刃口白热一闪、甩出碎刃火星、镜头朝挥动方向轻轻一带）、
    ///     <see cref="OnBladeRecover"/>（刀光止）；
    ///   · 剑指（千刃出窍 / 杀气爆发）、立掌（屏障）、举手（聚合）：右手收刀到手势姿态（0.14 s 平滑），左手从画面下方抬进来，剑指时指尖亮一点灵光。
    ///     英雄手臂是整块静态网格（握护木的拳头，没有手指骨骼），Animation Rigging 无骨可驱，所以手势用程序姿态模拟：
    ///     拳头前沿补两根伸直并拢的手指（<see cref="BladeSwordSign"/>，用手臂自己的材质），整只手按「手指指向 + 前臂朝画面左下」摆；
    ///     剑指 = 手指斜指前上方（指挥刃群）、立掌 = 手指竖直（单手剑诀）、举手 = 更高更竖；
    ///     右手按握把轴套在刀柄上（拳心按网格截面量过）、绕刀柄扭到前臂指向画面右下方的肘部；
    ///   · 碎片：在手里的才显示（<see cref="BladeShards.InHand"/>），伸刃时刀根一截不动、其余沿刀线拉开（第三段 2.2 倍、人刀合一常态 1.3 倍）并带一点横向错动；
    ///     刚归位的碎片放大一下再落回（归位闪）并在原位亮一颗光点，刀身整体也随之一亮；
    ///   · 刀光：挥砍进度每帧细分 4 次采样（刀身 35% 处 → 伸长后的刀尖），亮度跟刀尖速度走；
    ///   · 鬼眼：刀根切睁眼贴图；命中、判定帧、人刀合一、伸刃：碎片自发光加亮；命中时刀身往回一磕（枪模后坐弹簧）。
    /// 碎片交接（<see cref="HomeWorld"/>）同 TS：两台相机 FOV 不同，按屏幕位置把枪模相机里的位置换算到主相机的世界坐标。
    /// 切走这把刀：控制器 Show(false) 后不立刻消失，先跟着切枪的收枪阶段一起沉下去（这段时间没有 W4 rig 可显示——碎刃的 W4 rig 一直藏着）。
    /// </summary>
    public sealed class BladeView : MonoBehaviour, IBladeView
    {
        /// <summary>第一人称刀模缩放（关键帧位置是相机空间真实米数，只缩刀本身）</summary>
        public const float ModelScale = 0.72f;
        /// <summary>段结束 / 手势切换的过渡时长</summary>
        public const float BlendTime = 0.14f;
        /// <summary>命中后视觉进度停住的时长（真实秒）</summary>
        public const float HitStopLight = 0.04f, HitStopHeavy = 0.07f;
        /// <summary>刀光：每帧在走过的进度上采样几次（出刀只有两三帧，逐帧采样会是折线）</summary>
        public const int TrailSub = 4;
        /// <summary>归位闪的衰减（1/s）与峰值</summary>
        public const float ArriveDecay = 8f, ArrivePeak = 1.8f;
        /// <summary>判定帧甩出的火星放在刀尖屏幕位置往前这么远（米，贴脸淡出之外）</summary>
        public const float SparkDepth = 1.6f;
        /// <summary>刀光内沿在刀身上的位置（占刀身长度）：出刀时刀身大多朝前，只取刀尖一小截的话刀光在屏幕上只剩一条线</summary>
        public const float TrailInner = 0.35f;

        /// <summary>右肘（相机空间）：右前臂从手腕指向这里，在画面右下角之外</summary>
        static readonly Vector3 RightElbow = new(0.46f, -0.66f, -0.02f);
        /// <summary>右手腕在刀身坐标里的位置（握持点沿刀柄向下一点，乘刀模缩放前）</summary>
        static readonly Vector3 RightWrist = new(0.012f, -0.05f, -0.004f);
        /// <summary>
        /// 英雄美术手臂（SM_Arms_&lt;英雄&gt;&lt;R|L&gt;，握枪姿势建模）在各自局部空间里的关键量（TS 数值，x 取反 = Unity 导入的镜像）：
        /// 右手拳心（按网格截面量过：握把孔的中心比 TS 值再偏 1.5 cm，刀柄才真的穿在拳心里）、握把轴（握枪时手枪握把的方向）、前臂方向；左手前臂方向
        /// </summary>
        static readonly Vector3 ArtRightFist = new(-0.018f, -0.05f, 0.034f);
        static readonly Vector3 ArtRightGrip = new Vector3(0, 0.955f, -0.296f).normalized;
        static readonly Vector3 ArtRightFore = new Vector3(-0.1f, -0.21f, 0.3f).normalized;
        static readonly Vector3 ArtLeftFore = new Vector3(0.17f, -0.26f, 0.3f).normalized;
        /// <summary>左手臂缩放（同枪的第一人称 rig：手臂跟着枪模缩 0.76）</summary>
        const float LeftArmScale = 0.76f;

        /// <summary>
        /// 左手的手势（相机空间）：手掌原点位置、剑指手指的方向、前臂大致朝向（只用来定绕手指的翻转：前臂从画面左下方伸出去）。
        /// 剑指 = 手指斜指向前上方、略偏画面中心（指挥刃群）；立掌（屏障）= 手指竖直朝上（单手剑诀）；举手（聚合）= 更高、更竖
        /// </summary>
        readonly struct LeftPose
        {
            public readonly Vector3 palm, fingers, fore;

            public LeftPose(Vector3 palm, Vector3 fingers, Vector3 fore)
            {
                this.palm = palm;
                this.fingers = fingers.normalized;
                this.fore = fore.normalized;
            }
        }

        static readonly LeftPose LeftPoint = new(new Vector3(-0.21f, -0.135f, 0.5f), new Vector3(0.5f, 0.6f, 0.62f), new Vector3(-0.3f, -0.55f, -0.78f));
        static readonly LeftPose LeftSeal = new(new Vector3(-0.2f, -0.14f, 0.48f), new Vector3(0.12f, 0.97f, 0.2f), new Vector3(-0.2f, -0.55f, -0.8f));
        static readonly LeftPose LeftRaise = new(new Vector3(-0.2f, -0.08f, 0.5f), new Vector3(0.2f, 0.85f, 0.5f), new Vector3(-0.25f, -0.7f, -0.65f));

        /// <summary>最近建的、还活着的视图（套件读）</summary>
        public static BladeView Current { get; private set; }

        /// <summary>套件用：强行摆某个手势（屏障 / 聚合在 TestMode 下按不出来）；null = 跟控制器</summary>
        internal static BladeGesture? GestureOverride;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Current = null;
            GestureOverride = null;
        }

        /// <summary>剪辑驱动的伸刃倍率（剪辑曲线绑定的字段，<see cref="BladeSwing.StretchProperty"/>；运行时由视图按进度写入）</summary>
        [SerializeField] float clipStretch = 1;

        Camera main, vm;
        WeaponController wc;
        CameraFeel feel;
        FirstPersonViewmodel sway;
        Transform unflip, hold, grip, armR, armL;
        MeshRenderer swordSign;
        Mesh swordSignMesh;
        BladeSwordSign.Fit signFit;
        BladeModel model;
        BladeTrail trail;
        BladeGlints glints;
        readonly BladeSwingClip[] clips = new BladeSwingClip[3];

        // 姿态
        BladeHoldPose cur, from, target;
        int mode = -2, lastSwing = -1;
        float modeT, visP, hitStopLeft;
        bool snap = true, snapTwist = true, wantShown, driven;
        float twist, leftT, stretch = 1, hitFlash, strikeFlash, time, arriveGlow;
        bool lastUnion;
        Vector3 lastTip;

        // ───────────── 只读状态（测试 / 套件） ─────────────

        public BladeModel Model => model;
        public BladeTrail Trail => trail;
        public BladeGlints Glints => glints;
        /// <summary>当前在播的挥砍段（−1 = 不在挥砍）与视觉进度 0..1</summary>
        public int Swing => lastSwing;
        public float VisualProgress => visP;
        /// <summary>当前伸刃倍率（视觉）</summary>
        public float StretchNow => stretch;
        /// <summary>左手出现程度 0..1</summary>
        public float LeftHand => leftT;
        /// <summary>当前刀姿（相机空间）</summary>
        public BladeHoldPose HoldPose => cur;
        /// <summary>剪辑派发过的判定帧事件数</summary>
        public int StrikeEvents { get; private set; }
        /// <summary>英雄美术手臂挂上了没有</summary>
        public bool HasRightArm => armR;
        public bool HasLeftArm => armL;
        /// <summary>剑指的两根手指显示着</summary>
        public bool SwordSignShown => swordSign && swordSign.enabled && armL && armL.gameObject.activeInHierarchy;
        /// <summary>左手食指指尖（相机空间）</summary>
        public Vector3 FingerTip => armL && signFit != null ? unflip.InverseTransformPoint(armL.TransformPoint(BladeSwordSign.IndexTip(signFit))) : Vector3.zero;

        // ───────────── 生成 ─────────────

        /// <summary>建在 wc 的主相机下（没有相机时挂在瞄准点下）；英雄手臂按玩家的英雄取</summary>
        public static IBladeView Create(WeaponController wc)
        {
            if (!wc) return null;
            var parent = wc.eye ? wc.eye.transform : wc.Aim;
            var go = new GameObject("DemonBlade View");
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            var v = go.AddComponent<BladeView>();
            v.Build(wc);
            PlayerFactory.SetLayer(go, Layers.FirstPerson);
            Current = v;
            return v;
        }

        void Build(WeaponController controller)
        {
            wc = controller;
            main = wc.eye;
            vm = FindViewmodelCamera(main);
            feel = wc.GetComponent<CameraFeel>();

            var swayGo = new GameObject("Sway");
            swayGo.transform.SetParent(transform, false);
            sway = swayGo.AddComponent<FirstPersonViewmodel>();
            sway.hipOffset = Vector3.zero;
            sway.aimOffset = Vector3.zero;
            // 比冲锋枪略轻快：刀在手里晃得比枪灵活
            sway.weight = 0.85f;
            sway.swayScale = 1.1f;
            sway.bobScale = 0.9f;
            unflip = Child(swayGo.transform, "Unflip");
            unflip.localRotation = Quaternion.Euler(0, 180, 0);
            hold = Child(unflip, "Hold");
            grip = Child(hold, "Grip");
            grip.localScale = Vector3.one * ModelScale;

            model = BladeAssets.CreateModel(grip);
            model.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.Inverse(BladeModel.NeutralFrame));
            model.transform.localScale = Vector3.one;
            // 伸刃最长约 2.5 倍：蒙皮包围盒（刀身坐标）放到刀尖伸出去的地方，免得被枪模相机剔掉
            if (model.shards) model.shards.localBounds = new Bounds(new Vector3(0.02f, 0.95f, 0), new Vector3(0.7f, 2.3f, 0.4f));

            var skills = wc.GetComponent<HeroSkills>();
            var heroId = skills ? skills.heroId : null;
            var hero = HeroLibrary.Get(heroId) ?? HeroLibrary.Get(HeroLibrary.DefaultHero);
            if (hero != null)
            {
                armR = PlaceArm(hero.armR, grip);
                armL = PlaceArm(hero.armL, unflip);
                if (armL)
                {
                    armL.localScale = Vector3.one * LeftArmScale;
                    signFit = BladeSwordSign.For(hero.armL);
                    swordSign = BladeSwordSign.Attach(armL, hero.armL, out swordSignMesh);
                    armL.gameObject.SetActive(false);
                }
            }

            trail = BladeTrail.Create(unflip);
            glints = BladeGlints.Create(unflip);
            HideW4Rig(wc);
            cur = BladeSwing.Idle.Pose;
            ApplyHold();
        }

        static Transform Child(Transform parent, string name)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            return t;
        }

        /// <summary>英雄美术手臂：只留 LOD0、不投影、去掉碰撞体（同 WeaponRigFactory）</summary>
        static Transform PlaceArm(string id, Transform parent)
        {
            if (string.IsNullOrEmpty(id)) return null;
            GameObject go;
            try { go = GameDatabase.Place(id, parent); }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                return null;
            }
            if (!go) return null;
            go.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            go.transform.localScale = Vector3.one;
            foreach (var lg in go.GetComponentsInChildren<LODGroup>(true))
            {
                var lods = lg.GetLODs();
                for (int i = 1; i < lods.Length; i++)
                    foreach (var r in lods[i].renderers)
                        if (r) r.enabled = false;
                PlayerFactory.Kill(lg);
            }
            foreach (var c in go.GetComponentsInChildren<Collider>(true))
            {
                c.enabled = false;
                PlayerFactory.Kill(c);
            }
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            return go.transform;
        }

        /// <summary>
        /// 碎刃的 W4 rig（PlayerFactory 照武器表给每把武器都建了一个：刀模 + 握枪手臂，没有姿态）一直藏着：接管时 WeaponController 本来就不显示它，
        /// 但从碎刃切走的收枪阶段会显示旧武器的 rig——这段由本视图自己沉下去
        /// </summary>
        static void HideW4Rig(WeaponController wc)
        {
            foreach (var r in wc.rigs)
            {
                if (r == null || !r.view || r.weaponId != DemonBladeDef.WeaponId) continue;
                foreach (var rr in r.view.GetComponentsInChildren<Renderer>(true)) rr.enabled = false;
            }
        }

        static Camera FindViewmodelCamera(Camera main)
        {
            if (!main) return null;
            foreach (var c in main.GetComponentsInChildren<Camera>(true))
                if (c != main && (c.cullingMask & (1 << Layers.FirstPerson)) != 0) return c;
            return null;
        }

        // ───────────── IBladeView ─────────────

        public bool Alive => this && model;

        public void Show(bool on)
        {
            wantShown = on;
            if (!on) return;
            if (!gameObject.activeSelf)
            {
                ResetAnim();
                gameObject.SetActive(true);
                if (model) model.ShowAll();
            }
        }

        /// <summary>刚掏出这把刀：下一帧直接对齐待机姿态</summary>
        void ResetAnim()
        {
            snap = true;
            snapTwist = true;
            mode = -2;
            lastSwing = -1;
            visP = 0;
            hitStopLeft = 0;
            leftT = 0;
            leftPosed = false;
            stretch = 1;
            clipStretch = 1;
            trail?.Clear();
            glints?.Clear();
            if (armL) armL.gameObject.SetActive(false);
        }

        public void Dispose()
        {
            if (Current == this) Current = null;
            if (this) Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (Current == this) Current = null;
            if (swordSignMesh) Destroy(swordSignMesh);
        }

        /// <summary>新段开始：刀光另起一条</summary>
        public void OnSlash(int index) => trail?.Break();

        /// <summary>判定帧（控制器结算命中的那一刻，打没打中都调）：第三段在世界里补一道大弧，标出 6 米伸刃横扫的范围</summary>
        public void OnStrike(int index, BladeSlash seg, bool union)
        {
            lastUnion = union;
            if (seg == null || index != 2) return;
            var cam = main ? main.transform : transform.parent;
            if (!cam) return;
            var fwd = cam.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-6f) fwd = Vector3.forward;
            fwd.Normalize();
            float reach = seg.range * (union ? DemonBladeDef.UnionReach : 1);
            float yaw = Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg;
            float arc = Mathf.Min(Mathf.PI * 0.95f, seg.halfAngle * 2.2f);
            var color = Color.Lerp(BladeMeshes.Purple, Color.white, union ? 0.35f : 0.15f) * 1.2f;
            Fx.Slash(cam.position + fwd * 0.6f + Vector3.down * 0.3f, yaw, Mathf.Max(1.5f, reach * 0.8f), arc, 1, 0.04f, 0.5f, 0.24f, color);
        }

        /// <summary>这一段打中了：视觉进度停住（顿帧）、刀身闪亮、往回一磕</summary>
        public void OnHit(bool heavy)
        {
            hitStopLeft = heavy ? HitStopHeavy : HitStopLight;
            hitFlash = heavy ? 1.4f : 1f;
            if (sway) sway.Kick(heavy ? 0.024f : 0.014f, heavy ? 0.05f : 0.028f);
        }

        // ───────────── 剪辑事件（剪辑按进度派发；剪辑挂到 Animation 上播放时 Unity 也会按名字调到这里） ─────────────

        /// <summary>开始出刀：刀光起</summary>
        public void OnBladeWindup(int segment)
        {
            trail?.Break();
            trail?.ResetPeak();
        }

        /// <summary>判定帧：刃口白热一闪、甩出碎刃火星（FX1 预设 BladeTrail 的粒子层）、镜头朝挥动方向轻轻一带（命中的重冲击由控制器给）</summary>
        public void OnBladeStrike(int segment)
        {
            StrikeEvents++;
            strikeFlash = 1;
            // 镜头：一 = 右上 → 左下、二 = 左 → 右、三 = 大横扫；幅度不到命中冲击的一半，只让空挥也有「出刀」的感觉
            if (feel)
            {
                float yaw = segment == 1 ? 0.32f : segment == 2 ? -0.5f : -0.28f;
                float pitch = segment == 0 ? 0.22f : 0.06f;
                feel.Punch(pitch, segment == 1 ? -0.25f : 0.25f, yaw);
            }
            SpawnSparks(segment);
        }

        /// <summary>收势：刀光不再采样（剩下的自然淡掉）</summary>
        public void OnBladeRecover(int segment) { }

        void SpawnSparks(int segment)
        {
            if (!(Registry<FxPreset>.Get(BladeTrailPreset.PresetId) is FxPreset preset) || !main || !unflip) return;
            var tip = cur.BladePoint((float)BladeShape.SpineX(BladeShape.BladeLen), BladeSwing.StretchY((float)BladeShape.BladeLen, stretch), ModelScale, BladeMeshes.GripY);
            var dirLocal = tip - lastTip;
            if (dirLocal.sqrMagnitude < 1e-8f) dirLocal = cur.Edge;
            var cam = main.transform;
            var local = cam.InverseTransformPoint(unflip.TransformPoint(tip));
            local = ToMainLocal(local, main.fieldOfView, vm ? vm.fieldOfView : main.fieldOfView);
            if (local.z < 0.05f) return;
            var world = cam.TransformPoint(local * (SparkDepth / local.z));
            var dir = cam.TransformDirection(unflip.localRotation * dirLocal.normalized);
            var color = Color.Lerp(BladeMeshes.Purple, BladeMeshes.ShardSpark, 0.5f);
            Fx.Play(preset, world, dir, color, (segment == 2 ? 1.6f : 1f) * (lastUnion ? 1.25f : 1f));
        }

        // ───────────── 碎片交接 ─────────────

        /// <summary>两台相机 FOV 之比（主 / 枪模）：枪模相机里的点按它放大，屏幕位置不变</summary>
        public static float FovRatio(float fovMain, float fovVm) =>
            Mathf.Tan(Mathf.Clamp(fovMain, 1, 179) * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(Mathf.Clamp(fovVm, 1, 179) * 0.5f * Mathf.Deg2Rad);

        /// <summary>枪模相机局部坐标 → 主相机局部坐标（深度不变，x / y 按 FOV 之比放大：屏幕位置一致）</summary>
        public static Vector3 ToMainLocal(Vector3 local, float fovMain, float fovVm)
        {
            float a = FovRatio(fovMain, fovVm);
            return new Vector3(local.x * a, local.y * a, local.z);
        }

        Vector3 ToMainWorld(Vector3 world, out float a)
        {
            a = main && vm ? FovRatio(main.fieldOfView, vm.fieldOfView) : 1;
            if (!main) return world;
            var t = main.transform;
            var local = t.InverseTransformPoint(world);
            local.x *= a;
            local.y *= a;
            return t.TransformPoint(local);
        }

        public float HomeWorld(int i, out Vector3 pos, out Quaternion rot)
        {
            if (!model)
            {
                pos = main ? main.transform.position : transform.position;
                rot = Quaternion.identity;
                return 1;
            }
            float s = model.HomeWorld(i, out var p, out rot);
            pos = ToMainWorld(p, out float a);
            return s * a;
        }

        public Vector3 RootWorld => model ? ToMainWorld(model.RootWorld, out _) : transform.position;

        // ───────────── 每帧 ─────────────

        public void Animate(float dt, in BladePose input, BladeShards shards)
        {
            if (!model) return;
            driven = true;
            var pose = input;
            if (GestureOverride.HasValue && pose.swing < 0) pose.gesture = GestureOverride.Value;
            time += dt;
            hitFlash = Mathf.Max(0, hitFlash - dt * 6);
            strikeFlash = Mathf.Max(0, strikeFlash - dt * 9);
            if (hitStopLeft > 0) hitStopLeft = Mathf.Max(0, hitStopLeft - Time.unscaledDeltaTime);

            if (pose.swing >= 0) AnimateSwing(dt, pose);
            else
            {
                lastSwing = -1;
                int g = (int)pose.gesture;
                if (mode != 100 + g)
                {
                    from = cur;
                    mode = 100 + g;
                    modeT = 0;
                    target = BladeSwing.GestureKey(pose.gesture).Pose;
                }
                modeT += dt;
                cur = BladeHoldPose.Lerp(from, target, BladeSwing.Smooth(modeT / BlendTime));
                clipStretch = 1;
            }
            if (snap)
            {
                cur = BladeSwing.Idle.Pose;
                snap = false;
            }

            // 伸刃：剪辑给这一段的伸长（第三段 2.2），人刀合一常态伸长叠在上面
            float unionStretch = 1 + (Mathf.Max(1, pose.unionStretch) - 1) * Mathf.Clamp01(pose.union);
            float want = unionStretch + (clipStretch - 1);
            stretch += (want - stretch) * Mathf.Min(1, dt * 30);

            ApplyHold();
            PoseRightArm(dt);
            PoseLeftArm(dt, pose.gesture);
            if (sway) sway.lower = pose.lower;

            glints.Begin();
            UpdateShards(pose, shards);
            if (armL && armL.gameObject.activeSelf && pose.gesture == BladeGesture.Point && leftT > 0.3f)
            {
                // 剑指：指尖一点灵光（轻微脉动）
                float pulse = 0.8f + 0.2f * Mathf.Sin(time * 9f);
                var c = Color.Lerp(BladeMeshes.Purple, Color.white, 0.35f) * 2.2f;
                c.a = BladeSwing.Smooth(leftT) * pulse;
                glints.Add(FingerTip, 0.05f, c);
            }
            if (strikeFlash > 0.02f)
            {
                var tip = cur.BladePoint((float)BladeShape.SpineX(BladeShape.BladeLen), BladeSwing.StretchY((float)BladeShape.BladeLen, stretch), ModelScale, BladeMeshes.GripY);
                var c = Color.Lerp(BladeMeshes.Purple, Color.white, 0.6f) * 2.6f;
                c.a = strikeFlash;
                glints.Add(tip, 0.09f + 0.05f * strikeFlash, c);
            }
            glints.End();

            model.SetAwake(Mathf.Max(pose.eye, pose.union));
            model.SetGlow(hitFlash * 0.6f + strikeFlash * 0.35f + pose.union * 0.4f + (stretch - 1) * 0.5f + arriveGlow);
            var trailColor = Color.Lerp(BladeMeshes.Purple, Color.white, 0.15f + 0.3f * pose.union);
            trail.Tick(dt, trailColor);
        }

        void AnimateSwing(float dt, in BladePose pose)
        {
            int seg = Mathf.Clamp(pose.swing, 0, clips.Length - 1);
            var clip = Clip(seg, pose.slash);
            if (mode != pose.swing || pose.swing != lastSwing || pose.swingP < visP - 0.3f)
            {
                from = cur;
                mode = pose.swing;
                visP = 0;
                lastTip = TipOf(cur, stretch);
                trail.Break();
            }
            lastSwing = pose.swing;
            // 顿帧：视觉进度停在出刀位置，之后追上逻辑进度
            float prevP = visP;
            if (hitStopLeft <= 0) visP = Mathf.Min(pose.swingP, visP + dt * 12 + Mathf.Max(0, pose.swingP - visP) * 0.6f);
            float rate = dt > 1e-5f ? (visP - prevP) / dt : 0;

            // 刀光：把本帧走过的进度细分采样（蓄势段与收势后段不拖光）；外沿速度 = 剪辑里刀尖对进度的导数 × 本帧的进度速率
            if (visP > prevP)
            {
                for (int k = 1; k <= TrailSub; k++)
                {
                    float p = prevP + (visP - prevP) * k / TrailSub;
                    if (p < clip.WindupP || p > clip.RecoverP) continue;
                    var sp = SwingPose(clip, p);
                    float st = StretchAt(clip, p);
                    var inner = sp.BladePoint(0.004f, BladeSwing.StretchY((float)BladeShape.BladeLen * TrailInner, st), ModelScale, BladeMeshes.GripY);
                    var outer = TipOf(sp, st);
                    const float dp = 0.01f;
                    var back = TipOf(SwingPose(clip, Mathf.Max(0, p - dp)), StretchAt(clip, Mathf.Max(0, p - dp)));
                    float speed = (outer - back).magnitude / dp * rate;
                    trail.Push(inner, outer, speed);
                }
            }
            var now = SwingPose(clip, visP);
            clipStretch = clip.StretchP(visP);
            lastTip = TipOf(cur, stretch);
            cur = now;
            DispatchEvents(clip, prevP, visP);
        }

        /// <summary>剪辑里的伸刃倍率（不含人刀合一）</summary>
        static float StretchAt(BladeSwingClip clip, float p) => clip.StretchP(p);

        /// <summary>挥砍刀姿：蓄势段从进入这一段时的姿态平滑转到剪辑的出刀姿态，之后照剪辑</summary>
        BladeHoldPose SwingPose(BladeSwingClip clip, float p)
        {
            float a = clip.WindupP;
            if (p < a) return BladeHoldPose.Lerp(from, clip.SampleP(a), BladeSwing.Smooth(p / Mathf.Max(1e-4f, a)));
            return clip.SampleP(p);
        }

        /// <summary>伸长后的刀尖（相机空间）</summary>
        static Vector3 TipOf(in BladeHoldPose pose, float stretch) =>
            pose.BladePoint(-0.02f, BladeSwing.StretchY((float)BladeShape.BladeLen, stretch), ModelScale, BladeMeshes.GripY);

        /// <summary>视觉进度从 prevP 走到 p：越过的剪辑事件按名字派发（同一帧可能越过好几个）</summary>
        void DispatchEvents(BladeSwingClip clip, float prevP, float p)
        {
            if (p <= prevP) return;
            foreach (var e in clip.Events)
            {
                float tp = e.time / clip.duration;
                if (tp <= prevP || tp > p) continue;
                switch (e.functionName)
                {
                    case BladeSwing.WindupEvent:
                        OnBladeWindup(e.intParameter);
                        break;
                    case BladeSwing.StrikeEvent:
                        OnBladeStrike(e.intParameter);
                        break;
                    case BladeSwing.RecoverEvent:
                        OnBladeRecover(e.intParameter);
                        break;
                }
            }
        }

        /// <summary>第 seg 段的剪辑（第一次用时按武器表生成；武器表换了就重建）</summary>
        BladeSwingClip Clip(int seg, BladeSlash slash)
        {
            var c = clips[seg];
            if (c != null && (slash == null || c.Matches(slash))) return c;
            slash ??= DefaultSlash(seg);
            c = new BladeSwingClip(seg, slash, true);
            clips[seg] = c;
            return c;
        }

        static BladeSlash DefaultSlash(int seg)
        {
            var combo = (WeaponLibrary.Get(DemonBladeDef.WeaponId)?.blade ?? DemonBladeDef.CreateSpec()).combo;
            return combo.Length > 0 ? combo[Mathf.Clamp(seg, 0, combo.Length - 1)] : new BladeSlash { windup = 0.08f, duration = 0.3f, stretch = 1 };
        }

        void ApplyHold()
        {
            if (hold) hold.SetLocalPositionAndRotation(cur.pos, cur.rot);
        }

        /// <summary>
        /// 美术右手：握把轴对准刀柄（刀身 +Y），拳心落在刀柄轴线上；再绕刀柄扭转，让前臂尽量指向画面右下方的肘部（同 TS poseArtRight）。
        /// 挂在 Grip 下（含刀模缩放），所以只在刀身局部空间里求朝向
        /// </summary>
        void PoseRightArm(float dt)
        {
            if (!armR) return;
            var gripRot = Quaternion.FromToRotation(ArtRightGrip, Vector3.up);
            var f1 = gripRot * ArtRightFore;
            var wrist = cur.pos + cur.rot * (RightWrist * ModelScale);
            var e = Quaternion.Inverse(cur.rot) * (RightElbow - wrist);
            float want = Mathf.Atan2(e.x, e.z) - Mathf.Atan2(f1.x, f1.z);
            float d = Mathf.DeltaAngle(twist * Mathf.Rad2Deg, want * Mathf.Rad2Deg) * Mathf.Deg2Rad;
            twist += d * (snapTwist ? 1 : Mathf.Min(1, dt * 18));
            snapTwist = false;
            var q = Quaternion.AngleAxis(twist * Mathf.Rad2Deg, Vector3.up) * gripRot;
            armR.SetLocalPositionAndRotation(-(q * ArtRightFist), q);
        }

        /// <summary>
        /// 美术左手 + 剑指的两根手指：手指方向对准手势的指向，绕手指的翻转让前臂朝画面左下方伸出去；从画面下方抬进来（0.14 s 平滑）。
        /// 手势之间切换时朝向球面插值，不会突然翻转
        /// </summary>
        void PoseLeftArm(float dt, BladeGesture gesture)
        {
            leftT += (BladeSwing.LeftHandWeight(gesture) - leftT) * Mathf.Min(1, dt * 14);
            if (!armL) return;
            bool show = leftT > 0.02f;
            if (armL.gameObject.activeSelf != show) armL.gameObject.SetActive(show);
            if (!show) return;
            if (gesture != BladeGesture.None) leftGesture = gesture;
            float k = BladeSwing.Smooth(leftT);
            var t = leftGesture == BladeGesture.Shield ? LeftSeal : leftGesture == BladeGesture.Raise ? LeftRaise : LeftPoint;
            var fit = signFit ?? BladeSwordSign.For(null);
            var q = LeftRotation(fit.dir, t.fingers, t.fore);
            var pos = t.palm + new Vector3(0, -0.22f * (1 - k), 0);
            if (!leftPosed)
            {
                leftRot = q;
                leftPosed = true;
            }
            else leftRot = Quaternion.Slerp(leftRot, q, Mathf.Min(1, dt * 16));
            armL.SetLocalPositionAndRotation(pos, leftRot);
        }

        BladeGesture leftGesture = BladeGesture.Point;
        Quaternion leftRot = Quaternion.identity;
        bool leftPosed;

        /// <summary>美术左手臂的前臂方向（手臂局部，从手掌伸向肘部）</summary>
        public static Vector3 LeftForearmLocal => ArtLeftFore;

        /// <summary>手势的左手目标（相机空间）：手掌原点、剑指手指方向、前臂大致朝向；没有手势时按剑指（左手收在画面下方）</summary>
        public static void LeftTarget(BladeGesture g, out Vector3 palm, out Vector3 fingers, out Vector3 fore)
        {
            var t = g == BladeGesture.Shield ? LeftSeal : g == BladeGesture.Raise ? LeftRaise : LeftPoint;
            palm = t.palm;
            fingers = t.fingers;
            fore = t.fore;
        }

        /// <summary>手臂局部的手指方向 → 相机空间的手指方向（精确），前臂（手臂局部 <see cref="ArtLeftFore"/>）尽量朝 foreCam</summary>
        public static Quaternion LeftRotation(Vector3 fingerLocal, Vector3 fingerCam, Vector3 foreCam)
        {
            var fl = fingerLocal.normalized;
            var fc = fingerCam.normalized;
            var upA = -(ArtLeftFore - fl * Vector3.Dot(ArtLeftFore, fl));
            var upC = -(foreCam - fc * Vector3.Dot(foreCam, fc));
            if (upA.sqrMagnitude < 1e-6f) upA = Vector3.up;
            if (upC.sqrMagnitude < 1e-6f) upC = Vector3.up;
            return Quaternion.LookRotation(fc, upC) * Quaternion.Inverse(Quaternion.LookRotation(fl, upA));
        }

        /// <summary>归位闪的分段数：沿刀身每段合成一颗光点</summary>
        const int GlintSegs = 6;
        readonly Vector3[] segPos = new Vector3[GlintSegs];
        readonly float[] segWeight = new float[GlintSegs], segPeak = new float[GlintSegs];

        /// <summary>碎片：在手里的按原位显示（伸刃拉开、横向错动），刚归位的放大一下；归位闪按刀身分段合成几颗中等大小的光点</summary>
        void UpdateShards(in BladePose pose, BladeShards shards)
        {
            float spread = stretch - 1;
            float now = shards != null ? shards.Now : 0;
            float glowSum = 0;
            System.Array.Clear(segWeight, 0, GlintSegs);
            System.Array.Clear(segPeak, 0, GlintSegs);
            for (int i = 0; i < BladeShape.ShardCount; i++)
            {
                bool shown = shards == null || shards.InHand(i);
                var local = BladeModel.HomeLocal(i);
                int seg = Mathf.Clamp((int)(local.y / (float)BladeShape.BladeLen * GlintSegs), 0, GlintSegs - 1);
                local.y = BladeSwing.StretchY(local.y, stretch);
                local.x += spread * 0.006f * Mathf.Sin(i * 7.31f + time * 3);
                float arrive = shown && shards != null ? Mathf.Exp(-(now - shards.arrivedAt[i]) * ArriveDecay) * ArrivePeak : 0;
                if (arrive < 0.02f) arrive = 0;
                model.SetShardLocal(i, shown, local, 1 + 0.2f * Mathf.Min(1, arrive));
                if (arrive > 0)
                {
                    glowSum += arrive;
                    var p = cur.BladePoint(local.x, local.y, ModelScale, BladeMeshes.GripY);
                    segPos[seg] = segWeight[seg] > 0 ? segPos[seg] + p * arrive : p * arrive;
                    segWeight[seg] += arrive;
                    segPeak[seg] = Mathf.Max(segPeak[seg], arrive);
                }
            }
            // 风格审查（准则 ④）：原来每块碎片各亮一颗 3 cm 的小光点，第三段伸刃时刀身上是一串细碎的粉紫点；
            // 现在每段一颗（落在这一段亮的碎片的加权中心），大一些、少一些，整把刀仍是一段段闪过去
            var c0 = Color.Lerp(BladeMeshes.Purple, BladeMeshes.ShardSpark, 0.6f) * 1.4f;
            for (int s = 0; s < GlintSegs; s++)
            {
                if (segWeight[s] <= 0) continue;
                float k = Mathf.Min(1, segPeak[s]);
                var c = c0;
                c.a = Mathf.Min(0.55f, segPeak[s] * 0.4f);
                glints.Add(segPos[s] / segWeight[s], 0.06f + 0.035f * k, c);
            }
            arriveGlow = Mathf.Min(0.6f, glowSum * 0.012f);
        }

        /// <summary>
        /// 没有被控制器驱动的帧：要么切走了正在收枪（跟着切枪的收枪进度沉下去，刀光放完），要么该藏起来了
        /// </summary>
        void LateUpdate()
        {
            if (driven)
            {
                driven = false;
                return;
            }
            if (wantShown) return;
            if (wc && wc.SwitchTimer > 0 && wc.Holstering?.def != null && wc.Holstering.def.IsBlade && WeaponTiming.SwitchPose(wc.SwitchTimer, true, out float lower))
            {
                if (sway) sway.lower = lower;
                trail?.Tick(Time.deltaTime, BladeMeshes.Purple);
                return;
            }
            trail?.Clear();
            glints?.Clear();
            gameObject.SetActive(false);
        }
    }
}
