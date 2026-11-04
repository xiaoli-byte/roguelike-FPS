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
    /// 3-2 铸神井 v2 冒烟（bridge.sh playtest map-3-2；场景 L3_2_ForgeWell，docs/level-design/maps/3-2.md §10，ch3-v2 7.4）：
    ///   1. 开局：关卡 = 3-2、局难度 = RunPlan 的 2.76；目标图（必清 4、顺序不限 + 可选 1）、路遇 1、两片熔岩（熔岩井 + 熔泉池）、
    ///      两座链桥（北链桥 Signal、南链桥常设）、升降台（MovingPlatform，开局没通电、停在井底）、出口（没开）、铸门（关着）、2 处藏宝；
    ///      没有空气墙；出生点看得见悬炉和井底铸门、井口眺台看得见熔岩井；出生点到四个必清场地、升降台下站、出口的导航路径都完整。
    ///   2. 机器人清场：每次挑导航路程最近的未清必清场地，用角色控制器沿导航路径真走（东旋坡、链桥、西吊臂下跳、熔瀑栈道都是真的），
    ///      路上被别的场地 / 路遇触发就先打那个；自动瞄准射击、隔 4 s 放技能；铁牛站到正前方引它吸气打炉门。
    ///      玩家临时 +5000 生命、+300% 伤害（冒烟只测路线与机制，清场时间由 squads-ch3 量；宿主 600 s 内要跑完整套），每处 120 s 内肃清。
    ///   3. 必清全部肃清 → 目标完成 → 出口升起 → 清关宝箱；铸门全开。
    ///   4. 北链桥：② 肃清后崩断（桥板全塌、桥面从导航网格上挖掉）；从甲板走南链桥回到 T1。
    ///   5. 熔泉池：站进熔岩池正中——熔岩接管、扣血、托回岸上。
    ///   6. 升降台：走到井底下站、敲铜锣通电，站上台面 → 升到 T1 → 走下栈桥上 T1（北链桥塌了以后的第二条回程）。
    ///   S3：悬炉甲板东口刷一只祸斗、眩晕住、朝外打一发带击退的射击 → 推下甲板、掉进 17 m 下的熔岩井烧死（熔岩烧死 +1、推下台沿 +1、走正常的击杀事件）；
    ///       间歇熔泉：目标完成时四口齐喷过、不在 ④ 交战时不按周期喷；站在喷口上被掀起来扣血；敌人站在喷口上被掀起；射爆岩壳提前引爆。
    ///   7. 藏宝 A（炼渣龛）：走过去发现 → 按 F → 宝箱。8. 出口前按 F → 结算。
    /// 走路的导航路径不完整、卡住过多都记不合格；运行时报错由宿主记不合格。
    /// </summary>
    public sealed class Map32Suite : PlaytestSuite
    {
        public override string Id => "map-3-2";
        public override string Scene => "Assets/Scenes/L3_2_ForgeWell.unity";

        const float ReadyTimeout = 90f, SiteTimeout = 90f, StallPurge = 18f, ClearAllTimeout = 400f, BotSpeed = 11f, LiftTimeout = 25f, T1Y = 22f;
        const string HangingForgeId = "SM_Tripo_InfernoHangingForge", MoltenGateId = "SM_Tripo_InfernoMoltenGate";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        int partialPaths, skillCasts, stalls, lavaEntries, stallPurges, hops;
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
            var lift = FindAnyObjectByType<MovingPlatform>();
            var director = ForgeWellDirector.Instance;
            var spans = FindObjectsByType<BreakableSpan>();
            var roadside = FindObjectsByType<EncounterSite>().Where(s => s.roadside).ToList();
            Line($"场景：必清 {objective?.RequiredTotal ?? 0}，可选 {objective?.optional?.Length ?? 0}，路遇 {roadside.Count}，藏宝 {caches.Length}，熔岩 {lavas.Length} 片，链桥 {spans.Length}，" +
                 $"升降台 {(lift ? $"{(lift.Powered ? "已通电" : "未通电")}、停在第 {lift.At} 站" : "无")}，出口 {(portal ? "有" : "无")}，演出 {(director ? "有" : "无")}");
            if (!objective || objective.RequiredTotal != 4) Fail("目标图的必清场地应为 4 个");
            if (objective && (objective.optional?.Length ?? 0) != 1) Fail("目标图的可选场地应为 1 个（铸范库守军）");
            if (objective && objective.required.Any(s => s && s.requires != null && s.requires.Length > 0)) Fail("必清场地写了 requires（3-2 的场地应当顺序不限）");
            if (roadside.Count != 1) Fail($"路遇 {roadside.Count} 处（应为 1：熔瀑栈道）");
            if (caches.Length != 2) Fail($"藏宝点 {caches.Length} 处（应为 2：炼渣龛、铸范库）");
            if (lavas.Length != 4 || !LavaField.Any) Fail($"熔岩 {lavas.Length} 片（应为 4：熔岩井、熔泉池、① / ③ 铸槽）");
            if (spans.Length != 2) Fail($"链桥 {spans.Length} 座（应为 2）");
            if (!director) Fail("场景里没有 ForgeWellDirector");
            else
            {
                if (!director.northBridge) Fail("演出没有接北链桥");
                if (director.GateStage != 0) Fail("开局铸门就不是关着的");
            }
            if (!lift) Fail("场景里没有升降台（MovingPlatform）");
            else
            {
                if (lift.Powered) Fail("开局升降台就通电了（应等井底敲锣）");
                if (lift.At != 0) Fail("开局升降台不在井底下站（第 0 站）");
            }
            if (!portal)
            {
                Fail("场景里没有出口传送门");
                yield break;
            }
            if (portal.IsOpen) Fail("开局出口就开着（应等必清场地肃清）");
            NoAirWall();

            // 地标：出生点看得见悬炉、井底铸门；井口眺台看得见熔岩井
            var forge = GameObject.Find("Landmark_HangingForge");
            var gateMark = GameObject.Find("Landmark_ExitGate");
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
                bool seen = Visible(eye.position, lava.transform.position, 2.5f, "Lava");
                Line($"井口眺台 → 熔岩井：{(seen ? "看得见" : "被挡住")}");
                if (!seen) Fail("井口眺台看不到熔岩井");
                var gateEye = GameObject.Find("Lookout_Gate");
                if (gateMark && gateEye)
                {
                    Place(gateEye.transform.position);
                    yield return new WaitForSeconds(0.25f);
                    bool g = Visible(eye.position, gateMark.transform.position, 4f, MoltenGateId);
                    Line($"井口栈台 → 井底铸门（{Vector3.Distance(eye.position, gateMark.transform.position):F0} m）：{(g ? "看得见" : "被挡住")}");
                    if (!g) Fail("井口看不到井底的铸门（出口）");
                }
                Aim(motor, eye, lava.transform.position);
                yield return new WaitForSeconds(0.2f);
                Shot(cam, "map32_lookout");
                Place(back);
                yield return null;
            }

            var start = motor.transform.position;
            var goals = new List<(string name, Vector3 at)>();
            if (objective) goals.AddRange(objective.required.Where(s => s).Select(s => (s.title, s.transform.position)));
            if (lift) goals.Add(("升降台下站", lift.path[0]));
            goals.Add(("出口铸门", portal.transform.position - portal.transform.forward * 3.5f));
            foreach (var (name, at) in goals)
            {
                PathCorners(start, at, out bool complete);
                Line($"导航：出生点 → {name}：{(complete ? $"✓ {PathLength(start, at):F0} m" : "✗ 不完整")}");
                if (!complete) Fail($"出生点到「{name}」没有完整的导航路径");
            }

            // ── 2. 机器人清场 ──
            // 冒烟只测路线与机制（清场时间由 squads-ch3 量）：机器人临时 +5000 生命、+300% 伤害，整套在宿主的 600 s 内跑完
            vitals.stats.Add("playtest_map32", Stat.MaxHp, 5000);
            vitals.stats.Add("playtest_map32", Stat.DamagePct, 3f);
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
                if (elites.Count < 2) Fail($"必清场地只出了 {elites.Count} 只精英（② 精英马面·迅捷 + ④ 精英熔炉铁牛·狂暴）");
                if (SquadAffixes.Source != null && SquadAffixes.Source.Exists("frenzied") && !spawned.Any(r => r.elite && r.id == "iron_ox" && r.affix == "frenzied"))
                    Fail("熔泉炉坛的精英熔炉铁牛没有带「狂暴」词缀");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
            }

            // ── 3. 目标完成 → 出口升起 → 清关宝箱；铸门全开 ──
            if (objective)
            {
                Line($"目标：{(objective.Complete ? "已完成" : "未完成")}（肃清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}）");
                if (!objective.Complete) Fail("必清场地全部肃清后目标没有完成");
            }
            float rise0 = Time.time;
            while (portal.IsOpen && !portal.Risen && Time.time - rise0 < 5f) yield return null;
            yield return new WaitForSeconds(0.6f);
            Line($"出口：{(portal.IsOpen ? "已开启" : "未开启")}，升起 {portal.Rise:P0}，清关宝箱 {(portal.ClearChest ? portal.ClearChest.reward : "无")}；" +
                 $"铸门 {(director ? $"第 {director.GateStage} 段、升起 {director.GateRise:F1} m" : "—")}");
            if (!portal.IsOpen) Fail("必清场地肃清后出口没有开启");
            else if (!portal.ClearChest) Fail("出口升起后没有落清关宝箱");
            if (director && director.GateStage < 3) Fail("目标完成后铸门没有全开");

            // ── 4. 北链桥崩断 → 走南链桥回 T1 ──
            if (director) yield return BridgeCheck(director);

            // ── S3：悬炉甲板击退落井 ──
            InAction<KillEvent> onKill = OnKilled;
            GameEvents.EnemyKilled += onKill;
            try
            {
                yield return DeckKnockCase();
            }
            finally
            {
                GameEvents.EnemyKilled -= onKill;
            }

            // ── 5. 熔泉池 ──
            var pool = lavas.FirstOrDefault(v => v && v.shape == LavaShape.Box);
            if (!pool) Fail("没有熔泉池（盒形熔岩）");
            else yield return LavaPoolCheck(pool);
            LavaField.PlayerEntered -= OnLava;

            // ── S3：间歇熔泉 ──
            yield return GeyserCase();

            // ── 6. 升降台（井底敲锣通电 → 升到 T1）──
            if (lift) yield return LiftCheck(lift);

            // ── 7. 藏宝 A ──
            var cache = caches.FirstOrDefault(c => !c.guard);
            if (!cache) Fail("没有无守军的藏宝点（藏宝 A 炼渣龛）");
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
            Line($"出口提示：{portal.Prompt}");
            Shot(cam, "map32_gate");
            interactor.testInteract = true;
            yield return new WaitForSecondsRealtime(0.5f);
            bool done = GameSession.Instance && GameSession.Instance.Completed;
            Line($"进入出口：{(done ? "关卡完成" : "没有结算")}");
            if (!done) Fail("进入出口后没有关卡结算");
            Shot(cam, "map32_complete");
            GameSession.Instance?.SetModal(false);
            vitals.stats.Remove("playtest_map32");

            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}，技能 {skillCasts} 次，踩进熔岩 {lavaEntries} 次" +
                 $"，熔岩烧死 {(LavaField.Instance ? LavaField.Instance.Burned : 0)}");
            if (Runner.kills == 0) Fail("整关一只敌人都没打死");
            if (partialPaths > 0) Fail($"机器人走的导航路径有 {partialPaths} 次不完整");
            Line($"走路卡住跳点 {stalls} 次；交战卡住清残敌 {stallPurges} 次；跳下台阶孤岛 {hops} 次");
            if (stalls >= 8) Fail($"机器人沿导航网格走时卡住 {stalls} 次（东旋坡 / 链桥 / 栈道 / 俯射台坡？看上面的位置）");
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>
        /// 最近的活着的敌人（只看 EnemyAI，不打可破坏货堆 / 熔泉岩壳 / 机关这些也挂了血量的场景件）：先挑正在交战的场地自己的。
        /// 跳过不可选中的（S1 埋伏：别的场地预生成的休眠单位打不着，只在那个场地能开战时才可选中）和别的场地还在休眠的（AI 停用）
        /// </summary>
        static Damageable NearestFoe(Vector3 from, EncounterSite site = null)
        {
            Damageable best = null;
            float bestD = float.MaxValue;
            bool bestOwn = false;
            foreach (var e in EnemyAI.All)
            {
                if (!e || e.Dead || !e.Health || e.Health.Dead || e.Health.untargetable) continue;
                bool own = site && e.transform.IsChildOf(site.transform);
                if (!e.enabled && !own) continue;
                if (bestOwn && !own) continue;
                float d = (e.transform.position - from).sqrMagnitude;
                if ((own && !bestOwn) || d < bestD)
                {
                    bestD = d;
                    best = e.Health;
                    bestOwn = own;
                }
            }
            return best;
        }

        /// <summary>只清掉这个场地自己的残敌（别的场地预生成的埋伏单位留着，到那边照常苏醒）</summary>
        static int PurgeSite(EncounterSite site)
        {
            int n = 0;
            foreach (var e in EnemyAI.All.ToArray())
                if (e && !e.Dead && e.Health && e.transform.IsChildOf(site.transform))
                {
                    Combat.Execute(e.Health, true);
                    n++;
                }
            return n;
        }

        void OnLava(Vector3 feet) => lavaEntries++;

        void OnKilled(in KillEvent e)
        {
            lastKilled = e.enemy;
            lastKillInfo = e.info;
        }

        static NavMeshQueryFilter Dry => LavaField.WalkerFilter(LavaField.DryAreaMask);

        /// <summary>
        /// S3 悬炉甲板击退落井（ch3-v2 风险 2）：甲板东口（矮栏的缺口，外面就是 17 m 下的熔岩井）刷一只祸斗、眩晕住，机器人站在它身后、
        /// 朝外打一发带击退的射击（9 m/s）→ 导航代理推到网格边 → LavaField 推下台沿 → 落进熔岩井烧死：熔岩烧死 +1、推下台沿 +1、走正常的击杀事件
        /// </summary>
        IEnumerator DeckKnockCase()
        {
            var field = LavaField.Instance;
            var gap = GameObject.Find("Deck_EastGap");
            if (!gap || !field)
            {
                Fail("甲板击退：没有 Deck_EastGap 标记或熔岩系统，跳过");
                yield break;
            }
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var spot = gap.transform.position;
            var dir = Flat3(spot).normalized;
            var stand = spot - dir * 3.5f;
            yield return Travel(stand, 1.5f, false);
            Place(stand);
            yield return null;
            var e = EnemyRoster.Spawn("huodou", spot, Quaternion.LookRotation(-dir), 1, false);
            if (!e)
            {
                Fail("甲板击退：刷不出祸斗");
                yield break;
            }
            yield return new WaitForSeconds(1f);
            if (!e || e.Dead)
            {
                Fail("甲板击退：祸斗还没开始就死了");
                yield break;
            }
            EnemyStatus.Stun(e.Health, 4f);
            yield return null;
            var agent = e.GetComponent<NavMeshAgent>();
            if (agent && agent.enabled && NavMesh.SamplePosition(spot, out var hit, 1f, Dry)) agent.Warp(hit.position);
            else e.transform.position = spot;
            yield return null;
            yield return null;
            Place(stand);
            Aim(motor, eye, BodyCenter(e.Health));
            yield return null;
            int burned0 = field.Burned, shoved0 = field.Shoved;
            lastKilled = null;
            var d = e.Health;
            var from = e.transform.position;
            var info = DamageInfo.Simple(1, DamageSource.Weapon, from + Vector3.up * 0.5f, dir);
            info.knockback = 9;
            info.noCrit = true;
            Combat.DamageEnemy(d, info);
            float t = 0, lowest = from.y;
            bool shot = false;
            while (e && !e.Dead && t < 4f)
            {
                t += Time.deltaTime;
                lowest = Mathf.Min(lowest, e.transform.position.y);
                if (!shot && from.y - e.transform.position.y > 4f)
                {
                    shot = true;
                    Shot(cam, "map32_deck_knock");
                }
                yield return null;
            }
            bool dead = !e || e.Dead;
            Line($"甲板击退：祸斗从东口 {from} 被打{(dead ? $"下甲板，{t:F1} s 后在熔岩井里烧死" : $"了一下还活着（在 {e.transform.position}）")}，最低落到 y {lowest:F1}；" +
                 $"推下台沿 +{field.Shoved - shoved0}，熔岩烧死 +{field.Burned - burned0}，击杀事件 {(lastKilled == d ? $"有（来源 {lastKillInfo.source}）" : "没有")}");
            if (!dead) Fail("悬炉甲板东口被击退的祸斗 4 s 内没有掉进熔岩井烧死");
            else
            {
                if (field.Shoved - shoved0 < 1) Fail("甲板东口的击退没有走「推下台沿」（LavaField.Shoved 没加）");
                if (field.Burned - burned0 != 1) Fail($"熔岩烧死计数 +{field.Burned - burned0}（应为 1）");
                if (lastKilled != d) Fail("掉进熔岩井烧死没有走伤害管线的击杀事件（不计击杀、不掉落）");
                else if ((lastKillInfo.tags & DamageTag.Purge) != 0) Fail("烧死被当成了静默处决");
            }
            if (e && !e.Dead) Destroy(e.gameObject);
            yield return new WaitForSeconds(0.5f);
        }

        /// <summary>
        /// S3 间歇熔泉：四口都在、目标完成时齐喷过、④ 肃清后不再按周期喷；玩家站在喷口上 → 预警 → 被掀起来扣血；
        /// 祸斗站在喷口上 → 被掀起来（掀起计数 +1）；朝岩壳打够伤害 → 提前引爆
        /// </summary>
        IEnumerator GeyserCase()
        {
            var gs = LavaGeyser.All.Where(g => g).OrderBy(g => g.name).ToList();
            Line($"间歇熔泉：{gs.Count} 口，喷过 {string.Join(" / ", gs.Select(g => g.Eruptions))} 次，按周期喷 {gs.Count(g => g.Cycling)} 口");
            if (gs.Count != 4)
            {
                Fail($"间歇熔泉 {gs.Count} 口（应为 4）");
                if (gs.Count == 0) yield break;
            }
            if (gs.Any(g => g.Eruptions == 0)) Fail("关卡目标完成时四口熔泉没有齐喷");
            if (gs.Any(g => g.Cycling)) Fail("④ 肃清后熔泉还在按周期喷");
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var g0 = gs[Mathf.Min(1, gs.Count - 1)];
            float wait0 = Time.time;
            while (g0.Current != LavaGeyser.State.Idle && Time.time - wait0 < 4f) yield return null;
            // 1) 玩家站在喷口上
            yield return Travel(g0.Base, 2.5f, false);
            Place(g0.Base + Vector3.up * 0.4f);
            yield return new WaitForSeconds(0.3f);
            // 先扣护盾再扣生命（一路捡的强化可能带护盾）：按「生命 + 护盾」和实际造成的伤害判
            float hp0 = vitals.health + vitals.shield, y0 = motor.transform.position.y, top = y0, dealt = 0;
            int hits0 = g0.PlayerHits, warned = 0;
            System.Action<LavaGeyser> onWarn = _ => warned++;
            System.Action<LavaGeyser, float> onHit = (_, d) => dealt += d;
            g0.Warned += onWarn;
            g0.HitPlayer += onHit;
            g0.EruptNow(0.5f);
            float t0 = Time.time;
            bool shot = false;
            while (Time.time - t0 < 2.5f)
            {
                top = Mathf.Max(top, motor.transform.position.y);
                if (!shot && g0.Current == LavaGeyser.State.Erupting && Time.time - t0 > 0.75f)
                {
                    shot = true;
                    Aim(motor, eye, g0.Base + Vector3.up * 4f);
                    Shot(cam, "map32_geyser_player");
                }
                yield return null;
            }
            g0.Warned -= onWarn;
            g0.HitPlayer -= onHit;
            Line($"熔泉 · 玩家：预警 {warned} 次，挨 {g0.PlayerHits - hits0} 次（伤害 {dealt:F0}），生命 + 护盾 {hp0:F0} → {vitals.health + vitals.shield:F0}，被掀起 {top - y0:F1} m");
            if (warned == 0) Fail("熔泉喷之前没有预警");
            if (g0.PlayerHits - hits0 != 1) Fail($"站在喷口上挨了 {g0.PlayerHits - hits0} 次（应为 1）");
            if (top - y0 < 1f) Fail($"站在喷口上只被掀起 {top - y0:F1} m");
            if (!(dealt > 0) || vitals.health + vitals.shield >= hp0) Fail("站在喷口上被喷没有扣血");
            vitals.Heal(99999);
            // 2) 敌人站在喷口上
            var g1 = gs[Mathf.Min(2, gs.Count - 1)];
            wait0 = Time.time;
            while (g1.Current != LavaGeyser.State.Idle && Time.time - wait0 < 4f) yield return null;
            var away = g1.Base + Flat3(g1.Base).normalized * 7f;
            yield return Travel(away, 2f, false);
            Place(away);
            // 喷口是 2 m 的岩锥：祸斗站在锥坡上（喷柱半径内、离井沿一侧）
            var onVent = g1.Base + Flat3(g1.Base).normalized * Mathf.Min(2.4f, g1.radius - 0.4f);
            var e = EnemyRoster.Spawn("huodou", onVent, Quaternion.identity, 1, false);
            yield return new WaitForSeconds(1f);
            if (!e || e.Dead) Fail("熔泉 · 敌人：刷不出祸斗");
            else
            {
                EnemyStatus.Stun(e.Health, 3f);
                var ag = e.GetComponent<NavMeshAgent>();
                if (ag && ag.enabled && NavMesh.SamplePosition(onVent, out var nh, 1.5f, Dry)) ag.Warp(nh.position);
                yield return null;
                int launched0 = g1.EnemiesLaunched;
                float ey0 = e.transform.position.y, etop = ey0;
                g1.EruptNow(0.4f);
                t0 = Time.time;
                while (Time.time - t0 < 2.5f && e && !e.Dead)
                {
                    etop = Mathf.Max(etop, e.transform.position.y);
                    yield return null;
                }
                bool burned = !e || e.Dead;
                Line($"熔泉 · 敌人：掀起 {g1.EnemiesLaunched - launched0} 只，最高离地 {etop - ey0:F1} m，{(burned ? "落进熔岩井烧死了" : "落回地上")}");
                if (g1.EnemiesLaunched - launched0 < 1) Fail("站在喷口上的祸斗没有被掀起");
                if (e && !e.Dead) Destroy(e.gameObject);
            }
            // 3) 射岩壳提前引爆
            var g2 = gs[0];
            wait0 = Time.time;
            while (g2.Current != LavaGeyser.State.Idle && Time.time - wait0 < 4f) yield return null;
            var aside = g2.Base + Flat3(g2.Base).normalized * 7f;
            yield return Travel(aside, 2f, false);
            Place(aside);
            yield return null;
            int det0 = g2.Detonations, er0 = g2.Eruptions;
            if (!g2.Health) Fail("熔泉岩壳没有挂血量（射不爆）");
            else
            {
                Aim(motor, eye, g2.Base + Vector3.up * 0.4f);
                var shellHit = DamageInfo.Simple(400, DamageSource.Weapon, g2.Base + Vector3.up * 0.4f, (g2.Base - eye.position).normalized);
                shellHit.noCrit = true;
                Combat.DamageEnemy(g2.Health, shellHit);
                t0 = Time.time;
                while (g2.Eruptions == er0 && Time.time - t0 < 1.5f) yield return null;
                Line($"熔泉 · 射岩壳：引爆 +{g2.Detonations - det0}，{Time.time - t0:F2} s 后{(g2.Eruptions > er0 ? "喷了" : "没喷")}");
                if (g2.Detonations - det0 != 1) Fail("朝熔泉岩壳打够伤害没有引爆");
                else if (g2.Eruptions == er0) Fail("岩壳引爆后 1.5 s 内熔泉没有喷");
                yield return new WaitForSeconds(0.4f);
                Shot(cam, "map32_geyser_shell");
            }
            vitals.Heal(99999);
            yield return new WaitForSeconds(1.5f);
        }

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
            float start = Time.time, flankAt = 0, skillAt = Time.time + 1f, progressAt = Time.time, idleSince = -1;
            bool shotMid = false;
            int kills0 = Runner.kills, killsSeen = Runner.kills;
            float dmg0 = Runner.playerDamage;
            Runner.killsById.Clear();
            Line($"遭遇「{site.title}」开始：{site.Total} 只，{site.WaveCount} 波");
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - start < SiteTimeout)
            {
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.4f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                if (Runner.kills != killsSeen)
                {
                    killsSeen = Runner.kills;
                    progressAt = Time.time;
                }
                // 卡住：18 s 没有击杀、只剩 ≤ 3 只、没有待出场的（远程 / 飞行跑到够不着的地方）——清掉残敌、记一笔，不算不合格
                // （冒烟测的是路线和机制；宿主 600 s 内要跑完整套）
                if (Time.time - progressAt > StallPurge && site.PendingCount == 0 && site.AliveCount is > 0 and <= 3)
                {
                    stallPurges++;
                    var left = EnemyAI.All.Where(e => e && !e.Dead && e.transform.IsChildOf(site.transform)).Select(e => $"{e.enemyId}@{e.transform.position}");
                    Line($"  ⚠ 「{site.title}」{StallPurge:F0} s 没有进展，清掉残敌 {site.AliveCount} 只：{string.Join("、", left)}");
                    PurgeSite(site);
                    progressAt = Time.time;
                    yield return null;
                    continue;
                }
                var target = NearestFoe(eye.position, site);
                if (!target)
                {
                    weapons.testFire = false;
                    if (idleSince < 0) idleSince = Time.time;
                    if (site.PendingCount > 0 && (Flat(motor.transform.position - site.transform.position) > site.arenaRadius || Time.time - idleSince > 3f))
                    {
                        PathCorners(motor.transform.position, site.transform.position, out bool linked);
                        if (!linked) HopOffIsland(site.transform.position);
                        else if (Flat(motor.transform.position - site.transform.position) > 4f) yield return Step(site.transform.position, 6f);
                        idleSince = Time.time;
                    }
                    yield return null;
                    continue;
                }
                idleSince = -1;
                var body = target.GetComponent<EnemyBody>();
                var ai = target.GetComponent<EnemyAI>();
                bool weakOpen = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy;
                var aim = weakOpen && Random.value < 0.4f ? body.WeakPoint.position : BodyCenter(target);
                if (ai is IronOxAI ox)
                {
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
                    if (e && !e.Dead && e.transform.IsChildOf(site.transform))
                    {
                        var ag = e.GetComponent<NavMeshAgent>();
                        Line($"  残敌 {e.enemyId}：状态 {e.State}，位置 {e.transform.position}，离玩家 {Vector3.Distance(e.transform.position, motor.transform.position):F1} m，导航网格上 {(ag && ag.isOnNavMesh)}");
                    }
                PathCorners(motor.transform.position, site.transform.position, out bool botLinked);
                Line($"  场地状态：第 {site.Wave + 1}/{site.WaveCount} 波，待出场 {site.PendingCount}，在场 {site.AliveCount}，休眠 {site.SleepingCount}/{site.ArmedCount}，" +
                     $"换点 {site.Relocations}，防卡 {site.Stalled}；全场敌人 {EnemyRegistry.Count}（休眠 {EncounterSite.DormantCount}）；" +
                     $"机器人 {motor.transform.position}，到场地中心的导航{(botLinked ? "连通" : "不通（孤岛？）")}");
                if (!site.optional) Fail($"{SiteTimeout:F0} s 内没有肃清「{site.title}」（剩 {site.Remaining}）");
                PurgeSite(site);
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

        // ───────────── 北链桥 / 熔泉池 / 升降台 / 藏宝 ─────────────

        /// <summary>② 肃清后北链桥崩断（桥板全塌、桥面挖掉）；把玩家放到甲板中央，沿导航走南链桥回到 T1</summary>
        IEnumerator BridgeCheck(ForgeWellDirector director)
        {
            EnemyRegistry.PurgeAll();
            var north = director.northBridge;
            float t0 = Time.time;
            while (north && !north.Collapsed && Time.time - t0 < 6f) yield return null;
            int carved = 0;
            if (north)
                for (int i = 0; i < north.Count; i++)
                    if (north.Carved(i)) carved++;
            Line($"北链桥：{(director.BridgeBroken ? "崩断了" : "没断")}，塌 {(north ? north.FallenCount : 0)}/{(north ? north.Count : 0)} 段，挖洞 {carved} 段；挂钩放下 {director.HookLowered:P0}");
            if (!director.BridgeBroken || !north || !north.Collapsed) Fail("② 悬炉锻台肃清后北链桥没有全部崩断");
            else if (carved < north.Count) Fail($"北链桥塌了但只挖掉了 {carved}/{north.Count} 段导航");
            var deck = GameObject.Find("Site_2_HangingForge");
            var south = GameObject.Find("Bridge_SouthHead");
            var northHead = GameObject.Find("Bridge_NorthHead");
            if (!deck || !south)
            {
                Fail("缺少甲板 / 南链桥头标记");
                yield break;
            }
            Place(deck.transform.position + Vector3.up * 0.3f);
            yield return new WaitForSeconds(0.3f);
            if (northHead)
            {
                PathCorners(motor.transform.position, northHead.transform.position, out bool c1);
                float len = PathLength(motor.transform.position, northHead.transform.position);
                Line($"北链桥塌后：甲板 → 北链桥头导航 {(c1 ? $"{len:F0} m（绕南链桥 / 栈道）" : "不完整")}");
            }
            var target = south.transform.position + (south.transform.position - new Vector3(0, south.transform.position.y, 0)).normalized * 4f;
            yield return Travel(target, 1.5f, false);
            yield return new WaitForSeconds(0.3f);
            var p = motor.transform.position;
            bool onT1 = p.y > T1Y - 1f && Flat(p - target) < 4f;
            Line($"走南链桥回 T1：{(onT1 ? "到了" : "没到")}（{p}）");
            Shot(cam, "map32_south_bridge");
            if (!onT1) Fail("北链桥塌后从甲板走南链桥回不到 T1");
        }

        IEnumerator LavaPoolCheck(LavaVolume pool)
        {
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var c = pool.transform.position;
            // 池子靠井心那一侧的岸（池子的 +X 朝井外）
            var shore = c - pool.transform.right * (pool.size.x * 0.5f + 2.5f);
            yield return Travel(shore, 1.5f, false);
            int entries0 = lavaEntries;
            float hp0 = vitals.health;
            Place(c + Vector3.up * 0.5f);
            float t0 = Time.time;
            while (Time.time - t0 < 1.5f && lavaEntries == entries0) yield return null;
            yield return new WaitForSeconds(1.0f);
            var feet = motor.transform.position;
            bool out_ = !LavaField.IsLava(feet);
            Line($"熔泉池：熔岩接管 {lavaEntries - entries0} 次，生命 {hp0:F0} → {vitals.health:F0}，1 s 后{(out_ ? $"已托回岸上 {feet}" : "还在熔岩里")}");
            Shot(cam, "map32_lavapool");
            if (lavaEntries == entries0) Fail("站进熔泉池正中，熔岩没有接管（LavaField.PlayerEntered 没响）");
            else if (!out_) Fail("踩进熔泉池 1.5 s 后还没被托回岸上");
            vitals.Heal(99999);
        }

        /// <summary>走到井底下站、敲铜锣通电，站上台面 → 升到 T1 → 走下栈桥（玩家全程不掉出台面）</summary>
        IEnumerator LiftCheck(MovingPlatform lift)
        {
            EnemyRegistry.PurgeAll();
            vitals.Heal(99999);
            var gong = SceneActivator.All.FirstOrDefault(a => a && a.targets != null && a.targets.Contains(lift));
            if (!gong)
            {
                Fail("升降台没有铜锣（SceneActivator）");
                yield break;
            }
            yield return Travel(gong.transform.position + gong.transform.forward * 2f, 1.2f, false);
            Place(gong.transform.position + gong.transform.forward * 2f);
            yield return new WaitForSeconds(0.3f);
            Aim(motor, eye, gong.Focus);
            yield return new WaitForSeconds(0.15f);
            bool prompted = interactor.Current as SceneActivator == gong;
            if (prompted) interactor.testInteract = true;
            else gong.Activate(SceneActivator.Cause.Script);
            yield return new WaitForSeconds(0.5f);
            Line($"升降台铜锣：{(prompted ? "按 F 敲响" : "交互提示没出来，脚本触发")}，升降台{(lift.Powered ? "通电了" : "没通电")}");
            if (!prompted) Fail($"站在铜锣前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            if (!lift.Powered) Fail("敲响铜锣后升降台没有通电");
            float w0 = Time.time;
            while ((lift.At != 0 || lift.Moving) && Time.time - w0 < LiftTimeout) yield return null;
            if (lift.At != 0)
            {
                Fail("升降台没有停在井底下站");
                yield break;
            }
            Place(lift.path[0] + Vector3.up * 0.3f);
            yield return new WaitForSeconds(0.2f);
            var cc = motor.GetComponent<CharacterController>();
            if (!lift.Carrying(cc)) Fail("站在下站台面中央，升降台没有认出乘客");
            int trips0 = lift.Trips;
            float t0 = Time.time, worstGap = 0;
            bool shot = false;
            while (!(lift.At == lift.LastIndex && lift.Trips > trips0) && Time.time - t0 < LiftTimeout)
            {
                worstGap = Mathf.Max(worstGap, lift.deck.position.y - motor.transform.position.y);
                if (!shot && lift.Moving && Time.time - t0 > 3f)
                {
                    shot = true;
                    Shot(cam, "map32_lift_ride");
                }
                yield return null;
            }
            yield return new WaitForSeconds(0.3f);
            var top = lift.path[lift.LastIndex];
            float y = motor.transform.position.y;
            Line($"升降台：{(lift.At == lift.LastIndex ? "到了上站" : "没到上站")}，用时 {Time.time - t0:F1} s，玩家 y {y:F2}（上站台面 {top.y:F2}），途中脚底最多低于台面 {worstGap:F2} m");
            if (lift.At != lift.LastIndex) Fail($"站上台面 {LiftTimeout:F0} s 升降台没到上站");
            else if (Mathf.Abs(y - top.y) > 0.6f) Fail($"升降台到站，玩家没跟上来（y {y:F2}，台面 {top.y:F2}）");
            if (worstGap > 0.5f) Fail($"升降台途中玩家掉出台面（脚底低于台面 {worstGap:F2} m）");
            var landing = GameObject.Find("Lift_TopLanding");
            var ahead = landing ? landing.transform.position : top + Flat3(top).normalized * 22f;
            yield return Walk(ahead, 0.8f);
            yield return new WaitForSeconds(0.3f);
            bool onT1 = !lift.Carrying(cc) && motor.transform.position.y > T1Y - 1f;
            Line($"走下栈桥：{(onT1 ? "上了 T1" : "没下来")}（{motor.transform.position}）");
            if (!onT1) Fail("从升降台上站走不下栈桥到 T1");
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

        // ───────────── 走路（沿导航路径，用角色控制器真走）─────────────

        /// <summary>
        /// 沿导航路径走到离 goal 水平 stopAt 米以内：逐个拐点用角色控制器 Move（东旋坡、链桥、栈道、西吊臂下跳都是真的），
        /// 1.5 s 没有接近当前拐点就跳到拐点并记一次卡住。breakOnCombat = 路上有场地开战就停下（交给 Fight）。路径不完整记一次。
        /// </summary>
        IEnumerator Travel(Vector3 goal, float stopAt, bool breakOnCombat)
        {
            var corners = PathCorners(motor.transform.position, goal, out bool complete);
            if (!complete && HopOffIsland(goal)) corners = PathCorners(motor.transform.position, goal, out complete);
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

        /// <summary>
        /// 机器人被交战时的绕视线 / 包抄瞬移放到了没坡的 +1.3 m 台阶上（④ 炉坛、③ 风箱侧台：玩家单跳上得去，敌人的导航网格在那里是孤岛）：
        /// 像玩家一样跳下来——在 2.5–8 m 内找一处到 goal 有完整路径、高差 ≤ 3 m 的导航点放下去；找到了就不算「路径不完整」
        /// </summary>
        bool HopOffIsland(Vector3 goal)
        {
            var walker = LavaField.WalkerFilter();
            var p = motor.transform.position;
            foreach (float r in new[] { 2.5f, 4f, 6f, 8f })
                for (int k = 0; k < 12; k++)
                {
                    float a = k * 30f * Mathf.Deg2Rad;
                    var q = p + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r;
                    if (!NavMesh.SamplePosition(q, out var hit, 1.5f, walker) || Mathf.Abs(hit.position.y - p.y) > 3f) continue;
                    PathCorners(hit.position, goal, out bool ok);
                    if (!ok) continue;
                    hops++;
                    Line($"  · 从 {p} 跳下台阶（导航孤岛）到 {hit.position}");
                    Place(hit.position);
                    return true;
                }
            return false;
        }

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
            // 目标点（场地中心）可能在炉坛 / 风箱这种不进导航的东西里：先 4 m、再 8 m 找
            if (!NavMesh.SamplePosition(from, out var a, 4f, walker)) return list;
            if (!NavMesh.SamplePosition(to, out var b, 4f, walker) && !NavMesh.SamplePosition(to, out b, 8f, walker)) return list;
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

        /// <summary>贴地放下玩家：只从头顶 2 m 往下找地面（链桥、栈桥、甲板都接得住）</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p;
            if (cc) cc.enabled = true;
        }

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
