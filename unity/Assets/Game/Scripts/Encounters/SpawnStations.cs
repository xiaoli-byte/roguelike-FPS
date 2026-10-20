using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出生选点（Three.js WaveRunner.pickPoint / stationScore / pointSafe 的移植）：
    ///   打分：离玩家的距离贴近角色的理想距离带；在「玩家 → 场地中心」轴线的远端、按角色偏开一个角度（侧翼 90°）；
    ///         冲锋型（<see cref="EnemyDef.charger"/>）距离带更远、远端权重加倍——从场地另一头冲过来，不在玩家脚边出现；
    ///         站位角色对上 +8、对不上 −3、lane 对上 +2；高台站位：贴地的敌人不站，远程 / 精确 / 炮击 +3，其余 −1.5；
    ///         最近刚用过的点 −1.5、离同伴不到 4 m 按距离扣分、辅助离前排太远扣分、远程类看不到玩家 −2。
    ///   安全（选点、预警、真正出生三次都查）：在 NavMesh 上（高台站位不能掉到台下）、离玩家在距离带内、
    ///         整个身体放得下（半径 / 身高按定义 × 体型倍率 × 精英 1.25，再留 0.15 / 0.1 m；胶囊底抬到容得下 30° 坡，同 L5 出生净空检查）、
    ///         有完整路径走到玩家（卡住久了才接受不完整路径）。
    ///   兜底：没有合法站位时，在本场地内沿同一角色的方向随机找点，再不行就整场随机；还不行返回 false（调用方稍后重试，不强刷在中心）。
    /// </summary>
    public static class SpawnStations
    {
        /// <summary>角色的理想距离带（离玩家，米）与偏角（弧度，相对「玩家 → 中心」轴线；奇数 lane 取反）</summary>
        public readonly struct Profile
        {
            public readonly float min, max, angle;
            public Profile(float min, float max, float angle) { this.min = min; this.max = max; this.angle = angle; }
            public float Mid => (min + max) * 0.5f;
        }

        public static Profile ProfileOf(StationRole role, bool charger = false)
        {
            if (charger) return new Profile(16, 26, 0);
            return role switch
            {
                StationRole.Flank => new Profile(10, 19, Mathf.PI / 2),
                StationRole.Ranged => new Profile(12, 21, 0.45f),
                StationRole.Precision => new Profile(18, 30, 0.55f),
                StationRole.Artillery => new Profile(18, 27, 0.2f),
                StationRole.Support => new Profile(13, 21, 0.15f),
                _ => new Profile(10, 16, 0),
            };
        }

        /// <summary>EnemyDef 的站位角色 → StationRole</summary>
        public static StationRole RoleOf(EnemyPlacement p) => p switch
        {
            EnemyPlacement.Flank => StationRole.Flank,
            EnemyPlacement.Ranged => StationRole.Ranged,
            EnemyPlacement.Precision => StationRole.Precision,
            EnemyPlacement.Artillery => StationRole.Artillery,
            EnemyPlacement.Support => StationRole.Support,
            _ => StationRole.Assault,
        };

        /// <summary>条目实际的站位角色：写了就用写的，Auto 取 EnemyDef.placementRole，名册里没有按正面</summary>
        public static StationRole Resolve(StationRole entryRole, EnemyDef def) =>
            entryRole != StationRole.Auto ? entryRole : def != null ? RoleOf(def.placementRole) : StationRole.Assault;

        /// <summary>角色的默认到场延迟（TS Waves ARRIVAL）：前排先到，远程稍晚，侧袭与狙击再晚，炮手最后——让角色一个个看得清</summary>
        public static float DefaultArrival(StationRole role) => role switch
        {
            StationRole.Ranged => 0.2f,
            StationRole.Support => 0.6f,
            StationRole.Flank => 0.85f,
            StationRole.Precision => 0.9f,
            StationRole.Artillery => 1.2f,
            _ => 0f,
        };

        /// <summary>该角色适合高台站位（俯射层）</summary>
        public static bool RaisedRole(StationRole r) => r is StationRole.Ranged or StationRole.Precision or StationRole.Artillery;

        /// <summary>编辑器小图标的颜色</summary>
        public static Color RoleColor(StationRole r) => r switch
        {
            StationRole.Assault => new Color(1f, 0.35f, 0.25f),
            StationRole.Flank => new Color(1f, 0.7f, 0.2f),
            StationRole.Ranged => new Color(0.35f, 0.75f, 1f),
            StationRole.Precision => new Color(0.75f, 0.45f, 1f),
            StationRole.Artillery => new Color(1f, 0.45f, 0.75f),
            StationRole.Support => new Color(0.4f, 1f, 0.55f),
            _ => new Color(0.85f, 0.85f, 0.85f),
        };

        // ───────────── 体型与净空 ─────────────

        /// <summary>出生要留的身体：半径 = 定义半径 × 体型倍率（精英再 × 1.25）+ 0.15，身高同理 + 0.1（同 TS pointSafe）</summary>
        public static (float radius, float height) BodySize(EnemyDef def, bool elite)
        {
            float k = (def != null ? def.scale : 1f) * (elite ? 1.25f : 1f);
            float r = (def != null ? def.radius : 0.5f) * k + 0.15f;
            float h = (def != null ? def.height : 1.8f) * k + 0.1f;
            return (r, Mathf.Max(h, r * 2));
        }

        static readonly float SlopeLift = 1f / Mathf.Cos(30f * Mathf.Deg2Rad);
        static readonly Collider[] overlap = new Collider[8];
        /// <summary>挡出生的东西：世界层 + 不可见墙（同 L5 的 BlockMask）</summary>
        static int BlockMask => Layers.WorldMask | (1 << Layers.IgnoreRaycast);

        /// <summary>
        /// 整个身体放得下：胶囊底部的球心抬到 r / cos30° + 0.2（30° 坡、NavMesh 与地面的一两分米误差都不算挤），撞到任何世界碰撞体就不行。
        /// 与 L5 SpawnClearanceCheck 同一个算法：编辑期验过的锚点运行时不会被这里拒掉
        /// </summary>
        public static bool BodyClear(Vector3 feet, float radius, float height)
        {
            var lo = feet + Vector3.up * (radius * SlopeLift + 0.2f);
            var hi = feet + Vector3.up * Mathf.Max(height - radius, radius * SlopeLift + 0.2f);
            return Physics.OverlapCapsuleNonAlloc(lo, hi, radius, overlap, BlockMask, QueryTriggerInteraction.Ignore) == 0;
        }

        public static bool BodyClear(Vector3 feet, EnemyDef def, bool elite)
        {
            var (r, h) = BodySize(def, elite);
            return BodyClear(feet, r, h);
        }

        // ───────────── 选点 ─────────────

        /// <summary>最近选过的点（打散同伴、避开刚用过的点）</summary>
        public struct Recent
        {
            public Vector3 pos;
            public StationRole role;
            public float time;
        }

        /// <summary>一次选点的输入</summary>
        public sealed class Query
        {
            public EnemyDef def;
            public bool elite;
            public StationRole role;
            public int lane;
            public Vector3 player, playerForward, center;
            public float arenaRadius = 30f;
            public float minDist = 10f, maxDist = 36f;
            /// <summary>接受不完整路径（卡住很久时）</summary>
            public bool partialOk;
            public IReadOnlyList<Transform> anchors;
            public IReadOnlyList<Recent> recent;
            public float now;

            public bool Charger => def != null && def.charger;
            public bool GroundOnly => def != null && def.groundOnly;
        }

        /// <summary>选出的站位</summary>
        public struct Station
        {
            public Vector3 point;
            /// <summary>来自哪个锚点（兜底随机点为 null）</summary>
            public Transform anchor;
            public bool elevated;
            public float score;
        }

        struct Candidate
        {
            public Vector3 point;
            public Transform anchor;
            public bool elevated;
            public float score;
        }

        static readonly List<Candidate> cands = new();
        static readonly NavMeshPath path = new();
        /// <summary>每次选点最多算几条路径（大地形上一条路径不便宜；没选到就过 0.25 s 再来）</summary>
        const int MaxPathsPerPick = 10;
        static int pathBudget;

        /// <summary>按打分从高到低试，第一个安全的点就是它；都不安全返回 false</summary>
        public static bool Pick(Query q, out Station station)
        {
            station = default;
            if (q == null) return false;
            cands.Clear();
            pathBudget = MaxPathsPerPick;
            if (q.anchors != null)
                foreach (var t in q.anchors)
                {
                    if (!t) continue;
                    var (role, lane, elevated, spread) = SpawnAnchor.Read(t);
                    if (elevated && q.GroundOnly) continue;
                    float bonus = AnchorBonus(q, role, lane, elevated);
                    var c = t.position;
                    cands.Add(new Candidate { point = c, anchor = t, elevated = elevated, score = Score(q, c) + bonus });
                    if (spread <= 0.05f) continue;
                    // 一圈 6 个散开点：从朝向玩家的那一侧转开，分数略低于中心点
                    var toward = Flat(q.player - c);
                    float a0 = toward.sqrMagnitude > 0.01f ? Mathf.Atan2(toward.x, toward.z) : 0;
                    for (int i = 0; i < 6; i++)
                    {
                        float a = a0 + Mathf.PI / 6 + i * Mathf.PI / 3;
                        var p = c + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * spread;
                        cands.Add(new Candidate { point = p, anchor = t, elevated = elevated, score = Score(q, p) + bonus - 0.3f });
                    }
                }
            cands.Sort((x, y) => y.score.CompareTo(x.score));
            foreach (var c in cands)
            {
                if (pathBudget <= 0) break;
                if (!Safe(q, c.point, c.elevated, out var at)) continue;
                station = new Station { point = at, anchor = c.anchor, elevated = c.elevated, score = c.score };
                return true;
            }
            // 兜底：同一角色的方向上、本场地内随机找（TS：没有合法站位时按同一角色和角度在本地遭遇里找）
            var prof = ProfileOf(q.role, q.Charger);
            var desired = Desired(q, prof);
            for (int i = 0; i < 24 && pathBudget > 0; i++)
            {
                Vector3 p;
                if (i < 14)
                {
                    float a = Random.Range(-0.65f, 0.65f) * Mathf.Rad2Deg;
                    var dir = Quaternion.AngleAxis(a, Vector3.up) * desired;
                    p = q.center + dir * (Random.Range(0.25f, 1f) * q.arenaRadius);
                }
                else
                {
                    var r = Random.insideUnitCircle * q.arenaRadius;
                    p = q.center + new Vector3(r.x, 0, r.y);
                }
                if (!Safe(q, p, false, out var at)) continue;
                station = new Station { point = at, anchor = null, elevated = false, score = Score(q, at) };
                return true;
            }
            return false;
        }

        /// <summary>锚点的角色 / lane / 高台加分</summary>
        public static float AnchorBonus(Query q, StationRole role, int lane, bool elevated)
        {
            float s = 0;
            if (role != StationRole.Auto) s += role == q.role ? 8 : -3;
            if (lane == q.lane) s += 2;
            if (elevated) s += RaisedRole(q.role) ? 3 : -1.5f;
            return s;
        }

        /// <summary>点本身的分（不含锚点加分）：距离带、方向、打散、视线</summary>
        public static float Score(Query q, Vector3 p)
        {
            var prof = ProfileOf(q.role, q.Charger);
            float d = Flat(p - q.player).magnitude;
            float score = -Mathf.Abs(d - prof.Mid) * 0.13f;
            var off = Flat(p - q.center);
            if (off.sqrMagnitude > 0.25f) score += Vector3.Dot(off.normalized, Desired(q, prof)) * (q.Charger ? 2.4f : 1.2f);
            float friend = float.PositiveInfinity;
            if (q.recent != null)
                foreach (var r in q.recent)
                {
                    float age = q.now - r.time;
                    float dist = Flat(p - r.pos).magnitude;
                    if (age < 2.5f && dist < 0.75f) score -= 1.5f;
                    if (age < 4f && dist < 4f) score -= (4f - dist) * 1.4f;
                    if (r.role is StationRole.Assault or StationRole.Flank) friend = Mathf.Min(friend, dist);
                }
            if (q.role == StationRole.Support && !float.IsInfinity(friend)) score -= Mathf.Max(0, friend - 8f) * 0.3f;
            if ((q.role is StationRole.Ranged or StationRole.Precision) && Combat.Blocked(p + Vector3.up * 1.7f, q.player + Vector3.up * 1.5f, null))
                score -= 2f;
            return score;
        }

        /// <summary>理想方向：「玩家 → 场地中心」轴线（玩家就在中心时取他的朝向），按角色偏角转开，奇数 lane 往另一边</summary>
        static Vector3 Desired(Query q, Profile prof)
        {
            var axis = Flat(q.center - q.player);
            if (axis.sqrMagnitude < 1f) axis = Flat(q.playerForward);
            if (axis.sqrMagnitude < 1e-4f) axis = Vector3.forward;
            axis.Normalize();
            float sign = (q.lane & 1) != 0 ? -1f : 1f;
            return Quaternion.AngleAxis(prof.angle * Mathf.Rad2Deg * sign, Vector3.up) * axis;
        }

        /// <summary>
        /// 安全：NavMesh 上（高台站位吸附后不能掉到台下）、离玩家在距离带内、身体放得下、有路走到玩家。
        /// snapped = 吸附到 NavMesh 的实际出生点
        /// </summary>
        public static bool Safe(Query q, Vector3 p, bool elevated, out Vector3 snapped)
        {
            snapped = p;
            if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)) return false;
            float d0 = Flat(p - q.player).magnitude;
            if (d0 < q.minDist - 2.5f || d0 > q.maxDist + 2.5f) return false;
            if (!NavMesh.SamplePosition(p, out var hit, elevated ? 1.5f : 2.5f, NavMesh.AllAreas)) return false;
            snapped = hit.position;
            if (elevated && Mathf.Abs(snapped.y - p.y) > 1.2f) return false;
            float d = Flat(snapped - q.player).magnitude;
            if (d < q.minDist || d > q.maxDist) return false;
            if (!BodyClear(snapped, q.def, q.elite)) return false;
            return Reachable(snapped, q.player, q.partialOk);
        }

        /// <summary>从出生点有路走到玩家（玩家可能站在网格外的箱子 / 台顶上：终点取离他最近的网格点）</summary>
        public static bool Reachable(Vector3 from, Vector3 player, bool partialOk)
        {
            pathBudget--;
            var goal = NavMesh.SamplePosition(player, out var near, 6f, NavMesh.AllAreas) ? near.position : player;
            if (!NavMesh.CalculatePath(from, goal, NavMesh.AllAreas, path)) return false;
            return path.status == NavMeshPathStatus.PathComplete || (partialOk && path.status == NavMeshPathStatus.PathPartial);
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
    }
}
