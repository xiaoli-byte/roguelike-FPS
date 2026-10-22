using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 软边界的调参（docs/unity-parity.md D14 / L3；Three.js src/world/plateau/walker.ts 的风雪推回）。距离都相对「可玩区遮罩的等值线」（以前立空气墙的那条线），
    /// 往外为正、区内为负：
    ///   · 过了 <see cref="softStart"/> 起风，风力 wind = (d − softStart) / <see cref="windRamp"/>（0..1），把人沿距离场的梯度往回推 (4 + 18 × wind) m/s——
    ///     走路 7.5 m/s 只能顶到 softStart + 2.7 m，连续冲刺也过不了 softStart + 14 m（风力满时推回速度 = 冲刺速度）；
    ///   · 画面白化比推回早 <see cref="hazeLead"/> 米开始，人还没被推就先看到风沙；
    ///   · 再往外 <see cref="failsafe"/> 米才有一圈兜底碰撞（只防技能位移、击飞把人送出去），越过它直接托回安全点；
    ///   · 敌人的导航网格只铺到 <see cref="navInset"/> 米（构建器按 <see cref="NavCell"/> 米的格子挡界外，最远铺到 <see cref="NavReach"/>），
    ///     被击飞 / 冲锋带出去、站到拴绳线 navInset + <see cref="tetherSlack"/> 外的敌人 <see cref="tetherGrace"/> 秒后被拴回来。
    /// </summary>
    [Serializable]
    public struct SoftBoundaryTuning
    {
        /// <summary>等值线外多少米开始起风（米）</summary>
        public float softStart;
        /// <summary>风力从 0 涨到 1 用多少米</summary>
        public float windRamp;
        /// <summary>推回速度 = pushBase + pushGain × 风力（m/s；Three.js 4 + 18）</summary>
        public float pushBase, pushGain;
        /// <summary>白化比起风提前多少米开始</summary>
        public float hazeLead;
        /// <summary>兜底碰撞环离等值线多远（米）；越过它再 3 m 直接托回</summary>
        public float failsafe;
        /// <summary>敌人导航网格铺到等值线外多少米</summary>
        public float navInset;
        /// <summary>敌人在导航边缘外 tetherSlack 米以上（拴绳线），持续 tetherGrace 秒就拴回界内</summary>
        public float tetherSlack, tetherGrace;

        /// <summary>
        /// 界外「不可走」导航体块的格子（米；关卡构建器 LevelKit.Boundary 用）。1 m 时导航网格最远铺到 navInset + 1.4 m，在拴绳线以内；
        /// 以前的 4 m 格子会铺到 navInset + 5.7 m（1-1 界外 +6.8 m 还有网格）
        /// </summary>
        public const float NavCell = 1f;

        /// <summary>挡界外的判定线：格心离等值线超过它的格子标成不可走（= 格子整个在 navInset 外：navInset + 半条对角线）</summary>
        public readonly float NavBlockMargin(float navCell) => navInset + navCell * 0.7072f;

        /// <summary>按 navCell 米的格子挡界外时，导航网格最远铺到离等值线多远（没挡的格子最远的角：判定线 + 半条对角线）</summary>
        public readonly float NavReach(float navCell) => NavBlockMargin(navCell) + navCell * 0.7072f;

        /// <summary>
        /// 离等值线 d 米的敌人在拴绳线外（navInset + tetherSlack），该拴回了——不管脚下有没有导航网格：离网时启用的 NavMeshAgent 会被 Unity
        /// 就近放到网格边上，旧版「在网格上就放宽到 navInset + 2 × tetherSlack」让这样的敌人一直站在风里
        /// </summary>
        public readonly bool TetherOut(float d) => d > navInset + tetherSlack;

        public static SoftBoundaryTuning Default => new()
        {
            softStart = 0, windRamp = 14, pushBase = 4, pushGain = 18, hazeLead = 6, failsafe = 26, navInset = 2, tetherSlack = 2, tetherGrace = 1.2f,
        };

        /// <summary>风力 0..1（距离 d 米处）</summary>
        public readonly float Wind(float d) => windRamp > 0 ? Mathf.Clamp01((d - softStart) / windRamp) : d > softStart ? 1 : 0;

        /// <summary>推回速度（m/s）：没起风为 0，一起风就是 pushBase 起步（同 Three.js：wind &gt; 0 才推）</summary>
        public readonly float Push(float wind) => wind > 0 ? pushBase + pushGain * wind : 0;

        /// <summary>d 米处的推回速度</summary>
        public readonly float PushAt(float d) => Push(Wind(d));

        /// <summary>白化 0..1：softStart − hazeLead 开始，风力过半时满</summary>
        public readonly float Whiteout(float d)
        {
            float a = softStart - hazeLead, b = softStart + windRamp * 0.55f;
            float t = Mathf.Clamp01((d - a) / Mathf.Max(0.01f, b - a));
            return t * t * (3 - 2 * t);
        }

        /// <summary>以 speed（m/s）一直往外顶，最终停在离等值线多远（推回速度 = speed 的位置；走路 7.5 → +2.7 m，冲刺 22 → +14 m，更快 = ∞）</summary>
        public readonly float HoldDepth(float speed)
        {
            if (speed <= pushBase) return softStart;
            if (pushGain <= 0) return float.PositiveInfinity;
            float w = (speed - pushBase) / pushGain;
            return w > 1 ? float.PositiveInfinity : softStart + w * windRamp;
        }

        /// <summary>验收（L5 防越界）的越界判定距离：落到兜底环外才算出去</summary>
        public readonly float EscapeMargin => failsafe + 2f;
    }

    /// <summary>
    /// 可玩区的有符号距离场（米，区内为负）：关卡构建器从可玩区遮罩烘成一张 RFloat 贴图（LevelKit.Boundary），运行时读进内存、双线性采样。
    /// 纹素 (i, j) 对应世界 XZ = origin + (i, j) × cell。贴图范围外按「边上的值 + 到范围的距离」外推（只会更远，不会误判成界内）。
    /// 纯 C#：EditMode 测试直接用数组构造。
    /// </summary>
    public sealed class BoundaryField
    {
        public readonly int width, height;
        public readonly Vector2 origin;
        public readonly float cell;
        readonly float[] d;

        public BoundaryField(float[] data, int width, int height, Vector2 origin, float cell)
        {
            if (data == null || width < 2 || height < 2 || data.Length < width * height) throw new ArgumentException("距离场尺寸不对");
            this.width = width;
            this.height = height;
            this.origin = origin;
            this.cell = Mathf.Max(0.01f, cell);
            d = data;
        }

        /// <summary>覆盖的世界 XZ 范围</summary>
        public Rect Area => new(origin.x, origin.y, (width - 1) * cell, (height - 1) * cell);

        /// <summary>读烘焙好的贴图（RFloat / RHalf / 其他格式按红通道）；贴图不可读时返回 null 并报错</summary>
        public static BoundaryField FromTexture(Texture2D tex, Vector2 origin, float cell)
        {
            if (!tex) return null;
            try
            {
                int n = tex.width * tex.height;
                var data = new float[n];
                if (tex.format == TextureFormat.RFloat)
                {
                    var raw = tex.GetPixelData<float>(0);
                    for (int i = 0; i < n; i++) data[i] = raw[i];
                }
                else if (tex.format == TextureFormat.RHalf)
                {
                    var raw = tex.GetPixelData<ushort>(0);
                    for (int i = 0; i < n; i++) data[i] = Mathf.HalfToFloat(raw[i]);
                }
                else
                {
                    var px = tex.GetPixels();
                    for (int i = 0; i < n; i++) data[i] = px[i].r;
                }
                return new BoundaryField(data, tex.width, tex.height, origin, cell);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Boundary] 距离场贴图 {tex.name} 读不了（要可读的 RFloat，重新生成关卡）：{e.Message}");
                return null;
            }
        }

        /// <summary>(x, z) 处的有符号距离（米，区内为负）</summary>
        public float Sample(float x, float z)
        {
            float fx = (x - origin.x) / cell, fz = (z - origin.y) / cell;
            float cx = Mathf.Clamp(fx, 0, width - 1), cz = Mathf.Clamp(fz, 0, height - 1);
            int i = Mathf.Min((int)cx, width - 2), j = Mathf.Min((int)cz, height - 2);
            float u = cx - i, v = cz - j;
            int k = j * width + i;
            float a = Mathf.Lerp(d[k], d[k + 1], u), b = Mathf.Lerp(d[k + width], d[k + width + 1], u);
            float s = Mathf.Lerp(a, b, v);
            // 范围外：加上到范围的距离
            float ox = (fx - cx) * cell, oz = (fz - cz) * cell;
            if (ox != 0 || oz != 0) s += Mathf.Sqrt(ox * ox + oz * oz);
            return s;
        }

        public float Sample(Vector3 p) => Sample(p.x, p.z);

        /// <summary>距离增大的方向（往外，水平单位向量）；平坦处返回零向量</summary>
        public Vector2 Outward(float x, float z, float e = 1.5f)
        {
            float gx = Sample(x + e, z) - Sample(x - e, z), gz = Sample(x, z + e) - Sample(x, z - e);
            float l = Mathf.Sqrt(gx * gx + gz * gz);
            return l > 1e-5f ? new Vector2(gx / l, gz / l) : Vector2.zero;
        }

        /// <summary>往界内的方向（水平单位向量）</summary>
        public Vector2 Inward(float x, float z) => -Outward(x, z);

        /// <summary>从 (x, z) 沿梯度走到距离 target 的位置（迭代几步，到不了就停在最后一步）</summary>
        public Vector2 MoveToDistance(float x, float z, float target, int steps = 6)
        {
            var p = new Vector2(x, z);
            for (int i = 0; i < steps; i++)
            {
                float s = Sample(p.x, p.y) - target;
                if (Mathf.Abs(s) < 0.05f) break;
                var o = Outward(p.x, p.y);
                if (o == Vector2.zero) break;
                p -= o * s;
            }
            return p;
        }
    }

    /// <summary>
    /// 拴绳的落点（纯逻辑：地面高度、导航采样由调用方注入——运行时 <see cref="BoundaryZone"/> 用地形 / 物理射线 + NavMesh.SamplePosition，EditMode 测试用函数）。
    /// 沿距离场梯度退回导航边缘内 <see cref="Depths"/> 米，先在那一点的<b>地面</b>附近找导航点，再按敌人自己的高度找；都找不到时退回敌人最后站过的导航点
    /// （离网之前的位置）。不能只按敌人的高度找：界外是抬高几米到十几米的沙海 / 大沙丘，按界外的高度在界内上空采 8 m 球会整片落空——
    /// 1-1 的跳鼠放到 +10 m 的沙丘上离网 2.7 s 没被拴回（playtest world），旧版只按敌人高度采样、找不到就每 0.25 s 原样重试。落点必须在导航边缘以内（不能拴回到风里）。
    /// </summary>
    public static class BoundaryTether
    {
        /// <summary>(x, z) 处的地面高度；没有地面返回 false</summary>
        public delegate bool GroundProbe(float x, float z, out float y);
        /// <summary>near 附近 radius 米内最近的导航网格点；没有返回 false</summary>
        public delegate bool NavSample(Vector3 near, float radius, out Vector3 hit);

        /// <summary>往界内退的深度（米，相对导航边缘 navInset；由浅到深）</summary>
        public static readonly float[] Depths = { 3f, 6f, 10f, 16f };
        /// <summary>在地面点附近找导航点的半径（米）</summary>
        public const float GroundRadius = 4f;
        /// <summary>按敌人自己的高度找导航点的半径（米；没有地面探测或地面附近没有网格时）</summary>
        public const float WideRadius = 8f;

        /// <summary>
        /// 从界外 from 拴回的落点 to（导航网格上、离等值线不超过 navInset）。hasLast / last = 敌人最后站过的导航点（兜底，离等值线不超过 navInset + tetherSlack 才用）
        /// </summary>
        public static bool FindPoint(BoundaryField field, in SoftBoundaryTuning t, Vector3 from, GroundProbe ground, NavSample nav, bool hasLast, Vector3 last,
            out Vector3 to)
        {
            to = from;
            if (field == null || nav == null) return false;
            float edge = t.navInset;
            foreach (float depth in Depths)
            {
                var back = field.MoveToDistance(from.x, from.z, edge - depth);
                if (!(field.Sample(back.x, back.y) <= edge)) continue; // 梯度平坦处走不回来
                float gy = from.y;
                if (ground != null && ground(back.x, back.y, out gy) && float.IsFinite(gy) && Try(field, edge, nav, new Vector3(back.x, gy, back.y), GroundRadius, out to))
                    return true;
                if (Try(field, edge, nav, new Vector3(back.x, from.y, back.y), WideRadius, out to)) return true;
            }
            if (hasLast && float.IsFinite(last.x) && Try(field, edge + t.tetherSlack, nav, last, GroundRadius, out to)) return true;
            to = from;
            return false;
        }

        static bool Try(BoundaryField field, float limit, NavSample nav, Vector3 near, float radius, out Vector3 hit)
        {
            if (nav(near, radius, out hit) && float.IsFinite(hit.x) && float.IsFinite(hit.y) && float.IsFinite(hit.z) && field.Sample(hit.x, hit.z) <= limit) return true;
            hit = near;
            return false;
        }
    }

    /// <summary>
    /// 软边界（docs/unity-parity.md D14 / L3，替代 1-1 的空气墙）：读关卡烘好的有符号距离场（<see cref="BoundaryField"/>），每帧
    ///   · 玩家：过了起风线就沿梯度把人往回推 (4 + 18 × 风力) m/s（直接移动角色控制器，照常被地形挡），并给 <see cref="WeatherDirector"/> 白化强度；
    ///     越过兜底环（离等值线 <see cref="SoftBoundaryTuning.failsafe"/> + 3 m）直接托回安全点（不扣血）；
    ///   · 敌人：导航网格只铺到 navInset（构建器用 NavMeshModifierVolume 把界外标成不可走，寻路自然绕开）；被击飞 / 冲锋带出网格的，
    ///     离开超过 tetherGrace 秒就沿梯度拉回界内最近的网格点（拴绳；落点在那里的地面上找，见 <see cref="BoundaryTether"/>）。
    /// 场景里只有一个（关卡构建器 LevelKit.Boundary 放）；其他系统用静态查询：<see cref="Distance"/>、<see cref="InsideArea"/>、<see cref="PlayerWind"/>。
    /// 远处兜底碰撞环由构建器另外立在 Ignore Raycast 层（子弹、视线穿过），这里不管。
    /// </summary>
    [DefaultExecutionOrder(50)]
    [DisallowMultipleComponent]
    public sealed class BoundaryZone : MonoBehaviour
    {
        /// <summary>有符号距离场（RFloat，米，区内为负）</summary>
        public Texture2D sdf;
        /// <summary>纹素 (0, 0) 的世界 XZ</summary>
        public Vector2 origin;
        /// <summary>纹素间距（米）</summary>
        public float cell = 2f;
        public SoftBoundaryTuning tuning = SoftBoundaryTuning.Default;
        /// <summary>章节主题（Desert / Frost / Inferno）：白化用哪套天气（风沙 / 风雪 / 烟尘）</summary>
        public string theme = "Desert";

        static readonly int SdfId = Shader.PropertyToID("_BoundarySDF"), SdfParamsId = Shader.PropertyToID("_BoundarySDFParams");
        const float TetherInterval = 0.25f;

        public static BoundaryZone Active { get; private set; }
        /// <summary>玩家所在处的风力 0..1（软边界）</summary>
        public static float PlayerWind { get; private set; }
        /// <summary>玩家所在处的白化 0..1（平滑过的，天气导演读）</summary>
        public static float PlayerWhiteout { get; private set; }
        /// <summary>玩家离等值线的距离（米，区内为负；没有软边界时 −∞）</summary>
        public static float PlayerDistance { get; private set; } = float.NegativeInfinity;
        /// <summary>本关被兜底托回的次数（测试用）</summary>
        public static int FailsafeRecoveries { get; private set; }
        /// <summary>本关被拴回界内的敌人次数（测试用）</summary>
        public static int Tethered { get; private set; }
        /// <summary>最近一次拴绳失败的原因（成功后清空；冒烟套件失败时打印）</summary>
        public static string LastTetherFailure { get; private set; }
        /// <summary>拴绳诊断（冒烟套件失败时打印）：检查了几轮、累计看过几只敌人、累计判了几次出界</summary>
        public static int TetherTicks { get; private set; }
        public static int TetherExamined { get; private set; }
        public static int TetherMarkedOut { get; private set; }
        /// <summary>最近一只站在导航边缘外（离等值线 &gt; navInset）的敌人在拴绳检查里的样子（跳过的原因、距离、在不在网格上、出界多久）</summary>
        public static string LastTetherSeen { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Active = null;
            PlayerWind = PlayerWhiteout = 0;
            PlayerDistance = float.NegativeInfinity;
            FailsafeRecoveries = Tethered = 0;
            ResetTetherStats();
        }

        static void ResetTetherStats()
        {
            LastTetherFailure = LastTetherSeen = null;
            TetherTicks = TetherExamined = TetherMarkedOut = 0;
        }

        BoundaryField field;
        PlayerVitals vitalsFor;
        CharacterController cc;
        PlayerMotor motor;
        float tetherTimer, lastFailsafe = -10;
        readonly Dictionary<EnemyAI, float> outside = new();
        IDisposable hazard;
        readonly List<EnemyAI> drop = new();

        public BoundaryField Field => field ??= BoundaryField.FromTexture(sdf, origin, cell);

        /// <summary>某点离等值线的距离（米，区内为负）；没有软边界时 −∞（处处算界内）</summary>
        public static float Distance(Vector3 p) => Active && Active.Field != null ? Active.Field.Sample(p.x, p.z) : float.NegativeInfinity;

        /// <summary>某点在可玩区里（离等值线不超过 margin 米）</summary>
        public static bool InsideArea(Vector3 p, float margin = 0) => Distance(p) <= margin;

        /// <summary>某点往界内的水平方向（没有软边界时为零）</summary>
        public static Vector3 InwardAt(Vector3 p)
        {
            if (!Active || Active.Field == null) return Vector3.zero;
            var g = Active.Field.Inward(p.x, p.z);
            return new Vector3(g.x, 0, g.y);
        }

        void OnEnable()
        {
            if (Active && Active != this) Debug.LogWarning($"[Boundary] 场景里有两个软边界（{Active.name} / {name}），用后一个");
            Active = this;
            FailsafeRecoveries = Tethered = 0;
            ResetTetherStats();
            // 起风线外不记安全落脚点：托回（坠落、熔岩、兜底）永远落在界内，不会一落地又被风推
            hazard ??= SafeGround.RegisterHazard(feet => Field != null && Field.Sample(feet.x, feet.z) > tuning.softStart);
            if (Field == null) Debug.LogError("[Boundary] 没有距离场贴图：软边界不生效（重新生成关卡）");
            else if (sdf)
            {
                var a = field.Area;
                Shader.SetGlobalTexture(SdfId, sdf);
                Shader.SetGlobalVector(SdfParamsId, new Vector4(a.xMin, a.yMin, 1f / Mathf.Max(1, a.width), 1f / Mathf.Max(1, a.height)));
            }
        }

        void Start() => WeatherDirector.Ensure(theme);

        void OnDisable()
        {
            hazard?.Dispose();
            hazard = null;
            if (Active != this) return;
            Active = null;
            PlayerWind = PlayerWhiteout = 0;
            PlayerDistance = float.NegativeInfinity;
            Shader.SetGlobalTexture(SdfId, Texture2D.blackTexture);
            outside.Clear();
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (Field == null || !(dt > 0)) return;
            UpdatePlayer(dt);
            tetherTimer -= dt;
            if (tetherTimer <= 0)
            {
                tetherTimer = TetherInterval;
                TetherEnemies(TetherInterval);
            }
        }

        // ───────────── 玩家 ─────────────

        void UpdatePlayer(float dt)
        {
            var vitals = PlayerVitals.Instance;
            if (vitals != vitalsFor)
            {
                vitalsFor = vitals;
                cc = vitals ? vitals.GetComponent<CharacterController>() : null;
                motor = vitals ? vitals.GetComponent<PlayerMotor>() : null;
            }
            if (!vitals || vitals.Dead)
            {
                PlayerWind = 0;
                PlayerWhiteout = Mathf.MoveTowards(PlayerWhiteout, 0, dt * 2f);
                return;
            }
            var p = vitals.transform.position;
            float d = field.Sample(p.x, p.z);
            PlayerDistance = d;
            float w = tuning.Wind(d);
            PlayerWind = w;
            // 白化跟着走，但不一帧跳变（被托回 / 传送时慢慢散开）
            PlayerWhiteout = Mathf.MoveTowards(PlayerWhiteout, tuning.Whiteout(d), dt * 1.6f);

            if (d > tuning.failsafe + 3f)
            {
                // 技能位移 / 击飞把人送过了兜底环：直接托回（不扣血）
                if (Time.time - lastFailsafe > 1f && SafeGround.Instance)
                {
                    lastFailsafe = Time.time;
                    FailsafeRecoveries++;
                    SafeGround.Instance.Recover(FailsafeSpec);
                }
                return;
            }
            if (w <= 0 || !cc || !cc.enabled) return;
            var g = field.Inward(p.x, p.z);
            if (g == Vector2.zero) return;
            // 站在地上时带一点向下分量（往回推多半是下沙丘坡），不让人被推得离地小跳
            float step = tuning.Push(w) * dt;
            bool grounded = motor && motor.OnWalkableGround;
            cc.Move(new Vector3(g.x * step, grounded ? -step : 0, g.y * step));
        }

        /// <summary>越过兜底环的托回：不扣血、风沙色闪屏、1 s 无敌</summary>
        static HazardSpec FailsafeSpec => new()
        {
            burst = 0, tick = 0, tickTimes = Array.Empty<float>(), sinkTime = 0, grace = 1f, element = Element.None,
            flash = new Color(0.9f, 0.8f, 0.62f, 0.6f), sound = "dash",
        };

        // ───────────── 敌人拴绳 ─────────────

        void TetherEnemies(float dt)
        {
            var live = EnemyRegistry.Live;
            drop.Clear();
            foreach (var kv in outside)
                if (!kv.Key || kv.Key.Dead)
                    drop.Add(kv.Key);
            foreach (var e in drop) outside.Remove(e);
            TetherTicks++;
            for (int i = 0; i < live.Count; i++)
            {
                var ai = live[i];
                if (!ai || ai.Dead) continue;
                var agent = ai.GetComponent<NavMeshAgent>();
                if (!agent) continue;
                TetherExamined++;
                var p = ai.transform.position;
                float d = field.Sample(p.x, p.z);
                // 飞行敌人不走网格；脚本位移（跳跃、冲锋、被掀飞）期间 updatePosition 关着，落地后再看
                bool skip = !agent.enabled || !agent.updatePosition;
                // 拴绳线外就算出界，在不在网格上都一样（离网时启用的 agent 会被 Unity 就近放到界外的网格边上，见 TetherOut）
                bool off = !skip && tuning.TetherOut(d);
                if (d > tuning.navInset)
                {
                    outside.TryGetValue(ai, out float was);
                    LastTetherSeen = $"{ai.enemyId} 在 {d:+0.0;-0.0} m（{p}）：agent 启用 {agent.enabled}、updatePosition {agent.updatePosition}、" +
                                     $"在网格上 {agent.isOnNavMesh}、{(skip ? "跳过（脚本位移中）" : off ? $"出界 {was + dt:F2} s" : "在拴绳线以内")}";
                }
                if (!off)
                {
                    if (!skip) outside.Remove(ai);
                    continue;
                }
                TetherMarkedOut++;
                outside.TryGetValue(ai, out float t);
                t += dt;
                outside[ai] = t;
                if (t >= tuning.tetherGrace && Tether(ai, agent, p)) outside.Remove(ai);
            }
        }

        static readonly BoundaryTether.GroundProbe groundProbe = ProbeGround;
        static readonly BoundaryTether.NavSample navSample = SampleNav;
        static readonly Color DustColor = new(0.86f, 0.74f, 0.55f);

        /// <summary>沿梯度回到导航边缘以内，在那里的地面附近找网格点传过去（见 <see cref="BoundaryTether"/>）；找不到时下次再试</summary>
        bool Tether(EnemyAI ai, NavMeshAgent agent, Vector3 p)
        {
            bool hasLast = ai.TryLastOnMesh(out var last);
            if (!BoundaryTether.FindPoint(field, tuning, p, groundProbe, navSample, hasLast, last, out var to))
            {
                LastTetherFailure = $"{ai.enemyId}：界内找不到落点（从 {p}，最后在网格上 {(hasLast ? last.ToString() : "无")}）";
                return false;
            }
            ai.transform.position = to;
            if (!agent.Warp(to))
            {
                // 离网时启用的 agent 没建起来（Unity 只给一条警告、不进网格）：关掉在新位置重开
                agent.enabled = false;
                ai.transform.position = to;
                agent.enabled = true;
                if (!agent.isOnNavMesh)
                {
                    LastTetherFailure = $"{ai.enemyId}：落点 {to} 传送失败、重开 agent 也没进网格（距边界 {field.Sample(to.x, to.z):+0.0;-0.0} m）";
                    return false;
                }
            }
            LastTetherFailure = null;
            Fx.Burst(p + Vector3.up * 0.6f, DustColor, 10, 3, 0.6f, 0.3f);
            // 先回到网格上再打断（打断时子类可能要停 agent，离网时调会报错）
            ai.InterruptAttack();
            var loco = ai.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
            Fx.Burst(to + Vector3.up * 0.6f, DustColor, 10, 3, 0.6f, 0.3f);
            Tethered++;
            return true;
        }

        static bool SampleNav(Vector3 near, float radius, out Vector3 hit)
        {
            if (NavMesh.SamplePosition(near, out var h, radius, NavMesh.AllAreas))
            {
                hit = h.position;
                return true;
            }
            hit = near;
            return false;
        }

        /// <summary>地面高度：地形（不落在道具顶上）；不在地形范围里就从高处往下打射线</summary>
        static bool ProbeGround(float x, float z, out float y)
        {
            var t = Terrain.activeTerrain;
            if (t && t.terrainData)
            {
                var o = t.transform.position;
                var size = t.terrainData.size;
                if (x >= o.x && x <= o.x + size.x && z >= o.z && z <= o.z + size.z)
                {
                    y = t.SampleHeight(new Vector3(x, 0, z)) + o.y;
                    return true;
                }
            }
            if (Physics.Raycast(new Vector3(x, 500f, z), Vector3.down, out var hit, 1000f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                y = hit.point.y;
                return true;
            }
            y = 0;
            return false;
        }
    }
}
