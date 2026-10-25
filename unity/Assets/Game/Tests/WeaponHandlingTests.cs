using System.Collections.Generic;
using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// W3 / W4：每把枪的持握与换弹（HandlingProfile）、换弹手位时间线（同 TS sampleLoadingHand / magCurve）、两骨 IK、
    /// 加弹的动画事件（CommitLoad：弹药提前加、总时长不变、打断保留），以及零件 / 挂点在假 rig 上的绑定。不进 Play。
    /// </summary>
    public sealed class WeaponHandlingTests
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

        GameObject Track(GameObject go)
        {
            spawned.Add(go);
            return go;
        }

        // ───────────── 持握表 ─────────────

        [Test]
        public void EveryGunHasAHandlingProfileMatchingItsReloadStyle()
        {
            int n = 0;
            foreach (var def in WeaponLibrary.All)
            {
                var p = HandlingProfile.For(def.id);
                if (def.IsBlade)
                {
                    Assert.IsNull(p, "碎刃不走枪的持握（WC7）");
                    continue;
                }
                Assert.IsNotNull(p, $"{def.id} 没有 HandlingProfile");
                Assert.AreEqual(WeaponStateMachine.IsShell(def), p.Shell, $"{def.id}：逐发装填与换弹风格不一致");
                Assert.Greater(p.weight, 0.2f, def.id);
                Assert.That(p.loadAt, Is.InRange(p.magInEnd - 1e-4f, p.finishEnd), $"{def.id}：弹匣入位（加弹）要在装入之后、收尾之前");
                n++;
            }
            Assert.AreEqual(17, n, "17 把枪各一份");
            Assert.AreEqual(8, HandlingProfile.For("revolver").cylinderSteps);
            Assert.AreEqual(0, HandlingProfile.For("trinity").cylinderSteps, "三才转轮由 TrinityCycle 转");
            Assert.Greater(HandlingProfile.For("shotgun").pumpStroke, 0.05f);
            Assert.Greater(HandlingProfile.For("minigun").weight, HandlingProfile.For("smg").weight, "机炮比冲锋枪重");
        }

        [Test]
        public void MagCurveAndEnvelopeFollowThreeJs()
        {
            var p = HandlingProfile.For("smg");
            Assert.AreEqual(0, p.MagOut(0.1f), 1e-5f);
            Assert.AreEqual(1, p.MagOut(0.45f), 1e-5f, "38–55% 离位");
            Assert.AreEqual(0.5f, p.MagOut(0.25f), 1e-5f, "12–38% 的中点");
            Assert.AreEqual(0, p.MagOut(0.8f), 1e-5f, "78% 以后装回去了");
            Assert.AreEqual(0, HandlingProfile.Envelope(0), 1e-5f);
            Assert.AreEqual(1, HandlingProfile.Envelope(0.5f), 1e-5f);
            Assert.AreEqual(0, HandlingProfile.Envelope(1), 1e-5f);
            Assert.AreEqual(HandlingProfile.Envelope(0.3f), FirstPersonViewmodel.Envelope(0.3f), 1e-6f, "两边的包络同一条");
        }

        [Test]
        public void MagazineHandGoesGripLoadFinishGrip()
        {
            var p = HandlingProfile.For("rifle");
            Vector3 grip = new(0, 0.006f, -0.36f), load = new(0.015f, -0.065f, -0.095f), finish = new(0.04f, 0.06f, 0.005f);
            p.SampleHand(0, grip, load, finish, true, 0.1f, out var at, out float roll, out float pitch);
            Assert.That(Vector3.Distance(at, grip), Is.LessThan(1e-5f), "开始在握点");
            Assert.AreEqual(0.1f, roll, 1e-5f);
            Assert.AreEqual(0, pitch, 1e-5f);
            p.SampleHand(0.5f, grip, load, finish, true, 0.1f, out at, out roll, out pitch);
            Assert.That(Vector3.Distance(at, load), Is.LessThan(1e-5f), "中段在送弹口");
            Assert.AreEqual(p.reachRoll, roll, 1e-5f, "伸手的手型");
            p.SampleHand(0.88f, grip, load, finish, true, 0.1f, out at, out _, out _);
            Assert.That(Vector3.Distance(at, finish), Is.LessThan(1e-5f), "88% 到收尾点");
            p.SampleHand(1, grip, load, finish, true, 0.1f, out at, out roll, out _);
            Assert.That(Vector3.Distance(at, grip), Is.LessThan(1e-5f), "回到握点");
            Assert.AreEqual(0.1f, roll, 1e-5f);
        }

        [Test]
        public void ShellHandShuttlesPouchToPort()
        {
            var p = HandlingProfile.For("shotgun");
            Vector3 grip = new(0, -0.002f, -0.3f), load = new(0.018f, -0.03f, -0.08f);
            p.SampleHand(0.22f, grip, load, load, true, 0, out var at, out _, out float pitch);
            Assert.That(Vector3.Distance(at, HandlingProfile.Pouch), Is.LessThan(1e-5f), "22% 在弹药袋");
            Assert.AreEqual(p.reachPitch, pitch, 1e-5f);
            p.SampleHand(0.88f, grip, load, load, true, 0, out at, out _, out _);
            Assert.That(Vector3.Distance(at, load), Is.LessThan(1e-5f), "88% 送到装填口");
            p.SampleHand(0, grip, load, load, false, 0, out at, out _, out _);
            Assert.That(Vector3.Distance(at, load), Is.LessThan(1e-5f), "第二发起从装填口出发，不跳回握点");
        }

        // ───────────── 两骨 IK ─────────────

        [Test]
        public void TwoBoneIkKeepsLengthsAndBendsTowardPole()
        {
            var root = new Vector3(0.1f, -0.3f, 0.25f);
            var target = new Vector3(0, 0.02f, -0.2f);
            var pole = new Vector3(0.3f, -0.4f, 0);
            var e = TwoBoneIK.Solve(root, target, 0.3f, 0.3f, pole, out bool reached);
            Assert.IsTrue(reached);
            Assert.AreEqual(0.3f, Vector3.Distance(root, e), 1e-4f, "上臂长不变");
            Assert.AreEqual(0.3f, Vector3.Distance(target, e), 1e-4f, "前臂长不变");
            var mid = (root + target) * 0.5f;
            Assert.Greater(Vector3.Dot(e - mid, pole - mid), 0, "肘往提示点那边弯");

            var far = root + (target - root).normalized * 2f;
            e = TwoBoneIK.Solve(root, far, 0.3f, 0.3f, pole, out reached);
            Assert.IsFalse(reached, "够不着");
            Assert.AreEqual(0.3f, Vector3.Distance(root, e), 1e-3f, "伸直时肘在上臂末端");
        }

        [Test]
        public void ForearmRotationIsIdentityAtRestAndSwingsWithElbow()
        {
            var hand = Quaternion.Euler(0, 0, -6);
            var axis = new Vector3(0.094f, -0.15f, 0.162f).normalized;
            var h = new Vector3(0, 0.02f, -0.235f);
            var e = h + hand * axis * 0.3f;
            var r = TwoBoneIK.ForearmRotation(hand, axis, h, e);
            Assert.Less(Quaternion.Angle(r, hand), 0.01f, "静止时就是摆好的手型");
            var lower = h + Vector3.down * 0.3f;
            r = TwoBoneIK.ForearmRotation(hand, axis, h, lower);
            Assert.Less(Vector3.Angle(r * axis, Vector3.down), 0.01f, "前臂指向肘");
        }

        // ───────────── 加弹的动画事件 ─────────────

        sealed class Effects : IWeaponEffects
        {
            public readonly List<WeaponNote> notes = new();
            public void Shoot(WeaponInstance w, in ShotMods m, Element element) { }
            public void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback) { }
            public void Cue(WeaponInstance w, FireCue cue) { }
            public void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other) => notes.Add(note);
            public int Count(WeaponNote n) => notes.FindAll(x => x == n).Count;
        }

        sealed class Host
        {
            public readonly WeaponInstance[] slots = new WeaponInstance[2];
            public readonly Effects fx = new();
            public readonly WeaponStateMachine sm;
            float time;

            public Host(WeaponInstance a, WeaponInstance b = null)
            {
                slots[0] = a;
                slots[1] = b;
                sm = new WeaponStateMachine(slots, fx, () => time, x => WeaponStatsResolver.Resolve(x, null)) { enemiesAlive = () => true };
            }

            public void Frame(bool reload = false)
            {
                time += Dt60;
                sm.Tick(new WeaponFrame { dt = Dt60, alive = true, canAct = true, reloadPressed = reload });
            }

            public void Idle(float seconds)
            {
                int n = Mathf.RoundToInt(seconds / Dt60);
                for (int i = 0; i < n; i++) Frame();
            }
        }

        [Test]
        public void CommitLoadAddsAmmoEarlyWithoutChangingReloadTime()
        {
            var def = WeaponLibrary.Get("smg");
            var w = new WeaponInstance(def) { mag = 3 };
            int reserve0 = w.reserve;
            var h = new Host(w);
            h.Frame(reload: true);
            Assert.IsTrue(h.sm.Reloading);
            Assert.IsTrue(h.sm.CommitLoad(), "换弹中第一次调：加弹");
            Assert.AreEqual(def.mag, w.mag, "动画事件到了就加满");
            Assert.AreEqual(reserve0 - (def.mag - 3), w.reserve);
            Assert.AreEqual(1, h.fx.Count(WeaponNote.Loaded));
            Assert.IsFalse(h.sm.CommitLoad(), "同一次换弹只加一次");
            Assert.IsTrue(h.sm.Reloading, "换弹动作还在收尾");
            h.Idle(def.reloadTime + 0.1f);
            Assert.IsFalse(h.sm.Reloading);
            Assert.AreEqual(def.mag, w.mag, "到时不再重复加");
            Assert.AreEqual(reserve0 - (def.mag - 3), w.reserve);
            Assert.AreEqual(1, h.fx.Count(WeaponNote.Reloaded));
        }

        [Test]
        public void ReloadWithoutRigStillLoadsAtTheEnd()
        {
            var def = WeaponLibrary.Get("rifle");
            var w = new WeaponInstance(def) { mag = 0 };
            var h = new Host(w);
            h.Frame(reload: true);
            h.Idle(def.reloadTime * 0.9f);
            Assert.AreEqual(0, w.mag, "没有动画事件时到时才加（原行为）");
            h.Idle(def.reloadTime * 0.2f + 0.1f);
            Assert.AreEqual(def.mag, w.mag);
            Assert.AreEqual(0, h.fx.Count(WeaponNote.Loaded));
        }

        [Test]
        public void SwitchingAfterTheMagSeatsKeepsTheAmmo()
        {
            var def = WeaponLibrary.Get("smg");
            var w = new WeaponInstance(def) { mag = 0 };
            var other = new WeaponInstance(WeaponLibrary.Get("revolver"));
            var h = new Host(w, other);
            h.Frame(reload: true);
            h.sm.CommitLoad();
            Assert.IsTrue(h.sm.SwitchTo(1));
            Assert.IsFalse(h.sm.Reloading);
            Assert.AreEqual(def.mag, w.mag, "弹匣已经入位：切走也保留");
            Assert.AreEqual(1, h.fx.Count(WeaponNote.ReloadPartial), "算一次换弹（秘卷的换弹钩子照常触发）");
            Assert.AreEqual(0, h.fx.Count(WeaponNote.Racked), "整匣换弹没有上膛动作");
        }

        [Test]
        public void ShellReloadIgnoresCommitLoad()
        {
            var w = new WeaponInstance(WeaponLibrary.Get("shotgun")) { mag = 0 };
            var h = new Host(w);
            h.Frame(reload: true);
            Assert.IsTrue(h.sm.ShellReload);
            Assert.IsFalse(h.sm.CommitLoad(), "逐发装填按每一发的时间压弹");
            Assert.AreEqual(0, w.mag);
        }

        // ───────────── 零件绑定 ─────────────

        /// <summary>假枪模：根上挂 WeaponSockets（同 W3 生成的 Prefab），弹匣骨骼 + 挂点</summary>
        Transform FakeGun(string prefab, out Transform mag, out Transform grip, out Transform load)
        {
            var gun = Track(new GameObject(prefab)).transform;
            var jr = new GameObject("j_r").transform;
            jr.SetParent(gun, false);
            mag = new GameObject("mag").transform;
            mag.SetParent(jr, false);
            mag.localPosition = new Vector3(0, 0.004f, -0.11f);
            grip = new GameObject(WeaponSockets.LeftGrip).transform;
            grip.SetParent(jr, false);
            grip.localPosition = new Vector3(0, 0.02f, -0.235f);
            load = new GameObject(WeaponSockets.Load).transform;
            load.SetParent(mag, false);
            load.localPosition = new Vector3(0.015f, -0.074f, 0);
            var s = gun.gameObject.AddComponent<WeaponSockets>();
            s.weaponId = "smg";
            s.leftGrip = grip;
            s.load = load;
            s.partNames = new[] { "mag" };
            s.parts = new[] { mag };
            return gun;
        }

        [Test]
        public void SocketsResolveThroughComponentAndByName()
        {
            var gun = FakeGun("SK_Weapon_Smg", out var mag, out var grip, out _);
            Assert.AreEqual(grip, WeaponSockets.Find(gun, WeaponSockets.LeftGrip));
            Assert.AreEqual(mag, WeaponSockets.Find(gun, "mag"));
            Assert.IsNull(WeaponSockets.Find(gun, "pump"));
            Object.DestroyImmediate(gun.GetComponent<WeaponSockets>());
            Assert.AreEqual(grip, WeaponSockets.Find(gun, WeaponSockets.LeftGrip), "没有组件时按名字找");
        }

        [Test]
        public void HandRigRestsOnTheGripSocket()
        {
            var def = WeaponLibrary.Get("smg");
            var gun = FakeGun(def.prefab, out _, out var grip, out _);
            var arm = new GameObject("arm_l").transform;
            arm.SetParent(gun, false);
            var rigGo = Track(new GameObject("FP Rig smg"));
            var hand = rigGo.AddComponent<WeaponHandRig>();
            hand.Bind(def, HandlingProfile.For("smg"), gun, arm);
            Assert.That(Vector3.Distance(arm.localPosition, grip.localPosition), Is.LessThan(1e-5f), "左手在握点");
            Assert.Less(Quaternion.Angle(arm.localRotation, Quaternion.Euler(0, 0, -def.leftRoll * Mathf.Rad2Deg)), 0.05f,
                "静止时 IK 不改摆好的握持姿势");
        }

        [Test]
        public void PartAnimatorBindsMagButLeavesTrinityCylinderAlone()
        {
            var def = WeaponLibrary.Get("smg");
            var gun = FakeGun(def.prefab, out var mag, out _, out _);
            var anim = Track(new GameObject("FP Rig smg")).AddComponent<WeaponPartAnimator>();
            anim.Bind(def, HandlingProfile.For("smg"), gun);
            Assert.AreEqual(mag, anim.Mag);
            Assert.IsNull(anim.Cylinder);

            var tri = WeaponLibrary.Get("trinity");
            var tgun = Track(new GameObject(tri.prefab)).transform;
            var cyl = new GameObject("cylinder").transform;
            cyl.SetParent(tgun, false);
            var tanim = Track(new GameObject("FP Rig trinity")).AddComponent<WeaponPartAnimator>();
            tanim.Bind(tri, HandlingProfile.For("trinity"), tgun);
            Assert.IsNull(tanim.Cylinder, "三才的转轮归 TrinityCycle");
            Assert.IsNull(tanim.Mag, "转轮兼弹匣时不按弹匣动");
        }
    }
}
