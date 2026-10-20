namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>地标视线：入口眼高向地标连线，中途不被地形 / 体块挡住（docs/level-design/unity-maps-v1.md 原则 3「每个场地入口都能看到下一个目标」）</summary>
    public sealed class SightCheck : ILevelCheck
    {
        public string Id => "sight";
        public string Title => "地标视线（眼高）";
        public int Order => 30;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            if (ctx.spec.sightLines.Count == 0)
            {
                rep.Warn("没有声明地标视线（每个场地入口都该看得到下一个目标）");
                return;
            }
            foreach (var s in ctx.spec.sightLines) LevelKit.CheckSight(rep, s.what, s.eye, s.target, s.tolerance, s.landmark);
        }
    }
}
