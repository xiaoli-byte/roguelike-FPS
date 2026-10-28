using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 水体（docs/unity-parity.md L8：风格化水面 + 涉水减速）。形状是挂件 Transform 的单位立方体：顶面 = 水面，脚低于水面多少就是涉水深度。
    ///   · 涉水：深度从 <see cref="shallow"/> 到 <see cref="deep"/>，走路速度从 ×1 降到 ×<see cref="wadeSlow"/>（运动修饰器）；进水溅一下，走动时脚边一圈圈涟漪；
    ///   · 深水（深度 ≥ <see cref="deep"/>，且 <see cref="deepIsHazard"/>）：没有游泳，按坠落处理——扣 <see cref="drownBurst"/>、托回安全落脚点；
    ///     深水区不记安全落脚点（<see cref="SafeGround.RegisterHazard"/>）。Three.js 版深水直接走不进去，这里换成可以跳进去、代价是托回；
    ///   · 敌人：同样按深度减速（<see cref="EnemyBuffs"/> 的 world.water 通道）。
    /// 视觉：挂件自己的渲染器（白盒条带）或 <see cref="Create"/> 放的一块水面片，材质 Spiritfire/Water（随全局 _WindDir 起涟漪）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WaterVolume : MonoBehaviour
    {
        /// <summary>从多深开始减速 / 多深算深水（米）</summary>
        public float shallow = 0.15f, deep = 1.3f;
        /// <summary>深水前（深度 = deep）的走路速度倍率</summary>
        public float wadeSlow = 0.55f;
        public bool deepIsHazard = true;
        public float drownBurst = 0.05f;

        public const string BuffChannel = "world.water";
        const float EnemyInterval = 0.1f;
        static readonly Color SplashColor = new(0.82f, 0.93f, 1f);

        static readonly List<WaterVolume> all = new();
        static readonly MotorHook hook = new(m => new Wade(m));
        static readonly object buffSource = new();
        static IDisposable hazard;
        static int tickFrame = -1;
        static float enemyTimer, nextRipple;
        static bool wasInWater;

        public static IReadOnlyList<WaterVolume> All => all;
        /// <summary>玩家脚下的涉水深度（米，不在水里为 0）</summary>
        public static float PlayerDepth { get; private set; }
        /// <summary>玩家掉进深水被托回的次数（测试用）</summary>
        public static int Drowned { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            hook.Release();
            hazard = null;
            tickFrame = -1;
            PlayerDepth = 0;
            Drowned = 0;
            wasInWater = false;
        }

        /// <summary>水面高度（世界 y）</summary>
        public float Surface => transform.TransformPoint(0, 0.5f, 0).y;

        /// <summary>脚在这片水里的深度（米）；水平不在范围里、或脚在水面之上为 0</summary>
        public float DepthAt(Vector3 feet)
        {
            var l = transform.InverseTransformPoint(feet);
            if (Mathf.Abs(l.x) > 0.5f || Mathf.Abs(l.z) > 0.5f || l.y < -0.5f - 1e-3f) return 0;
            return Mathf.Max(0, Surface - feet.y);
        }

        /// <summary>某深度的走路速度倍率</summary>
        public float SlowAt(float depth)
        {
            if (depth <= shallow) return 1;
            float t = Mathf.Clamp01((depth - shallow) / Mathf.Max(0.01f, deep - shallow));
            return Mathf.Lerp(1, wadeSlow, t * t * (3 - 2 * t));
        }

        /// <summary>脚下最深的水（没有返回 null，depth = 0）</summary>
        public static WaterVolume At(Vector3 feet, out float depth)
        {
            WaterVolume best = null;
            depth = 0;
            for (int i = 0; i < all.Count; i++)
            {
                var w = all[i];
                if (!w) continue;
                float d = w.DepthAt(feet);
                if (d > depth)
                {
                    depth = d;
                    best = w;
                }
            }
            return best;
        }

        /// <summary>某点在水里（深度 &gt; 0）</summary>
        public static bool InWater(Vector3 feet) => At(feet, out _) != null;

        sealed class Wade : IMotorModifier
        {
            readonly PlayerMotor motor;
            public Wade(PlayerMotor m) => motor = m;

            public void Modify(ref MotorFrame f)
            {
                if (!motor) return;
                var w = At(motor.transform.position, out float d);
                if (w) f.speedMult *= w.SlowAt(d);
            }
        }

        // ───────────── 生成 ─────────────

        /// <summary>
        /// 运行时放一片水：水底中心 ground，水平 size.x × size.z，水深 size.y（水面 = ground.y + size.y），带一块水面片
        /// </summary>
        public static WaterVolume Create(Vector3 ground, Vector3 size, float yaw = 0, Transform parent = null)
        {
            var go = new GameObject("Water");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(ground + Vector3.up * (size.y * 0.5f), Quaternion.Euler(0, yaw, 0));
            go.transform.localScale = size;
            var w = go.AddComponent<WaterVolume>();
            var r = WorldMaterials.Surface(go.transform, WorldMaterialKind.Water, false, "Water Surface");
            r.transform.localPosition = new Vector3(0, 0.5f, 0);
            return w;
        }

        // ───────────── 生命周期 ─────────────

        void OnEnable()
        {
            all.Add(this);
            hook.Ensure();
            hazard ??= SafeGround.RegisterHazard(feet =>
            {
                var w = At(feet, out float d);
                return w && w.deepIsHazard && d >= w.deep - 0.2f;
            });
        }

        void OnDisable()
        {
            all.Remove(this);
            if (all.Count > 0) return;
            hook.Release();
            hazard?.Dispose();
            hazard = null;
            PlayerDepth = 0;
        }

        void Update()
        {
            if (tickFrame == Time.frameCount) return;
            tickFrame = Time.frameCount;
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            hook.Ensure();
            TickPlayer();
            enemyTimer -= dt;
            if (enemyTimer <= 0)
            {
                enemyTimer = EnemyInterval;
                TickEnemies();
            }
        }

        static void TickPlayer()
        {
            var motor = hook.Motor;
            var vitals = PlayerVitals.Instance;
            if (!motor || !vitals || vitals.Dead)
            {
                PlayerDepth = 0;
                wasInWater = false;
                return;
            }
            var feet = motor.transform.position;
            var w = At(feet, out float d);
            PlayerDepth = d;
            bool inWater = w && d > 0.02f;
            if (inWater && !wasInWater)
            {
                // 进水：溅一下（下落越快溅得越高）
                float fall = Mathf.Max(0, -motor.Velocity.y);
                var at = new Vector3(feet.x, w.Surface, feet.z);
                Fx.Burst(at, SplashColor, 10 + (int)Mathf.Min(14, fall * 2), 2.5f + fall * 0.3f, 0.55f, 0.12f, 9);
                // 水面荡开两道涟漪（Spiritfire/Water 画），不再用贴地环
                EnvWater.Ripple(at, 1.6f + Mathf.Min(2f, fall * 0.15f), 0.8f);
                EnvWater.Ripple(at, 2.6f + Mathf.Min(3f, fall * 0.2f), 0.45f, 2.2f);
            }
            wasInWater = inWater;
            if (inWater && Time.time >= nextRipple && MotorCore.Flat(motor.Velocity).sqrMagnitude > 1f)
            {
                nextRipple = Time.time + 0.35f;
                // 涉水：脚边一圈圈涟漪
                EnvWater.Ripple(new Vector3(feet.x, w.Surface, feet.z), 1.3f, 0.55f);
            }
            var safe = SafeGround.Instance;
            if (inWater && w.deepIsHazard && d >= w.deep && safe && !safe.Sinking)
            {
                Drowned++;
                safe.Recover(Drown(w.drownBurst));
            }
        }

        /// <summary>掉进深水：扣 burst，蓝色闪屏，托回后 1 s 无敌</summary>
        static HazardSpec Drown(float burst) => new()
        {
            burst = burst, tick = 0, tickTimes = Array.Empty<float>(), sinkTime = 0, grace = 1f, element = Element.None,
            flash = new Color(0.2f, 0.45f, 0.7f, 0.55f), sound = "land",
        };

        static void TickEnemies()
        {
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
            {
                var ai = live[i];
                if (!ai || ai.Dead) continue;
                var agent = ai.GetComponent<NavMeshAgent>();
                if (!agent || !agent.enabled) continue;
                var w = At(ai.transform.position, out float d);
                if (!w) continue;
                float slow = w.SlowAt(d);
                if (slow < 0.999f) ai.Buffs.Set(BuffChannel, buffSource, new BuffMods(1, 1, slow, 1), 0.3f);
            }
        }
    }
}
