using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领框架冒烟（B0，bridge.sh playtest boss；场景 TestArena）：用代理首领「试炼傀儡」（<see cref="ProxyBossDef"/>）把整条首领链路走一遍——
    ///   · 定义：全部已登记首领自检（阈值降序、形态 / 招式引用、行为类型），定档插值与血条刻度；
    ///   · 场地：测试场中央的 <see cref="BossArena"/> 锚点（场景还没重建、没有锚点时临时建一个，记一行提示）；
    ///   · 生成 / 登场：BossSpawned、级别 Boss、数值 = VitalsAt(难度)、登场期间不可选中且免疫伤害、血条挂上、模型来源（美术 / 代理 / 占位）；
    ///   · 霸体：招式间隙能被眩晕（≤ 0.35 s，之后免疫），出招中免疫；
    ///   · 招式：逐个强制出一次，每招都要走到出手段、正常收招、画过预警；召唤要真的生成爪牙且不超上限；
    ///   · 生命刻度：强制越过每个刻度（Marked）；阶段：强制越过每道阈值——BossPhase、转换中不可选中 / 免疫伤害、按时换形（BossForm、护盾回复、血条标题、形态命中区），
    ///     演出结束后恢复可选中并出形态的第一招；
    ///   · 90 s 浸泡：首领对着玩家自由出招（玩家每 6 s 换个位置，首领这段时间不掉血），不出场地、数值始终有限、招式不卡死、召唤不超上限；
    ///   · 狂怒：低血进入狂怒（喘息 / 前摇倍率生效），计时狂怒的倒计时在走；
    ///   · 击杀：先用武器打，再补一下打死——BossDefeated 一次、魂晶战果（首领 60）、首领包掉落（2 弹药 + 2 生命）、爪牙崩解、血条收起、慢动作复原、溃散后回收。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class BossSuite : PlaytestSuite
    {
        public override string Id => "boss";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string BossId = ProxyBossDef.Id;
        const float SoakSeconds = 90f, MoveTimeout = 12f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossBrain boss;
        /// <summary>击杀之前首领不吃外来伤害（灵宠、爪牙误伤、反应）：阶段 / 刻度只由测试按步骤推进</summary>
        System.IDisposable bossGuard;
        int logErrors;
        string lastError;

        // 事件记录
        int spawnedEvents, defeatedEvents;
        BossBrain defeatedBoss;
        readonly List<int> phaseEvents = new();
        readonly List<(string form, float at)> formEvents = new();
        readonly List<string> markEvents = new();
        readonly List<string> startedMoves = new();
        KillReward? reward;
        bool killEvent;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            GameEvents.BossSpawned += OnBossSpawned;
            GameEvents.BossPhase += OnBossPhase;
            GameEvents.BossForm += OnBossForm;
            GameEvents.BossDefeated += OnBossDefeated;
            GameEvents.EnemyKilled += OnKilled;
            KillResolver.Rewarded += OnRewarded;
            vitals.stats.Add("playtest_boss", Stat.MaxHp, 5000);
            vitals.Heal(99999);

            CheckDefs();
            FindArena();
            yield return SpawnAndIntro();
            if (boss && !boss.Dead)
            {
                yield return StunPolicy();
                yield return EachMove();
                yield return Marks();
                yield return Phases();
                yield return Soak();
                yield return EnrageCase();
                yield return KillCase();
            }

            weapons.testFire = false;
            bossGuard?.Dispose();
            bossGuard = null;
            vitals.stats.Remove("playtest_boss");
            GameEvents.BossSpawned -= OnBossSpawned;
            GameEvents.BossPhase -= OnBossPhase;
            GameEvents.BossForm -= OnBossForm;
            GameEvents.BossDefeated -= OnBossDefeated;
            GameEvents.EnemyKilled -= OnKilled;
            KillResolver.Rewarded -= OnRewarded;
            Application.logMessageReceived -= OnLog;
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，敌人对玩家伤害 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        // ───────────── 事件 ─────────────

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnBossSpawned(BossBrain b) => spawnedEvents++;

        void OnBossPhase(BossBrain b, int phase)
        {
            if (b == boss) phaseEvents.Add(phase);
        }

        void OnBossForm(BossBrain b, BossFormDef f)
        {
            if (b == boss) formEvents.Add((f?.id, b.TransitionTime));
        }

        void OnBossDefeated(BossBrain b)
        {
            defeatedEvents++;
            defeatedBoss = b;
        }

        void OnKilled(in KillEvent e)
        {
            if (boss && e.enemy == boss.Health) killEvent = true;
        }

        void OnRewarded(in KillReward r)
        {
            if (boss && r.enemy == boss.Health) reward = r;
        }

        void OnMarked(BossBrain b, string id) => markEvents.Add(id);
        void OnMoveStarted(BossBrain b, BossMove m) => startedMoves.Add(m.Id);

        // ───────────── 定义 / 场地 ─────────────

        void CheckDefs()
        {
            var all = Bosses.All;
            Line($"首领定义：{all.Count} 个（{string.Join("、", all.Select(d => $"{d.name}（{d.id}）"))}）");
            foreach (var d in all)
            {
                var errs = d.Validate();
                if (errs.Count > 0) Fail($"首领定义 {d.id} 自检不通过：{string.Join("；", errs)}");
            }
            var def = Bosses.Get(BossId);
            if (def == null)
            {
                Fail($"没有登记代理首领 {BossId}");
                return;
            }
            var ticks = def.BarTicks;
            Line($"代理首领：{def.name}，{def.PhaseCount} 个阶段，形态 {string.Join(" → ", def.forms.Select(f => f.id))}，招式 {def.moves.Count} 个，血条刻度 {string.Join(" / ", ticks.Select(t => $"{t:P0}"))}");
            if (!ticks.SequenceEqual(new[] { 0.75f, 0.5f })) Fail($"代理首领的血条刻度应为 75% / 50%（阶段 + 刻度事件），现在是 {string.Join(" / ", ticks)}");

            // 定档插值：一档 → 按难度等比；两档之间线性；没有定档 → × 难度
            var t = new BossDef { id = "boss_tier_probe", vitals = new BossVitals(1000) };
            bool Near(float a, float b) => Mathf.Abs(a - b) < 0.5f;
            bool plain = Near(t.VitalsAt(2f).hp, 2000) && Near(t.VitalsAt(-1).hp, 1000);
            t.tiers.Add(new BossVitalsTier(1.48f, new BossVitals(4400, 2200)));
            bool one = Near(t.VitalsAt(1.48f).hp, 4400) && Near(t.VitalsAt(2.96f).shield, 4400) && Near(t.VitalsAt(0.74f).hp, 2200);
            t.tiers.Add(new BossVitalsTier(2.28f, new BossVitals(6000, 3000)));
            bool two = Near(t.VitalsAt(1.88f).hp, 5200) && Near(t.VitalsAt(4.56f).hp, 12000);
            Line($"定档插值：无定档 {(plain ? "✓" : "✗")}，单档 {(one ? "✓" : "✗")}，两档 {(two ? "✓" : "✗")}");
            if (!plain || !one || !two) Fail("BossDef.VitalsAt 的定档插值不对");
            var sv = def.VitalsAt(1.48f);
            Line($"估算击杀用时（参考）：{def.name} 在难度 1.48 下 {sv}，按 100 秒伤约 {sv.Total / 100f:F0} s");
        }

        void FindArena()
        {
            arena = BossArena.Find(BossId);
            if (!arena)
            {
                var spawner = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
                var center = Vector3.zero;
                Line("场景里没有 BossArena 锚点（TestArena 还没按新构建器重建：bridge.sh level arena），临时在 (0, 0) 建一个半径 16 m 的场地");
                arena = BossArena.CreateRuntime(center, 16f, spawner && spawner.playerSpawn ? center - spawner.playerSpawn.position : Vector3.forward, null);
            }
            Line($"场地：{arena.name}，{arena.shape} 半径 {arena.Extent:F0} m，召唤点 {arena.summonPoints?.Length ?? 0}、掩体点 {arena.coverPoints?.Length ?? 0}、" +
                 $"栖落点 {arena.perchPoints?.Length ?? 0}、边缘点 {arena.edgePoints?.Length ?? 0}，首领出生点 {(arena.bossSpawn ? "✓" : "✗")}，玩家入场点 {(arena.playerEntry ? "✓" : "✗")}");
        }

        // ───────────── 生成 / 登场 ─────────────

        IEnumerator SpawnAndIntro()
        {
            Teleport(motor, arena.PlayerEntryPoint);
            Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
            yield return null;
            var def = Bosses.Get(BossId);
            if (def == null) yield break;
            int before = spawnedEvents;
            boss = Bosses.Spawn(BossId, arena, 1f);
            if (!boss)
            {
                Fail("代理首领生成失败");
                yield break;
            }
            boss.Marked += OnMarked;
            boss.MoveStarted += OnMoveStarted;
            var hp = boss.Health;
            bossGuard = hp.Incoming.Add((in IncomingHit h) => 0f);
            var want = def.VitalsAt(1f);
            string model = boss.Model == null ? "（没有模型）" : boss.Model.source switch
            {
                BossModelSource.Art => $"美术 {boss.Model.prefab} × {boss.Model.scale}",
                BossModelSource.Proxy => $"代理 {boss.Model.prefab} × {boss.Model.scale}",
                _ => $"占位胶囊 × {boss.Model.scale}",
            };
            Line($"生成：{boss.Title}（{boss.Subtitle}），级别 {hp.rank}，{hp.maxHealth:F0} 生命 + {hp.maxShield:F0} 护盾 + {hp.maxArmor:F0} 护甲，模型 {model}，" +
                 $"身体半径 {boss.BodyRadius:F2} m，招式 {string.Join("、", boss.Moves.Select(m => m.Id))}");
            if (spawnedEvents != before + 1) Fail($"BossSpawned 派发了 {spawnedEvents - before} 次（应 1 次）");
            if (hp.rank != Rank.Boss) Fail($"级别是 {hp.rank}（应为 Boss）");
            if (Mathf.Abs(hp.maxHealth - Mathf.Round(want.hp)) > 1 || Mathf.Abs(hp.maxShield - Mathf.Round(want.shield)) > 1)
                Fail($"耐久 {hp.maxHealth}/{hp.maxShield} 与 VitalsAt(1) = {want} 不一致");
            if (BossBrain.Primary != boss) Fail("BossBrain.Primary 不是刚生成的首领");
            var hud = Hud.Instance;
            if (hud && hud.Boss != hp) Fail("血条没有挂上首领（Hud.Boss）");
            yield return null;
            if (!hp.untargetable) Fail("登场期间可以被选中");
            var r = Hit(hp, 50f);
            if (!r.immune || hp.health < hp.maxHealth) Fail($"登场期间吃到了伤害（immune={r.immune}，生命 {hp.health}）");
            Shot(weapons.eye, "boss_intro");
            float t0 = Time.time;
            while (!boss.IntroDone && Time.time - t0 < def.intro.seconds + 3f) yield return null;
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - t0:F1} s" : "✗ 没有结束")}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            yield return null;
            if (hp.untargetable) Fail("登场结束后仍不可选中");
        }

        // ───────────── 霸体 ─────────────

        IEnumerator StunPolicy()
        {
            var hp = boss.Health;
            float t0 = Time.time;
            while (boss.Current != null && Time.time - t0 < MoveTimeout) yield return null;
            bool immuneAtRest = boss.StunImmune;
            bool stunned = EnemyStatus.Stun(hp, 1f);
            float s0 = Time.time;
            var status = EnemyStatus.Of(hp);
            while (status && status.Stunned && Time.time - s0 < 2f) yield return null;
            float stunFor = Time.time - s0;
            bool again = EnemyStatus.Stun(hp, 1f);
            Line($"霸体：间隙免疫 {immuneAtRest}，眩晕 {(stunned ? $"✓ {stunFor:F2} s" : "✗")}，紧接着再晕 {(again ? "✗ 又晕了" : "✓ 免疫")}");
            if (immuneAtRest) Fail("招式间隙的首领免疫眩晕（只有出招 / 登场 / 转换中该免疫）");
            if (!stunned) Fail("招式间隙眩晕不上首领");
            else if (stunFor > 0.5f) Fail($"首领被晕了 {stunFor:F2} s（上限 0.35 s）");
            if (again) Fail("首领眩晕后没有进入免疫期");
        }

        // ───────────── 招式 ─────────────

        IEnumerator EachMove()
        {
            foreach (var move in boss.Moves.ToList())
            {
                if (!boss || boss.Dead) yield break;
                yield return OneMove(move);
            }
        }

        IEnumerator OneMove(BossMove move)
        {
            var hp = boss.Health;
            ReadyPlayer(9f);
            yield return null;
            int tel0 = move.TelegraphCount, act0 = move.TimesActive, sum0 = boss.Summons.TotalSpawned;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 4f) yield return null;
            if (!forced)
            {
                Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                yield break;
            }
            var stages = new List<MoveStage>();
            bool immuneThroughout = true, shot = false;
            int maxSummons = 0;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!move.stunnable && !boss.StunImmune) immuneThroughout = false;
                maxSummons = Mathf.Max(maxSummons, boss.Summons.Alive + boss.Summons.PendingCount);
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active)
                {
                    shot = true;
                    Shot(weapons.eye, $"boss_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            if (move is ProxySummon)
            {
                float w0 = Time.time;
                while (boss.Summons.PendingCount > 0 && Time.time - w0 < 2f) yield return null;
            }
            int telegraphs = move.TelegraphCount - tel0, summoned = boss.Summons.TotalSpawned - sum0;
            string extra = move switch
            {
                ProxySlam s => $"，砸中 {s.Hits} 次",
                ProxyDash d => $"，冲出 {d.Travelled:F1} m、撞中 {d.Hits} 次",
                ProxySummon s => $"，排进 {s.LastQueued} 只、生成 {summoned} 只（同时最多 {maxSummons}，上限 {boss.Summons.Cap}）",
                _ => "",
            };
            Line($"招式 {move.Name}（{move.Id}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，" +
                 $"预警 {telegraphs} 个，出招中霸体 {(immuneThroughout ? "✓" : "✗")}{extra}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (telegraphs <= 0) Fail($"招式 {move.Id} 没有画地面预警");
            if (!immuneThroughout) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (move is ProxySummon ps)
            {
                if (ps.LastQueued <= 0) Fail("召唤没有排进任何爪牙（上限算错？）");
                else if (summoned < ps.LastQueued) Fail($"召唤排进 {ps.LastQueued} 只，只生成了 {summoned} 只");
            }
            if (maxSummons > boss.Summons.Cap) Fail($"召唤物同时 {maxSummons} 只，超过上限 {boss.Summons.Cap}");
            if (hp.untargetable) Fail($"招式 {move.Id} 之后首领不可选中");
        }

        // ───────────── 生命刻度 / 阶段 ─────────────

        IEnumerator Marks()
        {
            var def = boss.Def;
            foreach (var m in def.marks.Where(m => m != null).OrderByDescending(m => m.at))
            {
                if (boss.Dead) yield break;
                // 只越过刻度、不越过下一道阶段阈值
                float floor = def.phases.Where(p => p != null && p.at < m.at).Select(p => p.at).DefaultIfEmpty(0).Max();
                SetHealthFraction(Mathf.Max(floor + 0.02f, m.at - 0.02f));
                startedMoves.Clear();
                float t0 = Time.time;
                while (!markEvents.Contains(m.id) && Time.time - t0 < 2f) yield return null;
                bool marked = markEvents.Contains(m.id);
                string next = null;
                if (marked && m.id == ProxyBossDef.CrackMark)
                {
                    float w0 = Time.time;
                    while (Time.time - w0 < MoveTimeout && !startedMoves.Contains(ProxySummon.MoveId))
                    {
                        KeepPlayerAlive();
                        yield return null;
                    }
                    next = startedMoves.FirstOrDefault(id => id == ProxySummon.MoveId) ?? string.Join("、", startedMoves);
                }
                Line($"生命刻度 {m.id}（{m.at:P0}）：{(marked ? "✓" : "✗")}{(next != null ? $"，之后出招 {next}" : "")}");
                if (!marked) Fail($"越过生命刻度 {m.id} 没有派发 Marked");
                if (m.id == ProxyBossDef.CrackMark && marked && next != ProxySummon.MoveId) Fail($"石壳开裂后没有排上召唤（之后出的是 {next}）");
            }
        }

        IEnumerator Phases()
        {
            var def = boss.Def;
            for (int i = 0; i < def.phases.Count; i++)
            {
                if (!boss || boss.Dead) yield break;
                var pd = def.phases[i];
                var hp = boss.Health;
                int forms0 = formEvents.Count;
                phaseEvents.Clear();
                ReadyPlayer(10f);
                SetHealthFraction(pd.at - 0.01f);
                float t0 = Time.time;
                while (!boss.Transitioning && Time.time - t0 < def.phaseWait + 3f)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                float waited = Time.time - t0;
                if (!boss.Transitioning)
                {
                    Fail($"阶段 {i + 1}：生命到 {pd.at:P0} 以下 {waited:F1} s 没有开始转换");
                    continue;
                }
                yield return null;
                bool untargetable = hp.untargetable;
                float before = hp.health + hp.shield + hp.armor;
                var r = Hit(hp, 100f);
                bool immune = r.immune && hp.health + hp.shield + hp.armor >= before - 0.01f;
                bool stunImmune = boss.StunImmune;
                float tr0 = Time.time;
                bool shot = false;
                while (boss.Transitioning && Time.time - tr0 < pd.seconds + 2f)
                {
                    if (!shot && formEvents.Count > forms0)
                    {
                        shot = true;
                        Shot(weapons.eye, $"boss_form_{boss.Form?.id}");
                    }
                    yield return null;
                }
                float trans = Time.time - tr0;
                bool phaseOk = phaseEvents.Contains(i + 1) && boss.Phase == i + 1;
                Line($"阶段 {i + 1}（{pd.at:P0}）：越线后 {waited:F1} s 开始转换，BossPhase {(phaseOk ? "✓" : $"✗ {string.Join(",", phaseEvents)}")}，" +
                     $"转换中不可选中 {(untargetable ? "✓" : "✗")}、免伤 {(immune ? "✓" : "✗")}、霸体 {(stunImmune ? "✓" : "✗")}，演出 {trans:F1} s");
                if (!phaseOk) Fail($"阶段 {i + 1}：BossPhase / Phase 不对（事件 {string.Join(",", phaseEvents)}，Phase {boss.Phase}）");
                if (!untargetable || !immune) Fail($"阶段 {i + 1}：转换演出期间可以被打（不可选中 {untargetable}，免伤 {immune}）");
                if (!stunImmune) Fail($"阶段 {i + 1}：转换演出期间可以被眩晕");
                if (boss.Transitioning) Fail($"阶段 {i + 1}：转换演出 {pd.seconds + 2f:F1} s 没有结束");
                if (!string.IsNullOrEmpty(pd.form)) CheckForm(pd, forms0);
                yield return null;
                if (hp.untargetable) Fail($"阶段 {i + 1}：转换结束后仍不可选中");
                // 演出结束后的第一招：阶段写的 → 形态写的
                var first = !string.IsNullOrEmpty(pd.firstMove) ? pd.firstMove : def.Form(pd.form)?.firstMove;
                if (!string.IsNullOrEmpty(first))
                {
                    startedMoves.Clear();
                    float m0 = Time.time;
                    while (startedMoves.Count == 0 && Time.time - m0 < 4f)
                    {
                        KeepPlayerAlive();
                        yield return null;
                    }
                    var got = startedMoves.FirstOrDefault();
                    Line($"阶段 {i + 1} 之后第一招：{got ?? "（没出招）"}（应为 {first}）");
                    if (got != first) Fail($"阶段 {i + 1} 之后第一招是 {got ?? "（没出招）"}，应为 {first}");
                }
            }
        }

        void CheckForm(BossPhaseDef pd, int forms0)
        {
            var f = boss.Def.Form(pd.form);
            var hp = boss.Health;
            var ev = formEvents.Skip(forms0).ToList();
            bool evOk = ev.Count == 1 && ev[0].form == pd.form;
            bool timeOk = ev.Count > 0 && Mathf.Abs(ev[0].at - pd.SwapAt) < 0.35f;
            bool now = boss.Form == f && boss.PreviousForm != null && boss.PreviousForm != f;
            bool shield = f.shieldRestore <= 0 || hp.shield >= hp.maxShield * f.shieldRestore - 1f;
            var hud = Hud.Instance;
            bool title = boss.Title.Contains(f.name ?? "") && (!hud || hud.BossTitle == boss.Title);
            var core = boss.Zone("core");
            bool zone = boss.Def.hitZones.All(z => z.form != pd.form) || (core && core.Active);
            Line($"换形 {boss.PreviousForm?.id} → {boss.Form?.id}：BossForm {(evOk ? "✓" : $"✗（{ev.Count} 次）")}，" +
                 $"时刻 {(ev.Count > 0 ? $"{ev[0].at:F2}" : "-")} / {pd.SwapAt:F2} s {(timeOk ? "✓" : "✗")}，护盾 {hp.shield:F0}/{hp.maxShield:F0} {(shield ? "✓" : "✗")}，" +
                 $"血条标题「{boss.Title}」{(title ? "✓" : "✗")}，形态命中区 {(zone ? "✓" : "✗")}，模型 {boss.Model?.prefab ?? boss.Model?.source.ToString()}");
            if (!evOk) Fail($"换形 {pd.form}：BossForm 派发 {ev.Count} 次 / 形态不对");
            if (!timeOk) Fail($"换形 {pd.form} 的时刻 {(ev.Count > 0 ? ev[0].at : -1):F2} s，应在演出 {pd.SwapAt:F2} s 左右");
            if (!now) Fail($"换形后 Form = {boss.Form?.id}、PreviousForm = {boss.PreviousForm?.id}");
            if (!shield) Fail($"换成 {pd.form} 后护盾 {hp.shield:F0} 低于 {f.shieldRestore:P0}");
            if (!title) Fail($"换形后血条标题没刷新（首领「{boss.Title}」，Hud「{hud?.BossTitle}」）");
            if (!zone) Fail($"换成 {pd.form} 后形态命中区 core 没有启用");
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            var def = boss.Def;
            // 浸泡期间首领不掉血（bossGuard：灵宠、反应、爪牙误伤都不会把它打进下一阶段或打死），只看它自己跑 90 s 稳不稳
            SetHealthFraction(Mathf.Max(def.enrageBelow + 0.1f, (def.phases.Count > 0 ? def.phases[^1].at : 1f) - 0.08f));
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int sum0 = boss.Summons.TotalSpawned, maxAlive = 0, badFrames = 0, revives = 0;
            float maxOut = 0, stuck = 0, longest = 0, t0 = Time.time, nextMoveAt = 0;
            float enrage0 = boss.EnrageTimeLeft;
            BossMove last = null;
            string badWhat = null;
            while (Time.time - t0 < SoakSeconds && boss && !boss.Dead)
            {
                if (vitals.Dead)
                {
                    vitals.Revive();
                    revives++;
                }
                KeepPlayerAlive();
                if (Time.time >= nextMoveAt)
                {
                    nextMoveAt = Time.time + 6f;
                    Teleport(motor, arena.RandomPoint(3f));
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.shield) || !Finite(hp.armor) || hp.health < 0 || hp.health > hp.maxHealth + 0.01f
                    || hp.shield < 0 || hp.shield > hp.maxShield + 0.01f || hp.armor < 0 || hp.armor > hp.maxArmor + 0.01f || boss.Phase < 0 || boss.Phase > def.phases.Count)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护盾 {hp.shield}/{hp.maxShield}，护甲 {hp.armor}/{hp.maxArmor}，阶段 {boss.Phase}";
                }
                if (Finite(p) && !arena.Contains(p, 0))
                {
                    var flat = p - arena.Center;
                    flat.y = 0;
                    maxOut = Mathf.Max(maxOut, flat.magnitude - arena.Extent);
                }
                maxAlive = Mathf.Max(maxAlive, boss.Summons.Alive + boss.Summons.PendingCount);
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            float enrage1 = boss.EnrageTimeLeft;
            Line($"浸泡 {Time.time - t0:F0} s：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，召唤 {boss.Summons.TotalSpawned - sum0} 只（同时最多 {maxAlive}），" +
                 $"最远出界 {maxOut:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次，计时狂怒倒计时 {enrage0:F0} → {enrage1:F0} s");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 3f) Fail($"浸泡期间首领跑出场地 {maxOut:F1} m");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (maxAlive > boss.Summons.Cap) Fail($"浸泡期间召唤物同时 {maxAlive} 只，超过上限 {boss.Summons.Cap}");
            if (counts.Count < 2) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
            if (def.enrageAfter > 0 && !(enrage1 < enrage0)) Fail($"计时狂怒的倒计时没有在走（{enrage0} → {enrage1}）");
        }

        // ───────────── 狂怒 / 击杀 ─────────────

        IEnumerator EnrageCase()
        {
            var def = boss.Def;
            if (!(def.enrageBelow > 0))
            {
                Line("狂怒：定义里没有低血狂怒，跳过");
                yield break;
            }
            float rest0 = boss.RestScale, wind0 = boss.WindupScale;
            SetHealthFraction(def.enrageBelow - 0.02f);
            float t0 = Time.time;
            while (!boss.Enraged && Time.time - t0 < 2f) yield return null;
            Line($"狂怒（{def.enrageBelow:P0} 以下）：{(boss.Enraged ? $"✓（{boss.EnrageReason}）" : "✗")}，喘息倍率 {rest0:F2} → {boss.RestScale:F2}，前摇倍率 {wind0:F2} → {boss.WindupScale:F2}");
            if (!boss.Enraged) Fail("生命低于狂怒线没有进入狂怒");
            else if (!(boss.RestScale < rest0) || !(boss.WindupScale < wind0)) Fail("狂怒后喘息 / 前摇没有缩短");
        }

        IEnumerator KillCase()
        {
            var hp = boss.Health;
            var def = boss.Def;
            bossGuard?.Dispose();
            bossGuard = null;
            reward = null;
            killEvent = false;
            int defeated0 = defeatedEvents;
            var summons = boss.Summons;
            int ammo0 = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Ammo), health0 = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Health),
                coin0 = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Coin);
            // 召一批爪牙在场，看它们会不会随首领崩解
            if (summons.Alive == 0) summons.Spawn("jerboa_blade", 2, new SummonOptions { warn = 0, minRadius = 4, maxRadius = 7 });
            int minions = summons.Alive;
            var minionList = summons.Live.ToList();

            // 先用武器打（像玩家一样），打不死再补一下
            float f0 = Time.time;
            float hp0 = hp.health + hp.shield + hp.armor;
            ReadyPlayer(12f);
            while (!hp.Dead && Time.time - f0 < 8f)
            {
                KeepPlayerAlive();
                weapons.Active.reserve = weapons.Active.def.reserve;
                if (hp.untargetable)
                {
                    weapons.testFire = false;
                    yield return null;
                    continue;
                }
                Aim(motor, eye, boss.BodyCenter);
                if (Combat.Blocked(eye.position, boss.BodyCenter, null) && SightSpot(hp, boss.BodyCenter, out var spot)) Teleport(motor, spot);
                weapons.testFire = weapons.Active.def.mode != FireMode.Semi || !weapons.testFire;
                yield return null;
            }
            weapons.testFire = false;
            float shotDamage = hp0 - (hp.health + hp.shield + hp.armor);
            float w0 = Time.time;
            while (!hp.Dead && Time.time - w0 < 5f)
            {
                if (!hp.untargetable) Hit(hp, 99999f);
                yield return null;
            }
            float tKill = Time.time;
            yield return null;
            yield return null;
            Shot(weapons.eye, "boss_defeat");
            var hud = Hud.Instance;
            bool barCleared = !hud || !hud.Boss;
            bool minionsGone = minionList.All(e => !e || e.Dead) && summons.Alive == 0 && summons.PendingCount == 0;
            int ammo = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Ammo) - ammo0, health = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Health) - health0,
                coins = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Coin) - coin0;
            bool loot = LootDirector.Instance;
            Line($"击杀：武器打掉 {shotDamage:F0}，{(hp.Dead ? "✓ 倒下" : "✗ 没死")}；BossDefeated {defeatedEvents - defeated0} 次{(defeatedBoss == boss ? "" : "（不是这只）")}，" +
                 $"击杀事件 {(killEvent ? "✓" : "✗")}，战果 {(reward.HasValue ? $"{reward.Value.rank} 魂晶 {reward.Value.essence}" : "✗ 没有")}（定义 {def.rewards.essence}），" +
                 $"血条收起 {(barCleared ? "✓" : "✗")}，爪牙崩解 {minions} 只 {(minionsGone ? "✓" : "✗")}，" +
                 (loot ? $"掉落 弹药 +{ammo} 生命 +{health} 灵石 +{coins}" : "场景里没有 LootDirector，掉落不查"));
            if (!hp.Dead)
            {
                Fail("首领没有被打死");
                yield break;
            }
            if (defeatedEvents - defeated0 != 1 || defeatedBoss != boss) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次，且是这只）");
            if (!killEvent) Fail("首领倒下没有经伤害管线派发击杀事件");
            if (!reward.HasValue) Fail("首领倒下没有战果（KillResolver.Rewarded）");
            else
            {
                if (reward.Value.rank != Rank.Boss) Fail($"战果的级别是 {reward.Value.rank}");
                if (reward.Value.essence != def.rewards.essence) Fail($"首领魂晶 {reward.Value.essence}，定义写的是 {def.rewards.essence}");
            }
            if (!barCleared) Fail("首领倒下后血条没有收起（Hud.Boss 还在）");
            if (BossBrain.Active.Contains(boss) || BossBrain.Primary == boss) Fail("倒下的首领还在 BossBrain.Active 里");
            if (!minionsGone) Fail("首领倒下后爪牙没有崩解");
            if (loot && (ammo < EconomyConfig.BossPackAmmo || health < EconomyConfig.BossPackHealth)) Fail($"首领包掉落不对（弹药 +{ammo}、生命 +{health}，应各 ≥ 2）");
            if (loot && coins <= 0) Fail("首领倒下没有掉灵石");

            // 慢动作复原、溃散演出、回收
            var seq = boss.GetComponent<BossDefeatSequence>();
            if (!seq) Fail("倒下后没有溃散演出（BossDefeatSequence）");
            float end = def.defeat.seconds + def.defeat.despawnAfter + 2f;
            var go = boss.gameObject;
            bool finished = false;
            while (go && Time.time - tKill < end)
            {
                if (seq && seq.Finished) finished = true;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(0.2f);
            bool timeOk = Mathf.Approximately(TimeScaleArbiter.Current, 1f);
            Line($"溃散：最后一下大爆炸 {(finished || !go ? "✓" : "✗")}，时间缩放复原 {(timeOk ? "✓" : $"✗ {TimeScaleArbiter.Current}")}，回收 {(!go ? "✓" : "✗")}");
            if (seq && !finished && go) Fail("溃散演出没有放完");
            if (!timeOk) Fail($"首领倒下的慢动作没有撤销（时间缩放 {TimeScaleArbiter.Current}）");
            if (go) Fail($"首领倒下 {end:F1} s 后物体还在");
        }

        // ───────────── 工具 ─────────────

        static bool Finite(float v) => float.IsFinite(v);
        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);

        /// <summary>首领的生命层设到 fraction（护盾 / 护甲不动）；首领按生命层判阶段</summary>
        void SetHealthFraction(float fraction)
        {
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
        }

        static DamageResult Hit(Damageable d, float amount)
        {
            var c = BodyCenter(d);
            var info = DamageInfo.Simple(amount, DamageSource.Weapon, c, Vector3.forward);
            info.noCrit = true;
            return Combat.DamageEnemy(d, info);
        }

        /// <summary>玩家站到首领正前方 distance 米（夹进场地），对着首领、回满</summary>
        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var spot = arena.Clamp(boss.transform.position + fwd * distance, 2f);
            Teleport(motor, spot);
            Aim(motor, eye, boss.BodyCenter);
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }
    }
}
