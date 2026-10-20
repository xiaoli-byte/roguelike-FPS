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
        static readonly int TintId = Shader.PropertyToID("_Tint");

        public Damageable Health { get; private set; }
        public Animator Animator { get; private set; }
        public CreatureRig Rig { get; private set; }
        public Transform WeakPoint { get; private set; }

        CreatureRagdoll ragdoll;
        Renderer[] renderers, glowShells;
        int[] shellChannel;

        /// <summary>发光通道数（同 TS GLOW_CHANNELS）：0 = 主前摇发光；1、2 给子类区分不同招式</summary>
        public const int GlowChannels = 3;
        readonly float[] glowTarget = new float[GlowChannels], glowLevel = new float[GlowChannels];

        /// <summary>
        /// 弱点发光壳（美术的 *_GlowShell：喉囊、铜铃、弩匣、裂纹日火…）的亮度，通道 0，同 Three.js 的 glowTarget[0] / glowShell.opacity：
        /// AI 每帧按状态写目标 0..1（前摇时随蓄力升到 1——玩家看得见「要出招了」），这里按 14/s 阻尼过渡，
        /// 换算成不透明度 = base + breath·sin(t·rate) + gain·level（squared 时 level²），写进发光材质的 _Tint.a。
        /// 名字是 *_GlowShell1 / *_GlowShell2 的发光壳走通道 1 / 2；程序化发光件用 <see cref="AddGlowPart"/> 指定通道。
        /// </summary>
        public float glow
        {
            get => glowTarget[0];
            set => glowTarget[0] = value;
        }

        [System.NonSerialized] public float glowBase = 0.08f, glowBreath = 0.03f, glowRate = 2.6f, glowGain = 0.6f;
        [System.NonSerialized] public bool glowSquared = true;
        /// <summary>当前发光壳（通道 0 的公式）不透明度（测试用；没有发光壳时 -1）</summary>
        public float GlowOpacity { get; private set; } = -1;

        struct GlowPart
        {
            public Renderer r;
            public int channel;
            public Color cold, hot;
        }

        readonly System.Collections.Generic.List<GlowPart> glowParts = new();
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        /// <summary>设某个发光通道的亮度目标（0..1；通道越界时夹到 0..2）</summary>
        public void SetGlow(int channel, float target) => glowTarget[Mathf.Clamp(channel, 0, GlowChannels - 1)] = target;

        /// <summary>某个发光通道当前（阻尼过渡后）的亮度 0..1</summary>
        public float GlowLevel(int channel) => glowLevel[Mathf.Clamp(channel, 0, GlowChannels - 1)];

        /// <summary>
        /// 程序化发光件（同 TS glowPart）：颜色随通道亮度在 cold 与 hot 之间插值，写进 _BaseColor（不受光的纯色 / 加色材质）。
        /// cold 设成黑色 + 加色材质 = 平时不可见、前摇时叠加发光
        /// </summary>
        public void AddGlowPart(Renderer r, int channel, Color cold, Color hot)
        {
            if (!r) return;
            glowParts.Add(new GlowPart { r = r, channel = Mathf.Clamp(channel, 0, GlowChannels - 1), cold = cold, hot = hot });
        }

        /// <summary>发光壳的通道：名字里 GlowShell 后面紧跟 1 / 2 的走那个通道，其余为 0</summary>
        static int ShellChannel(string name)
        {
            int i = name.IndexOf("GlowShell", System.StringComparison.Ordinal);
            if (i < 0) return 0;
            int j = i + "GlowShell".Length;
            if (j < name.Length && name[j] >= '1' && name[j] < '0' + GlowChannels) return name[j] - '0';
            return 0;
        }
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
            glowShells = System.Array.FindAll(renderers, r => r.name.Contains("GlowShell"));
            shellChannel = System.Array.ConvertAll(glowShells, r => ShellChannel(r.name));
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
            // weakRadius 是设计尺寸下的半径：随根节点体型（名册 scale、精英）放大，同 Three.js 的 headRadius × sizeScale
            sphere.radius = weakRadius * transform.lossyScale.x / s;
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
            // 闪白按伤害占比：光束 / 冲锋枪的小伤害只淡淡一闪（连射时不会一直是个白影），重击、反应才全白
            float hitFlash = Mathf.Lerp(0.22f, 1f, Mathf.Clamp01(r.total / Mathf.Max(1, Health.maxHealth) * 6f));
            if (info.source == DamageSource.Status && !info.reaction) hitFlash = 0.15f;
            flash = Mathf.Max(flash, hitFlash);
            // 受击晃动按伤害占比：持续伤害（灼烧 / 蚀化跳伤、弹射）不晃，光束一跳只轻轻一晃，重击和反应才明显
            if (info.source == DamageSource.Status && !info.reaction) return;
            float strength = Mathf.Clamp01(r.total / Mathf.Max(1, Health.maxHealth) * 4f);
            if (Rig) Rig.Hit(info.direction, strength);
            if (hasHitTrigger && r.total >= Health.maxHealth * staggerFraction && !r.killed) Animator.SetTrigger(HitId);
            // 击退：武器 / 爆炸 / 反应带的击退量沿命中方向推开活着的敌人（死了的交给布娃娃）
            if (!r.killed && info.knockback > 0 && info.direction.sqrMagnitude > 1e-4f && GetComponent<EnemyAI>() is { } ai) ai.Knockback(info.direction.normalized * info.knockback);
        }

        void OnDied(DamageInfo info)
        {
            deadTime = Time.time;
            if (WeakPoint) WeakPoint.gameObject.SetActive(false);
            var dir = info.direction.sqrMagnitude > 0.01f ? info.direction.normalized : -transform.forward;
            if (ragdoll)
            {
                // 尸体初速度（米 / 秒）：普通子弹 ~1.6、爆炸 / 反应（击退 7）~5，上限 6，按击退抗性削弱——被打翻、滑出一两米，不飞
                var ai = GetComponent<EnemyAI>();
                float resist = ai ? ai.knockbackResist : 0;
                float v = Mathf.Min(6f, 1.5f + info.knockback * 0.5f) * (1 - resist * 0.6f);
                var flat = new Vector3(dir.x, 0, dir.z).normalized;
                ragdoll.ActivateWithVelocity(flat * v + Vector3.up * (0.8f + v * 0.2f), info.point);
            }
            else if (Animator) Animator.enabled = false;
        }

        void Update()
        {
            if (glowShells.Length > 0 || glowParts.Count > 0)
            {
                float k = 1 - Mathf.Exp(-14f * Time.deltaTime);
                for (int c = 0; c < GlowChannels; c++)
                    glowLevel[c] = Mathf.Lerp(glowLevel[c], Health.Dead ? 0 : Mathf.Clamp01(glowTarget[c]), k);
                float breath = glowBase + glowBreath * Mathf.Sin(Time.time * glowRate);
                if (glowShells.Length > 0) GlowOpacity = ShellOpacity(0, breath);
                for (int i = 0; i < glowShells.Length; i++)
                {
                    var r = glowShells[i];
                    if (!r) continue;
                    int c = shellChannel[i];
                    r.GetPropertyBlock(block);
                    block.SetColor(TintId, new Color(1, 1, 1, c == 0 ? GlowOpacity : ShellOpacity(c, breath)));
                    r.SetPropertyBlock(block);
                }
                foreach (var p in glowParts)
                {
                    if (!p.r) continue;
                    p.r.GetPropertyBlock(block);
                    block.SetColor(BaseColorId, Color.Lerp(p.cold, p.hot, glowLevel[p.channel]));
                    p.r.SetPropertyBlock(block);
                }
            }
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

        /// <summary>发光壳不透明度：breath = base + 呼吸项，再加 gain × 亮度（squared 时平方）</summary>
        float ShellOpacity(int channel, float breath)
        {
            float l = glowLevel[channel];
            float g = glowSquared ? l * l : l;
            return Mathf.Clamp01(breath + g * glowGain);
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
