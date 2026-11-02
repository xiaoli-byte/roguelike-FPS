using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 熔流闸（S4，docs/level-design/ch3-v2.md 2.7 / 7.2，M33 拥有；3-3 ③ 浇包吊坊、3-4 ② 闸口在用）。
    // 运行时是 G/World/LavaSluice.cs；这里摆：熔流槽的地形（SluiceTrough，关卡在自己的高度函数里调）、浇包（吊钩 + 倾倒转轴 + 熔流柱）或拉闸链柱、组件接线、自查。
    //
    // 用法（关卡构建器）：
    //   1. 高度函数里：h = LevelKit.SluiceTrough(p, spec.path, h, spec.troughHalf, spec.troughDepth, out float trough)——只挖不填，槽岸就是原地面；
    //   2. 场景生成、烘焙导航之前：var s = LevelKit.PlaceLavaSluice(Dir, spec, parent, q => 槽岸地面 y)；
    //   3. 验收：LevelKit.CheckLavaSluice(rep, s)（熔流道在人形导航网格上、吊钩有碰撞、拉杆有交互空间由 L5 交互净空查）。
    public static partial class LevelKit
    {
        /// <summary>一道熔流闸的摆放数据（世界 XZ，米）</summary>
        public sealed class LavaSluiceSpec
        {
            public string name = "熔流闸";
            /// <summary>熔流道折线（第一个点 = 浇口，浇包倒向第二个点）</summary>
            public Vector2[] path = Array.Empty<Vector2>();
            /// <summary>熔岩宽（槽 + 两侧槽岸，米）</summary>
            public float width = 8f;
            /// <summary>熔流槽：半宽、深（地形只挖这一条浅槽，敌人走得进去）</summary>
            public float troughHalf = 2f, troughDepth = 0.6f;
            public LavaSluice.Trigger trigger = LavaSluice.Trigger.Hook;
            /// <summary>浇包的吊点（世界坐标，吊钩挂在这里，浇包吊在下面；Hook / Both）。y ≤ 0 的「空」值 = 浇口正上方 hangHeight 米</summary>
            public Vector3 hangAt;
            public float hangHeight = 4.2f;
            /// <summary>浇包 = 坩埚件放大几倍（坩埚 1.27 × 0.99 × 1.28 m）</summary>
            public float ladleScale = 2.4f;
            /// <summary>吊钩血量（× 本局难度）：两三发就断</summary>
            public float hookHp = 24f;
            /// <summary>拉闸链柱（Lever / Both）：位置（XZ）、朝向（拉杆朝 yaw 方向，玩家站在它前面）</summary>
            public Vector2 leverAt;
            public float leverYaw;
            public float warn = 1f, duration = 6f, cooldown = 18f, frontSpeed = 16f;
            public int uses = 1;
        }

        public const string SluiceLadleId = "SM_Prop_InfernoCrucible", SluiceLeverPostId = "SM_Prop_InfernoChainObelisk";
        static readonly Vector3 SluiceLadleSize = new(1.27f, 0.99f, 1.28f), SluiceLeverPostSize = new(1.08f, 2.13f, 1.08f);

        /// <summary>
        /// 熔流槽：沿折线挖一条浅槽（平底半宽 half，深 depth，槽壁 0.8 m 缓坡——地面敌人走得进走得出），只挖不填。
        /// mask = 槽遮罩（0–1，给分层画「结壳熔铜」的深色）
        /// </summary>
        public static float SluiceTrough(Vector2 p, IReadOnlyList<Vector2> path, float h, float half, float depth, out float mask)
        {
            mask = 0;
            if (path == null || path.Count < 2) return h;
            var (d, _) = Polyline(p, path);
            if (d > half + 1f) return h;
            mask = 1 - Smooth(half, half + 0.8f, d);
            return h - depth * mask;
        }

        /// <summary>
        /// 摆一道熔流闸：根物体在浇口，挂 <see cref="LavaSluice"/>（熔流道 = path 按 bankY 贴到槽岸地面）；
        /// Hook / Both：吊钩（Destructible，发亮的铁钩 + 一截链，碰撞体 0.9 × 1.4 × 0.9 m）挂在 hangAt，下面是倾倒转轴和浇包（坩埚件 × ladleScale，缺件时白盒），
        ///   浇包口朝熔流方向，倾倒时露出熔流柱（浇包口 → 浇口，竖直熔岩面，平时关着）；
        /// Lever / Both：链柱 + 拉杆转轴（拉杆运行时拼）。熔岩段不在这里摆（运行时第一次放才建，平时没有 Lava 区、不挖导航）
        /// </summary>
        public static LavaSluice PlaceLavaSluice(string dir, LavaSluiceSpec s, Transform parent, Func<Vector2, float> bankY)
        {
            if (s.path == null || s.path.Length < 2) throw new ArgumentException($"熔流闸 {s.name} 的熔流道至少两个点");
            var src = s.path[0];
            var dir2 = (s.path[1] - src).normalized;
            float yaw = Mathf.Atan2(dir2.x, dir2.y) * Mathf.Rad2Deg;
            var root = new GameObject($"Lava Sluice · {s.name}");
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(new Vector3(src.x, bankY(src), src.y), Quaternion.Euler(0, yaw, 0));
            var comp = root.AddComponent<LavaSluice>();
            comp.title = s.name;
            comp.trigger = s.trigger;
            comp.path = s.path.Select(q => new Vector3(q.x, bankY(q), q.y)).ToArray();
            comp.width = s.width;
            comp.warn = s.warn;
            comp.duration = s.duration;
            comp.cooldown = s.cooldown;
            comp.frontSpeed = s.frontSpeed;
            comp.uses = s.uses;
            comp.lavaMaterial = LavaMaterial();
            // 熔流从槽底以下涨起：槽深 + 0.8 m，平时藏在地下
            comp.restDrop = s.troughDepth + 0.8f;

            if (s.trigger != LavaSluice.Trigger.Lever) BuildLadle(dir, s, comp, root.transform, bankY(src), yaw);
            if (s.trigger != LavaSluice.Trigger.Hook)
            {
                var at = new Vector3(s.leverAt.x, bankY(s.leverAt), s.leverAt.y);
                var lev = new GameObject("Sluice Lever").transform;
                lev.SetParent(root.transform, false);
                lev.SetPositionAndRotation(at, Quaternion.Euler(0, s.leverYaw, 0));
                var fwd = Quaternion.Euler(0, s.leverYaw, 0) * Vector3.forward;
                var post = PlaceOrBox(SluiceLeverPostId, lev, at - fwd * 0.9f + Vector3.down * 0.05f, SluiceLeverPostSize * 1.5f, s.leverYaw, 1.5f);
                if (post)
                {
                    post.name = $"{post.name} · 闸柱";
                    post.isStatic = true;
                }
                var pivot = new GameObject("Lever Pivot").transform;
                pivot.SetParent(lev, false);
                pivot.localPosition = new Vector3(0, 1.3f, 0.6f);
                comp.lever = pivot;
            }
            return comp;
        }

        static void BuildLadle(string dir, LavaSluiceSpec s, LavaSluice comp, Transform root, float groundY, float yaw)
        {
            var src = s.path[0];
            var hang = s.hangAt.y > 0.01f || s.hangAt.y < -0.01f ? s.hangAt : new Vector3(src.x, groundY + s.hangHeight, src.y);
            var rot = Quaternion.Euler(0, yaw, 0);
            float h = SluiceLadleSize.y * s.ladleScale, r = SluiceLadleSize.x * s.ladleScale * 0.5f;
            const float chain = 0.9f;

            // 吊钩：发亮的铁钩（玩家一眼认得出是靶子）+ 一截链；Destructible 只吃玩家这边的伤害
            var hookGo = new GameObject("Sluice Hook · 吊钩");
            hookGo.transform.SetParent(root, false);
            hookGo.transform.SetPositionAndRotation(hang + Vector3.down * chain * 0.5f, rot);
            var iron = Mat(dir, "SluiceIron", new Color(0.12f, 0.1f, 0.11f), 0.8f);
            var hot = GlowMat(dir, "SluiceHookHot", new Color(1f, 0.42f, 0.12f), new Color(3.2f, 0.9f, 0.18f));
            var link = Cylinder("Chain", hookGo.transform, hang + Vector3.down * chain * 0.3f, 0.09f, chain * 0.6f, Quaternion.identity, iron);
            Object.DestroyImmediate(link.GetComponent<Collider>());
            var hookBody = GameObject.CreatePrimitive(PrimitiveType.Cube);
            hookBody.name = "Hook";
            Object.DestroyImmediate(hookBody.GetComponent<Collider>());
            hookBody.transform.SetParent(hookGo.transform, false);
            hookBody.transform.localPosition = new Vector3(0, -chain * 0.2f, 0);
            hookBody.transform.localRotation = Quaternion.Euler(0, 0, 45);
            hookBody.transform.localScale = new Vector3(0.55f, 0.55f, 0.3f);
            hookBody.GetComponent<MeshRenderer>().sharedMaterial = hot;
            var col = hookGo.AddComponent<BoxCollider>();
            col.size = new Vector3(0.9f, chain + 0.5f, 0.9f);
            var des = hookGo.AddComponent<Destructible>();
            des.kind = Destructible.Kind.Metal;
            des.baseHp = s.hookHp;
            des.accepts = Destructible.DamageKind.Player;
            des.displayName = "吊钩";
            des.blocksSight = false;
            des.size = 0.6f;
            // 吊钩、浇包会动（碎、转）：不进导航烘焙
            hookGo.AddComponent<NavMeshModifier>().ignoreFromBuild = true;
            comp.hook = des;

            // 倾倒转轴：在浇包腰部（耳轴），本地 +Z 朝熔流方向；绕本地 X 转 +tiltAngle 时浇包口转向 +Z
            var pivot = new GameObject("Ladle Pivot").transform;
            pivot.SetParent(root, false);
            pivot.SetPositionAndRotation(hang + Vector3.down * (chain + h * 0.5f), rot);
            pivot.gameObject.AddComponent<NavMeshModifier>().ignoreFromBuild = true;
            var ladle = PlaceOrBox(SluiceLadleId, root, pivot.position + Vector3.down * h * 0.5f, SluiceLadleSize * s.ladleScale, yaw, s.ladleScale);
            if (ladle)
            {
                ladle.transform.SetParent(pivot, true);
                ladle.name = $"{ladle.name} · 浇包";
                foreach (var t in ladle.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
                if (ladle.CompareTag(PlaceholderTag))
                {
                    var mr = ladle.GetComponent<MeshRenderer>();
                    if (mr) mr.sharedMaterial = Mat(dir, "SluiceLadle", new Color(0.3f, 0.24f, 0.22f), 0.85f);
                }
                // 浇包口一圈发亮的熔铜（没有碰撞），倒的时候跟着转
                var glow = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                glow.name = "Ladle Molten";
                Object.DestroyImmediate(glow.GetComponent<Collider>());
                glow.transform.SetParent(pivot, false);
                glow.transform.localPosition = new Vector3(0, h * 0.5f - 0.05f, 0);
                glow.transform.localScale = new Vector3(r * 1.6f, 0.04f, r * 1.6f);
                var gr = glow.GetComponent<MeshRenderer>();
                gr.sharedMaterial = GlowMat(dir, "SluiceMolten", new Color(1f, 0.55f, 0.15f), new Color(4f, 1.3f, 0.25f));
                gr.shadowCastingMode = ShadowCastingMode.Off;
            }
            comp.ladle = pivot;
            comp.tiltAxis = Vector3.right;
            comp.tiltAngle = 100f;

            // 熔流柱：倒下去以后浇包口大约在转轴前方 0.5 h、高度不变；从那里竖直落到槽底
            var lip = pivot.position + rot * Vector3.forward * (h * 0.55f);
            float top = lip.y, bottom = groundY - s.troughDepth;
            var pour = new GameObject("Sluice Pour · 熔流柱");
            pour.transform.SetParent(root, false);
            pour.transform.SetPositionAndRotation(new Vector3(lip.x, bottom, lip.z), rot);
            var mesh = SluicePourMesh(Mathf.Max(0.5f, top - bottom), 0.65f);
            mesh.name = $"Mesh_SluicePour_{SafeName(s.name)}";
            SaveAsset(mesh, $"{dir}/Lava/{mesh.name}.asset");
            pour.AddComponent<MeshFilter>().sharedMesh = mesh;
            var pr = pour.AddComponent<MeshRenderer>();
            pr.sharedMaterial = LavaMaterial();
            pr.shadowCastingMode = ShadowCastingMode.Off;
            pr.lightProbeUsage = LightProbeUsage.Off;
            pr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            pour.SetActive(false);
            comp.pour = pour;
        }

        /// <summary>竖直的熔流柱（两片十字交叉的面，双面）：uv 按熔岩着色器的约定（uv0 = 米、uv1 = 半宽 / 很长 / 盒 / 不按深度、uv2 = 往下流）</summary>
        static Mesh SluicePourMesh(float height, float half)
        {
            const int Rows = 8;
            var verts = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            var tris = new List<int>();
            for (int plane = 0; plane < 2; plane++)
            {
                int b0 = verts.Count;
                for (int j = 0; j <= Rows; j++)
                {
                    float v = j / (float)Rows, w = half * Mathf.Lerp(1.15f, 0.8f, v);
                    for (int i = 0; i <= 1; i++)
                    {
                        float x = (i * 2 - 1) * w;
                        verts.Add(plane == 0 ? new Vector3(x, v * height, 0) : new Vector3(0, v * height, x));
                        uv0.Add(new Vector2(x * 3f, v * height));
                        uv1.Add(new Vector4(w * 3f, 1000f, 0, 0));
                        uv2.Add(new Vector4(0, -3f, 0.53f, 0));
                    }
                }
                for (int j = 0; j < Rows; j++)
                {
                    int a = b0 + j * 2, b = a + 1, c = a + 2, d = a + 3;
                    tris.AddRange(new[] { a, c, b, b, c, d, b, c, a, d, c, b });
                }
            }
            var mesh = new Mesh();
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uv0);
            mesh.SetUVs(1, uv1);
            mesh.SetUVs(2, uv2);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// 熔流闸自查：熔流道长度 / 段数、每个折点在人形干地导航网格上（敌人真的会走进槽里）、熔流道不压进已有的熔岩、
        /// 吊钩有碰撞和 Destructible / 拉杆有转轴。交互净空（拉杆前站得下）由 L5 的交互净空检查自动查
        /// </summary>
        public static void CheckLavaSluice(Report rep, LavaSluice s)
        {
            if (!s)
            {
                rep.Fail("熔流闸没有生成");
                return;
            }
            var p = s.path;
            float len = 0;
            for (int i = 0; i + 1 < p.Length; i++) len += Vector2.Distance(new Vector2(p[i].x, p[i].z), new Vector2(p[i + 1].x, p[i + 1].z));
            int onNav = 0;
            var filter = LavaField.WalkerFilter(LavaField.DryAreaMask);
            foreach (var q in p)
                if (NavMesh.SamplePosition(q, out var hit, 1.5f, filter) && Mathf.Abs(hit.position.y - q.y) < 1.2f)
                    onNav++;
            var problems = new List<string>();
            if (p.Length < 2 || len < 6f) problems.Add($"熔流道太短（{len:F0} m）");
            if (onNav < p.Length) problems.Add($"熔流道折点只有 {onNav}/{p.Length} 个在干地导航网格上（敌人走不进槽）");
            if (s.trigger != LavaSluice.Trigger.Lever && (!s.hook || !s.hook.GetComponent<Collider>())) problems.Add("没有吊钩（或吊钩没有碰撞体，射不断）");
            if (s.trigger != LavaSluice.Trigger.Hook && !s.lever) problems.Add("拉闸没有拉杆转轴");
            if (s.trigger != LavaSluice.Trigger.Lever && (!s.ladle || !s.pour)) problems.Add("没有浇包转轴 / 熔流柱");
            string what = $"熔流闸「{s.title}」：{s.trigger}，熔流道 {len:F0} m（宽 {s.width:F0} m，{p.Length} 个折点），预警 {s.warn:F1} s、熔流 {s.duration:F0} s、{(s.trigger == LavaSluice.Trigger.Hook ? "一次" : $"{s.uses} 次 / 冷却 {s.cooldown:F0} s")}";
            if (problems.Count == 0) rep.Line($"✓ {what}");
            else rep.Fail($"{what}：{string.Join("；", problems)}");
        }
    }
}
