using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 掩体数：场地里每个可达的站立面朝 8 个方向在 1.1 m 高（低掩体 1.2 m 挡得住的高度）打一条 1.5 m 的水平射线，
    /// 打到陡面（法线 y &lt; 0.5：墙、岩壁、陡坎、货堆，不是缓坡）就算「掩体旁的站位」；1.7 m 也打到的算全遮（高掩体 2.6 m）。
    /// 相邻（2 格内）的掩体站位连成一处掩体，至少 2 格才算——所以一段墙、一座岩丘、一道河床陡坎各算一处，地形和摆件一视同仁。
    /// 不可见墙不算掩体。声明了 minCover 的场地不够数不合格，没声明只报告。
    /// </summary>
    public sealed class CoverCheck : ILevelCheck
    {
        public string Id => "cover";
        public string Title => "掩体数";
        public int Order => 100;

        const float LowY = 1.1f, HighY = 1.7f, Reach = 1.5f;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.Sites.Count == 0)
            {
                rep.Line("没有场地，跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail("出生点附近没有可站立面，数不了掩体");
                return;
            }
            var g = ctx.Grid;
            foreach (var site in ctx.Sites)
            {
                var spans = ctx.SiteSpans(site);
                var cover = new Dictionary<int, bool>(); // 列 → 是否全遮
                foreach (var s in spans)
                {
                    var p = g.Pos(s);
                    bool low = false, high = false;
                    for (int k = 0; k < 8 && !high; k++)
                    {
                        var dir = Quaternion.Euler(0, k * 45, 0) * Vector3.forward;
                        if (!Physics.Raycast(p + Vector3.up * LowY, dir, out var hit, Reach, Layers.WorldMask, QueryTriggerInteraction.Ignore) || hit.normal.y >= 0.5f) continue;
                        low = true;
                        if (Physics.Raycast(p + Vector3.up * HighY, dir, out var hit2, Reach, Layers.WorldMask, QueryTriggerInteraction.Ignore) && hit2.normal.y < 0.5f) high = true;
                    }
                    if (!low) continue;
                    int c = g.spanCol[s];
                    cover[c] = (cover.TryGetValue(c, out var h) && h) || high;
                }
                // 2 格内相连的掩体站位并成一处
                var seen = new HashSet<int>();
                int pieces = 0, tall = 0;
                var stack = new Stack<int>();
                foreach (var start in cover.Keys)
                {
                    if (!seen.Add(start)) continue;
                    int size = 0;
                    bool anyHigh = false;
                    stack.Push(start);
                    while (stack.Count > 0)
                    {
                        int c = stack.Pop();
                        size++;
                        anyHigh |= cover[c];
                        int x = c % g.nx, z = c / g.nx;
                        for (int dz = -2; dz <= 2; dz++)
                        for (int dx = -2; dx <= 2; dx++)
                        {
                            int xx = x + dx, zz = z + dz;
                            if (xx < 0 || zz < 0 || xx >= g.nx || zz >= g.nz) continue;
                            int n = zz * g.nx + xx;
                            if (cover.ContainsKey(n) && seen.Add(n)) stack.Push(n);
                        }
                    }
                    if (size < 2) continue;
                    pieces++;
                    if (anyHigh) tall++;
                }
                string msg = $"{site.name}：{pieces} 处掩体（{tall} 处能全遮），掩体旁站位 {cover.Count} 格";
                if (site.minCover >= 0 && pieces < site.minCover) rep.Fail($"{msg} —— 少于要求的 {site.minCover} 处");
                else if (site.minCover >= 0) rep.Line($"✓ {msg}（要求 ≥ {site.minCover}）");
                else rep.Line($"· {msg}");
            }
        }
    }
}
