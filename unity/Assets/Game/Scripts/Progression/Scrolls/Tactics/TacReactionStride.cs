namespace Spiritfire.Game
{
    /// <summary>
    /// 应变疾行（Three.js 版 defsTactics.ts tac_reaction_stride）：直接引发元素反应（深度 0）后 4 秒内，移动速度每层 +0.4、反应急速每层 +5%；
    /// 再次触发只刷新时长；衍生反应不触发；换关 / 阵亡清空。
    /// </summary>
    [Defs(616)]
    public sealed class TacReactionStride : ScrollDef
    {
        public TacReactionStride()
        {
            id = "tac_reaction_stride";
            name = "应变疾行";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "反应", "机动" };
            description = "直接引发元素反应后 4 秒内，移动速度每层 +0.4、反应急速每层 +5%；再次触发刷新时长。衍生反应不触发。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.BattleBuff((Stat.MoveSpeed, 0.4f * n), (Stat.ReactionHaste, 0.05f * n));
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (!TacticsKit.Alive(s) || ev.depth != 0) return;
                bool fresh = !buff.IsActive;
                buff.Trigger(4);
                if (fresh) s.Proc();
            });
        }
    }
}
