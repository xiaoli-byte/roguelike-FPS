namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 主线不靠二段跳（docs/level-design/unity-maps-v1.md 尺度表：二段跳只有鼯与「额外跳跃」秘卷，高台一律给坡道 / 台阶）：
    /// 在玩家可达性洪泛里看每个主线路点要用到的最强能力——步行、单跳、冲刺（断桥 / 缺口 3–4 m 可以要求冲刺）都算过，只有二段跳才上得去的不合格。
    /// NavMesh 代理的台阶、坡度和玩家不同，所以这里不用 NavMesh，用按 PlayerMotor 数值模拟的起跳包络 + 胶囊扫掠。
    /// </summary>
    public sealed class NoDoubleJumpCheck : ILevelCheck
    {
        public string Id => "no-double-jump";
        public string Title => "主线不靠二段跳（玩家可达性）";
        public int Order => 80;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var route = ctx.spec.route;
            if (route.Count == 0)
            {
                rep.Line("没有声明主线路点，跳过");
                return;
            }
            if (ctx.StartSpan < 0)
            {
                rep.Fail($"出生点 {LevelContext.At(ctx.spec.playerSpawn)} 附近没有可站立面，可达性洪泛起不了步");
                return;
            }
            var env = ctx.Envelope;
            rep.Line($"起跳包络（同高最远）：单跳 {env.LevelReach(Move.Jump):F1} m · 冲刺 {env.LevelReach(Move.Dash):F1} m · 二段跳 {env.LevelReach(Move.DoubleJump):F1} m；" +
                     $"最高：单跳 {env.Height(Move.Jump, 0):F2} m · 二段跳 {env.Height(Move.DoubleJump, 0):F2} m");
            var f = ctx.Reach;
            int ok = 0;
            foreach (var w in route)
            {
                // 4 m 内（同 NavMesh 路点吸附半径）、同一高度（±1 m）的面里取最弱的档位；
                // 那个高度根本没有可站立面（路点落在祭坛、塔身这种站不上去的摆件底下）时才放宽到 ±3 m
                var tier = ctx.TierAt(f, w.pos, 4f, 1f);
                if (tier == Move.None && !ctx.AnySpan(w.pos, 4f, 1f)) tier = ctx.TierAt(f, w.pos, 4f, 3f);
                switch (tier)
                {
                    case Move.None:
                        rep.Fail($"{w.name} {LevelContext.At(w.pos)}：玩家到不了（可站立面栅格里没有路）");
                        break;
                    case Move.DoubleJump:
                        rep.Fail($"{w.name} {LevelContext.At(w.pos)}：只有二段跳上得去（主线要给坡道 / 台阶）");
                        break;
                    default:
                        ok++;
                        rep.Line($"✓ {w.name}：{ReachFlood.Label(tier)}可达");
                        break;
                }
            }
            if (ok == route.Count) rep.Line($"✓ {route.Count} 个主线路点都不靠二段跳");
        }
    }
}
