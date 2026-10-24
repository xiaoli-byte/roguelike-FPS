using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领登场演出冒烟（bridge.sh playtest boss-intro [场景]；docs/level-design/boss-intros.md「验收」）。测试开关 <see cref="BossIntroDirector.Policy"/> = Always。
    /// 测试场（默认 TestArena）：四个首领（旱魃、鲲鹏、熔心魔将、火麒麟）各在临时场地上开一场（BossEncounter.Begin）——
    ///   · 完整看一遍（第一次看）：演出期间输入一直锁着（inputEnabled 关 + MotorLock.All）、没开过枪、玩家没掉血、HUD 隐藏、黑边拉出、武器收起、名字卡打出；
    ///     首领生成后一直不可选中、不出招、没有 IntroDone；旁边一只小怪一直待机且不可选中；镜头真的离开过玩家眼睛；
    ///     交接：导演记下的最后一帧相机与 Eye 误差 &lt; 1 cm / 0.5° / 0.1° 视角，CameraFeel 接手后两帧仍在误差内；落地过程单帧位移 / 转角不超过总量 25%（没有硬切）；
    ///     交接后输入解锁、IntroDone 在交还之后、第一招在 IntroDone 之后、抬枪完成（枪模相机复位）、HUD 淡回、黑边收起、小怪恢复、存档记「看过」；
    ///     每镜 60% 处和交接后各存一张关键帧（相机渲染 + 帧末抓屏含黑边 / 名字卡，Assets/Art/_Review/playtest_intro_*）。
    ///   · 再看一遍（已看过）：0.3 s 就按跳过 → 立刻接受，同样平滑落回（同一套交接 / 连续性检查）。
    ///   · 首看锁（魔将，清掉「看过」）：0.5 s 时跳过被拒，1.5 s 之后接受。
    ///   · 打断：旱魃演出中把首领关物体删掉（= 场景卸载）→ 镜头交还、输入解锁、HUD / 黑边 / 枪模 / 时间缩放都复原；火麒麟演出中玩家阵亡 → 同样复原（输入保持关闭）、复活后输入回来。
    /// 关卡场景（L1_4_Crescent / L2_4_Beiming / L3_3_Foundry / L3_4_Zhurong）：用场景里等着的那场首领战完整看一遍（真实地形下的镜头 + 同样的检查），不测跳过 / 打断。
    /// 跑完把测试开关和各首领「看过」的存档恢复原样。
    /// </summary>
    public sealed class BossIntroSuite : PlaytestSuite
    {
        public override string Id => "boss-intro";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        static readonly string[] BossIds = { HanbaDef.Id, KunPengDef.Id, WarlordDef.Id, QilinDef.Id };
        /// <summary>交接误差上限：位置（米）、角度（度）、视角（度）</summary>
        const float PosTol = 0.01f, AngTol = 0.5f, FovTol = 0.1f;
        /// <summary>落地时单帧位移 / 转角最多占总量的比例（硬切 = 100%）；按帧时间折算的比值上限（平滑 ≈ 1，硬切几十）</summary>
        const float StepShare = 0.25f, StepRatioMax = 2.5f;

        enum Mode { Full, Skip, FirstViewLock }

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        CameraFeel feel;
        Camera cam;
        Transform eye;
        readonly Dictionary<string, bool> seenBefore = new();
        int fired, logErrors, movesBeforeIntro, movesAfterIntro;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            feel = vitals ? vitals.GetComponent<CameraFeel>() : null;
            if (!weapons || !motor || !vitals || !feel || !motor.eye)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} feel={feel}（场景不是 TestArena / 关卡？）");
                yield break;
            }
            cam = feel.cam ? feel.cam : weapons.eye;
            eye = motor.eye;
            // 不开 WeaponController.TestMode：测试模式下武器绕过输入锁，「演出期间输入锁着」就测不出来
            BossIntroDirector.Policy = BossIntroPolicy.Always;
            Application.logMessageReceived += OnLog;
            weapons.Fired += OnFired;
            vitals.stats.Add("playtest_boss_intro", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            EnemyRegistry.PurgeAll();
            RunState.Ensure();
            var log = BossIntroLog.Current;
            foreach (var id in BossIds) seenBefore[id] = log.Seen(id);

            CheckScripts();
            var waiting = FindObjectsByType<BossEncounter>(FindObjectsInactive.Include, FindObjectsSortMode.None)
                .Where(e => e && e.State == BossEncounter.Phase.Waiting).ToList();
            if (waiting.Count > 0)
            {
                Line($"关卡模式：场景里有 {waiting.Count} 场等着开打的首领战（{string.Join("、", waiting.Select(e => e.bossId))}），各完整看一遍");
                foreach (var e in waiting) yield return LevelCase(e);
            }
            else
            {
                Line("测试场模式：四个首领各在临时场地上看一遍 + 跳过一遍，另测首看锁与打断恢复");
                foreach (var id in BossIds) yield return ArenaCase(id, Mode.Full);
                foreach (var id in BossIds) yield return ArenaCase(id, Mode.Skip);
                yield return ArenaCase(WarlordDef.Id, Mode.FirstViewLock);
                yield return InterruptCase(HanbaDef.Id, false);
                yield return InterruptCase(QilinDef.Id, true);
            }

            foreach (var (id, was) in seenBefore)
                if (was) log.MarkSeen(id);
                else log.Forget(id);
            BossIntroDirector.Policy = BossIntroPolicy.Auto;
            if (vitals.Dead) vitals.Revive();
            vitals.stats.Remove("playtest_boss_intro");
            weapons.Fired -= OnFired;
            Application.logMessageReceived -= OnLog;
            Line($"合计：开过 {BossIntroDirector.Played} 段演出，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnFired(WeaponInstance w) => fired++;

        void OnBossMove(BossBrain b, BossMove m)
        {
            if (b.IntroDone) movesAfterIntro++;
            else movesBeforeIntro++;
        }

        static string Short(string bossId) => bossId.StartsWith("boss_") ? bossId.Substring(5) : bossId;

        // ───────────── 脚本自检 ─────────────

        void CheckScripts()
        {
            foreach (var id in BossIds)
            {
                var s = BossIntroScript.For(id);
                var def = Bosses.Get(id);
                if (s == null || s.Id != id)
                {
                    Fail($"{id} 没有专属登场演出（拿到的是 {s?.Id ?? "null"}）");
                    continue;
                }
                var problems = s.Validate();
                Line($"脚本 {id}：{s.shots.Count} 镜（{string.Join(" → ", s.shots.Select(x => $"{x.name} {x.seconds:F1}s"))}）+ 落地 {s.landSeconds:F1}s = {s.Seconds:F1}s，" +
                     $"{s.spawnAt:F1}s 生成（首领自己的登场 {def?.intro.seconds ?? 0:F1}s），事件 {s.cues.Count} 个{(problems.Count > 0 ? "，问题：" + string.Join("；", problems) : " ✓")}");
                if (problems.Count > 0) Fail($"{id} 的演出脚本自检不过：{string.Join("；", problems)}");
                if (s.Seconds < 6f || s.Seconds > 10f) Fail($"{id} 的演出 {s.Seconds:F1}s 不在 6–10 s");
            }
        }

        // ───────────── 一场 ─────────────

        sealed class Rec
        {
            public int frames, unlockedFrames, bossTargetable, minionActive, minionTargetable, shots;
            public bool hudHidden, bars, weaponHidden, introDoneEarly, bossActing, skipAccepted, lockRefused, lateAccepted;
            public float maxAway, damage0;
            public string caption;
            public int fired0;
        }

        IEnumerator ArenaCase(string id, Mode mode)
        {
            string tag = Short(id) + (mode == Mode.Full ? "" : "_" + mode.ToString().ToLowerInvariant());
            var root = new GameObject($"Boss Intro Test · {id} · {mode}");
            var basis = BossArena.Find(ProxyBossDef.Id);
            var center = basis ? basis.Center : Vector3.zero;
            float radius = basis ? Mathf.Max(16f, basis.Extent) : 18f;
            var fwd = basis ? basis.transform.forward : Vector3.forward;
            var arena = BossArena.CreateRuntime(center, radius, fwd, id, root.transform);
            var enc = MakeEncounter(id, arena, root.transform);
            Place(arena);
            var log = BossIntroLog.Current;
            if (mode == Mode.Skip) log.MarkSeen(id);
            else log.Forget(id);
            EnemyAI minion = null;
            if (mode == Mode.Full)
            {
                var side = Vector3.Cross(Vector3.up, Flat(arena.BossSpawnPoint - arena.PlayerEntryPoint));
                minion = EnemyRoster.Spawn("jerboa_blade", arena.PlayerEntryPoint + side * 6f, Quaternion.identity, 1, false);
            }
            // 小怪出生（0.7 s，出生中本来就不可选中）先走完，开演时它已经是可选中的普通状态
            yield return new WaitForSeconds(mode == Mode.Full ? 1.0f : 0.2f);
            float s0 = Time.time;
            while (minion && !minion.Dead && (minion.State == "spawn" || minion.Health.untargetable) && Time.time - s0 < 3f) yield return null;
            yield return RunIntro(enc, tag, mode, minion);
            if (minion) Destroy(minion.gameObject);
            Cleanup(root);
            yield return null;
            // 首领物体这一帧已经销毁：再清掉它开打后召出来的爪牙（首领还活着时清场会走倒下流程、留下溃散慢动作）
            EnemyRegistry.PurgeAll();
            yield return null;
        }

        IEnumerator LevelCase(BossEncounter enc)
        {
            // 3-3 的领主战要先肃清铸坊：冒烟直接解锁（同 boss-warlord）
            var lordGate = FindAnyObjectByType<FoundryLordGate>();
            if (lordGate && lordGate.encounter == enc) lordGate.Unlock(false);
            if (!enc.gameObject.activeInHierarchy) enc.gameObject.SetActive(true);
            // 同测试场：套件开战之前停着，免得玩家一传送到入场点就被门槛触发
            enc.enabled = false;
            var arena = enc.arena ? enc.arena : BossArena.Find(enc.bossId, enc.transform.position);
            if (!arena)
            {
                Fail($"{enc.bossId}：场景里的首领战没有场地");
                yield break;
            }
            enc.arena = arena;
            Place(arena);
            BossIntroLog.Current.Forget(enc.bossId);
            yield return new WaitForSeconds(0.3f);
            yield return RunIntro(enc, Short(enc.bossId) + "_level", Mode.Full, null);
            if (enc.Boss && !enc.Boss.Dead) Destroy(enc.Boss.gameObject);
            GameUI.SetBoss(null);
            yield return null;
        }

        BossEncounter MakeEncounter(string id, BossArena arena, Transform parent)
        {
            var go = new GameObject("Boss Encounter (intro test)");
            go.transform.SetParent(parent, false);
            go.transform.position = arena.Center;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = id;
            enc.arena = arena;
            enc.difficulty = 1f;
            enc.warnSeconds = 2.5f;
            // 先停着：玩家一传送进场地，首领关自己的 Update 就会在门槛上开战，演出会在套件开始盯之前就跑起来（关键帧、计时全错位）
            enc.enabled = false;
            return enc;
        }

        /// <summary>由套件开战（首领关在这之前一直停用，不会被门槛提前触发）</summary>
        static void BeginEncounter(BossEncounter enc)
        {
            enc.enabled = true;
            enc.Begin();
        }

        void Place(BossArena arena)
        {
            if (vitals.Dead) vitals.Revive();
            Teleport(motor, arena.PlayerEntryPoint);
            Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
        }

        void Cleanup(GameObject root)
        {
            if (root) Destroy(root);
            GameUI.SetBoss(null);
            GameUI.SetObjective("");
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-4f ? v.normalized : Vector3.forward;
        }

        /// <summary>开一场演出、从头盯到收尾，按 mode 加跳过 / 首看锁</summary>
        IEnumerator RunIntro(BossEncounter enc, string tag, Mode mode, EnemyAI minion)
        {
            string id = enc.bossId;
            var rec = new Rec { damage0 = Runner.playerDamage, fired0 = fired };
            movesBeforeIntro = movesAfterIntro = 0;
            if (enc.State != BossEncounter.Phase.Waiting)
            {
                Fail($"{id}：套件开战之前首领关已经是 {enc.State}（被门槛提前触发？）");
                yield break;
            }
            BeginEncounter(enc);
            var d = enc.Intro;
            if (!d)
            {
                Fail($"{id}：开战没有开演出（Policy={BossIntroDirector.Policy}，状态 {enc.State}）");
                yield break;
            }
            var script = d.Script;
            Line($"{id} · {mode}：开演「{script.Id}」，计划 {script.Seconds:F1}s，{(d.SeenBefore ? "看过" : "第一次看")}");
            if (script.Id != id) Fail($"{id} 用的是演出「{script.Id}」，不是专属的");
            BossBrain boss = null;
            var shotTaken = new HashSet<int>();
            int lastShot = -1;
            bool skipTried = false;
            float t0 = Time.time;
            // 交还后收尾动画已经播完的话，导演在交还的下一帧就自毁了：这里只认 Released / EndReason（托管字段，物体销毁后照样能读），不拿「d 还在不在」当交还
            while (!d.Released && Time.time - t0 < script.Seconds + 8f)
            {
                yield return null;
                if (d.Released) break;
                rec.frames++;
                if (motor.inputEnabled || !motor.Frame.Locked(MotorLock.All)) rec.unlockedFrames++;
                if (GameUI.HudHidden) rec.hudHidden = true;
                if (d.Overlay != null && d.Overlay.Bars > 0.9f) rec.bars = true;
                if (d.Overlay != null && d.Overlay.CaptionVisible) rec.caption = d.Overlay.CaptionTitle;
                if (d.ViewmodelCamera && d.Elapsed > 0.4f && !d.ViewmodelCamera.enabled) rec.weaponHidden = true;
                rec.maxAway = Mathf.Max(rec.maxAway, Vector3.Distance(cam.transform.position, eye.position));
                if (!boss && enc.Boss)
                {
                    boss = enc.Boss;
                    boss.MoveStarted += OnBossMove;
                }
                if (boss && !boss.Dead)
                {
                    if (!boss.Health.untargetable) rec.bossTargetable++;
                    if (boss.IntroDone) rec.introDoneEarly = true;
                    if (boss.Current != null) rec.bossActing = true;
                }
                if (minion && !minion.Dead && d.Elapsed > 0.3f)
                {
                    if (minion.State != EnemyAI.IdleState) rec.minionActive++;
                    if (!minion.Health.untargetable) rec.minionTargetable++;
                }
                if (d.ShotIndex != lastShot)
                {
                    if (mode == Mode.Full) Line($"  {d.Elapsed:F2}s 第 {d.ShotIndex + 1} 镜 {d.ShotName}（{d.Phase}）");
                    lastShot = d.ShotIndex;
                }
                // 关键帧：每镜 60% 处
                if (mode == Mode.Full && d.Phase == BossIntroDirector.Stage.Shots && d.ShotIndex >= 0 && !shotTaken.Contains(d.ShotIndex))
                {
                    var shot = script.shots[d.ShotIndex];
                    if (d.Elapsed - script.ShotStart(d.ShotIndex) >= shot.seconds * 0.6f)
                    {
                        shotTaken.Add(d.ShotIndex);
                        rec.shots++;
                        yield return Snapshot($"intro_{tag}_{d.ShotIndex + 1}_{shot.name}");
                    }
                }
                if (mode == Mode.Skip && !skipTried && d.RealElapsed >= 0.3f)
                {
                    skipTried = true;
                    rec.skipAccepted = d.RequestSkip();
                    Line($"  {d.RealElapsed:F2}s 按跳过：{(rec.skipAccepted ? "✓ 接受" : "✗ 被拒")}（看过 {d.SeenBefore}）");
                }
                if (mode == Mode.FirstViewLock)
                {
                    if (!skipTried && d.RealElapsed >= 0.5f)
                    {
                        skipTried = true;
                        rec.lockRefused = !d.CanSkip && !d.RequestSkip();
                        Line($"  第一次看，{d.RealElapsed:F2}s 按跳过：{(rec.lockRefused ? "✓ 被拒" : "✗ 居然接受了")}");
                    }
                    if (skipTried && !rec.lateAccepted && d.RealElapsed >= BossIntroDirector.FirstViewLock + 0.1f)
                    {
                        rec.lateAccepted = d.RequestSkip();
                        Line($"  {d.RealElapsed:F2}s 再按跳过：{(rec.lateAccepted ? "✓ 接受" : "✗ 被拒")}");
                    }
                }
            }
            bool handedBack = d.Released && d.EndReason is "done" or "skipped";
            if (!handedBack)
            {
                Fail($"{id}：演出 {Time.time - t0:F1}s 内没有正常交还镜头（{(d.Released ? "被打断" : "还在播")}：{d.EndReason ?? "-"}，演出第 {d.Elapsed:F2}s，{d.Phase} {d.ShotName}）");
                yield break;
            }
            float relAt = Time.time;
            bool boundBoss = boss;

            // ── 演出期间 ──
            float dmg = Runner.playerDamage - rec.damage0;
            Line($"  演出期间：{rec.frames} 帧，输入锁着 {(rec.unlockedFrames == 0 ? "✓" : $"✗ {rec.unlockedFrames} 帧没锁")}，开枪 {fired - rec.fired0} 次，掉血 {dmg:F0}，" +
                 $"HUD 隐藏 {(rec.hudHidden ? "✓" : "✗")}，黑边 {(rec.bars || mode != Mode.Full ? "✓" : "✗")}，武器收起 {(rec.weaponHidden || !d.ViewmodelCamera ? "✓" : "✗")}，" +
                 $"镜头最远离开眼睛 {rec.maxAway:F1} m，名字卡「{rec.caption}」，切镜 {d.Cuts} 次，关键帧 {rec.shots} 张");
            if (rec.unlockedFrames > 0) Fail($"{id}：演出期间有 {rec.unlockedFrames} 帧输入没锁");
            if (fired != rec.fired0) Fail($"{id}：演出期间开了枪");
            if (dmg > 0.01f) Fail($"{id}：演出期间玩家掉了 {dmg:F0} 血");
            if (!rec.hudHidden) Fail($"{id}：演出期间 HUD 没隐藏");
            if (mode == Mode.Full)
            {
                if (!rec.bars) Fail($"{id}：没有拉出上下黑边");
                if (d.ViewmodelCamera && !rec.weaponHidden) Fail($"{id}：第一人称武器没收起");
                if (string.IsNullOrEmpty(rec.caption)) Fail($"{id}：没打名字卡");
                if (rec.maxAway < 3f) Fail($"{id}：镜头几乎没离开玩家眼睛（最远 {rec.maxAway:F1} m）");
                if (d.Cuts < script.shots.Count - 1) Fail($"{id}：镜头表 {script.shots.Count} 镜只切了 {d.Cuts} 次");
            }
            if (!boundBoss) Fail($"{id}：演出里首领没生成");
            Line($"  首领：演出中可选中 {rec.bossTargetable} 帧，提前 IntroDone {(rec.introDoneEarly ? "✗" : "✓ 没有")}，出过招 {(rec.bossActing ? "✗" : "✓ 没有")}" +
                 (minion ? $"；小怪：动了 {rec.minionActive} 帧、可选中 {rec.minionTargetable} 帧" : ""));
            if (rec.bossTargetable > 0) Fail($"{id}：演出期间首领可以被选中");
            if (rec.introDoneEarly) Fail($"{id}：镜头还没交还首领就结束了登场");
            if (rec.bossActing) Fail($"{id}：演出期间首领出招了");
            if (minion && rec.minionActive > 0) Fail($"{id}：演出期间小怪没有待机（{rec.minionActive} 帧）");
            if (minion && rec.minionTargetable > 0) Fail($"{id}：演出期间小怪可以被选中");
            if (mode == Mode.Skip && !rec.skipAccepted) Fail($"{id}：看过的演出 0.3 s 按跳过被拒");
            if (mode == Mode.FirstViewLock && !rec.lockRefused) Fail($"{id}：第一次看 0.5 s 就能跳过（应先看满 {BossIntroDirector.FirstViewLock} s）");
            if (mode == Mode.FirstViewLock && !rec.lateAccepted) Fail($"{id}：第一次看满 {BossIntroDirector.FirstViewLock} s 后跳过仍被拒");
            if (mode != Mode.Full && !d.Skipped) Fail($"{id}：跳过之后导演不是跳过状态");

            // ── 交接 ──
            float stepShare = d.LandDistance > 1f ? d.LandMaxStep / d.LandDistance : 0;
            float turnShare = d.LandAngle > 5f ? d.LandMaxTurn / d.LandAngle : 0;
            Line($"  交接（{d.EndReason}）：最后一帧相机 − Eye = {d.HandoffMeters * 100f:F3} cm / {d.HandoffDegrees:F3}° / 视角差 {d.HandoffFov:F3}°；" +
                 $"落地 {d.LandDistance:F1} m、{d.LandAngle:F0}°，单帧最大 {d.LandMaxStep:F2} m（{stepShare:P0}）/ {d.LandMaxTurn:F1}°（{turnShare:P0}），" +
                 $"按帧时间折算 {d.LandStepRatio:F2} / {d.LandTurnRatio:F2}（≤ {StepRatioMax}，硬切是几十）");
            if (!(d.HandoffMeters < PosTol) || !(d.HandoffDegrees < AngTol) || !(d.HandoffFov < FovTol))
                Fail($"{id}：交接误差超标（{d.HandoffMeters * 100f:F2} cm / {d.HandoffDegrees:F2}° / {d.HandoffFov:F2}°）");
            // 编辑器偶尔卡一帧（dt 很大）时单帧占比会变大：以按帧时间折算的比值为准，占比只在两者都超时才算跳变
            bool jump = d.LandStepRatio > StepRatioMax || d.LandTurnRatio > StepRatioMax;
            if (jump && (stepShare > StepShare || turnShare > StepShare))
                Fail($"{id}：落回第一人称有跳变（单帧 {stepShare:P0} / {turnShare:P0}，折算 {d.LandStepRatio:F1} / {d.LandTurnRatio:F1}）");
            yield return null;
            yield return null;
            float pe = Vector3.Distance(cam.transform.position, eye.position), ae = Quaternion.Angle(cam.transform.rotation, eye.rotation),
                fe = Mathf.Abs(cam.fieldOfView - feel.Fov);
            bool inputBack = motor.inputEnabled && !motor.Frame.Locked(MotorLock.All);
            Line($"  CameraFeel 接手两帧后：相机 − Eye = {pe * 100f:F3} cm / {ae:F3}° / 视角差 {fe:F3}°，输入 {(inputBack ? "✓ 解锁" : "✗ 还锁着")}");
            if (pe >= PosTol || ae >= AngTol || fe >= FovTol) Fail($"{id}：CameraFeel 接手后相机偏离 Eye（{pe * 100f:F2} cm / {ae:F2}° / {fe:F2}°）");
            if (!inputBack) Fail($"{id}：交接后输入没解锁");

            // ── 首领开打 ──
            if (boss)
            {
                // 完整看完时首领自己的登场早就播完了，交还后下一帧就 IntroDone；跳过得早时它的登场动作（砸落、跃出）还要播完
                float i0 = Time.time, wait = mode == Mode.Full ? 1.5f : (boss.Def?.intro.seconds ?? 3f) + 1f;
                while (boss && !boss.Dead && !boss.IntroDone && Time.time - i0 < wait) yield return null;
                bool done = boss && boss.IntroDone;
                float doneAfter = Time.time - relAt;
                bool targetable = boss && !boss.Health.untargetable;
                float firstWait = Time.time;
                while (boss && !boss.Dead && movesAfterIntro == 0 && Time.time - firstWait < 3f) yield return null;
                Line($"  开打：IntroDone {(done ? $"✓ 交还后 {doneAfter:F2}s" : "✗ 没有")}，可选中 {(targetable ? "✓" : "✗")}，" +
                     $"IntroDone 之前出招 {movesBeforeIntro} 次、之后 {movesAfterIntro} 次（第一招在 IntroDone 后 {Time.time - firstWait:F1}s 内）");
                if (!done) Fail($"{id}：镜头交还后首领迟迟没有结束登场");
                if (movesBeforeIntro > 0) Fail($"{id}：首领在 IntroDone 之前出了招");
                if (boss) boss.MoveStarted -= OnBossMove;
            }

            // ── 收尾：抬枪、黑边、HUD ──
            float o0 = Time.time;
            while (d && Time.time - o0 < 2.5f) yield return null;
            var vm = d ? d.ViewmodelCamera : FindViewmodelCamera();
            bool vmOk = !vm || (vm.enabled && vm.transform.localRotation == Quaternion.identity && vm.transform.localPosition == Vector3.zero);
            yield return new WaitForSecondsRealtime(0.5f);
            float hud = HudOpacity();
            bool overlayGone = !HasCinematicLayer();
            Line($"  收尾：导演退场 {(!d ? "✓" : "✗")}，枪模相机复位 {(vmOk ? "✓" : "✗")}，HUD 不透明度 {hud:F2}，黑边 / 名字卡移除 {(overlayGone ? "✓" : "✗")}，" +
                 $"存档记「看过」{(BossIntroLog.Current.Seen(id) ? "✓" : "✗")}");
            if (d) Fail($"{id}：收尾动画 2.5 s 后导演还在");
            if (!vmOk) Fail($"{id}：第一人称武器没抬回来（枪模相机没复位）");
            if (hud >= 0 && hud < 0.9f) Fail($"{id}：HUD 没淡回来（{hud:F2}）");
            if (!overlayGone) Fail($"{id}：黑边 / 名字卡没移除");
            if (GameUI.HudHidden) Fail($"{id}：HudHidden 还开着");
            if (!BossIntroLog.Current.Seen(id)) Fail($"{id}：看完没记进存档");
            if (minion && !minion.Dead)
            {
                float m0 = Time.time;
                while (minion && minion.State == EnemyAI.IdleState && Time.time - m0 < 1.5f) yield return null;
                bool back = minion && !minion.Health.untargetable;
                Line($"  小怪恢复：可选中 {(back ? "✓" : "✗")}，状态 {(minion ? minion.State : "?")}");
                if (!back) Fail($"{id}：演出结束后小怪还不可选中");
            }
            if (mode == Mode.Full) yield return Snapshot($"intro_{tag}_handoff");
        }

        /// <summary>打断：删掉首领关物体（= 场景卸载）或玩家阵亡，检查一切复原</summary>
        IEnumerator InterruptCase(string id, bool playerDeath)
        {
            string what = playerDeath ? "玩家阵亡" : "场景卸载（删掉首领关物体）";
            var root = new GameObject($"Boss Intro Test · {id} · interrupt");
            var basis = BossArena.Find(ProxyBossDef.Id);
            var arena = BossArena.CreateRuntime(basis ? basis.Center : Vector3.zero, basis ? Mathf.Max(16f, basis.Extent) : 18f,
                basis ? basis.transform.forward : Vector3.forward, id, root.transform);
            var enc = MakeEncounter(id, arena, root.transform);
            Place(arena);
            yield return new WaitForSeconds(0.2f);
            BeginEncounter(enc);
            var d = enc.Intro;
            if (!d)
            {
                Fail($"打断（{what}）：没开演出");
                Cleanup(root);
                yield break;
            }
            float t0 = Time.time;
            // 等到首领生成、慢动作 / 模型位移这些都可能在生效的时候
            while (d && !d.Released && d.Elapsed < d.Script.spawnAt + 0.6f && Time.time - t0 < 8f) yield return null;
            int ended = 0;
            void OnEnded(BossIntroDirector x) => ended++;
            BossIntroDirector.Ended += OnEnded;
            if (playerDeath)
            {
                vitals.invulnerableUntil = -1;
                motor.ClearInvulnerability();
                vitals.TakeDamage(vitals.health + vitals.shield + 99999f, vitals.transform.position + Vector3.forward);
            }
            else Destroy(enc.gameObject);
            yield return null;
            yield return null;
            yield return null;
            BossIntroDirector.Ended -= OnEnded;
            float scale = TimeScaleArbiter.Current;
            var vm = FindViewmodelCamera();
            bool vmOk = !vm || (vm.enabled && vm.transform.localRotation == Quaternion.identity);
            float pe = Vector3.Distance(cam.transform.position, eye.position);
            bool inputOk = playerDeath ? !motor.inputEnabled : motor.inputEnabled;
            // 阵亡时 GameSession 自己有阵亡慢动作（0.3），时间缩放复活后再查
            bool scaleOk = playerDeath || Mathf.Approximately(scale, 1f);
            bool ok = !BossIntroDirector.Current && ended == 1 && !GameUI.HudHidden && !HasCinematicLayer() && vmOk && scaleOk && inputOk && (playerDeath || pe < 0.05f);
            Line($"打断 · {id} · {what}：导演交还 {(!BossIntroDirector.Current ? "✓" : "✗")}（Ended ×{ended}），HUD {(!GameUI.HudHidden ? "✓" : "✗")}，" +
                 $"黑边 {(!HasCinematicLayer() ? "✓ 移除" : "✗ 还在")}，枪模相机 {(vmOk ? "✓" : "✗")}，时间缩放 {scale:F2}，" +
                 $"输入 {(motor.inputEnabled ? "开" : "关")}（应{(playerDeath ? "关：已阵亡" : "开")}），相机离 Eye {pe * 100f:F1} cm");
            if (!ok) Fail($"打断（{what}）后没有完全复原");
            if (playerDeath)
            {
                vitals.Revive();
                GameUI.SetCenterText(null);
                UnityEngine.Cursor.lockState = CursorLockMode.Locked;
                yield return null;
                yield return null;
                float s2 = TimeScaleArbiter.Current;
                Line($"  复活后输入 {(motor.inputEnabled ? "✓ 开" : "✗ 关")}，时间缩放 {s2:F2}");
                if (!motor.inputEnabled) Fail("演出中阵亡、复活后输入没回来");
                if (!Mathf.Approximately(s2, 1f)) Fail($"演出中阵亡、复活后时间缩放没回到 1（{s2:F2}）");
            }
            Cleanup(root);
            yield return null;
            EnemyRegistry.PurgeAll();
            yield return null;
        }

        // ───────────── 工具 ─────────────

        Camera FindViewmodelCamera()
        {
            if (!cam) return null;
            foreach (var c in cam.GetComponentsInChildren<Camera>(true))
                if (c != cam && (c.cullingMask & (1 << Layers.FirstPerson)) != 0)
                    return c;
            return null;
        }

        static float HudOpacity()
        {
            var ui = UIRoot.Instance;
            var c = ui ? ui.Layer(UILayer.Hud)?.Q("hud-hud") : null;
            return c != null ? c.resolvedStyle.opacity : -1f;
        }

        static bool HasCinematicLayer()
        {
            var ui = UIRoot.Instance;
            return ui && ui.Layer(UILayer.Overlay)?.Q("cinematic") != null;
        }

        /// <summary>关键帧：主相机渲染一张（不含 UI Toolkit），帧末再抓一次屏（含黑边、名字卡）存 _ui</summary>
        IEnumerator Snapshot(string name)
        {
            if (string.IsNullOrEmpty(ShotDir) || !cam) yield break;
            Runner.Shot(cam, name);
            yield return UICapture.CaptureScreen(Path.Combine(ShotDir, $"playtest_{name}_ui.png"), Line);
        }
    }
}
