using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 点穴（Three.js 版 defsReaction.ts rx_acupoint）：武器直接命中弱点（爆头 / 被改判为弱点）且敌人身上带元素状态、这一击没打死时，
    /// 引爆其状态（<see cref="ReactionSystem.Detonate"/>：三相归墟、两相按优先级、单相崩解），强度 = 这一击的伤害（上限最大生命 × 0.5）× 每层 40%。
    /// 冷却 1.2 秒；被引爆冷却 / 预算拒绝时不计本卷冷却。与同一击的满蓄 / 破势引爆由反应系统合并（取较高强度）。
    /// </summary>
    [Defs(510)]
    public sealed class RxAcupoint : ScrollDef
    {
        public const float Cooldown = 1.2f;

        public RxAcupoint()
        {
            id = "rx_acupoint";
            name = "点穴";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "反应", "引爆", "爆头" };
            description = "武器爆头命中带有元素状态的敌人时引爆其状态，引爆强度每层 40%（冷却 1.2 秒）。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float readyAt = float.NegativeInfinity;
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var d = e.enemy;
                if (!TacticsKit.IsWeak(e.info) || !ReactionScrollKit.IsWeaponReq(e.info) || e.info.depth != 0 || e.result.killed || !d || d.Dead) return;
                float now = s.Now;
                var h = TacticsKit.Host;
                if (now < readyAt || ReactionScrollKit.StatusCount(h, d) == 0) return;
                var opts = new DetonateOpts
                {
                    power = Mathf.Min(e.result.total, d.maxHealth * 0.5f), mult = 0.4f * n, depth = 0, weaponUid = e.info.weaponUid, point = e.info.point,
                };
                if (h.Detonate(d, opts) == null) return;
                readyAt = now + Cooldown;
                s.Proc();
            });
        }
    }
}
