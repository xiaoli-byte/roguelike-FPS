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
    /// 2-3 瑶池冰湖冒烟（bridge.sh playtest map-2-3；docs/level-design/maps/2-3.md §9，parity 7.4「机器人清完全部必清场地并走出出口」、D27「据点任意顺序」）：
    ///   1. 开局：SceneFlow 认领的关卡是 2-3、局难度 = RunPlan 的 2.12；目标图必清 4 + 可选 1，只有瑶台写了 requires（= 西岸 + 东岸）；
    ///      冰面牵引区、冰窟窿水体、2 处藏宝、出口（没开）都在；没有空气墙；出生点看得见湖心亭；出生点到四个必清场地和出口的导航路径完整。
    ///   2. 机器人自由顺序清场：每次在「没开过、requires 已满足」的必清场地里挑 NavMesh 路程最近的，沿导航路径真走过去
    ///      （瞬移 2.5 m 一步之外都是角色控制器走，触发和视线照常判定），路上被别的场地触发就先打那个；记清场顺序。
    ///      两岸只清了一边时把机器人放到瑶台中心站 2.6 s——瑶台必须不开战；瑶台开战时两岸都要已肃清。
    ///      交战：自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住绕到看得见的地方，玄冰巨蟹 / 冰甲旋龟绕背打。玩家临时 +5000 生命。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 门旁清关宝箱。
    ///   4. 冰面：冰上以冲刺余速（9.9 m/s）抛出、不给输入，量滑行距离（要站在冰面牵引区上、牵引倍率 = 冰面预设、≥ 5 m 且 ≥ 岸上 4 倍）；
    ///      冰窟窿：站进去要在水里（> 0.5 m）、不算冰面、走路变慢。
    ///   5. 藏宝：渔营（无守军）发现 → 按 F → 宝箱；冻船（有伏兵）按 F → 伏兵开战 → 肃清 → 宝箱。
    ///   6. 走上二层玉阶，出口祭坛前按 F → 本关结算（下一关 2-4）。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map23Suite : PlaytestSuite
    {
        public override string Id => "map-2-3";
        /// <summary>2-3 瑶池冰湖（与编辑器里 Level_2_3.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L2_3_Yaochi.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 150f, ClearAllTimeout = 900f, BotSpeed = 11f, DashExit = 9.9f;
        const string PavilionId = "SM_Tripo_FrostLakePavilion";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        readonly List<EncounterSite> clearOrder = new();
        EncounterSite gate, westShore, eastShore;
        bool gateEarly;
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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 2-3？先 bridge.sh level 2-3）");
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
            var want = RunPlan.Get("2-3");
            var run = RunState.Current;
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"清关奖励 {want?.clearReward}，下一关 {RunPlan.Next(want)?.Label ?? "无"}");
            if (want == null) Fail("RunPlan 里没有 2-3");
            else if (stage == null || stage.code != "2-3") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 2-3）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 2-3 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var portal = FindAnyObjectByType<ExitPortal>();
            var caches = FindObjectsByType<CachePOI>();
            int iceZones = SurfaceZone.All.Count(z => z && z.lifetime <= 0 && z.profile.id == SurfaceProfile.Ice.id);
            int pools = WaterVolume.All.Count(w => w);
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，冰面牵引区 {iceZones} 条，冰窟窿水体 {pools} 处，藏宝 {caches.Length}，出口 {(portal ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 4)
            {
                Fail("目标图的必清场地应为 4 个");
                yield break;
            }
            if ((objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（冻船伏兵）");
            var required = objective.required.Where(s => s).ToList();
            var gated = required.Where(s => s.requires != null && s.requires.Any(r => r)).ToList();
            gate = gated.Count == 1 ? gated[0] : null;
            if (!gate || gate.requires.Length != 2 || gate.requires.Any(r => !required.Contains(r)))
            {
                Fail($"应当只有瑶台写 requires，且是另外两个必清场地（现在 {gated.Count} 个场地写了 requires）");
                yield break;
            }
            westShore = gate.requires[0];
            eastShore = gate.requires[1];
            Line($"开放顺序：「{gate.title}」requires = 「{westShore.title}」+「{eastShore.title}」，其余必清场地顺序不限");
            if (iceZones == 0) Fail("湖面没有冰面牵引区（SurfaceZone）");
            if (pools < 2) Fail($"冰窟窿水体只有 {pools} 处（至少 2 处大冰窟窿）");
            if (caches.Length != 2 || caches.Count(c => c.guard) != 1) Fail($"藏宝点 {caches.Length} 处、有守军的 {caches.Count(c => c.guard)} 处（应为 2 处：渔营无守军、冻船有伏兵）");
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见湖心亭
            var landmark = GameObject.Find("Landmark_LakePavilion");
            if (!landmark) Fail("没有湖心亭地标标记 Landmark_LakePavilion");
            else
            {
                bool seen = Visible(eye.position, landmark.transform.position, 6f, PavilionId);
                Line($"出生点 → 湖心亭（{Vector3.Distance(eye.position, landmark.transform.position):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到湖心亭（全图地标）");
                Aim(motor, eye, landmark.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map23_spawn");
            }

            // 主线可走：出生点 → 四个必清场地、出口
            var start = motor.transform.position;
            var goals = required.Select(s => (s.title, s.transform.position)).ToList();
            goals.Add(("出口", portal.transform.position - portal.transform.forward * 3.5f));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // ── 2. 机器人自由顺序清场 ──
            vitals.stats.Add("playtest_map23", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            EncounterSite.AnySiteCleared += OnCleared;
            EncounterSite.AnyWaveStarted += OnWave;
            try
            {
                bool probed = false;
                float t0 = Time.time;
                while (required.Any(s => s.phase != EncounterSite.Phase.Cleared) && Time.time - t0 < ClearAllTimeout)
                {
                    if (EncounterSite.ActiveSites.Count > 0)
                    {
                        yield return Fight(EncounterSite.ActiveSites[0]);
                        continue;
                    }
                    // 两岸只清了一边：瑶台必须还锁着
                    if (!probed && gate.phase == EncounterSite.Phase.Idle && (westShore.phase == EncounterSite.Phase.Cleared) != (eastShore.phase == EncounterSite.Phase.Cleared))
                    {
                        probed = true;
                        yield return LockProbe();
                        continue;
                    }
                    var next = required.Where(s => s.phase == EncounterSite.Phase.Idle && s.RequirementsMet())
                        .OrderBy(s => PathLength(motor.transform.position, s.transform.position)).FirstOrDefault();
                    if (!next)
                    {
                        Fail($"还有必清场地没清，但没有一个能开（{string.Join("、", required.Where(s => s.phase != EncounterSite.Phase.Cleared).Select(s => $"{s.title} {s.phase}"))}）");
                        break;
                    }
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
                if (!probed) Fail("没有做瑶台上锁检查（两岸从没出现只清了一边的时刻？）");
                ReportOrder(required);
                ReportElites();
                Line($"冰面上敌人滑倒 {SurfaceZone.Stumbles} 次");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
                EncounterSite.AnySiteCleared -= OnCleared;
                EncounterSite.AnyWaveStarted -= OnWave;
            }

            // ── 3. 目标完成 → 出口升起 → 清关宝箱 ──
            Line($"目标：{(objective.Complete ? "已完成" : "未完成")}（肃清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}）");
            if (!objective.Complete) Fail("必清场地全部肃清后目标没有完成");
            float rise0 = Time.time;
            while (portal.IsOpen && !portal.Risen && Time.time - rise0 < 5f) yield return null;
            yield return new WaitForSeconds(0.6f);
            Line($"出口：{(portal.IsOpen ? "已开启" : "未开启")}，升起 {portal.Rise:P0}，清关宝箱 {(portal.ClearChest ? portal.ClearChest.reward : "无")}");
            if (!portal.IsOpen) Fail("必清场地肃清后出口没有开启");
            else if (!portal.ClearChest) Fail("出口升起后没有落清关宝箱");

            // ── 4. 冰面打滑 / 冰窟窿 ──
            yield return IceCheck();
            yield return OpenWaterCheck();

            // ── 5. 藏宝 ──
            var camp = caches.FirstOrDefault(c => !c.guard);
            if (!camp) Fail("没有无守军的藏宝点（渔营）");
            else yield return CacheCheck(camp);
            var junk = caches.FirstOrDefault(c => c.guard);
            if (!junk) Fail("没有带伏兵的藏宝点（冻船）");
            else yield return CacheCheck(junk);

            // ── 6. 二层玉阶 → 出口 ──
            vitals.Heal(99999);
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Travel(front, 1.2f, false);
            Line($"走上二层玉阶：离出口 {Flat(motor.transform.position - front):F1} m，y = {motor.transform.position.y:F1}（出口 y = {portal.transform.position.y:F1}）");
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
            Shot(cam, "map23_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map23");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（主线断了？）");
            Line($"走路卡住跳点 {stalls} 次");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：坡道 / 码头 / 冰窟窿？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        void OnCleared(EncounterSite s)
        {
            if (!clearOrder.Contains(s)) clearOrder.Add(s);
        }

        /// <summary>瑶台开战（第一波）时两岸必须都已肃清</summary>
        void OnWave(EncounterSite s, int wave)
        {
            if (s != gate || gateEarly) return;
            if (westShore.phase != EncounterSite.Phase.Cleared || eastShore.phase != EncounterSite.Phase.Cleared) gateEarly = true;
        }

        /// <summary>两岸只清了一边：把机器人放到瑶台中心站 2.6 s（超过「圈里待满 2 s 不看视线」），瑶台不能开战；再放回原处</summary>
        IEnumerator LockProbe()
        {
            var back = motor.transform.position;
            var done = westShore.phase == EncounterSite.Phase.Cleared ? westShore : eastShore;
            Place(gate.transform.position);
            float t0 = Time.time;
            while (Time.time - t0 < 2.6f && gate.phase == EncounterSite.Phase.Idle) yield return null;
            bool locked = gate.phase == EncounterSite.Phase.Idle && !gate.RequirementsMet();
            Line($"上锁检查：只肃清了「{done.title}」，站在「{gate.title}」中心 {Time.time - t0:F1} s —— {(locked ? "没有开战 ✓" : $"开战了（{gate.phase}）")}");
            Shot(cam, "map23_gate_locked");
            if (!locked)
            {
                Fail($"两岸没清完，「{gate.title}」就开战了");
                yield break;
            }
            Place(back);
            yield return new WaitForSeconds(0.3f);
        }

        void ReportOrder(List<EncounterSite> required)
        {
            Line($"清场顺序：{string.Join(" → ", clearOrder.Where(required.Contains).Select(s => s.title))}");
            int g = clearOrder.IndexOf(gate), w = clearOrder.IndexOf(westShore), e = clearOrder.IndexOf(eastShore);
            if (gateEarly) Fail($"「{gate.title}」开战时两岸还没都肃清");
            if (g >= 0 && (w < 0 || e < 0 || g < w || g < e)) Fail($"「{gate.title}」在两岸之前肃清了（顺序 {g} / {w} / {e}）");
        }

        /// <summary>精英与词缀：东岸升格一只（小队词缀狂暴）、瑶台写死一只精英冰甲旋龟（坚盾）——词缀登记接上时核对词缀</summary>
        void ReportElites()
        {
            var elites = spawned.Where(r => r.elite).ToList();
            Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
            if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（东岸升格 1 只 + 瑶台旋龟 1 只）");
            var src = SquadAffixes.Source;
            if (src == null)
            {
                Line("词缀登记没有接上（SquadAffixes.Source 为空），跳过词缀核对");
                return;
            }
            foreach (var r in elites)
                if (string.IsNullOrEmpty(r.affix)) Fail($"精英 {r.id} 没有词缀");
            if (src.Exists("shielded") && !spawned.Any(r => r.elite && r.id == "xuangui" && r.affix == "shielded"))
                Fail("瑶台的精英冰甲旋龟没有带「坚盾」词缀");
        }

        /// <summary>
        /// D14：没有空气墙——Ignore Raycast 层上的实体碰撞体只有软边界的兜底环（离等值线 ≥ failsafe − 3 m）；边界本身是雪崖（地形），
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
                if ((ai is FrostCrabAI || ai is XuanGuiAI || ai is TombBeastAI) && Time.time >= flankAt)
                {
                    // 巨蟹的巨钳、旋龟的冰壳挡在正面：像玩家一样绕到背后打背缝 / 蛇头
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
                    Shot(cam, $"map23_combat_{Slug(site)}");
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

        // ───────────── 冰面 / 冰窟窿 ─────────────

        /// <summary>冰上（探针 Probe_IceSlide）与岸上（Probe_LandSlide，出生平台）各以冲刺余速抛出一次，比滑行距离；冰上要站在冰面牵引区上、牵引倍率 = 冰面预设</summary>
        IEnumerator IceCheck()
        {
            var iceProbe = GameObject.Find("Probe_IceSlide");
            var landProbe = GameObject.Find("Probe_LandSlide");
            if (!iceProbe || !landProbe)
            {
                Fail("没有冰面滑行探针（Probe_IceSlide / Probe_LandSlide，重新生成关卡）");
                yield break;
            }
            float land = 0, ice = 0, accel = 1, friction = 1;
            bool onIce = false;
            yield return SlideRun(landProbe.transform, v => land = v, null);
            yield return SlideRun(iceProbe.transform, v => ice = v, () =>
            {
                if (!SurfaceZone.PlayerOnSurface) return;
                onIce = true;
                accel = motor.Frame.groundAccelMult;
                friction = motor.Frame.groundFrictionMult;
            });
            Line($"冰面：{DashExit} m/s 抛出、不给输入，岸上滑 {land:F2} m，冰上滑 {ice:F2} m；冰上运动帧的地面牵引 加速 ×{accel:F2}、刹车 ×{friction:F2}（{SurfaceZone.PlayerSurface.title}）");
            if (!onIce) Fail("冰湖上 SurfaceZone.PlayerOnSurface 一直是 false（湖面没铺上冰面牵引区？）");
            else if (Mathf.Abs(accel - SurfaceProfile.Ice.accel) > 0.02f || Mathf.Abs(friction - SurfaceProfile.Ice.friction) > 0.02f)
                Fail($"冰湖上的地面牵引 ×{accel:F2} / ×{friction:F2}，应为冰面预设 ×{SurfaceProfile.Ice.accel} / ×{SurfaceProfile.Ice.friction}");
            if (ice < 5f || ice < land * 4f) Fail($"冰面滑行 {ice:F2} m 不够（岸上 {land:F2} m；应 ≥ 5 m 且 ≥ 4 倍）");
            else Line("✓ 冰湖：冲刺余速滑得远");
            Shot(cam, "map23_ice");
        }

        /// <summary>站到 probe、面朝它的前方停稳，再以冲刺余速沿前方抛出去、不给输入，量滑到停下的水平距离</summary>
        IEnumerator SlideRun(Transform probe, System.Action<float> result, System.Action each)
        {
            var dir = probe.forward;
            dir.y = 0;
            dir.Normalize();
            motor.Teleport(probe.position + Vector3.up * 0.05f, Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(0.35f);
            var p0 = motor.transform.position;
            motor.Launch(dir * DashExit);
            float t = 0;
            while (t < 4f)
            {
                yield return null;
                t += Time.deltaTime;
                each?.Invoke();
                if (t > 0.1f && Flat(motor.Velocity) < 0.05f) break;
            }
            result(Flat(motor.transform.position - p0));
        }

        /// <summary>站进冰窟窿（探针 Probe_OpenWater）：要在水里、不算冰面、走路变慢；再出来</summary>
        IEnumerator OpenWaterCheck()
        {
            var probe = GameObject.Find("Probe_OpenWater");
            if (!probe)
            {
                Fail("没有冰窟窿探针 Probe_OpenWater");
                yield break;
            }
            var outside = motor.transform.position;
            Place(probe.transform.position);
            yield return new WaitForSeconds(0.6f);
            float depth = WaterVolume.PlayerDepth, slow = motor.Frame.speedMult;
            bool onIce = SurfaceZone.PlayerOnSurface;
            Line($"冰窟窿：水深 {depth:F2} m，走路速度 ×{slow:F2}，{(onIce ? "还算在冰面上" : "不算冰面")}，脚下 y = {motor.transform.position.y:F2}");
            Shot(cam, "map23_ice_hole");
            if (depth < 0.5f) Fail($"站在冰窟窿里水深只有 {depth:F2} m（应 > 0.5 m：WaterVolume 没放 / 碗没挖够）");
            if (onIce) Fail("冰窟窿里还算冰面（冰面牵引区的竖直带盖到了水底）");
            if (slow > 0.85f) Fail($"冰窟窿里走路速度 ×{slow:F2}（应明显变慢）");
            Place(outside);
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 藏宝 ─────────────

        /// <summary>走到藏宝点旁发现 → 按 F；有伏兵的先打伏兵（场地开战 → 肃清），宝箱随后出现</summary>
        IEnumerator CacheCheck(CachePOI cache)
        {
            var c = cache.transform.position;
            vitals.Heal(99999);
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
            if (cache.guard)
            {
                var guard = cache.guard;
                Line($"  调查：{(guard.phase != EncounterSite.Phase.Idle ? $"惊动伏兵「{guard.title}」" : "伏兵没有开战")}");
                if (guard.phase == EncounterSite.Phase.Idle) Fail($"调查「{cache.title}」后伏兵没有开战");
                else
                {
                    int before = spawned.Count;
                    EncounterSite.AnySpawned += OnSpawned;
                    try
                    {
                        if (guard.phase == EncounterSite.Phase.Active) yield return Fight(guard);
                    }
                    finally
                    {
                        EncounterSite.AnySpawned -= OnSpawned;
                    }
                    float g0 = Time.time;
                    while (!cache.Claimed && Time.time - g0 < 3f) yield return null;
                    var elite = spawned.Skip(before).FirstOrDefault(r => r.elite);
                    Line($"  伏兵：{guard.phase}，精英 {(!string.IsNullOrEmpty(elite.id) ? $"{elite.id}（{(string.IsNullOrEmpty(elite.affix) ? "无词缀" : elite.affix)}）" : "没出")}");
                }
            }
            Line($"  {(cache.Claimed ? $"宝箱出现（{cache.reward}）" : "没有宝箱")}");
            if (!cache.Claimed || !cache.RewardChest) Fail($"调查藏宝「{cache.title}」后没有出宝箱");
            Shot(cam, cache.guard ? "map23_cache_junk" : "map23_cache_camp");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（坡道、码头、冰面的牵引都是真的），
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（亭檐、桅杆、角楼不会接住人；冰窟窿里落到碗底，水体没有碰撞）</summary>
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
