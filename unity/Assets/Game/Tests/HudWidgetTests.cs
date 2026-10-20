using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// HUD 部件的契约与纯规则（docs/unity-parity.md U2 / U3）：[HudWidget] 登记齐全且 id 唯一；伤害数字的主层 / 配色 / 文字；
    /// 命中标记只认玩家的直接命中；冷却秒数格式；反应教学的「已教过」键与 Three.js 一致；旧接口首领源没有刻度。
    /// </summary>
    public sealed class HudWidgetTests
    {
        static readonly string[] Expected =
        {
            "vitals", "weapon", "skills", "info", "crosshair", "hurt", "prompt", "pet", "center-text",
            "damage-numbers", "enemy-bars", "boss-bar", "reaction-tips",
        };

        [Test]
        public void WidgetsRegisteredOnceEach()
        {
            var ids = HudWidgets.All.Select(e => e.attr.Id).ToList();
            CollectionAssert.AllItemsAreUnique(ids);
            foreach (var id in Expected) CollectionAssert.Contains(ids, id, $"缺 HUD 部件 {id}");
            Assert.That(HudWidgets.All.Single(e => e.attr.Id == "center-text").attr.Layer, Is.EqualTo(UILayer.Overlay));
            // 叠放：头顶血条最底、准星在四角之下、提示卡在四角之上
            int Order(string id) => HudWidgets.All.Single(e => e.attr.Id == id).attr.Order;
            Assert.That(Order("enemy-bars"), Is.LessThan(Order("damage-numbers")));
            Assert.That(Order("crosshair"), Is.LessThan(Order("vitals")));
            Assert.That(Order("prompt"), Is.GreaterThan(Order("weapon")));
        }

        [Test]
        public void MainLayerTakesLargestShare()
        {
            var r = new DamageResult { shield = 10, health = 5, firstLayer = DamageLayer.Shield };
            Assert.That(DamageNumbers.MainLayer(r), Is.EqualTo(DamageNumbers.Kind.Shield));
            r = new DamageResult { shield = 10, health = 20, firstLayer = DamageLayer.Shield };
            Assert.That(DamageNumbers.MainLayer(r), Is.EqualTo(DamageNumbers.Kind.Health));
            r = new DamageResult { armor = 8, health = 8, firstLayer = DamageLayer.Armor };
            Assert.That(DamageNumbers.MainLayer(r), Is.EqualTo(DamageNumbers.Kind.Armor), "份额相同取先打到的层");
            r = new DamageResult { health = 0, firstLayer = DamageLayer.Health };
            Assert.That(DamageNumbers.MainLayer(r), Is.EqualTo(DamageNumbers.Kind.Health));
        }

        [Test]
        public void NumberColours()
        {
            Assert.That(DamageNumbers.ColorFor(DamageNumbers.Kind.Shield, Element.Fire, true, false), Is.EqualTo(HudArt.ShieldBlue), "护盾层不看元素");
            Assert.That(DamageNumbers.ColorFor(DamageNumbers.Kind.Armor, Element.None, false, false), Is.EqualTo(HudArt.ArmorGold));
            Assert.That(DamageNumbers.ColorFor(DamageNumbers.Kind.Health, Element.Shock, false, false), Is.EqualTo(DamageTable.ElementColor(Element.Shock)));
            Assert.That(DamageNumbers.ColorFor(DamageNumbers.Kind.Health, Element.None, false, false), Is.EqualTo(Color.white));
            var crit = DamageNumbers.ColorFor(DamageNumbers.Kind.Health, Element.None, true, false);
            Assert.That(crit, Is.Not.EqualTo(Color.white), "无元素暴击亮金");
            var dot = DamageNumbers.ColorFor(DamageNumbers.Kind.Health, Element.Fire, false, true);
            var fire = DamageTable.ElementColor(Element.Fire);
            Assert.That(dot.r, Is.EqualTo(fire.r * 0.78f).Within(1e-4f), "持续伤害压暗");
            Assert.That(dot.a, Is.EqualTo(1f));
        }

        [Test]
        public void NumberText()
        {
            Assert.That(DamageNumbers.Format(0.4f, DamageNumbers.Kind.Health), Is.EqualTo("1"));
            Assert.That(DamageNumbers.Format(12.6f, DamageNumbers.Kind.Shield), Is.EqualTo("13"));
            Assert.That(DamageNumbers.Format(5e7f, DamageNumbers.Kind.Health), Is.EqualTo("999999"));
            Assert.That(DamageNumbers.Format(0, DamageNumbers.Kind.Immune), Is.EqualTo("免疫"));
            Assert.That(DamageNumbers.Format(0, DamageNumbers.Kind.Blocked), Is.EqualTo("格挡"));
        }

        [Test]
        public void HitMarkerOnlyForDirectPlayerHits()
        {
            var weapon = new DamageInfo { source = DamageSource.Weapon };
            Assert.That(CrosshairWidget.CountsAsPlayerHit(weapon), Is.True);
            var skill = new DamageInfo { source = DamageSource.Skill };
            Assert.That(CrosshairWidget.CountsAsPlayerHit(skill), Is.True);
            Assert.That(CrosshairWidget.CountsAsPlayerHit(new DamageInfo { source = DamageSource.Status }), Is.False, "持续伤害跳伤");
            Assert.That(CrosshairWidget.CountsAsPlayerHit(new DamageInfo { source = DamageSource.Pet }), Is.False, "灵宠");
            Assert.That(CrosshairWidget.CountsAsPlayerHit(new DamageInfo { source = DamageSource.Weapon, depth = 1 }), Is.False, "弹射 / 衍生");
            Assert.That(CrosshairWidget.CountsAsPlayerHit(new DamageInfo { source = DamageSource.Explosion, reaction = true }), Is.False, "反应伤害");
            Assert.That(CrosshairWidget.CountsAsPlayerHit(new DamageInfo { source = DamageSource.Weapon, tags = DamageTag.Purge }), Is.False, "静默处决");
        }

        [Test]
        public void CooldownText()
        {
            Assert.That(HudArt.CooldownText(0), Is.EqualTo(""));
            Assert.That(HudArt.CooldownText(3.2f), Is.EqualTo("4"));
            Assert.That(HudArt.CooldownText(1f), Is.EqualTo("1"));
            Assert.That(HudArt.CooldownText(0.42f), Is.EqualTo("0.5"));
            Assert.That(HudArt.FormatNum(1280), Is.EqualTo("1,280"));
        }

        [Test]
        public void ReactionTipFlagMatchesThreeJs()
        {
            Assert.That(ReactionTips.FlagKey(Reaction.Thunderfire), Is.EqualTo("rx:thunderfire"));
            Assert.That(ReactionTips.FlagKey(Reaction.Abyss), Is.EqualTo("rx:abyss"));
        }

        [Test]
        public void LegacyBossSourceHasNoTicks()
        {
            var go = new GameObject("Boss Probe");
            try
            {
                var d = go.AddComponent<Damageable>();
                d.displayName = "沙暴巨像";
                var s = new DamageableBossSource(d, null);
                Assert.That(s.BarTitle, Is.EqualTo("沙暴巨像"));
                Assert.That(s.BarThresholds, Is.Empty, "旧接口没有 BossDef，不画（可能是错的）刻度");
                Assert.That(new DamageableBossSource(d, "旱魃").BarTitle, Is.EqualTo("旱魃"));
                d.untargetable = true;
                Assert.That(s.BarInvulnerable, Is.True);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }
    }
}
