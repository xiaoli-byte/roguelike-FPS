using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 左下 生命 / 护盾（Three.js src/ui/HUD.ts Vitals + css/hud.css .gf-vitals）：
    ///   英雄徽记（圆框 + 单字，英雄色描边，低血量时朱红呼吸）；
    ///   护盾细条（青）+ 生命主条（朱红，每 10% 一道刻度），都带「延迟掉血」拖尾（受伤后停 0.42 s / 0.25 s 再以 1.2 / s 追上）；
    ///   数值：护盾数、生命「当前 / 上限」；没有护盾上限时护盾条半透明；低于 30% 生命条闪烁、数字变红；
    ///   护盾被打碎（<see cref="GameEvents.PlayerShieldBroken"/>）：条内斜纹闪过 + 外框青光往外炸开 0.65 s。
    /// 动画全部用不缩放时间。
    /// </summary>
    [HudWidget("vitals", Order = 50)]
    public sealed class VitalsWidget : HudWidget
    {
        const float TrailHold = 0.42f, TrailRate = 1.2f, ShatterTime = 0.65f;

        VisualElement crest, crestGlow, shieldBar, shieldFill, shieldTrail, shatter, burst, hpBar, hpFill, hpTrail;
        Label glyph, shieldVal, hpVal, hpMax;

        string heroId = "\0";
        int hpInt = -1, maxInt = -1, shInt = -1;
        float hpFrac = -1, shFrac = -1, hpTrailV = -1, shTrailV = -1, hpHold, shHold, shatterAt = -10;
        bool low, noShield;
        Color heroColor = UITheme.Gold;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-vitals");
            crest = HudArt.El("sf-vitals__crest", root);
            crestGlow = HudArt.El("sf-vitals__crestglow", crest);
            HudArt.Paint(crestGlow, HudArt.Glow, HudArt.WithAlpha(heroColor, 0.45f));
            glyph = HudArt.Text("sf-vitals__glyph", crest, "侠", UIFontRole.Title);

            var bars = HudArt.El("sf-vitals__bars", root);
            shieldBar = HudArt.El("sf-bar sf-bar--shield", bars);
            var sTrack = HudArt.El("sf-bar__track", shieldBar);
            shieldTrail = HudArt.Fill(sTrack, "sf-bar__trail");
            shieldTrail.style.backgroundColor = new Color(0.9f, 0.97f, 1f, 0.75f);
            shieldFill = HudArt.Fill(sTrack, "sf-bar__fill", UITheme.JadeHi);
            shatter = HudArt.El("sf-bar__shatter", sTrack);
            HudArt.Paint(shatter, HudArt.Stripes, new Color(0.85f, 0.95f, 1f, 1f));
            shatter.style.opacity = 0;
            shieldVal = HudArt.Text("sf-bar__val sf-bar__val--shield", shieldBar, "0", UIFontRole.Number);
            burst = HudArt.El("sf-bar__burst", shieldBar);
            burst.style.opacity = 0;

            hpBar = HudArt.El("sf-bar sf-bar--hp", bars);
            var hTrack = HudArt.El("sf-bar__track", hpBar);
            hpTrail = HudArt.Fill(hTrack, "sf-bar__trail");
            hpTrail.style.backgroundColor = HudArt.WithAlpha(HudArt.Trail, 0.9f);
            hpFill = HudArt.Fill(hTrack, "sf-bar__fill", UITheme.HpHi);
            // 每 10% 一格的刻度
            for (int i = 1; i < 10; i++)
            {
                var tick = HudArt.El("sf-bar__tick", hTrack);
                tick.style.left = Length.Percent(i * 10);
            }
            var val = HudArt.El("sf-bar__valrow", hpBar);
            hpVal = HudArt.Text("sf-bar__val sf-bar__val--hp", val, "0", UIFontRole.Number);
            hpMax = HudArt.Text("sf-bar__max", val, " / 0", UIFontRole.Number);
            return root;
        }

        protected override void OnAttach() => GameEvents.PlayerShieldBroken += OnShieldBroken;
        protected override void OnDetach() => GameEvents.PlayerShieldBroken -= OnShieldBroken;

        void OnShieldBroken() => shatterAt = Time.unscaledTime;

        public override void ResetState()
        {
            hpFrac = shFrac = -1;
            hpTrailV = shTrailV = -1;
            hpInt = maxInt = shInt = -1;
            heroId = "\0";
            shatterAt = -10;
        }

        public override void Tick(in HudFrame f)
        {
            var p = Ctx.Vitals;
            Visible = p;
            if (!p) return;
            float now = f.unscaledTime, step = Mathf.Min(0.1f, f.unscaledDt);

            var hero = Ctx.Hero;
            string id = hero?.id ?? "";
            if (id != heroId)
            {
                heroId = id;
                HudArt.SetText(glyph, hero != null && !string.IsNullOrEmpty(hero.name) ? hero.name.Substring(0, 1) : "侠");
                heroColor = hero != null ? hero.color : UITheme.Gold;
                heroColor.a = 1;
                HudArt.Tint(crestGlow, HudArt.WithAlpha(heroColor, 0.45f));
            }

            // 防御性：任何一方写出 NaN 时不显示「NaN」
            float maxHp = Mathf.Max(1, Finite(p.MaxHealth, 1));
            float hp = Mathf.Clamp(Finite(p.health, 0), 0, maxHp);
            float maxSh = Mathf.Max(0, Finite(p.MaxShield, 0));
            float sh = Mathf.Clamp(Finite(p.shield, 0), 0, maxSh);

            int hi = Mathf.CeilToInt(hp);
            if (hi != hpInt)
            {
                hpInt = hi;
                hpVal.text = hi.ToString();
            }
            int mi = Mathf.RoundToInt(maxHp);
            if (mi != maxInt)
            {
                maxInt = mi;
                hpMax.text = " / " + mi;
            }
            int si = Mathf.CeilToInt(sh);
            if (si != shInt)
            {
                shInt = si;
                shieldVal.text = si.ToString();
            }
            bool none = maxSh <= 0;
            if (none != noShield)
            {
                noShield = none;
                HudArt.Toggle(shieldBar, "is-none", none);
            }

            // 生命：延迟掉血
            float hf = hp / maxHp;
            if (Mathf.Abs(hf - hpFrac) > 0.0008f)
            {
                if (hf < hpFrac) hpHold = now + TrailHold;
                hpFrac = hf;
                HudArt.SetFill(hpFill, hf);
            }
            hpTrailV = Trail(hpTrailV, hf, now >= hpHold, step, hpTrail);

            float sf = maxSh > 0 ? sh / maxSh : 0;
            if (Mathf.Abs(sf - shFrac) > 0.0008f)
            {
                if (sf < shFrac) shHold = now + TrailHold * 0.6f;
                shFrac = sf;
                HudArt.SetFill(shieldFill, sf);
            }
            shTrailV = Trail(shTrailV, sf, now >= shHold, step, shieldTrail);

            bool isLow = !p.Dead && hf < 0.3f;
            if (isLow != low)
            {
                low = isLow;
                HudArt.Toggle(hpBar, "is-low", isLow);
                HudArt.Toggle(crest, "is-low", isLow);
                if (!isLow)
                {
                    HudArt.Tint(hpFill, UITheme.HpHi);
                    crest.style.borderTopColor = crest.style.borderBottomColor = crest.style.borderLeftColor = crest.style.borderRightColor = heroColor;
                }
            }
            if (low)
            {
                // 生命条 0.7 s 往返提亮、徽记边框 0.9 s 朱红呼吸
                float k = 0.5f + 0.5f * Mathf.Sin(now * Mathf.PI / 0.7f);
                HudArt.Tint(hpFill, Color.Lerp(UITheme.HpHi, new Color(1f, 0.75f, 0.6f), k * 0.6f));
                float kc = 0.5f + 0.5f * Mathf.Sin(now * Mathf.PI / 0.9f);
                var bc = Color.Lerp(UITheme.HpHi * 0.7f, UITheme.HpHi, kc);
                bc.a = 1;
                crest.style.borderTopColor = crest.style.borderBottomColor = crest.style.borderLeftColor = crest.style.borderRightColor = bc;
            }
            else if (crest.style.borderTopColor.value != heroColor)
                crest.style.borderTopColor = crest.style.borderBottomColor = crest.style.borderLeftColor = crest.style.borderRightColor = heroColor;

            // 护盾碎裂
            float e = (now - shatterAt) / ShatterTime;
            if (e >= 0 && e < 1)
            {
                shatter.style.opacity = 1 - e;
                shatter.style.translate = new Translate(18 * e, 0);
                burst.style.opacity = 1 - e;
                burst.style.scale = new Scale(new Vector3(1 + 0.12f * e, 1 + 0.9f * e, 1));
            }
            else if (shatter.style.opacity.value > 0)
            {
                shatter.style.opacity = 0;
                burst.style.opacity = 0;
            }
        }

        static float Trail(float cur, float target, bool release, float step, VisualElement el)
        {
            float v = cur;
            // 刚换玩家（-1）：拖尾直接对齐，不从满格往下掉
            if (v < 0 || v < target) v = target;
            else if (v > target && release) v = Mathf.Max(target, v - step * TrailRate);
            if (!Mathf.Approximately(v, cur)) HudArt.SetFill(el, v);
            return v;
        }

        static float Finite(float v, float fallback) => float.IsFinite(v) ? v : fallback;
    }
}
