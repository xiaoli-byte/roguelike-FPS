using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领血条（Three.js src/ui/BossBar.ts + css/combat.css .gf-boss；docs/unity-parity.md D23 / U3）：顶部居中。
    ///   名字（标题字体、宽字距，两侧朱砂祥云）+ 可选副标题（形态 / 阶段）；护盾（青）/ 护甲（金）细条、生命主条（延迟掉血拖尾）；
    ///   阶段刻度来自 <see cref="IBossBarSource.BarThresholds"/>（BossDef），越过时刻度熄灭、整条亮一下；
    ///   无敌（登场 / 换形 / 阶段转换）：血条蒙灰、底部显示锁与「无敌」；底部另有当前受击层（护盾 / 护甲 / 生命）与数值；
    ///   首领死后显示「已击破」1.6 s 再收起（不管有没有人调 SetBoss(null)）。
    ///   破防条（第四章领主，数据源实现 <see cref="IBreakBarSource"/> 且有破防条时）：生命条下一道细金条，打弱点 / 反应往里填；
    ///   满了破防时金条满格闪烁、底部受击层换成破防名（「破鼓」）；没有破防条的首领不显示这一行（前三章不变）。
    /// 数据源：<see cref="GameUI.SetBoss{T}"/>（B0 的 BossBrain 实现 <see cref="IBossBarSource"/>）、旧接口 <see cref="GameUI.SetBoss(Damageable, string)"/>；
    /// 都没调时，生成出来的 Rank.Boss 敌人自动接上（实现了接口就用它的刻度，否则没有刻度）。
    /// </summary>
    [HudWidget("boss-bar", Order = 55)]
    public sealed class BossBar : HudWidget
    {
        const float DeadLinger = 1.6f, OpenTime = 0.5f, TrailHold = 0.45f, TrailRate = 0.45f, PassFlash = 0.52f;
        static readonly Color InvulnLayer = UITheme.Paper2;

        VisualElement panel, bars, shieldRow, shieldFill, armorRow, armorFill, hpRow, hpFill, hpTrail, invulnVeil, flash, lockIcon, breakRow, breakFill;
        Label nameLabel, subLabel, layerLabel, numLabel;
        readonly List<VisualElement> tickEls = new();
        readonly List<float> ticks = new();
        readonly List<bool> passed = new();

        IBossBarSource source;
        Damageable body;
        bool visible, invuln, opening, closing, dead, explicitSet;
        float openAt = -10, closeAt = -10, deadAt = -1, flashAt = -10, trail = 1, trailHold, shieldV = -1, armorV = -1, hpV = -1;
        int numCur = -1, numMax = -1;
        float breakV = -1;
        bool breakShown, breakBroken;
        string layerText = "", titleText = "", subText = "";

        /// <summary>当前数据源（没有为 null；「已击破」收起期间仍是死去的那个）</summary>
        public IBossBarSource Source => source;
        /// <summary>正在显示（含收起动画）</summary>
        public bool Shown => visible;
        /// <summary>数据源是 GameUI.SetBoss 手动设的（false = 生成首领时自动接上的）</summary>
        public bool Explicit => explicitSet;
        /// <summary>破防条这一行显示着、当前填充（测试用）</summary>
        public bool BreakShown => breakShown;
        public float BreakFill => breakV;
        /// <summary>当前首领名 / 刻度（测试用）</summary>
        public string Title => titleText;
        public IReadOnlyList<float> Ticks => ticks;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-boss");
            panel = HudArt.El("sf-boss__panel", root);
            var head = HudArt.El("sf-boss__head", panel);
            head.Add(UIIcons.Make(UIIcon.Cloud, "sf-boss__cloud"));
            nameLabel = HudArt.Text("sf-boss__name", head, "", UIFontRole.Title);
            head.Add(UIIcons.Make(UIIcon.Cloud, "sf-boss__cloud", "sf-boss__cloud--r"));
            subLabel = HudArt.Text("sf-boss__sub", panel);
            HudArt.Show(subLabel, false);

            bars = HudArt.El("sf-boss__bars", panel);
            shieldRow = HudArt.El("sf-boss__row sf-boss__row--shield", bars);
            shieldFill = HudArt.Fill(shieldRow, null, UITheme.JadeHi);
            armorRow = HudArt.El("sf-boss__row sf-boss__row--armor", bars);
            armorFill = HudArt.Fill(armorRow, null, HudArt.ArmorHi);
            hpRow = HudArt.El("sf-boss__row sf-boss__row--hp", bars);
            hpTrail = HudArt.Fill(hpRow, "sf-boss__trail");
            hpTrail.style.backgroundColor = HudArt.Trail;
            hpFill = HudArt.Fill(hpRow, null, UITheme.HpHi);
            breakRow = HudArt.El("sf-boss__row sf-boss__row--break", bars);
            breakFill = HudArt.Fill(breakRow, "sf-boss__break", UITheme.GoldHi);
            HudArt.Show(breakRow, false);
            invulnVeil = HudArt.El("sf-boss__veil", bars);
            HudArt.Show(invulnVeil, false);
            flash = HudArt.El("sf-boss__flash", bars);
            flash.style.opacity = 0;

            var foot = HudArt.El("sf-boss__foot", panel);
            var state = HudArt.El("sf-boss__state", foot);
            lockIcon = UIIcons.Make(UIIcon.Lock, "sf-boss__lock");
            state.Add(lockIcon);
            HudArt.Show(lockIcon, false);
            layerLabel = HudArt.Text("sf-boss__layer", state);
            numLabel = HudArt.Text("sf-boss__num", foot, "", UIFontRole.Number);
            root.style.display = DisplayStyle.None;
            return root;
        }

        protected override void OnAttach() => GameEvents.EnemySpawned += OnSpawned;
        protected override void OnDetach() => GameEvents.EnemySpawned -= OnSpawned;

        void OnSpawned(EnemyAI ai)
        {
            if (!ai || !ai.Health || !ai.Health.IsBoss) return;
            // 已经有活着的首领在显示（不管是手动设的还是自动接上的）就不抢
            if (source != null && !dead && !closing && body && !body.Dead) return;
            Bind(ai as IBossBarSource ?? new DamageableBossSource(ai.Health, null), false);
        }

        /// <summary>换玩家（换关 / 重来）：首领还活着（同一场景里重组了玩家）就留着，否则立即收起</summary>
        public override void ResetState()
        {
            if (source != null && body && !body.Dead && !closing) return;
            HideNow();
        }

        /// <summary>设首领（null = 收起；刚死的首领先显示「已击破」再收起）</summary>
        public void Set(IBossBarSource s)
        {
            if (s == null)
            {
                if (visible && body && body.Dead && !closing)
                {
                    if (!dead) MarkDead(Time.unscaledTime);
                    return;
                }
                Close();
                return;
            }
            Bind(s, true);
        }

        void Bind(IBossBarSource s, bool isExplicit)
        {
            bool reopen = !visible || closing;
            source = s;
            explicitSet = isExplicit;
            body = s.BarHealth;
            dead = false;
            deadAt = -1;
            closing = false;
            shieldV = armorV = hpV = -1;
            numCur = numMax = -1;
            breakV = -1;
            layerText = "";
            trail = body ? Mathf.Clamp01(body.health / Mathf.Max(1, body.maxHealth)) : 1;
            HudArt.SetFill(hpTrail, trail);
            HudArt.Toggle(Root, "is-dead", false);
            SyncTitle();
            BuildTicks(s.BarThresholds);
            for (int i = 0; i < ticks.Count; i++)
            {
                passed[i] = trail <= ticks[i];
                HudArt.Toggle(tickEls[i], "is-passed", passed[i]);
            }
            if (reopen)
            {
                visible = true;
                opening = true;
                openAt = Time.unscaledTime;
                Root.style.display = DisplayStyle.Flex;
            }
        }

        void SyncTitle()
        {
            string t = source?.BarTitle;
            if (string.IsNullOrEmpty(t) && body) t = string.IsNullOrEmpty(body.displayName) ? body.name : body.displayName;
            t ??= "";
            if (t != titleText)
            {
                titleText = t;
                nameLabel.text = t;
            }
            string s = source?.BarSubtitle ?? "";
            if (s != subText)
            {
                subText = s;
                subLabel.text = s;
                HudArt.Show(subLabel, s.Length > 0);
            }
        }

        /// <summary>按阈值重建刻度（阈值相同保留现有元素）</summary>
        void BuildTicks(IReadOnlyList<float> src)
        {
            int n = 0;
            if (src != null)
                foreach (var t in src)
                    if (t > 0.001f && t < 0.999f) n++;
            bool same = n == ticks.Count;
            if (same && src != null)
            {
                int i = 0;
                foreach (var t in src)
                {
                    if (!(t > 0.001f && t < 0.999f)) continue;
                    if (!Mathf.Approximately(ticks[i++], t))
                    {
                        same = false;
                        break;
                    }
                }
            }
            if (same) return;
            foreach (var el in tickEls) el.RemoveFromHierarchy();
            tickEls.Clear();
            ticks.Clear();
            passed.Clear();
            if (src == null) return;
            foreach (var t in src)
            {
                if (!(t > 0.001f && t < 0.999f)) continue;
                var tick = HudArt.El("sf-boss__tick", hpRow);
                tick.style.left = Length.Percent(t * 100);
                tickEls.Add(tick);
                ticks.Add(t);
                passed.Add(false);
            }
            invulnVeil.BringToFront();
            flash.BringToFront();
        }

        void MarkDead(float now)
        {
            dead = true;
            deadAt = now;
            HudArt.Toggle(Root, "is-dead", true);
        }

        void Close()
        {
            if (!visible || closing) return;
            closing = true;
            closeAt = Time.unscaledTime;
        }

        /// <summary>立即收起（换关 / 新开一局），不保留「已击破」</summary>
        public void HideNow()
        {
            source = null;
            body = null;
            visible = opening = closing = dead = explicitSet = false;
            deadAt = -1;
            if (Root != null) Root.style.display = DisplayStyle.None;
        }

        public override void Tick(in HudFrame f)
        {
            if (!visible) return;
            float now = f.unscaledTime;
            // 面板宽度：不超过 720，也不超过屏宽 56%（给右上角信息角留位置）
            float w = Mathf.Min(720, Ctx.PanelSize.x * 0.56f);
            if (!Mathf.Approximately(panel.style.width.value.value, w)) panel.style.width = w;

            // 开 / 收动画
            if (opening)
            {
                float k = Mathf.Clamp01((now - openAt) / OpenTime);
                float e = 1 - (1 - k) * (1 - k) * (1 - k);
                panel.style.opacity = e;
                panel.style.translate = new Translate(0, -14 * (1 - e));
                if (k >= 1) opening = false;
            }
            if (closing)
            {
                float k = Mathf.Clamp01((now - closeAt) / OpenTime);
                panel.style.opacity = 1 - k;
                panel.style.translate = new Translate(0, -14 * k);
                if (k >= 1)
                {
                    HideNow();
                    return;
                }
            }
            if (source == null) return;

            // 换形：受伤体换了 → 拖尾对齐
            var b = source.BarHealth;
            if (b && b != body)
            {
                body = b;
                trail = Mathf.Clamp01(body.health / Mathf.Max(1, body.maxHealth));
                HudArt.SetFill(hpTrail, trail);
                shieldV = armorV = hpV = -1;
            }
            if (!body)
            {
                // 首领物体被回收了：没死就直接收起，死了的等「已击破」停够再收
                if (!dead || now - deadAt > DeadLinger) Close();
                return;
            }
            SyncTitle();
            BuildTicks(source.BarThresholds);

            bool alive = !body.Dead;
            bool hasShield = body.maxShield > 0 || body.shield > 0, hasArmor = body.maxArmor > 0;
            HudArt.Show(shieldRow, hasShield);
            HudArt.Show(armorRow, hasArmor);
            float sh = hasShield ? Mathf.Clamp01(body.shield / Mathf.Max(1, Mathf.Max(body.maxShield, body.shield))) : 0;
            if (Mathf.Abs(sh - shieldV) > 0.001f)
            {
                shieldV = sh;
                HudArt.SetFill(shieldFill, sh);
            }
            float ar = hasArmor ? Mathf.Clamp01(body.armor / body.maxArmor) : 0;
            if (Mathf.Abs(ar - armorV) > 0.001f)
            {
                armorV = ar;
                HudArt.SetFill(armorFill, ar);
            }
            float hp = alive ? Mathf.Clamp01(body.health / Mathf.Max(1, body.maxHealth)) : 0;
            if (Mathf.Abs(hp - hpV) > 0.0005f)
            {
                if (hp < hpV) trailHold = now + TrailHold;
                hpV = hp;
                HudArt.SetFill(hpFill, hp);
                for (int i = 0; i < ticks.Count; i++)
                {
                    bool p = hp <= ticks[i];
                    if (p == passed[i]) continue;
                    passed[i] = p;
                    HudArt.Toggle(tickEls[i], "is-passed", p);
                    if (p) flashAt = now;
                }
            }
            float t = trail;
            if (t < hp) t = hp;
            else if (t > hp && now >= trailHold) t = Mathf.Max(hp, t - f.unscaledDt * TrailRate);
            if (!Mathf.Approximately(t, trail))
            {
                trail = t;
                HudArt.SetFill(hpTrail, t);
            }
            float kf = (now - flashAt) / PassFlash;
            flash.style.opacity = kf >= 0 && kf < 1 ? 0.45f * (1 - kf) * (1 - kf) : 0;

            // 破防条（第四章领主）：生命条下的细金条，破防中满格闪
            var bb = alive ? (source as IBreakBarSource)?.BarBreak : null;
            bool showBreak = bb != null;
            if (showBreak != breakShown)
            {
                breakShown = showBreak;
                HudArt.Show(breakRow, showBreak);
                breakV = -1;
            }
            bool broken = bb != null && bb.Broken;
            if (showBreak)
            {
                float bv = bb.Fill;
                if (Mathf.Abs(bv - breakV) > 0.002f)
                {
                    breakV = bv;
                    HudArt.SetFill(breakFill, bv);
                }
                if (broken != breakBroken)
                {
                    breakBroken = broken;
                    HudArt.Toggle(breakRow, "is-broken", broken);
                    if (broken) flashAt = now;
                }
                if (broken) breakFill.style.opacity = 0.65f + 0.35f * Mathf.Sin(now * 18f);
                else if (breakFill.style.opacity.value < 0.999f) breakFill.style.opacity = 1f;
            }

            // 无敌：蒙灰 + 锁
            bool inv = alive && (source.BarInvulnerable || body.untargetable);
            if (inv != invuln)
            {
                invuln = inv;
                HudArt.Show(invulnVeil, inv);
                HudArt.Show(lockIcon, inv);
                HudArt.Toggle(Root, "is-invuln", inv);
            }

            // 当前受击层 + 数值
            string layer = !alive ? "已击破" : inv ? "无敌" : broken ? bb.def.label : body.shield > 0 ? "护盾" : body.armor > 0 ? "护甲" : "生命";
            if (layer != layerText)
            {
                layerText = layer;
                layerLabel.text = layer;
                layerLabel.style.color = !alive || broken ? UITheme.GoldHi : inv ? InvulnLayer : body.shield > 0 ? UITheme.JadeHi : body.armor > 0 ? HudArt.ArmorHi : UITheme.HpHi;
            }
            float cur = alive ? (body.shield > 0 ? body.shield : body.armor > 0 ? body.armor : body.health) : 0;
            float max = alive ? (body.shield > 0 ? Mathf.Max(body.maxShield, body.shield) : body.armor > 0 ? body.maxArmor : body.maxHealth) : body.maxHealth;
            int ci = Mathf.CeilToInt(cur), mi = Mathf.RoundToInt(max);
            if (ci != numCur || mi != numMax)
            {
                numCur = ci;
                numMax = mi;
                numLabel.text = $"{HudArt.FormatNum(ci)} / {HudArt.FormatNum(mi)}";
            }

            // 首领死了：显示「已击破」后自动收起
            if (!alive)
            {
                if (!dead) MarkDead(now);
                else if (now - deadAt > DeadLinger) Close();
            }
        }
    }
}
