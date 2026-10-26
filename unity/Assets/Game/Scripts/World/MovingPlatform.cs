using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 通用移动平台（L6 场景件）：一块能站人的台面沿一条折线 <see cref="path"/> 走——两头是站，中间的点是途经点（不停，拐角处减速）。
    /// 上下（升降台）、平移（摆渡板）、先升再平移都是同一个件。载人 / 压人 / 推人用 <see cref="PlatformCarrier"/>（3-2 的 <see cref="ForgeWellLift"/> 也用它）：
    ///   · 往上先抬乘客再挪台面、往下先挪台面再放乘客，全是扫掠的 CharacterController.Move；本组件排在 PlayerMotor 之前更新，台面的位移不进玩家速度，
    ///     到站不会被甩出去；PlayerMotor 的防穿地看到的帧初位置已经是平台挪完之后的，下降不会误救。
    ///   · 往下时台面底下有角色（玩家 / 敌人）就停在头顶上方等，并提示一次「站开」；往上时乘客头顶被挡就停；横着走把挡路的玩家推开，推不动就停。
    ///   · 台面挂运动学刚体：SafeGround 不会把会动的台面记成安全落脚点。
    /// 怎么动（<see cref="mode"/>）：
    ///   · PingPong：在两头之间来回，每头停 <see cref="dwell"/> 秒；Loop：按顺序绕一圈回到第 0 点，在第 0 点停 dwell 秒；
    ///   · OnRide：同 3-2 升降台——站上去 <see cref="departDelay"/> 秒后开往另一头，到站后乘客先下来才会再开；台面空着、玩家在另一头
    ///     <see cref="callRadius"/> 米内等着就开过去接；
    ///   · Signal：停着等信号（<see cref="SceneActivator"/> 之类调 <see cref="IActivatable.OnActivated"/>），每来一次信号开往另一头。
    /// 通电：<see cref="startPowered"/> 关着时停在原地，等开关（<see cref="onSignal"/> = Power）或 <see cref="powerSite"/> 肃清；没通电时走完当前这一趟再停。
    /// 场景里台面放在第 0 点：导航网格按第 0 点烘（敌人不坐平台）。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-30)]
    public sealed class MovingPlatform : MonoBehaviour, IActivatable
    {
        public enum Mode { PingPong, Loop, OnRide, Signal }
        /// <summary>收到开关信号时：Power = 信号开 / 关就通电 / 断电；Advance = 每个「开」信号开往另一头（没通电就先通电）</summary>
        public enum SignalAction { Power, Advance }

        [Tooltip("会动的台面：物体位置 = 台面顶面中心（碰撞盒在它下面）；空 = 本物体")]
        public Transform deck;
        [Tooltip("台面尺寸（米，台面局部 X 宽 × Z 深）与厚度：载人 / 压人 / 推人检测按它")]
        public Vector2 deckSize = new(4, 4);
        public float deckThickness = 0.5f;
        [Tooltip("路线：台面顶面中心依次经过的点（世界坐标）。第 0 点和最后一点是站，中间是途经点")]
        public Vector3[] path = Array.Empty<Vector3>();
        public Mode mode = Mode.PingPong;
        [Tooltip("最高速度（m/s）、加减速度（m/s²）、拐角（转向 > 30°）处降到的速度")]
        public float speed = 3f, accel = 2.5f, cornerSpeed = 0.8f;
        [Tooltip("PingPong / Loop：到站停多久（秒）")]
        public float dwell = 1.5f;
        [Tooltip("OnRide：站上去多少秒后开、玩家在另一头等多少秒后来接、接人的半径（米，水平）")]
        public float departDelay = 0.8f, callDelay = 0.6f, callRadius = 4f;
        [Tooltip("开局就通电（关着 = 等开关 / 场地肃清）")]
        public bool startPowered = true;
        [Tooltip("这个场地肃清后通电（空 = 不看场地）")]
        public EncounterSite powerSite;
        public SignalAction onSignal = SignalAction.Power;
        [Tooltip("通电后才显示的（灯）/ 断电时才显示的")]
        public GameObject[] poweredOnly = Array.Empty<GameObject>();
        public GameObject[] unpoweredOnly = Array.Empty<GameObject>();
        public string poweredToast = "";
        [Tooltip("下行时被玩家挡住（停在头顶上方）时提示一次")]
        public string blockedToast = "平台要落下来了 · 先从底下站开";

        static readonly List<MovingPlatform> all = new();
        /// <summary>场上的移动平台（测试用）</summary>
        public static IReadOnlyList<MovingPlatform> All => all;

        public bool Powered { get; private set; }
        public bool Moving => moving;
        /// <summary>停着时所在的站（路线下标）/ 走着时出发的站</summary>
        public int At => at;
        /// <summary>这一趟开往的站（路线下标）</summary>
        public int Goal => goal;
        public int LastIndex => Mathf.Max(0, (path?.Length ?? 0) - 1);
        /// <summary>挡住了（下面有人 / 乘客头顶被挡 / 推不动）</summary>
        public bool Blocked { get; private set; }
        public PlatformCarrier.Result BlockReason { get; private set; }
        /// <summary>跑完的单程数</summary>
        public int Trips { get; private set; }
        /// <summary>当前速度（m/s）、这一帧台面的速度向量</summary>
        public float Speed => moving ? velocity : 0;
        public Vector3 Velocity { get; private set; }
        public IReadOnlyList<CharacterController> Riders => carrier != null ? carrier.Riders : Array.Empty<CharacterController>();
        /// <summary>到站（路线下标）/ 出发（从哪站开往哪站）</summary>
        public event Action<MovingPlatform, int> Arrived;
        public event Action<MovingPlatform, int, int> Departed;

        PlatformCarrier carrier;
        bool moving, holdUntilClear, blockedHinted, queued;
        int at, goal, next, dir = 1;
        float velocity, idleTime, standTime, callTime, nextFind, blockedTime;
        bool forcedPower;
        PlayerMotor player;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake()
        {
            if (!deck) deck = transform;
            carrier = new PlatformCarrier(deck, deckSize, deckThickness);
            if (path == null || path.Length == 0) path = new[] { deck.position };
            // 停在离台面最近的点上（只认两头）
            at = goal = (deck.position - path[LastIndex]).sqrMagnitude < (deck.position - path[0]).sqrMagnitude ? LastIndex : 0;
            carrier.SetDeck(path[at]);
        }

        void OnEnable()
        {
            all.Add(this);
            if (powerSite) powerSite.Cleared += OnPowerSiteCleared;
            Powered = false;
            ApplyPower(startPowered || forcedPower || PowerSiteDone, false);
        }

        void OnDisable()
        {
            all.Remove(this);
            if (powerSite) powerSite.Cleared -= OnPowerSiteCleared;
        }

        bool PowerSiteDone => powerSite && powerSite.phase == EncounterSite.Phase.Cleared;

        void OnPowerSiteCleared(EncounterSite s) => SetPowered(true);

        /// <summary>通电 / 断电（开关、场地肃清、测试）：断电时走完这一趟再停</summary>
        public void SetPowered(bool on)
        {
            forcedPower = on;
            ApplyPower(on, true);
        }

        void ApplyPower(bool on, bool announce)
        {
            bool changed = on != Powered;
            Powered = on;
            foreach (var g in poweredOnly)
                if (g) g.SetActive(on);
            foreach (var g in unpoweredOnly)
                if (g) g.SetActive(!on);
            if (changed && on && announce && Application.isPlaying && !string.IsNullOrEmpty(poweredToast))
                GameUI.Toast(poweredToast, new Color(1f, 0.78f, 0.4f));
        }

        /// <summary>开关信号（<see cref="SceneActivator"/>）：按 <see cref="onSignal"/> 通断电，或开往另一头</summary>
        public void OnActivated(SceneActivator source, bool on)
        {
            if (onSignal == SignalAction.Power)
            {
                SetPowered(on);
                return;
            }
            if (!on) return;
            if (!Powered) SetPowered(true);
            Advance();
        }

        /// <summary>开往另一头（停着时马上走；走着时记一次，到站后再开回去）</summary>
        public void Advance()
        {
            if (path.Length < 2) return;
            if (moving)
            {
                queued = true;
                return;
            }
            Depart(OtherEnd(at));
        }

        /// <summary>开往某一站（路线下标，只认两头；测试 / 剧情用，不看通电）</summary>
        public void SendTo(int stop)
        {
            if (path.Length < 2 || moving) return;
            stop = stop <= 0 ? 0 : LastIndex;
            if (stop != at) Depart(stop);
        }

        int OtherEnd(int s) => s == 0 ? LastIndex : 0;

        /// <summary>这个角色控制器现在站在台面上</summary>
        public bool Carrying(CharacterController cc) => carrier != null && carrier.Carrying(cc);

        void Update()
        {
            float dt = Time.deltaTime;
            Velocity = Vector3.zero;
            if (!deck || !(dt > 0) || path.Length < 2) return;
            if (!Powered && PowerSiteDone) ApplyPower(true, true);
            carrier.size = deckSize;
            carrier.thickness = deckThickness;
            carrier.CollectRiders();
            if (moving) Travel(dt);
            else Idle(dt);
        }

        void Idle(float dt)
        {
            if (!Powered)
            {
                idleTime = standTime = callTime = 0;
                return;
            }
            idleTime += dt;
            if (queued)
            {
                queued = false;
                Depart(OtherEnd(at));
                return;
            }
            switch (mode)
            {
                case Mode.PingPong:
                    if (idleTime >= dwell) Depart(OtherEnd(at));
                    break;
                case Mode.Loop:
                    if (idleTime >= dwell) DepartLoop();
                    break;
                case Mode.OnRide:
                    IdleOnRide(dt);
                    break;
            }
        }

        void IdleOnRide(float dt)
        {
            if (carrier.Riders.Count > 0)
            {
                callTime = 0;
                if (holdUntilClear) return;
                standTime += dt;
                if (standTime >= departDelay) Depart(OtherEnd(at));
                return;
            }
            holdUntilClear = false;
            standTime = 0;
            if (PlayerWaitingAt(OtherEnd(at)))
            {
                callTime += dt;
                if (callTime >= callDelay) Depart(OtherEnd(at));
            }
            else callTime = 0;
        }

        void Depart(int to)
        {
            if (to == at && mode != Mode.Loop) return;
            moving = true;
            goal = to;
            dir = to > at ? 1 : -1;
            next = at + dir;
            BeginTrip();
        }

        /// <summary>Loop：从第 0 点出发绕一圈回到第 0 点（不管停在哪一头都按顺序走到底再回第 0 点）</summary>
        void DepartLoop()
        {
            moving = true;
            dir = 1;
            goal = 0;
            next = (at + 1) % path.Length;
            BeginTrip();
        }

        void BeginTrip()
        {
            velocity = 0;
            idleTime = standTime = callTime = blockedTime = 0;
            blockedHinted = false;
            Blocked = false;
            Departed?.Invoke(this, at, goal);
        }

        int Following(int i)
        {
            int j = i + dir;
            if (mode == Mode.Loop) j = (j % path.Length + path.Length) % path.Length;
            return j;
        }

        /// <summary>从现在的位置沿路线走到这一趟终点还剩多远；corner = 到下一个急转点（转向 &gt; 30°）的距离（没有则无穷大）</summary>
        float Remaining(Vector3 pos, out float corner)
        {
            corner = float.PositiveInfinity;
            float d = Vector3.Distance(pos, path[next]);
            var prev = pos;
            int i = next;
            for (int guard = 0; i != goal && guard <= path.Length; guard++)
            {
                int j = Following(i);
                var inDir = path[i] - prev;
                var outDir = path[j] - path[i];
                if (float.IsPositiveInfinity(corner) && inDir.sqrMagnitude > 1e-6f && outDir.sqrMagnitude > 1e-6f && Vector3.Angle(inDir, outDir) > 30f) corner = d;
                d += outDir.magnitude;
                prev = path[i];
                i = j;
            }
            return d;
        }

        void Travel(float dt)
        {
            var pos = deck.position;
            float remaining = Remaining(pos, out float corner);
            if (remaining < 1e-3f)
            {
                Arrive();
                return;
            }
            float a = Mathf.Max(0.1f, accel);
            // 梯形速度：加速到 speed，离终点近了按 v² = 2as 减速；拐角前减到 cornerSpeed
            float cap = Mathf.Min(speed, Mathf.Sqrt(2 * a * remaining) + 0.05f);
            if (!float.IsPositiveInfinity(corner)) cap = Mathf.Min(cap, Mathf.Sqrt(2 * a * corner) + Mathf.Max(0.2f, cornerSpeed));
            velocity = Mathf.MoveTowards(velocity, cap, a * dt);
            if (velocity > cap) velocity = cap;
            float stepLen = Mathf.Min(remaining, Mathf.Max(velocity, 0.15f) * dt);

            // 沿折线走 stepLen（一帧里可能跨过途经点）：先算出新位置和新的下一个点，挪成功了才认
            var np = pos;
            int nn = next;
            float left = stepLen;
            bool arrived = false;
            for (int guard = 0; guard < path.Length + 1; guard++)
            {
                var to = path[nn] - np;
                float d = to.magnitude;
                if (d > left)
                {
                    np += to / d * left;
                    break;
                }
                np = path[nn];
                left -= d;
                if (nn == goal)
                {
                    arrived = true;
                    break;
                }
                nn = Following(nn);
            }
            var delta = np - pos;
            var r = carrier.Step(delta);
            if (r != PlatformCarrier.Result.Moved)
            {
                velocity = 0;
                Blocked = true;
                BlockReason = r;
                blockedTime += dt;
                if (r == PlatformCarrier.Result.BlockedBelow && carrier.PlayerBlocking && !blockedHinted && blockedTime > 0.4f && Application.isPlaying &&
                    !string.IsNullOrEmpty(blockedToast))
                {
                    blockedHinted = true;
                    GameUI.Toast(blockedToast, new Color(1f, 0.78f, 0.4f));
                }
                return;
            }
            Blocked = false;
            blockedTime = 0;
            next = nn;
            Velocity = delta / dt;
            if (arrived) Arrive();
        }

        void Arrive()
        {
            carrier.SetDeck(path[goal]);
            moving = false;
            velocity = 0;
            at = goal;
            Trips++;
            idleTime = 0;
            // 坐过来的人先下去，台面才会再开（OnRide）
            holdUntilClear = carrier.Riders.Count > 0;
            Arrived?.Invoke(this, at);
        }

        /// <summary>玩家站在某一站的台口（水平 callRadius 内、高差 2.5 m 内）、没在台面上</summary>
        bool PlayerWaitingAt(int s)
        {
            if (!player && Time.time >= nextFind)
            {
                nextFind = Time.time + 1f;
                player = FindAnyObjectByType<PlayerMotor>();
            }
            if (!player || !player.isActiveAndEnabled) return false;
            var p = player.transform.position;
            var stop = path[s];
            var flat = new Vector2(p.x - stop.x, p.z - stop.z);
            return flat.magnitude <= callRadius && Mathf.Abs(p.y - stop.y) <= 2.5f;
        }

        void OnDrawGizmosSelected()
        {
            if (path == null || path.Length == 0) return;
            Gizmos.color = new Color(0.4f, 0.85f, 1f);
            var size = new Vector3(deckSize.x, deckThickness, deckSize.y);
            for (int i = 0; i < path.Length; i++)
            {
                if (i == 0 || i == path.Length - 1) Gizmos.DrawWireCube(path[i] + Vector3.down * deckThickness * 0.5f, size);
                if (i > 0) Gizmos.DrawLine(path[i - 1], path[i]);
            }
            if (mode == Mode.Loop && path.Length > 2) Gizmos.DrawLine(path[^1], path[0]);
        }
    }
}
