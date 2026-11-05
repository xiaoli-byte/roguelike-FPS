using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Art.Editor.Levels
{
    public static partial class Level_3_3
    {
        static readonly Vector2 FireGodSpire = new(152, 215);
        static Vector3 FireGodRing => new(Basin.x, 31f, Basin.y);
        const float FireGodFallTop = 65f;

        /// <summary>
        /// 3-3 的天：在第三章主题（暗紫靛烟天顶、贴地平线一窄条暖橙）上往参考图（user_ref_throne_of_fire_god.png）偏一点——
        /// 地平线的暖橙烟雾带比主题宽（地平线锐度 6、辉光 0.5，主题是 14 / 0.5），天顶是带一点紫褐的靛紫；雾是暖一点的紫褐烟（远处的岩塔、岩峰隐进暖烟里，像参考图），
        /// 近处的岩和地仍是主题的冷暗紫——冷暖对比在「近冷远暖」。王座视角的暖意再加上王座的局部调色（色温 +12、饱和 +10）和熔岩柱、圆环、熔渠；
        /// 提亮靠熔岩点光和暖烟，不靠曝光。环境光的地面一侧是熔岩盆地的暖反光；暗部仍是紫，不是死黑。
        /// 主光 / 环境光的强弱跟主题一个思路：主光定阴影形状，环境光只托住暗部（明度要拉得开，不靠曝光提亮）。
        /// 2026-11-04 美术清理：以前是整片饱和红天（天顶 0.18/0.07/0.12、地平线 0.58/0.19/0.09、曝光 1.2）+ 橙色主光 + 红褐雾，非王座区一片浑红
        /// </summary>
        static void ConfigureFireGodSky()
        {
            if (RenderSettings.skybox && RenderSettings.skybox.shader.name == "Spiritfire/SkyGradient")
            {
                RenderSettings.skybox.SetColor("_TopColor", new Color(0.15f, 0.1f, 0.2f));
                RenderSettings.skybox.SetColor("_HorizonColor", new Color(0.62f, 0.28f, 0.14f));
                RenderSettings.skybox.SetColor("_BottomColor", new Color(0.12f, 0.08f, 0.12f));
                // 烟里的太阳只是一团暗暖光晕（不是 HDR 白盘：抬头时它会是画面里最亮的东西，抢了怪）
                RenderSettings.skybox.SetColor("_SunColor", new Color(0.22f, 0.13f, 0.08f));
                RenderSettings.skybox.SetFloat("_HorizonSharpness", 6f);
                RenderSettings.skybox.SetFloat("_HorizonGlow", 0.5f);
                RenderSettings.skybox.SetFloat("_Exposure", 1f);
            }
            if (RenderSettings.sun)
            {
                RenderSettings.sun.color = new Color(0.93f, 0.84f, 0.84f);
                RenderSettings.sun.intensity = 1.4f;
            }
            RenderSettings.ambientSkyColor = new Color(0.2f, 0.17f, 0.3f);
            RenderSettings.ambientEquatorColor = new Color(0.25f, 0.18f, 0.24f);
            RenderSettings.ambientGroundColor = new Color(0.38f, 0.19f, 0.11f);
            RenderSettings.fogColor = new Color(0.3f, 0.18f, 0.21f);
            RenderSettings.fogStartDistance = 40f;
            RenderSettings.fogEndDistance = 320f;
        }

        static void ConfigureFireGodBackdrop(LevelKit.BackdropSpec backdrop)
        {
            // 远山：暗紫剪影压在暖橙烟雾带前面，峰顶一点被火光照到的暖紫
            backdrop.silhouette = new Color(0.13f, 0.09f, 0.15f);
            backdrop.top = new Color(0.27f, 0.15f, 0.18f);
            backdrop.horizon = RenderSettings.fogColor;
            backdrop.rings = new[]
            {
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 420, height = 75, haze = 0.24f, freq = 19, seed = 31 },
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 650, height = 140, haze = 0.46f, freq = 15, seed = 37 },
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 900, height = 230, haze = 0.68f, freq = 11, seed = 43 },
            };
        }

        /// <summary>参考图的单塔、单环、单柱；Model 子物体可分别替换王座和圆环的程序化体块。</summary>
        static GameObject BuildFireGodThrone(LevelKit.TerrainSet set, Transform parent)
        {
            var root = new GameObject("FireGodThrone").transform;
            root.SetParent(parent, false);
            var controller = root.gameObject.AddComponent<FireGodThrone>();
            // 岩塔：第三章的暗紫玄武岩（偏暖一点的主塔 / 偏靛的侧刃和岩峰）——像参考图那样是一大块暗剪影，边缘被熔岩照亮（橙色边缘光 + 王座的轮廓点光），暗部偏紫不发黑
            var basalt = LevelKit.Mat(Dir, "FireGodBasalt", new Color(0.2f, 0.14f, 0.18f), 0.94f);
            var basaltCool = LevelKit.Mat(Dir, "FireGodBasaltCool", new Color(0.16f, 0.13f, 0.2f), 0.96f);
            foreach (var rock in new[] { basalt, basaltCool })
            {
                rock.SetColor("_RimColor", new Color(1f, 0.3f, 0.07f));
                rock.SetFloat("_RimStrength", 0.9f);
                rock.SetFloat("_RimPower", 2.2f);
                rock.SetFloat("_ShadowLift", 0.4f);
                rock.SetColor("_ShadowTint", new Color(0.42f, 0.3f, 0.5f));
            }

            var throne = Anchor("Throne", root, new Vector3(FireGodSpire.x, 22f, FireGodSpire.y));
            var throneProcedural = Anchor("Procedural", throne, Vector3.zero);
            NewMeshObject("王座主尖塔", throneProcedural, CragMesh(17f, 46f, 71, 0.82f), basalt,
                $"{Dir}/Throne/Mesh_FireGodThrone.asset");
            foreach (var (at, radius, height, seed) in new[]
                     {
                         (new Vector3(-12, -1, 2), 8f, 38f, 73), (new Vector3(12, 0, 3), 8.5f, 41f, 79),
                         (new Vector3(-7, -3, -5), 6f, 30f, 83), (new Vector3(8, -2, -4), 6.5f, 33f, 89),
                     })
                NewMeshObject("王座侧刃", throneProcedural, CragMesh(radius, height, seed, 0.8f), basaltCool,
                    $"{Dir}/Throne/Mesh_FireGodBlade_{seed}.asset").transform.localPosition = at;
            var crackMat = LevelKit.GlowMat(Dir, "FireGodCracks", new Color(1f, 0.28f, 0.025f), new Color(4.5f, 0.85f, 0.08f));
            foreach (var (at, height, width, seed) in new[]
                     {
                         (new Vector3(-6f, 4f, -12.5f), 25f, 0.18f, 211), (new Vector3(-2f, 8f, -12.5f), 31f, 0.24f, 223),
                         (new Vector3(3f, 3f, -12.5f), 23f, 0.16f, 227), (new Vector3(7f, 6f, -12.5f), 27f, 0.2f, 229),
                     })
                NewMeshObject("王座熔岩裂缝", throneProcedural, CrackMesh(height, width, seed), crackMat,
                    $"{Dir}/Throne/Mesh_FireGodCrack_{seed}.asset").transform.localPosition = at;

            foreach (var (at, radius, height, seed) in new[]
                     {
                         (new Vector2(126, 213), 8f, 31f, 101), (new Vector2(137, 220), 7f, 38f, 103),
                         (new Vector2(169, 220), 8f, 41f, 107), (new Vector2(181, 214), 9f, 32f, 109),
                         (new Vector2(196, 207), 8f, 27f, 113), (new Vector2(204, 185), 7f, 25f, 127),
                         (new Vector2(204, 155), 6f, 22f, 131), (new Vector2(204, 130), 8f, 27f, 137),
                     })
            {
                var at3 = set.OnGround(at.x, at.y, -1f);
                NewMeshObject("火山口锯齿岩峰", root, CragMesh(radius, height, seed, 0.78f), basaltCool,
                    $"{Dir}/Throne/Mesh_FireGodCrag_{seed}.asset").transform.position = at3;
            }
            foreach (var (at, radius, height, seed) in new[]
                     {
                         (new Vector2(108, 120), 4.5f, 6f, 139), (new Vector2(194, 118), 5f, 7.5f, 149),
                         (new Vector2(107, 151), 3.5f, 5f, 151),
                     })
            {
                var at3 = set.OnGround(at.x, at.y, -0.6f);
                NewMeshObject("前景暗岩", root, CragMesh(radius, height, seed, 0.85f), basalt,
                    $"{Dir}/Throne/Mesh_FireGodFore_{seed}.asset").transform.position = at3;
            }

            var ring = Anchor("Ring", root, FireGodRing);
            ring.localRotation = Quaternion.Euler(0, 35f, 0);
            var ringProcedural = Anchor("Procedural", ring, Vector3.zero);
            NewMeshObject("圆环玄武岩暗衬", ringProcedural, RingMesh(5.2f, 0.88f),
                LevelKit.Mat(Dir, "FireGodRingBacking", new Color(0.16f, 0.08f, 0.09f), 0.94f),
                $"{Dir}/Throne/Mesh_FireGodRingBacking.asset").transform.localPosition = new Vector3(0, 0, 0.75f);
            NewMeshObject("熔岩圆环", ringProcedural, RingMesh(5.2f, 0.68f),
                LevelKit.GlowMat(Dir, "FireGodRing", new Color(1f, 0.38f, 0.04f), new Color(6f, 1.5f, 0.18f)),
                $"{Dir}/Throne/Mesh_FireGodRing.asset").transform.localPosition = new Vector3(0, 0, -0.65f);

            var fallRoot = Anchor("Lava Fall", root, new Vector3(Basin.x, ArenaLava - 0.2f, Basin.y));
            var fallMat = new Material(LevelKit.LavaMaterial()) { name = "M_FireGodFall" };
            fallMat.SetColor("_DeepColor", new Color(0.65f, 0.045f, 0.008f));
            fallMat.SetColor("_HotColor", new Color(1f, 0.12f, 0.005f));
            fallMat.SetColor("_CoreColor", new Color(1f, 0.88f, 0.55f));
            fallMat.SetFloat("_Emission", 2.2f);
            fallMat.SetFloat("_MoltenAmount", 0.9f);
            fallMat.SetFloat("_CrackWidth", 0.045f);
            fallMat.SetFloat("_NoiseScale", 0.17f);
            fallMat.SetFloat("_PlateScale", 0.18f);
            fallMat.SetFloat("_ShoreWidth", 0f);
            fallMat.SetFloat("_ShoreDepth", 0f);
            fallMat.SetFloat("_BubbleRate", 0.35f);
            LevelKit.SaveAsset(fallMat, $"{Dir}/M_WB_FireGodFall.mat");
            var fall = NewMeshObject("FireGodThrone · 熔岩柱", fallRoot,
                FallMesh(FireGodFallTop - ArenaLava + 0.2f), fallMat, $"{Dir}/Lava/Mesh_FireGodFall_1.asset");
            fall.isStatic = false;
            for (int i = 0; i < 2; i++)
            {
                var splash = NewMeshObject("熔岩落点飞溅环", fallRoot, RingMesh(1.8f + i * 1.4f, 0.12f), crackMat,
                    $"{Dir}/Throne/Mesh_FireGodSplash_{i + 1}.asset");
                splash.transform.localPosition = new Vector3(0, 0.2f + i * 0.08f, 0);
                splash.transform.localRotation = Quaternion.Euler(90, 0, 0);
            }
            for (int i = 0; i < 14; i++)
            {
                float a = i * Mathf.PI * 2f / 14f;
                float r = Mathf.Lerp(1.2f, 3.8f, Landform.Hash(i, 4, 251));
                var spark = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                spark.name = "熔岩落点火星";
                spark.transform.SetParent(fallRoot, false);
                spark.transform.localPosition = new Vector3(Mathf.Cos(a) * r, Mathf.Lerp(0.4f, 3.4f, Landform.Hash(i, 6, 251)), Mathf.Sin(a) * r);
                spark.transform.localScale = new Vector3(0.14f, 0.34f, 0.14f) * Mathf.Lerp(0.7f, 1.4f, Landform.Hash(i, 8, 251));
                Object.DestroyImmediate(spark.GetComponent<Collider>());
                spark.GetComponent<MeshRenderer>().sharedMaterial = crackMat;
            }

            var ringLight = LightAt(root, "FireGodThrone · 圆环光", FireGodRing, 6f, 48f);
            var fallLight = LightAt(root, "FireGodThrone · 熔瀑落点光", new Vector3(Basin.x, 4f, Basin.y), 10f, 55f);
            // 王座区的亮度靠这几盏熔岩光（2026-11-04 美术清理：以前靠局部 Volume 把整片盆地曝光 +0.65 提亮，现在局部 Volume 不动曝光，跟章节底色一样，
            // 岩塔边缘、王座正面和三条熔渠的岸由点光照亮——亮的是熔岩照到的地方，暗部仍是大块暗剪影，和参考图一样）
            LightAt(root, "FireGodThrone · 王座左轮廓光", new Vector3(139, 10, 199), 40f, 66f);
            LightAt(root, "FireGodThrone · 王座右轮廓光", new Vector3(165, 12, 200), 40f, 66f);
            LightAt(root, "FireGodThrone · 王座正面反光", new Vector3(152, 28, 190), 24f, 64f);
            LightAt(root, "FireGodThrone · 塔顶逆光", new Vector3(152, 48, 211), 22f, 50f);
            LightAt(root, "FireGodThrone · 南渠反光", new Vector3(152, 2, 140), 5.5f, 32f);
            LightAt(root, "FireGodThrone · 西渠反光", new Vector3(136, 2, 164), 5.5f, 32f);
            LightAt(root, "FireGodThrone · 东渠反光", new Vector3(168, 2, 164), 5.5f, 32f);
            controller.throne = throne;
            controller.ring = ring;
            controller.throneProcedural = throneProcedural;
            controller.ringProcedural = ringProcedural;
            controller.fallRoot = fallRoot;
            controller.fallRenderers = new Renderer[] { fall.GetComponent<MeshRenderer>() };
            controller.ringLight = ringLight;
            controller.fallLight = fallLight;
            var air = root.gameObject.AddComponent<FireGodAtmosphere>();
            air.smokeAt = new Vector3(FireGodSpire.x, 54f, FireGodSpire.y);
            air.embersAt = new Vector3(Basin.x, 0f, Basin.y);
            air.emberRate = 7f;
            var rumbleAt = new GameObject("FireGodThrone · 熔岩轰鸣").transform;
            rumbleAt.SetParent(root, false);
            rumbleAt.localPosition = new Vector3(Basin.x, 16f, Basin.y);
            var rumble = rumbleAt.gameObject.AddComponent<AudioSource>();
            rumble.clip = Resources.Load<AudioClip>("Audio/Music/amb_inferno");
            rumble.loop = true;
            rumble.playOnAwake = true;
            rumble.volume = 0.32f;
            rumble.spatialBlend = 0.85f;
            rumble.rolloffMode = AudioRolloffMode.Logarithmic;
            rumble.minDistance = 9f;
            rumble.maxDistance = 85f;

            var sight = root.gameObject.AddComponent<BoxCollider>();
            sight.center = FireGodRing;
            sight.size = new Vector3(13f, 14f, 2.5f);
            BuildFireGodGrade(root);
            return root.gameObject;
        }

        static Transform Anchor(string name, Transform parent, Vector3 position)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.localPosition = position;
            return t;
        }

        static Light LightAt(Transform parent, string name, Vector3 at, float intensity, float range)
        {
            var light = new GameObject(name).AddComponent<Light>();
            light.transform.SetParent(parent, false);
            light.transform.position = at;
            light.type = LightType.Point;
            light.color = new Color(1f, 0.32f, 0.08f);
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.None;
            return light;
        }

        /// <summary>
        /// 王座区的局部调色（盆地 136 m 见方，边缘 48 m 渐变）：只做焦点强化——比章节底色暖一点、饱和一点（参考图的暖橙烟火），
        /// 曝光不覆盖（跟章节底色一样 +0.25，先把曝光定死），亮度交给王座的熔岩点光（BuildFireGodThrone）；Bloom 阈值仍高于受光的岩面（只给熔岩柱、圆环、裂缝）。
        /// 2026-11-04 美术清理：以前 曝光 +0.65 / 饱和 +8 / 色温 +15 / Bloom 阈值 0.85、强度 1.25，盆地整片泛红光
        /// </summary>
        static void BuildFireGodGrade(Transform parent)
        {
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            LevelKit.SaveAsset(profile, $"{Dir}/VP_FireGodThrone.asset");
            var color = profile.Add<ColorAdjustments>(true);
            color.postExposure.overrideState = false;
            color.contrast.Override(26f);
            color.saturation.Override(10f);
            var white = profile.Add<WhiteBalance>(true);
            white.temperature.Override(12f);
            white.tint.Override(2f);
            var bloom = profile.Add<Bloom>(true);
            bloom.threshold.Override(0.95f);
            bloom.intensity.Override(0.95f);
            bloom.scatter.Override(0.7f);
            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(0.25f);
            vignette.smoothness.Override(0.48f);
            ShowcaseSceneBuilder.PersistVolumeComponents(profile);

            var go = new GameObject("Local Volume · 火神王座");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(Basin.x, 28f, Basin.y);
            var box = go.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = new Vector3(136f, 100f, 136f);
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = false;
            volume.sharedProfile = profile;
            volume.priority = 20f;
            volume.weight = 1f;
            volume.blendDistance = 48f;
        }

        static GameObject NewMeshObject(string name, Transform parent, Mesh mesh, Material material, string path)
        {
            mesh.name = System.IO.Path.GetFileNameWithoutExtension(path);
            LevelKit.SaveAsset(mesh, path);
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = true;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            go.isStatic = true;
            return go;
        }

        static Mesh CragMesh(float radius, float height, int seed, float depth)
        {
            const int Sides = 9;
            float[] levels = { 0f, 0.18f, 0.45f, 0.72f, 0.9f, 1f };
            float[] widths = { 1f, 0.91f, 0.76f, 0.58f, 0.31f, 0.025f };
            var rings = new Vector3[Sides][];
            for (int j = 0; j < levels.Length; j++)
            {
                rings[j] = new Vector3[Sides];
                float shiftX = (Landform.Hash(j, 3, seed) - 0.5f) * radius * 0.2f * levels[j];
                float shiftZ = (Landform.Hash(j, 5, seed) - 0.5f) * radius * 0.16f * levels[j];
                for (int i = 0; i < Sides; i++)
                {
                    float a = (i / (float)Sides + j * 0.008f) * Mathf.PI * 2f;
                    float r = widths[j] * Mathf.Lerp(0.88f, 1.1f, Landform.Hash(i, j, seed));
                    rings[j][i] = new Vector3(Mathf.Cos(a) * radius * r + shiftX, levels[j] * height,
                        Mathf.Sin(a) * radius * depth * r + shiftZ);
                }
            }
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            void Face(Vector3 a, Vector3 b, Vector3 c)
            {
                int n = vertices.Count;
                vertices.Add(a); vertices.Add(b); vertices.Add(c);
                triangles.Add(n); triangles.Add(n + 1); triangles.Add(n + 2);
            }
            for (int j = 0; j + 1 < levels.Length; j++)
            for (int i = 0; i < Sides; i++)
            {
                int k = (i + 1) % Sides;
                Face(rings[j][i], rings[j + 1][i], rings[j][k]);
                Face(rings[j][k], rings[j + 1][i], rings[j + 1][k]);
            }
            var top = new Vector3(0, height * 1.015f, 0);
            for (int i = 0; i < Sides; i++) Face(rings[levels.Length - 1][i], top, rings[levels.Length - 1][(i + 1) % Sides]);
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh CrackMesh(float height, float width, int seed)
        {
            const int Segments = 12;
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            for (int i = 0; i <= Segments; i++)
            {
                float v = i / (float)Segments;
                float x = (Landform.Hash(i, 3, seed) - 0.5f) * width * 4f;
                float half = width * Mathf.Lerp(0.65f, 1.15f, Landform.Hash(i, 7, seed));
                float z = 10.5f * v - 0.35f;
                vertices.Add(new Vector3(x - half, v * height, z));
                vertices.Add(new Vector3(x + half, v * height, z));
            }
            for (int i = 0; i < Segments; i++)
            {
                int a = i * 2;
                triangles.AddRange(new[] { a, a + 2, a + 1, a + 1, a + 2, a + 3, a + 1, a + 2, a, a + 3, a + 2, a + 1 });
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh RingMesh(float radius, float tube)
        {
            const int Major = 64, Minor = 8;
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            for (int i = 0; i < Major; i++)
            for (int j = 0; j < Minor; j++)
            {
                float u = i * Mathf.PI * 2 / Major, v = j * Mathf.PI * 2 / Minor;
                float r = radius + tube * Mathf.Cos(v);
                vertices.Add(new Vector3(r * Mathf.Cos(u), r * Mathf.Sin(u), tube * Mathf.Sin(v)));
                int a = i * Minor + j, b = ((i + 1) % Major) * Minor + j, c = i * Minor + (j + 1) % Minor, d = ((i + 1) % Major) * Minor + (j + 1) % Minor;
                triangles.Add(a); triangles.Add(b); triangles.Add(c);
                triangles.Add(b); triangles.Add(d); triangles.Add(c);
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh FallMesh(float height)
        {
            const int Rows = 32, Cols = 2;
            var vertices = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            var triangles = new List<int>();
            for (int plane = 0; plane < 2; plane++)
            for (int j = 0; j <= Rows; j++)
            {
                float v = j / (float)Rows;
                float half = Mathf.Lerp(1.65f, 1.25f, v) * (1f + 0.055f * Mathf.Sin(v * 13f));
                float center = 0.08f * Mathf.Sin(v * 9f);
                for (int i = 0; i <= Cols; i++)
                {
                    float u = -1f + 2f * i / Cols;
                    float x = center + u * half;
                    vertices.Add(plane == 0 ? new Vector3(x, v * height, 0) : new Vector3(0, v * height, x));
                    uv0.Add(new Vector2(x * 3f, v * height));
                    uv1.Add(new Vector4(half * 3f, 1000f, 0, 0));
                    uv2.Add(new Vector4(0, -2.2f, 0.37f, 0));
                }
            }
            int planeVerts = (Rows + 1) * (Cols + 1);
            for (int plane = 0; plane < 2; plane++)
            for (int j = 0; j < Rows; j++)
            for (int i = 0; i < Cols; i++)
            {
                int a = plane * planeVerts + j * (Cols + 1) + i, b = a + 1, c = a + Cols + 1, d = c + 1;
                triangles.AddRange(new[] { a, c, b, b, c, d, b, c, a, d, c, b });
            }
            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetUVs(0, uv0);
            mesh.SetUVs(1, uv1);
            mesh.SetUVs(2, uv2);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static void CheckFireGodThrone(LevelKit.Report rep, GameObject throne)
        {
            if (!throne || !throne.TryGetComponent<FireGodThrone>(out var controller))
            {
                rep.Fail("火神王座没有生成");
                return;
            }
            if (!controller.ring || !controller.ringProcedural || controller.ringProcedural.GetComponentsInChildren<MeshFilter>(true).Length < 2)
                rep.Fail("火神王座缺可替换的熔岩圆环");
            if (!controller.throne || !controller.throneProcedural || !controller.throneProcedural.GetComponentInChildren<MeshFilter>(true))
                rep.Fail("火神王座缺可替换的玄武岩尖塔");
            int falls = controller.fallRenderers?.Length ?? 0;
            if (falls != 1 || !controller.fallRoot) rep.Fail($"火神王座熔岩柱有 {falls} 道（应 1 道）");
            if (falls == 1 && controller.ring && controller.throne)
                rep.Line("✓ 火神王座：可替换玄武岩尖塔与圆环、一道竖直熔岩柱、锯齿岩峰和局部氛围，落点接神范熔池");
        }
    }
}
