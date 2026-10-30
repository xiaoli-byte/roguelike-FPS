using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 章节样板场景（每章一个，主题见 <see cref="ShowcaseTheme"/>）：广场 + 城门 + 城墙套件 + 集市 + 高台 + 远景崖壁与巨像，
    /// 中央一排角色（人形 / 非人形 / 英雄），第一人称枪与英雄手臂挂在相机上（F 切换）。
    /// 场景完全由代码生成（Spiritfire ▸ Showcase ▸ Build …），改布局改这里，不在场景里手摆。
    /// </summary>
    public static class ShowcaseSceneBuilder
    {
        public const string ScenePath = "Assets/Scenes/Showcase_Desert.unity";
        const string Dir = "Assets/Showcase";
        public const string FirstPersonLayer = "FirstPerson";
        /// <summary>角色（胶囊、布娃娃）：脚步 IK 的地面射线排除它，不会踩到别的角色身上</summary>
        public const string CharacterLayer = "Character";

        internal static GameObject Prefab(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            string path = AssetDatabase.FindAssets($"{id} t:Prefab", new[] { "Assets/Art/Prefabs" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .FirstOrDefault(p => Path.GetFileNameWithoutExtension(p) == id);
            return path == null ? null : AssetDatabase.LoadAssetAtPath<GameObject>(path);
        }

        internal static Bounds DesignBounds(string id)
        {
            var p = Prefab(id);
            var info = p ? p.GetComponent<ArtAssetInfo>() : null;
            return info ? info.designBounds : new Bounds(Vector3.up, Vector3.one * 2);
        }

        internal static GameObject Place(string id, Transform parent, Vector3 pos, float yaw = 0, float scale = 1)
        {
            if (string.IsNullOrEmpty(id)) return null;
            var prefab = Prefab(id);
            if (!prefab)
            {
                Debug.LogWarning($"[Showcase] 缺少 Prefab {id}（先 unity_export.py 导出，再 Spiritfire ▸ Art ▸ Sync All）");
                return null;
            }
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            go.transform.SetLocalPositionAndRotation(pos, Quaternion.Euler(0, yaw, 0));
            go.transform.localScale = Vector3.one * scale;
            return go;
        }

        [MenuItem("Spiritfire/Showcase/Build Desert Scene", priority = 20)]
        static void BuildDesert() => Build(ShowcaseTheme.Desert);

        [MenuItem("Spiritfire/Showcase/Build Frost Scene", priority = 21)]
        static void BuildFrost() => Build(ShowcaseTheme.Frost);

        [MenuItem("Spiritfire/Showcase/Build Inferno Scene", priority = 22)]
        static void BuildInferno() => Build(ShowcaseTheme.Inferno);

        [MenuItem("Spiritfire/Showcase/Build All Scenes", priority = 23)]
        public static void BuildAll()
        {
            foreach (var t in ShowcaseTheme.All) Build(t);
        }

        public static void Build() => Build(ShowcaseTheme.Desert);

        public static void Build(ShowcaseTheme theme)
        {
            ConfigureProject();
            MixamoLibrary.EnsureFolder(Dir);
            MixamoLibrary.EnsureFolder("Assets/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var env = new GameObject("Environment").transform;
            var props = new GameObject("Props").transform;
            var cast = new GameObject("Characters").transform;

            BuildLighting(theme);
            BuildGround(theme, env);
            BuildWalls(theme, env);
            BuildProps(theme, props);
            BuildTerrainTest(theme, env);
            var actors = BuildCharacters(theme, cast);
            var cam = BuildCameras(theme, out var fpRig);
            var vps = BuildViewpoints(actors);
            var sc = cam.gameObject.AddComponent<ShowcaseCamera>();
            sc.firstPersonRig = fpRig;
            sc.viewpoints = vps;
            sc.firstPerson = false;
            fpRig.SetActive(false);
            cam.transform.SetPositionAndRotation(vps.GetChild(0).position, vps.GetChild(0).rotation);

            EditorSceneManager.SaveScene(scene, theme.ScenePath);
            BakeEnvironmentLighting(theme);
            EditorSceneManager.SaveScene(scene, theme.ScenePath);
            var paths = ShowcaseTheme.All.Select(t => t.ScenePath).Where(File.Exists).ToList();
            EditorBuildSettings.scenes = paths.Select(p => new EditorBuildSettingsScene(p, true))
                .Concat(EditorBuildSettings.scenes.Where(s => !paths.Contains(s.path))).ToArray();
            Debug.Log($"[Showcase] {theme.title} 场景已生成：{theme.ScenePath}");
        }

        public static void BatchBuild()
        {
            BuildAll();
            EditorApplication.Exit(0);
        }

        // ───────────── 项目设置 ─────────────
        public static void ConfigureProject()
        {
            EnsureLayer(FirstPersonLayer, 6);
            EnsureLayer(CharacterLayer, 7);
            // I4：按图层剔除距离的两层（Spiritfire.Game.CullLayers，运行时按编号用，名字只是给人看）
            EnsureLayer(Spiritfire.Game.CullLayers.DetailName, Spiritfire.Game.CullLayers.Detail);
            EnsureLayer(Spiritfire.Game.CullLayers.ScatterName, Spiritfire.Game.CullLayers.Scatter);
            var assets = new HashSet<UniversalRenderPipelineAsset> { GraphicsSettings.defaultRenderPipeline as UniversalRenderPipelineAsset };
            for (int i = 0; i < QualitySettings.count; i++)
                assets.Add(QualitySettings.GetRenderPipelineAssetAt(i) as UniversalRenderPipelineAsset);
            foreach (var asset in assets)
            {
                if (!asset || asset.name.StartsWith("Mobile")) continue;
                asset.shadowDistance = 90f;
                asset.shadowCascadeCount = 4;
                asset.msaaSampleCount = 4;
                asset.supportsHDR = true;
                // I4（docs/performance-unity.md「GPU 常驻绘制与 GPU 遮挡剔除」）：两台机器实测 GPU 上都没收益、主线程反而贵 0.6–2 ms（这个项目的瓶颈在主线程），
                // GRD 也不认按图层的剔除距离 → 都关。要重新对照用 playtest perf-grd（测完还原）
                asset.gpuResidentDrawerMode = GPUResidentDrawerMode.Disabled;
                asset.gpuResidentDrawerEnableOcclusionCullingInCameras = false;
                EditorUtility.SetDirty(asset);
            }
            // Graphics 设置的 BatchRendererGroup Variants 回到默认（有 Entities Graphics 才保留）：GRD 关着就不用 Keep All，打包少编一批 DOTS 实例化变体。
            // 编辑器 API 只读，走序列化字段。要在编辑器里对照 GRD 时临时改成 Keep All（perf-grd 会提示）
            const int stripDefault = (int)UnityEditor.Rendering.BatchRendererGroupStrippingMode.KeepIfEntitiesGraphics;
            if (UnityEditor.Rendering.EditorGraphicsSettings.batchRendererGroupShaderStrippingMode != (UnityEditor.Rendering.BatchRendererGroupStrippingMode)stripDefault)
            {
                var gs = new SerializedObject(GraphicsSettings.GetGraphicsSettings());
                gs.FindProperty("m_BrgStripping").intValue = stripDefault;
                gs.ApplyModifiedPropertiesWithoutUndo();
            }
            AssetDatabase.SaveAssets();
        }

        public static void EnsureLayer(string name, int preferred)
        {
            var tm = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
            var layers = tm.FindProperty("layers");
            for (int i = 0; i < layers.arraySize; i++)
                if (layers.GetArrayElementAtIndex(i).stringValue == name) return;
            int slot = string.IsNullOrEmpty(layers.GetArrayElementAtIndex(preferred).stringValue) ? preferred : -1;
            for (int i = 8; slot < 0 && i < layers.arraySize; i++)
                if (string.IsNullOrEmpty(layers.GetArrayElementAtIndex(i).stringValue)) slot = i;
            layers.GetArrayElementAtIndex(slot).stringValue = name;
            tm.ApplyModifiedPropertiesWithoutUndo();
        }

        internal static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        internal static void SaveAsset(Object obj, string path)
        {
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(obj, path);
        }

        // ───────────── 光照与氛围 ─────────────
        internal static void BuildLighting(ShowcaseTheme t, string dir = Dir)
        {
            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = t.sunColor;
            sun.intensity = t.sunIntensity;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.9f;
            sun.transform.rotation = Quaternion.Euler(t.sunEuler);
            RenderSettings.sun = sun;

            Material sky;
            if (t.gradientSky)
            {
                sky = new Material(Shader.Find("Spiritfire/SkyGradient"));
                sky.SetColor("_TopColor", t.skyTop);
                sky.SetColor("_HorizonColor", t.skyHorizon);
                sky.SetColor("_BottomColor", t.skyBottom);
                sky.SetColor("_SunColor", t.sunColor);
                sky.SetFloat("_Exposure", t.skyExposure);
            }
            else
            {
                sky = new Material(Shader.Find("Skybox/Procedural"));
                sky.SetFloat("_SunSize", 0.035f);
                sky.SetFloat("_SunSizeConvergence", 6f);
                sky.SetFloat("_AtmosphereThickness", t.atmosphere);
                sky.SetColor("_SkyTint", t.skyTint);
                sky.SetColor("_GroundColor", t.skyGround);
                sky.SetFloat("_Exposure", t.skyExposure);
            }
            SaveAsset(sky, $"{dir}/SKY_{t.key}.mat");
            RenderSettings.skybox = sky;

            // 三色渐变环境光：天顶、地平线、地面反弹各取章节色——暗部的冷暖由它决定
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = t.ambientSky;
            RenderSettings.ambientEquatorColor = t.ambientEquator;
            RenderSettings.ambientGroundColor = t.ambientGround;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            RenderSettings.reflectionIntensity = 0.7f;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = t.fogColor;
            RenderSettings.fogStartDistance = t.fogStart;
            RenderSettings.fogEndDistance = t.fogEnd;

            // 先把 profile 存成资产，再加组件、逐个挂成它的子资产（PersistVolumeComponents）。
            // 以前是先 Add 再 CreateAsset：组件只活在内存里，.asset 里的 components 全是 {fileID: 0}，
            // 重开工程后色调映射 / Bloom / 调色整套丢失（docs/unity-parity.md 3.0）。
            string profilePath = $"{dir}/VP_{t.key}.asset";
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            SaveAsset(profile, profilePath);
            profile.Add<Tonemapping>(true).mode.Override(TonemappingMode.Neutral);
            var bloom = profile.Add<Bloom>(true);
            bloom.threshold.Override(t.bloomThreshold);
            bloom.intensity.Override(t.bloomIntensity);
            bloom.scatter.Override(0.65f);
            bloom.tint.Override(t.bloomTint);
            var color = profile.Add<ColorAdjustments>(true);
            color.postExposure.Override(t.postExposure);
            color.contrast.Override(t.contrast);
            color.saturation.Override(t.saturation);
            profile.Add<WhiteBalance>(true).temperature.Override(t.temperature);
            var vig = profile.Add<Vignette>(true);
            vig.intensity.Override(t.vignette);
            vig.smoothness.Override(0.45f);
            PersistVolumeComponents(profile);
            var vol = new GameObject("Global Volume").AddComponent<Volume>();
            vol.isGlobal = true;
            vol.sharedProfile = profile;
        }

        /// <summary>
        /// 把 VolumeProfile 里的组件挂成它的子资产并落盘（profile 必须已经是资产，见 <see cref="SaveAsset"/>）。
        /// <see cref="VolumeProfile.Add{T}"/> 只是 CreateInstance 一个组件放进 components 列表，不登记成子资产的话
        /// 存盘时引用写成 {fileID: 0}，重开工程后组件全部丢失。做法同编辑器自己的 Volume 面板：隐藏标记 + AddObjectToAsset。
        /// 存完从资产里数一遍组件，对不上直接报错——不留一个「这次看着正常、重开就没了」的 profile。
        /// </summary>
        internal static void PersistVolumeComponents(VolumeProfile profile)
        {
            string path = AssetDatabase.GetAssetPath(profile);
            if (string.IsNullOrEmpty(path))
            {
                Debug.LogError($"[Showcase] VolumeProfile {profile.name} 还不是资产：先 SaveAsset 再加组件，否则组件存不进去");
                return;
            }
            foreach (var c in profile.components)
            {
                if (!c || AssetDatabase.Contains(c)) continue;
                c.name = c.GetType().Name;
                c.hideFlags = HideFlags.HideInInspector | HideFlags.HideInHierarchy;
                AssetDatabase.AddObjectToAsset(c, profile);
            }
            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
            int saved = AssetDatabase.LoadAllAssetsAtPath(path).OfType<VolumeComponent>().Count();
            if (saved != profile.components.Count)
                Debug.LogError($"[Showcase] {path}：profile 有 {profile.components.Count} 个后处理组件，资产里只存下 {saved} 个");
        }

        internal static void BakeEnvironmentLighting(ShowcaseTheme t, string dir = Dir)
        {
            // 场景里没有参与 GI 的静态物体：烘焙只生成环境球谐与天空反射，几秒完成
            var ls = new LightingSettings { bakedGI = false, realtimeGI = false };
            SaveAsset(ls, $"{dir}/LS_{t.key}.lighting");
            Lightmapping.lightingSettings = ls;
            Lightmapping.Bake();
        }

        // ───────────── 地面 ─────────────
        static void BuildGround(ShowcaseTheme t, Transform parent)
        {
            string bcPath = $"{Dir}/T_Showcase_{t.key}Ground_BC.png";
            string ePath = $"{Dir}/T_Showcase_{t.key}Ground_E.png";
            bool lava = t.groundPattern == ShowcaseTheme.GroundPattern.LavaCracks;
            
            {
                const int n = 512;
                var px = new Color[n * n];
                var em = lava ? new Color[n * n] : null;
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float u = x / (float)n, v = y / (float)n;
                    float blot = 0.6f * Tile(u, v, 4) + 0.4f * Tile(u, v, 9);
                    float stroke = t.groundPattern switch
                    {
                        // 沙：斜向沙纹；雪：大块柔和堆积；熔火：玄武岩碎块
                        ShowcaseTheme.GroundPattern.Ripples => Mathf.Sin((u * 2 + v) * Mathf.PI * 2 * 7 + Tile(u, v, 6) * 4f) * 0.5f + 0.5f,
                        ShowcaseTheme.GroundPattern.Drifts => Tile(u, v, 3),
                        _ => Tile(u, v, 12),
                    };
                    // 笔触只是轻微的纹理（沙纹太强会变成条纹地毯）
                    float k = Mathf.Clamp01(blot * 0.92f + stroke * 0.08f);
                    px[y * n + x] = Color.Lerp(t.groundA, t.groundB, Smooth(0.25f, 0.75f, k));
                    if (lava)
                    {
                        // 岩浆裂纹：两层噪声的等值线，越靠近线越亮
                        float c1 = Mathf.Abs(Tile(u, v, 3) - 0.5f), c2 = Mathf.Abs(Tile(u, v, 8) - 0.5f);
                        float crack = Mathf.Max(1 - Smooth(0.003f, 0.012f, c1), 0.45f * (1 - Smooth(0.001f, 0.005f, c2)));
                        em[y * n + x] = new Color(crack, crack, crack);
                        px[y * n + x] = Color.Lerp(px[y * n + x], new Color(0.45f, 0.15f, 0.05f), crack * 0.8f);
                    }
                }
                WriteTexture(bcPath, px, n);
                if (lava) WriteTexture(ePath, em, n);
            }
            var mat = new Material(Shader.Find(ArtPrefabBuilder.ShaderName));
            mat.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(bcPath));
            mat.SetTextureScale("_BaseMap", new Vector2(36, 36));
            mat.SetFloat("_Metallic", 0);
            mat.SetFloat("_Roughness", 1);
            mat.SetFloat("_RimStrength", 0);
            mat.SetFloat("_SpecStrength", 0);
            mat.SetColor("_ShadowTint", t.groundShadowTint);
            mat.SetFloat("_ShadowLift", 0.2f);
            if (lava)
            {
                mat.SetTexture("_EmissionMap", AssetDatabase.LoadAssetAtPath<Texture2D>(ePath));
                mat.SetColor("_EmissionColor", t.lavaColor);
                mat.EnableKeyword("_EMISSION");
            }
            SaveAsset(mat, $"{Dir}/M_Showcase_{t.key}Ground.mat");
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.SetParent(parent);
            ground.transform.localScale = new Vector3(36, 1, 36);
            ground.GetComponent<MeshRenderer>().sharedMaterial = mat;
            GameObjectUtility.SetStaticEditorFlags(ground, StaticEditorFlags.BatchingStatic);
        }

        static void WriteTexture(string path, Color[] px, int n)
        {
            var tex = new Texture2D(n, n, TextureFormat.RGB24, true);
            tex.SetPixels(px);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);
        }

        /// <summary>GLSL 语义的 smoothstep（Mathf.SmoothStep 是插值，不是阶梯）。</summary>
        static float Smooth(float e0, float e1, float x)
        {
            float k = Mathf.Clamp01((x - e0) / (e1 - e0));
            return k * k * (3 - 2 * k);
        }

        static float Tile(float u, float v, int freq)
        {
            // 四角双线性混合的 Perlin，保证贴图无缝
            float s = freq;
            float f(float x, float y) => Mathf.PerlinNoise(x * s + 13.1f, y * s + 7.7f);
            return f(u, v) * (1 - u) * (1 - v) + f(u - 1, v) * u * (1 - v) + f(u, v - 1) * (1 - u) * v + f(u - 1, v - 1) * u * v;
        }

        // ───────────── 城墙与远景 ─────────────
        const float Half = 28f; // 广场半宽（角楼位置）

        /// <summary>
        /// 城墙套件沿局部 +X 拼接：右端头 + n 块墙板 + 左端头，铺满 [from, to]。墙板宽、端头宽取自各自的设计包围盒，
        /// 端头的几何本身就偏在墙板两侧（与墙板共用原点），所以放在首尾墙板的位置上。
        /// </summary>
        static void WallRun(ShowcaseTheme t, Transform parent, string name, Vector3 origin, float yaw, float from, float to)
        {
            float w = DesignBounds(t.panel).size.x;
            float eR = DesignBounds(t.endR).size.x, eL = DesignBounds(t.endL).size.x;
            int n = Mathf.Max(1, Mathf.RoundToInt((to - from - eR - eL) / w));
            float p0 = from + eR + w * 0.5f;
            var run = new GameObject(name).transform;
            run.SetParent(parent);
            run.SetLocalPositionAndRotation(origin, Quaternion.Euler(0, yaw, 0));
            for (int i = 0; i < n; i++)
                Place(i % 3 == 1 && Prefab(t.plainPanel) ? t.plainPanel : t.panel, run, new Vector3(p0 + i * w, 0, 0));
            Place(t.endR, run, new Vector3(p0, 0, 0));
            Place(t.endL, run, new Vector3(p0 + (n - 1) * w, 0, 0));
        }

        static void BuildWalls(ShowcaseTheme t, Transform parent)
        {
            var walls = new GameObject("Walls").transform;
            walls.SetParent(parent);
            Place(t.gateway, walls, new Vector3(0, 0, Half), 180);
            float g = DesignBounds(t.gateway).size.x * 0.5f;
            WallRun(t, walls, "North West", new Vector3(0, 0, Half), 0, -Half, -g);
            WallRun(t, walls, "North East", new Vector3(0, 0, Half), 0, g, Half);
            WallRun(t, walls, "West", new Vector3(-Half, 0, 0), -90, -14, Half - 4);
            WallRun(t, walls, "East", new Vector3(Half, 0, 0), 90, -(Half - 4), 14);
            Place(t.cornerTower, walls, new Vector3(-Half, 0, Half), 135);
            Place(t.cornerTower, walls, new Vector3(Half, 0, Half), -135);

            var far = new GameObject("Vista").transform;
            far.SetParent(parent);
            Place(t.statue, far, new Vector3(0, 0, 52), 180, t.statueScale);
            float c = t.cliffScale;
            Place(t.cliff, far, new Vector3(-44, 0, 6), 90, 1.6f * c);
            Place(t.cliff, far, new Vector3(46, 0, 12), -90, 1.8f * c);
            Place(t.cliff, far, new Vector3(-30, 0, 50), 25, 1.5f * c);
            Place(t.cliff, far, new Vector3(32, 0, 54), -30, 1.7f * c);
            Place(t.cliff, far, new Vector3(0, 0, 78), 180, 2.4f * c);
            Place(t.cliff, far, new Vector3(-40, 0, -40), 140, 1.6f * c);
            Place(t.cliff, far, new Vector3(42, 0, -36), -140, 1.6f * c);
            Place(t.farWallPlain, far, new Vector3(-16, 0, 40), 8);
            Place(t.farWall, far, new Vector3(17, 0, 41), -6);
        }

        // ───────────── 场景件 ─────────────
        static void BuildProps(ShowcaseTheme t, Transform parent)
        {
            float fireY = DesignBounds(t.brazier).size.y * 0.95f;
            foreach (int s in new[] { -1, 1 })
            {
                Place(t.column, parent, new Vector3(7.5f * s, 0, -6));
                Place(t.column, parent, new Vector3(7.5f * s, 0, 6));
                Place(t.column, parent, new Vector3(7.5f * s, 0, 18));
                if (Place(t.brazier, parent, new Vector3(5f * s, 0, 23))) Fire(t, parent, new Vector3(5f * s, fireY, 23));
            }
            Place(t.columnRuin, parent, new Vector3(10.5f, 0, -13), 32);
            Place(t.barricade, parent, new Vector3(5.5f, 0, -2.5f), 12);
            Place(t.coverWall, parent, new Vector3(-4.5f, 0, -10), -14);

            // 集市（西侧）
            Place(t.stall, parent, new Vector3(-16, 0, 0), 90);
            Place(t.goods, parent, new Vector3(-13.6f, 0, 3.2f), 20);
            Place(t.goods, parent, new Vector3(-17.5f, 0, -3.6f), -50, 0.9f);
            Place(t.hoard, parent, new Vector3(-13.2f, 0, -3), 70);
            if (Place(t.brazier, parent, new Vector3(-12, 0, 6.5f))) Fire(t, parent, new Vector3(-12, fireY, 6.5f));

            // 高台与神龛（东侧）：台阶放在高台南沿
            var plat = DesignBounds(t.platform);
            var stair = DesignBounds(t.stairs);
            Place(t.platform, parent, new Vector3(16, 0, 8));
            Place(t.stairs, parent, new Vector3(16, 0, 8 + plat.min.z - stair.size.z * 0.5f + 0.2f), 180);
            Place(t.shrine, parent, new Vector3(17, 0, 19), -35);
            Place(t.landmark, parent, new Vector3(-17, 0, 16), 24);

            Place(t.rock, parent, new Vector3(-20, 0, -15), 40, 1.2f);
            Place(t.rock, parent, new Vector3(21, 0, -9), 160, 1.4f);
            Place(t.rock, parent, new Vector3(-9, 0, 20), 75, 0.8f);
            Place(t.rock, parent, new Vector3(12, 0, -21), -20, 1f);
        }

        /// <summary>
        /// 脚步 IK 的验证地形：角色排前面一块约 8° 的缓坡（角色朝镜头走圈，大半圈在坡上）。
        /// 平地上看不出 IK 的作用，坡上脚应当贴着表面、骨盆随之升降，而不是悬空 / 插进地里。
        /// </summary>
        static void BuildTerrainTest(ShowcaseTheme t, Transform parent)
        {
            var mat = AssetDatabase.LoadAssetAtPath<Material>($"{Dir}/M_Showcase_{t.key}Ground.mat");
            var root = new GameObject("Terrain Test").transform;
            root.SetParent(parent);
            const float slope = 7.8f;
            var ramp = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ramp.name = "Ramp";
            ramp.transform.SetParent(root);
            ramp.transform.SetLocalPositionAndRotation(new Vector3(0, 0.02f, 3.0f), Quaternion.Euler(slope, 0, 0));
            ramp.transform.localScale = new Vector3(26, 0.4f, 3.6f);
            foreach (var r in root.GetComponentsInChildren<MeshRenderer>())
            {
                if (mat) r.sharedMaterial = mat;
                GameObjectUtility.SetStaticEditorFlags(r.gameObject, StaticEditorFlags.BatchingStatic);
            }
        }

        static void Fire(ShowcaseTheme t, Transform parent, Vector3 pos)
        {
            var l = new GameObject("Brazier Light").AddComponent<Light>();
            l.transform.SetParent(parent);
            l.transform.localPosition = pos;
            l.type = LightType.Point;
            l.color = t.fireColor;
            l.intensity = t.fireIntensity;
            l.range = 9f;
            l.shadows = LightShadows.None;
        }

        // ───────────── 角色 ─────────────
        /// <summary>中央一排，按设计包围盒宽度自动排开、整体居中，全部面朝镜头（−Z）。</summary>
        static List<Transform> BuildCharacters(ShowcaseTheme t, Transform parent)
        {
            const float gap = 1.3f, z = 4.5f;
            var entries = t.actors.Where(a => Prefab(a.id)).ToList();
            foreach (var a in t.actors.Where(a => !Prefab(a.id)))
                Debug.LogWarning($"[Showcase] {t.key}: 缺少角色 {a.id}");
            var widths = entries.Select(a => Mathf.Max(0.6f, DesignBounds(a.id).size.x)).ToList();
            float total = widths.Sum() + gap * (widths.Count - 1);
            float x = -total * 0.5f;
            var placed = new List<Transform>();
            for (int i = 0; i < entries.Count; i++)
            {
                var (id, hover) = entries[i];
                var go = Place(id, parent, new Vector3(x + widths[i] * 0.5f, hover, z + DesignBounds(id).size.z * 0.3f), 180);
                x += widths[i] + gap;
                if (!go) continue;
                var info = go.GetComponent<ArtAssetInfo>();
                var anim = go.GetComponentInChildren<Animator>();
                go.AddComponent<ShowcaseActor>().mode = anim && anim.runtimeAnimatorController ? ShowcaseActor.Mode.Cycle : ShowcaseActor.Mode.Idle;
                placed.Add(go.transform);
            }
            // 章节 Boss：城门前空地，面向镜头，演示周期拉长（招式多、动作慢）
            if (!string.IsNullOrEmpty(t.boss) && Place(t.boss, parent, new Vector3(0, 0, 15.5f), 180) is { } boss)
            {
                var ba = boss.AddComponent<ShowcaseActor>();
                ba.cycleSeconds = 12f;
                ba.walkRadius = 3f;
                placed.Add(boss.transform);
            }
            // 挂件（琵琶、龟甲、镜子、火球…）：按 bind 找绑在该角色上的挂件 Prefab，挂到同名挂点 socket_<挂点> 下——
            // 挂点由采样来的动作驱动，跟游戏里一样随手势 / 招式运动。英雄把初始武器挂到持枪点 socket_hand。
            var parts = AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/Art/Prefabs" })
                .Select(g => AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(g)))
                .Select(p => (prefab: p, info: p.GetComponent<ArtAssetInfo>()))
                .Where(x => x.info && !string.IsNullOrEmpty(x.info.bindAttachment)).ToList();
            foreach (var actor in placed)
            {
                if (!actor.TryGetComponent<ArtAssetInfo>(out var ai)) continue;
                foreach (var (prefab, info) in parts.Where(x => x.info.bindSource == ai.bindSource && x.info.bindId == ai.bindId))
                {
                    var socket = FindDeep(actor, NativeClipBuilder.SocketPrefix + info.bindAttachment);
                    if (socket) PrefabUtility.InstantiatePrefab(prefab, socket);
                }
                if (ai.bindSource == "hero" && HeroWeapon.TryGetValue(ai.bindId, out var gun) && FindDeep(actor, NativeClipBuilder.SocketPrefix + "hand") is { } hand)
                {
                    var g = Place(gun, hand, Vector3.zero);
                    if (g) foreach (var c in g.GetComponentsInChildren<Collider>()) Object.DestroyImmediate(c);
                }
            }
            return placed;
        }

        /// <summary>英雄的初始武器（src/player/skills/*.ts 的 startingWeapon）</summary>
        static readonly Dictionary<string, string> HeroWeapon = new()
        {
            ["fox"] = "SK_Weapon_Smg", ["bear"] = "SK_Weapon_Shotgun", ["falcon"] = "SK_Weapon_Revolver",
        };

        static Transform FindDeep(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true)) if (t.name == name) return t;
            return null;
        }

        // ───────────── 相机与第一人称 ─────────────
        internal static Camera BuildCameras(ShowcaseTheme t, out GameObject fpRig)
        {
            int fpLayer = LayerMask.NameToLayer(FirstPersonLayer);
            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 70f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 600f;
            cam.cullingMask = ~(1 << fpLayer);
            camGo.AddComponent<AudioListener>();
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;

            // 枪模相机：叠加在主相机上，竖直视角 60°（与 Three.js 版 viewCamera 一致），只渲染 FirstPerson 层
            var vmGo = new GameObject("Viewmodel Camera");
            vmGo.transform.SetParent(camGo.transform, false);
            var vm = vmGo.AddComponent<Camera>();
            vm.fieldOfView = 60f;
            vm.nearClipPlane = 0.01f;
            vm.farClipPlane = 20f;
            vm.cullingMask = 1 << fpLayer;
            var vmData = vm.GetUniversalAdditionalCameraData();
            vmData.renderType = CameraRenderType.Overlay;
            vmData.renderShadows = false;
            vmData.renderPostProcessing = true;
            data.cameraStack.Add(vm);

            fpRig = BuildFirstPerson(t, camGo.transform, fpLayer);
            return cam;
        }

        /// <summary>
        /// 枪模坐标：枪管朝 Unity −Z（与 Three.js 相机前方一致，导入后 X 翻转），所以枪模绕 Y 转 180° 挂在相机下，
        /// 腰射位置取 Three.js 版 revolver.viewOffset + HIP_SHIFT，缩放取 VM_SCALE。
        /// 手臂在枪模坐标里：右手 = 握把处（handling.right），左手 = 托底握点（handling.support、leftRoll），X 取反、绕 Z 的转角取反。
        /// </summary>
        static GameObject BuildFirstPerson(ShowcaseTheme t, Transform cam, int layer)
        {
            var rig = new GameObject("First Person Rig");
            rig.transform.SetParent(cam, false);
            var vm = rig.AddComponent<FirstPersonViewmodel>();
            rig.transform.localPosition = vm.hipOffset;
            rig.transform.localRotation = Quaternion.Euler(0, 180, 0);

            // Three.js 版 VM_SCALE = 0.76（手臂是枪模的子节点，一起缩放）
            var gun = Place(t.weapon, rig.transform, Vector3.zero, 0, 0.76f);
            if (gun)
            {
                var r = Place(t.armR, gun.transform, new Vector3(0, -0.003f, 0));
                if (r) r.transform.localRotation = Quaternion.Euler(-0.02f * Mathf.Rad2Deg, 0, 0);
                var l = Place(t.armL, gun.transform, new Vector3(0.034f, -0.04f, 0.035f));
                if (l) l.transform.localRotation = Quaternion.Euler(0, 0, -0.65f * Mathf.Rad2Deg);
            }
            // 第一人称只用 LOD0、不投影、不进世界碰撞
            foreach (var lg in rig.GetComponentsInChildren<LODGroup>(true))
            {
                var lods = lg.GetLODs();
                for (int i = 1; i < lods.Length; i++)
                    foreach (var rr in lods[i].renderers) if (rr) rr.enabled = false;
                Object.DestroyImmediate(lg);
            }
            foreach (var c in rig.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
            foreach (var rr in rig.GetComponentsInChildren<Renderer>(true)) rr.shadowCastingMode = ShadowCastingMode.Off;
            SetLayer(rig, layer);
            return rig;
        }

        // ───────────── 机位（数字键 1–9 / 审核截图）─────────────
        static Transform BuildViewpoints(List<Transform> actors)
        {
            // 「大体型特写」对准角色排里最大的一个
            static float Height(Transform a) => a.TryGetComponent<ArtAssetInfo>(out var i) ? i.designBounds.size.y : 0f;
            var big = actors.OrderByDescending(Height).FirstOrDefault();
            var bigPos = big ? big.position : new Vector3(4.6f, 0, 5);
            float bigH = big ? Mathf.Max(1f, Height(big)) : 3f;
            var views = new (string name, Vector3 pos, Vector3 target)[]
            {
                ("Overview", new Vector3(0, 10, -32), new Vector3(0, 3, 10)),
                ("Characters", new Vector3(0, 1.7f, -4.2f), new Vector3(0, 1.2f, 4.5f)),
                ("Gate", new Vector3(0, 2, 6), new Vector3(0, 6.5f, Half)),
                ("Market", new Vector3(-6, 1.7f, -5), new Vector3(-14.5f, 1.4f, 1)),
                ("Platform", new Vector3(5, 2.2f, -1), new Vector3(16, 3, 13)),
                ("Far LOD", new Vector3(0, 22, -95), new Vector3(0, 4, 12)),
                ("Creature Close", bigPos + new Vector3(-2.4f, bigH * 0.7f, -bigH * 1.3f - 1f), bigPos + Vector3.up * bigH * 0.5f),
                ("First Person", new Vector3(0, 1.6f, -8), new Vector3(0, 1.6f, 10)),
            };
            var root = new GameObject("Viewpoints").transform;
            foreach (var (name, pos, target) in views)
            {
                var tr = new GameObject(name).transform;
                tr.SetParent(root);
                tr.SetPositionAndRotation(pos, Quaternion.LookRotation(target - pos, Vector3.up));
            }
            return root;
        }
    }
}
