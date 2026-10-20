namespace Spiritfire.Game
{
    /// <summary>
    /// 混元（传说·高风险，Three.js 版 defsReaction.ts rx_hunyuan）：元素反应伤害 +60%、反应急速 +40%；
    /// 代价：受到的伤害 ×1.25（玩家受伤修饰器，固定倍率），护盾上限 −30。
    /// </summary>
    [Defs(522)]
    public sealed class RxHunyuan : ScrollDef
    {
        public const float TakenMult = 1.25f;

        public RxHunyuan()
        {
            id = "rx_hunyuan";
            name = "混元";
            rarity = 4;
            maxStacks = 1;
            tags = new[] { "元素", "反应", "传说", "风险" };
            description = "元素反应伤害 +60%，元素反应急速 +40%；但受到的伤害 +25%，护盾上限 −30。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.ReactionDamagePct, 0.6f);
            s.Stat(Stat.ReactionHaste, 0.4f);
            s.Stat(Stat.MaxShield, -30);
            s.AddIncoming((in IncomingHit h) => TakenMult);
        }
    }
}
