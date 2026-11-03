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
    /// 3-3 铸范大坊 · 铸范梯坊冒烟（bridge.sh playtest map-3-3；场景 L3_3_Foundry，docs/level-design/maps/3-3.md 第 9 节，ch3-v2.md 7.4「map-3-3」）：
    ///   1. 开局：SceneFlow 认领的关卡是 3-3、局难度 = RunPlan 的 2.92；目标图（必清 5 + 可选 1，④ 要求 ② 且开局不自动触发，前庭要求 ④）、2 处藏宝、
    ///      场景里没有出口（领主战结算后才立）、领主战关着（FoundryLordGate 没解锁）、风闸卡死、熔铜渠（铸坊渠的涨落关着、神范台的渠岸是干的）；
    ///      没有空气墙；出生点看得见神范；出生点到五处必清场地、风闸、神范台入场点的 NavMesh 路径都完整（桥是唯一的走位线）。
    ///      提前踏上神范台：只提示「先肃清铸坊」，不开打。
    ///   2. 机器人清场：每次挑 NavMesh 路程最近、能触发的必清场地，用角色控制器沿 NavMesh 真走过去（桥、坡道都是真的），路上被别处触发就先打那处（B1 瀑下桥的路遇也这样打）；
    ///      交战时自动瞄最近的敌人（四成打弱点）射击、隔 4 s 放技能，被挡住绕到看得见的地方。玩家临时 +5000 生命、伤害 ×3（第三章的构筑）。
    ///      ② 肃清前按风闸：拉不动；只剩 ④ 时走上风闸台拉开风闸 → 风箱鼓起、第二次进殿可以触发、铸坊渠开始涨落；回殿后炉门往风箱道喷火（地火出现）。
    ///      每处 150 s 内肃清，肃清后场地宝箱要出现（不开）。
    ///      ③ 浇包吊坊（熔流闸 S4）：开打后等有敌人走进浇铸槽（最多 14 s），站到浇铸槽旁、真开枪射断吊钩 → 浇包倾倒 → 熔流冲 6 s；
    ///      实战里一只没烧到，就刷一只眩晕住的祸斗站在槽里再放一次——熔流闸至少烧死 1 只。
    ///   3. 必清全部肃清 → 目标完成 → 领主战解锁（BossEncounter 启用）。
    ///   4. 风闸台的炉工私藏：发现 → 按 F → 宝箱出现（无人看守）。
    ///   5. 领主战：前庭期间不得提前开战；沿桥到西南入场区 → 熔铁闸升起封桥 → 熔心魔将登场 → 冒烟里直接打死（招式、阶段由 boss-warlord 套件验）
    ///      → 结算：首领宝箱、回满、熔铁闸落下、神范前的清关宝箱（RunPlan 3-3：秘卷）、出口升起。
    ///   6. 走到神范前的出口按 F → 本关结算（下一关 3-4）。
    /// 走路的 NavMesh 路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class Map33Suite : PlaytestSuite
    {
        /// <summary>
        /// 机器人走路的导航查询：只查人形代理（LavaField.WalkerFilter——3-3 还有火鼍的 LavaSwimmer 网格，不带代理类型会采到它，路径就成了「不完整」），
        /// 且只走干地：神范台的浅渠是 Lava 区但走得下去，不排除时路径会抄近路直穿浅渠，角色控制器一进熔岩就被托回岸上、卡住跳点
        /// </summary>
        static NavMeshQueryFilter Dry => LavaField.WalkerFilter(LavaField.DryAreaMask);

        public override string Id => "map-3-3";
        /// <summary>3-3 铸范大坊（与编辑器里 Level_3_3.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/L3_3_Foundry.unity";

        /// <summary>有火鼍的场地多给的时间（它潜在渠里时 ×0.5，要引它上岸）、只剩潜着的火鼍多久后去引</summary>
        const float ReadyTimeout = 90f, SiteTimeout = 150f, TuoExtra = 60f, LureAfter = 8f, ClearAllTimeout = 1100f, BotSpeed = 11f;
        /// <summary>神范的白盒 / 正式件名字前缀（构建器把占位白盒改名成「id · 神范 (Placeholder)」）</summary>
        const string MouldId = "SM_Tripo_InfernoCastingMould";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        List<LavaSluice> sluices = new();
        int partialPaths, skillCasts, stalls, lures, jumps;
        float clearStart;

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
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}（场景不是 3-3？先 bridge.sh level 3-3）");
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
            var want = RunPlan.Get("3-3");
            var run = RunState.Current;
            if (run != null)
                foreach (var key in run.flags.Keys.Where(k => k.StartsWith("boss_cleared:")).ToList()) run.flags.Remove(key);
            Line($"关卡：{stage?.Label ?? "（不在 RunPlan 里）"}，局难度 {(run != null ? run.difficulty.ToString("F2") : "—")}（RunPlan {want?.difficulty:F2}），" +
                 $"清关奖励 {want?.clearReward}，下一关 {RunPlan.Next(want)?.Label ?? "无"}");
            if (want == null) Fail("RunPlan 里没有 3-3");
            else if (stage == null || stage.code != "3-3") Fail($"SceneFlow 认领的关卡是 {stage?.code ?? "无"}（应为 3-3）");
            else if (run != null && Mathf.Abs(run.difficulty - want.difficulty) > 0.01f) Fail($"局难度 {run.difficulty:F2}，应为 3-3 的 {want.difficulty:F2}");

            var objective = FindAnyObjectByType<LevelObjective>();
            var caches = FindObjectsByType<CachePOI>();
            var wind = FindAnyObjectByType<FoundryWindGate>();
            var lordGate = FindAnyObjectByType<FoundryLordGate>();
            var enc = lordGate ? lordGate.encounter : FindAnyObjectByType<BossEncounter>(FindObjectsInactive.Include);
            if (enc) enc.ResetForTests();
            var channels = FindAnyObjectByType<FoundryChannels>();
            var portals = FindObjectsByType<ExitPortal>();
            sluices = FindObjectsByType<LavaSluice>().OrderBy(x => x.title).ToList();
            foreach (var sl in sluices) sl.ResetForTests();
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，藏宝 {caches.Length}，场景出口 {portals.Length}，" +
                 $"风闸 {(wind ? wind.Phase.ToString() : "无")}，领主战 {(enc ? $"{enc.bossId}（{(enc.enabled ? "开着" : "关着")}）" : "无")}，" +
                 $"神范台熔铜渠 {channels?.Count ?? 0} 片，熔岩 {LavaVolume.Live.Count} 片");
            if (!objective || objective.RequiredTotal != 5) Fail("目标图的必清场地应为 5 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（废范守军）");
            var second = wind ? wind.secondVisit : null;
            if (!wind || !second) Fail("没有风闸，或风闸没接上第二次进殿的场地");
            else
            {
                if (second.autoTrigger) Fail("第二次进殿开局就能自动触发（应等风闸）");
                if (second.requires == null || !second.requires.Contains(wind.firstVisit)) Fail("第二次进殿没有要求第一次进殿已清");
                if (wind.Phase == FoundryWindGate.State.Pulled) Fail("风闸开局就拉开了");
            }
            if (caches.Length != 2) Fail($"藏宝点 {caches.Length} 处（应为 2：废范残兵、炉工私藏）");
            if (portals.Length != 0) Fail($"场景里有 {portals.Length} 个出口（3-3 的出口由领主战结算后立）");
            if (!lordGate || !enc) Fail("没有领主战（FoundryLordGate / BossEncounter）");
            else if (enc.enabled || lordGate.Unlocked) Fail("领主战开局就开着（应等四处必清场地肃清）");
            if (!channels || channels.Count < 5) Fail("神范台没有熔铜渠（FoundryChannels）");
            else if (channels.Flooding) Fail("神范台的熔铜渠开局就在涨");
            var tides = wind ? wind.tides.Where(v => v).ToList() : new List<LavaVolume>();
            if (tides.Count == 0) Fail("风闸没接上铸坊渠（拉开后涨落的那几段）");
            else if (tides.Any(v => v.tide.enabled)) Fail("铸坊渠开局就在自动涨落（应等风闸）");
            NoAirWall();
            Line($"熔流闸 {sluices.Count} 道：{string.Join("、", sluices.Select(x => $"{x.title}（{x.trigger}，熔流道 {x.Length:F0} m，吊钩 {(x.hook ? "有" : "无")}）"))}");
            if (sluices.Count != 2) Fail($"熔流闸 {sluices.Count} 道（应 2：③ 南浇包、北浇包）");

            // 地标：出生点看得见神范
            var mould = FindNamed(MouldId, "神范");
            if (!mould) Fail("场景里没有神范");
            else
            {
                // 神范在 225 m 外、越过横渠南岸的崖边才露出上半截：瞄它顶部（梯坊图里出生点比神范台低 8.5 m）
                var top = TopOf(mould, 0.95f);
                bool seen = Visible(eye.position, top, 8f, MouldId);
                Line($"出生点 → 神范（{Vector3.Distance(eye.position, top):F0} m）：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("出生点看不到神范（全图地标）");
                Aim(motor, eye, top);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map33_spawn");
            }

            // 主线可走：出生点 → 四处必清场地、风闸、神范台入场点
            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            if (wind) goals.Add(("风闸", WindFront(wind)));
            if (enc && enc.arena) goals.Add(("神范台入场点", enc.arena.PlayerEntryPoint));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // 提前踏上神范台：只提示，不开打
            if (lordGate && enc && enc.arena)
            {
                int hints0 = lordGate.LockedHints;
                Place(enc.arena.PlayerEntryPoint);
                yield return new WaitForSeconds(0.6f);
                Line($"提前踏上神范台：提示 +{lordGate.LockedHints - hints0}，领主战 {enc.State}（{(enc.enabled ? "开着" : "关着")}）");
                if (lordGate.LockedHints <= hints0) Fail("提前踏上神范台没有提示「先肃清铸坊」");
                if (enc.enabled || enc.State != BossEncounter.Phase.Waiting) Fail("目标没完成就能在神范台开打");
                Place(start);
                yield return new WaitForSeconds(0.3f);
            }

            // ② 肃清前风闸拉不动
            if (wind && wind.firstVisit && wind.firstVisit.phase != EncounterSite.Phase.Cleared)
            {
                wind.Interact();
                Line($"② 肃清前按风闸：{wind.Phase}（提示「{wind.Prompt}」）");
                if (wind.Phase == FoundryWindGate.State.Pulled) Fail("第一次进殿还没肃清，风闸就拉开了");
            }

            // ── 2. 机器人清场 ──
            vitals.stats.Add("playtest_map33", Stat.MaxHp, 5000);
            vitals.stats.Add("playtest_map33", Stat.DamagePct, 2f);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            LavaField.PlayerEntered += OnLavaEntered;
            if (SafeGround.Instance) SafeGround.Instance.Recovered += OnRecovered;
            bool windChecked = false;
            try
            {
                var required = objective ? objective.required.Where(s => s).ToList() : FindObjectsByType<EncounterSite>().Where(s => !s.optional).ToList();
                float t0 = Time.time;
                clearStart = Time.time;
                while (required.Any(s => s.phase != EncounterSite.Phase.Cleared) && Time.time - t0 < ClearAllTimeout)
                {
                    if (EncounterSite.ActiveSites.Count > 0)
                    {
                        yield return Fight(EncounterSite.ActiveSites[0], wind);
                        continue;
                    }
                    var next = required.Where(s => s.phase == EncounterSite.Phase.Idle && s.autoTrigger && s.RequirementsMet())
                        .OrderBy(s => PathLength(motor.transform.position, s.transform.position)).FirstOrDefault();
                    if (!next)
                    {
                        // 只剩第二次进殿：去风闸台拉开风闸
                        if (wind && wind.Phase != FoundryWindGate.State.Pulled && !windChecked)
                        {
                            windChecked = true;
                            yield return WindCheck(wind);
                            continue;
                        }
                        Fail($"没有能触发的必清场地了（剩 {string.Join("、", required.Where(s => s.phase != EncounterSite.Phase.Cleared).Select(s => $"{s.title}：{s.phase}，autoTrigger {s.autoTrigger}"))}）");
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
                var elites = spawned.Where(r => r.elite).ToList();
                Line($"出场 {spawned.Count} 只，精英 {elites.Count} 只：{string.Join("、", elites.Select(r => $"{r.id}（{(string.IsNullOrEmpty(r.affix) ? "无词缀" : r.affix)}）"))}");
                if (elites.Count < 3) Fail($"必清场地只出了 {elites.Count} 只精英（③ 迅捷祸斗 + ④ 坚盾铁牛 + ⑥ 狂暴马面）");
                foreach (var id in new[] { "founder", "nuo", "iron_ox", "fire_crow", "firecracker" })
                    if (!spawned.Any(r => r.id == id)) Fail($"3-3 没有出 {id}（第三章登场表：铜匠、傩巫在 3-3 教）");
                Line($"熔流闸：{string.Join("、", sluices.Select(x => $"{x.title} {x.Phase}，放 {x.Fired} 次、烧死 {x.Kills} 只"))}");
                if (sluices.Count == 0) Fail("场景里没有熔流闸（③ 浇包吊坊的两口浇包）");
                else if (sluices.Sum(x => x.Kills) < 1) Fail("熔流闸一只敌人都没烧死");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
                LavaField.PlayerEntered -= OnLavaEntered;
                if (SafeGround.Instance) SafeGround.Instance.Recovered -= OnRecovered;
                if (lavaLog.Count > 0) Line($"熔岩记录：{string.Join("；", lavaLog)}");
            }
            if (wind)
            {
                Line($"风闸：{wind.Phase}，炉门喷火 {wind.JetsFired} 轮、地火 {wind.FiresSpawned} 片，风箱 × {wind.BellowsScale:F2}");
                if (wind.Phase != FoundryWindGate.State.Pulled) Fail("清完全图风闸也没拉开");
                else if (wind.JetsFired == 0) Fail("风闸拉开后回到鼓风正殿，炉门一次火都没喷");
            }

            // ── 3. 目标完成 → 领主战解锁 ──
            if (objective)
            {
                Line($"目标：{(objective.Complete ? "已完成" : "未完成")}（肃清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}）");
                if (!objective.Complete) Fail("必清场地全部肃清后目标没有完成");
            }
            yield return null;
            if (lordGate)
            {
                Line($"领主战：{(lordGate.Unlocked ? "已解锁" : "没解锁")}，BossEncounter {(enc && enc.enabled ? "开着" : "关着")}");
                if (!lordGate.Unlocked || !enc || !enc.enabled) Fail("目标完成后领主战没有解锁");
            }

            // ── 4. 炉工私藏（无人看守）──
            var forgeCache = caches.FirstOrDefault(c => !c.guard);
            if (!forgeCache) Fail("没有无守军的藏宝点（炉工私藏）");
            else yield return CacheCheck(forgeCache);

            // ── 5. 领主战 ──
            if (enc && enc.enabled && enc.arena) yield return LordCase(enc, lordGate, channels);

            // ── 6. 出口 ──
            var portal = enc ? enc.OpenedExit : null;
            if (!portal) Fail("领主战结算后没有出口");
            else
            {
                vitals.Heal(99999);
                var front = portal.transform.position - portal.transform.forward * 3.5f;
                yield return Travel(front, 1.2f, false);
                Line($"走到神范前：离出口 {Flat(motor.transform.position - front):F1} m，y = {motor.transform.position.y:F1}");
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
                Shot(cam, "map33_complete");
                GameSession.Instance?.SetModal(false);
            }
            vitals.stats.Remove("playtest_map33");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次，踩进熔岩 {(LavaField.Instance ? LavaField.Instance.Entries : 0)} 次、敌人烧死 {(LavaField.Instance ? LavaField.Instance.Burned : 0)} 只");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的 NavMesh 路径有 {partialPaths} 次不完整（桥断了？）");
            Line($"走路卡住跳点 {stalls} 次，引火鼍上岸 {lures} 次");
            Line($"总时长（开始清场 → 出口，机器人 11 m/s、伤害 ×3）：{Time.time - clearStart:F0} s（ch3-v2 风险 7：真人约 9–11 min）");
            if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：桥头 / 坡道？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        readonly List<string> lavaLog = new();
        void OnLavaEntered(Vector3 feet)
        {
            if (lavaLog.Count < 12) lavaLog.Add($"踩进熔岩 @ {feet}（{Time.time - clearStart:F0} s）");
        }
        void OnRecovered(Vector3 to)
        {
            if (lavaLog.Count < 24) lavaLog.Add($"托回 → {to}");
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

        // ───────────── 风闸 ─────────────

        /// <summary>风闸前的站位：拉杆朝向的前方 2 m（风闸台上）</summary>
        static Vector3 WindFront(FoundryWindGate g) => g.transform.position + g.transform.forward * 2f;

        IEnumerator WindCheck(FoundryWindGate wind)
        {
            Line($"只剩「{wind.secondVisit?.title}」：去风闸台（路程 {PathLength(motor.transform.position, WindFront(wind)):F0} m）");
            yield return Travel(WindFront(wind), 1.2f, false);
            Place(WindFront(wind));
            yield return new WaitForSeconds(0.3f);
            Aim(motor, eye, wind.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as FoundryWindGate != wind) Fail($"站在风闸前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            Line($"风闸提示：{wind.Prompt}（{wind.Phase}）");
            float scale0 = wind.BellowsScale;
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.4f);
            if (wind.Phase != FoundryWindGate.State.Pulled)
            {
                Fail($"按 F 没拉开风闸（{wind.Phase}）");
                wind.Pull(true);
            }
            yield return new WaitForSeconds(2.5f);
            var tides = wind.tides.Where(v => v).ToList();
            Line($"拉开风闸：风箱 × {scale0:F2} → {wind.BellowsScale:F2}，第二次进殿 autoTrigger {wind.secondVisit?.autoTrigger}，铸坊渠涨落 {tides.Count(v => v.tide.enabled)}/{tides.Count}");
            if (!(wind.BellowsScale > scale0 + 0.2f)) Fail("拉开风闸后风箱没有鼓起来");
            if (wind.secondVisit && !wind.secondVisit.autoTrigger) Fail("拉开风闸后第二次进殿还是不能触发");
            if (tides.Any(v => !v.tide.enabled)) Fail("拉开风闸后有铸坊渠没开始涨落");
            Aim(motor, eye, wind.secondVisit ? wind.secondVisit.transform.position + Vector3.up * 3f : wind.Focus);
            yield return null;
            Shot(cam, "map33_windgate");
        }

        // ───────────── 交战 ─────────────

        IEnumerator Fight(EncounterSite site, FoundryWindGate wind)
        {
            float limit = site.optional ? 70f : SiteTimeout + (HasTuo(site) ? TuoExtra : 0);
            float start = Time.time, flankAt = 0, skillAt = Time.time + 1f, lureAt = 0, lureHold = 0, tuoOnly = 0;
            bool shotMid = false;
            int kills0 = Runner.kills, fires0 = wind ? wind.FiresSpawned : 0;
            // ③ 浇包吊坊：熔流闸
            var siteSluices = sluices.Where(x => x && Flat(x.transform.position - site.transform.position) < site.arenaRadius + 12f).ToList();
            bool sluiceUsed = siteSluices.Count == 0;
            float dmg0 = Runner.playerDamage;
            Runner.killsById.Clear();
            Line($"遭遇「{site.title}」开始：{site.Total} 只，{site.WaveCount} 波，升格精英 {site.Promoted}（玩家 {motor.transform.position}，离场地中心 {Flat(motor.transform.position - site.transform.position):F1} m）");
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - start < limit)
            {
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                if (!sluiceUsed && Time.time - start > 2f)
                {
                    var hot = siteSluices.FirstOrDefault(x => x.CanRelease && EnemyAI.All.Any(e => e && !e.Dead && !LavaField.IsImmune(e) && x.Covers(e.transform.position)));
                    if (hot || Time.time - start > 14f)
                    {
                        sluiceUsed = true;
                        yield return FireSluice(hot ? hot : siteSluices.FirstOrDefault(x => x.CanRelease), hot ? "有敌人走进浇铸槽" : "等了 14 s 没有敌人进槽");
                        continue;
                    }
                }
                var target = NearestFoe(eye.position);
                if (!target)
                {
                    weapons.testFire = false;
                    if (site.PendingCount > 0 && Flat(motor.transform.position - site.transform.position) > site.arenaRadius)
                        yield return Step(site.transform.position, 6f);
                    yield return null;
                    continue;
                }
                // 只剩潜在渠里的火鼍（×0.5、贴着渠壁难打）：退到场地里离熔岩最远的地方，它躲岸 8 s 后会扑上岸来
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
                if (Vector3.Distance(eye.position, aim) > 22f && !(sunk && Time.time < lureHold)) yield return Step(target.transform.position, 6f);
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
                    Shot(cam, $"map33_combat_{Slug(site)}");
                }
                yield return null;
            }
            weapons.testFire = false;
            var byId = string.Join("、", Runner.killsById.Select(kv => $"{kv.Key}×{kv.Value}"));
            bool cleared = site.phase == EncounterSite.Phase.Cleared;
            string fires = wind && site == wind.secondVisit ? $"，炉门地火 +{wind.FiresSpawned - fires0}" : "";
            Line($"  {(cleared ? "已肃清" : "超时")}：用时 {Time.time - start:F0} s，击杀 {Runner.kills - kills0}（{byId}），敌人对玩家伤害 {Runner.playerDamage - dmg0:F0}{fires}");
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
                SpawnDiagnostics(site);
                EnemyRegistry.PurgeAll();
                float p0 = Time.time;
                while (site.phase != EncounterSite.Phase.Cleared && Time.time - p0 < 3f) yield return null;
                // 卡住的可选 / 路遇场地关掉，免得机器人一直回来打它
                if (site.phase != EncounterSite.Phase.Cleared && site.optional) site.gameObject.SetActive(false);
                yield break;
            }
            if (siteSluices.Count > 0 && siteSluices.Sum(x => x.Kills) == 0)
            {
                var spare = siteSluices.FirstOrDefault(x => x.CanRelease) ?? siteSluices[0];
                Line($"  熔流闸在实战里没烧到敌人：用「{spare.title}」做一次定点验证（刷一只眩晕的祸斗站在槽里）");
                yield return SluiceDummy(spare);
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

        /// <summary>刷不出怪时的诊断：待出场数、全场在场 / 休眠数、玩家位置、每个站位的导航采样和到玩家的路</summary>
        void SpawnDiagnostics(EncounterSite site)
        {
            var me = motor.transform.position;
            Line($"  诊断：待出场 {site.PendingCount}，全场在场 {EnemyRegistry.Count}、休眠 {EncounterSite.DormantCount}，玩家 {me}，场地中心 {site.transform.position}（水平 {Flat(me - site.transform.position):F1} m）");
            var sg = SafeGround.Instance;
            string below = Physics.Raycast(me + Vector3.up, Vector3.down, out var bh, 4f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? $"{bh.collider.name} y {bh.point.y:F2}" : "（下面没有碰撞体）";
            Line($"  玩家：熔岩里 {LavaField.IsLava(me)}，下沉中 {(sg && sg.Sinking)}，托回 {(sg ? sg.Recoveries : -1)} 次，上一个安全点 {(sg ? sg.LastSafe : Vector3.zero)}，脚下 {below}，生命 {vitals.health:F0}/{vitals.MaxHealth:F0}");
            var walker = LavaField.WalkerFilter();
            bool goalOk = NavMesh.SamplePosition(me, out var g, 6f, walker);
            foreach (var a in site.anchors ?? System.Array.Empty<Transform>())
            {
                if (!a) continue;
                bool on = NavMesh.SamplePosition(a.position, out var h, 2.5f, walker);
                string path = "—";
                if (on && goalOk)
                {
                    var np = new NavMeshPath();
                    NavMesh.CalculatePath(h.position, g.position, walker, np);
                    path = np.status.ToString();
                }
                Line($"    站位 {a.name} {a.position}：离玩家 {Flat(a.position - me):F1} m，导航 {(on ? $"✓ y {h.position.y:F2}" : "✗")}，到玩家 {path}");
            }
        }

        /// <summary>
        /// 最近的活敌人（只认 EnemyAI：基类的 NearestEnemy 认所有 Damageable，会去追 ① 的可破坏铸范、③ 的吊钩——
        /// 铸范只吃爆炸 / 近战，子弹打不坏，机器人就一直在 ① 里对着它开枪，别处的场地刷不出怪）
        /// </summary>
        static Damageable NearestFoe(Vector3 from)
        {
            Damageable best = null;
            float bestD = float.MaxValue;
            foreach (var e in EnemyAI.All)
            {
                if (!e || e.Dead || !e.Health || e.Health.Dead || e.Health.untargetable) continue;
                float d = (e.transform.position - from).sqrMagnitude;
                if (d >= bestD) continue;
                bestD = d;
                best = e.Health;
            }
            return best;
        }

        static bool HasTuo(EncounterSite site) =>
            site.spec?.waves != null && site.spec.waves.Any(w => w?.entries != null && w.entries.Any(e => e != null && e.enemy == "tuo"));

        /// <summary>场地里离熔岩最远的干地导航点（中心 + 5 / 10 / 15 / 20 m 四圈各 12 个方向；同 Map31Suite）</summary>
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

        /// <summary>目标周围 8–12 m、干地导航网格上、离熔岩 ≥ 1.5 m、眼高能直接看到瞄准点的位置（基类的 SightSpot 不带代理过滤，会落到渠底）</summary>
        static bool DrySightSpot(Damageable target, Vector3 aim, out Vector3 spot)
        {
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(8f, 12f);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, Dry)) continue;
                if (LavaField.IsLava(hit.position) || LavaField.NearLava(hit.position, 1.5f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        // ───────────── 熔流闸（S4）─────────────

        /// <summary>
        /// 放一道熔流闸：站到浇铸槽旁（离两条熔流道都 ≥ 0.8 m 的干地）、瞄吊钩真开枪（3 s 内射不断记不合格并强制放）；看着熔流冲完（预警 + 6 s），截一张图
        /// </summary>
        IEnumerator FireSluice(LavaSluice s, string why)
        {
            if (!s)
            {
                Fail("没有能放的熔流闸");
                yield break;
            }
            weapons.testFire = false;
            var stand = SluiceStand(s);
            Place(stand);
            yield return null;
            int k0 = s.Kills;
            bool viaHook = s.hook && !s.hook.IsBroken && s.trigger != LavaSluice.Trigger.Lever;
            if (viaHook)
            {
                float t0 = Time.time;
                while (s.Phase == LavaSluice.State.Ready && Time.time - t0 < 3f)
                {
                    Aim(motor, eye, s.hook.Center);
                    if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                    weapons.testFire = weapons.Active != null && (weapons.Active.def.mode != FireMode.Semi || !weapons.testFire);
                    yield return null;
                }
                weapons.testFire = false;
                if (s.Phase == LavaSluice.State.Ready)
                {
                    Fail($"站在 {stand} 朝「{s.title}」的吊钩开了 3 s 枪没射断（吊钩命中 {s.hook.Taken} 次、挡下 {s.hook.Blocked} 次）");
                    s.Release(true);
                }
            }
            else s.Release(true);
            Line($"  熔流闸「{s.title}」（{why}）：{(viaHook ? $"射断吊钩（{s.hook.BrokenBy}）" : "直接放")}，阶段 {s.Phase}，熔流道 {s.Length:F0} m");
            float f0 = Time.time;
            bool snap = false;
            while ((s.Phase == LavaSluice.State.Warning || s.Phase == LavaSluice.State.Flowing) && Time.time - f0 < s.warn + s.duration + 2f)
            {
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (!snap && s.Phase == LavaSluice.State.Flowing && Time.time - s.FlowStartedAt > 1.4f)
                {
                    snap = true;
                    Aim(motor, eye, s.PointAt(s.Length * 0.45f));
                    yield return null;
                    Shot(cam, "map33_sluice");
                }
                yield return null;
            }
            int live = s.Volumes.Count(v => v && v.gameObject.activeSelf);
            Line($"  熔流：{Time.time - f0:F1} s，熔岩段 {s.Volumes.Count}（还开着 {live}），烧死 {s.Kills - k0} 只，阶段 {s.Phase}");
            if (s.Volumes.Count == 0) Fail($"熔流闸「{s.title}」放了但没有熔岩段");
        }

        /// <summary>熔流道旁、离两条熔流道都 ≥ 0.8 m 的干地（看得见吊钩，熔流冲不到）</summary>
        Vector3 SluiceStand(LavaSluice s)
        {
            var a = s.PointAt(s.Length * 0.35f);
            var b = s.PointAt(s.Length * 0.35f + 2f);
            var dir = Flat3(b - a).normalized;
            var side = new Vector3(dir.z, 0, -dir.x);
            foreach (float sign in new[] { 1f, -1f })
            {
                var p = a + side * (sign * (s.width * 0.5f + 1.6f));
                if (sluices.Any(x => x.Covers(p, 0.8f))) continue;
                if (NavMesh.SamplePosition(p, out var hit, 2f, Dry) && !LavaField.IsLava(hit.position)) return hit.position;
            }
            return a + side * (s.width * 0.5f + 2f);
        }

        static Vector3 Flat3(Vector3 v) => new(v.x, 0, v.z);

        /// <summary>定点验证：刷一只祸斗站在熔流道中段、眩晕 8 s，放熔流——它要被烧死（熔流闸烧死计数 +1）</summary>
        IEnumerator SluiceDummy(LavaSluice s)
        {
            var p = s.PointAt(s.Length * 0.6f);
            if (!NavMesh.SamplePosition(p, out var hit, 2f, Dry))
            {
                Fail($"熔流闸「{s.title}」的熔流道中段 {p} 不在导航网格上");
                yield break;
            }
            var e = EnemyRoster.Spawn("huodou", hit.position, Quaternion.identity, 1, false);
            if (!e)
            {
                Fail("熔流闸定点验证：刷不出祸斗");
                yield break;
            }
            yield return new WaitForSeconds(1f);
            if (e && !e.Dead)
            {
                EnemyStatus.Stun(e.Health, 8f);
                var agent = e.GetComponent<NavMeshAgent>();
                if (agent && agent.enabled) agent.Warp(hit.position);
            }
            if (s.Phase != LavaSluice.State.Ready) s.ResetForTests();
            int k0 = s.Kills;
            yield return FireSluice(s, "定点验证");
            bool dead = !e || e.Dead;
            Line($"  定点验证：槽里的祸斗{(dead ? "被熔流烧死" : $"还活着（{e.transform.position}，熔岩里 {LavaField.IsLava(e.transform.position)}）")}，熔流闸烧死 +{s.Kills - k0}");
            if (!dead) Fail($"熔流闸「{s.title}」的熔流冲过槽里眩晕的祸斗没烧死");
            if (e && !e.Dead) Destroy(e.gameObject);
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
            Shot(cam, "map33_cache");
        }

        // ───────────── 领主战 ─────────────

        /// <summary>沿桥走进神范台 → 封门 → 登场 → 打死（冒烟只验流程）→ 结算：首领宝箱、回满、熔铁闸落下、清关宝箱、出口</summary>
        IEnumerator LordCase(BossEncounter enc, FoundryLordGate lordGate, FoundryChannels channels)
        {
            Line($"进入领主战流程前：{enc.State}，首领 {(enc.Boss ? "已生成" : "未生成")}");
            if (enc.State != BossEncounter.Phase.Waiting || enc.Boss) Fail("神范前庭期间魔将提前开战（前庭应在入场触发区之外）");
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var entry = enc.arena.PlayerEntryPoint;
            Line($"前往神范台（路程 {PathLength(motor.transform.position, entry):F0} m）");
            yield return Travel(entry, 2f, false);
            float t0 = Time.time;
            while (enc.State == BossEncounter.Phase.Waiting && Time.time - t0 < 3f) yield return null;
            if (enc.State == BossEncounter.Phase.Waiting)
            {
                Fail($"走进神范台 3 s 后领主战没有开始（玩家 {motor.transform.position}）");
                enc.Begin();
            }
            Line($"领主战开始：{enc.State}，熔铁闸 {(enc.GatesSealed ? "已升起" : "没升起")}（{enc.gates?.Length ?? 0} 扇）");
            if (enc.gates != null && enc.gates.Length > 0 && !enc.GatesSealed) Fail("领主战开始后熔铁闸没有封桥");
            float s0 = Time.time;
            while (enc.State == BossEncounter.Phase.Warning && Time.time - s0 < enc.warnSeconds + 3f) yield return null;
            var boss = enc.Boss;
            if (!boss) Fail($"首领 {enc.bossId} 没有生成，状态 {enc.State}（3-3 必须真正打一场魔将）");
            else
            {
                Line($"登场：{boss.Title}（{boss.Subtitle}），{boss.Health.maxHealth:F0} 生命 + {boss.Health.maxShield:F0} 护盾 + {boss.Health.maxArmor:F0} 护甲，模型 {boss.Model?.source} {boss.Model?.prefab}");
                Aim(motor, eye, boss.BodyCenter);
                yield return new WaitForSeconds(0.3f);
                Shot(cam, "map33_lord");
                float k0 = Time.time;
                while (!boss.Dead && Time.time - k0 < 20f)
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
                if (!boss.Dead) Fail("熔心魔将没被打死");
            }
            vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
            float st0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - st0 < BossEncounter.SettleDelay + 4f) yield return null;
            float o0 = Time.time;
            while (!enc.OpenedExit && Time.time - o0 < BossEncounter.PortalDelay + 3f) yield return null;
            yield return new WaitForSeconds(0.9f);
            bool healed = vitals.health >= vitals.MaxHealth - 0.5f;
            var chest = enc.RewardChest;
            Line($"结算：{enc.State}，回满 {(healed ? "✓" : "✗")}，首领宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」{chest?.tier}，" +
                 $"清关宝箱「{(lordGate && lordGate.ClearChest ? lordGate.ClearChest.EffectiveReward : "（没有）")}」，熔铁闸 {(enc.GatesSealed ? "还立着" : "已落下")}，" +
                 $"熔铜渠 {(channels && channels.Flooding ? "还在涨" : "已退")}，去向 {enc.Result}，出口 {(enc.OpenedExit ? enc.OpenedExit.name : "无")}");
            if (enc.State != BossEncounter.Phase.Settled) Fail("领主战没有结算");
            if (boss && !healed) Fail("结算没有回满生命");
            if (boss && !chest) Fail("结算没有落首领宝箱");
            if (lordGate && !lordGate.ClearChest) Fail("领主战结算后神范前没有清关宝箱");
            if (enc.GatesSealed) Fail("结算后熔铁闸没有落下");
            if (enc.Result != BossEncounter.Outcome.NextStage) Fail($"3-3 打完的去向是 {enc.Result}（应为下一关）");
            if (enc.OpenedExit) Aim(motor, eye, enc.OpenedExit.Focus);
            yield return null;
            Shot(cam, "map33_settled");
        }

        // ───────────── 走路（沿 NavMesh 路径，用角色控制器真走）─────────────

        /// <summary>沿 NavMesh 路径走到离 goal 水平 stopAt 米以内（同 Map13：逐个拐点用角色控制器 Move，1.5 s 不接近就跳点记一次卡住）</summary>
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
                if ((motor.transform.position - before).sqrMagnitude > 100f && jumps++ < 6)
                    Line($"  ⚠ 走路时被挪走：{before} → {motor.transform.position}（熔岩里 {LavaField.IsLava(before)}）");
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

        /// <summary>朝 goal 沿 NavMesh 走 maxStep 米（交战中追敌人用）</summary>
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
        }

        /// <summary>场景里名字以 id 开头、又含 what 的第一个带渲染器的物体（白盒「id · 神范 (Placeholder)」/ 正式件「id · 神范」）</summary>
        static GameObject FindNamed(string id, string what)
        {
            foreach (var t in FindObjectsByType<Transform>())
                if (t.name.StartsWith(id) && (t.name.EndsWith($"· {what}") || t.name.Contains($"· {what} (")) && t.GetComponentInChildren<Renderer>()) return t.gameObject;
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

        static string Slug(EncounterSite s)
        {
            var n = s.name;
            int i = n.IndexOf(' ');
            return i > 0 && n.Length > i + 1 ? n.Substring(i + 1, 1) : "x";
        }
    }
}
