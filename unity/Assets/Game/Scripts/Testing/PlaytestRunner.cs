using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 自动冒烟测试的宿主（bridge.sh playtest [套件] [场景]）：编辑器一侧（Pipeline/Editor/Playtest.cs）进 Play 模式后把它挂到场景里，
    /// 按 <see cref="suite"/> 从登记表 <see cref="PlaytestSuites"/> 取套件（默认 slice11 = 1-1 切片冒烟，Suites/Slice11Suite.cs），
    /// 把套件的步骤当协程跑完，结果写成文本（首行「全部通过」/「不合格 N 项」，每加一行就落盘），截图存 Assets/Art/_Review/playtest_*.png。
    /// 宿主只管通用部分：结果文件与截图、运行时报错（Error / Exception 记一项不合格）、战斗计数（套件按需读取 / 清零）、收尾关掉各系统的 TestMode。
    /// 新套件只加 Suites/&lt;Name&gt;Suite.cs（继承 <see cref="PlaytestSuite"/>），不改这里。
    /// </summary>
    public sealed class PlaytestRunner : MonoBehaviour
    {
        public static bool Done;
        public string resultPath, shotDir;
        /// <summary>要跑的套件 id（空 = <see cref="PlaytestSuites.Default"/>）</summary>
        public string suite;

        readonly List<string> lines = new();
        int errors;

        // ── 战斗计数：挂上就订阅战斗事件（OnEnable），套件读取 / 清零 ──
        /// <summary>武器命中次数（技能、跳伤、灵宠不算）、其中暴击数、击杀数（任何来源）、技能命中次数、持续伤害跳数</summary>
        public int hits, crits, kills, skillHits, burnTicks;
        /// <summary>武器伤害合计、敌人对玩家的伤害、灵宠伤害合计</summary>
        public float damage, playerDamage, petDamage;
        /// <summary>按敌人显示名的击杀数 / 按反应名的反应次数</summary>
        public readonly Dictionary<string, int> killsById = new();
        public readonly Dictionary<string, int> reactionsById = new();

        /// <summary>目前记下的不合格项数</summary>
        public int Errors => errors;

        public void Line(string s)
        {
            lines.Add(s);
            Flush("进行中（未跑完）");
        }

        public void Fail(string s)
        {
            errors++;
            Line("✗ " + s);
        }

        /// <summary>每加一行就落盘：超时被强制退出时也能看到跑到了哪一步</summary>
        void Flush(string header)
        {
            if (string.IsNullOrEmpty(resultPath)) return;
            try { File.WriteAllText(resultPath, header + "\n" + string.Join("\n", lines), Encoding.UTF8); }
            catch (IOException) { }
        }

        void OnEnable()
        {
            Application.logMessageReceived += OnLog;
            Combat.EnemyDamaged += OnDamaged;
            Combat.EnemyKilled += OnKilled;
            Combat.PlayerDamaged += OnPlayerDamaged;
            ReactionSystem.Reacted += OnReacted;
        }

        void OnDisable()
        {
            Application.logMessageReceived -= OnLog;
            Combat.EnemyDamaged -= OnDamaged;
            Combat.EnemyKilled -= OnKilled;
            Combat.PlayerDamaged -= OnPlayerDamaged;
            ReactionSystem.Reacted -= OnReacted;
        }

        void OnReacted(Damageable d, Reaction id, Vector3 p, float b, int hits)
        {
            var k = ReactionSystem.Names[(int)id];
            reactionsById.TryGetValue(k, out var n);
            reactionsById[k] = n + 1;
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is LogType.Exception or LogType.Error) Fail($"运行时{type}：{msg}\n{stack}");
        }

        void OnDamaged(Damageable d, DamageInfo info, DamageResult r)
        {
            if (info.source == DamageSource.Pet)
            {
                petDamage += r.total;
                return;
            }
            if (info.source == DamageSource.Skill) skillHits++;
            if (info.source == DamageSource.Status) burnTicks++;
            if (info.source is DamageSource.Skill or DamageSource.Status) return;
            hits++;
            damage += r.total;
            if (r.crit) crits++;
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            kills++;
            killsById.TryGetValue(d.displayName ?? "?", out var n);
            killsById[d.displayName ?? "?"] = n + 1;
        }

        void OnPlayerDamaged(float amount, Vector3 from) => playerDamage += amount;

        void Start() => StartCoroutine(Run());

        /// <summary>取套件 → 逐步推进它的协程（套件 yield 出来的等待 / 子协程原样交给 Unity）→ 跑完后收尾</summary>
        IEnumerator Run()
        {
            string id = string.IsNullOrEmpty(suite) ? PlaytestSuites.Default : suite;
            var s = PlaytestSuites.Create(id);
            if (s == null)
            {
                Fail($"没有登记冒烟测试套件「{id}」（已登记：{string.Join("、", PlaytestSuites.Ids)}）");
                Finish();
                yield break;
            }
            var steps = s.Run(this);
            while (true)
            {
                object step;
                try
                {
                    if (!steps.MoveNext()) break;
                    step = steps.Current;
                }
                catch (Exception e)
                {
                    // 套件顶层抛异常：记一项不合格并收尾，不用等编辑器 600 s 超时（子协程里的异常照旧由 Unity 打日志 → OnLog 记不合格）
                    Fail($"套件 {id} 抛出异常：{e}");
                    break;
                }
                yield return step;
            }
            Finish();
        }

        /// <summary>用给定相机拍一张 1600×900，存 shotDir/playtest_&lt;name&gt;.png，结果里记一行</summary>
        public void Shot(Camera cam, string name)
        {
            if (string.IsNullOrEmpty(shotDir) || !cam) return;
            var rt = new RenderTexture(1600, 900, 24);
            var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            cam.targetTexture = prev;
            Directory.CreateDirectory(shotDir);
            File.WriteAllBytes(Path.Combine(shotDir, $"playtest_{name}.png"), tex.EncodeToPNG());
            Destroy(rt);
            Destroy(tex);
            Line($"截图 playtest_{name}.png");
        }

        void Finish()
        {
            WeaponController.TestMode = false;
            Interactor.TestMode = false;
            HeroSkills.TestMode = false;
            PetOwner.TestMode = false;
            Flush(errors == 0 ? "全部通过" : $"不合格 {errors} 项");
            Done = true;
        }
    }
}
