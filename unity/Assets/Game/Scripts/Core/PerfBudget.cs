namespace Spiritfire.Game
{
    /// <summary>
    /// 固定机位的性能预算（I4，docs/performance-unity.md「预算」），运行时和 L5 共用这一份：
    ///   运行时 <see cref="Check"/>：性能套件（playtest perf / perf-ch1/2/3）每个机位、每一档采完对一遍——GPU P95、主线程 P95（CPU Main Thread Frame Time，
    ///     不含编辑器那段）、绘制调用、SetPass、三角面、视锥内渲染器；
    ///   L5 <see cref="CheckStatic"/>：构建时 PerfBudgetCheck 在同一组机位上估算（视锥 + 按层剔除距离，不含阴影级联、后处理、地形、遮挡），只看渲染器 / 三角面 / 绘制。
    /// 阈值 = 参考机基线的最大值留余量（计数约 25%，时间约 50%：编辑器里的时间受机器负载影响大）。帧时间不进预算。
    /// 参考机：RTX 3070 / Ryzen 7 3700X（2026-10-30）；另一台 RTX 5090 Laptop 的基线在 art/reviews/perf-unity-20261030/，最重的机位 GPU P95 7.8 ms。换参考机要重测再改。
    /// 关卡验收另有一份更粗的全场景 / 主线机位面数预算（LevelSpec.Budget，BudgetCheck）。
    /// </summary>
    public static class PerfBudget
    {
        /// <summary>运行时一档的上限（0 = 这一项不检查）</summary>
        public struct Limits
        {
            public float gpuP95Ms, mainP95Ms;
            public int drawCalls, setPass, frustumRenderers;
            public long triangles;
        }

        // 本机基线（docs/performance-unity.md 第 3 节）各项最大值：高档 GPU P95 5.1 ms（2-2 主线 1）、主线程 P95 10.8 ms（2-1 主线 1）、绘制 3499（2-2 出生）、
        //   SetPass 378（3-4 出生）、三角面 665 万（2-2 主线 1，含 4 级阴影）、视锥内渲染器 365（3-4 出生）；
        // 低档 GPU P95 2.2 ms、主线程 P95 9.7 ms（2-3 战斗）、绘制 1069、SetPass 180、三角面 233 万、视锥内渲染器 310。
        public static readonly Limits High = new() { gpuP95Ms = 8f, mainP95Ms = 16f, drawCalls = 4400, setPass = 480, triangles = 8_300_000, frustumRenderers = 460 };
        public static readonly Limits Low = new() { gpuP95Ms = 3.5f, mainP95Ms = 15f, drawCalls = 1350, setPass = 230, triangles = 2_900_000, frustumRenderers = 390 };

        public static Limits For(bool high) => high ? High : Low;

        /// <summary>L5 估算的上限（0 = 不检查）：视锥内渲染器、三角面、绘制（主画面 + 阴影距离内投影体）</summary>
        public struct StaticLimits
        {
            public int renderers, draws;
            public long triangles;
        }

        // 12 关 L5 估算的最大值都在 2-2 出生：高档渲染器 314、三角面 165 万、绘制 381（含投影 67）；低档 284、155 万、312
        public static readonly StaticLimits StaticHigh = new() { renderers = 400, triangles = 2_100_000, draws = 480 };
        public static readonly StaticLimits StaticLow = new() { renderers = 360, triangles = 2_000_000, draws = 400 };

        /// <summary>运行时超出预算的项（没超 = null）。拿不到的量（≤ 0）不检查</summary>
        public static string Check(bool high, float gpuP95, float mainP95, int drawCalls, int setPass, long triangles, int frustumRenderers)
        {
            var l = For(high);
            var sb = new System.Text.StringBuilder();
            Over(sb, "GPU P95", gpuP95, l.gpuP95Ms, "F2", " ms");
            Over(sb, "主线程 P95", mainP95, l.mainP95Ms, "F2", " ms");
            Over(sb, "绘制调用", drawCalls, l.drawCalls);
            Over(sb, "SetPass", setPass, l.setPass);
            Over(sb, "三角面", triangles, l.triangles);
            Over(sb, "视锥内渲染器", frustumRenderers, l.frustumRenderers);
            return sb.Length > 0 ? sb.ToString() : null;
        }

        /// <summary>L5 估算超出预算的项（没超 = null）</summary>
        public static string CheckStatic(bool high, int renderers, long triangles, int draws)
        {
            var l = high ? StaticHigh : StaticLow;
            var sb = new System.Text.StringBuilder();
            Over(sb, "视锥内渲染器", renderers, l.renderers);
            Over(sb, "三角面", triangles, l.triangles);
            Over(sb, "绘制（含投影）", draws, l.draws);
            return sb.Length > 0 ? sb.ToString() : null;
        }

        static void Over(System.Text.StringBuilder sb, string what, double got, double max, string fmt = "N0", string unit = "")
        {
            if (max <= 0 || got <= 0 || got <= max) return;
            if (sb.Length > 0) sb.Append("、");
            sb.Append($"{what} {got.ToString(fmt)}{unit} > {max.ToString(fmt)}{unit}");
        }
    }
}
