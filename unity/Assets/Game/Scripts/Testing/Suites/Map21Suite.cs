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
    /// 2-1 冰瀑栈道冒烟（bridge.sh playtest map-2-1；场景 L2_1_Icefall，docs/level-design/maps/2-1.md §8，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 2-1、局难度 = RunPlan 的 1.80；目标图（必清 5 + 可选 1）、冰面区域 ≥ 4、冰棱 5 根、2 处藏宝、出口（没开）；
    ///      没有空气墙（Ignore Raycast 层只有兜底环）；出生点看得见冰瀑（地标标记 Landmark_IcefallTop）。
    ///   2. 冰面：从出生碛丘走下冰河，脚下是冰面预设（SurfaceZone.PlayerSurface = ice）。
    ///   3. 机器人清场：每次挑 NavMesh 路程最近的未清必清场地（寻路不走攀爬连线：区域 29 只给雪狌狌），用角色控制器沿导航路径真走过去
    ///      （坡道、栈道、冰桥都是真的），路上被别的场地触发就先打那个；交战时自动瞄最近的敌人（冰棱不算敌人）射击、隔 4 s 放技能，被挡住就绕到看得见的地方。
    ///      玩家临时 +5000 生命。每处 160 s 内肃清，肃清后场地宝箱要出现（不开）。
    ///   4. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱。
    ///   5. 冰棱：站上冰桥，朝一根还挂着的冰棱开火 → 松脱、砸到桥面、换成碎冰堆（带碰撞的掩体）。
    ///   6. 断桥：走到断桥西段断口前，跳 + 冲刺（冲刺用同参数的硬突进模拟：22 m/s × 0.18 s，期间不下坠）过 4 m 断口，落在高 1 m 的东段残桥上。
    ///   7. 藏宝 A（冰瀑下的冻供，无守军）：沿谷底河槽走到冰瀑脚下 → 发现 → 按 F → 宝箱出现。
    ///   8. 走到出口祭坛前按 F → 本关结算。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map21Suite : PlaytestSuite
    {
        public override string Id => "map-2-1";
        /// <summary>2-1 冰瀑栈道（与编辑器里 Level_2_1.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 160f, ClearAllTimeout = 1100f, BotSpeed = 11f;
        const string IcefallTopId = "SM_Tripo_FrostIcefallTop";
        /// <summary>机器人寻路的区域：不走攀爬连线（PackCoordinator.ClimbArea 只给会爬的敌人，玩家翻不上 3 m 的坎）</summary>
        static readonly int WalkMask = NavMesh.AllAreas & ~(1 << PackCoordinator.ClimbArea);

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 2-1？先 bridge.sh level 2-1）");
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
            var want = RunPlan.Get("2-1");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），清关奖励 {want?.clearReward}");
            if (want == null) Fail("RunPlan 里没有 2-1");
            else if (stage == null || stage.code != "2-1") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 2-1）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 2-1 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var sites = FindObjectsByType<EncounterSite>();
            var caches = FindObjectsByType<CachePOI>();
            int iceZones = SurfaceZone.All.Count(z => z && z.profile.id == SurfaceProfile.Ice.id);
            Line($"场景：场地 {sites.Length}，必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，冰面区域 {iceZones}，冰棱 {IcefallIcicle.All.Count}，" +
                 $"藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 5) Fail("目标图的必清场地应为 5 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（藏宝 B 的守军）");
            if (iceZones < 4) Fail($"冰面区域只有 {iceZones} 块（① 冰河、收窄段、河槽、冰潭）");
            if (IcefallIcicle.All.Count < 5) Fail($"冰棱只有 {IcefallIcicle.All.Count} 根（③ 冰拱下应有 5 根）");
            if (caches.Length < 2) Fail($"藏宝点只有 {caches.Length} 处（应为 2）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见冰瀑
            var falls = GameObject.Find("Landmark_IcefallTop");
            if (!falls) Fail("没有冰瀑地标标记 Landmark_IcefallTop");
            else
            {
                bool seen = Visible(eye.position, falls.transform.position, 6f, IcefallTopId);
                Line($"出生点 → 冰瀑（{Vector3.Distance(eye.position, falls.transform.position):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到冰瀑（全图地标）");
                Aim(motor, eye, falls.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map21_spawn");
            }

            // ── 2. 冰面 ──
            yield return IceCheck();

            // ── 3. 机器人清场 ──
            vitals.stats.Add("playtest_map21", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            int stumbles0 = SurfaceZone.Stumbles;
            EncounterSite.AnySpawned += OnSpawned;
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
                ReportElites(required);
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }
            Line($"冰面上敌人滑倒 {SurfaceZone.Stumbles - stumbles0} 次");

            // ── 4. 目标完成 → 出口升起 → 清关宝箱 ──
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

            // ── 5. 冰棱 ──
            vitals.Heal(99999);
            yield return IcicleCheck();

            // ── 6. 断桥 ──
            yield return DashGapCheck();

            // ── 7. 藏宝 A ──
            var cache = caches.FirstOrDefault(c => !c.guard);
            if (!cache) Fail("没有无守军的藏宝点（藏宝 A）");
            else yield return CacheCheck(cache);

            // ── 8. 出口 ──
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
            Shot(cam, "map21_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map21");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（主线断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：坡道 / 栈道 / 桥头？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

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

        /// <summary>从出生碛丘走下冰河（还没进 ① 的触发圈），脚下应是冰面预设</summary>
        IEnumerator IceCheck()
        {
            var on = new Vector3(0, 0, 40);
            yield return Travel(on, 1.5f, false);
            float t0 = Time.time;
            while (!SurfaceZone.PlayerOnSurface && Time.time - t0 < 1f) yield return null;
            var p = SurfaceZone.PlayerSurface;
            Line($"冰河 {Fmt(motor.transform.position)}：脚下 {(SurfaceZone.PlayerOnSurface ? p.title : "普通地面")}（加速 ×{p.accel:F2}、刹车 ×{p.friction:F2}）");
            if (!SurfaceZone.PlayerOnSurface || p.id != SurfaceProfile.Ice.id) Fail("走上冰河后脚下不是冰面（SurfaceZone 冰面区域没盖住冰河？）");
            Shot(cam, "map21_ice");
        }

        // ───────────── 交战 ─────────────

        /// <summary>最近的活着的敌人（冰棱、狐巫冰壁这类可破坏件不算）</summary>
        static Damageable NearestFoe(Vector3 from)
        {
            Damageable best = null;
            float bestD = float.MaxValue;
            foreach (var e in EnemyAI.All)
            {
                if (!e || e.Dead || !e.Health || e.Health.untargetable) continue;
                float d = Vector3.Distance(from, e.transform.position);
                if (d < bestD)
                {
                    bestD = d;
                    best = e.Health;
                }
            }
            return best;
        }

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
                var target = NearestFoe(eye.position);
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
                    Shot(cam, $"map21_combat_{Slug(site)}");
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
                        if (!c.Opened && c.reward == site.reward && Flat(c.transform.position - (site.transform.position + site.chestOffset)) < 10f) chest = c;
                    yield return null;
                }
                Line($"  场地宝箱（{site.reward}）：{(chest ? $"出现在 {chest.transform.position}" : "没有出现")}");
                if (!chest) Fail($"「{site.title}」肃清后没有出现宝箱（{site.reward}）");
            }
        }

        /// <summary>精英与词缀：④ 升格一只（小队词缀狂怒）、⑤ 写死一只（玄冰巨蟹坚盾）——词缀登记接上时核对词缀</summary>
        void ReportElites(List<EncounterSite> required)
        {
            var elites = spawned.Where(r => r.elite).ToList();
            Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
            if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（④ 升格 1 只 + ⑤ 写死 1 只）");
            var src = SquadAffixes.Source;
            if (src == null)
            {
                Line("词缀登记没有接上（SquadAffixes.Source 为空），跳过词缀核对");
                return;
            }
            foreach (var r in elites)
                if (string.IsNullOrEmpty(r.affix)) Fail($"精英 {r.id} 没有词缀");
            if (src.Exists("shielded") && !spawned.Any(r => r.elite && r.id == "frost_crab" && r.affix == "shielded"))
                Fail("瀑顶冰潭的精英玄冰巨蟹没有带「坚盾」词缀");
        }

        // ───────────── 冰棱 / 断桥 / 藏宝 ─────────────

        /// <summary>站上冰桥，朝一根还挂着的冰棱开火：松脱 → 砸到桥面 → 换成带碰撞的碎冰堆</summary>
        IEnumerator IcicleCheck()
        {
            var icicle = IcefallIcicle.All.Where(i => i && !i.Falling && !i.Landed && i.hanging)
                .OrderBy(i => Mathf.Abs(i.transform.position.x)).FirstOrDefault();
            if (!icicle)
            {
                Fail("没有还挂着的冰棱（全被流弹打掉了？）");
                yield break;
            }
            var ip = icicle.transform.position;
            var stand = new Vector3(ip.x + (ip.x <= 0 ? 8f : -8f), icicle.groundY + 0.5f, 158f);
            yield return Travel(stand, 1.5f, false);
            Place(stand);
            yield return new WaitForSeconds(0.3f);
            var center = icicle.hanging.position + Vector3.up * (icicle.tipDepth * 0.5f);
            float t0 = Time.time;
            while (!icicle.Falling && !icicle.Landed && Time.time - t0 < 4f)
            {
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                Aim(motor, eye, center);
                weapons.testFire = weapons.Active != null && (weapons.Active.def.mode != FireMode.Semi || !weapons.testFire);
                yield return null;
            }
            weapons.testFire = false;
            bool shotDown = icicle.Falling || icicle.Landed;
            Line($"冰棱 {icicle.name}（挂点 {Fmt(ip)}，{icicle.Health.maxHealth:F0} 血）：{(shotDown ? $"{Time.time - t0:F1} s 射落" : "4 s 没射落")}");
            if (!shotDown)
            {
                Fail("朝冰棱开火 4 s 没有射落（碰撞 / Damageable 没接上？）");
                icicle.Drop();
            }
            t0 = Time.time;
            while (!icicle.Landed && Time.time - t0 < 2.5f) yield return null;
            var pile = icicle.fallen;
            bool cover = pile && pile.activeInHierarchy && pile.GetComponentsInChildren<Collider>().Any(c => c.enabled);
            Line($"  砸地：{(icicle.Landed ? $"落在 y {icicle.groundY:F1}，砸到 {icicle.LastHits} 个目标" : "没落地")}，碎冰堆{(cover ? "已出现（带碰撞）" : "没有出现")}");
            if (!icicle.Landed) Fail("冰棱松脱 2.5 s 后还没砸到桥面");
            else if (!cover) Fail("冰棱砸地后没有换成带碰撞的碎冰堆（掩体）");
            Shot(cam, "map21_icicle");
        }

        /// <summary>
        /// 断桥：站在西段断口前（桥面 33 m），朝东助跑速度起跳，接近顶点时冲刺（同 PlayerMotor 冲刺参数的硬突进：匀速、不下坠），
        /// 应落在 4 m 外、高 1 m 的东段残桥上（桥面 34 m）
        /// </summary>
        IEnumerator DashGapCheck()
        {
            var west = GameObject.Find("DashGap_West");
            var east = GameObject.Find("DashGap_East");
            if (!west || !east)
            {
                Fail("没有断桥的落脚点标记 DashGap_West / DashGap_East");
                yield break;
            }
            vitals.Heal(99999);
            var w = west.transform.position;
            var e = east.transform.position;
            yield return Travel(w - Vector3.right * 8f, 1.5f, false);
            Place(w);
            motor.SetLook(90f, 0);
            yield return new WaitForSeconds(0.3f);
            var start = motor.transform.position;
            motor.Launch(new Vector3(motor.walkSpeed, motor.jumpVelocity, 0));
            float t0 = Time.time, peak = start.y;
            while (motor.Velocity.y > 1f && Time.time - t0 < 0.45f)
            {
                peak = Mathf.Max(peak, motor.transform.position.y);
                yield return null;
            }
            bool dashed = motor.Lunge(Vector3.right, motor.dashSpeed, motor.dashTime, motor.dashIFrames, motor.dashSpeed * motor.dashExitKeep);
            float t1 = Time.time;
            while (Time.time - t1 < 2.5f)
            {
                peak = Mathf.Max(peak, motor.transform.position.y);
                if (Time.time - t1 > 0.25f && motor.Grounded) break;
                yield return null;
            }
            var land = motor.transform.position;
            bool crossed = land.x >= e.x - 3.5f && land.y >= e.y - 0.4f;
            Line($"断桥：从 {Fmt(start)} 起跳{(dashed ? " + 冲刺" : "（冲刺没起来）")}，最高 {peak - start.y:F2} m，落在 {Fmt(land)}（对岸桥面 {e.y:F1} m）：{(crossed ? "过去了" : "掉下去了")}");
            Shot(cam, "map21_dashgap");
            if (!crossed) Fail("跳 + 冲刺没有越过断桥的 4 m 断口（断口 / 对岸高度和尺度表对不上？）");
            yield return new WaitForSeconds(0.3f);
        }

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            // 沿谷底河槽走到冰瀑脚下：先到藏宝点 6 m 外，再靠近
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
            Shot(cam, "map21_cache");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走；不走攀爬连线）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（坡道、栈道、冰桥、冰面都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map12Suite）。
        /// breakOnCombat = 路上有场地开战就停下（交给 Fight）。路径不完整记一次。
        /// </summary>
        IEnumerator Travel(Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete)
            {
                partialPaths++;
                Line($"  ⚠ 从 {Fmt(motor.transform.position)} 到 {Fmt(goal)} 的导航路径不完整");
            }
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
                        Line($"  ⚠ 在 {Fmt(motor.transform.position)} 卡住 1.5 s，跳到拐点 {Fmt(target)}");
                        Place(target);
                        yield return null;
                        break;
                    }
                }
            }
        }

        /// <summary>朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用，不会走上孤立的台子；飞行的敌人够不着就不动）</summary>
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
            if (!NavMesh.SamplePosition(from, out var a, 4f, WalkMask) || !NavMesh.SamplePosition(to, out var b, 4f, WalkMask)) return list;
            var path = new NavMeshPath();
            NavMesh.CalculatePath(a.position, b.position, WalkMask, path);
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（冰拱、栈道底、桥底不会接住人）</summary>
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

        static string Fmt(Vector3 p) => $"({p.x:F1}, {p.y:F1}, {p.z:F1})";

        static string Slug(EncounterSite s)
        {
            var n = s.name;
            int i = n.IndexOf(' ');
            return i > 0 && n.Length > i + 1 ? n.Substring(i + 1, 1) : "x";
        }
    }
}
