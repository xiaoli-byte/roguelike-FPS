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
    /// 熔心魔将冒烟（BS6，bridge.sh playtest boss-warlord；场景 3-3 铸范大坊，docs/level-design/maps/3-3.md 第 6 节，parity 7.4「每个首领」）：
    ///   · 定义：自检、血条刻度 = 50% / 20%、3-3 难度下的定档、模拟击杀用时（<see cref="WarlordBalance"/>，60–120 s）；
    ///   · 开战：领主战跳过「先肃清铸坊」直接解锁 → 玩家走到入场点 → 熔铁闸封桥 → 登场预警 → 魔将从高处砸进场地（不可选中）→ 登场结束；
    ///     模型来源（美术 / 代理 / 占位）、熔铜渠片数；场景没重建（没有领主战）时在场地上直接刷一只，记一行提示；
    ///   · 招式（首领不掉血）：六招各强制出一次——走到出手、正常收招、画过预警、出招中霸体、动作走 act_ 触发器还是交叉淡入；
    ///       冲锋留下火焰地带、横扫放出火浪、陨石雨落满一轮、跃击落地放冲击波、连斩至少三段动作、熔铜渠涨落引动了熔铜渠并铺满渠岸预警；
    ///     熔铜渠：渠岸上的点平时不是熔岩、漫上来后是熔岩，站在渠岸上的玩家被下沉托回，高位停够后退回；
    ///   · 阶段：生命层降到 49% → BossPhase(1)、转换中不可选中、转换后第一招是熔铜渠涨落；
    ///   · 狂怒：降到 19% → 立刻狂怒（原因 health）、BossPhase(2)、陨石雨冷却 ≤ 7 s、零星陨石开始落；
    ///   · 90 s 浸泡（三阶段，首领不掉血）：不出场地、数值有限、招式不卡死、至少出过两种招；
    ///   · 击杀 → 溃散 → 结算：首领宝箱（首领档）、回满、熔铁闸落下、熔铜渠退回、神范前的清关宝箱、出口升起（3-3 不是最后一关 → 下一关）。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class WarlordSuite : PlaytestSuite
    {
        public override string Id => "boss-warlord";
        /// <summary>3-3 铸范大坊（与编辑器里 Level_3_3.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L3_3_Foundry.unity";

        const float SoakSeconds = 90f, MoveTimeout = 16f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossEncounter enc;
        FoundryLordGate lordGate;
        FoundryChannels channels;
        WarlordBrain boss;
        BossHazards hz;
        System.IDisposable bossGuard;
        int logErrors, spawnedEvents, defeatedEvents;
        string lastError;
        readonly List<int> phaseEvents = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 3-3？先 bridge.sh level 3-3）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            GameEvents.BossSpawned += OnSpawned;
            GameEvents.BossPhase += OnPhase;
            GameEvents.BossDefeated += OnDefeated;
            vitals.stats.Add("playtest_warlord", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            CheckDef();
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                hz = BossHazards.For(boss);
                bossGuard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
                yield return EachMove();
                yield return PhaseCase();
                yield return FuryCase();
                yield return Soak();
                yield return KillCase();
            }

            bossGuard?.Dispose();
            bossGuard = null;
            vitals.stats.Remove("playtest_warlord");
            GameEvents.BossSpawned -= OnSpawned;
            GameEvents.BossPhase -= OnPhase;
            GameEvents.BossDefeated -= OnDefeated;
            Application.logMessageReceived -= OnLog;
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            Line($"合计：敌人对玩家伤害 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnSpawned(BossBrain b) => spawnedEvents++;

        void OnPhase(BossBrain b, int p)
        {
            if (b == boss) phaseEvents.Add(p);
        }

        void OnDefeated(BossBrain b)
        {
            if (b == boss) defeatedEvents++;
        }

        // ───────────── 定义 ─────────────

        void CheckDef()
        {
            var def = Bosses.Get(WarlordDef.Id) as WarlordDef;
            if (def == null)
            {
                Fail($"没有登记首领 {WarlordDef.Id}（WarlordDef）");
                return;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"魔将定义自检：{string.Join("；", errs)}");
            var ticks = def.BarTicks;
            bool ticksOk = ticks.Count == 2 && Mathf.Approximately(ticks[0], WarlordDef.ChannelsAt) && Mathf.Approximately(ticks[1], WarlordDef.FuryAt);
            var v = def.VitalsAt(WarlordDef.StageDifficulty);
            float kill = WarlordBalance.KillSeconds(def, WarlordDef.StageDifficulty);
            Line($"定义：{def.name}（{def.title}），血条刻度 {string.Join(" / ", ticks.Select(t => $"{t:P0}"))} {(ticksOk ? "✓" : "✗")}，难度 {WarlordDef.StageDifficulty} 下 {v}，" +
                 $"招式 {string.Join("、", def.moves.Select(m => m().Id))}；模拟击杀用时（参考秒伤 {WarlordBalance.ReferenceDps(WarlordDef.StageDifficulty):F0}）{kill:F0} s");
            if (!ticksOk) Fail("血条刻度不是 50% / 20% 两道阶段阈值");
            if (!(kill >= WarlordBalance.MinSeconds && kill <= WarlordBalance.MaxSeconds)) Fail($"模拟击杀用时 {kill:F0} s 不在 60–120 s");
        }

        // ───────────── 开战 ─────────────

        IEnumerator StartFight()
        {
            lordGate = FindAnyObjectByType<FoundryLordGate>();
            enc = lordGate ? lordGate.encounter : FindObjectsByType<BossEncounter>(FindObjectsInactive.Include, FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == WarlordDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(WarlordDef.Id);
            if (!arena)
            {
                Line("场景里没有魔将的 BossArena（3-3 还没重建？），在玩家前方临时建一个 20 m 的场地（熔铜渠涨落退回环带写法）");
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 22f, 20f, fwd, WarlordDef.Id);
            }
            channels = FoundryChannels.For(arena);
            int spawned0 = spawnedEvents;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                // 冒烟跳过「先肃清铸坊」：直接解锁领主战
                if (lordGate) lordGate.Unlock(false);
                else enc.enabled = true;
                Place(arena.PlayerEntryPoint);
                Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                Line($"领主战流程：走进入场点 → {enc.State}（{Time.time - t0:F1} s 后魔将登场），熔铁闸 {(enc.GatesSealed ? "已封桥" : "没升起")}（{enc.gates?.Length ?? 0} 扇）");
                if (enc.gates != null && enc.gates.Length > 0 && !enc.GatesSealed) Fail("领主战开始后熔铁闸没有封桥");
                boss = enc.Boss as WarlordBrain;
                if (!boss) Fail($"BossEncounter 没有刷出熔心魔将（State {enc.State}，Boss {enc.Boss}）");
            }
            else
            {
                Line(enc ? $"BossEncounter 状态 {enc.State}，直接刷魔将" : "场景里没有魔将的领主战（3-3 还没重建？），直接在场地上刷魔将");
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(WarlordDef.Id, arena, WarlordDef.StageDifficulty) as WarlordBrain;
                if (!boss) Fail("魔将生成失败（行为不是 WarlordBrain？）");
            }
            if (!boss) yield break;
            var hp = boss.Health;
            string model = boss.Model == null ? "（没有模型）" : boss.Model.source switch
            {
                BossModelSource.Art => $"美术 {boss.Model.prefab} × {boss.Model.scale}",
                BossModelSource.Proxy => $"代理 {boss.Model.prefab} × {boss.Model.scale}",
                _ => $"占位胶囊 × {boss.Model.scale}",
            };
            Line($"生成：{boss.Title}（{boss.Subtitle}），{hp.maxHealth:F0} 生命 + {hp.maxShield:F0} 护盾 + {hp.maxArmor:F0} 护甲（难度 {boss.level:F2}），模型 {model}，" +
                 $"熔铜渠 {(boss.Channels ? $"{boss.Channels.Count} 片" : "无（环带写法）")}，登场高度 {boss.DropNow:F0} m，BossSpawned +{spawnedEvents - spawned0}");
            if (spawnedEvents - spawned0 != 1) Fail($"BossSpawned 派发了 {spawnedEvents - spawned0} 次（应 1 次）");
            if (enc && channels && boss.Channels != channels) Fail("魔将没认出场地上的熔铜渠");
            if (boss.Model != null && boss.Model.source != BossModelSource.Art) Line($"⚠ 魔将没用正式美术（{model}）");
            yield return null;
            if (!hp.untargetable) Fail("登场期间可以被选中");
            float drop0 = boss.DropNow;
            Aim(motor, eye, boss.BodyCenter + Vector3.up * Mathf.Min(10f, drop0));
            Shot(weapons.eye, "warlord_intro");
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f) yield return null;
            yield return null;
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - i0:F1} s" : "✗ 没有结束")}，从 {drop0:F0} m 砸下 {(boss.Landed ? "✓" : "✗")}（现在 {boss.DropNow:F1} m），" +
                 $"动作 {boss.LastAct}（{boss.LastActPath}），之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            if (hp.untargetable) Fail("登场结束后仍不可选中");
            if (!(drop0 > 10f) || !boss.Landed || boss.DropNow > 0.01f) Fail("登场没有从高处砸进场地（模型根节点没下落 / 没落地）");
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "warlord_landed");
        }

        // ───────────── 招式 ─────────────

        IEnumerator EachMove()
        {
            foreach (var move in boss.Moves.ToList())
            {
                if (!boss || boss.Dead) yield break;
                // 渠岸点要在涨潮之前找（预警一开始导航网格就挖掉了）
                var bank = move is WarlordChannelSurge && channels ? BankPoint(channels) : null;
                yield return OneMove(move);
                if (move is WarlordChannelSurge s) yield return SurgeCheck(s, bank);
            }
        }

        static float ReadyDistance(BossMove m) => m switch
        {
            WarlordCombo => 3.5f,
            WarlordCharge => 14f,
            WarlordSweep => 8f,
            _ => 11f,
        };

        IEnumerator OneMove(BossMove move)
        {
            yield return WaitIdle();
            ReadyPlayer(ReadyDistance(move));
            PlayerStatus.Instance?.ClearAll();
            yield return null;
            int warn0 = move.TelegraphCount + hz.WarningsDrawn, act0 = move.TimesActive, acts0 = boss.ActsFired;
            int waves0 = hz.WavesSpawned, lobs0 = hz.LobsSpawned;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 5f) yield return null;
            if (!forced)
            {
                Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                yield break;
            }
            var stages = new List<MoveStage>();
            var acts = new List<string>();
            bool immune = true, shot = false;
            string lastAct = null;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!move.stunnable && !boss.StunImmune) immune = false;
                if (boss.ActsFired > acts0 && boss.LastAct != lastAct)
                {
                    lastAct = boss.LastAct;
                    acts.Add($"{lastAct}（{boss.LastActPath}）");
                }
                KeepPlayerAlive();
                // 连斩：玩家贴着魔将（像真人一样站在刀口里）
                if (move is WarlordCombo && boss.DistanceToPlayer > 4.5f) ReadyPlayer(3.5f);
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active)
                {
                    shot = true;
                    yield return null;
                    Shot(weapons.eye, $"warlord_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            int warned = move.TelegraphCount + hz.WarningsDrawn - warn0, fired = boss.ActsFired - acts0;
            string extra = move switch
            {
                WarlordCharge c => $"，留火 {c.Trails} 片、撞中 {c.Hits} 次",
                WarlordSweep => $"，火浪 {hz.WavesSpawned - waves0} 道",
                WarlordMeteor => $"，陨石 {hz.LobsSpawned - lobs0} 颗",
                WarlordLeap l => $"，落在预警圈里 {(l.LastOnMark ? "✓" : "✗")}、冲击波 {hz.WavesSpawned - waves0} 道",
                WarlordCombo c => $"，砍中 {c.Hits} 刀",
                WarlordChannelSurge s => $"，引动熔铜渠 {s.Floods} 次（环带兜底 {s.Fallbacks}）、渠岸预警 {s.LastWarnings} 条、高位 {s.LastHold:F0} s",
                _ => "",
            };
            Line($"招式 {move.Name}（{move.Id}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，" +
                 $"前摇 {move.WindupTime:F2} s，预警 {warned} 个，动作 {fired} 次 {string.Join(" → ", acts)}，出招中霸体 {(immune ? "✓" : "✗")}{extra}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (warned <= 0) Fail($"招式 {move.Id} 没有画预警");
            if (!immune) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (fired <= 0) Fail($"招式 {move.Id} 没有播动作（WarlordBrain.Act 没被调用）");
            switch (move)
            {
                case WarlordCharge c when c.Trails < 1:
                    Fail("烈焰冲锋没有留下火焰地带");
                    break;
                case WarlordSweep when hz.WavesSpawned - waves0 < 1:
                    Fail("火焰横扫没有放出火浪");
                    break;
                case WarlordMeteor when hz.LobsSpawned - lobs0 < 10:
                    Fail($"陨石雨只落了 {hz.LobsSpawned - lobs0} 颗（一阶段应 10 颗）");
                    break;
                case WarlordLeap when hz.WavesSpawned - waves0 < 1:
                    Fail("跃击落地没有放冲击波");
                    break;
                case WarlordCombo when fired < 3:
                    Fail($"焰刃连斩只触发了 {fired} 段动作（应 3 段 slashA / slashB 交替）");
                    break;
                case WarlordChannelSurge s:
                    if (channels && channels.Count > 0 && s.Floods < 1) Fail("熔铜渠涨落没有引动场地上的熔铜渠");
                    if (channels && channels.Count > 0 && s.LastWarnings < channels.Count) Fail($"熔铜渠涨落只铺了 {s.LastWarnings} 条渠岸预警（应 {channels.Count}）");
                    if ((!channels || channels.Count == 0) && s.Fallbacks < 1) Fail("没有熔铜渠时也没有退回环带熔岩");
                    break;
            }
            if (boss.Health.untargetable) Fail($"招式 {move.Id} 之后首领不可选中");
        }

        /// <summary>熔铜渠：渠岸上的点平时干、漫上来后是熔岩；站在渠岸上的玩家被托回；高位停够后退回</summary>
        IEnumerator SurgeCheck(WarlordChannelSurge s, Vector3? bank)
        {
            if (!channels || channels.Count == 0) yield break;
            if (!bank.HasValue)
            {
                Fail("找不到神范台渠岸上的点（熔铜渠的盒宽不到渠宽 + 渠岸？）");
                yield break;
            }
            var p = bank.Value;
            int entries0 = LavaField.Instance ? LavaField.Instance.Entries : 0;
            Place(p);
            float t0 = Time.time;
            while (!channels.Overflowing && Time.time - t0 < channels.warn + channels.riseTime + 3f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            bool over = channels.Overflowing;
            bool wet = LavaField.IsLava(p + Vector3.up * 0.02f);
            // 漫上来之后再站回渠岸：应被托回岸上（桥 / 象限中央）
            Place(p);
            yield return new WaitForSeconds(1.5f);
            int entries = (LavaField.Instance ? LavaField.Instance.Entries : 0) - entries0;
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "warlord_surge_high");
            Line($"熔铜渠：渠岸 {At(p)} 漫溢 {(over ? $"✓ {Time.time - t0:F1} s" : "✗")}，算熔岩 {(wet ? "✓" : "✗")}，玩家踩进熔岩 {entries} 次、现在在 {At(motor.transform.position)}" +
                 $"（还在熔岩里 {(LavaField.IsLava(motor.transform.position) ? "✗" : "否 ✓")}），高位还剩 {channels.HoldLeft:F1} s");
            if (!over) Fail("熔铜渠涨落之后熔岩没有漫过渠岸");
            if (!wet) Fail("熔岩漫上来后渠岸上的点不算熔岩");
            if (entries < 1) Fail("站在被淹的渠岸上没有被熔岩托回");
            float r0 = Time.time;
            while (channels.Flooding && Time.time - r0 < s.LastHold + channels.fallTime + 4f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            bool dry = !LavaField.IsLava(p + Vector3.up * 0.02f);
            Line($"熔铜渠退回：{(channels.Flooding ? "✗ 还在涨" : $"✓ {Time.time - r0:F1} s")}，渠岸 {(dry ? "又干了 ✓" : "还是熔岩 ✗")}");
            if (channels.Flooding) Fail("熔铜渠高位停够后没有退回");
            if (!dry) Fail("熔铜渠退回后渠岸还算熔岩");
        }

        /// <summary>某片浅渠熔岩盒里、渠边外 1.2 m 的渠岸点（床面高度、离场地中心近的那几片先找；地面按射线取）</summary>
        Vector3? BankPoint(FoundryChannels ch)
        {
            foreach (var v in ch.surge.Where(v => v && v.shape == LavaShape.Box).OrderBy(v => (v.transform.position - arena.Center).sqrMagnitude))
            {
                foreach (float side in new[] { 1f, -1f })
                {
                    var w = v.transform.TransformPoint(new Vector3(side * (v.size.x * 0.5f - 1.2f), 0, 0));
                    w.y = arena.FloorY + 3f;
                    if (!Physics.Raycast(w, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    if (Mathf.Abs(hit.point.y - arena.FloorY) > 0.4f || LavaField.IsLava(hit.point + Vector3.up * 0.02f)) continue;
                    return hit.point;
                }
            }
            return null;
        }

        // ───────────── 阶段 / 狂怒 ─────────────

        IEnumerator PhaseCase()
        {
            yield return WaitIdle();
            yield return WaitChannelsDry();
            var hp = boss.Health;
            int events0 = phaseEvents.Count;
            string first = null;
            void OnStart(BossBrain b, BossMove m) => first ??= m.Id;
            SetHealthFraction(WarlordDef.ChannelsAt - 0.01f);
            float t0 = Time.time;
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool fired = phaseEvents.Count > events0 && phaseEvents[^1] == 1;
            bool untargetable = boss.Transitioning && hp.untargetable;
            float tr0 = Time.time;
            while (boss.Transitioning && Time.time - tr0 < 6f) yield return null;
            boss.MoveStarted += OnStart;
            float m0 = Time.time;
            while (first == null && Time.time - m0 < 4f) yield return null;
            boss.MoveStarted -= OnStart;
            Line($"越过 {WarlordDef.ChannelsAt:P0}：BossPhase {(fired ? $"✓ → 阶段 {boss.Phase}" : "✗")}，转换中不可选中 {(untargetable ? "✓" : "✗")}，" +
                 $"转换后第一招 {first ?? "（没出）"}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!fired) Fail($"生命层降到 {WarlordDef.ChannelsAt - 0.01f:P0} 没有进入二阶段");
            if (!untargetable) Fail("阶段转换中可以被选中");
            if (first != WarlordChannelSurge.MoveId) Fail($"二阶段第一招是 {first ?? "（没出）"}（应为熔铜渠涨落）");
            yield return WaitIdle();
        }

        IEnumerator FuryCase()
        {
            yield return WaitIdle();
            int events0 = phaseEvents.Count, ambient0 = boss.AmbientMeteors;
            SetHealthFraction(WarlordDef.FuryAt - 0.01f);
            float t0 = Time.time;
            while (!boss.Enraged && Time.time - t0 < 1.5f) yield return null;
            bool enraged = boss.Enraged && boss.EnrageReason == "health";
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool phase2 = phaseEvents.Count > events0 && phaseEvents[^1] == 2;
            float tr0 = Time.time;
            while (boss.Transitioning && Time.time - tr0 < 6f) yield return null;
            var meteor = boss.MoveById("warlord_meteor");
            float w0 = Time.time;
            while (Time.time - w0 < 8f)
            {
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            int ambient = boss.AmbientMeteors - ambient0;
            Line($"越过 {WarlordDef.FuryAt:P0}：狂怒 {(enraged ? $"✓（{boss.EnrageReason}）" : "✗")}，BossPhase(2) {(phase2 ? "✓" : "✗")}，" +
                 $"陨石雨冷却 {meteor?.cooldown:F0} s，8 s 内零星陨石 {ambient} 颗，铠甲炽热 {boss.Fury:F2}");
            if (!enraged) Fail("生命层跌破 20% 没有立刻狂怒（原因应为 health）");
            if (!phase2) Fail("生命层跌破 20% 没有进入三阶段");
            if (meteor == null || meteor.cooldown > 7.01f) Fail("狂怒后陨石雨冷却没有缩到 7 s");
            if (ambient < 2) Fail($"狂怒后 8 s 只落了 {ambient} 颗零星陨石（应每 2.4 s 一颗）");
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            SetHealthFraction(Mathf.Max(0.12f, hp.health / hp.maxHealth));
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int badFrames = 0, revives = 0, floods0 = channels ? channels.Floods : 0;
            float maxOut = 0, stuck = 0, longest = 0, t0 = Time.time, nextMoveAt = 0;
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
                    var q = arena.RandomPoint(4f);
                    if (NavMesh.SamplePosition(q, out var qh, 3f, NavMesh.AllAreas) && !LavaField.IsLava(qh.position)) Place(qh.position);
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.shield) || !Finite(hp.armor) || hp.health < 0 || hp.health > hp.maxHealth + 0.01f
                    || hp.shield < 0 || hp.shield > hp.maxShield + 0.01f || hp.armor < 0 || hp.armor > hp.maxArmor + 0.01f)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护盾 {hp.shield}/{hp.maxShield}，护甲 {hp.armor}/{hp.maxArmor}";
                }
                if (Finite(p) && !arena.Contains(p, 0))
                {
                    var flat = arena.Clamp(p, 0) - p;
                    flat.y = 0;
                    maxOut = Mathf.Max(maxOut, flat.magnitude);
                }
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            Line($"浸泡 {Time.time - t0:F0} s（阶段 {boss.Phase}，狂怒 {boss.Enraged}）：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，" +
                 $"最远出界 {maxOut:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次，零星陨石累计 {boss.AmbientMeteors} 颗，" +
                 $"熔铜渠又涨了 {(channels ? channels.Floods - floods0 : 0)} 次，拴回 {enc?.Tethers ?? 0} 次");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 3f) Fail($"浸泡期间首领跑出场地 {maxOut:F1} m");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (counts.Count < 2) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
        }

        // ───────────── 击杀 → 结算 ─────────────

        IEnumerator KillCase()
        {
            bossGuard?.Dispose();
            bossGuard = null;
            var hp = boss.Health;
            int defeated0 = defeatedEvents;
            vitals.health = vitals.MaxHealth * 0.3f;
            vitals.shield = 0;
            float k0 = Time.time;
            while (!hp.Dead && Time.time - k0 < 15f)
            {
                if (!hp.untargetable)
                {
                    var info = DamageInfo.Simple(99999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(hp, info);
                }
                if (vitals.Dead) vitals.Revive();
                yield return null;
            }
            if (!hp.Dead)
            {
                Fail("熔心魔将没被打死");
                yield break;
            }
            yield return null;
            Line($"击杀：BossDefeated +{defeatedEvents - defeated0}，阶段 {boss.Phase}");
            if (defeatedEvents - defeated0 != 1) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次）");
            if (channels)
            {
                float c0 = Time.time;
                while (channels.Flooding && Time.time - c0 < channels.fallTime + 2f) yield return null;
                if (channels.Flooding) Fail("魔将倒下后熔铜渠没有退回");
            }
            if (!enc)
            {
                Line("没有领主战流程：不查结算");
                yield break;
            }
            vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
            float s0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 3f) yield return null;
            yield return new WaitForSeconds(0.9f);
            bool healed = vitals.health >= vitals.MaxHealth - 0.5f;
            var chest = enc.RewardChest;
            var clear = lordGate ? lordGate.ClearChest : null;
            Line($"结算：{enc.State}（{Time.time - s0:F1} s），回满 {(healed ? "✓" : "✗")}，首领宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」{chest?.tier}，" +
                 $"清关宝箱「{(clear ? clear.EffectiveReward : "（没有）")}」，熔铁闸 {(enc.GatesSealed ? "还立着" : "已落下")}，去向 {enc.Result}，溃散 {enc.Dispersed} 只");
            if (enc.State != BossEncounter.Phase.Settled) Fail("魔将倒下后没有结算");
            if (!healed) Fail("结算没有回满生命");
            if (!chest) Fail("结算没有落首领宝箱");
            else if (chest.tier != ChestTier.Boss) Fail($"首领宝箱档位 {chest.tier}（应为 Boss）");
            if (lordGate && !clear) Fail("领主战结算后神范前没有清关宝箱");
            if (enc.GatesSealed) Fail("结算后熔铁闸没有落下");
            if (enc.Result != BossEncounter.Outcome.NextStage) Fail($"3-3 打完的去向是 {enc.Result}（应为下一关）");
            float o0 = Time.time;
            while (!enc.OpenedExit && Time.time - o0 < BossEncounter.PortalDelay + 2f) yield return null;
            Line($"出口：{(enc.OpenedExit ? $"✓ {enc.OpenedExit.name} @ {At(enc.OpenedExit.transform.position)}" : "✗ 没有升起")}");
            if (!enc.OpenedExit) Fail("结算后出口没有升起");
            else Aim(motor, eye, enc.OpenedExit.Focus);
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "warlord_settled");
        }

        // ───────────── 工具 ─────────────

        /// <summary>等首领回到招式间隙（不在出招、转换、硬直里）</summary>
        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
        }

        /// <summary>熔铜渠退回低位（测阶段之前，免得「渠还在涨」让涨落降权）</summary>
        IEnumerator WaitChannelsDry()
        {
            if (!channels) yield break;
            channels.Recede();
            float t0 = Time.time;
            while (channels.Flooding && Time.time - t0 < channels.fallTime + 2f) yield return null;
        }

        void SetHealthFraction(float fraction)
        {
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
        }

        /// <summary>玩家站到首领正前方 distance 米（夹进场地、贴到导航网格、不站在熔岩里），对着首领、回满</summary>
        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            Vector3? best = null;
            foreach (float yaw in new[] { 0f, 30f, -30f, 60f, -60f, 90f, -90f, 180f })
            {
                var dir = Quaternion.Euler(0, yaw, 0) * fwd;
                var spot = arena.Clamp(boss.transform.position + dir * distance, 2f);
                if (!NavMesh.SamplePosition(spot, out var hit, 3f, NavMesh.AllAreas) || LavaField.IsLava(hit.position)) continue;
                best = hit.position;
                break;
            }
            if (best.HasValue) Place(best.Value);
            Aim(motor, eye, boss.BodyCenter);
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        /// <summary>把玩家放到导航网格点上（不从上往下打射线）</summary>
        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        static string At(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";
        static bool Finite(float v) => float.IsFinite(v);
        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
