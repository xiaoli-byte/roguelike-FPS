using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 摆放：白盒材质与体块（方块、圆柱）、把现有资产摆到地面上。共用，各单元只追加。
    public static partial class LevelKit
    {
        static readonly Dictionary<string, Material> mats = new();

        public static Material Mat(string dir, string name, Color c, float roughness = 0.92f)
        {
            string path = $"{dir}/M_WB_{name}.mat";
            if (mats.TryGetValue(path, out var cached) && cached) return cached;
            var m = new Material(Shader.Find("Spiritfire/StylizedLit")) { name = $"M_WB_{name}" };
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Metallic", 0);
            m.SetFloat("_Roughness", roughness);
            m.SetFloat("_RimStrength", 0.15f);
            SaveAsset(m, path);
            mats[path] = m;
            return m;
        }

        public static void ResetCache() => mats.Clear();

        /// <summary>白盒方块：center = 底面中心（世界坐标），沿 yaw 旋转；sink = 往地下多埋的深度（坡地上不露缝）</summary>
        public static GameObject Box(string name, Transform parent, Vector3 baseCenter, Vector3 size, float yaw, Material m, float sink = 0.4f)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(baseCenter + Vector3.up * (size.y * 0.5f - sink), Quaternion.Euler(0, yaw, 0));
            go.transform.localScale = new Vector3(size.x, size.y + sink, size.z);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            go.isStatic = true;
            return go;
        }

        public static GameObject Cylinder(string name, Transform parent, Vector3 center, float radius, float length, Quaternion rot, Material m)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(center, rot);
            go.transform.localScale = new Vector3(radius * 2, length * 0.5f, radius * 2);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.AddComponent<CapsuleCollider>();
            go.isStatic = true;
            return go;
        }

        /// <summary>摆现有资产到地面上：按设计包围盒缩放到目标高度（targetHeight ≤ 0 时不缩放）</summary>
        public static GameObject Prop(string id, Transform parent, Terrain t, float x, float z, float yaw, float targetHeight = 0, float sink = 0.15f)
        {
            float scale = 1;
            if (targetHeight > 0)
            {
                var b = ShowcaseSceneBuilder.DesignBounds(id);
                scale = targetHeight / Mathf.Max(0.1f, b.size.y);
            }
            var go = ShowcaseSceneBuilder.Place(id, parent, OnGround(t, x, z, -sink), yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        // ───────────── 占位（L5，docs/unity-parity.md 4.11）─────────────
        /// <summary>占位件的标签：验收规则集（PlaceholderCheck）按它列清单</summary>
        public const string PlaceholderTag = "Placeholder";
        /// <summary>占位白盒的共用材质目录</summary>
        public const string PlaceholderDir = "Assets/Levels/_Shared";

        /// <summary>
        /// 按 id 摆 Prefab；还没有这个 Prefab 时放一个 size 大小的白盒（名字「Placeholder · id」，打 Placeholder 标签），
        /// 验收报告会列出全部占位件，正式图不允许有。baseCenter = 底面中心（世界坐标）；scale 只作用于 Prefab。
        /// 换正式资产只需要导出 Prefab 后重新生成关卡，不改代码。
        /// </summary>
        public static GameObject PlaceOrBox(string prefabId, Transform parent, Vector3 baseCenter, Vector3 size, float yaw = 0, float scale = 1, Material boxMat = null)
        {
            if (ShowcaseSceneBuilder.Prefab(prefabId))
            {
                var go = ShowcaseSceneBuilder.Place(prefabId, parent, baseCenter, yaw, scale);
                if (go) go.isStatic = true;
                return go;
            }
            EnsureTag(PlaceholderTag);
            var box = Box($"Placeholder · {prefabId}", parent, baseCenter, size, yaw,
                boxMat ? boxMat : Mat(PlaceholderDir, "Placeholder", new Color(0.93f, 0.93f, 0.9f)), 0.1f);
            box.tag = PlaceholderTag;
            Debug.LogWarning($"[Level] 缺少 Prefab {prefabId}，放了占位白盒 {size.x:F1} × {size.y:F1} × {size.z:F1} m @ {baseCenter}");
            return box;
        }

        /// <summary>
        /// 贴地版：摆到地形 (x, z) 上，Prefab 按设计包围盒缩放到 targetHeight（≤ 0 不缩放，同 <see cref="Prop"/>）；
        /// 没有 Prefab 时白盒用 size（targetHeight &gt; 0 时高度取 targetHeight）。
        /// </summary>
        public static GameObject PlaceOrBox(string prefabId, Transform parent, Terrain t, float x, float z, float yaw, Vector3 size, float targetHeight = 0, float sink = 0.15f)
        {
            if (ShowcaseSceneBuilder.Prefab(prefabId)) return Prop(prefabId, parent, t, x, z, yaw, targetHeight, sink);
            if (targetHeight > 0) size.y = targetHeight;
            return PlaceOrBox(prefabId, parent, OnGround(t, x, z), size, yaw);
        }

        /// <summary>TagManager 里没有就加一个标签（改的是 ProjectSettings/TagManager.asset，生成后要一起提交）</summary>
        public static void EnsureTag(string tag)
        {
            if (System.Array.IndexOf(UnityEditorInternal.InternalEditorUtility.tags, tag) < 0) UnityEditorInternal.InternalEditorUtility.AddTag(tag);
        }
    }
}
