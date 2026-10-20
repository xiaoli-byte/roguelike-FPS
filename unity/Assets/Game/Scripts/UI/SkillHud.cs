using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 技能栏的挂点（U2 起 UI 在 UI Toolkit 的 <see cref="SkillWidget"/>：底部居中 Q / E 圆环 + 冲刺格）。
    /// <see cref="PlayerFactory.Bind"/> 每组装一个玩家就换一个新的 SkillHud（skills = 这个玩家的技能），技能栏读 <see cref="Current"/>；
    /// 冒烟测试按组件数检查「技能栏只有一个」，所以组件本身保留。
    /// 放出闪光走 <see cref="GameEvents.SkillUsed"/>，拒绝闪红走 <see cref="GameUI.SkillDenied"/>，都由部件自己订阅。
    /// </summary>
    public sealed class SkillHud : MonoBehaviour
    {
        public HeroSkills skills;

        /// <summary>最近启用的挂点（换玩家时新挂的那个）</summary>
        public static SkillHud Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Current = null;

        void OnEnable() => Current = this;

        void Start()
        {
            if (!skills) skills = FindAnyObjectByType<HeroSkills>();
        }

        void OnDisable()
        {
            if (Current == this) Current = null;
        }
    }
}
