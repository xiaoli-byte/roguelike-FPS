using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 功能·生存类秘卷（Three.js 版 defsUtility.ts「生存」段，数值同原版；铁骨 / 灵盾 / 回春 / 收割 / 摄魂 / 石肤在 <see cref="UtilityStatScrolls"/>）：
    ///   噬血 吸血 · 生生不息 生命恢复（纯属性：吸血由 Combat 按武器直接伤害结算，生命恢复由 PlayerVitals 逐帧回）；
    ///   背水一战 低血减伤 · 碎盾反击 破盾冲击波 · 以牙还牙 受伤反击 · 化痛为力 受伤后增伤 · 绝处逢生 每关一次免死 · 凤羽 击杀精英回盾减伤。
    /// 受伤修饰器挂在 <see cref="PlayerVitals.Incoming"/>：固定倍率用 Multiplier，免死这种要看最终伤害的用 FinalAmount（同 TS 按参数个数排序）。
    /// 固定数值的伤害（碎盾反击、以牙还牙）随关卡强度成长（<see cref="ScrollKit.ProcScale()"/>），来源是秘卷（不吃武器 / 技能加成）。
    /// </summary>
    [Defs(311)]
    public sealed class SurvivalStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "blood_drinker", name = "噬血", tags = new[] { "生存", "吸血" }, rarity = Rarity.Rare, maxStacks = 3,
                description = "吸血每层 +1.5%。", stats = new[] { (Stat.Lifesteal, 0.015f) },
            },
            new StatScroll
            {
                id = "regen", name = "生生不息", tags = new[] { "生存" }, rarity = Rarity.Uncommon, maxStacks = 3,
                description = "每秒每层回复 1.5 生命。", stats = new[] { (Stat.HpRegen, 1.5f) },
            },
        };
    }

    /// <summary>背水一战：生命低于 35% 时，受到的伤害每层 −15%</summary>
    [Defs(312)]
    public sealed class LastStandScroll : ScrollDef
    {
        public const float Threshold = 0.35f, ReductionPerStack = 0.15f;

        public LastStandScroll()
        {
            id = "last_stand";
            name = "背水一战";
            rarity = Rarity.Rare;
            maxStacks = 2;
            tags = new[] { "生存" };
            description = "生命低于 35% 时，受到的伤害每层 −15%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float mult = 1 - ReductionPerStack * n;
            s.AddIncoming((in IncomingHit h) => s.player && ScrollKit.PlayerHpFrac(s.player) < Threshold ? mult : 1f);
        }
    }

    /// <summary>
    /// 碎盾反击：护盾被击破时以玩家为中心（离地 0.9 m）放 6 米冲击波，每层 70 点伤害（随关卡强度成长，边缘衰减到 50%）并击退 14，冷却 5 秒
    /// </summary>
    [Defs(313)]
    public sealed class ShieldNovaScroll : ScrollDef
    {
        public const float Radius = 6f, DamagePerStack = 70f, Knockback = 14f, Cooldown = 5f;
        static readonly Color Tint = Hex.Rgb(0x7fd8ff);

        public ShieldNovaScroll()
        {
            id = "shield_nova";
            name = "碎盾反击";
            rarity = Rarity.Rare;
            maxStacks = 3;
            tags = new[] { "护盾", "触发" };
            description = "护盾被击破时向 6 米内释放冲击波，造成每层 70 点伤害（随关卡强度成长）并击退，冷却 5 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnPlayerShieldBroken(() =>
            {
                var p = s.player;
                if (!p || p.Dead || !s.Ready("nova", Cooldown)) return;
                // 爆心单独算（结算期间嵌套的击杀事件可能挪动玩家：击退、悬赏令掉落…）
                var feet = p.transform.position;
                var center = feet + Vector3.up * 0.9f;
                var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, DamagePerStack * n * ScrollKit.ProcScale(), Element.None, 1, center, Vector3.up);
                info.knockback = Knockback;
                Combat.Explode(new ExplosionOptions(center, Radius, info) { noFx = true, color = Tint });
                s.Proc();
                ScrollKit.Show.Ring(feet + Vector3.up * 0.1f, Radius, Tint, 0.45f);
                ScrollKit.Show.Shake(0.25f, 0.2f);
                ScrollKit.Show.Sound("skill_earth", 0.7f);
            });
        }
    }

    /// <summary>以牙还牙：受到敌人伤害时，对出手者造成每层 25 点伤害（随关卡强度成长），每 0.4 秒最多一次。不可选中的首领不反击、也不画光束</summary>
    [Defs(314)]
    public sealed class ThornsScroll : ScrollDef
    {
        public const float DamagePerStack = 25f, Interval = 0.4f;
        static readonly Color Tint = Hex.Rgb(0xff5a4f);

        public ThornsScroll()
        {
            id = "thorns";
            name = "以牙还牙";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "生存", "受伤" };
            description = "受到敌人伤害时，对其造成每层 25 点伤害（随关卡强度成长），每 0.4 秒最多一次。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnPlayerHit((in PlayerHitEvent e) =>
            {
                var enemy = ScrollKit.DamageableOf(e.source);
                if (!ScrollKit.IsHittable(enemy) || !s.Ready("thorns", Interval)) return;
                var to = ScrollKit.BodyCenter(enemy);
                var from = s.player ? s.player.transform.position + Vector3.up * 1.1f : to;
                var dir = to - from;
                ScrollKit.Show.Beam(from, to, Tint, 0.05f, 0.12f);
                Combat.DamageEnemy(enemy, ScrollKit.ProcInfo(id, DamageSource.Scroll, DamagePerStack * n * ScrollKit.ProcScale(), Element.None, 1, to,
                    dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.forward));
                s.Proc();
            });
        }
    }

    /// <summary>化痛为力：受到伤害后 5 秒内，武器伤害每层 +10%（再受伤刷新时长）</summary>
    [Defs(315)]
    public sealed class PainToPowerScroll : ScrollDef
    {
        public const float Duration = 5f, DamagePerStack = 0.1f;

        public PainToPowerScroll()
        {
            id = "pain_to_power";
            name = "化痛为力";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "伤害", "受伤" };
            description = "受到伤害后 5 秒内，武器伤害每层 +10%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.Buff((Stat.DamagePct, DamagePerStack * n));
            s.OnPlayerHit((in PlayerHitEvent e) =>
            {
                if (e.amount > 0) ScrollKit.ProcBuff(s, buff, Duration);
            });
        }
    }

    /// <summary>
    /// 绝处逢生：每关一次，受到致命伤害时免除这一下，回复 35% 生命并无敌 2 秒。
    /// 主路径：受伤修饰器（FinalAmount，排在减伤与固定倍率之后）看到的就是最终伤害，致命就返回 0；
    /// 兜底：之后的修饰器又把这一下放大到致命（或有人绕过修饰器直接扣血）——PlayerVitals 先发 PlayerHit 再判定死亡，这时把这一下扣掉的护盾和生命还回去。
    /// 「本关已用」跨叠层 / 换玩家保留，进新关清掉。
    /// </summary>
    [Defs(316)]
    public sealed class SecondWindScroll : ScrollDef
    {
        public const float HealFrac = 0.35f, Invulnerable = 2f;
        static readonly Color Gold = Hex.Rgb(0xffd54a), Spark = Hex.Rgb(0xffe28a);

        public SecondWindScroll()
        {
            id = "second_wind";
            name = "绝处逢生";
            rarity = Rarity.Epic;
            maxStacks = 1;
            tags = new[] { "生存" };
            description = "每关一次：受到致命伤害时免除该次伤害，回复 35% 生命并获得 2 秒无敌。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var used = s.Keep("used", false);
            s.OnStageLoaded(_ => used.value = false);
            s.AddIncoming((in IncomingHit h) =>
            {
                var p = s.player;
                if (!p || used.value || p.Dead || p.Invulnerable) return 1f;
                if (!(h.amount >= p.health + p.shield - 1e-3f)) return 1f;
                Trigger(s, p, used);
                return 0f;
            }, ModifierPriority.FinalAmount);
            s.OnPlayerHit((in PlayerHitEvent e) =>
            {
                var p = s.player;
                if (!p || used.value || p.Dead || p.health > 1e-3f) return;
                p.shield += Mathf.Max(0, e.toShield);
                p.health += Mathf.Max(0, e.toHp);
                Trigger(s, p, used);
            });
        }

        static void Trigger(ScrollScope s, PlayerVitals p, Box<bool> used)
        {
            used.value = true;
            p.Heal(p.MaxHealth * HealFrac);
            ScrollKit.GrantPlayerInvulnerability(p, Invulnerable);
            s.Proc();
            ScrollKit.Show.Toast("绝处逢生！", Gold);
            ScrollKit.Show.Sound("skill_buff");
            ScrollKit.Show.Burst(p.transform.position + Vector3.up, Spark, 30, 6, 0.7f, 0.14f, 0.6f); // TS gravity −3：金星往上飘
        }
    }

    /// <summary>凤羽：击杀精英或首领时立即回满护盾，并在 6 秒内伤害减免每层 +10%</summary>
    [Defs(317)]
    public sealed class PhoenixFeatherScroll : ScrollDef
    {
        public const float Duration = 6f, ReductionPerStack = 0.1f;

        public PhoenixFeatherScroll()
        {
            id = "phoenix_feather";
            name = "凤羽";
            rarity = Rarity.Epic;
            maxStacks = 2;
            tags = new[] { "护盾", "击杀" };
            description = "击杀精英或首领时立即回满护盾，并在 6 秒内伤害减免每层 +10%。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.Buff((Stat.DamageReduction, ReductionPerStack * n));
            s.OnKill((in KillEvent e) =>
            {
                if (!e.enemy || e.enemy.rank == Rank.Normal) return;
                if (s.player) s.player.AddShield(s.player.MaxShield);
                buff.Trigger(Duration);
                s.Proc();
                ScrollKit.Show.Sound("shield_recharge");
            });
        }
    }
}
