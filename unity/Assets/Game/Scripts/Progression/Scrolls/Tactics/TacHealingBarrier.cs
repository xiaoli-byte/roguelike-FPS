namespace Spiritfire.Game
{
    /// <summary>
    /// 回生结界（Three.js 版 defsTactics.ts tac_healing_barrier）：实际回复生命时（<see cref="GameEvents.PlayerHealed"/> 的实际量，满生命为 0 不派发），
    /// 同时回复该次回复量每层 25% 的护盾（不超过实际上限）。生命恢复（HpRegen）不派发回复事件，同 TS。
    /// </summary>
    [Defs(612)]
    public sealed class TacHealingBarrier : ScrollDef
    {
        public TacHealingBarrier()
        {
            id = "tac_healing_barrier";
            name = "回生结界";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "生存", "护盾" };
            description = "实际回复生命时，同时回复该次回复量每层 25% 的护盾；满生命时无效。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnPlayerHealed(amount =>
            {
                if (!TacticsKit.Alive(s) || !(amount > 0)) return;
                TacticsKit.Host.AddShield(amount * 0.25f * n);
            });
        }
    }
}
