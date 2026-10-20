using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「狂热」（TS lg_frenzy）：任何武器。数值 = 每层射速 +4%。
    /// 生效：本武器每次直接命中叠一层（同一次射击的多颗弹丸 0.05 s 内只算一层），最多 10 层；射速 × (1 + 层数 × 值)；
    /// 2 s 没有命中时清空（在射速钩子里判定：只看手上这把）。
    /// </summary>
    [Defs(1040)]
    public sealed class Legendary_Frenzy : LegendaryDef
    {
        public const string Id = "lg_frenzy";
        public const int MaxStacks = 10;
        /// <summary>同一发的多次命中算一层的窗口；不命中多久清空</summary>
        public const float StackGap = 0.05f, Decay = 2f;

        public Legendary_Frenzy() : base(Id, "狂热") { }

        public override float Value(WeaponDef weapon) => 0.04f;

        public override string Text(WeaponDef weapon, float v) => $"命中叠加 {AffixText.Pct(v)} 射速（最多 {MaxStacks} 层），2 秒未命中清空";

        public override IAffixEffect Effect => effect;

        static readonly FrenzyEffect effect = new();

        sealed class FrenzyEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (!(h.value > 0)) return;
                var rt = h.Runtime;
                if (rt.frenzy == 0 || h.now - rt.frenzyTime > StackGap) rt.frenzy = Mathf.Min(MaxStacks, rt.frenzy + 1);
                rt.frenzyTime = h.now;
            }

            public override float FireRate(in AffixHook h)
            {
                var rt = h.Runtime;
                if (rt.frenzy > 0 && h.now - rt.frenzyTime > Decay) rt.frenzy = 0;
                return h.value > 0 ? 1 + rt.frenzy * h.value : 1;
            }
        }
    }
}
