using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 武器架（测试便利）：开局在这里摆几把地上的枪，按 F 换着试。正式流程里武器只从宝箱 / 商店来，做完随机掉落后撤掉。
    /// 枪沿本物体的右方向一字排开，间距 spacing 米。
    /// </summary>
    public sealed class WeaponRack : MonoBehaviour
    {
        public string[] weapons = { "revolver", "shotgun", "launcher" };
        public float spacing = 1.6f;

        void Start()
        {
            float start = -(weapons.Length - 1) * spacing * 0.5f;
            for (int i = 0; i < weapons.Length; i++)
            {
                var def = WeaponLibrary.Get(weapons[i]);
                if (def == null) continue;
                var p = transform.position + transform.right * (start + i * spacing) + Vector3.up * 0.6f;
                WeaponPickup.Drop(new WeaponInstance(def), p, Vector3.zero);
            }
        }
    }
}
