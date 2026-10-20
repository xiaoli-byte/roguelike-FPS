namespace Spiritfire.Game
{
    /// <summary>
    /// 灵武轮转（传说·高风险，Three.js 版 defsTactics.ts tac_spellgun_cycle）：释放英雄技能后 5 秒内武器伤害 +25%；
    /// 武器直接命中造成伤害后 5 秒内技能伤害 +35%（各自刷新不叠加，换关 / 阵亡清空）；代价：受到的伤害 ×1.15。
    /// </summary>
    [Defs(619)]
    public sealed class TacSpellgunCycle : ScrollDef
    {
        public const float Seconds = 5f, TakenMult = 1.15f;

        public TacSpellgunCycle()
        {
            id = "tac_spellgun_cycle";
            name = "灵武轮转";
            rarity = 4;
            maxStacks = 1;
            tags = new[] { "传说", "技能", "伤害", "风险" };
            description = "释放英雄技能后 5 秒内武器伤害 +25%；武器直接命中造成伤害后 5 秒内技能伤害 +35%；但受到的伤害 +15%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var gun = s.BattleBuff((Stat.DamagePct, 0.25f));
            var spell = s.BattleBuff((Stat.SkillDamagePct, 0.35f));
            s.AddIncoming((in IncomingHit h) => TakenMult);
            s.OnSkillUsed((slot, skillId) =>
            {
                if (!TacticsKit.Alive(s)) return;
                gun.Trigger(Seconds);
                s.Proc();
            });
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (TacticsKit.Alive(s) && e.result.total > 0 && TacticsKit.IsDirectWeaponHit(e.info)) spell.Trigger(Seconds);
            });
        }
    }
}
