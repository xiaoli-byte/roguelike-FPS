using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「殉爆」（TS lg_nova）：任何武器。数值 = 爆炸半径 4 m（× 玩家爆炸范围）。
    /// 生效：本武器的伤害打死敌人时（直接命中，或上一级殉爆，最多连锁两级：深度 0 / 1 的击杀才炸），下一帧在尸身引发爆炸：
    /// 伤害 = clamp(0.35 × 秒伤 + 0.5 × 单发总伤害, 35, 220)（<see cref="Damage"/>），按致死那一击的元素必定附着（无元素不附着），不暴击，
    /// 击退 6，另画一圈冲击波。
    /// </summary>
    [Defs(1010)]
    public sealed class Legendary_Nova : LegendaryDef
    {
        public const string Id = "lg_nova";
        public const float MinDamage = 35, MaxDamage = 220, Knockback = 6;
        /// <summary>致死那一击的深度低于它才炸（0：直接击杀；1：第一级殉爆的击杀）</summary>
        public const int MaxChainDepth = 2;

        public Legendary_Nova() : base(Id, "殉爆") { }

        public override float Value(WeaponDef weapon) => 4;

        public override string Text(WeaponDef weapon, float v) => $"击杀敌人时引发同元素爆炸（{AffixText.Num(v)} 米），可连锁";

        /// <summary>爆炸基础伤害：随武器秒伤与单发伤害增长，钳在 [35, 220]（同 TS novaDamage）</summary>
        public static float Damage(ResolvedWeapon r) => r == null ? MinDamage : Mathf.Clamp(0.35f * r.dps + 0.5f * r.perShot, MinDamage, MaxDamage);

        public override IAffixEffect Effect => effect;

        static readonly NovaEffect effect = new();

        sealed class NovaEffect : AffixEffect
        {
            public override void OnKill(in AffixHook h, in KillEvent e)
            {
                if (!(h.value > 0) || h.effects == null || e.info.depth >= MaxChainDepth) return;
                var el = e.info.element;
                h.effects.QueueBlast(in h, Id, h.effects.Env.Center(e.enemy), Damage(h.stats), h.value * h.stats.blastMult, el,
                    el == Element.None ? 0 : 1, e.info.depth + 1, Knockback, ring: true);
            }
        }
    }
}
