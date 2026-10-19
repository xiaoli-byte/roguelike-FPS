using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家属性（与 Three.js 版 src/core/Stats.ts 的 BASE_STATS 同名同义）。只往末尾追加，不改已有顺序（存档 / 序列化按序号）。
    /// 中文名、显示格式、「越低越好」见 <see cref="StatInfo"/>。
    /// </summary>
    public enum Stat
    {
        MaxHp, MaxShield, ShieldRegenDelay, ShieldRegenRate, MoveSpeed, DashCharges, DashCooldown,
        CritChance, CritDamagePct, DamagePct, FireRatePct, ReloadSpeedPct, MagPct, DamageReduction,
        PickupRadius, SkillHaste, SkillDamagePct, ExplosionDamagePct, ElementChancePct, KillHeal, KillShield,
        WeakpointDamagePct,
        // 元素反应（docs/arsenal-expansion.md 0.1）：反应伤害、反应急速（冷却 / (1 + 值)）、爆炸 / 反应范围
        ReactionDamagePct, ReactionHaste, ExplosionRadiusPct,
        // 灵宠（docs/pet-system.md）：灵宠伤害加成
        PetDamagePct,
        // ── 对齐 Three.js 补齐的 19 个（docs/unity-parity.md 4.4）──
        // 生存
        HpRegen, Lifesteal,
        // 移动：起跳速度（基础 8.6）、额外跳跃次数（二段跳）
        JumpVelocity, ExtraJumps,
        // 武器
        AmmoReservePct, SpreadPct, RecoilPct, ProjectileSpeedPct,
        // 输出：对首领 / 精英、对护盾 / 护甲层
        BossDamagePct, EliteDamagePct, ShieldDamagePct, ArmorDamagePct,
        // 元素：全元素、灼烧 / 雷殛 / 蚀化各自（作用于命中与持续伤害）
        ElementDamagePct, FireDamagePct, ShockDamagePct, CorrodeDamagePct,
        // 技能：副技能额外充能
        SecondaryCharges,
        // 经济 / 杂项
        CoinGainPct, Luck,
    }

    /// <summary>
    /// 属性表：最终值 = 基础值 + 各来源修正之和。修正按来源登记（卷轴、英雄被动、武器…），同一来源可整体撤销。
    /// 百分比属性（*Pct）是加成量，取用时用 <see cref="Mult"/> = 1 + 值（下限 0.05，同 Three.js）。
    /// 一次改很多条时用 <see cref="BeginBatch"/> / <see cref="EndBatch"/> 包起来：期间不发 <see cref="Changed"/>，结束时只发一次。
    /// </summary>
    public sealed class StatSheet
    {
        /// <summary>百分比倍率的下限：再多的负加成也不会让倍率低于 5%</summary>
        public const float MinMult = 0.05f;

        readonly Dictionary<Stat, float> baseValues = new();
        readonly Dictionary<string, List<(Stat stat, float value)>> mods = new();
        readonly Dictionary<Stat, float> cache = new();
        int batchDepth;
        bool batchDirty;

        /// <summary>属性有变化（批量修改期间不发，<see cref="EndBatch"/> 时补发一次）</summary>
        public event Action Changed;

        /// <summary>每次变化自增：外部缓存（武器面板、预览倍率）据此判断要不要重算</summary>
        public int Version { get; private set; }

        public static StatSheet Default()
        {
            var s = new StatSheet();
            s.SetBase(Stat.MaxHp, 100);
            s.SetBase(Stat.MaxShield, 50);
            s.SetBase(Stat.ShieldRegenDelay, 3);
            s.SetBase(Stat.ShieldRegenRate, 30);
            s.SetBase(Stat.MoveSpeed, 7.5f);
            s.SetBase(Stat.JumpVelocity, 8.6f);
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

        public float GetBase(Stat stat) => baseValues.TryGetValue(stat, out var b) ? b : 0;

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

        public bool HasSource(string source) => mods.ContainsKey(source);

        /// <summary>某来源登记的全部修正（调试 / UI）；没有则为空</summary>
        public IReadOnlyList<(Stat stat, float value)> ModsFrom(string source) =>
            mods.TryGetValue(source, out var list) ? list : Array.Empty<(Stat, float)>();

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

        /// <summary>1 + 值，用于 Pct 类属性；结果不小于 <see cref="MinMult"/></summary>
        public float Mult(Stat stat) => Math.Max(MinMult, 1 + Get(stat));

        /// <summary>开始批量修改（可嵌套）：期间照常改值、照常读到新值，只是不发 Changed</summary>
        public void BeginBatch() => batchDepth++;

        /// <summary>结束批量修改：最外层结束时，期间有过变化就发一次 Changed</summary>
        public void EndBatch()
        {
            if (batchDepth <= 0) return;
            if (--batchDepth > 0 || !batchDirty) return;
            batchDirty = false;
            Changed?.Invoke();
        }

        void Invalidate()
        {
            cache.Clear();
            Version++;
            if (batchDepth > 0)
            {
                batchDirty = true;
                return;
            }
            Changed?.Invoke();
        }
    }
}
