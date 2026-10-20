using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 踏浪震击（Three.js 版 defsTactics.ts tac_dash_wave）：冲刺时向周围 3 米（× 爆炸范围）释放击退波，每层 24 点伤害（× 强度成长、× 爆炸伤害）；冷却 3 秒。
    /// 见 <see cref="TacticsKit.Pulse"/>：沿用 Combat 的距离衰减、墙体遮挡与不可选中规则，不伤玩家。
    /// </summary>
    [Defs(605)]
    public sealed class TacDashWave : ScrollDef
    {
        static readonly Color WaveColor = Hex.Rgb(0x93e8ff);

        public TacDashWave()
        {
            id = "tac_dash_wave";
            name = "踏浪震击";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "机动", "爆炸" };
            description = "冲刺时向周围 3 米释放击退波，造成每层 24 点伤害（随关卡强度成长），范围受爆炸范围加成影响；冷却 3 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnPlayerDashed(_ =>
            {
                if (!TacticsKit.Alive(s) || !s.Ready("wave", 3)) return;
                TacticsKit.Pulse(s, 3, 24 * n, WaveColor);
                s.Proc();
            });
        }
    }
}
