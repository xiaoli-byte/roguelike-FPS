using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 性能（I4，docs/performance-unity.md）：固定机位上的渲染估算，归 L5 的 PerfBudgetCheck 用。
    //   机位规则和运行时的性能套件（playtest perf / perf-ch1/2/3）同一份（Spiritfire.Game.PerfViews）；
    //   估算 = 主相机视锥 + 按层剔除距离（CullLayers）里的渲染器 / 三角面 / 绘制，加阴影距离内的投影体，不含遮挡、地形、粒子。
    public static partial class LevelKit
    {
        /// <summary>一档画质下一个机位的估算</summary>
        public struct PerfSample
        {
            public PerfView view;
            public QualityProfile tier;
            public PerfViews.Estimate est;
        }

        /// <summary>场景里的固定机位（出生 / 中段远眺 / 战斗 + 主线机位链），站点贴地（同运行时的性能套件）</summary>
        public static List<PerfView> PerfViewsOf(Scene scene, Rect mapArea)
        {
            var (spawnPos, spawnRot) = PlayerSpawn.Resolve(scene);
            Physics.SyncTransforms();
            var views = PerfViews.Compute(spawnPos, spawnRot, LevelMeta.Collect(scene), mapArea, chain: true);
            for (int i = 0; i < views.Count; i++)
            {
                var v = views[i];
                v.stand = PerfViews.Ground(v.stand);
                views[i] = v;
            }
            return views;
        }

        /// <summary>高 / 低两档下每个机位的估算</summary>
        public static List<PerfSample> PerfEstimate(Scene scene, Rect mapArea)
        {
            var renderers = Object.FindObjectsByType<Renderer>().Where(r => r.gameObject.scene == scene).ToList();
            float fog = RenderSettings.fog && RenderSettings.fogMode == FogMode.Linear ? RenderSettings.fogEndDistance : 0;
            var list = new List<PerfSample>();
            foreach (var tier in new[] { QualityProfile.High, QualityProfile.Low })
                foreach (var v in PerfViewsOf(scene, mapArea))
                    list.Add(new PerfSample { view = v, tier = tier, est = PerfViews.Measure(v, renderers, tier, fog, tier.shadowDistance) });
            return list;
        }
    }
}
