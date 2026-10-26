using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 3-2 铸神井的炉坛升降台（docs/level-design/maps/3-2.md §6；本关自己的两站逻辑，载人 / 压人检测用 L6 的通用核心 <see cref="PlatformCarrier"/>，
    /// 和通用件 <see cref="MovingPlatform"/> 同一套）：
    /// 一块竖直往返的铁台，两站——下站在井底炉坛旁，上站在上环岩台沿的栈桥头（出口铸门前）。
    ///   · 通电：<see cref="powerSite"/>（井底炉坛）肃清后才动；没设 = 一直通电。通电时亮灯、提示一次。
    ///   · 乘坐：站上台面 <see cref="departDelay"/> 秒后开往另一站；到站后乘客要先下来再上去才会再开（不会把站着发呆的人送回去）。
    ///     台面空着、玩家在另一站 <see cref="callRadius"/> 米内等着时，自己开过去接人（半径只罩住台口：上站是栈桥前半段，
    ///     沿上环岩台内沿路过的人离井道 8.5 m，不会把台面空叫上去）。
    ///     下行时台面投影里站着玩家，台面停在他头顶上方等，并提示一次「站开」——站开以后接着落下来。
    ///   · 角色控制器安全（<see cref="PlatformCarrier"/>）：本组件排在 PlayerMotor 之前更新；往上走先用 CharacterController.Move 把乘客抬起、再挪台面，
    ///     往下走先挪台面、再把乘客按同样的位移放下——乘客始终贴着台面，PlayerMotor 这一帧照常走、照常判落地，台面的位移不进它的速度
    ///     （到站不会被甩出去）。下行时台面下方有角色就停住等（不压人）。
    ///   · 台面挂运动学刚体（PlatformCarrier 挂）：SafeGround 不会把会动的台面记成安全落脚点。
    /// 场景里台面放在下站：导航网格、L5 验收（可达性、净空）都按下站算；上站接一段固定的栈桥，栈桥和岩台都在导航网格上。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-30)]
    public sealed class ForgeWellLift : MonoBehaviour
    {
        public enum Stop { Low, High }

        [Tooltip("会动的台面：物体位置 = 台面顶面中心（碰撞盒在它下面）")]
        public Transform deck;
        [Tooltip("台面尺寸（米，台面局部 X 宽 × Z 深）与厚度：载人 / 压人检测按它")]
        public Vector2 deckSize = new(7, 7);
        public float deckThickness = 0.5f;
        [Tooltip("两站台面顶面中心（世界坐标）")]
        public Vector3 lowPosition, highPosition;
        [Tooltip("最高速度（m/s）、加减速度（m/s²）")]
        public float speed = 4f, accel = 2.5f;
        [Tooltip("站上去多少秒后开、玩家在另一站等多少秒后来接、接人的半径（米，水平；只罩住台口，别伸到旁边的路上）")]
        public float departDelay = 0.8f, callDelay = 0.6f, callRadius = 6.5f;
        [Tooltip("这个场地肃清后才通电（空 = 一直通电）")]
        public EncounterSite powerSite;
        [Tooltip("通电后才显示的（灯、炉口光）/ 断电时才显示的")]
        public GameObject[] poweredOnly = Array.Empty<GameObject>();
        public GameObject[] unpoweredOnly = Array.Empty<GameObject>();
        [Tooltip("吊索（圆柱，Y 轴是长度）：每根从 cableTops[i]（世界）拉到台面上的 cableAnchors[i]（台面局部）")]
        public Transform[] cables = Array.Empty<Transform>();
        public Vector3[] cableTops = Array.Empty<Vector3>();
        public Vector3[] cableAnchors = Array.Empty<Vector3>();
        public string poweredToast = "炉坛升降台通电了 · 站上台面就走";
        [Tooltip("下行时被台面投影里的玩家挡住（停在头顶上方）时提示一次")]
        public string blockedToast = "升降台要落下来了 · 先从台面底下站开";

        /// <summary>场景里的升降台（3-2 只有一座）</summary>
        public static ForgeWellLift Active { get; private set; }
        public bool Powered { get; private set; }
        public bool Moving => moving;
        /// <summary>停着时所在的站 / 走着时出发的站</summary>
        public Stop At => at;
        public Stop Target => target;
        public bool AtHigh => !moving && at == Stop.High;
        public bool AtLow => !moving && at == Stop.Low;
        /// <summary>下行时脚下有人，停着等</summary>
        public bool Blocked { get; private set; }
        /// <summary>跑完的单程数</summary>
        public int Trips { get; private set; }
        /// <summary>当前速度（m/s）</summary>
        public float Speed => moving ? velocity : 0;
        /// <summary>台面上的乘客（本帧）</summary>
        public IReadOnlyList<CharacterController> Riders => carrier != null ? carrier.Riders : Array.Empty<CharacterController>();
        /// <summary>到站（站）</summary>
        public event Action<ForgeWellLift, Stop> Arrived;

        PlatformCarrier carrier;
        bool moving, holdUntilClear, blockedHinted;
        Stop at = Stop.Low, target = Stop.Low;
        float velocity, standTime, callTime, nextFind, blockedTime;
        PlayerMotor player;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Active = null;

        void Awake()
        {
            if (!deck) deck = transform;
            carrier = new PlatformCarrier(deck, deckSize, deckThickness);
            at = target = (deck.position - highPosition).sqrMagnitude < (deck.position - lowPosition).sqrMagnitude ? Stop.High : Stop.Low;
            SetDeck(StopPosition(at));
        }

        void OnEnable()
        {
            Active = this;
            if (powerSite) powerSite.Cleared += OnPowerSiteCleared;
            Powered = false;
            ApplyPower(IsPowerSiteDone(), false);
        }

        void OnDisable()
        {
            if (Active == this) Active = null;
            if (powerSite) powerSite.Cleared -= OnPowerSiteCleared;
        }

        bool IsPowerSiteDone() => !powerSite || powerSite.phase == EncounterSite.Phase.Cleared;

        void OnPowerSiteCleared(EncounterSite s) => ApplyPower(true, true);

        void ApplyPower(bool on, bool announce)
        {
            bool changed = on != Powered;
            Powered = on;
            foreach (var g in poweredOnly)
                if (g) g.SetActive(on);
            foreach (var g in unpoweredOnly)
                if (g) g.SetActive(!on);
            if (changed && on && announce && Application.isPlaying && !string.IsNullOrEmpty(poweredToast))
                GameUI.Toast(poweredToast, new Color(1f, 0.62f, 0.3f));
        }

        public Vector3 StopPosition(Stop s) => s == Stop.High ? highPosition : lowPosition;

        public static Stop Other(Stop s) => s == Stop.High ? Stop.Low : Stop.High;

        /// <summary>这个角色控制器现在站在台面上</summary>
        public bool Carrying(CharacterController cc) => carrier != null && carrier.Carrying(cc);

        void Update()
        {
            float dt = Time.deltaTime;
            if (!deck || !(dt > 0)) return;
            // 场地肃清的事件万一错过（场景重载、测试强清）：每帧补查一次
            if (!Powered && IsPowerSiteDone()) ApplyPower(true, true);
            carrier.size = deckSize;
            carrier.thickness = deckThickness;
            carrier.CollectRiders();
            if (moving) Travel(dt);
            else Idle(dt);
            UpdateCables();
        }

        void Idle(float dt)
        {
            if (!Powered)
            {
                standTime = callTime = 0;
                return;
            }
            if (carrier.Riders.Count > 0)
            {
                callTime = 0;
                if (holdUntilClear) return;
                standTime += dt;
                if (standTime >= departDelay) Depart(Other(at));
                return;
            }
            holdUntilClear = false;
            standTime = 0;
            if (PlayerWaitingAt(Other(at)))
            {
                callTime += dt;
                if (callTime >= callDelay) Depart(Other(at));
            }
            else callTime = 0;
        }

        void Depart(Stop to)
        {
            moving = true;
            target = to;
            velocity = 0;
            standTime = callTime = blockedTime = 0;
            blockedHinted = false;
        }

        void Travel(float dt)
        {
            var goal = StopPosition(target);
            var pos = deck.position;
            var to = goal - pos;
            float dist = to.magnitude;
            if (dist < 1e-3f)
            {
                Arrive(goal);
                return;
            }
            // 梯形速度：加速到 speed，离终点近了按 v² = 2as 减速
            float cap = Mathf.Min(speed, Mathf.Sqrt(2 * Mathf.Max(0.1f, accel) * dist) + 0.05f);
            velocity = Mathf.MoveTowards(velocity, cap, Mathf.Max(0.1f, accel) * dt);
            if (velocity > cap) velocity = cap;
            float stepLen = Mathf.Min(dist, Mathf.Max(velocity, 0.15f) * dt);
            var delta = to / dist * stepLen;
            if (delta.y < 0 && carrier.SomethingBelow(-delta.y, out bool playerBelow))
            {
                velocity = 0;
                Blocked = true;
                blockedTime += dt;
                if (playerBelow && !blockedHinted && blockedTime > 0.4f && Application.isPlaying && !string.IsNullOrEmpty(blockedToast))
                {
                    blockedHinted = true;
                    GameUI.Toast(blockedToast, new Color(1f, 0.62f, 0.3f));
                }
                return;
            }
            Blocked = false;
            blockedTime = 0;
            if (delta.y >= 0)
            {
                carrier.MoveRiders(delta);
                carrier.SetDeck(pos + delta);
            }
            else
            {
                carrier.SetDeck(pos + delta);
                carrier.MoveRiders(delta);
            }
            if (stepLen >= dist - 1e-4f) Arrive(goal);
        }

        void Arrive(Vector3 goal)
        {
            SetDeck(goal);
            moving = false;
            velocity = 0;
            at = target;
            Trips++;
            // 坐过来的人先下去，台面才会再开
            holdUntilClear = carrier.Riders.Count > 0;
            Arrived?.Invoke(this, at);
        }

        void SetDeck(Vector3 p) => carrier.SetDeck(p);

        /// <summary>玩家站在另一站的台口（水平 callRadius 内、高差 2.5 m 内）、没在台面上</summary>
        bool PlayerWaitingAt(Stop s)
        {
            if (!player && Time.time >= nextFind)
            {
                nextFind = Time.time + 1f;
                player = FindAnyObjectByType<PlayerMotor>();
            }
            if (!player || !player.isActiveAndEnabled) return false;
            var p = player.transform.position;
            var stop = StopPosition(s);
            var flat = new Vector2(p.x - stop.x, p.z - stop.z);
            return flat.magnitude <= callRadius && Mathf.Abs(p.y - stop.y) <= 2.5f;
        }

        void UpdateCables()
        {
            int n = Mathf.Min(cables.Length, Mathf.Min(cableTops.Length, cableAnchors.Length));
            for (int i = 0; i < n; i++)
            {
                var c = cables[i];
                if (!c) continue;
                var top = cableTops[i];
                var bottom = deck.TransformPoint(cableAnchors[i]);
                var d = top - bottom;
                float len = d.magnitude;
                if (len < 0.01f) continue;
                c.SetPositionAndRotation((top + bottom) * 0.5f, Quaternion.FromToRotation(Vector3.up, d / len));
                var s = c.localScale;
                c.localScale = new Vector3(s.x, len * 0.5f, s.z);
            }
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.55f, 0.2f);
            var size = new Vector3(deckSize.x, deckThickness, deckSize.y);
            Gizmos.DrawWireCube(lowPosition + Vector3.down * deckThickness * 0.5f, size);
            Gizmos.DrawWireCube(highPosition + Vector3.down * deckThickness * 0.5f, size);
            Gizmos.DrawLine(lowPosition, highPosition);
        }
    }
}
