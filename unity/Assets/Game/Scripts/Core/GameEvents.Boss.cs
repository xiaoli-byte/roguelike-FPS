using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// GameEvents 的首领部分（B0，docs/unity-parity.md 4.5）：登场、转阶段、换形、倒下。由 <see cref="BossBrain"/> 派发；
    /// 首领关流程（B2）、首领血条（U3）、配乐、统计订阅。分文件写，免得和其他单元在 GameEvents.cs 里冲突
    /// </summary>
    public static partial class GameEvents
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetBossStatics()
        {
            bossSpawned.Clear();
            bossPhase.Clear();
            bossForm.Clear();
            bossDefeated.Clear();
        }

        static readonly EventChannel<Action<BossBrain>> bossSpawned = new();
        static readonly EventChannel<Action<BossBrain, int>> bossPhase = new();
        static readonly EventChannel<Action<BossBrain, BossFormDef>> bossForm = new();
        static readonly EventChannel<Action<BossBrain>> bossDefeated = new();

        /// <summary>首领生成完毕（登场演出开始，数值已按难度定好）</summary>
        public static event Action<BossBrain> BossSpawned { add => bossSpawned.Add(value); remove => bossSpawned.Remove(value); }
        /// <summary>首领进入新阶段（首领, 新阶段序号：初始为 0，越过第一道阈值后为 1…），转换演出开始时派发</summary>
        public static event Action<BossBrain, int> BossPhase { add => bossPhase.Add(value); remove => bossPhase.Remove(value); }
        /// <summary>首领换了形态（首领, 新形态）：新模型已经显示、护盾 / 护甲已按形态回复；之前的形态见 <see cref="BossBrain.PreviousForm"/></summary>
        public static event Action<BossBrain, BossFormDef> BossForm { add => bossForm.Add(value); remove => bossForm.Remove(value); }
        /// <summary>首领倒下（生命归零的那一刻：招式已打断、召唤物已崩解、血条已收起；溃散演出随后播 <see cref="BossDefeatDef.seconds"/> 秒）</summary>
        public static event Action<BossBrain> BossDefeated { add => bossDefeated.Add(value); remove => bossDefeated.Remove(value); }

        public static void RaiseBossSpawned(BossBrain b) => bossSpawned.Raise(b);
        public static void RaiseBossPhase(BossBrain b, int phase) => bossPhase.Raise(b, phase);
        public static void RaiseBossForm(BossBrain b, BossFormDef form) => bossForm.Raise(b, form);
        public static void RaiseBossDefeated(BossBrain b) => bossDefeated.Raise(b);
    }
}
