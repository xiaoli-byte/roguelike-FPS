using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>生成选项（同 Three.js 版 SpawnOptions 里除位置 / 精英 / 等级以外的部分）</summary>
    public sealed class SpawnOptions
    {
        /// <summary>挂到哪个物体下（场地、关卡根）</summary>
        public Transform parent;
        /// <summary>精英词缀 id（词缀框架 EN4 解释；之前忽略）</summary>
        public string affix;
    }

    /// <summary>
    /// 敌人名册门面：定义来自 <see cref="Registry{T}"/>（Enemies/Defs/*/Enemy_*.cs），外部调用（遭遇、测试、关卡生成器）不用改。
    /// 生成时实例化美术 Prefab，再按定义挂上受伤体、身体、导航与 AI——美术 Prefab 保持纯美术，不带玩法组件。
    /// 场景里没有这个 Prefab 时生成 <see cref="PlaceholderBody"/>（按定义尺寸的胶囊 + 弱点球），AI 照常运行（4.11 占位策略）。
    /// </summary>
    public static class EnemyRoster
    {
        static readonly HashSet<string> warnedPlaceholder = new();

        public static EnemyDef Get(string id) => Registry<EnemyDef>.Get(id);
        public static IReadOnlyList<EnemyDef> All => Registry<EnemyDef>.All;

        /// <summary>旧接口：整数等级（= 难度倍率），转发到 float 难度版本，数值不变</summary>
        public static EnemyAI Spawn(string id, Vector3 position, Quaternion rotation, int level, bool elite, Transform parent = null) =>
            Spawn(id, position, rotation, (float)level, elite, parent ? new SpawnOptions { parent = parent } : null);

        /// <summary>
        /// 生成一只敌人（贴到导航网格上），返回 AI；名册里没有这个 id 时返回 null。
        /// difficulty = 强度倍率（局难度，D1：1 + 0.8 × (章 − 1) + 0.16 × 关序，浮点）：生命 × difficulty（取整），伤害 × (1 + (difficulty − 1) × 0.55)。
        /// 缺省 / 非法（≤ 0、NaN）时用本局当前关的难度（<see cref="RunState.Current"/>），再没有就是 1（同 TS EnemyManager.spawn）。
        /// 级别：<see cref="Damageable.rank"/> 先取定义的 <see cref="EnemyDef.rank"/>（首领），elite 时普通升成精英。
        /// </summary>
        public static EnemyAI Spawn(string id, Vector3 position, Quaternion rotation, float difficulty, bool elite, SpawnOptions options = null)
        {
            var def = Get(id);
            if (def == null)
            {
                Debug.LogWarning($"[Enemy] 名册里没有 {id}");
                return null;
            }
            difficulty = ResolveDifficulty(difficulty);
            if (!float.IsFinite(position.x) || !float.IsFinite(position.y) || !float.IsFinite(position.z))
            {
                Debug.LogWarning($"[Enemy] 生成 {id} 的位置非法（{position}），改到原点");
                position = Vector3.zero;
            }
            var parent = options?.parent;
            var prefab = EnemyCatalog.Prefab(def.prefab);
            if (NavMesh.SamplePosition(position, out var hit, 4f, NavMesh.AllAreas)) position = hit.position;
            GameObject go;
            bool placeholder = !prefab;
            if (!placeholder)
            {
                go = Object.Instantiate(prefab, position, rotation, parent);
                go.transform.localScale = prefab.transform.localScale * def.scale;
                // 先停用再挂组件：AddComponent 在激活的物体上会立刻跑 Awake，那时字段还没填
                go.SetActive(false);
                go.name = $"{def.name} ({id})";
                AttachParts(go);
            }
            else
            {
                if (warnedPlaceholder.Add(id)) Debug.LogWarning($"[Enemy] 没有 {id} 的 Prefab（{def.prefab}），用占位体");
                go = PlaceholderBody.Create(def, position, rotation, parent);
            }
            SetLayer(go, Layers.Character);
            var dmg = go.AddComponent<Damageable>();
            dmg.maxHealth = def.hp;
            dmg.maxArmor = def.armor;
            dmg.maxShield = def.shield;
            dmg.displayName = def.name;
            dmg.rank = def.rank;
            var body = go.AddComponent<EnemyBody>();
            body.weakBone = placeholder ? PlaceholderBody.WeakBoneName(def) : def.weakBone;
            body.weakRadius = def.weakRadius;
            body.hitboxMode = def.hitboxes;
            var col = go.GetComponent<CapsuleCollider>();
            var agent = go.AddComponent<NavMeshAgent>();
            agent.radius = col ? Mathf.Clamp(col.radius, 0.25f, 1.2f) : 0.4f;
            agent.height = col ? col.height : 1.8f;
            agent.baseOffset = 0;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.MedQualityObstacleAvoidance;
            agent.avoidancePriority = Random.Range(30, 70);
            var ai = (EnemyAI)go.AddComponent(def.ai);
            ai.enemyId = id;
            ai.moveSpeed = def.speed;
            ai.damage = def.damage;
            ai.knockbackResist = def.knockbackResist;
            go.SetActive(true);
            ai.Spawn(difficulty, elite);
            var loco = go.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
            return ai;
        }

        /// <summary>生成用的难度：有限且 &gt; 0 的原样用；否则取本局当前关的难度，再没有就是 1</summary>
        public static float ResolveDifficulty(float difficulty)
        {
            if (float.IsFinite(difficulty) && difficulty > 0) return difficulty;
            float run = RunState.Current?.difficulty ?? 1f;
            return float.IsFinite(run) && run > 0 ? run : 1f;
        }

        /// <summary>挂件：同一 bind（来源 + id）的挂件实例化到同名挂点下，去掉碰撞体（命中判定走本体）</summary>
        static void AttachParts(GameObject go)
        {
            var info = go.GetComponent<ArtAssetInfo>();
            if (!info) return;
            foreach (var part in EnemyCatalog.Attachments)
            {
                var pi = part ? part.GetComponent<ArtAssetInfo>() : null;
                if (!pi || pi.bindSource != info.bindSource || pi.bindId != info.bindId) continue;
                Transform socket = null;
                foreach (var t in go.GetComponentsInChildren<Transform>(true))
                    if (t.name == "socket_" + pi.bindAttachment) { socket = t; break; }
                if (!socket) continue;
                var inst = Object.Instantiate(part, socket, false);
                inst.name = part.name;
                foreach (var c in inst.GetComponentsInChildren<Collider>(true)) Object.Destroy(c);
            }
        }

        static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => warnedPlaceholder.Clear();
    }
}
