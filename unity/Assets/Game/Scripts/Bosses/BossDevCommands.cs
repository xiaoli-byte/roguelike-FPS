#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>刷代理首领（试炼傀儡）：场景里有首领场地就刷在场地出生点，没有就在玩家前方 18 m 临时建一个 16 m 的场地。没有热键：DevCommands.Run("boss_proxy")</summary>
    [Defs]
    public sealed class SpawnProxyBossCommand : DevCommand
    {
        public override string Id => "boss_proxy";
        public override string Label => "刷代理首领";

        public override void Execute()
        {
            var pv = PlayerVitals.Instance;
            var arena = BossArena.Find(ProxyBossDef.Id, pv ? pv.transform.position : (Vector3?)null);
            if (!arena && pv)
            {
                var fwd = pv.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                arena = BossArena.CreateRuntime(pv.transform.position + fwd * 18f, 16f, fwd);
            }
            var b = Bosses.Spawn(ProxyBossDef.Id, arena);
            DevCommands.Say(b ? $"刷出 {b.Title}" : "刷代理首领失败");
        }
    }

    /// <summary>当前首领直接掉到下一道阶段阈值以下（只动生命层）。没有热键：DevCommands.Run("boss_phase")</summary>
    [Defs]
    public sealed class BossNextPhaseCommand : DevCommand
    {
        public override string Id => "boss_phase";
        public override string Label => "首领进下一阶段";

        public override void Execute()
        {
            var b = BossBrain.Primary;
            if (!b || b.Def == null || b.Phase >= b.Def.phases.Count)
            {
                DevCommands.Say("没有可推进的首领阶段");
                return;
            }
            var hp = b.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * (b.Def.phases[b.Phase].at - 0.01f), 1f, hp.maxHealth);
            DevCommands.Say($"{b.Title}：生命 → {hp.health:F0}");
        }
    }

    /// <summary>处决当前首领（走伤害管线：有战果、有掉落）。没有热键：DevCommands.Run("boss_kill")</summary>
    [Defs]
    public sealed class KillBossCommand : DevCommand
    {
        public override string Id => "boss_kill";
        public override string Label => "处决首领";

        public override void Execute()
        {
            var b = BossBrain.Primary;
            if (!b)
            {
                DevCommands.Say("场上没有首领");
                return;
            }
            Combat.Execute(b.Health, false);
        }
    }
}
#endif
