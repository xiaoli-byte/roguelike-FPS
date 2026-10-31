using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>落雷的可选参数（<see cref="LightningStrike.Strike(Vector3, in StrikeOptions)"/>）。全部是「0 / false = 缺省」</summary>
    public struct StrikeOptions
    {
        /// <summary>预警秒数（地面紫红预警圈填满 = 劈下；≤ 0 = 立刻劈）</summary>
        public float warn;
        /// <summary>伤害半径（米）与对玩家的伤害（边缘衰减到 60%）</summary>
        public float radius, damage;
        /// <summary>出手者（伤害来源、事件里带出去）</summary>
        public UnityEngine.Object source;
        /// <summary>不被导体引走（雷桩、导雷石柱自己放的雷）</summary>
        public bool ignoreConductors;
        /// <summary>引雷时排除这个导体（从它放出来的雷不劈回它）</summary>
        public Conductor exclude;
        /// <summary>落点半径内的敌人带电多少秒（0 = 不带；天狗衔雷、雷暴给雷魅充电）</summary>
        public float chargeFoes;
        /// <summary>落点半径内的敌人挨多少雷伤（0 = 不伤敌人）</summary>
        public float foeDamage;
        /// <summary>不画地面预警（演出里的雷、远处的装饰雷）</summary>
        public bool noTelegraph;
        /// <summary>闪电从多高劈下来（米，0 = 60）</summary>
        public float height;
        /// <summary>这一道劈下来时回调（在 <see cref="LightningStrike.Landed"/> 之前；撤回的不调）</summary>
        public Action<StrikeInfo> onLanded;
    }

    /// <summary>一道落雷劈下来的那一刻（<see cref="LightningStrike.Landed"/>、<see cref="Conductor.Struck"/>）</summary>
    public struct StrikeInfo
    {
        /// <summary>实际落点（地面；被导体引走时是导体底座）</summary>
        public Vector3 point;
        /// <summary>原来瞄的落点</summary>
        public Vector3 aimed;
        /// <summary>闪电落在哪（导体顶 / 地面落点）</summary>
        public Vector3 boltEnd;
        public float radius, damage;
        /// <summary>引走这道雷的导体（没有为 null）</summary>
        public Conductor conductor;
        public UnityEngine.Object source;
        /// <summary>对玩家实际造成的伤害</summary>
        public float playerDamage;
    }

    /// <summary>一道待劈的落雷的句柄（值类型）：查询、撤回。劈下之后 / 被撤回之后所有操作都是空操作</summary>
    public readonly struct StrikeHandle
    {
        readonly LightningStrike.Pending p;
        readonly int gen;

        internal StrikeHandle(LightningStrike.Pending p)
        {
            this.p = p;
            gen = p.gen;
        }

        public static StrikeHandle None => default;
        /// <summary>还没劈下、也没被撤回</summary>
        public bool Alive => p != null && p.gen == gen && p.active;
        /// <summary>劈下的落点（已按导体引雷改过）</summary>
        public Vector3 Point => Alive ? p.point : Vector3.zero;
        /// <summary>引走它的导体（没有为 null）</summary>
        public Conductor Conductor => Alive ? p.conductor : null;
        /// <summary>离劈下还有几秒</summary>
        public float TimeLeft => Alive ? Mathf.Max(0, p.warn - p.age) : 0;

        /// <summary>撤回（招式被打断、领主转阶段清场）：预警淡出，不劈</summary>
        public void Cancel()
        {
            if (Alive) LightningStrike.CancelPending(p);
        }
    }

    /// <summary>
    /// 落雷（第四章，combat 1.3；docs/unity-ch4-port.md 第 2 节契约）：预警 → 劈下。天狗雷标、夔捶胸、高原雷暴、雷神拍腹都走这里。
    ///   · 预警：地面圆形预警，配色 <see cref="TelegraphTone.Thunder"/>（紫红雷光，和正红的一般危险分开），填满的那一刻劈下。
    ///   · 引雷：调用时就定落点——落点在某个 <see cref="Conductor"/> 的引雷半径内、导体顶更高，雷改劈导体（预警也画在导体底下），
    ///     伤害换成导体底下的溅电（<see cref="Conductor.splashRadius"/> / <see cref="Conductor.splashDamage"/>），导体充电、发 <see cref="Conductor.Struck"/>。
    ///   · 伤害：玩家走 <see cref="Combat.BlastPlayer"/>（雷属性，墙后不挨、冲刺无敌帧闪得过，边缘衰减到 60%）；
    ///     <see cref="StrikeOptions.chargeFoes"/> / <see cref="StrikeOptions.foeDamage"/> 给落点内的敌人充电 / 掉血。
    ///   · 事件：<see cref="Landed"/>（每道雷劈下的那一刻，场地脚本、首领、试玩套件都听它）。
    /// 场景里一个运行器（第一次调用时挂到 Fx 根物体上），换关时清空待劈的雷。
    /// </summary>
    public sealed class LightningStrike : MonoBehaviour
    {
        /// <summary>缺省：预警 1.2 s、半径 3.2 m、伤害 18（夔捶胸的雷，combat 4.1）、闪电从 60 m 高劈下</summary>
        public const float DefaultWarn = 1.2f, DefaultRadius = 3.2f, DefaultDamage = 18f, DefaultHeight = 60f;
        /// <summary>同时待劈的落雷上限（满了先劈掉最老的，免得天雷阵堆积）</summary>
        public const int MaxPending = 48;

        /// <summary>一道雷劈下来了</summary>
        public static event Action<StrikeInfo> Landed;

        internal sealed class Pending
        {
            public int gen;
            public bool active;
            public Vector3 point, aimed;
            public Conductor conductor;
            public StrikeOptions opts;
            public float warn, age;
            public TelegraphHandle tele;
        }

        static LightningStrike instance;
        readonly List<Pending> pending = new();
        readonly Stack<Pending> spare = new();
        static readonly List<Damageable> foes = new();
        int genCounter;

        /// <summary>劈过几道（测试 / 调试）</summary>
        public static int Count { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Landed = null;
            instance = null;
            Count = 0;
        }

        // GameEvents 在 SubsystemRegistration 时清空订阅，所以换关的订阅放到之后的阶段（同 AttackTokens）
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Hook() => GameEvents.StageLoaded += OnStageLoaded;

        static void OnStageLoaded(StageSpec s) => ClearAll();

        /// <summary>
        /// 劈一道雷：warn 秒预警后在 pos（贴地）劈下，radius 米内的玩家挨 damage（雷属性）；落点附近有更高的导体就劈导体。source = 出手者。
        /// 返回句柄（可以撤回）
        /// </summary>
        public static StrikeHandle Strike(Vector3 pos, float warn, float radius, float damage, UnityEngine.Object source) =>
            Strike(pos, new StrikeOptions { warn = warn, radius = radius, damage = damage, source = source });

        /// <summary>带选项劈一道雷（见 <see cref="StrikeOptions"/>）</summary>
        public static StrikeHandle Strike(Vector3 pos, in StrikeOptions options)
        {
            if (!Fx.Finite(pos)) return StrikeHandle.None;
            var self = Ensure();
            if (!self) return StrikeHandle.None;
            return self.Queue(pos, options);
        }

        /// <summary>
        /// 不劈、只问：pos 落下来的雷会被哪个导体引走（没有为 null）。预警画在哪、玩家躲在哪安全，AI 和测试用
        /// </summary>
        public static Conductor Redirect(Vector3 pos, Conductor exclude = null) => Conductor.Best(Ground(pos), exclude);

        /// <summary>当前待劈的雷数</summary>
        public static int PendingCount => instance ? instance.pending.Count : 0;

        /// <summary>全部撤回（换关、领主转阶段清场）</summary>
        public static void ClearAll()
        {
            if (!instance) return;
            for (int i = instance.pending.Count - 1; i >= 0; i--) instance.Release(i, true);
        }

        static LightningStrike Ensure()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            instance = rt.gameObject.GetComponent<LightningStrike>();
            if (!instance) instance = rt.gameObject.AddComponent<LightningStrike>();
            return instance;
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        StrikeHandle Queue(Vector3 pos, in StrikeOptions o)
        {
            if (pending.Count >= MaxPending) Land(0);
            var p = spare.Count > 0 ? spare.Pop() : new Pending();
            p.gen = ++genCounter;
            p.active = true;
            p.opts = o;
            if (!(p.opts.radius > 0)) p.opts.radius = DefaultRadius;
            if (!(p.opts.height > 0)) p.opts.height = DefaultHeight;
            p.aimed = Ground(pos);
            p.conductor = o.ignoreConductors ? null : Conductor.Best(p.aimed, o.exclude);
            p.point = p.conductor ? p.conductor.Base : p.aimed;
            p.warn = Mathf.Max(0, float.IsFinite(o.warn) ? o.warn : 0);
            p.age = 0;
            p.tele = TelegraphHandle.None;
            if (!o.noTelegraph && p.warn > 0)
            {
                float r = p.conductor ? p.conductor.splashRadius : p.opts.radius;
                p.tele = Telegraph.Circle(p.point, r, p.warn, TelegraphPalette.Thunder, TelegraphTone.Thunder);
            }
            pending.Add(p);
            var h = new StrikeHandle(p);
            if (p.warn <= 0) Land(pending.Count - 1);
            return h;
        }

        internal static void CancelPending(Pending p)
        {
            if (!instance) return;
            int i = instance.pending.IndexOf(p);
            if (i >= 0) instance.Release(i, true);
        }

        void Release(int i, bool cancel)
        {
            var p = pending[i];
            pending.RemoveAt(i);
            if (cancel) p.tele.Cancel();
            p.active = false;
            p.conductor = null;
            p.opts.source = null;
            p.opts.exclude = null;
            p.opts.onLanded = null;
            spare.Push(p);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                if (i >= pending.Count) continue;
                var p = pending[i];
                p.age += dt;
                if (p.age >= p.warn) Land(i);
            }
        }

        /// <summary>劈下第 i 道：闪电、伤害、导体充电、事件</summary>
        void Land(int i)
        {
            var p = pending[i];
            var o = p.opts;
            var c = p.conductor && p.conductor.isActiveAndEnabled ? p.conductor : null;
            var end = c ? c.Top : p.point;
            var info = new StrikeInfo
            {
                point = p.point, aimed = p.aimed, boltEnd = end, conductor = c, source = o.source,
                radius = c ? c.splashRadius : o.radius, damage = c ? c.splashDamage : o.damage,
            };
            Release(i, false);
            Count++;

            Bolt(end, o.height);
            if (info.damage > 0) info.playerDamage = Combat.BlastPlayer(info.point + Vector3.up * 0.3f, info.radius, info.damage, 0.6f, Element.Shock, o.source);
            if (o.chargeFoes > 0 || o.foeDamage > 0) HitFoes(info.point, info.radius, o);
            if (c) c.OnStruck(info);
            if (o.onLanded != null)
                try
                {
                    o.onLanded(info);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            if (Landed != null)
                try
                {
                    Landed(info);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
        }

        static void HitFoes(Vector3 at, float radius, in StrikeOptions o)
        {
            foes.Clear();
            ReactionSystem.Nearest(at, radius, 16, null, false, foes);
            foreach (var d in foes)
            {
                if (!d || d.Dead) continue;
                if (o.chargeFoes > 0) Charge.Apply(d, o.chargeFoes, o.source);
                if (o.foeDamage > 0)
                {
                    var to = ReactionSystem.CenterOf(d);
                    var info = DamageInfo.Simple(o.foeDamage, DamageSource.Environment, to, Vector3.down);
                    info.element = Element.Shock;
                    info.depth = 1;
                    info.noCrit = true;
                    Combat.DamageEnemy(d, info);
                }
            }
            foes.Clear();
        }

        /// <summary>天上劈下来的闪电（骨架：两段通用闪电弧 + 落点闪光）</summary>
        static void Bolt(Vector3 end, float height)
        {
            var top = end + new Vector3(UnityEngine.Random.Range(-6f, 6f), height, UnityEngine.Random.Range(-6f, 6f));
            var mid = Vector3.Lerp(top, end, 0.55f) + new Vector3(UnityEngine.Random.Range(-3f, 3f), 0, UnityEngine.Random.Range(-3f, 3f));
            Lightning.Spawn(top, mid, TelegraphPalette.Thunder, 0.32f);
            Lightning.Spawn(mid, end, TelegraphPalette.Thunder, 0.26f);
            FxLightPool.Flash(end + Vector3.up, Color.Lerp(TelegraphPalette.Thunder, Color.white, 0.45f), 14f, 18f, 0.18f);
        }

        /// <summary>贴地：向下打一条射线找地面（找不到就原样）</summary>
        static Vector3 Ground(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 30f, Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return hit.point;
            return p;
        }
    }
}
