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
    /// 第四章雷魅的出手节拍条（E 路，bridge.sh playtest beats-ch4-foes；设计单 docs/art/vfx/foes-ch4.md）：测试场里逐只刷（不掉血、玩家不还手），
    /// 强制出招，按招式时间轴拍 起手（前摇 0.06 s）/ 预警（前摇 70%）/ 释放帧（释放事件的下一帧）/ 持续段（出手段一半）/ 收招（收招段 40%）/ 第一人称（释放帧同一刻）。
    /// 每张拍时记下「这一刻在时间轴上的秒数」和释放事件是动画事件还是时间兜底触发的、与时间轴差多少（节拍条的说明栏）。
    /// 截图在 Assets/Art/_Review/beats/ch4-foes/（manifest.json 给 scripts/unity/beat_strips.py 拼图）。
    /// </summary>
    public sealed class Ch4FoesBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-ch4-foes";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        sealed class Beat
        {
            public string enemy, key, label, release;
            /// <summary>玩家离它多远</summary>
            public float stand;
            public Action<PlateauEnemyAI> go;
            /// <summary>同群要先刷的（连鼓灵的同伴、蛮蛮的另一只）</summary>
            public string[] with = Array.Empty<string>();
            public bool storm;
        }

        static readonly Beat[] Table =
        {
            new() { enemy = "marmot", key = "marmot_scream", label = "啸獭 · 尖啸（哨兵）", release = "shout", stand = 12f, go = a => ((MarmotAI)a).ForceScream() },
            new() { enemy = "marmot", key = "marmot_burrow", label = "啸獭 · 钻洞", release = "hide", stand = 6f, go = a => ((MarmotAI)a).ForceBurrow() },
            new() { enemy = "tiangou", key = "tiangou_howl", label = "天狗 · 雷吠 → 落雷", release = "lock", stand = 14f, go = a => ((TiangouAI)a).Force("howl") },
            new() { enemy = "tiangou", key = "tiangou_pounce", label = "天狗 · 扑咬（手 K）", release = "hit", stand = 4.5f, go = a => ((TiangouAI)a).Force("pounce") },
            new() { enemy = "aoyin", key = "aoyin_stampede", label = "獓狠 · 刨地 → 踩踏（手 K 起步）", release = "hit", stand = 20f, go = a => ((AoyinAI)a).Force("stampede") },
            new() { enemy = "aoyin", key = "aoyin_slam", label = "獓狠 · 雷球砸地（手 K）", release = "hit", stand = 9f, go = a => ((AoyinAI)a).Force("slam") },
            new() { enemy = "aoyin", key = "aoyin_gore", label = "獓狠 · 四角挑", release = "hit", stand = 3.5f, go = a => ((AoyinAI)a).Force("gore") },
            new() { enemy = "aoyin", key = "leiyak_stampede", label = "雷牦 · 跟獓狠领群踩踏（两侧平行）", release = "hit", stand = 22f, with = new[] { "leiyak", "leiyak" }, go = a => ((AoyinAI)a).Force("stampede") },
            new() { enemy = "jufu", key = "jufu_throw", label = "举父 · 远投雷石（手 K）", release = "release", stand = 14f, storm = true, go = a => ((JufuAI)a).Force("throw") },
            new() { enemy = "manman", key = "manman_sweep", label = "蛮蛮 · 成对电弧横扫（手 K）", release = "hit", stand = 12f, with = new[] { "manman" }, go = a => ((ManmanAI)a).StartSweep() },
            new() { enemy = "liangu", key = "liangu_beat", label = "连鼓灵 · 骨槌击鼓（手 K 曲线）", release = "beat", stand = 9f, with = new[] { "tiangou", "tiangou" }, go = a => ((LianguAI)a).Force("beat") },
            new() { enemy = "liangu", key = "liangu_clap", label = "连鼓灵 · 惊雷", release = "hit", stand = 4f, with = new[] { "tiangou" }, go = a => ((LianguAI)a).Force("clap") },
            new() { enemy = "dijiang", key = "dijiang_swell", label = "帝江 · 球雷", release = "hit", stand = 2.2f, go = a => ((DijiangAI)a).ForceSwell() },
            new() { enemy = "qiongqi", key = "qiongqi_glide", label = "穷奇 · 掠空扑杀（手 K，精英）", release = "hit", stand = 16f, go = a => ((QiongqiAI)a).Force("glide") },
            new() { enemy = "qiongqi", key = "qiongqi_spin", label = "穷奇 · 翼刃雷旋（精英）", release = "hit", stand = 2.8f, go = a => ((QiongqiAI)a).Force("spin") },
            new() { enemy = "qiongqi", key = "qiongqi_absorb", label = "穷奇 · 吞雷（精英）", release = "eat", stand = 8f, go = a => ((QiongqiAI)a).Force("absorb") },
        };

        ArenaSpawner arena;
        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        KunPengBeatsSuite.Cam cam;
        Vector3 away;
        string fired;
        float firedAt, firedDt;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail("缺少测试场组件");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Add("beats_ch4", Stat.MaxHp, 50000);
            vitals.Heal(99999);
            var restore = PlateauTestKit.InstallCatalog(Line);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            cam = new KunPengBeatsSuite.Cam("ch4-foes", Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "ch4-foes"), "TestArena", weapons.eye, motor);
            try
            {
                foreach (var b in Table)
                {
                    if (!ArenaSpawner.IsRegistered(b.enemy)) continue;
                    yield return Capture(b);
                }
            }
            finally
            {
                PlateauEnemyAI.StormOverride = null;
                vitals.stats.Remove("beats_ch4");
                arena.Clear();
                restore?.Invoke();
                Line($"节拍条：{cam.Count} 张");
                cam.Dispose();
            }
        }

        /// <summary>站到它正前方 stand 米（它没有朝向时站在离开测试场中心的那一侧）</summary>
        void StandBefore(PlateauEnemyAI ai, float stand)
        {
            var fwd = ai.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : away;
            Teleport(motor, ai.transform.position + fwd * stand);
        }

        IEnumerator Capture(Beat b)
        {
            arena.Clear();
            AttackTokens.Reset();
            PlateauPack.Reset();
            PlateauEnemyAI.StormOverride = b.storm ? 1f : null;
            yield return new WaitForSeconds(0.3f);
            Teleport(motor, arena.Center + away * 16f);
            yield return null;
            var mates = new List<PlateauEnemyAI>();
            for (int i = 0; i < b.with.Length; i++)
            {
                var m = arena.Spawn(b.with[i], false, -away * 6f + Vector3.right * (2.5f + 2.5f * i)) as PlateauEnemyAI;
                if (m) mates.Add(m);
            }
            var ai = arena.Spawn(b.enemy, b.enemy == "qiongqi", -away * 6f) as PlateauEnemyAI;
            if (!ai)
            {
                Fail($"{b.label}：刷不出 {b.enemy}");
                yield break;
            }
            // 不掉血、不死（拍完整一招）
            var guards = new List<IDisposable> { ai.Health.Incoming.Add((in IncomingHit h) => 0f) };
            foreach (var m in mates) guards.Add(m.Health.Incoming.Add((in IncomingHit h) => 0f));
            foreach (var m in mates)
                if (m is ManmanAI mm)
                    mm.holdFire = true;
            if (ai is ManmanAI am) am.holdFire = true;
            if (ai is TiangouAI tg) tg.forcePounce = true;
            yield return new WaitForSeconds(1.2f);
            // 站到它正前方 stand 米、看着它（它这时可能已经自己发现玩家在出招：拍之前先打断）
            StandBefore(ai, b.stand);
            yield return null;
            Aim(motor, weapons.eye.transform, ai.Center);
            yield return new WaitForSeconds(0.25f);
            fired = null;
            string want = null;
            PlateauMove wantDef = null;
            void OnEvt(PlateauEnemyAI who, string e)
            {
                // 只认强制出的那一招的释放事件（它自己先出的招不算）；释放就收场的招（帝江胀爆自己死）派发到这里时招已经结束，Id 为空、T 归零，按时间轴记
                if (who == ai && want != null && (who.Move.Id == want || !who.Move.Busy) && e == b.release && fired == null)
                {
                    fired = e;
                    firedAt = who.Move.Busy ? who.Move.T : wantDef != null ? wantDef.Timeline().Find(x => x.name == e).at : 0f;
                    firedDt = Time.deltaTime;
                }
            }
            ai.MoveEvent += OnEvt;
            try
            {
                // 同一帧：打断它自己在出的招、重新站到它正前方、唤醒、强制出招（不给它的 AI 插一招的机会）
                if (ai.Move.Busy) ai.InterruptAttack();
                StandBefore(ai, b.stand);
                Aim(motor, weapons.eye.transform, ai.Center);
                foreach (var m in mates) m.Notice(false);
                ai.Notice(false);
                b.go(ai);
                want = ai.Move.Busy ? ai.Move.Id : null;
                wantDef = ai.Move.Def;
                yield return null;
                if (!ai || !ai.Move.Busy)
                {
                    Line($"{b.label}：没出招（状态 {(ai ? ai.State : "无")}）");
                    yield break;
                }
                var def = ai.Move.Def;
                string id = def.id;
                float size = Mathf.Max(1f, ai.transform.localScale.x * (b.enemy == "aoyin" ? 3f : b.enemy == "qiongqi" ? 2f : 1.2f));
                bool started = false, warned = false, released = false, mid = false, rec = false;
                float t0 = Time.time;
                while (ai && Time.time - t0 < def.Total + 2f && !rec)
                {
                    vitals.Heal(99999);
                    var T = ai.Move.Busy && ai.Move.Id == id ? ai.Move.T : def.Total;
                    if (!started && T >= Mathf.Min(0.06f, def.windup * 0.5f))
                    {
                        started = true;
                        cam.Spec(b.key, b.label, "起手", 0, ai.Center, size, true, $"{T:0.00} s");
                    }
                    if (!warned && def.windup > 0.15f && T >= def.windup * 0.7f)
                    {
                        warned = true;
                        cam.Spec(b.key, b.label, "预警", 1, ai.Center, size, true, $"{T:0.00} s");
                    }
                    if (!released && fired != null)
                    {
                        released = true;
                        yield return null; // 释放帧的下一帧：特效第一帧画出来
                        var cue = ai.Move.CueDelta.TryGetValue(b.release, out var c) ? c : (0f, false);
                        // 差 = 出手那一刻 − 时间轴时刻；拍照本身会造成尖峰帧（渲染 + 读回 + 存 jpg），差超过一帧时看「那一帧」多长
                        string note = $"{firedAt:0.00} s · {(cue.Item2 ? "动画事件" : "时间轴")} · 差 {cue.Item1 * 1000:0} ms（那一帧 {firedDt * 1000:0} ms）";
                        cam.Spec(b.key, b.label, "释放帧", 3, ai.Center, size, true, note);
                        cam.Eye(b.key, b.label, "第一人称", 6, ai.Center, note);
                        continue;
                    }
                    if (released && !mid && def.active > 0.3f && T >= def.windup + Mathf.Min(def.active, ai.Move.ActiveLength) * 0.5f)
                    {
                        mid = true;
                        cam.Spec(b.key, b.label, "持续段", 4, ai.Center, size, true, $"{T:0.00} s");
                    }
                    if (released && (T >= def.windup + ai.Move.ActiveLength + def.recover * 0.4f || !ai.Move.Busy))
                    {
                        rec = true;
                        cam.Spec(b.key, b.label, "收招", 5, ai ? ai.Center : Vector3.zero, size, true, $"{T:0.00} s");
                    }
                    yield return null;
                }
                if (!released) Line($"{b.label}：没等到释放事件 {b.release}");
                else Line($"{b.label}：拍完（释放 {firedAt:0.00} s）");
            }
            finally
            {
                if (ai) ai.MoveEvent -= OnEvt;
                foreach (var g in guards) g.Dispose();
            }
        }
    }
}
