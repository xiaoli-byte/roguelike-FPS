using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一把碎刃的模型（Prefab SK_Weapon_DemonBlade 的根；没烘焙时 <see cref="BladeAssets.CreateModel"/> 运行时现场组装同样的层级）：
    ///   根节点原点 = 右手握持点；Frame = 刀身局部坐标系（+Y 刀尖、+X 刃口）。中性朝向与枪模一致：刀身沿 −Z（「枪管」方向）、刃口朝下，
    ///   所以掉落物、第一人称 rig（PlayerFactory 把枪模绕 Y 转 180° 挂在相机下）都能直接用。
    ///   Shards = 128 片碎刃的蒙皮渲染器，骨骼 Frame/Bones/S000…S127 放在各自片心：缩放 0 = 这片不在手里（飞出去了）。
    ///   Root = 刀根鬼面厚板（_BaseMap_ST 偏移切睁眼贴图）、Hilt = 刀柄、Tip = 刀尖锚点。
    /// 第一人称表现（WC7 的 <see cref="BladeView"/> 或 WC6 的占位视图）只通过这里的接口改碎片 / 鬼眼 / 光，不直接碰材质。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BladeModel : MonoBehaviour
    {
        public const string PrefabId = "SK_Weapon_DemonBlade";

        public Transform frame;
        public SkinnedMeshRenderer shards;
        public Transform[] bones;
        public MeshRenderer rootSlab, hilt;
        public Transform tip;

        MaterialPropertyBlock shardBlock, rootBlock;
        float awakeShown = -1, glowShown = -1;

        /// <summary>刀身中性朝向：刀身局部 +Y → 模型 −Z、+X（刃口）→ −Y、+Z（厚度）→ +X</summary>
        public static Quaternion NeutralFrame => Quaternion.LookRotation(Vector3.right, Vector3.back);

        /// <summary>第 i 片在刀身局部坐标的原位（片心）</summary>
        public static Vector3 HomeLocal(int i)
        {
            var c = BladeShape.Cells[i];
            return new Vector3((float)c.cx, (float)c.cy, 0);
        }

        /// <summary>第 i 片在不在手里（false = 骨骼缩放 0，不显示）；stretch = 伸刃时沿刀身的拉长倍率（WC7 用，1 = 原位）</summary>
        public void SetShard(int i, bool shown, float stretch = 1f)
        {
            if (bones == null || i < 0 || i >= bones.Length || !bones[i]) return;
            var b = bones[i];
            var home = HomeLocal(i);
            if (!Mathf.Approximately(stretch, 1f)) home.y *= stretch;
            b.localPosition = home;
            b.localRotation = Quaternion.identity;
            b.localScale = shown ? Vector3.one : Vector3.zero;
        }

        /// <summary>
        /// 第 i 片摆到刀身局部坐标 local（片心；WC7 的第一人称用：伸刃时刀根一截不动、其余沿刀线拉开并横向错动），
        /// shown = false 时缩放 0（不在手里）；scale = 显示时的缩放（归位闪放大一下）
        /// </summary>
        public void SetShardLocal(int i, bool shown, Vector3 local, float scale = 1f)
        {
            if (bones == null || i < 0 || i >= bones.Length || !bones[i]) return;
            var b = bones[i];
            b.localPosition = local;
            b.localRotation = Quaternion.identity;
            b.localScale = shown ? Vector3.one * scale : Vector3.zero;
        }

        /// <summary>全部碎片回到刀身原位</summary>
        public void ShowAll()
        {
            if (bones == null) return;
            for (int i = 0; i < bones.Length; i++) SetShard(i, true);
        }

        /// <summary>
        /// 碎片在世界中的位置 / 朝向 / 缩放（片心原位 × 当前 Frame 的世界变换）。返回世界缩放（含 rig 的缩放）
        /// </summary>
        public float HomeWorld(int i, out Vector3 pos, out Quaternion rot)
        {
            var f = frame ? frame : transform;
            // 骨骼位置含伸刃；骨骼本身没有旋转，朝向就是刀身的
            var b = bones != null && i >= 0 && i < bones.Length ? bones[i] : null;
            pos = b ? b.position : f.TransformPoint(HomeLocal(i));
            rot = f.rotation;
            return f.lossyScale.x;
        }

        /// <summary>刀根鬼面附近（魔气飞向这里），世界坐标</summary>
        public Vector3 RootWorld => (frame ? frame : transform).TransformPoint(new Vector3(0.01f, (float)BladeShape.RootBoundaryY(0.5) * 0.4f, 0));

        /// <summary>鬼眼世界坐标</summary>
        public Vector3 EyeWorld => (frame ? frame : transform).TransformPoint(BladeMeshes.EyeLocal);

        /// <summary>鬼眼 0 闭 → 1 睁（刀根贴图在 0.5 处切到睁眼那一格，自发光同时变亮）</summary>
        public void SetAwake(float v)
        {
            v = Mathf.Clamp01(v);
            if (!rootSlab || Mathf.Abs(v - awakeShown) < 0.02f) return;
            awakeShown = v;
            rootBlock ??= new MaterialPropertyBlock();
            rootSlab.GetPropertyBlock(rootBlock);
            rootBlock.SetVector(BladeMeshes.BaseMapStId, new Vector4(1, 1, v >= 0.5f ? BladeMeshes.AwakeOffset : 0, 0));
            float e = 1.2f * (1 + 0.8f * v);
            rootBlock.SetColor(BladeMeshes.EmissionColorId, new Color(e, e, e, 1));
            rootSlab.SetPropertyBlock(rootBlock);
        }

        /// <summary>碎片整体附加亮度（命中、人刀合一）：自发光 × (1 + k)</summary>
        public void SetGlow(float k)
        {
            k = Mathf.Max(0, k);
            if (!shards || Mathf.Abs(k - glowShown) < 0.02f) return;
            glowShown = k;
            shardBlock ??= new MaterialPropertyBlock();
            shards.GetPropertyBlock(shardBlock);
            shardBlock.SetColor(BladeMeshes.EmissionColorId, BladeMeshes.ShardEmission * (1 + k));
            shards.SetPropertyBlock(shardBlock);
        }

        /// <summary>
        /// 组装层级（烘焙器存 Prefab、运行时兜底共用）：parent 下新建根节点，网格 / 材质由调用方给（烘焙资产或运行时现场生成的）。
        /// </summary>
        public static BladeModel Assemble(Transform parent, Mesh shardMesh, Mesh rootMesh, Mesh hiltMesh, Material shardMat, Material hiltMat)
        {
            var go = new GameObject(PrefabId);
            if (parent) go.transform.SetParent(parent, false);
            var model = go.AddComponent<BladeModel>();

            var frame = new GameObject("Frame").transform;
            frame.SetParent(go.transform, false);
            var q = NeutralFrame;
            frame.SetLocalPositionAndRotation(q * new Vector3(0, -BladeMeshes.GripY, 0), q);
            model.frame = frame;

            var boneRoot = new GameObject("Bones").transform;
            boneRoot.SetParent(frame, false);
            model.bones = new Transform[BladeShape.ShardCount];
            for (int i = 0; i < model.bones.Length; i++)
            {
                var b = new GameObject($"S{i:000}").transform;
                b.SetParent(boneRoot, false);
                b.localPosition = HomeLocal(i);
                model.bones[i] = b;
            }

            var shardsGo = new GameObject("Shards");
            shardsGo.transform.SetParent(frame, false);
            var smr = shardsGo.AddComponent<SkinnedMeshRenderer>();
            smr.sharedMesh = shardMesh;
            smr.bones = model.bones;
            smr.rootBone = frame;
            smr.sharedMaterial = shardMat;
            smr.updateWhenOffscreen = false;
            smr.skinnedMotionVectors = false;
            smr.shadowCastingMode = ShadowCastingMode.Off;
            smr.receiveShadows = false;
            // 骨骼会移动（伸刃、飞出前的位移）：包围盒在刀身包围盒外放宽
            if (shardMesh) smr.localBounds = Expand(shardMesh.bounds, 0.25f);
            model.shards = smr;

            model.rootSlab = Part(frame, "Root", rootMesh, hiltMat);
            model.hilt = Part(frame, "Hilt", hiltMesh, hiltMat);

            var tip = new GameObject("Tip").transform;
            tip.SetParent(frame, false);
            tip.localPosition = BladeMeshes.TipLocal;
            model.tip = tip;
            return model;
        }

        static MeshRenderer Part(Transform parent, string name, Mesh mesh, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return r;
        }

        static Bounds Expand(Bounds b, float m)
        {
            b.Expand(m * 2);
            return b;
        }
    }

    /// <summary>
    /// 碎刃的网格与材质来源：优先用烘焙好的 Prefab（GameDatabase 里的 SK_Weapon_DemonBlade：设计图刀柄贴图、资产网格），
    /// 没有时（还没跑 bridge.sh blade + core）运行时用 <see cref="BladeMeshes"/> 现场生成，刀柄贴图退回程序色。结果缓存到进入 Play 时清空。
    /// </summary>
    public static class BladeAssets
    {
        static Mesh shardMesh, rootMesh, hiltMesh;
        static Material shardMat, hiltMat;
        static bool resolved;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            resolved = false;
            shardMesh = rootMesh = hiltMesh = null;
            shardMat = hiltMat = null;
        }

        /// <summary>烘焙好的 Prefab（没有为 null）</summary>
        public static BladeModel BakedPrefab
        {
            get
            {
                var go = GameDatabase.Prefab(BladeModel.PrefabId);
                return go ? go.GetComponent<BladeModel>() : null;
            }
        }

        static void Resolve()
        {
            if (resolved && shardMesh && shardMat) return;
            resolved = true;
            var baked = BakedPrefab;
            if (baked && baked.shards && baked.shards.sharedMesh && baked.shards.sharedMaterial)
            {
                shardMesh = baked.shards.sharedMesh;
                shardMat = baked.shards.sharedMaterial;
                rootMesh = baked.rootSlab ? baked.rootSlab.GetComponent<MeshFilter>().sharedMesh : null;
                hiltMesh = baked.hilt ? baked.hilt.GetComponent<MeshFilter>().sharedMesh : null;
                hiltMat = baked.hilt ? baked.hilt.sharedMaterial : null;
            }
            shardMesh = shardMesh ? shardMesh : BladeMeshes.BuildShards();
            rootMesh = rootMesh ? rootMesh : BladeMeshes.BuildRoot();
            hiltMesh = hiltMesh ? hiltMesh : BladeMeshes.BuildHilt();
            if (!shardMat)
            {
                BladeMeshes.BuildRamps(out var a, out var e);
                shardMat = NewMaterial("M_DemonBlade_Shard (runtime)", BladeMeshes.Purple);
                if (shardMat.shader.name == BladeMeshes.ShaderName) BladeMeshes.SetupShardMaterial(shardMat, a, e);
            }
            if (!hiltMat)
            {
                BladeMeshes.BuildFallbackHilt(out var a, out var e);
                hiltMat = NewMaterial("M_DemonBlade_Hilt (runtime)", Hex.Rgb(0x2b2d36));
                if (hiltMat.shader.name == BladeMeshes.ShaderName) BladeMeshes.SetupHiltMaterial(hiltMat, a, e);
            }
        }

        /// <summary>风格化 Lit；打包后着色器找不到时退回特效的不透明纯色材质（着色，不会粉）</summary>
        static Material NewMaterial(string name, Color fallbackTint)
        {
            var shader = Shader.Find(BladeMeshes.ShaderName);
            if (shader && shader.isSupported) return new Material(shader) { name = name };
            var m = new Material(FxMaterials.Unlit) { name = name };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", fallbackTint);
            return m;
        }

        public static Mesh ShardMesh
        {
            get
            {
                Resolve();
                return shardMesh;
            }
        }

        public static Material ShardMaterial
        {
            get
            {
                Resolve();
                return shardMat;
            }
        }

        /// <summary>新建一把碎刃模型挂到 parent 下：有烘焙 Prefab 就实例化它，否则现场组装</summary>
        public static BladeModel CreateModel(Transform parent)
        {
            var baked = BakedPrefab;
            if (baked)
            {
                var inst = Object.Instantiate(baked.gameObject, parent, false);
                inst.name = BladeModel.PrefabId;
                return inst.GetComponent<BladeModel>();
            }
            Resolve();
            return BladeModel.Assemble(parent, shardMesh, rootMesh, hiltMesh, shardMat, hiltMat);
        }
    }
}
