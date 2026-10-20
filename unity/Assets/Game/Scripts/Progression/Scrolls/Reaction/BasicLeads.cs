using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 引雷 / 引火 / 引蚀（Three.js 版 defsReaction.ts 的 leadScroll）：武器直接命中带 need 状态、且这一击没有自己附上 give 的敌人时，
    /// 每层 8% 概率附加 give（引发对应反应）。逐敌 0.4 s 冷却放在概率之前：霰弹的多枚弹丸、高射速武器都按「每 0.4 秒一次判定」归一。
    /// 附着沿用这一击的深度 0（与三才印、副元素词条一致）：引发的是直接反应，流派终卷照常生效。致死一击不触发。
    /// </summary>
    public sealed class RxLead : ScrollDef
    {
        public Element need, give;
        public Reaction reaction;

        public override void Install(ScrollScope s, int n)
        {
            float chance = 0.08f * n;
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var d = e.enemy;
                if (!ReactionScrollKit.IsWeaponReq(e.info) || e.info.depth != 0 || e.result.killed || !d || d.Dead) return;
                var h = TacticsKit.Host;
                if (!(e.result.total > 0) || !h.HasStatus(d, need) || e.result.statusApplied == give) return;
                if (!s.ReadyFor(d, "lead", 0.4f) || !h.Chance(chance)) return;
                h.ApplyStatus(d, give, ReactionScrollKit.StatusPower(d, give, e.result.total),
                    new StatusApplyOpts { depth = 0, weaponUid = e.info.weaponUid });
                s.Proc();
            });
        }

        public static RxLead Make(string id, string name, Element need, Element give, Reaction rx)
        {
            string needName = ReactionScrollKit.StatusName(need), giveName = ReactionScrollKit.StatusName(give), rxName = ReactionScrollKit.Name(rx);
            return new RxLead
            {
                id = id, name = name, rarity = 1, maxStacks = 3, need = need, give = give, reaction = rx,
                tags = new[] { "元素", "反应", rxName, giveName, "命中" },
                description = $"武器命中{needName}中的敌人时，每层 8% 概率附加{giveName}（引发「{rxName}」）。",
            };
        }
    }

    /// <summary>引雷（灼烧 → 雷殛，焚雷）、引火（蚀化 → 灼烧，熔金）、引蚀（雷殛 → 蚀化，封脉）</summary>
    [Defs(505)]
    public sealed class BasicLeads : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            RxLead.Make("rx_lead_shock", "引雷", Element.Fire, Element.Shock, Reaction.Thunderfire),
            RxLead.Make("rx_lead_fire", "引火", Element.Corrode, Element.Fire, Reaction.Meltdown),
            RxLead.Make("rx_lead_corrode", "引蚀", Element.Shock, Element.Corrode, Reaction.Veinseal),
        };
    }
}
