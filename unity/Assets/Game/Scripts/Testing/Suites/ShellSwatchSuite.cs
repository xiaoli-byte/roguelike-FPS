using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 弹壳取色（第二批收尾 D 路；bridge.sh playtest shell-swatch [场景]，默认 1-1 亮沙）：
    ///   · 色样：玩家前方 2 m 的沙地上摆几排躺倒的弹壳（同一个弹壳材质 M_Fx_Shell、网格顶点色上色），每排一种配色——
    ///     第 1 排「现状」（sRGB 值直接写进顶点色，材质按线性读，显示偏浅）、第 2 排「直接转线性」（同一组值过 FxVertexColor，偏深偏饱和）、
    ///     其后几排是候选（按想要的屏幕色取 sRGB，再过 FxVertexColor）；排内从左到右手枪 / 步枪 / 大口径 / 霰弹壳；
    ///   · 实弹：裂风步枪连射 0.5 s，弹壳落在右侧沙地上，拍玩家视角和贴地近景（真实的网格粒子路径）。
    /// 截图 playtest_shell_swatch_*.png、playtest_shell_real_*.png。
    /// </summary>
    public sealed class ShellSwatchSuite : PlaytestSuite
    {
        public override string Id => "shell-swatch";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        /// <summary>一组配色：弹体、底缘、口部、霰弹壳红（屏幕上想要的 sRGB 值；raw = 不转线性直接写）</summary>
        public readonly struct Palette
        {
            public readonly string label;
            public readonly Color brass, dark, mouth, red;
            public readonly bool raw;

            public Palette(string label, Color brass, Color dark, Color mouth, Color red, bool raw = false)
            {
                this.label = label;
                this.brass = brass;
                this.dark = dark;
                this.mouth = mouth;
                this.red = red;
                this.raw = raw;
            }
        }

        /// <summary>弹壳原来的四个顶点色（ShellCasings 改前，直接写）</summary>
        static readonly Color OldBrass = new(1f, 0.74f, 0.26f), OldDark = new(0.78f, 0.5f, 0.16f), OldMouth = new(0.22f, 0.14f, 0.07f), OldRed = new(0.8f, 0.13f, 0.08f);

        public static readonly Palette[] Palettes =
        {
            new("现状（直写）", OldBrass, OldDark, OldMouth, OldRed, true),
            new("直接转线性", OldBrass, OldDark, OldMouth, OldRed),
            // 候选 A：和现状屏幕上一样（原值按线性读出来的 sRGB）
            new("候选 A · 同现状", Hex.Rgb(0xffe08b), Hex.Rgb(0xe4bb6f), Hex.Rgb(0x82694b), Hex.Rgb(0xe7654f)),
            // 候选 B：饱和金 + 深铜底缘（和沙地拉开饱和度）
            new("候选 B · 饱和金", Hex.Rgb(0xffcf4a), Hex.Rgb(0xb87a22), Hex.Rgb(0x3a2410), Hex.Rgb(0xd8321e)),
            // 候选 C：亮金 + 更深的底缘 / 口部（明暗对比把轮廓托出来）
            new("候选 C · 亮金深缘", Hex.Rgb(0xffd95e), Hex.Rgb(0x8a5a16), Hex.Rgb(0x2a1a0c), Hex.Rgb(0xe03a22)),
        };

        static readonly float[] Lengths = { 0.032f * 1.3f, 0.05f * 1.3f, 0.075f * 1.3f, 0.062f * 1.3f };
        static readonly float[] Ratios = { 0.28f, 0.2f, 0.19f, 0.23f };

        readonly List<Object> trash = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}");
                yield break;
            }
            WeaponController.TestMode = true;
            HeroSkills.TestMode = true;
            Interactor.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 1e5f;
            var eye = weapons.eye.transform;
            var mat = FxShotAssets.Shell;
            if (!mat)
            {
                Fail("没有弹壳材质 M_Fx_Shell");
                yield break;
            }
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var right = Vector3.Cross(Vector3.up, fwd);
            var origin = motor.transform.position + fwd * 2.2f;
            Line($"线性色彩空间：{QualitySettings.activeColorSpace == ColorSpace.Linear}；弹壳材质 {mat.shader.name}");

            // ── 色样：每排一种配色，排间 0.22 m（离玩家由近到远），排内 4 种弹壳 × 2 ──
            // 走和 ShellCasings 一样的路径：网格粒子 + GPU 实例化（实例化时 Particles/Lit 按 unity_ParticleUseMeshColors 读网格顶点色，和普通网格渲染器不同）
            for (int row = 0; row < Palettes.Length; row++)
            {
                var pal = Palettes[row];
                var go = new GameObject($"Shell Swatch {row}");
                trash.Add(go);
                var ps = go.AddComponent<ParticleSystem>();
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                var main = ps.main;
                main.playOnAwake = false;
                main.loop = true;
                main.simulationSpace = ParticleSystemSimulationSpace.World;
                main.startLifetime = 600f;
                main.startSpeed = 0;
                main.startRotation3D = true;
                main.gravityModifier = 0;
                main.maxParticles = 16;
                var em = ps.emission;
                em.enabled = false;
                var shape = ps.shape;
                shape.enabled = false;
                var r = go.GetComponent<ParticleSystemRenderer>();
                r.renderMode = ParticleSystemRenderMode.Mesh;
                var meshes = new Mesh[4];
                for (int kind = 0; kind < 4; kind++)
                {
                    meshes[kind] = BuildShell(kind == 3, pal);
                    trash.Add(meshes[kind]);
                }
                r.SetMeshes(meshes);
                r.sharedMaterial = mat;
                r.alignment = ParticleSystemRenderSpace.World;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = true;
                r.enableGPUInstancing = true;
                ps.Play();
                for (int k = 0; k < 8; k++)
                {
                    int kind = k % 4;
                    var p = origin + fwd * (row * 0.22f) + right * ((k - 3.5f) * 0.12f);
                    if (Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var h, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p = h.point;
                    float len = Lengths[kind], rad = len * Ratios[kind];
                    // 躺倒：+z 沿水平、略带一点随机朝向
                    float yaw = Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg + 70f + 25f * ((k * 37) % 5);
                    var ep = new ParticleSystem.EmitParams
                    {
                        applyShapeToPosition = false, position = p + Vector3.up * rad, velocity = Vector3.zero, startSize = len, startLifetime = 600f,
                        rotation3D = new Vector3(0, yaw, 0), startColor = Color.white, meshIndex = kind,
                    };
                    ps.Emit(ep, 1);
                }
                Line($"第 {row + 1} 排：{pal.label}");
            }
            var swatchMid = origin + fwd * ((Palettes.Length - 1) * 0.11f);
            if (Physics.Raycast(swatchMid + Vector3.up * 3f, Vector3.down, out var mh, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) swatchMid = mh.point;
            yield return new WaitForSeconds(0.3f);
            Cam("shell_swatch_close", swatchMid - fwd * 0.75f + Vector3.up * 0.55f, swatchMid, 45f);
            Cam("shell_swatch_eye", swatchMid - fwd * 2.4f + Vector3.up * 1.62f, swatchMid, 50f);
            foreach (var o in trash)
                if (o)
                    Destroy(o);
            trash.Clear();

            // ── 实弹：步枪连射 0.5 s，看真的抛壳 ──
            var rifle = WeaponLibrary.Get("rifle");
            if (rifle == null)
            {
                Fail("武器表里没有 rifle");
                yield break;
            }
            weapons.Give(new WeaponInstance(rifle));
            yield return new WaitForSeconds(0.8f);
            var target = motor.transform.position + fwd * 16f + Vector3.up * 0.9f;
            Aim(motor, eye, target);
            yield return null;
            int e0 = ShellCasings.Ejected;
            weapons.testFire = true;
            for (float t = 0; t < 0.5f; t += Time.deltaTime)
            {
                Aim(motor, eye, target);
                yield return null;
            }
            weapons.testFire = false;
            yield return new WaitForSeconds(1.2f);
            Line($"实弹：抛出 {ShellCasings.Ejected - e0} 枚，在场 {ShellCasings.Live} 枚");
            var ground = motor.transform.position + eye.right * 1.2f;
            if (Physics.Raycast(ground + Vector3.up * 3f, Vector3.down, out var gh, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) ground = gh.point;
            Cam("shell_real_close", ground + Vector3.up * 1.1f - eye.forward * 0.9f, ground, 50f);
            // 玩家低头看右脚边
            Aim(motor, eye, ground);
            yield return null;
            Shot(weapons.eye, "shell_real_eye");
        }

        void Cam(string name, Vector3 pos, Vector3 look, float fov)
        {
            var go = new GameObject("Shell Swatch Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = fov;
            cam.nearClipPlane = 0.02f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            go.transform.position = pos;
            go.transform.LookAt(look);
            Shot(cam, name);
            Destroy(go);
        }

        /// <summary>顶点色：raw 直接写，否则过 <see cref="FxVertexColor.Linear"/></summary>
        static Color V(Palette p, Color c) => p.raw ? c : FxVertexColor.Linear(c);

        /// <summary>简化的弹壳：沿 +z 长 1，8 边圆柱；底缘一圈暗色、口部封口暗色；霰弹壳上半截是壳红</summary>
        static Mesh BuildShell(bool hull, Palette pal)
        {
            const int sides = 8;
            float r = hull ? 0.23f : 0.2f;
            var rings = new List<(float z, float rad, Color c)>
            {
                (-0.5f, r * 1.08f, V(pal, pal.dark)), (-0.43f, r * 1.08f, V(pal, pal.dark)), (-0.42f, r * 0.9f, V(pal, pal.dark)), (-0.36f, r, V(pal, pal.brass)),
            };
            if (hull)
            {
                rings.Add((-0.18f, r, V(pal, pal.brass)));
                rings.Add((-0.17f, r, V(pal, pal.red)));
                rings.Add((0.5f, r * 0.96f, V(pal, pal.red)));
            }
            else
            {
                rings.Add((0.22f, r, V(pal, pal.brass)));
                rings.Add((0.34f, r * 0.72f, V(pal, pal.brass)));
                rings.Add((0.5f, r * 0.7f, V(pal, pal.brass)));
            }
            var verts = new List<Vector3>();
            var norms = new List<Vector3>();
            var cols = new List<Color>();
            var tris = new List<int>();
            for (int k = 0; k + 1 < rings.Count; k++)
            {
                var (z0, r0, c0) = rings[k];
                var (z1, r1, _) = rings[k + 1];
                int b = verts.Count;
                float slope = (r0 - r1) / Mathf.Max(1e-4f, z1 - z0);
                for (int i = 0; i <= sides; i++)
                {
                    float a = i * Mathf.PI * 2 / sides;
                    var radial = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0);
                    var n = (radial + Vector3.forward * slope).normalized;
                    verts.Add(radial * r0 + Vector3.forward * z0);
                    verts.Add(radial * r1 + Vector3.forward * z1);
                    norms.Add(n);
                    norms.Add(n);
                    cols.Add(c0);
                    cols.Add(c0);
                }
                for (int i = 0; i < sides; i++)
                {
                    int a0 = b + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
                    tris.AddRange(new[] { a0, b0, a1, a1, b0, b1 });
                }
            }
            var top = rings[rings.Count - 1];
            int center = verts.Count;
            var mouth = V(pal, hull ? pal.red * 0.62f : pal.mouth);
            verts.Add(new Vector3(0, 0, top.z));
            norms.Add(Vector3.forward);
            cols.Add(mouth);
            for (int i = 0; i <= sides; i++)
            {
                float a = i * Mathf.PI * 2 / sides;
                verts.Add(new Vector3(Mathf.Cos(a) * top.rad, Mathf.Sin(a) * top.rad, top.z));
                norms.Add(Vector3.forward);
                cols.Add(mouth);
            }
            for (int i = 0; i < sides; i++) tris.AddRange(new[] { center, center + 1 + i, center + 2 + i });
            var m = new Mesh { name = "Swatch Shell", hideFlags = HideFlags.DontSave };
            m.SetVertices(verts);
            m.SetNormals(norms);
            m.SetColors(cols);
            m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            return m;
        }
    }
}
