using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战斗导演（docs/level-design/run-variety.md §3，参考《雨中冒险 2》的 Combat Director；用户 2026-11-08：「射得爽是指武器牛逼，怪物少了满足不了爽感」）：
    /// 正式的局（<see cref="Live"/>）在开放大图里，据点之间也持续有怪——
    ///   · 游荡怪群：进关 <see cref="Warmup"/> 秒后开始，每隔一段时间刷一群——只从关卡摆好的怪物入场点（<see cref="MonsterEntry"/>）进场：
    ///     挑离玩家 22–75 m、走得到、优先玩家看不到的入场点，按入场方式播预告（现身法阵 / 跃下 / 增援门 / 熔岩爬出 / 余烬起身 / 飞临）；
    ///     还没摆入场点的老图退回到玩家视野外 24–42 m 的随机导航网格点（地面先亮 0.8 s 出生圈），关卡验收里有提醒；
    ///     间隔随这一关待的时间缩短（22 s → 10 s）、群越来越大（3 → 7 只）、精英概率越来越高（5% → 25%）——拖得越久越热闹；
    ///     怪物表取这张图各据点编制里出现过的敌人（题材、模型都对得上，不用另配表），按出现次数加权；熔岩里游的、首领不刷；
    ///     重型单位（耐久 ≥ 表中位数 2.5 倍）一群最多一只。刷出来的怪直接锁定玩家（敌人 AI 本来就全图追玩家）。
    ///   · 场上游荡怪最多 <see cref="MaxAlive"/> 只；据点交战中、玩家在安全区（补给营）附近、关卡目标完成之后、玩家阵亡时暂停。
    ///   · 据点加量（<see cref="Densify"/>）：据点开打时普通单位（非精英、条目 ≥ 2 只）× <see cref="SiteDensity"/>，精英和单只重型不变。
    ///   · 经济（docs/balance.md 第十二节）：据点加量后灵石 / 魂晶总量不变（每只按比例摊薄，<see cref="RewardScale"/>）；
    ///     游荡怪照常掉，但每关游荡怪的灵石 / 魂晶有上限（<see cref="EconomyConfig.RoamingCoinCap"/> / <see cref="EconomyConfig.RoamingEssencePerStage"/>）。
    /// 只在首领关以外的开放图里跑。调试局（直接打开场景 / 冒烟测试）缺省不跑，免得打乱按固定编制写的测试；<see cref="Force"/> 或调试命令可以打开。
    /// </summary>
    [GameSystem(160)]
    public sealed class CombatDirector : MonoBehaviour
    {
        /// <summary>据点普通单位的倍率</summary>
        public const float SiteDensity = 1.5f;
        /// <summary>场上游荡怪上限</summary>
        public const int MaxAlive = 12;
        /// <summary>进关后多久开始刷（秒）</summary>
        public const float Warmup = 25f;
        const float IntervalStart = 22f, IntervalMin = 10f, IntervalPerMinute = 1.5f;
        const float NearMin = 24f, NearMax = 42f, SafeZoneClear = 30f, WarnTime = 0.8f, EntryMin = 22f, EntryMax = 75f;
        static readonly Color WarnColor = new(1f, 0.29f, 0.23f), WarnElite = new(1f, 0.76f, 0.2f);

        /// <summary>强制打开（true）/ 关掉（false）；null = 按局判断（正式的局开，调试局关）</summary>
        public static bool? Force;

        public static CombatDirector Instance { get; private set; }

        /// <summary>这一关刷过的群数 / 只数（测试、调试面板用）</summary>
        public int Packs { get; private set; }
        public int Spawned { get; private set; }
        /// <summary>场上活着的游荡怪</summary>
        public int Alive
        {
            get
            {
                alive.RemoveAll(a => !a || a.Health == null || a.Health.Dead);
                return alive.Count;
            }
        }

        readonly List<EnemyAI> alive = new();
        readonly List<(EnemyDef def, float weight)> roster = new();
        float medianBulk = 1f;
        Scene scene;
        float stageStart, nextPack;
        bool pending;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Force = null;
            Instance = null;
            roamingCoins = roamingEssence = 0;
        }

        void Awake() => Instance = this;

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>这一局要不要加怪：<see cref="Force"/> 优先；否则正式的局（不是调试局）才加</summary>
        public static bool Live
        {
            get
            {
                if (Force.HasValue) return Force.Value;
                var run = RunState.Current;
                return run != null && !run.dev;
            }
        }

        /// <summary>
        /// 据点开打时按 <see cref="SiteDensity"/> 给普通单位加量（<see cref="EncounterSite"/> 克隆编制后调；不是 <see cref="Live"/> 的局原样返回）。
        /// 返回这个据点每只怪的奖励倍率 = 原只数 ÷ 加量后只数：据点的灵石 / 魂晶总量不变，平摊到更多的怪上（docs/balance.md 第十二节）；没加量返回 1
        /// </summary>
        public static float Densify(EncounterSpec spec)
        {
            if (spec?.waves == null || !Live) return 1f;
            int before = 0, after = 0;
            foreach (var w in spec.waves)
                if (w?.entries != null)
                    foreach (var e in w.entries)
                    {
                        if (e == null || e.count <= 0) continue;
                        before += e.count;
                        if (!e.elite && e.count >= 2) e.count = Mathf.CeilToInt(e.count * SiteDensity);
                        after += e.count;
                    }
            return after > before && before > 0 ? (float)before / after : 1f;
        }

        // ───────────── 游荡怪的奖励上限（docs/balance.md 第十二节）─────────────

        static int roamingCoins, roamingEssence;

        /// <summary>这一关游荡怪已经给出去的灵石 / 魂晶</summary>
        public static int RoamingCoinsGiven => roamingCoins;
        public static int RoamingEssenceGiven => roamingEssence;

        /// <summary>新的一关：游荡怪奖励额度清零（进关时自动调；测试手动调）</summary>
        public static void ResetRoamingBudget() => roamingCoins = roamingEssence = 0;

        /// <summary>游荡怪想掉 want 灵石：这一关游荡怪的灵石额度（<see cref="EconomyConfig.RoamingCoinCap"/>）里还剩多少就给多少</summary>
        public static int ClaimRoamingCoins(int want)
        {
            int give = Mathf.Clamp(EconomyConfig.RoamingCoinCap(EconomyConfig.Chapter) - roamingCoins, 0, Mathf.Max(0, want));
            roamingCoins += give;
            return give;
        }

        /// <summary>游荡怪想给 want 魂晶：这一关游荡怪的魂晶额度（<see cref="EconomyConfig.RoamingEssencePerStage"/>）里还剩多少就给多少</summary>
        public static int ClaimRoamingEssence(int want)
        {
            int give = Mathf.Clamp(EconomyConfig.RoamingEssencePerStage - roamingEssence, 0, Mathf.Max(0, want));
            roamingEssence += give;
            return give;
        }

        void Update()
        {
            var flow = SceneFlow.Instance;
            var session = GameSession.Instance;
            if (!flow || flow.Busy || flow.Player == null || !flow.Player.root || !session) return;
            var stage = session.Stage;
            if (!flow.CurrentScene.IsValid()) return;
            if (flow.CurrentScene != scene) Arrive(flow.CurrentScene);
            if (!Live || stage == null || stage.IsBoss || roster.Count == 0 || pending) return;
            var vitals = PlayerVitals.Instance;
            if (!vitals || vitals.Dead || session.Completed) return;
            var objective = LevelObjective.For(scene);
            if (objective && objective.Complete) return;
            float now = Time.time;
            // 据点交战中、安全区附近：不刷，计时顺延（不攒着一起刷）
            var ppos = flow.Player.root.transform.position;
            if (EncounterSite.ActiveSites.Count > 0 || NearSafeZone(ppos, SafeZoneClear))
            {
                nextPack = Mathf.Max(nextPack, now + 4f);
                return;
            }
            if (now < nextPack) return;
            float minutes = (now - stageStart) / 60f;
            nextPack = now + Mathf.Max(IntervalMin, IntervalStart - IntervalPerMinute * minutes);
            if (Alive >= MaxAlive) return;
            int size = Mathf.Clamp(3 + Mathf.FloorToInt(minutes / 1.5f), 3, 7);
            size = Mathf.Min(size, MaxAlive - Alive);
            if (size <= 0) return;
            float eliteChance = Mathf.Clamp(0.05f + 0.025f * minutes, 0.05f, 0.25f);
            if (TryPlace(flow, ppos, out var anchor, out var entry)) StartCoroutine(SpawnPack(anchor, entry, size, eliteChance));
        }

        /// <summary>这张图的游荡怪物表（敌人 id → 权重）</summary>
        public IEnumerable<(string id, float weight)> Roster
        {
            get
            {
                foreach (var (def, w) in roster) yield return (def.id, w);
            }
        }

        /// <summary>调试 / 测试：不管计时立刻刷一群（size 只）；找不到点、正在刷、没有怪物表时返回 false</summary>
        public bool SpawnNow(int size = 4, float eliteChance = 0f)
        {
            var flow = SceneFlow.Instance;
            if (!flow || flow.Busy || flow.Player == null || !flow.Player.root || pending) return false;
            if (flow.CurrentScene != scene) Arrive(flow.CurrentScene);
            if (roster.Count == 0) return false;
            if (!TryPlace(flow, flow.Player.root.transform.position, out var anchor, out var entry)) return false;
            StartCoroutine(SpawnPack(anchor, entry, Mathf.Clamp(size, 1, MaxAlive), eliteChance));
            return true;
        }

        /// <summary>进了新的一关：重新收怪物表、计时从头来</summary>
        void Arrive(Scene s)
        {
            scene = s;
            alive.Clear();
            Packs = Spawned = 0;
            pending = false;
            stageStart = Time.time;
            nextPack = Time.time + Warmup;
            ResetRoamingBudget();
            BuildRoster(s);
        }

        void BuildRoster(Scene s)
        {
            roster.Clear();
            var weights = new Dictionary<string, float>();
            foreach (var root in s.GetRootGameObjects())
                foreach (var site in root.GetComponentsInChildren<EncounterSite>(true))
                {
                    var spec = site.spec;
                    if (spec?.waves == null) continue;
                    foreach (var w in spec.waves)
                        if (w?.entries != null)
                            foreach (var e in w.entries)
                                if (e != null && !string.IsNullOrEmpty(e.enemy))
                                    weights[e.enemy] = (weights.TryGetValue(e.enemy, out var v) ? v : 0) + Mathf.Max(1, e.count);
                }
            var bulks = new List<float>();
            foreach (var kv in weights)
            {
                var def = EnemyRoster.Get(kv.Key);
                if (def == null || def.rank == Rank.Boss) continue;
                if (def.ai != null && typeof(ILavaDweller).IsAssignableFrom(def.ai)) continue;
                roster.Add((def, kv.Value));
                bulks.Add(Bulk(def));
            }
            if (bulks.Count > 0)
            {
                bulks.Sort();
                medianBulk = Mathf.Max(1f, bulks[bulks.Count / 2]);
            }
        }

        static float Bulk(EnemyDef d) => Mathf.Max(1f, d.hp + d.armor + d.shield) * (d.charger ? 1.5f : 1f);

        bool Heavy(EnemyDef d) => Bulk(d) >= medianBulk * 2.5f;

        static bool NearSafeZone(Vector3 p, float margin)
        {
            foreach (var z in SafeZone.All)
                if (z && Flat(z.Center, p) < z.radius + margin) return true;
            return false;
        }

        static float Flat(Vector3 a, Vector3 b)
        {
            a.y = b.y = 0;
            return Vector3.Distance(a, b);
        }

        /// <summary>这一关场上的入场点</summary>
        public int Entries
        {
            get
            {
                int n = 0;
                foreach (var e in MonsterEntry.All)
                    if (e && e.gameObject.scene == scene) n++;
                return n;
            }
        }

        /// <summary>
        /// 挑一个进场点：关卡摆了入场点就只在入场点里挑（离玩家 22–75 m、走得到、不在安全区附近，玩家看不到的权重 × 3、近的优先）；
        /// 一个入场点都没摆的老图退回到玩家视野外 24–42 m 的随机导航网格点
        /// </summary>
        bool TryPlace(SceneFlow flow, Vector3 ppos, out Vector3 anchor, out MonsterEntry entry)
        {
            entry = null;
            anchor = default;
            if (Entries > 0) return TryEntry(flow, ppos, out anchor, out entry);
            return TryRandom(flow, ppos, out anchor);
        }

        bool TryEntry(SceneFlow flow, Vector3 ppos, out Vector3 anchor, out MonsterEntry entry)
        {
            anchor = default;
            entry = null;
            var cam = flow.Player.cam;
            var eye = cam ? cam.transform.position : ppos + Vector3.up * 1.62f;
            var filter = LavaField.WalkerFilter();
            var path = new NavMeshPath();
            var picks = new List<(MonsterEntry e, Vector3 at, float w)>();
            float total = 0;
            foreach (var e in MonsterEntry.All)
            {
                if (!e || e.gameObject.scene != scene) continue;
                var p = e.transform.position;
                float d = Flat(p, ppos);
                if (d < EntryMin || d > EntryMax || NearSafeZone(p, 6f)) continue;
                if (!NavMesh.SamplePosition(p, out var hit, 3f, filter)) continue;
                if (!e.flyersOnly && (!NavMesh.CalculatePath(hit.position, ppos, filter, path) || path.status != NavMeshPathStatus.PathComplete)) continue;
                bool hidden = Combat.Blocked(eye, hit.position + Vector3.up * 1.2f, null);
                float w = (hidden ? 3f : 1f) * (1.4f - (d - EntryMin) / (EntryMax - EntryMin));
                picks.Add((e, hit.position, w));
                total += w;
            }
            if (picks.Count == 0) return false;
            float r = UnityEngine.Random.value * total;
            foreach (var (e, at, w) in picks)
            {
                r -= w;
                if (r > 0) continue;
                entry = e;
                anchor = at;
                return true;
            }
            (entry, anchor, _) = picks[picks.Count - 1];
            return true;
        }

        /// <summary>老图兜底：玩家视野外（优先背后 / 侧面）24–42 m、导航网格上、走得到、离安全区够远的一个点</summary>
        bool TryRandom(SceneFlow flow, Vector3 ppos, out Vector3 anchor)
        {
            var cam = flow.Player.cam;
            var fwd = cam ? cam.transform.forward : flow.Player.root.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var filter = LavaField.WalkerFilter();
            var path = new NavMeshPath();
            for (int i = 0; i < 14; i++)
            {
                float a = UnityEngine.Random.value * Mathf.PI * 2f;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                // 前 10 次只要视野外的（和视线方向夹角 > 70°），实在找不到再放宽
                if (i < 10 && Vector3.Dot(dir, fwd) > 0.34f) continue;
                var p = ppos + dir * UnityEngine.Random.Range(NearMin, NearMax);
                if (!NavMesh.SamplePosition(p, out var hit, 6f, filter)) continue;
                if (Flat(hit.position, ppos) < NearMin - 4f || NearSafeZone(hit.position, SafeZoneClear)) continue;
                if (Mathf.Abs(hit.position.y - ppos.y) > 14f) continue;
                if (!NavMesh.CalculatePath(hit.position, ppos, filter, path) || path.status != NavMeshPathStatus.PathComplete) continue;
                anchor = hit.position;
                return true;
            }
            anchor = default;
            return false;
        }

        IEnumerator SpawnPack(Vector3 anchor, MonsterEntry entry, int size, float eliteChance)
        {
            pending = true;
            var filter = LavaField.WalkerFilter();
            var mode = entry ? entry.mode : SpawnMode.Appear;
            if (mode == SpawnMode.Ambush) mode = SpawnMode.Appear; // 入场点不做埋伏（埋伏是驻守点的事）
            bool flyers = entry && entry.flyersOnly;
            float spread = entry ? Mathf.Max(1f, entry.spread) : 4f;
            var from = entry && entry.from ? entry.from.position : anchor;
            var picks = new List<(EnemyDef def, Vector3 pos, bool elite)>();
            bool heavy = false, elite = false;
            for (int i = 0; i < size; i++)
            {
                var def = PickDef(ref heavy, flyers);
                if (def == null) break;
                var p = anchor + new Vector3(UnityEngine.Random.Range(-spread, spread), 0, UnityEngine.Random.Range(-spread, spread));
                if (!NavMesh.SamplePosition(p, out var hit, 3f, filter)) hit.position = anchor;
                bool e = !elite && UnityEngine.Random.value < eliteChance;
                elite |= e;
                picks.Add((def, hit.position, e));
                // 落点都给出生圈（不伤人，原色）：跃下 / 飞临的人先看见落点
                Telegraph.Circle(hit.position, Mathf.Max(1.1f, def.radius + 0.3f), CueTime(mode), e ? WarnElite : WarnColor, TelegraphTone.Own);
            }
            // 入场方式的声光预告
            var face = entry ? entry.Facing : Vector3.forward;
            GameObject pile = null;
            switch (mode)
            {
                case SpawnMode.Gate:
                    SpawnCues.GateGlow(from, 4f, face, CueTime(mode));
                    break;
                case SpawnMode.LavaCrawl:
                    SpawnCues.LavaBubble(anchor, spread + 0.5f, CueTime(mode));
                    break;
                case SpawnMode.Ember:
                    pile = SpawnCues.EmberPile(anchor, CueTime(mode));
                    break;
                case SpawnMode.FlyIn:
                    SpawnCues.FlyCry(from);
                    break;
            }
            yield return new WaitForSeconds(CueTime(mode));
            if (pile) Destroy(pile);
            var flow = SceneFlow.Instance;
            if (!flow || flow.Busy || flow.CurrentScene != scene || flow.Player == null || !flow.Player.root)
            {
                pending = false;
                yield break;
            }
            var ppos = flow.Player.root.transform.position;
            Transform parent = null;
            foreach (var root in scene.GetRootGameObjects())
            {
                parent = root.transform;
                break;
            }
            foreach (var (def, pos, e) in picks)
            {
                var look = ppos - pos;
                look.y = 0;
                var ai = EnemyRoster.Spawn(def.id, pos, Quaternion.LookRotation(look.sqrMagnitude > 0.01f ? look : Vector3.forward), 0f, e,
                    new SpawnOptions { parent = parent });
                if (!ai) continue;
                Enter(ai, mode, from, pos);
                RewardScale.Apply(ai, 1f, 1f, roaming: true);
                alive.Add(ai);
                Spawned++;
            }
            Packs++;
            pending = false;
        }

        /// <summary>入场方式的预告时长（同据点：现身 0.8 s、余烬 / 熔岩 / 增援门按 SpawnCues）</summary>
        static float CueTime(SpawnMode m) => m switch
        {
            SpawnMode.Ember => SpawnCues.EmberTime,
            SpawnMode.LavaCrawl => SpawnCues.LavaTime,
            SpawnMode.Gate => SpawnCues.GateTime,
            SpawnMode.FlyIn => SpawnCues.FlyTime,
            _ => WarnTime,
        };

        /// <summary>入场动作（同据点的出场：跃下从起跳点跳到落点、飞临从入场点飞进来、熔岩爬出上岸、余烬起身冒火星）</summary>
        static void Enter(EnemyAI ai, SpawnMode mode, Vector3 from, Vector3 to)
        {
            if (mode == SpawnMode.Appear) return;
            if (ai.TryGetComponent(out SpawnMaterialize sm)) sm.enabled = false;
            switch (mode)
            {
                case SpawnMode.Drop:
                    SpawnEntrance.Begin(ai, SpawnEntrance.Kind.Jump, from, to);
                    break;
                case SpawnMode.FlyIn:
                    SpawnEntrance.Begin(ai, SpawnEntrance.Kind.Fly, from, to + Vector3.up * 2f);
                    break;
                case SpawnMode.LavaCrawl:
                    SpawnCues.LavaSplash(to);
                    break;
                case SpawnMode.Ember:
                    SpawnCues.EmberRise(to);
                    break;
            }
        }

        EnemyDef PickDef(ref bool heavyTaken, bool flyersOnly = false)
        {
            bool taken = heavyTaken;
            bool Skip(EnemyDef d) => (taken && Heavy(d)) || (flyersOnly && !d.flying);
            float total = 0;
            foreach (var (def, w) in roster)
                if (!Skip(def)) total += w;
            if (total <= 0) return null;
            float r = UnityEngine.Random.value * total;
            foreach (var (def, w) in roster)
            {
                if (Skip(def)) continue;
                r -= w;
                if (r <= 0)
                {
                    if (Heavy(def)) heavyTaken = true;
                    return def;
                }
            }
            foreach (var (def, _) in roster)
                if (!Skip(def)) return def;
            return null;
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>调试：游荡刷怪 + 据点加量开关（调试局缺省关；按一次开、再按回到按局判断）</summary>
    [Defs]
    public sealed class CombatDirectorCommand : DevCommand
    {
        public override string Id => "combat_director";
        public override string Label => "游荡刷怪开关";

        public override void Execute()
        {
            CombatDirector.Force = CombatDirector.Force == true ? null : true;
            DevCommands.Say(CombatDirector.Force == true ? "游荡刷怪：开（据点加量下一个据点起生效）" : $"游荡刷怪：按局判断（现在{(CombatDirector.Live ? "开" : "关")}）");
        }
    }
#endif
}
