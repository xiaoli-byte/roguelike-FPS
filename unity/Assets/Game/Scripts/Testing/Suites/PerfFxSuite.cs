using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 特效压力项的帧时间拆解（I4；bridge.sh playtest perf-fx，场景 TestArena）：重放 <c>playtest fx</c> 的压力项
    /// （8 只敌人全身着火感电 + 暴击连射 4 s + 3 次爆炸，期间不截图），每一轮用 <see cref="PerfProbe"/> 记主线程 / 渲染线程 / GPU、
    /// PlayerLoop 与 EditorLoop、各分段和渲染计数，按分段开关做对照：
    ///   空场（不打）高 / 低；压力 高 / 低；压力 高 + 关后处理；压力 高 + 关阴影；压力 高 + 关水面；
    /// 找出低档和高档一样慢的原因（画质档没生效？CPU 瓶颈？编辑器开销？）。结果写结果文件，另存一份 Assets/Art/_Review/perf_fx.txt。
    /// 只报数字，不判不合格（除了运行时报错）。
    /// </summary>
    public sealed class PerfFxSuite : PlaytestSuite
    {
        public override string Id => "perf-fx";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Target = "jerboa_blade";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;
        readonly List<string> report = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.eye.transform;
            vitals.stats.Add("perf_fx", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            var quality = ArtQuality.Level;

            Out($"环境：{PerfProbe.Environment()}");
            var names = PerfProbe.AvailableNames();
            File.WriteAllLines(Path.Combine(ShotDir, "perf_counters.txt"), names);
            Out($"可用计数器 {names.Count} 个（列表见 _Review/perf_counters.txt）");

            // 空场：站在出生点看场地中心，不打
            foreach (var level in new[] { ArtQualityLevel.High, ArtQualityLevel.Low })
            {
                ArtQuality.Set(level, false);
                yield return Idle($"空场 · {ArtQuality.Label(level)}");
            }
            ArtQuality.Set(ArtQualityLevel.High, false);
            SetHud(false);
            yield return Idle("空场 · 高 + 藏 HUD");
            SetHud(true);
            SetPost(false);
            yield return Idle("空场 · 高 + 关后处理");
            SetPost(true);
            // 压力：高 / 低 / 高 + 各项关掉
            yield return Stress("压力 · 高", ArtQualityLevel.High, null, null);
            yield return Stress("压力 · 低", ArtQualityLevel.Low, null, null);
            shotAt90 = true;
            yield return Stress("压力 · 高 + 第 90 帧截图（fx 套件原来的测法）", ArtQualityLevel.High, null, null);
            yield return Stress("压力 · 低 + 第 90 帧截图（fx 套件原来的测法）", ArtQualityLevel.Low, null, null);
            shotAt90 = false;
            yield return Stress("压力 · 高 + 关伤害数字", ArtQualityLevel.High, () => SetNumbers(false), () => SetNumbers(true));
            yield return Stress("压力 · 高 + 藏 HUD", ArtQualityLevel.High, () => SetHud(false), () => SetHud(true));
            yield return Stress("压力 · 高 + 藏敌人血条", ArtQualityLevel.High, () => SetWidget<EnemyBars>(false), () => SetWidget<EnemyBars>(true));
            yield return Stress("压力 · 高 + 关后处理", ArtQualityLevel.High, () => SetPost(false), () => SetPost(true));
            yield return Stress("压力 · 高 + 关阴影", ArtQualityLevel.High, () => SetShadows(false), () => SetShadows(true));
            yield return Stress("压力 · 高 + 关水面", ArtQualityLevel.High, () => SetWater(false), () => SetWater(true));
            yield return Stress("压力 · 高（复测）", ArtQualityLevel.High, null, null);

            ArtQuality.Set(quality, false);
            vitals.stats.Remove("perf_fx");
            weapons.testFire = false;
            arena.Clear();
            File.WriteAllLines(Path.Combine(ShotDir, "perf_fx.txt"), report);
        }

        void Out(string s)
        {
            report.Add(s);
            Line(s);
        }

        IEnumerator Idle(string label)
        {
            var basePos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            Teleport(motor, basePos);
            yield return null;
            Aim(motor, eye, arena.Center + Vector3.up * 1.5f);
            yield return new WaitForSecondsRealtime(1f);
            using var probe = new PerfProbe();
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < 3f)
            {
                yield return null;
                probe.Sample();
            }
            Report(label, probe.Result());
        }

        IEnumerator Stress(string label, ArtQualityLevel level, System.Action before, System.Action after)
        {
            ArtQuality.Set(level, false);
            before?.Invoke();
            var list = new List<EnemyAI>();
            for (int i = 0; i < 8; i++)
            {
                float ang = i * Mathf.PI * 2 / 8;
                var ai = arena.Spawn(Target, false, new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 3.2f);
                if (!ai) continue;
                ai.Health.maxHealth = 400000;
                ai.Health.ResetVitals();
                list.Add(ai);
            }
            yield return new WaitForSeconds(1f);
            foreach (var ai in list)
            {
                if (!ai) continue;
                ai.enabled = false;
                for (int k = 0; k < 3; k++) EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
            }
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            Teleport(motor, arena.Center + away.normalized * 10);
            yield return null;
            vitals.stats.Add("perf_fx_crit", Stat.CritChance, 1f);
            FxBudget.ResetPeak();
            weapons.Active.reserve = weapons.Active.def.reserve;
            weapons.testFire = true;
            using var probe = new PerfProbe();
            float t0 = Time.time;
            int booms = 0, frames = 0;
            while (Time.time - t0 < 4f)
            {
                var target = list.Where(x => x).OrderBy(_ => Random.value).FirstOrDefault();
                if (target) Aim(motor, eye, BodyCenter(target.Health));
                if (booms < 3 && Time.time - t0 > 1f + booms)
                {
                    booms++;
                    var at = arena.Center + new Vector3(Random.Range(-2f, 2f), 0.5f, Random.Range(-2f, 2f));
                    Combat.Explode(new ExplosionOptions(at, 3f, DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up)) { noEnemies = true });
                }
                if (shotAt90 && frames == 90) Shot(weapons.eye, "perf_fx_stress");
                frames++;
                weapons.Active.reserve = weapons.Active.def.reserve;
                yield return null;
                probe.Sample();
            }
            weapons.testFire = false;
            vitals.stats.Remove("perf_fx_crit");
            var r = probe.Result();
            int vis = PerfProbe.FrustumRenderers(Camera.main, new List<Renderer>(FindObjectsByType<Renderer>()));
            Report($"{label}（粒子峰值 {FxBudget.Peak} / 上限 {FxBudget.ParticleCap}，视锥内渲染器 {vis}）", r);
            after?.Invoke();
            arena.Clear();
            yield return new WaitForSeconds(1.5f);
        }

        void Report(string label, PerfProbe.Stats r)
        {
            Out($"{label}：{r.Summary()}");
            Out($"    分段（平均 / P95 ms）：{r.Breakdown()}");
            var asset = GraphicsQuality.ActiveAsset;
            if (asset)
                Out($"    在用：{asset.name} 渲染比例 {asset.renderScale:0.##}、MSAA {asset.msaaSampleCount}、阴影 {asset.shadowDistance:0} m / {asset.shadowCascadeCount} 级，" +
                    $"lodBias {QualitySettings.lodBias:0.#}、画质档 {GraphicsQuality.AppliedProfile?.label ?? "未写"}，相机 {Camera.main?.pixelWidth}×{Camera.main?.pixelHeight}");
        }

        // ───────────── 分段开关 ─────────────

        static void SetPost(bool on)
        {
            foreach (var c in Camera.allCameras)
            {
                var d = c.GetUniversalAdditionalCameraData();
                if (d) d.renderPostProcessing = on;
            }
        }

        bool shotAt90;
        float numbersWas = -1;

        void SetNumbers(bool on)
        {
            if (!on)
            {
                numbersWas = GameSettings.DamageNumbers.Value;
                GameSettings.DamageNumbers.Set(false);
            }
            else if (numbersWas >= 0) GameSettings.DamageNumbers.Set(numbersWas);
        }

        static void SetWidget<T>(bool on) where T : HudWidget
        {
            var w = Hud.Instance ? Hud.Instance.Widget<T>() : null;
            if (w?.Root != null) w.Root.style.display = on ? UnityEngine.UIElements.DisplayStyle.Flex : UnityEngine.UIElements.DisplayStyle.None;
        }

        static void SetHud(bool on)
        {
            foreach (var d in FindObjectsByType<UnityEngine.UIElements.UIDocument>())
                if (d && d.rootVisualElement != null)
                    d.rootVisualElement.style.display = on ? UnityEngine.UIElements.DisplayStyle.Flex : UnityEngine.UIElements.DisplayStyle.None;
        }

        float savedShadow = -1;

        void SetShadows(bool on)
        {
            var a = GraphicsQuality.ActiveAsset;
            if (!a) return;
            if (!on)
            {
                savedShadow = a.shadowDistance;
                a.shadowDistance = 0;
            }
            else if (savedShadow >= 0) a.shadowDistance = savedShadow;
        }

        readonly List<Renderer> waterOff = new();

        void SetWater(bool on)
        {
            if (!on)
            {
                waterOff.Clear();
                foreach (var r in FindObjectsByType<Renderer>())
                {
                    if (!r.enabled) continue;
                    var m = r.sharedMaterial;
                    if (m && m.shader && (m.shader.name.Contains("Water") || m.shader.name.Contains("EnvFlow")))
                    {
                        r.enabled = false;
                        waterOff.Add(r);
                    }
                }
                Out($"    关水面：{waterOff.Count} 个渲染器（{string.Join("、", waterOff.Select(r => r.name).Distinct().Take(6))}）");
            }
            else
            {
                foreach (var r in waterOff)
                    if (r) r.enabled = true;
                waterOff.Clear();
            }
        }
    }
}
