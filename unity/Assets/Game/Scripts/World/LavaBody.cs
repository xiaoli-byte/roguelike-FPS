using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>熔岩的平面形状：盒（中心 + 朝向 + 宽 × 长）/ 圆（中心 + 半径）</summary>
    public enum LavaShape { Box, Disc }

    /// <summary>
    /// 熔岩判定的数值（Three.js 版 src/world/Lava.ts 的 LAVA 表里判定用的部分，原样照抄）。
    /// 扣血、下沉、托回、无敌在 <see cref="HazardSpec.Lava"/>（12% + 两跳 1.5%、0.5 s 托回、1 s 无敌），由 <see cref="SafeGround.Sink"/> 执行。
    /// </summary>
    public static class LavaTuning
    {
        /// <summary>脚底离熔岩面多高以内算「站在熔岩上」（LAVA.standRise：高台、掩体顶、跳在半空的不算）</summary>
        public const float StandRise = 0.3f;
        /// <summary>脚底低于熔岩面这么多时不着地也算掉进熔岩（从洞口、崖边直接掉进熔岩井；Unity 新增，TS 的熔岩都是平地）</summary>
        public const float Submerge = 0.15f;
        /// <summary>安全落脚点离熔岩至少多远（LAVA.safeMargin）</summary>
        public const float SafeMargin = 1f;
        /// <summary>敌人被击退后多长时间内落进熔岩算「被打进去」（LAVA.knockWindow）</summary>
        public const float KnockWindow = 0.6f;
        /// <summary>一帧水平位移超过这么多算传送，不做扫掠判定（TS 同为 4 m）</summary>
        public const float TeleportStep = 4f;
        /// <summary>扫掠判定（贴地高速冲刺不能跨过熔岩）的采样间距（米；TS 是 1/4 格 = 0.25 m）</summary>
        public const float SweepStep = 0.25f;
        /// <summary>熔岩面画在判定高度上方多少（防止和平地 z-fight；TS SURFACE_LIFT）</summary>
        public const float SurfaceLift = 0.04f;
        /// <summary>涨潮高出基准面多少时，整片熔岩盖住的地面从导航网格上挖掉（地面敌人绕开）</summary>
        public const float CarveRise = 0.35f;
        /// <summary>查地面时从熔岩面往上多高开始往下打射线（再高的就当成岸上 / 屋顶，不算熔岩边的地面）</summary>
        public const float ProbeTop = 16f;
    }

    /// <summary>
    /// 一片熔岩的判定体（纯数据 + 几何查询，不依赖场景）：<see cref="LavaVolume"/> 持有一份并登记到 <see cref="LavaField"/>，测试直接构造。
    ///   平面形状：盒 / 圆（世界 XZ，绕 Y 转 <see cref="yaw"/> 度）；
    ///   高度：熔岩面 <see cref="level"/>（涨落时由 LavaVolume 改），往下 <see cref="depth"/> 米以内都算熔岩。
    /// 「某点是不是熔岩」= 平面上在形状里，且高度在 [level − depth, level + rise] 之间：湖心岛、堤道、渠上的桥高出熔岩面，自然不算；
    /// 熔岩涨上来淹过的地面（level 升高）自然算。所以湖的形状可以画得比岸线大一圈，岸上的地面靠高度排除。
    /// </summary>
    public sealed class LavaBody
    {
        public LavaShape shape;
        /// <summary>形状中心（世界坐标；只用 XZ）</summary>
        public Vector3 center;
        /// <summary>绕 Y 的朝向（度，同 Transform.eulerAngles.y）：盒的局部 +Z 朝这个方向</summary>
        public float yaw;
        /// <summary>盒：局部 X 宽 × 局部 Z 长（米，全长）；圆：x = 半径</summary>
        public Vector2 size = new(10, 10);
        /// <summary>当前熔岩面高度（世界 y）</summary>
        public float level;
        /// <summary>熔岩面以下多深仍算熔岩（湖床、渠底；再往下是地底的隧道之类，不算）</summary>
        public float depth = 3f;
        public bool enabled = true;
        /// <summary>来源（LavaVolume；测试里为 null）</summary>
        public UnityEngine.Object owner;

        float cachedYaw = float.NaN, cos = 1, sin;

        public LavaBody() { }

        public LavaBody(LavaShape shape, Vector3 center, Vector2 size, float level, float yaw = 0, float depth = 3f)
        {
            this.shape = shape;
            this.center = center;
            this.size = size;
            this.level = level;
            this.yaw = yaw;
            this.depth = depth;
        }

        void Trig()
        {
            if (yaw == cachedYaw) return;
            cachedYaw = yaw;
            float r = yaw * Mathf.Deg2Rad;
            cos = Mathf.Cos(r);
            sin = Mathf.Sin(r);
        }

        /// <summary>世界 XZ → 形状局部坐标（米）</summary>
        public Vector2 ToLocal(float x, float z)
        {
            Trig();
            float dx = x - center.x, dz = z - center.z;
            return new Vector2(dx * cos - dz * sin, dx * sin + dz * cos);
        }

        /// <summary>形状局部坐标 → 世界 XZ（y 取熔岩面）</summary>
        public Vector3 ToWorld(Vector2 local)
        {
            Trig();
            return new Vector3(center.x + local.x * cos + local.y * sin, level, center.z - local.x * sin + local.y * cos);
        }

        /// <summary>盒的半宽 / 半长；圆的 (半径, 半径)</summary>
        public Vector2 HalfExtents => shape == LavaShape.Disc ? new Vector2(size.x, size.x) : size * 0.5f;

        /// <summary>到形状边缘的距离：里面为正（离最近的边多远），外面为负（离形状多远）</summary>
        public float Inset(float x, float z)
        {
            var l = ToLocal(x, z);
            if (shape == LavaShape.Disc) return size.x - l.magnitude;
            var h = size * 0.5f;
            float ax = Mathf.Abs(l.x) - h.x, az = Mathf.Abs(l.y) - h.y;
            if (ax <= 0 && az <= 0) return -Mathf.Max(ax, az);
            return -new Vector2(Mathf.Max(ax, 0), Mathf.Max(az, 0)).magnitude;
        }

        /// <summary>平面上在形状里（margin &gt; 0 = 往外扩）</summary>
        public bool Contains(float x, float z, float margin = 0) => Inset(x, z) >= -margin;

        /// <summary>形状上离 (x, z) 最近的点（在里面就是它自己；y 取熔岩面）</summary>
        public Vector3 ClosestPoint(float x, float z)
        {
            var l = ToLocal(x, z);
            if (shape == LavaShape.Disc)
            {
                if (l.magnitude > size.x) l = l.normalized * size.x;
            }
            else
            {
                var h = size * 0.5f;
                l = new Vector2(Mathf.Clamp(l.x, -h.x, h.x), Mathf.Clamp(l.y, -h.y, h.y));
            }
            return ToWorld(l);
        }

        /// <summary>脚底 feet 站在 / 泡在这片熔岩里：形状内，高度在 [level − depth, level + rise]</summary>
        public bool Touches(Vector3 feet, float rise = LavaTuning.StandRise) =>
            enabled && feet.y <= level + rise && feet.y >= level - depth && Contains(feet.x, feet.z);

        /// <summary>脚底已经低于熔岩面（不着地也算掉进去）</summary>
        public bool Submerged(Vector3 feet) =>
            enabled && feet.y < level - LavaTuning.Submerge && feet.y >= level - depth && Contains(feet.x, feet.z);

        /// <summary>离这片熔岩 margin 米以内（水平往外扩 margin，高度上限也放宽 margin：岸坡上离熔岩面不远的点也算）</summary>
        public bool Near(Vector3 feet, float margin) =>
            enabled && feet.y <= level + LavaTuning.StandRise + margin && feet.y >= level - depth - margin && Contains(feet.x, feet.z, margin);

        /// <summary>世界 XZ 的外接矩形</summary>
        public Rect WorldRect
        {
            get
            {
                var h = HalfExtents;
                if (shape == LavaShape.Disc) return new Rect(center.x - h.x, center.z - h.y, h.x * 2, h.y * 2);
                Trig();
                float ex = Mathf.Abs(h.x * cos) + Mathf.Abs(h.y * sin), ez = Mathf.Abs(h.x * sin) + Mathf.Abs(h.y * cos);
                return new Rect(center.x - ex, center.z - ez, ex * 2, ez * 2);
            }
        }
    }

    /// <summary>
    /// 地面探测：(x, z) 处、高度 [bottom, top] 之间最高的朝上表面。没有返回 false（洞、虚空：熔岩井上方的地形洞就是这样）。
    /// 运行时用物理射线（<see cref="LavaField.Probe"/>），测试注入高度函数。
    /// </summary>
    public delegate bool LavaGroundProbe(float x, float z, float top, float bottom, out float groundY);

    /// <summary>
    /// 一组熔岩的查询（纯逻辑，对 <see cref="LavaBody"/> 列表操作；<see cref="LavaField"/> 的静态查询都转到这里，测试直接调用）。
    /// 只看脚底坐标的查询（Touches / Near / Submerged / Sweep）不打射线；只给 XZ 的查询（IsLavaAt / NearestShore / NearestLava）
    /// 用 <see cref="LavaGroundProbe"/> 找那一点的地面再判。
    /// </summary>
    public static class LavaGeometry
    {
        public static bool Touches(IReadOnlyList<LavaBody> bodies, Vector3 feet, float rise = LavaTuning.StandRise)
        {
            for (int i = 0; i < bodies.Count; i++)
                if (bodies[i] != null && bodies[i].Touches(feet, rise)) return true;
            return false;
        }

        public static bool Submerged(IReadOnlyList<LavaBody> bodies, Vector3 feet)
        {
            for (int i = 0; i < bodies.Count; i++)
                if (bodies[i] != null && bodies[i].Submerged(feet)) return true;
            return false;
        }

        public static bool Near(IReadOnlyList<LavaBody> bodies, Vector3 feet, float margin)
        {
            for (int i = 0; i < bodies.Count; i++)
                if (bodies[i] != null && bodies[i].Near(feet, margin)) return true;
            return false;
        }

        /// <summary>(x, z) 上方哪片熔岩的熔岩面（只看平面形状，不管地面；几片重叠取最高的）。不在任何熔岩上返回 false</summary>
        public static bool SurfaceAt(IReadOnlyList<LavaBody> bodies, float x, float z, out float y, out LavaBody body)
        {
            y = float.NegativeInfinity;
            body = null;
            for (int i = 0; i < bodies.Count; i++)
            {
                var b = bodies[i];
                if (b == null || !b.enabled || !b.Contains(x, z) || b.level <= y) continue;
                y = b.level;
                body = b;
            }
            return body != null;
        }

        /// <summary>
        /// 线段 a → b（脚底，高度线性插值）是否经过熔岩：每 <see cref="LavaTuning.SweepStep"/> 米采一个点（TS segmentOnLava）。
        /// 贴地连续两帧之间的整段都要查——高速冲刺一帧能跨过窄渠
        /// </summary>
        public static bool Sweep(IReadOnlyList<LavaBody> bodies, Vector3 a, Vector3 b, float rise = LavaTuning.StandRise)
        {
            float len = new Vector2(b.x - a.x, b.z - a.z).magnitude;
            int n = Mathf.Max(1, Mathf.CeilToInt(len / LavaTuning.SweepStep));
            for (int k = 0; k <= n; k++)
                if (Touches(bodies, Vector3.Lerp(a, b, k / (float)n), rise)) return true;
            return false;
        }

        /// <summary>
        /// (x, z) 是不是熔岩：在某片熔岩的形状里，且那里的地面（熔岩面上方 <see cref="LavaTuning.ProbeTop"/> 米往下找）不高出熔岩面 standRise；
        /// 下面什么都没有（熔岩井、地形洞）也算。groundY = 地面高度（没有地面时是熔岩面）
        /// </summary>
        public static bool IsLavaAt(IReadOnlyList<LavaBody> bodies, float x, float z, LavaGroundProbe probe, out float groundY)
        {
            groundY = float.NaN;
            if (!SurfaceAt(bodies, x, z, out float surface, out var body)) return false;
            if (probe == null || !probe(x, z, surface + LavaTuning.ProbeTop, surface - body.depth - 0.5f, out float g))
            {
                groundY = surface;
                return true;
            }
            groundY = g;
            return Touches(bodies, new Vector3(x, g, z));
        }

        /// <summary>
        /// 从熔岩里 from 出发，离它最近的、能站的非熔岩点（岸、岛、堤道、桥；一圈圈往外找，每圈按 ~1 m 弧长取方向）。
        /// 找到返回 true，shore = 那一点的地面。火鼍上岸、被涨潮淹到的敌人挪开、托回点找不到时用
        /// </summary>
        public static bool NearestShore(IReadOnlyList<LavaBody> bodies, Vector3 from, float maxDist, LavaGroundProbe probe, out Vector3 shore,
            float step = 0.5f)
        {
            shore = from;
            if (!(maxDist > 0) || probe == null) return false;
            step = Mathf.Max(0.1f, step);
            for (float r = step; r <= maxDist + 1e-4f; r += step)
            {
                int n = Mathf.Max(12, Mathf.CeilToInt(r * Mathf.PI * 2));
                float a0 = r * 0.37f; // 每圈错开起始角，避免方向总偏向 +X
                for (int k = 0; k < n; k++)
                {
                    float a = a0 + k * Mathf.PI * 2 / n;
                    float x = from.x + Mathf.Cos(a) * r, z = from.z + Mathf.Sin(a) * r;
                    if (IsLavaAt(bodies, x, z, probe, out _)) continue;
                    float top = from.y + LavaTuning.ProbeTop;
                    if (SurfaceAt(bodies, x, z, out float s, out _)) top = Mathf.Max(top, s + LavaTuning.ProbeTop);
                    if (!probe(x, z, top, from.y - 40f, out float g)) continue;
                    shore = new Vector3(x, g, z);
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// 从熔岩点 from 朝 to 直线走，第一个不是熔岩的点（TS bankPoint：火鼍扑上岸的落点、岸边鼓泡的位置）。找不到返回 false
        /// </summary>
        public static bool BankToward(IReadOnlyList<LavaBody> bodies, Vector3 from, Vector3 to, float maxDist, LavaGroundProbe probe, out Vector3 bank)
        {
            bank = from;
            var d = new Vector2(to.x - from.x, to.z - from.z);
            float len = d.magnitude;
            if (len < 1e-3f || probe == null) return false;
            d /= len;
            float step = LavaTuning.SweepStep, reach = Mathf.Min(maxDist, len + 1f);
            for (float s = step; s <= reach + 1e-4f; s += step)
            {
                float x = from.x + d.x * s, z = from.z + d.y * s;
                if (IsLavaAt(bodies, x, z, probe, out _)) continue;
                if (!probe(x, z, from.y + LavaTuning.ProbeTop, from.y - 40f, out float g)) continue;
                bank = new Vector3(x, g, z);
                return true;
            }
            return false;
        }

        /// <summary>
        /// 从岸上 from 出发，maxDist 内最近的熔岩点 lava，以及同一方向上紧挨着它的岸边点 bank（祸斗吃熔岩边、熔岩点光、火星用）。
        /// from 本身就在熔岩上时 lava = bank = from 的地面。找不到返回 false
        /// </summary>
        public static bool NearestLava(IReadOnlyList<LavaBody> bodies, Vector3 from, float maxDist, LavaGroundProbe probe, out Vector3 lava, out Vector3 bank,
            float step = 0.75f)
        {
            lava = bank = from;
            if (bodies.Count == 0) return false;
            if (IsLavaAt(bodies, from.x, from.z, probe, out float g0))
            {
                lava = bank = new Vector3(from.x, float.IsNaN(g0) ? from.y : g0, from.z);
                return true;
            }
            // 粗筛：maxDist 内没有任何一片熔岩的形状就不用一圈圈找了
            bool any = false;
            for (int i = 0; i < bodies.Count && !any; i++)
            {
                var b = bodies[i];
                if (b != null && b.enabled && b.Inset(from.x, from.z) >= -maxDist) any = true;
            }
            if (!any) return false;
            step = Mathf.Max(0.1f, step);
            for (float r = step; r <= maxDist + 1e-4f; r += step)
            {
                int n = Mathf.Max(16, Mathf.CeilToInt(r * Mathf.PI * 2 / 1.2f));
                for (int k = 0; k < n; k++)
                {
                    float a = k * Mathf.PI * 2 / n;
                    float cx = Mathf.Cos(a), cz = Mathf.Sin(a);
                    float x = from.x + cx * r, z = from.z + cz * r;
                    if (!IsLavaAt(bodies, x, z, probe, out float g)) continue;
                    lava = new Vector3(x, g, z);
                    // 同一方向往回退，找最后一个不是熔岩的点当岸边
                    bank = from;
                    for (float s = r - LavaTuning.SweepStep; s > 0; s -= LavaTuning.SweepStep)
                    {
                        float bx = from.x + cx * s, bz = from.z + cz * s;
                        if (IsLavaAt(bodies, bx, bz, probe, out _)) continue;
                        bank = probe != null && probe(bx, bz, from.y + LavaTuning.ProbeTop, from.y - 40f, out float bg)
                            ? new Vector3(bx, bg, bz)
                            : new Vector3(bx, from.y, bz);
                        break;
                    }
                    return true;
                }
            }
            return false;
        }
    }

    /// <summary>熔岩面的涨落阶段</summary>
    public enum LavaTidePhase { Low, Warning, Rising, High, Falling }

    /// <summary>
    /// 自动涨落（docs/unity-parity.md D5：熔心魔将原本的「方场熔岩涌动」改成 3-3 熔铜渠的涨落；首领场的熔流也可以用）：
    /// 低位停 lowHold 秒 → 预警 warn 秒（熔岩翻涌发亮、咕嘟声，还没涨）→ rise 秒涨 height 米 → 高位停 highHold 秒 → fall 秒退回，循环。
    /// offset 错开几条渠的相位。
    /// </summary>
    [Serializable]
    public struct LavaTide
    {
        [Tooltip("自动涨落；关掉时熔岩面只听脚本的 RiseTo / Recede")] public bool enabled;
        [Tooltip("涨潮时比基准面高多少（米）")] public float height;
        [Tooltip("低位停留（秒）")] public float lowHold;
        [Tooltip("涨之前的预警（秒）：熔岩翻涌发亮")] public float warn;
        [Tooltip("涨上来用的时间（秒）")] public float rise;
        [Tooltip("高位停留（秒）")] public float highHold;
        [Tooltip("退下去用的时间（秒）")] public float fall;
        [Tooltip("起始相位（秒）：几条渠错开涨落")] public float offset;

        public readonly float Period => Mathf.Max(0, lowHold) + Mathf.Max(0, warn) + Mathf.Max(0, rise) + Mathf.Max(0, highHold) + Mathf.Max(0, fall);

        /// <summary>3-3 熔铜渠的默认节奏：低 8 s、预警 1.5 s、2.5 s 涨 1.2 m、高 5 s、3 s 退</summary>
        public static LavaTide Channel => new() { enabled = true, height = 1.2f, lowHold = 8, warn = 1.5f, rise = 2.5f, highHold = 5, fall = 3 };

        /// <summary>t 秒（自开始计）时的涨幅 0..1（涨 / 退段缓入缓出）与阶段</summary>
        public readonly float Sample(float t, out LavaTidePhase phase)
        {
            float period = Period;
            if (!(period > 0))
            {
                phase = LavaTidePhase.Low;
                return 0;
            }
            float u = Mathf.Repeat(t + offset, period);
            float lo = Mathf.Max(0, lowHold), w = Mathf.Max(0, warn), up = Mathf.Max(0, rise), hi = Mathf.Max(0, highHold), dn = Mathf.Max(0, fall);
            if (u < lo) { phase = LavaTidePhase.Low; return 0; }
            u -= lo;
            if (u < w) { phase = LavaTidePhase.Warning; return 0; }
            u -= w;
            if (u < up) { phase = LavaTidePhase.Rising; return Ease(u / up); }
            u -= up;
            if (u < hi) { phase = LavaTidePhase.High; return 1; }
            u -= hi;
            phase = LavaTidePhase.Falling;
            return dn > 0 ? 1 - Ease(Mathf.Clamp01(u / dn)) : 0;
        }

        public static float Ease(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }

    /// <summary>
    /// 熔岩面高度的推进（纯逻辑，<see cref="LavaVolume"/> 每帧 Step）：脚本的 <see cref="MoveTo"/>（先预警 warn 秒、再缓入缓出地移过去）优先；
    /// 没有脚本移动时按 <see cref="tide"/> 自动涨落。基准面 = 低位（关卡里摆的高度）。
    /// </summary>
    public sealed class LavaLevelDriver
    {
        public LavaTide tide;
        public float BaseLevel { get; }
        public float Level { get; private set; }
        /// <summary>正在去的高度（预警中也已经是新目标：导航网格提前挖掉，敌人先躲）</summary>
        public float Target { get; private set; }
        public LavaTidePhase Phase { get; private set; }
        /// <summary>脚本接管中（RiseTo / Recede 之后，直到 <see cref="ReleaseToTide"/>）</summary>
        public bool Scripted { get; private set; }

        float from, warnLeft, moveT, moveTime, clock;

        public LavaLevelDriver(float baseLevel, LavaTide tide = default)
        {
            BaseLevel = Level = Target = baseLevel;
            this.tide = tide;
            Phase = LavaTidePhase.Low;
        }

        /// <summary>预警 warn 秒后，seconds 秒内移到 target（缓入缓出）；seconds ≤ 0 = 预警完立刻到</summary>
        public void MoveTo(float target, float seconds, float warn = 0)
        {
            if (!float.IsFinite(target)) return;
            Scripted = true;
            from = Level;
            Target = target;
            warnLeft = Mathf.Max(0, float.IsFinite(warn) ? warn : 0);
            moveTime = Mathf.Max(0, float.IsFinite(seconds) ? seconds : 0);
            moveT = 0;
            Phase = warnLeft > 0 ? LavaTidePhase.Warning : Moving();
        }

        /// <summary>立刻设到某高度（脚本接管）</summary>
        public void Snap(float level)
        {
            if (!float.IsFinite(level)) return;
            Scripted = true;
            from = Target = Level = level;
            warnLeft = moveT = moveTime = 0;
            Phase = Settled();
        }

        /// <summary>交还给自动涨落（从低位重新计时）</summary>
        public void ReleaseToTide()
        {
            Scripted = false;
            clock = 0;
        }

        LavaTidePhase Moving() => Target >= from ? LavaTidePhase.Rising : LavaTidePhase.Falling;
        LavaTidePhase Settled() => Level > BaseLevel + 0.01f ? LavaTidePhase.High : LavaTidePhase.Low;

        /// <summary>推进 dt 秒；返回熔岩面高度是否变了</summary>
        public bool Step(float dt)
        {
            if (!(dt > 0)) return false;
            float before = Level;
            if (Scripted)
            {
                if (warnLeft > 0)
                {
                    warnLeft -= dt;
                    if (warnLeft > 0)
                    {
                        Phase = LavaTidePhase.Warning;
                        return false;
                    }
                    dt = -warnLeft;
                    warnLeft = 0;
                }
                if (moveT < moveTime)
                {
                    moveT = Mathf.Min(moveTime, moveT + dt);
                    Level = Mathf.Lerp(from, Target, LavaTide.Ease(moveT / moveTime));
                }
                else Level = Target;
                Phase = Mathf.Approximately(Level, Target) && moveT >= moveTime ? Settled() : Moving();
            }
            else if (tide.enabled && tide.Period > 0)
            {
                clock += dt;
                float k = tide.Sample(clock, out var ph);
                Phase = ph;
                Level = BaseLevel + tide.height * k;
                Target = ph is LavaTidePhase.Warning or LavaTidePhase.Rising or LavaTidePhase.High ? BaseLevel + tide.height : BaseLevel;
            }
            return !Mathf.Approximately(Level, before);
        }

        /// <summary>涨着或将要涨过基准面 <see cref="LavaTuning.CarveRise"/>：盖住的地面应当从导航网格上挖掉</summary>
        public bool Flooding => Mathf.Max(Level, Target) > BaseLevel + LavaTuning.CarveRise;
    }

    /// <summary>
    /// 玩家踩进熔岩的判定（纯逻辑；Three.js LavaSystem.updatePlayer）：
    ///   · 着地（CharacterController 贴地）且脚底在熔岩里（高度在熔岩面 + standRise 以内）→ 踩进去；跳在半空（离地）飞过窄渠不算；
    ///   · 贴地连续两帧：这一帧滑过的整段都查（高速冲刺不能偷渡；冲刺无敌帧也挡不住，见 <see cref="SafeGround"/> 的 Scorch）；
    ///     一帧超过 4 m 的位移是传送（检查点、托回），不算；
    ///   · 脚底已经低于熔岩面（从洞口、崖边掉进熔岩井）不着地也算（Unity 新增）。
    /// 每次踩进都返回一次 true；下沉 / 托回期间由调用方 <see cref="Reset"/>，托回后重新踩进去会再算一次。
    /// </summary>
    public sealed class LavaContactTracker
    {
        Vector3 prev;
        bool prevGrounded, valid;

        /// <summary>忘掉上一帧（传送、托回、下沉中、死亡）：下一帧不做扫掠</summary>
        public void Reset()
        {
            valid = false;
            prevGrounded = false;
        }

        /// <summary>推进一帧：feet = 脚底，grounded = 贴地。返回这一帧是否踩进熔岩</summary>
        public bool Step(IReadOnlyList<LavaBody> bodies, Vector3 feet, bool grounded)
        {
            bool touching = (grounded && LavaGeometry.Touches(bodies, feet)) || LavaGeometry.Submerged(bodies, feet);
            if (!touching && grounded && prevGrounded && valid)
            {
                float step = new Vector2(feet.x - prev.x, feet.z - prev.z).magnitude;
                if (step < LavaTuning.TeleportStep && LavaGeometry.Sweep(bodies, prev, feet)) touching = true;
            }
            prev = feet;
            prevGrounded = grounded;
            valid = true;
            return touching;
        }
    }

    /// <summary>熔岩对一只敌人这一帧要做什么</summary>
    public enum LavaEnemyAction
    {
        /// <summary>不在熔岩里 / 不受熔岩影响（首领、飞行、熔岩生物）</summary>
        None,
        /// <summary>被打进熔岩：烧死</summary>
        Burn,
        /// <summary>自己走进来的（或击退窗口已过）：拉回岸上</summary>
        PushBack,
    }

    /// <summary>
    /// 敌人与熔岩的规则（纯逻辑；Three.js LavaSystem.updateEnemies）：首领、飞行敌人、熔岩生物（火鼍）不受影响；
    /// 被击退（失控滑行、被掀飞）<see cref="LavaTuning.KnockWindow"/> 秒内落进熔岩的非首领地面敌人直接烧死（计击杀、正常掉落）；
    /// 自己走进来的被拉回上一个岸上位置。在熔岩上空飞过（被掀飞、跳跃）的落下之前不算。
    /// </summary>
    public static class LavaEnemyRule
    {
        /// <summary>
        /// 这一帧算不算「正被击退」（记下击退时刻）：只认明确的信号——被掀飞（<see cref="EnemyAI.LaunchedUp"/>）、失控滑行（<see cref="EnemyAI.KnockedBack"/>）。
        /// 同 TS 只看 knockedBack，不按位移速度推断：传送（Warp）、落地吸附、坠落回收这类瞬移不是击退，之后自己走进熔岩照样拉回
        /// </summary>
        public static bool Knocked(bool launchedUp, bool knockedBack) => launchedUp || knockedBack;

        public static LavaEnemyAction Decide(bool immune, bool inLava, float now, float knockAt)
        {
            if (immune || !inLava) return LavaEnemyAction.None;
            return now - knockAt <= LavaTuning.KnockWindow ? LavaEnemyAction.Burn : LavaEnemyAction.PushBack;
        }
    }
}
