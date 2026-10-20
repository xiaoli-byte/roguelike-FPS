using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>刃群阵形：旋涡（千刃出窍）/ 圆盾（碎刃屏障）/ 刃球（杀气聚合）/ 炸散（爆发之后）</summary>
    public enum SwarmFormation { Vortex, Shield, Ball, Scatter }

    /// <summary>
    /// 第一人称刀身提供碎片 i 在原位时的世界位置与朝向，返回世界缩放（随相机与刀姿每帧变化；两台相机 FOV 不同时按屏幕位置对齐，同 TS homeWorld）
    /// </summary>
    public interface IShardHome
    {
        float HomeWorld(int i, out Vector3 pos, out Quaternion rot);
    }

    /// <summary>
    /// 碎刃的世界刃群状态（Three.js BladeSwarm.ts 的逻辑部分；画面由 <see cref="BladeSwarmRenderer"/> 画）。纯 C#，EditMode 可测。
    /// 每片碎刃只有一份：在手里（Home，第一人称刀身显示它）或在世界里。
    ///   出窍：按离刀顺序（刀尖在前）依次从第一人称刀身上的实际位置离开，沿弯曲轨迹（二次贝塞尔，侧偏随片号）汇成一股激流飞向阵形里自己的位置；
    ///   阵形：旋涡（绕中心环绕并周期性俯冲穿过目标，「像下雨一样」）、圆盾（四圈同心反向旋转，12 / 28 / 40 / 48 片）、
    ///         刃球（斐波那契球面，越转越快、越压越小）、炸散（沿球面方向冲出、减速）；
    ///   归刀：刀根附近的先回，飞回第一人称刀身上各自的原位（原位每帧变化）。
    /// 阵形中心 / 圆盾朝向由控制器每帧写入；这里只管去向与姿态，不做伤害判定。
    /// 与 TS 的差别（改进）：离刀前（还在排队等出发）的碎片仍算「在手里」（<see cref="InHand"/>），刀身从刀尖起一片片碎开，而不是整把先消失。
    /// </summary>
    public sealed class BladeShards
    {
        public const int Count = BladeShape.ShardCount;
        /// <summary>碎片状态：在手里 / 飞往阵形 / 在阵形中 / 飞回刀身</summary>
        public const byte Home = 0, Out = 1, Formed = 2, Back = 3;

        /// <summary>世界中碎片的缩放（比刀身上的大，远处也能看清）：刃群 / 圆盾 / 刃球</summary>
        public const float SwarmScale = 3.4f, ShieldScale = 3.1f, BallScale = 3.4f;
        /// <summary>出窍：全部碎片依次离刀的总时长；飞行速度与时长上下限</summary>
        public const float LaunchSpread = 0.24f, OutSpeed = 42f, OutMin = 0.1f, OutMax = 0.55f;
        /// <summary>归刀：依次启程的总时长；飞行速度与时长上下限</summary>
        public const float BackSpread = 0.14f, BackSpeed = 48f, BackMin = 0.08f, BackMax = 0.42f;
        /// <summary>圆盾的四圈碎片数（合计 128）</summary>
        public static readonly int[] ShieldRings = { 12, 28, 40, 48 };
        /// <summary>世界刃群的自发光倍率（TS 世界碎片 uEdge 1.8 / uSeam 0.9，约为手里的 1.4 倍）</summary>
        public const float WorldGlow = 0.4f;

        public SwarmFormation formation = SwarmFormation.Vortex;
        public Vector3 center;
        /// <summary>刃群的视觉半径（判定半径由控制器决定，写进 <see cref="hitRadius"/> 给光环用）</summary>
        public float radius = 1.5f, hitRadius = 2.2f;
        /// <summary>圆盾：圆心、朝外法线、右 / 上方向、半径</summary>
        public Vector3 shieldCenter, shieldNormal = Vector3.forward, shieldRight = Vector3.right, shieldUp = Vector3.up;
        public float shieldRadius = 0.85f;
        /// <summary>刃球压缩进度 0..1</summary>
        public float ballCompress;
        /// <summary>整体亮度加成（人刀合一）</summary>
        public float boost;
        /// <summary>第一人称刀身（没有时归刀飞向刃群中心）</summary>
        public IShardHome provider;

        public readonly byte[] state = new byte[Count];
        /// <summary>回到刀身的时刻（刚归位的碎片闪一下，WC7 用）</summary>
        public readonly float[] arrivedAt = new float[Count];
        /// <summary>已经从起点出发（离刀前排队中的碎片仍在手里）</summary>
        public readonly bool[] departed = new bool[Count];
        /// <summary>本帧世界姿态（缩放 0 = 不在世界里）与上一帧位置（拖尾）</summary>
        public readonly Vector3[] pos = new Vector3[Count], prev = new Vector3[Count];
        public readonly Quaternion[] rot = new Quaternion[Count];
        public readonly float[] scale = new float[Count];
        /// <summary>本帧在飞（不在阵形里）</summary>
        public readonly bool[] flying = new bool[Count];

        readonly float[] delay = new float[Count], t = new float[Count], dur = new float[Count], fromS = new float[Count];
        readonly Vector3[] from = new Vector3[Count], bend = new Vector3[Count];
        readonly Quaternion[] fromQ = new Quaternion[Count];
        // 阵形中每片的固定随机参数
        readonly Vector3[] axis = new Vector3[Count], basis = new Vector3[Count], sphere = new Vector3[Count];
        readonly float[] rad = new float[Count], omega = new float[Count], phase = new float[Count], dive = new float[Count];
        readonly int[] byRank, rankOf = new int[Count];
        float time, formedAt, lastHomeScale = 1;

        /// <summary>圆盾受击闪光：已过时间（&lt; 0 = 没有）与盾面局部坐标（−1..1）</summary>
        public float membraneHit = -1;
        public Vector2 hitLocal;

        public BladeShards()
        {
            var cells = BladeShape.Cells;
            byRank = BladeShape.ByRank();
            long seed = 91;
            float Rnd()
            {
                seed = seed * 16807 % 2147483647;
                return (float)(seed / 2147483647.0);
            }
            for (int i = 0; i < Count; i++)
            {
                rankOf[i] = cells[i].rank;
                arrivedAt[i] = -99;
                rot[i] = Quaternion.identity;
                // 环绕轴：大多接近竖直（水平旋涡），少数倾斜，形成立体的绞杀球
                var a = new Vector3((Rnd() - 0.5f) * 1.1f, 1, (Rnd() - 0.5f) * 1.1f).normalized;
                axis[i] = a;
                basis[i] = Vector3.Cross(new Vector3(Rnd() - 0.5f, Rnd() - 0.5f, Rnd() - 0.5f), a).normalized;
                rad[i] = 0.35f + 0.65f * Mathf.Sqrt(Rnd());
                omega[i] = (5 + 4 * Rnd()) * (Rnd() < 0.2f ? -1 : 1);
                phase[i] = Rnd() * Mathf.PI * 2;
                dive[i] = 0.55f + 0.35f * Rnd();
                // 刃球：斐波那契球面方向
                float k = i + 0.5f, yy = 1 - 2 * k / Count, rr = Mathf.Sqrt(1 - yy * yy), th = k * 2.39996323f;
                sphere[i] = new Vector3(Mathf.Cos(th) * rr, yy, Mathf.Sin(th) * rr);
            }
        }

        /// <summary>上一次 <see cref="Update"/> 的时刻</summary>
        public float Now => time;

        /// <summary>全部在手里</summary>
        public bool AllHome()
        {
            for (int i = 0; i < Count; i++)
                if (state[i] != Home) return false;
            return true;
        }

        /// <summary>已到达阵形的比例</summary>
        public float FormedFraction()
        {
            int n = 0;
            for (int i = 0; i < Count; i++)
                if (state[i] == Formed) n++;
            return (float)n / Count;
        }

        /// <summary>不在手里的碎片数</summary>
        public int AwayCount()
        {
            int n = 0;
            for (int i = 0; i < Count; i++)
                if (state[i] != Home) n++;
            return n;
        }

        /// <summary>第一人称刀身上该不该显示第 i 片：在手里，或刚下令出窍、还没轮到它出发</summary>
        public bool InHand(int i) => state[i] == Home || (state[i] == Out && !departed[i]);

        /// <summary>出窍 / 换阵形：手里的碎片按离刀顺序（刀尖在前）依次离开，已在外面的碎片直接改飞新阵形的位置</summary>
        public void Launch(SwarmFormation f)
        {
            formation = f;
            formedAt = time;
            for (int r = 0; r < Count; r++)
            {
                int i = byRank[r];
                if (state[i] == Home)
                {
                    state[i] = Out;
                    delay[i] = (float)r / (Count - 1) * LaunchSpread;
                    t[i] = -1;
                    departed[i] = false;
                }
                else BeginLeg(i, Out, 0);
            }
        }

        /// <summary>炸散（杀气爆发）：从刃球向外炸开，之后由控制器 <see cref="Recall"/></summary>
        public void Scatter()
        {
            formation = SwarmFormation.Scatter;
            formedAt = time;
            for (int i = 0; i < Count; i++)
                if (state[i] != Home) BeginLeg(i, Out, 0);
        }

        /// <summary>归刀：刀根附近的先回（spreadMul 缩放依次启程的总时长；0 = 同时）</summary>
        public void Recall(float spreadMul = 1)
        {
            for (int r = 0; r < Count; r++)
            {
                int i = byRank[r];
                if (state[i] == Home || state[i] == Back) continue;
                // 还没出发的直接留在手里
                if (state[i] == Out && !departed[i])
                {
                    state[i] = Home;
                    continue;
                }
                BeginLeg(i, Back, (1 - (float)r / (Count - 1)) * BackSpread * spreadMul);
            }
        }

        /// <summary>立即全部回到手里（切枪 / 死亡 / 换关）</summary>
        public void SnapHome()
        {
            for (int i = 0; i < Count; i++)
            {
                state[i] = Home;
                departed[i] = false;
                scale[i] = 0;
                flying[i] = false;
            }
            membraneHit = -1;
        }

        /// <summary>圆盾被击中：局部闪光（point 为世界坐标）</summary>
        public void FlashShield(Vector3 point)
        {
            var a = point - shieldCenter;
            float r = Mathf.Max(0.01f, shieldRadius);
            hitLocal = new Vector2(Vector3.Dot(a, shieldRight) / r, Vector3.Dot(a, shieldUp) / r);
            membraneHit = 0;
        }

        void BeginLeg(int i, byte kind, float d)
        {
            state[i] = kind;
            delay[i] = d;
            t[i] = -1;
        }

        /// <summary>飞行起点 = 当前位置（还在手里的碎片取第一人称刀身上的实际位置）</summary>
        void CaptureStart(int i)
        {
            if (!departed[i] || scale[i] == 0)
            {
                Vector3 p;
                Quaternion q;
                float s = 1;
                if (provider != null) s = provider.HomeWorld(i, out p, out q);
                else
                {
                    p = center;
                    q = Quaternion.identity;
                }
                from[i] = p;
                fromQ[i] = q;
                fromS[i] = s;
                pos[i] = prev[i] = p;
                rot[i] = q;
                scale[i] = s;
                departed[i] = true;
            }
            else
            {
                from[i] = pos[i];
                fromQ[i] = rot[i];
                fromS[i] = scale[i];
            }
        }

        /// <summary>以 y 轴对准 dir、z 轴尽量贴近 refDir 的朝向</summary>
        static Quaternion AlignY(Vector3 dir, Vector3 refDir)
        {
            if (dir.sqrMagnitude < 1e-10f) return Quaternion.identity;
            var y = dir.normalized;
            var x = Vector3.Cross(y, refDir);
            if (x.sqrMagnitude < 1e-8f) x = Vector3.Cross(y, Mathf.Abs(y.y) < 0.9f ? Vector3.up : Vector3.right);
            x.Normalize();
            var z = Vector3.Cross(x, y);
            return Quaternion.LookRotation(z, y);
        }

        /// <summary>阵形中第 i 片此刻的位置 / 朝向，返回缩放</summary>
        public float Slot(int i, out Vector3 p, out Quaternion q)
        {
            float tt = time;
            switch (formation)
            {
                case SwarmFormation.Vortex:
                {
                    var a = axis[i];
                    var b = basis[i];
                    var c = Vector3.Cross(a, b);
                    float th = phase[i] + omega[i] * tt;
                    // 周期性俯冲：半径收到接近 0 再弹出，碎片一次次穿过目标
                    float per = dive[i];
                    float ph = Mathf.Repeat(tt + phase[i], per) / per;
                    float d = ph < 0.28f ? Mathf.Sin(ph / 0.28f * Mathf.PI) : 0;
                    float r = radius * rad[i] * (1 - 0.88f * d);
                    p = b * (Mathf.Cos(th) * r) + c * (Mathf.Sin(th) * r);
                    p.y *= 0.72f;
                    p += center;
                    // 朝向：沿切线（环绕方向），刃面贴着环绕平面
                    var v = (c * Mathf.Cos(th) - b * Mathf.Sin(th)) * Mathf.Sign(omega[i]);
                    q = AlignY(v, a);
                    return SwarmScale;
                }
                case SwarmFormation.Shield:
                {
                    int rank = rankOf[i];
                    int ring = 0, start = 0;
                    while (ring < ShieldRings.Length - 1 && rank >= start + ShieldRings[ring]) start += ShieldRings[ring++];
                    int n = ShieldRings[ring];
                    float dir = ring % 2 == 1 ? -1 : 1;
                    float ang = (float)(rank - start) / n * Mathf.PI * 2 + dir * tt * (1.6f - ring * 0.25f);
                    float r = shieldRadius * (0.2f + 0.8f * ((ring + 0.5f) / ShieldRings.Length));
                    p = shieldCenter + shieldRight * (Mathf.Cos(ang) * r) + shieldUp * (Mathf.Sin(ang) * r);
                    var v = shieldRight * -Mathf.Sin(ang) + shieldUp * Mathf.Cos(ang);
                    q = AlignY(v, shieldNormal);
                    return ShieldScale * (1 - 0.12f * ring);
                }
                case SwarmFormation.Ball:
                {
                    float k = ballCompress;
                    float spin = (6 + 24 * k * k) * (tt - formedAt);
                    var spinAxis = new Vector3(0.3f, 1, 0.2f).normalized;
                    var a = Quaternion.AngleAxis(spin * Mathf.Rad2Deg, spinAxis) * sphere[i];
                    float r = 1.5f * (1 - 0.78f * k) * (0.85f + 0.15f * Mathf.Sin(i * 3.1f + tt * 9));
                    p = center + a * r;
                    q = AlignY(Vector3.Cross(spinAxis, a), a);
                    return BallScale * (1 - 0.35f * k);
                }
                default:
                {
                    // 炸散：沿刃球方向冲出、减速
                    float e = tt - formedAt;
                    var a = sphere[i];
                    float r = 0.4f + 6.2f * (1 - Mathf.Exp(-e * 7)) * (0.7f + 0.3f * rad[i]);
                    p = center + a * r;
                    q = AlignY(a, Vector3.up);
                    return BallScale;
                }
            }
        }

        /// <summary>归刀目标：第一人称刀身上的原位（没有提供者时退回刃群中心）</summary>
        Vector3 HomeTarget(int i, out Quaternion q)
        {
            if (provider == null)
            {
                lastHomeScale = 1;
                q = Quaternion.identity;
                return center;
            }
            lastHomeScale = provider.HomeWorld(i, out var p, out q);
            return p;
        }

        static float Smooth(float x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
        static float EaseOut(float x) => 1 - (1 - x) * (1 - x);

        /// <summary>每帧推进（now = 游戏时间，阵形相位按它走）；返回是否有碎片不在手里</summary>
        public bool Update(float dt, float now)
        {
            time = now;
            bool anyAway = false;
            for (int i = 0; i < Count; i++)
            {
                byte st = state[i];
                flying[i] = false;
                if (st == Home)
                {
                    scale[i] = 0;
                    departed[i] = false;
                    continue;
                }
                anyAway = true;
                if (delay[i] > 0)
                {
                    delay[i] -= dt;
                    if (delay[i] > 0) continue;
                }
                if (t[i] < 0)
                {
                    CaptureStart(i);
                    // 弯曲轨迹：在起终点连线的侧向偏一段（随片号固定），汇成一股带弧度的激流
                    Vector3 target;
                    if (st == Back) target = HomeTarget(i, out _);
                    else Slot(i, out target, out _);
                    float dist = Vector3.Distance(target, from[i]);
                    bool back = st == Back;
                    dur[i] = Mathf.Min(back ? BackMax : OutMax, Mathf.Max(back ? BackMin : OutMin, dist / (back ? BackSpeed : OutSpeed)));
                    var side = Vector3.Cross(new Vector3(Mathf.Sin(i * 12.9898f), Mathf.Cos(i * 78.233f), Mathf.Sin(i * 4.1f)), target - from[i]);
                    bend[i] = side.sqrMagnitude > 1e-12f ? side.normalized * (dist * (0.12f + 0.12f * rad[i])) : Vector3.zero;
                    t[i] = 0;
                }
                t[i] = Mathf.Min(1, t[i] + dt / Mathf.Max(0.01f, dur[i]));
                Vector3 p;
                Quaternion q;
                float s;
                if (st == Formed) s = Slot(i, out p, out q);
                else
                {
                    Vector3 target;
                    float ts;
                    if (st == Back)
                    {
                        target = HomeTarget(i, out q);
                        ts = lastHomeScale;
                    }
                    else ts = Slot(i, out target, out q);
                    float k = EaseOut(t[i]), u = 1 - k;
                    // 二次贝塞尔：控制点 = 中点 + 侧偏
                    var ctrl = (from[i] + target) * 0.5f + bend[i];
                    p = from[i] * (u * u) + ctrl * (2 * u * k) + target * (k * k);
                    float sm = Smooth(t[i]);
                    q = Quaternion.Slerp(fromQ[i], q, sm);
                    s = fromS[i] + (ts - fromS[i]) * sm;
                    if (t[i] >= 1)
                    {
                        if (st == Back)
                        {
                            state[i] = Home;
                            arrivedAt[i] = now;
                            scale[i] = 0;
                            departed[i] = false;
                            continue;
                        }
                        state[i] = Formed;
                    }
                }
                prev[i] = pos[i];
                pos[i] = p;
                rot[i] = q;
                scale[i] = s;
                flying[i] = st != Formed;
            }
            if (membraneHit >= 0)
            {
                membraneHit += dt;
                if (membraneHit > 0.3f) membraneHit = -1;
            }
            return anyAway;
        }
    }
}
