using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 生物的运行时动画层，叠在 Animator（采样来的关键姿势）之上，每帧动画之后按顺序执行：
    ///   1. 脚步：每条腿向下射线找地面，脚按「动画里离地多高」落到真实地面上；支撑相锁住脚掌的世界位置（防滑步）；
    ///      骨盆按最需要下探 / 抬起的那只脚整体升降。两骨解析 IK，膝 / 肘保持动画里的弯曲平面。
    ///   2. 看向：头颈链按权重转向目标（玩家），水平 / 俯仰限角、带阻尼；目标在身后时自然放开。
    ///   3. 受击：按受击方向推开脊柱链，二阶弹簧回弹，幅度随伤害缩放。
    ///   4. 弹簧骨：尾巴、飘带、袍摆、铃铛……以动画姿势为弹簧目标叠加惯性与过冲（跟着真实的加速、转身、受击摆动），
    ///      保留采样动作里的设计（蝎尾出刺仍按动画走）。
    /// 骨骼分组由编辑器 CreatureRigBuilder 按骨骼名自动识别、写进 Prefab；所有计算走显式的 Tick(dt)，编辑器里能逐帧模拟验证。
    /// Animator 同物体上的组件才能收到动画事件：OnAnimEvent(name) 转发为 AnimEvent（伤害判定、弹体、特效、音效的时刻）。
    /// </summary>
    [DefaultExecutionOrder(100)]
    public sealed class CreatureRig : MonoBehaviour
    {
        [Serializable]
        public sealed class Leg
        {
            public Transform upper, mid, end;
            [NonSerialized] public bool locked;
            [NonSerialized] public Vector3 lockPos, lastAnimEnd;
            [NonSerialized] public float weight, lockBlend;
            [Tooltip("静止姿势下脚骨（踝）离地高度：动画离地量要减去它才是真正的抬脚高度")] public float restLift;
        }

        [Serializable]
        public sealed class SpringChain
        {
            public string family;
            public Transform[] bones;
            [Range(0, 1)] public float stiffness = 0.15f;
            [Range(0, 1)] public float damping = 0.1f;
            public float gravity;
            [NonSerialized] public Vector3[] pos, prev;
        }

        [Header("References (CreatureRigBuilder)")]
        public Transform characterRoot;
        public Transform pelvis;
        public Leg[] legs = new Leg[0];
        public Transform[] lookBones = new Transform[0];
        public Transform[] spineBones = new Transform[0];
        public SpringChain[] springs = new SpringChain[0];
        public float legLength = 0.5f;

        [Header("Feet")]
        public bool feetIK = true;
        public LayerMask groundMask = ~0;
        [Tooltip("动画里离地超过腿长这个比例就当作在空中（跳跃 / 飞行），这条腿不做 IK")] public float airborneLift = 0.55f;

        [Header("Look")]
        public Transform lookTarget;
        public float lookYawLimit = 75f, lookPitchLimit = 35f;
        [Range(0, 1)] public float lookWeight = 1f;

        [Header("Hit reaction")]
        public float hitStiffness = 160f, hitDamping = 14f;

        [Header("Lean")]
        [Tooltip("转弯倾斜（度，正 = 向右压），由 CreatureLocomotion 每帧设置")] public float lean;

        public bool autoTick = true;
        public event Action<string> AnimEvent;

        float pelvisOffset, lookYaw, lookPitch, lookBlend, leanCur;
        Vector3 hitAngle, hitVel;
        Vector3 lastRootPos;
        bool initialized;

        public void OnAnimEvent(string name) => AnimEvent?.Invoke(name);

        Transform Root => characterRoot ? characterRoot : transform.parent ? transform.parent : transform;

        void LateUpdate()
        {
            if (autoTick && Application.isPlaying) Tick(Time.deltaTime);
        }

        /// <summary>一次受击：dir = 力的方向（攻击者 → 本体，世界空间），strength ≈ 伤害 / 最大生命（0.1 轻、1 重）</summary>
        public void Hit(Vector3 dir, float strength)
        {
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-6f) dir = -Root.forward;
            var axis = Vector3.Cross(Vector3.up, dir.normalized);
            hitVel += axis * Mathf.Lerp(3f, 9f, Mathf.Clamp01(strength));
        }

        /// <summary>传送 / 重生后调用：弹簧与脚锁重置到当前动画姿势</summary>
        public void ResetState()
        {
            initialized = false;
            foreach (var l in legs) { l.locked = false; l.lockBlend = 0; }
            pelvisOffset = 0;
            hitAngle = hitVel = Vector3.zero;
        }

        public void Tick(float dt)
        {
            if (dt <= 0) return;
            var root = Root;
            if (!initialized || (root.position - lastRootPos).sqrMagnitude > 4f)
            {
                InitSprings();
                foreach (var l in legs) l.lastAnimEnd = l.end ? l.end.position : Vector3.zero;
                initialized = true;
            }
            lastRootPos = root.position;
            // 转弯倾斜：骨盆绕前进轴压向弯内侧（先于脚步 IK，脚再贴回地面）
            leanCur = Mathf.Lerp(leanCur, lean, 1 - Mathf.Exp(-6f * dt));
            if (pelvis && Mathf.Abs(leanCur) > 0.05f) pelvis.rotation = Quaternion.AngleAxis(-leanCur, root.forward) * pelvis.rotation;
            if (feetIK && legs.Length > 0 && pelvis) Feet(root, dt);
            if (lookBones.Length > 0) Look(root, dt);
            HitReaction(root, dt);
            Springs(dt);
        }

        // ───────────── 脚步 ─────────────
        void Feet(Transform root, float dt)
        {
            var up = Vector3.up;
            float floor = root.position.y;
            int n = legs.Length;
            // 身体离地（飞行 / 悬浮 / 跳起）：根节点比脚下地面高出 12 厘米以上就不做脚步 IK，否则会把腿拉到地上
            bool bodyAirborne = !Physics.Raycast(root.position + up * 0.5f, Vector3.down, out var under, 0.5f + legLength * 2f, groundMask, QueryTriggerInteraction.Ignore)
                                || root.position.y - under.point.y > 0.12f;
            Span<Vector3> targets = stackalloc Vector3[n];
            Span<float> weights = stackalloc float[n];
            float minOffset = float.MaxValue;
            bool any = false;
            for (int i = 0; i < n; i++)
            {
                var l = legs[i];
                if (!l.end || !l.mid || !l.upper) continue;
                var animEnd = l.end.position;
                float lift = animEnd.y - floor;
                bool airborne = bodyAirborne || lift - l.restLift > legLength * airborneLift;
                float w = 0;
                var target = animEnd;
                var from = animEnd + up * (legLength * 0.6f);
                if (!airborne && Physics.Raycast(from, Vector3.down, out var hit, legLength * 1.6f + lift, groundMask, QueryTriggerInteraction.Ignore))
                {
                    // 脚骨（踝）在静止姿势下离脚底 restLift：落脚高度至少是「地面 + 踝高」，脚底不会插进地里。
                    // Three.js 版的 IK 把踝关节直接钉在地面上（忽略踝高），采样数据里走路时脚会陷进地里约一个踝高，这里一并纠正
                    target.y = hit.point.y + Mathf.Max(lift, l.restLift);
                    w = 1;
                    // 支撑相：动画里脚贴近地面（按静止姿势的踝高算）就锁住世界位置；动画抬脚或被拉得太远才松开。
                    // 不看脚的世界速度——片段速度与实际移动对不上时脚恰恰在滑，按速度判定会永远锁不上
                    bool stance = lift - l.restLift < legLength * 0.08f;
                    if (stance && !l.locked) { l.locked = true; l.lockPos = target; }
                    if (l.locked && (!stance || Vector2.Distance(new Vector2(l.lockPos.x, l.lockPos.z), new Vector2(target.x, target.z)) > legLength * 0.3f))
                        l.locked = false;
                    l.lockBlend = Mathf.MoveTowards(l.lockBlend, l.locked ? 1 : 0, dt * 8f);
                    if (l.lockBlend > 0)
                    {
                        var locked = new Vector3(l.lockPos.x, target.y, l.lockPos.z);
                        target = Vector3.Lerp(target, locked, l.lockBlend);
                    }
                    minOffset = Mathf.Min(minOffset, target.y - animEnd.y);
                    any = true;
                }
                l.lastAnimEnd = animEnd;
                l.weight = Mathf.MoveTowards(l.weight, w, dt * 6f);
                targets[i] = target;
                weights[i] = l.weight;
            }
            // 骨盆：按最需要下探的那只脚整体降低（上台阶时所有脚都要抬，则整体抬高），限幅、平滑
            float want = any ? Mathf.Clamp(minOffset, -legLength * 0.45f, legLength * 0.45f) : 0f;
            pelvisOffset = Mathf.Lerp(pelvisOffset, want, 1 - Mathf.Exp(-12f * dt));
            pelvis.position += up * pelvisOffset;
            for (int i = 0; i < n; i++)
            {
                var l = legs[i];
                if (!l.end || weights[i] <= 0.001f) continue;
                // 骨盆移动后，动画里的脚也跟着移动了；目标按权重在「跟着骨盆走」与「落在地面」之间插值
                var animEnd = l.end.position;
                // 够不着：动画把身体抬得比腿还高（腾跃、扑击），硬拉只会把腿拉直、脚仍悬空——这一帧当作没着地
                float reach = Vector3.Distance(l.upper.position, l.mid.position) + Vector3.Distance(l.mid.position, l.end.position);
                if (Vector3.Distance(l.upper.position, targets[i]) > reach * 0.98f)
                {
                    l.locked = false;
                    l.weight = Mathf.Min(l.weight, 0.5f);
                    continue;
                }
                var t = Vector3.Lerp(animEnd, targets[i], weights[i]);
                SolveTwoBone(l.upper, l.mid, l.end, t);
            }
        }

        /// <summary>两骨解析 IK：转 upper、mid 让 end 的关节点到 target；弯曲平面取当前（动画）姿势</summary>
        static void SolveTwoBone(Transform A, Transform B, Transform C, Vector3 t)
        {
            Vector3 a = A.position, b = B.position, c = C.position;
            float lab = (b - a).magnitude, lcb = (c - b).magnitude;
            if (lab < 1e-4f || lcb < 1e-4f) return;
            float lat = Mathf.Clamp((t - a).magnitude, 1e-4f, lab + lcb - 1e-4f);
            float acab0 = Angle(c - a, b - a), babc0 = Angle(a - b, c - b), acat0 = Angle(c - a, t - a);
            float acab1 = Mathf.Acos(Mathf.Clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
            float babc1 = Mathf.Acos(Mathf.Clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
            var axis0 = Vector3.Cross(c - a, b - a);
            if (axis0.sqrMagnitude < 1e-10f) axis0 = Vector3.Cross(c - a, A.forward);
            axis0.Normalize();
            var axis1 = Vector3.Cross(c - a, t - a);
            var r2 = axis1.sqrMagnitude > 1e-10f ? Quaternion.AngleAxis(acat0 * Mathf.Rad2Deg, axis1.normalized) : Quaternion.identity;
            var r0 = Quaternion.AngleAxis((acab1 - acab0) * Mathf.Rad2Deg, axis0);
            var r1 = Quaternion.AngleAxis((babc1 - babc0) * Mathf.Rad2Deg, axis0);
            Quaternion aG = A.rotation, bG = B.rotation, cG = C.rotation;
            A.rotation = r2 * r0 * aG;
            B.rotation = r2 * r0 * r1 * bG;
            C.rotation = cG; // 脚掌保持动画朝向（贴地角度由动画决定）
        }

        static float Angle(Vector3 u, Vector3 v)
        {
            float d = u.magnitude * v.magnitude;
            return d < 1e-10f ? 0 : Mathf.Acos(Mathf.Clamp(Vector3.Dot(u, v) / d, -1, 1));
        }

        // ───────────── 看向 ─────────────
        void Look(Transform root, float dt)
        {
            float wantYaw = 0, wantPitch = 0, wantBlend = 0;
            var head = lookBones[^1];
            if (lookTarget && head)
            {
                var dir = lookTarget.position - head.position;
                var local = Quaternion.Inverse(root.rotation) * dir;
                float yaw = Mathf.Atan2(local.x, local.z) * Mathf.Rad2Deg;
                float pitch = -Mathf.Atan2(local.y, new Vector2(local.x, local.z).magnitude) * Mathf.Rad2Deg;
                // 目标在身后（超过限角 1.6 倍）就放开，不扭断脖子
                wantBlend = Mathf.Abs(yaw) < lookYawLimit * 1.6f ? lookWeight : 0f;
                wantYaw = Mathf.Clamp(yaw, -lookYawLimit, lookYawLimit);
                wantPitch = Mathf.Clamp(pitch, -lookPitchLimit, lookPitchLimit);
            }
            float k = 1 - Mathf.Exp(-6f * dt);
            lookYaw = Mathf.Lerp(lookYaw, wantYaw, k);
            lookPitch = Mathf.Lerp(lookPitch, wantPitch, k);
            lookBlend = Mathf.Lerp(lookBlend, wantBlend, k);
            if (lookBlend < 1e-3f) return;
            var q = Quaternion.AngleAxis(lookYaw * lookBlend, Vector3.up) * Quaternion.AngleAxis(lookPitch * lookBlend, root.right);
            // 沿链分摊：颈部少、头部多（每节按 1/n 叠加，子骨骼继承父骨骼的转动）
            float share = 1f / lookBones.Length;
            foreach (var b in lookBones)
                if (b) b.rotation = Quaternion.Slerp(Quaternion.identity, q, share) * b.rotation;
        }

        // ───────────── 受击 ─────────────
        void HitReaction(Transform root, float dt)
        {
            // 二阶弹簧：角度向量 θ'' = −kθ − cθ'
            hitVel += (-hitStiffness * hitAngle - hitDamping * hitVel) * dt;
            hitAngle += hitVel * dt;
            float ang = hitAngle.magnitude;
            if (ang < 1e-4f) return;
            var chain = spineBones.Length > 0 ? spineBones : pelvis ? new[] { pelvis } : Array.Empty<Transform>();
            var q = Quaternion.AngleAxis(ang * Mathf.Rad2Deg / Mathf.Max(1, chain.Length), hitAngle / ang);
            foreach (var b in chain) if (b) b.rotation = q * b.rotation;
        }

        // ───────────── 弹簧骨 ─────────────
        void InitSprings()
        {
            foreach (var s in springs)
            {
                int n = s.bones.Length;
                s.pos = new Vector3[n];
                s.prev = new Vector3[n];
                for (int i = 0; i < n; i++) s.pos[i] = s.prev[i] = Tip(s, i);
            }
        }

        /// <summary>第 i 节骨骼的末端（下一节的位置；最后一节沿上一节方向外推同样长度的一半）</summary>
        static Vector3 Tip(SpringChain s, int i)
        {
            var b = s.bones[i];
            if (i + 1 < s.bones.Length && s.bones[i + 1]) return s.bones[i + 1].position;
            var p = b.parent ? b.parent.position : b.position - b.up * 0.05f;
            var d = b.position - p;
            return b.position + (d.sqrMagnitude > 1e-8f ? d * 0.5f : b.up * 0.05f);
        }

        void Springs(float dt)
        {
            float steps = dt * 60f;
            foreach (var s in springs)
            {
                if (s.pos == null || s.pos.Length != s.bones.Length) { InitSprings(); return; }
                float stiff = 1 - Mathf.Pow(1 - s.stiffness, steps);
                float keep = Mathf.Pow(1 - s.damping, steps);
                for (int i = 0; i < s.bones.Length; i++)
                {
                    var b = s.bones[i];
                    if (!b) continue;
                    var target = Tip(s, i);
                    var vel = (s.pos[i] - s.prev[i]) * keep;
                    s.prev[i] = s.pos[i];
                    var p = s.pos[i] + vel + Vector3.down * (s.gravity * dt * dt);
                    p += (target - p) * stiff;
                    float len = (target - b.position).magnitude;
                    var off = p - b.position;
                    p = b.position + (off.sqrMagnitude > 1e-10f ? off.normalized * len : target - b.position);
                    s.pos[i] = p;
                    var from = target - b.position;
                    var to = p - b.position;
                    if (from.sqrMagnitude > 1e-10f && to.sqrMagnitude > 1e-10f)
                        b.rotation = Quaternion.FromToRotation(from, to) * b.rotation;
                }
            }
        }
    }
}
