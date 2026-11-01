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
    ///     不换的话 MarmotAI 会在窝边随机放 3–5 个）；
    ///   · 三处领主据点（<see cref="strongholds"/>，BossEncounter 据点模式）：
    ///     门槛按 chuanzang-combat-v1.md 第 4 节画成水平的圆——夔 = 残鼓 22 m、飞廉 = 冰舌顶 32 m、化蛇 = 湖岸擂台 50 m（场地 52 m 往里 2 m），
    ///     脚在圆里、在这一处的高度范围里就 <see cref="BossEncounter.Begin"/>（BossEncounter 自己的触发体按包围盒判，圆的门槛会变成方的，
    ///     所以构建器把它自己的门槛关掉，统一由这里判）；
    ///     据点的灵火坛只由领主点亮：领主没平之前从交互列表里拿掉，换成一张「打败领主后自动点亮」的提示卡（<see cref="LordAltarSeal"/>）。
    /// 场景里只有这一个组件，不放怪；怪都由 EncounterSite、BossEncounter 和这里在运行时刷。
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

        /// <summary>领主据点：首领流程（据点模式，灵火坛在 <see cref="BossEncounter.altar"/>）+ 圆形门槛</summary>
        [System.Serializable]
        public sealed class Stronghold
        {
            public BossEncounter encounter;
            [Tooltip("门槛圆心（夔 = 残鼓，飞廉 / 化蛇 = 擂台中心）")] public Transform center;
            [Tooltip("门槛半径（米，水平）")] public float radius = 22f;
            [Tooltip("门槛里脚的高度范围（世界 y）：圆里地面最低 / 最高再各放几米")] public float minY = -1000f, maxY = 1000f;
            [System.NonSerialized] public LordAltarSeal seal;

            /// <summary>脚在门槛里</summary>
            public bool Contains(Vector3 feet)
            {
                if (!center || feet.y < minY || feet.y > maxY) return false;
                var d = feet - center.position;
                d.y = 0;
                return d.sqrMagnitude <= radius * radius;
            }
        }

        public Stronghold[] strongholds = System.Array.Empty<Stronghold>();

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

        void OnDisable()
        {
            EncounterSite.AnySpawned -= OnSpawned;
            foreach (var s in strongholds)
                if (s?.seal != null)
                {
                    Interaction.Remove(s.seal);
                    if (s.encounter && s.encounter.altar && !s.encounter.altar.Lit) Interaction.Add(s.encounter.altar);
                    s.seal = null;
                }
        }

        void Start()
        {
            startAt = Time.time;
            fixedPacks.Clear();
        }

        void Update()
        {
            Strongholds();
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

        // ───────────── 领主据点 ─────────────

        /// <summary>灵火坛封着（领主没平）、门槛判定</summary>
        void Strongholds()
        {
            var pv = PlayerVitals.Instance;
            foreach (var s in strongholds)
            {
                if (s == null || !s.encounter) continue;
                var enc = s.encounter;
                var altar = enc.altar;
                if (altar)
                {
                    // SpiritAltar 在 Start 里自己登记交互：每帧拿掉（Remove 没登记的不会出错），点亮后撤掉提示卡
                    if (!altar.Lit)
                    {
                        Interaction.Remove(altar);
                        s.seal ??= new LordAltarSeal(altar, enc);
                        Interaction.Add(s.seal);
                    }
                    else if (s.seal != null)
                    {
                        Interaction.Remove(s.seal);
                        s.seal = null;
                    }
                }
                if (!enc.enabled || enc.State != BossEncounter.Phase.Waiting || !pv || pv.Dead || !GameStateMachine.IsPlaying) continue;
                var feet = pv.transform.position;
                if (s.Contains(feet) && !SafeZone.Contains(feet)) enc.Begin();
            }
        }

        /// <summary>据点的灵火坛（领主没平）：交互只给提示，不点火；领主倒下、据点结算时 BossEncounter 直接点亮</summary>
        public sealed class LordAltarSeal : IInteractable
        {
            static readonly Color Warn = new(1f, 0.6f, 0.45f);
            readonly SpiritAltar altar;
            readonly BossEncounter encounter;

            public LordAltarSeal(SpiritAltar altar, BossEncounter encounter)
            {
                this.altar = altar;
                this.encounter = encounter;
            }

            public SpiritAltar Altar => altar;
            public string LordName => encounter && encounter.Def != null ? encounter.Def.name : "领主";

            public Vector3 Focus => altar ? altar.Focus : Vector3.zero;
            public float Radius => altar ? altar.Radius : 0f;
            public bool CanInteract => altar && !altar.Lit;
            public string Prompt => $"{LordName}未平 · 打败它后灵火自动点亮";

            public InteractPrompt PromptCard => new()
            {
                title = altar ? altar.title : "灵火坛",
                subtitle = $"{LordName}未平",
                lines = new[] { $"打败「{LordName}」后灵火自动点亮" },
                color = Warn,
            };

            public void Interact()
            {
                GameAudio.Play("ui_deny");
                GameUI.Toast($"{(altar ? altar.title : "灵火坛")}：打败「{LordName}」后灵火自动点亮", Warn);
            }
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
