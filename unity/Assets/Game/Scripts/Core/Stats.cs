using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>玩家属性（与 Three.js 版 src/core/Stats.ts 的 BASE_STATS 同名同义，只保留切片用到的）</summary>
    public enum Stat
    {
        MaxHp, MaxShield, ShieldRegenDelay, ShieldRegenRate, MoveSpeed, DashCharges, DashCooldown,
        CritChance, CritDamagePct, DamagePct, FireRatePct, ReloadSpeedPct, MagPct, DamageReduction,
        PickupRadius, SkillHaste, SkillDamagePct, ExplosionDamagePct, ElementChancePct, KillHeal, KillShield,
        WeakpointDamagePct,
    }

    /// <summary>
    /// 属性表：最终值 = 基础值 + 各来源修正之和。修正按来源登记（卷轴、英雄被动、武器…），同一来源可整体撤销。
    /// 百分比属性（*Pct）是加成量，取用时用 <see cref="Mult"/> = 1 + 值。
    /// </summary>
    public sealed class StatSheet
    {
        readonly Dictionary<Stat, float> baseValues = new();
        readonly Dictionary<string, List<(Stat stat, float value)>> mods = new();
        readonly Dictionary<Stat, float> cache = new();
        public event Action Changed;

        public static StatSheet Default()
        {
            var s = new StatSheet();
            s.SetBase(Stat.MaxHp, 100);
            s.SetBase(Stat.MaxShield, 50);
            s.SetBase(Stat.ShieldRegenDelay, 3);
            s.SetBase(Stat.ShieldRegenRate, 30);
            s.SetBase(Stat.MoveSpeed, 7.5f);
            s.SetBase(Stat.DashCharges, 1);
            s.SetBase(Stat.DashCooldown, 1.6f);
            s.SetBase(Stat.CritChance, 0.05f);
            s.SetBase(Stat.PickupRadius, 3.5f);
            return s;
        }

        public void SetBase(Stat stat, float value)
        {
            baseValues[stat] = value;
            Invalidate();
        }

        public void Add(string source, Stat stat, float value)
        {
            if (!mods.TryGetValue(source, out var list)) mods[source] = list = new List<(Stat, float)>();
            list.Add((stat, value));
            Invalidate();
        }

        public void Remove(string source)
        {
            if (mods.Remove(source)) Invalidate();
        }

        public float Get(Stat stat)
        {
            if (cache.TryGetValue(stat, out var v)) return v;
            v = baseValues.TryGetValue(stat, out var b) ? b : 0;
            foreach (var list in mods.Values)
                foreach (var (s, value) in list)
                    if (s == stat) v += value;
            cache[stat] = v;
            return v;
        }

        public float Mult(Stat stat) => 1 + Get(stat);

        void Invalidate()
        {
            cache.Clear();
            Changed?.Invoke();
        }
    }
}
