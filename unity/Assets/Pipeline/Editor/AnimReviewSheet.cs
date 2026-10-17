using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 动作审核图：每个有状态机的角色一张，行 = 片段，列 = 片段内 4 个时间点（0 / ⅓ / ⅔ / 末尾），3/4 侧前方取景。
    /// 用来人工检查采样来的动作：肢体有没有翻转 / 拧麻花、脚有没有穿地、循环首尾是否一致。
    /// 写到 Assets/Art/_Review/anim/&lt;资产&gt;.png（不入库）。菜单 Spiritfire ▸ Art ▸ Anim Review Sheets。
    /// </summary>
    public static class AnimReviewSheet
    {
        const int Tile = 300, Cols = 5, MaxRows = 12;
        public const string OutDir = "Assets/Art/_Review/anim";

        [MenuItem("Spiritfire/Art/Anim Review Sheets", priority = 2)]
        public static void RenderAll()
        {
            Directory.CreateDirectory(OutDir);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.3f;
            sun.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(40, 140, 0);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.5f, 0.55f, 0.65f);
            RenderSettings.ambientEquatorColor = new Color(0.5f, 0.48f, 0.45f);
            RenderSettings.ambientGroundColor = new Color(0.3f, 0.28f, 0.26f);
            RenderSettings.fog = false;
            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.transform.localScale = Vector3.one * 3;
            var floorMat = new Material(Shader.Find(ArtPrefabBuilder.ShaderName));
            floorMat.SetColor("_BaseColor", new Color(0.42f, 0.44f, 0.47f));
            floor.GetComponent<MeshRenderer>().sharedMaterial = floorMat;
            var cam = new GameObject("Cam").AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.2f, 0.22f, 0.25f);
            cam.fieldOfView = 30;
            cam.GetUniversalAdditionalCameraData().antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

            var rt = new RenderTexture(Tile, Tile, 24, RenderTextureFormat.ARGB32);
            var tileTex = new Texture2D(Tile, Tile, TextureFormat.RGB24, false);
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            ShaderUtil.allowAsyncCompilation = false;
            try
            {
                foreach (var sc in ArtSidecar.All().Where(s => s.IsCharacter))
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(sc.PrefabPath);
                    var ctl = prefab ? prefab.GetComponentInChildren<Animator>()?.runtimeAnimatorController as AnimatorController : null;
                    if (!ctl) continue;
                    var clips = ctl.animationClips.Distinct().Take(MaxRows).ToList();
                    if (clips.Count == 0) continue;
                    var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    foreach (var lg in go.GetComponentsInChildren<LODGroup>()) lg.ForceLOD(0);
                    var animGo = go.GetComponentInChildren<Animator>().gameObject;
                    var b = sc.DesignBounds ?? new Bounds(Vector3.up, Vector3.one * 2);
                    float size = Mathf.Max(b.size.y, b.size.x, b.size.z) * 1.25f;
                    float dist = size * 0.5f / Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) + b.extents.z;
                    var target = new Vector3(0, b.center.y, 0);
                    var dir = Quaternion.Euler(12, 145, 0) * Vector3.forward; // 3/4 侧前方、略俯视
                    cam.transform.SetPositionAndRotation(target - dir * dist, Quaternion.LookRotation(dir));

                    // 预热：第一次渲染会初始化阴影与着色器变体，那一格会是黑的
                    cam.targetTexture = rt;
                    cam.Render();
                    var sheet = new Texture2D(Tile * Cols, Tile * clips.Count, TextureFormat.RGB24, false);
                    AnimationMode.StartAnimationMode();
                    for (int r = 0; r < clips.Count; r++)
                    for (int c = 0; c < Cols; c++)
                    {
                        float t = clips[r].length * (0.1f + 0.8f * c / (Cols - 1));
                        AnimationMode.BeginSampling();
                        AnimationMode.SampleAnimationClip(animGo, clips[r], t);
                        AnimationMode.EndSampling();
                        // 批处理里单独 Camera.Render 不会刷新蒙皮：按当前骨骼烘出临时网格来渲染
                        var proxies = BakeProxies(go);
                        cam.targetTexture = rt;
                        cam.Render();
                        foreach (var p in proxies) { Object.DestroyImmediate(p.GetComponent<MeshFilter>().sharedMesh); Object.DestroyImmediate(p); }
                        foreach (var smr in go.GetComponentsInChildren<SkinnedMeshRenderer>(true)) smr.forceRenderingOff = false;
                        RenderTexture.active = rt;
                        tileTex.ReadPixels(new Rect(0, 0, Tile, Tile), 0, 0);
                        RenderTexture.active = null;
                        // 行从上往下排：Texture2D 原点在左下
                        sheet.SetPixels(c * Tile, (clips.Count - 1 - r) * Tile, Tile, Tile, tileTex.GetPixels());
                    }
                    AnimationMode.StopAnimationMode();
                    cam.targetTexture = null;
                    sheet.Apply();
                    string path = $"{OutDir}/{sc.Id}.png";
                    File.WriteAllBytes(path, sheet.EncodeToPNG());
                    File.WriteAllText($"{OutDir}/{sc.Id}.txt", string.Join("\n", clips.Select((cl, i) => $"{i + 1}. {cl.name} ({cl.length:F2}s{(cl.isLooping ? ", loop" : "")})")));
                    Object.DestroyImmediate(sheet);
                    Object.DestroyImmediate(go);
                    Debug.Log($"[AnimReview] {path}");
                }
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = wasAsync;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(tileTex);
            }
        }

        /// <summary>把当前骨骼姿势下 LOD0 的每个蒙皮网格烘成静态网格（临时物体），原蒙皮渲染器暂时关掉</summary>
        internal static List<GameObject> BakeProxies(GameObject root)
        {
            var list = new List<GameObject>();
            foreach (var smr in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (!smr.enabled || !smr.gameObject.activeInHierarchy || !smr.sharedMesh) continue;
                smr.forceRenderingOff = true; // 包括 LOD1/2：烘焙件只做 LOD0，原蒙皮渲染器一律关掉，避免重影
                var lg = smr.GetComponentInParent<LODGroup>();
                if (lg && !lg.GetLODs()[0].renderers.Contains(smr)) continue;
                var mesh = new Mesh();
                smr.BakeMesh(mesh, true);
                var p = new GameObject("bake");
                p.transform.SetPositionAndRotation(smr.transform.position, smr.transform.rotation);
                p.AddComponent<MeshFilter>().sharedMesh = mesh;
                p.AddComponent<MeshRenderer>().sharedMaterials = smr.sharedMaterials;
                smr.forceRenderingOff = true;
                list.Add(p);
            }
            return list;
        }

        public static void BatchRender()
        {
            RenderAll();
            EditorApplication.Exit(0);
        }
    }
}
