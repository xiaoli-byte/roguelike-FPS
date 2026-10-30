namespace Spiritfire.Game
{
    /// <summary>
    /// 固定机位性能预算（docs/unity-parity.md I4 → L5）：perf 冒烟套件（Testing/Suites/PerfSuite）逐机位比对实测。
    /// 数值来自 docs/performance.md「Unity 固定机位基线」2026-10-30 十二关实测（RTX 5090 Laptop / Ultra 9 290HX，1920×1080，PC 画质，
    /// GRD + GPU 遮挡剔除），在最重的机位上留余量：GPU P95 最高 7.8 ms（3-4、1-3）→ 12；编辑器主线程 P95 最高 10.9 ms（1-3）→ 16；
    /// 绘制调用最多 4077（2-2，编辑器渲染统计，含阴影）→ 5000；三角面最多 365 万（1-2，含地形与阴影）→ 500 万。
    /// 换参考机要重测再改。关卡验收的静态粗估另有一份（LevelSpec.Budget，不含地形 / 阴影 / 遮挡）。
    /// </summary>
    public static class PerfBudget
    {
        public struct Limits
        {
            /// <summary>GPU 帧时 P95（毫秒，1920×1080，高画质）</summary>
            public float gpuP95Ms;
            /// <summary>主线程帧时 P95（毫秒，编辑器 Play 模式）</summary>
            public float mainP95Ms;
            /// <summary>单个机位的绘制调用 / 三角面（实测均值；静态粗估不算遮挡剔除和实例化，按自己的倍数放宽）</summary>
            public int drawCalls;
            public long triangles;
        }

        public static readonly Limits Default = new() { gpuP95Ms = 12f, mainP95Ms = 16f, drawCalls = 5000, triangles = 5_000_000 };

        /// <summary>关卡 id（1-1、2-3…）的预算；没有单独定的用 <see cref="Default"/></summary>
        public static Limits For(string levelId) => Default;
    }
}
