using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃的行为（<see cref="HanbaDef"/>；首领框架 <see cref="BossBrain"/> 的子类，招式在 Hanba/Moves/）。在框架之上加这几层：
    ///   · 运行时姿态层：整体悬浮 <see cref="HanbaDef.hover"/> + 上下起伏（模型根节点抬高，角色胶囊跟着抬），关掉脚步 IK（悬浮着不踩地）；
    ///     日轮（<see cref="SunRing"/>）旋转、炽度；残衣 / 长发 / 袖垂片是 CreatureRig 的弹簧骨（以人形片段里这些骨的关键帧为目标：手 K 的长发回垂由片段给，惯性、过冲由这层给）。
    ///   · 日晒（<see cref="SunExposure"/>）：登场后每 0.1 s 判定一次玩家，光柱 + 日轮直射，参数取自定义。
    ///   · 泉珠弱点：只在招式后摇（收招段 + <see cref="HanbaDef.weakGrace"/>）、硬直和日蚀窗口（<see cref="OpenEclipse"/>）露出——开弱点球、点亮泉珠发光壳
    ///     （SK_Boss_Hanba_GlowShell）；其余时间弱点球关着，只能打身体。日蚀窗口里打在泉珠上的伤害再 × <see cref="HanbaDef.eclipseWeakMult"/>。
    ///   · 沙魇：召唤物出现后染成沙魇（<see cref="SandWraith"/>），倒下时散成沙。
    ///   · 太阳：露天场地（1-4 鸣沙山月牙泉）的主光仰角高过 <see cref="HanbaDef.lowSunMax"/> 时，登场演出里压成午后的低太阳（长影子 = 荫蔽，<see cref="HanbaSunDriver"/>）。
    ///   · 阶段的场地变化（<see cref="OnPhase"/>）：进二阶段吸干泉水、泉床龟裂、之后喷气（<see cref="Phase2Scorch"/>）；进三阶段日轮升到头顶、太阳推到约 85°（<see cref="Phase3SunRise"/>）。
    ///   · 飞天之殇：<see cref="SummonApsara"/> 召出的邪飞天不走召唤上限，由琵琶护体（<see cref="ApsaraWard"/>）盯着；她倒下时一起崩解。
    ///   · 演出（<see cref="HanbaCinematics"/>）：登场长啸（intro 片段 58%，或 roar 事件）、转阶段名卡 / 慢动作、倒下后的落地 / 日轮坠落 / 泉眼复涌 / 太阳回到午后。
    /// 动作：<see cref="Act"/> 优先走 ART2 的 act_&lt;状态&gt; 触发器（先按片段时长设 ActScale，让出手事件落在实际前摇结束），
    /// 模型没有这个触发器（代理 / 占位）时退回框架的 <see cref="BossBrain.PlayAct"/>（按状态名，缺了只警告一次）。出手时刻由招式的 Cue 跟动画事件走。
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

        /// <summary>出招节奏（一阶段 = 1；二、三阶段更快，见 <see cref="HanbaDef.pace"/>）</summary>
        public float Pace => HDef != null ? HDef.PaceAt(Phase) : 1f;

        /// <summary>二阶段的场地变化（吸干、龟裂、喷气）、三阶段的日轮升顶、琵琶护体、演出层</summary>
        public Phase2Scorch Scorch { get; private set; }
        public Phase3SunRise SunRise { get; private set; }
        public ApsaraWard Ward { get; private set; }
        public HanbaCinematics Cinematics { get; private set; }
        /// <summary>这片场地的泉水（进二阶段时找到；没有泉水的场地为 null）</summary>
        public HanbaSpring Spring => Scorch?.Spring;
        /// <summary>琵琶护体着</summary>
        public bool WardUp => Ward && Ward.Up;
        /// <summary>召出来、还活着的邪飞天（没有为 null）</summary>
        public ApsaraAI Apsara => apsara && !apsara.Dead ? apsara : null;
        /// <summary>累计召出几只邪飞天</summary>
        public int ApsarasSummoned { get; private set; }

        /// <summary>日蚀窗口开着（泉珠露出、伤害 × 倍率）</summary>
        public bool EclipseOpen { get; private set; }
        /// <summary>当前 / 最近一次日蚀窗口的泉珠倍率</summary>
        public float EclipseMult { get; private set; } = 1f;
        /// <summary>累计：日蚀窗口次数、窗口里打中泉珠的次数</summary>
        public int EclipseWindows { get; private set; }
        public int EclipseWeakHits { get; private set; }
        /// <summary>登场长啸放过了（震屏 + 慢动作）</summary>
        public bool IntroRoared { get; private set; }
        /// <summary>喷气裂缝画过的预警个数（经 <see cref="NotifyVent"/> 记，测试用）</summary>
        public int VentWarnings { get; private set; }
        /// <summary>登场时把露天场地的太阳压成了午后低太阳（关卡本来就低时为 false）</summary>
        public bool LoweredSun { get; private set; }

        readonly List<EnemyAI> wraiths = new();
        readonly List<Renderer> pearlShells = new();
        readonly Dictionary<RuntimeAnimatorController, (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale)> animInfo = new();
        float weakGrace, bobT;
        Vector3 capsuleBase;
        bool rigged;
        ApsaraAI apsara;
        IDisposable eclipseMod;

        // ───────────── 生成 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            if (Def == null) return;
            SetupRuntimeLayer();
        }

        /// <summary>悬浮、日轮、日晒、泉珠、场地变化、护体、演出（生成后模型已就位时调一次）</summary>
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
            // 龟裂的白金裂光、日轮三层自发光（_E 遮罩；正式模型才有，代理 / 白盒日轮没有登记配色，什么都不做）
            GlowMask.Attach(this);
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
            Ward = GetComponent<ApsaraWard>();
            if (!Ward) Ward = gameObject.AddComponent<ApsaraWard>();
            Cinematics = GetComponent<HanbaCinematics>();
            if (!Cinematics) Cinematics = gameObject.AddComponent<HanbaCinematics>();
            Scorch = new Phase2Scorch(this);
            SunRise = new Phase3SunRise(this);
            pearlShells.Clear();
            if (Model?.root)
                foreach (var r in Model.root.GetComponentsInChildren<Renderer>(true))
                    if (r.name.IndexOf("GlowShell", StringComparison.OrdinalIgnoreCase) >= 0)
                        pearlShells.Add(r);
            MoveEnded -= OnOwnMoveEnded;
            MoveEnded += OnOwnMoveEnded;
            hp.Damaged -= OnOwnDamaged;
            hp.Damaged += OnOwnDamaged;
            IntroRoared = false;
            LowerSun();
            rigged = true;
            SetWeak(false, true);
        }

        /// <summary>一阶段要午后的低太阳：露天场地（没有穴顶开口标记）的主光高过 lowSunMax 时，在登场演出里压到 lowSunElevation</summary>
        void LowerSun()
        {
            LoweredSun = false;
            var d = HDef;
            if (d == null || !SunExposure.OpenSky) return;
            var sky = HanbaSunDriver.Find();
            if (!sky || sky.Elevation <= d.lowSunMax + 0.5f) return;
            sky.DriveTo(d.lowSunElevation, Mathf.Max(0.5f, d.intro.seconds * 0.8f));
            LoweredSun = true;
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Def == null || !rigged) return;
            float dt = Time.deltaTime;
            Hover(dt);
            TickHold(dt);
            if (Dead) return;
            Weakpoint(dt);
            TrackWraiths();
        }

        /// <summary>悬浮：模型根节点抬到 hover + 起伏（倒下后的落地由演出层接手）</summary>
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

        /// <summary>泉珠：收招段 → 露出（再留 weakGrace 秒）；硬直、日蚀窗口中也露着</summary>
        void Weakpoint(float dt)
        {
            if (Current != null && Current.Stage == MoveStage.Recover) weakGrace = HDef?.weakGrace ?? 0.6f;
            else weakGrace -= dt;
            bool open = IntroDone && !Transitioning && (weakGrace > 0 || Staggered || EclipseOpen);
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

        // ───────────── 日蚀窗口 ─────────────

        /// <summary>开日蚀窗口：泉珠露出，打在泉珠上的伤害（DamageInfo.weakpoint）× weakMult（弱点必暴之外再乘）。可重复调用</summary>
        public void OpenEclipse(float weakMult)
        {
            if (Dead) return;
            EclipseMult = Mathf.Max(1f, weakMult);
            if (!EclipseOpen) EclipseWindows++;
            EclipseOpen = true;
            eclipseMod?.Dispose();
            float k = EclipseMult;
            eclipseMod = hp.Incoming.Add((in IncomingHit h) => h.info.weakpoint ? k : 1f);
            SetWeak(true);
        }

        /// <summary>关日蚀窗口（泉珠回到「只在后摇露出」）</summary>
        public void CloseEclipse()
        {
            EclipseOpen = false;
            eclipseMod?.Dispose();
            eclipseMod = null;
        }

        void OnOwnDamaged(DamageInfo info, DamageResult r)
        {
            if (EclipseOpen && info.weakpoint && r.total > 0) EclipseWeakHits++;
        }

        // ───────────── 飞天之殇 ─────────────

        /// <summary>
        /// 在 at 召出被腐化的邪飞天（同首领难度；不走召唤上限，不染沙魇），名字「日灼·邪飞天」、一层暗赤金，立刻给自己套上琵琶护体。
        /// 已经有一只活着时不再召（只把护体续上）；返回召出 / 现有的那只（失败为 null）
        /// </summary>
        public ApsaraAI SummonApsara(Vector3 at)
        {
            if (Dead) return null;
            var d = HDef;
            if (!Apsara)
            {
                var face = PlayerPosition - at;
                face.y = 0;
                var rot = face.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(face) : transform.rotation;
                EnemyAI ai;
                try
                {
                    ai = EnemyRoster.Spawn(d?.apsaraId ?? "apsara", at, rot, level, false, new SpawnOptions { parent = transform.parent });
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                    return null;
                }
                apsara = ai as ApsaraAI;
                if (!apsara)
                {
                    if (ai) Combat.Execute(ai.Health, true);
                    Debug.LogWarning($"[Boss] {Def?.id} 召出的 {d?.apsaraId} 不是邪飞天（ApsaraAI）");
                    return null;
                }
                ApsarasSummoned++;
                if (apsara.Body) apsara.Body.SetOverlay("hanbaSorrow", d?.apsaraOverlay ?? new Color(0.85f, 0.32f, 0.12f), d?.apsaraOverlayAmount ?? 0.35f);
                if (apsara.Health) apsara.Health.displayName = d?.apsaraName ?? "日灼·邪飞天";
            }
            Ward.Raise(this, apsara);
            return apsara;
        }

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
                    // 还在上一段的过渡里（收招回待机的 0.2 s、PlayLocomotion 的交叉淡入）时，任意状态的触发要等过渡走完才生效——
                    // 整段动作晚开 0.15 s，出手姿势就落在判定之后（beats-hanba 实测旱风 / 召沙魇 / 焦裂晚 9 帧）。这时直接切进去
                    int hash = Animator.StringToHash(state);
                    if (anim.IsInTransition(0) && anim.HasState(0, hash))
                    {
                        anim.ResetTrigger(trigger);
                        anim.CrossFadeInFixedTime(hash, 0.1f, 0, 0f);
                    }
                    else anim.SetTrigger(trigger);
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

        // ───────────── 释放帧的顿帧（只顿她自己的动作）─────────────

        float holdLeft, holdDebt;

        /// <summary>本次顿帧累计次数（测试用）</summary>
        public int ImpactHolds { get; private set; }

        /// <summary>
        /// 释放帧的顿帧：只把她自己的 Animator 压到 ×0.05 停 seconds 秒（极限姿势「咬」住一下），之后以 ×1.6 追回欠下的时间——
        /// 后面的动画事件（beamEnd / flare / palmOut…）照样落在原来的时刻附近，不拖慢招式；全局时间不动（敌人出招不该让玩家的手感顿住）
        /// </summary>
        public void ImpactHold(float seconds)
        {
            if (!anim || Dead || !(seconds > 0)) return;
            holdLeft = Mathf.Max(holdLeft, Mathf.Min(0.12f, seconds));
            ImpactHolds++;
        }

        string holdCue;
        float holdCueSeconds, holdCueWait;

        /// <summary>
        /// 等出手事件 cue 到了再顿帧（出手按时间兜底先到、动作还差一两帧时用）；最多等 maxWait 秒，等不到（代理模型没有事件）就地顿
        /// </summary>
        public void ImpactHoldOn(string cue, float seconds, float maxWait = 0.12f)
        {
            if (!anim || Dead || !(seconds > 0)) return;
            holdCue = cue;
            holdCueSeconds = seconds;
            holdCueWait = maxWait;
        }

        void TickHold(float dt)
        {
            if (!anim) return;
            if (holdCue != null && (holdCueWait -= dt) <= 0)
            {
                holdCue = null;
                ImpactHold(holdCueSeconds);
            }
            if (Dead)
            {
                holdLeft = holdDebt = 0;
                anim.speed = 1f;
                return;
            }
            if (holdLeft > 0)
            {
                holdLeft -= dt;
                holdDebt += dt * 0.95f;
                anim.speed = 0.05f;
                return;
            }
            if (holdDebt > 0)
            {
                const float CatchUp = 1.6f;
                holdDebt -= dt * (CatchUp - 1f);
                anim.speed = holdDebt > 0 ? CatchUp : 1f;
                if (holdDebt <= 0) holdDebt = 0;
            }
            else if (anim.speed != 1f) anim.speed = 1f;
        }

        // ───────────── 特效挂点 ─────────────

        Transform pearlBone;
        bool pearlSearched;

        /// <summary>手掌（人形骨骼的 RightHand / LeftHand；代理、占位体没有时取身体中线前上方）</summary>
        public Vector3 Hand(bool right)
        {
            var a = Model?.animator;
            if (a && a.isHuman)
            {
                var t = a.GetBoneTransform(right ? HumanBodyBones.RightHand : HumanBodyBones.LeftHand);
                if (t) return t.position;
            }
            return BodyCenter + transform.forward * 0.8f + transform.right * (right ? 0.6f : -0.6f) + Vector3.up * 0.8f;
        }

        /// <summary>心口的泉珠（socket_core；没有时取身体中心前方）</summary>
        public Vector3 Pearl
        {
            get
            {
                if (!pearlSearched && Model?.root)
                {
                    pearlSearched = true;
                    foreach (var t in Model.root.GetComponentsInChildren<Transform>(true))
                        if (t.name == "socket_core" || t.name.EndsWith("socket_core"))
                        {
                            pearlBone = t;
                            break;
                        }
                }
                return pearlBone ? pearlBone.position : BodyCenter + transform.forward * 0.5f + Vector3.up * 0.6f;
            }
        }

        /// <summary>收招 / 被打断后清掉没被消费的触发器，免得下一次进招式间隙时又跳回招式动作</summary>
        void ClearActTriggers()
        {
            if (!anim || !anim.runtimeAnimatorController) return;
            foreach (var t in AnimInfo(anim).triggers) anim.ResetTrigger(t);
        }

        /// <summary>喷气裂缝画了一个预警（<see cref="Phase2Scorch"/> 调，计数后照常派发 MoveTelegraphed 以外的统计）</summary>
        internal void NotifyVent() => VentWarnings++;

        // ───────────── 框架钩子 ─────────────

        protected override void IntroTick(float t, float dt)
        {
            // 登场：日轮从暗处慢慢燃起；长啸那一下（intro 片段 70 / 120 帧）震屏、炸亮、短慢动作
            if (Ring) Ring.SetBlaze(Mathf.Lerp(0.05f, Ring.idleBlaze, t), Mathf.Lerp(0.2f, 1f, t));
            if (!IntroRoared && t >= (HDef?.roarAt ?? 0.5833f)) IntroRoar();
        }

        /// <summary>登场长啸：震屏、日轮炸亮、脚下一圈沙浪、暖色闪屏、短慢动作（只一次）</summary>
        void IntroRoar()
        {
            if (IntroRoared) return;
            IntroRoared = true;
            var d = HDef;
            Shake(0.75f, 0.7f, 80f);
            if (Ring)
            {
                Ring.Flash(1f);
                Ring.SetBlaze(1f, 3f);
            }
            var feet = transform.position + Vector3.up * 0.1f;
            Fx.Ring(feet, 10f, HanbaDef.Sand, 0.8f);
            SkillFx.Ring(transform.position, 16f, HanbaDef.Sun, 0.7f);
            Fx.Burst(BodyCenter, HanbaDef.Sun, 30, 8f, 1f, 0.35f, 2f);
            GameUI.ScreenFlash(new Color(1f, 0.85f, 0.5f, 0.3f), 0.5f);
            if (Cinematics) Cinematics.SlowMo(d?.introSlowMo ?? 0.45f, d?.introSlowMoSeconds ?? 0.35f);
        }

        protected override void OnIntroEnd()
        {
            if (!IntroRoared) IntroRoar();
            if (Ring) Ring.Idle();
        }

        protected override void OnAnimEvent(string evt)
        {
            if (evt == "roar" && !IntroDone) IntroRoar();
            if (holdCue != null && evt == holdCue)
            {
                holdCue = null;
                ImpactHold(holdCueSeconds);
            }
        }

        /// <summary>
        /// 进入新阶段：阶段名卡 + 慢动作 + 日轮炸亮；进二阶段吸干泉水、泉床龟裂（之后喷气）；进三阶段日轮升进穴顶裂缝。
        /// 一阶段的招式照常留着、按 <see cref="Pace"/> 变快
        /// </summary>
        protected override void OnPhase(int phase)
        {
            ClearActTriggers();
            CloseEclipse();
            if (Ring && !Ring.Eclipsed)
            {
                Ring.Flash(1f);
                Ring.SetBlaze(1f, 2.5f);
            }
            SkillFx.Burst(BodyCenter + Vector3.up, HanbaDef.Sun, 36, 9f, 1.1f, 0.4f, 3f);
            var d = HDef;
            float seconds = d != null && phase - 1 < d.phases.Count && phase >= 1 ? d.phases[phase - 1].seconds : 3f;
            if (Cinematics && d != null)
            {
                Cinematics.Card(d.CardTitle(phase), d.CardSub(phase), Mathf.Clamp(seconds, 2f, 3.2f));
                Cinematics.SlowMo(d.phaseSlowMo, d.phaseSlowMoSeconds);
            }
            if (phase >= 1) Scorch?.Begin(seconds);
            if (phase >= 2) SunRise?.Begin(seconds);
        }

        protected override void TransitionTick(float t, float dt) => Glow(0, Mathf.PingPong(t * 1.6f, 1f));

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            Glow(0, 0);
            if (Ring) Ring.Idle();
        }

        /// <summary>招式间隙和出招中每帧：二阶段起裂缝喷气</summary>
        protected override void Passive(float dt)
        {
            if (Phase >= 1) Scorch?.Tick(dt);
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
            CloseEclipse();
            if (Exposure) Exposure.active = false;
            if (Cinematics) Cinematics.Defeat(this);
            if (Ring) Ring.Extinguish();
            SetWeak(true, true);
            PlayAct("death", Def != null ? Def.defeat.seconds : 4f);
            foreach (var e in wraiths)
                if (e)
                    SandWraith.Crumble(e.transform.position);
            wraiths.Clear();
            if (Ward) Ward.Drop(false);
            // 邪飞天随她崩解（静默处决：不掉落）
            var a = Apsara;
            if (a && a.Health)
            {
                Fx.Burst(a.transform.position + Vector3.up * 1.4f, HanbaDef.Sun, 20, 4f, 1.2f, 0.25f, -1f);
                Combat.Execute(a.Health, true);
            }
            Scorch?.End();
            DefeatFx();
        }

        /// <summary>
        /// 倒下的特效（特效打磨 C 路）：身上的沙一路往下泻、整个人往下塌时炸起一圈沙浪，泉水回涌时泉心冒起一股水，溃散那一下金沙四散
        /// </summary>
        void DefeatFx()
        {
            var model = Model?.root ? Model.root : gameObject;
            float secs = Def != null ? Def.defeat.seconds : 4.2f;
            Fx.BodyStream(model, StreamKind.Sand, secs, 150f);
            Fx.SandBlast(BodyCenter, 2.4f);
            BossDefeatFx.On(gameObject)
                .At(2.0f, () =>
                {
                    var feet = transform.position;
                    Fx.SandBlast(feet + Vector3.up * 0.3f, 3.6f);
                    Fx.Slam(feet, 4.5f, HanbaDef.Sand);
                })
                .At(2.4f, () =>
                {
                    var p = transform.position;
                    if (!IntroFx.WaterSurface(p, out float y)) return;
                    p.y = y;
                    Fx.WaterDisturb(p, 8f, 1.4f);
                    Fx.SpringSpout(p, 1.2f, 4.5f, 0.5f);
                })
                .At(secs * 0.88f, () => Fx.SandBlast(BodyCenter, 3.2f, HanbaDef.Sun));
        }
        // 注意：这里不写 OnDestroy——EnemyAI 自己的 OnDestroy（从敌人登记里移除）会被子类的同名消息挡掉
    }
}
