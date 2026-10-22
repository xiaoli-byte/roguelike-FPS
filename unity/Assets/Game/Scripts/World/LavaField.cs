using System;
using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔岩系统（docs/unity-parity.md 3.10「熔岩」、L7；Three.js 版 src/world/Lava.ts 的 LavaSystem）：没有挡墙，玩家能走进、跳进、被打进熔岩。
    ///
    /// 玩家：着地时脚底踩到熔岩（或这一帧贴地滑过熔岩——冲刺不能偷渡；或脚底已经低于熔岩面——从洞口掉进熔岩井）→ <see cref="SafeGround.Sink"/>(<see cref="HazardSpec.Lava"/>)：
    ///   立刻扣最大生命 12% + 下沉中两跳灼烧（各 1.5%）、闪屏、嘶响，0.5 s 后托回最近的安全落脚点并给 1 s 无敌。熔岩伤害无视冲刺 / 托回的短无敌，
    ///   但尊重调试无敌（&gt; 5 s）。每次重新踩进都会再扣。跳过窄渠（离地）不受伤。安全落脚点不记在离熔岩 1 m 以内（向 SafeGround 登记危险区）。
    /// 敌人：导航网格上熔岩是 Lava 区（代价很高，地面敌人绕路走）；自己走进熔岩的被拉回上一个岸上位置。被击退（失控滑行
    ///   <see cref="EnemyAI.KnockedBack"/>、被掀飞、<see cref="NoteKnocked"/>）0.6 s 内落进熔岩的非首领地面敌人直接烧死（计击杀、正常掉落，
    ///   掉进熔岩的掉落物随后吸向玩家）。同 TS 只认明确的击退信号：传送、落地吸附、坠落回收这类瞬移不算击退。
    ///   首领、飞行敌人、熔岩生物（火鼍：<see cref="MakeSwimmer"/> / LavaSwimmer 代理类型）不受影响。
    /// 涨落：<see cref="LavaVolume"/> 的熔岩面会涨会退；淹到的玩家照样下沉托回，淹到的地面敌人挪到最近的岸上（同 TS addLavaArea）。
    /// 表现：熔岩面是 Spiritfire/Lava 着色器（每片熔岩一个 draw call），这里管一盏跟着玩家附近熔岩的橙色点光、附近熔岩上升的火星。
    ///
    /// 查询（静态，任何系统都能用；炭童 / 祸斗 / 火鼍 / 首领的熔岩逻辑都走这里）：<see cref="IsLava(Vector3)"/>（脚底）、<see cref="IsLavaAt(float, float)"/>（只给 XZ，
    ///   打射线找地面）、<see cref="NearLava"/>、<see cref="SurfaceHeight"/>、<see cref="NearestShore"/>、<see cref="BankToward"/>、<see cref="NearestLava"/>；
    ///   导航：<see cref="LavaArea"/> / <see cref="LavaAreaMask"/> / <see cref="DryAreaMask"/>、<see cref="SwimmerAgentType"/> / <see cref="SwimmerFilter"/>。
    ///   祸斗的「熔岩边」（<see cref="FireFeed.LavaEdge"/>）在有熔岩时自动接上。
    /// 第一片 <see cref="LavaVolume"/> 启用时自动建一个本组件（场景里的「Lava Field」），关卡不用手摆。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LavaField : MonoBehaviour
    {
        /// <summary>NavMesh 区域名（ProjectSettings/NavMeshAreas.asset，代价 50）</summary>
        public const string AreaName = "Lava";
        /// <summary>熔岩生物的 NavMesh 代理类型名（ProjectSettings/NavMeshAreas.asset，半径 0.9 m）</summary>
        public const string SwimmerAgentName = "LavaSwimmer";

        public static readonly Color Orange = Hex.Rgb(0xff6a1a), Gold = Hex.Rgb(0xffd070);
        static readonly Color EmberColor = new(1f, 0.55f, 0.12f, 1f), LightColor = Hex.Rgb(0xff6a20);
        const float LightIntensity = 3.2f, LightRange = 14f, LightReach = 10f, EmberReach = 18f, EmberRate = 30f;

        // ═════════════ 登记表（静态） ═════════════

        static readonly List<LavaBody> bodies = new();
        static IDisposable hazardHandle;
        static Func<Vector3, float, IFireSource> edgeHook;
        static readonly HashSet<EnemyAI> swimmers = new();
        static int? lavaArea, swimmerType;
        static bool swimmerChecked;

        public static LavaField Instance { get; private set; }
        /// <summary>场上启用着的熔岩判定体</summary>
        public static IReadOnlyList<LavaBody> Bodies => bodies;
        /// <summary>场上有熔岩</summary>
        public static bool Any => bodies.Count > 0;

        /// <summary>只给 XZ 的查询用的地面探测（默认物理射线；测试可换成高度函数）</summary>
        public static LavaGroundProbe Probe = PhysicsProbe;

        /// <summary>其它单元追加的熔岩免疫判定（返回 true = 这只敌人不受熔岩影响）</summary>
        public static Func<EnemyAI, bool> Immunity;

        /// <summary>玩家踩进熔岩（脚底位置）</summary>
        public static event Action<Vector3> PlayerEntered;
        /// <summary>敌人被打进熔岩烧死</summary>
        public static event Action<EnemyAI> EnemyBurned;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            bodies.Clear();
            hazardHandle = null;
            edgeHook = null;
            swimmers.Clear();
            lavaArea = swimmerType = null;
            swimmerChecked = false;
            Probe = PhysicsProbe;
            Immunity = null;
            PlayerEntered = null;
            EnemyBurned = null;
            Instance = null;
        }

        /// <summary>测试用：清空登记、撤掉挂到 SafeGround / FireFeed 上的钩子</summary>
        public static void ResetForTests()
        {
            Unhook();
            ResetStatics();
        }

        /// <summary>登记一片熔岩（LavaVolume 启用时）；第一片登记时向 SafeGround 登记危险区、接上祸斗的熔岩边</summary>
        public static void Register(LavaBody body)
        {
            if (body == null || bodies.Contains(body)) return;
            bodies.Add(body);
            Hook();
        }

        public static void Unregister(LavaBody body)
        {
            if (body == null) return;
            bodies.Remove(body);
            if (bodies.Count == 0) Unhook();
        }

        static void Hook()
        {
            hazardHandle ??= SafeGround.RegisterHazard(IsHazard);
            edgeHook ??= FindEdge;
            if (FireFeed.LavaEdge == null) FireFeed.LavaEdge = edgeHook;
        }

        static void Unhook()
        {
            hazardHandle?.Dispose();
            hazardHandle = null;
            if (edgeHook != null && FireFeed.LavaEdge == edgeHook) FireFeed.LavaEdge = null;
        }

        /// <summary>SafeGround 的危险区：离熔岩 <see cref="LavaTuning.SafeMargin"/> 以内不记成安全点、托回时跳过（涨潮淹掉的点也跳过）</summary>
        static bool IsHazard(Vector3 feet) => LavaGeometry.Near(bodies, feet, LavaTuning.SafeMargin);

        // ═════════════ 查询（静态） ═════════════

        /// <summary>脚底 feet 站在 / 泡在熔岩里（离熔岩面 standRise 以内；不打射线）</summary>
        public static bool IsLava(Vector3 feet) => LavaGeometry.Touches(bodies, feet);

        /// <summary>脚底 feet 离熔岩面 rise 以内且在熔岩形状里</summary>
        public static bool IsLava(Vector3 feet, float rise) => LavaGeometry.Touches(bodies, feet, rise);

        /// <summary>(x, z) 是熔岩（往下找地面：地面不高出熔岩面 standRise，或下面是空的）</summary>
        public static bool IsLavaAt(float x, float z) => LavaGeometry.IsLavaAt(bodies, x, z, Probe, out _);

        /// <summary>p 的 XZ 是熔岩（忽略 p.y）</summary>
        public static bool IsLavaAt(Vector3 p) => LavaGeometry.IsLavaAt(bodies, p.x, p.z, Probe, out _);

        /// <summary>脚底离熔岩 margin 米以内（安全落脚点、出生点、掉落物的避让）</summary>
        public static bool NearLava(Vector3 feet, float margin = LavaTuning.SafeMargin) => LavaGeometry.Near(bodies, feet, margin);

        /// <summary>脚底已经低于熔岩面</summary>
        public static bool Submerged(Vector3 feet) => LavaGeometry.Submerged(bodies, feet);

        /// <summary>线段 a → b（脚底）经过熔岩</summary>
        public static bool SweepTouches(Vector3 a, Vector3 b) => LavaGeometry.Sweep(bodies, a, b);

        /// <summary>p 的 XZ 上方熔岩面的高度（只看熔岩形状，不管地面）；不在任何熔岩形状里返回 NaN</summary>
        public static float SurfaceHeight(Vector3 p) => LavaGeometry.SurfaceAt(bodies, p.x, p.z, out float y, out _) ? y : float.NaN;

        /// <summary>p 的 XZ 上方熔岩面的高度；不在任何熔岩形状里返回 false</summary>
        public static bool TrySurfaceHeight(Vector3 p, out float y) => LavaGeometry.SurfaceAt(bodies, p.x, p.z, out y, out _);

        /// <summary>p 的 XZ 落在哪片熔岩的形状里（几片重叠取熔岩面最高的）；没有返回 null</summary>
        public static LavaVolume VolumeAt(Vector3 p) =>
            LavaGeometry.SurfaceAt(bodies, p.x, p.z, out _, out var b) ? b.owner as LavaVolume : null;

        /// <summary>从熔岩里 from 出发最近的能站的岸（岸、岛、堤道、桥）；maxDist 内没有返回 false</summary>
        public static bool NearestShore(Vector3 from, out Vector3 shore, float maxDist = 10f) =>
            LavaGeometry.NearestShore(bodies, from, maxDist, Probe, out shore);

        /// <summary>从熔岩点 from 朝 to 直线走，第一个不是熔岩的点（火鼍扑上岸的落点）</summary>
        public static bool BankToward(Vector3 from, Vector3 to, out Vector3 bank, float maxDist = 12f) =>
            LavaGeometry.BankToward(bodies, from, to, maxDist, Probe, out bank);

        /// <summary>从岸上 from 出发 maxDist 内最近的熔岩点，以及紧挨着它的岸边点</summary>
        public static bool NearestLava(Vector3 from, float maxDist, out Vector3 lava, out Vector3 bank) =>
            LavaGeometry.NearestLava(bodies, from, maxDist, Probe, out lava, out bank);

        static readonly RaycastHit[] probeHits = new RaycastHit[16];

        /// <summary>默认地面探测：(x, z) 处 [bottom, top] 之间最高的朝上表面（世界层，忽略触发器、角色）</summary>
        public static bool PhysicsProbe(float x, float z, float top, float bottom, out float groundY)
        {
            groundY = float.NaN;
            float dist = top - bottom;
            if (!(dist > 0) || !float.IsFinite(x) || !float.IsFinite(z)) return false;
            int n = Physics.RaycastNonAlloc(new Vector3(x, top, z), Vector3.down, probeHits, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            float best = float.NegativeInfinity;
            for (int i = 0; i < n; i++)
            {
                var h = probeHits[i];
                if (h.normal.y < 0.3f || h.point.y <= best) continue;
                best = h.point.y;
            }
            if (float.IsNegativeInfinity(best)) return false;
            groundY = best;
            return true;
        }

        // ── 祸斗的熔岩边（FireFeed.LavaEdge） ──

        /// <summary>熔岩边：吃不完、不占用；Position 是岸边的落脚点（祸斗走过去吃，不用踩进熔岩）</summary>
        sealed class LavaEdgeSource : IFireSource
        {
            public LavaEdgeSource(Vector3 bank, Vector3 lava)
            {
                Position = bank;
                Lava = lava;
            }

            public FireKind Kind => FireKind.Lava;
            public Vector3 Position { get; }
            /// <summary>紧挨着的熔岩点（喷火 / 吸火特效对着这里）</summary>
            public Vector3 Lava { get; }
            public float Radius => 0.6f;
            public bool Edible => true;
            public void Consume() { }

            public object ClaimedBy
            {
                get => null;
                set { }
            }
        }

        /// <summary>离 from 最近的熔岩边（maxDist 内没有返回 null）</summary>
        public static IFireSource FindEdge(Vector3 from, float maxDist) =>
            NearestLava(from, maxDist, out var lava, out var bank) ? new LavaEdgeSource(bank, lava) : null;

        // ── 导航 ──

        /// <summary>NavMesh 的 Lava 区域号（NavMeshAreas.asset 第 3 号）；工程里没有这个区域时 −1</summary>
        public static int LavaArea => lavaArea ??= NavMesh.GetAreaFromName(AreaName);
        /// <summary>只含 Lava 区的掩码（没有这个区域时 0）</summary>
        public static int LavaAreaMask => LavaArea >= 0 ? 1 << LavaArea : 0;
        /// <summary>除 Lava 以外的全部区域：找「岸上的导航点」用</summary>
        public static int DryAreaMask => NavMesh.AllAreas & ~LavaAreaMask;

        /// <summary>LavaSwimmer 代理类型的 id；工程里没有这个代理类型时为 null</summary>
        public static int? SwimmerAgentType
        {
            get
            {
                if (swimmerChecked) return swimmerType;
                swimmerChecked = true;
                swimmerType = null;
                int n = NavMesh.GetSettingsCount();
                for (int i = 0; i < n; i++)
                {
                    int id = NavMesh.GetSettingsByIndex(i).agentTypeID;
                    if (NavMesh.GetSettingsNameFromID(id) == SwimmerAgentName)
                    {
                        swimmerType = id;
                        break;
                    }
                }
                return swimmerType;
            }
        }

        /// <summary>熔岩生物的导航查询过滤（LavaSwimmer 代理类型 + 只走 Lava 区）：SamplePosition / CalculatePath / Raycast 用</summary>
        public static NavMeshQueryFilter SwimmerFilter => new()
        {
            agentTypeID = SwimmerAgentType ?? 0,
            areaMask = LavaAreaMask != 0 ? LavaAreaMask : NavMesh.AllAreas,
        };

        /// <summary>
        /// 把一只敌人设成熔岩生物（火鼍，EN3b）：从此不受熔岩影响（不烧、不拉回）；有 LavaSwimmer 代理类型且附近烘了它的网格时，
        /// 把 NavMeshAgent 切过去、只走 Lava 区，并放到最近的熔岩导航点上。返回是否切到了 LavaSwimmer 导航网格
        /// （false = 只登记了免疫，调用方自己在熔岩里位移，见 <see cref="NearestShore"/> / <see cref="BankToward"/>）
        /// </summary>
        public static bool MakeSwimmer(EnemyAI ai, float searchRadius = 6f)
        {
            if (!ai) return false;
            swimmers.Add(ai);
            ai.Removed -= ForgetSwimmer;
            ai.Removed += ForgetSwimmer;
            var agent = ai.GetComponent<NavMeshAgent>();
            var type = SwimmerAgentType;
            if (!agent || !type.HasValue || LavaAreaMask == 0) return false;
            var filter = SwimmerFilter;
            if (!NavMesh.SamplePosition(ai.transform.position, out var hit, searchRadius, filter)) return false;
            bool was = agent.enabled;
            agent.enabled = false;
            agent.agentTypeID = type.Value;
            agent.areaMask = filter.areaMask;
            ai.transform.position = hit.position;
            agent.enabled = was;
            if (agent.enabled) agent.Warp(hit.position);
            return true;
        }

        static void ForgetSwimmer(EnemyAI ai) => swimmers.Remove(ai);

        /// <summary>这只敌人不受熔岩影响：首领、飞行敌人、熔岩生物（<see cref="MakeSwimmer"/> 或 NavMeshAgent 是 LavaSwimmer 类型）、<see cref="Immunity"/> 判定的</summary>
        public static bool IsImmune(EnemyAI ai) => ai ? IsImmune(ai, ai.GetComponent<NavMeshAgent>()) : true;

        static bool IsImmune(EnemyAI ai, NavMeshAgent agent)
        {
            if (!ai) return true;
            if (ai.Health && ai.Health.IsBoss) return true;
            if (ai is FlyingEnemyAI || swimmers.Contains(ai)) return true;
            if (ai is ILavaDweller d && d.SwimsInLava) return true; // 火鼍等熔岩生物（EN3b，见 InfernoKit）
            var type = SwimmerAgentType;
            if (type.HasValue && agent && agent.agentTypeID == type.Value) return true;
            if (Immunity == null) return false;
            try
            {
                return Immunity(ai);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                return false;
            }
        }

        /// <summary>其它系统不经 <see cref="EnemyAI.Knockback"/> 直接把敌人挪开（脚本拉拽、甩飞）时调用：之后 <see cref="LavaTuning.KnockWindow"/> 秒内落进熔岩算被打进去</summary>
        public static void NoteKnocked(EnemyAI ai)
        {
            if (Instance && ai) Instance.TrackOf(ai).knockAt = Time.time;
        }

        // ═════════════ 运行时 ═════════════

        /// <summary>Play 模式里确保有一个熔岩系统（LavaVolume 启用时调用）</summary>
        public static LavaField Ensure()
        {
            if (Instance) return Instance;
            if (!Application.isPlaying) return null;
            return new GameObject("Lava Field").AddComponent<LavaField>();
        }

        /// <summary>本关玩家踩进熔岩的次数（调试 / 测试）</summary>
        public int Entries { get; private set; }
        /// <summary>本关被打进熔岩烧死的敌人数</summary>
        public int Burned { get; private set; }
        /// <summary>本关被拉回岸上的次数（敌人自己走进熔岩、被涨潮淹到）</summary>
        public int PushedBack { get; private set; }

        sealed class Track
        {
            public Vector3 bank;
            public bool hasBank;
            public float knockAt = float.NegativeInfinity;
            public NavMeshAgent agent;
        }

        readonly Dictionary<EnemyAI, Track> tracks = new();
        readonly List<EnemyAI> scratch = new();
        readonly List<EnemyAI> stale = new();
        readonly LavaContactTracker tracker = new();
        PlayerVitals boundVitals;
        PlayerMotor motor;
        SafeGround safe;
        bool warnedNoSafe;
        float nextPrune;
        Light glow;
        Vector3 lightAt;
        float lightScan, lightWant, emberDebt;
        uint seed = 0x9e3779b9;

        void Awake()
        {
            if (Instance && Instance != this)
            {
                Destroy(this);
                return;
            }
            Instance = this;
        }

        void OnDestroy()
        {
            Bind(null);
            if (Instance == this) Instance = null;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (bodies.Count == 0 || !(dt > 0))
            {
                FadeLight(dt);
                return;
            }
            float now = Time.time;
            UpdatePlayer();
            UpdateEnemies(now);
            UpdateAmbience(dt, now);
        }

        // ───────────── 玩家 ─────────────

        void Bind(PlayerVitals v)
        {
            if (boundVitals == v && (v || !motor)) return;
            if (motor) motor.Teleported -= OnTeleported;
            boundVitals = v;
            motor = v ? v.GetComponent<PlayerMotor>() : null;
            safe = v ? v.GetComponent<SafeGround>() : null;
            if (motor) motor.Teleported += OnTeleported;
            tracker.Reset();
        }

        void OnTeleported() => tracker.Reset();

        void UpdatePlayer()
        {
            var v = PlayerVitals.Instance;
            Bind(v);
            if (!v || !motor || v.Dead)
            {
                tracker.Reset();
                return;
            }
            if (!safe) safe = v.GetComponent<SafeGround>();
            if (safe && safe.Sinking)
            {
                tracker.Reset();
                return;
            }
            var feet = motor.transform.position;
            if (!tracker.Step(bodies, feet, motor.Grounded)) return;
            tracker.Reset();
            Entries++;
            EnterFx(feet);
            if (safe) safe.Sink(HazardSpec.Lava);
            else if (!warnedNoSafe)
            {
                warnedNoSafe = true;
                Debug.LogWarning("[Lava] 玩家身上没有 SafeGround：踩进熔岩不扣血、不托回");
            }
            try
            {
                PlayerEntered?.Invoke(feet);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>踩进熔岩：两团火星 + 贴地冲击环（闪屏、嘶响、晃镜头、扣血在 SafeGround.Sink）</summary>
        static void EnterFx(Vector3 feet)
        {
            float y = TrySurfaceHeight(feet, out float s) ? s : feet.y;
            var p = new Vector3(feet.x, y + 0.1f, feet.z);
            Fx.Burst(p, Orange, 28, 5, 0.9f, 0.11f, -2);
            Fx.Burst(p, Gold, 12, 3, 0.6f, 0.07f, -4);
            Fx.Ring(p, 1.8f, Orange, 0.45f);
        }

        // ───────────── 敌人 ─────────────

        Track TrackOf(EnemyAI ai)
        {
            if (tracks.TryGetValue(ai, out var t)) return t;
            t = new Track { agent = ai.GetComponent<NavMeshAgent>() };
            tracks[ai] = t;
            return t;
        }

        void UpdateEnemies(float now)
        {
            scratch.Clear();
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++) scratch.Add(live[i]);
            foreach (var ai in scratch)
            {
                if (!ai || ai.Dead) continue;
                var tr = TrackOf(ai);
                if (IsImmune(ai, tr.agent)) continue;
                var pos = ai.transform.position;
                // 击退只认明确的信号（同 TS knockedBack）：失控滑行（伤害 / 技能的击退冲量）、被掀飞。
                // 不按「这一帧挪得比导航快」推断——传送、落地吸附、坠落回收、测试里的 Warp 都会被误当成击退，走进熔岩就被烧死
                if (LavaEnemyRule.Knocked(ai.LaunchedUp, ai.KnockedBack)) tr.knockAt = now;
                bool inLava = LavaGeometry.Touches(bodies, pos);
                switch (LavaEnemyRule.Decide(false, inLava, now, tr.knockAt))
                {
                    case LavaEnemyAction.None:
                        // 岸上位置：只记自己在地上走的时候（被掀在熔岩上空的不算）
                        if (!inLava && Walking(tr))
                        {
                            tr.bank = pos;
                            tr.hasBank = true;
                        }
                        break;
                    case LavaEnemyAction.Burn:
                        Burn(ai, pos);
                        tracks.Remove(ai);
                        break;
                    case LavaEnemyAction.PushBack:
                        PushBack(ai, tr, pos);
                        break;
                }
            }
            if (now >= nextPrune)
            {
                nextPrune = now + 2f;
                stale.Clear();
                foreach (var kv in tracks)
                    if (!kv.Key || kv.Key.Dead) stale.Add(kv.Key);
                foreach (var k in stale) tracks.Remove(k);
                swimmers.RemoveWhere(s => !s);
            }
        }

        /// <summary>在导航网格上自己走（不是跳跃 / 冲锋 / 被掀飞这类脚本位移）</summary>
        static bool Walking(Track tr) => tr.agent && tr.agent.enabled && tr.agent.updatePosition;

        /// <summary>自己走进熔岩 / 被涨潮淹到：拉回上一个岸上位置；岸也被淹了就找最近的岸上导航点</summary>
        void PushBack(EnemyAI ai, Track tr, Vector3 pos)
        {
            var to = tr.bank;
            if (!tr.hasBank || LavaGeometry.Touches(bodies, to))
            {
                // 找不到就先不动：EnemyAI 自己的离网回收会兜底
                if (!TryDryNavPoint(pos, out to)) return;
                tr.bank = to;
                tr.hasBank = true;
            }
            Place(ai, tr, to);
            PushedBack++;
        }

        /// <summary>离 pos 最近的、不在熔岩里的导航点（先在非 Lava 区里就近找，再沿熔岩找岸）</summary>
        bool TryDryNavPoint(Vector3 pos, out Vector3 p)
        {
            int mask = DryAreaMask;
            foreach (float r in new[] { 2f, 4f, 8f, 12f })
            {
                if (!NavMesh.SamplePosition(pos, out var hit, r, mask) || LavaGeometry.Touches(bodies, hit.position)) continue;
                p = hit.position;
                return true;
            }
            if (NearestShore(pos, out var shore, 12f) && NavMesh.SamplePosition(shore, out var h2, 2f, mask) && !LavaGeometry.Touches(bodies, h2.position))
            {
                p = h2.position;
                return true;
            }
            p = pos;
            return false;
        }

        static void Place(EnemyAI ai, Track tr, Vector3 p)
        {
            bool far = (p - ai.transform.position).sqrMagnitude > 4f;
            var agent = tr.agent;
            if (agent && agent.enabled && agent.updatePosition && agent.Warp(p))
            {
                if (agent.isOnNavMesh) agent.velocity = Vector3.zero;
            }
            else ai.transform.position = p;
            if (far && ai.TryGetComponent<CreatureLocomotion>(out var loco)) loco.Teleported();
        }

        /// <summary>
        /// 被打进熔岩：两团火星 + 火声，一击处决级的伤害（不弹数字、不暴击、不附着、不引发反应；计击杀、正常掉落）。
        /// 火免疫的敌人（第三章的火属性怪）换成无属性再来一次；还活着（不可选中）就直接处死。掉进熔岩的掉落物 0.45 s 后吸向玩家
        /// </summary>
        void Burn(EnemyAI ai, Vector3 pos)
        {
            var d = ai.Health;
            if (!d || d.Dead) return;
            float y = TrySurfaceHeight(pos, out float s) ? s : pos.y;
            var at = new Vector3(pos.x, y + 0.2f, pos.z);
            Fx.Burst(at, Orange, 30, 6, 1f, 0.13f, -3);
            Fx.Burst(at, Gold, 14, 4, 0.7f, 0.08f, -5);
            GameAudio.PlayAt("skill_fire", at, 0.9f, 0.65f);
            var info = DamageInfo.Simple(DamageCalc.ExecuteBase + Mathf.Max(0, d.health + d.armor + d.shield) * 4, DamageSource.Environment, at, Vector3.up);
            info.element = Element.Fire;
            info.noCrit = true;
            info.depth = 2;
            info.statusChance = 0;
            info.instigator = this;
            Combat.DamageEnemy(d, info);
            if (!d.Dead)
            {
                info.element = Element.None;
                Combat.DamageEnemy(d, info);
            }
            if (!d.Dead) d.Kill(info);
            Burned++;
            StartCoroutine(AttractDrops(at));
            try
            {
                EnemyBurned?.Invoke(ai);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        static IEnumerator AttractDrops(Vector3 at)
        {
            yield return new WaitForSeconds(0.45f);
            Pickup.Attract(at, 5f);
        }

        // ───────────── 点光 · 火星 ─────────────

        void UpdateAmbience(float dt, float t)
        {
            var v = boundVitals;
            if (!v)
            {
                FadeLight(dt);
                return;
            }
            var p = v.transform.position;
            // 点光：每 0.15 s 找玩家 10 m 内最近的熔岩，平滑移过去；附近没有熔岩就熄灭
            lightScan -= dt;
            if (lightScan <= 0)
            {
                lightScan = 0.15f;
                lightWant = NearestLava(p, LightReach, out var lava, out _) ? 1 : 0;
                if (lightWant > 0) lightAt = new Vector3(lava.x, TrySurfaceHeight(lava, out float s) ? s : lava.y, lava.z);
            }
            EnsureLight();
            float k = 1 - Mathf.Exp(-6 * dt);
            if (lightWant > 0)
            {
                var lp = glow.transform.position;
                if (glow.intensity < 0.05f) lp = lightAt;
                lp.x += (lightAt.x - lp.x) * k;
                lp.z += (lightAt.z - lp.z) * k;
                lp.y = lightAt.y + 1.2f;
                glow.transform.position = lp;
            }
            float flicker = 0.85f + 0.15f * Mathf.Sin(t * 9.1f) * Mathf.Sin(t * 5.3f + 1.2f);
            glow.intensity += (lightWant * LightIntensity * flicker - glow.intensity) * k;
            glow.enabled = glow.intensity > 0.02f;

            // 火星：玩家 18 m 内有熔岩时，从附近的熔岩上冒（共用 Fx 的上浮光点发射器）
            if (!NearAnyShape(p, EmberReach))
            {
                emberDebt = 0;
                return;
            }
            emberDebt = Mathf.Min(8, emberDebt + dt * EmberRate * Fx.Density);
            while (emberDebt >= 1)
            {
                emberDebt -= 1;
                EmitEmber(p);
            }
        }

        static bool NearAnyShape(Vector3 p, float r)
        {
            foreach (var b in bodies)
                if (b != null && b.enabled && b.Inset(p.x, p.z) >= -r && p.y - b.level < 30f) return true;
            return false;
        }

        void EmitEmber(Vector3 near)
        {
            for (int k = 0; k < 6; k++)
            {
                float x = near.x + (Rand() - 0.5f) * EmberReach * 2, z = near.z + (Rand() - 0.5f) * EmberReach * 2;
                if (!LavaGeometry.SurfaceAt(bodies, x, z, out float y, out _) || !IsLavaAt(x, z)) continue;
                Fx.Burst(new Vector3(x, y + 0.1f, z), EmberColor, 1, 0.35f, 1.8f + Rand() * 0.8f, 0.14f + Rand() * 0.08f, -0.9f - Rand() * 0.8f);
                return;
            }
        }

        /// <summary>xorshift32：表现用，不占用对局随机数</summary>
        float Rand()
        {
            uint s = seed;
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            seed = s;
            return s / 4294967296f;
        }

        void EnsureLight()
        {
            if (glow) return;
            var go = new GameObject("Lava Light");
            go.transform.SetParent(transform, false);
            glow = go.AddComponent<Light>();
            glow.type = LightType.Point;
            glow.color = LightColor;
            glow.range = LightRange;
            glow.intensity = 0;
            glow.shadows = LightShadows.None;
            glow.enabled = false;
        }

        void FadeLight(float dt)
        {
            if (!glow) return;
            glow.intensity = Mathf.MoveTowards(glow.intensity, 0, dt * LightIntensity * 4);
            glow.enabled = glow.intensity > 0.02f;
        }
    }
}
