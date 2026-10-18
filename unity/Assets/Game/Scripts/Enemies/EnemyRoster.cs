using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人名册：每种敌人的基础数值（Three.js 版 src/enemies/types/* 的 DEF，等级 1）与行为组件。
    /// 生成时实例化美术 Prefab，再按名册挂上受伤体、身体、导航与 AI——美术 Prefab 保持纯美术，不带玩法组件。
    /// </summary>
    public static class EnemyRoster
    {
        public sealed class Def
        {
            public string id, prefab, name;
            public float hp, armor, shield, speed, damage, knockbackResist;
            public string weakBone;
            public float weakRadius;
            public Type ai;
            public AttackTokens.Kind role;
        }

        static readonly Dictionary<string, Def> defs = new()
        {
            ["jerboa_blade"] = new Def
            {
                id = "jerboa_blade", prefab = "SK_Enemy_JerboaBlade", name = "跳鼠刀兵", hp = 42, speed = 7, damage = 9,
                weakBone = "bell", weakRadius = 0.17f, ai = typeof(JerboaBladeAI),
            },
            ["scorpion_archer"] = new Def
            {
                id = "scorpion_archer", prefab = "SK_Enemy_ScorpionArcher", name = "蝎尾弩卫", hp = 120, speed = 3.4f, damage = 11,
                knockbackResist = 0.5f, weakBone = "sac", weakRadius = 0.26f, ai = typeof(ScorpionArcherAI), role = AttackTokens.Kind.Ranged,
            },
            ["mirage_toad"] = new Def
            {
                id = "mirage_toad", prefab = "SK_Enemy_MirageToad", name = "蜃楼蟾", hp = 170, speed = 2.6f, damage = 24,
                knockbackResist = 0.7f, weakBone = "sac", weakRadius = 0.42f, ai = typeof(MirageToadAI), role = AttackTokens.Kind.Heavy,
            },
            ["mirage_toad_decoy"] = new Def
            {
                id = "mirage_toad_decoy", prefab = "SK_Enemy_MirageToad", name = "蜃景", hp = 30, speed = 2.6f, damage = 0,
                knockbackResist = 0.3f, weakBone = "sac", weakRadius = 0.42f, ai = typeof(MirageToadAI), role = AttackTokens.Kind.Heavy,
            },
            ["tomb_beast"] = new Def
            {
                id = "tomb_beast", prefab = "SK_Enemy_TombBeast", name = "三彩镇墓兽", hp = 640, armor = 160, speed = 2.2f, damage = 42,
                knockbackResist = 1f, weakBone = "crack", weakRadius = 0.42f, ai = typeof(TombBeastAI), role = AttackTokens.Kind.Heavy,
            },
            ["apsara"] = new Def
            {
                id = "apsara", prefab = "SK_Enemy_Apsara", name = "邪飞天", hp = 170, speed = 4.2f, damage = 0,
                knockbackResist = 0.3f, weakBone = "socket_pipa", weakRadius = 0.3f, ai = typeof(ApsaraAI), role = AttackTokens.Kind.Ranged,
            },
            ["fire_rat"] = new Def
            {
                id = "fire_rat", prefab = "SK_Enemy_FireRat", name = "火浣鼠", hp = 26, speed = 6, damage = 26,
                weakBone = "spine", weakRadius = 0.3f, ai = typeof(FireRatAI),
            },
        };

        public static Def Get(string id) => defs.TryGetValue(id, out var d) ? d : null;
        public static IEnumerable<Def> All => defs.Values;

        /// <summary>生成一只敌人（贴到导航网格上），返回 AI；Prefab 缺失时返回 null</summary>
        public static EnemyAI Spawn(string id, Vector3 position, Quaternion rotation, int level, bool elite, Transform parent = null)
        {
            var def = Get(id);
            var prefab = def != null ? EnemyCatalog.Prefab(def.prefab) : null;
            if (!prefab)
            {
                Debug.LogWarning($"[Enemy] 没有 {id} 的 Prefab");
                return null;
            }
            if (NavMesh.SamplePosition(position, out var hit, 4f, NavMesh.AllAreas)) position = hit.position;
            var go = UnityEngine.Object.Instantiate(prefab, position, rotation, parent);
            // 先停用再挂组件：AddComponent 在激活的物体上会立刻跑 Awake，那时字段还没填
            go.SetActive(false);
            go.name = $"{def.name} ({id})";
            AttachParts(go);
            SetLayer(go, Layers.Character);
            var dmg = go.AddComponent<Damageable>();
            dmg.maxHealth = def.hp;
            dmg.maxArmor = def.armor;
            dmg.maxShield = def.shield;
            dmg.displayName = def.name;
            var body = go.AddComponent<EnemyBody>();
            body.weakBone = def.weakBone;
            body.weakRadius = def.weakRadius;
            var col = go.GetComponent<CapsuleCollider>();
            var agent = go.AddComponent<NavMeshAgent>();
            agent.radius = col ? Mathf.Clamp(col.radius, 0.25f, 1.2f) : 0.4f;
            agent.height = col ? col.height : 1.8f;
            agent.baseOffset = 0;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.MedQualityObstacleAvoidance;
            agent.avoidancePriority = UnityEngine.Random.Range(30, 70);
            var ai = (EnemyAI)go.AddComponent(def.ai);
            ai.enemyId = id;
            ai.moveSpeed = def.speed;
            ai.damage = def.damage;
            ai.knockbackResist = def.knockbackResist;
            go.SetActive(true);
            ai.Spawn(level, elite);
            var loco = go.GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
            return ai;
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
                var inst = UnityEngine.Object.Instantiate(part, socket, false);
                inst.name = part.name;
                foreach (var c in inst.GetComponentsInChildren<Collider>(true)) UnityEngine.Object.Destroy(c);
            }
        }

        static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }
    }
}
