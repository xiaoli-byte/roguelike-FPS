using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一条武器词条（同 TS WeaponAffix）：value 的含义由词条解释（0.1 = +10%）。固有词条与掷出的词条共用</summary>
    public readonly struct WeaponAffix
    {
        public readonly string id;
        public readonly float value;

        public WeaponAffix(string id, float value)
        {
            this.id = id;
            this.value = value;
        }

        public override string ToString() => $"{id}={value}";
    }

    /// <summary>
    /// 一把具体的枪（同 TS WeaponInstance）：唯一编号、品质、元素、强化等级、词条、弹匣与备弹。
    /// uid 在本次运行内递增（伤害信息里的 weaponUid 用它区分同名的两把枪）；进入 Play 时清零。
    /// 品质 / 强化 / 元素 / 词条一改就 <see cref="Version"/> + 1，<see cref="WeaponStatsResolver"/> 据此（加上玩家属性的版本号）重算实际数值。
    /// 随机生成走 <see cref="WeaponRoller.Roll"/>（章节稀有度、随机元素、词条）；直接 new 出来的是「定义原样」：元素同定义、只带固有词条、弹药按定义装满。
    /// </summary>
    public sealed class WeaponInstance
    {
        static int nextUid;

        public readonly int uid;
        public readonly WeaponDef def;
        int rarityValue, levelValue;
        Element elementValue;
        readonly List<WeaponAffix> affixList = new();

        /// <summary>品质 0–4（<see cref="Rarity"/>）</summary>
        public int rarity
        {
            get => rarityValue;
            set
            {
                if (rarityValue == value) return;
                rarityValue = value;
                Version++;
            }
        }

        /// <summary>强化等级 0 … <see cref="WeaponLibrary.MaxUpgrade"/></summary>
        public int level
        {
            get => levelValue;
            set
            {
                if (levelValue == value) return;
                levelValue = value;
                Version++;
            }
        }

        /// <summary>实例元素：缺省同定义；无元素的武器在精良以上有 35% 掷出随机元素（<see cref="WeaponRoller.RollElement"/>）</summary>
        public Element element
        {
            get => elementValue;
            set
            {
                if (elementValue == value) return;
                elementValue = value;
                Version++;
            }
        }

        /// <summary>词条（固有词条在最前，传说特性在最后）。只读；改用 <see cref="SetAffixes"/> / <see cref="AddAffix"/></summary>
        public IReadOnlyList<WeaponAffix> affixes => affixList;

        public int mag, reserve;

        /// <summary>品质 / 强化 / 元素 / 词条任一变化时自增（数值缓存的键之一）</summary>
        public int Version { get; private set; }

        /// <summary><see cref="WeaponStatsResolver"/> 的缓存槽（只给解析器用）</summary>
        internal ResolvedWeapon resolved;

        // ── 运行时状态（开火框架 W1 用）──
        /// <summary>元素轮转的下一发下标（三才转轮）</summary>
        public int cycleIndex;
        /// <summary>当前蓄力（0..1）/ 机炮预热（0..1）</summary>
        public float charge, spin;

        public WeaponInstance(WeaponDef def, int rarity = 0)
        {
            uid = ++nextUid;
            this.def = def;
            rarityValue = rarity;
            elementValue = def.element;
            if (def.innate != null) affixList.AddRange(def.innate);
            mag = def.mag;
            reserve = def.reserve;
        }

        /// <summary>整体替换词条（掷骰结果：固有 → 抽到的 → 传说）</summary>
        public void SetAffixes(IEnumerable<WeaponAffix> list)
        {
            affixList.Clear();
            if (list != null) affixList.AddRange(list);
            Version++;
        }

        public void AddAffix(WeaponAffix a)
        {
            affixList.Add(a);
            Version++;
        }

        /// <summary>本把枪身上某个词条的合计值（同 id 叠加）；没有为 0</summary>
        public float AffixTotal(string id)
        {
            float v = 0;
            foreach (var a in affixList)
                if (a.id == id) v += a.value;
            return v;
        }

        /// <summary>品质 × 强化的伤害倍率（不含伤害词条；含词条的实际倍率见 <see cref="ResolvedWeapon.damageMult"/>）</summary>
        public float DamageMult => WeaponLibrary.RarityDamage[Rarity.Clamp(rarity)] * (1 + level * WeaponLibrary.UpgradeStep);
        /// <summary>显示名（传说前缀 + 名称，见 <see cref="WeaponLibrary.DisplayName"/>）+ 强化等级</summary>
        public string Title => level > 0 ? $"{WeaponLibrary.DisplayName(this)} +{level}" : WeaponLibrary.DisplayName(this);
        public Color RarityColor => Rarity.Color(rarity);
        public bool CanUpgrade => level < WeaponLibrary.MaxUpgrade;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetUids() => nextUid = 0;
    }
}
