using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗审阅图集的录制器（<see cref="GallerySuite"/> 挂到测试宿主上）：不驱动任何东西，只旁观——
    /// 每帧看场上的敌人 / 首领处在哪一段招式，按招式表（<see cref="GalleryAttacks"/>）在对的那一帧拍：
    ///   · 前摇：前摇状态的最后一帧（预警填得最满），同时拍一张玩家第一人称（视线临时转向出招者，看预警读不读得出来）；
    ///   · 出手：进入出手状态后 0.12 s（首领按出手段时长的 35%，夹在 0.1–0.9 s）；
    ///   · 命中：出手后玩家第一次挨打的那一刻（+0.06 s 让特效亮起来）；没打中就拍收招，自爆的拍炸开那一刻；
    ///   · 精英：每种一张（精英出手那一刻，迟迟不出手就拍站姿）；表外的非移动状态每个拍一张（<see cref="Entry.kind"/> = state）；
    ///   · 首领：转阶段、化形、倒下各拍几张；巡检时（<see cref="deaths"/>）普通敌人的死亡迸散 + 溶解。
    /// 第三人称旁观机位从侧面同时框住怪和玩家（玩家位置放一根青色胶囊替身，只在旁观相机里出现），远程招式的命中帧改框玩家。
    /// 截图写 &lt;dir&gt;/*.jpg（1280×720），清单 manifest.json（每拍一张就重写，超时被杀也留得下），拼图交给 scripts/unity/combat_gallery.py。
    /// </summary>
    public sealed class GalleryRecorder : MonoBehaviour
    {
        public const int W = 1280, H = 720;
        const int MaxWindupCaps = 4;

        [Serializable]
        public sealed class Entry
        {
            /// <summary>文件名（相对清单目录）</summary>
            public string file;
            /// <summary>敌人 / 首领 id、中文名</summary>
            public string subject, name;
            /// <summary>attack / elite / state / death / spawn / boss-move / boss-phase / boss-form / boss-death</summary>
            public string kind;
            /// <summary>招式名（中文）；同一招式的几格共用</summary>
            public string label;
            /// <summary>前摇 / 出手 / 命中 / 收招 / 第一人称 / 精英 / 迸散 / 溶解 …</summary>
            public string phase;
            /// <summary>格子顺序（同一招式内排列）</summary>
            public int order;
            public string form, note, view;
            public bool elite;
            public int bossPhase = -1;
            /// <summary>游戏时间、怪到玩家的水平距离</summary>
            public float t, dist;
        }

        [Serializable]
        sealed class Manifest
        {
            public string group, scene, started;
            public List<Entry> shots = new();
        }

        enum Focus { Both, Subject, Player }

        sealed class Track
        {
            public string state;
            public float stateAt, firstSeen;
            public Vector3 center;
            public float size = 1;
            public Renderer[] renderers;
            // 首领
            public BossMove move;
            public int started;
            public bool transitioning, dead;
            public string form;
            public int phase;
        }

        /// <summary>一次招式的截图会话</summary>
        sealed class Cap
        {
            public EnemyAI ai;
            public BossBrain boss;
            public BossMove move;
            public GalleryAttacks.Attack atk;
            public string key, subject, name, label, form, file;
            public bool elite, single, earlySaved, haveW;
            public int bossPhase = -1;
            public int step;
            public float t0, releaseAt, releaseDue, impactDue = -1;
            public string impactPhase = "命中", impactNote;
            public bool impactHit;
            public RenderTexture rtW, rtF;
            public Vector3 center;
            public float size = 1;
        }

        sealed class Timed
        {
            public float due, timeout;
            public Func<bool> ready;
            public Action shoot;
        }

        /// <summary>巡检时打开：普通敌人死亡拍迸散 + 溶解</summary>
        public bool deaths;

        string dir;
        Action<string> log;
        Manifest manifest;
        Camera spec;
        GameObject standIn;
        Texture2D readback;
        RenderTexture scratch;
        WeaponController weapons;
        PlayerMotor motor;
        readonly Dictionary<EnemyAI, Track> tracks = new();
        readonly List<Cap> caps = new();
        readonly List<Timed> timed = new();
        readonly HashSet<string> taken = new();
        readonly List<EnemyAI> scan = new();
        readonly Dictionary<string, int> perSubject = new();
        float hitT = -1;
        readonly Dictionary<EnemyAI, float> hitBy = new();
        int aborted;

        public int Count => manifest?.shots.Count ?? 0;

        public void Begin(string group, string outDir, string scene, Action<string> logger)
        {
            dir = outDir;
            log = logger;
            Directory.CreateDirectory(dir);
            foreach (var f in Directory.GetFiles(dir, "*.jpg")) File.Delete(f);
            manifest = new Manifest { group = group, scene = scene, started = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
            var go = new GameObject("Gallery Camera");
            go.transform.SetParent(transform, false);
            spec = go.AddComponent<Camera>();
            spec.enabled = false;
            spec.fieldOfView = 50f;
            spec.nearClipPlane = 0.1f;
            spec.farClipPlane = 1500f;
            spec.cullingMask = ~(1 << Layers.FirstPerson);
            var data = spec.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            standIn = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            standIn.name = "Gallery Player Stand-in";
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
            scratch = new RenderTexture(W, H, 24);
            GameEvents.PlayerHit += OnPlayerHit;
            Combat.EnemyKilled += OnKilled;
            WriteManifest();
        }

        /// <summary>收尾：还在等的命中 / 定时截图就地拍掉，记每个对象拍了几张</summary>
        public void End()
        {
            foreach (var c in caps.ToList())
            {
                if (c.step == 0 && c.haveW) SaveWindup(c);
                if (c.step >= 1) Shoot(c, c.step == 1 ? "出手" : c.impactPhase, c.step == 1 ? 1 : 2, Focus.Both, "收尾时补拍");
                Drop(c);
            }
            caps.Clear();
            foreach (var t in timed) t.shoot();
            timed.Clear();
            log?.Invoke($"图集：{Count} 张 → {dir}（被打断放弃 {aborted} 次）");
            foreach (var kv in perSubject.OrderBy(k => k.Key)) log?.Invoke($"  {kv.Key}：{kv.Value} 张");
        }

        void OnDestroy()
        {
            GameEvents.PlayerHit -= OnPlayerHit;
            Combat.EnemyKilled -= OnKilled;
            foreach (var c in caps) Drop(c);
            if (scratch) Destroy(scratch);
            if (readback) Destroy(readback);
        }

        /// <summary>
        /// 玩家挨打：带出手者的记到那只怪头上（<see cref="hitBy"/>）；没标来源的只算 4 点以上、而且不是从玩家自己位置来的
        /// （减益 / 日晒的跳伤 from 就是玩家自己），地火这类小跳伤也不算
        /// </summary>
        void OnPlayerHit(in PlayerHitEvent e)
        {
            var ai = e.source as EnemyAI ?? (e.source as Component ? ((Component)e.source).GetComponentInParent<EnemyAI>() : null);
            if (ai)
            {
                hitBy[ai] = Time.time;
                return;
            }
            if (e.amount < 4f || motor && Vector3.Distance(e.from, motor.transform.position) < 0.3f) return;
            hitT = Time.time;
        }

        /// <summary>这只怪在 since 之后打中过玩家（它自己出手的那一下，或没标来源的一下）</summary>
        bool HitSince(EnemyAI ai, float since, out float t, out bool own)
        {
            t = -1;
            own = ai && hitBy.TryGetValue(ai, out t) && t >= since;
            if (own) return true;
            t = hitT;
            return hitT >= since;
        }

        bool Ready()
        {
            if (!weapons) weapons = FindAnyObjectByType<WeaponController>();
            if (!motor) motor = FindAnyObjectByType<PlayerMotor>();
            return manifest != null && weapons && weapons.eye && motor;
        }

        Vector3 PlayerFeet => motor.transform.position;
        Vector3 PlayerChest => motor.transform.position + Vector3.up * 1.2f;

        // ───────────── 每帧 ─────────────

        void LateUpdate()
        {
            if (!Ready()) return;
            scan.Clear();
            scan.AddRange(EnemyAI.All);
            foreach (var b in BossBrain.Active)
                if (b && !scan.Contains(b)) scan.Add(b);
            foreach (var ai in scan)
            {
                if (!ai) continue;
                if (ai is BossBrain boss) TrackBoss(boss);
                else TrackEnemy(ai);
            }
            foreach (var c in caps.ToList())
            {
                try
                {
                    if (c.boss) AdvanceBoss(c);
                    else AdvanceEnemy(c);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[gallery] {c.key}：{e.Message}");
                    Drop(c);
                    caps.Remove(c);
                }
            }
            for (int i = timed.Count - 1; i >= 0; i--)
            {
                var t = timed[i];
                if (Time.time < t.due) continue;
                if (t.ready != null && !t.ready() && Time.time < t.timeout) continue;
                timed.RemoveAt(i);
                t.shoot();
            }
        }

        Track TrackOf(EnemyAI ai)
        {
            if (!tracks.TryGetValue(ai, out var tr))
            {
                tr = new Track { firstSeen = Time.time, state = null, phase = -1 };
                tracks[ai] = tr;
            }
            Measure(ai, tr);
            return tr;
        }

        static string Sub(EnemyAI ai) => string.IsNullOrEmpty(ai.enemyId) ? ai.name : ai.enemyId;

        static string NameOf(EnemyAI ai)
        {
            if (ai is BossBrain b && b.Def != null) return b.Def.name;
            var def = EnemyRoster.Get(Sub(ai));
            return def != null ? def.name : ai.Health ? ai.Health.displayName : Sub(ai);
        }

        // ───────────── 普通敌人 ─────────────

        void TrackEnemy(EnemyAI ai)
        {
            var tr = TrackOf(ai);
            if (ai.Dead) return;
            string s = ai.State;
            if (s != tr.state)
            {
                string from = tr.state;
                tr.state = s;
                tr.stateAt = Time.time;
                OnState(ai, tr, from, s);
            }
            // 精英迟迟不出手：10 s 后拍一张站姿
            string sub = Sub(ai);
            if (ai.elite && !taken.Contains(sub + "|elite") && Time.time - tr.firstSeen > 10f)
            {
                taken.Add(sub + "|elite");
                ShootTimed(ai, 0, "elite", "精英", "精英", 0, Focus.Subject, "站姿（10 s 内没出手）");
            }
        }

        void OnState(EnemyAI ai, Track tr, string from, string to)
        {
            if (string.IsNullOrEmpty(to)) return;
            string sub = Sub(ai);
            var atks = GalleryAttacks.For(sub);
            foreach (var a in atks)
            {
                if (a.windup != to) continue;
                string key = $"{sub}|{a.label}";
                if (taken.Contains(key) || caps.Count(c => c.step == 0) >= MaxWindupCaps) continue;
                taken.Add(key);
                var c = new Cap
                {
                    ai = ai, atk = a, key = key, subject = sub, name = NameOf(ai), label = a.label, elite = ai.elite,
                    single = a.release.Length == 0, t0 = Time.time, file = $"{sub}_{Array.IndexOf(atks, a):00}",
                    rtW = RenderTexture.GetTemporary(W, H, 24), rtF = RenderTexture.GetTemporary(W, H, 24),
                    center = tr.center, size = tr.size,
                };
                caps.Add(c);
            }
            // 精英：出手那一刻
            if (ai.elite && !taken.Contains(sub + "|elite"))
            {
                var a = atks.FirstOrDefault(x => x.release.Contains(to) || x.release.Length == 0 && x.windup == from);
                if (a != null)
                {
                    taken.Add(sub + "|elite");
                    ShootTimed(ai, 0.12f, "elite", a.label, "精英", 0, Focus.Both, $"精英 · {a.label}");
                }
            }
            // 招式表以外的非移动状态：每个拍一张
            if (!GalleryAttacks.Movement.Contains(to) && !atks.Any(a => a.windup == to || a.release.Contains(to) || a.impact == to))
            {
                string key = $"{sub}|state|{to}";
                if (!taken.Contains(key))
                {
                    taken.Add(key);
                    ShootTimed(ai, 0.25f, "state", GalleryAttacks.StateName(to), "状态", 0, Focus.Both, to);
                }
            }
        }

        void AdvanceEnemy(Cap c)
        {
            bool alive = c.ai && !c.ai.Dead;
            if (alive && tracks.TryGetValue(c.ai, out var tr))
            {
                c.center = tr.center;
                c.size = tr.size;
            }
            string st = alive ? c.ai.State : null;
            float now = Time.time;
            switch (c.step)
            {
                case 0:
                    if (alive && st == c.atk.windup)
                    {
                        RenderSpec(c.rtW, c.center, c.size, Focus.Both);
                        RenderEye(c.rtF, c.center);
                        c.haveW = true;
                        if (c.single && !c.earlySaved && now - c.t0 >= 0.3f)
                        {
                            SaveWindup(c);
                            c.earlySaved = true;
                        }
                        if (now - c.t0 > 8f) Abort(c, "前摇超过 8 s");
                        return;
                    }
                    bool released = !alive || c.single || c.atk.release.Contains(st);
                    if (!released || !c.haveW)
                    {
                        Abort(c, $"前摇后进了 {st}");
                        return;
                    }
                    if (!c.earlySaved) SaveWindup(c);
                    c.releaseAt = now;
                    c.releaseDue = now + (alive ? 0.12f : 0.05f);
                    c.step = 1;
                    return;
                case 1:
                    if (now < c.releaseDue) return;
                    Shoot(c, "出手", 1, Dist(c.center) > 12f ? Focus.Subject : Focus.Both, c.single ? $"{c.atk.windup} 结束" : st ?? "（已死亡）");
                    c.step = 2;
                    return;
                default:
                    if (c.impactDue < 0 && c.atk.support)
                    {
                        // 辅助招：不等命中，拍出手后的效果（护盾、冰壁、换位落点、倒地）
                        c.impactDue = c.atk.impact != null && st == c.atk.impact ? now + 0.12f : Mathf.Max(now, c.releaseAt + 0.7f);
                        c.impactPhase = "效果";
                        c.impactNote = c.atk.impact != null && st == c.atk.impact ? c.atk.impact : "出手后 0.7 s";
                        if (c.atk.impact != null && st != c.atk.impact && now - c.releaseAt < 3f) c.impactDue = -1;
                    }
                    if (c.impactDue < 0 && !c.atk.support)
                    {
                        if (HitSince(c.ai, c.releaseAt, out float ht, out bool own))
                        {
                            c.impactDue = ht + 0.06f;
                            c.impactHit = true;
                            c.impactNote = own ? "命中玩家" : "命中玩家（来源未标）";
                        }
                        else if (c.atk.impact != null && st == c.atk.impact)
                        {
                            c.impactDue = now + 0.12f;
                            c.impactNote = c.atk.impact;
                        }
                        else if (!alive)
                        {
                            c.impactDue = now + 0.08f;
                            c.impactNote = "自爆 / 倒下";
                        }
                        else
                        {
                            // 命中本身是个状态（钻出、落地、拖拽）的多等一会儿：潜行 / 滑翔要飞一段
                            float wait = c.atk.impact != null ? 4f : c.atk.ranged ? 3.2f : 2.0f;
                            bool back = st != c.atk.windup && !c.atk.release.Contains(st) && st != c.atk.impact;
                            if (now - c.releaseAt > wait || !c.atk.ranged && c.atk.impact == null && back && now - c.releaseAt > 0.5f)
                            {
                                c.impactDue = now;
                                c.impactPhase = "收招";
                                c.impactNote = $"没打中（{st}）";
                            }
                        }
                    }
                    if (c.impactDue >= 0 && now >= c.impactDue)
                    {
                        var focus = c.impactHit && Vector3.Distance(Flat(c.center), Flat(PlayerFeet)) > 9f ? Focus.Player : Focus.Both;
                        Shoot(c, c.impactPhase, 2, focus, c.impactNote);
                        Done(c);
                    }
                    return;
            }
        }

        // ───────────── 首领 ─────────────

        void TrackBoss(BossBrain b)
        {
            var tr = TrackOf(b);
            string sub = Sub(b);
            if (tr.phase < 0)
            {
                tr.phase = b.Phase;
                tr.form = b.Form?.id;
            }
            if (b.Dead)
            {
                BossDeath(b);
                return;
            }
            if (b.Transitioning && !tr.transitioning && taken.Add($"{sub}|phase|{tr.phase}|{b.Phase}"))
            {
                int to = b.Phase;
                foreach (var (d, ph, i) in new[] { (0.4f, "转阶段·起", 0), (1.8f, "转阶段·中", 1) })
                    ShootTimed(b, d, "boss-phase", $"转阶段 {tr.phase + 1} → {to + 1}", ph, i, Focus.Both, null, $"{sub}_phase{tr.phase + 1}to{to + 1}");
            }
            tr.transitioning = b.Transitioning;
            tr.phase = b.Phase;
            string form = b.Form?.id;
            if (form != tr.form)
            {
                if (tr.form != null && taken.Add($"{sub}|form|{form}"))
                    foreach (var (d, ph, i) in new[] { (0.3f, "化形·起", 0), (1.6f, "化形·成", 1) })
                        ShootTimed(b, d, "boss-form", $"化形 → {b.Form?.name}", ph, i, Focus.Both, null, $"{sub}_form_{form}");
                tr.form = form;
            }
            var m = b.Current;
            if (m == null || m == tr.move && m.TimesStarted == tr.started) return;
            tr.move = m;
            tr.started = m.TimesStarted;
            string key = $"{sub}|{m.Id}|{form}|{b.Phase}";
            if (taken.Contains(key) || caps.Count(c => c.step == 0) >= MaxWindupCaps) return;
            taken.Add(key);
            caps.Add(new Cap
            {
                ai = b, boss = b, move = m, key = key, subject = sub, name = NameOf(b), label = m.Name, form = b.Form?.name, bossPhase = b.Phase,
                t0 = Time.time, file = $"{sub}_{m.Id}_{form}_p{b.Phase + 1}",
                rtW = RenderTexture.GetTemporary(W, H, 24), rtF = RenderTexture.GetTemporary(W, H, 24),
                center = tr.center, size = tr.size,
            });
        }

        void AdvanceBoss(Cap c)
        {
            var b = c.boss;
            if (!b || b.Dead)
            {
                if (c.step == 0) Abort(c, "首领倒下");
                else
                {
                    Shoot(c, c.step == 1 ? "出手" : "收招", c.step, Focus.Both, "首领倒下");
                    Done(c);
                }
                return;
            }
            if (tracks.TryGetValue(b, out var tr))
            {
                c.center = tr.center;
                c.size = tr.size;
            }
            var m = c.move;
            bool current = b.Current == m && m.TimesStarted == (tracks.TryGetValue(b, out var t2) ? t2.started : -1);
            float now = Time.time;
            switch (c.step)
            {
                case 0:
                    if (current && m.Stage == MoveStage.Windup)
                    {
                        RenderSpec(c.rtW, c.center, c.size, Focus.Both);
                        RenderEye(c.rtF, c.center);
                        c.haveW = true;
                        if (now - c.t0 > 12f) Abort(c, "前摇超过 12 s");
                        return;
                    }
                    if (!current && m.Stage != MoveStage.Done || m.Cancelled || !m.ReachedActive)
                    {
                        Abort(c, m.Cancelled ? "被打断" : "没到出手段");
                        return;
                    }
                    if (c.haveW) SaveWindup(c);
                    c.releaseAt = now;
                    c.releaseDue = now + Mathf.Clamp(m.active * 0.35f, 0.1f, 0.9f);
                    c.step = 1;
                    return;
                case 1:
                    if (now < c.releaseDue) return;
                    Shoot(c, "出手", 1, Focus.Both, null);
                    c.step = 2;
                    return;
                default:
                    if (c.impactDue < 0)
                    {
                        if (HitSince(b, c.releaseAt, out float ht, out bool own))
                        {
                            c.impactDue = ht + 0.06f;
                            c.impactHit = true;
                            c.impactNote = own ? "命中玩家" : "命中玩家（来源未标）";
                        }
                        else if (!current || m.Stage is MoveStage.Recover or MoveStage.Done || now - c.releaseAt > 6f)
                        {
                            c.impactDue = now + (current && m.Stage == MoveStage.Recover ? 0.1f : 0f);
                            c.impactPhase = "收招";
                            c.impactNote = "没打中";
                        }
                    }
                    if (c.impactDue >= 0 && now >= c.impactDue)
                    {
                        Shoot(c, c.impactPhase, 2, c.impactHit && Dist(c.center) > 14f ? Focus.Player : Focus.Both, c.impactNote);
                        Done(c);
                    }
                    return;
            }
        }

        // ───────────── 死亡 ─────────────

        /// <summary>首领倒下演出：0.3 / 1.5 / 3.5 s 各一张（首领一死就离开活跃列表，所以由击杀事件触发）</summary>
        void BossDeath(BossBrain b)
        {
            string sub = Sub(b);
            if (!taken.Add(sub + "|death")) return;
            TrackOf(b).dead = true;
            foreach (var (d, ph, i) in new[] { (0.3f, "倒下", 0), (1.5f, "溃散", 1), (3.5f, "落幕", 2) })
                ShootTimed(b, d, "boss-death", "倒下演出", ph, i, Focus.Subject, null, $"{sub}_death");
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            if (d && d.IsBoss && d.GetComponent<BossBrain>() is { } boss)
            {
                BossDeath(boss);
                return;
            }
            if (!deaths || !d || d.IsBoss) return;
            var ai = d.GetComponent<EnemyAI>();
            if (!ai) return;
            string sub = Sub(ai);
            if (taken.Contains(sub + "|death")) return;
            taken.Add(sub + "|death");
            var tr = TrackOf(ai);
            ShootTimed(ai, 0.1f, "death", "死亡", "迸散", 0, Focus.Subject, null, $"{sub}_death");
            var dd = d.GetComponent<DeathDissolve>();
            var shot = new Timed { due = Time.time + 0.4f, timeout = Time.time + 9f, ready = () => !dd || dd.Amount >= 0.45f };
            shot.shoot = () =>
            {
                if (ai) Measure(ai, tr);
                Save(Render(tr.center, tr.size, Focus.Subject), new Entry
                {
                    subject = sub, name = NameOf(ai), kind = "death", label = "死亡", phase = "溶解", order = 1, elite = ai.elite, dist = Dist(tr.center),
                    note = !dd ? "没有溶解组件" : dd.Amount >= 0.45f ? $"溶解 {dd.Amount:P0}" : "等溶解超时",
                }, $"{sub}_death_1");
            };
            timed.Add(shot);
        }

        /// <summary>巡检用：刷出来后拍出生法阵 / 显形（由套件调用）</summary>
        public void SpawnShots(EnemyAI ai)
        {
            string sub = Sub(ai);
            ShootTimed(ai, 0.3f, "spawn", "出生", "出生法阵", 0, Focus.Subject, null, $"{sub}_spawn");
            ShootTimed(ai, 0.9f, "spawn", "出生", "显形", 1, Focus.Subject, null, $"{sub}_spawn");
        }

        // ───────────── 拍摄 ─────────────

        void ShootTimed(EnemyAI ai, float delay, string kind, string label, string phase, int order, Focus focus, string note, string file = null)
        {
            var tr = TrackOf(ai);
            string sub = Sub(ai), name = NameOf(ai);
            bool elite = ai.elite;
            var boss = ai as BossBrain;
            string form = boss ? boss.Form?.name : null;
            int ph = boss ? boss.Phase : -1;
            string state = ai.State;
            file = $"{file ?? $"{sub}_{kind}_{(kind == "state" ? state : Hash(label))}"}_{order}";
            timed.Add(new Timed
            {
                due = Time.time + delay,
                shoot = () =>
                {
                    if (ai) Measure(ai, tr);
                    Save(Render(tr.center, tr.size, focus), new Entry
                    {
                        subject = sub, name = name, kind = kind, label = label, phase = phase, order = order, elite = elite, form = form, bossPhase = ph,
                        note = note, dist = Dist(tr.center),
                    }, file);
                },
            });
        }

        void SaveWindup(Cap c)
        {
            Save(c.rtW, Make(c, "前摇", 0, c.single ? $"{c.atk?.windup ?? "前摇"} +0.3 s" : "前摇最后一帧"), c.file + "_0");
            Save(c.rtF, Make(c, "第一人称", 3, "前摇最后一帧 · 玩家视角（视线转向出招者）", "fp"), c.file + "_3");
        }

        void Shoot(Cap c, string phase, int order, Focus focus, string note)
        {
            Save(Render(c.center, c.size, focus), Make(c, phase, order, note), $"{c.file}_{order}");
        }

        Entry Make(Cap c, string phase, int order, string note, string view = "tp") => new()
        {
            subject = c.subject, name = c.name, kind = c.boss ? "boss-move" : "attack", label = c.label, phase = phase, order = order,
            elite = c.elite, form = c.form, bossPhase = c.bossPhase, note = note, view = view, dist = Dist(c.center),
        };

        static string Hash(string s)
        {
            uint h = 2166136261;
            foreach (char ch in s ?? "") h = (h ^ ch) * 16777619;
            return h.ToString("x8");
        }

        void Done(Cap c)
        {
            Drop(c);
            caps.Remove(c);
        }

        void Abort(Cap c, string why)
        {
            taken.Remove(c.key);
            aborted++;
            Done(c);
        }

        static void Drop(Cap c)
        {
            if (c.rtW) RenderTexture.ReleaseTemporary(c.rtW);
            if (c.rtF) RenderTexture.ReleaseTemporary(c.rtF);
            c.rtW = c.rtF = null;
        }

        RenderTexture Render(Vector3 center, float size, Focus focus)
        {
            RenderSpec(scratch, center, size, focus);
            return scratch;
        }

        void Save(RenderTexture rt, Entry e, string file)
        {
            if (!rt) return;
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            readback.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            readback.Apply(false);
            RenderTexture.active = prev;
            file = Safe(file) + ".jpg";
            File.WriteAllBytes(Path.Combine(dir, file), readback.EncodeToJPG(90));
            e.file = file;
            e.t = Time.time;
            e.view ??= "tp";
            manifest.shots.Add(e);
            perSubject.TryGetValue(e.subject ?? "?", out int n);
            perSubject[e.subject ?? "?"] = n + 1;
            WriteManifest();
        }

        static string Safe(string s)
        {
            var chars = s.Select(ch => char.IsLetterOrDigit(ch) && ch < 128 || ch is '_' or '-' ? ch : '_').ToArray();
            return new string(chars);
        }

        void WriteManifest()
        {
            try { File.WriteAllText(Path.Combine(dir, "manifest.json"), JsonUtility.ToJson(manifest, true)); }
            catch (IOException) { }
        }

        /// <summary>玩家第一人称：眼睛位置不动，视线临时转向出招者（拍完还原），连同武器一起拍</summary>
        void RenderEye(RenderTexture rt, Vector3 lookAt)
        {
            var eye = weapons.eye;
            var t = eye.transform;
            var rot = t.rotation;
            var dir = lookAt - t.position;
            if (dir.sqrMagnitude > 0.01f) t.rotation = Quaternion.LookRotation(dir);
            var prev = eye.targetTexture;
            eye.targetTexture = rt;
            eye.Render();
            eye.targetTexture = prev;
            t.rotation = rot;
        }

        /// <summary>旁观机位：从侧面同时框住对象和玩家（玩家处放替身胶囊）；离得远时只框对象 / 只框玩家</summary>
        void RenderSpec(RenderTexture rt, Vector3 subject, float size, Focus focus)
        {
            var p = PlayerChest;
            var d = Flat(p - subject);
            float dist = d.magnitude;
            var dir = dist > 0.1f ? d / dist : Flat(motor.transform.forward).normalized;
            var side = Vector3.Cross(Vector3.up, dir);
            float sz = Mathf.Max(1f, size);
            if (focus == Focus.Both && dist > 16f + sz) focus = Focus.Subject;
            Vector3 look, pos;
            switch (focus)
            {
                case Focus.Subject:
                    look = subject;
                    float ds = 2.6f + sz * 1.9f;
                    pos = subject + side * ds * 0.75f + dir * ds * 0.7f + Vector3.up * (0.6f + sz * 0.35f);
                    break;
                case Focus.Player:
                    look = p;
                    pos = p + side * 3.4f + dir * 3.2f + Vector3.up * 1.4f;
                    break;
                default:
                    look = Vector3.Lerp(subject, p, 0.42f);
                    float db = Mathf.Max(4.5f + sz, dist * 0.95f + sz * 1.2f);
                    pos = look + side * db + dir * db * 0.22f + Vector3.up * (1.2f + sz * 0.3f + dist * 0.08f);
                    break;
            }
            pos = Unblock(pos, look, side);
            spec.transform.position = pos;
            spec.transform.LookAt(look);
            standIn.transform.position = PlayerFeet + Vector3.up * 0.9f;
            standIn.SetActive(true);
            var prev = spec.targetTexture;
            spec.targetTexture = rt;
            spec.Render();
            spec.targetTexture = prev;
            standIn.SetActive(false);
        }

        /// <summary>机位被墙 / 地形挡住时换到另一侧、再升高，最后贴到遮挡物前面；不钻到地面以下</summary>
        static Vector3 Unblock(Vector3 pos, Vector3 look, Vector3 side)
        {
            Vector3 Ground(Vector3 q)
            {
                if (Physics.Raycast(q + Vector3.up * 40f, Vector3.down, out var h, 120f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && q.y < h.point.y + 0.6f)
                    q.y = h.point.y + 0.6f;
                return q;
            }
            // 机位在方块里面时 Linecast 打不到那块的背面：先查机位处有没有东西
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

        float Dist(Vector3 c) => Vector3.Distance(Flat(c), Flat(PlayerFeet));

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v;
        }

        /// <summary>
        /// 对象中心与尺寸：有碰撞体用碰撞体（首领用身体胶囊——旱魃的日轮升到 45 m 高空也挂在它的渲染器下面），
        /// 没有（遁地、登场中）才用渲染器包围盒（缓存渲染器列表）
        /// </summary>
        static void Measure(EnemyAI ai, Track tr)
        {
            if (!ai) return;
            var col = ai is BossBrain ? ai.GetComponent<CapsuleCollider>() : ai.GetComponent<Collider>();
            if (col && col.enabled)
            {
                var bc = col.bounds;
                tr.center = bc.center;
                tr.size = Mathf.Max(bc.size.x, bc.size.y, bc.size.z);
                return;
            }
            tr.renderers ??= ai.GetComponentsInChildren<Renderer>(true).Where(r => r is SkinnedMeshRenderer or MeshRenderer).ToArray();
            bool any = false;
            var b = new Bounds(ai.transform.position + Vector3.up, Vector3.one);
            foreach (var r in tr.renderers)
            {
                if (!r || !r.enabled || !r.gameObject.activeInHierarchy) continue;
                if (!any)
                {
                    b = r.bounds;
                    any = true;
                }
                else b.Encapsulate(r.bounds);
            }
            tr.center = any ? b.center : ai.transform.position + Vector3.up;
            tr.size = any ? Mathf.Clamp(Mathf.Max(b.size.x, b.size.y, b.size.z), 1f, 40f) : 1.5f;
        }
    }
}
