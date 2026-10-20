namespace Spiritfire.Game
{
#if UNITY_EDITOR || DEVELOPMENT_BUILD
    // 局外调试命令（没有热键，用 DevCommands.Run(id) 调）：只改当前档——直接打开关卡场景时是调试档，正式档不受影响

    /// <summary>魂晶 +1000（当前档）</summary>
    [Defs]
    public sealed class GrantEssenceCommand : DevCommand
    {
        public override string Id => "essence";
        public override string Label => "魂晶 +1000";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var meta = MetaSave.Current;
            meta.AddEssence(1000);
            DevCommands.Say($"魂晶 +1000（{meta.File}：{meta.Essence}）");
        }
    }

    /// <summary>全部天赋满级（当前档），立刻套到玩家身上</summary>
    [Defs]
    public sealed class MaxTalentsCommand : DevCommand
    {
        public override string Id => "talents_max";
        public override string Label => "天赋满级";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var meta = MetaSave.Current;
            foreach (var t in TalentLibrary.All) meta.SetTalentLevel(t.id, t.maxLevel, false);
            meta.File?.Save();
            GameEvents.RaiseMetaChanged(meta);
            DevCommands.Say($"天赋满级（{meta.File}）");
        }
    }

    /// <summary>天赋清零（当前档，不退魂晶）</summary>
    [Defs]
    public sealed class ResetTalentsCommand : DevCommand
    {
        public override string Id => "talents_reset";
        public override string Label => "天赋清零";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var meta = MetaSave.Current;
            foreach (var t in TalentLibrary.All) meta.SetTalentLevel(t.id, 0, false);
            meta.File?.Save();
            GameEvents.RaiseMetaChanged(meta);
            DevCommands.Say($"天赋清零（{meta.File}）");
        }
    }

    /// <summary>按阵亡结算当前局（魂晶入账、记生涯；场景流转之前用来测结算链）</summary>
    [Defs]
    public sealed class BankRunCommand : DevCommand
    {
        public override string Id => "bank_run";
        public override string Label => "结算本局";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var s = MetaSave.BankRun(RunState.Current, false);
            DevCommands.Say(s != null ? $"结算：魂晶 +{s.essenceEarned}" : "没有可结算的局（或已经结算过）");
        }
    }
#endif
}
