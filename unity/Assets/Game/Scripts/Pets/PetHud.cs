using UnityEngine;
using UnityEngine.UI;

namespace Spiritfire.Game
{
    /// <summary>
    /// HUD 灵宠面板（左下，生命框上方，docs/pet-system.md 第 5 节）：灵宠名（品阶色）+ 称号、灵契等级与经验条、
    /// G 灵技格（冷却遮罩 + 秒数，就绪时 G 键高亮，放出时闪一下）。没有灵宠时隐藏。
    /// 另带一层全屏闪光（神兽现世、白泽图、杀蚩尤）。
    /// </summary>
    public sealed class PetHud : MonoBehaviour
    {
        public static PetHud Instance { get; private set; }

        Hud hud;
        PetOwner owner;
        RectTransform panel;
        Image stripe, xpFill, frame, cover, flash, screen;
        Text nameText, levelText, keyText, secsText, skillText;
        float flashUntil, screenUntil, screenTime;
        Color screenColor;
        Pet shown;

        void Awake() => Instance = this;

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
            if (owner) owner.SkillCast -= OnCast;
        }

        void Start()
        {
            hud = Hud.Instance ? Hud.Instance : GetComponent<Hud>();
            if (!hud || !hud.Root)
            {
                enabled = false;
                return;
            }
            screen = Hud.Img("Pet Screen Flash", hud.Root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1, 1, 1, 0));
            screen.transform.SetAsFirstSibling();

            panel = Hud.Rect("Pet", hud.Root, Vector2.zero, Vector2.zero, new Vector2(60, 152), new Vector2(380, 248));
            Hud.Img("Back", panel, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(0.05f, 0.04f, 0.04f, 0.45f));
            stripe = Hud.Img("Stripe", panel, Vector2.zero, new Vector2(0, 1), Vector2.zero, new Vector2(5, 0), Color.white);
            nameText = hud.Label("Name", panel, new Vector2(0, 0.52f), new Vector2(0.74f, 1), 30, TextAnchor.MiddleLeft, Color.white);
            nameText.rectTransform.offsetMin = new Vector2(16, 0);
            levelText = hud.Label("Level", panel, new Vector2(0, 0.24f), new Vector2(0.74f, 0.54f), 21, TextAnchor.MiddleLeft, new Color(1, 1, 1, 0.85f));
            levelText.rectTransform.offsetMin = new Vector2(16, 0);
            Hud.Img("XP BG", panel, new Vector2(0, 0.1f), new Vector2(0.74f, 0.2f), new Vector2(16, 0), new Vector2(-6, 0), new Color(0, 0, 0, 0.5f));
            xpFill = Hud.Img("XP", panel, new Vector2(0, 0.1f), new Vector2(0.74f, 0.2f), new Vector2(16, 0), new Vector2(-6, 0), new Color(1f, 0.8f, 0.4f, 0.95f));
            xpFill.rectTransform.pivot = new Vector2(0, 0.5f);

            // G 灵技格
            var box = Hud.Rect("Skill", panel, new Vector2(1, 0), new Vector2(1, 0), new Vector2(-88, 8), new Vector2(-8, 88));
            frame = Hud.Img("Frame", box, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1f, 0.6f, 0.25f, 0.9f));
            Hud.Img("Back", box, Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), new Color(0.1f, 0.07f, 0.06f, 0.88f));
            keyText = hud.Label("Key", box, new Vector2(0, 0.22f), Vector2.one, 42, TextAnchor.MiddleCenter, new Color(1f, 0.85f, 0.55f));
            keyText.text = "G";
            skillText = hud.Label("Skill Name", box, Vector2.zero, new Vector2(1, 0.3f), 15, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.85f));
            cover = Hud.Img("Cooldown", box, Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), new Color(0, 0, 0, 0.65f));
            cover.rectTransform.pivot = new Vector2(0.5f, 1f);
            secsText = hud.Label("Secs", box, Vector2.zero, Vector2.one, 32, TextAnchor.MiddleCenter, Color.white);
            flash = Hud.Img("Flash", box, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1f, 0.8f, 0.4f, 0));
            panel.gameObject.SetActive(false);
        }

        void OnCast(Pet p) => flashUntil = Time.time + 0.3f;

        /// <summary>全屏闪光（颜色带透明度），seconds 秒淡出</summary>
        public void Flash(Color c, float seconds)
        {
            screenColor = c;
            screenTime = Mathf.Max(0.05f, seconds);
            screenUntil = Time.unscaledTime + screenTime;
        }

        void LateUpdate()
        {
            if (!panel) return;
            if (screen)
            {
                float k = Mathf.Clamp01((screenUntil - Time.unscaledTime) / screenTime);
                screen.color = new Color(screenColor.r, screenColor.g, screenColor.b, screenColor.a * k * k);
            }
            if (!owner)
            {
                owner = PetOwner.Instance;
                if (owner) owner.SkillCast += OnCast;
            }
            var pet = owner ? owner.Current : null;
            if (panel.gameObject.activeSelf != (bool)pet) panel.gameObject.SetActive(pet);
            if (!pet) return;
            var def = pet.def;
            if (pet != shown)
            {
                shown = pet;
                var c = def.RarityColor;
                stripe.color = c;
                nameText.text = $"<color=#{PetRarities.Hex(def.rarity)}>{def.name}</color> <size=19><color=#c8c0b0>{PetRarities.Name(def.rarity)} · {def.title}</color></size>";
                skillText.text = def.skillName;
            }
            levelText.text = pet.Level >= Pet.MaxLevel
                ? $"灵契 Lv.{pet.Level} <color=#ffcf5a>· 觉醒 · 满级</color>"
                : $"灵契 Lv.{pet.Level}" + (pet.Awakened ? " <color=#ffcf5a>· 觉醒</color>" : $" <color=#a09888>（{Pet.AwakenLevel} 级觉醒）</color>");
            float xp = pet.XpNext > 0 ? pet.Xp / pet.XpNext : 1;
            xpFill.rectTransform.localScale = new Vector3(Mathf.Clamp01(xp), 1, 1);

            float left = pet.SkillLeft;
            bool ready = pet.SkillReady;
            cover.rectTransform.localScale = new Vector3(1, Mathf.Clamp01(left / Mathf.Max(0.01f, pet.SkillCooldown)), 1);
            secsText.text = left > 0 ? (left >= 1 ? $"{left:F0}" : $"{left:F1}") : "";
            keyText.color = new Color(1f, 0.85f, 0.55f, secsText.text.Length > 0 ? 0.15f : 1f);
            var rc = def.RarityColor;
            frame.color = ready
                ? Color.Lerp(new Color(1f, 0.6f, 0.25f, 0.95f), new Color(rc.r, rc.g, rc.b, 0.95f), 0.35f + Mathf.Sin(Time.time * 4f) * 0.15f)
                : new Color(0.5f, 0.45f, 0.4f, 0.6f);
            flash.color = new Color(1f, 0.8f, 0.4f, Mathf.Clamp01((flashUntil - Time.time) / 0.3f) * 0.6f);
        }
    }
}
