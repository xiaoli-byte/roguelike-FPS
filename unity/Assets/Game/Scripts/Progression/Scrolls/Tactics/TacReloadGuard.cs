namespace Spiritfire.Game
{
    /// <summary>
    /// 装填壁垒（Three.js 版 defsTactics.ts tac_reload_guard）：实际换弹期间，受到的伤害每层 −8%（玩家受伤修饰器，固定倍率；与其他减伤相乘）。
    /// </summary>
    [Defs(602)]
    public sealed class TacReloadGuard : ScrollDef
    {
        public TacReloadGuard()
        {
            id = "tac_reload_guard";
            name = "装填壁垒";
            rarity = 0;
            maxStacks = 3;
            tags = new[] { "换弹", "生存" };
            description = "正在换弹时，受到的伤害每层 −8%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float mult = 1 - 0.08f * n;
            s.AddIncoming((in IncomingHit h) => TacticsKit.Host.Reloading ? mult : 1f);
        }
    }
}
