using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 手柄瞄准辅助（I7）：只在右摇杆转视角时介入（<see cref="PlayerMotor.StickAssist"/>），鼠标完全不受影响。两件事：
    ///   · 减速：准星压在敌人身上（准星到身体中心的角差 ≤ 身体角半径 + <see cref="FeelProfile.assistConeDeg"/>）时，转动速度乘 assistSlowdown，
    ///     越靠近中心减得越多——摇杆扫过敌人时会「黏」一下，不容易甩过头；
    ///   · 吸附：摇杆在动的帧，把剩余角差拉近 assistPull（随摇杆幅度、离中心远近衰减），不动摇杆就不拉（不替玩家瞄）。
    /// 候选：45 m 内、看得见（<see cref="EnemyRegistry.Nearest"/> 带视线）的可选中敌人里，离准星角差最小的那只。设置「手柄瞄准辅助」关掉就不介入。
    /// [GameSystem]：自动挂在 Game Systems 上。
    /// </summary>
    [GameSystem(127)]
    public sealed class AimAssist : MonoBehaviour
    {
        readonly List<EnemyAI> near = new();
        System.Func<Vector2, Transform, Vector2> hook;

        /// <summary>上一次介入时选中的目标（测试 / 调试读）</summary>
        public EnemyAI LastTarget { get; private set; }

        void OnEnable() => PlayerMotor.StickAssist = hook ??= Assist;

        void OnDisable()
        {
            if (PlayerMotor.StickAssist == hook) PlayerMotor.StickAssist = null;
        }

        Vector2 Assist(Vector2 delta, Transform eye)
        {
            LastTarget = null;
            if (!GameSettings.AimAssist.Bool) return delta;
            var f = FeelProfile.Active;
            int n = EnemyRegistry.Nearest(eye.position, f.assistRange, 8, near, EnemyQuery.Targetable, needSight: true);
            float best = float.MaxValue, bestCone = 0;
            Vector2 err = default;
            for (int i = 0; i < n; i++)
            {
                var e = near[i];
                var to = EnemyRegistry.Center(e) - eye.position;
                float dist = to.magnitude;
                if (dist < 0.5f) continue;
                var local = eye.InverseTransformDirection(to / dist);
                if (local.z <= 0) continue;
                // 角差（度）：x = 往右转多少，y = 往上转多少
                var e2 = new Vector2(Mathf.Atan2(local.x, local.z), Mathf.Atan2(local.y, new Vector2(local.x, local.z).magnitude)) * Mathf.Rad2Deg;
                float cone = Mathf.Atan2(EnemyRegistry.BodyRadius(e), dist) * Mathf.Rad2Deg + f.assistConeDeg;
                float off = e2.magnitude;
                if (off > cone || off >= best) continue;
                best = off;
                bestCone = cone;
                err = e2;
                LastTarget = e;
            }
            return LastTarget ? Apply(delta, err, bestCone, f.assistSlowdown, f.assistPull) : delta;
        }

        /// <summary>
        /// 纯计算（EditMode 测试用）：delta = 这一帧摇杆给的视角增量（度），err = 准星到目标中心的角差（度），cone = 生效半径（度）。
        /// 越靠近中心减速越多；吸附量 ≤ 剩余角差（不会拉过头），随摇杆幅度（每帧 2° 封顶）增大
        /// </summary>
        public static Vector2 Apply(Vector2 delta, Vector2 err, float cone, float slowdown, float pull)
        {
            float k = 1 - Mathf.Clamp01(err.magnitude / Mathf.Max(1e-3f, cone));
            var d = delta * Mathf.Lerp(1, slowdown, k);
            float drive = Mathf.Clamp01(delta.magnitude / 2f);
            var tug = err * (pull * drive * Mathf.Lerp(0.4f, 1f, k));
            if (tug.sqrMagnitude > err.sqrMagnitude) tug = err;
            return d + tug;
        }
    }
}
