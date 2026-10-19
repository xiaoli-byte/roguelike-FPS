using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 英雄定义（Three.js 版 src/core/types.ts 的 HeroDef + src/ui/labels.ts 的 HERO_META）：
    /// 基础属性、第一人称手臂、初始武器、技能工厂、被动说明、主题色，以及选英雄界面用的定位 / 难度 / 标签 / 心得。
    /// 每个英雄一个文件 Skills/Heroes/Hero_&lt;Id&gt;.cs：继承本类 + [Defs]，由 <see cref="Registry{T}"/> 收集。
    /// 解锁（D8）：三人默认全开，unlockCost 保留为 0。
    /// TODO(H2)：HeroSkills.Configure 目前仍按 heroId 自己 switch，改成读这里的 CreatePrimary / CreateSecondary / 被动；
    /// 现在由 PlayerRigBuilder 把 heroId 写进 HeroSkills，行为不变。
    /// </summary>
    public abstract class HeroDef : IDef
    {
        public string id, name, title, description;
        /// <summary>主题色（技能框、选英雄祭台、HUD 点缀）</summary>
        public Color color = Color.white;
        /// <summary>基础属性（TS base 里的 maxHp / maxShield / moveSpeed；缺省同 StatSheet.Default）</summary>
        public float maxHp = 100, maxShield = 50, moveSpeed = 7.5f;
        /// <summary>其余基础属性覆盖（TS base 里的其他键，如磐的减伤 10%、鼯的额外跳跃）：HeroStats 建属性表时 SetBase</summary>
        public (Stat stat, float value)[] baseStats = Array.Empty<(Stat, float)>();
        /// <summary>第一人称手臂 Prefab（右 / 左）</summary>
        public string armR, armL;
        public string startWeapon = "smg";
        /// <summary>选英雄界面：定位、上手难度（1 简单 / 2 中等 / 3 进阶）、玩法标签、心得</summary>
        public string role = "均衡";
        public int difficulty = 2;
        public string[] tags = Array.Empty<string>();
        public string tip = "";
        /// <summary>解锁所需魂晶（D8：全部为 0）</summary>
        public int unlockCost;
        public string passiveName, passiveDescription;

        string IDef.Id => id;

        /// <summary>Q：主技能（每次新建一份，技能对象带运行时状态）</summary>
        public virtual Skill CreatePrimary() => null;
        /// <summary>E：副技能（通常是多充能的投掷物）</summary>
        public virtual Skill CreateSecondary() => null;

        public static readonly string[] DifficultyNames = { "", "简单", "中等", "进阶" };
    }

    /// <summary>英雄表门面</summary>
    public static class HeroLibrary
    {
        public const string DefaultHero = "fox";
        public static System.Collections.Generic.IReadOnlyList<HeroDef> All => Registry<HeroDef>.All;
        public static HeroDef Get(string id) => Registry<HeroDef>.Get(id);
    }
}
