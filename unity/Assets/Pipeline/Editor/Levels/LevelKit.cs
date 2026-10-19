using System.IO;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 关卡构建的通用部件：从地貌函数生成 Unity Terrain（高度 + 分层图），白盒体块，NavMesh 烘焙，
    /// 以及验收检查（主线连通、地标可见、坡度）与审核截图。每张图的具体布局写在各自的 Level_x_y 里。
    /// 按区域拆成 partial，每个文件归一个单元（docs/unity-parity.md 4.9）：本文件是核心（地面采样、存资产、NavMesh）；
    /// .Terrain 地形与分层 · .Backdrop 远景与氛围 · .Scatter 散布 · .Boundary 边界 · .Validate 验收检查与审核截图 ·
    /// .Props 白盒体块、材质与摆放现有资产（共用，只追加）。
    /// </summary>
    public static partial class LevelKit
    {
        public const string ReviewDir = "Assets/Art/_Review";

        public static float GroundY(Terrain t, float x, float z) => t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y;
        public static Vector3 OnGround(Terrain t, float x, float z, float dy = 0) => new(x, GroundY(t, x, z) + dy, z);

        public static void SaveAsset(Object obj, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(obj, path);
        }

        // ───────────── 导航 ─────────────
        public static NavMeshSurface BakeNavMesh(string dir, string name, Transform parent)
        {
            var go = new GameObject("NavMesh");
            go.transform.SetParent(parent, false);
            var nav = go.AddComponent<NavMeshSurface>();
            nav.collectObjects = CollectObjects.All;
            nav.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            nav.layerMask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
            nav.BuildNavMesh();
            if (nav.navMeshData) SaveAsset(nav.navMeshData, $"{dir}/NavMesh_{name}.asset");
            return nav;
        }
    }
}
