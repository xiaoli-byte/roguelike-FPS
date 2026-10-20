namespace Spiritfire.Game
{
    /// <summary>
    /// 「击杀回填」（TS killRefill）：触发类词条，权重 6，区间 0.12–0.25（精良基准，稀有 ×1.15 / 史诗 ×1.3 / 传说 ×1.45）。
    /// 准入：有弹匣的枪（碎刃除外）。
    /// 生效：本武器直接击杀（深度 0，含武器投射物的爆炸）时回填 max(1, round(弹匣容量 × 值)) 发，不超过容量。
    /// </summary>
    [Defs(100)]
    public sealed class Affix_KillRefill : TriggerAffixDef
    {
        public const string Id = "killRefill";

        public Affix_KillRefill() : base(Id, 0.12f, 0.25f, 6) { }

        public override string Text(WeaponDef weapon, float v) => $"击杀时回填 {AffixText.Pct(v)} 弹匣";

        public override bool Allow(in AffixContext c) => AffixRules.GunOnly(c.def);

        public override IAffixEffect Effect => effect;

        static readonly KillRefillEffect effect = new();

        /// <summary>回填发数：max(1, round(容量 × 比例))</summary>
        public static int Rounds(int magCap, float fraction) => UnityEngine.Mathf.Max(1, WeaponStatsResolver.RoundHalfUp(magCap * fraction));

        sealed class KillRefillEffect : AffixEffect
        {
            public override void OnKill(in AffixHook h, in KillEvent e)
            {
                if (h.value > 0 && h.effects != null && e.info.depth == 0) h.effects.Env.Refill(h.weapon, Rounds(h.stats.magCap, h.value));
            }
        }
    }
}
