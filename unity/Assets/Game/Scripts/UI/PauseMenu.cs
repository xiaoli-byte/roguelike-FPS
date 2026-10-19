using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UI;

namespace Spiritfire.Game
{
    /// <summary>
    /// Esc 暂停菜单（同时是设置面板）：「画面 · 画质」三档 低 / 中 / 高（与网页版设置里的「画质」同名同档，选了即时生效并保存），
    /// 「继续游戏」按钮；Esc 或点击面板外的空白处也继续。
    /// 和 <see cref="ScrollChoice"/> 一样全用代码搭在 HUD 的 Canvas 上，不依赖 EventSystem：鼠标命中自己按 RectTransform 判断，
    /// 按下和松开落在同一个目标上才算点击（继续时左键已经松开，不会顺手开一枪）。
    /// </summary>
    public sealed class PauseMenu : MonoBehaviour
    {
        static PauseMenu current;
        public static bool Open => current;

        static readonly ArtQualityLevel[] Levels = { ArtQualityLevel.Low, ArtQualityLevel.Medium, ArtQualityLevel.High };

        static readonly Color Gold = new(1f, 0.85f, 0.5f);
        static readonly Color Ink = new(0.12f, 0.09f, 0.08f, 0.96f);
        static readonly Color Idle = new(0.2f, 0.16f, 0.14f, 1f);
        static readonly Color Hover = new(0.32f, 0.26f, 0.21f, 1f);

        Action onResume;
        RectTransform panel, box;
        readonly List<RectTransform> targets = new();
        readonly List<Image> fills = new();
        readonly List<Text> labels = new();
        Text desc;
        int resumeIndex, hover = -1, pressed = -2;

        public static void Show(Action onResume)
        {
            var hud = Hud.Instance;
            if (!hud || current) return;
            current = hud.gameObject.AddComponent<PauseMenu>();
            current.onResume = onResume;
            current.Build(hud);
        }

        /// <summary>测试用：和点击画质按钮走同一条路径</summary>
        public static void Pick(ArtQualityLevel level)
        {
            if (current) current.Choose(level);
        }

        public static void Hide()
        {
            if (!current) return;
            Destroy(current.panel.gameObject);
            Destroy(current);
            current = null;
        }

        void OnEnable() => ArtQuality.Changed += OnQuality;
        void OnDisable() => ArtQuality.Changed -= OnQuality;
        void OnQuality(ArtQualityLevel _) => Refresh();

        void Build(Hud hud)
        {
            hud.ClearMessages();
            panel = Hud.Rect("Pause Menu", hud.Root, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            Hud.Img("Dim", panel, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(0.03f, 0.02f, 0.02f, 0.62f));
            var title = hud.Label("Title", panel, new Vector2(0, 0.74f), new Vector2(1, 0.84f), 72, TextAnchor.MiddleCenter, new Color(1f, 0.9f, 0.7f));
            title.text = "暂 停";
            title.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.6f);

            const float w = 760, h = 400;
            box = Hud.Rect("Settings", panel, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(-w / 2, -h / 2 - 20), new Vector2(w / 2, h / 2 - 20));
            Hud.Img("Frame", box, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, new Color(Gold.r, Gold.g, Gold.b, 0.55f));
            Hud.Img("Back", box, Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), Ink);

            var group = hud.Label("Group", box, new Vector2(0, 1), new Vector2(1, 1), 26, TextAnchor.MiddleLeft, new Color(Gold.r, Gold.g, Gold.b, 0.8f));
            group.rectTransform.offsetMin = new Vector2(44, -78);
            group.rectTransform.offsetMax = new Vector2(-44, -30);
            group.text = "画面";
            Hud.Img("Rule", box, new Vector2(0, 1), new Vector2(1, 1), new Vector2(44, -82), new Vector2(-44, -80), new Color(1f, 1f, 1f, 0.12f));

            var row = hud.Label("Quality", box, new Vector2(0, 1), new Vector2(0, 1), 34, TextAnchor.MiddleLeft, Color.white);
            row.rectTransform.offsetMin = new Vector2(44, -168);
            row.rectTransform.offsetMax = new Vector2(244, -104);
            row.text = "画质";
            // 分段按钮：右对齐，三格等宽
            const float bw = 120, bh = 60, gap = 10;
            for (int i = 0; i < Levels.Length; i++)
            {
                float x1 = -44 - (Levels.Length - 1 - i) * (bw + gap);
                AddButton($"Quality {ArtQuality.Label(Levels[i])}", box, new Vector2(1, 1), new Vector2(x1 - bw, -166), new Vector2(x1, -166 + bh), ArtQuality.Label(Levels[i]), hud);
            }
            desc = hud.Label("Desc", box, new Vector2(0, 1), new Vector2(1, 1), 24, TextAnchor.UpperLeft, new Color(0.92f, 0.88f, 0.82f, 0.85f));
            desc.rectTransform.offsetMin = new Vector2(44, -260);
            desc.rectTransform.offsetMax = new Vector2(-44, -184);
            desc.horizontalOverflow = HorizontalWrapMode.Wrap;

            resumeIndex = targets.Count;
            AddButton("Resume", box, new Vector2(0.5f, 0), new Vector2(-150, 36), new Vector2(150, 106), "继续游戏", hud);
            labels[resumeIndex].fontSize = 34;

            var hint = hud.Label("Hint", panel, new Vector2(0, 0.14f), new Vector2(1, 0.19f), 26, TextAnchor.MiddleCenter, new Color(1f, 1f, 1f, 0.6f));
            hint.text = "Esc 或点击空白处继续 · 设置改动即时生效，并自动保存";
            Refresh();
        }

        void AddButton(string name, RectTransform parent, Vector2 anchor, Vector2 oMin, Vector2 oMax, string text, Hud hud)
        {
            var r = Hud.Rect(name, parent, anchor, anchor, oMin, oMax);
            var fill = Hud.Img("Fill", r, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, Idle);
            var label = hud.Label("Label", r, Vector2.zero, Vector2.one, 30, TextAnchor.MiddleCenter, Color.white);
            label.text = text;
            targets.Add(r);
            fills.Add(fill);
            labels.Add(label);
        }

        void Refresh()
        {
            if (!desc) return;
            var level = ArtQuality.Level;
            for (int i = 0; i < targets.Count; i++)
            {
                bool selected = i < Levels.Length && Levels[i] == level;
                bool resume = i == resumeIndex;
                fills[i].color = selected ? Gold : i == hover ? Hover : resume ? new Color(0.28f, 0.2f, 0.12f, 1f) : Idle;
                labels[i].color = selected ? new Color(0.16f, 0.1f, 0.06f) : resume ? Gold : new Color(1f, 1f, 1f, 0.85f);
            }
            desc.text = level switch
            {
                ArtQualityLevel.Low => "不加毛发，渲染降到省电档\n0.8 倍分辨率 · 单级硬阴影 · 无环境光遮蔽",
                ArtQualityLevel.Medium => "灵宠与怪物带毛发细节：顺毛发丝、光泽、绒边\n几乎不加开销",
                _ => "毛发细节之外，近处的毛 / 羽再叠一圈发丝壳层\n最吃性能",
            };
        }

        void Update()
        {
            var hud = Hud.Instance;
            if (!hud) return;
            var pos = GameInput.PointerPosition;
            int h = -1;
            for (int i = 0; i < targets.Count; i++)
                if (RectTransformUtility.RectangleContainsScreenPoint(targets[i], pos, hud.cam)) h = i;
            // -1 = 面板外的空白处；面板内但不在按钮上 = 不响应
            int at = h >= 0 ? h : RectTransformUtility.RectangleContainsScreenPoint(box, pos, hud.cam) ? -3 : -1;
            if (h != hover)
            {
                hover = h;
                Refresh();
            }
            if (GameInput.Pressed(UIAction.Click)) pressed = at;
            if (!GameInput.Released(UIAction.Click)) return;
            int clicked = pressed == at ? at : -2;
            pressed = -2;
            if (clicked >= 0 && clicked < Levels.Length) Choose(Levels[clicked]);
            else if (clicked == resumeIndex || clicked == -1) onResume?.Invoke();
        }

        void Choose(ArtQualityLevel level)
        {
            if (ArtQuality.Level != level) ArtQuality.Set(level);
        }
    }
}
