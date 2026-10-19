using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一个战斗场地（Three.js 版 WhiteboxEncounters + WaveRunner 的切片版）：
    ///   触发：玩家进入 triggerRadius（且 requires 的场地都已肃清）
    ///   生成：每队按 delay 到场，出生点先闪 0.8 s 地面预警；同时在场最多 10 只；出生点离玩家 10–28 m、在导航网格上、
    ///         有路走到玩家（不在不可达的台子上刷怪）；优先用场地里摆好的锚点
    ///   肃清：全部生成且全部死亡 → 横幅「区域肃清」→ Cleared 事件（宝箱、出口由监听者处理）
    ///   防卡：30 s 没有进展时，剩下 ≤ 2 只的落单敌人传送到玩家附近
    /// </summary>
    public sealed class EncounterSite : MonoBehaviour
    {
        [Serializable]
        public sealed class Squad
        {
            public string enemy;
            public int count = 1;
            [Tooltip("开战后多少秒到场")] public float delay;
            public bool elite;
        }

        public enum Phase { Idle, Active, Cleared }

        public string title = "战场";
        public float triggerRadius = 16f;
        public float arenaRadius = 30f;
        public int level = 1;
        public Squad[] squads = Array.Empty<Squad>();
        public EncounterSite[] requires = Array.Empty<EncounterSite>();
        public Transform[] anchors = Array.Empty<Transform>();
        [Tooltip("肃清后在场地上落的宝箱奖励：weapon:<id>[:稀有度] / scroll / coins / heal；空 = 不落")] public string reward = "";
        public Vector3 chestOffset;

        public Phase phase { get; private set; } = Phase.Idle;
        public int Total { get; private set; }
        public int AliveCount => alive.Count;
        public int Remaining => Total - killed;
        public event Action<EncounterSite> Cleared;
        public static event Action<EncounterSite> AnySiteCleared;

        const int MaxAlive = 10;
        const float WarnTime = 0.8f;

        readonly List<(string id, bool elite, float at)> queue = new();
        readonly List<(string id, bool elite, Vector3 pos, float at)> warned = new();
        readonly List<EnemyAI> alive = new();
        float startTime, lastProgress;
        int killed;

        void Update()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var ppos = pv.transform.position;
            switch (phase)
            {
                case Phase.Idle:
                    if (Flat(ppos - transform.position) <= triggerRadius && RequirementsMet()) Activate();
                    break;
                case Phase.Active:
                    Tick(ppos);
                    break;
            }
        }

        bool RequirementsMet()
        {
            foreach (var r in requires)
                if (r && r.phase != Phase.Cleared) return false;
            return true;
        }

        void Activate()
        {
            phase = Phase.Active;
            startTime = lastProgress = Time.time;
            foreach (var s in squads)
            {
                // 近战成群（≥3）时留一只晚 2.5 s 从侧翼出来
                bool flank = s.count >= 3 && EnemyRoster.Get(s.enemy)?.role == AttackTokens.Kind.Melee;
                for (int i = 0; i < s.count; i++)
                {
                    float at = s.delay + i * 0.18f + (flank && i == s.count - 1 ? 2.5f : 0);
                    queue.Add((s.enemy, s.elite, at));
                }
            }
            Total = queue.Count;
            Hud.Instance?.Banner(title, 2f);
            GameAudio.Play("wave_start");
            Hud.Instance?.SetObjective($"{title} · 剩余敌人 {Remaining}");
            GameEvents.RaiseEncounterStarted(this);
        }

        void Tick(Vector3 ppos)
        {
            float t = Time.time - startTime;
            // 排队 → 选点 + 预警
            for (int i = queue.Count - 1; i >= 0; i--)
            {
                var q = queue[i];
                if (q.at > t || alive.Count + warned.Count >= MaxAlive) continue;
                if (!PickSpawnPoint(ppos, out var pos)) continue;
                Telegraph.Circle(pos, 1.1f, WarnTime, new Color(1f, 0.4f, 0.25f));
                warned.Add((q.id, q.elite, pos, Time.time + WarnTime));
                queue.RemoveAt(i);
            }
            // 预警结束 → 生成
            for (int i = warned.Count - 1; i >= 0; i--)
            {
                var w = warned[i];
                if (Time.time < w.at) continue;
                warned.RemoveAt(i);
                var look = ppos - w.pos;
                look.y = 0;
                var ai = EnemyRoster.Spawn(w.id, w.pos, Quaternion.LookRotation(look.sqrMagnitude > 0.01f ? look : Vector3.forward), level, w.elite, transform);
                if (!ai)
                {
                    killed++; // 缺 Prefab：当作已清，免得卡关
                    continue;
                }
                alive.Add(ai);
                ai.Removed += OnRemoved;
            }
            alive.RemoveAll(a => !a);

            if (Time.time - lastProgress > 30f && queue.Count == 0 && warned.Count == 0 && alive.Count is > 0 and <= 2) Unstick(ppos);
            if (queue.Count == 0 && warned.Count == 0 && alive.Count == 0) Clear();
        }

        void OnRemoved(EnemyAI ai)
        {
            alive.Remove(ai);
            killed++;
            lastProgress = Time.time;
            Hud.Instance?.SetObjective(Remaining > 0 ? $"{title} · 剩余敌人 {Remaining}" : "");
        }

        void Clear()
        {
            phase = Phase.Cleared;
            Hud.Instance?.Banner("区域肃清", 2.5f);
            GameAudio.Play("stage_clear");
            Hud.Instance?.SetObjective("");
            Cleared?.Invoke(this);
            AnySiteCleared?.Invoke(this);
            GameEvents.RaiseEncounterCleared(this);
        }

        void Unstick(Vector3 ppos)
        {
            lastProgress = Time.time;
            foreach (var a in alive)
            {
                if (!a || !PickSpawnPoint(ppos, out var pos)) continue;
                var agent = a.GetComponent<NavMeshAgent>();
                if (agent && agent.isOnNavMesh) agent.Warp(pos);
            }
        }

        bool PickSpawnPoint(Vector3 ppos, out Vector3 point)
        {
            for (int attempt = 0; attempt < 16; attempt++)
            {
                Vector3 p;
                if (anchors.Length > 0 && attempt < 8) p = anchors[UnityEngine.Random.Range(0, anchors.Length)].position + Jitter(2f);
                else
                {
                    var r = UnityEngine.Random.insideUnitCircle * arenaRadius;
                    p = transform.position + new Vector3(r.x, 0, r.y);
                }
                float dist = Flat(p - ppos);
                if (dist < 10f || dist > 28f) continue;
                if (!NavMesh.SamplePosition(p, out var hit, 2.5f, NavMesh.AllAreas)) continue;
                var path = new NavMeshPath();
                if (!NavMesh.CalculatePath(hit.position, ppos, NavMesh.AllAreas, path) || path.status != NavMeshPathStatus.PathComplete) continue;
                point = hit.position;
                return true;
            }
            point = default;
            return false;
        }

        static Vector3 Jitter(float r)
        {
            var c = UnityEngine.Random.insideUnitCircle * r;
            return new Vector3(c.x, 0, c.y);
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1, 0.5f, 0.2f, 0.6f);
            Gizmos.DrawWireSphere(transform.position, triggerRadius);
            Gizmos.color = new Color(1, 0.2f, 0.2f, 0.3f);
            Gizmos.DrawWireSphere(transform.position, arenaRadius);
        }
    }
}
