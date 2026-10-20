using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>会爬墙的敌人（雪狌狌）：导航代理可以走攀爬连线（<see cref="PackCoordinator.ClimbArea"/>），并自己处理连线上的攀爬动作</summary>
    public interface IClimber { }

    /// <summary>
    /// 群怪协同（第二章群怪组：冻鲛人群刺、雪狌狌起哄与攀爬；第三章炭童 / 祸斗也可以接）：
    ///   群体出手的门限（<see cref="TryOpenGate"/>）：同一群（按 key）在 gap 秒内只发起一次——Three.js Jiaoren.packGate 的通用版；
    ///     时钟回退（新开一局 Time.time 从 0 起）时整体复位，免得旧时间戳长期卡住。
    ///   凑人（<see cref="Gather{T}"/>）：某点周围水平 range 内、同类、满足条件（活着、空闲、冷却好了、够得着…）的成员，按离该点由近到远排好，
    ///     由近到远依次错开出手（<see cref="StaggerDelay"/>）。人数门槛 <see cref="Needed"/>：精英少要一个（TS need = elite ? 3 − 1 : 3）。
    ///   起哄（<see cref="Rally{T}"/>）：同类倒下时，radius 内的同伴各自响应（雪狌狌捶胸嚎叫）。清场（<see cref="EnemyRegistry.Purging"/>）时不响应。
    ///   攀爬连线（<see cref="ShareClimbLink"/>）：雪狌狌找到可以翻上去的台沿时，在台下落脚点和台面之间登记一条运行时 NavMeshLink（单向、限时），
    ///     同一处台沿 1 m 内复用同一条——寻路会把这道台沿当成近路，一群狌狌都从这里翻上去；连线由 AI 手动通过（攀爬动作抬根节点）。
    ///     到期的连线在下一次登记 / 换关（<see cref="GameEvents.StageLoaded"/>）时移除。关卡里手摆的攀爬 NavMeshLink 走同一套通过逻辑。
    ///     连线放在专用的导航区域 <see cref="ClimbArea"/>：不会爬的敌人（没实现 <see cref="IClimber"/>）登记时从 areaMask 里去掉这一位，
    ///     免得冻鲛人、旋龟沿着墙面「滑」上台子（Unity 的自动通过是直线移动）。
    /// </summary>
    public static class PackCoordinator
    {
        static readonly Dictionary<string, float> gates = new();

        struct ClimbLink
        {
            public NavMeshLinkInstance instance;
            public Vector3 from, to;
            public int agentType;
            public float until;
        }

        static readonly List<ClimbLink> links = new();
        static readonly List<EnemyAI> scratch = new();

        /// <summary>同一处台沿复用连线的距离（米）</summary>
        public const float LinkShareRadius = 1f;
        /// <summary>攀爬连线用的导航区域（用户区域里最靠后的一个，烘焙的地面不会用到）：只有 <see cref="IClimber"/> 的导航代理走得了</summary>
        public const int ClimbArea = 29;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            gates.Clear();
            links.Clear();
        }

        // GameEvents / EnemyRegistry 在 SubsystemRegistration 时清空订阅，所以订阅放到之后的阶段（同 AttackTokens）
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook()
        {
            GameEvents.StageLoaded += OnStageLoaded;
            EnemyRegistry.Added += OnEnemyAdded;
        }

        static void OnStageLoaded(StageSpec s) => Reset();

        /// <summary>不会爬的敌人：导航代理不走攀爬连线</summary>
        static void OnEnemyAdded(EnemyAI e)
        {
            if (!e || e is IClimber) return;
            var agent = e.GetComponent<NavMeshAgent>();
            if (agent) agent.areaMask &= ~(1 << ClimbArea);
        }

        /// <summary>全部清空（换关、测试）：门限、攀爬连线</summary>
        public static void Reset()
        {
            gates.Clear();
            ClearClimbLinks();
        }

        // ───────────── 群体出手的门限 ─────────────

        /// <summary>这一群现在能发起（距上次发起 ≥ gap）；时钟回退时复位</summary>
        public static bool GateOpen(string pack, float now, float gap)
        {
            if (string.IsNullOrEmpty(pack) || !gates.TryGetValue(pack, out float last)) return true;
            if (last > now + gap)
            {
                gates.Remove(pack);
                return true;
            }
            return now - last >= gap;
        }

        /// <summary>能发起就记下发起时刻并返回 true</summary>
        public static bool TryOpenGate(string pack, float now, float gap)
        {
            if (!GateOpen(pack, now, gap)) return false;
            if (!string.IsNullOrEmpty(pack)) gates[pack] = now;
            return true;
        }

        /// <summary>上次发起的时刻（没有为 −∞）</summary>
        public static float LastOpened(string pack) => !string.IsNullOrEmpty(pack) && gates.TryGetValue(pack, out float t) ? t : float.NegativeInfinity;

        /// <summary>人数门槛：精英带队时少要一个（最少 1）</summary>
        public static int Needed(int min, bool elite) => Mathf.Max(1, elite ? min - 1 : min);

        /// <summary>第 index 个成员（由近到远）的错开时间</summary>
        public static float StaggerDelay(int index, float step) => Mathf.Max(0, index) * step;

        // ───────────── 凑人 ─────────────

        /// <summary>
        /// around 周围水平 range 内、类型 T、满足 ready 的活着的敌人，按离 around 的水平距离由近到远放进 into（先清空），返回个数
        /// </summary>
        public static int Gather<T>(Vector3 around, float range, List<T> into, Func<T, bool> ready) where T : EnemyAI
        {
            into.Clear();
            foreach (var e in EnemyRegistry.Live)
            {
                if (e is not T t || !t || t.Dead) continue;
                if (Flat(t.transform.position - around) > range) continue;
                if (ready != null && !ready(t)) continue;
                into.Add(t);
            }
            into.Sort((a, b) => Flat(a.transform.position - around).CompareTo(Flat(b.transform.position - around)));
            return into.Count;
        }

        /// <summary>
        /// 发起一次群体出手：门限开着、凑够 <see cref="Needed"/>（按发起者是不是精英）就占用门限并返回 true，成员（由近到远）在 into 里。
        /// 不占名额：调用方按 into 的顺序给每个成员 <see cref="StaggerDelay"/> 错开
        /// </summary>
        public static bool TryStartPack<T>(string pack, T leader, Vector3 around, float range, int min, float gap, List<T> into, Func<T, bool> ready)
            where T : EnemyAI
        {
            float now = Time.time;
            into.Clear();
            if (!leader || !GateOpen(pack, now, gap)) return false;
            if (Gather(around, range, into, ready) < Needed(min, leader.elite)) return false;
            return TryOpenGate(pack, now, gap);
        }

        static float Flat(Vector3 v)
        {
            v.y = 0;
            return v.magnitude;
        }

        // ───────────── 起哄 ─────────────

        /// <summary>
        /// 同类倒下：fallen 周围水平 radius 内活着的同类（不含它自己）各调一次 rally，返回调用次数。清场中不响应
        /// </summary>
        public static int Rally<T>(EnemyAI fallen, float radius, Action<T> rally) where T : EnemyAI
        {
            if (!fallen || rally == null || EnemyRegistry.Purging) return 0;
            var at = fallen.transform.position;
            scratch.Clear();
            foreach (var e in EnemyRegistry.Live) scratch.Add(e);
            int n = 0;
            foreach (var e in scratch)
            {
                if (e == fallen || e is not T t || !t || t.Dead) continue;
                if (Flat(t.transform.position - at) > radius) continue;
                try
                {
                    rally(t);
                    n++;
                }
                catch (Exception ex)
                {
                    Debug.LogException(ex);
                }
            }
            scratch.Clear();
            return n;
        }

        // ───────────── 攀爬连线 ─────────────

        /// <summary>现在登记着的攀爬连线数（含已过期还没清掉的）</summary>
        public static int ClimbLinkCount => links.Count;

        /// <summary>
        /// 登记 / 续期一条攀爬连线（from = 台下落脚点、to = 台面点，都应在导航网格上）：同一代理类型、两端都在 1 m 内的已有连线只续期。
        /// 顺手移除到期的。返回连线是否有效（导航系统不可用时 false，AI 退回直接走到台下再爬）
        /// </summary>
        public static bool ShareClimbLink(Vector3 from, Vector3 to, int agentTypeId, float width, float ttl)
        {
            float now = Time.time;
            Prune(now);
            for (int i = 0; i < links.Count; i++)
            {
                var l = links[i];
                if (l.agentType != agentTypeId || (l.from - from).sqrMagnitude > LinkShareRadius * LinkShareRadius
                    || (l.to - to).sqrMagnitude > LinkShareRadius * LinkShareRadius) continue;
                l.until = Mathf.Max(l.until, now + ttl);
                links[i] = l;
                return NavMesh.IsLinkValid(l.instance);
            }
            var data = new NavMeshLinkData
            {
                startPosition = from, endPosition = to, width = Mathf.Max(0.3f, width), costModifier = 1f, bidirectional = false,
                area = ClimbArea, agentTypeID = agentTypeId,
            };
            NavMeshLinkInstance inst;
            try
            {
                inst = NavMesh.AddLink(data);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Pack] 登记攀爬连线失败：{e.Message}");
                return false;
            }
            if (!NavMesh.IsLinkValid(inst)) return false;
            links.Add(new ClimbLink { instance = inst, from = from, to = to, agentType = agentTypeId, until = now + ttl });
            return true;
        }

        /// <summary>这一点附近（1 m）有没有登记着的攀爬连线起点</summary>
        public static bool HasClimbLinkNear(Vector3 from)
        {
            foreach (var l in links)
                if ((l.from - from).sqrMagnitude <= LinkShareRadius * LinkShareRadius)
                    return true;
            return false;
        }

        static void Prune(float now)
        {
            for (int i = links.Count - 1; i >= 0; i--)
            {
                // 时钟回退（新开一局）也当作过期
                if (links[i].until > now + 120f || links[i].until <= now)
                {
                    Remove(links[i]);
                    links.RemoveAt(i);
                }
            }
        }

        /// <summary>移除全部攀爬连线</summary>
        public static void ClearClimbLinks()
        {
            foreach (var l in links) Remove(l);
            links.Clear();
        }

        static void Remove(in ClimbLink l)
        {
            try
            {
                if (NavMesh.IsLinkValid(l.instance)) NavMesh.RemoveLink(l.instance);
            }
            catch (Exception)
            {
                // 导航数据已经随场景卸载：不用再移除
            }
        }
    }
}
