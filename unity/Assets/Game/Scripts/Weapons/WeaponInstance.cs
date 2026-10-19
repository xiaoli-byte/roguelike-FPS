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
    }

    /// <summary>
    /// 一把具体的枪（同 TS WeaponInstance）：唯一编号、品质、元素、强化等级、词条、弹匣与备弹。
    /// uid 在本次运行内递增（伤害信息里的 weaponUid 用它区分同名的两把枪）；进入 Play 时清零。
    /// 元素 / 词条目前只是数据：掷骰（W2 WeaponRoller）与词条效果（AF）落地前，开火仍按定义的元素走。
    /// </summary>
    public sealed class WeaponInstance
    {
        static int nextUid;

        public readonly int uid;
        public readonly WeaponDef def;
        public int rarity, level;
        /// <summary>实例元素：缺省同定义；精良以上随机元素由 W2 掷出</summary>
        public Element element;
        /// <summary>词条（固有词条在最前），AF 单元之前为空</summary>
        public readonly List<WeaponAffix> affixes = new();
        public int mag, reserve;

        // ── 运行时状态（开火框架 W1 用）──
        /// <summary>元素轮转的下一发下标（三才转轮）</summary>
        public int cycleIndex;
        /// <summary>当前蓄力（0..1）/ 机炮预热（0..1）</summary>
        public float charge, spin;

        public WeaponInstance(WeaponDef def, int rarity = 0)
        {
            uid = ++nextUid;
            this.def = def;
            this.rarity = rarity;
            element = def.element;
            mag = def.mag;
            reserve = def.reserve;
        }

        public float DamageMult => WeaponLibrary.RarityDamage[Rarity.Clamp(rarity)] * (1 + level * WeaponLibrary.UpgradeStep);
        public string Title => level > 0 ? $"{def.name} +{level}" : def.name;
        public Color RarityColor => Rarity.Color(rarity);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetUids() => nextUid = 0;
    }
}
