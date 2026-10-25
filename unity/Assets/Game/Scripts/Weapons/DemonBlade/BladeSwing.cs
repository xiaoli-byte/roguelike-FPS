using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>第一人称刀姿：握持点（相机局部坐标）+ 刀身朝向（刀身局部 +Y 刀尖、+X 刃口）</summary>
    public struct BladeHoldPose
    {
        public Vector3 pos;
        public Quaternion rot;

        public BladeHoldPose(Vector3 pos, Quaternion rot)
        {
            this.pos = pos;
            this.rot = rot;
        }

        /// <summary>位置线性、朝向球面插值</summary>
        public static BladeHoldPose Lerp(in BladeHoldPose a, in BladeHoldPose b, float t) =>
            new(Vector3.LerpUnclamped(a.pos, b.pos, t), Quaternion.Slerp(a.rot, b.rot, Mathf.Clamp01(t)));

        /// <summary>刀身局部坐标（刀身坐标系，米，未缩放）→ 相机局部坐标；scale = 第一人称刀模缩放，gripY = 握持点在刀身坐标里的 y</summary>
        public Vector3 BladePoint(float x, float y, float scale, float gripY) => pos + rot * (new Vector3(x, y - gripY, 0) * scale);

        /// <summary>刀尖方向（刀身 +Y）</summary>
        public Vector3 Tip => rot * Vector3.up;

        /// <summary>刃口方向（刀身 +X）</summary>
        public Vector3 Edge => rot * Vector3.right;
    }

    /// <summary>
    /// 碎刃第一人称的姿态数据与三段斩剪辑（WC7；Three.js BladeView.ts 的 IDLE / POINT / SHIELD / RAISE / SWINGS 关键帧，数值照抄，读入时换成 Unity 相机空间：z 取反）。
    /// 关键帧 = 握持点 p + 刀尖方向 d + 刃口方向 e；刀身坐标系 X = e（对 d 正交化）、Y = d、Z = X × Y。
    /// 三段斩：每段三个关键帧 [蓄势 W, 出刀 S（判定帧）, 收势 F]：
    ///   [0, a)：从当前姿态平滑转到 W（a = 判定帧 × <see cref="WindFrac"/>）；[a, h)：W → S 加速（t²），h = 判定帧；[h, 1]：S → F 缓出。
    /// 剪辑（<see cref="BladeSwingClip"/>）按这条时间线逐帧烘成曲线：长度 = 这一段的时长（秒），判定帧事件 <see cref="StrikeEvent"/> 放在 windup 秒，
    /// 与控制器在 swingT ≥ windup 时结算命中是同一时刻（EditMode 测试核对）。
    /// 约束（同 TS，按 60° 枪模相机在 16:9 与 4:3 投影核对）：握刀点始终在画面内；刀尖整段都朝前（不转向镜头）；判定帧时刀身穿过画面中部。
    /// </summary>
    public static class BladeSwing
    {
        /// <summary>蓄势占判定帧前的比例</summary>
        public const float WindFrac = 0.55f;
        /// <summary>收势进行到这里：刀光停采样、伸刃开始缩回</summary>
        public const float RecoverP = 0.72f;
        /// <summary>伸刃的固定段：刀根这一截不拉长（刀身坐标 y ≤ 此值）</summary>
        public const float StretchBaseY = 0.09f;

        /// <summary>剪辑里的动画事件（函数名，intParameter = 段号）：开始出刀（刀光起）/ 判定帧 / 收势（刀光止、伸刃回缩）</summary>
        public const string WindupEvent = "OnBladeWindup", StrikeEvent = "OnBladeStrike", RecoverEvent = "OnBladeRecover";

        /// <summary>剪辑里刀姿曲线绑定的路径（相对 BladeView 根：Sway / Unflip / Hold）与伸刃倍率字段（BladeView 上）</summary>
        public const string HoldPath = "Sway/Unflip/Hold", StretchProperty = "clipStretch";

        public readonly struct Key
        {
            public readonly Vector3 p, d, e;

            public Key(Vector3 p, Vector3 d, Vector3 e)
            {
                this.p = p;
                this.d = d;
                this.e = e;
            }

            public Quaternion Rotation => Basis(d, e);
            public BladeHoldPose Pose => new(p, Rotation);
        }

        /// <summary>TS 关键帧（Three.js 相机空间：x 右、y 上、z 朝后）→ Unity 相机局部（z 朝前）</summary>
        static Key K(float px, float py, float pz, float dx, float dy, float dz, float ex, float ey, float ez) =>
            new(new Vector3(px, py, -pz), new Vector3(dx, dy, -dz), new Vector3(ex, ey, -ez));

        /// <summary>待机：右下握刀（拳在画面内），刀身斜立在画面右侧，刃口朝左，刀面朝向镜头</summary>
        public static readonly Key Idle = K(0.25f, -0.22f, -0.5f, -0.28f, 0.82f, -0.5f, -0.92f, -0.1f, 0.38f);
        /// <summary>剑指（千刃出窍 / 杀气爆发落点）：右拳收在右下、刀根斜指前方，画面中央让给左手与刃群</summary>
        public static readonly Key Point = K(0.26f, -0.22f, -0.46f, -0.18f, 0.5f, -0.85f, -0.76f, -0.53f, -0.17f);
        /// <summary>碎刃屏障：刀柄横在身前（刀身已散成圆盾）</summary>
        public static readonly Key Shield = K(0.12f, -0.2f, -0.4f, -0.9f, 0.25f, -0.3f, 0, 0, -1);
        /// <summary>杀气爆发起手：刀柄高举</summary>
        public static readonly Key Raise = K(0.22f, -0.12f, -0.42f, -0.2f, 0.95f, -0.2f, -0.6f, 0, -0.8f);

        /// <summary>
        /// 三段斩 [蓄势, 出刀（判定帧）, 收势]：
        /// 0 右上 → 左下斜斩：蓄势时刀举过右肩，判定帧时刀身斜横在画面中下，收势停在左下；
        /// 1 左 → 右回斩：刀尖略上扬，判定帧时刀身斜指左前方，收势立在画面右侧；
        /// 2 伸刃：从右侧大幅横扫到左侧，判定帧时伸长的刀身在准星下方横贯画面。
        ///   相对 TS 的改动：TS 这一段刀面完全水平、又在眼睛下方十几厘米平视，伸长的刀身和刀光都只剩一条线；这里刃口朝下压、刀尖略低，
        ///   刀面朝镜头侧倾约 35°，横扫时看得到一整片刀光。
        /// </summary>
        public static readonly Key[][] Swings =
        {
            new[]
            {
                K(0.24f, 0, -0.48f, 0.3f, 0.85f, -0.15f, -0.75f, 0.2f, -0.6f),
                K(0.1f, -0.12f, -0.5f, -0.62f, -0.35f, -0.7f, -0.3f, -0.9f, 0.3f),
                K(-0.1f, -0.19f, -0.47f, -0.75f, -0.25f, -0.6f, -0.3f, -0.85f, 0.3f),
            },
            new[]
            {
                K(-0.14f, -0.15f, -0.46f, -0.85f, 0.3f, -0.1f, 0.3f, 0.2f, -0.9f),
                K(0.06f, -0.14f, -0.5f, -0.5f, 0.4f, -0.77f, 0.82f, 0.1f, -0.56f),
                K(0.28f, -0.17f, -0.44f, 0.55f, 0.35f, -0.75f, 0.75f, -0.1f, 0.6f),
            },
            new[]
            {
                K(0.3f, -0.12f, -0.44f, 0.85f, 0.08f, -0.4f, -0.4f, -0.3f, -0.92f),
                K(0.05f, -0.15f, -0.5f, -0.72f, -0.1f, -0.68f, -0.66f, -0.45f, 0.62f),
                K(-0.16f, -0.2f, -0.46f, -0.85f, -0.08f, -0.45f, -0.45f, -0.42f, 0.8f),
            },
        };

        /// <summary>刀身坐标系：X = e（对 d 正交化）、Y = d、Z = X × Y</summary>
        public static Quaternion Basis(Vector3 d, Vector3 e)
        {
            var y = d.normalized;
            var x = e - y * Vector3.Dot(e, y);
            if (x.sqrMagnitude < 1e-8f) x = Vector3.Cross(y, Vector3.forward);
            x.Normalize();
            var z = Vector3.Cross(x, y);
            return Quaternion.LookRotation(z, y);
        }

        /// <summary>手势的目标刀姿</summary>
        public static Key GestureKey(BladeGesture g) => g switch
        {
            BladeGesture.Point => Point,
            BladeGesture.Shield => Shield,
            BladeGesture.Raise => Raise,
            _ => Idle,
        };

        /// <summary>左手出现的程度：剑指 / 举手 1、立掌（屏障）0.8、没有手势 0（同 TS）</summary>
        public static float LeftHandWeight(BladeGesture g) => g switch
        {
            BladeGesture.Point or BladeGesture.Raise => 1,
            BladeGesture.Shield => 0.8f,
            _ => 0,
        };

        public static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }

        /// <summary>判定帧在进度里的位置（钳到 0.05–0.9，同 TS）</summary>
        public static float StrikeP(float hitP) => Mathf.Clamp(hitP, 0.05f, 0.9f);

        /// <summary>开始出刀（蓄势结束、刀光开始）在进度里的位置</summary>
        public static float WindupP(float hitP) => StrikeP(hitP) * WindFrac;

        /// <summary>第 seg 段在进度 p 的刀姿；蓄势段从 from 转过去（剪辑里 from = 待机）</summary>
        public static BladeHoldPose Sample(int seg, float p, float hitP, in BladeHoldPose from)
        {
            var k = Swings[Mathf.Clamp(seg, 0, Swings.Length - 1)];
            float h = StrikeP(hitP), a = h * WindFrac;
            if (p < a) return BladeHoldPose.Lerp(from, k[0].Pose, Smooth(p / a));
            if (p < h)
            {
                float t = (p - a) / (h - a);
                return BladeHoldPose.Lerp(k[0].Pose, k[1].Pose, t * t);
            }
            float u = Mathf.Clamp01((p - h) / (1 - h));
            return BladeHoldPose.Lerp(k[1].Pose, k[2].Pose, 1 - (1 - u) * (1 - u));
        }

        /// <summary>
        /// 剪辑里的伸刃倍率（不含人刀合一的常态伸长）：蓄势末段开始伸长、判定帧时到 slashStretch、收势（<see cref="RecoverP"/> 之后）缩回（同 TS）
        /// </summary>
        public static float Stretch(float p, float hitP, float slashStretch)
        {
            if (slashStretch <= 1.0001f) return 1;
            float h = StrikeP(hitP);
            float o = Smooth((p - h * WindFrac) / (h * (1 - WindFrac)));
            float back = 1 - Smooth((p - RecoverP) / (1 - RecoverP));
            return 1 + (slashStretch - 1) * o * back;
        }

        /// <summary>伸刃后的刀身长度坐标：刀根 <see cref="StretchBaseY"/> 以内不动，其余按倍率拉长</summary>
        public static float StretchY(float y, float stretch) => y <= StretchBaseY ? y : StretchBaseY + (y - StretchBaseY) * stretch;
    }

    /// <summary>
    /// 一段斩击的动画剪辑（代码生成）：刀姿（Hold 的局部位置 / 旋转）与伸刃倍率的曲线 + 三个动画事件（出刀 / 判定帧 / 收势）。
    ///   · 时间轴是这一段的真实时长（秒）：判定帧事件在 <see cref="BladeSlash.windup"/>，与控制器结算命中的时刻一致；攻速加成只改播放速率，比例不变；
    ///   · 曲线按 <see cref="Samples"/> 均匀采样再补上出刀 / 判定帧 / 收势三个关键时刻（线性切线，所以采样之间就是线性插值），四元数逐帧保持同一半球；
    ///   · 运行时 <see cref="BladeView"/> 直接求曲线（跟着控制器给的进度走，顿帧时停住），事件按进度越过它们的时刻派发；
    ///     同一份剪辑由 BladeAnimBaker 存成 Assets/Art/Weapons/SK_Weapon_DemonBlade/Anim/AN_DemonBlade_Slash{1,2,3}.anim（审阅、以后接 Animator 用），
    ///     绑定路径相对 BladeView 根（<see cref="BladeSwing.HoldPath"/>），事件调 BladeView 上的同名方法。
    /// 蓄势段（判定帧 × 0.55 之前）剪辑里从待机姿态起；运行时从当前姿态起（上一段的收势、手势），所以只取剪辑在出刀时刻的姿态作目标。
    /// </summary>
    public sealed class BladeSwingClip
    {
        /// <summary>均匀采样的段数</summary>
        public const int Samples = 48;

        public readonly int segment;
        /// <summary>时长、开始出刀、判定帧、收势（秒）</summary>
        public readonly float duration, windupTime, strikeTime, recoverTime;
        /// <summary>这一段的伸刃倍率（第三段 2.2）</summary>
        public readonly float slashStretch;
        public readonly AnimationClip clip;
        readonly AnimationCurve px, py, pz, qx, qy, qz, qw, stretch;
        readonly AnimationEvent[] events;

        public float HitP => strikeTime / duration;
        public float WindupP => windupTime / duration;
        public float RecoverP => recoverTime / duration;

        /// <summary>按武器表这一段的时长 / 判定帧 / 伸刃生成。legacy = 运行时建（非 legacy 剪辑的 SetCurve 只能在编辑器里用）</summary>
        public BladeSwingClip(int segment, BladeSlash slash, bool legacy)
        {
            this.segment = segment;
            duration = Mathf.Max(0.05f, slash != null ? slash.duration : 0.3f);
            float hitP = slash != null ? slash.windup / duration : 0.3f;
            slashStretch = slash != null ? Mathf.Max(1, slash.stretch) : 1;
            strikeTime = BladeSwing.StrikeP(hitP) * duration;
            windupTime = BladeSwing.WindupP(hitP) * duration;
            recoverTime = BladeSwing.RecoverP * duration;

            var times = new List<float>(Samples + 4);
            for (int i = 0; i <= Samples; i++) times.Add(duration * i / Samples);
            times.Add(windupTime);
            times.Add(strikeTime);
            times.Add(recoverTime);
            times.Sort();
            for (int i = times.Count - 1; i > 0; i--)
                if (times[i] - times[i - 1] < 1e-4f) times.RemoveAt(i);

            int n = times.Count;
            var kp = new Keyframe[7][];
            for (int c = 0; c < 7; c++) kp[c] = new Keyframe[n];
            var ks = new Keyframe[n];
            var idle = BladeSwing.Idle.Pose;
            Quaternion prev = Quaternion.identity;
            for (int i = 0; i < n; i++)
            {
                float t = times[i], p = t / duration;
                var pose = BladeSwing.Sample(segment, p, hitP, idle);
                var q = pose.rot;
                if (i > 0 && Quaternion.Dot(prev, q) < 0) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
                prev = q;
                kp[0][i] = new Keyframe(t, pose.pos.x);
                kp[1][i] = new Keyframe(t, pose.pos.y);
                kp[2][i] = new Keyframe(t, pose.pos.z);
                kp[3][i] = new Keyframe(t, q.x);
                kp[4][i] = new Keyframe(t, q.y);
                kp[5][i] = new Keyframe(t, q.z);
                kp[6][i] = new Keyframe(t, q.w);
                ks[i] = new Keyframe(t, BladeSwing.Stretch(p, hitP, slashStretch));
            }
            px = Linear(kp[0]);
            py = Linear(kp[1]);
            pz = Linear(kp[2]);
            qx = Linear(kp[3]);
            qy = Linear(kp[4]);
            qz = Linear(kp[5]);
            qw = Linear(kp[6]);
            stretch = Linear(ks);

            clip = new AnimationClip { name = $"AN_DemonBlade_Slash{segment + 1}", legacy = legacy, frameRate = 60, wrapMode = WrapMode.Once };
            var hold = typeof(Transform);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localPosition.x", px);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localPosition.y", py);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localPosition.z", pz);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localRotation.x", qx);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localRotation.y", qy);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localRotation.z", qz);
            clip.SetCurve(BladeSwing.HoldPath, hold, "localRotation.w", qw);
            clip.SetCurve("", typeof(BladeView), BladeSwing.StretchProperty, stretch);
            events = new[]
            {
                new AnimationEvent { time = windupTime, functionName = BladeSwing.WindupEvent, intParameter = segment },
                new AnimationEvent { time = strikeTime, functionName = BladeSwing.StrikeEvent, intParameter = segment },
                new AnimationEvent { time = recoverTime, functionName = BladeSwing.RecoverEvent, intParameter = segment },
            };
            // 编辑器里（非 Play）剪辑的事件只能由 AnimationUtility 写（烘焙器存 .anim 时写）；运行时直接挂上
            if (Application.isPlaying) clip.events = events;
        }

        /// <summary>线性切线：每个关键帧的入 / 出切线 = 与相邻关键帧的斜率（Hermite 段退化成直线）</summary>
        static AnimationCurve Linear(Keyframe[] k)
        {
            for (int i = 0; i < k.Length; i++)
            {
                float inT = i > 0 ? (k[i].value - k[i - 1].value) / Mathf.Max(1e-6f, k[i].time - k[i - 1].time) : 0;
                float outT = i < k.Length - 1 ? (k[i + 1].value - k[i].value) / Mathf.Max(1e-6f, k[i + 1].time - k[i].time) : 0;
                if (i == 0) inT = outT;
                if (i == k.Length - 1) outT = inT;
                k[i].inTangent = inT;
                k[i].outTangent = outT;
                k[i].weightedMode = WeightedMode.None;
            }
            return new AnimationCurve(k) { preWrapMode = WrapMode.ClampForever, postWrapMode = WrapMode.ClampForever };
        }

        /// <summary>剪辑在 time 秒的刀姿</summary>
        public BladeHoldPose Sample(float time)
        {
            var pos = new Vector3(px.Evaluate(time), py.Evaluate(time), pz.Evaluate(time));
            var q = new Quaternion(qx.Evaluate(time), qy.Evaluate(time), qz.Evaluate(time), qw.Evaluate(time));
            float m = Mathf.Sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            q = m > 1e-6f ? new Quaternion(q.x / m, q.y / m, q.z / m, q.w / m) : Quaternion.identity;
            return new BladeHoldPose(pos, q);
        }

        /// <summary>进度 p（0..1）的刀姿</summary>
        public BladeHoldPose SampleP(float p) => Sample(Mathf.Clamp01(p) * duration);

        /// <summary>剪辑在 time 秒的伸刃倍率</summary>
        public float Stretch(float time) => stretch.Evaluate(time);

        public float StretchP(float p) => Stretch(Mathf.Clamp01(p) * duration);

        /// <summary>这一段的三个动画事件（按时间排序；运行时也挂在 <see cref="clip"/> 上，编辑器里由烘焙器用 AnimationUtility 写进 .anim）</summary>
        public AnimationEvent[] Events => events;

        /// <summary>剪辑和武器表这一段的时长 / 判定帧 / 伸刃还一致（武器表换了就重建）</summary>
        public bool Matches(BladeSlash slash) =>
            slash != null && Mathf.Abs(slash.duration - duration) < 1e-4f && Mathf.Abs(BladeSwing.StrikeP(slash.windup / Mathf.Max(0.05f, slash.duration)) * duration - strikeTime) < 1e-4f &&
            Mathf.Abs(Mathf.Max(1, slash.stretch) - slashStretch) < 1e-4f;
    }
}
