namespace Spiritfire.Game
{
    /// <summary>破盾急装（Three.js 版 defsTactics.ts tac_emergency_reload）：护盾被击破后 5 秒内，换弹速度每层 +20%（刷新不叠加；换关 / 阵亡清空）。</summary>
    [Defs(611)]
    public sealed class TacEmergencyReload : ScrollDef
    {
        public TacEmergencyReload()
        {
            id = "tac_emergency_reload";
            name = "破盾急装";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "护盾", "换弹" };
            description = "护盾被击破后 5 秒内，换弹速度每层 +20%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.BattleBuff((Stat.ReloadSpeedPct, 0.2f * n));
            s.OnPlayerShieldBroken(() =>
            {
                if (!TacticsKit.Alive(s)) return;
                buff.Trigger(5);
                s.Proc();
            });
        }
    }
}
