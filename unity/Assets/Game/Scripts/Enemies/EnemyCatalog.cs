using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>场景里的敌人 Prefab 目录（运行时拿不到 AssetDatabase，由关卡生成器把用到的 Prefab 填进来）</summary>
    public sealed class EnemyCatalog : MonoBehaviour
    {
        static EnemyCatalog instance;
        public GameObject[] prefabs = Array.Empty<GameObject>();
        /// <summary>挂件（琵琶、火球…）：ArtAssetInfo.bindSource / bindId 对上敌人本体时挂到 socket_&lt;bindAttachment&gt;</summary>
        public GameObject[] attachments = Array.Empty<GameObject>();

        public static GameObject[] Attachments
        {
            get
            {
                if (!instance) instance = FindFirstObjectByType<EnemyCatalog>();
                return instance ? instance.attachments : Array.Empty<GameObject>();
            }
        }

        void Awake() => instance = this;

        public static GameObject Prefab(string name)
        {
            if (!instance) instance = FindFirstObjectByType<EnemyCatalog>();
            if (!instance) return null;
            foreach (var p in instance.prefabs)
                if (p && p.name == name) return p;
            return null;
        }
    }
}
