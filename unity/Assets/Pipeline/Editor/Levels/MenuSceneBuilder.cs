using System.Collections.Generic;
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
    ///   · Hero Stage（<see cref="HeroStage"/>：广场中央的祭台 + 三位英雄的展示模型 SK_Hero_*，见 <see cref="BuildStage"/>）。
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
            var stage = BuildStage(menu, rep);
            var director = new GameObject("Menu Director").AddComponent<MenuDirector>();
            director.transform.SetParent(menu, false);
            director.menuCamera = cam;
            director.stage = stage;
            if (stage)
            {
                cam.heroesAnchor = stage.CameraAnchor;
                cam.heroesFov = stage.fov;
            }

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
            if (!Object.FindAnyObjectByType<HeroStage>()) rep.Fail("场景里没有选英雄祭台 HeroStage");
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

        /// <summary>URP Lit 模板材质（祭台石材 / 鎏金复制它改色）：包里自带的 Lit.mat；没有就在 MainMenu 目录建一份</summary>
        static Material LitTemplate()
        {
            var m = AssetDatabase.LoadAssetAtPath<Material>("Packages/com.unity.render-pipelines.universal/Runtime/Materials/Lit.mat");
            if (m) return m;
            string path = $"{Dir}/M_StageLit.mat";
            m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m) return m;
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (!shader) return null;
            MixamoLibrary.EnsureFolder(Dir);
            m = new Material(shader) { name = "M_StageLit" };
            AssetDatabase.CreateAsset(m, path);
            return m;
        }

        /// <summary>
        /// 选英雄祭台：广场中央，+Z 朝向选英雄机位（城门和篝火在英雄身后）。台座 / 光柱 / 粒子运行时由代码建（<see cref="HeroAltar"/>、<see cref="StageAmbience"/>），
        /// 这里只摆组件、灯光、机位，和每位英雄的展示模型（停用，<see cref="HeroStage.Show"/> 时启用）。缺模型的英雄运行时用占位体，报告里记一条
        /// </summary>
        static HeroStage BuildStage(Transform parent, LevelKit.Report rep)
        {
            var go = new GameObject("Hero Stage");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(StagePos, Quaternion.Euler(0, 180, 0));
            var lit = LitTemplate();
            if (!lit) rep.Warn("找不到 URP Lit 材质：祭台石材运行时退回不受光的纯色");
            var altar = go.AddComponent<HeroAltar>();
            altar.litTemplate = lit;
            var ambience = go.AddComponent<StageAmbience>();
            var stage = go.AddComponent<HeroStage>();
            stage.litTemplate = lit;
            stage.altar = altar;
            stage.ambience = ambience;
            stage.Ensure();
            var modelsRoot = go.transform.Find("Models");
            var models = new List<HeroStage.HeroModel>();
            foreach (var hero in HeroLibrary.All)
            {
                var id = HeroPrefabId(hero);
                var prefab = id != null ? ShowcaseSceneBuilder.Prefab(id) : null;
                if (!prefab)
                {
                    rep.Warn($"英雄 {hero.id}（{hero.name}）没有展示模型{(id != null ? $" {id}" : "")}：选英雄时用占位体");
                    continue;
                }
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab, modelsRoot);
                inst.name = prefab.name;
                inst.transform.localPosition = Vector3.zero;
                inst.transform.localRotation = Quaternion.identity;
                inst.SetActive(false);
                models.Add(new HeroStage.HeroModel { heroId = hero.id, model = inst });
            }
            stage.models = models.ToArray();
            rep.Line($"祭台：{StagePos}，英雄模型 {models.Count}/{HeroLibrary.All.Count}（{string.Join("、", models.Select(m => $"{m.heroId}={m.model.name}"))}）");
            if (models.Count == 0) rep.Fail("一个英雄展示模型都没有（先 bridge.sh sync 导入 SK_Hero_*）");
            return stage;
        }

        /// <summary>英雄的展示模型 id：手臂 SM_Arms_RedPandaR → SK_Hero_RedPanda；对不上时按 ArtAssetInfo 的绑定（bindSource = hero、bindId = 英雄 id）找</summary>
        static string HeroPrefabId(HeroDef hero)
        {
            if (!string.IsNullOrEmpty(hero.armR) && hero.armR.StartsWith("SM_Arms_") && hero.armR.EndsWith("R"))
            {
                var id = "SK_Hero_" + hero.armR.Substring(8, hero.armR.Length - 9);
                if (ShowcaseSceneBuilder.Prefab(id)) return id;
            }
            foreach (var guid in AssetDatabase.FindAssets("SK_Hero_ t:Prefab", new[] { "Assets/Art/Prefabs" }))
            {
                var p = AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(guid));
                var info = p ? p.GetComponent<ArtAssetInfo>() : null;
                if (info && info.bindSource == "hero" && info.bindId == hero.id) return p.name;
            }
            return null;
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
