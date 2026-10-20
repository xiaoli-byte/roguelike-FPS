namespace Spiritfire.Game
{
    /// <summary>
    /// 会心悟道（Three.js 版 defsTactics.ts tac_crit_insight）：武器直接命中暴击且造成伤害时（衍生、静默处决不算），
    /// 副技能（E）冷却每层减少 0.2 秒；冷却 0.75 秒。
    /// </summary>
    [Defs(613)]
    public sealed class TacCritInsight : ScrollDef
    {
        public TacCritInsight()
        {
            id = "tac_crit_insight";
            name = "会心悟道";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "暴击", "技能" };
            description = "武器直接暴击造成伤害时，副技能（E）冷却每层减少 0.2 秒；冷却 0.75 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!TacticsKit.Alive(s) || !e.result.crit || !(e.result.total > 0) || !TacticsKit.IsDirectWeaponHit(e.info)) return;
                if (!s.Ready("insight", 0.75f)) return;
                TacticsKit.Host.ReduceCooldowns(0.2f * n, SkillSlot.Secondary);
                s.Proc();
            });
        }
    }
}
