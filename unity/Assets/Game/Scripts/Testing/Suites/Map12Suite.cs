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
    /// 1-2 雅丹迷城冒烟（bridge.sh playtest map-1-2；docs/level-design/maps/1-2.md §8，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 1-2、局难度 = RunPlan 的 1.16；场景里有目标图（必清 4 + 可选 1）、出口、3 块流沙、2 处藏宝；
    ///      出生点看得见塔尖（地标标记 Landmark_StupaSpire）；出口没开。
    ///   2. 机器人清场：不按编号——每次挑 NavMesh 路程最近的未清必清场地，沿 NavMesh 路径一步步走过去（瞬移 2.5 m 一步，触发和视线照常判定），
    ///      路上被别的场地触发就先打那个；交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住就绕到看得见的地方，
    ///      镇墓兽绕到背后。玩家临时 +5000 生命。每个场地记用时、击杀、精英与词缀；肃清后场地宝箱要出现（不开，免得秘卷三选一停表）。
    ///      路径不完整（NavMesh 断了）记不合格。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱。
    ///   4. 流沙：走进屋脊之海的一块流沙，0.8 s 内被往圆心拖、陷在里面；走出来。
    ///   5. 藏宝 A（商队遗物，无守军）：走到岩龛口发现 → 按 F → 宝箱出现。
    ///   6. 走到出口祭坛前按 F → 本关结算。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map12Suite : PlaytestSuite
    {
        public override string Id => "map-1-2";
        /// <summary>1-2 雅丹迷城（与编辑器里 Level_1_2.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L1_2_Yardang.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 150f, ClearAllTimeout = 900f, BotSpeed = 11f;
        const string StupaId = "SM_Tripo_DesertStupaBuried";

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 1-2？先 bridge.sh level 1-2）");
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
            var want = RunPlan.Get("1-2");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），清关奖励 {want?.clearReward}");
            if (want == null) Fail("RunPlan 里没有 1-2");
            else if (stage == null || stage.code != "1-2") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 1-2）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 1-2 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var sites = FindObjectsByType<EncounterSite>();
            var caches = FindObjectsByType<CachePOI>();
            Line($"场景：场地 {sites.Length}，必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，流沙 {Quicksand.All.Count}，藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（藏宝 B 的守军）");
            if (Quicksand.All.Count < 3) Fail($"流沙只有 {Quicksand.All.Count} 块（屋脊之海应有 3 块）");
            if (caches.Length < 2) Fail($"藏宝点只有 {caches.Length} 处（应为 2）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见塔尖
            var spire = GameObject.Find("Landmark_StupaSpire");
            if (!spire) Fail("没有塔尖地标标记 Landmark_StupaSpire");
            else
            {
                bool seen = Visible(eye.position, spire.transform.position, 6f, StupaId);
                Line($"出生点 → 塔尖（{Vector3.Distance(eye.position, spire.transform.position):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到塔尖（全图地标）");
                Aim(motor, eye, spire.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map12_spawn");
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map12", Stat.MaxHp, 5000);
            vitals.Heal(99999);
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

            // ── 4. 流沙 ──
            yield return QuicksandCheck();

            // ── 5. 藏宝 A ──
            var cache = caches.FirstOrDefault(c => !c.guard);
            if (!cache) Fail("没有无守军的藏宝点（藏宝 A）");
            else yield return CacheCheck(cache);

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
            Shot(cam, "map12_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map12");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（主线断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：坡道 / 台阶 / 窄口？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是岩壁（地形），
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
                    Shot(cam, $"map12_combat_{Slug(site)}");
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

        /// <summary>精英与词缀：③ 写死一只（坚盾）、④ 升格一只（小队词缀爆裂）——词缀登记接上时核对词缀</summary>
        void ReportElites(List<EncounterSite> required)
        {
            var elites = spawned.Where(r => r.elite).ToList();
            Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
            if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（③ 写死 1 只 + ④ 升格 1 只）");
            var src = SquadAffixes.Source;
            if (src == null)
            {
                Line("词缀登记没有接上（SquadAffixes.Source 为空），跳过词缀核对");
                return;
            }
            foreach (var r in elites)
                if (string.IsNullOrEmpty(r.affix)) Fail($"精英 {r.id} 没有词缀");
            var plaza = required.FirstOrDefault(s => s.title == "塔尖广场");
            if (plaza && src.Exists("shielded") && !spawned.Any(r => r.elite && r.id == "tomb_beast" && r.affix == "shielded"))
                Fail("塔尖广场的精英镇墓兽没有带「坚盾」词缀");
        }

        // ───────────── 流沙 / 藏宝 ─────────────

        IEnumerator QuicksandCheck()
        {
            var pit = Quicksand.All.Where(q => q).OrderBy(q => q.radius).LastOrDefault();
            if (!pit)
            {
                Fail("没有流沙");
                yield break;
            }
            var c = pit.transform.position;
            var start = c + Vector3.right * pit.radius * 0.55f;
            yield return Travel(start, 3f, false);
            Place(start);
            float d0 = Flat(motor.transform.position - c);
            yield return new WaitForSeconds(0.8f);
            bool inside = Quicksand.PlayerInside;
            float d1 = Flat(motor.transform.position - c);
            Line($"流沙（半径 {pit.radius:F1} m）：脚下{(inside ? "是" : "不是")}流沙，0.8 s 被拖近 {d0 - d1:F2} m，下沉度 {Quicksand.PlayerSink:F2}");
            Shot(cam, "map12_quicksand");
            if (!inside) Fail("站进流沙圈里 Quicksand.PlayerInside 仍为 false");
            else if (d0 - d1 < 0.3f) Fail("流沙没有把人往圆心拖");
            // 走出来（冲刺脱身的效果：直接挪到圈外）
            Place(c + Vector3.right * (pit.radius + 4f));
            yield return new WaitForSeconds(0.5f);
        }

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            // 从岩龛口走进去：先到藏宝点 6 m 外，再靠近
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
            Shot(cam, "map12_cache");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（坡道、台阶、碰撞、流沙的拖拽都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map11Suite）。
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

        /// <summary>朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用，不会走上孤立的岛顶）</summary>
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（拱楣、屋檐、岛顶不会接住人）</summary>
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
