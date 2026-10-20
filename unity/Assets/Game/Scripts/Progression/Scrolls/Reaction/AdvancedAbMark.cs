namespace Spiritfire.Game
{
    /// <summary>
    /// 三才印（Three.js 版 defsReaction.ts rx_ab_mark）：武器直接命中恰好身负两种元素状态、这一击没打死的敌人时，每层 12% 概率补上第三种（引发「归墟」）。
    /// 全局 0.1 s 内置冷却在概率之前；附着沿用这一击的深度 0（直接反应）。
    /// </summary>
    [Defs(514)]
    public sealed class RxAbMark : ScrollDef
    {
        public RxAbMark()
        {
            id = "rx_ab_mark";
            name = "三才印";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "反应", "归墟", "命中" };
            description = "武器命中恰好身负两种元素状态的敌人时，每层 12% 概率补上第三种（引发「归墟」）。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float chance = 0.12f * n;
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var d = e.enemy;
                if (!ReactionScrollKit.IsWeaponReq(e.info) || e.info.depth != 0 || e.result.killed || !d || d.Dead) return;
                var h = TacticsKit.Host;
                if (ReactionScrollKit.StatusCount(h, d) != 2 || !s.Ready("m", 0.1f) || !h.Chance(chance)) return;
                var missing = ReactionScrollKit.FirstMissing(h, d);
                if (missing == Element.None) return;
                h.ApplyStatus(d, missing, ReactionScrollKit.StatusPower(d, missing, e.result.total),
                    new StatusApplyOpts { depth = 0, weaponUid = e.info.weaponUid });
                s.Proc();
            });
        }
    }
}
