using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 坠星震地（Three.js 版 defsTactics.ts tac_landing_wave）：以至少 6 米/秒的下落速度落地时，对周围 4 米（× 爆炸范围）造成每层 28 点伤害
    /// （× 强度成长、× 爆炸伤害）并击退；冷却 3 秒。见 <see cref="TacticsKit.Pulse"/>。
    /// </summary>
    [Defs(606)]
    public sealed class TacLandingWave : ScrollDef
    {
        public const float MinFallSpeed = 6f;
        static readonly Color WaveColor = Hex.Rgb(0xe8cd8c);

        public TacLandingWave()
        {
            id = "tac_landing_wave";
            name = "坠星震地";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "机动", "爆炸" };
            description = "以至少 6 米/秒的下落速度落地时，对周围 4 米造成每层 28 点伤害（随关卡强度成长）并击退，范围受爆炸范围加成影响；冷却 3 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnPlayerLanded(fall =>
            {
                if (!TacticsKit.Alive(s) || !(fall >= MinFallSpeed) || !s.Ready("landing", 3)) return;
                TacticsKit.Pulse(s, 4, 28 * n, WaveColor);
                s.Proc();
            });
        }
    }
}
