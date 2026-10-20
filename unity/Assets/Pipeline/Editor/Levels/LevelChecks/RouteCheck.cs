using System.Linq;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>主线连通：相邻路点两两求 NavMesh 路径（人形代理），必须完整；报告路径长度、绕路系数、跑完的秒数</summary>
    public sealed class RouteCheck : ILevelCheck
    {
        public string Id => "route";
        public string Title => "主线连通（NavMesh，人形代理）";
        public int Order => 10;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var route = ctx.spec.route;
            if (route.Count < 2)
            {
                rep.Warn("没有声明主线路点（LevelSpec.route 至少两个）");
                return;
            }
            LevelKit.CheckPath(rep, route.Select(w => (w.name, w.pos)).ToArray());
        }
    }
}
