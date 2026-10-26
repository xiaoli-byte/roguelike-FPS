using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效打磨 B 路的战斗事件总线（和 <see cref="FxDirector"/> 并列，不改它）：
    ///   EnemyDamaged：打在护盾上 → <see cref="ShieldBubble.Hit"/>（球壳 + 六边形涟漪）；持续伤害、处决、免疫不出；
    ///   EnemyShieldBroken → <see cref="ShieldBubble.Shatter"/>（整个球壳碎开）。
    /// 进入 Play 时 GameEvents 在 SubsystemRegistration 清空，这里在 AfterSceneLoad 登记；卸载场景时收起球壳。
    /// </summary>
    public static class FxBlastDirector
    {
        static bool installed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => installed = false;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install()
        {
            if (installed) return;
            installed = true;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.EnemyShieldBroken += OnShieldBroken;
            SceneManager.sceneUnloaded -= OnUnloaded;
            SceneManager.sceneUnloaded += OnUnloaded;
        }

        static void OnUnloaded(Scene _) => ShieldBubble.ClearAll();

        static void OnDamaged(in HitEvent e)
        {
            var d = e.enemy;
            var r = e.result;
            var info = e.info;
            if (!d || r.immune || DamageCalc.IsExecute(info) || DamageCalc.IsDot(info)) return;
            if (r.firstLayer != DamageLayer.Shield || r.shieldBroken) return;
            var p = Fx.Finite(info.point) && info.point != Vector3.zero ? info.point : FxDirector.Body(d, out _);
            ShieldBubble.Hit(d, p);
        }

        static void OnShieldBroken(Damageable d)
        {
            if (!d) return;
            ShieldBubble.Shatter(d);
        }
    }
}
