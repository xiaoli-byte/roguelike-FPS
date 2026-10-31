using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 领主梯度的一档（<see cref="LordScaling.For"/>）：这是这张图里第几个打的领主（0 起）和由它推出的倍率（C4-6，combat 5.2）。
    ///   血 × (1 + 0.15 n)、收招 × (1 − 0.1 n)、n = 2 时每阶段多一招变体（夔的雷掌接小跳、飞廉冲撞接风刃、化蛇扑岸接翼拍浪）。
    /// </summary>
    public readonly struct LordTier
    {
        /// <summary>第几个打的（0, 1, 2…；不按梯度的为 0）</summary>
        public readonly int index;

        public LordTier(int index) => this.index = Mathf.Max(0, index);

        /// <summary>血量倍率 1 + 0.15 n</summary>
        public float HpMult => 1f + LordScaling.HpStep * index;
        /// <summary>收招（招式间喘息、收招段）倍率 1 − 0.1 n（下限 0.5）</summary>
        public float RecoveryMult => Mathf.Max(0.5f, 1f - LordScaling.RecoveryStep * index);
        /// <summary>每阶段多一招变体（n ≥ 2）</summary>
        public bool ExtraVariant => index >= LordScaling.VariantFrom;

        public override string ToString() => $"第 {index + 1} 个领主（血 ×{HpMult:0.00}、收招 ×{RecoveryMult:0.00}{(ExtraVariant ? "、加变体" : "")}）";
    }

    /// <summary>
    /// 领主梯度（第四章 4-1 三领主，C4-6；docs/unity-ch4-port.md 第 2 节契约）：4-1 的据点任意顺序，领主的难度按「这张图里已经打败了几个领主」动态定，
    /// 不按地图位置排。打败的记录存在本局 <see cref="RunState.flags"/>（<c>lord.&lt;图&gt;.&lt;首领 id&gt;</c>），所以重来本关时回到进关时的快照、中途存档也带着。
    ///   · 读：<see cref="For"/>(levelId) —— 开打时调一次（登场前），按返回的 <see cref="LordTier"/> 改血量、收招、变体；
    ///   · 写：首领定义 <see cref="BossDef.lordLevel"/> 不为空的首领倒下时自动记（<see cref="GameEvents.BossDefeated"/>），也可以手动 <see cref="RecordDefeat"/>。
    ///   · 转阶段只出横幅、不接管镜头：<see cref="BossDef.phaseCinematic"/> = false（4-1 三领主）。
    /// </summary>
    public static class LordScaling
    {
        public const float HpStep = 0.15f, RecoveryStep = 0.1f;
        public const int VariantFrom = 2;
        const string Prefix = "lord.";

        /// <summary>某张图（关卡 id，如「4-1」）里已经打败了几个领主 → 下一个是第几个</summary>
        public static LordTier For(string levelId) => new(Defeated(levelId));

        /// <summary>某个首领的梯度：它的 <see cref="BossDef.lordLevel"/> 为空时是 0 档（不按梯度）</summary>
        public static LordTier For(BossDef def) => def == null || string.IsNullOrEmpty(def.lordLevel) ? new LordTier(0) : For(def.lordLevel);

        /// <summary>某张图里已经打败的领主数（本局；没开局为 0）</summary>
        public static int Defeated(string levelId)
        {
            var run = RunState.Current;
            if (run?.flags == null || string.IsNullOrEmpty(levelId)) return 0;
            string p = Prefix + levelId + ".";
            int n = 0;
            foreach (var kv in run.flags)
                if (kv.Value > 0 && kv.Key.StartsWith(p, StringComparison.Ordinal))
                    n++;
            return n;
        }

        /// <summary>这个领主在这张图里打败过了</summary>
        public static bool IsDefeated(string levelId, string bossId) =>
            !string.IsNullOrEmpty(levelId) && !string.IsNullOrEmpty(bossId) && (RunState.Current?.Flag(Key(levelId, bossId)) ?? 0) > 0;

        /// <summary>记一次打败（同一个领主只算一次）；没开局时什么都不做</summary>
        public static void RecordDefeat(string levelId, string bossId)
        {
            var run = RunState.Current;
            if (run == null || string.IsNullOrEmpty(levelId) || string.IsNullOrEmpty(bossId)) return;
            run.SetFlag(Key(levelId, bossId), 1);
        }

        static string Key(string levelId, string bossId) => Prefix + levelId + "." + bossId;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook() => GameEvents.BossDefeated += OnBossDefeated;

        static void OnBossDefeated(BossBrain b)
        {
            var d = b ? b.Def : null;
            if (d != null && !string.IsNullOrEmpty(d.lordLevel)) RecordDefeat(d.lordLevel, d.id);
        }
    }
}
