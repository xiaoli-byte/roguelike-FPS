using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>技能槽：Q = 主技能，E = 副技能</summary>
    public enum SkillSlot { Primary, Secondary }

    /// <summary>技能放不出来的原因（拒绝反馈）</summary>
    public enum SkillDeny
    {
        /// <summary>没有充能（冷却中）</summary>
        Cooldown,
        /// <summary>持续型技能正在生效</summary>
        Busy,
        /// <summary>技能自己拒绝（Activate 返回 false：没有落点、阵亡…）</summary>
        Failed,
    }

    /// <summary>
    /// 英雄技能（Three.js 版 src/player/skills/common.ts 的 HeroSkillDef）：充能制冷却，技能急速加快回充。
    /// 一次性技能直接继承本类实现 <see cref="Activate"/>；有持续时间 / 要撤销加成的继承 <see cref="TimedSkill"/>。
    /// </summary>
    public abstract class Skill
    {
        /// <summary>技能 id（同 Three.js，如 fox_nine_tails）：事件、秘卷按它认技能</summary>
        public string id;
        public string name, description;
        public float cooldown = 8;
        public int maxCharges = 1;
        public int charges;
        /// <summary>下一层充能已经回了多少秒</summary>
        public float recharge;
        protected HeroSkills owner;
        /// <summary>技能自己的充能上限（maxCharges 另加副技能充能等属性）</summary>
        internal int baseCharges;

        public string Id => string.IsNullOrEmpty(id) ? GetType().Name : id;
        public HeroSkills Owner => owner;
        /// <summary>装在哪个槽</summary>
        public SkillSlot Slot { get; internal set; }

        public void Bind(HeroSkills o)
        {
            owner = o;
            baseCharges = maxCharges;
            charges = maxCharges;
            recharge = 0;
        }

        /// <summary>释放：返回 false 表示没放出去（不扣充能，给拒绝反馈）</summary>
        public abstract bool Activate();
        /// <summary>每帧（玩家移动之后，LateUpdate）：持续效果、跟随玩家的特效</summary>
        public virtual void Tick(float dt) { }
        /// <summary>持续型技能生效中：不能重复释放</summary>
        public virtual bool Busy => false;
        /// <summary>立即终止持续效果并撤销全部修饰（换英雄、换关、开新局），不触发「自然结束」的效果</summary>
        public virtual void Reset() { }
        public float CooldownLeft => charges >= maxCharges ? 0 : Mathf.Max(0, cooldown - recharge);
    }

    /// <summary>
    /// 玩家身上的技能槽（Three.js SkillController）：Q = 主技能，E = 副技能，被动在 <see cref="Configure(HeroDef)"/> 时装上。
    /// 技能与被动全部来自 <see cref="HeroDef"/> 的工厂（CreatePrimary / CreateSecondary / CreatePassive）：加英雄只加 Heroes/Hero_&lt;Id&gt;.cs 与它的技能文件，这里不用改。
    ///   · 充能：副技能上限 = 技能自身 + 属性「副技能充能」（上限提高时立即得到新增的充能）；技能急速加快回充；
    ///   · 释放：没有充能 / 持续中 / 技能拒绝 → 拒绝反馈（ui_deny 音 + 技能格闪红，0.35 s 内只响一次）；放出去发 <see cref="GameEvents.SkillUsed"/>；
    ///   · 持续：技能的 Tick 在 LateUpdate（玩家移动之后：环绕身体的特效不落后一帧）；
    ///   · 兜底：换关 / 开新局时终止所有持续效果（TimedSkill 撤销栈逐条撤销）。
    /// 测试用 testQ / testE 代替按键（<see cref="TestMode"/>）。
    /// </summary>
    public sealed class HeroSkills : MonoBehaviour
    {
        public static bool TestMode;
        public bool testQ, testE;
        public string heroId = HeroLibrary.DefaultHero;
        public string passiveName, passiveDescription;

        public Skill primary, secondary;
        /// <summary>当前英雄（注册表里找不到时为 null）</summary>
        public HeroDef Hero { get; private set; }
        public PlayerMotor Motor { get; private set; }
        public PlayerVitals Vitals { get; private set; }
        public Transform Eye { get; private set; }
        /// <summary>玩家属性表（还没有 PlayerVitals 时为 null）</summary>
        public StatSheet Stats => Vitals ? Vitals.stats : null;

        /// <summary>放出了一个技能</summary>
        public event Action<Skill> Cast;
        /// <summary>按了技能但放不出来</summary>
        public event Action<SkillSlot, SkillDeny> Denied;
        /// <summary>换了英雄（技能对象都是新的）</summary>
        public event Action Configured;

        const float DenyInterval = 0.35f;

        /// <summary>被动的撤销句柄（换英雄 / 销毁时 Dispose）</summary>
        IDisposable passive;
        float lastDeny = -10;

        void Awake()
        {
            Motor = GetComponent<PlayerMotor>();
            Vitals = GetComponent<PlayerVitals>();
            var wc = GetComponent<WeaponController>();
            Eye = wc ? wc.Aim : Motor && Motor.eye ? Motor.eye : transform; // 不抖的瞄准节点（相机节点会随震屏晃动）
            Configure(heroId);
        }

        void OnEnable()
        {
            GameEvents.StageLoaded += OnStageChanged;
            GameEvents.RunStarted += OnRunStarted;
        }

        void OnDisable()
        {
            GameEvents.StageLoaded -= OnStageChanged;
            GameEvents.RunStarted -= OnRunStarted;
        }

        void OnDestroy() => Teardown();

        void OnStageChanged(StageSpec _) => ResetSkills();

        void OnRunStarted(RunState _) => ResetSkills();

        /// <summary>按英雄 id 配置（注册表里没有时退回默认英雄）</summary>
        public void Configure(string id)
        {
            var hero = HeroLibrary.Get(id);
            if (hero == null)
            {
                Debug.LogWarning($"[HeroSkills] 没有英雄 {id}（Skills/Heroes/Hero_*.cs），退回 {HeroLibrary.DefaultHero}");
                hero = HeroLibrary.Get(HeroLibrary.DefaultHero);
            }
            if (hero == null)
            {
                Teardown();
                heroId = id;
                return;
            }
            Configure(hero);
        }

        /// <summary>按英雄定义装技能与被动：先终止旧英雄仍在持续的效果、撤销旧被动</summary>
        public void Configure(HeroDef hero)
        {
            if (hero == null) throw new ArgumentNullException(nameof(hero));
            Teardown();
            Hero = hero;
            heroId = hero.id;
            var p = hero.CreatePassive();
            passiveName = p?.Name ?? hero.passiveName;
            passiveDescription = p?.Description ?? hero.passiveDescription;
            primary = hero.CreatePrimary();
            secondary = hero.CreateSecondary();
            Bind(primary, SkillSlot.Primary);
            Bind(secondary, SkillSlot.Secondary);
            if (p != null)
            {
                try
                {
                    passive = p.Apply(this);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            try
            {
                Configured?.Invoke();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void Bind(Skill s, SkillSlot slot)
        {
            if (s == null) return;
            s.Slot = slot;
            s.Bind(this);
        }

        /// <summary>终止持续效果、撤销被动、清空技能槽</summary>
        void Teardown()
        {
            ResetSkills();
            passive?.Dispose();
            passive = null;
            primary = secondary = null;
        }

        /// <summary>终止两个槽的持续效果（不扣充能、不触发自然结束）</summary>
        public void ResetSkills()
        {
            foreach (var s in new[] { primary, secondary })
            {
                if (s == null) continue;
                try
                {
                    s.Reset();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
        }

        public Skill Get(SkillSlot slot) => slot == SkillSlot.Primary ? primary : secondary;

        /// <summary>
        /// 立即回复冷却秒数（真实秒，已算技能急速；可以跨过多格充能）。which = null 时两个槽都回。
        /// </summary>
        public void ReduceCooldowns(float seconds, SkillSlot? which = null)
        {
            if (!(seconds > 0)) return;
            float haste = Vitals ? Vitals.stats.Mult(Stat.SkillHaste) : 1;
            for (int i = 0; i < 2; i++)
            {
                var slot = (SkillSlot)i;
                if (which.HasValue && which.Value != slot) continue;
                var s = Get(slot);
                if (s == null || s.charges >= s.maxCharges) continue;
                if (s.cooldown <= 0)
                {
                    s.charges = s.maxCharges;
                    s.recharge = 0;
                    continue;
                }
                s.recharge += seconds * haste;
                while (s.recharge >= s.cooldown && s.charges < s.maxCharges)
                {
                    s.recharge -= s.cooldown;
                    s.charges++;
                }
                if (s.charges >= s.maxCharges) s.recharge = 0;
            }
        }

        /// <summary>充能上限跟着属性走：副技能 + 副技能充能；上限提高时立即得到新增的充能</summary>
        void SyncCharges(Skill s, SkillSlot slot)
        {
            int extra = slot == SkillSlot.Secondary && Vitals ? Mathf.RoundToInt(Vitals.stats.Get(Stat.SecondaryCharges)) : 0;
            int max = Mathf.Max(1, s.baseCharges + extra);
            if (max == s.maxCharges) return;
            if (max > s.maxCharges) s.charges += max - s.maxCharges;
            s.maxCharges = max;
            if (s.charges >= max)
            {
                s.charges = max;
                s.recharge = 0;
            }
        }

        /// <summary>手边的出手点（side = 1 右手 / −1 左手）：贴墙时退到墙前，半径 radius 的投射物不会生在墙里</summary>
        public Vector3 HandOrigin(float side = 1, float radius = 0.2f) => SkillFx.SafeHandOrigin(Eye, side, radius);

        void Update()
        {
            float dt = Time.deltaTime;
            float haste = Vitals ? Vitals.stats.Mult(Stat.SkillHaste) : 1;
            for (int i = 0; i < 2; i++)
            {
                var s = Get((SkillSlot)i);
                if (s == null) continue;
                SyncCharges(s, (SkillSlot)i);
                if (s.charges < s.maxCharges)
                {
                    s.recharge += dt * haste;
                    if (s.recharge >= s.cooldown)
                    {
                        s.recharge -= s.cooldown;
                        s.charges++;
                        if (s.charges >= s.maxCharges) s.recharge = 0;
                    }
                }
            }
            bool canAct = (TestMode || (Motor && Motor.inputEnabled && Cursor.lockState == CursorLockMode.Locked)) && Vitals && !Vitals.Dead
                          && !(Motor && (Motor.Frame.locks & MotorLock.Body) == MotorLock.Body); // 整个身体被锁住（下沉、硬直）时不能放技能
            bool q = TestMode ? testQ : GameInput.Pressed(GameAction.SkillQ);
            bool e = TestMode ? testE : GameInput.Pressed(GameAction.SkillE);
            testQ = testE = false;
            if (!canAct) return;
            if (q) TryCast(SkillSlot.Primary);
            if (e) TryCast(SkillSlot.Secondary);
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            for (int i = 0; i < 2; i++)
            {
                var s = Get((SkillSlot)i);
                if (s == null) continue;
                try
                {
                    s.Tick(dt);
                }
                catch (Exception ex)
                {
                    Debug.LogException(ex);
                }
            }
        }

        /// <summary>按下技能键：能放就放（扣一层充能、发事件），放不出来给拒绝反馈。返回是否放出</summary>
        public bool TryCast(SkillSlot slot)
        {
            var s = Get(slot);
            if (s == null) return false;
            if (s.charges <= 0)
            {
                Deny(slot, SkillDeny.Cooldown);
                return false;
            }
            if (s.Busy)
            {
                Deny(slot, SkillDeny.Busy);
                return false;
            }
            bool ok;
            try
            {
                ok = s.Activate();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                ok = false;
            }
            if (!ok)
            {
                Deny(slot, SkillDeny.Failed);
                return false;
            }
            s.charges--;
            try
            {
                Cast?.Invoke(s);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            GameEvents.RaiseSkillUsed(slot, s.Id);
            return true;
        }

        /// <summary>拒绝反馈：ui_deny 音 + 技能格闪红（经 GameUI），0.35 s 内只给一次</summary>
        void Deny(SkillSlot slot, SkillDeny why)
        {
            float now = Time.unscaledTime;
            if (now - lastDeny < DenyInterval) return;
            lastDeny = now;
            GameAudio.Play("ui_deny", 0.4f);
            GameUI.SkillDenied(slot);
            try
            {
                Denied?.Invoke(slot, why);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }
    }
}
