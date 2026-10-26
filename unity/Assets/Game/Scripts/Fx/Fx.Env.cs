using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 环境氛围特效入口（特效打磨 D 路）：水面扰动、持续翻涌。常驻的氛围（各章的空气粒子、火盆火焰、液面、瀑布）由 <see cref="EnvFxHost"/>
    /// 换关后按关卡主题和场景里的物件自动挂上，玩法代码不用管；这里只放需要玩法 / 首领脚本主动触发的那几样。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>
        /// 水面扰动（一下）：at 处的水面（Spiritfire/Water：1-4 月牙泉、2-3 冰窟窿、2-4 北冥海……）荡开三道涟漪，中心起一圈白沫，
        /// 溅起水花和水雾。radius = 涟漪最终扩到多大（米），strength 0..2（1 ≈ 一个人跳进水里，2 = 首领破水而出）。
        /// at.y 取水面高度（不在水面上也照样放涟漪，水花从 at 溅起）。返回的句柄 Cancel 提前收掉还没放出的涟漪。
        /// </summary>
        public static FxHandle WaterDisturb(Vector3 at, float radius, float strength = 1f) => EnvWater.Disturb(at, radius, strength);

        /// <summary>
        /// 水面持续翻涌：seconds 秒里在 at 周围 radius 米内一阵阵冒泡、荡涟漪、起水雾（首领在水下蓄势、要冒出来之前）。
        /// strength 0..2。句柄 Cancel 立刻停（已经荡开的涟漪自己散完），MoveTo 挪中心。
        /// </summary>
        public static FxHandle WaterChurn(Vector3 at, float radius, float seconds, float strength = 1f) => EnvWater.Churn(at, radius, seconds, strength);
    }
}
