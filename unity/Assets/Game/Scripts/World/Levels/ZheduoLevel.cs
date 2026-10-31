using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 4-1 折多垭口的关卡运行时（docs/level-design/maps/4-1.md §5；构建器 Level_4_1 摆好、填好引用）：
    ///   · 穷奇游猎：开局 <see cref="roamerDelay"/> 秒后在游猎线第一个路点刷一只穷奇（名册 rank = 精英），把网页 spec.ROAMER 的巡视线和巢穴交给
    ///     <see cref="QiongqiAI.route"/> / <see cref="QiongqiAI.lair"/>（不给的话它只绕出生点 18 m 转圈）。全图一只，打死就没了；
    ///   · 啸獭洞口：白塔溪谷、冰川口两窝啸獭刷出来时，把这一窝的洞口换成网页设计的位置（<see cref="PlateauPack.burrows"/>，同一群共享；
    ///     不换的话 MarmotAI 会在窝边随机放 3–5 个）。
    /// 场景里只有这一个组件，不放怪；怪都由 EncounterSite 和这里在运行时刷。
    /// </summary>
    public sealed class ZheduoLevel : MonoBehaviour
    {
        [Tooltip("穷奇巡视线（路点按顺序循环）")] public Transform[] roamerRoute = System.Array.Empty<Transform>();
        [Tooltip("穷奇巢穴（血少时飞回去回血）")] public Transform roamerLair;
        [Tooltip("开局几秒后刷穷奇")] public float roamerDelay = 3f;
        [Tooltip("刷穷奇的敌人 id")] public string roamerId = "qiongqi";

        [System.Serializable]
        public sealed class Burrows
        {
            public EncounterSite site;
            public Transform[] holes = System.Array.Empty<Transform>();
        }

        public Burrows[] burrows = System.Array.Empty<Burrows>();

        /// <summary>刷出来的穷奇（没刷 / 被打死后为 null）</summary>
        public QiongqiAI Roamer { get; private set; }
        public bool RoamerSpawned { get; private set; }
        /// <summary>换过洞口的啸獭群数（测试用）</summary>
        public int PacksWithBurrows { get; private set; }

        static readonly HashSet<PlateauPack> fixedPacks = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fixedPacks.Clear();

        float startAt;

        void OnEnable() => EncounterSite.AnySpawned += OnSpawned;
        void OnDisable() => EncounterSite.AnySpawned -= OnSpawned;

        void Start()
        {
            startAt = Time.time;
            fixedPacks.Clear();
        }

        void Update()
        {
            if (RoamerSpawned || Time.time - startAt < roamerDelay || roamerRoute.Length == 0) return;
            RoamerSpawned = true;
            var at = roamerRoute[0].position;
            var next = roamerRoute.Length > 1 ? roamerRoute[1].position - at : Vector3.forward;
            next.y = 0;
            var ai = EnemyRoster.Spawn(roamerId, at, Quaternion.LookRotation(next.sqrMagnitude > 0.01f ? next.normalized : Vector3.forward), 0, true);
            if (!ai)
            {
                Debug.LogWarning($"[4-1] 刷不出穷奇（名册里没有 {roamerId}？）");
                return;
            }
            Roamer = ai as QiongqiAI;
            if (!Roamer) return;
            var route = new List<Vector3>();
            foreach (var t in roamerRoute)
                if (t)
                    route.Add(NavMesh.SamplePosition(t.position, out var hit, 6f, NavMesh.AllAreas) ? hit.position : t.position);
            Roamer.route = route.ToArray();
            if (roamerLair) Roamer.lair = NavMesh.SamplePosition(roamerLair.position, out var lh, 6f, NavMesh.AllAreas) ? lh.position : roamerLair.position;
        }

        void OnSpawned(EncounterSite site, EncounterSite.SpawnRecord rec)
        {
            if (!site || site.gameObject.scene != gameObject.scene || rec.ai is not PlateauEnemyAI pe || pe.Pack == null) return;
            foreach (var b in burrows)
            {
                if (b == null || b.site != site || b.holes.Length == 0) continue;
                if (fixedPacks.Contains(pe.Pack)) return;
                fixedPacks.Add(pe.Pack);
                pe.Pack.burrows.Clear();
                foreach (var h in b.holes)
                    if (h)
                        pe.Pack.burrows.Add(NavMesh.SamplePosition(h.position, out var hit, 3f, NavMesh.AllAreas) ? hit.position : h.position);
                PacksWithBurrows++;
                return;
            }
        }
    }
}
