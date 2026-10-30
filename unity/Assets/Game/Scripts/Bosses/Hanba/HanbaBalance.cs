using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃击杀用时模拟（docs/unity-parity.md 7.4「每个首领：用模拟秒伤算击杀用时，落在 60–120 s」，BS2 定档 4.4k + 2.2k）。纯计算，不碰场景：
    /// EditMode 测试（HanbaBalanceTests）和冒烟套件（boss-hanba）都调它。
    /// 模型：按 <see cref="HanbaDef"/> 的真实数据逐 0.02 s 推进一场战斗——
    ///   · 首领：定档耐久（护盾层先吃、再生命层，元素层倍率照 <see cref="DamageTable"/>）；阶段阈值只看生命层，越线后等当前招式收尾（≤ phaseWait）再进转换演出（不可选中）；
    ///     招式按定义的冷却、首次延迟、可用阶段、权重（刚出过的那招 × repeatWeight）用固定种子抽，时间轴取各招的 <see cref="HanbaMove.Plan"/>（吃阶段节奏），
    ///     招式之间喘 recovery × 阶段 restScale；转阶段后先出定义里的第一招。
    ///   · 弱点：收招段 + weakGrace、硬直、日蚀窗口里泉珠露出；露出时 <see cref="Profile.weakShare"/>（日蚀窗口里 <see cref="Profile.eclipseShare"/>）的伤害打在泉珠上：
    ///     必暴 ×2，日蚀窗口里再 × <see cref="HanbaDef.eclipseWeakMult"/>；其余打身体，随机暴击 ×2。
    ///   · 召沙魇：出手后 <see cref="Profile.addsSeconds"/> 秒里有 <see cref="Profile.addsShare"/> 的火力分去打沙魇。
    ///   · 飞天之殇：出手后 <see cref="Profile.pipaSeconds"/> 秒里火力全在琵琶上（旱魃护体 ×0.2，按 0 算）；琵琶碎后踉跄 wardBreakStagger 秒、承伤 × wardBreakTaken、泉珠露出。
    ///   · 玩家：身体秒伤 <see cref="Profile.bodyDps"/>（不含暴击，含技能 / 灼烧 / 被动 / 增伤秘卷 <see cref="KitAt14"/>）× 输出占比 <see cref="Profile.aim"/>（躲招、找影子、转火的时间扣掉）。
    /// 结果是登场结束到倒下的秒数（同 <see cref="BossBrain.FightTime"/>）。
    /// 三档打法（1-4 的预期装备：精良 + 一次强化 ≈ ×1.3，D11 的 Three.js 身体秒伤带 60–90，再 × <see cref="KitAt14"/>）：
    ///   下沿 = 秒伤带下沿、打得一般；中位 = 带中间、打得正常；上沿 = 带上沿、打得好。三档都要落在 60–120 s。
    /// </summary>
    public static class HanbaBalance
    {
        /// <summary>目标击杀用时（秒）</summary>
        public const float TargetMin = 60f, TargetMax = 120f;
        /// <summary>D11 的身体秒伤带（Three.js，不含暴击）与 1-4 的预期装备倍率（精良 ×1.15 × 一次强化 ×1.12）</summary>
        public const float BodyDpsLow = 60f, BodyDpsHigh = 90f, GearAt14 = 1.3f;
        /// <summary>
        /// 武器之外的输出（I3 首领浸泡校准，docs/balance.md 第 3 节）：增伤秘卷（利刃 ×2 ≈ ×1.12）× 技能 / 灼烧跳伤 / 余烬（浸泡里武器只占 66–73% ≈ ×1.5）≈ 1.68。
        /// 上沿打法（90 × 1.3 × 1.68 ≈ 197 身体秒伤 + 随机暴击）≈ 浸泡实测的可选中时约 220（<see cref="BossBalance.Soak"/>）
        /// </summary>
        public const float KitAt14 = 1.68f;
        /// <summary>弱点必暴、随机暴击的暴伤倍率</summary>
        public const float CritMult = 2f;

        /// <summary>一种打法</summary>
        public struct Profile
        {
            public string name;
            /// <summary>身体秒伤（不含暴击，已乘装备倍率）</summary>
            public float bodyDps;
            /// <summary>输出占比：真正在打首领的时间比例</summary>
            public float aim;
            /// <summary>随机暴击率</summary>
            public float crit;
            /// <summary>泉珠露出时（后摇 / 硬直）打在泉珠上的比例、日蚀窗口里打在泉珠上的比例</summary>
            public float weakShare, eclipseShare;
            /// <summary>场上有沙魇时分去打它们的火力比例、一批沙魇在场多久（秒）</summary>
            public float addsShare, addsSeconds;
            /// <summary>邪飞天落地到琵琶被打碎要多久（秒）</summary>
            public float pipaSeconds;
            public Element element;

            public override string ToString() => $"{name}（身体秒伤 {bodyDps:F0}，输出占比 {aim:P0}）";
        }

        /// <summary>下沿：秒伤带下沿的武器、打得一般</summary>
        public static Profile Low => new()
        {
            name = "下沿", bodyDps = BodyDpsLow * GearAt14 * KitAt14, aim = 0.8f, crit = 0.05f, weakShare = 0.18f, eclipseShare = 0.35f,
            addsShare = 0.28f, addsSeconds = 9f, pipaSeconds = 5.5f,
        };

        /// <summary>中位：带中间的武器、打得正常</summary>
        public static Profile Mid => new()
        {
            name = "中位", bodyDps = (BodyDpsLow + BodyDpsHigh) * 0.5f * GearAt14 * KitAt14, aim = 0.82f, crit = 0.07f, weakShare = 0.22f, eclipseShare = 0.45f,
            addsShare = 0.25f, addsSeconds = 8f, pipaSeconds = 4.5f,
        };

        /// <summary>上沿：秒伤带上沿的武器、打得好</summary>
        public static Profile High => new()
        {
            name = "上沿", bodyDps = BodyDpsHigh * GearAt14 * KitAt14, aim = 0.84f, crit = 0.08f, weakShare = 0.26f, eclipseShare = 0.5f,
            addsShare = 0.22f, addsSeconds = 7f, pipaSeconds = 3.5f,
        };

        public static Profile[] Profiles => new[] { Low, Mid, High };

        /// <summary>一场模拟的结果</summary>
        public struct Result
        {
            /// <summary>登场结束到倒下（秒）；打不死时 = 模拟上限</summary>
            public float seconds;
            public bool killed;
            /// <summary>各阶段开始的时刻（秒；没到为 −1）</summary>
            public float phase2At, phase3At;
            /// <summary>不可选中（转阶段）、护体、泉珠露出、日蚀窗口的累计秒数</summary>
            public float untargetable, warded, weakOpen, eclipseOpen;
            /// <summary>出招次数、日蚀次数、召邪飞天次数</summary>
            public int moves, eclipses, apsaras;
            /// <summary>总伤害（落在护盾 + 生命上的）</summary>
            public float dealt;

            public override string ToString() =>
                $"{seconds:F0} s（二阶段 {phase2At:F0} s、三阶段 {phase3At:F0} s；出招 {moves}、日蚀 {eclipses}、飞天 {apsaras}；转阶段 {untargetable:F1} s、护体 {warded:F1} s、泉珠 {weakOpen:F1} s）";
        }

        sealed class SimMove
        {
            public BossMove move;
            public float readyAt;
        }

        enum Stage { Rest, Windup, Active, Recover, Transition, Stagger }

        /// <summary>按某种打法、某个种子模拟一场（难度默认 1-4 的 1.48）</summary>
        public static Result Simulate(HanbaDef def, in Profile profile, int seed = 1, float difficulty = HanbaDef.StageDifficulty, float dt = 0.02f, float limit = 600f)
        {
            // 局部函数不能捕获 in 参数：拷一份
            var p = profile;
            var r = new Result { phase2At = -1, phase3At = -1 };
            if (def == null) return r;
            var v = def.VitalsAt(difficulty);
            float shield = v.shield, armor = v.armor, health = v.hp, maxHp = Mathf.Max(1, v.hp);
            var rng = new System.Random(seed);
            var moves = new List<SimMove>();
            foreach (var make in def.moves)
            {
                var m = make?.Invoke();
                if (m != null) moves.Add(new SimMove { move = m, readyAt = Mathf.Max(0, m.firstDelay) });
            }
            int phase = 0;
            float t = 0, stageLeft = Mathf.Max(0, def.intro.firstRest), waitAcc = 0, weakGrace = 0, addsLeft = 0, wardLeft = 0, staggerTaken = 1f;
            var stage = Stage.Rest;
            SimMove cur = null;
            HanbaMovePlan plan = default;
            string lastId = null, queued = null;

            while (health > 0 && t < limit)
            {
                // ── 阶段：越线后等当前招式收尾（≤ phaseWait），再进转换 ──
                if (phase < def.phases.Count && stage != Stage.Transition && health / maxHp <= def.phases[phase].at)
                {
                    bool inMove = stage is Stage.Windup or Stage.Active or Stage.Recover;
                    if (inMove && waitAcc < def.phaseWait) waitAcc += dt;
                    else
                    {
                        waitAcc = 0;
                        var pd = def.phases[phase];
                        phase++;
                        if (phase == 1) r.phase2At = t;
                        else if (phase == 2) r.phase3At = t;
                        cur = null;
                        stage = Stage.Transition;
                        stageLeft = Mathf.Max(0, pd.seconds);
                        queued = pd.firstMove;
                        weakGrace = 0;
                    }
                }

                // ── 首领时间轴 ──
                stageLeft -= dt;
                weakGrace -= dt;
                addsLeft -= dt;
                switch (stage)
                {
                    case Stage.Rest:
                        if (stageLeft <= 0) Pick();
                        break;
                    case Stage.Windup:
                        if (stageLeft <= 0) Enter(Stage.Active);
                        break;
                    case Stage.Active:
                        if (stageLeft <= 0) Enter(Stage.Recover);
                        break;
                    case Stage.Recover:
                        if (stageLeft <= 0)
                        {
                            weakGrace = def.weakGrace;
                            stage = Stage.Rest;
                            stageLeft = Mathf.Max(0, cur.move.recovery) * RestScale(def, phase);
                            cur = null;
                        }
                        break;
                    case Stage.Transition:
                        if (stageLeft <= 0)
                        {
                            stage = Stage.Rest;
                            stageLeft = 0.4f;
                        }
                        break;
                    case Stage.Stagger:
                        if (stageLeft <= 0)
                        {
                            stage = Stage.Rest;
                            stageLeft = 0.6f;
                            staggerTaken = 1f;
                        }
                        break;
                }
                // 护体：琵琶在 pipaSeconds 后碎掉 → 踉跄
                if (wardLeft > 0)
                {
                    wardLeft -= dt;
                    r.warded += dt;
                    if (wardLeft <= 0 && stage != Stage.Transition)
                    {
                        cur = null;
                        stage = Stage.Stagger;
                        stageLeft = def.wardBreakStagger;
                        staggerTaken = def.wardBreakTaken;
                    }
                }

                // ── 玩家输出 ──
                bool targetable = stage != Stage.Transition;
                if (!targetable) r.untargetable += dt;
                else if (wardLeft <= 0)
                {
                    bool eclipse = stage == Stage.Active && cur?.move is Phase3Eclipse;
                    bool weak = eclipse || stage == Stage.Recover || stage == Stage.Stagger || weakGrace > 0;
                    if (weak) r.weakOpen += dt;
                    if (eclipse) r.eclipseOpen += dt;
                    float dps = p.bodyDps * p.aim;
                    if (addsLeft > 0) dps *= 1f - Mathf.Clamp01(p.addsShare);
                    float share = eclipse ? p.eclipseShare : weak ? p.weakShare : 0;
                    float weakMult = CritMult * (eclipse ? def.eclipseWeakMult : 1f);
                    float bodyMult = 1f + Mathf.Clamp01(p.crit) * (CritMult - 1f);
                    float rate = dps * ((1f - share) * bodyMult + share * weakMult) * (stage == Stage.Stagger ? staggerTaken : 1f);
                    Apply(rate * dt);
                }
                t += dt;
            }
            r.seconds = t;
            r.killed = health <= 0;
            return r;

            void Pick()
            {
                SimMove pick = null;
                if (!string.IsNullOrEmpty(queued))
                {
                    foreach (var s in moves)
                        if (s.move.Id == queued && Allowed(s.move))
                            pick = s;
                    queued = null;
                }
                if (pick == null)
                {
                    float total = 0;
                    bool others = false;
                    foreach (var s in moves)
                        if (Ready(s) && s.move.Id != lastId)
                            others = true;
                    foreach (var s in moves) total += W(s, others);
                    if (total <= 0)
                    {
                        stageLeft = 0.3f;
                        return;
                    }
                    double x = rng.NextDouble() * total;
                    foreach (var s in moves)
                    {
                        float w = W(s, others);
                        if (w <= 0) continue;
                        pick = s;
                        x -= w;
                        if (x <= 0) break;
                    }
                }
                if (pick == null)
                {
                    stageLeft = 0.3f;
                    return;
                }
                cur = pick;
                lastId = pick.move.Id;
                pick.readyAt = t + Mathf.Max(0, pick.move.cooldown);
                plan = pick.move is HanbaMove hm ? hm.Plan(def.PaceAt(phase)) : new HanbaMovePlan(pick.move.windup, pick.move.active, pick.move.recover);
                r.moves++;
                Enter(Stage.Windup);
            }

            float W(SimMove s, bool others)
            {
                if (!Ready(s)) return 0;
                float w = s.move.weight;
                if (s.move is Phase1SandWraiths && addsLeft > 0) w = 0;
                if (s.move is Phase2ApsaraCall && wardLeft > 0) w = 0;
                if (others && s.move.Id == lastId) w *= Mathf.Max(0, def.repeatWeight);
                return w;
            }

            bool Ready(SimMove s) => t >= s.readyAt && Allowed(s.move);
            bool Allowed(BossMove m) => phase >= m.minPhase && phase <= m.maxPhase;

            void Enter(Stage s)
            {
                stage = s;
                switch (s)
                {
                    case Stage.Windup:
                        stageLeft = plan.windup;
                        break;
                    case Stage.Active:
                        stageLeft = plan.active;
                        // 出手的效果
                        switch (cur.move)
                        {
                            case Phase1SandWraiths:
                                addsLeft = p.addsSeconds;
                                break;
                            case Phase2ApsaraCall:
                                wardLeft = Mathf.Max(0.01f, p.pipaSeconds);
                                r.apsaras++;
                                break;
                            case Phase3Eclipse:
                                r.eclipses++;
                                break;
                        }
                        break;
                    case Stage.Recover:
                        stageLeft = plan.recover;
                        break;
                }
            }

            void Apply(float amount)
            {
                if (!(amount > 0)) return;
                float left = amount;
                left = Eat(ref shield, left, DamageTable.LayerMult(p.element, DamageLayer.Shield));
                left = Eat(ref armor, left, DamageTable.LayerMult(p.element, DamageLayer.Armor));
                Eat(ref health, left, DamageTable.LayerMult(p.element, DamageLayer.Health));
            }

            float Eat(ref float pool, float raw, float mult)
            {
                if (raw <= 0 || pool <= 0) return raw;
                float dmg = raw * mult;
                if (dmg <= pool)
                {
                    pool -= dmg;
                    r.dealt += dmg;
                    return 0;
                }
                r.dealt += pool;
                float used = pool / mult;
                pool = 0;
                return raw - used;
            }
        }

        static float RestScale(HanbaDef def, int phase) =>
            phase > 0 && phase - 1 < def.phases.Count && def.phases[phase - 1] != null ? def.phases[phase - 1].restScale : 1f;

        /// <summary>同一种打法跑 runs 个种子，返回平均击杀用时与最短 / 最长</summary>
        public static (float mean, float min, float max, Result sample) Average(HanbaDef def, in Profile p, int runs = 16, float difficulty = HanbaDef.StageDifficulty)
        {
            float sum = 0, min = float.PositiveInfinity, max = 0;
            Result first = default;
            for (int i = 0; i < Math.Max(1, runs); i++)
            {
                var r = Simulate(def, p, 1000 + i * 7919, difficulty);
                if (i == 0) first = r;
                sum += r.seconds;
                min = Mathf.Min(min, r.seconds);
                max = Mathf.Max(max, r.seconds);
            }
            return (sum / Math.Max(1, runs), min, max, first);
        }
    }
}
