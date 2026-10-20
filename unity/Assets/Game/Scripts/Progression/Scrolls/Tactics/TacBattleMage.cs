namespace Spiritfire.Game
{
    /// <summary>
    /// 术法回流（Three.js 版 defsTactics.ts tac_battle_mage）：英雄技能直接造成伤害时（<see cref="TacticsKit.IsDirectSkillHit"/>：
    /// 来源 Skill、深度 0、不是持续 / 反应 / 衍生 / 静默处决，伤害 &gt; 0），主技能（Q）冷却每层减少 0.25 秒；冷却 0.6 秒。
    /// </summary>
    [Defs(607)]
    public sealed class TacBattleMage : ScrollDef
    {
        public TacBattleMage()
        {
            id = "tac_battle_mage";
            name = "术法回流";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "技能", "命中" };
            description = "英雄技能直接造成伤害时，主技能（Q）冷却每层减少 0.25 秒；冷却 0.6 秒。持续伤害、反应和衍生伤害不触发。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!TacticsKit.Alive(s) || !(e.result.total > 0) || !TacticsKit.IsDirectSkillHit(e.info) || !s.Ready("skill", 0.6f)) return;
                TacticsKit.Host.ReduceCooldowns(0.25f * n, SkillSlot.Primary);
                s.Proc();
            });
        }
    }
}
