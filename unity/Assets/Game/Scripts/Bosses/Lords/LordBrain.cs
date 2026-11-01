using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 4-1 三领主的行为底座（chuanzang-combat-v1.md 第 4 节「领主通用」，网页版 src/world/plateau/play/boss.ts）：
    ///   · 领主梯度：BossBrain 生成时已按 <see cref="LordScaling"/> 乘过血量、招式间喘息；收招段由 <see cref="LordMove"/> 乘 <see cref="RecoverScale"/>
    ///     （梯度 × 阶段节奏）；第三个打的领主 <see cref="Variant"/> = 每阶段多一招变体（各领主自己接）。
    ///   · 转阶段只出横幅（BossDef.phaseCinematic = false，BossBrain 把阶段名当横幅出），转阶段时撤掉场上的落雷和危险物；
    ///   · 破防条（F 路 BreakBar）：满了 BossBrain 硬直，这里转给 <see cref="OnLordBreak"/>（放开弱点、场地反应）；
    ///   · 倒下：拿掉通用溃散的连环爆炸，放领主自己的死亡演出（<see cref="LordCinema"/> 接管镜头、零误差落回），
    ///     演出每帧回调 <see cref="DeathTick"/>（行为组件倒下后已停用，演出由镜头导演驱动）；
    ///   · 动作：<see cref="ImpactHold"/> 只顿首领自己（Animator ×0.05 停一下再追回），配合释放帧。
    /// </summary>
    public abstract class LordBrain : BossBrain
    {
        public LordDef LDef => Def as LordDef;

        /// <summary>阶段节奏：二阶段 × 0.9、三阶段 × 0.75（网页版 tempo）</summary>
        public float PhaseTempo => LDef == null ? 1f : Phase >= 2 ? LDef.tempo3 : Phase == 1 ? LDef.tempo2 : 1f;
        /// <summary>收招段的倍率 = 领主梯度 × 阶段节奏</summary>
        public float RecoverScale => Lord.RecoveryMult * PhaseTempo;
        /// <summary>第三个打的领主：每阶段多一招变体</summary>
        public bool Variant => Lord.ExtraVariant;
        /// <summary>网页数值 → Unity 的耐久比例（破防条、机关对领主的伤害）</summary>
        public float WebScale => LDef != null ? LDef.WebScale : 1f;

        /// <summary>死亡演出（倒下后才有）</summary>
        public LordCinema DeathCinema { get; private set; }
        /// <summary>破防过几次、最近一次破防的时刻</summary>
        public int Breaks { get; private set; }

        readonly Dictionary<string, float> tellAt = new();

        // ───────────── 生命周期 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            tellAt.Clear();
            Breaks = 0;
            Guard(OnLordSpawn);
        }

        /// <summary>生成之后（登场开始前）：场地件、天气、常驻状态</summary>
        protected virtual void OnLordSpawn() { }

        protected override void OnPhase(int phase)
        {
            // 转阶段时清掉场上的预警和投射物（网页版 clearHostile）
            LightningStrike.ClearAll();
            var hz = GetComponent<BossHazards>();
            if (hz) hz.ClearAll();
            Guard(() => OnLordPhase(phase));
        }

        /// <summary>进入新阶段（阶段横幅已出、招式已打断）</summary>
        protected virtual void OnLordPhase(int phase) { }

        protected sealed override void OnBreak(int count)
        {
            Breaks = count;
            Guard(() => OnLordBreak(count));
        }

        /// <summary>破防：放开弱点、场地反应（珠碎风停、噎住打断涨水）</summary>
        protected virtual void OnLordBreak(int count) { }

        protected sealed override void OnDefeated(DamageInfo info)
        {
            // 通用溃散的连环爆炸 / 隐去模型不要：领主有自己的死亡演出
            var seq = GetComponent<BossDefeatSequence>();
            if (seq) Destroy(seq);
            var hz = GetComponent<BossHazards>();
            if (hz) hz.ClearAll();
            LightningStrike.ClearAll();
            if (Model?.animator && LDef != null) PlayAct(LDef.deathAnim, 0, 0.15f);
            Guard(() => OnLordDefeated(info));
            if (LDef != null) DeathCinema = LordCinema.Play(this, LDef.death);
        }

        /// <summary>倒下的那一刻（死亡演出开始之前）：撤掉常驻状态、天气退场</summary>
        protected virtual void OnLordDefeated(DamageInfo info) { }

        /// <summary>死亡演出每帧（t = 演出已进行的秒数，游戏时间）：倒回残鼓、珠子散成风、沉下去</summary>
        public virtual void DeathTick(float t, float dt) { }

        // ───────────── 工具 ─────────────

        /// <summary>提示（同一个 key 在 cooldown 秒内只说一次）</summary>
        public void Tell(string key, string text, Color color, float cooldown = 10f, float seconds = 2.6f)
        {
            if (string.IsNullOrEmpty(text)) return;
            if (tellAt.TryGetValue(key, out float at) && Time.time < at) return;
            tellAt[key] = Time.time + cooldown;
            GameUI.Toast(text, color, seconds);
        }

        /// <summary>脚下的地面高度（向下打世界几何；打不到就用自己的高度）</summary>
        public float GroundAt(Vector3 p) => Physics.Raycast(p + Vector3.up * 6f, Vector3.down, out var hit, 40f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;

        /// <summary>骨骼的世界位置（包含匹配；找不到用身体中心）</summary>
        public Vector3 BonePos(string bone)
        {
            var t = Model?.FindBone(bone);
            return t ? t.position : BodyCenter;
        }

        /// <summary>骨骼（包含匹配；找不到为 null）</summary>
        public Transform Bone(string bone) => Model?.FindBone(bone);

        float holdUntil = -1, holdRecover;

        /// <summary>
        /// 顿帧：只顿首领自己（Animator ×0.05 停 seconds 秒，再 ×1.6 把停掉的 0.95 × seconds 追回来）；全局时间不动。
        /// 追回的时长 = 0.95 × seconds ÷ 0.6：片段的总时长不变，后面的出手事件（捶胸第二、三下）照样落在玩法的时刻上
        /// </summary>
        public void ImpactHold(float seconds)
        {
            if (!Model?.animator || !(seconds > 0)) return;
            // 等这一帧的 Animator 更新完（LateUpdate）再顿：释放帧由玩法在 Update 里先到，这一帧就压慢会把片段的出手事件拖后几帧
            pendingHold = Mathf.Max(pendingHold, seconds);
        }

        float pendingHold;

        void LateUpdate()
        {
            if (!(pendingHold > 0)) return;
            var a = Model?.animator;
            float seconds = pendingHold;
            pendingHold = 0;
            if (!a) return;
            a.speed = 0.05f;
            holdUntil = Time.time + seconds;
            holdRecover = seconds * 0.95f / 0.6f;
        }

        protected override void Update()
        {
            base.Update();
            if (holdUntil < 0) return;
            var a = Model?.animator;
            if (!a)
            {
                holdUntil = -1;
                return;
            }
            if (Time.time >= holdUntil + holdRecover)
            {
                a.speed = 1f;
                holdUntil = -1;
            }
            else if (Time.time >= holdUntil) a.speed = 1.6f;
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

        /// <summary>跟着这只领主走的场地物体（风涡柱、涨水面…）：领主物体被销毁时一起销毁（正常倒下由各自的死亡演出收掉）</summary>
        public void Own(GameObject go)
        {
            if (!go) return;
            var l = GetComponent<LordOwned>();
            if (!l) l = gameObject.AddComponent<LordOwned>();
            l.items.Add(go);
        }

        /// <summary>给玩家一下冲量（击退 / 掀飞）</summary>
        public static void PushPlayer(Vector3 impulse)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var m = pv.GetComponent<PlayerMotor>();
            if (m) m.AddImpulse(impulse);
        }

        /// <summary>
        /// 持续吹着玩家走（狂风猛推、湖水漩涡）：扫掠的 CharacterController.Move（同 F 路风场，不进速度、不被地面摩擦抵消）；冲刺中不吹
        /// </summary>
        public static void BlowPlayer(Vector3 velocity, float dt)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !(dt > 0)) return;
            var m = pv.GetComponent<PlayerMotor>();
            if (!m || m.Dashing) return;
            var cc = m.GetComponent<CharacterController>();
            var d = velocity * dt;
            d.y = 0;
            if (cc && cc.enabled && d.sqrMagnitude > 1e-10f) cc.Move(d);
        }

        /// <summary>玩家的脚底点（没有玩家时 false）</summary>
        public static bool PlayerFeet(out Vector3 feet) => BossHazards.PlayerBody(out feet, out _, out _);

        /// <summary>玩家正站在地上（没在跳 / 冲刺）</summary>
        public static bool PlayerGrounded
        {
            get
            {
                var pv = PlayerVitals.Instance;
                var m = pv ? pv.GetComponent<PlayerMotor>() : null;
                return m && m.Grounded;
            }
        }

        /// <summary>玩家正在冲刺（无敌帧）</summary>
        public static bool PlayerDashing
        {
            get
            {
                var pv = PlayerVitals.Instance;
                var m = pv ? pv.GetComponent<PlayerMotor>() : null;
                return m && (m.Dashing || m.Invulnerable);
            }
        }
    }

    /// <summary>领主物体被销毁时一起销毁的场地物体（<see cref="LordBrain.Own"/>）</summary>
    public sealed class LordOwned : MonoBehaviour
    {
        internal readonly List<GameObject> items = new();

        void OnDestroy()
        {
            foreach (var g in items)
                if (g)
                    Destroy(g);
            items.Clear();
        }
    }
}
