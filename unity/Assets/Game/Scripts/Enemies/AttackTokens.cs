using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出手名额（Three.js 版 src/enemies/AttackTokens.ts 的 AttackDirector）：限制同一时刻进入「前摇 / 出手」的敌人数，
    /// 并在同类两次发放之间留出最小间隔（近战 0.12 s / 远程 0.32 s / 重击 0.7 s），避免一群怪同一帧一起扑上来——玩家能读出谁要打、什么时候躲。
    ///   上限随章节放宽（章序 ch = 0..2，第一章为 0）：近战 4 + ch、远程 2 + ch、重击 第一章 1 / 之后 2；远程与重击合计另有上限 远程上限 + 1。
    ///   续期：已经持有名额的再申请（同一招的下一段、换了一类招式）直接刷新时限与类别，返回 true。
    ///   回收：名额带过期时间，持有者死亡 / 销毁而没归还时下一次申请会顺手清掉；<see cref="Reset"/> 在换关（<see cref="GameEvents.StageLoaded"/>）时清空。
    /// 第一章（1-1）的数值与原来一致：4 / 2 / 1，合计上限 3 不会比单类上限更紧。
    /// </summary>
    public static class AttackTokens
    {
        public enum Kind { Melee, Ranged, Heavy }

        /// <summary>同类两次发放之间的最小间隔（秒）</summary>
        static readonly float[] Gap = { 0.12f, 0.32f, 0.7f };
        static readonly float[] lastGrant = { -99, -99, -99 };

        struct Hold
        {
            public Kind kind;
            public float until;
        }

        static readonly Dictionary<object, Hold> holds = new();
        static readonly List<object> stale = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Reset();

        // GameEvents 在 SubsystemRegistration 时清空订阅，所以换关的订阅放到之后的阶段
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook() => GameEvents.StageLoaded += OnStageLoaded;

        static void OnStageLoaded(StageSpec s) => Reset();

        /// <summary>当前章序（0 起，夹到 0..2）：读 <see cref="RunState.Current"/>（章从 1 起）；没开局时按第一章</summary>
        public static int ChapterIndex => RunState.Current != null ? Mathf.Clamp(RunState.Current.chapter - 1, 0, 2) : 0;

        /// <summary>某类名额的同时持有上限（chapterIndex：0 起的章序）</summary>
        public static int Cap(Kind kind, int chapterIndex)
        {
            int ch = Mathf.Clamp(chapterIndex, 0, 2);
            return kind switch
            {
                Kind.Melee => 4 + ch,
                Kind.Ranged => 2 + ch,
                _ => ch == 0 ? 1 : 2,
            };
        }

        /// <summary>申请名额（按当前章、当前时间）。hold = 最长持有秒数（超时自动回收）</summary>
        public static bool Request(Kind kind, EnemyAI who, float hold) => Request(kind, who, hold, Time.time, ChapterIndex);

        /// <summary>申请名额：已持有则续期（刷新类别与时限）并返回 true；否则看最小间隔、单类上限与远程合计上限</summary>
        public static bool Request(Kind kind, object who, float hold, float now, int chapterIndex)
        {
            if (who == null || who is Object o && !o) return false;
            Prune(now);
            if (holds.ContainsKey(who))
            {
                holds[who] = new Hold { kind = kind, until = now + hold };
                return true;
            }
            int k = (int)kind;
            if (now - lastGrant[k] < Gap[k]) return false;
            int n = 0, rangedTotal = 0;
            foreach (var h in holds.Values)
            {
                if (h.kind == kind) n++;
                if (h.kind != Kind.Melee) rangedTotal++;
            }
            if (n >= Cap(kind, chapterIndex)) return false;
            // 远程与重击合计也有上限，防止两类同时满额
            if (kind != Kind.Melee && rangedTotal >= Cap(Kind.Ranged, chapterIndex) + 1) return false;
            holds[who] = new Hold { kind = kind, until = now + hold };
            lastGrant[k] = now;
            return true;
        }

        /// <summary>归还名额（出手结束、被打断、死亡）</summary>
        public static void Release(object who)
        {
            if (who != null) holds.Remove(who);
        }

        /// <summary>正持有名额</summary>
        public static bool Holding(object who) => who != null && holds.ContainsKey(who);

        /// <summary>当前持有某类名额的个数（不清理过期，测试 / 调试用）</summary>
        public static int Count(Kind kind)
        {
            int n = 0;
            foreach (var h in holds.Values)
                if (h.kind == kind) n++;
            return n;
        }

        /// <summary>全部清空（换关、测试）</summary>
        public static void Reset()
        {
            holds.Clear();
            lastGrant[0] = lastGrant[1] = lastGrant[2] = -99;
        }

        static void Prune(float now)
        {
            // 时钟回退（新开一局 Time.time 从 0 起、测试里手动传时间）时整体复位，免得旧时间戳长期卡住发放
            if (now + 1 < lastGrant[0] || now + 1 < lastGrant[1] || now + 1 < lastGrant[2])
            {
                Reset();
                return;
            }
            foreach (var (who, h) in holds)
                if (h.until <= now || who is EnemyAI e && (!e || e.Dead) || who is Object o && !o)
                    stale.Add(who);
            for (int i = 0; i < stale.Count; i++) holds.Remove(stale[i]);
            stale.Clear();
        }
    }
}
