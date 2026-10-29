using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 手感总表（I7；docs/feel.md）：顿帧、清场慢动作、屏效、震屏曲线、手柄瞄准辅助集中在一处。
    /// 按决定 D16「代码默认值优先」：字段的默认值就是定稿值（来源和理由写在 docs/feel.md），没有资产时用一份默认实例；
    /// 以后要在编辑器里调，就在 Resources/Feel/FeelProfile.asset 建一份覆盖（菜单 Create ▸ Spiritfire ▸ Feel Profile），不用改代码。
    /// 读的地方：<see cref="HitStop"/>（顿帧时长 / 缩放）、<see cref="ClearSlowMo"/>（清场慢动作）、<see cref="GameplayVolumes"/>（屏效）、
    /// <see cref="CameraFeel"/>（震屏曲线）、<see cref="AimAssist"/>（手柄瞄准辅助）。
    /// </summary>
    [CreateAssetMenu(menuName = "Spiritfire/Feel Profile", fileName = "FeelProfile")]
    public sealed class FeelProfile : ScriptableObject
    {
        public const string ResourcePath = "Feel/FeelProfile";

        [Header("顿帧（秒，真实时间）")]
        public float hitStopScale = HitStop.DefaultScale;
        public float killStop = HitStop.KillStop, eliteKillStop = HitStop.EliteKillStop, bossKillStop = HitStop.BossKillStop;
        public float critStop = HitStop.CritStop, reactionStop = HitStop.ReactionStop;

        [Header("清场慢动作：打死一处场地的最后一只")]
        [Tooltip("时间缩放；1 = 关掉")] public float clearSlowMoScale = 0.3f;
        [Tooltip("真实秒数")] public float clearSlowMoSeconds = 0.4f;
        [Tooltip("场地至少打过这么多只才放（两三只的小场地不放）")] public int clearSlowMoMinKills = 4;

        [Header("屏效（色差强度）")]
        public float hurtAberration = GameplayVolumes.HurtAberration;
        public float dashAberration = GameplayVolumes.DashAberration, slowAberration = GameplayVolumes.SlowAberration;

        [Header("震屏：画面幅度 = 上限 × trauma ^ 指数 × 设置")]
        [Tooltip("2 = 开头猛、收尾柔（trauma²）")] public float shakeExponent = 2f;
        [Tooltip("幅度上限（相对强度）")] public float shakeAmpMax = 1.8f;

        [Header("手柄瞄准辅助（只对右摇杆）")]
        [Tooltip("米")] public float assistRange = 45f;
        [Tooltip("准星外多少度内算「压在敌人身上」（再加上敌人身体的角半径）")] public float assistConeDeg = 4f;
        [Tooltip("压在敌人身上时的转动速度倍率")] public float assistSlowdown = 0.5f;
        [Tooltip("摇杆在动时，每帧把剩余角差拉近的比例")] public float assistPull = 0.12f;

        static FeelProfile active;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => active = null;

        /// <summary>生效的手感表：Resources/Feel/FeelProfile.asset，没有就用代码默认值</summary>
        public static FeelProfile Active
        {
            get
            {
                if (active) return active;
                active = Resources.Load<FeelProfile>(ResourcePath);
                if (!active)
                {
                    active = CreateInstance<FeelProfile>();
                    active.hideFlags = HideFlags.DontSave;
                }
                return active;
            }
        }

        /// <summary>震屏的画面幅度（未乘设置）：上限 × trauma ^ 指数，封顶</summary>
        public float ShakeAmplitude(float trauma) =>
            Mathf.Min(shakeAmpMax, CameraShake.MaxStrength * Mathf.Pow(Mathf.Clamp01(trauma), Mathf.Max(0.5f, shakeExponent)));
    }
}
