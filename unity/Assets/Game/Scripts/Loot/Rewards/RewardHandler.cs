using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一种奖励（宝箱 / 场地奖励串的一个 key，如 "weapon:revolver:2" 的 weapon）：发放、宝箱提示词、宝箱 / 光柱颜色。
    /// 每种一个文件 Loot/Rewards/&lt;Kind&gt;Reward.cs：继承 <see cref="RewardHandler"/> + [Defs]，由 <see cref="Registry{T}"/> 收集，
    /// <see cref="RewardRegistry"/> 按 key 分发（取代 LootDirector.Grant 里的 switch）。Key 即注册表 id。
    /// </summary>
    public interface IRewardHandler : IDef
    {
        string Key { get; }
        void Grant(in RewardContext ctx);
        /// <summary>宝箱交互提示「打开宝箱 · …」里的词</summary>
        string Hint(string[] args);
        /// <summary>宝箱宝石 / 光柱颜色</summary>
        Color Color(string[] args);
    }

    /// <summary>奖励处理器基类：Key 兼作注册表 id</summary>
    public abstract class RewardHandler : IRewardHandler
    {
        public abstract string Key { get; }
        string IDef.Id => Key;
        public abstract void Grant(in RewardContext ctx);
        public virtual string Hint(string[] args) => "奖励";
        public virtual Color Color(string[] args) => UnityEngine.Color.white;
    }

    /// <summary>一次发放的上下文：奖励串（按 ':' 拆开，args[0] = key）、发放位置、掉落系统</summary>
    public readonly struct RewardContext
    {
        public readonly string reward;
        public readonly string[] args;
        public readonly Vector3 position;
        public readonly LootDirector loot;

        public RewardContext(string reward, Vector3 position, LootDirector loot)
        {
            this.reward = reward ?? "";
            args = RewardRegistry.Split(this.reward);
            this.position = position;
            this.loot = loot;
        }

        public PlayerVitals Player => PlayerVitals.Instance;
        /// <summary>第 index 个参数（args[0] 是 key）；没有时返回 fallback</summary>
        public string Arg(int index, string fallback = null) => index < args.Length && args[index].Length > 0 ? args[index] : fallback;
        /// <summary>从发放位置指向玩家的水平方向（没有玩家时朝 +Z）</summary>
        public Vector3 TowardPlayer
        {
            get
            {
                var p = Player;
                var to = p ? p.transform.position - position : Vector3.forward;
                to.y = 0;
                return to.normalized;
            }
        }
    }

    /// <summary>奖励注册表门面：按奖励串的 key 找处理器</summary>
    public static class RewardRegistry
    {
        public static IRewardHandler Get(string key) => Registry<IRewardHandler>.Get(key);

        public static string[] Split(string reward) => string.IsNullOrEmpty(reward) ? new[] { "" } : reward.Split(':');

        public static string KeyOf(string reward) => Split(reward)[0];

        /// <summary>发放；未知的 key 打一次警告、什么都不发</summary>
        public static bool Grant(string reward, Vector3 position, LootDirector loot)
        {
            var ctx = new RewardContext(reward, position, loot);
            var h = Get(ctx.args[0]);
            if (h == null)
            {
                Debug.LogWarning($"[Reward] 未知的奖励「{reward}」");
                return false;
            }
            try { h.Grant(ctx); }
            catch (Exception e) { Debug.LogException(e); }
            return true;
        }

        public static string Hint(string reward)
        {
            var args = Split(reward);
            return Get(args[0])?.Hint(args) ?? "奖励";
        }

        public static Color Color(string reward)
        {
            var args = Split(reward);
            var h = Get(args[0]);
            return h != null ? h.Color(args) : UnityEngine.Color.white;
        }
    }
}
