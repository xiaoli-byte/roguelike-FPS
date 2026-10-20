using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 安全区（docs/unity-parity.md 3.10「首领前补给营 → SupplyCamp + SafeZone」）：一块圆形区域，敌人进不来——
    ///   地面敌人：导航网格上挖一个圆洞（NavMeshObstacle carve），寻路自然绕开，刷怪点也落不进来；
    ///   漏网的（飞行敌人、被击退 / 冲撞推进来的、刚好刷在边上的）：每 0.1 s 检查一次，身体进了圈就打断它的出手、挪到圈外 1.5 m 的导航网格上（同 Unstick 的做法）。
    /// 首领不受影响（首领拴在自己的场地里，见 <see cref="BossEncounter"/>）。安全区只挡敌人本身，不挡弹体（补给营要靠站位和地形挡视线）。
    /// 玩家进出时发 <see cref="PlayerInsideChanged"/>；<see cref="Contains"/> 供首领关门槛、刷怪、商店判断「在不在补给营里」。
    /// 不立空气墙，玩家进出自由（开放关卡规则）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SafeZone : MonoBehaviour
    {
        [Tooltip("半径（米，水平）")] public float radius = 10f;
        [Tooltip("上下多高以内算在区里（米，相对物体位置）")] public float height = 6f;
        [Tooltip("把敌人挪到圈外多远（米，另加身体半径）")] public float pushMargin = 1.5f;
        [Tooltip("在导航网格上挖洞，地面敌人寻路绕开")] public bool carveNavMesh = true;

        const float CheckEvery = 0.1f;

        static readonly List<SafeZone> all = new();
        static readonly List<EnemyAI> buffer = new();

        NavMeshObstacle obstacle;
        float checkTimer;
        bool playerInside;

        /// <summary>场上启用中的安全区</summary>
        public static IReadOnlyList<SafeZone> All => all;
        /// <summary>挪出去的敌人次数（测试用）</summary>
        public int Ejected { get; private set; }
        public bool PlayerInside => playerInside;
        public Vector3 Center => transform.position;
        /// <summary>玩家进 / 出（true = 进）</summary>
        public event Action<SafeZone, bool> PlayerInsideChanged;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
            if (carveNavMesh && !obstacle)
            {
                obstacle = gameObject.AddComponent<NavMeshObstacle>();
                obstacle.shape = NavMeshObstacleShape.Capsule;
                obstacle.carving = true;
                obstacle.carveOnlyStationary = true;
            }
            if (obstacle)
            {
                obstacle.radius = Mathf.Max(0.5f, radius) / Mathf.Max(1e-3f, Mathf.Abs(transform.lossyScale.x));
                obstacle.height = Mathf.Max(1f, height * 2f) / Mathf.Max(1e-3f, Mathf.Abs(transform.lossyScale.y));
                obstacle.center = Vector3.zero;
                obstacle.enabled = true;
            }
        }

        void OnDisable()
        {
            all.Remove(this);
            if (obstacle) obstacle.enabled = false;
        }

        /// <summary>p 在区里（水平距离 ≤ 半径 + pad，高差 ≤ height）</summary>
        public bool Inside(Vector3 p, float pad = 0) => Inside(Center, radius, height, p, pad);

        /// <summary>纯几何：p 在以 center 为心、半径 radius、上下 height 的圆柱里（水平放宽 pad）</summary>
        public static bool Inside(Vector3 center, float radius, float height, Vector3 p, float pad = 0)
        {
            if (Mathf.Abs(p.y - center.y) > height) return false;
            float dx = p.x - center.x, dz = p.z - center.z;
            float r = radius + pad;
            return dx * dx + dz * dz <= r * r;
        }

        /// <summary>p 在某个安全区里（没有返回 false）</summary>
        public static bool Contains(Vector3 p, float pad = 0) => At(p, pad);

        /// <summary>p 所在的安全区（没有为 null）</summary>
        public static SafeZone At(Vector3 p, float pad = 0)
        {
            foreach (var z in all)
                if (z && z.isActiveAndEnabled && z.Inside(p, pad))
                    return z;
            return null;
        }

        /// <summary>把 p 推到圈外：沿中心 → p 的水平方向到 半径 + extra 处（p 正在中心时朝 +X），高度不变</summary>
        public static Vector3 PushOut(Vector3 center, float radius, Vector3 p, float extra)
        {
            var d = p - center;
            d.y = 0;
            var dir = d.sqrMagnitude > 1e-4f ? d.normalized : Vector3.right;
            var q = center + dir * (radius + extra);
            q.y = p.y;
            return q;
        }

        void Update()
        {
            var pv = PlayerVitals.Instance;
            bool inside = pv && !pv.Dead && Inside(pv.transform.position);
            if (inside != playerInside)
            {
                playerInside = inside;
                try
                {
                    PlayerInsideChanged?.Invoke(this, inside);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            checkTimer -= Time.deltaTime;
            if (checkTimer > 0) return;
            checkTimer = CheckEvery;
            buffer.Clear();
            EnemyRegistry.InRadius(Center, radius + 3f, buffer);
            foreach (var e in buffer)
            {
                if (!e || e.Dead || e is BossBrain) continue;
                float br = EnemyRegistry.BodyRadius(e);
                if (!Inside(e.transform.position, br * 0.5f)) continue;
                Eject(e, br);
            }
            buffer.Clear();
        }

        /// <summary>把一只敌人挪出去：打断出手，放到圈外最近的导航网格点上</summary>
        public void Eject(EnemyAI e, float bodyRadius)
        {
            if (!e) return;
            var target = PushOut(Center, radius, e.transform.position, bodyRadius + pushMargin);
            if (NavMesh.SamplePosition(target, out var hit, 4f, NavMesh.AllAreas) && !Inside(hit.position, bodyRadius * 0.5f)) target = hit.position;
            e.InterruptAttack();
            var agent = e.GetComponent<NavMeshAgent>();
            if (agent && agent.enabled && agent.isOnNavMesh) agent.Warp(target);
            else e.transform.position = target;
            var loco = e.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
            Ejected++;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(0.4f, 0.95f, 0.6f, 0.9f);
            const int n = 48;
            for (int i = 0; i < n; i++)
            {
                float a0 = i * Mathf.PI * 2 / n, a1 = (i + 1) * Mathf.PI * 2 / n;
                Gizmos.DrawLine(Center + new Vector3(Mathf.Sin(a0), 0, Mathf.Cos(a0)) * radius, Center + new Vector3(Mathf.Sin(a1), 0, Mathf.Cos(a1)) * radius);
            }
        }
    }
}
