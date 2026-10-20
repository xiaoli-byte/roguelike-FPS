using UnityEngine;
using UnityEngine.UI;

namespace Spiritfire.Game
{
    /// <summary>技能栏（右下，武器信息上方——左边会被第一人称枪模挡住）：Q / E 两格——按键、技能名、冷却遮罩与剩余秒数、充能点；放出时闪一下，放不出来（<see cref="GameUI.SkillDenied"/>）时框闪红、左右抖一下</summary>
    public sealed class SkillHud : MonoBehaviour
    {
        public HeroSkills skills;

        sealed class Slot
        {
            public Skill skill;
            public RectTransform root;
            public Image frame, cover, flash;
            public Text secs, name, key;
            public Image[] pips;
            public float flashUntil, denyUntil;
            public Vector2 basePos;
        }

        Slot q, e;

        void Start()
        {
            var hud = Hud.Instance;
            if (!skills) skills = FindAnyObjectByType<HeroSkills>();
            if (!hud || !skills) { enabled = false; return; }
            var box = Hud.Rect("Skills", hud.Root, new Vector2(1, 0), new Vector2(1, 0), new Vector2(-278, 216), new Vector2(-60, 346));
            q = Build(hud, box, skills.primary, "Q", 0);
            e = Build(hud, box, skills.secondary, "E", 1);
            skills.Cast += s =>
            {
                var slot = s == skills.primary ? q : e;
                if (slot != null) slot.flashUntil = Time.time + 0.25f;
            };
            GameUI.SkillDeniedShown += OnDenied;
        }

        void OnDestroy() => GameUI.SkillDeniedShown -= OnDenied;

        void OnDenied(SkillSlot which)
        {
            var slot = which == SkillSlot.Primary ? q : e;
            if (slot != null) slot.denyUntil = Time.unscaledTime + DenyFlash;
        }

        const float DenyFlash = 0.3f;

        Slot Build(Hud hud, RectTransform box, Skill skill, string key, int index)
        {
            float x = index * 118;
            var root = Hud.Rect(key, box, Vector2.zero, Vector2.zero, new Vector2(x, 30), new Vector2(x + 100, 130));
            var s = new Slot { skill = skill, root = root, basePos = root.anchoredPosition };
            s.frame = Hud.Img("Frame", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1f, 0.6f, 0.25f, 0.9f));
            Hud.Img("Back", root, Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), new Color(0.1f, 0.07f, 0.06f, 0.85f));
            var keyText = hud.Label("Key", root, Vector2.zero, Vector2.one, 50, TextAnchor.MiddleCenter, new Color(1f, 0.85f, 0.55f));
            keyText.text = key;
            s.key = keyText;
            s.cover = Hud.Img("Cooldown", root, Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), new Color(0, 0, 0, 0.65f));
            s.cover.rectTransform.pivot = new Vector2(0.5f, 1f);
            s.secs = hud.Label("Secs", root, Vector2.zero, Vector2.one, 36, TextAnchor.MiddleCenter, Color.white);
            s.flash = Hud.Img("Flash", root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(1f, 0.8f, 0.4f, 0));
            s.name = hud.Label("Name", root, new Vector2(0, 0), new Vector2(1, 0), 22, TextAnchor.UpperCenter, new Color(1, 1, 1, 0.8f));
            s.name.rectTransform.offsetMin = new Vector2(-20, -32);
            s.name.rectTransform.offsetMax = new Vector2(20, -4);
            s.name.text = skill?.name ?? "";
            int n = skill?.maxCharges ?? 1;
            s.pips = new Image[n > 1 ? n : 0];
            for (int i = 0; i < s.pips.Length; i++)
                s.pips[i] = Hud.Img($"Charge {i}", root, new Vector2(0, 1), new Vector2(0, 1), new Vector2(8 + i * 18, 6), new Vector2(20 + i * 18, 14), Color.white);
            return s;
        }

        void LateUpdate()
        {
            foreach (var s in new[] { q, e })
            {
                if (s?.skill == null) continue;
                var sk = s.skill;
                bool ready = sk.charges > 0 && !sk.Busy;
                float left = sk.CooldownLeft;
                // 遮罩：没有充能时按回充进度从上往下退；有充能但还在回下一层时只显示秒数
                float cover = sk.charges > 0 ? 0 : Mathf.Clamp01(left / sk.cooldown);
                s.cover.rectTransform.localScale = new Vector3(1, cover, 1);
                s.secs.text = sk.charges == 0 && left > 0 ? (left >= 1 ? $"{left:F0}" : $"{left:F1}") : "";
                // 倒计时时按键字母退成淡底，免得和秒数叠在一起
                s.key.color = new Color(1f, 0.85f, 0.55f, s.secs.text.Length > 0 ? 0.15f : 1f);
                s.frame.color = ready ? new Color(1f, 0.6f, 0.25f, 0.95f) : new Color(0.5f, 0.45f, 0.4f, 0.6f);
                for (int i = 0; i < s.pips.Length; i++)
                    s.pips[i].color = i < sk.charges ? new Color(1f, 0.8f, 0.4f) : new Color(1, 1, 1, 0.2f);
                s.flash.color = new Color(1f, 0.8f, 0.4f, Mathf.Clamp01((s.flashUntil - Time.time) / 0.25f) * 0.6f);
                // 拒绝：框闪红 + 左右抖
                float deny = Mathf.Clamp01((s.denyUntil - Time.unscaledTime) / DenyFlash);
                if (deny > 0) s.frame.color = Color.Lerp(s.frame.color, new Color(1f, 0.18f, 0.12f, 1f), deny);
                s.root.anchoredPosition = s.basePos + new Vector2(Mathf.Sin(Time.unscaledTime * 70f) * 6f * deny, 0);
            }
        }
    }
}
