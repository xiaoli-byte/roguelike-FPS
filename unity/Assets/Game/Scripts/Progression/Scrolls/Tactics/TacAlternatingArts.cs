namespace Spiritfire.Game
{
    /// <summary>
    /// 双诀相生（Three.js 版 defsTactics.ts tac_alternating_arts）：在 6 秒内交替释放 Q 与 E，使前一个技能冷却立即减少每层 1.5 秒，
    /// 并获得 6 秒技能伤害每层 +20%（刷新不叠加）；联动冷却 3 秒；连续使用同一技能、超时、联动冷却期间不触发。换关 / 阵亡清空。
    /// </summary>
    [Defs(609)]
    public sealed class TacAlternatingArts : ScrollDef
    {
        public const float Window = 6f, PairCooldown = 3f;

        public TacAlternatingArts()
        {
            id = "tac_alternating_arts";
            name = "双诀相生";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "技能", "触发" };
            description = "在 6 秒内交替释放 Q 与 E，使前一个技能冷却立即减少每层 1.5 秒，并获得 6 秒技能伤害每层 +20%；联动冷却 3 秒，连续使用同一技能不触发。";
        }

        public override void Install(ScrollScope s, int n)
        {
            var buff = s.BattleBuff((Stat.SkillDamagePct, 0.2f * n));
            SkillSlot? last = null;
            float until = float.NegativeInfinity;

            void Reset()
            {
                last = null;
                until = float.NegativeInfinity;
            }

            s.OnStageLoaded(_ => Reset());
            s.OnPlayerDied(Reset);
            s.OnSkillUsed((slot, skillId) =>
            {
                if (!TacticsKit.Alive(s)) return;
                if (last.HasValue && last.Value != slot && s.Now < until && s.Ready("pair", PairCooldown))
                {
                    TacticsKit.Host.ReduceCooldowns(1.5f * n, last.Value);
                    buff.Trigger(Window);
                    s.Proc();
                }
                last = slot;
                until = s.Now + Window;
            });
        }
    }
}
