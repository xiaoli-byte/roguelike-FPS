using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 4-1 三领主冒烟的底座（第四章移植 B1 路；bridge.sh playtest boss-kui / boss-feilian / boss-huashe，场景 TestArena）：
    ///   · 定义：自检、血条刻度 66% / 33%、4-1 定档、破防条、领主梯度（lordLevel = 4-1、转阶段只出横幅）、登场脚本自检、三档领主的模拟击杀用时都在 60–120 s；
    ///   · 登场 + 据点模式：在临时场地上放一场 BossEncounter（stronghold = true，挂一座灵火坛），测试开关 Always：演出交还第一人称误差 &lt; 1 cm / 0.5°；
    ///   · 招式：每一招强制出一次——走到出手、正常收招、释放帧对齐（释放帧 − 片段出手事件 ≤ 1 帧；预警时长 = 前摇）；
    ///   · 场地机制（各领主自己的：回劈、冲撞撞晕、火龙卷、涨水、湿身导电…）；
    ///   · 破防：破防条满了硬直（破防姿势）、子类的破防反应；
    ///   · 转阶段：跌破 66% / 33% → 转阶段（只出横幅、不接管镜头）；
    ///   · 倒下：领主自己的死亡演出接管镜头、交还误差 &lt; 1 cm、灵火坛点亮、没有立出口、领主梯度记账。
    /// 首领在招式 / 机制段不掉血（Incoming → 0），玩家血量垫高。运行时报错由宿主记不合格。
    /// </summary>
    public abstract class LordSuiteBase : HBeatSuite
    {
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected abstract string BossId { get; }
        protected abstract string Tag { get; }
        /// <summary>测试场里的擂台半径（米，测试场的地面有限）</summary>
        protected virtual float ArenaRadius => 24f;
        /// <summary>节拍条模式：每招按节拍拍照（beats-ch4-lords）</summary>
        protected virtual bool Beats => false;

        protected LordBrain boss;
        protected BossArena arena;
        protected BossEncounter enc;
        protected SpiritAltar altar;
        protected GameObject root;
        protected readonly List<(string evt, float t, int frame)> events = new();
        System.IDisposable guard;
        int logErrors;
        string lastError;

        protected LordDef Def => Bosses.Get(BossId) as LordDef;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            if (!Setup(Tag)) yield break;
            Application.logMessageReceived += OnLog;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            EnemyRegistry.PurgeAll();
            RunState.Ensure();
            ClearLordFlags();
            if (!Beats) CheckDef();
            MakeArena();
            yield return Beats ? SpawnPlain() : IntroCase();
            if (boss && !boss.Dead)
            {
                Guard(true);
                yield return EachMove();
                if (!Beats)
                {
                    yield return Mechanics();
                    yield return BreakCase();
                    yield return PhaseCase(0);
                    yield return PhaseMechanics(1);
                    yield return PhaseCase(1);
                    yield return PhaseMechanics(2);
                }
                yield return KillCase();
            }
            Guard(false);
            Cleanup();
            Application.logMessageReceived -= OnLog;
            BossIntroDirector.Policy = BossIntroPolicy.Auto;
            Teardown(Tag);
            Line($"合计：玩家受伤 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        protected void Guard(bool on)
        {
            guard?.Dispose();
            guard = null;
            if (on && boss && boss.Health) guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
        }

        static void ClearLordFlags()
        {
            var run = RunState.Current;
            if (run?.flags == null) return;
            foreach (var k in run.flags.Keys.Where(k => k.StartsWith("lord.")).ToList()) run.flags.Remove(k);
        }

        // ───────────── 定义 ─────────────

        void CheckDef()
        {
            var d = Def;
            if (d == null)
            {
                Fail($"没有登记 {BossId}");
                return;
            }
            var errs = d.Validate();
            if (errs.Count > 0) Fail($"{BossId} 自检不通过：{string.Join("；", errs)}");
            var ticks = d.BarTicks;
            if (!ticks.SequenceEqual(new[] { 0.66f, 0.33f })) Fail($"血条刻度应为 66% / 33%，现在 {string.Join(" / ", ticks)}");
            if (d.breakBar == null) Fail("没有破防条");
            if (d.lordLevel != LordDef.Level || d.phaseCinematic) Fail($"领主梯度 / 转阶段：lordLevel={d.lordLevel} phaseCinematic={d.phaseCinematic}");
            var script = BossIntroScript.For(BossId);
            if (script == null || script.Id != BossId) Fail("没有专属登场演出");
            else
            {
                var p = script.Validate();
                if (p.Count > 0) Fail($"登场脚本自检：{string.Join("；", p)}");
            }
            var kills = Enumerable.Range(0, 3).Select(d.EstimateKillSeconds).ToArray();
            Line($"定义：{d.name}（{d.title}），4-1 定档 {d.StageHp:F0} 生命，破防条 {d.breakBar?.max:F0}「{d.breakBar?.label}」，招式 {d.moves.Count} 个，" +
                 $"模拟击杀 第 1 / 2 / 3 个打 {string.Join(" / ", kills.Select(k => $"{k:F0} s"))}，登场 {script?.Seconds:F1} s");
            if (kills.Any(k => k < 60f || k > 120f)) Fail("模拟击杀用时不在 60–120 s");
        }

        // ───────────── 场地 ─────────────

        void MakeArena()
        {
            root = new GameObject($"Lord Test · {BossId}");
            var basis = BossArena.Find(ProxyBossDef.Id);
            var center = basis ? basis.Center : Vector3.zero;
            var fwd = basis ? basis.transform.forward : Vector3.forward;
            arena = BossArena.CreateRuntime(center, ArenaRadius, fwd, BossId, root.transform);
            var altarGo = new GameObject("Lord Altar (test)");
            altarGo.transform.SetParent(root.transform, false);
            altarGo.transform.position = arena.Center - fwd * (ArenaRadius * 0.5f) + Vector3.Cross(Vector3.up, fwd) * 5f;
            altar = altarGo.AddComponent<SpiritAltar>();
            PrepareArena();
        }

        /// <summary>摆测试用的场地件（经幡杆、巨石…）</summary>
        protected virtual void PrepareArena() { }

        protected void Place(Vector3 spot, Vector3 look)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Teleport(motor, spot);
            Aim(motor, eye, look);
        }

        /// <summary>玩家站到领主正前方 distance 米</summary>
        protected void Front(float distance)
        {
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            Place(arena.Clamp(boss.transform.position + fwd * distance, 2f), boss.BodyCenter);
        }

        void Cleanup()
        {
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            if (root) Destroy(root);
            foreach (var t in FindObjectsByType<FeilianTornado>(FindObjectsInactive.Exclude)) Destroy(t.gameObject);
            foreach (var s in FindObjectsByType<FeilianSpiral>(FindObjectsInactive.Exclude)) Destroy(s.gameObject);
            foreach (var d in FindObjectsByType<KuiDrum>(FindObjectsInactive.Exclude))
                if (d.Placeholder)
                    Destroy(d.gameObject);
            LightningStrike.ClearAll();
            PlateauStorm.StopAll();
            WindField.Reset();
            GameUI.SetBoss(null);
            GameUI.SetObjective("");
            EnemyRegistry.PurgeAll();
        }

        // ───────────── 生成 / 登场 ─────────────

        IEnumerator SpawnPlain()
        {
            Place(arena.PlayerEntryPoint, arena.BossSpawnPoint + Vector3.up * 3f);
            boss = Bosses.Spawn(BossId, arena, LordDef.StageDifficulty) as LordBrain;
            if (!boss)
            {
                Fail($"{BossId} 没有刷出来");
                yield break;
            }
            Hook();
            float t0 = Time.time;
            while (!boss.IntroDone && Time.time - t0 < boss.Def.intro.seconds + 4f) yield return null;
            if (!boss.IntroDone) Fail("登场没有结束");
            yield return new WaitForSeconds(0.3f);
        }

        void Hook()
        {
            if (boss && boss.Model?.rig)
            {
                boss.Model.rig.AnimEvent -= OnEvent;
                boss.Model.rig.AnimEvent += OnEvent;
            }
        }

        void OnEvent(string e) => events.Add((e, Time.time, Time.frameCount));

        /// <summary>登场 + 据点模式：BossEncounter（stronghold）开战，演出完整看一遍，量交还误差</summary>
        IEnumerator IntroCase()
        {
            var go = new GameObject("Lord Encounter (test)");
            go.transform.SetParent(root.transform, false);
            go.transform.position = arena.Center;
            enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = LordDef.StageDifficulty;
            enc.stronghold = true;
            enc.altar = altar;
            enc.enabled = false;
            Place(arena.PlayerEntryPoint, arena.BossSpawnPoint + Vector3.up * 3f);
            BossIntroLog.Current.Forget(BossId);
            BossIntroDirector.Policy = BossIntroPolicy.Always;
            yield return new WaitForSeconds(0.3f);
            enc.enabled = true;
            enc.Begin();
            var dir = enc.Intro;
            if (!dir)
            {
                Fail("登场演出没有接管（BossIntroDirector.Play 返回 null）");
                BossIntroDirector.Policy = BossIntroPolicy.Never;
                yield break;
            }
            float t0 = Time.time, shot = -1;
            var script = dir.Script;
            var shotsTaken = new HashSet<int>();
            while (dir && !dir.Released && Time.time - t0 < script.Seconds + 6f)
            {
                KeepPlayerAlive();
                int i = dir.ShotIndex;
                if (i >= 0 && i < script.shots.Count && !shotsTaken.Contains(i) && dir.Elapsed - script.ShotStart(i) > script.shots[i].seconds * 0.6f)
                {
                    shotsTaken.Add(i);
                    var cam = dir.Camera;
                    if (cam) Shot(cam, $"lord_intro_{Short}_{i}_{script.shots[i].name}");
                }
                if (shot < 0 && enc.Boss) shot = Time.time;
                yield return null;
            }
            boss = enc.Boss as LordBrain;
            if (!dir || !boss)
            {
                Fail($"登场没有交还 / 首领没生成（{(dir ? dir.EndReason : "演出没了")}）");
                BossIntroDirector.Policy = BossIntroPolicy.Never;
                yield break;
            }
            Line($"登场：{script.Seconds:F1} s，{script.shots.Count} 镜，交还误差 {dir.HandoffMeters * 100f:F2} cm / {dir.HandoffDegrees:F2}° / 视角 {dir.HandoffFov:F2}°，" +
                 $"落回单帧最大 {dir.LandMaxStep:F2} m，名字卡 {(dir.NameCardShown ? "✓" : "✗")}，结束 {dir.EndReason}");
            if (!(dir.HandoffMeters < 0.01f && dir.HandoffDegrees < 0.5f && dir.HandoffFov < 0.1f)) Fail("登场交还第一人称有误差");
            if (!dir.NameCardShown) Fail("登场没有打名字卡");
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            Hook();
            float w0 = Time.time;
            while (!boss.IntroDone && Time.time - w0 < 3f) yield return null;
            if (!boss.IntroDone) Fail("交还之后首领没有开打");
            Line($"开战：模型 {boss.Model?.prefab}（{boss.Model?.source}），{boss.Health.maxHealth:F0} 生命（领主梯度 {boss.Lord}）");
            yield return new WaitForSeconds(0.3f);
        }

        protected string Short => BossId.StartsWith("boss_") ? BossId.Substring(5) : BossId;

        // ───────────── 招式 ─────────────

        /// <summary>这只领主要逐个强制的招式（默认：全部）</summary>
        protected virtual IEnumerable<string> MoveOrder => boss.Moves.Select(m => m.Id);

        /// <summary>出这一招前玩家站多远（米）</summary>
        protected virtual float DistanceFor(string id) => 10f;

        IEnumerator EachMove()
        {
            foreach (var id in MoveOrder.ToList())
            {
                if (!boss || boss.Dead) yield break;
                yield return Capture(id);
            }
        }

        protected IEnumerator WaitIdle(float timeout = 16f)
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < timeout)
            {
                KeepPlayerAlive();
                yield return null;
            }
        }

        /// <summary>强制出一招、盯到收招：节拍条模式下按节拍拍照；记释放帧对齐</summary>
        protected IEnumerator Capture(string id)
        {
            var move = boss.MoveById(id) as LordMove;
            if (move == null)
            {
                Fail($"没有招式 {id}");
                yield break;
            }
            yield return WaitIdle();
            Front(DistanceFor(id));
            BeforeMove(id);
            yield return null;
            float f0 = Time.time;
            bool ok = false;
            while (!(ok = boss.ForceMove(id)) && Time.time - f0 < 5f) yield return null;
            if (!ok)
            {
                Fail($"{move.Name}：强制出招失败");
                yield break;
            }
            events.Clear();
            FxBudget.ResetPeak();
            float start = Time.time, activeAt = -1, recoverAt = -1;
            bool[] taken = new bool[8];
            int warned0 = 0;
            var trace = new System.Text.StringBuilder();
            float nextTrace = 0.25f;
            while (boss && !boss.Dead && boss.Current == move && Time.time - start < 16f)
            {
                KeepPlayerAlive();
                DuringMove(id, move);
                // 片段播放进度的抽样（诊断「片段比玩法慢」）：每 0.25 s 记一次 Animator 的状态时间、速度、过渡
                var an = boss.Model?.animator;
                if (an && move.T >= nextTrace)
                {
                    nextTrace += 0.25f;
                    var si = an.GetCurrentAnimatorStateInfo(0);
                    var ni = an.GetNextAnimatorStateInfo(0);
                    bool tr = an.IsInTransition(0);
                    float act = 0;
                    foreach (var pr in an.parameters) if (pr.name == "ActScale") act = an.GetFloat("ActScale");
                    trace.Append($" [{move.T:F2}: {(si.IsName(move.Id) ? "" : "≠")}{si.normalizedTime * si.length:F2}/{si.length:F2}{(tr ? $"→{(ni.IsName(move.Id) ? "" : "≠")}{ni.normalizedTime * ni.length:F2}" : "")} ×{an.speed:F2}·{act:F2}]");
                }
                var c = boss.BodyCenter + Vector3.up * 0.5f;
                float size = Mathf.Max(5f, boss.Def.height);
                switch (move.Stage)
                {
                    case MoveStage.Windup:
                        float w = Mathf.Max(0.05f, move.WindupTime);
                        if (Beats && !taken[0] && move.StageT >= w * 0.1f) Take(0, "起手");
                        if (Beats && !taken[1] && move.StageT >= w * 0.5f) Take(1, "预警");
                        if (Beats && !taken[2] && move.StageT >= w * 0.85f)
                        {
                            Take(2, "蓄力顶点");
                            SnapEye(id, move.Name, 7, "第一人称", boss.BodyCenter + Vector3.up * 0.5f, "蓄力顶点 · 玩家视角");
                        }
                        break;
                    case MoveStage.Active:
                        if (activeAt < 0) activeAt = Time.time;
                        if (Beats && !taken[3] && Time.time - activeAt >= 0.03f) Take(3, "释放帧", "出手后 1 帧");
                        if (Beats && !taken[4] && move.active > 0.5f && Time.time - activeAt >= move.active * 0.45f) Take(4, "持续段");
                        break;
                    case MoveStage.Recover:
                        if (recoverAt < 0) recoverAt = Time.time;
                        if (Beats && !taken[6] && Time.time - recoverAt >= move.recover * 0.4f) Take(6, "收招");
                        break;
                }
                yield return null;

                void Take(int k, string beat, string note = null)
                {
                    taken[k] = true;
                    Snap(id, move.Name, k, beat, c, size, note);
                }
            }
            warned0 = move.Warned;
            // 释放帧对齐：片段的出手事件 vs 招式记下的释放帧
            string cue = ReleaseEvent(id);
            var ev = events.FirstOrDefault(e => e.evt == cue);
            float rel = move.ReleasedAt;
            string align;
            if (rel < 0) align = "没有释放帧";
            else if (cue == "none") align = "招式表里没有出手事件（按时间出手）";
            else if (ev.evt == null) align = "没收到片段事件（按时间兜底）";
            else
            {
                // 渲染帧和 30 fps 帧取宽的那个量：片段在出招那一帧才开始播（动画比玩法计时晚一个渲染帧是结构性的）；
                // 编辑器卡的时候一帧远长于 1/30 s（只看时间会冤枉），跑得快的时候 1/30 s 里有四五个渲染帧（只看渲染帧会冤枉）
                int df = ev.frame - move.ReleasedFrame;
                float diff = (ev.t - start - rel) * 30f;
                align = $"{df:+0;-0;0} 渲染帧（{diff:+0.0;-0.0} 帧 @30 fps）";
                if (Mathf.Abs(df) > 1 && Mathf.Abs(diff) > 1f)
                    Fail($"{move.Name}：释放帧和片段事件「{cue}」差 {df} 个渲染帧、{diff:+0.0;-0.0} 帧 @30 fps（都超过 1 帧）");
            }
            bool reached = move.ReachedActive && !move.Cancelled;
            Line($"{move.Name}（{id}）：{(reached ? "✓ 出手" : move.Cancelled ? "被打断" : "✗ 没出手")}，前摇 {move.WindupTime:F2} s，释放帧 {(rel >= 0 ? $"{rel:F2} s" : "—")}，" +
                 $"事件「{cue}」对齐 {align}，预警 {warned0} 个，命中玩家 {move.Hits}，粒子峰值 {FxBudget.Peak}，事件 {string.Join(" ", events.Select(e => $"{e.evt}@{e.t - start:F2}"))}");
            if (!reached && !AllowCancel(id)) Fail($"{move.Name}：没有走到出手 / 被打断");
            if (trace.Length > 0) Line($"  片段进度 {trace}");
            AfterMove(id, move);
        }

        /// <summary>这一招片段里的出手事件名</summary>
        protected virtual string ReleaseEvent(string id) => "hit";

        protected virtual bool AllowCancel(string id) => false;
        protected virtual void BeforeMove(string id) { }
        protected virtual void DuringMove(string id, LordMove move) { }
        protected virtual void AfterMove(string id, LordMove move) { }

        /// <summary>一阶段的场地机制</summary>
        protected virtual IEnumerator Mechanics()
        {
            yield break;
        }

        /// <summary>进入第 phase 阶段之后的场地机制（1 = 二阶段）</summary>
        protected virtual IEnumerator PhaseMechanics(int phase)
        {
            yield break;
        }

        // ───────────── 破防 / 转阶段 / 倒下 ─────────────

        IEnumerator BreakCase()
        {
            yield return WaitIdle();
            Front(9f);
            var bar = boss.Break;
            if (bar == null)
            {
                Fail("首领没有破防条");
                yield break;
            }
            float th = bar.Threshold;
            Guard(false);
            // 打弱点填破防条
            var info = new DamageInfo { amount = th * 0.5f, weakpoint = true, source = DamageSource.Weapon, point = boss.BodyCenter, direction = Vector3.forward };
            boss.Health.health = boss.Health.maxHealth;
            Combat.DamageEnemy(boss.Health, info);
            float filled = bar.Fill;
            if (!bar.Broken) bar.Break();
            Guard(true);
            yield return null;
            bool stag = boss.Staggered;
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, $"lord_break_{Short}");
            float t0 = Time.time;
            while (boss && (boss.Staggered || bar.Broken) && Time.time - t0 < bar.def.seconds + 2f) yield return null;
            Line($"破防「{bar.def.label}」：弱点一枪填到 {filled:P0}，破防硬直 {(stag ? "✓" : "✗")}，{Time.time - t0 + 0.5f:F1} s 后起身，下一次阈值 {bar.Threshold:F0}（第一次 {th:F0}）");
            if (!stag) Fail("破防没有进硬直");
            if (!(bar.Threshold > th)) Fail("破防后下一次阈值没有变高");
            AfterBreak();
        }

        protected virtual void AfterBreak() { }

        IEnumerator PhaseCase(int index)
        {
            yield return WaitIdle();
            var pd = boss.Def.phases[index];
            Guard(false);
            boss.Health.health = boss.Health.maxHealth * (pd.at - 0.01f);
            Guard(true);
            float t0 = Time.time;
            while (boss && !boss.Transitioning && boss.Phase <= index && Time.time - t0 < 4f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            bool entered = boss.Transitioning || boss.Phase > index;
            bool cine = BossIntroDirector.Current;
            yield return new WaitForSeconds(0.6f);
            Shot(weapons.eye, $"lord_phase_{Short}_{index + 2}");
            while (boss && boss.Transitioning && Time.time - t0 < 10f) yield return null;
            Line($"转阶段 {pd.toast}：进入 {(entered ? "✓" : "✗")}，阶段 {boss.Phase}，不接管镜头 {(!cine ? "✓" : "✗")}");
            if (!entered || boss.Phase != index + 1) Fail($"没有进入 {pd.toast}");
            if (cine) Fail("4-1 领主转阶段不该接管镜头");
        }

        IEnumerator KillCase()
        {
            yield return WaitIdle();
            Front(12f);
            Guard(false);
            var bar = boss.Break;
            bar?.Cancel();
            int exits = FindObjectsByType<ExitPortal>(FindObjectsInactive.Exclude).Length;
            boss.Health.health = 1f;
            boss.Health.healthFloor = 0;
            var info = new DamageInfo { amount = 999999f, source = DamageSource.Weapon, point = boss.BodyCenter, direction = Vector3.forward };
            Combat.DamageEnemy(boss.Health, info);
            yield return null;
            if (!boss.Dead)
            {
                Fail("首领没死");
                yield break;
            }
            var cin = boss.DeathCinema;
            if (!cin)
            {
                Fail("没有死亡演出（LordCinema）");
                yield break;
            }
            float t0 = Time.time;
            bool slowSeen = false, cardShot = false;
            var dspec = Def.death;
            while (cin && cin.Phase != LordCinema.Stage.Done && Time.time - t0 < dspec.seconds + 6f)
            {
                if (Time.timeScale < 0.9f) slowSeen = true;
                if (!cardShot && cin.Elapsed > dspec.cardAt + 0.4f)
                {
                    cardShot = true;
                    Shot(weapons.eye, $"lord_death_{Short}");
                }
                DuringDeath(cin.Elapsed);
                if (cin.Released) break;
                yield return null;
            }
            bool released = cin && cin.Released;
            float m = cin ? cin.HandoffMeters : float.NaN, a = cin ? cin.HandoffDegrees : float.NaN, f = cin ? cin.HandoffFov : float.NaN;
            Line($"死亡演出「{dspec.name}」：{Time.time - t0:F1} s，开头慢放 {(slowSeen ? "✓" : "✗")}，名字卡 {(cin && cin.NameCardShown ? "✓" : "✗")}，" +
                 $"交还误差 {m * 100f:F2} cm / {a:F2}° / 视角 {f:F2}°，落回单帧最大 {(cin ? cin.LandMaxStep : 0):F2} m");
            if (!released) Fail("死亡演出没有交还镜头");
            else if (!(m < 0.01f && a < 0.5f && f < 0.1f)) Fail("死亡演出交还第一人称有误差");
            if (!slowSeen) Fail("死亡演出开头没有慢放");
            if (enc)
            {
                float s0 = Time.time;
                while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.StrongholdSettleDelay + 3f) yield return null;
                int exits2 = FindObjectsByType<ExitPortal>(FindObjectsInactive.Exclude).Length;
                Line($"据点结算：{enc.State}，灵火坛 {(altar && altar.Lit ? "点亮 ✓" : "没亮 ✗")}，出口 {exits} → {exits2}，领主梯度记账 {(LordScaling.IsDefeated(LordDef.Level, BossId) ? "✓" : "✗")}");
                if (enc.State != BossEncounter.Phase.Settled) Fail("据点没有结算");
                if (!(altar && altar.Lit)) Fail("据点结算没有点亮灵火坛");
                if (exits2 > exits) Fail("据点模式不该立出口");
                if (!LordScaling.IsDefeated(LordDef.Level, BossId)) Fail("领主梯度没有记账");
            }
            yield return new WaitForSeconds(0.5f);
            AfterDeath();
        }

        protected virtual void DuringDeath(float t) { }
        protected virtual void AfterDeath() { }
    }

    // ───────────────────────────── 夔 ─────────────────────────────

    /// <summary>
    /// 夔冒烟（bridge.sh playtest boss-kui）：底座的全部检查，外加——测试场里立 6 根经幡杆（F 路 Conductor，14–20 m）；
    /// 大跳落在带电的杆 4.5 m 内被回劈（硬直 + 破防条）；捶胸每一捶两道雷（LightningStrike）、劈到杆上让杆带电；召鼓召连鼓灵（名册里有时）；
    /// 三阶段外圈落雷；一直带电（Charge）；雷暴在登场时入场、死后退场；残鼓登场藏起、死时露出来
    /// </summary>
    public sealed class KuiSuite : LordSuiteBase
    {
        public override string Id => "boss-kui";
        protected override string BossId => KuiDef.Id;
        protected override string Tag => "playtest_kui";
        readonly List<Conductor> poles = new();

        protected override void PrepareArena()
        {
            for (int i = 0; i < 6; i++)
            {
                float a = i * 60f + 30f;
                var p = arena.Center + Quaternion.Euler(0, a, 0) * Vector3.forward * (i % 2 == 0 ? 14f : 19f);
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                go.name = $"Pole_test_{i}";
                go.transform.SetParent(root.transform, true);
                go.transform.position = p + Vector3.up * 3f;
                go.transform.localScale = new Vector3(0.25f, 3f, 0.25f);
                var cgo = new GameObject("Conductor");
                cgo.transform.SetParent(go.transform.parent, true);
                cgo.transform.position = p;
                var c = cgo.AddComponent<Conductor>();
                c.height = 6f;
                poles.Add(c);
            }
        }

        protected override string ReleaseEvent(string id) => id switch
        {
            KuiHop.MoveId or KuiLeap.MoveId or KuiLeapChain.MoveId or KuiTurnLeap.MoveId => "land",
            KuiChestDrum.MoveId or KuiChestDrum5.MoveId => "beat",
            KuiKnuckle.MoveId => "step",
            _ => "hit",
        };

        protected override float DistanceFor(string id) => id == KuiClap.MoveId ? 6f : id == KuiTurnLeap.MoveId ? -6f : 12f;

        protected override void AfterMove(string id, LordMove move)
        {
            if (move is KuiChestDrum d && d.Bolts < (id == KuiChestDrum5.MoveId ? 10 : 6)) Fail($"{move.Name}：只引下 {d.Bolts} 道雷");
            if (move is KuiLeap l && !(l is KuiLeapChain) && l.Rings < 1) Fail("大跳没有冲击环");
            if (move is KuiKnuckle k && k.Travelled < 3f) Fail($"拄拳只挪了 {k.Travelled:F1} m");
        }

        protected override IEnumerator Mechanics()
        {
            var kui = boss as KuiBrain;
            bool charged = Charge.IsCharged(boss.Health);
            bool storm = PlateauStorm.Active;
            Line($"夔：一直带电 {(charged ? "✓" : "✗")}，雷暴 {(storm ? $"✓（强度 {PlateauStorm.Level:F2}）" : "✗")}，残鼓 {(kui.Drum ? (kui.Drum.Visible ? "露着 ✗" : "藏起 ✓") : "没有 ✗")}");
            if (!charged) Fail("夔应该一直带电");
            if (!storm) Fail("夔在场时应该有高原雷暴");
            if (kui.Drum && kui.Drum.Visible) Fail("夔现身后残鼓应该藏起");
            // 回劈：把离夔最近的杆充上电、让它大跳到杆旁
            yield return WaitIdle();
            var pole = poles.OrderBy(p => (p.Base - boss.transform.position).sqrMagnitude).First();
            pole.AddCharge(1f);
            var spot = pole.Base + (arena.Center - pole.Base).normalized * 2.5f;
            Place(spot, boss.BodyCenter);
            int b0 = kui.Backlashes;
            boss.ForceMove(KuiLeap.MoveId);
            float t0 = Time.time;
            while (kui.Backlashes == b0 && Time.time - t0 < 5f)
            {
                pole.AddCharge(1f);
                KeepPlayerAlive();
                yield return null;
            }
            yield return new WaitForSeconds(0.3f);
            Shot(weapons.eye, "lord_kui_backlash");
            Line($"经幡杆回劈：{(kui.Backlashes > b0 ? "✓" : "✗")}（杆电量 {pole.charge:F2}，夔硬直 {boss.Staggered}）");
            if (kui.Backlashes == b0) Fail("大跳落在带电的经幡杆旁没有被回劈");
            yield return WaitIdle();
        }

        protected override IEnumerator PhaseMechanics(int phase)
        {
            var kui = boss as KuiBrain;
            if (phase == 1)
            {
                yield return new WaitForSeconds(0.5f);
                Line($"召鼓：连鼓灵 {kui.DrumsSummoned} 只（名册里{(EnemyRoster.Get(kui.KDef.lianguId) != null ? "有连鼓灵" : "还没有连鼓灵（E 路）")}），经幡杆带电 {poles.Count(p => p.Charged)} / {poles.Count}");
                if (EnemyRoster.Get(kui.KDef.lianguId) != null && kui.DrumsSummoned < 1) Fail("召鼓没有召出连鼓灵");
                yield return Capture(KuiChestDrum.MoveId);
            }
            else
            {
                int r0 = kui.RingStrikes;
                float t0 = Time.time;
                while (Time.time - t0 < 4f)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                Line($"风雨：4 s 外圈落雷 {kui.RingStrikes - r0} 道");
                if (kui.RingStrikes - r0 < 2) Fail("三阶段外圈落雷太少");
            }
        }

        protected override void AfterDeath()
        {
            var kui = boss as KuiBrain;
            Line($"雷息：残鼓 {(kui.Drum && kui.Drum.Visible ? "露出来 ✓" : "✗")}，雷暴 {(KuiBrain.StormTicket != null ? KuiBrain.StormTicket.Stage.ToString() : "—")}");
            if (kui.Drum && !kui.Drum.Visible) Fail("死后残鼓没有露出来");
            if (KuiBrain.StormTicket != null && KuiBrain.StormTicket.Stage is PlateauStorm.Stage.Full or PlateauStorm.Stage.FadingIn) Fail("夔死后雷暴没有退");
        }
    }

    // ───────────────────────────── 飞廉 ─────────────────────────────

    /// <summary>
    /// 飞廉冒烟（bridge.sh playtest boss-feilian）：底座的全部检查，外加——擂台风（WindField 吸引点：一二阶段往外推、三阶段往里吸，推力 / 步速倒下后还原）；
    /// 狂风躲在巨石后不挨；低头冲撞撞上巨石（测试场里摆一块 Boulder_test）晕；龙卷风柱被火打中变火龙卷、烧到飞廉；风雷爆；珠碎风停、珠子关弱点
    /// </summary>
    public sealed class FeilianSuite : LordSuiteBase
    {
        public override string Id => "boss-feilian";
        protected override string BossId => FeilianDef.Id;
        protected override string Tag => "playtest_feilian";
        GameObject boulder;
        float push0, speedK0;

        protected override void PrepareArena()
        {
            push0 = WindField.PlayerPush;
            speedK0 = WindField.PlayerSpeedK;
            boulder = GameObject.CreatePrimitive(PrimitiveType.Cube);
            boulder.name = "Boulder_test";
            boulder.transform.SetParent(root.transform, true);
            boulder.transform.localScale = new Vector3(5f, 4f, 2f);
            boulder.SetActive(false);
        }

        protected override string ReleaseEvent(string id) => id switch
        {
            FeilianBlades.MoveId or FeilianTornadoMove.MoveId => "release",
            FeilianSidestep.MoveId => "none",
            _ => "hit",
        };

        protected override float DistanceFor(string id) => id switch
        {
            FeilianCharge.MoveId or FeilianWheel.MoveId => 14f,
            FeilianBlades.MoveId => 14f,
            FeilianStormBurst.MoveId => 8f,
            _ => 12f,
        };

        protected override IEnumerator Mechanics()
        {
            var fei = boss as FeilianBrain;
            Line($"飞廉：风雷珠 {(fei.Orb ? "✓" : "✗")}，擂台风 {(fei.Wind != null ? $"✓（strength {fei.Wind.strength:+0.0;-0.0}，推力 {WindField.PlayerPush:F1}，步速 ±{WindField.PlayerSpeedK:P0}）" : "✗")}，风涡柱 {(fei.Vortex ? "✓" : "✗")}");
            if (fei.Wind == null || !(fei.Wind.strength < 0)) Fail("一阶段的擂台风应该往外推（strength < 0）");
            if (!fei.Orb) Fail("没有风雷珠");
            // 狂风：躲在巨石后面不挨
            yield return WaitIdle();
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var behind = boss.transform.position + fwd * 16f;
            boulder.SetActive(true);
            boulder.transform.SetPositionAndRotation(boss.transform.position + fwd * 12f + Vector3.up * 2f, Quaternion.LookRotation(fwd));
            Physics.SyncTransforms();
            Place(behind, boss.BodyCenter);
            boss.ForceMove(FeilianGust.MoveId);
            var gust = boss.MoveById(FeilianGust.MoveId) as FeilianGust;
            float t0 = Time.time;
            while (boss.Current == gust && Time.time - t0 < 4f)
            {
                KeepPlayerAlive();
                Teleport(motor, behind);
                yield return null;
            }
            Line($"狂风：躲在巨石后 被挡 {(gust.LastCovered ? "✓" : "✗")}，吹到 {(gust.LastHit ? "✗" : "✓ 没有")}");
            if (!gust.LastCovered || gust.LastHit) Fail("躲在巨石后面还是被狂风吹到");
            // 低头冲撞撞上巨石：晕
            yield return WaitIdle();
            Place(behind + Vector3.Cross(Vector3.up, fwd) * 0.5f, boss.BodyCenter);
            boss.FaceNow(behind);
            boss.ForceMove(FeilianCharge.MoveId);
            var charge = boss.MoveById(FeilianCharge.MoveId) as FeilianCharge;
            int c0 = fei.Crashes;
            t0 = Time.time;
            while (fei.Crashes == c0 && Time.time - t0 < 4f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            yield return new WaitForSeconds(0.4f);
            Shot(weapons.eye, "lord_feilian_crash");
            Line($"低头冲撞撞巨石：撞晕 {(fei.Crashes > c0 ? "✓" : "✗")}（冲了 {charge.Travelled:F1} m，硬直 {boss.Staggered}）");
            if (fei.Crashes == c0) Fail("低头冲撞撞上巨石没有晕");
            boulder.SetActive(false);
            yield return WaitIdle();
        }

        protected override IEnumerator PhaseMechanics(int phase)
        {
            var fei = boss as FeilianBrain;
            if (phase == 1)
            {
                int n = fei.Tornadoes.Count;
                Line($"龙卷：转阶段后场上 {n} 根");
                if (n < 2) Fail("转阶段没有分出两根龙卷");
                // 火打中龙卷 → 火龙卷 → 吸回去烧飞廉
                var t = fei.Tornadoes.FirstOrDefault();
                if (t)
                {
                    var hp = t.GetComponent<Damageable>();
                    Combat.DamageEnemy(hp, new DamageInfo { amount = 30f, element = Element.Fire, source = DamageSource.Explosion, point = t.transform.position + Vector3.up * 2f, direction = Vector3.forward });
                    Guard(false);
                    float h0 = boss.Health.health, t0 = Time.time;
                    while (t && t.BurnHits == 0 && Time.time - t0 < 8f)
                    {
                        KeepPlayerAlive();
                        yield return null;
                    }
                    Guard(true);
                    Shot(weapons.eye, "lord_feilian_firetornado");
                    Line($"火龙卷：点着 {(t && t.Burning ? "✓" : "✗")}，烧到飞廉 {(t ? t.BurnHits : 0)} 次，飞廉掉血 {h0 - boss.Health.health:F0}");
                    if (!t || t.BurnHits == 0) Fail("火龙卷没有被吸回去烧飞廉");
                }
                yield return WaitIdle();
            }
            else
            {
                Line($"风眼：擂台风 strength {fei.Wind?.strength:+0.0;-0.0}（应 > 0：往里吸）");
                if (fei.Wind == null || !(fei.Wind.strength > 0)) Fail("三阶段风向没有反过来");
                yield return Capture(FeilianStormBurst.MoveId);
            }
        }

        protected override void AfterBreak()
        {
            var fei = boss as FeilianBrain;
            Line($"珠碎：珠子 {(fei.OrbIntact ? "还在 ✗" : "碎了 ✓")}");
            if (fei.OrbIntact) Fail("珠碎后风雷珠还在");
        }

        protected override void AfterDeath()
        {
            Line($"风止：推力 {WindField.PlayerPush:F1}（原 {push0:F1}）、步速 {WindField.PlayerSpeedK:F2}（原 {speedK0:F2}），吸引点 {WindField.Attractors.Count} 个");
            if (!Mathf.Approximately(WindField.PlayerPush, push0) || !Mathf.Approximately(WindField.PlayerSpeedK, speedK0)) Fail("飞廉死后风场的推力 / 步速没有还原");
        }
    }

    // ───────────────────────────── 化蛇 ─────────────────────────────

    /// <summary>
    /// 化蛇冒烟（bridge.sh playtest boss-huashe）：底座的全部检查，外加——游线（在湖里、不走导航网格）；嘴只在张嘴时是弱点；湿身导电（雷殛 × 1.5）、
    /// 玩家自己泡在水里打雷殛电到自己；二阶段涨水（常驻 +1.2 m，涨水面出现）、吼叫再涨；三阶段漩涡；噎住打断涨水；死后水退回
    /// </summary>
    public sealed class HuasheSuite : LordSuiteBase
    {
        public override string Id => "boss-huashe";
        protected override string BossId => HuasheDef.Id;
        protected override string Tag => "playtest_huashe";
        protected override float ArenaRadius => 26f;

        // 网页招式表 roar 只有 warn / end：吼在前摇末按时间出
        protected override string ReleaseEvent(string id) => id == HuasheSpit.MoveId ? "release" : id == HuasheRoar.MoveId ? "none" : "hit";

        protected override bool AllowCancel(string id) => false;

        protected override float DistanceFor(string id) => id switch
        {
            HuasheLunge.MoveId => 6f,
            HuasheDive.MoveId => 16f,
            HuasheTailSweep.MoveId => -8f,
            _ => 12f,
        };

        protected override IEnumerator Mechanics()
        {
            var hua = boss as HuasheBrain;
            var lake = hua.Lake;
            Line($"化蛇：湖 {(lake.Real ? "场景里的" : "测试场虚拟湖")}，中心 {lake.Center}，半轴 {lake.Rx:F0} × {lake.Rz:F0} m，水位 {lake.Level:F2}，湿身 {(hua.Wet ? "✓" : "✗")}，嘴（弱点）{(hua.MouthOpen ? "张着 ✗" : "合着 ✓")}");
            if (!hua.Wet) Fail("化蛇在湖里应该湿身");
            if (hua.MouthOpen) Fail("不出招时嘴应该合着");
            // 湿身导电：雷殛 × 1.5
            Guard(false);
            boss.Health.health = boss.Health.maxHealth;
            float h0 = boss.Health.health;
            int w0 = hua.WetShocks;
            Combat.DamageEnemy(boss.Health, new DamageInfo { amount = 100f, element = Element.Shock, source = DamageSource.Weapon, noCrit = true, point = boss.BodyCenter, direction = Vector3.forward });
            float shock = h0 - boss.Health.health;
            h0 = boss.Health.health;
            Combat.DamageEnemy(boss.Health, new DamageInfo { amount = 100f, element = Element.None, source = DamageSource.Weapon, noCrit = true, point = boss.BodyCenter, direction = Vector3.forward });
            float plain = h0 - boss.Health.health;
            boss.Health.health = boss.Health.maxHealth;
            Guard(true);
            Line($"湿身导电：雷殛 100 → {shock:F0}，无属性 100 → {plain:F0}（{(plain > 0 ? shock / plain : 0):F2} 倍）");
            if (hua.WetShocks == w0 || !(shock > plain * 1.3f)) Fail("湿身时雷殛没有 +50%");
            yield return null;
        }

        protected override IEnumerator PhaseMechanics(int phase)
        {
            var hua = boss as HuasheBrain;
            if (phase == 1)
            {
                Line($"涨水：常驻 +{hua.Lake.Flood:F2} m，涨水面 {(hua.Lake.FloodVolume ? "✓" : "✗")}");
                if (hua.Lake.Flood < 1.1f || !hua.Lake.FloodVolume) Fail("二阶段湖水没有常驻涨 1.2 m");
                yield return Capture(HuasheRoar.MoveId);
                Line($"吼叫涨水：再涨 {hua.Lake.Surge:F2} m（停 {hua.SurgeHold:F1} s）");
                if (hua.Lake.Surge < 0.6f) Fail("吼叫没有再涨水");
                Shot(weapons.eye, "lord_huashe_flood");
            }
            else yield return new WaitForSeconds(0.5f);
        }

        protected override void AfterBreak()
        {
            var hua = boss as HuasheBrain;
            Line($"噎住：涨水 {hua.Lake.Surge:F2} m（应 ≤ 0.2）");
        }

        protected override void AfterDeath()
        {
            var hua = boss as HuasheBrain;
            Line($"水退：常驻 {hua.Lake.Flood:F2} m、吼叫 {hua.Lake.Surge:F2} m，涨水面 {(hua.Lake.FloodVolume ? "还在" : "收了")}");
            if (hua.Lake.Flood > 0.05f || hua.Lake.Surge > 0.05f) Fail("化蛇死后湖水没有退回");
        }
    }

    // ───────────────────────────── 节拍条 ─────────────────────────────

    /// <summary>
    /// 4-1 三领主的节拍条（bridge.sh playtest beats-ch4-lords；TestArena）：三只领主依次刷出，招牌招式按节拍拍一行（起手 / 预警 / 蓄力顶点 / 释放帧 / 持续段 / 收招 + 第一人称），
    /// 同时记下释放帧和片段出手事件差几帧。截图 Assets/Art/_Review/beats/beats-ch4-lords/，拼图 scripts/unity/beat_strips.py → docs/art/review/ch4-port/B1/
    /// </summary>
    public sealed class Ch4LordBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-ch4-lords";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        protected override IEnumerator Steps()
        {
            foreach (var s in new LordSuiteBase[] { new KuiBeats(), new FeilianBeats(), new HuasheBeats() })
                yield return s.Run(Runner);
        }

        abstract class Beat : LordSuiteBase
        {
            /// <summary>每只领主一个子目录（Setup 会清掉自己目录里的旧图）：Assets/Art/_Review/beats/beats-ch4-kui/ …</summary>
            public override string Id => "beats-ch4-" + Short;
            protected override bool Beats => true;
        }

        sealed class KuiBeats : Beat
        {
            protected override string BossId => KuiDef.Id;
            protected override string Tag => "beats_kui";
            protected override IEnumerable<string> MoveOrder => new[] { KuiHop.MoveId, KuiLeap.MoveId, KuiClap.MoveId, KuiKnuckle.MoveId, KuiChestDrum.MoveId, KuiChestDrum5.MoveId };
            protected override string ReleaseEvent(string id) => id is KuiHop.MoveId or KuiLeap.MoveId ? "land" : id is KuiChestDrum.MoveId or KuiChestDrum5.MoveId ? "beat" : id == KuiKnuckle.MoveId ? "step" : "hit";
            protected override float DistanceFor(string id) => id == KuiClap.MoveId ? 6f : 13f;
        }

        sealed class FeilianBeats : Beat
        {
            protected override string BossId => FeilianDef.Id;
            protected override string Tag => "beats_feilian";
            protected override IEnumerable<string> MoveOrder => new[] { FeilianGust.MoveId, FeilianCharge.MoveId, FeilianBlades.MoveId, FeilianTornadoMove.MoveId, FeilianWheel.MoveId, FeilianStormBurst.MoveId };
            protected override string ReleaseEvent(string id) => id is FeilianBlades.MoveId or FeilianTornadoMove.MoveId ? "release" : id == FeilianSidestep.MoveId ? "none" : "hit";
            protected override float DistanceFor(string id) => id == FeilianStormBurst.MoveId ? 8f : 14f;
        }

        sealed class HuasheBeats : Beat
        {
            protected override string BossId => HuasheDef.Id;
            protected override string Tag => "beats_huashe";
            protected override float ArenaRadius => 26f;
            protected override IEnumerable<string> MoveOrder => new[] { HuasheSpit.MoveId, HuasheLunge.MoveId, HuasheWingSlap.MoveId, HuasheRoar.MoveId, HuasheDive.MoveId, HuasheTailSweep.MoveId };
            protected override string ReleaseEvent(string id) => id == HuasheSpit.MoveId ? "release" : id == HuasheRoar.MoveId ? "none" : "hit";
            protected override float DistanceFor(string id) => id == HuasheLunge.MoveId ? 6f : id == HuasheDive.MoveId ? 16f : id == HuasheTailSweep.MoveId ? -8f : 12f;
        }
    }
}
