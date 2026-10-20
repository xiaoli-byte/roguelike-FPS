using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 危险区的计时（纯逻辑，EditMode 可测）：预警 arm 秒（不伤人）→ 生效 duration 秒；生效后 firstTick 秒第一次检测、之后每 interval 秒一次，
    /// 检测时刻 &lt; 生效结束才算（结束那一刻不再打）。一步最多补 4 次（掉帧不雪崩），补不完的丢掉、从现在重新计。
    /// </summary>
    public struct ZoneClock
    {
        public float arm, duration, interval;
        /// <summary>从开始算起的秒数</summary>
        public float age;
        float next;

        public ZoneClock(float arm, float duration, float interval, float firstTick)
        {
            this.arm = Mathf.Max(0, arm);
            this.duration = Mathf.Max(0, duration);
            this.interval = Mathf.Max(0.02f, interval);
            age = 0;
            next = this.arm + Mathf.Max(0, firstTick);
        }

        /// <summary>生效结束的时刻（从开始算）</summary>
        public float End => arm + duration;
        public bool Arming => age < arm;
        public bool Live => age >= arm && age < End;
        public bool Ended => age >= End;
        /// <summary>生效了多久（预警期为 0）</summary>
        public float LiveTime => Mathf.Max(0, age - arm);
        /// <summary>预警进度 0..1</summary>
        public float ArmProgress => arm > 0 ? Mathf.Clamp01(age / arm) : 1;

        /// <summary>推进 dt 秒，返回这一步到点的检测次数（只算生效期内的）</summary>
        public int Step(float dt)
        {
            age += Mathf.Max(0, dt);
            int n = 0;
            while (next <= age && next < End && n < 4)
            {
                n++;
                next += interval;
            }
            if (next <= age) next = age + interval;
            return n;
        }

        /// <summary>提前结束：从现在起不再检测（预警中的直接作废）</summary>
        public void Expire()
        {
            if (age < arm) arm = age;
            duration = Mathf.Max(0, Mathf.Min(duration, age - arm));
        }
    }

    /// <summary>
    /// 通用的持续伤害区（Three.js 版 BossHazards.zone 与 Hazards.zonePlayer 的合体）：圆形（可挖空成环带）区域，
    /// 先预警 arm 秒（<see cref="Telegraph.Circle"/>，不伤人），之后生效 duration 秒，每 interval 秒对站在里面的玩家结算一次（<see cref="ZoneClock"/>）；
    /// 「站在里面」= 水平距离 ≤ 半径 + pad（环带还要 ≥ 内半径 − pad），且脚底相对区域中心的高差在 [minRise, maxRise] 内（跳起来可以躲）。
    /// 生效期铺一块地面贴片（<see cref="HazardDecal"/>，淡入 0.25 s、微微闪），可选冒火星；结束或 <see cref="Expire"/> 后贴片 0.3 s 淡出再销毁。
    /// 伤害是每跳的最终值（调用方已乘等级 / 精英倍率），走 <see cref="Combat.DamagePlayer"/>（无敌帧、减伤在玩家那边处理）。
    /// 地火用子类 <see cref="FloorFire"/>（可被祸斗吃掉）。
    /// </summary>
    public class HazardZone : MonoBehaviour
    {
        /// <summary>结束后贴片淡出的时长（秒）</summary>
        public const float FadeTime = 0.3f;

        public struct Spec
        {
            /// <summary>区域中心（地面点）、半径、内半径（&gt; 0 时是环带）</summary>
            public Vector3 center;
            public float radius, innerRadius;
            /// <summary>预警时长（不伤人）、生效时长、检测间隔、生效后第一次检测的延迟</summary>
            public float arm, duration, interval, firstTick;
            /// <summary>每跳伤害（最终值）与元素</summary>
            public float damage;
            public Element element;
            /// <summary>玩家脚底相对中心的高差带（含两端）与水平判定外扩（米）</summary>
            public float minRise, maxRise, pad;
            public Color color;
            /// <summary>出手者（玩家受伤事件里的 source；可为 null）</summary>
            public Object source;
            /// <summary>预警期画 Telegraph 圆 / 生效期铺地面贴片 / 生效期冒火星</summary>
            public bool telegraph, decal, sparks;

            /// <summary>缺省：不预警、每 0.5 s 一跳（生效 0.25 s 后第一跳）、高差 ±1.2 m、外扩 0.35 m、无元素、有贴片</summary>
            public Spec(Vector3 center, float radius, float duration, float damage)
            {
                this.center = center;
                this.radius = radius;
                this.duration = duration;
                this.damage = damage;
                innerRadius = 0;
                arm = 0;
                interval = 0.5f;
                firstTick = 0.25f;
                element = Element.None;
                minRise = -1.2f;
                maxRise = 1.2f;
                pad = 0.35f;
                color = new Color(1f, 0.45f, 0.12f, 1f);
                source = null;
                telegraph = true;
                decal = true;
                sparks = false;
            }
        }

        protected Spec spec;
        protected ZoneClock clock;
        HazardDecal decal;
        float fade;

        /// <summary>生效中</summary>
        public bool Live => clock.Live;
        /// <summary>已结束（贴片可能还在淡出）</summary>
        public bool Ended => clock.Ended;
        public Vector3 Center => spec.center;
        public float Radius => spec.radius;
        /// <summary>打中玩家的次数</summary>
        public int Hits { get; private set; }

        /// <summary>生成一片危险区</summary>
        public static HazardZone Spawn(in Spec s) => Create<HazardZone>("Hazard Zone", s);

        protected static T Create<T>(string name, in Spec s) where T : HazardZone
        {
            var go = new GameObject(name);
            go.transform.position = s.center;
            var z = go.AddComponent<T>();
            z.Init(s);
            return z;
        }

        protected virtual void Init(in Spec s)
        {
            spec = s;
            clock = new ZoneClock(s.arm, s.duration, s.interval, s.firstTick);
            if (s.telegraph && s.arm > 0) Telegraph.Circle(s.center, s.radius, s.arm, s.color);
            if (s.decal) decal = HazardDecal.Create(transform, s.center, s.radius, s.color);
            UpdateVisual();
        }

        /// <summary>提前结束（施放者倒下、被吃掉）：不再伤害，贴片淡出</summary>
        public void Expire() => clock.Expire();

        protected virtual void Update()
        {
            float dt = Time.deltaTime;
            int ticks = clock.Step(dt);
            for (int i = 0; i < ticks; i++)
                if (TickPlayer())
                    Hits++;
            if (clock.Ended)
            {
                fade += dt;
                if (fade >= FadeTime)
                {
                    Destroy(gameObject);
                    return;
                }
            }
            else if (spec.sparks && clock.Live && Random.value < dt * 10f)
            {
                var c = Random.insideUnitCircle * spec.radius * 0.8f;
                ShotFx.Instance?.Impact(transform.position + new Vector3(c.x, 0.05f, c.y), Vector3.up, true, 0.5f);
            }
            UpdateVisual();
        }

        /// <summary>一跳：玩家在区域里就结算伤害（返回是否在里面）</summary>
        protected virtual bool TickPlayer()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return false;
            if (!Contains(spec.center, spec.radius, spec.innerRadius, spec.pad, spec.minRise, spec.maxRise, pv.transform.position)) return false;
            Combat.DamagePlayer(spec.damage, spec.center, spec.element, spec.source);
            return true;
        }

        /// <summary>脚底 feet 在区域里：水平 ≤ 半径 + pad（环带 ≥ 内半径 − pad），高差在 [minRise, maxRise]</summary>
        public static bool Contains(Vector3 center, float radius, float inner, float pad, float minRise, float maxRise, Vector3 feet)
        {
            float dy = feet.y - center.y;
            if (dy < minRise || dy > maxRise) return false;
            var d = feet - center;
            d.y = 0;
            float dist = d.magnitude;
            if (dist > radius + pad) return false;
            return !(inner > 0 && dist < inner - pad);
        }

        void UpdateVisual()
        {
            if (decal == null) return;
            float a;
            if (clock.Arming) a = 0;
            else if (clock.Ended) a = 1 - Mathf.Clamp01(fade / FadeTime);
            else a = Mathf.Clamp01(clock.LiveTime / 0.25f) * (0.85f + 0.15f * Mathf.Sin(Time.time * 9f + spec.center.x));
            decal.SetAlpha(a);
        }
    }
}
