using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 连环爆：击杀敌人（首领、静默处决除外）时每层 10% 概率引爆尸体，对 3.5 米内（× 爆炸范围）造成其最大生命 30% 的爆炸伤害并击退 6。
    /// 连锁深度：击杀那一击深度 ≥ 2（反应 / 持续伤害的衍生击杀）不再引爆；引爆的爆炸深度 = 击杀深度 + 1，所以连环最多两级。
    /// </summary>
    public sealed class ChainBlastScroll : ScrollDef
    {
        public const float ChancePerStack = 0.1f, BaseRadius = 3.5f, HpRatio = 0.3f, Knockback = 6f;
        static readonly Color BlastColor = Hex.Rgb(0xffa040);

        public ChainBlastScroll()
        {
            id = "chain_blast";
            name = "连环爆";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "爆炸", "击杀" };
            description = "击杀敌人时每层 10% 概率引爆尸体，对 3.5 米内造成其最大生命 30% 的伤害。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnKill((in KillEvent e) =>
            {
                var enemy = e.enemy;
                int depth = e.info.depth;
                if (!enemy || depth >= 2 || enemy.IsBoss || !OffenseKit.Chance(ChancePerStack * n)) return;
                // 爆心是值类型，嵌套的击杀事件改不到它
                var c = ScrollKit.BodyCenter(enemy);
                var info = ScrollKit.ProcInfo(id, DamageSource.Explosion, enemy.maxHealth * HpRatio, Element.None, depth + 1, c, Vector3.up);
                info.knockback = Knockback;
                Combat.Explode(new ExplosionOptions(c, ScrollKit.BlastRadius(BaseRadius), info) { color = BlastColor });
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 爆裂弹：武器直接暴击（造成了伤害）时在命中点引发 2.2 米（× 爆炸范围）爆炸，造成该次实际伤害 × 每层 30% 的爆炸伤害，
    /// 元素同这一击（附着几率只有玩家的元素触发率），深度 1、不暴击；内置冷却 0.12 秒（霰弹一轮只炸一次）。
    /// </summary>
    public sealed class VolatileRoundsScroll : ScrollDef
    {
        public const float BaseRadius = 2.2f, RatioPerStack = 0.3f, Cooldown = 0.12f;
        static readonly Color BoomColor = Hex.Rgb(0xffb347);

        public VolatileRoundsScroll()
        {
            id = "volatile_rounds";
            name = "爆裂弹";
            rarity = 3;
            maxStacks = 2;
            tags = new[] { "爆炸", "暴击", "命中" };
            description = "武器暴击时在命中点引发 2.2 米爆炸，造成该次伤害每层 30% 的伤害。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!e.result.crit || e.result.total <= 0 || !OffenseKit.IsDirectHit(in e.info)) return;
                if (!s.Ready("boom", Cooldown)) return;
                var c = OffenseKit.HitPoint(in e);
                var info = ScrollKit.ProcInfo(id, DamageSource.Explosion, e.result.total * RatioPerStack * n, e.info.element, 1, c, Vector3.up);
                Combat.Explode(new ExplosionOptions(c, ScrollKit.BlastRadius(BaseRadius), info) { color = BoomColor });
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 天雷引：武器直接命中（造成了伤害）累计 15 次后，第 16 次命中召唤天雷，对目标周围 3 米（半径固定）造成每层 45 点 × 强度成长的雷电秘卷伤害，
    /// 必定附着雷殛（深度 1：可以引发反应，不再弹射）。同一帧的多次命中（霰弹弹丸、穿透）只计一次。计数随叠层重装清零（同 TS 闭包）。
    /// </summary>
    public sealed class ThunderJudgmentScroll : ScrollDef
    {
        public const int HitsNeeded = 15;
        public const float Radius = 3f, DamagePerStack = 45f;

        public ThunderJudgmentScroll()
        {
            id = "thunder_judgment";
            name = "天雷引";
            rarity = 3;
            maxStacks = 3;
            tags = new[] { "雷殛", "命中" };
            description = "武器累计命中 15 次后，下一次命中召唤天雷，对目标周围 3 米造成每层 45 点雷电伤害（随关卡强度成长），必定附着雷殛。霰弹的一轮弹丸只计一次命中。";
        }

        public override void Install(ScrollScope s, int n)
        {
            int hits = 0;
            var gate = new OffenseKit.FrameGate();
            var color = DamageTable.ElementColor(Element.Shock);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!OffenseKit.IsDirectHit(in e.info) || e.result.total <= 0 || !e.enemy) return;
                // 同一帧的多次命中（霰弹弹丸、穿透）只计一次，避免霰弹枪几发就攒满
                if (!gate.First()) return;
                if (++hits <= HitsNeeded) return;
                hits = 0;
                var c = ScrollKit.BodyCenter(e.enemy);
                var sky = new Vector3(c.x + (Random.value - 0.5f) * 2, c.y + 14, c.z + (Random.value - 0.5f) * 2);
                OffenseKit.Lightning(sky, c, color);
                var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, DamagePerStack * n * ScrollKit.ProcScale(), Element.Shock, 1, c, Vector3.down);
                info.statusChance = 1;
                Combat.Explode(new ExplosionOptions(c, Radius, info) { color = color });
                OffenseKit.SoundAt("shock_zap", c);
                OffenseKit.Shake(0.15f, 0.15f);
                s.Proc();
            });
        }
    }
}
