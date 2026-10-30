using Spiritfire.Game;
using UnityEditor.SceneManagement;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 性能预算（I4，固定机位；docs/performance-unity.md「预算」）：在运行时性能套件的同一组机位（出生 / 中段远眺 / 战斗 + 主线机位链）上，按高 / 低两档估算
    /// 视锥里的渲染器数、三角面、绘制（主画面 + 阴影距离内的投影体），超出 <see cref="PerfBudget.CheckStatic"/> 的阈值不合格。
    /// 阈值 = 12 关的最大值留 25% 余量；按层剔除距离（<see cref="CullLayers"/>）算在里面，遮挡、地形、粒子、后处理不算
    /// （运行时的真实计数由 playtest perf / perf-ch1/2/3 对 <see cref="PerfBudget.Check"/> 再验一遍）。关卡声明 skip「perf」可以跳过。
    /// </summary>
    public sealed class PerfBudgetCheck : ILevelCheck
    {
        public string Id => "perf";
        public string Title => "性能预算（固定机位估算）";
        public int Order => 135;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var scene = EditorSceneManager.GetActiveScene();
            var samples = LevelKit.PerfEstimate(scene, ctx.MapArea);
            if (samples.Count == 0)
            {
                rep.Warn("场景里没有出生点 / 地点，量不了机位");
                return;
            }
            foreach (var s in samples)
            {
                bool high = s.tier.level == Spiritfire.Art.ArtQualityLevel.High;
                var e = s.est;
                var v = s.view;
                string where = $"{s.tier.label} · {v.name}（{v.stand.x:F0}, {v.stand.y:F0}, {v.stand.z:F0}）";
                rep.Line($"{where}：{e}");
                var over = PerfBudget.CheckStatic(high, e.renderers, e.triangles, e.draws + e.casterDraws);
                if (over != null) rep.Fail($"{where} 超出预算：{over}");
            }
        }
    }
}
