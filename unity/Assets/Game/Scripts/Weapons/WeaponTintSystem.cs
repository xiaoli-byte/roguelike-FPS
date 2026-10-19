using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称枪模的元素着色：切枪 / 拾枪（<see cref="GameEvents.WeaponSwitched"/>）时，按手上那把枪的实例元素与稀有度给它的 rig 着色
    /// （rig 按武器 id 共用，同 id 的两把枪切换时重新着色）。不改 WeaponController。
    /// 开局手上的枪没有切枪事件：Start 时补一次。
    /// </summary>
    [GameSystem(200)]
    public sealed class WeaponTintSystem : MonoBehaviour
    {
        void OnEnable() => GameEvents.WeaponSwitched += OnSwitched;
        void OnDisable() => GameEvents.WeaponSwitched -= OnSwitched;

        void Start()
        {
            var wc = Controller();
            if (wc) Tint(wc, wc.Active);
        }

        static WeaponController Controller() => PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<WeaponController>() : null;

        void OnSwitched(WeaponInstance prev, WeaponInstance next)
        {
            var wc = Controller();
            if (wc) Tint(wc, next);
        }

        /// <summary>给 next 对应的第一人称 rig 着色</summary>
        public static void Tint(WeaponController wc, WeaponInstance w)
        {
            if (!wc || w == null) return;
            foreach (var r in wc.rigs)
                if (r != null && r.view && r.weaponId == w.def.id) WeaponTint.Apply(r.view.gameObject, w.element, w.rarity);
        }
    }
}
