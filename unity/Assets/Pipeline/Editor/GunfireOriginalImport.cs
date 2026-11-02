using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Spiritfire.Art.Editor.Levels;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    public static class GunfireOriginalImport
    {
        const string Root = "Assets/Art/Original/Gunfire";
        static readonly string[] Ids = { "1001", "1002", "1202", "1008", "1106", "1301", "1003", "1004", "1005", "1006", "1009", "1010", "1013", "1014", "1101", "1102" };
        static readonly HashSet<string> ParticleGraph = new() { "2ede01cb45c4c8848ab9ffed09c254e1", "029f197b32f0e1b4a95271fddfe796ed" };
        static readonly HashSet<string> AlphaBlend = new() { "1faad54a41c7c0842b1735c6ba71dbd9" };

        [MenuItem("Spiritfire/Art/Import Native Gunfire Weapons")]
        public static void Run()
        {
            string previousScene = UnityEditor.SceneManagement.EditorSceneManager.GetActiveScene().path;
            UnityEditor.SceneManagement.EditorSceneManager.SaveOpenScenes();
            UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
            try
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                ConfigureTextures();
                ConfigureMaterials();
                Directory.CreateDirectory("Assets/Resources/Gunfire/Weapons");
                Directory.CreateDirectory("Assets/Resources/Gunfire/Effects");
                Directory.CreateDirectory("Assets/Resources/Gunfire/Audio");
                CopyEffect("1926_muzzle");
                foreach (var shot in Directory.GetFiles($"{Root}/res/soundma/wav/wpn/wpn_1202", "*.ogg"))
                {
                    string name = Path.GetFileNameWithoutExtension(shot);
                    AssetDatabase.CopyAsset(shot.Replace('\\', '/'), $"Assets/Resources/Gunfire/Audio/{name}.ogg");
                }
                foreach (string id in Ids) BuildWeapon(id);
                CoreSceneBuilder.BuildDatabase();
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousScene)) UnityEditor.SceneManagement.EditorSceneManager.OpenScene(previousScene);
            }
        }

        static void ConfigureTextures()
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { Root }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (AssetImporter.GetAtPath(path) is not TextureImporter importer) continue;
                string name = Path.GetFileNameWithoutExtension(path);
                var type = name.EndsWith("_n", StringComparison.OrdinalIgnoreCase) ? TextureImporterType.NormalMap : TextureImporterType.Default;
                bool linear = name.EndsWith("_s", StringComparison.OrdinalIgnoreCase);
                if (importer.textureType == type && importer.sRGBTexture != linear && importer.maxTextureSize >= 2048) continue;
                importer.textureType = type;
                if (linear) importer.sRGBTexture = false;
                importer.maxTextureSize = Math.Max(importer.maxTextureSize, 2048);
                importer.SaveAndReimport();
            }
        }

        static void ConfigureMaterials()
        {
            var character = Shader.Find("Spiritfire/Gunfire/Original Character");
            var particle = Shader.Find("Spiritfire/Gunfire/Original Particle");
            if (!character || !particle) throw new InvalidOperationException("Gunfire URP shaders did not compile");
            foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { Root }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (!material) continue;
                string source = File.ReadAllText(path);
                string shaderId = source.Split(new[] { "m_Shader: {fileID: 4800000, guid: " }, StringSplitOptions.None).ElementAtOrDefault(1)?.Substring(0, 32);
                bool isParticle = path.Contains("/arteffects/");
                material.shader = isParticle ? particle : character;
                if (isParticle)
                {
                    material.SetFloat("_UseParticleTexture", ParticleGraph.Contains(shaderId) ? 1 : 0);
                    material.SetFloat("_SrcBlend", AlphaBlend.Contains(shaderId) ? 5 : 1);
                    material.SetFloat("_DstBlend", AlphaBlend.Contains(shaderId) ? 10 : 1);
                    material.SetFloat("_ZZWrite", 0);
                    material.SetFloat("_Cull", 0);
                    material.renderQueue = 3000;
                }
                EditorUtility.SetDirty(material);
            }
        }

        static void CopyEffect(string name)
        {
            string path = $"{Root}/res/effects/prefabs/common/{name}.prefab";
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source);
            instance.name = name;
            StripMissingScripts(instance);
            foreach (var particles in instance.GetComponentsInChildren<ParticleSystem>(true))
            {
                var main = particles.main;
                main.playOnAwake = false;
                main.stopAction = ParticleSystemStopAction.None;
            }
            PrefabUtility.SaveAsPrefabAsset(instance, $"Assets/Resources/Gunfire/Effects/{name}.prefab");
            UnityEngine.Object.DestroyImmediate(instance);
        }

        static void BuildWeapon(string id)
        {
            string path = $"{Root}/res/characters/weapons/{id}/{id}.prefab";
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (!source) throw new InvalidOperationException($"Missing native Gunfire prefab: {path}");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source);
            instance.name = $"SK_Weapon_Gunfire{id}";
            StripMissingScripts(instance);
            foreach (Transform child in instance.transform)
                if (child.name.EndsWith("_Drop", StringComparison.Ordinal) || child.name.EndsWith("_Show", StringComparison.Ordinal))
                    child.gameObject.SetActive(false);
            foreach (var collider in instance.GetComponentsInChildren<Collider>(true)) UnityEngine.Object.DestroyImmediate(collider);
            Directory.CreateDirectory("Assets/Resources/Gunfire/Animations");
            foreach (var animator in instance.GetComponentsInChildren<Animator>(true))
            {
                if (animator.runtimeAnimatorController is not AnimatorOverrideController sourceOverride) continue;
                var overrides = new List<KeyValuePair<AnimationClip, AnimationClip>>();
                sourceOverride.GetOverrides(overrides);
                overrides = overrides.Where(pair => pair.Key && pair.Value).ToList();
                if (overrides.Count == 0) continue;
                var cleaned = new AnimatorOverrideController(sourceOverride.runtimeAnimatorController);
                cleaned.ApplyOverrides(overrides);
                string name = $"{id}_{animator.name}.overrideController";
                AssetDatabase.CreateAsset(cleaned, $"Assets/Resources/Gunfire/Animations/{name}");
                animator.runtimeAnimatorController = cleaned;
            }
            var sockets = instance.AddComponent<WeaponSockets>();
            sockets.weaponId = id;
            sockets.muzzle = WeaponSockets.FindDeep(instance.transform, WeaponSockets.Muzzle);
            var animation = instance.AddComponent<GunfireOriginalAnimation>();
            animation.weaponId = id;
            animation.muzzlePrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Resources/Gunfire/Effects/1926_muzzle.prefab");
            animation.shotClips = id == "1202"
                ? Enumerable.Range(1, 3).Select(i => AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Resources/Gunfire/Audio/weapon_1202_1p_shot{i}.ogg")).Where(a => a).ToArray()
                : Array.Empty<AudioClip>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(instance, $"Assets/Resources/Gunfire/Weapons/{id}.prefab");
            int animators = prefab.GetComponentsInChildren<Animator>(true).Count(a => a.runtimeAnimatorController && a.avatar);
            int renderers = prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Count(r => r.sharedMesh && r.sharedMaterials.Length > 0);
            int clips = prefab.GetComponentsInChildren<Animator>(true).Sum(a => a.runtimeAnimatorController ? a.runtimeAnimatorController.animationClips.Length : 0);
            Debug.Log($"[Gunfire] Native {id}: {animators} animators, {clips} clips, {renderers} skinned meshes, muzzle={(bool)sockets.muzzle}");
            UnityEngine.Object.DestroyImmediate(instance);
        }

        static void StripMissingScripts(GameObject go)
        {
            foreach (var transform in go.GetComponentsInChildren<Transform>(true)) GameObjectUtility.RemoveMonoBehavioursWithMissingScript(transform.gameObject);
        }

        public static void Batch() => Run();
    }
}
