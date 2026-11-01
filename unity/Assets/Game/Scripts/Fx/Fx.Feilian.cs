using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>飞廉的色板（docs/art/vfx/feilian.md 第 0 节：风伯 / 风涡 / 风雷珠，三阶色；冰舌是亮白雪地，风一律带灰蓝暗边）</summary>
    public static class FeilianPalette
    {
        /// <summary>风：近白芯 / 风青 / 灰蓝暗边</summary>
        public static readonly Color WindCore = Hex.Rgb(0xf4fbff), Wind = Hex.Rgb(0xbfe6f5), WindEdge = Hex.Rgb(0x6f8fa8);
        /// <summary>风雷珠（风裹雷）：近白 / 珠紫 / 靛紫</summary>
        public static readonly Color OrbCore = Hex.Rgb(0xfbf6ff), Orb = Hex.Rgb(0xb48cff), OrbEdge = Hex.Rgb(0x4a3a8a);
        /// <summary>火龙卷：金黄芯 / 橙 / 赭红</summary>
        public static readonly Color FireCore = Hex.Rgb(0xffe08a), Fire = Hex.Rgb(0xff8a3a), FireEdge = Hex.Rgb(0xa8381a);
        /// <summary>冰舌雪尘：冷白 / 雪影蓝灰</summary>
        public static readonly Color Snow = Hex.Rgb(0xe6f0f8), SnowShade = Hex.Rgb(0x9fb4c8);
    }

    /// <summary>
    /// 螺旋带柱（风涡柱、龙卷风柱、火龙卷、迅捷精英龙卷）：几条往上收紧再外翻的螺旋带，暗边垫底（普通混合）+ 亮带（普通混合，芯更亮），整体自转。
    /// 一张程序网格（不发粒子），可按需让底部每帧卷几团雪 / 火星（过预算）。fire = 火龙卷配色 + 柱身爬火舌
    /// </summary>
    public sealed class FeilianSpiral : MonoBehaviour
    {
        const int Ribbons = 3, Segs = 36;

        MeshRenderer topR, underR;
        Mesh top, under;
        static MaterialPropertyBlock block;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        float height, r0, r1, spin, alpha = 1f, fade = 1f, fadeTarget = 1f, puffAcc, ribbonWidth = 1f;
        bool fire, ambient;

        public bool Fire => fire;
        public float Height => height;
        /// <summary>整体透明度（0..1，渐隐 / 渐显）</summary>
        public float Alpha => alpha;

        /// <summary>建一根柱：底半径 r0、顶半径 r1、高 h；spinDeg = 每秒自转（负 = 反向）；ambient = 柱脚自动卷雪 / 火；ribbonWidth = 风带厚度倍率</summary>
        public static FeilianSpiral Create(Vector3 ground, float r0, float r1, float h, float spinDeg, Transform parent = null, bool ambient = true, float ribbonWidth = 1f)
        {
            var go = new GameObject("FeilianSpiral");
            go.transform.SetParent(parent, true);
            go.transform.position = ground;
            var s = go.AddComponent<FeilianSpiral>();
            s.r0 = r0;
            s.r1 = r1;
            s.height = h;
            s.spin = spinDeg;
            s.ambient = ambient;
            s.ribbonWidth = Mathf.Max(0.1f, ribbonWidth);
            s.Build();
            s.fade = 0;
            s.fadeTarget = 1;
            return s;
        }

        void Build()
        {
            under = MakeMesh("under");
            top = MakeMesh("top");
            underR = AddRenderer("Under", under, FxMaterials.AlphaBlend, -1);
            topR = AddRenderer("Top", top, FxMaterials.AlphaBlend, 0);
            Paint();
        }

        MeshRenderer AddRenderer(string n, Mesh m, Material mat, int order)
        {
            var go = new GameObject(n);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            return r;
        }

        Mesh MakeMesh(string n)
        {
            bool und = n == "under";
            var verts = new List<Vector3>();
            var tris = new List<int>();
            var uv = new List<Vector2>();
            for (int b = 0; b < Ribbons; b++)
            {
                int start = verts.Count;
                float a0 = b * Mathf.PI * 2 / Ribbons;
                for (int i = 0; i <= Segs; i++)
                {
                    float u = i / (float)Segs;
                    float y = u * height;
                    // 往上先收紧再外翻（漏斗口）
                    float r = Mathf.Lerp(r0, r1, u * u) * (1f + 0.15f * Mathf.Sin(u * Mathf.PI));
                    float a = a0 + u * Mathf.PI * 3.2f;
                    var c = new Vector3(Mathf.Sin(a) * r, y, Mathf.Cos(a) * r);
                    float w = Mathf.Lerp(0.5f, 1.4f, u) * (und ? 1.45f : 1f) * ribbonWidth;
                    verts.Add(c + Vector3.up * w * 0.5f);
                    verts.Add(c - Vector3.up * w * 0.5f);
                    uv.Add(new Vector2(u, 1));
                    uv.Add(new Vector2(u, 0));
                    if (i == 0) continue;
                    int k = start + i * 2;
                    tris.Add(k - 2);
                    tris.Add(k - 1);
                    tris.Add(k);
                    tris.Add(k);
                    tris.Add(k - 1);
                    tris.Add(k + 1);
                }
            }
            var m = new Mesh { name = "FeilianSpiral_" + n };
            m.SetVertices(verts);
            m.SetUVs(0, uv);
            m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            // 双面：再加一份反向三角
            var t2 = new List<int>(tris);
            for (int i = 0; i < tris.Count; i += 3)
            {
                t2.Add(tris[i]);
                t2.Add(tris[i + 2]);
                t2.Add(tris[i + 1]);
            }
            m.SetTriangles(t2, 0);
            return m;
        }

        void Paint()
        {
            Color c0 = fire ? FeilianPalette.FireCore : FeilianPalette.WindCore, c1 = fire ? FeilianPalette.Fire : FeilianPalette.Wind,
                ce = fire ? FeilianPalette.FireEdge : FeilianPalette.WindEdge;
            PaintMesh(top, c1, c0, 0.85f);
            PaintMesh(under, ce, ce, 0.6f);
        }

        void PaintMesh(Mesh m, Color body, Color hot, float a)
        {
            if (!m) return;
            int n = m.vertexCount;
            var cols = new Color[n];
            var uv = new List<Vector2>();
            m.GetUVs(0, uv);
            for (int i = 0; i < n; i++)
            {
                float u = uv[i].x;
                // 两端渐隐、中段实；亮带的上沿偏亮（芯）
                float edge = Mathf.Clamp01(u / 0.12f) * Mathf.Clamp01((1 - u) / 0.2f);
                var c = Color.Lerp(body, hot, uv[i].y * 0.6f);
                c.a = a * edge;
                cols[i] = FxVertexColor.Linear(c);
            }
            m.colors = cols;
        }

        /// <summary>点着：变火龙卷（换火的三阶色）</summary>
        public void SetFire(bool on)
        {
            if (fire == on) return;
            fire = on;
            Paint();
        }

        /// <summary>开始渐隐（seconds 秒），之后销毁</summary>
        public void FadeOut(float seconds)
        {
            fadeTarget = 0;
            fadeSpeed = 1f / Mathf.Max(0.05f, seconds);
        }

        float fadeSpeed = 2f;

        /// <summary>反过来转（风眼：风向反了）</summary>
        public void Reverse() => spin = -spin;

        /// <summary>整体透明度倍率（风涡柱散开）</summary>
        public void SetAlpha(float a) => alpha = Mathf.Clamp01(a);

        void Update()
        {
            float dt = Time.deltaTime;
            fade = Mathf.MoveTowards(fade, fadeTarget, dt * (fadeTarget > fade ? 3f : fadeSpeed));
            transform.Rotate(0, spin * dt * (fire ? 1.6f : 1f), 0, Space.World);
            block ??= new MaterialPropertyBlock();
            float k = alpha * fade;
            foreach (var r in new[] { topR, underR })
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor(BaseColor, new Color(1, 1, 1, k));
                r.SetPropertyBlock(block);
            }
            if (fadeTarget <= 0 && fade <= 0.001f)
            {
                Destroy(gameObject);
                return;
            }
            // 底部卷雪 / 火：每秒 8 团（过预算）
            puffAcc += dt;
            if (!ambient || puffAcc < 0.12f || k < 0.2f) return;
            puffAcc = 0;
            var p = transform.position + Random.insideUnitSphere * r0;
            p.y = transform.position.y + 0.3f;
            var tangent = Vector3.Cross(Vector3.up, p - transform.position).normalized * Mathf.Sign(spin);
            if (fire)
            {
                Fx.LdMany("ToonFlame", 1, i => (transform.position + Vector3.up * Random.Range(0.5f, height * 0.8f) + Random.insideUnitSphere * r0, Vector3.up * 3f, Random.Range(0.6f, 1f), 0.5f),
                    FeilianPalette.Fire);
                Fx.LdMany("Ember", 2, i => (p, tangent * 4f + Vector3.up * Random.Range(3f, 6f), 0.12f, 0.6f), FeilianPalette.FireCore);
            }
            else Fx.LdMany("ToonSmoke", 1, i => (p, tangent * 5f + Vector3.up * 1.5f, Random.Range(0.8f, 1.2f), 0.6f), Fx.LdAlpha(FeilianPalette.Snow, 0.85f));
        }

        void OnDestroy()
        {
            if (top) Destroy(top);
            if (under) Destroy(under);
        }
    }

    /// <summary>
    /// 风雷珠（鹿角之间、orb 骨上）：一颗被两圈薄环缠着转的珠——芯近白、珠紫光晕、两圈环（风）；
    /// 风雷爆蓄力时胀大、环转得更快变成锯齿感（加抖）；珠碎后藏起，重新长出来时从米粒大慢慢长回
    /// </summary>
    public sealed class FeilianOrb : MonoBehaviour
    {
        Transform core, glow, ringA, ringB;
        Renderer coreR, ringAR, ringBR;
        Mesh ringMesh;
        static MaterialPropertyBlock block;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        float grow = 1f, storm;

        /// <summary>风雷爆的蓄力 0..1（胀大、转快、发亮）</summary>
        public float Storm
        {
            get => storm;
            set => storm = Mathf.Clamp01(value);
        }

        /// <summary>重新长出来的进度 0..1（珠碎后从 0 长回 1）</summary>
        public float Grow
        {
            get => grow;
            set => grow = Mathf.Clamp01(value);
        }

        public static FeilianOrb Attach(Transform bone, float radius)
        {
            var go = new GameObject("FeilianOrb");
            go.transform.SetParent(bone, false);
            var o = go.AddComponent<FeilianOrb>();
            o.Build(radius / Mathf.Max(1e-3f, bone.lossyScale.x));
            return o;
        }

        void Build(float r)
        {
            var sph = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Destroy(sph.GetComponent<Collider>());
            sph.name = "Core";
            sph.transform.SetParent(transform, false);
            sph.transform.localScale = Vector3.one * r * 1.4f;
            coreR = sph.GetComponent<Renderer>();
            coreR.sharedMaterial = FxMaterials.Unlit;
            coreR.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            core = sph.transform;
            glow = FxMaterials.GlowSprite(transform, r * 4.5f, Fx.LdAlpha(FeilianPalette.Orb, 0.55f));
            ringMesh = RingMesh(r * 1.6f, r * 0.12f);
            ringA = Ring("RingA", out ringAR);
            ringB = Ring("RingB", out ringBR);
            ringA.localRotation = Quaternion.Euler(70, 0, 0);
            ringB.localRotation = Quaternion.Euler(-30, 60, 0);
        }

        Transform Ring(string n, out Renderer r)
        {
            var go = new GameObject(n);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = ringMesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = FxMaterials.AlphaBlend;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r = mr;
            return go.transform;
        }

        static Mesh RingMesh(float radius, float width)
        {
            const int n = 40;
            var v = new Vector3[n * 2];
            var c = new Color[n * 2];
            var t = new List<int>();
            for (int i = 0; i < n; i++)
            {
                float a = i * Mathf.PI * 2 / n;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v[i * 2] = d * (radius + width);
                v[i * 2 + 1] = d * (radius - width);
                c[i * 2] = FxVertexColor.Linear(Fx.LdAlpha(FeilianPalette.Wind, 0.9f));
                c[i * 2 + 1] = FxVertexColor.Linear(Fx.LdAlpha(FeilianPalette.WindCore, 0.9f));
                int j = (i + 1) % n;
                t.AddRange(new[] { i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1, i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1 });
            }
            var m = new Mesh { name = "FeilianOrbRing", vertices = v, colors = c };
            m.SetTriangles(t, 0);
            m.RecalculateBounds();
            return m;
        }

        void Update()
        {
            float t = Time.time;
            float s = grow * (1f + 0.12f * Mathf.Sin(t * 7f)) * (1f + 1.2f * storm);
            transform.localScale = Vector3.one * Mathf.Max(0.01f, s);
            float spinK = 1f + 3f * storm;
            if (ringA) ringA.Rotate(0, 220f * spinK * Time.deltaTime, 0, Space.Self);
            if (ringB) ringB.Rotate(0, -160f * spinK * Time.deltaTime, 0, Space.Self);
            if (storm > 0 && ringA) ringA.localPosition = Random.insideUnitSphere * 0.04f * storm;
            block ??= new MaterialPropertyBlock();
            if (coreR)
            {
                coreR.GetPropertyBlock(block);
                block.SetColor(BaseColor, Color.Lerp(Color.Lerp(FeilianPalette.Orb, FeilianPalette.OrbCore, 0.55f), FeilianPalette.OrbCore, storm));
                coreR.SetPropertyBlock(block);
            }
        }

        void OnDestroy()
        {
            if (ringMesh) Destroy(ringMesh);
        }

        public void SetVisible(bool on) => gameObject.SetActive(on);
    }

    /// <summary>
    /// 风刃（飞廉 blades）：一道敌方月牙（暗托 + 亮刃，两端尖、带收锋），20 m/s 平飞，拖两条风线；碰到世界几何散成一团雪 + 短风线。
    /// 判定在这里（带半径的线段对玩家胶囊，同 BossHazards.SegmentHitsPlayer），伤害交给回调
    /// </summary>
    public sealed class FeilianBlade : MonoBehaviour
    {
        Vector3 vel;
        float life, radius, trailAcc;
        System.Action<Vector3> onHit;
        BossHazards hazards;
        Mesh mesh;
        bool done;

        public static FeilianBlade Spawn(Vector3 from, Vector3 velocity, float life, float hitRadius, BossHazards hazards, System.Action<Vector3> onHit)
        {
            var go = new GameObject("FeilianBlade");
            go.transform.position = from;
            go.transform.rotation = Quaternion.LookRotation(velocity.normalized);
            var b = go.AddComponent<FeilianBlade>();
            b.vel = velocity;
            b.life = life;
            b.radius = hitRadius;
            b.hazards = hazards;
            b.onHit = onHit;
            b.Build();
            return b;
        }

        void Build()
        {
            mesh = Crescent(1.6f, 0.45f);
            var under = new GameObject("Under");
            under.transform.SetParent(transform, false);
            under.transform.localScale = Vector3.one * 1.15f;
            under.AddComponent<MeshFilter>().sharedMesh = mesh;
            var ur = under.AddComponent<MeshRenderer>();
            ur.sharedMaterial = FxMaterials.AlphaBlend;
            var block = new MaterialPropertyBlock();
            block.SetColor(Shader.PropertyToID("_BaseColor"), new Color(FeilianPalette.WindEdge.r * 0.6f, FeilianPalette.WindEdge.g * 0.6f, FeilianPalette.WindEdge.b * 0.6f, 0.75f));
            ur.SetPropertyBlock(block);
            var topGo = new GameObject("Blade");
            topGo.transform.SetParent(transform, false);
            topGo.transform.localPosition = Vector3.up * 0.02f;
            topGo.AddComponent<MeshFilter>().sharedMesh = mesh;
            var tr = topGo.AddComponent<MeshRenderer>();
            tr.sharedMaterial = FxMaterials.AlphaBlend;
            foreach (var r in new[] { ur, tr }) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }

        /// <summary>水平月牙：开口朝后，宽 halfSpan × 2，最厚 thick（两端尖）</summary>
        static Mesh Crescent(float halfSpan, float thick)
        {
            const int n = 16;
            var v = new Vector3[(n + 1) * 2];
            var c = new Color[v.Length];
            var t = new List<int>();
            for (int i = 0; i <= n; i++)
            {
                float u = i / (float)n, s = Mathf.Lerp(-1f, 1f, u);
                float bend = (1 - s * s) * halfSpan * 0.45f;
                float th = thick * Mathf.Sin(u * Mathf.PI);
                var front = new Vector3(s * halfSpan, 0, bend);
                v[i * 2] = front;
                v[i * 2 + 1] = front - Vector3.forward * th;
                c[i * 2] = FxVertexColor.Linear(FeilianPalette.WindCore);
                c[i * 2 + 1] = FxVertexColor.Linear(Fx.LdAlpha(FeilianPalette.Wind, 0.75f));
                if (i == 0) continue;
                int k = i * 2;
                t.AddRange(new[] { k - 2, k - 1, k, k, k - 1, k + 1, k - 2, k, k - 1, k, k + 1, k - 1 });
            }
            var m = new Mesh { name = "FeilianBlade", vertices = v, colors = c };
            m.SetTriangles(t, 0);
            m.RecalculateBounds();
            return m;
        }

        void Update()
        {
            if (done) return;
            float dt = Time.deltaTime;
            life -= dt;
            var p = transform.position;
            var step = vel * dt;
            if (Physics.SphereCast(p, 0.25f, step.normalized, out var hit, step.magnitude, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                Burst(hit.point);
                return;
            }
            var next = p + step;
            if (hazards && hazards.SegmentHitsPlayer(p, next, radius))
            {
                onHit?.Invoke(next);
                Burst(next);
                return;
            }
            transform.position = next;
            trailAcc += dt;
            if (trailAcc > 0.05f)
            {
                trailAcc = 0;
                Fx.LdMany("Spray", 1, i => (next - vel.normalized * 0.5f + transform.right * (Random.value < 0.5f ? -1f : 1f) * 1.1f, -vel * 0.15f, 0.3f, 0.2f), FeilianPalette.Wind);
            }
            if (life <= 0) Burst(next);
        }

        void Burst(Vector3 at)
        {
            done = true;
            Fx.LdMany("ToonSmoke", 2, i => (at + Random.insideUnitSphere * 0.4f, Random.insideUnitSphere * 2f + Vector3.up, Random.Range(0.6f, 0.9f), 0.45f), Fx.LdAlpha(FeilianPalette.Snow, 0.85f));
            Fx.LdMany("Spray", 4, i => (at, Random.onUnitSphere * Random.Range(5f, 8f), 0.3f, 0.2f), FeilianPalette.WindCore);
            Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (mesh) Destroy(mesh);
        }
    }

    /// <summary>飞廉的招式特效（第四章移植 B1 路，设计单 docs/art/vfx/feilian.md）。只管外观，不碰判定</summary>
    public static partial class Fx
    {
        /// <summary>狂风 / 风雷爆蓄力：空中风痕往珠子收（螺旋流线；k = 前摇进度，越到后面越密）。from = 风痕从哪个方向卷回来（锥口方向；null = 四面八方）</summary>
        public static void FeilianGather(Vector3 orb, Vector3? from, float spread, float k, float dt)
        {
            if (!Finite(orb)) return;
            int n = LdRate(Mathf.Lerp(12f, 48f, k), dt);
            for (int i = 0; i < n; i++)
            {
                Vector3 d;
                if (from.HasValue)
                {
                    var f = from.Value;
                    f.y = 0;
                    d = (Quaternion.Euler(0, Random.Range(-30f, 30f), 0) * f.normalized + Vector3.up * Random.Range(-0.1f, 0.4f)).normalized;
                }
                else d = Random.onUnitSphere;
                var p = orb + d * spread * Random.Range(0.6f, 1f);
                var v = (orb - p) * Random.Range(1.6f, 2.2f) + Vector3.Cross(Vector3.up, orb - p).normalized * 3f;
                LdOne("Spray", p, v, Random.Range(0.3f, 0.45f), 0.4f, i % 3 == 0 ? FeilianPalette.WindEdge : FeilianPalette.Wind, false);
            }
        }

        /// <summary>
        /// 狂风释放帧：一道风锥（Surge 锥，40 m × 口径，条纹往外喷，0.6 s）+ 锥内 24 道风线扫出去 + 蹄下雪冠；radius = 锥口半径
        /// </summary>
        public static void FeilianGust(Vector3 apex, Vector3 dir, float length, float radius)
        {
            if (!Finite(apex)) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            Surge.Cone(apex + Vector3.up * 0.4f, dir, length, radius, SurgeKind.Water, 0.08f, 0.35f, 0.3f, FeilianPalette.Wind, FeilianPalette.WindCore, -2.4f, 0.45f);
            float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, half = Mathf.Atan2(radius, length) * Mathf.Rad2Deg;
            LdMany("Spray", 24, i =>
            {
                var d = LdDir(yaw + Random.Range(-half, half));
                return (apex + d * Random.Range(1f, 4f) + Vector3.up * Random.Range(0.3f, 2.5f), d * Random.Range(22f, 32f), Random.Range(0.4f, 0.6f), Random.Range(0.5f, 0.9f));
            }, FeilianPalette.WindCore);
            LdMany("Spray", 10, i =>
            {
                var d = LdDir(yaw + Random.Range(-half, half));
                return (apex + d * Random.Range(2f, 8f) + Vector3.up * 0.15f, d * Random.Range(16f, 22f), Random.Range(0.35f, 0.5f), Random.Range(0.6f, 1f));
            }, FeilianPalette.WindEdge);
            FeilianSnowCrown(apex, 1f);
        }

        /// <summary>蹄下 / 落地的雪冠（Surge 冠，冷白）+ 一圈雪团</summary>
        public static void FeilianSnowCrown(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            Surge.Crown(at, 1.4f * size, 1.8f * size, SurgeKind.Water, 0.6f, FeilianPalette.Snow, FeilianPalette.WindCore, 0.8f);
            LdMany("ToonSmoke", Mathf.RoundToInt(5 * size), i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (at + new Vector3(d.x, 0.25f, d.y) * 1.2f * size, new Vector3(d.x, 0.3f, d.y) * Random.Range(3f, 5f) * size, Random.Range(1f, 1.5f) * size, 0.6f);
            }, LdAlpha(FeilianPalette.Snow, 0.9f));
        }

        /// <summary>刨冰 / 起跳：蹄后甩一把冰屑 + 一团雪</summary>
        public static void FeilianPaw(Vector3 hoof, Vector3 back)
        {
            if (!Finite(hoof)) return;
            back.y = 0;
            back = back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.back;
            LdMany("ShardIce", 8, i => (hoof + Vector3.up * 0.2f, (back + Random.insideUnitSphere * 0.4f) * Random.Range(4f, 7f) + Vector3.up * Random.Range(2f, 4f), Random.Range(0.08f, 0.14f), 0.5f),
                FeilianPalette.Snow);
            LdOne("ToonSmoke", hoof + back * 0.5f + Vector3.up * 0.3f, back * 2f + Vector3.up, 1f, 0.5f, LdAlpha(FeilianPalette.Snow, 0.85f), false);
        }

        /// <summary>擂台常驻风：在 at 处贴地刮一道风线（风向 dir）</summary>
        public static void FeilianGroundWind(Vector3 at, Vector3 dir, float strength)
        {
            if (!Finite(at)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            LdOne("Spray", at + Vector3.up * 0.25f, dir * Mathf.Lerp(6f, 12f, strength), Random.Range(0.35f, 0.5f), 0.45f, FeilianPalette.WindEdge, false);
            if (Random.value < 0.5f) LdOne("Spray", at + Vector3.up * 0.6f, dir * Mathf.Lerp(8f, 14f, strength), 0.3f, 0.4f, FeilianPalette.Wind, false);
        }

        /// <summary>冲撞撞到玩家 / 撞上冰脊：角前一道白月牙 + 爆闪 + 冰屑</summary>
        public static void FeilianCrash(Vector3 head, float yaw, bool wall)
        {
            if (!Finite(head)) return;
            Slash(head, yaw, 2.2f, 1.6f, 1, 0.2f, 0.5f, 0.12f, FeilianPalette.WindCore, true);
            LdOne("ToonBurst", head, Vector3.zero, wall ? 3.6f : 2.6f, 0.12f, FeilianPalette.WindCore);
            if (wall) LdMany("ShardIce", 20, i => (head, Random.onUnitSphere * Random.Range(4f, 9f) + Vector3.up * 2f, Random.Range(0.1f, 0.2f), 0.6f), FeilianPalette.Snow);
        }

        /// <summary>撞晕：头顶一圈小风涡（三团白风线绕头转）</summary>
        public static void FeilianDizzy(Vector3 head, float dt)
        {
            if (!Finite(head) || Random.value > dt * 10f) return;
            float a = Time.time * 6f + Random.value;
            var p = head + Vector3.up * 0.8f + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * 0.9f;
            LdOne("Spray", p, new Vector3(Mathf.Cos(a), 0, -Mathf.Sin(a)) * 4f, 0.25f, 0.25f, FeilianPalette.WindCore, false);
        }

        /// <summary>风雷爆释放帧：珠位白爆闪 + 一圈风雷冲击环（珠紫亮边 + 风青环身，0.35 s）+ 12 道紫红电弧往外 + 雪冠大号</summary>
        public static void FeilianStormBurst(Vector3 orb, Vector3 ground, float radius)
        {
            if (!Finite(orb)) return;
            LdOne("ToonBurst", orb, Vector3.zero, 6f, 0.16f, FeilianPalette.OrbCore);
            Flash(orb, FeilianPalette.Orb, 10f, radius * 1.6f, 0.2f);
            Ring(ground + Vector3.up * 0.1f, radius, FeilianPalette.Orb, 0.35f);
            Surge.Annulus(ground + Vector3.up * 0.08f, radius * 0.6f, radius, SurgeKind.Water, 0.5f, 240f, 1.6f, FeilianPalette.Wind, FeilianPalette.WindCore, 0.6f);
            for (int i = 0; i < 12; i++)
            {
                float a = i * 30f + Random.Range(-8f, 8f);
                var end = ground + LdDir(a) * radius * Random.Range(0.8f, 1f) + Vector3.up * 0.4f;
                Lightning(orb, end, TelegraphPalette.Thunder, 0.06f);
            }
            FeilianSnowCrown(ground, 1.8f);
        }

        /// <summary>珠碎：白爆闪 + 两圈薄环崩成 16 道风线四散 + 一团紫电火星</summary>
        public static void FeilianOrbShatter(Vector3 orb)
        {
            if (!Finite(orb)) return;
            LdOne("ToonBurst", orb, Vector3.zero, 4.2f, 0.14f, FeilianPalette.OrbCore);
            Flash(orb, FeilianPalette.Orb, 8f, 12f, 0.18f);
            LdMany("Spray", 16, i => (orb, Random.onUnitSphere * Random.Range(8f, 13f), Random.Range(0.4f, 0.55f), 0.45f), FeilianPalette.WindCore);
            LdMany("Crackle", 12, i => (orb, Random.onUnitSphere * Random.Range(3f, 7f), Random.Range(0.12f, 0.2f), 0.4f), FeilianPalette.Orb);
        }

        /// <summary>火龙卷点着的那一下：橙爆 + 火星</summary>
        public static void FeilianIgnite(Vector3 at)
        {
            if (!Finite(at)) return;
            LdOne("ToonBurst", at, Vector3.zero, 3.2f, 0.14f, FeilianPalette.FireCore);
            LdMany("Ember", 14, i => (at + Random.insideUnitSphere, Random.onUnitSphere * 5f + Vector3.up * 3f, 0.14f, 0.6f), FeilianPalette.Fire);
        }
    }
}
