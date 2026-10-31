using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃背后的日轮（docs/level-design/unity-maps-v1.md 第 3 节「巨大的白金日轮」；docs/art/boss-hanba.md 第 4、7 节）：
    ///   · 模型：正式美术 SK_Boss_Hanba 上由 <see cref="Bosses"/> 按 ArtAssetInfo.bind 挂到 socket_sunring 的 SM_BossPart_HanbaSunRing；
    ///     场景目录里没有这个挂件时，自己从 GameDatabase 取 Prefab；代理模型（SK_Enemy_Apsara × 3.5）/ 占位体没有挂点，
    ///     就立一个白盒日轮（十六块金色轮齿 + 轮毂，4.11 占位策略），世界尺寸与正式日轮一致（直径约 6 m）。
    ///   · 跟随（概念图 DS_desert_hanba_v001：日轮悬在身后、不贴身）：挂件从 socket_sunring 上摘下来，换到首领根节点下的跟随支点——
    ///     socket_sunring 进 Unity 后的朝向让轮面是水平的（日轮平躺着套在脖子上），而且它挂在 chest 上，弯腰、扭身、受击后仰、转头转腰都会带着 6 m 的轮子扫进长发和身体。
    ///     支点每帧自己写世界位姿：跟模型根节点（悬浮、登场升起、死亡下沉都在它上面）和骨盆的位移（按地前冲、倒地蜷缩），
    ///     位置滞后 <see cref="followLag"/>、只跟偏航（滞后 <see cref="turnLag"/>），自己再上下浮动、轻轻前后摆；轮心在头顶附近、身后 <see cref="followBehind"/>。
    ///   · 不穿模：每帧把身体骨骼（含残衣 / 长发 / 袖垂片的弹簧骨，每个采样点按部位留一圈皮肉余量 <see cref="Margin"/>）换到日轮的坐标里，
    ///     落在轮面范围里的点都必须在轮子前面；不够就把日轮往后推（先留 <see cref="clearance"/> 的余量平滑退开，再硬保底），身体离开后慢慢回到原位。
    ///   · 旋转：绕轮面法线（日轮本地 Z）慢转；<see cref="SetBlaze"/> 的 spin 倍率让扫射、狂怒时转得更快。
    ///   · 炽度 <see cref="Blaze"/>（0–1，平滑追目标）：轮心一团加色光晕跟着亮；<see cref="SunExposure"/> 按它放大日轮直射的距离。
    ///     平涂的日轮本身不发光（美术约定），发光全在这层。
    ///   · 日蚀（<see cref="SetEclipse"/>，三阶段「日蚀」招式）：炽度掐到 0，轮毂前立一块黑盘（月影），只剩一圈淡金色日冕；
    ///     <see cref="Eclipsed"/> 期间日轮不直射（<see cref="SunExposure.RingLit"/>）。
    ///   · 升顶（<see cref="Rise"/>，三阶段「赤地千里」）：日轮离开跟随支点（换挂到一个世界空间的支点，不再跟身体走），沿弧线升到穴顶裂缝口、
    ///     轮面朝下、放大，并点一盏投影的点光（整个泉床被它照亮，岩岛、月牙阁投下影子）；<see cref="Center"/> 随之落在裂缝口，日晒的日轮直射从那里算。
    ///   · 坠落（<see cref="Fall"/>）：首领倒下时，升起的日轮砸回地面、碎成金沙。
    /// 由 <see cref="HanbaBrain"/> 生成时挂到首领根节点上；首领倒下后熄灭、停转；物体销毁时连同升顶支点一起清掉。
    /// 执行顺序排在 CreatureRig（100）之后：防穿模读的是弹簧骨这一帧摆完的位置。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(110)]
    public sealed class SunRing : MonoBehaviour
    {
        public const string PrefabId = "SM_BossPart_HanbaSunRing", SocketName = "socket_sunring";
        /// <summary>正式日轮的世界半径（米，直径 6 m）</summary>
        public const float WorldRadius = 3f;
        /// <summary>日蚀黑盘的颜色（sRGB）：冷的靛紫黑</summary>
        public static readonly Color DiscColor = new(0.035f, 0.04f, 0.1f);

        [Tooltip("平时的转速（度 / 秒）")] public float spinSpeed = 20f;
        [Tooltip("平时的炽度（0–1）")] public float idleBlaze = 0.35f;
        [Tooltip("炽度追目标的速度（每秒）")] public float blazeRate = 3f;
        public Color glowColor = new(1f, 0.86f, 0.52f);
        [Tooltip("升顶后的体型倍率")] public float risenScale = 1.5f;
        [Tooltip("升顶点光的照射距离（米）与满炽度时的强度")] public float lightRange = 75f, lightIntensity = 6f;
        public Color lightColor = new(1f, 0.84f, 0.55f);

        [Header("跟随（长度都是模型单位，乘首领体型）")]
        [Tooltip("轮心离模型根节点多高（米；正式模型眼睛约 3.95 m、头冠尖 4.5 m，日轮半径 3 m）")] public float followHeight = 4f;
        [Tooltip("轮心在模型原点身后多远（米；身体中线在原点前 0.37 m，长发垂到原点身后约 0.55 m，轮毂半厚 0.62 m）")] public float followBehind = 1.8f;
        [Tooltip("位置跟随的滞后（秒）")] public float followLag = 0.25f;
        [Tooltip("朝向跟随的滞后（秒）与最多落后的角度（度：急转身时轮子不会甩到身体侧面）")] public float turnLag = 0.2f, maxTurnLag = 25f;
        [Tooltip("位置最多拖在身体后面多远（米）")] public float maxTrail = 1.5f;
        [Tooltip("上下浮动的幅度（米）与频率（Hz）")] public float floatAmp = 0.12f, floatRate = 0.3f;
        [Tooltip("前后轻摆的幅度（度）")] public float swayDeg = 1.2f;
        [Tooltip("身体贴近时日轮退开后留的余量（米）")] public float clearance = 0.3f;

        /// <summary>防穿模的骨骼采样点：b 不为空时取 a→b 线段上 t 处；b 为空时沿父骨 → a 的方向外推 t 倍（末节骨没有尾端节点）；margin = 皮肉余量（世界米）</summary>
        struct Probe
        {
            public Transform a, b;
            public float t, margin;
        }

        Transform ring, glow, anchor, disc, follow, origin, hips;
        Renderer glowR, discR;
        Light sun;
        Quaternion baseRot = Quaternion.identity, riseRotFrom, riseRotTo, followYaw = Quaternion.identity;
        Vector3 riseFrom, riseTo, fallTo, followOrigin, followVel, hipsRest;
        float angle, blazeTarget, spinMult = 1f, spinNow = 1f, riseT, riseSeconds = 1f, scaleFrom = 1f, scaleTo = 1f, fallT, fallSeconds = 1f, glowBoost = 1f;
        // 跟随：轮心相对模型根节点的高度、身后距离（世界米）；日轮外半径、半厚（世界米，Bind 时按网格包围盒量）；当前想要的身后距离
        float offH, offD, ringRw = WorldRadius, ringHalfW = 0.62f, depthWant, floatT;
        bool dead, rising, falling, followSnap;
        readonly List<Probe> probes = new();

        /// <summary>日轮这一层的来源：正式挂件 / 自己挂上的 Prefab / 白盒</summary>
        public enum Source { None, Attached, Spawned, Whitebox }

        public Source From { get; private set; }
        /// <summary>转动的那一层（挂件实例或白盒根）</summary>
        public Transform Ring => ring;
        /// <summary>日轮的支点（跟随支点；升顶后是世界空间的升顶支点）</summary>
        public Transform Pivot => ring ? ring.parent : transform;
        /// <summary>轮心（世界坐标）</summary>
        public Vector3 Center => ring ? ring.position : transform.position + Vector3.up * 4f;
        /// <summary>轮面朝向（世界，轮面法线）</summary>
        public Vector3 Facing => ring ? ring.forward : transform.forward;
        /// <summary>当前炽度 0–1</summary>
        public float Blaze { get; private set; }
        public float BlazeTarget => blazeTarget;
        /// <summary>累计转过的角度（度，测试看它在不在转）</summary>
        public float Angle => angle;
        /// <summary>日蚀中（熄灭、不直射）</summary>
        public bool Eclipsed { get; private set; }
        /// <summary>已经升顶（升的途中也算）；<see cref="RiseProgress"/> 0 → 1</summary>
        public bool Risen { get; private set; }
        public float RiseProgress => !Risen ? 0 : rising ? Mathf.Clamp01(riseT / Mathf.Max(0.01f, riseSeconds)) : 1f;
        /// <summary>升顶的目标点（世界）</summary>
        public Vector3 RiseTarget => riseTo;
        /// <summary>升顶点光（没升顶为 null）</summary>
        public Light SunLight => sun;
        /// <summary>坠落砸地、碎掉了</summary>
        public bool Shattered { get; private set; }

        /// <summary>日轮正跟着身体走（挂在跟随支点上、没升顶）</summary>
        public bool Following => follow && ring && ring.parent == follow;
        /// <summary>轮心此刻在身体后面多远（世界米，沿日轮朝向，从骨盆位移后的身体原点算）</summary>
        public float Depth { get; private set; }
        /// <summary>骨骼采样估出的、不穿模至少要的身后距离（世界米）；<see cref="Depth"/> − 它 = 估计的间隙</summary>
        public float DepthNeeded { get; private set; }
        /// <summary>防穿模的骨骼采样点个数（0 = 没找到蒙皮骨骼，只靠固定的身后距离）</summary>
        public int ProbeCount => probes.Count;
        /// <summary>日轮外半径、半厚（世界米，跟随时的尺寸）</summary>
        public float RingRadius => ringRw;
        public float RingHalfThickness => ringHalfW;

        /// <summary>找 / 挂日轮（首领生成后、模型已就位时调一次；换形后可以再调）</summary>
        public void Bind(BossBrain b)
        {
            dead = false;
            Eclipsed = Risen = rising = falling = Shattered = false;
            glowBoost = 1f;
            if (anchor) Destroy(anchor.gameObject);
            anchor = null;
            disc = null;
            sun = null;
            blazeTarget = Blaze = idleBlaze;
            var model = b ? b.Model : null;
            var root = model?.root ? model.root.transform : transform;
            origin = root;
            // 换形重挂：旧支点连同上面的日轮一起扔掉（挂件已经不在模型上了，下面会按挂点重新生成一个）
            if (follow)
            {
                follow.SetParent(null, false);
                Destroy(follow.gameObject);
            }
            follow = new GameObject("Sun Ring Follow").transform;
            follow.SetParent(transform, false);
            ring = null;
            From = Source.None;
            var socket = FindChild(root, SocketName);
            // 1. 正式挂件（Bosses.AttachParts 按 bind 挂好的）
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == PrefabId || t.name.StartsWith(PrefabId + " "))
                {
                    ring = t;
                    From = Source.Attached;
                    if (t.parent) socket = t.parent;
                    break;
                }
            // 2. 有挂点、没挂件：自己生成一个
            if (!ring)
            {
                var prefab = socket ? Bosses.FindPrefab(PrefabId) : null;
                if (socket && prefab)
                {
                    var inst = Instantiate(prefab, follow, false);
                    inst.name = PrefabId;
                    foreach (var c in inst.GetComponentsInChildren<Collider>(true))
                    {
                        c.enabled = false;
                        Destroy(c);
                    }
                    ring = inst.transform;
                    From = Source.Spawned;
                }
            }
            float s = Mathf.Max(1e-4f, Mathf.Abs(root.lossyScale.y));
            if (ring)
            {
                // 从挂点上摘下来：支点的世界缩放和挂点一样，日轮的尺寸不变
                float ws = socket ? Mathf.Abs(socket.lossyScale.x) : s;
                follow.localScale = Vector3.one * (ws / Mathf.Max(1e-4f, Mathf.Abs(transform.lossyScale.x)));
                if (From == Source.Attached) ring.SetParent(follow, false);
                ring.localPosition = Vector3.zero;
                offH = followHeight * s;
                offD = followBehind * s;
            }
            // 3. 代理 / 占位：身后上方立一个白盒日轮
            else ring = BuildWhitebox(b);
            baseRot = ring.localRotation;
            MeasureRing();
            BuildProbes(root, s);
            followSnap = true;
            Follow(0);
            BuildGlow();
        }

        static Transform FindChild(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name)
                    return t;
            return null;
        }

        /// <summary>白盒日轮：世界尺寸（不随代理体型缩放），在身体中心之上 0.3 倍身高、身后 1.4 m；十六块轮齿 + 一圈轮毂</summary>
        Transform BuildWhitebox(BossBrain b)
        {
            From = Source.Whitebox;
            var cap = b ? b.GetComponent<CapsuleCollider>() : null;
            float h = cap ? cap.height * Mathf.Abs(transform.lossyScale.y) : 4.5f;
            offH = (cap ? cap.center.y * Mathf.Abs(transform.lossyScale.y) : 0f) + h * 0.3f;
            offD = 1.4f;
            follow.localScale = Vector3.one / Mathf.Max(1e-4f, Mathf.Abs(transform.lossyScale.x));
            var r = new GameObject("Sun Ring (whitebox)").transform;
            r.SetParent(follow, false);
            var gold = new Color(0.95f, 0.78f, 0.38f);
            const int teeth = 16;
            for (int i = 0; i < teeth; i++)
            {
                float a = i * Mathf.PI * 2 / teeth;
                var piece = PropBits.Box(r, $"Tooth {i + 1}", new Vector3(Mathf.Sin(a), Mathf.Cos(a), 0) * WorldRadius * 0.9f, new Vector3(0.55f, 1.1f, 0.35f), gold);
                piece.transform.localRotation = Quaternion.Euler(0, 0, -a * Mathf.Rad2Deg);
                piece.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            var hub = PropBits.Cylinder(r, "Hub", Vector3.zero, new Vector3(1.4f, 0.4f, 1.4f), new Color(0.7f, 0.5f, 0.25f));
            hub.transform.localRotation = Quaternion.Euler(90, 0, 0);
            hub.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return r;
        }

        /// <summary>日轮的外半径、半厚（世界米）：各网格包围盒的角点换到日轮坐标里，取轮面内 |x|、|y| 的最大值和 |z| 的最大值</summary>
        void MeasureRing()
        {
            float r = 0, z = 0;
            bool any = false;
            var toRing = ring.worldToLocalMatrix;
            foreach (var mf in ring.GetComponentsInChildren<MeshFilter>(true))
            {
                var mesh = mf.sharedMesh;
                if (!mesh) continue;
                var m = toRing * mf.transform.localToWorldMatrix;
                var bb = mesh.bounds;
                for (int i = 0; i < 8; i++)
                {
                    var corner = bb.center + Vector3.Scale(bb.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    var p = m.MultiplyPoint3x4(corner);
                    r = Mathf.Max(r, Mathf.Abs(p.x), Mathf.Abs(p.y));
                    z = Mathf.Max(z, Mathf.Abs(p.z));
                    any = true;
                }
            }
            float s = Mathf.Abs(ring.lossyScale.x);
            ringRw = any ? r * s : WorldRadius;
            ringHalfW = any ? z * s : 0.62f;
        }

        /// <summary>防穿模的采样点：模型身上蒙皮骨骼（不含挂点）的关节、到每个子骨的中点；末节骨沿父骨方向外推半节、一节；再找骨盆</summary>
        void BuildProbes(Transform root, float s)
        {
            probes.Clear();
            hips = null;
            var bones = new HashSet<Transform>();
            foreach (var smr in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (smr.name.IndexOf("GlowShell", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                foreach (var t in smr.bones)
                    if (t && !t.name.StartsWith("socket_", StringComparison.Ordinal))
                        bones.Add(t);
            }
            foreach (var t in bones)
            {
                float m = Margin(t.name) * s;
                bool leaf = true;
                for (int i = 0; i < t.childCount; i++)
                {
                    var c = t.GetChild(i);
                    if (!bones.Contains(c)) continue;
                    leaf = false;
                    probes.Add(new Probe { a = t, b = c, t = 0.5f, margin = m });
                }
                probes.Add(new Probe { a = t, margin = m });
                if (leaf && t.parent && bones.Contains(t.parent))
                {
                    probes.Add(new Probe { a = t, t = 0.5f, margin = m });
                    probes.Add(new Probe { a = t, t = 1f, margin = m });
                }
            }
            var anim = root.GetComponentInChildren<Animator>(true);
            if (anim && anim.isHuman) hips = anim.GetBoneTransform(HumanBodyBones.Hips);
            if (!hips)
            {
                var rig = root.GetComponentInChildren<CreatureRig>(true);
                if (rig) hips = rig.pelvis;
            }
            // 刚生成时模型还是绑定姿势：骨盆的静止位置按这时记
            if (hips) hipsRest = root.InverseTransformPoint(hips.position);
        }

        /// <summary>骨骼采样点外面的一圈皮肉（米，模型单位）：头（连头冠）、躯干、长发厚，残衣 / 袖垂片薄（链在衣片外缘），四肢、手脚细</summary>
        static float Margin(string bone)
        {
            var n = bone.ToLowerInvariant();
            if (n.StartsWith("head")) return 0.4f;
            if (n.StartsWith("hair")) return 0.35f;
            if (n.StartsWith("skirt") || n.StartsWith("sleeve")) return 0.18f;
            if (n.StartsWith("hand") || n.StartsWith("foot") || n.StartsWith("toe") || n.StartsWith("thumb") || n.StartsWith("index") ||
                n.StartsWith("middle") || n.StartsWith("ring") || n.StartsWith("pinky")) return 0.1f;
            if (n.StartsWith("arm") || n.StartsWith("forearm") || n.StartsWith("thigh") || n.StartsWith("shin")) return 0.16f;
            return 0.3f;
        }

        /// <summary>
        /// 跟随支点的世界位姿（见类注释）：身体原点滞后跟随、偏航滞后跟随，轮心 = 原点 + 偏航 × (骨盆位移, 高度 + 浮动, 身后距离)；
        /// 身后距离取「平时的距离」和「骨骼采样要求的距离 + 余量」里大的那个，平滑地退开 / 回来，最后不低于硬要求。dt = 0 时直接摆到位
        /// </summary>
        void Follow(float dt)
        {
            if (!Following) return;
            var o = origin ? origin : transform;
            float s = Mathf.Max(1e-4f, Mathf.Abs(o.lossyScale.y));
            var fwd = o.forward;
            fwd.y = 0;
            var yaw = fwd.sqrMagnitude > 1e-6f ? Quaternion.LookRotation(fwd.normalized, Vector3.up) : followYaw;
            var at = o.position;
            // 刚挂上 / 瞬移（测试挪首领、登场把模型压到泉下）：直接到位，不拖一大段
            if (followSnap || !(dt > 0) || (at - followOrigin).sqrMagnitude > 25f * s * s)
            {
                followOrigin = at;
                followVel = Vector3.zero;
                followYaw = yaw;
                followSnap = false;
            }
            else
            {
                followOrigin = Vector3.SmoothDamp(followOrigin, at, ref followVel, Mathf.Max(0.01f, followLag), Mathf.Infinity, dt);
                var trail = followOrigin - at;
                if (trail.sqrMagnitude > maxTrail * maxTrail * s * s) followOrigin = at + trail.normalized * (maxTrail * s);
                followYaw = Quaternion.Slerp(followYaw, yaw, 1f - Mathf.Exp(-dt / Mathf.Max(0.01f, turnLag)));
                float behind = Quaternion.Angle(followYaw, yaw);
                if (behind > maxTurnLag) followYaw = Quaternion.RotateTowards(followYaw, yaw, behind - maxTurnLag);
            }
            floatT += Mathf.Max(0, dt);
            float ph = floatT * floatRate * Mathf.PI * 2f;
            var inv = Quaternion.Inverse(followYaw);
            // 身体中心的位移（按地前冲、倒地蜷缩）：骨盆离静止位置多远，水平跟八成五、竖直跟四成
            var shift = Vector3.zero;
            if (hips)
            {
                var d = inv * (hips.position - o.TransformPoint(hipsRest));
                shift = Vector3.ClampMagnitude(new Vector3(d.x * 0.85f, d.y * 0.4f, d.z * 0.85f), 2f * s);
            }
            float cx = shift.x, cz = shift.z;
            float cy = Mathf.Max(offH + shift.y + Mathf.Sin(ph) * floatAmp * s, ringRw + 0.15f * s);
            // 防穿模：轮面范围里的采样点都要在轮子前面——轮心至少在它们身后「半厚 + 余量」（轻摆让轮缘多出来的一点也算进半厚）
            float need = 0, half = ringHalfW + ringRw * Mathf.Sin(swayDeg * Mathf.Deg2Rad);
            foreach (var p in probes)
            {
                if (!p.a) continue;
                Vector3 w;
                if (p.b) w = Vector3.LerpUnclamped(p.a.position, p.b.position, p.t);
                else if (p.t > 0 && p.a.parent) w = p.a.position + (p.a.position - p.a.parent.position) * p.t;
                else w = p.a.position;
                var rel = inv * (w - followOrigin);
                float dx = rel.x - cx, dy = rel.y - cy, reach = ringRw + p.margin;
                if (dx * dx + dy * dy > reach * reach) continue;
                need = Mathf.Max(need, half + p.margin - (rel.z - cz));
            }
            DepthNeeded = need;
            float want = Mathf.Max(offD, need + clearance * s);
            depthWant = !(dt > 0) ? want : Mathf.MoveTowards(depthWant, want, (want > depthWant ? 8f : 1.2f) * s * dt);
            Depth = Mathf.Max(depthWant, need + 0.02f * s);
            var sway = Quaternion.Euler(Mathf.Sin(ph + 1.3f) * swayDeg, 0, 0);
            follow.SetPositionAndRotation(followOrigin + followYaw * new Vector3(cx, cy, cz - Depth), followYaw * sway);
        }

        void BuildGlow()
        {
            if (glow) Destroy(glow.gameObject);
            if (!ring) return;
            // 光晕挂在支点上（不跟着转），尺寸按世界米：支点的缩放除回去
            var parent = Pivot;
            float s = Mathf.Max(1e-3f, parent.lossyScale.x);
            glow = FxMaterials.GlowSprite(parent, WorldRadius * 3.2f / s, glowColor);
            glow.name = "Sun Ring Glow";
            glow.position = Center;
            glowR = glow.GetComponent<Renderer>();
        }

        /// <summary>炽度目标（0–1）与转速倍率；首领倒下后、日蚀中无效</summary>
        public void SetBlaze(float target, float spin = 1f)
        {
            if (dead || Eclipsed) return;
            blazeTarget = Mathf.Clamp01(target);
            spinMult = Mathf.Max(0, spin);
        }

        /// <summary>回到平时的炽度与转速</summary>
        public void Idle() => SetBlaze(idleBlaze, 1f);

        /// <summary>立刻亮到 value（招式出手的那一下闪）；日蚀中无效</summary>
        public void Flash(float value = 1f)
        {
            if (dead || Eclipsed) return;
            Blaze = Mathf.Max(Blaze, Mathf.Clamp01(value));
        }

        /// <summary>首领倒下：熄灭、慢慢停转（日蚀黑盘收起）</summary>
        public void Extinguish()
        {
            dead = true;
            blazeTarget = 0;
            spinMult = 0;
            Eclipsed = false;
            SetDisc(false);
        }

        // ───────────── 日蚀 ─────────────

        /// <summary>
        /// 日蚀开关：开 = 炽度立刻掐到 0、转速降到两成、轮毂前立起黑盘（月影）、点光压暗；关 = 黑盘收起，炽度回到平时（复燃的强光由招式另外 <see cref="Flash"/>）
        /// </summary>
        public void SetEclipse(bool on)
        {
            if (dead && on) return;
            Eclipsed = on;
            if (on)
            {
                blazeTarget = 0;
                Blaze = 0;
                spinMult = 0.2f;
            }
            else if (!dead)
            {
                blazeTarget = idleBlaze;
                spinMult = 1f;
            }
            SetDisc(on);
        }

        void SetDisc(bool on)
        {
            if (on && !disc && ring)
            {
                // 黑盘：不受光的扁圆柱，挂在支点上（不跟着转），每帧摆到轮心前方、轮面朝向
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                var col = go.GetComponent<Collider>();
                if (col)
                {
                    col.enabled = false;
                    Destroy(col);
                }
                go.name = "Sun Ring Eclipse Disc";
                go.layer = Layers.IgnoreRaycast;
                disc = go.transform;
                disc.SetParent(Pivot, false);
                discR = go.GetComponent<Renderer>();
                discR.sharedMaterial = FxMaterials.Unlit;
                // 冷黑（偏靛紫，不是暖黑）：和身上烧亮的白金裂光、黑盘后面的金色日冕拉开冷暖
                FxMaterials.Tint(discR, DiscColor);
            }
            if (disc) disc.gameObject.SetActive(on);
            if (on) PlaceDisc();
        }

        void PlaceDisc()
        {
            if (!disc || !ring) return;
            float k = Risen ? Mathf.Lerp(1f, risenScale, RiseProgress) : 1f;
            float world = WorldRadius * 1.25f * k;
            float s = Mathf.Max(1e-3f, disc.parent ? disc.parent.lossyScale.x : 1f);
            // 立在轮毂正面之前（轮毂两面凸起、半厚约 0.6 m：只往前挪 0.15 m 时轮毂会从黑盘中间穿出来一块金色圆面）
            disc.position = Center + Facing * (ringHalfW * k + 0.05f);
            disc.rotation = Quaternion.FromToRotation(Vector3.up, Facing);
            disc.localScale = new Vector3(world * 2f / s, 0.05f / s, world * 2f / s);
        }

        // ───────────── 升顶 / 坠落 ─────────────

        /// <summary>
        /// 升顶：日轮（连光晕）换挂到一个世界空间支点上，seconds 秒内沿弧线升到 worldTarget、轮面转成朝下、放大到 <see cref="risenScale"/>，
        /// 并点一盏投影的点光。支点挂在首领的父节点下（跟关卡场景一起卸载），首领物体销毁时一起清掉。已升顶时只改目标
        /// </summary>
        public void Rise(Vector3 worldTarget, float seconds)
        {
            if (dead || !ring) return;
            if (!anchor)
            {
                anchor = new GameObject("Sun Ring Anchor (risen)").transform;
                anchor.SetParent(transform.parent, false);
                // 支点 = 日轮当前的世界位置 + 去掉自转的朝向；日轮挂上去以后，本地旋转只剩自转
                anchor.SetPositionAndRotation(ring.position, Pivot.rotation * baseRot);
                ring.SetParent(anchor, true);
                ring.localPosition = Vector3.zero;
                baseRot = Quaternion.identity;
                if (glow) glow.SetParent(anchor, true);
                if (disc) disc.SetParent(anchor, true);
                var lightGo = new GameObject("Sun Ring Light");
                lightGo.transform.SetParent(anchor, false);
                sun = lightGo.AddComponent<Light>();
                sun.type = LightType.Point;
                sun.range = lightRange;
                sun.color = lightColor;
                sun.intensity = 0;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 0.85f;
            }
            Risen = true;
            rising = true;
            riseT = 0;
            riseSeconds = Mathf.Max(0.05f, seconds);
            riseFrom = anchor.position;
            riseRotFrom = anchor.rotation;
            riseTo = worldTarget;
            // 轮面法线（本地 Z）朝下，轮的「上」朝北
            riseRotTo = Quaternion.LookRotation(Vector3.down, Vector3.forward);
            scaleFrom = anchor.localScale.x;
            scaleTo = Mathf.Max(0.1f, risenScale);
            glowBoost = 1.8f;
        }

        /// <summary>升起的日轮砸回 ground（首领倒下）：seconds 秒加速坠落，落地碎成金沙、熄灯、隐去；没升顶时什么都不做</summary>
        public void Fall(Vector3 ground, float seconds = 1.1f)
        {
            if (!Risen || !anchor || Shattered) return;
            rising = false;
            falling = true;
            fallT = 0;
            fallSeconds = Mathf.Max(0.05f, seconds);
            riseFrom = anchor.position;
            fallTo = ground + Vector3.up * WorldRadius * 0.6f;
        }

        void StepRise(float dt)
        {
            if (rising && anchor)
            {
                riseT += dt;
                float u = Mathf.Clamp01(riseT / riseSeconds);
                float e = u * u * (3 - 2 * u);
                anchor.position = Vector3.Lerp(riseFrom, riseTo, e) + Vector3.up * Mathf.Sin(u * Mathf.PI) * 2f;
                anchor.rotation = Quaternion.Slerp(riseRotFrom, riseRotTo, e);
                anchor.localScale = Vector3.one * Mathf.Lerp(scaleFrom, scaleTo, e);
                if (u >= 1f) rising = false;
            }
            if (falling && anchor)
            {
                fallT += dt;
                float u = Mathf.Clamp01(fallT / fallSeconds);
                anchor.position = Vector3.Lerp(riseFrom, fallTo, u * u);
                anchor.Rotate(Vector3.right, 140f * dt, Space.World);
                if (u >= 1f) Shatter();
            }
            if (sun)
            {
                float k = Eclipsed ? 0.04f : Blaze;
                sun.intensity = dead ? Mathf.MoveTowards(sun.intensity, 0, lightIntensity * dt) : lightIntensity * RiseProgress * (0.25f + 0.75f * k);
            }
        }

        void Shatter()
        {
            falling = false;
            Shattered = true;
            var at = anchor ? anchor.position : Center;
            Fx.Burst(at, new Color(0.95f, 0.78f, 0.38f), 40, 11f, 1.3f, 0.4f, 12f);
            Fx.Burst(at, HanbaDef.Sand, 30, 7f, 1.1f, 0.5f, 6f);
            Fx.Ring(new Vector3(at.x, Fx.GroundY(at), at.z) + Vector3.up * 0.1f, 9f, HanbaDef.Sun, 0.8f);
            CameraShake.Quake(at, 0.7f, 70f, 0.6f);
            GameAudio.PlayAt("boss_slam", at, 1f, 0.7f);
            GameAudio.PlayAt("explosion", at, 0.9f, 0.6f);
            if (anchor) anchor.gameObject.SetActive(false);
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0) || !ring) return;
            Follow(dt);
            StepRise(dt);
            Blaze = Mathf.MoveTowards(Blaze, blazeTarget, blazeRate * dt);
            spinNow = Mathf.MoveTowards(spinNow, spinMult, 2f * dt);
            angle += spinSpeed * spinNow * dt;
            ring.localRotation = baseRot * Quaternion.Euler(0, 0, angle);
            if (Eclipsed) PlaceDisc();
            if (glow)
            {
                glow.position = Center;
                if (glowR)
                {
                    var c = glowColor;
                    // 日蚀：只剩一圈淡淡的日冕
                    c.a = Eclipsed ? 0.1f : Mathf.Clamp01(0.08f + Blaze * 0.75f) * (0.9f + 0.1f * Mathf.Sin(Time.time * 6.3f));
                    FxMaterials.Tint(glowR, c);
                }
                float k = (0.55f + Blaze * 0.65f) * (Eclipsed ? 1.15f : glowBoost);
                float s = Mathf.Max(1e-3f, glow.parent ? glow.parent.lossyScale.x : 1f);
                glow.localScale = Vector3.one * (WorldRadius * 3.2f * k / s);
            }
        }

        void OnDestroy()
        {
            if (anchor) Destroy(anchor.gameObject);
        }
    }
}
