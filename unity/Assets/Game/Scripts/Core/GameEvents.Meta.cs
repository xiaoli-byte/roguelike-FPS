using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>GameEvents 的局外部分（R2）：一局结束（魂晶已入账、生涯已记下）、局外存档变化</summary>
    public static partial class GameEvents
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetMetaStatics()
        {
            runEnded.Clear();
            metaChanged.Clear();
        }

        static readonly EventChannel<Action<RunSummary>> runEnded = new();
        static readonly EventChannel<Action<MetaSave>> metaChanged = new();

        /// <summary>
        /// 一局结束（阵亡 / 放弃 / 通关）：由 <see cref="MetaSave.BankRun"/> 在魂晶入账、生涯记录、写盘之后派发，结算界面据此显示。
        /// 每局只发一次（重复 BankRun 不再发）
        /// </summary>
        public static event Action<RunSummary> RunEnded { add => runEnded.Add(value); remove => runEnded.Remove(value); }

        /// <summary>局外存档变了（魂晶、天赋等级、英雄解锁）：主菜单 / 天赋面板刷新</summary>
        public static event Action<MetaSave> MetaChanged { add => metaChanged.Add(value); remove => metaChanged.Remove(value); }

        public static void RaiseRunEnded(RunSummary s) => runEnded.Raise(s);
        public static void RaiseMetaChanged(MetaSave m) => metaChanged.Raise(m);
    }
}
