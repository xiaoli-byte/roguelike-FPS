namespace Spiritfire.Game
{
    /// <summary>
    /// 交替火力（Three.js 版 defsTactics.ts tac_crossfire）：切到另一把武器后 4 秒内，武器伤害每层 +12%；冷却 4 秒。
    /// 重复触发只刷新时长；换关 / 阵亡清空。战术组 [Defs] 顺序 600–619 按 TS TACTIC_SCROLLS 的下标排。
    /// </summary>
    [Defs(600)]
    public sealed class TacCrossfire : ScrollDef
    {
        public TacCrossfire()
        {
            id = "tac_crossfire";
            name = "交替火力";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "切枪", "伤害" };
            description = "切换到另一把武器后 4 秒内，武器伤害每层 +12%；冷却 4 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.BattleBuff((Stat.DamagePct, 0.12f * n));
            TacticsKit.OnSwitch(s, () =>
            {
                if (!s.Ready("switch", 4)) return;
                buff.Trigger(4);
                s.Proc();
            });
        }
    }
}
