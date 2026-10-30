using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领浸泡（I3 平衡，docs/balance.md 第 3 节；bridge.sh playtest boss-soak，单个首领 boss-soak-hanba / -kunpeng / -warlord / -qilin）：
    /// 在真实首领关里，用各章的代表性配装把四个首领各打一遍，量击杀用时、确认每个阶段都走到。
    ///   · 顺序：1-4 旱魃 → 2-4 鲲鹏 → 3-3 熔心魔将 → 3-4 火麒麟（SceneFlow.GoTo 带着本局换关；单个首领的子套件直接从那一关开）；
    ///   · 配装（<see cref="Cases"/>）：裂风步枪（秒伤带中位的无属性枪）按章给稀有度 / 强化（第一章精良 +1、第二章史诗 +2、第三章传说 +1 / +2——
    ///     首领宝箱第一章保底史诗、第二章起保底传说），加各章典型的增伤秘卷；英雄按关卡（缺省燎），技能隔 4 s 放一次；不带灵宠、不点天赋；
    ///   · 打法：玩家无敌、每帧瞄身体中心（不打弱点）、一直开火（备弹补满），被挡 / 太远 / 太近就换到 9–15 m 能看见的站位；
    ///     首领不可选中或被护体（命中被格挡）时打最近的小怪；火麒麟饮熔 1.5 s 后打碎身后的锁扣（会用机制的玩家）；其余机制（日食弱点、引鹏撞墙）不用；
    ///   · 计时：登场结束 → 倒下（游戏秒，时间 ×3）。不可选中的秒数单独记；估算的实际用时 = 可选中秒数 ÷ 输出率 <see cref="Uptime"/>（躲招、换位）+ 不可选中秒数。
    /// 判定：估算用时在 60–120 s、每个阶段都走到（BossPhase 事件数 = 阶段数 − 1）、300 游戏秒内倒下、期间没有运行时报错；否则不合格。
    /// 结果另写 CSV（结果文件同目录的 boss_soak.csv）。
    /// </summary>
    public class BossSoakSuite : PlaytestSuite
    {
        public override string Id => "boss-soak";
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";

        /// <summary>击杀用时的目标带（秒）与估算用的输出率（<see cref="BossBalance"/>）</summary>
        public const float MinSeconds = BossBalance.MinSeconds, MaxSeconds = BossBalance.MaxSeconds, Uptime = BossBalance.Uptime;
        const float TimeScale = 3f, Limit = 300f, SkillEvery = 4f, LockDelay = 1.5f, StandMin = 9f, StandMax = 15f;
        public const string CsvName = "boss_soak.csv";

        /// <summary>一套配装：武器、稀有度、强化、秘卷层数</summary>
        public sealed class Loadout
        {
            public string label, weapon = "rifle";
            public int rarity, level;
            public (string id, int stacks)[] scrolls = System.Array.Empty<(string, int)>();

            /// <summary>稀有度 × 强化的伤害倍率</summary>
            public float GearMult => WeaponLibrary.RarityDamage[Rarity.Clamp(rarity)] * (1 + WeaponLibrary.UpgradeStep * level);

            public string Describe() =>
                $"{WeaponLibrary.Get(weapon)?.name ?? weapon} {Rarity.Name(rarity)} +{level}（×{GearMult:F2}）" +
                (scrolls.Length > 0 ? "，" + string.Join("、", scrolls.Select(s => $"{ScrollLibrary.Get(s.id)?.name ?? s.id} ×{s.stacks}")) : "，无秘卷");
        }

        public sealed class Case
        {
            public string stage, bossId;
            public Loadout loadout;
        }

        /// <summary>各章的代表性配装（docs/balance.md 3.1）</summary>
        public static readonly Loadout Ch1 = new()
        {
            label = "第一章", rarity = Rarity.Uncommon, level = 1, scrolls = new[] { ("keen_blade", 2), ("hawk_eye", 1) },
        };
        public static readonly Loadout Ch2 = new()
        {
            label = "第二章", rarity = Rarity.Epic, level = 2, scrolls = new[] { ("keen_blade", 3), ("hawk_eye", 2), ("giant_slayer", 1) },
        };
        public static readonly Loadout Ch3 = new()
        {
            label = "第三章", rarity = Rarity.Legendary, level = 1,
            scrolls = new[] { ("keen_blade", 4), ("hawk_eye", 2), ("giant_slayer", 1), ("fatal_art", 1) },
        };
        public static readonly Loadout Ch3End = new()
        {
            label = "第三章末", rarity = Rarity.Legendary, level = 2,
            scrolls = new[] { ("keen_blade", 5), ("hawk_eye", 2), ("giant_slayer", 1), ("fatal_art", 1) },
        };

        public static readonly Case[] Cases =
        {
            new() { stage = "1-4", bossId = HanbaDef.Id, loadout = Ch1 },
            new() { stage = "2-4", bossId = KunPengDef.Id, loadout = Ch2 },
            new() { stage = "3-3", bossId = WarlordDef.Id, loadout = Ch3 },
            new() { stage = "3-4", bossId = QilinDef.Id, loadout = Ch3End },
        };

        /// <summary>这一趟打哪几个（子套件只打一个）</summary>
        protected virtual IEnumerable<Case> Selected => Cases;

        // ───────────── 运行状态 ─────────────

        sealed class Result
        {
            public Case c;
            public string bossName, vitals;
            public float difficulty, seconds, untargetable, damage, est;
            public int phases, phaseCount, phaseEvents, hits, crits, locks, adds;
            public bool dead;
            public readonly Dictionary<string, float> bySource = new();
            public readonly List<float> phaseAt = new();
        }

        readonly List<Result> results = new();
        readonly List<string> csv = new();
        readonly object speedOwner = new();
        TimeScaleArbiter.Handle speed;
        int logErrors;
        string lastError;

        Result cur;
        Damageable bossHp;
        BossBrain bossBrain;
        float lastBlockedAt = -99;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            Application.logMessageReceived += OnLog;
            InAction<HitEvent> onHit = OnHit;
            GameEvents.EnemyDamaged += onHit;
            GameEvents.BossPhase += OnPhase;
            var policy = BossIntroDirector.Policy;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            csv.Add("stage,boss,difficulty,hp,shield,armor,loadout,gear_mult,seconds,untargetable,estimate,in_band,phases,phase_count,damage,dps_targetable,weapon,skill,status,reaction,other,crits,hits,locks,adds,errors");
            try
            {
                var list = Selected.ToList();
                Line($"首领浸泡：{list.Count} 个首领，输出率 {Uptime:P0}，目标 {MinSeconds:F0}–{MaxSeconds:F0} s，时间 ×{TimeScale}");
                foreach (var c in list) yield return RunCase(c);
                Summary();
                WriteCsv();
            }
            finally
            {
                speed?.Dispose();
                speed = null;
                BossIntroDirector.Policy = policy;
                GameEvents.EnemyDamaged -= onHit;
                GameEvents.BossPhase -= OnPhase;
                Application.logMessageReceived -= OnLog;
            }
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnHit(in HitEvent e)
        {
            if (cur == null || !bossHp || e.enemy != bossHp) return;
            if (e.result.blocked) lastBlockedAt = Time.time;
            float t = e.result.total;
            if (!(t > 0)) return;
            cur.damage += t;
            cur.hits++;
            if (e.result.crit) cur.crits++;
            string key = DamageCalc.IsReaction(e.info) ? "reaction" : e.info.source switch
            {
                DamageSource.Weapon or DamageSource.Melee => "weapon",
                DamageSource.Skill => "skill",
                DamageSource.Status => "status",
                DamageSource.Explosion => (e.info.tags & DamageTag.Weapon) != 0 || e.info.weaponUid != 0 ? "weapon" : "skill",
                _ => "other",
            };
            cur.bySource.TryGetValue(key, out var v);
            cur.bySource[key] = v + t;
        }

        void OnPhase(BossBrain b, int p)
        {
            if (cur == null || b != bossBrain) return;
            cur.phaseEvents++;
            cur.phaseAt.Add(b.FightTime);
        }

        void EnsureSpeed()
        {
            if (speed == null || !speed.Live) speed = TimeScaleArbiter.Request(speedOwner, TimeScale, 50);
        }

        // ───────────── 一个首领 ─────────────

        IEnumerator RunCase(Case c)
        {
            var stage = RunPlan.Get(c.stage);
            var def = Bosses.Get(c.bossId);
            if (stage == null || def == null)
            {
                Fail($"没有关卡 {c.stage} 或首领 {c.bossId}");
                yield break;
            }
            Line($"══ {stage.Label} · {def.name}（{c.loadout.label}：{c.loadout.Describe()}）══");
            // ── 到那一关 ──
            float w0 = Time.realtimeSinceStartup;
            while ((!SceneFlow.Instance || SceneFlow.Instance.Busy || SceneFlow.Instance.Player == null) && Time.realtimeSinceStartup - w0 < 30f) yield return null;
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("SceneFlow / 玩家没就绪");
                yield break;
            }
            if (flow.Current != stage)
            {
                speed?.Dispose();
                speed = null;
                if (!flow.GoTo(stage))
                {
                    Fail($"去不了 {stage.Label}（场景 {stage.scene}）");
                    yield break;
                }
                yield return null;
                w0 = Time.realtimeSinceStartup;
                while ((flow.Busy || flow.Player == null || flow.Current != stage) && Time.realtimeSinceStartup - w0 < 120f) yield return null;
                if (flow.Busy || flow.Player == null || flow.Current != stage)
                {
                    Fail($"换到 {stage.Label} 超时（当前 {flow.Current?.Label}）");
                    yield break;
                }
                yield return new WaitForSecondsRealtime(1f);
            }
            var rig = flow.Player;
            var res = new Result { c = c, bossName = def.name, phaseCount = def.PhaseCount };
            results.Add(res);
            int err0 = logErrors;
            Equip(rig, c.loadout);
            yield return new WaitForSeconds(0.8f);
            if (rig.weapons.Active == null || rig.weapons.Active.def.id != c.loadout.weapon)
            {
                Fail($"{def.name}：配装的武器没拿到手上（手上 {rig.weapons.Active?.def.id ?? "空"}）");
                yield break;
            }

            // ── 开战 ──
            var enc = FindObjectsByType<BossEncounter>(FindObjectsInactive.Include, FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == c.bossId);
            var arena = enc && enc.arena ? enc.arena : BossArena.Find(c.bossId);
            if (!arena)
            {
                Fail($"{def.name}：场景里没有首领场地（先 bridge.sh level {c.stage}）");
                yield break;
            }
            BossBrain boss = null;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                var gate = FindAnyObjectByType<FoundryLordGate>();
                if (gate && gate.encounter == enc && !gate.Unlocked) gate.Unlock(false);
                else if (!enc.enabled) enc.enabled = true;
                Teleport(rig.motor, arena.PlayerEntryPoint);
                Aim(rig.motor, rig.eye, arena.BossSpawnPoint + Vector3.up * 3f);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 8f)
                {
                    if (enc.State == BossEncounter.Phase.Waiting && Time.time - t0 > 2f) enc.Begin();
                    yield return null;
                }
                boss = enc.Boss;
            }
            if (!boss)
            {
                Line($"  BossEncounter {(enc ? enc.State.ToString() : "没有")}：直接在场地上刷 {def.name}");
                Teleport(rig.motor, arena.PlayerEntryPoint);
                boss = Bosses.Spawn(c.bossId, arena, stage.difficulty);
            }
            if (!boss)
            {
                Fail($"{def.name}：首领没生成");
                yield break;
            }
            bossBrain = boss;
            bossHp = boss.Health;
            float i0 = Time.time;
            while (!boss.IntroDone && !boss.Dead && Time.time - i0 < def.intro.seconds + 10f) yield return null;
            if (!boss.IntroDone)
            {
                Fail($"{def.name}：登场 {def.intro.seconds + 10f:F0} s 没结束");
                yield break;
            }
            res.difficulty = boss.level;
            res.vitals = $"{bossHp.maxHealth:F0} 生命 + {bossHp.maxShield:F0} 护盾 + {bossHp.maxArmor:F0} 护甲";
            Line($"  {boss.Title}：难度 {boss.level:F2}，{res.vitals}，英雄 {rig.hero?.name}，阶段 {def.PhaseCount}（阈值 {string.Join(" / ", def.phases.Select(p => $"{p.at:P0}"))}）");

            // ── 打 ──
            cur = res;
            lastBlockedAt = -99;
            yield return Fight(rig, boss, arena, res);
            cur = null;
            res.dead = boss.Dead;
            res.phases = boss.Phase + 1;
            float targetable = Mathf.Max(0, res.seconds - res.untargetable);
            res.est = targetable / Uptime + res.untargetable;
            bool inBand = res.est >= MinSeconds && res.est <= MaxSeconds;
            int errs = logErrors - err0;
            float dps = targetable > 0 ? res.damage / targetable : 0;
            string parts = string.Join("、", res.bySource.OrderByDescending(kv => kv.Value).Select(kv => $"{SourceName(kv.Key)} {kv.Value / Mathf.Max(1, res.damage):P0}"));
            Line($"  结果：{(res.dead ? "倒下" : "没打死")} {res.seconds:F1} 游戏秒（不可选中 {res.untargetable:F1} s），估算实际 {res.est:F0} s {(inBand ? "✓" : "✗")}；" +
                 $"阶段 {res.phases}/{res.phaseCount}（转换事件 {res.phaseEvents}，开始于 {string.Join(" / ", res.phaseAt.Select(t => $"{t:F0} s"))}）；" +
                 $"可选中时秒伤 {dps:F0}（{parts}），命中 {res.hits}（暴击 {res.crits}），锁扣 {res.locks}，打小怪 {res.adds}" + (errs > 0 ? $"；报错 {errs}（{lastError}）" : ""));
            if (!res.dead) Fail($"{def.name}：{Limit:F0} 游戏秒没打死（剩 {bossHp.health:F0} 生命 / {bossHp.shield:F0} 护盾 / {bossHp.armor:F0} 护甲）");
            if (res.phases < res.phaseCount || res.phaseEvents < res.phaseCount - 1)
                Fail($"{def.name}：没走完全部阶段就倒下了（{res.phases}/{res.phaseCount}，转换事件 {res.phaseEvents}）");
            if (!inBand) Fail($"{def.name}：估算用时 {res.est:F0} s 不在 {MinSeconds:F0}–{MaxSeconds:F0} s（实测 {res.seconds:F0} s、不可选中 {res.untargetable:F0} s）");
            if (errs > 0) Fail($"{def.name}：期间有 {errs} 条运行时报错（最后一条：{lastError}）");
            float Part(string k) => res.bySource.TryGetValue(k, out var v) ? v : 0;
            var vt = boss.Def != null ? boss.Def.VitalsAt(boss.level) : default;
            csv.Add(string.Join(",", c.stage, c.bossId, F(res.difficulty), F(bossHp.maxHealth), F(bossHp.maxShield), F(bossHp.maxArmor), Csv(c.loadout.Describe()),
                F(c.loadout.GearMult), F(res.seconds), F(res.untargetable), F(res.est), inBand ? 1 : 0, res.phases, res.phaseCount, F(res.damage), F(dps),
                F(Part("weapon")), F(Part("skill")), F(Part("status")), F(Part("reaction")), F(Part("other")), res.crits, res.hits, res.locks, res.adds, errs));
            speed?.Dispose();
            speed = null;
            bossHp = null;
            bossBrain = null;
            yield return new WaitForSecondsRealtime(2f);
        }

        static string SourceName(string k) => k switch
        {
            "weapon" => "武器",
            "skill" => "技能",
            "status" => "持续",
            "reaction" => "反应",
            _ => "其他",
        };

        void Equip(PlayerRig rig, Loadout l)
        {
            var def = WeaponLibrary.Get(l.weapon);
            var inst = new WeaponInstance(def, l.rarity) { level = l.level };
            rig.weapons.Give(inst);
            rig.vitals.invulnerableUntil = Time.time + 1e5f;
            var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            if (inv == null)
            {
                Fail("没有 LootDirector，秘卷装不上");
                return;
            }
            foreach (var (d, _) in inv.Owned().ToList()) inv.SetStacks(d, 0, rig.vitals.stats, rig.vitals);
            foreach (var (id, n) in l.scrolls)
            {
                var sd = ScrollLibrary.Get(id);
                if (sd == null) Fail($"没有秘卷 {id}");
                else inv.SetStacks(sd, n, rig.vitals.stats, rig.vitals);
            }
            var R = WeaponStatsResolver.Resolve(inst, rig.vitals.stats);
            inst.mag = R.magCap;
            inst.reserve = Mathf.Max(inst.reserve, R.reserveCap);
            Line($"  配装：{l.Describe()}；解析后每发 {R.perShot:F1}、秒伤约 {R.dps:F0}、暴击率 {rig.vitals.stats.Get(Stat.CritChance):P0}");
        }

        // ───────────── 交战 ─────────────

        static NavMeshQueryFilter WalkMask => LavaField.WalkerFilter(LavaField.DryAreaMask);

        IEnumerator Fight(PlayerRig rig, BossBrain boss, BossArena arena, Result res)
        {
            var wc = rig.weapons;
            var motor = rig.motor;
            var eye = rig.eye ? rig.eye : rig.cam.transform;
            var vitals = rig.vitals;
            var skills = rig.skills;
            float t0 = Time.time, moveAt = 0, skillAt = t0 + 1f, sipAt = -1, stuckAt = t0;
            float lastHp = -1;
            Damageable lastTarget = null;
            var addsSeen = new HashSet<Damageable>();
            EnsureSpeed();
            while (!boss.Dead && Time.time - t0 < Limit)
            {
                EnsureSpeed();
                if (ScrollChoice.Open) ScrollChoice.Pick(0);
                if (vitals.Dead) vitals.Revive();
                vitals.invulnerableUntil = Time.time + 1e5f;
                var w = wc.Active;
                if (w != null && w.reserve < w.def.reserve) w.reserve = w.def.reserve;
                if (bossHp.untargetable) res.untargetable += Time.deltaTime;

                // 火麒麟：饮熔 1.5 s 后打碎身后的锁扣（鼎角砸下 → 硬直、鳞甲崩裂）
                if (boss is QilinBrain q)
                {
                    if (q.Sipping)
                    {
                        if (sipAt < 0) sipAt = Time.time;
                        else if (Time.time - sipAt > LockDelay)
                        {
                            var l = q.LockAt(q.DrinkQuadrant);
                            if (l && l.Alive)
                            {
                                var c = l.CoreTransform ? l.CoreTransform.position : l.transform.position;
                                var info = DamageInfo.Simple(l.Health.health * 10f + 999f, DamageSource.Weapon, c, l.transform.forward * -1f);
                                info.weakpoint = true;
                                Combat.DamageEnemy(l.Health, info);
                                res.locks++;
                            }
                        }
                    }
                    else sipAt = -1;
                }

                var target = PickTarget(boss, eye.position);
                if (!target)
                {
                    wc.testFire = false;
                    yield return null;
                    continue;
                }
                if (target != bossHp && addsSeen.Add(target)) res.adds++;
                var aim = AimAt(target);
                Aim(motor, eye, aim);
                float hpNow = target.health + target.shield + target.armor;
                if (target != lastTarget || hpNow < lastHp - 0.5f)
                {
                    lastTarget = target;
                    lastHp = hpNow;
                    stuckAt = Time.time;
                }
                if (Time.time >= moveAt)
                {
                    float dist = Vector3.Distance(eye.position, aim);
                    bool blocked = Combat.Blocked(eye.position, aim, null);
                    bool stuck = Time.time - stuckAt > 3f;
                    if (dist > 26f || dist < 5f || blocked || stuck)
                    {
                        moveAt = Time.time + 1f;
                        if (stuck) stuckAt = Time.time;
                        if (Stand(target, aim, arena, eye.position.y - motor.transform.position.y, out var spot)) Teleport(motor, spot);
                    }
                }
                wc.testFire = w != null && (w.def.mode != FireMode.Semi || !wc.testFire);
                if (skills && Time.time >= skillAt)
                {
                    skillAt = Time.time + SkillEvery;
                    if (skills.secondary != null && skills.secondary.charges > 0) skills.testE = true;
                    else if (skills.primary != null && skills.primary.charges > 0) skills.testQ = true;
                }
                yield return null;
            }
            wc.testFire = false;
            res.seconds = Time.time - t0;
        }

        /// <summary>首领可选中、没被护体时打首领；否则打最近的小怪（40 m 内）；都没有时首领能选中就还打首领</summary>
        Damageable PickTarget(BossBrain boss, Vector3 from)
        {
            bool bossOk = boss && !boss.Dead && bossHp && !bossHp.untargetable;
            bool warded = Time.time - lastBlockedAt < 0.6f;
            if (bossOk && !warded) return bossHp;
            Damageable best = null;
            float bestD = 40f;
            foreach (var e in EnemyAI.All)
            {
                if (!e || e.Dead || e == boss || !e.Health || e.Health.untargetable) continue;
                float d = Vector3.Distance(from, e.transform.position);
                if (d < bestD)
                {
                    bestD = d;
                    best = e.Health;
                }
            }
            return best ? best : bossOk ? bossHp : null;
        }

        static Vector3 AimAt(Damageable d)
        {
            var b = d.GetComponent<BossBrain>();
            return b ? b.BodyCenter : BodyCenter(d);
        }

        /// <summary>目标周围 9–15 m、场地里、导航网格上、眼高看得见瞄准点的站位</summary>
        static bool Stand(Damageable target, Vector3 aim, BossArena arena, float eyeHeight, out Vector3 spot)
        {
            var center = target.transform.position;
            for (int i = 0; i < 24; i++)
            {
                float a = i * Mathf.PI * 2 / 24 + Random.value * 0.25f;
                var p = center + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(StandMin, StandMax);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, WalkMask)) continue;
                if (arena && !arena.Contains(hit.position, 1f)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * Mathf.Max(1.2f, eyeHeight), aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        // ───────────── 汇总 ─────────────

        void Summary()
        {
            Line("── 汇总（游戏秒；估算 = 可选中 ÷ 输出率 + 不可选中）──");
            Line("首领 | 关 | 难度 | 耐久 | 配装 | 实测 | 不可选中 | 估算 | 阶段");
            foreach (var r in results)
                Line($"{r.bossName} | {r.c.stage} | {r.difficulty:F2} | {r.vitals} | {r.c.loadout.label} ×{r.c.loadout.GearMult:F2} | {r.seconds:F0} | {r.untargetable:F0} | {r.est:F0} | {r.phases}/{r.phaseCount}");
        }

        static string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);
        static string Csv(string s) => string.IsNullOrEmpty(s) ? "" : s.Contains(",") || s.Contains("\"") ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;

        void WriteCsv()
        {
            if (string.IsNullOrEmpty(ResultPath)) return;
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", CsvName);
                File.WriteAllText(path, string.Join("\n", csv) + "\n", new UTF8Encoding(true));
                Line($"CSV：{path}（{csv.Count - 1} 行）");
            }
            catch (IOException e)
            {
                Fail($"CSV 写不出来：{e.Message}");
            }
        }
    }

    /// <summary>只浸泡旱魃（1-4）</summary>
    public sealed class BossSoakHanbaSuite : BossSoakSuite
    {
        public override string Id => "boss-soak-hanba";
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";
        protected override IEnumerable<Case> Selected => Cases.Where(c => c.stage == "1-4");
    }

    /// <summary>只浸泡鲲鹏（2-4）</summary>
    public sealed class BossSoakKunPengSuite : BossSoakSuite
    {
        public override string Id => "boss-soak-kunpeng";
        public override string Scene => "Assets/Scenes/L2_4_Beiming.unity";
        protected override IEnumerable<Case> Selected => Cases.Where(c => c.stage == "2-4");
    }

    /// <summary>只浸泡熔心魔将（3-3）</summary>
    public sealed class BossSoakWarlordSuite : BossSoakSuite
    {
        public override string Id => "boss-soak-warlord";
        public override string Scene => "Assets/Scenes/L3_3_Foundry.unity";
        protected override IEnumerable<Case> Selected => Cases.Where(c => c.stage == "3-3");
    }

    /// <summary>只浸泡火麒麟（3-4）</summary>
    public sealed class BossSoakQilinSuite : BossSoakSuite
    {
        public override string Id => "boss-soak-qilin";
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";
        protected override IEnumerable<Case> Selected => Cases.Where(c => c.stage == "3-4");
    }
}
