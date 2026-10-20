namespace Spiritfire.Game
{
    /// <summary>
    /// HUD 读武器状态的唯一入口（U2 的武器槽 / 准星从这里取）：<see cref="WeaponController.Hud"/> 平时是控制器自己，
    /// 武器被接管（碎刃）时换成接管者给的数据源。蓄力 / 热度来自当前开火模式（<see cref="IFireMode.Charge"/> / <see cref="IFireMode.Spin"/>）。
    /// </summary>
    public interface IWeaponHudSource
    {
        /// <summary>当前武器（可能为 null）</summary>
        WeaponInstance Weapon { get; }
        int Mag { get; }
        /// <summary>弹匣容量（吃属性与词条后）</summary>
        int MagCapacity { get; }
        int Reserve { get; }
        int ReserveCapacity { get; }
        /// <summary>无限弹药中（弹药显示 ∞）</summary>
        bool InfiniteAmmo { get; }
        bool Reloading { get; }
        float ReloadProgress { get; }
        /// <summary>蓄力 0..1（准星蓄力环；不在蓄力为 0）</summary>
        float Charge { get; }
        /// <summary>已经蓄满</summary>
        bool ChargeFull { get; }
        /// <summary>热度 / 转速 0..1（机炮预热）</summary>
        float Heat { get; }
        /// <summary>持续开火中（光束 / 机炮转满 / 蓄力）</summary>
        bool Firing { get; }
        /// <summary>准星散布半角（弧度）</summary>
        float Spread { get; }
        /// <summary>开镜程度 0..1</summary>
        float Aim { get; }
        /// <summary>下一发的元素（元素轮转武器按弹巢；其余 = 实例元素）</summary>
        Element NextElement { get; }
        /// <summary>开火模式 id（semi / auto / burst / beam / spinup / charge / volley；接管时由接管者定）</summary>
        string ModeId { get; }
    }
}
