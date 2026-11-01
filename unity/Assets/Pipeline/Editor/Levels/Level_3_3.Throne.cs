using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    public static partial class Level_3_3
    {
        static readonly Vector2 FireGodSpire = new(152, 216);
        static Vector3 FireGodRing => new(Basin.x, 31f, Basin.y);
        static Vector3 FireGodCrown => new(FireGodSpire.x, 53f, FireGodSpire.y);

        /// <summary>火神王座：北侧锯齿岩峰托住熔岩圆环，竖直熔瀑穿过圆环落进神范熔池；全部高位件不占战斗走位</summary>
        static GameObject BuildFireGodThrone(LevelKit.TerrainSet set, Transform parent)
        {
            var root = new GameObject("FireGodThrone").transform;
            root.SetParent(parent, false);
            var basalt = LevelKit.Mat(Dir, "FireGodBasalt", new Color(0.19f, 0.14f, 0.18f), 0.94f);
            var spires = new[]
            {
                (at: FireGodSpire, scale: new Vector3(4.4f, 15f, 4.4f), yaw: 12f),
                (at: new Vector2(137, 214), scale: new Vector3(2.8f, 9f, 3f), yaw: 41f),
                (at: new Vector2(169, 215), scale: new Vector3(3.2f, 11f, 3.2f), yaw: 73f),
                (at: new Vector2(185, 213), scale: new Vector3(2.1f, 7f, 2.4f), yaw: 106f),
            };
            foreach (var (at, scale, yaw) in spires)
            {
                var go = LevelKit.PlaceOrBox("SM_Env_InfernoBasalt", root, set.OnGround(at.x, at.y, -0.8f),
                    Vector3.Scale(new Vector3(2.6f, 2.9f, 2.4f), scale), yaw);
                if (!go) continue;
                go.name = "FireGodThrone · 锯齿岩峰";
                go.transform.localScale = scale;
                go.isStatic = true;
            }

            var crown = FireGodCrown;
            var ring = FireGodRing;
            {
                var a = crown + new Vector3(0, -3f, 0);
                var b = ring + new Vector3(0, 0, 0.8f);
                var beam = GameObject.CreatePrimitive(PrimitiveType.Cube);
                beam.name = "FireGodThrone · 王座背脊";
                beam.transform.SetParent(root, false);
                beam.transform.position = (a + b) * 0.5f;
                beam.transform.rotation = Quaternion.LookRotation(b - a, Vector3.up);
                beam.transform.localScale = new Vector3(3.2f, 2.8f, Vector3.Distance(a, b));
                Object.DestroyImmediate(beam.GetComponent<Collider>());
                beam.GetComponent<MeshRenderer>().sharedMaterial = basalt;
                beam.isStatic = true;
            }

            var backing = NewMeshObject("FireGodThrone · 圆环暗衬", root, RingMesh(5f, 0.55f),
                LevelKit.Mat(Dir, "FireGodRingBacking", new Color(0.12f, 0.07f, 0.09f), 0.9f), $"{Dir}/Throne/Mesh_FireGodRingBacking.asset");
            backing.transform.position = ring + new Vector3(0, 0, 0.3f);
            var glow = NewMeshObject("Ring", root, RingMesh(5f, 0.28f),
                LevelKit.GlowMat(Dir, "FireGodRing", new Color(1f, 0.22f, 0.035f), new Color(2.6f, 0.48f, 0.055f)), $"{Dir}/Throne/Mesh_FireGodRing.asset");
            glow.transform.position = ring - new Vector3(0, 0, 0.15f);

            var lavaMat = LevelKit.LavaMaterial();
            for (int i = 0; i < 3; i++)
            {
                var band = NewMeshObject($"FireGodThrone · 熔瀑 {i + 1}", root, FallMesh(i), lavaMat, $"{Dir}/Lava/Mesh_FireGodFall_{i + 1}.asset");
                band.transform.position = new Vector3(Basin.x, ArenaLava - 0.2f, Basin.y);
            }

            void LightAt(string name, Vector3 at, float intensity, float range)
            {
                var light = new GameObject(name).AddComponent<Light>();
                light.transform.SetParent(root, false);
                light.transform.position = at;
                light.type = LightType.Point;
                light.color = new Color(1f, 0.32f, 0.08f);
                light.intensity = intensity;
                light.range = range;
                light.shadows = LightShadows.None;
            }
            LightAt("FireGodThrone · 圆环光", ring, 2.2f, 28f);
            LightAt("FireGodThrone · 熔瀑落点光", new Vector3(Basin.x, 3f, Basin.y), 3f, 22f);

            var sight = root.gameObject.AddComponent<BoxCollider>();
            sight.center = ring;
            sight.size = new Vector3(12f, 12f, 1.5f);
            return root.gameObject;
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
            go.isStatic = true;
            return go;
        }

        static Mesh RingMesh(float radius, float tube)
        {
            const int Major = 48, Minor = 8;
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

        static Mesh FallMesh(int band)
        {
            const int Rows = 32, Cols = 4;
            var vertices = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            var triangles = new List<int>();
            float along = 0;
            for (int j = 0; j <= Rows; j++)
            {
                float v = j / (float)Rows;
                float half = Mathf.Lerp(0.72f, 0.38f, v) * (1 + 0.12f * Mathf.Sin(v * 17 + band * 2.1f));
                float center = (band - 1) * 0.62f + 0.13f * Mathf.Sin(v * 11 + band);
                float depth = (band - 1) * 0.35f + 0.1f * Mathf.Cos(v * 9 + band);
                along = v * 45f;
                for (int i = 0; i <= Cols; i++)
                {
                    float u = -1f + 2f * i / Cols;
                    vertices.Add(new Vector3(center + u * half, v * 45f, depth));
                    uv0.Add(new Vector2(u * half * 3f, along));
                    uv1.Add(new Vector4(half * 3f, 1000f, 0, 0));
                    uv2.Add(new Vector4(0, -3f, band * 0.31f, 0));
                }
            }
            for (int j = 0; j < Rows; j++)
            for (int i = 0; i < Cols; i++)
            {
                int a = j * (Cols + 1) + i, b = a + 1, c = a + Cols + 1, d = c + 1;
                triangles.Add(a); triangles.Add(c); triangles.Add(b);
                triangles.Add(b); triangles.Add(c); triangles.Add(d);
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
            if (!throne)
            {
                rep.Fail("火神王座没有生成");
                return;
            }
            var ring = throne.transform.Find("Ring");
            if (!ring || !ring.GetComponent<MeshFilter>() || !ring.GetComponent<MeshFilter>().sharedMesh)
                rep.Fail("火神王座缺熔岩圆环");
            int falls = 0;
            foreach (var t in throne.GetComponentsInChildren<Transform>())
                if (t.name.StartsWith("FireGodThrone · 熔瀑")) falls++;
            if (falls != 3) rep.Fail($"火神王座熔瀑有 {falls} 条（应 3 条）");
            if (falls == 3 && ring) rep.Line("✓ 火神王座：锯齿岩峰、熔岩圆环、三条竖直熔瀑，落点接神范熔池");
        }
    }
}
