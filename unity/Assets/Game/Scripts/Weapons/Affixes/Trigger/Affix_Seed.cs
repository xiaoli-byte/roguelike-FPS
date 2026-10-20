namespace Spiritfire.Game
{
    /// <summary>
    /// 「蛊种」（TS seed）：触发类词条，权重 2，区间 0.3–0.45（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：发射非爆炸投射物的武器（弩、蛊灯、蜂群…）。
    /// 生效：本武器直接命中仍存活的敌人时种下（或刷新）蛊种 6 s；带种的敌人发生元素反应（任何来源、深度 0、不是传染出来的）时，
    /// 蛊种消失，下一帧把同一反应以 威力 × 值 强制传染给 8 m 内最近的另一名敌人（深度 +1、标签 Echo，归属种下它的枪）。传染逻辑在 <see cref="AffixEffects.OnReaction"/>。
    /// </summary>
    [Defs(280)]
    public sealed class Affix_Seed : TriggerAffixDef
    {
        public const string Id = "seed";

        public Affix_Seed() : base(Id, 0.3f, 0.45f, 2) { }

        public override string Text(WeaponDef weapon, float v) => $"命中种下蛊种：其发生元素反应时，以 {AffixText.Pct(v)} 威力传染给附近 1 名敌人";

        public override bool Allow(in AffixContext c) => c.def.projectile != null && !c.def.IsExplosive;

        public override IAffixEffect Effect => effect;

        static readonly SeedEffect effect = new();

        sealed class SeedEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (h.value > 0 && h.effects != null && AffixEffects.Live(in e))
                    h.effects.PlantSeed(e.enemy, h.value, h.weapon.uid, h.now + AffixEffects.SeedDuration);
            }
        }
    }
}
