using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃的行为（<see cref="HanbaDef"/>；首领框架 <see cref="BossBrain"/> 的子类，招式在 Hanba/Moves/）。在框架之上加四层：
    ///   · 运行时姿态层：整体悬浮 <see cref="HanbaDef.hover"/> + 上下起伏（模型根节点抬高，角色胶囊跟着抬），关掉脚步 IK（悬浮着不踩地）；
    ///     日轮（<see cref="SunRing"/>）旋转、炽度；残衣 / 长发 / 袖垂片是 CreatureRig 的弹簧骨（ART2 的人形片段丢了这些骨的曲线，全靠这层）。
    ///   · 日晒（<see cref="SunExposure"/>）：登场后每 0.1 s 判定一次玩家，光柱 + 日轮直射，参数取自定义。
    ///   · 泉珠弱点：只在招式后摇（收招段 + <see cref="HanbaDef.weakGrace"/>）和硬直时露出——开弱点球、点亮泉珠发光壳（SK_Boss_Hanba_GlowShell）；
    ///     其余时间弱点球关着，只能打身体。
    ///   · 沙魇：召唤物出现后染成沙魇（<see cref="SandWraith"/>），倒下时散成沙。
    /// 动作：<see cref="Act"/> 优先走 ART2 的 act_&lt;状态&gt; 触发器（先按片段时长设 ActScale，让出手事件落在实际前摇结束），
    /// 模型没有这个触发器（代理 / 占位）时退回框架的 <see cref="BossBrain.PlayAct"/>（按状态名，缺了只警告一次）。出手时刻由招式的 Cue 跟动画事件走。
    /// 二、三阶段（BS2）的钩子：<see cref="OnPhase"/> 现在只让日轮闪一下、招式按 <see cref="Pace"/> 变快（占位）；吸干泉水、日轮升顶、日蚀接在这里。
    /// </summary>
    public class HanbaBrain : BossBrain
    {
        static readonly int ActScaleId = Animator.StringToHash("ActScale");

        public HanbaDef HDef => Def as HanbaDef;
        public SunRing Ring { get; private set; }
        public SunExposure Exposure { get; private set; }
        /// <summary>泉珠此刻露着（弱点球开）</summary>
        public bool WeakExposed { get; private set; }
        /// <summary>泉珠露出过几次（测试用）</summary>
        public int WeakWindows { get; private set; }
        /// <summary>当前的悬浮高度（米，含起伏）</summary>
        public float HoverNow { get; private set; }
        /// <summary>染成沙魇的召唤物累计个数、倒下散沙的个数</summary>
        public int WraithsTinted { get; private set; }
        public int WraithsCrumbled { get; private set; }
        /// <summary>最近一次 <see cref="Act"/> 的状态名与走的路径（"trigger" / "crossfade"），触发次数（测试 / 调试）</summary>
        public string LastAct { get; private set; }
        public string LastActPath { get; private set; }
        public int ActsFired { get; private set; }

        /// <summary>出招节奏（一阶段 = 1；二、三阶段更快，BS2 之前的占位）</summary>
        public float Pace => HDef != null ? HDef.PaceAt(Phase) : 1f;

        readonly List<EnemyAI> wraiths = new();
        readonly List<Renderer> pearlShells = new();
        readonly Dictionary<RuntimeAnimatorController, (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale)> animInfo = new();
        float weakGrace, bobT;
        Vector3 capsuleBase;
        bool rigged;

        // ───────────── 生成 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            if (Def == null) return;
            SetupRuntimeLayer();
        }

        /// <summary>悬浮、日轮、日晒、泉珠（生成后模型已就位时调一次）</summary>
        void SetupRuntimeLayer()
        {
            var d = HDef;
            // 悬浮：关脚步 IK；角色胶囊跟模型一起抬（命中、BodyCenter 才对得上）
            if (Model?.rig) Model.rig.feetIK = false;
            var cap = GetComponent<CapsuleCollider>();
            if (cap)
            {
                capsuleBase = cap.center;
                float s = Mathf.Max(0.01f, Model?.scale ?? 1f);
                cap.center = capsuleBase + Vector3.up * ((d?.hover ?? 0.5f) / s);
            }
            Ring = GetComponent<SunRing>();
            if (!Ring) Ring = gameObject.AddComponent<SunRing>();
            Ring.Bind(this);
            Exposure = GetComponent<SunExposure>();
            if (!Exposure) Exposure = gameObject.AddComponent<SunExposure>();
            Exposure.owner = this;
            Exposure.ring = Ring;
            if (d != null)
            {
                Exposure.shaftGain = d.shaftGain;
                Exposure.ringGain = d.ringGain;
                Exposure.ringRange = d.ringRange;
                Exposure.ringBlazeRange = d.ringBlazeRange;
                Exposure.waterFactor = d.waterFactor;
                Exposure.damagePerStack = d.sunDamagePerStack;
            }
            pearlShells.Clear();
            if (Model?.root)
                foreach (var r in Model.root.GetComponentsInChildren<Renderer>(true))
                    if (r.name.IndexOf("GlowShell", StringComparison.OrdinalIgnoreCase) >= 0)
                        pearlShells.Add(r);
            MoveEnded -= OnOwnMoveEnded;
            MoveEnded += OnOwnMoveEnded;
            rigged = true;
            SetWeak(false, true);
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Def == null || !rigged) return;
            float dt = Time.deltaTime;
            Hover(dt);
            if (Dead) return;
            Weakpoint(dt);
            TrackWraiths();
        }

        /// <summary>悬浮：模型根节点抬到 hover + 起伏；倒下后慢慢落地</summary>
        void Hover(float dt)
        {
            var d = HDef;
            if (Model?.root == null || d == null) return;
            bobT += dt * d.bobRate * Mathf.PI * 2f;
            float target = Dead ? 0f : d.hover + Mathf.Sin(bobT) * d.bob;
            HoverNow = Dead ? Mathf.MoveTowards(HoverNow, 0, dt * 0.6f) : target;
            float s = Mathf.Max(0.01f, Model.scale);
            Model.root.transform.localPosition = Vector3.up * (HoverNow / s);
        }

        /// <summary>泉珠：收招段 → 露出（再留 weakGrace 秒）；硬直中也露着</summary>
        void Weakpoint(float dt)
        {
            if (Current != null && Current.Stage == MoveStage.Recover) weakGrace = HDef?.weakGrace ?? 0.6f;
            else weakGrace -= dt;
            bool open = IntroDone && !Transitioning && (weakGrace > 0 || Staggered);
            if (open != WeakExposed) SetWeak(open);
        }

        void SetWeak(bool open, bool force = false)
        {
            if (!force && open == WeakExposed) return;
            if (open && !WeakExposed) WeakWindows++;
            WeakExposed = open;
            body.SetWeakPointActive(open);
            foreach (var r in pearlShells)
                if (r)
                    r.enabled = open;
        }

        /// <summary>新出现的召唤物染成沙魇；倒下的散成沙</summary>
        void TrackWraiths()
        {
            var d = HDef;
            foreach (var e in Summons.Live)
            {
                if (!e || wraiths.Contains(e)) continue;
                wraiths.Add(e);
                if (SandWraith.Apply(e, d?.wraithTint ?? new Color(0.95f, 0.8f, 0.55f), d?.wraithOverlay ?? new Color(0.85f, 0.66f, 0.4f), d?.wraithOverlayAmount ?? 0.38f))
                    WraithsTinted++;
            }
            for (int i = wraiths.Count - 1; i >= 0; i--)
            {
                var e = wraiths[i];
                if (e && !e.Dead) continue;
                if (e) SandWraith.Crumble(e.transform.position);
                WraithsCrumbled++;
                wraiths.RemoveAt(i);
            }
        }

        /// <summary>这只召唤物被染成了沙魇（测试用）</summary>
        public bool IsWraith(EnemyAI e) => e && wraiths.Contains(e);

        // ───────────── 动作 ─────────────

        /// <summary>
        /// 播一个招式动作并拉伸到 seconds 秒播完：Animator 有 act_&lt;状态&gt; 触发器（ART2 的 AC_SK_Boss_Hanba）就先按片段时长设 ActScale、再触发；
        /// 没有（代理 / 占位体）就按状态名交叉淡入（框架的 PlayAct，缺状态只警告一次）
        /// </summary>
        public void Act(string state, float seconds)
        {
            if (string.IsNullOrEmpty(state)) return;
            LastAct = state;
            ActsFired++;
            if (anim && anim.isActiveAndEnabled && anim.runtimeAnimatorController)
            {
                var info = AnimInfo(anim);
                string trigger = "act_" + state;
                if (info.triggers.Contains(trigger))
                {
                    if (info.actScale)
                    {
                        float len = info.clips.TryGetValue(state, out var l) ? l : 0;
                        anim.SetFloat(ActScaleId, len > 0 && seconds > 0.05f ? Mathf.Clamp(len / seconds, 0.4f, 2.5f) : 1f);
                    }
                    foreach (var t in info.triggers)
                        if (t != trigger)
                            anim.ResetTrigger(t);
                    anim.SetTrigger(trigger);
                    LastActPath = "trigger";
                    return;
                }
            }
            LastActPath = "crossfade";
            PlayAct(state, seconds);
        }

        (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale) AnimInfo(Animator a)
        {
            var ctrl = a.runtimeAnimatorController;
            if (animInfo.TryGetValue(ctrl, out var info)) return info;
            var triggers = new HashSet<string>();
            bool actScale = false;
            foreach (var p in a.parameters)
            {
                if (p.type == AnimatorControllerParameterType.Trigger && p.name.StartsWith("act_", StringComparison.Ordinal)) triggers.Add(p.name);
                if (p.nameHash == ActScaleId) actScale = true;
            }
            // 片段名 = <资产>_<状态>（NativeClipBuilder 的命名）
            var clips = new Dictionary<string, float>();
            foreach (var c in ctrl.animationClips)
            {
                if (!c) continue;
                int us = c.name.LastIndexOf('_');
                string state = us >= 0 ? c.name.Substring(us + 1) : c.name;
                clips[state] = c.length;
            }
            info = (triggers, clips, actScale);
            animInfo[ctrl] = info;
            return info;
        }

        void OnOwnMoveEnded(BossBrain b, BossMove m) => ClearActTriggers();

        /// <summary>收招 / 被打断后清掉没被消费的触发器，免得下一次进招式间隙时又跳回招式动作</summary>
        void ClearActTriggers()
        {
            if (!anim || !anim.runtimeAnimatorController) return;
            foreach (var t in AnimInfo(anim).triggers) anim.ResetTrigger(t);
        }

        // ───────────── 框架钩子 ─────────────

        protected override void IntroTick(float t, float dt)
        {
            // 登场：日轮从暗处慢慢燃起
            if (Ring) Ring.SetBlaze(Mathf.Lerp(0.05f, Ring.idleBlaze, t), Mathf.Lerp(0.2f, 1f, t));
        }

        protected override void OnIntroEnd()
        {
            if (Ring) Ring.Idle();
        }

        /// <summary>
        /// 进入新阶段（BS2 的接入点）：吸干泉水 + 喷气裂缝（二阶段）、日轮升入穴顶裂缝（三阶段）都接在这里。
        /// BS1 的占位：日轮炸亮一下、转快，之后招式按 <see cref="Pace"/> 变快（前摇缩短、扫得更快、沙魇 4 只、旱风补余波）
        /// </summary>
        protected override void OnPhase(int phase)
        {
            ClearActTriggers();
            if (Ring)
            {
                Ring.Flash(1f);
                Ring.SetBlaze(1f, 2.5f);
            }
            SkillFx.Burst(BodyCenter + Vector3.up, HanbaDef.Sun, 36, 9f, 1.1f, 0.4f, 3f);
        }

        protected override void TransitionTick(float t, float dt) => Glow(0, Mathf.PingPong(t * 1.6f, 1f));

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            Glow(0, 0);
            if (Ring) Ring.Idle();
        }

        protected override void OnEnrage(string reason)
        {
            if (Ring)
            {
                Ring.idleBlaze = Mathf.Max(Ring.idleBlaze, 0.55f);
                Ring.spinSpeed *= 1.5f;
                Ring.Idle();
            }
        }

        protected override void OnStaggered(float seconds) => ClearActTriggers();

        protected override void OnDefeated(DamageInfo info)
        {
            ClearActTriggers();
            if (Exposure) Exposure.active = false;
            if (Ring) Ring.Extinguish();
            SetWeak(true, true);
            PlayAct("death", Def != null ? Def.defeat.seconds : 4f);
            foreach (var e in wraiths)
                if (e)
                    SandWraith.Crumble(e.transform.position);
            wraiths.Clear();
        }
    }
}
