using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>分区遮罩的附带信息（RegionMaskPostprocessor 写的 &lt;贴图名&gt;_RM.json）：面具中心（模型空间）</summary>
    [Serializable]
    public sealed class RegionMaskInfo
    {
        public Vector3 center;
        public int verts;
    }

    /// <summary>
    /// 分区着色（FX4，docs/unity-parity.md：火鼍岩甲、傩面）：导入后处理烘好的分区遮罩（Resources/Fx/RegionMasks/&lt;贴图名&gt;_RM.png，
    /// 见 Pipeline/Editor/RegionMaskPostprocessor.cs）挂到身体渲染器上，每帧把各区的状态写进 SF_StylizedLit 的分区段（MaterialPropertyBlock）。
    ///   岩甲（<see cref="Plates"/>）：8 块甲的热度（1 = 刚碎的熔肉黄白、0.5 = 回熔时暗红的新壳、0 = 完好的玄武岩），左右两列按身体右方分开；
    ///   傩面（<see cref="Face"/>）：换脸配色（红漆 / 描金换成的颜色、换色量）、面具眼睛的光、碎面数（裂纹一张比一张多）——裂纹中心跟着 mask 骨走。
    /// 没有遮罩贴图（还没烘）时什么都不做。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RegionMask : MonoBehaviour
    {
        public const string ResourcesDir = "Fx/RegionMasks";

        static readonly int MaskId = Shader.PropertyToID("_RegionMask");
        static readonly int ParamsId = Shader.PropertyToID("_RegionParams");
        static readonly int AId = Shader.PropertyToID("_RegionA");
        static readonly int BId = Shader.PropertyToID("_RegionB");
        static readonly int CId = Shader.PropertyToID("_RegionC");
        static readonly int CenterId = Shader.PropertyToID("_RegionCenter");
        static readonly int AxisXId = Shader.PropertyToID("_RegionAxisX");
        static readonly int AxisYId = Shader.PropertyToID("_RegionAxisY");
        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");

        public enum Mode
        {
            Off = 0,
            Plates = 1,
            Face = 2,
        }

        readonly List<Renderer> renderers = new();
        MaterialPropertyBlock block;
        Texture2D mask;
        Mode mode;
        string texture;
        Transform modelRoot, faceBone;
        Vector3 faceLocal, faceAxisX, faceAxisY;

        // 状态
        readonly float[] plateHeat = new float[8];
        Vector4 a, b, c;
        float swap, eyeGlow;
        int cracks;

        /// <summary>挂上了遮罩、认出了几个渲染器（测试用）</summary>
        public int Renderers => mask ? renderers.Count : 0;
        public Mode Current => mode;

        /// <summary>火鼍岩甲：texture = 身体贴图名（BC 去掉 _BC），如 "T_Enemy_Tuo"</summary>
        public static RegionMask Plates(Component host, string texture) => Attach(host, texture, Mode.Plates);

        /// <summary>傩面：texture = 身体贴图名，bone = 面具骨骼名（"mask"）</summary>
        public static RegionMask Face(Component host, string texture, string bone = "mask")
        {
            var r = Attach(host, texture, Mode.Face);
            if (r) r.BindFace(bone);
            return r;
        }

        static RegionMask Attach(Component host, string texture, Mode mode)
        {
            if (!host) return null;
            var r = host.GetComponent<RegionMask>() ?? host.gameObject.AddComponent<RegionMask>();
            r.mode = mode;
            r.texture = texture;
            r.mask = Resources.Load<Texture2D>($"{ResourcesDir}/{texture}_RM");
            if (!r.mask) Debug.LogWarning($"[Fx] 没有分区遮罩 {ResourcesDir}/{texture}_RM（打开编辑器让 RegionMaskPostprocessor 烘一次，或菜单 Spiritfire/Fx/Bake Region Masks）");
            r.Scan();
            return r;
        }

        void Awake() => block ??= new MaterialPropertyBlock();

        void Scan()
        {
            block ??= new MaterialPropertyBlock();
            renderers.Clear();
            modelRoot = null;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer || r.name.Contains("GlowShell")) continue;
                var m = r.sharedMaterial;
                if (!m || !m.HasProperty(ParamsId) || !m.HasProperty(BaseMapId)) continue;
                var bc = m.GetTexture(BaseMapId);
                if (!bc || !bc.name.StartsWith(texture, StringComparison.Ordinal)) continue;
                renderers.Add(r);
                if (!modelRoot)
                {
                    var anim = r.GetComponentInParent<Animator>();
                    modelRoot = anim ? anim.transform : transform;
                }
            }
            if (!modelRoot) modelRoot = transform;
        }

        /// <summary>在绑定姿势下（Awake / Start，动画还没动）记下面具中心在 mask 骨上的局部位置和面具平面的两根轴</summary>
        void BindFace(string bone)
        {
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == bone)
                {
                    faceBone = t;
                    break;
                }
            var info = Resources.Load<TextAsset>($"{ResourcesDir}/{texture}_RM");
            var center = Vector3.zero;
            if (info)
            {
                try
                {
                    center = JsonUtility.FromJson<RegionMaskInfo>(info.text).center;
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            var anchor = faceBone ? faceBone : modelRoot;
            faceLocal = anchor.InverseTransformPoint(modelRoot.TransformPoint(center));
            faceAxisX = anchor.InverseTransformDirection(modelRoot.right);
            faceAxisY = anchor.InverseTransformDirection(modelRoot.up);
        }

        /// <summary>某块岩甲的热度（0 完好 / 0.5 暗红新壳 / 1 熔肉）；i = TuoAI 的甲序（偶数左列、奇数右列，前 → 后四排）</summary>
        public void SetPlate(int i, float heat)
        {
            if (i >= 0 && i < plateHeat.Length) plateHeat[i] = Mathf.Clamp01(heat);
        }

        public float PlateHeat(int i) => i >= 0 && i < plateHeat.Length ? plateHeat[i] : 0;

        /// <summary>
        /// 当前这张脸：paint / trim = 红漆、描金换成的颜色（线性；null = 原贴图，不换色）；eye = 面具眼睛的光（sRGB 色）；eyeGlow = 亮度；cracks = 碎过几张脸
        /// </summary>
        public void SetFace(Color? paint, Color? trim, Color eye, float eyeGlow, int cracks)
        {
            swap = paint.HasValue ? 1 : 0;
            var p = paint ?? Color.white;
            var t = trim ?? Color.white;
            a = new Vector4(p.r, p.g, p.b, 1);
            b = new Vector4(t.r, t.g, t.b, 1);
            var e = eye.linear;
            c = new Vector4(e.r, e.g, e.b, 1);
            this.eyeGlow = Mathf.Max(0, eyeGlow);
            this.cracks = Mathf.Max(0, cracks);
        }

        void LateUpdate()
        {
            if (!mask || mode == Mode.Off) return;
            Vector4 center, ax, ay = Vector4.zero, prm;
            if (mode == Mode.Plates)
            {
                a = new Vector4(plateHeat[0], plateHeat[2], plateHeat[4], plateHeat[6]);
                b = new Vector4(plateHeat[1], plateHeat[3], plateHeat[5], plateHeat[7]);
                var p = modelRoot.position;
                center = new Vector4(p.x, p.y, p.z, 1);
                var r = modelRoot.right;
                ax = new Vector4(r.x, r.y, r.z, 0);
                prm = new Vector4(1, 0, 0, 0);
            }
            else
            {
                var anchor = faceBone ? faceBone : modelRoot;
                var p = anchor.TransformPoint(faceLocal);
                float s = Mathf.Max(1e-3f, Mathf.Abs(modelRoot.lossyScale.x));
                center = new Vector4(p.x, p.y, p.z, s);
                var x = anchor.TransformDirection(faceAxisX).normalized;
                var y = anchor.TransformDirection(faceAxisY).normalized;
                ax = new Vector4(x.x, x.y, x.z, 0);
                ay = new Vector4(y.x, y.y, y.z, 0);
                prm = new Vector4(2, swap, cracks, eyeGlow);
            }
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetTexture(MaskId, mask);
                block.SetVector(ParamsId, prm);
                block.SetVector(AId, a);
                block.SetVector(BId, b);
                block.SetVector(CId, c);
                block.SetVector(CenterId, center);
                block.SetVector(AxisXId, ax);
                block.SetVector(AxisYId, ay);
                r.SetPropertyBlock(block);
            }
        }
    }
}
