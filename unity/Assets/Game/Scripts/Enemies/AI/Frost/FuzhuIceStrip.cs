using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 夫诸冰光扫过的冻地（Three.js 版 FrostRangedFx.spawnFrozenStrip）：a → b（地面点）一条半宽 halfWidth 的冰面，0.25 s 内沿光束方向「冻过去」，
    /// duration 秒后化掉（最后 0.6 s 淡出）。踩上去打滑：玩家这一帧想要的速度变化只保留一成（加速、刹车都很慢），滑行速度每秒衰减 0.6；
    /// 抵消用的是单帧 &lt; 2.8 m/s 的冲量（不触发击退硬直，见 MotorCore.AddImpulse）。冲刺 / 突进中、离地、高差超过 0.6 m 不打滑。
    /// 多条冻地重叠时同一帧只结算一次（静态的滑行状态）。外观：Telegraph 的长条持续区域（冰蓝）+ 冻过去时沿途冒冰屑，
    /// FX3 起再沿途铺一串流动霜纹（<see cref="Fx.FrostPatch"/>，跟着冻过去）。
    /// </summary>
    public sealed class FuzhuIceStrip : MonoBehaviour
    {
        /// <summary>冰面上保留的加速度比例、滑行阻力（每秒衰减率）、单帧冲量上限、冻过去的时长 / 多冻出的长度、淡出时长、判定高差</summary>
        public const float Traction = 0.1f, Drag = 0.6f, MaxImpulse = 2.8f, GrowTime = 0.25f, GrowExtra = 1.5f, FadeTime = 0.6f, HeightBand = 0.6f;

        static readonly Color StripColor = new(0.66f, 0.93f, 1f, 0.85f), ShardColor = Hex.Rgb(0xdff6ff);
        static int slipFrame = -10;
        static Vector3 slipV;

        Vector3 a, fwd;
        float len, halfWidth, duration, t, shardAt, patchAt;
        TelegraphHandle sheet;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            slipFrame = -10;
            slipV = Vector3.zero;
        }

        /// <summary>玩家这一帧（或上一帧）在冰面上打滑（UI 提示 / 冒烟测试）</summary>
        public static bool PlayerOnIce => slipFrame >= Time.frameCount - 1;

        /// <summary>铺一条冻地（太短的不铺，返回 null）</summary>
        public static FuzhuIceStrip Spawn(Vector3 a, Vector3 b, float halfWidth, float duration)
        {
            var d = b - a;
            d.y = 0;
            float len = d.magnitude;
            if (len < 0.5f || !(duration > 0) || !Fx.Finite(a) || !Fx.Finite(b)) return null;
            var go = new GameObject("Fuzhu Ice Strip");
            go.transform.position = a;
            var s = go.AddComponent<FuzhuIceStrip>();
            s.a = new Vector3(a.x, (a.y + b.y) * 0.5f, a.z);
            s.fwd = d / len;
            s.len = len;
            s.halfWidth = halfWidth;
            s.duration = duration;
            s.sheet = Telegraph.Spawn(new TelegraphSpec
            {
                shape = TelegraphShape.Line, style = TelegraphStyle.Zone, center = a, yaw = Mathf.Atan2(s.fwd.x, s.fwd.z) * Mathf.Rad2Deg,
                radius = len, width = halfWidth * 2f, duration = duration, color = StripColor,
            });
            GameAudio.PlayAt("land", b, 0.35f, 1.8f);
            return s;
        }

        void OnDestroy() => sheet.Cancel();

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            float grow = Mathf.Min(1, t / GrowTime) * (len + GrowExtra);
            // 冻过去：冰屑沿光束方向冒出来
            if (grow < len + GrowExtra && t - shardAt > 0.04f)
            {
                shardAt = t;
                float along = Mathf.Min(grow, len);
                var side = new Vector3(fwd.z, 0, -fwd.x) * ((Random.value - 0.5f) * 2f * halfWidth);
                FrostKit.Shatter(a + fwd * along + side + Vector3.up * 0.1f, 0.3f, ShardColor, 4, 2.5f);
            }
            // 霜纹：每隔 1.8 个半宽铺一块，跟着冻过去的前沿走
            float step = Mathf.Max(1f, halfWidth * 1.8f);
            while (patchAt <= Mathf.Min(grow, len) && t < duration - 0.3f)
            {
                Fx.FrostPatch(a + fwd * patchAt + Vector3.up * 0.02f, halfWidth * 1.3f, duration - t, 1.3f);
                patchAt += step;
            }
            if (t < duration) SlipPlayer(Mathf.Min(grow, len), dt);
            if (t >= duration) Destroy(gameObject);
        }

        /// <summary>脚底 feet 在冻地上：沿冰面 [0, length]，横向 ≤ 半宽 + 玩家半径的一半，高差 ≤ 0.6 m</summary>
        public static bool OnStrip(Vector3 a, Vector3 fwd, float length, float halfWidth, Vector3 feet, float playerRadius)
        {
            if (Mathf.Abs(feet.y - a.y) > HeightBand) return false;
            float dx = feet.x - a.x, dz = feet.z - a.z;
            float along = dx * fwd.x + dz * fwd.z;
            float side = dx * fwd.z - dz * fwd.x;
            return along >= 0 && along <= length && Mathf.Abs(side) <= halfWidth + playerRadius * 0.5f;
        }

        /// <summary>
        /// 打滑的抵消冲量（同 TS slipPlayer）：上一帧结束时的滑行速度 prev 按 0.6/s 衰减，玩家这一帧的速度 v 相对它的变化只保留一成，
        /// 其余九成反向抵掉；单帧冲量封顶 2.8 m/s。只算水平
        /// </summary>
        public static Vector3 SlipImpulse(Vector3 v, Vector3 prev, float dt)
        {
            float drag = Mathf.Exp(-Drag * Mathf.Max(0, dt));
            var i = new Vector3((v.x - prev.x * drag) * (Traction - 1), 0, (v.z - prev.z * drag) * (Traction - 1));
            float m = i.magnitude;
            if (m > MaxImpulse) i *= MaxImpulse / m;
            return i;
        }

        void SlipPlayer(float length, float dt)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var motor = pv.GetComponent<PlayerMotor>();
            if (!motor || !motor.Grounded || motor.Dashing || motor.Lunging) return;
            var cc = pv.GetComponent<CharacterController>();
            if (!OnStrip(a, fwd, length, halfWidth, pv.transform.position, cc ? cc.radius : 0.35f)) return;
            int frame = Time.frameCount;
            if (slipFrame == frame) return;
            var v = motor.Velocity;
            v.y = 0;
            if (slipFrame < frame - 1) slipV = v; // 刚踩上冰面：从当前速度开始滑
            else
            {
                var i = SlipImpulse(v, slipV, dt);
                if (i.sqrMagnitude > 1e-8f) motor.AddImpulse(i);
                slipV = v + i;
            }
            slipFrame = frame;
        }
    }
}
