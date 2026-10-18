using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 原生骨架敌人的程序动画 → Unity 动画片段与状态机。
    /// 数据来自 scripts/unity/bake-native-anims.mjs（在 Node 里跑 Three.js 版的真实敌人代码逐帧采样），
    /// 存在 &lt;资产&gt;/Anim/&lt;资产&gt;.native-anim.json：每帧每根骨骼在模型空间的朝向与位置。
    ///
    /// 换算只用「模型空间增量」：D = q(t)·q_rest⁻¹，镜像到 Unity（glTF 右手系 → Unity 左手系，X 取反，四元数 (x, −y, −z, w)），
    /// 再乘上 Unity 这边同名骨骼自己的绑定朝向——不依赖 Blender / FBX 改过的骨骼局部轴向。位置同理用增量。
    /// 人形资产（Humanoid Avatar）的变换曲线不能直接播放：逐帧摆好骨骼后用 HumanPoseHandler 读成肌肉曲线，
    /// 非人形部分（尾巴、飘带、耳朵）保留变换曲线。
    /// 状态机 AC_&lt;资产&gt;：Idle ⇄ Move（Speed），任意状态 → 各招式（触发 act_&lt;状态&gt;），招式播完回 Idle。
    /// 受击（触发 Hit）在叠加层 Flinch 上播：同 Three.js 的 hurtKick 叠在当前动作上，不打断出招、移动中也不滑步；
    /// 底层的 Hit 状态只给眩晕用（玩法直接 CrossFade 过去）。
    /// </summary>
    public static class NativeClipBuilder
    {
        public const string ActPrefix = "act_";

        public static string DataPath(ArtSidecar sc) => $"{sc.Dir}/Anim/{sc.Id}.native-anim.json";

        static Quaternion Mir(Quaternion q) => new(q.x, -q.y, -q.z, q.w);
        static Vector3 Mir(Vector3 p) => new(-p.x, p.y, p.z);

        static Quaternion Q(JArray f, int i) => new((float)f[i], (float)f[i + 1], (float)f[i + 2], (float)f[i + 3]);
        static Vector3 P(JArray f, int i) => new((float)f[i + 4], (float)f[i + 5], (float)f[i + 6]);

        /// <summary>为有采样数据的资产生成片段与状态机；返回 资产 ID → 控制器。</summary>
        public static Dictionary<string, RuntimeAnimatorController> BuildAll(IEnumerable<ArtSidecar> sidecars)
        {
            var result = new Dictionary<string, RuntimeAnimatorController>();
            foreach (var sc in sidecars)
            {
                if (!File.Exists(DataPath(sc))) continue;
                var ac = Build(sc);
                if (ac) result[sc.Id] = ac;
            }
            return result;
        }

        public const string SocketPrefix = "socket_";

        /// <summary>挂点：名字（socket_&lt;挂点&gt;）、在采样数据里的序号、Unity 模型空间的静止位置 / 朝向、挂件缩放</summary>
        public static List<(string name, int index, Vector3 pos, Quaternion rot, float scale)> Sockets(ArtSidecar sc, JObject data = null)
        {
            var list = new List<(string, int, Vector3, Quaternion, float)>();
            if (data == null)
            {
                if (!sc.HasNativeAnim) return list;
                data = JObject.Parse(File.ReadAllText(DataPath(sc)));
            }
            var names = data["sockets"]?.ToObject<string[]>() ?? new string[0];
            int nb = data["bones"]!.Count();
            var rest = (JArray)data["rest"];
            for (int k = 0; k < names.Length; k++)
            {
                int idx = nb + k;
                float s = (float?)data["socketScale"]?[names[k]] ?? 1f;
                list.Add((SocketPrefix + names[k], idx, Mir(P(rest, idx * 7)), Mir(Q(rest, idx * 7)), s));
            }
            return list;
        }

        /// <summary>Move 片段录制时的移动速度（米 / 秒）；没有 Move 时为 0</summary>
        public static float MoveSpeed(ArtSidecar sc)
        {
            if (!sc.HasNativeAnim) return 0f;
            var data = JObject.Parse(File.ReadAllText(DataPath(sc)));
            return (float?)data["clips"]?["Move"]?["speed"] ?? 0f;
        }

        sealed class BoneMap
        {
            public string name;
            public Transform t;
            public int index;          // 在采样数据里的序号
            public Quaternion restRot; // Unity 绑定姿势：模型空间
            public Vector3 restPos;
            public Quaternion srcRestInv;
            public Vector3 srcRestPos;
        }

        public static AnimatorController Build(ArtSidecar sc)
        {
            var data = JObject.Parse(File.ReadAllText(DataPath(sc)));
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(sc.FbxPath);
            if (!model) return null;
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                inst.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                var animator = inst.GetComponent<Animator>();
                if (!animator) { Debug.LogWarning($"[Anim] {sc.Id}: 模型上没有 Animator"); return null; }
                var all = inst.GetComponentsInChildren<Transform>(true);
                var byName = new Dictionary<string, Transform>();
                foreach (var t in all) byName.TryAdd(t.name, t);

                var boneNames = data["bones"]!.ToObject<string[]>();
                var rest = (JArray)data["rest"];
                var maps = new List<BoneMap>();
                for (int i = 0; i < boneNames.Length; i++)
                {
                    if (!byName.TryGetValue(boneNames[i], out var t)) { Debug.LogWarning($"[Anim] {sc.Id}: Unity 模型里没有骨骼 {boneNames[i]}"); continue; }
                    maps.Add(new BoneMap
                    {
                        name = boneNames[i], t = t, index = i, restRot = t.rotation, restPos = t.position,
                        srcRestInv = Quaternion.Inverse(Q(rest, i * 7)), srcRestPos = P(rest, i * 7),
                    });
                }
                // 人形资产导出时手臂摆成了 T-pose（采样数据是 GLB 原来的 A-pose）：按骨骼位置重算 Blender 当时的最小转角修正
                // （上臂把肘对到水平，前臂再把腕对到水平；手与手指继承前臂的累计修正），从 Unity 绑定朝向里扣掉
                if ((bool?)(sc.raw["rig"]?["tpose"] as JObject)?["applied"] == true)
                {
                    var human = sc.HumanMap;
                    var restA = maps.ToDictionary(m => m.name, m => Mir(P(rest, m.index * 7)));
                    var restT = maps.ToDictionary(m => m.name, m => m.t.position);
                    foreach (var side in new[] { "Left", "Right" })
                    {
                        if (!human.TryGetValue(side + "UpperArm", out var ua) || !human.TryGetValue(side + "LowerArm", out var la) ||
                            !human.TryGetValue(side + "Hand", out var hd) || !restA.ContainsKey(ua) || !restA.ContainsKey(la) || !restA.ContainsKey(hd)) continue;
                        var r1 = Quaternion.FromToRotation(restA[la] - restA[ua], restT[la] - restT[ua]);
                        var r2 = Quaternion.FromToRotation(r1 * (restA[hd] - restA[la]), restT[hd] - restT[la]) * r1;
                        var lower = byName[la];
                        foreach (var m in maps)
                        {
                            if (m.name == ua) m.restRot = Quaternion.Inverse(r1) * m.restRot;
                            else if (m.t == lower || m.t.IsChildOf(lower)) m.restRot = Quaternion.Inverse(r2) * m.restRot;
                        }
                    }
                }
                // 挂点（琵琶、盾、持枪点…）：非骨骼节点，数据排在骨骼之后。临时建在 Animator 根下，曲线路径 = socket_<名>，
                // Prefab 里由 ArtPrefabBuilder 建同名节点、挂件挂在它下面。挂件自身的导入换算与本体一致，所以挂点的 Unity 朝向就是镜像后的采样朝向
                foreach (var s in Sockets(sc, data))
                {
                    var go = new GameObject(s.name);
                    go.transform.SetParent(animator.transform, false);
                    go.transform.SetLocalPositionAndRotation(s.pos, s.rot);
                    maps.Add(new BoneMap
                    {
                        name = s.name, t = go.transform, index = s.index, restRot = go.transform.rotation, restPos = go.transform.position,
                        srcRestInv = Quaternion.Inverse(Q(rest, s.index * 7)), srcRestPos = P(rest, s.index * 7),
                    });
                }
                all = inst.GetComponentsInChildren<Transform>(true);
                // 父骨骼先算：按层级先序排列
                var order = all.Select((t, k) => (t, k)).ToDictionary(x => x.t, x => x.k);
                maps.Sort((a, b) => order[a.t].CompareTo(order[b.t]));
                var restLocal = all.ToDictionary(t => t, t => (t.localPosition, t.localRotation));

                string dir = $"{sc.Dir}/Anim";
                float fps = (float)data["fps"];
                var clips = new Dictionary<string, AnimationClip>();
                HumanPoseHandler handler = sc.IsHumanoid && animator.avatar && animator.avatar.isHuman
                    ? new HumanPoseHandler(animator.avatar, inst.transform) : null;
                var humanBones = new HashSet<Transform>();
                if (handler != null)
                    foreach (HumanBodyBones hb in System.Enum.GetValues(typeof(HumanBodyBones)))
                        if (hb != HumanBodyBones.LastBone && animator.GetBoneTransform(hb) is { } ht) humanBones.Add(ht);

                // 受击叠加片段 Flinch：待机第 0 帧 + Hit 全部帧。叠加层以片段自己的第 0 帧为参考姿势，
                // 叠上去的就是「受击一抖再衰减」本身（Hit 采样时 hurtKick 直接置 1，它的第 0 帧已经是踢满的姿势，不能当参考；
                // AnimationUtility.SetAdditiveReferencePose 又不接受我们生成的片段）
                var clipToks = ((JObject)data["clips"]).Properties().Select(p => (p.Name, (JObject)p.Value)).ToList();
                if (data["clips"]?["Hit"] is JObject hitTok && data["clips"]?["Idle"] is JObject idleTok)
                {
                    var fl = (JObject)hitTok.DeepClone();
                    var fr = (JArray)fl["frames"];
                    fr.Insert(0, ((JArray)idleTok["frames"])[0].DeepClone());
                    if (fl["rootY"] is JArray ry) ry.Insert(0, ((JArray)idleTok["rootY"])?[0] ?? 0);
                    fl["events"] = new JArray();
                    fl["loop"] = false;
                    clipToks.Add(("Flinch", fl));
                }

                foreach (var (name, c) in clipToks)
                {
                    var frames = (JArray)c["frames"];
                    var rootY = c["rootY"]?.ToObject<float[]>();
                    bool loop = (bool?)c["loop"] ?? false;
                    var clip = new AnimationClip { name = $"{sc.Id}_{name}", frameRate = fps };
                    var rot = maps.ToDictionary(m => m, _ => new List<Quaternion>());
                    var pos = maps.ToDictionary(m => m, _ => new List<Vector3>());

                    for (int f = 0; f < frames.Count; f++)
                    {
                        var fr = (JArray)frames[f];
                        float dy = rootY != null && f < rootY.Length ? rootY[f] : 0f;
                        var worldRot = new Dictionary<Transform, Quaternion>();
                        var worldPos = new Dictionary<Transform, Vector3>();
                        foreach (var m in maps)
                        {
                            int i = m.index * 7;
                            var delta = Mir(Q(fr, i) * m.srcRestInv);
                            var wr = delta * m.restRot;
                            // 位置直接取采样的绝对值（镜像）：T-pose 资产的手臂关节位置与 A-pose 不同，不能用增量
                            var wp = Mir(P(fr, i)) + new Vector3(0, dy, 0);
                            worldRot[m.t] = wr;
                            worldPos[m.t] = wp;
                            var parent = m.t.parent;
                            var pr = worldRot.TryGetValue(parent, out var a) ? a : parent.rotation;
                            var pp = worldPos.TryGetValue(parent, out var b) ? b : parent.position;
                            var ls = parent.lossyScale;
                            var local = Quaternion.Inverse(pr) * (wp - pp);
                            rot[m].Add(Quaternion.Inverse(pr) * wr);
                            pos[m].Add(new Vector3(local.x / ls.x, local.y / ls.y, local.z / ls.z));
                        }
                    }

                    if (handler == null)
                    {
                        foreach (var m in maps) WriteTransformCurves(clip, animator.transform, m.t, rot[m], pos[m], fps, restLocal[m.t]);
                    }
                    else
                    {
                        WriteHumanCurves(clip, handler, maps, rot, pos, fps, frames.Count);
                        foreach (var m in maps.Where(m => !humanBones.Contains(m.t)))
                            WriteTransformCurves(clip, animator.transform, m.t, rot[m], pos[m], fps, restLocal[m.t]);
                        foreach (var t in all) (t.localPosition, t.localRotation) = restLocal[t];
                    }

                    var settings = AnimationUtility.GetAnimationClipSettings(clip);
                    settings.loopTime = loop;
                    settings.keepOriginalOrientation = settings.keepOriginalPositionY = settings.keepOriginalPositionXZ = true;
                    settings.loopBlendOrientation = settings.loopBlendPositionY = settings.loopBlendPositionXZ = true;
                    AnimationUtility.SetAnimationClipSettings(clip, settings);
                    // 动画事件：采样时游戏逻辑真实调用伤害 / 弹体 / 特效 / 音效的时刻（不用人工标帧），
                    // 由 Animator 同物体上的 CreatureRig.OnAnimEvent(name) 接收、转发给玩法
                    var evs = ((JArray)c["events"] ?? new JArray()).OfType<JObject>()
                        .Select(ev => new AnimationEvent
                        {
                            time = Mathf.Min((float)ev["t"], Mathf.Max(0, (frames.Count - 1) / fps)),
                            functionName = "OnAnimEvent",
                            stringParameter = (string)ev["name"],
                        }).ToArray();
                    AnimationUtility.SetAnimationEvents(clip, evs);
                    string path = $"{dir}/{clip.name}.anim";
                    var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
                    if (existing) { EditorUtility.CopySerialized(clip, existing); clip = existing; }
                    else AssetDatabase.CreateAsset(clip, path);
                    clips[name] = clip;
                }
                handler?.Dispose();
                return BuildController(sc, dir, clips, data);
            }
            finally
            {
                Object.DestroyImmediate(inst);
            }
        }

        static void WriteTransformCurves(AnimationClip clip, Transform root, Transform t, List<Quaternion> rot, List<Vector3> pos,
            float fps, (Vector3 p, Quaternion q) rest)
        {
            string path = AnimationUtility.CalculateTransformPath(t, root);
            // 四元数连续性：与上一帧点积为负就取反，避免插值绕远路
            for (int i = 1; i < rot.Count; i++)
                if (Quaternion.Dot(rot[i], rot[i - 1]) < 0) rot[i] = new Quaternion(-rot[i].x, -rot[i].y, -rot[i].z, -rot[i].w);
            bool rotMoves = rot.Any(q => Quaternion.Angle(q, rest.q) > 0.05f);
            bool posMoves = pos.Any(p => (p - rest.p).sqrMagnitude > 1e-8f);
            if (rotMoves)
            {
                string[] axes = { "x", "y", "z", "w" };
                for (int a = 0; a < 4; a++)
                {
                    var keys = rot.Select((q, i) => new Keyframe(i / fps, q[a])).ToArray();
                    AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve(path, typeof(Transform), $"m_LocalRotation.{axes[a]}"), Reduce(keys, 0.0015f));
                }
            }
            if (posMoves)
            {
                string[] axes = { "x", "y", "z" };
                for (int a = 0; a < 3; a++)
                {
                    var keys = pos.Select((p, i) => new Keyframe(i / fps, p[a])).ToArray();
                    AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve(path, typeof(Transform), $"m_LocalPosition.{axes[a]}"), Reduce(keys, 0.0008f));
                }
            }
        }

        /// <summary>
        /// 关键帧精简：采样是逐帧的（30 fps），大部分骨骼大部分时间在平滑变化。贪心地只保留「去掉它、用前后保留帧线性插值会超出
        /// tolerance」的帧，首尾帧总保留；切线用 ClampedAuto，播放与逐帧结果的差别小于容差。
        /// </summary>
        static AnimationCurve Reduce(Keyframe[] keys, float tolerance)
        {
            if (keys.Length <= 2) return new AnimationCurve(keys);
            var kept = new List<Keyframe> { keys[0] };
            int anchor = 0;
            for (int i = 1; i < keys.Length - 1; i++)
            {
                // 从 anchor 连到 i+1，检查中间所有帧
                bool ok = true;
                for (int j = anchor + 1; j <= i && ok; j++)
                {
                    float u = (keys[j].time - keys[anchor].time) / (keys[i + 1].time - keys[anchor].time);
                    ok = Mathf.Abs(Mathf.Lerp(keys[anchor].value, keys[i + 1].value, u) - keys[j].value) <= tolerance;
                }
                if (!ok) { kept.Add(keys[i]); anchor = i; }
            }
            kept.Add(keys[^1]);
            var curve = new AnimationCurve(kept.ToArray());
            for (int i = 0; i < curve.length; i++)
            {
                AnimationUtility.SetKeyLeftTangentMode(curve, i, AnimationUtility.TangentMode.ClampedAuto);
                AnimationUtility.SetKeyRightTangentMode(curve, i, AnimationUtility.TangentMode.ClampedAuto);
            }
            return curve;
        }

        static readonly Regex Finger = new(@"^(Left|Right) (Thumb|Index|Middle|Ring|Little) (\d Stretched|Spread)$");

        /// <summary>HumanTrait.MuscleName 与动画片段里的属性名不完全一致：手指肌肉在片段里写成 LeftHand.Thumb.1 Stretched。</summary>
        static string MuscleProperty(string muscle)
        {
            var m = Finger.Match(muscle);
            return m.Success ? $"{m.Groups[1].Value}Hand.{m.Groups[2].Value}.{m.Groups[3].Value}" : muscle;
        }

        static void WriteHumanCurves(AnimationClip clip, HumanPoseHandler handler, List<BoneMap> maps,
            Dictionary<BoneMap, List<Quaternion>> rot, Dictionary<BoneMap, List<Vector3>> pos, float fps, int count)
        {
            int nm = HumanTrait.MuscleCount;
            var muscles = new Keyframe[nm][];
            for (int k = 0; k < nm; k++) muscles[k] = new Keyframe[count];
            var rootT = new Keyframe[3][];
            var rootQ = new Keyframe[4][];
            for (int k = 0; k < 3; k++) rootT[k] = new Keyframe[count];
            for (int k = 0; k < 4; k++) rootQ[k] = new Keyframe[count];
            var hp = new HumanPose();
            Quaternion prevQ = Quaternion.identity;
            for (int f = 0; f < count; f++)
            {
                foreach (var m in maps)
                {
                    m.t.localRotation = rot[m][f];
                    m.t.localPosition = pos[m][f];
                }
                handler.GetHumanPose(ref hp);
                float t = f / fps;
                for (int k = 0; k < nm; k++) muscles[k][f] = new Keyframe(t, hp.muscles[k]);
                var q = hp.bodyRotation;
                if (f > 0 && Quaternion.Dot(q, prevQ) < 0) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
                prevQ = q;
                for (int k = 0; k < 3; k++) rootT[k][f] = new Keyframe(t, hp.bodyPosition[k]);
                for (int k = 0; k < 4; k++) rootQ[k][f] = new Keyframe(t, q[k]);
            }
            for (int k = 0; k < nm; k++)
                AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), MuscleProperty(HumanTrait.MuscleName[k])), Reduce(muscles[k], 0.003f));
            string[] xyz = { "x", "y", "z" }, xyzw = { "x", "y", "z", "w" };
            for (int k = 0; k < 3; k++)
                AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), $"RootT.{xyz[k]}"), Reduce(rootT[k], 0.0008f));
            for (int k = 0; k < 4; k++)
                AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), $"RootQ.{xyzw[k]}"), Reduce(rootQ[k], 0.0015f));
        }

        static AnimatorController BuildController(ArtSidecar sc, string dir, Dictionary<string, AnimationClip> clips, JObject data)
        {
            string path = $"{dir}/AC_{sc.Id}.controller";
            AssetDatabase.DeleteAsset(path);
            var ac = AnimatorController.CreateAnimatorControllerAtPath(path);
            ac.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ac.AddParameter("Hit", AnimatorControllerParameterType.Trigger);
            var sm = ac.layers[0].stateMachine;
            // 运动：一维混合树，阈值 = 各片段录制时的实际速度（Idle 0 / Walk 半速 / Move 全速），
            // 超过最高速度时由 MoveScale 加快播放（Three.js 版只有一套步态参数硬插值）
            ac.AddParameter("MoveScale", AnimatorControllerParameterType.Float);
            var idle = ac.CreateBlendTreeInController("Locomotion", out var tree, 0);
            tree.blendType = BlendTreeType.Simple1D;
            tree.blendParameter = "Speed";
            tree.useAutomaticThresholds = false;
            if (clips.TryGetValue("Idle", out var idleClip)) tree.AddChild(idleClip, 0f);
            foreach (var n in new[] { "Walk", "Move" })
                if (clips.TryGetValue(n, out var c)) tree.AddChild(c, (float?)data["clips"]?[n]?["speed"] ?? (n == "Walk" ? 1f : 2f));
            idle.speedParameterActive = true;
            idle.speedParameter = "MoveScale";
            sm.defaultState = idle;

            if (clips.TryGetValue("Hit", out var hitClip))
            {
                var hit = sm.AddState("Hit", new Vector3(520, -80, 0));
                hit.motion = hitClip;
                var back = hit.AddTransition(idle);
                back.hasExitTime = true;
                back.exitTime = 0.95f;
                back.duration = 0.1f;
            }
            if (clips.TryGetValue("Flinch", out var flinchClip))
            {
                // 叠加层：Flinch 片段 = 待机第 0 帧 + Hit（见 Build），以自己的第 0 帧为参考姿势
                ac.AddLayer("Flinch");
                var layers = ac.layers;
                var fl = layers[^1];
                fl.blendingMode = AnimatorLayerBlendingMode.Additive;
                fl.defaultWeight = 1;
                ac.layers = layers;
                var fsm = fl.stateMachine;
                var none = fsm.AddState("FlinchNone", new Vector3(300, 0, 0));
                none.writeDefaultValues = false;
                var flinch = fsm.AddState("Flinch", new Vector3(300, 80, 0));
                flinch.motion = flinchClip;
                flinch.writeDefaultValues = false;
                fsm.defaultState = none;
                var anyHit = fsm.AddAnyStateTransition(flinch);
                anyHit.AddCondition(AnimatorConditionMode.If, 0, "Hit");
                anyHit.hasExitTime = false;
                anyHit.duration = 0.03f;
                anyHit.canTransitionToSelf = true;
                var settle = flinch.AddTransition(none);
                settle.hasExitTime = true;
                settle.exitTime = 0.9f;
                settle.duration = 0.1f;
            }

            // 招式：采样时连续出现的状态（windup → 出招 → 收招）串成连段，只有段首挂触发器 act_<状态>
            var actions = clips.Where(kv => kv.Key is not ("Idle" or "Walk" or "Move" or "Hit" or "Flinch")).ToList();
            // 招式播放速度：玩法按实际前摇时长拉伸片段（EnemyAI.PlayTimed），默认 1
            ac.AddParameter("ActScale", AnimatorControllerParameterType.Float);
            var states = new Dictionary<string, AnimatorState>();
            int row = 0;
            foreach (var (name, clip) in actions)
            {
                var st = sm.AddState(name, new Vector3(520, 40 + 60 * row++, 0));
                st.motion = clip;
                st.speedParameterActive = true;
                st.speedParameter = "ActScale";
                states[name] = st;
            }
            string Next(string n) => (string)data["clips"]?[n]?["next"];
            var chained = new HashSet<string>(actions.Select(a => Next(a.Key)).Where(n => n != null && states.ContainsKey(n)));
            foreach (var (name, _) in actions)
            {
                var st = states[name];
                if (!chained.Contains(name))
                {
                    ac.AddParameter(ActPrefix + name, AnimatorControllerParameterType.Trigger);
                    var any = sm.AddAnyStateTransition(st);
                    any.AddCondition(AnimatorConditionMode.If, 0, ActPrefix + name);
                    any.hasExitTime = false;
                    any.duration = 0.12f;
                }
                string next = Next(name);
                var back = st.AddTransition(next != null && states.TryGetValue(next, out var ns) && ns != st ? ns : idle);
                back.hasExitTime = true;
                back.exitTime = 0.98f;
                back.duration = next != null && states.ContainsKey(next) ? 0.05f : 0.2f;
            }
            // 浮点参数默认 0 会让 Move 状态以 0 倍速播放：MoveScale 默认 1
            var ps = ac.parameters;
            foreach (var p in ps) if (p.name is "MoveScale" or "ActScale") p.defaultFloat = 1f;
            ac.parameters = ps;
            EditorUtility.SetDirty(ac);
            return ac;
        }
    }
}
