using System;
using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>
    /// 运行时的美术 Prefab 目录（docs/unity-parity.md 4.6，L1）：运行时没有 AssetDatabase，玩家、掉落、敌人要用的 Prefab 都登记在这里。
    ///   武器模型（第一人称 rig 与地上的掉落共用）· 英雄手臂 · 敌人本体 · 敌人挂件（琵琶、火球…，按 ArtAssetInfo 的 bind 挂到 socket）。
    /// 资产在 Assets/Game/Resources/GameDatabase.asset，由编辑器生成（Spiritfire ▸ Levels ▸ Build Core Scene，或 bridge.sh core / levels），
    /// 不手改：新武器 / 英雄 / 敌人登记进注册表后重新生成一次即可。
    /// 查找一律按 Prefab 名（= 美术 id，如 SM_Weapon_Smg、SM_Arms_RedPandaR）。场景里的 <see cref="EnemyCatalog"/> / <see cref="LootCatalog"/>
    /// 优先（测试场靠它强制占位体），场景里没有时才回落到这里。
    /// </summary>
    public sealed class GameDatabase : ScriptableObject
    {
        /// <summary>Resources.Load 路径</summary>
        public const string ResourcePath = "GameDatabase";
        /// <summary>资产路径（编辑器生成）</summary>
        public const string AssetPath = "Assets/Game/Resources/GameDatabase.asset";

        [Tooltip("武器模型：第一人称 rig 与地上的掉落共用（WeaponDef.prefab）")]
        public GameObject[] weapons = Array.Empty<GameObject>();
        [Tooltip("英雄第一人称手臂（HeroDef.armR / armL，以及 Art/Prefabs 下全部 SM_Arms_*）")]
        public GameObject[] arms = Array.Empty<GameObject>();
        [Tooltip("敌人本体（EnemyDef.prefab）")]
        public GameObject[] enemies = Array.Empty<GameObject>();
        [Tooltip("敌人挂件（ArtAssetInfo.bindAttachment 不为空的 Prefab）")]
        public GameObject[] attachments = Array.Empty<GameObject>();

        static GameDatabase instance;
        static bool loaded;
        static readonly HashSet<string> warned = new();
        Dictionary<string, GameObject> byName;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            loaded = false;
            warned.Clear();
        }

        /// <summary>当前目录（第一次访问时从 Resources 读；没生成过时为 null，调用方按「没有 Prefab」处理）</summary>
        public static GameDatabase Instance
        {
            get
            {
                if (!loaded)
                {
                    loaded = true;
                    instance = Resources.Load<GameDatabase>(ResourcePath);
                }
                return instance;
            }
        }

        /// <summary>测试 / 编辑器工具换一份目录（null = 下次访问重新从 Resources 读）</summary>
        public static void Override(GameDatabase db)
        {
            instance = db;
            loaded = db;
        }

        void OnEnable() => byName = null;

        /// <summary>编辑器生成器改完数组后调：清掉按名索引</summary>
        public void Invalidate() => byName = null;

        GameObject Lookup(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            if (byName == null)
            {
                byName = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (var list in new[] { weapons, arms, enemies, attachments })
                    if (list != null)
                        foreach (var p in list)
                            if (p && !byName.ContainsKey(p.name)) byName[p.name] = p;
            }
            return byName.TryGetValue(name, out var go) ? go : null;
        }

        static GameObject Find(GameObject[] list, string name)
        {
            if (list == null || string.IsNullOrEmpty(name)) return null;
            foreach (var p in list)
                if (p && p.name == name) return p;
            return null;
        }

        /// <summary>任意分类里按名找 Prefab；没有则 null</summary>
        public static GameObject Prefab(string name)
        {
            var db = Instance;
            return db ? db.Lookup(name) : null;
        }

        /// <summary>武器模型（按 Prefab 名）</summary>
        public static GameObject Weapon(string name) => Instance ? Find(Instance.weapons, name) : null;

        /// <summary>敌人本体（按 Prefab 名）</summary>
        public static GameObject Enemy(string name) => Instance ? Find(Instance.enemies, name) : null;

        /// <summary>敌人挂件全表</summary>
        public static GameObject[] Attachments => Instance ? Instance.attachments ?? Array.Empty<GameObject>() : Array.Empty<GameObject>();

        /// <summary>
        /// 运行时实例化一个 Prefab 挂到 parent 下（本地坐标归零），名字去掉「(Clone)」；目录里没有时打一次警告并返回 null。
        /// 是 <see cref="PlayerFactory"/> 的默认 <see cref="PrefabPlacer"/>（编辑器里由 PlayerRigBuilder 换成保留 Prefab 连接的版本）。
        /// </summary>
        public static GameObject Place(string prefabId, Transform parent)
        {
            if (string.IsNullOrEmpty(prefabId)) return null;
            var prefab = Prefab(prefabId);
            if (!prefab)
            {
                if (warned.Add(prefabId))
                    Debug.LogWarning(Instance
                        ? $"[GameDatabase] 目录里没有 Prefab {prefabId}（重新生成：Spiritfire ▸ Levels ▸ Build Core Scene，或 bridge.sh core）"
                        : $"[GameDatabase] 没有 {AssetPath}（先跑 bridge.sh core 生成），{prefabId} 用不了");
                return null;
            }
            var go = Object.Instantiate(prefab, parent, false);
            go.name = prefab.name;
            return go;
        }
    }
}
