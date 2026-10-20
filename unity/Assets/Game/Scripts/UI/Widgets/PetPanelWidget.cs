using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灵宠面板（docs/pet-system.md 第 5 节；U2 从 uGUI 的 PetHud 移植）：左下、生命框上方。
    ///   左侧品阶色竖条；灵宠名（品阶色、标题字体）+「品阶 · 称号」小字；灵契等级（觉醒 / 满级金字，未觉醒时注明几级觉醒）；经验细条；
    ///   右侧 G 灵技盘（<see cref="SkillDisc"/>：冷却环 + 秒数，就绪时环按品阶色呼吸，放出时闪一下）。
    /// 只在有 <see cref="PetHud"/> 挂点（这一局开了灵宠系统）且结契了灵宠时显示。
    /// </summary>
    [HudWidget("pet", Order = 50)]
    public sealed class PetPanelWidget : HudWidget
    {
        VisualElement stripe, xpFill;
        Label nameLabel, subLabel, levelLabel;
        SkillDisc skill;
        PetOwner owner;
        Pet shown;
        int levelV = -1;
        bool awakenedV;
        float xpV = -1;

        /// <summary>正在显示的灵宠（测试用）</summary>
        public Pet Shown => Visible ? shown : null;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-pet");
            // 左实右透的墨底（同提示条）
            HudArt.Paint(root, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.016f, 0.62f));
            stripe = HudArt.El("sf-pet__stripe", root);
            var info = HudArt.El("sf-pet__info", root);
            var head = HudArt.El("sf-pet__head", info);
            nameLabel = HudArt.Text("sf-pet__name", head, "", UIFontRole.Title);
            subLabel = HudArt.Text("sf-pet__sub", head);
            levelLabel = HudArt.Text("sf-pet__level", info, "", rich: true);
            var xp = HudArt.El("sf-pet__xp", info);
            xpFill = HudArt.Fill(xp, "sf-pet__xpfill", new Color(1f, 0.8f, 0.4f, 0.95f));
            skill = new SkillDisc("G", 52);
            skill.AddToClassList("sf-pet__skill");
            root.Add(skill);
            root.style.display = DisplayStyle.None;
            return root;
        }

        protected override void OnDetach()
        {
            if (owner) owner.SkillCast -= OnCast;
            owner = null;
        }

        void OnCast(Pet p) => skill?.Flash(Time.unscaledTime);

        public override void ResetState()
        {
            shown = null;
            levelV = -1;
            xpV = -1;
        }

        public override void Tick(in HudFrame f)
        {
            if (owner != PetOwner.Instance)
            {
                if (owner) owner.SkillCast -= OnCast;
                owner = PetOwner.Instance;
                if (owner) owner.SkillCast += OnCast;
            }
            var pet = owner ? owner.Current : null;
            bool show = PetHud.Instance && pet && Ctx.Vitals;
            Visible = show;
            if (!show) return;
            var def = pet.def;
            float now = f.unscaledTime;
            if (pet != shown)
            {
                shown = pet;
                var rc = def.RarityColor;
                stripe.style.backgroundColor = rc;
                HudArt.SetText(nameLabel, def.name);
                nameLabel.style.color = rc;
                HudArt.SetText(subLabel, $"{PetRarities.Name(def.rarity)} · {def.title}");
                skill.SetSkill(def.skillName);
                skill.Accent = Color.Lerp(UITheme.Gold, rc, 0.35f);
                levelV = -1;
            }
            if (pet.Level != levelV || pet.Awakened != awakenedV)
            {
                levelV = pet.Level;
                awakenedV = pet.Awakened;
                levelLabel.text = pet.Level >= Pet.MaxLevel
                    ? $"灵契 Lv.{pet.Level} <color=#ffcf5a>· 觉醒 · 满级</color>"
                    : $"灵契 Lv.{pet.Level}" + (pet.Awakened ? " <color=#ffcf5a>· 觉醒</color>" : $" <color=#a09888>（{Pet.AwakenLevel} 级觉醒）</color>");
            }
            float xp = pet.XpNext > 0 ? Mathf.Clamp01(pet.Xp / pet.XpNext) : 1;
            if (Mathf.Abs(xp - xpV) > 0.002f)
            {
                xpV = xp;
                HudArt.SetFill(xpFill, xp);
            }
            skill.Key = HudArt.Key(GameAction.PetSkill);
            float left = pet.SkillLeft, cd = Mathf.Max(0.01f, pet.SkillCooldown);
            // 灵技一次一发：就绪 = 1 层充能，冷却中 = 0
            skill.Set(left > 0 ? Mathf.Clamp01(1 - left / cd) : 1, left, pet.SkillReady ? 1 : 0, 1, pet.Busy, now);
        }
    }
}
