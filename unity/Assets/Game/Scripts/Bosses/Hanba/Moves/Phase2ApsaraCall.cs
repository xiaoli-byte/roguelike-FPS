using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 飞天之殇（二阶段「焦土」起，unity-maps-v1 第 3 节：召唤一名被腐化的邪飞天，给她加护盾，打碎琵琶即可解除；
    /// D6：继承霜翼妖后「回盾供能物」的机制）。二阶段演出结束后的第一招就是它（<see cref="BossPhaseDef.firstMove"/>）。
    ///   前摇（1.8 s ÷ 阶段节奏）：双手捧到心口（ART2 apsaraCall，summon 事件落在前摇结束），栖落点（岩岛顶 / 月牙阁二层台，离她近的那个；
    ///     场地没有栖落点时在她身侧 6 m）亮一圈金色预警，掌心飘金屑。
    ///   出手：邪飞天在栖落点现身（<see cref="HanbaBrain.SummonApsara"/>：同首领难度、不算召唤上限，名字「日灼·邪飞天」、身上一层暗赤金），
    ///     旱魃立刻披上琵琶护体（<see cref="ApsaraWard"/>）。邪飞天还活着或护体还在时这招权重为 0。
    ///   收招 1 s：泉珠露出。
    /// </summary>
    public sealed class Phase2ApsaraCall : HanbaMove
    {
        public const string MoveId = "apsara_call";
        static readonly Color Gold = Hex.Rgb(0xffd27a);

        public override string Id => MoveId;
        public override string Name => "飞天之殇";

        /// <summary>累计召出几只、本次召出的那只</summary>
        public int Summoned { get; private set; }
        public ApsaraAI Last { get; private set; }
        /// <summary>本次的落点</summary>
        public Vector3 Spot { get; private set; }

        float wind;

        public Phase2ApsaraCall()
        {
            cooldown = 30f;
            recovery = 1.2f;
            weight = 1.4f;
            minPhase = 1;
            windup = 1.8f;
            active = 0.4f;
            recover = 1.0f;
        }

        public override float Weight(BossBrain b) => b is HanbaBrain h && (h.Apsara || h.WardUp) ? 0 : weight;

        protected override void Prepare()
        {
            Brain.Halt();
            wind = Windup(windup);
            Spot = PickSpot();
            Last = null;
            if (Ring) Ring.SetBlaze(0.6f, 0.7f);
        }

        /// <summary>落点：场地栖落点里离她最近的那个（导航网格上），没有就在她身侧 6 m</summary>
        Vector3 PickSpot()
        {
            var arena = Brain.Arena;
            var perch = arena ? BossArena.Nearest(arena.perchPoints, Brain.transform.position) : null;
            var p = perch ? perch.position : Brain.ClampToArena(Brain.transform.position + Brain.transform.right * 6f, 3f);
            if (UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 4f, UnityEngine.AI.NavMesh.AllAreas)) p = hit.position;
            return p;
        }

        protected override void OnTelegraph()
        {
            WarnCircle(Spot, 1.8f, wind, Gold);
            // 片段 3 s，summon 在 1.8 s（60%）：整段拉伸到 wind ÷ 0.6
            Act("apsaraCall", wind / 0.6f);
            Sfx("telegraph", 1f, 1.15f);
            Sfx("pipa_roll", 0.6f, 0.7f);
        }

        protected override bool WindupDone => Cue("summon", wind);

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.PlayerPosition, 90f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind)));
            if (Rng.Value < 0.4f) Fx.Burst(Brain.BodyCenter + Brain.transform.forward * 0.6f, Gold, 2, 1.2f, 0.6f, 0.1f, -0.4f);
        }

        protected override void OnActiveBegin()
        {
            Last = Hanba ? Hanba.SummonApsara(Spot) : null;
            if (Last) Summoned++;
            if (Ring) Ring.Flash(0.8f);
            SkillFx.Burst(Spot + Vector3.up * 1.2f, Gold, 26, 6f, 1f, 0.3f, 2f);
            Brain.Shake(0.35f, 0.35f);
            Sfx("pipa_bloom", 0.9f, 0.7f);
            Sfx("boss_roar", 0.5f, 1.35f);
        }
    }

    /// <summary>
    /// 琵琶护体（飞天之殇的护盾，挂在旱魃身上）：邪飞天活着、琵琶没碎时，旱魃受到的一切伤害 × <see cref="HanbaDef.wardTaken"/>（0.2；
    /// 走 <see cref="Damageable.Incoming"/>：伤害数字显示「格挡」），身上罩一层金色护体光，邪飞天的金丝（<see cref="SupportFx"/>）连在她身上。
    ///   解除：琵琶被打碎（邪飞天沉默）或邪飞天死了——护体崩散（碎金 + 破盾声），旱魃踉跄 <see cref="HanbaDef.wardBreakStagger"/> 秒（硬直：泉珠露出，
    ///     受伤 × <see cref="HanbaDef.wardBreakTaken"/>）；琵琶碎时邪飞天随之解脱（处决：照常掉落、计击杀），不会 20 s 后重铸琵琶再给她套一层。
    ///   邪飞天自己的辅助照常作用在场上的沙魇身上；落到旱魃身上的只留光环（伤害 / 攻速 ×1.35、承伤 ×0.75）：
    ///     和弦的限时护盾、赐福在护体期间被剥掉——护体就是这一份护盾，不让三层叠出 ×0.075 的承伤和 ×2.16 的伤害。
    ///   在邪飞天的 Update 之后跑（执行顺序 100），同一帧挂上的和弦护盾不会留到下一帧（测试读数不越过护盾上限）。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(100)]
    public sealed class ApsaraWard : MonoBehaviour
    {
        static readonly Color Gold = Hex.Rgb(0xffd27a);

        HanbaBrain boss;
        IDisposable incoming;
        Transform shell;
        Renderer shellR;
        float taken = 0.2f, pulse;

        /// <summary>护体着（邪飞天活着、琵琶没碎）</summary>
        public bool Up { get; private set; }
        public ApsaraAI Apsara { get; private set; }
        /// <summary>当前的承伤倍率（护体着为 <see cref="HanbaDef.wardTaken"/>，否则 1）</summary>
        public float Taken => Up ? taken : 1f;
        /// <summary>累计：披上几次、被打碎几次（琵琶碎 / 邪飞天死）、吸收掉的伤害、剥掉的和弦护盾 / 赐福次数</summary>
        public int Raised { get; private set; }
        public int Broken { get; private set; }
        public float Absorbed { get; private set; }
        public int Stripped { get; private set; }
        /// <summary>最近一次护体持续了多久（秒）</summary>
        public float LastSeconds { get; private set; }

        float upAt;

        /// <summary>披上护体（召出邪飞天之后由 <see cref="HanbaBrain"/> 调）</summary>
        public void Raise(HanbaBrain b, ApsaraAI apsara)
        {
            if (!b || !apsara) return;
            Drop(false);
            boss = b;
            Apsara = apsara;
            taken = Mathf.Clamp(b.HDef?.wardTaken ?? 0.2f, 0.01f, 1f);
            incoming = b.Health.Incoming.Add((in IncomingHit h) =>
            {
                if (!Up) return 1f;
                Absorbed += h.amount * (1f - taken);
                return taken;
            });
            Up = true;
            upAt = Time.time;
            Raised++;
            BuildShell();
            GameUI.Toast("邪飞天以琵琶为旱魃护体——先打碎她的琵琶！", Gold, 3.5f);
        }

        void BuildShell()
        {
            if (!shell)
            {
                shell = FxMaterials.GlowSprite(transform, 1f, Gold);
                shell.name = "Apsara Ward Shell";
                shellR = shell.GetComponent<Renderer>();
            }
            shell.gameObject.SetActive(true);
        }

        void Update()
        {
            if (!Up) return;
            if (!boss || boss.Dead)
            {
                Drop(false);
                return;
            }
            if (!Apsara || Apsara.Dead || Apsara.Silenced)
            {
                Shatter();
                return;
            }
            // 和弦护盾 / 赐福不叠在她身上（见类说明）
            if (boss.Health.HasTimedShield)
            {
                boss.Health.AddTimedShield(0, 0);
                Stripped++;
            }
            if (boss.Buffs.HasFrom(EnemyBuffs.ApsaraBless, Apsara))
            {
                boss.Buffs.Remove(EnemyBuffs.ApsaraBless, Apsara);
                Stripped++;
            }
            if (shell)
            {
                pulse += Time.deltaTime;
                shell.position = boss.BodyCenter;
                float world = Mathf.Max(3f, boss.BodyRadius * 5f) * (1f + 0.04f * Mathf.Sin(pulse * 5f));
                float s = Mathf.Max(1e-3f, transform.lossyScale.x);
                shell.localScale = Vector3.one * (world / s);
                if (shellR) FxMaterials.Tint(shellR, new Color(Gold.r, Gold.g, Gold.b, 0.22f + 0.08f * Mathf.Sin(pulse * 3f)));
            }
        }

        /// <summary>琵琶碎了 / 邪飞天死了：护体崩散，旱魃踉跄，邪飞天解脱</summary>
        void Shatter()
        {
            var a = Apsara;
            Broken++;
            Drop(true);
            if (!boss || boss.Dead) return;
            var d = boss.HDef;
            var c = boss.BodyCenter;
            Fx.Burst(c, Gold, 40, 10f, 1f, 0.3f, 4f);
            SkillFx.Ring(boss.transform.position, 6f, Gold, 0.5f);
            GameAudio.PlayAt("shield_break", c, 1f, 0.6f);
            GameAudio.PlayAt("pipa_snap", c, 0.9f, 0.7f);
            boss.Shake(0.5f, 0.4f);
            GameUI.Toast("琵琶碎裂——旱魃的护体崩散！趁她踉跄集火！", Gold, 3f);
            boss.Stagger(d?.wardBreakStagger ?? 2.5f, "Hit", d?.wardBreakTaken ?? 1.3f);
            if (a && !a.Dead && a.Health)
            {
                // 飞天解脱：金色花瓣散开（照常掉落、计击杀——玩家打碎了琵琶）
                Fx.Burst(a.transform.position + Vector3.up * 1.4f, Gold, 30, 4f, 1.4f, 0.25f, -1.5f);
                Combat.Execute(a.Health, false);
            }
        }

        /// <summary>收起护体（不踉跄、不动邪飞天）；broken = 被打碎（只影响记数，由 <see cref="Shatter"/> 记）</summary>
        public void Drop(bool broken)
        {
            if (Up) LastSeconds = Time.time - upAt;
            Up = false;
            incoming?.Dispose();
            incoming = null;
            if (shell) shell.gameObject.SetActive(false);
        }

        void OnDisable() => Drop(false);

        void OnDestroy()
        {
            incoming?.Dispose();
            incoming = null;
        }
    }
}
