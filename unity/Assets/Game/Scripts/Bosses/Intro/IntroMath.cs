using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>镜头姿态：世界位置、朝向、竖直视角（度）</summary>
    public struct CamPose
    {
        public Vector3 position;
        public Quaternion rotation;
        public float fov;

        public CamPose(Vector3 position, Quaternion rotation, float fov)
        {
            this.position = position;
            this.rotation = rotation;
            this.fov = fov;
        }

        /// <summary>从 from 看向 target（roll 度，+ = 画面向左歪）</summary>
        public static CamPose Look(Vector3 from, Vector3 target, float fov, float roll = 0) => new(from, IntroMath.LookRotation(target - from, roll), fov);

        public static CamPose Of(Transform t, float fov) => t ? new CamPose(t.position, t.rotation, fov) : new CamPose(Vector3.zero, Quaternion.identity, fov);

        public bool Finite => IntroMath.Finite(position) && float.IsFinite(fov) && float.IsFinite(rotation.x) && float.IsFinite(rotation.y) && float.IsFinite(rotation.z) &&
                              float.IsFinite(rotation.w);

        public override string ToString() => $"{position} {rotation.eulerAngles} fov {fov:F1}";
    }

    /// <summary>
    /// 登场演出的纯数学（不碰场景，EditMode 测试直接测）：缓动、姿态混合、环绕插值、交接误差、手持噪声、决斗坐标系。
    /// 交接（落回第一人称）的硬性约定：<see cref="Blend"/> 在 w ≥ 1 时<b>原样</b>返回目标姿态，<see cref="LandWeight"/> 在 u ≥ 时长时正好是 1——
    /// 所以最后一帧相机和 Eye 的误差是 0，不是「足够小」。
    /// </summary>
    public static class IntroMath
    {
        public static float Ease(IntroEase e, float k)
        {
            if (!(k > 0)) return 0;
            if (k >= 1) return 1;
            switch (e)
            {
                case IntroEase.In:
                    return k * k * k;
                case IntroEase.Out:
                {
                    float u = 1 - k;
                    return 1 - u * u * u;
                }
                case IntroEase.InOut:
                    return k < 0.5f ? 4 * k * k * k : 1 - Mathf.Pow(-2 * k + 2, 3) / 2;
                case IntroEase.Smoother:
                    return k * k * k * (k * (k * 6 - 15) + 10);
                default:
                    return k;
            }
        }

        /// <summary>落回第一人称的权重：smootherstep（两端速度、加速度为 0）；u ≥ seconds 时正好是 1</summary>
        public static float LandWeight(float u, float seconds) => !(seconds > 0) || u >= seconds ? 1f : Ease(IntroEase.Smoother, u / seconds);

        /// <summary>落回第一人称：落地第 u 秒（共 seconds 秒）从 from 到 eye 的姿态；u ≥ seconds 时原样等于 eye</summary>
        public static CamPose Land(in CamPose from, in CamPose eye, float u, float seconds) => Blend(from, eye, LandWeight(u, seconds));

        /// <summary>
        /// 落地用时按回程拉长：25 m 以内照脚本的时长，越远越长，最多 1.45 倍——3-3 那种 55 m 的回程不会 1.3 s 一闪而过（峰值速度压到原来的七成）
        /// </summary>
        public static float LandStretch(float meters) => float.IsFinite(meters) ? Mathf.Clamp(1f + (meters - 25f) / 65f, 1f, 1.45f) : 1f;

        /// <summary>回程默认抬多高（米）：路程的 8%，最多 4 m；太近不抬</summary>
        public static float LandLiftFor(float meters) => float.IsFinite(meters) && meters > 2.5f ? Mathf.Min(meters * 0.08f, 4f) : 0f;

        /// <summary>
        /// 回程中段的抬升（摇臂式拉回：先抬起越过路上的矮掩体，再落进眼睛）：lift × 4w(1 − w)，w ≤ 0 / ≥ 1 时正好是 0——起点接上一镜、终点交接零误差都不受影响
        /// </summary>
        public static float LandLift(float lift, float w) => !(w > 0) || w >= 1 || !float.IsFinite(lift) ? 0f : lift * 4f * w * (1 - w);

        /// <summary>两个姿态按 w 混合（位置线性、朝向球面、视角线性）。w ≤ 0 原样返回 a，w ≥ 1 原样返回 b（交接零误差靠这一条）</summary>
        public static CamPose Blend(in CamPose a, in CamPose b, float w)
        {
            if (!(w > 0)) return a;
            if (w >= 1) return b;
            return new CamPose(Vector3.LerpUnclamped(a.position, b.position, w), Quaternion.Slerp(a.rotation, b.rotation, w), Mathf.LerpUnclamped(a.fov, b.fov, w));
        }

        /// <summary>
        /// 环绕插值：a、b 是机位相对看点的偏移。水平方向按角度转过去（不穿过看点），水平距离和高度线性插值——摇臂 / 环绕镜头
        /// </summary>
        public static Vector3 Orbit(Vector3 a, Vector3 b, float k)
        {
            var ha = new Vector3(a.x, 0, a.z);
            var hb = new Vector3(b.x, 0, b.z);
            float la = ha.magnitude, lb = hb.magnitude;
            float len = Mathf.LerpUnclamped(la, lb, k);
            Vector3 dir;
            if (la < 1e-4f && lb < 1e-4f) dir = Vector3.zero;
            else if (la < 1e-4f) dir = hb / lb;
            else if (lb < 1e-4f) dir = ha / la;
            else
            {
                float ya = Mathf.Atan2(ha.x, ha.z) * Mathf.Rad2Deg, yb = Mathf.Atan2(hb.x, hb.z) * Mathf.Rad2Deg;
                float y = (ya + Mathf.DeltaAngle(ya, yb) * k) * Mathf.Deg2Rad;
                dir = new Vector3(Mathf.Sin(y), 0, Mathf.Cos(y));
            }
            return dir * len + Vector3.up * Mathf.LerpUnclamped(a.y, b.y, k);
        }

        /// <summary>朝 dir 看、绕视线转 roll 度；dir 太短 / 竖直时也给一个确定的朝向（不出 NaN）</summary>
        public static Quaternion LookRotation(Vector3 dir, float roll = 0)
        {
            if (!Finite(dir) || dir.sqrMagnitude < 1e-8f) dir = Vector3.forward;
            dir.Normalize();
            var up = Mathf.Abs(dir.y) > 0.999f ? Vector3.forward : Vector3.up;
            var q = Quaternion.LookRotation(dir, up);
            return Mathf.Abs(roll) > 1e-4f ? q * Quaternion.Euler(0, 0, roll) : q;
        }

        /// <summary>两个姿态的差：位置（米）、朝向（度）、视角（度）</summary>
        public static void Error(in CamPose a, in CamPose b, out float meters, out float degrees, out float fov)
        {
            meters = Vector3.Distance(a.position, b.position);
            degrees = Quaternion.Angle(a.rotation, b.rotation);
            fov = Mathf.Abs(a.fov - b.fov);
        }

        /// <summary>
        /// 决斗坐标系（docs/level-design/boss-intros.md「坐标」）：+Z = 从玩家指向首领出生点（水平），+X = 玩家右手。
        /// 两点重合 / 竖直时退回 fallback（再不行 +Z）
        /// </summary>
        public static void DuelBasis(Vector3 player, Vector3 spawn, Vector3 fallback, out Vector3 forward, out Vector3 right)
        {
            forward = spawn - player;
            forward.y = 0;
            if (!Finite(forward) || forward.sqrMagnitude < 0.25f)
            {
                forward = fallback;
                forward.y = 0;
            }
            if (!Finite(forward) || forward.sqrMagnitude < 1e-6f) forward = Vector3.forward;
            forward.Normalize();
            right = Vector3.Cross(Vector3.up, forward);
        }

        /// <summary>决斗坐标系里的偏移 → 世界偏移</summary>
        public static Vector3 ToWorld(Vector3 offset, Vector3 forward, Vector3 right) => right * offset.x + Vector3.up * offset.y + forward * offset.z;

        /// <summary>看向 target 的偏航 / 俯仰（度，Unity：俯仰 + = 低头），俯仰夹在 ±maxPitch</summary>
        public static void YawPitch(Vector3 from, Vector3 target, float maxPitch, out float yaw, out float pitch)
        {
            var d = target - from;
            yaw = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            float flat = new Vector2(d.x, d.z).magnitude;
            pitch = Mathf.Clamp(-Mathf.Atan2(d.y, Mathf.Max(1e-3f, flat)) * Mathf.Rad2Deg, -maxPitch, maxPitch);
        }

        /// <summary>
        /// 一镜第 u 秒的机位、看点、视角、横滚（不做地形避让；导演在这之后再避让）：
        /// k = ease(u / seconds)；看点 lookFrom → lookTo 线性；机位直线插值，orbit 时绕看点环绕插值
        /// </summary>
        public static void ShotFrame(IntroShot s, float u, BossIntroContext ctx, out Vector3 pos, out Vector3 look, out float fov, out float roll)
        {
            float k = Ease(s.ease, s.seconds > 0 ? u / s.seconds : 1f);
            var lookA = ctx.Point(s.lookFrom);
            var lookB = ctx.Point(s.lookTo);
            look = Vector3.LerpUnclamped(lookA, lookB, k);
            if (s.orbit) pos = look + Orbit(ctx.Point(s.from) - lookA, ctx.Point(s.to) - lookB, k);
            else pos = Vector3.LerpUnclamped(ctx.Point(s.from), ctx.Point(s.to), k);
            fov = Mathf.LerpUnclamped(s.fovFrom, s.fovTo, k);
            roll = Mathf.LerpUnclamped(s.rollFrom, s.rollTo, k);
        }

        /// <summary>一镜第 u 秒的姿态（不避让，测试 / 预览用）</summary>
        public static CamPose ShotPose(IntroShot s, float u, BossIntroContext ctx)
        {
            ShotFrame(s, u, ctx, out var pos, out var look, out float fov, out float roll);
            return CamPose.Look(pos, look, fov, roll);
        }

        /// <summary>手持 / 震屏噪声：三个独立的 −1..1 Perlin 通道</summary>
        public static Vector3 Noise3(float seed, float t) =>
            new((Mathf.PerlinNoise(seed, t) - 0.5f) * 2f, (Mathf.PerlinNoise(seed + 31.7f, t) - 0.5f) * 2f, (Mathf.PerlinNoise(seed + 77.3f, t) - 0.5f) * 2f);

        /// <summary>指数平滑（与帧率无关）</summary>
        public static float Damp(float a, float b, float lambda, float dt) => Mathf.Lerp(a, b, 1 - Mathf.Exp(-lambda * Mathf.Max(0, dt)));

        public static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
