using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 坡度：沿声明的路径（古道、栈道、坡道）每米采样地形高度，超过上限的路段不合格。
    /// 只采地形（多块 Terrain 时取所在的那块），路上的石头、货堆不算坡。
    /// </summary>
    public sealed class SlopeCheck : ILevelCheck
    {
        public string Id => "slope";
        public string Title => "坡度";
        public int Order => 20;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.spec.slopePaths.Count == 0)
            {
                rep.Line("没有声明坡度路径，跳过");
                return;
            }
            if (Terrain.activeTerrains.Length == 0)
            {
                rep.Warn("场景里没有地形，坡度路径没法采样");
                return;
            }
            foreach (var path in ctx.spec.slopePaths)
            {
                int bad = 0, n = 0;
                float worst = 0;
                Vector2 worstAt = default;
                var pts = path.points;
                for (int i = 0; i + 1 < pts.Count; i++)
                {
                    var a = pts[i];
                    var b = pts[i + 1];
                    float len = Vector2.Distance(a, b);
                    for (float s = 0; s < len; s += 1f)
                    {
                        var p = Vector2.Lerp(a, b, s / len);
                        var q = Vector2.Lerp(a, b, Mathf.Min(1, (s + 1f) / len));
                        float run = Vector2.Distance(p, q);
                        if (run < 0.3f || !TerrainY(p, out var hp) || !TerrainY(q, out var hq)) continue;
                        float slope = Mathf.Atan(Mathf.Abs(hq - hp) / run) * Mathf.Rad2Deg;
                        n++;
                        if (slope > path.maxSlope) bad++;
                        if (slope > worst) { worst = slope; worstAt = p; }
                    }
                }
                if (bad > 0) rep.Fail($"{path.name}有 {bad}/{n} m 坡度超过 {path.maxSlope}°（最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})）");
                else rep.Line($"✓ {path.name}坡度：最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})，全程 ≤ {path.maxSlope}°");
            }
        }

        /// <summary>点所在那块地形的高度（世界 y）</summary>
        static bool TerrainY(Vector2 p, out float y)
        {
            foreach (var t in Terrain.activeTerrains)
            {
                var o = t.transform.position;
                var s = t.terrainData.size;
                if (p.x < o.x || p.y < o.z || p.x > o.x + s.x || p.y > o.z + s.z) continue;
                y = t.SampleHeight(new Vector3(p.x, 0, p.y)) + o.y;
                return true;
            }
            y = 0;
            return false;
        }
    }
}
