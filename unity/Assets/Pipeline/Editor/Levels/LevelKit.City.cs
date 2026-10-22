using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 城市（M13 1-3 沉沙古城起用）：有符号距离（盒 / 椭圆）、城墙内侧的灌沙扇、分段线性表、沿墙排立面件。归 M13，其它地图只追加。
    public static partial class LevelKit
    {
        /// <summary>轴对齐矩形的有符号距离（米，区内为负，区外是到矩形的欧氏距离）</summary>
        public static float BoxSdf(Vector2 p, Vector2 min, Vector2 max)
        {
            var c = (min + max) * 0.5f;
            var half = (max - min) * 0.5f;
            var d = new Vector2(Mathf.Abs(p.x - c.x) - half.x, Mathf.Abs(p.y - c.y) - half.y);
            var o = Vector2.Max(d, Vector2.zero);
            return o.magnitude + Mathf.Min(Mathf.Max(d.x, d.y), 0);
        }

        /// <summary>椭圆的近似有符号距离（米）：按短半轴把归一化半径换算成米，区外偏小、区内偏大——只用于遮罩、崖脚这类软边</summary>
        public static float EllipseSdf(Vector2 p, Vector2 c, Vector2 r)
        {
            var q = new Vector2((p.x - c.x) / r.x, (p.y - c.y) / r.y);
            return (q.magnitude - 1) * Mathf.Min(r.x, r.y);
        }

        /// <summary>点到线段的距离；t = 最近点在线段上的参数（0–1）</summary>
        public static float SegmentDistance(Vector2 p, Vector2 a, Vector2 b, out float t)
        {
            var ab = b - a;
            float l2 = ab.sqrMagnitude;
            t = l2 > 1e-8f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / l2) : 0;
            return Vector2.Distance(p, a + ab * t);
        }

        /// <summary>
        /// 灌沙扇（城墙被沙山压断、沙从墙头倒灌进城）：以墙线上的一段 a→b 为扇顶（墙中线），往 into 一侧铺开；
        /// 扇顶高 top（盖过墙顶就把墙「埋断」），沿扇轴每个位置的扇长从 lenA 渐变到 lenB（米），剖面 top × (1 − d / 长)^power——
        /// 近墙陡、坡脚缓，power 1.35 时扇顶坡度 ≈ top × 1.35 / 长。扇只往 into 一侧（墙外由积沙函数管），越过墙线 0.5–2 m 渐隐，
        /// 不在墙脚留沟。返回扇的高度（≥ 0，相对原地面），调用方 max 叠上去（只填不挖）。
        /// </summary>
        public static float SpillFan(Vector2 p, Vector2 a, Vector2 b, Vector2 into, float top, float lenA, float lenB, float power = 1.35f)
        {
            float d = SegmentDistance(p, a, b, out float t);
            float len = Mathf.Lerp(lenA, lenB, t);
            if (d >= len) return 0;
            float side = Landform.Smooth(-2f, -0.5f, Vector2.Dot(p - a, into.normalized));
            return top * Mathf.Pow(1 - d / len, power) * side;
        }

        /// <summary>分段线性表：knots 按 x 升序（x, y）；两端外取端点值</summary>
        public static float Piecewise(float x, params Vector2[] knots)
        {
            if (knots == null || knots.Length == 0) return 0;
            if (x <= knots[0].x) return knots[0].y;
            for (int i = 0; i + 1 < knots.Length; i++)
                if (x <= knots[i + 1].x)
                    return Mathf.Lerp(knots[i].y, knots[i + 1].y, Mathf.InverseLerp(knots[i].x, knots[i + 1].x, x));
            return knots[^1].y;
        }

        /// <summary>
        /// 沿一条直线首尾相接排立面件（城墙段、回廊段、店铺排）：从 a 往 b，每件按它的设计包围盒宽（局部 X）占位、正面朝 facing（世界 XZ 法线），
        /// ids 轮换（同一套件的几种变体）；放不下一整件就停。底面高度由 baseY(件中心) 给（城墙段摆在原地面上，让积沙埋住墙脚）。
        /// scale 同时作用于宽度；缺 Prefab 时由 <see cref="PlaceOrBox(string, Transform, Vector3, Vector3, float, float, Material)"/> 放 fallbackSize 的白盒。返回摆下的物体。
        /// </summary>
        public static List<GameObject> FacadeRow(Transform parent, Vector2 a, Vector2 b, Vector2 facing, Func<Vector2, float> baseY, Vector3 fallbackSize,
            float scale = 1f, params string[] ids)
        {
            var placed = new List<GameObject>();
            if (ids == null || ids.Length == 0) return placed;
            float len = Vector2.Distance(a, b);
            if (len < 0.5f) return placed;
            var dir = (b - a) / len;
            facing = facing.sqrMagnitude > 1e-6f ? facing.normalized : new Vector2(-dir.y, dir.x);
            float yaw = Mathf.Atan2(facing.x, facing.y) * Mathf.Rad2Deg;
            float s = 0;
            for (int k = 0; k < 256; k++)
            {
                string id = ids[k % ids.Length];
                float w = ShowcaseSceneBuilder.Prefab(id) ? ShowcaseSceneBuilder.DesignBounds(id).size.x : fallbackSize.x;
                w = Mathf.Max(0.5f, w) * scale;
                if (s + w > len + 0.25f) break;
                var c = a + dir * (s + w * 0.5f);
                var go = PlaceOrBox(id, parent, new Vector3(c.x, baseY(c), c.y), new Vector3(w, fallbackSize.y * scale, fallbackSize.z * scale), yaw, scale);
                if (go) placed.Add(go);
                s += w;
            }
            return placed;
        }
    }
}
