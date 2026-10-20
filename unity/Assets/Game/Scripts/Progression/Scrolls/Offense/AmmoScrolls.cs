using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 流星：弹速每层 +20%；武器直接命中存活敌人（造成了伤害、没打死、可选中）时，从天上落下一道星芒，
    /// 造成每层 12 点物理伤害 × 强度成长（<see cref="ScrollKit.ProcScale()"/>），内置冷却 0.8 秒。
    /// 星芒是秘卷伤害（不吃武器 / 爆炸加成）、深度 1、不暴击、不附着元素；即时命中武器与近战也能触发。
    /// </summary>
    public sealed class MeteorShotScroll : ScrollDef
    {
        public const float SpeedPerStack = 0.2f, DamagePerStack = 12f, Cooldown = 0.8f;
        static readonly Color StarColor = Hex.Rgb(0xd8eaff);

        public MeteorShotScroll()
        {
            id = "meteor_shot";
            name = "流星";
            rarity = 0;
            maxStacks = 3;
            tags = new[] { "弹速", "命中", "伤害" };
            description = "弹速每层 +20%；武器直接命中存活敌人时追加星芒，造成每层 12 点物理伤害（随关卡强度成长），冷却 0.8 秒。星芒不暴击、不附着元素；即时命中武器与近战也可触发。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.ProjectileSpeedPct, SpeedPerStack * n);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var enemy = e.enemy;
                if (!s.Alive || !OffenseKit.IsDirectHit(in e.info) || e.result.total <= 0 || e.result.killed ||
                    !enemy || enemy.Dead || enemy.untargetable || !s.Ready("star", Cooldown)) return;
                var point = ScrollKit.BodyCenter(enemy);
                OffenseKit.Tracer(point + Vector3.up * 2.5f, point, StarColor, 0.025f);
                OffenseKit.Burst(point, StarColor, 6, 2, 0.2f, 0.04f);
                Combat.DamageEnemy(enemy, ScrollKit.ProcInfo(id, DamageSource.Scroll, DamagePerStack * n * ScrollKit.ProcScale(), Element.None, 1, point, Vector3.down));
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 背水弹匣：当前武器的弹匣余量 ≤ 容量 × 30% 时，武器伤害（来源武器 / 近战）每层 +15%。
    /// 容量含弹匣加成（<see cref="WeaponStatsResolver"/>）；没拿武器时不生效。
    /// </summary>
    public sealed class LastRoundsScroll : ScrollDef
    {
        public const float Threshold = 0.3f, DamagePerStack = 0.15f;

        public LastRoundsScroll()
        {
            id = "last_rounds";
            name = "背水弹匣";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "弹匣", "伤害" };
            description = "弹匣余量低于 30% 时，武器伤害每层 +15%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float bonus = 1 + DamagePerStack * n;
            var wc = s.Weapons;
            var sheet = s.stats ?? (s.player ? s.player.stats : null);
            s.AddOutgoing((in HitContext c) =>
            {
                if (!OffenseKit.IsWeaponSource(c.info.source) || !OffenseKit.ActiveMag(wc, sheet, out int mag, out int cap)) return 1f;
                return cap > 0 && mag <= cap * Threshold ? bonus : 1f;
            });
        }
    }

    /// <summary>装填激励：换弹完成后 4 秒内射速每层 +12%（限时增益，再换弹刷新时长，不叠数值）</summary>
    public sealed class ReloadRushScroll : ScrollDef
    {
        public const float Duration = 4f, FireRatePerStack = 0.12f;

        public ReloadRushScroll()
        {
            id = "reload_rush";
            name = "装填激励";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "换弹", "触发" };
            description = "换弹完成后 4 秒内，射速每层 +12%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.Buff((Stat.FireRatePct, FireRatePerStack * n));
            s.OnReloaded(_ =>
            {
                buff.Trigger(Duration);
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 换弹冲击：开始换弹时以玩家胸口（脚下 + 0.9 m）为中心释放 5 米冲击波（半径固定，不吃爆炸范围），
    /// 造成每层 35 点 × 强度成长的秘卷伤害（经爆炸结算：吃爆炸伤害加成、按距离衰减到 50%）并击退 9，内置冷却 2 秒。
    /// </summary>
    public sealed class ReloadNovaScroll : ScrollDef
    {
        public const float Radius = 5f, DamagePerStack = 35f, Knockback = 9f, Cooldown = 2f;
        static readonly Color NovaColor = Hex.Rgb(0xbfe6ff);

        public ReloadNovaScroll()
        {
            id = "reload_nova";
            name = "换弹冲击";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "换弹", "触发" };
            description = "开始换弹时向 5 米内释放冲击波，造成每层 35 点伤害（随关卡强度成长）并击退，冷却 2 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnReloadStarted(_ =>
            {
                var p = s.player;
                if (!p || !s.Alive || !s.Ready("nova", Cooldown)) return;
                var feet = p.transform.position;
                var c = feet + Vector3.up * 0.9f;
                var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, DamagePerStack * n * ScrollKit.ProcScale(), Element.None, 1, c, Vector3.up);
                info.knockback = Knockback;
                Combat.Explode(new ExplosionOptions(c, Radius, info) { noFx = true, color = NovaColor });
                OffenseKit.Ring(feet + Vector3.up * 0.1f, Radius, NovaColor, 0.35f);
                OffenseKit.Sound("skill_earth", 0.5f);
                s.Proc();
            });
        }
    }
}
