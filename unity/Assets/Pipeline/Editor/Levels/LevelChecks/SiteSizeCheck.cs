using System.Linq;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 场地尺寸：以场地中心为圆心、设计尺寸为直径的圆里，不靠二段跳能站到的面积（按列算，上下两层只算一次）至少占一半——
    /// 也就是折合直径 ≥ 设计尺寸的 70%。岩丘、高台侧壁、边界、站不下人的缝都会扣掉面积。
    /// 战斗场地设计尺寸小于 40 m 时提醒（尺度表：场地 40–60 m）。
    /// </summary>
    public sealed class SiteSizeCheck : ILevelCheck
    {
        public string Id => "site-size";
        public string Title => "场地尺寸（可站立面积）";
        public int Order => 90;

        public const float MinFill = 0.5f;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.Sites.Count == 0)
            {
                rep.Line("没有场地，跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail("出生点附近没有可站立面，量不了场地");
                return;
            }
            var g = ctx.Grid;
            foreach (var site in ctx.Sites)
            {
                var cols = ctx.SiteSpans(site).Select(s => g.spanCol[s]).Distinct().Count();
                float area = cols * g.cell * g.cell;
                float disc = Mathf.PI * site.Radius * site.Radius;
                float fill = area / disc;
                float diameter = 2 * Mathf.Sqrt(area / Mathf.PI);
                string msg = $"{site.name}：设计 {site.size:F0} m，可站立 {area:F0} m²（占圆 {fill:P0}，折合直径 {diameter:F0} m）";
                if (fill < MinFill) rep.Fail($"{msg} —— 不到一半，场地比设计小");
                else rep.Line($"✓ {msg}");
                if (site.combat && site.size < 40) rep.Warn($"{site.name}：战斗场地设计尺寸 {site.size:F0} m < 40 m（尺度表：40–60 m）");
            }
        }
    }
}
