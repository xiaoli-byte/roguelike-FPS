using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人的「身体」：把美术 Prefab（Animator + CreatureRig + CreatureRagdoll + 角色胶囊）接到战斗系统上。
    ///   命中判定（<see cref="HitZone"/>，多段命中区）：
    ///     <see cref="HitboxMode.Capsule"/>（默认，第一章 6 种）：根节点的角色胶囊 = 身体区「body」；弱点区「weak」= 挂在指定骨骼上的球（随动画走），命中必暴击。
    ///       命中扫描 / 投射物的弱点规则（先进身体胶囊、1.5 m 内穿过弱点球就算弱点）结果与原来一致。
    ///     <see cref="HitboxMode.Ragdoll"/>：存活时把布娃娃的骨骼胶囊当命中盒（物理不动：运动学、不参与碰撞，不挡玩家），每根骨骼一个区；
    ///       角色胶囊挪到 Ignore Raycast 层，只挡路、不挡子弹。弱点球照旧。
    ///     伤害落在哪一区按命中点判（<see cref="ZoneAt"/>），区的倍率在 <see cref="Damageable.Incoming"/> 里结算，每一下发 ZoneDamaged。
    ///     <see cref="SetWeakPoint(Transform, Vector3, float)"/> 运行时把弱点挪到别的骨骼 / 改半径（炉门开合、宝珠换位）。
    ///   受击：闪白（材质 _FlashAmount）+ CreatureRig 方向性受击弹簧；重击触发 Animator「Hit」
    ///   着色通道（<see cref="SetTint"/> / <see cref="SetOverlay"/>）：多个来源各占一个通道——_Tint 各通道相乘（蜃景的半透明、词缀底色），
    ///     _FlashColor / _FlashAmount 取最强的覆盖色（状态 / 招式提示），受击闪白压在最上面；发光壳的 _Tint 归发光通道，不参与。
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
        [Tooltip("命中区的生成方式：角色胶囊 + 弱点球 / 存活时用布娃娃胶囊")] public HitboxMode hitboxMode = HitboxMode.Capsule;

        static readonly int FlashId = Shader.PropertyToID("_FlashAmount");
        static readonly int FlashColorId = Shader.PropertyToID("_FlashColor");
        static readonly int HitId = Animator.StringToHash("Hit");
        static readonly int TintId = Shader.PropertyToID("_Tint");

        public Damageable Health { get; private set; }
        public Animator Animator { get; private set; }
        public CreatureRig Rig { get; private set; }
        public Transform WeakPoint { get; private set; }
        /// <summary>弱点区（弱点球上的命中区）</summary>
        public HitZone WeakZone { get; private set; }
        /// <summary>实际用的命中区方式（Ragdoll 但没有布娃娃时退回 Capsule）</summary>
        public HitboxMode HitboxModeInUse { get; private set; }

        CreatureRagdoll ragdoll;
        Renderer[] renderers, glowShells;
        int[] shellChannel;

        // ───────────── 发光通道 ─────────────

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

        [NonSerialized] public float glowBase = 0.08f, glowBreath = 0.03f, glowRate = 2.6f, glowGain = 0.6f;
        [NonSerialized] public bool glowSquared = true;
        /// <summary>当前发光壳（通道 0 的公式）不透明度（测试用；没有发光壳时 -1）</summary>
        public float GlowOpacity { get; private set; } = -1;

        struct GlowPart
        {
            public Renderer r;
            public int channel;
            public Color cold, hot;
        }

        readonly List<GlowPart> glowParts = new();
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
            int i = name.IndexOf("GlowShell", StringComparison.Ordinal);
            if (i < 0) return 0;
            int j = i + "GlowShell".Length;
            if (j < name.Length && name[j] >= '1' && name[j] < '0' + GlowChannels) return name[j] - '0';
            return 0;
        }

        MaterialPropertyBlock block;
        float flash, deadTime = -1;
        bool hasHitTrigger, flashDirty;
        Vector3 home;
        Quaternion homeRot;

        void Awake()
        {
            Health = GetComponent<Damageable>();
            Animator = GetComponentInChildren<Animator>();
            Rig = GetComponentInChildren<CreatureRig>();
            ragdoll = GetComponent<CreatureRagdoll>();
            renderers = GetComponentsInChildren<Renderer>(true);
            glowShells = Array.FindAll(renderers, r => r.name.Contains("GlowShell"));
            shellChannel = Array.ConvertAll(glowShells, r => ShellChannel(r.name));
            block = new MaterialPropertyBlock();
            home = transform.position;
            homeRot = transform.rotation;
            if (Animator && Animator.runtimeAnimatorController)
                foreach (var p in Animator.parameters)
                    if (p.nameHash == HitId) hasHitTrigger = true;

            HitboxModeInUse = hitboxMode == HitboxMode.Ragdoll && ragdoll && ragdoll.parts.Length > 0 ? HitboxMode.Ragdoll : HitboxMode.Capsule;
            foreach (var c in GetComponents<Collider>())
            {
                HitZone.Create(c, Health, this, "body");
                // 布娃娃命中盒：角色胶囊只挡路（Ignore Raycast 层不在子弹的层里），子弹打在骨骼胶囊上
                if (HitboxModeInUse == HitboxMode.Ragdoll) c.gameObject.layer = Layers.IgnoreRaycast;
            }
            if (HitboxModeInUse == HitboxMode.Ragdoll) BuildRagdollZones();
            BuildWeakPoint();
            Health.Damaged += OnDamaged;
            Health.Died += OnDied;
            ZonesChanged();
        }

        // ───────────── 命中区 ─────────────

        readonly List<HitZone> zones = new();
        IDisposable zoneModifier;

        /// <summary>命中点离碰撞体多远以内算落在这一区（米）：命中点在表面上，留一点浮点余量</summary>
        public const float ZoneTolerance = 0.08f;
        /// <summary>容差内一个区都没有时（投射物起点就和身体重叠、技能给的命中点在身体外），退而取这个距离内最近的普通区</summary>
        public const float ZoneFallback = 0.5f;

        /// <summary>这只敌人身上的命中区</summary>
        public IReadOnlyList<HitZone> Zones => zones;

        /// <summary>按 id 找命中区（没有返回 null）</summary>
        public HitZone Zone(string id)
        {
            foreach (var z in zones)
                if (z && z.id == id) return z;
            return null;
        }

        internal void RegisterZone(HitZone z)
        {
            if (!z || zones.Contains(z)) return;
            zones.Add(z);
            ZonesChanged();
        }

        internal void UnregisterZone(HitZone z)
        {
            if (zones.Remove(z)) ZonesChanged();
        }

        /// <summary>有区的倍率不是 1 时才挂敌人侧的承伤修饰（第一章的身体 / 弱点区都是 1：不挂，结算路径与原来一致）</summary>
        internal void ZonesChanged()
        {
            if (!Health) return;
            bool need = false;
            foreach (var z in zones)
                if (z && z.AffectsDamage)
                {
                    need = true;
                    break;
                }
            if (need && zoneModifier == null) zoneModifier = Health.Incoming.Add(ZoneIncoming);
            else if (!need && zoneModifier != null)
            {
                zoneModifier.Dispose();
                zoneModifier = null;
            }
        }

        float ZoneIncoming(in IncomingHit h)
        {
            var z = ZoneAt(h.info);
            return z ? z.MultiplierFor(h.info) : 1f;
        }

        /// <summary>
        /// 这一击落在哪个命中区：按命中点（碰撞体表面 / 内部，容差 <see cref="ZoneTolerance"/>）找，优先级高的先，同优先级取近的。
        /// 弱点命中先在弱点区里找；非弱点命中不落在弱点区（朝向门没过的弱点按普通部位算，落到它外面那一区）。
        /// 容差内没有时退而取 <see cref="ZoneFallback"/> 内最近的普通区。持续伤害、没有命中点的不算区
        /// </summary>
        public HitZone ZoneAt(in DamageInfo info)
        {
            if (zones.Count == 0 || info.source == DamageSource.Status) return null;
            var p = info.point;
            if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)) return null;
            if (info.weakpoint)
            {
                var w = Pick(p, true, ZoneTolerance);
                if (w) return w;
            }
            var z = Pick(p, false, ZoneTolerance);
            return z ? z : Pick(p, false, ZoneFallback, true);
        }

        HitZone Pick(Vector3 p, bool weakZones, float within, bool nearestOnly = false)
        {
            HitZone best = null;
            float bestD = float.PositiveInfinity;
            foreach (var z in zones)
            {
                if (!z || !z.Active || z.weakpoint != weakZones) continue;
                float d = z.Distance(p);
                if (d > within) continue;
                if (nearestOnly)
                {
                    if (d >= bestD) continue;
                    best = z;
                    bestD = d;
                    continue;
                }
                if (best && (z.priority < best.priority || (z.priority == best.priority && d >= bestD))) continue;
                best = z;
                bestD = d;
            }
            return best;
        }

        /// <summary>存活时用布娃娃的骨骼胶囊做命中区（每根骨骼一个，id = 骨骼名），不挡玩家</summary>
        void BuildRagdollZones()
        {
            ragdoll.SetAliveHitboxes(true);
            foreach (var p in ragdoll.parts)
                if (p.collider)
                {
                    p.collider.gameObject.layer = Layers.Character;
                    HitZone.Create(p.collider, Health, this, p.collider.name, 1f, false, 1);
                }
            IgnorePlayer(true);
        }

        /// <summary>存活的骨骼胶囊不挡玩家的角色控制器（物理上只有角色胶囊挡路）；死后的布娃娃照常和玩家碰撞</summary>
        void IgnorePlayer(bool ignore)
        {
            if (HitboxModeInUse != HitboxMode.Ragdoll || !ragdoll) return;
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            if (!cc) return;
            foreach (var p in ragdoll.parts)
                if (p.collider)
                    Physics.IgnoreCollision(cc, p.collider, ignore);
        }

        void BuildWeakPoint()
        {
            var go = new GameObject("WeakPoint");
            go.layer = Layers.Character;
            var sphere = go.AddComponent<SphereCollider>();
            sphere.isTrigger = false;
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            WeakPoint = go.transform;
            PlaceWeakPoint(FindBone(weakBone), weakOffset, weakRadius);
            WeakZone = HitZone.Create(sphere, Health, this, "weak", 1f, true, 10);
        }

        Transform FindBone(string boneName)
        {
            Transform bone = null;
            if (!string.IsNullOrEmpty(boneName))
                foreach (var t in GetComponentsInChildren<Transform>(true))
                    if (t.name.Contains(boneName)) { bone = t; break; }
            if (!bone && Rig && Rig.lookBones.Length > 0) bone = Rig.lookBones[^1];
            return bone ? bone : transform;
        }

        void PlaceWeakPoint(Transform bone, Vector3 offset, float radius)
        {
            WeakPoint.SetParent(bone, false);
            WeakPoint.localPosition = offset;
            WeakPoint.localRotation = Quaternion.identity;
            // 骨骼可能带缩放：半径换算回世界尺寸；radius 是设计尺寸下的半径，随根节点体型（名册 scale、精英）放大，同 Three.js 的 headRadius × sizeScale
            float s = Mathf.Max(1e-3f, bone.lossyScale.x);
            var sphere = WeakPoint.GetComponent<SphereCollider>();
            sphere.radius = radius * transform.lossyScale.x / s;
        }

        /// <summary>
        /// 把弱点挪到别的骨骼 / 改半径（设计尺寸，随体型放大）：炉门开合、宝珠换位、断腿后弱点露出来。
        /// bone 为空时用 CreatureRig 的头骨；半径缩放（<see cref="HitZone.SetRadiusScale"/>）以新半径为基准重新计
        /// </summary>
        public void SetWeakPoint(Transform bone, Vector3 offset, float radius)
        {
            if (!WeakPoint) return;
            weakOffset = offset;
            weakRadius = radius;
            PlaceWeakPoint(bone ? bone : FindBone(null), offset, radius);
            if (WeakZone) WeakZone = HitZone.Create(WeakPoint.GetComponent<SphereCollider>(), Health, this, WeakZone.id, WeakZone.multiplier, WeakZone.weakpoint, WeakZone.priority);
        }

        /// <summary>按骨骼名（包含匹配）挪弱点</summary>
        public void SetWeakPoint(string boneName, Vector3 offset, float radius)
        {
            weakBone = boneName;
            SetWeakPoint(FindBone(boneName), offset, radius);
        }

        /// <summary>
        /// 换了模型之后重新绑定（首领换形：鲲 → 鹏，两份模型是首领根节点下的两个子物体，只有当前形态的那份激活）：
        /// Awake 只缓存了当时激活的那份模型的 Animator / CreatureRig，这里改成 model 下的；「Hit」触发器按新 Animator 重查；
        /// 渲染器 / 发光壳重新收集（含未激活的，受击闪白两份都写），着色通道的渲染器清掉、下一帧按当时激活的重新收集并重写一遍。
        /// 弱点骨骼由调用方另行 <see cref="SetWeakPoint(Transform, Vector3, float)"/>（BossBrain 换形时已经做了）
        /// </summary>
        public void Rebind(GameObject model)
        {
            var root = model ? model.transform : transform;
            var a = root.GetComponentInChildren<Animator>(true);
            if (a) Animator = a;
            var rig = root.GetComponentInChildren<CreatureRig>(true);
            if (rig) Rig = rig;
            hasHitTrigger = false;
            if (Animator && Animator.isActiveAndEnabled && Animator.runtimeAnimatorController)
                foreach (var p in Animator.parameters)
                    if (p.nameHash == HitId) hasHitTrigger = true;
            renderers = GetComponentsInChildren<Renderer>(true);
            glowShells = Array.FindAll(renderers, r => r.name.Contains("GlowShell"));
            shellChannel = Array.ConvertAll(glowShells, r => ShellChannel(r.name));
            tintRenderers = null;
            tintWritten = true;
            flashDirty = true;
        }

        /// <summary>开 / 关弱点球（琴碎、遁地；关掉后打不到、也不挡子弹）。切换「是不是弱点」用 WeakZone.SetWeakPoint</summary>
        public void SetWeakPointActive(bool on)
        {
            if (WeakPoint) WeakPoint.gameObject.SetActive(on);
        }

        // ───────────── 着色通道 ─────────────

        readonly List<(string key, Color color)> tints = new();
        readonly List<(string key, Color color, float amount)> overlays = new();
        Renderer[] tintRenderers;
        bool tintWritten, overlayWritten;

        /// <summary>
        /// 设一个 _Tint 通道（rgb 乘在反照率上、a = 输出透明度，需要材质切到 alpha 混合才有效）：各通道相乘。
        /// 作用于身体的渲染器（不含发光壳，发光壳的 _Tint 归发光通道）；第一次调用时收集当时激活的渲染器
        /// </summary>
        public void SetTint(string channel, Color tint)
        {
            if (string.IsNullOrEmpty(channel)) return;
            for (int i = 0; i < tints.Count; i++)
                if (tints[i].key == channel)
                {
                    tints[i] = (channel, tint);
                    return;
                }
            tints.Add((channel, tint));
        }

        public void ClearTint(string channel) => tints.RemoveAll(t => t.key == channel);

        /// <summary>当前 _Tint（各通道之积，没有通道为白）</summary>
        public Color TintNow
        {
            get
            {
                var c = Color.white;
                foreach (var t in tints) c *= t.color;
                return c;
            }
        }

        /// <summary>设一个覆盖色通道（往 color 插值 amount 0..1，写进 _FlashColor / _FlashAmount）：多个通道取最强的；受击闪白更强时盖过它</summary>
        public void SetOverlay(string channel, Color color, float amount)
        {
            if (string.IsNullOrEmpty(channel)) return;
            for (int i = 0; i < overlays.Count; i++)
                if (overlays[i].key == channel)
                {
                    overlays[i] = (channel, color, amount);
                    return;
                }
            overlays.Add((channel, color, amount));
        }

        public void ClearOverlay(string channel) => overlays.RemoveAll(o => o.key == channel);

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            // 命中区：这一下落在哪一区（免疫的不算）；第一章只有身体 / 弱点两区，没人订阅时只是记个数
            if (zones.Count > 0 && !r.immune && (r.total > 0 || r.blocked))
            {
                var z = ZoneAt(info);
                if (z) z.Record(info, r);
            }
            if (r.total <= 0) return;
            // 闪白按伤害占比：光束 / 冲锋枪的小伤害只淡淡一闪（连射时不会一直是个白影），重击、反应才全白
            float hitFlash = Mathf.Lerp(0.22f, 1f, Mathf.Clamp01(r.total / Mathf.Max(1, Health.maxHealth) * 6f));
            if (info.source == DamageSource.Status && !info.reaction) hitFlash = 0.15f;
            flash = Mathf.Max(flash, hitFlash);
            flashDirty = true;
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
                // 布娃娃命中盒：死后变回真实物理，和玩家照常碰撞
                IgnorePlayer(false);
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
            // 亮度每帧都过渡：没有发光壳的敌人也有人读（FX3 的 _E 发光遮罩 GlowMask）
            float gk = 1 - Mathf.Exp(-14f * Time.deltaTime);
            for (int c = 0; c < GlowChannels; c++)
                glowLevel[c] = Mathf.Lerp(glowLevel[c], Health.Dead ? 0 : Mathf.Clamp01(glowTarget[c]), gk);
            if (glowShells.Length > 0 || glowParts.Count > 0)
            {
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
                flashDirty = true;
            }
            if (deadTime < 0) return;
            float since = Time.time - deadTime;
            if (respawnAfter > 0 && since > respawnAfter) Respawn();
            else if (respawnAfter <= 0 && since > despawnAfter) Destroy(gameObject);
        }

        // 着色在 AI 写完（Update）之后统一合成写入
        void LateUpdate()
        {
            WriteTint();
            WriteFlash();
        }

        void WriteTint()
        {
            if (tints.Count == 0 && !tintWritten) return;
            tintRenderers ??= TintRenderers();
            var c = TintNow;
            foreach (var r in tintRenderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor(TintId, c);
                r.SetPropertyBlock(block);
            }
            tintWritten = tints.Count > 0;
        }

        /// <summary>受 _Tint 通道影响的渲染器：当时激活的、材质有 _Tint 的身体渲染器（不含发光壳、粒子 / 拖尾 / 连线）</summary>
        Renderer[] TintRenderers()
        {
            var list = new List<Renderer>();
            foreach (var r in GetComponentsInChildren<Renderer>())
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer || r.name.Contains("GlowShell")) continue;
                foreach (var m in r.sharedMaterials)
                    if (m && m.HasProperty(TintId))
                    {
                        list.Add(r);
                        break;
                    }
            }
            return list.ToArray();
        }

        /// <summary>
        /// 受击闪白与覆盖色：没有覆盖色通道时只写 _FlashAmount = 闪白 × 0.85（与原来一致）；有覆盖色时取较强的一个，颜色跟着它
        /// </summary>
        void WriteFlash()
        {
            float ov = 0;
            var oc = Color.white;
            foreach (var o in overlays)
            {
                float a = Mathf.Clamp01(o.amount);
                if (a > ov)
                {
                    ov = a;
                    oc = o.color;
                }
            }
            bool overlay = ov > 0;
            if (!flashDirty && !overlay && !overlayWritten) return;
            flashDirty = false;
            float hit = flash * 0.85f;
            float amount = Mathf.Max(hit, ov);
            bool colorPass = overlay || overlayWritten;
            var color = overlay && ov > hit ? oc : Color.white;
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetFloat(FlashId, amount);
                if (colorPass) block.SetColor(FlashColorId, color);
                r.SetPropertyBlock(block);
            }
            overlayWritten = overlay;
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
            if (ragdoll && ragdoll.Active)
            {
                ragdoll.Restore();
                IgnorePlayer(true);
            }
            transform.SetPositionAndRotation(home, homeRot);
            if (WeakPoint) WeakPoint.gameObject.SetActive(true);
            foreach (var z in zones)
                if (z) z.ResetCount();
            Health.ResetVitals();
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }
    }
}
