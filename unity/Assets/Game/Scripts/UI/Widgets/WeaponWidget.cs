using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 右下 武器槽（Three.js src/ui/HUD.ts WeaponPanel + css/hud.css .gf-weapon；数据全部来自 <see cref="IWeaponHudSource"/>）：
    ///   副槽一行：切枪键 + 元素小徽 + 名字（品质色压暗）；
    ///   主槽：右边框 = 品质色、墨色右实左透底；标题行 元素徽（火 / 雷 / 蚀；元素轮转武器显示「下一发」的元素并加金圈）+ 名字（标题字体、品质色）+「+N」强化；
    ///   弹药 大号弹匣 / 备弹（无限弹药显示 ∞、鎏金；余弹 ≤ 25% 变红）；
    ///   计量条：蓄力武器显示蓄力（满蓄转金）、预热武器显示转速（热度由橙转红）；
    ///   换弹条 + 提示（换弹中 / 按 R 换弹 / 弹药耗尽，后两者红字闪烁）；切枪时主槽从右滑入。
    /// 只写变化了的文字和样式（缓存上次的值）。
    /// </summary>
    [HudWidget("weapon", Order = 50)]
    public sealed class WeaponWidget : HudWidget
    {
        const float PulseTime = 0.22f;

        VisualElement sec, main, elemBadge, secElem, gaugeRow, gaugeFill, reloadRow, reloadTrack, reloadFill;
        Label secKey, secName, elemGlyph, secElemGlyph, nameLabel, lvl, mag, sep, reserve, gaugeLabel, hint;

        int uid = -2, lvlV = -1, rar = -1, sUid = -2, sLvl = -1, sRar = -1, magV = -1, capV = -1, resV = -1, reloadQ = -2, gaugeQ = -2;
        Element elemV = (Element)(-1), sElem = (Element)(-1), nextV = (Element)(-1);
        bool infinite, lowV, hasWeapon = true, gaugeFull, pulsing;
        string hintV = "\0", gaugeMode = "\0";
        float pulseAt = -10;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-weapon");
            sec = HudArt.El("sf-weapon__sec", root);
            secKey = HudArt.Text("sf-weapon__seckey", sec, "X", UIFontRole.Number);
            secElem = HudArt.El("sf-weapon__elem sf-weapon__elem--sm", sec);
            secElemGlyph = HudArt.Text("sf-weapon__elemglyph", secElem, "", UIFontRole.Title);
            secName = HudArt.Text("sf-weapon__secname", sec);

            main = HudArt.El("sf-weapon__main", root);
            HudArt.Paint(main, HudArt.FadeLeft, new Color(0.027f, 0.024f, 0.04f, 0.8f));
            var title = HudArt.El("sf-weapon__title", main);
            elemBadge = HudArt.El("sf-weapon__elem", title);
            elemGlyph = HudArt.Text("sf-weapon__elemglyph", elemBadge, "", UIFontRole.Title);
            nameLabel = HudArt.Text("sf-weapon__name", title, "", UIFontRole.Title);
            lvl = HudArt.Text("sf-weapon__lvl", title, "", UIFontRole.Number);

            var ammo = HudArt.El("sf-weapon__ammo", main);
            mag = HudArt.Text("sf-weapon__mag", ammo, "0", UIFontRole.Number);
            sep = HudArt.Text("sf-weapon__sep", ammo, "/", UIFontRole.Number);
            reserve = HudArt.Text("sf-weapon__reserve", ammo, "0", UIFontRole.Number);

            gaugeRow = HudArt.El("sf-weapon__gauge", main);
            gaugeLabel = HudArt.Text("sf-weapon__gaugelabel", gaugeRow);
            var gTrack = HudArt.El("sf-weapon__track", gaugeRow);
            gaugeFill = HudArt.Fill(gTrack, "sf-weapon__trackfill");
            HudArt.Show(gaugeRow, false);

            reloadRow = HudArt.El("sf-weapon__reload", main);
            reloadTrack = HudArt.El("sf-weapon__track", reloadRow);
            reloadFill = HudArt.Fill(reloadTrack, "sf-weapon__trackfill");
            reloadFill.style.backgroundColor = UITheme.GoldHi;
            hint = HudArt.Text("sf-weapon__hint", reloadRow);
            reloadRow.style.opacity = 0;
            return root;
        }

        protected override void OnAttach() => GameEvents.WeaponSwitched += OnSwitched;
        protected override void OnDetach() => GameEvents.WeaponSwitched -= OnSwitched;

        void OnSwitched(WeaponInstance prev, WeaponInstance next) => pulseAt = Time.unscaledTime;

        public override void ResetState()
        {
            uid = sUid = -2;
            magV = capV = resV = -1;
            reloadQ = gaugeQ = -2;
            hintV = "\0";
            gaugeMode = "\0";
        }

        public override void Tick(in HudFrame f)
        {
            var src = Ctx.WeaponHud;
            var wc = Ctx.Weapons;
            Visible = src != null && Ctx.Vitals;
            if (src == null) return;
            float now = f.unscaledTime;
            var w = src.Weapon;
            bool has = w != null;
            if (has != hasWeapon)
            {
                hasWeapon = has;
                HudArt.Toggle(main, "is-empty", !has);
            }
            if (has) SyncMain(src, w, now);
            else if (uid != -1)
            {
                uid = -1;
                HudArt.SetText(nameLabel, "空手");
                HudArt.Show(elemBadge, false);
                HudArt.Show(lvl, false);
                HudArt.SetText(mag, "–");
                HudArt.SetText(reserve, "–");
                magV = resV = -1;
            }

            // 副槽：控制器另一个槽里的枪
            WeaponInstance other = null;
            if (wc)
            {
                int o = wc.ActiveSlot == 0 ? 1 : 0;
                other = o < wc.slots.Length ? wc.slots[o] : null;
            }
            int su = other?.uid ?? -1;
            if (su != sUid || (other != null && (other.level != sLvl || other.rarity != sRar || other.element != sElem)))
            {
                sUid = su;
                sLvl = other?.level ?? -1;
                sRar = other?.rarity ?? -1;
                sElem = other?.element ?? Element.None;
                HudArt.Show(sec, other != null);
                if (other != null)
                {
                    var name = WeaponLibrary.DisplayName(other);
                    HudArt.SetText(secName, other.level > 0 ? $"{name} +{other.level}" : name);
                    secName.style.color = Color.Lerp(Rarity.Color(other.rarity), UITheme.Paper3, 0.3f);
                    SetElem(secElem, secElemGlyph, other.def.cycle != null ? other.def.cycle[0] : other.element, other.def.cycle != null);
                }
            }
            if (other != null) HudArt.SetText(secKey, HudArt.Key(GameAction.Swap));

            // 计量条：蓄力 / 预热
            string mode = src.ModeId ?? "";
            bool charge = mode == "charge" || src.Charge > 0.001f;
            bool heat = !charge && (mode == "spinup" || src.Heat > 0.001f);
            string gm = charge ? "charge" : heat ? "heat" : "";
            if (gm != gaugeMode)
            {
                gaugeMode = gm;
                HudArt.Show(gaugeRow, gm.Length > 0);
                HudArt.SetText(gaugeLabel, charge ? "蓄力" : heat ? "转速" : "");
                gaugeQ = -2;
            }
            if (gm.Length > 0)
            {
                float v = charge ? src.Charge : src.Heat;
                int q = Mathf.RoundToInt(Mathf.Clamp01(v) * 100);
                bool full = charge ? src.ChargeFull || q >= 100 : q >= 100;
                if (q != gaugeQ || full != gaugeFull)
                {
                    gaugeQ = q;
                    gaugeFull = full;
                    HudArt.SetFill(gaugeFill, q / 100f);
                    var c = charge
                        ? (full ? HudArt.ArmorHi : new Color(0.886f, 0.831f, 1f))
                        : Color.Lerp(new Color(1f, 0.62f, 0.25f), UITheme.CinnabarHi, q / 100f);
                    gaugeFill.style.backgroundColor = c;
                    gaugeLabel.style.color = full ? HudArt.ArmorHi : UITheme.Paper2;
                }
            }

            // 换弹进度与提示
            bool reloading = src.Reloading;
            int rq = reloading ? Mathf.RoundToInt(Mathf.Clamp01(src.ReloadProgress) * 100) : -1;
            if (rq != reloadQ)
            {
                if ((rq >= 0) != (reloadQ >= 0)) HudArt.Show(reloadTrack, rq >= 0);
                reloadQ = rq;
                if (rq >= 0) HudArt.SetFill(reloadFill, rq / 100f);
            }
            string h = "";
            if (reloading) h = "换弹中";
            else if (has && !infinite && magV == 0) h = resV > 0 ? $"按 {HudArt.Key(GameAction.Reload)} 换弹" : "弹药耗尽";
            if (h != hintV)
            {
                hintV = h;
                hint.text = h;
                HudArt.Toggle(reloadRow, "is-alert", h.Length > 0 && !reloading);
            }
            bool alert = h.Length > 0 && !reloading;
            float rowA = reloading || h.Length > 0 ? 1 : 0;
            // 告警：0.9 s 两段闪（steps(2)）
            hint.style.opacity = alert ? ((now % 0.9f) < 0.45f ? 1f : 0.35f) : 1f;
            if (!Mathf.Approximately(reloadRow.style.opacity.value, rowA)) reloadRow.style.opacity = rowA;

            // 切枪：主槽从右滑入
            float k = (now - pulseAt) / PulseTime;
            if (k >= 0 && k < 1)
            {
                float e = 1 - (1 - k) * (1 - k) * (1 - k);
                main.style.translate = new Translate(14 * (1 - e), 0);
                main.style.opacity = Mathf.Lerp(0.3f, 1f, e);
                pulsing = true;
            }
            else if (pulsing)
            {
                pulsing = false;
                main.style.translate = StyleKeyword.Null;
                main.style.opacity = StyleKeyword.Null;
            }
        }

        void SyncMain(IWeaponHudSource src, WeaponInstance w, float now)
        {
            if (w.uid != uid || w.level != lvlV || w.rarity != rar || w.element != elemV)
            {
                uid = w.uid;
                lvlV = w.level;
                rar = w.rarity;
                elemV = w.element;
                var rc = Rarity.Color(w.rarity);
                HudArt.SetText(nameLabel, WeaponLibrary.DisplayName(w));
                nameLabel.style.color = rc;
                main.style.borderRightColor = rc;
                HudArt.Show(lvl, w.level > 0);
                HudArt.SetText(lvl, "+" + w.level);
                nextV = (Element)(-1);
            }
            // 元素徽：元素轮转武器显示下一发
            bool cycle = w.def.cycle != null && w.def.cycle.Length > 0;
            var el = cycle ? src.NextElement : w.element;
            if (el != nextV)
            {
                nextV = el;
                SetElem(elemBadge, elemGlyph, el, cycle);
            }

            int cap = Mathf.Max(1, src.MagCapacity);
            int m = Mathf.Max(0, src.Mag);
            int r = Mathf.Max(0, src.Reserve);
            bool inf = src.InfiniteAmmo;
            if (m != magV)
            {
                magV = m;
                mag.text = m.ToString();
            }
            if (r != resV || inf != infinite)
            {
                resV = r;
                reserve.text = inf ? "∞" : r.ToString();
            }
            if (inf != infinite)
            {
                infinite = inf;
                HudArt.Toggle(main, "is-infinite", inf);
            }
            bool isLow = !inf && m <= Mathf.Max(1, Mathf.CeilToInt(cap * 0.25f));
            if (isLow != lowV || cap != capV)
            {
                lowV = isLow;
                capV = cap;
                HudArt.Toggle(mag, "is-low", isLow);
            }
        }

        static void SetElem(VisualElement badge, Label glyph, Element e, bool cycle)
        {
            HudArt.Show(badge, e != Element.None || cycle);
            if (e == Element.None && !cycle) return;
            var c = e != Element.None ? UITheme.ElementColor(e) : UITheme.GoldHi;
            badge.style.backgroundColor = c;
            HudArt.Toggle(badge, "is-tri", cycle);
            HudArt.SetText(glyph, e != Element.None ? HudArt.ElementGlyph(e) : "三");
        }
    }
}
