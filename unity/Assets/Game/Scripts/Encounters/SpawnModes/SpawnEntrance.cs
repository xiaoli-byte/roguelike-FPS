using System;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出场方式的脚本位移（S1）——敌人生成之后、交给 AI 之前的那一段：
    ///   <see cref="Kind.Hop"/>  熔岩爬出：从熔岩面（脚底比熔岩高 0.4 m，熔岩系统不当它在熔岩里）一跃上岸，1.2 s，上岸前不可选中；
    ///   <see cref="Kind.Fly"/>  飞临：从入场点沿弧线飞到站位（12 m/s，1.2–3 s），一路拖尾焰；
    ///   <see cref="Kind.Jump"/> 跃下：先在墙头 / 台沿露头 0.6 s（面朝场地），再抛物线跳到落点（0.75 s），落地一震。
    /// 位移期间 EnemyAI 停用（不索敌、不占出手名额、不吃击退），导航代理不跟位置；结束时代理 Warp 到落点、AI 启用。
    /// 生成器把敌人生成在落点（导航网格上，没有「离网」告警），这里在同一帧把根节点挪到起点。
    /// AI 启用后还有基类 0.7 s 的出生状态（站稳）：这里提前把「不可选中」撤掉，落地就能打。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SpawnEntrance : MonoBehaviour
    {
        public enum Kind { Hop, Fly, Jump }

        public const float HopTime = 1.2f, PeekTime = 0.6f, JumpTime = 0.75f, FlySpeed = 12f;

        public Kind kind;
        public Vector3 From => from;
        public Vector3 To => to;
        public bool Done { get; private set; }
        /// <summary>全部做完（AI 交还）时</summary>
        public event Action<SpawnEntrance> Finished;

        EnemyAI ai;
        NavMeshAgent agent;
        Vector3 from, to;
        float t0, delay, duration, height, trailAcc;
        bool splashed;

        /// <summary>开始一段出场位移；ai 刚由 <see cref="EnemyRoster.Spawn"/> 生成（站在落点 to 上）</summary>
        public static SpawnEntrance Begin(EnemyAI ai, Kind kind, Vector3 from, Vector3 to)
        {
            if (!ai) return null;
            var e = ai.GetComponent<SpawnEntrance>();
            if (!e) e = ai.gameObject.AddComponent<SpawnEntrance>();
            e.Init(ai, kind, from, to);
            return e;
        }

        void Init(EnemyAI who, Kind k, Vector3 a, Vector3 b)
        {
            ai = who;
            kind = k;
            from = a;
            to = b;
            agent = GetComponent<NavMeshAgent>();
            ai.enabled = false;
            if (agent && agent.enabled)
            {
                if (agent.isOnNavMesh) agent.isStopped = true;
                agent.updatePosition = false;
            }
            float dist = Vector3.Distance(a, b);
            switch (k)
            {
                case Kind.Hop:
                    delay = 0;
                    duration = HopTime;
                    height = 1.2f + Mathf.Max(0, b.y - a.y) * 0.5f;
                    if (ai.Health) ai.Health.untargetable = true;
                    break;
                case Kind.Fly:
                    delay = 0;
                    duration = Mathf.Clamp(dist / FlySpeed, 1.2f, 3f);
                    height = Mathf.Clamp(dist * 0.12f, 1f, 6f);
                    break;
                default:
                    delay = PeekTime;
                    duration = JumpTime;
                    height = 1.2f;
                    break;
            }
            t0 = Time.time;
            transform.position = a;
            Face(b - a);
        }

        void Face(Vector3 d)
        {
            d.y = 0;
            if (d.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(d.normalized);
        }

        void Update()
        {
            if (Done) return;
            if (!ai || ai.Dead)
            {
                Destroy(this);
                return;
            }
            float t = Time.time - t0;
            if (t < delay)
            {
                transform.position = from;
                return;
            }
            float u = Mathf.Clamp01((t - delay) / duration);
            float e = kind == Kind.Jump ? u : Mathf.SmoothStep(0, 1, u);
            var p = Vector3.Lerp(from, to, e) + Vector3.up * (height * 4f * u * (1 - u));
            var step = p - transform.position;
            transform.position = p;
            if (step.sqrMagnitude > 1e-6f) Face(step);
            if (kind == Kind.Hop && !splashed)
            {
                splashed = true;
                SpawnCues.LavaSplash(from);
            }
            if (kind == Kind.Fly)
            {
                trailAcc += Time.deltaTime;
                while (trailAcc > 0.04f)
                {
                    trailAcc -= 0.04f;
                    Fx.Burst(p, InfernoKit.Ember, 2, 0.6f, 0.45f, 0.1f, -0.5f);
                }
            }
            if (u >= 1f) Finish();
        }

        void Finish()
        {
            Done = true;
            transform.position = to;
            if (agent && agent.enabled)
            {
                agent.updatePosition = true;
                if (agent.Warp(to) && agent.isOnNavMesh) agent.isStopped = false;
            }
            if (ai.Health) ai.Health.untargetable = false;
            ai.enabled = true;
            if (kind == Kind.Jump) SpawnCues.Land(to, 1.6f);
            try
            {
                Finished?.Invoke(this);
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
            }
            Destroy(this);
        }

        void OnDestroy()
        {
            // 半路被销毁（换关清场、测试撤场）：别把 AI 留在停用态
            if (Done || !ai || ai.Dead) return;
            if (agent && agent.enabled) agent.updatePosition = true;
            if (ai.Health) ai.Health.untargetable = false;
            ai.enabled = true;
        }
    }
}
