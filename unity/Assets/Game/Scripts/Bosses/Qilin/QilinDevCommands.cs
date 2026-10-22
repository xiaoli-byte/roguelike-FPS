#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷火麒麟：场景里有 3-4 的首领关流程（BossEncounter）就直接开战，否则在火麒麟的场地（没有就玩家前方 26 m 临时建一个 24 m 的场地，
    /// 炉心殿几何、吊鼎和锁扣由首领自己补）刷一只。没有热键：DevCommands.Run("boss_qilin")
    /// </summary>
    [Defs]
    public sealed class SpawnQilinCommand : DevCommand
    {
        public override string Id => "boss_qilin";
        public override string Label => "刷火麒麟";

        public override void Execute()
        {
            foreach (var enc in Object.FindObjectsByType<BossEncounter>(FindObjectsSortMode.None))
            {
                if (!enc || enc.bossId != QilinDef.Id || enc.State != BossEncounter.Phase.Waiting) continue;
                enc.Begin();
                DevCommands.Say("火麒麟即将现身（首领关流程）");
                return;
            }
            var pv = PlayerVitals.Instance;
            var arena = BossArena.Find(QilinDef.Id, pv ? pv.transform.position : (Vector3?)null);
            if (!arena && pv)
            {
                var fwd = pv.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                arena = BossArena.CreateRuntime(pv.transform.position + fwd * 26f, 24f, fwd, QilinDef.Id);
            }
            var b = Bosses.Spawn(QilinDef.Id, arena);
            DevCommands.Say(b ? $"刷出 {b.Title}" : "刷火麒麟失败");
        }
    }

    /// <summary>打碎一个锁扣：火麒麟正在饮熔时打它身后那个（鼎角砸中），否则打第一个还挂着的（砸空）。没有热键：DevCommands.Run("qilin_lock")</summary>
    [Defs]
    public sealed class QilinLockCommand : DevCommand
    {
        public override string Id => "qilin_lock";
        public override string Label => "打碎火麒麟锁扣";

        public override void Execute()
        {
            var q = BossBrain.Primary as QilinBrain;
            if (!q)
            {
                DevCommands.Say("场上没有火麒麟");
                return;
            }
            var target = q.Sipping ? q.LockAt(q.DrinkQuadrant) : null;
            if (!target || !target.Alive)
                foreach (var l in q.Locks)
                    if (l && l.Alive)
                    {
                        target = l;
                        break;
                    }
            if (!target)
            {
                DevCommands.Say("没有还挂着的锁扣（登场还没结束？）");
                return;
            }
            target.Shatter();
            DevCommands.Say($"打碎锁扣 {target.index}（{(q.Sipping && q.DrinkQuadrant == target.index ? "饮熔这一侧：鼎角砸它" : "砸空")}）");
        }
    }
}
#endif
