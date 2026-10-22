using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 祝融炉心殿的几何（3-4，docs/level-design/maps/3-4.md；Three.js QilinArena.locateFurnace 的 Unity 版）：
    /// Three.js 从熔岩掩码 / 导航网格反推熔池、殿墙、渠、桥、象限；Unity 由关卡构建器显式声明（docs/unity-parity.md 1.2「场地给显式锚点」），
    /// 挂在首领场地（<see cref="BossArena"/>）同一个物体上，物体位置 = 熔池圆心（殿内地面高度）。
    ///   熔池半径 <see cref="poolRadius"/>（7 m）、殿墙内侧可走到的半径 <see cref="wallRadius"/>（24 m）、外环跑道 <see cref="trackRadius"/>；
    ///   四条放射状熔岩渠的方位 <see cref="channelYaws"/>（世界 yaw，度，0 = +Z 北，升序）与渠上窄桥的内外半径（<see cref="bridgeInner"/>–<see cref="bridgeOuter"/>，这一段没有熔岩）；
    ///   四个象限 = 相邻两条渠的中线（<see cref="QuadrantYaw"/>）：锁扣、饮熔点、吊鼎的四个角都在象限中线上；
    ///   炉口（<see cref="mouths"/>：饮熔时炭童从这里钻出）、高排烟口（<see cref="vents"/>：焚身的神火飞鸦，BS5）。
    /// 关卡里没放时（测试场）<see cref="CreateRuntime"/> 按场地尺寸推一份（渠在对角线上，同 TS 的 found = false 兜底）。
    /// 角度一律世界 yaw（度）：yaw = atan2(dx, dz)，0 = 北（+Z）、90 = 东（+X）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class QilinFurnace : MonoBehaviour
    {
        [Tooltip("熔池半径（米）")] public float poolRadius = 7f;
        [Tooltip("殿墙内侧可走到的半径（米）")] public float wallRadius = 24f;
        [Tooltip("外环跑道半径（米）：踏火奔驰沿它绕场")] public float trackRadius = 20.8f;
        [Tooltip("渠上窄桥（没有熔岩的一段）的内外半径（米）")] public float bridgeInner = 10f, bridgeOuter = 14f;
        [Tooltip("熔岩渠半宽（米）")] public float channelHalfWidth = 0.8f;
        [Tooltip("四条熔岩渠的方位（世界 yaw，度，升序）")] public float[] channelYaws = { -135f, -45f, 45f, 135f };
        [Tooltip("炉口（地面点）：饮熔时炭童从这里钻出")] public Transform[] mouths = System.Array.Empty<Transform>();
        [Tooltip("高排烟口（空中点）：焚身的神火飞鸦（BS5）")] public Transform[] vents = System.Array.Empty<Transform>();

        static readonly List<QilinFurnace> all = new();

        /// <summary>场景里启用中的炉心殿</summary>
        public static IReadOnlyList<QilinFurnace> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        // ───────────── 查找 / 兜底 ─────────────

        /// <summary>首领场地上的炉心殿：同物体上的优先，否则取离场地中心最近的；都没有返回 null</summary>
        public static QilinFurnace For(BossArena arena)
        {
            if (arena && arena.TryGetComponent<QilinFurnace>(out var own) && own.isActiveAndEnabled) return own;
            return Nearest(arena ? arena.Center : (Vector3?)null);
        }

        /// <summary>离 near 最近的炉心殿（没给 near 取第一个）</summary>
        public static QilinFurnace Nearest(Vector3? near)
        {
            QilinFurnace best = null;
            float bestD = float.PositiveInfinity;
            foreach (var f in all)
            {
                if (!f) continue;
                float d = near.HasValue ? (f.Center - near.Value).sqrMagnitude : 0;
                if (d >= bestD) continue;
                best = f;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 测试场 / 关卡没放标记时按场地推一份（挂在场地物体上）：殿墙 = 场地尺度，熔池 = 墙的 0.29（24 m 的殿配 7 m 的池），
        /// 渠在四条对角线上、窄桥在池外 3–7 m，跑道离墙 3.2 m（同 TS 的 trackR）；没有炉口 / 排烟口
        /// </summary>
        public static QilinFurnace CreateRuntime(BossArena arena)
        {
            if (!arena) return null;
            var f = arena.gameObject.AddComponent<QilinFurnace>();
            f.wallRadius = Mathf.Max(8f, arena.Extent);
            f.poolRadius = Mathf.Clamp(f.wallRadius * 0.29f, 2f, 9f);
            f.bridgeInner = f.poolRadius + 3f;
            f.bridgeOuter = f.poolRadius + 7f;
            f.trackRadius = Mathf.Max(f.bridgeOuter + 3f, f.wallRadius - 3.2f);
            f.mouths = arena.summonPoints ?? System.Array.Empty<Transform>();
            return f;
        }

        // ───────────── 几何 ─────────────

        /// <summary>熔池圆心（殿内地面）</summary>
        public Vector3 Center => transform.position;
        public float FloorY => transform.position.y;
        public int QuadrantCount => channelYaws?.Length ?? 0;

        /// <summary>第 i 个象限的中线方位（度）：在 channelYaws[i] 与 channelYaws[i + 1] 之间（最后一个跨过 180°）</summary>
        public float QuadrantYaw(int i)
        {
            int n = QuadrantCount;
            if (n == 0) return 0;
            i = ((i % n) + n) % n;
            float a = channelYaws[i], b = i + 1 < n ? channelYaws[i + 1] : channelYaws[0] + 360f;
            return Mathf.DeltaAngle(0, (a + b) * 0.5f);
        }

        /// <summary>圆心朝 yaw（度）方向、离圆心 dist 米的点（殿内地面高度）</summary>
        public Vector3 Point(float yawDeg, float dist)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            var c = Center;
            return new Vector3(c.x + Mathf.Sin(a) * dist, c.y, c.z + Mathf.Cos(a) * dist);
        }

        /// <summary>p 相对圆心的方位（度）</summary>
        public float YawOf(Vector3 p) => Mathf.Atan2(p.x - Center.x, p.z - Center.z) * Mathf.Rad2Deg;

        /// <summary>p 离圆心的水平距离</summary>
        public float RadiusOf(Vector3 p)
        {
            var d = p - Center;
            d.y = 0;
            return d.magnitude;
        }

        /// <summary>p 落在哪个象限（离哪条象限中线最近）</summary>
        public int QuadrantOf(Vector3 p)
        {
            float a = YawOf(p);
            int best = 0;
            float bestD = float.PositiveInfinity;
            for (int i = 0; i < QuadrantCount; i++)
            {
                float d = Mathf.Abs(Mathf.DeltaAngle(a, QuadrantYaw(i)));
                if (d >= bestD) continue;
                bestD = d;
                best = i;
            }
            return best;
        }

        /// <summary>
        /// 俯视（北朝上）顺时针的下一个象限（熔流轮转，BS5）：Unity 里 +Z 是北、+X 是东，顺时针 = 方位角递增
        /// （TS 的平面图 +y 朝南，所以那边写的是「方位角递减」）
        /// </summary>
        public int ClockwiseNext(int q)
        {
            int n = QuadrantCount, best = q;
            float bestD = float.PositiveInfinity;
            for (int i = 0; i < n; i++)
            {
                if (i == q) continue;
                float d = Mathf.Repeat(QuadrantYaw(i) - QuadrantYaw(q), 360f);
                if (d <= 0.01f || d >= bestD) continue;
                bestD = d;
                best = i;
            }
            return best;
        }

        /// <summary>点 p 在熔岩渠上（池外、窄桥以外的那两段；margin 往外扩）</summary>
        public bool OnChannel(Vector3 p, float margin = 0)
        {
            float r = RadiusOf(p);
            if (r < poolRadius || r > wallRadius + 1f) return false;
            if (r > bridgeInner - channelHalfWidth && r < bridgeOuter + channelHalfWidth) return false;
            float a = YawOf(p) * Mathf.Deg2Rad;
            foreach (float y in channelYaws)
            {
                float d = Mathf.Abs(Mathf.Sin(a - y * Mathf.Deg2Rad)) * r;
                if (d <= channelHalfWidth + margin && Mathf.Cos(a - y * Mathf.Deg2Rad) > 0) return true;
            }
            return false;
        }

        /// <summary>离 yaw 最近的炉口（没有返回 null）</summary>
        public Transform MouthNear(float yawDeg)
        {
            Transform best = null;
            float bestD = float.PositiveInfinity;
            if (mouths == null) return null;
            foreach (var m in mouths)
            {
                if (!m) continue;
                float d = Mathf.Abs(Mathf.DeltaAngle(YawOf(m.position), yawDeg));
                if (d >= bestD) continue;
                bestD = d;
                best = m;
            }
            return best;
        }

        void OnDrawGizmos()
        {
            var c = Center;
            void Circle(float r, Color col)
            {
                Gizmos.color = col;
                const int n = 48;
                for (int i = 0; i < n; i++)
                {
                    float a0 = i * Mathf.PI * 2 / n, a1 = (i + 1) * Mathf.PI * 2 / n;
                    Gizmos.DrawLine(c + new Vector3(Mathf.Sin(a0), 0.1f, Mathf.Cos(a0)) * r, c + new Vector3(Mathf.Sin(a1), 0.1f, Mathf.Cos(a1)) * r);
                }
            }
            Circle(poolRadius, new Color(1f, 0.4f, 0.1f));
            Circle(trackRadius, new Color(1f, 0.85f, 0.3f));
            Circle(wallRadius, new Color(0.6f, 0.5f, 0.5f));
            Gizmos.color = new Color(1f, 0.3f, 0.05f);
            if (channelYaws != null)
                foreach (float y in channelYaws)
                    Gizmos.DrawLine(Point(y, poolRadius) + Vector3.up * 0.1f, Point(y, wallRadius) + Vector3.up * 0.1f);
            Gizmos.color = Color.cyan;
            for (int i = 0; i < QuadrantCount; i++) Gizmos.DrawWireSphere(Point(QuadrantYaw(i), poolRadius + 3.1f), 0.6f);
        }
    }
}
