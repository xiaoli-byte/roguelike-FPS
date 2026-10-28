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
    /// 受击 / 倒下片段等 ART8；硬直时播 Hit 缺片段只警告一次。
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
        bool prevWall, roared, rigged;
        float ambientAcc, fxAcc;
        // 登场下坠的火尾（锥尾体积 + 挂在身上的火舌 + 甩出去的熔铜）：落地时收掉
        FxHandle dropTrail;
        readonly System.Collections.Generic.List<FlameTongue> dropFlames = new();
        Renderer[] lookRenderers;
        MaterialPropertyBlock lookBlock;
        /// <summary>前摇亮度（0..1，进前摇快升、出前摇慢落；测试 / 调试读）</summary>
        public float WindupGlow { get; private set; }

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
            SetDrop(WDef?.dropHeight ?? 0f);
            rigged = true;
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
            prevWall = DashHitWall;
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
                    Act("slashA", WarlordRef.ComboPer);
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

        /// <summary>出手段里的分段动作：冲锋撞墙 crash、横扫反手、连斩交替</summary>
        void DirectMoveActs()
        {
            var m = Current;
            if (m == null || m.Stage != MoveStage.Active) return;
            switch (m)
            {
                case WarlordCharge:
                {
                    // 撞墙的那一帧（撞墙标记的上升沿；下一次冲锋起跑时标记会清掉）
                    bool wall = DashHitWall;
                    if (wall && !prevWall && m.StageT > 0.12f) Act("crash", 1f);
                    prevWall = wall;
                    break;
                }
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
                        Act(k % 2 == 0 ? "slashA" : "slashB", WarlordRef.ComboPer);
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
            // 铠甲炽热度：跟阶段走（倒下后熄灭）
            float target = Dead ? 0 : Phase + (Enraged ? 0.4f : 0);
            if (Mathf.Abs(Fury - target) > 0.002f)
            {
                Fury = Mathf.MoveTowards(Fury, target, Time.deltaTime * 0.8f);
                if (Fury > 0.01f) body.SetOverlay("warlordFury", Color.Lerp(WarlordDef.Fire, WarlordDef.Rage, Mathf.Clamp01(Fury - 1f)), Mathf.Clamp01(Fury * 0.09f));
                else body.ClearOverlay("warlordFury");
            }
            UpdateLook(Time.deltaTime);
        }

        /// <summary>
        /// 读招轮廓：边光 / 自发光写进模型渲染器的属性块（先 Get 再 Set，和 EnemyBody 的闪白 / 着色共存）。
        /// 前摇中：WindupGlow 0.25 s 升满，边光从暖金转白热、强度 1.05 → 1.9，余烬自发光按 18 rad/s 跳动烧亮；倒下后退回材质原值
        /// </summary>
        void UpdateLook(float dt)
        {
            if (Model?.root == null) return;
            if (lookRenderers == null)
            {
                var list = new List<Renderer>();
                foreach (var r in Model.root.GetComponentsInChildren<Renderer>(true))
                    if (r is SkinnedMeshRenderer or MeshRenderer) list.Add(r);
                lookRenderers = list.ToArray();
            }
            bool windup = !Dead && Current != null && Current.Stage == MoveStage.Windup;
            WindupGlow = Mathf.MoveTowards(WindupGlow, windup ? 1f : 0f, dt * (windup ? 4f : 2.5f));
            float pulse = WindupGlow * (0.75f + 0.25f * Mathf.Sin(Time.time * 18f));
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
                    lookBlock.SetColor(RimColorId, Color.Lerp(RimRest, RimHot, pulse));
                    lookBlock.SetFloat(RimStrengthId, Mathf.Lerp(RimRestStrength, RimHotStrength, pulse));
                    lookBlock.SetColor(EmissionId, Ember * (1f + 2.5f * pulse));
                }
                r.SetPropertyBlock(lookBlock);
            }
        }

        /// <summary>登场后每帧（招式中、间隙都调）：动作导演、焰刃火星、狂怒的零星陨石</summary>
        protected override void Passive(float dt)
        {
            DirectMoveActs();
            fxAcc += dt;
            if (fxAcc >= 0.15f)
            {
                fxAcc = 0;
                Fx.Burst(BodyCenter + transform.forward * (BodyRadius + 0.4f) + Vector3.up * 0.5f, WarlordDef.Embers, 2, 1.2f, 0.5f, 0.12f, -5f);
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
            Act("land", 0.7f);
            EndDropFx();
            // 看得清的砸地（不再是一团盖住全身的通用爆炸光）：贴地尘浪 + 碎石 + 裂痕、熔铜冠 + 四溅的熔铜、一大滩熔铜贴花、一圈残火，
            // 闪光压低贴地，落地的身体始终在画面里
            Fx.Slam(floor, 6f, Hex.Rgb(0x4a3a30));
            Fx.MoltenBurst(floor + Vector3.up * 0.4f, 3.2f, false);
            Fx.MoltenSplat(floor, 6.5f, 1f, 14f);
            for (int i = 0; i < 6; i++)
            {
                float a = i / 6f * Mathf.PI * 2 + UnityEngine.Random.Range(-0.3f, 0.3f), r = UnityEngine.Random.Range(2.6f, 5f);
                Fx.MoltenSplash(floor + new Vector3(Mathf.Sin(a) * r, 0.2f, Mathf.Cos(a) * r), 1.3f);
            }
            FlameTongues.Ground(floor, 3.8f, 9, 2.4f, 0.6f);
            Fx.Flash(floor + Vector3.up * 0.4f, WarlordDef.Fire, 7f, 16f, 0.3f);
            Fx.Ring(floor + Vector3.up * 0.1f, 14f, WarlordDef.Fire, 0.9f);
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
            Fx.Burst(BodyCenter, WarlordDef.Fire, 40, 10f, 1f, 0.3f, -2f);
            Fx.Ring(transform.position + Vector3.up * 0.1f, 12f, WarlordDef.Fire, 0.9f);
            if (phase >= 2) Fury2();
        }

        protected override void TransitionTick(float t, float dt)
        {
            if (t < 0.15f || t > 1.8f) return;
            fxAcc += dt;
            if (fxAcc < 0.18f) return;
            fxAcc = 0;
            Shake(0.2f, 0.2f);
            float a = UnityEngine.Random.value * Mathf.PI * 2;
            Fx.Burst(transform.position + new Vector3(Mathf.Sin(a) * 1.5f, 0.5f + UnityEngine.Random.value * 2.5f, Mathf.Cos(a) * 1.5f), WarlordDef.Fire, 6, 5f, 0.6f, 0.2f, -6f);
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
            SetDrop(0);
            Glow(0, 0);
            if (Channels) Channels.Recede();
            PlayAct("death", Def != null ? Def.defeat.seconds : 3f);
        }
    }
}
