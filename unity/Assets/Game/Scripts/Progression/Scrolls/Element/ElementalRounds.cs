namespace Spiritfire.Game
{
    /// <summary>
    /// 燃弹 / 雷弹 / 蚀弹（TS elementalRounds）：武器直接命中（造成了伤害、没打死、敌人还活着）时每层 5% 概率额外附着对应状态；
    /// 这一击自己已经附着了同一种状态就不再掷。状态强度按这一击推出（<see cref="ScrollKit.StatusPowerFrom"/>：实际伤害，上限最大生命一半，
    /// 除掉每一跳会乘回的元素 / 精英 / 首领加成），深度 0（可以引发反应，雷殛照常弹射）。
    /// </summary>
    public sealed class ElementalRoundsScroll : ScrollDef
    {
        public const float ChancePerStack = 0.05f;
        public readonly Element element;

        public ElementalRoundsScroll(string id, string name, Element element, string label)
        {
            this.id = id;
            this.name = name;
            this.element = element;
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "元素", label, "命中" };
            description = $"武器命中时每层 5% 概率额外附着{label}。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float chance = ChancePerStack * n;
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var enemy = e.enemy;
                if (!OffenseKit.IsDirectHit(in e.info) || e.result.killed || !enemy || enemy.Dead || e.result.total <= 0) return;
                if (e.result.statusApplied == element || !OffenseKit.Chance(chance)) return;
                ElementKit.ApplyStatus(enemy, element, ScrollKit.StatusPowerFrom(in e));
                s.Proc(0.3f);
            });
        }
    }
}
