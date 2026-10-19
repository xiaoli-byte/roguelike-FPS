using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 为一把武器抽词条（同 TS rollAffixes）。结果顺序：固有词条（def.innate 原样：不占名额、不随稀有度放大、同 id 不会再抽到）
    /// → 按抽取顺序的普通词条 → 传说特性（只有传说品质，各特性等概率）。
    /// 每抽一条都按「已抽到的 id」重新过滤一次池子（抽到副元素词条后会解锁「化合」等反应类词条）。
    /// 数值：精良基准区间里均匀取值 × 稀有度放大（固定词条不放大）；perHit 类再归一成每次命中几率；最后按词条的规则取整。
    /// </summary>
    public static class AffixRoll
    {
        /// <summary>用注册表里的全部词条抽（<see cref="WeaponRoller.Roll(in WeaponRoller.RollOptions, System.Random)"/> 调它）</summary>
        public static List<WeaponAffix> Roll(WeaponDef def, int rarity, Element element, System.Random rng = null) =>
            Roll(def, rarity, element, rng, AffixLibrary.Rollable(), AffixLibrary.Legendaries());

        /// <summary>指定词条池抽（测试、特殊掉落）</summary>
        public static List<WeaponAffix> Roll(WeaponDef def, int rarity, Element element, System.Random rng,
            IReadOnlyList<AffixDef> pool, IReadOnlyList<LegendaryDef> legendaries)
        {
            rng ??= WeaponRoller.Rng;
            var result = new List<WeaponAffix>();
            var picked = new List<string>();
            if (def.innate != null)
                foreach (var a in def.innate)
                {
                    result.Add(a);
                    picked.Add(a.id);
                }
            int count = AffixRules.CountFor(rarity);
            float scale = AffixRules.RarityScale(rarity);
            var candidates = new List<AffixDef>();
            for (int i = 0; i < count; i++)
            {
                candidates.Clear();
                var ctx = new AffixContext(def, element, picked);
                if (pool != null)
                    foreach (var a in pool)
                        if (a != null && a.Kind != AffixKind.Legendary && !picked.Contains(a.id) && a.Allow(ctx)) candidates.Add(a);
                if (candidates.Count == 0) break;
                var pick = WeaponRoller.Weighted(candidates, x => x.weight, rng);
                picked.Add(pick.id);
                float v = WeaponRoller.Range(rng, pick.min, pick.max) * (pick.isFixed ? 1 : scale);
                if (pick.perHit) v = AffixRules.PerHitChance(def, v);
                result.Add(new WeaponAffix(pick.id, pick.Round(v)));
            }
            if (rarity >= Rarity.Legendary && legendaries != null)
            {
                var ctx = new AffixContext(def, element, picked);
                var allowed = new List<LegendaryDef>();
                foreach (var l in legendaries)
                    if (l != null && l.Allow(ctx)) allowed.Add(l);
                if (allowed.Count > 0)
                {
                    var l = allowed[rng.Next(allowed.Count)];
                    result.Add(new WeaponAffix(l.id, l.Value(def)));
                }
            }
            return result;
        }
    }
}
