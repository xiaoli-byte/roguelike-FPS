using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>首领模型的来源：正式美术 / 代理 Prefab（放大的别的模型）/ 占位胶囊</summary>
    public enum BossModelSource { Art, Proxy, Placeholder }

    /// <summary>
    /// 首领身上的一份模型（一个或几个形态共用）：首领根节点下的子物体，碰撞体已拿掉（命中走根节点的角色胶囊 + 命中区）。
    /// 显示它时根节点的体型倍率 = <see cref="scale"/>，角色胶囊换成它的尺寸（<see cref="capsuleCenter"/> 等都是根节点本地单位）
    /// </summary>
    public sealed class BossModel
    {
        public string key, prefab;
        public BossModelSource source;
        public GameObject root;
        /// <summary>显示这份模型时根节点的体型倍率</summary>
        public float scale = 1f;
        public Animator animator;
        public CreatureRig rig;
        public CreatureLocomotion locomotion;
        public Vector3 capsuleCenter;
        public float capsuleRadius, capsuleHeight;
        /// <summary>找不到形态写的弱点骨骼时先试的节点名（占位体的弱点节点）</summary>
        public string weakFallback;

        /// <summary>按名字找骨骼（包含匹配，取第一个；空名或找不到返回 null）</summary>
        public Transform FindBone(string boneName)
        {
            if (string.IsNullOrEmpty(boneName) || !root) return null;
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name.Contains(boneName))
                    return t;
            return null;
        }

        /// <summary>头骨（占位体的弱点节点 / CreatureRig 看向链的最后一节；没有 rig 时找名字含 head 的骨骼，再没有就是模型根）</summary>
        public Transform Head
        {
            get
            {
                var w = FindBone(weakFallback);
                if (w) return w;
                if (rig && rig.lookBones != null && rig.lookBones.Length > 0 && rig.lookBones[^1]) return rig.lookBones[^1];
                var h = FindBone("head");
                return h ? h : root ? root.transform : null;
            }
        }
    }

    /// <summary>
    /// 首领门面：定义来自 <see cref="Registry{T}"/>（Bosses/&lt;Id&gt;/&lt;Id&gt;Def.cs），生成走 <see cref="Spawn(BossDef, Vector3, Quaternion, float, BossArena, Transform)"/>。
    /// 生成的物体结构（和名册敌人一样挂受伤体、身体、导航、行为，但模型是子物体，方便换形）：
    ///   根节点：角色胶囊（按当前形态的模型）+ <see cref="Damageable"/>（级别 Boss）+ <see cref="EnemyBody"/> + NavMeshAgent + <see cref="BossBrain"/>（或子类）；
    ///   子物体：每个形态一份模型（同一 Prefab、同一体型的形态共用一份），只有当前形态的那份激活。
    /// 模型按形态依次找：正式美术 Prefab → 代理 Prefab × 代理倍率 → 按首领尺寸的占位胶囊（<see cref="PlaceholderBody"/>，4.11）。
    /// Prefab 先在场景的敌人目录（测试场）里找，再到 <see cref="GameDatabase"/> 里找。
    /// </summary>
    public static class Bosses
    {
        static readonly HashSet<string> warned = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => warned.Clear();

        public static BossDef Get(string id) => Registry<BossDef>.Get(id);
        public static IReadOnlyList<BossDef> All => Registry<BossDef>.All;

        /// <summary>按名字找 Prefab：场景的敌人目录 → GameDatabase；都没有返回 null</summary>
        public static GameObject FindPrefab(string prefabName)
        {
            if (string.IsNullOrEmpty(prefabName)) return null;
            var p = EnemyCatalog.Prefab(prefabName);
            return p ? p : GameDatabase.Prefab(prefabName);
        }

        /// <summary>
        /// 在场地里生成首领：位置 / 朝向取场地的首领出生点（没有场地时在原点）；arena 为 null 时按 id 找场景里的场地。
        /// difficulty ≤ 0 / 非法时用本局当前关的难度（同 <see cref="EnemyRoster.ResolveDifficulty"/>）
        /// </summary>
        public static BossBrain Spawn(string id, BossArena arena = null, float difficulty = 0, Transform parent = null)
        {
            var def = Get(id);
            if (def == null)
            {
                Debug.LogWarning($"[Boss] 没有登记首领 {id}");
                return null;
            }
            if (!arena) arena = BossArena.Find(id);
            var pos = arena ? arena.BossSpawnPoint : Vector3.zero;
            var rot = arena ? arena.BossSpawnRotation : Quaternion.identity;
            return Spawn(def, pos, rot, difficulty, arena, parent);
        }

        /// <summary>
        /// 生成一只首领（贴到导航网格上），返回它的行为组件；定义自检不通过时照样生成（问题打成警告），行为类型不可用时返回 null。
        /// 生成后登场演出开始（不可选中），GameEvents.BossSpawned 已派发
        /// </summary>
        public static BossBrain Spawn(BossDef def, Vector3 position, Quaternion rotation, float difficulty, BossArena arena = null, Transform parent = null)
        {
            if (def == null) return null;
            var problems = def.Validate();
            if (problems.Count > 0 && warned.Add("validate:" + def.id))
                Debug.LogWarning($"[Boss] {def.id} 的定义有问题：{string.Join("；", problems)}");
            if (def.brain == null || !typeof(BossBrain).IsAssignableFrom(def.brain) || def.brain.IsAbstract)
            {
                Debug.LogWarning($"[Boss] {def.id} 的行为类型 {def.brain} 不可用");
                return null;
            }
            if (def.forms.Count == 0) def.forms.Add(new BossFormDef { id = "default" });
            difficulty = EnemyRoster.ResolveDifficulty(difficulty);
            if (!float.IsFinite(position.x) || !float.IsFinite(position.y) || !float.IsFinite(position.z)) position = arena ? arena.Center : Vector3.zero;
            if (NavMesh.SamplePosition(position, out var hit, 4f, NavMesh.AllAreas)) position = hit.position;
            if (!parent && arena) parent = arena.transform.parent;

            var go = new GameObject($"{def.name} ({def.id})");
            // 先停用再搭：AddComponent 在激活的物体上会立刻跑 Awake，那时字段还没填
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(position, rotation);

            var models = new List<BossModel>();
            var byForm = new Dictionary<string, BossModel>();
            foreach (var f in def.forms)
            {
                if (f == null || string.IsNullOrEmpty(f.id)) continue;
                var (prefab, scale, source) = Resolve(def, f);
                string key = source == BossModelSource.Placeholder ? $"placeholder:{f.scale}" : $"{prefab.name}:{scale}";
                var m = models.Find(x => x.key == key);
                if (m == null)
                {
                    m = BuildModel(def, f, prefab, scale, source, go.transform, key);
                    models.Add(m);
                }
                byForm[f.id] = m;
            }
            var ff = def.FirstForm;
            if (ff == null || string.IsNullOrEmpty(ff.id) || !byForm.TryGetValue(ff.id, out var first))
            {
                Debug.LogWarning($"[Boss] {def.id} 的初始形态（forms[0]）没有 id，生成不了");
                Object.Destroy(go);
                return null;
            }
            foreach (var m in models) m.root.SetActive(m == first);
            go.transform.localScale = Vector3.one * first.scale;

            var col = go.AddComponent<CapsuleCollider>();
            col.center = first.capsuleCenter;
            col.radius = first.capsuleRadius;
            col.height = first.capsuleHeight;
            var dmg = go.AddComponent<Damageable>();
            dmg.maxHealth = def.vitals.hp;
            dmg.maxShield = def.vitals.shield;
            dmg.maxArmor = def.vitals.armor;
            dmg.displayName = def.name;
            dmg.rank = Rank.Boss;
            var body = go.AddComponent<EnemyBody>();
            body.weakBone = first.FindBone(ff.weakBone) ? ff.weakBone : first.Head ? first.Head.name : null;
            body.weakOffset = first.source == BossModelSource.Art ? ff.weakOffset : Vector3.zero;
            body.weakRadius = ff.weakRadius * (ff.scale / Mathf.Max(0.01f, first.scale));
            body.hitboxMode = HitboxMode.Capsule;
            body.despawnAfter = Mathf.Max(0.5f, def.defeat.seconds) + Mathf.Max(0, def.defeat.despawnAfter);
            body.staggerFraction = 0.08f;
            var agent = go.AddComponent<NavMeshAgent>();
            agent.radius = Mathf.Clamp(first.capsuleRadius, 0.25f, 2f);
            agent.height = Mathf.Max(0.5f, first.capsuleHeight);
            agent.baseOffset = 0;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.LowQualityObstacleAvoidance;
            agent.avoidancePriority = 10;
            var brain = (BossBrain)go.AddComponent(def.brain);
            brain.enemyId = def.id;
            brain.moveSpeed = def.speed;
            brain.damage = def.damage;
            brain.knockbackResist = 1;
            brain.def = def;
            brain.arena = arena;
            brain.models = models;
            brain.formModels = byForm;
            SetLayer(go, Layers.Character);
            go.SetActive(true);
            brain.Spawn(difficulty, false);
            if (first.locomotion) first.locomotion.Teleported();
            return brain;
        }

        /// <summary>这个形态用哪份模型：正式美术 → 代理 → 占位</summary>
        static (GameObject prefab, float scale, BossModelSource source) Resolve(BossDef def, BossFormDef f)
        {
            var art = FindPrefab(f.prefab);
            if (art) return (art, Mathf.Max(0.01f, f.scale), BossModelSource.Art);
            var proxy = FindPrefab(f.proxyPrefab);
            if (proxy)
            {
                if (warned.Add($"proxy:{def.id}:{f.id}"))
                    Debug.LogWarning($"[Boss] {def.id} 形态 {f.id} 没有美术 {f.prefab}，用代理 {f.proxyPrefab} × {f.proxyScale}");
                return (proxy, Mathf.Max(0.01f, f.proxyScale), BossModelSource.Proxy);
            }
            if (warned.Add($"placeholder:{def.id}:{f.id}"))
                Debug.LogWarning($"[Boss] {def.id} 形态 {f.id} 没有美术（{f.prefab}）也没有代理（{f.proxyPrefab}），用占位体");
            return (null, Mathf.Max(0.01f, f.scale), BossModelSource.Placeholder);
        }

        static BossModel BuildModel(BossDef def, BossFormDef f, GameObject prefab, float scale, BossModelSource source, Transform shell, string key)
        {
            GameObject inst;
            if (source == BossModelSource.Placeholder)
            {
                inst = PlaceholderBody.Create(def.ToEnemyDef(), shell.position, shell.rotation, shell);
                inst.name = $"Placeholder ({f.id})";
            }
            else
            {
                inst = Object.Instantiate(prefab, shell, false);
                inst.name = $"{prefab.name} ({f.id})";
            }
            inst.transform.localPosition = Vector3.zero;
            inst.transform.localRotation = Quaternion.identity;
            if (source == BossModelSource.Placeholder) inst.transform.localScale = Vector3.one;
            var m = new BossModel { key = key, prefab = prefab ? prefab.name : null, source = source, root = inst, scale = scale };
            if (source == BossModelSource.Placeholder) m.weakFallback = PlaceholderBody.WeakBoneName(def.ToEnemyDef());

            // 角色胶囊：取模型根上的胶囊（换算到首领根节点的本地单位），没有就按渲染包围盒，再没有按定义尺寸
            float ls = Mathf.Abs(inst.transform.localScale.x);
            var cap = inst.GetComponent<CapsuleCollider>();
            if (cap)
            {
                m.capsuleCenter = cap.center * ls;
                m.capsuleRadius = cap.radius * ls;
                m.capsuleHeight = cap.height * ls;
            }
            else if (TryRendererBounds(inst, shell, out var b))
            {
                m.capsuleHeight = Mathf.Max(0.5f, b.max.y);
                m.capsuleRadius = Mathf.Clamp(Mathf.Max(b.extents.x, b.extents.z) * 0.6f, 0.2f, m.capsuleHeight * 0.5f);
                m.capsuleCenter = new Vector3(0, m.capsuleHeight * 0.5f, 0);
            }
            else
            {
                m.capsuleRadius = Mathf.Max(0.1f, def.radius);
                m.capsuleHeight = Mathf.Max(def.height, m.capsuleRadius * 2);
                m.capsuleCenter = new Vector3(0, m.capsuleHeight * 0.5f, 0);
            }
            // 模型根上的碰撞体拿掉（命中走首领根节点）；布娃娃的部件碰撞体平时本来就关着，不动
            foreach (var c in inst.GetComponents<Collider>())
            {
                c.enabled = false;
                Object.Destroy(c);
            }
            if (source == BossModelSource.Art) AttachParts(inst);
            m.animator = inst.GetComponentInChildren<Animator>(true);
            m.rig = inst.GetComponentInChildren<CreatureRig>(true);
            m.locomotion = inst.GetComponentInChildren<CreatureLocomotion>(true);
            inst.SetActive(false);
            return m;
        }

        static bool TryRendererBounds(GameObject inst, Transform shell, out Bounds b)
        {
            b = default;
            bool any = false;
            foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer || r is TrailRenderer || r is LineRenderer) continue;
                var wb = r.bounds;
                var lo = shell.InverseTransformPoint(wb.min);
                var hi = shell.InverseTransformPoint(wb.max);
                var lb = new Bounds((lo + hi) * 0.5f, Vector3.zero);
                lb.Encapsulate(lo);
                lb.Encapsulate(hi);
                if (!any) b = lb;
                else b.Encapsulate(lb);
                any = true;
            }
            return any && b.size.y > 0.1f;
        }

        /// <summary>挂件（旱魃日轮…）：ArtAssetInfo 的 bind 对上这份模型时实例化到同名挂点下，去掉碰撞体（同 EnemyRoster）</summary>
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
                    if (t.name == "socket_" + pi.bindAttachment)
                    {
                        socket = t;
                        break;
                    }
                if (!socket) continue;
                var inst = Object.Instantiate(part, socket, false);
                inst.name = part.name;
                foreach (var c in inst.GetComponentsInChildren<Collider>(true))
                {
                    c.enabled = false;
                    Object.Destroy(c);
                }
            }
        }

        static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }
    }
}
