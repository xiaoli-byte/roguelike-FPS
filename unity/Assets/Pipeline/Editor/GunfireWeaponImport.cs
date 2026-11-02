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
        const string AssetId = "SK_Weapon_Gunfire1001";

        [MenuItem("Spiritfire/Art/Import Gunfire 1001")]
        public static void Run()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var sc = ArtSidecar.Load($"Assets/Art/Weapons/{AssetId}/{AssetId}.art.json");
            if (sc == null) throw new System.InvalidOperationException($"{AssetId}: run unity_export.py first");
            var materials = sc.Materials.OfType<JObject>()
                .Select(m => ArtPrefabBuilder.BuildMaterial(sc, m))
                .ToDictionary(m => m.name, m => m);
            var prefab = ArtPrefabBuilder.BuildPrefab(sc, materials, null);
            if (!prefab) throw new System.InvalidOperationException($"{AssetId}: prefab generation failed");
            AssetDatabase.SaveAssets();
            var result = ArtValidator.Validate(sc);
            foreach (var warning in result.warnings) Debug.LogWarning($"[Gunfire] {AssetId}: {warning}");
            foreach (var error in result.errors) Debug.LogError($"[Gunfire] {AssetId}: {error}");
            CoreSceneBuilder.BuildDatabase();
            AssetDatabase.SaveAssets();
            if (result.errors.Count > 0) throw new System.InvalidOperationException($"{AssetId}: {result.errors.Count} QA errors");
            Debug.Log($"[Gunfire] {AssetId}: imported {result.metrics["lodTris"]} triangles, {result.metrics["sockets"]} sockets");
        }

        public static void Batch()
        {
            Run();
        }
    }
}
