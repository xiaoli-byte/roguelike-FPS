using System.IO;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 地表（L8）：冰面 / 水面 / 流沙的材质资产与摆放。各地图（2-1 冰河、2-3 冰湖、1-2 流沙）与测试场都走这里。
    public static partial class LevelKit
    {
        /// <summary>世界表面材质的目录（Resources：运行时生成的冰斑 / 水面 / 流沙按名字取，着色器随材质进包）</summary>
        public const string WorldMaterialDir = "Assets/Game/Resources/" + WorldMaterials.ResourcesDir;

        /// <summary>
        /// 生成 / 更新 Resources/World/M_World_{Ice,Water,Quicksand}.mat（参数见 <see cref="WorldMaterials.Configure"/>）。
        /// 已有资产原地改参数（不删重建：GUID 不变，场景里的引用不断）。
        /// </summary>
        public static void EnsureWorldMaterials()
        {
            Directory.CreateDirectory(WorldMaterialDir);
            foreach (WorldMaterialKind k in System.Enum.GetValues(typeof(WorldMaterialKind)))
            {
                string path = $"{WorldMaterialDir}/{WorldMaterials.AssetName(k)}.mat";
                var shader = Shader.Find(WorldMaterials.ShaderName(k));
                if (!shader)
                {
                    Debug.LogError($"[Level] 找不到着色器 {WorldMaterials.ShaderName(k)}（Assets/Art/Shaders/SF_Ice / SF_Water.shader）");
                    continue;
                }
                var m = AssetDatabase.LoadAssetAtPath<Material>(path);
                bool create = !m;
                if (create) m = new Material(shader) { name = WorldMaterials.AssetName(k) };
                else if (m.shader != shader) m.shader = shader;
                WorldMaterials.Configure(k, m);
                if (create) AssetDatabase.CreateAsset(m, path);
                else EditorUtility.SetDirty(m);
            }
            AssetDatabase.SaveAssets();
        }

        /// <summary>
        /// 把一块白盒（缩放过的方块，顶面是冰面）变成冰面：挂 <see cref="SurfaceZone"/>（形状 = 它自己的单位立方体）、换冰材质，碰撞照旧（人站在上面）
        /// </summary>
        public static SurfaceZone IceSurface(GameObject block, SurfaceProfile? profile = null)
        {
            EnsureWorldMaterials();
            var z = block.GetComponent<SurfaceZone>();
            if (!z) z = block.AddComponent<SurfaceZone>();
            z.profile = profile ?? SurfaceProfile.Ice;
            z.area = ZoneArea.Box();
            z.lifetime = 0;
            var r = block.GetComponent<MeshRenderer>();
            if (r)
            {
                r.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>($"{WorldMaterialDir}/{WorldMaterials.AssetName(WorldMaterialKind.Ice)}.mat");
                r.shadowCastingMode = ShadowCastingMode.Off;
            }
            return z;
        }

        /// <summary>
        /// 把一块白盒变成水：去掉碰撞（人走进水里），顶面抬到地面上 depth 米（水体 = 地面到水面的方块），挂 <see cref="WaterVolume"/>、换水材质。
        /// ground = 水底的世界 y
        /// </summary>
        public static WaterVolume WaterBody(GameObject block, float ground, float depth)
        {
            EnsureWorldMaterials();
            var t = block.transform;
            var c = block.GetComponent<Collider>();
            if (c) Object.DestroyImmediate(c);
            var s = t.localScale;
            t.localScale = new Vector3(s.x, depth, s.z);
            t.position = new Vector3(t.position.x, ground + depth * 0.5f, t.position.z);
            var w = block.GetComponent<WaterVolume>();
            if (!w) w = block.AddComponent<WaterVolume>();
            var r = block.GetComponent<MeshRenderer>();
            if (r)
            {
                r.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>($"{WorldMaterialDir}/{WorldMaterials.AssetName(WorldMaterialKind.Water)}.mat");
                r.shadowCastingMode = ShadowCastingMode.Off;
            }
            block.isStatic = false; // 不进静态合批：水面着色器按世界坐标动，合批也没好处，还会挡住 MaterialPropertyBlock
            return w;
        }

        /// <summary>一片流沙（圆心在地面 ground，半径 radius）：地形下陷由关卡的地貌函数给，这里只放组件（运行时自己铺流沙面）</summary>
        public static Quicksand QuicksandPit(Transform parent, Vector3 ground, float radius, float coreRadius = -1)
        {
            EnsureWorldMaterials();
            var go = new GameObject("Quicksand");
            go.transform.SetParent(parent, false);
            go.transform.position = ground;
            var q = go.AddComponent<Quicksand>();
            q.radius = radius;
            q.coreRadius = coreRadius > 0 ? coreRadius : Mathf.Min(2.2f, radius * 0.4f);
            return q;
        }

        /// <summary>测试场：冰面条带挂牵引区、水面条带变成 0.7 m 深的水（标签和 ArenaSpawner 的引用不变）</summary>
        public static void SurfaceStrips(Transform ice, Transform water, float waterDepth = 0.7f)
        {
            if (ice) IceSurface(ice.gameObject);
            if (water) WaterBody(water.gameObject, 0, waterDepth);
        }
    }
}
