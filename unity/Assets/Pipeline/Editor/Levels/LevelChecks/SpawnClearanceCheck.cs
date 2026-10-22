using System.Linq;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 出生净空（按体型）：每个锚点放得下会在这里出生的最大敌人——半径、身高取该场地编制里最大的（已乘 scale，精英 ×1.25）。
    /// 胶囊底部抬到能容下 30° 坡的高度（地形起伏不算挤），撞到任何世界碰撞体（含不可见墙）就不合格；
    /// 离 NavMesh 边缘比半径的六成还近时提醒（大体型会卡在边上）。
    /// </summary>
    public sealed class SpawnClearanceCheck : ILevelCheck
    {
        public string Id => "spawn-clearance";
        public string Title => "出生净空（按敌人体型）";
        public int Order => 50;

        static readonly float SlopeLift = 1f / Mathf.Cos(30f * Mathf.Deg2Rad);

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var anchors = ctx.Anchors;
            if (anchors.Count == 0)
            {
                rep.Line("没有刷怪锚点，跳过");
                return;
            }
            int ok = 0;
            foreach (var a in anchors)
            {
                string label = string.IsNullOrEmpty(a.site) ? a.name : $"{a.site} / {a.name}";
                var p = a.pos;
                bool onNav = !a.flying && LevelContext.NavPoint(a.pos, 2.5f, out p);
                if (!onNav) p = a.pos;
                float r = a.radius, h = Mathf.Max(a.height, r * 2);
                // NavMesh 面和真实地面差一两分米：多抬 0.2 m
                var lo = p + Vector3.up * (r * SlopeLift + 0.2f);
                var hi = p + Vector3.up * Mathf.Max(h - r, r * SlopeLift + 0.2f);
                var hits = Physics.OverlapCapsule(lo, hi, r, LevelContext.BlockMask, QueryTriggerInteraction.Ignore);
                if (hits.Length > 0)
                {
                    var names = string.Join("、", hits.Select(c => c.name).Distinct().Take(3));
                    rep.Fail($"{label} {LevelContext.At(p)}：放不下 {a.largest}（半径 {r:F2} m、高 {h:F1} m），撞到 {names}");
                    continue;
                }
                ok++;
                if (onNav && NavMesh.FindClosestEdge(p, out var edge, LevelContext.Walker) && edge.distance < r * 0.6f)
                    rep.Warn($"{label}：离 NavMesh 边缘只有 {edge.distance:F1} m（{a.largest} 半径 {r:F2} m，容易卡边）");
            }
            if (ok == anchors.Count)
            {
                var big = anchors.OrderByDescending(x => x.radius).First();
                rep.Line($"✓ {anchors.Count} 个锚点都放得下（最大体型：{big.largest}，半径 {big.radius:F2} m、高 {big.height:F1} m）");
            }
        }
    }
}
