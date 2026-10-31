using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第四章雷魅的一招（网页版 src/world/plateau/play/moves.ts 的 MoveDef，docs/level-design/chuanzang-combat-v1.md 0.1）：
    /// 前摇 windup（画预警，填满的那一刻出手）→ 出手 active（判定；按距离结束的招是上限）→ 收招 recover（固定破绽）。
    /// 招式 id = 动画状态名 = <c>Anim/&lt;资产&gt;.events.json</c> 的片段名；时间点照 docs/art/ch4-move-events.json。
    /// </summary>
    public sealed class PlateauMove
    {
        public string id, name;
        public float windup, active, recover, cooldown;
        /// <summary>霸体：出招中硬直打不断（眩晕照样打断）</summary>
        public bool armored;
        /// <summary>危险招：出手前 0.25 s 在弱点上闪白星（glint 事件）</summary>
        public bool glint;
        /// <summary>没有 hit（位移、增益类）</summary>
        public bool noHit;
        /// <summary>额外的时间点（秒，从前摇开始算）</summary>
        public (float at, string name)[] events = Array.Empty<(float, string)>();

        public float Total => windup + active + recover;

        /// <summary>这一招的全部时间点（warn / glint / hit / 自定义 / end），按时间排序（同 moves.ts moveEvents）</summary>
        public List<(float at, string name)> Timeline()
        {
            var ev = new List<(float, string)> { (0f, "warn") };
            if (glint) ev.Add((Mathf.Max(0, windup - 0.25f), "glint"));
            if (!noHit) ev.Add((windup, "hit"));
            ev.AddRange(events);
            ev.Add((Total, "end"));
            // 稳定排序：同一时刻按登记顺序（warn 永远第一、end 永远最后）
            var idx = new List<(float at, string name, int i)>();
            for (int i = 0; i < ev.Count; i++) idx.Add((ev[i].Item1, ev[i].Item2, i));
            idx.Sort((a, b) => a.at != b.at ? a.at.CompareTo(b.at) : a.i.CompareTo(b.i));
            var outList = new List<(float, string)>(idx.Count);
            foreach (var e in idx) outList.Add((e.at, e.name));
            return outList;
        }
    }

    /// <summary>
    /// 雷魅的招式表（照抄 foes.ts 的 defineMoves；秒数与 docs/art/ch4-move-events.json 一致，EditMode 测试逐项核对）
    /// </summary>
    public static class PlateauMoves
    {
        static PlateauMove M(string id, string name, float w, float a, float r, float cd = 0, bool glint = false, bool noHit = false, params (float, string)[] ev) =>
            new() { id = id, name = name, windup = w, active = a, recover = r, cooldown = cd, glint = glint, noHit = noHit, events = ev };

        public static readonly PlateauMove MarmotScream = M("scream", "尖啸", 1.2f, 0.3f, 0.6f, noHit: true, ev: (1.2f, "shout"));
        public static readonly PlateauMove MarmotBite = M("bite", "扑咬", 0.35f, 0.2f, 0.6f, 1.2f);
        public static readonly PlateauMove MarmotBurrow = M("burrow", "钻洞", 0.25f, 1.2f, 0.4f, 6, noHit: true, ev: new[] { (0.25f, "hide"), (1.45f, "emerge") });

        public static readonly PlateauMove TiangouHowl = M("howl", "雷吠", 1.2f, 0.6f, 0.6f, 7, noHit: true, ev: new[] { (1.2f, "lock"), (1.8f, "strike") });
        public static readonly PlateauMove TiangouPounce = M("pounce", "扑咬", 0.3f, 0.4f, 0.7f, 2.5f);

        public static readonly PlateauMove AoyinStampede = M("stampede", "刨地 → 领群踩踏", 1.0f, 3.0f, 1.2f, 5, glint: true);
        public static readonly PlateauMove AoyinGore = M("gore", "四角挑", 0.55f, 0.25f, 0.7f, 1.6f);
        public static readonly PlateauMove AoyinSlam = M("slam", "雷球砸地", 1.4f, 0.3f, 1.0f, glint: true);

        public static readonly PlateauMove JufuClimb = M("climb", "抢高", 0.5f, 1.0f, 0.5f, noHit: true, ev: (1.5f, "land"));
        public static readonly PlateauMove JufuThrow = M("throw", "远投", 1.0f, 0.1f, 0.8f, 3, noHit: true, ev: (1.0f, "release"));
        public static readonly PlateauMove JufuShove = M("shove", "推开", 0.45f, 0.2f, 0.6f, 2);
        public static readonly PlateauMove JufuFall = M("fall", "摔下高处", 0, 0.8f, 1.5f, noHit: true, ev: (0.8f, "land"));

        public static readonly PlateauMove ManmanSweep = M("sweep", "电弧横扫", 0.8f, 1.2f, 1.0f, 6);
        public static readonly PlateauMove ManmanBolt = M("bolt", "电弹", 0.4f, 0.1f, 0.3f, 3, noHit: true, ev: (0.4f, "release"));

        public static readonly PlateauMove LianguBeat = M("beat", "鼓点", 0.25f, 0.1f, 0.85f, noHit: true, ev: (0.25f, "beat"));
        public static readonly PlateauMove LianguClap = M("clap", "惊雷", 0.8f, 0.2f, 1.0f, 3);
        public static readonly PlateauMove LianguOrb = M("orb", "雷心弹", 0.4f, 0.1f, 1.3f, noHit: true, ev: (0.4f, "release"));

        public static readonly PlateauMove DijiangSwell = M("swell", "球雷", 0.8f, 0.1f, 0, glint: true);

        public static readonly PlateauMove QiongqiGlide = M("glide", "掠空扑杀", 0.7f, 1.6f, 0.8f, 4, glint: true, ev: (2.3f, "land"));
        public static readonly PlateauMove QiongqiSpin = M("spin", "翼刃雷旋", 0.5f, 0.4f, 0.8f, 3);
        public static readonly PlateauMove QiongqiClaw = M("claw", "爪击", 0.35f, 0.5f, 0.6f, 1.2f, noHit: true, ev: new[] { (0.45f, "hit1"), (0.7f, "hit2") });
        public static readonly PlateauMove QiongqiAbsorb = M("absorb", "吞雷", 0.8f, 0.6f, 0.4f, noHit: true, ev: (0.8f, "eat"));

        /// <summary>资产 → 招式表（EditMode 测试对照 ch4-move-events.json）</summary>
        public static readonly Dictionary<string, PlateauMove[]> ByAsset = new()
        {
            ["SK_Enemy_Marmot"] = new[] { MarmotScream, MarmotBite, MarmotBurrow },
            ["SK_Enemy_Tiangou"] = new[] { TiangouHowl, TiangouPounce },
            ["SK_Enemy_Aoyin"] = new[] { AoyinStampede, AoyinGore, AoyinSlam },
            ["SK_Enemy_Jufu"] = new[] { JufuClimb, JufuThrow, JufuShove, JufuFall },
            ["SK_Enemy_Manman"] = new[] { ManmanSweep, ManmanBolt },
            ["SM_EnemyPart_LianguCore"] = new[] { LianguBeat, LianguClap, LianguOrb },
            ["SK_Enemy_Dijiang"] = new[] { DijiangSwell },
            ["SK_Enemy_Qiongqi"] = new[] { QiongqiGlide, QiongqiSpin, QiongqiClaw, QiongqiAbsorb },
        };
    }

    /// <summary>
    /// 跑一招（moves.ts MoveRunner 的 Unity 版）：<see cref="Tick"/> 推进时间，把到点的时间点放进列表。
    /// 出手跟动画事件走：片段（<c>Anim/&lt;资产&gt;.events.json</c>）的 OnAnimEvent 先到就先出（<see cref="OnAnimEvent"/>），
    /// 没收到（占位体、片段缺失）就按时间轴兜底——同 BossMove.Cue，两者先到者算，每个时间点只出一次。
    /// 事件只认「这一招还没出、而且离它在时间轴上的时刻 ±0.15 s 以内」的：交叉淡出的上一招片段发的同名事件不会被误认。
    /// 每个时间点记下实际出手时刻与时间轴时刻的差（<see cref="CueDelta"/>，节拍条 / 冒烟验收「判定误差 ≤ 1 帧」用）。
    /// </summary>
    public sealed class PlateauMoveRunner
    {
        public PlateauMove Def { get; private set; }
        /// <summary>本招已进行的秒数（受出手速度倍率影响）</summary>
        public float T { get; private set; }
        /// <summary>出手速度倍率（连鼓灵红鼓 1.4）</summary>
        public float speed = 1;
        /// <summary>每招出过几次（试玩套件查覆盖）</summary>
        public readonly Dictionary<string, int> Count = new();
        /// <summary>最近一次各时间点：实际出手时刻 − 时间轴时刻（秒；动画事件早到为负）、是不是动画事件先到</summary>
        public readonly Dictionary<string, (float delta, bool anim)> CueDelta = new();

        readonly List<(float at, string name)> events = new();
        readonly HashSet<string> seen = new();
        int next;
        float activeLen;

        public bool Busy => Def != null;
        public string Id => Def?.id ?? "";
        public float ActiveLength => activeLen;

        public MoveStage Stage
        {
            get
            {
                if (Def == null) return MoveStage.None;
                if (T < Def.windup) return MoveStage.Windup;
                if (T < Def.windup + activeLen) return MoveStage.Active;
                return MoveStage.Recover;
            }
        }

        /// <summary>当前这一段已进行的秒数</summary>
        public float StageT => Def == null ? 0 : T < Def.windup ? T : T < Def.windup + activeLen ? T - Def.windup : T - Def.windup - activeLen;

        /// <summary>当前这一段的进度 0..1</summary>
        public float StageK
        {
            get
            {
                if (Def == null) return 0;
                float len = Stage == MoveStage.Windup ? Def.windup : Stage == MoveStage.Active ? activeLen : Def.recover;
                return len > 0 ? Mathf.Min(1, StageT / len) : 1;
            }
        }

        /// <summary>收招段在片段里的起点（秒；提前收招时 Animator 跳到这里）</summary>
        public float RecoverClipTime => Def == null ? 0 : Def.windup + Def.active;

        public void Start(PlateauMove def)
        {
            Def = def;
            T = 0;
            activeLen = def.active;
            events.Clear();
            events.AddRange(def.Timeline());
            next = 0;
            seen.Clear();
            Count[def.id] = Count.TryGetValue(def.id, out int n) ? n + 1 : 1;
        }

        /// <summary>出手段提前结束（冲撞撞到东西、滑翔落地）：直接进收招，之后的时间点平移到新的出手结束时刻</summary>
        public void FinishActive()
        {
            if (Def == null || Stage != MoveStage.Active) return;
            float cut = T - Def.windup;
            float shift = Def.active - cut;
            activeLen = cut;
            float cutAt = Def.windup + cut;
            for (int i = next; i < events.Count; i++)
            {
                var e = events[i];
                if (e.at >= Def.windup + Def.active - 1e-4f) events[i] = (e.at - shift, e.name);
                else if (e.at > cutAt) events[i] = (cutAt, e.name);
            }
        }

        public void Cancel()
        {
            Def = null;
            T = 0;
        }

        /// <summary>动画事件（CreatureRig.AnimEvent 转来）</summary>
        public void OnAnimEvent(string name)
        {
            if (Def == null || string.IsNullOrEmpty(name)) return;
            for (int i = next; i < events.Count; i++)
                if (events[i].name == name && Mathf.Abs(events[i].at - T) <= 0.15f)
                {
                    seen.Add(name);
                    return;
                }
        }

        /// <summary>推进 dt 秒，把到点（或动画事件先到）的时间点按顺序放进 fired（先清空）</summary>
        public void Tick(float dt, List<string> fired)
        {
            fired.Clear();
            if (Def == null) return;
            T += dt * speed;
            while (next < events.Count)
            {
                var e = events[next];
                bool byAnim = seen.Contains(e.name);
                if (!byAnim && e.at > T + 1e-5f) break;
                CueDelta[e.name] = (T - e.at, byAnim && e.at > T + 1e-5f);
                fired.Add(e.name);
                next++;
            }
            if (T >= Def.windup + activeLen + Def.recover - 1e-5f && next >= events.Count) Def = null;
        }
    }

    /// <summary>
    /// 一群雷魅（网页 EncounterState：领地、整片警觉、出手令牌）。Unity 里遭遇点一次刷一片，按出生位置聚群：
    /// 出生时加入 <see cref="JoinRadius"/> 内最近的一群，没有就自成一群。
    /// 令牌（combat 1.4）：每群 近战扑击 2、天狗扑咬 1、远程 2、雷吠 1；玩家刚挨打 0.6 s 内近战令牌冻结（不连段到死）。
    /// 全局的 <see cref="AttackTokens"/> 照样申请（跨群的总上限）。
    /// </summary>
    public sealed class PlateauPack
    {
        public enum Token { Melee, Pounce, Ranged, Howl }

        public const float JoinRadius = 28f;
        static readonly int[] Limits = { 2, 1, 2, 1 };
        static readonly List<PlateauPack> packs = new();
        static float playerHurtAt = -99;
        static bool hooked;

        public readonly List<PlateauEnemyAI> members = new();
        public Vector3 anchor;
        public bool alerted;
        /// <summary>洞口（啸獭钻洞的落点；关卡没给就用出生点周围随机的几处）</summary>
        public readonly List<Vector3> burrows = new();
        readonly Dictionary<PlateauEnemyAI, Token> holds = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            packs.Clear();
            playerHurtAt = -99;
            hooked = false;
        }

        public static IReadOnlyList<PlateauPack> All => packs;

        /// <summary>出生时入群</summary>
        public static PlateauPack Join(PlateauEnemyAI ai)
        {
            if (!hooked)
            {
                hooked = true;
                Combat.PlayerDamaged += (_, _) => playerHurtAt = Time.time;
                GameEvents.StageLoaded += _ => packs.Clear();
            }
            packs.RemoveAll(p => p.members.TrueForAll(m => !m || m.Dead));
            var at = ai.transform.position;
            PlateauPack best = null;
            float bd = JoinRadius;
            foreach (var p in packs)
            {
                float d = Vector3.Distance(Flat(p.anchor), Flat(at));
                if (d < bd)
                {
                    bd = d;
                    best = p;
                }
            }
            if (best == null)
            {
                best = new PlateauPack { anchor = at };
                packs.Add(best);
            }
            best.members.Add(ai);
            return best;
        }

        /// <summary>全部清空（测试场换一批）</summary>
        public static void Reset() => packs.Clear();

        public void Leave(PlateauEnemyAI ai)
        {
            members.Remove(ai);
            holds.Remove(ai);
        }

        /// <summary>活着的同伴（不含自己）</summary>
        public IEnumerable<PlateauEnemyAI> Mates(PlateauEnemyAI self)
        {
            foreach (var m in members)
                if (m && m != self && !m.Dead)
                    yield return m;
        }

        /// <summary>整群警觉</summary>
        public void Alert()
        {
            if (alerted) return;
            alerted = true;
            foreach (var m in members.ToArray())
                if (m && !m.Dead)
                    m.Notice(false);
        }

        /// <summary>叫醒 radius 米内的所有兽群（啸獭哨兵尖啸）；返回叫醒了几群</summary>
        public static int WakeAround(Vector3 at, float radius)
        {
            int n = 0;
            foreach (var p in packs.ToArray())
            {
                if (p.alerted) continue;
                foreach (var m in p.members)
                    if (m && !m.Dead && Vector3.Distance(Flat(m.transform.position), Flat(at)) <= radius)
                    {
                        p.Alert();
                        n++;
                        break;
                    }
            }
            return n;
        }

        /// <summary>拿令牌（已拿着同类的直接 true）</summary>
        public bool Take(PlateauEnemyAI who, Token kind)
        {
            if (holds.TryGetValue(who, out var held) && held == kind) return true;
            int used = 0;
            foreach (var (m, k) in holds)
                if (k == kind && m && !m.Dead)
                    used++;
            if (used >= Limits[(int)kind]) return false;
            if (kind != Token.Ranged && Time.time - playerHurtAt < 0.6f) return false;
            holds[who] = kind;
            return true;
        }

        public bool Holding(PlateauEnemyAI who, Token kind) => holds.TryGetValue(who, out var k) && k == kind;
        public void Give(PlateauEnemyAI who) => holds.Remove(who);

        public static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
    }

    /// <summary>第四章雷魅的几何小工具</summary>
    public static class PlateauGeo
    {
        /// <summary>点到线段的水平距离</summary>
        public static float SegDist(Vector3 p, Vector3 a, Vector3 b)
        {
            float vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
            float t = L > 1e-6f ? Mathf.Clamp01(((p.x - a.x) * vx + (p.z - a.z) * vz) / L) : 0;
            float dx = p.x - a.x - vx * t, dz = p.z - a.z - vz * t;
            return Mathf.Sqrt(dx * dx + dz * dz);
        }

        /// <summary>点在以 at 为心、朝 yaw（弧度）、半角 half、半径 r 的水平扇形里（1 m 内总算在）</summary>
        public static bool InCone(Vector3 p, Vector3 at, float yaw, float r, float half)
        {
            float dx = p.x - at.x, dz = p.z - at.z, d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d > r) return false;
            if (d < 1) return true;
            float a = Mathf.Atan2(dx, dz) - yaw;
            return Mathf.Abs(Mathf.Atan2(Mathf.Sin(a), Mathf.Cos(a))) <= half;
        }

        /// <summary>从 at 推开 p 的水平击退（k m/s）+ 上抛</summary>
        public static Vector3 Knock(Vector3 p, Vector3 at, float k, float up = 0)
        {
            var d = new Vector3(p.x - at.x, 0, p.z - at.z);
            float m = Mathf.Max(0.5f, d.magnitude);
            return d / m * k + Vector3.up * up;
        }
    }
}
