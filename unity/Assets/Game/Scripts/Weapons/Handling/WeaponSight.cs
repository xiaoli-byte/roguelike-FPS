using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>瞄具种类：红点（中空方框 + 准心点）、管状瞄具（开口短筒）、瞄准镜（开镜走遮罩、隐藏枪模）</summary>
    public enum SightKind { None, RedDot, Tube, Scope }

    /// <summary>瞄具零件的上色：机匣暗色 / 准心红点（HDR，吃 Bloom）/ 稀有度色（随手上那把枪的品质变）</summary>
    public enum SightPaint { Frame, Reticle, Rarity }

    /// <summary>瞄具零件的形状：方块 / 开口圆筒（内外两面，等价 Three.js 的 DoubleSide 开口圆柱）</summary>
    public enum SightShape { Box, Tube }

    /// <summary>一个瞄具零件（枪模局部坐标，已按 <see cref="WeaponDef.Grip"/> 把 TS 的 x 取反）</summary>
    public struct SightPiece
    {
        public SightShape shape;
        public SightPaint paint;
        /// <summary>Box：(宽, 高, 深)；Tube：(半径, 半径, 长度)，筒轴沿 z</summary>
        public Vector3 size;
        public Vector3 center;
    }

    /// <summary>
    /// 一把枪的瞄具（WC1，docs/unity-parity.md 3.3「开镜」）。Three.js 版红点 / 筒式瞄具是程序零件（WeaponModels.PROCEDURAL_PARTS 里的 sight），
    /// 美术管线导出时把它们排除了，Unity 枪模里没有——这里按 TS Builder.redDot / tube / ring 的尺寸补一份占位网格，挂在第一人称枪模下
    /// （<see cref="SightPart"/>，由 <see cref="WeaponRigParts"/> 在玩家组装好后补挂，不改 PlayerFactory）。W3 把瞄具补成正式程序网格后，零件表可以清空、只留 kind。
    /// 每把一个 Handling_&lt;Id&gt;.cs（[Defs] + <see cref="IDefSource{T}"/>），id = 武器 id。
    /// 开镜判定同 TS（Crosshair.SCOPE_KICK）：视角层 &lt; −30° 算「进了镜」——狙击镜遮罩、隐藏枪模、散布归零都按 <see cref="Scoped"/>。
    /// </summary>
    public sealed class WeaponSight : IDef
    {
        /// <summary>开镜视角层阈值（度）：低于它算进了镜（只有鹰隼狙击的 −45° 够得到）</summary>
        public const float ScopeKick = -30f;
        /// <summary>准心红点（TS RETICLE_COLOR #ff3a3a）× HDR 亮度</summary>
        public static readonly Color ReticleColor = Hex.Rgb(0xff3a3a) * 4f;

        public string weaponId;
        public SightKind kind;
        /// <summary>机匣暗色（TS PALETTES[id].dark）</summary>
        public Color frameColor = Hex.Rgb(0x23252a);
        public SightPiece[] parts = Array.Empty<SightPiece>();

        string IDef.Id => weaponId;

        /// <summary>视角层（<see cref="WeaponController.FovKick"/>）是否已经「进了镜」</summary>
        public static bool Scoped(float fovKick) => fovKick < ScopeKick;

        /// <summary>某把枪的瞄具；没有登记为 null</summary>
        public static WeaponSight For(string weaponId) => Registry<WeaponSight>.Get(weaponId);

        // ───────────── 零件（参数照抄 TS WeaponModels.Builder，坐标是 TS 枪模空间）─────────────

        public static SightPiece Box(SightPaint paint, float w, float h, float d, float x, float y, float z) =>
            new() { shape = SightShape.Box, paint = paint, size = new Vector3(w, h, d), center = WeaponDef.Grip(x, y, z) };

        /// <summary>开口圆筒（TS tube / ring：半径、长度、中心）</summary>
        public static SightPiece Tube(SightPaint paint, float r, float len, float x, float y, float z) =>
            new() { shape = SightShape.Tube, paint = paint, size = new Vector3(r, r, len), center = WeaponDef.Grip(x, y, z) };

        /// <summary>
        /// 红点瞄具（TS Builder.redDot）：边长 0.032、框厚 0.004、深 0.05 的中空方框，中心 (0, cy, cz)；下面一块底座垫到 baseY；
        /// 准心点在框的前缘内侧。开镜位置（aimOffset）正是按准心点落在屏幕中央算的
        /// </summary>
        public static WeaponSight RedDot(string weaponId, float cy, float cz, float baseY, Color frame)
        {
            const float s = 0.032f, t = 0.004f, d = 0.05f;
            float mh = Mathf.Max(0.002f, cy - s / 2 - baseY);
            return new WeaponSight
            {
                weaponId = weaponId, kind = SightKind.RedDot, frameColor = frame,
                parts = new[]
                {
                    Box(SightPaint.Frame, s, t, d, 0, cy + s / 2 - t / 2, cz),
                    Box(SightPaint.Frame, s, t, d, 0, cy - s / 2 + t / 2, cz),
                    Box(SightPaint.Frame, t, s, d, s / 2 - t / 2, cy, cz),
                    Box(SightPaint.Frame, t, s, d, -s / 2 + t / 2, cy, cz),
                    Box(SightPaint.Frame, 0.02f, mh, 0.04f, 0, baseY + mh / 2, cz),
                    Box(SightPaint.Reticle, 0.0035f, 0.0035f, 0.002f, 0, cy, cz - d / 2 + 0.002f),
                },
            };
        }
    }

    /// <summary>
    /// 瞄具占位网格的搭建：挂在第一人称 rig 的枪模下（与手臂同级，跟着枪模缩放），放 FirstPerson 层、不投影。
    /// 网格是共享的单位方块 / 单位开口圆筒（程序生成一次），材质用 <see cref="FxMaterials.Unlit"/> + 属性块上色，不复制材质；
    /// 不带 _EMISSION，元素着色（<see cref="WeaponTint"/>）不会碰它。
    /// </summary>
    public static class WeaponSightBuilder
    {
        /// <summary>占位瞄具根节点名（测试 / 重复挂载检查用）</summary>
        public const string NodeName = "Sight (WC1 placeholder)";
        const int TubeSegments = 16;

        static Mesh box, tube;
        static MaterialPropertyBlock block;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            box = null;
            tube = null;
        }

        /// <summary>root（rig 或枪模）下已有的占位瞄具（没有为 null）</summary>
        public static Transform Find(Transform root) => WeaponRigPart.FindDeep(root, NodeName);

        /// <summary>给枪模根挂占位瞄具（已挂过 / 没有零件时什么都不做）；返回瞄具根节点</summary>
        public static Transform Attach(Transform gun, WeaponSight sight)
        {
            if (!gun || sight == null || sight.parts.Length == 0) return null;
            var existing = Find(gun);
            if (existing) return existing;
            var root = new GameObject(NodeName).transform;
            root.SetParent(gun, false);
            int layer = gun.gameObject.layer;
            root.gameObject.layer = layer;
            var mat = FxMaterials.Unlit;
            for (int i = 0; i < sight.parts.Length; i++)
            {
                var p = sight.parts[i];
                var go = new GameObject($"{p.paint} {p.shape} {i}");
                go.layer = layer;
                go.transform.SetParent(root, false);
                go.transform.localPosition = p.center;
                go.transform.localScale = p.size;
                go.AddComponent<MeshFilter>().sharedMesh = p.shape == SightShape.Tube ? TubeMesh() : BoxMesh();
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = mat;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
                r.lightProbeUsage = LightProbeUsage.Off;
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
                Paint(r, p.paint, sight, 0);
            }
            return root;
        }

        /// <summary>按手上那把枪的稀有度重涂稀有度色零件（rig 按武器 id 共用，切到同 id 不同品质的枪时调）</summary>
        public static void SetRarity(Transform sightRoot, WeaponSight sight, int rarity)
        {
            var root = sightRoot;
            if (!root || sight == null) return;
            // 零件名以上色种类开头（见 Attach）
            string prefix = SightPaint.Rarity + " ";
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                if (r.name.StartsWith(prefix, StringComparison.Ordinal)) Paint(r, SightPaint.Rarity, sight, rarity);
        }

        static void Paint(Renderer r, SightPaint paint, WeaponSight sight, int rarity)
        {
            var c = paint switch
            {
                SightPaint.Reticle => WeaponSight.ReticleColor,
                SightPaint.Rarity => Rarity.Color(rarity) * 1.6f,
                _ => sight.frameColor,
            };
            c.a = 1;
            block ??= new MaterialPropertyBlock();
            block.Clear();
            block.SetColor("_BaseColor", c);
            block.SetColor("_Color", c);
            r.SetPropertyBlock(block);
        }

        // ───────────── 共享网格 ─────────────

        /// <summary>中心在原点的单位方块（24 顶点，带法线）</summary>
        static Mesh BoxMesh()
        {
            if (box) return box;
            var v = new List<Vector3>(24);
            var n = new List<Vector3>(24);
            var tris = new List<int>(36);
            void Face(Vector3 normal, Vector3 u, Vector3 w)
            {
                int i = v.Count;
                var c = normal * 0.5f;
                v.Add(c - u * 0.5f - w * 0.5f);
                v.Add(c + u * 0.5f - w * 0.5f);
                v.Add(c + u * 0.5f + w * 0.5f);
                v.Add(c - u * 0.5f + w * 0.5f);
                for (int k = 0; k < 4; k++) n.Add(normal);
                tris.Add(i); tris.Add(i + 2); tris.Add(i + 1);
                tris.Add(i); tris.Add(i + 3); tris.Add(i + 2);
            }
            Face(Vector3.right, Vector3.forward, Vector3.up);
            Face(Vector3.left, Vector3.back, Vector3.up);
            Face(Vector3.up, Vector3.right, Vector3.forward);
            Face(Vector3.down, Vector3.right, Vector3.back);
            Face(Vector3.forward, Vector3.left, Vector3.up);
            Face(Vector3.back, Vector3.right, Vector3.up);
            box = new Mesh { name = "SightBox", hideFlags = HideFlags.DontSave };
            box.SetVertices(v);
            box.SetNormals(n);
            box.SetTriangles(tris, 0);
            box.RecalculateBounds();
            return box;
        }

        /// <summary>单位开口圆筒：半径 1、长 1、轴沿 z、中心在原点；外壁 + 内壁（法线朝内，绕序相反），从筒里看也看得见</summary>
        static Mesh TubeMesh()
        {
            if (tube) return tube;
            int seg = TubeSegments, ring = seg + 1;
            var v = new List<Vector3>(ring * 4);
            var n = new List<Vector3>(ring * 4);
            var tris = new List<int>(seg * 12);
            for (int side = 0; side < 2; side++)
            {
                int start = v.Count;
                float sign = side == 0 ? 1 : -1;
                for (int i = 0; i <= seg; i++)
                {
                    float a = i * Mathf.PI * 2 / seg;
                    var dir = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0);
                    v.Add(dir + new Vector3(0, 0, -0.5f));
                    v.Add(dir + new Vector3(0, 0, 0.5f));
                    n.Add(dir * sign);
                    n.Add(dir * sign);
                }
                for (int i = 0; i < seg; i++)
                {
                    int a0 = start + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
                    // 外壁从外面看是顺时针（Unity 正面），内壁反过来
                    if (side == 0)
                    {
                        tris.Add(a0); tris.Add(b1); tris.Add(a1);
                        tris.Add(a0); tris.Add(b0); tris.Add(b1);
                    }
                    else
                    {
                        tris.Add(a0); tris.Add(a1); tris.Add(b1);
                        tris.Add(a0); tris.Add(b1); tris.Add(b0);
                    }
                }
            }
            tube = new Mesh { name = "SightTube", hideFlags = HideFlags.DontSave };
            tube.SetVertices(v);
            tube.SetNormals(n);
            tube.SetTriangles(tris, 0);
            tube.RecalculateBounds();
            return tube;
        }
    }
}
