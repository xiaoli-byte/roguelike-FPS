using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一只敌人的击杀奖励倍率（docs/balance.md 第十二节「怪要多之后的经济」）：<see cref="CombatDirector"/> 给两类怪挂——
    ///   · 据点加量后的怪：整个据点的灵石 / 魂晶总量不变，平摊到加量后的每一只（<see cref="coins"/> = <see cref="essence"/> = 原只数 ÷ 加量后只数）；
    ///   · 游荡怪（<see cref="roaming"/>）：倍率 1，但每关游荡怪的灵石 / 魂晶有上限（<see cref="CombatDirector.ClaimRoamingCoins"/>）。
    /// <see cref="LootDirector"/> 掉灵石、<see cref="KillResolver"/> 结魂晶时读它；小数按概率取整，期望不变。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RewardScale : MonoBehaviour
    {
        [Tooltip("灵石倍率")] public float coins = 1f;
        [Tooltip("魂晶倍率")] public float essence = 1f;
        [Tooltip("游荡怪（每关有上限）")] public bool roaming;

        /// <summary>这只敌人的倍率（没挂为 null）</summary>
        public static RewardScale Of(Component enemy) => enemy ? enemy.GetComponent<RewardScale>() : null;

        /// <summary>挂上 / 改写倍率</summary>
        public static RewardScale Apply(Component enemy, float coins, float essence, bool roaming = false)
        {
            if (!enemy) return null;
            var r = enemy.GetComponent<RewardScale>();
            if (!r) r = enemy.gameObject.AddComponent<RewardScale>();
            r.coins = Mathf.Max(0, coins);
            r.essence = Mathf.Max(0, essence);
            r.roaming |= roaming;
            return r;
        }

        /// <summary>amount × mult，小数部分按概率进位（0.4 只 → 40% 给 1），期望 = amount × mult</summary>
        public static int Scale(int amount, float mult, RunRng rng = null)
        {
            if (amount <= 0 || mult <= 0) return 0;
            if (Mathf.Approximately(mult, 1f)) return amount;
            float v = amount * mult;
            int whole = Mathf.FloorToInt(v);
            float frac = v - whole;
            double roll = rng != null ? rng.NextDouble() : Random.value;
            return whole + (roll < frac ? 1 : 0);
        }
    }
}
