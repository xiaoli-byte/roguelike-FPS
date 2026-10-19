using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 数值类词条的 id（同 TS AffixId 的前 15 个，docs/unity-parity.md 3.4「数值 15」）。
    /// 解析器按这些 id 把实例词条合计进数值；词条定义（文字、区间、准入）在 Weapons/Affixes/Numeric 下各自一个文件。
    /// 传说特性也存成一条词条，id 以 lg_ 开头（同 TS）。
    /// </summary>
    public static class AffixIds
    {
        public const string Dmg = "dmg", Rate = "rate", Mag = "mag", Reload = "reload", CritDmg = "critDmg", CritChance = "critChance",
            ElemChance = "elemChance", Spread = "spread", Recoil = "recoil", Pierce = "pierce", Blast = "blast", ProjSpeed = "projSpeed",
            Reserve = "reserve", Hunter = "hunter", Swift = "swift";

        /// <summary>传说特性 id 前缀</summary>
        public const string LegendaryPrefix = "lg_";

        public static bool IsLegendary(string id) => id != null && id.StartsWith(LegendaryPrefix, StringComparison.Ordinal);
    }

    /// <summary>
    /// 一把枪的实际数值（同 TS ResolvedWeapon）：定义 × 品质 × 强化 × 词条 × 玩家属性。由 <see cref="WeaponStatsResolver.Resolve"/> 产出并缓存，调用方只读不改。
    /// damage 不含玩家的伤害加成（Combat 的乘区会乘）；射速 / 弹匣 / 换弹 / 散布 / 后坐 / 弹速 / 爆炸半径 / 备弹已经计入玩家属性。
    /// 触发类词条（AF2）读 <see cref="Total"/>：同 id 的词条值之和。
    /// </summary>
    public sealed class ResolvedWeapon
    {
        public WeaponDef def;
        /// <summary>实例元素（随机元素已掷出；元素轮转武器为第一种元素）</summary>
        public Element element;
        /// <summary>单发 / 单弹丸 / 单跳伤害 = def.damage × damageMult</summary>
        public float damage;
        /// <summary>本武器伤害倍率 = 品质倍率 × (1 + 0.12 × 强化) × (1 + 伤害词条)</summary>
        public float damageMult = 1;
        /// <summary>每秒射击次数（点射为每秒轮数、光束为每秒跳数）与相对定义的倍率（点射间隔、机炮预热、蓄力用）</summary>
        public float fireRate, fireRateMult = 1;
        public int magCap = 1, reserveCap;
        /// <summary>整匣换弹时间；逐发装填：每发耗时、开始前准备（都已除以换弹速度）</summary>
        public float reloadTime = 1, shellTime, reloadStart;
        /// <summary>散布倍率（乘在锥角上，下限 0.1）、后坐倍率（下限 0）</summary>
        public float spreadMult = 1, recoilMult = 1;
        /// <summary>暴击倍率（定义 × (1 + 暴伤词条)）；词条额外暴击率（武器自己掷，掷中设 forceCrit）</summary>
        public float critMult = 2, critChance;
        /// <summary>每次命中的元素附着几率（实例无元素 = 0；上限 1）</summary>
        public float elementChance;
        public int pierce;
        /// <summary>弹速倍率；投射物实际初速（无投射物为 0）</summary>
        public float projSpeedMult = 1, projectileSpeed;
        /// <summary>爆炸半径（已乘玩家爆炸范围与词条；不爆炸为 0）；玩家爆炸范围倍率（特性爆炸用）</summary>
        public float explosionRadius, blastMult = 1;
        /// <summary>「猎首」对首领与精英的伤害加成；「轻盈」持握时移速加成</summary>
        public float hunter, swift;
        /// <summary>传说特性 id（lg_…）与数值；没有为 null / 0</summary>
        public string legendary;
        public float legendaryValue;
        /// <summary>每次扣扳机的总伤害（弹丸 × 弹体）与理论秒伤（不含换弹；蓄力按每发满蓄；碎刃为千刃出窍的单体秒伤）</summary>
        public float perShot, dps;
        /// <summary>碎刃三段斩的单体理论秒伤；斩击的每次命中几率归一系数（钳在 0.5–3，普通武器 1）</summary>
        public float meleeDps, meleeHitScale = 1;

        internal readonly Dictionary<string, float> totals = new();
        internal StatSheet kStats;
        internal int kStatsVersion = int.MinValue, kVersion = int.MinValue, kAffixes = -1;

        /// <summary>某个词条（非传说）在这把枪上的合计值；没有为 0</summary>
        public float Total(string id) => id != null && totals.TryGetValue(id, out var v) ? v : 0;

        /// <summary>全部词条合计（id → 值，不含传说）</summary>
        public IReadOnlyDictionary<string, float> Totals => totals;
    }

    /// <summary>
    /// 武器数值合成（同 TS src/weapons/WeaponStats.ts 的 resolveWeapon）。结果缓存在实例上，
    /// 键 = 属性表（引用 + <see cref="StatSheet.Version"/>）+ <see cref="WeaponInstance.Version"/> + 词条数，热路径可以每帧调。
    /// stats 为 null 时按「没有任何加成」算（编辑器工具、测试）。
    /// 公式（t = 同 id 词条之和）：
    ///   伤害倍率 = 品质 × (1 + 0.12 × 强化) × (1 + t.dmg)；射速 = 定义 × 射速% × (1 + t.rate)；
    ///   弹匣 = round(定义 × 弹匣% × (1 + t.mag))（碎刃不变）；备弹 = round(定义 × 备弹% × (1 + t.reserve))；
    ///   换弹时间 = 定义 ÷ max(0.25, 1 + 换弹速度 + t.reload)；散布 = max(0.1, (1 + 散布%) × (1 − t.spread))；后坐 = max(0, (1 + 后坐%) × (1 − t.recoil))；
    ///   暴击倍率 = 定义 × (1 + t.critDmg)；元素率 = 无元素 0，否则 min(1, 定义 + t.elemChance)；穿透 = 定义 + round(t.pierce)；
    ///   弹速 = 弹速% × (1 + t.projSpeed)；爆炸半径 = 定义 × 爆炸范围% × (1 + t.blast)。
    /// round 是 TS 的 Math.round（.5 进位），不是 Mathf.RoundToInt 的银行家舍入。
    /// </summary>
    public static class WeaponStatsResolver
    {
        public const float MinReloadMult = 0.25f, MinSpreadMult = 0.1f;

        /// <summary>玩家当前属性表（没有玩家时 null）</summary>
        public static StatSheet PlayerStats => PlayerVitals.Instance ? PlayerVitals.Instance.stats : null;

        /// <summary>按玩家当前属性解析</summary>
        public static ResolvedWeapon Resolve(WeaponInstance inst) => Resolve(inst, PlayerStats);

        /// <summary>取实例的实际数值（带缓存）。inst 为 null 时返回 null</summary>
        public static ResolvedWeapon Resolve(WeaponInstance inst, StatSheet stats)
        {
            if (inst == null) return null;
            var r = inst.resolved;
            if (r == null || r.def != inst.def) inst.resolved = r = new ResolvedWeapon { def = inst.def };
            int sv = stats?.Version ?? -1;
            if (r.kStats == stats && r.kStatsVersion == sv && r.kVersion == inst.Version && r.kAffixes == inst.affixes.Count) return r;
            Compute(inst, stats, r);
            r.kStats = stats;
            r.kStatsVersion = sv;
            r.kVersion = inst.Version;
            r.kAffixes = inst.affixes.Count;
            return r;
        }

        /// <summary>TS Math.round：.5 向上取整</summary>
        public static int RoundHalfUp(float v) => Mathf.FloorToInt(v + 0.5f);

        static float Get(StatSheet s, Stat stat) => s != null ? s.Get(stat) : 0;
        static float Mult(StatSheet s, Stat stat) => s != null ? s.Mult(stat) : 1;

        static void Compute(WeaponInstance inst, StatSheet stats, ResolvedWeapon r)
        {
            var def = inst.def;
            var t = r.totals;
            t.Clear();
            r.legendary = null;
            r.legendaryValue = 0;
            foreach (var a in inst.affixes)
            {
                if (string.IsNullOrEmpty(a.id)) continue;
                if (AffixIds.IsLegendary(a.id))
                {
                    r.legendary = a.id;
                    r.legendaryValue = a.value;
                }
                else t[a.id] = (t.TryGetValue(a.id, out var v) ? v : 0) + a.value;
            }

            r.def = def;
            r.element = inst.element;
            r.damageMult = WeaponLibrary.RarityDamage[Rarity.Clamp(inst.rarity)] * (1 + WeaponLibrary.UpgradeStep * inst.level) * (1 + r.Total(AffixIds.Dmg));
            r.damage = def.damage * r.damageMult;
            r.fireRateMult = Mult(stats, Stat.FireRatePct) * (1 + r.Total(AffixIds.Rate));
            r.fireRate = def.fireRate * r.fireRateMult;
            // 碎刃的每一格是一发实体刀片：容量加成不能合并或跳过格子
            r.magCap = def.IsBlade ? def.mag : Mathf.Max(1, RoundHalfUp(def.mag * Mult(stats, Stat.MagPct) * (1 + r.Total(AffixIds.Mag))));
            r.reserveCap = Mathf.Max(0, RoundHalfUp(def.reserve * Mult(stats, Stat.AmmoReservePct) * (1 + r.Total(AffixIds.Reserve))));
            float reloadMult = Mathf.Max(MinReloadMult, 1 + Get(stats, Stat.ReloadSpeedPct) + r.Total(AffixIds.Reload));
            r.reloadTime = def.reloadTime / reloadMult;
            r.shellTime = def.shellTime / reloadMult;
            r.reloadStart = def.reloadStart / reloadMult;
            r.spreadMult = Mathf.Max(MinSpreadMult, (1 + Get(stats, Stat.SpreadPct)) * (1 - r.Total(AffixIds.Spread)));
            r.recoilMult = Mathf.Max(0, (1 + Get(stats, Stat.RecoilPct)) * (1 - r.Total(AffixIds.Recoil)));
            r.critMult = def.critMult * (1 + r.Total(AffixIds.CritDmg));
            r.critChance = r.Total(AffixIds.CritChance);
            r.elementChance = inst.element == Element.None ? 0 : Mathf.Min(1, def.elementChance + r.Total(AffixIds.ElemChance));
            r.pierce = def.pierce + RoundHalfUp(r.Total(AffixIds.Pierce));
            r.projSpeedMult = Mult(stats, Stat.ProjectileSpeedPct) * (1 + r.Total(AffixIds.ProjSpeed));
            r.projectileSpeed = def.projectile != null ? def.projectile.speed * r.projSpeedMult : 0;
            r.blastMult = Mult(stats, Stat.ExplosionRadiusPct);
            r.explosionRadius = def.IsExplosive ? def.projectile.explosionRadius * r.blastMult * (1 + r.Total(AffixIds.Blast)) : 0;
            r.hunter = r.Total(AffixIds.Hunter);
            r.swift = r.Total(AffixIds.Swift);

            r.perShot = r.damage * def.HitsPerShot;
            // 蓄力武器：每发满蓄 = 蓄力时长（随射速加成缩短）+ 松手冷却
            r.dps = def.mode == FireMode.Charge
                ? r.perShot / (1 / Mathf.Max(0.01f, r.fireRate) + def.chargeTime / Mathf.Max(0.01f, r.fireRateMult))
                : r.perShot * def.ShotsPerSecond(r.fireRate);
            var blade = def.blade;
            float cycle = def.ComboCycleTime;
            if (blade != null && blade.combo.Length > 0 && cycle > 0)
            {
                float sum = 0;
                foreach (var seg in blade.combo) sum += seg.damage;
                r.meleeDps = sum * r.damageMult / (cycle / Mathf.Max(0.01f, r.fireRateMult));
                r.meleeHitScale = Mathf.Clamp(def.ShotsPerSecond() * def.HitsPerShot / (blade.combo.Length / cycle), 0.5f, 3f);
            }
            else
            {
                r.meleeDps = 0;
                r.meleeHitScale = 1;
            }
        }
    }
}
