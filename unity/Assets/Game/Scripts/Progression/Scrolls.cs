using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>秘卷（Three.js 版 src/progression/scrolls/*）：切片只收纯属性类，数值同原版；可叠层，每层同样的加成</summary>
    public sealed class ScrollDef
    {
        public string id, name, description, tag;
        public int rarity, maxStacks = 3;
        public (Stat stat, float perStack)[] stats = Array.Empty<(Stat, float)>();
        /// <summary>获得一层时的一次性效果（上限类不用写：PlayerVitals 加上限时会同步加当前值）</summary>
        public Action<PlayerVitals> onGain;
    }

    public static class ScrollLibrary
    {
        public static readonly string[] RarityName = { "普通", "精良", "稀有", "传说" };
        public static readonly Color[] RarityColor =
        {
            new(0.82f, 0.84f, 0.86f), new(0.4f, 0.8f, 0.45f), new(0.35f, 0.62f, 1f), new(1f, 0.62f, 0.2f),
        };
        static readonly float[] RarityWeight = { 60, 30, 9, 1 };

        public static readonly ScrollDef[] All =
        {
            new() { id = "keen_blade", name = "利刃", tag = "伤害", rarity = 0, maxStacks = 5, description = "武器伤害每层 +6%。", stats = new[] { (Stat.DamagePct, 0.06f) } },
            new() { id = "hawk_eye", name = "鹰目", tag = "暴击", rarity = 0, maxStacks = 5, description = "暴击率每层 +4%。", stats = new[] { (Stat.CritChance, 0.04f) } },
            new() { id = "fatal_art", name = "致命诀", tag = "暴击", rarity = 1, maxStacks = 4, description = "暴击伤害每层 +15%。", stats = new[] { (Stat.CritDamagePct, 0.15f) } },
            new() { id = "rapid_fire", name = "骤雨", tag = "射速", rarity = 1, maxStacks = 4, description = "射速每层 +7%。", stats = new[] { (Stat.FireRatePct, 0.07f) } },
            new() { id = "swift_hands", name = "疾手", tag = "换弹", rarity = 0, maxStacks = 5, description = "换弹速度每层 +10%。", stats = new[] { (Stat.ReloadSpeedPct, 0.1f) } },
            new() { id = "bottomless", name = "百宝囊", tag = "弹匣", rarity = 0, maxStacks = 3, description = "弹匣容量每层 +10%。", stats = new[] { (Stat.MagPct, 0.1f) } },
            new()
            {
                id = "iron_bones", name = "铁骨", tag = "生存", rarity = 0, maxStacks = 5, description = "生命上限每层 +12（获得时同时回复 12 生命）。",
                stats = new[] { (Stat.MaxHp, 12f) },
            },
            new()
            {
                id = "spirit_ward", name = "灵盾", tag = "护盾", rarity = 0, maxStacks = 5, description = "护盾上限每层 +10（获得时同时补充 10 护盾）。",
                stats = new[] { (Stat.MaxShield, 10f) },
            },
            new()
            {
                id = "quick_recovery", name = "回春", tag = "护盾", rarity = 1, maxStacks = 3, description = "护盾恢复延迟每层 −0.4 秒，恢复速度每层 +8/秒。",
                stats = new[] { (Stat.ShieldRegenDelay, -0.4f), (Stat.ShieldRegenRate, 8f) },
            },
            new() { id = "harvest", name = "收割", tag = "击杀", rarity = 1, maxStacks = 4, description = "击杀敌人时每层回复 3 生命。", stats = new[] { (Stat.KillHeal, 3f) } },
            new() { id = "soul_siphon", name = "摄魂", tag = "击杀", rarity = 1, maxStacks = 4, description = "击杀敌人时每层回复 4 护盾。", stats = new[] { (Stat.KillShield, 4f) } },
            new() { id = "stone_skin", name = "石肤", tag = "生存", rarity = 1, maxStacks = 3, description = "伤害减免每层 +5%。", stats = new[] { (Stat.DamageReduction, 0.05f) } },
            new() { id = "wind_walker", name = "踏风", tag = "机动", rarity = 0, maxStacks = 3, description = "移动速度每层 +0.4。", stats = new[] { (Stat.MoveSpeed, 0.4f) } },
            new() { id = "streamer", name = "流光", tag = "机动", rarity = 2, maxStacks = 1, description = "冲刺次数 +1。", stats = new[] { (Stat.DashCharges, 1f) } },
            new() { id = "weak_point", name = "破绽", tag = "暴击", rarity = 1, maxStacks = 3, description = "弱点伤害每层 +15%。", stats = new[] { (Stat.WeakpointDamagePct, 0.15f) } },
            new() { id = "spirit_lure", name = "灵引", tag = "经济", rarity = 0, maxStacks = 2, description = "拾取范围每层 +2 米。", stats = new[] { (Stat.PickupRadius, 2f) } },
        };

        public static ScrollDef Get(string id) => All.FirstOrDefault(d => d.id == id);

        /// <summary>按稀有度权重抽 count 张不重复、未满层的秘卷</summary>
        public static List<ScrollDef> Roll(ScrollInventory inv, int count, int minRarity = 0)
        {
            var pool = All.Where(d => d.rarity >= minRarity && inv.Stacks(d.id) < d.maxStacks).ToList();
            var picked = new List<ScrollDef>();
            while (picked.Count < count && pool.Count > 0)
            {
                float total = pool.Sum(d => RarityWeight[d.rarity]);
                float r = UnityEngine.Random.value * total;
                var choice = pool[^1];
                foreach (var d in pool)
                {
                    r -= RarityWeight[d.rarity];
                    if (r <= 0) { choice = d; break; }
                }
                picked.Add(choice);
                pool.Remove(choice);
            }
            return picked;
        }
    }

    /// <summary>本局持有的秘卷（层数）：每层登记一份属性修正（来源 = scroll:id:层）</summary>
    public sealed class ScrollInventory
    {
        readonly Dictionary<string, int> stacks = new();
        public event Action<ScrollDef, int> Gained;
        public IReadOnlyDictionary<string, int> All => stacks;

        public int Stacks(string id) => stacks.TryGetValue(id, out var n) ? n : 0;

        public void Gain(ScrollDef def, PlayerVitals vitals)
        {
            int n = Mathf.Min(def.maxStacks, Stacks(def.id) + 1);
            stacks[def.id] = n;
            // 每层单独登记（来源 scroll:id:层），只加增量：上限类属性的「同时回复」就只回这一层的量
            var source = $"scroll:{def.id}:{n}";
            vitals.stats.Remove(source);
            foreach (var (stat, per) in def.stats) vitals.stats.Add(source, stat, per);
            def.onGain?.Invoke(vitals);
            Gained?.Invoke(def, n);
        }
    }
}
