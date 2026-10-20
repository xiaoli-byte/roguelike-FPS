using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"heal"：生命上限 +10（属性来源 reward），回复 50% 生命（同 TS grant('heal')，带回血音效与绿色爆闪）</summary>
    [Defs]
    public sealed class HealReward : RewardHandler
    {
        public const float MaxHpBonus = 10, HealFrac = 0.5f;
        /// <summary>生命上限加成登记的属性来源</summary>
        public const string Source = "reward";
        /// <summary>宝箱说明行</summary>
        public const string Line = "回复 50% 生命，生命上限 +10";

        static readonly Color Green = new(0.3f, 1f, 0.48f);

        public override string Key => "heal";

        public override void Grant(in RewardContext ctx)
        {
            var pv = ctx.Player;
            if (!pv) return;
            pv.stats.Add(Source, Stat.MaxHp, MaxHpBonus);
            pv.Heal(pv.MaxHealth * HealFrac);
            GameAudio.Play("pickup_health");
            PetFx.Burst(pv.transform.position + Vector3.up, new Color(Green.r, Green.g, Green.b, 0.8f), 2.6f, 0.7f);
            GameUI.Toast("生命上限 +10，回复 50% 生命", Green);
        }

        public override string Hint(string[] args) => "生命";
        public override Color Color(string[] args) => new(0.4f, 1f, 0.55f);
    }
}
