namespace Spiritfire.Game
{
    /// <summary>
    /// 全自动（冲锋枪、步枪、喷火器）：按住按射速连发，冷却累加、同帧最多补 4 发（同 TS autoFire）。
    /// 改造前是「打一发把冷却重置成 1 / 射速」，每发丢掉不足一帧的余量：60 fps 下 13 发 / 秒的冲锋枪实际只有 12 发 / 秒。
    /// </summary>
    public sealed class AutoMode : FireModeBase
    {
        public AutoMode(WeaponDef def) : base(def) { }

        public override string Id => "auto";

        public override void Tick(in FireInput input, IFireHost host)
        {
            if (input.down && input.CanShoot) Repeat(in input, host);
        }
    }
}
