using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 3-2 铸神井的演出与机关（docs/level-design/maps/3-2.md 第 6 节；ch3-v2 5.2「演出」）。场景里一个，构建器摆好、连好引用：
    ///   1. 北链桥：玩家第一次走过桥中段，悬炉炉腹喷一口火星、桥身一震（不伤人）。
    ///   2. ② 悬炉锻台肃清：北链桥从桥头往下一段段崩断坠井（<see cref="BreakableSpan.BreakAll"/>），西吊臂的挂钩放下来——往下走。
    ///      北链桥塌了以后回 T1 走南链桥（常设）或井底升降台。
    ///   3. ④ 熔泉炉坛第二波开波（或 S1 增援门调 <see cref="OnActivated"/>）：井底铸门先亮 <see cref="gateWarn"/> 秒，再一下沉到半开（闸板顶齐地，铁牛走出来）。
    ///   4. 关卡目标完成：铸门全开（闸板整个沉进地面）、门缝里的光出来；四口间歇熔泉同时喷一次（<see cref="LavaGeyser.EruptNow"/>）。
    /// 铸门：<see cref="gate"/> 是开闸时沉进地面的闸板（碰撞不进导航烘焙；专用门框不动，往上提会从门楣顶露出来，所以往下沉），
    /// 关着时 <see cref="gateCarve"/>（挖洞障碍）把门洞从导航网格上挖掉，到半开就撤掉。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ForgeWellDirector : MonoBehaviour, IActivatable
    {
        [Header("场地")]
        [Tooltip("② 悬炉锻台：肃清后北链桥崩断")]
        public EncounterSite deckSite;
        [Tooltip("④ 熔泉炉坛：第二波开波时铸门打开")]
        public EncounterSite forgeSite;
        [Tooltip("关卡目标（空 = 本场景的 LevelObjective）")]
        public LevelObjective objective;

        [Header("北链桥")]
        public BreakableSpan northBridge;
        [Tooltip("北链桥从哪一段开始塌（−1 = 正中）：从悬炉那头往桥头塌")]
        public int collapseFrom = -1;
        [Tooltip("桥中段（玩家第一次走到这里 radius 米内：悬炉喷火星、桥身一震）")]
        public Vector3 bridgeMid;
        public float bridgeMidRadius = 3f;
        [Tooltip("悬炉炉腹（喷火星的地方）")]
        public Transform forgeBelly;

        [Header("西吊臂的挂钩")]
        public Transform hook;
        [Tooltip("挂钩收着 / 放下的位置（世界坐标）")]
        public Vector3 hookUp, hookDown;
        public float hookTime = 2.5f;
        [Tooltip("挂钩放下以后才亮的引导灯")]
        public GameObject[] hookLamps = Array.Empty<GameObject>();

        [Header("井底铸门")]
        [Tooltip("闸板（开闸沉进地面）")]
        public Transform gate;
        [Tooltip("门关着时把门洞挖掉的导航障碍")]
        public NavMeshObstacle gateCarve;
        [Tooltip("门缝的光（开门前亮起）")]
        public GameObject[] gateGlow = Array.Empty<GameObject>();
        public Light gateLight;
        [Tooltip("开门前门缝亮多久（秒）、半开 / 全开走多远（米；9 m 的闸板底面在地下 0.2 m：沉 8.6 m 顶齐地、9.4 m 整个没进地面）、速度（m/s）")]
        public float gateWarn = 1.2f, gateHalf = 8.6f, gateFull = 9.4f, gateSpeed = 8f;
        [Tooltip("开闸方向：−1 往下沉进地面（专用门框，3-2 / 3-4 的做法），+1 往上升")]
        public float gateDirection = -1f;

        [Header("熔泉")]
        [Tooltip("目标完成时同时喷一次的间歇熔泉（④ 熔泉炉坛的四口）")]
        public LavaGeyser[] geysers = Array.Empty<LavaGeyser>();

        public static ForgeWellDirector Instance { get; private set; }

        /// <summary>北链桥崩断了</summary>
        public bool BridgeBroken { get; private set; }
        /// <summary>挂钩放下了（0–1）</summary>
        public float HookLowered { get; private set; }
        /// <summary>铸门开了多少（闸板沿 <see cref="gateDirection"/> 走过的米数）与目标</summary>
        public float GateRise { get; private set; }
        public float GateTarget { get; private set; }
        /// <summary>铸门：0 关着、1 门缝发光、2 半开、3 全开</summary>
        public int GateStage { get; private set; }
        /// <summary>走过北链桥中段的演出放过了</summary>
        public bool BridgeShaken { get; private set; }

        public event Action<ForgeWellDirector> BridgeCollapsed;
        public event Action<ForgeWellDirector, int> GateChanged;

        Vector3 gateHome;
        float gateWarnLeft = -1, hookT = -1;
        PlayerMotor player;
        float nextFind;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        void Awake()
        {
            Instance = this;
            if (gate) gateHome = gate.position;
            if (hook) hook.position = hookUp;
            foreach (var g in gateGlow)
                if (g) g.SetActive(false);
            foreach (var g in hookLamps)
                if (g) g.SetActive(false);
            if (gateLight) gateLight.intensity = 0;
            if (gateCarve) gateCarve.enabled = true;
        }

        void OnEnable()
        {
            if (deckSite) deckSite.Cleared += OnDeckCleared;
            EncounterSite.AnyWaveStarted += OnWaveStarted;
        }

        void OnDisable()
        {
            if (deckSite) deckSite.Cleared -= OnDeckCleared;
            EncounterSite.AnyWaveStarted -= OnWaveStarted;
            if (objective) objective.Completed -= OnObjectiveCompleted;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        void Start()
        {
            if (!objective) objective = LevelObjective.For(gameObject.scene);
            if (objective) objective.Completed += OnObjectiveCompleted;
            if (deckSite && deckSite.phase == EncounterSite.Phase.Cleared) OnDeckCleared(deckSite);
        }

        // ───────────── ② 悬炉锻台：北链桥崩断、挂钩放下 ─────────────

        void OnDeckCleared(EncounterSite s)
        {
            CollapseBridge();
            LowerHook();
        }

        /// <summary>北链桥崩断（② 肃清；测试也调）</summary>
        public void CollapseBridge()
        {
            if (BridgeBroken) return;
            BridgeBroken = true;
            if (northBridge) northBridge.BreakAll(collapseFrom);
            if (forgeBelly) Fx.Burst(forgeBelly.position, LavaField.Orange, 24, 6f, 0.9f, 0.14f, -6f);
            CameraShake.Quake(northBridge ? northBridge.transform.position : transform.position, 0.35f, 60f, 0.6f);
            GameUI.Toast("北链桥崩断了 · 顺着西吊臂下到风箱窟（回上层走南链桥 / 井底升降台）", new Color(1f, 0.78f, 0.4f), 4f);
            try
            {
                BridgeCollapsed?.Invoke(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>西吊臂的挂钩放下来（往下走的提示）</summary>
        public void LowerHook()
        {
            if (hookT >= 0) return;
            hookT = 0;
            if (hook) GameAudio.PlayAt("enemy_melee", hook.position, 0.6f, 0.45f);
            foreach (var g in hookLamps)
                if (g) g.SetActive(true);
        }

        // ───────────── ④ 熔泉炉坛：铸门 ─────────────

        void OnWaveStarted(EncounterSite site, int wave)
        {
            if (site && site == forgeSite && wave >= 1) OpenGateHalf();
        }

        /// <summary>S1 增援门：出怪前先开门（站位的 gateDoor 指向本组件）</summary>
        public void OnActivated(SceneActivator source, bool on)
        {
            if (on) OpenGateHalf();
        }

        /// <summary>铸门先亮、再沉到半开（④ 第二波：精英铁牛走出来）</summary>
        public void OpenGateHalf()
        {
            if (GateStage >= 1) return;
            SetGateStage(1);
            gateWarnLeft = Mathf.Max(0, gateWarn);
            foreach (var g in gateGlow)
                if (g) g.SetActive(true);
            if (gate) GameAudio.PlayAt("boss_roar", gate.position, 0.7f, 0.55f);
        }

        void OnObjectiveCompleted(LevelObjective o) => OpenGateFull();

        /// <summary>铸门全开 + 四口熔泉同时喷一次（关卡目标完成）</summary>
        public void OpenGateFull()
        {
            if (GateStage >= 3) return;
            foreach (var g in gateGlow)
                if (g) g.SetActive(true);
            SetGateStage(3);
            GateTarget = gateFull;
            gateWarnLeft = -1;
            if (gateCarve) gateCarve.enabled = false;
            if (gate)
            {
                GameAudio.PlayAt("boss_slam", gate.position, 0.8f, 0.6f);
                CameraShake.Quake(gate.position, 0.25f, 50f, 0.5f);
            }
            foreach (var g in geysers)
                if (g)
                    g.EruptNow(0.6f);
        }

        void SetGateStage(int s)
        {
            if (s == GateStage) return;
            GateStage = s;
            try
            {
                GateChanged?.Invoke(this, s);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 每帧 ─────────────

        void Update()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            StepBridgeShake();
            // 铸门：门缝先亮，到点沉到半开（撤掉挖洞，铁牛走得出来）；全开继续沉
            if (gateWarnLeft >= 0)
            {
                gateWarnLeft -= dt;
                if (gateWarnLeft < 0)
                {
                    if (GateStage < 2) SetGateStage(2);
                    GateTarget = Mathf.Max(GateTarget, gateHalf);
                    if (gateCarve) gateCarve.enabled = false;
                    if (gate) GameAudio.PlayAt("boss_slam", gate.position, 0.6f, 0.75f);
                }
            }
            if (gate && GateRise < GateTarget)
            {
                GateRise = Mathf.MoveTowards(GateRise, GateTarget, gateSpeed * dt);
                gate.position = gateHome + Vector3.up * (GateRise * (gateDirection < 0 ? -1f : 1f));
            }
            if (gateLight)
            {
                float want = GateStage >= 3 ? 6f : GateStage >= 1 ? 3f : 0f;
                gateLight.intensity = Mathf.MoveTowards(gateLight.intensity, want, 4f * dt);
            }
            // 挂钩
            if (hookT >= 0 && hookT < 1 && hook)
            {
                hookT = Mathf.Min(1, hookT + dt / Mathf.Max(0.1f, hookTime));
                float k = hookT * hookT * (3 - 2 * hookT);
                hook.position = Vector3.Lerp(hookUp, hookDown, k);
                HookLowered = k;
            }
        }

        void StepBridgeShake()
        {
            if (BridgeShaken || BridgeBroken || bridgeMid == Vector3.zero) return;
            if (!player && Time.time >= nextFind)
            {
                nextFind = Time.time + 1f;
                player = FindAnyObjectByType<PlayerMotor>();
            }
            if (!player) return;
            var p = player.transform.position;
            if (new Vector2(p.x - bridgeMid.x, p.z - bridgeMid.z).magnitude > bridgeMidRadius || Mathf.Abs(p.y - bridgeMid.y) > 2.5f) return;
            BridgeShaken = true;
            if (forgeBelly)
            {
                Fx.Burst(forgeBelly.position, LavaField.Orange, 30, 7f, 1.1f, 0.14f, -5f);
                Fx.Burst(forgeBelly.position, LavaField.Gold, 14, 4f, 0.8f, 0.09f, -6f);
                GameAudio.PlayAt("skill_fire", forgeBelly.position, 0.9f, 0.6f);
            }
            CameraShake.Quake(p, 0.18f, 12f, 0.35f);
            GameAudio.PlayAt("enemy_melee", bridgeMid, 0.5f, 0.4f);
        }
    }
}
