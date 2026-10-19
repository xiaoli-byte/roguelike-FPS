using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 投射物的常数与纯数学（Three.js 版 src/combat/Projectiles.ts 的参数区 + 线段几何）。全部无副作用，EditMode 测试直接调。
    /// </summary>
    public static class ProjectileMath
    {
        /// <summary>反弹：法向速度保留 55%（反向）、切向保留 78%（同 TS BOUNCE_NORMAL_KEEP / BOUNCE_TANGENT_KEEP）</summary>
        public const float BounceNormalKeep = 0.55f, BounceTangentKeep = 0.78f;
        /// <summary>会反弹的投射物落地时法向速度低于这个值就改为贴地滚动（不消耗反弹次数，TS ROLL_SPEED）</summary>
        public const float RollSpeed = 2.2f;
        /// <summary>滚动摩擦（每秒指数衰减）：沿用 Unity 现值 2.5（TS 2.8）</summary>
        public const float RollFriction = 2.5f;
        /// <summary>反弹用完后开始滚动（rollAfter）那一下保留的速度</summary>
        public const float RollEntryKeep = 0.7f;
        /// <summary>玩家追踪弹：发射后多久开始转向（让齐射散开）、多久复查一次目标、选目标范围</summary>
        public const float PlayerHomingDelay = 0.1f, HomingRetarget = 0.25f, PlayerHomingRange = 40f;
        /// <summary>敌方追踪弹瞄准的胸口高度（TS PLAYER_CHEST）</summary>
        public const float PlayerChest = 1.15f;
        /// <summary>一帧内最多拆成几段（反弹 / 穿透之后继续走完剩下的路程）</summary>
        public const int MaxSubsteps = 5;
        /// <summary>低于这个高度直接回收（掉出世界）</summary>
        public const float KillY = -500f;

        /// <summary>
        /// 撞到表面后的速度：v = 切向 × 0.78 − 法向 × 0.55（normal 为单位向量；v·n ≥ 0 时已在远离表面，原样返回）
        /// </summary>
        public static Vector3 Bounce(Vector3 v, Vector3 normal)
        {
            float vn = Vector3.Dot(v, normal);
            if (vn >= 0) return v;
            var normalPart = normal * vn;
            return (v - normalPart) * BounceTangentKeep - normalPart * BounceNormalKeep;
        }

        /// <summary>
        /// 玩家追踪弹选目标的评分（越小越好，TS pickTarget）：以偏离飞行方向的角度为主、距离为辅。
        /// 偏 10° ≈ 0.45 分、45° ≈ 8.8 分；每米 0.15 分。cos &lt; −0.1（身后）不选，返回 +∞
        /// </summary>
        public static float HomingScore(float cos, float dist) => cos < -0.1f ? float.PositiveInfinity : (1 - cos) * 30f + dist * 0.15f;

        /// <summary>
        /// 线段 origin + dir × [0, segLen] 是否穿过圆盘（圆心 center、法线 normal、半径 radius）；t = 穿过点沿线段的距离。
        /// 两面都挡（同 TS crossesWard）；与圆盘平行的线段不算。
        /// </summary>
        public static bool CrossesDisc(Vector3 center, Vector3 normal, float radius, Vector3 origin, Vector3 dir, float segLen, out float t)
        {
            t = 0;
            float dn = Vector3.Dot(dir, normal);
            if (Mathf.Abs(dn) < 1e-5f) return false;
            t = Vector3.Dot(center - origin, normal) / dn;
            if (t < 0 || t > segLen) return false;
            return (origin + dir * t - center).sqrMagnitude <= radius * radius;
        }

        /// <summary>
        /// 线段从球外进入球（圆心 center、半径 radius）：t = 进入点沿线段的距离。起点已在球内的不算（球里打出来的弹不被自己的罩子吃掉）
        /// </summary>
        public static bool EntersSphere(Vector3 center, float radius, Vector3 origin, Vector3 dir, float segLen, out float t)
        {
            t = 0;
            var m = origin - center;
            float c = m.sqrMagnitude - radius * radius;
            if (c <= 0) return false;
            float b = Vector3.Dot(m, dir);
            if (b > 0) return false;
            float disc = b * b - c;
            if (disc < 0) return false;
            t = -b - Mathf.Sqrt(disc);
            return t >= 0 && t <= segLen;
        }

        /// <summary>两条线段 p1→q1、p2→q2 的最近距离（Ericson《Real-Time Collision Detection》5.1.9）；s = 第一条线段上最近点的参数 [0, 1]</summary>
        public static float SegmentSegmentDistance(Vector3 p1, Vector3 q1, Vector3 p2, Vector3 q2, out float s)
        {
            var d1 = q1 - p1;
            var d2 = q2 - p2;
            var r = p1 - p2;
            float a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2), f = Vector3.Dot(d2, r);
            float t;
            if (a <= 1e-6f && e <= 1e-6f)
            {
                s = 0;
                return r.magnitude;
            }
            if (a <= 1e-6f)
            {
                s = 0;
                t = Mathf.Clamp01(f / e);
            }
            else
            {
                float c = Vector3.Dot(d1, r);
                if (e <= 1e-6f)
                {
                    t = 0;
                    s = Mathf.Clamp01(-c / a);
                }
                else
                {
                    float b = Vector3.Dot(d1, d2), denom = a * e - b * b;
                    s = denom != 0 ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
                    t = (b * s + f) / e;
                    if (t < 0)
                    {
                        t = 0;
                        s = Mathf.Clamp01(-c / a);
                    }
                    else if (t > 1)
                    {
                        t = 1;
                        s = Mathf.Clamp01((b - c) / a);
                    }
                }
            }
            return ((p1 + d1 * s) - (p2 + d2 * t)).magnitude;
        }

        public static float SegmentSegmentDistance(Vector3 p1, Vector3 q1, Vector3 p2, Vector3 q2) => SegmentSegmentDistance(p1, q1, p2, q2, out _);

        /// <summary>
        /// 抛物线初速度：从 from 经 flightTime 秒落到 to（重力 gravity），水平匀速、竖直按落差补偿
        /// </summary>
        public static Vector3 Ballistic(Vector3 from, Vector3 to, float flightTime, float gravity)
        {
            var d = to - from;
            var flat = new Vector3(d.x, 0, d.z) / flightTime;
            flat.y = (d.y + 0.5f * gravity * flightTime * flightTime) / flightTime;
            return flat;
        }

        /// <summary>有限向量（上游传进 NaN / 无穷时拒绝发射，免得污染运动积分）</summary>
        public static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);

        /// <summary>有限且为正就用它，否则用缺省值（TS num()）</summary>
        public static float Positive(float v, float fallback) => float.IsFinite(v) && v > 0 ? v : fallback;
    }
}
