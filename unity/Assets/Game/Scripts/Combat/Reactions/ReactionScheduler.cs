using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>反应计数（调试叠层、冒烟测试读）：累计值 + 单帧峰值。Reset 清零</summary>
    public sealed class ReactionStats
    {
        /// <summary>接受入队的次数（按 <see cref="DetonateOutcome"/>：四种反应 + 崩解）</summary>
        public readonly int[] accepted = new int[(int)DetonateOutcome.Collapse + 1];
        /// <summary>实际执行的次数（同上）</summary>
        public readonly int[] executed = new int[(int)DetonateOutcome.Collapse + 1];
        /// <summary>按来源统计接受次数（<see cref="ReactionOrigin"/>）</summary>
        public readonly int[] byOrigin = new int[3];
        /// <summary>因每帧预算 / 队列上限被拒绝的次数</summary>
        public int dropped;
        /// <summary>并入同一次引爆的次数</summary>
        public int merged;
        /// <summary>单帧接受数的历史最大值（应 ≤ <see cref="CombatTuning.FrameBudget"/>）</summary>
        public int frameMax;
        /// <summary>大特效被预算挡掉、走小号表现的次数</summary>
        public int bigFxDenied;
        /// <summary>单帧大特效数的历史最大值（应 ≤ <see cref="CombatTuning.BigFxBudget"/>）</summary>
        public int bigFxFrameMax;
        /// <summary>浮字被预算 / 节流挡掉的次数</summary>
        public int labelsDenied;
        /// <summary>单帧浮字数的历史最大值（应 ≤ <see cref="CombatTuning.LabelBudget"/>）</summary>
        public int labelFrameMax;
        /// <summary>此刻：待执行队列长度、熔池数</summary>
        public int queue, pools;
        /// <summary>执行时抛异常的次数</summary>
        public int errors;

        public int TotalAccepted
        {
            get
            {
                int n = 0;
                foreach (var v in accepted) n += v;
                return n;
            }
        }

        public void Reset()
        {
            Array.Clear(accepted, 0, accepted.Length);
            Array.Clear(executed, 0, executed.Length);
            Array.Clear(byOrigin, 0, byOrigin.Length);
            dropped = merged = frameMax = bigFxDenied = bigFxFrameMax = labelsDenied = labelFrameMax = queue = pools = errors = 0;
        }
    }

    /// <summary>
    /// 反应的判定与排队（Three.js ReactionSystem 的 tryReact / trigger / detonate / mergeDetonate / flush 前半）：
    /// 只入队、不造成伤害、不碰特效（归墟预警经 <see cref="IReactionEnv.Windup"/>）。时间与帧号由调用方传入，
    /// 所以 EditMode 测试可以手动推进；<see cref="ReactionSystem"/> 传 Time.time / Time.frameCount。
    ///   · 冷却逐敌人、逐反应计时：实际冷却 = 基础冷却 / (1 + 反应急速)，最低 0.3 s；封脉眩晕 3.5 s、引爆 0.5 s 另计
    ///   · 每帧接受 8 次（含引爆、强制），队列 32 条；超出的不反应（计入 dropped）
    ///   · 引爆冷却内同一敌人本帧 / 上一帧入队、还没执行的引爆：并入它（强度取较高者），不占帧预算
    ///   · 待执行条目走对象池（<see cref="ReactionJob"/>），稳态不分配
    /// </summary>
    public sealed class ReactionScheduler
    {
        /// <summary>一个敌人的冷却与「脉滞」记录</summary>
        sealed class TargetRecord
        {
            public readonly float[] ready = { float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity };
            public float detonateReady = float.NegativeInfinity, sealStunReady = float.NegativeInfinity, vulnUntil = float.NegativeInfinity;
            public IDisposable vulnHandle;

            public void Reset()
            {
                for (int i = 0; i < ready.Length; i++) ready[i] = float.NegativeInfinity;
                detonateReady = sealStunReady = vulnUntil = float.NegativeInfinity;
                vulnHandle?.Dispose();
                vulnHandle = null;
            }
        }

        readonly IReactionEnv env;
        readonly ReactionStats stats;
        readonly FrameBudget accept = new(CombatTuning.FrameBudget);
        readonly List<ReactionJob> queue = new();
        readonly Stack<ReactionJob> spare = new();
        readonly Dictionary<Damageable, TargetRecord> records = new();
        readonly Stack<TargetRecord> spareRecords = new();
        readonly List<Damageable> dead = new();

        public ReactionScheduler(IReactionEnv env, ReactionStats stats = null)
        {
            this.env = env ?? GameReactionEnv.Instance;
            this.stats = stats ?? new ReactionStats();
        }

        public IReactionEnv Env => env;
        public ReactionStats Stats => stats;
        /// <summary>待执行的条目（只读；测试 / 调试用）</summary>
        public IReadOnlyList<ReactionJob> Pending => queue;
        /// <summary>每帧接受数的预算（Used / Peak / Denied）</summary>
        public FrameBudget AcceptBudget => accept;

        // ───────────── 判定：元素附着 ─────────────

        /// <summary>
        /// 元素附着前的反应判定（必须在 EnemyStatus.Apply 之前：雷殛第 3 层会自删并眩晕；击杀那一击状态还没清空）。
        /// 成功时记冷却、（归墟）消耗灼烧与雷殛、入队，返回入队的条目；incoming 由调用方照常附着。
        /// scale = 反应威力倍率（附着的 reactionScale，「万象」0.6）。
        /// </summary>
        public ReactionJob TryReact(Damageable enemy, Element incoming, float pin, int depth, bool killed, int weaponUid, float scale, float now, int frame)
        {
            if (depth >= CombatTuning.MaxReactionDepth || incoming == Element.None || !enemy) return null;
            if (!killed && enemy.Dead) return null;
            bool hb = env.Has(enemy, StatusId.Burn), hs = env.Has(enemy, StatusId.Shock), hc = env.Has(enemy, StatusId.Corrode);
            var id = ReactionMath.PlanAttach(incoming, hb, hs, hc, killed, ReadyMask(enemy, now));
            if (id == null || !CanAccept(frame)) return null;
            Arm(enemy, id.Value, now);
            var j = Alloc();
            j.kind = ReactionMath.OutcomeOf(id.Value);
            j.enemy = enemy;
            j.point = ReactionSystem.CenterOf(enemy);
            j.pin = Clean(Mathf.Min(pin, enemy.maxHealth * CombatTuning.PinCapOfMaxHp));
            j.depth = depth;
            j.killed = killed;
            j.weaponUid = weaponUid;
            j.scale = Mathf.Max(0, Finite(scale, 1));
            j.strength = env.Strength(enemy);
            j.origin = ReactionOrigin.Status;
            float delay = depth >= 1 ? CombatTuning.CascadeDelay : 0;
            if (id == Reaction.Abyss)
            {
                // 收束：消耗灼烧（结清剩余伤害）与雷殛，蚀化保留（incoming 本身不算「已有」）
                if (hb && incoming != Element.Fire) j.cash = env.ConsumeBurn(enemy);
                if (hs && incoming != Element.Shock) env.ConsumeShock(enemy);
                delay += CombatTuning.AbyssWindup;
                env.Windup(enemy, j.point, delay);
            }
            j.at = now + delay;
            Push(j, frame);
            return j;
        }

        // ───────────── 判定：强制反应 ─────────────

        /// <summary>
        /// 强制引发一次反应（涅槃、回响、劫火）：不需要、也不消耗元素状态。power 作为 Pin 代入公式（给了 fixedBase 时 B 直接取它，不 clamp）。
        /// 拒绝：深度 ≥ 2；帧预算 / 队列已满；敌人活着、没传 ignoreIcd 且该反应冷却未就绪（活着且没传 ignoreIcd 时会记冷却）。
        /// 敌人可以已死（中心伤害跳过、范围部分照常；没了的敌人必须给 point）。
        /// </summary>
        public ReactionJob Trigger(Damageable enemy, Reaction id, in TriggerOpts opts, float now, int frame)
        {
            if (ReferenceEquals(enemy, null)) return null;
            bool exists = enemy;
            bool live = exists && !enemy.Dead;
            if (!exists && !opts.point.HasValue) return null;
            if (live && enemy.untargetable) return null;
            if (opts.depth >= CombatTuning.MaxReactionDepth) return null;
            bool useIcd = live && !opts.ignoreIcd;
            if (useIcd && !Ready(enemy, id, now)) return null;
            if (!CanAccept(frame)) return null;
            if (useIcd) Arm(enemy, id, now);
            var j = Alloc();
            j.kind = ReactionMath.OutcomeOf(id);
            j.enemy = enemy;
            j.point = opts.point ?? ReactionSystem.CenterOf(enemy);
            j.pin = Clean(opts.power);
            j.depth = opts.depth;
            j.weaponUid = opts.weaponUid;
            j.scale = opts.scale > 0 && !float.IsInfinity(opts.scale) ? opts.scale : 1;
            j.fixedBase = opts.fixedBase.HasValue && !float.IsNaN(opts.fixedBase.Value) && !float.IsInfinity(opts.fixedBase.Value)
                ? Mathf.Max(0, opts.fixedBase.Value)
                : null;
            j.killed = !live;
            j.strength = exists ? env.Strength(enemy) : 1;
            j.origin = ReactionOrigin.Forced;
            j.tag = opts.tag;
            float delay = opts.depth > 0 ? CombatTuning.CascadeDelay : 0;
            if (id == Reaction.Abyss)
            {
                delay += CombatTuning.AbyssWindup;
                env.Windup(exists ? enemy : null, j.point, delay);
            }
            j.at = now + delay;
            Push(j, frame);
            return j;
        }

        // ───────────── 判定：引爆 ─────────────

        /// <summary>
        /// 引爆敌人身上已有的元素状态（贯虹满蓄、点穴、破势）：三种齐聚且归墟就绪 → 归墟（消耗灼烧与雷殛）；≥ 2 种 → 已有状态两两组合中
        /// 按优先级取第一个就绪的（记冷却）；否则 → 崩解（灼烧 &gt; 蚀化 &gt; 雷殛，不消耗状态，伤害入队时按当前剩余量算好）。
        /// 拒绝（null）：敌人不存活 / 不可选中；深度 ≥ 2；身上没有元素状态；帧预算 / 队列已满；引爆冷却（0.5 s）中且没有可并入的条目。
        /// 直接引爆（深度 0）推迟约一帧执行，好让同一击后续的引爆并入。
        /// </summary>
        public ReactionJob Detonate(Damageable enemy, in DetonateOpts opts, float now, int frame)
        {
            if (!enemy || enemy.Dead || enemy.untargetable) return null;
            if (opts.depth >= CombatTuning.MaxReactionDepth) return null;
            var rec = Record(enemy);
            if (now < rec.detonateReady) return MergeDetonate(enemy, opts, frame);
            bool hb = env.Has(enemy, StatusId.Burn), hs = env.Has(enemy, StatusId.Shock), hc = env.Has(enemy, StatusId.Corrode);
            var outcome = ReactionMath.PlanDetonate(hb, hs, hc, ReadyMask(enemy, now));
            if (outcome == null || !CanAccept(frame)) return null;

            float mult = DetonateMult(opts.mult);
            rec.detonateReady = now + CombatTuning.DetonateIcd;
            var j = Alloc();
            j.enemy = enemy;
            j.point = opts.point ?? ReactionSystem.CenterOf(enemy);
            j.depth = opts.depth;
            j.weaponUid = opts.weaponUid;
            j.origin = ReactionOrigin.Detonate;
            j.mult = mult;
            j.strength = env.Strength(enemy);
            j.kind = outcome.Value;
            float delay = opts.depth > 0 ? CombatTuning.CascadeDelay : CombatTuning.DetonateMergeDelay;
            if (outcome.Value != DetonateOutcome.Collapse)
            {
                var id = j.Reaction;
                Arm(enemy, id, now);
                j.pin = DetonatePin(enemy, opts.power, mult);
                if (id == Reaction.Abyss)
                {
                    j.cash = hb ? env.ConsumeBurn(enemy) : 0;
                    if (hs) env.ConsumeShock(enemy);
                    delay += CombatTuning.AbyssWindup;
                    env.Windup(enemy, j.point, delay);
                }
            }
            else
            {
                var sid = ReactionMath.CollapseStatus(hb, hs, hc);
                j.collapse = sid;
                // 存下来的雷殛强度不含属性加成（每一跳才乘），崩解按反应口径乘回
                if (sid == StatusId.Shock) j.pin = Clean(env.ShockPower(enemy) * env.DotStatMultiplier(enemy, Element.Shock));
                j.fixedBase = CollapseRaw(enemy, sid, j.pin, j.strength) * mult;
            }
            j.at = now + delay;
            Push(j, frame);
            return j;
        }

        /// <summary>
        /// 引爆冷却内的又一次引爆：同一敌人有本帧 / 上一帧入队、尚未执行的引爆时并入它（强度取较高者），返回那一条；不占帧预算。
        /// 没有可并入的返回 null。
        /// </summary>
        ReactionJob MergeDetonate(Damageable enemy, in DetonateOpts opts, int frame)
        {
            for (int i = 0; i < queue.Count; i++)
            {
                var j = queue[i];
                if (j.origin != ReactionOrigin.Detonate || j.enemy != enemy || j.frame < frame - 1) continue;
                float mult = DetonateMult(opts.mult);
                if (j.kind == DetonateOutcome.Collapse)
                    j.fixedBase = Mathf.Max(j.fixedBase ?? 0, CollapseRaw(enemy, j.collapse, j.pin, j.strength) * mult);
                else
                {
                    float pin = DetonatePin(enemy, opts.power, mult);
                    if (pin > j.pin) j.pin = pin;
                }
                if (mult > j.mult) j.mult = mult;
                if (j.weaponUid == 0) j.weaponUid = opts.weaponUid;
                stats.merged++;
                return j;
            }
            return null;
        }

        /// <summary>崩解伤害（未乘引爆倍率）：灼烧 / 蚀化 = 0.3 × 剩余持续伤害（含属性倍率），雷殛 = 0.5 × 雷殛强度，上限 30S</summary>
        float CollapseRaw(Damageable enemy, StatusId sid, float shockPin, float strength)
        {
            float dot = 0;
            if (sid != StatusId.Shock)
            {
                float raw = env.DotRemainingRaw(enemy, sid);
                if (raw > 0) dot = raw * env.DotStatMultiplier(enemy, ReactionMath.ElementOf(sid));
            }
            return ReactionMath.CollapseDamage(sid, dot, shockPin, strength);
        }

        static float DetonateMult(float m) => m > 0 && !float.IsInfinity(m) ? m : 1;

        static float DetonatePin(Damageable enemy, float power, float mult) =>
            Mathf.Min(Clean(power), enemy.maxHealth * CombatTuning.PinCapOfMaxHp) * mult;

        // ───────────── 封脉首领「脉滞」 ─────────────

        /// <summary>
        /// 首领被封脉：until 之前受到的伤害 ×1.12。第一次时在它的 <see cref="Damageable.Incoming"/> 上登记一个修饰器（之后只续时间）。
        /// </summary>
        public void MarkVuln(Damageable enemy, float until, Incoming modifier)
        {
            if (!enemy) return;
            var rec = Record(enemy);
            rec.vulnUntil = Mathf.Max(rec.vulnUntil, until);
            if (rec.vulnHandle == null && modifier != null) rec.vulnHandle = enemy.Incoming.Add(modifier);
        }

        /// <summary>「脉滞」倍率：生效中 1.12，否则 1</summary>
        public float VulnMult(Damageable enemy, float now) =>
            !ReferenceEquals(enemy, null) && records.TryGetValue(enemy, out var r) && now < r.vulnUntil ? CombatTuning.Veinseal.BossVuln : 1f;

        /// <summary>封脉眩晕的独立冷却（3.5 s，不吃急速）：就绪则记下冷却并返回 true</summary>
        public bool TryArmSealStun(Damageable enemy, float now)
        {
            if (!enemy) return false;
            var rec = Record(enemy);
            if (now < rec.sealStunReady) return false;
            rec.sealStunReady = now + CombatTuning.Veinseal.StunIcd;
            return true;
        }

        // ───────────── 冷却 ─────────────

        /// <summary>该敌人该反应的冷却是否就绪</summary>
        public bool Ready(Damageable enemy, Reaction id, float now) =>
            ReferenceEquals(enemy, null) || !records.TryGetValue(enemy, out var r) || now >= r.ready[(int)id];

        /// <summary>该敌人的引爆冷却是否就绪</summary>
        public bool DetonateReady(Damageable enemy, float now) =>
            ReferenceEquals(enemy, null) || !records.TryGetValue(enemy, out var r) || now >= r.detonateReady;

        int ReadyMask(Damageable enemy, float now)
        {
            if (!records.TryGetValue(enemy, out var r)) return ReactionMath.AllReady;
            int m = 0;
            for (int i = 0; i < r.ready.Length; i++)
                if (now >= r.ready[i]) m |= 1 << i;
            return m;
        }

        void Arm(Damageable enemy, Reaction id, float now) => Record(enemy).ready[(int)id] = now + ReactionMath.Cooldown(id, env.Haste);

        TargetRecord Record(Damageable enemy)
        {
            if (records.TryGetValue(enemy, out var r)) return r;
            r = spareRecords.Count > 0 ? spareRecords.Pop() : new TargetRecord();
            records[enemy] = r;
            return r;
        }

        // ───────────── 队列 ─────────────

        bool CanAccept(int frame)
        {
            if (queue.Count >= CombatTuning.QueueCap)
            {
                accept.Deny();
                stats.dropped++;
                return false;
            }
            if (!accept.TryTake(frame))
            {
                stats.dropped++;
                return false;
            }
            if (accept.Used > stats.frameMax) stats.frameMax = accept.Used;
            return true;
        }

        void Push(ReactionJob j, int frame)
        {
            j.frame = frame;
            queue.Add(j);
            stats.accepted[(int)j.kind]++;
            stats.byOrigin[(int)j.origin]++;
            stats.queue = queue.Count;
        }

        ReactionJob Alloc()
        {
            var j = spare.Count > 0 ? spare.Pop() : new ReactionJob();
            j.Reset();
            return j;
        }

        /// <summary>取出到时（at ≤ now）的条目，按入队顺序追加到 batch；其余留在队列。执行完用 <see cref="Release"/> 归还</summary>
        public void TakeDue(float now, List<ReactionJob> batch)
        {
            int w = 0;
            for (int i = 0; i < queue.Count; i++)
            {
                var j = queue[i];
                if (j.at <= now) batch.Add(j);
                else queue[w++] = j;
            }
            queue.RemoveRange(w, queue.Count - w);
            stats.queue = queue.Count;
        }

        public void Release(ReactionJob j)
        {
            if (j == null) return;
            j.Reset();
            spare.Push(j);
        }

        /// <summary>去掉已销毁敌人的冷却记录（定期调用）</summary>
        public void Prune()
        {
            dead.Clear();
            foreach (var k in records.Keys)
                if (!k) dead.Add(k);
            for (int i = 0; i < dead.Count; i++)
            {
                var r = records[dead[i]];
                records.Remove(dead[i]);
                r.Reset();
                spareRecords.Push(r);
            }
            dead.Clear();
        }

        /// <summary>清空队列、冷却、脉滞（撤掉修饰器）与帧计数</summary>
        public void Clear()
        {
            foreach (var j in queue) Release(j);
            queue.Clear();
            foreach (var r in records.Values) r.Reset();
            records.Clear();
            accept.Reset();
            stats.queue = 0;
        }

        static float Clean(float v) => float.IsNaN(v) || float.IsInfinity(v) ? 0 : Mathf.Max(0, v);

        static float Finite(float v, float fallback) => float.IsNaN(v) || float.IsInfinity(v) ? fallback : v;
    }
}
