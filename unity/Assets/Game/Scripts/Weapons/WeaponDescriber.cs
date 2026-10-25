using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一行武器属性（「伤害」「23 ×8」）</summary>
    public readonly struct WeaponStatLine
    {
        public readonly string label, value;

        public WeaponStatLine(string label, string value)
        {
            this.label = label;
            this.value = value;
        }

        public override string ToString() => $"{label}  {value}";
    }

    /// <summary>武器技能（碎刃的杀气爆发；同 TS WeaponDescription.skill）</summary>
    public sealed class WeaponSkillText
    {
        public string name, key, description;
        public float cooldown;
    }

    /// <summary>
    /// 一把枪的中文描述（同 TS core/types WeaponDescription）：名字（传说前缀，不含 +N）、类别、品质、颜色、元素、属性行、特性行、武器技能。
    /// 由 <see cref="WeaponDescriber.Describe(WeaponInstance, StatSheet)"/> 产出并缓存，调用方只读不改。
    /// </summary>
    public sealed class WeaponDescription
    {
        public string name, category, rarityName;
        public int rarity;
        public Color color;
        public Element element;
        /// <summary>元素轮转武器的元素标签（「三相」）；普通武器为 null</summary>
        public string elementLabel;
        public readonly List<WeaponStatLine> stats = new();
        public readonly List<string> traits = new();
        /// <summary>武器技能（只有碎刃有）</summary>
        public WeaponSkillText skill;

        /// <summary>某项属性的值（没有为 null）</summary>
        public string Stat(string label)
        {
            foreach (var s in stats)
                if (s.label == label) return s.value;
            return null;
        }
    }

    /// <summary>
    /// 武器描述与对比（docs/unity-parity.md WC8；同 Three.js src/weapons/Describe.ts + src/progression/loot/weaponPrompt.ts），全部简体中文：
    ///   · <see cref="Describe(WeaponInstance, StatSheet)"/>：伤害显示武器自身数值（稀有度 × 强化 × 词条），不含玩家的武器伤害加成；
    ///     射速 / 弹匣 / 换弹等计入玩家属性后的实际值（<see cref="WeaponStatsResolver"/>）。蓄力武器显示伤害区间、蓄力时长与满蓄秒伤；
    ///     元素轮转武器的元素行写「三相轮转」并给出 elementLabel；碎刃列出斩、千刃出窍、刃气、屏障与武器技能。
    ///   · <see cref="Prompt"/>：拾取 / 购买提示卡——名称、副标题「拾取 · 稀有 · 霰弹枪 · 灼烧 · 强化 +1」、逐项对比手上那把：
    ///     同一项两边格式一致（第一个数字之外的部分相同）时标 ▲（更好）/ ▼（更差），提示卡据此把整行染绿 / 红；「换弹」越小越好；
    ///     「强化」已写在副标题里不单列，「元素」为物理时不列；特性行前加 ◆；最后一行写替换哪把或放进空槽。
    /// 结果按「解析数值的缓存键」缓存（实例版本、玩家属性版本），交互提示每帧取也不分配。
    /// </summary>
    public static class WeaponDescriber
    {
        /// <summary>元素名（同 TS ELEMENT_NAMES）</summary>
        public static string ElementName(Element e) => e switch
        {
            Element.Fire => "灼烧",
            Element.Shock => "雷殛",
            Element.Corrode => "蚀化",
            _ => "物理",
        };

        /// <summary>数值越小越好的属性</summary>
        static readonly HashSet<string> LowerIsBetter = new() { "换弹" };
        /// <summary>提示卡里不单列的属性（写在副标题里）</summary>
        static readonly HashSet<string> Skip = new() { "强化" };
        static readonly Regex NumRe = new(@"-?\d+(?:\.\d+)?", RegexOptions.CultureInvariant);

        // ───────────── 数字格式（同 TS Describe.ts）─────────────

        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>TS pct：0.123 → "12%"（.5 进位）</summary>
        public static string Pct(float v) => $"{WeaponStatsResolver.RoundHalfUp(v * 100)}%";

        /// <summary>TS num：≥ 10 取整，否则保留一位小数（去掉末尾的 .0）</summary>
        public static string Num(float v)
        {
            if (v >= 10) return WeaponStatsResolver.RoundHalfUp(v).ToString(Inv);
            return (WeaponStatsResolver.RoundHalfUp(v * 10) / 10f).ToString("0.#", Inv);
        }

        static string F1(float v) => v.ToString("0.0", Inv);
        static string F2(float v) => v.ToString("0.00", Inv);
        static string Round(float v) => WeaponStatsResolver.RoundHalfUp(v).ToString(Inv);

        /// <summary>武器技能按键（碎刃特性行里写的；缺省取键位表里 WeaponSkill 的绑定，取不到写 V）</summary>
        public static string SkillKey
        {
            get
            {
                try
                {
                    var k = HudArt.Key(Spiritfire.Art.GameAction.WeaponSkill);
                    return string.IsNullOrEmpty(k) || k == nameof(Spiritfire.Art.GameAction.WeaponSkill) ? "V" : k;
                }
                catch (Exception)
                {
                    return "V";
                }
            }
        }

        // ───────────── 描述 ─────────────

        sealed class Cached
        {
            public ResolvedWeapon r;
            public StatSheet stats;
            public int statsVersion, version, affixes;
            public WeaponDescription desc;
        }

        static readonly ConditionalWeakTable<WeaponInstance, Cached> cache = new();

        /// <summary>按玩家当前属性描述（没有玩家时按无加成）</summary>
        public static WeaponDescription Describe(WeaponInstance inst) => Describe(inst, WeaponStatsResolver.PlayerStats);

        /// <summary>描述一把枪（带缓存：实例或属性表变了才重建）；inst 为 null 返回 null</summary>
        public static WeaponDescription Describe(WeaponInstance inst, StatSheet stats)
        {
            if (inst?.def == null) return null;
            var r = WeaponStatsResolver.Resolve(inst, stats);
            int sv = stats?.Version ?? -1;
            if (cache.TryGetValue(inst, out var c) && c.r == r && c.stats == stats && c.statsVersion == sv && c.version == inst.Version && c.affixes == inst.affixes.Count)
                return c.desc;
            var desc = Build(inst, r);
            if (c == null)
            {
                c = new Cached();
                cache.Add(inst, c);
            }
            c.r = r;
            c.stats = stats;
            c.statsVersion = sv;
            c.version = inst.Version;
            c.affixes = inst.affixes.Count;
            c.desc = desc;
            return desc;
        }

        /// <summary>不缓存：直接按给定的解析结果写描述（测试用）</summary>
        public static WeaponDescription Build(WeaponInstance inst, ResolvedWeapon r)
        {
            if (inst.def.IsBlade) return DescribeBlade(inst, r);
            var def = inst.def;
            int count = def.projectile != null ? def.projectile.count : 1;
            var d = Header(inst);
            var stats = d.stats;

            bool charge = def.mode == FireMode.Charge;
            string dmg;
            if (charge) dmg = $"{Num(r.damage * def.chargeMinMult)}–{Num(r.damage)}";
            else
            {
                dmg = Num(r.damage);
                if (def.pellets > 1) dmg += $" ×{def.pellets}";
                else if (count > 1) dmg += $" ×{count}";
                else if (def.mode == FireMode.Beam) dmg += " /跳";
            }
            stats.Add(new WeaponStatLine("伤害", dmg));
            if (r.explosionRadius > 0) stats.Add(new WeaponStatLine("爆炸范围", $"{F1(r.explosionRadius)} 米"));

            // 蓄力时长随射速加成缩短（与蓄力速度一致）
            float chargeSec = charge ? def.chargeTime / Mathf.Max(0.01f, r.fireRateMult) : 0;
            string rate;
            if (def.mode == FireMode.Burst) rate = $"{F1(r.fireRate)} 轮/秒（{def.burstCount} 连发）";
            else if (def.mode == FireMode.Beam) rate = $"{Round(r.fireRate)} 跳/秒";
            else if (charge) rate = $"蓄力 {F2(chargeSec)} 秒";
            else if (count > 1) rate = $"{F2(r.fireRate)} 轮/秒";
            else rate = $"{F1(r.fireRate)} 发/秒";
            stats.Add(new WeaponStatLine("射速", rate));
            // 蓄力武器的理论秒伤（每发满蓄 = 蓄力时长 + 松手冷却）已在解析器里按蓄力算
            stats.Add(new WeaponStatLine("秒伤", $"约 {Round(r.dps)}"));
            stats.Add(new WeaponStatLine("弹匣", def.mode == FireMode.Beam ? $"{r.magCap} 能量" : r.magCap.ToString(Inv)));
            stats.Add(new WeaponStatLine("备弹", r.reserveCap.ToString(Inv)));
            stats.Add(new WeaponStatLine("换弹", def.shellTime > 0 ? $"{F2(r.shellTime)} 秒/发" : $"{F1(r.reloadTime)} 秒"));
            stats.Add(new WeaponStatLine("暴击", Crit(r)));
            string per = def.pellets > 1 ? "（每弹丸）" : def.mode == FireMode.Beam ? "（每跳）" : "";
            bool cycling = def.cycle != null && def.cycle.Length > 0;
            string elem;
            if (cycling) elem = $"三相轮转 {Pct(r.elementChance)}{per}";
            else if (inst.element == Element.None) elem = ElementName(Element.None);
            else elem = $"{ElementName(inst.element)} {Pct(r.elementChance)}{per}";
            stats.Add(new WeaponStatLine("元素", elem));
            if (r.pierce > 0 || def.chargeFullPierce > 0)
                stats.Add(new WeaponStatLine("穿透", def.chargeFullPierce > 0 ? $"{r.pierce}（满蓄 +{def.chargeFullPierce}）" : r.pierce.ToString(Inv)));
            stats.Add(new WeaponStatLine("强化", $"{inst.level}/{WeaponLibrary.MaxUpgrade}"));
            Traits(inst, r, d.traits);
            // 元素轮转：UI 用「三相」代替元素单字（实例元素固定为第一种元素）
            if (cycling) d.elementLabel = "三相";
            return d;
        }

        static WeaponDescription Header(WeaponInstance inst) => new()
        {
            name = WeaponLibrary.DisplayName(inst),
            category = inst.def.category ?? "",
            rarity = Rarity.Clamp(inst.rarity),
            rarityName = Rarity.Name(inst.rarity),
            color = Rarity.Color(inst.rarity),
            element = inst.element,
        };

        static string Crit(ResolvedWeapon r) => $"×{F1(r.critMult)}{(r.critChance > 0 ? $"（+{Pct(r.critChance)} 暴击率）" : "")}";

        /// <summary>固有特性 + 词条 + 武器技能 + 传说（传说放最后）；未知词条跳过</summary>
        static void Traits(WeaponInstance inst, ResolvedWeapon r, List<string> traits)
        {
            var def = inst.def;
            if (def.notes != null) traits.AddRange(def.notes);
            List<string> legendary = null;
            foreach (var a in inst.affixes)
            {
                string t = null;
                AffixDef ad = null;
                try
                {
                    ad = AffixLibrary.Get(a.id);
                    t = AffixText.Format(ad, def, a.value);
                }
                catch (Exception)
                {
                    // 词条表缺项时不让整张描述出错
                }
                if (string.IsNullOrEmpty(t)) continue;
                if (ad is LegendaryDef) (legendary ??= new List<string>()).Add(t);
                else traits.Add(t);
            }
            var b = def.blade;
            if (b != null)
            {
                string key = SkillKey;
                traits.Add($"【武器技能·杀气爆发】{key} / 鼠标中键：碎片聚于准星落点后炸开，半径 {Num(b.burst.radius)} 米，伤害 {Num(b.burst.damage * r.damageMult)}。冷却 {Num(b.burst.cooldown)} 秒。");
                traits.Add($"【人刀合一】杀意满时 {key} 变为人刀合一：强化爆发后 {Num(b.union.duration)} 秒内斩击放出碎刃斩波，千刃出窍不耗刃气。");
            }
            if (legendary != null) traits.AddRange(legendary);
        }

        /// <summary>碎刃：三段斩伤害、攻速、千刃出窍伤害与结算频率、两种秒伤、刃气、屏障、暴击、元素、强化</summary>
        static WeaponDescription DescribeBlade(WeaponInstance inst, ResolvedWeapon r)
        {
            var def = inst.def;
            var b = def.blade;
            var d = Header(inst);
            var stats = d.stats;
            var slash = new List<string>();
            foreach (var s in b.combo) slash.Add(Num(s.damage * r.damageMult));
            stats.Add(new WeaponStatLine("斩", string.Join(" / ", slash)));
            float cycle = def.ComboCycleTime / Mathf.Max(0.01f, r.fireRateMult);
            stats.Add(new WeaponStatLine("攻速", $"一轮 {F2(cycle)} 秒"));
            stats.Add(new WeaponStatLine("千刃出窍", $"{Num(b.swarm.damage * r.damageMult)} ×{Num(1 / Mathf.Max(0.001f, b.swarm.tick))}/秒 · 半径 {Num(b.swarm.radius)} 米"));
            stats.Add(new WeaponStatLine("秒伤", $"斩 约 {Round(r.meleeDps)} · 千刃 约 {Round(r.dps)}"));
            stats.Add(new WeaponStatLine("刃气", $"{Num(b.qi.max)}（出窍 −{Num(b.swarm.drain)}/秒 · 屏障 −{Num(b.shield.drain)}/秒）"));
            stats.Add(new WeaponStatLine("暴击", Crit(r)));
            stats.Add(new WeaponStatLine("元素", inst.element == Element.None ? ElementName(Element.None) : $"{ElementName(inst.element)} {Pct(r.elementChance)}"));
            stats.Add(new WeaponStatLine("强化", $"{inst.level}/{WeaponLibrary.MaxUpgrade}"));
            Traits(inst, r, d.traits);
            d.skill = new WeaponSkillText
            {
                name = "杀气爆发",
                key = SkillKey,
                description = $"碎片聚于准星落点后炸开，半径 {Num(b.burst.radius)} 米；杀意满时变为人刀合一。",
                cooldown = b.burst.cooldown,
            };
            return d;
        }

        // ───────────── 对比 ─────────────

        /// <summary>
        /// 一项属性的对比行（同 TS compareLine）：没有对照或相同 →「伤害  23」；
        /// 两边第一个数字之外的部分相同 →「伤害  23 ▲（当前 18）」（▲ 更好 / ▼ 更差，「换弹」越小越好），否则不标记号
        /// </summary>
        public static string CompareLine(string label, string value, string current)
        {
            if (current == null || current == value) return $"{label}  {value}";
            string mark = "";
            if (SplitNum(value, out float a, out string sa) && SplitNum(current, out float b, out string sb) && sa == sb && !Mathf.Approximately(a, b))
            {
                bool better = LowerIsBetter.Contains(label) ? a < b : a > b;
                mark = better ? " ▲" : " ▼";
            }
            return $"{label}  {value}{mark}（当前 {current}）";
        }

        /// <summary>把属性值拆成「第一个数字」和「其余部分」（判断两者单位 / 格式是否可比）</summary>
        static bool SplitNum(string v, out float n, out string shape)
        {
            n = 0;
            shape = null;
            if (string.IsNullOrEmpty(v)) return false;
            var m = NumRe.Match(v);
            if (!m.Success || !float.TryParse(m.Value, NumberStyles.Float, Inv, out n)) return false;
            shape = v.Substring(0, m.Index) + "#" + v.Substring(m.Index + m.Length);
            return true;
        }

        /// <summary>提示卡的说明行：逐项对比 current（null = 不对比）+ 特性（◆）+ 替换说明（slotsFull = 两个槽都满）</summary>
        public static List<string> CompareLines(WeaponDescription d, WeaponDescription current, bool slotsFull)
        {
            var lines = new List<string>();
            if (d == null) return lines;
            foreach (var s in d.stats)
            {
                if (Skip.Contains(s.label)) continue;
                if (s.label == "元素" && d.element == Element.None && d.elementLabel == null) continue;
                lines.Add(CompareLine(s.label, s.value, current?.Stat(s.label)));
            }
            foreach (var t in d.traits) lines.Add($"◆ {t}");
            if (current != null) lines.Add(slotsFull ? $"将替换当前武器：{current.name}" : $"放入空槽位，保留{current.name}");
            return lines;
        }

        sealed class PromptCache
        {
            public WeaponDescription d, cur;
            public bool full;
            public string action;
            public int cost;
            public InteractPrompt prompt;
        }

        static readonly ConditionalWeakTable<WeaponInstance, PromptCache> prompts = new();

        /// <summary>玩家的武器控制器（没有为 null）</summary>
        static WeaponController PlayerWeapons => PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<WeaponController>() : null;

        /// <summary>
        /// 拾取 / 购买提示卡（同 TS weaponPrompt）：标题 = 名字（品质色），副标题「动作 · 品质 · 类别 · 元素 · 强化 +N」，
        /// 说明行逐项对比手上那把（<see cref="CompareLines"/>）；cost &gt; 0 时带价格（按当前灵石标不足）。
        /// wc = 对比谁手上的枪（缺省玩家）。结果缓存：两把枪的描述、槽位、动作、价格都没变时返回同一份（交互提示每帧取）
        /// </summary>
        public static InteractPrompt Prompt(WeaponInstance inst, string action, int cost = 0, WeaponController wc = null)
        {
            if (inst?.def == null) return InteractPrompt.Of(action ?? "武器");
            wc ??= PlayerWeapons;
            var d = Describe(inst);
            var curInst = wc ? wc.Active : null;
            var cur = curInst != null && curInst.uid != inst.uid ? Describe(curInst) : null;
            bool full = wc && wc.slots[0] != null && wc.slots[1] != null;
            if (prompts.TryGetValue(inst, out var pc) && pc.d == d && pc.cur == cur && pc.full == full && pc.action == action && pc.cost == cost)
                return cost > 0 ? pc.prompt.WithCost(cost) : pc.prompt;

            var parts = new List<string>();
            if (!string.IsNullOrEmpty(action)) parts.Add(action);
            if (!string.IsNullOrEmpty(d.rarityName)) parts.Add(d.rarityName);
            if (!string.IsNullOrEmpty(d.category)) parts.Add(d.category);
            if (d.elementLabel != null) parts.Add("三相轮转");
            else if (d.element != Element.None) parts.Add(ElementName(d.element));
            if (inst.level > 0) parts.Add($"强化 +{inst.level}");
            var p = new InteractPrompt
            {
                title = d.name,
                subtitle = string.Join(" · ", parts),
                lines = CompareLines(d, cur, full).ToArray(),
                color = d.color,
            };
            if (pc == null)
            {
                pc = new PromptCache();
                prompts.Add(inst, pc);
            }
            pc.d = d;
            pc.cur = cur;
            pc.full = full;
            pc.action = action;
            pc.cost = cost;
            pc.prompt = p;
            return cost > 0 ? p.WithCost(cost) : p;
        }
    }
}
