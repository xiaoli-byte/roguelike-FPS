using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人的「身体」：把美术 Prefab（Animator + CreatureRig + CreatureRagdoll + 角色胶囊）接到战斗系统上。
    ///   命中判定：根节点的角色胶囊 = 身体；弱点 = 挂在指定骨骼上的球（随动画走），命中必暴击
    ///   受击：闪白（材质 _FlashAmount）+ CreatureRig 方向性受击弹簧；重击触发 Animator「Hit」
    ///   死亡：布娃娃（冲量来自最后一击方向），随后回收；respawnAfter &gt; 0 时原地复活（打靶木桩）
    /// 行为（移动、攻击）由各敌人的 AI 组件负责，这里不管。
    /// </summary>
    [RequireComponent(typeof(Damageable))]
    public sealed class EnemyBody : MonoBehaviour
    {
        [Tooltip("弱点骨骼名（包含匹配，取第一个）；空 = 用 CreatureRig 的头骨")] public string weakBone;
        public Vector3 weakOffset;
        public float weakRadius = 0.2f;
        [Tooltip("死亡后多久回收（秒）")] public float despawnAfter = 6f;
        [Tooltip(">0：死亡后多少秒原地复活（打靶木桩）")] public float respawnAfter;
        [Tooltip("超过最大生命这个比例的单发伤害触发受击动画")] public float staggerFraction = 0.12f;

        static readonly int FlashId = Shader.PropertyToID("_FlashAmount");
        static readonly int HitId = Animator.StringToHash("Hit");

        public Damageable Health { get; private set; }
        public Animator Animator { get; private set; }
        public CreatureRig Rig { get; private set; }
        public Transform WeakPoint { get; private set; }

        CreatureRagdoll ragdoll;
        Renderer[] renderers;
        MaterialPropertyBlock block;
        float flash, deadTime = -1;
        bool hasHitTrigger;
        Vector3 home;
        Quaternion homeRot;

        void Awake()
        {
            Health = GetComponent<Damageable>();
            Animator = GetComponentInChildren<Animator>();
            Rig = GetComponentInChildren<CreatureRig>();
            ragdoll = GetComponent<CreatureRagdoll>();
            renderers = GetComponentsInChildren<Renderer>(true);
            block = new MaterialPropertyBlock();
            home = transform.position;
            homeRot = transform.rotation;
            if (Animator && Animator.runtimeAnimatorController)
                foreach (var p in Animator.parameters)
                    if (p.nameHash == HitId) hasHitTrigger = true;

            foreach (var c in GetComponents<Collider>())
            {
                var hb = c.gameObject.AddComponent<Hitbox>();
                hb.owner = Health;
            }
            BuildWeakPoint();
            Health.Damaged += OnDamaged;
            Health.Died += OnDied;
        }

        void BuildWeakPoint()
        {
            Transform bone = null;
            if (!string.IsNullOrEmpty(weakBone))
                foreach (var t in GetComponentsInChildren<Transform>(true))
                    if (t.name.Contains(weakBone)) { bone = t; break; }
            if (!bone && Rig && Rig.lookBones.Length > 0) bone = Rig.lookBones[^1];
            if (!bone) bone = transform;
            var go = new GameObject("WeakPoint");
            go.layer = Layers.Character;
            go.transform.SetParent(bone, false);
            go.transform.localPosition = weakOffset;
            // 骨骼可能带缩放：半径换算回世界尺寸
            float s = Mathf.Max(1e-3f, bone.lossyScale.x);
            var sphere = go.AddComponent<SphereCollider>();
            sphere.radius = weakRadius / s;
            sphere.isTrigger = false;
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            var hb = go.AddComponent<Hitbox>();
            hb.owner = Health;
            hb.weakpoint = true;
            WeakPoint = go.transform;
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (r.total <= 0) return;
            flash = 1f;
            float strength = Mathf.Clamp01(r.total / Mathf.Max(1, Health.maxHealth) * 4f + 0.25f);
            if (Rig) Rig.Hit(info.direction, strength);
            if (hasHitTrigger && r.total >= Health.maxHealth * staggerFraction && !r.killed) Animator.SetTrigger(HitId);
        }

        void OnDied(DamageInfo info)
        {
            deadTime = Time.time;
            if (WeakPoint) WeakPoint.gameObject.SetActive(false);
            var dir = info.direction.sqrMagnitude > 0.01f ? info.direction.normalized : -transform.forward;
            if (ragdoll) ragdoll.Activate(dir * (25f + info.knockback * 10f) + Vector3.up * 6f, info.point);
            else if (Animator) Animator.enabled = false;
        }

        void Update()
        {
            if (flash > 0)
            {
                flash = Mathf.Max(0, flash - Time.deltaTime / 0.12f);
                foreach (var r in renderers)
                {
                    if (!r) continue;
                    r.GetPropertyBlock(block);
                    block.SetFloat(FlashId, flash * 0.85f);
                    r.SetPropertyBlock(block);
                }
            }
            if (deadTime < 0) return;
            float since = Time.time - deadTime;
            if (respawnAfter > 0 && since > respawnAfter) Respawn();
            else if (respawnAfter <= 0 && since > despawnAfter) Destroy(gameObject);
        }

        public void Respawn()
        {
            deadTime = -1;
            if (ragdoll && ragdoll.Active) ragdoll.Restore();
            transform.SetPositionAndRotation(home, homeRot);
            if (WeakPoint) WeakPoint.gameObject.SetActive(true);
            Health.ResetVitals();
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }
    }
}
