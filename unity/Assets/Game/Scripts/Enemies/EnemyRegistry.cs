using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>敌人查询的过滤条件（可组合）：默认只要活着</summary>
    [Flags]
    public enum EnemyQuery
    {
        /// <summary>活着就算（含出生无敌中、遁地中）</summary>
        Alive = 0,
        /// <summary>跳过不可选中的（出生中、遁地、首领登场）</summary>
        Targetable = 1 << 0,
        /// <summary>跳过不给奖励的召唤物（蜃景分身…）</summary>
        Rewarding = 1 << 1,
    }

    /// <summary>
    /// 场上敌人的登记表（Three.js 版 EnemyManager 的 list / queryRadius / nearest / killAll）：
    ///   登记：<see cref="EnemyAI"/> Awake 时登记，死亡或销毁时移出（与原来的 EnemyAI.All 同一张表，旧代码照常遍历）；增删派发 <see cref="Added"/> / <see cref="Removed"/>。
    ///   查询：都不分配——结果写进调用方给的 List（先清空），排序用内部复用的缓冲。替代各处的 FindObjectsByType 扫描。
    ///     <see cref="InRadius"/>：根节点（脚底）距离 &lt; 半径（光环、召唤上限之类按站位算的）；
    ///     <see cref="Overlapping"/>：身体中心到点的距离 ≤ 半径 + 身体半径（TS queryRadius，技能范围用）；
    ///     <see cref="Nearest(Vector3, float, int, List{EnemyAI}, EnemyQuery, bool, EnemyAI)"/>：按身体中心由近到远前 N 个，可要求视线（地形 / 建筑不挡）。
    ///   清场：<see cref="PurgeAll"/> 对每个活敌人静默处决（<see cref="Combat.Execute"/> purge）：不掉落、不计击杀，场地照常推进；
    ///         期间 <see cref="Purging"/> = true，死亡连锁（火浣鼠余火 / 爆炸、以后的爆裂词缀）不发动。
    /// </summary>
    public static class EnemyRegistry
    {
        static readonly List<EnemyAI> live = new();
        static readonly List<EnemyAI> cand = new();
        static readonly List<float> candDist = new();

        static readonly EventChannel<Action<EnemyAI>> added = new();
        static readonly EventChannel<Action<EnemyAI>> removed = new();

        /// <summary>有敌人登记（Awake，生成参数还没填；要等生成完毕用 <see cref="GameEvents.EnemySpawned"/>）</summary>
        public static event Action<EnemyAI> Added { add => added.Add(value); remove => added.Remove(value); }
        /// <summary>有敌人移出（死亡或销毁，各一次）</summary>
        public static event Action<EnemyAI> Removed { add => removed.Add(value); remove => removed.Remove(value); }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            cand.Clear();
            candDist.Clear();
            added.Clear();
            removed.Clear();
            Purging = false;
        }

        /// <summary>场上活着的敌人（登记顺序 = 生成顺序）。不要在遍历中途生成 / 杀死敌人，需要时先拷一份</summary>
        public static IReadOnlyList<EnemyAI> Live => live;
        /// <summary>同一张表的可变引用（兼容 <see cref="EnemyAI.All"/>）</summary>
        internal static List<EnemyAI> LiveList => live;
        public static int Count => live.Count;

        /// <summary>正在 <see cref="PurgeAll"/>：死亡时的附带效果（爆炸、余火、连锁、词缀）应跳过</summary>
        public static bool Purging { get; private set; }

        internal static void Register(EnemyAI e)
        {
            if (!e || live.Contains(e)) return;
            live.Add(e);
            added.Raise(e);
        }

        internal static void Unregister(EnemyAI e)
        {
            if (ReferenceEquals(e, null) || !live.Remove(e)) return;
            removed.Raise(e);
        }

        /// <summary>满足过滤条件：活着、有受伤体，按 q 跳过不可选中 / 不给奖励的</summary>
        public static bool Passes(EnemyAI e, EnemyQuery q = EnemyQuery.Alive)
        {
            if (!e || e.Dead) return false;
            var d = e.Health;
            if (!d) return false;
            if ((q & EnemyQuery.Targetable) != 0 && d.untargetable) return false;
            if ((q & EnemyQuery.Rewarding) != 0 && d.noReward) return false;
            return true;
        }

        /// <summary>身体中心（碰撞体包围盒中心；没有碰撞体时取脚底上方 1 m）</summary>
        public static Vector3 Center(EnemyAI e) => e.Health ? ProjectileTargeting.Center(e.Health) : e.transform.position + Vector3.up;

        /// <summary>身体半径（角色胶囊半径 × 体型；没有胶囊时 0.4）</summary>
        public static float BodyRadius(EnemyAI e)
        {
            var c = e.GetComponent<CapsuleCollider>();
            return c ? c.radius * Mathf.Abs(e.transform.lossyScale.x) : 0.4f;
        }

        /// <summary>根节点（脚底）到 center 的距离 &lt; radius 的敌人，写进 results（先清空），返回个数。exclude 不算</summary>
        public static int InRadius(Vector3 center, float radius, List<EnemyAI> results, EnemyQuery q = EnemyQuery.Alive, EnemyAI exclude = null)
        {
            results.Clear();
            if (!(radius > 0)) return 0;
            float r2 = radius * radius;
            for (int i = 0; i < live.Count; i++)
            {
                var e = live[i];
                if (e == exclude || !Passes(e, q)) continue;
                if ((e.transform.position - center).sqrMagnitude < r2) results.Add(e);
            }
            return results.Count;
        }

        /// <summary>身体中心到 center 的距离 ≤ radius + 身体半径的敌人（TS queryRadius），写进 results（先清空），返回个数</summary>
        public static int Overlapping(Vector3 center, float radius, List<EnemyAI> results, EnemyQuery q = EnemyQuery.Targetable, EnemyAI exclude = null)
        {
            results.Clear();
            if (!(radius >= 0)) return 0;
            for (int i = 0; i < live.Count; i++)
            {
                var e = live[i];
                if (e == exclude || !Passes(e, q)) continue;
                float r = radius + BodyRadius(e);
                if ((Center(e) - center).sqrMagnitude <= r * r) results.Add(e);
            }
            return results.Count;
        }

        /// <summary>
        /// from 附近 range 内（到身体中心）最近的 count 个敌人，由近到远写进 results（先清空），返回个数。
        /// needSight：from → 身体中心不被地形 / 建筑挡住（<see cref="Combat.Blocked"/>）；只对按距离选中的候选做射线，不全量扫。
        /// </summary>
        public static int Nearest(Vector3 from, float range, int count, List<EnemyAI> results, EnemyQuery q = EnemyQuery.Targetable, bool needSight = false,
            EnemyAI exclude = null)
        {
            results.Clear();
            if (count <= 0 || !(range >= 0)) return 0;
            cand.Clear();
            candDist.Clear();
            float r2 = range * range;
            for (int i = 0; i < live.Count; i++)
            {
                var e = live[i];
                if (e == exclude || !Passes(e, q)) continue;
                float d2 = (Center(e) - from).sqrMagnitude;
                if (d2 > r2) continue;
                cand.Add(e);
                candDist.Add(d2);
            }
            try
            {
                while (results.Count < count)
                {
                    int bi = -1;
                    float bd = float.PositiveInfinity;
                    for (int i = 0; i < candDist.Count; i++)
                        if (candDist[i] < bd)
                        {
                            bd = candDist[i];
                            bi = i;
                        }
                    if (bi < 0) break;
                    var e = cand[bi];
                    candDist[bi] = float.PositiveInfinity;
                    if (needSight && Combat.Blocked(from, Center(e), e.GetComponent<Collider>())) continue;
                    results.Add(e);
                }
            }
            finally
            {
                cand.Clear();
                candDist.Clear();
            }
            return results.Count;
        }

        static readonly List<EnemyAI> one = new(1);

        /// <summary>最近的一个（同 <see cref="Nearest(Vector3, float, int, List{EnemyAI}, EnemyQuery, bool, EnemyAI)"/>）；没有返回 null</summary>
        public static EnemyAI NearestOne(Vector3 from, float range, EnemyQuery q = EnemyQuery.Targetable, bool needSight = false, EnemyAI exclude = null)
        {
            Nearest(from, range, 1, one, q, needSight, exclude);
            var e = one.Count > 0 ? one[0] : null;
            one.Clear();
            return e;
        }

        /// <summary>
        /// 清场（调试清怪、首领倒下后残余爪牙溃散、关卡结束）：对每个活敌人静默处决。不算玩家战果（不掉落、不给魂晶、不计击杀），
        /// 但照常死亡（EnemyAI.Removed 照发：场地计数照常推进）。期间 <see cref="Purging"/> = true。返回处决的个数。
        /// </summary>
        public static int PurgeAll()
        {
            if (live.Count == 0) return 0;
            var snapshot = live.ToArray();
            bool was = Purging;
            Purging = true;
            int n = 0;
            try
            {
                foreach (var e in snapshot)
                {
                    if (!e || e.Dead) continue;
                    var d = e.Health;
                    if (!d) continue;
                    try
                    {
                        Combat.Execute(d, true);
                        n++;
                    }
                    catch (Exception ex)
                    {
                        Debug.LogException(ex);
                    }
                }
            }
            finally
            {
                Purging = was;
            }
            return n;
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>静默清场（不掉落、不计击杀；场地照常推进）。没有热键：DevCommands.Run("purge")</summary>
    [Defs]
    public sealed class PurgeEnemiesCommand : DevCommand
    {
        public override string Id => "purge";
        public override string Label => "静默清场";

        public override void Execute() => DevCommands.Say($"静默清场 {EnemyRegistry.PurgeAll()} 只");
    }
#endif
}
