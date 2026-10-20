using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>命中区的朝向门：任意方向 / 只有从正面打来才算 / 只有从背后打来才算</summary>
    public enum ZoneFacing { Any, Front, Back }

    /// <summary>敌人身上命中区的生成方式（<see cref="EnemyDef.hitboxes"/>）</summary>
    public enum HitboxMode
    {
        /// <summary>角色胶囊 = 身体，加一个弱点球（第一章 6 种，命中扫描 / 投射物的弱点规则照旧）</summary>
        Capsule,
        /// <summary>存活时用布娃娃的骨骼胶囊做命中盒（长尾巴、翅膀、分区甲）；角色胶囊只挡路、不挡子弹。没有布娃娃时退回 Capsule</summary>
        Ragdoll,
    }

    /// <summary>某个命中区挨了一下（伤害结算之后）</summary>
    public struct ZoneHitEvent
    {
        public HitZone zone;
        public Damageable enemy;
        public DamageInfo info;
        public DamageResult result;
    }

    /// <summary>
    /// 多段命中区（Three.js 版各敌人自己的 raycastHit / armourFactor / plateAt：首领的 hitShapes、铁牛炉门、火鼍岩甲、旋龟正面甲…）：
    /// 挂在敌人的一个碰撞体上，和同物体上的 <see cref="Hitbox"/> 互相引用。
    ///   倍率 <see cref="multiplier"/>：落在这一区的伤害在敌人侧乘上（<see cref="Damageable.Incoming"/>，乘积 &lt; 0.5 记为格挡）；持续伤害不算区。
    ///   弱点 <see cref="weakpoint"/>：命中扫描 / 投射物读 Hitbox.weakpoint 时由这里回答（必定暴击、弱点规则照旧）。
    ///   启停 <see cref="SetActive"/>：关掉碰撞体（打不到、也不挡子弹）；<see cref="SetWeakPoint"/> 运行时切换弱点。
    ///   朝向门 <see cref="facing"/>：只在从正面 / 背后 cos ≥ <see cref="facingCos"/> 的方向打来时生效（正面甲），门外这一区按普通部位（×1、不是弱点）。
    ///     倍率按这一击的方向判；弱点按玩家视点判（命中扫描读弱点时还没有伤害请求）。
    ///   半径缩放 <see cref="SetRadiusScale"/>：炉门开合、蓄力鼓胀时把判定放大 / 缩小（相对创建时的尺寸）。
    ///   计数：累计落在这一区的实际伤害，到 <see cref="breakAt"/> 发 <see cref="Broke"/> 一次（断腿、碎甲、琴碎）；每一下都发 <see cref="Damaged"/> 与全局 <see cref="ZoneDamaged"/>。
    /// 伤害落在哪一区由 <see cref="EnemyBody.ZoneAt"/> 按命中点判定（命中点在碰撞体表面 / 内部，优先级高的先选）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HitZone : MonoBehaviour
    {
        /// <summary>区名（"body"、"weak"、骨骼名、"door"、"plate_0"…）</summary>
        public string id;
        [SerializeField] float mult = 1f;
        [SerializeField] bool weak;
        public ZoneFacing facing = ZoneFacing.Any;
        /// <summary>朝向门的半角余弦（0.34 ≈ ±70°）</summary>
        public float facingCos = 0.34f;
        /// <summary>朝向的参考系（默认敌人根节点；挂在会转动的部件上时可以指定部件）</summary>
        public Transform facingFrame;
        /// <summary>同一命中点落在几个区里时，优先级高的算</summary>
        public int priority;
        /// <summary>累计伤害达到这个值时发 <see cref="Broke"/>（≤ 0 = 不计）</summary>
        public float breakAt;

        /// <summary>累计落在这一区的实际伤害（<see cref="ResetCount"/> 清零）</summary>
        public float damageTaken { get; private set; }
        public bool Broken { get; private set; }
        public float RadiusScale { get; private set; } = 1f;

        public Collider Collider { get; private set; }
        public Hitbox Hitbox { get; private set; }
        public Damageable Owner => Hitbox ? Hitbox.owner : null;
        public EnemyBody Body { get; private set; }

        /// <summary>这一区挨了一下：区、请求、结果</summary>
        public event Action<HitZone, DamageInfo, DamageResult> Damaged;
        /// <summary>累计伤害到了 <see cref="breakAt"/>（每次 ResetCount 之后最多一次）</summary>
        public event Action<HitZone> Broke;

        static readonly EventChannel<InAction<ZoneHitEvent>> zoneDamaged = new();
        /// <summary>全局：任意敌人的任意命中区挨了一下（统计、冒烟测试、秘卷）</summary>
        public static event InAction<ZoneHitEvent> ZoneDamaged { add => zoneDamaged.Add(value); remove => zoneDamaged.Remove(value); }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => zoneDamaged.Clear();

        float baseA, baseB;
        Vector3 baseSize;

        /// <summary>落在这一区的伤害倍率（1 = 普通部位；0.2 = 铁甲；3 = 炉膛）</summary>
        public float multiplier
        {
            get => mult;
            set
            {
                mult = value;
                if (Body) Body.ZonesChanged();
            }
        }

        /// <summary>是弱点（必定暴击）；运行时切换用 <see cref="SetWeakPoint"/></summary>
        public bool weakpoint
        {
            get => weak;
            set => weak = value;
        }

        /// <summary>启用中：组件开着、碰撞体开着、物体激活</summary>
        public bool Active => enabled && Collider && Collider.enabled && gameObject.activeInHierarchy;

        /// <summary>现在按弱点算：启用、是弱点、朝向门对玩家视点通过</summary>
        public bool WeakNow => weak && Active && (facing == ZoneFacing.Any || FacingPasses(Collider.bounds.center - ShooterEye()));

        /// <summary>倍率不是 1：需要在敌人侧结算（朝向门只决定倍率生不生效）</summary>
        public bool AffectsDamage => mult != 1f;

        /// <summary>
        /// 在碰撞体 c 上建一个命中区（同物体上没有 Hitbox 时一起加，owner 指向 owner）；已有命中区时返回原来的。
        /// body：登记到哪个敌人身体（伤害按命中点分到区）
        /// </summary>
        public static HitZone Create(Collider c, Damageable owner, EnemyBody body, string id, float multiplier = 1f, bool weakpoint = false, int priority = 0)
        {
            if (!c) return null;
            var go = c.gameObject;
            var z = go.GetComponent<HitZone>();
            if (!z) z = go.AddComponent<HitZone>();
            var hb = go.GetComponent<Hitbox>();
            if (!hb) hb = go.AddComponent<Hitbox>();
            hb.owner = owner;
            z.id = id;
            z.mult = multiplier;
            z.weak = weakpoint;
            z.priority = priority;
            z.Bind(c, hb, body);
            return z;
        }

        void Bind(Collider c, Hitbox hb, EnemyBody body)
        {
            Collider = c;
            Hitbox = hb;
            hb.zone = this;
            switch (c)
            {
                case SphereCollider s:
                    baseA = s.radius;
                    break;
                case CapsuleCollider cap:
                    baseA = cap.radius;
                    baseB = cap.height;
                    break;
                case BoxCollider box:
                    baseSize = box.size;
                    break;
            }
            RadiusScale = 1f;
            if (Body && Body != body) Body.UnregisterZone(this);
            Body = body;
            if (body) body.RegisterZone(this);
        }

        void Awake()
        {
            // 编辑器里手摆的命中区：自己找碰撞体 / 命中盒 / 身体
            if (Collider) return;
            var c = GetComponent<Collider>();
            var hb = GetComponent<Hitbox>();
            if (!c || !hb) return;
            Bind(c, hb, GetComponentInParent<EnemyBody>());
        }

        void OnDestroy()
        {
            if (Body) Body.UnregisterZone(this);
            if (Hitbox && Hitbox.zone == this) Hitbox.zone = null;
        }

        /// <summary>开 / 关这一区（关掉碰撞体：打不到、也不挡子弹）</summary>
        public void SetActive(bool on)
        {
            if (Collider) Collider.enabled = on;
        }

        /// <summary>运行时切换弱点（火麒麟碎鳞后整身变弱点、炉门开合…）</summary>
        public void SetWeakPoint(bool on) => weak = on;

        /// <summary>判定尺寸 = 创建时的 × scale（球 / 胶囊的半径，胶囊高度与盒子一起缩放）</summary>
        public void SetRadiusScale(float scale)
        {
            if (!(scale > 0) || float.IsInfinity(scale)) return;
            RadiusScale = scale;
            switch (Collider)
            {
                case SphereCollider s:
                    s.radius = baseA * scale;
                    break;
                case CapsuleCollider cap:
                    cap.radius = baseA * scale;
                    cap.height = Mathf.Max(baseB * scale, cap.radius * 2);
                    break;
                case BoxCollider box:
                    box.size = baseSize * scale;
                    break;
            }
        }

        /// <summary>
        /// 朝向门：shotDirection = 这一击飞行的方向（从出手者指向目标）。Front：从参考系正前方 cos ≥ facingCos 打来；Back：从正后方。
        /// 没有门总是通过；方向退化（零向量）时有门的不通过
        /// </summary>
        public bool FacingPasses(Vector3 shotDirection)
        {
            if (facing == ZoneFacing.Any) return true;
            var from = -shotDirection;
            from.y = 0;
            if (from.sqrMagnitude < 1e-6f) return false;
            var frame = facingFrame ? facingFrame : Body ? Body.transform : transform;
            var fwd = frame.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-6f) return false;
            float d = Vector3.Dot(from.normalized, fwd.normalized);
            return facing == ZoneFacing.Front ? d >= facingCos : d <= -facingCos;
        }

        /// <summary>这一击落在这一区时的伤害倍率：朝向门外按普通部位（1）</summary>
        public float MultiplierFor(in DamageInfo info) => FacingPasses(info.direction) ? mult : 1f;

        /// <summary>命中点到这一区的距离（在碰撞体内部 / 表面上为 0）</summary>
        public float Distance(Vector3 point)
        {
            var c = Collider;
            if (!c) return float.PositiveInfinity;
            var q = c is MeshCollider { convex: false } ? c.bounds.ClosestPoint(point) : c.ClosestPoint(point);
            return Vector3.Distance(q, point);
        }

        /// <summary>累计清零（重铸、复活、再生）</summary>
        public void ResetCount()
        {
            damageTaken = 0;
            Broken = false;
        }

        /// <summary>这一区挨了一下（结果已结算）：<see cref="EnemyBody"/> 按命中点分区后调；自己判定命中的（首领的特殊部位）也可以直接调</summary>
        public void Record(in DamageInfo info, in DamageResult r)
        {
            if (r.total > 0) damageTaken += r.total;
            try
            {
                Damaged?.Invoke(this, info, r);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            var ev = new ZoneHitEvent { zone = this, enemy = Owner, info = info, result = r };
            zoneDamaged.Raise(in ev);
            if (Broken || !(breakAt > 0) || damageTaken < breakAt) return;
            Broken = true;
            try
            {
                Broke?.Invoke(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        static Transform eyeCache;
        static int eyeFrame = -1;

        /// <summary>玩家视点（命中扫描的起点）：判弱点的朝向门用；没有玩家时用主相机</summary>
        static Vector3 ShooterEye()
        {
            if (eyeFrame != Time.frameCount || !eyeCache)
            {
                eyeFrame = Time.frameCount;
                var pv = PlayerVitals.Instance;
                var motor = pv ? pv.GetComponent<Spiritfire.Art.PlayerMotor>() : null;
                eyeCache = motor && motor.eye ? motor.eye : Camera.main ? Camera.main.transform : null;
            }
            return eyeCache ? eyeCache.position : Vector3.zero;
        }
    }
}
