using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>词条种类：数值（AF1，解析器直接合计）/ 触发（AF2，命中 / 击杀 / 反应时生效）/ 传说特性（AF3，id 以 lg_ 开头）</summary>
    public enum AffixKind { Numeric, Trigger, Legendary }

    /// <summary>准入判断的上下文：武器定义、实例元素、本次已经抽到的词条 id（含固有词条，每抽一条都会更新后重新过滤）</summary>
    public readonly struct AffixContext
    {
        public readonly WeaponDef def;
        public readonly Element element;
        public readonly IReadOnlyList<string> picked;

        public AffixContext(WeaponDef def, Element element, IReadOnlyList<string> picked)
        {
            this.def = def;
            this.element = element;
            this.picked = picked ?? Array.Empty<string>();
        }

        public bool Has(string id)
        {
            foreach (var p in picked)
                if (p == id) return true;
            return false;
        }

        public bool HasPrefix(string prefix)
        {
            foreach (var p in picked)
                if (p != null && p.StartsWith(prefix, StringComparison.Ordinal)) return true;
            return false;
        }
    }

    /// <summary>
    /// 一条词条的定义（同 TS src/weapons/Affixes.ts 的 AffixDef）。每条一个文件，带 [Defs(order)] 由 <see cref="Registry{T}"/> 收集：
    ///   数值 15 条 Weapons/Affixes/Numeric/Affix_&lt;Id&gt;.cs（AF1）· 触发 14 条 Weapons/Affixes/Trigger/（AF2）· 传说 10 条 Weapons/Legendaries/（AF3，继承 <see cref="LegendaryDef"/>）。
    /// order 约定 = TS AFFIXES 里的下标 × 10（dmg 0 … swift 180、subFire 190 … seed 280），传说从 1000 起：注册表顺序与 TS 一致，加权抽取可以逐条对照。
    /// 数值区间是精良基准，更高稀有度按 <see cref="AffixRules.RarityScale"/> 放大（isFixed 的不放大）；perHit 类区间是原始值，抽取时归一成每次命中几率。
    /// 数值词条的生效在 <see cref="WeaponStatsResolver"/>（按 id 合计）；触发 / 传说的生效挂在 <see cref="Effect"/> 上。
    /// </summary>
    public abstract class AffixDef : IDef
    {
        public readonly string id;
        /// <summary>精良基准的数值区间</summary>
        public readonly float min, max;
        /// <summary>抽取权重（同池内相对）</summary>
        public readonly float weight;
        /// <summary>固定数值（如穿透 +1）：不随稀有度放大，取 min</summary>
        public readonly bool isFixed;
        /// <summary>「命中时几率附加」类：区间是原始值 raw（约每秒附着 raw × 3.5 次），抽取时乘稀有度后按每秒命中数归一（<see cref="AffixRules.PerHitChance"/>）</summary>
        public readonly bool perHit;

        string IDef.Id => id;

        protected AffixDef(string id, float min, float max, float weight, bool isFixed = false, bool perHit = false)
        {
            this.id = id;
            this.min = min;
            this.max = max;
            this.weight = weight;
            this.isFixed = isFixed;
            this.perHit = perHit;
        }

        public virtual AffixKind Kind => AffixKind.Numeric;

        /// <summary>中文描述（不含传说前缀，前缀由 <see cref="AffixText"/> 加）。weapon 可能为 null</summary>
        public abstract string Text(WeaponDef weapon, float value);

        /// <summary>能否出现在这把武器上（准入：gunOnly / directHit / canReact / isExplosive…）</summary>
        public virtual bool Allow(in AffixContext c) => true;

        /// <summary>掷出的值取整（同 TS roundValue）：固定 → min；perHit → 两位小数且不低于 2%；其余两位小数</summary>
        public virtual float Round(float v)
        {
            if (isFixed) return min;
            float r = WeaponStatsResolver.RoundHalfUp(v * 100) / 100f;
            return perHit ? Mathf.Max(AffixRules.PerHitMin, r) : r;
        }

        /// <summary>触发 / 传说效果；数值词条为 null（大多数），或带输出修饰（猎首）</summary>
        public virtual IAffixEffect Effect => null;

        public override string ToString() => id;
    }

    /// <summary>
    /// 传说特性（同 TS LegendaryDef）：rarity = 传说时在普通词条之后另抽一条（各特性等概率），数值由武器决定、不随稀有度放大。
    /// 名字用作武器名前缀「天命·赤铜左轮」，描述加「【传说·天命】」前缀（<see cref="AffixText"/>）。AF3 实现各特性。
    /// </summary>
    public abstract class LegendaryDef : AffixDef
    {
        /// <summary>特性名（两个字）</summary>
        public readonly string name;

        protected LegendaryDef(string id, string name) : base(id, 0, 0, 1)
        {
            this.name = name;
        }

        public override AffixKind Kind => AffixKind.Legendary;

        /// <summary>特性数值（第 N 发、概率…），只取决于武器定义</summary>
        public abstract float Value(WeaponDef weapon);

        public override float Round(float v) => v;
    }

    /// <summary>
    /// 词条效果的挂点（AF2 触发词条、AF3 传说特性实现；AF1 只有「猎首」用 Modifier）。同一把枪上同 id 的词条只派发一次，值取合计。
    ///   OnFire —— 每次扣扳机 / 每跳，扣弹之前（天命计数、无尽、终焉），由 <see cref="WeaponRuntime.BeginShot"/> 同步派发；
    ///   FireRate —— 射速倍率（疾化、狂热），状态机每帧乘在实际射速上（<see cref="WeaponRuntime.RateMult"/>），1 = 不变；
    ///   OnHit / OnKill / OnReaction —— 本武器（weaponUid）的直接命中（深度 0）/ 击杀 / 引发的反应，由 <see cref="AffixEffects"/> 派发：
    ///     这里只做判定、记状态，要再造成伤害 / 挂状态的一律调 h.effects.Queue*（下一帧执行，避开伤害结算的重入），同帧对同一敌人的伤害合并成附着强度；
    ///   Modifier —— <see cref="Combat.Outgoing"/> 输出倍率（暴击掷骰之后），由 <see cref="AffixRuntime"/> 对带 weaponUid 的伤害派发，1 = 不变。
    /// 实现时继承 <see cref="AffixEffect"/>，只覆盖用得到的。
    /// </summary>
    public interface IAffixEffect
    {
        void OnFire(in AffixHook h, ref FireShot s);
        float FireRate(in AffixHook h);
        void OnHit(in AffixHook h, in HitEvent e);
        void OnKill(in AffixHook h, in KillEvent e);
        void OnReaction(in AffixHook h, in ReactionEvent e);
        float Modifier(in AffixHook h, in HitContext c);
    }

    /// <summary><see cref="IAffixEffect"/> 的空实现基类</summary>
    public abstract class AffixEffect : IAffixEffect
    {
        public virtual void OnFire(in AffixHook h, ref FireShot s) { }
        public virtual float FireRate(in AffixHook h) => 1;
        public virtual void OnHit(in AffixHook h, in HitEvent e) { }
        public virtual void OnKill(in AffixHook h, in KillEvent e) { }
        public virtual void OnReaction(in AffixHook h, in ReactionEvent e) { }
        public virtual float Modifier(in AffixHook h, in HitContext c) => 1;
    }

    /// <summary>
    /// 一次射击在扣弹之前的判定（<see cref="IAffixEffect.OnFire"/> 读写）：无限弹药、免耗、扣弹前的弹匣、累计发数（含本发）、强制暴击、伤害倍率。
    /// 光束每跳、点射每发、齐射每轮各算一次（同 TS shoot）。
    /// </summary>
    public struct FireShot
    {
        /// <summary>无限弹药：本发本来就不扣</summary>
        public bool infinite;
        /// <summary>本发不消耗弹药（「无尽」掷中）</summary>
        public bool free;
        /// <summary>扣弹之前的弹匣</summary>
        public int magBefore;
        /// <summary>这把枪累计射击次数（含本发；「天命」按它数第 N 发）</summary>
        public int shots;
        public bool forceCrit;
        /// <summary>本发伤害倍率（乘在开火模式给的倍率上），初始 1</summary>
        public float mult;

        /// <summary>本发会扣一发弹药</summary>
        public readonly bool Consumed => !infinite && !free;
        /// <summary>弹匣最后一发（会扣弹、扣之前只剩 1 发）：同一把枪先结算的效果判了免耗时就不算</summary>
        public readonly bool Last => Consumed && magBefore == 1;
    }

    /// <summary>
    /// 派发给词条效果的那把枪：实例、实际数值、这条词条在这把枪上的合计值（传说为特性数值）、派发器与当前时间。
    /// effects 在命中 / 击杀 / 反应时非空（排队触发、读环境）；开火 / 射速 / 输出修饰时可能为 null。
    /// </summary>
    public readonly struct AffixHook
    {
        public readonly WeaponInstance weapon;
        public readonly ResolvedWeapon stats;
        public readonly float value;
        public readonly AffixEffects effects;
        /// <summary>派发时刻（游戏时间，秒）</summary>
        public readonly float now;

        public AffixHook(WeaponInstance weapon, ResolvedWeapon stats, float value, AffixEffects effects = null, float now = 0)
        {
            this.weapon = weapon;
            this.stats = stats;
            this.value = value;
            this.effects = effects;
            this.now = now;
        }

        /// <summary>这把枪的运行时状态（内置冷却、层数）</summary>
        public WeaponRuntime Runtime => WeaponRuntime.Of(weapon);
    }

    /// <summary>
    /// 准入与数值规则（同 TS Affixes.ts 的 gunOnly / directHit / canReact / hps / perHitChance / rarityScale / AFFIX_COUNT）
    /// </summary>
    public static class AffixRules
    {
        /// <summary>各稀有度的词条数：普通 0 / 精良 1 / 稀有 1 / 史诗 2 / 传说 3（+1 传说特性）；固有词条另计</summary>
        public static readonly int[] Count = { 0, 1, 1, 2, 3 };
        /// <summary>副元素归一化基数：每秒附着约 raw × 3.5 次</summary>
        public const float PerHitBase = 3.5f;
        public const float PerHitMin = 0.02f, PerHitMax = 0.75f;

        public static int CountFor(int rarity) => Count[Rarity.Clamp(rarity)];

        /// <summary>按稀有度放大：精良 ×1，稀有 ×1.15，史诗 ×1.3，传说 ×1.45（普通按 ×1）</summary>
        public static float RarityScale(int rarity) => 1 + 0.15f * Mathf.Max(0, rarity - 1);

        /// <summary>碎刃没有弹匣 / 换弹 / 散布 / 后坐 / 穿透 / 爆头，这些词条不出现在它身上</summary>
        public static bool GunOnly(WeaponDef d) => !d.IsBlade;

        /// <summary>命中扫描（不含光束）或弩：可以穿透 / 弹射 / 爆头</summary>
        public static bool DirectHit(WeaponDef d) => d.IsHitscan || d.kind == WeaponKind.Crossbow;

        /// <summary>这把武器自己能否引发元素反应：带元素 / 元素轮转 / 满蓄引爆 / 已抽到副元素词条</summary>
        public static bool CanReact(in AffixContext c) =>
            c.element != Element.None || (c.def.cycle != null && c.def.cycle.Length > 0) || c.def.chargeDetonate || c.HasPrefix("sub");

        /// <summary>每秒命中数（蓄力武器按「射击冷却 + 满蓄时间」算一发）</summary>
        public static float HitsPerSecond(WeaponDef d)
        {
            float sps = d.mode == FireMode.Charge ? 1 / (1 / Mathf.Max(0.01f, d.fireRate) + d.chargeTime) : d.ShotsPerSecond();
            return sps * d.HitsPerShot;
        }

        /// <summary>原始值 → 每次命中几率（与射速无关），钳在 [2%, 75%]</summary>
        public static float PerHitChance(WeaponDef d, float raw) =>
            Mathf.Clamp(raw * PerHitBase / Mathf.Max(0.01f, HitsPerSecond(d)), PerHitMin, PerHitMax);
    }

    /// <summary>词条注册表门面：全部词条（含传说）、按种类分好的抽取池</summary>
    public static class AffixLibrary
    {
        public static IReadOnlyList<AffixDef> All => Registry<AffixDef>.All;

        public static AffixDef Get(string id) => Registry<AffixDef>.Get(id);

        /// <summary>普通词条池（数值 + 触发，不含传说），按注册顺序</summary>
        public static List<AffixDef> Rollable()
        {
            var l = new List<AffixDef>();
            foreach (var a in All)
                if (a.Kind != AffixKind.Legendary) l.Add(a);
            return l;
        }

        /// <summary>传说特性池</summary>
        public static List<LegendaryDef> Legendaries()
        {
            var l = new List<LegendaryDef>();
            foreach (var a in All)
                if (a is LegendaryDef lg) l.Add(lg);
            return l;
        }

        public static bool IsLegendary(string id) => Get(id) is LegendaryDef || AffixIds.IsLegendary(id);
    }
}
