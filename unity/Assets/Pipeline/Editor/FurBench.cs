using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 毛发画质的帧耗时基准：在 Desert 样板场景里摆一个接近实战的最坏情况——玩家身边两只完整毛发的灵宠（白泽 3 米、讙 2.5 米），
    /// 前方 7–14 米一群 6 头獓狠模型（雷牦群复用它，只有轮廓发丝面片），机位是玩家眼高；按画质 低 / 中 / 高 各渲染 1920×1080、
    /// 4× MSAA，每帧读回一个像素强制等 GPU 画完，取平均毫秒。档位按 低 中 高 高 中 低 交替测两轮抵消漂移。
    /// 结果写到 Assets/Art/_Review/fur_bench.txt（不入库）。菜单 Spiritfire/Art/Fur Bench，或 Bridge 命令 furbench。
    /// 编辑器里的计时含编辑器自身开销，只看三档之间的差值。
    /// </summary>
    public static class FurBench
    {
        const int Warmup = 12, Frames = 60;
        static readonly ArtQualityLevel[] Order =
            { ArtQualityLevel.Low, ArtQualityLevel.Medium, ArtQualityLevel.High, ArtQualityLevel.High, ArtQualityLevel.Medium, ArtQualityLevel.Low };

        [MenuItem("Spiritfire/Art/Fur Bench")]
        public static void Run()
        {
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty)
                {
                    Debug.LogWarning("[fur] 当前场景有未保存的改动，不切到样板场景测帧耗时");
                    return;
                }
            GameObject Load(string id) => AssetDatabase.LoadAssetAtPath<GameObject>($"{ArtSidecar.ArtRoot}/Prefabs/Characters/{id}.prefab");
            var baize = Load("SK_Pet_Baize");
            var huan = Load("SK_Pet_Huan");
            var yak = Load("SK_Enemy_Aoyin");
            if (!baize || !huan || !yak)
            {
                Debug.LogWarning("[fur] 找不到白泽 / 讙 / 獓狠的 Prefab，先 Sync");
                return;
            }
            var theme = ShowcaseTheme.All.First(t => t.key == "Desert");
            EditorSceneManager.OpenScene(theme.ScenePath);
            var camCtl = Object.FindFirstObjectByType<ShowcaseCamera>();
            var cam = camCtl.GetComponent<Camera>();
            camCtl.firstPersonRig.SetActive(false);
            var hero = Object.FindObjectsByType<ArtAssetInfo>(FindObjectsSortMode.None).FirstOrDefault(i => i.assetId == "SK_Hero_RedPanda");
            var origin = (hero ? hero.transform.position : Vector3.zero) + Vector3.back * 6f;
            var fwd = Vector3.forward;
            var right = Vector3.right;

            var placed = new List<GameObject>();
            GameObject Place(GameObject prefab, Vector3 at)
            {
                var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(-fwd));
                foreach (var lg in go.GetComponentsInChildren<LODGroup>()) lg.ForceLOD(-1);
                placed.Add(go);
                return go;
            }
            Place(baize, origin + fwd * 3f + right * 1.2f);
            Place(huan, origin + fwd * 2.5f - right * 1.0f);
            for (int k = 0; k < 6; k++)
                Place(yak, origin + fwd * (7f + 1.4f * k) + right * ((k % 3 - 1) * 2.6f));
            cam.transform.SetPositionAndRotation(origin + Vector3.up * 1.6f, Quaternion.LookRotation(fwd + Vector3.down * 0.08f));

            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            var px = new Texture2D(1, 1, TextureFormat.RGBA32, false);
            var before = ArtQuality.Level;
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            var furs = Object.FindObjectsByType<FurShells>(FindObjectsSortMode.None);
            var ms = new Dictionary<ArtQualityLevel, List<double>>();
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.targetTexture = rt;
                foreach (var tier in Order)
                {
                    ArtQuality.Set(tier, save: false);
                    foreach (var f in furs) f.ApplyTier(tier);
                    for (int k = 0; k < Warmup; k++) Frame(cam, rt, px);
                    var sw = Stopwatch.StartNew();
                    for (int k = 0; k < Frames; k++) Frame(cam, rt, px);
                    sw.Stop();
                    if (!ms.TryGetValue(tier, out var list)) ms[tier] = list = new List<double>();
                    list.Add(sw.Elapsed.TotalMilliseconds / Frames);
                }
                var avg = ms.ToDictionary(kv => kv.Key, kv => kv.Value.Average());
                double low = avg[ArtQualityLevel.Low];
                var lines = new List<string>
                {
                    "毛发画质帧耗时（1920×1080，4× MSAA，编辑器内 Camera.Render + 读回同步；只看差值）",
                    "场景：白泽 3 m + 讙 2.5 m（完整毛发）+ 6 头獓狠 7–14 m（只有轮廓发丝面片）",
                };
                foreach (var tier in new[] { ArtQualityLevel.Low, ArtQualityLevel.Medium, ArtQualityLevel.High })
                    lines.Add($"{ArtQuality.Label(tier)}：{avg[tier]:F2} ms（比低档 +{avg[tier] - low:F2} ms；两轮 {string.Join(" / ", ms[tier].Select(v => v.ToString("F2")))}）");
                Directory.CreateDirectory(ReviewCapture.OutDir);
                File.WriteAllText($"{ReviewCapture.OutDir}/fur_bench.txt", string.Join("\n", lines));
                foreach (var l in lines) Debug.Log($"[fur] {l}");
            }
            finally
            {
                ArtQuality.Set(before, save: false);
                ShaderUtil.allowAsyncCompilation = wasAsync;
                cam.targetTexture = null;
                foreach (var go in placed) if (go) Object.DestroyImmediate(go);
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(px);
            }
        }

        static void Frame(Camera cam, RenderTexture rt, Texture2D px)
        {
            cam.Render();
            // 读回一个像素：CPU 在这里等 GPU 把这一帧画完，计时才包含 GPU 的工作量
            RenderTexture.active = rt;
            px.ReadPixels(new Rect(0, 0, 1, 1), 0, 0, false);
            RenderTexture.active = null;
        }

        /// <summary>编辑器没开时：-batchmode -executeMethod Spiritfire.Art.Editor.FurBench.BatchRun（不能加 -nographics）</summary>
        public static void BatchRun()
        {
            Run();
            EditorApplication.Exit(0);
        }
    }
}
