using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 射击核心特效（特效打磨 A 路）的纯数据契约：每把枪都有枪口样式、能量 / 弓弩 / 发射器不抛壳、需要的枪抛壳、
    /// 枪模相机 → 主相机的屏幕位置换算、射击用到的预设都在。观感由 playtest fx-shot 截图验收。
    /// </summary>
    public sealed class FxShotTests
    {
        [Test]
        public void EveryWeaponHasAMuzzleStyle()
        {
            foreach (var def in WeaponLibrary.All)
            {
                var style = Fx.MuzzleStyleOf(def);
                if (def.IsBlade) Assert.That(style, Is.EqualTo(MuzzleStyle.None), $"{def.id} 是刀，不该有枪口火焰");
                else Assert.That(style, Is.Not.EqualTo(MuzzleStyle.None), $"{def.id} 没有枪口样式");
            }
        }

        [TestCase("shotgun", MuzzleStyle.Shotgun)]
        [TestCase("magmashot", MuzzleStyle.Shotgun)]
        [TestCase("sniper", MuzzleStyle.Sniper)]
        [TestCase("railgun", MuzzleStyle.Railgun)]
        [TestCase("smg", MuzzleStyle.Smg)]
        [TestCase("rifle", MuzzleStyle.Rifle)]
        [TestCase("revolver", MuzzleStyle.Revolver)]
        [TestCase("beam", MuzzleStyle.Energy)]
        [TestCase("stormpod", MuzzleStyle.Energy)]
        [TestCase("lantern", MuzzleStyle.Energy)]
        [TestCase("flamer", MuzzleStyle.Flamer)]
        [TestCase("launcher", MuzzleStyle.Launcher)]
        [TestCase("crossbow", MuzzleStyle.Crossbow)]
        public void MuzzleStylePerWeaponClass(string id, MuzzleStyle want)
        {
            var def = WeaponLibrary.Get(id);
            Assume.That(def, Is.Not.Null, $"武器表里没有 {id}");
            Assert.That(Fx.MuzzleStyleOf(def), Is.EqualTo(want));
        }

        [Test]
        public void OnlyCartridgeGunsEjectShells()
        {
            foreach (var def in WeaponLibrary.All)
            {
                var shell = Fx.ShellOf(def);
                var style = Fx.MuzzleStyleOf(def);
                if (style is MuzzleStyle.Energy or MuzzleStyle.Crossbow or MuzzleStyle.Flamer or MuzzleStyle.Launcher or MuzzleStyle.Rocket or MuzzleStyle.Railgun or MuzzleStyle.None)
                    Assert.That(shell, Is.EqualTo(ShellKind.None), $"{def.id}（{style}）不该抛壳");
            }
            foreach (var id in new[] { "smg", "rifle", "burst", "minigun", "sniper", "shotgun" })
            {
                var def = WeaponLibrary.Get(id);
                if (def != null) Assert.That(Fx.ShellOf(def), Is.Not.EqualTo(ShellKind.None), $"{id} 应该抛壳");
            }
        }

        [Test]
        public void ViewmodelPointKeepsItsScreenPosition()
        {
            var go = new GameObject("FxShotTests Camera");
            try
            {
                var cam = go.AddComponent<Camera>();
                cam.fieldOfView = 70;
                cam.aspect = 16f / 9f;
                go.transform.SetPositionAndRotation(new Vector3(3, 2, -5), Quaternion.Euler(10, 35, 0));
                // 枪模相机（同位置、60°）里的一点：在主相机里换算后屏幕位置应与它在 60° 相机里的屏幕位置一致
                var vmLocal = new Vector3(0.12f, -0.09f, 0.6f);
                var vmWorld = go.transform.TransformPoint(vmLocal);
                var main = Fx.ViewmodelToMain(cam, vmWorld, 0.9f);
                var local = go.transform.InverseTransformPoint(main);
                Assert.That(local.z, Is.EqualTo(0.9f).Within(1e-4f));
                float tanV = Mathf.Tan(Fx.ViewmodelFov * 0.5f * Mathf.Deg2Rad), tanM = Mathf.Tan(35f * Mathf.Deg2Rad);
                Assert.That(local.x / (local.z * tanM), Is.EqualTo(vmLocal.x / (vmLocal.z * tanV)).Within(1e-4f));
                Assert.That(local.y / (local.z * tanM), Is.EqualTo(vmLocal.y / (vmLocal.z * tanV)).Within(1e-4f));
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void ShotPresetsAreRegistered()
        {
            foreach (var id in new[] { "EnemyHitCrit", "CritFlare", "CritPip", "CritRing", "EnemyHitWeak", "EnemyHit", "EnemyHitShield", "EnemyHitArmor" })
                Assert.That(Registry<FxPreset>.Get(id), Is.Not.Null, $"缺预设 {id}");
            // 暴击命中点那一团不再带星芒 / 大闪光（星芒改由 CritFlare 放到轮廓外）
            var crit = Registry<FxPreset>.Get("EnemyHitCrit");
            Assert.That(crit.Layers.Any(l => l.style == "Flare"), Is.False, "EnemyHitCrit 不该再在命中点放星芒");
            Assert.That(crit.Includes == null || crit.Includes.Length == 0, "EnemyHitCrit 不再包含 ×1.7 的普通命中（闪光会罩住敌人）");
            Assert.That(crit.Layers.Where(l => l.style == "Glow").All(l => l.size.y <= 0.3f), "暴击命中点的闪光不超过 0.3 m");
        }
    }
}
