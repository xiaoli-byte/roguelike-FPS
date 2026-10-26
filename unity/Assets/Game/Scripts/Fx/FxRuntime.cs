using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效运行时（常驻的「Fx」根物体，DontDestroyOnLoad；换关 / 卸载关卡场景时清场）：
    ///   每种粒子风格一个共享的世界空间 Shuriken 发射器（预制体来自 Resources/Fx/Presets，缺了按 FxPreset 现场搭）；
    ///   每次 Fx 调用占一个「作业」槽（池化）：记着它发进了哪些发射器、用的闪光灯、贴地环、还没到点的延迟层，
    ///   句柄 Cancel 时据粒子的随机种子标签把这一次发出的粒子掐掉（寿命截到 0.08 s → 透明度曲线直接走到末尾），灯和环一起淡出；
    ///   贴地冲击环的竖直光墙（圆柱面）也在这里池化。
    /// 线状特效（曳光、光束）在 <see cref="FxLines"/>，闪电在 <see cref="Lightning"/>，刀光在 <see cref="SlashArc"/>，灯在 <see cref="FxLightPool"/>。
    /// 暂停（timeScale = 0）时一起冻结：粒子用缩放时间，作业 / 灯 / 线都按 Time.deltaTime 推进。
    /// </summary>
    [DefaultExecutionOrder(-50)]
    public sealed class FxRuntime : MonoBehaviour
    {
        public const string PresetResourcesDir = "Fx/Presets";
        public const string VariantsResourcePath = "Fx/FxShaderVariants";
        const int MaxJobs = 384;
        const uint TagMask = 0xFFFFF000u;

        static FxRuntime instance;
        static bool quitting;

        internal FxLightPool Lights { get; private set; }
        internal FxLines Lines { get; private set; }

        // ───────────── 生命周期 ─────────────

        /// <summary>取（必要时创建）常驻的特效根。编辑器非 Play、正在退出时返回 null（调用方当作「什么都不做」）</summary>
        internal static FxRuntime Ensure()
        {
            if (instance) return instance;
            if (quitting || !Application.isPlaying) return null;
            var go = new GameObject("Fx");
            DontDestroyOnLoad(go);
            instance = go.AddComponent<FxRuntime>();
            return instance;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            quitting = false;
        }

        /// <summary>开局就建好特效根并预热（避免第一发子弹时现建 14 个发射器卡一下）</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            Application.quitting -= OnQuit;
            Application.quitting += OnQuit;
            Ensure();
        }

        static void OnQuit() => quitting = true;

        void Awake()
        {
            if (instance && instance != this)
            {
                Destroy(gameObject);
                return;
            }
            instance = this;
            Lights = gameObject.AddComponent<FxLightPool>();
            Lines = gameObject.AddComponent<FxLines>();
            gameObject.AddComponent<FxDecals>();
            gameObject.AddComponent<MuzzleFlashes>();
            SceneManager.sceneUnloaded += OnSceneUnloaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
            Spiritfire.Art.ArtQuality.Changed += OnQuality;
            FxDirector.Install();
            StartCoroutine(WarmUpNextFrame());
        }

        void OnDestroy()
        {
            SceneManager.sceneUnloaded -= OnSceneUnloaded;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            Spiritfire.Art.ArtQuality.Changed -= OnQuality;
            if (instance == this)
            {
                FxDirector.Uninstall();
                instance = null;
            }
        }

        /// <summary>画质变了：每种风格的上限按新倍率重设，弹孔超出新上限的收掉</summary>
        void OnQuality(Spiritfire.Art.ArtQualityLevel _)
        {
            foreach (var e in emitters.Values)
                if (e.ps) ApplyCap(e);
            FxDecals.Trim();
        }

        static void ApplyCap(Emitter e)
        {
            var preset = Registry<FxPreset>.Get(e.id);
            if (preset?.Particle == null) return;
            var main = e.ps.main;
            main.maxParticles = Mathf.Max(16, Mathf.RoundToInt(preset.Particle.maxParticles * FxBudget.StyleCapScale));
        }

        void OnSceneUnloaded(Scene _) => ClearAll();

        void OnSceneLoaded(Scene s, LoadSceneMode mode)
        {
            if (isActiveAndEnabled) StartCoroutine(WarmUpNextFrame());
        }

        IEnumerator WarmUpNextFrame()
        {
            // 等关卡场景里的相机 / 玩家（叠加加载时可能晚一帧）就位
            yield return null;
            WarmUp();
        }

        // ───────────── 共享发射器 ─────────────

        internal sealed class Emitter
        {
            public string id;
            public ParticleSystem ps;
            public ParticleSystem.Particle[] buffer;
            /// <summary>出生时随机转角（火舌、符文这类有上下的不转）</summary>
            public bool rotate = true;
        }

        readonly Dictionary<string, Emitter> emitters = new();
        readonly HashSet<string> missing = new();

        /// <summary>按风格预设 id 取发射器（第一次用时建；预设不存在或不是粒子风格返回 null 并只警告一次）</summary>
        internal Emitter GetEmitter(string id)
        {
            if (id == null) return null;
            if (emitters.TryGetValue(id, out var e)) return e.ps ? e : Rebuild(e);
            var preset = Registry<FxPreset>.Get(id);
            if (preset?.Particle == null)
            {
                if (missing.Add(id)) Debug.LogWarning($"[Fx] 没有粒子风格「{id}」（G/Fx/Presets 里登记的 FxPreset 且带 Particle）");
                return null;
            }
            e = new Emitter { id = id };
            emitters[id] = e;
            return Rebuild(e);
        }

        Emitter Rebuild(Emitter e)
        {
            var preset = Registry<FxPreset>.Get(e.id);
            var prefab = Resources.Load<GameObject>($"{PresetResourcesDir}/{e.id}");
            ParticleSystem ps = null;
            if (prefab && prefab.GetComponent<ParticleSystem>())
            {
                var go = Instantiate(prefab, transform);
                go.name = e.id;
                ps = go.GetComponent<ParticleSystem>();
                // 预制体的材质被剥离 / 丢失时换成运行时材质（永远不出粉色）
                var r = go.GetComponent<ParticleSystemRenderer>();
                if (r && !FxMaterials.Usable(r.sharedMaterial)) r.sharedMaterial = ParticleMaterial(preset.Particle);
            }
            if (!ps)
            {
                var go = new GameObject(e.id);
                go.transform.SetParent(transform, false);
                ps = go.AddComponent<ParticleSystem>();
                FxSetup.Configure(ps, preset.Particle, ParticleMaterial(preset.Particle));
            }
            ps.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            ps.transform.localScale = Vector3.one;
            ps.Play(true);
            e.ps = ps;
            e.buffer = null;
            e.rotate = preset.Particle.randomRotation;
            ApplyCap(e);
            return e;
        }

        static Material ParticleMaterial(FxParticle p) =>
            p.flipbook != null ? FxToon.Material(p.flipbook.material, p.blend) : p.blend == FxBlend.Additive ? FxMaterials.ParticleAdd : FxMaterials.ParticleAlpha;

        ParticleSystem.EmitParams ep;

        /// <summary>发一颗粒子（世界坐标 / 速度；大小是直径，米）</summary>
        internal void EmitOne(Emitter e, Vector3 pos, Vector3 vel, float size, float life, Color color, uint seed)
        {
            ep.applyShapeToPosition = false;
            ep.position = pos;
            ep.velocity = vel;
            ep.startSize = size;
            ep.startLifetime = life;
            ep.startColor = color;
            ep.rotation = e.rotate ? Random.value * 360f : 0f;
            ep.randomSeed = seed;
            e.ps.Emit(ep, 1);
        }

        /// <summary>把带某个标签的粒子寿命截到 keep 秒（取消用）</summary>
        static void Kill(Emitter e, uint tag, float keep)
        {
            if (e?.ps == null) return;
            int max = e.ps.main.maxParticles;
            if (e.buffer == null || e.buffer.Length < max) e.buffer = new ParticleSystem.Particle[max];
            int n = e.ps.GetParticles(e.buffer);
            bool dirty = false;
            for (int i = 0; i < n; i++)
            {
                if ((e.buffer[i].randomSeed & TagMask) != tag) continue;
                if (e.buffer[i].remainingLifetime > keep)
                {
                    e.buffer[i].remainingLifetime = keep;
                    dirty = true;
                }
            }
            if (dirty) e.ps.SetParticles(e.buffer, n);
        }

        // ───────────── 作业（一次 Fx 调用） ─────────────

        internal sealed class Job : FxSlot
        {
            public FxRuntime owner;
            public uint tag;
            public float start, until;
            public readonly Emitter[] emitted = new Emitter[10];
            public int emittedCount;
            /// <summary>附带的闪光灯 / 贴地环 / 其它（光墙）：取消时一起淡出，都结束了作业才回收</summary>
            public FxHandle light, ring, extra;
            // 延迟层
            public FxPreset preset;
            public Vector3 pos, normal;
            public Color tint;
            public float scale;
            public int pending;

            public override void CancelFx() => owner.CancelJob(this);

            public override void MoveFx(Vector3 position)
            {
                pos = position;
                light.MoveTo(position);
            }

            public void Mark(Emitter e)
            {
                for (int i = 0; i < emittedCount; i++)
                    if (emitted[i] == e) return;
                if (emittedCount < emitted.Length) emitted[emittedCount++] = e;
            }
        }

        readonly List<Job> jobs = new();
        readonly Stack<Job> freeJobs = new();
        uint nextTag;

        internal Job TakeJob()
        {
            Job j;
            if (freeJobs.Count > 0) j = freeJobs.Pop();
            else if (jobs.Count < MaxJobs) j = new Job { owner = this };
            else
            {
                // 满了：挤掉最早的（它的粒子照常播完，只是不能再被取消）
                j = jobs[0];
                jobs.RemoveAt(0);
                j.active = false;
            }
            j.Claim();
            nextTag += 1u << 12;
            if (nextTag == 0) nextTag = 1u << 12;
            j.tag = nextTag;
            j.start = Time.time;
            j.until = Time.time;
            j.emittedCount = 0;
            j.light = FxHandle.None;
            j.ring = FxHandle.None;
            j.extra = FxHandle.None;
            j.preset = null;
            j.pending = 0;
            jobs.Add(j);
            return j;
        }

        uint Seed(Job j) => j.tag | ((uint)Random.Range(0, 4096) & 0xFFFu);

        void CancelJob(Job j)
        {
            if (!j.active) return;
            for (int i = 0; i < j.emittedCount; i++) Kill(j.emitted[i], j.tag, 0.08f);
            j.light.Cancel();
            j.ring.Cancel();
            j.extra.Cancel();
            j.pending = 0;
            j.until = Mathf.Min(j.until, Time.time + 0.1f);
        }

        // ───────────── 按预设播放 ─────────────

        /// <summary>按预设发射全部层 + 闪光灯 + 贴地环 + 震屏，返回作业句柄</summary>
        internal FxHandle Play(FxPreset p, Vector3 pos, Vector3 normal, Color tint, float scale)
        {
            float s = Mathf.Clamp(Fx.Finite(scale) ? scale : 1, p.ScaleMin, p.ScaleMax);
            var n = normal.sqrMagnitude > 1e-6f ? normal.normalized : Vector3.up;
            var j = TakeJob();
            j.preset = p;
            j.pos = pos;
            j.normal = n;
            j.tint = tint;
            j.scale = s;
            // 先发被包含的预设的层（暴击 = 普通命中 + 星芒），不带它们的灯 / 环 / 震屏，也不支持它们的延迟层
            if (p.Includes != null)
                foreach (var id in p.Includes)
                {
                    var inc = Registry<FxPreset>.Get(id);
                    if (inc == null || inc == p) continue;
                    foreach (var L in inc.Layers)
                    {
                        j.until = Mathf.Max(j.until, Time.time + L.life.y);
                        EmitLayer(j, inc, L, pos, n, tint, s);
                    }
                }
            var layers = p.Layers;
            for (int i = 0; i < layers.Length; i++)
            {
                var L = layers[i];
                j.until = Mathf.Max(j.until, Time.time + L.delay + L.life.y);
                if (L.delay > 0 && i < 31) j.pending |= 1 << i;
                else EmitLayer(j, p, L, pos, n, tint, s);
            }

            if (p.Light != null)
            {
                var spec = p.Light;
                var c = ColorOf(spec.color, tint, spec.fixedColor, spec.mix);
                j.light = FxLightPool.Flash(pos + n * spec.lift, c, spec.intensity.Eval(s), spec.range.Eval(s), spec.life);
            }
            if (p.Ring != null)
            {
                var spec = p.Ring;
                float gy = Fx.GroundY(pos, 20f);
                if (pos.y - gy < spec.heightFactor * s)
                    j.ring = Fx.Ring(new Vector3(pos.x, gy, pos.z), spec.radius.Eval(s), tint, spec.duration, spec.band);
            }
            if (p.Shake != null) ShakeFrom(p.Shake, pos, s);
            if (p.Decal != null)
            {
                var spec = p.Decal;
                if (Physics.Raycast(pos + Vector3.up * 0.1f, Vector3.down, out var gh, spec.heightFactor * s + 0.1f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    FxDecals.Sprite(spec.kind, gh.point, gh.normal, spec.size.Eval(s), spec.heat, spec.life, spec.kind == FxDecalKind.Splat ? 2 : 0, 0,
                        Mathf.Clamp(spec.size.Eval(s) * 0.45f, 0.8f, 5f), spec.kind == FxDecalKind.Scorch ? 0.8f : 1.5f);
            }
            return new FxHandle(j);
        }

        static Color ColorOf(FxColor mode, Color tint, Color fixedColor, float mix) => mode switch
        {
            FxColor.Hot => Color.Lerp(tint, Color.white, mix),
            FxColor.White => Color.white,
            FxColor.Fixed => Color.Lerp(fixedColor, tint, mix),
            FxColor.RandomMix => Color.Lerp(fixedColor, tint, Random.value),
            _ => tint,
        };

        static void ShakeFrom(FxShakeSpec spec, Vector3 pos, float s)
        {
            var cam = Camera.main;
            if (!cam) return;
            float range = Mathf.Max(0.1f, spec.range.Eval(s));
            float k = Mathf.Clamp01(1 - Vector3.Distance(cam.transform.position, pos) / range);
            if (k <= 0.05f) return;
            CameraShake.Add(spec.strength.Eval(s) * k * k, spec.duration.Eval(s) + spec.durationPerK * k);
        }

        void EmitLayer(Job j, FxPreset p, FxLayer L, Vector3 pos, Vector3 n, Color tint, float s)
        {
            var e = GetEmitter(L.style ?? p.Id);
            if (e == null) return;
            float baseCount = L.count.Eval(s);
            if (baseCount < 0.5f) return;
            // 乘画质密度后至少留 1 颗（定义里写了要发的层不会在低画质整层消失）；再过同屏总预算（单颗闪光核心总是放行）
            int count = Mathf.Clamp(Mathf.RoundToInt(baseCount * (L.density ? Fx.Density : 1f)), 1, Mathf.Max(1, L.maxCount));
            count = FxBudget.Allow(count, !L.density);
            if (count <= 0) return;
            j.Mark(e);
            float speedK = L.speedScale.Eval(s), sizeK = L.sizeScale.Eval(s), spread = L.spread.Eval(s);
            var basePos = pos + n * L.offset;
            var hot = Color.Lerp(tint, Color.white, L.mix);
            for (int i = 0; i < count; i++)
            {
                var d = Direction(L, n, i, count);
                var off = spread > 0 ? (d.sqrMagnitude > 0.01f ? d : Random.onUnitSphere) * (Random.Range(L.spreadMin, 1f) * spread) : Vector3.zero;
                off.y *= L.spreadY;
                var vel = d * (Random.Range(L.speed.x, L.speed.y) * speedK);
                vel.y += L.up;
                if (L.upJitter > 0) vel.y += Random.Range(-L.upJitter, L.upJitter);
                Color c = L.color switch
                {
                    FxColor.Hot => hot,
                    FxColor.Alternate => i % Mathf.Max(1, L.every) == 0 ? hot : tint,
                    FxColor.White => Color.white,
                    FxColor.Fixed => Color.Lerp(L.fixedColor, tint, L.mix),
                    FxColor.RandomMix => Color.Lerp(L.fixedColor, tint, Random.value),
                    _ => tint,
                };
                if (L.shade.x != 1 || L.shade.y != 1)
                {
                    float sh = Random.Range(L.shade.x, L.shade.y);
                    c.r *= sh;
                    c.g *= sh;
                    c.b *= sh;
                }
                c.a = Mathf.Clamp01(tint.a * L.alpha);
                float size = Random.Range(L.size.x, L.size.y) * sizeK;
                float life = Random.Range(L.life.x, L.life.y);
                if (!(size > 0) || !(life > 0)) continue;
                EmitOne(e, basePos + off, vel, size, life, c, Seed(j));
            }
        }

        static Vector3 Direction(FxLayer L, Vector3 n, int i, int count)
        {
            switch (L.shape)
            {
                case FxShape.Point:
                    return Vector3.zero;
                case FxShape.UpperSphere:
                {
                    var d = Random.onUnitSphere;
                    d.y = Mathf.Abs(d.y);
                    return d;
                }
                case FxShape.MostlyUp:
                {
                    var d = Random.onUnitSphere;
                    if (d.y < -0.2f) d.y = -d.y * 0.5f;
                    return d;
                }
                case FxShape.Hemisphere:
                {
                    var d = Random.onUnitSphere;
                    float k = Vector3.Dot(d, n);
                    if (k < 0) d -= 2 * k * n;
                    return (d + n * L.normalBias).normalized;
                }
                case FxShape.Cone:
                {
                    float cosA = Mathf.Cos(L.coneAngle * Mathf.Deg2Rad);
                    float z = Random.Range(cosA, 1f);
                    float phi = Random.value * Mathf.PI * 2;
                    float r = Mathf.Sqrt(Mathf.Max(0, 1 - z * z));
                    var local = new Vector3(r * Mathf.Cos(phi), r * Mathf.Sin(phi), z);
                    return Quaternion.FromToRotation(Vector3.forward, n) * local;
                }
                case FxShape.Disc:
                {
                    float a = (i / (float)Mathf.Max(1, count)) * Mathf.PI * 2 + Random.value * 0.3f;
                    return new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                }
                default:
                    return Random.onUnitSphere;
            }
        }

        // ───────────── 参数化爆发（Fx.Burst） ─────────────

        /// <summary>Three.js fx.burst：发光粒（按重力选风格）+ 快的时候带拉丝火花 + 数量够时中心一闪；尘土色改走烟尘粒子</summary>
        internal FxHandle Burst(Vector3 pos, Color color, int count, float speed, float life, float size, float gravity)
        {
            var j = TakeJob();
            int n = FxBudget.Allow(Mathf.Min(240, Mathf.Max(1, Mathf.RoundToInt(count * Fx.Density))), false);
            if (n <= 0)
            {
                j.until = Time.time;
                return new FxHandle(j);
            }
            if (Fx.IsDustColor(color))
            {
                var dust = GetEmitter("Dust");
                if (dust != null)
                {
                    j.Mark(dust);
                    for (int i = 0; i < n; i++)
                    {
                        var d = Random.onUnitSphere;
                        float sp = speed * Random.Range(0.3f, 1f);
                        float shade = Random.Range(0.82f, 1.12f);
                        var c = new Color(color.r * shade, color.g * shade, color.b * shade, color.a);
                        var v = new Vector3(d.x * sp, Mathf.Abs(d.y) * sp * 0.7f + speed * 0.12f, d.z * sp);
                        EmitOne(dust, pos, v, size * Random.Range(1.3f, 2.1f), life * Random.Range(0.9f, 1.5f), c, Seed(j));
                    }
                }
                if (speed >= 5)
                {
                    var chunk = GetEmitter("Chunk");
                    if (chunk != null)
                    {
                        j.Mark(chunk);
                        var cc = new Color(color.r * 0.55f, color.g * 0.55f, color.b * 0.55f, 1);
                        int m = Mathf.Min(16, Mathf.RoundToInt(n / 3f));
                        for (int i = 0; i < m; i++)
                        {
                            var d = Random.onUnitSphere;
                            float sp = speed * Random.Range(0.6f, 1.2f);
                            var v = new Vector3(d.x * sp, Mathf.Abs(d.y) * sp + 2, d.z * sp);
                            EmitOne(chunk, pos, v, Mathf.Min(0.2f, size * Random.Range(0.25f, 0.5f)), Random.Range(0.6f, 1.1f), cc, Seed(j));
                        }
                    }
                }
                j.until = Time.time + life * 1.5f + 1.1f;
                return new FxHandle(j);
            }

            var glow = GetEmitter(GlowStyleFor(gravity));
            var hot = Color.Lerp(color, Color.white, 0.5f);
            if (glow != null)
            {
                j.Mark(glow);
                for (int i = 0; i < n; i++)
                {
                    var d = Random.onUnitSphere;
                    float sp = speed * Random.Range(0.35f, 1f);
                    EmitOne(glow, pos, d * sp, size * Random.Range(0.7f, 1.35f), life * Random.Range(0.7f, 1.2f), i % 4 == 0 ? hot : color, Seed(j));
                }
                // 中心闪光：只给一下子迸出的爆发（低数量的持续发射——烟迹、灼烧火苗——不加）
                if (count >= 6)
                    EmitOne(GetEmitter("Glow") ?? glow, pos, Vector3.zero, size * (2 + Mathf.Min(2, count / 15f)) + 0.12f, Mathf.Min(0.12f, life * 0.3f), hot, Seed(j));
            }
            if (speed >= 5)
            {
                var streak = GetEmitter(gravity > 9 ? "Streak" : "StreakLight");
                if (streak != null)
                {
                    j.Mark(streak);
                    int m = Mathf.Min(60, Mathf.RoundToInt(n / 3f));
                    for (int i = 0; i < m; i++)
                    {
                        var d = Random.onUnitSphere;
                        float sp = speed * Random.Range(0.8f, 1.6f);
                        EmitOne(streak, pos, d * sp, 0.04f, life * Random.Range(0.4f, 0.8f), color, Seed(j));
                    }
                }
            }
            j.until = Time.time + life * 1.2f + 0.1f;
            return new FxHandle(j);
        }

        /// <summary>Burst 的重力是每次调用给的；Shuriken 的重力是每个发射器一份，所以按区间选一个发光风格</summary>
        static string GlowStyleFor(float gravity) => gravity switch
        {
            < -0.5f => "GlowRise",
            <= 0.5f => "Glow",
            <= 9f => "GlowFall",
            _ => "GlowHeavy",
        };

        // ───────────── 冲击环的竖直光墙 ─────────────

        sealed class Band : FxSlot
        {
            public Transform t;
            public MeshRenderer r;
            public MaterialPropertyBlock block;
            public float age, duration, radius, height, fade = -1, fadeFrom;
            public Color color;
            public bool expand;

            public override void CancelFx()
            {
                if (!active || fade >= 0) return;
                fade = 0;
                fadeFrom = Opacity(this);
            }
        }

        readonly List<Band> bands = new();
        Mesh bandMesh;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ColorId = Shader.PropertyToID("_Color");

        /// <summary>竖直光墙：expand = true 时半径缓出扩散（冲击波），否则原地升起（光柱）</summary>
        internal FxHandle Wall(Vector3 center, float radius, float height, Color color, float duration, bool expand)
        {
            Band b = null;
            foreach (var x in bands)
                if (!x.active)
                {
                    b = x;
                    break;
                }
            if (b == null)
            {
                if (bands.Count >= 32)
                {
                    // 挤掉最老的
                    b = bands[0];
                    foreach (var x in bands)
                        if (x.age / x.duration > b.age / b.duration) b = x;
                }
                else b = MakeBand();
            }
            b.Claim();
            b.age = 0;
            b.duration = Mathf.Max(0.05f, duration);
            b.radius = radius;
            b.height = height;
            b.color = color;
            b.expand = expand;
            b.fade = -1;
            b.t.position = center + Vector3.up * 0.02f;
            b.t.localScale = expand ? new Vector3(0.01f, height, 0.01f) : new Vector3(radius, 0.01f, radius);
            b.t.gameObject.SetActive(true);
            SetBandColor(b, 0);
            return new FxHandle(b);
        }

        Band MakeBand()
        {
            if (!bandMesh) bandMesh = MakeBandMesh(48);
            var go = new GameObject("Fx Band");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = bandMesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = FxMaterials.Band;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            go.SetActive(false);
            var b = new Band { t = go.transform, r = r, block = new MaterialPropertyBlock() };
            bands.Add(b);
            return b;
        }

        /// <summary>开口圆柱面：半径 1、高 1（底在原点），uv.y = 高度</summary>
        static Mesh MakeBandMesh(int segs)
        {
            var v = new Vector3[(segs + 1) * 2];
            var uv = new Vector2[v.Length];
            var idx = new int[segs * 6];
            for (int i = 0; i <= segs; i++)
            {
                float a = i / (float)segs * Mathf.PI * 2;
                var p = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                v[i * 2] = p;
                v[i * 2 + 1] = p + Vector3.up;
                uv[i * 2] = new Vector2(i / (float)segs, 0);
                uv[i * 2 + 1] = new Vector2(i / (float)segs, 1);
            }
            for (int i = 0, w = 0; i < segs; i++)
            {
                int a = i * 2, b = a + 2;
                idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                idx[w++] = b; idx[w++] = a + 1; idx[w++] = b + 1;
            }
            var m = new Mesh { name = "Fx Band" };
            m.vertices = v;
            m.uv = uv;
            m.triangles = idx;
            m.RecalculateBounds();
            return m;
        }

        void SetBandColor(Band b, float opacity)
        {
            var c = new Color(b.color.r, b.color.g, b.color.b, Mathf.Clamp01(opacity));
            b.block.Clear();
            b.block.SetColor(BaseColorId, c);
            b.block.SetColor(ColorId, c);
            b.r.SetPropertyBlock(b.block);
        }

        void UpdateBands(float dt)
        {
            foreach (var b in bands)
            {
                if (!b.active) continue;
                float opacity;
                if (b.fade >= 0)
                {
                    b.fade += dt;
                    float o = b.fade / 0.1f;
                    if (o >= 1)
                    {
                        b.active = false;
                        b.t.gameObject.SetActive(false);
                        continue;
                    }
                    opacity = b.fadeFrom * (1 - o) * (1 - o);
                    SetBandColor(b, opacity);
                    continue;
                }
                b.age += dt;
                float t = b.age / b.duration;
                if (t >= 1)
                {
                    b.active = false;
                    b.t.gameObject.SetActive(false);
                    continue;
                }
                if (b.expand)
                {
                    float r = Mathf.Max(0.01f, b.radius * (1 - (1 - t) * (1 - t) * (1 - t)));
                    b.t.localScale = new Vector3(r, b.height, r);
                }
                else
                {
                    // 光柱：快速升起，收窄淡出
                    float rise = 1 - Mathf.Pow(1 - Mathf.Min(1, t * 2.2f), 2);
                    float w = b.radius * (1 - t * 0.6f);
                    b.t.localScale = new Vector3(w, Mathf.Max(0.01f, b.height * rise), w);
                }
                SetBandColor(b, Opacity(b));
            }
        }

        static float Opacity(Band b)
        {
            float t = Mathf.Clamp01(b.age / b.duration);
            return b.expand ? (1 - t) * 0.9f : Mathf.Sin(t * Mathf.PI) * 0.85f;
        }

        // ───────────── 推进 / 清场 / 预热 ─────────────

        void Update()
        {
            // 同屏粒子统计（预算闸门用上一帧的存活数）
            int live = 0;
            foreach (var e in emitters.Values)
                if (e.ps) live += e.ps.particleCount;
            FxBudget.Live = live;
            if (live > FxBudget.Peak) FxBudget.Peak = live;
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            float now = Time.time;
            for (int i = jobs.Count - 1; i >= 0; i--)
            {
                var j = jobs[i];
                if (j.pending != 0 && j.preset != null)
                {
                    var layers = j.preset.Layers;
                    for (int k = 0; k < layers.Length && k < 31; k++)
                    {
                        if ((j.pending & (1 << k)) == 0 || now - j.start < layers[k].delay) continue;
                        j.pending &= ~(1 << k);
                        EmitLayer(j, j.preset, layers[k], j.pos, j.normal, j.tint, j.scale);
                    }
                }
                if (j.pending != 0 || now < j.until || j.light.Alive || j.ring.Alive || j.extra.Alive) continue;
                j.active = false;
                j.preset = null;
                jobs.RemoveAt(i);
                freeJobs.Push(j);
            }
            UpdateBands(dt);
        }

        /// <summary>全部清场：粒子、作业、灯、线、闪电、刀光、光墙（换关 / 卸载关卡场景时）</summary>
        internal void ClearAll()
        {
            foreach (var e in emitters.Values)
                if (e.ps) e.ps.Clear(true);
            foreach (var j in jobs)
            {
                j.active = false;
                j.preset = null;
                freeJobs.Push(j);
            }
            jobs.Clear();
            foreach (var b in bands)
            {
                b.active = false;
                if (b.t) b.t.gameObject.SetActive(false);
            }
            if (Lights) Lights.Clear();
            if (Lines) Lines.Clear();
            Lightning.ClearAll();
            SlashArc.ClearAll();
            Telegraph.ClearAll();
            FxDecals.ClearAll();
            MuzzleFlashes.ClearAll();
            FrostShell.ClearAll();
            IceSpikes.ClearAll();
            FlameTongues.ClearAll();
            MoltenStream.ClearAll();
            Surfaces.ClearCache();
        }

        /// <summary>当前有多少个共享发射器（统计用）</summary>
        internal int EmitterCount => emitters.Count;

        /// <summary>正在播的作业数（统计用）</summary>
        internal int JobCount => jobs.Count;

        bool variantsWarmed;

        /// <summary>
        /// 预热：ShaderVariantCollection（FxBuilder 生成）WarmUp 一次；再给每种粒子风格在相机前发一颗全透明粒子，
        /// 让真正的绘制状态（顶点格式、渲染目标）在加载黑幕里就编好，第一次爆炸不卡。
        /// </summary>
        internal void WarmUp()
        {
            if (!variantsWarmed)
            {
                variantsWarmed = true;
                var svc = Resources.Load<ShaderVariantCollection>(VariantsResourcePath);
                // DX12 / Vulkan / Metal 上 SVC.WarmUp 只能编着色器、编不了管线状态（顶点格式未知），那里靠下面的「透明粒子画一帧」
                var api = SystemInfo.graphicsDeviceType;
                bool classic = api is GraphicsDeviceType.Direct3D11 or GraphicsDeviceType.OpenGLCore or GraphicsDeviceType.OpenGLES3;
                try
                {
                    if (svc && classic && !svc.isWarmedUp) svc.WarmUp();
                }
                catch (System.Exception ex)
                {
                    Debug.LogWarning($"[Fx] 着色器变体预热失败（不影响运行）：{ex.Message}");
                }
            }
            var cam = Camera.main;
            if (!cam) return;
            var at = cam.transform.position + cam.transform.forward * 3f;
            var clear = new Color(1, 1, 1, 0);
            var all = Registry<FxPreset>.All;
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i].Particle == null) continue;
                var e = GetEmitter(all[i].Id);
                if (e != null) EmitOne(e, at, Vector3.zero, 0.01f, 0.05f, clear, 0);
            }
            Lines?.WarmUp(at);
            Telegraph.WarmUp(at);
        }
    }
}
