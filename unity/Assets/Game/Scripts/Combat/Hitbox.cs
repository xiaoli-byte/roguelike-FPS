using UnityEngine;
using UnityEngine.Serialization;

namespace Spiritfire.Game
{
    /// <summary>
    /// 挂在敌人的碰撞体上：子弹命中时找到所属单位（owner），weakpoint = 头 / 弱点（必定暴击）。
    /// 有 <see cref="zone"/>（<see cref="HitZone"/>，多段命中区）时弱点与否由命中区决定：启停、弱点开关、朝向门都在那边；
    /// 落在这一区的伤害倍率也由命中区在敌人侧结算（<see cref="Damageable.Incoming"/>），不经过这里的 <see cref="multiplier"/>。
    /// 命中盒默认不挡视线（<see cref="Combat.Blocked"/> 跳过它，敌人之间不互相遮挡）；冰壁、可破坏掩体这类设 <see cref="blocksSight"/>。
    /// </summary>
    public sealed class Hitbox : MonoBehaviour
    {
        public Damageable owner;
        [FormerlySerializedAs("weakpoint"), SerializeField] bool weak;
        /// <summary>弱点额外倍率（命中扫描乘在伤害上、叠在暴击之上，一般为 1；命中区的倍率不走这里）</summary>
        public float multiplier = 1f;
        /// <summary>挡视线（敌人的视线、投射物追踪、爆炸的遮挡判定）：放在世界层上的可破坏掩体（冰壁）设为 true</summary>
        public bool blocksSight;
        /// <summary>所属命中区（没有 = 普通命中盒，弱点看自己的开关）</summary>
        public HitZone zone;

        /// <summary>这一下按弱点算：有命中区时 = 命中区启用、是弱点、朝向门通过（对着玩家视点）；否则看自己的开关</summary>
        public bool weakpoint
        {
            get => zone ? zone.WeakNow : weak;
            set
            {
                weak = value;
                if (zone) zone.weakpoint = value;
            }
        }
    }
}
