using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 壳层毛发（画质「高」）：给 LOD0 的蒙皮渲染器追加 N 个壳层材质槽。网格只有一个子网格时，多出来的材质槽会把同一个
    /// （已蒙皮的）网格再画一遍，Spiritfire/FurShell 按 _ShellIndex 把它沿法线推出去、按发丝图案裁掉，叠成一层层毛 / 羽。
    /// 所以骨骼动画、受击闪白（渲染器上的 MaterialPropertyBlock）、LOD 交叉淡入淡出都自动跟着，远处切到 LOD1 就没有壳层。
    /// 壳层材质按（模板，层数）缓存共用：同一种怪 / 灵宠的所有实例共用同一组材质，SRP Batcher 照常合批。
    /// 由 ArtPrefabBuilder 按 sidecar 的 fur 配置挂到 Prefab 根节点上；画质改变（<see cref="ArtQuality.Changed"/>）时重新套用。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FurShells : MonoBehaviour
    {
        static readonly int ShellIndexId = Shader.PropertyToID("_ShellIndex");
        static readonly int ShellCountId = Shader.PropertyToID("_ShellCount");
        static readonly Dictionary<(Material, int), Material[]> Cache = new();

        [Tooltip("LOD0 的蒙皮渲染器")] public Renderer target;
        [Tooltip("壳层材质模板（Spiritfire/FurShell），每层复制一份、只改 _ShellIndex")] public Material shellTemplate;
        [Tooltip("画质「高」时的层数（0 = 只要轮廓发丝面片，不叠壳层）")] [Range(0, 16)] public int shellsHigh = 16;
        [Tooltip("fur / feather，只用于显示")] public string kind = "fur";
        [Tooltip("轮廓发丝面片（<ID>_FurFins，画质「中」以上打开）")] public Renderer finRenderer;

        Material[] baseMaterials;
        int applied = -1;

        public int ActiveShells => applied < 0 ? 0 : applied;

        void Awake() => CaptureBase();

        void OnEnable()
        {
            ArtQuality.Changed += OnQuality;
            Apply();
        }

        void OnDisable()
        {
            ArtQuality.Changed -= OnQuality;
            Apply(0);
            if (finRenderer) finRenderer.enabled = false;
        }

        void OnQuality(ArtQualityLevel _) => Apply();

        void CaptureBase()
        {
            if (baseMaterials != null || !target) return;
            var list = new List<Material>();
            foreach (var m in target.sharedMaterials)
                if (m && (!shellTemplate || m.shader != shellTemplate.shader)) list.Add(m);
            baseMaterials = list.ToArray();
        }

        /// <summary>按当前画质套用壳层与轮廓发丝面片</summary>
        public void Apply()
        {
            Apply(ArtQuality.FurShells(shellsHigh));
            if (finRenderer) finRenderer.enabled = ArtQuality.FurFins;
        }

        /// <summary>按指定画质档套用（截图 / 对比工具在编辑器里直接调用，不改全局画质）</summary>
        public void ApplyTier(ArtQualityLevel tier)
        {
            Apply(tier == ArtQualityLevel.High ? shellsHigh : 0);
            if (finRenderer) finRenderer.enabled = tier >= ArtQualityLevel.Medium;
        }

        /// <summary>强制指定层数（0 = 关）：截图 / 对比工具在编辑器里直接调用</summary>
        public void Apply(int shells)
        {
            CaptureBase();
            if (!target || baseMaterials == null || !shellTemplate) return;
            if (shells == applied) return;
            applied = shells;
            if (shells <= 0)
            {
                target.sharedMaterials = baseMaterials;
                return;
            }
            var mats = new Material[baseMaterials.Length + shells];
            baseMaterials.CopyTo(mats, 0);
            Shells(shellTemplate, shells).CopyTo(mats, baseMaterials.Length);
            target.sharedMaterials = mats;
        }

        static Material[] Shells(Material template, int count)
        {
            if (Cache.TryGetValue((template, count), out var shells) && shells[0]) return shells;
            shells = new Material[count];
            for (int i = 0; i < count; i++)
            {
                var m = new Material(template) { name = $"{template.name}_{i:00}of{count}", hideFlags = HideFlags.DontSave };
                m.SetFloat(ShellIndexId, i);
                m.SetFloat(ShellCountId, count);
                // 由外向内画：外层发丝先写深度，被它挡住的内层片元在深度测试就被丢掉
                m.renderQueue = template.renderQueue + (count - 1 - i);
                shells[i] = m;
            }
            Cache[(template, count)] = shells;
            return shells;
        }
    }
}
