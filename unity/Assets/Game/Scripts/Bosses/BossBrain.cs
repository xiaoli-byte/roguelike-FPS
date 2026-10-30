using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领行为（Three.js BossBase 的 Unity 版，docs/unity-parity.md 3.9「BossBrain : EnemyAI + BossMove + BossDef」）。整套由 <see cref="BossDef"/> 驱动，
    /// 具体首领（旱魃、鲲鹏、火麒麟、魔将）继承它改走位 / 演出钩子，招式写成 <see cref="BossMove"/> 子类。
    ///   登场：<see cref="BossIntroDef.seconds"/> 秒不可选中、霸体（名字卡、吼声、震屏）；招式的首次可用时间从登场结束算起。
    ///   阶段机：生命层（不含护盾 / 护甲，与血条刻度一致）跌破 <see cref="BossDef.phases"/> 的阈值 → 等当前招式收尾（最多 <see cref="BossDef.phaseWait"/> 秒，
    ///     之后强制打断并撤回预警）→ 转换演出（不可选中、霸体，<see cref="GameEvents.BossPhase"/>）→ 演出中途按定义换形（<see cref="GameEvents.BossForm"/>）。
    ///     一次掉过两道阈值时逐个转换。生命刻度事件（不是阶段）走 <see cref="OnMark"/>。
    ///   抽招：可用（形态 / 阶段）、冷却到了、权重 &gt; 0 的招式按权重随机；刚出过的那招按 <see cref="BossDef.repeatWeight"/> 降权（默认 0：还有别的招就不连出）；
    ///     <see cref="QueueMove"/> 指定下一招（忽略冷却与权重）。招式之间喘 <see cref="BossMove.recovery"/> × 阶段倍率 × 狂怒倍率，期间按 <see cref="Idle"/> 走位。
    ///   霸体（<see cref="IStunPolicy"/>，同 Three.js stunImmune）：登场、转换、硬直、出招中（招式没标 stunnable 时）免疫眩晕；只有招式间隙能被眩晕，
    ///     首领眩晕 ≤ 0.35 s、之后 6.1 s 免疫由 <see cref="StunStatus"/> 处理。击退抗性 1。
    ///   硬直 <see cref="Stagger"/>：脚本化的倒地 / 撞晕（鹏撞柱、火麒麟被鼎砸中），打断招式，可附带承伤倍率。
    ///   狂怒：登场后 <see cref="BossDef.enrageAfter"/> 秒，或生命层低于 <see cref="BossDef.enrageBelow"/>：喘息 / 前摇缩短、伤害提高，<see cref="OnEnrage"/> 钩子。
    ///   召唤：<see cref="Summons"/>（上限、预警、转阶段 / 倒下时崩解）。场地：<see cref="Arena"/>（<see cref="BossArena"/> 显式锚点，走位都夹在场地里）。
    ///   倒下：招式打断、召唤物崩解、血条收起、<see cref="GameEvents.BossDefeated"/>，溃散演出交给 <see cref="BossDefeatSequence"/>。
    ///   动画事件：模型的 CreatureRig.AnimEvent 转给当前招式（<see cref="BossMove.Cue"/>）；通用的 "sfx:&lt;id&gt;" / "fx:shake" 在这里直接处理。
    /// 血条（U3）经 <see cref="IBossBarSource"/> 读 <see cref="Title"/>、<see cref="Subtitle"/>、<see cref="BarTicks"/>（刻度来自 BossDef）。
    /// 生成走 <see cref="Bosses.Spawn(string, BossArena, float, Transform)"/>（首领不在敌人名册里）。
    /// </summary>
    public class BossBrain : EnemyAI, IStunPolicy, IBossBarSource
    {
        // 由 Bosses.Spawn 在激活之前填写
        [NonSerialized] internal BossDef def;
        [NonSerialized] internal BossArena arena;
        [NonSerialized] internal List<BossModel> models;
        [NonSerialized] internal Dictionary<string, BossModel> formModels;

        /// <summary>招式间隙的状态名</summary>
        public const string RestState = "rest";
        public const string IntroState = "intro", TransitionStateName = "transition", StaggerState = "stagger";

        public BossDef Def => def;
        public BossArena Arena => arena;
        public Summons Summons { get; private set; }
        /// <summary>当前阶段（0 起，越过第 i 道阈值后为 i + 1）</summary>
        public int Phase { get; private set; }
        public BossFormDef Form { get; private set; }
        public BossFormDef PreviousForm { get; private set; }
        /// <summary>当前形态显示的模型</summary>
        public BossModel Model { get; private set; }
        /// <summary>正在出的招（招式间隙为 null）</summary>
        public BossMove Current { get; private set; }
        public IReadOnlyList<BossMove> Moves => moveList;
        public bool IntroDone { get; private set; }
        public bool Transitioning => transition != null;
        /// <summary>当前转换演出已进行的秒数（不在转换中为 0）</summary>
        public float TransitionTime => transition?.t ?? 0;
        public bool Enraged { get; private set; }
        public string EnrageReason { get; private set; }
        public bool Staggered => staggerLeft > 0;
        /// <summary>登场结束后的战斗时长（秒）</summary>
        public float FightTime { get; private set; }
        /// <summary>距离计时狂怒还有多久（没有计时狂怒 / 已狂怒为 −1）</summary>
        public float EnrageTimeLeft => def != null && def.enrageAfter > 0 && !Enraged ? Mathf.Max(0, def.enrageAfter - FightTime) : -1;

        /// <summary>血条标题：首领名（形态有名字时「鲲鹏 · 鹏」）</summary>
        public string Title => def == null ? name : Form != null && !string.IsNullOrEmpty(Form.name) ? $"{def.name} · {Form.name}" : def.name;
        /// <summary>称号（名字卡第二行 / 血条副标题）</summary>
        public string Subtitle => def?.title;
        /// <summary>阶段判定用的比例：只看生命层（Three.js phaseFraction）</summary>
        public float PhaseFraction => hp && hp.maxHealth > 0 ? Mathf.Clamp01(hp.health / hp.maxHealth) : 0;
        /// <summary>三层合计的剩余比例</summary>
        public float HealthFraction
        {
            get
            {
                if (!hp) return 0;
                float max = hp.maxHealth + hp.maxShield + hp.maxArmor;
                return max > 0 ? Mathf.Clamp01((hp.health + hp.shield + hp.armor) / max) : 0;
            }
        }

        /// <summary>血条刻度（D23）：阶段阈值 + 标了 tick 的生命刻度，降序</summary>
        public IReadOnlyList<float> BarTicks => def != null ? def.BarTicks : Array.Empty<float>();
        /// <summary>前摇倍率（狂怒时缩短）</summary>
        public float WindupScale => Enraged && def != null ? def.enrageWindupScale : 1f;
        /// <summary>喘息倍率：当前阶段的 restScale × 狂怒倍率</summary>
        public float RestScale
        {
            get
            {
                float k = Phase > 0 && def != null && Phase - 1 < def.phases.Count && def.phases[Phase - 1] != null ? def.phases[Phase - 1].restScale : 1f;
                return k * (Enraged && def != null ? def.enrageRestScale : 1f);
            }
        }

        CapsuleCollider capsule;

        /// <summary>身体半径（世界米：角色胶囊半径 × 体型）</summary>
        public float BodyRadius => capsule ? capsule.radius * Mathf.Abs(transform.lossyScale.x) : 1f;

        /// <summary>身体中心（世界坐标）</summary>
        public Vector3 BodyCenter => capsule && capsule.enabled ? capsule.bounds.center : transform.position + Vector3.up * 1.5f * Size;

        // ───────────── 场上的首领 ─────────────

        static readonly List<BossBrain> active = new();

        /// <summary>场上活着的首领（生成顺序）</summary>
        public static IReadOnlyList<BossBrain> Active => active;
        /// <summary>血条该显示的首领：最近生成、还活着的那只（没有为 null）</summary>
        public static BossBrain Primary
        {
            get
            {
                for (int i = active.Count - 1; i >= 0; i--)
                    if (active[i] && !active[i].Dead)
                        return active[i];
                return null;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => active.Clear();

        // ───────────── 事件（本只首领）─────────────

        /// <summary>开始出招（首领, 招式）</summary>
        public event Action<BossBrain, BossMove> MoveStarted;
        /// <summary>招式结束（正常收招或被打断，看 move.Cancelled）</summary>
        public event Action<BossBrain, BossMove> MoveEnded;
        /// <summary>招式画了一个地面预警</summary>
        public event Action<BossBrain, BossMove> MoveTelegraphed;
        /// <summary>生命刻度事件（首领, 刻度 id）</summary>
        public event Action<BossBrain, string> Marked;
        public event Action<BossBrain> EnrageBegan;
        /// <summary>进入硬直（首领, 秒数）</summary>
        public event Action<BossBrain, float> StaggerBegan;

        // ───────────── 内部状态 ─────────────

        sealed class Slot
        {
            public BossMove move;
            public float readyAt;
        }

        sealed class TransitionRun
        {
            public BossPhaseDef def;
            public bool advances, swapped;
            public float t;
        }

        readonly List<Slot> slots = new();
        readonly List<BossMove> moveList = new();
        readonly List<BossMark> marks = new();
        readonly List<(HitZone zone, BossHitZoneDef def, BossModel model)> zones = new();
        static readonly List<Slot> cands = new();
        static readonly List<float> weights = new();
        TransitionRun transition;
        string lastMoveId, queued;
        float restLeft, phaseWait, staggerLeft, strafeTimer, strafeSign = 1;
        int nextMark;
        IDisposable staggerMod;
        readonly HashSet<string> missingStates = new();
        readonly List<CreatureRig> rigs = new();

        // ───────────── 生命周期 ─────────────

        protected override void Awake()
        {
            base.Awake();
            capsule = GetComponent<CapsuleCollider>();
            Summons = new Summons(this);
            hp.rank = Rank.Boss;
            hp.Died += OnBossDied;
            knockbackResist = 1;
        }

        void OnEnable()
        {
            if (models != null)
                foreach (var m in models)
                    if (m.rig && !rigs.Contains(m.rig))
                    {
                        rigs.Add(m.rig);
                        m.rig.AnimEvent += OnRigEvent;
                    }
            if (!Dead && def != null && !active.Contains(this)) active.Add(this);
        }

        void OnDisable()
        {
            foreach (var r in rigs)
                if (r)
                    r.AnimEvent -= OnRigEvent;
            rigs.Clear();
            active.Remove(this);
            // 阶段门槛只在本脑启用时由 Update 每帧写：停用 / 销毁（销毁前也会先停用）时撤掉，免得下限留在 Damageable 上打不死
            if (hp) hp.healthFloor = 0;
        }

        protected override void Start()
        {
            base.Start();
            var motor = vitals ? vitals.GetComponent<PlayerMotor>() : null;
            var look = motor ? motor.eye : null;
            if (look && models != null)
                foreach (var m in models)
                    if (m.rig)
                        m.rig.lookTarget = look;
        }

        /// <summary>
        /// 生成（<see cref="Bosses.Spawn(BossDef, Vector3, Quaternion, float, BossArena, Transform)"/> 调）：耐久按 <see cref="BossDef.VitalsAt"/>（定档表或 × 难度），
        /// 伤害照常 × (1 + (难度 − 1) × 0.55)；首领没有精英。之后建招式、命中区、初始形态，开始登场
        /// </summary>
        public override void Spawn(float lvl, bool isElite)
        {
            if (def == null)
            {
                Debug.LogWarning($"[Boss] {name} 没有首领定义（要经 Bosses.Spawn 生成）");
                base.Spawn(lvl, false);
                return;
            }
            float l = Mathf.Max(0.5f, float.IsFinite(lvl) && lvl > 0 ? lvl : 1f);
            var v = def.VitalsAt(l);
            hp.rank = Rank.Boss;
            // 基类会 × 难度：先除回去，基类乘完正好落在定档值上（生成事件里看到的就是最终数值），之后再精确写一遍
            hp.maxHealth = v.hp / l;
            hp.maxShield = v.shield / l;
            hp.maxArmor = v.armor / l;
            base.Spawn(l, false);
            hp.maxHealth = Mathf.Max(1, RoundHp(v.hp));
            hp.maxShield = Mathf.Max(0, RoundHp(v.shield));
            hp.maxArmor = Mathf.Max(0, RoundHp(v.armor));
            hp.ResetVitals();
            hp.displayName = def.name;
            hp.untargetable = true;
            knockbackResist = 1;

            BuildMoves();
            marks.Clear();
            foreach (var m in def.marks)
                if (m != null)
                    marks.Add(m);
            marks.Sort((a, b) => b.at.CompareTo(a.at));
            nextMark = 0;
            Phase = 0;
            IntroDone = Enraged = false;
            FightTime = 0;
            transition = null;
            Current = null;
            queued = lastMoveId = null;
            BuildZones();
            ApplyForm(def.FirstForm);
            if (!active.Contains(this)) active.Add(this);

            var intro = def.intro;
            PlayAct(intro.anim, intro.seconds);
            if (!string.IsNullOrEmpty(intro.sfx)) GameAudio.PlayAt(intro.sfx, transform.position + Vector3.up * 2f, 1f);
            if (intro.shake > 0) CameraShake.Quake(transform.position, intro.shake, 60f, 0.9f);
            // 登场演出（BossIntroDirector）接管时名字卡由演出打
            if (intro.banner && !BossIntroDirector.Directs(this)) GameUI.Banner(def.name, def.title, Mathf.Clamp(intro.seconds, 1.6f, 3.2f));
            SetState(IntroState);
            RefreshBossBar();
            GameEvents.RaiseBossSpawned(this);
        }

        void BuildMoves()
        {
            slots.Clear();
            moveList.Clear();
            var seen = new HashSet<string>();
            foreach (var make in def.moves)
            {
                BossMove m;
                try
                {
                    m = make?.Invoke();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                    continue;
                }
                if (m == null || string.IsNullOrEmpty(m.Id) || !seen.Add(m.Id)) continue;
                m.Bind(this);
                slots.Add(new Slot { move = m, readyAt = float.PositiveInfinity });
                moveList.Add(m);
            }
        }

        protected override string InitialState => RestState;

        protected override void Update()
        {
            base.Update();
            if (Dead || def == null) return;
            Summons.Tick(Time.deltaTime);
            // 基类出生 0.7 s 后会把不可选中关掉：首领按自己的规则（登场 / 转换 / 子类的潜水之类）每帧重写
            hp.untargetable = state == "spawn" || !IntroDone || transition != null || ExtraUntargetable;
            hp.healthFloor = PhaseGateFloor;
        }

        /// <summary>
        /// 阶段门槛（I3，docs/balance.md）：还有没走的阶段时，生命层最多打到下一道阈值（略低半点，让阈值判定成立），越线后停在线上等转换演出；
        /// 最后一道阈值的转换开始后才能被打死。没有它时越线后等招式收尾的那 ≤ phaseWait 秒照样掉血，高输出会把一整段打穿（3-3 魔将只走到第 2 阶段就倒下）
        /// </summary>
        float PhaseGateFloor => def != null && hp && !Dead && Phase < def.phases.Count && def.phases[Phase] is { } pd ? Mathf.Max(0, hp.maxHealth * pd.at - 0.5f) : 0;

        /// <summary>子类额外的不可选中（鲲潜在水下…）</summary>
        protected virtual bool ExtraUntargetable => false;

        protected override bool DazeOverlay => staggerLeft > 0;

        /// <summary>飞行形态（鹏、焚身踏云）自己管高度：基类不做离网回收</summary>
        protected override bool UsesNavMesh => Form == null || !Form.flying;

        // ───────────── 思考 ─────────────

        protected override void Think(float dt)
        {
            if (def == null) return;
            if (!IntroDone)
            {
                StepIntro(dt);
                return;
            }
            FightTime += dt;
            if (staggerLeft > 0)
            {
                StepStagger(dt);
                return;
            }
            if (transition != null)
            {
                StepTransition(dt);
                return;
            }
            CheckMarks();
            CheckEnrage();
            if (CheckPhase(dt)) return;
            try
            {
                Passive(dt);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            if (Current != null)
            {
                StepMove(dt);
                return;
            }
            restLeft -= dt;
            if (!LeashBack())
                try
                {
                    Idle(dt);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            if (restLeft <= 0) PickMove();
        }

        void StepIntro(float dt)
        {
            Stop();
            FacePlayer(90f, dt);
            try
            {
                IntroTick(Mathf.Clamp01(age / Mathf.Max(0.01f, def.intro.seconds)), dt);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            // 登场动作播完了，但演出镜头还没交还玩家：继续待在登场里（不可选中、不出招）
            if (age < def.intro.seconds || BossIntroDirector.HoldsIntro(this, age - def.intro.seconds)) return;
            IntroDone = true;
            FightTime = 0;
            float now = Time.time;
            foreach (var s in slots) s.readyAt = s.move.firstDelay > 0 ? now + s.move.firstDelay : float.NegativeInfinity;
            restLeft = Mathf.Max(0, def.intro.firstRest);
            PlayLocomotion();
            SetState(RestState);
            Guard(OnIntroEnd);
        }

        /// <summary>离开场地太远（被推出去、脚本位移出界）就先走回来；返回 true 表示这一帧在往回走</summary>
        bool LeashBack()
        {
            if (!arena || arena.Contains(transform.position, -1.5f)) return false;
            MoveTo(arena.Clamp(transform.position, ArenaMargin + 2f), moveSpeed * 1.2f);
            FaceMovement(240f, Time.deltaTime);
            return true;
        }

        /// <summary>走位离场地边界留多少（米）：身体半径 + 1</summary>
        public float ArenaMargin => BodyRadius + 1f;

        // ───────────── 招式调度 ─────────────

        Slot FindSlot(string id)
        {
            foreach (var s in slots)
                if (s.move.Id == id)
                    return s;
            return null;
        }

        /// <summary>按 id 找招式（没有返回 null）</summary>
        public BossMove MoveById(string id) => FindSlot(id)?.move;

        /// <summary>指定下一招（忽略冷却与权重，但要在当前形态 / 阶段可用）</summary>
        public void QueueMove(string id) => queued = id;

        /// <summary>
        /// 立刻出某一招（测试、调试命令、剧本）：忽略冷却、权重、形态 / 阶段限制；正在出的招被打断。登场、转换、硬直、眩晕中不行。返回是否出了
        /// </summary>
        public bool ForceMove(string id)
        {
            if (Dead || !IntroDone || transition != null || staggerLeft > 0 || Stunned) return false;
            var s = FindSlot(id);
            if (s == null) return false;
            AbortMove();
            StartMove(s);
            return Current == s.move;
        }

        /// <summary>某招还要多久冷却好（秒；没有这招为 −1）</summary>
        public float CooldownLeft(string id)
        {
            var s = FindSlot(id);
            return s == null ? -1 : Mathf.Max(0, s.readyAt - Time.time);
        }

        void PickMove()
        {
            float now = Time.time;
            if (!string.IsNullOrEmpty(queued))
            {
                var id = queued;
                queued = null;
                var qs = FindSlot(id);
                if (qs != null && qs.move.Allowed(this))
                {
                    StartMove(qs);
                    return;
                }
            }
            cands.Clear();
            weights.Clear();
            bool others = false;
            foreach (var s in slots)
            {
                if (now < s.readyAt || !s.move.Allowed(this)) continue;
                float w;
                try
                {
                    w = s.move.Weight(this);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                    continue;
                }
                if (!(w > 0) || !float.IsFinite(w)) continue;
                cands.Add(s);
                weights.Add(w);
                if (s.move.Id != lastMoveId) others = true;
            }
            float total = 0;
            for (int i = 0; i < cands.Count; i++)
            {
                if (others && cands[i].move.Id == lastMoveId) weights[i] *= Mathf.Max(0, def.repeatWeight);
                total += weights[i];
            }
            if (cands.Count == 0 || !(total > 0))
            {
                cands.Clear();
                restLeft = 0.3f;
                return;
            }
            float r = Random01() * total;
            var pick = cands[^1];
            for (int i = 0; i < cands.Count; i++)
            {
                r -= weights[i];
                if (r > 0 || weights[i] <= 0) continue;
                pick = cands[i];
                break;
            }
            cands.Clear();
            StartMove(pick);
        }

        float Random01()
        {
            var run = RunState.Current;
            return run != null ? run.Stream("boss:" + def.id).Value : UnityEngine.Random.value;
        }

        void StartMove(Slot s)
        {
            var m = s.move;
            Current = m;
            s.readyAt = Time.time + Mathf.Max(0, m.cooldown);
            lastMoveId = m.Id;
            Stop();
            SetState(m.Id);
            try
            {
                m.Begin();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                AbortMove();
                restLeft = 1f;
                return;
            }
            Raise(MoveStarted, m);
        }

        void StepMove(float dt)
        {
            var m = Current;
            bool done;
            try
            {
                done = m.Step(dt);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                AbortMove();
                restLeft = 1f;
                return;
            }
            if (done && Current == m) FinishMove();
        }

        void FinishMove()
        {
            var m = Current;
            Current = null;
            if (m == null) return;
            m.Finish();
            EndDash();
            restLeft = Mathf.Max(0, m.recovery) * RestScale;
            PlayLocomotion();
            SetState(RestState);
            Raise(MoveEnded, m);
        }

        /// <summary>打断当前招式（转换、硬直、眩晕、死亡、玩家阵亡），撤回它还没兑现的预警</summary>
        public void AbortMove()
        {
            var m = Current;
            if (m == null) return;
            Current = null;
            m.Cancel();
            EndDash();
            if (!Dead && state == m.Id) SetState(RestState);
            Raise(MoveEnded, m);
        }

        /// <summary>基类的打断（眩晕、死亡、玩家阵亡、坠落回收）</summary>
        protected override void CancelAttack() => AbortMove();

        internal void NotifyTelegraph(BossMove m) => Raise(MoveTelegraphed, m);

        void Raise(Action<BossBrain, BossMove> ev, BossMove m)
        {
            if (ev == null) return;
            try
            {
                ev(this, m);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        static void Guard(Action a)
        {
            try
            {
                a();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 阶段 / 换形 ─────────────

        bool CheckPhase(float dt)
        {
            if (Phase >= def.phases.Count) return false;
            var pd = def.phases[Phase];
            if (pd == null || PhaseFraction > pd.at)
            {
                phaseWait = 0;
                return false;
            }
            // 正在出招时最多再等 phaseWait 秒让这一招打完（已经画出的预警照常兑现），超时强制打断
            if (Current != null && phaseWait < def.phaseWait)
            {
                phaseWait += dt;
                return false;
            }
            phaseWait = 0;
            BeginTransition(pd, true);
            return true;
        }

        void BeginTransition(BossPhaseDef pd, bool advances)
        {
            AbortMove();
            if (staggerLeft > 0) EndStagger(false);
            if (advances) Phase++;
            transition = new TransitionRun
            {
                def = pd, advances = advances, t = 0,
                swapped = string.IsNullOrEmpty(pd.form) || (Form != null && Form.id == pd.form),
            };
            Stop();
            hp.untargetable = true;
            PlayAct(pd.anim, pd.seconds);
            if (!string.IsNullOrEmpty(pd.sfx)) GameAudio.PlayAt(pd.sfx, transform.position + Vector3.up * 2f, 1f);
            if (pd.shake > 0) CameraShake.Quake(transform.position, pd.shake, 60f, 0.9f);
            if (!string.IsNullOrEmpty(pd.toast)) GameUI.Toast(pd.toast, def.color);
            Summons.DespawnPhaseBound();
            SetState(TransitionStateName);
            if (advances)
            {
                int p = Phase;
                Guard(() => OnPhase(p));
                GameEvents.RaiseBossPhase(this, Phase);
            }
            if (pd.seconds <= 0) StepTransition(0);
        }

        void StepTransition(float dt)
        {
            var tr = transition;
            tr.t += dt;
            Stop();
            FacePlayer(60f, dt);
            try
            {
                TransitionTick(tr.t, dt);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            if (!tr.swapped && tr.t >= tr.def.SwapAt)
            {
                tr.swapped = true;
                SwitchForm(tr.def.form);
            }
            if (transition == tr && tr.t >= tr.def.seconds) EndTransition();
        }

        void EndTransition()
        {
            var tr = transition;
            transition = null;
            if (tr != null && !tr.swapped) SwitchForm(tr.def.form);
            restLeft = 0.4f;
            PlayLocomotion();
            SetState(RestState);
            if (tr != null && !string.IsNullOrEmpty(tr.def.firstMove)) queued = tr.def.firstMove;
            if (tr != null) Guard(() => OnTransitionEnd(tr.def));
        }

        /// <summary>
        /// 不随阶段的换形（剧本触发）：带 seconds 秒不可选中的转换演出，演出 40% 时换形。登场、转换、死亡中不行；没有这个形态返回 false
        /// </summary>
        public bool ChangeForm(string formId, float seconds = 2.4f, string animState = "roar")
        {
            if (Dead || !IntroDone || transition != null || def.Form(formId) == null || (Form != null && Form.id == formId)) return false;
            BeginTransition(new BossPhaseDef { at = 0, form = formId, seconds = Mathf.Max(0, seconds), anim = animState, sfx = "boss_roar", shake = 0.35f }, false);
            return true;
        }

        /// <summary>
        /// 立刻换形（转换演出中途由框架调；子类的剧本也可以直接调）：换模型、弱点、命中区、着色，护盾 / 护甲按形态回复，排上形态的第一招，刷新血条，派发 BossForm
        /// </summary>
        public void SwitchForm(string formId)
        {
            var f = def?.Form(formId);
            if (f == null)
            {
                if (!string.IsNullOrEmpty(formId)) Debug.LogWarning($"[Boss] {def?.id} 没有形态 {formId}");
                return;
            }
            if (Form == f) return;
            PreviousForm = Form;
            ApplyForm(f);
            if (f.shieldRestore > 0) hp.shield = Mathf.Max(hp.shield, hp.maxShield * Mathf.Clamp01(f.shieldRestore));
            if (f.armorRestore > 0) hp.armor = Mathf.Max(hp.armor, hp.maxArmor * Mathf.Clamp01(f.armorRestore));
            if (!string.IsNullOrEmpty(f.firstMove)) queued = f.firstMove;
            RefreshBossBar();
            var prev = PreviousForm;
            Guard(() => OnFormChanged(prev, f));
            GameEvents.RaiseBossForm(this, f);
        }

        /// <summary>显示形态 f 的模型：体型、角色胶囊、动画、弱点、命中区、着色</summary>
        void ApplyForm(BossFormDef f)
        {
            Form = f;
            if (f == null) return;
            BossModel m = null;
            if (formModels != null) formModels.TryGetValue(f.id, out m);
            if (m != null)
            {
                if (Model != m)
                {
                    foreach (var other in models)
                        if (other != m && other.root)
                            other.root.SetActive(false);
                    if (m.root) m.root.SetActive(true);
                    transform.localScale = Vector3.one * m.scale;
                    if (capsule)
                    {
                        capsule.center = m.capsuleCenter;
                        capsule.radius = m.capsuleRadius;
                        capsule.height = m.capsuleHeight;
                    }
                    if (agent)
                    {
                        agent.radius = Mathf.Clamp(m.capsuleRadius, 0.25f, 2f);
                        agent.height = Mathf.Max(0.5f, m.capsuleHeight);
                    }
                    anim = m.animator;
                    if (m.locomotion) m.locomotion.Teleported();
                    Model = m;
                    missingStates.Clear();
                }
                // 弱点：形态写的骨骼 → 头骨；半径按「世界尺寸与正式美术一致」折算（代理体放大倍数不同）
                var bone = m.FindBone(f.weakBone);
                bool exact = bone && m.source == BossModelSource.Art;
                if (!bone) bone = m.Head;
                float k = f.scale / Mathf.Max(0.01f, m.scale);
                body.SetWeakPoint(bone, exact ? f.weakOffset : Vector3.zero, Mathf.Max(0.05f, f.weakRadius * k));
                body.SetWeakPointActive(true);
            }
            foreach (var (zone, zd, zm) in zones)
                if (zone)
                    zone.SetActive(zm == Model && (string.IsNullOrEmpty(zd.form) || zd.form == f.id));
            if (f.tint != Color.white) body.SetTint("bossForm", f.tint);
            else body.ClearTint("bossForm");
            if (f.overlayAmount > 0) body.SetOverlay("bossForm", f.overlay, Mathf.Clamp01(f.overlayAmount));
            else body.ClearOverlay("bossForm");
        }

        /// <summary>按定义在各模型的骨骼上建额外命中区（球 / 竖直胶囊，设计尺寸按「世界尺寸与正式美术一致」折算）</summary>
        void BuildZones()
        {
            foreach (var (zone, _, _) in zones)
                if (zone)
                    Destroy(zone.gameObject);
            zones.Clear();
            if (models == null || def.hitZones.Count == 0) return;
            foreach (var zd in def.hitZones)
            {
                if (zd == null || string.IsNullOrEmpty(zd.id)) continue;
                foreach (var m in models)
                {
                    // 这份模型承载的形态里有没有这一区要的
                    BossFormDef host = null;
                    foreach (var f in def.forms)
                        if (f != null && formModels.TryGetValue(f.id, out var fm) && fm == m && (string.IsNullOrEmpty(zd.form) || zd.form == f.id))
                        {
                            host = f;
                            break;
                        }
                    if (host == null) continue;
                    var bone = m.FindBone(zd.bone);
                    bool exact = bone && m.source == BossModelSource.Art;
                    if (!bone) bone = string.IsNullOrEmpty(zd.bone) ? m.root.transform : m.Head;
                    if (!bone) continue;
                    float k = host.scale / Mathf.Max(0.01f, m.scale);
                    var go = new GameObject($"Zone_{zd.id}") { layer = Layers.Character };
                    go.transform.SetParent(bone, false);
                    go.transform.localPosition = exact ? zd.offset : Vector3.zero;
                    float boneScale = Mathf.Max(1e-3f, bone.lossyScale.x);
                    float rootScale = m.scale;
                    Collider c;
                    if (zd.height > 0)
                    {
                        var cap = go.AddComponent<CapsuleCollider>();
                        cap.direction = 1;
                        cap.radius = zd.radius * k * rootScale / boneScale;
                        cap.height = Mathf.Max(cap.radius * 2, zd.height * k * rootScale / boneScale);
                        // 竖直胶囊：不跟骨骼转（同 Three.js 的 rayVerticalCapsule）
                        go.AddComponent<UprightZone>();
                        c = cap;
                    }
                    else
                    {
                        var sph = go.AddComponent<SphereCollider>();
                        sph.radius = zd.radius * k * rootScale / boneScale;
                        c = sph;
                    }
                    var rb = go.AddComponent<Rigidbody>();
                    rb.isKinematic = true;
                    rb.useGravity = false;
                    var zone = HitZone.Create(c, hp, body, zd.id, zd.multiplier, zd.weak, zd.priority);
                    zone.facing = zd.facing;
                    zone.breakAt = zd.breakAt;
                    zones.Add((zone, zd, m));
                }
            }
        }

        /// <summary>按 id 找额外命中区（当前形态启用的那份优先；没有返回 null）</summary>
        public HitZone Zone(string zoneId)
        {
            HitZone any = null;
            foreach (var (zone, zd, zm) in zones)
            {
                if (!zone || zd.id != zoneId) continue;
                if (zm == Model && zone.Active) return zone;
                any ??= zone;
            }
            return any;
        }

        // ───────────── 生命刻度 / 狂怒 / 硬直 ─────────────

        void CheckMarks()
        {
            while (nextMark < marks.Count && PhaseFraction <= marks[nextMark].at)
            {
                var m = marks[nextMark++];
                Guard(() => OnMark(m.id));
                if (Marked == null) continue;
                try
                {
                    Marked(this, m.id);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
        }

        void CheckEnrage()
        {
            if (Enraged) return;
            if (def.enrageAfter > 0 && FightTime >= def.enrageAfter) Enrage("timer");
            else if (def.enrageBelow > 0 && PhaseFraction <= def.enrageBelow) Enrage("health");
        }

        /// <summary>进入狂怒（计时 / 低血 / 剧本 / 测试）：喘息与前摇缩短、伤害提高（倍率见 BossDef），身上泛主题色。只进一次</summary>
        public void Enrage(string reason = "forced")
        {
            if (Enraged || Dead || def == null) return;
            Enraged = true;
            EnrageReason = reason;
            if (!string.IsNullOrEmpty(def.enrageToast)) GameUI.Toast(def.enrageToast, def.color);
            body.SetOverlay("bossEnrage", def.color, 0.16f);
            GameAudio.PlayAt("boss_roar", transform.position + Vector3.up * 2f, 0.8f, 1.2f);
            Guard(() => OnEnrage(reason));
            if (EnrageBegan == null) return;
            try
            {
                EnrageBegan(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>
        /// 硬直（脚本化的倒地 / 撞晕：鹏撞柱 1.8 s、火麒麟被鼎砸中 4 s）：打断招式、停下、播动作，期间受伤 × takenMult。
        /// 和元素眩晕不同，不受霸体与眩晕免疫期限制；登场、转换中不行。返回是否进入
        /// </summary>
        public bool Stagger(float seconds, string animState = "Hit", float takenMult = 1f)
        {
            if (Dead || !IntroDone || transition != null || !(seconds > 0) || !float.IsFinite(seconds)) return false;
            AbortMove();
            Stop();
            staggerLeft = Mathf.Max(staggerLeft, seconds);
            staggerMod?.Dispose();
            staggerMod = null;
            if (takenMult > 0 && !Mathf.Approximately(takenMult, 1f))
            {
                float k = takenMult;
                staggerMod = hp.Incoming.Add((in IncomingHit h) => k);
            }
            PlayAct(animState, seconds);
            SetState(StaggerState);
            Guard(() => OnStaggered(seconds));
            if (StaggerBegan != null)
                try
                {
                    StaggerBegan(this, seconds);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            return true;
        }

        void StepStagger(float dt)
        {
            Stop();
            staggerLeft -= dt;
            if (staggerLeft <= 0) EndStagger(true);
        }

        void EndStagger(bool resume)
        {
            staggerLeft = 0;
            staggerMod?.Dispose();
            staggerMod = null;
            if (!resume || Dead) return;
            PlayLocomotion();
            SetState(RestState);
            restLeft = Mathf.Min(restLeft, 0.6f);
        }

        /// <summary>
        /// 霸体（Three.js stunImmune）：登场、转换、硬直、出招中（招式没标 stunnable）、倒下后都免疫眩晕；
        /// 定义关掉了 stunBetweenMoves 时整场免疫。只有招式间隙能被眩晕
        /// </summary>
        public virtual bool StunImmune =>
            Dead || def == null || !def.stunBetweenMoves || !IntroDone || transition != null || staggerLeft > 0 || (Current != null && !Current.stunnable);

        // ───────────── 倒下 ─────────────

        void OnBossDied(DamageInfo info)
        {
            // 基类已经：移出敌人登记、打断招式（CancelAttack）、清加成、停导航、停用本组件
            AbortMove();
            transition = null;
            EndStagger(false);
            Summons.DespawnAll();
            active.Remove(this);
            if (Model?.rig) Model.rig.daze = 0;
            RefreshBossBar();
            if (!string.IsNullOrEmpty(def?.defeat.toast)) GameUI.Toast(def.defeat.toast, def.color);
            if (def != null) gameObject.AddComponent<BossDefeatSequence>().Begin(this);
            Guard(() => OnDefeated(info));
            GameEvents.RaiseBossDefeated(this);
        }

        // ───────────── 首领血条（U3 的 IBossBarSource）：刻度来自 BossDef（D23），换形时受伤体跟着换 ─────────────
        Damageable IBossBarSource.BarHealth => Health;
        string IBossBarSource.BarTitle => Title;
        string IBossBarSource.BarSubtitle => Subtitle;
        IReadOnlyList<float> IBossBarSource.BarThresholds => BarTicks;
        bool IBossBarSource.BarInvulnerable => Health && !Health.Dead && Health.untargetable;

        /// <summary>血条：显示最近生成、还活着的首领，没有就收起</summary>
        public static void RefreshBossBar()
        {
            var p = Primary;
            if (p) GameUI.SetBoss<IBossBarSource>(p);
            else GameUI.SetBoss(null);
        }

        // ───────────── 给招式用的工具 ─────────────

        /// <summary>当前目标的位置（被嘲讽时是诱饵）</summary>
        public Vector3 PlayerPosition => PlayerPos;
        /// <summary>当前目标的眼睛高度点</summary>
        public Vector3 PlayerEyePosition => PlayerEye;
        /// <summary>到目标的水平距离</summary>
        public float DistanceToPlayer => DistToPlayer;
        /// <summary>预测目标 lead 秒后的位置（只取水平速度）</summary>
        public Vector3 Predict(float lead) => PredictPlayer(lead);
        /// <summary>看得见目标（0.25 s 缓存的视线）</summary>
        public bool SeesPlayer => sees;

        /// <summary>招式伤害：首领伤害 × mult × 狂怒倍率</summary>
        public float MoveDamage(float mult = 1f) => Damage * mult * (Enraged && def != null ? def.enrageDamageScale : 1f);

        /// <summary>直接打目标一下（被嘲讽时打在诱饵上无效）；返回是否命中</summary>
        public bool HitPlayer(float dmg, Vector3 from) => HitTarget(dmg, from);

        /// <summary>范围伤害（落点爆炸、砸地）：按到玩家胶囊表面的距离衰减到 falloff，墙后不受伤、冲刺无敌帧闪得过，并把玩家掀开</summary>
        public float BlastPlayer(Vector3 center, float radius, float dmg, float falloff = 0.5f) =>
            Combat.BlastPlayer(center, radius, dmg, falloff, def != null ? def.element : Element.None, this);

        public void Halt() => Stop();
        public void MoveToward(Vector3 dest, float speedMult = 1f) => MoveTo(arena ? arena.Clamp(dest, ArenaMargin) : dest, moveSpeed * speedMult);
        public void Face(Vector3 p, float degPerSec, float dt) => FaceTowards(p, degPerSec, dt);

        /// <summary>立刻转向 p（水平）</summary>
        public void FaceNow(Vector3 p)
        {
            var d = p - transform.position;
            d.y = 0;
            if (d.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(d);
        }

        /// <summary>开始脚本位移（冲撞、跃击）：离开导航网格，按速度 + 重力推进，撞墙停下水平速度</summary>
        public void BeginDash(Vector3 velocity, float gravity = 0)
        {
            HitWall = false;
            BeginManualMotion(velocity, gravity);
        }

        public void SetDashVelocity(Vector3 v) => SetManualVelocity(v);
        public Vector3 DashVelocity => ManualVelocity;
        /// <summary>脚本位移这一程撞到了墙 / 地形</summary>
        public bool DashHitWall => HitWall;
        public bool DashGrounded => ManualGrounded;

        /// <summary>结束脚本位移，交还导航（不在脚本位移里时什么都不做）</summary>
        public void EndDash() => EndManualMotion();

        /// <summary>
        /// 播一个动作（Animator 状态名）：seconds &gt; 0 时拉伸到正好播完；当前模型没有这个状态时不播、只警告一次（代理模型 / 片段还没烘焙）
        /// </summary>
        public void PlayAct(string animState, float seconds = 0, float fade = 0.1f)
        {
            if (string.IsNullOrEmpty(animState) || !anim || !anim.isActiveAndEnabled || !anim.runtimeAnimatorController) return;
            if (!HasState(animState))
            {
                if (missingStates.Add(animState))
                    Debug.LogWarning($"[Boss] {def?.id} 的模型 {Model?.prefab ?? "?"} 没有动作 {animState}（不播，招式照常）");
                return;
            }
            if (seconds > 0.05f) PlayTimed(animState, seconds, fade);
            else Play(animState, fade);
        }

        bool HasState(string s) =>
            anim.HasState(0, Animator.StringToHash(s)) || anim.HasState(0, Animator.StringToHash("Base Layer." + s));

        public void PlaySfx(string id, float volume = 1, float pitch = 1)
        {
            if (!string.IsNullOrEmpty(id)) GameAudio.PlayAt(id, transform.position + Vector3.up * 1.5f, volume, pitch);
        }

        /// <summary>以首领为中心的震屏（玩家越远越弱）</summary>
        public void Shake(float strength, float duration = 0.4f, float range = 60f) => CameraShake.Quake(transform.position, strength, range, duration);

        /// <summary>发光通道（0 = 主前摇）的亮度目标</summary>
        public void Glow(int channel, float value) => SetGlow(channel, value);

        /// <summary>点夹进场地（离边界 margin 米，默认身体半径 + 1）；没有场地原样返回</summary>
        public Vector3 ClampToArena(Vector3 p, float margin = -1) => arena ? arena.Clamp(p, margin >= 0 ? margin : ArenaMargin) : p;

        void OnRigEvent(string evt)
        {
            if (string.IsNullOrEmpty(evt) || Dead) return;
            if (evt.StartsWith("sfx:", StringComparison.Ordinal)) PlaySfx(evt.Substring(4));
            else if (evt == "fx:shake") Shake(0.35f);
            Current?.OnAnimEvent(evt);
            Guard(() => OnAnimEvent(evt));
        }

        // ───────────── 子类钩子 ─────────────

        /// <summary>登场演出（t 0 → 1，期间不可选中）</summary>
        protected virtual void IntroTick(float t, float dt) { }
        protected virtual void OnIntroEnd() { }

        /// <summary>
        /// 招式间隙的走位（默认：保持 <see cref="BossDef.idleMinRange"/>–<see cref="BossDef.idleMaxRange"/> 的距离带，带内绕玩家侧移，都夹在场地里）
        /// </summary>
        protected virtual void Idle(float dt)
        {
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = UnityEngine.Random.Range(2.5f, 4.5f);
                strafeSign = UnityEngine.Random.value < 0.5f ? -1 : 1;
            }
            var to = PlayerPos - transform.position;
            to.y = 0;
            float d = to.magnitude;
            var dir = d > 0.01f ? to / d : transform.forward;
            var side = new Vector3(-dir.z, 0, dir.x) * strafeSign;
            float min = def.idleMinRange, max = Mathf.Max(def.idleMinRange + 1, def.idleMaxRange);
            Vector3 dest;
            if (d < min) dest = transform.position - dir * (min - d + 2f) + side * 2f;
            else if (d > max) dest = PlayerPos - dir * ((min + max) * 0.5f);
            else dest = transform.position + side * 4f + dir * 0.5f;
            if (arena) dest = arena.Clamp(dest, ArenaMargin);
            MoveTo(dest, moveSpeed);
            FaceAimTravel(240f, dt, 0.4f);
        }

        /// <summary>登场后每帧（招式中、间隙都调，转换 / 硬直中不调）：护盾再生、背景落石…</summary>
        protected virtual void Passive(float dt) { }
        /// <summary>进入新阶段（招式已打断，演出开始）</summary>
        protected virtual void OnPhase(int phase) { }
        /// <summary>转换演出中每帧（t = 已进行秒数）</summary>
        protected virtual void TransitionTick(float t, float dt) { }
        protected virtual void OnTransitionEnd(BossPhaseDef phase) { }
        /// <summary>换了形态（模型、弱点、命中区已切换）</summary>
        protected virtual void OnFormChanged(BossFormDef previous, BossFormDef next) { }
        /// <summary>生命刻度事件（BossDef.marks）</summary>
        public virtual void OnMark(string markId) { }
        protected virtual void OnEnrage(string reason) { }
        protected virtual void OnStaggered(float seconds) { }
        /// <summary>动画事件（招式已经收到过一份）</summary>
        protected virtual void OnAnimEvent(string evt) { }
        /// <summary>倒下（召唤物已崩解、血条已收起，BossDefeated 派发之前）</summary>
        protected virtual void OnDefeated(DamageInfo info) { }
    }
}
