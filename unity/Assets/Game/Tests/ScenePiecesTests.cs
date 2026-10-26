using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// L6 场景件的纯规则：可破坏物把一下伤害归成「怎么打的 + 什么元素」（<see cref="Destructible.Classify"/>）。
    /// 打碎、触发、载人、断桥由 playtest scene-pieces 在 TestArena 里验。
    /// </summary>
    public sealed class ScenePiecesTests
    {
        static DamageInfo Hit(DamageSource src, Element el = Element.None, DamageTag tags = DamageTag.None)
        {
            var i = DamageInfo.Simple(10, src, Vector3.zero, Vector3.forward);
            i.element = el;
            i.tags = tags;
            return i;
        }

        static Destructible.DamageKind K(DamageInfo i) => Destructible.Classify(in i);

        [Test]
        public void DeliveryKinds()
        {
            Assert.That(K(Hit(DamageSource.Weapon)), Is.EqualTo(Destructible.DamageKind.Shot));
            Assert.That(K(Hit(DamageSource.Weapon, tags: DamageTag.Melee)), Is.EqualTo(Destructible.DamageKind.Melee));
            Assert.That(K(Hit(DamageSource.Melee)), Is.EqualTo(Destructible.DamageKind.Melee));
            Assert.That(K(Hit(DamageSource.Skill)), Is.EqualTo(Destructible.DamageKind.Skill));
            Assert.That(K(Hit(DamageSource.Pet)), Is.EqualTo(Destructible.DamageKind.Pet));
            Assert.That(K(Hit(DamageSource.Enemy)), Is.EqualTo(Destructible.DamageKind.Enemy));
            Assert.That(K(Hit(DamageSource.Environment)), Is.EqualTo(Destructible.DamageKind.Environment));
            Assert.That(K(Hit(DamageSource.Scroll)), Is.EqualTo(Destructible.DamageKind.Shot));
        }

        [Test]
        public void ExplosionWinsOverDelivery()
        {
            // 武器投射物的爆炸（来源 Weapon + Explosion 标签）、技能的爆炸都算爆炸：只吃爆炸的石碑能被榴弹炸开
            Assert.That(K(Hit(DamageSource.Weapon, tags: DamageTag.Explosion)), Is.EqualTo(Destructible.DamageKind.Explosion));
            Assert.That(K(Hit(DamageSource.Skill, tags: DamageTag.Explosion)), Is.EqualTo(Destructible.DamageKind.Explosion));
            Assert.That(K(Hit(DamageSource.Explosion)), Is.EqualTo(Destructible.DamageKind.Explosion));
        }

        [Test]
        public void ElementsAddTheirFlag()
        {
            Assert.That(K(Hit(DamageSource.Weapon, Element.Fire)), Is.EqualTo(Destructible.DamageKind.Shot | Destructible.DamageKind.Fire));
            Assert.That(K(Hit(DamageSource.Skill, Element.Shock)), Is.EqualTo(Destructible.DamageKind.Skill | Destructible.DamageKind.Shock));
            Assert.That(K(Hit(DamageSource.Explosion, Element.Corrode)), Is.EqualTo(Destructible.DamageKind.Explosion | Destructible.DamageKind.Corrode));
        }

        [Test]
        public void DotsCountOnlyAsTheirElement()
        {
            // 灼烧跳伤：只算火（只认火的荆棘会被烧掉，只认射击的件不吃灼烧）
            Assert.That(K(Hit(DamageSource.Status, Element.Fire)), Is.EqualTo(Destructible.DamageKind.Fire));
            Assert.That(K(Hit(DamageSource.Status)), Is.EqualTo(Destructible.DamageKind.None));
        }

        [Test]
        public void PlayerMaskExcludesEnemyAndEnvironment()
        {
            var p = Destructible.DamageKind.Player;
            Assert.That(p & Destructible.DamageKind.Enemy, Is.EqualTo(Destructible.DamageKind.None));
            Assert.That(p & Destructible.DamageKind.Environment, Is.EqualTo(Destructible.DamageKind.None));
            Assert.That(p & K(Hit(DamageSource.Weapon)), Is.Not.EqualTo(Destructible.DamageKind.None));
            Assert.That(p & K(Hit(DamageSource.Status, Element.Fire)), Is.Not.EqualTo(Destructible.DamageKind.None));
        }
    }
}
