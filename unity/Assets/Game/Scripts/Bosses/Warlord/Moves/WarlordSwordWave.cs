using Spiritfire.Art;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 魔将 · 熔铜剑气（剑士化 v2，设计单 §13.5）：远程，挥刀把月牙剑光甩出去，贴地飞行。
    ///   · 竖剑气：一道竖着的月牙，窄（半宽 0.9 m）而高（3.4 m）——侧移躲；
    ///   · 横剑气：一道平放的月牙，宽（半宽 3.2 m，狂怒 × 1.15）而矮（离地 0.95 m 以下）——跳过去（跳高 1.42 m）；
    ///   · 一阶段（教招）：一道竖剑气瞄着玩家；
    ///   · 二阶段：横斩一道横剑气，紧接着竖劈一道竖剑气（重新瞄准）——先跳再侧移；
    ///   · 狂怒「十字剑气」：横剑气（慢，15 m/s）+ 三道竖剑气（快，22 m/s，中间一道瞄准、两侧 ±32°）；中间那道追上横剑气时交成一个「十」字。
    /// 每道剑气沿飞行路线画一条长条预警：出手前填满、飞完前一直亮着（预警 = 判定）。撞上掩体在掩体上炸开、不穿墙；打中玩家一次就不再伤他，继续往前飞。
    /// 挥刀的那一帧（片段 hit / impact）是释放帧：顿帧、震屏、刀口的月牙和剑气同一帧出。
    /// </summary>
    public sealed class WarlordSwordWave : WarlordSwordMove
    {
        public const string MoveId = "warlord_wave";
        public override string Id => MoveId;
        public override string Name => "魔将 · 熔铜剑气";

        public enum Kind { Vertical, Horizontal }

        /// <summary>一道剑气：种类、相对瞄准方向的偏角（度）、速度（米/秒）</summary>
        public readonly struct Shot
        {
            public readonly Kind kind;
            public readonly float yaw, speed;

            public Shot(Kind k, float yaw, float speed)
            {
                kind = k;
                this.yaw = yaw;
                this.speed = speed;
            }
        }

        static readonly Shot[] None = { };
        static readonly Shot[] P0A = { new(Kind.Vertical, 0, 20f) };
        static readonly Shot[] P1A = { new(Kind.Horizontal, 0, 17f) }, P1B = { new(Kind.Vertical, 0, 21f) };
        static readonly Shot[] P2A = { new(Kind.Horizontal, 0, 15f) }, P2B = { new(Kind.Vertical, 0, 22f), new(Kind.Vertical, -32f, 21f), new(Kind.Vertical, 32f, 21f) };

        /// <summary>某阶段（狂怒 = 2）的两刀：第一刀（hit）和第二刀（impact，一阶段没有）各甩出哪些剑气</summary>
        public static (Shot[] first, Shot[] second) Pattern(int phase) => phase >= 2 ? (P2A, P2B) : phase >= 1 ? (P1A, P1B) : (P0A, None);

        /// <summary>竖 / 横剑气的半宽、离地高度上限；射程</summary>
        public const float VHalf = 0.9f, VTop = 3.4f, HHalf = 3.2f, HTop = 0.95f, Range = 26f;

        (Shot[] first, Shot[] second) pattern;
        int planPhase;
        float w, gap, aim, aim2, reach = 1f;
        bool second, launched2;
        readonly List<TelegraphHandle> lanes = new();

        /// <summary>甩出去的剑气数（测试用）</summary>
        public int Launched { get; private set; }
        /// <summary>第二刀离第一刀多久（秒）</summary>
        public float LastGap => gap;

        public WarlordSwordWave()
        {
            cooldown = 6f;
            recovery = 1f;
            windup = 0.8f;
            recover = 0.1f;
        }

        public override float Weight(BossBrain b)
        {
            float d = b.DistanceToPlayer;
            return d > 9f ? 2.6f : d > 6f ? 1.4f : 0.3f;
        }

        public static float HalfWidth(Kind k, float reach) => k == Kind.Horizontal ? HHalf * reach : VHalf;

        protected override void OnStart()
        {
            planPhase = Fury ? 2 : Phase;
            reach = Reach;
            pattern = Pattern(planPhase);
            second = pattern.second.Length > 0;
            launched2 = false;
            w = (planPhase >= 2 ? 0.65f : planPhase >= 1 ? 0.75f : 0.8f) * Brain.WindupScale;
            gap = second ? w * (WarlordSword.CrossImpactAt / WarlordSword.CrossHitAt - 1f) : 0f;
            aim = YawToPlayerAt(0.45f);
            lanes.Clear();
            Brain.Halt();
            Act(second ? "waveCross" : "waveSlash", second ? w / WarlordSword.CrossHitAt : w / WarlordSword.WaveHitAt);
            Sfx("telegraph");
        }

        float YawToPlayerAt(float lead)
        {
            var d = Brain.Predict(lead) - Brain.transform.position;
            d.y = 0;
            return d.sqrMagnitude < 0.25f ? Facing : WarlordSword.Yaw(d);
        }

        protected override void OnTelegraph() => DrawLanes(pattern.first, aim, w);

        void DrawLanes(Shot[] shots, float yaw, float fill)
        {
            var o = OnGround(Brain.transform.position);
            foreach (var s in shots)
            {
                float y = yaw + s.yaw;
                float range = RangeAlong(y);
                lanes.Add(Hazards.LineWarning(o, y, range, HalfWidth(s.kind, reach), fill, WarlordSword.Warn, range / s.speed));
            }
        }

        float RangeAlong(float yaw) => Mathf.Clamp(ToEdge(Brain.transform.position, WarlordSword.Dir(yaw), -1f, Range), 6f, Range);

        protected override bool WindupDone => StageT >= w;

        protected override void OnWindup(float dt)
        {
            TurnToward(aim, 360f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, w)));
        }

        protected override void OnActiveBegin()
        {
            Launch(pattern.first, aim, 0);
            if (!second) return;
            // 第二刀重新瞄准（玩家跳过第一道之后落在哪），预警从第一刀出手画到第二刀出手
            aim2 = YawToPlayerAt(gap + 0.25f);
            DrawLanes(pattern.second, aim2, gap);
        }

        protected override void OnActive(float dt)
        {
            if (!second || launched2)
            {
                Brain.Halt();
                return;
            }
            TurnToward(aim2, 500f, dt);
            if (StageT < gap) return;
            launched2 = true;
            Launch(pattern.second, aim2, 1);
        }

        protected override bool ActiveDone => (!second || launched2) && StageT >= gap + 0.35f;

        void Launch(Shot[] shots, float yaw, int swing)
        {
            // 预警转进危险物组：招式收招后照样亮到剑气飞完
            foreach (var h in lanes) Hazards.Commit(h);
            lanes.Clear();
            var runner = WarlordWaveRunner.For(Brain);
            var o = Brain.transform.position;
            float floor = Floor;
            bool fury = planPhase >= 2;
            foreach (var s in shots)
            {
                float y = yaw + s.yaw;
                var d = WarlordSword.Dir(y);
                runner.Add(new WarlordWaveRunner.Wave
                {
                    origin = new Vector3(o.x, floor, o.z) + d * 0.8f,
                    dir = d,
                    speed = s.speed,
                    range = RangeAlong(y) - 0.8f,
                    halfWidth = HalfWidth(s.kind, reach),
                    top = s.kind == Kind.Horizontal ? HTop : VTop,
                    vertical = s.kind == Kind.Vertical,
                    damage = s.kind == Kind.Horizontal ? Dmg(20) : Dmg(22),
                    fury = fury,
                });
                Launched++;
            }
            Brain.Glow(0, 0);
            Sfx("skill_fire", 0.9f, swing == 0 ? 0.85f : 1.05f);
            Sfx("enemy_melee", 0.7f, 0.7f);
            if (LordFx is { } lord) lord.WaveSwing(second ? swing == 0 ? "waveCross" : "waveCross2" : "waveSlash", yaw, shots[0].kind == Kind.Vertical, fury);
            else Brain.Shake(0.3f, 0.25f);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.Halt();
            Brain.Glow(0, 0);
            lanes.Clear();
        }
    }

    /// <summary>
    /// 飞出去的剑气（<see cref="WarlordSwordWave"/>）：挂在首领身上逐帧推进——这一帧扫过的长方体碰到玩家胶囊就伤一次（<see cref="WarlordSword.WaveSweeps"/>），
    /// 碰到掩体在掩体上炸开、飞到射程尽头散掉；外观交给 <see cref="WarlordWaveFx"/>（领主战）或通用刀光（样机）。首领倒下 / 被销毁时全部散掉
    /// </summary>
    public sealed class WarlordWaveRunner : MonoBehaviour
    {
        public sealed class Wave
        {
            public Vector3 origin, dir;
            public float speed, range, halfWidth, top, damage, s;
            public bool vertical, fury, hit, done;
            public FxHandle fx;
        }

        readonly List<Wave> waves = new();
        BossBrain boss;
        BossHazards hz;

        /// <summary>累计：甩出的剑气、打中玩家、撞上掩体、飞完 / 散掉；十字交汇次数</summary>
        public int Launched { get; private set; }
        public int Hits { get; private set; }
        public int Walls { get; private set; }
        public int Ended { get; private set; }
        public int Crossed { get; private set; }
        public int Alive => waves.Count;

        public static WarlordWaveRunner For(BossBrain b)
        {
            var r = b.GetComponent<WarlordWaveRunner>();
            if (!r) r = b.gameObject.AddComponent<WarlordWaveRunner>();
            r.boss = b;
            if (!r.hz) r.hz = BossHazards.For(b);
            return r;
        }

        public void Add(Wave w)
        {
            if (w == null || !(w.range > 0.5f)) return;
            w.dir.y = 0;
            w.dir.Normalize();
            waves.Add(w);
            Launched++;
            w.fx = Fx.WarlordWave(w.origin, w.dir, w.vertical, w.halfWidth, w.vertical ? w.top : 1.2f, w.fury, WarlordRef.Lord(boss));
        }

        void Update()
        {
            if (waves.Count == 0) return;
            if (!boss || boss.Dead)
            {
                Clear();
                return;
            }
            float dt = Time.deltaTime;
            for (int i = waves.Count - 1; i >= 0; i--)
            {
                var w = waves[i];
                Step(w, dt);
                if (!w.done) continue;
                waves.RemoveAt(i);
                Ended++;
            }
            CheckCross();
        }

        void Step(Wave w, float dt)
        {
            float s0 = w.s, s1 = Mathf.Min(w.range, w.s + w.speed * dt);
            // 掩体：剑气腰高处往前探
            float probe = w.vertical ? 1.4f : 0.6f;
            var p0 = w.origin + w.dir * s0 + Vector3.up * probe;
            if (Physics.Raycast(p0, w.dir, out var hit, s1 - s0 + 0.25f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && Mathf.Abs(hit.normal.y) < 0.6f)
            {
                w.s = s0 + Mathf.Max(0, hit.distance - 0.2f);
                Walls++;
                Finish(w, true, hit.point - w.dir * 0.2f);
                return;
            }
            w.s = s1;
            if (!w.hit && BossHazards.PlayerBody(out var feet, out float pr, out _) &&
                WarlordSword.WaveSweeps(w.origin, w.dir, s0, s1, w.halfWidth, w.origin.y, w.top, feet, pr))
            {
                w.hit = true;
                if (hz && hz.Hurt(w.damage, Element.Fire, w.origin + w.dir * s1 + Vector3.up) > 0)
                {
                    Hits++;
                    var motor = PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<PlayerMotor>() : null;
                    if (motor) motor.AddImpulse(w.dir * 8f + Vector3.up * 3f);
                    Fx.WarlordWaveBurst(new Vector3(feet.x, feet.y + 1f, feet.z), w.dir, w.vertical, w.fury, false);
                }
            }
            var pos = w.origin + w.dir * w.s;
            w.fx.MoveTo(pos);
            if (w.s >= w.range - 1e-3f) Finish(w, false, pos + Vector3.up * (w.vertical ? 1.2f : 0.5f));
        }

        void Finish(Wave w, bool wall, Vector3 at)
        {
            w.done = true;
            w.fx.Cancel();
            Fx.WarlordWaveBurst(at, w.dir, w.vertical, w.fury, wall);
        }

        /// <summary>狂怒十字剑气：竖剑气追上横剑气、从横月牙中间穿过去的那一刻在交点亮一个「十」字（只有外观，每道横剑气只亮一次）</summary>
        void CheckCross()
        {
            foreach (var h in waves)
            {
                if (h.vertical || !h.fury || h.done || crossedOnce.Contains(h)) continue;
                var ph = h.origin + h.dir * h.s;
                foreach (var v in waves)
                {
                    if (!v.vertical || v.done || Vector3.Dot(v.dir, h.dir) < 0.94f) continue;
                    var off = v.origin + v.dir * v.s - ph;
                    float lead = Vector3.Dot(off, h.dir), side = Mathf.Abs(off.x * h.dir.z - off.z * h.dir.x);
                    if (lead < 0 || lead > v.speed * Time.deltaTime + 0.3f || side > h.halfWidth) continue;
                    crossedOnce.Add(h);
                    Crossed++;
                    Fx.WarlordCrossFlare(ph + Vector3.up * 0.9f + new Vector3(h.dir.z, 0, -h.dir.x) * Vector3.Dot(off, new Vector3(h.dir.z, 0, -h.dir.x)), h.dir, h.halfWidth, h.fury);
                    break;
                }
            }
        }

        readonly HashSet<Wave> crossedOnce = new();

        void Clear()
        {
            foreach (var w in waves)
                if (!w.done)
                {
                    w.done = true;
                    w.fx.Cancel();
                }
            waves.Clear();
            crossedOnce.Clear();
        }

        void OnDestroy() => Clear();
    }
}
