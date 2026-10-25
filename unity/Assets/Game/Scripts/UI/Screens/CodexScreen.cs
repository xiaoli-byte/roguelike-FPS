using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 图鉴（I5，比 Three.js 多做的部分；数据见 <see cref="Codex"/> / <see cref="CodexCatalog"/>）：主菜单里打开，不挡游戏；返回回主菜单。
    ///   上：标题 + 总收录数；四个页签（武器 / 秘卷 / 敌人 / 灵宠，各带「已收录 / 总数」与新条目红点）；
    ///   左：一页 12 格（4 × 3）——缩略图（<see cref="CodexThumbs"/> 现拍的模型图；秘卷是单字签）+ 名字；未收录的模型图染黑成剪影、名字写「？？？」，
    ///       秘卷写「？」；新收录的角上有朱印「新」，选中看过就清掉；
    ///   右：选中条目的详情——大图、名字、副标题、标签（元素 / 章节 / 稀有度…）、描述；
    ///       武器复用 <see cref="WeaponDescriber"/>（普通品质 +0 的基础数值、固有特性），秘卷按 1 层和叠满的描述，敌人写打法要点与基础数值，灵宠写攻击 / 被动 / 灵技 / 觉醒；
    ///       未收录的只写怎么收录（敌人另写出没的章）。
    ///   下：页码、上一页 / 下一页（也可以 Q / E 换页签，← → 在格子边上翻页）、返回。
    /// 缩略图每帧最多拍一张，先拍当前页；拍好之前显示单字占位。测试接口：<see cref="Select(CodexKind)"/>、<see cref="NextPage"/>、<see cref="PrevPage"/>、
    /// <see cref="Page"/> / <see cref="PageCount"/>、<see cref="Selected"/>、<see cref="PageThumbsReady"/>。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class CodexScreen : UIScreen
    {
        public const string ScreenId = "codex";
        const string Style = "UI/codex";
        public const int Columns = 4, Rows = 3, PerPage = Columns * Rows;

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        sealed class Cell
        {
            public Button button;
            public VisualElement thumb, badge;
            public Label glyph, name;
            public CodexEntry entry;
        }

        readonly List<Button> tabs = new();
        readonly List<Label> tabCounts = new();
        readonly List<VisualElement> tabDots = new();
        readonly List<Cell> cells = new();
        VisualElement frame, detail, heroThumb, chips, statGrid, traits;
        Label total, pageLabel, heroGlyph, dName, dSub, dDesc, dFoot;
        Button prevBtn, nextBtn, backBtn;
        float openedAt;
        CodexKind kind;
        int page;
        CodexEntry selected;

        /// <summary>当前页签</summary>
        public CodexKind Kind => kind;
        /// <summary>当前页（0 起）与总页数</summary>
        public int Page => page;
        public int PageCount => Mathf.Max(1, (CodexCatalog.Of(kind).Count + PerPage - 1) / PerPage);
        /// <summary>选中的条目</summary>
        public CodexEntry Selected => selected;
        /// <summary>当前页显示的条目</summary>
        public IEnumerable<CodexEntry> PageEntries
        {
            get
            {
                foreach (var c in cells)
                    if (c.entry != null) yield return c.entry;
            }
        }
        /// <summary>当前页的缩略图都拍好了（或确认拍不了）</summary>
        public bool PageThumbsReady
        {
            get
            {
                foreach (var c in cells)
                    if (c.entry != null && !CodexThumbs.Ready(c.entry)) return false;
                return true;
            }
        }
        /// <summary>选中条目详情里的名字 / 描述（测试用）</summary>
        public string DetailName => dName?.text;
        public string DetailText => dDesc?.text;

        public override VisualElement DefaultFocus => cells.Count > 0 ? cells[0].button : backBtn;

        static Codex Book => Codex.Current;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "codex" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            ScreenKit.Style(root, Style);
            root.AddToClassList("sf-codex-screen");
            ScreenKit.El("sf-backdrop sf-menu-sub__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-codex", root);

            var head = ScreenKit.El("sf-panel__head sf-panel__head--split", frame);
            var titles = ScreenKit.El("sf-panel__titles", head);
            ScreenKit.Text("sf-panel__title", titles, "图鉴", UIFontRole.Title);
            ScreenKit.Text("sf-panel__sub", titles, "首次获得的武器、秘卷、灵宠与首次交手的敌人都会收录在这里，跨局保留。");
            total = ScreenKit.Text("sf-codex__total", head, "", UIFontRole.Number);

            var tabRow = ScreenKit.El("sf-codex__tabs", frame);
            foreach (CodexKind k in Enum.GetValues(typeof(CodexKind)))
            {
                var kk = k;
                var b = ScreenKit.Card("sf-codex__tab", tabRow, () => Select(kk));
                b.name = "codex-tab-" + k.ToString().ToLowerInvariant();
                ScreenKit.Text("sf-codex__tabname", b, CodexCatalog.KindName(k), UIFontRole.Title);
                tabCounts.Add(ScreenKit.Text("sf-codex__tabcount", b, "", UIFontRole.Number));
                tabDots.Add(ScreenKit.El("sf-codex__dot", b));
                tabs.Add(b);
            }

            var body = ScreenKit.El("sf-codex__body", frame);
            var grid = ScreenKit.El("sf-codex__grid", body);
            for (int i = 0; i < PerPage; i++)
            {
                var c = new Cell();
                int idx = i;
                c.button = ScreenKit.Card("sf-codex__cell", grid, () => Pick(idx));
                c.button.name = "codex-cell-" + i;
                c.button.RegisterCallback<FocusInEvent>(_ => Pick(idx));
                var frameEl = ScreenKit.El("sf-codex__thumbframe", c.button);
                c.thumb = ScreenKit.El("sf-codex__thumb", frameEl);
                c.glyph = ScreenKit.Text("sf-codex__glyph", frameEl, "", UIFontRole.Title);
                c.badge = ScreenKit.Text("sf-seal sf-codex__new", c.button, "新", UIFontRole.Title);
                c.name = ScreenKit.Text("sf-codex__name", c.button, "", UIFontRole.Title);
                cells.Add(c);
            }

            detail = ScreenKit.El("sf-codex__detail", body);
            var heroFrame = ScreenKit.El("sf-codex__heroframe", detail);
            heroThumb = ScreenKit.El("sf-codex__herothumb", heroFrame);
            heroGlyph = ScreenKit.Text("sf-codex__heroglyph", heroFrame, "", UIFontRole.Title);
            dName = ScreenKit.Text("sf-codex__dname", detail, "", UIFontRole.Title);
            dSub = ScreenKit.Text("sf-codex__dsub", detail, "");
            chips = ScreenKit.El("sf-codex__chips", detail);
            var scroll = ScreenKit.Scroll("sf-codex__dscroll", detail);
            dDesc = ScreenKit.Text("sf-codex__ddesc", scroll, "", UIFontRole.Body, true);
            statGrid = ScreenKit.El("sf-codex__stats", scroll);
            traits = ScreenKit.El("sf-codex__traits", scroll);
            dFoot = ScreenKit.Text("sf-codex__dfoot", scroll, "");

            var foot = ScreenKit.El("sf-panel__foot", frame);
            prevBtn = ScreenKit.Btn("上一页", "sf-btn--sm", foot, PrevPage);
            prevBtn.name = "codex-prev";
            pageLabel = ScreenKit.Text("sf-codex__page", foot, "", UIFontRole.Number);
            nextBtn = ScreenKit.Btn("下一页", "sf-btn--sm", foot, NextPage);
            nextBtn.name = "codex-next";
            ScreenKit.Text("sf-panel__hint", foot, "Q / E 换类别　　← → 在边上翻页");
            ScreenKit.El("sf-grow", foot);
            backBtn = ScreenKit.Btn("返回", "sf-btn--primary", foot, () => Close());
            return root;
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            var k = arg is CodexKind ak ? ak : kind;
            kind = k;
            page = 0;
            selected = null;
            UIFonts.Warmup("图鉴武器秘卷敌人灵宠新？", UIFontRole.Title);
            Show();
        }

        public override void OnClose()
        {
            Book?.File?.SaveSoon();
            CodexThumbs.ReleaseRig();
        }

        // ───────────── 页签 / 翻页 ─────────────

        /// <summary>换页签（回到第一页、选中第一条）</summary>
        public void Select(CodexKind k)
        {
            if (k == kind && selected != null) return;
            kind = k;
            page = 0;
            selected = null;
            Show();
        }

        /// <summary>翻到某一条所在的页签和页并选中它（测试用；以后从结算 / 拾取提示跳过来也走这里）</summary>
        public bool Reveal(CodexEntry e)
        {
            if (e == null) return false;
            var list = CodexCatalog.Of(e.kind);
            int i = -1;
            for (int k = 0; k < list.Count; k++)
                if (list[k] == e)
                {
                    i = k;
                    break;
                }
            if (i < 0) return false;
            kind = e.kind;
            page = i / PerPage;
            selected = e;
            Show();
            return true;
        }

        public void NextPage() => GoPage(page + 1);
        public void PrevPage() => GoPage(page - 1);

        /// <summary>翻到某一页（超出两端就绕回）；选中这一页第一条</summary>
        public void GoPage(int p)
        {
            int n = PageCount;
            page = ((p % n) + n) % n;
            selected = null;
            Show();
            UISound.Play(UISound.ConfirmId);
        }

        void Show()
        {
            var book = Book;
            var list = CodexCatalog.Of(kind);
            page = Mathf.Clamp(page, 0, PageCount - 1);
            total.text = $"收录 {book.TotalCount} / {CodexCatalog.Total}";
            for (int i = 0; i < tabs.Count; i++)
            {
                var k = (CodexKind)i;
                tabs[i].EnableInClassList("sf-codex__tab--on", k == kind);
                tabCounts[i].text = $"{book.Count(k)} / {CodexCatalog.Of(k).Count}";
                ScreenKit.Show(tabDots[i], book.FreshCount(k) > 0);
            }
            for (int i = 0; i < cells.Count; i++)
            {
                int idx = page * PerPage + i;
                var c = cells[i];
                c.entry = idx < list.Count ? list[idx] : null;
                c.button.EnableInClassList("sf-codex__cell--empty", c.entry == null);
                c.button.SetEnabled(c.entry != null);
                c.button.focusable = c.entry != null;
                PaintCell(c);
            }
            pageLabel.text = $"第 {page + 1} / {PageCount} 页";
            prevBtn.SetEnabled(PageCount > 1);
            nextBtn.SetEnabled(PageCount > 1);
            if (selected == null || CodexEntryIndexOnPage(selected) < 0) selected = cells[0].entry;
            ShowDetail();
        }

        int CodexEntryIndexOnPage(CodexEntry e)
        {
            for (int i = 0; i < cells.Count; i++)
                if (cells[i].entry == e) return i;
            return -1;
        }

        void Pick(int i)
        {
            if (i < 0 || i >= cells.Count || cells[i].entry == null || cells[i].entry == selected) return;
            selected = cells[i].entry;
            ShowDetail();
        }

        // ───────────── 格子 ─────────────

        void PaintCell(Cell c)
        {
            var e = c.entry;
            c.button.EnableInClassList("sf-codex__cell--on", e != null && e == selected);
            if (e == null)
            {
                c.name.text = "";
                c.glyph.text = "";
                c.thumb.style.backgroundImage = StyleKeyword.None;
                ScreenKit.Show(c.badge, false);
                return;
            }
            bool have = Book.IsUnlocked(e.kind, e.id);
            c.button.EnableInClassList("sf-codex__cell--locked", !have);
            c.button.EnableInClassList("sf-codex__cell--boss", e.boss);
            c.name.text = have ? e.name : "？？？";
            c.name.style.color = have ? e.color : (Color)UITheme.Paper3;
            ScreenKit.Show(c.badge, have && Book.IsFresh(e.kind, e.id));
            PaintThumb(e, have, c.thumb, c.glyph);
        }

        /// <summary>缩略图（拍好了用模型图，未收录染黑成剪影）或单字签</summary>
        static void PaintThumb(CodexEntry e, bool have, VisualElement thumb, Label glyph)
        {
            var tex = CodexThumbs.HasModel(e) ? CodexThumbs.Peek(e) : null;
            if (tex)
            {
                if (glyph.parent != null)
                {
                    var s = glyph.parent.style;
                    s.borderTopColor = s.borderBottomColor = s.borderLeftColor = s.borderRightColor = StyleKeyword.Null;
                }
                thumb.style.backgroundImage = new StyleBackground(tex);
                thumb.style.unityBackgroundImageTintColor = have ? Color.white : new Color(0.02f, 0.015f, 0.03f, 0.92f);
                glyph.text = "";
                return;
            }
            thumb.style.backgroundImage = StyleKeyword.None;
            bool pending = CodexThumbs.HasModel(e) && !CodexThumbs.Ready(e);
            glyph.text = have ? e.name.Substring(0, 1) : "？";
            glyph.style.color = have ? e.color : (Color)UITheme.Paper3;
            glyph.style.opacity = pending ? 0.35f : 1f;
            // 单字签（秘卷）：收录了的框描成稀有度色
            if (glyph.parent != null)
            {
                if (have && !pending) ScreenKit.Border(glyph.parent, ScreenKit.A(e.color, 0.55f));
                else
                {
                    var s = glyph.parent.style;
                    s.borderTopColor = s.borderBottomColor = s.borderLeftColor = s.borderRightColor = StyleKeyword.Null;
                }
            }
        }

        // ───────────── 详情 ─────────────

        void ShowDetail()
        {
            foreach (var c in cells) c.button.EnableInClassList("sf-codex__cell--on", c.entry != null && c.entry == selected);
            chips.Clear();
            statGrid.Clear();
            traits.Clear();
            var e = selected;
            if (e == null)
            {
                dName.text = "";
                dSub.text = "";
                dDesc.text = "这一类还没有条目。";
                dFoot.text = "";
                heroThumb.style.backgroundImage = StyleKeyword.None;
                heroGlyph.text = "";
                return;
            }
            var book = Book;
            bool have = book.IsUnlocked(e.kind, e.id);
            PaintThumb(e, have, heroThumb, heroGlyph);
            if (!have)
            {
                dName.text = "？？？";
                dName.style.color = (Color)UITheme.Paper3;
                dSub.text = $"{CodexCatalog.KindName(e.kind)} · 未收录";
                dDesc.text = LockedHint(e);
                if (e.kind == CodexKind.Enemy && e.chapter > 0) Chip($"出没 · {GameSession.ChapterName(e.chapter)}", null);
                dFoot.text = "";
                return;
            }
            dName.text = e.name;
            dName.style.color = e.color;
            dSub.text = e.subtitle ?? "";
            dFoot.text = "";
            switch (e.def)
            {
                case WeaponDef w: DescribeWeapon(w); break;
                case ScrollDef s: DescribeScroll(s); break;
                case EnemyDef d: DescribeEnemy(e, d); break;
                case BossDef b: DescribeBoss(e, b); break;
                case PetDef p: DescribePet(p); break;
                default: dDesc.text = ""; break;
            }
            if (book.IsFresh(e.kind, e.id))
            {
                book.MarkSeen(e.kind, e.id);
                foreach (var c in cells)
                    if (c.entry == e) ScreenKit.Show(c.badge, false);
                for (int i = 0; i < tabDots.Count; i++) ScreenKit.Show(tabDots[i], book.FreshCount((CodexKind)i) > 0);
            }
        }

        static string LockedHint(CodexEntry e) => e.kind switch
        {
            CodexKind.Weapon => "尚未收录。在宝箱、补给营或首领奖励里拿到这把武器后收录。",
            CodexKind.Scroll => "尚未收录。获得一次这卷秘卷后收录。",
            CodexKind.Enemy => e.boss ? "尚未收录。与这位首领交手后收录。" : "尚未收录。第一次与它交手后收录。",
            _ => "尚未收录。与这只灵宠结契后收录。",
        };

        void Chip(string text, Color? color)
        {
            var chip = ScreenKit.El("sf-chip sf-codex__chip", chips);
            var l = ScreenKit.Text("sf-chip__name", chip, text);
            if (color.HasValue)
            {
                l.style.color = color.Value;
                ScreenKit.Border(chip, ScreenKit.A(color.Value, 0.5f));
            }
        }

        void Stat(string label, string value)
        {
            var row = ScreenKit.El("sf-codex__stat", statGrid);
            ScreenKit.Text("sf-codex__statk", row, label);
            ScreenKit.Text("sf-codex__statv", row, value, UIFontRole.Number);
        }

        void Trait(string text, string head = null)
        {
            var row = ScreenKit.El("sf-codex__trait", traits);
            if (!string.IsNullOrEmpty(head)) ScreenKit.Text("sf-codex__traithead", row, head, UIFontRole.Title);
            ScreenKit.Text("sf-codex__traittext", row, text, UIFontRole.Body, true);
        }

        void DescribeWeapon(WeaponDef w)
        {
            var desc = WeaponDescriber.Describe(new WeaponInstance(w), null);
            dSub.text = desc?.category ?? w.category;
            if (w.element != Element.None || w.cycle != null)
                Chip(desc?.elementLabel ?? WeaponDescriber.ElementName(w.element), w.cycle != null ? (Color?)UITheme.GoldHi : UITheme.ElementColor(w.element));
            Chip(w.mode switch
            {
                FireMode.Semi => "半自动",
                FireMode.Auto => "全自动",
                FireMode.Burst => "点射",
                FireMode.Beam => "光束",
                FireMode.Spinup => "预热连射",
                _ => "蓄力",
            }, null);
            if (w.IsExplosive) Chip("爆炸", null);
            dDesc.text = w.description ?? "";
            if (desc != null)
            {
                foreach (var s in desc.stats) Stat(s.label, s.value);
                foreach (var t in desc.traits) Trait(t);
                if (desc.skill != null) Trait($"{desc.skill.description}（冷却 {desc.skill.cooldown:0.#} 秒）", $"武器技能 · {desc.skill.name}");
            }
            dFoot.text = "以上为普通品质、未强化的基础数值；品质与强化越高伤害越高，词条随掉落另掷。";
        }

        void DescribeScroll(ScrollDef s)
        {
            Chip(Rarity.Name(s.rarity), Rarity.Color(s.rarity));
            if (s.maxStacks > 1) Chip($"最多 {s.maxStacks} 层", null);
            if (!string.IsNullOrEmpty(s.heroOnly)) Chip($"{HeroLibrary.Get(s.heroOnly)?.name ?? s.heroOnly} 专属", UITheme.GoldHi);
            dDesc.text = s.Describe(1);
            if (s.maxStacks > 1)
            {
                var full = s.Describe(s.maxStacks);
                if (!string.IsNullOrEmpty(full) && full != dDesc.text) Trait(full, $"叠满 {s.maxStacks} 层");
            }
        }

        void DescribeEnemy(CodexEntry e, EnemyDef d)
        {
            if (e.chapter > 0) Chip(GameSession.ChapterName(e.chapter), null);
            if (d.element != Element.None) Chip(WeaponDescriber.ElementName(d.element), UITheme.ElementColor(d.element));
            if (d.flying) Chip("飞行", null);
            dDesc.text = CodexCatalog.Describe(e);
            Stat("生命", ScreenKit.Num(d.hp));
            if (d.armor > 0) Stat("护甲", ScreenKit.Num(d.armor));
            if (d.shield > 0) Stat("护盾", ScreenKit.Num(d.shield));
            Stat("移速", ScreenKit.Num1(d.speed));
            if (d.damage > 0) Stat("伤害", ScreenKit.Num(d.damage));
            dFoot.text = "基础数值（难度 1）；越往后的关卡生命与伤害越高，精英另有词缀。";
        }

        void DescribeBoss(CodexEntry e, BossDef b)
        {
            if (e.chapter > 0) Chip(GameSession.ChapterName(e.chapter), null);
            Chip("首领", UITheme.CinnabarHi);
            if (b.element != Element.None) Chip(WeaponDescriber.ElementName(b.element), UITheme.ElementColor(b.element));
            if (b.phases.Count > 0) Chip($"{b.phases.Count + 1} 个阶段", null);
            if (b.forms.Count > 1) Chip($"{b.forms.Count} 种形态", null);
            dDesc.text = CodexCatalog.Describe(e);
        }

        void DescribePet(PetDef p)
        {
            Chip(PetRarities.Name(p.rarity), p.RarityColor);
            if (p.element != Element.None) Chip(WeaponDescriber.ElementName(p.element), UITheme.ElementColor(p.element));
            if (!string.IsNullOrEmpty(p.role)) Chip(p.role, null);
            dDesc.text = p.lore ?? "";
            if (!string.IsNullOrEmpty(p.attackDesc)) Trait(p.attackDesc, "攻击");
            if (!string.IsNullOrEmpty(p.passiveDesc)) Trait(p.passiveDesc, string.IsNullOrEmpty(p.passiveName) ? "被动" : $"被动 · {p.passiveName}");
            if (!string.IsNullOrEmpty(p.skillDesc)) Trait($"{p.skillDesc}（冷却 {p.skillCooldown:0.#} 秒）", string.IsNullOrEmpty(p.skillName) ? "灵技" : $"灵技 · {p.skillName}");
            if (!string.IsNullOrEmpty(p.awakenDesc)) Trait(p.awakenDesc, "觉醒");
        }

        // ───────────── 每帧 ─────────────

        public override bool OnNavigate(Vector2 direction)
        {
            // 在最左 / 最右一列再往外按：翻页
            if (direction.x == 0 || UIRouter.Focused is not Button b) return false;
            int i = cells.FindIndex(c => c.button == b);
            if (i < 0) return false;
            int col = i % Columns;
            if (direction.x < 0 && col == 0)
            {
                PrevPage();
                FocusCell(i / Columns * Columns + Columns - 1);
                return true;
            }
            if (direction.x > 0 && col == Columns - 1)
            {
                NextPage();
                FocusCell(i / Columns * Columns);
                return true;
            }
            return false;
        }

        void FocusCell(int i)
        {
            for (int k = Mathf.Clamp(i, 0, cells.Count - 1); k >= 0; k--)
                if (cells[k].entry != null)
                {
                    cells[k].button.Focus();
                    return;
                }
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.28f);
            frame.style.opacity = k;
            frame.style.translate = new Translate(0, 14 * (1 - k));

            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.qKey.wasPressedThisFrame) Select((CodexKind)(((int)kind + 3) % 4));
                else if (kb.eKey.wasPressedThisFrame) Select((CodexKind)(((int)kind + 1) % 4));
            }

            // 缩略图：每帧拍一张，先拍选中的，再拍这一页的
            if (selected != null && !CodexThumbs.Ready(selected)) Shoot(selected);
            else
                foreach (var c in cells)
                    if (c.entry != null && !CodexThumbs.Ready(c.entry))
                    {
                        Shoot(c.entry);
                        break;
                    }
        }

        void Shoot(CodexEntry e)
        {
            CodexThumbs.Get(e);
            bool have = Book.IsUnlocked(e.kind, e.id);
            foreach (var c in cells)
                if (c.entry == e) PaintThumb(e, have, c.thumb, c.glyph);
            if (e == selected) PaintThumb(e, have, heroThumb, heroGlyph);
        }
    }
}
