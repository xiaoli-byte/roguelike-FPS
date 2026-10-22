using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 雅丹（M12 1-2 雅丹迷城新增，其他地图也能用）：单座鲸背雅丹岛、闭合多边形的有符号距离（可玩区 / 外缘岩壁）、外缘岩壁剖面。
    // Landform.Yardangs 是按格子撒的整片雅丹场（适合远处的台地、画廊样例）；这里的是手摆的单座，位置、尺寸都写死，好让河道、视线、站位按它排。
    public static partial class LevelKit
    {
        /// <summary>
        /// 一座手摆的鲸背雅丹（坐标系随调用方：长轴沿 +X，迎风的钝头在 −X，背风的尖尾在 +X）。
        /// halfLen / halfWid = 半长 / 半宽（米）；edge = 侧壁过渡宽（高 / edge 决定侧壁坡度，15 m 配 3 m ≈ 75°）；seed = 风蚀噪声种子。
        /// </summary>
        public struct YardangIsland
        {
            public Vector2 center;
            public float halfLen, halfWid, height, edge;
            public int seed;

            public YardangIsland(Vector2 center, float halfLen, float halfWid, float height, float edge, int seed)
            {
                this.center = center;
                this.halfLen = halfLen;
                this.halfWid = halfWid;
                this.height = height;
                this.edge = edge;
                this.seed = seed;
            }

            /// <summary>包围盒外扩 margin 米（逐点求值时先用它剔掉远处）</summary>
            public bool Near(Vector2 p, float margin) =>
                Mathf.Abs(p.x - center.x) <= halfLen + edge + margin && Mathf.Abs(p.y - center.y) <= halfWid * 1.3f + edge + margin;
        }

        /// <summary>
        /// 单座鲸背雅丹的高度贡献（0–height）：迎风头是超椭圆钝头、背风尾收尖，后 60% 略往下落（鲸背）；顶沿锐利、坡脚拖出碎屑裙（同 Landform.Mesa 的剖面）；
        /// 侧壁有顺长轴的风蚀凹槽，足迹边缘被噪声啃得不规则（±25% 半宽）。body = 岩体遮罩（侧壁到顶，0–1），top = 平顶遮罩。
        /// </summary>
        public static float YardangIslandHeight(Vector2 p, in YardangIsland y, out float body, out float top)
        {
            body = 0;
            top = 0;
            if (!y.Near(p, 2f)) return 0;
            var d = p - y.center;
            float u = d.x / Mathf.Max(0.01f, y.halfLen), v = d.y;
            float hw = u < 0
                ? y.halfWid * Mathf.Pow(Mathf.Max(0, 1 - Mathf.Pow(Mathf.Min(1, -u), 4)), 0.25f)
                : y.halfWid * Mathf.Pow(Mathf.Max(0, 1 - Mathf.Min(1, u)), 0.6f);
            float wobble = Landform.Fbm(p, 9f, 3, y.seed + 3) * 0.25f;
            float outside = Mathf.Max(Mathf.Abs(v) - hw, (Mathf.Abs(u) - 1) * y.halfLen) + wobble * y.halfWid;
            float k = 1 - Mathf.Pow(Landform.Smooth(-y.edge, 0.3f * y.edge, outside), 0.55f);
            if (k <= 0) return 0;
            float tail = 1 - 0.3f * Landform.Smooth(0.4f, 1f, u);
            float topN = 1 + Landform.Fbm(p, 14f, 2, y.seed + 5) * 0.012f;
            float flute = 1 - 0.07f * Mathf.Abs(Mathf.Sin(v * 1.6f + Landform.Fbm(p, 4f, 2, y.seed + 6) * 2)) * Landform.Smooth(-0.7f * y.edge, 0, outside);
            body = k;
            top = Landform.Smooth(0.9f, 0.97f, k);
            return k * y.height * tail * topN * flute;
        }

        /// <summary>点到闭合多边形边界的有符号距离：多边形内为正（米）。多边形按顺序首尾相接，顺 / 逆时针都行，不能自交</summary>
        public static float PolygonSigned(Vector2 p, IReadOnlyList<Vector2> poly)
        {
            float best = float.MaxValue;
            bool inside = false;
            int n = poly.Count;
            for (int i = 0, j = n - 1; i < n; j = i++)
            {
                var a = poly[j];
                var b = poly[i];
                var ab = b - a;
                float l2 = ab.sqrMagnitude;
                float t = l2 > 1e-8f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / l2) : 0;
                best = Mathf.Min(best, (p - a - ab * t).sqrMagnitude);
                if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * ab.x / ab.y) inside = !inside;
            }
            float dist = Mathf.Sqrt(best);
            return inside ? dist : -dist;
        }

        /// <summary>
        /// 外缘岩壁剖面（相对坡脚地面的高度）：ins = 离边界线的有符号距离（界内为正）。
        /// 界内 apronWidth 米是一道碎屑坡（坡脚最高 apron 米，缓、能走）；界外 faceWidth 米内陡升到 height（崖面 70° 以上，走不上、跳不上）。
        /// height − apron 要大于二段跳高度（2.7 m）再留余量，边界才由地形封死。
        /// </summary>
        public static float RimProfile(float ins, float apron, float apronWidth, float height, float faceWidth) =>
            apron * Landform.Smooth(apronWidth, 0, ins) + Mathf.Max(0, height - apron) * Landform.Smooth(0, -faceWidth, ins);
    }
}
