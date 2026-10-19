using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉落用的美术 Prefab 目录（地上的枪的世界模型…）：运行时拿不到 AssetDatabase，由场景生成器按武器表（<see cref="WeaponLibrary"/>）填。
    /// 查找按 Prefab 名（<see cref="WeaponModel"/>）或武器 id（<see cref="WeaponModelFor"/>，经武器注册表换成 Prefab 名）。
    /// </summary>
    public sealed class LootCatalog : MonoBehaviour
    {
        static LootCatalog instance;
        public GameObject[] weaponModels = Array.Empty<GameObject>();

        void Awake() => instance = this;

        public static GameObject WeaponModel(string prefab)
        {
            if (string.IsNullOrEmpty(prefab)) return null;
            if (!instance) instance = FindFirstObjectByType<LootCatalog>();
            if (!instance) return null;
            foreach (var p in instance.weaponModels)
                if (p && p.name == prefab) return p;
            return null;
        }

        /// <summary>按武器 id 找世界模型（武器表里登记的 prefab）</summary>
        public static GameObject WeaponModelFor(string weaponId) => WeaponModel(WeaponLibrary.Get(weaponId)?.prefab);

        /// <summary>武器表里有、目录里却没有模型的武器 id（场景生成器 / 验收报告用）</summary>
        public static System.Collections.Generic.List<string> MissingWeaponModels()
        {
            var missing = new System.Collections.Generic.List<string>();
            foreach (var def in WeaponLibrary.All)
                if (!WeaponModel(def.prefab)) missing.Add(def.id);
            return missing;
        }
    }
}
