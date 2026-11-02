using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 主线节奏（S5，docs/level-design/ch3-v2.md 2.4 / 2.9）：按 <see cref="LevelSpec.beats"/> 的顺序，从出生点起用人形 NavMesh 依次量相邻两拍的路程，
    /// 减去两拍的范围半径（场地触发圈、补给营安全区）就是中间的「空白段」——超过 <see cref="LevelSpec.maxBeatGap"/>（默认 110 m ≈ 15 s）不合格；
    /// 出生 → 第一个交战拍（必清 / 路遇 / 首领）的圈边超过 <see cref="LevelSpec.maxFirstFight"/>（默认 60 m）不合格。
    /// 没声明节拍的图跳过（旧图不受影响）。路程不含战斗，按 7.5 m/s 折成秒。
    /// </summary>
    public sealed class PacingCheck : ILevelCheck
    {
        public string Id => "pacing";
        public string Title => "主线节奏（节拍间隔，S5）";
        public int Order => 15;

        public const float WalkSpeed = 7.5f;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var spec = ctx.spec;
            if (spec.beats == null || spec.beats.Count == 0)
            {
                rep.Line("没有声明节拍（LevelSpec.beats），跳过");
                return;
            }
            var spawn = ctx.SpawnNav;
            if (spawn == null)
            {
                rep.Fail($"玩家出生点 {LevelContext.At(spec.playerSpawn)} 附近 4 m 没有 NavMesh，量不了节拍");
                return;
            }
            var prev = spawn.Value;
            float prevRadius = 0, travelled = 0, longest = 0, firstFight = -1;
            string prevName = "出生", longestAt = "";
            int over = 0;
            foreach (var b in spec.beats)
            {
                if (!LevelContext.NavPoint(b.pos, 4f, out var at))
                {
                    rep.Fail($"节拍「{b.name}」{LevelContext.At(b.pos)} 附近 4 m 没有 NavMesh");
                    continue;
                }
                var status = LevelContext.NavPath(prev, at, out float len);
                if (status != NavMeshPathStatus.PathComplete)
                {
                    rep.Fail($"{prevName} → {b.name}：NavMesh 不连通（{status}）");
                    prev = at;
                    prevRadius = b.radius;
                    prevName = b.name;
                    continue;
                }
                travelled += len;
                float gap = Mathf.Max(0, len - prevRadius - b.radius);
                string line = $"{prevName} → {b.name}（{Kind(b.kind)}）：路程 {len:F0} m，空白 {gap:F0} m ≈ {gap / WalkSpeed:F0} s，累计 {travelled:F0} m";
                if (gap > spec.maxBeatGap)
                {
                    over++;
                    rep.Fail($"{line} —— 超过 {spec.maxBeatGap:F0} m（中间要放一个事件：路遇、藏宝岔口、揭示或补给）");
                }
                else rep.Line($"✓ {line}");
                if (gap > longest)
                {
                    longest = gap;
                    longestAt = $"{prevName} → {b.name}";
                }
                if (firstFight < 0 && b.Combat) firstFight = Mathf.Max(0, travelled - b.radius);
                prev = at;
                prevRadius = b.radius;
                prevName = b.name;
            }
            if (firstFight < 0) rep.Warn("节拍里没有交战（Fight / Roadside / Boss），出生 → 首战没量");
            else if (firstFight > spec.maxFirstFight) rep.Fail($"出生 → 第一次交战 {firstFight:F0} m，超过 {spec.maxFirstFight:F0} m");
            else rep.Line($"✓ 出生 → 第一次交战 {firstFight:F0} m（≤ {spec.maxFirstFight:F0}）");
            rep.Line($"节拍 {spec.beats.Count} 个，主线 {travelled:F0} m ≈ {travelled / WalkSpeed:F0} s（不含战斗），最长空白段 {longest:F0} m（{longestAt}）" +
                     (over > 0 ? $"，{over} 段超长" : ""));
        }

        static string Kind(BeatKind k) => k switch
        {
            BeatKind.Fight => "必清",
            BeatKind.Roadside => "路遇",
            BeatKind.Cache => "藏宝",
            BeatKind.Supply => "补给",
            BeatKind.Reveal => "揭示",
            BeatKind.Boss => "首领",
            BeatKind.Exit => "出口",
            _ => k.ToString(),
        };
    }
}
