using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>掉落用的美术 Prefab 目录（地上的枪的世界模型…）：运行时拿不到 AssetDatabase，由场景生成器填</summary>
    public sealed class LootCatalog : MonoBehaviour
    {
        static LootCatalog instance;
        public GameObject[] weaponModels = Array.Empty<GameObject>();

        void Awake() => instance = this;

        public static GameObject WeaponModel(string prefab)
        {
            if (!instance) instance = FindFirstObjectByType<LootCatalog>();
            if (!instance) return null;
            foreach (var p in instance.weaponModels)
                if (p && p.name == prefab) return p;
            return null;
        }
    }
}
