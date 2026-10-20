using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>落脚点从哪来：关卡标记 / 兜底搜到的高处（≥ highRise）/ 矮一些的高处 / 地面</summary>
    public enum PerchKind { None, Marker, High, Low, Ground }

    /// <summary><see cref="PerchPoint.Find"/> 的结果</summary>
    public struct PerchSpot
    {
        /// <summary>落脚面上的脚底点</summary>
        public Vector3 position;
        public PerchKind kind;
        /// <summary>关卡标记（兜底搜索 / 地面为 null）</summary>
        public PerchPoint point;
        /// <summary>比查询中心（玩家脚底）高多少</summary>
        public float rise;
        /// <summary>算「高处」（rise ≥ 查询的 highRise）：毕方在高处才不急着换栖</summary>
        public bool high;
    }

    /// <summary>
    /// 落脚点查询（Three.js 三青鸟 / 毕方的 findPerch）：以 around（玩家脚底）为圆心的水平距离带、比它高多少的高度带、看得见 targetEye、
    /// 顶上有落脚空间、不和同伴抢同一处（<see cref="PerchPoint.ClaimRadius"/>），可选要求从 from 滑翔过去的弧线不被挡。
    /// </summary>
    public struct PerchQuery
    {
        public Vector3 around, targetEye, from;
        /// <summary>离 around 的水平距离带（米）与打分的理想距离（缺省取带中点）</summary>
        public float minRange, maxRange, preferRange;
        /// <summary>比 around 高多少才算（minRise..maxRise）；≥ highRise 记为高处（打分优先）</summary>
        public float minRise, highRise, maxRise;
        /// <summary>落脚后视线的高度（米，落脚面以上）：从这里看 targetEye</summary>
        public float eyeHeight;
        /// <summary>落脚空间：半径与净空高度（米）</summary>
        public float clearance, headroom;
        /// <summary>认领者（跳过别人认领的点；自己的不算）</summary>
        public EnemyAI owner;
        /// <summary>现在站着的点（不再选它附近 2 m、高差 0.5 m 内的地方；没有就留 NaN）</summary>
        public Vector3 current;
        /// <summary>用关卡里的 <see cref="PerchPoint"/> 标记 / 用射线兜底搜索高处 / 都没有时退到地面</summary>
        public bool useMarkers, searchHigh, allowGround;
        /// <summary>地面落脚点离 around 的距离带</summary>
        public float groundMin, groundMax;
        /// <summary>要求从 from 到落脚点的滑翔弧线不被挡（最长 maxPath 米）</summary>
        public bool needPath;
        public float maxPath, pathLift;
        /// <summary>兜底搜索的射线数（缺省 28）</summary>
        public int samples;

        /// <summary>常用缺省：标记 + 兜底高处 + 地面都用，眼高 1.2 m，落脚半径 0.35 m、净空 2 m</summary>
        public PerchQuery(Vector3 around, Vector3 targetEye, Vector3 from, float minRange, float maxRange, float minRise, float maxRise, EnemyAI owner)
        {
            this.around = around;
            this.targetEye = targetEye;
            this.from = from;
            this.minRange = minRange;
            this.maxRange = maxRange;
            preferRange = (minRange + maxRange) * 0.5f;
            this.minRise = minRise;
            this.maxRise = maxRise;
            highRise = minRise;
            this.owner = owner;
            eyeHeight = 1.2f;
            clearance = 0.35f;
            headroom = 2f;
            current = new Vector3(float.NaN, float.NaN, float.NaN);
            useMarkers = searchHigh = allowGround = true;
            groundMin = minRange;
            groundMax = maxRange;
            needPath = false;
            maxPath = 34f;
            pathLift = 0.9f;
            samples = 28;
        }
    }

    /// <summary>
    /// 栖落点（docs/unity-parity.md 3.7：Three.js 扫碰撞盒顶面，Unity 改成关卡标记 + 兜底搜索）：
    ///   标记：关卡里放一个带这个组件的空物体（落脚面上的脚底点）；名字以 <see cref="MarkerPrefix"/> 开头的空物体
    ///         （TestArena 的柱顶 PerchPoint_1..3 等构建器放的标记）在第一次查询时自动补上组件，构建器不用改。
    ///   查询：<see cref="Find"/> 先挑标记，再在距离带里往下打射线找高处（柱顶、台面、屋顶、土丘，取朝玩家一侧的边），最后退到地面。
    ///   认领：<see cref="Claim"/> / <see cref="Release"/>——同时在场的飞鸟各占一处，别人认领的点 2.5 m 内不选；认领者死亡 / 销毁自动失效。
    /// </summary>
    public sealed class PerchPoint : MonoBehaviour
    {
        /// <summary>自动当成标记的物体名前缀</summary>
        public const string MarkerPrefix = "PerchPoint";
        /// <summary>别人认领的点多近以内不选（米，同 TS 毕方 claimed 的 2.5）</summary>
        public const float ClaimRadius = 2.5f;
        /// <summary>标记比兜底搜到的点优先（打分减这么多）</summary>
        const float MarkerBonus = 6f;

        [Tooltip("落脚面的可用半径（米）：只用于编辑器里画示意")]
        public float radius = 0.6f;

        static readonly List<PerchPoint> all = new();
        static readonly List<ClaimEntry> claims = new();
        static bool adopted;

        struct ClaimEntry
        {
            public EnemyAI owner;
            public Vector3 at;
            public PerchPoint point;
        }

        /// <summary>场景里的全部标记（第一次访问时把按名字认出的标记补上组件）</summary>
        public static IReadOnlyList<PerchPoint> All
        {
            get
            {
                EnsureAdopted();
                return all;
            }
        }

        /// <summary>落脚面上的脚底点</summary>
        public Vector3 Position => transform.position;

        /// <summary>认领着这个标记的敌人（没有为 null）</summary>
        public EnemyAI ClaimedBy
        {
            get
            {
                Prune();
                foreach (var c in claims)
                    if (c.point == this)
                        return c.owner;
                return null;
            }
        }

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            claims.Clear();
            adopted = false;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
        }

        static void OnSceneLoaded(Scene s, LoadSceneMode mode) => adopted = false;

        /// <summary>把名字以 PerchPoint 开头、还没有组件的空物体补上组件（每次场景加载后第一次查询时扫一遍）</summary>
        static void EnsureAdopted()
        {
            if (adopted || !Application.isPlaying) return;
            adopted = true;
            foreach (var t in FindObjectsByType<Transform>())
                if (t && t.name.StartsWith(MarkerPrefix, System.StringComparison.Ordinal) && !t.GetComponent<PerchPoint>())
                    t.gameObject.AddComponent<PerchPoint>();
        }

        // ───────────── 认领 ─────────────

        /// <summary>认领一处落脚点（同一认领者之前的认领作废）</summary>
        public static void Claim(EnemyAI owner, in PerchSpot spot)
        {
            if (!owner) return;
            Release(owner);
            claims.Add(new ClaimEntry { owner = owner, at = spot.position, point = spot.point });
        }

        /// <summary>放弃认领（起飞、死亡）</summary>
        public static void Release(EnemyAI owner)
        {
            for (int i = claims.Count - 1; i >= 0; i--)
                if (claims[i].owner == owner || !claims[i].owner)
                    claims.RemoveAt(i);
        }

        /// <summary>at 附近 radius 米内（水平，高差 3 m 内）有别人认领的点</summary>
        public static bool IsClaimed(Vector3 at, EnemyAI except, float radius = ClaimRadius)
        {
            Prune();
            foreach (var c in claims)
            {
                if (c.owner == except) continue;
                var d = c.at - at;
                if (Mathf.Abs(d.y) > 3f) continue;
                d.y = 0;
                if (d.sqrMagnitude < radius * radius) return true;
            }
            return false;
        }

        /// <summary>当前的认领数（死掉的认领者先清掉）</summary>
        public static int ClaimCount
        {
            get
            {
                Prune();
                return claims.Count;
            }
        }

        static void Prune()
        {
            for (int i = claims.Count - 1; i >= 0; i--)
                if (!claims[i].owner || claims[i].owner.Dead)
                    claims.RemoveAt(i);
        }

        // ───────────── 查询 ─────────────

        /// <summary>
        /// 找一处落脚点：标记（−6 分优先）→ 兜底搜到的高处 → 地面（allowGround）。打分同 TS 毕方：
        /// 高处 0 / 矮处 20 + |离玩家 − 理想距离| × 0.6 + 离自己 × 0.15 + 0..2 随机，小的胜出。返回结果的类型（None = 没找到）。
        /// </summary>
        public static PerchKind Find(in PerchQuery q, out PerchSpot spot)
        {
            spot = default;
            float best = float.PositiveInfinity;
            if (q.useMarkers)
            {
                EnsureAdopted();
                for (int i = 0; i < all.Count; i++)
                {
                    var p = all[i];
                    if (!p || !p.isActiveAndEnabled) continue;
                    var at = p.Position;
                    if (!InBand(q, at, out float d, out float rise)) continue;
                    if (!Usable(q, at)) continue;
                    float score = Score(q, at, d, rise) - MarkerBonus;
                    if (score >= best || !PathOk(q, at)) continue;
                    best = score;
                    spot = new PerchSpot { position = at, kind = PerchKind.Marker, point = p, rise = rise, high = rise >= q.highRise };
                }
            }
            if (q.searchHigh) SearchHigh(q, ref spot, ref best);
            if (spot.kind != PerchKind.None) return spot.kind;
            if (q.allowGround && FindGround(q, out spot)) return PerchKind.Ground;
            spot = default;
            return PerchKind.None;
        }

        /// <summary>水平距离与高差都在带内</summary>
        static bool InBand(in PerchQuery q, Vector3 at, out float d, out float rise)
        {
            var flat = at - q.around;
            rise = flat.y;
            flat.y = 0;
            d = flat.magnitude;
            return d >= q.minRange && d <= q.maxRange && rise >= q.minRise && rise <= q.maxRise;
        }

        /// <summary>不是现在站的地方、没被别人认领、看得见目标</summary>
        static bool Usable(in PerchQuery q, Vector3 at)
        {
            if (float.IsFinite(q.current.x))
            {
                var c = at - q.current;
                if (Mathf.Abs(c.y) < 0.5f && new Vector2(c.x, c.z).sqrMagnitude < 4f) return false;
            }
            if (IsClaimed(at, q.owner)) return false;
            return Sight.Clear(at + Vector3.up * q.eyeHeight, q.targetEye);
        }

        static float Score(in PerchQuery q, Vector3 at, float d, float rise)
        {
            var self = at - q.from;
            self.y = 0;
            return (rise >= q.highRise ? 0 : 20) + Mathf.Abs(d - q.preferRange) * 0.6f + self.magnitude * 0.15f + Random.Range(0f, 2f);
        }

        static bool PathOk(in PerchQuery q, Vector3 at) => !q.needPath || GlidePathClear(q.from, at, q.pathLift, q.maxPath);

        /// <summary>
        /// 兜底：距离带里按角度分层打 samples 根向下的射线，命中的顶面在高度带内、够平（四周 clearance 处也是同一高度）、头顶有净空，
        /// 再沿顶面朝玩家走到边上（留 clearance 余量：站在边上俯视），看得见目标的参与打分
        /// </summary>
        static void SearchHigh(in PerchQuery q, ref PerchSpot spot, ref float best)
        {
            int n = q.samples > 0 ? q.samples : 28;
            float top0 = q.around.y + q.maxRise + 1.5f;
            float reach = q.maxRise - q.minRise + 1.5f;
            float a0 = Random.value * Mathf.PI * 2f;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + (i + Random.value * 0.6f) / n * Mathf.PI * 2f;
                float r = Mathf.Lerp(q.minRange, q.maxRange, Mathf.Sqrt(Random.value));
                var origin = new Vector3(q.around.x + Mathf.Cos(a) * r, top0, q.around.z + Mathf.Sin(a) * r);
                if (!Physics.Raycast(origin, Vector3.down, out var hit, reach, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (hit.normal.y < 0.8f) continue;
                var at = EdgeToward(hit.point, q.around, q.clearance);
                if (!Flat(at, q.clearance) || !Headroom(at, q)) continue;
                if (!InBand(q, at, out float d, out float rise)) continue;
                if (!Usable(q, at)) continue;
                float score = Score(q, at, d, rise);
                if (score >= best || !PathOk(q, at)) continue;
                best = score;
                spot = new PerchSpot { position = at, kind = rise >= q.highRise ? PerchKind.High : PerchKind.Low, rise = rise, high = rise >= q.highRise };
            }
        }

        /// <summary>沿顶面朝 toward 走（每步 0.5 m，最多 12 步），停在还站得住（脚下同一高度、留 margin）的最后一点</summary>
        static Vector3 EdgeToward(Vector3 top, Vector3 toward, float margin)
        {
            var dir = toward - top;
            dir.y = 0;
            float len = dir.magnitude;
            if (len < 0.5f) return top;
            dir /= len;
            var at = top;
            for (int i = 0; i < 12 && (i + 1) * 0.5f < len; i++)
            {
                var next = at + dir * 0.5f;
                if (!SameLevel(next + dir * margin, top.y)) break;
                if (!SameLevel(next, top.y, out float y)) break;
                at = new Vector3(next.x, y, next.z);
            }
            return at;
        }

        static bool SameLevel(Vector3 p, float y) => SameLevel(p, y, out _);

        /// <summary>p 正下方（从 y 上方 1 m 往下 1.3 m）有顶面，且和 y 差不到 0.15 m</summary>
        static bool SameLevel(Vector3 p, float y, out float hitY)
        {
            hitY = y;
            if (!Physics.Raycast(new Vector3(p.x, y + 1f, p.z), Vector3.down, out var h, 1.3f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            hitY = h.point.y;
            return Mathf.Abs(h.point.y - y) < 0.15f && h.normal.y >= 0.8f;
        }

        /// <summary>四周 margin 处都是同一高度的顶面（站得下）</summary>
        static bool Flat(Vector3 at, float margin)
        {
            float m = Mathf.Max(0.1f, margin);
            return SameLevel(at + new Vector3(m, 0, 0), at.y) && SameLevel(at + new Vector3(-m, 0, 0), at.y)
                && SameLevel(at + new Vector3(0, 0, m), at.y) && SameLevel(at + new Vector3(0, 0, -m), at.y);
        }

        static bool Headroom(Vector3 at, in PerchQuery q)
        {
            float r = Mathf.Max(0.1f, q.clearance);
            var a = at + Vector3.up * (r + 0.1f);
            var b = at + Vector3.up * Mathf.Max(r + 0.1f, q.headroom - r);
            return !Physics.CheckCapsule(a, b, r, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>地面：距离带里随机 8 个导航网格点，眼高处看得见目标、没被认领</summary>
        static bool FindGround(in PerchQuery q, out PerchSpot spot)
        {
            for (int i = 0; i < 8; i++)
            {
                if (!Sight.RandomGround(q.around, q.groundMin, q.groundMax, out var g)) continue;
                if (IsClaimed(g, q.owner)) continue;
                if (!Sight.Clear(g + Vector3.up * q.eyeHeight, q.targetEye)) continue;
                if (!PathOk(q, g)) continue;
                spot = new PerchSpot { position = g, kind = PerchKind.Ground, rise = g.y - q.around.y };
                return true;
            }
            spot = default;
            return false;
        }

        /// <summary>
        /// 滑翔弧线逐段不被挡（Three.js 毕方 glidePathClear）：水平距离 ≤ maxDist；顶点高 0.8 + 0.06 × 距离 + 上升量 × 0.25，
        /// 弧线抬高 lift（身体中心高度），分 8 段做遮挡检测
        /// </summary>
        public static bool GlidePathClear(Vector3 a, Vector3 b, float lift, float maxDist = 34f)
        {
            float dist = new Vector2(b.x - a.x, b.z - a.z).magnitude;
            if (dist > maxDist) return false;
            float apex = 0.8f + 0.06f * dist + Mathf.Max(0, b.y - a.y) * 0.25f;
            const int n = 8;
            var prev = a + Vector3.up * lift;
            for (int i = 1; i <= n; i++)
            {
                float s = i / (float)n;
                var p = Vector3.Lerp(a, b, s) + Vector3.up * (apex * Mathf.Sin(Mathf.PI * s) + lift);
                if (Combat.Blocked(prev, p, null)) return false;
                prev = p;
            }
            return true;
        }

#if UNITY_EDITOR
        void OnDrawGizmos()
        {
            Gizmos.color = new Color(0.4f, 0.85f, 1f, 0.8f);
            Gizmos.DrawWireSphere(transform.position + Vector3.up * 0.05f, radius);
            Gizmos.DrawLine(transform.position, transform.position + Vector3.up * 1.2f);
        }
#endif
    }
}
