using System;
using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>到达一处要用到的最强移动能力（由弱到强；同一处取最弱的那个）</summary>
    public enum Move : byte
    {
        Walk = 0,
        /// <summary>单跳（含助跑跳、走下台沿）</summary>
        Jump = 1,
        /// <summary>冲刺（含跳 + 冲刺、冲刺跳）</summary>
        Dash = 2,
        /// <summary>二段跳（鼯、「额外跳跃」秘卷）：主线不能依赖</summary>
        DoubleJump = 3,
        None = 255,
    }

    /// <summary>
    /// 玩家尺度表（docs/level-design/unity-maps-v1.md 第 0 节）：运动数值就是 <see cref="MotorTuning"/>（H1 的纯 C# 运动核心用的那一份），
    /// 角色控制器尺寸同 PlayerFactory。场景里有玩家（测试场）时读它身上的 PlayerMotor / CharacterController；关卡场景（L1 起玩家在 Core 场景）用缺省值。
    /// </summary>
    public sealed class MoveScale
    {
        public MotorTuning tuning = MotorTuning.Default;
        public float stepOffset = 0.45f, slopeLimit = 45f, radius = 0.35f, height = 1.8f, eye = PlayerFactory.EyeHeight;

        public float JumpHeight => tuning.jumpVelocity * tuning.jumpVelocity / (2 * tuning.gravity);
        public float DoubleJumpHeight => JumpHeight + Sq(tuning.jumpVelocity * tuning.airJumpMult) / (2 * tuning.gravity);
        public float DashDistance => tuning.dashSpeed * tuning.dashTime;
        static float Sq(float v) => v * v;

        /// <summary>读场景里玩家的 PlayerMotor / CharacterController（没有则缺省值）</summary>
        public static MoveScale FromScene()
        {
            var s = new MoveScale();
            var motor = Object.FindAnyObjectByType<PlayerMotor>();
            if (!motor) return s;
            var t = s.tuning;
            t.walkSpeed = motor.walkSpeed;
            t.groundAccel = motor.groundAccel;
            t.groundFriction = motor.groundFriction;
            t.airAccel = motor.airAccel;
            t.airDrag = motor.airDrag;
            t.overspeedGround = motor.overspeedDecelGround;
            t.overspeedAir = motor.overspeedDecelAir;
            t.gravity = motor.gravity;
            t.maxFallSpeed = motor.maxFallSpeed;
            t.jumpVelocity = motor.jumpVelocity;
            t.airJumpMult = motor.airJumpMult;
            t.airJumpRedirect = motor.airJumpRedirect;
            t.coyoteTime = motor.coyoteTime;
            t.jumpBuffer = motor.jumpBuffer;
            t.dashSpeed = motor.dashSpeed;
            t.dashTime = motor.dashTime;
            t.dashExitKeep = motor.dashExitKeep;
            t.dashLockout = motor.dashLockout;
            s.tuning = t;
            var cc = motor.GetComponent<CharacterController>();
            if (cc)
            {
                s.stepOffset = cc.stepOffset;
                s.slopeLimit = cc.slopeLimit;
                s.radius = cc.radius;
                s.height = cc.height;
            }
            if (motor.eye) s.eye = motor.eye.position.y - motor.transform.position.y;
            return s;
        }

        public override string ToString() =>
            $"移速 {tuning.walkSpeed:F1} m/s · 单跳 {JumpHeight:F2} m · 二段跳 {DoubleJumpHeight:F2} m · 冲刺 {DashDistance:F2} m · 台阶 {stepOffset:F2} m · 坡度 ≤ {slopeLimit:F0}°";
    }

    /// <summary>
    /// 起跳包络：从台沿助跑离开（或冲刺中离开），各能力档位在水平距离 d 处能达到的最高高度（相对起跳面）。
    /// 直接用 H1 的运动核心 <see cref="MotorCore"/> 在「台沿世界」（x ≤ 0 是地面、x &gt; 0 是空）里逐帧模拟——空中阻力、超速回落、
    /// 跳跃打断冲刺带着余速起跳、冲刺期间不下坠、土狼时间都和游戏里一模一样；对起跳点、冲刺时机、二段跳时机穷举取上包络。
    /// 水平速度可以放慢、冲刺可以斜着冲，所以 d 处可达 = 更远处能达到的高度的后缀最大值；包络以下的落点都算够得着。
    /// </summary>
    public sealed class JumpEnvelope
    {
        public const float Bin = 0.1f, MaxDistance = 20f;
        const float Floor = -60f, Fps = 120f;
        readonly float[][] env = new float[4][];
        readonly float[] reach = new float[4];

        /// <summary>该档位在水平距离 d 处能达到的最高相对高度（够不着为负无穷）</summary>
        public float Height(Move m, float d)
        {
            if (m == Move.None || d > MaxDistance) return float.NegativeInfinity;
            int i = Mathf.Clamp(Mathf.FloorToInt(d / Bin), 0, env[(int)m].Length - 1);
            return env[(int)m][i];
        }

        /// <summary>该档位最远水平距离（落到起跳面以下 60 m 之内）</summary>
        public float Reach(Move m) => m == Move.None ? 0 : reach[(int)m];

        /// <summary>同高度（落点不低于起跳面）最远能跨多远</summary>
        public float LevelReach(Move m)
        {
            var e = env[(int)m];
            for (int i = e.Length - 1; i >= 0; i--)
                if (e[i] >= 0) return i * Bin;
            return 0;
        }

        /// <summary>一条轨迹的动作：按到台沿的距离 x 触发（NaN = 不做）；冲刺 / 二段跳也可以按起跳后的秒数触发</summary>
        struct Plan
        {
            public float jumpX, dashX, dashAfterJump, airJumpAfter;

            public static Plan None => new() { jumpX = float.NaN, dashX = float.NaN, dashAfterJump = float.NaN, airJumpAfter = float.NaN };
        }

        public static JumpEnvelope Build(MoveScale s)
        {
            var o = new JumpEnvelope();
            int n = Mathf.CeilToInt(MaxDistance / Bin) + 1;
            for (int t = 0; t < 4; t++)
            {
                o.env[t] = new float[n];
                for (int i = 0; i < n; i++) o.env[t][i] = float.NegativeInfinity;
            }
            // 起跳点：台沿前 2 m 内，或刚离开台沿（土狼时间）
            var jumpXs = new[] { -2f, -1.4f, -0.8f, -0.3f, 0f, 0.35f, 0.7f };
            var plans = new List<(Plan p, int tier)> { (Plan.None, 0) };
            foreach (var jx in jumpXs)
            {
                var p = Plan.None;
                p.jumpX = jx;
                plans.Add((p, 1));
                // 跳起后冲刺
                for (float d = 0; d <= 0.9f; d += 0.05f)
                {
                    var q = p;
                    q.dashAfterJump = d;
                    plans.Add((q, 2));
                }
            }
            // 地面冲刺：冲下台沿，或冲刺中起跳（跳跃打断冲刺，带余速）
            foreach (var dx in new[] { -4f, -3f, -2f, -1f, -0.4f, 0f })
            {
                var p = Plan.None;
                p.dashX = dx;
                plans.Add((p, 2));
                foreach (var jx in jumpXs)
                {
                    if (jx <= dx || jx > dx + 4.2f) continue;
                    var q = p;
                    q.jumpX = jx;
                    plans.Add((q, 2));
                }
            }
            // 二段跳：以上每一种 × 第一次起跳（没起跳的按离开台沿）后再跳的时机
            int count = plans.Count;
            for (int i = 0; i < count; i++)
                for (float a = 0.05f; a <= 0.9f; a += 0.06f)
                {
                    var q = plans[i].p;
                    q.airJumpAfter = a;
                    plans.Add((q, 3));
                }
            foreach (var (p, tier) in plans) Sim(s.tuning, o.env[tier], p);
            for (int t = 0; t < 4; t++)
            {
                var e = o.env[t];
                if (t > 0)
                    for (int i = 0; i < n; i++) e[i] = Mathf.Max(e[i], o.env[t - 1][i]);
                // 后缀最大值：远处能到的高度，放慢水平速度在近处也能到
                for (int i = n - 2; i >= 0; i--) e[i] = Mathf.Max(e[i], e[i + 1]);
                o.reach[t] = 0;
                for (int i = n - 1; i >= 0; i--)
                    if (e[i] > Floor) { o.reach[t] = i * Bin; break; }
            }
            return o;
        }

        /// <summary>
        /// 台沿世界里跑一条轨迹：从 x = −6 以跑速朝 +x 按住前进，x ≤ 0 有地面（y = 0，同 MotorTests 的平地吸附），x &gt; 0 是空的；
        /// 离开地面之后每帧把 (x, y) 记进 raw 的距离格里取最大。
        /// </summary>
        static void Sim(MotorTuning t, float[] raw, Plan plan)
        {
            const float dt = 1f / Fps;
            var core = new MotorCore();
            t.airJumps = float.IsNaN(plan.airJumpAfter) ? 0 : 1;
            t.dashCharges = 1;
            core.t = t;
            core.dashCharge = 1;
            core.ResetMotion(true);
            core.velocity = new Vector3(t.walkSpeed, 0, 0);
            var pos = new Vector3(-6f, 0, 0);
            bool jumped = false, dashed = false, airJumped = false, left = false;
            float jumpTime = float.NaN, leaveTime = float.NaN, time = 0;
            for (int frame = 0; frame < Fps * 3; frame++, time += dt)
            {
                var input = new MotorInput { wish = Vector3.right, facing = Vector3.right };
                if (!jumped && !float.IsNaN(plan.jumpX) && pos.x >= plan.jumpX)
                {
                    input.jumpPressed = input.jumpHeld = true;
                    jumped = true;
                    jumpTime = time;
                }
                float since = !float.IsNaN(jumpTime) ? time - jumpTime : time - leaveTime;
                if (!dashed && ((!float.IsNaN(plan.dashX) && pos.x >= plan.dashX) ||
                                (!float.IsNaN(plan.dashAfterJump) && !float.IsNaN(jumpTime) && time - jumpTime >= plan.dashAfterJump)))
                {
                    input.dashPressed = true;
                    dashed = true;
                }
                if (!airJumped && !float.IsNaN(plan.airJumpAfter) && left && since >= plan.airJumpAfter && !input.jumpPressed)
                {
                    input.jumpPressed = input.jumpHeld = true;
                    airJumped = true;
                }
                var f = MotorFrame.Neutral(t);
                f.grounded = core.grounded;
                f.velocity = core.velocity;
                f.dashing = core.dashing;
                f.jumpHeld = input.jumpHeld;
                f.jumpPressed = input.jumpPressed;
                f.dt = dt;
                f.Sanitize(t);
                var r = core.Step(input, f, dt);
                var p = pos + r.delta;
                bool ground = false;
                if (p.x <= 0 && (p.y <= 0 || (r.snap && p.y <= 0.45f)))
                {
                    p.y = 0;
                    ground = true;
                }
                core.AfterMove(new MotorFeedback { touching = ground, groundNormal = Vector3.up, intended = r.delta, actual = p - pos }, dt, out _);
                pos = p;
                if (!left && pos.x > 0)
                {
                    left = true;
                    leaveTime = time;
                }
                if (!left) continue;
                int i = Mathf.FloorToInt(pos.x / Bin);
                if (i >= raw.Length || pos.y < Floor) break;
                if (pos.y > raw[i]) raw[i] = pos.y;
            }
        }
    }

    /// <summary>
    /// 可站立面栅格：验收区域按 cell 米切成竖列，每列从上往下逐层打射线，记下最多 4 层「能站」的面
    /// （坡度 ≤ slopeLimit，且站上去 1.8 m 高的胶囊不和任何东西重叠）。桥下、拱下这种上下两层的地方各算一层。
    /// 不可见的边界墙（Ignore Raycast 层）不算可站立面，挡不挡路由洪泛时的掩码决定。
    /// </summary>
    public sealed class ReachGrid
    {
        public const int MaxSpans = 4;
        public readonly Rect area;
        public readonly float cell;
        public readonly int nx, nz;
        /// <summary>每列第一层的下标、层数（层按高度从高到低）</summary>
        public readonly int[] colStart;
        public readonly byte[] colCount;
        public readonly float[] spanY, spanNy;
        public readonly int[] spanCol;
        /// <summary>每列中心是否在可玩区内、到界内最近一列的距离（米）；没有遮罩时为 null</summary>
        public readonly bool[] inside;
        public readonly float[] outsideDist;

        public int Columns => nx * nz;
        public int Spans => spanY.Length;

        ReachGrid(Rect area, float cell)
        {
            this.area = area;
            this.cell = cell;
            nx = Mathf.Max(1, Mathf.CeilToInt(area.width / cell));
            nz = Mathf.Max(1, Mathf.CeilToInt(area.height / cell));
            colStart = new int[nx * nz];
            colCount = new byte[nx * nz];
        }

        ReachGrid(ReachGrid g, List<float> ys, List<float> nys, List<int> cols, bool[] inside, float[] outsideDist) : this(g.area, g.cell)
        {
            Array.Copy(g.colStart, colStart, colStart.Length);
            Array.Copy(g.colCount, colCount, colCount.Length);
            spanY = ys.ToArray();
            spanNy = nys.ToArray();
            spanCol = cols.ToArray();
            this.inside = inside;
            this.outsideDist = outsideDist;
        }

        public Vector2 ColumnCenter(int c) => new(area.xMin + (c % nx + 0.5f) * cell, area.yMin + (c / nx + 0.5f) * cell);

        public int Column(Vector2 xz)
        {
            int x = Mathf.FloorToInt((xz.x - area.xMin) / cell), z = Mathf.FloorToInt((xz.y - area.yMin) / cell);
            return x < 0 || z < 0 || x >= nx || z >= nz ? -1 : z * nx + x;
        }

        public Vector3 Pos(int span)
        {
            var c = ColumnCenter(spanCol[span]);
            return new Vector3(c.x, spanY[span], c.y);
        }

        /// <summary>坡度（度）</summary>
        public float Slope(int span) => Mathf.Acos(Mathf.Clamp(spanNy[span], -1, 1)) * Mathf.Rad2Deg;

        public bool Outside(int span, float margin) => outsideDist != null && outsideDist[spanCol[span]] >= margin;

        /// <summary>离 p 最近的可站立面：p 所在列及 searchRadius 内的列里，高差 ≤ maxDy、按「水平距离 + 高差」最小；没有返回 −1</summary>
        public int Near(Vector3 p, float maxDy = 2.5f, float searchRadius = 0, Func<int, bool> filter = null)
        {
            int best = -1;
            float bestScore = float.MaxValue;
            int r = Mathf.CeilToInt(searchRadius / cell);
            int cx = Mathf.FloorToInt((p.x - area.xMin) / cell), cz = Mathf.FloorToInt((p.z - area.yMin) / cell);
            for (int dz = -r; dz <= r; dz++)
            for (int dx = -r; dx <= r; dx++)
            {
                int x = cx + dx, z = cz + dz;
                if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
                int c = z * nx + x;
                var cc = ColumnCenter(c);
                float hd = Vector2.Distance(cc, new Vector2(p.x, p.z));
                if (hd > searchRadius + cell * 0.71f) continue;
                for (int k = 0; k < colCount[c]; k++)
                {
                    int s = colStart[c] + k;
                    float dy = Mathf.Abs(spanY[s] - p.y);
                    if (dy > maxDy || (filter != null && !filter(s))) continue;
                    float score = hd + dy;
                    if (score < bestScore) { bestScore = score; best = s; }
                }
            }
            return best;
        }

        /// <summary>圆盘（水平半径 r）里的全部可站立面</summary>
        public IEnumerable<int> InDisc(Vector3 center, float r)
        {
            int x0 = Mathf.Max(0, Mathf.FloorToInt((center.x - r - area.xMin) / cell)), x1 = Mathf.Min(nx - 1, Mathf.FloorToInt((center.x + r - area.xMin) / cell));
            int z0 = Mathf.Max(0, Mathf.FloorToInt((center.z - r - area.yMin) / cell)), z1 = Mathf.Min(nz - 1, Mathf.FloorToInt((center.z + r - area.yMin) / cell));
            var c2 = new Vector2(center.x, center.z);
            for (int z = z0; z <= z1; z++)
            for (int x = x0; x <= x1; x++)
            {
                int c = z * nx + x;
                if (Vector2.Distance(ColumnCenter(c), c2) > r) continue;
                for (int k = 0; k < colCount[c]; k++) yield return colStart[c] + k;
            }
        }

        /// <summary>
        /// 打射线建栅格。standMask = 可站立面（世界层，不含不可见墙）；playable 为 null 时不分界内外。
        /// </summary>
        public static ReachGrid Build(Rect area, float cell, MoveScale s, int standMask, Func<Vector2, float> playable, float threshold)
        {
            Physics.SyncTransforms();
            var g = new ReachGrid(area, cell);
            float yTop = -1e9f, yBottom = 1e9f;
            foreach (var col in Object.FindObjectsByType<Collider>())
            {
                if (!col.enabled || col.isTrigger || ((1 << col.gameObject.layer) & standMask) == 0) continue;
                var b = col.bounds;
                if (b.max.x < area.xMin || b.min.x > area.xMax || b.max.z < area.yMin || b.min.z > area.yMax) continue;
                yTop = Mathf.Max(yTop, b.max.y);
                yBottom = Mathf.Min(yBottom, b.min.y);
            }
            if (yTop < yBottom) { yTop = 100; yBottom = -100; }
            yTop = Mathf.Min(yTop, 2000) + 2;
            yBottom = Mathf.Max(yBottom, -2000) - 2;

            float cosLimit = Mathf.Cos((s.slopeLimit + 0.5f) * Mathf.Deg2Rad);
            float r = Mathf.Min(0.3f, s.radius);
            var ys = new List<float>(g.nx * g.nz + 1024);
            var nys = new List<float>(g.nx * g.nz + 1024);
            var cols = new List<int>(g.nx * g.nz + 1024);
            var tmpY = new float[MaxSpans];
            var tmpN = new float[MaxSpans];
            for (int c = 0; c < g.nx * g.nz; c++)
            {
                var cc = g.ColumnCenter(c);
                float y = yTop;
                int found = 0;
                for (int k = 0; k < MaxSpans * 2 && found < MaxSpans; k++)
                {
                    if (!Physics.Raycast(new Vector3(cc.x, y, cc.y), Vector3.down, out var hit, y - yBottom, standMask, QueryTriggerInteraction.Ignore)) break;
                    var p = hit.point;
                    if (hit.normal.y >= cosLimit &&
                        !Physics.CheckCapsule(p + Vector3.up * (r + 0.25f), p + Vector3.up * (s.height - r), r, standMask, QueryTriggerInteraction.Ignore))
                    {
                        tmpY[found] = p.y;
                        tmpN[found] = hit.normal.y;
                        found++;
                    }
                    y = p.y - 0.05f;
                }
                g.colStart[c] = ys.Count;
                g.colCount[c] = (byte)found;
                for (int k = 0; k < found; k++)
                {
                    ys.Add(tmpY[k]);
                    nys.Add(tmpN[k]);
                    cols.Add(c);
                }
            }

            bool[] inside = null;
            float[] dist = null;
            if (playable != null)
            {
                int n = g.nx * g.nz;
                inside = new bool[n];
                dist = new float[n];
                for (int c = 0; c < n; c++) inside[c] = playable(g.ColumnCenter(c)) >= threshold;
                // 界外每列到最近界内列的精确欧氏距离（以前的 (1, √2) 两遍倒角距离在斜向会多算最多约 8%：
                // 1-1 兜底环在 +26 m，贴着环内侧站的面倒角距离算成 27.7–29.6 m，越过 escapeMargin = 28 m 被误报成越界）
                ExactDistance(inside, g.nx, g.nz, cell, dist);
            }
            return new ReachGrid(g, ys, nys, cols, inside, dist);
        }

        /// <summary>
        /// 二值栅格的精确欧氏距离变换（Felzenszwalb–Huttenlocher：先逐列、再逐行做一维下包络）：dist = 每列到最近 inside 列的距离（米，inside 列为 0）；
        /// 一列 inside 都没有时为 float.MaxValue
        /// </summary>
        static void ExactDistance(bool[] inside, int nx, int nz, float cell, float[] dist)
        {
            const double Inf = 1e18;
            var sq = new double[nx * nz];
            for (int c = 0; c < sq.Length; c++) sq[c] = inside[c] ? 0 : Inf;
            int m = Mathf.Max(nx, nz);
            var f = new double[m];
            var d = new double[m];
            var v = new int[m];
            var zb = new double[m + 1];
            for (int x = 0; x < nx; x++)
            {
                for (int z = 0; z < nz; z++) f[z] = sq[z * nx + x];
                Envelope(f, nz, d, v, zb);
                for (int z = 0; z < nz; z++) sq[z * nx + x] = d[z];
            }
            for (int z = 0; z < nz; z++)
            {
                for (int x = 0; x < nx; x++) f[x] = sq[z * nx + x];
                Envelope(f, nx, d, v, zb);
                for (int x = 0; x < nx; x++) sq[z * nx + x] = d[x];
            }
            for (int c = 0; c < sq.Length; c++) dist[c] = sq[c] >= Inf * 0.5 ? float.MaxValue : (float)(System.Math.Sqrt(sq[c]) * cell);
        }

        /// <summary>一维平方距离：d[q] = min_p (q − p)² + f[p]（抛物线下包络）</summary>
        static void Envelope(double[] f, int n, double[] d, int[] v, double[] zb)
        {
            int k = 0;
            v[0] = 0;
            zb[0] = double.NegativeInfinity;
            zb[1] = double.PositiveInfinity;
            for (int q = 1; q < n; q++)
            {
                double s = Cross(f, q, v[k]);
                // zb[0] = −∞：k 不会退到 0 以下
                while (s <= zb[k])
                {
                    k--;
                    s = Cross(f, q, v[k]);
                }
                k++;
                v[k] = q;
                zb[k] = s;
                zb[k + 1] = double.PositiveInfinity;
            }
            k = 0;
            for (int q = 0; q < n; q++)
            {
                while (zb[k + 1] < q) k++;
                double dq = q - v[k];
                d[q] = dq * dq + f[v[k]];
            }
        }

        /// <summary>抛物线 q、p 的交点横坐标</summary>
        static double Cross(double[] f, int q, int p) => (f[q] + (double)q * q - (f[p] + (double)p * p)) / (2.0 * (q - p));
    }

    /// <summary>
    /// 玩家可达性洪泛：从出生面出发，按能力档位分桶的最短路（桶 = <see cref="Move"/>），每个可站立面记下到达它要用到的最弱能力。
    ///   走：相邻列，上坡不超过「台阶 + 坡面高差」，下坡任意（走下台沿）；膝高连线不被挡
    ///   跳跃链接：只从「台沿」（某个方向走不过去或会掉下去）出发，16 个方向、按起跳包络判高差，再用胶囊扫一条「先升、再平移、再落」的路径判有没有被挡
    /// 每个档位先把本档能走到的全部铺完（含本档能力的链接带出的新面），再试更强能力的链接——只有真正走不到的目标才扫胶囊。
    /// blockMask 决定什么东西挡路：含 Ignore Raycast 层 = 现在的样子（有不可见墙）；不含 = 撤掉空气墙之后（软边界就绪检查）。
    /// 落到界外 margin 米以外的面记为越界，不再从它往外扩。
    /// </summary>
    public sealed class ReachFlood
    {
        public readonly ReachGrid grid;
        /// <summary>每个面的到达档位（<see cref="Move.None"/> = 到不了）</summary>
        public readonly byte[] tier;
        /// <summary>从哪个面过来的（−1 = 起点 / 没到）</summary>
        public readonly int[] from;
        public readonly int start;
        public readonly Move maxTier;
        /// <summary>越界落点（按到达先后）</summary>
        public readonly List<int> escapes = new();
        public int linecasts, sweeps;

        /// <summary>同一个目标在一个档位里被挡这么多次就不再试（贴着不可见墙的一圈会被很多起跳点反复试）</summary>
        const int MaxFails = 6;

        readonly JumpEnvelope env;
        readonly MoveScale scale;
        /// <summary>wallMask = blockMask 里的不可见墙层（Ignore Raycast）</summary>
        readonly int blockMask, wallMask, tiers;
        readonly float radius, linkReach;
        readonly Queue<int>[] queues;
        readonly int[] stamp;
        readonly byte[] fails;
        int stampId;

        ReachFlood(ReachGrid g, JumpEnvelope env, MoveScale s, int start, int blockMask, Move maxTier)
        {
            grid = g;
            this.env = env;
            scale = s;
            this.start = start;
            this.blockMask = blockMask;
            wallMask = blockMask & (1 << Layers.IgnoreRaycast);
            this.maxTier = maxTier;
            tiers = (int)maxTier + 1;
            radius = Mathf.Min(0.3f, s.radius);
            // 按 MotorCore 模拟：助跑跳同高约 5.2 m，跳 + 顶点冲刺约 10.6 m（冲刺期间不下坠、空中几乎不掉速），再加二段跳约 15.3 m：链接搜到 16 m
            linkReach = Mathf.Min(env.Reach(maxTier), 16f);
            tier = new byte[g.Spans];
            from = new int[g.Spans];
            for (int i = 0; i < tier.Length; i++)
            {
                tier[i] = (byte)Move.None;
                from[i] = -1;
            }
            queues = new Queue<int>[tiers];
            for (int i = 0; i < tiers; i++) queues[i] = new Queue<int>();
            stamp = new int[g.Columns];
            fails = new byte[g.Spans];
        }

        public Move Tier(int span) => span < 0 ? Move.None : (Move)tier[span];
        public bool Reached(int span, Move atMost) => span >= 0 && tier[span] <= (byte)atMost;

        static readonly int[] Dx = { 1, -1, 0, 0, 1, 1, -1, -1 };
        static readonly int[] Dz = { 0, 0, 1, -1, 1, -1, 1, -1 };

        public static ReachFlood Run(ReachGrid g, JumpEnvelope env, MoveScale s, int start, int blockMask, Move maxTier, float escapeMargin)
        {
            var f = new ReachFlood(g, env, s, start, blockMask, maxTier);
            if (start < 0) return f;
            f.tier[start] = 0;
            f.queues[0].Enqueue(start);
            var edges = new List<int>();
            for (int b = 0; b < f.tiers; b++)
            {
                edges.Clear();
                Array.Clear(f.fails, 0, f.fails.Length);
                int linked = 0;
                var q = f.queues[b];
                while (true)
                {
                    while (q.Count > 0)
                    {
                        int sp = q.Dequeue();
                        if (f.tier[sp] != b) continue;
                        if (g.Outside(sp, escapeMargin))
                        {
                            f.escapes.Add(sp);
                            continue;
                        }
                        if (f.Walk(sp, b)) edges.Add(sp);
                    }
                    // 本档能力的链接（走下远处的台沿、本档的跳）可能带出新的本档面：回去接着走
                    for (; linked < edges.Count; linked++) f.Links(edges[linked], b, 0, b);
                    if (q.Count == 0) break;
                }
                // 本档已经铺完：更强能力的链接只剩真正走不到的目标
                if (b + 1 < f.tiers)
                    foreach (var e in edges) f.Links(e, b, b + 1, f.tiers - 1);
            }
            return f;
        }

        void Relax(int t, int nt, int src)
        {
            if (nt >= tier[t]) return;
            tier[t] = (byte)nt;
            from[t] = src;
            queues[nt].Enqueue(t);
        }

        /// <summary>走到相邻 8 列；返回这个面是不是台沿（有方向走不过去或会掉下去）</summary>
        bool Walk(int sp, int b)
        {
            var g = grid;
            int col = g.spanCol[sp];
            int cx = col % g.nx, cz = col / g.nx;
            var ps = g.Pos(sp);
            float slopeS = g.Slope(sp);
            bool edge = false;
            for (int k = 0; k < 8; k++)
            {
                int x = cx + Dx[k], z = cz + Dz[k];
                if (x < 0 || z < 0 || x >= g.nx || z >= g.nz) { edge = true; continue; }
                int nc = z * g.nx + x;
                float hd = k < 4 ? g.cell : g.cell * 1.41421f;
                int target = -1;
                bool drop = false;
                // 走过去落在哪一层：从高到低第一个不高于「台阶 + 坡面高差」的面（更高的是头顶上的桥、拱）
                for (int j = 0; j < g.colCount[nc]; j++)
                {
                    int t = g.colStart[nc] + j;
                    float slope = Mathf.Min(scale.slopeLimit, (slopeS + g.Slope(t)) * 0.5f);
                    float up = scale.stepOffset + hd * Mathf.Tan(slope * Mathf.Deg2Rad);
                    if (g.spanY[t] > ps.y + up) continue;
                    target = t;
                    drop = g.spanY[t] < ps.y - up;
                    break;
                }
                if (target < 0 || drop) edge = true;
                if (target < 0 || tier[target] <= b) continue;
                var pt = g.Pos(target);
                linecasts++;
                // 膝高连线（下台沿时按起点高度平移过去再落）；跨过界线的一步再加一条胸高连线（不让射线从边界墙的网格接缝里漏过去）
                var a = ps + Vector3.up * 0.6f;
                var e = new Vector3(pt.x, Mathf.Max(pt.y, ps.y) + 0.6f, pt.z);
                if (Physics.Linecast(a, e, blockMask, QueryTriggerInteraction.Ignore)) { edge = true; continue; }
                if (g.inside != null && g.inside[col] != g.inside[nc])
                {
                    linecasts++;
                    if (Physics.Linecast(a + Vector3.up * 0.7f, e + Vector3.up * 0.7f, blockMask, QueryTriggerInteraction.Ignore)) { edge = true; continue; }
                }
                Relax(target, b, sp);
            }
            return edge;
        }

        /// <summary>从台沿 sp（档位 b）出发的跳跃链接：只试需要能力在 [needMin, needMax] 之间的目标</summary>
        void Links(int sp, int b, int needMin, int needMax)
        {
            if (tier[sp] != b) return;
            var g = grid;
            var ps = g.Pos(sp);
            int col = g.spanCol[sp];
            // 起跳胶囊贴着不可见墙（重叠）：PhysX 的扫掠会忽略起点就重叠的碰撞体、直接穿墙，所以这种面不当起跳点
            if (wallMask != 0 && Physics.CheckCapsule(ps + Vector3.up * (radius + 0.25f), ps + Vector3.up * (scale.height - radius), radius, wallMask,
                    QueryTriggerInteraction.Ignore)) return;
            stampId++;
            stamp[col] = stampId;
            var p2 = new Vector2(ps.x, ps.z);
            for (int k = 0; k < 16; k++)
            {
                float ang = k * Mathf.PI / 8;
                float dx = Mathf.Cos(ang), dz = Mathf.Sin(ang);
                for (float d = g.cell * 0.9f; d <= linkReach; d += g.cell * 0.7f)
                {
                    int nc = g.Column(new Vector2(ps.x + dx * d, ps.z + dz * d));
                    if (nc < 0) break;
                    if (stamp[nc] == stampId) continue;
                    stamp[nc] = stampId;
                    float hd = Vector2.Distance(g.ColumnCenter(nc), p2);
                    for (int j = 0; j < g.colCount[nc]; j++)
                    {
                        int t = g.colStart[nc] + j;
                        if (tier[t] <= b || fails[t] >= MaxFails) continue;
                        float dh = g.spanY[t] - ps.y;
                        int need = -1;
                        for (int m = 0; m < tiers; m++)
                            if (dh <= env.Height((Move)m, hd)) { need = m; break; }
                        if (need < needMin || need > needMax) continue;
                        int nt = Mathf.Max(b, need);
                        if (nt >= tier[t]) continue;
                        if (!ArcClear(ps, g.Pos(t), (Move)need, hd))
                        {
                            fails[t]++;
                            continue;
                        }
                        Relax(t, nt, sp);
                    }
                }
            }
        }

        /// <summary>「先升到两端较高者 + 0.15 m、再平移、再落下」的胶囊路径不被挡；不通时再试按包络中点高度的拱形路径</summary>
        bool ArcClear(Vector3 a, Vector3 b, Move need, float hd)
        {
            float top = Mathf.Max(a.y, b.y) + 0.15f;
            if (Sweep(a, b, top)) return true;
            float peak = a.y + env.Height(need, hd * 0.5f);
            return peak > top + 0.3f && Sweep(a, b, peak);
        }

        bool Sweep(Vector3 a, Vector3 b, float top)
        {
            float r = radius;
            var lo = Vector3.up * (r + 0.25f);
            var hi = Vector3.up * (scale.height - r);
            if (top - a.y > 0.05f)
            {
                sweeps++;
                if (Physics.CapsuleCast(a + lo, a + hi, r, Vector3.up, top - a.y, blockMask, QueryTriggerInteraction.Ignore)) return false;
            }
            var a2 = new Vector3(a.x, top, a.z);
            var b2 = new Vector3(b.x, top, b.z);
            var dir = b2 - a2;
            float len = dir.magnitude;
            if (len > 0.01f)
            {
                sweeps++;
                if (Physics.CapsuleCast(a2 + lo, a2 + hi, r, dir / len, len, blockMask, QueryTriggerInteraction.Ignore)) return false;
            }
            if (top - b.y > 0.35f)
            {
                sweeps++;
                if (Physics.CapsuleCast(b2 + lo, b2 + hi, r, Vector3.down, top - b.y - 0.3f, blockMask, QueryTriggerInteraction.Ignore)) return false;
            }
            return true;
        }

        /// <summary>顺着 from 往回找，第一个在界内的面（越界的出口）</summary>
        public int BreachOf(int span)
        {
            int s = span, guard = 0;
            while (s >= 0 && guard++ < 100000)
            {
                if (grid.outsideDist == null || grid.outsideDist[grid.spanCol[s]] <= 0) return s;
                s = from[s];
            }
            return span;
        }

        public static string Label(Move m) => m switch
        {
            Move.Walk => "步行",
            Move.Jump => "单跳",
            Move.Dash => "冲刺",
            Move.DoubleJump => "二段跳",
            _ => "到不了",
        };
    }
}
