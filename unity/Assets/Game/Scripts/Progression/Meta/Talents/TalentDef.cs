using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局外天赋（Three.js 版 src/progression/Meta.ts 的 TALENTS；docs/unity-parity.md 3.11 / 4.3）：
    /// 花魂晶升级，开局时按等级写进玩家属性表（来源 <see cref="MetaSave.TalentSource"/>）。
    /// 每项 5 级，第 n 级的价格 60 / 120 / 200 / 300 / 450 魂晶（下标 = 当前等级，同 TS talentCost），效果 = 每级数值 × 等级。
    /// 每个天赋一个文件 Progression/Meta/Talents/Talent_&lt;Id&gt;.cs：继承本类 + [Defs(顺序)]，由 <see cref="Registry{T}"/> 收集；
    /// 不只是加属性的天赋（以后可能有）重写 <see cref="Collect"/>，或者在开局事件里自己挂钩子。
    /// </summary>
    public abstract class TalentDef : IDef
    {
        /// <summary>每级价格（魂晶），下标 = 当前等级</summary>
        public static readonly int[] Costs = { 60, 120, 200, 300, 450 };

        public readonly string id, name, description;
        public readonly Stat stat;
        /// <summary>每级加多少（百分比属性是加成量：0.04 = +4%）</summary>
        public readonly float perLevel;
        public readonly int maxLevel;

        string IDef.Id => id;

        protected TalentDef(string id, string name, Stat stat, float perLevel, string description, int maxLevel = 5)
        {
            this.id = id;
            this.name = name;
            this.stat = stat;
            this.perLevel = perLevel;
            this.description = description;
            this.maxLevel = maxLevel;
        }

        /// <summary>从 level 级升到下一级的价格（同 TS talentCost：下标夹在价格表范围内）</summary>
        public virtual int Cost(int level) => Costs[Mathf.Clamp(level, 0, Costs.Length - 1)];

        /// <summary>下一级价格；已满级返回 -1</summary>
        public int NextCost(int level) => level >= maxLevel ? -1 : Cost(Mathf.Max(0, level));

        /// <summary>从 0 级升满的总价</summary>
        public int TotalCost
        {
            get
            {
                int sum = 0;
                for (int lv = 0; lv < maxLevel; lv++) sum += Cost(lv);
                return sum;
            }
        }

        /// <summary>level 级时的属性修正（默认一条：stat += perLevel × level）</summary>
        public virtual void Collect(List<(Stat stat, float value)> into, int level)
        {
            if (level > 0) into.Add((stat, perLevel * level));
        }

        /// <summary>level 级时的效果文字（「+16」「+8%」），天赋面板「当前 / 下一级」用；0 级为「—」</summary>
        public string Effect(int level) => level > 0 ? StatInfo.Format(stat, perLevel * level) : "—";

        public override string ToString() => id;
    }

    /// <summary>天赋表门面</summary>
    public static class TalentLibrary
    {
        public static IReadOnlyList<TalentDef> All => Registry<TalentDef>.All;
        public static TalentDef Get(string id) => Registry<TalentDef>.Get(id);
    }
}
