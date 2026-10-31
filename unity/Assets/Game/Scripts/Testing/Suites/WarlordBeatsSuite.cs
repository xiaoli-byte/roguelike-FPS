using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 节拍条录制器（首领与精英动作 · 特效调优 W 路，docs/art/vfx/warlord.md / elites-ch3.md 的「改前 / 改后」对比图）：
    /// 不驱动任何东西，套件用 <see cref="Arm"/> 交给它一个「现在处在哪一拍」的函数（W = 前摇、A = 出手、其余 = 不在招式里），它逐帧看着、按节拍拍：
    ///   起手（进前摇后第 2 帧）→ 预警 / 蓄力顶点（前摇最后一帧，预警填得最满）→ 释放帧（进出手后第 1 帧）→ 收招（出手后 recoverDelay 秒）
    ///   → 第一人称（前摇最后一帧，玩家眼睛转向出招者）。
    /// 旁观机位从侧面同时框住出招者和玩家（玩家处放一根青色胶囊替身）。截图 960×540 jpg + manifest.json，拼图交给 scripts/unity/boss_vfx_beats.py。
    /// </summary>
    [DefaultExecutionOrder(32000)]
    public sealed class WBeatCam : MonoBehaviour
    {
        public const int W = 960, H = 540;
        public static readonly string[] Beats = { "起手", "预警", "释放帧", "收招", "第一人称" };

        [Serializable]
        public sealed class Shot
        {
            /// <summary>招式 / 组（拼图按它分张，scripts/unity/beat_strips.py）、显示名、节拍、文件、备注</summary>
            public string move, label, beat, file, note;
            public int order;
            public float t;
        }

        [Serializable]
        sealed class Manifest
        {
            public string group, started;
            public List<Shot> shots = new();
        }

        string dir;
        Manifest manifest;
        Camera spec;
        GameObject standIn;
        RenderTexture hold, fp, scratch;
        Texture2D readback;
        WeaponController weapons;
        PlayerMotor motor;

        // 当前一组
        string label, prefix;
        Func<char> stage;
        Func<Vector3> subject;
        float size, recoverDelay;
        int step, frames;
        float releaseAt;
        bool haveHold;

        /// <summary>这一组拍完了（或被放弃）</summary>
        public bool Idle => label == null;
        public int Count => manifest?.shots.Count ?? 0;

        public void Begin(string group, string outDir)
        {
            dir = outDir;
            Directory.CreateDirectory(dir);
            foreach (var f in Directory.GetFiles(dir, "*.jpg")) File.Delete(f);
            manifest = new Manifest { group = group, started = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
            var go = new GameObject("Beat Camera");
            go.transform.SetParent(transform, false);
            spec = go.AddComponent<Camera>();
            spec.enabled = false;
            spec.fieldOfView = 46f;
            spec.nearClipPlane = 0.1f;
            spec.farClipPlane = 1500f;
            spec.cullingMask = ~(1 << Layers.FirstPerson);
            var data = spec.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            standIn = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            standIn.name = "Beat Player Stand-in";
            Destroy(standIn.GetComponent<Collider>());
            standIn.layer = Layers.IgnoreRaycast;
            standIn.transform.SetParent(transform, false);
            standIn.transform.localScale = new Vector3(0.7f, 0.9f, 0.7f);
            var sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (sh)
            {
                var mat = new Material(sh);
                mat.SetColor("_BaseColor", new Color(0.35f, 0.95f, 1f));
                standIn.GetComponent<Renderer>().sharedMaterial = mat;
            }
            standIn.SetActive(false);
            readback = new Texture2D(W, H, TextureFormat.RGB24, false);
            hold = new RenderTexture(W, H, 24);
            fp = new RenderTexture(W, H, 24);
            scratch = new RenderTexture(W, H, 24);
            Write();
        }

        /// <summary>开一组：stage() 返回 'W'（前摇）/ 'H'（前摇结束、还没到释放帧）/ 'A'（出手）/ 其余；subject() 出招者身体中心；size 体型（米）</summary>
        public void Arm(string label, string filePrefix, Func<char> stage, Func<Vector3> subject, float size, float recoverDelay = 0.35f)
        {
            this.label = label;
            prefix = filePrefix;
            this.stage = stage;
            this.subject = subject;
            this.size = Mathf.Max(1f, size);
            this.recoverDelay = recoverDelay;
            step = 0;
            frames = 0;
            haveHold = false;
        }

        public void Abort() => label = null;

        /// <summary>按时间拍一张（转阶段、狂怒、倒下这类不是招式的节拍）</summary>
        public void Single(string label, string beat, int order, string file, Vector3 subj, float sz, bool eye = false, string note = null, string move = null)
        {
            if (!Ready()) return;
            if (eye) RenderEye(scratch, subj);
            else RenderSpec(scratch, subj, Mathf.Max(1f, sz));
            Save(scratch, new Shot { move = move ?? label, label = label, beat = beat, order = order, note = note }, file);
        }

        /// <summary>指定机位拍一张（色样对照这类不跟人走的镜头，不放玩家替身）</summary>
        public void Pose(string label, string beat, int order, string file, Vector3 from, Vector3 lookAt, string move = null, string note = null)
        {
            if (!Ready()) return;
            spec.transform.position = from;
            spec.transform.LookAt(lookAt);
            var prev = spec.targetTexture;
            spec.targetTexture = scratch;
            spec.Render();
            spec.targetTexture = prev;
            Save(scratch, new Shot { move = move ?? label, label = label, beat = beat, order = order, note = note }, file);
        }

        bool Ready()
        {
            if (!weapons) weapons = FindAnyObjectByType<WeaponController>();
            if (!motor) motor = FindAnyObjectByType<PlayerMotor>();
            return manifest != null && weapons && weapons.eye && motor;
        }

        void LateUpdate()
        {
            if (label == null || !Ready()) return;
            char s;
            Vector3 c;
            try
            {
                s = stage();
                c = subject();
            }
            catch (Exception)
            {
                label = null;
                return;
            }
            switch (step)
            {
                case 0: // 等前摇
                    if (s != 'W') return;
                    step = 1;
                    frames = 0;
                    return;
                case 1: // 前摇中：第 2 帧拍起手，之后每帧覆盖蓄力顶点 + 第一人称
                    frames++;
                    if (frames == 2)
                    {
                        RenderSpec(scratch, c, size);
                        Save(scratch, new Shot { move = prefix, label = label, beat = Beats[0], order = 0 }, prefix + "_0");
                    }
                    if (s == 'W')
                    {
                        RenderSpec(hold, c, size);
                        RenderEye(fp, c);
                        haveHold = true;
                        return;
                    }
                    // 'H'：前摇已经结束、还在等释放帧（动作的刀到比判定晚一两帧）——预警那一格留在前摇最后一帧（预警填得最满），不再覆盖
                    if (s == 'H') return;
                    if (haveHold)
                    {
                        Save(hold, new Shot { move = prefix, label = label, beat = Beats[1], order = 1 }, prefix + "_1");
                        Save(fp, new Shot { move = prefix, label = label, beat = Beats[4], order = 4 }, prefix + "_4");
                    }
                    if (s != 'A')
                    {
                        label = null;
                        return;
                    }
                    step = 2;
                    frames = 0;
                    releaseAt = Time.time;
                    return;
                case 2: // 释放帧：进出手后第 1 帧
                    RenderSpec(scratch, c, size);
                    Save(scratch, new Shot { move = prefix, label = label, beat = Beats[2], order = 2 }, prefix + "_2");
                    step = 3;
                    return;
                default:
                    if (Time.time - releaseAt < recoverDelay) return;
                    RenderSpec(scratch, c, size);
                    Save(scratch, new Shot { move = prefix, label = label, beat = Beats[3], order = 3 }, prefix + "_3");
                    label = null;
                    return;
            }
        }

        void Save(RenderTexture rt, Shot e, string file)
        {
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            readback.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            readback.Apply(false);
            RenderTexture.active = prev;
            file = new string(file.Select(ch => char.IsLetterOrDigit(ch) && ch < 128 || ch is '_' or '-' ? ch : '_').ToArray()) + ".jpg";
            File.WriteAllBytes(Path.Combine(dir, file), readback.EncodeToJPG(90));
            e.file = file;
            e.t = Time.time;
            manifest.shots.Add(e);
            Write();
        }

        void Write()
        {
            try { File.WriteAllText(Path.Combine(dir, "manifest.json"), JsonUtility.ToJson(manifest, true)); }
            catch (IOException) { }
        }

        void RenderEye(RenderTexture rt, Vector3 lookAt)
        {
            var eye = weapons.eye;
            var t = eye.transform;
            var rot = t.rotation;
            var d = lookAt - t.position;
            if (d.sqrMagnitude > 0.01f) t.rotation = Quaternion.LookRotation(d);
            var prev = eye.targetTexture;
            eye.targetTexture = rt;
            eye.Render();
            eye.targetTexture = prev;
            t.rotation = rot;
        }

        /// <summary>侧面机位：同时框住出招者与玩家（玩家处放替身）；离得远时只框出招者</summary>
        void RenderSpec(RenderTexture rt, Vector3 subj, float sz)
        {
            var p = motor.transform.position + Vector3.up * 1.2f;
            var d = p - subj;
            d.y = 0;
            float dist = d.magnitude;
            var dir = dist > 0.1f ? d / dist : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, dir);
            Vector3 look, pos;
            if (dist > 15f + sz)
            {
                look = subj;
                float ds = 3f + sz * 2f;
                pos = subj + side * ds * 0.8f + dir * ds * 0.6f + Vector3.up * (0.5f + sz * 0.3f);
            }
            else
            {
                look = Vector3.Lerp(subj, p, 0.4f);
                float db = Mathf.Max(4.5f + sz, dist * 0.95f + sz * 1.2f);
                pos = look + side * db + dir * db * 0.2f + Vector3.up * (1.1f + sz * 0.3f + dist * 0.08f);
            }
            pos = Unblock(pos, look, side);
            spec.transform.position = pos;
            spec.transform.LookAt(look);
            standIn.transform.position = motor.transform.position + Vector3.up * 0.9f;
            standIn.SetActive(true);
            var prev = spec.targetTexture;
            spec.targetTexture = rt;
            spec.Render();
            spec.targetTexture = prev;
            standIn.SetActive(false);
        }

        static Vector3 Unblock(Vector3 pos, Vector3 look, Vector3 side)
        {
            Vector3 Ground(Vector3 q)
            {
                if (Physics.Raycast(q + Vector3.up * 40f, Vector3.down, out var h, 120f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && q.y < h.point.y + 0.6f)
                    q.y = h.point.y + 0.6f;
                return q;
            }
            bool Clear(Vector3 q) => !Physics.CheckSphere(q, 0.35f, Layers.WorldMask, QueryTriggerInteraction.Ignore) &&
                                     !Physics.Linecast(q, look, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            pos = Ground(pos);
            if (Clear(pos)) return pos;
            var mirror = Ground(look + Vector3.Reflect(pos - look, side));
            if (Clear(mirror)) return mirror;
            var high = Ground(pos + Vector3.up * 4f);
            if (Clear(high)) return high;
            if (Physics.Linecast(look, pos, out var hit, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return hit.point + (look - hit.point).normalized * 0.4f;
            return pos;
        }

        void OnDestroy()
        {
            foreach (var r in new[] { hold, fp, scratch })
                if (r)
                    Destroy(r);
            if (readback) Destroy(readback);
        }
    }

    /// <summary>
    /// 熔心魔将的节拍条（bridge.sh playtest beats-warlord；3-3 神范台）：首领不掉血，按设计单的招牌招式逐个强制出招，
    /// 每招拍起手 / 预警 / 释放帧 / 收招 / 第一人称（<see cref="WBeatCam"/>）；再拍 50% 转阶段、20% 狂怒的换挡、倒下。
    /// 截图在 Assets/Art/_Review/beats/warlord/。只看画面、不判合格（招式本身由 boss-warlord 套件守着）。
    /// </summary>
    public sealed class WarlordBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-warlord";
        public override string Scene => "Assets/Scenes/L3_3_Foundry.unity";

        static NavMeshQueryFilter Humanoid => LavaField.WalkerFilter();

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        WarlordBrain boss;
        WBeatCam cam;
        IDisposable guard;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail("缺少玩家组件（场景不是 3-3？）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            vitals.stats.Add("beats_warlord", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            RunState.Ensure();
            arena = BossArena.Find(WarlordDef.Id);
            if (!arena)
            {
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 22f, 20f, fwd, WarlordDef.Id);
            }
            Place(arena.PlayerEntryPoint);
            boss = Bosses.Spawn(WarlordDef.Id, arena, WarlordDef.StageDifficulty) as WarlordBrain;
            if (!boss)
            {
                Fail("魔将生成失败");
                yield break;
            }
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f)
            {
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
            cam = Runner.gameObject.AddComponent<WBeatCam>();
            cam.Begin("warlord", Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "warlord"));
            Line($"魔将：模型 {boss.Model?.source}，动作控制器 {(boss.Model?.root ? boss.Model.root.GetComponentInChildren<Animator>()?.runtimeAnimatorController?.name : "无")}");

            yield return Beat("warlord_sweep", "横扫 · 一阶段", 8f);
            yield return Beat("warlord_combo", "连斩 · 一阶段", 3.5f);
            yield return Beat("warlord_leap", "跃击 · 一阶段", 11f);
            yield return Beat("warlord_charge", "冲锋 · 一阶段", 14f);
            yield return Beat("warlord_meteor", "陨石雨 · 一阶段", 11f, 1.45f);

            // 50%：转阶段（引动熔铜渠），转换后第一招就是涨落
            yield return WaitIdle();
            Single("阶段 1 → 2", "常态", 0, "phase2_pre", "phase2");
            boss.Health.health = boss.Health.maxHealth * (WarlordDef.ChannelsAt - 0.01f);
            float t0 = Time.time;
            while (!boss.Transitioning && Time.time - t0 < 4f) yield return null;
            yield return Timed("阶段 1 → 2", "phase2", 0.35f, 1.1f, 1.9f);
            while (boss.Transitioning && Time.time - t0 < 10f) yield return null;
            yield return Beat("warlord_channels", "熔铜渠涨落 · 二阶段", 11f, 2.8f, force: false);
            yield return WaitChannelsDry();
            yield return Beat("warlord_sweep", "横扫 · 二阶段（反手再扫）", 8f, 1.3f);

            // 20%：狂怒换挡
            yield return WaitIdle();
            ReadyPlayer(9f);
            yield return null;
            Single("狂怒换挡", "换挡前", 0, "fury_pre", "fury");
            boss.Health.health = boss.Health.maxHealth * (WarlordDef.FuryAt - 0.01f);
            t0 = Time.time;
            while (!boss.Transitioning && Time.time - t0 < 4f) yield return null;
            yield return Timed("狂怒换挡", "fury", 0.3f, 1.0f, 1.9f);
            while (boss.Transitioning && Time.time - t0 < 10f) yield return null;
            yield return new WaitForSeconds(1.2f);
            Single("狂怒换挡", "换挡后", 4, "fury_post", "fury");
            cam.Single("狂怒换挡", "第一人称", 5, "fury_post_fp", boss.BodyCenter, 4f, true, move: "fury");
            yield return WaitIdle();
            yield return Beat("warlord_combo", "连斩 · 狂怒（四斩）", 3.5f, 1.0f);
            yield return Beat("warlord_charge", "冲锋 · 狂怒（连冲）", 14f);
            yield return Beat("warlord_leap", "跃击 · 狂怒", 11f);

            yield return PerfCompare();

            // 倒下
            yield return WaitIdle();
            ReadyPlayer(10f);
            guard?.Dispose();
            guard = null;
            float k0 = Time.time;
            while (!boss.Dead && Time.time - k0 < 10f)
            {
                if (!boss.Health.untargetable)
                {
                    var info = DamageInfo.Simple(999999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(boss.Health, info);
                }
                yield return null;
            }
            var center = boss ? boss.BodyCenter : arena.Center + Vector3.up * 2f;
            float secs = boss && boss.Def != null ? boss.Def.defeat.seconds : 3.2f;
            float d0 = Time.time;
            foreach (var (at, beat, i) in new[] { (0.3f, "倒下", 0), (secs * 0.45f, "溃散", 1), (secs * 0.85f, "化铜", 2), (secs + 0.8f, "余韵", 3) })
            {
                while (Time.time - d0 < at) yield return null;
                cam.Single("倒下", beat, i, $"death_{i}", center, 4f, move: "death");
            }
            Line($"节拍条：{cam.Count} 张");
            guard?.Dispose();
            vitals.stats.Remove("beats_warlord");
            if (boss && !boss.Dead) Destroy(boss.gameObject);
        }

        void Single(string label, string beat, int order, string file, string move) => cam.Single(label, beat, order, file, boss.BodyCenter, 4f, move: move);

        IEnumerator Timed(string label, string file, params float[] at)
        {
            float t0 = Time.time;
            string[] names = { "起", "中", "成" };
            for (int i = 0; i < at.Length; i++)
            {
                while (Time.time - t0 < at[i]) yield return null;
                if (boss) cam.Single(label, names[Mathf.Min(i, names.Length - 1)], i + 1, $"{file}_{i}", boss.BodyCenter, 4f, move: file);
            }
        }

        /// <summary>强制一招（force = false：等它自己出，阶段第一招），拍五拍</summary>
        IEnumerator Beat(string moveId, string label, float distance, float recoverDelay = 0.35f, bool force = true)
        {
            yield return WaitIdle();
            if (!boss || boss.Dead) yield break;
            var move = boss.MoveById(moveId);
            if (move == null)
            {
                Line($"{label}：没有招式 {moveId}");
                yield break;
            }
            ReadyPlayer(distance);
            yield return null;
            int started = move.TimesStarted;
            int releases = boss.Releases;
            cam.Arm(label, $"{moveId}_p{boss.Phase + 1}", () =>
            {
                if (boss.Current != move) return boss.Releases > releases ? 'A' : '-';
                if (move.Stage == MoveStage.Windup) return 'W';
                if (move.Stage != MoveStage.Active) return boss.Releases > releases ? 'A' : '-';
                // 释放帧 = 魔将放出这一招的表现那一帧（片段的 hit / impact / cast 事件；跃击是落地、冲锋是起跑）；
                // 前摇结束到释放帧之间是 'H'（跃击的腾空也在这里；预警那一格停在前摇最后一帧）
                return boss.Releases > releases ? 'A' : 'H';
            }, () => boss.BodyCenter, 4f, recoverDelay);
            float t0 = Time.time;
            if (force)
                while (!boss.ForceMove(moveId) && Time.time - t0 < 5f)
                    yield return null;
            while (move.TimesStarted == started && Time.time - t0 < 8f) yield return null;
            while (!cam.Idle && Time.time - t0 < 14f)
            {
                KeepAlive();
                if (move is WarlordCombo && boss.DistanceToPlayer > 4.5f) ReadyPlayer(3.5f);
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            if (!cam.Idle)
            {
                Line($"{label}：没拍完（{Time.time - t0:F1} s）");
                cam.Abort();
            }
            else Line($"{label}：✓ 累计 {cam.Count} 张；释放帧 {boss.LastStrike}，片段事件比判定 {boss.LastHitSkew * 1000f:+0;-0;0} ms（截图帧慢，仅供参考），顿帧累计 {boss.Holds} 次，" +
                      $"大剑 {(boss.Blade ? $"已挂（剑长 {boss.Blade.Length:F2} m，拖影 {boss.Blade.SmearCount} 次）" : "没挂")}");
        }

        /// <summary>
        /// 性能对照（同一会话）：旧、新交替六轮，每轮横扫 / 连斩 / 跃击各出一次——旧 = 调优前的通用出手特效（<see cref="WarlordBrain.LegacyFx"/>），
        /// 新 = 熔铜出手特效；记每招期间的平均 / 最慢帧（毫秒，不受时间缩放）和特效粒子峰值（<see cref="FxBudget.Peak"/>），交替是为了抵掉编辑器帧时间的漂移
        /// </summary>
        IEnumerator PerfCompare()
        {
            var total = new Dictionary<bool, (float sum, int frames)>();
            foreach (bool legacy in new[] { true, false, true, false, true, false })
            {
                WarlordBrain.LegacyFx = legacy;
                float sum = 0, worst = 0;
                int frames = 0, peak = 0;
                foreach (var id in new[] { "warlord_sweep", "warlord_combo", "warlord_leap" })
                {
                    yield return WaitIdle();
                    if (!boss || boss.Dead) yield break;
                    var move = boss.MoveById(id);
                    if (move == null) continue;
                    ReadyPlayer(id == "warlord_combo" ? 3.5f : id == "warlord_sweep" ? 8f : 11f);
                    yield return new WaitForSeconds(0.3f);
                    FxBudget.ResetPeak();
                    float t0 = Time.time;
                    while (!boss.ForceMove(id) && Time.time - t0 < 5f) yield return null;
                    while (boss.Current == move && Time.time - t0 < 12f)
                    {
                        KeepAlive();
                        Aim(motor, eye, boss.BodyCenter);
                        float ms = Time.unscaledDeltaTime * 1000f;
                        sum += ms;
                        worst = Mathf.Max(worst, ms);
                        frames++;
                        yield return null;
                    }
                    yield return new WaitForSeconds(0.6f);
                    peak = Mathf.Max(peak, FxBudget.Peak);
                    if (!legacy) skews.Add($"{boss.LastStrike} {boss.LastHitSkew * 1000f:+0;-0;0} ms");
                }
                string what = legacy ? "调优前的通用出手特效" : "熔铜出手特效";
                Line($"性能对照（{what}）：{frames} 帧，平均 {sum / Mathf.Max(1, frames):F2} ms、最慢 {worst:F1} ms，粒子峰值 {peak}（画质 {QualityProfile.Current.label}）");
                var tt = total.TryGetValue(legacy, out var x) ? x : (0f, 0);
                total[legacy] = (tt.Item1 + sum, tt.Item2 + frames);
            }
            WarlordBrain.LegacyFx = false;
            float oldMs = total[true].sum / Mathf.Max(1, total[true].frames), newMs = total[false].sum / Mathf.Max(1, total[false].frames);
            Line($"性能对照合计：旧 {oldMs:F2} ms → 新 {newMs:F2} ms（{(newMs / Mathf.Max(0.01f, oldMs) - 1f) * 100f:+0.0;-0.0}%）");
            Line($"释放帧对齐（不截图时，片段 hit / impact / cast 事件减招式判定时刻）：{string.Join("、", skews)}；事件没来按判定兜底 {boss.FxFallbacks} 次（{boss.FallbackLog}）");
        }

        readonly List<string> skews = new();

        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < 16f)
            {
                KeepAlive();
                yield return null;
            }
        }

        IEnumerator WaitChannelsDry()
        {
            var ch = boss ? boss.Channels : null;
            if (!ch) yield break;
            ch.Recede();
            float t0 = Time.time;
            while (ch.Flooding && Time.time - t0 < ch.fallTime + 2f) yield return null;
        }

        void ReadyPlayer(float distance)
        {
            KeepAlive();
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            foreach (float yaw in new[] { 0f, 30f, -30f, 60f, -60f, 90f, -90f, 180f })
            {
                var spot = arena.Clamp(boss.transform.position + Quaternion.Euler(0, yaw, 0) * fwd * distance, 2f);
                if (!NavMesh.SamplePosition(spot, out var hit, 3f, Humanoid) || LavaField.IsLava(hit.position)) continue;
                Place(hit.position);
                break;
            }
            Aim(motor, eye, boss.BodyCenter);
        }

        void KeepAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(999999);
        }

        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }
    }

    /// <summary>
    /// 第三章最常见三种精英的节拍条（bridge.sh playtest beats-elite3；测试场）：马面狱卒、炮仗傀儡、熔炉铁牛各刷一只精英，
    /// 玩家按招式换距离站着不还手，每个攻击拍起手 / 蓄力顶点 / 释放帧 / 收招 / 第一人称（<see cref="WBeatCam"/>）。
    /// 截图在 Assets/Art/_Review/beats/elite3/。只看画面、不判合格。
    /// </summary>
    public sealed class InfernoEliteBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-elite3";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>(敌人, 攻击名, 前摇状态（| 分隔：连续几段都算蓄）, 出手状态, 玩家距离, 收招延时)</summary>
        static readonly (string id, string label, string windup, string release, float dist, float recover)[] Plan =
        {
            ("mamian", "锁链横扫", "sweepWind", "sweep", 3.6f, 0.3f),
            ("mamian", "勾魂索", "spin", "throw", 10f, 0.45f),
            ("firecracker", "一窝蜂", "brace|fuse", "volley", 14f, 1.5f),
            ("firecracker", "地老鼠", "stomp", "march", 6f, 0.7f),
            ("iron_ox", "鼓风吸气 → 熔铁喷吐", "inhale|spitWindup", "spit", 10f, 0.4f),
            ("iron_ox", "顶角掀地", "tossWindup", "toss", 3.4f, 0.35f),
        };

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
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
            vitals.stats.Add("beats_elite3", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var cam = Runner.gameObject.AddComponent<WBeatCam>();
            cam.Begin("elite3", Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "elite3"));
            foreach (var p in Plan)
            {
                arena.Clear();
                AttackTokens.Reset();
                PackCoordinator.Reset();
                yield return new WaitForSeconds(0.4f);
                Teleport(motor, arena.Center + away * p.dist);
                yield return null;
                var ai = arena.Spawn(p.id, true, Vector3.zero);
                if (!ai)
                {
                    Line($"{p.id}：生成失败");
                    continue;
                }
                var col = ai.GetComponent<Collider>();
                float size = col ? Mathf.Max(col.bounds.size.y, 1.5f) : 2f;
                var winds = p.windup.Split('|');
                var rel = p.release.Split('|');
                cam.Arm($"{EnemyRoster.Get(p.id)?.name ?? p.id}（精英）· {p.label}", $"{p.id}_{winds[^1]}", () =>
                {
                    if (!ai || ai.Dead) return '-';
                    string s = ai.State;
                    if (winds.Contains(s)) return 'W';
                    return rel.Contains(s) ? 'A' : '-';
                }, () => ai ? BodyCenter(ai.Health) : arena.Center, size, p.recover);
                float t0 = Time.time;
                while (!cam.Idle && Time.time - t0 < 30f)
                {
                    if (!ai || ai.Dead) break;
                    // 站位保持在设定距离（远程招式要看得见、近身招式要贴着）
                    var to = motor.transform.position - ai.transform.position;
                    to.y = 0;
                    if (Mathf.Abs(to.magnitude - p.dist) > 2.5f && ai.State is not null && !winds.Contains(ai.State) && !rel.Contains(ai.State))
                        Teleport(motor, ai.transform.position + (to.sqrMagnitude > 0.01f ? to.normalized : away) * p.dist);
                    Aim(motor, weapons.eye.transform, BodyCenter(ai.Health));
                    if (vitals.Dead) vitals.Revive();
                    if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(999999);
                    weapons.testFire = false;
                    yield return null;
                }
                if (!cam.Idle)
                {
                    cam.Abort();
                    Line($"{p.id} · {p.label}：30 s 内没拍完（最后状态 {(ai ? ai.State : "—")}）");
                }
                else Line($"{p.id} · {p.label}：✓ 累计 {cam.Count} 张");
            }
            arena.Clear();
            vitals.stats.Remove("beats_elite3");
        }
    }


    /// <summary>
    /// 通用刀光 SlashArc 顶点色转线性的改前 / 改后（bridge.sh playtest beats-slash；测试场）：同一会话里切 <see cref="SlashArc.LegacyGammaColors"/>，
    /// 把各章刀光按出招处的参数原样摆在固定机位前拍（真打时刀光小、又常被玩家替身挡住，看不出颜色）：
    ///   第一章跳鼠刀兵交叉斩（JerboaBladeAI.CrossSlashFx）、第二章雪狌狌抓挠（XingxingAI 的 swipe）、
    ///   第三章熔心魔将参考招式的焰刃连斩（WarlordMoves 的 combo；第三章普通敌人没有用 SlashArc 的），
    ///   另加玩家妖刀第三段的伸刃横扫（BladeView.OnStrike，非敌方刀光，同样受影响）。
    /// 每道拍三格：受击者视角（刀头扫到一半 / 整弯亮满）+ 斜上方 45°（整弯亮满）。
    /// 改前写 Assets/Art/_Review/beats/slash/before，改后写 …/after，拼图交给 scripts/unity/beat_strips.py。
    /// </summary>
    public sealed class SlashLinearBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-slash";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>一道（或一组同时出的）刀光：参数照抄出招处；eye = 受击者 / 玩家眼睛相对刀光中心的位置（前方米数、高度差）</summary>
        sealed class Swatch
        {
            public string id, label;
            public float height, reach, eyeFwd, eyeUp, duration;
            public bool hostile, playerView;
            public Action<Vector3, float> spawn;
        }

        static Swatch[] Swatches() => new[]
        {
            new Swatch
            {
                id = "ch1_jerboa_blade", label = "第一章 · 跳鼠刀兵 交叉斩", height = 0.55f, reach = 1.1f, eyeFwd = 2.2f, eyeUp = 1.05f, duration = 0.2f, hostile = true,
                spawn = (c, yaw) =>
                {
                    foreach (int s in new[] { 1, -1 })
                        SlashArc.Spawn(c, yaw, 1.1f, 1.7f, s, s * 0.75f, 0.3f, 0.2f, new Color(1f, 0.77f, 0.42f), true);
                },
            },
            new Swatch
            {
                id = "ch2_xingxing", label = "第二章 · 雪狌狌 抓挠", height = 0.75f, reach = 1.1f, eyeFwd = 2.4f, eyeUp = 0.85f, duration = 0.22f, hostile = true,
                spawn = (c, yaw) => Fx.Slash(c, yaw, 1.1f, 1.9f, 1, 0.35f, 0.32f, 0.22f, Hex.Rgb(0xbfeaff), true),
            },
            new Swatch
            {
                id = "ch3_warlord_ref", label = "第三章 · 熔心魔将参考招式 焰刃连斩", height = 2.1f, reach = WarlordRef.ComboRange * 0.95f, eyeFwd = 5.6f, eyeUp = -0.5f, duration = 0.3f, hostile = true,
                spawn = (c, yaw) =>
                {
                    Fx.Slash(c, yaw, WarlordRef.ComboRange * 0.8f, WarlordRef.ComboHalf * 2f * Mathf.Deg2Rad, 1, 0, 0.5f, 0.25f, WarlordRef.Fire, true);
                    Fx.Slash(c + Vector3.up * 0.1f, yaw, WarlordRef.ComboRange * 0.95f, WarlordRef.ComboHalf * 2f * Mathf.Deg2Rad, 1, 0, 0.9f, 0.3f,
                        new Color(1f, 0.32f, 0.06f), true);
                },
            },
            new Swatch
            {
                id = "player_blade", label = "玩家 · 妖刀第三段伸刃横扫（非敌方）", height = 1.3f, reach = 3.2f, eyeFwd = -0.6f, eyeUp = 0.3f, duration = 0.24f, playerView = true,
                spawn = (c, yaw) => Fx.Slash(c, yaw, 3.2f, 2.6f, 1, 0.04f, 0.5f, 0.24f, Color.Lerp(BladeMeshes.Purple, Color.white, 0.15f) * 1.2f),
            },
        };

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !arena)
            {
                Fail("缺少测试场组件");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            arena.Clear();
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var east = Vector3.Cross(Vector3.up, away);
            // 刀光摆在场地侧边的空地上，刀光朝 away（受击者站在 away 方向），玩家挪远免得入镜
            var spot = arena.Center + east * 12f;
            if (Physics.Raycast(spot + Vector3.up * 30f, Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) spot = hit.point;
            Teleport(motor, arena.Center - east * 14f);
            yield return new WaitForSeconds(0.5f);
            float yaw = Mathf.Atan2(away.x, away.z) * Mathf.Rad2Deg;
            string root = Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "slash");
            var camB = Runner.gameObject.AddComponent<WBeatCam>();
            camB.Begin("slash-before", Path.Combine(root, "before"));
            var camA = Runner.gameObject.AddComponent<WBeatCam>();
            camA.Begin("slash-after", Path.Combine(root, "after"));
            foreach (var s in Swatches())
                foreach (bool legacy in new[] { true, false })
                {
                    SlashArc.LegacyGammaColors = legacy;
                    var cam = legacy ? camB : camA;
                    yield return new WaitForSeconds(0.45f);
                    var c = spot + Vector3.up * s.height;
                    var eye = c + away * s.eyeFwd + Vector3.up * s.eyeUp;
                    // 受击者看向出招者的胸口（玩家妖刀：看向正前方略低）
                    var look = s.playerView ? c + away * 3f - Vector3.up * 0.35f : c + Vector3.up * 0.15f;
                    // 斜上方：从受击者那一侧的右前上方看整弯（离得远近按刀光半径缩放）
                    var obliqueLook = c + away * s.reach * 0.6f;
                    var oblique = obliqueLook + east * (s.reach * 0.9f + 1.2f) + away * (s.reach * 0.4f + 0.6f) + Vector3.up * (s.reach * 0.55f + 1.2f);
                    float life = s.duration * (s.hostile ? 1.25f : 1f);
                    s.spawn(c, yaw);
                    float t0 = Time.time;
                    while (Time.time - t0 < life * 0.22f) yield return null;
                    cam.Pose(s.label, s.playerView ? "玩家视角 · 扫到一半" : "受击视角 · 扫到一半", 0, $"slash_{s.id}_0", eye, look, $"slash_{s.id}");
                    while (Time.time - t0 < life * 0.45f) yield return null;
                    cam.Pose(s.label, s.playerView ? "玩家视角 · 整弯亮满" : "受击视角 · 整弯亮满", 1, $"slash_{s.id}_1", eye, look, $"slash_{s.id}");
                    cam.Pose(s.label, "斜上方 · 整弯亮满", 2, $"slash_{s.id}_2", oblique, obliqueLook, $"slash_{s.id}");
                    Line($"{s.id}（{(legacy ? "改前" : "改后")}）：拍在 {(Time.time - t0) / life:P0} 寿命");
                }
            SlashArc.LegacyGammaColors = false;
            Line($"刀光对照：改前 {camB.Count} 张、改后 {camA.Count} 张");
            if (camA.Count != camB.Count || camA.Count == 0) Fail("改前 / 改后张数对不上");
        }
    }
}
