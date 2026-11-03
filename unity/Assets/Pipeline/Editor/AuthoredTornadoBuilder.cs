using System.Collections.Generic;
using System.IO;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    public static class AuthoredTornadoBuilder
    {
        const string Fbx = "Assets/Art/VFX/Tornado/SK_VFX_Tornado.fbx";
        const string Texture = "Assets/Art/VFX/Tornado/T_VFX_WindRibbon.png";
        const string Dir = "Assets/Game/Resources/Fx/Authored";

        public static void Build(List<string> log)
        {
            Directory.CreateDirectory(Dir);
            var shader = Shader.Find("Spiritfire/AuthoredTornado");
            if (!shader)
            {
                Debug.LogError("[AuthoredTornado] 着色器缺失");
                return;
            }
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(Texture);
            var frost = Material("Frost", Hex.Rgb(0x9de8ff), shader, texture, 1.1f);
            var fire = Material("Fire", Hex.Rgb(0xff8b4d), shader, texture, 1.35f);
            var water = Material("Water", Hex.Rgb(0x55dff2), shader, texture, 1.25f);
            var cloud = Material("Cloud", Hex.Rgb(0x78c9d8), shader, null);
            var ring = Material("Ring", Hex.Rgb(0x75c7d8), shader, texture);
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(Fbx);
            if (!model)
            {
                Debug.LogError($"[AuthoredTornado] FBX 缺失：{Fbx}");
                return;
            }
            var root = new GameObject("AuthoredTornado");
            var instance = PrefabUtility.InstantiatePrefab(model) as GameObject;
            instance.name = "Mesh";
            instance.transform.SetParent(root.transform, false);
            if (!root.GetComponent<Animator>()) root.AddComponent<Animator>();
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            foreach (var r in renderers)
                r.sharedMaterial = r.name.Contains("Cloud") ? cloud : r.name.Contains("Ground") ? ring : frost;
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, $"{Dir}/Tornado.prefab");
            Object.DestroyImmediate(root);
            Object.DestroyImmediate(instance);
            log?.Add($"正式龙卷资产：{renderers.Length} 个渲染器，FBX + UV + 骨骼循环 → {prefab}");
        }

        static Material Material(string name, Color color, Shader shader, Texture2D texture, float emission = 1f)
        {
            string path = $"{Dir}/M_{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!mat)
            {
                mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = shader;
            mat.SetColor("_Color", color);
            mat.SetFloat("_Emission", emission);
            mat.SetTexture("_MainTex", texture ? texture : Texture2D.whiteTexture);
            EditorUtility.SetDirty(mat);
            return mat;
        }
    }
}
