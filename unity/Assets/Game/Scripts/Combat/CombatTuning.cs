using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一种反应的威力与冷却参数：B = clamp(k × Pin, floor × S, cap × S) × scale；icd 为基础冷却（秒）</summary>
    public readonly struct ReactionTune
    {
        public readonly float k, floor, cap, icd;

        public ReactionTune(float k, float floor, float cap, float icd)
        {
            this.k = k;
            this.floor = floor;
            this.cap = cap;
            this.icd = icd;
        }
    }

    /// <summary>
    /// 战斗数值表：元素状态、元素反应、引爆 / 崩解、预算的全部常量（单一来源）。
    /// 数值照抄 Three.js 版（src/combat/Reactions.ts、Status.ts、Feedback.ts；docs/arsenal-expansion.md 第 2 节），
    /// 为 Unity 改过的值在注释里写明原因。反应处理器（Combat/Reactions/*Handler）与 EditMode 测试都只读这里。
    /// 状态常量目前 EnemyStatus 里还各有一份同值的 const（C2 单元把它们改成引用这里）。
    /// </summary>
    public static class CombatTuning
    {
        // ───────────── 反应总则 ─────────────

        /// <summary>附着深度 ≥ 这个值的元素不再引发反应（直接命中 0 → 扩散 1 → 再扩散 2 停）</summary>
        public const int MaxReactionDepth = 2;
        /// <summary>每帧最多接受的反应数（含引爆、强制反应；超出的不反应，元素照常附着）</summary>
        public const int FrameBudget = 8;
        /// <summary>待执行队列上限</summary>
        public const int QueueCap = 32;
        /// <summary>每帧最多几个「大」反应特效（焚雷 / 归墟的爆炸声与大爆闪）；超出的走小号表现</summary>
        public const int BigFxBudget = 3;
        /// <summary>反应浮字（焚雷 / 崩解…）每帧最多几条</summary>
        public const int LabelBudget = 4;
        /// <summary>同一敌人两条反应浮字的最短间隔（大号的「归墟」不受此限）</summary>
        public const float LabelGap = 0.3f;
        /// <summary>连锁条目（深度 ≥ 1）延后执行，让连锁节奏看得清</summary>
        public const float CascadeDelay = 0.15f;
        /// <summary>归墟收束预警时长</summary>
        public const float AbyssWindup = 0.35f;
        /// <summary>实际冷却 = 基础冷却 / (1 + 反应急速)，最低这么多秒</summary>
        public const float IcdFloor = 0.3f;
        /// <summary>(1 + 反应急速) 的下限（急速为很大的负数时不除以 0）</summary>
        public const float HasteDivisorFloor = 0.05f;
        /// <summary>同一敌人两次引爆之间的冷却</summary>
        public const float DetonateIcd = 0.5f;
        /// <summary>直接引爆推迟到下一次执行（约一帧）：同一击的满蓄 / 点穴（同帧）与「破势」（下一帧）并入同一次，取较高强度</summary>
        public const float DetonateMergeDelay = 1e-4f;
        /// <summary>附着强度 / 引爆强度的上限 = 敌人最大生命 × 这个值</summary>
        public const float PinCapOfMaxHp = 0.5f;
        /// <summary>关卡强度 S = 1 + max(0, 等级 − 1) × 0.85（同 ScrollKit.procScale）</summary>
        public const float StrengthPerLevel = 0.85f;

        /// <summary>
        /// 四种反应的威力与冷却（按 <see cref="Reaction"/> 的顺序）。
        /// 封脉基础冷却 1.2 s（Three.js 实测后由 1.5 下调；眩晕另有 3.5 s 独立冷却，不吃急速）。
        /// </summary>
        public static readonly ReactionTune[] Reactions =
        {
            new(1.0f, 14, 80, 1.0f),  // 焚雷
            new(1.0f, 14, 100, 1.2f), // 熔金
            new(1.0f, 14, 90, 1.2f),  // 封脉
            new(1.5f, 40, 320, 6.0f), // 归墟
        };

        public static ReactionTune Of(Reaction id) => Reactions[(int)id];

        /// <summary>反应名（浮字）</summary>
        public static readonly string[] ReactionNames = { "焚雷", "熔金", "封脉", "归墟" };
        /// <summary>反应颜色（Three.js REACTION_COLORS）</summary>
        public static readonly Color[] ReactionColors = { Hex.Rgb(0xffd84a), Hex.Rgb(0xff7a1a), Hex.Rgb(0x5affd0), Hex.Rgb(0xc89bff) };

        // ───────────── 焚雷：灼烧 ⇄ 雷殛 ─────────────

        /// <summary>焚雷：中心火伤 B；爆炸 / 扩散半径 3 m（吃爆炸范围）、周围 0.6B（边缘 60%）、击退 7；周围附灼烧 0.2B；雷弧最多 4 道</summary>
        public static class Thunderfire
        {
            public const float Radius = 3f, Splash = 0.6f, Falloff = 0.6f, Knockback = 7f, SpreadBurn = 0.2f;
            public const int MaxArcs = 4;
            /// <summary>扩散灼烧最多点燃几个（Unity：按距离取最近的这么多个；Three.js 是半径内全部）</summary>
            public const int SpreadTargets = 16;
            public static readonly Color ArcColor = Hex.Rgb(0x6fd8ff);
        }

        // ───────────── 熔金：灼烧 ⇄ 蚀化 ─────────────

        /// <summary>熔金：中心蚀伤 B（有护甲 ×2）；脚下熔池 2.5 m（吃爆炸范围）3 s，每 0.5 s 0.12B 火伤，每个敌人第一次踩到附蚀 0.25B</summary>
        public static class Meltdown
        {
            public const float ArmorMult = 2f, PoolRadius = 2.5f, PoolTick = 0.5f, PoolDamage = 0.12f, PoolCorrode = 0.25f;
            public const int PoolTicks = 6, MaxPools = 4;
            /// <summary>敌人脚底高于池面多少以内算站在池里；低于池面超过 PoolBelow 不算</summary>
            public const float PoolHeight = 1.5f, PoolBelow = 1f;
            public static readonly Color PoolColor = new(1f, 0.48f, 0.1f, 0.55f);
        }

        // ───────────── 封脉：雷殛 ⇄ 蚀化 ─────────────

        /// <summary>
        /// 封脉：中心雷伤 B（有护盾 ×2）；非首领眩晕 0.7 s（同一敌人 3.5 s 一次）+ 减速 40% 3 s；
        /// 首领改为「脉滞」4 s 内受到的伤害 ×1.12；向 8 m 内最近 3 个有视线的敌人导流 0.3B 雷伤 + 附蚀 0.35B
        /// </summary>
        public static class Veinseal
        {
            public const float ShieldMult = 2f, Stun = 0.7f, StunIcd = 3.5f, Slow = 0.4f, SlowDuration = 3f;
            public const float BossVuln = 1.12f, BossVulnDuration = 4f;
            public const float ConductRange = 8f, ConductDamage = 0.3f, ConductCorrode = 0.35f;
            public const int ConductTargets = 3;
            public const float RingRadius = 1.6f;
        }

        // ───────────── 归墟：三相齐聚 ─────────────

        /// <summary>归墟：结清灼烧 + 火 / 雷 / 蚀三段各 B/3；余波 3 m（吃爆炸范围）0.3B（中心已死 0.6B，边缘 60%），击退 9；天雷从 7 m 高劈下</summary>
        public static class Abyss
        {
            public const float Radius = 3f, Splash = 0.3f, SplashDead = 0.6f, Falloff = 0.6f, Knockback = 9f;
            public const float BoltHeight = 7f, WarnRadius = 1.6f, RingRadius = 3f;
        }

        // ───────────── 崩解：引爆单一状态 ─────────────

        /// <summary>崩解：灼烧 / 蚀化取剩余持续伤害的 30%，雷殛取强度的 50%（再弹射一次），单次上限 30 × S；不消耗状态</summary>
        public static class Collapse
        {
            public const float Burn = 0.3f, Corrode = 0.3f, Shock = 0.5f, Cap = 30f;
            public const float RingRadius = 1.5f;
        }

        // ───────────── 元素状态（src/combat/Status.ts） ─────────────

        /// <summary>灼烧：每层独立计时 4 s，最多 3 层，每 0.5 s 跳 Σ层强度 × 0.16（一层烧满 = 强度 × 1.28）</summary>
        public static class Burn
        {
            public const float Duration = 4f, Tick = 0.5f, Ratio = 0.16f;
            public const int MaxStacks = 3;
        }

        /// <summary>雷殛：标记 3 s；直接命中附着时向 8 m 内 3 个敌人弹射 强度 × 0.5（同一敌人间隔 ≥ 0.2 s）；叠 3 层眩晕 0.8 s；带标记受雷伤 ×1.15</summary>
        public static class Shock
        {
            public const float MarkDuration = 3f, ChainRange = 8f, ChainRatio = 0.5f, ChainCooldown = 0.2f, StunDuration = 0.8f, MarkBonus = 1.15f;
            public const int ChainTargets = 3, StunStacks = 3;
        }

        /// <summary>蚀化：5 s，每 0.5 s 跳 强度 × 0.08；期间承伤 ×1.2、移速 ×0.8</summary>
        public static class Corrode
        {
            public const float Duration = 5f, Tick = 0.5f, Ratio = 0.08f, DamageTaken = 1.2f, Slow = 0.8f;
        }

        /// <summary>眩晕 / 减速：精英眩晕 ×0.75；首领 ×0.35 且 ≤ 0.35 s，之后 6.1 s 免疫；减速最多 4 条、最强 90%</summary>
        public static class Control
        {
            public const float StunDefault = 1f, EliteStunScale = 0.75f, BossStunScale = 0.35f, BossStunMax = 0.35f, BossStunImmunity = 6.1f;
            public const float SlowDefault = 2f, SlowMax = 0.9f;
            public const int SlowMaxEntries = 4;
        }

        /// <summary>计时比较的容差：同步递减的两个计时器因浮点误差差一点点时，仍判定为同一时刻（剩余跳数用）</summary>
        public const float TickEps = 1e-4f;
    }
}
