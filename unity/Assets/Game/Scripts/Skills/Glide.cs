using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 滑翔（鼯的被动「凌空」，Three.js 版 PlayerController 里 run.flags.glide 那一段）：下落时按住跳跃键张开飞膜。
    ///   · 生效条件：在空中、不在冲刺、正在下落（帧初竖直速度 &lt; 0）、按住跳跃、这一帧没有按下跳跃（按下可能是二段跳，那一帧照常起跳）、跳跃没被锁；
    ///   · 效果：重力 × 0.3 加速到滑翔下落速度 2.4 m/s 为止；已经比它下落得快（高处才开伞）时按 9/s 平滑刹到 2.4，不再叠加重力；
    ///     空中控制加速度 +6（20 → 26），滑翔时转向更灵。
    /// 以前 TS 把这条规则写死在玩家控制器里、靠旗标开关；这里是一个运动修饰器（<see cref="IMotorModifier"/>），由被动登记、撤销即失效。
    /// 规则本身是纯函数 <see cref="Apply(ref MotorFrame, bool)"/>，EditMode 测试直接喂 <see cref="MotorFrame"/>。
    /// 冒烟测试没法按住真实按键：<see cref="TestHeld"/> = true 时当作一直按住跳跃。
    /// </summary>
    public sealed class Glide : IMotorModifier
    {
        /// <summary>滑翔下落速度上限（m/s）、滑翔时的重力倍率、从高速下落刹到滑翔速度的速率、滑翔时的空中控制加速度（基础 20）</summary>
        public const float FallSpeed = 2.4f, GravityMult = 0.3f, Brake = 9f, AirAccel = 26f, BaseAirAccel = 20f;
        /// <summary>修饰器优先级：改写下落上限这类「覆盖」参数，排在倍率类修饰器之后</summary>
        public const int Priority = 100;

        /// <summary>冒烟测试：当作一直按住跳跃键</summary>
        public static bool TestHeld;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => TestHeld = false;

        /// <summary>上一帧在滑翔（HUD / 镜头 / 测试读取）</summary>
        public bool Gliding { get; private set; }

        public void Modify(ref MotorFrame f) => Gliding = Apply(ref f, f.jumpHeld || TestHeld);

        /// <summary>这一帧该不该滑翔（held = 按住跳跃）</summary>
        public static bool ShouldGlide(in MotorFrame f, bool held) =>
            held && !f.grounded && !f.dashing && f.velocity.y < 0 && !f.jumpPressed && (f.locks & MotorLock.Jump) == 0;

        /// <summary>滑翔规则：满足条件时改写重力倍率、下落上限、刹车速率与空中控制，返回是否在滑翔</summary>
        public static bool Apply(ref MotorFrame f, bool held)
        {
            if (!ShouldGlide(in f, held)) return false;
            f.gravityScale *= GravityMult;
            f.maxFallSpeed = Mathf.Min(f.maxFallSpeed, FallSpeed);
            f.fallBrake = Mathf.Max(f.fallBrake, Brake);
            f.airAccel += AirAccel - BaseAirAccel;
            return true;
        }
    }
}
