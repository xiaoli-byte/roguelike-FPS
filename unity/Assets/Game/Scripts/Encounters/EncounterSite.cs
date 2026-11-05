using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Serialization;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一个战斗场地（遭遇框架 v2，docs/unity-parity.md 3.10 / L2；Three.js StageDirector + WaveRunner + Waves 的移植）：
    ///   编排：<see cref="spec"/>（<see cref="EncounterSpec"/>，各关在 Level_&lt;c&gt;_&lt;n&gt;.cs 里用代码写）——多波次，上一波全部出场且剩 ≤ N 只时
    ///         隔 delay 秒开下一波；开战时先复制一份再做精英升格（从现有单位里升，不加怪）；精英的词缀按「条目 → 小队词缀 → 词缀登记随机」取（<see cref="SquadAffixes"/>）。
    ///   触发：玩家进到 triggerRadius − entryDepth 以内（在场地里站进去几米，不在门槛上开打），并且眼睛看得到场地中心或任一站位；
    ///         深入到半径一半以内、或在里面待满 2 s 时不再要求视线。requires 的场地都肃清了、且没有别的场地正在交战（同一时间只打一处）才会触发；
    ///         autoTrigger = false 的场地（藏宝点守军、脚本）只由 <see cref="Activate"/> 开战。
    ///   出场：每只按角色的默认到场延迟（或条目写的延迟）+ 同条目 0.18 s 间隔排队；近战成群（≥ 3）留最后一只晚 2.5 s 走侧翼。
    ///         到点时按角色选站位（<see cref="SpawnStations"/>：站位角色 / lane / 高台、远程上高台、冲锋型从场地远端进、按体型查出生净空），
    ///         先闪 0.8 s 地面预警（<see cref="Telegraph"/> 圆形，精英金色）；预警结束再复检一次，玩家站上去了或场景变了就收掉预警、换点、重新给足 0.8 s。
    ///         全场同时在场最多 maxAlive 只。选不到点时这只稍后重试并逐步放宽：卡 2 s 放宽距离带到 6–48 m，卡 6 s 接受不完整路径。
    ///   提示：开战横幅（场地名 + 第一波提示）、多波时每波横幅「第 2 / 3 波 · 名字」、目标栏「场地 · 第 i/n 波 · 剩余敌人」。
    ///   肃清：全部波次出完且全部死亡 → 横幅「区域肃清」→ Cleared 事件（宝箱由 LootDirector、目标图由 <see cref="LevelObjective"/> 处理）。
    ///   防卡：30 s 没有进展、只剩 ≤ 2 只时，把它们传送到玩家附近的合法站位。
    /// 旧场景里只有 Squad[] 编制（字段名 squads）的场地照常工作：按单波、原出场时间转成编排。
    /// 出场方式（第三章 v2 S1，<see cref="SpawnMode"/>）：条目 Via 了某种方式、场地里有这种站位时：
    ///   埋伏：玩家进到 <see cref="ArmRadius"/> 内就在埋伏站位上预生成、休眠（AI 停用、不索敌、不占出手名额，但打得到）；
    ///         该波开波时整组苏醒（头顶「！」+ 吼），被打中提前唤醒整组、场地随之开战（休眠单位只在玩家走近、没有别处在交战时打得到）。休眠的不算全场同时在场上限（<see cref="DormantCount"/>）；
    ///   余烬起身 / 熔岩爬出 / 飞临 / 跃下 / 增援门：预警换成各自的预告（<see cref="SpawnCues"/>），出场换成各自的位移（<see cref="SpawnEntrance"/>）；
    ///   站位不合适（不是炭童却要余烬起身、找不到熔岩、没给跃下高点）时退回现身。出场记录带实际用的方式（<see cref="SpawnRecord.mode"/>）。
    /// 路遇（<see cref="roadside"/>）：开战只弹一行提示、肃清不弹横幅。
    /// </summary>
    public sealed class EncounterSite : MonoBehaviour
    {
        /// <summary>旧式编制条目（单波）：现在只给只认 Squad[] 的读者（宝箱档位、L5 出生净空）和旧场景兼容用，新场地写 <see cref="spec"/></summary>
        [Serializable]
        public sealed class Squad
        {
            public string enemy;
            public int count = 1;
            [Tooltip("开战后多少秒到场")] public float delay;
            public bool elite;
        }

        public enum Phase { Idle, Active, Cleared }

        /// <summary>一只敌人的出场记录（测试、调试面板用）</summary>
        public struct SpawnRecord
        {
            public EnemyAI ai;
            public string id, affix;
            public bool elite, elevated;
            public StationRole role;
            public int lane, wave;
            /// <summary>出自哪个站位（兜底随机点为 null）</summary>
            public Transform anchor;
            public Vector3 point, player;
            /// <summary>预警结束复检不过、换过点</summary>
            public bool relocated;
            /// <summary>实际用的出场方式（站位不合适退回现身时是 Appear）</summary>
            public SpawnMode mode;
        }

        public string title = "战场";

        [Header("触发")]
        public float triggerRadius = 16f;
        [Tooltip("要站进触发圈几米才开战（不在门槛上开打）")]
        public float entryDepth = 2f;
        [Tooltip("开战要看得到场地中心或任一站位（深入到半径一半以内、或待满 2 s 不再要求）")]
        public bool requireSight = true;
        [Tooltip("关掉 = 只由脚本 / 藏宝点调用 Activate 开战")]
        public bool autoTrigger = true;
        public EncounterSite[] requires = Array.Empty<EncounterSite>();

        [Header("场地")]
        public float arenaRadius = 30f;
        [Tooltip("刷怪站位（带 SpawnAnchor 的标记；只是空物体的旧锚点按 Auto / lane 0 / 地面处理）")]
        public Transform[] anchors = Array.Empty<Transform>();
        [Tooltip("难度倍率（0 = 本关难度，RunState）")]
        public float difficulty;

        [Header("编排")]
        public EncounterSpec spec = new();
        [FormerlySerializedAs("squads"), SerializeField, HideInInspector]
        Squad[] legacySquads = Array.Empty<Squad>();

        [Header("出场方式（S1）")]
        [Tooltip("路遇：主路上的小队，不计目标、不落宝箱、横幅只给一行小字（用 AsRoadside 设置；条目一般 Via(Ambush)）")]
        public bool roadside;
        [Tooltip("埋伏单位提前摆上场的距离：玩家离场地中心这么近时预生成并休眠（米；0 = 触发半径 + 40，至少 60）")]
        public float armRadius;

        [Header("目标与奖励")]
        [Tooltip("可选场地：不算进关卡目标的必清场地")]
        public bool optional;
        [Tooltip("肃清后在场地上落的宝箱奖励：weapon:<id>[:稀有度] / scroll / coins / heal / pet；空 = 不落")]
        public string reward = "";
        public Vector3 chestOffset;

        public Phase phase { get; private set; } = Phase.Idle;
        /// <summary>全部波次的敌人总数（开战时定下）</summary>
        public int Total { get; private set; }
        public int AliveCount => alive.Count;
        public int Remaining => Total - killed;
        /// <summary>当前波（0 起；开战前 −1）</summary>
        public int Wave { get; private set; } = -1;
        public int WaveCount => run != null ? run.waves.Length : CurrentSpec().waves.Length;
        /// <summary>开战时升格的精英只数</summary>
        public int Promoted { get; private set; }
        /// <summary>预警结束复检不过、换点的次数</summary>
        public int Relocations { get; private set; }
        /// <summary>有敌人选不到出生点、正在重试</summary>
        public bool Stalled { get; private set; }
        /// <summary>本次开战实际用的编排（复制 + 升格后的；开战前为 null）</summary>
        public EncounterSpec Runtime => run;
        public IReadOnlyList<SpawnRecord> Spawns => records;

        /// <summary>
        /// 旧式编制视图：开战后是实际编排，开战前是模板（要升格时每种普通单位补一条 count = 0 的精英记录，见 <see cref="EncounterSpec.ToSquads"/>）。
        /// 赋值 = 按旧规则（单波、原出场时间）写成编排，旧的关卡生成代码不用改。
        /// </summary>
        public Squad[] squads
        {
            get => run != null ? run.ToSquads() : spec != null && !spec.IsEmpty ? spec.ToSquads() : legacySquads ?? Array.Empty<Squad>();
            set
            {
                spec = EncounterSpec.FromSquads(value, title);
                legacySquads = Array.Empty<Squad>();
            }
        }

        /// <summary>
        /// 设成路遇（链式，S1）：不计目标（optional）、自动触发、小触发圈、要视线、不落宝箱。
        /// 摆的时候离必清场地 ≥ 触发半径 + 场地半径，免得两处同时开打（同一时间只打一处）
        /// </summary>
        public EncounterSite AsRoadside(float trigger = 12f, float arena = 16f)
        {
            roadside = true;
            optional = true;
            autoTrigger = true;
            requireSight = true;
            triggerRadius = trigger;
            arenaRadius = arena;
            reward = "";
            return this;
        }

        /// <summary>埋伏单位实际的预生成半径</summary>
        public float ArmRadius => armRadius > 0 ? armRadius : Mathf.Max(60f, triggerRadius + 40f);

        public event Action<EncounterSite> Cleared;
        public static event Action<EncounterSite> AnySiteCleared;
        /// <summary>某场地开了第 i 波（0 起）</summary>
        public static event Action<EncounterSite, int> AnyWaveStarted;
        /// <summary>某场地刷出了一只敌人</summary>
        public static event Action<EncounterSite, SpawnRecord> AnySpawned;

        /// <summary>正在交战的场地</summary>
        public static IReadOnlyList<EncounterSite> ActiveSites => active;
        static readonly List<EncounterSite> active = new();

        /// <summary>全场正在休眠的埋伏单位（不算全场同时在场上限）</summary>
        public static int DormantCount { get; private set; }
        /// <summary>开局以来各出场方式实际出场的次数（测试、调试面板用；Play 进出清零）</summary>
        public static readonly Dictionary<SpawnMode, int> ModeTally = new();

        const float WarnTime = 0.8f, HoldBackDelay = 2.5f, SightGrace = 2f, DeepFraction = 0.5f, RetryDelay = 0.25f;
        /// <summary>出生预警色（TS WARN_COLOR / ELITE_COLOR）</summary>
        static readonly Color WarnNormal = new(1f, 0.29f, 0.23f), WarnElite = new(1f, 0.76f, 0.2f);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            active.Clear();
            DormantCount = 0;
            ModeTally.Clear();
            AnySiteCleared = null;
            AnyWaveStarted = null;
            AnySpawned = null;
        }

        sealed class Pending
        {
            public string id, affix;
            public EnemyDef def;
            public bool elite;
            public StationRole role;
            public SpawnMode mode;
            /// <summary>选好点后实际用的出场方式与辅助点（入场点 / 熔岩冒出点 / 跃下高点 / 门后出生点）</summary>
            public SpawnMode present;
            public Vector3 aux;
            public MonoBehaviour door;
            public GameObject cue;
            public int lane, wave;
            public float warnAt, at;
            public bool warned, hasPos, elevated, relocated;
            public Vector3 pos;
            public Transform anchor;
            public TelegraphHandle warning;
            /// <summary>选不到点的起始时刻（−1 = 没卡）：卡得越久放得越宽</summary>
            public float blockedSince = -1;
        }

        EncounterSpec run;
        readonly List<Pending> pending = new();

        /// <summary>预生成的埋伏单位</summary>
        sealed class Dormant
        {
            public EnemyAI ai;
            public string id, affix;
            public int wave;
            public bool elite, woken, consumed;
            public Transform anchor;
        }

        readonly List<Dormant> dormant = new();
        readonly HashSet<MonoBehaviour> openedDoors = new();
        bool armed;
        /// <summary>预生成了几只埋伏单位（测试用）</summary>
        public int ArmedCount => dormant.Count;
        /// <summary>还在休眠的埋伏单位（测试用）</summary>
        public int SleepingCount
        {
            get
            {
                int n = 0;
                foreach (var d in dormant)
                    if (!d.woken && d.ai && !d.ai.Dead) n++;
                return n;
            }
        }
        readonly List<EnemyAI> alive = new();
        readonly List<SpawnRecord> records = new();
        readonly List<SpawnStations.Recent> recent = new();
        readonly List<int> lanes = new();
        int nextWave, killed;
        bool waitingNext;
        float nextWaveAt, lastProgress, insideSince = -1;
        RunRng rng;

        RunRng Rng => rng ??= RunState.Ensure().Stream("encounter:" + title);

        /// <summary>编排模板：spec 有内容用 spec，否则按旧编制转</summary>
        EncounterSpec CurrentSpec() =>
            spec != null && !spec.IsEmpty ? spec : legacySquads != null && legacySquads.Length > 0 ? EncounterSpec.FromSquads(legacySquads, title) : spec ?? new EncounterSpec();

        void Update()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            if (!armed && phase != Phase.Cleared) TryArm(pv.transform);
            if (dormant.Count > 0) GuardDormant(pv.transform);
            switch (phase)
            {
                case Phase.Idle:
                    if (autoTrigger && ShouldTrigger(pv.transform)) Activate();
                    break;
                case Phase.Active:
                    Tick(pv.transform);
                    break;
            }
        }

        void OnDisable()
        {
            active.Remove(this);
            foreach (var p in pending)
            {
                p.warning.FadeOut();
                if (p.cue) Destroy(p.cue);
            }
        }

        void OnDestroy()
        {
            foreach (var d in dormant)
                if (!d.woken)
                {
                    d.woken = true;
                    DormantCount = Mathf.Max(0, DormantCount - 1);
                }
        }

        // ───────────── 触发 ─────────────

        public bool RequirementsMet()
        {
            if (requires == null) return true;
            foreach (var r in requires)
                if (r && r.phase != Phase.Cleared) return false;
            return true;
        }

        bool ShouldTrigger(Transform player)
        {
            if (!RequirementsMet()) return false;
            foreach (var s in active)
                if (s && s != this)
                {
                    insideSince = -1;
                    return false;
                }
            var ppos = player.position;
            float d = Flat(ppos - transform.position);
            float depthRadius = Mathf.Max(1f, triggerRadius - Mathf.Max(0, entryDepth));
            if (d > depthRadius)
            {
                insideSince = -1;
                return false;
            }
            if (insideSince < 0) insideSince = Time.time;
            if (!requireSight || d <= triggerRadius * DeepFraction || Time.time - insideSince >= SightGrace) return true;
            return SeesSite(ppos + Vector3.up * 1.6f);
        }

        /// <summary>从 eye 看得到场地中心或任一站位（离地 1.2 m）</summary>
        public bool SeesSite(Vector3 eye)
        {
            if (!Combat.Blocked(eye, transform.position + Vector3.up * 1.2f, null)) return true;
            if (anchors != null)
                foreach (var a in anchors)
                    if (a && !Combat.Blocked(eye, a.position + Vector3.up * 1.2f, null)) return true;
            return false;
        }

        /// <summary>开战（自动触发、藏宝点、脚本、测试共用）；已经开过战返回 false</summary>
        public bool Activate()
        {
            if (phase != Phase.Idle) return false;
            phase = Phase.Active;
            if (!active.Contains(this)) active.Add(this);
            run = CurrentSpec().Clone();
            Promoted = run.promote > 0 ? EncounterSpec.Promote(run, run.promote, Rng) : 0;
            Total = run.Total;
            killed = 0;
            Wave = -1;
            nextWave = 0;
            waitingNext = false;
            nextWaveAt = Time.time + Mathf.Max(0, run.gather);
            lastProgress = Time.time;
            CollectLanes();
            string sub = null;
            if (run.waves.Length > 0 && run.waves[0] != null)
            {
                var first = run.waves[0];
                sub = !string.IsNullOrEmpty(first.hint) ? first.hint : null;
                if (run.waves.Length > 1) sub = $"共 {run.waves.Length} 波" + (sub != null ? $" · {sub}" : "");
            }
            if (roadside) GameUI.Toast($"路遇 · {title}", new Color(1f, 0.78f, 0.45f), 2f);
            else GameUI.Banner(title, sub, 2f);
            GameAudio.Play("wave_start");
            UpdateObjective();
            GameEvents.RaiseEncounterStarted(this);
            return true;
        }

        void CollectLanes()
        {
            lanes.Clear();
            if (anchors != null)
                foreach (var a in anchors)
                {
                    if (!a) continue;
                    int l = SpawnAnchor.Read(a).lane;
                    if (!lanes.Contains(l)) lanes.Add(l);
                }
            lanes.Sort();
        }

        // ───────────── 波次 ─────────────

        void StartWave(int index)
        {
            var w = run.waves[index];
            Wave = index;
            float now = Time.time;
            lastProgress = now;
            int baseIdx = lanes.Count > 0 ? index % lanes.Count : 0;
            int mainLane = lanes.Count > 0 ? lanes[baseIdx] : 0;
            int flankIdx = 0;
            if (w?.entries != null)
                foreach (var e in w.entries)
                {
                    if (e == null || string.IsNullOrEmpty(e.enemy) || e.count <= 0) continue;
                    var def = EnemyRoster.Get(e.enemy);
                    var role = SpawnStations.Resolve(e.role, def);
                    float arrival = e.arrivalDelay >= 0 ? e.arrivalDelay : SpawnStations.DefaultArrival(role);
                    bool hold = e.holdBack && !e.elite && e.count >= 3 && def != null && def.role == AttackTokens.Kind.Melee;
                    int already = e.via == SpawnMode.Ambush ? WakeFor(index, e) : 0;
                    if (already > 0) hold = false;
                    for (int k = already; k < e.count; k++)
                    {
                        bool late = hold && k == e.count - 1;
                        var r = late ? StationRole.Flank : role;
                        int lane = e.lane >= 0 ? e.lane
                            : r == StationRole.Flank ? (lanes.Count > 1 ? lanes[(baseIdx + 1 + flankIdx++ % 2) % lanes.Count] : lanes.Count == 1 ? lanes[0] : 1)
                            : mainLane;
                        pending.Add(new Pending
                        {
                            id = e.enemy, def = def, elite = e.elite, role = r, lane = lane, wave = index, mode = e.via,
                            affix = SquadAffixes.Resolve(def, e.elite, e.affix, run.squadAffix, Rng),
                            warnAt = now + arrival + k * Mathf.Max(0, run.stagger) + (late ? HoldBackDelay : 0),
                        });
                    }
                }
            if (index > 0 && run.waves.Length > 1)
            {
                string label = !string.IsNullOrEmpty(w?.label) ? $" · {w.label}" : "";
                GameUI.Banner($"第 {index + 1} / {run.waves.Length} 波{label}", string.IsNullOrEmpty(w?.hint) ? null : w.hint, 2.2f);
                GameAudio.Play("wave_start");
            }
            UpdateObjective();
            AnyWaveStarted?.Invoke(this, index);
        }

        void Tick(Transform player)
        {
            float now = Time.time;
            var ppos = player.position;
            // 开波：第一波到集结时间就开；之后等上一波全部出场、剩 ≤ N 只，再隔 delay
            if (nextWave < run.waves.Length)
            {
                if (waitingNext)
                {
                    var w = run.waves[nextWave];
                    if (pending.Count == 0 && alive.Count <= Mathf.Max(0, w?.triggerRemaining ?? 0))
                    {
                        waitingNext = false;
                        nextWaveAt = now + Mathf.Max(0, w?.delay ?? 0);
                    }
                }
                else if (now >= nextWaveAt)
                {
                    StartWave(nextWave++);
                    waitingNext = nextWave < run.waves.Length;
                }
            }

            int warnedCount = 0;
            foreach (var p in pending)
                if (p.warned) warnedCount++;
            bool stalled = false;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                var p = pending[i];
                if (now < p.warnAt) continue;
                if (!p.warned)
                {
                    // 全场上限：已在场 + 本场地正在预警的
                    if (EnemyRegistry.Count - DormantCount + warnedCount >= Mathf.Max(1, run.maxAlive))
                    {
                        p.warnAt = now + RetryDelay;
                        continue;
                    }
                    if (!p.hasPos || !StillSafe(p, player)) p.hasPos = Choose(p, player);
                    if (!p.hasPos)
                    {
                        if (p.blockedSince < 0) p.blockedSince = now;
                        p.warnAt = now + RetryDelay;
                        stalled = true;
                        continue;
                    }
                    p.blockedSince = -1;
                    Warn(p, now);
                    warnedCount++;
                    continue;
                }
                if (now < p.at) continue;
                // 预警结束复检：玩家冲到预警圈上、或场景变了 → 收掉预警，换点，重新给足预警
                if (!StillSafe(p, player))
                {
                    p.warning.FadeOut(); // 填满的预警撤不回（Cancel 只撤没填满的），直接淡出
                    p.warning = TelegraphHandle.None;
                    if (p.cue) Destroy(p.cue);
                    p.warned = false;
                    p.relocated = true;
                    Relocations++;
                    p.hasPos = Choose(p, player);
                    if (p.hasPos)
                    {
                        p.blockedSince = -1;
                        Warn(p, now);
                    }
                    else
                    {
                        warnedCount--;
                        if (p.blockedSince < 0) p.blockedSince = now;
                        p.warnAt = now + RetryDelay;
                        stalled = true;
                    }
                    continue;
                }
                pending.RemoveAt(i);
                warnedCount--;
                Spawn(p, ppos); // 预警填满后自己闪一下消失
            }
            Stalled = stalled;
            alive.RemoveAll(a => !a);
            recent.RemoveAll(r => now - r.time > 6f);

            if (now - lastProgress > 30f && pending.Count == 0 && alive.Count is > 0 and <= 2) Unstick(player);
            if (nextWave >= run.waves.Length && pending.Count == 0 && alive.Count == 0) Clear();
        }

        void Warn(Pending p, float now)
        {
            p.warned = true;
            var (r, _) = SpawnStations.BodySize(p.def, p.elite);
            switch (p.present)
            {
                case SpawnMode.Ember:
                    p.at = Mathf.Max(p.at, now + SpawnCues.EmberTime);
                    p.cue = SpawnCues.EmberPile(p.pos, p.at - now);
                    return;
                case SpawnMode.LavaCrawl:
                    p.at = Mathf.Max(p.at, now + SpawnCues.LavaTime);
                    SpawnCues.LavaBubble(p.aux, Mathf.Max(1.2f, r + 0.4f), p.at - now);
                    return;
                case SpawnMode.FlyIn:
                    p.at = Mathf.Max(p.at, now + SpawnCues.FlyTime);
                    SpawnCues.FlyCry(p.aux);
                    return;
                case SpawnMode.Drop:
                    // 露头 0.6 s 在 SpawnEntrance 里：这里马上生成到墙头
                    p.at = Mathf.Max(p.at, now + 0.05f);
                    return;
                case SpawnMode.Gate:
                    p.at = Mathf.Max(p.at, now + SpawnCues.GateTime);
                    OpenDoor(p.door);
                    SpawnCues.GateGlow(p.aux, 4f, p.pos - p.aux, p.at - now);
                    return;
            }
            p.at = Mathf.Max(p.at, now + WarnTime); // 慢帧跨过了预警时刻，屏幕上的预警也要给足
            // 出生点提示（不伤人）：原色（精英金 / 普通红），不用危险配色
            p.warning = Telegraph.Circle(p.pos, Mathf.Max(1.1f, r + 0.3f), p.at - now, p.elite ? WarnElite : WarnNormal, TelegraphTone.Own);
        }

        /// <summary>增援门：同一扇门只开一次（MovingPlatform 收到第二次信号会开回去）</summary>
        void OpenDoor(MonoBehaviour door)
        {
            if (!door || door is not IActivatable a || !openedDoors.Add(door)) return;
            try
            {
                a.OnActivated(null, true);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 选点 ─────────────

        SpawnStations.Query QueryFor(Pending p, Vector3 player, Vector3 forward)
        {
            float stalledFor = p.blockedSince < 0 ? 0 : Time.time - p.blockedSince;
            bool wide = stalledFor > 2f;
            return new SpawnStations.Query
            {
                def = p.def, elite = p.elite, role = p.role, lane = p.lane,
                player = player, playerForward = forward, center = transform.position, arenaRadius = arenaRadius,
                minDist = wide ? Mathf.Min(6f, run.minPlayerDistance) : run.minPlayerDistance,
                maxDist = wide ? Mathf.Max(48f, run.maxPlayerDistance) : run.maxPlayerDistance,
                partialOk = stalledFor > 6f,
                anchors = anchors, recent = recent, now = Time.time, mode = p.mode,
            };
        }

        bool Choose(Pending p, Transform player)
        {
            var q = QueryFor(p, player.position, player.forward);
            if (!SpawnStations.Pick(q, out var st)) return false;
            p.pos = st.point;
            p.anchor = st.anchor;
            p.elevated = st.elevated;
            ResolvePresent(p);
            recent.Add(new SpawnStations.Recent { pos = st.point, role = p.role, time = Time.time });
            return true;
        }

        /// <summary>
        /// 选好站位后定实际的出场方式：站位是这种方式的才用；余烬起身只给炭童；熔岩爬出要找得到熔岩（站位的 entry，或站位外 3–8 m 的熔岩）；
        /// 飞临只给会飞的（入场点 = entry，没给就从场地外侧 22 m、高 14 m 处来）；跃下要有 dropFrom；增援门的出生点 = gate（没给就是站位）
        /// </summary>
        void ResolvePresent(Pending p)
        {
            p.present = SpawnMode.Appear;
            p.door = null;
            if (p.mode == SpawnMode.Appear || p.mode == SpawnMode.Ambush || !p.anchor) return;
            var a = p.anchor.GetComponent<SpawnAnchor>();
            if (!a || a.mode != p.mode) return;
            switch (p.mode)
            {
                case SpawnMode.Ember:
                    if (p.id != null && p.id.StartsWith("tantong")) p.present = SpawnMode.Ember;
                    return;
                case SpawnMode.LavaCrawl:
                    if (a.entry)
                    {
                        p.aux = a.entry.position;
                        p.present = SpawnMode.LavaCrawl;
                    }
                    else if (LavaField.NearestLava(p.pos, 8f, out var lava, out _))
                    {
                        var out3 = lava - p.pos;
                        out3.y = 0;
                        p.aux = lava + (out3.sqrMagnitude > 0.01f ? out3.normalized * 2.5f : Vector3.zero);
                        p.present = SpawnMode.LavaCrawl;
                    }
                    return;
                case SpawnMode.FlyIn:
                    if (p.def == null || !p.def.flying) return;
                    if (a.entry) p.aux = a.entry.position;
                    else
                    {
                        var outward = p.pos - transform.position;
                        outward.y = 0;
                        if (outward.sqrMagnitude < 0.01f) outward = -a.transform.forward;
                        p.aux = p.pos + outward.normalized * 22f + Vector3.up * 14f;
                    }
                    p.present = SpawnMode.FlyIn;
                    return;
                case SpawnMode.Drop:
                    if (!a.dropFrom) return;
                    p.aux = a.dropFrom.position;
                    p.present = SpawnMode.Drop;
                    return;
                case SpawnMode.Gate:
                    p.aux = a.gate ? a.gate.position : p.pos;
                    p.door = a.gateDoor;
                    p.present = SpawnMode.Gate;
                    return;
            }
        }

        bool StillSafe(Pending p, Transform player) => SpawnStations.Safe(QueryFor(p, player.position, player.forward), p.pos, p.elevated, out _);

        void Spawn(Pending p, Vector3 ppos)
        {
            lastProgress = Time.time;
            if (p.cue) Destroy(p.cue);
            var look = ppos - p.pos;
            look.y = 0;
            bool swimmer = p.present == SpawnMode.LavaCrawl && IsSwimmer(p.def);
            // 生成点：熔岩爬出生在熔岩里（地面预警的法阵落在熔岩下）、增援门生在门后；飞临 / 跃下先生在落点，再由 SpawnEntrance 挪到起点
            var at = p.present switch
            {
                SpawnMode.LavaCrawl => p.aux,
                SpawnMode.Gate => p.aux,
                _ => p.pos,
            };
            var ai = EnemyRoster.Spawn(p.id, at, Quaternion.LookRotation(look.sqrMagnitude > 0.01f ? look : Vector3.forward), difficulty, p.elite,
                new SpawnOptions { parent = transform, affix = p.affix });
            if (!ai)
            {
                killed++; // 名册里没有：当作已清，免得卡关
                UpdateObjective();
                return;
            }
            if (p.present != SpawnMode.Appear) SkipMaterialize(ai);
            switch (p.present)
            {
                case SpawnMode.Ember:
                    SpawnCues.EmberRise(p.pos);
                    break;
                case SpawnMode.LavaCrawl:
                    if (swimmer) SpawnCues.LavaSplash(p.aux);
                    else SpawnEntrance.Begin(ai, SpawnEntrance.Kind.Hop, AboveLava(p.aux), p.pos);
                    break;
                case SpawnMode.FlyIn:
                    SpawnEntrance.Begin(ai, SpawnEntrance.Kind.Fly, p.aux, p.pos + Vector3.up * 2f);
                    break;
                case SpawnMode.Drop:
                    SpawnEntrance.Begin(ai, SpawnEntrance.Kind.Jump, p.aux, p.pos);
                    break;
            }
            alive.Add(ai);
            ai.Removed += OnRemoved;
            Tally(p.present);
            var rec = new SpawnRecord
            {
                ai = ai, id = p.id, affix = p.affix, elite = p.elite, elevated = p.elevated, role = p.role, lane = p.lane, wave = p.wave,
                anchor = p.anchor, point = p.pos, player = ppos, relocated = p.relocated, mode = p.present,
            };
            records.Add(rec);
            AnySpawned?.Invoke(this, rec);
        }

        static void Tally(SpawnMode m) => ModeTally[m] = (ModeTally.TryGetValue(m, out int n) ? n : 0) + 1;

        /// <summary>熔岩生物（火鼍）：直接生在熔岩里潜游进场，不做上岸跃起</summary>
        static bool IsSwimmer(EnemyDef def) => def != null && def.ai != null && typeof(ILavaDweller).IsAssignableFrom(def.ai);

        /// <summary>熔岩面上方 0.4 m（熔岩系统只认脚底 0.3 m 内的算踩在熔岩里）</summary>
        static Vector3 AboveLava(Vector3 p) => LavaField.TrySurfaceHeight(p, out float y) ? new Vector3(p.x, y + 0.4f, p.z) : p + Vector3.up * 0.4f;

        /// <summary>不走「现身」的出场：显形溶解直接收尾（地面法阵已经发出去了，熔岩爬出 / 门后的那一个看不见）</summary>
        static void SkipMaterialize(EnemyAI ai)
        {
            if (ai && ai.TryGetComponent(out SpawnMaterialize sm)) sm.enabled = false;
        }

        // ───────────── 埋伏（预生成、休眠、苏醒）─────────────

        /// <summary>
        /// 玩家进到 <see cref="ArmRadius"/> 以内、前置场地都肃清了：把各波 Via(Ambush) 的条目预生成在埋伏站位上并休眠。
        /// 站位按角色对上优先、贴地的不站高台，同一站位多只时绕一圈散开；朝向 = 站位的 forward。没有埋伏站位的场地什么都不做
        /// </summary>
        void TryArm(Transform player)
        {
            if (armed) return;
            var template = run ?? CurrentSpec();
            if (template?.waves == null)
            {
                armed = true;
                return;
            }
            var ambush = new List<Transform>();
            if (anchors != null)
                foreach (var t in anchors)
                    if (t && SpawnAnchor.ModeOf(t) == SpawnMode.Ambush)
                        ambush.Add(t);
            bool any = false;
            foreach (var w in template.waves)
                if (w?.entries != null)
                    foreach (var e in w.entries)
                        any |= e != null && e.count > 0 && e.via == SpawnMode.Ambush;
            if (ambush.Count == 0 || !any)
            {
                armed = true;
                return;
            }
            if (Flat(player.position - transform.position) > ArmRadius || !RequirementsMet()) return;
            armed = true;
            var used = new Dictionary<Transform, int>();
            for (int wi = 0; wi < template.waves.Length; wi++)
            {
                var w = template.waves[wi];
                if (w?.entries == null || (phase == Phase.Active && wi < nextWave)) continue;
                foreach (var e in w.entries)
                {
                    if (e == null || e.count <= 0 || e.via != SpawnMode.Ambush || string.IsNullOrEmpty(e.enemy)) continue;
                    var def = EnemyRoster.Get(e.enemy);
                    var role = SpawnStations.Resolve(e.role, def);
                    for (int k = 0; k < e.count; k++)
                    {
                        var a = PickAmbushAnchor(ambush, used, def, role);
                        if (!a) break;
                        int n = used.TryGetValue(a, out int c) ? c : 0;
                        used[a] = n + 1;
                        var (_, _, elevated, spread) = SpawnAnchor.Read(a);
                        var pos = a.position;
                        if (n > 0)
                        {
                            float ang = n * 2.1f;
                            pos += new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * Mathf.Max(1.4f, spread);
                        }
                        var face = a.forward;
                        face.y = 0;
                        string affix = SquadAffixes.Resolve(def, e.elite, e.affix, template.squadAffix, Rng);
                        var ai = EnemyRoster.Spawn(e.enemy, pos, Quaternion.LookRotation(face.sqrMagnitude > 0.01f ? face.normalized : Vector3.forward), difficulty, e.elite,
                            new SpawnOptions { parent = transform, affix = affix });
                        if (!ai) continue;
                        // 栖在柱顶 / 台沿的（高台站位）：生成器会把它吸到 4 m 内的导航网格上，这里放回站位
                        if (elevated && def != null && def.flying) ai.transform.position = pos;
                        SkipMaterialize(ai);
                        ai.enabled = false;
                        if (ai.Health) ai.Health.untargetable = true;
                        var d = new Dormant { ai = ai, id = e.enemy, affix = affix, wave = wi, elite = e.elite, anchor = a };
                        dormant.Add(d);
                        DormantCount++;
                        ai.Removed += OnDormantRemoved;
                        if (ai.Health)
                        {
                            int wave = wi;
                            ai.Health.Damaged += (_, _) => OnDormantHit(wave);
                        }
                    }
                }
            }
        }

        static Transform PickAmbushAnchor(List<Transform> ambush, Dictionary<Transform, int> used, EnemyDef def, StationRole role)
        {
            Transform best = null;
            float bestScore = float.MinValue;
            foreach (var a in ambush)
            {
                var (r, _, elevated, _) = SpawnAnchor.Read(a);
                if (elevated && def != null && def.groundOnly) continue;
                float s = -(used.TryGetValue(a, out int n) ? n : 0) * 3f;
                if (r != StationRole.Auto) s += r == role ? 4f : -2f;
                if (elevated) s += SpawnStations.RaisedRole(role) ? 2f : -1f;
                if (s > bestScore)
                {
                    bestScore = s;
                    best = a;
                }
            }
            return best;
        }

        /// <summary>开第 wave 波时：这一条目要几只，先从预生成的同种埋伏单位里认领（叫醒），返回认领了几只（不够的照常出场）</summary>
        int WakeFor(int wave, WaveEntry e)
        {
            int got = 0;
            foreach (var d in dormant)
            {
                if (got >= e.count) break;
                if (d.consumed || d.wave != wave || d.id != e.enemy || d.elite != e.elite) continue;
                d.consumed = true;
                got++;
                if (!d.woken) Wake(d);
            }
            return got;
        }

        /// <summary>休眠单位打得到的距离：玩家离场地中心 ≤ 触发半径 + 这么多米</summary>
        const float WakeReach = 15f;

        /// <summary>
        /// 休眠的埋伏单位只在「这个场地能开战」时打得到：玩家离场地中心 ≤ 触发半径 + <see cref="WakeReach"/>、前置场地都肃清了、
        /// 没有别的场地正在交战（同一时间只打一处）；其余时间不可选中（远处看得见、打不着，不会在别处交战时把这里提前叫醒）
        /// </summary>
        void GuardDormant(Transform player)
        {
            bool wakeable = phase != Phase.Cleared && Flat(player.position - transform.position) <= triggerRadius + WakeReach && RequirementsMet() && !OtherActive();
            foreach (var d in dormant)
                if (!d.woken && d.ai && !d.ai.Dead && d.ai.Health)
                    d.ai.Health.untargetable = !wakeable;
        }

        bool OtherActive()
        {
            foreach (var s in active)
                if (s && s != this)
                    return true;
            return false;
        }

        /// <summary>被打中：整组（同一波的埋伏单位）提前苏醒；场地还没开战就开战（别的场地正在交战时不叫醒，见 <see cref="GuardDormant"/>）</summary>
        void OnDormantHit(int wave)
        {
            if (phase == Phase.Cleared || OtherActive()) return;
            if (phase == Phase.Idle) Activate();
            foreach (var d in dormant)
                if (d.wave == wave && !d.woken)
                    Wake(d);
        }

        void Wake(Dormant d)
        {
            d.woken = true;
            DormantCount = Mathf.Max(0, DormantCount - 1);
            var ai = d.ai;
            if (!ai || ai.Dead) return;
            ai.enabled = true;
            if (ai.Health) ai.Health.untargetable = false;
            SpawnCues.Wake(ai);
            lastProgress = Time.time;
            if (!alive.Contains(ai))
            {
                alive.Add(ai);
                ai.Removed += OnRemoved;
            }
            Tally(SpawnMode.Ambush);
            var rec = new SpawnRecord
            {
                ai = ai, id = d.id, affix = d.affix, elite = d.elite, elevated = SpawnAnchor.Read(d.anchor).elevated, role = SpawnStations.Resolve(StationRole.Auto, EnemyRoster.Get(d.id)),
                lane = SpawnAnchor.Read(d.anchor).lane, wave = d.wave, anchor = d.anchor, point = ai.transform.position,
                player = PlayerVitals.Instance ? PlayerVitals.Instance.transform.position : Vector3.zero, mode = SpawnMode.Ambush,
            };
            records.Add(rec);
            AnySpawned?.Invoke(this, rec);
        }

        /// <summary>休眠中就死了（一下打死、掉出世界）：开战（它算在总数里）、记一只击杀</summary>
        void OnDormantRemoved(EnemyAI ai)
        {
            foreach (var d in dormant)
            {
                if (d.ai != ai || d.woken) continue;
                d.woken = true;
                DormantCount = Mathf.Max(0, DormantCount - 1);
                if (phase == Phase.Idle) Activate();
                if (phase == Phase.Active)
                {
                    killed++;
                    UpdateObjective();
                }
                return;
            }
        }

        void OnRemoved(EnemyAI ai)
        {
            if (!alive.Remove(ai)) return;
            killed++;
            lastProgress = Time.time;
            UpdateObjective();
        }

        void UpdateObjective()
        {
            if (phase != Phase.Active || Remaining <= 0) return;
            string wave = run != null && run.waves.Length > 1 ? $" · 第 {Mathf.Max(0, Wave) + 1}/{run.waves.Length} 波" : "";
            GameUI.SetObjective($"{title}{wave} · 剩余敌人 {Remaining}");
        }

        void Clear()
        {
            phase = Phase.Cleared;
            active.Remove(this);
            foreach (var p in pending) p.warning.FadeOut();
            pending.Clear();
            if (roadside) GameUI.Toast($"{title} · 肃清", new Color(1f, 0.85f, 0.55f), 2f);
            else GameUI.Banner("区域肃清", seconds: 2.5f);
            GameAudio.Play("stage_clear");
            GameUI.SetObjective("");
            Cleared?.Invoke(this);
            AnySiteCleared?.Invoke(this);
            GameEvents.RaiseEncounterCleared(this);
        }

        void Unstick(Transform player)
        {
            lastProgress = Time.time;
            foreach (var a in alive)
            {
                if (!a) continue;
                var p = new Pending { id = a.enemyId, def = EnemyRoster.Get(a.enemyId), elite = a.elite, role = StationRole.Assault, blockedSince = Time.time - 7f };
                var q = QueryFor(p, player.position, player.forward);
                if (!SpawnStations.Pick(q, out var st)) continue;
                var agent = a.GetComponent<NavMeshAgent>();
                if (agent && agent.isOnNavMesh) agent.Warp(st.point);
            }
        }

        // ───────────── 测试 / 调试 ─────────────

        /// <summary>
        /// 按当前站位规则替一只敌人选点（不生成、不记录、不占用站位）：测试与调试面板用。
        /// role = Auto 时取定义的角色；player = 假想的玩家位置
        /// </summary>
        public bool PreviewStation(string enemyId, bool elite, StationRole role, int lane, Vector3 player, out SpawnStations.Station station)
        {
            var def = EnemyRoster.Get(enemyId);
            var spec0 = run ?? CurrentSpec();
            var q = new SpawnStations.Query
            {
                def = def, elite = elite, role = SpawnStations.Resolve(role, def), lane = lane,
                player = player, playerForward = Flat3(transform.position - player), center = transform.position, arenaRadius = arenaRadius,
                minDist = spec0.minPlayerDistance, maxDist = spec0.maxPlayerDistance, anchors = anchors, now = Time.time,
            };
            return SpawnStations.Pick(q, out station);
        }

        /// <summary>正在预警（已选好点、还没出生）的敌人：id 与出生点。返回个数</summary>
        public int PendingWarnings(List<(string id, Vector3 pos)> into)
        {
            into?.Clear();
            int n = 0;
            foreach (var p in pending)
            {
                if (!p.warned) continue;
                n++;
                into?.Add((p.id, p.pos));
            }
            return n;
        }

        /// <summary>还没出生的（排队 + 预警中）</summary>
        public int PendingCount => pending.Count;

        /// <summary>调试：排队里第一只选不到点的原因（每个候选站位一句）；没有在排队的返回空串</summary>
        public string ExplainStall(Vector3 player, string id = null)
        {
            foreach (var p in pending)
            {
                if (p.warned || (id != null && p.id != id)) continue;
                var q = QueryFor(p, player, Vector3.forward);
                var want = SpawnStations.ModeFor(anchors, p.mode, out bool any);
                var parts = new List<string>();
                if (anchors != null)
                    foreach (var t in anchors)
                    {
                        if (!t || !SpawnModes.Accepts(SpawnAnchor.ModeOf(t), want, any)) continue;
                        var (_, _, elevated, _) = SpawnAnchor.Read(t);
                        if (elevated && q.GroundOnly) continue;
                        parts.Add($"{t.name}：{SpawnStations.Explain(q, t.position, elevated) ?? "可以"}");
                    }
                return $"{p.id}（{SpawnModes.Label(p.mode)} → 用{SpawnModes.Label(want)}站位）：{string.Join("；", parts)}";
            }
            return "";
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
        static Vector3 Flat3(Vector3 v) => new(v.x, 0, v.z);

        void OnDrawGizmosSelected()
        {
            var c = transform.position;
            Gizmos.color = new Color(1, 0.5f, 0.2f, 0.6f);
            Gizmos.DrawWireSphere(c, triggerRadius);
            Gizmos.color = new Color(1, 0.8f, 0.2f, 0.5f);
            Gizmos.DrawWireSphere(c, Mathf.Max(1f, triggerRadius - entryDepth));
            Gizmos.color = new Color(1, 0.2f, 0.2f, 0.3f);
            Gizmos.DrawWireSphere(c, arenaRadius);
            if (anchors == null) return;
            foreach (var a in anchors)
            {
                if (!a) continue;
                Gizmos.color = SpawnStations.RoleColor(SpawnAnchor.Read(a).role);
                Gizmos.DrawLine(c + Vector3.up, a.position + Vector3.up);
            }
        }
    }
}
