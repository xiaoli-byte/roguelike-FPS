using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 防越界：用玩家可达性洪泛（全部能力：走、跳、冲刺、二段跳）从出生点铺满整张图，看能不能落到可玩区遮罩外 escapeMargin 米以上的可站立面。
    /// 边界线上每一处贴边的可站立面都被当作起跳点试过（16 个方向 × 起跳包络），所以等于沿边界逐点采样。
    ///   现状（不可见墙也挡路）：能出去就不合格；
    ///   撤掉不可见墙（软边界 L3 落地后空气墙要撤）：能出去的地方只提醒，列出位置给 L3 / 关卡收尾补地形或推回区。
    /// </summary>
    public sealed class EscapeCheck : ILevelCheck
    {
        public string Id => "escape";
        public string Title => "防越界（走 / 跳 / 冲刺 / 二段跳）";
        public int Order => 70;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.spec.playable == null)
            {
                rep.Warn("没有声明可玩区遮罩（LevelSpec.playable），防越界没法查");
                return;
            }
            var g = ctx.Grid;
            if (ctx.StartSpan < 0)
            {
                rep.Fail($"出生点 {LevelContext.At(ctx.spec.playerSpawn)} 附近没有可站立面，可达性洪泛起不了步");
                return;
            }
            var f = ctx.Reach;
            int edgeSpans = 0, reached = 0;
            for (int i = 0; i < g.Spans; i++)
            {
                if (f.tier[i] == (byte)Move.None) continue;
                reached++;
                if (g.outsideDist[g.spanCol[i]] <= 0 && BordersOutside(g, g.spanCol[i])) edgeSpans++;
            }
            rep.Line($"栅格 {g.nx} × {g.nz}（{g.cell:F1} m），可站立面 {g.Spans}，可达 {reached}；贴着边界线的可达面 {edgeSpans} 处都当起跳点试过");
            rep.Line($"尺度：{ctx.Scale}");
            var clusters = Cluster(f);
            if (clusters.Count == 0) rep.Line($"✓ 出不去：界外 {ctx.spec.escapeMargin:F0} m 以外没有一处可达（射线 {f.linecasts}，扫掠 {f.sweeps}）");
            else
                foreach (var c in clusters.Take(6))
                    rep.Fail($"越界：从 {LevelContext.At(c.breach)} 用{ReachFlood.Label(c.tier)}出去，落到 {LevelContext.At(c.landing)}（这一带 {c.count} 处）");
            if (clusters.Count > 6) rep.Line($"……另有 {clusters.Count - 6} 处越界");

            // 软边界就绪：撤掉不可见墙之后
            var nw = ctx.ReachWithoutWalls;
            if (nw == null) rep.Line("场景里没有不可见墙：上面的结果就是地形本身的边界");
            else
            {
                var open = Cluster(nw);
                if (open.Count == 0) rep.Line("✓ 撤掉不可见墙之后也出不去：地形本身就是边界，空气墙可以直接撤");
                else
                {
                    rep.Warn($"撤掉不可见墙之后有 {open.Count} 处能出去（软边界 L3 的推回区要盖住，或把地形抬成陡坡）：");
                    foreach (var c in open.Take(8))
                        rep.Line($"    · {LevelContext.At(c.breach)} 用{ReachFlood.Label(c.tier)} → {LevelContext.At(c.landing)}（{c.count} 处）");
                    if (open.Count > 8) rep.Line($"    ……另有 {open.Count - 8} 处");
                }
            }
        }

        static bool BordersOutside(ReachGrid g, int col)
        {
            int x = col % g.nx, z = col / g.nx;
            for (int dz = -1; dz <= 1; dz++)
            for (int dx = -1; dx <= 1; dx++)
            {
                int xx = x + dx, zz = z + dz;
                if (xx < 0 || zz < 0 || xx >= g.nx || zz >= g.nz) continue;
                if (!g.inside[zz * g.nx + xx]) return true;
            }
            return false;
        }

        struct Breach
        {
            public Vector3 breach, landing;
            public Move tier;
            public int count;
        }

        /// <summary>越界落点按出口位置（最后一个界内面）聚成团，同一团 15 m 内；按能力从弱到强排（走得出去的最严重）</summary>
        static List<Breach> Cluster(ReachFlood f)
        {
            var list = new List<Breach>();
            foreach (var e in f.escapes)
            {
                var b = f.grid.Pos(f.BreachOf(e));
                var tier = f.Tier(e);
                int idx = list.FindIndex(c => Vector2.Distance(new Vector2(c.breach.x, c.breach.z), new Vector2(b.x, b.z)) < 15f);
                if (idx < 0) list.Add(new Breach { breach = b, landing = f.grid.Pos(e), tier = tier, count = 1 });
                else
                {
                    var c = list[idx];
                    c.count++;
                    if (tier < c.tier) { c.tier = tier; c.landing = f.grid.Pos(e); }
                    list[idx] = c;
                }
            }
            return list.OrderBy(c => c.tier).ThenByDescending(c => c.count).ToList();
        }
    }
}
