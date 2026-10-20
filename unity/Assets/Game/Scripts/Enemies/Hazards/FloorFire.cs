using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 地火（镇墓兽冲锋犁出的日火裂痕、火浣鼠的余火、以后毕方的讹火 / 飞鸦的纸灰火 / 熔铜匠的泼铜）：
    /// 一片火元素的 <see cref="HazardZone"/>——不预警、立刻生效，生效 tick × 0.5 秒后第一跳、之后每 tick 秒烫一下站在里面的玩家
    /// （水平半径 + 0.35 m、高差 ±1.2 m，同改动前的 FireZone），冒零星火星；
    /// 默认登记进 <see cref="FireFeed"/>（Three.js registerFloorFire）：祸斗吃掉时立刻熄灭（停止伤害、贴片淡出），并回调 onEaten。
    /// </summary>
    public sealed class FloorFire : HazardZone, IFireSource
    {
        public static readonly Color FireColor = new(1f, 0.45f, 0.12f, 1f);

        Action onEaten;
        bool edible, registered;
        object claimedBy;

        /// <summary>已经被吃掉</summary>
        public bool Eaten { get; private set; }

        /// <summary>
        /// 在 center（地面点）点一片地火：半径 radius、烧 duration 秒、每 tick 秒 damagePerTick（最终值）。
        /// source = 出手者；edible = 登记给祸斗吃；onEaten = 被吃掉时（调用方熄灭自己的附属特效）
        /// </summary>
        public static FloorFire Spawn(Vector3 center, float radius, float duration, float damagePerTick, float tick = 0.5f,
            UnityEngine.Object source = null, bool edible = true, Action onEaten = null)
        {
            tick = Mathf.Max(0.05f, tick);
            var s = new Spec(center, radius, duration, damagePerTick)
            {
                interval = tick,
                firstTick = tick * 0.5f,
                element = Element.Fire,
                color = FireColor,
                source = source,
                telegraph = false,
                sparks = true,
            };
            var f = Create<FloorFire>("Floor Fire", s);
            f.edible = edible;
            f.onEaten = onEaten;
            if (edible)
            {
                FireFeed.Register(f);
                f.registered = true;
            }
            return f;
        }

        // ───────────── IFireSource ─────────────

        public FireKind Kind => FireKind.Floor;
        public Vector3 Position => spec.center;
        public bool Edible => edible && !Eaten && this && !clock.Ended;

        public object ClaimedBy
        {
            get => claimedBy;
            set => claimedBy = value;
        }

        /// <summary>被祸斗吃掉：熄灭（停止伤害、贴片淡出），回调 onEaten</summary>
        public void Consume()
        {
            if (!Edible) return;
            Eaten = true;
            Expire();
            Unregister();
            try
            {
                onEaten?.Invoke();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>自己提前结束（施放者撤掉）：熄灭并注销，不算被吃</summary>
        public void Remove()
        {
            Expire();
            Unregister();
        }

        void Unregister()
        {
            if (!registered) return;
            registered = false;
            FireFeed.Unregister(this);
        }

        void OnDestroy() => Unregister();
    }
}
