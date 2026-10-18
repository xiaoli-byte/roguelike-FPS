using UnityEngine;

namespace Spiritfire.Game
{
    public enum Element { None, Fire, Shock, Corrode }

    public enum DamageSource { Weapon, Skill, Explosion, Status, Enemy, Environment }

    /// <summary>伤害层：护盾 → 护甲 → 生命，依次吃伤害</summary>
    public enum DamageLayer { Shield, Armor, Health }

    /// <summary>一次伤害请求（武器、技能、爆炸、持续伤害共用）</summary>
    public struct DamageInfo
    {
        public float amount;
        public Element element;
        public DamageSource source;
        /// <summary>命中弱点（头部 / 敌人各自的弱点部位）：必定暴击</summary>
        public bool weakpoint;
        public bool forceCrit;
        /// <summary>暴击倍率（武器表的 critMult，默认 2）</summary>
        public float critMult;
        public Vector3 point, direction;
        public float knockback;
        /// <summary>附着元素状态的概率（0–1；1 = 必定）：火 → 灼烧。持续伤害自身不再附着</summary>
        public float statusChance;
        public Object instigator;

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
    }

    /// <summary>
    /// 伤害层 × 元素倍率（Three.js 版 src/combat/DamageCalc.ts 的 LAYER_MULT）：
    /// 无属性打护甲只有 75%；火克生命、雷克护盾、蚀克护甲。
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
