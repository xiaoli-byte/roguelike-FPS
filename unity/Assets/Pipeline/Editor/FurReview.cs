using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 毛发画质对比：在 Desert 样板场景（角色审核截图同一套光照、后处理）里，把每个挂了 <see cref="FurShells"/> 的角色 Prefab
    /// 摆到燎旁边，同一机位按画质 低 / 中 / 高 各拍一张，左右并排写到 Assets/Art/_Review/fur_&lt;ID&gt;.png（不入库）：
    /// 上排三分之四正面全身，下排放大到上半身（看发丝与剪影）。fur_summary.txt 记每个资产的壳层数、LOD0 面数与「高」档多出来的绘制量。
    /// 菜单 Spiritfire/Art/Fur Quality Shots，或 Bridge 命令 fur；不保存场景、不改 PlayerPrefs。
    /// </summary>
    public static class FurReview
    {
        const int W = 960, H = 1080;
        static readonly ArtQualityLevel[] Tiers = { ArtQualityLevel.Low, ArtQualityLevel.Medium, ArtQualityLevel.High };

        [MenuItem("Spiritfire/Art/Fur Quality Shots")]
        public static void Run() => Run(null);

        public static void Run(ICollection<string> only)
        {
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty)
                {
                    Debug.LogWarning("[fur] 当前场景有未保存的改动，不切到样板场景拍对比图");
                    return;
                }
            var prefabs = AssetDatabase.FindAssets("t:Prefab", new[] { ArtSidecar.ArtRoot + "/Prefabs/Characters" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(p => AssetDatabase.LoadAssetAtPath<GameObject>(p))
                .Where(p => p && p.GetComponent<FurShells>() && (only == null || only.Count == 0 || only.Contains(p.name)))
                .OrderBy(p => p.name).ToList();
            if (prefabs.Count == 0)
            {
                Debug.LogWarning("[fur] 没有挂 FurShells 的角色 Prefab（registry.toml 里给资产加 [assets.<ID>.fur] 再导出、Sync）");
                return;
            }
            var theme = ShowcaseTheme.All.First(t => t.key == "Desert");
            EditorSceneManager.OpenScene(theme.ScenePath);
            var camCtl = Object.FindFirstObjectByType<ShowcaseCamera>();
            var cam = camCtl.GetComponent<Camera>();
            camCtl.firstPersonRig.SetActive(false);
            var hero = Object.FindObjectsByType<ArtAssetInfo>(FindObjectsSortMode.None).FirstOrDefault(i => i.assetId == "SK_Hero_RedPanda");
            var spot = (hero ? hero.transform.position : Vector3.zero) + Vector3.right * 1.3f + Vector3.back * 0.5f;
            // 样板场景里的角色排也有毛发：拍对比时统一关掉，只看摆进来的这一只
            foreach (var f in Object.FindObjectsByType<FurShells>(FindObjectsSortMode.None)) f.Apply(0);

            Directory.CreateDirectory(ReviewCapture.OutDir);
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            var tile = new Texture2D(W, H, TextureFormat.RGB24, false);
            var sheet = new Texture2D(W * Tiers.Length, H * 2, TextureFormat.RGB24, false);
            var summary = new List<string> { "资产\t类型\t「高」壳层\tLOD0 三角面\t「高」多画的三角面" };
            var before = ArtQuality.Level;
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.targetTexture = rt;
                // 预热：刚打开场景的头几帧阴影、贴图流送还没就绪，第一张会拍成空场景
                for (int k = 0; k < 4; k++) cam.Render();
                foreach (var prefab in prefabs)
                {
                    var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    go.transform.SetPositionAndRotation(spot, Quaternion.LookRotation(Vector3.back + Vector3.right * 0.35f));
                    foreach (var lg in go.GetComponentsInChildren<LODGroup>()) lg.ForceLOD(0);
                    var fur = go.GetComponent<FurShells>();
                    // 取景用设计包围盒（蒙皮渲染器在编辑器里的包围盒偏大）
                    var info = go.GetComponent<ArtAssetInfo>();
                    var b = info && info.designBounds.size.sqrMagnitude > 0
                        ? new Bounds(go.transform.TransformPoint(info.designBounds.center), info.designBounds.size)
                        : Bounds(go);
                    float h = Mathf.Max(b.size.y, 0.3f);
                    var focus = b.center;
                    var dir = (Vector3.back + Vector3.right * 0.45f).normalized;
                    // 主体约占画面高度的 75%（按相机竖直视角算距离）；下排放大到上半身
                    float tanHalf = Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);
                    float span = Mathf.Max(h, Mathf.Max(b.size.x, b.size.z) * 0.6f);
                    float dist = span * 0.5f / 0.75f / tanHalf + Mathf.Max(b.extents.x, b.extents.z) * 0.5f;
                    var full = (focus + dir * dist + Vector3.up * h * 0.12f, focus);
                    // 下排：头和前胸（上 45%）占满画面高度的 80%，机位与目标同高
                    var upper = focus + Vector3.up * h * 0.27f;
                    float closeDist = h * 0.45f * 0.5f / 0.8f / tanHalf + Mathf.Max(b.extents.x, b.extents.z) * 0.6f;
                    var close = (upper + dir * closeDist, upper);
                    for (int t = 0; t < Tiers.Length; t++)
                    {
                        ArtQuality.Set(Tiers[t], save: false);
                        fur.Apply(ArtQuality.FurShells(fur.shellsHigh));
                        Shot(cam, rt, tile, full.Item1, full.Item2);
                        sheet.SetPixels(t * W, H, W, H, tile.GetPixels());
                        Shot(cam, rt, tile, close.Item1, close.Item2);
                        sheet.SetPixels(t * W, 0, W, H, tile.GetPixels());
                    }
                    sheet.Apply();
                    File.WriteAllBytes($"{ReviewCapture.OutDir}/fur_{prefab.name}.png", sheet.EncodeToPNG());
                    var mesh = (fur.target as SkinnedMeshRenderer)?.sharedMesh;
                    int tris = mesh ? (int)(mesh.GetIndexCount(0) / 3) : 0;
                    summary.Add($"{prefab.name}\t{fur.kind}\t{fur.shellsHigh}\t{tris}\t{tris * fur.shellsHigh}");
                    Object.DestroyImmediate(go);
                    Debug.Log($"[fur] {ReviewCapture.OutDir}/fur_{prefab.name}.png");
                }
                File.WriteAllText($"{ReviewCapture.OutDir}/fur_summary.txt", string.Join("\n", summary));
            }
            finally
            {
                ArtQuality.Set(before, save: false);
                ShaderUtil.allowAsyncCompilation = wasAsync;
                cam.targetTexture = null;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(tile);
                Object.DestroyImmediate(sheet);
            }
        }

        static Bounds Bounds(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray();
            if (rs.Length == 0) return new Bounds(go.transform.position + Vector3.up, Vector3.one);
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b;
        }

        static void Shot(Camera cam, RenderTexture rt, Texture2D tile, Vector3 pos, Vector3 look)
        {
            cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(look - pos));
            // 换机位后的头几帧会触发着色器变体编译、阴影初始化与流送：多渲两遍再截
            for (int k = 0; k < 3; k++) cam.Render();
            RenderTexture.active = rt;
            tile.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tile.Apply();
            RenderTexture.active = null;
        }

        /// <summary>编辑器没开时：-batchmode -executeMethod Spiritfire.Art.Editor.FurReview.BatchRun [-furAssets ID,ID]（不能加 -nographics）</summary>
        public static void BatchRun()
        {
            var args = System.Environment.GetCommandLineArgs();
            int i = System.Array.IndexOf(args, "-furAssets");
            Run(i >= 0 && i + 1 < args.Length ? args[i + 1].Split(',') : null);
            EditorApplication.Exit(0);
        }
    }
}
