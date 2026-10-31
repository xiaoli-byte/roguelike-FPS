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
    /// 鲲鹏的招式节拍条（K 路特效 / 动作调优，bridge.sh playtest beats-kunpeng；设计单 docs/art/vfx/kunpeng.md）：
    /// 逐个强制出招（首领不掉血），每招按设计单的节拍各拍一张（格子顺序 = 下面的序号）——
    ///   0 起手（前摇开始 0.12 s）/ 2 预警（预警画出 0.3 s 后、前摇 60% 以后）/ 3 蓄力顶点（前摇最后 0.2 s，前摇可变的落台不拍）/ 4 释放帧（出手段第 2 帧：亮芯第一帧到峰值）/
    ///   5 持续段（出手段 ≥ 0.8 s 的招式）/ 8 收招（收招段 0.15 s）/ 9 第一人称（释放帧同一刻，视线转向首领）；1、6、7 留给各招自己的节拍（潜袭的下潜、落台的起飞前摇 / 起飞，<see cref="Beat"/>）。
    /// 俯冲掠台的「释放帧」取掠到玩家身边那一刻（出手 0.3 s）。另外按时刻拍化形（4.6 s 里 8 张）、鹏倒下（失衡 / 翼折 / 坠落 / 落地 / 余韵 / 归冥）、鲲倒下（沉进冰窟）。
    /// 除了释放帧事件，还记落台的起飞事件（liftoff 对收招段开始）和鹏倒下的动画事件（对倒下演出的触地时刻）。
    /// 截图在 Assets/Art/_Review/beats/kunpeng/（jpg + manifest.json），拼图由 scripts/unity/vfx_beats.py 生成到 docs/art/review/boss-vfx/K/。
    /// 只旁观、不判合格（除了招式没出 / 卡死）。
    /// </summary>
    public sealed class KunPengBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-kunpeng";
        public override string Scene => "Assets/Scenes/L2_4_Beiming.unity";

        /// <summary>
        /// 节拍截图机：旁观机位（侧面同时框住对象和玩家，玩家处放青色替身胶囊）+ 玩家第一人称；写 jpg 和清单。
        /// 和 GalleryRecorder 的机位规则一致（对象沉到水下时看水面、机位抬到水面以上、被墙挡住换边 / 升高）
        /// </summary>
        public sealed class Cam
        {
            public const int W = 1280, H = 720;

            [Serializable]
            public sealed class Shot
            {
                public string key, strip, beat, file, note;
                /// <summary>scripts/unity/beat_strips.py 的字段（= key / strip）</summary>
                public string move, label;
                public int order;
                public float t;
            }

            [Serializable]
            sealed class Manifest
            {
                public string group, scene, started;
                public List<Shot> shots = new();
            }

            readonly string dir;
            readonly Manifest manifest;
            readonly Camera spec;
            readonly GameObject standIn;
            readonly Texture2D readback;
            readonly RenderTexture rt;
            readonly Camera eye;
            readonly PlayerMotor motor;

            public int Count => manifest.shots.Count;

            public Cam(string group, string outDir, string scene, Camera playerEye, PlayerMotor playerMotor)
            {
                dir = outDir;
                eye = playerEye;
                motor = playerMotor;
                Directory.CreateDirectory(dir);
                foreach (var f in Directory.GetFiles(dir, "*.jpg")) File.Delete(f);
                manifest = new Manifest { group = group, scene = scene, started = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
                var go = new GameObject("Beats Camera");
                spec = go.AddComponent<Camera>();
                spec.enabled = false;
                spec.fieldOfView = 50f;
                spec.nearClipPlane = 0.1f;
                spec.farClipPlane = 1500f;
                spec.cullingMask = ~(1 << Layers.FirstPerson);
                var data = spec.GetUniversalAdditionalCameraData();
                data.renderPostProcessing = true;
                data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
                standIn = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                standIn.name = "Beats Player Stand-in";
                Destroy(standIn.GetComponent<Collider>());
                standIn.layer = Layers.IgnoreRaycast;
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
                rt = new RenderTexture(W, H, 24);
                Write();
            }

            public void Dispose()
            {
                if (spec) Destroy(spec.gameObject);
                if (standIn) Destroy(standIn);
                if (rt) Destroy(rt);
                if (readback) Destroy(readback);
            }

            Vector3 Feet => motor.transform.position;
            Vector3 Chest => motor.transform.position + Vector3.up * 1.2f;

            /// <summary>旁观：subject = 对象中心、size = 对象尺寸；both = 同时框住玩家（离得太远时只框对象）</summary>
            public void Spec(string key, string strip, string beat, int order, Vector3 subject, float size, bool both = true, string note = null)
            {
                var p = Chest;
                var d = Flat(p - subject);
                float dist = d.magnitude;
                var dirv = dist > 0.1f ? d / dist : Flat(motor.transform.forward).normalized;
                var side = Vector3.Cross(Vector3.up, dirv);
                float sz = Mathf.Max(1f, size);
                if (both && dist > 22f + sz) both = false;
                Vector3 look, pos;
                if (!both)
                {
                    look = subject;
                    float ds = 2.6f + sz * 1.7f;
                    pos = subject + side * ds * 0.75f + dirv * ds * 0.7f + Vector3.up * (0.6f + sz * 0.3f);
                }
                else
                {
                    look = Vector3.Lerp(subject, p, 0.42f);
                    float db = Mathf.Max(4.5f + sz, dist * 0.95f + sz * 1.1f);
                    pos = look + side * db + dirv * db * 0.22f + Vector3.up * (1.2f + sz * 0.3f + dist * 0.08f);
                }
                float wl = WaterTop(look);
                if (!float.IsNegativeInfinity(wl)) look.y = wl + 0.3f;
                pos = Unblock(pos, look, side);
                float wp = WaterTop(pos);
                if (!float.IsNegativeInfinity(wp)) pos.y = Mathf.Max(pos.y, wp + 1.2f + sz * 0.25f);
                spec.transform.position = pos;
                spec.transform.LookAt(look);
                standIn.transform.position = Feet + Vector3.up * 0.9f;
                standIn.SetActive(true);
                spec.targetTexture = rt;
                spec.Render();
                spec.targetTexture = null;
                standIn.SetActive(false);
                Save(key, strip, beat, order, note, "tp");
            }

            /// <summary>第一人称：眼睛不动，视线临时转向 lookAt（拍完还原），连同武器</summary>
            public void Eye(string key, string strip, string beat, int order, Vector3 lookAt, string note = null)
            {
                var t = eye.transform;
                var rot = t.rotation;
                var d = lookAt - t.position;
                if (d.sqrMagnitude > 0.01f) t.rotation = Quaternion.LookRotation(d);
                var prev = eye.targetTexture;
                eye.targetTexture = rt;
                eye.Render();
                eye.targetTexture = prev;
                t.rotation = rot;
                Save(key, strip, beat, order, note, "fp");
            }

            void Save(string key, string strip, string beat, int order, string note, string view)
            {
                var prev = RenderTexture.active;
                RenderTexture.active = rt;
                readback.ReadPixels(new Rect(0, 0, W, H), 0, 0);
                readback.Apply(false);
                RenderTexture.active = prev;
                string file = $"{Safe(key)}_{order:00}_{view}.jpg";
                File.WriteAllBytes(Path.Combine(dir, file), readback.EncodeToJPG(90));
                manifest.shots.RemoveAll(s => s.file == file);
                manifest.shots.Add(new Shot { key = key, strip = strip, move = key, label = strip, beat = beat, order = order, file = file, note = note ?? "", t = Time.time });
                Write();
            }

            void Write()
            {
                try { File.WriteAllText(Path.Combine(dir, "manifest.json"), JsonUtility.ToJson(manifest, true)); }
                catch (IOException) { }
            }

            static string Safe(string s) => new(s.Select(ch => char.IsLetterOrDigit(ch) && ch < 128 || ch is '_' or '-' ? ch : '_').ToArray());

            static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

            static float WaterTop(Vector3 p)
            {
                float top = float.NegativeInfinity;
                if (WaterVolume.At(p, out float depth) is { } w && depth > 0) top = w.Surface;
                foreach (var h in IceHole.All)
                {
                    if (!h) continue;
                    var d = p - h.Center;
                    d.y = 0;
                    if (d.magnitude < h.radius && p.y < h.WaterY) top = Mathf.Max(top, h.WaterY);
                }
                return top;
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
                var top = Ground(look + (pos - look) * 0.5f + Vector3.up * 8f);
                if (Clear(top)) return top;
                if (Physics.Linecast(look, pos, out var hit, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    return hit.point + (look - hit.point).normalized * 0.4f;
                return pos;
            }
        }

        const float MoveTimeout = 16f;

        /// <summary>一招自己的额外节拍：stage 段内 t 秒拍一张，序号 order（1 / 6 / 7）</summary>
        readonly struct Beat
        {
            public readonly MoveStage stage;
            public readonly float t;
            public readonly string label;
            public readonly int order;

            public Beat(MoveStage stage, float t, string label, int order)
            {
                this.stage = stage;
                this.t = t;
                this.label = label;
                this.order = order;
            }
        }

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        KunPengBrain boss;
        IDisposable guard;
        Cam cam;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail("缺少玩家组件（场景不是 2-4？）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.stats.Add("beats_kunpeng", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();
            cam = new Cam("kunpeng", Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "kunpeng"), "L2_4_Beiming", weapons.eye, motor);
            try
            {
                yield return Fight();
            }
            finally
            {
                guard?.Dispose();
                vitals.stats.Remove("beats_kunpeng");
                Line($"节拍条：{cam.Count} 张");
                cam.Dispose();
            }
        }

        IEnumerator Fight()
        {
            var enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == KunPengDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(KunPengDef.Id);
            if (!arena)
            {
                Fail("场景里没有鲲鹏的 BossArena");
                yield break;
            }
            Place(arena.PlayerEntryPoint);
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                boss = enc.Boss as KunPengBrain;
            }
            else boss = Bosses.Spawn(KunPengDef.Id, arena, KunPengDef.StageDifficulty) as KunPengBrain;
            if (!boss)
            {
                Fail("鲲鹏生成失败");
                yield break;
            }
            guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
            yield return IntroBeats(boss, "intro", "登场");
            var h = boss.Hole;

            // 鲲：猛砸（正前 8 m 的落点上）、吞吸（扇形里 14 m）、潜袭（对面）、吐冰（远处）
            yield return OneMove(KunSlam.MoveId, () => Place(Ring(boss.Theta + 6f, h.radius + 3.6f)));
            yield return OneMove(KunInhale.MoveId, () => Place(Ring(boss.Theta + 8f, h.radius + 9.5f)));
            yield return OneMove(KunDive.MoveId, () => Place(Ring(boss.Theta + 110f, h.MidRing)), extras: new[] { new Beat(MoveStage.Windup, 0.4f, "下潜", 1) });
            yield return OneMove(KunSpit.MoveId, () => Place(Ring(boss.Theta + 35f, h.outer - 4f)));

            // 化形
            yield return Transition();

            // 鹏：狂风（化形后的第一招，自己出）、俯冲（开阔处）、羽刃雨、落台
            yield return OneMove(PengGust.MoveId, () => Place(Ring(20f, h.MidRing)), force: false, releaseAfter: 0.15f);
            yield return OneMove(PengSwoop.MoveId, () => Place(Ring(Mathf.Abs(Mathf.DeltaAngle(h.Angle(boss.transform.position), 0f)) > 90f ? 0f : 180f, h.radius + 9f)),
                releaseAfter: 0.3f);
            yield return OneMove(PengFeatherRain.MoveId, () => Place(Ring(40f, h.MidRing)), releaseAfter: 0.25f, closeUp: true);
            yield return OneMove(PengPerch.MoveId, () => Place(Ring(90f, h.MidRing)),
                extras: new[] { new Beat(MoveStage.Active, 4.5f, "起飞前摇", 6), new Beat(MoveStage.Recover, 0.06f, "起飞", 7) }, recoverAt: 0.45f, closeUp: true);

            // 鹏倒下
            yield return Death(boss, "death_peng", "鹏 · 倒下");
            yield return new WaitForSeconds(1f);
            if (boss) Destroy(boss.gameObject);
            yield return new WaitForSeconds(0.5f);

            // 鲲倒下（沉进冰窟）：再刷一只，登场完一刀（≥ 生命上限的伤害越过阶段门槛）
            boss = Bosses.Spawn(KunPengDef.Id, arena, KunPengDef.StageDifficulty) as KunPengBrain;
            if (!boss)
            {
                Fail("第二只鲲生成失败");
                yield break;
            }
            Place(Ring(boss.Theta + 10f, boss.Hole.radius + 9f));
            float s0 = Time.time;
            while (boss && !boss.IntroDone && Time.time - s0 < 8f)
            {
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            yield return Death(boss, "death_kun", "鲲 · 倒下（沉入冰窟）");
            yield return new WaitForSeconds(1f);
            if (boss) Destroy(boss.gameObject);
        }

        /// <summary>登场：升起中段、吼叫、交还</summary>
        IEnumerator IntroBeats(KunPengBrain b, string key, string strip)
        {
            Place(Ring(b.Theta + 10f, b.Hole.radius + 9f));
            float t0 = Time.time;
            int k = 0;
            float[] at = { 0.5f, 1.2f, 2.2f };
            while (b && !b.IntroDone && Time.time - t0 < 10f)
            {
                Aim(motor, eye, b.BodyCenter);
                if (k < at.Length && Time.time - t0 >= at[k])
                {
                    cam.Spec(key, strip, $"{at[k]:F1} s", k, b.BodyCenter, 10f);
                    k++;
                }
                yield return null;
            }
        }

        /// <summary>
        /// 强制出一招并按节拍拍：起手 / 预警 / 释放帧 / 收招 / 第一人称。setup 摆玩家；force = false 时等它自己出（化形后的第一招）；
        /// releaseAfter = 释放帧在出手段开始后多久拍（默认第 2 帧）；extras = 这招自己的节拍；recoverAt = 收招那张在收招段几秒拍；
        /// closeUp = 旁观机位只框首领（鹏盘旋的位置不定，和玩家同框时常常只剩一个小点）
        /// </summary>
        IEnumerator OneMove(string id, Action setup, bool force = true, float releaseAfter = 0f, Beat[] extras = null, float recoverAt = 0.15f, bool closeUp = false)
        {
            var m = boss ? boss.MoveById(id) : null;
            if (m == null)
            {
                Fail($"没有招式 {id}");
                yield break;
            }
            int warned0 = m is KunPengMove k0 ? k0.Warned : m.TelegraphCount;
            float t0 = Time.time;
            if (force)
            {
                while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
                setup?.Invoke();
                yield return new WaitForSeconds(0.4f);
                t0 = Time.time;
                while (!boss.ForceMove(id) && Time.time - t0 < 5f) yield return null;
            }
            else
            {
                setup?.Invoke();
                while (boss && boss.Current != m && Time.time - t0 < MoveTimeout) yield return null;
            }
            if (!boss || boss.Current != m)
            {
                Fail($"招式 {id} 没出");
                yield break;
            }
            string strip = m.Name;
            float warnAt = -1;
            bool b0 = false, b1 = false, b2 = false, b3 = false, b5 = false;
            bool b4 = false;
            var extraDone = new bool[extras?.Length ?? 0];
            int activeFrames = 0, frames = 0, surgePeak = 0, releaseFrame = -1, eventFrame = -1, liftFrame = -1, recoverFrame = -1;
            float eventAt = -1, liftAt = -1, recoverAt0 = -1;
            string releaseEvt = null;
            var rig = boss.Model?.rig;
            Action<string> onEvt = e =>
            {
                if (eventFrame < 0 && e is "hit" or "gustStart" or "hitOpen" or "projectile" or "suctionStart")
                {
                    eventFrame = Time.frameCount;
                    eventAt = Time.time;
                    releaseEvt = e;
                }
                if (liftFrame < 0 && e == "liftoff")
                {
                    liftFrame = Time.frameCount;
                    liftAt = Time.time;
                }
            };
            if (rig) rig.AnimEvent += onEvt;
            float activeAt = -1, frameSum = 0;
            string clipAt = null;
            bool both = !closeUp;
            FxBudget.ResetPeak();
            t0 = Time.time;
            while (boss && !boss.Dead && boss.Current == m && Time.time - t0 < MoveTimeout)
            {
                KeepAlive();
                Aim(motor, eye, boss.BodyCenter);
                frames++;
                frameSum += Time.unscaledDeltaTime;
                surgePeak = Mathf.Max(surgePeak, Surge.ActiveCount);
                var c = boss.BodyCenter;
                // 落台的前摇长短不定（接近 ≤ 3 s + 下降 0.9 s）：预警按画出来 0.3 s 后拍，不拍蓄力顶点
                bool variableWindup = m is PengPerch;
                for (int i = 0; i < extraDone.Length; i++)
                {
                    var x = extras[i];
                    if (extraDone[i] || m.Stage != x.stage || m.StageT < x.t) continue;
                    extraDone[i] = true;
                    cam.Spec(id, strip, x.label, x.order, c, 9f, both, note: $"{StageName(m.Stage)} {m.StageT:F2} s");
                }
                if (m.Stage == MoveStage.Windup)
                {
                    float w = Mathf.Max(0.2f, m.WindupTime);
                    if (!b0 && m.StageT >= Mathf.Min(0.12f, w * 0.2f))
                    {
                        b0 = true;
                        cam.Spec(id, strip, "起手", 0, c, 9f, both, note: $"前摇 {m.StageT:F2} / {m.WindupTime:F2} s");
                    }
                    int warnedNow = m is KunPengMove km ? km.Warned : m.TelegraphCount;
                    if (warnAt < 0 && warnedNow > warned0) warnAt = Time.time;
                    if (!b1 && warnAt >= 0 && Time.time - warnAt >= 0.3f && (variableWindup || m.StageT >= Mathf.Min(w * 0.6f, 2.4f)))
                    {
                        b1 = true;
                        cam.Spec(id, strip, "预警", 2, c, 9f, both, note: $"前摇 {m.StageT:F2} / {m.WindupTime:F2} s");
                    }
                    if (!b4 && !variableWindup && w >= 0.6f && m.StageT >= Mathf.Max(w * 0.8f, w - 0.2f))
                    {
                        b4 = true;
                        cam.Spec(id, strip, "蓄力顶点", 3, c, 9f, both, note: $"前摇 {m.StageT:F2} / {m.WindupTime:F2} s");
                    }
                }
                if (m.Stage == MoveStage.Active)
                {
                    if (activeAt < 0)
                    {
                        activeAt = Time.time;
                        releaseFrame = Time.frameCount;
                        // 出手段开始这一帧，片段（上一帧的动画求值）走到哪：和设计的释放帧时刻对照
                        var an = boss.Model?.animator;
                        if (an && an.isActiveAndEnabled)
                        {
                            var st = an.IsInTransition(0) ? an.GetNextAnimatorStateInfo(0) : an.GetCurrentAnimatorStateInfo(0);
                            clipAt = $"{st.normalizedTime * st.length:F2} / {st.length:F2} s（×{an.speed:F2}）";
                        }
                    }
                    activeFrames++;
                    bool due = releaseAfter > 0 ? Time.time - activeAt >= releaseAfter : activeFrames >= 2;
                    // 持续段（出手段 ≥ 0.8 s 的招式）：出手 1.2 s，短一些的取出手段 55%（羽刃雨的振翅洒羽）
                    if (!b5 && b2 && m.active >= 0.8f && m.StageT >= Mathf.Min(1.2f, m.active * 0.55f))
                    {
                        b5 = true;
                        cam.Spec(id, strip, "持续段", 5, c, 9f, both, note: $"出手 {m.StageT:F2} s");
                    }
                    if (!b2 && due)
                    {
                        b2 = true;
                        cam.Spec(id, strip, "释放帧", 4, c, 9f, both, note: $"出手 {m.StageT:F2} s");
                        cam.Eye(id, strip, "第一人称", 9, c, $"出手 {m.StageT:F2} s，距玩家 {Vector3.Distance(Flat(c), Flat(motor.transform.position)):F1} m");
                    }
                }
                if (m.Stage == MoveStage.Recover && recoverFrame < 0)
                {
                    recoverFrame = Time.frameCount;
                    recoverAt0 = Time.time;
                }
                if (m.Stage == MoveStage.Recover && !b3 && m.StageT >= recoverAt)
                {
                    b3 = true;
                    cam.Spec(id, strip, "收招", 8, c, 9f, both, note: $"收招 {m.StageT:F2} s");
                }
                yield return null;
            }
            if (rig) rig.AnimEvent -= onEvt;
            if (!b3 && boss) cam.Spec(id, strip, "收招", 8, boss.BodyCenter, 9f, both, note: m.Cancelled ? "被打断 / 撞柱" : "招式结束");
            string align = eventFrame >= 0 && releaseFrame >= 0
                ? $"出手事件 {releaseEvt} 比出手段开始{(eventFrame >= releaseFrame ? "晚" : "早")} {Mathf.Abs(eventAt - activeAt) * 1000f:F0} ms（{Mathf.Abs(eventFrame - releaseFrame)} 个编辑器帧）"
                : "没收到出手事件";
            if (clipAt != null) align += $"；出手那一帧片段走到 {clipAt}";
            if (liftFrame >= 0 && recoverFrame >= 0)
                align += $"；起飞事件 liftoff 比收招段开始{(liftFrame >= recoverFrame ? "晚" : "早")} {Mathf.Abs(liftAt - recoverAt0) * 1000f:F0} ms（{Mathf.Abs(liftFrame - recoverFrame)} 个编辑器帧）";
            Line($"{strip}：{(b0 ? "起手 " : "")}{(b1 ? "预警 " : "")}{(b2 ? "释放帧 " : "")}{(b3 ? "收招" : "")}（{Time.time - t0:F1} s）；{align}；动作 {boss?.LastAct}（{boss?.LastActPath}），顿帧累计 {boss?.ImpactHolds}；" +
                 $"粒子峰值 {FxBudget.Peak}、涌流体积峰值 {surgePeak}、平均帧 {(frames > 0 ? frameSum / frames * 1000f : 0):F1} ms（含截图帧）");
            if (boss && boss.Staggered)
            {
                float s0 = Time.time;
                while (boss.Staggered && Time.time - s0 < 3f) yield return null;
            }
        }

        /// <summary>化形：生命层压到 48%，按演出时刻拍 8 张（沉、冰海炸开、雾最浓换形、鹏升起、长啸、雾散）</summary>
        IEnumerator Transition()
        {
            float t0 = Time.time;
            while (boss && (boss.Current != null || boss.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
            var h = boss.Hole;
            Place(Ring(boss.Theta + 25f, h.radius + 8f));
            boss.Health.shield = 0;
            boss.Health.health = boss.Health.maxHealth * (KunPengDef.SwapAt - 0.02f);
            t0 = Time.time;
            while (!boss.Transitioning && Time.time - t0 < boss.Def.phaseWait + 4f) yield return null;
            if (!boss.Transitioning)
            {
                Fail("没有进入化形");
                yield break;
            }
            float[] at = { 0.35f, 0.95f, 1.36f, 1.62f, 2.3f, 3.0f, 3.68f, 4.4f };
            int k = 0, surgePeak = 0;
            FxBudget.ResetPeak();
            while (boss.Transitioning && k < at.Length)
            {
                surgePeak = Mathf.Max(surgePeak, Surge.ActiveCount);
                KeepAlive();
                var focus = new Vector3(h.center.x, h.FloorY + 5f, h.center.z);
                Aim(motor, eye, focus);
                if (boss.TransitionTime >= at[k])
                {
                    cam.Spec("transform", "化形", $"{at[k]:F2} s", k, focus, 12f);
                    if (k == 2 || k == 6) cam.Eye("transform", "化形 · 第一人称", $"第一人称 {at[k]:F2} s", 20 + k, focus);
                    k++;
                }
                yield return null;
            }
            Line($"化形：拍了 {k} 张，现在是 {boss.Form?.name}；粒子峰值 {FxBudget.Peak}、涌流体积峰值 {surgePeak}");
        }

        /// <summary>倒下：一刀 99999（越过阶段门槛），按倒下演出的时刻拍</summary>
        IEnumerator Death(KunPengBrain b, string key, string strip)
        {
            guard?.Dispose();
            guard = null;
            float t0 = Time.time;
            while (b && (b.Current != null && b.Current.Stage == MoveStage.Windup || b.Transitioning) && Time.time - t0 < 8f) yield return null;
            var info = DamageInfo.Simple(99999f, DamageSource.Weapon, b.BodyCenter, Vector3.forward);
            info.noCrit = true;
            t0 = Time.time;
            while (b && !b.Health.Dead && Time.time - t0 < 6f)
            {
                if (!b.Health.untargetable) Combat.DamageEnemy(b.Health, info);
                yield return null;
            }
            if (!b || !b.Health.Dead)
            {
                Fail($"{strip}：没打死");
                yield break;
            }
            float secs = b.Def != null ? b.Def.defeat.seconds : 4.4f;
            var ground = new Vector3(b.transform.position.x, b.Hole.FloorY, b.transform.position.z);
            var anchor = b.IsKun ? new Vector3(b.Hole.center.x, b.Hole.FloorY + 3f, b.Hole.center.z) : b.BodyCenter;
            var water = new Vector3(b.Hole.center.x, b.Hole.waterY, b.Hole.center.z);
            bool kun = b.IsKun;
            // 鲲：沉、没顶、余韵；鹏：失衡 / 翼折 / 坠落 / 落地 / 余韵（设计单的节拍）/ 溃散后归冥、冰海平静
            float[] at = kun
                ? new[] { 0.3f, secs * 0.3f, secs * 0.56f, secs * 0.8f, secs + 0.3f, secs + 2.2f }
                : new[] { 0.15f, 0.55f, 1.4f, 2.47f, 3.2f, secs + 0.4f, secs + 1.6f };
            string[] beat = kun ? null : new[] { "失衡", "翼折", "坠落", "落地", "余韵", "归冥", "冰海平静" };
            var events = new List<string>();
            var rig = b.Model?.rig;
            float d0 = Time.time;
            Action<string> onEvt = e => events.Add($"{e} {Time.time - d0:F2} s");
            if (rig) rig.AnimEvent += onEvt;
            int k = 0;
            t0 = Time.time;
            while (k < at.Length && Time.time - t0 < secs + 4f)
            {
                KeepAlive();
                // 鲲沉进冰窟：一直看冰窟中心上方（模型中心沉到水下会把机位拖到冰沿碎冰里）；鹏看模型，溃散后看落点和冰窟之间
                var c = kun ? anchor : b && b.Model != null && b.Model.root ? Center(b.Model.root, anchor) : anchor;
                float size = kun ? 13f : 8f;
                if (!kun && Time.time - t0 >= secs * 0.88f)
                {
                    c = Vector3.Lerp(ground, water, 0.45f) + Vector3.up * 2f;
                    size = 14f;
                }
                Aim(motor, eye, c);
                if (Time.time - t0 >= at[k])
                {
                    cam.Spec(key, strip, beat != null ? $"{beat[k]} {at[k]:F2} s" : $"{at[k]:F1} s", k, c, size);
                    if (k == 3) cam.Eye(key, strip + " · 第一人称", $"第一人称 {at[k]:F1} s", 20 + k, c);
                    k++;
                }
                yield return null;
            }
            if (rig) rig.AnimEvent -= onEvt;
            var death = b ? b.GetComponent<KunPengDeath>() : null;
            Line($"{strip}：拍了 {k} 张；动画事件 {(events.Count > 0 ? string.Join("、", events) : "（没有）")}" + (death ? $"；{death.Report}" : ""));
        }

        static string StageName(MoveStage s) => s switch
        {
            MoveStage.Windup => "前摇",
            MoveStage.Active => "出手",
            MoveStage.Recover => "收招",
            _ => s.ToString(),
        };

        static Vector3 Center(GameObject root, Vector3 fallback)
        {
            bool any = false;
            var bb = new Bounds(fallback, Vector3.one);
            foreach (var r in root.GetComponentsInChildren<Renderer>())
            {
                if (!r.enabled || r is not (SkinnedMeshRenderer or MeshRenderer)) continue;
                if (!any)
                {
                    bb = r.bounds;
                    any = true;
                }
                else bb.Encapsulate(r.bounds);
            }
            return any ? bb.center : fallback;
        }

        void KeepAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        Vector3 Ring(float yawDeg, float r)
        {
            var h = boss ? boss.Hole : IceHoleInfo.Fallback(arena, arena ? arena.Center : Vector3.zero);
            var p = h.Point(yawDeg, r) + Vector3.up * 0.5f;
            return NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas) ? hit.position : p;
        }

        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
    }
}
