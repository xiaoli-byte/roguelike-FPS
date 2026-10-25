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
    /// 第一章敌人冒烟（bridge.sh playtest desert；场景 TestArena）：EN1 的七种（跳鼠刀兵、蝎尾弩卫、蜃楼蟾、火浣鼠、三彩镇墓兽、邪飞天、沙魇），
    /// 每种在刷怪台上同时刷普通和精英（群怪多刷几只普通的），最多跑 <see cref="CaseSeconds"/> s，按剧本摆放玩家（站着不还手、血量充足）把每个状态都逼出来：
    ///   · 跳鼠刀兵：7 m 外扑斩（蹲伏 → 扑跳 → 旋斩 → 硬直 → 后跳）→ 贴脸交叉斩 → 精英扑跳时玩家横闪 6 m（落空立刻重扑）；
    ///   · 蝎尾弩卫：16 m 外上弦连射（精英五支）→ 逼近 5 m 钻沙（沉沙 → 潜行 → 钻出 → 伏击上弦）→ 钻出后贴身钳击 →
    ///     玩家躲到 6 m 高台东侧、蝎子在台西侧 12 m（寻视线：挪到看得见的站位再上弦）；
    ///   · 蜃楼蟾：18 m 外鼓囊吐火（喉囊胀大、火珠落地炸开留炽沙余火）→ 蜃景分身；精英连吐两颗；打死本体分身消散；
    ///   · 火浣鼠：10 m 外蜷身滚来贴身自爆 → 滚动时玩家横闪 12 m（撞空愣住）→ 滚动中打爆（只伤别的敌人、留余火）→ 走路时打死（留余火）；炸掉的补刷；
    ///   · 三彩镇墓兽：贴身 3 m 踏地 → 开阔地冲锋时玩家横闪（刹车；精英刹车后再冲一趟）→ 6 m 高台北面 16 m 外冲墙（撞晕）→ 压到 60% 生命（崩陶片）；
    ///   · 邪飞天（带两只跳鼠护卫）：登场旋降 → 施法（和弦 / 花开 / 赐福；精英护盾 ×1.3）→ 打琵琶断弦、琴碎（弱点挪到胸口）→ 提前到点重凝（弱点回琵琶）；
    ///   · 沙魇：10 m 外潜沙突袭（沉沙 → 潜行（打不到）→ 定点预警 → 破沙旋斩 → 硬直）→ 贴脸爪击 → 精英破沙前玩家闪开 7 m（连潜）→ 换皮检查（着色器参数）；
    ///     顺手给一只蝎尾弩卫换「沙魇·」的皮（旱魃召出的杂兵）。
    /// 每种最后打死一只普通的看死亡（倒下、离开注册表、各自的死亡产物：余火 / 焦痕 / 崩沙 / 分身消散 / 加成撤掉）。
    /// 每种记一行：生成（美术 / 占位体）、普通 / 精英各自到过的状态、缺的状态、数值（定义与 Three.js DEF 一致；运行时生命 = 定义 × 难度 × 精英 2.6，
    /// 伤害倍率 = 1 + (难度 − 1) × 0.55，精英 ×1.25、体型 ×1.25）、AC_ 里每个招式状态都在（占位体跳过）、期间的运行时报错数。
    /// 不合格：缺状态、精英 / 死亡检查不过、数值不符、缺片段、有报错。
    /// 聚焦：Library/SpiritfireBridge/playtest-focus.txt 写 id（逗号 / 空格分隔）→ 只跑这几种（读完即删）。
    /// </summary>
    public sealed class DesertEnemiesSuite : PlaytestSuite
    {
        public override string Id => "desert";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const float CaseSeconds = 55f, MinSeconds = 6f;

        /// <summary>每种敌人必须到过的状态（AI 状态名；移动状态对应 AC_ 的 Locomotion）</summary>
        static readonly Dictionary<string, string[]> States = new()
        {
            ["jerboa_blade"] = new[] { "chase", "crouch", "leap", "spin", "recover", "hopBack", "slashWindup", "slash" },
            ["scorpion_archer"] = new[] { "move", "aim", "fire", "recover", "dive", "tunnel", "emerge", "snapWindup", "snap" },
            ["mirage_toad"] = new[] { "move", "puff", "spit", "recover", "mirage" },
            ["fire_rat"] = new[] { "chase", "curl", "roll", "dizzy" },
            ["tomb_beast"] = new[] { "advance", "stompWindup", "stomp", "chargeWindup", "charge", "brake", "dazed" },
            ["apsara"] = new[] { "enter", "hover", "cast", "reform" },
            [Enemy_SandWraith.Id] = new[] { "stalk", "sink", "burrow", "surface", "erupt", "recover", "slashWindup", "slash" },
        };

        /// <summary>移动 / 非动作状态（查片段时对应 Locomotion 或不查）</summary>
        static readonly HashSet<string> Movement = new() { "chase", "move", "advance", "hover", "stalk" };
        /// <summary>AC_ 里没有对应片段、由代码驱动的状态（不查片段）</summary>
        static readonly HashSet<string> CodeDriven = new() { "enter", "reform", "cast", "burrow", "surface", "erupt", "sink", "dazed", "spit" };

        /// <summary>Three.js DEF（等级 1）：生命、护甲、移速、伤害、体型（src/enemies/types/*.ts；沙魇是 Unity 新增，按 Enemy_SandWraith）</summary>
        static readonly Dictionary<string, (float hp, float armor, float speed, float damage, float scale)> Ts = new()
        {
            ["jerboa_blade"] = (42, 0, 7, 9, 1.3f),
            ["scorpion_archer"] = (120, 0, 3.4f, 11, 1.8f),
            ["mirage_toad"] = (170, 0, 2.6f, 24, 1f),
            ["fire_rat"] = (26, 0, 6, 26, 1.6f),
            ["tomb_beast"] = (640, 160, 2.2f, 42, 1.7f),
            ["apsara"] = (170, 0, 4.2f, 0, 1.3f),
            [Enemy_SandWraith.Id] = (55, 0, 5.6f, 12, 1.4f),
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
        Vector3 away, side;
        int logErrors;
        string lastError;
        bool driverBusy;

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
            vitals.stats.Add("playtest_desert", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            Line($"刷怪台 {arena.Center}，难度 ×{arena.difficulty}；高台 {string.Join(" / ", arena.platformHeights.Select(h => $"{h} m"))}");

            var ids = States.Keys.ToList();
            var focus = ReadFocus();
            if (focus.Count > 0)
            {
                ids = ids.Where(focus.Contains).ToList();
                Line($"聚焦：{string.Join("、", ids)}");
            }
            foreach (var id in ids) yield return Case(id);

            vitals.stats.Remove("playtest_desert");
            Application.logMessageReceived -= OnLog;
            arena.Clear();
            Line($"合计：敌人对玩家伤害 {Runner.playerDamage:F0}");
        }

        static HashSet<string> ReadFocus()
        {
            var set = new HashSet<string>();
            var path = System.IO.Path.Combine(Application.dataPath, "..", "Library", "SpiritfireBridge", "playtest-focus.txt");
            if (!System.IO.File.Exists(path)) return set;
            foreach (var s in System.IO.File.ReadAllText(path).Split(',', ' ', '\n', '\r', '\t'))
                if (!string.IsNullOrWhiteSpace(s)) set.Add(s.Trim());
            System.IO.File.Delete(path);
            return set;
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 一种敌人 ─────────────

        IEnumerator Case(string id)
        {
            arena.Clear();
            AttackTokens.Reset();
            group.Clear();
            notes.Clear();
            wraithHidden = wraithExposed = false;
            marks0 = GroundMark.Spawned;
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
            int normals = id is "jerboa_blade" or "fire_rat" or "sand_wraith" ? 2 : 1;
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
                if (Time.time - t0 >= MinSeconds && all.All(s => group.Any(m => m.seen.Contains(s))) && !driverBusy) break;
                yield return null;
            }
            Runner.StopCoroutine(driver);
            driverBusy = false;
            Track();
            // 死亡：打死一只普通的
            yield return Death(id);

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
            if (missing.Count > 0) Fail($"{def.name}：{CaseSeconds:F0} s 内没到过 {string.Join("、", missing)}");
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

        /// <summary>沙魇：潜行时看到过「不可选中」/ 看到过「可选中」的帧（潜行刚开始那一帧不算）</summary>
        bool wraithHidden, wraithExposed;
        int marks0;

        void Track()
        {
            foreach (var m in group)
                if (m.ai && !m.ai.Dead)
                {
                    m.seen.Add(m.ai.State);
                    if (m.ai is SandWraithAI w && w.State == "burrow" && w.InStateFor(0.05f))
                    {
                        if (w.Health.untargetable) wraithHidden = true;
                        else wraithExposed = true;
                    }
                }
        }

        bool Seen(string state) => group.Any(m => m.seen.Contains(state));

        IEnumerable<EnemyAI> Live(bool? elite = null) => group.Where(m => m.ai && !m.ai.Dead && (elite == null || m.elite == elite)).Select(m => m.ai);

        T First<T>(bool elite) where T : EnemyAI => Live(elite).OfType<T>().FirstOrDefault();

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

        /// <summary>AC_ 里每个招式状态都在（移动状态查 Locomotion，代码驱动的不查）；占位体没有 Animator，跳过</summary>
        string CheckClips(string id, List<Member> members, bool placeholder)
        {
            if (placeholder) return "占位体跳过";
            var anim = members[0].ai.GetComponentInChildren<Animator>();
            if (!anim || !anim.runtimeAnimatorController)
            {
                Fail($"{id}：美术 Prefab 没有 Animator / AC_");
                return "✗ 没有 AC_";
            }
            var want = States[id].Where(s => !CodeDriven.Contains(s)).Select(s => Movement.Contains(s) ? "Locomotion" : s).Distinct().ToList();
            // 代码驱动状态借用的片段
            if (id == "apsara") want.AddRange(new[] { "chordWindup", "bloomWindup", "blessWindup" });
            if (id == Enemy_SandWraith.Id) want.AddRange(new[] { "crouch", "spin" });
            if (id == "tomb_beast") want.Remove("dazed");
            var missing = want.Distinct().Where(s => !FrostKit.HasState(anim, s)).ToList();
            if (missing.Count > 0) Fail($"{id}：{anim.runtimeAnimatorController.name} 缺状态 {string.Join("、", missing)}");
            return missing.Count == 0 ? $"✓（{anim.runtimeAnimatorController.name}）" : $"✗ 缺 {string.Join("、", missing)}";
        }

        // ───────────── 剧本 ─────────────

        IEnumerator Drive(string id)
        {
            driverBusy = true;
            switch (id)
            {
                case "jerboa_blade": yield return Jerboa(); break;
                case "scorpion_archer": yield return Scorpion(); break;
                case "mirage_toad": yield return Toad(); break;
                case "fire_rat": yield return Rat(); break;
                case "tomb_beast": yield return Tomb(); break;
                case "apsara": yield return Apsara(); break;
                case "sand_wraith": yield return Wraith(); break;
            }
            driverBusy = false;
        }

        static IEnumerator Until(System.Func<bool> done, float timeout)
        {
            float t0 = Time.time;
            while (Time.time - t0 < timeout && !done()) yield return null;
        }

        static void Warp(EnemyAI ai, Vector3 at, Vector3? face = null)
        {
            if (!ai) return;
            var ag = ai.GetComponent<NavMeshAgent>();
            if (!ag || !ag.enabled || !NavMesh.SamplePosition(at, out var hit, 3f, NavMesh.AllAreas)) return;
            ag.Warp(hit.position);
            if (face is { } f)
            {
                var d = f - hit.position;
                d.y = 0;
                if (d.sqrMagnitude > 1e-4f) ai.transform.rotation = Quaternion.LookRotation(d);
            }
            var loco = ai.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v;
        }

        void Keep(Vector3 at, float tolerance = 0.8f)
        {
            if (Flat(motor.transform.position - at).magnitude > tolerance) Teleport(motor, at);
        }

        static void ZeroCooldown(EnemyAI ai)
        {
            var f = typeof(EnemyAI).GetField("cooldown", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if (ai && f != null) f.SetValue(ai, 0f);
        }

        static void SetPrivate(object o, string field, object value)
        {
            var f = o?.GetType().GetField(field, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            f?.SetValue(o, value);
        }

        // ── 跳鼠刀兵 ──
        IEnumerator Jerboa()
        {
            // 7 m：扑斩全套（蹲伏 → 扑跳 → 旋斩 → 硬直 → 后跳）
            Teleport(motor, arena.Center + away * 7f);
            yield return Until(() => Seen("spin") && Seen("hopBack"), 14f);
            // 贴脸交叉斩
            float t0 = Time.time;
            while (Time.time - t0 < 12f && !Seen("slash"))
            {
                var e = Live(false).FirstOrDefault(x => x.State == "chase");
                if (e)
                {
                    Keep(e.transform.position + Flat(e.transform.forward).normalized * 1.2f, 0.5f);
                    ZeroCooldown(e);
                }
                yield return new WaitForSeconds(0.2f);
            }
            // 精英扑跳时玩家横闪 6 m：旋斩落空 → 立刻重扑
            var elite = First<JerboaBladeAI>(true);
            if (!elite) yield break;
            t0 = Time.time;
            bool dodged = false;
            while (elite && !elite.Dead && Time.time - t0 < 18f && elite.Releaps == 0)
            {
                if (elite.State == "chase" && !dodged)
                {
                    var to = Flat(elite.transform.position - motor.transform.position);
                    if (to.magnitude < 5f || to.magnitude > 8f) Keep(elite.transform.position + away * 7f, 1.5f);
                    ZeroCooldown(elite);
                }
                if (elite.State == "leap" && !dodged)
                {
                    dodged = true;
                    Teleport(motor, motor.transform.position + Vector3.Cross(Vector3.up, Flat(elite.transform.forward).normalized) * 6f);
                }
                if (elite.State is "recover" or "hopBack" or "crouch" && dodged) dodged = false;
                yield return null;
            }
            var all = group.Select(m => m.ai).OfType<JerboaBladeAI>().ToList();
            notes.Add($"扑斩 {all.Sum(j => j.Leaps)} 次、扑中 {all.Sum(j => j.LeapHits)} 次（震屏）、精英落空重扑 {elite.Releaps} 次");
            if (elite.Releaps == 0) Fail("跳鼠刀兵：精英扑斩落空后没有立刻重扑");
        }

        // ── 蝎尾弩卫 ──
        IEnumerator Scorpion()
        {
            Teleport(motor, arena.Center + away * 16f);
            yield return Until(() => Seen("fire") && Seen("recover"), 12f);
            // 逼近 5 m：钻沙 → 潜行 → 钻出 → 伏击上弦
            var target = First<ScorpionArcherAI>(false);
            float t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 14f && !Seen("emerge"))
            {
                if (target.State == "move") Keep(target.transform.position + away * 5f, 1.5f);
                yield return new WaitForSeconds(0.2f);
            }
            // 钻出后贴身：钳击
            yield return Until(() => target && target.State == "move", 6f);
            t0 = Time.time;
            while (target && !target.Dead && Time.time - t0 < 12f && !Seen("snap"))
            {
                if (target.State == "move") Keep(target.transform.position + Flat(target.transform.forward).normalized * 2.4f, 0.6f);
                yield return new WaitForSeconds(0.15f);
            }
            // 寻视线：玩家贴在 6 m 高台东侧，蝎子在台西侧 12 m
            int hi = System.Array.FindIndex(arena.platformHeights, h => h >= 5f);
            if (target && hi >= 0 && arena.platforms[hi])
            {
                var b = arena.platforms[hi].GetComponent<Collider>().bounds;
                yield return Until(() => target.State == "move", 6f);
                var p = new Vector3(b.max.x + 2f, 0, b.center.z);
                Teleport(motor, p);
                Warp(target, new Vector3(p.x - 12f, 0, b.center.z), p);
                int moves0 = target.SightMoves, bolts0 = target.BoltsFired;
                float s0 = Time.time;
                bool blocked = Combat.Blocked(target.transform.position + Vector3.up * 1.6f * target.transform.localScale.x, motor.transform.position + Vector3.up * 1.62f, null);
                yield return Until(() => !target || target.SightMoves > moves0 || target.BoltsFired > bolts0, 14f);
                bool ok = target && (target.SightMoves > moves0 || target.BoltsFired > bolts0);
                notes.Add($"寻视线：{(blocked ? "台后看不见" : "（摆位时就看得见）")} → {(ok ? $"{Time.time - s0:F1} s 挪到看得见的站位 / 开射 ✓" : "✗ 14 s 内没找到视线")}");
                if (blocked && !ok) Fail("蝎尾弩卫：看不见玩家时没有去找能看见的站位");
            }
            var elite = First<ScorpionArcherAI>(true);
            if (elite)
            {
                Teleport(motor, elite.transform.position + away * 16f);
                yield return Until(() => elite.BoltsFired >= 5, 10f);
                notes.Add($"精英连射 {elite.BoltsFired} 支（一轮 5 支）");
                if (elite.BoltsFired > 0 && elite.BoltsFired % 5 != 0 && elite.State != "fire") Fail($"蝎尾弩卫：精英一轮不是 5 支（{elite.BoltsFired}）");
            }
            var all = group.Select(m => m.ai).OfType<ScorpionArcherAI>().ToList();
            notes.Add($"钻沙 {all.Sum(s => s.Burrows)} 次，地上落了 {GroundMark.Spawned - marks0} 段沙痕");
            if (all.Sum(s => s.Burrows) > 0 && GroundMark.Spawned <= marks0) Fail("蝎尾弩卫：潜行没有留下沙痕");
        }

        // ── 蜃楼蟾 ──
        IEnumerator Toad()
        {
            Teleport(motor, arena.Center + away * 18f);
            float swell = 1;
            int fires0 = FindObjectsByType<FloorFire>().Length;
            int maxFires = 0;
            float t0 = Time.time;
            while (Time.time - t0 < 28f && !(Seen("mirage") && Seen("recover") && group.Any(m => m.ai is MirageToadAI t && t.Blasts > 0)))
            {
                foreach (var t in Live().OfType<MirageToadAI>())
                    if (t.State == "puff") swell = Mathf.Max(swell, t.SacScale);
                maxFires = Mathf.Max(maxFires, FindObjectsByType<FloorFire>().Length);
                yield return null;
            }
            var elite = First<MirageToadAI>(true);
            if (elite) yield return Until(() => elite.Spits >= 2, 10f);
            var toads = group.Select(m => m.ai).OfType<MirageToadAI>().ToList();
            int decoys = toads.Sum(t => t ? t.DecoyCount : 0);
            notes.Add($"喉囊最大 ×{swell:F2}，吐火 {toads.Sum(t => t.Spits)} 颗、炸 {toads.Sum(t => t.Blasts)} 次、炽沙余火 {maxFires - fires0} 片、分身 {decoys} 只、精英吐 {(elite ? elite.Spits : 0)} 颗");
            if (swell < 1.15f) Fail($"蜃楼蟾：鼓囊时喉囊没有胀大（×{swell:F2}）");
            if (toads.Sum(t => t.Blasts) > 0 && maxFires <= fires0) Fail("蜃楼蟾：火珠落地没有留下炽沙余火");
            if (elite && elite.Spits > 0 && elite.Spits % 2 != 0 && elite.State != "spit") Fail($"蜃楼蟾：精英一次没吐两颗（{elite.Spits}）");
        }

        // ── 火浣鼠 ──
        IEnumerator Rat()
        {
            var spot = arena.Center + away * 10f;
            Teleport(motor, spot);
            bool dodged = false, killedRolling = false, killedWalking = false;
            int respawns = 0;
            int fires0 = FindObjectsByType<FloorFire>().Length;
            float t0 = Time.time;
            while (Time.time - t0 < CaseSeconds - 4f)
            {
                foreach (bool e in new[] { false, true })
                    if (!Live(e).Any() && respawns < 12)
                    {
                        respawns++;
                        SpawnMember("fire_rat", e, new Vector3(e ? 2f : -2f, 0, 0));
                    }
                // 第一次滚动：横闪 12 m → 撞空愣住
                var rolling = Live().OfType<FireRatAI>().FirstOrDefault(r => r.State == "roll");
                if (!dodged && rolling && Seen("roll"))
                {
                    // 闪到 40 m 外（滚 3 s 最多 ≈ 31 m，追不上 → 滚满撞空，不会半路炸）
                    dodged = true;
                    Teleport(motor, new Vector3(arena.Center.x + 40f, motor.transform.position.y, motor.transform.position.z));
                    yield return Until(() => Seen("dizzy"), 4.5f);
                    Teleport(motor, spot);
                    if (!Seen("dizzy")) dodged = false;
                }
                // 滚动中打爆（只伤别的敌人、留余火）
                rolling = Live().OfType<FireRatAI>().FirstOrDefault(r => r.State == "roll");
                if (dodged && Seen("dizzy") && !killedRolling && rolling && rolling.InStateFor(0.2f))
                {
                    killedRolling = true;
                    float dmg0 = Runner.playerDamage;
                    Combat.Execute(rolling.Health, false);
                    yield return new WaitForSeconds(0.2f);
                    notes.Add($"滚动中打爆：{(Runner.playerDamage <= dmg0 + 1e-3f ? "玩家没受伤 ✓" : "玩家受伤（同期别的伤害？）")}");
                }
                var walking = Live().OfType<FireRatAI>().FirstOrDefault(r => r.State == "chase");
                if (killedRolling && !killedWalking && walking)
                {
                    killedWalking = true;
                    Combat.Execute(walking.Health, false);
                }
                bool detonated = group.Any(m => m.ai is FireRatAI r && r.Detonations > 0);
                if (killedRolling && killedWalking && detonated && Seen("dizzy")) break;
                yield return null;
            }
            var rats = group.Select(m => m.ai).OfType<FireRatAI>().Where(r => r).ToList();
            int fires = FindObjectsByType<FloorFire>().Length - fires0;
            notes.Add($"补刷 {respawns} 只，贴身自爆 {rats.Sum(r => r.Detonations)} 次、撞空 {rats.Sum(r => r.Bonks)} 次，余火 {fires} 片、焦痕 {GroundMark.Count} 块");
            if (rats.Sum(r => r.Detonations) == 0) Fail("火浣鼠：没有一次贴身自爆");
            if (!killedRolling || !killedWalking) Fail("火浣鼠：没跑到滚动中 / 走路时打死");
        }

        // ── 三彩镇墓兽 ──
        IEnumerator Tomb()
        {
            var normal = First<TombBeastAI>(false);
            var elite = First<TombBeastAI>(true);
            if (!normal || !elite) yield break;
            // 精英先挪开（开阔地西侧），普通的贴身踏地
            Warp(elite, arena.Center - side * 22f);
            float t0 = Time.time;
            while (normal && !normal.Dead && Time.time - t0 < 12f && !Seen("stomp"))
            {
                if (normal.State == "advance") Keep(normal.transform.position + Flat(normal.transform.forward).normalized * 3f, 0.8f);
                yield return new WaitForSeconds(0.2f);
            }
            // 精英：开阔地冲锋 → 玩家横闪 → 刹车 → 再冲一趟
            var e0 = elite.transform.position;
            Warp(normal, arena.Center + side * 25f);
            Teleport(motor, e0 + away * 14f);
            Warp(elite, e0, motor.transform.position);
            int charges0 = elite.Charges;
            t0 = Time.time;
            while (elite && !elite.Dead && Time.time - t0 < 22f && elite.Charges < charges0 + 2)
            {
                if (elite.State == "chargeWindup" && elite.InStateFor(0.75f))
                {
                    var dir = Flat(elite.transform.forward).normalized;
                    Teleport(motor, elite.transform.position + dir * 8f + Vector3.Cross(Vector3.up, dir) * 9f);
                    yield return Until(() => elite.State != "chargeWindup", 2f);
                }
                yield return null;
            }
            notes.Add($"精英冲锋 {elite.Charges - charges0} 趟（刹车后再冲）");
            if (elite.Charges < charges0 + 2) Fail("三彩镇墓兽：精英刹车后没有再冲一趟");
            // 普通的冲墙：6 m 高台北面 16 m 外，玩家站在墙前 3 m，冲起来后闪开
            int hi = System.Array.FindIndex(arena.platformHeights, h => h >= 5f);
            if (hi >= 0 && arena.platforms[hi] && normal)
            {
                Warp(elite, arena.Center - side * 25f);
                var b = arena.platforms[hi].GetComponent<Collider>().bounds;
                var wallFront = new Vector3(b.center.x, 0, b.max.z + 3f);
                Teleport(motor, wallFront);
                Warp(normal, new Vector3(b.center.x, 0, b.max.z + 16f), wallFront);
                SetPrivate(normal, "chargeCd", 0f);
                t0 = Time.time;
                while (normal && !normal.Dead && Time.time - t0 < 16f && !Seen("dazed"))
                {
                    if (normal.State == "chargeWindup" && normal.InStateFor(0.75f))
                    {
                        Teleport(motor, wallFront + new Vector3(b.extents.x + 6f, 0, 0));
                        yield return Until(() => normal.State != "charge" && normal.State != "chargeWindup", 3f);
                    }
                    else if (normal.State == "advance")
                    {
                        Keep(wallFront, 1f);
                        if (Flat(normal.transform.position - wallFront).magnitude < 9f) Warp(normal, new Vector3(b.center.x, 0, b.max.z + 16f), wallFront);
                    }
                    yield return null;
                }
                if (!Seen("dazed")) Fail("三彩镇墓兽：冲墙没撞晕");
            }
            // 碎陶：压到 60% 生命
            if (normal)
            {
                Teleport(motor, normal.transform.position + away * 12f);
                normal.Health.health = normal.Health.maxHealth * 0.6f;
                yield return new WaitForSeconds(0.3f);
                notes.Add($"压到 60%：崩落陶片 {normal.ShardsShed} 把");
                if (normal.ShardsShed < 3) Fail($"三彩镇墓兽：掉了 40% 生命只崩了 {normal.ShardsShed} 把陶片（应 3）");
            }
        }

        // ── 邪飞天 ──
        IEnumerator Apsara()
        {
            // 两只跳鼠护卫（有同伴才施法）
            var escorts = new List<EnemyAI>();
            for (int i = 0; i < 2; i++)
            {
                var e = arena.Spawn("jerboa_blade", false, new Vector3(i * 3f - 1.5f, 0, 3f));
                if (!e) continue;
                e.Health.maxHealth *= 50;
                e.Health.ResetVitals();
                escorts.Add(e);
            }
            Teleport(motor, arena.Center + away * 12f);
            var normal = First<ApsaraAI>(false);
            var elite = First<ApsaraAI>(true);
            yield return Until(() => Seen("hover"), 4f);
            if (escorts.Count > 0) escorts[0].Health.health = escorts[0].Health.maxHealth * 0.5f;
            yield return Until(() => Seen("cast") && elite && elite.Chords > 0, 18f);
            if (elite && elite.Chords > 0 && escorts.Count > 0)
            {
                float ratio = elite.LastChordShield / Mathf.Max(1, escorts[0].Health.maxHealth);
                notes.Add($"精英和弦护盾 {ratio:P0} 最大生命（应 65%）");
                if (Mathf.Abs(ratio - 0.65f) > 0.02f) Fail($"邪飞天：精英和弦护盾 {ratio:P0}（应 ×1.3 = 65%）");
            }
            if (!normal) yield break;
            // 打琵琶：每次 5% 最大生命（弱点），直到琴碎
            float t0 = Time.time;
            while (normal && !normal.Dead && !normal.Silenced && Time.time - t0 < 6f)
            {
                var at = normal.TetherOrigin;
                var info = DamageInfo.Simple(normal.Health.maxHealth * 0.05f, DamageSource.Weapon, at, Vector3.forward);
                info.weakpoint = true;
                info.noCrit = true;
                Combat.DamageEnemy(normal.Health, info);
                normal.Health.health = normal.Health.maxHealth;
                yield return new WaitForSeconds(0.15f);
            }
            var weakParent = normal && normal.Body.WeakPoint ? normal.Body.WeakPoint.parent : null;
            bool chest = weakParent && weakParent.name.Contains("chest");
            notes.Add($"琵琶：断弦 {normal.StringsSnapped} 根，琴碎 {(normal.Silenced ? "✓" : "✗")}，弱点挪到 {(weakParent ? weakParent.name : "无")}");
            if (!normal.Silenced) Fail("邪飞天：打琵琶到 30% 没琴碎");
            if (normal.StringsSnapped < 1) Fail("邪飞天：打琵琶没断弦");
            if (!chest) Fail("邪飞天：琴碎后弱点没挪到胸口");
            // 提前到点：3.2 s 后重凝（最后 3 s 有预警）
            SetPrivate(normal, "silencedUntil", Time.time + 3.2f);
            yield return Until(() => normal.Reforms > 0 && normal.State == "hover", 8f);
            weakParent = normal.Body.WeakPoint ? normal.Body.WeakPoint.parent : null;
            notes.Add($"重凝 {(normal.Reforms > 0 ? "✓" : "✗")}，弱点回到 {(weakParent ? weakParent.name : "无")}");
            if (normal.Reforms == 0) Fail("邪飞天：沉默到点没有重凝");
            if (!weakParent || !weakParent.name.Contains("pipa")) Fail("邪飞天：重凝后弱点没回到琵琶");
            notes.Add($"施法：和弦 {normal.Chords + (elite ? elite.Chords : 0)}、花开 {normal.Blooms + (elite ? elite.Blooms : 0)}、赐福 {normal.Blessings + (elite ? elite.Blessings : 0)}");
        }

        // ── 沙魇 ──
        IEnumerator Wraith()
        {
            Teleport(motor, arena.Center + away * 10f);
            // 潜沙突袭全套（玩家站着不动：破沙要打中）；潜行中打不到（Track 里逐帧看）
            int hits0 = group.Select(m => m.ai).OfType<SandWraithAI>().Sum(w => w.EruptHits);
            yield return Until(() => Seen("erupt") && Seen("recover") && group.Select(m => m.ai).OfType<SandWraithAI>().Sum(w => w ? w.EruptHits : 0) > hits0, 18f);
            int stillHits = group.Select(m => m.ai).OfType<SandWraithAI>().Sum(w => w ? w.EruptHits : 0) - hits0;
            if (!Seen("erupt")) Fail("沙魇：玩家站在 10 m 外不动，18 s 里一次潜沙突袭都没有");
            else if (stillHits == 0) Fail("沙魇：玩家站着不动，破沙旋斩一次都没打中");
            // 贴脸爪击
            float t0 = Time.time;
            while (Time.time - t0 < 12f && !Seen("slash"))
            {
                var e = Live(false).FirstOrDefault(x => x.State == "stalk");
                if (e)
                {
                    Keep(e.transform.position + Flat(e.transform.forward).normalized * 1.3f, 0.5f);
                    ZeroCooldown(e);
                }
                yield return new WaitForSeconds(0.2f);
            }
            // 精英：破沙预警时玩家闪开 7 m → 连潜
            var elite = First<SandWraithAI>(true);
            t0 = Time.time;
            while (elite && !elite.Dead && Time.time - t0 < 22f && elite.Chains == 0)
            {
                if (elite.State == "stalk")
                {
                    float d = Flat(elite.transform.position - motor.transform.position).magnitude;
                    if (d < 7f || d > 13f) Keep(elite.transform.position + away * 10f, 2f);
                    SetPrivate(elite, "burrowCd", 0f);
                }
                if (elite.State == "surface")
                {
                    Teleport(motor, motor.transform.position + side * 7f);
                    yield return Until(() => elite.State != "surface", 1.5f);
                }
                yield return null;
            }
            var all = group.Select(m => m.ai).OfType<SandWraithAI>().ToList();
            notes.Add($"潜沙 {all.Sum(w => w.Burrows)} 次、破沙打中 {all.Sum(w => w.EruptHits)} 次、精英连潜 {(elite ? elite.Chains : 0)} 次；" +
                      $"潜行中不可选中 {(wraithHidden && !wraithExposed ? "✓" : "✗")}");
            if (Seen("burrow") && (!wraithHidden || wraithExposed)) Fail("沙魇：潜行中还能被选中");
            if (elite && elite.Chains == 0) Fail("沙魇：精英破沙落空后没有连潜");
            // 换皮：着色器参数写进去了；顺手给一只蝎尾弩卫换「沙魇·」的皮
            var any = Live().OfType<SandWraithAI>().FirstOrDefault();
            if (any)
            {
                var v = any.GetComponent<EnemyVariant>();
                float crack = 0;
                var block = new MaterialPropertyBlock();
                foreach (var r in any.GetComponentsInChildren<Renderer>())
                {
                    r.GetPropertyBlock(block);
                    crack = Mathf.Max(crack, block.GetVector("_VariantParams").y);
                }
                notes.Add($"沙魇皮：{(v ? $"{v.Spec.id}，{v.Renderers} 个渲染器，裂纹 {crack:F2}" : "✗ 没换皮")}");
                if (!v || v.Renderers == 0 || crack <= 0) Fail("沙魇：没有换上沙魇的皮（着色器参数没写进去）");
                PoseShot(any, side, "desert_wraith");
            }
            var scorp = arena.Spawn("scorpion_archer", false, new Vector3(5f, 0, 0));
            yield return new WaitForSeconds(0.8f);
            if (scorp)
            {
                SandWraith.Apply(scorp, Color.white, new Color(0.85f, 0.66f, 0.4f), 0.38f);
                yield return null;
                bool named = scorp.Health.displayName.StartsWith(SandWraith.Prefix);
                notes.Add($"沙魇·蝎尾弩卫：{scorp.Health.displayName}，{(SandWraith.Is(scorp) && EnemyVariant.Is(scorp, EnemyVariant.SandId) ? "换皮 ✓" : "✗")}");
                if (!named || !EnemyVariant.Is(scorp, EnemyVariant.SandId)) Fail("沙魇·：给杂兵换沙魇皮失败");
                PoseShot(scorp, side, "desert_sand_scorpion");
                Combat.Execute(scorp.Health, false);
                yield return new WaitForSeconds(0.6f);
                var sv = scorp ? scorp.GetComponent<EnemyVariant>() : null;
                if (sv && !sv.Crumbled) Fail("沙魇·蝎尾弩卫：倒下没有崩成沙");
            }
        }

        // ───────────── 死亡 ─────────────

        IEnumerator Death(string id)
        {
            var victim = Live(false).FirstOrDefault(e => !e.Health.untargetable) ?? Live(false).FirstOrDefault();
            if (!victim)
            {
                notes.Add("死亡：没有活着的普通单位（自爆 / 已死）");
                yield break;
            }
            Teleport(motor, victim.transform.position + away * 9f);
            yield return null;
            var fires0 = new HashSet<FloorFire>(FindObjectsByType<FloorFire>());
            int marksBefore = GroundMark.Spawned;
            var toad = victim as MirageToadAI;
            if (toad)
            {
                // 先放一次幻术（分身在场），再打死本体：分身要跟着消散
                typeof(MirageToadAI).GetMethod("CastMirage", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)?.Invoke(toad, null);
                yield return new WaitForSeconds(0.3f);
            }
            int decoys = toad ? toad.DecoyCount : 0;
            var apsara = victim as ApsaraAI;
            var buffed = apsara ? Live().Where(e => e != victim && e.Buffs.HasFrom(EnemyBuffs.ApsaraAura, apsara)).ToList() : new List<EnemyAI>();
            Combat.Execute(victim.Health, false);
            yield return new WaitForSeconds(0.7f);
            var bad = new List<string>();
            if (!victim || !victim.Dead) bad.Add("没死");
            if (victim && EnemyRegistry.LiveList.Contains(victim)) bad.Add("还在注册表里");
            string extra = "";
            switch (id)
            {
                case "fire_rat":
                    int fresh = FindObjectsByType<FloorFire>().Count(f => f && !fires0.Contains(f));
                    extra = $"新余火 {fresh} 片";
                    if (fresh == 0) bad.Add("没留余火");
                    break;
                case "tomb_beast":
                    extra = $"焦痕 +{GroundMark.Spawned - marksBefore}";
                    if (GroundMark.Spawned <= marksBefore) bad.Add("没留焦痕");
                    break;
                case "mirage_toad":
                    yield return new WaitForSeconds(0.5f);
                    int left = FindObjectsByType<MirageToadAI>().Count(m => m && m.isDecoy && m.caster == toad && !m.Dead);
                    extra = $"分身 {decoys} → {left}";
                    if (decoys == 0) bad.Add("放了幻术却没有分身");
                    if (left > 0) bad.Add("本体死了分身没消散");
                    break;
                case "apsara":
                    int still = buffed.Count(e => e && !e.Dead && e.Buffs.HasFrom(EnemyBuffs.ApsaraAura, apsara));
                    extra = $"光环同伴 {buffed.Count} → {still}";
                    if (still > 0) bad.Add("死后光环没撤");
                    break;
                case "sand_wraith":
                    var v = victim ? victim.GetComponent<EnemyVariant>() : null;
                    extra = v && v.Crumbled ? "崩成沙 ✓" : "✗ 没崩沙";
                    if (!v || !v.Crumbled) bad.Add("没崩成沙");
                    break;
            }
            notes.Add($"死亡 {(bad.Count == 0 ? "✓" : "✗")}{(extra.Length > 0 ? $"（{extra}）" : "")}");
            if (bad.Count > 0) Fail($"{id} 死亡：{string.Join("、", bad)}");
        }
    }

    static class DesertSuiteExt
    {
        static readonly System.Reflection.FieldInfo StateTime = typeof(EnemyAI).GetField("stateTime", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        /// <summary>当前状态已经持续超过 seconds 秒</summary>
        public static bool InStateFor(this EnemyAI ai, float seconds) => ai && StateTime != null && (float)StateTime.GetValue(ai) > seconds;
    }
}
