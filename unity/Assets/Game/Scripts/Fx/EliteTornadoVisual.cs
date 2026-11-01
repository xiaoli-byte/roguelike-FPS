using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英龙卷的手绘风体：淡漏斗托出体积，双主螺旋与四条断笔风纹表现旋转，团块云顶与章节尘裙交代气流去向。
    /// 暗衬、风青、窄亮边都走普通混合；亮边不是铺满整条的加法光，避免在亮沙与雪地上冲成奶白。
    /// </summary>
    public sealed class EliteTornadoVisual : MonoBehaviour
    {
        const int Bands = 6, Segments = 36, BodySegments = 40, BodyLevels = 14;
        static readonly Color Ink = Hex.Rgb(0x263e4c);
        static readonly Color Wind = Hex.Rgb(0x58a6b3);
        static readonly Color Edge = Hex.Rgb(0xc6e7dc);
        static readonly Color Cloud = Hex.Rgb(0x7297a3);
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        float height, topRadius, time, alpha = 1f, fade = 1f, fadeTarget = 1f, fadeSpeed = 3f, crownTimer, dustTimer;
        Mesh mainMesh, underMesh, bodyMesh;
        MeshRenderer mainRenderer, underRenderer, bodyRenderer;
        MaterialPropertyBlock block;
        Vector3[] mainVertices, underVertices, bodyVertices;

        public static EliteTornadoVisual Create(Vector3 ground, float height, float topRadius, Transform parent = null)
        {
            var go = new GameObject("Elite Tornado Visual");
            go.transform.SetParent(parent, true);
            go.transform.position = ground;
            var v = go.AddComponent<EliteTornadoVisual>();
            v.height = height;
            v.topRadius = topRadius;
            v.Build();
            return v;
        }

        void Build()
        {
            block = new MaterialPropertyBlock();
            mainVertices = new Vector3[Bands * (Segments + 1) * 2];
            underVertices = new Vector3[mainVertices.Length];
            bodyVertices = new Vector3[(BodyLevels + 1) * (BodySegments + 1)];
            mainMesh = MakeStrokeMesh("Wind Strokes", out mainRenderer, 0);
            underMesh = MakeStrokeMesh("Ink Underlay", out underRenderer, -1);
            bodyMesh = MakeBodyMesh();
            UpdateStrokes();
            PaintVertices();
        }

        Mesh MakeStrokeMesh(string name, out MeshRenderer renderer, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var filter = go.AddComponent<MeshFilter>();
            var mesh = new Mesh { name = "Elite Tornado " + name };
            mesh.MarkDynamic();
            filter.sharedMesh = mesh;
            renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = FxMaterials.AlphaBlend;
            renderer.sortingOrder = order;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            var triangles = new int[Bands * Segments * 12];
            int n = 0;
            for (int b = 0; b < Bands; b++)
                for (int i = 0; i < Segments; i++)
                {
                    int k = b * (Segments + 1) * 2 + i * 2;
                    n = Quad(triangles, n, k, 2);
                }
            mesh.SetVertices(new Vector3[Bands * (Segments + 1) * 2]);
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height * 0.5f, new Vector3(topRadius * 4f, height * 1.4f, topRadius * 4f));
            return mesh;
        }

        Mesh MakeBodyMesh()
        {
            var go = new GameObject("Funnel Body");
            go.transform.SetParent(transform, false);
            var filter = go.AddComponent<MeshFilter>();
            var mesh = new Mesh { name = "Elite Tornado Funnel" };
            mesh.MarkDynamic();
            filter.sharedMesh = mesh;
            bodyRenderer = go.AddComponent<MeshRenderer>();
            bodyRenderer.sharedMaterial = FxMaterials.AlphaBlend;
            bodyRenderer.sortingOrder = -2;
            bodyRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            bodyRenderer.receiveShadows = false;
            var triangles = new int[BodyLevels * BodySegments * 12];
            int n = 0;
            for (int y = 0; y < BodyLevels; y++)
                for (int x = 0; x < BodySegments; x++)
                {
                    int k = y * (BodySegments + 1) + x;
                    n = Quad(triangles, n, k, BodySegments + 1);
                }
            mesh.SetVertices(new Vector3[(BodyLevels + 1) * (BodySegments + 1)]);
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height * 0.5f, new Vector3(topRadius * 4f, height * 1.4f, topRadius * 4f));
            return mesh;
        }

        static int Quad(int[] triangles, int n, int k, int stride)
        {
            triangles[n++] = k;
            triangles[n++] = k + 1;
            triangles[n++] = k + stride;
            triangles[n++] = k + stride;
            triangles[n++] = k + 1;
            triangles[n++] = k + stride + 1;
            triangles[n++] = k + stride;
            triangles[n++] = k + 1;
            triangles[n++] = k;
            triangles[n++] = k + stride + 1;
            triangles[n++] = k + 1;
            triangles[n++] = k + stride;
            return n;
        }

        void PaintVertices()
        {
            var mainColors = new Color[mainVertices.Length];
            var underColors = new Color[underVertices.Length];
            for (int b = 0; b < Bands; b++)
                for (int i = 0; i <= Segments; i++)
                {
                    float v = i / (float)Segments;
                    float a = Mathf.Pow(Mathf.Sin(v * Mathf.PI), 0.42f);
                    for (int side = 0; side < 2; side++)
                    {
                        int k = b * (Segments + 1) * 2 + i * 2 + side;
                        var c = Color.Lerp(Wind, Edge, side == 0 ? 0.62f : 0.05f);
                        c.a = a * 0.94f;
                        mainColors[k] = FxVertexColor.Linear(c);
                        var dark = Ink;
                        dark.a = a * 0.88f;
                        underColors[k] = FxVertexColor.Linear(dark);
                    }
                }
            mainMesh.colors = mainColors;
            underMesh.colors = underColors;

            var bodyColors = new Color[bodyVertices.Length];
            for (int y = 0; y <= BodyLevels; y++)
            {
                float u = y / (float)BodyLevels;
                float a = Mathf.Lerp(0.1f, 0.24f, u) * Mathf.Clamp01(u * 9f) * Mathf.Clamp01((1f - u) * 5f);
                for (int x = 0; x <= BodySegments; x++)
                {
                    var c = Color.Lerp(Ink, Wind, 0.48f + u * 0.18f);
                    c.a = a;
                    bodyColors[y * (BodySegments + 1) + x] = FxVertexColor.Linear(c);
                }
            }
            bodyMesh.colors = bodyColors;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            time += dt;
            fade = Mathf.MoveTowards(fade, fadeTarget, dt * fadeSpeed);
            UpdateStrokes();
            block.SetColor(BaseColorId, new Color(1, 1, 1, alpha * fade));
            mainRenderer.SetPropertyBlock(block);
            underRenderer.SetPropertyBlock(block);
            bodyRenderer.SetPropertyBlock(block);
            if (fadeTarget <= 0 && fade <= 0.005f)
            {
                Destroy(gameObject);
                return;
            }

            crownTimer -= dt;
            if (crownTimer <= 0 && fade > 0.3f)
            {
                crownTimer = 0.11f;
                EmitCrown();
            }
            dustTimer -= dt;
            if (dustTimer <= 0 && fade > 0.3f)
            {
                dustTimer = 0.16f;
                EmitSkirt();
            }
        }

        Vector3 Axis(float u)
        {
            float sway = u * u * 0.22f;
            return new Vector3(Mathf.Sin(u * 4.4f - time * 1.35f) * sway, u * height, Mathf.Cos(u * 3.2f - time * 1.1f) * sway);
        }

        void UpdateStrokes()
        {
            for (int b = 0; b < Bands; b++)
                for (int i = 0; i <= Segments; i++)
                {
                    float v = i / (float)Segments;
                    bool spine = b < 2;
                    float u = spine ? v : Mathf.Clamp01((b - 1) / 6f + (v - 0.5f) * (0.3f + 0.025f * (b % 3)));
                    float angle = b * 2.31f + time * (3.1f + b * 0.13f) + u * (spine ? 10.5f : 7.2f) + v * 0.65f;
                    float radius = Mathf.Lerp(0.24f, topRadius, Mathf.Pow(u, 1.45f)) * (1f + 0.08f * Mathf.Sin(time * 2.2f + b));
                    var radial = new Vector3(Mathf.Sin(angle), 0, Mathf.Cos(angle));
                    float taper = spine ? Mathf.Clamp01(Mathf.Min(v, 1f - v) * 14f) : Mathf.Pow(Mathf.Sin(v * Mathf.PI), 0.62f);
                    float width = Mathf.Lerp(spine ? 0.18f : 0.14f, spine ? 0.42f : 0.34f, u) * taper;
                    var center = Axis(u) + radial * radius;
                    var lift = Vector3.up * (width * 0.5f) + radial * (width * 0.18f);
                    int k = b * (Segments + 1) * 2 + i * 2;
                    mainVertices[k] = center + lift;
                    mainVertices[k + 1] = center - lift;
                    underVertices[k] = center + lift * 1.35f - radial * 0.025f;
                    underVertices[k + 1] = center - lift * 1.35f - radial * 0.025f;
                }
            mainMesh.SetVertices(mainVertices);
            underMesh.SetVertices(underVertices);

            for (int y = 0; y <= BodyLevels; y++)
            {
                float u = y / (float)BodyLevels;
                float radius = Mathf.Lerp(0.18f, topRadius * 0.88f, Mathf.Pow(u, 1.5f));
                var axis = Axis(u);
                for (int x = 0; x <= BodySegments; x++)
                {
                    float a = x / (float)BodySegments * Mathf.PI * 2f + time * 0.45f;
                    bodyVertices[y * (BodySegments + 1) + x] = axis + new Vector3(Mathf.Sin(a) * radius, 0, Mathf.Cos(a) * radius);
                }
            }
            bodyMesh.SetVertices(bodyVertices);
        }

        void EmitCrown()
        {
            float a = Random.value * Mathf.PI * 2f;
            var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var at = transform.position + d * topRadius * Random.Range(0.5f, 0.85f) + Vector3.up * height * Random.Range(0.93f, 0.99f);
            var tangent = Vector3.Cross(Vector3.up, d) * 1.6f;
            Fx.LdOne("ToonSmoke", at, tangent + Vector3.up * 0.25f, Random.Range(1.05f, 1.45f), 0.58f, Fx.LdAlpha(Cloud, 0.84f), false);
        }

        void EmitSkirt()
        {
            var at = transform.position;
            var dust = FxTone.Ground(Hex.Rgb(0xa08a6a));
            float a = Random.value * Mathf.PI * 2f;
            var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var tangent = Vector3.Cross(Vector3.up, d);
            Fx.LdOne("ToonSmoke", at + d * 0.55f + Vector3.up * 0.25f, tangent * 4.2f + Vector3.up * 0.8f,
                Random.Range(0.9f, 1.3f), 0.58f, Fx.LdAlpha(dust, 0.82f), false);
            Fx.LdMany("Chunk", 2, i =>
            {
                float h = Random.Range(0.35f, height * 0.72f);
                float u = h / height;
                var p = at + d * Mathf.Lerp(0.35f, topRadius, u * u) + Vector3.up * h;
                return (p, tangent * Random.Range(4.5f, 6.5f) + Vector3.up * 1.4f, Random.Range(0.1f, 0.16f), 0.62f);
            }, dust);
        }

        public void SetCharge(float k)
        {
            k = Mathf.Clamp01(k);
            transform.localScale = Vector3.one * Mathf.Lerp(0.22f, 0.72f, k * k * (3f - 2f * k));
            alpha = Mathf.Lerp(0.25f, 0.9f, k);
        }

        public void SetAlpha(float a) => alpha = Mathf.Clamp01(a);

        public void FadeOut(float seconds)
        {
            fadeTarget = 0;
            fadeSpeed = 1f / Mathf.Max(0.05f, seconds);
        }

        void OnDestroy()
        {
            if (mainMesh) Destroy(mainMesh);
            if (underMesh) Destroy(underMesh);
            if (bodyMesh) Destroy(bodyMesh);
        }
    }
}
