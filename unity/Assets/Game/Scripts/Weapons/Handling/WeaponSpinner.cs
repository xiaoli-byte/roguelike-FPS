namespace Spiritfire.Game
{
    /// <summary>
    /// 转管的数据（WC2）：哪根骨骼、满转速。由 <see cref="BarrelSpinner"/>（rig 零件）驱动：开火模式的预热量 <see cref="IFireMode.Spin"/>（机炮 0..1）
    /// × 满转速绕枪管轴（枪模 z）转，同 TS Viewmodel 的 spinner.rotation.z += spin × 42 × dt。
    /// 骨骼用 W3 导出的语义零件名（spinner）。每把一个 Handling_&lt;Id&gt;.cs 登记（id = 武器 id）。
    /// </summary>
    public sealed class WeaponSpinner : IDef
    {
        public string weaponId;
        /// <summary>转管骨骼名（语义零件名）</summary>
        public string bone;
        /// <summary>满转速（弧度 / 秒，TS 42）</summary>
        public float rate = 42f;

        string IDef.Id => weaponId;

        public static WeaponSpinner For(string weaponId) => Registry<WeaponSpinner>.Get(weaponId);
    }
}
