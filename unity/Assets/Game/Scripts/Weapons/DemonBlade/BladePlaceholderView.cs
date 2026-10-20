using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃第一人称的占位视图（WC6；正式的 BladeView 在 WC7：三段斩剪辑、剑指手势、刀光）。
    /// 一把「悬在右手位置」的刀（没有手臂）：挂在主相机下、放 FirstPerson 层（由 60° 的枪模相机画），刀尖朝前上方；
    ///   斩：按段做蓄势 → 快速横 / 斜扫 → 回位的程序化转动，第三段与人刀合一时碎片沿刀线伸长（骨骼 y × 伸刃倍率）；判定帧在世界里放一道紫色刀光弧；
    ///   出窍 / 屏障 / 爆发：刀放低、举起，碎片按 <see cref="BladeShards.InHand"/> 一片片离刀、归位；
    ///   鬼眼：刀根切睁眼贴图；命中、人刀合一：碎片自发光加亮。
    /// 碎片交接（<see cref="HomeWorld"/>）同 TS：两台相机 FOV 不同，按屏幕位置把枪模相机里的位置换算到主相机的世界坐标。
    /// </summary>
    public sealed class BladePlaceholderView : MonoBehaviour, IBladeView
    {
        /// <summary>握持点（相机局部）与刀身方向（刀尖指向）</summary>
        static readonly Vector3 IdleGrip = new(0.2f, -0.25f, 0.4f);
        static readonly Vector3 IdleDir = new Vector3(-0.2f, 0.62f, 0.76f).normalized;
        const float Scale = 0.7f;

        /// <summary>三段挥砍：起势方向 → 收势方向、刀面横滚（度）、握持点起止偏移</summary>
        static readonly (Vector3 from, Vector3 to, float roll, Vector3 gripFrom, Vector3 gripTo)[] Swings =
        {
            // 一：右上 → 左下斜斩
            (new Vector3(0.55f, 0.75f, 0.35f), new Vector3(-0.65f, -0.35f, 0.65f), 25f, new Vector3(0.06f, 0.08f, 0), new Vector3(-0.12f, -0.06f, 0.05f)),
            // 二：左 → 右回斩
            (new Vector3(-0.8f, 0.15f, 0.55f), new Vector3(0.8f, 0.05f, 0.6f), -80f, new Vector3(-0.14f, 0.02f, 0), new Vector3(0.05f, -0.02f, 0.06f)),
            // 三：伸刃横扫（右 → 左，大弧）
            (new Vector3(0.85f, 0.2f, 0.45f), new Vector3(-0.9f, 0f, 0.45f), 80f, new Vector3(0.06f, 0f, -0.03f), new Vector3(-0.16f, -0.03f, 0.08f)),
        };

        Camera main, vm;
        BladeModel model;
        Vector3 gripNow = IdleGrip, dirNow = IdleDir;
        float rollNow, hitFlash, stretchNow = 1;

        /// <summary>建在 wc 的主相机下（没有相机时挂在瞄准点下）</summary>
        public static IBladeView Create(WeaponController wc)
        {
            if (!wc) return null;
            var parent = wc.eye ? wc.eye.transform : wc.Aim;
            var go = new GameObject("DemonBlade View (placeholder)");
            go.transform.SetParent(parent, false);
            var v = go.AddComponent<BladePlaceholderView>();
            v.main = wc.eye;
            v.vm = FindViewmodelCamera(wc.eye);
            v.model = BladeAssets.CreateModel(go.transform);
            v.model.transform.localScale = Vector3.one * Scale;
            PlayerFactory.SetLayer(go, Layers.FirstPerson);
            v.ApplyPose(0);
            go.SetActive(false);
            return v;
        }

        static Camera FindViewmodelCamera(Camera main)
        {
            if (!main) return null;
            foreach (var c in main.GetComponentsInChildren<Camera>(true))
                if (c != main && (c.cullingMask & (1 << Layers.FirstPerson)) != 0) return c;
            return null;
        }

        public bool Alive => this && model;

        public void Show(bool on)
        {
            if (gameObject.activeSelf == on) return;
            gameObject.SetActive(on);
            if (on && model) model.ShowAll();
        }

        public void Dispose()
        {
            if (this) Destroy(gameObject);
        }

        public void OnSlash(int index) { }

        public void OnHit(bool heavy) => hitFlash = heavy ? 1.4f : 1f;

        /// <summary>判定帧：在世界里沿视线放一道紫色刀光弧（WC7 之前代替第一人称刀光）</summary>
        public void OnStrike(int index, BladeSlash seg, bool union)
        {
            var cam = main ? main.transform : transform.parent;
            if (!cam || seg == null) return;
            var fwd = cam.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-6f) fwd = Vector3.forward;
            fwd.Normalize();
            float reach = seg.range * (union ? DemonBladeDef.UnionReach : 1);
            var center = cam.position + fwd * 0.3f + Vector3.down * 0.25f;
            float yaw = Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg;
            float arc = Mathf.Min(Mathf.PI * 0.95f, seg.halfAngle * 2.2f);
            // 一：右上 → 左下（斜）；二：左 → 右；三：伸刃大横扫
            int dir = index == 1 ? -1 : 1;
            float tilt = index == 0 ? 0.55f : index == 1 ? -0.12f : 0.04f;
            float width = index == 2 ? 0.55f : 0.35f;
            var color = Color.Lerp(BladeMeshes.Purple, Color.white, union ? 0.35f : 0.15f) * 1.6f;
            Fx.Slash(center, yaw, Mathf.Max(1.2f, reach * 0.75f), arc, dir, tilt, width, index == 2 ? 0.26f : 0.18f, color);
        }

        /// <summary>两台相机 FOV 之比（主 / 枪模）：枪模相机里的点按它放大，屏幕位置不变</summary>
        float FovRatio
        {
            get
            {
                if (!main || !vm) return 1;
                return Mathf.Tan(main.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(vm.fieldOfView * 0.5f * Mathf.Deg2Rad);
            }
        }

        Vector3 ToMainWorld(Vector3 world, out float a)
        {
            a = FovRatio;
            if (!main) return world;
            var t = main.transform;
            var local = t.InverseTransformPoint(world);
            local.x *= a;
            local.y *= a;
            return t.TransformPoint(local);
        }

        public float HomeWorld(int i, out Vector3 pos, out Quaternion rot)
        {
            if (!model)
            {
                pos = main ? main.transform.position : transform.position;
                rot = Quaternion.identity;
                return 1;
            }
            float s = model.HomeWorld(i, out var p, out rot);
            pos = ToMainWorld(p, out float a);
            return s * a;
        }

        public Vector3 RootWorld => model ? ToMainWorld(model.RootWorld, out _) : transform.position;

        public void Animate(float dt, in BladePose pose, BladeShards shards)
        {
            if (!model) return;
            hitFlash = Mathf.Max(0, hitFlash - dt * 6);
            // 姿态目标
            Vector3 dir = IdleDir, grip = IdleGrip;
            float roll = 0, stretch = Mathf.Max(1, pose.union > 0 ? Mathf.Lerp(1, pose.stretch, pose.union) : 1);
            float lambda = 14;
            if (pose.swing >= 0 && pose.swing < Swings.Length)
            {
                var s = Swings[pose.swing];
                float p = pose.swingP, h = Mathf.Clamp(pose.hitP, 0.05f, 0.9f);
                Vector3 from = s.from.normalized, to = s.to.normalized;
                if (p < h)
                {
                    // 蓄势：转到起势方向
                    float k = Ease(p / h);
                    dir = Vector3.Slerp(IdleDir, from, k);
                    grip = IdleGrip + s.gripFrom * k;
                    roll = s.roll * k;
                }
                else
                {
                    float t = (p - h) / (1 - h);
                    if (t < 0.4f)
                    {
                        // 出刀：判定帧前后快速扫过
                        float k = 1 - (1 - t / 0.4f) * (1 - t / 0.4f);
                        dir = Vector3.Slerp(from, to, k);
                        grip = IdleGrip + Vector3.Lerp(s.gripFrom, s.gripTo, k);
                        roll = s.roll;
                    }
                    else
                    {
                        // 收势：回到待机
                        float k = Ease((t - 0.4f) / 0.6f);
                        dir = Vector3.Slerp(to, IdleDir, k);
                        grip = IdleGrip + s.gripTo * (1 - k);
                        roll = s.roll * (1 - k);
                    }
                    // 第三段伸刃：出刀时碎片沿刀线展开，收势时缩回
                    if (pose.stretch > 1.01f) stretch = Mathf.Max(stretch, Mathf.Lerp(pose.stretch, 1, Mathf.Clamp01((t - 0.3f) / 0.5f)));
                }
                lambda = 40;
            }
            else
            {
                switch (pose.gesture)
                {
                    case BladeGesture.Point:
                        // 刃群在外：刀根放低、刀尖朝前（左手剑指的位置留给 WC7）
                        dir = new Vector3(0.05f, 0.25f, 0.97f).normalized;
                        grip = IdleGrip + new Vector3(0.03f, -0.06f, 0);
                        break;
                    case BladeGesture.Shield:
                        dir = new Vector3(-0.15f, 0.95f, 0.3f).normalized;
                        grip = IdleGrip + new Vector3(-0.04f, -0.04f, 0.02f);
                        roll = -60;
                        break;
                    case BladeGesture.Raise:
                        dir = new Vector3(0.1f, 1f, 0.25f).normalized;
                        grip = IdleGrip + new Vector3(0, 0.06f, 0.02f);
                        break;
                }
                // 待机呼吸
                grip.y += Mathf.Sin(Time.time * 1.6f) * 0.004f;
            }
            grip += new Vector3(0, -0.22f, -0.05f) * Mathf.Clamp01(pose.lower);
            float kk = 1 - Mathf.Exp(-lambda * dt);
            dirNow = Vector3.Slerp(dirNow, dir, kk).normalized;
            gripNow = Vector3.Lerp(gripNow, grip, kk);
            rollNow = Mathf.Lerp(rollNow, roll, kk);
            stretchNow = Mathf.Lerp(stretchNow, stretch, 1 - Mathf.Exp(-30 * dt));
            ApplyPose(rollNow);

            // 碎片：在手里的才显示（排队等出发的仍在刀上）
            for (int i = 0; i < BladeShape.ShardCount; i++) model.SetShard(i, shards == null || shards.InHand(i), stretchNow);
            model.SetAwake(Mathf.Max(pose.eye, pose.union));
            model.SetGlow(hitFlash * 0.6f + pose.union * 0.4f + (stretchNow - 1) * 0.5f);
        }

        /// <summary>模型根：握持点 + 刀尖指向 dirNow（刀身沿模型 −Z），绕刀身横滚 roll 度</summary>
        void ApplyPose(float roll)
        {
            if (!model) return;
            var rot = Quaternion.AngleAxis(roll, dirNow) * Quaternion.LookRotation(-dirNow, Vector3.up);
            model.transform.SetLocalPositionAndRotation(gripNow, rot);
        }

        static float Ease(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }
    }
}
