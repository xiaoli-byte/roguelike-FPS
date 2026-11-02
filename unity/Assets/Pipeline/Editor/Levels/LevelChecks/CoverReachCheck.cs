using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 掩体可达（S5，docs/level-design/ch3-v2.md 2.6 / 2.9「场地可站立面 ≥ 80% 离最近的全遮 ≤ 8 m」）：
    /// 场地里每个不靠二段跳就能站的格子（熔岩里的不算），到最近的「全遮站位」的水平距离——全遮站位同 <see cref="CoverCheck"/>：
    /// 站在这一格，1.1 m 和 1.7 m 高朝某个方向 1.5 m 内都打到陡面（墙、岩壁、铸范、铜人、≥ 2.6 m 的掩体）。
    /// 报告每个战斗场地 ≤ <see cref="Reach"/> m 的比例和最远的空档；声明了 minCoverReach 的场地不够数不合格。缓冲场地、首领场（SiteSpec.boss）不查。
    /// </summary>
    public sealed class CoverReachCheck : ILevelCheck
    {
        public string Id => "cover-reach";
        public string Title => "掩体可达（离全遮 ≤ 8 m 的比例，S5）";
        public int Order => 105;

        public const float Reach = 8f;
        const float LowY = 1.1f, HighY = 1.7f, RayReach = 1.5f;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var sites = ctx.Sites.Where(s => s.combat && !s.boss).ToList();
            if (sites.Count == 0)
            {
                rep.Line("没有要查的战斗场地（缓冲、首领场不查），跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail("出生点附近没有可站立面，量不了掩体可达");
                return;
            }
            var g = ctx.Grid;
            var lava = SiteLava.Bodies();
            foreach (var site in sites)
            {
                var spans = ctx.SiteSpans(site).Where(s => !SiteLava.Wet(lava, g.Pos(s))).ToList();
                if (spans.Count == 0)
                {
                    rep.Fail($"{site.name}：场地里没有不靠二段跳能站的干地");
                    continue;
                }
                var high = new List<Vector2>();
                foreach (var s in spans)
                {
                    var p = g.Pos(s);
                    if (FullCover(p)) high.Add(new Vector2(p.x, p.z));
                }
                int near = 0;
                float worst = 0;
                Vector3 worstAt = default;
                foreach (var s in spans)
                {
                    var p = g.Pos(s);
                    var q = new Vector2(p.x, p.z);
                    float best = float.MaxValue;
                    foreach (var h in high)
                    {
                        float d = (h - q).sqrMagnitude;
                        if (d < best) best = d;
                    }
                    best = Mathf.Sqrt(best);
                    if (best <= Reach) near++;
                    else if (best > worst)
                    {
                        worst = best;
                        worstAt = p;
                    }
                }
                float ratio = near / (float)spans.Count;
                string msg = $"{site.name}：{spans.Count} 格干地，{ratio:P0} 离全遮 ≤ {Reach:F0} m（全遮站位 {high.Count} 格）" +
                             (worst > 0 ? $"，最远的空档 {worst:F0} m @ {LevelContext.At(worstAt)}" : "");
                if (site.minCoverReach >= 0 && ratio < site.minCoverReach) rep.Fail($"{msg} —— 低于要求的 {site.minCoverReach:P0}");
                else rep.Line($"{(site.minCoverReach >= 0 ? "✓" : "·")} {msg}{(site.minCoverReach >= 0 ? $"（要求 ≥ {site.minCoverReach:P0}）" : "")}");
            }
            foreach (var site in ctx.Sites.Where(s => s.boss)) rep.Line($"· {site.name}：首领场，不查");
        }

        /// <summary>站在 p（地面）上：某个方向 1.5 m 内，1.1 m 和 1.7 m 高都打到陡面（同 CoverCheck 的「能全遮」）</summary>
        public static bool FullCover(Vector3 p)
        {
            for (int k = 0; k < 8; k++)
            {
                var dir = Quaternion.Euler(0, k * 45, 0) * Vector3.forward;
                if (!Physics.Raycast(p + Vector3.up * LowY, dir, out var hit, RayReach, Layers.WorldMask, QueryTriggerInteraction.Ignore) || hit.normal.y >= 0.5f) continue;
                if (Physics.Raycast(p + Vector3.up * HighY, dir, out var hit2, RayReach, Layers.WorldMask, QueryTriggerInteraction.Ignore) && hit2.normal.y < 0.5f) return true;
            }
            return false;
        }
    }

    /// <summary>场景里的熔岩判定体（编辑器里 LavaVolume 不登记进 LavaField，自己收）：哪些格子是熔岩</summary>
    public static class SiteLava
    {
        public static List<LavaBody> Bodies() =>
            Object.FindObjectsByType<LavaVolume>().Where(v => v).Select(v => v.Body).Where(b => b != null).ToList();

        /// <summary>地面点 p 在熔岩里（某片熔岩的形状盖住它、地面低于熔岩面）</summary>
        public static bool Wet(List<LavaBody> bodies, Vector3 p)
        {
            foreach (var b in bodies)
                if (b.Contains(p.x, p.z) && p.y < b.level + 0.05f && p.y > b.level - b.depth - 0.5f)
                    return true;
            return false;
        }
    }

    /// <summary>
    /// 熔岩占场地比例（S5，ch3-v2 2.7「战斗场地内熔岩面 ≤ 35%」）：场地圆盘里的格子，熔岩（形状盖住、地面低于熔岩面）占「熔岩 + 不靠二段跳能站的干地」的比例。
    /// 每个场地报一行；声明了 maxLavaShare 的场地超了不合格。
    /// </summary>
    public sealed class LavaShareCheck : ILevelCheck
    {
        public string Id => "lava-share";
        public string Title => "熔岩占场地比例（S5）";
        public int Order => 106;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.Sites.Count == 0)
            {
                rep.Line("没有场地，跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail("出生点附近没有可站立面，量不了熔岩比例");
                return;
            }
            var lava = SiteLava.Bodies();
            if (lava.Count == 0)
            {
                rep.Line("场景里没有熔岩：各场地 0%");
                return;
            }
            var g = ctx.Grid;
            foreach (var site in ctx.Sites)
            {
                var dryCols = new HashSet<int>(ctx.SiteSpans(site).Where(s => !SiteLava.Wet(lava, g.Pos(s))).Select(s => g.spanCol[s]));
                var wetCols = new HashSet<int>();
                foreach (var s in g.InDisc(site.center, site.Radius))
                    if (SiteLava.Wet(lava, g.Pos(s))) wetCols.Add(g.spanCol[s]);
                dryCols.ExceptWith(wetCols);
                int total = dryCols.Count + wetCols.Count;
                float share = total > 0 ? wetCols.Count / (float)total : 0;
                float cell = g.cell * g.cell;
                string msg = $"{site.name}：熔岩 {wetCols.Count * cell:F0} m² / 场地 {total * cell:F0} m² = {share:P0}";
                if (site.maxLavaShare >= 0 && share > site.maxLavaShare) rep.Fail($"{msg} —— 超过 {site.maxLavaShare:P0}");
                else rep.Line($"{(site.maxLavaShare >= 0 ? "✓" : "·")} {msg}{(site.maxLavaShare >= 0 ? $"（≤ {site.maxLavaShare:P0}）" : "")}");
            }
        }
    }
}
