using System;
using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 冰湖（M23 2-3 瑶池冰湖起用；2-1 冰河、2-4 冰窟也能用）：整片冰面的牵引区、冰窟窿的水体、冰窟边缘一圈。归 M23，其它地图只追加。
    // 冰面本身就是地形（Landform.LakeShore 压平的湖面 + Splat.Frost 的冰层），这里只放运行时组件：SurfaceZone 管打滑，WaterVolume 管涉水。
    public static partial class LevelKit
    {
        /// <summary>冰窟边缘段（ART5，北冥冰窟）：正面（+Z）朝冰窟中心，翻起的冰板在正面、背面落到 0.3 m 的冰沿</summary>
        public const string IceHoleRimId = "SM_Tripo_FrostIceHoleRim";
        /// <summary>冰窟边缘段发布后的包围盒（宽 = 弦向 × 高 × 深，米）</summary>
        public static readonly Vector3 IceHoleRimSize = new(3.79f, 2.2f, 2.76f);

        /// <summary>
        /// 整片冰面的牵引区：在 area（世界 XZ）里每 strip 米一行、每 step 米一个采样往东扫，isIce 为真的连续段各放一个 <see cref="SurfaceZone"/>
        /// （冰面预设，Box 形，没有渲染器、没有碰撞），盒顶 = topY。一行取行中和两侧三条采样线，任一条是冰就算——行边上的冰不漏；段两头各多伸 pad 米（湖岸的冰沿）。
        /// ZoneArea.Box 只认顶面上 0.6 m、下 0.8 m 的带子：湖心的岛、台、码头这些高出冰面的地方自然不算冰，冰窟窿里（水底在冰面下 1 m）也不算。
        /// 返回放下的区域（报告、测试用）。
        /// </summary>
        public static List<SurfaceZone> IceSheet(Transform parent, Func<Vector2, bool> isIce, Rect area, float topY, float strip = 6f, float step = 1f, float pad = 1f)
        {
            var root = new GameObject("Ice Sheet (SurfaceZone)").transform;
            root.SetParent(parent, false);
            var zones = new List<SurfaceZone>();
            int rows = Mathf.Max(1, Mathf.CeilToInt(area.height / Mathf.Max(0.5f, strip)));
            float rowH = area.height / rows;
            step = Mathf.Max(0.25f, step);
            for (int j = 0; j < rows; j++)
            {
                float z = area.yMin + (j + 0.5f) * rowH;
                float start = float.NaN, last = 0;
                for (float x = area.xMin; ; x += step)
                {
                    bool inside = x <= area.xMax;
                    bool ice = inside && (isIce(new Vector2(x, z)) || isIce(new Vector2(x, z - rowH * 0.35f)) || isIce(new Vector2(x, z + rowH * 0.35f)));
                    if (ice)
                    {
                        if (float.IsNaN(start)) start = x;
                        last = x;
                    }
                    else if (!float.IsNaN(start))
                    {
                        zones.Add(IceStrip(root, start - pad, last + pad, z, rowH, topY, zones.Count + 1));
                        start = float.NaN;
                    }
                    if (!inside) break;
                }
            }
            return zones;
        }

        static SurfaceZone IceStrip(Transform root, float x0, float x1, float z, float depth, float topY, int index)
        {
            var go = new GameObject($"Ice {index:00}");
            go.transform.SetParent(root, false);
            go.transform.position = new Vector3((x0 + x1) * 0.5f, topY - 0.25f, z);
            // 行与行之间多叠 2 cm，不留缝
            go.transform.localScale = new Vector3(Mathf.Max(0.5f, x1 - x0), 0.5f, depth + 0.02f);
            var zone = go.AddComponent<SurfaceZone>();
            zone.profile = SurfaceProfile.Ice;
            zone.area = ZoneArea.Box();
            zone.lifetime = 0;
            return zone;
        }

        /// <summary>
        /// 冰窟窿（开放水面）：地形已经在 surface（冰面上的圆心）处挖好碗（碗底在冰面下 depth 米、碗沿 = 冰面），这里放水体——
        /// <see cref="WaterBody"/>：去掉碰撞、换水材质、挂 <see cref="WaterVolume"/>，水面在冰面下 drop 米（冰窟里的水比冰沿低一点）。
        /// 水体是 2r 见方的盒子：四个角埋在冰（地形）下面看不见，脚踩在冰面上也高过水面，不算在水里。
        /// </summary>
        public static WaterVolume IceHole(Transform parent, string name, Vector3 surface, float radius, float depth, float drop = 0.08f)
        {
            float bed = surface.y - depth, water = Mathf.Max(0.1f, depth - drop);
            var block = Box(name, parent, new Vector3(surface.x, bed, surface.z), new Vector3(radius * 2, water, radius * 2), 0, null, 0);
            return WaterBody(block, bed, water);
        }

        /// <summary>
        /// 冰窟边缘一圈（<see cref="IceHoleRimId"/>）：segments 段均分一圈，第 k 段在方位角 phase + 360·k / segments（度，0 = +X、逆时针看 XZ），
        /// 正面朝圆心、前沿压在冰窟沿上（holeRadius 处），按弦长横向放大、按 heightScale 纵向缩放；keep(方位角) 为假的段不放（留出下水的口子）。
        /// 缺 Prefab 时 PlaceOrBox 放同尺寸的占位白盒。center = 冰面上的窟心（y = 冰面）。返回放下的段。
        /// </summary>
        public static List<GameObject> IceHoleRing(Transform parent, Vector3 center, float holeRadius, int segments, float heightScale = 1f, float phase = 0,
            Func<float, bool> keep = null, float sink = 0.1f)
        {
            var placed = new List<GameObject>();
            segments = Mathf.Max(3, segments);
            float rr = holeRadius + IceHoleRimSize.z * 0.5f - 0.1f;
            float chord = 2 * rr * Mathf.Sin(Mathf.PI / segments) + 0.2f;
            var scale = new Vector3(chord / IceHoleRimSize.x, heightScale, 1f);
            for (int k = 0; k < segments; k++)
            {
                float ang = phase + 360f * k / segments;
                if (keep != null && !keep(Mathf.Repeat(ang, 360f))) continue;
                float a = ang * Mathf.Deg2Rad;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var at = center + dir * rr - Vector3.up * sink;
                float yaw = Mathf.Atan2(-dir.x, -dir.z) * Mathf.Rad2Deg; // +Z 朝圆心
                var go = PlaceOrBox(IceHoleRimId, parent, at, Vector3.Scale(IceHoleRimSize, scale), yaw);
                if (!go) continue;
                if (!go.name.StartsWith("Placeholder")) go.transform.localScale = scale;
                go.isStatic = true;
                placed.Add(go);
            }
            return placed;
        }
    }
}
