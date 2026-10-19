using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一只灵宠的外观：模型根、真实高度 / 最大尺寸；骨骼动画灵宠的 Animator / CreatureRig / CreatureLocomotion 与特效挂点；
    /// 以及占位体里能单独动的部件（翅膀、尾巴、龙身各节）
    /// </summary>
    public sealed class PetModel
    {
        /// <summary>docs/pet-system.md 7.3 的特效挂点（不变形骨骼）+ head</summary>
        public static readonly string[] SocketNames = { "mouth", "coin", "pebble", "eyefx", "ember", "horntip", "pearl", "head" };

        public Transform root;
        public float height, size;
        public bool placeholder;
        public Animator animator;
        public CreatureRig rig;
        public CreatureLocomotion loco;
        /// <summary>骨骼动画（第二版：角色预制体，Animator 挂着控制器）；false = 静态网格 / 占位体，走程序动画</summary>
        public bool Rigged => animator && animator.runtimeAnimatorController;
        /// <summary>挂点名（小写，见 <see cref="SocketNames"/>）→ 骨骼</summary>
        public readonly Dictionary<string, Transform> sockets = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>单独建模的发光件（精卫的火石、应龙的宝珠，<see cref="PetDef.partId"/>）；没有为 null</summary>
        public Transform part;
        /// <summary>发光件平时挂在哪（挂点骨骼，或找不到挂点时的估计位置）与在它下面的姿势：拆下来飞一圈后按这个装回去</summary>
        public Transform partHome;
        public Vector3 partLocalPos, partLocalScale = Vector3.one;
        public Quaternion partLocalRot = Quaternion.identity;
        public PetPartGlow partGlow;
        /// <summary>翅膀枢轴（sign = 左 -1 / 右 +1），程序扇动</summary>
        public readonly List<(Transform t, float sign)> wings = new();
        /// <summary>尾巴枢轴与初始朝向，程序摆动 / 抽打</summary>
        public readonly List<(Transform t, Quaternion rest)> tails = new();
        /// <summary>龙身各节与初始位置，程序波动</summary>
        public readonly List<(Transform t, Vector3 rest)> spine = new();

        static readonly int SpeedId = Animator.StringToHash("Speed"), LocomotionId = Animator.StringToHash("Locomotion");

        /// <summary>挂点（没有返回 null）</summary>
        public Transform Socket(string name) => name != null && sockets.TryGetValue(name, out var t) && t ? t : null;

        /// <summary>
        /// 展示用（封印里转圈的身影）：不按根节点运动推步态（转圈会被读成原地踏步）、不做脚步 IK / 看向，原地播待机，
        /// 起始相位随机（灵兽台上八只不同步）
        /// </summary>
        public void Display()
        {
            if (loco)
            {
                loco.autoTick = false;
                loco.speedOverride = 0;
            }
            if (rig)
            {
                rig.feetIK = false;
                rig.lookTarget = null;
                rig.lean = 0;
            }
            if (!Rigged) return;
            if (HasParam(animator, SpeedId)) animator.SetFloat(SpeedId, 0);
            if (animator.HasState(0, LocomotionId)) animator.Play(LocomotionId, 0, UnityEngine.Random.value);
        }

        public static bool HasParam(Animator a, int hash)
        {
            if (!a || !a.runtimeAnimatorController) return false;
            foreach (var p in a.parameters)
                if (p.nameHash == hash) return true;
            return false;
        }
    }

    /// <summary>
    /// 灵宠模型：优先载入 Resources/Pets/&lt;assetId&gt;（PetArtImport 生成）——
    ///   第二版：嵌套的角色预制体 Assets/Art/Prefabs/Characters/&lt;assetId&gt;（Animator + 控制器、CreatureRig、CreatureLocomotion、布娃娃、胶囊），骨骼动画；
    ///   第一版：静态网格（脚底在原点、朝 +Z、真实尺寸），程序动画。
    /// 都没有时用同色系的简单几何拼一个认得出的占位体（猪 = 圆身 + 獠牙、鸟 = 身子 + 平展的翅膀、龙 = 一串球 + 翅膀…）。
    /// 灵宠是灵体：运行时去掉布娃娃与所有碰撞体、刚体（预制体本身不改，嵌套的角色预制体随 Sync 更新）。
    /// </summary>
    public static class PetVisuals
    {
        public static PetModel Build(PetDef def, Transform parent)
        {
            var m = new PetModel();
            var prefab = Resources.Load<GameObject>("Pets/" + def.assetId);
            if (prefab)
            {
                var inst = Object.Instantiate(prefab, parent, false);
                inst.name = def.assetId;
                Strip(inst);
                m.root = inst.transform;
                m.animator = inst.GetComponentInChildren<Animator>(true);
                // 第二版角色预制体（带 Animator）：发光件单独建模，要挂上去；第一版静态网格已经把它们做在模型里了
                bool separateParts = m.animator;
                m.rig = inst.GetComponentInChildren<CreatureRig>(true);
                m.loco = inst.GetComponentInChildren<CreatureLocomotion>(true);
                if (!m.Rigged)
                {
                    // 静态网格，或角色预制体还没接上控制器（先跑 Sync）：不让动画层在绑定姿势上乱做 IK
                    if (m.animator) m.animator.enabled = false;
                    if (m.rig) m.rig.enabled = false;
                    if (m.loco) m.loco.enabled = false;
                    m.rig = null;
                    m.loco = null;
                }
                FindSockets(m);
                var b = DesignBounds(parent, inst) ?? LocalBounds(parent, inst);
                m.height = b.size.y > 0.05f ? b.max.y : def.height;
                m.size = Mathf.Max(b.size.x, b.size.y, b.size.z);
                if (separateParts) AttachPart(def, m, parent);
            }
            else
            {
                m.root = Placeholder(def, parent, m);
                m.placeholder = true;
                m.height = def.height;
                var b = LocalBounds(parent, m.root.gameObject);
                m.size = Mathf.Max(def.height, b.size.x, b.size.z);
            }
            if (def.shape == PetShape.Sage) Cloud(parent, m.size);
            return m;
        }

        /// <summary>
        /// 灵体：去掉布娃娃与所有物理。按依赖顺序删：关节（CharacterJoint 依赖 Rigidbody）→ 刚体 → 碰撞体（骨骼胶囊、角色胶囊）
        /// → CreatureRagdoll（它的 parts 引用前面这些）。Animator 留着（骨骼动画）；没挂控制器的由调用方关掉
        /// </summary>
        public static void Strip(GameObject go)
        {
            foreach (var j in go.GetComponentsInChildren<Joint>(true)) Object.DestroyImmediate(j);
            foreach (var r in go.GetComponentsInChildren<Rigidbody>(true)) Object.DestroyImmediate(r);
            foreach (var c in go.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
            foreach (var d in go.GetComponentsInChildren<CreatureRagdoll>(true)) Object.DestroyImmediate(d);
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
        }

        /// <summary>
        /// 挂点：按名字找骨骼（大小写不敏感；容忍 socket_ 前缀与 "命名空间:" 前缀），第一个命中的为准；
        /// 没有 head 骨骼时用 CreatureRig 看向链的最后一节
        /// </summary>
        static void FindSockets(PetModel m)
        {
            foreach (var t in m.root.GetComponentsInChildren<Transform>(true))
            {
                if (t.GetComponent<Renderer>()) continue;
                var n = t.name;
                int colon = n.LastIndexOf(':');
                if (colon >= 0) n = n[(colon + 1)..];
                if (n.StartsWith("socket_", StringComparison.OrdinalIgnoreCase)) n = n["socket_".Length..];
                foreach (var s in PetModel.SocketNames)
                    if (string.Equals(n, s, StringComparison.OrdinalIgnoreCase))
                    {
                        m.sockets.TryAdd(s, t);
                        break;
                    }
            }
            if (!m.sockets.ContainsKey("head") && m.rig && m.rig.lookBones.Length > 0 && m.rig.lookBones[^1])
                m.sockets["head"] = m.rig.lookBones[^1];
        }

        /// <summary>发光件预制体（Resources/Pets/Parts/&lt;id&gt;）的一个实例：去掉物理，原点 = 包围盒中心；没有返回 null</summary>
        public static GameObject InstantiatePart(string partId, Transform parent = null)
        {
            if (string.IsNullOrEmpty(partId)) return null;
            var prefab = Resources.Load<GameObject>("Pets/Parts/" + partId);
            if (!prefab) return null;
            var go = parent ? Object.Instantiate(prefab, parent, false) : Object.Instantiate(prefab);
            go.name = partId;
            Strip(go);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true)) r.shadowCastingMode = ShadowCastingMode.Off;
            return go;
        }

        /// <summary>
        /// 把发光件挂到挂点上（世界尺寸跟模型一致、朝向跟模型根一致）并让它微微脉动发亮。
        /// 找不到挂点：火石挂嘴 / 头前方，宝珠挂前爪（claw_R / claw_L / forearm_*），都没有就按体型估一个位置挂在模型根下
        /// </summary>
        static void AttachPart(PetDef def, PetModel m, Transform parent)
        {
            if (string.IsNullOrEmpty(def.partId)) return;
            var prefab = Resources.Load<GameObject>("Pets/Parts/" + def.partId);
            if (!prefab) return;
            var home = m.Socket(def.partSocket) ?? FallbackAnchor(def, m, parent);
            var go = InstantiatePart(def.partId, home);
            if (!go) return;
            var t = go.transform;
            t.localPosition = Vector3.zero;
            t.rotation = m.root.rotation;
            // 挂点骨骼可能带缩放：按模型根的世界尺寸校正
            t.localScale = Vector3.one;
            float k = m.root.lossyScale.x / Mathf.Max(1e-5f, t.lossyScale.x);
            t.localScale = Vector3.one * k;
            m.part = t;
            m.partHome = home;
            m.partLocalPos = t.localPosition;
            m.partLocalRot = t.localRotation;
            m.partLocalScale = t.localScale;
            m.partGlow = go.AddComponent<PetPartGlow>();
            m.partGlow.Init(def.partGlow);
        }

        static Transform FallbackAnchor(PetDef def, PetModel m, Transform parent)
        {
            var anchor = new GameObject($"{def.partSocket} (estimated)").transform;
            Transform bone = null;
            bool front = false;
            if (def.partSocket == "pebble")
            {
                bone = m.Socket("mouth");
                if (!bone)
                {
                    bone = m.Socket("head");
                    front = bone;
                }
            }
            else
            {
                foreach (var t in m.root.GetComponentsInChildren<Transform>(true))
                {
                    var n = t.name;
                    int colon = n.LastIndexOf(':');
                    if (colon >= 0) n = n[(colon + 1)..];
                    if (n.Equals("claw_R", StringComparison.OrdinalIgnoreCase)) { bone = t; break; }
                    if (!bone && (n.Equals("claw_L", StringComparison.OrdinalIgnoreCase) || n.StartsWith("forearm_", StringComparison.OrdinalIgnoreCase))) bone = t;
                }
            }
            if (bone)
            {
                anchor.SetParent(bone, false);
                if (front) anchor.position = bone.position + m.root.forward * m.size * 0.12f;
                return anchor;
            }
            anchor.SetParent(m.root, false);
            // 火石：喙尖（前上）；宝珠：右前爪（前下、偏右）
            var est = def.partSocket == "pebble"
                ? new Vector3(0, m.height * 0.75f, m.size * 0.5f)
                : new Vector3(m.size * 0.12f, m.height * 0.3f, m.size * 0.35f);
            anchor.position = parent.TransformPoint(est);
            return anchor;
        }

        /// <summary>角色预制体记录的设计包围盒（ArtAssetInfo.designBounds，模型根坐标系）换到 parent 坐标系；没有返回 null</summary>
        static Bounds? DesignBounds(Transform parent, GameObject go)
        {
            var info = go.GetComponentInChildren<ArtAssetInfo>(true);
            if (!info || info.designBounds.size.y < 0.05f) return null;
            var db = info.designBounds;
            var b = new Bounds();
            for (int i = 0; i < 8; i++)
            {
                var corner = db.center + Vector3.Scale(db.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                var p = parent.InverseTransformPoint(info.transform.TransformPoint(corner));
                if (i == 0) b = new Bounds(p, Vector3.zero);
                else b.Encapsulate(p);
            }
            return b;
        }

        /// <summary>parent 坐标系下的渲染包围盒</summary>
        public static Bounds LocalBounds(Transform parent, GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            var b = new Bounds(Vector3.zero, Vector3.zero);
            bool first = true;
            foreach (var r in rs)
            {
                if (r is ParticleSystemRenderer || r is TrailRenderer || r is LineRenderer) continue;
                var wb = r.bounds;
                for (int i = 0; i < 8; i++)
                {
                    var corner = wb.center + Vector3.Scale(wb.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    var p = parent.InverseTransformPoint(corner);
                    if (first) { b = new Bounds(p, Vector3.zero); first = false; }
                    else b.Encapsulate(p);
                }
            }
            return b;
        }

        // ───────────── 占位体 ─────────────
        static Transform Placeholder(PetDef def, Transform parent, PetModel m)
        {
            var root = new GameObject("Placeholder · " + def.name).transform;
            root.SetParent(parent, false);
            // 按身高 1 搭，整体缩放到真实身高
            root.localScale = Vector3.one * def.height;
            Color b = def.body, a = def.accent;
            var dark = Color.Lerp(b, Color.black, 0.55f);
            switch (def.shape)
            {
                case PetShape.Boar:
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.5f, 0), new Vector3(0.78f, 0.64f, 1.02f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.6f, 0.5f), new Vector3(0.52f, 0.5f, 0.46f), b);
                    Part(root, PrimitiveType.Cylinder, new Vector3(0, 0.53f, 0.76f), new Vector3(0.24f, 0.06f, 0.2f), new Color(0.92f, 0.62f, 0.55f), new Vector3(90, 0, 0));
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Capsule, new Vector3(0.11f * s, 0.46f, 0.74f), new Vector3(0.05f, 0.09f, 0.05f), new Color(0.98f, 0.95f, 0.85f), new Vector3(-35, 0, -20 * s));
                        Part(root, PrimitiveType.Cube, new Vector3(0.2f * s, 0.84f, 0.44f), new Vector3(0.15f, 0.04f, 0.13f), a, new Vector3(0, 0, 35 * s));
                        Part(root, PrimitiveType.Sphere, new Vector3(0.12f * s, 0.68f, 0.7f), Vector3.one * 0.07f, Color.black);
                        foreach (var z in new[] { -0.28f, 0.26f })
                            Part(root, PrimitiveType.Cylinder, new Vector3(0.22f * s, 0.14f, z), new Vector3(0.15f, 0.14f, 0.15f), dark);
                    }
                    Part(root, PrimitiveType.Cube, new Vector3(0, 0.83f, -0.05f), new Vector3(0.12f, 0.04f, 0.8f), a);
                    for (int i = 0; i < 3; i++)
                        Part(root, PrimitiveType.Capsule, new Vector3((i - 1) * 0.07f, 0.92f, 0.5f), new Vector3(0.04f, 0.1f, 0.04f), new Color(1f, 0.85f, 0.35f), new Vector3(-20, 0, (i - 1) * 20f), true);
                    Part(root, PrimitiveType.Cylinder, new Vector3(0, 0.38f, 0.66f), new Vector3(0.16f, 0.015f, 0.16f), new Color(1f, 0.78f, 0.3f), new Vector3(70, 0, 0), true);
                    break;

                case PetShape.Cat:
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.5f, 0), new Vector3(0.36f, 0.48f, 0.36f), b, new Vector3(90, 0, 0));
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.8f, 0.48f), Vector3.one * 0.42f, b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.84f, 0.67f), Vector3.one * 0.17f, a * 1.3f, default, true);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.84f, 0.75f), Vector3.one * 0.06f, Color.black);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.62f, 0.42f), new Vector3(0.36f, 0.26f, 0.2f), new Color(0.92f, 0.88f, 0.8f));
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Cube, new Vector3(0.13f * s, 1.04f, 0.46f), new Vector3(0.08f, 0.24f, 0.04f), b, new Vector3(0, 0, -12 * s));
                        foreach (var z in new[] { -0.3f, 0.3f })
                            Part(root, PrimitiveType.Cylinder, new Vector3(0.14f * s, 0.18f, z), new Vector3(0.1f, 0.18f, 0.1f), dark);
                    }
                    for (int i = 0; i < 3; i++)
                        Part(root, PrimitiveType.Sphere, new Vector3((i - 1) * 0.1f, 0.55f, 0.6f), Vector3.one * 0.06f, new Color(0.85f, 0.65f, 0.3f), default, true);
                    for (int i = 0; i < 3; i++)
                    {
                        var pivot = Pivot(root, "Tail" + i, new Vector3(0, 0.62f, -0.45f), Quaternion.Euler(-50, (i - 1) * 28f, 0));
                        Part(pivot, PrimitiveType.Capsule, new Vector3(0, 0.3f, 0), new Vector3(0.1f, 0.3f, 0.1f), i == 1 ? a : b);
                        m.tails.Add((pivot, pivot.localRotation));
                    }
                    break;

                case PetShape.SmallBird:
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.5f, 0), new Vector3(0.7f, 0.6f, 1.3f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.74f, 0.62f), Vector3.one * 0.5f, new Color(0.9f, 0.9f, 0.88f));
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.84f, 0.6f), new Vector3(0.42f, 0.25f, 0.4f), Color.black);
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.7f, 0.95f), new Vector3(0.1f, 0.14f, 0.1f), Color.white, new Vector3(90, 0, 0));
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.68f, 1.1f), Vector3.one * 0.16f, new Color(0.55f, 0.53f, 0.5f));
                    Part(root, PrimitiveType.Cube, new Vector3(0, 0.48f, -0.78f), new Vector3(0.5f, 0.04f, 0.55f), a);
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Sphere, new Vector3(0.14f * s, 0.8f, 0.82f), Vector3.one * 0.08f, Color.black);
                        Part(root, PrimitiveType.Capsule, new Vector3(0.12f * s, 0.18f, 0f), new Vector3(0.06f, 0.1f, 0.06f), new Color(0.9f, 0.15f, 0.1f));
                        var pivot = Pivot(root, s < 0 ? "WingL" : "WingR", new Vector3(0.28f * s, 0.6f, 0.05f), Quaternion.identity);
                        Part(pivot, PrimitiveType.Cube, new Vector3(0.62f * s, 0, 0), new Vector3(1.25f, 0.05f, 0.6f), b);
                        Part(pivot, PrimitiveType.Cube, new Vector3(1.1f * s, 0, -0.12f), new Vector3(0.35f, 0.055f, 0.4f), new Color(1f, 0.45f, 0.15f), default, true);
                        m.wings.Add((pivot, s));
                    }
                    break;

                case PetShape.Pheasant:
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.5f, 0), new Vector3(0.55f, 0.55f, 0.95f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.86f, 0.4f), Vector3.one * 0.38f, b);
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.84f, 0.62f), new Vector3(0.08f, 0.1f, 0.08f), new Color(1f, 0.75f, 0.3f), new Vector3(90, 0, 0));
                    Part(root, PrimitiveType.Cube, new Vector3(0, 1.1f, 0.3f), new Vector3(0.04f, 0.3f, 0.2f), a, new Vector3(-35, 0, 0));
                    foreach (var s in new[] { -1f, 1f })
                    {
                        // 双瞳：每只眼两颗青色瞳仁
                        Part(root, PrimitiveType.Sphere, new Vector3(0.15f * s, 0.9f, 0.5f), Vector3.one * 0.12f, Color.white);
                        Part(root, PrimitiveType.Sphere, new Vector3(0.2f * s, 0.92f, 0.52f), Vector3.one * 0.05f, a * 1.4f, default, true);
                        Part(root, PrimitiveType.Sphere, new Vector3(0.2f * s, 0.88f, 0.47f), Vector3.one * 0.05f, a * 1.4f, default, true);
                        var pivot = Pivot(root, s < 0 ? "WingL" : "WingR", new Vector3(0.24f * s, 0.62f, 0f), Quaternion.identity);
                        Part(pivot, PrimitiveType.Cube, new Vector3(0.52f * s, 0, 0), new Vector3(1.05f, 0.05f, 0.5f), b);
                        Part(pivot, PrimitiveType.Cube, new Vector3(0.6f * s, 0.01f, 0), new Vector3(0.7f, 0.055f, 0.1f), a, new Vector3(0, 20 * s, 0), true);
                        m.wings.Add((pivot, s));
                    }
                    for (int i = 0; i < 3; i++)
                    {
                        var pivot = Pivot(root, "Tail" + i, new Vector3(0, 0.45f, -0.42f), Quaternion.Euler(-130 + i * 8, (i - 1) * 14f, 0));
                        Part(pivot, PrimitiveType.Capsule, new Vector3(0, 0.45f, 0), new Vector3(0.07f, 0.45f, 0.07f), i == 1 ? a : new Color(1f, 0.82f, 0.4f));
                        m.tails.Add((pivot, pivot.localRotation));
                    }
                    break;

                case PetShape.Lion:
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.45f, -0.08f), new Vector3(0.7f, 0.58f, 0.95f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.74f, 0.34f), Vector3.one * 0.78f, a);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.72f, 0.48f), Vector3.one * 0.56f, b);
                    Part(root, PrimitiveType.Cube, new Vector3(0, 0.6f, 0.72f), new Vector3(0.34f, 0.06f, 0.1f), new Color(0.75f, 0.15f, 0.12f));
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Sphere, new Vector3(0.14f * s, 0.8f, 0.7f), Vector3.one * 0.14f, Color.white);
                        Part(root, PrimitiveType.Sphere, new Vector3(0.15f * s, 0.8f, 0.77f), Vector3.one * 0.06f, Color.black);
                        foreach (var z in new[] { -0.36f, 0.24f })
                            Part(root, PrimitiveType.Cylinder, new Vector3(0.22f * s, 0.15f, z), new Vector3(0.19f, 0.15f, 0.19f), b);
                    }
                    // 背上的小香炉
                    Part(root, PrimitiveType.Cylinder, new Vector3(0, 0.86f, -0.18f), new Vector3(0.32f, 0.1f, 0.32f), new Color(0.55f, 0.42f, 0.2f));
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.98f, -0.18f), Vector3.one * 0.12f, DamageTable.ElementColor(Element.Corrode), default, true);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.62f, -0.6f), Vector3.one * 0.26f, a);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.5f, 0.66f), Vector3.one * 0.08f, new Color(1f, 0.8f, 0.3f), default, true);
                    break;

                case PetShape.Leopard:
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.56f, 0), new Vector3(0.38f, 0.52f, 0.4f), b, new Vector3(90, 0, 0));
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.7f, 0.6f), Vector3.one * 0.36f, b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.6f, 0.72f), new Vector3(0.2f, 0.14f, 0.18f), new Color(0.95f, 0.88f, 0.75f));
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.92f, 0.66f), new Vector3(0.06f, 0.14f, 0.06f), a, new Vector3(-30, 0, 0));
                    for (int i = 0; i < 6; i++)
                        Part(root, PrimitiveType.Sphere, new Vector3((i % 2 == 0 ? 0.12f : -0.12f), 0.72f, -0.35f + i * 0.13f), Vector3.one * 0.08f, Color.black);
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Sphere, new Vector3(0.1f * s, 0.76f, 0.76f), Vector3.one * 0.06f, new Color(1f, 0.85f, 0.3f), default, true);
                        foreach (var z in new[] { -0.32f, 0.3f })
                            Part(root, PrimitiveType.Cylinder, new Vector3(0.15f * s, 0.2f, z), new Vector3(0.1f, 0.2f, 0.1f), b);
                    }
                    for (int i = 0; i < 5; i++)
                    {
                        var pivot = Pivot(root, "Tail" + i, new Vector3(0, 0.62f, -0.48f), Quaternion.Euler(-60, (i - 2) * 22f, 0));
                        Part(pivot, PrimitiveType.Capsule, new Vector3(0, 0.36f, 0), new Vector3(0.06f, 0.36f, 0.06f), i % 2 == 0 ? b : Color.Lerp(b, Color.black, 0.3f));
                        m.tails.Add((pivot, pivot.localRotation));
                    }
                    break;

                case PetShape.Sage:
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.55f, 0), new Vector3(0.68f, 0.55f, 1.08f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.62f, 0.38f), new Vector3(0.6f, 0.52f, 0.4f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.88f, 0.5f), Vector3.one * 0.4f, b);
                    Part(root, PrimitiveType.Capsule, new Vector3(0, 0.68f, 0.62f), new Vector3(0.1f, 0.12f, 0.1f), b);
                    Part(root, PrimitiveType.Sphere, new Vector3(0, 0.97f, 0.69f), Vector3.one * 0.07f, a * 1.3f, default, true);
                    Part(root, PrimitiveType.Cube, new Vector3(0, 0.56f, 0.6f), new Vector3(0.07f, 0.1f, 0.03f), new Color(0.45f, 0.9f, 0.65f), default, true);
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(root, PrimitiveType.Capsule, new Vector3(0.12f * s, 1.12f, 0.44f), new Vector3(0.05f, 0.18f, 0.05f), a, new Vector3(-25, 0, -25 * s), true);
                        Part(root, PrimitiveType.Sphere, new Vector3(0.1f * s, 0.92f, 0.67f), Vector3.one * 0.05f, Color.black);
                        for (int i = 0; i < 4; i++)
                            Part(root, PrimitiveType.Sphere, new Vector3(0.33f * s, 0.6f, -0.3f + i * 0.18f), Vector3.one * 0.05f, a * 1.3f, default, true);
                        foreach (var z in new[] { -0.32f, 0.3f })
                            Part(root, PrimitiveType.Cylinder, new Vector3(0.22f * s, 0.18f, z), new Vector3(0.14f, 0.18f, 0.14f), b);
                    }
                    var tailPivot = Pivot(root, "Tail0", new Vector3(0, 0.62f, -0.5f), Quaternion.Euler(-120, 0, 0));
                    Part(tailPivot, PrimitiveType.Capsule, new Vector3(0, 0.25f, 0), new Vector3(0.14f, 0.25f, 0.14f), b);
                    m.tails.Add((tailPivot, tailPivot.localRotation));
                    break;

                case PetShape.Dragon:
                {
                    // 龙身：一串由粗到细的球，S 形；龙头在最前
                    const int n = 10;
                    for (int i = 0; i < n; i++)
                    {
                        float k = i / (n - 1f);
                        var p = new Vector3(Mathf.Sin(k * 5.5f) * 0.22f, 0.55f + Mathf.Sin(k * 3.2f + 1f) * 0.1f, 0.95f - k * 2.3f);
                        var seg = Part(root, PrimitiveType.Sphere, p, Vector3.one * Mathf.Lerp(0.36f, 0.09f, k), i % 3 == 1 ? a : b);
                        m.spine.Add((seg, p));
                    }
                    var head = Pivot(root, "Head", new Vector3(0, 0.66f, 1.1f), Quaternion.identity);
                    Part(head, PrimitiveType.Sphere, Vector3.zero, new Vector3(0.36f, 0.3f, 0.44f), b);
                    Part(head, PrimitiveType.Cylinder, new Vector3(0, -0.04f, 0.24f), new Vector3(0.2f, 0.1f, 0.2f), b, new Vector3(90, 0, 0));
                    Part(head, PrimitiveType.Sphere, new Vector3(0, 0.02f, -0.18f), new Vector3(0.42f, 0.36f, 0.3f), Color.white);
                    foreach (var s in new[] { -1f, 1f })
                    {
                        Part(head, PrimitiveType.Capsule, new Vector3(0.1f * s, 0.24f, -0.06f), new Vector3(0.04f, 0.18f, 0.04f), a, new Vector3(-35, 0, -20 * s));
                        Part(head, PrimitiveType.Capsule, new Vector3(0.16f * s, 0.32f, -0.12f), new Vector3(0.03f, 0.08f, 0.03f), a, new Vector3(-60, 0, -50 * s));
                        Part(head, PrimitiveType.Sphere, new Vector3(0.12f * s, 0.07f, 0.12f), Vector3.one * 0.06f, new Color(1f, 0.85f, 0.3f), default, true);
                        Part(head, PrimitiveType.Capsule, new Vector3(0.1f * s, -0.08f, 0.32f), new Vector3(0.02f, 0.16f, 0.02f), Color.white, new Vector3(70, 0, 30 * s));
                        var pivot = Pivot(root, s < 0 ? "WingL" : "WingR", new Vector3(0.2f * s, 0.72f, 0.55f), Quaternion.identity);
                        Part(pivot, PrimitiveType.Cube, new Vector3(0.55f * s, 0, 0), new Vector3(1.1f, 0.04f, 0.55f), b);
                        Part(pivot, PrimitiveType.Cube, new Vector3(0.95f * s, 0.005f, -0.1f), new Vector3(0.35f, 0.045f, 0.45f), new Color(0.45f, 0.65f, 1f), default, true);
                        m.wings.Add((pivot, s));
                    }
                    Part(root, PrimitiveType.Sphere, new Vector3(0.18f, 0.4f, 0.9f), Vector3.one * 0.1f, new Color(0.75f, 0.9f, 1f), default, true);
                    break;
                }
            }
            return root;
        }

        static Transform Pivot(Transform parent, string name, Vector3 pos, Quaternion rot)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.localPosition = pos;
            t.localRotation = rot;
            return t;
        }

        static Transform Part(Transform parent, PrimitiveType type, Vector3 pos, Vector3 scale, Color c, Vector3 euler = default, bool glow = false)
        {
            var go = GameObject.CreatePrimitive(type);
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localRotation = Quaternion.Euler(euler);
            go.transform.localScale = scale;
            var r = go.GetComponent<Renderer>();
            if (glow)
            {
                r.sharedMaterial = FxMaterials.Unlit;
                FxMaterials.Tint(r, c);
            }
            else
            {
                var block = new MaterialPropertyBlock();
                block.SetColor("_BaseColor", c);
                r.SetPropertyBlock(block);
            }
            return go.transform;
        }

        /// <summary>白泽脚下踏的云：几团扁平的白球 + 金色光晕</summary>
        static void Cloud(Transform parent, float size)
        {
            var cloud = new GameObject("Cloud").transform;
            cloud.SetParent(parent, false);
            for (int i = 0; i < 7; i++)
            {
                float a = i / 7f * Mathf.PI * 2;
                var p = new Vector3(Mathf.Cos(a) * 0.32f * size, 0.02f, Mathf.Sin(a) * 0.42f * size);
                Part(cloud, PrimitiveType.Sphere, p, new Vector3(0.36f, 0.12f, 0.36f) * size, new Color(0.98f, 0.97f, 0.92f), default, true)
                    .GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
            }
            FxMaterials.GlowSprite(cloud, size * 1.6f, new Color(1f, 0.85f, 0.5f, 0.35f));
        }
    }

    /// <summary>灵宠的一次性特效：灵火一闪（光晕放大淡出）、冲天光柱、头顶标记、世界空间文字</summary>
    public static class PetFx
    {
        static Font font;

        /// <summary>光晕一闪：size 米，life 秒内放大并淡出</summary>
        public static void Burst(Vector3 at, Color c, float size, float life = 0.45f)
        {
            var go = new GameObject("Pet Burst");
            go.transform.position = at;
            var glow = FxMaterials.GlowSprite(go.transform, 1f, c);
            var f = go.AddComponent<PetFxFade>();
            f.Init(life, c, new[] { glow.GetComponent<Renderer>() }, Vector3.one * size * 0.4f, Vector3.one * size);
        }

        /// <summary>冲天光柱（神兽现世、结契）：自下而上，life 秒淡出</summary>
        public static void Pillar(Vector3 at, Color c, float width, float height, float life)
        {
            var go = new GameObject("Pet Pillar");
            go.transform.position = at;
            var beam = FxMaterials.BeamSprite(go.transform, width, height, c);
            var f = go.AddComponent<PetFxFade>();
            f.Init(life, c, beam.GetComponentsInChildren<Renderer>(), new Vector3(0.6f, 0.2f, 0.6f), Vector3.one);
        }

        /// <summary>光束（金光、龙息）：两端发亮的加色线段，life 秒内变细淡出</summary>
        public static void Beam(Vector3 from, Vector3 to, Color c, float width, float life = 0.16f)
        {
            var go = new GameObject("Pet Beam");
            var lr = go.AddComponent<LineRenderer>();
            lr.sharedMaterial = FxMaterials.Additive;
            lr.positionCount = 2;
            lr.SetPosition(0, from);
            lr.SetPosition(1, to);
            lr.numCapVertices = 3;
            lr.shadowCastingMode = ShadowCastingMode.Off;
            lr.receiveShadows = false;
            go.AddComponent<PetFxLine>().Init(lr, c, width, life);
        }

        /// <summary>头顶标记（重明鸟的重瞳、白泽图）：朝相机的光圈，twin 时中间两颗瞳仁</summary>
        public static Transform Marker(Color c, bool twin)
        {
            var root = new GameObject("Pet Mark").transform;
            root.gameObject.AddComponent<Billboard>();
            Quad(root, Vector3.zero, 0.7f, new Color(c.r, c.g, c.b, 0.55f));
            if (twin)
            {
                Quad(root, new Vector3(-0.11f, 0, -0.01f), 0.22f, new Color(Mathf.Lerp(c.r, 1, 0.5f), Mathf.Lerp(c.g, 1, 0.5f), Mathf.Lerp(c.b, 1, 0.5f), 1f));
                Quad(root, new Vector3(0.11f, 0, -0.01f), 0.22f, new Color(Mathf.Lerp(c.r, 1, 0.5f), Mathf.Lerp(c.g, 1, 0.5f), Mathf.Lerp(c.b, 1, 0.5f), 1f));
            }
            else Quad(root, new Vector3(0, 0, -0.01f), 0.3f, new Color(1f, 0.95f, 0.8f, 1f));
            return root;
        }

        static void Quad(Transform parent, Vector3 pos, float size, Color c)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(q.GetComponent<Collider>());
            q.transform.SetParent(parent, false);
            q.transform.localPosition = pos;
            q.transform.localScale = Vector3.one * size;
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Glow;
            FxMaterials.Tint(r, c);
        }

        /// <summary>挂在敌人头顶、seconds 秒后消失的标记</summary>
        public static void TimedMarker(Damageable target, Color c, float seconds)
        {
            if (!target) return;
            var m = Marker(c, false);
            m.gameObject.AddComponent<PetMarkFollow>().Init(target, seconds);
        }

        /// <summary>世界空间文字（封印名、灵兽台标题）：朝相机</summary>
        public static TextMesh Label(Transform parent, Vector3 localPos, string text, Color c, float height = 0.22f)
        {
            font ??= Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "Arial" }, 64);
            var go = new GameObject("Label");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var tm = go.AddComponent<TextMesh>();
            tm.font = font;
            tm.fontSize = 64;
            tm.characterSize = height / 6.4f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.richText = true;
            tm.color = c;
            tm.text = text;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = font.material;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            go.AddComponent<Billboard>();
            return tm;
        }

        public static float TopOf(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.max.y : d.transform.position.y + 1.6f;
        }
    }

    /// <summary>
    /// 发光件的脉动：网格本身按受击闪白的办法（_FlashAmount / _FlashColor）往辉光色提亮一点，外面一圈朝相机的光晕跟着呼吸。
    /// boost 0–1：额外加亮（应龙宝珠在雷暴里悬空时）
    /// </summary>
    public sealed class PetPartGlow : MonoBehaviour
    {
        static readonly int FlashId = Shader.PropertyToID("_FlashAmount"), FlashColorId = Shader.PropertyToID("_FlashColor"), BaseColorId = Shader.PropertyToID("_BaseColor");
        [Range(0, 1)] public float boost;
        Color color;
        Renderer[] meshes;
        Renderer halo;
        Transform haloT;
        float haloSize, phase;
        MaterialPropertyBlock block;

        public void Init(Color c)
        {
            color = c;
            phase = UnityEngine.Random.value * 6f;
            block = new MaterialPropertyBlock();
            var list = new List<Renderer>();
            var bounds = new Bounds(transform.position, Vector3.zero);
            bool first = true;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer || r is TrailRenderer || r is LineRenderer) continue;
                if (first) { bounds = r.bounds; first = false; }
                else bounds.Encapsulate(r.bounds);
                if (r.sharedMaterial && r.sharedMaterial.HasProperty(FlashId)) list.Add(r);
            }
            meshes = list.ToArray();
            // 光晕：约为发光件直径的 4 倍（父级缩放已含在 lossyScale 里，这里换回本地单位）
            float diameter = first ? 0.05f : Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
            haloSize = diameter * 4f / Mathf.Max(1e-5f, transform.lossyScale.x);
            haloT = FxMaterials.GlowSprite(transform, haloSize, new Color(c.r, c.g, c.b, 0.5f));
            halo = haloT.GetComponent<Renderer>();
        }

        void LateUpdate()
        {
            if (block == null) return;
            float t = Time.time * 3.2f + phase;
            float pulse = 0.5f + 0.5f * Mathf.Sin(t);
            float flash = Mathf.Lerp(0.08f, 0.22f, pulse) + boost * 0.3f;
            var bright = Color.Lerp(color, Color.white, 0.35f) * (1.3f + boost);
            foreach (var r in meshes)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetFloat(FlashId, flash);
                block.SetColor(FlashColorId, bright);
                r.SetPropertyBlock(block);
            }
            if (halo)
            {
                haloT.localScale = Vector3.one * haloSize * (1f + 0.15f * pulse + boost * 0.8f);
                block.Clear();
                block.SetColor(BaseColorId, new Color(color.r, color.g, color.b, Mathf.Clamp01(0.35f + 0.25f * pulse + boost * 0.35f)));
                halo.SetPropertyBlock(block);
            }
        }
    }

    /// <summary>特效淡出：从 scaleFrom 放大到 scaleTo、透明度归零后销毁</summary>
    public sealed class PetFxFade : MonoBehaviour
    {
        float life, age;
        Color color;
        Renderer[] renderers;
        Vector3 from, to;
        MaterialPropertyBlock block;

        public void Init(float seconds, Color c, Renderer[] rs, Vector3 scaleFrom, Vector3 scaleTo)
        {
            life = Mathf.Max(0.05f, seconds);
            color = c;
            renderers = rs;
            from = scaleFrom;
            to = scaleTo;
            block = new MaterialPropertyBlock();
            transform.localScale = from;
        }

        void Update()
        {
            age += Time.deltaTime;
            float k = Mathf.Clamp01(age / life);
            transform.localScale = Vector3.Lerp(from, to, 1 - (1 - k) * (1 - k));
            block.SetColor("_BaseColor", new Color(color.r, color.g, color.b, color.a * (1 - k)));
            foreach (var r in renderers)
                if (r) r.SetPropertyBlock(block);
            if (age >= life) Destroy(gameObject);
        }
    }

    /// <summary>光束淡出：宽度与透明度一起收</summary>
    public sealed class PetFxLine : MonoBehaviour
    {
        LineRenderer line;
        Color color;
        float width, life, age;

        public void Init(LineRenderer lr, Color c, float w, float seconds)
        {
            line = lr;
            color = c;
            width = w;
            life = Mathf.Max(0.03f, seconds);
            Update();
        }

        void Update()
        {
            float k = Mathf.Clamp01(age / life);
            age += Time.deltaTime;
            var core = Color.Lerp(color, Color.white, 0.55f);
            line.startColor = new Color(core.r, core.g, core.b, 1 - k);
            line.endColor = new Color(color.r, color.g, color.b, (1 - k) * 0.9f);
            line.widthMultiplier = width * (1 - k * 0.7f);
            if (age >= life) Destroy(gameObject);
        }
    }

    /// <summary>标记跟着敌人头顶，目标死亡或到时消失</summary>
    public sealed class PetMarkFollow : MonoBehaviour
    {
        Damageable target;
        float until;

        public void Init(Damageable d, float seconds)
        {
            target = d;
            until = Time.time + seconds;
            LateUpdate();
        }

        void LateUpdate()
        {
            if (!target || target.Dead || Time.time >= until)
            {
                Destroy(gameObject);
                return;
            }
            var p = target.transform.position;
            transform.position = new Vector3(p.x, PetFx.TopOf(target) + 0.45f, p.z);
            transform.localScale = Vector3.one * (1f + Mathf.Sin(Time.time * 6f) * 0.08f);
        }
    }
}
