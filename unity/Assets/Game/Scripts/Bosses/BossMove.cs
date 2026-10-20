using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>招式的时间段：前摇（画预警）→ 出手（判定）→ 收招 → 结束</summary>
    public enum MoveStage { None, Windup, Active, Recover, Done }

    /// <summary>
    /// 首领招式（Three.js BossBase 的 BossMove 时间轴，拆成三段）：
    ///   前摇 <see cref="windup"/> 秒：进入时调 <see cref="OnTelegraph"/> 画预警（预警时长 = 前摇时长，填满的那一刻正好出手），每帧 <see cref="OnWindup"/>；
    ///   出手 <see cref="active"/> 秒（或子类的 <see cref="ActiveDone"/> 说结束，冲撞到点、落地）：进入时 <see cref="OnActiveBegin"/>（一般在这里判定），每帧 <see cref="OnActive"/>；
    ///   收招 <see cref="recover"/> 秒：<see cref="OnRecover"/>，然后结束，回到招式间隙（再喘 <see cref="recovery"/> × 阶段 / 狂怒倍率）。
    /// 每段可以指定一个动作（Animator 状态名，缺片段时不播、只警告一次）。
    /// 出手时刻优先跟动画事件走（<see cref="Cue"/>：E5 的 events.json 叠加表写成 CreatureRig.OnAnimEvent），没有事件就按时间兜底。
    /// 打断（转阶段、眩晕、硬直、玩家阵亡、死亡）：<see cref="OnEnd"/>(cancelled = true)，并撤回本招画出、还没填满的预警（能撤回的那部分：直线预警有句柄；
    /// 圆形预警用 F2 的贴花句柄，打断时撤回）。
    /// 调度参数（冷却、权重、首次可用延迟、限定形态 / 阶段）也写在招式上，<see cref="BossBrain"/> 按它们抽招。
    /// 一只首领一份招式对象（BossDef.moves 是工厂），招式可以有自己的字段。
    /// </summary>
    public abstract class BossMove
    {
        /// <summary>招式 id（同一首领内唯一）：强制出招、阶段第一招、测试按它找</summary>
        public abstract string Id { get; }
        /// <summary>显示名（调试叠层、测试报告）</summary>
        public virtual string Name => Id;

        // ───────────── 调度 ─────────────

        /// <summary>本招内置冷却（秒，从出招开始计）</summary>
        public float cooldown = 6f;
        /// <summary>收招后的喘息（秒，再乘阶段 / 狂怒倍率）</summary>
        public float recovery = 1.2f;
        /// <summary>登场结束后多久才可用（秒）</summary>
        public float firstDelay;
        /// <summary>出招权重（<see cref="Weight"/> 可按距离 / 状态改）</summary>
        public float weight = 1f;
        /// <summary>只在这些形态可用（null = 任意形态）</summary>
        public string[] forms;
        /// <summary>只在这些阶段可用（含两端；阶段从 0 起）</summary>
        public int minPhase, maxPhase = int.MaxValue;
        /// <summary>出招中可以被眩晕（默认不行：霸体）</summary>
        public bool stunnable;

        // ───────────── 时间轴 ─────────────

        /// <summary>前摇 / 出手 / 收招时长（秒）。前摇受狂怒的前摇倍率影响</summary>
        public float windup = 1f, active = 0.3f, recover = 0.6f;
        /// <summary>每段的动作（Animator 状态名；null = 不换动作）</summary>
        public string windupAnim, activeAnim, recoverAnim;
        /// <summary>预警色（null = 首领定义的预警色）</summary>
        public Color? warnColor;

        public BossBrain Brain { get; private set; }
        public MoveStage Stage { get; private set; }
        /// <summary>本招已进行的秒数（首帧为 0）</summary>
        public float T { get; private set; }
        /// <summary>当前这一段已进行的秒数</summary>
        public float StageT { get; private set; }
        /// <summary>本次出招被打断了</summary>
        public bool Cancelled { get; private set; }
        /// <summary>本次出招到过出手段</summary>
        public bool ReachedActive { get; private set; }
        /// <summary>累计：出过几次（含被打断的）、到过几次出手段、画过几个预警（测试 / 调试叠层）</summary>
        public int TimesStarted { get; private set; }
        public int TimesActive { get; private set; }
        public int TelegraphCount { get; private set; }
        /// <summary>本次出招实际用的前摇时长（秒）</summary>
        public float WindupTime { get; private set; }

        float prevT, prevStageT;
        bool endActive, endWindup;
        readonly HashSet<string> cuesSeen = new();
        readonly HashSet<string> cuesFired = new();
        readonly List<Telegraph.LineHandle> lines = new();
        readonly List<TelegraphHandle> circles = new();

        // ───────────── 首领调用 ─────────────

        internal void Bind(BossBrain brain) => Brain = brain;

        /// <summary>当前形态 / 阶段下能不能出这一招（不看冷却和权重）</summary>
        public virtual bool Allowed(BossBrain b)
        {
            if (b.Phase < minPhase || b.Phase > maxPhase) return false;
            if (forms == null || forms.Length == 0) return true;
            var f = b.Form;
            return f != null && Array.IndexOf(forms, f.id) >= 0;
        }

        /// <summary>出招权重（≤ 0 = 现在不出）：默认 <see cref="weight"/>，子类按距离、召唤物数量、地形改</summary>
        public virtual float Weight(BossBrain b) => weight;

        internal void Begin()
        {
            Stage = MoveStage.None;
            T = StageT = 0;
            prevT = prevStageT = -1;
            Cancelled = ReachedActive = endActive = endWindup = false;
            cuesSeen.Clear();
            cuesFired.Clear();
            lines.Clear();
            circles.Clear();
            TimesStarted++;
            WindupTime = Mathf.Max(0, windup * Brain.WindupScale);
            OnStart();
            Enter(MoveStage.Windup);
        }

        /// <summary>推进一帧；返回 true 表示招式结束</summary>
        internal bool Step(float dt)
        {
            if (Stage is MoveStage.Done or MoveStage.None) return true;
            prevT = T;
            prevStageT = StageT;
            T += dt;
            StageT += dt;
            switch (Stage)
            {
                case MoveStage.Windup:
                    OnWindup(dt);
                    if (Stage == MoveStage.Windup && (endWindup || WindupDone)) Enter(MoveStage.Active);
                    break;
                case MoveStage.Active:
                    OnActive(dt);
                    if (Stage == MoveStage.Active && (endActive || ActiveDone)) Enter(MoveStage.Recover);
                    break;
                case MoveStage.Recover:
                    OnRecover(dt);
                    if (Stage == MoveStage.Recover && StageT >= recover) Stage = MoveStage.Done;
                    break;
            }
            return Stage == MoveStage.Done;
        }

        void Enter(MoveStage s)
        {
            Stage = s;
            StageT = 0;
            prevStageT = -1;
            switch (s)
            {
                case MoveStage.Windup:
                    if (!string.IsNullOrEmpty(windupAnim)) Brain.PlayAct(windupAnim, WindupTime);
                    OnTelegraph();
                    break;
                case MoveStage.Active:
                    ReachedActive = true;
                    TimesActive++;
                    if (!string.IsNullOrEmpty(activeAnim)) Brain.PlayAct(activeAnim, active);
                    OnActiveBegin();
                    break;
                case MoveStage.Recover:
                    if (!string.IsNullOrEmpty(recoverAnim)) Brain.PlayAct(recoverAnim, recover);
                    OnRecoverBegin();
                    break;
            }
        }

        /// <summary>正常收招（首领调用）：OnEnd(false)，并撤回提前结束的分支留下的预警</summary>
        internal void Finish()
        {
            Stage = MoveStage.Done;
            SafeEnd(false);
            EndWarnings();
        }

        /// <summary>打断（首领调用）：OnEnd(true)，撤回预警。可以重复调用</summary>
        internal void Cancel()
        {
            if (Stage == MoveStage.Done && Cancelled) return;
            Cancelled = true;
            Stage = MoveStage.Done;
            SafeEnd(true);
            EndWarnings();
        }

        void SafeEnd(bool cancelled)
        {
            try
            {
                OnEnd(cancelled);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>动画事件（CreatureRig.OnAnimEvent 转来）：记下来给 <see cref="Cue"/>，子类也可以直接处理</summary>
        public virtual void OnAnimEvent(string name)
        {
            if (!string.IsNullOrEmpty(name)) cuesSeen.Add(name);
        }

        // ───────────── 子类钩子 ─────────────

        /// <summary>出招第一帧（前摇开始之前）：选目标、记落点</summary>
        protected virtual void OnStart() { }
        /// <summary>预警钩子：前摇开始时调，在这里画地面预警（<see cref="WarnCircle"/> / <see cref="WarnLine"/>）</summary>
        protected virtual void OnTelegraph() { }
        protected virtual void OnWindup(float dt) { }
        /// <summary>出手的那一刻（一般在这里判定伤害、放弹体、掀冲击波）</summary>
        protected virtual void OnActiveBegin() { }
        protected virtual void OnActive(float dt) { }
        protected virtual void OnRecoverBegin() { }
        protected virtual void OnRecover(float dt) { }
        /// <summary>结束或被打断（必须可重复调用）：收拾本招的临时物体、交还脚本位移</summary>
        protected virtual void OnEnd(bool cancelled) { }

        /// <summary>前摇是否结束：默认按时长；子类可以改成等动画事件（<c>Cue("hit", WindupTime)</c>）</summary>
        protected virtual bool WindupDone => StageT >= WindupTime;
        /// <summary>出手段是否结束：默认按时长；冲撞类改成「到点 / 撞墙」</summary>
        protected virtual bool ActiveDone => StageT >= active;

        /// <summary>提前结束前摇 / 出手段（下一帧进入下一段）</summary>
        protected void EndWindup() => endWindup = true;
        protected void EndActive() => endActive = true;

        // ───────────── 工具 ─────────────

        /// <summary>本招的时间轴在这一帧越过 t 秒（Three.js at(x)）</summary>
        protected bool At(float t) => prevT < t && T >= t;
        /// <summary>当前这一段的时间在这一帧越过 t 秒</summary>
        protected bool StageAt(float t) => prevStageT < t && StageT >= t;

        /// <summary>
        /// 出手时刻：本招收到过名为 evt 的动画事件，或时间轴越过 fallback 秒（没有事件的片段 / 代理模型按时间兜底），两者先到者算，每次出招只返回一次 true
        /// </summary>
        protected bool Cue(string evt, float fallback)
        {
            if (cuesFired.Contains(evt)) return false;
            if (!cuesSeen.Contains(evt) && T < fallback) return false;
            cuesFired.Add(evt);
            return true;
        }

        /// <summary>伤害：首领伤害 × mult（难度、狂怒都已乘上）</summary>
        protected float Damage(float mult = 1f) => Brain.MoveDamage(mult);

        /// <summary>预警色</summary>
        protected Color WarnTint => warnColor ?? (Brain && Brain.Def != null ? Brain.Def.WarnColor : new Color(1f, 0.4f, 0.2f));

        /// <summary>圆形地面预警（落点、砸地）：返回句柄；招式被打断时还没填满的会撤回（F2 贴花预警）</summary>
        protected TelegraphHandle WarnCircle(Vector3 center, float radius, float seconds, Color? color = null)
        {
            TelegraphCount++;
            var h = Telegraph.Circle(center, radius, Mathf.Max(0.05f, seconds), color ?? WarnTint);
            circles.Add(h);
            Brain.NotifyTelegraph(this);
            return h;
        }

        /// <summary>直线地面预警（冲撞、俯冲路径）：返回句柄（可以在前摇里跟着朝向挪），打断时自动撤回</summary>
        protected Telegraph.LineHandle WarnLine(Vector3 from, Vector3 to, float width, float seconds, Color? color = null)
        {
            TelegraphCount++;
            var h = Telegraph.Line(from, to, width, Mathf.Max(0.05f, seconds), color ?? WarnTint);
            if (h != null) lines.Add(h);
            Brain.NotifyTelegraph(this);
            return h;
        }

        /// <summary>撤回本招还活着的预警：直线收起；圆形只撤还没填满的（填满即已兑现）</summary>
        protected void EndWarnings()
        {
            foreach (var h in lines) h?.End();
            lines.Clear();
            foreach (var h in circles) h.Cancel();
            circles.Clear();
        }

        public override string ToString() => $"{Name}（{Id}，{Stage}，{T:F1} s）";
    }
}
