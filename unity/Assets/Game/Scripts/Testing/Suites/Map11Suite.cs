using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 1-1 古道穿越戈壁整图冒烟（bridge.sh playtest map-1-1；docs/level-design/maps/1-1.md §8，docs/unity-parity.md 7.4「每张图」）：
    /// 机器人沿 NavMesh 走（角色控制器逐帧 Move，不瞬移；卡住 1.5 s 才跳到下一个拐点并记一次），自动瞄准射击清完全部必清场地并走出出口。
    ///   静态：没有测试武器架、没有 PlaceOrBox 占位件、没有空气墙（Ignore Raycast 层的实体碰撞体只在兜底环上）；
    ///         目标图 = ① → ② ③ 任意顺序（都只要求 ①）→ ④（要求 ② ③）；④ 有区域沙暴；出口开局是关的，下一关是 1-2。
    ///   路线：出生 → ① → 戍卒窖藏（无守军：走近发现 → 调查 → 宝箱）→ 河床浅滩 → ② 南侧绕行 → 商队遗货（调查惊动守军 → 肃清 → 宝箱，当前武器 +1）
    ///         → ② 东南 → 西坡道脚 → ③（开战时 ② 必须还没动 = 顺序放开）→ 瞬移到 ④ 触发圈深处站 2.5 s（不开战 = ④ 等 ② ③）
    ///         → ② → ④（沙暴已在计时；开战后强制风暴：营地锁定上限 ≤ 能见度）→ 出口：升起、开清关宝箱、进门结算，下一关 1-2。
    ///   打法同 slice11（瞄最近的敌人、远了靠近、被挡绕到看得见的地方、技能好了就放），玩家无敌；一个场地 75 s 没打完就补刀并提醒（地图冒烟不测平衡）。
    /// 路点读场景里 Level_1_1 摆的 Route_* / Cache_* 标记，旧场景没有标记时用同样的坐标。
    /// </summary>
    public sealed class Map11Suite : PlaytestSuite
    {
        public override string Id => "map-1-1";
        /// <summary>1-1 古道穿越戈壁（与编辑器里 Level_1_1.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        /// <summary>机器人走路速度（m/s，比玩家 7.5 略快，省时间）</summary>
        const float BotSpeed = 9f;
        /// <summary>一个场地打多久开始补刀（秒）</summary>
        const float FightLimit = 75f;

        /// <summary>标记坐标（与 Level_1_1 相同）：场景里没有同名标记时用这里的</summary>
        static readonly Dictionary<string, Vector2> Fallback = new()
        {
            ["Route_Ford"] = new Vector2(96, 67),
            ["Route_BypassSouth"] = new Vector2(128, 72),
            ["Route_BypassEast"] = new Vector2(148, 104),
            ["Route_RampWFoot"] = new Vector2(152, 126),
        };

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        CharacterController cc;
        Transform eye;
        float walked;
        int stalls, executed;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            weapons = FindAnyObjectByType<WeaponController>();
            interactor = FindAnyObjectByType<Interactor>();
            skills = FindAnyObjectByType<HeroSkills>();
            if (!motor || !vitals || !weapons || !interactor)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}");
                yield break;
            }
            cc = motor.GetComponent<CharacterController>();
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;

            var sites = FindObjectsByType<EncounterSite>();
            EncounterSite Site(string title) => sites.FirstOrDefault(s => s.title == title);
            var s1 = Site("黑戈壁砾石滩");
            var s2 = Site("雅丹石阵");
            var s3 = Site("烽燧台地");
            var s4 = Site("驼队残骸营地");
            var caches = FindObjectsByType<CachePOI>();
            var cellar = caches.FirstOrDefault(c => c.title == "戍卒窖藏");
            var wreck = caches.FirstOrDefault(c => c.title == "商队遗货");
            var portal = FindAnyObjectByType<ExitPortal>();
            var objective = portal ? LevelObjective.For(portal.gameObject.scene) : FindAnyObjectByType<LevelObjective>();
            if (!s1 || !s2 || !s3 || !s4 || !cellar || !wreck || !portal || !objective)
            {
                Fail($"场景不是 M11 的 1-1（先 bridge.sh level 1-1）：① {(bool)s1} ② {(bool)s2} ③ {(bool)s3} ④ {(bool)s4}，" +
                     $"戍卒窖藏 {(bool)cellar} 商队遗货 {(bool)wreck}，出口 {(bool)portal} 目标 {(bool)objective}");
                yield break;
            }

            vitals.invulnerableUntil = Time.time + 99999;
            vitals.stats.Add("playtest_map11", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            float startTime = Time.time;
            try
            {
                // ── 静态检查 ──
                StaticChecks(s1, s2, s3, s4, wreck, portal, objective);
                yield return NoAirWall();

                // ── ① ──
                yield return Engage(s1, "① 黑戈壁砾石滩");
                // ── 戍卒窖藏（无守军）──
                yield return Investigate(cellar, "戍卒窖藏");
                // ── ② 南侧绕行 → 商队遗货（守军）──
                yield return WalkTo(Mark("Route_Ford"), "河床浅滩");
                yield return WalkTo(Mark("Route_BypassSouth"), "② 南侧绕行");
                if (s2.phase != EncounterSite.Phase.Idle) Fail($"走 ② 南侧绕行路踩进了 ② 的触发圈（② {s2.phase}）");
                yield return Investigate(wreck, "商队遗货");
                yield return WalkTo(Mark("Route_BypassEast"), "② 东南");
                yield return WalkTo(Mark("Route_RampWFoot"), "西坡道脚");
                if (s2.phase != EncounterSite.Phase.Idle) Fail($"绕到西坡道脚时 ② 已经开战（{s2.phase}）：绕行路不成立");
                // ── ③ 先于 ②（顺序放开）──
                yield return Engage(s3, "③ 烽燧台地", s2);
                // ── ④ 在 ② 肃清前不开战 ──
                yield return GateCheck(s4, s2);
                // ── ② ──
                yield return Engage(s2, "② 雅丹石阵");
                // ── ④（沙暴）──
                yield return Engage(s4, "④ 驼队残骸营地", null, true);
                // ── 出口 ──
                yield return ExitStage(portal, objective);

                Line($"合计：步行 {walked:F0} m（卡住跳点 {stalls} 次），用时 {Time.time - startTime:F0} s；击杀 {Runner.kills}，补刀 {executed}；" +
                     $"必清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}/{objective.optional.Length}");
                if (stalls >= 8) Fail($"机器人沿 NavMesh 走时卡住 {stalls} 次（角色控制器和导航网格对不上：台阶 / 坡度 / 窄口？看上面的位置）");
            }
            finally
            {
                if (weapons) weapons.testFire = false;
                if (interactor) interactor.testInteract = false;
                if (vitals) vitals.stats.Remove("playtest_map11");
            }
        }

        // ───────────── 静态检查 ─────────────

        void StaticChecks(EncounterSite s1, EncounterSite s2, EncounterSite s3, EncounterSite s4, CachePOI wreck, ExitPortal portal, LevelObjective objective)
        {
            Line("── 静态 ──");
            int racks = FindObjectsByType<WeaponRack>().Length;
            if (racks > 0) Fail($"场景里还有 {racks} 个测试武器架（M11 撤掉了）");
            else Line("✓ 没有测试武器架");

            var holders = FindObjectsByType<Transform>().Where(t => t.name.StartsWith("Placeholder · ")).Select(t => t.name).Distinct().ToList();
            if (holders.Count > 0) Fail($"还有 {holders.Count} 种 PlaceOrBox 占位件：{string.Join("、", holders.Take(8))}");
            else Line("✓ 没有 PlaceOrBox 占位件");

            bool Req(EncounterSite s, EncounterSite r) => s.requires != null && s.requires.Contains(r);
            string Reqs(EncounterSite s) => s.requires == null || s.requires.Length == 0 ? "无" : string.Join("、", s.requires.Where(r => r).Select(r => r.title));
            Line($"目标「{objective.title}」：必清 {objective.RequiredTotal}（{string.Join("、", objective.required.Where(r => r).Select(r => r.title))}），" +
                 $"可选 {objective.optional.Length}；前置：② ← {Reqs(s2)}，③ ← {Reqs(s3)}，④ ← {Reqs(s4)}");
            if (objective.RequiredTotal != 4 || !new[] { s1, s2, s3, s4 }.All(s => objective.required.Contains(s))) Fail("必清场地应是 ①–④ 四个");
            if (!Req(s2, s1) || Req(s2, s3) || Req(s2, s4)) Fail("② 应只要求 ①（② ③ 先后不限）");
            if (!Req(s3, s1) || Req(s3, s2) || Req(s3, s4)) Fail("③ 应只要求 ①（② ③ 先后不限）");
            if (!Req(s4, s2) || !Req(s4, s3)) Fail("④ 应要求 ② ③");
            if (objective.required.Contains(wreck.guard)) Fail("藏宝守军不该算必清场地");
            if (!wreck.guard || wreck.guard.autoTrigger || !wreck.guard.optional) Fail("「商队遗货」应有守军场地（autoTrigger 关、可选）");

            var region = StormAt(s4);
            if (region == null) Fail("④ 附近没有区域沙暴（WeatherDirector.regions）");
            else Line($"沙暴「{region.name}」：半径 {region.radius} m，{region.armRadius} m 内开始计时，平静 {region.calm} / 预警 {region.warn} / 风暴 {region.storm} / 消退 {region.abate} s");

            var stage = RunPlan.ForScene(portal.gameObject.scene.path);
            var next = RunPlan.Next(stage);
            Line($"本关 {stage?.Label ?? "（不在 RunPlan 里）"} → 下一关 {next?.Label ?? "无"}；出口开局 {(portal.IsOpen ? "开着" : "关着")}");
            if (stage == null || stage.code != "1-1") Fail("RunPlan 里找不到本场景（应为 1-1）");
            if (next == null || next.code != "1-2") Fail("出口的下一关不是 1-2");
            if (portal.IsOpen) Fail("开局出口就开着（目标没完成）");
        }

        /// <summary>没有空气墙：Ignore Raycast 层上的实体碰撞体（兜底环）离等值线都在 failsafe − 3 m 以外（同 WorldSuite）</summary>
        IEnumerator NoAirWall()
        {
            var zone = BoundaryZone.Active;
            if (!zone)
            {
                Fail("场景里没有软边界（BoundaryZone）");
                yield break;
            }
            var t = zone.tuning;
            int walls = 0;
            float nearest = float.PositiveInfinity;
            foreach (var c in FindObjectsByType<Collider>())
            {
                if (!c.enabled || c.isTrigger || c.gameObject.layer != Layers.IgnoreRaycast) continue;
                if (c.GetComponentInParent<EnemyAI>()) continue;
                walls++;
                nearest = Mathf.Min(nearest, MinDistance(c));
            }
            if (walls == 0) Fail("Ignore Raycast 层上没有兜底环");
            else if (nearest < t.failsafe - 3f) Fail($"还有空气墙：离等值线只有 {nearest:F1} m 的 Ignore Raycast 碰撞体（兜底环应在 +{t.failsafe} m）");
            else Line($"✓ 没有空气墙：Ignore Raycast 层实体碰撞体 {walls} 个，最近的离等值线 {nearest:F1} m");
            yield return null;
        }

        static float MinDistance(Collider c)
        {
            float best = float.PositiveInfinity;
            if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
            {
                var verts = mc.sharedMesh.vertices;
                for (int i = 0; i < verts.Length; i += 2) best = Mathf.Min(best, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                return best;
            }
            var b = c.bounds;
            foreach (var p in new[] { b.center, new Vector3(b.min.x, 0, b.min.z), new Vector3(b.max.x, 0, b.min.z), new Vector3(b.min.x, 0, b.max.z), new Vector3(b.max.x, 0, b.max.z) })
                best = Mathf.Min(best, BoundaryZone.Distance(p));
            return best;
        }

        // ───────────── 走路 ─────────────

        /// <summary>
        /// 沿 NavMesh 路径走到 goal：逐个拐点用角色控制器 Move（地形坡度、台阶、碰撞都真实）；1.5 s 没有接近当前拐点就跳过去并记一次卡住。
        /// stop 返回 true 时提前停下（遭遇开战）。没有完整路径不合格（开放图要求主线和绕行都走得通）
        /// </summary>
        IEnumerator WalkTo(Vector3 goal, string label, Func<bool> stop = null, float arrive = 1.2f)
        {
            if (!NavMesh.SamplePosition(motor.transform.position, out var from, 4f, NavMesh.AllAreas))
            {
                Fail($"去「{label}」：玩家脚下 {Fmt(motor.transform.position)} 4 m 内没有导航网格");
                yield break;
            }
            if (!NavMesh.SamplePosition(goal, out var to, 6f, NavMesh.AllAreas))
            {
                Fail($"去「{label}」：目标 {Fmt(goal)} 6 m 内没有导航网格");
                yield break;
            }
            var path = new NavMeshPath();
            NavMesh.CalculatePath(from.position, to.position, NavMesh.AllAreas, path);
            if (path.status != NavMeshPathStatus.PathComplete)
            {
                Fail($"去「{label}」：{Fmt(from.position)} → {Fmt(to.position)} 没有完整的导航路径（{path.status}）");
                yield break;
            }
            var corners = path.corners;
            float len = 0;
            for (int i = 0; i + 1 < corners.Length; i++) len += Vector3.Distance(corners[i], corners[i + 1]);
            float t0 = Time.time;
            int stalls0 = stalls;
            bool stopped = false;
            for (int i = 1; i < corners.Length && !stopped; i++)
            {
                var target = corners[i];
                float reach = i == corners.Length - 1 ? arrive : 0.5f;
                float best = Flat(target - motor.transform.position), bestAt = Time.time;
                while (Flat(target - motor.transform.position) > reach)
                {
                    if (stop != null && stop())
                    {
                        stopped = true;
                        break;
                    }
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
                        Line($"  ⚠ 去「{label}」在 {Fmt(motor.transform.position)} 卡住 1.5 s，跳到拐点 {Fmt(target)}");
                        Teleport(motor, target);
                        yield return null;
                        break;
                    }
                }
            }
            walked += len;
            Line($"  走到「{label}」{(stopped ? "（途中开战，停下）" : "")}：路径 {len:F0} m、{corners.Length} 个拐点，{Time.time - t0:F1} s" +
                 (stalls > stalls0 ? $"，卡住 {stalls - stalls0} 次" : ""));
        }

        /// <summary>场景里的标记位置（地面）；没有就用 <see cref="Fallback"/> 的坐标</summary>
        static Vector3 Mark(string name)
        {
            var go = GameObject.Find(name);
            if (go) return go.transform.position;
            var p = Fallback.TryGetValue(name, out var xz) ? new Vector3(xz.x, 0, xz.y) : Vector3.zero;
            if (Physics.Raycast(p + Vector3.up * 80, Vector3.down, out var hit, 200, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
            return p;
        }

        // ───────────── 遭遇 ─────────────

        /// <summary>
        /// 走进场地触发圈开战并打完。mustBeIdle：开战那一刻必须还没动的场地（顺序放开的证据）；storm：开战后强制风暴并查锁定上限。
        /// 半路别的场地开战算不合格（走法踩进了不该进的触发圈），照样打完再继续
        /// </summary>
        IEnumerator Engage(EncounterSite site, string label, EncounterSite mustBeIdle = null, bool storm = false)
        {
            Line($"── {label} ──");
            if (site.phase == EncounterSite.Phase.Cleared)
            {
                Line($"「{site.title}」已经肃清，跳过");
                yield break;
            }
            for (int attempt = 0; attempt < 3 && site.phase == EncounterSite.Phase.Idle; attempt++)
            {
                yield return WalkTo(site.transform.position, label, () => EncounterSite.ActiveSites.Count > 0, 2f);
                foreach (var other in EncounterSite.ActiveSites.ToArray())
                    if (other && other != site)
                    {
                        Fail($"去「{site.title}」的路上「{other.title}」开战了（{Fmt(motor.transform.position)}）");
                        yield return Fight(other, $"intruder_{attempt}");
                    }
            }
            float t0 = Time.time;
            while (site.phase == EncounterSite.Phase.Idle && Time.time - t0 < 3f) yield return null;
            if (site.phase == EncounterSite.Phase.Idle)
            {
                Fail($"走到「{site.title}」中心 3 s 后还没开战（前置 {string.Join("、", site.requires.Where(r => r).Select(r => $"{r.title} {r.phase}"))}）");
                yield break;
            }
            Line($"「{site.title}」开战：{site.Total} 只、{site.WaveCount} 波，玩家在 {Fmt(motor.transform.position)}（离中心 {Flat(motor.transform.position - site.transform.position):F1} m）");
            if (mustBeIdle)
            {
                if (mustBeIdle.phase != EncounterSite.Phase.Idle) Fail($"「{site.title}」开战时「{mustBeIdle.title}」已经是 {mustBeIdle.phase}：没测到先后不限");
                else Line($"✓ 先后不限：「{mustBeIdle.title}」还没动，「{site.title}」先开战了");
            }
            if (storm) yield return StormFight(site);
            yield return Fight(site, label);
            if (site.phase == EncounterSite.Phase.Cleared && !string.IsNullOrEmpty(site.reward))
            {
                yield return new WaitForSeconds(0.6f);
                bool chest = FindObjectsByType<Chest>().Any(c => c.reward == site.reward && Flat(c.transform.position - site.transform.position) < site.arenaRadius);
                Line($"  场地宝箱（{site.reward}）：{(chest ? "出现了" : "没有")}");
                if (!chest) Fail($"「{site.title}」肃清后没有宝箱（{site.reward}）");
            }
        }

        /// <summary>④ 开战：沙暴应已在计时（走到营地 armRadius 内）；强制进入风暴，营地中心的远程锁定上限收到能见度以内</summary>
        IEnumerator StormFight(EncounterSite site)
        {
            var r = StormAt(site);
            if (r == null) yield break;
            Line($"沙暴：开战时阶段 {r.phase}（{r.phaseT:F1} s）");
            if (r.phase == StormPhase.Idle) Fail($"走到 ④ 开战时沙暴还没开始计时（armRadius {r.armRadius} m）");
            r.Force(StormPhase.Storm, 3f);
            yield return new WaitForSeconds(0.6f);
            var prof = WeatherProfiles.Get(r.profile);
            float lockR = WeatherDirector.LockOnRange(site.transform.position);
            Line($"强制风暴：营地强度 {WeatherDirector.StormAt(site.transform.position):F2}，锁定上限 {lockR:F1} m（能见度 {prof?.visibility} m），雾终点 {RenderSettings.fogEndDistance:F0} m");
            if (prof != null && lockR > prof.visibility + 0.5f) Fail($"沙暴里营地的锁定上限 {lockR:F1} m（应 ≤ {prof.visibility} m）");
            Shot(weapons.eye, "map11_storm");
        }

        static WeatherDirector.Region StormAt(EncounterSite site)
        {
            var d = WeatherDirector.Instance;
            if (!d || d.regions == null) return null;
            return d.regions.FirstOrDefault(r => r != null && Flat(r.center - site.transform.position) < 15f);
        }

        /// <summary>同 slice11 的打法：瞄最近的敌人；离得远就靠近；被掩体挡住就绕到看得见的地方；镇墓兽绕背；技能好了就放。超过 FightLimit 补刀</summary>
        IEnumerator Fight(EncounterSite site, string tag)
        {
            float t0 = Time.time, flankAt = 0, skillAt = Time.time + 1f;
            int kills0 = Runner.kills, exec0 = executed;
            bool shot = false;
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - t0 < FightLimit + 12f)
            {
                var w = weapons.Active;
                if (w != null) w.reserve = w.def.reserve;
                if (Time.time - t0 > FightLimit)
                    foreach (var e in EnemyAI.All.ToArray())
                        if (e && !e.Dead)
                        {
                            Combat.Execute(e.Health, true);
                            executed++;
                        }
                var target = NearestEnemy(eye.position);
                if (target)
                {
                    var ai = target.GetComponent<EnemyAI>();
                    if (ai is TombBeastAI && Time.time >= flankAt)
                    {
                        flankAt = Time.time + 2.5f;
                        Teleport(motor, target.transform.position - target.transform.forward * 9f);
                    }
                    var aim = BodyCenter(target);
                    Aim(motor, eye, aim);
                    if (Vector3.Distance(eye.position, aim) > 22f) Teleport(motor, Vector3.MoveTowards(motor.transform.position, target.transform.position, 6f));
                    else if (Time.time >= flankAt && Combat.Blocked(eye.position, aim, null))
                    {
                        flankAt = Time.time + 1.5f;
                        if (SightSpot(target, aim, out var spot)) Teleport(motor, spot);
                    }
                    weapons.testFire = w != null && (w.def.mode != FireMode.Semi || !weapons.testFire);
                    if (skills && Time.time >= skillAt)
                    {
                        skillAt = Time.time + 4f;
                        if (skills.secondary.charges > 0) skills.testE = true;
                        else if (skills.primary.charges > 0) skills.testQ = true;
                    }
                    if (!shot && Time.time - t0 > 4f)
                    {
                        shot = true;
                        Shot(weapons.eye, $"map11_{tag}");
                    }
                }
                else weapons.testFire = false;
                yield return null;
            }
            weapons.testFire = false;
            bool cleared = site.phase == EncounterSite.Phase.Cleared;
            Line($"  「{site.title}」{(cleared ? "肃清" : "没打完")}：{Time.time - t0:F0} s，击杀 {Runner.kills - kills0}" +
                 (executed > exec0 ? $"（⚠ 其中补刀 {executed - exec0} 只）" : "") + (cleared ? "" : $"，剩 {site.Remaining}，卡出生 {site.Stalled}"));
            if (!cleared) Fail($"「{site.title}」{FightLimit + 12f:F0} s 内没有肃清（剩 {site.Remaining}，卡出生 {site.Stalled}）");
            vitals.Heal(99999);
        }

        /// <summary>④ 要求 ② ③：② 还没肃清时站进 ④ 的触发圈深处（不用视线就能触发的地方）2.5 s，④ 不该开战</summary>
        IEnumerator GateCheck(EncounterSite s4, EncounterSite s2)
        {
            Line("── ④ 的前置 ──");
            var back = motor.transform.position;
            var c = s4.transform.position;
            var dir = back - c;
            dir.y = 0;
            dir = dir.sqrMagnitude > 0.01f ? dir.normalized : Vector3.back;
            Teleport(motor, c + dir * Mathf.Max(2f, s4.triggerRadius * 0.3f));
            yield return new WaitForSeconds(2.5f);
            if (s4.phase != EncounterSite.Phase.Idle)
            {
                Fail($"② {s2.phase} 时站进 ④ 的触发圈，④ 开战了（④ 应要求 ② ③）");
                if (s4.phase == EncounterSite.Phase.Active) yield return Fight(s4, "gate");
            }
            else Line($"✓ ② 还没肃清：站在 ④ 中心 {Flat(motor.transform.position - c):F1} m 处 2.5 s，④ 没有开战");
            Teleport(motor, back);
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 藏宝点 / 宝箱 / 出口 ─────────────

        /// <summary>走到藏宝点旁 → 应已发现 → 调查；有守军的先开战、肃清 → 宝箱冒出来 → 打开</summary>
        IEnumerator Investigate(CachePOI cache, string label)
        {
            Line($"── 藏宝点「{label}」──");
            yield return WalkTo(cache.transform.position, label, null, 2.2f);
            float t0 = Time.time;
            while (!cache.Discovered && Time.time - t0 < 1.5f) yield return null;
            if (!cache.Discovered)
            {
                Fail($"走到「{cache.title}」旁 {Flat(motor.transform.position - cache.transform.position):F1} m 还没发现（发现半径 {cache.discoverRadius} m，要看得见）");
                yield break;
            }
            Line($"✓ 发现「{cache.title}」");
            Aim(motor, eye, cache.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as CachePOI != cache)
            {
                Fail($"站在「{cache.title}」旁没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                yield break;
            }
            Shot(weapons.eye, $"map11_cache_{(cache.guard ? "guarded" : "plain")}");
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.5f);
            interactor.testInteract = false;
            if (cache.guard)
            {
                if (cache.guard.phase == EncounterSite.Phase.Idle)
                {
                    Fail($"调查「{cache.title}」没有惊动守军");
                    yield break;
                }
                Line($"调查 → 守军开战：{cache.guard.Total} 只");
                if (cache.Claimed) Fail("守军还没肃清宝箱就出来了");
                yield return Fight(cache.guard, "cache_guard");
            }
            t0 = Time.time;
            while (!cache.RewardChest && Time.time - t0 < 3f) yield return null;
            if (!cache.RewardChest)
            {
                Fail($"「{cache.title}」{(cache.guard ? "守军肃清后" : "调查后")}没有出现宝箱");
                yield break;
            }
            int level0 = weapons.Active != null ? weapons.Active.level : 0;
            yield return OpenChest(cache.RewardChest, $"{cache.title}宝箱");
            if (cache.reward == "upgrade" && weapons.Active != null)
                Line($"  当前武器 {weapons.Active.def.name}：+{level0} → +{weapons.Active.level}");
        }

        /// <summary>走到宝箱前 1.8 m、看着它按 F；秘卷三选一弹出就选第一张</summary>
        IEnumerator OpenChest(Chest chest, string label)
        {
            var p = chest.transform.position;
            var from = motor.transform.position - p;
            from.y = 0;
            var stand = p + (from.sqrMagnitude > 0.01f ? from.normalized : Vector3.back) * 1.8f;
            float dist = Flat(motor.transform.position - p);
            if (dist > 4f)
            {
                yield return WalkTo(stand, label, null, 0.6f);
                // 走到站位的容差是 0.6 m：可能停在离宝箱 2.4 m 处——宝箱交互半径 2.6 m 是眼睛（1.62 m）到焦点（离地 0.6 m）的直线距离，
                // 折成水平只有约 2.4 m（同 TS 的 2.3 m 水平半径），停在那里本来就没有提示。从停下的方向补最后一步
                from = motor.transform.position - p;
                from.y = 0;
                if (from.sqrMagnitude > 0.01f) stand = p + from.normalized * 1.8f;
                dist = Flat(motor.transform.position - p);
            }
            if (dist > 1.9f) Teleport(motor, stand); // 最后一两步挪近
            else if (dist < 1.2f) Teleport(motor, stand); // 贴得太近（宝箱从脚下冒出来）退半步
            yield return new WaitForSeconds(0.6f); // 宝箱冒出 / 落地的动画
            Aim(motor, eye, chest.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as Chest != chest)
            {
                Fail($"站在「{label}」前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}，离 {Flat(motor.transform.position - p):F1} m）");
                yield break;
            }
            interactor.testInteract = true;
            float r0 = Time.realtimeSinceStartup;
            while (!chest.Opened && Time.realtimeSinceStartup - r0 < 2f) yield return null;
            yield return new WaitForSecondsRealtime(0.6f);
            if (ScrollChoice.Open)
            {
                ScrollChoice.Pick(0);
                yield return null;
            }
            Line($"  {(chest.Opened ? "✓" : "✗")} 打开「{label}」（{chest.reward}）");
            if (!chest.Opened) Fail($"「{label}」按了交互没有打开");
        }

        /// <summary>目标完成 → 出口升起 → 清关宝箱 → 进门结算，下一关 1-2</summary>
        IEnumerator ExitStage(ExitPortal portal, LevelObjective objective)
        {
            Line("── 出口 ──");
            float t0 = Time.time;
            while (!portal.IsOpen && Time.time - t0 < 2f) yield return null;
            Line($"目标：{(objective.Complete ? "完成" : objective.Describe())}，出口 {(portal.IsOpen ? "已开启" : "未开启")}");
            if (!objective.Complete) Fail("四个必清场地肃清后目标没有完成");
            if (!portal.IsOpen)
            {
                Fail("目标完成后出口没有开启");
                yield break;
            }
            var front = portal.transform.position - portal.transform.forward * 4f;
            yield return WalkTo(front, "出口祭坛", null, 1f);
            t0 = Time.time;
            while (!portal.Risen && Time.time - t0 < portal.riseTime + 2f) yield return null;
            if (!portal.Risen) Fail($"出口 {portal.riseTime + 2f:F1} s 内没有升起（{portal.Rise:P0}）");
            t0 = Time.time;
            while (!portal.ClearChest && Time.time - t0 < 2f) yield return null;
            if (!portal.ClearChest) Fail("出口升起后没有清关宝箱");
            else yield return OpenChest(portal.ClearChest, "清关宝箱");

            if (Flat(motor.transform.position - front) > 1.5f) yield return WalkTo(front, "出口祭坛", null, 0.8f);
            Aim(motor, eye, portal.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as ExitPortal != portal) Fail($"站在出口前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            Line($"出口提示：{portal.Prompt}");
            Shot(weapons.eye, "map11_exit");
            interactor.testInteract = true;
            yield return new WaitForSecondsRealtime(0.5f);
            var session = GameSession.Instance;
            bool done = session && session.Completed;
            var next = RunPlan.Next(session && session.Stage != null ? session.Stage : RunPlan.ForScene(portal.gameObject.scene.path));
            Line($"进入出口：{(done ? "关卡完成" : "没有结算")}，下一关 {next?.Label ?? "无"}");
            if (!done) Fail("进入出口后没有关卡结算");
            if (next == null || next.code != "1-2") Fail("结算的下一关不是 1-2");
            Shot(weapons.eye, "map11_complete");
            session?.SetModal(false);
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
        static string Fmt(Vector3 p) => $"({p.x:F0}, {p.z:F0})";
    }
}
