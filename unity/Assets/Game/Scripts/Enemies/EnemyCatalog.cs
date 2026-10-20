using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人 Prefab 目录（运行时拿不到 AssetDatabase）。查找顺序：场景里的 EnemyCatalog 组件（测试场还在用：<see cref="ArenaSpawner"/> 临时从这里
    /// 拿掉某个 Prefab 来强制占位体）→ 没有场景组件时回落到 <see cref="GameDatabase"/>（L1 起关卡场景不再各放一份目录）。
    /// </summary>
    public sealed class EnemyCatalog : MonoBehaviour
    {
        static EnemyCatalog instance;
        public GameObject[] prefabs = Array.Empty<GameObject>();
        /// <summary>挂件（琵琶、火球…）：ArtAssetInfo.bindSource / bindId 对上敌人本体时挂到 socket_&lt;bindAttachment&gt;</summary>
        public GameObject[] attachments = Array.Empty<GameObject>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => instance = null;

        static EnemyCatalog InScene
        {
            get
            {
                if (!instance) instance = FindFirstObjectByType<EnemyCatalog>();
                return instance;
            }
        }

        public static GameObject[] Attachments
        {
            get
            {
                var c = InScene;
                return c ? c.attachments : GameDatabase.Attachments;
            }
        }

        void Awake() => instance = this;

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        public static GameObject Prefab(string name)
        {
            var c = InScene;
            if (!c) return GameDatabase.Enemy(name);
            foreach (var p in c.prefabs)
                if (p && p.name == name) return p;
            // 场景目录只收名册敌人：首领等名册外的模型退回 GameDatabase。名册里的却不在场景目录 = 有意缺省（走占位体），不退回
            foreach (var d in EnemyRoster.All)
                if (d.prefab == name) return null;
            return GameDatabase.Enemy(name);
        }
    }
}
