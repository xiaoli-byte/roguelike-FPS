using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 右上 信息角（Three.js HUD.ts InfoPanel + css/hud.css .gf-info；目标行取自 AdventureHUD 的指引）：
    ///   关卡名（标题字体，右侧朱砂竖线；首领关偏红）、目标（<see cref="GameUI.SetObjective"/>：场地「剩余敌人 N」、出口指引…，前面一枚双刃图标）、
    ///   钱袋：灵石（铜钱图标、千分位）+ 魂晶；灵石变化时数字旁飘「+N / -N」并弹一下（<see cref="GameEvents.CoinsChanged"/>）。
    /// 墨色右实左透的衬底：亮天空下也看得清。
    /// </summary>
    [HudWidget("info", Order = 50)]
    public sealed class InfoWidget : HudWidget
    {
        const float FloatTime = 0.9f, PopTime = 0.2f;

        Label stage, objective, coins, essence, coinFloat;
        VisualElement objectiveRow, coinsWrap;
        string stageText = "", objectiveText = "";
        int coinsV = int.MinValue, essV = int.MinValue;
        float floatAt = -10;
        bool floating;

        /// <summary>当前关卡名 / 目标（测试用）</summary>
        public string Stage => stageText;
        public string Objective => objectiveText;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-info");
            HudArt.Paint(root, HudArt.FadeLeft, new Color(0.027f, 0.024f, 0.04f, 0.6f));
            stage = HudArt.Text("sf-info__stage", root, "", UIFontRole.Title);
            HudArt.Show(stage, false);
            objectiveRow = HudArt.El("sf-info__row", root);
            objectiveRow.Add(UIIcons.Make(UIIcon.Blades, "sf-info__icon"));
            objective = HudArt.Text("sf-info__objective", objectiveRow);
            HudArt.Show(objectiveRow, false);

            var purse = HudArt.El("sf-info__purse", root);
            coinsWrap = HudArt.El("sf-info__coins", purse);
            HudArt.Origin(coinsWrap, 100, 50);
            coinsWrap.Add(UIIcons.Make(UIIcon.Coin, "sf-icon--coin", "sf-info__icon"));
            coins = HudArt.Text("sf-info__coinnum", coinsWrap, "0", UIFontRole.Number);
            coinFloat = HudArt.Text("sf-info__float", coinsWrap, "", UIFontRole.Number);
            coinFloat.style.opacity = 0;
            var ess = HudArt.El("sf-info__ess", purse);
            ess.Add(UIIcons.Make(UIIcon.Essence, "sf-icon--essence", "sf-info__icon"));
            essence = HudArt.Text("sf-info__essnum", ess, "0", UIFontRole.Number);
            return root;
        }

        protected override void OnAttach()
        {
            GameEvents.CoinsChanged += OnCoins;
            // HUD 重建（重开场景）前设过的关卡名 / 目标
            SetStage(GameUI.StageText);
            SetObjective(GameUI.ObjectiveText);
        }

        protected override void OnDetach() => GameEvents.CoinsChanged -= OnCoins;

        /// <summary>关卡名（「1-1 · 古道穿越戈壁」；首领关名字里带「·」后的首领名时整体偏红由 isBoss 定）</summary>
        public void SetStage(string text, bool isBoss = false)
        {
            stageText = text ?? "";
            HudArt.SetText(stage, stageText);
            HudArt.Show(stage, stageText.Length > 0);
            HudArt.Toggle(stage, "is-boss", isBoss);
        }

        public void SetObjective(string text)
        {
            objectiveText = text ?? "";
            HudArt.SetText(objective, objectiveText);
            HudArt.Show(objectiveRow, objectiveText.Length > 0);
        }

        void OnCoins(int delta, int total)
        {
            if (delta == 0) return;
            coinFloat.text = delta > 0 ? "+" + delta : delta.ToString();
            HudArt.Toggle(coinFloat, "is-neg", delta < 0);
            floatAt = Time.unscaledTime;
            floating = true;
        }

        public override void Tick(in HudFrame f)
        {
            Visible = Ctx.Vitals;
            var run = RunState.Current;
            int c = run?.coins ?? 0, e = run?.essence ?? 0;
            if (c != coinsV)
            {
                coinsV = c;
                coins.text = HudArt.FormatNum(c);
            }
            if (e != essV)
            {
                essV = e;
                essence.text = HudArt.FormatNum(e);
            }
            if (!floating) return;
            float k = (f.unscaledTime - floatAt) / FloatTime;
            if (k < 0 || k >= 1)
            {
                floating = false;
                coinFloat.style.opacity = 0;
                coinsWrap.style.scale = StyleKeyword.Null;
                return;
            }
            // 0 → 0.2 淡入并上移到位，之后边淡出边再上浮 14
            float a = k < 0.2f ? k / 0.2f : 1 - (k - 0.2f) / 0.8f;
            float y = k < 0.2f ? Mathf.Lerp(6, 0, k / 0.2f) : Mathf.Lerp(0, -14, (k - 0.2f) / 0.8f);
            coinFloat.style.opacity = a;
            coinFloat.style.translate = new Translate(0, y);
            float kp = (f.unscaledTime - floatAt) / PopTime;
            coinsWrap.style.scale = kp < 1 ? new Scale(Vector3.one * (1 + 0.15f * (1 - kp))) : new StyleScale(StyleKeyword.Null);
        }
    }
}
