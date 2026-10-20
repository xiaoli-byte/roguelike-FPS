using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家武器（Three.js 版 WeaponSystem + Firing）。三层：
    ///   · <see cref="WeaponStateMachine"/>（纯逻辑）：两个槽、切枪（先收后出 0.35 s，每把枪各自的 readyAt）、开火缓冲 0.14 s、
    ///     开火模式（<see cref="IFireMode"/>：半自动 / 全自动 / 点射 / 光束 / 预热 / 蓄力 / 齐射，见 Weapons/FireModes）、
    ///     换弹（整匣 / 逐发 + 0.3 s 上膛）、打空自动换弹与空仓、无限弹药、应急补给、换关清理；
    ///   · <see cref="Ballistics"/>：命中扫描（穿透、弱点、贴脸）、投射物、光束一跳；
    ///   · 这里：读输入（<see cref="GameInput"/>，手柄同样可用；TestMode 读 testFire / testAim / testReload / testSwitch）、开镜（FOV 层）、散布、
    ///     后坐与反馈、音效与事件、第一人称 rig（每把枪一个，由 PlayerRigBuilder / PlayerFactory 生成，这里只切显示、写开镜 / 下沉 / 后坐）、
    ///     武器接管（<see cref="IWeaponTakeover"/>，碎刃）、HUD 数据源（<see cref="IWeaponHudSource"/>）。
    /// 散布 = (腰射 / 开镜基础 × 移动 × 空中 + 连射累积) × 散布倍率 的半角。
    /// 后坐：抬枪量 = pitch × (1 + 连发数 × climb) × 开镜减半 × 后坐倍率 × RecoilScale，交给 <see cref="PlayerMotor.AddRecoil"/> 记成回正债。
    /// 镜头（F3）：弹道从 <see cref="Aim"/>（motor.eye，不抖）出发；渲染相机的姿态和 FOV 只由 <see cref="CameraFeel"/> 写——
    /// 这里只给开镜层 <see cref="FovKick"/>，开枪的震屏 / 向后一顿交给 <see cref="CameraFeel.FireKick"/>。
    /// 跨关：<see cref="IRunPersistent"/> 把两个槽存进 <see cref="RunState.weapons"/>；关卡就绪（<see cref="GameEvents.StageLoaded"/>）时 <see cref="ClearForStage"/>，
    /// 补 35% 备弹由 LootDirector 在同一事件上调 <see cref="RefillReserve"/>。
    /// </summary>
    public sealed class WeaponController : MonoBehaviour, IRunPersistent, IWeaponEffects, IWeaponHudSource
    {
        [Serializable]
        public sealed class Rig
        {
            public string weaponId;
            public FirstPersonViewmodel view;
        }

        public Camera eye;
        public Rig[] rigs = Array.Empty<Rig>();
        public string startWeapon = "smg";
        /// <summary>腰射 FOV：运行时由设置「视野」覆盖（默认 80°，见 <see cref="GameSettings.Fov"/>）；只用来按开镜缩放视角灵敏度，相机 FOV 由 CameraFeel 写</summary>
        public float baseFov = 70f;

        public readonly WeaponInstance[] slots = new WeaponInstance[2];

        /// <summary>武器状态机（第一次访问时建）</summary>
        public WeaponStateMachine Machine => machine ??= CreateMachine();
        public int ActiveSlot => Machine.ActiveSlot;
        public WeaponInstance Active => slots[ActiveSlot];
        public bool Reloading => Machine.Reloading;
        public float ReloadProgress => Machine.ReloadProgress;
        /// <summary>当前散布半角（弧度，含霰弹锥），准星读取</summary>
        public float HudSpread { get; private set; }
        public float AimT => aimT;
        /// <summary>开镜层（度，负数 = 放大）= 武器 aimFov × 开镜程度；<see cref="CameraFeel"/> 叠到设置视野上</summary>
        public float FovKick { get; private set; }
        /// <summary>瞄准 / 弹道的基准：motor.eye（不带晃动、震屏、冲击）；没有 motor.eye 时退回相机</summary>
        public Transform Aim => motor && motor.eye ? motor.eye : eye ? eye.transform : transform;
        /// <summary>当前武器的开火模式</summary>
        public IFireMode ActiveMode => Machine.Mode;
        /// <summary>切枪剩余时间（秒）；收枪阶段显示的旧枪</summary>
        public float SwitchTimer => Machine.SwitchTimer;
        public WeaponInstance Holstering => Machine.Holster;
        /// <summary>HUD 数据源：平时是控制器自己，武器被接管时换成接管者的（它给 null 时仍是控制器）</summary>
        public IWeaponHudSource Hud => takeover?.Hud ?? this;
        /// <summary>当前接管者（碎刃）；没有为 null</summary>
        public IWeaponTakeover Takeover => takeover;

        /// <summary>
        /// 武器带来的移速变化（米 / 秒，负数 = 减速）：机炮转满开火时 −def.moveSlow（TS −2）。
        /// 已经以属性来源 <see cref="SlowSource"/> 加进玩家属性表的 MoveSpeed（PlayerVitals 每次属性变化写 motor.walkSpeed，同 TS 的 stats.add），
        /// 这里只读：给镜头 / 第一人称 / 动作参考，PlayerMotor 不要再叠一次
        /// </summary>
        public float MoveSpeedDelta => -appliedSlow;
        public const string SlowSource = "weapon:minigun";

        /// <summary>局内旗标名：&gt; 0 时无限弹药（同 TS run.flags.infiniteAmmo，技能写入；换关归零由局流程负责）</summary>
        public const string InfiniteAmmoFlag = "infiniteAmmo";
        /// <summary>无限弹药：本组件的计数（<see cref="AddInfiniteAmmo"/>）或局内旗标任一 &gt; 0</summary>
        public bool InfiniteAmmo => infiniteStacks > 0 || (RunState.Current != null && RunState.Current.Flag(InfiniteAmmoFlag) > 0);
        /// <summary>加一层无限弹药（技能开始时调，结束时 <see cref="RemoveInfiniteAmmo"/>；换关清零）</summary>
        public void AddInfiniteAmmo() => infiniteStacks++;
        public void RemoveInfiniteAmmo() => infiniteStacks = Mathf.Max(0, infiniteStacks - 1);

        public event Action<WeaponInstance> Fired;
        public event Action Changed;

        /// <summary>
        /// 自动化冒烟测试：绕过鼠标锁定与真实输入，由 testFire / testAim / testReload / testSwitch 驱动。
        /// 按住 testFire 时点射 / 齐射自动连发、蓄力满了自动松手（套件只对 Semi 一下一下扣），所以每种开火模式都能用它驱动
        /// </summary>
        public static bool TestMode;
        [NonSerialized] public bool testFire, testAim, testReload;
        [NonSerialized] public int testSwitch = -1;
        bool prevTestFire;

        PlayerMotor motor;
        PlayerVitals vitals;
        Collider selfCollider;
        WeaponStateMachine machine;
        Ballistics ballistics;
        readonly BeamLine beam = new();
        IWeaponTakeover takeover;
        WeaponInstance engaged;
        float bloom, lastShot = -10, aimT, spreadNow, appliedSlow;
        int consecutive, infiniteStacks;
        CameraFeel feel;
        string shownRig = "\0";
        /// <summary>
        /// 后坐整体缩放。这不是硬核 FPS：目标是「射得爽」，后坐只做手感、不做惩罚——镜头只轻轻上跳（0.3）且会完全回正，
        /// 枪模保留明显的上抬（0.55）当作打击感。要单独调某把枪改武器表，整体手感改这里
        /// </summary>
        const float RecoilScale = 0.3f, ViewKickScale = 0.55f;
        /// <summary>持接管武器（碎刃）时准星张开到这个半角，提示近战</summary>
        const float MeleeHudSpread = 0.035f;
        static readonly Vector3 MuzzleHip = new(0.2f, -0.13f, 0.75f), MuzzleAim = new(0, -0.08f, 0.7f);

        void Awake()
        {
            motor = GetComponent<PlayerMotor>();
            vitals = GetComponent<PlayerVitals>();
            selfCollider = GetComponent<Collider>();
            ballistics = new Ballistics(selfCollider, this);
            var def = WeaponLibrary.Get(startWeapon) ?? WeaponLibrary.Get("smg");
            slots[0] = new WeaponInstance(def);
            ApplyRigs(Active?.def.id);
            OnSetting(null);
            // 镜头手感（F3）：PlayerFactory 已经挂好；旧场景烘好的玩家在这里补（同时插入 Head 节点）
            feel = CameraFeel.Ensure(gameObject);
        }

        /// <summary>运行时 PlayerFactory 在 AddComponent（Awake）之后才填 rigs：第一帧按最终的 rigs 重新显示一次</summary>
        void Start() => shownRig = "\0";

        WeaponStateMachine CreateMachine() => new(slots, this, () => Time.time, Resolved)
        {
            isTakeover = w => WeaponTakeovers.Find(w) != null,
            enemiesAlive = AnyEnemyAlive,
        };

        StatSheet Stats => vitals ? vitals.stats : null;
        /// <summary>实际数值（定义 × 品质 × 强化 × 词条 × 玩家属性，带缓存）：开火、换弹、散布、后坐都读它</summary>
        ResolvedWeapon Resolved(WeaponInstance w) => WeaponStatsResolver.Resolve(w, Stats);

        static bool AnyEnemyAlive()
        {
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
                if (all[i] && !all[i].Dead) return true;
            return false;
        }

        void OnEnable()
        {
            RunPersistence.Register(this);
            GameSettings.Changed += OnSetting;
            GameEvents.StageLoaded += OnStageLoaded;
        }

        void OnDisable()
        {
            RunPersistence.Unregister(this);
            GameSettings.Changed -= OnSetting;
            GameEvents.StageLoaded -= OnStageLoaded;
            ApplySlow(0);
            ReleaseTakeover();
            beam.Hide();
        }

        void OnDestroy() => beam.Destroy();

        /// <summary>设置「视野」= 腰射 FOV（开镜按武器的 aimFov 在它上面收）</summary>
        void OnSetting(SettingDef d)
        {
            if (d == null || d == GameSettings.Fov) baseFov = GameSettings.Fov.Value;
        }

        // ───────────── 跨关 / 拾取 / 弹药 ─────────────

        /// <summary>跨关快照：两个槽的枪（定义、品质、强化、元素、弹药、词条）和当前槽</summary>
        public void Capture(RunState s)
        {
            s.weapons ??= new List<WeaponSave>();
            s.weapons.Clear();
            for (int i = 0; i < slots.Length; i++)
            {
                var w = slots[i];
                if (w == null) continue;
                s.weapons.Add(new WeaponSave { id = w.def.id, rarity = w.rarity, level = w.level, element = w.element, mag = w.mag, reserve = w.reserve, active = i == ActiveSlot, affixes = AffixSave.Capture(w) });
            }
        }

        /// <summary>按快照重建两个槽（不放切枪音效、不发切枪事件）；快照里没有枪时保持开局武器</summary>
        public void Restore(RunState s)
        {
            if (s.weapons == null || s.weapons.Count == 0) return;
            int active = 0, n = 0;
            for (int i = 0; i < slots.Length; i++) slots[i] = null;
            foreach (var save in s.weapons)
            {
                var def = WeaponLibrary.Get(save.id);
                if (def == null || n >= slots.Length) continue;
                slots[n] = new WeaponInstance(def, save.rarity) { level = save.level, element = save.element, mag = save.mag, reserve = save.reserve };
                AffixSave.Restore(slots[n], save.affixes);
                if (save.active) active = n;
                n++;
            }
            if (n == 0) slots[0] = new WeaponInstance(WeaponLibrary.Get(startWeapon) ?? WeaponLibrary.Get("smg"));
            ReleaseTakeover();
            Machine.Reset(active);
            consecutive = 0;
            bloom = 0;
            beam.Hide();
            ApplySlow(0);
            ApplyRigs(Active?.def.id);
            Changed?.Invoke();
        }

        /// <summary>拾取 / 宝箱给的枪：有空槽放空槽，否则替换当前槽；返回被替换下来的枪</summary>
        public WeaponInstance Give(WeaponInstance w) => Machine.Give(w);

        /// <summary>按备弹上限的比例补备弹（弹药掉落；已满的跳过、否则至少 1 发）</summary>
        public void RefillReserve(float fraction)
        {
            Machine.AddAmmoFraction(fraction);
            Changed?.Invoke();
        }

        /// <summary>同 <see cref="RefillReserve"/>（TS 名字）；返回是否补了</summary>
        public bool AddAmmoFraction(float fraction)
        {
            bool any = Machine.AddAmmoFraction(fraction);
            if (any) Changed?.Invoke();
            return any;
        }

        /// <summary>
        /// 换关 / 开局（同 TS Game.clearStage → weapons.clear）：进行中的换弹直接完成、停下一切动作（光束、机炮减速、蓄力、齐射剩余作废）、
        /// 退镜、清散布与冷却、清无限弹药计数、收起接管武器。不补弹药。
        /// 自己订阅了 <see cref="GameEvents.StageLoaded"/>；换关补 35% 备弹由 LootDirector 在同一事件上调 <see cref="RefillReserve"/>（EconomyConfig.StageAmmoRefill，同 TS Loot.ts），这里不重复补
        /// </summary>
        public void ClearForStage()
        {
            ReleaseTakeover();
            Machine.ClearForStage();
            infiniteStacks = 0;
            aimT = 0;
            bloom = 0;
            consecutive = 0;
            beam.Hide();
            ApplySlow(0);
            FovKick = 0;
            if (motor) motor.lookScale = 1;
        }

        void OnStageLoaded(StageSpec s) => ClearForStage();

        // ───────────── 第一人称 rig ─────────────

        void ApplyRigs(string id)
        {
            shownRig = id;
            foreach (var r in rigs)
                if (r.view) r.view.gameObject.SetActive(id != null && r.weaponId == id);
        }

        FirstPersonViewmodel ViewFor(string id)
        {
            if (id == null) return null;
            foreach (var r in rigs)
                if (r.weaponId == id) return r.view;
            return null;
        }

        /// <summary>枪口（曳光、投射物的出生点）：跟着渲染相机（看得见的枪模）走；方向仍由 <see cref="Aim"/> 决定</summary>
        Vector3 Muzzle() => eye.transform.TransformPoint(Vector3.Lerp(MuzzleHip, MuzzleAim, aimT));

        // ───────────── 每帧 ─────────────

        void Update()
        {
            var w = Active;
            if (w == null || !eye) return;
            var sm = Machine;
            float dt = Time.deltaTime;
            bool alive = !vitals || !vitals.Dead;
            bool canAct = (TestMode || (motor.inputEnabled && Cursor.lockState == CursorLockMode.Locked)) && alive;

            // ── 切枪 ──
            if (canAct)
            {
                if (GameInput.Pressed(GameAction.Weapon1)) sm.SwitchTo(0);
                if (GameInput.Pressed(GameAction.Weapon2)) sm.SwitchTo(1);
                if (GameInput.Pressed(GameAction.Swap)) sm.Swap();
            }
            if (TestMode && testSwitch >= 0)
            {
                sm.SwitchTo(testSwitch);
                testSwitch = -1;
            }
            w = Active;
            if (w == null) return;
            // 接管：当前武器归谁管变了（或换成了同一接管者的另一把）就先收起旧的再接上新的；死亡时接管者收到 ready = false
            var tk = WeaponTakeovers.Find(w);
            if (tk != takeover || (tk != null && w != engaged))
            {
                ReleaseTakeover();
                takeover = tk;
                engaged = tk != null ? w : null;
                tk?.Engage(this, w);
            }

            // ── 输入 ──
            bool fireDown = canAct && (TestMode ? testFire : GameInput.Down(GameAction.Fire));
            bool firePressed = canAct && (TestMode ? testFire && !prevTestFire : GameInput.Pressed(GameAction.Fire));
            prevTestFire = testFire;
            bool reloadPressed = canAct && (TestMode ? testReload : GameInput.Pressed(GameAction.Reload));
            testReload = false;
            bool aimInput = canAct && (TestMode ? testAim : GameInput.Down(GameAction.Aim));

            // ── 开镜（换弹 / 切枪 / 冲刺 / 被接管时不开镜）──
            bool aiming = aimInput && tk == null && !sm.Reloading && sm.SwitchTimer <= 0 && !motor.Dashing;
            aimT = Mathf.MoveTowards(aimT, aiming ? 1 : 0, dt * 7f);
            FovKick = w.def.aimFov * aimT;
            float fov = baseFov + FovKick;
            if (!feel) eye.fieldOfView = fov;
            motor.lookScale = Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(baseFov * 0.5f * Mathf.Deg2Rad);

            // ── 状态机：换弹 → 开火模式 → 空匣 / 补给 ──
            sm.Tick(new WeaponFrame
            {
                dt = dt, alive = alive, canAct = canAct, fireDown = fireDown, firePressed = firePressed, reloadPressed = reloadPressed,
                blocked = motor.Dashing, infinite = InfiniteAmmo, takeover = tk != null, testAuto = TestMode,
            });

            if (tk != null)
            {
                tk.Tick(this, w, new TakeoverInput
                {
                    dt = dt, fireDown = fireDown, firePressed = firePressed, aimDown = aimInput,
                    reloadDown = canAct && !TestMode && GameInput.Down(GameAction.Reload),
                    skillPressed = canAct && !TestMode && GameInput.Pressed(GameAction.WeaponSkill),
                    ready = sm.SwitchTimer <= 0 && alive, speed = Resolved(w).fireRateMult,
                });
                ApplySlow(0);
                HudSpread = Mathf.Lerp(HudSpread, MeleeHudSpread, 1 - Mathf.Exp(-18f * dt));
            }
            else
            {
                ApplySlow(sm.MoveSlow);
                UpdateSpread(dt);
            }
            UpdateViewmodel();
        }

        void LateUpdate()
        {
            var w = Active;
            if (eye && w != null) beam.Draw(Muzzle(), DamageTable.ElementColor(w.element));
            else beam.Hide();
        }

        /// <summary>先收后出：收枪阶段显示旧枪下沉，之后新枪抬起；换弹时下沉 sin(进度 × π) × 0.6；接管渲染时不显示 rig</summary>
        void UpdateViewmodel()
        {
            var sm = Machine;
            bool showHolster = WeaponTiming.SwitchPose(sm.SwitchTimer, sm.Holster != null, out float switchLower);
            var shown = showHolster ? sm.Holster : Active;
            bool hidden = !showHolster && takeover != null && takeover.OwnsViewmodel;
            string id = hidden ? null : shown?.def.id;
            if (id != shownRig) ApplyRigs(id);
            var view = ViewFor(id);
            if (!view) return;
            view.aim = showHolster ? 0 : aimT;
            float reloadLower = !showHolster && sm.Reloading ? Mathf.Sin(Mathf.Clamp01(sm.ReloadProgress) * Mathf.PI) * 0.6f : 0;
            view.lower = Mathf.Max(reloadLower, switchLower);
        }

        void UpdateSpread(float dt)
        {
            var w = Active;
            if (w == null) return;
            var def = w.def;
            var R = Resolved(w);
            float delay = Mathf.Clamp(1.25f / Mathf.Max(0.1f, R.fireRate * Mathf.Max(1, def.burstCount)), 0.08f, 0.35f);
            if (Time.time - lastShot > delay) bloom = Mathf.Max(0, bloom - def.spreadRecovery * dt);
            float baseSpread = Mathf.Lerp(def.spreadHip, def.spreadAim, aimT);
            var v = motor.Velocity;
            // 跑动 / 滞空只轻微放大散布（Three.js 版是 +60% / ×1.5）：边跑边打、跳起来打都要打得中（同 RecoilScale 注释：要射得爽）
            float moveF = 1 + Mathf.Clamp01(new Vector2(v.x, v.z).magnitude / 7.5f) * (0.2f - 0.1f * aimT);
            float airF = motor.Grounded ? 1 : 1.15f - 0.1f * aimT;
            spreadNow = (baseSpread * moveF * airF + bloom * (1 - 0.45f * aimT)) * R.spreadMult;
            float hud = Mathf.Clamp(spreadNow + PelletCone(def, R), 0, 0.25f);
            HudSpread = Mathf.Lerp(HudSpread, hud, 1 - Mathf.Exp(-18f * dt));
        }

        float PelletCone(WeaponDef def, ResolvedWeapon R) => def.pelletCone > 0 ? def.pelletCone * Mathf.Lerp(1, 0.72f, aimT) * R.spreadMult : 0;

        /// <summary>机炮减速登记成属性来源（同 TS updateSlow）；只在变化时改属性表</summary>
        void ApplySlow(float slow)
        {
            if (Mathf.Approximately(slow, appliedSlow)) return;
            var s = Stats;
            if (s == null)
            {
                appliedSlow = 0;
                return;
            }
            s.BeginBatch();
            try
            {
                s.Remove(SlowSource);
                if (slow > 0) s.Add(SlowSource, Stat.MoveSpeed, -slow);
            }
            finally { s.EndBatch(); }
            appliedSlow = slow;
        }

        void ReleaseTakeover()
        {
            var tk = takeover;
            takeover = null;
            engaged = null;
            tk?.Release(this);
        }

        // ───────────── IWeaponEffects：弹道与反馈 ─────────────

        ShotContext Context(WeaponInstance w, ResolvedWeapon R, Element el, in ShotMods mods) => new()
        {
            weapon = w, stats = R, element = el, damage = R.damage * mods.mult, pierce = R.pierce + mods.pierceBonus,
            full = mods.full, detonate = mods.full && w.def.chargeDetonate, forceCrit = mods.forceCrit,
        };

        /// <summary>一次射击：连射计数、散布累积、弹道（命中扫描逐弹丸 / 投射物 / 光束一跳；齐射开始时不发）、反馈、事件</summary>
        void IWeaponEffects.Shoot(WeaponInstance w, in ShotMods mods, Element element)
        {
            var def = w.def;
            var R = Resolved(w);
            float now = Time.time;
            float gap = 1f / Mathf.Max(0.1f, R.fireRate * Mathf.Max(1, def.burstCount));
            consecutive = now - lastShot < gap * 1.6f + 0.05f ? consecutive + 1 : 0;
            lastShot = now;

            var camT = Aim;
            var origin = camT.position;
            var muzzle = Muzzle();
            var ctx = Context(w, R, element, in mods);
            // 整发的方向先按散布偏一次（霰弹整团跟着走），每颗弹丸再在锥内偏
            var center = Ballistics.Scatter(camT.forward, camT, spreadNow);
            if (mods.deferred) { }
            else if (def.projectile != null) ballistics.Projectile(in ctx, origin, center, muzzle);
            else if (def.mode == FireMode.Beam)
            {
                ballistics.BeamTick(in ctx, origin, center, muzzle, out var end);
                beam.Hold(end, 1.4f / Mathf.Max(1, def.fireRate));
            }
            else
            {
                float cone = PelletCone(def, R);
                bool multi = def.pellets > 1;
                for (int i = 0; i < def.pellets; i++)
                {
                    var dir = multi ? Ballistics.Scatter(center, camT, cone) : center;
                    ballistics.Hitscan(in ctx, origin, dir, muzzle, multi ? 0.6f : 1f, Ballistics.TracerColor, multi ? 0.012f : 0.02f, out _);
                }
            }

            bloom = Mathf.Min(def.spreadMax, bloom + def.spreadPerShot);
            if (!mods.deferred) Feedback(w, R, mods.strength, muzzle);
            Fired?.Invoke(w);
            Changed?.Invoke();
            GameEvents.RaiseWeaponFired(w);
        }

        /// <summary>
        /// 齐射的一枚：随机散开（蜂群）每枚各自按散布找落点；固定扇形按整轮槽位间距、以准星为中心排布——第 i 枚偏航 fan × (2i − (n − 1)) / (count − 1)，
        /// 第 2 枚起共享第一枚的落点（同 TS fireVolleyProjectile）
        /// </summary>
        void IWeaponEffects.VolleyProjectile(WeaponInstance w, int index, int count, bool feedback)
        {
            var p = w.def.projectile;
            if (p == null || !eye) return;
            var R = Resolved(w);
            var camT = Aim;
            var muzzle = Muzzle();
            var ctx = Context(w, R, w.element, in WeaponRuntime.Of(w).volley);
            var dir = Ballistics.Scatter(camT.forward, camT, spreadNow);
            if (p.fanFixed)
            {
                float yaw = p.fan * (2 * index - (count - 1)) / Mathf.Max(1, p.count - 1);
                ballistics.Projectile(in ctx, camT.position, dir, muzzle, 0, yaw, index > 0);
            }
            else ballistics.Projectile(in ctx, camT.position, dir, muzzle, p.fan);
            if (feedback) Feedback(w, R, 1, muzzle);
        }

        /// <summary>后坐、第一人称后坐、枪口火焰、枪声（光束是持续音）、镜头（震屏 + 向后一顿，走 CameraFeel）；strength = 蓄力强度</summary>
        void Feedback(WeaponInstance w, ResolvedWeapon R, float strength, Vector3 muzzle)
        {
            var def = w.def;
            float climb = 1 + Mathf.Min(consecutive, 12) * def.recoilClimb;
            // 开镜大幅稳定（参考枪火重生：开镜后坐约为腰射的一半）
            float k = (1 - 0.5f * aimT) * R.recoilMult * strength;
            float pitch = def.recoilPitch * climb * k * UnityEngine.Random.Range(0.85f, 1.15f);
            float yaw = (def.recoilBias + UnityEngine.Random.Range(-1f, 1f) * def.recoilYaw) * k;
            motor.AddRecoil(pitch * RecoilScale * Mathf.Rad2Deg, yaw * RecoilScale * Mathf.Rad2Deg);
            ViewFor(shownRig)?.Kick(def.kickBack * 0.76f * ViewKickScale * strength, def.kickRot * ViewKickScale * strength);
            ShotFx.Instance?.MuzzleFlash(muzzle, def.flash / 0.12f);
            if (def.mode == FireMode.Beam) GameAudio.HoldBeam(def.sfxVolume);
            else GameAudio.Play(def.sfx, def.sfxVolume, 0.94f + UnityEngine.Random.value * 0.12f);
            if (feel) feel.FireKick(def.shake * strength, def.shake > 0.15f ? 0.16f : 0.08f, def.kickBack * strength);
        }

        void IWeaponEffects.Cue(WeaponInstance w, FireCue cue)
        {
            switch (cue)
            {
                case FireCue.SpinUp: GameAudio.Play("weapon_switch", 0.5f, 0.55f); break;
                case FireCue.ChargeStart: GameAudio.Play("weapon_switch", 0.4f, 0.6f); break;
                case FireCue.ChargeFull: GameAudio.Play("telegraph", 0.35f, 1.6f); break;
            }
        }

        void IWeaponEffects.Notify(WeaponNote note, WeaponInstance w, WeaponInstance other)
        {
            switch (note)
            {
                case WeaponNote.Changed:
                    Changed?.Invoke();
                    break;
                case WeaponNote.Acquired:
                    GameEvents.RaiseWeaponAcquired(w);
                    break;
                case WeaponNote.Switched:
                    GameAudio.Play("weapon_switch", 0.7f);
                    consecutive = 0;
                    bloom = 0;
                    Changed?.Invoke();
                    GameEvents.RaiseWeaponSwitched(other, w);
                    break;
                case WeaponNote.ReloadStarted:
                    beam.Hide();
                    GameAudio.Play("reload_start", 0.8f);
                    Changed?.Invoke();
                    GameEvents.RaiseReloadStarted(w);
                    break;
                case WeaponNote.ShellInserted:
                    // 逐发装填：每塞一发一声轻响
                    GameAudio.Play("reload_end", 0.45f, 1.3f + UnityEngine.Random.value * 0.1f);
                    Changed?.Invoke();
                    break;
                case WeaponNote.Reloaded:
                    GameAudio.Play("reload_end", 0.85f);
                    Changed?.Invoke();
                    GameEvents.RaiseReloaded(w);
                    break;
                case WeaponNote.ReloadPartial:
                    Changed?.Invoke();
                    GameEvents.RaiseReloaded(w);
                    break;
                case WeaponNote.DryFire:
                    GameAudio.Play("dry_fire", 0.8f);
                    break;
                case WeaponNote.Resupplied:
                    GameAudio.Play("pickup_ammo");
                    GameUI.Toast("应急补给：弹药 +1 匣", new Color(0.91f, 0.77f, 0.42f));
                    Changed?.Invoke();
                    break;
                case WeaponNote.Stopped:
                    consecutive = 0;
                    beam.Hide();
                    break;
            }
        }

        // ───────────── IWeaponHudSource ─────────────

        WeaponInstance IWeaponHudSource.Weapon => Active;
        int IWeaponHudSource.Mag => Active?.mag ?? 0;
        int IWeaponHudSource.MagCapacity => Active != null ? Resolved(Active).magCap : 0;
        int IWeaponHudSource.Reserve => Active?.reserve ?? 0;
        int IWeaponHudSource.ReserveCapacity => Active != null ? Resolved(Active).reserveCap : 0;
        bool IWeaponHudSource.InfiniteAmmo => InfiniteAmmo;
        bool IWeaponHudSource.Reloading => Reloading;
        float IWeaponHudSource.ReloadProgress => ReloadProgress;
        float IWeaponHudSource.Charge => ActiveMode?.Charge ?? 0;
        bool IWeaponHudSource.ChargeFull => ActiveMode is ChargeMode c && c.Full;
        float IWeaponHudSource.Heat => ActiveMode?.Spin ?? 0;
        bool IWeaponHudSource.Firing => ActiveMode?.Firing ?? false;
        float IWeaponHudSource.Spread => HudSpread;
        float IWeaponHudSource.Aim => aimT;
        string IWeaponHudSource.ModeId => ActiveMode?.Id ?? "";

        Element IWeaponHudSource.NextElement
        {
            get
            {
                var w = Active;
                if (w == null) return Element.None;
                var cycle = w.def.cycle;
                return cycle != null && cycle.Length > 0 ? cycle[w.cycleIndex % cycle.Length] : w.element;
            }
        }
    }
}
