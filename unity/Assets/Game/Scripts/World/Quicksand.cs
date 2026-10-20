using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 流沙（docs/unity-parity.md L8；unity-maps-v1 1-2「屋脊之海」、第 4 节「流沙：地表下陷 + 拖拽力场」）：圆形，半径 <see cref="radius"/>，中心 <see cref="coreRadius"/> 是吞人的芯。
    ///   · 拉力：脚踩进去就被往圆心拖，越近越强（边上 <see cref="pullEdge"/> → 圆心 <see cref="pullCore"/> m/s，直接移动角色控制器）；
    ///   · 陷足：走路速度越往里越慢（边上 ×<see cref="slowEdge"/> → 芯里 ×<see cref="slowCore"/>），芯里跳不起来——走是走不出芯的（2.2 m/s 对 4.5 m/s 拉力），
    ///     只能冲刺（22 m/s × 0.18 s ≈ 4 m）脱身：代价是一格冲刺和好几秒的走位；
    ///   · 预警：在芯里「下沉度」按 <see cref="sinkTime"/> 秒涨满（离开芯慢慢回落），涨的时候屏幕边缘收紧、脚下翻沙、提示「冲刺脱身」；
    ///     涨满就被吞：扣 <see cref="burst"/> 最大生命，沉 0.6 s 后托回安全落脚点（<see cref="SafeGround.Sink"/>）；
    ///   · 敌人：同样被拖向圆心、移速变慢（走 <see cref="EnemyBuffs"/> 的 world.quicksand 通道），不会被吞；
    ///   · 圈里不记安全落脚点（<see cref="SafeGround.RegisterHazard"/>），托回不会落进流沙。
    /// 视觉：贴地的流沙面（Spiritfire/Water 的旋涡模式，沙色、不透明），地表下陷由关卡的地形给。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Quicksand : MonoBehaviour
    {
        public float radius = 6f, coreRadius = 2.2f;
        /// <summary>拉力（m/s）：边上 → 圆心</summary>
        public float pullEdge = 1.2f, pullCore = 4.5f;
        /// <summary>走路速度倍率：边上 → 芯里</summary>
        public float slowEdge = 0.7f, slowCore = 0.3f;
        /// <summary>在芯里待多久被吞（秒）</summary>
        public float sinkTime = 2.2f;
        /// <summary>被吞时扣最大生命的比例</summary>
        public float burst = 0.08f;
        /// <summary>脚离沙面多高 / 多低还算陷在里面</summary>
        public float above = 0.8f, below = 1.5f;
        /// <summary>放一块贴地的流沙面（关卡已经有自己的视觉时关掉）</summary>
        public bool surface = true;

        public const string BuffChannel = "world.quicksand";
        const float EnemyInterval = 0.1f;
        static readonly Color SandColor = new(0.86f, 0.72f, 0.5f);
        static readonly int SwirlCenterId = Shader.PropertyToID("_SwirlCenter");

        static readonly List<Quicksand> all = new();
        static readonly MotorHook hook = new(m => new Bog(m));
        static readonly object buffSource = new();
        static IDisposable hazard;
        static int tickFrame = -1;
        static float enemyTimer, warnedAt = -10, nextPuff;
        static bool vignette;

        /// <summary>现在场上的全部流沙</summary>
        public static IReadOnlyList<Quicksand> All => all;
        /// <summary>玩家的下沉度 0..1（涨满被吞）</summary>
        public static float PlayerSink { get; private set; }
        /// <summary>玩家这一帧踩在流沙里</summary>
        public static bool PlayerInside { get; private set; }
        /// <summary>玩家被吞的次数（测试用）</summary>
        public static int Swallowed { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            hook.Release();
            hazard = null;
            tickFrame = -1;
            PlayerSink = 0;
            PlayerInside = false;
            Swallowed = 0;
            vignette = false;
        }

        /// <summary>水平离圆心多远的比例 0..1（圆外 &gt; 1）与竖直是否在沙面附近</summary>
        public float Depth01(Vector3 feet, out bool vertical)
        {
            var c = transform.position;
            vertical = feet.y <= c.y + above && feet.y >= c.y - below;
            return new Vector2(feet.x - c.x, feet.z - c.z).magnitude / Mathf.Max(0.01f, radius);
        }

        public bool Contains(Vector3 feet) => Depth01(feet, out bool v) <= 1 && v;

        /// <summary>在芯里（会下沉）</summary>
        public bool InCore(Vector3 feet) => Depth01(feet, out bool v) * radius <= coreRadius && v;

        /// <summary>离圆心 r 处的拉力（m/s）：边上 pullEdge，越往里越强，圆心 pullCore</summary>
        public float PullAt(float r01) => r01 > 1 ? 0 : Mathf.Lerp(pullCore, pullEdge, Mathf.Clamp01(r01));

        /// <summary>离圆心 r 处的走路速度倍率</summary>
        public float SlowAt(float r01) => r01 > 1 ? 1 : Mathf.Lerp(slowCore, slowEdge, Mathf.Clamp01((r01 * radius - coreRadius) / Mathf.Max(0.01f, radius - coreRadius)));

        /// <summary>脚下的流沙（最深的那个）；没有返回 null</summary>
        public static Quicksand At(Vector3 feet, out float r01)
        {
            Quicksand best = null;
            r01 = float.MaxValue;
            for (int i = 0; i < all.Count; i++)
            {
                var q = all[i];
                if (!q) continue;
                float d = q.Depth01(feet, out bool v);
                if (!v || d > 1 || d >= r01) continue;
                r01 = d;
                best = q;
            }
            return best;
        }

        /// <summary>玩家：陷足减速，芯里锁跳</summary>
        sealed class Bog : IMotorModifier
        {
            readonly PlayerMotor motor;
            public Bog(PlayerMotor m) => motor = m;

            public void Modify(ref MotorFrame f)
            {
                if (!motor) return;
                var q = At(motor.transform.position, out float r01);
                if (!q) return;
                f.speedMult *= q.SlowAt(r01);
                if (r01 * q.radius <= q.coreRadius) f.locks |= MotorLock.Jump;
            }
        }

        // ───────────── 生成 ─────────────

        /// <summary>运行时放一片流沙（关卡构建器走 LevelKit.QuicksandPit）</summary>
        public static Quicksand Create(Vector3 ground, float radius, Transform parent = null)
        {
            var go = new GameObject("Quicksand");
            go.transform.SetParent(parent, false);
            go.transform.position = ground;
            var q = go.AddComponent<Quicksand>();
            q.radius = radius;
            q.coreRadius = Mathf.Min(q.coreRadius, radius * 0.4f);
            return q;
        }

        // ───────────── 生命周期 ─────────────

        void Start()
        {
            if (!surface) return;
            var r = WorldMaterials.Surface(transform, WorldMaterialKind.Quicksand, true, "Quicksand Surface");
            r.transform.localPosition = Vector3.up * 0.02f;
            r.transform.localScale = new Vector3(radius, 1, radius);
            var block = new MaterialPropertyBlock();
            block.SetVector(SwirlCenterId, new Vector4(transform.position.x, transform.position.z, coreRadius, radius));
            r.SetPropertyBlock(block);
        }

        void OnEnable()
        {
            all.Add(this);
            hook.Ensure();
            hazard ??= SafeGround.RegisterHazard(feet => At(feet, out _) != null);
        }

        void OnDisable()
        {
            all.Remove(this);
            if (all.Count > 0) return;
            hook.Release();
            hazard?.Dispose();
            hazard = null;
            PlayerSink = 0;
            PlayerInside = false;
            if (vignette) GameUI.SetVignetteBoost(0);
            vignette = false;
        }

        void Update()
        {
            if (tickFrame == Time.frameCount) return;
            tickFrame = Time.frameCount;
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            hook.Ensure();
            TickPlayer(dt);
            enemyTimer -= dt;
            if (enemyTimer <= 0)
            {
                enemyTimer = EnemyInterval;
                TickEnemies();
            }
        }

        // ───────────── 玩家 ─────────────

        static void TickPlayer(float dt)
        {
            var motor = hook.Motor;
            var vitals = PlayerVitals.Instance;
            var safe = SafeGround.Instance;
            if (!motor || !vitals || vitals.Dead || (safe && safe.Sinking))
            {
                PlayerInside = false;
                PlayerSink = Mathf.MoveTowards(PlayerSink, 0, dt);
                Vignette(PlayerSink);
                return;
            }
            var feet = motor.transform.position;
            var q = At(feet, out float r01);
            PlayerInside = q;
            if (!q)
            {
                PlayerSink = Mathf.MoveTowards(PlayerSink, 0, dt * 0.8f);
                Vignette(PlayerSink);
                return;
            }

            // 拉力：往圆心拖（贴地时带一点向下，不被拖得离地）
            var c = q.transform.position;
            var to = new Vector3(c.x - feet.x, 0, c.z - feet.z);
            float dist = to.magnitude;
            var cc = motor.GetComponent<CharacterController>();
            if (cc && cc.enabled && dist > 0.05f)
            {
                float step = Mathf.Min(dist, q.PullAt(r01) * dt);
                cc.Move(to / dist * step + (motor.OnWalkableGround ? Vector3.down * step : Vector3.zero));
            }

            // 下沉：芯里涨，芯外回落
            bool core = r01 * q.radius <= q.coreRadius;
            PlayerSink = core ? PlayerSink + dt / Mathf.Max(0.2f, q.sinkTime) : Mathf.Max(0, PlayerSink - dt * 0.8f);
            Vignette(PlayerSink);
            if (core)
            {
                if (Time.time - warnedAt > 4f)
                {
                    warnedAt = Time.time;
                    GameUI.Toast("流沙！冲刺脱身", SandColor, 1.8f);
                }
                if (Time.time >= nextPuff)
                {
                    nextPuff = Time.time + 0.25f;
                    Fx.Burst(feet + Vector3.up * 0.15f, SandColor, 6, 2.2f, 0.5f, 0.22f, 4);
                    CameraShake.Add(0.08f + 0.12f * PlayerSink, 0.15f);
                }
            }
            if (PlayerSink >= 1)
            {
                PlayerSink = 0;
                Swallowed++;
                Vignette(0);
                if (safe) safe.Sink(Swallow(q.burst));
            }
        }

        static void Vignette(float k)
        {
            if (k <= 0.001f && !vignette) return;
            vignette = k > 0.001f;
            GameUI.SetVignetteBoost(Mathf.Clamp01(k) * 0.8f);
        }

        /// <summary>被吞：扣 burst，沉 0.6 s，托回后 1 s 无敌</summary>
        static HazardSpec Swallow(float burst) => new()
        {
            burst = burst, tick = 0, tickTimes = Array.Empty<float>(), sinkTime = 0.6f, grace = 1f, element = Element.None,
            flash = new Color(0.62f, 0.46f, 0.28f, 0.6f), sound = "land",
        };

        // ───────────── 敌人 ─────────────

        static void TickEnemies()
        {
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
            {
                var ai = live[i];
                if (!ai || ai.Dead) continue;
                var agent = ai.GetComponent<NavMeshAgent>();
                if (!agent || !agent.enabled) continue;
                var q = At(ai.transform.position, out float r01);
                if (!q) continue;
                // 移速：限时 0.3 s，每 0.1 s 续一次——离开流沙自然撤掉
                float slow = q.SlowAt(r01);
                ai.Buffs.Set(BuffChannel, buffSource, new BuffMods(1, 1, slow, 1), 0.3f);
                // 拉力：击退推力按 8/s 衰减，每 0.1 s 给 0.8 × 拉力 的冲量 ≈ 以拉力的速度漂向圆心
                var c = q.transform.position;
                var to = new Vector3(c.x - ai.transform.position.x, 0, c.z - ai.transform.position.z);
                if (to.sqrMagnitude > 0.04f) ai.Knockback(to.normalized * (q.PullAt(r01) * 0.8f));
            }
        }
    }
}
