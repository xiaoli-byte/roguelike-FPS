using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃 v2 的玩法控制器（docs/demon-blade-v2.md 第 2–8 节；Three.js DemonBlade.ts 的移植）。
    /// 作为 <see cref="IWeaponTakeover"/>：当前武器是碎刃时 <see cref="WeaponController"/> 不开镜、不换弹、不走开火模式，每帧把输入交给这里
    /// （左键斩、右键千刃出窍、R 碎刃屏障、V / 中键杀气爆发），第一人称也由这里画（<see cref="IBladeView"/>，WC7 起是 <see cref="BladeView"/>）。
    ///   斩：三段连斩（按住自动接段，缓冲 0.35 s，空闲 0.6 s 连段重置），判定帧扇形内所有看得见的敌人各命中一次；斩中回刃气 8、杀意 4；
    ///       每段算一次开火（<see cref="WeaponRuntime.BeginShot"/>：天命计数与必暴、weapon:fired），暴击走正常暴击率，没有爆头。
    ///   千刃出窍：刃群追着准星落点（敌人 &gt; 墙面 &gt; 最远 22 米），碎片到齐 35% 后每 0.1 s 绞杀半径内最多 8 个敌人，无视护盾；刃气 20 / s。
    ///   碎刃屏障：身前圆盾挡下敌方投射物（<see cref="BladeWard"/>），持盾减伤 30%、减速 20%；刃气 25 / s，每挡一发再扣 6、杀意 +5。
    ///   杀气爆发：碎片在落点聚成刃球、0.5 s 后炸开（半径 6、240）；杀意满时变为人刀合一（强化爆发后 8 秒：斩波、出窍不耗刃气、刃群更大、移速 +15%）。
    ///   噬灵鬼眼：用碎刃击杀时睁眼 1.2 s、回复最大生命 2% / 5% / 12%，杀意 +10。
    ///   右键与 R 共用刃气；碎片全部在手里 0.5 s 后每秒回 50。碎片在外时按左键先收刃，碎片回得差不多就接上斩击。
    /// 冷却、杀意衰减、人刀合一计时不论当前武器每帧推进（<see cref="Update"/>）；切走 / 死亡 / 换关时 <see cref="Release"/>：碎片瞬间归刀、屏障与人刀合一结束，冷却与杀意保留。
    /// 伤害来源见 <see cref="DemonBladeDef"/>：斩击 / 斩波 = 武器 + 近战标签，刃群 / 爆发 = 武器；都带本武器的伤害倍率、元素、暴击与 weaponUid。
    /// [GameSystem]：挂在 Game Systems 上，启用时登记为接管者。
    /// </summary>
    [GameSystem(220)]
    public sealed class DemonBladeController : MonoBehaviour, IWeaponTakeover, IWeaponHudSource
    {
        public static DemonBladeController Instance { get; private set; }

        /// <summary>第一人称视图的工厂（WC7：<see cref="BladeView"/>；WC6 的占位视图 <see cref="BladePlaceholderView"/> 留作对照）</summary>
        public static Func<WeaponController, IBladeView> ViewFactory = BladeView.Create;

        /// <summary>放出了杀气爆发 / 人刀合一（技能 id）；按下 V 但冷却中（HUD 闪红）</summary>
        public static event Action<string> SkillUsed;
        public static event Action SkillDenied;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Instance = null;
            ViewFactory = BladeView.Create;
            SkillUsed = null;
            SkillDenied = null;
        }

        enum BurstPhase { None, Gather, Scatter, Return }

        sealed class WaveHit
        {
            public int slot;
            public float amount;
            public Vector3 origin, dir;
            public readonly HashSet<Damageable> hit = new();
        }

        // ── 接管 ──
        WeaponController wc;
        WeaponInstance inst;
        DemonBladeSpec P;
        PlayerVitals vitals;
        CharacterController body;
        CameraFeel feel;

        // ── 表现 ──
        BladeShards shards;
        BladeSwarmRenderer swarm;
        BladeEffects effects;
        BladeWard ward;
        IBladeView view;

        // ── 状态 ──
        public BladeMode Mode { get; private set; } = BladeMode.Hand;
        float qi = 100, qiDelay, intent, intentIdle, unionLeft, burstCd, eyeLeft;
        int comboIndex, swingIdx = -1;
        float swingT, comboIdle, slashBuffer, pendingSlash;
        bool swingHit;
        int rangeFrame;
        bool inRange;
        float tickAcc, swarmSfx, lower = 1;
        Vector3 target;
        BurstPhase burstPhase;
        float burstT;
        bool burstUnion;
        Vector3 burstPoint;
        readonly List<WaveHit> waves = new();
        bool shieldOn, unionOn;
        readonly List<EnemyAI> hits = new();
        readonly List<EnemyAI> snapshot = new();
        static RaycastHit[] rayBuf = new RaycastHit[16];

        // ───────────── 只读状态（HUD / 测试） ─────────────

        /// <summary>当前握着碎刃（已接管）</summary>
        public bool Active => inst != null;
        public WeaponInstance Weapon => inst;
        public BladeShards Shards => shards;
        /// <summary>刃气 0..1、杀意 0..1、人刀合一剩余比例 0..1</summary>
        public float QiFraction => P != null ? Mathf.Clamp01(qi / Mathf.Max(1, P.qi.max)) : 1;
        public float IntentFraction => P != null ? Mathf.Clamp01(intent / Mathf.Max(1, P.intent.max)) : 0;
        public float UnionFraction => P != null && unionLeft > 0 ? Mathf.Clamp01(unionLeft / Mathf.Max(0.01f, P.union.duration)) : 0;
        /// <summary>杀意满：V 变为人刀合一</summary>
        public bool IntentFull => P != null && intent >= P.intent.max;
        public bool UnionActive => unionLeft > 0;
        /// <summary>武器技能（杀气爆发）的剩余冷却与总冷却；杀意满时人刀合一随时可放（剩余 0）</summary>
        public float SkillCooldownLeft => IntentFull ? 0 : Mathf.Max(0, burstCd);
        public float SkillCooldownTotal => DemonBladeDef.CooldownTotal(P ?? Spec, SkillHaste);
        /// <summary>技能生效中（爆发过程或人刀合一）</summary>
        public bool SkillBusy => burstPhase != BurstPhase.None || unionLeft > 0;
        /// <summary>准星指向的敌人在当前这一段斩击范围内</summary>
        public bool InRange => inRange;

        /// <summary>武器表里的参数（还没接管过时用来推进杀意衰减等）</summary>
        static DemonBladeSpec Spec => WeaponLibrary.Get(DemonBladeDef.WeaponId)?.blade;

        float SkillHaste => vitals && vitals.stats != null ? vitals.stats.Get(Stat.SkillHaste) : 0;
        StatSheet Stats => vitals ? vitals.stats : null;

        // ───────────── 生命周期 ─────────────

        void OnEnable()
        {
            Instance = this;
            WeaponTakeovers.Register(this);
            GameEvents.EnemyKilled += OnKilled;
            GameEvents.RunStarted += OnRunStarted;
        }

        void OnDisable()
        {
            WeaponTakeovers.Unregister(this);
            GameEvents.EnemyKilled -= OnKilled;
            GameEvents.RunStarted -= OnRunStarted;
            Stow();
            if (Instance == this) Instance = null;
        }

        void OnDestroy()
        {
            view?.Dispose();
            view = null;
            effects?.Dispose();
            effects = null;
        }

        /// <summary>新开一局：冷却、杀意、刃气全部重置</summary>
        void OnRunStarted(RunState _)
        {
            Stow();
            burstCd = 0;
            intent = 0;
            qi = 100;
            unionLeft = 0;
        }

        /// <summary>每帧（不论当前武器）：冷却、杀意衰减、人刀合一计时、鬼眼；没握着碎刃时把特效放完</summary>
        void Update()
        {
            float dt = Time.deltaTime;
            if (burstCd > 0) burstCd = Mathf.Max(0, burstCd - dt);
            if (unionLeft > 0)
            {
                unionLeft = Mathf.Max(0, unionLeft - dt);
                if (unionLeft <= 0) SetUnion(false);
            }
            var p = P ?? Spec;
            if (p != null && unionLeft <= 0)
            {
                intentIdle += dt;
                if (intentIdle > p.intent.decayDelay) intent = Mathf.Max(0, intent - p.intent.decay * dt);
            }
            if (eyeLeft > 0) eyeLeft = Mathf.Max(0, eyeLeft - dt);
            if (inst == null && effects != null) effects.Tick(dt, null, Camera.main);
        }

        // ───────────── IWeaponTakeover ─────────────

        public bool Handles(WeaponInstance w) => w?.def != null && w.def.IsBlade;

        public bool OwnsViewmodel => true;

        public IWeaponHudSource Hud => this;

        public void Engage(WeaponController controller, WeaponInstance w)
        {
            if (inst != null && inst != w) Stow();
            wc = controller;
            inst = w;
            P = w.def.blade;
            vitals = controller.GetComponent<PlayerVitals>();
            body = controller.GetComponent<CharacterController>();
            feel = controller.GetComponent<CameraFeel>();
            Ensure(controller);
            Mode = BladeMode.Hand;
            lower = 1;
            shards.SnapHome();
            shards.provider = view;
            swarm.Live = true;
            view?.Show(true);
        }

        public void Release(WeaponController controller)
        {
            Stow();
        }

        /// <summary>建刃群、特效、挡弹面与第一人称（第一次接管时；换了玩家 / 相机时重建视图）</summary>
        void Ensure(WeaponController controller)
        {
            shards ??= new BladeShards();
            if (!swarm)
            {
                swarm = BladeSwarmRenderer.Create(transform, shards);
            }
            effects ??= new BladeEffects();
            if (!ward)
            {
                ward = BladeWard.Create(transform);
                ward.Blocked += OnBlock;
            }
            if (view == null || !view.Alive || viewOwner != controller)
            {
                view?.Dispose();
                view = null;
                try { view = ViewFactory?.Invoke(controller); }
                catch (Exception e) { Debug.LogException(e); }
                viewOwner = controller;
            }
        }

        WeaponController viewOwner;

        /// <summary>收刀（切走 / 死亡 / 换关）：碎片瞬间归刀，屏障与人刀合一结束；冷却与杀意保留</summary>
        void Stow()
        {
            shards?.SnapHome();
            effects?.Clear();
            SetShield(false);
            SetUnion(false);
            unionLeft = 0;
            Mode = BladeMode.Hand;
            burstPhase = BurstPhase.None;
            swingIdx = -1;
            comboIndex = 0;
            comboIdle = 0;
            slashBuffer = 0;
            pendingSlash = 0;
            waves.Clear();
            inst = null;
            inRange = false;
            if (swarm) swarm.Live = false;
            if (ward) ward.Active = false;
            if (view != null && view.Alive) view.Show(false);
        }

        // ───────────── 每帧（当前武器是碎刃） ─────────────

        public void Tick(WeaponController controller, WeaponInstance w, in TakeoverInput inp)
        {
            if (w?.def?.blade == null) return;
            if (inst != w) Engage(controller, w);
            P = w.def.blade;
            var R = WeaponStatsResolver.Resolve(w, Stats);
            float dt = inp.dt;
            if (view != null && !view.Alive) Ensure(controller);
            shards.provider = view;

            if (inp.firePressed) slashBuffer = DemonBladeDef.SlashBuffer;
            else slashBuffer = Mathf.Max(0, slashBuffer - dt);
            if (inp.firePressed && Mode != BladeMode.Hand && burstPhase == BurstPhase.None) pendingSlash = DemonBladeDef.RecallSlashWindow;
            else pendingSlash = Mathf.Max(0, pendingSlash - dt);

            // 刃气回复：碎片全在手里、停用一会儿之后
            if (Mode == BladeMode.Hand && shards.AllHome())
            {
                if (qiDelay > 0) qiDelay -= dt;
                else qi = Mathf.Min(P.qi.max, qi + P.qi.regen * dt);
            }
            else qiDelay = P.qi.regenDelay;

            if (burstPhase != BurstPhase.None) UpdateBurst(dt, R);
            else
            {
                bool canAct = inp.ready && swingIdx < 0;
                bool full = intent >= P.intent.max;
                if (inp.skillPressed && inp.ready && (full || burstCd <= 0)) StartBurst(full);
                else
                {
                    if (inp.skillPressed) SkillDenied?.Invoke();
                    // 左键：碎片在外时先收刃（排队斩击）
                    bool wantSlash = slashBuffer > 0 || pendingSlash > 0 || inp.fireDown;
                    bool wantSwarm = !wantSlash && inp.aimDown && canAct && qi > 0;
                    bool wantShield = !wantSlash && !wantSwarm && inp.reloadDown && canAct && qi > 0;
                    if (wantSwarm && Mode != BladeMode.Swarm) StartSwarm();
                    else if (wantShield && Mode != BladeMode.Shield) StartShield();
                    else if (!wantSwarm && !wantShield && (Mode == BladeMode.Swarm || Mode == BladeMode.Shield)) ReleaseSwarm(wantSlash);
                }
            }

            UpdateSlash(dt, R, in inp);
            if (Mode == BladeMode.Swarm) UpdateSwarm(dt, R);
            if (Mode == BladeMode.Shield) UpdateShield(dt);
            UpdateWaves(R);
            UpdateInRange();

            shards.boost = unionLeft > 0 ? 0.6f : 0;
            effects.Tick(dt, view != null && view.Alive ? view.RootWorld : null, Camera.main);
            // 刃群绞杀的持续刃鸣
            if (Mode == BladeMode.Swarm && shards.FormedFraction() > DemonBladeDef.FormedToAct)
            {
                swarmSfx -= dt;
                if (swarmSfx <= 0)
                {
                    swarmSfx = 0.11f;
                    GameAudio.Play("blade_swarm");
                }
            }
            lower = Mathf.MoveTowards(lower, controller.SwitchTimer > 0 || !inp.ready ? 1 : 0, dt * 6);
            if (view != null && view.Alive) view.Animate(dt, Pose(), shards);
        }

        // ───────────── 玩家几何 ─────────────

        Transform AimT => wc ? wc.Aim : transform;
        Vector3 Eye => AimT.position;

        Vector3 Feet => wc ? wc.transform.position : transform.position;

        float Height => body ? body.height : 1.8f;

        Vector3 FlatForward
        {
            get
            {
                var f = AimT.forward;
                f.y = 0;
                return f.sqrMagnitude > 1e-6f ? f.normalized : Vector3.forward;
            }
        }

        static Collider ColliderOf(EnemyAI e) => e.Health ? e.Health.GetComponent<Collider>() : e.GetComponent<Collider>();

        /// <summary>敌人身高（碰撞体包围盒；没有时 1.8）与脚底</summary>
        static void BodyOf(EnemyAI e, out Vector3 feet, out float height)
        {
            var c = ColliderOf(e);
            if (c && c.enabled)
            {
                var b = c.bounds;
                feet = new Vector3(e.transform.position.x, b.min.y, e.transform.position.z);
                height = b.size.y;
                return;
            }
            feet = e.transform.position;
            height = 1.8f;
        }

        // ───────────── 斩 ─────────────

        void UpdateSlash(float dt, ResolvedWeapon R, in TakeoverInput inp)
        {
            var combo = P.combo;
            if (combo.Length == 0) return;
            if (swingIdx < 0)
            {
                comboIdle += dt;
                if (comboIdle > P.comboReset) comboIndex = 0;
                bool can = inp.ready && Mode == BladeMode.Hand && burstPhase == BurstPhase.None && shards.AwayCount() <= DemonBladeDef.SlashReadyAway;
                if (!can || !(inp.fireDown || slashBuffer > 0 || pendingSlash > 0)) return;
                StartSwing(comboIndex % combo.Length, 0);
            }
            swingT += dt * Mathf.Max(0.2f, inp.speed);
            for (int guard = 0; swingIdx >= 0 && guard < 3; guard++)
            {
                int idx = swingIdx;
                var seg = combo[idx];
                if (!swingHit && swingT >= seg.windup)
                {
                    swingHit = true;
                    ResolveSlash(R, seg, idx);
                }
                if (swingT < seg.duration) break;
                float over = swingT - seg.duration;
                comboIndex = (idx + 1) % combo.Length;
                swingIdx = -1;
                comboIdle = 0;
                if (inp.ready && Mode == BladeMode.Hand && (inp.fireDown || slashBuffer > 0)) StartSwing(comboIndex, over);
            }
        }

        void StartSwing(int idx, float t0)
        {
            swingIdx = idx;
            swingT = t0;
            swingHit = false;
            slashBuffer = 0;
            pendingSlash = 0;
            view?.OnSlash(idx);
            var pitch = DemonBladeDef.SwingPitch;
            GameAudio.Play("blade_swing", 0.75f, idx < pitch.Length ? pitch[idx] : 1);
        }

        /// <summary>判定帧：扇形内所有可见敌人各命中一次</summary>
        void ResolveSlash(ResolvedWeapon R, BladeSlash seg, int idx)
        {
            // 每段算一次开火：天命计数（第 N 段必暴）、开火类词条；无限弹药语义，不扣弹匣
            var mods = WeaponRuntime.Of(inst).BeginShot(inst, R, true, ShotMods.None, Time.time);
            bool heavy = idx == P.combo.Length - 1;
            bool union = unionLeft > 0;
            float range = seg.range * (union ? DemonBladeDef.UnionReach : 1);
            Sector(range, seg.halfAngle, hits);
            var feet = Feet;
            int hitCount = 0, fx = 0;
            snapshot.Clear();
            snapshot.AddRange(hits);
            hits.Clear();
            foreach (var e in snapshot)
            {
                var d = e ? e.Health : null;
                if (!d || d.Dead) continue;
                var h = e.transform.position - feet;
                h.y = 0;
                h = h.sqrMagnitude > 1e-8f ? h.normalized : FlatForward;
                var c = EnemyRegistry.Center(e);
                var point = c - h * (EnemyRegistry.BodyRadius(e) * 0.8f);
                bool crit = mods.forceCrit || (R.critChance > 0 && UnityEngine.Random.value < R.critChance);
                var info = new DamageInfo
                {
                    amount = seg.damage * R.damageMult * mods.mult, element = inst.element, source = DamageSource.Weapon, tags = DamageTag.Melee,
                    statusChance = R.elementChance, critMult = R.critMult, weaponUid = inst.uid, point = point,
                    direction = new Vector3(h.x, 0.2f, h.z).normalized, knockback = seg.knockback, forceCrit = crit, instigator = wc,
                };
                var r = Combat.DamageEnemy(d, info);
                if (r.immune) continue;
                hitCount++;
                if (fx++ < DemonBladeDef.MaxHitFx)
                {
                    Fx.EnemyHit(point, BladeMeshes.Purple, r.crit);
                    Fx.Burst(point, BladeMeshes.ShardSpark, heavy ? 12 : 6, heavy ? 7 : 5, 0.25f, 0.06f, 4);
                }
            }
            snapshot.Clear();
            view?.OnStrike(idx, seg, union);
            if (hitCount > 0)
            {
                qi = Mathf.Min(P.qi.max, qi + P.qi.perSlashHit * hitCount);
                GainIntent(P.intent.slashHit * hitCount);
                view?.OnHit(heavy);
                GameAudio.Play("blade_hit", heavy ? 1 : 0.7f, heavy ? 0.85f : 1);
                CameraShake.Add(seg.shake, 0.13f);
                if (feel) feel.Punch(heavy ? 1.6f : 0.5f, idx == 1 ? 1.4f : -1.4f);
                // 命中顿帧 40 ms（第三段 70 ms）
                HitStop.Request(heavy ? 0.07f : 0.04f);
            }
            // 人刀合一：每段放出一道碎刃斩波
            if (union) LaunchWave(seg.damage * R.damageMult * mods.mult * P.union.waveFrac, idx);
            GameEvents.RaiseWeaponFired(inst);
        }

        /// <summary>扇形判定：玩家前方水平扇形 + 高度带（<see cref="DemonBladeDef.InSector"/>）+ 视线（身体中心与头部都被挡住才算挡住）。out 先清空</summary>
        void Sector(float range, float halfAngle, List<EnemyAI> output)
        {
            output.Clear();
            var feet = Feet;
            var fwd = FlatForward;
            float height = Height;
            var eye = Eye;
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
            {
                var e = live[i];
                if (!EnemyRegistry.Passes(e, EnemyQuery.Targetable)) continue;
                BodyOf(e, out var ef, out float eh);
                if (!DemonBladeDef.InSector(feet, fwd, height, range, halfAngle, P.reachBelow, P.reachAbove, ef, EnemyRegistry.BodyRadius(e), eh)) continue;
                var col = ColliderOf(e);
                var center = EnemyRegistry.Center(e);
                var head = new Vector3(center.x, ef.y + eh * 0.9f, center.z);
                if (Combat.Blocked(eye, center, col) && Combat.Blocked(eye, head, col)) continue;
                output.Add(e);
            }
        }

        void UpdateInRange()
        {
            if (Mode != BladeMode.Hand || (vitals && vitals.Dead))
            {
                inRange = false;
                return;
            }
            if (++rangeFrame % DemonBladeDef.InRangeEvery != 0 || P.combo.Length == 0) return;
            var seg = P.combo[(swingIdx >= 0 ? swingIdx : comboIndex) % P.combo.Length];
            Sector(seg.range, seg.halfAngle, hits);
            inRange = hits.Count > 0;
            hits.Clear();
        }

        // ───────────── 千刃出窍 ─────────────

        float SwarmRadius => P.swarm.radius * (unionLeft > 0 ? P.union.swarmRadiusMult : 1);

        void StartSwarm()
        {
            SetShield(false);
            Mode = BladeMode.Swarm;
            target = AimPoint(P.swarm.range);
            shards.center = target;
            shards.radius = SwarmRadius * 0.7f;
            shards.hitRadius = SwarmRadius;
            shards.Launch(SwarmFormation.Vortex);
            tickAcc = 0;
            GameAudio.Play("blade_throw", 0.85f);
        }

        /// <summary>准星落点：敌人（身体中心）&gt; 墙面（拉回一点）&gt; 最远射程</summary>
        Vector3 AimPoint(float range)
        {
            var eye = Eye;
            var dir = AimT.forward;
            bool wall = Physics.Raycast(eye, dir, out var wh, range, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            float maxD = wall ? wh.distance : range;
            int n;
            while ((n = Physics.RaycastNonAlloc(eye, dir, rayBuf, maxD, Layers.ShotMask, QueryTriggerInteraction.Ignore)) >= rayBuf.Length)
                rayBuf = new RaycastHit[rayBuf.Length * 2];
            Array.Sort(rayBuf, 0, n, HitOrder.Instance);
            for (int i = 0; i < n; i++)
            {
                var c = rayBuf[i].collider;
                if (!c || (wc && c.transform.IsChildOf(wc.transform))) continue;
                var hb = c.GetComponent<Hitbox>();
                var d = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                if (d && !d.Dead && !d.untargetable && d.GetComponentInParent<PlayerVitals>() == null) return ProjectileTargeting.Center(d);
                if (!d && (!hb || hb.blocksSight)) break;
            }
            return eye + dir * Mathf.Max(1.5f, maxD - (wall ? DemonBladeDef.WallPullback : 0));
        }

        sealed class HitOrder : IComparer<RaycastHit>
        {
            public static readonly HitOrder Instance = new();
            public int Compare(RaycastHit a, RaycastHit b) => a.distance.CompareTo(b.distance);
        }

        void UpdateSwarm(float dt, ResolvedWeapon R)
        {
            bool union = unionLeft > 0;
            if (!union) qi = Mathf.Max(0, qi - P.swarm.drain * dt);
            if (qi <= 0)
            {
                ReleaseSwarm(false);
                return;
            }
            // 刃群中心追着准星落点（有拖拽感）
            target = AimPoint(P.swarm.range);
            var d = target - shards.center;
            float dist = d.magnitude;
            float step = P.swarm.follow * (union ? DemonBladeDef.UnionFollow : 1) * dt;
            shards.center = dist > step ? shards.center + d * (step / dist) : target;
            float radius = SwarmRadius;
            shards.radius += (radius * 0.72f - shards.radius) * Mathf.Min(1, dt * 6);
            shards.hitRadius = radius;
            if (shards.FormedFraction() < DemonBladeDef.FormedToAct) return;
            // 绞杀：每 tick 秒结算一次，半径内最多 maxTargets 个敌人（一帧最多补 3 次）
            tickAcc += dt;
            int n = 0;
            while (tickAcc >= P.swarm.tick && n++ < 3)
            {
                tickAcc -= P.swarm.tick;
                SwarmTick(R, radius);
            }
        }

        void SwarmTick(ResolvedWeapon R, float radius)
        {
            var c0 = shards.center;
            EnemyRegistry.Overlapping(c0, radius, hits);
            hits.Sort((a, b) => (EnemyRegistry.Center(a) - c0).sqrMagnitude.CompareTo((EnemyRegistry.Center(b) - c0).sqrMagnitude));
            snapshot.Clear();
            snapshot.AddRange(hits);
            hits.Clear();
            int count = 0;
            for (int i = 0; i < snapshot.Count && count < P.swarm.maxTargets; i++)
            {
                var e = snapshot[i];
                var d = e ? e.Health : null;
                if (!d || d.Dead) continue;
                var c = EnemyRegistry.Center(e);
                float r = EnemyRegistry.BodyRadius(e);
                BodyOf(e, out _, out float eh);
                var point = c + new Vector3((UnityEngine.Random.value - 0.5f) * r, (UnityEngine.Random.value - 0.3f) * eh * 0.4f, (UnityEngine.Random.value - 0.5f) * r);
                var dir = new Vector3(UnityEngine.Random.value - 0.5f, 0.1f, UnityEngine.Random.value - 0.5f).normalized;
                var info = new DamageInfo
                {
                    amount = P.swarm.damage * R.damageMult, element = inst.element, source = DamageSource.Weapon,
                    statusChance = R.elementChance * P.swarm.elementScale, critMult = R.critMult, weaponUid = inst.uid, point = point, direction = dir,
                    knockback = 0, bypassShield = true, forceCrit = R.critChance > 0 && UnityEngine.Random.value < R.critChance, instigator = wc,
                };
                var res = Combat.DamageEnemy(d, info);
                if (res.immune) continue;
                count++;
                if (UnityEngine.Random.value < 0.35f) Fx.Burst(point, BladeMeshes.ShardSpark, 3, 4, 0.18f, 0.05f, 2);
            }
            snapshot.Clear();
            if (count > 0) GainIntent(P.intent.swarmHit * count);
        }

        /// <summary>收刃：刃群 / 屏障归刀；slash = 左键触发的收刃（加快归刀）</summary>
        void ReleaseSwarm(bool slash)
        {
            if (Mode == BladeMode.Hand) return;
            SetShield(false);
            Mode = BladeMode.Hand;
            shards.Recall(slash ? 0.4f : 1);
            GameAudio.Play("blade_recall", 0.7f, slash ? 1.2f : 1);
        }

        // ───────────── 碎刃屏障 ─────────────

        void StartShield()
        {
            Mode = BladeMode.Shield;
            FrameShield();
            shards.Launch(SwarmFormation.Shield);
            SetShield(true);
            GameAudio.Play("blade_morph", 0.8f);
        }

        void FrameShield()
        {
            var dir = AimT.forward;
            var right = Vector3.Cross(Vector3.up, dir);
            if (right.sqrMagnitude < 1e-6f) right = AimT.right;
            right.Normalize();
            var up = Vector3.Cross(dir, right).normalized;
            shards.shieldCenter = Eye + dir * P.shield.distance - up * 0.12f;
            shards.shieldNormal = dir;
            shards.shieldRight = right;
            shards.shieldUp = up;
            shards.shieldRadius = P.shield.radius;
            ward.Frame(shards.shieldCenter, dir, P.shield.radius * 1.1f);
        }

        void UpdateShield(float dt)
        {
            qi = Mathf.Max(0, qi - P.shield.drain * dt);
            if (qi <= 0)
            {
                ReleaseSwarm(false);
                return;
            }
            FrameShield();
            // 碎片到齐后才挡弹
            ward.Active = shards.FormedFraction() >= DemonBladeDef.FormedToAct;
        }

        /// <summary>持盾：减伤 30%、减速 20%（属性来源 <see cref="DemonBladeDef.SrcShield"/>）；收盾撤掉并停掉挡弹面</summary>
        void SetShield(bool on)
        {
            if (on == shieldOn)
            {
                if (!on && ward) ward.Active = false;
                return;
            }
            shieldOn = on;
            var s = Stats;
            if (on)
            {
                if (s != null)
                {
                    s.BeginBatch();
                    try
                    {
                        s.Remove(DemonBladeDef.SrcShield);
                        s.Add(DemonBladeDef.SrcShield, Stat.DamageReduction, P?.shield.reduction ?? 0.3f);
                        s.Add(DemonBladeDef.SrcShield, Stat.MoveSpeed, -DemonBladeDef.BaseMove * (P?.shield.moveSlow ?? 0.2f));
                    }
                    finally { s.EndBatch(); }
                }
            }
            else
            {
                s?.Remove(DemonBladeDef.SrcShield);
                if (ward) ward.Active = false;
            }
        }

        void OnBlock(Vector3 point, float damage)
        {
            if (P == null || Mode != BladeMode.Shield) return;
            qi = Mathf.Max(0, qi - P.shield.perBlock);
            GainIntent(P.intent.block);
            shards.FlashShield(point);
            Fx.Burst(point, BladeMeshes.ShardSpark, 10, 5, 0.25f, 0.05f, 2);
            GameAudio.Play("blade_hit", 0.55f, 1.4f);
        }

        // ───────────── 杀气爆发 / 人刀合一 ─────────────

        void StartBurst(bool union)
        {
            SetShield(false);
            swingIdx = -1;
            Mode = BladeMode.Burst;
            burstPhase = BurstPhase.Gather;
            burstT = 0;
            burstUnion = union;
            burstPoint = AimPoint(P.burst.range);
            shards.center = burstPoint;
            shards.ballCompress = 0;
            shards.Launch(SwarmFormation.Ball);
            if (union) intent = 0;
            burstCd = DemonBladeDef.CooldownTotal(P, SkillHaste);
            GameAudio.Play("blade_dash", 0.9f);
            string id = union ? DemonBladeDef.SkillUnion : DemonBladeDef.SkillBurst;
            GameEvents.RaiseWeaponSkillUsed(inst, id);
            SkillUsed?.Invoke(id);
        }

        void UpdateBurst(float dt, ResolvedWeapon R)
        {
            burstT += dt;
            switch (burstPhase)
            {
                case BurstPhase.Gather:
                {
                    float k = Mathf.Clamp01(burstT / Mathf.Max(0.01f, P.burst.gather));
                    shards.ballCompress = k * k;
                    if (burstT >= P.burst.gather)
                    {
                        Explode(R);
                        burstPhase = BurstPhase.Scatter;
                        burstT = 0;
                    }
                    break;
                }
                case BurstPhase.Scatter:
                    if (burstT >= DemonBladeDef.ScatterTime)
                    {
                        shards.Recall(0.6f);
                        burstPhase = BurstPhase.Return;
                        burstT = 0;
                    }
                    break;
                default:
                    if (shards.AllHome() || burstT > 1.5f)
                    {
                        burstPhase = BurstPhase.None;
                        Mode = BladeMode.Hand;
                    }
                    break;
            }
        }

        void Explode(ResolvedWeapon R)
        {
            var B = burstPoint;
            bool union = burstUnion;
            float radius = union ? P.union.burstRadius : P.burst.radius;
            float amount = P.burst.damage * R.damageMult * (union ? P.union.burstMult : 1);
            shards.Scatter();
            Fx.Explosion(B, radius, BladeMeshes.Purple);
            Fx.Ring(B, radius, Hex.Rgb(0xd2b4ff), 0.45f);
            CameraShake.Add(union ? 0.6f : 0.4f, 0.3f);
            GameAudio.Play("blade_impale", 1);
            EnemyRegistry.Overlapping(B, radius, hits);
            snapshot.Clear();
            snapshot.AddRange(hits);
            hits.Clear();
            foreach (var e in snapshot)
            {
                var d = e ? e.Health : null;
                if (!d || d.Dead) continue;
                var c = EnemyRegistry.Center(e);
                if (Combat.Blocked(B, c, ColliderOf(e))) continue;
                var dir = c - B;
                dir.y = 0;
                if (dir.sqrMagnitude < 1e-6f) dir = Vector3.right;
                dir = dir.normalized;
                dir.y = 0.35f;
                dir.Normalize();
                var info = new DamageInfo
                {
                    amount = amount, element = inst.element, source = DamageSource.Weapon, statusChance = R.elementChance, critMult = R.critMult,
                    weaponUid = inst.uid, point = c, direction = dir, knockback = P.burst.knockback,
                    forceCrit = R.critChance > 0 && UnityEngine.Random.value < R.critChance, instigator = wc,
                };
                Combat.DamageEnemy(d, info);
            }
            snapshot.Clear();
            if (union) SetUnion(true);
        }

        /// <summary>人刀合一：8 秒、移速 +15%（属性来源 <see cref="DemonBladeDef.SrcUnion"/>）；期间杀意不再增长</summary>
        void SetUnion(bool on)
        {
            if (on == unionOn) return;
            unionOn = on;
            var s = Stats;
            s?.Remove(DemonBladeDef.SrcUnion);
            if (!on) return;
            unionLeft = P?.union.duration ?? 8;
            s?.Add(DemonBladeDef.SrcUnion, Stat.MoveSpeed, DemonBladeDef.BaseMove * (P?.union.moveSpeed ?? 0.15f));
            GameAudio.Play("skill_buff", 0.8f, 0.7f);
        }

        /// <summary>斩波：沿视线（压平一些）飞出，路径上的敌人各受一次伤害</summary>
        void LaunchWave(float amount, int idx)
        {
            var dir = AimT.forward;
            dir.y *= 0.35f;
            dir.Normalize();
            var origin = Eye + dir * 0.4f;
            float range = P.union.waveRange;
            if (Physics.Raycast(origin, dir, out var wh, range, Layers.WorldMask, QueryTriggerInteraction.Ignore)) range = Mathf.Max(1, wh.distance);
            float roll = idx == 0 ? 0.6f : idx == 1 ? -0.4f : 0;
            int slot = effects.LaunchWave(origin, dir, roll, range, DemonBladeDef.WaveTime);
            // 池满时覆盖的槽位：旧的那道不再结算
            waves.RemoveAll(w => w.slot == slot);
            waves.Add(new WaveHit { slot = slot, amount = amount, origin = origin, dir = dir });
        }

        void UpdateWaves(ResolvedWeapon R)
        {
            if (waves.Count == 0) return;
            for (int i = waves.Count - 1; i >= 0; i--)
            {
                var w = waves[i];
                float front = effects.WaveFront(w.slot);
                if (front < 0)
                {
                    waves.RemoveAt(i);
                    continue;
                }
                snapshot.Clear();
                snapshot.AddRange(EnemyRegistry.Live);
                foreach (var e in snapshot)
                {
                    if (!EnemyRegistry.Passes(e, EnemyQuery.Targetable)) continue;
                    var d = e.Health;
                    if (w.hit.Contains(d)) continue;
                    var c = EnemyRegistry.Center(e);
                    var p = c - w.origin;
                    float along = Vector3.Dot(p, w.dir);
                    if (along < 0 || along > front + 0.4f) continue;
                    float lateral = (p - w.dir * along).magnitude;
                    if (lateral > DemonBladeDef.WaveHalfWidth + DemonBladeDef.WaveSpread * (front / Mathf.Max(1, P.union.waveRange)) + EnemyRegistry.BodyRadius(e)) continue;
                    w.hit.Add(d);
                    var info = new DamageInfo
                    {
                        amount = w.amount, element = inst.element, source = DamageSource.Weapon, tags = DamageTag.Melee, statusChance = R.elementChance,
                        critMult = R.critMult, weaponUid = inst.uid, point = c, direction = w.dir, knockback = 2, instigator = wc,
                    };
                    Combat.DamageEnemy(d, info);
                    Fx.EnemyHit(c, BladeMeshes.Purple);
                }
                snapshot.Clear();
            }
        }

        // ───────────── 噬灵鬼眼 / 杀意 ─────────────

        void OnKilled(in KillEvent e)
        {
            if (inst == null || P == null || e.info.weaponUid != inst.uid || e.info.Has(DamageTag.Purge)) return;
            var enemy = e.enemy;
            float frac = enemy && enemy.rank == Rank.Boss ? P.eye.healBoss : enemy && enemy.rank == Rank.Elite ? P.eye.healElite : P.eye.heal;
            if (vitals && !vitals.Dead) vitals.Heal(vitals.MaxHealth * frac);
            eyeLeft = P.eye.open;
            GainIntent(P.intent.kill);
            if (enemy) effects?.Wisp(ProjectileTargeting.Center(enemy));
            GameAudio.Play("blade_eye", enemy && enemy.rank != Rank.Normal ? 1 : 0.7f);
        }

        void GainIntent(float v)
        {
            if (unionLeft > 0 || P == null) return;
            intent = Mathf.Min(P.intent.max, intent + v);
            intentIdle = 0;
        }

        // ───────────── 输出 ─────────────

        BladePose Pose()
        {
            var pose = new BladePose { swing = -1, stretch = 1, lower = lower, unionStretch = P.union.stretch };
            if (swingIdx >= 0)
            {
                var seg = P.combo[swingIdx];
                pose.swing = swingIdx;
                pose.slash = seg;
                pose.swingP = Mathf.Clamp01(swingT / Mathf.Max(0.01f, seg.duration));
                pose.hitP = Mathf.Clamp01(seg.windup / Mathf.Max(0.01f, seg.duration));
                pose.stretch = Mathf.Max(seg.stretch, unionLeft > 0 ? P.union.stretch : 1);
            }
            else if (unionLeft > 0) pose.stretch = P.union.stretch;
            pose.gesture = Mode == BladeMode.Swarm ? BladeGesture.Point
                : Mode == BladeMode.Shield ? BladeGesture.Shield
                : burstPhase == BurstPhase.Gather ? BladeGesture.Raise
                : burstPhase != BurstPhase.None ? BladeGesture.Point : BladeGesture.None;
            pose.union = unionLeft > 0 ? Mathf.Min(1, unionLeft * 3) : 0;
            pose.eye = eyeLeft > 0 ? Mathf.Min(1, eyeLeft * 4) : 0;
            pose.qi = QiFraction;
            return pose;
        }

        // ───────────── IWeaponHudSource：弹药位显示刃气（∞ 表示没有备弹 / 换弹） ─────────────

        WeaponInstance IWeaponHudSource.Weapon => inst;
        int IWeaponHudSource.Mag => Mathf.RoundToInt(qi);
        int IWeaponHudSource.MagCapacity => P != null ? Mathf.RoundToInt(P.qi.max) : 100;
        int IWeaponHudSource.Reserve => 0;
        int IWeaponHudSource.ReserveCapacity => 0;
        bool IWeaponHudSource.InfiniteAmmo => true;
        bool IWeaponHudSource.Reloading => false;
        float IWeaponHudSource.ReloadProgress => 0;
        float IWeaponHudSource.Charge => 0;
        bool IWeaponHudSource.ChargeFull => false;
        float IWeaponHudSource.Heat => 0;
        bool IWeaponHudSource.Firing => Mode == BladeMode.Swarm || Mode == BladeMode.Shield;
        float IWeaponHudSource.Spread => wc ? wc.HudSpread : 0.035f;
        float IWeaponHudSource.Aim => 0;
        Element IWeaponHudSource.NextElement => inst?.element ?? Element.None;
        string IWeaponHudSource.ModeId => DemonBladeDef.ModeId(Mode);
    }
}
