#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷鲲鹏：场景里有 2-4 的首领关流程（BossEncounter）就直接开战，否则在鲲鹏的场地（没有就玩家前方 30 m 临时建一个 30 m 的场地，冰窟按虚拟冰窟算）刷一只。
    /// 没有热键：DevCommands.Run("boss_kunpeng")
    /// </summary>
    [Defs]
    public sealed class SpawnKunPengCommand : DevCommand
    {
        public override string Id => "boss_kunpeng";
        public override string Label => "刷鲲鹏";

        public override void Execute()
        {
            foreach (var enc in Object.FindObjectsByType<BossEncounter>(FindObjectsSortMode.None))
            {
                if (!enc || enc.bossId != KunPengDef.Id || enc.State != BossEncounter.Phase.Waiting) continue;
                enc.Begin();
                DevCommands.Say("鲲即将自冰窟醒来（首领关流程）");
                return;
            }
            var pv = PlayerVitals.Instance;
            var arena = BossArena.Find(KunPengDef.Id, pv ? pv.transform.position : (Vector3?)null);
            if (!arena && pv)
            {
                var fwd = pv.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                arena = BossArena.CreateRuntime(pv.transform.position + fwd * 30f, 30f, fwd, KunPengDef.Id);
            }
            var b = Bosses.Spawn(KunPengDef.Id, arena);
            DevCommands.Say(b ? $"刷出 {b.Title}" : "刷鲲鹏失败");
        }
    }

    /// <summary>鲲鹏强制换形（调试）：鲲 → 鹏（把生命层压到 49%），已是鹏则什么都不做</summary>
    [Defs]
    public sealed class KunPengSwapCommand : DevCommand
    {
        public override string Id => "boss_kunpeng_swap";
        public override string Label => "鲲鹏 · 化鹏";

        public override void Execute()
        {
            foreach (var b in BossBrain.Active)
            {
                if (b is not KunPengBrain kp || kp.Dead || !kp.IsKun) continue;
                var hp = kp.Health;
                hp.health = Mathf.Min(hp.health, hp.maxHealth * (KunPengDef.SwapAt - 0.01f));
                DevCommands.Say("鲲的生命层压到 49%：即将化鹏");
                return;
            }
            DevCommands.Say("场上没有鲲");
        }
    }
}
#endif
