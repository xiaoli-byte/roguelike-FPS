using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 间歇熔泉（第三章 v2 S3，M32 拥有；3-2 ④ 熔泉炉坛、3-4 神道用）：喷口外观 + 熔柱网格 + LavaGeyser 组件。
    //   · 喷口：有正式件就用它的两个部件（docs/art/ch3-kit.md 第 3 节）——SM_Tripo_InfernoGeyserVentBase（底座锥，顶 1.31）+ SM_Tripo_InfernoGeyserVentCrust
    //     （顶部岩壳 2.8 × 0.93 × 2.8，原点在底座上 1.15 m）：岩壳就是靶子，射爆后藏起来、喷完再结上；喷柱从 FX_GeyserJet（2.08 m）往上。只有整件时摆整件。
    //     都没有就用程序壳（ch3-v2 6.3「没有它时 S3 用程序壳 + 现有 Basalt」，不算白盒）：
    //     一圈矮玄武岩锥（不规则的八棱台）+ 中间结壳的圆盖 + 壳缝一圈自发光的熔岩光（预警时由组件调亮）+ 三四块 SM_Env_InfernoBasalt 压边。
    //   · 岩壳：圆盖的碰撞体就是靶子（LavaGeyser 运行时挂命中盒）；喷口高 0.35 m，走得上去（台阶 0.45 m 以内），导航网格照常烘。
    //   · 熔柱：上细下粗、表面起伏的管子，喂熔岩着色器（uv 约定同 LavaVolume.BuildMesh：uv1 = 半周长 / 很长 / 盒 / 不按深度，uv2 = 往上流），
    //     高 1 m 存成资产，运行时按 height 缩放；没有碰撞、不投影，平时藏着。
    // 用法（3-4 照抄）：
    //   var g = LevelKit.PlaceLavaGeyser(Dir, "Geyser 1", world, groundPoint, new LevelKit.GeyserSpec { period = 8, phase = 0.25f, activeSite = site });
    //   g.EruptNow();  // 演出：马上喷一次
    public static partial class LevelKit
    {
        public const string GeyserVentId = "SM_Tripo_InfernoGeyserVent", GeyserBaseId = "SM_Tripo_InfernoGeyserVentBase", GeyserCrustId = "SM_Tripo_InfernoGeyserVentCrust";
        /// <summary>正式喷口：外圈半径（发布尺度 6.72 宽）、岩壳原点高、喷柱起点高（FX_GeyserJet）</summary>
        const float VentArtRadius = 3.36f, CrustAt = 1.15f, JetAt = 2.08f;

        /// <summary>间歇熔泉的摆放参数（缺省 = ch3-v2 2.7：预警 1.2 s、喷 1.5 s、熔柱半径 2.2 m、高 9 m）</summary>
        public sealed class GeyserSpec
        {
            /// <summary>周期（秒）与相位（周期的分数）：同一组熔泉错开喷</summary>
            public float period = 8f, phase;
            public float warnTime = 1.2f, eruptTime = 1.5f;
            /// <summary>熔柱半径（米，也是伤害半径 / 预警圈）、高度（米）</summary>
            public float radius = 2.2f, height = 9f;
            /// <summary>开局就按周期喷；给了 activeSite 时只在那个场地交战时喷</summary>
            public bool startActive = true;
            public EncounterSite activeSite;
            /// <summary>玩家：扣最大生命比例、掀起速度；敌人：扣最大生命比例、掀起速度</summary>
            public float playerDamage = 0.1f, playerLaunch = 11f, enemyDamage = 0.15f, enemyLaunch = 9f;
            /// <summary>岩壳累计吃多少伤害提前引爆（× 本局难度；≤ 0 = 不能射爆）</summary>
            public float shellHp = 45f;
            /// <summary>喷口外圈半径（米，程序壳）</summary>
            public float ventRadius = 3f;
            public int seed = 1;
        }

        /// <summary>
        /// 摆一口间歇熔泉：ground = 喷口中心（地面）。返回 <see cref="LavaGeyser"/>（根物体在地面上，子物体 Vent / Shell / Cracks / Column）
        /// </summary>
        public static LavaGeyser PlaceLavaGeyser(string dir, string name, Transform parent, Vector3 ground, GeyserSpec s = null)
        {
            s ??= new GeyserSpec();
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.position = ground;
            var basalt = Mat(dir, "GeyserBasalt", new Color(0.15f, 0.12f, 0.12f), 0.9f);
            var crust = Mat(dir, "GeyserCrust", new Color(0.1f, 0.08f, 0.08f), 0.95f);
            var glow = GlowMat(dir, "GeyserCrack", new Color(1f, 0.5f, 0.18f), new Color(4f, 1.3f, 0.3f));
            var cracks = new List<Renderer>();
            Transform shell;
            float jet = 0.2f;
            var vent = ShowcaseSceneBuilder.Prefab(GeyserVentId);
            if (ShowcaseSceneBuilder.Prefab(GeyserBaseId) && ShowcaseSceneBuilder.Prefab(GeyserCrustId))
            {
                // 正式件（部件版）：底座 + 岩壳，按喷口外圈缩放
                float k = s.ventRadius / VentArtRadius;
                float yaw = s.seed * 47f % 360f;
                var b = ShowcaseSceneBuilder.Place(GeyserBaseId, root.transform, ground - Vector3.up * 0.1f, yaw, k);
                if (b)
                {
                    b.name = "Vent";
                    b.isStatic = true;
                }
                var c = ShowcaseSceneBuilder.Place(GeyserCrustId, root.transform, ground + Vector3.up * (CrustAt * k - 0.1f), yaw, k);
                if (c) c.name = "Shell";
                shell = c ? c.transform : root.transform;
                jet = JetAt * k - 0.3f;
            }
            else if (vent)
            {
                // 正式件：按喷口外圈缩放（登记 6 m 宽）
                float k = s.ventRadius * 2f / 6f;
                var go = ShowcaseSceneBuilder.Place(GeyserVentId, root.transform, ground - Vector3.up * 0.1f, s.seed * 47f % 360f, k);
                if (go)
                {
                    go.name = "Vent";
                    go.isStatic = true;
                }
                shell = go ? go.transform : root.transform;
                jet = JetAt * k - 0.3f;
            }
            else
            {
                // 程序壳：矮玄武岩锥 + 结壳圆盖 + 壳缝光
                var cone = new GameObject("Vent");
                cone.transform.SetParent(root.transform, false);
                cone.transform.position = ground;
                var mesh = VentMesh(s.ventRadius, s.ventRadius * 0.62f, 0.55f, 0.15f, s.seed);
                SaveAsset(mesh, $"{dir}/Geyser/Mesh_Vent_{SafeName(name)}.asset");
                cone.AddComponent<MeshFilter>().sharedMesh = mesh;
                cone.AddComponent<MeshRenderer>().sharedMaterial = basalt;
                cone.AddComponent<MeshCollider>().sharedMesh = mesh;
                cone.isStatic = true;
                var ring = Cylinder("Cracks", root.transform, ground + Vector3.up * 0.3f, s.ventRadius * 0.6f, 0.12f, Quaternion.identity, glow);
                Object.DestroyImmediate(ring.GetComponent<Collider>());
                ring.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
                ring.isStatic = false;
                cracks.Add(ring.GetComponent<MeshRenderer>());
                var cap = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cap.name = "Shell";
                cap.transform.SetParent(root.transform, false);
                cap.transform.position = ground + Vector3.up * 0.38f;
                cap.transform.localScale = new Vector3(s.ventRadius * 1.08f, 0.09f, s.ventRadius * 1.08f);
                cap.transform.rotation = Quaternion.Euler(0, s.seed * 31f, 0);
                cap.GetComponent<MeshRenderer>().sharedMaterial = crust;
                Object.DestroyImmediate(cap.GetComponent<Collider>());
                var mc = cap.AddComponent<MeshCollider>();
                mc.sharedMesh = cap.GetComponent<MeshFilter>().sharedMesh;
                mc.convex = true;
                cap.isStatic = true;
                shell = cap.transform;
                // 压边的玄武岩块（有就摆，没有就算了）
                if (ShowcaseSceneBuilder.Prefab("SM_Env_InfernoBasalt"))
                {
                    var rnd = new System.Random(s.seed * 7919 + 3);
                    int n = 3 + rnd.Next(2);
                    for (int i = 0; i < n; i++)
                    {
                        float a = (i + (float)rnd.NextDouble() * 0.5f) / n * Mathf.PI * 2f;
                        var at = ground + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * s.ventRadius * 1.05f - Vector3.up * 0.25f;
                        var b = ShowcaseSceneBuilder.Place("SM_Env_InfernoBasalt", root.transform, at, (float)rnd.NextDouble() * 360f, 0.35f + (float)rnd.NextDouble() * 0.25f);
                        if (b) b.isStatic = true;
                    }
                }
            }

            // 熔柱（运行时按高度缩放，平时藏着）
            Transform column = null;
            var lavaMat = LavaMaterial();
            if (lavaMat)
            {
                var col = new GameObject("Column");
                col.transform.SetParent(root.transform, false);
                col.transform.position = ground + Vector3.up * jet;
                var cm = ColumnMesh(s.radius, s.seed);
                SaveAsset(cm, $"{dir}/Geyser/Mesh_GeyserColumn_{SafeName(name)}.asset");
                col.AddComponent<MeshFilter>().sharedMesh = cm;
                var mr = col.AddComponent<MeshRenderer>();
                mr.sharedMaterial = lavaMat;
                mr.shadowCastingMode = ShadowCastingMode.Off;
                mr.lightProbeUsage = LightProbeUsage.Off;
                col.SetActive(false);
                column = col.transform;
            }

            var g = root.AddComponent<LavaGeyser>();
            g.period = s.period;
            g.phase = s.phase;
            g.warnTime = s.warnTime;
            g.eruptTime = s.eruptTime;
            g.radius = s.radius;
            g.height = s.height;
            g.startActive = s.startActive;
            g.activeSite = s.activeSite;
            g.playerDamage = s.playerDamage;
            g.playerLaunch = s.playerLaunch;
            g.enemyDamage = s.enemyDamage;
            g.enemyLaunch = s.enemyLaunch;
            g.shellHp = s.shellHp;
            g.shell = s.shellHp > 0 ? shell : null;
            g.hideShellOnBurst = shell && shell != root.transform && shell.name == "Shell" && ShowcaseSceneBuilder.Prefab(GeyserCrustId);
            g.column = column;
            g.cracks = cracks.ToArray();
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t == root.transform || t == column || cracks.Exists(c => c && c.transform == t) || (g.hideShellOnBurst && t.IsChildOf(shell))) t.gameObject.isStatic = false;
            return g;
        }

        /// <summary>每个三角形再加一个反面（不管着色器剔不剔背面都看得见）</summary>
        static void DoubleSide(List<int> tris)
        {
            int n = tris.Count;
            for (int i = 0; i < n; i += 3) tris.AddRange(new[] { tris[i], tris[i + 2], tris[i + 1] });
        }

        /// <summary>喷口锥：外圈半径 r0（贴地）→ 内圈半径 r1、高 h 的不规则八棱台（每个顶点半径 ± jitter），上口开着（盖子另摆）</summary>
        static Mesh VentMesh(float r0, float r1, float h, float jitter, int seed)
        {
            const int N = 9;
            var rnd = new System.Random(seed * 131 + 17);
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int i = 0; i < N; i++)
            {
                float a = i * Mathf.PI * 2f / N;
                float j0 = 1 + ((float)rnd.NextDouble() * 2 - 1) * jitter, j1 = 1 + ((float)rnd.NextDouble() * 2 - 1) * jitter;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                verts.Add(d * r0 * j0 + Vector3.down * 0.3f);
                verts.Add(d * r1 * j1 + Vector3.up * h * (0.85f + 0.3f * (float)rnd.NextDouble()));
            }
            for (int i = 0; i < N; i++)
            {
                int a = i * 2, b = a + 1, c = (i + 1) % N * 2, d = c + 1;
                tris.AddRange(new[] { a, b, c, b, d, c });
            }
            // 顶面（环到中心，盖子下面看不到，补上是为了碰撞闭合）
            int center = verts.Count;
            verts.Add(Vector3.up * h * 0.7f);
            for (int i = 0; i < N; i++) tris.AddRange(new[] { center, (i + 1) % N * 2 + 1, i * 2 + 1 });
            DoubleSide(tris);
            var m = new Mesh { name = "Mesh_GeyserVent" };
            m.SetVertices(verts);
            m.SetTriangles(tris, 0);
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>
        /// 熔柱：高 1 m 的管子（运行时 Y 方向缩放到喷发高度），底部半径 radius、顶部 0.55 倍，侧面带两档起伏；顶上一个收口的帽。
        /// 着色器数据同熔岩面：uv0 = (周长坐标 × 3, 高度 × 9)，uv1 = (半周长 × 3, 1000, 盒, 不按深度)，uv2 = (0, 往上流 6 m/s, 相位种子)
        /// </summary>
        static Mesh ColumnMesh(float radius, int seed)
        {
            const int Seg = 18, Rows = 8;
            var verts = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            var tris = new List<int>();
            float circ = 2 * Mathf.PI * radius;
            for (int j = 0; j <= Rows; j++)
            {
                float v = j / (float)Rows;
                float rr = radius * Mathf.Lerp(1f, 0.55f, v) * (1f + 0.08f * Mathf.Sin(v * 9f + seed));
                for (int i = 0; i <= Seg; i++)
                {
                    float u = i / (float)Seg, a = u * Mathf.PI * 2f;
                    float bump = 1f + 0.07f * Mathf.Sin(a * 3f + v * 7f + seed * 1.7f);
                    verts.Add(new Vector3(Mathf.Cos(a) * rr * bump, v, Mathf.Sin(a) * rr * bump));
                    uv0.Add(new Vector2((u - 0.5f) * circ * 3f, v * 9f));
                    uv1.Add(new Vector4(circ * 1.5f, 1000f, 0, 0));
                    uv2.Add(new Vector4(0, 6f, seed * 0.37f, 0));
                }
            }
            for (int j = 0; j < Rows; j++)
            for (int i = 0; i < Seg; i++)
            {
                int a = j * (Seg + 1) + i, b = a + 1, c = a + Seg + 1, d = c + 1;
                tris.AddRange(new[] { a, c, b, b, c, d });
            }
            int top = verts.Count;
            verts.Add(new Vector3(0, 1.08f, 0));
            uv0.Add(Vector2.zero);
            uv1.Add(new Vector4(circ * 1.5f, 1000f, 0, 0));
            uv2.Add(new Vector4(0, 6f, seed * 0.37f, 0));
            int ring = Rows * (Seg + 1);
            for (int i = 0; i < Seg; i++) tris.AddRange(new[] { top, ring + i + 1, ring + i });
            DoubleSide(tris);
            var m = new Mesh { name = "Mesh_GeyserColumn" };
            m.SetVertices(verts);
            m.SetUVs(0, uv0);
            m.SetUVs(1, uv1);
            m.SetUVs(2, uv2);
            m.SetTriangles(tris, 0);
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }
    }
}
