using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旧接口：地面火焰区（镇墓兽冲锋犁出的日火裂痕、火浣鼠的余火）——E4 起转给 <see cref="FloorFire"/>，数值与改动前一致：
    /// 圆形区域烧 duration 秒，生效 tick × 0.5 秒后第一跳、之后每 tick 秒对站在里面（水平半径 + 0.35 m、高差 ±1.2 m）的玩家结算一次火伤；
    /// 地火登记进 <see cref="FireFeed"/>（祸斗能吃）。新代码直接用 <see cref="FloorFire.Spawn"/>。
    /// </summary>
    public static class FireZone
    {
        public static FloorFire Spawn(Vector3 center, float radius, float duration, float damagePerTick, float tick = 0.5f) =>
            FloorFire.Spawn(center, radius, duration, damagePerTick, tick);
    }
}
