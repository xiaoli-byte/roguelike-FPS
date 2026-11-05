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
    /// 第三章编组库冒烟（bridge.sh playtest squads-ch3；场景 TestArena；docs/level-design/ch3-v2.md 第 4 节、7.2 S1 / S2）：
    ///   在测试场中间临时搭一个场地，四周摆齐七种出场方式的站位（现身 / 埋伏 / 余烬起身 / 熔岩爬出 / 飞临 / 跃下 / 增援门），
    ///   G01–G14 逐组刷出（默认编制），机器人用开局配装（代表配装）自动瞄最近的能打的敌人打，最多 60 s（浸泡），记清场时间。
    ///   每组查：编组自查（每波 ≤ 3 种、远程 ≤ 3）；20 s 内全部出场；条目要的出场方式在这里有站位、条件也够（余烬只给炭童、飞临只给会飞的、
    ///   熔岩爬出要场上有熔岩）时真的用上了；埋伏单位先预生成休眠、开战后全部苏醒；60 s 后没有还在休眠的、没有卡在出场位移里的。
    ///   没清完只记一行（清场时间看配装，不当失败），场上剩下的清掉再跑下一组。运行时报错由宿主记不合格。
    /// 试玩一次最多 600 s（Playtest.cs）：14 组 × 60 s 跑不完，拆成两个套件——squads-ch3 跑 G01–G07，squads-ch3b 跑 G08–G14。
    /// </summary>
    public sealed class Ch3SquadSuite : Ch3SquadSuiteBase
    {
        public override string Id => "squads-ch3";
        protected override int First => 0;
        protected override int Last => 6;
    }

    /// <summary>第三章编组库冒烟的后半（G08–G14），见 <see cref="Ch3SquadSuite"/></summary>
    public sealed class Ch3SquadSuiteB : Ch3SquadSuiteBase
    {
        public override string Id => "squads-ch3b";
        protected override int First => 7;
        protected override int Last => 13;
    }

    /// <summary>第三章编组库冒烟的共用部分：<see cref="First"/>…<see cref="Last"/>（InfernoSquads.All 的下标）逐组跑</summary>
    public abstract class Ch3SquadSuiteBase : PlaytestSuite
    {
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected abstract int First { get; }
        protected abstract int Last { get; }

        const float Soak = 60f, SpawnAllWithin = 20f;

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Transform eye;
        Camera cam;
        readonly List<EncounterSite.SpawnRecord> spawned = new();
        readonly List<(string id, string name, int total, float clear, string modes)> table = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 TestArena？）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.Aim;
            cam = weapons.eye;
            vitals.stats.Add("playtest_squads", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EncounterSite.AnySpawned += OnSpawned;
            // 测试场自己的场地不能插进来：先停用
            var own = FindObjectsByType<EncounterSite>().Where(s => s.enabled).ToList();
            foreach (var s in own) s.enabled = false;
            try
            {
                var center = ArenaCenter();
                bool lava = LavaField.Any;
                Line($"测试场中心 {center}，熔岩系统 {(lava ? "有" : "没有（熔岩爬出退回现身）")}，配装：{weapons.Active?.def?.name ?? "无"}");
                for (int i = First; i <= Last && i < InfernoSquads.All.Count; i++) yield return RunSquad(InfernoSquads.All[i], center, lava);
                Line("— 清场时间（代表配装，最多 60 s）—");
                foreach (var r in table)
                    Line($"{r.id} {r.name}：{r.total} 只，{(r.clear >= 0 ? $"{r.clear:F0} s 清完" : "60 s 没清完")}；出场 {r.modes}");
            }
            finally
            {
                EncounterSite.AnySpawned -= OnSpawned;
                EnemyRegistry.PurgeAll();
                foreach (var s in own)
                    if (s)
                        s.enabled = true;
                vitals.stats.Remove("playtest_squads");
            }
        }

        void OnSpawned(EncounterSite s, EncounterSite.SpawnRecord r) => spawned.Add(r);

        /// <summary>测试场的场地中心：EncounterSuite 用的 Encounter_Site 标记，没有就取玩家前方 20 m 的地面</summary>
        Vector3 ArenaCenter()
        {
            var go = GameObject.Find("Encounter_Site");
            var p = go ? go.transform.position : motor.transform.position + Flat(motor.transform.forward) * 20f;
            return NavMesh.SamplePosition(p, out var hit, 8f, NavMesh.AllAreas) ? hit.position : p;
        }

        /// <summary>
        /// 一圈七种出场方式的站位：现身 ×4、埋伏 ×3（一个高台）、余烬 ×4、熔岩爬出 ×3（找得到熔岩时）、飞临 ×3（高台，入场点自动）、
        /// 跃下 ×2（起跳点在站位外侧 4 m、上方 5 m）、增援门 ×2（门后 10 m）。全部贴在导航网格上
        /// </summary>
        List<Transform> BuildAnchors(Transform root, Vector3 c)
        {
            var list = new List<Transform>();
            int n = 0;
            SpawnAnchor A(string name, float angle, float r, StationRole role, SpawnMode mode, bool elevated = false)
            {
                var dir = new Vector3(Mathf.Cos(angle * Mathf.Deg2Rad), 0, Mathf.Sin(angle * Mathf.Deg2Rad));
                var p = c + dir * r;
                if (NavMesh.SamplePosition(p, out var hit, 6f, NavMesh.AllAreas)) p = hit.position;
                var a = SpawnAnchor.Create(root, $"Squad {name} {n++}", p, role, n % 3, elevated).Via(mode).LookAt(c);
                list.Add(a.transform);
                return a;
            }
            for (int i = 0; i < 4; i++) A("现身", i * 90 + 20, 16, StationRole.Auto, SpawnMode.Appear);
            A("埋伏", 200, 18, StationRole.Ranged, SpawnMode.Ambush);
            A("埋伏", 250, 20, StationRole.Artillery, SpawnMode.Ambush);
            A("埋伏", 300, 18, StationRole.Support, SpawnMode.Ambush);
            var high = GameObject.Find("Encounter_Anchor_HighDeck");
            if (high)
            {
                var a = SpawnAnchor.Create(root, "Squad 埋伏 高台", high.transform.position, StationRole.Precision, 0, true).Via(SpawnMode.Ambush).LookAt(c);
                list.Add(a.transform);
            }
            else A("埋伏", 150, 20, StationRole.Precision, SpawnMode.Ambush);
            for (int i = 0; i < 4; i++) A("余烬", i * 90 + 60, 13, StationRole.Auto, SpawnMode.Ember);
            // 熔岩爬出：站位放在离场地最近的熔岩岸上（测试场的熔岩条带在场地外侧），冒出点由场地自己在站位外 3–8 m 的熔岩里找
            if (LavaField.NearestLava(c, 80f, out var lava, out var bank))
            {
                var along = Vector3.Cross(Vector3.up, Flat(lava - bank));
                for (int i = -1; i <= 1; i++)
                {
                    var p = bank - Flat(lava - bank) * 1.5f + along * (i * 4f);
                    if (NavMesh.SamplePosition(p, out var hit, 4f, LavaField.WalkerFilter(LavaField.DryAreaMask))) p = hit.position;
                    var a = SpawnAnchor.Create(root, $"Squad 熔岩 {n++}", p, StationRole.Auto, n % 3).Via(SpawnMode.LavaCrawl).LookAt(c);
                    list.Add(a.transform);
                }
            }
            else
                for (int i = 0; i < 3; i++) A("熔岩", i * 120 + 10, 15, StationRole.Auto, SpawnMode.LavaCrawl);
            for (int i = 0; i < 3; i++) A("飞临", i * 120 + 40, 17, StationRole.Auto, SpawnMode.FlyIn, true);
            for (int i = 0; i < 2; i++)
            {
                var a = A("跃下", i * 180 + 100, 15, StationRole.Ranged, SpawnMode.Drop);
                var outward = Flat(a.transform.position - c);
                a.DropFrom(a.transform.position + outward * 4f + Vector3.up * 5f);
            }
            for (int i = 0; i < 2; i++)
            {
                var a = A("增援门", i * 180 + 135, 14, StationRole.Auto, SpawnMode.Gate);
                var outward = Flat(a.transform.position - c);
                var g = a.transform.position + outward * 10f;
                if (NavMesh.SamplePosition(g, out var gh, 6f, NavMesh.AllAreas)) g = gh.position;
                a.Gate(g);
            }
            return list;
        }

        IEnumerator RunSquad(InfernoSquads.Squad sq, Vector3 center, bool lava)
        {
            EnemyRegistry.PurgeAll();
            yield return null;
            var wave = sq.make();
            var spec = EncounterSpec.Of(wave).Gather(0.3f).Distance(8, 34);
            var problems = new List<string>();
            InfernoSquads.Check(spec, sq.id, problems.Add);
            foreach (var p in problems) Fail(p);

            var root = new GameObject($"Squad Test · {sq.id}");
            root.transform.position = center;
            var site = root.AddComponent<EncounterSite>();
            site.title = $"{sq.id} {sq.name}";
            site.autoTrigger = false;
            site.triggerRadius = 14;
            site.arenaRadius = 26;
            site.anchors = BuildAnchors(root.transform, center).ToArray();
            site.spec = spec;
            spawned.Clear();
            // 熔岩爬出的站位在熔岩岸上，可能离场地中心远：距离带放宽一点
            spec.maxPlayerDistance = Mathf.Max(spec.maxPlayerDistance, 40f);
            var entry = center + Vector3.left * 9f;
            Teleport(motor, entry);
            vitals.Heal(99999);
            Aim(motor, eye, center + Vector3.up);
            // 先让场地看到玩家（埋伏单位在预生成半径内就摆上场），再开战
            yield return new WaitForSeconds(0.6f);
            int armed = site.ArmedCount, sleeping = site.SleepingCount;
            int wantAmbush = wave.entries.Where(e => e.via == SpawnMode.Ambush).Sum(e => e.count);
            if (wantAmbush > 0 && armed == 0) Fail($"{sq.id}：有 {wantAmbush} 只要埋伏，开战前一只都没有预生成");
            if (sleeping != armed) Fail($"{sq.id}：预生成 {armed} 只，休眠的只有 {sleeping} 只（应全部休眠）");
            if (armed > 0 && EnemyRegistry.Live.Any(e => e && e.enabled && !e.Dead && e.transform.IsChildOf(root.transform)))
                Fail($"{sq.id}：开战前就有醒着的单位");
            site.Activate();
            float t0 = Time.time, clearAt = -1;
            bool shot = false;
            while (Time.time - t0 < Soak)
            {
                if (site.phase == EncounterSite.Phase.Cleared)
                {
                    clearAt = Time.time - t0;
                    break;
                }
                if (vitals.Dead) vitals.Revive();
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                if (weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
                var target = NearestEnemy(eye.position);
                if (target)
                {
                    var aim = BodyCenter(target);
                    Aim(motor, eye, aim);
                    // 还有没出场的时候站着不动（只转身开枪）：出场方式的站位按入场位置摆，机器人乱跳会把站位挤出距离带、退回现身
                    if (site.PendingCount == 0 && (Vector3.Distance(eye.position, aim) > 22f || Combat.Blocked(eye.position, aim, target.GetComponent<Collider>())))
                    {
                        if (SightSpot(target, aim, out var spot)) Teleport(motor, spot);
                    }
                    weapons.testFire = weapons.Active != null && (weapons.Active.def.mode != FireMode.Semi || !weapons.testFire);
                }
                else weapons.testFire = false;
                if (!shot && Time.time - t0 > 2.5f)
                {
                    shot = true;
                    Shot(cam, $"squads_{sq.id}");
                }
                yield return null;
            }
            weapons.testFire = false;

            // ── 检查 ──
            var mine = site.Spawns.ToList();
            int total = spec.Total;
            if (mine.Count < total && clearAt < 0) Fail($"{sq.id}：{Soak:F0} s 里只出场 {mine.Count}/{total} 只");
            var byMode = mine.GroupBy(r => r.mode).ToDictionary(g => g.Key, g => g.Count());
            string modes = string.Join("、", byMode.OrderBy(kv => kv.Key).Select(kv => $"{SpawnModes.Label(kv.Key)} {kv.Value}"));
            foreach (var e in wave.entries)
            {
                if (e == null || e.count <= 0 || e.via == SpawnMode.Appear) continue;
                var def = EnemyRoster.Get(e.enemy);
                bool possible = e.via switch
                {
                    SpawnMode.Ember => e.enemy.StartsWith("tantong"),
                    SpawnMode.LavaCrawl => lava,
                    SpawnMode.FlyIn => def != null && def.flying,
                    _ => true,
                };
                if (!possible) continue;
                if (!mine.Any(r => r.id == e.enemy && r.mode == e.via)) Fail($"{sq.id}：{e.enemy} 要「{SpawnModes.Label(e.via)}」，一只都没用上（出场：{modes}）");
            }
            if (site.SleepingCount > 0) Fail($"{sq.id}：{Soak:F0} s 后还有 {site.SleepingCount} 只埋伏单位在休眠（没被叫醒）");
            int stuck = FindObjectsByType<SpawnEntrance>().Count(se => se && !se.Done);
            if (stuck > 0) Fail($"{sq.id}：{stuck} 只卡在出场位移里");
            if (clearAt < 0) Line($"{sq.id} {sq.name}：{Soak:F0} s 没清完（剩 {site.Remaining}/{total}），出场 {modes}");
            else Line($"{sq.id} {sq.name}：{total} 只，{clearAt:F1} s 清完，出场 {modes}");
            table.Add((sq.id, sq.name, total, clearAt, modes));
            EnemyRegistry.PurgeAll();
            yield return null;
            Destroy(root);
            yield return null;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }
    }
}
