using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Random = System.Random;

namespace Spiritfire.Game
{
    /// <summary>区域风暴的阶段：没走近（不计时）→ 平静 → 预警（天边沙墙升起、风声）→ 风暴 → 消退 → 平静…</summary>
    public enum StormPhase
    {
        Idle,
        Calm,
        Warning,
        Storm,
        Abating,
    }

    /// <summary>
    /// 天气导演（docs/unity-parity.md L3；unity-maps-v1 第 0 节「动态环境服务于战斗」、1-1 ④ 沙暴）。场景里一个（关卡构建器放，或软边界开场时 <see cref="Ensure"/>），每帧：
    ///   1. 基础值 = 关卡构建时的雾与主光（构建器写进 base*；没写就开场读 RenderSettings）+ 盛行风 <see cref="windDir"/> × <see cref="baseWind"/>；
    ///   2. 逐层插值：各个区域风暴（<see cref="Region"/>，强度 = 风暴周期 × 玩家离区域的远近）→ 软边界白化（<see cref="BoundaryZone.PlayerWhiteout"/>）；
    ///   3. 写出去：RenderSettings 的雾、主光亮度 / 颜色、每种天气一个运行时 Volume（ColorAdjustments，权重 = 强度）、全局 _WindDir（xy = 风向 XZ，z = 风力 0..1）、
    ///      WindZone（Shuriken 外力、以后的植被）、跟着相机的粒子（风沙拉丝 / 雪 / 灰）、远幕（以相机为心、半径 = 雾终点的球，盖住天空与远景剪影——
    ///      它们不吃雾，沙暴里不盖就会透出晴天）、风声（程序生成的棕噪声循环）。
    /// 沙暴期间远程锁定距离上限 25 m：敌人 AI 读 <see cref="LockOnRange"/> / <see cref="CanLockOn"/>（静态，场景里没有导演时不限）。
    /// 关卡卸载时（OnDisable）把雾、主光、风还原成基础值。
    /// </summary>
    [DefaultExecutionOrder(60)]
    [DisallowMultipleComponent]
    public sealed class WeatherDirector : MonoBehaviour
    {
        /// <summary>
        /// 区域风暴（1-1 ④ 的周期沙暴）：玩家第一次走到 <see cref="armRadius"/> 以内开始计时，<see cref="firstDelay"/> 秒后第一次预警；
        /// 之后 平静 calm → 预警 warn → 风暴 storm → 消退 abate 循环。强度在 <see cref="radius"/> 内满、外面 <see cref="fade"/> 米淡出。
        /// 预警时风暴来向（<see cref="from"/>）的天边升起一道土黄色沙墙，风暴开始时沙墙扫过场地。
        /// </summary>
        [Serializable]
        public sealed class Region
        {
            public string name = "沙暴";
            public Vector3 center;
            public float radius = 30, fade = 22;
            public string profile = WeatherProfiles.Sandstorm;
            /// <summary>风暴从哪边来（XZ 单位向量；1-1 ④ 从东侧涌入 = (1, 0)）</summary>
            public Vector2 from = Vector2.right;
            public float calm = 24, warn = 7, storm = 16, abate = 6;
            public float firstDelay = 8, armRadius = 110;
            public bool loop = true;

            [NonSerialized] public StormPhase phase;
            [NonSerialized] public float phaseT;

            /// <summary>风暴强度 0..1（预警期只有一点薄尘，风暴前 2.5 s 涨满，消退线性回落）</summary>
            public float Intensity => phase switch
            {
                StormPhase.Warning => 0.12f * Mathf.Clamp01(phaseT / Mathf.Max(0.01f, warn)),
                StormPhase.Storm => Smooth01(phaseT / 2.5f),
                StormPhase.Abating => 1 - Mathf.Clamp01(phaseT / Mathf.Max(0.01f, abate)),
                _ => 0,
            };

            /// <summary>预警程度 0..1（沙墙高度、风声）：预警期涨满，风暴期保持，消退回落</summary>
            public float Warning01 => phase switch
            {
                StormPhase.Warning => Mathf.Clamp01(phaseT / Mathf.Max(0.01f, warn)),
                StormPhase.Storm => 1,
                StormPhase.Abating => 1 - Mathf.Clamp01(phaseT / Mathf.Max(0.01f, abate)),
                _ => 0,
            };

            /// <summary>某点受这个区域影响的程度 0..1（水平距离）</summary>
            public float Weight(Vector3 p)
            {
                float d = new Vector2(p.x - center.x, p.z - center.z).magnitude;
                return 1 - Smooth01((d - radius) / Mathf.Max(0.01f, fade));
            }

            /// <summary>某点处的风暴强度 = 周期 × 远近</summary>
            public float At(Vector3 p) => Intensity * Weight(p);

            public void Tick(float dt, Vector3 player)
            {
                if (phase == StormPhase.Idle)
                {
                    if (new Vector2(player.x - center.x, player.z - center.z).magnitude > armRadius) return;
                    phase = StormPhase.Calm;
                    phaseT = Mathf.Max(0, calm - firstDelay);
                }
                phaseT += dt;
                for (int guard = 0; guard < 4; guard++)
                {
                    float len = Length(phase);
                    if (phaseT < len) break;
                    phaseT -= len;
                    phase = phase switch
                    {
                        StormPhase.Calm => StormPhase.Warning,
                        StormPhase.Warning => StormPhase.Storm,
                        StormPhase.Storm => StormPhase.Abating,
                        _ => loop ? StormPhase.Calm : StormPhase.Idle,
                    };
                    if (phase == StormPhase.Idle)
                    {
                        // 不循环：停在平静里（不再计时）
                        phase = StormPhase.Calm;
                        phaseT = float.NegativeInfinity;
                        break;
                    }
                }
            }

            float Length(StormPhase p) => Mathf.Max(0.01f, p switch
            {
                StormPhase.Calm => calm,
                StormPhase.Warning => warn,
                StormPhase.Storm => storm,
                StormPhase.Abating => abate,
                _ => float.PositiveInfinity,
            });

            /// <summary>跳到某个阶段（调试命令、冒烟测试）</summary>
            public void Force(StormPhase p, float t = 0)
            {
                phase = p;
                phaseT = Mathf.Max(0, t);
            }
        }

        [Header("基础（构建器从主题写入；fog 终点 ≤ 0 时开场读 RenderSettings）")]
        public Color baseFogColor = new(0.88f, 0.76f, 0.6f);
        public float baseFogStart, baseFogEnd;
        public Light sun;
        /// <summary>章节主题（Desert / Frost / Inferno）：软边界白化用哪套</summary>
        public string theme = "Desert";
        /// <summary>白化天气 id（空 = 按主题，见 <see cref="WeatherProfiles.WhiteoutFor"/>）</summary>
        public string whiteoutProfile;

        /// <summary>盛行风：风吹去的方向（XZ）。1-1 东北风 = (−0.82, −0.57)</summary>
        [Header("风")]
        public Vector2 windDir = new(-0.82f, -0.57f);
        [Range(0, 1)] public float baseWind = 0.25f;

        [Header("区域风暴")]
        public Region[] regions = Array.Empty<Region>();

        /// <summary>晴天的远程锁定距离（风暴刚起时从它往能见度收）</summary>
        public const float ClearLockRange = 160f;

        public static WeatherDirector Instance { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        static readonly int WindDirId = Shader.PropertyToID("_WindDir");
        static AudioClip windClip;

        /// <summary>本帧插值后的天气（测试 / 调试读）</summary>
        public WeatherState Current { get; private set; }
        /// <summary>本帧软边界白化的权重</summary>
        public float WhiteoutWeight { get; private set; }

        bool captured;
        float baseSunIntensity = 1;
        Color baseSunColor = Color.white;
        Camera cam;
        Transform windT, domeT, wallRoot;
        WindZone windZone;
        Renderer domeR;
        Material veilMat;
        AudioSource windSrc;
        readonly Dictionary<string, Volume> volumes = new();
        readonly Dictionary<string, float> volumeWeights = new();
        readonly Dictionary<WeatherParticles, ParticleSystem> emitters = new();
        readonly Dictionary<WeatherParticles, (float rate, Color color, float speed)> emit = new();
        readonly List<(Transform t, Renderer r)> walls = new();
        Vector3 windVec;

        // ───────────── 静态查询 ─────────────

        /// <summary>某点处最强的区域风暴强度 0..1</summary>
        public static float StormAt(Vector3 at)
        {
            var d = Instance;
            if (!d) return 0;
            float s = 0;
            foreach (var r in d.regions)
                if (r != null) s = Mathf.Max(s, r.At(at));
            return s;
        }

        /// <summary>
        /// 某点处的远程锁定距离上限（米）：沙暴里收到 25 m（风暴强度 0.15 → 0.75 之间从 160 m 收过去），晴天 ∞。
        /// 远程敌人瞄准 / 开火前：距离超过 min(自己处, 目标处) 的上限就当丢失锁定（<see cref="CanLockOn"/>）。
        /// </summary>
        public static float LockOnRange(Vector3 at)
        {
            var d = Instance;
            if (!d) return float.PositiveInfinity;
            float range = float.PositiveInfinity;
            foreach (var r in d.regions)
            {
                if (r == null) continue;
                var p = WeatherProfiles.Get(r.profile);
                if (p == null || float.IsPositiveInfinity(p.visibility)) continue;
                float lvl = r.At(at);
                if (lvl <= 0.05f) continue;
                float k = Smooth01((lvl - 0.15f) / 0.6f);
                range = Mathf.Min(range, Mathf.Lerp(ClearLockRange, p.visibility, k));
            }
            return range;
        }

        /// <summary>shooter 能不能锁定 target（两端的锁定上限取小的）</summary>
        public static bool CanLockOn(Vector3 shooter, Vector3 target)
        {
            float range = Mathf.Min(LockOnRange(shooter), LockOnRange(target));
            return float.IsPositiveInfinity(range) || (target - shooter).sqrMagnitude <= range * range;
        }

        /// <summary>场景里没有天气导演就建一个（软边界开场时调；主题决定白化用哪套）</summary>
        public static WeatherDirector Ensure(string theme)
        {
            if (Instance) return Instance;
            var found = FindAnyObjectByType<WeatherDirector>();
            if (found) return found;
            var go = new GameObject("Weather (runtime)");
            var d = go.AddComponent<WeatherDirector>();
            d.theme = string.IsNullOrEmpty(theme) ? "Desert" : theme;
            return d;
        }

        /// <summary>离 at 最近的区域风暴立刻进入某个阶段（调试命令、冒烟测试）；没有区域返回 null</summary>
        public Region ForceNearest(Vector3 at, StormPhase phase, float t = 0)
        {
            Region best = null;
            float bd = float.MaxValue;
            foreach (var r in regions)
            {
                if (r == null) continue;
                float d = (r.center - at).sqrMagnitude;
                if (d < bd)
                {
                    bd = d;
                    best = r;
                }
            }
            best?.Force(phase, t);
            return best;
        }

        // ───────────── 生命周期 ─────────────

        void OnEnable()
        {
            if (Instance && Instance != this) Debug.LogWarning($"[Weather] 场景里有两个天气导演（{Instance.name} / {name}），用后一个");
            Instance = this;
        }

        void OnDisable()
        {
            if (Instance == this) Instance = null;
            Restore();
        }

        void OnDestroy()
        {
            foreach (var v in volumes.Values)
                if (v && v.sharedProfile)
                    Destroy(v.sharedProfile);
            if (veilMat) Destroy(veilMat);
        }

        /// <summary>第一次更新时记下基础值（这时关卡场景已经是活动场景，RenderSettings 是它的）</summary>
        void Capture()
        {
            captured = true;
            if (!(baseFogEnd > 0))
            {
                baseFogColor = RenderSettings.fogColor;
                baseFogStart = RenderSettings.fogStartDistance;
                baseFogEnd = Mathf.Max(1, RenderSettings.fogEndDistance);
            }
            if (!sun) sun = RenderSettings.sun;
            if (sun)
            {
                baseSunIntensity = sun.intensity;
                baseSunColor = sun.color;
            }
        }

        void Restore()
        {
            if (!captured) return;
            RenderSettings.fogColor = baseFogColor;
            RenderSettings.fogStartDistance = baseFogStart;
            RenderSettings.fogEndDistance = baseFogEnd;
            if (sun)
            {
                sun.intensity = baseSunIntensity;
                sun.color = baseSunColor;
            }
            var w = windDir.sqrMagnitude > 1e-6f ? windDir.normalized : Vector2.zero;
            Shader.SetGlobalVector(WindDirId, new Vector4(w.x, w.y, baseWind, 0));
            if (windSrc) windSrc.volume = 0;
        }

        void Update()
        {
            if (!captured) Capture();
            float dt = Time.deltaTime;
            if (!cam || !cam.isActiveAndEnabled) cam = Camera.main;
            var vitals = PlayerVitals.Instance;
            var player = vitals ? vitals.transform.position : cam ? cam.transform.position : transform.position;
            var eye = cam ? cam.transform.position : player + Vector3.up * 1.6f;

            // 1. 基础
            var baseDir = windDir.sqrMagnitude > 1e-6f ? windDir.normalized : Vector2.right;
            var s = new WeatherState
            {
                fogColor = baseFogColor, fogStart = baseFogStart, fogEnd = baseFogEnd, sunMult = 1, sunTint = Color.white,
                wind = baseWind, dome = 0, sound = 0,
            };
            var dirAcc = baseDir * Mathf.Max(0.05f, baseWind);
            volumeWeights.Clear();
            emit.Clear();

            // 2a. 区域风暴
            foreach (var r in regions)
            {
                if (r == null) continue;
                if (dt > 0) r.Tick(dt, player);
                var p = WeatherProfiles.Get(r.profile);
                float w = r.At(player);
                if (p != null && w > 0)
                {
                    s = WeatherState.Lerp(s, p, w);
                    Accumulate(p, w);
                    dirAcc += -r.from.normalized * (2f * w);
                }
                // 远处的风暴也有声音（预警时的风声随距离衰减）
                float far = r.Warning01 * (1 - Smooth01((Vector2.Distance(new Vector2(player.x, player.z), new Vector2(r.center.x, r.center.z)) - r.radius) / 90f));
                s.sound = Mathf.Max(s.sound, far * 0.55f);
            }

            // 2b. 软边界白化：风朝界内吹
            float white = BoundaryZone.Active ? BoundaryZone.PlayerWhiteout : 0;
            WhiteoutWeight = white;
            if (white > 0)
            {
                var wp = WeatherProfiles.Get(string.IsNullOrEmpty(whiteoutProfile) ? WeatherProfiles.WhiteoutFor(theme) : whiteoutProfile);
                if (wp != null)
                {
                    s = WeatherState.Lerp(s, wp, white);
                    Accumulate(wp, white);
                    var inward = BoundaryZone.InwardAt(player);
                    dirAcc += new Vector2(inward.x, inward.z) * (3f * white);
                }
            }
            Current = s;
            var dir = dirAcc.sqrMagnitude > 1e-6f ? dirAcc.normalized : baseDir;
            windVec = new Vector3(dir.x, 0, dir.y);

            // 3. 写出去
            RenderSettings.fogColor = s.fogColor;
            RenderSettings.fogStartDistance = s.fogStart;
            RenderSettings.fogEndDistance = Mathf.Max(s.fogStart + 1, s.fogEnd);
            if (sun)
            {
                sun.intensity = baseSunIntensity * s.sunMult;
                sun.color = baseSunColor * s.sunTint;
            }
            Shader.SetGlobalVector(WindDirId, new Vector4(dir.x, dir.y, s.wind, 0));
            UpdateWindZone(s.wind);
            UpdateVolumes();
            UpdateDome(eye, s);
            UpdateParticles(eye);
            UpdateWalls();
            UpdateSound(s.sound);
        }

        void Accumulate(WeatherProfile p, float w)
        {
            volumeWeights.TryGetValue(p.id, out float vw);
            volumeWeights[p.id] = Mathf.Max(vw, w);
            if (p.particles == WeatherParticles.None || !(p.particleRate > 0)) return;
            emit.TryGetValue(p.particles, out var e);
            float rate = e.rate + p.particleRate * w;
            // 颜色 / 速度取权重大的那个
            if (p.particleRate * w >= e.rate) emit[p.particles] = (rate, p.particleColor, p.particleSpeed);
            else emit[p.particles] = (rate, e.color, e.speed);
        }

        // ───────────── 风 ─────────────

        void UpdateWindZone(float wind)
        {
            if (!windZone)
            {
                windT = new GameObject("Wind").transform;
                windT.SetParent(transform, false);
                windZone = windT.gameObject.AddComponent<WindZone>();
                windZone.mode = WindZoneMode.Directional;
            }
            windT.rotation = Quaternion.LookRotation(windVec);
            windZone.windMain = 0.2f + 1.8f * wind;
            windZone.windTurbulence = 0.1f + 0.9f * wind;
            windZone.windPulseMagnitude = 0.5f;
            windZone.windPulseFrequency = 0.1f + 0.3f * wind;
        }

        // ───────────── 后处理 ─────────────

        void UpdateVolumes()
        {
            foreach (var kv in volumeWeights)
            {
                var p = WeatherProfiles.Get(kv.Key);
                if (p == null) continue;
                var v = VolumeFor(p);
                if (v) v.weight = kv.Value;
            }
            foreach (var kv in volumes)
                if (kv.Value && !volumeWeights.ContainsKey(kv.Key))
                    kv.Value.weight = 0;
        }

        Volume VolumeFor(WeatherProfile p)
        {
            if (volumes.TryGetValue(p.id, out var v) && v) return v;
            var go = new GameObject($"Weather Volume · {p.id}");
            go.transform.SetParent(transform, false);
            v = go.AddComponent<Volume>();
            v.isGlobal = true;
            // 白化压在风暴之上
            v.priority = p.id.StartsWith("whiteout") ? 60 : 50;
            v.weight = 0;
            var prof = ScriptableObject.CreateInstance<VolumeProfile>();
            prof.name = $"VP_Weather_{p.id}";
            prof.hideFlags = HideFlags.DontSave;
            var ca = prof.Add<ColorAdjustments>(true);
            ca.postExposure.Override(p.postExposure);
            ca.contrast.Override(p.contrast);
            ca.saturation.Override(p.saturation);
            ca.colorFilter.Override(p.colorFilter);
            v.sharedProfile = prof;
            volumes[p.id] = v;
            return v;
        }

        // ───────────── 远幕 ─────────────

        /// <summary>远幕与沙墙共用的材质：普通透明、双面，排在其他透明物体之前（不盖住近处的弹道、粒子）</summary>
        Material VeilMaterial()
        {
            if (veilMat) return veilMat;
            veilMat = new Material(FxMaterials.AlphaBlend) { name = "M_WeatherVeil (runtime)", hideFlags = HideFlags.DontSave };
            veilMat.renderQueue = (int)RenderQueue.Transparent - 100;
            return veilMat;
        }

        void UpdateDome(Vector3 eye, in WeatherState s)
        {
            float a = Mathf.Clamp01(s.dome);
            if (a <= 0.005f)
            {
                if (domeT) domeT.gameObject.SetActive(false);
                return;
            }
            if (!domeT)
            {
                var go = new GameObject("Weather Veil", typeof(MeshFilter), typeof(MeshRenderer));
                domeT = go.transform;
                domeT.SetParent(transform, false);
                go.GetComponent<MeshFilter>().sharedMesh = SphereMesh();
                domeR = go.GetComponent<MeshRenderer>();
                domeR.sharedMaterial = VeilMaterial();
                domeR.shadowCastingMode = ShadowCastingMode.Off;
                domeR.receiveShadows = false;
            }
            domeT.gameObject.SetActive(true);
            domeT.position = eye;
            domeT.localScale = Vector3.one * Mathf.Clamp(s.fogEnd * 1.02f, 12f, 1200f);
            FxMaterials.Tint(domeR, new Color(s.fogColor.r, s.fogColor.g, s.fogColor.b, a));
        }

        // ───────────── 沙墙 ─────────────

        void UpdateWalls()
        {
            for (int i = 0; i < regions.Length; i++)
            {
                var r = regions[i];
                if (r == null) continue;
                while (walls.Count <= i) walls.Add((null, null));
                float warnK = r.Warning01;
                float sweep = r.phase == StormPhase.Storm ? Mathf.Clamp01(r.phaseT / 3f) : r.phase == StormPhase.Abating ? 1 : 0;
                float alpha = r.phase == StormPhase.Abating ? 0 : warnK * (1 - sweep) * 0.85f;
                var (t, rend) = walls[i];
                if (alpha <= 0.01f)
                {
                    if (t) t.gameObject.SetActive(false);
                    continue;
                }
                if (!t)
                {
                    if (!wallRoot)
                    {
                        wallRoot = new GameObject("Sand Walls").transform;
                        wallRoot.SetParent(transform, false);
                    }
                    var go = new GameObject($"Sand Wall · {r.name}", typeof(MeshFilter), typeof(MeshRenderer));
                    t = go.transform;
                    t.SetParent(wallRoot, false);
                    go.GetComponent<MeshFilter>().sharedMesh = ArcMesh();
                    rend = go.GetComponent<MeshRenderer>();
                    rend.sharedMaterial = VeilMaterial();
                    rend.shadowCastingMode = ShadowCastingMode.Off;
                    rend.receiveShadows = false;
                    walls[i] = (t, rend);
                }
                t.gameObject.SetActive(true);
                var from = r.from.sqrMagnitude > 1e-6f ? r.from.normalized : Vector2.right;
                float yaw = Mathf.Atan2(-from.y, from.x) * Mathf.Rad2Deg;
                float radius = Mathf.Lerp(r.radius + 70f, r.radius * 0.2f, sweep);
                float height = 8f + 34f * warnK;
                t.SetPositionAndRotation(r.center - Vector3.up * 3f, Quaternion.Euler(0, yaw, 0));
                t.localScale = new Vector3(radius, height, radius);
                var p = WeatherProfiles.Get(r.profile);
                var c = p != null ? p.fogColor : new Color(0.74f, 0.57f, 0.37f);
                FxMaterials.Tint(rend, new Color(c.r, c.g, c.b, alpha));
            }
        }

        // ───────────── 粒子 ─────────────

        static readonly WeatherParticles[] ParticleKinds = { WeatherParticles.Sand, WeatherParticles.Snow, WeatherParticles.Ash };

        void UpdateParticles(Vector3 eye)
        {
            foreach (var kind in ParticleKinds)
            {
                emit.TryGetValue(kind, out var e);
                emitters.TryGetValue(kind, out var ps);
                if (!(e.rate > 0.5f) && !ps) continue;
                if (!ps)
                {
                    ps = CreateEmitter(kind);
                    emitters[kind] = ps;
                }
                float speed = e.speed > 0 ? e.speed : 10f;
                // 发射盒放在相机上风处，粒子顺风穿过视野
                ps.transform.SetPositionAndRotation(eye - windVec * (speed * 0.6f) + Vector3.up * 2f, Quaternion.LookRotation(windVec));
                var em = ps.emission;
                em.rateOverTime = e.rate * Fx.Density;
                if (e.rate > 0.5f)
                {
                    var main = ps.main;
                    main.startColor = e.color;
                    var vel = ps.velocityOverLifetime;
                    float fall = kind == WeatherParticles.Snow ? -1.6f : kind == WeatherParticles.Ash ? -0.6f : -0.3f;
                    vel.x = new ParticleSystem.MinMaxCurve(windVec.x * speed * 0.75f, windVec.x * speed * 1.15f);
                    vel.y = new ParticleSystem.MinMaxCurve(fall - 0.6f, fall + 0.6f);
                    vel.z = new ParticleSystem.MinMaxCurve(windVec.z * speed * 0.75f, windVec.z * speed * 1.15f);
                    if (!ps.isPlaying) ps.Play();
                }
            }
        }

        ParticleSystem CreateEmitter(WeatherParticles kind)
        {
            var go = new GameObject($"Weather Particles · {kind}");
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            var cfg = new FxParticle
            {
                blend = FxBlend.Alpha,
                texture = kind == WeatherParticles.Sand ? FxTexture.Streak : kind == WeatherParticles.Snow ? FxTexture.Glow : FxTexture.Dust,
                render = kind == WeatherParticles.Sand ? FxRender.Stretched : FxRender.Billboard,
                fade = kind == WeatherParticles.Snow ? FxFade.Hold : FxFade.Smoke,
                stretchVelocity = 0.05f, stretchLength = 1.5f, spin = kind == WeatherParticles.Ash ? 90 : 0,
                maxParticles = 4000,
            };
            FxSetup.Configure(ps, cfg, FxMaterials.ParticleAlpha);
            var main = ps.main;
            main.startLifetime = new ParticleSystem.MinMaxCurve(1.2f, 2.2f);
            main.startSize = kind switch
            {
                WeatherParticles.Sand => new ParticleSystem.MinMaxCurve(0.08f, 0.22f),
                WeatherParticles.Snow => new ParticleSystem.MinMaxCurve(0.05f, 0.12f),
                _ => new ParticleSystem.MinMaxCurve(0.06f, 0.16f),
            };
            main.startSpeed = 0;
            var em = ps.emission;
            em.enabled = true;
            em.rateOverTime = 0;
            var shape = ps.shape;
            shape.enabled = true;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(46f, 14f, 46f);
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            vel.x = new ParticleSystem.MinMaxCurve(0, 0);
            vel.y = new ParticleSystem.MinMaxCurve(0, 0);
            vel.z = new ParticleSystem.MinMaxCurve(0, 0);
            var noise = ps.noise;
            noise.enabled = true;
            noise.strength = kind == WeatherParticles.Snow ? 1.2f : 0.8f;
            noise.frequency = 0.35f;
            noise.scrollSpeed = 0.6f;
            ps.Play();
            return ps;
        }

        // ───────────── 风声 ─────────────

        void UpdateSound(float level)
        {
            if (level <= 0.01f && !windSrc) return;
            if (!windSrc)
            {
                windSrc = gameObject.AddComponent<AudioSource>();
                windSrc.clip = WindClip();
                windSrc.loop = true;
                windSrc.spatialBlend = 0;
                windSrc.playOnAwake = false;
                windSrc.volume = 0;
                windSrc.Play();
            }
            float target = Mathf.Clamp01(level) * 0.55f * GameAudio.MasterVolume * GameAudio.SfxVolume;
            windSrc.volume = Mathf.MoveTowards(windSrc.volume, target, Time.unscaledDeltaTime * 0.6f);
            windSrc.pitch = 0.85f + 0.3f * Mathf.Clamp01(level);
        }

        /// <summary>风声循环：4 s 棕噪声 + 两道慢速起伏（周期整除 4 s），首尾交叉淡化，确定性（固定种子）</summary>
        static AudioClip WindClip()
        {
            if (windClip) return windClip;
            const int rate = 22050, seconds = 4, n = rate * seconds, xf = rate / 4;
            var rng = new Random(7);
            var raw = new float[n + xf];
            float b = 0;
            for (int i = 0; i < raw.Length; i++)
            {
                b = (b + 0.02f * (float)(rng.NextDouble() * 2 - 1)) / 1.02f;
                float t = i / (float)rate;
                float swell = 0.6f + 0.25f * Mathf.Sin(t * Mathf.PI * 2 / 4f) + 0.15f * Mathf.Sin(t * Mathf.PI * 2 / 1f + 1.3f);
                raw[i] = b * swell;
            }
            var s = new float[n];
            for (int i = 0; i < n; i++) s[i] = raw[i];
            // 尾巴（n 之后那段）交叉淡化进开头：循环点没有咔嗒声
            for (int i = 0; i < xf; i++)
            {
                float k = i / (float)xf;
                s[i] = raw[i] * k + raw[n + i] * (1 - k);
            }
            float peak = 1e-4f;
            foreach (var v in s) peak = Mathf.Max(peak, Mathf.Abs(v));
            for (int i = 0; i < n; i++) s[i] *= 0.6f / peak;
            windClip = AudioClip.Create("Wind (procedural)", n, 1, rate, false);
            windClip.SetData(s, 0);
            return windClip;
        }

        // ───────────── 网格 ─────────────

        static Mesh sphere, arc;

        /// <summary>单位球（顶点色白；两面都有三角形，相机在里面也看得见）</summary>
        static Mesh SphereMesh()
        {
            if (sphere) return sphere;
            const int seg = 24, rings = 14;
            var v = new List<Vector3>();
            var tri = new List<int>();
            for (int r = 0; r <= rings; r++)
            {
                float phi = Mathf.PI * r / rings;
                for (int s = 0; s <= seg; s++)
                {
                    float th = Mathf.PI * 2 * s / seg;
                    v.Add(new Vector3(Mathf.Sin(phi) * Mathf.Cos(th), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(th)));
                }
            }
            for (int r = 0; r < rings; r++)
            for (int s = 0; s < seg; s++)
            {
                int a = r * (seg + 1) + s, b2 = a + seg + 1;
                tri.AddRange(new[] { a, b2, a + 1, a + 1, b2, b2 + 1, a, a + 1, b2, a + 1, b2 + 1, b2 });
            }
            sphere = new Mesh { name = "WeatherVeilSphere", hideFlags = HideFlags.DontSave };
            sphere.SetVertices(v);
            sphere.SetColors(Fill(v.Count, Color.white));
            sphere.SetTriangles(tri, 0);
            sphere.bounds = new Bounds(Vector3.zero, Vector3.one * 2);
            return sphere;
        }

        /// <summary>沙墙：半径 1、高 1 的竖直圆弧（局部 +X 两侧各 70°），底部不透明、往上淡出；双面</summary>
        static Mesh ArcMesh()
        {
            if (arc) return arc;
            const int seg = 28;
            float half = 70 * Mathf.Deg2Rad;
            var v = new List<Vector3>();
            var c = new List<Color>();
            var tri = new List<int>();
            float[] rows = { 0f, 0.45f, 1f };
            float[] alpha = { 1f, 0.75f, 0f };
            for (int s = 0; s <= seg; s++)
            {
                float a = -half + 2 * half * s / seg;
                // 两端也淡出，不留硬边
                float edge = Mathf.Clamp01(Mathf.Min(s, seg - s) / 5f);
                for (int k = 0; k < rows.Length; k++)
                {
                    v.Add(new Vector3(Mathf.Cos(a), rows[k], -Mathf.Sin(a)));
                    c.Add(new Color(1, 1, 1, alpha[k] * edge));
                }
            }
            for (int s = 0; s < seg; s++)
            for (int k = 0; k + 1 < rows.Length; k++)
            {
                int a0 = s * rows.Length + k, a1 = a0 + 1, b0 = a0 + rows.Length, b1 = b0 + 1;
                tri.AddRange(new[] { a0, b0, a1, a1, b0, b1, a0, a1, b0, a1, b1, b0 });
            }
            arc = new Mesh { name = "SandWallArc", hideFlags = HideFlags.DontSave };
            arc.SetVertices(v);
            arc.SetColors(c);
            arc.SetTriangles(tri, 0);
            arc.RecalculateBounds();
            return arc;
        }

        static List<Color> Fill(int n, Color c)
        {
            var l = new List<Color>(n);
            for (int i = 0; i < n; i++) l.Add(c);
            return l;
        }

        static float Smooth01(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>离玩家最近的区域风暴立刻开始（预警 → 风暴）。没有热键：DevCommands.Run("sandstorm")</summary>
    [Defs]
    public sealed class SandstormCommand : DevCommand
    {
        public override string Id => "sandstorm";
        public override string Label => "沙暴（最近的区域立刻预警）";

        public override void Execute()
        {
            var d = WeatherDirector.Instance;
            var p = PlayerVitals.Instance;
            var r = d && p ? d.ForceNearest(p.transform.position, StormPhase.Warning) : null;
            DevCommands.Say(r != null ? $"沙暴预警：{r.name}" : "这张图没有区域风暴");
        }
    }
#endif
}
