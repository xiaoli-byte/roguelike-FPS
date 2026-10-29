using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 清场慢动作（I7「击杀慢动作」）：打死一处场地的最后一只（场地至少打过 <see cref="FeelProfile.clearSlowMoMinKills"/> 只）时，
    /// 时间压到 ×0.3 约 0.4 s（真实时间），让「这一仗打完了」有个落点。数值读 <see cref="FeelProfile"/>，缩放 1 = 关掉。
    /// 优先级比顿帧低一档：最后一击的顿帧先「咬」一下，顿帧结束后接着慢放；首领溃散的慢动作（DeathSlowMo）、暂停、过渡都压得过它。
    /// [GameSystem]：自动挂在 Game Systems 上。
    /// </summary>
    [GameSystem(126)]
    public sealed class ClearSlowMo : MonoBehaviour
    {
        public const int Priority = TimeScaleArbiter.Priority.HitStop - 10;

        TimeScaleArbiter.Handle handle;
        float until;

        /// <summary>放过几次（测试 / 套件读）</summary>
        public static int Count { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Count = 0;

        void OnEnable() => GameEvents.EncounterCleared += OnCleared;

        void OnDisable()
        {
            GameEvents.EncounterCleared -= OnCleared;
            Release();
        }

        void OnCleared(EncounterSite site)
        {
            var f = FeelProfile.Active;
            if (!site || site.Total < f.clearSlowMoMinKills || !(f.clearSlowMoScale > 0 && f.clearSlowMoScale < 1) || !(f.clearSlowMoSeconds > 0)) return;
            if (!GameStateMachine.IsPlaying) return;
            var p = PlayerVitals.Instance;
            if (p && p.Dead) return;
            Release();
            handle = TimeScaleArbiter.Request(this, f.clearSlowMoScale, Priority);
            until = Time.unscaledTime + f.clearSlowMoSeconds;
            Count++;
        }

        void Update()
        {
            if (handle == null) return;
            if (!handle.Live || Time.unscaledTime >= until) Release();
        }

        void Release()
        {
            handle?.Dispose();
            handle = null;
        }
    }
}
