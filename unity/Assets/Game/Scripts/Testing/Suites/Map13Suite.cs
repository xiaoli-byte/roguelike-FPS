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
    /// 1-3 沉沙古城冒烟（bridge.sh playtest map-1-3；场景 L1_3_SunkenCity，docs/level-design/maps/1-3.md §11，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 1-3、局难度 = RunPlan 的 1.32；目标图（必清 4 + 可选 1）、补给营（开局已开店、带安全区）、出口（没开）、2 处藏宝；
    ///      没有空气墙（Ignore Raycast 层只有兜底环）；出生点看得见寺塔；出生点到四个必清场地、补给营门口、坑底出口的 NavMesh 路径都完整。
    ///   2. 机器人清场：每次挑 NavMesh 路程最近的未清必清场地，用角色控制器沿 NavMesh 路径真走过去（坡道、沙扇、台阶都是真的），
    ///      路上被别的场地触发就先打那个；交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住绕到看得见的地方，镇墓兽绕背。
    ///      玩家临时 +5000 生命。每处 150 s 内肃清，肃清后场地宝箱要出现（不开）。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱。
    ///   4. 墙头藏宝：沿马道走上北墙墙头 → 发现 → 按 F → 宝箱出现（无人看守）。
    ///   5. 补给营：走上台基、绕过寺塔进塔院——安全区报告玩家在内、到达不白给回复；按住交互键买一件（优先战备药剂），扣的钱 = 标价；
    ///      营地正中刷一只跳鼠，安全区把它挪出去。
    ///   6. 下行：沿坑壁坡道走到坑底，出口前按 F → 本关结算（下一关 1-4）。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map13Suite : PlaytestSuite
    {
        public override string Id => "map-1-3";
        /// <summary>1-3 沉沙古城（与编辑器里 Level_1_3.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L1_3_SunkenCity.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 150f, ClearAllTimeout = 900f, BotSpeed = 11f;
        const string PagodaId = "SM_Tripo_DesertTemplePagoda";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        int partialPaths, skillCasts, stalls;

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 1-3？先 bridge.sh level 1-3）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            ShopStall.TestHeld = true;
            eye = weapons.Aim;
            cam = weapons.eye;
            if (skills) skills.Cast += _ => skillCasts++;

            var flow = SceneFlow.Instance;
            var stage = flow ? flow.Current : null;
            var want = RunPlan.Get("1-3");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"清关奖励 {want?.clearReward}，下一关 {RunPlan.Next(want)?.Label ?? "无"}");
            if (want == null) Fail("RunPlan 里没有 1-3");
            else if (stage == null || stage.code != "1-3") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 1-3）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 1-3 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var camp = FindAnyObjectByType<SupplyCamp>();
            var caches = FindObjectsByType<CachePOI>();
            var zone = camp ? (camp.Zone ? camp.Zone : camp.GetComponent<SafeZone>()) : null;
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}，" +
                 $"补给营 {(camp ? $"「{camp.label}」商店 {(camp.Shop ? camp.Shop.Stalls.Count : 0)} 个摊位、安全区 {(zone ? zone.radius : 0):F0} m" : "无")}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（埋屋藏宝的守军）");
            if (objective && objective.required.Any(s => s && s.requires != null && s.requires.Length > 0)) Fail("必清场地写了 requires（1-3 的场地应当顺序不限）");
            if (caches.Length != 2) Fail($"藏宝点 {caches.Length} 处（应为 2：埋屋、墙头）");
            if (!camp || !zone) Fail("没有补给营或安全区");
            else if (!camp.Shop || camp.Shop.Stalls.Count < 5) Fail("补给营开局没有开店（或摊位不足 5 个）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见寺塔
            var pagoda = FindPrefabInstance(PagodaId);
            if (!pagoda) Fail($"场景里没有寺塔（{PagodaId}）");
            else
            {
                var top = TopOf(pagoda, 0.8f);
                bool seen = Visible(eye.position, top, 6f, PagodaId);
                Line($"出生点 → 寺塔（{Vector3.Distance(eye.position, top):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到寺塔（全图地标）");
                Aim(motor, eye, top);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map13_spawn");
            }

            // 主线可走：出生点 → 四个必清场地、补给营门口、坑底出口
            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            if (camp) goals.Add(("补给营门口", CampFront(camp, zone)));
            goals.Add(("坑底出口", portal.transform.position - portal.transform.forward * 3.5f));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map13", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            try
            {
                var required = objective ? objective.required.Where(s => s).ToList() : FindObjectsByType<EncounterSite>().Where(s => !s.optional).ToList();
                float t0 = Time.time;
                while (required.Any(s => s.phase != EncounterSite.Phase.Cleared) && Time.time - t0 < ClearAllTimeout)
                {
                    if (EncounterSite.ActiveSites.Count > 0)
                    {
                        yield return Fight(EncounterSite.ActiveSites[0]);
                        continue;
                    }
                    var next = required.Where(s => s.phase == EncounterSite.Phase.Idle)
                        .OrderBy(s => PathLength(motor.transform.position, s.transform.position)).FirstOrDefault();
                    if (!next) break;
                    Line($"前往「{next.title}」（路程 {PathLength(motor.transform.position, next.transform.position):F0} m）");
                    yield return Travel(next.transform.position, Mathf.Max(3f, next.triggerRadius - next.entryDepth - 4f), true);
                    if (EncounterSite.ActiveSites.Count > 0) continue;
                    // 到了触发圈边上还没开战：像玩家一样再往场地中心走
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
                var elites = spawned.Where(r => r.elite).ToList();
                Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
                if (elites.Count < 3) Fail($"必清场地只出了 {elites.Count} 只精英（③ 升格 1 只 + ④ 沙王卫队 2 只）");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }

            // ── 3. 目标完成 → 出口升起 → 清关宝箱 ──
            if (objective)
            {
                Line($"目标：{(objective.Complete ? "已完成" : "未完成")}（肃清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}）");
                if (!objective.Complete) Fail("必清场地全部肃清后目标没有完成");
            }
            float rise0 = Time.time;
            while (portal.IsOpen && !portal.Risen && Time.time - rise0 < 5f) yield return null;
            yield return new WaitForSeconds(0.6f);
            Line($"出口：{(portal.IsOpen ? "已开启" : "未开启")}，升起 {portal.Rise:P0}，清关宝箱 {(portal.ClearChest ? portal.ClearChest.reward : "无")}");
            if (!portal.IsOpen) Fail("必清场地肃清后出口没有开启");
            else if (!portal.ClearChest) Fail("出口升起后没有落清关宝箱");

            // ── 4. 墙头藏宝 ──
            var wallCache = caches.FirstOrDefault(c => !c.guard);
            if (!wallCache) Fail("没有无守军的藏宝点（墙头藏宝）");
            else yield return CacheCheck(wallCache);

            // ── 5. 补给营 ──
            if (camp && zone) yield return CampCheck(camp, zone);

            // ── 6. 下行 → 出口 ──
            vitals.Heal(99999);
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Travel(front, 1.2f, false);
            Line($"下到坑底：离出口 {Flat(motor.transform.position - front):F1} m，y = {motor.transform.position.y:F1}");
            Place(front);
            yield return new WaitForSeconds(0.5f);
            Aim(motor, eye, portal.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as ExitPortal != portal) Fail($"站在出口前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            Line($"出口提示：{portal.Prompt}");
            interactor.testInteract = true;
            yield return new WaitForSecondsRealtime(0.5f);
            bool done = GameSession.Instance && GameSession.Instance.Completed;
            Line($"进入出口：{(done ? "关卡完成" : "没有结算")}");
            if (!done) Fail("进入出口后没有关卡结算");
            Shot(cam, "map13_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map13");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（主线断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：沙扇 / 马道 / 坑道？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是城墙芯和雅丹崖（地形），
        /// 顺带看一眼出生点在软边界里多深（应在界内 ≥ 5 m）
        /// </summary>
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
            float start = Time.time, flankAt = 0, skillAt = Time.time + 1f;
            bool shotMid = false;
            int kills0 = Runner.kills;
            float dmg0 = Runner.playerDamage;
            Runner.killsById.Clear();
            Line($"遭遇「{site.title}」开始：{site.Total} 只，{site.WaveCount} 波，升格精英 {site.Promoted}");
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - start < SiteTimeout)
            {
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                var target = NearestEnemy(eye.position);
                if (!target)
                {
                    weapons.testFire = false;
                    // 还有没出场的：往场地中心靠一点，别站在距离带外
                    if (site.PendingCount > 0 && Flat(motor.transform.position - site.transform.position) > site.arenaRadius)
                        yield return Step(site.transform.position, 6f);
                    yield return null;
                    continue;
                }
                var body = target.GetComponent<EnemyBody>();
                var ai = target.GetComponent<EnemyAI>();
                if (ai is TombBeastAI && Time.time >= flankAt)
                {
                    // 镇墓兽正面格挡：像玩家一样绕到背后打裂缝
                    flankAt = Time.time + 2.5f;
                    var behind = target.transform.position - target.transform.forward * 9f;
                    if (NavMesh.SamplePosition(behind, out var hit, 3f, NavMesh.AllAreas) && Mathf.Abs(hit.position.y - target.transform.position.y) < 2.5f) Place(hit.position);
                }
                var aim = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy && Random.value < 0.4f ? body.WeakPoint.position : BodyCenter(target);
                Aim(motor, eye, aim);
                if (Vector3.Distance(eye.position, aim) > 22f) yield return Step(target.transform.position, 6f);
                else if (Time.time >= flankAt && Combat.Blocked(eye.position, aim, target.GetComponent<Collider>()))
                {
                    flankAt = Time.time + 1.5f;
                    if (SightSpot(target, aim, out var spot)) Place(spot);
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
                    Shot(cam, $"map13_combat_{Slug(site)}");
                }
                yield return null;
            }
            weapons.testFire = false;
            var byId = string.Join("、", Runner.killsById.Select(kv => $"{kv.Key}×{kv.Value}"));
            bool cleared = site.phase == EncounterSite.Phase.Cleared;
            Line($"  {(cleared ? "已肃清" : "超时")}：用时 {Time.time - start:F0} s，击杀 {Runner.kills - kills0}（{byId}），敌人对玩家伤害 {Runner.playerDamage - dmg0:F0}");
            if (!cleared)
            {
                foreach (var e in EnemyAI.All)
                    if (e && !e.Dead)
                    {
                        var ag = e.GetComponent<NavMeshAgent>();
                        Line($"  残敌 {e.enemyId}：状态 {e.State}，位置 {e.transform.position}，离玩家 {Vector3.Distance(e.transform.position, motor.transform.position):F1} m，导航网格上 {(ag && ag.isOnNavMesh)}");
                    }
                Fail($"{SiteTimeout:F0} s 内没有肃清「{site.title}」（剩 {site.Remaining}）");
                // 不卡死后面的步骤：清掉残敌，让目标图照常推进
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

        // ───────────── 藏宝 / 补给营 ─────────────

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            // 墙头藏宝：沿马道走上北墙墙头，先到藏宝点 6 m 外，再靠近
            yield return Travel(c, 6f, false);
            Line($"走到墙头：y = {motor.transform.position.y:F1}（藏宝点 y = {c.y:F1}）");
            float t0 = Time.time;
            while (!cache.Discovered && Time.time - t0 < 2f) yield return null;
            if (!cache.Discovered)
            {
                yield return Travel(c, 2.5f, false);
                t0 = Time.time;
                while (!cache.Discovered && Time.time - t0 < 1f) yield return null;
            }
            Line($"藏宝「{cache.title}」：{(cache.Discovered ? "已发现" : "没发现")}（离 {Flat(motor.transform.position - c):F1} m）");
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
            Shot(cam, "map13_cache");
        }

        /// <summary>
        /// 补给营门口：营地东侧、安全区外 1.5 m（安全区在导航网格上挖了洞，门口还在网格上）。营地正面朝北是寺塔，
        /// 从前庭上台基要绕过寺塔，东侧是台基东坡道和下行坑的方向
        /// </summary>
        static Vector3 CampFront(SupplyCamp camp, SafeZone zone) =>
            camp.transform.position + camp.transform.right * ((zone ? zone.radius : 10f) + 1.5f);

        IEnumerator CampCheck(SupplyCamp camp, SafeZone zone)
        {
            EnemyRegistry.PurgeAll();
            vitals.health = vitals.MaxHealth * 0.5f;
            float arrive = vitals.health;
            // 路上会顺手吸到前庭战斗掉的血球（每个 15%）：那是掉落不是营地给的，单独记账、不算「白给」
            float orbHeal = 0;
            System.Action<Pickup.Kind, float> onPick = (k, got) => { if (k == Pickup.Kind.Health) orbHeal += got; };
            GameEvents.PickedUp += onPick;
            // 走上台基、绕过寺塔到营地门口（安全区在网格上挖了洞），再直走进营地
            var gate = CampFront(camp, zone);
            yield return Travel(gate, 1.5f, false);
            var inside = camp.transform.position + camp.transform.forward * 3f;
            yield return Walk(inside, 0.6f);
            yield return new WaitForSeconds(0.5f);
            GameEvents.PickedUp -= onPick;
            bool zoneIn = zone.PlayerInside;
            bool notRestored = vitals.health <= arrive + orbHeal + 0.5f;
            Line($"走进补给营：安全区报告玩家在内 {(zoneIn ? "✓" : "✗")}，到达不白给回复 {(notRestored ? "✓" : "✗")}（生命 {arrive:F0} → {vitals.health:F0}" +
                 (orbHeal > 0 ? $"，其中路上捡血球 +{orbHeal:F0}" : "") + "）");
            if (!zoneIn) Fail("走进补给营，安全区没有报告玩家在内");
            if (!notRestored) Fail("到达补给营白给了回复（回复应当是付费的战备药剂）");
            Aim(motor, eye, camp.transform.position + Vector3.up * 1.2f - camp.transform.forward * 6f);
            yield return null;
            Shot(cam, "map13_camp");
            var shop = camp.Shop;
            if (!shop)
            {
                Fail("补给营没有商店");
                yield break;
            }

            // 买一件：优先战备药剂（先把生命压到三成），其次弹药、强化，再不行买第一个能买的
            var run = RunState.Ensure();
            run.Credit(3000, "playtest");
            var stall = shop.Find("potion");
            if (stall) vitals.health = vitals.MaxHealth * 0.3f;
            if (!stall)
            {
                stall = shop.Find("ammo");
                if (stall)
                    foreach (var w in weapons.slots)
                        if (w != null)
                            w.reserve = 0;
            }
            if (!stall)
            {
                stall = shop.Find("upgrade");
                if (stall && weapons.Active != null) weapons.Active.level = 0;
            }
            if (!stall) stall = shop.Stalls.FirstOrDefault(s => s && s.Offer != null && !s.Offer.SoldOut);
            if (!stall)
            {
                Fail("商店里没有能买的摊位");
                yield break;
            }
            var offer = stall.Offer;
            int coins0 = run.coins, price = offer.PriceFor(PlayerShopCustomer.Instance);
            float hp0 = vitals.health;
            yield return Walk(stall.CustomerSpot, 0.3f);
            Place(stall.CustomerSpot);
            Aim(motor, eye, stall.Focus);
            yield return null;
            yield return null;
            ShopStall.TestHeld = true;
            interactor.testInteract = true;
            float t0 = Time.time;
            while (Time.time - t0 < ShopStall.HoldSeconds + 0.4f)
            {
                Aim(motor, eye, stall.Focus);
                yield return null;
            }
            int paid = coins0 - run.coins;
            Line($"补给营购买 {offer.Kind}「{offer.Title(PlayerShopCustomer.Instance)}」：标价 {price}，扣 {paid}" +
                 (offer.Kind == "potion" ? $"，生命 {hp0:F0} → {vitals.health:F0}" : "") + $"（柜台理由：{shop.Counter.LastRefusal ?? "无"}）");
            if (paid != price || paid <= 0) Fail($"补给营没有买成（扣 {paid}，标价 {price}，柜台理由：{shop.Counter.LastRefusal}）");
            if (offer.Kind == "potion" && vitals.health <= hp0 + 1) Fail("买了战备药剂但生命没有回复");
            Shot(cam, "map13_shop");

            // 安全区挡敌：营地正中刷一只跳鼠（同 boss-encounter 的营地用例），要被挪到圈外
            int ejected0 = zone.Ejected;
            var e = EnemyRoster.Spawn("jerboa_blade", camp.transform.position, Quaternion.identity, 1, false);
            float e0 = Time.time;
            while (Time.time - e0 < 2f) yield return null;
            bool ejected = !e || e.Dead || !zone.Inside(e.transform.position);
            Line($"安全区挡敌：刷在营地正中的跳鼠被挪出去 {(ejected ? "✓" : "✗")}（挪出 {zone.Ejected - ejected0} 次）");
            if (!ejected) Fail("安全区没有把营地里的敌人挪出去");
            if (e) Destroy(e.gameObject);
            EnemyRegistry.PurgeAll();
            yield return null;
            // 走出营地（回到导航网格上），后面沿网格下坑
            yield return Walk(CampFront(camp, zone), 0.6f);
            Place(CampFront(camp, zone));
            yield return null;
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（沙扇、马道、台阶、坑道都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map11 / Map12）。
        /// breakOnCombat = 路上有场地开战就停下（交给 Fight）。路径不完整记一次。
        /// </summary>
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

        /// <summary>不看导航网格、直线走过去（营地里：安全区在网格上挖了洞）</summary>
        IEnumerator Walk(Vector3 target, float stopAt) => WalkTo(target, target, stopAt, false);

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
                if (cc && cc.enabled) cc.Move(dir * Mathf.Min(BotSpeed * Time.deltaTime, d.magnitude));
                yield return null;
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

        /// <summary>朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用，不会走上孤立的台子）</summary>
        IEnumerator Step(Vector3 goal, float maxStep)
        {
            var corners = PathCorners(motor.transform.position, goal, out _);
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
            Place(p);
            yield return null;
        }

        static List<Vector3> PathCorners(Vector3 from, Vector3 to, out bool complete)
        {
            complete = false;
            var list = new List<Vector3>();
            if (!NavMesh.SamplePosition(from, out var a, 4f, NavMesh.AllAreas) || !NavMesh.SamplePosition(to, out var b, 4f, NavMesh.AllAreas)) return list;
            var path = new NavMeshPath();
            NavMesh.CalculatePath(a.position, b.position, NavMesh.AllAreas, path);
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（屋檐、阳台、拱楣不会接住人）</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
        }

        /// <summary>场景里某个美术件的第一个实例（按名字前缀）</summary>
        static GameObject FindPrefabInstance(string id)
        {
            foreach (var t in FindObjectsByType<Transform>())
                if (t.name.StartsWith(id) && t.GetComponentInChildren<Renderer>()) return t.gameObject;
            return null;
        }

        /// <summary>物体渲染包围盒的上部（frac = 从底到顶的比例）</summary>
        static Vector3 TopOf(GameObject go, float frac)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return go.transform.position;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return new Vector3(b.center.x, Mathf.Lerp(b.min.y, b.max.y, frac), b.center.z);
        }

        /// <summary>眼睛到目标没被挡（终点 tolerance 米内的命中、或打到地标资产本身都算看到）</summary>
        static bool Visible(Vector3 from, Vector3 to, float tolerance, string landmark)
        {
            if (!Physics.Linecast(from, to, out var hit, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return true;
            if (Vector3.Distance(hit.point, to) <= tolerance) return true;
            for (var t = hit.collider.transform; t; t = t.parent)
                if (t.name.StartsWith(landmark)) return true;
            return false;
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        static string Slug(EncounterSite s)
        {
            var n = s.name;
            int i = n.IndexOf(' ');
            return i > 0 && n.Length > i + 1 ? n.Substring(i + 1, 1) : "x";
        }
    }
}
