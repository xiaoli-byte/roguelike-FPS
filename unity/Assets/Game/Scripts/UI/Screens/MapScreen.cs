using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// M 键全图（docs/unity-parity.md U7；Three.js AdventureHUD 的行旅图放大成全屏界面，D：不做常驻小地图）：
    ///   · 底图 = 构建器写进关卡的俯视图（<see cref="LevelMeta.map"/>，北朝上），按 <see cref="LevelMeta.mapArea"/> 把世界 XZ 映射到图上；
    ///     没有俯视图的场景（测试场、旧场景）铺墨底点阵，范围取地点与玩家的包围盒；
    ///   · 叠层：发现过的地点（徽记 + 名字，颜色同罗盘条；已完成的压暗）、当前目标（金圈呼吸）、玩家（青色箭头 + 视野扇，朝向 = 视线）；
    ///   · 标题行：关卡名、「已发现 3/5 处 · 肃清 2/4」；底栏：目标「前往 · 雅丹石阵 · 128 米」、图例。
    /// 打开时停时间（同 Tab 行囊）；M / Esc / 手柄 B 关。打开热键在 <see cref="ScreenHotkeys"/>。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class MapScreen : UIScreen
    {
        public const string ScreenId = "map";
        /// <summary>罗盘条与全图共用的样式表</summary>
        public const string StylePath = "UI/map";
        /// <summary>图框四周给标题行 / 底栏留的设计像素</summary>
        const float SideMargin = 90f, TopBottom = 230f, MaxW = 1500f;

        public override string Id => ScreenId;

        /// <summary>玩家标记的 SVG（64 × 64，中心 = 玩家；朝上 = 视线方向）：淡青视野扇 + 墨边青色箭头</summary>
        const string PlayerSvg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 64 64\">" +
            "<path d=\"M32 32 L15 3 L49 3 Z\" fill=\"#b8eaff\" fill-opacity=\"0.2\"/>" +
            "<path d=\"M32 15 L42 43 L32 37 L22 43 Z\" fill=\"#07060a\" stroke=\"#07060a\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/>" +
            "<path d=\"M32 15 L42 43 L32 37 L22 43 Z\" fill=\"#b8eaff\"/></svg>";

        static VectorImage playerIconImage;
        static bool playerIconFailed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            if (playerIconImage) Object.Destroy(playerIconImage);
            playerIconImage = null;
            playerIconFailed = false;
        }

        static VectorImage PlayerIcon
        {
            get
            {
                if (playerIconImage || playerIconFailed) return playerIconImage;
                try { playerIconImage = UIIcons.Build(PlayerSvg); }
                catch (System.Exception e) { Debug.LogWarning($"[UI] 全图玩家标记解析失败：{e.Message}"); }
                if (playerIconImage) playerIconImage.hideFlags = HideFlags.HideAndDontSave;
                else playerIconFailed = true;
                return playerIconImage;
            }
        }

        VisualElement frame, box, image, marksLayer, player, playerIcon, ring;
        Label title, sub, targetLine, empty;
        readonly List<(MapMarker marker, VisualElement el)> shownMarks = new();
        Rect area;
        int openedFrame;
        float openedAt;

        /// <summary>图框尺寸（设计像素）、底图范围（世界 XZ）、有没有俯视图、玩家在图上的 UV（测试用）</summary>
        public Vector2 BoxSize { get; private set; }
        public Rect Area => area;
        public bool HasImage { get; private set; }
        public Vector2 PlayerUV { get; private set; }
        /// <summary>图上显示的地点（名字、UV、是不是目标）</summary>
        public IEnumerable<(string name, Vector2 uv, bool target)> Marks
        {
            get
            {
                foreach (var (m, _) in shownMarks)
                    yield return (m.name, LevelMeta.WorldToUV(area, m.position), m == MapMarkers.Target);
            }
        }

        public string TitleText => title?.text;
        public string TargetText => targetLine?.text;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "map" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, StylePath);
            root.AddToClassList("sf-map");
            ScreenKit.El("sf-backdrop sf-map__backdrop", root);
            frame = ScreenKit.El("sf-map__frame", root);

            var head = ScreenKit.El("sf-map__head", frame);
            title = ScreenKit.Text("sf-map__title", head, "行旅图", UIFontRole.Title);
            sub = ScreenKit.Text("sf-map__sub", head, "");
            ScreenKit.El("sf-grow", head);
            ScreenKit.Text("sf-panel__hint", head, "M / Esc 关闭");

            box = ScreenKit.El("sf-map__box", frame);
            image = ScreenKit.El("sf-map__image", box);
            empty = ScreenKit.Text("sf-map__empty", box, "本区域没有俯视图");
            marksLayer = ScreenKit.El("sf-map__marks", box);
            ring = ScreenKit.El("sf-map__ring", marksLayer);
            // 玩家：视野扇 + 带墨边的箭头（矢量图，中心 = 玩家位置），整张随视线旋转；矢量图建不出来时退回「▲」字
            player = ScreenKit.El("sf-map__player", marksLayer);
            playerIcon = ScreenKit.El("sf-map__playericon", player);
            var icon = PlayerIcon;
            if (icon) playerIcon.style.backgroundImage = new StyleBackground(icon);
            else ScreenKit.Text("sf-map__arrow", playerIcon, "▲");
            var north = ScreenKit.El("sf-map__north", box);
            ScreenKit.Text("sf-map__northglyph", north, "北", UIFontRole.Title);
            ScreenKit.Text("sf-map__northarrow", north, "▲");

            var foot = ScreenKit.El("sf-map__foot", frame);
            targetLine = ScreenKit.Text("sf-map__target", foot, "", UIFontRole.Title);
            ScreenKit.El("sf-grow", foot);
            var legend = ScreenKit.El("sf-map__legend", foot);
            foreach (var k in new[] { MapPoiKind.Site, MapPoiKind.Cache, MapPoiKind.Altar, MapPoiKind.Camp, MapPoiKind.Boss, MapPoiKind.Exit })
            {
                var item = ScreenKit.El("sf-map__legenditem", legend);
                var badge = ScreenKit.El("sf-map__badge sf-map__badge--sm", item);
                var c = MapMarkers.Color(new MapMarker { kind = k });
                ScreenKit.Border(badge, c);
                ScreenKit.Text("sf-map__glyph", badge, MapMarkers.Glyph(k), UIFontRole.Title).style.color = c;
                ScreenKit.Text("sf-map__legendtext", item, LevelMeta.KindName(k));
            }
            var done = ScreenKit.El("sf-map__legenditem", legend);
            var db = ScreenKit.El("sf-map__badge sf-map__badge--sm is-done", done);
            var dc = MapMarkers.Color(new MapMarker { state = MarkerState.Done });
            ScreenKit.Border(db, dc);
            ScreenKit.Text("sf-map__glyph", db, "战", UIFontRole.Title).style.color = dc;
            ScreenKit.Text("sf-map__legendtext", done, "已完成");
            return root;
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            openedFrame = Time.frameCount;
            GameUI.ClearMessages();
            Rebuild();
        }

        /// <summary>按当前状态重建：底图、范围、图框尺寸、地点、玩家</summary>
        public void Rebuild()
        {
            var pos = MapMarkers.PlayerPosition ?? Vector3.zero;
            MapMarkers.Tick(pos);
            var meta = MapMarkers.Meta;
            HasImage = meta && meta.HasMap;
            area = HasImage ? meta.mapArea : FallbackArea(pos);
            title.text = meta && !string.IsNullOrEmpty(meta.title) ? meta.title : !string.IsNullOrEmpty(GameUI.StageText) ? GameUI.StageText : "行旅图";
            var (found, total) = MapMarkers.Discovery();
            var (cleared, sites) = MapMarkers.Progress(MapPoiKind.Site, true);
            var parts = new List<string>();
            if (total > 0) parts.Add($"已发现 {found}/{total} 处");
            if (sites > 0) parts.Add($"肃清 {cleared}/{sites}");
            sub.text = string.Join(" · ", parts);

            // 图框：按面板尺寸（设计像素）留出标题行和底栏，保持底图长宽比
            float s = UILayers.Scale(UILayer.Modal, Screen.width, Screen.height);
            float pw = Screen.width / s, ph = Screen.height / s;
            float maxW = Mathf.Min(MaxW, pw - SideMargin * 2), maxH = Mathf.Max(200, ph - TopBottom);
            float aspect = area.width / Mathf.Max(1, area.height);
            float w = maxW, h = w / aspect;
            if (h > maxH)
            {
                h = maxH;
                w = h * aspect;
            }
            BoxSize = new Vector2(Mathf.Round(w), Mathf.Round(h));
            box.style.width = BoxSize.x;
            box.style.height = BoxSize.y;
            if (HasImage)
            {
                image.style.backgroundImage = new StyleBackground(meta.map);
                image.style.unityBackgroundImageTintColor = Color.white;
                image.style.backgroundSize = new StyleBackgroundSize(new BackgroundSize(Length.Percent(100), Length.Percent(100)));
            }
            else
            {
                image.style.backgroundImage = StyleKeyword.None;
                ScreenKit.PaintDots(image, new Color(0.83f, 0.66f, 0.33f, 0.16f), 18);
            }
            ScreenKit.Show(empty, !HasImage);

            foreach (var (_, el) in shownMarks) el.RemoveFromHierarchy();
            shownMarks.Clear();
            foreach (var k in MapMarkers.All)
            {
                if (!k.Visible) continue;
                var el = ScreenKit.El("sf-map__mark", marksLayer);
                el.name = "mark-" + k.name;
                var badge = ScreenKit.El("sf-map__badge", el);
                var c = MapMarkers.Color(k);
                ScreenKit.Border(badge, c);
                ScreenKit.Text("sf-map__glyph", badge, MapMarkers.Glyph(k.kind), UIFontRole.Title).style.color = c;
                var label = ScreenKit.Text("sf-map__name", el, k.name);
                el.EnableInClassList("is-done", k.state == MarkerState.Done);
                el.EnableInClassList("is-target", k == MapMarkers.Target);
                if (k == MapMarkers.Target) label.style.color = UITheme.GoldHi;
                Place(el, LevelMeta.WorldToUV(area, k.position));
                shownMarks.Add((k, el));
            }
            ring.BringToFront();
            player.BringToFront();
            var t = MapMarkers.Target;
            ScreenKit.Show(ring, t != null);
            if (t != null) Place(ring, LevelMeta.WorldToUV(area, t.position));
            targetLine.text = t == null ? "" : $"目标　{(string.IsNullOrEmpty(MapMarkers.TargetVerb) ? "" : MapMarkers.TargetVerb + " · ")}{t.name} · {Mathf.RoundToInt(t.distance)} 米";
            UpdatePlayer();
        }

        /// <summary>没有俯视图时的范围：地点 + 玩家的包围盒外扩 30 m，至少 120 m 见方</summary>
        static Rect FallbackArea(Vector3 player)
        {
            float x0 = player.x, x1 = player.x, z0 = player.z, z1 = player.z;
            foreach (var k in MapMarkers.All)
            {
                x0 = Mathf.Min(x0, k.position.x);
                x1 = Mathf.Max(x1, k.position.x);
                z0 = Mathf.Min(z0, k.position.z);
                z1 = Mathf.Max(z1, k.position.z);
            }
            var c = new Vector2((x0 + x1) * 0.5f, (z0 + z1) * 0.5f);
            float w = Mathf.Max(120, x1 - x0 + 60), h = Mathf.Max(120, z1 - z0 + 60);
            return new Rect(c.x - w * 0.5f, c.y - h * 0.5f, w, h);
        }

        /// <summary>UV（v 向北）→ 图框里的百分比位置（中心对齐）</summary>
        static void Place(VisualElement el, Vector2 uv)
        {
            el.style.left = Length.Percent(Mathf.Clamp01(uv.x) * 100);
            el.style.top = Length.Percent((1 - Mathf.Clamp01(uv.y)) * 100);
        }

        void UpdatePlayer()
        {
            var pos = MapMarkers.PlayerPosition;
            ScreenKit.Show(player, pos.HasValue);
            if (!pos.HasValue) return;
            PlayerUV = LevelMeta.WorldToUV(area, pos.Value);
            Place(player, PlayerUV);
            var hud = Hud.Instance;
            Transform eye = hud && hud.motor && hud.motor.eye ? hud.motor.eye : hud && hud.cam ? hud.cam.transform : null;
            playerIcon.style.rotate = new Rotate(MapMarkers.Heading(eye));
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.22f);
            frame.style.opacity = k;
            frame.style.scale = new Scale(new Vector3(0.985f + 0.015f * k, 0.985f + 0.015f * k, 1));
            float p = 0.5f + 0.5f * Mathf.Sin((Time.unscaledTime - openedAt) * 4.2f);
            ring.style.scale = new Scale(Vector3.one * (0.85f + 0.35f * p));
            ring.style.opacity = 0.45f + 0.55f * (1 - p);
            if (Time.frameCount == openedFrame) return;
            // M / 手柄左摇杆按下 再按一次关（Gameplay 表关着，直接读按键）
            if (ScreenKit.PressedRaw(GameAction.Map)) Close();
        }
    }
}
