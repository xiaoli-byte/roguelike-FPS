using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一场高原雷暴的参数（<see cref="PlateauStorm.Begin"/> / <see cref="WeatherDirector.BeginPlateauStorm"/>）。
    /// 夔：走到残鼓 22 m 内开始（<see cref="enterWhen"/>），倒下时 End、退完回调 <see cref="onExit"/>（阳光照下来）；大鹗：登场时开始。
    /// </summary>
    public sealed class PlateauStormSpec
    {
        /// <summary>落雷围绕的中心；<see cref="aroundPlayer"/> = true 时忽略，围着玩家落</summary>
        public Vector3 center;
        public bool aroundPlayer = true;
        /// <summary>落点离中心（玩家）的距离范围（米）</summary>
        public float strikeMin = 20f, strikeMax = 110f;
        /// <summary>两道雷之间的间隔（秒，均匀随机）</summary>
        public float intervalMin = 2.5f, intervalMax = 6.5f;
        /// <summary>每道雷的预警秒数、半径、对玩家伤害（0 = 只是天气，不伤人；网页版的雷暴是演示）</summary>
        public float warn = 1.2f, strikeRadius = 3.2f, damage;
        /// <summary>落点内的雷魅带电多少秒（0 = 不充电）</summary>
        public float chargeFoes = 8f;
        /// <summary>强度到这个值才开始落雷</summary>
        [Range(0, 1)] public float strikesFrom = 0.6f;
        /// <summary>渐入 / 渐出秒数（夔登场「天色 3 秒内压暗」、死亡「雷暴 4 秒内退去」）</summary>
        public float fadeIn = 3f, fadeOut = 4f;
        /// <summary>满强度时主光压暗多少（0.8 = 只剩两成）、雨量 0..1</summary>
        [Range(0, 1)] public float darken = 0.8f;
        [Range(0, 1)] public float rain = 1f;
        /// <summary>入场条件：null = 立刻开始渐入；否则每帧问，返回 true 之后才开始（只问到第一次为真）</summary>
        public Func<bool> enterWhen;
        /// <summary>入场回调：开始渐入的那一刻</summary>
        public Action onEnter;
        /// <summary>退场回调：<see cref="PlateauStorm.Ticket.End"/> 之后渐出完毕的那一刻</summary>
        public Action onExit;
        /// <summary>这场雷暴自己的雷劈下来时</summary>
        public Action<StrikeInfo> onStrike;
        /// <summary>出手者（落雷伤害来源）</summary>
        public UnityEngine.Object source;
    }

    /// <summary>
    /// 高原雷暴（第四章，docs/unity-ch4-port.md 第 2 节契约「天气与风」；网页版 src/world/plateau/weather.ts）：压暗、下雨、按间隔落雷。
    ///   · 多个来源可以同时要雷暴（夔、大鹗、4-2 的地图雷暴）：每个 <see cref="Begin"/> 返回一张票（<see cref="Ticket"/>），强度取各票的最大值；
    ///     票有入场条件（<see cref="PlateauStormSpec.enterWhen"/>）和退场回调（<see cref="PlateauStormSpec.onExit"/>）。
    ///   · 落雷走 <see cref="LightningStrike"/>（导体引雷、紫红预警），强度 ≥ <see cref="PlateauStormSpec.strikesFrom"/> 时按间隔落；每道雷劈下时天空闪一下。
    ///   · 光照与雾：按 batch2「天气覆盖」做法——<see cref="WeatherDirector"/> 每帧（Update）按区域天气写主光和雾，这里在 LateUpdate（执行顺序 510，
    ///     天气和旱魃太阳驱动之后）以「这一帧的底 × 倍率」最后再写一次：这一帧有人写过就以它为底，没人写过沿用上次的底，不会一帧帧累乘。
    ///   · 雨：跟着相机的斜雨丝粒子（强度 × 雨量）。
    /// 场景里一个（第一次 Begin 时挂到 Fx 根物体上），换关时全部票作废（不回调）。
    /// </summary>
    [DefaultExecutionOrder(510)]
    public sealed class PlateauStorm : MonoBehaviour
    {
        /// <summary>雷暴的雾色（青灰压紫）与雾终点（满强度）</summary>
        public static readonly Color StormFog = new(0.36f, 0.37f, 0.45f);
        public const float StormFogEnd = 160f, StormFogStart = 8f;

        public enum Stage { Waiting, FadingIn, Full, FadingOut, Done }

        /// <summary>一场雷暴的票：强度、阶段；End / Dispose 开始渐出</summary>
        public sealed class Ticket : IDisposable
        {
            public readonly PlateauStormSpec spec;
            public Stage Stage { get; internal set; }
            /// <summary>这张票的强度 0..1</summary>
            public float Level { get; internal set; }
            internal float nextStrike;

            internal Ticket(PlateauStormSpec spec) => this.spec = spec;

            /// <summary>开始退场（渐出完毕调 onExit）；还在等入场条件的直接作废（不回调）</summary>
            public void End()
            {
                if (Stage == Stage.Waiting)
                {
                    Stage = Stage.Done;
                    return;
                }
                if (Stage is Stage.FadingIn or Stage.Full) Stage = Stage.FadingOut;
            }

            public void Dispose() => End();
            public bool Done => Stage == Stage.Done;
        }

        static PlateauStorm instance;
        readonly List<Ticket> tickets = new();
        float flash;
        // 天气覆盖：上一帧写出去的值与那时的底
        float lastSun = float.NaN, sunBase = 1, lastFogEnd = float.NaN, fogEndBase, lastFogStart = float.NaN, fogStartBase;
        Color lastFog, fogBase;
        bool fogTracked;
        Light sun;
        ParticleSystem rainPs;

        /// <summary>场上的雷暴（没有为 null）</summary>
        public static PlateauStorm Instance => instance;
        /// <summary>此刻的雷暴强度 0..1（各票取最大）</summary>
        public static float Level => instance ? instance.level : 0;
        /// <summary>此刻天空的闪光 0..1（落雷时亮一下）</summary>
        public static float Flash => instance ? instance.flash : 0;
        /// <summary>还有没走完的票</summary>
        public static bool Active => instance && instance.tickets.Count > 0;

        float level;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => instance = null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook() => GameEvents.StageLoaded += OnStageLoaded;

        static void OnStageLoaded(StageSpec s)
        {
            if (instance) instance.ResetAll();
        }

        /// <summary>要一场雷暴：返回票（<see cref="Ticket.End"/> 退场）。spec 为 null 时用缺省参数</summary>
        public static Ticket Begin(PlateauStormSpec spec = null)
        {
            var self = Ensure();
            var t = new Ticket(spec ?? new PlateauStormSpec());
            t.Stage = Stage.Waiting;
            t.nextStrike = UnityEngine.Random.Range(0.5f, 1.5f);
            if (self) self.tickets.Add(t);
            return t;
        }

        /// <summary>立刻结束全部雷暴（不渐出、不回调；测试 / 换关）</summary>
        public static void StopAll()
        {
            if (instance) instance.ResetAll();
        }

        static PlateauStorm Ensure()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            instance = rt.gameObject.GetComponent<PlateauStorm>();
            if (!instance) instance = rt.gameObject.AddComponent<PlateauStorm>();
            return instance;
        }

        void OnEnable() => LightningStrike.Landed += OnLanded;

        void OnDisable()
        {
            LightningStrike.Landed -= OnLanded;
            RestoreWorld();
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        void ResetAll()
        {
            tickets.Clear();
            level = 0;
            flash = 0;
            RestoreWorld();
            if (rainPs) rainPs.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }

        void OnLanded(StrikeInfo s)
        {
            if (level > 0.05f) flash = 1f;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            flash = Mathf.Max(0, flash - dt * 4f);
            level = 0;
            for (int i = tickets.Count - 1; i >= 0; i--)
            {
                var t = tickets[i];
                Step(t, dt);
                if (t.Done)
                {
                    tickets.RemoveAt(i);
                    continue;
                }
                level = Mathf.Max(level, t.Level);
            }
        }

        void Step(Ticket t, float dt)
        {
            var s = t.spec;
            switch (t.Stage)
            {
                case Stage.Waiting:
                    bool go;
                    try
                    {
                        go = s.enterWhen == null || s.enterWhen();
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                        go = true;
                    }
                    if (!go) return;
                    t.Stage = Stage.FadingIn;
                    Call(s.onEnter);
                    break;
                case Stage.FadingIn:
                    t.Level = Mathf.Min(1, t.Level + dt / Mathf.Max(0.01f, s.fadeIn));
                    if (t.Level >= 1) t.Stage = Stage.Full;
                    break;
                case Stage.FadingOut:
                    t.Level = Mathf.Max(0, t.Level - dt / Mathf.Max(0.01f, s.fadeOut));
                    if (t.Level <= 0)
                    {
                        t.Stage = Stage.Done;
                        Call(s.onExit);
                        return;
                    }
                    break;
            }
            if (t.Stage is Stage.FadingIn or Stage.Full && t.Level >= s.strikesFrom)
            {
                t.nextStrike -= dt;
                if (t.nextStrike <= 0)
                {
                    t.nextStrike = UnityEngine.Random.Range(Mathf.Max(0.2f, s.intervalMin), Mathf.Max(s.intervalMin, s.intervalMax));
                    StrikeFor(t);
                }
            }
        }

        static void StrikeFor(Ticket t)
        {
            var s = t.spec;
            var vitals = PlayerVitals.Instance;
            var c = s.aroundPlayer && vitals ? vitals.transform.position : s.center;
            float a = UnityEngine.Random.value * Mathf.PI * 2, d = UnityEngine.Random.Range(Mathf.Max(0, s.strikeMin), Mathf.Max(s.strikeMin, s.strikeMax));
            var p = c + new Vector3(Mathf.Cos(a) * d, 0, Mathf.Sin(a) * d);
            LightningStrike.Strike(p, new StrikeOptions
            {
                warn = s.warn, radius = s.strikeRadius, damage = s.damage, source = s.source, chargeFoes = s.chargeFoes, onLanded = s.onStrike,
            });
        }

        static void Call(Action a)
        {
            if (a == null) return;
            try
            {
                a();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 天气覆盖：LateUpdate 最后写一次 ─────────────

        void LateUpdate()
        {
            float k = level;
            if (k <= 0.001f && flash <= 0.001f)
            {
                RestoreWorld();
                UpdateRain(0);
                return;
            }
            if (!sun) sun = RenderSettings.sun;
            if (sun)
            {
                float cur = sun.intensity;
                if (float.IsNaN(lastSun) || Mathf.Abs(cur - lastSun) > 1e-4f) sunBase = cur;
                float darken = 0;
                foreach (var t in tickets) darken = Mathf.Max(darken, t.spec.darken * t.Level);
                sun.intensity = lastSun = sunBase * (1 - darken) + flash * 1.6f;
            }
            var fog = RenderSettings.fogColor;
            if (!fogTracked || fog != lastFog) fogBase = fog;
            float fe = RenderSettings.fogEndDistance, fs = RenderSettings.fogStartDistance;
            if (!fogTracked || !Mathf.Approximately(fe, lastFogEnd)) fogEndBase = fe;
            if (!fogTracked || !Mathf.Approximately(fs, lastFogStart)) fogStartBase = fs;
            var fc = Color.Lerp(fogBase, StormFog, k * 0.85f) + new Color(0.25f, 0.2f, 0.3f, 0) * flash;
            fc.a = fogBase.a;
            RenderSettings.fogColor = lastFog = fc;
            RenderSettings.fogEndDistance = lastFogEnd = Mathf.Lerp(fogEndBase, Mathf.Min(fogEndBase, StormFogEnd), k);
            RenderSettings.fogStartDistance = lastFogStart = Mathf.Min(lastFogEnd - 1, Mathf.Lerp(fogStartBase, Mathf.Min(fogStartBase, StormFogStart), k));
            fogTracked = true;
            float rain = 0;
            foreach (var t in tickets) rain = Mathf.Max(rain, t.spec.rain * t.Level);
            UpdateRain(rain);
        }

        void RestoreWorld()
        {
            if (sun && !float.IsNaN(lastSun) && Mathf.Abs(sun.intensity - lastSun) < 1e-4f) sun.intensity = sunBase;
            lastSun = float.NaN;
            if (fogTracked)
            {
                if (RenderSettings.fogColor == lastFog) RenderSettings.fogColor = fogBase;
                if (Mathf.Approximately(RenderSettings.fogEndDistance, lastFogEnd)) RenderSettings.fogEndDistance = fogEndBase;
                if (Mathf.Approximately(RenderSettings.fogStartDistance, lastFogStart)) RenderSettings.fogStartDistance = fogStartBase;
            }
            fogTracked = false;
        }

        // ───────────── 雨 ─────────────

        /// <summary>强度 1 时每秒的雨丝数（再乘画质密度）</summary>
        public const float RainRate = 1400f;

        void UpdateRain(float k)
        {
            if (k <= 0.01f)
            {
                if (rainPs && rainPs.isEmitting) rainPs.Stop(true, ParticleSystemStopBehavior.StopEmitting);
                return;
            }
            if (!rainPs) rainPs = CreateRain();
            var cam = Camera.main;
            if (cam) rainPs.transform.position = cam.transform.position + Vector3.up * 9f;
            var em = rainPs.emission;
            em.rateOverTime = RainRate * k * Fx.Density;
            if (!rainPs.isPlaying) rainPs.Play();
        }

        ParticleSystem CreateRain()
        {
            var go = new GameObject("Plateau Storm · Rain");
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            var cfg = new FxParticle
            {
                blend = FxBlend.Alpha, texture = FxTexture.Streak, render = FxRender.Stretched, fade = FxFade.Smoke,
                stretchVelocity = 0.035f, stretchLength = 1f, maxParticles = Mathf.Max(64, Mathf.RoundToInt(3000 * FxBudget.StyleCapScale)),
            };
            FxSetup.Configure(ps, cfg, FxMaterials.ParticleAlpha);
            var main = ps.main;
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.6f, 0.9f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.03f, 0.05f);
            main.startSpeed = 0;
            main.startColor = new Color(0.78f, 0.81f, 0.9f, 0.45f);
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var shape = ps.shape;
            shape.enabled = true;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(40f, 2f, 40f);
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            vel.x = new ParticleSystem.MinMaxCurve(2.5f, 3.5f);
            vel.y = new ParticleSystem.MinMaxCurve(-27f, -24f);
            vel.z = new ParticleSystem.MinMaxCurve(-0.5f, 0.5f);
            ps.Play();
            return ps;
        }
    }
}
