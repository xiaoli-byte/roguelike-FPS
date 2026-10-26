using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 贴地冲击波的前沿（纯逻辑，EditMode 可测）：半径从 start 以 speed 往外走，最后一步停在 max + overshoot（这一步照样判定），再下一步结束；
    /// 每一步扫过的环带是 [上一步半径 − halfWidth, 这一步半径 + halfWidth]——逐帧连续，掉帧也不会从玩家身边跳过去，最远判到 max + overshoot + halfWidth。
    /// </summary>
    public struct WaveFront
    {
        public float speed, max, overshoot, halfWidth;
        /// <summary>这一步 / 上一步的半径</summary>
        public float r, prevR;
        bool last, done;

        public WaveFront(float start, float speed, float max, float halfWidth, float overshoot = 0)
        {
            this.speed = Mathf.Max(0.01f, speed);
            this.max = Mathf.Max(0, max);
            this.overshoot = Mathf.Max(0, overshoot);
            this.halfWidth = Mathf.Max(0, halfWidth);
            r = prevR = Mathf.Max(0, start);
            last = done = false;
        }

        /// <summary>前沿最远走到哪</summary>
        public float Limit => max + overshoot;

        /// <summary>前沿走完了（之后不再判定）</summary>
        public bool Done => done;

        public void Step(float dt)
        {
            if (last)
            {
                done = true;
                return;
            }
            prevR = r;
            r += speed * Mathf.Max(0, dt);
            if (r >= Limit)
            {
                r = Limit;
                last = true;
            }
        }

        /// <summary>离波心水平距离 dist 处这一步被扫到</summary>
        public bool Crosses(float dist) => !Done && dist >= prevR - halfWidth && dist <= r + halfWidth;
    }

    /// <summary>
    /// 贴地扩散的冲击波环（Three.js 镇墓兽 launchWave / BossHazards.wave；从 TombBeastAI 抽出来）：
    /// 前沿以 speed 从波心往外走到 maxRadius（<see cref="WaveFront"/>），扫过地上的玩家时伤害一次（每道波只打一次）：
    ///   爆心 innerRadius 以内不吃（爆心另算）；脚底相对波心的高差在 [minRise, maxRise] 内；needGrounded 时玩家要贴地（跳起来躲开）；
    ///   coverBlocks 时波心到玩家之间（离地 0.45 m）被掩体挡住也躲开；可选向外击退。出手者被嘲讽期间不伤玩家（同 EnemyAI.HitTarget）。
    /// 外观：<see cref="Telegraph.Wave"/> 扩散环（ring = true）。伤害是最终值（调用方已乘等级 / 精英倍率）。
    /// </summary>
    public sealed class GroundWave : MonoBehaviour
    {
        public struct Spec
        {
            public Vector3 center;
            /// <summary>起始半径、最大半径（外观环走到这里）、前沿速度（米/秒）、走过最大半径后还判定多远、环带宽度（前沿前后各一半）</summary>
            public float startRadius, maxRadius, speed, overshoot, width;
            /// <summary>伤害（最终值）与元素</summary>
            public float damage;
            public Element element;
            /// <summary>这个半径以内不吃（爆心另算）</summary>
            public float innerRadius;
            /// <summary>玩家脚底相对波心的高差带（含两端）</summary>
            public float minRise, maxRise;
            /// <summary>玩家要贴地才吃（跳起来躲开）</summary>
            public bool needGrounded;
            /// <summary>掩体挡波（波心 → 玩家离地 0.45 m 的连线被挡住）</summary>
            public bool coverBlocks;
            /// <summary>命中时的击退：水平向外 / 向上（米/秒）</summary>
            public float knockback, knockUp;
            public Color color;
            /// <summary>画扩散环</summary>
            public bool ring;
            /// <summary>出手者（被嘲讽期间不伤玩家；玩家受伤事件里的 source）</summary>
            public EnemyAI owner;

            /// <summary>缺省：从 0 开始、环带宽 1.4 m（前沿前后各 0.7）、高差 ±1.2 m、要贴地、不挡、不击退、画环</summary>
            public Spec(Vector3 center, float maxRadius, float speed, float damage)
            {
                this.center = center;
                this.maxRadius = maxRadius;
                this.speed = speed;
                this.damage = damage;
                startRadius = 0;
                overshoot = 0;
                width = 1.4f;
                element = Element.None;
                innerRadius = 0;
                minRise = -1.2f;
                maxRise = 1.2f;
                needGrounded = true;
                coverBlocks = false;
                knockback = knockUp = 0;
                color = new Color(1f, 0.75f, 0.4f);
                ring = true;
                owner = null;
            }
        }

        Spec spec;
        WaveFront front;

        /// <summary>这道波已经打中过玩家</summary>
        public bool Hit { get; private set; }
        public float Radius => front.r;

        public static GroundWave Spawn(in Spec s)
        {
            var go = new GameObject("Ground Wave");
            go.transform.position = s.center;
            var w = go.AddComponent<GroundWave>();
            w.spec = s;
            w.front = new WaveFront(s.startRadius, s.speed, s.maxRadius, s.width * 0.5f, s.overshoot);
            if (s.ring) Telegraph.Wave(s.center, s.maxRadius, s.speed, s.color, TelegraphTone.Danger);
            return w;
        }

        void Update()
        {
            front.Step(Time.deltaTime);
            if (front.Done)
            {
                Destroy(gameObject);
                return;
            }
            if (!Hit) Check();
        }

        void Check()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var feet = pv.transform.position;
            var to = feet - spec.center;
            float dy = to.y;
            to.y = 0;
            float dist = to.magnitude;
            if (dist <= spec.innerRadius || !front.Crosses(dist)) return;
            if (dy < spec.minRise || dy > spec.maxRise) return;
            var motor = pv.GetComponent<PlayerMotor>();
            if (spec.needGrounded && motor && !motor.Grounded) return;
            if (spec.owner && spec.owner.Taunted) return;
            if (spec.coverBlocks && dist > 1.2f && Combat.Blocked(spec.center + Vector3.up * 0.45f, new Vector3(feet.x, spec.center.y + 0.45f, feet.z), null)) return;
            Hit = true;
            Combat.DamagePlayer(spec.damage, spec.center, spec.element, spec.owner);
            if ((spec.knockback > 0 || spec.knockUp > 0) && motor && !pv.Dead && !pv.Invulnerable)
            {
                var dir = dist > 0.05f ? to / dist : Vector3.zero;
                motor.AddImpulse(new Vector3(dir.x * spec.knockback, spec.knockUp, dir.z * spec.knockback));
            }
        }
    }
}
