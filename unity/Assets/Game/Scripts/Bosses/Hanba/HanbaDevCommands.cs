#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷旱魃：场景里有 1-4 的首领关流程（BossEncounter）就直接开战，否则在旱魃的场地（没有就玩家前方 20 m 临时建一个 18 m 的场地）刷一只。
    /// 没有热键：DevCommands.Run("boss_hanba")
    /// </summary>
    [Defs]
    public sealed class SpawnHanbaCommand : DevCommand
    {
        public override string Id => "boss_hanba";
        public override string Label => "刷旱魃";

        public override void Execute()
        {
            foreach (var enc in Object.FindObjectsByType<BossEncounter>(FindObjectsSortMode.None))
            {
                if (!enc || enc.bossId != HanbaDef.Id || enc.State != BossEncounter.Phase.Waiting) continue;
                enc.Begin();
                DevCommands.Say("旱魃即将现身（首领关流程）");
                return;
            }
            var pv = PlayerVitals.Instance;
            var arena = BossArena.Find(HanbaDef.Id, pv ? pv.transform.position : (Vector3?)null);
            if (!arena && pv)
            {
                var fwd = pv.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                arena = BossArena.CreateRuntime(pv.transform.position + fwd * 20f, 18f, fwd, HanbaDef.Id);
            }
            var b = Bosses.Spawn(HanbaDef.Id, arena);
            DevCommands.Say(b ? $"刷出 {b.Title}" : "刷旱魃失败");
        }
    }
}
#endif
