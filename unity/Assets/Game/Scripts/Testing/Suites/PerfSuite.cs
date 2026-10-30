using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 固定机位性能基线（I4；协议见 docs/performance-unity.md）：
    ///   bridge.sh playtest perf [关卡 id]（默认 1-1，只测这一关）；perf-ch1 / perf-ch2 / perf-ch3（一章 4 关，从本章第一关进，之后 SceneFlow.GoTo）。
    /// 机位（<see cref="PerfViews"/>，L5 的 PerfBudgetCheck 用同一份规则，全由关卡数据推出）：出生 / 中段远眺 / 战斗，加上主线机位链（出生点 + 必经地点按最近邻串起来，最多 8 段）。
    /// 战斗机位在场地中心周围摆 6 只本关场地里最常见的敌人（AI 停住、着火 + 感电），玩家站在机位上暴击连射，采样期间两次 3 m 爆炸。
    /// 测量：
    ///   · 单独一台测量相机（参数同玩家主相机：70°、远裁 1500 m、后处理、SMAA 高，不含第一人称层），渲染到固定的 1920×1080，和 Game 视图大小无关；
    ///     测量期间关掉其它相机、垂直同步和帧率上限，测完还原；它挂 MainCamera 标签，按图层剔除距离（CullLayers）照常作用在它上面；
    ///   · 每关先停掉场地、首领遭遇（机位附近不会真的开战）和天气导演（区域风暴按时间循环，会让两次采样的雾不一样），玩家无敌；
    ///   · 高 / 低两档：换档后先把每个机位看 0.5 s（着色器变体、贴图上传、阴影图），再逐个机位预热 1 s、采 2 s（<see cref="PerfProbe"/>）：
    ///     整帧 P50 / P95（编辑器里的整帧）、主线程 P50 / P95（CPU Main Thread Frame Time，不含编辑器那段）与 PlayerLoop 均值、渲染线程 P95、GPU P50 / P95，
    ///     绘制调用（Unity 6.5 按路径分开计，这里相加）/ SetPass / 实例 / 三角面 / 投影体均值、每帧 GC、视锥内渲染器（估算），以及同一机位的 L5 估算。
    /// 预算：「当前」配置的每条记录对 <see cref="PerfBudget"/> 比对，超出记不合格。结果写 Assets/Art/_Review/&lt;前缀&gt;_&lt;关卡&gt;.json，
    /// scripts/unity/perf_table.py 出表。对照套件：perf-grd（GPU 常驻绘制 / GPU 遮挡）、perf-cull（按图层剔除距离，带截图）。
    /// 编辑器 Play 模式的整帧含编辑器自身开销、受机器负载影响大，所以预算只看主线程、GPU 和计数，只跟同一台机器、同一协议的上一次比。
    /// </summary>
    public class PerfSuite : PlaytestSuite
    {
        public override string Id => "perf";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        /// <summary>依次测的关（第一关应是本套件场景；之后 SceneFlow.GoTo）。空 = 只测打开的这一关</summary>
        protected virtual string[] Stages => Array.Empty<string>();
        /// <summary>测哪几档（默认高 / 低）</summary>
        protected virtual ArtQualityLevel[] Tiers => new[] { ArtQualityLevel.High, ArtQualityLevel.Low };
        /// <summary>带上主线机位链（对照套件只测三类机位，控制在 600 s 以内）</summary>
        protected virtual bool Chain => true;
        /// <summary>对照的渲染配置（默认只有「当前」= 工程设置）：每档里每个配置各测一遍全部机位；套件结束时还原</summary>
        protected virtual (string name, Action apply)[] Configs => new (string, Action)[] { (Current, null) };
        /// <summary>每个机位采完拍一张（_Review/playtest_&lt;前缀&gt;_&lt;关卡&gt;_&lt;机位&gt;_&lt;档&gt;_&lt;配置序号&gt;.png）</summary>
        protected virtual bool Screenshots => false;
        /// <summary>结果文件名前缀</summary>
        protected virtual string FilePrefix => "perf";
        /// <summary>套件结束时还原渲染配置</summary>
        protected virtual void RestoreConfig() { }

        public const string Current = "当前";
        public const float Prewarm = 0.5f, Warmup = 1f, SampleSeconds = 2f, ReadyTimeout = 90f;
        public const int Width = 1920, Height = 1080, CombatEnemies = 6;

        /// <summary>一次采样（一关 × 一个机位 × 一档 × 一种配置）</summary>
        [Serializable]
        public sealed class Record
        {
            public string level, view, tier, config;
            public bool combat, chain;
            public Vector3 eye, target;
            public int frames;
            public float frameP50, frameP95, mainP50, mainP95, playerLoopMs, renderP95, gpuP50, gpuP95, gcBytes;
            public int drawCalls, brgDrawCalls, srpDraws, standardDraws, staticBatchedDraws, setPass, instances, shadowCasters, frustumRenderers, renderers;
            public long triangles;
            public int particles, enemies;
            /// <summary>同一机位的 L5 估算（构建时 PerfBudgetCheck 算的那一套），对照用</summary>
            public int estRenderers, estDraws, estCasterDraws;
            public long estTriangles;
        }

        [Serializable]
        sealed class LevelFile
        {
            public string level, title, scene, environment, device, cpu, finished, grd;
            public int width = Width, height = Height;
            public List<Record> records = new();
        }

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Transform eye;
        Camera cam;
        RenderTexture rt;
        readonly List<Camera> paused = new();
        int vSync0, frameRate0;

        protected override IEnumerator Steps()
        {
            var quality = ArtQuality.Level;
            vSync0 = QualitySettings.vSyncCount;
            frameRate0 = Application.targetFrameRate;
            var stages = Stages;
            try
            {
                if (stages.Length == 0)
                {
                    yield return WaitReady();
                    yield return MeasureLevel();
                }
                else
                    for (int i = 0; i < stages.Length; i++)
                    {
                        var stage = RunPlan.Get(stages[i]);
                        if (stage == null)
                        {
                            Fail($"RunPlan 里没有 {stages[i]}");
                            continue;
                        }
                        yield return WaitReady();
                        var flow = SceneFlow.Instance;
                        if (!flow) yield break;
                        if (flow.Current != stage)
                        {
                            int before = flow.Transitions;
                            if (!flow.GoTo(stage))
                            {
                                Fail($"去不了 {stage.Label}（场景 {stage.scene}）");
                                continue;
                            }
                            float t0 = Time.realtimeSinceStartup;
                            while (Time.realtimeSinceStartup - t0 < ReadyTimeout && (flow.Busy || flow.Transitions <= before || flow.Player == null)) yield return null;
                            if (flow.Busy || flow.Current != stage)
                            {
                                Fail($"换到 {stage.Label} 超时");
                                continue;
                            }
                            Line($"换关 → {stage.Label}：{Time.realtimeSinceStartup - t0:F1} s");
                        }
                        yield return MeasureLevel();
                    }
            }
            finally
            {
                EndCamera();
                RestoreConfig();
                ArtQuality.Set(quality, false);
                QualitySettings.vSyncCount = vSync0;
                Application.targetFrameRate = frameRate0;
                if (weapons) weapons.testFire = false;
            }
        }

        IEnumerator WaitReady()
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < ReadyTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(1f);
        }

        IEnumerator MeasureLevel()
        {
            var flow = SceneFlow.Instance;
            var rig = flow ? flow.Player : null;
            if (rig == null || !rig.root)
            {
                Fail("关卡没就绪（没有 SceneFlow / 玩家）");
                yield break;
            }
            motor = rig.motor;
            vitals = rig.vitals;
            weapons = rig.weapons;
            eye = weapons ? weapons.eye.transform : rig.cam.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 99999;

            var scene = flow.CurrentScene;
            var meta = LevelMeta.Current;
            string id = meta ? meta.levelId : flow.Current?.code ?? scene.name;
            int sites = 0, bosses = 0, weather = 0;
            foreach (var s in FindObjectsByType<EncounterSite>())
                if (s.gameObject.scene == scene && s.enabled) { s.enabled = false; sites++; }
            foreach (var b in FindObjectsByType<BossEncounter>())
                if (b.gameObject.scene == scene && b.enabled) { b.enabled = false; bosses++; }
            foreach (var w in FindObjectsByType<WeatherDirector>())
                if (w.enabled) { w.enabled = false; weather++; }

            var (spawnPos, spawnRot) = PlayerSpawn.Resolve(scene);
            var pois = meta ? (IReadOnlyList<LevelPoi>)meta.pois : LevelMeta.Collect(scene);
            var views = PerfViews.Compute(spawnPos, spawnRot, pois, meta ? meta.mapArea : default, Chain);
            for (int i = 0; i < views.Count; i++)
            {
                var v = views[i];
                v.stand = PerfViews.Ground(v.stand);
                views[i] = v;
            }
            var enemyIds = EnemyIds(scene);
            Line($"── {id}「{meta?.title ?? scene.name}」：停掉场地 {sites} 处、首领遭遇 {bosses} 个、天气导演 {weather} 个；机位 {views.Count} 个" +
                 $"（{string.Join("、", views.Select(v => $"{v.name} ({v.stand.x:F0}, {v.stand.y:F0}, {v.stand.z:F0})"))}）；战斗用 {string.Join("/", enemyIds)}");
            var renderers = new List<Renderer>(FindObjectsByType<Renderer>());
            var file = new LevelFile
            {
                level = id, title = meta ? meta.title : scene.name, scene = scene.path, environment = PerfProbe.Environment(),
                device = SystemInfo.graphicsDeviceName, cpu = SystemInfo.processorType, finished = DateTime.Now.ToString("s"), grd = GrdState(),
            };

            BeginCamera();
            var configs = Configs;
            foreach (var tier in Tiers)
            for (int ci = 0; ci < configs.Length; ci++)
            {
                var (config, apply) = configs[ci];
                ArtQuality.Set(tier, false);
                if (apply != null)
                {
                    apply();
                    for (int i = 0; i < 30; i++) yield return null;
                }
                // 预热：换档 / 换配置后先把每个机位看一遍（着色器变体编译、贴图上传、阴影图重建都在这里）
                foreach (var v in views)
                {
                    Point(v);
                    yield return new WaitForSecondsRealtime(Prewarm);
                }
                foreach (var v in views)
                {
                    var rec = new Record { level = id, view = v.name, tier = ArtQuality.Label(tier), config = config, combat = v.combat, chain = v.chain };
                    string shot = Screenshots && !v.chain ? $"{FilePrefix}_{id}_{ViewKey(v.name)}_{(tier == ArtQualityLevel.High ? "high" : "low")}_{ci}" : null;
                    yield return Measure(v, enemyIds, renderers, rec, shot);
                    file.records.Add(rec);
                    Line($"  {rec.tier}{(configs.Length > 1 ? $" · {config}" : "")} · {rec.view}：主线程 P50 {Ms(rec.mainP50)} / P95 {Ms(rec.mainP95)}（PlayerLoop {Ms(rec.playerLoopMs)}），" +
                         $"渲染线程 P95 {Ms(rec.renderP95)}，GPU P50 {Ms(rec.gpuP50)} / P95 {Ms(rec.gpuP95)}，整帧 P50 {rec.frameP50:F1}；" +
                         $"绘制 {rec.drawCalls}（BRG {rec.brgDrawCalls}）、SetPass {rec.setPass}、三角面 {rec.triangles / 1000f:F0}k、投影体 {rec.shadowCasters}、视锥内渲染器 {rec.frustumRenderers}" +
                         (v.combat ? $"；敌人 {rec.enemies}、粒子 {rec.particles}" : ""));
                    if (config == Current)
                    {
                        var over = PerfBudget.Check(tier == ArtQualityLevel.High, rec.gpuP95, rec.mainP95, rec.drawCalls, rec.setPass, rec.triangles, rec.frustumRenderers);
                        if (over != null) Fail($"{id} {rec.tier} · {rec.view} 超出预算：{over}");
                    }
                }
            }
            EndCamera();
            ArtQuality.Set(ArtQualityLevel.High, false);
            try
            {
                File.WriteAllText(Path.Combine(ShotDir, $"{FilePrefix}_{id}.json"), JsonUtility.ToJson(file, true));
            }
            catch (IOException e)
            {
                Fail($"写 {FilePrefix}_{id}.json 失败：{e.Message}");
            }
        }

        static string Ms(float v) => v > 0 ? $"{v:F2}" : "—";

        static string ViewKey(string name) => name switch { PerfViews.Spawn => "spawn", PerfViews.Vista => "vista", PerfViews.Fight => "combat", _ => "view" };

        // ───────────── 测量相机 ─────────────

        void BeginCamera()
        {
            if (cam) return;
            rt = new RenderTexture(Width, Height, 24) { name = "Perf RT" };
            cam = new GameObject("Perf Camera") { tag = "MainCamera" }.AddComponent<Camera>();
            cam.fieldOfView = 70f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 1500f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            cam.targetTexture = rt;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            paused.Clear();
            foreach (var c in FindObjectsByType<Camera>())
                if (c != cam && c.enabled)
                {
                    c.enabled = false;
                    paused.Add(c);
                }
            // 不限帧：垂直同步 / 帧率上限会把帧时卡住
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
        }

        void EndCamera()
        {
            foreach (var c in paused)
                if (c) c.enabled = true;
            paused.Clear();
            if (cam) Destroy(cam.gameObject);
            cam = null;
            if (rt)
            {
                rt.Release();
                Destroy(rt);
            }
            rt = null;
        }

        void Point(PerfView v)
        {
            var e = v.Eye;
            var dir = v.look - e;
            if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
            cam.transform.SetPositionAndRotation(e, Quaternion.LookRotation(dir));
        }

        // ───────────── 一个机位 ─────────────

        IEnumerator Measure(PerfView v, string[] enemyIds, List<Renderer> renderers, Record rec, string shot)
        {
            Point(v);
            var spawned = new List<EnemyAI>();
            if (v.combat)
            {
                Place(v.stand);
                yield return null;
                Aim(motor, eye, v.look);
                for (int i = 0; i < CombatEnemies; i++)
                {
                    float a = i * Mathf.PI * 2 / CombatEnemies;
                    var p = v.look - Vector3.up + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 4f;
                    if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
                    var ai = EnemyRoster.Spawn(enemyIds[i % enemyIds.Length], p, Quaternion.LookRotation(Flat(v.stand - p).normalized + Vector3.forward * 1e-3f), 1f, false);
                    if (!ai) continue;
                    ai.Health.maxHealth = 1e6f;
                    ai.Health.ResetVitals();
                    spawned.Add(ai);
                }
                yield return new WaitForSecondsRealtime(1f);
                foreach (var ai in spawned)
                {
                    if (!ai) continue;
                    ai.enabled = false;
                    EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                    EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
                }
                if (weapons && weapons.Active != null)
                {
                    vitals.stats.Add("perf_crit", Stat.CritChance, 1f);
                    weapons.testFire = true;
                }
            }
            float t0 = Time.realtimeSinceStartup;
            int k = 0;
            while (Time.realtimeSinceStartup - t0 < Warmup)
            {
                Tick(v, spawned, ref k);
                yield return null;
            }
            FxBudget.ResetPeak();
            using var probe = new PerfProbe();
            t0 = Time.realtimeSinceStartup;
            int booms = 0;
            while (Time.realtimeSinceStartup - t0 < SampleSeconds)
            {
                Tick(v, spawned, ref k);
                if (v.combat && booms < 2 && Time.realtimeSinceStartup - t0 > 0.5f + booms)
                {
                    booms++;
                    var at = v.look - Vector3.up * 0.5f;
                    Combat.Explode(new ExplosionOptions(at, 3f, DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up)) { noEnemies = true });
                }
                yield return null;
                probe.Sample();
            }
            var r = probe.Result();
            rec.eye = cam.transform.position;
            rec.target = v.look;
            rec.frames = r.frames;
            rec.frameP50 = r.frameP50;
            rec.frameP95 = r.frameP95;
            rec.mainP50 = (float)r.MainP50;
            rec.mainP95 = (float)r.MainP95;
            rec.playerLoopMs = (float)r.PlayerLoopMs;
            rec.renderP95 = (float)r.RenderP95;
            rec.gpuP50 = (float)r.GpuP50;
            rec.gpuP95 = (float)r.GpuP95;
            rec.gcBytes = (float)r.GcBytes;
            rec.drawCalls = Round(r.DrawCalls);
            rec.brgDrawCalls = Round(r.BrgDrawCalls);
            rec.srpDraws = Round(r.Get("SRP Batcher Draw Calls Count"));
            rec.standardDraws = Round(r.Get("Standard Draw Calls Count"));
            rec.staticBatchedDraws = Round(r.Get("Static Batched Draw Calls Count"));
            rec.setPass = Round(r.SetPass);
            rec.instances = Round(r.Instances);
            rec.shadowCasters = Round(r.ShadowCasters);
            rec.triangles = (long)Math.Round(Math.Max(0, r.Triangles));
            rec.frustumRenderers = PerfProbe.FrustumRenderers(cam, renderers);
            rec.renderers = renderers.Count(x => x);
            rec.particles = FxBudget.Peak;
            rec.enemies = spawned.Count(x => x);
            // 子协程里抛异常会让整个套件挂到 600 s 超时：估算出错只记一条
            try
            {
                var est = PerfViews.Measure(v, renderers, GraphicsQuality.AppliedProfile ?? QualityProfile.Current, CullLayers.Disabled ? 0 : CullLayers.FogEnd,
                    GraphicsQuality.ActiveAsset ? GraphicsQuality.ActiveAsset.shadowDistance : 90);
                rec.estRenderers = est.renderers;
                rec.estDraws = est.draws;
                rec.estCasterDraws = est.casterDraws;
                rec.estTriangles = est.triangles;
            }
            catch (Exception e)
            {
                Fail($"{rec.level} {rec.view} 估算出错：{e.Message}");
            }
            if (shot != null)
            {
                Shot(cam, shot);
                cam.targetTexture = rt;
            }
            if (v.combat)
            {
                if (weapons) weapons.testFire = false;
                vitals.stats.Remove("perf_crit");
                EnemyRegistry.PurgeAll();
                yield return new WaitForSecondsRealtime(2f);
            }
        }

        static int Round(double v) => v > 0 ? (int)Math.Round(v) : 0;

        void Tick(PerfView v, List<EnemyAI> enemies, ref int k)
        {
            if (!v.combat) return;
            if (weapons && weapons.Active != null) weapons.Active.reserve = weapons.Active.def.reserve;
            // 每 8 帧换一个目标（确定性）；测量相机不动
            var alive = enemies.Where(x => x && x.Health && !x.Health.Dead).ToList();
            if (alive.Count == 0) return;
            var target = alive[(k++ / 8) % alive.Count];
            Aim(motor, eye, BodyCenter(target.Health));
        }

        /// <summary>玩家站到 p（战斗机位：枪从这里打出去）</summary>
        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            cc.enabled = true;
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        /// <summary>本关场地里出现的敌人（按出现次数，最多 3 种）；没有场地（首领关）用 jerboa_blade</summary>
        static string[] EnemyIds(Scene scene)
        {
            var count = new Dictionary<string, int>();
            foreach (var s in FindObjectsByType<EncounterSite>(FindObjectsInactive.Include))
            {
                if (s.gameObject.scene != scene || s.spec?.waves == null) continue;
                foreach (var w in s.spec.waves)
                    if (w?.entries != null)
                        foreach (var e in w.entries)
                            if (e != null && !string.IsNullOrEmpty(e.enemy) && EnemyRoster.Get(e.enemy) != null)
                                count[e.enemy] = (count.TryGetValue(e.enemy, out var n) ? n : 0) + Mathf.Max(1, e.count);
            }
            var ids = count.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(3).Select(kv => kv.Key).ToArray();
            return ids.Length > 0 ? ids : new[] { "jerboa_blade" };
        }

        // ───────────── GPU 常驻绘制 ─────────────

        protected static string GrdState()
        {
            var a = GraphicsQuality.ActiveAsset;
            return a ? $"{a.gpuResidentDrawerMode}{(a.gpuResidentDrawerEnableOcclusionCullingInCameras ? " + GPU 遮挡" : "")}" : "—";
        }
    }

    public sealed class PerfCh1Suite : PerfSuite
    {
        public override string Id => "perf-ch1";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "1-2", "1-3", "1-4" };
    }

    public sealed class PerfCh2Suite : PerfSuite
    {
        public override string Id => "perf-ch2";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";
        protected override string[] Stages => new[] { "2-1", "2-2", "2-3", "2-4" };
    }

    public sealed class PerfCh3Suite : PerfSuite
    {
        public override string Id => "perf-ch3";
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";
        protected override string[] Stages => new[] { "3-1", "3-2", "3-3", "3-4" };
    }

    /// <summary>
    /// GPU 常驻绘制 / GPU 遮挡剔除的对照（I4；bridge.sh playtest perf-grd [关卡 id]，perf-grd-ch1 / ch2 / ch3）：只测高档、三类机位，同一次进关里依次
    ///   工程设置（关）→ 开 GPU 常驻绘制 → 再开 GPU 遮挡剔除，结束时还原。编辑器里 GRD 要求 Graphics 设置的 BatchRendererGroup Variants = Keep All，
    ///   工程默认不是（GRD 关着就不保留那批变体），这时「开」的两档实际没生效：BRG 绘制数是 0，套件会提示先临时改成 Keep All。
    /// </summary>
    public class PerfGrdSuite : PerfSuite
    {
        public override string Id => "perf-grd";
        public override string Scene => "Assets/Scenes/L1_3_SunkenCity.unity";
        protected override ArtQualityLevel[] Tiers => new[] { ArtQualityLevel.High };
        protected override bool Chain => false;
        protected override string FilePrefix => "perfgrd";

        bool saved;
        GPUResidentDrawerMode mode0;
        bool occ0;

        protected override (string name, Action apply)[] Configs => new (string, Action)[]
        {
            (Current, () => Set(GPUResidentDrawerMode.Disabled, false)),
            ("GRD", () => Set(GPUResidentDrawerMode.InstancedDrawing, false)),
            ("GRD + GPU 遮挡", () => Set(GPUResidentDrawerMode.InstancedDrawing, true)),
        };

        void Set(GPUResidentDrawerMode mode, bool occlusion)
        {
            var a = GraphicsQuality.ActiveAsset;
            if (!a) return;
            if (!saved)
            {
                saved = true;
                mode0 = a.gpuResidentDrawerMode;
                occ0 = a.gpuResidentDrawerEnableOcclusionCullingInCameras;
            }
            a.gpuResidentDrawerMode = mode;
            a.gpuResidentDrawerEnableOcclusionCullingInCameras = occlusion;
            Line($"  渲染配置：{GrdState()}");
        }

        protected override void RestoreConfig()
        {
            if (!saved) return;
            var a = GraphicsQuality.ActiveAsset;
            if (!a) return;
            a.gpuResidentDrawerMode = mode0;
            a.gpuResidentDrawerEnableOcclusionCullingInCameras = occ0;
        }
    }

    public sealed class PerfGrdCh1Suite : PerfGrdSuite
    {
        public override string Id => "perf-grd-ch1";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "1-2", "1-3", "1-4" };
    }

    public sealed class PerfGrdCh2Suite : PerfGrdSuite
    {
        public override string Id => "perf-grd-ch2";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";
        protected override string[] Stages => new[] { "2-1", "2-2", "2-3", "2-4" };
    }

    public sealed class PerfGrdCh3Suite : PerfGrdSuite
    {
        public override string Id => "perf-grd-ch3";
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";
        protected override string[] Stages => new[] { "3-1", "3-2", "3-3", "3-4" };
    }

    /// <summary>
    /// 按图层剔除距离的对照（I4；bridge.sh playtest perf-cull-ch1 / ch2 / ch3）：高 / 低两档、三类机位，同一次进关里先关掉 <see cref="CullLayers"/> 的距离、
    /// 再打开，各测一遍并各拍一张（改前 / 改后截图，scripts/unity/perf_compare_sheets.py 拼图）。
    /// </summary>
    public abstract class PerfCullSuite : PerfSuite
    {
        protected override string FilePrefix => "perfcull";
        protected override bool Screenshots => true;
        protected override bool Chain => false;

        protected override (string name, Action apply)[] Configs => new (string, Action)[]
        {
            ("剔除关", () => CullLayers.Disabled = true),
            (Current, () => CullLayers.Disabled = false),
        };

        protected override void RestoreConfig() => CullLayers.Disabled = false;
    }

    public sealed class PerfCullCh1Suite : PerfCullSuite
    {
        public override string Id => "perf-cull-ch1";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        protected override string[] Stages => new[] { "1-1", "1-2", "1-3", "1-4" };
    }

    public sealed class PerfCullCh2Suite : PerfCullSuite
    {
        public override string Id => "perf-cull-ch2";
        public override string Scene => "Assets/Scenes/L2_1_Icefall.unity";
        protected override string[] Stages => new[] { "2-1", "2-2", "2-3", "2-4" };
    }

    public sealed class PerfCullCh3Suite : PerfCullSuite
    {
        public override string Id => "perf-cull-ch3";
        public override string Scene => "Assets/Scenes/L3_1_Causeway.unity";
        protected override string[] Stages => new[] { "3-1", "3-2", "3-3", "3-4" };
    }
}
