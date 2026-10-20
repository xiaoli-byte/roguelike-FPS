namespace Spiritfire.Game
{
    /// <summary>
    /// 滑步装填（Three.js 版 defsTactics.ts tac_dash_load）：冲刺时把备弹中每层 2 发直接装进当前弹匣（<see cref="TacticsKit.LoadFromReserve"/>）：
    /// 不超过实际弹匣容量、实际扣除备弹、不发换弹事件；冷却 2 秒，装不进去（满匣 / 无备弹 / 碎刃近战形态）时不消耗冷却。
    /// </summary>
    [Defs(604)]
    public sealed class TacDashLoad : ScrollDef
    {
        public TacDashLoad()
        {
            id = "tac_dash_load";
            name = "滑步装填";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "机动", "弹匣" };
            description = "冲刺时将备弹中的每层 2 发装入当前弹匣；不超过弹匣容量，不触发换弹效果；冷却 2 秒。无备弹或持碎刃时不生效。";
        }

        public override void Install(ScrollScope s, int n)
        {
            int want = 2 * n;
            s.OnPlayerDashed(_ =>
            {
                var h = TacticsKit.Host;
                var w = h.ActiveWeapon;
                if (!TacticsKit.Alive(s) || w == null) return;
                if (TacticsKit.LoadableFromReserve(h, w, want) <= 0 || !s.Ready("load", 2)) return;
                TacticsKit.LoadFromReserve(h, w, want);
                s.Proc();
            });
        }
    }
}
