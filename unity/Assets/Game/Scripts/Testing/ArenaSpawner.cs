using System;
using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 测试场（TestArena，docs/unity-parity.md 4.9）的刷怪台：在台面上按 id 生成任意已登记的敌人（普通 / 精英，走 <see cref="EnemyRoster.Spawn(string, Vector3, Quaternion, float, bool, SpawnOptions)"/>），
    /// 同时记着场地件的位置（出生点、武器架、坡道、高台、栖落柱、熔岩 / 冰 / 水占位条带），各单元的冒烟套件从这里取，不用按名字找。
    /// 字段由关卡构建器（Pipeline/Editor/Levels/Level_TestArena.cs）填写。
    ///
    /// 占位体（4.11）：<see cref="Spawn"/> 传 forcePlaceholder，或者 id 不在名册里时，用 <see cref="placeholderTemplate"/> 的定义生成，
    /// 两种都是临时把对应 Prefab 从场景的 <see cref="EnemyCatalog"/> 里拿掉再走 EnemyRoster 的正式占位路径（<see cref="PlaceholderBody"/>），
    /// 不另写一套生成逻辑。未登记的 id 生成出来的占位体 <see cref="PlaceholderBody.enemyId"/> 记成请求的 id，AI 仍按模板定义的行为跑。
    /// 生成的敌人都挂在本物体的 Spawned 子节点下，<see cref="Clear"/> 一次清掉（含蜃楼蟾的分身）。
    /// Play 模式里也可以在 Inspector 的右键菜单「刷一只」手动刷 <see cref="inspectorId"/>。
    /// </summary>
    public sealed class ArenaSpawner : MonoBehaviour
    {
        public static ArenaSpawner Instance { get; private set; }

        [Tooltip("台面半径（米）：不指定偏移时在台面内随机散开")]
        public float radius = 3.5f;
        [Tooltip("强度倍率（= 局难度，1 = 第一章开头）")]
        public float difficulty = 1f;
        [Tooltip("未登记的 id / 强制占位体时借用哪个定义的数值与行为")]
        public string placeholderTemplate = "jerboa_blade";

        [Header("场地件（构建器填写）")]
        public Transform playerSpawn;
        public Transform weaponRack;
        /// <summary>坡度测试台的台面（3 m），坡道 15° / 30° / 45°</summary>
        public Transform slopeDeck;
        /// <summary>坡道（与 <see cref="slopeAngles"/> 一一对应）</summary>
        public Transform[] slopes = Array.Empty<Transform>();
        public float[] slopeAngles = Array.Empty<float>();
        /// <summary>高台（与 <see cref="platformHeights"/> 一一对应：2.5 / 4 / 6 m），各带一条坡道</summary>
        public Transform[] platforms = Array.Empty<Transform>();
        public float[] platformHeights = Array.Empty<float>();
        /// <summary>栖落柱顶的落点（飞行敌人、灵宠栖落用）</summary>
        public Transform[] perches = Array.Empty<Transform>();
        /// <summary>占位条带（只是带标签的色块，Lava / Ice / Water；地表系统落地后换成正式组件）</summary>
        public Transform lavaStrip, iceStrip, waterStrip;

        [Header("Inspector 手动刷怪")]
        public string inspectorId = "jerboa_blade";
        public bool inspectorElite;

        Transform spawnRoot;
        readonly List<EnemyAI> spawned = new();

        /// <summary>本刷怪台生成过、还没销毁的敌人</summary>
        public IReadOnlyList<EnemyAI> Spawned
        {
            get
            {
                spawned.RemoveAll(e => !e);
                return spawned;
            }
        }

        /// <summary>刷怪台台面中心（地面）</summary>
        public Vector3 Center => transform.position;

        void Awake() => Instance = this;

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        /// <summary>id 是否在名册里（不在的话 <see cref="Spawn"/> 会生成占位体）</summary>
        public static bool IsRegistered(string id) => EnemyRoster.Get(id) != null;

        /// <summary>
        /// 在台面上生成一只敌人，默认面朝玩家。offset = 相对台面中心的偏移（null = 台面内随机）。
        /// 已登记的 id 走 EnemyRoster（场景里有 Prefab 用美术，没有就是占位体）；forcePlaceholder 或 id 未登记时一定是占位体。
        /// 失败（模板也不在名册里）返回 null。
        /// </summary>
        public EnemyAI Spawn(string id, bool elite = false, Vector3? offset = null, bool forcePlaceholder = false)
        {
            if (string.IsNullOrEmpty(id)) return null;
            var at = Center + (offset ?? RandomOffset());
            var rot = FacePlayer(at);
            var def = EnemyRoster.Get(id);
            EnemyAI ai;
            if (def == null)
            {
                var template = EnemyRoster.Get(placeholderTemplate);
                if (template == null)
                {
                    Debug.LogWarning($"[Arena] 名册里没有 {id}，占位模板 {placeholderTemplate} 也没有");
                    return null;
                }
                Debug.LogWarning($"[Arena] 名册里没有 {id}：按 {template.id} 的定义生成占位体");
                ai = SpawnPlaceholder(template, at, rot, elite);
                if (ai)
                {
                    ai.gameObject.name = $"未登记 ({id})";
                    var body = ai.GetComponent<PlaceholderBody>();
                    if (body) body.enemyId = id;
                }
            }
            else if (forcePlaceholder) ai = SpawnPlaceholder(def, at, rot, elite);
            else ai = EnemyRoster.Spawn(id, at, rot, difficulty, elite, new SpawnOptions { parent = Root });
            if (ai) spawned.Add(ai);
            return ai;
        }

        /// <summary>某只敌人是不是占位体</summary>
        public static bool IsPlaceholder(EnemyAI ai) => ai && ai.GetComponent<PlaceholderBody>();

        /// <summary>销毁本刷怪台生成的全部敌人（包括它们召唤出来、挂在同一节点下的分身）</summary>
        public void Clear()
        {
            spawned.Clear();
            if (!spawnRoot) return;
            for (int i = spawnRoot.childCount - 1; i >= 0; i--) Destroy(spawnRoot.GetChild(i).gameObject);
        }

        /// <summary>
        /// 强制占位体：临时把定义的 Prefab 从场景目录里拿掉，EnemyRoster 找不到 Prefab 就会生成 <see cref="PlaceholderBody"/>；生成完马上放回。
        /// </summary>
        EnemyAI SpawnPlaceholder(EnemyDef def, Vector3 at, Quaternion rot, bool elite)
        {
            var catalog = FindAnyObjectByType<EnemyCatalog>();
            var saved = catalog ? catalog.prefabs : null;
            if (catalog) catalog.prefabs = Array.FindAll(saved, p => !p || p.name != def.prefab);
            try
            {
                return EnemyRoster.Spawn(def.id, at, rot, difficulty, elite, new SpawnOptions { parent = Root });
            }
            finally
            {
                if (catalog) catalog.prefabs = saved;
            }
        }

        Transform Root
        {
            get
            {
                if (spawnRoot) return spawnRoot;
                spawnRoot = new GameObject("Spawned").transform;
                spawnRoot.SetParent(transform, false);
                return spawnRoot;
            }
        }

        Vector3 RandomOffset()
        {
            var c = Random.insideUnitCircle * radius * 0.8f;
            return new Vector3(c.x, 0, c.y);
        }

        Quaternion FacePlayer(Vector3 at)
        {
            var p = PlayerVitals.Instance;
            var dir = p ? p.transform.position - at : -transform.forward;
            dir.y = 0;
            return dir.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(dir) : transform.rotation;
        }

        [ContextMenu("刷一只（inspectorId）")]
        void SpawnFromInspector()
        {
            if (!Application.isPlaying)
            {
                Debug.LogWarning("[Arena] 进入 Play 模式后再刷怪");
                return;
            }
            Spawn(inspectorId, inspectorElite);
        }

        [ContextMenu("刷一只占位体（inspectorId）")]
        void SpawnPlaceholderFromInspector()
        {
            if (Application.isPlaying) Spawn(inspectorId, inspectorElite, null, true);
        }

        [ContextMenu("清场")]
        void ClearFromInspector()
        {
            if (Application.isPlaying) Clear();
        }
    }
}
