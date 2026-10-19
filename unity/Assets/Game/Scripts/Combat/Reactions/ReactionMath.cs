using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 反应判定与数值的纯函数（Three.js 版 src/combat/Reactions.ts 的 pairOf / reactionBase / tryReact / detonate / collapseRaw，
    /// src/combat/Status.ts 的 ticksLeft）：没有副作用、不读场景，<see cref="ReactionScheduler"/> 与 EditMode 测试共用。
    /// 「冷却就绪」用位掩码传入（第 i 位 = <see cref="Reaction"/> i 就绪），避免每次判定分配闭包。
    /// </summary>
    public static class ReactionMath
    {
        /// <summary>全部反应都就绪的掩码</summary>
        public const int AllReady = 0b1111;

        public static int Bit(Reaction id) => 1 << (int)id;

        public static bool IsReady(int readyMask, Reaction id) => (readyMask & Bit(id)) != 0;

        /// <summary>关卡强度 S = 1 + max(0, 等级 − 1) × 0.85</summary>
        public static float Strength(float level) => 1 + Mathf.Max(0, level - 1) * CombatTuning.StrengthPerLevel;

        /// <summary>反应威力 B（不含 scale）：clamp(k × Pin, floor × S, cap × S)；Pin 非有限按 0</summary>
        public static float Base(Reaction id, float pin, float strength)
        {
            var t = CombatTuning.Of(id);
            float p = float.IsNaN(pin) || float.IsInfinity(pin) ? 0 : Mathf.Max(0, pin);
            return Mathf.Clamp(t.k * p, t.floor * strength, t.cap * strength);
        }

        /// <summary>实际冷却 = 基础冷却 / (1 + 反应急速)，最低 0.3 s</summary>
        public static float Cooldown(Reaction id, float haste) =>
            Mathf.Max(CombatTuning.IcdFloor, CombatTuning.Of(id).icd / Mathf.Max(CombatTuning.HasteDivisorFloor, 1 + haste));

        /// <summary>两个状态组成的两两反应；同一状态或非元素状态返回 null</summary>
        public static Reaction? PairOf(StatusId a, StatusId b)
        {
            if (a == b) return null;
            bool burn = a == StatusId.Burn || b == StatusId.Burn;
            bool shock = a == StatusId.Shock || b == StatusId.Shock;
            bool corrode = a == StatusId.Corrode || b == StatusId.Corrode;
            if (burn && shock) return Reaction.Thunderfire;
            if (burn && corrode) return Reaction.Meltdown;
            if (shock && corrode) return Reaction.Veinseal;
            return null;
        }

        /// <summary>
        /// 元素附着时的判定（hb / hs / hc = 除 incoming 以外身上已有的状态）：
        /// 另外两种都在、不是击杀那一击且归墟就绪 → 归墟；否则 incoming 与已有状态组成的两两反应中，按 焚雷 &gt; 熔金 &gt; 封脉 取第一个就绪的。
        /// </summary>
        public static Reaction? PlanAttach(Element incoming, bool hb, bool hs, bool hc, bool killed, int readyMask)
        {
            if (incoming == Element.Fire) hb = false;
            else if (incoming == Element.Shock) hs = false;
            else if (incoming == Element.Corrode) hc = false;
            else return null;
            int others = (hb ? 1 : 0) + (hs ? 1 : 0) + (hc ? 1 : 0);
            if (others == 0) return null;
            if (others == 2 && !killed && IsReady(readyMask, Reaction.Abyss)) return Reaction.Abyss;
            bool fire = incoming == Element.Fire, shock = incoming == Element.Shock, cor = incoming == Element.Corrode;
            if (((fire && hs) || (shock && hb)) && IsReady(readyMask, Reaction.Thunderfire)) return Reaction.Thunderfire;
            if (((fire && hc) || (cor && hb)) && IsReady(readyMask, Reaction.Meltdown)) return Reaction.Meltdown;
            if (((shock && hc) || (cor && hs)) && IsReady(readyMask, Reaction.Veinseal)) return Reaction.Veinseal;
            return null;
        }

        /// <summary>
        /// 引爆的判定（hb / hs / hc = 身上已有的状态）：三种齐聚且归墟就绪 → 归墟；≥ 2 种 → 已有状态两两组合中按优先级取第一个就绪的；
        /// 否则（只有 1 种，或组合都在冷却）→ 崩解。身上什么都没有返回 null。
        /// </summary>
        public static DetonateOutcome? PlanDetonate(bool hb, bool hs, bool hc, int readyMask)
        {
            int n = (hb ? 1 : 0) + (hs ? 1 : 0) + (hc ? 1 : 0);
            if (n == 0) return null;
            if (n == 3 && IsReady(readyMask, Reaction.Abyss)) return DetonateOutcome.Abyss;
            if (n >= 2)
            {
                if (hb && hs && IsReady(readyMask, Reaction.Thunderfire)) return DetonateOutcome.Thunderfire;
                if (hb && hc && IsReady(readyMask, Reaction.Meltdown)) return DetonateOutcome.Meltdown;
                if (hs && hc && IsReady(readyMask, Reaction.Veinseal)) return DetonateOutcome.Veinseal;
            }
            return DetonateOutcome.Collapse;
        }

        /// <summary>崩解选哪个状态：灼烧 &gt; 蚀化 &gt; 雷殛</summary>
        public static StatusId CollapseStatus(bool hb, bool hs, bool hc) => hb ? StatusId.Burn : hc ? StatusId.Corrode : StatusId.Shock;

        /// <summary>
        /// 崩解伤害（未乘引爆倍率）：灼烧 / 蚀化 = min(0.3 × 剩余持续伤害, 30S)，雷殛 = min(0.5 × 雷殛强度, 30S)。
        /// dotRemaining 已含每一跳会乘的属性倍率；shockPin 为反应口径的雷殛强度（同样已乘回属性倍率）。
        /// </summary>
        public static float CollapseDamage(StatusId sid, float dotRemaining, float shockPin, float strength)
        {
            float cap = CombatTuning.Collapse.Cap * strength;
            float v = sid switch
            {
                StatusId.Burn => CombatTuning.Collapse.Burn * dotRemaining,
                StatusId.Corrode => CombatTuning.Collapse.Corrode * dotRemaining,
                StatusId.Shock => CombatTuning.Collapse.Shock * shockPin,
                _ => 0,
            };
            if (float.IsNaN(v) || v < 0) v = 0;
            return Mathf.Min(v, cap);
        }

        /// <summary>
        /// 持续伤害还剩几跳：剩余 remaining 秒、下一跳在 next 秒后、间隔 interval（同 Three.js ticksLeft：最后一跳与到期同帧也算）。
        /// remaining &lt; next 时为 0。
        /// </summary>
        public static int TicksLeft(float remaining, float next, float interval)
        {
            next = Mathf.Max(0, next);
            if (!(remaining + CombatTuning.TickEps >= next) || !(interval > 0)) return 0;
            return Mathf.FloorToInt((remaining + CombatTuning.TickEps - next) / interval) + 1;
        }

        /// <summary>状态对应的元素（灼烧 → 火、雷殛 → 雷、蚀化 → 蚀；其他 None）</summary>
        public static Element ElementOf(StatusId s) => s switch
        {
            StatusId.Burn => Element.Fire,
            StatusId.Shock => Element.Shock,
            StatusId.Corrode => Element.Corrode,
            _ => Element.None,
        };

        /// <summary>引爆结果 ↔ 反应（崩解没有对应的反应）</summary>
        public static DetonateOutcome OutcomeOf(Reaction id) => (DetonateOutcome)(int)id;

        public static Reaction? ReactionOf(DetonateOutcome o) => o == DetonateOutcome.Collapse ? null : (Reaction)(int)o;
    }
}
