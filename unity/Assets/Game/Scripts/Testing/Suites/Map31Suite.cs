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
    /// 3-1 熔湖堤道冒烟（bridge.sh playtest map-3-1；场景 L3_1_Causeway，docs/level-design/maps/3-1.md §8，parity 7.4「机器人清完全部必清场地并走出出口」）：
    ///   1. 开局：SceneFlow 认领的关卡是 3-1、局难度 = RunPlan 的 2.60；目标图（必清 4 + 可选 1）、2 处藏宝、出口（没开）；
    ///      熔岩系统起来了（湖心是熔岩，堤面、墩顶不是）；没有空气墙；栖落点 ≥ 8 处；出生点看得见崖顶的祝融神像；
    ///      <b>只走非熔岩区</b>（LavaField.DryAreaMask）从出生点到四个必清场地、湖心石龛、出口的导航路径都完整——堤道是通的，不用蹚熔岩。
    ///   2. 机器人清场：每次挑非熔岩路程最近的未清必清场地，用角色控制器沿非熔岩的导航路径真走过去（堤道、引坡、台坡道都是真的），
    ///      路上被别的场地触发就先打那个；交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住绕到看得见的地方（不选熔岩边的位置）；
    ///      敌人都清了只剩潜在熔岩里的火鼍时，退到场地里离熔岩最远的地方引它上岸（「引到宫墙下打」）。玩家临时 +5000 生命。
    ///      每处 180 s（有火鼍的 240 s）内肃清，肃清后场地宝箱要出现（不开）。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱。
    ///   4. 打进熔岩：走到 C3 堤肩的 Knock_Edge（地图构建器放的标记，正对熔岩），在那里刷一只祸斗、眩晕住，机器人站在堤面上朝熔岩方向
    ///      打一发带击退的射击 → 它沿导航网格滑下堤肩、烧死：熔岩烧死计数 +1，走正常的击杀事件（不是静默处决）。
    ///   5. 藏宝 A（湖心石龛，无守军）：走 C8 窄堤过去 → 发现 → 按 F → 宝箱出现。
    ///   6. 走到宫门神龛前按 F → 本关结算（下一关 3-2）。
    /// 走路的导航路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map31Suite : PlaytestSuite
    {
        public override string Id => "map-3-1";
        /// <summary>3-1 熔湖堤道（与编辑器里 Level_3_1.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 180f, TuoExtra = 60f, ClearAllTimeout = 1200f, BotSpeed = 11f;
        const string StatueId = "SM_Tripo_InfernoZhurong", KnockMarker = "Knock_Edge", KnockDummy = "huodou";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        int partialPaths, skillCasts, stalls, lures, burnedInFights;
        Damageable lastKilled;
        DamageInfo lastKillInfo;

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 3-1？先 bridge.sh level 3-1）");
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
            var want = RunPlan.Get("3-1");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"清关奖励 {want?.clearReward}，下一关 {RunPlan.Next(want)?.Label ?? "无"}");
            if (want == null) Fail("RunPlan 里没有 3-1");
            else if (stage == null || stage.code != "3-1") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 3-1）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 3-1 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var caches = FindObjectsByType<CachePOI>();
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}，栖落点 {PerchPoint.All.Count}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（熔铸遗址守军）");
            if (objective && objective.required.Any(s => s && s.requires != null && s.requires.Length > 0)) Fail("必清场地写了 requires（3-1 的场地应当顺序不限）");
            if (caches.Length != 2) Fail($"藏宝点 {caches.Length} 处（应为 2：湖心石龛、熔铸遗藏）");
            if (PerchPoint.All.Count < 8) Fail($"栖落点只有 {PerchPoint.All.Count} 处（锚链桩、栖柱、鼓楼台应 ≥ 8）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();
            LavaSetup(objective);

            // 地标：出生点看得见崖顶的祝融神像
            var mark = GameObject.Find("Landmark_Zhurong");
            var statue = FindPrefabInstance(StatueId);
            if (!statue && !mark) Fail($"场景里没有祝融神像（{StatueId}）");
            else
            {
                var top = mark ? mark.transform.position : TopOf(statue, 0.85f);
                bool seen = Visible(eye.position, top, 8f, StatueId);
                Line($"出生点 → 祝融神像（{Vector3.Distance(eye.position, top):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到祝融神像（全图地标）");
                Aim(motor, eye, top);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map31_spawn");
            }

            // 只走非熔岩区：出生点 → 四个必清场地、湖心石龛、出口
            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            var islet = caches.FirstOrDefault(c => !c.guard);
            if (islet) goals.Add((islet.title, islet.transform.position));
            goals.Add(("出口", portal.transform.position - portal.transform.forward * 3.5f));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航（非熔岩）：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有只走非熔岩区的完整路径（堤道断了？）");
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map31", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            System.Action<EnemyAI> onBurned = _ => burnedInFights++;
            LavaField.EnemyBurned += onBurned;
            InAction<KillEvent> onKill = OnKilled;
            GameEvents.EnemyKilled += onKill;
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
                    Line($"前往「{next.title}」（非熔岩路程 {PathLength(motor.transform.position, next.transform.position):F0} m）");
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
                Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}；" +
                     $"交战中被打进熔岩烧死 {burnedInFights} 只，引火鼍上岸 {lures} 次");
                if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（③ 写死 1 只 + ④ 升格 1 只）");
                if (!spawned.Any(r => r.id == "tuo")) Fail("没有出过火鼍（④ 宫门码头第一波）");
                if (!spawned.Any(r => r.id == "bifang")) Fail("没有出过毕方（② 锚链墩）");

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

                // ── 4. 打进熔岩 ──
                yield return KnockCase();
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
                LavaField.EnemyBurned -= onBurned;
                GameEvents.EnemyKilled -= onKill;
            }

            // ── 5. 藏宝 A（湖心石龛）──
            if (!islet) Fail("没有无守军的藏宝点（湖心石龛）");
            else yield return CacheCheck(islet);

            // ── 6. 出口 ──
            vitals.Heal(99999);
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Travel(front, 1.2f, false);
            Line($"走到宫门神龛前：离出口 {Flat(motor.transform.position - front):F1} m，y = {motor.transform.position.y:F1}");
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
            Shot(cam, "map31_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map31");

            var field = LavaField.Instance;
            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次；" +
                 $"熔岩烧死 {(field ? field.Burned : 0)} 只，玩家掉进熔岩 {(field ? field.Entries : 0)} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的非熔岩导航路径有 {partialPaths} 次不完整（堤道断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿导航网格走时卡住 {stalls} 次（角色控制器和导航网格对不上：引坡 / 台坡道 / 堤头？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        void OnKilled(in KillEvent e)
        {
            lastKilled = e.enemy;
            lastKillInfo = e.info;
        }

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是火山口崖（地形），
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

        /// <summary>熔岩系统起来了：一片熔岩盒、湖心是熔岩、场地中心和堤面不是、导航网格有 Lava 区、火鼍的 LavaSwimmer 网格覆盖湖心</summary>
        void LavaSetup(LevelObjective objective)
        {
            var vol = FindAnyObjectByType<LavaVolume>();
            Line($"熔岩：{(vol ? $"{vol.name}，{vol.size.x:0} × {vol.size.y:0} m，熔岩面 y {vol.Level:F2}" : "没有")}，熔岩系统 {(LavaField.Instance ? "已启动" : "没起来")}，" +
                 $"场上熔岩 {LavaField.Bodies.Count} 片，Lava 区 {LavaField.LavaArea}");
            if (!vol)
            {
                Fail("场景里没有 LavaVolume（湖不是熔岩）");
                return;
            }
            if (!LavaField.Instance) Fail("熔岩系统（LavaField）没有起来");
            var c = vol.transform.position;
            if (!LavaField.IsLavaAt(c.x, c.z)) Fail($"湖心 ({c.x:F0}, {c.z:F0}) 不算熔岩");
            if (objective)
                foreach (var s in objective.required)
                    if (s && LavaField.IsLava(s.transform.position)) Fail($"场地「{s.title}」的中心算成了熔岩");
            var knock = GameObject.Find(KnockMarker);
            if (!knock) Fail($"没有 {KnockMarker} 标记（地图构建器放在 C3 堤肩上）");
            else
            {
                var dir = Flat3(knock.transform.forward);
                var deck = Ground(knock.transform.position - dir * 4.5f);
                var lava = knock.transform.position + dir * 2.5f;
                if (LavaField.IsLava(deck)) Fail("C3 堤面算成了熔岩");
                if (!LavaField.IsLavaAt(lava.x, lava.z)) Fail("C3 堤肩外 2.5 m 不是熔岩");
            }
            if (LavaField.LavaArea < 0) Fail("NavMesh 没有 Lava 区域：重启编辑器让 NavMeshAreas.asset 生效后重建 3-1");
            else if (!NavMesh.SamplePosition(c, out var hit, 2f, LavaField.LavaAreaMask)) Fail("湖心附近的导航网格不是 Lava 区");
            else Line($"✓ 导航：湖心是 Lava 区（y {hit.position.y:F2}，代价 {NavMesh.GetAreaCost(LavaField.LavaArea)}）");
            if (!LavaField.SwimmerAgentType.HasValue) Fail($"NavMesh 没有代理类型 {LavaField.SwimmerAgentName}");
            else if (!NavMesh.SamplePosition(c, out _, 3f, LavaField.SwimmerFilter)) Fail("火鼍（LavaSwimmer）的导航网格在湖心采不到：重建 3-1（BakeLavaNavMesh）");
        }

        // ───────────── 交战 ─────────────

        static bool HasTuo(EncounterSite site) =>
            site.spec?.waves != null && site.spec.waves.Any(w => w?.entries != null && w.entries.Any(e => e != null && e.enemy == "tuo"));

        IEnumerator Fight(EncounterSite site)
        {
            float limit = SiteTimeout + (HasTuo(site) ? TuoExtra : 0);
            float start = Time.time, flankAt = 0, skillAt = Time.time + 1f, lureAt = 0;
            bool shotMid = false;
            int kills0 = Runner.kills;
            float dmg0 = Runner.playerDamage;
            Runner.killsById.Clear();
            Line($"遭遇「{site.title}」开始：{site.Total} 只，{site.WaveCount} 波，升格精英 {site.Promoted}");
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - start < limit)
            {
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                var target = NearestEnemy(eye.position);
                if (!target)
                {
                    weapons.testFire = false;
                    if (site.PendingCount > 0)
                    {
                        // 还有没出场的：往场地中心靠一点，别站在距离带外
                        if (Flat(motor.transform.position - site.transform.position) > site.arenaRadius)
                            yield return Step(site.transform.position, 6f);
                    }
                    else if (Time.time >= lureAt)
                    {
                        // 场上看不到能打的（火鼍潜在熔岩里不出来）：退到场地里离熔岩最远的地方，它躲岸 8 s 后会自己爬上来
                        lureAt = Time.time + 6f;
                        lures++;
                        yield return Travel(LureSpot(site), 1.5f, false);
                    }
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
                    if (DrySightSpot(target, aim, out var spot)) Place(spot);
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
                    Shot(cam, $"map31_combat_{Slug(site)}");
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
                        Line($"  残敌 {e.enemyId}：状态 {e.State}，位置 {e.transform.position}，离玩家 {Vector3.Distance(e.transform.position, motor.transform.position):F1} m，" +
                             $"导航网格上 {(ag && ag.isOnNavMesh)}，在熔岩里 {LavaField.IsLava(e.transform.position)}");
                    }
                Fail($"{limit:F0} s 内没有肃清「{site.title}」（剩 {site.Remaining}）");
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

        /// <summary>场地里离熔岩最远的非熔岩导航点（中心 + 5 / 10 / 15 / 20 m 四圈各 12 个方向）</summary>
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
                if (!NavMesh.SamplePosition(p, out var hit, 2f, LavaField.DryAreaMask) || LavaField.IsLava(hit.position)) continue;
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

        /// <summary>目标周围 8–12 m、非熔岩的导航网格上、离熔岩 ≥ 1.5 m、眼高能直接看到瞄准点的位置</summary>
        static bool DrySightSpot(Damageable target, Vector3 aim, out Vector3 spot)
        {
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(8f, 12f);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, LavaField.DryAreaMask)) continue;
                if (LavaField.IsLava(hit.position) || LavaField.NearLava(hit.position, 1.5f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        // ───────────── 打进熔岩 ─────────────

        /// <summary>
        /// C3 堤肩的 Knock_Edge（正对熔岩、地面比熔岩高约 0.65 m）：刷一只祸斗（击退抗性 0）、眩晕住、挪到标记上；机器人站在它身后的堤面上，
        /// 朝熔岩方向打一发带击退的射击（9 m/s，同 LavaSuite）→ 推力沿导航网格把它推下堤肩 → 烧死，熔岩烧死计数 +1，走正常的击杀事件
        /// </summary>
        IEnumerator KnockCase()
        {
            var field = LavaField.Instance;
            var marker = GameObject.Find(KnockMarker);
            if (!marker || !field)
            {
                Fail($"打进熔岩：没有 {KnockMarker} 标记或熔岩系统，跳过");
                yield break;
            }
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var spot = marker.transform.position;
            var dir = Flat3(marker.transform.forward);
            var stand = spot - dir * 3.5f;
            yield return Travel(stand, 1.5f, false);
            Place(stand);
            yield return null;
            var e = EnemyRoster.Spawn(KnockDummy, spot, Quaternion.LookRotation(-dir), 1, false);
            if (!e)
            {
                Fail($"打进熔岩：刷不出 {KnockDummy}");
                yield break;
            }
            yield return new WaitForSeconds(1f);
            if (!e || e.Dead)
            {
                Fail("打进熔岩：祸斗还没开始就死了");
                yield break;
            }
            EnemyStatus.Stun(e.Health, 4f);
            yield return null;
            var agent = e.GetComponent<NavMeshAgent>();
            if (agent && agent.enabled && NavMesh.SamplePosition(spot, out var hit, 1f, LavaField.DryAreaMask)) agent.Warp(hit.position);
            else e.transform.position = spot;
            yield return null;
            yield return null;
            Place(stand);
            Aim(motor, eye, BodyCenter(e.Health));
            yield return null;
            int burned0 = field.Burned;
            lastKilled = null;
            var d = e.Health;
            var from = e.transform.position;
            var info = DamageInfo.Simple(1, DamageSource.Weapon, from + Vector3.up * 0.5f, dir);
            info.knockback = 9;
            info.noCrit = true;
            Combat.DamageEnemy(d, info);
            float t = 0;
            while (e && !e.Dead && t < 2f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            bool dead = !e || e.Dead;
            Shot(cam, "map31_knock");
            Line($"打进熔岩：祸斗从堤肩 {from} 被打{(dead ? "下熔岩烧死了" : $"了一下还活着（在 {e.transform.position}，在熔岩里 {LavaField.IsLava(e.transform.position)}）")}，" +
                 $"熔岩烧死计数 +{field.Burned - burned0}，击杀事件 {(lastKilled == d ? $"有（来源 {lastKillInfo.source}）" : "没有")}");
            if (!dead) Fail("堤肩上被击退推向熔岩的祸斗 2 s 内没烧死（堤肩的导航网格没连到 Lava 区？太陡？）");
            else
            {
                if (field.Burned - burned0 != 1) Fail($"熔岩烧死计数 +{field.Burned - burned0}（应为 1）");
                if (lastKilled != d) Fail("烧死没有走伤害管线的击杀事件（不计击杀、不掉落）");
                else if ((lastKillInfo.tags & DamageTag.Purge) != 0) Fail("烧死被当成了静默处决");
            }
            if (e && !e.Dead) Destroy(e.gameObject);
            yield return new WaitForSeconds(0.5f);
        }

        // ───────────── 藏宝 ─────────────

        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            // 湖心石龛：从锚链墩走 C8 窄堤过去，先到藏宝点 6 m 外，再靠近
            yield return Travel(c, 6f, false);
            Line($"走上窄堤：离石龛 {Flat(motor.transform.position - c):F1} m，y = {motor.transform.position.y:F1}（石龛 y = {c.y:F1}）");
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
            Shot(cam, "map31_islet");
        }

        // ───────────── 走路（沿非熔岩的导航路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿只走非熔岩区的导航路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（堤道、引坡、台坡道都是真的），
        /// 触发圈和视线由场地自己按真实位置判定；1.5 s 没有接近当前拐点就跳到拐点并记一次卡住（同 Map12 / Map13）。
        /// breakOnCombat = 路上有场地开战就停下（交给 Fight）。路径不完整记一次。
        /// </summary>
        IEnumerator Travel(Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete)
            {
                partialPaths++;
                Line($"  ⚠ 从 {motor.transform.position} 到 {goal} 的非熔岩导航路径不完整");
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

        /// <summary>朝 goal 沿非熔岩的导航网格走 maxStep 米（交战中追敌人用，不会走进熔岩、不会走上孤立的台子）</summary>
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

        /// <summary>只走非熔岩区（LavaField.DryAreaMask）的导航路径；没有 Lava 区时就是全部区域</summary>
        static List<Vector3> PathCorners(Vector3 from, Vector3 to, out bool complete)
        {
            complete = false;
            var list = new List<Vector3>();
            int mask = LavaField.DryAreaMask;
            if (!NavMesh.SamplePosition(from, out var a, 4f, mask) || !NavMesh.SamplePosition(to, out var b, 4f, mask)) return list;
            var path = new NavMeshPath();
            NavMesh.CalculatePath(a.position, b.position, mask, path);
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（台檐、神龛门楣不会接住人）</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
        }

        /// <summary>地面点（世界层自上而下射线；打不到原样返回）</summary>
        static Vector3 Ground(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 6f, Vector3.down, out var hit, 20f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
            return p;
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

        static Vector3 Flat3(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }

        static string Slug(EncounterSite s)
        {
            var n = s.name;
            int i = n.IndexOf(' ');
            return i > 0 && n.Length > i + 1 ? n.Substring(i + 1, 1) : "x";
        }
    }
}
