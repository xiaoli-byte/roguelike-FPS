using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 3-3 铸范大坊的风闸（docs/level-design/maps/3-3.md 第 5 节；V2 鼓风正殿「拉开风闸后风箱鼓起来，炉门大开，殿里换了一批守军」）。
    /// L6 的通用开关（Activator）还没做，这是 3-3 自己的小件：风闸台上一根链柱 + 拉杆（按 F 拉开），拉开后鼓风正殿换一番光景——
    ///   · 两台巨型风箱从瘪着（<see cref="bellowsRest"/>，2.8 m 的掩体）鼓起来，按 <see cref="pumpPeriod"/> 一起一伏地鼓风；
    ///   · 大炉炉门的火光从暗到亮，炉口一阵阵喷火星；
    ///   · 炉门周期性喷火：南北两条风箱道轮流先亮一条预警（<see cref="jetWarn"/> 秒），再沿道落下一串地火（<see cref="FloorFire"/>，祸斗会来吃）；
    ///     第二次进殿的那一场（<see cref="secondVisit"/>）肃清后喷火停下，风箱照旧鼓着；
    ///   · 炉闸开大：全图的熔铜渠开始涨落（<see cref="tides"/> 的自动涨落打开，只在渠里涨，不漫上铸床）；
    ///   · 第二次进殿的场地（<see cref="secondVisit"/>，开局 autoTrigger 关着）这时才会被触发。
    /// 风闸要等第一次进殿的那一场（<see cref="firstVisit"/>）肃清才拉得动（之前提示「先肃清鼓风正殿」），拉开后不能再关。
    /// 拉杆：关卡给了 Model 子物体就转它，否则运行时用两根圆柱拼一根（4.11 占位）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FoundryWindGate : MonoBehaviour, IInteractable
    {
        public enum State { Locked, Ready, Pulled }

        [Header("两次进殿")]
        [Tooltip("第一次进殿（肃清后风闸才拉得动）")] public EncounterSite firstVisit;
        [Tooltip("第二次进殿（拉开风闸后才会触发）")] public EncounterSite secondVisit;

        [Header("风箱")]
        [Tooltip("风箱的根节点（底面在地上，按 Y 缩放）")] public Transform[] bellows = Array.Empty<Transform>();
        public float bellowsRest = 0.56f, bellowsLow = 0.86f, bellowsHigh = 1f, pumpPeriod = 2.6f;

        [Header("拉杆 / 炉门")]
        [Tooltip("拉杆的转轴（绕本地 X 从 −35° 拉到 +55°）")] public Transform lever;
        [Tooltip("大炉炉口（火星、火光）")] public Transform furnaceMouth;
        public Light[] furnaceLights = Array.Empty<Light>();
        public float lightLow = 0.4f, lightHigh = 7f;

        [Header("熔铜渠")]
        [Tooltip("拉开风闸后开始自动涨落的熔岩（全图的铸渠段）")] public LavaVolume[] tides = Array.Empty<LavaVolume>();

        [Header("炉门喷火（风箱道）")]
        [Tooltip("每条风箱道的起点 / 终点（世界坐标，地面）；两个数组一一对应")] public Vector3[] laneFrom = Array.Empty<Vector3>();
        public Vector3[] laneTo = Array.Empty<Vector3>();
        public float jetEvery = 3.6f, jetWarn = 0.9f, jetRadius = 2.2f, jetDuration = 4f;
        [Tooltip("每跳伤害（难度 1，× (1 + (难度 − 1) × 0.55)）、跳间隔")] public float jetTick = 5f, jetTickInterval = 0.5f;
        public int jetSpots = 5;
        [Tooltip("玩家离第二次进殿的场地中心多远以内才喷（米）")] public float jetRange = 70f;

        public static readonly Color FireTint = new(1f, 0.48f, 0.15f);

        public State Phase { get; private set; }
        /// <summary>喷过几轮火、落过几片地火（测试用）</summary>
        public int JetsFired { get; private set; }
        public int FiresSpawned { get; private set; }
        /// <summary>当前风箱的高度倍率（测试用）</summary>
        public float BellowsScale { get; private set; }
        public float PulledAt { get; private set; } = -1;

        public event Action<FoundryWindGate> Pulled;

        static readonly List<FoundryWindGate> all = new();
        /// <summary>场上的风闸</summary>
        public static IReadOnlyList<FoundryWindGate> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        float leverAngle = -35f, emberAcc, nextJetAt = -1, jetFireAt = -1, lockHintAt;
        int nextLane, pendingLane = -1;
        bool jetsDone;

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
            Interaction.Add(this);
        }

        void OnDisable()
        {
            all.Remove(this);
            Interaction.Remove(this);
        }

        void Start()
        {
            if (secondVisit) secondVisit.autoTrigger = false;
            BuildLeverIfMissing();
            Phase = Unlocked ? State.Ready : State.Locked;
            BellowsScale = bellowsRest;
            ApplyBellows();
            foreach (var l in furnaceLights)
                if (l)
                    l.intensity = lightLow;
        }

        bool Unlocked => !firstVisit || firstVisit.phase == EncounterSite.Phase.Cleared;

        /// <summary>关卡没给拉杆模型时：转轴下拼一根铁杆 + 杆头（运行时生成，不进场景）</summary>
        void BuildLeverIfMissing()
        {
            if (!lever)
            {
                lever = new GameObject("Lever Pivot").transform;
                lever.SetParent(transform, false);
                lever.localPosition = new Vector3(0, 1.3f, 0.7f);
            }
            if (lever.childCount > 0) return;
            PropBits.Cylinder(lever, "Lever Bar", new Vector3(0, 0.9f, 0), new Vector3(0.14f, 1.8f, 0.14f), new Color(0.16f, 0.14f, 0.13f));
            PropBits.Box(lever, "Lever Grip", new Vector3(0, 1.85f, 0), new Vector3(0.6f, 0.22f, 0.22f), new Color(0.75f, 0.32f, 0.12f));
            lever.localRotation = Quaternion.Euler(leverAngle, 0, 0);
        }

        // ───────────── 交互 ─────────────

        public Vector3 Focus => transform.position + Vector3.up * 1.4f;
        public float Radius => 3.2f;
        public bool CanInteract => Phase != State.Pulled;

        public string Prompt => Phase == State.Locked ? "风闸卡死了 · 先肃清鼓风正殿" : "拉开风闸";

        public InteractPrompt PromptCard => new()
        {
            title = "风闸",
            subtitle = Phase == State.Locked ? "卡死" : "拉开",
            lines = Phase == State.Locked
                ? new[] { "铁栓被殿里的守军锁着——先肃清鼓风正殿" }
                : new[] { "鼓风正殿的风箱会鼓起来，炉门大开", "殿里会换一批守军；全图的熔铜渠开始涨落" },
            color = FireTint,
        };

        public void Interact()
        {
            if (Phase == State.Pulled) return;
            if (Phase == State.Locked && !Unlocked)
            {
                if (Time.time >= lockHintAt)
                {
                    lockHintAt = Time.time + 1.5f;
                    GameUI.Toast("风闸被铁栓卡死——先肃清鼓风正殿的守军", new Color(1f, 0.6f, 0.45f));
                    GameAudio.PlayAt("enemy_melee", Focus, 0.5f, 0.6f);
                }
                return;
            }
            Pull();
        }

        /// <summary>拉开风闸（交互 / 测试 / 调试）：风箱鼓起、炉门大开、喷火开始、熔铜渠涨落、第二次进殿的场地可以触发。force = 不管第一次进殿有没有肃清</summary>
        public bool Pull(bool force = false)
        {
            if (Phase == State.Pulled) return false;
            if (!force && !Unlocked) return false;
            Phase = State.Pulled;
            PulledAt = Time.time;
            if (secondVisit) secondVisit.autoTrigger = true;
            foreach (var v in tides)
                if (v)
                    v.tide.enabled = true;
            nextJetAt = Time.time + 2.5f;
            GameUI.Banner("风闸大开", "风箱鼓起 · 炉门喷火 · 鼓风正殿换了一批守军", 3f);
            GameAudio.PlayAt("boss_slam", Focus, 0.7f, 0.55f);
            GameAudio.PlayAt("skill_fire", furnaceMouth ? furnaceMouth.position : Focus, 1f, 0.6f);
            CameraShake.Quake(transform.position, 0.35f, 90f, 1.2f);
            Fx.Burst(Focus, FireTint, 24, 6f, 0.7f, 0.18f, 2f);
            if (secondVisit && secondVisit.phase == EncounterSite.Phase.Idle) GameUI.SetObjective($"回到{secondVisit.title}");
            if (Pulled != null)
                try
                {
                    Pulled(this);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            return true;
        }

        // ───────────── 每帧 ─────────────

        void Update()
        {
            float dt = Time.deltaTime;
            if (Phase == State.Locked && Unlocked) Phase = State.Ready;
            bool pulled = Phase == State.Pulled;

            // 拉杆
            leverAngle = Mathf.MoveTowards(leverAngle, pulled ? 55f : -35f, dt * 180f);
            if (lever) lever.localRotation = Quaternion.Euler(leverAngle, 0, 0);

            // 风箱：瘪着 → 鼓起来一起一伏
            float target = pulled
                ? Mathf.Lerp(bellowsLow, bellowsHigh, 0.5f + 0.5f * Mathf.Sin((Time.time - PulledAt) * Mathf.PI * 2f / Mathf.Max(0.5f, pumpPeriod)))
                : bellowsRest;
            BellowsScale = Mathf.MoveTowards(BellowsScale, target, dt * (pulled ? 0.6f : 1f));
            ApplyBellows();

            // 炉门火光
            foreach (var l in furnaceLights)
                if (l)
                    l.intensity = Mathf.MoveTowards(l.intensity, pulled ? lightHigh * (0.85f + 0.15f * Mathf.PerlinNoise(Time.time * 3f, 0.3f)) : lightLow, dt * 4f);
            if (pulled && furnaceMouth)
            {
                emberAcc += dt;
                if (emberAcc >= 0.22f)
                {
                    emberAcc = 0;
                    Fx.Burst(furnaceMouth.position, FireTint, 6, 4f, 0.6f, 0.16f, -3f);
                }
            }

            if (pulled) StepJets();
        }

        void ApplyBellows()
        {
            foreach (var b in bellows)
                if (b)
                {
                    var s = b.localScale;
                    s.y = BellowsScale;
                    b.localScale = s;
                }
        }

        /// <summary>炉门喷火：轮流一条风箱道，先亮预警长条，再沿道落一串地火；第二次进殿肃清后停</summary>
        void StepJets()
        {
            if (jetsDone) return;
            if (secondVisit && secondVisit.phase == EncounterSite.Phase.Cleared)
            {
                jetsDone = true;
                return;
            }
            int lanes = Mathf.Min(laneFrom.Length, laneTo.Length);
            if (lanes == 0) return;
            float now = Time.time;
            if (pendingLane >= 0 && now >= jetFireAt)
            {
                FireLane(pendingLane);
                pendingLane = -1;
            }
            if (pendingLane >= 0 || now < nextJetAt) return;
            nextJetAt = now + Mathf.Max(1f, jetEvery);
            if (!PlayerNear()) return;
            pendingLane = nextLane % lanes;
            nextLane++;
            jetFireAt = now + jetWarn;
            Telegraph.Lane(laneFrom[pendingLane], laneTo[pendingLane], jetRadius * 2f, Mathf.Max(0.1f, jetWarn), FireTint);
            GameAudio.PlayAt("telegraph", laneFrom[pendingLane], 0.6f, 0.8f);
        }

        bool PlayerNear()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return false;
            var c = secondVisit ? secondVisit.transform.position : transform.position;
            var d = pv.transform.position - c;
            d.y = 0;
            return d.sqrMagnitude <= jetRange * jetRange;
        }

        void FireLane(int i)
        {
            JetsFired++;
            var a = laneFrom[i];
            var b = laneTo[i];
            float diff = RunState.Current != null ? Mathf.Max(0.5f, RunState.Current.difficulty) : 1f;
            float dmg = jetTick * (1 + (diff - 1) * 0.55f);
            int n = Mathf.Max(1, jetSpots);
            for (int k = 0; k < n; k++)
            {
                var p = Vector3.Lerp(a, b, n == 1 ? 0.5f : k / (float)(n - 1));
                p.y = PropBits.GroundY(p + Vector3.up);
                FloorFire.Spawn(p, jetRadius, jetDuration, dmg, jetTickInterval, this);
                FiresSpawned++;
            }
            Fx.Burst(a + Vector3.up * 1.2f, FireTint, 18, 9f, 0.6f, 0.2f, -2f);
            GameAudio.PlayAt("skill_fire", a, 0.9f, 0.7f);
            if (furnaceMouth) CameraShake.Quake(furnaceMouth.position, 0.2f, 40f, 0.4f);
        }

        void OnDrawGizmos()
        {
            Gizmos.color = FireTint;
            Gizmos.DrawWireCube(transform.position + Vector3.up * 1f, new Vector3(1.2f, 2f, 1.2f));
            int lanes = Mathf.Min(laneFrom.Length, laneTo.Length);
            for (int i = 0; i < lanes; i++) Gizmos.DrawLine(laneFrom[i] + Vector3.up * 0.2f, laneTo[i] + Vector3.up * 0.2f);
            foreach (var b in bellows)
                if (b)
                    Gizmos.DrawLine(transform.position, b.position);
        }
    }
}
