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
    /// 2-2 昆仑天阙 · 开明九门冒烟（bridge.sh playtest map-2-2；docs/level-design/maps/2-2.md §9，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 2-2、局难度 = RunPlan 的 1.96；场景里有目标图（必清 4 + 可选 1）、出口、2 处藏宝；
    ///      出生点看得见开明兽巨像（地标标记 Landmark_KaimingHead）；出口没开；没有空气墙。
    ///   2. 三门：西 / 中 / 东三道门各自的门脚 → 天阶顶 NavMesh 路径完整，穿过九门挡土墙的位置就在这道门里（不绕别的门），路程不超过直线的 1.6 倍。
    ///   3. 机器人先清 ① 玉阶月台、② 九门外庭（每次挑 NavMesh 路程最近的未清场地，沿导航路径用角色控制器走过去，路上被别的场地触发就先打那个；
    ///      交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住就绕到看得见的地方，旋龟绕到背后）。玩家临时 +5000 生命。
    ///   4. 固定走东门：东门脚 → U1 平台 → 钟亭小径（调查藏宝 A：发现 → 按 F → 宝箱）→ U2 平台 → 东台地（③ 必须还没开战）→ 东翼口；
    ///      再走向兽庭，③ 开战时机器人要在东侧（x &gt; 16，从东翼杀进去）。
    ///   5. 清 ③、④；必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱；精英至少 2 只（③ 升格、④ 坚盾旋龟）。
    ///   6. 走到出口祭坛前按 F → 本关结算。路径不完整、走路卡住 ≥ 8 次都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map22Suite : PlaytestSuite
    {
        public override string Id => "map-2-2";
        /// <summary>2-2 昆仑天阙（与编辑器里 Level_2_2.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L2_2_Kunlun.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 150f, ClearAllTimeout = 900f, BotSpeed = 11f;
        const string KaimingId = "SM_Tripo_FrostKaiming";
        /// <summary>九门挡土墙（S2 第一道墙）的大致 z 与三道门（同 Level_2_2.Gates）</summary>
        const float NineGateZ = 124.6f;
        static readonly (string code, string name, float x, float width)[] Gates = { ("W", "西门", -58, 8), ("C", "中门", 0, 12), ("E", "东门", 58, 8) };
        const string StageTitle = "玉阶月台", OuterTitle = "九门外庭", CourtTitle = "开明兽庭";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        int partialPaths, skillCasts, stalls;
        Vector3? courtStartedAt;

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 2-2？先 bridge.sh level 2-2）");
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
            var want = RunPlan.Get("2-2");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），清关奖励 {want?.clearReward}");
            if (want == null) Fail("RunPlan 里没有 2-2");
            else if (stage == null || stage.code != "2-2") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 2-2）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 2-2 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var sites = FindObjectsByType<EncounterSite>();
            var caches = FindObjectsByType<CachePOI>();
            Line($"场景：场地 {sites.Length}，必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（玉库守军）");
            if (caches.Length < 2) Fail($"藏宝点只有 {caches.Length} 处（应为 2：钟亭、玉库）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见开明兽巨像
            var head = GameObject.Find("Landmark_KaimingHead");
            if (!head) Fail("没有巨像地标标记 Landmark_KaimingHead");
            else
            {
                bool seen = Visible(eye.position, head.transform.position, 6f, KaimingId);
                Line($"出生点 → 开明兽巨像（{Vector3.Distance(eye.position, head.transform.position):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到开明兽巨像（全图地标）");
                Aim(motor, eye, head.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map22_spawn");
            }

            // ── 2. 三道门各自连通 ──
            CheckGates();

            // ── 3–5. 机器人清场 ──
            vitals.stats.Add("playtest_map22", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            try
            {
                var required = objective ? objective.required.Where(s => s).ToList() : sites.Where(s => !s.optional).ToList();
                var lower = required.Where(s => s.title == StageTitle || s.title == OuterTitle).ToList();
                if (lower.Count != 2) Fail($"找不到「{StageTitle}」「{OuterTitle}」两个场地（找到 {lower.Count} 个）");
                yield return ClearSites(lower);

                // 固定走东门：钟亭顺路调查藏宝 A
                var court = required.FirstOrDefault(s => s.title == CourtTitle);
                if (!court) Fail($"找不到场地「{CourtTitle}」");
                Line("—— 东门路线 ——");
                yield return Via("Route_GateE_Foot", "东门脚");
                yield return Via("Route_GateE_U1", "东门天阶 · U1 平台");
                var bell = caches.FirstOrDefault(c => !c.guard);
                if (!bell) Fail("没有无守军的藏宝点（钟亭）");
                else
                {
                    yield return Via("Route_Bell", "钟亭小径");
                    yield return CacheCheck(bell);
                }
                yield return Via("Route_GateE_U2", "东天阶 · U2 平台");
                yield return Via("Route_GateE_Top", "东台地");
                if (court && court.phase != EncounterSite.Phase.Idle) Fail($"还没进兽庭「{CourtTitle}」就开战了（{court.phase}）——东路应该绕到东翼");
                yield return Via("Route_EastArm", "东翼口");
                Shot(cam, "map22_east_arm");

                yield return ClearSites(required);
                foreach (var s in required)
                    if (s.phase != EncounterSite.Phase.Cleared) Fail($"必清场地「{s.title}」没有肃清（{s.phase}，剩 {s.Remaining}）");
                if (courtStartedAt is { } at)
                {
                    Line($"兽庭开战时机器人在 ({at.x:F0}, {at.z:F0})");
                    if (at.x <= 16f) Fail($"兽庭开战时机器人不在东侧（x = {at.x:F0}）——东门路线没有从东翼进兽庭");
                }
                else if (court) Fail("没记到兽庭开战的位置");
                ReportElites();
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }

            // ── 5. 目标完成 → 出口升起 → 清关宝箱 ──
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

            // ── 6. 出口 ──
            vitals.Heal(99999);
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Travel(front, 1.2f, false);
            Place(front);
            yield return new WaitForSeconds(0.5f);
            Aim(motor, eye, portal.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as ExitPortal != portal) Fail($"站在出口前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            interactor.testInteract = true;
            yield return new WaitForSecondsRealtime(0.5f);
            bool done = GameSession.Instance && GameSession.Instance.Completed;
            Line($"进入出口：{(done ? "关卡完成" : "没有结算")}");
            if (!done) Fail("进入出口后没有关卡结算");
            Shot(cam, "map22_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map22");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（主线断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：台阶 / 挡土墙 / 窄口？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>
        /// 清掉 targets 里的场地：不按编号，每次挑 NavMesh 路程最近的未清场地走过去（路上被任何场地触发就先打那个）。
        /// 兽庭开战的那一刻记下机器人的位置（东门路线要从东翼进）。
        /// </summary>
        IEnumerator ClearSites(List<EncounterSite> targets)
        {
            float t0 = Time.time;
            while (targets.Any(s => s.phase != EncounterSite.Phase.Cleared) && Time.time - t0 < ClearAllTimeout)
            {
                if (EncounterSite.ActiveSites.Count > 0)
                {
                    var active = EncounterSite.ActiveSites[0];
                    if (active.title == CourtTitle && courtStartedAt == null) courtStartedAt = motor.transform.position;
                    yield return Fight(active);
                    continue;
                }
                var next = targets.Where(s => s.phase == EncounterSite.Phase.Idle)
                    .OrderBy(s => PathLength(motor.transform.position, s.transform.position)).FirstOrDefault();
                if (!next) break;
                Line($"前往「{next.title}」（路程 {PathLength(motor.transform.position, next.transform.position):F0} m）");
                yield return Travel(next.transform.position, Mathf.Max(3f, next.triggerRadius - next.entryDepth - 4f), true);
                if (EncounterSite.ActiveSites.Count > 0) continue;
                // 到了触发圈边上还没开战：像玩家一样再往场地中心走（兽庭中心是巨像，走到基座前）
                yield return Travel(next.transform.position, next.title == CourtTitle ? 12f : 2f, true);
                float w0 = Time.time;
                while (next.phase == EncounterSite.Phase.Idle && EncounterSite.ActiveSites.Count == 0 && Time.time - w0 < 3f) yield return null;
                if (next.phase == EncounterSite.Phase.Idle && EncounterSite.ActiveSites.Count == 0)
                {
                    Fail($"走到「{next.title}」中心 3 s 后遭遇没有开始");
                    break;
                }
            }
        }

        /// <summary>沿 NavMesh 走到路线标记（Level_2_2 摆的 Route_*）；标记缺失记不合格</summary>
        IEnumerator Via(string marker, string label)
        {
            var go = GameObject.Find(marker);
            if (!go)
            {
                Fail($"没有路线标记 {marker}（{label}）");
                yield break;
            }
            yield return Travel(go.transform.position, 1.5f, true);
            while (EncounterSite.ActiveSites.Count > 0)
            {
                var s = EncounterSite.ActiveSites[0];
                Line($"  去「{label}」的路上惊动了「{s.title}」");
                if (s.title == CourtTitle && courtStartedAt == null) courtStartedAt = motor.transform.position;
                yield return Fight(s);
                yield return Travel(go.transform.position, 1.5f, true);
            }
            Line($"  到达「{label}」({motor.transform.position.x:F0}, {motor.transform.position.z:F0})，y {motor.transform.position.y:F1}");
        }

        /// <summary>三道门：门脚 → 天阶顶的 NavMesh 路径完整、穿过九门挡土墙的位置在这道门里、路程 ≤ 直线 1.6 倍</summary>
        void CheckGates()
        {
            foreach (var (code, name, x, width) in Gates)
            {
                var foot = GameObject.Find($"Route_Gate{code}_Foot");
                var top = GameObject.Find($"Route_Gate{code}_Top");
                if (!foot || !top)
                {
                    Fail($"{name}：缺路线标记 Route_Gate{code}_Foot / _Top");
                    continue;
                }
                var corners = PathCorners(foot.transform.position, top.transform.position, out bool complete);
                float len = 0;
                for (int i = 0; i + 1 < corners.Count; i++) len += Vector3.Distance(corners[i], corners[i + 1]);
                float straight = Flat(top.transform.position - foot.transform.position);
                float? crossX = null;
                for (int i = 0; i + 1 < corners.Count && crossX == null; i++)
                {
                    var a = corners[i];
                    var b = corners[i + 1];
                    if ((a.z - NineGateZ) * (b.z - NineGateZ) > 0 || Mathf.Approximately(a.z, b.z)) continue;
                    crossX = Mathf.Lerp(a.x, b.x, (NineGateZ - a.z) / (b.z - a.z));
                }
                Line($"{name}：门脚 → 天阶顶 {(complete ? "通" : "不通")}，路程 {len:F0} m（直线 {straight:F0} m），过九门墙于 x = {(crossX.HasValue ? crossX.Value.ToString("F1") : "—")}");
                if (!complete) Fail($"{name}：门脚到天阶顶的 NavMesh 路径不完整");
                else if (len > straight * 1.6f) Fail($"{name}：路程 {len:F0} m 超过直线的 1.6 倍（门被堵住、绕了别的门？）");
                if (crossX.HasValue && Mathf.Abs(crossX.Value - x) > width * 0.5f + 2f) Fail($"{name}：路径从 x = {crossX.Value:F1} 穿过九门墙，不在这道门里（{x - width / 2:F0}…{x + width / 2:F0}）");
            }
        }

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是绝壁（地形），
        /// 顺带在玩家脚下看一眼软边界的距离场（出生点应在界内、离等值线 ≥ 5 m）
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
                var b = c.bounds;
                if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
                {
                    var verts = mc.sharedMesh.vertices;
                    for (int i = 0; i < verts.Length; i += 2) nearest = Mathf.Min(nearest, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                }
                else nearest = Mathf.Min(nearest, BoundaryZone.Distance(b.center));
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
                if (ai is XuanGuiAI && Time.time >= flankAt)
                {
                    // 旋龟正面 ×0.15：像玩家一样绕到背后打蛇头
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
                    Shot(cam, $"map22_combat_{Slug(site)}");
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
                        if (!c.Opened && c.reward == site.reward) chest = c;
                    yield return null;
                }
                Line($"  场地宝箱（{site.reward}）：{(chest ? $"出现在 {chest.transform.position}" : "没有出现")}");
                if (!chest) Fail($"「{site.title}」肃清后没有出现宝箱（{site.reward}）");
            }
        }

        /// <summary>精英与词缀：③ 升格一只（小队词缀狂暴）、④ 写死一只坚盾旋龟——词缀登记接上时核对词缀</summary>
        void ReportElites()
        {
            var elites = spawned.Where(r => r.elite).ToList();
            Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
            if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（③ 升格 1 只 + ④ 坚盾旋龟 1 只）");
            var src = SquadAffixes.Source;
            if (src == null)
            {
                Line("词缀登记没有接上（SquadAffixes.Source 为空），跳过词缀核对");
                return;
            }
            foreach (var r in elites)
                if (string.IsNullOrEmpty(r.affix)) Fail($"精英 {r.id} 没有词缀");
            if (src.Exists("shielded") && !spawned.Any(r => r.elite && r.id == "xuangui" && r.affix == "shielded"))
                Fail("玉京殿前的精英旋龟没有带「坚盾」词缀");
        }

        // ───────────── 藏宝 ─────────────

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            yield return Travel(c, 6f, false);
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
            Shot(cam, "map22_bell_cache");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（台阶、坡道、碰撞都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map12Suite）。
        /// breakOnCombat = 路上有场地开战就停下（交给 Fight）。路径不完整记一次。
        /// </summary>
        IEnumerator Travel(Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete) partialPaths++;
            if (corners.Count == 0)
            {
                Place(goal);
                yield break;
            }
            var cc = motor.GetComponent<CharacterController>();
            for (int i = 1; i < corners.Count; i++)
            {
                var target = corners[i];
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
                        Line($"  ⚠ 在 {motor.transform.position} 卡住 1.5 s，跳到拐点 {target}");
                        Place(target);
                        yield return null;
                        break;
                    }
                }
            }
        }

        /// <summary>朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用，不会走上孤立的台顶）</summary>
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（门阙、殿顶、栏板不会接住人）</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
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
