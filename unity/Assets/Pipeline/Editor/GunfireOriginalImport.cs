using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Spiritfire.Art.Editor.Levels;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor
{
    public static class GunfireOriginalImport
    {
        const string Root = "Assets/Art/Original/Gunfire";
        static readonly string[] Ids = { "1001", "1002", "1202", "1008", "1106", "1301", "1003", "1004", "1005", "1006", "1009", "1010", "1013", "1014", "1101", "1102" };
        static readonly HashSet<string> ParticleGraph = new() { "2ede01cb45c4c8848ab9ffed09c254e1", "029f197b32f0e1b4a95271fddfe796ed" };
        static readonly HashSet<string> AlphaBlend = new() { "1faad54a41c7c0842b1735c6ba71dbd9" };

        [MenuItem("Spiritfire/Art/Import Native Gunfire Weapons")]
        public static void Run(string[] selected = null)
        {
            selected = selected?.Where(id => id.All(char.IsDigit)).ToArray();
            string previousScene = UnityEditor.SceneManagement.EditorSceneManager.GetActiveScene().path;
            UnityEditor.SceneManagement.EditorSceneManager.SaveOpenScenes();
            UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
            try
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                ConfigureTextures();
                ConfigureMaterials();
                Directory.CreateDirectory("Assets/Resources/Gunfire/Materials");
                foreach (string id in new[] { "1001", "1106", "1301" })
                {
                    string directory = id == "1301" ? "materials/" : "";
                    AssetDatabase.CopyAsset($"{Root}/arts/artres/characters/weapons/{id}/{directory}{id}.mat", $"Assets/Resources/Gunfire/Materials/{id}.mat");
                }
                AssetDatabase.CopyAsset($"{Root}/arts/artres/characters/weapons/1301/materials/1.mat", "Assets/Resources/Gunfire/Materials/1301_shell.mat");
                Directory.CreateDirectory("Assets/Resources/Gunfire/Weapons");
                Directory.CreateDirectory("Assets/Resources/Gunfire/Effects");
                Directory.CreateDirectory("Assets/Resources/Gunfire/Audio");
                CopyEffect("1926_muzzle");
                foreach (var shot in Directory.GetFiles($"{Root}/res/soundma/wav/wpn/wpn_1202", "*.ogg"))
                {
                    string name = Path.GetFileNameWithoutExtension(shot);
                    AssetDatabase.CopyAsset(shot.Replace('\\', '/'), $"Assets/Resources/Gunfire/Audio/{name}.ogg");
                }
                foreach (string id in selected is { Length: > 0 } ? selected : Ids) BuildWeapon(id);
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
                if (material.name.StartsWith("1926_", StringComparison.Ordinal))
                {
                    shaderId = material.name switch
                    {
                        "1926_muzzle_ray_01" => "32a99689008ccae42ac566b5574e59bc",
                        "1926_muzzle_ring_01" or "1926_muzzle_ring_02" => "296b511ef18167e4991b7fd123944eff",
                        "1926_muzzle_ring_03" => "d23f46ed29477cc409565f73a91be21f",
                        "1926_muzzle_smoke_01" or "1926_trail_smoke_01" => "1faad54a41c7c0842b1735c6ba71dbd9",
                        _ => shaderId,
                    };
                }
                bool isParticle = path.Contains("/arteffects/") && material.name != "1926_ball_01";
                material.shader = isParticle ? particle : character;
                if (isParticle)
                {
                    bool dissolve = shaderId is "32a99689008ccae42ac566b5574e59bc" or "296b511ef18167e4991b7fd123944eff" or "1faad54a41c7c0842b1735c6ba71dbd9";
                    bool uvAnimation = shaderId == "d23f46ed29477cc409565f73a91be21f";
                    material.SetFloat("_EffectMode", uvAnimation ? 2 : dissolve ? 1 : 0);
                    material.SetFloat("_UseParticleTexture", !dissolve && !uvAnimation && ParticleGraph.Contains(shaderId) ? 1 : 0);
                    material.SetFloat("_SrcBlend", dissolve || uvAnimation ? 5 : 1);
                    material.SetFloat("_DstBlend", AlphaBlend.Contains(shaderId) ? 10 : 1);
                    material.SetKeyword(new LocalKeyword(particle, "ENABLE_DISSOLVE_AMOUNT"), (dissolve || uvAnimation) && material.GetFloat("_EnableAlphaToDissolve") > 0.5f);
                    material.SetKeyword(new LocalKeyword(particle, "ENABLE_COLOR_CONTROL_UV_AMOUNT"), dissolve && material.GetFloat("_EnableColorControlUV") > 0.5f);
                    material.SetFloat("_ZZWrite", 0);
                    material.SetFloat("_Cull", 0);
                    material.renderQueue = 3000;
                }
                else
                {
                    material.DisableKeyword("_METALLICGLOSSMAP");
                    material.SetKeyword(new LocalKeyword(character, "_METALLICSPECGLOSSMAP"), material.GetTexture("_MetallicGlossMap"));
                    material.SetKeyword(new LocalKeyword(character, "_OCCLUSIONMAP"), material.GetTexture("_OcclusionMap"));
                    material.SetKeyword(new LocalKeyword(character, "_EMISSION"), material.GetTexture("_EmissionMap") && material.GetColor("_EmissionColor").maxColorComponent > 0);
                    material.SetKeyword(new LocalKeyword(character, "_RECEIVE_SHADOWS_OFF"), material.GetFloat("_ReceiveShadows") == 0);
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
            RestoreFirstPersonArms(instance);
            Directory.CreateDirectory("Assets/Resources/Gunfire/Animations");
            foreach (var animator in instance.GetComponentsInChildren<Animator>(true))
            {
                if (!animator.runtimeAnimatorController && id is "1013" or "1014" && animator.name.EndsWith("_Left", StringComparison.Ordinal))
                    animator.runtimeAnimatorController = AssetDatabase.LoadAssetAtPath<AnimatorController>($"{Root}/arts/artres/characters/weapons/1003/1003_dw.controller");
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
                ? new[] { "436179418", "792043890", "816101160" }.Select(media => AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Resources/Gunfire/Audio/wwise_2612982229_{media}.wav")).Where(a => a).ToArray()
                : Array.Empty<AudioClip>();
            animation.reloadClips = id == "1202"
                ? new[] { "283121052", "291819121", "841820460" }.Select(media => AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Resources/Gunfire/Audio/wwise_240364026_{media}.wav")).Where(a => a).ToArray()
                : Array.Empty<AudioClip>();
            animation.reloadDetailClips = id == "1202"
                ? new[] { "250587956", "583867777", "605265383" }.Select(media => AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Resources/Gunfire/Audio/wwise_161980014_{media}.wav")).Where(a => a).ToArray()
                : Array.Empty<AudioClip>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(instance, $"Assets/Resources/Gunfire/Weapons/{id}.prefab");
            int animators = prefab.GetComponentsInChildren<Animator>(true).Count(a => a.runtimeAnimatorController && a.avatar);
            int renderers = prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true).Count(r => r.sharedMesh && r.sharedMaterials.Length > 0);
            int clips = prefab.GetComponentsInChildren<Animator>(true).Sum(a => a.runtimeAnimatorController ? a.runtimeAnimatorController.animationClips.Length : 0);
            Debug.Log($"[Gunfire] Native {id}: {animators} animators, {clips} clips, {renderers} skinned meshes, muzzle={(bool)sockets.muzzle}");
            UnityEngine.Object.DestroyImmediate(instance);
        }

        static void RestoreFirstPersonArms(GameObject weapon)
        {
            var material = AssetDatabase.LoadAssetAtPath<Material>($"{Root}/arts/artres/characters/heros/101/101_fpp.mat");
            foreach (var renderer in weapon.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (!renderer.name.StartsWith("hero_fpp_101_A_", StringComparison.Ordinal)) continue;
                var mesh = AssetDatabase.LoadAssetAtPath<Mesh>($"{Root}/arts/artres/characters/heros/101/{renderer.name}.asset");
                if (!mesh || !material)
                    throw new InvalidOperationException($"Missing native first-person arm asset: {renderer.name}; mesh={(bool)mesh}, material={(bool)material}");
                if (renderer.bones.Length == 0 || renderer.bones.Any(b => !b) || !renderer.rootBone) RestoreArmBones(renderer, mesh);
                renderer.sharedMesh = mesh;
                renderer.sharedMaterial = material;
                renderer.gameObject.SetActive(true);
                renderer.enabled = true;
                renderer.updateWhenOffscreen = true;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
            }
        }

        static bool RestoreReferenceArmBones(SkinnedMeshRenderer renderer, Transform home)
        {
            var source = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Resources/Gunfire/Weapons/1002.prefab");
            var reference = source
                ? source.GetComponentsInChildren<SkinnedMeshRenderer>(true).FirstOrDefault(r => r.name == renderer.name && r.rootBone && r.bones.Length > 0 && r.bones.All(b => b))
                : null;
            if (!reference)
            {
                Debug.LogWarning($"[Gunfire] No valid reference arm for {renderer.name}");
                return false;
            }
            var referenceHome = reference.transform.parent;
            if (!home.Find("Bip001"))
            {
                var referenceSkeleton = referenceHome.Find("Bip001");
                if (!referenceSkeleton) return false;
                var skeleton = UnityEngine.Object.Instantiate(referenceSkeleton, home, false);
                skeleton.name = referenceSkeleton.name;
                var animator = home.GetComponent<Animator>();
                var referenceAnimator = referenceHome.GetComponent<Animator>();
                if (animator && referenceAnimator) animator.avatar = referenceAnimator.avatar;
            }
            string Path(Transform bone)
            {
                string path = bone.name;
                while (bone.parent && bone.parent != referenceHome)
                {
                    bone = bone.parent;
                    path = bone.name + "/" + path;
                }
                return bone.parent == referenceHome ? path : null;
            }
            Transform FindBone(string path)
            {
                var direct = home.Find(path);
                if (direct) return direct;
                int separator = path.LastIndexOf('/');
                return WeaponSockets.FindDeep(home, separator >= 0 ? path.Substring(separator + 1) : path);
            }
            var bones = reference.bones.Select(b => FindBone(Path(b))).ToArray();
            var root = FindBone(Path(reference.rootBone));
            if (!root || bones.Any(b => !b))
            {
                Debug.LogWarning($"[Gunfire] Cannot map reference arm {renderer.name}: {string.Join(", ", reference.bones.Where((b, i) => !bones[i]).Select(Path))}");
                Debug.LogWarning($"[Gunfire] Actual {home.parent.name}/{home.name} children: {string.Join(" | ", home.GetComponentsInChildren<Transform>(true).Select(t => t.name))}");
                return false;
            }
            renderer.bones = bones;
            renderer.rootBone = root;
            Debug.Log($"[Gunfire] Restored {bones.Length} reference arm bones for {renderer.name} under {home.name}");
            return true;
        }

        static void RestoreArmBones(SkinnedMeshRenderer renderer, Mesh mesh)
        {
            var home = renderer.transform.parent;
            if (!home) throw new InvalidOperationException($"No native arm home: {renderer.name}");
            if (RestoreReferenceArmBones(renderer, home)) return;
            var paths = new Dictionary<uint, string>();
            string avatarText = File.ReadAllText($"{Root}/arts/artres/characters/heros/101/101Avatar.asset");
            foreach (System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(avatarText, @"^\s*(\d+): (.+)$", System.Text.RegularExpressions.RegexOptions.Multiline))
                if (uint.TryParse(match.Groups[1].Value, out uint hash)) paths[hash] = match.Groups[2].Value.Trim().Trim('\'');
            string meshText = File.ReadAllText(AssetDatabase.GetAssetPath(mesh));
            string hashes = System.Text.RegularExpressions.Regex.Match(meshText, @"m_BoneNameHashes: ([0-9a-f]+)").Groups[1].Value;
            if (hashes.Length == 0 || hashes.Length % 8 != 0) throw new InvalidOperationException($"No native arm bone hashes: {renderer.name}");
            var bones = new Transform[hashes.Length / 8];
            for (int i = 0; i < bones.Length; i++)
            {
                uint hash = uint.Parse(hashes.Substring(i * 8, 8), System.Globalization.NumberStyles.HexNumber);
                bones[i] = paths.TryGetValue(hash, out string path) ? home.Find(path) : null;
                if (!bones[i]) throw new InvalidOperationException($"Missing native arm bone: {renderer.name}, hash={hash}, path={(paths.TryGetValue(hash, out path) ? path : "unknown")}, home={home.name}");
            }
            string rootHashText = System.Text.RegularExpressions.Regex.Match(meshText, @"m_RootBoneNameHash: (\d+)").Groups[1].Value;
            uint rootHash = uint.Parse(rootHashText);
            var root = paths.TryGetValue(rootHash, out string rootPath) ? home.Find(rootPath) : null;
            if (!root) throw new InvalidOperationException($"Missing native arm root bone: {renderer.name}, hash={rootHash}");
            renderer.bones = bones;
            renderer.rootBone = root;
            Debug.Log($"[Gunfire] Restored {bones.Length} native arm bones for {renderer.name} under {home.name}");
        }

        static void StripMissingScripts(GameObject go)
        {
            foreach (var transform in go.GetComponentsInChildren<Transform>(true)) GameObjectUtility.RemoveMonoBehavioursWithMissingScript(transform.gameObject);
        }

        public static void Batch() => Run();
    }
}
