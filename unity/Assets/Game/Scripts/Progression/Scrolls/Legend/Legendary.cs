using UnityEngine;

namespace Spiritfire.Game
{
    // 传说秘卷（Three.js 版 src/progression/scrolls/defsLegend.ts，数值同原版）：高风险高回报，各一层。
    // 高风险的六卷带「高风险」标签和红色代价行（LegendScroll）；万剑归宗没有代价。局内货币叫灵石（D13）。

    /// <summary>玉碎：武器伤害 +55%；代价：受到的伤害 +35%（受伤修饰器，固定倍率）</summary>
    [Defs(401)]
    public sealed class GlassCannonScroll : LegendScroll
    {
        public const float DamageBonus = 0.55f, DamageTaken = 1.35f;

        public GlassCannonScroll()
        {
            id = "glass_cannon";
            name = "玉碎";
            tags = new[] { LegendTag, "伤害", RiskTag };
            Text("武器伤害 +55%。", "受到的伤害 +35%。");
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.DamagePct, DamageBonus);
            s.AddIncoming((in IncomingHit h) => DamageTaken);
        }
    }

    /// <summary>狂血：每损失 1% 生命，伤害 +0.7%（最多 +63%，输出修饰器，所有伤害都吃，同 TS）；代价：护盾恢复延迟 +2 秒</summary>
    [Defs(402)]
    public sealed class BerserkBloodScroll : LegendScroll
    {
        public const float PerMissing = 0.7f, Cap = 0.63f, ShieldDelay = 2f;

        public BerserkBloodScroll()
        {
            id = "berserk_blood";
            name = "狂血";
            tags = new[] { LegendTag, "伤害", RiskTag };
            Text("每损失 1% 生命，伤害 +0.7%（最多 +63%）。", "护盾恢复延迟 +2 秒。");
        }

        /// <summary>生命比例 → 输出倍率</summary>
        public static float Mult(float hpFrac) => 1 + Mathf.Min(Cap, (1 - Mathf.Clamp01(hpFrac)) * PerMissing);

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.ShieldRegenDelay, ShieldDelay);
            s.AddOutgoing((in HitContext c) => s.player ? Mult(ScrollKit.PlayerHpFrac(s.player)) : 1f);
        }
    }

    /// <summary>赌徒之心：暴击率 +25%，暴击伤害 +50%；代价：武器的非暴击伤害 −30%（输出修饰器在暴击掷骰之后求值）</summary>
    [Defs(403)]
    public sealed class GamblerScroll : LegendScroll
    {
        public const float CritChance = 0.25f, CritDamage = 0.5f, NonCritMult = 0.7f;

        public GamblerScroll()
        {
            id = "gambler";
            name = "赌徒之心";
            tags = new[] { LegendTag, "暴击", RiskTag };
            Text("暴击率 +25%，暴击伤害 +50%。", "武器的非暴击伤害 −30%。");
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.CritChance, CritChance);
            s.Stat(Stat.CritDamagePct, CritDamage);
            s.AddOutgoing((in HitContext c) => c.info.source == DamageSource.Weapon && !c.crit ? NonCritMult : 1f);
        }
    }

    /// <summary>
    /// 万剑归宗：武器直接命中（未击杀、有伤害）时 15% 概率从玩家眼前射出一柄追踪飞剑（30 m/s、追踪 10、2.2 s），
    /// 造成这一击实际伤害 120% 的秘卷伤害（不暴击、深度 1，不会再触发自己）。两柄之间至少隔 0.12 秒
    /// </summary>
    [Defs(404)]
    public sealed class ThousandBladesScroll : LegendScroll
    {
        public const string ScrollId = "thousand_blades";
        public const float ChanceToFire = 0.15f, DamageRatio = 1.2f, Gap = 0.12f, Speed = 30f, Homing = 10f, Life = 2.2f;
        static readonly Color Tint = Hex.Rgb(0xbff4ff);

        public ThousandBladesScroll()
        {
            id = ScrollId;
            name = "万剑归宗";
            tags = new[] { LegendTag, "命中" };
            Text("武器命中时 15% 概率射出一柄追踪飞剑，造成该次伤害 120% 的伤害。");
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                var r = e.result;
                if (!ScrollKit.IsDirectWeaponHit(in e.info) || !(r.total > 0) || r.killed || !ScrollKit.IsHittable(e.enemy)) return;
                if (!ScrollKit.Chance(ChanceToFire) || !s.Ready("blade", Gap)) return;
                Fire(ScrollKit.EyeOf(s.player), e.enemy, r.total * DamageRatio);
                s.Proc();
            });
        }

        /// <summary>
        /// 从 eye 附近（左右前后 ±0.4 m、上方 0.35–0.65 m）朝目标身体中心射一柄飞剑（外观 shard，冰蓝）。
        /// Play 模式之外不建外观（光晕面片的构建要在运行时销毁碰撞体），只有投射物本体
        /// </summary>
        public static PlayerProjectile Fire(Vector3 eye, Damageable target, float amount)
        {
            var from = eye + new Vector3((Random.value - 0.5f) * 0.8f, 0.35f + Random.value * 0.3f, (Random.value - 0.5f) * 0.8f);
            var dir = target ? ScrollKit.BodyCenter(target) - from : Vector3.forward;
            dir = dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.forward;
            var info = ScrollKit.ProcInfo(ScrollId, DamageSource.Scroll, amount, Element.None, 1, from, dir);
            var spec = new PlayerProjectileSpec(from, dir * Speed, info, 0.2f, Life)
            {
                homing = Homing, target = target, visual = Application.isPlaying ? "shard" : null, color = Tint, scale = 1.3f,
            };
            return PlayerProjectile.Spawn(in spec);
        }
    }

    /// <summary>
    /// 贪婪之心：灵石获取 +50%；每持有 100 灵石，武器伤害 +4%（最多 +40%）；代价：受到伤害时损失 3 灵石（每 0.5 秒最多一次，不够就扣光）
    /// </summary>
    [Defs(405)]
    public sealed class MidasHeartScroll : LegendScroll
    {
        public const float CoinGain = 0.5f, PerHundred = 0.04f, Cap = 0.4f, LossInterval = 0.5f;
        public const int Loss = 3;

        public MidasHeartScroll()
        {
            id = "midas_heart";
            name = "贪婪之心";
            tags = new[] { LegendTag, "经济", RiskTag };
            Text("灵石获取 +50%；每持有 100 灵石，武器伤害 +4%（最多 +40%）。", "受到伤害时损失 3 灵石（每 0.5 秒最多一次）。");
        }

        /// <summary>持有灵石 → 武器伤害倍率</summary>
        public static float WeaponMult(int coins) => 1 + Mathf.Min(Cap, Mathf.Max(0, coins) / 100 * PerHundred);

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.CoinGainPct, CoinGain);
            s.AddOutgoing((in HitContext c) => c.info.source == DamageSource.Weapon ? WeaponMult(ScrollKit.RunCoins) : 1f);
            s.OnPlayerHit((in PlayerHitEvent e) =>
            {
                if (!(e.amount > 0) || ScrollKit.RunCoins <= 0 || !s.Ready("lose", LossInterval)) return;
                if (ScrollKit.TakeRunCoins(Loss) > 0) s.Proc();
            });
        }
    }

    /// <summary>血契：吸血 +4%，击杀回复 6 生命；代价：护盾上限 −40</summary>
    [Defs(406)]
    public sealed class BloodPactScroll : LegendScroll
    {
        public BloodPactScroll()
        {
            id = "blood_pact";
            name = "血契";
            tags = new[] { LegendTag, "生存", RiskTag };
            Text("吸血 +4%，击杀回复 6 生命。", "护盾上限 −40。");
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.Lifesteal, 0.04f);
            s.Stat(Stat.KillHeal, 6f);
            s.Stat(Stat.MaxShield, -40f);
        }
    }

    /// <summary>超载：射速 +35%，弹匣容量 +50%；代价：换弹速度 −30%</summary>
    [Defs(407)]
    public sealed class OverdriveScroll : LegendScroll
    {
        public OverdriveScroll()
        {
            id = "overdrive";
            name = "超载";
            tags = new[] { LegendTag, "射速", RiskTag };
            Text("射速 +35%，弹匣容量 +50%。", "换弹速度 −30%。");
        }

        public override void Install(ScrollScope s, int n)
        {
            s.Stat(Stat.FireRatePct, 0.35f);
            s.Stat(Stat.MagPct, 0.5f);
            s.Stat(Stat.ReloadSpeedPct, -0.3f);
        }
    }
}
