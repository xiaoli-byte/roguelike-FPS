using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 天赋生效（TS PlayerController.resetForRun 里的 meta.applyTalents）：把这一局的天赋写进玩家属性表，来源「talent」。
    /// 天赋在开局时锁定：<see cref="GameEvents.RunStarted"/>（<see cref="RunState.Begin"/> 里发）时把这一局该用的档（调试局 → 调试档）的天赋等级拍成快照
    /// 存进 <see cref="RunState.talents"/>，之后整局都按快照套——跨关、重来本关、暂离后「继续征程」（快照随续玩档 run.json 存读）都一样；
    /// 暂离期间在主菜单买的天赋照常进元进度，下一局开局才生效。没有快照的局（旧版本续玩档读回来时已按当时的天赋补上；测试拼的局）按档里当前的天赋。
    /// 套用时机都试一次（幂等，属性表里已经一样就不动）：
    ///   开局（<see cref="GameEvents.RunStarted"/>，玩家可能还没组装，那就跳过）；
    ///   关卡就绪（<see cref="GameEvents.StageLoaded"/>：L1 运行时生成玩家之后发）；
    ///   <see cref="TalentSystem"/> 的 Start（不在 RunPlan 里的场景——测试场、展示场景——没有 StageLoaded）；
    ///   <see cref="GameEvents.MetaChanged"/>（有快照的局套出来不变；没有快照的局跟着档走）。
    /// </summary>
    public static class TalentHooks
    {
        /// <summary>挂上开局 / 关卡就绪 / 元进度变化的钩子（加载第一个场景前自动调；幂等，EditMode 测试手动调）</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        public static void EnsureInstalled()
        {
            // GameEvents 在 SubsystemRegistration 时清空，这里在加载第一个场景前重新挂上
            GameEvents.RunStarted -= OnRunStarted;
            GameEvents.RunStarted += OnRunStarted;
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.StageLoaded += OnStageLoaded;
            GameEvents.MetaChanged -= OnMetaChanged;
            GameEvents.MetaChanged += OnMetaChanged;
        }

        static void OnRunStarted(RunState run)
        {
            Lock(run);
            ApplyToPlayer();
        }

        static void OnStageLoaded(StageSpec stage) => ApplyToPlayer();

        static void OnMetaChanged(MetaSave meta)
        {
            // 只在改的是这一局用的档时套用（结算写调试档时，正式局不受影响，反之亦然）
            if (meta != null && meta.File == SaveService.ProfileFor(RunState.Current)) ApplyToPlayer();
        }

        /// <summary>开局锁定天赋：这一局还没有快照时，从它该用的档里拍一份（已经有了不动）；返回这一局的快照</summary>
        public static Dictionary<string, int> Lock(RunState run)
        {
            if (run == null) return null;
            return run.talents ??= MetaSave.For(run).TalentSnapshot();
        }

        /// <summary>把当前局的天赋（开局快照）套到玩家身上；玩家还没就绪返回 false</summary>
        public static bool ApplyToPlayer()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.stats == null) return false;
            MetaSave.ApplyTalents(pv.stats, RunState.Current);
            return true;
        }
    }
}
