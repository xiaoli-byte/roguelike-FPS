using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英词缀登记的接口（实现归 EN4：G/Enemies/Affixes/*，迅捷 / 坚盾 / 爆裂 / 狂暴…）。
    /// 遭遇在生成精英前通过 <see cref="SquadAffixes"/> 问它要词缀 id，结果放进 <see cref="SpawnOptions.affix"/>，由敌人那边解释（金环、名字前缀、数值）。
    /// </summary>
    public interface IEliteAffixSource
    {
        /// <summary>登记过这个词缀 id</summary>
        bool Exists(string affixId);

        /// <summary>给这种敌人随机一个词缀（实现要排除 <see cref="EnemyDef.affixExclusions"/>）；没有可用的返回 null</summary>
        string Roll(EnemyDef def, RunRng rng);
    }

    /// <summary>
    /// 小队词缀（docs/unity-parity.md L2「精英升格；小队词缀」，TS WaveEntry.affix / EnemyManager.spawn）：只有精英带词缀，首领不带。
    /// 取词顺序：条目写的 <see cref="WaveEntry.affix"/> → 场地的 <see cref="EncounterSpec.squadAffix"/>（整队精英同一个词缀）→ 词缀登记随机。
    /// 写死的词缀落在敌人的排除表里、或词缀登记里没有时跳过它（往下一级找）。没有词缀登记（EN4 之前）时写死的词缀原样透传、不随机。
    /// </summary>
    public static class SquadAffixes
    {
        /// <summary>词缀登记（EN4 在启动时设置；测试可以临时换成假的）</summary>
        public static IEliteAffixSource Source { get; set; }

        static readonly HashSet<string> warned = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Source = null;
            warned.Clear();
        }

        /// <summary>这只敌人生成时带的词缀 id（不带返回 null）</summary>
        public static string Resolve(EnemyDef def, bool elite, string entryAffix, string squadAffix, RunRng rng)
        {
            if (!elite || def == null || def.rank == Rank.Boss) return null;
            if (Allowed(def, entryAffix)) return entryAffix;
            if (Allowed(def, squadAffix)) return squadAffix;
            var src = Source;
            if (src == null) return null;
            try
            {
                var id = src.Roll(def, rng);
                return string.IsNullOrEmpty(id) ? null : id;
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                return null;
            }
        }

        static bool Allowed(EnemyDef def, string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            if (def.affixExclusions != null && Array.IndexOf(def.affixExclusions, id) >= 0) return false;
            var src = Source;
            if (src == null || src.Exists(id)) return true;
            if (warned.Add(id)) Debug.LogWarning($"[Encounter] 词缀登记里没有「{id}」，改为随机");
            return false;
        }
    }
}
