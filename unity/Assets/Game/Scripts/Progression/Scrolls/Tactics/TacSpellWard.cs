namespace Spiritfire.Game
{
    /// <summary>施法护符（Three.js 版 defsTactics.ts tac_spell_ward）：释放英雄技能（Q / E）时每层回复 6 护盾；冷却 2 秒。</summary>
    [Defs(608)]
    public sealed class TacSpellWard : ScrollDef
    {
        public TacSpellWard()
        {
            id = "tac_spell_ward";
            name = "施法护符";
            rarity = 0;
            maxStacks = 3;
            tags = new[] { "技能", "护盾" };
            description = "释放英雄技能时每层回复 6 护盾；冷却 2 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnSkillUsed((slot, skillId) =>
            {
                if (!TacticsKit.Alive(s) || !s.Ready("ward", 2)) return;
                TacticsKit.Host.AddShield(6 * n);
                s.Proc();
            });
        }
    }
}
