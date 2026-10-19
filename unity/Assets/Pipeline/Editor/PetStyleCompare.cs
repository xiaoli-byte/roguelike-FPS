using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 灵宠画风对比：打开 Desert 样板场景（和角色审核截图同一套光照、后处理、相机），把 Resources/Pets 的灵宠摆进角色那一排旁边拍照：
    ///   petstyle_lineup.png：八只排在角色排前面；petstyle_&lt;ID&gt;.png：每只单独站在燎和蜃楼蟾之间的特写。
    /// 写到 Assets/Art/_Review/（不入库），不保存场景。菜单 Spiritfire/Pets/Style Compare Shots，或 Bridge 命令 petcompare。
    /// </summary>
    public static class PetStyleCompare
    {
        const string PetDir = "Assets/Game/Resources/Pets";

        [MenuItem("Spiritfire/Pets/Style Compare Shots")]
        public static void Run()
        {
            // 编辑器常被几个会话共用：当前场景有没保存的改动时不切场景（OpenScene 会直接丢掉它们）
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty)
                {
                    Debug.LogWarning($"[pets] 场景 {UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).name} 有未保存的改动，不切到样板场景拍对比图");
                    return;
                }
            var theme = ShowcaseTheme.All.First(t => t.key == "Desert");
            EditorSceneManager.OpenScene(theme.ScenePath);
            var camCtl = Object.FindFirstObjectByType<ShowcaseCamera>();
            var cam = camCtl.GetComponent<Camera>();
            var infos = Object.FindObjectsByType<ArtAssetInfo>(FindObjectsSortMode.None);
            Transform Find(string id) => infos.FirstOrDefault(i => i.assetId == id)?.transform;
            var hero = Find("SK_Hero_RedPanda");
            var toad = Find("SK_Enemy_MirageToad");
            var beast = Find("SK_Enemy_TombBeast");
            if (!hero || !toad)
            {
                Debug.LogWarning("[pets] 样板场景里找不到燎 / 蜃楼蟾，没法对比");
                return;
            }
            // 角色沿 +X 排成一排，机位在 -Z 一侧
            var row = Vector3.right;
            var front = Vector3.back;
            var pets = AssetDatabase.FindAssets("t:Prefab", new[] { PetDir })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(p => Path.GetDirectoryName(p)!.Replace('\\', '/') == PetDir) // 不含 Parts/ 下的发光件
                .Select(p => AssetDatabase.LoadAssetAtPath<GameObject>(p))
                .Where(p => p).OrderBy(p => Order(p.name)).ToArray();
            Directory.CreateDirectory(ReviewCapture.OutDir);
            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var shot = new Texture2D(1920, 1080, TextureFormat.RGB24, false);
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            camCtl.firstPersonRig.SetActive(false);
            var placed = new System.Collections.Generic.List<GameObject>();
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.targetTexture = rt;

                // 1. 八只排在角色排前面 3.2 m，横向铺满燎 → 镇墓兽那一段
                float x0 = hero.position.x - 2.5f, x1 = (beast ? beast.position.x : toad.position.x) + 1.5f;
                for (int i = 0; i < pets.Length; i++)
                {
                    var p = new Vector3(Mathf.Lerp(x0, x1, pets.Length > 1 ? i / (pets.Length - 1f) : 0.5f), 0, hero.position.z) + front * 3.2f;
                    placed.Add(Place(pets[i], p, front));
                }
                var mid = new Vector3((x0 + x1) * 0.5f, hero.position.y, hero.position.z);
                Render(cam, rt, shot, mid + front * 9.5f + Vector3.up * 2.2f, mid + front * 2f + Vector3.up * 0.9f, "petstyle_lineup");
                foreach (var go in placed) Object.DestroyImmediate(go);
                placed.Clear();

                // 2. 每只单独站在燎旁边（燎在画面左侧做参照），以灵宠为中心的三分之四正面特写
                var between = hero.position + row * 1.3f + front * 0.5f;
                foreach (var prefab in pets)
                {
                    var go = Place(prefab, between, front);
                    CloseUp(cam, rt, shot, go.transform.position, Height(go), row, front, $"petstyle_{prefab.name}");
                    Object.DestroyImmediate(go);
                }
                // 3. 参照：燎、三彩镇墓兽用同样的机位算法各拍一张
                CloseUp(cam, rt, shot, hero.position, Height(hero.gameObject), row, front, "petstyle_ref_SK_Hero_RedPanda");
                if (beast) CloseUp(cam, rt, shot, beast.position, Height(beast.gameObject), row, front, "petstyle_ref_SK_Enemy_TombBeast");
            }
            finally
            {
                foreach (var go in placed) if (go) Object.DestroyImmediate(go);
                ShaderUtil.allowAsyncCompilation = wasAsync;
                cam.targetTexture = null;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(shot);
            }
            Debug.Log($"[pets] 画风对比截图 {pets.Length + 1} 张 → {ReviewCapture.OutDir}/petstyle_*.png");
        }

        /// <summary>编辑器没开时：-batchmode -executeMethod Spiritfire.Art.Editor.PetStyleCompare.BatchRun（不能加 -nographics，要渲染）</summary>
        public static void BatchRun()
        {
            Run();
            EditorApplication.Exit(0);
        }

        static int Order(string id)
        {
            var order = new[] { "Dangkang", "Huan", "Jingwei", "Chongming", "Suanni", "Zheng", "Baize", "Yinglong" };
            int i = System.Array.FindIndex(order, o => id.EndsWith(o));
            return i < 0 ? 99 : i;
        }

        static GameObject Place(GameObject prefab, Vector3 at, Vector3 facing)
        {
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            at.y = Ground(at);
            go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(facing + Vector3.right * 0.35f));
            return go;
        }

        static float Ground(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 10f, Vector3.down, out var hit, 30f) ? hit.point.y : p.y;

        static float Height(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return 1f;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b.size.y;
        }

        /// <summary>以目标为中心的三分之四正面特写：距离随身高变，主体约占画面高度一半</summary>
        static void CloseUp(Camera cam, RenderTexture rt, Texture2D shot, Vector3 feet, float h, Vector3 row, Vector3 front, string name)
        {
            var focus = feet + Vector3.up * h * 0.5f - row * 0.25f;
            float dist = 0.9f + h * 1.9f;
            var pos = focus + (front + row * 0.45f).normalized * dist + Vector3.up * (0.15f + h * 0.3f);
            Render(cam, rt, shot, pos, focus, name);
        }

        static void Render(Camera cam, RenderTexture rt, Texture2D shot, Vector3 pos, Vector3 look, string name)
        {
            cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(look - pos));
            // 第一帧会触发着色器变体编译与阴影初始化：先渲一遍再截
            cam.Render();
            cam.Render();
            RenderTexture.active = rt;
            shot.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
            shot.Apply();
            RenderTexture.active = null;
            File.WriteAllBytes($"{ReviewCapture.OutDir}/{name}.png", shot.EncodeToPNG());
        }
    }
}
