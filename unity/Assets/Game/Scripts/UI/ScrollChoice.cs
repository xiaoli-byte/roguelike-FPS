using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷三选一：时间停止、放开鼠标，三张卡（稀有度色边、名字、标签、说明、已有层数），按 1 / 2 / 3 或点击选择。
    /// 不依赖 EventSystem：鼠标命中自己按 RectTransform 判断。测试用 <see cref="Pick"/> 直接选。
    /// </summary>
    public sealed class ScrollChoice : MonoBehaviour
    {
        static ScrollChoice current;
        public static bool Open => current;

        List<ScrollDef> choices;
        Action<ScrollDef> onPick;
        readonly List<RectTransform> cards = new();
        readonly List<Image> frames = new();
        RectTransform panel;
        float openedAt;
        int hover = -1;

        public static void Show(List<ScrollDef> choices, ScrollInventory inv, Action<ScrollDef> onPick)
        {
            var hud = Hud.Instance;
            if (!hud || current) return;
            current = hud.gameObject.AddComponent<ScrollChoice>();
            current.choices = choices;
            current.onPick = onPick;
            current.Build(hud, inv);
            GameSession.Instance?.SetModal(true);
        }

        public static void Pick(int index)
        {
            if (current) current.Choose(index);
        }

        void Build(Hud hud, ScrollInventory inv)
        {
            openedAt = Time.unscaledTime;
            hud.ClearMessages();
            panel = Hud.Rect("Scroll Choice", hud.Root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            Hud.Img("Dim", panel, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(0.03f, 0.02f, 0.02f, 0.72f));
            var title = hud.Label("Title", panel, new Vector2(0, 0.8f), new Vector2(1, 0.88f), 46, TextAnchor.MiddleCenter, new Color(1f, 0.9f, 0.7f));
            title.text = "选择一卷秘卷";
            var hint = hud.Label("Hint", panel, new Vector2(0, 0.14f), new Vector2(1, 0.19f), 26, TextAnchor.MiddleCenter, new Color(1f, 1f, 1f, 0.6f));
            hint.text = "按 1 / 2 / 3 或点击卡片选择";
            const float w = 380, h = 470, gap = 46;
            float x0 = -(choices.Count * w + (choices.Count - 1) * gap) / 2;
            for (int i = 0; i < choices.Count; i++)
            {
                var def = choices[i];
                var rc = ScrollLibrary.RarityColor[Mathf.Clamp(def.rarity, 0, 3)];
                float x = x0 + i * (w + gap);
                var card = Hud.Rect($"Card {i + 1}", panel, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(x, -h / 2), new Vector2(x + w, h / 2));
                var frame = Hud.Img("Frame", card, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, rc);
                Hud.Img("Back", card, Vector2.zero, Vector2.one, new Vector2(4, 4), new Vector2(-4, -4), new Color(0.12f, 0.09f, 0.08f, 0.96f));
                Hud.Img("Band", card, new Vector2(0, 1), new Vector2(1, 1), new Vector2(4, -96), new Vector2(-4, -4), new Color(rc.r * 0.35f, rc.g * 0.35f, rc.b * 0.35f, 1f));
                var key = hud.Label("Key", card, new Vector2(0, 1), new Vector2(0, 1), 30, TextAnchor.MiddleCenter, new Color(1f, 0.85f, 0.5f));
                key.rectTransform.offsetMin = new Vector2(14, -60);
                key.rectTransform.offsetMax = new Vector2(64, -14);
                key.text = $"[{i + 1}]";
                var rarity = hud.Label("Rarity", card, new Vector2(0, 1), new Vector2(1, 1), 24, TextAnchor.MiddleRight, rc);
                rarity.rectTransform.offsetMin = new Vector2(0, -60);
                rarity.rectTransform.offsetMax = new Vector2(-18, -14);
                rarity.text = $"{ScrollLibrary.RarityName[Mathf.Clamp(def.rarity, 0, 3)]} · {def.tag}";
                var name = hud.Label("Name", card, new Vector2(0, 1), new Vector2(1, 1), 52, TextAnchor.MiddleCenter, Color.white);
                name.rectTransform.offsetMin = new Vector2(0, -190);
                name.rectTransform.offsetMax = new Vector2(0, -110);
                name.text = def.name;
                var desc = hud.Label("Desc", card, new Vector2(0, 0), new Vector2(1, 1), 28, TextAnchor.UpperCenter, new Color(0.92f, 0.88f, 0.82f));
                desc.rectTransform.offsetMin = new Vector2(30, 80);
                desc.rectTransform.offsetMax = new Vector2(-30, -215);
                desc.horizontalOverflow = HorizontalWrapMode.Wrap;
                desc.text = def.description;
                int have = inv.Stacks(def.id);
                var stacks = hud.Label("Stacks", card, new Vector2(0, 0), new Vector2(1, 0), 24, TextAnchor.MiddleCenter, new Color(1f, 1f, 1f, 0.55f));
                stacks.rectTransform.offsetMin = new Vector2(0, 22);
                stacks.rectTransform.offsetMax = new Vector2(0, 66);
                stacks.text = def.maxStacks > 1 ? (have > 0 ? $"已有 {have} / {def.maxStacks} 层" : $"最多 {def.maxStacks} 层") : "唯一";
                cards.Add(card);
                frames.Add(frame);
            }
        }

        void Update()
        {
            var kb = Keyboard.current;
            var mouse = Mouse.current;
            var hud = Hud.Instance;
            hover = -1;
            if (mouse != null && hud)
                for (int i = 0; i < cards.Count; i++)
                    if (RectTransformUtility.RectangleContainsScreenPoint(cards[i], mouse.position.ReadValue(), hud.cam)) hover = i;
            for (int i = 0; i < cards.Count; i++)
            {
                float s = i == hover ? 1.04f : 1f;
                cards[i].localScale = Vector3.Lerp(cards[i].localScale, Vector3.one * s, Mathf.Min(1, Time.unscaledDeltaTime * 18));
            }
            // 刚弹出时忽略输入一小会儿，免得开枪的那一下误选
            if (Time.unscaledTime - openedAt < 0.35f) return;
            if (kb != null)
            {
                if (kb.digit1Key.wasPressedThisFrame) Choose(0);
                else if (kb.digit2Key.wasPressedThisFrame) Choose(1);
                else if (kb.digit3Key.wasPressedThisFrame) Choose(2);
            }
            if (current == this && hover >= 0 && mouse != null && mouse.leftButton.wasPressedThisFrame) Choose(hover);
        }

        void Choose(int index)
        {
            if (index < 0 || index >= choices.Count || current != this) return;
            current = null;
            Destroy(panel.gameObject);
            Destroy(this);
            GameSession.Instance?.SetModal(false);
            onPick?.Invoke(choices[index]);
        }
    }
}
