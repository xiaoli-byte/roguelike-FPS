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

        static void ConfigureFireGodSky()
        {
            if (RenderSettings.skybox && RenderSettings.skybox.shader.name == "Spiritfire/SkyGradient")
            {
                RenderSettings.skybox.SetColor("_TopColor", new Color(0.055f, 0.035f, 0.085f));
                RenderSettings.skybox.SetColor("_HorizonColor", new Color(0.32f, 0.12f, 0.08f));
                RenderSettings.skybox.SetColor("_BottomColor", new Color(0.07f, 0.045f, 0.075f));
                RenderSettings.skybox.SetColor("_SunColor", new Color(0.55f, 0.24f, 0.16f));
                RenderSettings.skybox.SetFloat("_Exposure", 0.95f);
            }
            if (RenderSettings.sun)
            {
                RenderSettings.sun.color = new Color(0.78f, 0.48f, 0.4f);
                RenderSettings.sun.intensity = 0.8f;
            }
            RenderSettings.ambientSkyColor = new Color(0.24f, 0.2f, 0.3f);
            RenderSettings.ambientEquatorColor = new Color(0.28f, 0.21f, 0.27f);
            RenderSettings.ambientGroundColor = new Color(0.34f, 0.18f, 0.13f);
            RenderSettings.fogColor = new Color(0.18f, 0.095f, 0.13f);
            RenderSettings.fogStartDistance = 30f;
            RenderSettings.fogEndDistance = 260f;
        }

        static void ConfigureFireGodBackdrop(LevelKit.BackdropSpec backdrop)
        {
            backdrop.silhouette = new Color(0.075f, 0.055f, 0.1f);
            backdrop.top = new Color(0.16f, 0.075f, 0.09f);
            backdrop.horizon = RenderSettings.fogColor;
            backdrop.rings = new[]
            {
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 420, height = 75, haze = 0.3f, freq = 19, seed = 31 },
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 650, height = 140, haze = 0.5f, freq = 15, seed = 37 },
                new LevelKit.BackdropRing { style = LevelKit.BackdropStyle.Ridges, radius = 900, height = 230, haze = 0.7f, freq = 11, seed = 43 },
            };
        }

        /// <summary>参考图的单塔、单环、单柱；Model 子物体可分别替换王座和圆环的程序化体块。</summary>
        static GameObject BuildFireGodThrone(LevelKit.TerrainSet set, Transform parent)
        {
            var root = new GameObject("FireGodThrone").transform;
            root.SetParent(parent, false);
            var controller = root.gameObject.AddComponent<FireGodThrone>();
            var basalt = LevelKit.Mat(Dir, "FireGodBasalt", new Color(0.115f, 0.09f, 0.15f), 0.94f);
            var basaltCool = LevelKit.Mat(Dir, "FireGodBasaltCool", new Color(0.085f, 0.085f, 0.135f), 0.96f);

            var throne = Anchor("Throne", root, new Vector3(FireGodSpire.x, 22f, FireGodSpire.y));
            var throneProcedural = Anchor("Procedural", throne, Vector3.zero);
            NewMeshObject("王座主尖塔", throneProcedural, CragMesh(14f, 44f, 71, 0.82f), basalt,
                $"{Dir}/Throne/Mesh_FireGodThrone.asset");
            foreach (var (at, radius, height, seed) in new[]
                     {
                         (new Vector3(-10, 0, 2), 6.5f, 30f, 73), (new Vector3(10, 1, 3), 7f, 34f, 79),
                         (new Vector3(-6, -2, -5), 5f, 25f, 83), (new Vector3(7, -1, -4), 5.5f, 28f, 89),
                     })
                NewMeshObject("王座侧刃", throneProcedural, CragMesh(radius, height, seed, 0.8f), basaltCool,
                    $"{Dir}/Throne/Mesh_FireGodBlade_{seed}.asset").transform.localPosition = at;

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
            var ringProcedural = Anchor("Procedural", ring, Vector3.zero);
            NewMeshObject("圆环玄武岩暗衬", ringProcedural, RingMesh(5.2f, 0.45f),
                LevelKit.Mat(Dir, "FireGodRingBacking", new Color(0.09f, 0.055f, 0.085f), 0.94f),
                $"{Dir}/Throne/Mesh_FireGodRingBacking.asset").transform.localPosition = new Vector3(0, 0, 0.6f);
            NewMeshObject("熔岩圆环", ringProcedural, RingMesh(5.2f, 0.38f),
                LevelKit.GlowMat(Dir, "FireGodRing", new Color(1f, 0.26f, 0.035f), new Color(4.2f, 0.75f, 0.08f)),
                $"{Dir}/Throne/Mesh_FireGodRing.asset").transform.localPosition = new Vector3(0, 0, -0.7f);

            var fallRoot = Anchor("Lava Fall", root, new Vector3(Basin.x, ArenaLava - 0.2f, Basin.y));
            var fallMat = new Material(LevelKit.LavaMaterial()) { name = "M_FireGodFall" };
            fallMat.SetColor("_DeepColor", new Color(0.65f, 0.055f, 0.012f));
            fallMat.SetColor("_HotColor", new Color(1f, 0.36f, 0.025f));
            fallMat.SetColor("_CoreColor", new Color(1f, 0.82f, 0.32f));
            fallMat.SetFloat("_Emission", 2.35f);
            fallMat.SetFloat("_MoltenAmount", 0.78f);
            fallMat.SetFloat("_CrackWidth", 0.055f);
            fallMat.SetFloat("_NoiseScale", 0.17f);
            fallMat.SetFloat("_PlateScale", 0.18f);
            fallMat.SetFloat("_ShoreWidth", 0f);
            fallMat.SetFloat("_ShoreDepth", 0f);
            fallMat.SetFloat("_BubbleRate", 0.25f);
            LevelKit.SaveAsset(fallMat, $"{Dir}/M_WB_FireGodFall.mat");
            var fall = NewMeshObject("FireGodThrone · 熔岩柱", fallRoot,
                FallMesh(FireGodFallTop - ArenaLava + 0.2f), fallMat, $"{Dir}/Lava/Mesh_FireGodFall_1.asset");
            fall.isStatic = false;

            var ringLight = LightAt(root, "FireGodThrone · 圆环光", FireGodRing, 1.6f, 27f);
            var fallLight = LightAt(root, "FireGodThrone · 熔瀑落点光", new Vector3(Basin.x, 3f, Basin.y), 3.2f, 25f);
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

        static void BuildFireGodGrade(Transform parent)
        {
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            LevelKit.SaveAsset(profile, $"{Dir}/VP_FireGodThrone.asset");
            var color = profile.Add<ColorAdjustments>(true);
            color.postExposure.Override(0.12f);
            color.contrast.Override(20f);
            color.saturation.Override(0f);
            var white = profile.Add<WhiteBalance>(true);
            white.temperature.Override(-10f);
            white.tint.Override(-2f);
            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(0.42f);
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
                float half = Mathf.Lerp(0.82f, 0.64f, v) * (1f + 0.045f * Mathf.Sin(v * 13f));
                float center = 0.045f * Mathf.Sin(v * 9f);
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
