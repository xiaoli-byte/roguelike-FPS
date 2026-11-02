using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>Scenes3D/vfx-tornado 实现级还原：原始圆柱、抛物线半径、扰动、双层噪声与地面环。</summary>
    public sealed class ScenesTornadoVisual : TornadoVisualBase
    {
        const int RadialSegments = 20, HeightSegments = 20;
        static readonly int ModeId = Shader.PropertyToID("_Mode");
        static readonly int AlphaId = Shader.PropertyToID("_Alpha");
        static readonly int EmissiveId = Shader.PropertyToID("_EmissiveColor");
        static readonly Color Emissive = Hex.Rgb(0xff8b4d);

        float height, radiusScale, time, alpha = 1f, fade = 1f, fadeTarget = 1f, fadeSpeed = 3f;
        Mesh darkMesh, emissiveMesh;
        MeshRenderer darkRenderer, emissiveRenderer, groundRenderer;
        MaterialPropertyBlock block;
        Vector3[] darkVertices, emissiveVertices;

        public static ScenesTornadoVisual Create(Vector3 ground, float height, float topRadius, Transform parent = null)
        {
            var go = new GameObject("Scenes Tornado Visual");
            go.transform.SetParent(parent, true);
            go.transform.position = ground;
            var v = go.AddComponent<ScenesTornadoVisual>();
            v.height = height;
            v.radiusScale = topRadius / 0.69f;
            v.Build();
            return v;
        }

        void Build()
        {
            block = new MaterialPropertyBlock();
            darkMesh = MakeCylinder("Dark Layer", 0.2f, out darkRenderer, out darkVertices, 0);
            emissiveMesh = MakeCylinder("Emissive Layer", 0.15f, out emissiveRenderer, out emissiveVertices, 1);
            groundRenderer = MakeGround();
            SetLayer(darkRenderer, 0);
            SetLayer(emissiveRenderer, 1);
            SetLayer(groundRenderer, 2);
        }

        Mesh MakeCylinder(string name, float amplitude, out MeshRenderer renderer, out Vector3[] vertices, int mode)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var filter = go.AddComponent<MeshFilter>();
            var mesh = new Mesh { name = "Scenes Tornado " + name };
            mesh.MarkDynamic();
            filter.sharedMesh = mesh;
            renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = FxMaterials.Get(FxMaterialKind.ScenesTornado);
            renderer.sortingOrder = mode == 0 ? -2 : 5;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            int count = (HeightSegments + 1) * (RadialSegments + 1);
            vertices = new Vector3[count];
            var uv = new Vector2[count];
            var triangles = new int[HeightSegments * RadialSegments * 12];
            int n = 0;
            for (int y = 0; y <= HeightSegments; y++)
                for (int x = 0; x <= RadialSegments; x++)
                {
                    int k = y * (RadialSegments + 1) + x;
                    uv[k] = new Vector2(x / (float)RadialSegments, y / (float)HeightSegments);
                    if (y == HeightSegments || x == RadialSegments) continue;
                    triangles[n++] = k;
                    triangles[n++] = k + 1;
                    triangles[n++] = k + RadialSegments + 1;
                    triangles[n++] = k + RadialSegments + 1;
                    triangles[n++] = k + 1;
                    triangles[n++] = k + RadialSegments + 2;
                    triangles[n++] = k + RadialSegments + 1;
                    triangles[n++] = k + 1;
                    triangles[n++] = k;
                    triangles[n++] = k + RadialSegments + 2;
                    triangles[n++] = k + 1;
                    triangles[n++] = k + RadialSegments + 1;
                }
            mesh.SetVertices(vertices);
            mesh.uv = uv;
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height * 0.5f, new Vector3(radiusScale * 3f, height, radiusScale * 3f));
            return mesh;
        }

        MeshRenderer MakeGround()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = "Ground Noise";
            go.transform.SetParent(transform, false);
            go.transform.localRotation = Quaternion.Euler(90, 0, 0);
            go.transform.localPosition = new Vector3(0, 0.01f, 0);
            go.transform.localScale = new Vector3(radiusScale * 2.9f, radiusScale * 2.9f, 1);
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = FxMaterials.Get(FxMaterialKind.ScenesTornado);
            renderer.sortingOrder = -3;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            time += dt;
            fade = Mathf.MoveTowards(fade, fadeTarget, dt * fadeSpeed);
            UpdateCylinder(darkMesh, darkVertices, 0.2f);
            UpdateCylinder(emissiveMesh, emissiveVertices, 0.15f);
            SetLayer(darkRenderer, 0);
            SetLayer(emissiveRenderer, 1);
            SetLayer(groundRenderer, 2);
            if (fadeTarget <= 0 && fade <= 0.005f) Destroy(gameObject);
        }

        void UpdateCylinder(Mesh mesh, Vector3[] vertices, float amplitude)
        {
            float t = time * 0.15f;
            for (int y = 0; y <= HeightSegments; y++)
            {
                float elevation = y / (float)HeightSegments;
                for (int x = 0; x <= RadialSegments; x++)
                {
                    float angle = x / (float)RadialSegments * Mathf.PI * 2f;
                    float radius = (Mathf.Pow(elevation - 0.3f, 2f) + amplitude) * radiusScale;
                    float turbulence = Mathf.Sin((elevation - t) * 20f + angle * 2f) * 0.05f * radiusScale;
                    radius += turbulence;
                    vertices[y * (RadialSegments + 1) + x] = new Vector3(Mathf.Cos(angle) * radius, elevation * height, Mathf.Sin(angle) * radius);
                }
            }
            mesh.SetVertices(vertices);
        }

        void SetLayer(Renderer renderer, int mode)
        {
            block.SetFloat(ModeId, mode);
            block.SetColor(EmissiveId, Emissive);
            block.SetFloat(AlphaId, alpha * fade);
            renderer.SetPropertyBlock(block);
        }

        public override void SetAlpha(float value) => alpha = Mathf.Clamp01(value);

        public override void FadeOut(float seconds)
        {
            fadeTarget = 0;
            fadeSpeed = 1f / Mathf.Max(0.05f, seconds);
        }

        void OnDestroy()
        {
            if (darkMesh) Destroy(darkMesh);
            if (emissiveMesh) Destroy(emissiveMesh);
        }
    }
}
