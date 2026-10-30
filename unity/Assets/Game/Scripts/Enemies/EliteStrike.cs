using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英出手的分量层（首领与精英动作 · 特效调优，H 路维护；三章精英共用，设计单 docs/art/vfx/elites-ch1.md 第 2 节）：只挂在精英身上，
    /// 不碰招式的数值和时机（前摇时长、伤害、范围、弹数都照旧），只在动画之上叠一层「更夸张的起手、更狠的释放帧」：
    ///   · 姿态层：模型节点（Animator 所在的子物体，脚底是原点）在动画之后叠 squash / stretch 和前后倾——
    ///     蓄力时压低 / 后仰（<see cref="Charge"/>），释放帧一下拉长 / 前冲（<see cref="Release"/>），之后靠欠阻尼弹簧回弹过冲（follow-through），
    ///     连射的每一发、落地一震再踢一下（<see cref="Kick"/>），收招 / 打断回正（<see cref="Relax"/>）。幅度夹在 ±16% / ±16° 以内，脚底不离地；
    ///   · 局部顿帧：释放帧只把它自己的 Animator 压到 ×0.05 停几十毫秒，再以 ×1.6 追回，后面的动作不拖时间（全局时间不动）；
    ///   · 金光：<see cref="EnemyBody"/> 覆盖色通道 <see cref="Channel"/>——蓄力时淡淡泛金、释放帧一闪到满、0.3 s 内退掉（精英 = 金，fx-style §2.1）。
    /// 用法（AI 里，只在精英上生效；普通敌人 <see cref="For"/> 返回 null，调用处用 ?. 或 if 判一下即可）：
    /// <code>
    /// // 起手（进前摇那一帧）：拿到分量层（第一次调用时挂上），顺手出一颗起手金芒（Fx.EliteCue）
    /// strike ??= EliteStrike.For(this);
    /// // 前摇里每帧：t = 前摇进度 0..1
    /// strike?.Charge(t, 0.1f, -8f);          // 顶点压低 10%、后仰 8°
    /// // 释放帧（判定 / 出弹那一帧）：
    /// strike?.Release(-0.1f, 8f, 0.05f);     // 拉长 10%、前冲 8°、顿帧 0.05 s
    /// // 连射后面几发 / 落地：
    /// strike?.Kick(-0.03f, -3f);
    /// // 收招、被打断（CancelAttack）：
    /// strike?.Relax();
    /// </code>
    /// 约定：精英的 Animator.speed 归它管（顿帧用），别处不要再写；AI 自己写模型节点的 localPosition（遁地、下沉）不受影响，它只写 localScale / localRotation。
    /// 模型节点就是根节点（没有子模型）时不叠姿态，只做金光和顿帧。倒下时自动还原并停用。执行顺序 200：在 AI、CreatureRig 之后写模型节点。
    /// 接口（For / Charge / Release / Kick / Relax 的签名）已定，要改先通知协调会话。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(200)]
    public sealed class EliteStrike : MonoBehaviour
    {
        /// <summary>EnemyBody 的覆盖色通道名（金光）</summary>
        public const string Channel = "eliteStrike";
        /// <summary>精英金（fx-style §2.1 圣 / 金：主色金、亮芯暖白、暗边赭金）</summary>
        public static readonly Color Gold = Hex.Rgb(0xffc233), Core = Hex.Rgb(0xfff3d0), Ochre = Hex.Rgb(0xa8742a);
        /// <summary>姿态弹簧：频率（Hz）与阻尼比（欠阻尼 → 回弹时过冲一点，就是 follow-through）</summary>
        const float Freq = 7.5f, Zeta = 0.38f, MaxSquash = 0.16f, MaxPitch = 16f;

        EnemyAI ai;
        EnemyBody body;
        Animator anim;
        Transform model;
        Vector3 restScale;
        Quaternion restRot;
        bool hasRest, poseLayer;
        float squash, squashV, squashTarget, pitch, pitchV, pitchTarget, glow, glowTarget, holdLeft, holdDebt;

        /// <summary>当前压扁量（&gt; 0 压扁、&lt; 0 拉长）、前倾角（度，&gt; 0 前倾）、金光强度、释放过几次（测试用）</summary>
        public float Squash => squash;
        public float Pitch => pitch;
        public float GlowNow => glow;
        public int Releases { get; private set; }

        /// <summary>
        /// 取精英身上的出手分量层：ai 不是精英（<see cref="EnemyAI.elite"/> 为假）返回 null；第一次调用时挂上组件、记下模型节点。
        /// 调用时机：Awake 之后任何时候都行，一般在第一次进前摇时调一次、存成字段
        /// </summary>
        public static EliteStrike For(EnemyAI ai)
        {
            if (!ai || !ai.elite) return null;
            if (ai.TryGetComponent<EliteStrike>(out var s)) return s;
            s = ai.gameObject.AddComponent<EliteStrike>();
            s.ai = ai;
            s.body = ai.Body;
            s.anim = ai.GetComponentInChildren<Animator>();
            s.model = s.anim ? s.anim.transform : null;
            s.poseLayer = s.model && s.model != ai.transform;
            return s;
        }

        /// <summary>
        /// 蓄力：前摇里每帧调。t = 前摇进度 0..1（越到顶点压得越狠，前段慢后段紧）；squashAt = 顶点压多扁（0.1 = 矮 10%、横向胖 5.5%，
        /// 负数 = 拉高，人立而起那种）；leanAt = 顶点前倾角（度，正 = 前倾 / 低头，负 = 后仰）。金光随进度从 0.12 涨到 0.42。
        /// 只改目标，姿态由弹簧追过去
        /// </summary>
        public void Charge(float t, float squashAt, float leanAt)
        {
            float e = Ease(t);
            squashTarget = Mathf.Clamp(squashAt * e, -MaxSquash, MaxSquash);
            pitchTarget = Mathf.Clamp(leanAt * e, -MaxPitch, MaxPitch);
            glowTarget = 0.12f + 0.3f * e;
        }

        /// <summary>
        /// 释放帧：在判定 / 出弹的那一帧调一次。姿态立刻打到 squashKick（负 = 拉长，正 = 压扁，如砸地）/ pitchKick（度，正 = 前冲），
        /// 目标回到 0，弹簧回弹时自带一次过冲；hold = 它自己的 Animator 顿帧秒数（0.04–0.08 合适，最多 0.1，0 = 不顿）；金光闪满再 0.3 s 退掉
        /// </summary>
        public void Release(float squashKick, float pitchKick, float hold)
        {
            squash = Mathf.Clamp(squashKick, -MaxSquash, MaxSquash);
            pitch = Mathf.Clamp(pitchKick, -MaxPitch, MaxPitch);
            squashV = pitchV = 0;
            squashTarget = pitchTarget = 0;
            glow = 1f;
            glowTarget = 0;
            if (anim && hold > 0) holdLeft = Mathf.Max(holdLeft, Mathf.Min(0.1f, hold));
            Releases++;
        }

        /// <summary>
        /// 踢一下：在当前姿态上叠 squashKick / pitchKick（不改目标，弹簧自己回来），金光至少到 glowKick。
        /// 调用时机：连射的第二发起每一发（后坐）、刹车 / 撞墙 / 落地一震
        /// </summary>
        public void Kick(float squashKick, float pitchKick, float glowKick = 0.6f)
        {
            squash = Mathf.Clamp(squash + squashKick, -MaxSquash, MaxSquash);
            pitch = Mathf.Clamp(pitch + pitchKick, -MaxPitch, MaxPitch);
            glow = Mathf.Max(glow, glowKick);
        }

        /// <summary>回正：收招开始、被打断（CancelAttack）、换状态时调；姿态和金光慢慢回到动画本来的样子。可以每帧调</summary>
        public void Relax()
        {
            squashTarget = pitchTarget = 0;
            glowTarget = 0;
        }

        static float Ease(float t)
        {
            t = Mathf.Clamp01(t);
            // 前段慢、后段压得更狠（蓄力越到顶点越紧）
            return t * t * (3f - 2f * t) * (0.6f + 0.4f * t);
        }

        void LateUpdate()
        {
            // 倒下：立刻还原模型节点、停手（布娃娃接管骨骼，不能再改父节点的缩放）
            if (!ai || ai.Dead)
            {
                enabled = false;
                return;
            }
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            Spring(ref squash, ref squashV, squashTarget, dt);
            Spring(ref pitch, ref pitchV, pitchTarget, dt);
            glow = Mathf.MoveTowards(glow, glowTarget, dt * (glow > glowTarget ? 3.2f : 2f));
            if (body) body.SetOverlay(Channel, Gold, glow * 0.42f);
            TickHold(dt, false);
            if (!poseLayer || !model) return;
            if (!hasRest)
            {
                hasRest = true;
                restScale = model.localScale;
                restRot = model.localRotation;
            }
            float sq = Mathf.Clamp(squash, -MaxSquash, MaxSquash);
            model.localScale = Vector3.Scale(restScale, new Vector3(1f + sq * 0.55f, 1f - sq, 1f + sq * 0.55f));
            model.localRotation = restRot * Quaternion.Euler(Mathf.Clamp(pitch, -MaxPitch, MaxPitch), 0, 0);
        }

        static void Spring(ref float x, ref float v, float target, float dt)
        {
            float w = Freq * Mathf.PI * 2f;
            // 半隐式欧拉，按 1/60 s 分步（低帧率也稳）
            int steps = Mathf.Clamp(Mathf.CeilToInt(dt * 60f), 1, 6);
            float h = dt / steps;
            for (int i = 0; i < steps; i++)
            {
                v += (-2f * Zeta * w * v - w * w * (x - target)) * h;
                x += v * h;
            }
        }

        void TickHold(float dt, bool dead)
        {
            if (!anim) return;
            if (dead)
            {
                holdLeft = holdDebt = 0;
                if (anim.speed != 1f) anim.speed = 1f;
                return;
            }
            if (holdLeft > 0)
            {
                holdLeft -= dt;
                holdDebt += dt * 0.95f;
                anim.speed = 0.05f;
                return;
            }
            if (holdDebt > 0)
            {
                const float CatchUp = 1.6f;
                holdDebt -= dt * (CatchUp - 1f);
                anim.speed = holdDebt > 0 ? CatchUp : 1f;
                if (holdDebt <= 0) holdDebt = 0;
            }
        }

        void OnDisable()
        {
            if (anim) anim.speed = 1f;
            if (poseLayer && model && hasRest)
            {
                model.localScale = restScale;
                model.localRotation = restRot;
            }
            if (body) body.SetOverlay(Channel, Gold, 0);
        }
    }
}
