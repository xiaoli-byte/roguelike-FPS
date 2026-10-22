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
    /// 旱魃冒烟（BS1，bridge.sh playtest boss-hanba；场景 1-4 干涸月牙泉）：
    ///   · 定义：自检、血条刻度 = 两道阶段阈值（60% / 30%）、1-4 难度下的定档；
    ///   · 开战：玩家走到场地入场点 → BossEncounter 登场预警 → 旱魃登场（不可选中）→ 登场结束；模型来源（美术 / 代理 / 占位）、日轮来源、悬浮高度、日晒组件；
    ///     场景没重建（没有 BossEncounter）时在场地上直接刷一只，记一行提示；
    ///   · 日晒与荫蔽（旱魃原地硬直、不出招）：
    ///       光柱里站 2 s → 叠层、掉血；同一处浅水里叠层速度减半（增益 = 原增益 × 0.5）；走进影子 4 s → 清零；
    ///       头顶临时压一块岩板（真实遮挡）→ 光柱判定立刻变暗；日轮直射：同距离空地上照得到，躲到岩岛背后（日轮—岩岛—玩家一线）就被挡住；
    ///   · 招式：一阶段三招各强制出一次——走到出手、正常收招、画过预警、出招中霸体、收招段泉珠露出（弱点打开）；
    ///       日轮扫射扫满 110°，旱风放出热浪，召沙魇排进 3 只、生成后全部染成沙魇（「沙魇·」前缀、着色通道）；动作走的是 act_ 触发器还是交叉淡入；
    ///   · 召唤物：崩解后散沙；
    ///   · 阶段：生命层降到 59% → BossPhase(1)、转换中不可选中、结束后节奏变快（扫射前摇比一阶段短，沙魇 4 只——BS2 之前的占位）；
    ///   · 90 s 浸泡（二阶段，首领不掉血）：不出场地、数值有限、招式不卡死、召唤不超上限、至少出过两种招、日晒判定在跑；
    ///   · 击杀 → 溃散 → 结算：首领宝箱（首领档）、回满、出口升起（1-4 不是最后一关 → 下一关）；倒下后日晒判定停。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class HanbaSuite : PlaytestSuite
    {
        public override string Id => "boss-hanba";
        /// <summary>1-4 干涸月牙泉（与编辑器里 Level_1_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";

        const float SoakSeconds = 90f, MoveTimeout = 14f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossEncounter enc;
        HanbaBrain boss;
        System.IDisposable bossGuard;
        int logErrors, spawnedEvents, defeatedEvents;
        /// <summary>玩家累计吃到的火伤（日晒跳伤是火元素）</summary>
        float fireTaken;
        string lastError;
        readonly List<int> phaseEvents = new();
        readonly Dictionary<string, float> phase0Wind = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 1-4？先 bridge.sh level 1-4）");
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
            GameEvents.PlayerHit += OnPlayerHit;
            vitals.stats.Add("playtest_hanba", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            CheckDef();
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                bossGuard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
                yield return SunCase();
                yield return EachMove();
                yield return SummonCleanup();
                yield return PhaseCase();
                yield return Soak();
                yield return KillCase();
            }

            bossGuard?.Dispose();
            bossGuard = null;
            vitals.stats.Remove("playtest_hanba");
            GameEvents.BossSpawned -= OnSpawned;
            GameEvents.BossPhase -= OnPhase;
            GameEvents.BossDefeated -= OnDefeated;
            GameEvents.PlayerHit -= OnPlayerHit;
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

        void OnPlayerHit(in PlayerHitEvent e)
        {
            if (e.element == Element.Fire) fireTaken += e.amount;
        }

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
            var def = Bosses.Get(HanbaDef.Id) as HanbaDef;
            if (def == null)
            {
                Fail($"没有登记首领 {HanbaDef.Id}（HanbaDef）");
                return;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"旱魃定义自检：{string.Join("；", errs)}");
            var ticks = def.BarTicks;
            bool ticksOk = ticks.Count == 2 && Mathf.Approximately(ticks[0], HanbaDef.ScorchedAt) && Mathf.Approximately(ticks[1], HanbaDef.RedEarthAt);
            var v = def.VitalsAt(HanbaDef.StageDifficulty);
            Line($"定义：{def.name}（{def.title}），血条刻度 {string.Join(" / ", ticks.Select(t => $"{t:P0}"))} {(ticksOk ? "✓" : "✗")}，难度 {HanbaDef.StageDifficulty} 下 {v}，" +
                 $"招式 {string.Join("、", def.moves.Select(m => m().Id))}；估算击杀用时（参考）按 100 秒伤约 {v.Total / 100f:F0} s");
            if (!ticksOk) Fail("血条刻度不是 60% / 30% 两道阶段阈值");
        }

        // ───────────── 开战 ─────────────

        IEnumerator StartFight()
        {
            enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == HanbaDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(HanbaDef.Id);
            if (!arena)
            {
                Line("场景里没有旱魃的 BossArena（1-4 还没重建？），在玩家前方临时建一个 18 m 的场地");
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 20f, 18f, fwd, HanbaDef.Id);
            }
            int spawned0 = spawnedEvents;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                Place(arena.PlayerEntryPoint);
                Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                Line($"首领关流程：走进入场点 → {enc.State}（{Time.time - t0:F1} s 后首领登场）");
                boss = enc.Boss as HanbaBrain;
                if (!boss) Fail($"BossEncounter 没有刷出旱魃（State {enc.State}，Boss {enc.Boss}）");
            }
            else
            {
                Line(enc ? $"BossEncounter 状态 {enc.State}，直接刷旱魃" : "场景里没有旱魃的 BossEncounter（1-4 还没重建？），直接在场地上刷旱魃");
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(HanbaDef.Id, arena, HanbaDef.StageDifficulty) as HanbaBrain;
                if (!boss) Fail("旱魃生成失败（行为不是 HanbaBrain？）");
            }
            if (!boss) yield break;
            var hp = boss.Health;
            string model = boss.Model == null ? "（没有模型）" : boss.Model.source switch
            {
                BossModelSource.Art => $"美术 {boss.Model.prefab} × {boss.Model.scale}",
                BossModelSource.Proxy => $"代理 {boss.Model.prefab} × {boss.Model.scale}",
                _ => $"占位胶囊 × {boss.Model.scale}",
            };
            Line($"生成：{boss.Title}（{boss.Subtitle}），{hp.maxHealth:F0} 生命 + {hp.maxShield:F0} 护盾（难度 {boss.level:F2}），模型 {model}，日轮 {boss.Ring?.From}，" +
                 $"日晒组件 {(boss.Exposure ? "✓" : "✗")}，BossSpawned +{spawnedEvents - spawned0}");
            if (spawnedEvents - spawned0 != 1) Fail($"BossSpawned 派发了 {spawnedEvents - spawned0} 次（应 1 次）");
            if (!boss.Ring || boss.Ring.From == SunRing.Source.None) Fail("旱魃没有日轮");
            if (!boss.Exposure) Fail("旱魃身上没有日晒判定（SunExposure）");
            yield return null;
            if (!hp.untargetable) Fail("登场期间可以被选中");
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "hanba_intro");
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f) yield return null;
            yield return null;
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - i0:F1} s" : "✗ 没有结束")}，悬浮 {boss.HoverNow:F2} m，之后可选中 {(!hp.untargetable ? "✓" : "✗")}，泉珠 {(boss.WeakExposed ? "露着" : "收着")}");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            if (hp.untargetable) Fail("登场结束后仍不可选中");
            if (!(boss.HoverNow > 0.2f)) Fail($"旱魃没有悬浮（{boss.HoverNow:F2} m）");
            if (boss.WeakExposed) Fail("招式间隙泉珠露着（弱点应只在施法后摇露出）");
        }

        // ───────────── 日晒与荫蔽 ─────────────

        IEnumerator SunCase()
        {
            var ex = boss.Exposure;
            if (!ex) yield break;
            yield return WaitIdle();
            boss.Stagger(14f, "Hit");
            var shaft = SunShaft.All.FirstOrDefault();
            Line($"日晒：穴顶开口 {(shaft ? $"{shaft.name}（穴顶 y = {shaft.CeilingY:F1}）" : "（没有：按露天）")}，太阳方向 {SunShaft.ToSun}，" +
                 $"日轮直射 {ex.ringRange:F0} / {ex.ringBlazeRange:F0} m，浅水 × {ex.waterFactor}");
            // 离日轮够远（平时直射距离 + 4 m）：这一段只看光柱，不混进日轮直射
            float far = ex.ringRange + 4f;
            var lit = FindSpot(p => Lit(p) && FarFromRing(p, far));
            var shade = FindSpot(p => !Lit(p) && FarFromRing(p, far));

            // ── 光柱里：叠层、掉血 ──
            int openStacks = 0;
            if (lit.HasValue)
            {
                Place(lit.Value);
                Aim(motor, eye, lit.Value + SunShaft.ToSun * 10f);
                PlayerStatus.Instance?.ClearAll();
                vitals.Heal(99999);
                float fire0 = fireTaken;
                yield return new WaitForSeconds(2f);
                openStacks = SunExposure.PlayerStacks;
                float lost = fireTaken - fire0;
                Line($"光柱里站 2 s（{At(lit.Value)}）：{openStacks} 层，光柱份额 {ex.LastShaft:F1}、日轮 {ex.LastRing:F1}、增益 {ex.LastGain:F2}，日晒火伤 {lost:F1}（每层每跳 {ex.DamagePerStack:F2}）");
                if (openStacks < 2) Fail($"站在光柱里 2 s 只叠了 {openStacks} 层（应 ≥ 2）");
                if (!(ex.LastShaft > 0.9f)) Fail($"光柱里的光柱份额 {ex.LastShaft}（应 1）");
                if (!(lost > 0)) Fail("日晒叠了层却没有火伤跳出来");
                Shot(weapons.eye, "hanba_sun_shaft");
            }
            else Fail("场地里找不到光柱照得到、又离日轮够远的落脚点（裂缝 / 太阳方向没对上？）");

            // ── 浅水：增益减半 ──
            var water = WaterVolume.All.Where(w => w).Select(w => w.transform.position).ToList();
            Vector3? wet = null;
            foreach (var w in water)
            {
                if (!NavMesh.SamplePosition(w, out var hit, 2f, NavMesh.AllAreas)) continue;
                if (!Lit(hit.position) || !FarFromRing(hit.position, far)) continue;
                wet = hit.position;
                break;
            }
            if (!wet.HasValue && water.Count > 0 && NavMesh.SamplePosition(water[0], out var any, 2f, NavMesh.AllAreas)) wet = any.position;
            if (wet.HasValue)
            {
                Place(wet.Value);
                PlayerStatus.Instance?.ClearAll();
                yield return new WaitForSeconds(2f);
                int wetStacks = SunExposure.PlayerStacks;
                Line($"浅水里站 2 s（{At(wet.Value)}，水深 {WaterVolume.PlayerDepth:F2} m）：{wetStacks} 层（空地 {openStacks}），在水里 {ex.LastInWater}、倍率 {ex.LastWater}、增益 {ex.LastGain:F2} / 原 {ex.LastRaw:F2}");
                if (!ex.LastInWater) Fail("站在浅水里，日晒判定没认出水");
                else if (!Mathf.Approximately(ex.LastGain, ex.LastRaw * ex.waterFactor)) Fail($"浅水里的增益 {ex.LastGain} ≠ 原增益 {ex.LastRaw} × {ex.waterFactor}");
                if (ex.LastRaw > 0.9f && openStacks > 0 && wetStacks >= openStacks) Fail($"浅水里叠层（{wetStacks}）不比空地（{openStacks}）慢");
            }
            else Line("场景里没有浅水（不是 1-4？），跳过浅水");

            // ── 影子里：清零 ──
            if (shade.HasValue)
            {
                if (lit.HasValue)
                {
                    Place(lit.Value);
                    yield return new WaitForSeconds(1.2f);
                }
                int before = SunExposure.PlayerStacks;
                Place(shade.Value);
                yield return new WaitForSeconds(4f);
                int after = SunExposure.PlayerStacks;
                Line($"走进影子 4 s（{At(shade.Value)}）：{before} → {after} 层，增益 {ex.LastGain:F2}");
                if (after > 0) Fail($"躲进影子 4 s 日晒还剩 {after} 层（应清零）");
                if (ex.LastGain > 0) Fail($"影子里还在叠层（增益 {ex.LastGain}）");
                Shot(weapons.eye, "hanba_sun_shade");
            }
            else Line(shaft ? "⚠ 场地里找不到离日轮够远的影子落脚点" : "露天场地没有影子，跳过");

            // ── 真实遮挡：头顶压一块岩板 ──
            if (lit.HasValue)
            {
                Place(lit.Value);
                yield return new WaitForSeconds(0.3f);
                float shaftOpen = ex.LastShaft;
                SunExposure.Probes(out _, out _, out var head);
                var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
                slab.name = "Sun Blocker (test)";
                slab.transform.position = head + SunShaft.ToSun * 3f;
                slab.transform.rotation = Quaternion.FromToRotation(Vector3.up, SunShaft.ToSun);
                slab.transform.localScale = new Vector3(4f, 0.4f, 4f);
                Physics.SyncTransforms();
                yield return new WaitForSeconds(0.3f);
                float shaftBlocked = ex.LastShaft;
                Destroy(slab);
                Line($"头顶压一块岩板（沿日光方向 3 m）：光柱份额 {shaftOpen:F1} → {shaftBlocked:F1}");
                if (shaftBlocked > 0) Fail("挡在日光方向上的岩板没挡住光柱判定");
            }

            // ── 日轮直射与岩岛荫蔽 ──
            yield return RingCover();
            PlayerStatus.Instance?.ClearAll();
            float s0 = Time.time;
            while (boss.Staggered && Time.time - s0 < 15f) yield return null;
        }

        /// <summary>首领挪到岩岛一侧（日轮—岩岛—掩体点一线），玩家先站空地（同距离、侧面）再站岩岛背后的掩体点：日轮份额由满变不满</summary>
        IEnumerator RingCover()
        {
            var ex = boss.Exposure;
            var island = arena.perchPoints?.FirstOrDefault(p => p && p.name.Contains("Island"));
            var cover = arena.coverPoints?.FirstOrDefault(p => p && p.name.Contains("Island"));
            if (!island || !cover)
            {
                Line("场地没有岩岛栖落点 / 掩体点（不是 1-4？），跳过日轮荫蔽");
                yield break;
            }
            var c = island.position;
            var away = cover.position - c;
            away.y = 0;
            if (away.sqrMagnitude < 0.01f) yield break;
            away.Normalize();
            var bossAt = c - away * 6.5f;
            if (NavMesh.SamplePosition(bossAt, out var bh, 3f, NavMesh.AllAreas)) bossAt = bh.position;
            boss.Stagger(6f, "Hit");
            WarpBoss(bossAt, cover.position);
            yield return null;
            float dist = Vector3.Distance(new Vector3(cover.position.x, 0, cover.position.z), new Vector3(bossAt.x, 0, bossAt.z));
            // 这一段只看遮挡：直射距离临时放宽到够得着掩体点，免得「太远」冒充「被挡住」
            float range0 = ex.ringRange;
            ex.ringRange = Mathf.Max(range0, dist + 6f);
            // 空地：同样距离、站到首领侧面（中间没有岩岛）
            var side = Vector3.Cross(Vector3.up, away);
            Vector3? open = null;
            foreach (float s in new[] { 1f, -1f })
            {
                var q = bossAt + side * s * dist;
                if (!NavMesh.SamplePosition(q, out var oh, 2f, NavMesh.AllAreas) || !arena.Contains(oh.position, 1f)) continue;
                Place(oh.position);
                yield return new WaitForSeconds(0.3f);
                if (ex.LastRing > 0.9f)
                {
                    open = oh.position;
                    break;
                }
            }
            float ringOpen = ex.LastRing;
            Place(cover.position);
            yield return new WaitForSeconds(0.3f);
            float ringCovered = ex.LastRing;
            Line($"日轮直射（首领挪到 {At(bossAt)}，离掩体点 {dist:F1} m，直射距离临时放宽到 {ex.RingRange:F1} m）：空地{(open.HasValue ? $" {At(open.Value)}" : "")} 日轮份额 {ringOpen:F1}，" +
                 $"岩岛背后 {At(cover.position)} {ringCovered:F1}");
            ex.ringRange = range0;
            if (ringCovered >= 0.99f) Fail("躲在岩岛背后（日轮—岩岛—玩家一线）仍被日轮整份直射：岩岛没挡住");
            if (!open.HasValue) Line("⚠ 同距离的空地也没被日轮整份照到（距离 / 地形问题），日轮荫蔽只能看岩岛那一侧");
            Shot(weapons.eye, "hanba_ring_cover");
        }

        void WarpBoss(Vector3 p, Vector3 face)
        {
            var agent = boss.GetComponent<NavMeshAgent>();
            boss.transform.position = p;
            if (agent && agent.enabled && agent.isOnNavMesh) agent.Warp(p);
            boss.FaceNow(face);
            var loco = boss.GetComponentInChildren<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        bool Lit(Vector3 ground)
        {
            var chest = ground + Vector3.up * 1.0f;
            var head = ground + Vector3.up * 1.62f;
            return SunExposure.ShaftLit(chest) && SunExposure.ShaftLit(head);
        }

        bool FarFromRing(Vector3 ground, float far) => !boss.Ring || (boss.Ring.Center - (ground + Vector3.up)).sqrMagnitude > far * far;

        /// <summary>场地里（2 m 一格）第一个满足条件、在导航网格上、与场地地面同一层（不是岩岛顶、屋顶）的点；从场地中心往外找</summary>
        Vector3? FindSpot(System.Func<Vector3, bool> ok)
        {
            float r = arena.Extent - 2f;
            var pts = new List<Vector3>();
            for (float x = -r; x <= r; x += 2f)
            for (float z = -r; z <= r; z += 2f)
            {
                var q = arena.Center + new Vector3(x, 0, z);
                if (!arena.Contains(q, 2f)) continue;
                pts.Add(q);
            }
            foreach (var q in pts.OrderBy(q => (q - arena.Center).sqrMagnitude))
            {
                if (!NavMesh.SamplePosition(q, out var hit, 1.5f, NavMesh.AllAreas)) continue;
                if (Mathf.Abs(hit.position.y - arena.FloorY) > 2.2f) continue;
                if (ok(hit.position)) return hit.position;
            }
            return null;
        }

        /// <summary>把玩家放到导航网格点上（不从上往下打射线：月牙阁、悬垂岩体底下也能放进去）</summary>
        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        static string At(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";

        // ───────────── 招式 ─────────────

        IEnumerator EachMove()
        {
            foreach (var move in boss.Moves.ToList())
            {
                if (!boss || boss.Dead) yield break;
                yield return OneMove(move, true);
            }
        }

        IEnumerator OneMove(BossMove move, bool record)
        {
            yield return WaitIdle();
            ReadyPlayer(12f);
            PlayerStatus.Instance?.ClearAll();
            yield return null;
            var hm = move as HanbaMove;
            int warn0 = hm != null ? hm.Warned : move.TelegraphCount, act0 = move.TimesActive, sum0 = boss.Summons.TotalSpawned, acts0 = boss.ActsFired;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 5f) yield return null;
            if (!forced)
            {
                Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                yield break;
            }
            var stages = new List<MoveStage>();
            bool immune = true, shot = false, weakInRecover = false, weakInActive = false;
            var p0 = motor.transform.position;
            float pushed = 0;
            string actPath = null;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!move.stunnable && !boss.StunImmune) immune = false;
                if (move.Stage == MoveStage.Recover && boss.WeakExposed) weakInRecover = true;
                if (move.Stage == MoveStage.Active && boss.WeakExposed) weakInActive = true;
                if (boss.ActsFired > acts0) actPath ??= $"{boss.LastAct}（{boss.LastActPath}）";
                pushed = Mathf.Max(pushed, Vector3.Distance(Flat(motor.transform.position), Flat(p0)));
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active)
                {
                    shot = true;
                    yield return null;
                    Shot(weapons.eye, $"hanba_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            if (move is Phase1SandWraiths)
            {
                float w0 = Time.time;
                while (boss.Summons.PendingCount > 0 && Time.time - w0 < 2.5f) yield return null;
                yield return null;
                yield return null;
            }
            int warned = (hm != null ? hm.Warned : move.TelegraphCount) - warn0, summoned = boss.Summons.TotalSpawned - sum0;
            if (record && hm != null) phase0Wind[move.Id] = hm.WindNow;
            string extra = move switch
            {
                Phase1SunSweep s => $"，落点 {s.Range:F1} m、扫过 {s.Swept:F0}°、灼伤 {s.Hits} 次、被挡 {s.Blocked} 段",
                Phase1HotWind w => $"，热浪 {w.Waves} 道、打中 {(w.HitThisCast ? "✓" : "✗")}、玩家被推开 {pushed:F1} m",
                Phase1SandWraiths sw => $"，排进 {sw.LastQueued} 只、生成 {summoned} 只、染成沙魇 {boss.Summons.Live.Count(e => boss.IsWraith(e) && SandWraith.Is(e))} 只（{string.Join("、", boss.Summons.Live.Select(e => e.Health.displayName))}）",
                _ => "",
            };
            Line($"招式 {move.Name}（{move.Id}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，" +
                 $"前摇 {(hm != null ? hm.WindNow : move.WindupTime):F2} s，预警 {warned} 个，动作 {actPath ?? "（没触发）"}，出招中霸体 {(immune ? "✓" : "✗")}，" +
                 $"后摇泉珠露出 {(weakInRecover ? "✓" : "✗")}{extra}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (warned <= 0) Fail($"招式 {move.Id} 没有画预警");
            if (!immune) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (!weakInRecover) Fail($"招式 {move.Id} 收招段泉珠没有露出");
            if (weakInActive) Fail($"招式 {move.Id} 出手段泉珠就露着了");
            if (actPath == null) Fail($"招式 {move.Id} 没有播动作（HanbaBrain.Act 没被调用）");
            switch (move)
            {
                case Phase1SunSweep s when s.Swept < Phase1SunSweep.Arc - 1f:
                    Fail($"日轮扫射只扫了 {s.Swept:F0}°（应 {Phase1SunSweep.Arc}°）");
                    break;
                case Phase1HotWind w when w.Waves < 1:
                    Fail("旱风没有放出热浪");
                    break;
                case Phase1SandWraiths sw:
                {
                    int want = sw.CountFor(boss);
                    int tinted = boss.Summons.Live.Count(e => boss.IsWraith(e) && SandWraith.Is(e));
                    if (sw.LastQueued < Mathf.Min(want, boss.Summons.Cap)) Fail($"召沙魇只排进 {sw.LastQueued} 只（应 {want}）");
                    if (summoned < sw.LastQueued) Fail($"召沙魇排进 {sw.LastQueued} 只，只生成了 {summoned} 只");
                    if (tinted < summoned) Fail($"生成的 {summoned} 只里只有 {tinted} 只染成了沙魇");
                    break;
                }
            }
            if (boss.Health.untargetable) Fail($"招式 {move.Id} 之后首领不可选中");
        }

        IEnumerator SummonCleanup()
        {
            int live = boss.Summons.Alive, crumbled0 = boss.WraithsCrumbled;
            int n = boss.Summons.DespawnAll();
            yield return null;
            yield return null;
            Line($"沙魇崩解：在场 {live} 只，处决 {n} 只，散沙 {boss.WraithsCrumbled - crumbled0} 只");
            if (boss.WraithsCrumbled - crumbled0 < n) Fail($"沙魇崩解 {n} 只，只散了 {boss.WraithsCrumbled - crumbled0} 团沙");
        }

        // ───────────── 阶段 ─────────────

        IEnumerator PhaseCase()
        {
            yield return WaitIdle();
            var hp = boss.Health;
            int events0 = phaseEvents.Count;
            float pace0 = boss.Pace;
            SetHealthFraction(HanbaDef.ScorchedAt - 0.01f);
            float t0 = Time.time;
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool fired = phaseEvents.Count > events0 && phaseEvents[^1] == 1;
            bool untargetable = boss.Transitioning && hp.untargetable;
            float tr0 = Time.time;
            while (boss.Transitioning && Time.time - tr0 < 6f) yield return null;
            yield return null;
            Line($"越过 {HanbaDef.ScorchedAt:P0}：BossPhase {(fired ? $"✓ → 阶段 {boss.Phase}" : "✗")}，转换中不可选中 {(untargetable ? "✓" : "✗")}，" +
                 $"转换 {Time.time - tr0:F1} s，节奏 {pace0:F2} → {boss.Pace:F2}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!fired) Fail($"生命层降到 {HanbaDef.ScorchedAt - 0.01f:P0} 没有进入二阶段");
            if (!untargetable) Fail("阶段转换中可以被选中");
            if (boss.Transitioning) Fail("阶段转换没有结束");
            if (!(boss.Pace > pace0)) Fail("二阶段的出招节奏没有变快（BS2 之前的占位：一阶段的招式更快）");
            // 占位：扫射前摇比一阶段短，沙魇 4 只
            var sweep = boss.MoveById(Phase1SunSweep.MoveId) as Phase1SunSweep;
            if (sweep != null)
            {
                yield return OneMove(sweep, false);
                float w0 = phase0Wind.TryGetValue(sweep.Id, out var w) ? w : 0;
                Line($"二阶段日轮扫射：前摇 {w0:F2} → {sweep.WindNow:F2} s");
                if (w0 > 0 && !(sweep.WindNow < w0 - 0.05f)) Fail("二阶段的日轮扫射前摇没有比一阶段短");
            }
            var wraithMove = boss.MoveById(Phase1SandWraiths.MoveId) as Phase1SandWraiths;
            if (wraithMove != null && wraithMove.CountFor(boss) != 4) Fail($"二阶段召沙魇应为 4 只（现在 {wraithMove.CountFor(boss)}）");
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            var def = boss.Def;
            var ex = boss.Exposure;
            SetHealthFraction(Mathf.Max(HanbaDef.RedEarthAt + 0.08f, hp.health / hp.maxHealth));
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int sum0 = boss.Summons.TotalSpawned, samples0 = ex ? ex.Samples : 0, exposed0 = ex ? ex.ExposedSamples : 0;
            int maxAlive = 0, badFrames = 0, revives = 0, maxStacks = 0;
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
                    if (NavMesh.SamplePosition(q, out var qh, 3f, NavMesh.AllAreas)) Place(qh.position);
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.shield) || hp.health < 0 || hp.health > hp.maxHealth + 0.01f || hp.shield < 0 || hp.shield > hp.maxShield + 0.01f)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护盾 {hp.shield}/{hp.maxShield}";
                }
                if (Finite(p) && !arena.Contains(p, 0))
                {
                    var flat = p - arena.Center;
                    flat.y = 0;
                    maxOut = Mathf.Max(maxOut, flat.magnitude - arena.Extent);
                }
                maxAlive = Mathf.Max(maxAlive, boss.Summons.Alive + boss.Summons.PendingCount);
                maxStacks = Mathf.Max(maxStacks, SunExposure.PlayerStacks);
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            int samples = ex ? ex.Samples - samples0 : 0, exposed = ex ? ex.ExposedSamples - exposed0 : 0;
            Line($"浸泡 {Time.time - t0:F0} s（阶段 {boss.Phase}）：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，召唤 {boss.Summons.TotalSpawned - sum0} 只（同时最多 {maxAlive}），" +
                 $"最远出界 {maxOut:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次，日晒判定 {samples} 次（晒到 {exposed} 次，最高 {maxStacks} 层），泉珠露出累计 {boss.WeakWindows} 次");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 3f) Fail($"浸泡期间首领跑出场地 {maxOut:F1} m");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (maxAlive > boss.Summons.Cap) Fail($"浸泡期间召唤物同时 {maxAlive} 只，超过上限 {boss.Summons.Cap}");
            if (counts.Count < 2) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
            if (samples < SoakSeconds / SunExposure.Interval * 0.5f) Fail($"浸泡期间日晒只判定了 {samples} 次（应约 {SoakSeconds / SunExposure.Interval:F0} 次）");
            if (maxStacks > SunburnStatus.MaxStacks) Fail($"日晒叠到 {maxStacks} 层，超过上限 {SunburnStatus.MaxStacks}");
        }

        // ───────────── 击杀 → 结算 ─────────────

        IEnumerator KillCase()
        {
            bossGuard?.Dispose();
            bossGuard = null;
            boss.Summons.DespawnAll();
            var hp = boss.Health;
            var ex = boss.Exposure;
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
                Fail("旱魃没被打死");
                yield break;
            }
            yield return null;
            Line($"击杀：BossDefeated +{defeatedEvents - defeated0}，阶段 {boss.Phase}，日晒判定停了 {(ex && !ex.Running ? "✓" : "✗")}，日轮炽度目标 {boss.Ring?.BlazeTarget:F2}");
            if (defeatedEvents - defeated0 != 1) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次）");
            if (ex && ex.Running) Fail("旱魃倒下后日晒判定还在跑");
            if (!enc)
            {
                Line("没有 BossEncounter：不查结算");
                yield break;
            }
            vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
            float s0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 3f) yield return null;
            yield return null;
            bool healed = vitals.health >= vitals.MaxHealth - 0.5f;
            var chest = enc.RewardChest;
            Line($"结算：{enc.State}（{Time.time - s0:F1} s），回满 {(healed ? "✓" : "✗")}，宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」档位 {chest?.tier}，去向 {enc.Result}，溃散 {enc.Dispersed} 只");
            if (enc.State != BossEncounter.Phase.Settled) Fail("旱魃倒下后没有结算");
            if (!healed) Fail("结算没有回满生命");
            if (!chest) Fail("结算没有落首领宝箱");
            else if (chest.tier != ChestTier.Boss) Fail($"首领宝箱档位 {chest.tier}（应为 Boss）");
            if (enc.Result != BossEncounter.Outcome.NextStage) Fail($"1-4 打完的去向是 {enc.Result}（应为下一关）");
            float o0 = Time.time;
            while (!enc.OpenedExit && Time.time - o0 < BossEncounter.PortalDelay + 2f) yield return null;
            Line($"出口：{(enc.OpenedExit ? $"✓ {enc.OpenedExit.name} @ {At(enc.OpenedExit.transform.position)}" : "✗ 没有升起")}");
            if (!enc.OpenedExit) Fail("结算后出口没有升起");
            else Aim(motor, eye, enc.OpenedExit.Focus);
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "hanba_settled");
        }

        // ───────────── 工具 ─────────────

        /// <summary>等首领回到招式间隙（不在出招、转换、硬直里）</summary>
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
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Place(spot);
            Aim(motor, eye, boss.BodyCenter);
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
