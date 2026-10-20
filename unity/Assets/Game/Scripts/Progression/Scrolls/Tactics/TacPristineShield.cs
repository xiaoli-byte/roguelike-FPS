namespace Spiritfire.Game
{
    /// <summary>完璧锋芒（Three.js 版 defsTactics.ts tac_pristine_shield）：护盾至少为实际上限的 95% 时，武器伤害每层 +10%；护盾上限为 0 时不生效。</summary>
    [Defs(610)]
    public sealed class TacPristineShield : ScrollDef
    {
        public const float Threshold = 0.95f;

        public TacPristineShield()
        {
            id = "tac_pristine_shield";
            name = "完璧锋芒";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "护盾", "伤害" };
            description = "护盾至少为上限的 95% 时，武器伤害每层 +10%；护盾上限为 0 时不生效。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float mult = 1 + 0.1f * n;
            s.AddOutgoing((in HitContext c) =>
            {
                if (!TacticsKit.IsWeaponHit(c.info)) return 1f;
                var h = TacticsKit.Host;
                float max = h.MaxShield;
                return max > 0 && h.Shield >= max * Threshold ? mult : 1f;
            });
        }
    }
}
