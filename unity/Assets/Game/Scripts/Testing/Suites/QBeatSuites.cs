using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 火麒麟的节拍条（首领与精英动作 · 特效调优的 Q 路；bridge.sh playtest beats-qilin，场景 3-4；设计单 docs/art/vfx/qilin.md）：
    /// 登场、玄鳞的张鳞 / 踏火奔驰冲撞 / 麟火、化焚身、焚身的踏云俯冲 / 吐息扫象限 / 火云雨、倒下各拍一行（起手 / 预警 / 蓄力顶点 / 释放帧 / 持续段 / 收招 + 第一人称），
    /// 同时记下释放帧和动画出手事件差几帧、每招的同屏粒子峰值。机位、截图、拼图沿用 H 路的 <see cref="HBeatSuite"/>（scripts/unity/beat_strips.py → docs/art/review/boss-vfx/Q/）。
    /// 只旁观、不改玩法：首领不掉血（Incoming → 0），玩家血量垫高；倒下那一行最后才放开、处决。
    /// </summary>
    public sealed class QilinBeatsSuite : HBeatSuite
    {
        public override string Id => "beats-qilin";
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";
        const string Tag = "beats_qilin";

        QilinBrain boss;
        BossArena arena;
        System.IDisposable guard;
        readonly List<(string evt, float t)> events = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            if (!Setup(Tag)) yield break;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
                yield return Capture(ScaleBlades.MoveId, "张鳞", 10f);
                yield return Gallop();
                yield return Capture(ScaleBreath.MoveId, "麟火", 9f);
                yield return Transition();
                // 换形换了模型：动画事件要挂到焚身的骨架上
                if (boss && boss.Model?.rig)
                {
                    boss.Model.rig.AnimEvent -= OnEvent;
                    boss.Model.rig.AnimEvent += OnEvent;
                }
                yield return Dives();
                yield return Capture(BurnSweep.MoveId, "吐息扫象限", 0f);
                yield return Capture(BurnRain.MoveId, "火云雨", 10f);
                yield return Defeat();
            }
            if (boss && boss.Model?.rig) boss.Model.rig.AnimEvent -= OnEvent;
            guard?.Dispose();
            if (boss) Destroy(boss.gameObject);
            Teardown(Tag);
        }

        void OnEvent(string evt) => events.Add((evt, Time.time));

        IEnumerator StartFight()
        {
            var enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == QilinDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(QilinDef.Id);
            if (!arena)
            {
                Fail("场景里没有火麒麟的 BossArena（先 bridge.sh level 3-4）");
                yield break;
            }
            Teleport(motor, arena.PlayerEntryPoint);
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                boss = enc.Boss as QilinBrain;
            }
            else boss = Bosses.Spawn(QilinDef.Id, arena, QilinDef.StageDifficulty) as QilinBrain;
            if (!boss)
            {
                Fail("火麒麟没有刷出来");
                yield break;
            }
            if (boss.Model?.rig) boss.Model.rig.AnimEvent += OnEvent;
            // 登场：熔岩柱 → 跃出 → 落地人立 → 前蹄砸地
            float i0 = Time.time, secs = boss.Def.intro.seconds;
            bool[] taken = new bool[5];
            while (!boss.IntroDone && Time.time - i0 < secs + 3f)
            {
                float t = Time.time - i0;
                var c = boss.Model?.root ? boss.Model.root.transform.position + Vector3.up * 3f : boss.BodyCenter;
                Aim(motor, eye, c);
                if (!taken[0] && t >= 0.2f) Take(0, "起手", "熔岩柱");
                if (!taken[1] && t >= secs * 0.3f) Take(1, "预警", "跃出");
                if (!taken[2] && t >= secs * 0.45f + 0.05f) Take(2, "释放帧", "落地");
                if (!taken[3] && t >= secs * 0.45f + 0.75f) Take(3, "蓄力顶点", "人立长啸");
                if (!taken[4] && t >= secs * 0.45f + 1.25f) Take(4, "收招", "前蹄砸地");
                yield return null;

                void Take(int k, string beat, string note)
                {
                    taken[k] = true;
                    Snap("intro", "登场", k, beat, c, 7f, note);
                    if (k == 3) SnapEye("intro", "登场", 7, "第一人称", c, "人立长啸 · 玩家视角");
                }
            }
            yield return new WaitForSecondsRealtime(0.5f);
            Line($"开战：模型 {boss.Model?.prefab}（{boss.Model?.source}），炉心殿 {(boss.Furnace ? boss.Furnace.name : "（没有）")}");
        }

        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < 16f)
            {
                KeepPlayerAlive();
                yield return null;
            }
        }

        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            if (distance <= 0) return;
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var spot = arena.Clamp(boss.transform.position + fwd * distance, 2f);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Teleport(motor, spot);
            Aim(motor, eye, boss.BodyCenter);
        }

        IEnumerator Force(string id, string label)
        {
            yield return WaitIdle();
            PlayerStatus.Instance?.ClearAll();
            yield return null;
            float f0 = Time.time;
            bool ok = false;
            while (!(ok = boss.ForceMove(id)) && Time.time - f0 < 6f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            if (!ok) Fail($"{label}：强制出招失败");
        }

        void Report(string label, string cue, float activeAt, float start)
        {
            var ev = events.FirstOrDefault(e => e.evt == cue);
            string align = activeAt < 0 ? "（没进出手段）" : ev.evt == null ? "没收到事件（按时间兜底）" : $"{(ev.t - activeAt) * 30f:+0.0;-0.0} 帧（30 fps）";
            Line($"{label}：出手事件「{cue}」对释放帧 {align}；事件 {string.Join(" ", events.Select(e => $"{e.evt}@{e.t - start:F2}"))}；同屏粒子峰值 {FxBudget.Peak}（砍掉 {FxBudget.Dropped}）");
        }

        /// <summary>按招式段拍（张鳞、麟火、吐息、火云雨）</summary>
        IEnumerator Capture(string id, string label, float distance)
        {
            var move = boss.Moves.FirstOrDefault(m => m.Id == id);
            if (move == null)
            {
                Fail($"没有招式 {id}");
                yield break;
            }
            yield return WaitIdle();
            ReadyPlayer(distance);
            yield return Force(id, label);
            events.Clear();
            FxBudget.ResetPeak();
            float start = Time.time, activeAt = -1, recoverAt = -1;
            bool[] taken = new bool[8];
            var sweep = move as BurnSweep;
            while (boss && !boss.Dead && boss.Current == move && Time.time - start < 16f)
            {
                KeepPlayerAlive();
                var c = boss.BodyCenter + Vector3.up * 0.8f;
                float wind = Mathf.Max(0.3f, move.WindupTime);
                switch (move.Stage)
                {
                    case MoveStage.Windup when sweep == null:
                        if (!taken[0] && move.StageT >= wind * 0.12f) Take(0, "起手");
                        if (!taken[1] && move.StageT >= wind * 0.5f) Take(1, "预警");
                        if (!taken[2] && move.StageT >= wind * 0.9f)
                        {
                            Take(2, "蓄力顶点");
                            SnapEye(id, label, 7, "第一人称", boss.BodyCenter + Vector3.up * 0.6f, "蓄力顶点 · 玩家视角");
                        }
                        break;
                    case MoveStage.Windup:
                        // 吐息：前摇是飞向对岸（扇形预警从这里开始画）
                        if (!taken[0] && move.StageT >= 0.3f) Take(0, "起手", "飞向对岸、扇形预警出现");
                        break;
                    case MoveStage.Active when sweep != null:
                        if (activeAt < 0) activeAt = Time.time + BurnSweep.Tele;
                        if (!taken[1] && move.StageT >= BurnSweep.Tele * 0.5f) Take(1, "预警", "落地蓄势");
                        if (!taken[2] && move.StageT >= BurnSweep.Tele * 0.92f)
                        {
                            Take(2, "蓄力顶点");
                            SnapEye(id, label, 7, "第一人称", boss.BodyCenter + Vector3.up * 0.6f, "蓄力顶点 · 玩家视角");
                        }
                        if (!taken[3] && move.StageT >= BurnSweep.Tele + 0.04f) Take(3, "释放帧", "开扫后 1 帧");
                        if (!taken[4] && move.StageT >= BurnSweep.Tele + BurnSweep.SweepTime * 0.5f) Take(4, "持续段");
                        break;
                    case MoveStage.Active:
                        if (activeAt < 0) activeAt = Time.time;
                        if (!taken[3] && Time.time - activeAt >= 0.03f) Take(3, "释放帧", "出手后 1 帧");
                        if (!taken[4] && Time.time - activeAt >= Mathf.Min(0.42f, move.active * 0.5f)) Take(4, "持续段");
                        break;
                    case MoveStage.Recover:
                        if (recoverAt < 0) recoverAt = Time.time;
                        if (!taken[6] && Time.time - recoverAt >= move.recover * 0.4f) Take(6, "收招");
                        break;
                }
                yield return null;

                void Take(int k, string beat, string note = null)
                {
                    taken[k] = true;
                    Snap(id, label, k, beat, boss.BodyCenter + Vector3.up * 0.8f, 7f, note);
                }
            }
            if (!taken[6] && boss && !boss.Dead) Snap(id, label, 6, "收招", boss.BodyCenter + Vector3.up * 0.8f, 7f);
            string cue = id switch
            {
                ScaleBlades.MoveId => "hit",
                ScaleBreath.MoveId or BurnSweep.MoveId => "breathStart",
                _ => "-",
            };
            Report(label, cue, activeAt, start);
        }

        /// <summary>踏火奔驰：按冲撞的分段拍（刨蹄 = 起手 / 预警 / 蓄力顶点，冲出 = 释放帧）</summary>
        IEnumerator Gallop()
        {
            const string id = ScaleGallop.MoveId, label = "踏火奔驰 · 冲撞";
            var move = boss.Moves.FirstOrDefault(m => m.Id == id) as ScaleGallop;
            if (move == null) yield break;
            yield return WaitIdle();
            ReadyPlayer(0);
            Teleport(motor, arena.PlayerEntryPoint);
            yield return Force(id, label);
            events.Clear();
            FxBudget.ResetPeak();
            float start = Time.time, legAt = Time.time, activeAt = -1;
            var leg = move.Phase;
            bool[] taken = new bool[8];
            while (boss && !boss.Dead && boss.Current == move && Time.time - start < 20f)
            {
                KeepPlayerAlive();
                if (move.Phase != leg)
                {
                    leg = move.Phase;
                    legAt = Time.time;
                    if (leg == ScaleGallop.Leg.Charge) activeAt = Time.time;
                }
                float t = Time.time - legAt;
                switch (leg)
                {
                    case ScaleGallop.Leg.Run when !taken[5] && t > 0.8f:
                        Take(5, "持续段", "绕外环狂奔、落蹄印");
                        break;
                    case ScaleGallop.Leg.Aim:
                        if (!taken[0] && t >= 0.1f) Take(0, "起手", "重心后坐、低头亮角");
                        if (!taken[1] && t >= 0.45f) Take(1, "预警", "刨蹄、冲撞线");
                        if (!taken[2] && t >= 0.9f)
                        {
                            Take(2, "蓄力顶点", "臀部下蹲蓄力");
                            SnapEye(id, label, 7, "第一人称", boss.BodyCenter + Vector3.up * 0.6f, "蓄力顶点 · 玩家视角");
                        }
                        break;
                    case ScaleGallop.Leg.Charge:
                        if (!taken[3] && t >= 0.04f) Take(3, "释放帧", "冲出");
                        if (!taken[4] && t >= 0.25f) Take(4, "持续段", "冲撞中");
                        break;
                    case ScaleGallop.Leg.Crash:
                    case ScaleGallop.Leg.Recover:
                        if (!taken[6] && t >= 0.25f) Take(6, "收招", leg == ScaleGallop.Leg.Crash ? "撞柱眩晕" : "收步");
                        break;
                }
                yield return null;

                void Take(int k, string beat, string note)
                {
                    taken[k] = true;
                    Snap(id, label, k, beat, boss.BodyCenter + Vector3.up * 0.8f, 7f, note);
                }
            }
            Report(label, "hit", activeAt, start);
        }

        /// <summary>化焚身：跳池 → 熔岩柱 → 鳞甲炸飞 → 跃出 → 落岸</summary>
        IEnumerator Transition()
        {
            yield return WaitIdle();
            ReadyPlayer(0);
            Teleport(motor, arena.PlayerEntryPoint);
            var hp = boss.Health;
            hp.armor = 0;
            hp.health = Mathf.Clamp(hp.maxHealth * (QilinDef.TransformAt - 0.01f), 1f, hp.maxHealth);
            float t0 = Time.time;
            while (!boss.Transitioning && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            float s0 = Time.time;
            FxBudget.ResetPeak();
            var beats = new (float at, string beat, string note)[]
            {
                (0.5f, "起手", "跃向熔池"), (1.45f, "预警", "熔岩柱冲天"), (2.45f, "释放帧", "玄铁鳞甲炸飞"), (3.3f, "持续段", "焚身从熔岩里冲出"), (4.7f, "收招", "落岸"),
            };
            int k = 0;
            while (boss.Transitioning && Time.time - s0 < 8f)
            {
                KeepPlayerAlive();
                var c = boss.Model?.root ? boss.Model.root.transform.position + Vector3.up * 3f : boss.BodyCenter;
                if (boss.Furnace && Time.time - s0 < 3.6f) c = boss.Furnace.Center + Vector3.up * 4f;
                Aim(motor, eye, c);
                if (k < beats.Length && Time.time - s0 >= beats[k].at)
                {
                    Snap("transition", "化焚身", k, beats[k].beat, c, 9f, beats[k].note);
                    if (k == 2) SnapEye("transition", "化焚身", 7, "第一人称", c, "鳞甲炸飞 · 玩家视角");
                    k++;
                }
                yield return null;
            }
            Line($"化焚身：{(boss.Form != null ? boss.Form.name : "?")}，同屏粒子峰值 {FxBudget.Peak}");
        }

        /// <summary>踏云俯冲：只拍第一踏（蓄势 = 起手 / 预警 / 蓄力顶点，落地 = 释放帧，火环 = 持续段）</summary>
        IEnumerator Dives()
        {
            const string id = BurnDives.MoveId, label = "踏云俯冲";
            var move = boss.Moves.FirstOrDefault(m => m.Id == id) as BurnDives;
            if (move == null) yield break;
            yield return WaitIdle();
            ReadyPlayer(10f);
            yield return Force(id, label);
            events.Clear();
            FxBudget.ResetPeak();
            float start = Time.time, legAt = Time.time, activeAt = -1;
            int landings0 = move.Landings;
            var leg = move.Phase;
            bool[] taken = new bool[8];
            while (boss && !boss.Dead && boss.Current == move && Time.time - start < 16f && !taken[6])
            {
                KeepPlayerAlive();
                if (move.Phase != leg)
                {
                    leg = move.Phase;
                    legAt = Time.time;
                }
                if (move.Landings > landings0 && activeAt < 0) activeAt = Time.time;
                float t = Time.time - legAt, tele = boss.Enraged ? BurnDives.TeleRage : BurnDives.Tele;
                var c = boss.BodyCenter + Vector3.up * 0.5f;
                switch (leg)
                {
                    case BurnDives.Leg.Tele:
                        if (!taken[0] && t >= 0.08f) Take(0, "起手", "收腿");
                        if (!taken[1] && t >= tele * 0.5f) Take(1, "预警", "蜷身、落点圈");
                        if (!taken[2] && t >= tele * 0.9f)
                        {
                            Take(2, "蓄力顶点", "蜷到最紧");
                            SnapEye(id, label, 7, "第一人称", c, "蓄力顶点 · 玩家视角");
                        }
                        break;
                    case BurnDives.Leg.Dive when !taken[3] && t >= BurnDives.DiveTime * 0.55f:
                        Take(3, "释放帧", "伸展俯冲（拖影）");
                        break;
                    case BurnDives.Leg.Recover:
                        if (!taken[4] && t >= 0.03f) Take(4, "释放帧", "砸地后 1 帧");
                        if (!taken[5] && t >= 0.3f) Take(5, "持续段", "火环推出去");
                        if (!taken[6] && t >= BurnDives.LandRecover * 0.9f) Take(6, "收招");
                        break;
                }
                yield return null;

                void Take(int k, string beat, string note = null)
                {
                    taken[k] = true;
                    Snap(id, label, k, beat, boss.BodyCenter + Vector3.up * 0.5f, 7f, note);
                }
            }
            Report(label, "hit", activeAt, start);
            // 三踏和喘息让它自己走完
            yield return WaitIdle();
        }

        IEnumerator Defeat()
        {
            yield return WaitIdle();
            ReadyPlayer(12f);
            guard?.Dispose();
            guard = null;
            FxBudget.ResetPeak();
            Combat.Execute(boss.Health, false);
            float s0 = Time.time, secs = boss.Def.defeat.seconds;
            var beats = new (float at, string beat, string note)[]
            {
                (0.15f, "释放帧", "倒下"), (0.7f, "持续段", "熔浆淌落、落地溅射"), (secs * 0.9f, "收招", "熔池最后一喷"), (secs * 0.99f, "余韵", "净火归瑞"),
                (secs * 0.99f + 0.6f, "余韵", "祥云升起"),
            };
            int k = 0;
            while (k < beats.Length && Time.time - s0 < secs + 4f)
            {
                KeepPlayerAlive();
                var c = boss ? boss.BodyCenter + Vector3.up : arena.Center;
                Aim(motor, eye, c);
                if (Time.time - s0 >= beats[k].at)
                {
                    Snap("defeat", "倒下", k, beats[k].beat, c, 7f, beats[k].note);
                    if (k == 3) SnapEye("defeat", "倒下", 7, "第一人称", c, "净火归瑞 · 玩家视角");
                    k++;
                }
                yield return null;
            }
            Line($"倒下：同屏粒子峰值 {FxBudget.Peak}");
        }
    }

    /// <summary>
    /// 精英词缀与金环的节拍条（Q 路；bridge.sh playtest beats-affix [场景]；设计单 docs/art/vfx/elite-affixes.md）：
    /// 四种词缀各一只精英（跳鼠刀兵，AI 停住、站成一排）在玩家前方 8 m：先拍一排金环 + 纹样（第三人称俯看、第一人称平视），
    /// 再按「蓄 → 爆」拍爆裂的死亡（死亡 = 起手、0.45 s = 预警 / 蓄、0.9 s = 蓄力顶点、引信到点 = 释放帧、+0.35 s = 余韵），
    /// 狂暴触发（释放帧 + 持续段）、坚盾破盾。默认 TestArena；在 1-1 / 2-1 / 3-1 各跑一次就是三章地面上的读感（截图目录按场景名分开）。
    /// </summary>
    public sealed class EliteAffixBeatsSuite : HBeatSuite
    {
        public override string Id => "beats-affix";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        const string Tag = "beats_affix";
        const string Body = "jerboa_blade";

        readonly List<EnemyAI> spawned = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.2f);
            if (!Setup(Tag)) yield break;
            string scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name;
            var p0 = motor.transform.position;
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, fwd);
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var center = arena ? arena.Center : p0 + fwd * 9f;
            if (arena)
            {
                arena.Clear();
                var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
                away.y = 0;
                fwd = away.sqrMagnitude > 1e-4f ? -away.normalized : fwd;
                side = Vector3.Cross(Vector3.up, fwd);
            }
            Teleport(motor, center - fwd * 8f);
            yield return null;
            string[] ids = { "swift", "shielded", "volatile", "frenzied" };
            string[] names = { "迅捷", "坚盾", "爆裂", "狂暴" };
            for (int i = 0; i < ids.Length; i++)
            {
                var at = center + side * ((i - 1.5f) * 3.2f);
                if (NavMesh.SamplePosition(at, out var hit, 4f, NavMesh.AllAreas)) at = hit.position;
                var ai = EnemyRoster.Spawn(Body, at, Quaternion.LookRotation(-fwd), 1f, true, new SpawnOptions { affix = ids[i] });
                if (!ai)
                {
                    Fail($"刷不出精英 {Body}（{ids[i]}）");
                    continue;
                }
                ai.Health.maxHealth *= 40f;
                ai.Health.ResetVitals();
                spawned.Add(ai);
                // 刷出来就站住（不追玩家、不出招），一排站好
                Freeze(ai);
            }
            yield return new WaitForSeconds(1.2f);
            Line($"场景 {scene}：{spawned.Count} 只精英，词缀 {string.Join(" / ", spawned.Select(EliteAffixes.AffixOf))}");
            var mid = center + Vector3.up * 0.4f;
            Teleport(motor, center - fwd * 9f);
            Aim(motor, eye, mid);
            yield return new WaitForSeconds(0.4f);
            Snap("sigils", $"金环与词缀纹样（{scene}）", 0, "起手", mid, 9f, "一排：迅捷 / 坚盾 / 爆裂 / 狂暴");
            SnapEye("sigils", $"金环与词缀纹样（{scene}）", 7, "第一人称", mid, "9 m 平视");
            // 每种近看：第三人称 4 m、0.3 s 后再一张（转动 / 跳动），第一人称 5 m
            for (int i = 0; i < spawned.Count; i++)
            {
                var a = spawned[i];
                if (!a) continue;
                var feet = a.transform.position + Vector3.up * 0.3f;
                string key = "sigil_" + EliteAffixes.AffixOf(a), label = $"精英 · {names[System.Array.IndexOf(ids, EliteAffixes.AffixOf(a))]}（{scene}）";
                Teleport(motor, a.transform.position - fwd * 5f);
                Aim(motor, eye, feet);
                yield return new WaitForSeconds(0.25f);
                Snap(key, label, 0, "起手", feet, 2f, "近景");
                yield return new WaitForSeconds(0.3f);
                Snap(key, label, 4, "持续段", feet, 2f, "0.3 s 后");
                SnapEye(key, label, 7, "第一人称", feet, "5 m");
            }
            Teleport(motor, center - fwd * 9f);
            Aim(motor, eye, mid);

            // 狂暴：血线 40% 以下触发
            var fr = spawned.FirstOrDefault(a => EliteAffixes.AffixOf(a) == "frenzied");
            if (fr)
            {
                Teleport(motor, fr.transform.position - fwd * 6f);
                Aim(motor, eye, fr.transform.position + Vector3.up);
                yield return new WaitForSeconds(0.2f);
                fr.Health.health = fr.Health.maxHealth * 0.35f;
                yield return null;
                yield return new WaitForSeconds(0.03f);
                Snap("frenzied", "狂暴触发", 3, "释放帧", fr.transform.position + Vector3.up, 4f);
                yield return new WaitForSeconds(0.45f);
                Snap("frenzied", "狂暴触发", 4, "持续段", fr.transform.position + Vector3.up, 4f, "锯齿牙高速转 + 心跳");
                SnapEye("frenzied", "狂暴触发", 7, "第一人称", fr.transform.position + Vector3.up, "狂暴后 · 玩家视角");
            }
            // 坚盾：打穿护盾
            var sh = spawned.FirstOrDefault(a => EliteAffixes.AffixOf(a) == "shielded");
            if (sh)
            {
                Teleport(motor, sh.transform.position - fwd * 6f);
                Aim(motor, eye, sh.transform.position + Vector3.up);
                yield return new WaitForSeconds(0.2f);
                var hp = sh.Health;
                Snap("shielded", "坚盾破盾", 1, "预警", sh.transform.position + Vector3.up, 4f, "满盾");
                Combat.DamageEnemy(hp, DamageInfo.Simple(hp.shield + 5f, DamageSource.Weapon, sh.transform.position + Vector3.up, Vector3.up));
                yield return new WaitForSeconds(0.05f);
                Snap("shielded", "坚盾破盾", 3, "释放帧", sh.transform.position + Vector3.up, 4f, "破盾");
                yield return new WaitForSeconds(0.6f);
                Snap("shielded", "坚盾破盾", 6, "收招", sh.transform.position + Vector3.up, 4f, "暗框（等回盾）");
            }
            // 爆裂：蓄 → 爆
            var vo = spawned.FirstOrDefault(a => EliteAffixes.AffixOf(a) == "volatile");
            if (vo)
            {
                var c = vo.transform.position + Vector3.up * 0.6f;
                // 站在爆炸圈外 3 m（7.5 m），机位框得住整圈
                Teleport(motor, vo.transform.position - fwd * 7.5f);
                Aim(motor, eye, c);
                yield return new WaitForSeconds(0.2f);
                FxBudget.ResetPeak();
                Combat.Execute(vo.Health, false);
                float d0 = Time.time, fuse = EliteAffix_Volatile.Fuse;
                var beats = new (float at, int order, string beat, string note)[]
                {
                    (0.05f, 0, "起手", "死亡：身上一闪、预警圈 + 火药星出现"), (fuse * 0.45f, 1, "预警", "星纹收缩、火星往圆心吸"), (fuse - 0.08f, 2, "蓄力顶点", "白热闪烁"),
                    (fuse + 0.05f, 3, "释放帧", "圈满即炸"), (fuse + 0.35f, 6, "收招", "余韵"),
                };
                int k = 0;
                while (k < beats.Length && Time.time - d0 < fuse + 2f)
                {
                    KeepPlayerAlive();
                    if (Time.time - d0 >= beats[k].at)
                    {
                        Snap("volatile", "爆裂 · 蓄 → 爆", beats[k].order, beats[k].beat, c, 3.5f, beats[k].note);
                        if (beats[k].order == 2) SnapEye("volatile", "爆裂 · 蓄 → 爆", 7, "第一人称", c, "蓄力顶点 · 玩家视角");
                        k++;
                    }
                    yield return null;
                }
                Line($"爆裂：引信 {fuse:F2} s，同屏粒子峰值 {FxBudget.Peak}（砍掉 {FxBudget.Dropped}）");
            }
            foreach (var a in spawned)
                if (a && !a.Dead)
                    Combat.Execute(a.Health, true);
            yield return new WaitForSeconds(0.5f);
            Teardown(Tag);
        }

        /// <summary>精英站住不动（不追玩家、不出招），金环和纹样照常转</summary>
        static void Freeze(EnemyAI a)
        {
            if (!a) return;
            a.enabled = false;
            var ag = a.GetComponent<NavMeshAgent>();
            if (ag && ag.enabled && ag.isOnNavMesh) ag.isStopped = true;
        }
    }
}
