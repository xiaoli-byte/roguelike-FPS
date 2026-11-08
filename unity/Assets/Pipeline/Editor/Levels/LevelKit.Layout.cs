using Spiritfire.Game;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 图内布局变体（docs/level-design/run-variety.md §2）的构建部件：每种走法的出生标记、出口祭坛 + 传送门、挂 <see cref="LevelLayout"/> 表。
    /// 变体专属的祭坛在 NavMesh 烘焙之后再摆（<see cref="VariantExit"/>）：主走法里它是停用的，不该在导航网格上挖洞；
    /// 用上它的那一局由 <see cref="NavMeshObstacle"/>（carve）在运行时挖。
    /// </summary>
    public static partial class LevelKit
    {
        /// <summary>一种走法的出生标记（地面上方 5 cm，水平朝向 lookAt）</summary>
        public static PlayerSpawn SpawnMarker(string name, Transform parent, Terrain t, Vector2 at, Vector2 lookAt) =>
            SpawnMarker(name, parent, OnGround(t, at.x, at.y, 0.05f), new Vector3(lookAt.x, 0, lookAt.y));

        /// <summary>一种走法的出生标记：脚底 at（世界），水平朝向 lookAt（世界，只取 XZ）</summary>
        public static PlayerSpawn SpawnMarker(string name, Transform parent, Vector3 at, Vector3 lookAt)
        {
            var spawn = new GameObject(name).AddComponent<PlayerSpawn>();
            spawn.transform.SetParent(parent, false);
            var d = lookAt - at;
            d.y = 0;
            spawn.transform.SetPositionAndRotation(at, Quaternion.LookRotation(d.sqrMagnitude > 1e-4f ? d : Vector3.forward));
            return spawn;
        }

        /// <summary>
        /// 出口祭坛正面的传送门（同各关原来的写法：门洞在祭坛中心沿正面 doorOffset 米处，门面朝祭坛）。
        /// shrine 缺资产（占位白盒）时传送门自己立石门框
        /// </summary>
        public static ExitPortal PortalAt(string name, Transform parent, Terrain t, GameObject shrine, LevelObjective objective, float doorOffset = 1.2f) =>
            PortalAt(name, parent, (x, z) => OnGround(t, x, z), shrine, objective, doorOffset);

        /// <summary>同上，地面高度由 <paramref name="ground"/>（世界 x, z → 地面点）给（多块地形的关卡用 TerrainSet.OnGround）</summary>
        public static ExitPortal PortalAt(string name, Transform parent, System.Func<float, float, Vector3> ground, GameObject shrine, LevelObjective objective,
            float doorOffset = 1.2f)
        {
            var portal = new GameObject(name).AddComponent<ExitPortal>();
            portal.transform.SetParent(parent, false);
            var face = shrine.transform.forward;
            face.y = 0;
            face.Normalize();
            var c = shrine.transform.position;
            portal.transform.SetPositionAndRotation(ground(c.x + face.x * doorOffset, c.z + face.z * doorOffset), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || shrine.name.StartsWith("Placeholder");
            return portal;
        }

        /// <summary>
        /// 变体专属的出口：摆出口祭坛（NavMesh 烘焙之后调）+ 运行时挖导航洞的 <see cref="NavMeshObstacle"/> + 传送门。
        /// 返回祭坛和传送门，都要放进那个变体的 <see cref="LevelLayout.Variant.only"/> / <see cref="LevelLayout.Variant.exit"/>
        /// </summary>
        public static (GameObject shrine, ExitPortal portal) VariantExit(string shrineId, Transform props, Transform markers, Terrain t, Vector2 at, float yaw,
            Vector3 box, LevelObjective objective, string name, float doorOffset = 1.2f)
        {
            var shrine = PlaceOrBox(shrineId, props, t, at.x, at.y, yaw, box);
            shrine.name = shrine.name.StartsWith("Placeholder") ? shrine.name : $"{name} Shrine";
            CarveObstacle(shrine);
            var portal = PortalAt($"{name} Portal", markers, t, shrine, objective, doorOffset);
            return (shrine, portal);
        }

        /// <summary>
        /// 给 NavMesh 烘焙之后才摆的物体（变体专属的祭坛）挂运行时挖洞的 <see cref="NavMeshObstacle"/>：底座占地 × 0.9，高 2 m
        /// </summary>
        public static NavMeshObstacle CarveObstacle(GameObject shrine)
        {
            // 祭坛底座占地（局部坐标）：先转正量包围盒再转回去；高度取 2 m 够挡住寻路
            var rot = shrine.transform.rotation;
            shrine.transform.rotation = Quaternion.identity;
            var bounds = new Bounds(shrine.transform.position, Vector3.zero);
            foreach (var r in shrine.GetComponentsInChildren<Renderer>()) bounds.Encapsulate(r.bounds);
            shrine.transform.rotation = rot;
            var scale = shrine.transform.lossyScale;
            var obstacle = shrine.AddComponent<NavMeshObstacle>();
            obstacle.shape = NavMeshObstacleShape.Box;
            obstacle.carving = true;
            obstacle.carveOnlyStationary = true;
            var c = bounds.center - shrine.transform.position;
            obstacle.size = new Vector3(bounds.size.x * 0.9f / Mathf.Max(1e-3f, scale.x), 2f / Mathf.Max(1e-3f, scale.y), bounds.size.z * 0.9f / Mathf.Max(1e-3f, scale.z));
            obstacle.center = new Vector3(c.x / Mathf.Max(1e-3f, scale.x), 1f / Mathf.Max(1e-3f, scale.y), c.z / Mathf.Max(1e-3f, scale.z));
            return obstacle;
        }

        /// <summary>挂布局表（第一个变体 = 主走法）</summary>
        public static LevelLayout Layout(Transform parent, params LevelLayout.Variant[] variants)
        {
            var layout = new GameObject("Level Layout").AddComponent<LevelLayout>();
            layout.transform.SetParent(parent, false);
            layout.variants = variants;
            return layout;
        }

        /// <summary>改写场地先后的一条</summary>
        public static LevelLayout.SiteRequires Requires(EncounterSite site, params EncounterSite[] requires) =>
            new() { site = site, requires = requires ?? System.Array.Empty<EncounterSite>() };

        /// <summary>换场地编制 / 奖励的一条（spec / reward 为 null = 不换这一项）</summary>
        public static LevelLayout.SiteOverride Override(EncounterSite site, EncounterSpec spec = null, string reward = null) =>
            new()
            {
                site = site, replaceSpec = spec != null, spec = spec ?? new EncounterSpec(),
                replaceReward = reward != null, reward = reward ?? "",
            };
    }
}
