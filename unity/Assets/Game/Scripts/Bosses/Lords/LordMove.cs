using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 4-1 三领主招式的底座（时间轴照 docs/art/ch4-move-events.json：windup / active / recover = 状态名同名片段的三段）：
    ///   · 片段：前摇第一帧播整段片段（<see cref="Clip"/>，默认 = 招式 id），按「设计时长 × 前摇 + 出手的实际 / 设计」拉伸——
    ///     出手事件在片段里的位置不变，所以释放帧和代码的出手时刻对齐（Cue 先到者算）；收招被领主梯度 / 阶段节奏缩短时，片段尾巴由下一个状态的交叉淡入截掉。
    ///   · 收招：recover = 设计值 × <see cref="LordBrain.RecoverScale"/>（领主梯度 × 阶段节奏），出招第一帧按当时算。
    ///   · 伤害：网页版的数值是难度 1 的绝对值 → <see cref="Dmg"/> 按首领伤害换算（含难度、狂怒）。
    ///   · 预警：地面圆 / 直线走 BossMove（计 TelegraphCount），扇形等走 BossHazards 的招式组，用 <see cref="CountWarning"/> 记数。危险填充一律 TelegraphTone 正红。
    /// 角度一律世界 yaw（度），0 = +Z。
    /// </summary>
    public abstract class LordMove : BossMove
    {
        BossHazards hazards;
        float baseRecover = -1, designWindup = -1, designActive, designTotal;

        protected BossHazards Hazards => hazards ? hazards : hazards = BossHazards.For(Brain);
        protected LordBrain LordB => Brain as LordBrain;

        /// <summary>经 BossHazards 画的预警个数</summary>
        public int ExtraWarnings { get; private set; }
        /// <summary>预警合计</summary>
        public int Warned => TelegraphCount + ExtraWarnings;
        /// <summary>最近一次出手（释放帧）的招式时间（秒）；没出过为 −1（节拍条量释放帧对齐）</summary>
        public float ReleasedAt { get; protected set; } = -1;
        /// <summary>释放帧那一帧的 Time.frameCount（节拍条按「渲染帧」量对齐：编辑器里一帧可能远长于 1/30 s）</summary>
        public int ReleasedFrame { get; protected set; } = -1;
        /// <summary>最近一次出招打中玩家几次</summary>
        public int Hits { get; protected set; }

        /// <summary>片段名（Animator 状态名）；null = 不播</summary>
        protected virtual string Clip => Id;

        /// <summary>设计时长（片段长度，秒）：构造时的三段之和</summary>
        public float DesignSeconds
        {
            get
            {
                Capture();
                return designTotal;
            }
        }

        void Capture()
        {
            if (designWindup >= 0) return;
            designWindup = windup;
            designActive = active;
            baseRecover = recover;
            designTotal = windup + active + recover;
        }

        protected void CountWarning()
        {
            ExtraWarnings++;
            Brain.NotifyTelegraph(this);
        }

        protected sealed override void OnStart()
        {
            Capture();
            recover = baseRecover * (LordB ? LordB.RecoverScale : 1f);
            ReleasedAt = -1;
            ReleasedFrame = -1;
            Hits = 0;
            Prepare();
        }

        /// <summary>子类的出招第一帧（选目标、记落点）</summary>
        protected virtual void Prepare() { }

        /// <summary>前摇第一帧：播片段，再交给子类画预警</summary>
        protected sealed override void OnTelegraph()
        {
            PlayClip();
            Telegraph();
        }

        /// <summary>子类画预警（前摇第一帧）</summary>
        protected virtual void Telegraph() { }

        /// <summary>按设计时长拉伸播整段片段（前摇被狂怒缩短时按比例缩）</summary>
        protected void PlayClip(string state = null, float fade = 0.08f)
        {
            state ??= Clip;
            if (string.IsNullOrEmpty(state)) return;
            Capture();
            float k = (WindupTime + designActive) / Mathf.Max(0.01f, designWindup + designActive);
            Brain.PlayAct(state, designTotal * k, fade);
        }

        /// <summary>记一次释放帧（节拍条 / 测试）</summary>
        protected void MarkRelease()
        {
            ReleasedAt = T;
            ReleasedFrame = Time.frameCount;
        }

        /// <summary>网页原值伤害（难度 1 的绝对值）→ 本首领的招式伤害（含难度、狂怒）</summary>
        protected float Dmg(float web) => Damage(web / Mathf.Max(1f, Brain.Def != null ? Brain.Def.damage : 16f));

        protected float Facing => Brain.transform.eulerAngles.y;
        protected float YawToPlayer => YawTo(Brain.PlayerPosition);

        protected float YawTo(Vector3 p)
        {
            var d = p - Brain.transform.position;
            d.y = 0;
            return d.sqrMagnitude > 1e-4f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : Facing;
        }

        protected static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        protected void SetFacing(float yawDeg) => Brain.transform.rotation = Quaternion.Euler(0, yawDeg, 0);
        protected void TurnToward(float yawDeg, float degPerSec, float dt) => SetFacing(Mathf.MoveTowardsAngle(Facing, yawDeg, degPerSec * dt));

        /// <summary>水平距离（米）</summary>
        protected static float Flat(Vector3 a, Vector3 b)
        {
            a.y = b.y = 0;
            return Vector3.Distance(a, b);
        }

        protected Vector3 OnGround(Vector3 p)
        {
            p.y = LordB ? LordB.GroundAt(p) : p.y;
            return p;
        }

        protected void Sfx(string id, float volume = 1f, float pitch = 1f) => Brain.PlaySfx(id, volume, pitch);

        /// <summary>打玩家一下（走 BossHazards：计命中、冲刺无敌躲得过、首领倒下不伤）；返回实际扣了多少</summary>
        protected float HurtPlayer(float damage, Element element, Vector3 from, Vector3 push)
        {
            if (LordBrain.PlayerDashing) return 0;
            float d = Hazards.Hurt(damage, element, from);
            if (d > 0)
            {
                Hits++;
                LordBrain.PushPlayer(push);
            }
            return d;
        }

        static RunRng fallbackRng;

        /// <summary>随机流（本局有种子时可复现）</summary>
        protected static RunRng Rng => RunState.Current != null ? RunState.Current.Stream("boss_lords") : fallbackRng ??= new RunRng(System.Environment.TickCount);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;
    }
}
