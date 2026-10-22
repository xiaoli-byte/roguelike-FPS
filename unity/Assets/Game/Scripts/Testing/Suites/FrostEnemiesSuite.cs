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
    /// 第二章冰霜敌人冒烟（bridge.sh playtest frost；场景 TestArena）：EN2a–c 的六种敌人（冻鲛人、雪狌狌、冰甲旋龟、玄冰巨蟹、三青鸟、冰河豚），
    /// 每种在刷怪台上同时刷普通和精英（群怪多刷几只普通的），最多跑 60 s，按剧本摆放玩家（站着不还手、血量充足）把每个状态都逼出来：
    ///   · 冻鲛人：14 m 外投矛 → 贴到群里引出群刺 / 戳刺 → 打死一只看鲛珠滚落、变成回复；
    ///   · 雪狌狌：地面上跳砸 / 抓挠 → 玩家上 2.5 m 高台、狌狌在台西侧 → 攀爬（运行时 NavMeshLink）→ 玩家上 6 m 高台 → 抛冰块 → 打死一只看同伴起哄；
    ///   · 冰甲旋龟：14 m 外开场旋壳（缩壳 → 旋转 → 过热 → 翻身）→ 贴着鸟喙站（猛啄两次后后退再转）→ 绕到身后（蛇尾反咬）；
    ///   · 玄冰巨蟹：正面 3.2 m（夹击）→ 侧面 4 m（横扫）→ 血量压到 30%（断钳）；
    ///   · 三青鸟：18 m 外（冰羽扇射）→ 各打掉 34% 血（尖啸俯冲换位）→ 玩家站到 5 m 栖落柱 13 m 外（歇脚、起飞）；
    ///   · 冰河豚：7 m 外（飘近、俯冲、鼓气自爆）→ 第一次俯冲时玩家横闪到俯冲够不着的 ≈ 23 m 外（落空收势）→ 鼓气中打爆一只（只伤别的敌人、留小冻雾）；
    ///     炸掉的随时补刷。
    /// 每种记一行：生成（美术 / 占位体）、普通 / 精英各自到过的状态、缺的状态、数值（定义与 Three.js DEF 一致；运行时生命 = 定义 × 难度 × 精英 2.6，
    /// 伤害倍率 = 1 + (难度 − 1) × 0.55，精英 ×1.25、体型 ×1.25）、AC_ 里每个招式状态都在（占位体跳过）、期间的运行时报错数。
    /// 不合格：缺状态、数值不符、缺片段、有报错（宿主也会记）。
    /// </summary>
    public sealed class FrostEnemiesSuite : PlaytestSuite
    {
        public override string Id => "frost";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const float CaseSeconds = 60f, MinSeconds = 8f;

        /// <summary>每种敌人必须到过的状态（AI 状态名；移动状态对应 AC_ 的 Locomotion）</summary>
        static readonly Dictionary<string, string[]> States = new()
        {
            ["jiaoren"] = new[] { "advance", "aim", "throw", "recover", "lungeWindup", "lunge", "jabWindup", "jab" },
            ["xingxing"] = new[] { "chase", "slamWindup", "slamAir", "recover", "swipeWindup", "swipe", "throwWindup", "throwRelease", "climbPrep", "climb", "rally" },
            ["xuangui"] = new[] { "advance", "peckWindup", "peck", "biteWindup", "bite", "backoff", "retract", "spin", "overheat", "rightself" },
            ["frost_crab"] = new[] { "advance", "grabWindup", "grab", "grabRecover", "sweepWindup", "sweep", "shellBreak" },
            ["qingniao"] = new[] { "hover", "volley", "recover", "screech", "swoopDown", "swoopUp", "toPerch", "perched", "takeoff" },
            ["ice_puffer"] = new[] { "drift", "dive", "inflate", "recover" },
        };

        static readonly HashSet<string> Movement = new() { "advance", "chase", "hover", "drift" };

        /// <summary>Three.js DEF（等级 1）：生命、护甲、移速、伤害、体型（src/enemies/types/*.ts）</summary>
        static readonly Dictionary<string, (float hp, float armor, float speed, float damage, float scale)> Ts = new()
        {
            ["jiaoren"] = (40, 0, 5.2f, 11, 1.15f),
            ["xingxing"] = (55, 0, 6.5f, 14, 1.3f),
            ["xuangui"] = (560, 220, 1.8f, 36, 1.5f),
            ["frost_crab"] = (620, 200, 2.4f, 40, 1.5f),
            ["qingniao"] = (80, 0, 6f, 9, 1.2f),
            ["ice_puffer"] = (34, 0, 4.5f, 24, 1f),
        };

        sealed class Member
        {
            public EnemyAI ai;
            public bool elite;
            public readonly HashSet<string> seen = new();
        }

        readonly List<Member> group = new();
        readonly List<string> notes = new();
        ArenaSpawner arena;
        PlayerMotor motor;
        PlayerVitals vitals;
        Vector3 away;
        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            Application.logMessageReceived += OnLog;
            vitals.stats.Add("playtest_frost", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Line($"刷怪台 {arena.Center}，难度 ×{arena.difficulty}；高台 {string.Join(" / ", arena.platformHeights.Select(h => $"{h} m"))}，栖落柱 {arena.perches.Length} 根");

            foreach (var id in States.Keys) yield return Case(id, weapons);

            vitals.stats.Remove("playtest_frost");
            Application.logMessageReceived -= OnLog;
            arena.Clear();
            Line($"合计：敌人对玩家伤害 {Runner.playerDamage:F0}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 一种敌人 ─────────────

        IEnumerator Case(string id, WeaponController weapons)
        {
            arena.Clear();
            AttackTokens.Reset();
            PackCoordinator.Reset();
            group.Clear();
            notes.Clear();
            yield return new WaitForSeconds(0.3f);
            var def = EnemyRoster.Get(id);
            if (def == null)
            {
                Fail($"{id}：名册里没有（定义没登记）");
                yield break;
            }
            int err0 = logErrors;
            Teleport(motor, arena.Center + away * 14f);
            yield return null;
            int normals = id is "jiaoren" ? 3 : id is "xingxing" ? 2 : 1;
            for (int i = 0; i < normals; i++) SpawnMember(id, false, new Vector3((i - (normals - 1) * 0.5f) * 2.5f, 0, 0));
            SpawnMember(id, true, new Vector3(0, 0, -3f));
            yield return null;
            if (group.Count == 0 || group.Any(m => !m.ai))
            {
                Fail($"{def.name}（{id}）：生成失败");
                yield break;
            }
            bool placeholder = group.Any(m => ArenaSpawner.IsPlaceholder(m.ai));
            CheckNumbers(def, group);
            string clips = CheckClips(id, group, placeholder);

            var driver = Runner.StartCoroutine(Drive(id));
            float t0 = Time.time;
            var all = States[id];
            while (Time.time - t0 < CaseSeconds)
            {
                Track();
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                weapons.testFire = false;
                if (Time.time - t0 >= MinSeconds && all.All(s => group.Any(m => m.seen.Contains(s))) && !driverBusy) break;
                yield return null;
            }
            Runner.StopCoroutine(driver);
            Track();

            var union = new HashSet<string>(group.SelectMany(m => m.seen));
            var missing = all.Where(s => !union.Contains(s)).ToList();
            string Cover(bool elite)
            {
                var seen = new HashSet<string>(group.Where(m => m.elite == elite).SelectMany(m => m.seen));
                return $"{seen.Count(all.Contains)}/{all.Length}";
            }
            int errs = logErrors - err0;
            Line($"{def.name}（{id}）：{(placeholder ? "占位体" : "美术")}，{Time.time - t0:F0} s；状态 普通 {Cover(false)} / 精英 {Cover(true)}" +
                 $"{(missing.Count > 0 ? $"，缺 {string.Join("、", missing)}" : " ✓")}；片段 {clips}；报错 {errs}{(errs > 0 ? $"（{lastError}）" : "")}" +
                 $"{(notes.Count > 0 ? "；" + string.Join("；", notes) : "")}");
            if (missing.Count > 0) Fail($"{def.name}：60 s 内没到过 {string.Join("、", missing)}");
            if (errs > 0) Fail($"{def.name}：运行时报错 {errs} 条（最后一条：{lastError}）");
            arena.Clear();
            yield return new WaitForSeconds(0.4f);
        }

        EnemyAI SpawnMember(string id, bool elite, Vector3 offset)
        {
            var ai = arena.Spawn(id, elite, offset);
            if (ai) group.Add(new Member { ai = ai, elite = elite });
            return ai;
        }

        void Track()
        {
            foreach (var m in group)
                if (m.ai && !m.ai.Dead)
                    m.seen.Add(m.ai.State);
        }

        bool Seen(string state) => group.Any(m => m.seen.Contains(state));

        IEnumerable<EnemyAI> Live(bool? elite = null) => group.Where(m => m.ai && !m.ai.Dead && (elite == null || m.elite == elite)).Select(m => m.ai);

        /// <summary>定义与 Three.js DEF 一致；运行时生命 / 护甲 / 伤害倍率 / 精英体型</summary>
        void CheckNumbers(EnemyDef def, List<Member> members)
        {
            var ts = Ts[def.id];
            var bad = new List<string>();
            if (!Near(def.hp, ts.hp) || !Near(def.armor, ts.armor) || !Near(def.speed, ts.speed) || !Near(def.damage, ts.damage) || !Near(def.scale, ts.scale))
                bad.Add($"定义 生命 {def.hp} 护甲 {def.armor} 移速 {def.speed} 伤害 {def.damage} 体型 {def.scale}（TS {ts.hp} / {ts.armor} / {ts.speed} / {ts.damage} / {ts.scale}）");
            float diff = EnemyRoster.ResolveDifficulty(arena.difficulty);
            float normalScale = 0;
            foreach (var m in members)
            {
                var ai = m.ai;
                float k = diff * (m.elite ? 2.6f : 1f);
                if (!Near(ai.Health.maxHealth, EnemyAI.RoundHp(ts.hp * k))) bad.Add($"{(m.elite ? "精英" : "普通")}生命 {ai.Health.maxHealth}（应 {EnemyAI.RoundHp(ts.hp * k)}）");
                if (!Near(ai.Health.maxArmor, EnemyAI.RoundHp(ts.armor * k))) bad.Add($"{(m.elite ? "精英" : "普通")}护甲 {ai.Health.maxArmor}");
                if (!Near(ai.moveSpeed, ts.speed) || !Near(ai.damage, ts.damage)) bad.Add($"AI 移速 {ai.moveSpeed} / 伤害 {ai.damage}");
                float mult = (1 + (diff - 1) * 0.55f) * (m.elite ? 1.25f : 1f) * ai.auraDamage;
                if (!Near(ai.Damage, ts.damage * mult)) bad.Add($"{(m.elite ? "精英" : "普通")}出手伤害 {ai.Damage:F2}（应 {ts.damage * mult:F2}）");
                if (!m.elite) normalScale = ai.transform.localScale.x;
            }
            var elite = members.FirstOrDefault(m => m.elite);
            if (elite != null && normalScale > 0 && Mathf.Abs(elite.ai.transform.localScale.x / normalScale - 1.25f) > 0.01f)
                bad.Add($"精英体型 ×{elite.ai.transform.localScale.x / normalScale:F2}");
            if (elite != null && elite.ai.Health.rank != Rank.Elite) bad.Add("精英级别没写到 Damageable");
            if (bad.Count > 0) Fail($"{def.name} 数值不符：{string.Join("；", bad)}");
            else notes.Add("数值 ✓");
        }

        static bool Near(float a, float b) => Mathf.Abs(a - b) <= 1e-3f * Mathf.Max(1f, Mathf.Abs(b));

        /// <summary>AC_ 里每个招式状态都在（移动状态查 Locomotion）；占位体没有 Animator，跳过</summary>
        string CheckClips(string id, List<Member> members, bool placeholder)
        {
            if (placeholder) return "占位体跳过";
            var anim = members[0].ai.GetComponentInChildren<Animator>();
            if (!anim || !anim.runtimeAnimatorController)
            {
                Fail($"{id}：美术 Prefab 没有 Animator / AC_");
                return "✗ 没有 AC_";
            }
            var missing = States[id].Select(s => Movement.Contains(s) ? "Locomotion" : s).Distinct().Where(s => !FrostKit.HasState(anim, s)).ToList();
            if (missing.Count > 0) Fail($"{id}：{anim.runtimeAnimatorController.name} 缺状态 {string.Join("、", missing)}");
            return missing.Count == 0 ? $"✓（{anim.runtimeAnimatorController.name}）" : $"✗ 缺 {string.Join("、", missing)}";
        }

        // ───────────── 剧本 ─────────────

        bool driverBusy;

        IEnumerator Drive(string id)
        {
            driverBusy = true;
            switch (id)
            {
                case "jiaoren": yield return Jiaoren(); break;
                case "xingxing": yield return Xingxing(); break;
                case "xuangui": yield return XuanGui(); break;
                case "frost_crab": yield return Crab(); break;
                case "qingniao": yield return Qingniao(); break;
                case "ice_puffer": yield return Puffer(); break;
            }
            driverBusy = false;
        }

        /// <summary>等到条件成立或超时（秒）</summary>
        static IEnumerator Until(System.Func<bool> done, float timeout)
        {
            float t0 = Time.time;
            while (Time.time - t0 < timeout && !done()) yield return null;
        }

        static void Warp(EnemyAI ai, Vector3 at)
        {
            if (!ai) return;
            var ag = ai.GetComponent<NavMeshAgent>();
            if (!ag || !ag.enabled || !NavMesh.SamplePosition(at, out var hit, 3f, NavMesh.AllAreas)) return;
            ag.Warp(hit.position);
            var loco = ai.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v;
        }

        /// <summary>玩家站到 at（离开超过 tolerance 才挪，免得每帧瞬移）</summary>
        void Keep(Vector3 at, float tolerance = 0.8f)
        {
            if (Flat(motor.transform.position - at).magnitude > tolerance) Teleport(motor, at);
        }

        IEnumerator Jiaoren()
        {
            // 投矛距离带：举矛、投矛、收招
            yield return Until(() => Seen("throw") && Seen("recover"), 14f);
            // 贴到群里：群刺（3 只普通够人数）、戳刺
            float t0 = Time.time;
            while (Time.time - t0 < 22f && !(Seen("lunge") && Seen("jab")))
            {
                var live = Live().ToList();
                if (live.Count > 0)
                {
                    var c = live.Aggregate(Vector3.zero, (s, e) => s + e.transform.position) / live.Count;
                    Keep(c + away * (Seen("lunge") ? 1.2f : 3f), Seen("lunge") ? 0.6f : 2f);
                }
                yield return new WaitForSeconds(0.25f);
            }
            // 鲛珠：打死一只普通的，额头的鲛珠滚出来、0.8 s 后变成回复
            var victim = Live(false).FirstOrDefault();
            if (victim)
            {
                Teleport(motor, victim.transform.position + away * 8f);
                yield return null;
                int heal0 = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Health);
                Combat.Execute(victim.Health, false);
                yield return null;
                bool rolled = FindObjectsByType<JiaorenPearl>().Length > 0;
                yield return new WaitForSeconds(1.2f);
                bool healed = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Health) > heal0 && FindObjectsByType<JiaorenPearl>().Length == 0;
                notes.Add($"鲛珠 {(rolled ? "滚落" : "✗ 没掉")}{(healed ? " → 回复 ✓" : " → ✗ 没变成回复")}");
                if (!rolled || !healed) Fail("冻鲛人：打死后鲛珠没有滚落 / 没变成回复");
            }
        }

        IEnumerator Xingxing()
        {
            // 地面：跳砸、抓挠
            yield return Until(() => Seen("slamAir") && Seen("swipe"), 16f);
            // 2.5 m 高台：狌狌在台西侧 1.6 m，玩家在台面中央 → 攀爬
            int low = System.Array.FindIndex(arena.platformHeights, h => h <= 3f);
            int high = System.Array.FindIndex(arena.platformHeights, h => h >= 5f);
            if (low >= 0 && arena.platforms[low])
            {
                var b = arena.platforms[low].GetComponent<Collider>().bounds;
                // 等它们都落地（跳砸在半空时不瞬移）
                yield return Until(() => Live().All(e => e.State is "chase" or "recover"), 3f);
                Teleport(motor, new Vector3(b.center.x + 1f, b.max.y + 1f, b.center.z));
                int i = 0;
                foreach (var e in Live()) Warp(e, new Vector3(b.min.x - 1.6f, 0, b.center.z + (i++ - 1) * 1.6f));
                yield return Until(() => Seen("climb") && group.Any(m => m.ai && !m.ai.Dead && m.ai.transform.position.y > b.max.y - 0.4f), 14f);
                var climber = group.Select(m => m.ai).OfType<XingxingAI>().FirstOrDefault(x => x && x.transform.position.y > b.max.y - 0.4f);
                notes.Add(climber ? $"爬上 {arena.platformHeights[low]} m 台 ✓（连线 {PackCoordinator.ClimbLinkCount} 条）" : "✗ 没爬上台面");
                if (!climber) Fail("雪狌狌：14 s 内没爬上 2.5 m 高台");
            }
            else Fail("测试场没有 2.5 m 高台");
            // 6 m 高台：爬不上去 → 抛冰块
            if (high >= 0 && arena.platforms[high])
            {
                var b = arena.platforms[high].GetComponent<Collider>().bounds;
                yield return Until(() => Live().All(e => e.State is "chase" or "recover"), 3f);
                // 玩家站在台面北沿内 1 m：北面 10 m 外空地上的狌狌越过台沿看得见他（西边挨着 4 m 台，南边是坡道）
                Teleport(motor, new Vector3(b.center.x, b.max.y + 1f, b.max.z - 1f));
                int i = 0;
                foreach (var e in Live()) Warp(e, new Vector3(b.center.x + (i++ - 1) * 2f, 0, b.max.z + 10f));
                yield return Until(() => Seen("throwRelease"), 14f);
            }
            // 起哄：玩家下到地面，打死一只普通的，12 m 内的同伴捶胸
            var live = Live().ToList();
            if (live.Count >= 2)
            {
                var c = live[0].transform.position;
                for (int i = 1; i < live.Count; i++) Warp(live[i], c + new Vector3(i * 2f, 0, 0));
                Teleport(motor, c + away * 9f);
                yield return Until(() => live.Skip(1).Any(e => e && e.State is "chase" or "recover"), 4f);
                var victim = live.FirstOrDefault(e => !e.elite) ?? live[0];
                Combat.Execute(victim.Health, false);
                yield return Until(() => Seen("rally"), 2f);
            }
        }

        IEnumerator XuanGui()
        {
            // 14 m 外：开场旋壳（缩壳 → 旋转 → 过热 → 翻身）
            yield return Until(() => Seen("rightself"), 18f);
            var target = Live(false).FirstOrDefault() ?? Live().FirstOrDefault();
            if (!target) yield break;
            // 贴着鸟喙站：啄两次 → 后退 → 再转
            float t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 18f && !Seen("backoff"))
            {
                if (target.State is "advance" or "peckWindup") Keep(target.transform.position + Flat(target.transform.forward).normalized * 3f, 0.6f);
                yield return null;
            }
            yield return Until(() => Seen("spin") && target && target.State == "advance", 10f);
            // 绕到身后：蛇尾反咬
            t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 12f && !Seen("bite"))
            {
                if (target.State is "advance" or "biteWindup") Keep(target.transform.position - Flat(target.transform.forward).normalized * 3.4f, 0.8f);
                yield return null;
            }
        }

        IEnumerator Crab()
        {
            var target = Live(false).FirstOrDefault() ?? Live().FirstOrDefault();
            if (!target) yield break;
            // 正面 3.2 m：夹击
            float t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 16f && !Seen("grabRecover"))
            {
                if (target.State == "advance") Keep(target.transform.position + Flat(target.transform.forward).normalized * 3.2f, 1f);
                yield return null;
            }
            // 侧面 4 m：横扫
            t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 14f && !Seen("sweep"))
            {
                if (target.State == "advance") Keep(target.transform.position + Flat(target.transform.right).normalized * 4f, 1.2f);
                yield return new WaitForSeconds(0.2f);
            }
            // 血量压到 30%：断钳
            Teleport(motor, target.transform.position + away * 10f);
            target.Health.health = target.Health.maxHealth * 0.3f;
            yield return Until(() => Seen("shellBreak"), 3f);
            if (target is FrostCrabAI crab) notes.Add(crab.Broken ? "断钳 ✓" : "✗ 没断钳");
        }

        IEnumerator Qingniao()
        {
            Teleport(motor, arena.Center + away * 18f);
            // 冰羽扇射
            yield return Until(() => Seen("volley") && Seen("recover"), 8f);
            // 各打掉 34% 血（触发线 30%）：尖啸俯冲换位
            foreach (var e in Live())
            {
                var info = DamageInfo.Simple(e.Health.maxHealth * 0.34f, DamageSource.Status, e.transform.position + Vector3.up, Vector3.down);
                info.noCrit = true;
                Combat.DamageEnemy(e.Health, info);
            }
            yield return Until(() => Seen("swoopUp") && group.All(m => !m.ai || m.ai.Dead || m.ai.State != "swoopUp"), 10f);
            // 站到 5 m 栖落柱 13 m 外：歇脚、起飞
            var pillar = arena.perches.FirstOrDefault(p => p);
            if (pillar)
            {
                var dir = Flat(arena.Center - pillar.position);
                dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : away;
                Teleport(motor, new Vector3(pillar.position.x, 0, pillar.position.z) + dir * 13f);
            }
            yield return Until(() => Seen("takeoff"), 40f);
            var birds = group.Select(m => m.ai).OfType<QingniaoAI>().Where(b => b).ToList();
            notes.Add($"扇射 {birds.Sum(b => b.Volleys)} 轮，俯冲擦中 {birds.Sum(b => b.SwoopHits)} 次，歇脚 {string.Join(" / ", birds.Select(b => b.Perch.kind))}");
        }

        IEnumerator Puffer()
        {
            var spot = arena.Center + away * 7f;
            Teleport(motor, spot);
            bool dodged = false, popped = false;
            int respawns = 0, dodges = 0;
            float t0 = Time.time;
            while (Time.time - t0 < CaseSeconds - 2f)
            {
                // 炸掉的补刷（普通 / 精英各一只在场）
                foreach (bool elite in new[] { false, true })
                    if (!Live(elite).Any() && respawns < 12)
                    {
                        respawns++;
                        SpawnMember("ice_puffer", elite, new Vector3(elite ? 2f : -2f, 0, 0));
                    }
                var diving = Live().FirstOrDefault(e => e.State == "dive");
                if (!dodged && diving)
                {
                    // 第一次俯冲：玩家横向闪到它够不着的地方 → 落空收势。俯冲 1.6 s 最多飞 ≈ 16.7 m（6 → 11 m/s），转向 2 rad/s：
                    // 横跳 14 m 还在射程里（转过来照样贴上去鼓气，永远等不到 recover），要离俯冲中的那只水平超过「整段俯冲 + 精英鼓气距离」
                    dodged = true;
                    dodges++;
                    var side = Vector3.Cross(Vector3.up, away);
                    float reach = IcePufferAI.DiveReach(IcePufferAI.DiveMaxTime) + IcePufferAI.InflateRange * 1.25f + 3f;
                    var from = diving.transform.position;
                    Teleport(motor, new Vector3(from.x, spot.y, from.z) + side * reach);
                    yield return Until(() => Seen("recover"), 4f);
                    Teleport(motor, spot);
                    // 这一下没落空（闪避落点被地形托高 / 俯冲的那只中途被打断）：下一次俯冲再闪一次，最多三次
                    if (!Seen("recover") && dodges < 3) dodged = false;
                }
                var inflating = Live().FirstOrDefault(e => e.State == "inflate");
                bool othersCalm = Live().Count(e => e.State == "inflate") == 1;
                if (!popped && Seen("recover") && othersCalm && inflating && inflating is IcePufferAI pf && pf.Inflation > 0.2f)
                {
                    // 鼓气中打爆：冰爆只伤别的敌人，留一小团冻雾（同时只有它一只在鼓气，玩家受伤就是它的冰爆打到了）
                    popped = true;
                    float dmg0 = Runner.playerDamage;
                    Combat.Execute(inflating.Health, false);
                    yield return new WaitForSeconds(0.2f);
                    bool fog = FindObjectsByType<FrostFog>().Length > 0;
                    bool spared = Runner.playerDamage <= dmg0 + 1e-3f;
                    notes.Add($"鼓气中打爆：冻雾 {(fog ? "✓" : "✗")}，玩家{(spared ? "没受伤 ✓" : "受伤（同期别的伤害？）")}");
                    if (!fog) Fail("冰河豚：鼓气中被打爆时应留下一小团冻雾");
                }
                if (Seen("recover") && Seen("inflate") && popped && respawns > 0) break;
                yield return null;
            }
            notes.Add($"补刷 {respawns} 只，横闪 {dodges} 次");
        }
    }
}
