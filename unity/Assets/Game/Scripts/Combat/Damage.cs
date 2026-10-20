using System;
using UnityEngine;

namespace Spiritfire.Game
{
    public enum Element { None, Fire, Shock, Corrode }

    /// <summary>
    /// Pet：灵宠的攻击（只吃「灵宠伤害」加成，默认不随机暴击，见 docs/pet-system.md）。
    /// Scroll：秘卷触发的伤害（同 Three.js 'scroll'：不吃武器 / 技能 / 爆炸加成，只吃元素、精英、首领类）；
    /// Melee：近战（同 Three.js 'melee'：按武器伤害算，碎刃的斩击用）。只往末尾追加。
    /// </summary>
    public enum DamageSource { Weapon, Skill, Explosion, Status, Enemy, Environment, Pet, Scroll, Melee }

    /// <summary>伤害层：护盾 → 护甲 → 生命，依次吃伤害</summary>
    public enum DamageLayer { Shield, Armor, Health }

    /// <summary>敌人的级别：精英、首领各有战斗修正（精英伤害 / 首领伤害、眩晕抗性…）</summary>
    public enum Rank { Normal, Elite, Boss }

    /// <summary>
    /// 伤害标签（Three.js 版 DamageRequest.tags）：按标签算属性乘区（<see cref="DamageCalc.StatMultiplier(in DamageInfo, Damageable)"/>），
    /// 监听者按标签过滤（「武器爆炸」「反应伤害」「静默处决」…）。来源 <see cref="DamageSource"/> 隐含对应的标签（武器 → Weapon 等），不必重复写。
    /// </summary>
    [Flags]
    public enum DamageTag
    {
        None = 0,
        /// <summary>武器伤害（直接命中、武器投射物的爆炸）：吃「武器伤害」</summary>
        Weapon = 1 << 0,
        /// <summary>近战（碎刃斩击）：同样吃「武器伤害」</summary>
        Melee = 1 << 1,
        /// <summary>技能伤害：吃「技能伤害」</summary>
        Skill = 1 << 2,
        /// <summary>范围爆炸（<see cref="Combat.Explode(in ExplosionOptions)"/> 自动加上）：吃「爆炸伤害」</summary>
        Explosion = 1 << 3,
        /// <summary>雷殛弹射（按直接命中显示）</summary>
        Chain = 1 << 4,
        /// <summary>持续伤害跳伤（灼烧、蚀化、熔池）</summary>
        Dot = 1 << 5,
        /// <summary>静默处决（清场）：不算玩家战果——不附着元素、不掉落、不触发「击杀时」效果</summary>
        Purge = 1 << 6,
        /// <summary>崩解（引爆单一状态）</summary>
        Collapse = 1 << 7,
        /// <summary>元素反应伤害：只吃「反应伤害」（威力取自附着强度，已含其他加成）</summary>
        Reaction = 1 << 8,
        Thunderfire = 1 << 9,
        Meltdown = 1 << 10,
        Veinseal = 1 << 11,
        Abyss = 1 << 12,
        /// <summary>回响 / 涅槃 / 劫火：强制反应的来源（秘卷、词条）</summary>
        Echo = 1 << 13,
        Nirvana = 1 << 14,
        Kalpa = 1 << 15,
        /// <summary>秘卷 / 词条「命中时触发」衍生出的伤害（procId 写明是谁）</summary>
        Proc = 1 << 16,
        /// <summary>灵宠伤害：只吃「灵宠伤害」</summary>
        Pet = 1 << 17,
    }

    /// <summary>一次伤害请求（武器、技能、爆炸、持续伤害共用）</summary>
    public struct DamageInfo
    {
        public float amount;
        public Element element;
        public DamageSource source;
        /// <summary>命中弱点（头部 / 敌人各自的弱点部位）：必定暴击</summary>
        public bool weakpoint;
        /// <summary>被改判为弱点（神兽白泽）：只影响暴击与弱点加成，敌人机制（琵琶、正面格挡）仍看 <see cref="weakpoint"/></summary>
        public bool forcedWeakpoint;
        public bool forceCrit;
        /// <summary>不随机暴击（Three.js canCrit = false）：强制暴击 / 弱点照样暴击</summary>
        public bool noCrit;
        /// <summary>无视护盾层，直接打在护甲 / 生命上（碎刃的刃群）</summary>
        public bool bypassShield;
        /// <summary>暴击倍率（武器表的 critMult，默认 2）</summary>
        public float critMult;
        public Vector3 point, direction;
        public float knockback;
        /// <summary>附着元素状态的概率（0–1；1 = 必定）：火 → 灼烧、雷 → 雷殛、蚀 → 蚀化。持续伤害 / 反应伤害自身不再附着</summary>
        public float statusChance;
        /// <summary>副元素（青冥雷蛊的固有雷殛）：命中时按 subChance 另掷一次，同样判定反应</summary>
        public Element subElement;
        public float subChance;
        /// <summary>衍生深度：武器 / 技能直接命中 = 0，弹射、反应、反应扩散出去的元素 = 上一级 + 1；深度 ≥ 2 的附着不再引发反应</summary>
        public int depth;
        /// <summary>元素反应造成的伤害：只吃「反应伤害」加成（附着强度里已经含了其他加成），不暴击、不再附着元素。与 <see cref="DamageTag.Reaction"/> 等价</summary>
        public bool reaction;
        /// <summary>标签（见 <see cref="DamageTag"/>）；来源隐含的标签不必写</summary>
        public DamageTag tags;
        /// <summary>出自哪把武器（<see cref="WeaponInstance.uid"/>）；0 = 不是武器伤害</summary>
        public int weaponUid;
        /// <summary>出自哪种反应（反应伤害、反应的爆炸）</summary>
        public Reaction? reactionId;
        /// <summary>出自哪个秘卷 / 词条的「触发」（配合 <see cref="DamageTag.Proc"/>）</summary>
        public string procId;
        public UnityEngine.Object instigator;

        public readonly bool Has(DamageTag t) => (tags & t) != 0;

        public static DamageInfo Simple(float amount, DamageSource source, Vector3 point, Vector3 direction) => new()
        {
            amount = amount, source = source, point = point, direction = direction, critMult = 2f,
        };
    }

    public struct DamageResult
    {
        public float total, shield, armor, health;
        public bool crit, killed, immune, blocked;
        /// <summary>伤害数字取色：最后吃到伤害的层</summary>
        public DamageLayer layer;
        /// <summary>最先打到的层（命中时最外面那层；bypassShield 时跳过护盾）</summary>
        public DamageLayer firstLayer;
        /// <summary>这一击把护盾 / 护甲打空了</summary>
        public bool shieldBroken, armorBroken;
        /// <summary>展示用总量：实际扣除 + 生命层的溢出（击杀时的「过量伤害」）</summary>
        public float effective;
        /// <summary>这一击附着上的元素状态（None = 没附着）</summary>
        public Element statusApplied;
        /// <summary>这一击的元素附着引发的反应（只是入队，效果稍后执行）</summary>
        public Reaction? reaction;
    }

    /// <summary>
    /// 受伤修饰器（敌人身上的 <see cref="Damageable.Incoming"/>、玩家的 <see cref="PlayerVitals.Incoming"/>）：返回倍率（1 = 不变，0 = 免疫）。
    /// </summary>
    public delegate float Incoming(in IncomingHit h);

    /// <summary>受伤修饰器看到的这一下伤害</summary>
    public struct IncomingHit
    {
        /// <summary>当前伤害（已乘过前面的修饰器）。敌人：分层之前；玩家：减伤之后</summary>
        public float amount;
        public Element element;
        /// <summary>受伤的敌人（玩家受伤时为 null）</summary>
        public Damageable target;
        /// <summary>敌人受伤时的完整请求（玩家受伤时只有 element / point / direction 有意义）</summary>
        public DamageInfo info;
        /// <summary>敌人受伤：这一击暴击了</summary>
        public bool crit;
        /// <summary>出手者：玩家受伤时是打人的敌人 / 投射物来源，敌人受伤时是 info.instigator</summary>
        public UnityEngine.Object source;
        /// <summary>伤害来自哪里（受击方向）</summary>
        public Vector3 from;
    }

    /// <summary>
    /// 伤害层 × 元素倍率（Three.js 版 src/combat/DamageCalc.ts 的 LAYER_MULT）：
    /// 无属性打护甲只有 75%；火克生命、雷克护盾、蚀克护甲。含玩家「对护盾 / 护甲伤害」的倍率见 <see cref="DamageCalc.LayerMultiplier"/>。
    /// </summary>
    public static class DamageTable
    {
        static readonly float[,] Mult =
        {
            //          Shield Armor Health
            /* None    */ { 1.0f, 0.75f, 1.0f },
            /* Fire    */ { 0.8f, 1.0f, 1.25f },
            /* Shock   */ { 1.6f, 0.8f, 1.0f },
            /* Corrode */ { 1.0f, 1.6f, 1.0f },
        };

        public static float LayerMult(Element e, DamageLayer layer) => Mult[(int)e, (int)layer];

        public static Color ElementColor(Element e) => e switch
        {
            Element.Fire => new Color(1f, 0.55f, 0.2f),
            Element.Shock => new Color(0.55f, 0.75f, 1f),
            Element.Corrode => new Color(0.6f, 0.9f, 0.3f),
            _ => Color.white,
        };
    }
}
