using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炭童的余烬炭堆（TS TantongEmber）：一堆冒烟的炭块，炭缝的光越闪越快（1.5 → 9 Hz），4 s 后炭块飞回去、原地站起一只半血的炭童。
    /// 一枪就散（不暴击），范围伤害照样打得到；玩家走进 0.75 m 踩散（按一次近战击杀结算，算玩家击杀）。
    /// 落地的头 0.25 s（TS spawnDuration）只是成形：打得到，但还不会被踩散、复燃计时也还没开始——死在玩家脚边的炭童照样先留下一堆炭。
    /// 同伴蹲着吹 1.2 s 会让它当场复燃；祸斗吃掉它（<see cref="IFireSource"/>，炭童彻底死）。复燃 / 被吃掉不算击杀、不掉落（静默处决）：
    /// 这两种退场同 TS 不经过伤害结算，按 <see cref="ISelfDestruct"/> 记成 <see cref="Detonated"/>（冒烟套件据此区分「自己退场」与「被打死却没派发击杀事件」）。
    /// 没有美术：生成器给的占位胶囊换成程序化的 5 块炭（发光件随复燃进度闪），不挡玩家（好踩上去）。
    /// </summary>
    public sealed class TantongEmberAI : InfernoEnemyAI, IFireSource, ISelfDestruct
    {
        /// <summary>走进炭堆这么近（水平，米；高差 0.7 m 内）就踩散</summary>
        public const float StompRange = 0.75f;
        /// <summary>成形时间（秒，TS spawnDuration 0.25）：这段时间里不判踩散、复燃不计时</summary>
        public const float SettleTime = 0.25f;

        static readonly Vector3[] ChunkAt =
        {
            new(0, 0.07f, 0), new(0.1f, 0.05f, 0.04f), new(-0.09f, 0.05f, -0.03f), new(0.02f, 0.05f, -0.11f), new(0, 0.15f, 0.02f),
        };
        static readonly float[] ChunkR = { 0.1f, 0.07f, 0.08f, 0.065f, 0.055f };

        /// <summary>正在吹它的同伴（同一堆只让一只吹）</summary>
        public TantongAI Blower { get; internal set; }
        /// <summary>吹火进度 0..1（只用于表现：越吹越亮）</summary>
        public float BlowProgress { get; internal set; }
        /// <summary>离复燃还剩几秒</summary>
        public float Remaining => Mathf.Max(0, TantongAI.RekindleTime - life);
        /// <summary>已经复燃 / 被吃 / 被打散</summary>
        public bool Done => done;
        /// <summary>自己退场的（复燃、被祸斗吃掉、伤害被免疫没死而直接消失）：不是玩家击杀，没有击杀事件 / 奖励（同 TS vanish）</summary>
        public bool Detonated => vanished;

        float life, settle, srcLevel = 1, flicker, smokeAcc;
        string srcAffix;
        bool srcElite, done, registered, vanished;
        readonly List<Renderer> glows = new();
        readonly List<Transform> chunks = new();
        /// <summary>炭堆顶上一小簇火苗（FX4 火舌，同 TS afterInit：复燃前越蹿越高）</summary>
        FlameTongue tongue;
        Collider capsule;

        protected override void Awake()
        {
            base.Awake();
            // 不动：不要导航（也就不做离网回收），不挡玩家
            if (agent) agent.enabled = false;
            capsule = GetComponent<CapsuleCollider>();
            // 命中球不是弱点（TS headshot = false）
            if (body.WeakZone) body.WeakZone.SetWeakPoint(false);
            BuildPile();
            hp.Died += OnPileDied;
        }

        protected override string InitialState => "pile";

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, false);
            // 炭堆 0.25 s 就能打（TS spawnDuration 0.25）：不等基类 0.7 s 的出生无敌
            hp.untargetable = false;
            SetState(InitialState);
            if (!registered)
            {
                registered = true;
                FireFeed.Register(this);
            }
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            if (cc && capsule) Physics.IgnoreCollision(cc, capsule, true);
            GameAudio.PlayAt("burn_tick", transform.position, 0.4f, 0.7f);
        }

        /// <summary>记下是谁碎成的（复燃时按同样的强度 / 精英 / 词缀站起来）</summary>
        public void Bind(float level, bool wasElite, string affix = null)
        {
            srcLevel = level;
            srcElite = wasElite;
            srcAffix = affix;
        }

        /// <summary>
        /// 占位胶囊 → 程序化炭堆：藏起占位体的身体 / 朝向楔 / 弱点光球，去掉占位标记（这是设计里的程序化炭堆，不算缺美术），
        /// 摆 5 块炭 + 各自的发光件 + 顶上一小簇火苗
        /// </summary>
        void BuildPile()
        {
            var ph = GetComponent<PlaceholderBody>();
            if (!ph) return;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                r.enabled = false;
            Destroy(ph);
            var root = new GameObject("Pile").transform;
            root.SetParent(transform, false);
            for (int i = 0; i < ChunkAt.Length; i++)
            {
                var g = new GameObject("Chunk" + i).transform;
                g.SetParent(root, false);
                g.localPosition = new Vector3(-ChunkAt[i].x, ChunkAt[i].y, ChunkAt[i].z);
                g.localRotation = Quaternion.Euler(i * 74f, i * 120f, i * 40f);
                InfernoKit.Primitive(PrimitiveType.Cube, "Coal", g, Vector3.zero, Vector3.one * ChunkR[i] * 1.6f, InfernoKit.Coal);
                glows.Add(InfernoKit.Primitive(PrimitiveType.Sphere, "Glow", g, Vector3.zero, Vector3.one * ChunkR[i] * 2.1f, InfernoKit.Crack * 0.4f, true));
                chunks.Add(g);
            }
            tongue = FlameTongue.Attach(root, new Vector3(0, 0.12f, 0), Vector3.one * 0.01f, Hex.Rgb(0xfff0c0), Hex.Rgb(0xff9a30), Hex.Rgb(0xd8401a));
        }

        protected override void Think(float dt)
        {
            Stop();
            if (done) return;
            // 成形中（TS 出生阶段不跑 ai）：不判踩散、复燃不计时
            if (!Settled(settle += dt)) return;
            life += dt;
            // 踩散
            if (vitals && !vitals.Dead && !Taunted && ShouldStomp(player.position, transform.position))
            {
                Stomp();
                return;
            }
            if (life >= TantongAI.RekindleTime) Rekindle();
        }

        /// <summary>落地这么久（秒）之后才算成形：开始判踩散、复燃计时</summary>
        public static bool Settled(float sinceSpawn) => sinceSpawn >= SettleTime;

        /// <summary>落地后多久复燃（秒）：成形 0.25 s + 复燃 4 s（同 TS：出生阶段之后 ai 才开始累计）</summary>
        public static float RekindleAfter => SettleTime + TantongAI.RekindleTime;

        /// <summary>玩家脚底 feet 离炭堆 pile 水平 0.75 m 内、高差 0.7 m 内：踩散</summary>
        public static bool ShouldStomp(Vector3 feet, Vector3 pile)
        {
            var d = feet - pile;
            if (Mathf.Abs(d.y) >= 0.7f) return false;
            d.y = 0;
            return d.sqrMagnitude <= StompRange * StompRange;
        }

        void LateUpdate()
        {
            if (Dead || done) return;
            // 炭缝的光越闪越快（1.5 → 9 Hz），吹火时更亮；顶上的火苗越蹿越高；快复燃时炭块一颤一颤
            float u = Mathf.Clamp01(life / TantongAI.RekindleTime);
            float blow = Blower ? BlowProgress : 0;
            float freq = 1.5f + 7.5f * Mathf.Pow(Mathf.Max(u, blow), 1.5f);
            flicker += Time.deltaTime * freq * Mathf.PI * 2;
            float pulse = 0.5f + 0.5f * Mathf.Sin(flicker);
            float heat = Mathf.Clamp01(0.3f + 0.5f * pulse * (0.4f + 0.6f * u) + 0.4f * blow);
            var c = Color.Lerp(InfernoKit.Crack, InfernoKit.CrackHot, heat * heat) * (0.35f + 0.75f * heat);
            foreach (var g in glows)
                if (g)
                    FxMaterials.Tint(g, c);
            if (tongue)
            {
                float s = 0.06f + 0.22f * Mathf.Max(u * u, blow) + 0.04f * pulse;
                float k = Mathf.Abs(transform.lossyScale.x);
                tongue.Set(0.5f + 0.5f * heat, new Vector3(s * 0.9f, s * (1 + 0.15f * Mathf.Sin(age * 17)), s) * k);
            }
            float shake = u > 0.6f ? (u - 0.6f) * 0.04f * Mathf.Sin(age * 50) : 0;
            for (int i = 0; i < chunks.Count; i++)
                if (chunks[i])
                    chunks[i].localPosition = new Vector3(-ChunkAt[i].x, ChunkAt[i].y + Mathf.Abs(shake) * (i % 2 == 1 ? 1 : 0.5f), ChunkAt[i].z);
            smokeAcc += Time.deltaTime * (0.8f + 2.5f * u + 4 * blow);
            if (smokeAcc > 0.3f)
            {
                smokeAcc = 0;
                var p = transform.position + new Vector3(Random.value - 0.5f, 0, Random.value - 0.5f) * 0.2f + Vector3.up * 0.2f * Size;
                Fx.Burst(p, InfernoKit.Smoke, 1, 0.3f, 1.2f, 0.22f, -0.9f);
                if (u > 0.5f || blow > 0) Fx.Burst(p, InfernoKit.Spark, 2, 1.2f, 0.4f, 0.05f, -2.5f);
            }
        }

        // ───────────── IFireSource（祸斗吃火） ─────────────

        public FireKind Kind => FireKind.Ember;
        public Vector3 Position => transform.position;
        public float Radius => 0.12f * Size;
        public bool Edible => this && !Dead && !done;
        public object ClaimedBy { get; set; }

        /// <summary>被祸斗吃掉：炭堆消失（不算玩家击杀），炭童彻底死</summary>
        public void Consume()
        {
            if (!Edible) return;
            Fx.Burst(transform.position + Vector3.up * 0.1f, InfernoKit.Smoke, 8, 1.2f, 0.8f, 0.2f, -1);
            Vanish();
        }

        /// <summary>这堆还在等人吹（活着、没复燃、没被祸斗占着；who 是正在吹它的那只时也算）</summary>
        public bool AwaitingBlow(TantongAI who) => Edible && (!Blower || Blower == who) && ClaimedBy == null;

        /// <summary>玩家走进来踩散：按一次近战击杀结算（算玩家击杀，炭堆不掉落）</summary>
        void Stomp()
        {
            var info = DamageInfo.Simple(hp.maxHealth * 4 + 20, DamageSource.Melee, transform.position + Vector3.up * 0.12f * Size, Vector3.down);
            info.noCrit = true;
            GameAudio.PlayAt("land", transform.position, 0.7f, 0.7f);
            Combat.DamageEnemy(hp, info);
            if (!Dead) Vanish();
        }

        /// <summary>复燃：炭堆消失（不算击杀），原地站起一只半血的炭童，炭块飞回去拼合</summary>
        public void Rekindle()
        {
            if (done || Dead) return;
            var at = transform.position;
            var rot = transform.rotation;
            var parent = transform.parent;
            if (Blower) Blower.BlowTarget = null;
            Blower = null;
            Vanish();
            Fx.Burst(at + Vector3.up * 0.3f, InfernoKit.Spark, 24, 4, 0.5f, 0.08f, 1);
            Fx.Ring(at + Vector3.up * 0.05f, 1.4f, InfernoKit.Ember, 0.35f);
            GameAudio.PlayAt("skill_fire", at, 0.6f, 1.3f);
            var e = EnemyRoster.Spawn(TantongAI.RebornId, at, rot, srcLevel, srcElite, new SpawnOptions { parent = parent ? parent : null, affix = srcAffix });
            if (e is TantongAI t) t.RekindledFrom(at);
        }

        /// <summary>消失：静默处决（复燃、被吃掉），不算击杀、不掉落；记成自己退场（<see cref="Detonated"/>）</summary>
        void Vanish()
        {
            if (done) return;
            done = true;
            Unregister();
            if (Dead) return;
            vanished = true;
            Combat.Execute(hp, true);
        }

        void Unregister()
        {
            if (!registered) return;
            registered = false;
            FireFeed.Unregister(this);
        }

        protected override void CancelAttack() { }

        // 登记表里的销毁检查：被直接销毁（清场、测试场 Clear）的炭堆在 FireFeed 查询时自动剔除，这里不另写 OnDestroy（基类的 OnDestroy 要照常注销）
        void OnPileDied(DamageInfo info)
        {
            Unregister();
            if (Blower)
            {
                Blower.BlowTarget = null;
                Blower = null;
            }
            bool wasDone = done;
            done = true;
            foreach (var g in glows)
                if (g)
                    g.enabled = false;
            if (tongue) tongue.Set(0);
            if (wasDone || EnemyRegistry.Purging) return;
            // 被打散 / 踩散：炭块崩开、火灭成灰
            var c = transform.position + Vector3.up * 0.12f * Size;
            Fx.Burst(c, InfernoKit.Coal, 10, 3.5f, 0.7f, 0.07f, 9);
            Fx.Burst(c, InfernoKit.Ash, 12, 1.8f, 0.9f, 0.12f, -0.6f);
            Fx.Burst(c, InfernoKit.Ember, 8, 2.5f, 0.4f, 0.05f, 2);
            foreach (var ch in chunks)
                if (ch)
                    ch.gameObject.SetActive(false);
        }
    }
}
