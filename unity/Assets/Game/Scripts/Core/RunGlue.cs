using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 把各单元先各自留好的接口接到局状态上（它们开发时 <see cref="RunState"/> 还不存在）：
    /// 武器掷骰的章节读当前局（RunState 的章从 1 起，掷骰从 0 起）；击杀给的魂晶记进当前局的钱包。
    /// </summary>
    static class RunGlue
    {
        // SubsystemRegistration 时各处静态已清空，这里在加载第一个场景前重新挂上
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install()
        {
            WeaponRoller.ChapterSource = () => RunState.Current != null ? RunState.Current.chapter - 1 : 0;
            KillResolver.Rewarded -= OnKillRewarded;
            KillResolver.Rewarded += OnKillRewarded;
        }

        static void OnKillRewarded(in KillReward r)
        {
            if (r.essence > 0) RunState.Ensure().CreditEssence(r.essence, "kill");
        }
    }
}
