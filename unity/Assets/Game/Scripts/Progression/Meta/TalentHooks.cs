using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 天赋生效（TS PlayerController.resetForRun 里的 meta.applyTalents）：把这一局该用的档（调试局 → 调试档）的天赋写进玩家属性表，来源「talent」。
    /// 三个时机都试一次（幂等，属性表里已经一样就不动）：
    ///   开局（<see cref="GameEvents.RunStarted"/>：GameSession.Awake 里发，玩家可能还没 Awake，那就跳过）；
    ///   关卡就绪（<see cref="GameEvents.StageLoaded"/>：L1 运行时生成玩家之后发）；
    ///   <see cref="TalentSystem"/> 的 Start（不在 RunPlan 里的场景——测试场、展示场景——没有 StageLoaded）。
    /// 局中买天赋（以后主菜单之外有入口时）由 <see cref="GameEvents.MetaChanged"/> 重新套用。
    /// </summary>
    public static class TalentHooks
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install()
        {
            // GameEvents 在 SubsystemRegistration 时清空，这里在加载第一个场景前重新挂上
            GameEvents.RunStarted -= OnRunStarted;
            GameEvents.RunStarted += OnRunStarted;
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.StageLoaded += OnStageLoaded;
            GameEvents.MetaChanged -= OnMetaChanged;
            GameEvents.MetaChanged += OnMetaChanged;
        }

        static void OnRunStarted(RunState run) => ApplyToPlayer();
        static void OnStageLoaded(StageSpec stage) => ApplyToPlayer();

        static void OnMetaChanged(MetaSave meta)
        {
            // 只在改的是这一局用的档时套用（结算写调试档时，正式局不受影响，反之亦然）
            if (meta != null && meta.File == SaveService.ProfileFor(RunState.Current)) ApplyToPlayer();
        }

        /// <summary>把当前局该用的天赋套到玩家身上；玩家还没就绪返回 false</summary>
        public static bool ApplyToPlayer()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.stats == null) return false;
            MetaSave.For(RunState.Current).ApplyTalents(pv.stats);
            return true;
        }
    }
}
