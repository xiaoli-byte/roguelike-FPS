using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 锚点有路：每个刷怪锚点（声明的 + EncounterSite 的）都在 NavMesh 上，并且从玩家出生点有完整的 NavMesh 路径——
    /// 敌人刷在孤岛、台子顶上就走不到玩家身边（Three.js 版「不在不可达的台子上刷怪」）。飞行锚点不要求。
    /// </summary>
    public sealed class AnchorReachCheck : ILevelCheck
    {
        public string Id => "anchors";
        public string Title => "锚点有路（NavMesh，从出生点）";
        public int Order => 40;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var anchors = ctx.Anchors;
            if (anchors.Count == 0)
            {
                rep.Line("没有刷怪锚点，跳过");
                return;
            }
            var spawn = ctx.SpawnNav;
            if (spawn == null)
            {
                rep.Fail($"玩家出生点 {LevelContext.At(ctx.spec.playerSpawn)} 附近 4 m 没有 NavMesh");
                return;
            }
            int ok = 0;
            float longest = 0;
            string longestName = "";
            foreach (var a in anchors)
            {
                string label = string.IsNullOrEmpty(a.site) ? a.name : $"{a.site} / {a.name}";
                if (a.flying)
                {
                    rep.Line($"· {label}：飞行锚点，不查路");
                    ok++;
                    continue;
                }
                if (!LevelContext.NavPoint(a.pos, 2.5f, out var onNav))
                {
                    rep.Fail($"{label} {LevelContext.At(a.pos)}：2.5 m 内没有 NavMesh");
                    continue;
                }
                if (Mathf.Abs(onNav.y - a.pos.y) > 1.5f)
                    rep.Warn($"{label}：锚点离 NavMesh 面 {Mathf.Abs(onNav.y - a.pos.y):F1} m（摆在台子上 / 坑里？）");
                var status = LevelContext.NavPath(spawn.Value, onNav, out float len);
                if (status != NavMeshPathStatus.PathComplete)
                {
                    rep.Fail($"{label} {LevelContext.At(a.pos)}：从出生点走不到（{status}）");
                    continue;
                }
                ok++;
                if (len > longest) { longest = len; longestName = label; }
            }
            if (ok == anchors.Count) rep.Line($"✓ {anchors.Count} 个锚点都有路（最远：{longestName}，路径 {longest:F0} m）");
            else rep.Line($"{ok}/{anchors.Count} 个锚点有路");
        }
    }
}
