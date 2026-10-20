namespace Spiritfire.Game
{
    /// <summary>乘隙追击（Three.js 版 defsTactics.ts tac_stagger_hunter）：对仍处于眩晕或减速状态（剩余时间 &gt; 0）的敌人，武器伤害每层 +12%。</summary>
    [Defs(617)]
    public sealed class TacStaggerHunter : ScrollDef
    {
        public TacStaggerHunter()
        {
            id = "tac_stagger_hunter";
            name = "乘隙追击";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "控制", "伤害" };
            description = "对处于眩晕或减速状态的敌人，武器伤害每层 +12%。";
        }

        /// <summary>敌人此刻被眩晕或减速（状态仍有剩余时间）</summary>
        public static bool Staggered(Damageable d) =>
            d && ((EnemyStatus.TryGet(d, StatusId.Stun, out var stun) && stun.remaining > 0) ||
                  (EnemyStatus.TryGet(d, StatusId.Slow, out var slow) && slow.remaining > 0));

        public override void Install(ScrollScope s, int n)
        {
            float mult = 1 + 0.12f * n;
            s.AddOutgoing((in HitContext c) => TacticsKit.IsWeaponHit(c.info) && Staggered(c.target) ? mult : 1f);
        }
    }
}
