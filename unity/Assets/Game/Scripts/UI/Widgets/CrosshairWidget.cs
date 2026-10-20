using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 屏幕中心的动态准星（Three.js src/ui/Crosshair.ts 的准星部分 + css/combat.css .gf-xhair / .gf-hitmark）：
    ///   十字四线 + 中心点，间距 = 散布半角按当前视野投影成的像素（阻尼 28 跟随）；开镜时淡一半；
    ///   压到敌人身上变朱红（每 3 帧沿视线打一次射线，被墙挡住不算；近战形态改为「攻击距离内」）；
    ///   近战形态（碎刃「斩」等，<see cref="IWeaponHudSource.ModeId"/> = melee / hand / blade）：十字换成左右两道弧形括号，敌人在范围内时收紧；
    ///   换弹环（鎏金，按换弹进度顺时针）、蓄力环（淡紫，满蓄转金并脉动）/ 预热武器的转速环（橙 → 朱红）；
    ///   命中标记：普通（白，0.19 s）、暴击（金、略长，0.26 s）、击杀（朱红、加粗、放大回弹，0.42 s）。
    ///   灵宠的命中 / 击杀、持续伤害跳伤、衍生伤害（弹射、反应）不出命中标记。
    /// </summary>
    [HudWidget("crosshair", Order = 40)]
    public sealed class CrosshairWidget : HudWidget
    {
        enum HitKind { None = -1, Normal = 0, Crit = 1, Kill = 2 }

        const float MeleeRange = 3.4f, BracketSize = 420, TargetRange = 150;
        static readonly float[] HitAngles = { 45, 135, 225, 315 };

        VisualElement reticle, dot, hitmark;
        readonly VisualElement[] lines = new VisualElement[4];
        readonly VisualElement[] hitLines = new VisualElement[4];
        ArcElement bracketL, bracketR;
        RingElement reload, charge;

        float gap = -1, shownGap = -1, hitAt = -10, reticleAlpha = -1;
        HitKind hitKind = HitKind.None, shownKind = HitKind.None;
        bool onTarget, melee, hitActive;
        int reloadQ = -2, chargeQ = -2;
        string chargeMode = "";
        readonly RaycastHit[] rayBuf = new RaycastHit[16];

        /// <summary>准星压在敌人身上（测试用）</summary>
        public bool OnTarget => onTarget;

        /// <summary>藏起十字 / 括号（狙击镜遮罩 WC1 开镜时设；换弹环、蓄力环、命中标记照常）</summary>
        public bool Suppressed { get; set; }

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-xhair");
            reticle = HudArt.El("sf-xhair__reticle", root);
            for (int i = 0; i < 4; i++)
            {
                lines[i] = HudArt.El("sf-xhair__line " + (i % 2 == 0 ? "sf-xhair__line--v" : "sf-xhair__line--h"), reticle);
            }
            dot = HudArt.El("sf-xhair__dot", reticle);
            bracketL = new ArcElement();
            bracketR = new ArcElement();
            foreach (var b in new[] { bracketL, bracketR })
            {
                b.AddToClassList("sf-xhair__bracket");
                b.style.width = b.style.height = BracketSize;
                b.style.left = b.style.top = -BracketSize * 0.5f;
                b.Color = HudArt.WithAlpha(HudArt.Reticle, 0.85f);
                HudArt.Show(b, false);
                reticle.Add(b);
            }

            reload = new RingElement(2.4f) { Track = Color.clear, Color = UITheme.GoldHi };
            reload.AddToClassList("sf-xhair__reload");
            reload.style.opacity = 0;
            root.Add(reload);
            charge = new RingElement(3f) { Track = new Color(1f, 0.976f, 0.933f, 0.16f), Color = new Color(0.886f, 0.831f, 1f), RoundCap = false };
            charge.AddToClassList("sf-xhair__charge");
            HudArt.Show(charge, false);
            root.Add(charge);

            hitmark = HudArt.El("sf-hitmark", root);
            for (int i = 0; i < 4; i++)
            {
                hitLines[i] = HudArt.El("sf-hitmark__l", hitmark);
                HudArt.Origin(hitLines[i], 50, 50);
                hitLines[i].style.rotate = new Rotate(Angle.Degrees(HitAngles[i]));
            }
            LayoutHitLines(HitKind.Normal);
            hitmark.style.opacity = 0;
            return root;
        }

        protected override void OnAttach()
        {
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.EnemyKilled += OnKilled;
        }

        protected override void OnDetach()
        {
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.EnemyKilled -= OnKilled;
        }

        public override void ResetState()
        {
            hitActive = false;
            hitKind = shownKind = HitKind.None;
            hitmark.style.opacity = 0;
            gap = shownGap = -1;
            onTarget = false;
        }

        // ───────────── 命中标记 ─────────────

        /// <summary>这一下算不算玩家的命中（标记 / 音效）：灵宠、持续伤害跳伤、衍生伤害、静默处决都不算</summary>
        public static bool CountsAsPlayerHit(in DamageInfo info) =>
            info.source != DamageSource.Status && info.source != DamageSource.Pet && info.source != DamageSource.Enemy && info.source != DamageSource.Environment
            && info.depth == 0 && !info.reaction && !info.Has(DamageTag.Purge) && !(info.instigator is Pet);

        void OnDamaged(in HitEvent e)
        {
            if (!CountsAsPlayerHit(e.info) || !(e.result.total > 0) || e.result.killed) return;
            float now = Time.unscaledTime;
            // 击杀标记显示期间不被普通命中覆盖；暴击标记 0.09 s 内不被普通命中覆盖
            if (hitKind == HitKind.Kill && now - hitAt < 0.26f) return;
            var kind = e.result.crit ? HitKind.Crit : HitKind.Normal;
            if (hitKind == HitKind.Crit && kind == HitKind.Normal && now - hitAt < 0.09f) return;
            hitKind = kind;
            hitAt = now;
            hitActive = true;
        }

        void OnKilled(in KillEvent e)
        {
            if (e.info.source == DamageSource.Pet || e.info.instigator is Pet || e.info.Has(DamageTag.Purge)) return;
            hitKind = HitKind.Kill;
            hitAt = Time.unscaledTime;
            hitActive = true;
        }

        /// <summary>按标记种类摆四道短线：普通 2×9、暴击 2×11（金）、击杀 3×13（朱红），离中心 12</summary>
        void LayoutHitLines(HitKind kind)
        {
            float w = kind == HitKind.Kill ? 3 : 2, h = kind == HitKind.Kill ? 13 : kind == HitKind.Crit ? 11 : 9;
            var c = kind == HitKind.Kill ? UITheme.CinnabarHi : kind == HitKind.Crit ? UITheme.GoldHi : Color.white;
            for (int i = 0; i < 4; i++)
            {
                var l = hitLines[i];
                // 带 1 px 黑描边：元素比线宽各大 2
                l.style.width = w + 2;
                l.style.height = h + 2;
                l.style.left = 17 - (w + 2) * 0.5f;
                l.style.top = 17 - (h + 2) * 0.5f;
                l.style.backgroundColor = c;
                float a = HitAngles[i] * Mathf.Deg2Rad;
                l.style.translate = new Translate(Mathf.Sin(a) * 12, -Mathf.Cos(a) * 12);
            }
        }

        void UpdateHitMarker(float now)
        {
            if (!hitActive) return;
            bool kill = hitKind == HitKind.Kill;
            float dur = kill ? 0.42f : hitKind == HitKind.Crit ? 0.26f : 0.19f;
            float e = (now - hitAt) / dur;
            if (e >= 1 || e < 0)
            {
                hitActive = false;
                hitmark.style.opacity = 0;
                return;
            }
            if (hitKind != shownKind)
            {
                shownKind = hitKind;
                LayoutHitLines(hitKind);
            }
            float s = kill ? 1.5f - 0.35f * Mathf.Min(1, e * 3) : hitKind == HitKind.Crit ? 1.2f - 0.2f * e : 1 + 0.12f * (1 - e);
            hitmark.style.opacity = 1 - e * e;
            hitmark.style.scale = new Scale(new Vector3(s, s, 1));
        }

        // ───────────── 准星 ─────────────

        public override void Tick(in HudFrame f)
        {
            var src = Ctx.WeaponHud;
            var cam = Ctx.Cam;
            bool alive = Ctx.Vitals && !Ctx.Vitals.Dead;
            Visible = src != null && cam && Ctx.Vitals;
            if (src == null || !cam) return;
            float now = f.unscaledTime;

            string mode = src.ModeId ?? "";
            bool isMelee = mode == "melee" || mode == "hand" || mode == "blade" || mode == "slash";
            if (isMelee != melee)
            {
                melee = isMelee;
                foreach (var l in lines) HudArt.Show(l, !melee);
                HudArt.Show(dot, !melee);
                HudArt.Show(bracketL, melee);
                HudArt.Show(bracketR, melee);
                shownGap = -1;
            }

            // 压到敌人身上（每 3 帧一次；暂停 / 阵亡不测）
            if (f.frame % 3 == 0)
            {
                bool on = f.playing && alive && DetectTarget(isMelee ? MeleeRange : TargetRange);
                if (on != onTarget)
                {
                    onTarget = on;
                    var c = on ? HudArt.ReticleTarget : HudArt.Reticle;
                    foreach (var l in lines) l.style.backgroundColor = c;
                    dot.style.backgroundColor = c;
                    bracketL.Color = bracketR.Color = on ? HudArt.ReticleTarget : HudArt.WithAlpha(HudArt.Reticle, 0.85f);
                }
            }

            // 散布 → 像素（按竖直视野投影，面板高度的一半 = 半视野）
            float spread = Mathf.Max(0, src.Spread);
            float halfFov = cam.fieldOfView * 0.5f * Mathf.Deg2Rad;
            float px = Mathf.Tan(Mathf.Min(spread, 1.2f)) / Mathf.Tan(halfFov) * Ctx.PanelSize.y * 0.5f;
            float target = Mathf.Clamp(4 + px - (melee && onTarget ? 4 : 0), 4, 180);
            gap = gap < 0 ? target : HudArt.Damp(gap, target, 28, f.unscaledDt);
            if (Mathf.Abs(gap - shownGap) > 0.25f)
            {
                shownGap = gap;
                if (melee)
                {
                    float inset = BracketSize * 0.5f - (gap + 12);
                    bracketL.Set(180, 32, 0.25f, 2.5f, bracketL.Color, inset);
                    bracketR.Set(0, 32, 0.25f, 2.5f, bracketR.Color, inset);
                }
                else
                {
                    // 线 2×10 + 1 px 描边（元素 4×12），中心在 (0, 0)
                    lines[0].style.translate = new Translate(-2, -gap - 12);
                    lines[2].style.translate = new Translate(-2, gap);
                    lines[1].style.translate = new Translate(gap, -2);
                    lines[3].style.translate = new Translate(-gap - 12, -2);
                }
            }
            float ra = Suppressed ? 0 : Mathf.Round((1 - src.Aim * 0.5f) * 50) / 50;
            if (!Mathf.Approximately(ra, reticleAlpha))
            {
                reticleAlpha = ra;
                reticle.style.opacity = ra;
            }

            // 换弹环
            int rq = src.Reloading ? Mathf.RoundToInt(Mathf.Clamp01(src.ReloadProgress) * 100) : -1;
            if (rq != reloadQ)
            {
                if ((rq >= 0) != (reloadQ >= 0)) reload.style.opacity = rq >= 0 ? 0.9f : 0;
                reloadQ = rq;
                if (rq >= 0) reload.Progress = rq / 100f;
            }

            // 蓄力环 / 转速环：只有真正蓄满才显示满格
            bool charging = src.Charge > 0.001f;
            bool heat = !charging && src.Heat > 0.001f && mode == "spinup";
            string cm = charging ? "charge" : heat ? "heat" : "";
            float v = charging ? src.Charge : heat ? src.Heat : 0;
            bool full = charging ? src.ChargeFull || v >= 1 : heat && v >= 0.999f;
            int cq = cm.Length == 0 ? 0 : full ? 100 : Mathf.Clamp(Mathf.RoundToInt(v * 100), 1, 99);
            if (cq != chargeQ || cm != chargeMode)
            {
                if ((cq > 0) != (chargeQ > 0)) HudArt.Show(charge, cq > 0);
                chargeQ = cq;
                chargeMode = cm;
                charge.Progress = cq / 100f;
                charge.Color = heat ? Color.Lerp(new Color(1f, 0.62f, 0.25f), UITheme.CinnabarHi, cq / 100f)
                    : full ? HudArt.ArmorHi : new Color(0.886f, 0.831f, 1f);
                if (!full) charge.style.scale = StyleKeyword.Null;
            }
            if (cq >= 100 && charging)
            {
                // 满蓄：0.45 s 往返脉动 1 → 1.08
                float k = 0.5f + 0.5f * Mathf.Sin(now * Mathf.PI / 0.45f);
                charge.style.scale = new Scale(Vector3.one * (1 + 0.08f * k));
            }

            UpdateHitMarker(now);
        }

        /// <summary>沿瞄准线（不抖的眼睛节点）第一个挡住的东西是活着、可选中的敌人（自己的碰撞体跳过）</summary>
        bool DetectTarget(float range)
        {
            var cam = Ctx.Cam;
            var self = Ctx.Vitals ? Ctx.Vitals.transform : null;
            // 不抖的瞄准节点（motor.eye；F3 起渲染相机挂在它下面、会晃）
            var motor = Ctx.Motor;
            var eye = motor && motor.eye ? motor.eye : Ctx.Weapons && Ctx.Weapons.eye ? Ctx.Weapons.eye.transform : cam.transform;
            int n = Physics.RaycastNonAlloc(eye.position, eye.forward, rayBuf, range, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            float best = float.MaxValue;
            Collider hitCol = null;
            for (int i = 0; i < n; i++)
            {
                var h = rayBuf[i];
                if (!h.collider || h.distance >= best) continue;
                if (self && h.collider.transform.IsChildOf(self)) continue;
                best = h.distance;
                hitCol = h.collider;
            }
            if (!hitCol) return false;
            var hb = hitCol.GetComponent<Hitbox>();
            var d = hb ? hb.owner : hitCol.GetComponentInParent<Damageable>();
            return d && !d.Dead && !d.untargetable;
        }
    }
}
