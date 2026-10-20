using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 化应为盾（Three.js 版 defsTactics.ts tac_reaction_ward，2026-10-05 重设计版）：直接元素反应（深度 0）蓄积 1 枚应盾，最多 2 枚、
    /// 每 0.8 秒至多蓄积一次；再次蓄积刷新全部应盾的 6 秒时长（已过期的先清零）。受到伤害时消耗 1 枚，使该次伤害每层 −20%（满层 −60%），
    /// 与其他减伤相乘。玩家受伤修饰器在无敌判定之后才求值，所以冲刺 / 免死无敌不会白白消耗应盾。衍生反应不蓄能；换关 / 阵亡清空。
    /// </summary>
    [Defs(615)]
    public sealed class TacReactionWard : ScrollDef
    {
        public const int MaxCharges = 2;
        public const float Duration = 6f, Gap = 0.8f;
        static readonly Color WardColor = Hex.Rgb(0xa7dfff);

        public TacReactionWard()
        {
            id = "tac_reaction_ward";
            name = "化应为盾";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "反应", "护盾", "生存" };
            description = "直接元素反应蓄积 1 枚应盾，最多 2 枚，每 0.8 秒至多蓄积一次；再次蓄积刷新全部应盾的 6 秒时长。受到伤害时消耗 1 枚，使该次伤害每层秘卷 −20%（满层 −60%）。衍生反应不蓄能，无敌时不消耗。";
        }

        public override void Install(ScrollScope s, int n)
        {
            int charges = 0;
            float until = float.NegativeInfinity;
            float mult = 1 - 0.2f * n;

            void Reset()
            {
                charges = 0;
                until = float.NegativeInfinity;
            }

            s.OnStageLoaded(_ => Reset());
            s.OnPlayerDied(Reset);
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (!TacticsKit.Alive(s) || ev.depth != 0 || !s.Ready("reaction", Gap)) return;
                if (s.Now >= until) charges = 0;
                charges = Mathf.Min(MaxCharges, charges + 1);
                until = s.Now + Duration;
            });
            s.AddIncoming((in IncomingHit h) =>
            {
                if (!TacticsKit.Alive(s) || charges <= 0 || s.Now >= until) return 1f;
                charges--;
                var p = TacticsKit.Host.Position;
                TacticsKit.FxRing(p + Vector3.up * 0.1f, 1.2f, WardColor, 0.25f);
                s.Proc();
                return mult;
            });
        }
    }
}
