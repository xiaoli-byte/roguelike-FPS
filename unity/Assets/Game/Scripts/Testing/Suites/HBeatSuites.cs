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
    /// 招式节拍条（首领与精英动作 · 特效调优的 H 路：旱魃 + 第一章精英；设计单 docs/art/vfx/hanba.md、elites-ch1.md）：
    /// 把每个招牌招式按节拍拍成一行——起手 / 预警 / 蓄力顶点 / 释放帧 / 持续段 / 收招，外加一张第一人称（蓄力顶点那一帧，视线转向出招者），
    /// 改前、改后各跑一次，拼成对比图（scripts/unity/beat_strips.py → docs/art/review/boss-vfx/H/）。
    /// 旁观机位从侧面同时框住出招者和玩家（玩家处放一根青色胶囊替身，只在旁观相机里出现）。
    /// 截图写 Assets/Art/_Review/beats/&lt;套件&gt;/*.jpg（960×540）+ manifest.json；同时记下释放帧和动画出手事件差几帧（预警 / 动作 / 判定对齐的验收）。
    /// 只旁观、不改玩法；首领不掉血（Incoming → 0），玩家血量垫高。
    /// </summary>
    public abstract class HBeatSuite : PlaytestSuite
    {
        public const int W = 960, H = 540;

        [System.Serializable]
        sealed class Entry
        {
            public string move, label, beat, file, note, view;
            public int order;
            public float t;
        }

        [System.Serializable]
        sealed class Manifest
        {
            public string suite, scene, started;
            public List<Entry> shots = new();
        }

        protected WeaponController weapons;
        protected PlayerMotor motor;
        protected PlayerVitals vitals;
        protected Transform eye;
        Camera spec;
        GameObject standIn;
        RenderTexture rt;
        Texture2D tex;
        string dir;
        Manifest manifest;

        /// <summary>玩家、相机、输出目录；返回 false = 场景不对</summary>
        protected bool Setup(string tag)
        {
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}");
                return false;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Remove(tag);
            vitals.stats.Add(tag, Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            dir = Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", Id);
            Directory.CreateDirectory(dir);
            foreach (var f in Directory.GetFiles(dir, "*.jpg")) File.Delete(f);
            manifest = new Manifest { suite = Id, scene = Scene, started = System.DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
            var go = new GameObject("Beat Camera");
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
            standIn.name = "Beat Player Stand-in";
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
            rt = new RenderTexture(W, H, 24);
            tex = new Texture2D(W, H, TextureFormat.RGB24, false);
            Write();
            return true;
        }

        protected void Teardown(string tag)
        {
            if (vitals) vitals.stats.Remove(tag);
            if (spec) Destroy(spec.gameObject);
            if (standIn) Destroy(standIn);
            if (rt) Destroy(rt);
            if (tex) Destroy(tex);
            Line($"节拍条：{manifest?.shots.Count ?? 0} 张 → {dir}");
        }

        protected void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        /// <summary>旁观机位拍一张：从侧面同时框住出招者（中心 subject、尺寸 size）和玩家</summary>
        protected void Snap(string move, string label, int order, string beat, Vector3 subject, float size, string note = null)
        {
            if (manifest == null) return;
            var p = motor.transform.position + Vector3.up * 1.1f;
            var d = p - subject;
            d.y = 0;
            float dist = d.magnitude;
            var fwd = dist > 0.1f ? d / dist : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, fwd);
            float sz = Mathf.Max(1f, size);
            Vector3 look, pos;
            if (dist > 18f + sz)
            {
                look = subject;
                float ds = 2.6f + sz * 1.9f;
                pos = subject + side * ds * 0.75f + fwd * ds * 0.7f + Vector3.up * (0.6f + sz * 0.35f);
            }
            else
            {
                look = Vector3.Lerp(subject, p, 0.42f);
                float db = Mathf.Max(4.5f + sz, dist * 0.95f + sz * 1.2f);
                pos = look + side * db + fwd * db * 0.22f + Vector3.up * (1.2f + sz * 0.3f + dist * 0.08f);
            }
            pos = Unblock(pos, look, side);
            spec.transform.position = pos;
            spec.transform.LookAt(look);
            standIn.transform.position = motor.transform.position + Vector3.up * 0.9f;
            standIn.SetActive(true);
            spec.targetTexture = rt;
            spec.Render();
            spec.targetTexture = null;
            standIn.SetActive(false);
            Save(new Entry { move = move, label = label, order = order, beat = beat, note = note, view = "tp" });
        }

        /// <summary>第一人称：视线转向出招者（不还原：玩家本来就只站着看）</summary>
        protected void SnapEye(string move, string label, int order, string beat, Vector3 lookAt, string note = null)
        {
            if (manifest == null) return;
            Aim(motor, eye, lookAt);
            var cam = weapons.eye;
            var rot = cam.transform.rotation;
            var dirv = lookAt - cam.transform.position;
            if (dirv.sqrMagnitude > 0.01f) cam.transform.rotation = Quaternion.LookRotation(dirv);
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            cam.targetTexture = prev;
            cam.transform.rotation = rot;
            Save(new Entry { move = move, label = label, order = order, beat = beat, note = note, view = "fp" });
        }

        void Save(Entry e)
        {
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tex.Apply(false);
            RenderTexture.active = prev;
            e.file = $"{e.move}_{e.order}.jpg";
            e.t = Time.time;
            File.WriteAllBytes(Path.Combine(dir, e.file), tex.EncodeToJPG(90));
            manifest.shots.Add(e);
            Write();
        }

        void Write()
        {
            try { File.WriteAllText(Path.Combine(dir, "manifest.json"), JsonUtility.ToJson(manifest, true)); }
            catch (IOException) { }
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
    }

    /// <summary>
    /// 旱魃的节拍条（bridge.sh playtest beats-hanba；场景 1-4）：一阶段日轮扫射 / 旱风 / 召沙魇各强制一次，进二阶段等飞天之殇自己出、再强制焦裂，
    /// 进三阶段等日蚀自己出（收招段多拍一张「复燃」）。每招记下前摇时长、释放帧与动画出手事件的时差（帧）。
    /// </summary>
    public sealed class HanbaBeatsSuite : HBeatSuite
    {
        public override string Id => "beats-hanba";
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";
        const string Tag = "beats_hanba";

        HanbaBrain boss;
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
                if (boss.Model?.rig) boss.Model.rig.AnimEvent += OnEvent;
                yield return Capture(Phase1SunSweep.MoveId, "日轮扫射", true);
                yield return Capture(Phase1HotWind.MoveId, "旱风", true);
                yield return Capture(Phase1SandWraiths.MoveId, "召沙魇", true);
                boss.Summons.DespawnAll();
                yield return Cross(HanbaDef.ScorchedAt - 0.01f);
                yield return Capture(Phase2ApsaraCall.MoveId, "飞天之殇", false);
                if (boss.Apsara && boss.Apsara.Health) Combat.Execute(boss.Apsara.Health, true);
                yield return new WaitForSeconds(0.8f);
                yield return Capture(Phase2CrackLine.MoveId, "焦裂", true);
                yield return Cross(HanbaDef.RedEarthAt - 0.01f);
                yield return Capture(Phase3Eclipse.MoveId, "日蚀", false);
                if (boss.Model?.rig) boss.Model.rig.AnimEvent -= OnEvent;
                guard?.Dispose();
            }
            if (boss) Destroy(boss.gameObject);
            Teardown(Tag);
        }

        void OnEvent(string evt) => events.Add((evt, Time.time));

        IEnumerator StartFight()
        {
            var enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == HanbaDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(HanbaDef.Id);
            if (!arena)
            {
                Fail("场景里没有旱魃的 BossArena（先 bridge.sh level 1-4）");
                yield break;
            }
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                Place(arena.PlayerEntryPoint);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                boss = enc.Boss as HanbaBrain;
            }
            else
            {
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(HanbaDef.Id, arena, HanbaDef.StageDifficulty) as HanbaBrain;
            }
            if (!boss)
            {
                Fail("旱魃没有刷出来");
                yield break;
            }
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f) yield return null;
            yield return new WaitForSecondsRealtime(0.6f);
            Line($"开战：模型 {boss.Model?.source} {boss.Model?.prefab}，日轮 {boss.Ring?.From}");
        }

        void Place(Vector3 p)
        {
            Teleport(motor, p);
            if (boss) Aim(motor, eye, boss.BodyCenter);
        }

        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < 14f)
            {
                KeepPlayerAlive();
                yield return null;
            }
        }

        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var spot = arena.Clamp(boss.transform.position + fwd * distance, 2f);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Teleport(motor, spot);
            Aim(motor, eye, boss.BodyCenter);
        }

        IEnumerator Cross(float fraction)
        {
            yield return WaitIdle();
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
            float t0 = Time.time;
            while (!boss.Transitioning && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            while (boss.Transitioning && Time.time - t0 < 12f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            Line($"越过 {fraction + 0.01f:P0} → 阶段 {boss.Phase + 1}");
        }

        /// <summary>出一招并按节拍拍：force = 强制出；false = 等它自己出（阶段的第一招）</summary>
        IEnumerator Capture(string id, string label, bool force)
        {
            var move = boss.Moves.FirstOrDefault(m => m.Id == id);
            if (move == null)
            {
                Fail($"没有招式 {id}");
                yield break;
            }
            if (force)
            {
                yield return WaitIdle();
                ReadyPlayer(12f);
                PlayerStatus.Instance?.ClearAll();
                yield return null;
                float f0 = Time.time;
                bool ok = false;
                while (!(ok = boss.ForceMove(id)) && Time.time - f0 < 5f) yield return null;
                if (!ok)
                {
                    Fail($"{label}：强制出招失败");
                    yield break;
                }
            }
            else
            {
                float w0 = Time.time;
                while (boss.Current != move && Time.time - w0 < 8f)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                if (boss.Current != move)
                {
                    Line($"⚠ {label} 8 s 内没有自己出，改为强制");
                    yield return Capture(id, label, true);
                    yield break;
                }
            }
            events.Clear();
            float start = Time.time, activeAt = -1, recoverAt = -1;
            var hm = move as HanbaMove;
            bool[] taken = new bool[8];
            float size = 6f;
            while (boss && !boss.Dead && boss.Current == move && Time.time - start < 16f)
            {
                KeepPlayerAlive();
                float wind = hm != null && hm.WindNow > 0 ? hm.WindNow : Mathf.Max(0.3f, move.windup);
                var c = boss.BodyCenter + Vector3.up * 0.8f;
                switch (move.Stage)
                {
                    case MoveStage.Windup:
                        if (!taken[0] && move.StageT >= wind * 0.1f) Take(0, "起手", c, size);
                        if (!taken[1] && move.StageT >= wind * 0.5f) Take(1, "预警", c, size);
                        if (!taken[2] && move.StageT >= wind * 0.92f)
                        {
                            Take(2, "蓄力顶点", c, size);
                            SnapEye(id, label, 7, "第一人称", boss.BodyCenter + Vector3.up * 0.6f, "蓄力顶点 · 玩家视角");
                        }
                        break;
                    case MoveStage.Active:
                        if (activeAt < 0) activeAt = Time.time;
                        if (!taken[3] && Time.time - activeAt >= 0.03f) Take(3, "释放帧", c, size, "出手后 1 帧");
                        if (!taken[4] && move.active > 0.8f && Time.time - activeAt >= move.active * 0.45f) Take(4, "持续段", c, size);
                        break;
                    case MoveStage.Recover:
                        if (recoverAt < 0) recoverAt = Time.time;
                        if (id == Phase3Eclipse.MoveId)
                        {
                            if (!taken[5] && Time.time - recoverAt >= Phase3Eclipse.FlareAfter + 0.05f) Take(5, "复燃", c, size, "强光爆发");
                            if (!taken[6] && Time.time - recoverAt >= move.recover * 0.8f) Take(6, "收招", c, size);
                        }
                        else if (!taken[6] && Time.time - recoverAt >= move.recover * 0.35f) Take(6, "收招", c, size);
                        break;
                }
                yield return null;
            }
            // 释放帧对齐：出手事件（hit / beamStart / summon / eclipseStart）到达的时刻 vs 进入出手段的时刻
            string cue = id switch
            {
                Phase1SunSweep.MoveId => "beamStart",
                Phase1SandWraiths.MoveId or Phase2ApsaraCall.MoveId => "summon",
                Phase3Eclipse.MoveId => "eclipseStart",
                _ => "hit",
            };
            var ev = events.FirstOrDefault(e => e.evt == cue);
            string align = ev.evt == null ? "没收到事件（按时间兜底）" : $"{(ev.t - activeAt) * 60f:+0.0;-0.0} 帧（60 fps）";
            Line($"{label}：前摇 {(hm != null ? hm.WindNow : move.windup):F2} s，出手段 {(recoverAt > 0 && activeAt > 0 ? recoverAt - activeAt : 0):F2} s，" +
                 $"出手事件「{cue}」对释放帧 {align}，事件 {string.Join(" ", events.Select(e => $"{e.evt}@{e.t - start:F2}"))}");

            void Take(int k, string beat, Vector3 center, float sz, string note = null)
            {
                taken[k] = true;
                Snap(id, label, k, beat, center, sz, note);
            }
        }
    }

    /// <summary>
    /// 第一章精英的节拍条（bridge.sh playtest beats-elite1；TestArena）：最常以精英出现的三种——蝎尾弩卫（齐射）、三彩镇墓兽（冲锋、踏地）、蜃楼蟾（吐火）——
    /// 各刷一只精英，玩家站着不还手，按状态拍 起手 / 预警 / 蓄力顶点 / 释放帧 / 持续段 / 收招 + 第一人称。
    /// </summary>
    public sealed class EliteCh1BeatsSuite : HBeatSuite
    {
        public override string Id => "beats-elite1";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        const string Tag = "beats_elite1";

        ArenaSpawner arena;
        Vector3 away;

        /// <summary>一个状态里的拍点：状态名、进入后多少秒、节拍名、格子序号</summary>
        readonly struct Beat
        {
            public readonly string state, beat;
            public readonly float at;
            public readonly int order;
            public readonly bool eye;

            public Beat(string state, float at, string beat, int order, bool eye = false)
            {
                this.state = state;
                this.at = at;
                this.beat = beat;
                this.order = order;
                this.eye = eye;
            }
        }

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1f);
            if (!Setup(Tag)) yield break;
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!arena)
            {
                Fail("场景里没有刷怪台（TestArena）");
                yield break;
            }
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;

            yield return One("scorpion_archer", "蝎尾弩卫 · 精英齐射", "scorpion_volley", 15f, new[]
            {
                new Beat("aim", 0.05f, "起手", 0), new Beat("aim", 0.3f, "预警", 1), new Beat("aim", 0.52f, "蓄力顶点", 2, true),
                new Beat("fire", 0.02f, "释放帧", 3), new Beat("fire", 0.4f, "持续段", 4), new Beat("recover", 0.2f, "收招", 6),
            });
            yield return One("tomb_beast", "三彩镇墓兽 · 精英冲锋", "tomb_charge", 12f, new[]
            {
                new Beat("chargeWindup", 0.08f, "起手", 0), new Beat("chargeWindup", 0.5f, "预警", 1), new Beat("chargeWindup", 0.9f, "蓄力顶点", 2, true),
                new Beat("charge", 0.03f, "释放帧", 3), new Beat("charge", 0.4f, "持续段", 4), new Beat("brake", 0.35f, "收招", 6),
            });
            yield return One("tomb_beast", "三彩镇墓兽 · 精英踏地", "tomb_stomp", 2.6f, new[]
            {
                new Beat("stompWindup", 0.06f, "起手", 0), new Beat("stompWindup", 0.35f, "预警", 1), new Beat("stompWindup", 0.62f, "蓄力顶点", 2, true),
                new Beat("stomp", 0.03f, "释放帧", 3), new Beat("stomp", 0.2f, "持续段", 4), new Beat("stomp", 0.45f, "收招", 6),
            });
            yield return One("mirage_toad", "蜃楼蟾 · 精英连吐", "toad_spit", 16f, new[]
            {
                new Beat("puff", 0.08f, "起手", 0), new Beat("puff", 0.5f, "预警", 1), new Beat("puff", 0.9f, "蓄力顶点", 2, true),
                new Beat("spit", 0.02f, "释放帧", 3), new Beat("recover", 0.3f, "持续段", 4), new Beat("recover", 0.68f, "收招", 6),
            });
            arena.Clear();
            Teardown(Tag);
        }

        /// <summary>刷一只精英，玩家站在 distance 米外看着它，等它把这一招按节拍走完（最多 25 s）</summary>
        IEnumerator One(string id, string label, string key, float distance, Beat[] beats)
        {
            if (!ArenaSpawner.IsRegistered(id))
            {
                Line($"{id}：名册里没有，跳过");
                yield break;
            }
            arena.Clear();
            AttackTokens.Reset();
            PackCoordinator.Reset();
            yield return new WaitForSeconds(0.3f);
            Teleport(motor, arena.Center + away * distance);
            yield return null;
            var ai = arena.Spawn(id, true, Vector3.zero);
            if (!ai)
            {
                Fail($"{id}：刷不出来");
                yield break;
            }
            ai.Health.maxHealth *= 50f;
            ai.Health.ResetVitals();
            string state = null;
            float enteredAt = Time.time, t0 = Time.time;
            var taken = new bool[beats.Length];
            bool started = false;
            while (Time.time - t0 < 25f && ai && !ai.Dead)
            {
                KeepPlayerAlive();
                // 踏地：玩家一直贴在它身前（它会往前挪）
                if (key == "tomb_stomp" && !started && Time.time - t0 > 0.5f)
                {
                    var f = ai.transform.forward;
                    f.y = 0;
                    var want = ai.transform.position + f.normalized * distance;
                    if ((motor.transform.position - want).sqrMagnitude > 1.2f) Teleport(motor, want);
                }
                Aim(motor, eye, ai.transform.position + Vector3.up * 1.2f * ai.transform.localScale.x);
                if (ai.State != state)
                {
                    state = ai.State;
                    enteredAt = Time.time;
                    if (beats[0].state == state) started = true;
                }
                if (started)
                {
                    var col = ai.GetComponent<Collider>();
                    var c = col && col.enabled ? col.bounds.center : ai.transform.position + Vector3.up;
                    float sz = col ? Mathf.Clamp(col.bounds.size.magnitude, 1.5f, 6f) : 2f;
                    for (int i = 0; i < beats.Length; i++)
                    {
                        if (taken[i] || beats[i].state != state || Time.time - enteredAt < beats[i].at) continue;
                        // 拍点按顺序：前面的拍子没拍到（状态太短）就不回头拍
                        taken[i] = true;
                        Snap(key, label, beats[i].order, beats[i].beat, c, sz);
                        if (beats[i].eye) SnapEye(key, label, 7, "第一人称", c, beats[i].beat + " · 玩家视角");
                    }
                    if (taken[^1] || (taken.Count(x => x) >= beats.Length - 1 && Time.time - enteredAt > 1.5f)) break;
                }
                yield return null;
            }
            Line($"{label}：拍到 {taken.Count(x => x)}/{beats.Length} 拍，{Time.time - t0:F1} s");
            if (ai) ai.Health.maxHealth = Mathf.Max(1f, ai.Health.maxHealth / 50f);
            arena.Clear();
            yield return new WaitForSeconds(0.4f);
        }
    }
}
