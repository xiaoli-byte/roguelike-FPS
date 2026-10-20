using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// UI 门面（docs/unity-parity.md 4.8）：玩法代码只调这里，不直接找 <see cref="Hud"/> 或 UI Toolkit 组件。
    /// 后端：
    ///   UI Toolkit 全局件（<see cref="UIRoot"/>，U1）—— <see cref="Toast"/>（队列、叠放、合并 ×N）、<see cref="Banner"/>、<see cref="Fade"/>（黑幕）、<see cref="ScreenFlash"/>，
    ///     全部用不缩放时间（暂停中照常淡出），换场景不丢；
    ///   HUD 部件（<see cref="Hud"/> 宿主上的 [HudWidget]，U2）—— 交互提示卡、目标、关卡名、中央大字、技能拒绝闪红；
    ///   旧 uGUI（U3 迁走之前）—— 世界浮字、首领。
    /// 没有 HUD 宿主（编辑模式、主菜单）时 HUD 类调用什么都不做；关卡名 / 目标记在这里，HUD 起来时补上。时长参数都是秒。
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

        static T W<T>() where T : HudWidget
        {
            var h = Hud;
            return h ? h.Widget<T>() : null;
        }

        /// <summary>当前关卡名 / 目标（HUD 重建时补上；测试用）</summary>
        public static string StageText { get; private set; } = "";
        public static string ObjectiveText { get; private set; } = "";

        /// <summary>提示（屏幕左侧往下叠，最多 4 条，和上一条相同就合并 ×N）；color = 强调色，缺省鎏金</summary>
        public static void Toast(string text, Color? color = null, float seconds = 2.8f) => UIRoot.Ensure()?.Toasts.Push(text, color, seconds);

        /// <summary>
        /// 大横幅（区域肃清、关卡名…）；sub 是第二行小字。
        /// 旧写法把两行塞进 title（"1-1\n古道穿越戈壁"）时：最后一行当标题、前面的当副标题（同 Three.js：大字地名、小字关卡号）
        /// </summary>
        public static void Banner(string title, string sub = null, float seconds = 2.6f)
        {
            var ui = UIRoot.Ensure();
            if (!ui) return;
            if (string.IsNullOrEmpty(sub) && title != null && title.Contains("\n"))
            {
                int cut = title.LastIndexOf('\n');
                sub = title.Substring(0, cut).Replace("\n", " · ");
                title = title.Substring(cut + 1);
            }
            ui.Banner.Show(title, sub, seconds);
        }

        /// <summary>世界空间浮字（反应名「焚雷」、「格挡」、灵宠台词…）：往上飘（U3 之前在 Hud）</summary>
        public static void FloatText(Vector3 world, string text, Color c, float scale = 1.3f) => Hud?.FloatText(world, text, c, scale);

        /// <summary>交互提示卡（null = 收起）</summary>
        public static void SetPrompt(InteractPrompt? p) => W<PromptWidget>()?.Set(p);

        /// <summary>目标文字（右上信息角；null / 空 = 收起）</summary>
        public static void SetObjective(string text)
        {
            ObjectiveText = text ?? "";
            W<InfoWidget>()?.SetObjective(ObjectiveText);
        }

        /// <summary>
        /// 当前首领（null = 清掉），首领血条由 U3 接上。
        /// 计划里的签名是 SetBoss(BossBrain)：BossBrain 由首领单元（B0）定义，在那之前先收 Damageable + 名字
        /// </summary>
        public static void SetBoss(Damageable boss, string title = null) => Hud?.SetBoss(boss, title);

        /// <summary>全屏闪光（颜色含 alpha，按剩余时间平方淡出；不受暂停影响）</summary>
        public static void ScreenFlash(Color c, float seconds) => UIRoot.Ensure()?.Flash.Play(c, seconds);

        /// <summary>技能放不出来（冷却中 / 没有充能 / 正在持续）：技能盘闪红抖一下（<see cref="SkillWidget"/> 订阅 <see cref="SkillDeniedShown"/>）</summary>
        public static void SkillDenied(SkillSlot slot) => SkillDeniedShown?.Invoke(slot);

        /// <summary>UI 后端订阅：哪个技能格要闪红</summary>
        public static event System.Action<SkillSlot> SkillDeniedShown;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            SkillDeniedShown = null;
            StageText = ObjectiveText = "";
        }

        /// <summary>全屏黑幕淡到 to（0 透明 → 1 全黑），可 await；新的淡入淡出打断旧的（旧的 await 立刻返回）。没有 UI（编辑模式）时立刻完成</summary>
        public static async Awaitable Fade(float to, float seconds)
        {
            var ui = UIRoot.Ensure();
            if (ui) await ui.Curtain.FadeTo(to, seconds);
        }

        /// <summary>黑幕当前不透明度（0–1）</summary>
        public static float FadeValue => UIRoot.Instance ? UIRoot.Instance.Curtain.Value : 0;

        // ───────── 局流程的临时接口（U5 换成 Screens 之前 GameSession 用）─────────

        /// <summary>右上角关卡名</summary>
        public static void SetStage(string text)
        {
            StageText = text ?? "";
            W<InfoWidget>()?.SetStage(StageText);
        }

        /// <summary>收起横幅与提示（弹模态界面、结算前）</summary>
        public static void ClearMessages()
        {
            var ui = UIRoot.Instance;
            if (!ui) return;
            ui.Toasts.Clear();
            ui.Banner.Hide(true);
        }

        /// <summary>屏幕中央的大字（阵亡 / 本关完成，富文本；null / 空 = 收起）</summary>
        public static void SetCenterText(string richText) => W<CenterTextWidget>()?.Set(richText ?? "");
    }
}
