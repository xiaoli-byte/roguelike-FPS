using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>预警归属（Three.js Hazards.ts 的 WarnScope 'move' / 'hazard'）：招式自己兑现的 / 随已发出的危险物兑现的</summary>
    public enum WarnKind
    {
        /// <summary>招式时间轴自己兑现（砸地、践踏、横扫、冲锋…）：招式结束或被打断时撤回还没填满的</summary>
        Move,
        /// <summary>随已发出的危险物兑现（巨石 / 陨石落点、成排地刺）：打断招式后照常落地，只在清场时收起</summary>
        Hazard,
    }

    /// <summary>抛射物的外观：巨石（抛物线）/ 陨石（直线坠落、拖火尾）/ 冰块</summary>
    public enum LobKind { Boulder, Meteor, Ice }

    /// <summary>地刺的外观：岩刺 / 冰刺</summary>
    public enum SpikeKind { Rock, Ice }

    /// <summary>同一次施放共享的命中记录（Three.js EruptSpec.volley）：被其中一根刺中后，同批其余地刺不再伤害（避免被挑飞后连吃数段）</summary>
    public sealed class HazardVolley
    {
        public bool hit;
    }

    /// <summary>范围伤害的附加参数（Three.js BlastOpts）</summary>
    public struct BossBlastOpts
    {
        /// <summary>玩家脚底高于中心多少以内会被命中（≤ 0 = 半径）</summary>
        public float maxHeight;
        /// <summary>命中时水平向外 / 向上的冲量（米/秒）</summary>
        public float knockback, knockUp;
        public Element element;
        /// <summary>不看掩体（地刺从脚下冒出）。缺省 false：爆心到玩家胸口、眼睛都被挡住时不受伤（Unity 补的，Three.js 没有）</summary>
        public bool ignoreCover;
    }

    /// <summary>冲击波环（Three.js WaveSpec）：低矮扩散的环带，贴地玩家被扫到受伤一次；跳起 / 站上掩体 / 被掩体挡住可躲</summary>
    public struct BossWaveSpec
    {
        public Vector3 center;
        /// <summary>扩散速度（米/秒）、最大半径、起始半径、环带厚度、离地多高以内会被扫到（玩家脚底高度）</summary>
        public float speed, maxRadius, startRadius, width, height;
        /// <summary>伤害（最终值）</summary>
        public float damage;
        public Color color;
        /// <summary>扇形中线朝向（世界 yaw，度）与半角（度；≥ 180 = 整圈）</summary>
        public float arcYaw, arcHalf;
        /// <summary>命中时向外击退（米/秒；向上固定 3.5）</summary>
        public float knockback;
        public Element element;
        /// <summary>沿环扬起的尘土 / 火星（dust = false 不扬）</summary>
        public bool dust;
        public Color dustColor;
        /// <summary>这道波不再伤害玩家（玩家刚被同一招的落点重击命中，避免连吃两段）</summary>
        public bool spare;

        /// <summary>缺省：起始半径 0.5、厚 0.9、高 0.85、整圈、不击退、不扬尘</summary>
        public BossWaveSpec(Vector3 center, float speed, float maxRadius, float damage, Color color)
        {
            this.center = center;
            this.speed = speed;
            this.maxRadius = maxRadius;
            this.damage = damage;
            this.color = color;
            startRadius = 0.5f;
            width = 0.9f;
            height = 0.85f;
            arcYaw = 0;
            arcHalf = 180;
            knockback = 0;
            element = Element.None;
            dust = false;
            dustColor = color;
            spare = false;
        }

        public bool FullCircle => arcHalf >= 179.9f;
    }

    /// <summary>持续伤害区（Three.js ZoneSpec）：火焰地带、熔岩外圈；先预警 arm 秒，之后每 interval 秒检测一次</summary>
    public struct BossZoneSpec
    {
        public Vector3 center;
        /// <summary>外半径、内半径（&gt; 0 = 环带：熔岩外圈）</summary>
        public float radius, innerRadius;
        /// <summary>生效时长（不含预警与消散）、预警时长、检测间隔</summary>
        public float duration, arm, interval;
        /// <summary>每跳伤害（最终值）</summary>
        public float damage;
        public Color color;
        public Element element;
        /// <summary>冒火星</summary>
        public bool embers;
        /// <summary>玩家脚底离地多高以内算站在里面</summary>
        public float maxHeight;

        /// <summary>缺省：预警 0.4 s、每 0.5 s 一跳、火元素、脚底 0.6 m 以内</summary>
        public BossZoneSpec(Vector3 center, float radius, float duration, float damage, Color color)
        {
            this.center = center;
            this.radius = radius;
            this.duration = duration;
            this.damage = damage;
            this.color = color;
            innerRadius = 0;
            arm = 0.4f;
            interval = 0.5f;
            element = Element.Fire;
            embers = false;
            maxHeight = 0.6f;
        }
    }

    /// <summary>抛射 / 坠落（Three.js LobSpec）：带地面预警的抛物线巨石 / 天降陨石，落地范围伤害</summary>
    public struct BossLobSpec
    {
        public Vector3 from, to;
        /// <summary>飞行时间（秒，下限 0.2）、抛物线额外顶点高度（陨石为 0：直线坠落）、落地半径</summary>
        public float time, arc, radius;
        public float damage;
        public Color color;
        public LobKind kind;
        /// <summary>画落点预警（hazard 组）</summary>
        public bool warn;
        public Element element;
        public float scale;
        /// <summary>落地回调（落点）：留火、碎冰…</summary>
        public Action<Vector3> onLand;

        public BossLobSpec(Vector3 from, Vector3 to, float time, float arc, float radius, float damage, Color color, LobKind kind)
        {
            this.from = from;
            this.to = to;
            this.time = time;
            this.arc = arc;
            this.radius = radius;
            this.damage = damage;
            this.color = color;
            this.kind = kind;
            warn = true;
            element = Element.None;
            scale = 1;
            onLand = null;
        }
    }

    /// <summary>延时地刺（Three.js EruptSpec）：地面预警 → delay 秒后破土伤害</summary>
    public struct BossEruptSpec
    {
        public Vector3 center;
        public float radius, delay, damage;
        public Color color;
        public SpikeKind kind;
        /// <summary>离地多高以内会被刺中</summary>
        public float height;
        public bool sound;
        /// <summary>画圆形预警（成排地刺由调用方统一画一条长条预警，这里关掉）</summary>
        public bool warn;
        /// <summary>同一次施放共享的命中记录（null = 各自独立）</summary>
        public HazardVolley volley;

        public BossEruptSpec(Vector3 center, float radius, float delay, float damage, Color color, SpikeKind kind)
        {
            this.center = center;
            this.radius = radius;
            this.delay = delay;
            this.damage = damage;
            this.color = color;
            this.kind = kind;
            height = 1.3f;
            sound = false;
            warn = true;
            volley = null;
        }
    }

    /// <summary>
    /// 光束句柄（Three.js BeamMesh 的用法：招式每帧摆放，配合 <see cref="BossHazards.SegmentHitsPlayer"/> / <see cref="BossHazards.BeamSweepHits"/> 判定）。
    /// 外观走 <see cref="Fx.Beam(Vector3, Vector3, Color, float, float)"/>（持续光束，每帧 Retarget）；粗细在第一次摆放时定，之后要变粗 / 换色就 Release 再要一条
    /// </summary>
    public sealed class BossBeam
    {
        readonly BossHazards owner;
        FxHandle fx;
        float width;

        public Color Color { get; }
        public Vector3 From { get; private set; }
        public Vector3 To { get; private set; }
        public bool Released { get; private set; }

        internal BossBeam(BossHazards owner, Color color)
        {
            this.owner = owner;
            Color = color;
        }

        /// <summary>摆放：from → to，判定半径 radius（外观全宽 = 2 × radius）</summary>
        public void Set(Vector3 from, Vector3 to, float radius)
        {
            if (Released || !Fx.Finite(from) || !Fx.Finite(to)) return;
            From = from;
            To = to;
            float w = Mathf.Max(0.02f, radius * 2f);
            if (!fx.Alive || Mathf.Abs(w - width) > 0.08f)
            {
                fx.Cancel();
                width = w;
                fx = Fx.Beam(from, to, Color, w, 10f);
            }
            else fx.Retarget(from, to);
        }

        /// <summary>收起（可重复调用）</summary>
        public void Release()
        {
            if (Released) return;
            Released = true;
            fx.Cancel();
            owner?.Forget(this);
        }
    }

    /// <summary>
    /// 首领危险物集合（docs/unity-parity.md 3.9「危险物：冲击环、持续区 / 环带、抛物线落石、地刺、光束、预警撤回」，Three.js src/enemies/bosses/Hazards.ts 的 HazardSet）。
    /// 每只首领一份，挂在首领物体上（<see cref="For"/> 第一次要的时候自动挂），招式经它放危险物：
    ///   <see cref="Wave"/>：低矮扩散的冲击波环（可限扇形），前沿逐帧连续扫（<see cref="WaveFront"/>，掉帧不漏判），贴地玩家被扫到受伤一次；跳起 / 站上掩体 / 被掩体挡住可躲；
    ///   <see cref="Zone"/>：持续伤害区 / 环带（E4 的 <see cref="HazardZone"/>），先预警 arm 秒再生效；
    ///   <see cref="Lob"/>：带落点预警的抛物线巨石 / 天降陨石，落地范围伤害 + 落地回调；
    ///   <see cref="Erupt"/>：延时地刺（预警 → 破土，外观借 E4 的 <see cref="SpikeField"/>，不立挡块），同批共享命中记录；
    ///   <see cref="Blast"/>：圆柱范围伤害（水平半径 + 高度上限，带击退），墙后不受伤；
    ///   <see cref="Beam"/>：光束句柄；<see cref="SegmentHitsPlayer"/>（带半径的线段打玩家胶囊）与 <see cref="BeamSweepHits"/>（本帧光束从上一角度扫到当前角度扫过的扇区，
    ///     低帧率时一帧转过一两米也不会「跳过」玩家）；
    ///   <see cref="Later"/> / <see cref="Repeat"/>：延时任务（危险物自己的时钟，暂停 / 顿帧不走）。
    /// 预警两组（<see cref="WarnScope"/>，F2）：<see cref="MoveWarnings"/> 招式结束 / 被打断时撤回还没填满的；<see cref="HazardWarnings"/> 随危险物兑现，只在清场时收起。
    /// <see cref="ClearAll"/>：首领倒下 / 物体销毁时自动调用——取消全部任务、收起全部预警、移除飞行中的抛射物、熄灭持续区、收起光束与冲击波。
    /// 伤害一律是最终值（招式用 <see cref="BossMove"/> 的 Damage 已乘难度 / 狂怒），走 <see cref="Combat.DamagePlayer"/>，出手者 = 首领；首领倒下后不再伤人。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BossHazards : MonoBehaviour
    {
        /// <summary>被撤回的贴花预警淡出约 0.1 s（由 Telegraph 处理）；尘土 / 火尾的发射间隔</summary>
        public const float DustEvery = 0.06f, TrailEvery = 0.06f;
        /// <summary>冲击波命中时的上抛（米/秒）、地刺挑飞、落石落点的击退 / 上抛</summary>
        public const float WaveKnockUp = 3.5f, SpikeKnockUp = 6.5f, LobKnockback = 5f, LobKnockUp = 3.5f;

        sealed class WaveRun
        {
            public BossWaveSpec spec;
            public WaveFront front;
            public bool hit;
            public float dustAcc;
            public TelegraphHandle ring;
        }

        sealed class LobRun
        {
            public BossLobSpec spec;
            public Transform obj;
            public float t, trailAcc;
            public Vector3 spin;
        }

        readonly List<WaveRun> waves = new();
        readonly List<LobRun> lobs = new();
        readonly List<HazardZone> zones = new();
        readonly List<BossBeam> beams = new();
        readonly List<FxHandle> visuals = new();
        readonly DelayQueue tasks = new();
        BossBrain boss;
        EnemyAI owner;
        bool bound;

        /// <summary>招式自己兑现的预警（招式结束 / 被打断时撤回还没填满的）</summary>
        public WarnScope MoveWarnings { get; } = new("move");
        /// <summary>随危险物兑现的预警（只在清场时收起）</summary>
        public WarnScope HazardWarnings { get; } = new("hazard");

        /// <summary>危险物时钟（秒，游戏时间）</summary>
        public float Clock { get; private set; }
        public EnemyAI Owner => owner;

        // ───────────── 计数（冒烟测试 / 调试叠层）─────────────

        public int WavesSpawned { get; private set; }
        public int ZonesSpawned { get; private set; }
        public int LobsSpawned { get; private set; }
        public int EruptsSpawned { get; private set; }
        public int BeamsSpawned { get; private set; }
        public int WarningsDrawn { get; private set; }
        /// <summary>打中玩家的次数（扣到血 / 盾的那几下）</summary>
        public int PlayerHits { get; private set; }
        public int ActiveWaves => waves.Count;
        public int ActiveLobs => lobs.Count;
        public int ActiveBeams => beams.Count;
        public int PendingTasks => tasks.Count;

        public int ActiveZones
        {
            get
            {
                int n = 0;
                foreach (var z in zones)
                    if (z && !z.Ended)
                        n++;
                return n;
            }
        }

        /// <summary>清场过几次（测试用）</summary>
        public int Clears { get; private set; }

        // ───────────── 生成 / 绑定 ─────────────

        /// <summary>这只首领的危险物集合（没有就挂一个，并接上「倒下清场」「招式结束撤回预警」）</summary>
        public static BossHazards For(BossBrain b)
        {
            if (!b) return null;
            var h = b.GetComponent<BossHazards>();
            if (!h) h = b.gameObject.AddComponent<BossHazards>();
            h.Bind(b);
            return h;
        }

        /// <summary>给普通敌人 / 测试用：挂在 host 上，伤害归属 owner（可为 null）</summary>
        public static BossHazards Attach(GameObject host, EnemyAI owner)
        {
            if (!host) return null;
            var h = host.GetComponent<BossHazards>();
            if (!h) h = host.AddComponent<BossHazards>();
            if (!h.owner) h.owner = owner;
            if (owner && owner.Health && !h.bound)
            {
                h.bound = true;
                owner.Health.Died += h.OnOwnerDied;
            }
            return h;
        }

        void Bind(BossBrain b)
        {
            if (bound) return;
            bound = true;
            boss = b;
            owner = b;
            if (b.Health) b.Health.Died += OnOwnerDied;
            b.MoveEnded += OnMoveEnded;
        }

        void OnOwnerDied(DamageInfo info) => ClearAll();

        void OnMoveEnded(BossBrain b, BossMove m) => CancelMoveWarnings();

        void OnDestroy()
        {
            if (owner && owner.Health) owner.Health.Died -= OnOwnerDied;
            if (boss) boss.MoveEnded -= OnMoveEnded;
            ClearAll();
        }

        bool OwnerDead => owner && owner.Dead;

        // ───────────── 伤害工具 ─────────────

        /// <summary>对玩家造成伤害（最终值；from = 受击方向指示点）。首领已倒下时不伤人。返回实际扣除量</summary>
        public float Hurt(float damage, Element element = Element.None, Vector3? from = null)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || OwnerDead || !(damage > 0)) return 0;
            float dealt = Combat.DamagePlayer(damage, from ?? (owner ? owner.transform.position + Vector3.up : pv.transform.position), element, owner);
            if (dealt > 0) PlayerHits++;
            return dealt;
        }

        /// <summary>玩家的脚底点、胶囊半径与身高</summary>
        public static bool PlayerBody(out Vector3 feet, out float radius, out float height)
        {
            var pv = PlayerVitals.Instance;
            feet = default;
            radius = 0.35f;
            height = 1.8f;
            if (!pv) return false;
            var pos = pv.transform.position;
            var cc = pv.GetComponent<CharacterController>();
            if (cc)
            {
                radius = cc.radius;
                height = cc.height;
                feet = new Vector3(pos.x, pos.y + cc.center.y - cc.height * 0.5f, pos.z);
            }
            else feet = pos;
            return true;
        }

        /// <summary>
        /// 以 center 为中心的圆柱范围伤害（Three.js HazardSet.blast）：水平距离 ≤ 半径 + 玩家半径，脚底高差在 [−1.5, maxHeight]（缺省 = 半径）；
        /// 掩体挡住胸口和眼睛时不受伤（ignoreCover 可关）；冲刺无敌 / 无敌期间不算命中。命中时按方向击退。返回是否命中
        /// </summary>
        public bool Blast(Vector3 center, float radius, float damage, in BossBlastOpts o = default)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || OwnerDead || !(radius > 0) || !Fx.Finite(center)) return false;
            if (!PlayerBody(out var feet, out var pr, out var ph)) return false;
            if (!InBlast(center, radius, o.maxHeight > 0 ? o.maxHeight : radius, feet, pr)) return false;
            if (!o.ignoreCover)
            {
                var motor = pv.GetComponent<PlayerMotor>();
                var chest = new Vector3(feet.x, feet.y + ph * 0.55f, feet.z);
                var eye = motor && motor.eye ? motor.eye.position : new Vector3(feet.x, feet.y + ph * 0.9f, feet.z);
                var c = center + Vector3.up * 0.5f;
                if (!Combat.LineClear(chest, c) && !Combat.LineClear(eye, c)) return false;
            }
            if (pv.Invulnerable) return false;
            var dir = new Vector3(feet.x - center.x, 0, feet.z - center.z);
            float d = dir.magnitude;
            dir = d > 0.05f ? dir / d : Vector3.zero;
            Hurt(damage, o.element, center + Vector3.up * 0.5f);
            if ((o.knockback > 0 || o.knockUp > 0) && !pv.Dead)
            {
                var m = pv.GetComponent<PlayerMotor>();
                if (m) m.AddImpulse(new Vector3(dir.x * o.knockback, o.knockUp, dir.z * o.knockback));
            }
            return true;
        }

        /// <summary>圆柱范围判定（纯几何）：水平距离 ≤ 半径 + 玩家半径，脚底相对中心的高差在 [−1.5, maxHeight]</summary>
        public static bool InBlast(Vector3 center, float radius, float maxHeight, Vector3 feet, float playerRadius)
        {
            float dx = feet.x - center.x, dz = feet.z - center.z;
            if (Mathf.Sqrt(dx * dx + dz * dz) > radius + playerRadius) return false;
            float h = feet.y - center.y;
            return h <= maxHeight && h >= -1.5f;
        }

        /// <summary>带半径的线段是否与玩家胶囊相交（Three.js segmentHitsPlayer）</summary>
        public bool SegmentHitsPlayer(Vector3 a, Vector3 b, float radius)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return false;
            if (!PlayerBody(out var feet, out var pr, out var ph)) return false;
            return SegmentHitsCapsule(a, b, radius, feet, pr, ph);
        }

        /// <summary>带半径的线段与竖直胶囊（脚底 feet、半径 pr、身高 ph）相交（纯几何）</summary>
        public static bool SegmentHitsCapsule(Vector3 a, Vector3 b, float radius, Vector3 feet, float pr, float ph)
        {
            var c = new Vector3(feet.x, feet.y + pr, feet.z);
            var d = new Vector3(feet.x, feet.y + Mathf.Max(pr, ph - pr), feet.z);
            float r = radius + pr;
            return SegSegDistSq(a, b, c, d) <= r * r;
        }

        /// <summary>两线段最近距离的平方（Ericson, Real-Time Collision Detection 5.1.9；同 TS segSegDistSq）</summary>
        public static float SegSegDistSq(Vector3 p1, Vector3 q1, Vector3 p2, Vector3 q2)
        {
            var d1 = q1 - p1;
            var d2 = q2 - p2;
            var r = p1 - p2;
            float a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2), f = Vector3.Dot(d2, r);
            const float Eps = 1e-8f;
            float s = 0, t = 0;
            if (a <= Eps && e <= Eps) return r.sqrMagnitude;
            if (a <= Eps) t = Mathf.Clamp01(f / e);
            else
            {
                float c = Vector3.Dot(d1, r);
                if (e <= Eps) s = Mathf.Clamp01(-c / a);
                else
                {
                    float b = Vector3.Dot(d1, d2);
                    float denom = a * e - b * b;
                    s = denom > Eps ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
                    t = (b * s + f) / e;
                    if (t < 0)
                    {
                        t = 0;
                        s = Mathf.Clamp01(-c / a);
                    }
                    else if (t > 1)
                    {
                        t = 1;
                        s = Mathf.Clamp01((b - c) / a);
                    }
                }
            }
            return (p1 + d1 * s - (p2 + d2 * t)).sqrMagnitude;
        }

        /// <summary>两个 yaw（弧度）的差，结果在 (−π, π]（同 TS angleDiff(a, b) = b − a 规约）</summary>
        public static float AngleDiff(float from, float to)
        {
            float d = Mathf.Repeat(to - from + Mathf.PI, Mathf.PI * 2f) - Mathf.PI;
            return d <= -Mathf.PI ? d + Mathf.PI * 2f : d;
        }

        /// <summary>水平方向的 yaw（弧度，atan2(x, z)：0 = +Z，同 Three.js facing 约定）</summary>
        public static float YawOf(Vector3 dir) => Mathf.Atan2(dir.x, dir.z);

        /// <summary>
        /// 低矮水平光束的扫掠判定（纯几何，Three.js Colossus.beamSweepHits）：本帧光束从 prevYaw 转到 curYaw（弧度）扫过的扇区是否覆盖玩家。
        /// 光束从 origin（光束旋转中心的水平位置）身前 start 米起、射程 range、中心离地 beamY（相对 floorY）、半径 beamRadius；
        /// 玩家脚底 feet、半径 pr、身高 ph。脚底离地超过 beamY + beamRadius + pr − pr 一截时跳得过去。掩体由调用方用 near → at 的连线再判
        /// </summary>
        public static bool BeamSweepHits(Vector3 origin, float floorY, float prevYaw, float curYaw, float beamY, float beamRadius, float start, float range,
            Vector3 feet, float pr, float ph, out Vector3 near, out Vector3 at)
        {
            near = at = default;
            float dx = feet.x - origin.x, dz = feet.z - origin.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d < 1e-3f) return false;
            float reach = beamRadius + pr;
            float h = feet.y - floorY;
            float lo = h + pr, hi = h + Mathf.Max(pr, ph - pr);
            float gap = Mathf.Max(0, Mathf.Max(lo - beamY, beamY - hi));
            if (gap >= reach) return false;
            float lateral = Mathf.Sqrt(reach * reach - gap * gap);
            if (d < start - lateral || d > start + range + lateral) return false;
            float tol = Mathf.Asin(Mathf.Min(1, lateral / d));
            float sweep = curYaw - prevYaw;
            float delta = AngleDiff(prevYaw, Mathf.Atan2(dx, dz));
            if (delta < Mathf.Min(0, sweep) - tol || delta > Mathf.Max(0, sweep) + tol) return false;
            float k = Mathf.Min(1, start / d);
            near = new Vector3(origin.x + dx * k, floorY + beamY, origin.z + dz * k);
            at = new Vector3(feet.x, floorY + beamY, feet.z);
            return true;
        }

        /// <summary>
        /// <see cref="BeamSweepHits(Vector3, float, float, float, float, float, float, float, Vector3, float, float, out Vector3, out Vector3)"/> 打到场上的玩家（光束与玩家之间被掩体挡住不算）
        /// </summary>
        public bool BeamSweepHits(Vector3 origin, float floorY, float prevYaw, float curYaw, float beamY, float beamRadius, float start, float range)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !PlayerBody(out var feet, out var pr, out var ph)) return false;
            if (!BeamSweepHits(origin, floorY, prevYaw, curYaw, beamY, beamRadius, start, range, feet, pr, ph, out var near, out var at)) return false;
            return !Combat.Blocked(near, at, null);
        }

        /// <summary>
        /// 冲击波的这一步扫到了玩家（纯几何，Three.js checkWave 去掉掩体那一段）：环带 [prevR − 半宽, r + 半宽] 按玩家半径放宽；
        /// 脚底相对波心高差在 [−0.6, height]；扇形波还要在 arcHalf（弧度）+ 玩家半径对应的角度以内
        /// </summary>
        public static bool WaveTouches(Vector3 center, float prevR, float r, float halfWidth, float height, bool full, float arcYaw, float arcHalf,
            Vector3 feet, float pr)
        {
            float h = feet.y - center.y;
            if (h > height || h < -0.6f) return false;
            float dx = feet.x - center.x, dz = feet.z - center.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d + pr < prevR - halfWidth || d - pr > r + halfWidth) return false;
            if (!full)
            {
                float ang = Mathf.Atan2(dx, dz);
                if (Mathf.Abs(AngleDiff(arcYaw, ang)) > arcHalf + pr / Mathf.Max(0.5f, d)) return false;
            }
            return true;
        }

        /// <summary>抛射物在进度 u（0..1）时的位置：起终点线性插值 + 抛物线 arc × 4u(1 − u)（同 TS stepLob）</summary>
        public static Vector3 LobPosition(Vector3 from, Vector3 to, float arc, float u)
        {
            u = Mathf.Clamp01(u);
            var p = Vector3.Lerp(from, to, u);
            p.y += arc * 4f * u * (1 - u);
            return p;
        }

        // ───────────── 任务 ─────────────

        /// <summary>seconds 秒后执行一次（危险物时钟；清场时取消）</summary>
        public void Later(float seconds, Action fn)
        {
            if (fn == null) return;
            tasks.Add(Clock + Mathf.Max(0, float.IsFinite(seconds) ? seconds : 0), fn);
        }

        /// <summary>每 interval 秒执行一次，持续 duration 秒（第一次在 interval 秒后；清场时取消）</summary>
        public void Repeat(float interval, float duration, Action fn)
        {
            if (fn == null || !(duration > 0)) return;
            interval = Mathf.Max(0.02f, interval);
            float end = Clock + duration;
            void Tick()
            {
                fn();
                if (Clock + interval <= end + 1e-4f) tasks.Add(Clock + interval, Tick);
            }
            tasks.Add(Clock + interval, Tick);
        }

        // ───────────── 预警 ─────────────

        WarnScope Scope(WarnKind kind) => kind == WarnKind.Hazard ? HazardWarnings : MoveWarnings;

        /// <summary>圆形地面预警：seconds 秒内由内向外填满</summary>
        public TelegraphHandle GroundWarning(Vector3 center, float radius, float seconds, Color color, WarnKind kind = WarnKind.Move)
        {
            WarningsDrawn++;
            return Scope(kind).Circle(center, radius, Mathf.Max(0.05f, seconds), color);
        }

        /// <summary>长条预警：从 from 朝 yaw（度）延伸 length、半宽 halfWidth，由近到远填满；hold = 填满后继续亮着的秒数（沿线依次破土的地刺）</summary>
        public TelegraphHandle LineWarning(Vector3 from, float yawDeg, float length, float halfWidth, float seconds, Color color, float hold = 0, WarnKind kind = WarnKind.Move)
        {
            WarningsDrawn++;
            float a = yawDeg * Mathf.Deg2Rad;
            var to = from + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * Mathf.Max(0.1f, length);
            return Scope(kind).Lane(from, to, Mathf.Max(0.1f, halfWidth * 2f), Mathf.Max(0.05f, seconds), color, Mathf.Max(0, hold));
        }

        /// <summary>扇形预警：中线朝 yaw（度）、半角 halfAngle（度）</summary>
        public TelegraphHandle SectorWarning(Vector3 center, float yawDeg, float halfAngleDeg, float radius, float seconds, Color color, WarnKind kind = WarnKind.Move)
        {
            WarningsDrawn++;
            return Scope(kind).Sector(center, yawDeg, halfAngleDeg, radius, Mathf.Max(0.05f, seconds), color);
        }

        /// <summary>环形预警（inner 以内安全）</summary>
        public TelegraphHandle AnnulusWarning(Vector3 center, float inner, float outer, float seconds, Color color, WarnKind kind = WarnKind.Move)
        {
            WarningsDrawn++;
            return Scope(kind).Annulus(center, inner, outer, Mathf.Max(0.05f, seconds), color);
        }

        /// <summary>辐条预警（放射弹幕）：count 条、长 length、全宽 width，第一条朝 yaw（度）</summary>
        public TelegraphHandle SpokesWarning(Vector3 center, int count, float length, float width, float yawDeg, float seconds, Color color, WarnKind kind = WarnKind.Move)
        {
            WarningsDrawn++;
            return Scope(kind).Spokes(center, count, length, width, yawDeg, Mathf.Max(0.05f, seconds), color);
        }

        /// <summary>撤回招式组里还没填满的预警（招式结束 / 被打断时自动调；hazard 组不受影响）</summary>
        public void CancelMoveWarnings() => MoveWarnings.Cancel();

        // ───────────── 冲击波 ─────────────

        public void Wave(in BossWaveSpec s)
        {
            if (OwnerDead || !Fx.Finite(s.center) || !(s.maxRadius > 0)) return;
            var w = new WaveRun
            {
                spec = s,
                front = new WaveFront(Mathf.Max(0, s.startRadius), Mathf.Max(0.5f, s.speed), s.maxRadius, Mathf.Max(0.05f, s.width) * 0.5f),
                hit = s.spare,
            };
            float dur = Mathf.Max(0.05f, (s.maxRadius - Mathf.Max(0, s.startRadius)) / Mathf.Max(0.5f, s.speed));
            w.ring = Telegraph.Spawn(new TelegraphSpec
            {
                shape = s.FullCircle ? TelegraphShape.Circle : TelegraphShape.Sector, style = TelegraphStyle.Ring, center = s.center,
                yaw = s.arcYaw, halfAngle = Mathf.Min(180, s.arcHalf), radius = s.maxRadius, duration = dur, color = s.color, additive = true, linear = true,
            });
            waves.Add(w);
            WavesSpawned++;
        }

        bool StepWave(WaveRun w, float dt)
        {
            w.front.Step(dt);
            if (w.front.Done) return false;
            var s = w.spec;
            if (!w.hit) CheckWave(w);
            if (s.dust)
            {
                w.dustAcc += dt;
                if (w.dustAcc >= DustEvery)
                {
                    w.dustAcc = 0;
                    float a = s.FullCircle ? UnityEngine.Random.value * Mathf.PI * 2f
                        : s.arcYaw * Mathf.Deg2Rad + (UnityEngine.Random.value * 2 - 1) * s.arcHalf * Mathf.Deg2Rad;
                    var p = s.center + new Vector3(Mathf.Sin(a) * w.front.r, 0.2f, Mathf.Cos(a) * w.front.r);
                    Fx.Burst(p, s.dustColor, 3, 2.5f, 0.45f, 0.16f, 4f);
                }
            }
            return true;
        }

        void CheckWave(WaveRun w)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !PlayerBody(out var feet, out var pr, out _)) return;
            var s = w.spec;
            if (!WaveTouches(s.center, w.front.prevR, w.front.r, w.front.halfWidth, s.height, s.FullCircle, s.arcYaw * Mathf.Deg2Rad, s.arcHalf * Mathf.Deg2Rad, feet, pr))
                return;
            float dx = feet.x - s.center.x, dz = feet.z - s.center.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            // 掩体挡波
            if (d > 1.2f && Combat.Blocked(s.center + Vector3.up * 0.45f, new Vector3(feet.x, s.center.y + 0.45f, feet.z), null)) return;
            w.hit = true;
            if (pv.Invulnerable) return;
            Hurt(s.damage, s.element, s.center + Vector3.up * 0.5f);
            if (s.knockback > 0 && d > 0.05f && !pv.Dead)
            {
                var m = pv.GetComponent<PlayerMotor>();
                if (m) m.AddImpulse(new Vector3(dx / d * s.knockback, WaveKnockUp, dz / d * s.knockback));
            }
        }

        // ───────────── 持续伤害区 ─────────────

        /// <summary>
        /// 持续伤害区 / 环带（E4 <see cref="HazardZone"/>）：预警 arm 秒（hazard 组：圆 / 环），之后每 interval 秒检测一次（与 TS 的 repeat 同相位），
        /// 站在里面 = 水平距离 ≤ 半径 + 玩家半径 / 2（环带还要 ≥ 内半径 − 玩家半径 / 2）、脚底高差在 [−1, maxHeight]。环带不铺整块贴片，改用环形区域特效
        /// </summary>
        public HazardZone Zone(in BossZoneSpec s)
        {
            if (OwnerDead || !Fx.Finite(s.center) || !(s.radius > 0)) return null;
            float arm = Mathf.Max(0, s.arm), interval = Mathf.Max(0.05f, s.interval);
            bool ring = s.innerRadius > 0;
            if (arm > 0)
            {
                if (ring) AnnulusWarning(s.center, s.innerRadius, s.radius, arm, s.color, WarnKind.Hazard);
                else GroundWarning(s.center, s.radius, arm, s.color, WarnKind.Hazard);
            }
            var spec = new HazardZone.Spec(s.center, s.radius, Mathf.Max(0, s.duration), s.damage)
            {
                innerRadius = Mathf.Max(0, s.innerRadius),
                arm = arm,
                interval = interval,
                // TS：任务每 interval 秒一跳、只在生效期内算——生效后第一跳 = 下一个 interval 的整数倍
                firstTick = Mathf.Repeat(-arm, interval),
                element = s.element,
                minRise = -1f,
                maxRise = Mathf.Max(0.05f, s.maxHeight),
                pad = 0.18f,
                color = s.color,
                source = owner,
                telegraph = false,
                decal = !ring,
                sparks = s.embers,
            };
            var z = HazardZone.Spawn(spec);
            if (ring && s.duration > 0)
            {
                // 环带的生效外观：环形区域特效（只在生效期，预警期由上面的环形预警负责）
                var h = s;
                Later(arm, () =>
                {
                    if (!z || z.Ended) return;
                    visuals.Add(Telegraph.Spawn(new TelegraphSpec
                    {
                        shape = TelegraphShape.Annulus, style = TelegraphStyle.Zone, center = h.center, radius = h.radius, inner = Mathf.Min(h.innerRadius, h.radius * 0.98f),
                        duration = h.duration, color = h.color,
                    }));
                });
            }
            zones.Add(z);
            ZonesSpawned++;
            return z;
        }

        // ───────────── 抛射 / 坠落 ─────────────

        public void Lob(in BossLobSpec s)
        {
            if (OwnerDead || !Fx.Finite(s.from) || !Fx.Finite(s.to)) return;
            var obj = BuildLobModel(s);
            obj.position = s.from;
            if (s.warn) GroundWarning(s.to, s.radius, Mathf.Max(0.2f, s.time), s.color, WarnKind.Hazard);
            lobs.Add(new LobRun
            {
                spec = s, obj = obj,
                spin = new Vector3((UnityEngine.Random.value - 0.5f) * 460f, 0, (UnityEngine.Random.value - 0.5f) * 460f),
            });
            LobsSpawned++;
        }

        Transform BuildLobModel(in BossLobSpec s)
        {
            var root = new GameObject($"Boss Lob ({s.kind})").transform;
            float sc = Mathf.Max(0.2f, s.scale) * (0.9f + UnityEngine.Random.value * 0.25f);
            root.localScale = Vector3.one * sc;
            switch (s.kind)
            {
                case LobKind.Meteor:
                {
                    var core = PropBits.Box(root, "Core", Vector3.zero, Vector3.one * 1.1f, Hex.Rgb(0xffb05a));
                    core.sharedMaterial = FxMaterials.Unlit;
                    FxMaterials.Tint(core, Hex.Rgb(0xffb05a) * 1.6f);
                    FxMaterials.GlowSprite(root, 3.2f, new Color(1f, 0.32f, 0.08f, 0.75f));
                    break;
                }
                case LobKind.Ice:
                    PropBits.Box(root, "Ice", Vector3.zero, new Vector3(0.9f, 1.2f, 0.9f), Hex.Rgb(0xbfefff)).transform.localRotation = Quaternion.Euler(45, 0, 45);
                    break;
                default:
                    PropBits.Box(root, "Rock", Vector3.zero, Vector3.one * 1.45f, Hex.Rgb(0x7d6048)).transform.localRotation = Quaternion.Euler(20, 35, 10);
                    PropBits.Box(root, "Rune", new Vector3(0, 0.2f, 0.72f), new Vector3(0.9f, 0.12f, 0.12f), Hex.Rgb(0xffa53a));
                    break;
            }
            return root;
        }

        bool StepLob(LobRun l, float dt)
        {
            l.t += dt;
            float time = Mathf.Max(0.2f, l.spec.time);
            float u = Mathf.Min(1, l.t / time);
            if (l.obj)
            {
                l.obj.position = LobPosition(l.spec.from, l.spec.to, l.spec.arc, u);
                l.obj.Rotate(l.spin * dt, Space.Self);
            }
            if (l.spec.kind == LobKind.Meteor && l.obj)
            {
                l.trailAcc += dt;
                if (l.trailAcc >= TrailEvery)
                {
                    l.trailAcc = 0;
                    Fx.Burst(l.obj.position, l.spec.color, 2, 1.6f, 0.45f, 0.3f, -1f);
                }
            }
            if (u < 1) return true;
            if (l.obj) Destroy(l.obj.gameObject);
            Land(l.spec);
            return false;
        }

        void Land(in BossLobSpec s)
        {
            var p = s.to;
            Blast(p, s.radius, s.damage, new BossBlastOpts { maxHeight = s.radius * 0.9f, element = s.element, knockback = LobKnockback, knockUp = LobKnockUp });
            Fx.Explosion(p + Vector3.up * 0.4f, s.radius, s.color);
            var debris = s.kind == LobKind.Ice ? Hex.Rgb(0xd8f6ff) : s.kind == LobKind.Meteor ? Hex.Rgb(0xffc070) : Hex.Rgb(0xb58a5a);
            Fx.Burst(p + Vector3.up * 0.3f, debris, 14, 7f, 0.9f, 0.2f, 20f);
            CameraShake.Quake(p, 0.38f, 24f, 0.25f);
            GameAudio.PlayAt("explosion", p + Vector3.up * 0.3f, 0.7f, s.kind == LobKind.Boulder ? 0.75f : 1f);
            try
            {
                s.onLand?.Invoke(p);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 地刺 ─────────────

        public void Erupt(in BossEruptSpec s)
        {
            if (OwnerDead || !Fx.Finite(s.center)) return;
            if (s.warn) GroundWarning(s.center, s.radius, Mathf.Max(0.05f, s.delay), s.color, WarnKind.Hazard);
            var spec = s;
            Later(s.delay, () => SpawnSpike(spec));
            EruptsSpawned++;
        }

        void SpawnSpike(in BossEruptSpec s)
        {
            if (OwnerDead) return;
            var color = s.kind == SpikeKind.Ice ? Hex.Rgb(0xbfefff) : Hex.Rgb(0x9a6d40);
            SpikeField.Spawn(new SpikeField.Spec(s.center, Mathf.Max(0.3f, s.radius * 0.5f), 0.6f, Mathf.Max(0.6f, s.radius * 2f)) { count = 3, block = false, color = color });
            var v = s.volley;
            if (v == null || !v.hit)
            {
                bool hit = Blast(s.center, s.radius, s.damage, new BossBlastOpts { maxHeight = s.height, knockUp = SpikeKnockUp, ignoreCover = true });
                if (hit && v != null) v.hit = true;
            }
            var at = s.center + Vector3.up * 0.3f;
            Fx.Burst(at, s.kind == SpikeKind.Ice ? Hex.Rgb(0xd8f6ff) : Hex.Rgb(0xc49a64), 8, 5f, 0.6f, 0.18f, 16f);
            if (s.sound) GameAudio.PlayAt("boss_slam", at, 0.45f, 1.3f);
        }

        // ───────────── 光束 ─────────────

        /// <summary>要一条光束（招式每帧 <see cref="BossBeam.Set"/>，用完 <see cref="BossBeam.Release"/>；清场时自动收起）</summary>
        public BossBeam Beam(Color color)
        {
            var b = new BossBeam(this, color);
            beams.Add(b);
            BeamsSpawned++;
            return b;
        }

        internal void Forget(BossBeam b) => beams.Remove(b);

        /// <summary>收起一条光束（null 安全）</summary>
        public void ReleaseBeam(BossBeam b) => b?.Release();

        // ───────────── 更新 / 清理 ─────────────

        void Update() => Step(Time.deltaTime);

        /// <summary>推进 dt 秒：任务到点执行、冲击波 / 抛射物前进、熄灭的持续区出表</summary>
        public void Step(float dt)
        {
            if (!(dt > 0) || !float.IsFinite(dt)) return;
            Clock += dt;
            tasks.Run(Clock);
            for (int i = waves.Count - 1; i >= 0; i--)
                if (!StepWave(waves[i], dt))
                    waves.RemoveAt(i);
            for (int i = lobs.Count - 1; i >= 0; i--)
                if (!StepLob(lobs[i], dt))
                    lobs.RemoveAt(i);
            zones.RemoveAll(z => !z);
            if (visuals.Count > 16) visuals.RemoveAll(v => !v.Alive);
        }

        /// <summary>
        /// 清场（Three.js clear）：取消全部任务、收起两组预警（不管填没填满）、移除飞行中的抛射物、熄灭持续区、收起冲击波与光束。首领倒下 / 物体销毁时自动调；可重复调用
        /// </summary>
        public void ClearAll()
        {
            Clears++;
            tasks.Clear();
            MoveWarnings.End();
            HazardWarnings.End();
            foreach (var w in waves) w.ring.FadeOut();
            waves.Clear();
            foreach (var l in lobs)
                if (l.obj)
                    Destroy(l.obj.gameObject);
            lobs.Clear();
            foreach (var z in zones)
                if (z)
                    z.Expire();
            zones.Clear();
            foreach (var b in beams.ToArray()) b.Release();
            beams.Clear();
            foreach (var v in visuals) v.Cancel();
            visuals.Clear();
        }
    }
}
