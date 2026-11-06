using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 3-4 祝融炉心 v2 冒烟（bridge.sh playtest map-3-4；场景 L3_4_Zhurong，docs/level-design/maps/3-4.md、ch3-v2.md 7.4「①② → 首领解锁 → 进殿开战」）：
    ///   1. 开局：SceneFlow 认领的关卡是 3-4、局难度 = RunPlan；目标图（必清 2：① 铜人神道、② 熔流闸口）、路遇 1（不计目标）、熔岩洞藏宝 1、补给营 1、
    ///      场景里没有出口；首领关流程停用（FoundryLordGate 没解锁、BossEncounter 关着）；没有空气墙；出生点看得见炉心殿南门（熔铁闸门门框）；
    ///      出生点到 ①、②、补给营、炉心殿入场点的 NavMesh 路径都完整。提前踏进炉心殿：只提示「先肃清神道」，不开打。
    ///   2. 机器人沿主线真走（角色控制器沿 NavMesh 拐点走）：路上被路遇缠上就先打；挑最近的必清场地走过去，等它开战，瞄最近的敌人打（四成打弱点），
    ///      被挡住换位，隔 4 s 放技能；只剩潜在闸渠里的火鼍就退到离熔岩最远处引它上岸。玩家临时 +5000 生命、伤害 ×3。每处 150 s 内肃清，场地宝箱要出现。
    ///      记：各场地的精英（应 2 只：① 铁牛·狂暴、② 傩巫·坚盾）、火鼍出场、熔岩击杀。
    ///   3. ①② 肃清 → 目标完成 → FoundryLordGate 解锁、BossEncounter 启用。
    ///   4. 熔岩洞藏宝：发现 → 按 F → 宝箱（秘卷）。补给营：走进安全区。
    ///   5. 首领：沿桥走进门楼 → 熔铁闸封门 → 火麒麟登场（冒烟里直接打死，招式由 boss-qilin 验）→ 结算：去向按 RunPlan（最后一关 = 胜利链）、熔铁闸落下、不落清关宝箱。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map34Suite : PlaytestSuite
    {
        /// <summary>只走人形代理的干地（3-4 有火鼍的 LavaSwimmer 网格、闸渠 / 熔池是 Lava 区）</summary>
        static NavMeshQueryFilter Dry => LavaField.WalkerFilter(LavaField.DryAreaMask);

        public override string Id => "map-3-4";
        /// <summary>3-4 祝融炉心（与编辑器里 Level_3_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 150f, TuoExtra = 60f, LureAfter = 8f, ClearAllTimeout = 900f, BotSpeed = 11f;
        /// <summary>炉心殿南门的门框（熔铁闸门门框；北神龛口的门阙是另一件）</summary>
        const string GateFrameId = "SM_Tripo_InfernoMoltenGateFrame";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        LavaSluice sluice;
        List<LavaGeyser> geysers = new();
        int partialPaths, skillCasts, stalls, lures, edgeSkips;
        float walked;

        protected override IEnumerator Steps()
        {
            // ── 1. 开局 ──
            float r0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - r0 < ReadyTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSeconds(0.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            weapons = FindAnyObjectByType<WeaponController>();
            interactor = FindAnyObjectByType<Interactor>();
            skills = FindAnyObjectByType<HeroSkills>();
            if (!motor || !vitals || !weapons || !interactor)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 3-4？先 bridge.sh level 3-4）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.Aim;
            cam = weapons.eye;
            if (skills) skills.Cast += _ => skillCasts++;

            var flow = SceneFlow.Instance;
            var stage = flow ? flow.Current : null;
            var want = RunPlan.Get("3-4");
            var run = RunState.Current;
            if (run != null)
                foreach (var key in run.flags.Keys.Where(k => k.StartsWith("boss_cleared:")).ToList()) run.flags.Remove(key);
            bool final = want != null && RunPlan.IsFinal(want);
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"首领关 {want?.IsBoss}，补给营 {want?.supplyCamp}，最后一关 {final}");
            if (want == null) Fail("RunPlan 里没有 3-4");
            else if (stage == null || stage.code != "3-4") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 3-4）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 3-4 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var sites = FindObjectsByType<EncounterSite>();
            var roadside = sites.FirstOrDefault(s => s.roadside);
            var caches = FindObjectsByType<CachePOI>();
            var camp = FindAnyObjectByType<SupplyCamp>();
            var lordGate = FindAnyObjectByType<FoundryLordGate>();
            var enc = lordGate ? lordGate.encounter : FindObjectsByType<BossEncounter>(FindObjectsInactive.Include).FirstOrDefault(e => e && e.bossId == QilinDef.Id);
            if (enc) enc.ResetForTests();
            var portals = FindObjectsByType<ExitPortal>();
            sluice = FindAnyObjectByType<LavaSluice>();
            if (sluice) sluice.ResetForTests();
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}（{(objective ? string.Join("、", objective.required.Where(s => s).Select(s => s.title)) : "")}），" +
                 $"路遇 {sites.Count(s => s.roadside)}，场地 {sites.Length}，藏宝 {caches.Length}，补给营 {(camp ? camp.label : "无")}，场景出口 {portals.Length}，" +
                 $"首领关 {(enc ? $"{enc.bossId}（{(enc.enabled ? "开着" : "关着")}）" : "无")}，熔岩 {LavaVolume.Live.Count} 片");
            if (!objective || objective.RequiredTotal != 2) Fail("目标图的必清场地应为 2 个（① 铜人神道、② 熔流闸口）");
            if (!roadside) Fail("没有路遇（神道上段鸦群）");
            else if (!roadside.optional || objective && objective.required.Contains(roadside)) Fail("路遇算进了关卡目标");
            if (caches.Length != 1) Fail($"藏宝点 {caches.Length} 处（应为 1：熔岩洞）");
            if (!camp) Fail("没有补给营");
            if (portals.Length != 0) Fail($"场景里有 {portals.Length} 个出口（3-4 是首领关）");
            geysers = FindObjectsByType<LavaGeyser>().ToList();
            Line($"间歇熔泉 {geysers.Count} 口（只在「{(geysers.Count > 0 && geysers[0].activeSite ? geysers[0].activeSite.title : "?")}」交战时喷）");
            if (geysers.Count != 4) Fail($"② 的间歇熔泉 {geysers.Count} 口（应为 4）");
            if (!sluice) Fail("② 没有熔流闸（LavaSluice）");
            else Line($"熔流闸「{sluice.title}」：{sluice.trigger}，{sluice.Phase}，熔流道 {sluice.Length:F0} m");
            if (!lordGate || !enc) Fail("没有首领门槛（FoundryLordGate / BossEncounter）");
            else
            {
                if (enc.enabled || lordGate.Unlocked) Fail("首领关流程开局就开着（应等 ①② 肃清）");
                if (lordGate.clearChest) Fail("3-4 的首领门槛配成了要落清关宝箱");
            }
            NoAirWall();

            // 地标：出生点看得见炉心殿南门
            var gateway = FindNamed(GateFrameId, "");
            if (!gateway) Fail("场景里没有炉心殿南门（熔铁闸门门框）");
            else
            {
                var top = TopOf(gateway, 0.75f);
                bool seen = Visible(eye.position, top, 6f, GateFrameId);
                string blocker = !seen && Physics.Linecast(eye.position, top, out var bh, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                    ? $"，挡住的是 {bh.collider.name} @ {bh.point}" : "";
                Line($"出生点 → 炉心殿南门（{Vector3.Distance(eye.position, top):F0} m）：{(seen ? "看得见" : "被挡住")}{blocker}");
                if (!seen) Fail("出生点看不到炉心殿南门（终点地标）");
                Aim(motor, eye, top);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map34_spawn");
            }

            // 主线可走：出生点 → 路遇、①、②、藏宝、补给营、炉心殿入场点
            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (roadside) goals.Add((roadside.title, roadside.transform.position));
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            goals.AddRange(caches.Select(c => (c.title, c.transform.position)));
            if (camp) goals.Add((camp.label, CampApproach(camp)));
            if (enc && enc.arena) goals.Add(("炉心殿入场点", enc.arena.PlayerEntryPoint));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // 提前踏进炉心殿：只提示，不开打
            if (lordGate && enc && enc.arena)
            {
                int hints0 = lordGate.LockedHints;
                Place(enc.arena.PlayerEntryPoint + (enc.arena.Center - enc.arena.PlayerEntryPoint).normalized * 6f);
                yield return new WaitForSeconds(0.8f);
                Line($"提前踏进炉心殿：提示 +{lordGate.LockedHints - hints0}，首领关 {enc.State}（{(enc.enabled ? "开着" : "关着")}）");
                if (lordGate.LockedHints <= hints0) Fail("提前踏进炉心殿没有提示「先肃清神道」");
                if (enc.enabled || enc.State != BossEncounter.Phase.Waiting) Fail("①② 没肃清就能在炉心殿开打");
                Place(start);
                yield return new WaitForSeconds(0.3f);
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map34", Stat.MaxHp, 5000);
            vitals.stats.Add("playtest_map34", Stat.DamagePct, 2f);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            float objectiveAt = -1, bossStartAt = -1;
            if (objective) objective.Completed += _ => objectiveAt = Time.time;
            if (enc) enc.Started += _ => bossStartAt = Time.time;
            try
            {
                var required = objective ? objective.required.Where(s => s).ToList() : sites.Where(s => !s.optional).ToList();
                float t0 = Time.time;
                while (required.Any(s => s.phase != EncounterSite.Phase.Cleared) && Time.time - t0 < ClearAllTimeout)
                {
                    if (EncounterSite.ActiveSites.Count > 0)
                    {
                        yield return Fight(EncounterSite.ActiveSites[0]);
                        continue;
                    }
                    var next = required.Where(s => s.phase == EncounterSite.Phase.Idle && s.autoTrigger && s.RequirementsMet())
                        .OrderBy(s => PathLength(motor.transform.position, s.transform.position)).FirstOrDefault();
                    if (!next)
                    {
                        Fail($"没有能触发的必清场地了（剩 {string.Join("、", required.Where(s => s.phase != EncounterSite.Phase.Cleared).Select(s => $"{s.title}：{s.phase}"))}）");
                        break;
                    }
                    Line($"前往「{next.title}」（路程 {PathLength(motor.transform.position, next.transform.position):F0} m）");
                    yield return Travel(next.transform.position, Mathf.Max(3f, next.triggerRadius - next.entryDepth - 4f), true);
                    if (EncounterSite.ActiveSites.Count > 0) continue;
                    yield return Travel(next.transform.position, 2f, true);
                    float w0 = Time.time;
                    while (next.phase == EncounterSite.Phase.Idle && EncounterSite.ActiveSites.Count == 0 && Time.time - w0 < 3f) yield return null;
                    if (next.phase == EncounterSite.Phase.Idle && EncounterSite.ActiveSites.Count == 0)
                    {
                        Fail($"走到「{next.title}」中心 3 s 后遭遇没有开始");
                        break;
                    }
                }
                foreach (var s in required)
                    if (s.phase != EncounterSite.Phase.Cleared) Fail($"必清场地「{s.title}」没有肃清（{s.phase}，剩 {s.Remaining}）");
                if (roadside) Line($"路遇「{roadside.title}」：{roadside.phase}");
                if (roadside && roadside.phase == EncounterSite.Phase.Idle) Fail("沿主线走过神道上段，路遇没有触发");
                var elites = spawned.Where(r => r.elite).ToList();
                Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}；" +
                     $"出场方式 {string.Join("、", spawned.GroupBy(r => r.anchor ? SpawnAnchor.ModeOf(r.anchor) : SpawnMode.Appear).Select(g => $"{SpawnModes.Label(g.Key)} {g.Count()}"))}");
                if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（① 铁牛·狂暴、② 傩巫·坚盾）");
                if (!elites.Any(r => r.id == "iron_ox")) Fail("① 没有出精英铁牛");
                if (!elites.Any(r => r.id == "nuo")) Fail("② 没有出精英傩巫");
                if (!spawned.Any(r => r.id == "tuo")) Fail("② 没有出火鼍");
                int eruptions = geysers.Sum(g => g ? g.Eruptions : 0);
                Line($"间歇熔泉：喷了 {eruptions} 次");
                if (geysers.Count > 0 && eruptions == 0) Fail("② 交战期间间歇熔泉一次都没喷");
                if (sluice)
                {
                    Line($"熔流闸：放了 {sluice.Fired} 次，烧死 {sluice.Kills} 只（{sluice.Phase}）");
                    if (sluice.Fired == 0) Fail("② 打完熔流闸一次都没放");
                    else if (sluice.Kills == 0) Fail("② 的熔流闸没有烧死敌人");
                }
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }

            // ── 3. 目标完成 → 首领解锁 ──
            if (objective)
            {
                Line($"目标：{(objective.Complete ? "已完成" : "未完成")}（肃清 {objective.RequiredCleared}/{objective.RequiredTotal}）");
                if (!objective.Complete) Fail("必清场地全部肃清后目标没有完成");
            }
            yield return null;
            if (lordGate)
            {
                Line($"首领门槛：{(lordGate.Unlocked ? "已解锁" : "没解锁")}，BossEncounter {(enc && enc.enabled ? "开着" : "关着")}，状态 {(enc ? enc.State.ToString() : "—")}");
                if (!lordGate.Unlocked || !enc || !enc.enabled) Fail("①② 肃清后首领关流程没有解锁");
                if (enc && enc.State != BossEncounter.Phase.Waiting) Fail("首领在玩家进殿之前就开战了");
            }

            // ── 4. 熔岩洞藏宝、补给营 ──
            var cache = caches.FirstOrDefault();
            if (cache) yield return CacheCheck(cache);
            if (camp)
            {
                vitals.Heal(99999);
                // 安全区运行时在导航网格上挖洞（地面敌人进不来）：沿导航走到安全区边上，再走进中心
                var approach = CampApproach(camp);
                Line($"前往补给营（路程 {PathLength(motor.transform.position, approach):F0} m）");
                yield return Travel(approach, 1.5f, false);
                yield return WalkTo(camp.transform.position, camp.transform.position, 1f, false);
                yield return new WaitForSeconds(0.3f);
                bool safe = SafeZone.Contains(motor.transform.position);
                Line($"补给营「{camp.label}」：安全区 {(safe ? "✓" : "✗")}（离中心 {Flat(motor.transform.position - camp.transform.position):F1} m）");
                if (!safe) Fail("走到补给营中心不在安全区里");
                if (enc && enc.State != BossEncounter.Phase.Waiting) Fail("在补给营里首领就开战了（门槛太大？）");
                Aim(motor, eye, enc && enc.arena ? enc.arena.Center + Vector3.up * 2f : camp.transform.position + Vector3.forward * 20f);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map34_camp");
            }

            // ── 5. 首领 ──
            if (enc && enc.enabled && enc.arena) yield return BossCase(enc, lordGate, final);
            else Fail("首领关流程没开，进不了殿");
            if (objectiveAt >= 0 && bossStartAt >= 0)
            {
                Line($"顺序：目标完成 {objectiveAt:F0} s → 首领开战 {bossStartAt:F0} s");
                if (bossStartAt < objectiveAt) Fail("首领比 ①② 肃清先开战");
            }
            vitals.stats.Remove("playtest_map34");

            Line($"合计：走路 {walked:F0} m，武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次，" +
                 $"踩进熔岩 {(LavaField.Instance ? LavaField.Instance.Entries : 0)} 次、敌人烧死 {(LavaField.Instance ? LavaField.Instance.Burned : 0)} 只");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整");
            Line($"走路卡住跳点 {stalls} 次，引火鼍上岸 {lures} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（看上面的位置：坡道 / 门洞 / 桥头？）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>补给营安全区西沿外 1 m 的导航点（安全区在导航网格上挖了洞，中心采不到）</summary>
        static Vector3 CampApproach(SupplyCamp camp)
        {
            var c = camp.transform.position + Vector3.left * (camp.safeRadius + 1.5f);
            return NavMesh.SamplePosition(c, out var hit, 4f, Dry) ? hit.position : c;
        }

        /// <summary>D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环；出生点在软边界里 ≥ 5 m</summary>
        void NoAirWall()
        {
            var zone = BoundaryZone.Active;
            if (!zone)
            {
                Fail("场景里没有软边界（BoundaryZone）");
                return;
            }
            int walls = 0;
            float nearest = float.PositiveInfinity;
            foreach (var c in FindObjectsByType<Collider>())
            {
                if (!c.enabled || c.isTrigger || c.gameObject.layer != Layers.IgnoreRaycast) continue;
                if (c.GetComponentInParent<EnemyAI>()) continue;
                walls++;
                if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
                {
                    var verts = mc.sharedMesh.vertices;
                    for (int i = 0; i < verts.Length; i += 2) nearest = Mathf.Min(nearest, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                }
                else nearest = Mathf.Min(nearest, BoundaryZone.Distance(c.bounds.center));
            }
            float here = BoundaryZone.Distance(motor.transform.position);
            Line($"软边界：Ignore Raycast 实体碰撞体 {walls} 个（最近离等值线 {nearest:F1} m，兜底环应在 +{zone.tuning.failsafe} m），出生点离等值线 {-here:F1} m");
            if (walls == 0) Fail("Ignore Raycast 层上没有兜底环");
            else if (nearest < zone.tuning.failsafe - 3f) Fail($"还有空气墙：离等值线只有 {nearest:F1} m 的 Ignore Raycast 碰撞体");
            if (here > -5f) Fail($"出生点离软边界等值线只有 {-here:F1} m（应在界内 ≥ 5 m）");
        }

        // ───────────── 交战 ─────────────

        IEnumerator Fight(EncounterSite site)
        {
            float limit = SiteTimeout + (HasTuo(site) ? TuoExtra : 0);
            float start = Time.time, flankAt = 0, skillAt = Time.time + 1f, lureAt = 0, lureHold = 0, tuoOnly = 0;
            bool shotMid = false, shotRead = false;
            int kills0 = Runner.kills, lastKills = Runner.kills, pushes = 0;
            float lastKillAt = Time.time, pushAt = 0;
            int burned0 = LavaField.Instance ? LavaField.Instance.Burned : 0;
            float dmg0 = Runner.playerDamage;
            Runner.killsById.Clear();
            Line($"遭遇「{site.title}」开始：{site.Total} 只，{site.WaveCount} 波，升格精英 {site.Promoted}{(site.roadside ? "（路遇）" : "")}");
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - start < limit)
            {
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                var target = NearestEnemy(eye.position);
                if (!target)
                {
                    weapons.testFire = false;
                    if (site.PendingCount > 0 && Flat(motor.transform.position - site.transform.position) > site.arenaRadius)
                        yield return Step(site.transform.position, 6f);
                    yield return null;
                    continue;
                }
                if (Runner.kills != lastKills)
                {
                    lastKills = Runner.kills;
                    lastKillAt = Time.time;
                }
                // 残敌跑出场地（① 的铁牛 / 毕方跑到山门外的神道下段）：不追出场地——追出去会把整群怪一路带下神道到 ② 门口；
                // 守在场地里等它回来（地面敌人追玩家会回来；飞的在场地里找看得见它的位置），看得见就打
                bool outside = Flat(target.transform.position - site.transform.position) > site.arenaRadius + 4f;
                // 僵持（25 s 没有击杀）：沿导航朝最近的场地内残敌走过去一段（同玩家：打不着就走过去打；Step 只走完整路径）
                if (!outside && Time.time - lastKillAt > 25f && Time.time >= pushAt && Flat(target.transform.position - motor.transform.position) > 8f)
                {
                    pushAt = Time.time + 10f;
                    pushes++;
                    weapons.testFire = false;
                    yield return Step(target.transform.position, 12f);
                    continue;
                }
                var tuo = target.GetComponentInParent<TuoAI>();
                bool sunk = tuo && tuo.Submerged;
                tuoOnly = sunk && site.PendingCount == 0 ? tuoOnly + Time.deltaTime : 0;
                if (tuoOnly >= LureAfter && Time.time >= lureAt)
                {
                    lureAt = Time.time + 16f;
                    lureHold = Time.time + 10f;
                    lures++;
                    weapons.testFire = false;
                    yield return Travel(LureSpot(site), 1.5f, false);
                    continue;
                }
                var body = target.GetComponent<EnemyBody>();
                var aim = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy && Random.value < 0.4f ? body.WeakPoint.position : BodyCenter(target);
                Aim(motor, eye, aim);
                // 敌人可读性（docs/art/composition.md 第 6 节）：开火前拍一张交战场地有怪的画面——停火等枪口特效散掉再拍，去色后看怪是不是画面里最跳的
                if (!shotRead && Time.time - start > 1.5f && !Combat.Blocked(eye.position, aim, target.GetComponent<Collider>()))
                {
                    float d = Vector3.Distance(eye.position, aim);
                    if (d > 8f && d < 35f)
                    {
                        shotRead = true;
                        weapons.testFire = false;
                        yield return new WaitForSeconds(0.6f);
                        if (target) Aim(motor, eye, BodyCenter(target));
                        yield return null;
                        Shot(cam, $"map34_read_{Slug(site)}");
                    }
                }
                // 飞行敌人（火口坑上空的飞鸦、栖柱的毕方）：远了朝它脚下的地面走（Step 只走完整的干地路径，坑上空的就不动）；
                // 被挡住先在自己身边 6 m 内换个看得见的位置，换不到再朝它脚下走几步
                bool flyer = target.GetComponentInParent<FlyingEnemyAI>() || target.GetComponentInParent<BifangAI>();
                if (outside)
                {
                    if (flyer && Time.time >= flankAt && Combat.Blocked(eye.position, aim, target.GetComponent<Collider>()))
                    {
                        flankAt = Time.time + 1.5f;
                        if (PerchSightSpot(aim, out var inside, site.transform.position, site.arenaRadius)) Place(inside);
                    }
                    else if (!flyer && Flat(motor.transform.position - site.transform.position) > site.arenaRadius)
                        yield return Step(site.transform.position, 6f);
                }
                else if (Vector3.Distance(eye.position, aim) > 22f && !(sunk && Time.time < lureHold)) yield return Step(target.transform.position, 6f);
                else if (Time.time >= flankAt && Combat.Blocked(eye.position, aim, target.GetComponent<Collider>()))
                {
                    flankAt = Time.time + 1.5f;
                    Vector3 near;
                    bool found = flyer ? NearSightSpot(aim, out near) || PerchSightSpot(aim, out near) : DrySightSpot(target, aim, out near);
                    if (found) Place(near);
                    else if (flyer) yield return Step(target.transform.position, 6f);
                }
                weapons.testFire = weapons.Active != null && (weapons.Active.def.mode != FireMode.Semi || !weapons.testFire);
                if (skills && Time.time >= skillAt)
                {
                    skillAt = Time.time + 4f;
                    if (skills.secondary.charges > 0) skills.testE = true;
                    else if (skills.primary.charges > 0) skills.testQ = true;
                }
                if (!shotMid && Time.time - start > 4f)
                {
                    shotMid = true;
                    Shot(cam, $"map34_combat_{Slug(site)}");
                }
                // ② 北岸熔流道上站了 ≥ 2 只地面敌人（打了 30 s 以后：道上 ≥ 1 只、道边 4 m 内 ≥ 3 只）：上闸楼台拉熔流闸——
                // 同玩家：看见熔流道上有一群怪才拉，不到点硬拉（以前 60 s 到点就拉，S1 增援门的怪那一刻正好不在北岸时熔流冲空；
                // 只有 1 只时拉闸前摇 1 s 它就走开了）。整场都没有成群的怪走上熔流道，才算熔流闸不合格
                float fightT = Time.time - start;
                if (sluice && sluice.CanRelease && Flat(sluice.transform.position - site.transform.position) < site.arenaRadius + 10f &&
                    (CoveredByFlow() >= 2 || (fightT > 30f && CoveredByFlow() >= 1 && CoveredByFlow(4f) >= 3)))
                {
                    weapons.testFire = false;
                    yield return PullSluice();
                    continue;
                }
                yield return null;
            }
            weapons.testFire = false;
            var byId = string.Join("、", Runner.killsById.Select(kv => $"{kv.Key}×{kv.Value}"));
            bool cleared = site.phase == EncounterSite.Phase.Cleared;
            int burned = (LavaField.Instance ? LavaField.Instance.Burned : 0) - burned0;
            Line($"  {(cleared ? "已肃清" : "超时")}：用时 {Time.time - start:F0} s，击杀 {Runner.kills - kills0}（{byId}），熔岩烧死 {burned}，敌人对玩家伤害 {Runner.playerDamage - dmg0:F0}");
            if (!cleared)
            {
                Line($"  机器人在 {motor.transform.position}（导航网格 {(NavMesh.SamplePosition(motor.transform.position, out var mh, 1.5f, Dry) ? "上" : "外")}），僵持时走过去 {pushes} 次");
                var diag = new NavMeshPath();
                foreach (var e in EnemyAI.All)
                    if (e && !e.Dead)
                    {
                        var ag = e.GetComponent<NavMeshAgent>();
                        string reach = "—";
                        if (NavMesh.SamplePosition(e.transform.position, out var eh, 2f, Dry) && NavMesh.SamplePosition(motor.transform.position, out var ph, 3f, Dry))
                        {
                            NavMesh.CalculatePath(eh.position, ph.position, Dry, diag);
                            reach = diag.status.ToString();
                        }
                        Line($"  残敌 {e.enemyId}：状态 {e.State}，位置 {e.transform.position}，离玩家 {Vector3.Distance(e.transform.position, motor.transform.position):F1} m，" +
                             $"导航网格上 {(ag && ag.isOnNavMesh)}，到玩家的路 {reach}{(ag && ag.isOnNavMesh ? $"（代理目标 {ag.destination}，{ag.pathStatus}）" : "")}，在熔岩里 {LavaField.IsLava(e.transform.position)}");
                    }
                Fail($"{limit:F0} s 内没有肃清「{site.title}」（剩 {site.Remaining}）");
                EnemyRegistry.PurgeAll();
                float p0 = Time.time;
                while (site.phase != EncounterSite.Phase.Cleared && Time.time - p0 < 3f) yield return null;
                yield break;
            }
            if (!string.IsNullOrEmpty(site.reward))
            {
                Chest chest = null;
                float c0 = Time.time;
                while (!chest && Time.time - c0 < 3f)
                {
                    foreach (var c in FindObjectsByType<Chest>())
                        if (!c.Opened && c.reward == site.reward && Flat(c.transform.position - (site.transform.position + site.chestOffset)) < 8f) chest = c;
                    yield return null;
                }
                Line($"  场地宝箱（{site.reward}）：{(chest ? $"出现在 {chest.transform.position}" : "没有出现")}");
                if (!chest) Fail($"「{site.title}」肃清后没有出现宝箱（{site.reward}）");
            }
        }

        /// <summary>熔流道上站着的地面敌人只数</summary>
        int CoveredByFlow(float margin = 0)
        {
            int n = 0;
            foreach (var e in EnemyAI.All)
                if (e && !e.Dead && !e.GetComponent<TuoAI>() && sluice.Covers(e.transform.position, margin)) n++;
            return n;
        }

        /// <summary>走到闸楼台的拉杆前，按 F 拉闸；等熔流冲完，记烧死几只</summary>
        IEnumerator PullSluice()
        {
            var focus = sluice.Focus;
            var front = focus + Vector3.left * 1.6f;
            if (NavMesh.SamplePosition(front, out var hit, 2f, Dry)) front = hit.position;
            int covered = CoveredByFlow();
            Place(front);
            yield return null;
            Aim(motor, eye, focus);
            yield return new WaitForSeconds(0.15f);
            var current = interactor.Current;
            if (current as LavaSluice != sluice) Fail($"站在熔流闸拉杆前没有交互提示（当前 {current?.Prompt ?? "无"}）");
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.3f);
            if (sluice.Phase == LavaSluice.State.Ready)
            {
                Fail("按 F 没拉开熔流闸");
                sluice.Release(true);
            }
            Line($"  拉熔流闸：熔流道上 {covered} 只地面敌人 → {sluice.Phase}");
            float t0 = Time.time;
            while (sluice.Phase is LavaSluice.State.Warning or LavaSluice.State.Flowing && Time.time - t0 < sluice.warn + sluice.duration + 3f)
            {
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                yield return null;
            }
            Line($"  熔流冲完：烧死 {sluice.Kills} 只");
            Shot(cam, "map34_sluice");
        }

        static bool HasTuo(EncounterSite site) =>
            site.spec?.waves != null && site.spec.waves.Any(w => w?.entries != null && w.entries.Any(e => e != null && e.enemy == "tuo"));

        /// <summary>场地里离熔岩最远的干地导航点（中心 + 5 / 10 / 15 / 20 m 四圈各 12 个方向；同 Map33Suite）</summary>
        static Vector3 LureSpot(EncounterSite site)
        {
            var c = site.transform.position;
            var best = c;
            float bestD = -1;
            for (int ring = 0; ring <= 4; ring++)
            for (int k = 0; k < 12; k++)
            {
                float a = k * Mathf.PI / 6;
                var p = c + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * (ring * 5f);
                if (!NavMesh.SamplePosition(p, out var hit, 2f, Dry) || LavaField.IsLava(hit.position)) continue;
                float d = LavaField.NearestLava(hit.position, 30f, out var lava, out _) ? Flat(lava - hit.position) : 30f;
                if (d > bestD)
                {
                    bestD = d;
                    best = hit.position;
                }
                if (ring == 0) break;
            }
            return best;
        }

        /// <summary>目标周围 8–12 m、干地导航网格上、离熔岩 ≥ 1.5 m、眼高能直接看到瞄准点的位置</summary>
        static bool DrySightSpot(Damageable target, Vector3 aim, out Vector3 spot)
        {
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(8f, 12f);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, Dry)) continue;
                // 和目标同一层（±3 m）：别站到白盒 / 关楼顶上去
                if (Mathf.Abs(hit.position.y - target.transform.position.y) > 3f) continue;
                if (LavaField.IsLava(hit.position) || LavaField.NearLava(hit.position, 1.5f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        /// <summary>
        /// 栖在高处的飞行敌人（铜人头顶的毕方，离地 10 m）：身边 6 m 找不到看得见的位置时，在它脚下 9–18 m 一圈找干地、眼高看得到它的位置——
        /// 站得太近仰角太陡，铜人自己的身子会挡住头顶（铜人基座台顶不进导航，机器人也站不上去）。给了 within / radius 时只在那个圆里找（不出场地）
        /// </summary>
        static bool PerchSightSpot(Vector3 aim, out Vector3 spot, Vector3? within = null, float radius = 0)
        {
            for (int i = 0; i < 24; i++)
            {
                float a = i * Mathf.PI * 2 / 24 + Random.value * 0.2f;
                var p = aim + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(9f, 18f);
                if (!Physics.Raycast(p, Vector3.down, out var ground, 40f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (!NavMesh.SamplePosition(ground.point, out var hit, 2f, Dry)) continue;
                if (within.HasValue && Flat(hit.position - within.Value) > radius) continue;
                if (LavaField.IsLava(hit.position) || LavaField.NearLava(hit.position, 1.5f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        /// <summary>机器人身边 2–6 m、同一层（±1.5 m）、干地导航网格上、眼高看得到瞄准点的位置（打飞行敌人时换位用）</summary>
        bool NearSightSpot(Vector3 aim, out Vector3 spot)
        {
            var me = motor.transform.position;
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = me + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(2f, 6f);
                if (!NavMesh.SamplePosition(p, out var hit, 2f, Dry)) continue;
                if (Mathf.Abs(hit.position.y - me.y) > 1.5f) continue;
                if (LavaField.IsLava(hit.position) || LavaField.NearLava(hit.position, 1.5f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        // ───────────── 藏宝 ─────────────

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            Line($"前往藏宝「{cache.title}」（路程 {PathLength(motor.transform.position, c):F0} m）");
            yield return Travel(c, 6f, false);
            float t0 = Time.time;
            while (!cache.Discovered && Time.time - t0 < 2f) yield return null;
            if (!cache.Discovered)
            {
                yield return Travel(c, 2.5f, false);
                t0 = Time.time;
                while (!cache.Discovered && Time.time - t0 < 1f) yield return null;
            }
            Line($"藏宝「{cache.title}」：{(cache.Discovered ? "已发现" : "没发现")}（离 {Flat(motor.transform.position - c):F1} m，y = {motor.transform.position.y:F1}）");
            if (!cache.Discovered)
            {
                Fail($"走到藏宝「{cache.title}」旁边还没发现");
                yield break;
            }
            yield return Travel(c, 2.2f, false);
            Aim(motor, eye, cache.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as CachePOI != cache) Fail($"站在藏宝前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.8f);
            Line($"  调查：{(cache.Claimed ? $"宝箱出现（{cache.reward}）" : "没有宝箱")}");
            if (!cache.Claimed || !cache.RewardChest) Fail($"调查藏宝「{cache.title}」后没有出宝箱");
            Shot(cam, "map34_cache");
        }

        // ───────────── 首领 ─────────────

        /// <summary>沿桥走进门楼 → 熔铁闸封门 → 火麒麟登场 → 打死（冒烟只验流程）→ 结算：去向、熔铁闸落下、不落清关宝箱</summary>
        IEnumerator BossCase(BossEncounter enc, FoundryLordGate lordGate, bool final)
        {
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var entry = enc.arena.PlayerEntryPoint;
            var inside = entry + (enc.arena.Center - entry).normalized * (enc.thresholdInset + 4f);
            // 补给营安全区在导航网格上挖了洞：先走出安全区（往桥头），再沿导航进殿
            if (SafeZone.Contains(motor.transform.position))
            {
                var bridgeHead = new Vector3(0, motor.transform.position.y, -48f);
                yield return WalkTo(bridgeHead, bridgeHead, 1f, false);
            }
            Line($"前往炉心殿（路程 {PathLength(motor.transform.position, inside):F0} m）");
            yield return Travel(inside, 1.5f, false);
            float t0 = Time.time;
            while (enc.State == BossEncounter.Phase.Waiting && Time.time - t0 < 3f) yield return null;
            if (enc.State == BossEncounter.Phase.Waiting)
            {
                Fail($"走进炉心殿 3 s 后首领关没有开始（玩家 {motor.transform.position}）");
                enc.Begin();
            }
            Line($"首领关开始：{enc.State}，熔铁闸 {(enc.GatesSealed ? "已升起" : "没升起")}（{enc.gates?.Length ?? 0} 扇）");
            if (enc.gates != null && enc.gates.Length > 0 && !enc.GatesSealed) Fail("开战后熔铁闸没有封门");
            float s0 = Time.time;
            while (!enc.Boss && enc.State != BossEncounter.Phase.Collapsing && Time.time - s0 < enc.warnSeconds + 8f) yield return null;
            var boss = enc.Boss;
            if (!boss)
            {
                Fail($"首领 {enc.bossId} 没有生成，状态 {enc.State}");
                yield break;
            }
            Line($"登场：{boss.Title}（{boss.Subtitle}），{boss.Health.maxHealth:F0} 生命 + {boss.Health.maxShield:F0} 护盾 + {boss.Health.maxArmor:F0} 护甲，模型 {boss.Model?.source} {boss.Model?.prefab}");
            Aim(motor, eye, boss.BodyCenter);
            yield return new WaitForSeconds(0.4f);
            Shot(cam, "map34_boss");
            float k0 = Time.time;
            while (!boss.Dead && Time.time - k0 < 25f)
            {
                if (!boss.Health.untargetable)
                {
                    var info = DamageInfo.Simple(99999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(boss.Health, info);
                }
                if (vitals.Dead) vitals.Revive();
                yield return null;
            }
            if (!boss.Dead) Fail("火麒麟没被打死");
            float st0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - st0 < BossEncounter.SettleDelay + 4f) yield return null;
            yield return new WaitForSeconds(0.6f);
            var want = final ? BossEncounter.Outcome.Victory : BossEncounter.Outcome.NextStage;
            Line($"结算：{enc.State}，去向 {enc.Result}（应为 {want}），首领宝箱「{(enc.RewardChest ? enc.RewardChest.EffectiveReward : "（没有）")}」，" +
                 $"熔铁闸 {(enc.GatesSealed ? "还立着" : "已落下")}，清关宝箱 {(lordGate && lordGate.ClearChest ? "有（不该有）" : "无")}");
            if (enc.State != BossEncounter.Phase.Settled) Fail("火麒麟倒下后没有结算");
            else if (enc.Result != want) Fail($"3-4 打完的去向是 {enc.Result}（RunPlan 要 {want}）");
            if (enc.GatesSealed) Fail("结算后熔铁闸没有落下");
            if (lordGate && lordGate.ClearChest) Fail("3-4 结算后落了清关宝箱（应只有首领宝箱）");
            Shot(cam, "map34_settled");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        IEnumerator Travel(Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete)
            {
                partialPaths++;
                Line($"  ⚠ 从 {motor.transform.position} 到 {goal} 的导航路径不完整");
            }
            if (corners.Count == 0)
            {
                Place(goal);
                yield break;
            }
            for (int i = 1; i < corners.Count; i++)
            {
                if (breakOnCombat && EncounterSite.ActiveSites.Count > 0) yield break;
                if (Flat(motor.transform.position - goal) <= stopAt) yield break;
                yield return WalkTo(corners[i], goal, stopAt, breakOnCombat);
            }
        }

        IEnumerator WalkTo(Vector3 target, Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var cc = motor.GetComponent<CharacterController>();
            float best = Flat(target - motor.transform.position), bestAt = Time.time;
            while (Flat(target - motor.transform.position) > 0.5f)
            {
                if (breakOnCombat && EncounterSite.ActiveSites.Count > 0) yield break;
                if (Flat(motor.transform.position - goal) <= stopAt) yield break;
                var d = target - motor.transform.position;
                d.y = 0;
                var dir = d.normalized;
                motor.SetLook(Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, 0);
                var before = motor.transform.position;
                if (cc && cc.enabled) cc.Move(dir * Mathf.Min(BotSpeed * Time.deltaTime, d.magnitude));
                yield return null;
                walked += Flat(motor.transform.position - before);
                float now = Flat(target - motor.transform.position);
                if (now < best - 0.3f)
                {
                    best = now;
                    bestAt = Time.time;
                }
                else if (Time.time - bestAt > 1.5f)
                {
                    stalls++;
                    Line($"  ⚠ 在 {motor.transform.position} 卡住 1.5 s，跳到 {target}");
                    Place(target);
                    yield return null;
                    yield break;
                }
            }
        }

        /// <summary>
        /// 朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用）。飞行的目标朝它脚下的地面走；路径不完整（目标在熔岩坑上空、白盒顶上）就不动——
        /// 不然导航采样会落到白盒顶上，机器人被放上去下不来
        /// </summary>
        IEnumerator Step(Vector3 goal, float maxStep)
        {
            if (Physics.Raycast(goal + Vector3.up * 0.5f, Vector3.down, out var gh, 40f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) goal = gh.point;
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete)
            {
                yield return null;
                yield break;
            }
            float left = maxStep;
            var p = motor.transform.position;
            for (int i = 1; i < corners.Count && left > 0; i++)
            {
                float d = Vector3.Distance(p, corners[i]);
                if (d <= left)
                {
                    p = corners[i];
                    left -= d;
                }
                else
                {
                    p = Vector3.Lerp(p, corners[i], left / d);
                    left = 0;
                }
            }
            if (NavMesh.SamplePosition(p, out var onNav, 2f, Dry)) p = onNav.position;
            Place(p);
            yield return null;
        }

        static List<Vector3> PathCorners(Vector3 from, Vector3 to, out bool complete)
        {
            complete = false;
            var list = new List<Vector3>();
            if (!NavMesh.SamplePosition(from, out var a, 4f, Dry) || !NavMesh.SamplePosition(to, out var b, 4f, Dry)) return list;
            var path = new NavMeshPath();
            NavMesh.CalculatePath(a.position, b.position, Dry, path);
            complete = path.status == NavMeshPathStatus.PathComplete;
            list.AddRange(path.corners);
            return list;
        }

        static float PathLength(Vector3 from, Vector3 to)
        {
            var c = PathCorners(from, to, out bool complete);
            if (c.Count < 2) return Vector3.Distance(from, to) + 1000f;
            float len = 0;
            for (int i = 0; i + 1 < c.Count; i++) len += Vector3.Distance(c[i], c[i + 1]);
            return complete ? len : len + 1000f;
        }

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面。软边界等值线外 3 m 以内的点不放（机器人不出界，不然画面被白化、敌人也够不着）</summary>
        void Place(Vector3 p)
        {
            if (BoundaryZone.Active && BoundaryZone.Distance(p) > -3f)
            {
                if (++edgeSkips <= 3) Line($"  ⚠ 不放到 {p}：离软边界只有 {-BoundaryZone.Distance(p):F1} m{(edgeSkips == 3 ? "（之后不再逐条记）" : "")}");
                return;
            }
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
        }

        static GameObject FindNamed(string id, string what)
        {
            foreach (var t in FindObjectsByType<Transform>())
                if (t.name.StartsWith(id) && t.name.Contains(what) && t.GetComponentInChildren<Renderer>()) return t.gameObject;
            return null;
        }

        static Vector3 TopOf(GameObject go, float frac)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return go.transform.position;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return new Vector3(b.center.x, Mathf.Lerp(b.min.y, b.max.y, frac), b.center.z);
        }

        static bool Visible(Vector3 from, Vector3 to, float tolerance, string landmark)
        {
            if (!Physics.Linecast(from, to, out var hit, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return true;
            if (Vector3.Distance(hit.point, to) <= tolerance) return true;
            for (var t = hit.collider.transform; t; t = t.parent)
                if (t.name.StartsWith(landmark)) return true;
            return false;
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        static string Slug(EncounterSite s) => s.roadside ? "r" : s.name.Contains("1") ? "1" : s.name.Contains("2") ? "2" : "x";
    }

    /// <summary>
    /// 3-4 单关整局机器人（bridge.sh playtest run-3-4；风险 6「3-4 是第一个带必清场地的首领关」）：用 I2 整局冒烟的 <see cref="RunBot"/> 打一遍 3-4——
    /// 它应先清 ①②（关卡目标），再逛补给营，再进炉心殿打火麒麟，最后胜利结算。查：目标完成在首领开战之前、必清 2/2、首领打完、本关结算。
    /// </summary>
    public sealed class Run34Suite : PlaytestSuite
    {
        public override string Id => "run-3-4";
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";

        protected override IEnumerator Steps()
        {
            float r0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - r0 < 90f)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSeconds(0.5f);
            var flow = SceneFlow.Instance;
            var stage = flow ? flow.Current : null;
            if (stage == null || stage.code != "3-4")
            {
                Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 3-4）");
                yield break;
            }
            var run = RunState.Current;
            if (run != null)
                foreach (var key in run.flags.Keys.Where(k => k.StartsWith("boss_cleared:")).ToList()) run.flags.Remove(key);
            var scene = flow.CurrentScene;
            var objective = LevelObjective.For(scene);
            var enc = FindObjectsByType<BossEncounter>(FindObjectsInactive.Include).FirstOrDefault(e => e && e.gameObject.scene == scene);
            if (enc) enc.ResetForTests();
            float objectiveAt = -1, bossAt = -1, shopAt = -1;
            if (objective) objective.Completed += _ => objectiveAt = Time.time;
            if (enc) enc.Started += _ => bossAt = Time.time;
            GameEvents.CoinsChanged += OnCoins;
            void OnCoins(int delta, int total)
            {
                if (delta < 0 && shopAt < 0) shopAt = Time.time;
            }
            var bot = new RunBot(Runner, Line, Fail, (c, n) => Shot(c, n));
            bot.Install();
            StageRecord rec;
            try
            {
                rec = bot.Begin(stage, 0);
                yield return bot.PlayStage(stage);
            }
            finally
            {
                bot.Uninstall();
                GameEvents.CoinsChanged -= OnCoins;
            }
            Line($"机器人：必清 {rec.sitesCleared}/{rec.sitesRequired}，击杀 {rec.kills}，宝箱 {rec.chests}，买 {rec.bought}，倒下 {rec.downs}，首领 {rec.bossSeconds:F0} 游戏秒（{rec.bossPhases} 阶段），" +
                 $"本关 {rec.gameSeconds:F0} 游戏秒 / {rec.realSeconds:F0} 真实秒，结算 {rec.completed}");
            foreach (var n in rec.notes) Line($"  · {n}");
            Line($"顺序：目标完成 {objectiveAt:F0} s，补给营花钱 {shopAt:F0} s，首领开战 {bossAt:F0} s");
            if (!objective) Fail("3-4 没有关卡目标");
            if (rec.sitesRequired != 2 || rec.sitesCleared != 2) Fail($"机器人只肃清了 {rec.sitesCleared}/{rec.sitesRequired} 处必清场地");
            if (objectiveAt < 0) Fail("关卡目标没有完成");
            if (bossAt < 0) Fail("首领没有开战");
            else if (objectiveAt >= 0 && bossAt < objectiveAt) Fail("机器人先进了首领场、后清 ①②");
            if (rec.bossSeconds <= 0) Fail("没打首领");
            if (!rec.completed) Fail("3-4 没有走到本关结算");
        }
    }
}
