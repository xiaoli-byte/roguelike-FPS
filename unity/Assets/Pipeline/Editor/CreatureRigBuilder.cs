using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 按骨骼名自动识别生物结构，给 Prefab 装上运行时动画层（CreatureRig）与死亡布娃娃（CreatureRagdoll）。
    /// 识别规则覆盖管线里的两套命名：Tripo 语义重绑（thigh_L / fhoof_R / leg2_foot_L / tail_3…）与 Mixamo（LeftUpLeg / LeftFoot…）。
    ///   腿：以 foot / paw / hoof 结尾的骨骼为脚，往上两节为大腿、小腿（2–4 节腿都按最后三节做两骨 IK，8 条腿的蟹也一样）
    ///   骨盆：所有腿根的最近公共祖先；头颈：neck* → head；脊柱：spine / chest / waist / body…
    ///   弹簧链：tail / ribbon / robe / skirt / sleeve / banner / ear / bell / chain / mane…（按族给刚度、阻尼、重力）
    ///   布娃娃：骨盆、脊柱、头、腿的上两节、手臂、尾根两节；胶囊半径取该骨骼主导蒙皮顶点到骨段距离的 70% 分位数
    /// </summary>
    public static class CreatureRigBuilder
    {
        static readonly Regex FootRe = new(@"(^|_)(foot|paw|hoof|fhoof|hhoof)(_[LR])?$|^(Left|Right)Foot$|^leg\d+_foot_[LR]$|^leg_[LR]\d+c$", RegexOptions.IgnoreCase);
        static readonly Regex NeckRe = new(@"^neck(_?\d+)?$", RegexOptions.IgnoreCase);
        static readonly Regex HeadRe = new(@"^head$", RegexOptions.IgnoreCase);
        static readonly Regex SpineRe = new(@"^(spine\d?|chest|waist|torso|body|abdomen(_?\d+)?)$", RegexOptions.IgnoreCase);
        static readonly Regex PelvisRe = new(@"^(hips|pelvis)$", RegexOptions.IgnoreCase);
        static readonly Regex ArmRe = new(@"^(shoulder|arm|upperarm|forearm)_[LR]$|^(Left|Right)(Arm|ForeArm)$", RegexOptions.IgnoreCase);

        /// <summary>弹簧族：名字前缀 → (刚度, 阻尼, 重力)。刚度 = 每 1/60 秒向动画姿势拉回的比例</summary>
        static readonly (Regex re, string family, float stiff, float damp, float gravity)[] Families =
        {
            (new Regex(@"^tail", RegexOptions.IgnoreCase), "tail", 0.2f, 0.12f, 0f),
            (new Regex(@"^(ribbon|robe|skirt|apron|sleeve|banner|scarf|tassel|streamer|cloth)", RegexOptions.IgnoreCase), "cloth", 0.09f, 0.08f, 3f),
            (new Regex(@"^ear", RegexOptions.IgnoreCase), "ear", 0.32f, 0.2f, 0f),
            (new Regex(@"^(bell|chain|lock|pompom|string)", RegexOptions.IgnoreCase), "pendant", 0.06f, 0.04f, 5f),
            (new Regex(@"^(mane|beard|crest|feather|quill|frill|tent|hair|braid)", RegexOptions.IgnoreCase), "fur", 0.22f, 0.15f, 1f),
        };

        /// <summary>
        /// 不挂弹簧的链（资产 → 族）：这些骨骼是主动控制的肢体，动画已经精确给出姿势，再叠惯性只会乱甩。
        /// 蝎尾弩卫的尾巴举着毒囊、对着玩家瞄准（Three.js 版也是按瞄准程序化控制，不是甩的尾巴）
        /// </summary>
        static readonly System.Collections.Generic.Dictionary<string, string[]> NoSprings = new()
        {
            ["SK_Enemy_ScorpionArcher"] = new[] { "tail" },
        };

        public static void Setup(GameObject root, Animator animator, ArtSidecar sc)
        {
            var bones = animator.GetComponentsInChildren<Transform>(true)
                .Where(t => t != animator.transform && t.GetComponent<Renderer>() == null && !t.name.StartsWith(NativeClipBuilder.SocketPrefix)).ToList();
            var rig = animator.gameObject.AddComponent<CreatureRig>();
            root.AddComponent<CreatureLocomotion>();
            rig.characterRoot = root.transform;
            rig.groundMask = ~LayerMask.GetMask(ShowcaseSceneBuilder.CharacterLayer, ShowcaseSceneBuilder.FirstPersonLayer);

            // 腿
            var legs = new List<CreatureRig.Leg>();
            foreach (var foot in bones.Where(b => FootRe.IsMatch(b.name)))
            {
                var mid = foot.parent;
                var upper = mid ? mid.parent : null;
                if (!mid || !upper || upper == animator.transform || PelvisRe.IsMatch(mid.name) || PelvisRe.IsMatch(upper.name)) continue;
                legs.Add(new CreatureRig.Leg { upper = upper, mid = mid, end = foot, restLift = Mathf.Max(0, foot.position.y - root.transform.position.y) });
            }
            rig.legs = legs.ToArray();
            if (legs.Count > 0)
            {
                rig.legLength = legs.Average(l => Vector3.Distance(l.upper.position, l.mid.position) + Vector3.Distance(l.mid.position, l.end.position));
                // 骨盆：有 hips 用 hips，否则取所有腿根的最近公共祖先（蟹的 body、鹿的 hips）
                rig.pelvis = bones.FirstOrDefault(b => PelvisRe.IsMatch(b.name)) ?? CommonAncestor(legs.Select(l => l.upper.parent).ToList(), animator.transform);
            }

            // 头颈
            var head = bones.FirstOrDefault(b => HeadRe.IsMatch(b.name));
            if (head)
            {
                var chain = new List<Transform>();
                for (var t = head.parent; t && t != animator.transform; t = t.parent)
                    if (NeckRe.IsMatch(t.name)) chain.Insert(0, t);
                chain.Add(head);
                rig.lookBones = chain.ToArray();
            }
            // 脊柱（受击推开）：按层级从根到梢
            rig.spineBones = bones.Where(b => SpineRe.IsMatch(b.name) && b != rig.pelvis).OrderBy(Depth).ToArray();

            // 弹簧链：族内链头 = 父骨骼不属于同一族的骨骼，沿同族子骨骼往下
            var springs = new List<CreatureRig.SpringChain>();
            foreach (var b in bones)
            {
                var fam = Families.FirstOrDefault(f => f.re.IsMatch(b.name));
                if (fam.re == null || (b.parent && fam.re.IsMatch(b.parent.name))) continue;
                if (NoSprings.TryGetValue(sc.Id, out var skip) && skip.Contains(fam.family)) continue;
                var chain = new List<Transform> { b };
                for (var t = b; ;)
                {
                    var next = t.Cast<Transform>().FirstOrDefault(c => fam.re.IsMatch(c.name));
                    if (!next) break;
                    chain.Add(next);
                    t = next;
                }
                springs.Add(new CreatureRig.SpringChain { family = fam.family, bones = chain.ToArray(), stiffness = fam.stiff, damping = fam.damp, gravity = fam.gravity });
            }
            rig.springs = springs.ToArray();

            BuildRagdoll(root, animator, rig, bones);
            Debug.Log($"[Rig] {sc.Id}: 腿 {legs.Count}、头颈 {rig.lookBones.Length}、脊柱 {rig.spineBones.Length}、弹簧链 {springs.Count}（{string.Join(",", springs.Select(s => $"{s.bones[0].name}×{s.bones.Length}"))}）");
        }

        static int Depth(Transform t) { int d = 0; for (; t; t = t.parent) d++; return d; }

        static Transform CommonAncestor(List<Transform> ts, Transform stop)
        {
            if (ts.Count == 0) return null;
            var path = new List<Transform>();
            for (var t = ts[0]; t && t != stop.parent; t = t.parent) path.Add(t);
            foreach (var p in path)
                if (ts.All(x => x == p || x.IsChildOf(p))) return p;
            return ts[0];
        }

        // ───────────── 布娃娃 ─────────────
        static void BuildRagdoll(GameObject root, Animator animator, CreatureRig rig, List<Transform> bones)
        {
            var set = new List<Transform>();
            void Add(Transform t) { if (t && !set.Contains(t)) set.Add(t); }
            Add(rig.pelvis ? rig.pelvis : bones.FirstOrDefault(b => PelvisRe.IsMatch(b.name)));
            foreach (var s in rig.spineBones) Add(s);
            if (rig.lookBones.Length > 0) Add(rig.lookBones[^1]);
            foreach (var l in rig.legs) { Add(l.upper); Add(l.mid); }
            foreach (var a in bones.Where(b => ArmRe.IsMatch(b.name) && !b.name.StartsWith("shoulder", System.StringComparison.OrdinalIgnoreCase) && !b.name.EndsWith("Shoulder"))) Add(a);
            foreach (var s in rig.springs.Where(s => s.family == "tail")) for (int i = 0; i < Mathf.Min(2, s.bones.Length); i++) Add(s.bones[i]);
            set = set.Where(t => t).OrderBy(Depth).ToList();
            if (set.Count == 0) return;

            var smr = animator.GetComponentsInChildren<SkinnedMeshRenderer>(true).OrderByDescending(r => r.sharedMesh ? r.sharedMesh.vertexCount : 0).FirstOrDefault();
            var radii = MeasureRadii(smr, set);
            var parts = new List<CreatureRagdoll.Part>();
            var bodies = new Dictionary<Transform, Rigidbody>();
            foreach (var bone in set)
            {
                // 骨段方向：优先指向也在布娃娃里的子骨骼，否则取子树最大的子骨骼；叶子骨骼（头）沿父骨段方向外推
                var child = bone.Cast<Transform>().FirstOrDefault(c => set.Contains(c))
                            ?? bone.Cast<Transform>().Where(c => c.GetComponent<Renderer>() == null).OrderByDescending(c => c.GetComponentsInChildren<Transform>().Length).FirstOrDefault();
                Vector3 tipWorld = child ? child.position : bone.position + (bone.parent ? (bone.position - bone.parent.position) * 0.6f : Vector3.up * 0.2f);
                float len = Mathf.Max(0.03f, Vector3.Distance(bone.position, tipWorld));
                float r = radii.TryGetValue(bone, out var rr) ? rr : len * 0.25f;
                r = Mathf.Clamp(r, 0.02f, Mathf.Max(0.03f, len * 0.7f));
                var localTip = bone.InverseTransformPoint(tipWorld);
                float scale = Mathf.Max(1e-4f, bone.lossyScale.x);
                var cap = bone.gameObject.AddComponent<CapsuleCollider>();
                int axis = Mathf.Abs(localTip.x) > Mathf.Abs(localTip.y) ? (Mathf.Abs(localTip.x) > Mathf.Abs(localTip.z) ? 0 : 2) : (Mathf.Abs(localTip.y) > Mathf.Abs(localTip.z) ? 1 : 2);
                cap.direction = axis;
                cap.center = localTip * 0.5f;
                cap.radius = r / scale;
                cap.height = (len + 2 * r) / scale;
                cap.enabled = false;
                var rb = bone.gameObject.AddComponent<Rigidbody>();
                rb.mass = Mathf.Max(0.3f, Mathf.PI * r * r * len * 900f);
                rb.isKinematic = true;
                rb.collisionDetectionMode = CollisionDetectionMode.ContinuousSpeculative;
                rb.linearDamping = 0.1f;
                rb.angularDamping = 0.6f;
                bodies[bone] = rb;
                var parentBody = AncestorBody(bone, bodies);
                if (parentBody)
                {
                    var j = bone.gameObject.AddComponent<CharacterJoint>();
                    j.connectedBody = parentBody;
                    j.enableProjection = true;
                    j.lowTwistLimit = new SoftJointLimit { limit = -20 };
                    j.highTwistLimit = new SoftJointLimit { limit = 20 };
                    j.swing1Limit = new SoftJointLimit { limit = 35 };
                    j.swing2Limit = new SoftJointLimit { limit = 35 };
                }
                parts.Add(new CreatureRagdoll.Part { body = rb, collider = cap });
            }
            root.AddComponent<CreatureRagdoll>().parts = parts.ToArray();
            int layer = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            if (layer >= 0) foreach (var t in root.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        static Rigidbody AncestorBody(Transform bone, Dictionary<Transform, Rigidbody> bodies)
        {
            for (var t = bone.parent; t; t = t.parent) if (bodies.TryGetValue(t, out var rb)) return rb;
            return null;
        }

        /// <summary>每根骨骼的胶囊半径：该骨骼权重 ≥ 0.5 的顶点到骨段（骨骼 → 主子骨骼）的距离，取 70% 分位数</summary>
        static Dictionary<Transform, float> MeasureRadii(SkinnedMeshRenderer smr, List<Transform> set)
        {
            var result = new Dictionary<Transform, float>();
            if (!smr || !smr.sharedMesh) return result;
            var mesh = new Mesh();
            smr.BakeMesh(mesh, true);
            var verts = mesh.vertices;
            Object.DestroyImmediate(mesh);
            var weights = smr.sharedMesh.boneWeights;
            if (weights.Length != verts.Length) return result;
            var bones = smr.bones;
            var toWorld = Matrix4x4.TRS(smr.transform.position, smr.transform.rotation, Vector3.one);
            var dist = set.ToDictionary(b => b, _ => new List<float>());
            for (int v = 0; v < verts.Length; v++)
            {
                var w = weights[v];
                if (w.weight0 < 0.5f || w.boneIndex0 >= bones.Length) continue;
                var b = bones[w.boneIndex0];
                if (!b || !dist.TryGetValue(b, out var list)) continue;
                var child = b.Cast<Transform>().FirstOrDefault(c => set.Contains(c)) ?? (b.childCount > 0 ? b.GetChild(0) : null);
                var p = toWorld.MultiplyPoint3x4(verts[v]);
                Vector3 a = b.position, e = child ? child.position : b.position;
                var ab = e - a;
                float t = ab.sqrMagnitude > 1e-8f ? Mathf.Clamp01(Vector3.Dot(p - a, ab) / ab.sqrMagnitude) : 0;
                list.Add(Vector3.Distance(p, a + ab * t));
            }
            foreach (var (b, list) in dist)
            {
                if (list.Count < 6) continue;
                list.Sort();
                result[b] = list[(int)(list.Count * 0.7f)];
            }
            return result;
        }
    }
}
