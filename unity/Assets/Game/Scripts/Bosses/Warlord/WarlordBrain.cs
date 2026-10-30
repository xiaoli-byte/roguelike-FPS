using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将的行为（<see cref="WarlordDef"/>；首领框架 <see cref="BossBrain"/> 的子类）。招式是 B1 的参考招式（TS 原值）+ <see cref="WarlordChannelSurge"/>，这里加四层：
    ///   · 动作导演：参考招式只管判定，部件骨架的动作（E5：AC_SK_Boss_Warlord 的 act_ 触发器 + ActScale）由这里按招式时间轴触发——
    ///     冲锋 chargeReady（→ charge 由状态机接上，撞墙补 crash，连冲时第二次预警再来一次 chargeReady）、横扫 sweepReady（二阶段反手 sweepReady2 → sweepBack）、
    ///     陨石雨 raise、跃击 crouch（→ leap → land）、连斩 slashA / slashB 交替、熔铜渠 plant；片段按「出手事件在片段里的位置」拉伸到实际前摇。
    ///     模型没有这个触发器（代理 / 占位体）时退回框架的 <see cref="BossBrain.PlayAct"/>（按状态名交叉淡入，缺了只警告一次）。
    ///   · 登场：从 <see cref="WarlordDef.dropHeight"/> 米高处砸进场地（模型根节点下落，落地爆炸 + 火环 + 震屏），70% 时仰天咆哮；结束提示「角盔是弱点」。
    ///   · 狂怒（20%，<see cref="BossDef.enrageBelow"/>）：陨石雨冷却缩到 7 s，三阶段起战斗中每 2.4 s 在玩家周围落一颗零星陨石（落点预警、落地留火）。
    ///   · 熔铜渠：场地上的 <see cref="FoundryChannels"/>（3-3 神范台），倒下时退回去；铠甲随阶段由暗红烧到赤红（覆盖色）。
    ///   · 读招轮廓（<see cref="UpdateLook"/>）：暗红黑的铠甲在 3-3 暗红打光里远处只剩剪影（审阅图集问题清单）——
    ///     平时一圈暖金边光 + 很淡的余烬自发光把轮廓托出来；每一招的前摇里边光转白热、自发光跟着一跳一跳地烧亮，前摇本身就是信号。
    ///   · 动作 · 特效调优（W 路，docs/art/vfx/warlord.md）：熔心大剑挂到握点骨上（<see cref="WarlordBlade"/>：焰刃烧亮、跟刀走的拖影）；
    ///     招牌招式是 Blender 手 K 的关键帧（art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py，同名覆盖采样片段），
    ///     连斩最后一刀换成双手竖劈 slashC、冲锋刹停 chargeStop、跃击落地那一刻才播 land、登场下坠 fall、倒下 death；
    ///     释放帧（招式的判定时刻）由招式调 <see cref="SweepStrike"/> 等，在这一帧把顿帧（动作冻 0.05–0.09 s）、震屏、出手特效对齐；
    ///     片段里的 hit 事件只用来量「动作的释放帧和判定差多少」（<see cref="LastHitSkew"/>，节拍条套件记下来）。
    ///   · 狂怒换挡（20%）：咆哮炸开那一帧白热冲击环，之后铠甲 / 边光 / 剑身转白热铜，两肩冒火舌、背后飘紫褐烟（<see cref="FuryLook"/>）。
    /// 受击片段等 ART8；硬直时播 Hit 缺片段只警告一次。
    /// </summary>
    public class WarlordBrain : BossBrain
    {
        static readonly int ActScaleId = Animator.StringToHash("ActScale");
        static readonly int RimColorId = Shader.PropertyToID("_RimColor"), RimStrengthId = Shader.PropertyToID("_RimStrength"),
            EmissionId = Shader.PropertyToID("_EmissionColor");
        /// <summary>读招轮廓：平时的边光色 / 强度、前摇时的白热边光、余烬自发光（前摇时 × 3.5）</summary>
        static readonly Color RimRest = new(1f, 0.6f, 0.3f), RimHot = new(1f, 0.93f, 0.75f), Ember = new(0.16f, 0.045f, 0.01f);
        const float RimRestStrength = 1.05f, RimHotStrength = 1.9f;

        public WarlordDef WDef => Def as WarlordDef;

        /// <summary>
        /// 对照开关（节拍条套件的性能对照用，游戏里永远是 false）：为真时招式照旧放调优前的通用出手特效（WarlordRef.Lord 返回 null），
        /// 同一会话里先测旧特效、再测新特效
        /// </summary>
        public static bool LegacyFx;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => LegacyFx = false;
        /// <summary>场地上的熔铜渠（没有为 null：熔铜渠涨落退回环带写法）</summary>
        public FoundryChannels Channels { get; private set; }
        /// <summary>最近一次 <see cref="Act"/> 的状态名与走的路径（"trigger" / "crossfade"）、累计触发次数（测试 / 调试）</summary>
        public string LastAct { get; private set; }
        public string LastActPath { get; private set; }
        public int ActsFired { get; private set; }
        /// <summary>狂怒后落下的零星陨石数</summary>
        public int AmbientMeteors { get; private set; }
        /// <summary>登场下落的当前高度（米；落地后 0）、登场砸地了没有</summary>
        public float DropNow { get; private set; }
        public bool Landed { get; private set; }
        /// <summary>铠甲的炽热程度（0 → 阶段数，平滑跟随）</summary>
        public float Fury { get; private set; }

        readonly Dictionary<RuntimeAnimatorController, (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale)> animInfo = new();
        int dirStep;
        bool roared, rigged;
        float ambientAcc, fxAcc;
        // 登场下坠的火尾（锥尾体积 + 挂在身上的火舌 + 甩出去的熔铜）：落地时收掉
        FxHandle dropTrail;
        readonly System.Collections.Generic.List<FlameTongue> dropFlames = new();
        Renderer[] lookRenderers;
        MaterialPropertyBlock lookBlock;
        /// <summary>前摇亮度（0..1，进前摇快升、出前摇慢落；测试 / 调试读）</summary>
        public float WindupGlow { get; private set; }

        /// <summary>熔心大剑（挂上了才有）</summary>
        public WarlordBlade Blade { get; private set; }
        /// <summary>狂怒换挡的外观程度（0..1，平滑）</summary>
        public float FuryLook { get; private set; }
        /// <summary>最近一次释放帧：片段 hit 事件减招式判定时刻（秒；正 = 动作晚）、累计顿帧次数（测试 / 节拍条读）</summary>
        public float LastHitSkew { get; private set; }
        public int Holds { get; private set; }
        public string LastStrike { get; private set; }

        float strikeAt = -1f, holdUntil = -1f, smokeAcc, dragAcc, hitSeenAt = -1f;
        /// <summary>等片段释放帧（hit / impact / cast 事件）再放的出手特效</summary>
        System.Action pendingFx;
        int pendingFrame;
        /// <summary>片段事件没来、按判定时刻兜底放出手特效的次数（测试 / 节拍条读）</summary>
        public int FxFallbacks { get; private set; }
        /// <summary>最近几次兜底的是哪一招（测试 / 节拍条读）</summary>
        public string FallbackLog { get; private set; } = "";
        /// <summary>放过几次释放帧的表现（顿帧 + 出手特效；冲锋起跑也算）：节拍条套件按它拍「释放帧」那一格</summary>
        public int Releases { get; private set; }
        bool furyShifted, defeatKneel, defeatCollapse;
        readonly FlameTongue[] furyFlames = new FlameTongue[3];
        Transform[] furyAnchors;

        // ───────────── 生成 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            if (Def == null) return;
            // 部件骨架没有 lookBones，也没有名字含 head 的骨：头骨指到角盔（参考招式的「眼睛」、弱点兜底都用它）
            if (Model != null && Model.source == BossModelSource.Art && string.IsNullOrEmpty(Model.weakFallback)) Model.weakFallback = WarlordDef.HeadBone;
            Channels = FoundryChannels.For(Arena);
            MoveStarted -= OnOwnMoveStarted;
            MoveStarted += OnOwnMoveStarted;
            MoveTelegraphed -= OnOwnTelegraphed;
            MoveTelegraphed += OnOwnTelegraphed;
            MoveEnded -= OnOwnMoveEnded;
            MoveEnded += OnOwnMoveEnded;
            Landed = roared = false;
            furyShifted = defeatKneel = defeatCollapse = false;
            SetDrop(WDef?.dropHeight ?? 0f);
            AttachBlade();
            rigged = true;
        }

        /// <summary>
        /// 熔心大剑：EnemyCatalog 里 bind = boss_warlord / greatsword 的挂件，按绑定姿势挂到握点骨 j_0_1_21_1_5（部件骨架没有 socket_greatsword，
        /// Bosses.AttachParts 挂不上；美术模型才挂，代理 / 占位没有这根骨）
        /// </summary>
        void AttachBlade()
        {
            if (Blade || Model?.root == null || Model.source != BossModelSource.Art) return;
            Transform grip = null, tip = null;
            foreach (var t in Model.root.GetComponentsInChildren<Transform>(true))
            {
                if (t.name == WarlordDef.GripBone) grip = t;
                else if (t.name == WarlordDef.TipBone) tip = t;
            }
            if (!grip) return;
            GameObject prefab = null;
            foreach (var part in EnemyCatalog.Attachments)
            {
                var pi = part ? part.GetComponent<Spiritfire.Art.ArtAssetInfo>() : null;
                if (pi && pi.bindId == WarlordDef.Id && pi.bindAttachment == "greatsword") prefab = part;
            }
            if (!prefab) return;
            var smr = Model.root.GetComponentInChildren<SkinnedMeshRenderer>(true);
            Blade = WarlordBlade.Attach(prefab, grip, tip, smr);
            lookRenderers = null;
        }

        void SetDrop(float h)
        {
            DropNow = Mathf.Max(0, h);
            if (Model?.root == null) return;
            float s = Mathf.Max(0.01f, Model.scale);
            Model.root.transform.localPosition = Vector3.up * (DropNow / s);
        }

        // ───────────── 动作 ─────────────

        /// <summary>
        /// 播一个招式动作并拉伸到 seconds 秒播完：Animator 有 act_&lt;状态&gt; 触发器（E5 的 AC_SK_Boss_Warlord）就先按片段时长设 ActScale、再触发；
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
                clips[us >= 0 ? c.name.Substring(us + 1) : c.name] = c.length;
            }
            info = (triggers, clips, actScale);
            animInfo[ctrl] = info;
            return info;
        }

        void ClearActTriggers()
        {
            if (!anim || !anim.runtimeAnimatorController) return;
            foreach (var t in AnimInfo(anim).triggers) anim.ResetTrigger(t);
        }

        /// <summary>出招第一帧：前摇动作（时长按招式的实际前摇；出手事件在片段里的位置 → 拉伸到出手正好在前摇结束）</summary>
        void OnOwnMoveStarted(BossBrain b, BossMove m)
        {
            dirStep = 0;
            float ws = WindupScale;
            switch (m)
            {
                case WarlordCharge:
                    Act("chargeReady", (Phase >= 1 ? 0.75f : 0.9f) * ws);
                    break;
                case WarlordSweep:
                    Act("sweepReady", (Phase >= 1 ? 0.7f : 0.85f) * ws);
                    break;
                case WarlordMeteor:
                    // raise 的 cast 事件在片段 33% 处：拉伸到 cast 正好在举剑结束
                    Act("raise", m.WindupTime / 0.33f);
                    break;
                case WarlordLeap:
                    Act("crouch", (Phase >= 1 ? 0.38f : 0.48f) * ws);
                    break;
                case WarlordCombo:
                    Act(SlashState(0, Phase >= 2 ? 4 : 3), SlashClip);
                    break;
                case WarlordChannelSurge:
                    // plant 的 hit 事件在片段 35% 处
                    Act("plant", m.WindupTime / 0.35f);
                    break;
            }
        }

        /// <summary>连冲：第二次瞄准时招式又画了一条直线预警（出手段里）→ 再来一次 chargeReady</summary>
        void OnOwnTelegraphed(BossBrain b, BossMove m)
        {
            if (m is not WarlordCharge || m.Stage != MoveStage.Active) return;
            Act("chargeReady", 0.65f * WindupScale);
        }

        void OnOwnMoveEnded(BossBrain b, BossMove m) => ClearActTriggers();

        /// <summary>连斩第 k 刀（共 count 刀）的动作：袈裟 slashA / 逆袈裟 slashB 交替，最后一刀双手竖劈 slashC</summary>
        public static string SlashState(int k, int count) => k >= count - 1 ? "slashC" : k % 2 == 0 ? "slashA" : "slashB";

        /// <summary>
        /// 每刀片段拉伸到的时长：比每斩间隔（0.72 s）长 0.12 s——刀到在片段 60% 处（= 0.505 s，对上 0.5 s 的判定），
        /// 下一刀的触发器到的时候这一刀还没开始退回待机（Animator 的退场过渡里 AnyState 触发器进不来，会把下一刀拖后约 0.08 s）
        /// </summary>
        public const float SlashClip = WarlordRef.ComboPer + 0.12f;

        /// <summary>出手段里的分段动作：冲锋撞墙 crash、横扫反手、连斩交替</summary>
        void DirectMoveActs()
        {
            var m = Current;
            if (m == null || m.Stage != MoveStage.Active) return;
            switch (m)
            {
                case WarlordSweep:
                    if (Phase >= 1 && dirStep == 0 && m.StageT >= 0.2f)
                    {
                        dirStep = 1;
                        Act("sweepReady2", 0.55f * WindupScale);
                    }
                    break;
                case WarlordCombo:
                {
                    int count = Phase >= 2 ? 4 : 3;
                    int k = Mathf.FloorToInt(m.T / WarlordRef.ComboPer);
                    if (k > dirStep && k < count)
                    {
                        dirStep = k;
                        Act(SlashState(k, count), SlashClip);
                    }
                    break;
                }
            }
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (!rigged || Def == null) return;
            float dt = Time.deltaTime;
            // 铠甲炽热度：跟阶段走（倒下后熄灭）
            float target = Dead ? 0 : Phase + (Enraged ? 0.4f : 0);
            if (Mathf.Abs(Fury - target) > 0.002f)
            {
                Fury = Mathf.MoveTowards(Fury, target, dt * 0.8f);
                if (Fury > 0.01f) body.SetOverlay("warlordFury", Color.Lerp(WarlordDef.Fire, WarlordDef.Rage, Mathf.Clamp01(Fury - 1f)), Mathf.Clamp01(Fury * 0.09f));
                else body.ClearOverlay("warlordFury");
            }
            // 狂怒换挡：咆哮炸开那一下之后升满（转阶段演出里由 roar 事件 / 时间兜底触发）
            FuryLook = Mathf.MoveTowards(FuryLook, !Dead && furyShifted ? 1f : 0f, dt * (Dead ? 0.6f : 2.2f));
            UpdateLook(dt);
            // 兜底：0.15 s 且至少 4 帧还没等到片段事件（只按秒算的话，掉帧时一帧就超时）
            if (pendingFx != null && (Dead || Time.time - strikeAt > 0.15f && Time.frameCount - pendingFrame >= 4)) FlushRelease(true);
            UpdateHold();
            if (Blade)
            {
                Blade.Heat = Dead ? 0 : WindupGlow;
                Blade.Fury = FuryLook;
            }
            UpdateFuryFlames(dt);
        }

        /// <summary>
        /// 读招轮廓：边光 / 自发光写进模型渲染器的属性块（先 Get 再 Set，和 EnemyBody 的闪白 / 着色共存）。
        /// 前摇中：WindupGlow 0.25 s 升满，边光从暖金转白热、强度 1.05 → 1.9，余烬自发光按 18 rad/s 跳动烧亮；倒下后退回材质原值。
        /// 狂怒换挡后：平时的边光就是白热铜、余烬自发光常亮一档（前摇照样再跳亮）。大剑、火舌有自己的属性块，不在这里写
        /// </summary>
        void UpdateLook(float dt)
        {
            if (Model?.root == null) return;
            if (lookRenderers == null)
            {
                var list = new List<Renderer>();
                foreach (var r in Model.root.GetComponentsInChildren<Renderer>(true))
                    if (r is SkinnedMeshRenderer or MeshRenderer && !r.GetComponentInParent<WarlordBlade>() && !r.GetComponent<FlameTongue>())
                        list.Add(r);
                lookRenderers = list.ToArray();
            }
            bool windup = !Dead && Current != null && Current.Stage == MoveStage.Windup;
            WindupGlow = Mathf.MoveTowards(WindupGlow, windup ? 1f : 0f, dt * (windup ? 4f : 2.5f));
            float pulse = WindupGlow * (0.75f + 0.25f * Mathf.Sin(Time.time * 18f));
            var rimRest = Color.Lerp(RimRest, WarlordPalette.FuryCopper, FuryLook);
            var rimHot = Color.Lerp(RimHot, WarlordPalette.FuryHot, FuryLook);
            float rest = Mathf.Lerp(RimRestStrength, 1.45f, FuryLook);
            lookBlock ??= new MaterialPropertyBlock();
            foreach (var r in lookRenderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(lookBlock);
                if (Dead)
                {
                    lookBlock.SetFloat(RimStrengthId, 0.45f);
                    lookBlock.SetColor(EmissionId, Color.black);
                }
                else
                {
                    lookBlock.SetColor(RimColorId, Color.Lerp(rimRest, rimHot, pulse));
                    lookBlock.SetFloat(RimStrengthId, Mathf.Lerp(rest, RimHotStrength, pulse));
                    lookBlock.SetColor(EmissionId, Ember * (1f + 2.5f * pulse + 1.2f * FuryLook));
                }
                r.SetPropertyBlock(lookBlock);
            }
        }

        /// <summary>
        /// 狂怒常驻：两肩（肩甲挂点 j_0_1_13 / j_0_1_18，网格里没有顶点、正好当挂点）各一片白热火舌、角盔顶一小片；背后隔一会儿飘一团紫褐烟
        /// </summary>
        void UpdateFuryFlames(float dt)
        {
            if (Model?.root == null) return;
            if (FuryLook < 0.01f)
            {
                foreach (var f in furyFlames)
                    if (f)
                        f.Set(0);
                return;
            }
            if (furyAnchors == null)
            {
                furyAnchors = new Transform[3];
                foreach (var t in Model.root.GetComponentsInChildren<Transform>(true))
                {
                    if (t.name == "j_0_1_13") furyAnchors[0] = t;
                    else if (t.name == "j_0_1_18") furyAnchors[1] = t;
                    else if (t.name == WarlordDef.WeakBone) furyAnchors[2] = t;
                }
            }
            for (int i = 0; i < furyFlames.Length; i++)
            {
                if (!furyAnchors[i]) continue;
                if (!furyFlames[i])
                {
                    furyFlames[i] = FlameTongue.Attach(furyAnchors[i], Vector3.zero, Vector3.one, WarlordPalette.FuryHot, WarlordPalette.FuryCopper, WarlordPalette.FuryDeep);
                    if (!furyFlames[i]) continue;
                }
                float s = (i < 2 ? 1.5f : 0.8f) * (0.88f + 0.12f * Mathf.Sin(Time.time * (7f + i) + i * 1.7f));
                furyFlames[i].Set(FuryLook * (Dead ? 0 : 0.95f), new Vector3(s, s * (i < 2 ? 1.7f : 1.3f), s));
            }
            smokeAcc += dt;
            if (smokeAcc < 0.3f || Dead) return;
            smokeAcc = 0;
            var back = BodyCenter - transform.forward * (BodyRadius * 0.6f) + Vector3.up * 1.0f;
            Fx.Burst(back + UnityEngine.Random.insideUnitSphere * 0.5f, WarlordPalette.Smoke, 1, 0.5f, 1.1f, 0.7f, -1.4f);
        }

        // ───────────── 释放帧：顿帧 + 震屏 + 出手特效 ─────────────

        /// <summary>顿帧：动作冻住 seconds 秒（只冻魔将自己的 Animator，不动全局时间），叠在震屏、特效同一帧</summary>
        void Hold(float seconds)
        {
            if (!anim || seconds <= 0) return;
            holdUntil = Mathf.Max(holdUntil, Time.time + seconds);
            anim.speed = 0.04f;
            Holds++;
        }

        void UpdateHold()
        {
            if (holdUntil < 0 || !anim) return;
            if (Time.time < holdUntil && !Dead) return;
            holdUntil = -1f;
            anim.speed = 1f;
        }

        /// <summary>记一次判定时刻（和片段的 hit 事件比对齐）</summary>
        void MarkStrike(string what)
        {
            strikeAt = Time.time;
            LastStrike = what;
        }

        /// <summary>
        /// 释放帧的表现（顿帧 + 震屏 + 出手特效）对到动作的释放帧上：招式判定那一刻登记，等片段的 hit / impact / cast 事件（刀到、落地、插剑那一帧）再放；
        /// 事件先到（动作比判定早）就立刻放；0.15 s（且至少 4 帧）内没等到（代理模型、没有片段）按判定时刻兜底放。
        /// 片段是按招式时间轴拉伸的，事件和判定一般只差 0–1 帧（<see cref="LastHitSkew"/>）
        /// </summary>
        void Release(string what, System.Action fx)
        {
            MarkStrike(what);
            pendingFx = null;
            bool rigged = anim && anim.runtimeAnimatorController && Model != null && Model.source == BossModelSource.Art;
            if (!rigged || hitSeenAt >= 0 && Time.time - hitSeenAt < 0.1f)
            {
                LastHitSkew = rigged ? hitSeenAt - strikeAt : 0f;
                hitSeenAt = -1f;
                Releases++;
                fx();
                return;
            }
            pendingFx = fx;
            pendingFrame = Time.frameCount;
        }

        void FlushRelease(bool fallback)
        {
            var fx = pendingFx;
            pendingFx = null;
            if (fx == null) return;
            if (fallback)
            {
                FxFallbacks++;
                FallbackLog = (FallbackLog.Length > 80 ? "" : FallbackLog + " ") + LastStrike;
            }
            else LastHitSkew = Time.time - strikeAt;
            Releases++;
            fx();
        }

        float Fk => FuryLook;

        /// <summary>
        /// 横扫的释放帧（招式判定那一刻）：主形 = 暗月牙托亮刃的大月牙（贴着火浪起点、腰高）；次级 = 火浪体积（招式自己放）；点缀 = 沿弧甩出的方铜渣、
        /// 脚下紫褐尘；顿帧 0.06 s、震屏。backhand = 二阶段的反手再扫（从左往右）
        /// </summary>
        public void SweepStrike(Vector3 ground, float yawDeg, bool backhand) =>
            Release(backhand ? "sweepBack" : "sweep", () => SweepFx(ground, yawDeg, backhand));

        void SweepFx(Vector3 ground, float yawDeg, bool backhand)
        {
            Hold(0.06f);
            Shake(0.45f, 0.3f);
            int dir = backhand ? -1 : 1;
            float arc = WarlordRef.SweepHalf * 2f * Mathf.Deg2Rad;
            // 月牙中心 1.45 m、朝玩家那侧低头 14°：前缘约 0.4 m 高，第一人称看得到整弯的面，不是一条细线
            Fx.WarlordCrescent(ground + Vector3.up * 1.45f, yawDeg, 4.4f, arc, dir, 0f, 1.7f, Fk, 0.34f, 14f);
            for (int i = -1; i <= 1; i++)
            {
                float a = yawDeg + i * 38f;
                var d = new Vector3(Mathf.Sin(a * Mathf.Deg2Rad), 0, Mathf.Cos(a * Mathf.Deg2Rad));
                var side = Vector3.Cross(Vector3.up, d) * dir;
                Fx.WarlordShards(ground + d * 3.6f + Vector3.up * 0.9f, -side + Vector3.up * 0.3f, 0.8f, Fk);
            }
            Fx.WarlordSmoke(ground + transform.forward * 0.6f, 1.2f, 3);
        }

        /// <summary>
        /// 连斩第 index 刀（0 起，共 count 刀）的释放帧：袈裟 / 逆袈裟是一道斜的月牙（右上 → 左下 / 左下 → 右上），
        /// 最后一刀双手竖劈：竖月牙 + 刀落处的重击 + 往前崩开的裂地线，顿帧更长、震屏更重
        /// </summary>
        public void ComboStrike(int index, int count, float yawDeg, bool hit) =>
            Release(SlashState(index, count), () => ComboFx(index, count, yawDeg, hit));

        void ComboFx(int index, int count, float yawDeg, bool hit)
        {
            string st = SlashState(index, count);
            var feet = transform.position;
            var fwd = new Vector3(Mathf.Sin(yawDeg * Mathf.Deg2Rad), 0, Mathf.Cos(yawDeg * Mathf.Deg2Rad));
            float grow = 1f + 0.08f * index;
            if (st == "slashC")
            {
                Hold(0.09f);
                Shake(0.7f, 0.4f);
                Fx.WarlordCrescent(feet + Vector3.up * 2.4f + fwd * 0.4f, yawDeg, 3.3f * grow, 100f * Mathf.Deg2Rad, 1, -Mathf.PI * 0.5f, 1.3f, Fk, 0.3f);
                var at = feet + fwd * 3.2f;
                float gy = Fx.GroundY(at + Vector3.up * 2f, 4f);
                at.y = float.IsNegativeInfinity(gy) ? feet.y : gy;
                Fx.WarlordImpact(at, 2.6f, Fk);
                Fx.Explosion(at + Vector3.up * 0.35f, 1.7f, WarlordPalette.CopperAt(Fk));
                Fx.WarlordCleave(at, fwd, 4.4f, Fk);
                PlaySfx("boss_slam", 0.9f, 1.15f);
            }
            else
            {
                Hold(hit ? 0.06f : 0.045f);
                Shake(hit ? 0.35f : 0.25f, 0.22f);
                // 袈裟：从右往左（dir 1）、右端高；逆袈裟：从左往右（dir -1）、同样右端高
                int dir = st == "slashA" ? 1 : -1;
                Fx.WarlordCrescent(BodyCenter + Vector3.up * 0.35f, yawDeg, WarlordRef.ComboRange * 0.85f * grow, WarlordRef.ComboHalf * 2f * Mathf.Deg2Rad, dir,
                    -38f * Mathf.Deg2Rad, 1.2f, Fk, 0.28f);
                var tipAt = Blade ? Blade.Tip : BodyCenter + fwd * 3f;
                Fx.WarlordShards(tipAt, fwd + Vector3.up * 0.4f, 0.7f, Fk);
            }
        }

        /// <summary>冲锋起跑（前摇结束）：拖刀奔跑（charge 片段按跑程定长）、起步脚下紫褐尘 + 火星；身后的火尾由招式放</summary>
        public void ChargeRun(Vector3 dir, float runSeconds)
        {
            MarkStrike("charge");
            Releases++;
            Act("charge", Mathf.Clamp(runSeconds, 0.5f, 1.6f));
            Fx.WarlordSmoke(transform.position + Vector3.up * 0.3f, 1f, 3);
            Fx.Burst(transform.position + Vector3.up * 0.3f, WarlordPalette.CopperAt(Fk), 14, 7f, 0.4f, 0.1f, 8f);
            Shake(0.25f, 0.25f);
        }

        /// <summary>
        /// 冲锋结束：撞墙 = crash（撞击点一团熔铜 + 方铜渣 + 重震，顿帧），否则刹停 chargeStop（大剑插地刹车：剑尖一扇火星 + 犁出的熔铜沟 + 紫褐尘，惩罚窗口）
        /// </summary>
        public void ChargeEnd(bool crashed, Vector3 p, Vector3 dir)
        {
            if (crashed)
            {
                Act("crash", 1f);
                Release("crash", () =>
                {
                    Hold(0.08f);
                    var at = p + dir * 1.2f + Vector3.up * 1.4f;
                    Fx.MoltenBurst(at, 1.6f, false, WarlordPalette.CopperAt(Fk));
                    Fx.WarlordShards(at, -dir + Vector3.up * 0.5f, 1.4f, Fk);
                    Fx.WarlordSmoke(at, 1.2f, 4);
                });
                return;
            }
            Act("chargeStop", 0.5f);
            var tip = Blade ? Blade.Tip : p + dir * 1.5f;
            tip.y = p.y + 0.1f;
            Fx.Burst(tip, WarlordPalette.HotAt(Fk), 16, 8f, 0.35f, 0.08f, 12f);
            Fx.MoltenSplat(new Vector3(tip.x, p.y, tip.z), 1.2f, 1f, 4f);
            Fx.WarlordSmoke(p + dir * 0.8f, 1.1f, 3);
            Shake(0.3f, 0.25f);
        }

        /// <summary>跃击起跳：脚下紫褐尘浪 + 一圈铜火星（火尾由招式放）</summary>
        public void LeapTakeoff(Vector3 from)
        {
            MarkStrike("leap");
            Fx.WarlordSmoke(from + Vector3.up * 0.3f, 1.4f, 4);
            Fx.Ring(from + Vector3.up * 0.08f, 3f, WarlordPalette.DeepAt(Fk), 0.3f, false);
            Fx.Burst(from + Vector3.up * 0.2f, WarlordPalette.CopperAt(Fk), 16, 6f, 0.5f, 0.12f, 6f);
        }

        /// <summary>
        /// 跃击落地的释放帧（陨火坠地）：这一刻才播 land（剑插入地的深蹲）、重击落地（粗环、熔铜冠、方铜渣崩一圈、熔铜贴花、紫褐尘浪）、
        /// 顿帧 0.09 s；冲击波 / 火浪体积由招式放
        /// </summary>
        public void LeapLand(Vector3 floor, bool onMark)
        {
            Act("land", 0.8f);
            Release("land", () =>
            {
                Hold(0.09f);
                var tip = Blade ? Blade.Tip : floor + transform.forward * 2f;
                tip.y = floor.y;
                Fx.WarlordImpact(floor, onMark ? 4.6f : 3.4f, Fk);
                // 剑插地处一团熔铜火团（放在身前剑尖上，不盖住落地的身体）
                Fx.Explosion(tip + Vector3.up * 0.4f, 2.2f, WarlordPalette.CopperAt(Fk));
                Fx.MoltenSplash(tip + Vector3.up * 0.2f, 1.2f, WarlordPalette.CopperAt(Fk));
            });
        }

        /// <summary>陨石雨的释放帧（举剑号令）：剑尖冲天光柱 + 天上一团火光</summary>
        public void MeteorCast() => Release("cast", () =>
        {
            Fx.WarlordBeacon(Blade ? Blade.Tip : HeadPoint + Vector3.up * 2f, Fk);
            Shake(0.3f, 0.4f);
        });

        Vector3 HeadPoint => Model?.Head ? Model.Head.position : BodyCenter + Vector3.up;

        /// <summary>熔铜渠：大剑插地那一刻（引渠）——剑尖处熔铜冠 + 方铜渣、贴地粗环、紫褐尘浪；顿帧</summary>
        public void PlantStrike(Vector3 ground) => Release("plant", () =>
        {
            Hold(0.08f);
            var tip = Blade ? Blade.Tip : ground + transform.forward * 1.2f;
            tip.y = ground.y;
            Fx.WarlordImpact(tip, 2.4f, Fk);
            Fx.Explosion(tip + Vector3.up * 0.35f, 1.5f, WarlordPalette.CopperAt(Fk));
        });

        /// <summary>动画事件：拖影起止、起手烧亮、冲锋踏步、咆哮换挡、倒下的跪地 / 扑倒；hit 用来量释放帧和判定差多少</summary>
        protected override void OnAnimEvent(string evt)
        {
            switch (evt)
            {
                case "smear":
                    Blade?.Smear(0.3f);
                    break;
                case "smearEnd":
                    Blade?.EndSmear();
                    break;
                case "hit":
                case "impact":
                case "cast":
                    if (pendingFx != null) FlushRelease(false);
                    else hitSeenAt = Time.time;
                    break;
                case "step":
                    if (Current is WarlordCharge)
                    {
                        Fx.Burst(transform.position + Vector3.up * 0.15f, WarlordPalette.Smoke, 2, 1.2f, 0.6f, 0.5f, -0.6f);
                        Shake(0.12f, 0.12f);
                    }
                    break;
                case "brake":
                    Fx.WarlordSmoke(transform.position + transform.forward * 1.2f + Vector3.up * 0.3f, 1f, 3);
                    break;
                case "gather":
                    Fx.Burst(BodyCenter, WarlordPalette.CopperAt(Fk), 14, 6f, 0.5f, 0.1f, -2f);
                    break;
                case "roar":
                    if (Transitioning && Phase >= 2) ShiftFury();
                    break;
                case "kneel":
                    if (Dead) DefeatKneel();
                    break;
                case "collapse":
                    if (Dead) DefeatCollapse();
                    break;
            }
        }

        /// <summary>登场后每帧（招式中、间隙都调）：动作导演、拖刀火星、狂怒的零星陨石</summary>
        protected override void Passive(float dt)
        {
            DirectMoveActs();
            if (Current is WarlordCharge c && c.Running)
            {
                // 拖刀：剑尖犁地，一路往后甩铜火星
                dragAcc += dt;
                if (dragAcc >= 0.045f)
                {
                    dragAcc = 0;
                    var tip = Blade ? Blade.Tip : transform.position - transform.forward * 2f;
                    tip.y = transform.position.y + 0.1f;
                    Fx.Burst(tip, WarlordPalette.CopperAt(Fk), 3, 4.5f, 0.3f, 0.07f, 9f);
                }
            }
            else if (!Blade)
            {
                fxAcc += dt;
                if (fxAcc >= 0.15f)
                {
                    fxAcc = 0;
                    Fx.Burst(BodyCenter + transform.forward * (BodyRadius + 0.4f) + Vector3.up * 0.5f, WarlordDef.Embers, 2, 1.2f, 0.5f, 0.12f, -5f);
                }
            }
            if (Phase < 2 || WDef == null) return;
            ambientAcc += dt;
            if (ambientAcc < WDef.ambientMeteorEvery) return;
            ambientAcc = 0;
            DropAmbientMeteor();
        }

        /// <summary>零星陨石：玩家周围 1.5–6 m（夹进场地），从 30 m 高处斜着直线坠落 1.25 s，落点预警、落地留 3.5 s 的火（TS dropMeteor(false, 1.5, 6)）</summary>
        public void DropAmbientMeteor()
        {
            var d = WDef;
            var hz = BossHazards.For(this);
            if (d == null || !hz) return;
            var rng = RunState.Current != null ? RunState.Current.Stream("boss_warlord") : null;
            float Rand(float a, float b) => rng != null ? rng.Range(a, b) : UnityEngine.Random.Range(a, b);
            float ang = Rand(0, Mathf.PI * 2), r = Rand(d.ambientMeteorRange.x, d.ambientMeteorRange.y);
            var to = ClampToArena(PlayerPosition + new Vector3(Mathf.Sin(ang) * r, 0, Mathf.Cos(ang) * r), 2f);
            float floor = Arena ? Arena.FloorY : to.y;
            to.y = Physics.Raycast(new Vector3(to.x, floor + 30f, to.z), Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : floor;
            var from = to + new Vector3(Rand(-7f, 7f), 30f, Rand(-7f, 7f));
            float k = 1f / Mathf.Max(1f, d.damage);
            float fireDmg = MoveDamage(4f * k);
            hz.Lob(new BossLobSpec(from, to, 1.25f, 0f, 3f, MoveDamage(22f * k), WarlordDef.Fire, LobKind.Meteor)
            {
                element = Element.Fire,
                look = LobLook.MoltenRock,
                onLand = p => hz.Zone(new BossZoneSpec(p, 2.2f, 3.5f, fireDmg, WarlordDef.Fire) { arm = 0.1f, embers = true }),
            });
            AmbientMeteors++;
        }

        // ───────────── 框架钩子 ─────────────

        /// <summary>登场：前 40% 从高处砸下来（模型根节点下落，身后拖火），落地爆炸 + 火环 + 震屏，70% 时咆哮</summary>
        protected override void IntroTick(float t, float dt)
        {
            var d = WDef;
            if (d == null) return;
            float fall = Mathf.Clamp01(t / Mathf.Max(0.05f, d.dropFraction));
            if (!Landed)
            {
                SetDrop(d.dropHeight * (1 - fall * fall));
                if (!dropTrail.Alive && dropFlames.Count == 0) BeginDropFx();
                // 下坠时往后甩的火星（火尾体积和火舌是主体，这里只是碎屑）
                fxAcc += dt;
                if (fxAcc >= 0.05f)
                {
                    fxAcc = 0;
                    Fx.Burst(transform.position + Vector3.up * (DropNow + 1.5f), WarlordDef.Embers, 3, 2.5f, 0.6f, 0.14f, -3f);
                }
                if (fall >= 1f) Land();
            }
            if (t >= d.roarAt && !roared)
            {
                roared = true;
                Act("roar", 1.2f);
                PlaySfx("boss_roar");
                Shake(0.45f, 0.8f);
                RoarFx();
            }
        }

        /// <summary>
        /// 下坠的火（魔将没有下坠动作片段，靠特效遮）：一条从身上拖到天上的火尾（锥尾体积，长度随速度、最长 14 m）、
        /// 头肩和身后三片大火舌（火苗永远往上窜 = 往下坠时正好拖在身后）、往外甩的熔铜滴
        /// </summary>
        void BeginDropFx()
        {
            var root = Model?.root ? Model.root.transform : transform;
            float s = Mathf.Max(0.01f, Model?.scale ?? 1f);
            dropTrail = Surge.Trail(root, Vector3.up * 2.2f, 1.7f, 14f, SurgeKind.Fire, 3f);
            var spots = new[] { new Vector3(0, 3.4f, -0.2f), new Vector3(-0.9f, 2.7f, -0.4f), new Vector3(0.9f, 2.7f, -0.4f) };
            var sizes = new[] { new Vector3(3.2f, 5.5f, 3.2f), new Vector3(2.2f, 3.8f, 2.2f), new Vector3(2.2f, 3.8f, 2.2f) };
            for (int i = 0; i < spots.Length; i++)
            {
                var ft = FlameTongue.Attach(root, spots[i] / s, sizes[i]);
                if (ft) dropFlames.Add(ft);
            }
            Fx.BodyStream(root.gameObject, StreamKind.Molten, 1.4f, 70f);
            // 下坠姿势（关键帧 fall：抱身、双手握剑剑尖朝下——自己就是一颗陨火）
            Act("fall", 1f);
        }

        void EndDropFx()
        {
            dropTrail.Cancel();
            foreach (var f in dropFlames)
                if (f)
                    Destroy(f.gameObject);
            dropFlames.Clear();
        }

        /// <summary>咆哮（没有咆哮动作片段，靠特效撑）：肩头两道火柱窜起、胸口一圈热浪、脚下一圈残火</summary>
        void RoarFx()
        {
            var c = BodyCenter;
            var right = transform.right;
            Fx.FlamePillar(c + Vector3.up * 1.1f + right * 0.9f, 0.35f, 2.6f);
            Fx.FlamePillar(c + Vector3.up * 1.1f - right * 0.9f, 0.35f, 2.6f);
            Fx.Ring(transform.position + Vector3.up * 0.15f, 7f, WarlordDef.Fire, 0.6f);
            FlameTongues.Ground(transform.position, BodyRadius + 1.4f, 8, 2.4f, 0.9f);
        }

        void Land()
        {
            Landed = true;
            SetDrop(0);
            var floor = transform.position;
            Act("land", 0.8f);
            Hold(0.1f);
            EndDropFx();
            // 看得清的砸地（不再是一团盖住全身的通用爆炸光）：贴地尘浪 + 碎石 + 裂痕、熔铜冠 + 四溅的熔铜、一大滩熔铜贴花、一圈残火，
            // 闪光压低贴地，落地的身体始终在画面里
            Fx.Slam(floor, 6f, Hex.Rgb(0x4a3a30));
            Fx.MoltenBurst(floor + Vector3.up * 0.4f, 3.2f, false);
            Fx.MoltenSplat(floor, 6.5f, 1f, 8f);
            for (int i = 0; i < 6; i++)
            {
                float a = i / 6f * Mathf.PI * 2 + UnityEngine.Random.Range(-0.3f, 0.3f), r = UnityEngine.Random.Range(2.6f, 5f);
                Fx.MoltenSplash(floor + new Vector3(Mathf.Sin(a) * r, 0.2f, Mathf.Cos(a) * r), 1.3f);
            }
            FlameTongues.Ground(floor, 3.8f, 9, 2.4f, 0.6f);
            Fx.Flash(floor + Vector3.up * 0.4f, WarlordDef.Fire, 7f, 16f, 0.3f);
            Fx.Burst(floor + Vector3.up * 0.3f, WarlordDef.Embers, 30, 10f, 1.2f, 0.2f, 12f);
            Shake(1f, 0.8f);
            PlaySfx("boss_slam");
            PlaySfx("explosion", 1f, 0.6f);
        }

        protected override void OnIntroEnd()
        {
            if (!Landed) Land();
            SetDrop(0);
            GameUI.Toast("熔火深渊的统帅——角盔是弱点", Hex.Rgb(0xff7a2a));
        }

        protected override void OnPhase(int phase)
        {
            ClearActTriggers();
            Blade?.EndSmear();
            Fx.Burst(BodyCenter, WarlordPalette.CopperAt(Fk), 40, 10f, 1f, 0.3f, -2f);
            Fx.Ring(transform.position + Vector3.up * 0.1f, 12f, WarlordPalette.DeepAt(Fk), 0.9f);
            if (phase >= 2) Fury2();
        }

        /// <summary>
        /// 狂怒换挡的那一下（转阶段咆哮炸开的那一帧：roar 片段的 roar 事件，时间兜底 0.75 s）：白热冲击环 + 紫褐烟环 + 全身喷铜火星、顿帧、重震；
        /// 之后 <see cref="FuryLook"/> 升满（铠甲 / 边光 / 剑身转白热铜，两肩火舌、背后紫褐烟）
        /// </summary>
        void ShiftFury()
        {
            if (furyShifted) return;
            furyShifted = true;
            Fx.WarlordFuryShift(transform.position, BodyCenter + Vector3.up * 0.6f);
            Hold(0.1f);
            Shake(0.8f, 0.6f);
            GameUI.ScreenFlash(new Color(1f, 0.6f, 0.25f, 0.28f), 0.3f);
            PlaySfx("explosion", 0.8f, 0.7f);
        }

        protected override void TransitionTick(float t, float dt)
        {
            if (Phase >= 2 && t >= 0.75f) ShiftFury();
            if (t < 0.15f || t > 1.8f) return;
            fxAcc += dt;
            if (fxAcc < 0.18f) return;
            fxAcc = 0;
            Shake(0.2f, 0.2f);
            float a = UnityEngine.Random.value * Mathf.PI * 2;
            Fx.Burst(transform.position + new Vector3(Mathf.Sin(a) * 1.5f, 0.5f + UnityEngine.Random.value * 2.5f, Mathf.Cos(a) * 1.5f), WarlordPalette.CopperAt(Fk), 6, 5f, 0.6f, 0.2f, -6f);
        }

        protected override void OnEnrage(string reason) => Fury2();

        /// <summary>狂怒：陨石雨冷却缩短（零星陨石由 Passive 在三阶段起落）</summary>
        void Fury2()
        {
            var meteor = MoveById("warlord_meteor");
            if (meteor != null && WDef != null) meteor.cooldown = Mathf.Min(meteor.cooldown, WDef.furyMeteorCooldown);
        }

        protected override void OnStaggered(float seconds) => ClearActTriggers();

        protected override void OnDefeated(DamageInfo info)
        {
            ClearActTriggers();
            holdUntil = -1f;
            if (anim) anim.speed = 1f;
            Blade?.EndSmear();
            SetDrop(0);
            Glow(0, 0);
            if (Channels) Channels.Recede();
            PlayAct("death", Def != null ? Def.defeat.seconds : 3f);
            DefeatFx();
        }

        /// <summary>
        /// 倒下的特效（魔将的倒下片段 death 是手 K 的：中招后仰 → 踉跄拄剑 → 单膝跪地低头 → 剑滑、向前扑倒）：
        /// 甲缝里的熔铜往外淌、身上冒火舌；跪地那一帧（kneel 事件，时间兜底 45%）膝下、剑下各一蓬熔铜；
        /// 扑倒那一帧（collapse 事件，兜底 88%）整个人化成一滩熔铜（熔铜冠 + 一大滩熔铜贴花 + 一圈残火 + 紫褐烟）
        /// </summary>
        void DefeatFx()
        {
            EndDropFx();
            var root = Model?.root ? Model.root.transform : transform;
            float secs = Def != null ? Def.defeat.seconds : 3.2f;
            Fx.BodyStream(root.gameObject, StreamKind.Molten, secs, 130f);
            var s = Mathf.Max(0.01f, Model?.scale ?? 1f);
            defeatFlames[0] = FlameTongue.Attach(root, new Vector3(0, 2.8f, 0) / s, new Vector3(2.2f, 3.4f, 2.2f));
            defeatFlames[1] = FlameTongue.Attach(root, new Vector3(0.7f, 1.6f, 0.2f) / s, new Vector3(1.4f, 2.2f, 1.4f));
            Fx.MoltenBurst(BodyCenter, 1.8f, false, WarlordPalette.CopperAt(Fk));
            BossDefeatFx.On(gameObject)
                .At(secs * 0.45f, DefeatKneel)
                .At(secs * 0.62f, () => Fx.MoltenBurst(BodyCenter, 1.6f, false))
                .At(secs * 0.88f, DefeatCollapse);
        }

        readonly FlameTongue[] defeatFlames = new FlameTongue[2];

        void DefeatKneel()
        {
            if (defeatKneel) return;
            defeatKneel = true;
            var feet = transform.position;
            Fx.MoltenBurst(feet + transform.forward * 0.6f + Vector3.up * 0.3f, 1.6f, false);
            if (Blade) Fx.MoltenSplash(new Vector3(Blade.Tip.x, feet.y + 0.2f, Blade.Tip.z), 1.2f, WarlordPalette.Copper);
            Fx.WarlordSmoke(feet, 1.2f, 3);
        }

        void DefeatCollapse()
        {
            if (defeatCollapse) return;
            defeatCollapse = true;
            var feet = transform.position + transform.forward * 0.8f;
            Fx.MoltenBurst(feet + Vector3.up * 0.3f, 3.4f, false);
            Fx.MoltenSplat(feet, 6.5f, 1f, 8f);
            FlameTongues.Ground(feet, 3.4f, 9, 3.5f, 0.8f);
            Fx.WarlordSmoke(feet, 2.4f, 5);
            foreach (var f in defeatFlames)
                if (f)
                    Destroy(f.gameObject);
        }
    }
}
