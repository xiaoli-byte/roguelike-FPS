using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 主菜单场景（U5 / U6；docs/unity-parity.md 3.11「主菜单：3D 远景主菜单」、3.12「选英雄 + 3D 祭台」）：Assets/Scenes/MainMenu.unity。
    /// 远景直接用第一章的展示场景（Showcase_Desert：沙漠城门广场、城墙角楼、篝火、远处巨像与崖壁，灯光 / 天空 / 雾 / 后处理都现成），
    /// 打开它、去掉展示用的东西（角色排、机位、第一人称枪模相机、脚步 IK 的坡道）、另存为 MainMenu，再加：
    ///   · Menu Camera（<see cref="MenuCamera"/>：远景机位看向城门与巨像；URP 后处理、SMAA；音频监听）；
    ///   · Menu Director（<see cref="MenuDirector"/>：进场开主菜单）；
    ///   · Hero Stage（U6：广场中央的祭台 + 三位英雄的展示模型）。
    /// 然后重烘环境光（只有天空球谐与反射，几秒）、把场景放进构建设置（Core 仍排第 0：打包版从 Core 启动后由 MenuFlow 转到主菜单）。
    /// 生成：Spiritfire ▸ Levels ▸ Build Main Menu Scene，或 bridge.sh menu（levels 也会顺带生成）。报告写 Assets/Art/_Review/menu_report.txt。
    /// </summary>
    public static class MenuSceneBuilder
    {
        public const string ScenePath = MenuFlow.MenuScenePath;
        const string Dir = "Assets/Scenes/MainMenu";

        /// <summary>远景机位：广场南端稍高处，看向城门（z = 28）与巨像（z = 52）</summary>
        static readonly Vector3 HomeCamPos = new(0, 2.4f, -12.5f), HomeCamTarget = new(0, 4.2f, 30f);
        /// <summary>祭台：广场中央两排石柱之间（原角色排的位置往里挪一点），背后是篝火与城门</summary>
        public static readonly Vector3 StagePos = new(0, 0, 6f);

        [MenuItem("Spiritfire/Levels/Build Main Menu Scene（主菜单 + 选英雄祭台）", priority = 60)]
        static void BuildMenu() => Build();

        /// <summary>生成主菜单场景，返回不合格项数</summary>
        public static int Build()
        {
            ShowcaseSceneBuilder.ConfigureProject();
            var rep = new LevelKit.Report();
            rep.Line("主菜单场景 · 生成报告");
            var theme = ShowcaseTheme.Desert;
            if (!File.Exists(theme.ScenePath))
            {
                rep.Line($"{theme.ScenePath} 还没有，先生成展示场景");
                ShowcaseSceneBuilder.Build(theme);
            }
            var scene = EditorSceneManager.OpenScene(theme.ScenePath, OpenSceneMode.Single);
            int removed = Strip(scene);
            rep.Line($"远景：{theme.ScenePath}（{theme.title}），去掉展示用物体 {removed} 个");

            var menu = new GameObject("Menu").transform;
            var cam = BuildCamera(menu);
            var director = new GameObject("Menu Director").AddComponent<MenuDirector>();
            director.transform.SetParent(menu, false);
            director.menuCamera = cam;

            MixamoLibrary.EnsureFolder(Dir);
            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            EditorSceneManager.SaveScene(scene);

            AddToBuildSettings(ScenePath);
            LevelBuilders.SyncBuildSettings();
            var order = EditorBuildSettings.scenes.Select(s => s.path).ToList();
            if (!order.Contains(ScenePath)) rep.Fail($"{ScenePath} 不在构建设置里");
            else rep.Line($"✓ 构建设置：{string.Join(" → ", order.Select(Path.GetFileNameWithoutExtension))}（Core 排第 0，打包版启动后由 MenuFlow 转到主菜单）");
            if (!Object.FindAnyObjectByType<MenuDirector>()) rep.Fail("场景里没有 MenuDirector");
            if (!cam || !cam.GetComponent<Camera>()) rep.Fail("场景里没有菜单相机");
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/menu_report.txt");
            Debug.Log($"[Menu] 主菜单场景已生成：{ScenePath}（不合格 {rep.failures} 项）");
            return rep.failures;
        }

        /// <summary>去掉展示场景里只给展示用的东西：角色排（含首领、挂件）、机位、相机（含第一人称枪模）、脚步 IK 坡道</summary>
        static int Strip(Scene scene)
        {
            int n = 0;
            foreach (var root in scene.GetRootGameObjects())
            {
                if (root.name is "Characters" or "Viewpoints" || root.GetComponentInChildren<Camera>(true) || root.GetComponentInChildren<ShowcaseCamera>(true))
                {
                    Object.DestroyImmediate(root);
                    n++;
                    continue;
                }
                foreach (var t in root.GetComponentsInChildren<Transform>(true).Where(t => t && t.name == "Terrain Test").ToList())
                {
                    Object.DestroyImmediate(t.gameObject);
                    n++;
                }
                foreach (var a in root.GetComponentsInChildren<ShowcaseActor>(true).ToList())
                    if (a)
                    {
                        Object.DestroyImmediate(a.gameObject);
                        n++;
                    }
            }
            return n;
        }

        static MenuCamera BuildCamera(Transform parent)
        {
            var go = new GameObject("Menu Camera") { tag = "MainCamera" };
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(HomeCamPos, Quaternion.LookRotation(HomeCamTarget - HomeCamPos, Vector3.up));
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 46f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 600f;
            go.AddComponent<AudioListener>();
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            var anchor = new GameObject("Camera Home").transform;
            anchor.SetParent(parent, false);
            anchor.SetPositionAndRotation(go.transform.position, go.transform.rotation);
            var mc = go.AddComponent<MenuCamera>();
            mc.homeAnchor = anchor;
            mc.homeFov = 46f;
            return mc;
        }

        static void AddToBuildSettings(string path)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.Any(s => s.path == path)) return;
            scenes.Add(new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
