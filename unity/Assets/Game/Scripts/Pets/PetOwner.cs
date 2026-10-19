using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>
    /// 挂在玩家身上（docs/pet-system.md 第 2、3、5 节）：当前灵宠、结契 / 换宠（旧灵宠变回封印留在原地，灵契等级保留）、
    /// G 键灵技（测试用 testSkill 代替按键）、任何敌人被击杀给灵契经验（普通 1、精英 4；召唤物不给）。
    /// 每局只带 1 只；跨关时由 <see cref="IRunPersistent"/> 存进 <see cref="RunState.pet"/>（D15）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PetOwner : MonoBehaviour, IRunPersistent
    {
        public static PetOwner Instance { get; private set; }
        public static bool TestMode;
        [NonSerialized] public bool testSkill;

        public const int NormalXp = 1, EliteXp = 4;

        public Pet Current { get; private set; }
        public PlayerVitals Vitals { get; private set; }
        public PlayerMotor Motor { get; private set; }
        /// <summary>玩家视线（相机）：灵技沿准星、重瞳标记都用它</summary>
        public Transform Eye { get; private set; }
        public event Action<Pet> Bound, Unbound, SkillCast;

        /// <summary>玩家水平朝向（视线压平）</summary>
        public Vector3 Forward
        {
            get
            {
                var f = Eye ? Eye.forward : transform.forward;
                f.y = 0;
                if (f.sqrMagnitude < 1e-4f) f = transform.forward;
                f.y = 0;
                return f.sqrMagnitude > 1e-4f ? f.normalized : Vector3.forward;
            }
        }

        void Awake()
        {
            Instance = this;
            Vitals = GetComponent<PlayerVitals>();
            Motor = GetComponent<PlayerMotor>();
            var wc = GetComponent<WeaponController>();
            Eye = wc && wc.eye ? wc.eye.transform : Motor && Motor.eye ? Motor.eye : transform;
        }

        void OnEnable()
        {
            Combat.EnemyKilled += OnKilled;
            RunPersistence.Register(this);
        }

        void OnDisable()
        {
            Combat.EnemyKilled -= OnKilled;
            RunPersistence.Unregister(this);
        }

        /// <summary>跨关快照：当前灵宠的 id、灵契等级 / 经验、灵技冷却剩余</summary>
        public void Capture(RunState s)
        {
            s.pet = Current ? new PetSave { id = Current.def.id, level = Current.Level, xp = Current.Xp, cooldownLeft = Current.SkillLeft } : null;
        }

        /// <summary>新关卡里按快照重新结契（按「换回来」处理：神兽不再放出场演出，冷却接着算）</summary>
        public void Restore(RunState s)
        {
            if (s.pet == null || string.IsNullOrEmpty(s.pet.id)) return;
            if (Current && Current.def.id == s.pet.id) return;
            var def = PetLibrary.Get(s.pet.id);
            if (def != null) Bind(def, Mathf.Max(1, s.pet.level), s.pet.xp, null, Time.time + s.pet.cooldownLeft, true);
        }

        void OnDestroy()
        {
            if (Current)
            {
                Current.Release();
                Destroy(Current.gameObject);
            }
            if (Instance == this) Instance = null;
        }

        /// <summary>
        /// 结契：生成灵宠（出场弹出 + 横幅）。已有灵宠时旧的变回封印留在它现在的位置（带着灵契等级）。
        /// at = 灵宠出现的位置（默认玩家身侧）；cooldownEndsAt = 灵技冷却结束时刻（换回来不刷新冷却）；
        /// rebind = 结契过又换回来的（神兽不再放「神兽现世」演出）
        /// </summary>
        public Pet Bind(PetDef def, int level = 1, float xp = 0, Vector3? at = null, float cooldownEndsAt = 0, bool rebind = false)
        {
            if (def == null) return null;
            var f = Forward;
            var right = new Vector3(f.z, 0, -f.x);
            var pos = at ?? transform.position + right * 1.4f - f * 0.6f;
            if (Current)
            {
                var old = Current;
                Current = null;
                old.Release();
                var seal = PetSeal.Drop(old.def, old.transform.position + Vector3.up * 0.6f, Vector3.up * 3f, old.Level, old.Xp);
                if (seal)
                {
                    seal.cooldownEndsAt = Time.time + old.SkillLeft;
                    seal.bound = true;
                }
                Unbound?.Invoke(old);
                Destroy(old.gameObject);
            }
            Current = Pet.Spawn(def, this, pos, Quaternion.LookRotation(f), level, xp, cooldownEndsAt - Time.time);
            Announce(def, rebind);
            Bound?.Invoke(Current);
            return Current;
        }

        /// <summary>解除结契（不留封印，测试 / 剧情用）</summary>
        public void Unbind()
        {
            if (!Current) return;
            var old = Current;
            Current = null;
            old.Release();
            PetFx.Burst(old.Center, old.def.RarityColor, 2f, 0.4f);
            Unbound?.Invoke(old);
            Destroy(old.gameObject);
        }

        void Announce(PetDef def, bool rebind)
        {
            // 横幅 / 提示整体淡出，富文本颜色标签不会跟着淡，所以这里只用 size 标签
            if (def.rarity == PetRarity.Mythic && !rebind)
            {
                // 神兽：大横幅 + 金色光柱冲天 + 全屏金光
                // 横幅框只有一行高：两行会压到下面的提示上，所以神兽名放进提示里
                GameUI.Banner("<size=92>神兽现世</size>", seconds: 3.2f);
                PetFx.Pillar(Current.transform.position, PetRarities.Gold, 2.4f, 30f, 2.6f);
                PetFx.Pillar(Current.transform.position, PetRarities.Color(PetRarity.Mythic), 1f, 30f, 2.2f);
                GameUI.ScreenFlash(new Color(1f, 0.82f, 0.4f, 0.45f), 0.9f);
                ShotFx.Instance?.MuzzleFlash(Current.transform.position + Vector3.up, 4f);
            }
            else
            {
                GameUI.Banner($"结契 · {def.Label}", seconds: 2.2f);
                PetFx.Pillar(Current.transform.position, def.RarityColor, 1f, 6f, 1.2f);
            }
            GameUI.Toast(def.rarity == PetRarity.Mythic && !rebind
                ? $"结契 · 神兽 {def.name} · {def.title}　[G] {def.skillName}"
                : $"{def.title} · {def.role}　[G] {def.skillName}", seconds: 3.2f);
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            if (!Current || !d || d.noReward) return;
            Current.AddXp(d.elite ? EliteXp : NormalXp);
        }

        void Update()
        {
            var kb = Keyboard.current;
            bool g = TestMode ? testSkill : kb != null && kb.gKey.wasPressedThisFrame;
            testSkill = false;
            if (!g || !Current) return;
            bool canAct = (TestMode || (Motor && Motor.inputEnabled && Cursor.lockState == CursorLockMode.Locked)) && Vitals && !Vitals.Dead && Time.timeScale > 0;
            if (canAct) TryCast();
        }

        /// <summary>放灵技：成功时广播 SkillCast（HUD 闪一下）</summary>
        public bool TryCast()
        {
            if (!Current) return false;
            if (!Current.TryCast())
            {
                if (Current.SkillLeft > 0) GameUI.Toast($"{Current.def.skillName} 冷却中 {Current.SkillLeft:F0} 秒", seconds: 0.8f);
                return false;
            }
            SkillCast?.Invoke(Current);
            return true;
        }
    }
}
