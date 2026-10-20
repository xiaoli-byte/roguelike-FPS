using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 地表牵引预设（docs/unity-parity.md L8，unity-maps-v1 第 2 节「冰面有惯性、冲刺滑更远，敌人同样受影响」）：
    /// 玩家的地面加速 / 刹车倍率（运动修饰器写 <see cref="MotorFrame.groundAccelMult"/> / <see cref="MotorFrame.groundFrictionMult"/>），
    /// 敌人 NavMeshAgent 加速度倍率（加速、刹车都用它），以及急转时打滑失衡的概率。
    /// </summary>
    [Serializable]
    public struct SurfaceProfile
    {
        public string id, title;
        /// <summary>玩家地面加速度倍率（冰面 0.15：0.6 s 才跑满速）</summary>
        public float accel;
        /// <summary>玩家地面刹车 / 超速回落倍率（冰面 0.1：冲刺余速 9.9 m/s 要滑约 8 m 才停，平地 0.8 m）</summary>
        public float friction;
        /// <summary>敌人 agent.acceleration 倍率</summary>
        public float enemyAccel;
        /// <summary>敌人急转（实际速度与想去的方向差 60° 以上、速度 &gt; 2.5 m/s）时每次判定滑倒的概率</summary>
        public float stumble;

        /// <summary>冻结的河面、冰潭（2-1 ①⑤、2-3 冰湖）</summary>
        public static SurfaceProfile Ice => new() { id = "ice", title = "冰面", accel = 0.15f, friction = 0.1f, enemyAccel = 0.2f, stumble = 0.35f };
        /// <summary>敌人留下的冻带 / 滑冰带（夫诸冰光、旋龟旋壳；Three.js ICE_TRACTION 0.1 / SLIP 5.5 的手感，持续几秒）</summary>
        public static SurfaceProfile Frost => new() { id = "frost", title = "冻地", accel = 0.25f, friction = 0.2f, enemyAccel = 0.35f, stumble = 0.2f };
        public static SurfaceProfile Normal => new() { id = "normal", title = "地面", accel = 1, friction = 1, enemyAccel = 1, stumble = 0 };

        /// <summary>按强度 k（0..1，限时冻带淡出时 &lt; 1）插值到地面</summary>
        public readonly SurfaceProfile Scaled(float k)
        {
            k = Mathf.Clamp01(k);
            return new SurfaceProfile
            {
                id = id, title = title, accel = Mathf.Lerp(1, accel, k), friction = Mathf.Lerp(1, friction, k),
                enemyAccel = Mathf.Lerp(1, enemyAccel, k), stumble = stumble * k,
            };
        }
    }

    /// <summary>区域形状：Box = 挂件 Transform 的单位立方体（白盒条带、缩放过的方块直接用）；Disc = 以 Transform 为圆心的圆（运行时冰斑）</summary>
    public enum ZoneShape
    {
        Box,
        Disc,
    }

    /// <summary>
    /// 区域的几何判定（<see cref="SurfaceZone"/> / <see cref="WaterVolume"/> / <see cref="Quicksand"/> 共用）：
    /// 水平范围按形状，竖直按「顶面」上下的带子（脚在顶面上方 above、下方 below 以内才算站在上面）。
    /// </summary>
    [Serializable]
    public struct ZoneArea
    {
        public ZoneShape shape;
        /// <summary>Disc 半径（米，世界）</summary>
        public float radius;
        /// <summary>脚离顶面多高 / 多低还算在区域里（米）</summary>
        public float above, below;

        public static ZoneArea Box(float above = 0.6f, float below = 0.8f) => new() { shape = ZoneShape.Box, radius = 0, above = above, below = below };
        public static ZoneArea Disc(float radius, float above = 0.6f, float below = 0.8f) => new() { shape = ZoneShape.Disc, radius = radius, above = above, below = below };

        /// <summary>顶面高度（Box：单位立方体顶面中心；Disc：Transform 高度）</summary>
        public readonly float Top(Transform t) => shape == ZoneShape.Box ? t.TransformPoint(0, 0.5f, 0).y : t.position.y;

        /// <summary>水平方向在区域里的程度：Box 返回 1 / 0；Disc 返回 1 − r / R（圆心 1，边上 0），区域外 −1</summary>
        public readonly float Horizontal(Transform t, Vector3 p)
        {
            if (shape == ZoneShape.Box)
            {
                var l = t.InverseTransformPoint(p);
                return Mathf.Abs(l.x) <= 0.5f && Mathf.Abs(l.z) <= 0.5f ? 1 : -1;
            }
            float r = new Vector2(p.x - t.position.x, p.z - t.position.z).magnitude;
            return r <= radius ? 1 - r / Mathf.Max(0.01f, radius) : -1;
        }

        public readonly bool Contains(Transform t, Vector3 feet)
        {
            if (Horizontal(t, feet) < 0) return false;
            float top = Top(t);
            return feet.y <= top + above && feet.y >= top - below;
        }
    }

    /// <summary>
    /// 把一个运动修饰器挂到当前玩家身上（玩家换了——换英雄、重进关——就挂到新的上），世界区域共用。
    /// </summary>
    internal sealed class MotorHook
    {
        readonly Func<PlayerMotor, IMotorModifier> make;
        readonly int priority;
        PlayerMotor motor;
        PlayerVitals vitals;
        IDisposable handle;

        public MotorHook(Func<PlayerMotor, IMotorModifier> make, int priority = 0)
        {
            this.make = make;
            this.priority = priority;
        }

        public PlayerMotor Motor => motor;

        public void Ensure()
        {
            var v = PlayerVitals.Instance;
            if (v == vitals && (handle != null || !v)) return;
            Release();
            vitals = v;
            motor = v ? v.GetComponent<PlayerMotor>() : null;
            if (motor) handle = motor.AddModifier(make(motor), priority);
        }

        public void Release()
        {
            handle?.Dispose();
            handle = null;
            motor = null;
            vitals = null;
        }
    }

    /// <summary>世界表面材质的种类（各一份 Resources/World/M_World_*.mat，由 LevelKit.EnsureWorldMaterials 生成）</summary>
    public enum WorldMaterialKind
    {
        Ice,
        Water,
        Quicksand,
    }

    /// <summary>
    /// 世界表面材质（冰 Spiritfire/Ice、水与流沙 Spiritfire/Water）：先读 Resources（打包时着色器跟着材质进包），
    /// 编辑器里缺资产时按同一份设置现场建，打包后再缺就退到特效的普通透明材质（不会是粉色）。改色 / 淡出走 MaterialPropertyBlock。
    /// </summary>
    public static class WorldMaterials
    {
        public const string ResourcesDir = "World";
        public const string IceShader = "Spiritfire/Ice", WaterShader = "Spiritfire/Water";

        static readonly Material[] cache = new Material[3];

        public static Material Ice => Get(WorldMaterialKind.Ice);
        public static Material Water => Get(WorldMaterialKind.Water);
        public static Material Quicksand => Get(WorldMaterialKind.Quicksand);

        public static string AssetName(WorldMaterialKind k) => "M_World_" + k;
        public static string ShaderName(WorldMaterialKind k) => k == WorldMaterialKind.Ice ? IceShader : WaterShader;

        public static Material Get(WorldMaterialKind k)
        {
            var m = cache[(int)k];
            if (m) return m;
            m = Resources.Load<Material>($"{ResourcesDir}/{AssetName(k)}");
            if (!FxMaterials.Usable(m))
            {
                m = null;
#if UNITY_EDITOR
                var sh = Shader.Find(ShaderName(k));
                if (sh && sh.isSupported)
                {
                    m = new Material(sh) { name = AssetName(k) + " (fallback)", hideFlags = HideFlags.DontSave };
                    Configure(k, m);
                }
#endif
                if (!m) m = FxMaterials.AlphaBlend;
            }
            cache[(int)k] = m;
            return m;
        }

        /// <summary>按种类设置材质参数（编辑器生成资产与运行时兜底共用）</summary>
        public static void Configure(WorldMaterialKind k, Material m)
        {
            switch (k)
            {
                case WorldMaterialKind.Ice:
                    Set(m, "_ShallowColor", new Color(0.74f, 0.9f, 1f, 0.55f));
                    Set(m, "_DeepColor", new Color(0.22f, 0.48f, 0.74f, 0.85f));
                    Set(m, "_CrackColor", new Color(0.93f, 0.98f, 1f, 1f));
                    Set(m, "_RimColor", new Color(0.86f, 0.95f, 1f, 1f));
                    Set(m, "_CrackScale", 1.6f);
                    Set(m, "_CrackWidth", 0.05f);
                    Set(m, "_Frost", 0.3f);
                    Set(m, "_Sparkle", 0.8f);
                    Set(m, "_Alpha", 1f);
                    Set(m, "_EdgeSoft", 0f);
                    break;
                case WorldMaterialKind.Water:
                    Set(m, "_ShallowColor", new Color(0.24f, 0.62f, 0.72f, 0.5f));
                    Set(m, "_DeepColor", new Color(0.05f, 0.22f, 0.4f, 0.88f));
                    Set(m, "_FoamColor", new Color(0.9f, 0.97f, 1f, 1f));
                    Set(m, "_Alpha", 0.72f);
                    Set(m, "_WaveScale", 3f);
                    Set(m, "_WaveSpeed", 0.6f);
                    Set(m, "_WaveHeight", 0.035f);
                    Set(m, "_FoamAmount", 0.35f);
                    Set(m, "_Gloss", 1f);
                    Set(m, "_Swirl", 0f);
                    Set(m, "_EdgeSoft", 0f);
                    break;
                case WorldMaterialKind.Quicksand:
                    Set(m, "_ShallowColor", new Color(0.84f, 0.69f, 0.48f, 1f));
                    Set(m, "_DeepColor", new Color(0.52f, 0.38f, 0.25f, 1f));
                    Set(m, "_FoamColor", new Color(0.93f, 0.83f, 0.64f, 1f));
                    Set(m, "_Alpha", 1f);
                    Set(m, "_WaveScale", 1.1f);
                    Set(m, "_WaveSpeed", 0.25f);
                    Set(m, "_WaveHeight", 0f);
                    Set(m, "_FoamAmount", 0.5f);
                    Set(m, "_Gloss", 0.08f);
                    Set(m, "_Swirl", 1f);
                    Set(m, "_SwirlSpeed", 0.5f);
                    Set(m, "_EdgeSoft", 0.2f);
                    break;
            }
        }

        static void Set(Material m, string prop, Color c)
        {
            if (m.HasProperty(prop)) m.SetColor(prop, c);
        }

        static void Set(Material m, string prop, float v)
        {
            if (m.HasProperty(prop)) m.SetFloat(prop, v);
        }

        static Mesh disc, quad;

        /// <summary>贴地圆片（半径 1，XZ 平面，朝上；uv 从圆心 0.5 往外到边 0/1，冰斑软边用）</summary>
        public static Mesh Disc()
        {
            if (disc) return disc;
            const int seg = 32;
            var v = new Vector3[seg + 1];
            var uv = new Vector2[seg + 1];
            var n = new Vector3[seg + 1];
            var tri = new int[seg * 3];
            v[0] = Vector3.zero;
            uv[0] = new Vector2(0.5f, 0.5f);
            n[0] = Vector3.up;
            for (int i = 0; i < seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                v[i + 1] = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                uv[i + 1] = new Vector2(0.5f + 0.5f * Mathf.Cos(a), 0.5f + 0.5f * Mathf.Sin(a));
                n[i + 1] = Vector3.up;
                tri[i * 3] = 0;
                tri[i * 3 + 1] = (i + 1) % seg + 1;
                tri[i * 3 + 2] = i + 1;
            }
            disc = new Mesh { name = "WorldDisc", hideFlags = HideFlags.DontSave, vertices = v, uv = uv, normals = n, triangles = tri };
            disc.RecalculateBounds();
            return disc;
        }

        /// <summary>朝上的单位方片（XZ 平面，中心在原点，边长 1）</summary>
        public static Mesh Quad()
        {
            if (quad) return quad;
            quad = new Mesh
            {
                name = "WorldQuad", hideFlags = HideFlags.DontSave,
                vertices = new[] { new Vector3(-0.5f, 0, -0.5f), new Vector3(0.5f, 0, -0.5f), new Vector3(0.5f, 0, 0.5f), new Vector3(-0.5f, 0, 0.5f) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                normals = new[] { Vector3.up, Vector3.up, Vector3.up, Vector3.up },
                triangles = new[] { 0, 2, 1, 0, 3, 2 },
            };
            quad.RecalculateBounds();
            return quad;
        }

        /// <summary>一块贴地的表面（圆片或方片）挂到 parent 下，用这种材质</summary>
        public static MeshRenderer Surface(Transform parent, WorldMaterialKind k, bool round, string name)
        {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(parent, false);
            go.GetComponent<MeshFilter>().sharedMesh = round ? Disc() : Quad();
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = Get(k);
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return r;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Array.Clear(cache, 0, cache.Length);
    }

    /// <summary>
    /// 地表牵引区（docs/unity-parity.md L8：冰面 / 冻地；冰斑、冻带复用同一个组件）：
    ///   · 玩家站在上面（贴地、脚在顶面附近）：地面加速、刹车都变慢（运动修饰器改 MotorFrame 的地面牵引）——起步拖、急停滑、冲刺余速滑得更远；
    ///   · 敌人站在上面：NavMeshAgent 的加速度乘 enemyAccel（转向、停下都慢），急转时按概率滑倒（眩晕 0.6 s + 顺着惯性滑出去 + 「滑倒」字），首领不滑倒；
    ///   · 限时（<see cref="lifetime"/> &gt; 0）：最后 <see cref="fadeTime"/> 秒牵引与贴图一起淡出，到点销毁（敌人留下的冰斑 / 冻带用
    ///     <see cref="SpawnPatch"/> / <see cref="SpawnStrip"/>）。
    /// 形状：Box = 挂件自己的单位立方体（白盒条带直接挂）；Disc = 圆。重叠时取最滑的那块。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SurfaceZone : MonoBehaviour
    {
        public SurfaceProfile profile = SurfaceProfile.Ice;
        public ZoneArea area = ZoneArea.Box();
        /// <summary>存在多久（秒）；≤ 0 = 一直在</summary>
        public float lifetime;
        public float fadeTime = 0.6f;
        /// <summary>淡出时一起调透明的表面（运行时冰斑的贴片；白盒条带不用）</summary>
        public Renderer fadeRenderer;

        const float EnemyInterval = 0.1f, StumbleCooldown = 3f, StumbleStun = 0.6f;
        static readonly Color IceColor = new(0.78f, 0.93f, 1f);
        static readonly int FadeId = Shader.PropertyToID("_Fade"), EdgeSoftId = Shader.PropertyToID("_EdgeSoft");

        static readonly List<SurfaceZone> all = new();
        static readonly MotorHook hook = new(m => new Traction(m));
        static int tickFrame = -1;
        static float enemyTimer;
        static MaterialPropertyBlock block;

        sealed class EnemyState
        {
            public float baseAccel, nextStumble;
            public bool on;
        }

        static readonly Dictionary<EnemyAI, EnemyState> enemies = new();
        static readonly List<EnemyAI> drop = new();

        /// <summary>现在场上的全部牵引区</summary>
        public static IReadOnlyList<SurfaceZone> All => all;
        /// <summary>玩家上一帧站在哪种地表上（没有 = Normal；测试 / HUD 用）</summary>
        public static SurfaceProfile PlayerSurface { get; private set; } = SurfaceProfile.Normal;
        /// <summary>玩家上一帧在打滑的地表上</summary>
        public static bool PlayerOnSurface { get; private set; }
        /// <summary>本关敌人滑倒的次数（测试用）</summary>
        public static int Stumbles { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            hook.Release();
            enemies.Clear();
            tickFrame = -1;
            PlayerSurface = SurfaceProfile.Normal;
            PlayerOnSurface = false;
            Stumbles = 0;
        }

        float age;

        /// <summary>当前强度 0..1（限时区域最后 fadeTime 秒淡出）</summary>
        public float Strength => lifetime > 0 && fadeTime > 0 ? Mathf.Clamp01((lifetime - age) / fadeTime) : 1;

        public bool Contains(Vector3 feet) => area.Contains(transform, feet);

        /// <summary>脚下最滑的地表（按强度插值过）；不在任何区域里返回 false 与 Normal</summary>
        public static bool Sample(Vector3 feet, out SurfaceProfile p)
        {
            p = SurfaceProfile.Normal;
            bool any = false;
            for (int i = 0; i < all.Count; i++)
            {
                var z = all[i];
                if (!z || !z.Contains(feet)) continue;
                var s = z.profile.Scaled(z.Strength);
                if (!any || s.accel * s.friction < p.accel * p.friction) p = s;
                any = true;
            }
            return any;
        }

        /// <summary>按地表改一帧的运动参数（玩家修饰器与测试的模拟共用）</summary>
        public static void Apply(ref MotorFrame f, in SurfaceProfile p)
        {
            f.groundAccelMult = MotorFrame.Traction(f.groundAccelMult) * p.accel;
            f.groundFrictionMult = MotorFrame.Traction(f.groundFrictionMult) * p.friction;
        }

        /// <summary>玩家的牵引修饰器：只在站在地上时生效（空中手感不变）</summary>
        sealed class Traction : IMotorModifier
        {
            readonly PlayerMotor motor;
            public Traction(PlayerMotor m) => motor = m;

            public void Modify(ref MotorFrame f)
            {
                if (motor && f.grounded && Sample(motor.transform.position, out var p))
                {
                    PlayerOnSurface = true;
                    PlayerSurface = p;
                    Apply(ref f, p);
                    return;
                }
                PlayerOnSurface = false;
                PlayerSurface = SurfaceProfile.Normal;
            }
        }

        // ───────────── 生成 ─────────────

        /// <summary>地上一块圆形冰斑（旋龟的滑冰带）：radius 米，seconds 秒后化掉</summary>
        public static SurfaceZone SpawnPatch(Vector3 ground, float radius, float seconds, SurfaceProfile? profile = null)
        {
            var go = new GameObject("Ice Patch");
            go.transform.position = ground;
            var z = go.AddComponent<SurfaceZone>();
            z.profile = profile ?? SurfaceProfile.Frost;
            z.area = ZoneArea.Disc(radius);
            z.lifetime = seconds;
            var r = WorldMaterials.Surface(go.transform, WorldMaterialKind.Ice, true, "Ice Surface");
            r.transform.localPosition = Vector3.up * 0.03f;
            r.transform.localScale = new Vector3(radius, 1, radius);
            block ??= new MaterialPropertyBlock();
            block.Clear();
            block.SetFloat(EdgeSoftId, 0.3f);
            block.SetFloat(FadeId, 0);
            r.SetPropertyBlock(block);
            z.fadeRenderer = r;
            Fx.Burst(ground + Vector3.up * 0.1f, IceColor, 8, 2, 0.45f, 0.14f * radius, 6);
            return z;
        }

        /// <summary>a → b（地面点）一条半宽 halfWidth 的冻带（夫诸的冰光扫过的地面），seconds 秒后化掉</summary>
        public static SurfaceZone SpawnStrip(Vector3 a, Vector3 b, float halfWidth, float seconds, SurfaceProfile? profile = null)
        {
            var d = b - a;
            d.y = 0;
            float len = Mathf.Max(0.5f, d.magnitude);
            var go = new GameObject("Frozen Strip");
            go.transform.SetPositionAndRotation((a + b) * 0.5f - Vector3.up * 0.05f, Quaternion.LookRotation(d.sqrMagnitude > 1e-6f ? d : Vector3.forward));
            go.transform.localScale = new Vector3(halfWidth * 2, 0.1f, len);
            var z = go.AddComponent<SurfaceZone>();
            z.profile = profile ?? SurfaceProfile.Frost;
            z.area = ZoneArea.Box();
            z.lifetime = seconds;
            var r = WorldMaterials.Surface(go.transform, WorldMaterialKind.Ice, false, "Ice Surface");
            r.transform.localPosition = new Vector3(0, 0.5f + 0.3f, 0); // 顶面上 3 cm（父物体高 0.1 m）
            z.fadeRenderer = r;
            return z;
        }

        // ───────────── 生命周期 ─────────────

        void OnEnable()
        {
            all.Add(this);
            hook.Ensure();
        }

        void OnDisable()
        {
            all.Remove(this);
            if (all.Count == 0)
            {
                hook.Release();
                RestoreAll();
                PlayerOnSurface = false;
                PlayerSurface = SurfaceProfile.Normal;
            }
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (fadeRenderer)
            {
                block ??= new MaterialPropertyBlock();
                fadeRenderer.GetPropertyBlock(block);
                block.SetFloat(FadeId, Strength * Mathf.Clamp01(age / 0.15f));
                fadeRenderer.SetPropertyBlock(block);
            }
            if (lifetime > 0 && age >= lifetime)
            {
                Destroy(gameObject);
                return;
            }
            if (tickFrame == Time.frameCount) return;
            tickFrame = Time.frameCount;
            hook.Ensure();
            enemyTimer -= dt;
            if (enemyTimer <= 0)
            {
                enemyTimer = EnemyInterval;
                TickEnemies();
            }
        }

        // ───────────── 敌人 ─────────────

        static void TickEnemies()
        {
            drop.Clear();
            foreach (var kv in enemies)
                if (!kv.Key || kv.Key.Dead)
                    drop.Add(kv.Key);
            foreach (var e in drop) enemies.Remove(e);

            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
            {
                var ai = live[i];
                if (!ai || ai.Dead) continue;
                var agent = ai.GetComponent<NavMeshAgent>();
                if (!agent || !agent.enabled) continue;
                bool on = Sample(ai.transform.position, out var p);
                enemies.TryGetValue(ai, out var st);
                if (!on)
                {
                    if (st != null && st.on)
                    {
                        agent.acceleration = st.baseAccel;
                        st.on = false;
                    }
                    continue;
                }
                if (st == null)
                {
                    st = new EnemyState();
                    enemies[ai] = st;
                }
                if (!st.on)
                {
                    st.baseAccel = agent.acceleration;
                    st.on = true;
                }
                agent.acceleration = st.baseAccel * Mathf.Max(0.05f, p.enemyAccel);
                TryStumble(ai, agent, st, p);
            }
        }

        /// <summary>急转打滑：实际速度与想去的方向差 60° 以上、速度够快、冷却过了，按概率滑倒</summary>
        static void TryStumble(EnemyAI ai, NavMeshAgent agent, EnemyState st, in SurfaceProfile p)
        {
            if (p.stumble <= 0 || Time.time < st.nextStumble || !agent.isOnNavMesh || !agent.updatePosition) return;
            if (ai.Health && ai.Health.IsBoss) return;
            var v = agent.velocity;
            v.y = 0;
            var want = agent.desiredVelocity;
            want.y = 0;
            if (v.sqrMagnitude < 2.5f * 2.5f || want.sqrMagnitude < 0.25f) return;
            if (Vector3.Dot(v.normalized, want.normalized) > 0.5f) return;
            st.nextStumble = Time.time + StumbleCooldown;
            if (UnityEngine.Random.value > p.stumble) return;
            Stumble(ai, v);
        }

        /// <summary>滑倒：眩晕 0.6 s（打断招式）+ 顺着惯性滑出去 + 碎冰 + 「滑倒」</summary>
        public static void Stumble(EnemyAI ai, Vector3 velocity)
        {
            if (!ai || ai.Dead) return;
            Stumbles++;
            if (ai.Health && !EnemyStatus.StunImmune(ai.Health)) EnemyStatus.Stun(ai.Health, StumbleStun);
            velocity.y = 0;
            ai.Knockback(velocity * 0.8f);
            var at = ai.transform.position;
            Fx.Burst(at + Vector3.up * 0.2f, IceColor, 10, 3.5f, 0.5f, 0.1f, 9);
            GameUI.FloatText(at + Vector3.up * 1.6f, "滑倒", IceColor, 0.9f);
        }

        static void RestoreAll()
        {
            foreach (var kv in enemies)
            {
                if (!kv.Key || !kv.Value.on) continue;
                var agent = kv.Key.GetComponent<NavMeshAgent>();
                if (agent) agent.acceleration = kv.Value.baseAccel;
            }
            enemies.Clear();
        }
    }
}
