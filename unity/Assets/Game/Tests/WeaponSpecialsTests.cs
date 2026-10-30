using System.Collections.Generic;
using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// WC3 / WC4：追魂连弩、蚀蛊灯、贯虹灵炮、赤蛟霰铳、三才转轮——定义与 TS WeaponDefs.ts 逐项对照、机制（穿透、蛊种、蓄力、元素轮转、双管逐发）
    /// 用状态机 + 假表现层驱动，第一人称零件（弦 / 箭、线圈、灵纹 / 弹巢、折开）只测纯函数和建零件，不进 Play。
    /// </summary>
    public sealed class WeaponSpecialsTests
    {
        const float Dt60 = 1f / 60f;
        readonly List<GameObject> spawned = new();

        [TearDown]
        public void Cleanup()
        {
            foreach (var go in spawned)
                if (go)
                    Object.DestroyImmediate(go);
            spawned.Clear();
        }

        static WeaponDef Def(string id)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return d;
        }

        // ───────────── 假表现层 + 状态机 ─────────────

        sealed class Effects : IWeaponEffects
        {
            public readonly List<ShotMods> mods = new();
            public readonly List<Element> elements = new();
            public readonly List<WeaponNote> notes = new();

            public void Shoot(WeaponInstance w, in ShotMods m, Element element)
            {
                mods.Add(m);
                elements.Add(element);
            }

            public void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback) { }
            public void Cue(WeaponInstance w, FireCue cue) { }
            public void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other) => notes.Add(note);
            public int Count(WeaponNote n) => notes.FindAll(x => x == n).Count;
        }

        sealed class Rig
        {
            public readonly WeaponInstance[] slots = new WeaponInstance[2];
            public readonly Effects fx = new();
            public readonly WeaponStateMachine sm;
            float time;

            public Rig(WeaponInstance w)
            {
                slots[0] = w;
                sm = new WeaponStateMachine(slots, fx, () => time, x => WeaponStatsResolver.Resolve(x, null)) { enemiesAlive = () => true };
            }

            public void Frame(bool down = false, bool pressed = false, bool reload = false, bool testAuto = false)
            {
                time += Dt60;
                sm.Tick(new WeaponFrame { dt = Dt60, alive = true, canAct = true, fireDown = down, firePressed = pressed, reloadPressed = reload, testAuto = testAuto });
            }

            public void Idle(float seconds)
            {
                int n = Mathf.RoundToInt(seconds / Dt60);
                for (int i = 0; i < n; i++) Frame();
            }

            /// <summary>扣一下扳机（半自动），再空等 gap 秒</summary>
            public void Tap(float gap = 0.5f)
            {
                Frame(true, true);
                Idle(gap);
            }

            public void Hold(float seconds, bool testAuto = false)
            {
                int n = Mathf.RoundToInt(seconds / Dt60);
                for (int i = 0; i < n; i++) Frame(true, i == 0, testAuto: testAuto);
            }
        }

        // ───────────── 定义 ─────────────

        [Test]
        public void FiveWeaponsMatchThreeJsDefs()
        {
            var crossbow = Def("crossbow");
            Assert.AreEqual(WeaponKind.Crossbow, crossbow.kind);
            Assert.AreEqual(FireMode.Semi, crossbow.mode);
            Assert.AreEqual(55f, crossbow.damage);
            Assert.AreEqual(2f, crossbow.fireRate);
            Assert.AreEqual(10, crossbow.mag);
            Assert.AreEqual(3, crossbow.pierce);
            Assert.AreEqual(150f, crossbow.range);
            Assert.AreEqual(95f, crossbow.projectile.speed);
            Assert.AreEqual(3f, crossbow.projectile.gravity);
            Assert.AreEqual(1.6f, crossbow.projectile.lifetime);
            Assert.AreEqual("arrow", crossbow.projectile.visual);
            Assert.AreEqual("shot_bow", crossbow.sfx);

            var lantern = Def("lantern");
            Assert.AreEqual(55f, lantern.damage);
            Assert.AreEqual(1.6f, lantern.fireRate);
            Assert.AreEqual(6, lantern.pierce);
            Assert.AreEqual(Element.Corrode, lantern.element);
            Assert.AreEqual(0.6f, lantern.elementChance);
            Assert.AreEqual(14f, lantern.projectile.speed);
            Assert.AreEqual(-0.3f, lantern.projectile.gravity);
            Assert.AreEqual(2.2f, lantern.projectile.homing);
            Assert.AreEqual(0.38f, lantern.projectile.radius);
            Assert.AreEqual(0f, lantern.projectile.explosionRadius);
            Assert.AreEqual(0.8f, lantern.dropWeight);

            var railgun = Def("railgun");
            Assert.AreEqual(FireMode.Charge, railgun.mode);
            Assert.AreEqual(155f, railgun.damage);
            Assert.AreEqual(0.9f, railgun.chargeTime);
            Assert.AreEqual(0.2f, railgun.chargeMinMult);
            Assert.AreEqual(3, railgun.chargeFullPierce);
            Assert.IsTrue(railgun.chargeDetonate);
            Assert.AreEqual(1, railgun.pierce);
            Assert.AreEqual(200f, railgun.range);
            Assert.AreEqual(Element.None, railgun.element);
            Assert.IsTrue(railgun.IsHitscan);

            var magma = Def("magmashot");
            Assert.AreEqual(WeaponKind.Shotgun, magma.kind);
            Assert.AreEqual(10f, magma.damage, "I3：TS 11 → 10（docs/balance.md 第 2 节）");
            Assert.AreEqual(8, magma.pellets);
            Assert.AreEqual(0.09f, magma.pelletCone);
            Assert.AreEqual(2, magma.mag);
            Assert.AreEqual(ReloadStyle.Shell, magma.reload);
            Assert.AreEqual(0.55f, magma.shellTime);
            Assert.AreEqual(0.3f, magma.reloadStart);
            Assert.AreEqual(Element.Fire, magma.element);
            Assert.AreEqual(0.07f, magma.elementChance);
            Assert.AreEqual(0.35f, magma.Falloff(30), 1e-6f);
            Assert.IsTrue(WeaponStateMachine.IsShell(magma));

            var trinity = Def("trinity");
            Assert.AreEqual(WeaponKind.Pistol, trinity.kind);
            Assert.AreEqual(42f, trinity.damage);
            Assert.AreEqual(3f, trinity.fireRate);
            Assert.AreEqual(6, trinity.mag);
            Assert.AreEqual(ReloadStyle.Cylinder, trinity.reload);
            CollectionAssert.AreEqual(new[] { Element.Fire, Element.Shock, Element.Corrode }, trinity.cycle);
            Assert.AreEqual(0.45f, trinity.elementChance);
            Assert.AreEqual(0.8f, trinity.dropWeight);
        }

        [Test]
        public void NewDefsUseTsSpreadTimesScaleAndOwnModels()
        {
            foreach (var id in new[] { "crossbow", "lantern", "railgun", "magmashot", "trinity" })
            {
                var d = Def(id);
                Assert.IsNull(d.spreadTuned, $"{id} 是新武器，不该有手调散布");
                Assert.AreEqual(d.spreadTs.hip * 0.4f, d.spreadHip, 1e-7f, id);
                Assert.AreEqual(d.spreadTs.max * 0.4f, d.spreadMax, 1e-7f, id);
                Assert.AreEqual("SK_Weapon_" + char.ToUpperInvariant(id[0]) + id.Substring(1), d.prefab, id);
                Assert.IsFalse(string.IsNullOrEmpty(d.description), id);
                Assert.IsNotEmpty(d.notes, id);
            }
            Assert.AreEqual(0f, Def("railgun").spreadAim, "贯虹开镜零散布（TS spreadAim 0）");
        }

        [Test]
        public void StormpodSubShockOnlyComesFromInnateAffix()
        {
            var d = Def("stormpod");
            Assert.AreEqual(Element.None, d.subElement, "副·雷改走固有词条，定义里不再带 subElement");
            Assert.AreEqual(0f, d.subChance);
            Assert.AreEqual(1, d.innate.Length);
            Assert.AreEqual("subShock", d.innate[0].id);
            Assert.AreEqual(0.4f, d.innate[0].value);
        }

        // ───────────── 连弩 / 蛊灯：投射物穿透与蛊种 ─────────────

        [Test]
        public void ProjectileWeaponsCarryPierceIntoResolvedStats()
        {
            var crossbow = WeaponStatsResolver.Resolve(new WeaponInstance(Def("crossbow")), null);
            Assert.AreEqual(3, crossbow.pierce);
            Assert.IsFalse(Def("crossbow").IsExplosive);
            var lantern = WeaponStatsResolver.Resolve(new WeaponInstance(Def("lantern")), null);
            Assert.AreEqual(6, lantern.pierce);
            Assert.AreEqual(55f, lantern.damage, 1e-4f);
        }

        [Test]
        public void LanternSeedIsInnateUnscaledAndNotRolledTwice()
        {
            var def = Def("lantern");
            var inst = new WeaponInstance(def);
            Assert.AreEqual(Affix_Seed.Id, inst.affixes[0].id);
            Assert.AreEqual(0.5f, inst.affixes[0].value);
            for (int seed = 1; seed <= 20; seed++)
            {
                var list = AffixRoll.Roll(def, Rarity.Legendary, def.element, new System.Random(seed));
                Assert.AreEqual(Affix_Seed.Id, list[0].id);
                Assert.AreEqual(0.5f, list[0].value, "固有词条不随稀有度放大");
                Assert.AreEqual(1, list.FindAll(a => a.id == Affix_Seed.Id).Count, "固有的蛊种不会再被抽到");
            }
            // 蛊种的准入：发射非爆炸投射物的武器（弩可以再抽到它，爆炸弹不行）
            var seedDef = AffixLibrary.Get(Affix_Seed.Id);
            Assert.IsNotNull(seedDef);
            Assert.IsTrue(seedDef.Allow(new AffixContext(Def("crossbow"), Element.None, null)));
            Assert.IsTrue(seedDef.Allow(new AffixContext(def, def.element, null)));
            Assert.IsFalse(seedDef.Allow(new AffixContext(Def("launcher"), Element.Fire, null)));
        }

        // ───────────── 贯虹：蓄力 ─────────────

        [Test]
        public void RailgunFullChargeAddsPierceAndFlagsDetonate()
        {
            var def = Def("railgun");
            Assert.IsInstanceOf<ChargeMode>(FireModes.Create(def));
            var full = ChargeMode.Shot(def, 1);
            Assert.AreEqual(1f, full.mult, 1e-6f);
            Assert.AreEqual(3, full.pierceBonus);
            Assert.IsTrue(full.full);
            var half = ChargeMode.Shot(def, 0.5f);
            Assert.AreEqual(0.4f, half.mult, 1e-6f, "0.2 + 0.8 × 0.5²");
            Assert.AreEqual(0, half.pierceBonus);
            Assert.IsFalse(half.full);
            Assert.AreEqual(0.7f, half.strength, 1e-6f);
            Assert.AreEqual(0.2f, ChargeMode.Shot(def, 0).mult, 1e-6f);

            // 状态机：TestMode 按住到蓄满自动松手 → 满蓄一发
            var rig = new Rig(new WeaponInstance(def));
            rig.Hold(1.1f, testAuto: true);
            Assert.AreEqual(1, rig.fx.mods.Count);
            Assert.IsTrue(rig.fx.mods[0].full);
            Assert.AreEqual(3, rig.fx.mods[0].pierceBonus);
            Assert.AreEqual(5, rig.slots[0].mag);
        }

        [Test]
        public void RailgunPartialChargeReleasesWithQuadraticMultiplier()
        {
            var rig = new Rig(new WeaponInstance(Def("railgun")));
            rig.Hold(0.45f);
            Assert.AreEqual(0, rig.fx.mods.Count, "按住时不开火");
            rig.Frame();
            Assert.AreEqual(1, rig.fx.mods.Count, "松手发射");
            var m = rig.fx.mods[0];
            Assert.IsFalse(m.full);
            Assert.AreEqual(0, m.pierceBonus);
            Assert.AreEqual(0.4f, m.mult, 0.03f);
        }

        // ───────────── 三才：元素轮转 ─────────────

        [Test]
        public void TrinityCyclesFireShockCorrodeAndResetsOnReload()
        {
            var w = new WeaponInstance(Def("trinity"));
            Assert.AreEqual(Element.Fire, w.element);
            var rig = new Rig(w);
            Assert.AreEqual(Element.Fire, TrinityCycle.Next(w, false));
            for (int i = 0; i < 4; i++) rig.Tap();
            CollectionAssert.AreEqual(new[] { Element.Fire, Element.Shock, Element.Corrode, Element.Fire }, rig.fx.elements);
            Assert.AreEqual(Element.Shock, TrinityCycle.Next(w, false), "下一发");
            Assert.AreEqual(Element.Fire, TrinityCycle.Next(w, true), "换弹中预告换弹后的第一发");

            rig.Frame(reload: true);
            Assert.IsTrue(rig.sm.Reloading);
            rig.Idle(2f);
            Assert.IsFalse(rig.sm.Reloading);
            Assert.AreEqual(0, w.cycleIndex, "换弹归零");
            rig.Tap();
            Assert.AreEqual(Element.Fire, rig.fx.elements[rig.fx.elements.Count - 1]);
        }

        [Test]
        public void TrinityRejectsSubElementAndLunhuiAffixes()
        {
            var def = Def("trinity");
            var ctx = new AffixContext(def, def.element, null);
            foreach (var id in new[] { "subFire", "subShock", "subCorrode", "lg_lunhui" })
            {
                var a = AffixLibrary.Get(id);
                Assert.IsNotNull(a, id);
                Assert.IsFalse(a.Allow(ctx), $"{id} 不该出现在元素轮转武器上");
            }
        }

        [Test]
        public void TrinityCylinderLocksForwardToNextChamber()
        {
            float step = Mathf.PI * 2 / TrinityCycle.Chambers;
            Assert.AreEqual(step, TrinityCycle.LockTarget(0, 1, 6, 3), 1e-5f);
            Assert.AreEqual(2 * step, TrinityCycle.LockTarget(step, 2, 6, 3), 1e-5f);
            // 第 4 发回到灼烧：同色膛周期 3 格，继续向前转到第 3 膛，不倒转回 0
            Assert.AreEqual(3 * step, TrinityCycle.LockTarget(2 * step, 0, 6, 3), 1e-5f);
            float target = 0;
            for (int shot = 0; shot < 20; shot++)
            {
                float next = TrinityCycle.LockTarget(target, (shot + 1) % 3, 6, 3);
                Assert.GreaterOrEqual(next, target - 1e-4f, "弹巢只向前转");
                Assert.LessOrEqual(next - target, step + 1e-4f, "每发最多一格");
                target = next;
            }
            Assert.AreEqual(0f, TrinityCycle.MagCurve(0.05f));
            Assert.AreEqual(1f, TrinityCycle.MagCurve(0.45f));
            Assert.AreEqual(0f, TrinityCycle.MagCurve(0.9f));
        }

        // ───────────── 霰铳：双管逐发 ─────────────

        [Test]
        public void MagmashotFiresTwiceThenShellReloadsAndRacks()
        {
            var def = Def("magmashot");
            var w = new WeaponInstance(def);
            Assert.AreEqual(Affix_SubCorrode.Id, w.affixes[0].id);
            Assert.AreEqual(0.06f, w.affixes[0].value);
            var rig = new Rig(w);
            rig.Tap(0.45f);
            rig.Frame(true, true);
            Assert.AreEqual(2, rig.fx.mods.Count);
            Assert.AreEqual(0, w.mag);
            rig.Idle(0.4f);
            Assert.IsTrue(rig.sm.Reloading, "打空后自动换弹");
            Assert.IsTrue(rig.sm.ShellReload, "逐发装填（折开）");
            Assert.IsTrue(BreakAction.ShellVisible(rig.sm.ShellReload, 0.5f));
            rig.Idle(2f);
            Assert.AreEqual(2, w.mag);
            Assert.AreEqual(34, w.reserve);
            Assert.AreEqual(2, rig.fx.Count(WeaponNote.ShellInserted));
            Assert.AreEqual(1, rig.fx.Count(WeaponNote.Racked));
            Assert.AreEqual(Element.Fire, rig.fx.elements[0]);
        }

        [Test]
        public void BreakActionShellWindowAndPose()
        {
            Assert.IsFalse(BreakAction.ShellVisible(true, 0.1f));
            Assert.IsTrue(BreakAction.ShellVisible(true, 0.6f));
            Assert.IsFalse(BreakAction.ShellVisible(true, 0.99f));
            Assert.IsFalse(BreakAction.ShellVisible(false, 0.6f));
            var inserted = BreakAction.ShellPose(1f, 0);
            Assert.AreEqual(BreakAction.BoreX, inserted.x, 1e-6f);
            Assert.AreEqual(BreakAction.ChamberZ - BreakAction.ShellLength * 0.5f, inserted.z, 1e-6f);
            Assert.AreEqual(-BreakAction.BoreX, BreakAction.ShellPose(0.3f, 1).x, 1e-6f);
            Assert.Greater(BreakAction.ShellPose(0.3f, 0).y, inserted.y, "递过来时在膛口上方");
        }

        // ───────────── 连弩：弦与箭 ─────────────

        [Test]
        public void CrossbowCockFollowsCooldownReloadAndAmmo()
        {
            Assert.AreEqual(1f, CrossbowString.Cock(false, false, 0, false, 0.4f, 0.5f), "显示的不是手上那把：上满弦");
            Assert.AreEqual(0f, CrossbowString.Cock(true, false, 0, true, 0.5f, 0.5f), "刚开枪：松弦");
            Assert.AreEqual(0.5f, CrossbowString.Cock(true, false, 0, true, 0.25f, 0.5f), 1e-6f);
            Assert.AreEqual(1f, CrossbowString.Cock(true, false, 0, true, 0, 0.5f));
            Assert.AreEqual(0f, CrossbowString.Cock(true, false, 0, false, 0, 0.5f), "弹匣空：松弦");
            Assert.AreEqual(0f, CrossbowString.Cock(true, true, 0.5f, false, 0, 0.5f));
            Assert.AreEqual(0.5f, CrossbowString.Cock(true, true, 0.75f, false, 0, 0.5f), 1e-6f);
            Assert.AreEqual(1f, CrossbowString.Cock(true, true, 0.95f, false, 0, 0.5f));
            Assert.IsFalse(CrossbowString.BoltVisible(0.97f));
            Assert.IsTrue(CrossbowString.BoltVisible(0.98f));
        }

        [Test]
        public void CrossbowStringStretchesFromLimbTipsToNock()
        {
            Assert.AreEqual(CrossbowString.Tip.z, CrossbowString.NockZ(0), 1e-6f);
            Assert.AreEqual(CrossbowString.NockDrawnZ, CrossbowString.NockZ(1), 1e-6f);
            CrossbowString.Half(1, 1, out var c, out var rot, out float len);
            var tip = CrossbowString.Tip;
            var nock = new Vector3(0, tip.y, CrossbowString.NockDrawnZ);
            Assert.AreEqual(Vector3.Distance(tip, nock), len, 1e-5f);
            Assert.Less(Vector3.Distance((tip + nock) * 0.5f, c), 1e-5f);
            Assert.Less(Vector3.Distance(c + rot * Vector3.forward * (len * 0.5f), tip), 1e-4f, "+Z 指向弓梢");
            CrossbowString.Half(-1, 0, out var c0, out _, out float len0);
            Assert.AreEqual(tip.x, len0, 1e-5f, "松弦时半根弦横贴弓臂");
            Assert.Less(c0.x, 0);
        }

        // ───────────── 灵炮表现 ─────────────

        [Test]
        public void RailgunVisualCurves()
        {
            Assert.AreEqual(0.0008f, RailgunCharge.Jitter(0), 1e-7f);
            Assert.AreEqual(0.0034f, RailgunCharge.Jitter(1), 1e-7f);
            Assert.AreEqual(0.16f, RailgunCharge.OrbSize(0.2f, 1), 1e-6f);
            Assert.AreEqual(1.5f, RailgunCharge.Pulse(1, true, 0), 1e-6f);
            Assert.AreEqual(Ballistics.FullChargeColor, RailgunCharge.EnergyColor(Element.None));
            Assert.AreEqual(WeaponTint.ElementColor(Element.Shock), RailgunCharge.EnergyColor(Element.Shock));
            Assert.AreEqual(0f, RailgunBeam.Taper(0));
            Assert.AreEqual(1f, RailgunBeam.Taper(0.5f));
            Assert.AreEqual(0f, RailgunBeam.Taper(1));
            Color.RGBToHSV(RailgunBeam.Rainbow(0), out float h0, out _, out _);
            Color.RGBToHSV(RailgunBeam.Rainbow(1f / 3), out float h1, out _, out _);
            Color.RGBToHSV(RailgunBeam.Rainbow(4f / 3), out float h2, out _, out _);
            Assert.AreEqual(1f / 3, Mathf.DeltaAngle(h0 * 360, h1 * 360) / 360, 0.01f);
            Assert.AreEqual(h1, h2, 0.01f, "色相按 1 取模");
        }

        // ───────────── 零件补挂 ─────────────

        [Test]
        public void RigPartsAreRegisteredForTheFiveWeapons()
        {
            Assert.AreEqual(typeof(CrossbowString), WeaponRigParts.PartFor("crossbow"));
            Assert.AreEqual(typeof(RailgunCharge), WeaponRigParts.PartFor("railgun"));
            Assert.AreEqual(typeof(TrinityCycle), WeaponRigParts.PartFor("trinity"));
            Assert.AreEqual(typeof(BreakAction), WeaponRigParts.PartFor("magmashot"));
            Assert.IsNull(WeaponRigParts.PartFor("smg"));
            Assert.Throws<System.ArgumentException>(() => WeaponRigParts.Register("x", typeof(WeaponRigPart)));
        }

        /// <summary>按 PlayerFactory 的结构搭一套假 rig（rig → 枪模根 → 骨骼），挂上零件后检查程序化零件和骨骼绑定</summary>
        [Test]
        public void AttachBuildsProceduralPartsOnFakeRigs()
        {
            var player = Track(new GameObject("Player"));
            var wc = player.AddComponent<WeaponController>();
            var rigs = new List<WeaponController.Rig>();
            foreach (var id in new[] { "crossbow", "railgun", "trinity", "magmashot", "smg" })
            {
                var def = Def(id);
                var rigGo = new GameObject($"FP Rig {id}");
                rigGo.transform.SetParent(player.transform, false);
                var vm = rigGo.AddComponent<FirstPersonViewmodel>();
                var gunRoot = new GameObject(def.prefab).transform;
                gunRoot.SetParent(rigGo.transform, false);
                gunRoot.localScale = Vector3.one * 0.76f;
                var jr = new GameObject("j_r").transform;
                jr.SetParent(gunRoot, false);
                foreach (var bone in new[] { "j_0", "j_8", "j_15" })
                    new GameObject(bone).transform.SetParent(jr, false);
                rigs.Add(new WeaponController.Rig { weaponId = id, view = vm });
            }
            wc.rigs = rigs.ToArray();

            Assert.AreEqual(4, WeaponRigParts.Attach(wc));
            Assert.AreEqual(0, WeaponRigParts.Attach(wc), "已经挂着的不重复挂");

            var crossbow = wc.rigs[0].view.GetComponent<CrossbowString>();
            Assert.IsNotNull(crossbow);
            Assert.AreEqual("SK_Weapon_Crossbow", crossbow.Gun.name);
            foreach (var n in new[] { "string_l", "string_r", "bolt" })
                Assert.IsNotNull(WeaponRigPart.FindDeep(crossbow.Gun, n), n);
            Assert.IsTrue(crossbow.BoltShown, "建好时上满弦、箭在槽");
            var right = WeaponRigPart.FindDeep(crossbow.Gun, "string_r");
            CrossbowString.Half(1, 1, out _, out _, out float len);
            Assert.AreEqual(len, right.localScale.z, 1e-5f);
            Assert.AreEqual(Layers.FirstPerson, right.gameObject.layer);

            Assert.IsNotNull(wc.rigs[1].view.GetComponent<RailgunCharge>());
            Assert.IsNotNull(WeaponRigPart.FindDeep(wc.rigs[1].view.transform, "charge_orb"));
            Assert.IsNotNull(wc.rigs[2].view.GetComponent<TrinityCycle>());
            var breach = wc.rigs[3].view.GetComponent<BreakAction>();
            Assert.IsNotNull(breach);
            Assert.IsFalse(breach.HasHinge, "美术还没有枪管关节：整枪低头代替");
            Assert.IsNull(wc.rigs[4].view.GetComponent<WeaponRigPart>(), "没登记零件的枪不挂");
        }

        GameObject Track(GameObject go)
        {
            spawned.Add(go);
            return go;
        }
    }
}
