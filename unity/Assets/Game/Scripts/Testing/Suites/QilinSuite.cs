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
    /// 火麒麟冒烟（BS4，bridge.sh playtest boss-qilin；场景 3-4 祝融炉心）：
    ///   · 定义：自检、血条刻度 = 85% / 70% 饮熔线 + 55% 换形、3-4 难度下的定档与模拟击杀用时；
    ///   · 开战：玩家走到入场点 → 熔铁闸升起封门 → 登场预警 → 火麒麟从熔池跃出（不可选中、锁扣还没上膛）→ 登场结束：四个锁扣上膛（110 × 难度）、吊鼎吊着；
    ///     场景没重建（没有 BossEncounter）时在场地上直接刷一只（炉心殿几何、吊鼎、锁扣由首领自己补），记一行提示；
    ///   · 招式：玄鳞三招各强制出一次——走到出手、正常收招、画过预警、出招中霸体；踏火奔驰落蹄印、冲撞过；张鳞射满一圈；麟火在判定；
    ///   · 锁扣砸空：不饮熔时打碎一个锁扣 → 鼎那一角坠下、不砸中、记一次白费；
    ///   · 90 s 浸泡（玄鳞，首领不掉血）：不出殿、数值有限、招式不卡死、召唤不超上限、至少出过两种招；
    ///   · 饮熔 85%：跳到池边低头饮熔、身后锁扣发亮、炉口钻出炭童；打碎那个锁扣 → 鼎角砸中：硬直、护甲清零、鳞甲崩裂（身体 / 胸都算弱点）、
    ///     受伤 × 2（和崩裂结束后同样一击比）；4 s 后恢复；
    ///   · 饮熔 70%：不打锁扣 → 喝完鳞甲回满、伤害变高；
    ///   · 换形 55%：BossPhase(1)、转换中不可选中、锁扣静默移除、巨鼎坠池成掩体（横穿熔池的视线被挡）、换成焚身、护甲清零、胸口火心是弱点、演出结束可选中；
    ///   · 焚身占位招式（BS5 之前）各出一次；
    ///   · 击杀 → 溃散 → 结算：3-4 是最后一关 → 胜利链（不立出口）。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class QilinSuite : PlaytestSuite
    {
        public override string Id => "boss-qilin";
        /// <summary>3-4 祝融炉心（与编辑器里 Level_3_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";

        const float SoakSeconds = 90f, MoveTimeout = 16f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossEncounter enc;
        QilinBrain boss;
        System.IDisposable bossGuard;
        int logErrors, spawnedEvents, defeatedEvents;
        string lastError;
        readonly List<int> phaseEvents = new();
        readonly List<string> formEvents = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 3-4？先 bridge.sh level 3-4）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            // 首领登场演出（BossIntroDirector）的测试开关：本套件测战斗，不放演出（演出由 boss-intro 套件测）
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            GameEvents.BossSpawned += OnSpawned;
            GameEvents.BossPhase += OnPhase;
            GameEvents.BossForm += OnForm;
            GameEvents.BossDefeated += OnDefeated;
            vitals.stats.Add("playtest_qilin", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            CheckDef();
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                Guard(true);
                yield return EachMove();
                yield return WastedLock();
                yield return Soak();
                yield return DrinkHit();
                yield return DrinkRefill();
                yield return TransitionCase();
                yield return BurnMoves();
                yield return KillCase();
            }

            Guard(false);
            vitals.stats.Remove("playtest_qilin");
            GameEvents.BossSpawned -= OnSpawned;
            GameEvents.BossPhase -= OnPhase;
            GameEvents.BossForm -= OnForm;
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

        void OnForm(BossBrain b, BossFormDef f)
        {
            if (b == boss) formEvents.Add(f?.id);
        }

        void OnDefeated(BossBrain b)
        {
            if (b == boss) defeatedEvents++;
        }

        /// <summary>首领不掉血（浸泡、招式）：承伤 × 0</summary>
        void Guard(bool on)
        {
            bossGuard?.Dispose();
            bossGuard = null;
            if (on && boss && boss.Health) bossGuard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
        }

        // ───────────── 定义 ─────────────

        void CheckDef()
        {
            var def = Bosses.Get(QilinDef.Id) as QilinDef;
            if (def == null)
            {
                Fail($"没有登记首领 {QilinDef.Id}（QilinDef）");
                return;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"火麒麟定义自检：{string.Join("；", errs)}");
            var ticks = def.BarTicks;
            bool ticksOk = ticks.SequenceEqual(new[] { 0.85f, 0.7f, QilinDef.TransformAt });
            var v = def.VitalsAt(QilinDef.StageDifficulty);
            float dps = QilinDef.ReferenceDps(QilinDef.StageDifficulty);
            Line($"定义：{def.name}（{def.title}），形态 {string.Join(" → ", def.forms.Select(f => f.id))}，血条刻度 {string.Join(" / ", ticks.Select(t => $"{t:P0}"))} {(ticksOk ? "✓" : "✗")}，" +
                 $"难度 {QilinDef.StageDifficulty} 下 {v}；模拟秒伤 {dps:F0} → 击杀用时 砸中两次 {QilinDef.EstimateKillSeconds(v, dps, 2):F0} s / 一次 {QilinDef.EstimateKillSeconds(v, dps, 1):F0} s / " +
                 $"零次 {QilinDef.EstimateKillSeconds(v, dps, 0):F0} s；招式 {string.Join("、", def.moves.Select(m => m().Id))}");
            if (!ticksOk) Fail("血条刻度不是 85% / 70% 饮熔线 + 55% 换形");
        }

        // ───────────── 开战 ─────────────

        IEnumerator StartFight()
        {
            enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == QilinDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(QilinDef.Id);
            if (!arena)
            {
                Line("场景里没有火麒麟的 BossArena（3-4 还没建？），在玩家前方临时建一个 24 m 的场地");
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 26f, 24f, fwd, QilinDef.Id);
            }
            int spawned0 = spawnedEvents;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                Place(arena.PlayerEntryPoint);
                Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
                float t0 = Time.time;
                while (enc.State == BossEncounter.Phase.Waiting && Time.time - t0 < 3f) yield return null;
                bool sealedNow = enc.GatesSealed;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                Line($"首领关流程：走进入场点 → {enc.State}，熔铁闸封门 {(sealedNow ? "✓" : enc.gates.Length == 0 ? "（没有门）" : "✗")}（{Time.time - t0:F1} s 后首领登场）");
                if (enc.gates.Length > 0 && !sealedNow) Fail("开战时熔铁闸没有升起封门");
                boss = enc.Boss as QilinBrain;
                if (!boss) Fail($"BossEncounter 没有刷出火麒麟（State {enc.State}，Boss {enc.Boss}）");
            }
            else
            {
                Line(enc ? $"BossEncounter 状态 {enc.State}，直接刷火麒麟" : "场景里没有火麒麟的 BossEncounter（3-4 还没建？），直接在场地上刷");
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(QilinDef.Id, arena, QilinDef.StageDifficulty) as QilinBrain;
                if (!boss) Fail("火麒麟生成失败（行为不是 QilinBrain？）");
            }
            if (!boss) yield break;
            var hp = boss.Health;
            string model = boss.Model == null ? "（没有模型）" : boss.Model.source switch
            {
                BossModelSource.Art => $"美术 {boss.Model.prefab} × {boss.Model.scale}",
                BossModelSource.Proxy => $"代理 {boss.Model.prefab} × {boss.Model.scale}",
                _ => $"占位胶囊 × {boss.Model.scale}",
            };
            var f = boss.Furnace;
            Line($"生成：{boss.Title}（{boss.Subtitle}），{hp.maxHealth:F0} 生命 + {hp.maxArmor:F0} 护甲（难度 {boss.level:F2}），模型 {model}；" +
                 $"炉心殿 {(f ? $"{f.name}（熔池 {f.poolRadius} m、殿墙 {f.wallRadius} m）" : "（没有）")}，吊鼎 {(boss.Cauldron ? boss.Cauldron.name : "（没有）")}，锁扣 {boss.Locks.Count} 个，BossSpawned +{spawnedEvents - spawned0}");
            if (spawnedEvents - spawned0 != 1) Fail($"BossSpawned 派发了 {spawnedEvents - spawned0} 次（应 1 次）");
            if (!f) Fail("火麒麟没有炉心殿几何（QilinFurnace）");
            if (!boss.Cauldron) Fail("火麒麟没有吊鼎");
            if (boss.Locks.Count != 4) Fail($"锁扣 {boss.Locks.Count} 个（应 4）");
            if (boss.Model == null || boss.Model.source != BossModelSource.Art) Fail("火麒麟没有用正式美术 SK_Boss_Qilin");
            yield return null;
            bool dormant = boss.Locks.All(l => l && !l.Alive);
            if (!hp.untargetable) Fail("登场期间可以被选中");
            if (!dormant) Fail("登场期间锁扣就上膛了（应登场结束才能打）");
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "qilin_intro");
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f) yield return null;
            yield return null;
            var lockHp = boss.Locks.Where(l => l).Select(l => l.Health.maxHealth).DefaultIfEmpty(0).Max();
            float wantLock = EnemyAI.RoundHp(QilinLock.BaseHp * boss.level);
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - i0:F1} s" : "✗ 没有结束")}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}，" +
                 $"锁扣上膛 {boss.Locks.Count(l => l && l.Alive)} / 4（血量 {lockHp:F0}，应 {wantLock:F0}），吊鼎 {boss.Cauldron?.State}、拴着 {boss.Cauldron?.IntactCount} 条链");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            if (hp.untargetable) Fail("登场结束后仍不可选中");
            if (boss.Locks.Count(l => l && l.Alive) != 4) Fail("登场结束后四个锁扣没有全部上膛");
            if (Mathf.Abs(lockHp - wantLock) > 1f) Fail($"锁扣血量 {lockHp}（应 110 × 难度 = {wantLock}）");
            if (boss.Cauldron && (boss.Cauldron.State != CauldronState.Hang || boss.Cauldron.IntactCount != 4)) Fail("开战时吊鼎不是四链吊着");
            var root = boss.Model?.root;
            if (root && root.transform.localPosition.sqrMagnitude > 0.01f) Fail($"登场结束后模型还有偏移 {root.transform.localPosition}");
        }

        // ───────────── 招式 ─────────────

        IEnumerator EachMove()
        {
            foreach (var id in new[] { ScaleGallop.MoveId, ScaleBlades.MoveId, ScaleBreath.MoveId })
            {
                if (!boss || boss.Dead) yield break;
                var m = boss.MoveById(id);
                if (m == null)
                {
                    Fail($"火麒麟没有招式 {id}");
                    continue;
                }
                yield return OneMove(m, id == ScaleBreath.MoveId ? 9f : 14f);
            }
        }

        IEnumerator OneMove(BossMove move, float distance)
        {
            yield return WaitIdle();
            ReadyPlayer(distance);
            PlayerStatus.Instance?.ClearAll();
            yield return null;
            var qm = move as QilinMove;
            int warn0 = qm != null ? qm.Warned : move.TelegraphCount, act0 = move.TimesActive, prints0 = boss.PrintsDropped;
            int rings0 = move is ScaleBlades b0 ? b0.Rings : 0, blades0 = move is ScaleBlades b1 ? b1.BladesFired : 0;
            int charges0 = move is ScaleGallop g0 ? g0.Charges : 0, ticks0 = move is ScaleBreath br0 ? br0.Ticks : 0;
            int stomps0 = move is BurnPlaceholderStomp s0 ? s0.Stomps : 0;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 5f) yield return null;
            if (!forced)
            {
                Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                yield break;
            }
            var stages = new List<MoveStage>();
            bool immune = true, shot = false;
            float maxOut = 0;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!move.stunnable && !boss.StunImmune) immune = false;
                maxOut = Mathf.Max(maxOut, OutOfHall(boss.transform.position));
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active && Time.time - t0 > 1.2f)
                {
                    shot = true;
                    yield return null;
                    Shot(weapons.eye, $"qilin_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            int warned = (qm != null ? qm.Warned : move.TelegraphCount) - warn0;
            string extra = move switch
            {
                ScaleGallop g => $"，蹄印 {boss.PrintsDropped - prints0} 个（在烧 {boss.LivePrints}）、冲撞 {g.Charges - charges0} 次（线长 {g.ChargeLength:F1} m，撞到玩家 {g.ChargeHits}、撞柱 {g.Crashes}）、践踏 {g.Tramples}",
                ScaleBlades b => $"，{b.Rings - rings0} 圈 {b.BladesFired - blades0} 片鳞刃（两圈 {b.TwoRings}），打中玩家累计 {b.BladeHits}",
                BurnPlaceholderStomp s => $"，跃击 {s.Stomps - stomps0} 次",
                ScaleBreath br => $"，判定 {br.Ticks - ticks0} 次、烧到 {br.Hits}、被挡 {br.Blocked}",
                _ => "",
            };
            Line($"招式 {move.Name}（{move.Id}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，" +
                 $"预警 {warned} 个，出招中霸体 {(immune ? "✓" : "✗")}，最远出殿 {maxOut:F1} m{extra}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (warned <= 0) Fail($"招式 {move.Id} 没有画预警");
            if (!immune) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (maxOut > 1.5f) Fail($"招式 {move.Id} 跑出殿墙 {maxOut:F1} m");
            switch (move)
            {
                case ScaleGallop g:
                    if (boss.PrintsDropped - prints0 < 8) Fail($"踏火奔驰只落了 {boss.PrintsDropped - prints0} 个蹄印（应 ≥ 8）");
                    if (g.Charges - charges0 < 1) Fail("踏火奔驰没有横穿冲撞");
                    break;
                case ScaleBlades b when b.BladesFired - blades0 < ScaleBlades.Count:
                    Fail($"张鳞只射出 {b.BladesFired - blades0} 片鳞刃（应 ≥ {ScaleBlades.Count}）");
                    break;
                case BurnPlaceholderStomp s when s.Stomps - stomps0 < 1:
                    Fail("焚身跃击（占位）没有落地");
                    break;
                case ScaleBreath br when br.Ticks - ticks0 < 5:
                    Fail($"麟火只判定了 {br.Ticks - ticks0} 次");
                    break;
            }
            if (boss.Health.untargetable) Fail($"招式 {move.Id} 之后首领不可选中");
        }

        /// <summary>首领离殿墙外多远（米，殿内为 0）</summary>
        float OutOfHall(Vector3 p)
        {
            var f = boss ? boss.Furnace : null;
            if (!f) return arena && !arena.Contains(p, 0) ? (Flat(p - arena.Center).magnitude - arena.Extent) : 0;
            return Mathf.Max(0, f.RadiusOf(p) - f.wallRadius);
        }

        // ───────────── 锁扣 ─────────────

        /// <summary>经伤害管线打碎锁扣（锁芯弱点、一发打碎）</summary>
        static void Break(QilinLock l)
        {
            if (!l || !l.Alive) return;
            var c = l.CoreTransform ? l.CoreTransform.position : l.transform.position;
            var info = DamageInfo.Simple(l.Health.health * 10f + 999f, DamageSource.Weapon, c, l.transform.forward * -1f);
            info.weakpoint = true;
            Combat.DamageEnemy(l.Health, info);
        }

        /// <summary>从 eye 往 target 打一枪（子弹层）：第一个碰到的不是锁扣、也不是玩家自己时返回它的名字，打得到锁扣返回 null</summary>
        string ShotBlocker(Vector3 eyePos, Vector3 target, QilinLock l)
        {
            var d = target - eyePos;
            var hits = Physics.RaycastAll(eyePos, d.normalized, d.magnitude + 0.5f, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            System.Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            foreach (var h in hits)
            {
                if (!h.collider || h.collider.transform.IsChildOf(motor.transform)) continue;
                if (l && h.collider.transform.IsChildOf(l.transform)) return null;
                return $"{h.collider.name}（{h.distance:F1} m）";
            }
            return "什么都没打到";
        }

        IEnumerator WastedLock()
        {
            yield return WaitIdle();
            var cd = boss.Cauldron;
            var l = boss.Locks.FirstOrDefault(x => x && x.Alive);
            if (!cd || !l)
            {
                Fail("没有可打的锁扣 / 吊鼎");
                yield break;
            }
            int wasted0 = boss.WastedCorners, hits0 = boss.CauldronHits, drops0 = cd.Drops;
            Break(l);
            yield return new WaitForSeconds(QilinCauldron.CornerDrop + 0.5f);
            Line($"不饮熔时打碎锁扣 {l.index}：锁扣 {l.State}，鼎角坠下 {(cd.DroppedCorner == l.index ? "✓" : "✗")}（吊鼎 {cd.State}，还拴着 {cd.IntactCount} 条），" +
                 $"砸空 {boss.WastedCorners - wasted0} 次、砸中 {boss.CauldronHits - hits0}，首领硬直 {boss.Staggered}");
            if (l.State != QilinLock.LockState.Broken) Fail("锁扣没被打碎");
            if (cd.Drops - drops0 != 1 || cd.DroppedCorner != l.index) Fail("打碎锁扣后鼎的那一角没有坠下");
            if (boss.WastedCorners - wasted0 != 1) Fail("不饮熔时打碎锁扣没有记成砸空");
            if (boss.CauldronHits != hits0 || boss.Staggered) Fail("不饮熔时鼎角砸空却砸中了首领");
            Shot(weapons.eye, "qilin_corner_wasted");
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            SetHealthFraction(0.92f);
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int sum0 = boss.Summons.TotalSpawned;
            int maxAlive = 0, badFrames = 0, revives = 0;
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
                    var q = arena.RandomPoint(3f);
                    if (NavMesh.SamplePosition(q, out var qh, 3f, LavaField.WalkerFilter())) Place(qh.position);
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.armor) || hp.health <= 0 || hp.health > hp.maxHealth + 0.01f || hp.armor < 0 || hp.armor > hp.maxArmor + 0.01f)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护甲 {hp.armor}/{hp.maxArmor}";
                }
                if (Finite(p)) maxOut = Mathf.Max(maxOut, OutOfHall(p));
                maxAlive = Mathf.Max(maxAlive, boss.Summons.Alive + boss.Summons.PendingCount);
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            boss.Summons.DespawnAll();
            Line($"浸泡 {Time.time - t0:F0} s（玄鳞）：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，召唤 {boss.Summons.TotalSpawned - sum0} 只（同时最多 {maxAlive}），" +
                 $"最远出殿 {maxOut:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次，蹄印累计 {boss.PrintsDropped}");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 1.5f) Fail($"浸泡期间首领跑出殿墙 {maxOut:F1} m");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (maxAlive > boss.Summons.Cap) Fail($"浸泡期间召唤物同时 {maxAlive} 只，超过上限 {boss.Summons.Cap}");
            if (counts.Count < 2) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
            if (counts.ContainsKey(ScaleDrink.MoveId)) Fail("生命 92% 时出了饮熔（应只由 85% / 70% 血量线排上）");
        }

        // ───────────── 饮熔 + 锁扣砸鼎 ─────────────

        IEnumerator WaitSip(int drinks0)
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && !(boss.Sipping && boss.DrinksStarted > drinks0) && Time.time - t0 < 14f)
            {
                KeepPlayerAlive();
                yield return null;
            }
        }

        IEnumerator DrinkHit()
        {
            yield return WaitIdle();
            var hp = boss.Health;
            int drinks0 = boss.DrinksStarted, sum0 = boss.Summons.TotalSpawned, hits0 = boss.CauldronHits;
            ReadyPlayer(16f);
            SetHealthFraction(0.84f);
            yield return WaitSip(drinks0);
            if (!boss.Sipping)
            {
                Fail($"生命降到 84% 后没有饮熔（排上 {boss.DrinksQueued} 次，当前 {boss.Current?.Id}）");
                yield break;
            }
            int q = boss.DrinkQuadrant;
            var f = boss.Furnace;
            var l = boss.LockAt(q);
            float r = f ? f.RadiusOf(boss.transform.position) : 0;
            float off = f ? Mathf.Abs(Mathf.DeltaAngle(f.YawOf(boss.transform.position), f.QuadrantYaw(q))) : 0;
            yield return new WaitForSeconds(0.8f);
            Line($"饮熔 85%：象限 {q}，离圆心 {r:F1} m（熔池 {f?.poolRadius}），偏离象限中线 {off:F0}°，身后锁扣 {(l ? $"{l.name} 发亮 {(l.Highlight ? "✓" : "✗")}" : "（没有）")}，" +
                 $"炭童排进 {boss.Summons.TotalSpawned - sum0 + boss.Summons.PendingCount} 只");
            if (f && (r < f.poolRadius || r > f.poolRadius + 5f)) Fail($"饮熔点不在池边（离圆心 {r:F1} m）");
            if (off > 12f) Fail($"饮熔点偏离象限中线 {off:F0}°");
            if (!l || !l.Alive) Fail("饮熔的象限没有还挂着的锁扣");
            else if (!l.Highlight) Fail("饮熔时身后的锁扣没有发亮");
            if (boss.Summons.TotalSpawned - sum0 + boss.Summons.PendingCount < 1) Fail("饮熔时炉口没有钻出炭童");
            Shot(weapons.eye, "qilin_drink");
            if (!l || !l.Alive) yield break;
            // 机器人真打锁扣：站到那个象限的跑道内沿（象限中线偏 35°、离圆心 17 m，隔开饮熔的麒麟和柱子），抬头瞄锁芯按住开火；
            // 2.6 s 没打碎就经伤害管线补一下（饮熔窗口 4 s，鼎角还要 0.55 s 才砸下来）
            var core = l.CoreTransform ? l.CoreTransform : l.transform;
            if (f)
            {
                var stand = f.Point(f.QuadrantYaw(q) + 35f, 17f);
                if (NavMesh.SamplePosition(stand, out var sh, 3f, LavaField.WalkerFilter())) stand = sh.position;
                Place(stand);
            }
            yield return null;
            Aim(motor, eye, core.position);
            float lock0 = l.Health.health, shoot0 = Time.time;
            string blocker = ShotBlocker(eye.position, core.position, l);
            bool shotTaken = false;
            while (l.Alive && Time.time - shoot0 < 2.6f)
            {
                // 一帧按一帧松：连发枪照样按射速打，半自动的也一下一下扣得动
                weapons.testFire = !weapons.testFire;
                Aim(motor, eye, core.position);
                KeepPlayerAlive();
                if (!shotTaken && Time.time - shoot0 > 0.3f)
                {
                    shotTaken = true;
                    Shot(weapons.eye, "qilin_lock_shoot");
                }
                yield return null;
            }
            weapons.testFire = false;
            bool shotDown = !l.Alive;
            float dealt = lock0 - (l.Alive ? l.Health.health : 0);
            var toCore = core.position - eye.position;
            Line($"机器人打锁扣 {q}：离地 {core.position.y - (f ? f.FloorY : 0):F1} m、距离 {toCore.magnitude:F1} m、仰角 {Mathf.Asin(toCore.y / Mathf.Max(0.01f, toCore.magnitude)) * Mathf.Rad2Deg:F0}°，" +
                 $"视线 {blocker ?? "通"}，{(shotDown ? $"✓ {Time.time - shoot0:F2} s 打碎（{lock0:F0} 血）" : $"2.6 s 打掉 {dealt:F0} / {lock0:F0}，经伤害管线补碎")}");
            if (!shotDown && dealt <= 0) Fail($"机器人打不到 12 m 高的锁扣（视线：{blocker ?? "通"}）");
            if (!shotDown) Break(l);
            float s0 = Time.time;
            while (!boss.Staggered && Time.time - s0 < QilinCauldron.CornerDrop + 1.5f) yield return null;
            bool weakBody = boss.ZoneWeak("body"), weakChest = boss.ZoneWeak("chest");
            Line($"打碎身后锁扣 {q}：{Time.time - s0:F2} s 后鼎角砸中 {(boss.CauldronHits > hits0 ? "✓" : "✗")}，硬直 {boss.Staggered}，崩裂 {boss.CrackLeft:F1} s，" +
                 $"护甲 {hp.armor:F0}，身体弱点 {weakBody}、胸弱点 {weakChest}，饮熔被打断 {(!boss.Sipping ? "✓" : "✗")}");
            if (boss.CauldronHits <= hits0) Fail("饮熔时打碎它身后的锁扣，鼎角没有砸中");
            if (!boss.Staggered) Fail("鼎角砸中后首领没有硬直");
            if (!(boss.CrackLeft > 3f)) Fail($"鳞甲崩裂只剩 {boss.CrackLeft:F1} s（应约 4 s）");
            if (hp.armor > 0.01f) Fail($"鼎角砸中后护甲还有 {hp.armor:F0}（应清零）");
            if (!weakBody || !weakChest) Fail("鳞甲崩裂时身体 / 胸口不算弱点");
            if (boss.Sipping) Fail("鼎角砸中后还在饮熔");
            Aim(motor, eye, boss.HeadPoint);
            Shot(weapons.eye, "qilin_cauldron_stun");
            // 受伤 × 2：同样一击，崩裂中 vs 崩裂结束后
            float cracked = Probe();
            float w0 = Time.time;
            while ((boss.Staggered || boss.Cracked) && Time.time - w0 < QilinDef.StunSeconds + 2f) yield return null;
            yield return null;
            float normal = Probe();
            float ratio = normal > 0 ? cracked / normal : 0;
            Line($"崩裂结束（{Time.time - s0:F1} s）：硬直 {boss.Staggered}、身体弱点 {boss.ZoneWeak("body")}；同一击崩裂中 {cracked:F0} / 之后 {normal:F0}（× {ratio:F2}）");
            if (boss.Staggered || boss.Cracked) Fail("4 s 后还在硬直 / 崩裂");
            if (boss.ZoneWeak("body")) Fail("崩裂结束后身体还算弱点");
            if (ratio < 1.8f || ratio > 2.2f) Fail($"鳞甲崩裂的受伤倍率 × {ratio:F2}（应 × 2）");
        }

        /// <summary>打一下生命层（不暴击、无属性、护甲先清零），返回实际掉的生命并加回去；期间撤掉不掉血的保护</summary>
        float Probe()
        {
            var hp = boss.Health;
            Guard(false);
            float armor = hp.armor, before = hp.health;
            hp.armor = 0;
            var info = DamageInfo.Simple(100f, DamageSource.Weapon, boss.BodyCenter, boss.transform.forward * -1f);
            info.noCrit = true;
            Combat.DamageEnemy(hp, info);
            float dealt = before - hp.health;
            hp.health = before;
            hp.armor = armor;
            Guard(true);
            return dealt;
        }

        IEnumerator DrinkRefill()
        {
            yield return WaitIdle();
            var hp = boss.Health;
            int drinks0 = boss.DrinksStarted, finished0 = boss.DrinksFinished;
            float dmg0 = boss.damage;
            hp.armor = 0;
            ReadyPlayer(16f);
            SetHealthFraction(0.69f);
            yield return WaitSip(drinks0);
            float t0 = Time.time;
            while (boss.DrinksFinished == finished0 && Time.time - t0 < 8f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            boss.Summons.DespawnAll();
            Line($"饮熔 70%（不打锁扣）：喝完 {(boss.DrinksFinished > finished0 ? "✓" : "✗")}，护甲 {hp.armor:F0} / {hp.maxArmor:F0}，伤害 {dmg0:F1} → {boss.damage:F1}，火鬃 {boss.ManeHeat:F2}");
            if (boss.DrinksFinished <= finished0) Fail("70% 的饮熔没有喝完");
            if (hp.armor < hp.maxArmor - 0.5f) Fail("饮熔喝完鳞甲没有回满");
            if (!(boss.damage > dmg0)) Fail("饮熔喝完伤害没有变高");
        }

        // ───────────── 换形 ─────────────

        IEnumerator TransitionCase()
        {
            yield return WaitIdle();
            var hp = boss.Health;
            var cd = boss.Cauldron;
            int events0 = phaseEvents.Count, forms0 = formEvents.Count;
            hp.armor = 0;
            SetHealthFraction(QilinDef.TransformAt - 0.01f);
            float t0 = Time.time;
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool fired = phaseEvents.Count > events0 && phaseEvents[^1] == 1;
            bool untargetable = boss.Transitioning && hp.untargetable;
            yield return null;
            bool purged = boss.Locks.All(l => !l || l.State is QilinLock.LockState.Purged or QilinLock.LockState.Broken);
            float c0 = Time.time;
            while (cd && cd.State != CauldronState.Fallen && Time.time - c0 < 2.5f) yield return null;
            bool fallen = cd && cd.State == CauldronState.Fallen && cd.Cover;
            bool covered = false;
            if (fallen)
            {
                var c = cd.transform.position;
                var a = c + new Vector3(-6f, 1.5f, 0.2f);
                var b = c + new Vector3(6f, 1.5f, 0.2f);
                Physics.SyncTransforms();
                covered = !Combat.LineClear(a, b);
            }
            Aim(motor, eye, boss.BodyCenter + Vector3.up * 3f);
            Shot(weapons.eye, "qilin_transition");
            float tr0 = Time.time;
            while (boss.Transitioning && Time.time - tr0 < 8f) yield return null;
            yield return null;
            bool burn = boss.Form != null && boss.Form.id == QilinDef.BurnForm;
            var heart = boss.Zone("heart");
            Line($"越过 {QilinDef.TransformAt:P0}：BossPhase {(fired ? $"✓ → 阶段 {boss.Phase}" : "✗")}，转换中不可选中 {(untargetable ? "✓" : "✗")}，锁扣全部移除 {(purged ? "✓" : "✗")}，" +
                 $"巨鼎坠池 {(fallen ? "✓" : "✗")}（掩体挡住横穿熔池的视线 {(covered ? "✓" : "✗")}），换形 {string.Join(" → ", formEvents.Skip(forms0))}，" +
                 $"现在 {boss.Title}（{(boss.Model != null ? boss.Model.prefab : "?")}），护甲 {hp.armor:F0}，胸口火心 {(heart ? $"{(heart.Active ? "启用" : "关着")}、弱点 {heart.weakpoint}" : "（没有）")}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!fired) Fail($"生命层降到 {QilinDef.TransformAt - 0.01f:P0} 没有进入二阶段");
            if (!untargetable) Fail("换形演出中可以被选中");
            if (!purged) Fail("换形时锁扣没有移除");
            if (!fallen) Fail("换形时巨鼎没有坠池落定（没有掩体碰撞盒）");
            else if (!covered) Fail("坠池的巨鼎没有挡住横穿熔池的视线");
            if (!burn) Fail("换形后不是焚身");
            if (hp.armor > 0.01f) Fail("化焚身后鳞甲还在（应炸飞）");
            if (!heart || !heart.Active || !heart.weakpoint) Fail("焚身的胸口火心没有作为弱点启用");
            if (boss.Transitioning) Fail("换形演出没有结束");
            if (hp.untargetable) Fail("换形结束后仍不可选中");
            var root = boss.Model?.root;
            if (root && root.transform.localPosition.sqrMagnitude > 0.01f) Fail($"换形结束后模型还有偏移 {root.transform.localPosition}");
            Shot(weapons.eye, "qilin_burn");
        }

        IEnumerator BurnMoves()
        {
            foreach (var id in new[] { BurnPlaceholderStomp.MoveId, BurnPlaceholderBreath.BurnMoveId })
            {
                if (!boss || boss.Dead) yield break;
                var m = boss.MoveById(id);
                if (m == null)
                {
                    Fail($"焚身没有占位招式 {id}");
                    continue;
                }
                yield return OneMove(m, id == BurnPlaceholderBreath.BurnMoveId ? 10f : 14f);
            }
        }

        // ───────────── 击杀 → 结算 ─────────────

        IEnumerator KillCase()
        {
            Guard(false);
            boss.Summons.DespawnAll();
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
                Fail("火麒麟没被打死");
                yield break;
            }
            yield return null;
            Line($"击杀：BossDefeated +{defeatedEvents - defeated0}，阶段 {boss.Phase}，形态 {boss.Form?.id}");
            if (defeatedEvents - defeated0 != 1) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次）");
            var stage = RunPlan.ForScene(Scene);
            bool final = stage != null && RunPlan.IsFinal(stage);
            if (!final) Fail("3-4 不是 RunPlan 的最后一关");
            if (!enc)
            {
                Line("没有 BossEncounter：不查结算");
                yield break;
            }
            float s0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 3f) yield return null;
            yield return null;
            var chest = enc.RewardChest;
            Line($"结算：{enc.State}（{Time.time - s0:F1} s），宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」档位 {chest?.tier}，去向 {enc.Result}，熔铁闸 {(enc.GatesSealed ? "还立着" : "落回去了")}，溃散 {enc.Dispersed} 只");
            if (enc.State != BossEncounter.Phase.Settled) Fail("火麒麟倒下后没有结算");
            if (!chest) Fail("结算没有落首领宝箱");
            if (enc.Result != BossEncounter.Outcome.Victory) Fail($"3-4 打完的去向是 {enc.Result}（最后一关应为胜利链）");
            if (enc.GatesSealed) Fail("结算后熔铁闸没有落回去");
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "qilin_settled");
        }

        // ───────────── 工具 ─────────────

        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
        }

        void SetHealthFraction(float fraction)
        {
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
        }

        /// <summary>玩家站到首领正前方 distance 米（夹进场地、贴到导航网格），对着首领、回满</summary>
        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var spot = arena.Clamp(boss.transform.position + fwd * distance, 2f);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, LavaField.WalkerFilter())) spot = hit.position;
            Place(spot);
            Aim(motor, eye, boss.BodyCenter);
        }

        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
        static bool Finite(float v) => float.IsFinite(v);
        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
