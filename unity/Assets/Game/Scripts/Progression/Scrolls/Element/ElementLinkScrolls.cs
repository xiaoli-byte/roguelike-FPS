using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 野火燎原：灼烧中的敌人（<see cref="ElementKit.Track"/>：身上有 / 死时有 / 4 秒内被点燃过）死亡时，火焰蔓延到 5 米内所有敌人，
    /// 附着强度 = 死者最大生命 × 每层 10% 的灼烧（单个目标不超过它自己最大生命的一半）。
    /// 蔓延的灼烧是击杀那一击的衍生：深度 = min(2, 击杀深度 + 1)——直接击杀 → 1（还能引发一级反应），反应 / 持续伤害的击杀 → 2（不再反应），
    /// 免得反应击杀以深度 0 重新起链、绕过连锁深度上限。
    /// </summary>
    public sealed class WildfireScroll : ScrollDef
    {
        public const float Radius = 5f, HpRatioPerStack = 0.1f;

        public WildfireScroll()
        {
            id = "wildfire";
            name = "野火燎原";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "灼烧", "击杀" };
            description = "灼烧中的敌人死亡时，火焰蔓延至 5 米内所有敌人，附着强度为其最大生命每层 10% 的灼烧。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var burning = ElementKit.Track(s, StatusId.Burn);
            var color = DamageTable.ElementColor(Element.Fire);
            s.OnKill((in KillEvent e) =>
            {
                var enemy = e.enemy;
                if (!enemy || !burning(enemy)) return;
                int depth = Mathf.Min(2, e.info.depth + 1);
                var c = ScrollKit.BodyCenter(enemy);
                float power = enemy.maxHealth * HpRatioPerStack * n;
                int spread = ElementKit.ForEachNear(c, Radius, enemy, d => ElementKit.ApplyStatus(d, Element.Fire, Mathf.Min(power, d.maxHealth * 0.5f), depth));
                if (spread <= 0) return;
                OffenseKit.Ring(new Vector3(c.x, enemy.transform.position.y + 0.1f, c.z), Radius, color, 0.4f);
                OffenseKit.Burst(c, color, 16, 5, 0.5f, 0.12f, 0.6f);
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 静电弧：武器直接命中（造成了伤害）雷殛状态的敌人（身上有 / 3 秒内被雷殛过）时，每层 12% 概率向 8 米内最近的另一个敌人弹射闪电，
    /// 造成这一击实际伤害 60% 的雷电秘卷伤害（深度 1、不暴击、只按玩家元素触发率附着）；内置冷却 0.08 秒。
    /// </summary>
    public sealed class StaticArcScroll : ScrollDef
    {
        public const float Range = 8f, ChancePerStack = 0.12f, Ratio = 0.6f, Cooldown = 0.08f;

        public StaticArcScroll()
        {
            id = "static_arc";
            name = "静电弧";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "雷殛", "命中" };
            description = "武器命中雷殛状态的敌人时，每层 12% 概率向 8 米内另一个敌人弹射闪电，造成该次伤害 60% 的雷电伤害。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var shocked = ElementKit.Track(s, StatusId.Shock);
            var color = DamageTable.ElementColor(Element.Shock);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var enemy = e.enemy;
                if (!OffenseKit.IsDirectHit(in e.info) || e.result.total <= 0 || !enemy || !shocked(enemy)) return;
                if (!OffenseKit.Chance(ChancePerStack * n) || !s.Ready("arc", Cooldown)) return;
                var from = ScrollKit.BodyCenter(enemy);
                var target = ElementKit.NearestOther(from, Range, enemy);
                if (!target) return;
                var to = ScrollKit.BodyCenter(target);
                OffenseKit.Lightning(from, to, color);
                OffenseKit.SoundAt("shock_zap", to, 0.6f);
                var dir = to - from;
                Combat.DamageEnemy(target, ScrollKit.ProcInfo(id, DamageSource.Scroll, e.result.total * Ratio, Element.Shock, 1, to,
                    dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.forward));
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 蚀爆：蚀化中的敌人（身上有 / 死时有 / 5 秒内被蚀化过）死亡时爆炸，对 3.5 米内（× 爆炸范围）造成其最大生命每层 12% 的蚀化秘卷伤害并必定附着蚀化。
    /// 击杀深度 ≥ 2 不再引爆；爆炸深度 = 击杀深度 + 1。
    /// </summary>
    public sealed class AcidBurstScroll : ScrollDef
    {
        public const float BaseRadius = 3.5f, HpRatioPerStack = 0.12f;

        public AcidBurstScroll()
        {
            id = "acid_burst";
            name = "蚀爆";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "蚀化", "击杀" };
            description = "蚀化中的敌人死亡时爆炸，对 3.5 米内造成其最大生命每层 12% 的蚀化伤害并附着蚀化。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var corroded = ElementKit.Track(s, StatusId.Corrode);
            var color = DamageTable.ElementColor(Element.Corrode);
            s.OnKill((in KillEvent e) =>
            {
                var enemy = e.enemy;
                int depth = e.info.depth;
                if (!enemy || depth >= 2 || !corroded(enemy)) return;
                // 爆心是值类型：爆炸结算期间嵌套的击杀事件改不到它
                var c = ScrollKit.BodyCenter(enemy);
                var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, enemy.maxHealth * HpRatioPerStack * n, Element.Corrode, depth + 1, c, Vector3.up);
                info.statusChance = 1;
                Combat.Explode(new ExplosionOptions(c, ScrollKit.BlastRadius(BaseRadius), info) { color = color });
                s.Proc();
            });
        }
    }
}
