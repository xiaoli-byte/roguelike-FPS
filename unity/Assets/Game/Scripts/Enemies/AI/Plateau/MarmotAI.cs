using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 啸獭（第四章群怪·哨兵；combat 3.1，设计单 foes-ch4.md 第 1 节）：成窝出现，每窝一只哨兵（入群的第一只啸獭），单只很脆。
    ///   · 尖啸 <c>scream</c>（哨兵发现玩家时）：直立仰头、嘴边紫光，1.2 s 时三圈声环扩开、叫醒 60 m 内的兽群；前摇里打死 / 打出硬直就只醒自己这窝。
    ///   · 扑咬 <c>bite</c>：拿到群内近战令牌、贴到 2 m：伏低炸毛 0.35 s → 往前扑，1.8 m 内 6（带电时挂雷殛）。拿不到令牌的在 4–6 m 绕着蹦。
    ///   · 钻洞 <c>burrow</c>：1 s 内挨两枪，或被贴到 3 m 且血不到一半：一头扎进洞（无敌），土包沿地面移到 6–10 m 外另一个洞口钻出来。
    ///   · 电网（<see cref="MarmotNet"/>）：3 只以上相距 4.5 m 内连成网，网里的都带电，碰到电弧每 0.4 s 4 + 雷殛。
    /// </summary>
    public sealed class MarmotAI : PlateauEnemyAI
    {
        /// <summary>扑咬判定距离 / 伤害、出手距离；尖啸叫醒半径、哨兵视距</summary>
        public const float BiteRange = 1.8f, BiteDamage = 6f, BiteTrigger = 2.0f;
        public const float ScreamRadius = 60f, SentinelSight = 48f;

        public bool Sentinel { get; private set; }
        /// <summary>尖啸：0 没叫、1 正在叫、2 叫完了、3 被打断</summary>
        public int Screamed { get; private set; }
        public bool Burrowed { get; private set; }
        public bool InNet { get; internal set; }
        /// <summary>尖啸叫醒了几群（试玩套件读）</summary>
        public int Woke { get; private set; }

        readonly List<float> hits = new();
        readonly List<Collider> hidden = new();
        Vector3 burrowTo, burrowFrom;
        float burrowCd, dirtT;
        Renderer[] renderers;

        protected override void Awake()
        {
            glowBoneName = "orb";
            glowSize = 0.6f;
            sight = 26f;
            centerY = 0.35f;
            base.Awake();
            renderers = GetComponentsInChildren<Renderer>(true);
            hp.Damaged += (info, r) =>
            {
                if (r.total > 0) hits.Add(Time.time);
            };
        }

        protected override void OnJoined()
        {
            bool has = false;
            foreach (var m in Pack.Mates(this))
                if (m is MarmotAI mm && mm.Sentinel)
                    has = true;
            Sentinel = !has;
            if (Pack.burrows.Count == 0)
            {
                // 洞口：窝边 3–5 个（关卡没给就在出生点周围 5–8 m 随机放在导航网格上）
                int n = Random.Range(3, 6);
                for (int i = 0; i < n; i++)
                {
                    float a = i * Mathf.PI * 2 / n + Random.Range(-0.4f, 0.4f);
                    var p = Pack.anchor + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * Random.Range(5f, 8f);
                    if (NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) Pack.burrows.Add(hit.position);
                }
            }
        }

        protected override float Sight => Sentinel ? SentinelSight : sight;

        protected override void Update()
        {
            base.Update();
            if (!Dead && Pack != null) MarmotNet.For(Pack).Tick();
        }

        protected override void OnNotice(bool self)
        {
            if (Sentinel && Screamed == 0)
            {
                Screamed = 1;
                Begin(PlateauMoves.MarmotScream);
            }
        }

        /// <summary>强制尖啸（试玩套件 / 采样场景）</summary>
        public void ForceScream()
        {
            Screamed = 1;
            Notice(false);
            Begin(PlateauMoves.MarmotScream);
        }

        protected override void Fight(float dt, float dist)
        {
            // 钻洞换位
            hits.RemoveAll(t => Time.time - t > 1f);
            if (Time.time >= burrowCd && Pack.burrows.Count > 0 && (hits.Count >= 2 || (dist < 3f && hp.health < hp.maxHealth * 0.5f)) && PickHole())
            {
                burrowCd = Time.time + PlateauMoves.MarmotBurrow.cooldown;
                hits.Clear();
                Begin(PlateauMoves.MarmotBurrow);
                return;
            }
            // 扑咬：拿到近战令牌、贴到 2 m
            if (dist < BiteTrigger * Size / 1.3f + 0.3f && cooldown <= 0 && TakeToken(PlateauPack.Token.Melee, AttackTokens.Kind.Melee, 1.5f))
            {
                cooldown = PlateauMoves.MarmotBite.cooldown;
                Begin(PlateauMoves.MarmotBite);
                return;
            }
            bool has = HoldingToken(PlateauPack.Token.Melee) || TakeToken(PlateauPack.Token.Melee, AttackTokens.Kind.Melee, 2f);
            if (has) MoveTo(PlayerPos, moveSpeed);
            else
            {
                // 拿不到令牌：在 4–6 m 绕着蹦
                float side = Mathf.Repeat(home.x, 2f) > 1 ? 1 : -1;
                var from = transform.position - PlayerPos;
                from.y = 0;
                float a = Mathf.Atan2(from.x, from.z) + side * 0.9f;
                float R = 4.5f + 1.5f * Mathf.Sin(Time.time * 2 + home.z);
                MoveTo(PlayerPos + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * R, moveSpeed);
            }
            FaceAimTravel(540f, dt);
            Loco();
        }

        /// <summary>强制钻洞（试玩套件）：挑一个洞口钻过去</summary>
        public bool ForceBurrow()
        {
            if (Pack.burrows.Count == 0 || !PickHole()) return false;
            Notice(false);
            Begin(PlateauMoves.MarmotBurrow);
            return true;
        }

        bool PickHole()
        {
            var far = Pack.burrows.FindAll(b =>
            {
                float d = Vector3.Distance(b, transform.position);
                return d > 5 && d < 12;
            });
            var list = far.Count > 0 ? far : Pack.burrows;
            var to = list[Random.Range(0, list.Count)];
            if (Vector3.Distance(to, transform.position) < 2) return false;
            burrowTo = to;
            return true;
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            if (m.id == "burrow") burrowFrom = transform.position;
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "scream" when evt == "warn":
                    GameUI.FloatText(Center + Vector3.up * 0.9f * Size, "！", PlateauPalette.Bolt, 1.2f);
                    break;
                case "scream" when evt == "shout":
                {
                    Screamed = 2;
                    var head = BonePos(Bone("head"));
                    Fx.PlateauScream(head, 18f);
                    Fx.PlateauSparks(head, 6, 3f);
                    Woke = PlateauPack.WakeAround(transform.position, ScreamRadius);
                    ImpactHold(0.04f);
                    break;
                }
                case "bite" when evt == "warn":
                    Fx.PlateauSparks(Center + Vector3.up * 0.2f * Size, 4, 2f, 0.06f);
                    break;
                case "bite" when evt == "hit":
                {
                    var mouth = BonePos(Bone("head"));
                    Fx.PlateauClaw(mouth + transform.forward * 0.3f * Size, transform.forward, 0.9f * Size);
                    if (Charged) Fx.PlateauBolt(mouth, mouth + transform.forward * 1.2f, 0.04f, 0.12f, 0);
                    var to = PlayerPos - transform.position;
                    if (new Vector3(to.x, 0, to.z).magnitude < BiteRange * Size / 1.3f + 0.3f && to.y < 1.4f * Size)
                        Strike(BiteDamage, transform.position + Vector3.up * 0.4f, Charged ? Element.Shock : Element.None, Vector3.zero);
                    break;
                }
                case "burrow" when evt == "hide":
                    SetHidden(true);
                    Fx.PlateauDirt(transform.position, 0.9f, 8);
                    break;
                case "burrow" when evt == "emerge":
                    if (agent && agent.enabled) agent.Warp(burrowTo);
                    transform.position = burrowTo;
                    SetHidden(false);
                    Fx.PlateauDirt(burrowTo, 1.1f, 12);
                    break;
            }
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            switch (Move.Id)
            {
                case "scream":
                    FacePlayer(240f, dt);
                    Stop();
                    break;
                case "bite":
                    if (stage == MoveStage.Active) MoveTo(PlayerPos, 11f);
                    else Stop();
                    FacePlayer(stage == MoveStage.Windup ? 600f : 300f, dt);
                    break;
                case "burrow" when stage == MoveStage.Active:
                {
                    // 地下：土包沿地面移过去
                    var p = Vector3.Lerp(burrowFrom, burrowTo, k);
                    dirtT -= dt;
                    if (dirtT <= 0)
                    {
                        dirtT = 0.1f;
                        Fx.Burst(new Vector3(p.x, Ground(p) + 0.05f, p.z), PlateauPalette.Dust, 3, 1.5f, 0.4f, 0.25f, 4);
                        if (Random.value < 0.25f) Fx.PlateauSparks(p + Vector3.up * 0.1f, 2, 2f, 0.05f);
                    }
                    break;
                }
            }
        }

        protected override void OnInterrupt(string id)
        {
            if (id == "scream" && Screamed == 1) Screamed = 3;
            if (id == "burrow" && Burrowed) SetHidden(false);
        }

        void SetHidden(bool hide)
        {
            if (Burrowed == hide) return;
            Burrowed = hide;
            hp.untargetable = hide;
            foreach (var r in renderers)
                if (r && !(r is ParticleSystemRenderer))
                    r.enabled = !hide;
            if (hide)
            {
                hidden.Clear();
                foreach (var c in GetComponentsInChildren<Collider>(true))
                    if (c && c.enabled)
                    {
                        hidden.Add(c);
                        c.enabled = false;
                    }
            }
            else
            {
                foreach (var c in hidden)
                    if (c)
                        c.enabled = true;
                hidden.Clear();
            }
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            if (Burrowed) SetHidden(false);
        }
    }

    /// <summary>
    /// 啸獭电网（combat 3.1）：一群里相距 4.5 m（× 体型）内的啸獭连边，连通的 3 只以上成网——网里的都带电（<see cref="Charge"/>），
    /// 每条边一道贴地的紫红电弧（离地 0.45 m），玩家碰到每 0.4 s 4 伤害挂雷殛（冲刺无敌穿过、跳过）。打掉中间那只断网。
    /// 由群里的啸獭每帧调 <see cref="Tick"/>（一帧只算一次）。
    /// </summary>
    public sealed class MarmotNet
    {
        public const float Link = 4.5f, ArcHeight = 0.45f, TouchRadius = 0.6f, TickGap = 0.4f, TouchDamage = 4f;
        static readonly Dictionary<PlateauPack, MarmotNet> nets = new();
        static int sweepFrame = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            nets.Clear();
            sweepFrame = -1;
        }

        public static MarmotNet For(PlateauPack p)
        {
            if (!nets.TryGetValue(p, out var n)) nets[p] = n = new MarmotNet { pack = p };
            return n;
        }

        /// <summary>全部网的边数（试玩套件读）</summary>
        public static int TotalEdges()
        {
            int n = 0;
            foreach (var x in nets.Values) n += x.edges.Count;
            return n;
        }

        /// <summary>玩家被电网电到的次数（试玩套件读）</summary>
        public static int Touches { get; private set; }

        PlateauPack pack;
        int tickFrame = -1;
        float touch;
        public readonly List<(MarmotAI a, MarmotAI b)> edges = new();
        readonly Dictionary<(MarmotAI, MarmotAI), FxHandle> arcs = new();
        readonly List<MarmotAI> alive = new();
        readonly Dictionary<MarmotAI, int> comp = new();
        readonly List<(MarmotAI, MarmotAI)> all = new(), stale = new();

        public void Tick()
        {
            if (tickFrame == Time.frameCount) return;
            tickFrame = Time.frameCount;
            if (sweepFrame != Time.frameCount)
            {
                // 整群死光的网收掉
                sweepFrame = Time.frameCount;
                List<PlateauPack> dead = null;
                foreach (var (p, n) in nets)
                    if (p.members.TrueForAll(m => !m || m.Dead))
                    {
                        n.Clear();
                        (dead ??= new List<PlateauPack>()).Add(p);
                    }
                if (dead != null)
                    foreach (var p in dead)
                        nets.Remove(p);
            }
            alive.Clear();
            foreach (var m in pack.members)
                if (m is MarmotAI mm && mm && !mm.Dead && !mm.Burrowed && mm.Alerted)
                    alive.Add(mm);
            // 连边 + 连通分量（≥ 3 成网）
            all.Clear();
            for (int i = 0; i < alive.Count; i++)
                for (int j = i + 1; j < alive.Count; j++)
                {
                    float link = Link * Mathf.Max(1f, (alive[i].transform.localScale.x + alive[j].transform.localScale.x) * 0.5f / 1.3f);
                    if (Vector3.Distance(alive[i].transform.position, alive[j].transform.position) < link) all.Add((alive[i], alive[j]));
                }
            comp.Clear();
            int id = 0;
            var stack = new Stack<MarmotAI>();
            foreach (var m in alive)
            {
                if (comp.ContainsKey(m)) continue;
                stack.Push(m);
                comp[m] = id;
                while (stack.Count > 0)
                {
                    var x = stack.Pop();
                    foreach (var (a, b) in all)
                    {
                        var o = a == x ? b : b == x ? a : null;
                        if (o != null && !comp.ContainsKey(o))
                        {
                            comp[o] = id;
                            stack.Push(o);
                        }
                    }
                }
                id++;
            }
            var size = new int[id];
            foreach (var c in comp.Values) size[c]++;
            foreach (var m in pack.members)
                if (m is MarmotAI mm && mm)
                {
                    bool inNet = !mm.Dead && comp.TryGetValue(mm, out int c) && size[c] >= 3;
                    mm.InNet = inNet;
                    if (inNet) Charge.Apply(mm.Health, 0.5f, mm);
                }
            edges.Clear();
            foreach (var e in all)
                if (e.Item1.InNet)
                    edges.Add(e);
            // 电弧：每条边一道常驻雷刃
            stale.Clear();
            foreach (var k in arcs.Keys)
                if (!edges.Contains(k))
                    stale.Add(k);
            foreach (var k in stale)
            {
                arcs[k].Cancel();
                arcs.Remove(k);
            }
            foreach (var e in edges)
            {
                var pa = e.a.transform.position + Vector3.up * ArcHeight * e.a.transform.localScale.x / 1.3f;
                var pb = e.b.transform.position + Vector3.up * ArcHeight * e.b.transform.localScale.x / 1.3f;
                if (!arcs.TryGetValue(e, out var h) || !h.Alive) arcs[e] = Fx.PlateauArc(pa, pb, 0.05f);
                else h.Retarget(pa, pb);
            }
            // 玩家碰到电弧
            touch -= Time.deltaTime;
            var vitals = PlayerVitals.Instance;
            if (touch > 0 || !vitals || vitals.Dead || vitals.Invulnerable || edges.Count == 0) return;
            var P = vitals.transform.position;
            foreach (var (a, b) in edges)
            {
                if (PlateauGeo.SegDist(P, a.transform.position, b.transform.position) < TouchRadius && P.y < Mathf.Max(a.transform.position.y, b.transform.position.y) + 0.7f)
                {
                    touch = TickGap;
                    Touches++;
                    Combat.DamagePlayer(TouchDamage * a.DamageMult, (a.transform.position + b.transform.position) * 0.5f, Element.Shock, a);
                    break;
                }
            }
        }

        void Clear()
        {
            foreach (var h in arcs.Values) h.Cancel();
            arcs.Clear();
            edges.Clear();
        }
    }
}
