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
    /// 3-2 铸神井冒烟（bridge.sh playtest map-3-2；场景 L3_2_ForgeWell，docs/level-design/maps/3-2.md §10，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 3-2、局难度 = RunPlan 的 2.76；目标图（必清 4、顺序不限 + 可选 1）、两片熔岩（熔岩井 + 熔瀑池）、
    ///      炉坛升降台（开局没通电、停在下站）、出口（没开）、2 处藏宝；没有空气墙（Ignore Raycast 层只有兜底环）；
    ///      出生点看得见井心的悬炉，井口眺台看得见熔岩井；出生点到四个必清场地、升降台下站、出口铸门的 NavMesh 路径都完整。
    ///   2. 机器人清场：每次挑 NavMesh 路程最近的未清必清场地，用角色控制器沿 NavMesh 路径真走（螺旋岩台、横坡、俯射台坡都是真的），
    ///      路上被别的场地触发就先打那个；交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住绕到看得见的地方；
    ///      熔炉铁牛：站到它正前方 10 m 引它吸气，炉门开着就打炉门。玩家临时 +5000 生命。每处 200 s 内肃清，肃清后场地宝箱要出现（不开）。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱；④ 井底炉坛肃清后升降台通电。
    ///   4. 熔瀑池：站进熔岩池正中——熔岩接管（PlayerEntered），扣血，0.5 s 后被托回岸上。
    ///   5. 升降台：走到井底下站、站上台面 → 自己开 → 到上站（玩家跟着台面升 ~14 m，全程不掉出台面），走下栈桥。
    ///   6. 藏宝 A（炼渣龛，无守军）：走到龛口发现 → 按 F → 宝箱出现。
    ///   7. 出口铸门前按 F → 本关结算（下一关 3-3）。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map32Suite : PlaytestSuite
    {
        public override string Id => "map-3-2";
        /// <summary>3-2 铸神井（与编辑器里 Level_3_2.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L3_2_ForgeWell.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 200f, ClearAllTimeout = 1100f, BotSpeed = 11f, LiftTimeout = 20f;
        const string HangingForgeId = "SM_Tripo_InfernoHangingForge";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        int partialPaths, skillCasts, stalls, lavaEntries;

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 3-2？先 bridge.sh level 3-2）");
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
            var want = RunPlan.Get("3-2");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"清关奖励 {want?.clearReward}，下一关 {RunPlan.Next(want)?.Label ?? "无"}");
            if (want == null) Fail("RunPlan 里没有 3-2");
            else if (stage == null || stage.code != "3-2") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 3-2）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 3-2 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var caches = FindObjectsByType<CachePOI>();
            var lavas = FindObjectsByType<LavaVolume>();
            var lift = FindAnyObjectByType<ForgeWellLift>();
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，藏宝 {caches.Length}，熔岩 {lavas.Length} 片（LavaField {(LavaField.Any ? "在" : "不在")}），" +
                 $"升降台 {(lift ? $"{(lift.Powered ? "已通电" : "未通电")}、{(lift.AtLow ? "停在下站" : lift.AtHigh ? "停在上站" : "在走")}、通电场地「{(lift.powerSite ? lift.powerSite.title : "无")}」" : "无")}，" +
                 $"出口 {(portal ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（铸范库守军）");
            if (objective && objective.required.Any(s => s && s.requires != null && s.requires.Length > 0)) Fail("必清场地写了 requires（3-2 的场地应当顺序不限）");
            if (caches.Length != 2) Fail($"藏宝点 {caches.Length} 处（应为 2：炼渣龛、铸范库）");
            if (lavas.Length != 2 || !LavaField.Any) Fail($"熔岩 {lavas.Length} 片（应为 2：熔岩井、熔瀑池），LavaField {(LavaField.Any ? "在" : "不在")}");
            if (!lift) Fail("场景里没有炉坛升降台（ForgeWellLift）");
            else
            {
                if (!lift.powerSite) Fail("升降台没有接通电场地");
                else if (lift.Powered) Fail("开局升降台就通电了（应等井底炉坛肃清）");
                if (!lift.AtLow) Fail("开局升降台不在下站");
            }
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见井心的悬炉；井口眺台看得见熔岩井
            var forge = GameObject.Find("Landmark_HangingForge");
            if (!forge) Fail("没有悬炉地标标记 Landmark_HangingForge");
            else
            {
                bool seen = Visible(eye.position, forge.transform.position, 9f, HangingForgeId);
                Line($"出生点 → 悬炉（{Vector3.Distance(eye.position, forge.transform.position):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到井心的悬炉（全图地标）");
                Aim(motor, eye, forge.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map32_spawn");
            }
            var lookout = GameObject.Find("Lookout_WellRim");
            var lava = GameObject.Find("Lava_WellCentre");
            if (lookout && lava)
            {
                var back = motor.transform.position;
                Place(lookout.transform.position);
                yield return new WaitForSeconds(0.25f);
                bool seen = Visible(eye.position, lava.transform.position, 2f, "Lava");
                Line($"井口眺台 → 熔岩井：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("井口眺台看不到熔岩井");
                Aim(motor, eye, lava.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map32_lookout");
                Place(back);
                yield return null;
            }

            // 主线可走：出生点 → 四个必清场地、升降台下站、出口铸门
            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            if (lift) goals.Add(("升降台下站", lift.lowPosition));
            goals.Add(("出口铸门", portal.transform.position - portal.transform.forward * 3.5f));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map32", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            LavaField.PlayerEntered += OnLava;
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
                if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（③ 升格 1 只 + ④ 精英熔炉铁牛）");
                if (SquadAffixes.Source != null && SquadAffixes.Source.Exists("frenzied") && !spawned.Any(r => r.elite && r.id == "iron_ox" && r.affix == "frenzied"))
                    Fail("井底炉坛的精英熔炉铁牛没有带「狂暴」词缀");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }

            // ── 3. 目标完成 → 出口升起 → 清关宝箱；升降台通电 ──
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
            if (lift && !lift.Powered) Fail("井底炉坛肃清后升降台没有通电");

            // ── 4. 熔瀑池 ──
            var pool = lavas.FirstOrDefault(v => v && v.shape == LavaShape.Box);
            if (!pool) Fail("没有熔瀑池（盒形熔岩）");
            else yield return LavaPoolCheck(pool);
            LavaField.PlayerEntered -= OnLava;

            // ── 5. 升降台 ──
            if (lift) yield return LiftCheck(lift);

            // ── 6. 藏宝 A ──
            var cache = caches.FirstOrDefault(c => !c.guard);
            if (!cache) Fail("没有无守军的藏宝点（藏宝 A 炼渣龛）");
            else yield return CacheCheck(cache);

            // ── 7. 出口 ──
            vitals.Heal(99999);
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Travel(front, 1.2f, false);
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
            Shot(cam, "map32_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map32");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次，踩进熔岩 {lavaEntries} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（螺旋 / 横坡断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：横坡 / 俯射台坡 / 陡坎沿？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        void OnLava(Vector3 feet) => lavaEntries++;

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是火山口内壁（地形），
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
                bool weakOpen = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy;
                var aim = weakOpen && Random.value < 0.4f ? body.WeakPoint.position : BodyCenter(target);
                if (ai is IronOxAI ox)
                {
                    // 熔炉铁牛：铁甲只吃两成——站到它正前方 10 m 引它吸气，炉门开着就一直打炉门
                    if (ox.DoorOpen && weakOpen) aim = body.WeakPoint.position;
                    else if (Time.time >= flankAt)
                    {
                        flankAt = Time.time + 3f;
                        var ahead = target.transform.position + target.transform.forward * 10f;
                        if (NavMesh.SamplePosition(ahead, out var hit, 3f, LavaField.WalkerFilter()) && Mathf.Abs(hit.position.y - target.transform.position.y) < 2.5f) Place(hit.position);
                    }
                }
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
                    Shot(cam, $"map32_combat_{Slug(site)}");
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

        // ───────────── 熔瀑池 / 升降台 / 藏宝 ─────────────

        IEnumerator LavaPoolCheck(LavaVolume pool)
        {
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var c = pool.transform.position;
            yield return Travel(c, 6f, false);
            int entries0 = lavaEntries;
            float hp0 = vitals.health;
            Place(c + Vector3.up * 0.5f);
            float t0 = Time.time;
            while (Time.time - t0 < 1.5f && lavaEntries == entries0) yield return null;
            yield return new WaitForSeconds(1.0f);
            var feet = motor.transform.position;
            bool out_ = !LavaField.IsLava(feet);
            Line($"熔瀑池：熔岩接管 {lavaEntries - entries0} 次，生命 {hp0:F0} → {vitals.health:F0}，1 s 后{(out_ ? $"已托回岸上 {feet}" : "还在熔岩里")}");
            Shot(cam, "map32_lavapool");
            if (lavaEntries == entries0) Fail("站进熔瀑池正中，熔岩没有接管（LavaField.PlayerEntered 没响）");
            else if (!out_) Fail("踩进熔瀑池 1.5 s 后还没被托回岸上");
            vitals.Heal(99999);
        }

        IEnumerator LiftCheck(ForgeWellLift lift)
        {
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            // 走到井底下站的台口等（台面在上站时站在台口叫它下来接）：台口在台面靠井心那条边外 1.5 m——
            // 站在台面投影里，下来的台面会停在头顶上方等人站开（不压人），像玩家一样站在旁边
            var fwd = lift.deck ? Flat3(lift.deck.forward).normalized : Vector3.forward;
            var landing = lift.lowPosition - fwd * (lift.deckSize.y * 0.5f + 1.5f);
            yield return Travel(landing, 1f, false);
            Line($"升降台：到了下站台口（离井道 {Flat(motor.transform.position - lift.lowPosition):F1} m），台面{(lift.AtLow ? "停在下站" : lift.AtHigh ? "停在上站" : "在走")}");
            float w0 = Time.time;
            while (!lift.AtLow && Time.time - w0 < LiftTimeout) yield return null;
            if (!lift.AtLow)
            {
                Fail($"玩家在下站等了 {LiftTimeout:F0} s，升降台没有下来接人（{(lift.Blocked ? "台面下有东西挡着" : lift.Moving ? "还在走" : "停在上站")}）");
                yield break;
            }
            Place(lift.lowPosition + Vector3.up * 0.3f);
            yield return new WaitForSeconds(0.2f);
            var cc = motor.GetComponent<CharacterController>();
            if (!lift.Carrying(cc)) Fail("站在下站台面中央，升降台没有认出乘客");
            int trips0 = lift.Trips;
            float t0 = Time.time, worstGap = 0;
            bool shot = false;
            while (!(lift.AtHigh && lift.Trips > trips0) && Time.time - t0 < LiftTimeout)
            {
                // 乘客脚底离台面多远（往下掉出台面就会越来越大）
                worstGap = Mathf.Max(worstGap, lift.deck.position.y - motor.transform.position.y);
                if (!shot && lift.Moving && Time.time - t0 > 3f)
                {
                    shot = true;
                    Shot(cam, "map32_lift_ride");
                }
                yield return null;
            }
            yield return new WaitForSeconds(0.3f);
            float y = motor.transform.position.y;
            Line($"升降台：{(lift.AtHigh ? "到了上站" : "没到上站")}，用时 {Time.time - t0:F1} s，玩家 y {y:F2}（上站台面 {lift.highPosition.y:F2}），" +
                 $"途中脚底最多低于台面 {worstGap:F2} m");
            if (!lift.AtHigh) Fail($"站上台面 {LiftTimeout:F0} s 升降台没到上站");
            else if (Mathf.Abs(y - lift.highPosition.y) > 0.6f) Fail($"升降台到站，玩家没跟上来（y {y:F2}，台面 {lift.highPosition.y:F2}）");
            if (worstGap > 0.5f) Fail($"升降台途中玩家掉出台面（脚底低于台面 {worstGap:F2} m）");
            // 走下栈桥到上环岩台：栈桥的 +Z 朝井外（构建器按径向摆的），走到桥头外 1.5 m
            var gangway = GameObject.Find("Lift Gangway");
            var ahead = gangway
                ? gangway.transform.position + gangway.transform.forward * (gangway.transform.lossyScale.z * 0.5f + 1.5f)
                : lift.highPosition + Flat3(lift.highPosition).normalized * 11f;
            yield return Walk(ahead, 0.8f);
            yield return new WaitForSeconds(0.3f);
            bool onLedge = !lift.Carrying(cc) && motor.transform.position.y > lift.highPosition.y - 1f;
            Line($"走下栈桥：{(onLedge ? "上了上环岩台" : "没下来")}（{motor.transform.position}）");
            if (!onLedge) Fail("从升降台上站走不下栈桥");
            Shot(cam, "map32_lift_top");
        }

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
            Shot(cam, "map32_cache");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（螺旋岩台、横坡、俯射台坡都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map1x）。
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

        /// <summary>不看导航网格、直线走过去（升降台台面不在导航网格上）</summary>
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
            var walker = LavaField.WalkerFilter();
            if (!NavMesh.SamplePosition(from, out var a, 4f, walker) || !NavMesh.SamplePosition(to, out var b, 4f, walker)) return list;
            var path = new NavMeshPath();
            NavMesh.CalculatePath(a.position, b.position, walker, path);
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（悬炉、栈桥、井架不会接住人）</summary>
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
                if (t.name.Contains(landmark)) return true;
            return false;
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;

        static Vector3 Flat3(Vector3 v) => new(v.x, 0, v.z);

        static string Slug(EncounterSite s)
        {
            var n = s.name;
            int i = n.IndexOf(' ');
            return i > 0 && n.Length > i + 1 ? n.Substring(i + 1, 1) : "x";
        }
    }
}
