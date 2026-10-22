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
    ///
    /// 另外两个来源，和采样片段并进同一个 AC_：
    /// - 事件叠加表 &lt;资产&gt;/Anim/&lt;资产&gt;.events.json（手写、入库）：按状态给命名事件（归一化时刻 0–1），写成 Mecanim 动画事件
    ///   （OnAnimEvent(name)）。采样时游戏代码真实调用的伤害 / 弹体 / 音效时刻已经自动是事件；叠加表补采样记不到的
    ///   （Boss 不跑 AI，片段没有事件；脚步、手工关键帧片段），也可以 replace 掉采样事件、改连段（next）和循环（loop）：
    ///   <code>{ "clips": { "slam": { "events": [{ "at": 0.42, "name": "hit" }], "replace": false, "next": "recover", "loop": false },
    ///            "roar": [{ "at": 0.3, "name": "sfx:boss_roar" }] } }</code>
    /// - 手工关键帧 FBX &lt;资产&gt;/Anim/Keyframed/*.fbx（Blender 关键帧，如旱魃）：文件名 = 状态名（一个文件多个 take 时用 take 名），
    ///   导入设置对齐本体（人形用本体的 Avatar，Generic 按骨骼名重定向曲线），复制成 &lt;资产&gt;_&lt;状态&gt;.anim 并进状态机；
    ///   与采样片段同名时手工片段优先。没有采样数据、只有关键帧的资产也照样生成 AC_。
    /// 持续型片段（loop 为真的招式：潜游、栖落、盘旋、空手追击）进状态后一直循环，由玩法 CrossFade 出去，不自动回 Idle。
    /// </summary>
    public static class NativeClipBuilder
    {
        public const string ActPrefix = "act_";

        public static string DataPath(ArtSidecar sc) => $"{sc.Dir}/Anim/{sc.Id}.native-anim.json";
        public static string EventsPath(ArtSidecar sc) => $"{sc.Dir}/Anim/{sc.Id}.events.json";
        public static string KeyframedDir(ArtSidecar sc) => $"{sc.Dir}/Anim/Keyframed";

        /// <summary>手工关键帧 FBX（按路径排序）</summary>
        public static string[] KeyframedFiles(ArtSidecar sc)
        {
            string dir = KeyframedDir(sc);
            return Directory.Exists(dir)
                ? Directory.GetFiles(dir, "*.fbx").Select(p => p.Replace('\\', '/')).OrderBy(p => p, System.StringComparer.Ordinal).ToArray()
                : new string[0];
        }

        /// <summary>有动作片段来源：采样数据或手工关键帧</summary>
        public static bool HasClips(ArtSidecar sc) => File.Exists(DataPath(sc)) || KeyframedFiles(sc).Length > 0;

        /// <summary>事件叠加表的 clips 节点；没有文件时为空对象</summary>
        static JObject LoadOverlay(ArtSidecar sc)
        {
            string p = EventsPath(sc);
            if (!File.Exists(p)) return new JObject();
            try { return JObject.Parse(File.ReadAllText(p))["clips"] as JObject ?? new JObject(); }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[Anim] {sc.Id}: 事件叠加表读不了（{e.Message}），忽略");
                return new JObject();
            }
        }

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
                if (!HasClips(sc)) continue;
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

        /// <summary>Move 片段录制时的移动速度（米 / 秒）；叠加表里写了 Move.speed 时以它为准（手工关键帧的 Move）；没有 Move 时为 0</summary>
        public static float MoveSpeed(ArtSidecar sc)
        {
            if ((float?)(LoadOverlay(sc)["Move"] as JObject)?["speed"] is float s) return s;
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
            var data = File.Exists(DataPath(sc)) ? JObject.Parse(File.ReadAllText(DataPath(sc))) : null;
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(sc.FbxPath);
            if (!model) return null;
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                inst.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                var animator = inst.GetComponent<Animator>();
                if (!animator) { Debug.LogWarning($"[Anim] {sc.Id}: 模型上没有 Animator"); return null; }
                var byName = new Dictionary<string, Transform>();
                foreach (var t in inst.GetComponentsInChildren<Transform>(true)) byName.TryAdd(t.name, t);

                string dir = $"{sc.Dir}/Anim";
                var overlay = LoadOverlay(sc);
                var clips = new Dictionary<string, AnimationClip>();
                // 每个片段的连段 / 循环 / 录制速度（采样数据的 clips 节点 → 手工关键帧补 → 叠加表覆盖）
                var meta = new JObject();
                if (data != null) BuildNative(sc, data, inst, animator, byName, dir, overlay, clips, meta);
                MergeKeyframed(sc, animator, byName, dir, overlay, clips, meta);
                ApplyOverlayMeta(sc, overlay, clips, meta);
                if (clips.Count == 0) return null;
                return BuildController(sc, dir, clips, meta);
            }
            finally
            {
                Object.DestroyImmediate(inst);
            }
        }

        /// <summary>采样数据 → 片段（骨骼增量换算、人形肌肉曲线、Flinch 叠加片段、采样事件 + 叠加事件）</summary>
        static void BuildNative(ArtSidecar sc, JObject data, GameObject inst, Animator animator, Dictionary<string, Transform> byName,
            string dir, JObject overlay, Dictionary<string, AnimationClip> clips, JObject meta)
        {
            {
                var all = inst.GetComponentsInChildren<Transform>(true);
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

                float fps = (float)data["fps"];
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
                    // 动画事件：采样时游戏逻辑真实调用伤害 / 弹体 / 特效 / 音效的时刻（不用人工标帧），再并上叠加表；
                    // 由 Animator 同物体上的 CreatureRig.OnAnimEvent(name) 接收、转发给玩法
                    float length = Mathf.Max(0, (frames.Count - 1) / fps);
                    var sampled = ((JArray)c["events"] ?? new JArray()).OfType<JObject>()
                        .Select(ev => new AnimationEvent
                        {
                            time = Mathf.Min((float)ev["t"], length),
                            functionName = "OnAnimEvent",
                            stringParameter = (string)ev["name"],
                        });
                    AnimationUtility.SetAnimationEvents(clip, MergeEvents(sc, name, sampled, overlay, length));
                    clips[name] = SaveClip(clip, $"{dir}/{clip.name}.anim");
                    var cm = new JObject { ["loop"] = loop };
                    if (c["next"] != null) cm["next"] = c["next"];
                    if (c["speed"] != null) cm["speed"] = c["speed"];
                    meta[name] = cm;
                }
                handler?.Dispose();
            }
        }

        /// <summary>写到 path：已有同名片段就原地覆盖（保住 GUID，状态机 / 预制体的引用不断）</summary>
        static AnimationClip SaveClip(AnimationClip clip, string path)
        {
            var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
            if (existing) { EditorUtility.CopySerialized(clip, existing); return existing; }
            AssetDatabase.CreateAsset(clip, path);
            return clip;
        }

        // ───────────── 事件叠加表 ─────────────

        /// <summary>
        /// 叠加表里某个状态的条目：数组简写 = 只有事件；对象 = { events, replace, next, loop, speed }。
        /// 事件 { "at": 0–1 归一化时刻, "name": 事件名, "float": 可选浮点参数 }
        /// </summary>
        static (JArray events, bool replace) OverlayEntry(JObject overlay, string clip)
        {
            var tok = overlay[clip];
            if (tok is JArray arr) return (arr, false);
            if (tok is JObject o) return (o["events"] as JArray ?? new JArray(), (bool?)o["replace"] ?? false);
            return (new JArray(), false);
        }

        /// <summary>采样（或关键帧自带）事件 + 叠加事件（replace 时只留叠加的），按时刻排好</summary>
        static AnimationEvent[] MergeEvents(ArtSidecar sc, string clip, IEnumerable<AnimationEvent> own, JObject overlay, float length)
        {
            var (extra, replace) = OverlayEntry(overlay, clip);
            var list = replace ? new List<AnimationEvent>() : own.ToList();
            foreach (var ev in extra.OfType<JObject>())
            {
                string name = (string)ev["name"];
                if (string.IsNullOrEmpty(name) || ev["at"] == null)
                {
                    Debug.LogWarning($"[Anim] {sc.Id}: 叠加表 {clip} 里有缺 name / at 的事件，跳过");
                    continue;
                }
                list.Add(new AnimationEvent
                {
                    time = Mathf.Clamp01((float)ev["at"]) * length,
                    functionName = "OnAnimEvent",
                    stringParameter = name,
                    floatParameter = (float?)ev["float"] ?? 0f,
                });
            }
            return list.OrderBy(e => e.time).ToArray();
        }

        /// <summary>叠加表覆盖连段 / 循环 / 速度；叠加表里写了、AC_ 里却没有的状态给个提示（多半是拼错了）</summary>
        static void ApplyOverlayMeta(ArtSidecar sc, JObject overlay, Dictionary<string, AnimationClip> clips, JObject meta)
        {
            foreach (var p in overlay.Properties())
            {
                if (!clips.ContainsKey(p.Name))
                {
                    Debug.LogWarning($"[Anim] {sc.Id}: 叠加表里的状态 {p.Name} 没有片段（采样 / 关键帧里都没有），忽略");
                    continue;
                }
                if (p.Value is not JObject o) continue;
                var m = meta[p.Name] as JObject ?? new JObject();
                foreach (var key in new[] { "next", "loop", "speed" })
                    if (o[key] != null) m[key] = o[key];
                meta[p.Name] = m;
                if (o["loop"] != null)
                {
                    var clip = clips[p.Name];
                    var s = AnimationUtility.GetAnimationClipSettings(clip);
                    if (s.loopTime != (bool)o["loop"])
                    {
                        s.loopTime = (bool)o["loop"];
                        AnimationUtility.SetAnimationClipSettings(clip, s);
                        EditorUtility.SetDirty(clip);
                    }
                }
            }
        }

        // ───────────── 手工关键帧 FBX ─────────────

        /// <summary>状态名：一个文件一个 take 用文件名，多个 take 用 take 名（去掉 Blender 的「骨架|」前缀）；下划线 / 空格转驼峰——
        /// 片段名是 &lt;资产&gt;_&lt;状态&gt;，玩法按最后一个下划线拆状态名（EnemyAI.ClipLength）</summary>
        static string StateName(string raw)
        {
            raw = raw[(raw.LastIndexOf('|') + 1)..];
            var parts = Regex.Split(raw, @"[_\s\-.]+").Where(s => s.Length > 0).ToArray();
            if (parts.Length == 0) return raw;
            return parts[0] + string.Concat(parts.Skip(1).Select(s => char.ToUpperInvariant(s[0]) + s[1..]));
        }

        /// <summary>
        /// 关键帧 FBX 的导入设置对齐本体：同样的缩放 / 轴向换算；人形用本体的 Avatar（Copy From Other，片段是肌肉曲线，能直接播），
        /// 其余 Generic、不建 Avatar（曲线按骨骼名重定向到本体）。设置变了才重新导入
        /// </summary>
        static void PrepareKeyframedImporter(ArtSidecar sc, string path)
        {
            if (AssetImporter.GetAtPath(path) is not ModelImporter mi) return;
            var body = AssetImporter.GetAtPath(sc.FbxPath) as ModelImporter;
            bool dirty = false;
            void Set<T>(T cur, T want, System.Action<T> apply)
            {
                if (EqualityComparer<T>.Default.Equals(cur, want)) return;
                apply(want);
                dirty = true;
            }
            Set(mi.importAnimation, true, v => mi.importAnimation = v);
            Set(mi.materialImportMode, ModelImporterMaterialImportMode.None, v => mi.materialImportMode = v);
            Set(mi.importBlendShapes, false, v => mi.importBlendShapes = v);
            Set(mi.importCameras, false, v => mi.importCameras = v);
            Set(mi.importLights, false, v => mi.importLights = v);
            if (body)
            {
                Set(mi.globalScale, body.globalScale, v => mi.globalScale = v);
                Set(mi.useFileScale, body.useFileScale, v => mi.useFileScale = v);
                Set(mi.bakeAxisConversion, body.bakeAxisConversion, v => mi.bakeAxisConversion = v);
            }
            var avatar = sc.IsHumanoid ? AssetDatabase.LoadAllAssetsAtPath(sc.FbxPath).OfType<Avatar>().FirstOrDefault(a => a.isHuman) : null;
            if (avatar)
            {
                Set(mi.animationType, ModelImporterAnimationType.Human, v => mi.animationType = v);
                Set(mi.avatarSetup, ModelImporterAvatarSetup.CopyFromOther, v => mi.avatarSetup = v);
                if (mi.sourceAvatar != avatar) { mi.sourceAvatar = avatar; dirty = true; }
            }
            else
            {
                if (sc.IsHumanoid) Debug.LogWarning($"[Anim] {sc.Id}: 人形本体没有可用的 Avatar，关键帧按 Generic 导入");
                Set(mi.animationType, ModelImporterAnimationType.Generic, v => mi.animationType = v);
                Set(mi.avatarSetup, ModelImporterAvatarSetup.NoAvatar, v => mi.avatarSetup = v);
            }
            if (dirty) mi.SaveAndReimport();
            if (avatar) KeepNonHumanCurves(path, mi);
        }

        /// <summary>
        /// 人形片段不配遮罩时只导肌肉曲线，非人形骨（长发、残衣、袖垂片、宝珠等）的变换曲线全被丢掉：每个 take 配
        /// 「本模型建遮罩、全部骨骼启用」的 Transform 遮罩，这些骨的曲线才留在片段里。片段表按 FBX 当前的 take 重排
        /// （重新导出改了帧范围也跟着走），其余片段设置用导入默认值；设置变了才重新导入
        /// </summary>
        static void KeepNonHumanCurves(string path, ModelImporter mi)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (!model) return;
            var paths = model.GetComponentsInChildren<Transform>(true).Select(t => AnimationUtility.CalculateTransformPath(t, model.transform)).ToArray();
            var cur = mi.clipAnimations;
            var want = mi.defaultClipAnimations;
            var probe = new AvatarMask();
            try
            {
                bool Same(ModelImporterClipAnimation a, ModelImporterClipAnimation b)
                {
                    if (a.name != b.name || a.takeName != b.takeName || a.firstFrame != b.firstFrame || a.lastFrame != b.lastFrame) return false;
                    if (a.maskType != ClipAnimationMaskType.CreateFromThisModel) return false;
                    a.ConfigureMaskFromClip(ref probe);
                    if (probe.transformCount != paths.Length) return false;
                    for (int i = 0; i < paths.Length; i++)
                        if (probe.GetTransformPath(i) != paths[i] || !probe.GetTransformActive(i)) return false;
                    return true;
                }
                if (cur.Length == want.Length && cur.Zip(want, Same).All(x => x)) return;

                var mask = new AvatarMask { transformCount = paths.Length };
                for (int i = 0; i < paths.Length; i++)
                {
                    mask.SetTransformPath(i, paths[i]);
                    mask.SetTransformActive(i, true);
                }
                foreach (var c in want)
                {
                    c.ConfigureClipFromMask(mask);
                    c.maskType = ClipAnimationMaskType.CreateFromThisModel;
                }
                Object.DestroyImmediate(mask);
                mi.clipAnimations = want;
                mi.SaveAndReimport();
            }
            finally
            {
                Object.DestroyImmediate(probe);
            }
        }

        /// <summary>
        /// 复制关键帧片段：Transform 曲线的路径在本体里找不到时按末级骨骼名重定向（Blender 导出的骨架根名与本体 FBX 不一定一样）；
        /// 根节点自身的曲线丢掉（整体位移 / 转向是玩法的事）；人形肌肉曲线（Animator 上的属性）原样保留
        /// </summary>
        static AnimationClip CopyKeyframed(AnimationClip src, Transform root, Dictionary<string, Transform> byName, string name, out int moved, out int dropped)
        {
            moved = dropped = 0;
            var dst = new AnimationClip { name = name, frameRate = src.frameRate };
            foreach (var b in AnimationUtility.GetCurveBindings(src))
            {
                var nb = b;
                if (b.type != typeof(Animator))
                {
                    if (b.path.Length == 0) { dropped++; continue; }
                    if (!root.Find(b.path))
                    {
                        string leaf = b.path[(b.path.LastIndexOf('/') + 1)..];
                        if (!byName.TryGetValue(leaf, out var t) || t == root) { dropped++; continue; }
                        nb.path = AnimationUtility.CalculateTransformPath(t, root);
                        moved++;
                    }
                }
                AnimationUtility.SetEditorCurve(dst, nb, AnimationUtility.GetEditorCurve(src, b));
            }
            AnimationUtility.SetAnimationClipSettings(dst, AnimationUtility.GetAnimationClipSettings(src));
            return dst;
        }

        /// <summary>Anim/Keyframed/*.fbx 并进片段表：与采样片段同名时手工片段优先；事件 = FBX 自带的 + 叠加表</summary>
        static void MergeKeyframed(ArtSidecar sc, Animator animator, Dictionary<string, Transform> byName, string dir, JObject overlay,
            Dictionary<string, AnimationClip> clips, JObject meta)
        {
            foreach (var path in KeyframedFiles(sc))
            {
                PrepareKeyframedImporter(sc, path);
                var takes = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>()
                    .Where(c => !c.name.StartsWith("__preview__")).ToList();
                if (takes.Count == 0) { Debug.LogWarning($"[Anim] {sc.Id}: {path} 里没有动画"); continue; }
                foreach (var src in takes)
                {
                    string state = StateName(takes.Count == 1 ? Path.GetFileNameWithoutExtension(path) : src.name);
                    var clip = CopyKeyframed(src, animator.transform, byName, $"{sc.Id}_{state}", out int moved, out int dropped);
                    var s = AnimationUtility.GetAnimationClipSettings(clip);
                    bool loop = state is "Idle" or "Walk" or "Move" || s.loopTime;
                    s.loopTime = loop;
                    s.keepOriginalOrientation = s.keepOriginalPositionY = s.keepOriginalPositionXZ = true;
                    s.loopBlendOrientation = s.loopBlendPositionY = s.loopBlendPositionXZ = true;
                    AnimationUtility.SetAnimationClipSettings(clip, s);
                    AnimationUtility.SetAnimationEvents(clip, MergeEvents(sc, state, AnimationUtility.GetAnimationEvents(src), overlay, clip.length));
                    if (clips.ContainsKey(state)) Debug.Log($"[Anim] {sc.Id}: 手工关键帧 {state} 替换采样片段");
                    clips[state] = SaveClip(clip, $"{dir}/{clip.name}.anim");
                    meta[state] = new JObject { ["loop"] = loop };
                    Debug.Log($"[Anim] {sc.Id}: 关键帧 {Path.GetFileName(path)} → {state}（{clip.length:0.00}s{(loop ? "↻" : "")}" +
                              $"{(moved > 0 ? $"，按骨骼名重定向 {moved} 条曲线" : "")}{(dropped > 0 ? $"，丢掉 {dropped} 条找不到骨骼 / 根节点的曲线" : "")}）");
                }
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

        static AnimatorController BuildController(ArtSidecar sc, string dir, Dictionary<string, AnimationClip> clips, JObject meta)
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
                if (clips.TryGetValue(n, out var c)) tree.AddChild(c, (float?)meta[n]?["speed"] ?? (n == "Walk" ? 1f : 2f));
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
            string Next(string n) => (string)meta[n]?["next"];
            // 持续型（loop 为真的招式：潜游、栖落、盘旋、空手追击）：进去后一直循环，由玩法 CrossFade 出去
            bool Held(string n) => (bool?)meta[n]?["loop"] == true;
            var chained = new HashSet<string>(actions.Select(a => Next(a.Key)).Where(n => n != null && states.ContainsKey(n)));
            foreach (var (name, _) in actions)
            {
                var st = states[name];
                if (!chained.Contains(name) || Held(name))
                {
                    ac.AddParameter(ActPrefix + name, AnimatorControllerParameterType.Trigger);
                    var any = sm.AddAnyStateTransition(st);
                    any.AddCondition(AnimatorConditionMode.If, 0, ActPrefix + name);
                    any.hasExitTime = false;
                    any.duration = 0.12f;
                }
                if (Held(name)) continue;
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
