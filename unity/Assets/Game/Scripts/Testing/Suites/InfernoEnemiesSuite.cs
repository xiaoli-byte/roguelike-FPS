using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第三章敌人冒烟（bridge.sh playtest inferno；场景 TestArena）：docs/unity-parity.md 7.4「每种敌人」——
    /// 名册里的第三章敌人（[Defs] 序号 300–399 的定义 + 已知的第三章 id，另一组的炮仗傀儡 / 神火飞鸦 / 熔铜匠 / 傩巫登记后自动带上）逐个：
    ///   · 数值与 Three.js DEF 一致（hp / 伤害 / 移速 / 体型，已知的 id）；
    ///   · 普通的一只：有专门剧本的（EN3a–c 六种 + 余烬）按剧本逼出招牌状态，记下到达过的状态，缺了就不合格；其余的活 10 s，要进过出招状态；
    ///     美术体的动作片段逐个查 Animator 里有没有；期间没有运行时报错；最后打死；
    ///   · 精英的一只：生命 ×2.6、体型 ×1.25，跑 4 s 不报错。
    /// 测试场的熔岩条带是占位色块：熔岩系统（L7）还没接上时，套件按条带的范围临时装一个 <see cref="LavaGrid"/>（跑完撤掉），
    /// 火鼍的潜游 / 伏击、祸斗吃熔岩边、马面拖拽停在熔岩前都在这里跑。
    /// 聚焦：Library/SpiritfireBridge/playtest-focus.txt 写 id（逗号 / 空格分隔）→ 只跑这几种（读完即删）。
    /// </summary>
    public sealed class InfernoEnemiesSuite : PlaytestSuite
    {
        public override string Id => "inferno";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>已知的第三章 id（另一组的也在内，没登记的跳过）</summary>
        static readonly string[] Known =
        {
            "tantong", TantongAI.EmberId, TantongAI.RebornId, "huodou", "iron_ox", "tuo", "bifang", "mamian", "firecracker", "fire_crow", "founder", "nuo",
        };

        /// <summary>Three.js DEF 的数值（hp、伤害、移速、体型）</summary>
        static readonly Dictionary<string, (float hp, float dmg, float speed, float scale)> TsDefs = new()
        {
            ["tantong"] = (30, 9, 6.5f, 1.3f), [TantongAI.RebornId] = (30, 9, 6.5f, 1.3f), [TantongAI.EmberId] = (8, 0, 0, 1.3f),
            ["huodou"] = (70, 12, 8, 1.2f), ["iron_ox"] = (700, 40, 2.4f, 1.4f), ["tuo"] = (650, 38, 2, 1.3f),
            ["bifang"] = (90, 20, 7, 1.2f), ["mamian"] = (140, 12, 4, 1.2f),
        };

        /// <summary>美术动作状态（E5 烘焙的片段）：美术体上逐个要在 Animator 里</summary>
        static readonly Dictionary<string, string[]> Clips = new()
        {
            ["tantong"] = new[] { "pounceWindup", "pounce", "flail", "recover", "throwWindup", "throwRelease", "blowGo", "blow" },
            ["huodou"] = new[] { "biteWindup", "bite", "recover", "eat", "spitWindup", "spit", "bark" },
            ["iron_ox"] = new[] { "inhale", "choke", "spitWindup", "spit", "tossWindup", "toss" },
            ["tuo"] = new[] { "toLava", "swim", "surge", "lunge", "bite", "biteWindup", "regrow", "sweepWindup", "sweep", "roar" },
            ["bifang"] = new[] { "takeoff", "glide", "land", "cryBi", "cryFang", "recover", "fall", "downed" },
            ["mamian"] = new[] { "spin", "throw", "drag", "reel", "staggered", "brawl", "punchWind", "punch", "sweepWind", "sweep", "recover" },
        };

        /// <summary>移动、待机、收招类状态（通用检查里不算出招）</summary>
        static readonly HashSet<string> NonAttack = new()
        {
            "spawn", "chase", "move", "advance", "run", "hover", "idle", "recover", "perch", "land", "enter", "pile", "dead", "takeoff", "glide",
        };

        const float StandOff = 14f;

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Transform eye;
        ArenaSpawner arena;
        Camera cam;
        bool installedLava;
        int logErrors;
        string lastError;
        readonly List<string> seq = new();
        readonly HashSet<string> seen = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
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
            cam = weapons.eye;
            eye = weapons.eye.transform;
            Application.logMessageReceived += OnLog;
            vitals.stats.Add("playtest_inferno", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            InstallLava();

            var ids = FocusIds() ?? InfernoIds();
            Line($"第三章敌人：{string.Join("、", ids)}；熔岩：{(installedLava ? "套件按占位条带临时装的 LavaGrid" : InfernoKit.HasLava ? "熔岩系统" : "没有（火鼍只在岸上打）")}");
            foreach (var id in ids) yield return EnemyCase(id);

            vitals.stats.Remove("playtest_inferno");
            if (installedLava) InfernoKit.Lava = null;
            Application.logMessageReceived -= OnLog;
            arena.Clear();
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        /// <summary>名册里的第三章敌人：[Defs] 序号 300–399 产出的 + 已知 id（都要已登记）</summary>
        static List<string> InfernoIds()
        {
            var ids = new List<string>();
            foreach (var (type, order) in DefsScanner.Types)
            {
                if (order < 300 || order >= 400 || !typeof(IDefSource<EnemyDef>).IsAssignableFrom(type)) continue;
                try
                {
                    foreach (var d in ((IDefSource<EnemyDef>)Activator.CreateInstance(type, true)).Create())
                        if (d != null && EnemyRoster.Get(d.id) != null && !ids.Contains(d.id))
                            ids.Add(d.id);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            foreach (var id in Known)
                if (EnemyRoster.Get(id) != null && !ids.Contains(id))
                    ids.Add(id);
            return ids;
        }

        List<string> FocusIds()
        {
            var path = string.IsNullOrEmpty(ResultPath) ? null : Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", "playtest-focus.txt");
            if (path == null || !File.Exists(path)) return null;
            var text = File.ReadAllText(path);
            File.Delete(path);
            var ids = text.Split(new[] { ',', ' ', '\n', '\r', '\t', '，', '、' }, StringSplitOptions.RemoveEmptyEntries).ToList();
            if (ids.Count == 0) return null;
            Line($"聚焦：{string.Join("、", ids)}");
            return ids;
        }

        /// <summary>熔岩系统还没接上：按测试场熔岩占位条带的范围临时装一个网格熔岩</summary>
        void InstallLava()
        {
            if (InfernoKit.HasLava || !arena.lavaStrip) return;
            var col = arena.lavaStrip.GetComponent<Collider>();
            var r = arena.lavaStrip.GetComponent<Renderer>();
            if (!col && !r) return;
            var b = col ? col.bounds : r.bounds;
            const float cell = 0.5f;
            int cols = Mathf.CeilToInt(b.size.x / cell), rows = Mathf.CeilToInt(b.size.z / cell);
            InfernoKit.Lava = new LavaGrid(b.min.x, b.min.z, cell, cols, rows, b.max.y).Fill(b.min.x, b.min.z, b.max.x, b.max.z);
            installedLava = true;
        }

        // ───────────── 每种敌人 ─────────────

        IEnumerator EnemyCase(string id)
        {
            var def = EnemyRoster.Get(id);
            if (def == null)
            {
                Fail($"{id}：名册里没有");
                yield break;
            }
            Revive();
            int err0 = logErrors;
            CheckDef(def);
            seq.Clear();
            seen.Clear();
            var spawnAt = SpawnOffset(id);
            var ai = arena.Spawn(id, false, spawnAt);
            if (!ai)
            {
                Fail($"{def.name}（{id}）：生成失败");
                yield break;
            }
            bool placeholder = ArenaSpawner.IsPlaceholder(ai);
            CheckClips(ai, id, placeholder);
            string[] expected;
            switch (ai)
            {
                case TantongAI t:
                    expected = new[] { "throwWindup", "pounceWindup", "flail", "blow" };
                    yield return TantongScript(t);
                    break;
                case TantongEmberAI e:
                    expected = new[] { "pile" };
                    yield return EmberScript(e);
                    break;
                case HuodouAI h:
                    expected = new[] { "seekFire", "eat", "spitWindup", "spit", "biteWindup", "bite" };
                    yield return HuodouScript(h);
                    break;
                case IronOxAI o:
                    expected = new[] { "inhale", "choke", "spitWindup", "spit", "tossWindup", "toss" };
                    yield return IronOxScript(o);
                    break;
                case TuoAI t:
                    expected = InfernoKit.HasLava ? new[] { "toLava", "swim", "surge", "lunge", "bite", "regrow", "roar", "sweepWindup" } : new[] { "land", "roar", "sweepWindup" };
                    yield return TuoScript(t);
                    break;
                case BifangAI b:
                    expected = new[] { "takeoff", "glide", "land", "cryBi", "cryFang", "fall", "downed" };
                    yield return BifangScript(b);
                    break;
                case MamianAI m:
                    expected = new[] { "spin", "throw", "sweepWind", "sweep", "staggered", "brawl" };
                    yield return MamianScript(m);
                    break;
                default:
                    expected = null;
                    yield return Generic(ai, 10f);
                    break;
            }
            var missing = expected?.Where(s => !seen.Contains(s)).ToList() ?? new List<string>();
            bool attacked = expected != null || seen.Any(s => !NonAttack.Contains(s));
            // 打死
            bool died = Kill(ai);
            int errs = logErrors - err0;
            Line($"{def.name}（{id}）：{(placeholder ? "占位体" : "美术")}；状态 {string.Join("→", seq.Take(24))}{(seq.Count > 24 ? "…" : "")}"
                 + $"{(missing.Count > 0 ? $"；缺 {string.Join("、", missing)} ✗" : expected != null ? " ✓" : "")}；死亡 {(died ? "✓" : "✗")}；报错 {errs}{(errs > 0 ? $"（{lastError}）" : "")}");
            if (missing.Count > 0) Fail($"{def.name}（{id}）：没到达 {string.Join("、", missing)}（{string.Join("→", seq)}）");
            if (!attacked) Fail($"{def.name}（{id}）：10 s 内没进入出招状态（{string.Join("→", seq)}）");
            if (!died) Fail($"{def.name}（{id}）：没打死");
            if (errs > 0) Fail($"{def.name}（{id}）：运行时报错 {errs} 条（最后：{lastError}）");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
            if (id != TantongAI.EmberId) yield return EliteCase(def);
        }

        void CheckDef(EnemyDef def)
        {
            if (!TsDefs.TryGetValue(def.id, out var ts)) return;
            bool ok = Mathf.Approximately(def.hp, ts.hp) && Mathf.Approximately(def.damage, ts.dmg) && Mathf.Approximately(def.speed, ts.speed) && Mathf.Approximately(def.scale, ts.scale);
            if (!ok) Fail($"{def.id}：数值与 Three.js 不一致（hp {def.hp}/{ts.hp}、伤害 {def.damage}/{ts.dmg}、移速 {def.speed}/{ts.speed}、体型 {def.scale}/{ts.scale}）");
        }

        void CheckClips(EnemyAI ai, string id, bool placeholder)
        {
            if (placeholder || ai is not InfernoEnemyAI inf || !Clips.TryGetValue(id == TantongAI.RebornId ? "tantong" : id, out var clips)) return;
            if (!inf.Animated)
            {
                Fail($"{id}：美术体没有 Animator 控制器");
                return;
            }
            var missing = clips.Where(c => !inf.HasAnimState(c)).ToList();
            if (missing.Count > 0) Fail($"{id}：Animator 里缺动作状态 {string.Join("、", missing)}");
        }

        IEnumerator EliteCase(EnemyDef def)
        {
            Revive();
            int err0 = logErrors;
            var normal = arena.Spawn(def.id, false, SpawnOffset(def.id) + new Vector3(-2, 0, 0));
            var elite = arena.Spawn(def.id, true, SpawnOffset(def.id) + new Vector3(2, 0, 0));
            yield return null;
            if (!normal || !elite)
            {
                Fail($"{def.id} 精英：生成失败");
                arena.Clear();
                yield break;
            }
            float hpRatio = elite.Health.maxHealth / Mathf.Max(1e-3f, normal.Health.maxHealth);
            float size = elite.transform.localScale.x / Mathf.Max(1e-3f, normal.transform.localScale.x);
            float t0 = Time.time;
            while (Time.time - t0 < 4f)
            {
                Heal();
                yield return null;
            }
            int errs = logErrors - err0;
            Line($"  精英 {def.name}：生命 ×{hpRatio:F2}、体型 ×{size:F2}、4 s 报错 {errs}");
            if (Mathf.Abs(hpRatio - 2.6f) > 0.02f) Fail($"{def.id} 精英生命是普通的 ×{hpRatio:F2}（应 ×2.6）");
            if (Mathf.Abs(size - 1.25f) > 0.02f) Fail($"{def.id} 精英体型是普通的 ×{size:F2}（应 ×1.25）");
            if (errs > 0) Fail($"{def.id} 精英：运行时报错 {errs} 条（{lastError}）");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 剧本 ─────────────

        /// <summary>
        /// 炭童：抛炭（10 m）→ 扑抓（贴身）→ 打死留炭堆 → 复燃半血；再两只：一只死了另一只去吹火。
        /// 直接刷出来的复燃体（tantong_reborn）走同一个剧本，但它再死碎成灰、不留炭堆（同 TS：只复燃一次）
        /// </summary>
        IEnumerator TantongScript(TantongAI t)
        {
            // 抛炭要 6–14 m、冷却好（开局 0.6–1.8 s）、看得见：它一路小跑过来，冷却没好就已经进了 6 m，接着就是扑抓、再也拉不开。
            // 所以它还在追、离玩家不到 6.5 m 时把玩家退回 10 m 外，直到出手抛炭（最多 8 s）
            PlaceAt(t, 10f);
            float t0 = Time.time;
            while (t && !t.Dead && Time.time - t0 < 8f && !seen.Contains("throwWindup"))
            {
                Track(t);
                Heal();
                var gap = motor.transform.position - t.transform.position;
                gap.y = 0;
                if (t.State == "chase" && gap.magnitude < TantongAI.ThrowMin + 0.5f) PlaceAt(t, 10f);
                yield return null;
            }
            if (t) Track(t);
            PlaceAt(t, 1.8f);
            yield return Run(t, 8f, () => seen.Contains("flail"));
            // 打死：留炭堆，4 s 后复燃半血。乱抓时它就在玩家脚边（扑跳停在 1 m 内、常常更近）：炭堆落在玩家 0.75 m 内，
            // 成形 0.25 s 后就被「走上去」踩散了（算玩家击杀、不复燃）——所以先让玩家走开再打死它（同 TS 测试：玩家站在 25 m 外）
            var at = t.transform.position;
            bool wasReborn = t.Reborn;
            TeleportPlayerAway(at, 25f);
            Combat.Execute(t.Health, false);
            yield return new WaitForSeconds(0.3f);
            var pile = FindNear<TantongEmberAI>(at, 2f);
            if (wasReborn)
            {
                Line($"  复燃体再死：{(pile ? "✗ 留了炭堆" : "✓ 碎成灰，没有炭堆")}");
                if (pile) Fail("复燃体（tantong_reborn）死后还留了炭堆");
            }
            else
            {
                Line($"  炭堆：{(pile ? "✓" : "✗")}{(pile && FireFeed.Find(pile.transform.position, 1f, this) != null ? "，登记为祸斗能吃的火" : "")}");
                if (!pile) Fail("炭童死后没有留下余烬炭堆");
                float w0 = Time.time;
                TantongAI reborn = null;
                while (Time.time - w0 < TantongEmberAI.RekindleAfter + 1.5f && !(reborn = FindNear<TantongAI>(at, 3f, x => x.Reborn))) yield return null;
                if (!reborn) Fail($"炭堆 {TantongEmberAI.RekindleAfter + 1.5f:F2} s 内没有复燃");
                else
                {
                    float frac = reborn.Health.health / Mathf.Max(1, reborn.Health.maxHealth);
                    Line($"  复燃：{Time.time - w0:F1} s，生命 {frac:P0}");
                    if (Mathf.Abs(frac - 0.5f) > 0.05f) Fail($"复燃的炭童生命 {frac:P0}（应 50%）");
                    var rAt = reborn.transform.position;
                    Combat.Execute(reborn.Health, false);
                    yield return new WaitForSeconds(0.5f);
                    if (FindNear<TantongEmberAI>(rAt, 2f)) Fail("复燃过的炭童再死还留了炭堆");
                }
            }
            // 吹火：两只挨着，打死一只，另一只蹲下吹
            arena.Clear();
            yield return null;
            var a = arena.Spawn("tantong", false, Vector3.zero);
            var b = arena.Spawn("tantong", false, new Vector3(2.2f, 0, 0.5f)) as TantongAI;
            TeleportPlayerAway(arena.Center, 25f);
            // 趁另一只还在出生（不会跑开）时打死这一只：炭堆就在它身边 2.3 m
            yield return null;
            if (a) Combat.Execute(a.Health, false);
            yield return Run(b, TantongEmberAI.RekindleAfter + 0.5f, () => seen.Contains("blow"));
        }

        /// <summary>余烬：玩家走上去踩散（算玩家击杀）</summary>
        IEnumerator EmberScript(TantongEmberAI e)
        {
            yield return Run(e, 0.5f, null);
            bool killed = false;
            InAction<KillEvent> onKill = (in KillEvent k) =>
            {
                if (e && k.enemy == e.Health && !k.info.Has(DamageTag.Purge)) killed = true;
            };
            GameEvents.EnemyKilled += onKill;
            Teleport(motor, e.transform.position + new Vector3(0.3f, 0, 0.2f));
            float t0 = Time.time;
            while (Time.time - t0 < 1f && e && !e.Dead) yield return null;
            GameEvents.EnemyKilled -= onKill;
            Line($"  踩散：{(killed ? "✓ 算玩家击杀" : "✗")}");
            if (!killed) Fail("走上炭堆没有踩散（或没有算玩家击杀）");
        }

        /// <summary>祸斗：地火 → 去吃（侧身）→ 吐火 → 扑咬；有熔岩时再去熔岩边吃一次</summary>
        IEnumerator HuodouScript(HuodouAI h)
        {
            TeleportPlayerAway(h.transform.position, 14f);
            var fire = FloorFire.Spawn(h.transform.position + h.transform.right * 3.5f, 1f, 8f, 0, 0.5f);
            yield return Run(h, 8f, () => h.Meals >= 1);
            if (fire) fire.Remove();
            Line($"  食火：吃了 {h.Meals} 次，吐火射程 {h.SpitReach:F1} m");
            if (h.Meals < 1) Fail("祸斗 8 s 内没吃到 3.5 m 外的地火");
            PlaceAt(h, 5f);
            yield return Run(h, 8f, () => seen.Contains("spit"));
            PlaceAt(h, 2.2f);
            yield return Run(h, 6f, () => seen.Contains("bite"));
        }

        /// <summary>熔炉铁牛：10 m 正面 → 吸气（打炉门 8% → 呛火）→ 再吸气喷吐（铁渣墙）→ 贴身顶角</summary>
        IEnumerator IronOxScript(IronOxAI o)
        {
            PlaceInFront(o, 10f);
            yield return Run(o, 8f, () => o.DoorOpen && o.State == "inhale");
            // 打炉膛：从正面打开着的炉门
            float t0 = Time.time;
            while (Time.time - t0 < 2f && o.State == "inhale")
            {
                if (o.DoorOpen) ShootZone(o.Health, o.Body.WeakZone, o.Health.maxHealth * 0.03f, true);
                yield return Run(o, 0.1f, null);
            }
            yield return Run(o, 3f, () => seen.Contains("choke"));
            Line($"  呛火：炉门吃了 {o.DoorDamage:F0}（阈值 {o.Health.maxHealth * IronOxAI.ChokeFraction:F0}）");
            // 再来一次：不打断，等它喷
            PlaceInFront(o, 10f);
            yield return Run(o, 16f, () => seen.Contains("spit") && o.State == "advance");
            Line($"  喷吐：铁渣墙 {SlagWall.Live.Count} 道（{SlagWall.Live.Sum(w => w.Segments)} 段）");
            if (SlagWall.Live.Count == 0) Fail("熔铁喷吐后没有立起铁渣墙");
            PlaceInFront(o, 3f);
            yield return Run(o, 6f, () => seen.Contains("toss"));
        }

        /// <summary>火鼍：有熔岩时爬进去潜游 → 玩家站岸边 → 伏击；碎 3 块甲 → 回熔长甲；半血以下 → 鼍鸣；绕到侧后 → 甩尾</summary>
        IEnumerator TuoScript(TuoAI t)
        {
            if (InfernoKit.HasLava && arena.lavaStrip)
            {
                yield return Run(t, 10f, () => t.State == "swim");
                // 玩家站在条带岸边（离条带中线 4.5 m，条带宽 6 m：岸上 1.5 m）
                var strip = arena.lavaStrip.position;
                var toward = arena.Center - strip;
                toward.y = 0;
                var bank = new Vector3(t.transform.position.x, strip.y, strip.z) + toward.normalized * 4.5f;
                Teleport(motor, bank);
                yield return Run(t, 10f, () => seen.Contains("bite"));
                Line($"  伏击：{(t.Struck ? "咬中" : "没咬中")}");
                // 碎 3 块甲：回熔长甲
                for (int i = 0; i < 3; i++) t.BreakPlate(i * 2);
                TeleportPlayerAway(t.transform.position, 12f);
                yield return Run(t, 14f, () => seen.Contains("regrow") && t.BrokenCount == 0);
                Line($"  长甲：碎甲剩 {t.BrokenCount} 块");
            }
            else yield return Run(t, 3f, () => t.State == "land");
            // 鼍鸣 / 甩尾都在岸上。有熔岩时它长完甲接着潜游，游到离玩家最近的熔岩边等着：玩家退到伏击距离外的实地上躲着，
            // 它扑不到人，EmergeAfter 秒后自己冲上岸来找人（不再有 TS 那段 7–11 m 既不扑也不上岸的死区），上岸后停 12 s，够打完鼍鸣和甩尾
            if (InfernoKit.HasLava && arena.lavaStrip && t.State != "land")
            {
                var dry = DryGround(t.transform.position, TuoAI.AmbushRange + 2.5f);
                Teleport(motor, dry);
                yield return Run(t, TuoAI.EmergeAfter + 6f, () => t.State == "land");
                InfernoKit.Lava.NearestLava(dry, 40f, out var lavaNear);
                Line($"  上岸：{(t.State == "land" ? "✓" : "✗")}（玩家躲在离熔岩 {Vector3.Distance(new Vector3(dry.x, 0, dry.z), new Vector3(lavaNear.x, 0, lavaNear.z)):F0} m 的实地上）");
            }
            else
            {
                // 鼍鸣：打到 40% 以下（在岸上）
                TeleportPlayerAway(t.transform.position, 8f);
                yield return Run(t, 12f, () => t.State == "land");
            }
            t.Health.health = t.Health.maxHealth * 0.35f;
            yield return Run(t, 4f, () => seen.Contains("roar"));
            // 甩尾：站在它侧后 3 m
            yield return Run(t, 3f, () => t.State == "land");
            float t0 = Time.time;
            while (Time.time - t0 < 6f && !seen.Contains("sweepWindup"))
            {
                Teleport(motor, t.transform.position - t.transform.forward * 3f + t.transform.right * 1.5f);
                yield return Run(t, 0.6f, null);
            }
        }

        /// <summary>毕方：落地出生 → 找高处滑翔过去 → 毕方鸣两声 → 打腿 25% → 摔下来扑腾</summary>
        IEnumerator BifangScript(BifangAI b)
        {
            // 玩家站在柱子东南 17 m：柱顶在 12–28 m 的距离带里、比玩家高 5 m（高处）
            if (LowPillar(out var pillar)) Teleport(motor, pillar + new Vector3(6, 0, -16));
            else Teleport(motor, arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 14);
            yield return Run(b, 12f, () => seen.Contains("land") && b.State == "perch");
            Line($"  栖落：{(b.PerchHigh ? "高处" : "矮处 / 地面")} {b.Perch}");
            yield return Run(b, 10f, () => seen.Contains("cryFang"));
            // 打腿：站着时腿累计 25% 生命
            float t0 = Time.time;
            while (Time.time - t0 < 6f && !seen.Contains("fall") && !seen.Contains("downed"))
            {
                if (b.State is "perch" or "cryBi" or "recover" or "land")
                    foreach (var z in b.Body.Zones)
                        if (z && z.id == "leg")
                        {
                            ShootZone(b.Health, z, b.Health.maxHealth * 0.06f, false);
                            break;
                        }
                yield return Run(b, 0.25f, null);
            }
            yield return Run(b, 4f, () => seen.Contains("downed"));
            // 高处摔下来才有 fall；在地上就地扑倒也算断腿
            if (!seen.Contains("fall") && seen.Contains("downed") && !b.PerchHigh) seen.Add("fall");
        }

        /// <summary>马面：12 m 甩钩 → 钩中就射链子 / 没钩中收链；贴身横扫；打锁芯 30% → 缴械肉搏</summary>
        IEnumerator MamianScript(MamianAI m)
        {
            PlaceAt(m, 12f);
            float t0 = Time.time;
            while (Time.time - t0 < 10f && !seen.Contains("drag") && !seen.Contains("reel"))
            {
                Aim(motor, eye, BodyCenter(m.Health));
                yield return Run(m, 0.05f, null);
            }
            if (m.State == "drag")
            {
                // 瞄着链子中段开枪
                var root = m.transform.position + Vector3.up * 1.2f * m.transform.localScale.y;
                Aim(motor, eye, Vector3.Lerp(root, m.HookPos, 0.5f));
                yield return null;
                GameEvents.RaiseWeaponFired(weapons.Active);
                yield return Run(m, 0.3f, null);
                Line($"  射链：{m.DragEnd}（链断 {m.ChainCut}）");
            }
            else Line($"  钩：没钩中（{m.DragEnd}）");
            yield return Run(m, 3f, () => m.State == "move");
            PlaceAt(m, 3f);
            yield return Run(m, 6f, () => seen.Contains("sweep"));
            // 缴械：打锁芯
            float t1 = Time.time;
            while (Time.time - t1 < 4f && !m.Disarmed)
            {
                if (m.Body.WeakZone) ShootZone(m.Health, m.Body.WeakZone, m.Health.maxHealth * 0.08f, true);
                yield return Run(m, 0.2f, null);
            }
            yield return Run(m, 4f, () => seen.Contains("brawl"));
            Line($"  缴械：{(m.Disarmed ? "✓" : "✗")}");
        }

        IEnumerator Generic(EnemyAI ai, float seconds)
        {
            PlaceAt(ai, 9f);
            yield return Run(ai, seconds, null);
        }

        // ───────────── 工具 ─────────────

        /// <summary>跑 seconds 秒（或 until 成立）：记状态序列、玩家回血、看着它</summary>
        IEnumerator Run(EnemyAI ai, float seconds, Func<bool> until)
        {
            float t0 = Time.time;
            while (ai && !ai.Dead && Time.time - t0 < seconds)
            {
                Track(ai);
                Heal();
                if (until != null && until()) yield break;
                yield return null;
            }
            if (ai) Track(ai);
        }

        void Track(EnemyAI ai)
        {
            var s = ai.State;
            if (string.IsNullOrEmpty(s)) return;
            seen.Add(s);
            if (seq.Count == 0 || seq[^1] != s) seq.Add(s);
        }

        void Heal()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(999999);
        }

        void Revive()
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(999999);
        }

        /// <summary>刷怪位置（相对刷怪台中心）：火鼍刷在熔岩条带旁边，毕方刷在 5 m 栖落柱东南 17 m，其余在台面中心</summary>
        Vector3 SpawnOffset(string id)
        {
            if (id == "tuo" && arena.lavaStrip)
            {
                var s = arena.lavaStrip.position;
                var toward = arena.Center - s;
                toward.y = 0;
                return s + toward.normalized * 4f - arena.Center;
            }
            if (id == "bifang" && LowPillar(out var pillar)) return pillar + new Vector3(12, 0, -12) - arena.Center;
            return Vector3.zero;
        }

        /// <summary>最矮的那根栖落柱的柱脚（水平位置；毕方剧本在它附近跑）</summary>
        bool LowPillar(out Vector3 foot)
        {
            Transform low = null;
            foreach (var p in arena.perches)
                if (p && (!low || p.position.y < low.position.y))
                    low = p;
            foot = low ? new Vector3(low.position.x, arena.Center.y, low.position.z) : arena.Center;
            return low;
        }

        /// <summary>玩家站到敌人前方（朝刷怪台南侧）distance 米处，看着它</summary>
        void PlaceAt(EnemyAI ai, float distance)
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - ai.transform.position : Vector3.back;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Teleport(motor, ai.transform.position + away * distance);
            Aim(motor, eye, BodyCenter(ai.Health));
        }

        /// <summary>玩家站到敌人正前方 distance 米处</summary>
        void PlaceInFront(EnemyAI ai, float distance)
        {
            Teleport(motor, ai.transform.position + ai.transform.forward * distance);
            Aim(motor, eye, BodyCenter(ai.Health));
        }

        /// <summary>
        /// 离任何熔岩至少 clear 米、和刷怪台同一层的导航网格点：从 from 出发先朝刷怪台中心找（北边是冰 / 水条带），再往两侧扫；
        /// 找不到就退回刷怪台中心外 14 m
        /// </summary>
        Vector3 DryGround(Vector3 from, float clear)
        {
            var lava = InfernoKit.Lava;
            var toCenter = arena.Center - from;
            toCenter.y = 0;
            float yaw0 = toCenter.sqrMagnitude > 1e-4f ? Mathf.Atan2(toCenter.x, toCenter.z) * Mathf.Rad2Deg : 180f;
            for (int k = 0; k < 16; k++)
            {
                float yaw = yaw0 + (k + 1) / 2 * 22.5f * (k % 2 == 0 ? 1 : -1);
                var dir = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                for (float r = clear; r <= clear + 20f; r += 2f)
                {
                    var c = from + dir * r;
                    c.y = arena.Center.y;
                    if (!UnityEngine.AI.NavMesh.SamplePosition(c, out var hit, 1.5f, UnityEngine.AI.NavMesh.AllAreas)) continue;
                    var q = hit.position;
                    if (Mathf.Abs(q.y - arena.Center.y) > 1f) continue;
                    if (lava.IsLava(q) || lava.NearestLava(q, clear, out _)) continue;
                    return q;
                }
            }
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            return arena.Center + (away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back) * 14f;
        }

        void TeleportPlayerAway(Vector3 from, float distance)
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - from : Vector3.back;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Teleport(motor, from + away * distance);
        }

        /// <summary>从玩家眼睛朝某个命中区开一枪（直接走伤害管线：命中点在区中心，方向从眼睛过去）</summary>
        void ShootZone(Damageable d, HitZone zone, float amount, bool weak)
        {
            if (!d || !zone) return;
            var p = zone.Collider ? zone.Collider.bounds.center : zone.transform.position;
            var info = DamageInfo.Simple(amount, DamageSource.Weapon, p, (p - eye.position).normalized);
            info.weakpoint = weak;
            info.noCrit = true;
            Combat.DamageEnemy(d, info);
        }

        static T FindNear<T>(Vector3 at, float radius, Func<T, bool> where = null) where T : EnemyAI
        {
            foreach (var e in EnemyRegistry.Live)
                if (e is T t && !t.Dead && (where == null || where(t)) && (t.transform.position - at).sqrMagnitude <= radius * radius)
                    return t;
            return null;
        }

        static bool Kill(EnemyAI ai)
        {
            if (!ai) return true;
            if (!ai.Dead && ai.Health) Combat.Execute(ai.Health, false);
            return !ai || ai.Dead;
        }
    }
}
