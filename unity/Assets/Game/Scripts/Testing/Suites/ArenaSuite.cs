using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 测试场冒烟（bridge.sh playtest arena；场景 TestArena，由 Pipeline/Editor/Levels/Level_TestArena.cs 生成）：
    ///   · 场地件齐全（出生点、武器架、坡度台、三座高台、三根栖落柱、熔岩 / 冰 / 水占位条带及其标签），武器架摆出了全部已登记的武器；
    ///   · 名册里的每种敌人（现在是第一章 7 种）+ 一个未登记的 id（<see cref="UnknownId"/>，必须生成占位体）依次在刷怪台上生成：
    ///     先让它活 5 s（玩家站在 14 m 外、看着它、不还手），没出过招就再等到 10 s；然后用武器把它打死（最多开火 40 s）；
    ///     每只记一行：生成（美术 / 占位体）、进入攻击状态（哪个状态、第几秒）、死亡（致死来源、开火用时）、期间的运行时报错数、状态序列；
    ///   · 精英：生命 ×2.6、体型 ×1.25；强制占位体之后场景的敌人目录要还原。
    /// 辅助类敌人（站位 Support，如邪飞天）有友军才出手：给它配一只护卫，只看它自己的状态，开火前把护卫撤掉。
    /// 运行时报错由宿主记不合格（PlaytestRunner），这里只按敌人归账。
    /// 聚焦：Library/SpiritfireBridge/playtest-focus.txt 写敌人 id（逗号 / 空格分隔）→ 只跑这几种（读完即删），后续单元验收新敌人用。
    /// </summary>
    public sealed class ArenaSuite : PlaytestSuite
    {
        public override string Id => "arena";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同，运行时程序集引用不到那边的常量）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>名册里没有的 id：刷怪台按占位模板生成占位体</summary>
        public const string UnknownId = "arena_unregistered";
        /// <summary>辅助类敌人的护卫</summary>
        const string EscortId = "jerboa_blade";
        const float LiveSeconds = 5f, MaxWaitAttack = 10f, KillTimeout = 40f, StandOff = 14f;

        /// <summary>已知敌人的攻击状态（AI 状态名）。表里没有的敌人：不在 <see cref="NonAttack"/> 里的状态都算出招</summary>
        static readonly Dictionary<string, string[]> AttackStates = new()
        {
            ["jerboa_blade"] = new[] { "crouch", "leap", "slashWindup", "slash", "spin" },
            ["scorpion_archer"] = new[] { "aim", "fire", "snapWindup", "snap" },
            ["mirage_toad"] = new[] { "puff", "spit", "mirage" },
            ["mirage_toad_decoy"] = new[] { "puff", "spit", "mirage" },
            ["tomb_beast"] = new[] { "chargeWindup", "charge", "stompWindup", "stomp" },
            ["apsara"] = new[] { "cast" },
            ["fire_rat"] = new[] { "curl", "roll" },
        };

        /// <summary>移动、待机、收招、受控类状态（不算出招）</summary>
        static readonly HashSet<string> NonAttack = new()
        {
            "spawn", "chase", "move", "advance", "hover", "idle", "recover", "hopBack", "dizzy", "dazed", "stunned", "brake",
            "tunnel", "dive", "emerge", "flee", "strafe", "reposition", "perch", "land", "takeoff", "dead",
        };

        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            var eye = weapons.eye.transform;
            Line($"玩家：生命 {vitals.health}/{vitals.MaxHealth} 武器 {weapons.Active?.def.name}；刷怪台 {arena.Center}，难度 ×{arena.difficulty}");

            CheckLayout(arena);
            CheckRack();
            Shot(weapons.eye, "arena_spawn");

            var ids = FocusIds();
            if (ids == null)
            {
                ids = EnemyRoster.All.Select(d => d.id).ToList();
                ids.Add(UnknownId);
            }
            Line($"敌人：{string.Join("、", ids)}");
            vitals.stats.Add("playtest_arena", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            foreach (var id in ids) yield return EnemyCase(arena, motor, eye, weapons, vitals, id);
            yield return EliteAndPlaceholderCase(arena);
            vitals.stats.Remove("playtest_arena");
            Application.logMessageReceived -= OnLog;
            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，暴击 {Runner.crits}，击杀 {Runner.kills}，敌人对玩家伤害 {Runner.playerDamage:F0}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        /// <summary>聚焦文件里的敌人 id；没有聚焦文件时为 null</summary>
        List<string> FocusIds()
        {
            var path = string.IsNullOrEmpty(ResultPath) ? null : Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", "playtest-focus.txt");
            if (path == null || !File.Exists(path)) return null;
            var text = File.ReadAllText(path);
            File.Delete(path);
            var ids = text.Split(new[] { ',', ' ', '\n', '\r', '\t', '，', '、' }, System.StringSplitOptions.RemoveEmptyEntries).ToList();
            if (ids.Count == 0) return null;
            Line($"聚焦：{string.Join("、", ids)}");
            return ids;
        }

        // ───────────── 场地 ─────────────

        void CheckLayout(ArenaSpawner a)
        {
            var missing = new List<string>();
            if (!a.playerSpawn) missing.Add("出生点");
            if (!a.weaponRack) missing.Add("武器架");
            if (!a.slopeDeck) missing.Add("坡度台面");
            if (a.slopes.Count(s => s) != 3) missing.Add($"坡道（{a.slopes.Count(s => s)}/3）");
            if (a.platforms.Count(p => p) != 3) missing.Add($"高台（{a.platforms.Count(p => p)}/3）");
            if (a.perches.Count(p => p) != 3) missing.Add($"栖落柱（{a.perches.Count(p => p)}/3）");
            foreach (var (t, tag) in new[] { (a.lavaStrip, "Lava"), (a.iceStrip, "Ice"), (a.waterStrip, "Water") })
            {
                if (!t) missing.Add($"{tag} 条带");
                else if (t.gameObject.tag != tag) missing.Add($"{tag} 条带的标签（现在是 {t.gameObject.tag}）");
            }
            var heights = string.Join(" / ", a.platformHeights.Select(h => $"{h} m"));
            var slopes = string.Join(" / ", a.slopeAngles.Select(s => $"{s}°"));
            Line($"场地：高台 {heights}，坡道 {slopes}，栖落柱 {a.perches.Length} 根{(missing.Count > 0 ? "；缺 " + string.Join("、", missing) : "")}");
            if (missing.Count > 0) Fail($"测试场缺场地件：{string.Join("、", missing)}");
            if (!a.platformHeights.SequenceEqual(new[] { 2.5f, 4f, 6f })) Fail($"高台高度是 {heights}（应为 2.5 / 4 / 6 m）");
        }

        void CheckRack()
        {
            var laid = FindObjectsByType<WeaponPickup>().Where(w => w && w.weapon != null).Select(w => w.weapon.def.id).ToHashSet();
            var missing = WeaponLibrary.All.Where(d => !laid.Contains(d.id)).Select(d => d.id).ToList();
            Line($"武器架：地上 {laid.Count} 把（{string.Join("、", laid)}）{(missing.Count > 0 ? "，缺 " + string.Join("、", missing) : "")}");
            if (missing.Count > 0) Fail($"武器架没有摆出：{string.Join("、", missing)}");
        }

        // ───────────── 敌人 ─────────────

        /// <summary>生成 → 活 5 s（看有没有出招）→ 武器打死 → 清场</summary>
        IEnumerator EnemyCase(ArenaSpawner arena, PlayerMotor motor, Transform eye, WeaponController weapons, PlayerVitals vitals, string id)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Teleport(motor, arena.Center + away * StandOff);
            Aim(motor, eye, arena.Center + Vector3.up);
            yield return null;

            bool registered = ArenaSpawner.IsRegistered(id);
            var def = EnemyRoster.Get(registered ? id : arena.placeholderTemplate);
            string label = registered ? $"{def?.name}（{id}）" : $"未登记 {id}（占位模板 {arena.placeholderTemplate}）";
            int err0 = logErrors;
            var ai = arena.Spawn(id, false, Vector3.zero);
            if (!ai || def == null)
            {
                Fail($"{label}：生成失败");
                yield break;
            }
            bool placeholder = ArenaSpawner.IsPlaceholder(ai);
            if (!registered)
            {
                var body = ai.GetComponent<PlaceholderBody>();
                if (!body) Fail($"{label}：未登记的 id 没有生成占位体（PlaceholderBody）");
                else if (body.enemyId != id) Fail($"{label}：占位体记的 id 是 {body.enemyId}");
            }
            EnemyAI escort = null;
            if (def.placementRole == EnemyPlacement.Support && ArenaSpawner.IsRegistered(EscortId))
                escort = arena.Spawn(EscortId, false, new Vector3(2.5f, 0, 0));
            AttackStates.TryGetValue(def.id, out var attackSet);

            // ── 活 5 s：看它能不能走到出招（没出过招就等到 10 s）──
            var states = new List<string>();
            string attack = null;
            float attackAt = 0, t0 = Time.time;
            bool shot = false;
            while (ai && !ai.Dead && Time.time - t0 < MaxWaitAttack && (Time.time - t0 < LiveSeconds || attack == null))
            {
                var s = ai.State;
                if (states.Count == 0 || states[^1] != s) states.Add(s);
                if (attack == null && IsAttack(s, attackSet))
                {
                    attack = s;
                    attackAt = Time.time - t0;
                }
                if (ai.Health) Aim(motor, eye, BodyCenter(ai.Health));
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                if (attack != null && !shot)
                {
                    shot = true;
                    Shot(weapons.eye, $"arena_{id}");
                }
                yield return null;
            }
            if (escort) Destroy(escort.gameObject);

            // ── 开火打死 ──
            DamageSource? killedBy = null;
            InAction<KillEvent> onKill = (in KillEvent e) =>
            {
                if (ai && e.enemy == ai.Health) killedBy = e.info.source;
            };
            GameEvents.EnemyKilled += onKill;
            float k0 = Time.time, flankAt = 0;
            while (ai && !ai.Dead && Time.time - k0 < KillTimeout)
            {
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                weapons.Active.reserve = weapons.Active.def.reserve; // 测试不缺子弹
                var hp = ai.Health;
                if (!hp || hp.untargetable)
                {
                    weapons.testFire = false;
                    yield return null;
                    continue;
                }
                var body = ai.GetComponent<EnemyBody>();
                var aim = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy && Random.value < 0.4f ? body.WeakPoint.position : BodyCenter(hp);
                // 镇墓兽正面格挡：像玩家一样绕到背后打
                if (ai is TombBeastAI && Time.time >= flankAt)
                {
                    flankAt = Time.time + 2.5f;
                    Teleport(motor, ai.transform.position - ai.transform.forward * 9f);
                }
                Aim(motor, eye, aim);
                if (Vector3.Distance(eye.position, aim) > 22f) Teleport(motor, Vector3.MoveTowards(motor.transform.position, ai.transform.position, 6f));
                else if (Time.time >= flankAt && Combat.Blocked(eye.position, aim, null))
                {
                    flankAt = Time.time + 1.5f;
                    if (SightSpot(hp, aim, out var spot)) Teleport(motor, spot);
                }
                // 半自动枪要一下一下扣
                weapons.testFire = weapons.Active.def.mode != FireMode.Semi || !weapons.testFire;
                yield return null;
            }
            weapons.testFire = false;
            GameEvents.EnemyKilled -= onKill;
            bool died = !ai || ai.Dead;
            float fireTime = Time.time - k0;
            int errs = logErrors - err0;

            string attackText = attack != null ? $"✓ {attack}（{attackAt:F1} s）" : "✗";
            string deathText = died ? $"✓（{(killedBy.HasValue ? killedBy.Value.ToString() : "无击杀事件")}，开火 {fireTime:F1} s）" : $"✗（剩 {ai.Health.health + ai.Health.armor + ai.Health.shield:F0}）";
            Line($"{label}：生成 ✓（{(placeholder ? "占位体" : "美术")}），出招 {attackText}，死亡 {deathText}，报错 {errs}{(errs > 0 ? $"（最后一条：{lastError}）" : "")}；" +
                 $"状态 {string.Join("→", states.Take(14))}{(states.Count > 14 ? "…" : "")}");
            if (attack == null) Fail($"{label}：{MaxWaitAttack:F0} s 内没进入出招状态（{string.Join("→", states)}）");
            if (!died) Fail($"{label}：开火 {KillTimeout:F0} s 没打死");
            // 自爆型敌人（火浣鼠、冰河豚、冰棘豪彘、神火飞鸦…）自爆身亡：同 Three.js 不算击杀（没有击杀事件、不给奖励），不判失败
            else if (!killedBy.HasValue && !(ai is ISelfDestruct { Detonated: true })) Fail($"{label}：死了但没有经伤害管线派发击杀事件");
            arena.Clear();
            yield return new WaitForSeconds(0.4f);
        }

        static bool IsAttack(string state, string[] attackSet) =>
            !string.IsNullOrEmpty(state) && (attackSet != null ? System.Array.IndexOf(attackSet, state) >= 0 : !NonAttack.Contains(state));

        /// <summary>精英：同一种敌人普通 / 精英各刷一只，生命 ×2.6、体型 ×1.25；强制占位体之后敌人目录要还原（再刷就是美术）</summary>
        IEnumerator EliteAndPlaceholderCase(ArenaSpawner arena)
        {
            var def = EnemyRoster.Get(EscortId) ?? EnemyRoster.All.FirstOrDefault();
            if (def == null)
            {
                Fail("名册是空的");
                yield break;
            }
            var normal = arena.Spawn(def.id, false, new Vector3(-2, 0, 0));
            var elite = arena.Spawn(def.id, true, new Vector3(2, 0, 0));
            yield return null;
            if (!normal || !elite)
            {
                Fail($"精英检查：生成 {def.id} 失败");
                arena.Clear();
                yield break;
            }
            float hpRatio = elite.Health.maxHealth / Mathf.Max(1e-3f, normal.Health.maxHealth);
            float sizeRatio = elite.transform.localScale.x / Mathf.Max(1e-3f, normal.transform.localScale.x);
            Line($"精英 {def.name}：elite {elite.elite}，级别 {elite.Health.rank}，生命 {elite.Health.maxHealth:F0} / 普通 {normal.Health.maxHealth:F0}（×{hpRatio:F2}），体型 ×{sizeRatio:F2}");
            if (!elite.elite || elite.Health.rank != Rank.Elite) Fail("精英标记没有写到 AI / Damageable 上");
            if (Mathf.Abs(hpRatio - 2.6f) > 0.01f) Fail($"精英生命是普通的 ×{hpRatio:F2}（应 ×2.6）");
            if (Mathf.Abs(sizeRatio - 1.25f) > 0.01f) Fail($"精英体型是普通的 ×{sizeRatio:F2}（应 ×1.25）");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);

            // 先刷一只普通的看场景里有没有它的 Prefab，再强制占位体，再刷一只普通的看目录有没有还原
            bool Art(EnemyAI e) => e && !ArenaSpawner.IsPlaceholder(e);
            bool hasPrefab = Art(arena.Spawn(def.id, false, Vector3.zero));
            arena.Clear();
            bool forcedOk = ArenaSpawner.IsPlaceholder(arena.Spawn(def.id, false, Vector3.zero, true));
            arena.Clear();
            bool restored = Art(arena.Spawn(def.id, false, Vector3.zero));
            arena.Clear();
            Line($"强制占位体 {def.id}：{(forcedOk ? "✓ 占位体" : "✗ 不是占位体")}；之后再刷：{(hasPrefab ? restored ? "美术（目录已还原）" : "占位体（目录没还原）" : "场景里本来就没有它的 Prefab")}");
            if (!forcedOk) Fail($"强制占位体刷出来的 {def.id} 不是占位体");
            if (hasPrefab && !restored) Fail("强制占位体之后敌人目录没有还原");
            yield return new WaitForSeconds(0.3f);
        }
    }
}
