using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>英雄技能（Three.js 版 src/player/skills/common.ts 的 HeroSkillDef）：充能制冷却，技能急速加快回充</summary>
    public abstract class Skill
    {
        public string name, description;
        public float cooldown = 8;
        public int maxCharges = 1;
        public int charges;
        /// <summary>下一层充能已经回了多少秒</summary>
        public float recharge;
        protected HeroSkills owner;

        public void Bind(HeroSkills o)
        {
            owner = o;
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

        /// <summary>手边的出手点（side = 1 右手 / -1 左手）</summary>
        public Vector3 HandOrigin(float side = 1) => Eye.position + Eye.right * 0.24f * side - Eye.up * 0.2f + Eye.forward * 0.45f;

        void Update()
        {
            float dt = Time.deltaTime;
            float haste = Vitals ? Vitals.stats.Mult(Stat.SkillHaste) : 1;
            foreach (var s in new[] { primary, secondary })
            {
                if (s == null) continue;
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
            if (q) TryCast(primary);
            if (e) TryCast(secondary);
        }

        bool TryCast(Skill s)
        {
            if (s == null || s.charges <= 0 || s.Busy) return false;
            if (!s.Activate()) return false;
            s.charges--;
            Cast?.Invoke(s);
            return true;
        }
    }
}
