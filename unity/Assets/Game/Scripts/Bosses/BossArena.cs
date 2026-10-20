using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>首领场地的形状：圆（中心 + 半径）或矩形（本地 XZ 半宽，跟着物体的朝向转）</summary>
    public enum BossArenaShape { Circle, Box }

    /// <summary>
    /// 首领场地锚点（docs/unity-parity.md 1.2「首领从导航网格反推场地 → 关卡里放 BossArena 显式锚点」，4.6 关卡场景标记）：
    /// 关卡构建器（或手摆）放在首领场里，物体位置 = 场地中心（地面高度），首领的走位、落点、召唤、冲撞路径都以它为界。
    ///   形状：圆（<see cref="radius"/>）或矩形（<see cref="halfSize"/>），可玩地面在边界以内；
    ///   锚点：首领出生点、玩家入场点、召唤点、掩体点、栖落点（鹏落台、毕方栖柱）、边缘点（绕场跑道、冲撞起点）。
    /// 锚点数组空着时，Awake 按子物体名字收集（BossSpawn / PlayerEntry / Summon* / Cover* / Perch* / Edge*），手摆场地不用逐个拖。
    /// 场景里可以有多个（1-4 的补给营另有一个），按 <see cref="bossId"/> 找；关卡里没放时测试可以 <see cref="CreateRuntime"/> 临时建一个。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BossArena : MonoBehaviour
    {
        [Tooltip("给哪个首领用（BossDef.id）；空 = 任何首领")] public string bossId;
        public BossArenaShape shape = BossArenaShape.Circle;
        [Tooltip("圆形场地的半径（米）")] public float radius = 20f;
        [Tooltip("矩形场地的半宽（本地 X / Z，米）")] public Vector2 halfSize = new(20, 20);

        [Header("锚点")]
        public Transform bossSpawn;
        public Transform playerEntry;
        public Transform[] summonPoints = Array.Empty<Transform>();
        public Transform[] coverPoints = Array.Empty<Transform>();
        public Transform[] perchPoints = Array.Empty<Transform>();
        public Transform[] edgePoints = Array.Empty<Transform>();

        static readonly List<BossArena> all = new();

        /// <summary>场景里启用中的首领场地</summary>
        public static IReadOnlyList<BossArena> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake() => CollectByName();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>
        /// 找场地：先找 <see cref="bossId"/> 对得上的，再找通用的（bossId 为空）；同类里取离 near 最近的（没给 near 取第一个）。没有返回 null
        /// </summary>
        public static BossArena Find(string forBoss, Vector3? near = null)
        {
            BossArena best = null;
            int bestRank = int.MaxValue;
            float bestD = float.PositiveInfinity;
            foreach (var a in all)
            {
                if (!a) continue;
                int rank = !string.IsNullOrEmpty(forBoss) && a.bossId == forBoss ? 0 : string.IsNullOrEmpty(a.bossId) ? 1 : 2;
                if (rank == 2) continue;
                float d = near.HasValue ? (a.Center - near.Value).sqrMagnitude : 0;
                if (rank > bestRank || (rank == bestRank && d >= bestD)) continue;
                best = a;
                bestRank = rank;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 运行时临时建一个圆形场地（测试场 / 关卡还没放锚点时）：出生点在中心往 forward 方向 radius × 0.35，
        /// 玩家入场点在反方向 radius × 0.7，四个召唤点、八个边缘点均匀分布
        /// </summary>
        public static BossArena CreateRuntime(Vector3 center, float radius, Vector3 forward, string forBoss = null, Transform parent = null)
        {
            forward.y = 0;
            forward = forward.sqrMagnitude > 1e-4f ? forward.normalized : Vector3.forward;
            var go = new GameObject($"BossArena (runtime{(string.IsNullOrEmpty(forBoss) ? "" : " " + forBoss)})");
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(center, Quaternion.LookRotation(forward));
            var a = go.AddComponent<BossArena>();
            a.bossId = forBoss;
            a.radius = Mathf.Max(4f, radius);
            a.bossSpawn = Point(go.transform, "BossSpawn", new Vector3(0, 0, a.radius * 0.35f), Quaternion.LookRotation(Vector3.back));
            a.playerEntry = Point(go.transform, "PlayerEntry", new Vector3(0, 0, -a.radius * 0.7f), Quaternion.identity);
            a.summonPoints = Ring(go.transform, "Summon", 4, a.radius * 0.55f, 45f);
            a.edgePoints = Ring(go.transform, "Edge", 8, a.radius, 0f);
            go.SetActive(true);
            return a;
        }

        static Transform Point(Transform parent, string name, Vector3 local, Quaternion rot)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.localPosition = local;
            t.localRotation = rot;
            return t;
        }

        static Transform[] Ring(Transform parent, string prefix, int n, float r, float startDeg)
        {
            var list = new Transform[n];
            for (int i = 0; i < n; i++)
            {
                float a = (startDeg + 360f * i / n) * Mathf.Deg2Rad;
                var local = new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
                list[i] = Point(parent, $"{prefix}_{i + 1}", local, Quaternion.LookRotation(-local.normalized));
            }
            return list;
        }

        /// <summary>锚点数组空着时按子物体名字收集（大小写不敏感的前缀）</summary>
        void CollectByName()
        {
            bool needSummon = summonPoints == null || summonPoints.Length == 0, needCover = coverPoints == null || coverPoints.Length == 0,
                needPerch = perchPoints == null || perchPoints.Length == 0, needEdge = edgePoints == null || edgePoints.Length == 0;
            if (!needSummon && !needCover && !needPerch && !needEdge && bossSpawn && playerEntry) return;
            List<Transform> s = new(), c = new(), p = new(), e = new();
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                if (t == transform) continue;
                var n = t.name;
                if (!bossSpawn && n.StartsWith("BossSpawn", StringComparison.OrdinalIgnoreCase)) bossSpawn = t;
                else if (!playerEntry && n.StartsWith("PlayerEntry", StringComparison.OrdinalIgnoreCase)) playerEntry = t;
                else if (n.StartsWith("Summon", StringComparison.OrdinalIgnoreCase)) s.Add(t);
                else if (n.StartsWith("Cover", StringComparison.OrdinalIgnoreCase)) c.Add(t);
                else if (n.StartsWith("Perch", StringComparison.OrdinalIgnoreCase)) p.Add(t);
                else if (n.StartsWith("Edge", StringComparison.OrdinalIgnoreCase)) e.Add(t);
            }
            if (needSummon) summonPoints = s.ToArray();
            if (needCover) coverPoints = c.ToArray();
            if (needPerch) perchPoints = p.ToArray();
            if (needEdge) edgePoints = e.ToArray();
        }

        // ───────────── 几何 ─────────────

        /// <summary>场地中心（地面）</summary>
        public Vector3 Center => transform.position;
        /// <summary>场地地面高度（中心的 y）</summary>
        public float FloorY => transform.position.y;
        /// <summary>场地的「半径」：圆为半径，矩形为较短的半宽（走位、召唤圈的尺度参考）</summary>
        public float Extent => shape == BossArenaShape.Circle ? radius : Mathf.Min(halfSize.x, halfSize.y);

        /// <summary>首领出生点（没放锚点时 = 中心）</summary>
        public Vector3 BossSpawnPoint => bossSpawn ? bossSpawn.position : Center;
        /// <summary>首领出生朝向（没放锚点时朝玩家入场点）</summary>
        public Quaternion BossSpawnRotation
        {
            get
            {
                if (bossSpawn) return bossSpawn.rotation;
                var d = PlayerEntryPoint - Center;
                d.y = 0;
                return d.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(d) : transform.rotation;
            }
        }

        /// <summary>玩家入场点（没放锚点时在中心往 −forward 方向 0.7 × 场地尺度）</summary>
        public Vector3 PlayerEntryPoint => playerEntry ? playerEntry.position : Center - Flat(transform.forward) * Extent * 0.7f;

        /// <summary>水平面上 p 在场地里（离边界至少 margin 米；margin 可为负 = 放宽）</summary>
        public bool Contains(Vector3 p, float margin = 0)
        {
            if (!float.IsFinite(p.x) || !float.IsFinite(p.z)) return false;
            if (shape == BossArenaShape.Circle)
            {
                float r = radius - margin;
                if (r <= 0) return false;
                var d = p - Center;
                d.y = 0;
                return d.sqrMagnitude <= r * r;
            }
            var l = transform.InverseTransformPoint(p);
            return Mathf.Abs(l.x) <= halfSize.x - margin && Mathf.Abs(l.z) <= halfSize.y - margin;
        }

        /// <summary>把 p 的水平位置夹进场地（离边界 margin 米以内），高度不变</summary>
        public Vector3 Clamp(Vector3 p, float margin = 0)
        {
            if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)) return Center;
            if (shape == BossArenaShape.Circle)
            {
                float r = Mathf.Max(0, radius - margin);
                var d = p - Center;
                d.y = 0;
                if (d.sqrMagnitude <= r * r) return p;
                var q = Center + d.normalized * r;
                q.y = p.y;
                return q;
            }
            var l = transform.InverseTransformPoint(p);
            float hx = Mathf.Max(0, halfSize.x - margin), hz = Mathf.Max(0, halfSize.y - margin);
            l.x = Mathf.Clamp(l.x, -hx, hx);
            l.z = Mathf.Clamp(l.z, -hz, hz);
            var w = transform.TransformPoint(l);
            w.y = p.y;
            return w;
        }

        /// <summary>
        /// 从 from 沿水平方向 dir 走到边界（留 margin）还有多远（Three.js distToArenaEdge）：冲撞、俯冲掠台按它截短路径。
        /// from 已在边界外或方向退化时为 0
        /// </summary>
        public float DistanceToEdge(Vector3 from, Vector3 dir, float margin = 0)
        {
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-8f || !Contains(from, margin)) return 0;
            dir.Normalize();
            if (shape == BossArenaShape.Circle)
            {
                float r = radius - margin;
                var o = from - Center;
                o.y = 0;
                float b = Vector3.Dot(o, dir), c = o.sqrMagnitude - r * r;
                float disc = b * b - c;
                return disc < 0 ? 0 : Mathf.Max(0, -b + Mathf.Sqrt(disc));
            }
            var lo = transform.InverseTransformPoint(from);
            var ld = transform.InverseTransformDirection(dir);
            float t = float.PositiveInfinity;
            float hx = halfSize.x - margin, hz = halfSize.y - margin;
            if (ld.x > 1e-5f) t = Mathf.Min(t, (hx - lo.x) / ld.x);
            else if (ld.x < -1e-5f) t = Mathf.Min(t, (-hx - lo.x) / ld.x);
            if (ld.z > 1e-5f) t = Mathf.Min(t, (hz - lo.z) / ld.z);
            else if (ld.z < -1e-5f) t = Mathf.Min(t, (-hz - lo.z) / ld.z);
            return float.IsFinite(t) ? Mathf.Max(0, t) : 0;
        }

        /// <summary>场地里随机一点（离边界 margin 米以内，贴到 4 m 内的导航网格上；找不到网格时原样返回）</summary>
        public Vector3 RandomPoint(float margin = 2f, RunRng rng = null)
        {
            Vector3 p;
            float r1 = rng != null ? rng.Value : UnityEngine.Random.value, r2 = rng != null ? rng.Value : UnityEngine.Random.value;
            if (shape == BossArenaShape.Circle)
            {
                float r = Mathf.Max(0, radius - margin) * Mathf.Sqrt(r1);
                float a = r2 * Mathf.PI * 2;
                p = Center + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
            }
            else
            {
                float hx = Mathf.Max(0, halfSize.x - margin), hz = Mathf.Max(0, halfSize.y - margin);
                p = transform.TransformPoint(new Vector3((r1 * 2 - 1) * hx, 0, (r2 * 2 - 1) * hz));
                p.y = FloorY;
            }
            return NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas) ? hit.position : p;
        }

        /// <summary>一组锚点里离 p 最近的（没有返回 null）</summary>
        public static Transform Nearest(Transform[] points, Vector3 p)
        {
            Transform best = null;
            float bestD = float.PositiveInfinity;
            if (points == null) return null;
            foreach (var t in points)
            {
                if (!t) continue;
                float d = (t.position - p).sqrMagnitude;
                if (d >= bestD) continue;
                best = t;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 掩体点：离 from 最近、且站在它后面能挡住 threat 的（掩体点到 threat 的连线被地形 / 建筑挡住）；都挡不住时返回最近的那个，没有掩体点返回 null
        /// </summary>
        public Transform NearestCover(Vector3 from, Vector3 threat)
        {
            Transform best = null, any = null;
            float bestD = float.PositiveInfinity, anyD = float.PositiveInfinity;
            if (coverPoints == null) return null;
            foreach (var t in coverPoints)
            {
                if (!t) continue;
                float d = (t.position - from).sqrMagnitude;
                if (d < anyD)
                {
                    anyD = d;
                    any = t;
                }
                if (d >= bestD) continue;
                if (Combat.LineClear(t.position + Vector3.up * 1.2f, threat)) continue;
                best = t;
                bestD = d;
            }
            return best ? best : any;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.45f, 0.2f, 0.9f);
            if (shape == BossArenaShape.Circle)
            {
                const int n = 48;
                for (int i = 0; i < n; i++)
                {
                    float a0 = i * Mathf.PI * 2 / n, a1 = (i + 1) * Mathf.PI * 2 / n;
                    Gizmos.DrawLine(Center + new Vector3(Mathf.Sin(a0), 0, Mathf.Cos(a0)) * radius, Center + new Vector3(Mathf.Sin(a1), 0, Mathf.Cos(a1)) * radius);
                }
            }
            else
            {
                Gizmos.matrix = transform.localToWorldMatrix;
                Gizmos.DrawWireCube(Vector3.zero, new Vector3(halfSize.x * 2, 0.1f, halfSize.y * 2));
                Gizmos.matrix = Matrix4x4.identity;
            }
            void Dots(Transform[] pts, Color c, float r)
            {
                if (pts == null) return;
                Gizmos.color = c;
                foreach (var t in pts)
                    if (t)
                        Gizmos.DrawSphere(t.position, r);
            }
            Dots(summonPoints, new Color(0.9f, 0.3f, 0.9f), 0.5f);
            Dots(coverPoints, new Color(0.3f, 0.8f, 0.4f), 0.5f);
            Dots(perchPoints, new Color(0.3f, 0.6f, 1f), 0.5f);
            Dots(edgePoints, new Color(1f, 0.8f, 0.2f), 0.35f);
            Gizmos.color = Color.red;
            if (bossSpawn) Gizmos.DrawWireSphere(bossSpawn.position, 1.2f);
            Gizmos.color = Color.cyan;
            if (playerEntry) Gizmos.DrawWireSphere(playerEntry.position, 0.8f);
        }
    }
}
