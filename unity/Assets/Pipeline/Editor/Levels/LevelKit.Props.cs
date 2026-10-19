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
    }
}
