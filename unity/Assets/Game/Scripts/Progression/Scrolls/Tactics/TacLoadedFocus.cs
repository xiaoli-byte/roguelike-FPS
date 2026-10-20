namespace Spiritfire.Game
{
    /// <summary>
    /// 凝神装填（Three.js 版 defsTactics.ts tac_loaded_focus）：换弹完成后 8 秒内，该武器接下来 3 次直接命中伤害每层 +25%，弱点命中再每层 +15%
    /// （弱点照常另算暴击）。同一帧的霰弹 / 穿透命中算一次并共享强化；衍生伤害、其他武器、没造成伤害的命中不消耗；切枪（任何切枪事件）、换关、阵亡清空。
    /// </summary>
    [Defs(603)]
    public sealed class TacLoadedFocus : ScrollDef
    {
        public const int Charges = 3;
        public const float Window = 8f;

        public TacLoadedFocus()
        {
            id = "tac_loaded_focus";
            name = "凝神装填";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "换弹", "爆头", "伤害" };
            description = "换弹完成后 8 秒内，该武器接下来 3 次直接命中伤害每层 +25%，爆头再额外每层 +15%。同帧霰弹或穿透命中算一次并共享强化；切枪清空。";
        }

        public override void Install(ScrollScope s, int n)
        {
            int uid = 0, remaining = 0;
            float until = float.NegativeInfinity;
            double spentFrame = -1;

            void Reset()
            {
                uid = 0;
                remaining = 0;
                until = float.NegativeInfinity;
                spentFrame = -1;
            }

            bool Eligible(in DamageInfo i) =>
                TacticsKit.Alive(s) && TacticsKit.IsDirectWeaponHit(i) && uid != 0 && i.weaponUid == uid && s.Now < until &&
                (remaining > 0 || spentFrame == TacticsKit.Frame);

            s.OnStageLoaded(_ => Reset());
            s.OnPlayerDied(Reset);
            s.OnWeaponSwitched((prev, next) => Reset());
            s.OnReloaded(w =>
            {
                if (w == null || !TacticsKit.Alive(s)) return;
                uid = w.uid;
                remaining = Charges;
                until = s.Now + Window;
                spentFrame = -1;
            });
            s.AddOutgoing((in HitContext c) => Eligible(c.info) ? 1 + (0.25f + (c.weak ? 0.15f : 0)) * n : 1f);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                double frame = TacticsKit.Frame;
                if (!(e.result.total > 0) || spentFrame == frame || !Eligible(e.info)) return;
                remaining--;
                spentFrame = frame;
                s.Proc();
            });
        }
    }
}
