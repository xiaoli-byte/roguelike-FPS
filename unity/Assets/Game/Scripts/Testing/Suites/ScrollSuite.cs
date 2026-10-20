using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 秘卷冒烟（bridge.sh playtest scrolls；场景 TestArena，docs/unity-parity.md 7.4「每卷秘卷」）：
    ///   · 逐卷：注册表里的每一卷（<see cref="ScrollLibrary.All"/>，别的英雄的专属卷跳过）先设 1 层、在刷怪台上打一会儿，再设满层打一会儿，然后整卷移除。
    ///     每卷记一行：期间的运行时报错数、触发次数（<see cref="GameEvents.ScrollProc"/>）、击杀数；
    ///     不合格：属性表 / 玩家 / 敌人出现非有限值；移除后秘卷任务没回到原数（<see cref="ScrollTicker.TaskCount"/>）或属性来源没撤干净。
    ///     输出 / 受伤修饰器的数目只报告不判（灵宠、敌人增益也会增删）。运行时报错由宿主记不合格，这里按卷归账。
    ///   · 合练：全部 1 层打 <see cref="SoakOneSeconds"/> 秒、全部满层打 <see cref="SoakMaxSeconds"/> 秒（卷与卷之间的联动、连锁爆炸不爆栈），同样查有限值。
    /// 「打」= 刷怪台上保持 <see cref="Crowd"/> 只普通敌人（生命 ×0.7，打死就补），玩家瞄最近的敌人开火；
    /// 每 1.3 秒把弹匣压到 1 发并换弹（换弹类秘卷）、每 0.5 秒给随机一只敌人挂随机元素（元素类秘卷、反应）、每 3 秒切枪。
    /// 每卷的时长按卷数自动分配（总预算 <see cref="PerScrollBudget"/> 秒，单个状态 0.6–3 秒），后面的单元加卷不用改这里。
    /// 聚焦：Library/SpiritfireBridge/playtest-focus.txt 写秘卷 id 或前缀（逗号 / 空格分隔，如「tac_ rx_ wildfire」）→ 只跑这些（读完即删）。
    /// </summary>
    public sealed class ScrollSuite : PlaytestSuite
    {
        public override string Id => "scrolls";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Source = "playtest_scrolls";
        const int Crowd = 4;
        const float PerScrollBudget = 330f, MinPhase = 0.6f, MaxPhase = 3f, SoakOneSeconds = 12f, SoakMaxSeconds = 18f, StandOff = 9f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;
        List<string> enemyIds;
        int spawnIndex, logErrors;
        string lastError;
        readonly Dictionary<string, int> procs = new();

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
            eye = weapons.eye.transform;
            enemyIds = EnemyRoster.All.Where(d => d.rank != Rank.Boss).Select(d => d.id).ToList();
            if (enemyIds.Count == 0)
            {
                Fail("名册里没有普通敌人");
                yield break;
            }
            Application.logMessageReceived += OnLog;
            GameEvents.ScrollProc += OnProc;
            try
            {
                vitals.stats.Add(Source, Stat.MaxHp, 5000);
                vitals.Heal(99999);
                ScrollSandbox.Clear();
                PlaceStandOff();

                string hero = ScrollRoll.ContextFor(ScrollSandbox.Inventory, vitals).heroId;
                var all = Focus(ScrollLibrary.All.ToList());
                var defs = all.Where(d => d.heroOnly == null || d.heroOnly == hero).ToList();
                var skipped = all.Where(d => !defs.Contains(d)).Select(d => d.id).ToList();
                float phase = defs.Count > 0 ? Mathf.Clamp(PerScrollBudget / (2f * defs.Count), MinPhase, MaxPhase) : MaxPhase;
                Line($"秘卷：{defs.Count} 卷（英雄 {hero}），每卷 1 层 / 满层各打 {phase:F1} s；敌人 {string.Join("、", enemyIds)}" +
                     (skipped.Count > 0 ? $"；跳过别的英雄专属：{string.Join("、", skipped)}" : ""));

                foreach (var def in defs) yield return Case(def, phase);
                yield return Soak(defs, false, SoakOneSeconds);
                yield return Soak(defs, true, SoakMaxSeconds);
            }
            finally
            {
                weapons.testFire = false;
                ScrollSandbox.Clear();
                if (arena) arena.Clear();
                vitals.stats.Remove(Source);
                Application.logMessageReceived -= OnLog;
                GameEvents.ScrollProc -= OnProc;
            }
            Line($"合计：武器命中 {Runner.hits}，伤害 {Runner.damage:F0}，暴击 {Runner.crits}，击杀 {Runner.kills}，触发 {procs.Values.Sum()} 次，" +
                 $"反应 {string.Join(" ", Runner.reactionsById.Select(kv => $"{kv.Key}×{kv.Value}"))}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnProc(string id)
        {
            procs.TryGetValue(id ?? "", out var n);
            procs[id ?? ""] = n + 1;
        }

        /// <summary>聚焦文件里的 id / 前缀；没有聚焦文件时原样返回</summary>
        List<ScrollDef> Focus(List<ScrollDef> all)
        {
            var path = string.IsNullOrEmpty(ResultPath) ? null : Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", "playtest-focus.txt");
            if (path == null || !File.Exists(path)) return all;
            var keys = File.ReadAllText(path).Split(new[] { ',', ' ', '\n', '\r', '\t', '，', '、' }, StringSplitOptions.RemoveEmptyEntries);
            File.Delete(path);
            if (keys.Length == 0) return all;
            var picked = all.Where(d => keys.Any(k => d.id == k || (k.EndsWith("_") && d.id.StartsWith(k, StringComparison.Ordinal)))).ToList();
            Line($"聚焦：{string.Join("、", keys)} → {picked.Count} 卷");
            return picked;
        }

        // ───────────── 逐卷 ─────────────

        IEnumerator Case(ScrollDef def, float phase)
        {
            int err0 = logErrors, kills0 = Runner.kills;
            procs.TryGetValue(def.id, out var procs0);
            int tasks0 = ScrollTicker.TaskCount, out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count;
            var notes = new List<string>();

            int one = ScrollSandbox.SetStacks(def.id, 1);
            if (one != 1) Fail($"{def.name}（{def.id}）：设 1 层得到 {one} 层");
            yield return Fight(phase);
            CheckFinite($"{def.id} 1 层", notes);

            int max = ScrollSandbox.Max(def.id);
            if (max != def.maxStacks) Fail($"{def.name}（{def.id}）：设满层得到 {max} 层（上限 {def.maxStacks}）");
            yield return Fight(phase);
            CheckFinite($"{def.id} 满层", notes);

            ScrollSandbox.Remove(def.id);
            if (ScrollTicker.TaskCount != tasks0) Fail($"{def.name}（{def.id}）：移除后秘卷任务 {ScrollTicker.TaskCount}（之前 {tasks0}）");
            foreach (var src in Sources(def.id))
                if (vitals.stats.HasSource(src))
                    Fail($"{def.name}（{def.id}）：移除后属性来源 {src} 还在");
            if (Combat.Outgoing.Count != out0) notes.Add($"输出修饰器 {out0}→{Combat.Outgoing.Count}");
            if (PlayerVitals.Incoming.Count != in0) notes.Add($"受伤修饰器 {in0}→{PlayerVitals.Incoming.Count}");

            procs.TryGetValue(def.id, out var procs1);
            int errs = logErrors - err0;
            Line($"{def.name}（{def.id}，{Rarity.Names[Rarity.Clamp(def.rarity)]}，1 / {def.maxStacks} 层）：报错 {errs}，触发 {procs1 - procs0}，击杀 {Runner.kills - kills0}" +
                 (errs > 0 ? $"（最后一条：{lastError}）" : "") + (notes.Count > 0 ? "；" + string.Join("；", notes) : ""));
        }

        /// <summary>某卷可能用到的属性来源：主来源 + 限时增益 / 条件属性子来源</summary>
        static IEnumerable<string> Sources(string id)
        {
            var main = ScrollScope.SourceOf(id);
            yield return main;
            for (int i = 0; i < 8; i++)
            {
                yield return $"{main}#buff{i}";
                yield return $"{main}#toggle{i}";
            }
        }

        // ───────────── 合练 ─────────────

        IEnumerator Soak(List<ScrollDef> defs, bool maxed, float seconds)
        {
            int err0 = logErrors, kills0 = Runner.kills, procs0 = procs.Values.Sum();
            var sheet = vitals.stats;
            sheet.BeginBatch();
            int n = 0;
            try
            {
                foreach (var d in defs)
                    if (ScrollSandbox.SetStacks(d.id, maxed ? d.maxStacks : 1) > 0)
                        n++;
            }
            finally
            {
                sheet.EndBatch();
            }
            var notes = new List<string>();
            float half = seconds * 0.5f;
            yield return Fight(half);
            if (maxed) Shot(weapons.eye, "scrolls_soak_max");
            yield return Fight(seconds - half);
            CheckFinite(maxed ? "全部满层" : "全部 1 层", notes);
            int errs = logErrors - err0;
            Line($"合练（{(maxed ? "满层" : "1 层")} × {n} 卷，{seconds:F0} s）：报错 {errs}，触发 {procs.Values.Sum() - procs0}，击杀 {Runner.kills - kills0}，" +
                 $"伤害 +{sheet.Get(Stat.DamagePct):P0}、暴击 {sheet.Get(Stat.CritChance):P0}、射速 +{sheet.Get(Stat.FireRatePct):P0}" +
                 (errs > 0 ? $"（最后一条：{lastError}）" : "") + (notes.Count > 0 ? "；" + string.Join("；", notes) : ""));
            ScrollSandbox.Clear();
        }

        // ───────────── 打 ─────────────

        void PlaceStandOff()
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Teleport(motor, arena.Center + away * StandOff);
            Aim(motor, eye, arena.Center + Vector3.up);
        }

        /// <summary>打 seconds 秒（不受时间缩放影响：顿帧、慢动作不会拖长；模态把时间停住超过 3 秒记不合格并提前结束）</summary>
        IEnumerator Fight(float seconds)
        {
            float t0 = Time.unscaledTime, frozenSince = -1;
            float nextReload = t0 + 0.9f, nextElement = t0 + 0.3f, nextSwitch = t0 + 2.5f, nextReposition = t0;
            while (Time.unscaledTime - t0 < seconds)
            {
                if (Time.timeScale <= 0)
                {
                    if (frozenSince < 0) frozenSince = Time.unscaledTime;
                    else if (Time.unscaledTime - frozenSince > 3f)
                    {
                        Fail($"时间停住超过 3 秒（状态 {GameStateMachine.Current}）");
                        break;
                    }
                    yield return null;
                    continue;
                }
                frozenSince = -1;
                Upkeep();
                KeepCrowd();
                var target = NearestEnemy(motor.transform.position);
                var w = weapons.Active;
                if (target && w != null)
                {
                    var aim = BodyCenter(target);
                    float dist = Vector3.Distance(eye.position, aim);
                    if (Time.unscaledTime >= nextReposition && (dist > 20f || Combat.Blocked(eye.position, aim, null)))
                    {
                        nextReposition = Time.unscaledTime + 1.2f;
                        if (SightSpot(target, aim, out var spot)) Teleport(motor, spot);
                        else PlaceStandOff();
                    }
                    Aim(motor, eye, aim);
                    // 半自动枪要一下一下扣
                    weapons.testFire = w.def.mode != FireMode.Semi || !weapons.testFire;
                }
                else weapons.testFire = false;

                if (Time.unscaledTime >= nextReload && w != null)
                {
                    nextReload = Time.unscaledTime + 1.3f;
                    if (w.mag > 1) w.mag = 1;
                    weapons.testReload = true;
                }
                if (Time.unscaledTime >= nextElement)
                {
                    nextElement = Time.unscaledTime + 0.5f;
                    ElementTouch();
                }
                if (Time.unscaledTime >= nextSwitch)
                {
                    nextSwitch = Time.unscaledTime + 3f;
                    int other = 1 - weapons.ActiveSlot;
                    if (other >= 0 && other < weapons.slots.Length && weapons.slots[other] != null) weapons.testSwitch = other;
                }
                yield return null;
            }
            weapons.testFire = false;
        }

        void Upkeep()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
            var w = weapons.Active;
            if (w != null && w.def != null) w.reserve = Mathf.Max(w.reserve, w.def.reserve); // 测试不缺子弹
        }

        void KeepCrowd()
        {
            int alive = arena.Spawned.Count(a => a && !a.Dead);
            for (int i = alive; i < Crowd; i++)
            {
                var id = enemyIds[spawnIndex++ % enemyIds.Count];
                var ai = arena.Spawn(id, false, null);
                if (!ai || !ai.Health) continue;
                ai.Health.maxHealth *= 0.7f;
                ai.Health.ResetVitals();
            }
        }

        /// <summary>给随机一只活着的敌人挂随机元素（强度 = 它最大生命的 4%，深度 0：会引发反应）</summary>
        static void ElementTouch()
        {
            var live = EnemyAI.All.Where(a => a && a.Health && !a.Dead && !a.Health.untargetable).ToList();
            if (live.Count == 0) return;
            var d = live[Random.Range(0, live.Count)].Health;
            var e = (Element)Random.Range(1, 4);
            Combat.ApplyElement(d, e, d.maxHealth * 0.04f);
        }

        // ───────────── 检查 ─────────────

        static readonly Stat[] AllStats = (Stat[])Enum.GetValues(typeof(Stat));

        void CheckFinite(string label, List<string> notes)
        {
            var sheet = vitals.stats;
            var bad = new List<string>();
            foreach (var s in AllStats)
            {
                float v = sheet.Get(s);
                if (!float.IsFinite(v)) bad.Add($"{s}={v}");
            }
            if (!float.IsFinite(vitals.health) || !float.IsFinite(vitals.shield)) bad.Add($"玩家生命 {vitals.health} / 护盾 {vitals.shield}");
            foreach (var a in EnemyAI.All)
            {
                var h = a ? a.Health : null;
                if (h && (!float.IsFinite(h.health) || !float.IsFinite(h.shield) || !float.IsFinite(h.armor))) bad.Add($"{h.displayName} 生命 {h.health}");
            }
            if (bad.Count > 0) Fail($"{label}：非有限值 {string.Join("、", bad)}");
            if (vitals.Dead) notes.Add($"{label} 时玩家阵亡");
        }
    }
}
