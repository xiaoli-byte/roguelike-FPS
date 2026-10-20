using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 高差层数（docs/level-design/unity-maps-v1.md 原则 4）：场地里可达站立面的高度减去场地地面（可达面高度的 20 分位），分三层——
    ///   地面层 &lt; 1 m · 掩体 / 台阶层 1–2.5 m · 俯射层 ≥ 2.5 m。一层至少 6 m² 才算数。
    /// 声明 minLayers 的场地层数不够不合格；声明 overlook 的场地必须有不靠二段跳就能上去的俯射层，只有冲刺才上得去时提醒
    /// （尺度表：高台给坡道 / 台阶）。只有二段跳才上得去的高处单独报告（那是捷径，不算一层）。
    /// </summary>
    public sealed class HeightLayersCheck : ILevelCheck
    {
        public string Id => "layers";
        public string Title => "高差层数（地面 / 台阶 / 俯射）";
        public int Order => 110;

        public const float StepBand = 1f, OverlookBand = 2.5f, MinArea = 6f;
        static readonly string[] Names = { "地面", "台阶", "俯射" };

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.Sites.Count == 0)
            {
                rep.Line("没有场地，跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail("出生点附近没有可站立面，量不了高差");
                return;
            }
            var g = ctx.Grid;
            var f = ctx.Reach;
            float cellArea = g.cell * g.cell;
            foreach (var site in ctx.Sites)
            {
                var spans = ctx.SiteSpans(site, Move.DoubleJump);
                var main = spans.Where(s => f.tier[s] <= (byte)Move.Dash).ToList();
                if (main.Count == 0)
                {
                    rep.Fail($"{site.name}：场地里没有不靠二段跳就能站的地方");
                    continue;
                }
                var heights = main.Select(s => g.spanY[s]).OrderBy(y => y).ToList();
                float floor = heights[Mathf.Clamp(Mathf.FloorToInt(heights.Count * 0.2f), 0, heights.Count - 1)];
                var area = new float[3];
                var best = new[] { Move.None, Move.None, Move.None };
                foreach (var s in main)
                {
                    int band = Band(g.spanY[s] - floor);
                    area[band] += cellArea;
                    if (f.tier[s] < (byte)best[band]) best[band] = (Move)f.tier[s];
                }
                float shortcut = spans.Count(s => f.tier[s] == (byte)Move.DoubleJump && Band(g.spanY[s] - floor) > 0) * cellArea;
                int layers = area.Count(a => a >= MinArea);
                var parts = new List<string>();
                for (int b = 0; b < 3; b++)
                    if (area[b] > 0) parts.Add($"{Names[b]} {area[b]:F0} m²" + (b > 0 ? $"（{ReachFlood.Label(best[b])}）" : ""));
                string msg = $"{site.name}：{layers} 层 —— {string.Join(" · ", parts)}" + (shortcut > 0 ? $"；另有 {shortcut:F0} m² 只有二段跳上得去（捷径）" : "");
                if (site.minLayers >= 0 && layers < site.minLayers) rep.Fail($"{msg} —— 少于要求的 {site.minLayers} 层");
                else rep.Line($"{(site.minLayers >= 0 ? "✓" : "·")} {msg}");
                if (site.overlook)
                {
                    if (area[2] < MinArea) rep.Fail($"{site.name}：没有不靠二段跳就能上去的俯射层（≥ {OverlookBand} m，至少 {MinArea:F0} m²）");
                    else if (best[2] == Move.Dash) rep.Warn($"{site.name}：俯射层要冲刺才上得去（尺度表：2.5–4 m 高台给坡道 / 台阶）");
                }
            }
        }

        static int Band(float dh) => dh >= OverlookBand ? 2 : dh >= StepBand ? 1 : 0;
    }
}
