using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// UI 门面（docs/unity-parity.md 4.8）：玩法代码只调这里，不直接找 <see cref="Hud"/>。
    /// 现在转发给当前场景的 Hud（没有 Hud 时什么都不做）；U1 把后端换成 UI Toolkit 时调用方不用改。
    /// 时长参数都是秒。
    /// </summary>
    public static class GameUI
    {
        static Hud Hud
        {
            get
            {
                var h = Spiritfire.Game.Hud.Instance;
                return h ? h : null;
            }
        }

        /// <summary>单行提示（屏幕上方）；color 缺省白色</summary>
        public static void Toast(string text, Color? color = null, float seconds = 2.8f) => Hud?.Toast(text, seconds, color);

        /// <summary>大横幅（区域肃清、关卡名…）；sub 是第二行</summary>
        public static void Banner(string title, string sub = null, float seconds = 2.6f) =>
            Hud?.Banner(string.IsNullOrEmpty(sub) ? title : title + "\n" + sub, seconds);

        /// <summary>世界空间浮字（反应名「焚雷」、「格挡」、灵宠台词…）：往上飘</summary>
        public static void FloatText(Vector3 world, string text, Color c, float scale = 1.3f) => Hud?.FloatText(world, text, c, scale);

        /// <summary>交互提示卡（null = 收起）</summary>
        public static void SetPrompt(InteractPrompt? p) => Hud?.SetPromptCard(p);

        /// <summary>左上目标文字（null / 空 = 收起）</summary>
        public static void SetObjective(string text) => Hud?.SetObjective(text);

        /// <summary>
        /// 当前首领（null = 清掉），首领血条由 U3 接上。
        /// 计划里的签名是 SetBoss(BossBrain)：BossBrain 由首领单元（B0）定义，在那之前先收 Damageable + 名字
        /// </summary>
        public static void SetBoss(Damageable boss, string title = null) => Hud?.SetBoss(boss, title);

        /// <summary>全屏闪光（颜色含 alpha，按剩余时间平方淡出；不受暂停影响）</summary>
        public static void ScreenFlash(Color c, float seconds) => Hud?.ScreenFlash(c, seconds);

        /// <summary>技能放不出来（冷却中 / 没有充能 / 正在持续）：技能栏对应的格子闪红。现在的后端是 SkillHud（订阅 <see cref="SkillDeniedShown"/>）</summary>
        public static void SkillDenied(SkillSlot slot) => SkillDeniedShown?.Invoke(slot);

        /// <summary>UI 后端订阅：哪个技能格要闪红</summary>
        public static event System.Action<SkillSlot> SkillDeniedShown;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => SkillDeniedShown = null;

        /// <summary>全屏黑幕淡到 to（0 透明 → 1 全黑），可 await；没有 HUD 时立刻完成</summary>
        public static async Awaitable Fade(float to, float seconds)
        {
            var h = Hud;
            if (h) await h.FadeTo(to, seconds);
        }

        // ───────── 局流程的临时接口（U5 换成 Screens 之前 GameSession 用）─────────

        /// <summary>右上角关卡名</summary>
        public static void SetStage(string text) => Hud?.SetStage(text);

        /// <summary>收起横幅与提示（弹模态界面、结算前）</summary>
        public static void ClearMessages() => Hud?.ClearMessages();

        /// <summary>屏幕中央的大字（阵亡 / 本关完成，富文本；null / 空 = 收起）</summary>
        public static void SetCenterText(string richText) => Hud?.ShowDeath(richText ?? "");
    }
}
