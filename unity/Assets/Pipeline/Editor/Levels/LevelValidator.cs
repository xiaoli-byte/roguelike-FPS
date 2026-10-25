using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEditor;
using Debug = UnityEngine.Debug;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 一条关卡验收规则（docs/unity-parity.md L5）：读 <see cref="LevelContext"/>（声明数据 + 场景 + 共享的可达性栅格），把结果写进报告。
    /// 每条规则一个文件放在 LevelChecks/ 下，实现这个接口就会被 <see cref="LevelValidator"/> 找到（TypeCache 扫描，不用登记）。
    /// 不合格用 rep.Fail，提醒用 rep.Warn；声明里没写阈值的项只报告数字。
    /// </summary>
    public interface ILevelCheck
    {
        /// <summary>规则 id（LevelSpec.skip 用）</summary>
        string Id { get; }
        /// <summary>报告里的小节标题</summary>
        string Title { get; }
        /// <summary>执行顺序（小的在前）</summary>
        int Order { get; }
        void Run(LevelContext ctx, LevelKit.Report rep);
    }

    /// <summary>
    /// 关卡验收规则集：任何 [LevelBuilder] 关卡在生成、烘焙之后调 <see cref="Run"/>，依次跑全部 <see cref="ILevelCheck"/>，
    /// 再出俯视地图（Assets/Art/_Review/level_&lt;id&gt;_map.png + .json），并由 <see cref="LevelMetaWriter"/> 写运行时行旅图与场景里的 LevelMeta（U7）。返回本次新增的不合格项数。
    /// 规则：主线连通、坡度、地标视线、锚点有路、出生净空、交互净空、防越界、主线不靠二段跳、场地尺寸、掩体数、高差层数、占位清单、面数 / 批次预算。
    /// </summary>
    public static class LevelValidator
    {
        static List<ILevelCheck> checks;

        /// <summary>全部规则（按 Order、id 排序）</summary>
        public static IReadOnlyList<ILevelCheck> Checks
        {
            get
            {
                if (checks != null) return checks;
                var list = new List<ILevelCheck>();
                foreach (var t in TypeCache.GetTypesDerivedFrom<ILevelCheck>())
                {
                    if (t.IsAbstract || t.IsInterface || t.ContainsGenericParameters || t.GetConstructor(Type.EmptyTypes) == null) continue;
                    list.Add((ILevelCheck)Activator.CreateInstance(t));
                }
                list.Sort((a, b) => a.Order != b.Order ? a.Order.CompareTo(b.Order) : string.CompareOrdinal(a.Id, b.Id));
                checks = list;
                return checks;
            }
        }

        /// <summary>跑规则集（报告追加到 rep）并出俯视地图；返回本次新增的不合格项数</summary>
        public static int Run(LevelSpec spec, LevelKit.Report rep, bool captureMap = true)
        {
            int before = rep.failures;
            var total = Stopwatch.StartNew();
            var ctx = new LevelContext(spec);
            rep.Line($"══ 规则集（{Checks.Count} 项）══");
            foreach (var c in Checks)
            {
                rep.Section(c.Title);
                if (spec.skip.Contains(c.Id))
                {
                    rep.Line($"（跳过：关卡声明 skip「{c.Id}」）");
                    continue;
                }
                var sw = Stopwatch.StartNew();
                try { c.Run(ctx, rep); }
                catch (Exception e)
                {
                    rep.Fail($"{c.Title}：检查异常 {e.GetType().Name}：{e.Message}");
                    Debug.LogException(e);
                }
                if (sw.Elapsed.TotalSeconds >= 1) rep.Line($"（用时 {sw.Elapsed.TotalSeconds:F1} s）");
            }
            if (captureMap)
            {
                rep.Section("俯视地图");
                try
                {
                    var area = ctx.MapArea;
                    var png = LevelKit.CaptureMap(spec.id, area, spec.mapPixels);
                    rep.Line($"✓ {png}（世界 XZ {area.xMin:F0}…{area.xMax:F0} × {area.yMin:F0}…{area.yMax:F0}，坐标映射见同名 .json）");
                    try { LevelMetaWriter.Write(spec, area, png, rep); } // U7：运行时行旅图（入库的 JPG）+ 场景里的 LevelMeta
                    catch (Exception e)
                    {
                        rep.Warn($"行旅图元数据没写成：{e.Message}");
                        Debug.LogException(e);
                    }
                }
                catch (Exception e)
                {
                    rep.Warn($"俯视地图没截成：{e.Message}");
                    Debug.LogException(e);
                }
            }
            int fails = rep.failures - before;
            rep.Line($"规则集：不合格 {fails} 项，提醒 {rep.warnings} 条，用时 {total.Elapsed.TotalSeconds:F1} s" +
                     (ctx.ReachBuilt ? $"（其中可达性栅格 {ctx.ReachSeconds:F1} s）" : ""));
            return fails;
        }
    }
}
