using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>技能槽：Q = 主技能，E = 副技能</summary>
    public enum SkillSlot { Primary, Secondary }

    /// <summary>英雄技能（Three.js 版 src/player/skills/common.ts 的 HeroSkillDef）：充能制冷却，技能急速加快回充</summary>
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

        public void Bind(HeroSkills o)
        {
            owner = o;
            baseCharges = maxCharges;
            charges = maxCharges;
        }

        /// <summary>释放：返回 false 表示没放出去（不扣充能）</summary>
        public abstract bool Activate();
        public virtual void Tick(float dt) { }
        public virtual bool Busy => false;
        public virtual void Reset() { }
        public float CooldownLeft => charges >= maxCharges ? 0 : Mathf.Max(0, cooldown - recharge);
    }

    /// <summary>
    /// 玩家身上的技能槽：Q = 主技能，E = 副技能；被动在 Configure 时登记。测试用 testQ / testE 代替按键。
    /// 副技能充能上限 = 技能自身 + 属性「副技能充能」（上限提高时立即得到新增的充能）。放出技能发 <see cref="GameEvents.SkillUsed"/>。
    /// </summary>
    public sealed class HeroSkills : MonoBehaviour
    {
        public static bool TestMode;
        public bool testQ, testE;
        public string heroId = "fox";
        public string passiveName, passiveDescription;

        public Skill primary, secondary;
        public PlayerMotor Motor { get; private set; }
        public PlayerVitals Vitals { get; private set; }
        public Transform Eye { get; private set; }
        public event Action<Skill> Cast;
        /// <summary>被动的输出修饰器句柄（换英雄 / 销毁时撤销）</summary>
        IDisposable passive;

        void Awake()
        {
            Motor = GetComponent<PlayerMotor>();
            Vitals = GetComponent<PlayerVitals>();
            var wc = GetComponent<WeaponController>();
            Eye = wc && wc.eye ? wc.eye.transform : transform;
            Configure(heroId);
        }

        void OnDestroy()
        {
            passive?.Dispose();
            passive = null;
        }

        public void Configure(string id)
        {
            heroId = id;
            passive?.Dispose();
            passive = null;
            switch (id)
            {
                default:
                    primary = new LiaoNineTails();
                    secondary = new LiaoBlazeGrenade();
                    passiveName = "余烬";
                    passiveDescription = $"对处于灼烧状态的敌人造成的所有伤害提高 {LiaoSkills.EmberBonus * 100:F0}%。";
                    passive = Combat.Outgoing.Add((in HitContext c) => EnemyStatus.IsBurning(c.target) ? 1 + LiaoSkills.EmberBonus : 1f);
                    break;
            }
            primary.Bind(this);
            secondary.Bind(this);
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

        /// <summary>手边的出手点（side = 1 右手 / -1 左手）</summary>
        public Vector3 HandOrigin(float side = 1) => Eye.position + Eye.right * 0.24f * side - Eye.up * 0.2f + Eye.forward * 0.45f;

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
                s.Tick(dt);
            }
            bool canAct = (TestMode || (Motor.inputEnabled && Cursor.lockState == CursorLockMode.Locked)) && Vitals && !Vitals.Dead;
            var kb = Keyboard.current;
            bool q = TestMode ? testQ : kb != null && kb.qKey.wasPressedThisFrame;
            bool e = TestMode ? testE : kb != null && kb.eKey.wasPressedThisFrame;
            testQ = testE = false;
            if (!canAct) return;
            if (q) TryCast(SkillSlot.Primary);
            if (e) TryCast(SkillSlot.Secondary);
        }

        bool TryCast(SkillSlot slot)
        {
            var s = Get(slot);
            if (s == null || s.charges <= 0 || s.Busy) return false;
            if (!s.Activate()) return false;
            s.charges--;
            Cast?.Invoke(s);
            GameEvents.RaiseSkillUsed(slot, s.Id);
            return true;
        }
    }
}
