using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 读取 art/pipeline/unity_export.py 写出的 &lt;ID&gt;.art.json——管线与 Unity 之间唯一的契约。
    /// Unity 侧所有设置（导入、材质、Prefab、校验）都从这里推导，不在编辑器里手调后反写。
    /// </summary>
    public sealed class ArtSidecar
    {
        public const string ArtRoot = "Assets/Art";
        public const string Suffix = ".art.json";

        public readonly string jsonPath;
        public readonly JObject raw;

        ArtSidecar(string path, JObject json)
        {
            jsonPath = path.Replace('\\', '/');
            raw = json;
        }

        public string Id => (string)raw["id"];
        public string Kind => (string)raw["kind"];
        public string Class => (string)raw["class"];
        public string Category => (string)raw["category"];
        public string Dir => Path.GetDirectoryName(jsonPath)!.Replace('\\', '/');
        public string FbxPath => $"{Dir}/{Id}.fbx";
        public string RigType => (string)raw["rig"]?["type"] ?? "none";
        public string NativeAnimPath => $"{Dir}/Anim/{Id}.native-anim.json";
        /// <summary>有从 Three.js 版采样的专属动作（scripts/unity/bake-native-anims.mjs）</summary>
        public bool HasNativeAnim => File.Exists(NativeAnimPath);
        /// <summary>
        /// 实际导入用的骨骼类型：有采样动作的敌人用 Generic——逐骨骼精确还原，不经过人形肌肉空间的关节限制
        /// （邪飞天的三道弯、手指轮指在 Humanoid 下会被压平）；英雄保留 Humanoid，之后还要套 Mixamo。
        /// </summary>
        public string EffectiveRigType => RigType == "humanoid" && HasNativeAnim && BindSource != "hero" ? "generic" : RigType;
        public bool IsHumanoid => EffectiveRigType == "humanoid";
        public bool IsCharacter => Category == "characters";
        public bool IsStaticScenery => Category is "props" or "environment";
        public JArray Meshes => (JArray)raw["meshes"] ?? new JArray();
        /// <summary>毛发 / 羽毛配置（registry.toml 的 [assets.&lt;ID&gt;.fur]）；没有时为 null，见 <see cref="FurSettings"/></summary>
        public JObject Fur => raw["fur"] as JObject;
        public JArray Materials => (JArray)raw["materials"] ?? new JArray();
        /// <summary>第一人称武器的语义零件与挂点（unity_export.weapon_parts 写：id / parts / bindPose / sockets）；不是武器为 null</summary>
        public JObject Weapon => raw["weapon"] as JObject;

        public float[] LodDistance => raw["lodDistance"]?.ToObject<float[]>() ?? new[] { 0f };

        public string BindSource => (string)raw["bind"]?["source"];
        public string BindId => (string)raw["bind"]?["id"];
        public string BindAttachment => (string)raw["bind"]?["attachment"];

        /// <summary>设计包围盒（Unity 坐标，脚底为原点）；没有时为 null。</summary>
        public Bounds? DesignBounds
        {
            get
            {
                var b = raw["bounds"];
                if (b == null || !b.HasValues) return null;
                var lo = b["min"]!.ToObject<float[]>();
                var hi = b["max"]!.ToObject<float[]>();
                var min = new Vector3(lo[0], lo[1], lo[2]);
                var max = new Vector3(hi[0], hi[1], hi[2]);
                return new Bounds((min + max) * 0.5f, max - min);
            }
        }

        JObject Budget => raw["budget"] as JObject;
        /// <summary>registry.toml 里登记的 QA 豁免理由；没有豁免时为 null。检查项名与 assetctl validate 一致（如「场景脚底落地」）。</summary>
        public string Waiver(string check) => (raw["qaWaivers"] as JObject)?[check]?.ToString();

        public int BudgetTexture => (int?)Budget?["texture"] ?? 2048;

        /// <summary>Unity 人形骨骼名（HumanTrait.BoneName 写法）→ 资产骨骼名。</summary>
        public Dictionary<string, string> HumanMap =>
            raw["rig"]?["human"] is JObject o
                ? o.Properties().ToDictionary(p => p.Name, p => (string)p.Value)
                : new Dictionary<string, string>();

        public JObject MeshInfo(string objectName) =>
            Meshes.OfType<JObject>().FirstOrDefault(m => (string)m["name"] == objectName);

        public string MaterialAssetPath(string materialName) => $"{Dir}/{materialName}.mat";

        public string PrefabPath
        {
            get
            {
                string cat = Path.GetFileName(Path.GetDirectoryName(Dir));
                return $"{ArtRoot}/Prefabs/{cat}/{Id}.prefab";
            }
        }

        public static ArtSidecar Load(string jsonPath)
        {
            if (!File.Exists(jsonPath)) return null;
            return new ArtSidecar(jsonPath, JObject.Parse(File.ReadAllText(jsonPath)));
        }

        /// <summary>模型文件 Assets/Art/&lt;类别&gt;/&lt;ID&gt;/&lt;ID&gt;.fbx 对应的 sidecar。</summary>
        public static ArtSidecar ForModel(string fbxPath)
        {
            string dir = Path.GetDirectoryName(fbxPath)!;
            string id = Path.GetFileNameWithoutExtension(fbxPath);
            return Load(Path.Combine(dir, id + Suffix));
        }

        public static List<ArtSidecar> All()
        {
            if (!Directory.Exists(ArtRoot)) return new List<ArtSidecar>();
            return Directory.GetFiles(ArtRoot, "*" + Suffix, SearchOption.AllDirectories)
                .OrderBy(p => p)
                .Select(Load)
                .Where(s => s != null)
                .ToList();
        }
    }
}
