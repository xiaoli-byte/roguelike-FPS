namespace Spiritfire.Game
{
    /// <summary>
    /// 断首：爆头（命中弱点，含白泽改判）伤害每层 +15%；武器爆头击杀（静默处决除外）时每层回复 4 护盾。
    /// 增伤是输出修饰器（同 TS req.headshot 判定，对所有来源生效）；回盾只认武器 / 近战的击杀。
    /// </summary>
    public sealed class HeadsmanScroll : ScrollDef
    {
        public const float DamagePerStack = 0.15f, ShieldPerStack = 4f;

        public HeadsmanScroll()
        {
            id = "headsman";
            name = "断首";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "暴击", "护盾" };
            description = "爆头伤害每层 +15%；爆头击杀时每层回复 4 护盾。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float bonus = 1 + DamagePerStack * n;
            float shield = ShieldPerStack * n;
            s.AddOutgoing((in HitContext c) => c.weak ? bonus : 1f);
            s.OnKill((in KillEvent e) =>
            {
                if (!OffenseKit.IsWeak(in e.info) || !OffenseKit.IsWeaponSource(e.info.source) || !s.player) return;
                if (s.player.AddShield(shield) > 0) s.Proc();
            });
        }
    }

    /// <summary>
    /// 连击心法：武器直接暴击（造成了伤害、非衍生、非处决、玩家活着）获得 1 层战意，最多 5 层；
    /// 每层战意 = 一个独立的限时增益（每层秘卷 +6% 暴击伤害、+1.5% 射速）。再次暴击把全部战意刷新为 5 秒；同一帧只累积一次（霰弹一轮弹丸算一次）。
    /// 战意过期（距上次累积满 5 秒）后再暴击从 1 层重新算；换关、阵亡立刻清空。同 TS defsOffense crit_streak。
    /// </summary>
    public sealed class CritStreakScroll : ScrollDef
    {
        public const int MaxCharges = 5;
        public const float Duration = 5f, CritDamagePerStack = 0.06f, FireRatePerStack = 0.015f;

        public CritStreakScroll()
        {
            id = "crit_streak";
            name = "连击心法";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "暴击", "射速", "触发" };
            description = "武器直接暴击获得 1 层战意，最多 5 层；每层战意提供每层秘卷 +6% 暴击伤害、+1.5% 射速。再次暴击刷新全部战意的 5 秒时长；同帧只累积一次。";
        }

        public override void Install(ScrollScope s, int n)
        {
            // 每枚战意有独立属性来源；刷新时统一延长，不重复写入修饰
            var buffs = new TimedBuff[MaxCharges];
            for (int i = 0; i < MaxCharges; i++) buffs[i] = s.Buff((Stat.CritDamagePct, CritDamagePerStack * n), (Stat.FireRatePct, FireRatePerStack * n));
            int count = 0;
            float until = float.NegativeInfinity;
            var gate = new OffenseKit.FrameGate();
            void Reset()
            {
                count = 0;
                until = float.NegativeInfinity;
                gate.Clear();
                foreach (var b in buffs) b.End();
            }
            s.OnStageLoaded(_ => Reset());
            s.OnPlayerDied(Reset);
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!s.Alive || !e.result.crit || e.result.total <= 0 || !OffenseKit.IsDirectHit(in e.info)) return;
                if (s.Now >= until) Reset();
                if (!gate.First()) return;
                count = System.Math.Min(MaxCharges, count + 1);
                until = s.Now + Duration;
                for (int i = 0; i < count; i++) buffs[i].Trigger(Duration);
                s.Proc(0.25f);
            });
        }
    }
}
