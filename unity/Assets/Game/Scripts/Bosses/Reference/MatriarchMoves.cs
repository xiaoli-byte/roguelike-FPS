using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>霜翼妖后（Three.js src/enemies/bosses/Matriarch.ts）的颜色常量。飞行的俯冲与冰晶供能只属于妖后本体（由鲲鹏 / 旱魃「飞天之殇」继承），不做参考招式</summary>
    public static class MatriarchRef
    {
        public static readonly Color Warn = Hex.Rgb(0x7fd8ff), Shard = Hex.Rgb(0x9fe8ff), Lock = Hex.Rgb(0xff5a7a), LanceShot = Hex.Rgb(0xbff4ff);
        public const int MaxLances = 7;
    }

    /// <summary>
    /// 妖后 · 寒霜新星：降到低空蓄力，脚下亮 7.5 m 圆形预警（1.2 s，二阶段 0.95 s），冰屑向身体聚拢 → 近身爆发（高度上限 3.5 m，强击退）；
    /// 二阶段起再向四周放一圈 16 枚冰棱（膝胸之间的高度，跳不过、要躲开缝隙）。之后在原地停留片刻（输出窗口）
    /// </summary>
    public sealed class MatriarchNova : ReferenceMove
    {
        public override string Id => "matriarch_nova";
        public override string Name => "妖后 · 寒霜新星";

        Vector3 center;
        float wind, trailAcc;

        public MatriarchNova()
        {
            cooldown = 10f;
            recovery = 1.4f;
            windup = 1.2f;
            active = 1.5f;
            recover = 0.1f;
            windupAnim = "blessWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 10f ? 4f : 1.2f;

        protected override void OnStart()
        {
            wind = (Phase >= 1 ? 0.95f : 1.2f) * Brain.WindupScale;
            center = OnGround(Brain.transform.position);
            Brain.Halt();
        }

        protected override void OnTelegraph()
        {
            WarnCircle(center, 7.5f, wind, MatriarchRef.Warn);
            Sfx("telegraph");
        }

        protected override bool WindupDone => StageT >= wind;

        protected override void OnWindup(float dt)
        {
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind)));
            trailAcc += dt;
            if (trailAcc < 0.08f) return;
            trailAcc = 0;
            float a = Random.value * Mathf.PI * 2;
            Fx.Burst(Brain.transform.position + new Vector3(Mathf.Sin(a) * 3, 1.5f, Mathf.Cos(a) * 3), MatriarchRef.Shard, 3, 3f, 0.4f, 0.14f, 0f);
        }

        protected override void OnActiveBegin()
        {
            Brain.Glow(0, 0);
            Hazards.Blast(center, 7.5f, Dmg(22), new BossBlastOpts { maxHeight = 3.5f, knockback = 10, knockUp = 4 });
            Fx.Ring(center + Vector3.up * 0.1f, 8f, MatriarchRef.Warn, 0.6f);
            var body = Brain.BodyCenter;
            // 冷的冰爆（FX3）：卡通爆炸是火的色阶，传冰蓝进去会成一团赭黄泥色
            Fx.FrostNova(body, 3f, MatriarchRef.Shard);
            Fx.Burst(body, Hex.Rgb(0xd8f6ff), 30, 11f, 0.9f, 0.2f, 6f);
            Brain.Shake(0.5f, 0.4f);
            Sfx("explosion", 1f, 1.3f);
            Sfx("shield_break", 1f, 0.7f);
            if (Phase >= 1) ShardRing(16, 13f);
        }

        void ShardRing(int n, float speed)
        {
            float y = Floor + 1.15f, off = Random.value * Mathf.PI * 2;
            var p = Brain.transform.position;
            for (int i = 0; i < n; i++)
            {
                float a = off + i / (float)n * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                Shoot(new Vector3(p.x + d.x * 1.2f, y, p.z + d.z * 1.2f), d, speed, Dmg(8), MatriarchRef.Shard, "shard", 0.28f, 2.6f);
            }
            Sfx("enemy_shot", 0.6f, 1.2f);
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }

    /// <summary>
    /// 妖后 · 冰枪齐射：身后浮现 5（二阶段 7）支冰枪，各自的瞄准线（光束句柄）追踪玩家胸口；发射前 0.3 s 逐支锁定（瞄准线变红、落点按玩家速度预判 0.25 s），
    /// 然后依次射出（42 m/s）——持续移动即可闪避。二阶段连放两轮。被打断时冰枪与瞄准线一起收起
    /// </summary>
    public sealed class MatriarchLances : ReferenceMove
    {
        public override string Id => "matriarch_lances";
        public override string Name => "妖后 · 冰枪齐射";

        sealed class Lance
        {
            public Transform model;
            public BossBeam line;
            public Vector3 target;
            public bool active, locked, lockedLine;
        }

        readonly List<Lance> lances = new();
        int count, volleys;
        float aim, volleyLen;
        int nextEvent;
        readonly List<(float at, int volley, int lance, int kind)> events = new();

        /// <summary>本次射出的冰枪数（测试用）</summary>
        public int Fired { get; private set; }

        public MatriarchLances()
        {
            cooldown = 5.5f;
            recovery = 1.1f;
            windup = 0.3f;
            recover = 0.1f;
            weight = 2.4f;
            windupAnim = "blessWindup";
        }

        protected override void OnStart()
        {
            count = Phase >= 1 ? 7 : 5;
            volleys = Phase >= 1 ? 2 : 1;
            aim = Phase >= 1 ? 0.85f : 1f;
            volleyLen = aim + count * 0.12f + 0.45f;
            Fired = 0;
            nextEvent = 0;
            // 时间轴（相对出手段开始）：每轮 0 = 召出冰枪，aim + 0.12i − 0.3 = 锁定第 i 支，aim + 0.12i = 射出第 i 支
            events.Clear();
            for (int v = 0; v < volleys; v++)
            {
                float b = v * volleyLen;
                events.Add((b, v, -1, 0));
                for (int i = 0; i < count; i++)
                {
                    events.Add((b + aim + i * 0.12f - 0.3f, v, i, 1));
                    events.Add((b + aim + i * 0.12f, v, i, 2));
                }
            }
            events.Sort((x, y) => x.at.CompareTo(y.at));
            Brain.Halt();
            Sfx("telegraph", 1f, 1.4f);
        }

        protected override void OnTelegraph()
        {
            // Unity 补的：玩家脚下一圈淡预警，提示「这一招在瞄你」（冰枪的落点由瞄准线表达）
            WarnCircle(OnGround(Brain.PlayerPosition), 1.6f, WindupTime, MatriarchRef.Warn);
        }

        protected override void OnWindup(float dt) => Brain.Face(Brain.PlayerPosition, 230f, dt);

        protected override void OnActiveBegin() => RunEvents();

        protected override void OnActive(float dt)
        {
            Brain.Face(Brain.PlayerPosition, 230f, dt);
            RunEvents();
            UpdateLances();
        }

        protected override bool ActiveDone => nextEvent >= events.Count && StageT >= volleys * volleyLen;

        void RunEvents()
        {
            while (nextEvent < events.Count && StageT >= events[nextEvent].at)
            {
                var e = events[nextEvent++];
                if (e.kind == 0) Summon();
                else if (e.kind == 1) LockLance(e.lance);
                else FireLance(e.lance);
            }
        }

        Vector3 Slot(int i)
        {
            float th = count > 1 ? -1.1f + 2.2f * i / (count - 1) : 0;
            var t = Brain.transform;
            float lx = Mathf.Sin(th) * 1.9f * Mathf.Max(1f, Brain.BodyRadius), ly = 2.4f + Mathf.Cos(th) * 1.1f + Mathf.Sin(Time.time * 3 + i) * 0.06f;
            var cap = Brain.GetComponent<CapsuleCollider>();
            float h = cap ? cap.height * Mathf.Abs(t.lossyScale.y) : 4f;
            return t.position + t.right * lx + Vector3.up * (ly + h * 0.45f) - t.forward * 0.3f;
        }

        void Summon()
        {
            while (lances.Count < count) lances.Add(new Lance());
            for (int i = 0; i < count; i++)
            {
                var l = lances[i];
                if (!l.model)
                {
                    var r = PropBits.Box(null, $"Ice Lance {i + 1}", Vector3.zero, new Vector3(0.14f, 0.14f, 1.2f), Hex.Rgb(0xd8f8ff));
                    r.sharedMaterial = FxMaterials.Unlit;
                    FxMaterials.Tint(r, Hex.Rgb(0xd8f8ff) * 1.4f);
                    l.model = r.transform;
                }
                l.model.gameObject.SetActive(true);
                l.model.position = Slot(i);
                l.active = true;
                l.locked = l.lockedLine = false;
                Hazards.ReleaseBeam(l.line);
                l.line = Hazards.Beam(MatriarchRef.Warn);
                Fx.Burst(l.model.position, MatriarchRef.Shard, 5, 2f, 0.4f, 0.14f, 0f);
            }
            Sfx("enemy_charge", 0.6f, 1.5f);
        }

        void LockLance(int i)
        {
            if (i >= lances.Count || !lances[i].active) return;
            var l = lances[i];
            l.locked = true;
            l.target = Brain.Predict(0.25f) + Vector3.up * 1.1f;
            // 锁定：瞄准线换成红色（换色 = 换一条光束）
            Hazards.ReleaseBeam(l.line);
            l.line = Hazards.Beam(MatriarchRef.Lock);
        }

        void FireLance(int i)
        {
            if (i >= lances.Count || !lances[i].active) return;
            var l = lances[i];
            var from = l.model ? l.model.position : Slot(i);
            Shoot(from, l.target - from, 42f, Dmg(13), MatriarchRef.LanceShot, "shard", 0.3f, 2f, 2.2f);
            Fired++;
            Fx.Burst(from, MatriarchRef.Shard, 6, 3f, 0.35f, 0.14f, 0f);
            Sfx("enemy_shot", 0.7f, 1.6f);
            l.active = false;
            if (l.model) l.model.gameObject.SetActive(false);
            Hazards.ReleaseBeam(l.line);
            l.line = null;
        }

        void UpdateLances()
        {
            var chest = Brain.PlayerPosition + Vector3.up * 1.1f;
            for (int i = 0; i < count && i < lances.Count; i++)
            {
                var l = lances[i];
                if (!l.active || !l.model) continue;
                l.model.position = Slot(i);
                if (!l.locked) l.target = chest;
                var d = l.target - l.model.position;
                if (d.sqrMagnitude > 1e-4f) l.model.rotation = Quaternion.LookRotation(d);
                l.line?.Set(l.model.position, l.target, l.locked ? 0.045f : 0.022f);
            }
        }

        protected override void OnEnd(bool cancelled)
        {
            foreach (var l in lances)
            {
                l.active = false;
                Hazards.ReleaseBeam(l.line);
                l.line = null;
                if (l.model) Object.Destroy(l.model.gameObject);
                l.model = null;
            }
        }
    }

    /// <summary>
    /// 妖后 · 冰棱螺旋弹幕（地面版：妖后本体升空蓄力，参考实现留在原地）：蓄力 0.8 s（地上亮出放射状辐条预警），然后自转并喷出 3 臂（二阶段 4 臂、中途反转）螺旋冰棱，
    /// 每 0.12 s（二阶段 0.1 s）一圈，持续 3.2 s（二阶段 3.8 s）；弹道向下倾斜，在玩家距离处约胸口高
    /// </summary>
    public sealed class MatriarchSpiral : ReferenceMove
    {
        public override string Id => "matriarch_spiral";
        public override string Name => "妖后 · 冰棱螺旋";

        float spin, dir, dur, fireAcc;
        int emitted;

        /// <summary>本次射出的冰棱数（测试用）</summary>
        public int Emitted => emitted;

        public MatriarchSpiral()
        {
            cooldown = 9f;
            recovery = 1.3f;
            windup = 0.8f;
            recover = 0.2f;
            weight = 2.6f;
            windupAnim = "blessWindup";
        }

        protected override void OnStart()
        {
            spin = (Facing + Rng.Range(-7f, 7f)) * Mathf.Deg2Rad;
            dir = Rng.Sign();
            dur = Phase >= 1 ? 3.8f : 3.2f;
            fireAcc = 0;
            emitted = 0;
            Brain.Halt();
            Sfx("telegraph", 1f, 1.2f);
            Fx.Burst(Muzzle, MatriarchRef.Shard, 16, 3f, 0.8f, 0.16f, -1f);
        }

        protected override void OnTelegraph()
        {
            int arms = Phase >= 1 ? 4 : 3;
            Hazards.SpokesWarning(OnGround(Brain.transform.position), arms, 12f, 1.2f, spin * Mathf.Rad2Deg, WindupTime, MatriarchRef.Warn);
        }

        protected override void OnWindup(float dt) => Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, WindupTime)));

        Vector3 Muzzle => Brain.BodyCenter + Vector3.up * 0.8f;

        protected override void OnActive(float dt)
        {
            Brain.Glow(0, 1);
            float d = Phase >= 1 && StageT > dur * 0.5f ? -dir : dir;
            spin += d * (Phase >= 1 ? 2.2f : 1.8f) * dt;
            SetFacing(spin * Mathf.Rad2Deg);
            float interval = Phase >= 1 ? 0.1f : 0.12f;
            fireAcc += dt;
            while (fireAcc >= interval)
            {
                fireAcc -= interval;
                Emit();
            }
        }

        protected override bool ActiveDone => StageT >= dur;

        void Emit()
        {
            int arms = Phase >= 1 ? 4 : 3;
            var m = Muzzle;
            var pl = Brain.PlayerPosition;
            float dist = Mathf.Max(5f, new Vector2(pl.x - m.x, pl.z - m.z).magnitude);
            float pitch = Mathf.Atan2(m.y - (pl.y + 1.05f), dist);
            float cp = Mathf.Cos(pitch), sp = Mathf.Sin(pitch);
            float speed = Phase >= 1 ? 12f : 11f;
            for (int k = 0; k < arms; k++)
            {
                float a = spin + k / (float)arms * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a) * cp, -sp, Mathf.Cos(a) * cp);
                Shoot(m + d * 0.9f, d, speed, Dmg(8), MatriarchRef.Shard, "shard", 0.28f, 2.8f);
            }
            if (emitted++ % 3 == 0) Sfx("enemy_shot", 0.35f, 1.4f);
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }
}
