using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>特效打磨 B 路的入口（爆炸分档、元素反应、护盾球壳）：Fx 的分部文件，避免和其它路在 Fx.cs 里撞车</summary>
    public static partial class Fx
    {
        /// <summary>爆炸分档的半径界线：小 &lt; 1.6 m（弹丸），中 1.6–4 m（榴弹 / 火药 / 反应），大 ≥ 4 m（首领技能、精英自爆）</summary>
        public const float ExplosionSmallBelow = 1.6f, ExplosionLargeFrom = 4f;

        /// <summary>按半径选爆炸档的预设 id</summary>
        public static string ExplosionId(float radius) =>
            !(radius >= ExplosionSmallBelow) ? "ExplosionSmall" : radius >= ExplosionLargeFrom ? "ExplosionLarge" : "Explosion";

        /// <summary>
        /// 元素反应「打出了组合技」的那一下（闪光 → 冲击波 → 余韵，Presets/Reactions.cs）：熔金 / 焚雷 / 封脉；归墟走 <see cref="Abyss"/>。
        /// center = 反应中心（中心敌人身体中心），scale = 规模（1 = 一个人形身位）
        /// </summary>
        public static FxHandle Reaction(Reaction r, Vector3 center, float scale = 1)
        {
            string id = r switch
            {
                Game.Reaction.Meltdown => "RxMeltdown",
                Game.Reaction.Thunderfire => "RxThunderfire",
                Game.Reaction.Veinseal => "RxVeinseal",
                _ => null,
            };
            if (id == null) return FxHandle.None;
            var p = Registry<FxPreset>.Get(id);
            return p == null ? FxHandle.None : Play(p, center, Vector3.up, CombatTuning.ReactionColors[(int)r], scale);
        }

        /// <summary>崩解：元素色光点往里一吸、再「啪」地炸开（Presets/Reactions.cs RxCollapse）</summary>
        public static FxHandle Collapse(Vector3 center, Color color, float scale = 1) => Play("RxCollapse", center, Vector3.up, color, scale);
    }
}
