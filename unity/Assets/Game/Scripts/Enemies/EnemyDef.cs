using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>敌人定义的级别：普通 / 精英 / 首领（精英通常是生成时的选项，这里是「天生」的级别）</summary>
    public enum EnemyRank { Normal, Elite, Boss }

    /// <summary>遭遇编排里的站位角色（同 Three.js 版 EnemyPlacement）：正面推进 / 侧翼 / 远程 / 精确远程 / 炮击 / 辅助</summary>
    public enum EnemyPlacement { Assault, Flank, Ranged, Precision, Artillery, Support }

    /// <summary>
    /// 敌人定义（Three.js 版 src/enemies/types/* 的 DEF，等级 1）：基础数值、美术 Prefab、行为组件类型、编排与掉落信息。
    /// 每种敌人一个文件 Enemies/Defs/&lt;Desert|Frost|Inferno&gt;/Enemy_&lt;Id&gt;.cs（<see cref="IDefSource{T}"/> + [Defs]），由 <see cref="Registry{T}"/> 收集，
    /// <see cref="EnemyRoster.Spawn(string, Vector3, Quaternion, float, bool, SpawnOptions)"/> 按它生成。
    /// 尺寸（radius / height / weakHeight）是美术设计尺寸（放大前），生成时整体乘 scale；缺 Prefab 时 <see cref="PlaceholderBody"/> 按它做胶囊。
    /// </summary>
    public sealed class EnemyDef : IDef
    {
        public string id, prefab, name;
        public float hp, armor, shield, speed, damage;
        /// <summary>击退抗性 0–1</summary>
        public float knockbackResist;
        /// <summary>体型倍率（Three.js 版 ScaledEnemyDef.scale）：美术 Prefab 是设计尺寸，生成时整体放大，碰撞体 / 导航 / 弱点一起变</summary>
        public float scale = 1f;
        /// <summary>弱点挂的骨骼名（包含匹配）与半径（设计尺寸）</summary>
        public string weakBone;
        public float weakRadius = 0.2f;
        /// <summary>行为组件（EnemyAI 子类）</summary>
        public Type ai;
        /// <summary>出手名额类别（AttackTokens）</summary>
        public AttackTokens.Kind role;

        public EnemyRank rank;
        /// <summary>遭遇编排的站位角色（TS WhiteboxEncounters 的 roleFor）</summary>
        public EnemyPlacement placementRole;
        /// <summary>飞行（TS flying）。目前只是标记：生成仍按地面单位挂 NavMeshAgent，飞行基类（E3）落地后接上</summary>
        public bool flying;
        /// <summary>只站地面，不占高台站位（TS GROUND_ONLY：钻地、滚动、冲锋、成群贴地）</summary>
        public bool groundOnly;
        /// <summary>冲锋型：只有它们的正面位从场地远端进场（TS CHARGERS）</summary>
        public bool charger;
        /// <summary>
        /// 击杀掉落（TS coins [min, max] / essence 魂晶）。现在 LootDirector 仍按耐久折算灵石，这两项等经济单元（D24）接上。
        /// </summary>
        public Vector2Int coins;
        public int essence;
        /// <summary>主题色（特效、占位体）</summary>
        public Color color = Color.white;
        /// <summary>攻击元素（占位体的发光色；没有元素时用主题色）</summary>
        public Element element;
        /// <summary>不随机给它的精英词缀（与自身机制重复的，TS Affixes.EXCLUDE）</summary>
        public string[] affixExclusions = Array.Empty<string>();
        /// <summary>设计尺寸（放大前）：碰撞半径、身高、弱点中心离地高度（TS radius / height / headY）</summary>
        public float radius = 0.4f, height = 1.8f, weakHeight;

        string IDef.Id => id;

        /// <summary>弱点中心离地高度（设计尺寸）：没写时取身高的 85%（同 TS headY 缺省）</summary>
        public float WeakHeight => weakHeight > 0 ? weakHeight : height * 0.85f;
        /// <summary>发光色：有攻击元素用元素色，否则用主题色</summary>
        public Color GlowColor => element != Element.None ? DamageTable.ElementColor(element) : color;
    }
}
