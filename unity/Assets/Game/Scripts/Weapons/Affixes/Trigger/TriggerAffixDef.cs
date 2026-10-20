namespace Spiritfire.Game
{
    /// <summary>
    /// 触发类词条的基类（docs/unity-parity.md 3.4「触发 14」，同 TS AFFIXES 的 headBlast … seed）：和数值类同池抽取、同样随稀有度放大，
    /// 生效挂在 <see cref="AffixDef.Effect"/> 上，由 <see cref="AffixEffects"/>（命中 / 击杀 / 反应）、<see cref="AffixRuntime"/>（输出修饰）、
    /// <see cref="WeaponRuntime"/>（射速）派发，只认本武器（weaponUid）的伤害与反应。
    /// </summary>
    public abstract class TriggerAffixDef : AffixDef
    {
        protected TriggerAffixDef(string id, float min, float max, float weight, bool perHit = false) : base(id, min, max, weight, perHit: perHit) { }

        public override AffixKind Kind => AffixKind.Trigger;
    }

    /// <summary>
    /// 副元素三条（副·焚 / 副·雷 / 副·蚀）共用：perHit 类，原始区间 0.1–0.18（抽取时 × 稀有度 × 3.5 ÷ 每秒命中数，钳在 2%–75%），权重 4。
    /// 准入：实例元素不是这种元素、且不是元素轮转武器。
    /// 生效：本武器直接命中、敌人仍存活、且这一击没附着同种状态时，按值（斩击 × meleeHitScale，封顶 75%）掷骰，
    /// 掷中则下一帧附着该状态——强度取上一帧本武器对该敌人的合并伤害（一发霰弹 / 一次爆炸只附着一次），折算成状态强度。
    /// </summary>
    public abstract class SubElementAffix : TriggerAffixDef
    {
        public readonly Element element;
        readonly string statusName;
        readonly SubEffect effect;

        protected SubElementAffix(string id, Element element, string statusName) : base(id, 0.1f, 0.18f, 4, perHit: true)
        {
            this.element = element;
            this.statusName = statusName;
            effect = new SubEffect(element);
        }

        public override string Text(WeaponDef weapon, float v) => $"命中时 {AffixText.Pct(v)} 几率附加{statusName}";

        public override bool Allow(in AffixContext c) => c.element != element && (c.def.cycle == null || c.def.cycle.Length == 0);

        public override IAffixEffect Effect => effect;

        sealed class SubEffect : AffixEffect
        {
            readonly Element element;

            public SubEffect(Element element) => this.element = element;

            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0) || h.effects == null || !AffixEffects.Live(in e) || e.result.statusApplied == element) return;
                float k = AffixEffects.IsSlash(in e.info) ? h.stats.meleeHitScale : 1;
                if (h.effects.Random() < AffixEffects.SubChance(h.value, k)) h.effects.QueueSub(in h, e.enemy, element, e.result.total);
            }
        }
    }
}
