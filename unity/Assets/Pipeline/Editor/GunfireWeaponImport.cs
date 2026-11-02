using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Spiritfire.Art.Editor.Levels;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    public static class GunfireWeaponImport
    {
        static readonly string[] AssetIds = { "SK_Weapon_Gunfire1001", "SK_Weapon_Gunfire1002", "SK_Weapon_Gunfire1202", "SK_Weapon_Gunfire1008", "SK_Weapon_Gunfire1106", "SK_Weapon_Gunfire1301" };

        [MenuItem("Spiritfire/Art/Import Gunfire Weapons")]
        public static void Run()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            int failures = 0;
            foreach (var id in AssetIds)
            {
                var sc = ArtSidecar.Load($"Assets/Art/Weapons/{id}/{id}.art.json");
                if (sc == null) throw new System.InvalidOperationException($"{id}: run unity_export.py first");
                var materials = sc.Materials.OfType<JObject>()
                    .Select(m => ArtPrefabBuilder.BuildMaterial(sc, m))
                    .ToDictionary(m => m.name, m => m);
                var prefab = ArtPrefabBuilder.BuildPrefab(sc, materials, null);
                if (!prefab) throw new System.InvalidOperationException($"{id}: prefab generation failed");
                AssetDatabase.SaveAssets();
                var result = ArtValidator.Validate(sc);
                foreach (var warning in result.warnings) Debug.LogWarning($"[Gunfire] {id}: {warning}");
                foreach (var error in result.errors) Debug.LogError($"[Gunfire] {id}: {error}");
                failures += result.errors.Count;
                var tris = string.Join("/", (int[])result.metrics["lodTris"]);
                Debug.Log($"[Gunfire] {id}: imported {tris} triangles, {result.metrics["sockets"]} sockets");
            }
            CoreSceneBuilder.BuildDatabase();
            AssetDatabase.SaveAssets();
            if (failures > 0) throw new System.InvalidOperationException($"Gunfire weapons: {failures} QA errors");
        }

        public static void Batch()
        {
            Run();
        }
    }
}
