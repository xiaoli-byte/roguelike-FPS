using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃三阶段「赤地千里」的场地变化（unity-maps-v1 第 3 节：日轮升起，整个泉床成为日晒区，只剩很少的影子；1-4 是露天的鸣沙山月牙泉）。
    /// 不是招式：转阶段演出开始时由 <see cref="HanbaBrain"/> 调 <see cref="Begin"/>。
    ///   露天场地（场景里没有 <see cref="SunShaft"/> 标记，正常情况）：
    ///   · 太阳被推到头顶：<see cref="HanbaSunDriver"/> 保持方位角，<see cref="HanbaDef.sunDriveSeconds"/> 秒内把主光仰角推到 <see cref="HanbaDef.risenElevation"/>（约 85°）——
    ///     一阶段午后沙丘、楼阁拖出的长影子缩到脚下，只剩楼阁里、沙丘檐下的深影还能躲。日晒判定与真实阴影读的是同一盏主光，跟着一起变。
    ///   · 日轮升到头顶：沿新的太阳方向，从场地中心往上 <see cref="HanbaDef.risenDistance"/> 米、轮面朝下、放大（<see cref="SunRing.Rise"/>）——它就是那颗太阳。
    ///     日晒里日轮直射的增益归零（不再按到轮心的视线另算一份，免得影子里还被斜着照到），日光增益提到 <see cref="HanbaDef.risenSunGain"/>：烈日当头，晒得更快。
    ///   旧的地下巨穴版（场景里有穴顶开口标记）：日轮嵌进开口下方 <see cref="HanbaDef.riseDrop"/> 米，日轮直射距离放到盖住整个碗底（<see cref="HanbaDef.risenRange"/>）、
    ///     增益 <see cref="HanbaDef.risenGain"/>；太阳不动（光柱照旧）。
    ///   · 一阶段的日轮扫射之后从头顶往下扫（光束起点就是轮心）。
    /// </summary>
    public sealed class Phase3SunRise
    {
        readonly HanbaBrain boss;

        /// <summary>开始升了（只升一次）</summary>
        public bool Begun { get; private set; }
        /// <summary>日轮升到的目标点</summary>
        public Vector3 Target { get; private set; }
        /// <summary>按穴顶开口算的（旧的地下巨穴版）；false = 露天，太阳被推到头顶</summary>
        public bool FromShaft { get; private set; }
        /// <summary>推太阳用的驱动（露天且场景里有主光时才有）</summary>
        public HanbaSunDriver Driver { get; private set; }

        public Phase3SunRise(HanbaBrain b) => boss = b;

        /// <summary>
        /// 日轮的目标：有穴顶开口标记时 = 离场地最近的开口中心往下 drop 米；露天 = 场地中心（没有场地时首领脚下）沿 toSun 往外 distance 米
        /// </summary>
        public static Vector3 TargetFor(BossArena arena, Vector3 fallback, Vector3 toSun, float distance, float drop, out bool fromShaft)
        {
            var c = arena ? arena.Center : fallback;
            SunShaft best = null;
            float bd = float.PositiveInfinity;
            foreach (var s in SunShaft.All)
            {
                if (!s) continue;
                var d = s.transform.position - c;
                d.y = 0;
                if (d.sqrMagnitude >= bd) continue;
                bd = d.sqrMagnitude;
                best = s;
            }
            fromShaft = best;
            if (best) return best.transform.position + Vector3.down * Mathf.Max(1f, drop);
            var dir = toSun.y > 0.05f ? toSun.normalized : Vector3.up;
            return c + dir * Mathf.Max(8f, distance);
        }

        public void Begin(float seconds)
        {
            if (Begun || !boss) return;
            Begun = true;
            var d = boss.HDef;
            float elev = d?.risenElevation ?? 85f;
            Driver = SunShaft.All.Count == 0 ? HanbaSunDriver.Find() : null;
            var toSun = Driver ? HanbaSunDriver.Direction(elev, Driver.Azimuth) : HanbaSunDriver.Direction(elev, HanbaSunDriver.AzimuthOf(SunShaft.ToSun));
            Target = TargetFor(boss.Arena, boss.transform.position, toSun, d?.risenDistance ?? 45f, d?.riseDrop ?? 8.5f, out bool fromShaft);
            FromShaft = fromShaft;
            if (!FromShaft && Driver) Driver.DriveTo(elev, d?.sunDriveSeconds ?? 3.2f);
            var ring = boss.Ring;
            if (ring)
            {
                ring.risenScale = FromShaft ? d?.risenScale ?? 1.5f : d?.risenSkyScale ?? 2.4f;
                ring.Rise(Target, Mathf.Max(0.5f, seconds * 0.85f));
                ring.SetBlaze(1f, 2.5f);
            }
            var ex = boss.Exposure;
            if (ex)
            {
                if (FromShaft)
                {
                    ex.ringRange = ex.ringBlazeRange = d?.risenRange ?? 70f;
                    ex.ringGain = d?.risenGain ?? 0.8f;
                }
                else
                {
                    ex.ringGain = 0;
                    ex.shaftGain = d?.risenSunGain ?? 1.4f;
                }
            }
            GameAudio.PlayAt("shot_beam", boss.BodyCenter + Vector3.up * 3f, 1f, 0.35f);
            GameAudio.PlayAt("boss_roar", boss.BodyCenter, 0.8f, 0.8f);
        }
    }
}
