using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领危险物冒烟（B1，bridge.sh playtest boss-hazards；场景 TestArena）：生成「危险物样机」（<see cref="ReferenceBossDef"/>），把沙暴巨像 / 霜翼妖后 / 熔心魔将的参考招式逐个强制出一次——
    ///   · 一阶段一轮、压到三阶段再一轮（二、三阶段的变体：双波、七石、双冲、反手横扫、落点留火、五道岩刺…）；
    ///   · 每招：走到出手段、正常收招、画过预警（招式自己的圆 / 线 + 危险物的扇形 / 长条 / 环 / 落点）、放出了它该放的危险物（冲击波、持续区、抛射物、地刺、光束、弹幕）；
    ///   · 打断：横扫前摇中打断 → 招式组还没填满的预警全部撤回；陨石雨出手后打断 → 已经抛出的陨石照常落地、落点预警（hazard 组）还亮着；
    ///   · 清场：陨石 + 熔岩环 + 扫射同时在场时击杀首领 → 抛射物、持续区、光束、任务、两组预警全部清空，倒下后不再伤人；
    ///   · 玩家站在首领前方 9 m 吃招（锁血不死），记打中次数；运行时报错由宿主记不合格。
    /// </summary>
    public sealed class BossHazardsSuite : PlaytestSuite
    {
        public override string Id => "boss-hazards";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const float MoveTimeout = 14f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossBrain boss;
        BossHazards hz;
        System.IDisposable bossGuard;
        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 TestArena？）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            vitals.stats.Add("playtest_boss_hazards", Stat.MaxHp, 5000);
            vitals.Heal(99999);

            var def = Bosses.Get(ReferenceBossDef.Id);
            if (def == null)
            {
                Fail($"没有登记危险物样机 {ReferenceBossDef.Id}");
                yield break;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"危险物样机定义自检不通过：{string.Join("；", errs)}");
            arena = BossArena.Find(ReferenceBossDef.Id);
            if (!arena)
            {
                Line("场景里没有 BossArena 锚点，临时在 (0, 0) 建一个半径 16 m 的场地");
                arena = BossArena.CreateRuntime(Vector3.zero, 16f, Vector3.forward);
            }
            Teleport(motor, arena.PlayerEntryPoint);
            yield return null;
            boss = Bosses.Spawn(ReferenceBossDef.Id, arena, 1f);
            if (!boss)
            {
                Fail("危险物样机生成失败");
                yield break;
            }
            hz = BossHazards.For(boss);
            bossGuard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
            float t0 = Time.time;
            while (!boss.IntroDone && Time.time - t0 < def.intro.seconds + 3f) yield return null;
            if (!boss.IntroDone) Fail("登场没有结束");
            Line($"生成：{boss.Title}，{boss.Health.maxHealth:F0} 生命，模型 {boss.Model?.source} {boss.Model?.prefab}，参考招式 {boss.Moves.Count} 个（{string.Join("、", boss.Moves.Select(m => m.Id))}）");
            if (boss.Moves.Count != ReferenceBossDef.All.Count) Fail($"招式数 {boss.Moves.Count}，应为 {ReferenceBossDef.All.Count}");

            yield return Pass("一阶段");
            if (boss && !boss.Dead)
            {
                yield return DrivePhase(2);
                yield return Pass("三阶段");
            }
            if (boss && !boss.Dead)
            {
                yield return InterruptCases();
                yield return ClearOnDeath();
            }

            bossGuard?.Dispose();
            vitals.stats.Remove("playtest_boss_hazards");
            Application.logMessageReceived -= OnLog;
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            Line($"合计：危险物打中玩家 {hz?.PlayerHits ?? 0} 次，敌人对玩家伤害 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 逐招 ─────────────

        IEnumerator Pass(string label)
        {
            foreach (var move in boss.Moves.ToList())
            {
                if (!boss || boss.Dead) yield break;
                yield return OneMove(move, label);
            }
        }

        IEnumerator OneMove(BossMove move, string label)
        {
            ReadyPlayer(9f);
            yield return null;
            int tel0 = move.TelegraphCount, act0 = move.TimesActive;
            int w0 = hz.WavesSpawned, z0 = hz.ZonesSpawned, l0 = hz.LobsSpawned, e0 = hz.EruptsSpawned, b0 = hz.BeamsSpawned, warn0 = hz.WarningsDrawn, hit0 = hz.PlayerHits;
            int proj0 = EnemyProjectile.LiveCount, projMax = 0;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 4f) yield return null;
            if (!forced)
            {
                Fail($"{label} {move.Id}：强制出招失败");
                yield break;
            }
            bool shot = false;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                projMax = Mathf.Max(projMax, EnemyProjectile.LiveCount - proj0);
                if (!shot && move.Stage == MoveStage.Active && move.StageT > 0.25f)
                {
                    shot = true;
                    Shot(weapons.eye, $"hazard_{move.Id}_{(label == "一阶段" ? "p0" : "p2")}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            // 让已经放出去的危险物兑现一会儿（地刺、陨石、冲击波）
            float settle = Time.time;
            while (Time.time - settle < 1.2f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            int waves = hz.WavesSpawned - w0, zones = hz.ZonesSpawned - z0, lobs = hz.LobsSpawned - l0, erupts = hz.EruptsSpawned - e0, beams = hz.BeamsSpawned - b0;
            int warns = hz.WarningsDrawn - warn0 + move.TelegraphCount - tel0, hits = hz.PlayerHits - hit0;
            string extra = move switch
            {
                ColossusBeam cb => $"，扫过 {cb.Swept * Mathf.Rad2Deg:F0}°、扫中 {cb.Hits} 次",
                ColossusFissure cf => $"，排进地刺 {cf.LastSpikes} 根",
                MatriarchLances ml => $"，射出冰枪 {ml.Fired} 支",
                MatriarchSpiral ms => $"，冰棱 {ms.Emitted} 圈",
                WarlordCharge wc => $"，火迹 {wc.Trails} 片、撞中 {wc.Hits} 次",
                WarlordLeap wl => $"，落在预警圈 {(wl.LastOnMark ? "✓" : "✗")}",
                WarlordCombo co => $"，斩中 {co.Hits} 次",
                _ => "",
            };
            Line($"{label} {move.Name}（{move.Id}）：{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，预警 {warns}，" +
                 $"冲击波 {waves} / 持续区 {zones} / 抛射 {lobs} / 地刺 {erupts} / 光束 {beams} / 弹幕峰值 {projMax}，打中玩家 {hits} 次{extra}");
            if (!ended) Fail($"{label} {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"{label} {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"{label} {move.Id} 被打断了（没有外力时应正常收招）");
            if (warns <= 0) Fail($"{label} {move.Id} 没有画任何预警");
            bool phase1 = boss.Phase >= 1, phase2 = boss.Phase >= 2;
            string missing = move switch
            {
                ColossusSlam when waves < (phase1 ? 2 : 1) => $"冲击波 {waves} 道（应 {(phase1 ? 2 : 1)}）",
                ColossusBoulders when lobs != (phase1 ? 7 : 5) => $"巨石 {lobs} 颗（应 {(phase1 ? 7 : 5)}）",
                ColossusBeam when beams < 4 => $"光束 {beams} 条（瞄准线 2 + 主光束 2）",
                ColossusStomp when phase1 && waves < 1 => "二阶段起践踏没有冲击波",
                ColossusFissure cf when erupts < 1 || cf.LastSpikes != erupts => $"地刺 {erupts} 根（排进 {cf.LastSpikes}）",
                MatriarchLances ml when ml.Fired != (phase1 ? 14 : 5) => $"冰枪 {ml.Fired} 支（应 {(phase1 ? 14 : 5)}）",
                MatriarchSpiral ms when ms.Emitted <= 0 => "没有放出冰棱",
                MatriarchNova when phase1 && projMax <= 0 => "二阶段起新星没有放出冰棱环",
                WarlordSweep when waves < (phase1 ? 2 : 1) => $"火浪 {waves} 道（应 {(phase1 ? 2 : 1)}）",
                WarlordMeteor when lobs != (phase2 ? 20 : phase1 ? 14 : 10) => $"陨石 {lobs} 颗（应 {(phase2 ? 20 : phase1 ? 14 : 10)}）",
                WarlordLeap when waves < 1 => "跃击落地没有冲击波",
                WarlordLava when zones < 1 => "没有生成熔岩环",
                _ => null,
            };
            if (missing != null) Fail($"{label} {move.Id}：{missing}");
            // 熔岩环要在下一招之前收掉，免得一直烫玩家
            if (move is WarlordLava lava && lava.LavaZone) lava.LavaZone.Expire();
        }

        // ───────────── 阶段 ─────────────

        IEnumerator DrivePhase(int phase)
        {
            var def = boss.Def;
            while (boss && !boss.Dead && boss.Phase < phase && boss.Phase < def.phases.Count)
            {
                var hp = boss.Health;
                hp.health = Mathf.Clamp(hp.maxHealth * (def.phases[boss.Phase].at - 0.02f), 1, hp.maxHealth);
                int target = boss.Phase + 1;
                float t0 = Time.time;
                while (boss.Phase < target && Time.time - t0 < def.phaseWait + 4f)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                while (boss.Transitioning && Time.time - t0 < def.phaseWait + 8f) yield return null;
                if (boss.Phase < target)
                {
                    Fail($"没有进入阶段 {target}");
                    yield break;
                }
            }
            Line($"已压到阶段 {boss.Phase}（生命 {boss.PhaseFraction:P0}）");
        }

        // ───────────── 打断 / 清场 ─────────────

        IEnumerator InterruptCases()
        {
            // 横扫：前摇里打断 → 招式组（扇形）还没填满的预警全部撤回
            ReadyPlayer(9f);
            yield return null;
            if (boss.ForceMove("warlord_sweep"))
            {
                float t0 = Time.time;
                while (Time.time - t0 < 0.25f) yield return null;
                int pendingBefore = hz.MoveWarnings.PendingCount;
                boss.AbortMove();
                yield return null;
                int pendingAfter = hz.MoveWarnings.PendingCount;
                Line($"打断横扫（前摇中）：招式组未填满预警 {pendingBefore} → {pendingAfter}");
                if (pendingBefore <= 0) Fail("横扫前摇里招式组没有未填满的扇形预警（预警没走 BossHazards？）");
                if (pendingAfter != 0) Fail($"打断后招式组还有 {pendingAfter} 个预警没撤回");
            }
            else Fail("强制横扫失败");

            // 陨石雨：出手后打断 → 已经抛出的陨石照常落地，hazard 组落点预警还亮着
            yield return new WaitForSeconds(1.2f);
            ReadyPlayer(9f);
            if (boss.ForceMove("warlord_meteor"))
            {
                float t0 = Time.time;
                while ((boss.Current == null || boss.Current.Stage != MoveStage.Active || boss.Current.StageT < 0.9f) && Time.time - t0 < 4f) yield return null;
                int flying = hz.ActiveLobs, alive = hz.HazardWarnings.AliveCount, landed0 = hz.LobsSpawned - hz.ActiveLobs;
                boss.AbortMove();
                yield return null;
                int flyingAfter = hz.ActiveLobs, aliveAfter = hz.HazardWarnings.AliveCount;
                float w0 = Time.time;
                while (hz.ActiveLobs > 0 && Time.time - w0 < 3f)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                Line($"打断陨石雨（出手后）：在飞 {flying} → {flyingAfter} 颗、落点预警 {alive} → {aliveAfter} 个，之后 {Time.time - w0:F1} s 全部落地（剩 {hz.ActiveLobs}）");
                if (flying <= 0) Fail("陨石雨出手 0.9 s 后没有陨石在飞");
                else if (flyingAfter < flying) Fail("打断招式把已经抛出的陨石收掉了（应照常落地）");
                if (alive > 0 && aliveAfter <= 0) Fail("打断招式撤回了 hazard 组的落点预警（应随陨石兑现）");
                if (hz.ActiveLobs > 0) Fail("打断后的陨石 3 s 内没有落地");
            }
            else Fail("强制陨石雨失败");
        }

        IEnumerator ClearOnDeath()
        {
            yield return new WaitForSeconds(1f);
            ReadyPlayer(10f);
            // 熔岩环 + 陨石 + 扫射光束同时在场
            boss.ForceMove("warlord_lava");
            float t0 = Time.time;
            while (boss.Current != null && Time.time - t0 < 3f) yield return null;
            boss.ForceMove("warlord_meteor");
            t0 = Time.time;
            while ((boss.Current == null || boss.Current.Stage != MoveStage.Active || boss.Current.StageT < 0.6f) && Time.time - t0 < 4f) yield return null;
            int lobs = hz.ActiveLobs, zones = hz.ActiveZones, tasks = hz.PendingTasks, warns = hz.HazardWarnings.AliveCount + hz.MoveWarnings.AliveCount;
            int clears0 = hz.Clears;
            bossGuard?.Dispose();
            bossGuard = null;
            var hp = boss.Health;
            float k0 = Time.time;
            while (!hp.Dead && Time.time - k0 < 3f)
            {
                if (!hp.untargetable)
                {
                    var info = DamageInfo.Simple(999999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(hp, info);
                }
                yield return null;
            }
            yield return null;
            float hpBefore = vitals.health + vitals.shield;
            int hits0 = hz.PlayerHits;
            float w0 = Time.time;
            while (Time.time - w0 < 2f) yield return null;
            Line($"击杀清场：场上陨石 {lobs} / 熔岩区 {zones} / 任务 {tasks} / 预警 {warns} → 陨石 {hz.ActiveLobs} / 持续区 {hz.ActiveZones} / 光束 {hz.ActiveBeams} / 任务 {hz.PendingTasks} / " +
                 $"预警 {hz.HazardWarnings.AliveCount + hz.MoveWarnings.AliveCount}，清场 {hz.Clears - clears0} 次，倒下后 2 s 内打中玩家 {hz.PlayerHits - hits0} 次");
            if (!hp.Dead) Fail("危险物样机没有被打死");
            if (lobs <= 0 && zones <= 0) Fail("清场测试开始时场上没有危险物（陨石 / 熔岩没放出来）");
            if (hz.Clears <= clears0) Fail("首领倒下没有清场（BossHazards.ClearAll）");
            if (hz.ActiveLobs > 0 || hz.ActiveZones > 0 || hz.ActiveBeams > 0 || hz.PendingTasks > 0) Fail("首领倒下后还有危险物在场");
            if (hz.HazardWarnings.AliveCount + hz.MoveWarnings.AliveCount > 0) Fail("首领倒下后还有预警亮着");
            if (hz.PlayerHits > hits0) Fail("首领倒下后危险物还在伤人");
        }

        // ───────────── 工具 ─────────────

        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            vitals.AddShield(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            Teleport(motor, arena.Clamp(boss.transform.position + fwd * distance, 2f));
            Aim(motor, eye, boss.BodyCenter);
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }
    }
}
