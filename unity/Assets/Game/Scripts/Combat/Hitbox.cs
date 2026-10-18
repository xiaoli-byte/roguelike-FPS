using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>挂在敌人的碰撞体上：子弹命中时找到所属单位，weakpoint = 头 / 弱点（必定暴击）</summary>
    public sealed class Hitbox : MonoBehaviour
    {
        public Damageable owner;
        public bool weakpoint;
        /// <summary>弱点额外倍率（叠在暴击之上，一般为 1）</summary>
        public float multiplier = 1f;
    }
}
