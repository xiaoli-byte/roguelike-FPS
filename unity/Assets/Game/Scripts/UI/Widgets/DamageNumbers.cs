using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 伤害数字与世界浮字（Three.js src/fx/DamageNumbers.ts + src/combat/Feedback.ts 的聚合规则；docs/unity-parity.md 3.2 / 3.12 / U3）：
    /// UI Toolkit 的 Label 对象池（80 个，SDF 数字字体），每帧把世界锚点投影到 HUD 面板，上浮 + 随机漂移 + 淡出，相机背后 / 屏外隐藏。
    ///   聚合：同一帧打在同一个敌人、同一层、同一元素、同为 / 同不为持续伤害的命中先合成一笔（霰弹 9 颗弹丸 = 一个数字）；
    ///     再按「同一个目标」并进还在合并窗口里的旧数字（直接命中 0.45 s；持续伤害跳伤间隔 ≤ 0.75 s、最长 4 s），合并时弹一下、锚点向新命中点靠拢——
    ///     Three.js 没有目标身份只能按距离 / 跳伤节拍猜，这里直接认 <see cref="Damageable"/>，挨在一起的两个敌人不会被加到一起。
    ///   每帧最多新出 <see cref="MaxSpawnPerFrame"/> 个（多出来的并不进去就丢掉），池满了回收最老的。
    ///   颜色：打在护盾层青、护甲层金（按承受份额最大的层）、生命层白；带元素的取元素色；无元素的暴击亮金；免疫灰、格挡淡蓝灰；
    ///   字号 / 动画：暴击更大、金色描边发光、弹跳缩放；持续伤害小一号、压暗、半透明、不弹跳，只上浮一点后停住、锚点平滑跟随目标；
    ///   处决、静默处决不出数字；同一敌人的「免疫」0.4 s 内只出一次。
    ///   开关：<see cref="GameSettings.DamageNumbers"/> 关掉时清掉并不再出伤害数字（反应名、灵宠台词这类世界浮字照常）。
    ///   世界浮字（<see cref="GameUI.FloatText"/>：反应名「焚雷」、灵宠台词、「格挡」）：不参与合并；scale ≥ 1.25 的加墨底描边框（反应名），≥ 1.6 再大一号（归墟）。
    /// 时间用缩放时间（暂停时数字停住，同 Three.js）。
    /// </summary>
    [HudWidget("damage-numbers", Order = 5)]
    public sealed class DamageNumbers : HudWidget
    {
        /// <summary>数字种类：按层（生命 / 护盾 / 护甲）、免疫、格挡、世界浮字</summary>
        public enum Kind { Health, Shield, Armor, Immune, Blocked, Text }

        public const int PoolSize = 80, MaxSpawnPerFrame = 24;
        const int MaxPending = 48;
        const float MergeWindow = 0.45f, DotGap = 0.75f, DotMaxAge = 4f, DotHold = 0.8f, DotFade = 0.3f, DotRise = 24, DotRiseTime = 0.5f, DotDrift = 32;
        const float DotAlpha = 0.8f, DotDim = 0.78f, DotFollow = 10f, TextLife = 0.9f, ImmuneGap = 0.4f, MaxShown = 999999;

        static readonly Color ShieldColor = HudArt.ShieldBlue, ArmorColor = HudArt.ArmorGold, ImmuneColor = Hex.Rgb(0xb9bec8), BlockedColor = Hex.Rgb(0xc9d0e0);
        static readonly Color CritColor = Hex.Rgb(0xffe46b), ReactionColor = Hex.Rgb(0xffd84a);

        struct Pending
        {
            public Damageable target;
            public Vector3 pos;
            public float amount;
            public bool crit, dot;
            public Element element;
            public Kind kind;
        }

        sealed class DN
        {
            public VisualElement anchor;
            public Label label;
            public bool active, shown, crit, dot, boxed;
            public Kind kind;
            public Element element;
            public Damageable target;
            public Vector3 pos, goal, offset;
            public float age, life, pop, driftX, rise, amount, lastHit, opacity = -1, scale = -1;
            public int stamp;
            public string cls = "";
            public UIFontRole font = UIFontRole.Body;
        }

        readonly DN[] pool = new DN[PoolSize];
        readonly List<Pending> pending = new(MaxPending);
        readonly Dictionary<Damageable, float> immuneAt = new();
        int stamp, spawnedThisFrame, frame = -1, activeCount;

        /// <summary>统计（测试 / 调试叠层用）：出过的数字、并进旧数字的次数、因每帧上限丢掉的次数</summary>
        public int Spawned { get; private set; }
        public int Merged { get; private set; }
        public int Dropped { get; private set; }
        /// <summary>正在显示的数字个数</summary>
        public int ActiveCount => activeCount;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-dn-layer");
            for (int i = 0; i < PoolSize; i++)
            {
                var anchor = HudArt.El("sf-dn-anchor", root);
                anchor.style.display = DisplayStyle.None;
                // 每帧改位移 / 缩放 / 透明度：交给着色器（I4：不然每帧重排顶点，密集战斗时 UI 重绘 1 ms 以上）
                anchor.usageHints = UsageHints.DynamicTransform;
                var label = HudArt.Text("sf-dn", anchor, "", UIFontRole.Number);
                label.usageHints = UsageHints.DynamicTransform | UsageHints.DynamicColor;
                pool[i] = new DN { anchor = anchor, label = label, font = UIFontRole.Number };
            }
            return root;
        }

        protected override void OnAttach() => GameEvents.EnemyDamaged += OnDamaged;
        protected override void OnDetach() => GameEvents.EnemyDamaged -= OnDamaged;

        public override void ResetState() => Clear(true);

        // ───────────── 规则（EditMode 测试也用）─────────────

        /// <summary>承受份额最大的层（同份额取先打到的那层；伤害数字配色用，同 Three.js mainLayer）</summary>
        public static Kind MainLayer(in DamageResult r)
        {
            var k = r.firstLayer == DamageLayer.Shield ? Kind.Shield : r.firstLayer == DamageLayer.Armor ? Kind.Armor : Kind.Health;
            float best = r.firstLayer == DamageLayer.Shield ? r.shield : r.firstLayer == DamageLayer.Armor ? r.armor : r.health;
            if (r.shield > best) { best = r.shield; k = Kind.Shield; }
            if (r.armor > best) { best = r.armor; k = Kind.Armor; }
            if (r.health > best) k = Kind.Health;
            return k;
        }

        /// <summary>数字颜色：护盾 / 护甲 / 免疫 / 格挡按种类；生命层带元素取元素色；无元素暴击亮金；持续伤害压暗</summary>
        public static Color ColorFor(Kind kind, Element element, bool crit, bool dot)
        {
            Color c = kind switch
            {
                Kind.Shield => ShieldColor,
                Kind.Armor => ArmorColor,
                Kind.Immune => ImmuneColor,
                Kind.Blocked => BlockedColor,
                _ => element != Element.None ? DamageTable.ElementColor(element) : crit ? CritColor : Color.white,
            };
            if (dot) c = new Color(c.r * DotDim, c.g * DotDim, c.b * DotDim, 1);
            c.a = 1;
            return c;
        }

        /// <summary>数字文字：免疫 / 格挡；不足 1 显示 1；上限 999999</summary>
        public static string Format(float amount, Kind kind) => kind switch
        {
            Kind.Immune => "免疫",
            Kind.Blocked => "格挡",
            _ => (amount < 1 ? 1 : Mathf.RoundToInt(Mathf.Min(amount, MaxShown))).ToString(),
        };

        // ───────────── 入口 ─────────────

        void OnDamaged(in HitEvent e)
        {
            if (!GameSettings.DamageNumbers.Bool) return;
            var info = e.info;
            var r = e.result;
            if (DamageCalc.IsExecute(info)) return;
            var t = e.enemy;
            var pos = info.point;
            if (pos == Vector3.zero && t) pos = ProjectileTargeting.Center(t) + Vector3.up * 0.35f;
            if (!float.IsFinite(pos.x + pos.y + pos.z)) return;
            if (r.immune)
            {
                if (t)
                {
                    float now = Time.time;
                    if (immuneAt.TryGetValue(t, out var last) && now - last < ImmuneGap && now >= last) return;
                    if (immuneAt.Count > 256) immuneAt.Clear();
                    immuneAt[t] = now;
                }
                Queue(t, pos, 0, false, Element.None, Kind.Immune, false);
                return;
            }
            if (r.blocked && r.total < 1)
            {
                Queue(t, pos, 0, false, Element.None, Kind.Blocked, false);
                return;
            }
            float amount = r.effective > 0 ? r.effective : r.total;
            if (!(amount > 0)) return;
            Queue(t, pos, amount, r.crit, info.element, MainLayer(r), DamageCalc.IsDot(info));
        }

        /// <summary>排队一个伤害数字（同帧同目标同层同元素、同为 / 同不为持续伤害的合成一笔，本帧 Tick 时刷出）</summary>
        public void Queue(Damageable target, Vector3 pos, float amount, bool crit, Element element, Kind kind, bool dot)
        {
            if (!float.IsFinite(amount) || amount < 0) return;
            amount = Mathf.Min(amount, MaxShown);
            if (kind != Kind.Immune && kind != Kind.Blocked && target)
                for (int i = 0; i < pending.Count; i++)
                {
                    var p = pending[i];
                    if (p.target != target || p.kind != kind || p.element != element || p.dot != dot) continue;
                    p.amount = Mathf.Min(MaxShown, p.amount + amount);
                    p.crit |= crit;
                    pending[i] = p;
                    return;
                }
            if (pending.Count >= MaxPending) Flush();
            pending.Add(new Pending { target = target, pos = pos, amount = amount, crit = crit, element = element, kind = kind, dot = dot });
        }

        /// <summary>世界浮字（反应名、灵宠台词、「格挡」）：不合并；scale ≥ 1.25 加墨底描边框，≥ 1.6 大号</summary>
        public void Float(Vector3 world, string text, Color c, float scale = 1.3f)
        {
            if (string.IsNullOrEmpty(text) || !float.IsFinite(world.x + world.y + world.z)) return;
            var d = Take();
            bool big = scale >= 1.6f, boxed = scale >= 1.25f;
            d.active = true;
            d.target = null;
            d.offset = new Vector3(Random.Range(-0.1f, 0.1f), 0, Random.Range(-0.1f, 0.1f));
            d.pos = d.goal = world + d.offset;
            d.age = d.pop = d.lastHit = 0;
            d.life = TextLife * (boxed ? 1f : 1.2f);
            d.driftX = Random.Range(-12f, 12f);
            d.rise = big ? 46 : 40;
            d.crit = d.dot = false;
            d.kind = Kind.Text;
            d.element = Element.None;
            d.amount = 0;
            d.stamp = ++stamp;
            d.boxed = boxed;
            SetClass(d, "sf-dn" + (boxed ? " sf-dn--text" : " sf-dn--say") + (big ? " sf-dn--big" : scale < 1 ? " sf-dn--small" : ""));
            SetFont(d, UIFontRole.Title);
            var col = c.a > 0 ? new Color(c.r, c.g, c.b, 1) : ReactionColor;
            d.label.style.color = col;
            if (boxed) d.label.style.borderTopColor = d.label.style.borderBottomColor = d.label.style.borderLeftColor = d.label.style.borderRightColor = col;
            d.label.text = text;
            d.opacity = d.scale = -1;
        }

        /// <summary>清掉（textToo = 连世界浮字一起）</summary>
        public void Clear(bool textToo)
        {
            pending.Clear();
            foreach (var d in pool)
                if (d.active && (textToo || d.kind != Kind.Text)) Hide(d);
        }

        // ───────────── 生成 / 合并 ─────────────

        void Flush()
        {
            for (int i = 0; i < pending.Count; i++) SpawnOrMerge(pending[i]);
            pending.Clear();
        }

        void SpawnOrMerge(in Pending p)
        {
            if (p.kind != Kind.Immune && p.kind != Kind.Blocked && p.target)
            {
                DN best = null;
                foreach (var d in pool)
                {
                    if (!d.active || d.target != p.target || d.kind != p.kind || d.dot != p.dot || d.crit != p.crit || d.element != p.element) continue;
                    if (p.dot)
                    {
                        if (d.age > DotMaxAge || d.age - d.lastHit > DotGap) continue;
                    }
                    else if (d.age > MergeWindow) continue;
                    if (best == null || d.stamp > best.stamp) best = d;
                }
                if (best != null)
                {
                    Merge(best, p);
                    return;
                }
            }
            if (spawnedThisFrame >= MaxSpawnPerFrame)
            {
                Dropped++;
                return;
            }
            spawnedThisFrame++;
            Spawn(p);
        }

        void Spawn(in Pending p)
        {
            var d = Take();
            bool crit = p.crit && p.kind != Kind.Immune && p.kind != Kind.Blocked;
            bool dot = p.dot && !crit && p.kind != Kind.Immune;
            d.active = true;
            d.target = p.target;
            d.offset = new Vector3(Random.Range(-0.175f, 0.175f), Random.Range(-0.1f, 0.1f) + 0.15f, Random.Range(-0.175f, 0.175f));
            d.pos = d.goal = p.pos + d.offset;
            d.age = d.pop = d.lastHit = 0;
            d.life = dot ? DotHold : crit ? 1.2f : p.kind is Kind.Immune or Kind.Blocked ? 0.8f : 0.95f;
            d.driftX = Random.Range(-0.5f, 0.5f) * (dot ? DotDrift : crit ? 70 : 55);
            d.rise = dot ? DotRise : crit ? 70 : 58;
            d.crit = crit;
            d.dot = dot;
            d.kind = p.kind;
            d.element = p.element;
            d.amount = p.kind is Kind.Immune or Kind.Blocked ? 0 : p.amount;
            d.stamp = ++stamp;
            d.boxed = false;
            string cls = "sf-dn";
            if (crit) cls += " sf-dn--crit";
            else if (dot) cls += " sf-dn--dot";
            else if (p.kind is Kind.Immune or Kind.Blocked) cls += " sf-dn--immune";
            SetClass(d, cls);
            SetFont(d, p.kind is Kind.Immune or Kind.Blocked ? UIFontRole.Title : UIFontRole.Number);
            d.label.style.color = ColorFor(p.kind, p.element, crit, dot);
            d.label.text = Format(d.amount, p.kind);
            d.opacity = d.scale = -1;
            Spawned++;
        }

        void Merge(DN d, in Pending p)
        {
            d.amount = Mathf.Min(MaxShown, d.amount + p.amount);
            d.label.text = Format(d.amount, d.kind);
            Merged++;
            if (d.dot)
            {
                // 持续伤害：不弹跳；最后一跳后再停留 DotHold 秒；锚点平滑跟上
                d.life = Mathf.Max(d.life, d.age + DotHold);
                d.lastHit = d.age;
                d.goal = p.pos + d.offset;
                return;
            }
            d.pop = 0;
            d.life = Mathf.Min(d.life + 0.12f, d.crit ? 1.6f : 1.3f);
            d.lastHit = d.age;
            // 锚点向最新命中点靠拢一半：跟得上移动的敌人，合并时的弹跳掩盖了这一下位移
            var half = (d.pos - d.offset - p.pos) * 0.5f;
            d.pos = d.goal = d.pos - half;
        }

        DN Take()
        {
            DN oldest = pool[0];
            foreach (var d in pool)
            {
                if (!d.active) return d;
                if (d.stamp < oldest.stamp) oldest = d;
            }
            Hide(oldest);
            return oldest;
        }

        void Hide(DN d)
        {
            if (!d.active) return;
            d.active = false;
            d.target = null;
            SetShown(d, false);
        }

        void SetShown(DN d, bool on)
        {
            if (d.shown == on) return;
            d.shown = on;
            d.anchor.style.display = on ? DisplayStyle.Flex : DisplayStyle.None;
            activeCount += on ? 1 : -1;
        }

        static void SetClass(DN d, string cls)
        {
            if (d.cls == cls) return;
            if (d.cls.Length > 0)
                foreach (var c in d.cls.Split(' '))
                    if (c.Length > 0) d.label.RemoveFromClassList(c);
            HudArt.AddClasses(d.label, cls);
            d.cls = cls;
        }

        static void SetFont(DN d, UIFontRole role)
        {
            if (d.font == role) return;
            d.font = role;
            var fa = UIFonts.Get(role);
            if (fa) d.label.style.unityFontDefinition = FontDefinition.FromSDFFont(fa);
        }

        // ───────────── 每帧 ─────────────

        public override void Tick(in HudFrame f)
        {
            if (f.frame != frame)
            {
                frame = f.frame;
                spawnedThisFrame = 0;
            }
            if (!GameSettings.DamageNumbers.Bool)
            {
                pending.Clear();
                Clear(false);
            }
            else Flush();

            var cam = Ctx.Cam;
            if (!cam)
            {
                Clear(true);
                return;
            }
            float dt = f.dt;
            var camPos = cam.transform.position;
            var size = Ctx.PanelSize;
            foreach (var d in pool)
            {
                if (!d.active) continue;
                d.age += dt;
                d.pop += dt;
                if (d.age >= d.life)
                {
                    Hide(d);
                    continue;
                }
                if (d.dot && dt > 0)
                {
                    float k = 1 - Mathf.Exp(-dt * DotFollow);
                    d.pos += (d.goal - d.pos) * k;
                }
                if (!Ctx.Project(d.pos, out var p, out _))
                {
                    SetShown(d, false);
                    continue;
                }
                if (p.x < -0.1f * size.x || p.x > 1.1f * size.x || p.y < -0.1f * size.y || p.y > 1.1f * size.y)
                {
                    SetShown(d, false);
                    continue;
                }
                float dist = Vector3.Distance(d.pos, camPos);
                float distScale = Mathf.Clamp(1.25f - dist * 0.014f, 0.62f, 1.15f);
                float s, a;
                if (d.dot)
                {
                    // 只在出生后小幅上浮然后停住（合并会延长寿命，位移不能跟着寿命走）；不弹跳；更暗
                    float r = Mathf.Min(1, d.age / DotRiseTime);
                    float e = 1 - (1 - r) * (1 - r) * (1 - r);
                    p.x += d.driftX * e;
                    p.y -= d.rise * e;
                    s = distScale;
                    a = Mathf.Min(1, d.age / 0.08f) * Mathf.Min(1, (d.life - d.age) / DotFade) * DotAlpha;
                }
                else
                {
                    float t = d.age / d.life;
                    float e = 1 - (1 - t) * (1 - t) * (1 - t);
                    p.x += d.driftX * e;
                    p.y -= d.rise * e;
                    float q = d.pop;
                    if (d.crit) s = q < 0.07f ? 0.5f + 1.4f * (q / 0.07f) : 1 + 0.9f * Mathf.Exp(-(q - 0.07f) * 9) * Mathf.Cos((q - 0.07f) * 24);
                    else s = q < 0.05f ? 0.7f + 0.65f * (q / 0.05f) : 1 + 0.35f * Mathf.Exp(-(q - 0.05f) * 14);
                    s *= d.kind == Kind.Text ? 1 : distScale;
                    a = t < 0.62f ? 1 : 1 - (t - 0.62f) / 0.38f;
                }
                SetShown(d, true);
                d.anchor.style.translate = new Translate(p.x, p.y);
                if (Mathf.Abs(s - d.scale) > 0.004f)
                {
                    d.scale = s;
                    d.label.style.scale = new Scale(new Vector3(s, s, 1));
                }
                float ar = Mathf.Round(a * 50) / 50;
                if (!Mathf.Approximately(ar, d.opacity))
                {
                    d.opacity = ar;
                    d.label.style.opacity = ar;
                }
            }
        }
    }
}
