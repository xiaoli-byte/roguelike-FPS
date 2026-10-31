using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 4-1 折多垭口·天路草甸整图冒烟（bridge.sh playtest map-4-1；docs/level-design/maps/4-1.md §10）：
    ///   · 静态：灵火坛 6 座、要点亮 3 座；7 处遇敌都是可选场地；3 个领主擂台（夔 / 飞廉 / 化蛇）各有 BossArena 与 BossEncounter；出口开局关着；
    ///     没有空气墙（Ignore Raycast 层的实体碰撞体只在兜底环上）；
    ///   · 走天路：从出生点沿天路标记（Route_Road_*，构建器每 15 m 摆一个）用角色控制器逐帧走到垭口（不瞬移，卡住 1.5 s 才跳点并记一次），
    ///     路上关掉场地的自动触发（只测路）；量用时、爬升、卡住次数；
    ///   · 点灵火：① 碉楼寨 ② 白塔溪谷 ③ 牧民营地——开战、清场（补刀：地图冒烟不测平衡）、站到灵火坛前按住交互点亮；三处点亮后目标完成、出口升起；
    ///   · 软边界：往盆地外五个方向（北、东、南、西、西南）从界内 8 m 处冲出去 5 s，再松手 2.5 s：最远只到起风线外几米、最后被推回起风线以内，没有撞墙。
    /// 玩家全程无敌。
    /// </summary>
    public sealed class Map41Suite : PlaytestSuite
    {
        public override string Id => "map-4-1";
        /// <summary>4-1 折多垭口（与编辑器里 Level_4_1.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L4_1_Zheduo.unity";

        const float BotSpeed = 9f;

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        CharacterController cc;
        Transform eye;
        int stalls;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            weapons = FindAnyObjectByType<WeaponController>();
            interactor = FindAnyObjectByType<Interactor>();
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
            vitals.invulnerableUntil = Time.time + 99999;
            vitals.Heal(99999);

            var portal = FindAnyObjectByType<ExitPortal>();
            var objective = portal ? LevelObjective.For(portal.gameObject.scene) : FindAnyObjectByType<LevelObjective>();
            var altars = FindObjectsByType<SpiritAltar>().OrderBy(a => a.name).ToArray();
            var sites = FindObjectsByType<EncounterSite>().ToArray();
            if (!portal || !objective || altars.Length == 0)
            {
                Fail($"场景不是 4-1（先 bridge.sh level 4-1）：出口 {(bool)portal}，目标 {(bool)objective}，灵火坛 {altars.Length}");
                yield break;
            }
            // 穷奇（关卡运行时开局刷）：确认刷出来、拿到了 4-1 的游猎线，再清掉（走路、点灵火不要被它追着撞）
            var level = FindAnyObjectByType<ZheduoLevel>();
            float w0 = Time.time;
            while (level && !level.RoamerSpawned && Time.time - w0 < 8f) yield return null;
            yield return null;
            if (!level) Fail("场景里没有 ZheduoLevel（穷奇游猎线 / 啸獭洞口）");
            else
            {
                var q = level.Roamer;
                Line($"穷奇：{(q ? $"刷在 {Fmt(q.transform.position)}，巡视线 {q.route?.Length ?? 0} 个路点，巢穴 {Fmt(q.lair)}" : "没刷出来（名册里没有 qiongqi？）")}");
                if (q && (q.route == null || q.route.Length != level.roamerRoute.Length)) Fail("穷奇没拿到 4-1 的游猎线");
                EnemyRegistry.PurgeAll();
            }
            float t0 = Time.time;
            StaticChecks(portal, objective, altars, sites);
            yield return NoAirWall();
            yield return WalkTianlu(sites);
            yield return LightThree(altars, objective, portal);
            yield return Boundary();
            Line($"合计用时 {Time.time - t0:F0} s，卡住跳点 {stalls} 次");
            if (stalls >= 6) Fail($"机器人走路卡住 {stalls} 次（地形 / 碰撞和路线对不上：看上面的位置）");
        }

        // ───────────── 静态 ─────────────

        void StaticChecks(ExitPortal portal, LevelObjective objective, SpiritAltar[] altars, EncounterSite[] sites)
        {
            Line("── 静态 ──");
            Line($"目标「{objective.title}」：灵火坛 {objective.altars.Length} 座、要点亮 {objective.AltarsNeeded}，必清 {objective.RequiredTotal}，可选 {objective.optional.Length}");
            if (altars.Length != 6 || objective.AltarsNeeded != 3) Fail("灵火坛应 6 座、要点亮 3 座");
            if (sites.Length != 7 || objective.RequiredTotal != 0 || sites.Any(s => !s.optional)) Fail("遇敌应 7 处、都是可选场地（目标只看灵火）");
            var arenas = FindObjectsByType<BossArena>();
            var ids = arenas.Select(a => a.bossId).OrderBy(x => x).ToArray();
            Line($"领主擂台：{string.Join("、", ids)}；首领流程 {FindObjectsByType<BossEncounter>(FindObjectsInactive.Include).Length} 个");
            foreach (var id in new[] { "boss_feilian", "boss_huashe", "boss_kui" })
                if (!ids.Contains(id)) Fail($"没有 {id} 的 BossArena");
            var stage = RunPlan.ForScene(portal.gameObject.scene.path);
            Line($"本关 {stage?.Label ?? "（RunPlan 里还没有 4-1）"}；出口开局 {(portal.IsOpen ? "开着" : "关着")}");
            if (portal.IsOpen) Fail("开局出口就开着（灵火没点够）");
            int conductors = FindObjectsByType<Conductor>().Length;
            Line($"导体 {conductors} 个（经幡杆、拉则、碉楼、达觉）");
            if (conductors < 20) Fail("导体太少（经幡杆一圈、拉则、碉楼、达觉都该挂 Conductor）");
        }

        /// <summary>没有空气墙：Ignore Raycast 层上的实体碰撞体（兜底环）离等值线都在 failsafe − 3 m 以外</summary>
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
                var b = c.bounds;
                if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
                {
                    var verts = mc.sharedMesh.vertices;
                    for (int i = 0; i < verts.Length; i += 2) nearest = Mathf.Min(nearest, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                }
                else nearest = Mathf.Min(nearest, BoundaryZone.Distance(b.center));
            }
            if (walls == 0) Fail("Ignore Raycast 层上没有兜底环");
            else if (nearest < t.failsafe - 3f) Fail($"还有空气墙：离等值线只有 {nearest:F1} m 的 Ignore Raycast 碰撞体（兜底环应在 +{t.failsafe} m）");
            else Line($"✓ 没有空气墙：Ignore Raycast 层实体碰撞体 {walls} 个，最近的离等值线 {nearest:F1} m");
            yield return null;
        }

        // ───────────── 天路 ─────────────

        IEnumerator WalkTianlu(EncounterSite[] sites)
        {
            Line("── 走天路：出生 → 垭口 ──");
            var marks = FindObjectsByType<Transform>().Where(t => t.name.StartsWith("Route_Road_")).OrderBy(t => t.name).Select(t => t.position).ToList();
            if (marks.Count < 20)
            {
                Fail($"天路标记只有 {marks.Count} 个（构建器应每 15 m 摆一个 Route_Road_*）");
                yield break;
            }
            var auto = sites.ToDictionary(s => s, s => s.autoTrigger);
            foreach (var s in sites) s.autoTrigger = false;
            Teleport(motor, marks[0]);
            yield return new WaitForSeconds(0.5f);
            float t0 = Time.time, walked = 0, lowest = motor.transform.position.y, highest = lowest;
            int stalls0 = stalls;
            var prev = motor.transform.position;
            for (int i = 1; i < marks.Count; i++)
            {
                var target = marks[i];
                float best = Flat(target - motor.transform.position), bestAt = Time.time;
                while (Flat(target - motor.transform.position) > 0.8f)
                {
                    var d = target - motor.transform.position;
                    d.y = 0;
                    var dir = d.normalized;
                    motor.SetLook(Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, 0);
                    if (cc && cc.enabled) cc.Move(dir * Mathf.Min(BotSpeed * Time.deltaTime, d.magnitude) + Vector3.down * 0.5f * Time.deltaTime);
                    yield return null;
                    var p = motor.transform.position;
                    walked += Flat(p - prev);
                    prev = p;
                    lowest = Mathf.Min(lowest, p.y);
                    highest = Mathf.Max(highest, p.y);
                    float now = Flat(target - p);
                    if (now < best - 0.3f)
                    {
                        best = now;
                        bestAt = Time.time;
                    }
                    else if (Time.time - bestAt > 1.5f)
                    {
                        stalls++;
                        Line($"  ⚠ 天路第 {i} 个标记前在 {Fmt(p)} 卡住 1.5 s，跳到 {Fmt(target)}");
                        Teleport(motor, target);
                        prev = motor.transform.position;
                        yield return null;
                        break;
                    }
                }
            }
            foreach (var kv in auto) kv.Key.autoTrigger = kv.Value;
            var end = motor.transform.position;
            float toPass = Flat(end - marks[^1]);
            Line($"走到垭口：{Time.time - t0:F0} s、{walked:F0} m（{marks.Count} 个标记），高度 {lowest:F1} → {highest:F1}，卡住 {stalls - stalls0} 次，离终点 {toPass:F1} m");
            if (stalls - stalls0 > 2) Fail($"沿天路走卡住 {stalls - stalls0} 次（天路应全程不卡：网页行走测试也是）");
            if (toPass > 3) Fail("没走到天路终点");
        }

        // ───────────── 灵火 ─────────────

        IEnumerator LightThree(SpiritAltar[] altars, LevelObjective objective, ExitPortal portal)
        {
            Line("── 点亮三处灵火 ──");
            foreach (var siteId in new[] { "s1", "s2", "s3" })
            {
                var altar = altars.FirstOrDefault(a => a.name.EndsWith("_" + siteId));
                if (!altar)
                {
                    Fail($"找不到 {siteId} 的灵火坛");
                    continue;
                }
                var site = altar.guard;
                if (site)
                {
                    Teleport(motor, altar.transform.position + altar.transform.forward * 4f);
                    yield return new WaitForSeconds(0.3f);
                    if (site.phase == EncounterSite.Phase.Idle) site.Activate();
                    float t0 = Time.time;
                    while (site.phase != EncounterSite.Phase.Cleared && Time.time - t0 < 45f)
                    {
                        EnemyRegistry.PurgeAll();
                        yield return new WaitForSeconds(0.5f);
                    }
                    Line($"{site.title}：{(site.phase == EncounterSite.Phase.Cleared ? $"肃清（{Time.time - t0:F1} s，生成 {site.Spawns.Count} 只）" : "没清完")}");
                    if (site.phase != EncounterSite.Phase.Cleared) Fail($"{site.title} 45 s 没清完");
                }
                yield return new WaitForSeconds(0.3f);
                Teleport(motor, altar.transform.position + altar.transform.forward * 2f);
                yield return new WaitForSeconds(0.3f);
                Aim(motor, eye, altar.Focus);
                yield return new WaitForSeconds(0.2f);
                if (interactor.Current as SpiritAltar != altar)
                {
                    Fail($"{altar.title}：站在坛前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                    continue;
                }
                interactor.testInteract = true;
                float k0 = Time.time;
                while (!altar.Lit && Time.time - k0 < altar.kindleTime + 1.5f) yield return null;
                interactor.testInteract = false;
                Line($"{(altar.Lit ? "✓" : "✗")} {altar.title}：{(altar.Lit ? $"{Time.time - k0:F1} s 点亮" : "没点亮")}，目标 {objective.AltarsLit}/{objective.AltarsNeeded}");
                if (!altar.Lit) Fail($"{altar.title} 没点亮");
            }
            yield return new WaitForSeconds(1f);
            Line($"目标{(objective.Complete ? "完成" : "没完成")}，出口{(portal.IsOpen ? "已开启" : "没开")}");
            if (!objective.Complete || !portal.IsOpen) Fail("点亮三处灵火后目标应完成、经幡门的出口应升起");
            else
            {
                Teleport(motor, portal.transform.position - portal.transform.forward * 8f);
                yield return new WaitForSeconds(portal.riseTime + 0.5f);
                Aim(motor, eye, portal.transform.position + Vector3.up * 2.5f);
                yield return new WaitForSeconds(0.3f);
                Shot(weapons.eye, "map41_gate");
                Line($"出口升起 {(portal.Risen ? "完成" : "没完成")}，清关宝箱 {(portal.ClearChest ? "落下" : "没有")}");
            }
        }

        // ───────────── 软边界 ─────────────

        IEnumerator Boundary()
        {
            Line("── 软边界：往盆地外五个方向冲 ──");
            var zone = BoundaryZone.Active;
            if (!zone) yield break;
            var t = zone.tuning;
            foreach (var name in new[] { "North", "East", "South", "West", "SouthWest" })
            {
                var mark = GameObject.Find($"Escape_{name}");
                if (!mark)
                {
                    Fail($"没有 Escape_{name} 标记");
                    continue;
                }
                var far = mark.transform.position;
                var dir = new Vector3(far.x, 0, far.z).normalized;
                // 从盆地中心往外找界内 8 m 的起点
                Vector3 start = Vector3.zero;
                for (float r = 100; r < 500; r += 2)
                {
                    var p = dir * r;
                    if (BoundaryZone.Distance(p) > -8f) break;
                    start = p;
                }
                Teleport(motor, start);
                yield return new WaitForSeconds(0.4f);
                float maxD = BoundaryZone.Distance(motor.transform.position);
                float t0 = Time.time;
                while (Time.time - t0 < 5f)
                {
                    motor.SetLook(Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, 0);
                    if (cc && cc.enabled) cc.Move(dir * BotSpeed * Time.deltaTime + Vector3.down * 0.5f * Time.deltaTime);
                    yield return null;
                    maxD = Mathf.Max(maxD, BoundaryZone.Distance(motor.transform.position));
                }
                float white = BoundaryZone.PlayerWhiteout;
                if (name == "North") Shot(weapons.eye, "map41_whiteout");
                yield return new WaitForSeconds(2.5f);
                float endD = BoundaryZone.Distance(motor.transform.position);
                Line($"{name}：起点界内 8 m，冲 5 s 最远到等值线外 {maxD:+0.0;-0.0} m（白化 {white:F2}），松手 2.5 s 后 {endD:+0.0;-0.0} m");
                if (maxD > t.failsafe - 2) Fail($"{name}：冲到了兜底环附近（+{maxD:F1} m），软边界没推住");
                if (endD > t.softStart + 1f) Fail($"{name}：松手后还在起风线外 {endD:F1} m（没被推回）");
                if (vitals.Dead) Fail($"{name}：被推回时死了");
            }
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
        static string Fmt(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";
    }
}
