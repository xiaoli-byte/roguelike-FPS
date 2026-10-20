using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 遭遇框架 v2 / 目标图冒烟（bridge.sh playtest encounter；场景 TestArena，标记见 Level_TestArena.EncounterMarkers）。
    /// 组件全部在运行时挂到标记的位置上（测试场平时没有遭遇战；场景没重建、没有标记时用同样的坐标）：
    ///   · 站位（不刷怪，PreviewStation）：远程类（邪飞天按远程）选 4 m 台顶的高台位；贴地的蝎卫不上高台；精英镇墓兽（冲锋型）选场地远端；
    ///     侧翼按 lane 选对应的侧翼位；出生净空按体型——贴着台壁的点放得下跳鼠、放不下精英镇墓兽。
    ///   · 灵火坛守卫：守卫场地没肃清时点不着。
    ///   · 实战两波（第一波 飞天 + 2 跳鼠，第二波 镇墓兽 + 蝎卫，剩 ≤ 1 只 1 s 后开；升格 1 只精英，假词缀登记给它词缀）：
    ///     从西边进场触发；玩家站到跳鼠的出生预警上 → 预警结束复检不过、换点出生，离玩家 ≥ 6 m；飞天出在高台；
    ///     第一波还剩 3 只时 2.5 s 不开第二波，杀掉两只后开；第二波的精英带词缀、只此一只，冲锋型在场地远端（玩家 → 中心轴线的另一侧）；
    ///     模板编排不被升格改动；全部击杀后肃清。
    ///   · 目标图：必清场地 + 3 座灵火坛点 2 座（可选场地不打）：肃清后 0/2 不开门；点第 1 座不开；点第 2 座（顺带回满血）→ 目标完成 →
    ///     出口开启、石门框升起、门旁落下清关宝箱；第三座保持未点亮。
    ///   · 藏宝点：被 6 m 台挡住时走近也不发现；绕到看得见的地方发现；按交互键调查 → 宝箱出现，只给一次。
    /// </summary>
    public sealed class EncounterSuite : PlaytestSuite
    {
        public override string Id => "encounter";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string TestAffix = "test_affix";

        /// <summary>假的精英词缀登记：只认 test_affix，随机也只给它</summary>
        sealed class FakeAffixes : IEliteAffixSource
        {
            public bool Exists(string affixId) => affixId == TestAffix;
            public string Roll(EnemyDef def, RunRng rng) => TestAffix;
        }

        /// <summary>标记坐标（与 Level_TestArena.EncounterMarkers 相同）：场景里没有同名标记时用这里的</summary>
        static readonly Dictionary<string, Vector3> Fallback = new()
        {
            ["Encounter_Site"] = new Vector3(30, 0, 12),
            ["Encounter_Anchor_Assault"] = new Vector3(34, 0, 10),
            ["Encounter_Anchor_FlankN"] = new Vector3(32, 0, 22),
            ["Encounter_Anchor_FlankS"] = new Vector3(32, 0, 4),
            ["Encounter_Anchor_FarSide"] = new Vector3(44, 0, 12),
            ["Encounter_Anchor_HighDeck"] = new Vector3(34, 4, -4),
            ["Encounter_SiteOptional"] = new Vector3(-40, 0, 44),
            ["Encounter_Altar_1"] = new Vector3(12, 0, -40),
            ["Encounter_Altar_2"] = new Vector3(18, 0, -40),
            ["Encounter_Altar_3"] = new Vector3(24, 0, -40),
            ["Encounter_Cache"] = new Vector3(46, 0, 4),
            ["Encounter_Portal"] = new Vector3(-24, 0, -40),
        };

        PlayerMotor motor;
        PlayerVitals vitals;
        Interactor interactor;
        WeaponController weapons;
        Transform eye;
        readonly List<EncounterSite.SpawnRecord> spawned = new();

        EncounterSite site, optionalSite;
        Transform assault, flankN, flankS, farSide, highDeck;
        SpiritAltar[] altars;
        LevelObjective objective;
        ExitPortal portal;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            interactor = FindAnyObjectByType<Interactor>();
            if (!weapons || !motor || !vitals || !interactor)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals} interactor={interactor}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.Aim; // 交互和瞄准都从不抖的瞄准节点算
            vitals.stats.Add("playtest_encounter", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            var oldAffixes = SquadAffixes.Source;
            SquadAffixes.Source = new FakeAffixes();
            EncounterSite.AnySpawned += OnSpawned;
            try
            {
                int markers = Fallback.Keys.Count(k => GameObject.Find(k));
                Line($"标记：场景里有 {markers}/{Fallback.Count} 个（缺的用套件里的坐标）");
                Build();
                yield return null; // 让新挂的组件跑 Start
                yield return StationChecks();
                yield return GuardedAltar();
                yield return LiveEncounter();
                yield return ObjectiveAndPortal();
                yield return CacheCheck();
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
                SquadAffixes.Source = oldAffixes;
                EnemyRegistry.PurgeAll();
                vitals.stats.Remove("playtest_encounter");
            }
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r)
        {
            if (s == site) spawned.Add(r);
        }

        // ───────────── 搭场 ─────────────

        static Vector3 P(string name)
        {
            var go = GameObject.Find(name);
            var p = go ? go.transform.position : Fallback[name];
            if (go) return p;
            return Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 40, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point : p;
        }

        static Transform Anchor(string name, StationRole role, int lane, bool elevated)
        {
            var a = new GameObject($"Test {name}").AddComponent<SpawnAnchor>();
            a.transform.position = P(name);
            a.role = role;
            a.lane = lane;
            a.elevated = elevated;
            return a.transform;
        }

        /// <summary>玩家进场的位置：场地中心往西 7 m（触发圈 10 m、进场深度 2 m）</summary>
        Vector3 Entry => site.transform.position + Vector3.left * 7f;

        void Build()
        {
            site = new GameObject("Site T · 遭遇冒烟").AddComponent<EncounterSite>();
            site.transform.position = P("Encounter_Site");
            site.title = "遭遇冒烟";
            site.triggerRadius = 10f;
            site.entryDepth = 2f;
            site.arenaRadius = 26f;
            assault = Anchor("Encounter_Anchor_Assault", StationRole.Assault, 0, false);
            flankN = Anchor("Encounter_Anchor_FlankN", StationRole.Flank, 1, false);
            flankS = Anchor("Encounter_Anchor_FlankS", StationRole.Flank, 2, false);
            farSide = Anchor("Encounter_Anchor_FarSide", StationRole.Assault, 0, false);
            highDeck = Anchor("Encounter_Anchor_HighDeck", StationRole.Ranged, 0, true);
            site.anchors = new[] { assault, flankN, flankS, farSide, highDeck };
            site.spec = EncounterSpec.Of(
                    EncounterSpec.Wave("先锋", EncounterSpec.E("apsara", 1, 0).As(StationRole.Ranged), EncounterSpec.E("jerboa_blade", 2, 0.5f)),
                    EncounterSpec.Wave("冲阵", EncounterSpec.E("tomb_beast", 1, 0), EncounterSpec.E("scorpion_archer", 1, 0)).After(1, 1f).Hint("冲锋怪从远端来"))
                .Gather(0.4f).Elites(1);

            optionalSite = new GameObject("Site T · 可选").AddComponent<EncounterSite>();
            optionalSite.transform.position = P("Encounter_SiteOptional");
            optionalSite.title = "可选场地";
            optionalSite.autoTrigger = false;
            optionalSite.optional = true;
            optionalSite.spec = EncounterSpec.Of(EncounterSpec.Wave("", EncounterSpec.E("jerboa_blade", 1)));

            altars = new SpiritAltar[3];
            for (int i = 0; i < 3; i++)
            {
                altars[i] = new GameObject($"Test Altar {i + 1}").AddComponent<SpiritAltar>();
                altars[i].transform.position = P($"Encounter_Altar_{i + 1}");
                altars[i].title = $"测试灵火坛 {i + 1}";
            }
            altars[0].guard = site;

            objective = new GameObject("Test Objective").AddComponent<LevelObjective>();
            objective.title = "遭遇冒烟目标";
            objective.required = new[] { site };
            objective.optional = new[] { optionalSite };
            objective.altars = altars;
            objective.altarsNeeded = 2;
            objective.autoCollect = false;

            var at = P("Encounter_Portal");
            var spawnPos = motor.transform.position;
            var away = at - spawnPos;
            away.y = 0;
            portal = new GameObject("Test Exit Portal").AddComponent<ExitPortal>();
            // 门的正面（-forward）朝出生点
            portal.transform.SetPositionAndRotation(at, Quaternion.LookRotation(away.sqrMagnitude > 0.01f ? away.normalized : Vector3.forward));
            portal.objective = objective;
            portal.buildFrame = true;
            portal.clearReward = "coins";
            portal.nextStage = "测试终点";
        }

        // ───────────── 站位（不刷怪） ─────────────

        IEnumerator StationChecks()
        {
            Line("— 站位 —");
            var entry = Entry;
            void Expect(string what, string id, bool elite, StationRole role, int lane, System.Func<SpawnStations.Station, string> verdict)
            {
                if (!site.PreviewStation(id, elite, role, lane, entry, out var st))
                {
                    Fail($"{what}：选不到站位");
                    return;
                }
                string name = st.anchor ? st.anchor.name : "兜底随机点";
                string bad = verdict(st);
                Line($"{(bad == null ? "✓" : "✗")} {what} → {name} {st.point}（分 {st.score:F1}）");
                if (bad != null) Fail($"{what}：{bad}（选了 {name}）");
            }
            Expect("飞天按远程", "apsara", false, StationRole.Ranged, 0, st => st.anchor == highDeck && st.elevated && st.point.y > 3f ? null : "应选 4 m 台顶的高台位");
            Expect("蝎卫（贴地远程）", "scorpion_archer", false, StationRole.Auto, 0, st => !st.elevated && st.anchor != highDeck && st.point.y < 1.5f ? null : "贴地的敌人不该上高台");
            Expect("精英镇墓兽（冲锋型）", "tomb_beast", true, StationRole.Auto, 0, st =>
            {
                if (st.anchor != farSide) return "冲锋型应从场地远端进场";
                return Beyond(st.point, entry) ? null : "站位不在「玩家 → 中心」轴线的另一侧";
            });
            Expect("跳鼠 lane 1", "jerboa_blade", false, StationRole.Auto, 1, st => st.anchor == flankN ? null : "lane 1 应选北侧翼位");
            Expect("跳鼠 lane 2", "jerboa_blade", false, StationRole.Auto, 2, st => st.anchor == flankS ? null : "lane 2 应选南侧翼位");

            // 出生净空按体型：4 m 台西壁外 0.7 m 的点
            var wall = new Vector3(29.3f, 0, -4f);
            var open = new Vector3(10f, 0, 0f);
            bool smallOk = SpawnStations.BodyClear(wall, EnemyRoster.Get("jerboa_blade"), false);
            bool bigBlocked = !SpawnStations.BodyClear(wall, EnemyRoster.Get("tomb_beast"), true);
            bool bigOpen = SpawnStations.BodyClear(open, EnemyRoster.Get("tomb_beast"), true);
            Line($"{(smallOk && bigBlocked && bigOpen ? "✓" : "✗")} 出生净空：贴台壁 跳鼠 {(smallOk ? "放得下" : "放不下")}、精英镇墓兽 {(bigBlocked ? "放不下" : "放得下")}；空地 精英镇墓兽 {(bigOpen ? "放得下" : "放不下")}");
            if (!smallOk) Fail("贴台壁 0.7 m 放不下跳鼠（净空算大了）");
            if (!bigBlocked) Fail("贴台壁 0.7 m 放得下精英镇墓兽（没按体型查）");
            if (!bigOpen) Fail("空地放不下精英镇墓兽");
            yield break;
        }

        /// <summary>p 在「玩家 → 场地中心」轴线的另一侧（比中心更远）</summary>
        bool Beyond(Vector3 p, Vector3 player)
        {
            var c = site.transform.position;
            var axis = c - player;
            var off = p - c;
            axis.y = off.y = 0;
            return Vector3.Dot(axis, off) > 0;
        }

        // ───────────── 灵火坛守卫 ─────────────

        IEnumerator GuardedAltar()
        {
            Line("— 灵火坛守卫 —");
            var a = altars[0];
            yield return FaceAltar(a);
            if (interactor.Current as SpiritAltar != a)
            {
                Fail($"站在灵火坛前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                yield break;
            }
            Line($"提示：{a.Prompt}");
            interactor.testInteract = true;
            yield return new WaitForSeconds(a.kindleTime + 0.5f);
            interactor.testInteract = false;
            Line($"{(!a.Lit ? "✓" : "✗")} 守卫没清时按交互：{(a.Lit ? "点着了" : "点不着")}");
            if (a.Lit || a.Kindling) Fail("守卫场地没肃清，灵火坛却点着了");
        }

        IEnumerator FaceAltar(SpiritAltar a)
        {
            Teleport(motor, a.transform.position + Vector3.back * 2f);
            yield return new WaitForSeconds(0.3f);
            Aim(motor, eye, a.Focus);
            yield return new WaitForSeconds(0.15f);
        }

        // ───────────── 实战两波 ─────────────

        IEnumerator LiveEncounter()
        {
            Line("— 实战两波 —");
            spawned.Clear();
            var c = site.transform.position;
            Teleport(motor, Entry);
            Aim(motor, eye, c + Vector3.up * 1.2f);
            float t0 = Time.time;
            while (site.phase == EncounterSite.Phase.Idle && Time.time - t0 < 3f) yield return null;
            if (site.phase == EncounterSite.Phase.Idle)
            {
                Fail("站进触发圈 3 s 后没有开战");
                yield break;
            }
            Line($"开战：{site.Total} 只、{site.WaveCount} 波，升格精英 {site.Promoted} 只");
            if (site.Total != 5) Fail($"总数 {site.Total}（应为 5）");
            if (site.Promoted != 1) Fail($"升格 {site.Promoted} 只（应为 1）");
            int templateElites = site.spec.waves.Sum(w => w.entries.Count(e => e.elite));
            if (templateElites != 0) Fail($"模板编排被升格改动了（模板里出现 {templateElites} 条精英）");

            // 复检：站到第一只跳鼠的出生预警上（离高台位 12 m 以上的那只：站得太近会把高台上的飞天也挤去换点）
            var warns = new List<(string id, Vector3 pos)>();
            Vector3? stood = null;
            t0 = Time.time;
            while (stood == null && Time.time - t0 < 3f)
            {
                site.PendingWarnings(warns);
                foreach (var w in warns)
                    if (w.id == "jerboa_blade" && Flat(w.pos - highDeck.position) >= 12f)
                    {
                        stood = w.pos;
                        break;
                    }
                if (stood == null) yield return null;
            }
            if (stood == null) Fail("3 s 内没有跳鼠的出生预警");
            else
            {
                int rel0 = site.Relocations;
                Teleport(motor, stood.Value);
                t0 = Time.time;
                while (site.Relocations == rel0 && Time.time - t0 < 2f) yield return null;
                Line($"{(site.Relocations > rel0 ? "✓" : "✗")} 站上跳鼠预警 {stood.Value} → 换点 {site.Relocations - rel0} 次");
                if (site.Relocations == rel0) Fail("玩家站在出生预警上，预警结束没有换点");
            }

            // 第一波出完
            t0 = Time.time;
            while ((spawned.Count(r => r.wave == 0) < 3 || site.PendingCount > 0) && Time.time - t0 < 8f) yield return null;
            var w1 = spawned.Where(r => r.wave == 0).ToList();
            foreach (var r in w1) Line($"  第一波 {r.id}：{(r.anchor ? r.anchor.name : "兜底随机点")} {r.point}{(r.elevated ? "（高台）" : "")}{(r.relocated ? "（换过点）" : "")}，离玩家 {Flat(r.point - r.player):F1} m");
            if (w1.Count != 3) Fail($"第一波出了 {w1.Count} 只（应为 3）");
            Shot(weapons.eye, "encounter_wave1");
            var aps = w1.FirstOrDefault(r => r.id == "apsara");
            if (aps.ai && (aps.anchor != highDeck || aps.point.y < 3f)) Fail($"飞天（按远程）没出在高台位（{(aps.anchor ? aps.anchor.name : "兜底")} y = {aps.point.y:F1}）");
            foreach (var r in w1.Where(r => r.id == "jerboa_blade"))
            {
                if (r.elevated) Fail("跳鼠出在了高台位");
                if (stood != null && Flat(r.point - stood.Value) < 3f) Fail($"跳鼠还是出在玩家站着的预警点上（{Flat(r.point - stood.Value):F1} m）");
                if (Flat(r.point - r.player) < 5.9f) Fail($"跳鼠出生点离玩家只有 {Flat(r.point - r.player):F1} m");
            }
            if (stood != null && !w1.Any(r => r.relocated)) Fail("出场记录里没有换过点的跳鼠");

            // 波次：剩 3 只 > 1，不开第二波
            Teleport(motor, Entry);
            Aim(motor, eye, c + Vector3.up * 1.2f);
            yield return new WaitForSeconds(2.5f);
            Line($"{(site.Wave == 0 ? "✓" : "✗")} 第一波还剩 {site.AliveCount} 只时，2.5 s 后仍是第 {site.Wave + 1} 波");
            if (site.Wave != 0) Fail("上一波还剩 3 只（门槛 1 只）就开了下一波");
            foreach (var r in w1)
                if (r.id == "jerboa_blade" && r.ai && !r.ai.Dead) Combat.Execute(r.ai.Health, true);
            t0 = Time.time;
            while (site.Wave < 1 && Time.time - t0 < 4f) yield return null;
            Line($"{(site.Wave == 1 ? "✓" : "✗")} 杀掉两只跳鼠（剩 {site.AliveCount}）→ {Time.time - t0:F1} s 后第 {site.Wave + 1} 波");
            if (site.Wave != 1)
            {
                Fail("剩 ≤ 1 只后 4 s 内没有开第二波");
                yield break;
            }

            // 第二波
            t0 = Time.time;
            while ((spawned.Count < 5 || site.PendingCount > 0) && Time.time - t0 < 8f) yield return null;
            var w2 = spawned.Where(r => r.wave == 1).ToList();
            foreach (var r in w2) Line($"  第二波 {r.id}{(r.elite ? "（精英）" : "")}：{(r.anchor ? r.anchor.name : "兜底随机点")} {r.point}，词缀 {r.affix ?? "无"}");
            if (w2.Count != 2) Fail($"第二波出了 {w2.Count} 只（应为 2）");
            var elites = spawned.Where(r => r.elite).ToList();
            if (elites.Count != 1) Fail($"整场出了 {elites.Count} 只精英（升格 1 只）");
            foreach (var r in spawned)
            {
                if (r.elite && r.affix != TestAffix) Fail($"精英 {r.id} 的词缀是 {r.affix ?? "无"}（词缀登记应给 {TestAffix}）");
                if (!r.elite && r.affix != null) Fail($"普通 {r.id} 带了词缀 {r.affix}");
            }
            var beast = w2.FirstOrDefault(r => r.id == "tomb_beast");
            if (beast.ai)
            {
                Line($"{(Beyond(beast.point, beast.player) ? "✓" : "✗")} 镇墓兽（冲锋型）出在 {(beast.anchor ? beast.anchor.name : "兜底随机点")}");
                if (!Beyond(beast.point, beast.player)) Fail("冲锋型没从场地远端进场（出生点在玩家这一侧）");
            }
            var scorp = w2.FirstOrDefault(r => r.id == "scorpion_archer");
            if (scorp.ai && (scorp.elevated || scorp.point.y > 1.5f)) Fail("贴地的蝎卫出在了高台上");
            Shot(weapons.eye, "encounter_wave2");

            // 肃清
            foreach (var r in spawned)
                if (r.ai && !r.ai.Dead) Combat.Execute(r.ai.Health, true);
            t0 = Time.time;
            while (site.phase != EncounterSite.Phase.Cleared && Time.time - t0 < 3f) yield return null;
            Line($"{(site.phase == EncounterSite.Phase.Cleared ? "✓" : "✗")} 全部击杀 → {site.phase}（剩余 {site.Remaining}）");
            if (site.phase != EncounterSite.Phase.Cleared) Fail("全部击杀后场地没有肃清");
        }

        // ───────────── 目标图 + 出口 ─────────────

        IEnumerator ObjectiveAndPortal()
        {
            Line("— 目标图 + 出口 —");
            yield return null;
            Line($"肃清后：{objective.Describe()}，出口 {(portal.IsOpen ? "已开" : "未开")}");
            if (objective.Complete) Fail("必清场地肃清、灵火 0/2 时目标就完成了");
            if (portal.IsOpen) Fail("目标没完成出口就开了");

            yield return Light(altars[0], "守卫已清的 1 号坛");
            Line($"点亮 1 座：{objective.Describe()}，出口 {(portal.IsOpen ? "已开" : "未开")}");
            if (objective.Complete || portal.IsOpen) Fail("只点亮 1/2 座灵火，目标就完成了");

            vitals.health = Mathf.Round(vitals.MaxHealth * 0.4f);
            float hp0 = vitals.health;
            yield return Light(altars[1], "2 号坛");
            Line($"点亮回血：{hp0:F0} → {vitals.health:F0} / {vitals.MaxHealth:F0}");
            if (vitals.health < vitals.MaxHealth - 0.5f) Fail("点亮灵火没有回满生命");
            float t0 = Time.time;
            while (!(objective.Complete && portal.IsOpen) && Time.time - t0 < 1f) yield return null;
            Line($"{(objective.Complete ? "✓" : "✗")} 目标：完成={objective.Complete}（必清 {objective.RequiredCleared}/{objective.RequiredTotal}，灵火 {objective.AltarsLit}/{objective.AltarsNeeded}，可选 {objective.OptionalCleared}/{objective.optional.Length}）");
            if (!objective.Complete) Fail("必清场地肃清 + 灵火 2/3 后目标没有完成");
            if (!portal.IsOpen)
            {
                Fail("目标完成后出口没有开启");
                yield break;
            }
            Teleport(motor, portal.transform.position - portal.transform.forward * 9f);
            Aim(motor, eye, portal.Focus);
            yield return new WaitForSeconds(portal.riseTime * 0.5f);
            Line($"升起中：{portal.Rise:P0}");
            Shot(weapons.eye, "encounter_portal_rising");
            t0 = Time.time;
            while (!portal.Risen && Time.time - t0 < portal.riseTime + 1.5f) yield return null;
            if (!portal.Risen) Fail($"出口 {portal.riseTime + 1.5f:F1} s 内没有升起（{portal.Rise:P0}）");
            t0 = Time.time;
            while (!portal.ClearChest && Time.time - t0 < 1.5f) yield return null;
            var chest = portal.ClearChest;
            Line($"{(chest ? "✓" : "✗")} 清关宝箱：{(chest ? $"{chest.reward}，离门 {Flat(chest.transform.position - portal.transform.position):F1} m" : "没有")}");
            if (!chest) Fail("出口升起后没有清关宝箱");
            else if (chest.reward != "coins") Fail($"清关宝箱奖励 {chest.reward}（应为出口写的 coins）");
            else if (Flat(chest.transform.position - portal.transform.position) > 8f) Fail("清关宝箱离出口太远");
            Shot(weapons.eye, "encounter_portal");
            if (altars[2].Lit) Fail("第 3 座灵火坛不该被点亮（N 选 M）");
            if (optionalSite.phase != EncounterSite.Phase.Idle) Fail("可选场地被动过了");
        }

        IEnumerator Light(SpiritAltar a, string what)
        {
            yield return FaceAltar(a);
            if (interactor.Current as SpiritAltar != a)
            {
                Fail($"{what}：没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                yield break;
            }
            interactor.testInteract = true;
            float t0 = Time.time;
            while (!a.Lit && Time.time - t0 < a.kindleTime + 1f) yield return null;
            interactor.testInteract = false;
            Line($"{(a.Lit ? "✓" : "✗")} {what}：{(a.Lit ? $"{Time.time - t0:F1} s 点亮" : "没点亮")}");
            if (!a.Lit) Fail($"{what}按住交互 {a.kindleTime + 1f:F1} s 没有点亮");
        }

        // ───────────── 藏宝点 ─────────────

        IEnumerator CacheCheck()
        {
            Line("— 藏宝点 —");
            var cache = new GameObject("Test Cache").AddComponent<CachePOI>();
            cache.transform.position = P("Encounter_Cache");
            cache.title = "测试物资";
            cache.reward = "coins";
            cache.discoverRadius = 18f;
            yield return null;
            var cp = cache.transform.position;
            // 6 m 台挡在中间：17 m，看不见
            Teleport(motor, new Vector3(cp.x - 6f, 0, cp.z - 16f));
            yield return new WaitForSeconds(1f);
            Line($"{(!cache.Discovered ? "✓" : "✗")} 被 6 m 台挡住（{Flat(motor.transform.position - cp):F1} m）：{(cache.Discovered ? "发现了" : "没发现")}");
            if (cache.Discovered) Fail("藏宝点被高台挡住还是被发现了（发现要看得见）");
            Teleport(motor, cp + new Vector3(8f, 0, 0));
            yield return new WaitForSeconds(1f);
            Line($"{(cache.Discovered ? "✓" : "✗")} 绕到看得见的地方（8 m）：{(cache.Discovered ? "发现了" : "没发现")}");
            if (!cache.Discovered)
            {
                Fail("走到 8 m、看得见，藏宝点没有被发现");
                yield break;
            }
            Teleport(motor, cp + new Vector3(2.2f, 0, 0));
            yield return new WaitForSeconds(0.3f);
            Aim(motor, eye, cache.Focus);
            yield return new WaitForSeconds(0.15f);
            if (interactor.Current as CachePOI != cache)
            {
                Fail($"站在藏宝点前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                yield break;
            }
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.8f);
            interactor.testInteract = false;
            var chest = cache.RewardChest;
            Line($"{(cache.Claimed && chest ? "✓" : "✗")} 调查：{(chest ? $"宝箱 {chest.reward}" : "没有宝箱")}");
            if (!cache.Claimed || !chest) Fail("调查藏宝点后没有出现宝箱");
            else if (chest.reward != "coins") Fail($"藏宝点宝箱奖励 {chest.reward}（应为 coins）");
            Shot(weapons.eye, "encounter_cache");
            // 只给一次
            Aim(motor, eye, cache.Focus);
            yield return new WaitForSeconds(0.2f);
            if (interactor.Current as CachePOI == cache) Fail("调查过的藏宝点还能再调查");
            int near = FindObjectsByType<Chest>().Count(ch => Flat(ch.transform.position - cp) < 3f);
            if (near != 1) Fail($"藏宝点附近有 {near} 个宝箱（应为 1）");
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
    }
}
