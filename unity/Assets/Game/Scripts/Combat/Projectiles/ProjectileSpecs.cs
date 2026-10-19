using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>拖尾：Auto = 按 TS 规则（火箭、榴弹、追踪弹、爆炸弹有，箭矢没有）；On / Off 强制</summary>
    public enum ProjectileTrail { Auto, On, Off }

    /// <summary>投射物碰到敌人的一次接触（穿透时每个敌人一次）</summary>
    public struct ProjectileHit
    {
        public Damageable enemy;
        public Hitbox hitbox;
        /// <summary>接触点（弱点命中时是弱点上的点）与表面法线</summary>
        public Vector3 point, normal;
        /// <summary>按弱点算（打中弱点命中盒，或身体之后 1.5 m 内穿过同一单位的弱点，见 <see cref="WeakpointRule"/>）</summary>
        public bool weakpoint;
        /// <summary>命中盒倍率（弱点用弱点那个命中盒的）</summary>
        public float multiplier;
        /// <summary>接触点沿本段扫掠的距离（投射物中心走到这里时碰上）</summary>
        public float distance;
        /// <summary>这一发结算后的结果（只有直接伤害的投射物有；爆炸弹为 default）</summary>
        public DamageResult result;
    }

    /// <summary>
    /// 玩家投射物的发射参数（Three.js 版 ProjectileSpec，owner = player）。用构造函数建：缺省值同 Unity 现有行为
    /// （到期爆炸、爆炸边缘 30%、击退不衰减——与旧接口 Combat.Explode(center, radius, info) 一致；对齐 TS 的 0.5 留给武器数值单元）。
    /// </summary>
    public struct PlayerProjectileSpec
    {
        public Vector3 position, velocity;
        /// <summary>命中伤害模板（point / direction / weakpoint 由系统填）；amount ≤ 0 = 「载体」：不结算伤害，效果全在回调里</summary>
        public DamageInfo damage;
        public float radius, lifetime, gravity;
        /// <summary>&gt; 0：命中 / 触地 / 到期时爆炸（只结算爆炸伤害，不再另算直击）</summary>
        public float explosionRadius;
        /// <summary>爆炸边缘伤害比例；击退不随距离衰减（旧接口的行为）；爆炸对玩家自己的伤害（0 = 不伤）</summary>
        public float explosionFalloff;
        public bool flatKnockback;
        public float selfDamage;
        /// <summary>可以再穿过几个敌人（穿透时伤害不衰减，同 TS）</summary>
        public int pierce;
        /// <summary>撞墙 / 地面反弹次数（法向保留 55%、切向 78%）；用完后 rollAfter = true 时贴地滚动到时间耗尽，否则下一次触地即炸</summary>
        public int bounces;
        public bool rollAfter;
        /// <summary>到期爆炸（有爆炸半径时）</summary>
        public bool explodeOnExpire;
        /// <summary>追踪转向速率（弧度 / 秒）；发射 homingDelay 秒后开始转向，每 0.25 s 复查目标</summary>
        public float homing, homingDelay;
        /// <summary>初始追踪目标（null = 到时候自己选）</summary>
        public Damageable target;
        /// <summary>外观（<see cref="ProjectileVisuals"/> 的 id；null 或空 = 不要外观，由调用方自己挂）、颜色、缩放、拖尾</summary>
        public string visual;
        public Color color;
        public float scale;
        public ProjectileTrail trail;
        /// <summary>命中 / 触地 / 到期爆炸时回调（point）；载体投射物到期也会在原地回调一次</summary>
        public Action<Vector3> onImpact;
        /// <summary>每碰到一个敌人回调一次（穿透时每个一次）</summary>
        public Action<ProjectileHit> onHit;

        public PlayerProjectileSpec(Vector3 position, Vector3 velocity, DamageInfo damage, float radius = 0.1f, float lifetime = 3f)
        {
            this.position = position;
            this.velocity = velocity;
            this.damage = damage;
            this.radius = radius;
            this.lifetime = lifetime;
            gravity = 0;
            explosionRadius = 0;
            explosionFalloff = 0.3f;
            flatKnockback = true;
            selfDamage = 0;
            pierce = 0;
            bounces = 0;
            rollAfter = false;
            explodeOnExpire = true;
            homing = 0;
            homingDelay = ProjectileMath.PlayerHomingDelay;
            target = null;
            visual = ProjectileVisuals.Fallback;
            color = new Color(1f, 0.851f, 0.627f);
            scale = 1;
            trail = ProjectileTrail.Auto;
            onImpact = null;
            onHit = null;
        }
    }

    /// <summary>
    /// 敌方投射物的发射参数（Three.js 版 ProjectileSpec，owner = enemy + BlockableProjectileSpec）。用构造函数建。
    /// 打玩家：线段到玩家胶囊的距离判定（冲刺无敌帧内穿过）；可被 <see cref="ProjectileWard"/> 挡下；可追踪（飞过玩家后不再掉头）。
    /// </summary>
    public struct EnemyProjectileSpec
    {
        public Vector3 position, velocity;
        public float gravity;
        /// <summary>对玩家的伤害（爆炸弹 = 爆心伤害，按距离衰减到 explosionFalloff）</summary>
        public float damage;
        public float radius, lifetime, explosionRadius, explosionFalloff;
        public Element element;
        /// <summary>追踪转向速率（弧度 / 秒），瞄准玩家胸口；飞过玩家后停止追踪，保证可以闪避</summary>
        public float homing;
        /// <summary>幻影弹（蜃景火球）：碰到什么都只是一阵冷光，没有伤害</summary>
        public bool fake;
        /// <summary>被嘲讽的敌人射出的（对着灵体诱饵打）：不伤玩家，穿过诱饵胶囊时被吸收</summary>
        public bool spirit;
        /// <summary>能被挡弹区挡下（缺省 true）</summary>
        public bool blockable;
        /// <summary>出手者（伤害归属、受击方向）</summary>
        public UnityEngine.Object source;
        /// <summary>外观 id、颜色、缩放；拖尾缺省开（敌方弹飞行方向要一眼可读）</summary>
        public string visual;
        public Color color;
        public float scale;
        public ProjectileTrail trail;
        /// <summary>落地 / 打中玩家 / 到期时回调（point, 是否打中玩家）；被挡下时不调，改调 onBlocked</summary>
        public Action<Vector3, bool> onImpact;
        public Action<Vector3> onBlocked;

        public EnemyProjectileSpec(Vector3 position, Vector3 velocity, float damage, float radius = 0.22f, float lifetime = 4f)
        {
            this.position = position;
            this.velocity = velocity;
            this.damage = damage;
            this.radius = radius;
            this.lifetime = lifetime;
            gravity = 0;
            explosionRadius = 0;
            explosionFalloff = 0.3f;
            element = Element.None;
            homing = 0;
            fake = false;
            spirit = false;
            blockable = true;
            source = null;
            visual = ProjectileVisuals.Fallback;
            color = new Color(1f, 0.333f, 0.2f);
            scale = 1;
            trail = ProjectileTrail.On;
            onImpact = null;
            onBlocked = null;
        }
    }
}
