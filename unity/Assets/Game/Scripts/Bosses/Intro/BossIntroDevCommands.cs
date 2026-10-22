#if UNITY_EDITOR || DEVELOPMENT_BUILD
namespace Spiritfire.Game
{
    /// <summary>忘掉所有首领登场演出的「看过」（再看一次要先看满 1.5 s 才能跳）。没有热键：DevCommands.Run("boss_intro_reset")</summary>
    [Defs]
    public sealed class BossIntroResetCommand : DevCommand
    {
        public override string Id => "boss_intro_reset";
        public override string Label => "重置首领演出「看过」";

        public override void Execute()
        {
            BossIntroLog.Current.ForgetAll();
            DevCommands.Say("首领登场演出都记成「没看过」");
        }
    }

    /// <summary>首领登场演出开关（Auto → 关 → 总是放 → Auto）。没有热键：DevCommands.Run("boss_intro_policy")</summary>
    [Defs]
    public sealed class BossIntroPolicyCommand : DevCommand
    {
        public override string Id => "boss_intro_policy";
        public override string Label => "首领演出开关";

        public override void Execute()
        {
            BossIntroDirector.Policy = BossIntroDirector.Policy switch
            {
                BossIntroPolicy.Auto => BossIntroPolicy.Never,
                BossIntroPolicy.Never => BossIntroPolicy.Always,
                _ => BossIntroPolicy.Auto,
            };
            DevCommands.Say($"首领登场演出：{BossIntroDirector.Policy}");
        }
    }
}
#endif
