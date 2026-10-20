using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人头顶血条（Three.js src/ui/EnemyBars.ts + css/combat.css .gf-ebar；docs/unity-parity.md 3.12 / U3）：
    ///   对象：活着、可选中的非首领敌人里，精英或任一层没满的（<see cref="EnemyRegistry.Live"/>），45 m 内、在视野前方，最多 28 条（元素池复用，不每帧重建）。
    ///   内容：精英名（标题字体、鎏金；带词缀时前面一枚词缀色标签）、状态小标（灼 / 雷 / 蚀 / 晕，带层数）、护盾 / 护甲细条、生命条（延迟掉血拖尾，精英加粗描金）。
    ///   元素反应提示：身上两种元素状态 = 可反应（小标 1.2 s 呼吸发光），三种 = 归墟就绪（紫光、0.6 s 急促）。
    ///   位置：投影头顶（碰撞体顶上 + 0.3 m），按距离缩放（13 / 距离，夹在 0.62–1.12，精英 ×1.12）；被墙挡住时半透明（每条约 0.13 s 测一次），40–45 m 渐隐。
    /// 词缀（EN4）：<see cref="AffixOf"/> 返回词缀 id，<see cref="AffixLabels"/> 给名字和颜色（同 Three.js AFFIX_LABELS），词缀单元登记即可。
    /// </summary>
    [HudWidget("enemy-bars", Order = 0)]
    public sealed class EnemyBars : HudWidget
    {
        public const int MaxBars = 28;
        public const float MaxDist = 45;
        const float TrailHold = 0.38f, TrailRate = 1.1f, HeadLift = 0.3f;

        /// <summary>精英词缀 id（EN4 的词缀框架设置；没有词缀返回 null / 空）</summary>
        public static Func<EnemyAI, string> AffixOf;

        /// <summary>词缀显示：名字、颜色、说明（同 Three.js AFFIX_LABELS；新词缀在这里加一条）</summary>
        public static readonly Dictionary<string, (string name, Color color, string hint)> AffixLabels = new()
        {
            ["swift"] = ("迅捷", Hex.Rgb(0x49d8ff), "移速与攻速提高"),
            ["shielded"] = ("坚盾", Hex.Rgb(0x6f9dff), "额外护盾，脱战回盾"),
            ["volatile"] = ("爆裂", Hex.Rgb(0xff7a3a), "死亡时爆炸，别贴身击杀"),
            ["frenzied"] = ("狂暴", Hex.Rgb(0xff4a32), "低血量时狂暴"),
        };

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => AffixOf = null;

        /// <summary>状态小标（同 Three.js STATUS_BADGES）</summary>
        static readonly (StatusId id, string glyph, Color color)[] Badges =
        {
            (StatusId.Burn, "灼", DamageTable.ElementColor(Element.Fire)),
            (StatusId.Shock, "雷", DamageTable.ElementColor(Element.Shock)),
            (StatusId.Corrode, "蚀", DamageTable.ElementColor(Element.Corrode)),
            (StatusId.Stun, "晕", HudArt.StunBadge),
        };

        sealed class Slot
        {
            public VisualElement anchor, bar, nameRow, status, shieldRow, shieldFill, armorRow, armorFill, hpRow, hpFill, hpTrail;
            public Label nameText, affix;
            public readonly VisualElement[] badges = new VisualElement[4], glows = new VisualElement[4];
            public readonly Label[] stacks = new Label[4];
            public readonly int[] stackV = new int[4];
            public EnemyAI enemy;
            public Collider col;
            public int stamp, statusMask, react;
            public float x = float.NaN, y, scale = -1, opacity = -1, shield = -1, armor = -1, hp = -1, trail = 1, trailHold, occlNext;
            public bool hasShield = true, hasArmor = true, occluded, elite;
            public string name = "\0", affixId = "\0";
        }

        readonly List<Slot> poolList = new();
        readonly List<Slot> active = new();
        readonly Dictionary<EnemyAI, Slot> byEnemy = new();
        VisualElement root;
        int stamp;

        /// <summary>正在显示的血条数（测试用）</summary>
        public int Count => active.Count;

        /// <summary>某个敌人有没有头顶血条（测试用）</summary>
        public bool Has(EnemyAI e) => e && byEnemy.ContainsKey(e);

        protected override VisualElement Build()
        {
            root = HudArt.El("sf-ebars");
            return root;
        }

        public override void ResetState()
        {
            foreach (var s in active) Release(s);
            active.Clear();
            byEnemy.Clear();
        }

        public override void Tick(in HudFrame f)
        {
            var cam = Ctx.Cam;
            if (!cam || !Ctx.Vitals)
            {
                if (active.Count > 0) ResetState();
                return;
            }
            float now = f.unscaledTime;
            var camPos = cam.transform.position;
            var fwd = cam.transform.forward;
            float trailStep = Mathf.Min(0.1f, f.unscaledDt) * TrailRate;
            int st = ++stamp, shown = 0;
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count && shown < MaxBars; i++)
            {
                var e = live[i];
                if (!e) continue;
                var d = e.Health;
                if (!d || d.Dead || d.IsBoss || d.untargetable) continue;
                bool elite = d.rank == Rank.Elite || e.elite;
                bool damaged = d.health < d.maxHealth - 0.01f || d.shield < d.maxShield - 0.01f || d.armor < d.maxArmor - 0.01f;
                if (!elite && !damaged) continue;

                byEnemy.TryGetValue(e, out var slot);
                var col = slot != null ? slot.col : e.GetComponent<Collider>();
                var head = Head(e, col);
                var rel = head - camPos;
                float dist = rel.magnitude;
                if (dist > MaxDist || Vector3.Dot(rel, fwd) < 0.2f * dist) continue;
                if (!Ctx.Project(head, out var p, out _)) continue;
                var size = Ctx.PanelSize;
                if (p.x < -0.04f * size.x || p.x > 1.04f * size.x || p.y < -0.04f * size.y || p.y > 1.05f * size.y) continue;

                if (slot == null)
                {
                    slot = Acquire(e, col, now);
                    byEnemy[e] = slot;
                    active.Add(slot);
                }
                slot.stamp = st;
                shown++;

                float scale = Mathf.Clamp(13f / Mathf.Max(1, dist), 0.62f, 1.12f) * (slot.elite ? 1.12f : 1f);
                if (float.IsNaN(slot.x) || Mathf.Abs(p.x - slot.x) > 0.4f || Mathf.Abs(p.y - slot.y) > 0.4f)
                {
                    slot.x = p.x;
                    slot.y = p.y;
                    slot.anchor.style.translate = new Translate(p.x, p.y);
                }
                if (Mathf.Abs(scale - slot.scale) > 0.01f)
                {
                    slot.scale = scale;
                    slot.bar.style.scale = new Scale(new Vector3(scale, scale, 1));
                }

                // 被墙挡住时半透明（每条约 0.13 s 测一次，错开）
                if (now >= slot.occlNext)
                {
                    slot.occlNext = now + 0.13f + (slot.GetHashCode() & 7) * 0.012f;
                    slot.occluded = Combat.Blocked(camPos, ProjectileTargeting.Center(d), col);
                }
                float fade = dist > MaxDist - 6 ? Mathf.Clamp01((MaxDist - dist) / 6) : 1;
                float op = (slot.occluded ? 0.35f : 1f) * fade;
                if (Mathf.Abs(op - slot.opacity) > 0.02f)
                {
                    slot.opacity = op;
                    slot.anchor.style.opacity = op;
                }
                SyncLayers(slot, d, now, trailStep);
                SyncStatus(slot, d, now);
            }

            // 回收本帧没用到的
            int j = 0;
            for (int i = 0; i < active.Count; i++)
            {
                var s = active[i];
                if (s.stamp == st) active[j++] = s;
                else
                {
                    if (s.enemy && byEnemy.TryGetValue(s.enemy, out var cur) && cur == s) byEnemy.Remove(s.enemy);
                    else RemoveStale(s);
                    Release(s);
                }
            }
            active.RemoveRange(j, active.Count - j);
        }

        void RemoveStale(Slot s)
        {
            // 敌人已销毁：字典键是假 null，按值找
            EnemyAI key = null;
            foreach (var kv in byEnemy)
                if (kv.Value == s)
                {
                    key = kv.Key;
                    break;
                }
            if (!ReferenceEquals(key, null)) byEnemy.Remove(key);
        }

        static Vector3 Head(EnemyAI e, Collider col)
        {
            if (col && col.enabled)
            {
                var b = col.bounds;
                return new Vector3(b.center.x, b.max.y + HeadLift, b.center.z);
            }
            return e.transform.position + Vector3.up * 2.1f;
        }

        void SyncLayers(Slot s, Damageable d, float now, float trailStep)
        {
            bool hasShield = d.maxShield > 0;
            if (hasShield != s.hasShield)
            {
                s.hasShield = hasShield;
                HudArt.Show(s.shieldRow, hasShield);
            }
            bool hasArmor = d.maxArmor > 0;
            if (hasArmor != s.hasArmor)
            {
                s.hasArmor = hasArmor;
                HudArt.Show(s.armorRow, hasArmor);
            }
            if (hasShield)
            {
                float v = Mathf.Clamp01(d.shield / d.maxShield);
                if (Mathf.Abs(v - s.shield) > 0.004f)
                {
                    s.shield = v;
                    HudArt.SetFill(s.shieldFill, v);
                }
            }
            if (hasArmor)
            {
                float v = Mathf.Clamp01(d.armor / d.maxArmor);
                if (Mathf.Abs(v - s.armor) > 0.004f)
                {
                    s.armor = v;
                    HudArt.SetFill(s.armorFill, v);
                }
            }
            float hp = Mathf.Clamp01(d.health / Mathf.Max(1, d.maxHealth));
            if (Mathf.Abs(hp - s.hp) > 0.002f)
            {
                if (hp < s.hp) s.trailHold = now + TrailHold;
                s.hp = hp;
                HudArt.SetFill(s.hpFill, hp);
            }
            float t = s.trail;
            if (t < hp) t = hp;
            else if (t > hp && now >= s.trailHold) t = Mathf.Max(hp, t - trailStep);
            if (!Mathf.Approximately(t, s.trail))
            {
                s.trail = t;
                HudArt.SetFill(s.hpTrail, t);
            }
        }

        void SyncStatus(Slot s, Damageable d, float now)
        {
            int mask = 0, elems = 0;
            for (int i = 0; i < Badges.Length; i++)
            {
                if (!EnemyStatus.TryGet(d, Badges[i].id, out var view)) continue;
                mask |= 1 << i;
                if (i < 3) elems++;
                int stacks = Badges[i].id == StatusId.Stun ? 0 : view.stacks;
                if (stacks != s.stackV[i])
                {
                    s.stackV[i] = stacks;
                    s.stacks[i].text = stacks > 1 ? stacks.ToString() : "";
                }
            }
            if (mask != s.statusMask)
            {
                for (int i = 0; i < Badges.Length; i++) HudArt.Show(s.badges[i], (mask & (1 << i)) != 0);
                HudArt.Show(s.status, mask != 0);
                s.statusMask = mask;
            }
            // 元素反应提示：两种相遇即可反应；三种齐聚再补一种就是「归墟」
            int react = elems >= 3 ? 2 : elems == 2 ? 1 : 0;
            if (react != s.react)
            {
                s.react = react;
                for (int i = 0; i < 3; i++)
                {
                    HudArt.Tint(s.glows[i], react == 2 ? HudArt.Primed : Badges[i].color);
                    if (react == 0) s.glows[i].style.opacity = 0;
                }
            }
            if (react > 0)
            {
                float period = react == 2 ? 0.6f : 1.2f;
                float a = 0.2f + 0.8f * (0.5f - 0.5f * Mathf.Cos(now * Mathf.PI * 2 / period));
                for (int i = 0; i < 3; i++) s.glows[i].style.opacity = a;
            }
        }

        Slot Acquire(EnemyAI e, Collider col, float now)
        {
            Slot s;
            if (poolList.Count > 0)
            {
                s = poolList[poolList.Count - 1];
                poolList.RemoveAt(poolList.Count - 1);
            }
            else s = Create();
            var d = e.Health;
            s.enemy = e;
            s.col = col;
            s.x = float.NaN;
            s.scale = s.opacity = -1;
            s.shield = s.armor = s.hp = -1;
            s.trail = Mathf.Clamp01(d.health / Mathf.Max(1, d.maxHealth));
            HudArt.SetFill(s.hpTrail, s.trail);
            s.trailHold = 0;
            s.hasShield = !(d.maxShield > 0);
            s.hasArmor = !(d.maxArmor > 0);
            s.occluded = false;
            s.occlNext = now;
            s.statusMask = -1;
            s.react = -1;
            for (int i = 0; i < 4; i++) s.stackV[i] = -1;

            s.elite = d.rank == Rank.Elite || e.elite;
            HudArt.Toggle(s.bar, "is-elite", s.elite);
            // 精英词缀：用词缀色单独标出（爆裂等词缀直接影响玩家怎么打）
            string affixId = s.elite ? AffixOf?.Invoke(e) ?? "" : "";
            (string name, Color color, string hint) info = default;
            bool hasAffix = affixId.Length > 0 && AffixLabels.TryGetValue(affixId, out info);
            if (affixId != s.affixId)
            {
                s.affixId = affixId;
                HudArt.Show(s.affix, hasAffix);
                if (hasAffix)
                {
                    s.affix.text = info.name;
                    s.affix.style.backgroundColor = info.color;
                }
            }
            string name = s.elite ? (string.IsNullOrEmpty(d.displayName) ? e.name : d.displayName) : "";
            // 名字里已经带了词缀（「精英·爆裂 沙匪刀客」）时去掉重复的词
            if (hasAffix && name.Contains(info.name)) name = name.Replace(info.name, "").Replace("· ", "·").Replace("  ", " ").Trim();
            if (name != s.name)
            {
                s.name = name;
                s.nameText.text = name;
            }
            HudArt.Show(s.nameRow, name.Length > 0 || hasAffix);
            s.anchor.style.display = DisplayStyle.Flex;
            return s;
        }

        void Release(Slot s)
        {
            s.enemy = null;
            s.col = null;
            s.anchor.style.display = DisplayStyle.None;
            poolList.Add(s);
        }

        Slot Create()
        {
            var s = new Slot();
            s.anchor = HudArt.El("sf-ebar-anchor", root);
            s.bar = HudArt.El("sf-ebar", s.anchor);
            HudArt.Origin(s.bar, 50, 100);
            s.nameRow = HudArt.El("sf-ebar__name", s.bar);
            s.affix = HudArt.Text("sf-ebar__affix", s.nameRow);
            HudArt.Show(s.affix, false);
            s.nameText = HudArt.Text("sf-ebar__nametext", s.nameRow, "", UIFontRole.Title);
            s.status = HudArt.El("sf-ebar__status", s.bar);
            for (int i = 0; i < Badges.Length; i++)
            {
                var b = HudArt.El("sf-ebar__badge", s.status);
                b.style.backgroundColor = Badges[i].color;
                var glow = HudArt.El("sf-ebar__glow", b);
                HudArt.Paint(glow, HudArt.Glow, Badges[i].color);
                glow.style.opacity = 0;
                HudArt.Text("sf-ebar__glyph", b, Badges[i].glyph, UIFontRole.Title);
                s.stacks[i] = HudArt.Text("sf-ebar__stacks", b, "", UIFontRole.Number);
                s.badges[i] = b;
                s.glows[i] = glow;
                HudArt.Show(b, false);
            }
            HudArt.Show(s.status, false);
            s.shieldRow = HudArt.El("sf-ebar__row sf-ebar__row--shield", s.bar);
            s.shieldFill = HudArt.Fill(s.shieldRow, null, UITheme.JadeHi);
            s.armorRow = HudArt.El("sf-ebar__row sf-ebar__row--armor", s.bar);
            s.armorFill = HudArt.Fill(s.armorRow, null, HudArt.ArmorHi);
            s.hpRow = HudArt.El("sf-ebar__row sf-ebar__row--hp", s.bar);
            s.hpTrail = HudArt.Fill(s.hpRow);
            s.hpTrail.style.backgroundColor = HudArt.Trail;
            s.hpFill = HudArt.Fill(s.hpRow, null, UITheme.HpHi);
            s.anchor.style.display = DisplayStyle.None;
            return s;
        }
    }
}
