#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷熔心魔将：场景里有 3-3 的领主战（FoundryLordGate + BossEncounter）就跳过「先肃清铸坊」直接开战；
    /// 否则在魔将的场地（没有就玩家前方 22 m 临时建一个 20 m 的圆形场地）刷一只（熔铜渠涨落退回环带写法）。
    /// 没有热键：DevCommands.Run("boss_warlord")
    /// </summary>
    [Defs]
    public sealed class SpawnWarlordCommand : DevCommand
    {
        public override string Id => "boss_warlord";
        public override string Label => "刷熔心魔将";

        public override void Execute()
        {
            foreach (var gate in Object.FindObjectsByType<FoundryLordGate>(FindObjectsSortMode.None))
            {
                var enc = gate ? gate.encounter : null;
                if (!enc || enc.bossId != WarlordDef.Id || enc.State != BossEncounter.Phase.Waiting) continue;
                gate.Unlock(false);
                enc.Begin();
                DevCommands.Say("熔心魔将即将现身（领主战流程）");
                return;
            }
            var pv = PlayerVitals.Instance;
            var arena = BossArena.Find(WarlordDef.Id, pv ? pv.transform.position : (Vector3?)null);
            if (!arena && pv)
            {
                var fwd = pv.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                arena = BossArena.CreateRuntime(pv.transform.position + fwd * 22f, 20f, fwd, WarlordDef.Id);
            }
            var b = Bosses.Spawn(WarlordDef.Id, arena);
            DevCommands.Say(b ? $"刷出 {b.Title}" : "刷熔心魔将失败");
        }
    }
}
#endif
