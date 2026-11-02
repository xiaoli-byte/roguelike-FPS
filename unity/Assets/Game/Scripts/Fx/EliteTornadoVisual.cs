using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英龙卷的手绘风体：十六条起止、宽度与转速各异的流层绕 8 段阻尼弹簧风核运动，柔边亮芯叠在双层噪声风体上。
    /// 倾斜云冠按层减速扩散，稳定地面环、章节尘裙与外抛风丝分层运动。
    /// 弹簧骨架与云顶扩散实现参考 Habrador/Unity-Tornado-Simulator（MIT，Copyright 2021 Erik Nordeus）。
    /// </summary>
    public sealed class EliteTornadoVisual : MonoBehaviour
    {
        const int Bands = 16, Segments = 28, BodySegments = 40, BodyLevels = 14, CrownSegments = 48, SkeletonPieces = 8;
        static readonly Color Ink = Hex.Rgb(0x263e4c);
        static readonly Color Wind = Hex.Rgb(0x68b2bf);
        static readonly Color Edge = Hex.Rgb(0xd3eee4);
        static readonly Color Cloud = Hex.Rgb(0x7297a3);
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ModeId = Shader.PropertyToID("_Mode");
        static readonly int AlphaId = Shader.PropertyToID("_Alpha");
        static readonly int ColorAId = Shader.PropertyToID("_ColorA");
        static readonly int ColorBId = Shader.PropertyToID("_ColorB");

        float height, topRadius, time, alpha = 1f, fade = 1f, fadeTarget = 1f, fadeSpeed = 3f, crownTimer, dustTimer;
        bool charging;
        Vector3 travel;
        Mesh mainMesh, underMesh, bodyMesh, crownMesh;
        MeshRenderer mainRenderer, underRenderer, bodyRenderer, flowRenderer, groundRenderer, crownRenderer;
        MaterialPropertyBlock block;
        Vector3[] mainVertices, underVertices, bodyVertices, crownVertices;
        readonly Vector3[] skeleton = new Vector3[SkeletonPieces];
        readonly Vector3[] skeletonVelocity = new Vector3[SkeletonPieces];

        public static EliteTornadoVisual Create(Vector3 ground, float height, float topRadius, Transform parent = null, bool charging = false)
        {
            var go = new GameObject("Elite Tornado Visual");
            go.transform.SetParent(parent, true);
            go.transform.position = ground;
            var v = go.AddComponent<EliteTornadoVisual>();
            v.height = height;
            v.topRadius = topRadius;
            v.charging = charging;
            v.Build();
            return v;
        }

        void Build()
        {
            InitializeSkeleton();
            block = new MaterialPropertyBlock();
            mainVertices = new Vector3[Bands * (Segments + 1) * 3];
            underVertices = new Vector3[Bands * (Segments + 1) * 2];
            bodyVertices = new Vector3[(BodyLevels + 1) * (BodySegments + 1)];
            crownVertices = new Vector3[3 * (CrownSegments + 1)];
            mainMesh = MakeStrokeMesh("Wind Strokes", out mainRenderer, 0, 3);
            underMesh = MakeStrokeMesh("Ink Underlay", out underRenderer, -1, 2);
            bodyMesh = MakeBodyMesh();
            flowRenderer = MakeOverlayRenderer("Flow Noise", bodyMesh, -1);
            crownMesh = MakeCrownMesh();
            if (!charging) groundRenderer = MakeGroundRenderer();
            UpdateStrokes();
            PaintVertices();
        }

        Mesh MakeStrokeMesh(string name, out MeshRenderer renderer, int order, int rows)
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

            var triangles = new int[Bands * Segments * (rows - 1) * 12];
            int n = 0;
            for (int b = 0; b < Bands; b++)
                for (int i = 0; i < Segments; i++)
                    for (int r = 0; r < rows - 1; r++)
                    {
                        int k = b * (Segments + 1) * rows + i * rows + r;
                        n = Quad(triangles, n, k, rows);
                    }
            mesh.SetVertices(new Vector3[Bands * (Segments + 1) * rows]);
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height * 0.5f, new Vector3(topRadius * 4f, height * 1.4f, topRadius * 4f));
            return mesh;
        }

        MeshRenderer MakeOverlayRenderer(string name, Mesh mesh, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = FxMaterials.Get(FxMaterialKind.EliteTornado);
            renderer.sortingOrder = order;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
        }

        MeshRenderer MakeGroundRenderer()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = "Ground Flow";
            go.transform.SetParent(transform, false);
            go.transform.localRotation = Quaternion.Euler(90, 0, 0);
            go.transform.localPosition = new Vector3(0, 0.05f, 0);
            go.transform.localScale = new Vector3(3.4f, 3.4f, 1);
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = FxMaterials.Get(FxMaterialKind.EliteTornado);
            renderer.sortingOrder = -3;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
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
            bodyRenderer.sharedMaterial = FxMaterials.Get(FxMaterialKind.EliteTornado);
            bodyRenderer.sortingOrder = -2;
            bodyRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            bodyRenderer.receiveShadows = false;
            var triangles = new int[BodyLevels * BodySegments * 12];
            var uv = new Vector2[(BodyLevels + 1) * (BodySegments + 1)];
            int n = 0;
            for (int y = 0; y < BodyLevels; y++)
                for (int x = 0; x < BodySegments; x++)
                {
                    int k = y * (BodySegments + 1) + x;
                    n = Quad(triangles, n, k, BodySegments + 1);
                }
            for (int y = 0; y <= BodyLevels; y++)
                for (int x = 0; x <= BodySegments; x++)
                    uv[y * (BodySegments + 1) + x] = new Vector2(x / (float)BodySegments, y / (float)BodyLevels);
            mesh.SetVertices(new Vector3[(BodyLevels + 1) * (BodySegments + 1)]);
            mesh.uv = uv;
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height * 0.5f, new Vector3(topRadius * 4f, height * 1.4f, topRadius * 4f));
            return mesh;
        }

        Mesh MakeCrownMesh()
        {
            var go = new GameObject("Rolling Cloud Crown");
            go.transform.SetParent(transform, false);
            var filter = go.AddComponent<MeshFilter>();
            var mesh = new Mesh { name = "Elite Tornado Cloud Crown" };
            mesh.MarkDynamic();
            filter.sharedMesh = mesh;
            crownRenderer = go.AddComponent<MeshRenderer>();
            crownRenderer.sharedMaterial = FxMaterials.AlphaBlend;
            crownRenderer.sortingOrder = -1;
            crownRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            crownRenderer.receiveShadows = false;
            var triangles = new int[2 * CrownSegments * 12];
            int n = 0;
            for (int y = 0; y < 2; y++)
                for (int x = 0; x < CrownSegments; x++)
                {
                    int k = y * (CrownSegments + 1) + x;
                    n = Quad(triangles, n, k, CrownSegments + 1);
                }
            mesh.SetVertices(new Vector3[3 * (CrownSegments + 1)]);
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.up * height, new Vector3(topRadius * 4f, 2f, topRadius * 4f));
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
                    for (int side = 0; side < 3; side++)
                    {
                        int k = b * (Segments + 1) * 3 + i * 3 + side;
                        var c = side == 1 ? Color.Lerp(Wind, Edge, 0.72f) : Wind;
                        c.a = a * (side == 1 ? 0.95f : 0.3f);
                        mainColors[k] = FxVertexColor.Linear(c);
                    }
                    for (int side = 0; side < 2; side++)
                    {
                        int k = b * (Segments + 1) * 2 + i * 2 + side;
                        var dark = Ink;
                        dark.a = a * 0.12f;
                        underColors[k] = FxVertexColor.Linear(dark);
                    }
                }
            mainMesh.colors = mainColors;
            underMesh.colors = underColors;

            var bodyColors = new Color[bodyVertices.Length];
            for (int y = 0; y <= BodyLevels; y++)
            {
                float u = y / (float)BodyLevels;
                float a = Mathf.Lerp(0.16f, 0.34f, u) * Mathf.Clamp01(u * 9f) * Mathf.Clamp01((1f - u) * 5f);
                for (int x = 0; x <= BodySegments; x++)
                {
                    var c = Color.Lerp(Ink, Wind, 0.48f + u * 0.18f);
                    c.a = a;
                    bodyColors[y * (BodySegments + 1) + x] = FxVertexColor.Linear(c);
                }
            }
            bodyMesh.colors = bodyColors;

            var crownColors = new Color[crownVertices.Length];
            for (int y = 0; y < 3; y++)
                for (int x = 0; x <= CrownSegments; x++)
                {
                    float v = y / 2f;
                    var c = Color.Lerp(Wind, Cloud, 0.35f + v * 0.55f);
                    c.a = y == 1 ? 0.52f : 0.24f;
                    crownColors[y * (CrownSegments + 1) + x] = FxVertexColor.Linear(c);
                }
            crownMesh.colors = crownColors;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            time += dt;
            fade = Mathf.MoveTowards(fade, fadeTarget, dt * fadeSpeed);
            UpdateSkeleton(dt);
            UpdateStrokes();
            SetNoiseLayer(bodyRenderer, 0, Ink, Wind, alpha * fade * 0.8f);
            SetNoiseLayer(flowRenderer, 1, Wind, Edge, alpha * fade);
            SetNoiseLayer(groundRenderer, 2, Ink, Wind, alpha * fade * 0.8f);
            block.SetColor(BaseColorId, new Color(1, 1, 1, alpha * fade));
            mainRenderer.SetPropertyBlock(block);
            underRenderer.SetPropertyBlock(block);
            bodyRenderer.SetPropertyBlock(block);
            crownRenderer.SetPropertyBlock(block);
            if (fadeTarget <= 0 && fade <= 0.005f)
            {
                Destroy(gameObject);
                return;
            }

            crownTimer -= dt;
            if (!charging && crownTimer <= 0 && fade > 0.3f)
            {
                crownTimer = 0.18f;
                EmitCrown();
            }
            dustTimer -= dt;
            if (dustTimer <= 0 && fade > 0.3f)
            {
                dustTimer = 0.16f;
                EmitSkirt();
            }
        }

        void SetNoiseLayer(Renderer renderer, int mode, Color a, Color b, float opacity)
        {
            if (!renderer) return;
            block.SetInt(ModeId, mode);
            block.SetColor(ColorAId, a);
            block.SetColor(ColorBId, b);
            block.SetFloat(AlphaId, opacity);
            renderer.SetPropertyBlock(block);
        }

        Vector3 RestAxis(float u)
        {
            float sway = u * u * 0.22f;
            float bend = Mathf.Pow(u, 1.65f) * 0.52f;
            var shear = -travel * (u * u * height * 0.11f);
            return new Vector3(Mathf.Sin(u * 4.4f - time * 1.35f) * sway + bend, u * height,
                Mathf.Cos(u * 3.2f - time * 1.1f) * sway - bend * 0.38f) + shear;
        }

        void InitializeSkeleton()
        {
            for (int i = 0; i < SkeletonPieces; i++)
            {
                skeleton[i] = RestAxis(i / (float)(SkeletonPieces - 1));
                skeletonVelocity[i] = Vector3.zero;
            }
        }

        void UpdateSkeleton(float dt)
        {
            float h = Mathf.Min(dt, 1f / 30f);
            skeleton[0] = RestAxis(0);
            skeletonVelocity[0] = Vector3.zero;
            for (int i = 1; i < SkeletonPieces; i++)
            {
                float u = i / (float)(SkeletonPieces - 1);
                var target = RestAxis(u);
                var acceleration = (target - skeleton[i]) * 18f - skeletonVelocity[i] * 7f;
                acceleration += (skeleton[i - 1] - skeleton[i]) * 24f;
                if (i + 1 < SkeletonPieces) acceleration += (skeleton[i + 1] - skeleton[i]) * 24f;
                skeletonVelocity[i] += acceleration * h;
                skeleton[i] += skeletonVelocity[i] * h;
                skeleton[i].y = target.y;
            }
        }

        Vector3 Axis(float u)
        {
            float x = Mathf.Clamp01(u) * (SkeletonPieces - 1);
            int i = Mathf.Min(SkeletonPieces - 2, Mathf.FloorToInt(x));
            var result = Vector3.Lerp(skeleton[i], skeleton[i + 1], x - i);
            result.y = u * height;
            return result;
        }

        static float Hash(int b, int k) => Mathf.Repeat(Mathf.Sin(b * 12.9898f + k * 78.233f) * 43758.5453f, 1f);

        void UpdateStrokes()
        {
            for (int b = 0; b < Bands; b++)
            {
                bool outer = b >= 12;
                float start = b == 0 ? 0f : b == 1 ? 0.12f : outer ? 0.16f + Hash(b, 1) * 0.5f : Hash(b, 1) * 0.3f;
                float span = b == 0 ? 1f : b == 1 ? 0.82f : outer ? 0.2f + Hash(b, 2) * 0.2f : 0.58f + Hash(b, 2) * 0.36f;
                for (int i = 0; i <= Segments; i++)
                {
                    float v = i / (float)Segments;
                    float u = Mathf.Clamp01(start + span * v);
                    float angle = b * 2.39f + time * (outer ? 4.4f + Hash(b, 3) * 2f : 2.2f + Hash(b, 3) * 2.1f)
                        + Mathf.Pow(u, 0.9f) * (4.2f + Hash(b, 4) * 4.4f) + v * 0.45f;
                    float radius = Mathf.Lerp(0.2f, topRadius, Mathf.Pow(u, 1.42f)) * (outer ? 1.18f + Hash(b, 5) * 0.22f : 0.82f + Hash(b, 5) * 0.3f);
                    var radial = new Vector3(Mathf.Sin(angle), 0, Mathf.Cos(angle));
                    float taper = Mathf.Pow(Mathf.Sin(v * Mathf.PI), outer ? 0.72f : 0.35f);
                    float width = outer ? 0.025f + Hash(b, 6) * 0.035f : Mathf.Lerp(0.14f, 0.52f, u) * (0.7f + Hash(b, 6) * 0.65f);
                    width *= taper;
                    var center = Axis(u) + radial * radius;
                    var lift = Vector3.up * (width * 0.5f) + radial * (width * 0.18f);
                    int k = b * (Segments + 1) * 3 + i * 3;
                    mainVertices[k] = center + lift;
                    mainVertices[k + 1] = center;
                    mainVertices[k + 2] = center - lift;
                    int u2 = b * (Segments + 1) * 2 + i * 2;
                    underVertices[u2] = center + lift * 1.15f - radial * 0.02f;
                    underVertices[u2 + 1] = center - lift * 1.15f - radial * 0.02f;
                }
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

            var crownAxis = Axis(1f);
            for (int y = 0; y < 3; y++)
            {
                float v = y / 2f;
                for (int x = 0; x <= CrownSegments; x++)
                {
                    float a = x / (float)CrownSegments * Mathf.PI * 2f + time * Mathf.Lerp(0.85f, 0.32f, v);
                    float radius = Mathf.Lerp(topRadius * 0.48f, topRadius * 1.3f, v) * (1f + 0.12f * Mathf.Sin(a * 4f - time * 1.6f));
                    float lift = Mathf.Sin(a * 3f - time * 2.1f) * 0.13f + Mathf.Sin(a * 5f + time) * 0.05f + v * 0.12f
                        + Mathf.Sin(a) * radius * 0.22f - Mathf.Cos(a) * radius * 0.1f;
                    crownVertices[y * (CrownSegments + 1) + x] = crownAxis + new Vector3(Mathf.Sin(a) * radius, lift, Mathf.Cos(a) * radius);
                }
            }
            crownMesh.SetVertices(crownVertices);
        }

        void EmitCrown()
        {
            float a = Random.value * Mathf.PI * 2f;
            var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var center = transform.position + Axis(1f);
            float layer = Random.value;
            var at = center + d * topRadius * Random.Range(0.55f, 0.9f) + Vector3.up * Random.Range(-0.08f, 0.12f);
            var tangent = Vector3.Cross(Vector3.up, d) * Mathf.Lerp(1.8f, 0.65f, layer);
            var velocity = tangent + d * Mathf.Lerp(0.25f, 1.15f, layer) + Vector3.up * 0.2f;
            Fx.LdOne("ToonSmoke", at, velocity, Mathf.Lerp(0.75f, 1.35f, layer), 0.52f, Fx.LdAlpha(Cloud, 0.62f), false);
        }

        void EmitSkirt()
        {
            var at = transform.position;
            var dust = FxTone.Ground(Hex.Rgb(0xa08a6a));
            float a = Random.value * Mathf.PI * 2f;
            var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var tangent = Vector3.Cross(Vector3.up, d);
            Fx.LdOne("ToonSmoke", at + d * 0.55f + Vector3.up * 0.25f, tangent * 4.2f - travel * 1.5f + Vector3.up * 0.8f,
                Random.Range(0.9f, 1.3f), 0.58f, Fx.LdAlpha(dust, 0.82f), false);
            Fx.LdMany("Chunk", 2, i =>
            {
                float h = Random.Range(0.35f, height * 0.72f);
                float u = h / height;
                var p = at + d * Mathf.Lerp(0.35f, topRadius, u * u) + Vector3.up * h;
                return (p, tangent * Random.Range(4.5f, 6.5f) + Vector3.up * 1.4f, Random.Range(0.1f, 0.16f), 0.62f);
            }, dust);
            if (travel.sqrMagnitude > 0.1f)
                Fx.LdMany("Spray", 2, i =>
                {
                    var side = Vector3.Cross(Vector3.up, travel) * (i == 0 ? -0.65f : 0.65f);
                    var p = at - travel * Random.Range(0.2f, 0.8f) + side + Vector3.up * 0.16f;
                    return (p, -travel * 5.5f + Vector3.up * 0.3f, 0.055f, 0.32f);
                }, Wind);
        }

        public void SetTravel(Vector3 direction)
        {
            charging = false;
            direction.y = 0;
            travel = direction.sqrMagnitude > 1e-4f ? direction.normalized : Vector3.zero;
            bodyRenderer.enabled = crownRenderer.enabled = true;
        }

        public void SetCharge(float k)
        {
            charging = true;
            k = Mathf.Clamp01(k);
            transform.localScale = Vector3.one * Mathf.Lerp(0.22f, 0.72f, k * k * (3f - 2f * k));
            alpha = Mathf.Lerp(0.25f, 0.9f, k);
            bodyRenderer.enabled = k > 0.42f;
            crownRenderer.enabled = k > 0.76f;
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
            if (crownMesh) Destroy(crownMesh);
        }
    }
}
