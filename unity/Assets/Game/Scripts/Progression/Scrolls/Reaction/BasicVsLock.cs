namespace Spiritfire.Game
{
    /// <summary>
    /// 锁灵（Three.js 版 defsReaction.ts rx_vs_lock）：被「封脉」的敌人 4 秒内受到的元素伤害（带元素的命中、持续伤害、反应伤害）每层 +12%。
    /// 任何深度的封脉都会挂上 / 刷新标记。
    /// </summary>
    [Defs(513)]
    public sealed class RxVsLock : ScrollDef
    {
        public const float Duration = 4f;

        public RxVsLock()
        {
            id = "rx_vs_lock";
            name = "锁灵";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "反应", "封脉" };
            description = "被「封脉」的敌人 4 秒内受到的元素伤害每层 +12%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var marks = new EnemyTimers();
            float mult = 1 + 0.12f * n;
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id != Reaction.Veinseal || !ev.enemy) return;
                marks.Set(ev.enemy, s.Now + Duration);
            });
            s.AddOutgoing((in HitContext c) => c.info.element != Element.None && marks.Active(c.target, s.Now) ? mult : 1f);
            s.OnUninstall(marks.Clear);
        }
    }
}
