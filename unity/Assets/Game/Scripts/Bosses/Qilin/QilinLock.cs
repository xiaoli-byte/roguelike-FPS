using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 吊鼎锁扣（Three.js QilinLock / boss_qilin_lock；3-4 祝融炉心，docs/level-design/maps/3-4.md）：炉心殿东南西北四面外墙上的可射击目标。
    /// 巨鼎的四条巨链各拴在一个锁扣上，打碎一个，鼎的那一角坠下（<see cref="QilinCauldron.DropCorner"/>）——
    /// 麒麟正在那一侧熔池边饮熔时砸中它（眩晕 4 秒、鳞甲崩裂），否则砸空、白费一个。
    ///   关卡构建器摆（物体位置 = 锁身中心，+Z 朝殿心）；<see cref="index"/> = 象限下标（<see cref="QilinFurnace.QuadrantYaw"/>，与吊鼎的四个角同序）。
    ///   休眠（<see cref="LockState.Dormant"/>）：不可选中、暗着——登场结束前打不碎（同 TS：登场结束才召出锁扣）；
    ///   <see cref="Arm"/>：首领登场结束时上膛，血量 110 × 难度（第三章难度约 3 时 ≈ 340：常规武器一秒多打碎，比首领弱点好打，但要专门瞄）；
    ///     发光锁芯是弱点球（必定暴击）；首领在这一侧饮熔时 <see cref="Highlight"/> 大亮；
    ///   碎了（<see cref="LockState.Broken"/>）：派发 <see cref="Broken"/>，锁身碎开往下掉，碰撞体撤掉；
    ///   <see cref="Purge"/>：55% 时剩下的铁链全断，静默移除（不派发 Broken）。
    /// 不移动、不攻击、不掉落、不进敌人登记（同狐巫冰壁：只是一个可破坏的 <see cref="Damageable"/>，不给奖励）。
    /// 碰撞体在 Character 层：子弹打得到，视线 / 导航不受影响。
    /// 外观：物体下有名为 Model 的子物体（正式美术 SM_Prop_QilinChainLock，ART6 暂缓）就用它，否则运行时搭程序锁扣（背板、锁身、锁梁、锁芯、光晕）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class QilinLock : MonoBehaviour
    {
        public enum LockState { Dormant, Armed, Broken, Purged }

        public const string DisplayName = "吊鼎锁扣";
        /// <summary>难度 1 的血量（TS QILIN_LOCK_DEF.hp），上膛时 × 难度</summary>
        public const float BaseHp = 110f;
        /// <summary>锁身尺寸（正式美术 2 × 2.4 × 1.2 m，背面贴墙）与锁芯弱点半径</summary>
        public static readonly Vector3 Size = new(2f, 2.4f, 1.2f);
        public const float CoreRadius = 0.42f;
        /// <summary>碎开后的下坠时长（秒）</summary>
        public const float CollapseTime = 0.6f;

        static readonly Color Bronze = Hex.Rgb(0x6a4a24), Iron = Hex.Rgb(0x1e1a18), Core = Hex.Rgb(0xffd070), Halo = Hex.Rgb(0xff7a20);

        [Tooltip("象限下标（QilinFurnace.QuadrantYaw，与吊鼎四个角同序）")] public int index;

        static readonly List<QilinLock> all = new();

        /// <summary>场景里的锁扣（含已碎的）</summary>
        public static IReadOnlyList<QilinLock> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        public LockState State { get; private set; }
        public Damageable Health { get; private set; }
        /// <summary>首领正在这一侧饮熔：锁扣大亮（该打哪一个）</summary>
        public bool Highlight { get; set; }
        /// <summary>还挂着、可以打（上膛且没碎）</summary>
        public bool Alive => State == LockState.Armed && Health && !Health.Dead;
        /// <summary>巨链拴在哪（锁梁顶端，世界坐标由 Transform 给）</summary>
        public Transform ChainPoint { get; private set; }
        /// <summary>锁芯（弱点球）</summary>
        public Transform CoreTransform { get; private set; }

        /// <summary>被打碎（不含静默移除）</summary>
        public event Action<QilinLock> Broken;

        Collider bodyCollider, coreCollider;
        Transform model, coreVisual, halo;
        Renderer coreRenderer;
        float glowK, age, collapse = -1;
        bool built;

        void Awake() => Build();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>搭受伤体、碰撞体、外观（只做一次；Awake 调，测试运行时 AddComponent 后也可以直接调）</summary>
        public void Build()
        {
            if (built) return;
            built = true;
            Health = GetComponent<Damageable>();
            if (!Health) Health = gameObject.AddComponent<Damageable>();
            Health.displayName = DisplayName;
            Health.noReward = true;
            Health.rank = Rank.Normal;
            Health.maxHealth = BaseHp;
            Health.ResetVitals();
            Health.untargetable = true;
            Health.Died += OnDied;

            var existing = transform.Find("Model");
            model = existing ? existing : BuildModel();

            // 锁身：一个盒（背板 + 锁身合起来的外包），Character 层
            var bodyGo = new GameObject("Lock Body") { layer = Layers.Character };
            bodyGo.transform.SetParent(transform, false);
            bodyGo.transform.localPosition = new Vector3(0, 0, -Size.z * 0.25f);
            var box = bodyGo.AddComponent<BoxCollider>();
            box.size = new Vector3(Size.x * 0.85f, Size.y * 0.9f, Size.z * 0.6f);
            var hb = bodyGo.AddComponent<Hitbox>();
            hb.owner = Health;
            bodyCollider = box;

            // 锁芯：弱点球，贴在锁身正面
            var coreGo = new GameObject("Lock Core") { layer = Layers.Character };
            coreGo.transform.SetParent(transform, false);
            coreGo.transform.localPosition = new Vector3(0, -0.1f, Size.z * 0.18f);
            var sph = coreGo.AddComponent<SphereCollider>();
            sph.radius = CoreRadius;
            var chb = coreGo.AddComponent<Hitbox>();
            chb.owner = Health;
            chb.weakpoint = true;
            coreCollider = sph;
            CoreTransform = coreGo.transform;

            var chain = transform.Find("Chain Point");
            if (!chain)
            {
                chain = new GameObject("Chain Point").transform;
                chain.SetParent(transform, false);
                chain.localPosition = new Vector3(0, Size.y * 0.5f + 0.35f, 0.15f);
            }
            ChainPoint = chain;
            State = LockState.Dormant;
        }

        /// <summary>程序锁扣（ART6 暂缓期间的运行时外观）：铁背板 + 青铜锁身 + 铁锁梁 + 发光锁芯 + 光晕</summary>
        Transform BuildModel()
        {
            var root = new GameObject("Model (procedural)").transform;
            root.SetParent(transform, false);
            PropBits.Box(root, "Back Plate", new Vector3(0, 0, -Size.z * 0.42f), new Vector3(Size.x, Size.y, 0.25f), Iron);
            for (int i = 0; i < 4; i++)
            {
                float sx = i % 2 == 0 ? -1 : 1, sy = i < 2 ? -1 : 1;
                PropBits.Box(root, "Rivet", new Vector3(sx * Size.x * 0.4f, sy * Size.y * 0.42f, -Size.z * 0.28f), Vector3.one * 0.18f, Bronze);
            }
            PropBits.Box(root, "Clasp", new Vector3(0, -0.15f, -Size.z * 0.1f), new Vector3(Size.x * 0.72f, Size.y * 0.55f, 0.6f), Bronze);
            // 锁梁：两根竖杆 + 一根横梁（拴巨链）
            PropBits.Box(root, "Shackle L", new Vector3(-0.45f, Size.y * 0.32f, 0), new Vector3(0.22f, 0.9f, 0.22f), Iron);
            PropBits.Box(root, "Shackle R", new Vector3(0.45f, Size.y * 0.32f, 0), new Vector3(0.22f, 0.9f, 0.22f), Iron);
            PropBits.Box(root, "Shackle Top", new Vector3(0, Size.y * 0.5f + 0.1f, 0), new Vector3(1.12f, 0.24f, 0.24f), Iron);
            var core = PropBits.Box(root, "Core Glow", new Vector3(0, -0.1f, Size.z * 0.2f), Vector3.one * 0.46f, Core);
            core.transform.localRotation = Quaternion.Euler(0, 0, 45);
            core.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(core, Core * 0.9f);
            coreRenderer = core;
            coreVisual = core.transform;
            halo = FxMaterials.GlowSprite(root, 1.4f, new Color(Halo.r, Halo.g, Halo.b, 0.35f));
            halo.localPosition = new Vector3(0, -0.1f, Size.z * 0.3f);
            return root;
        }

        // ───────────── 状态 ─────────────

        /// <summary>上膛（首领登场结束时调）：血量 = 110 × 难度、可以选中、开始发光。已碎 / 已移除的不变</summary>
        public void Arm(float difficulty)
        {
            Build();
            if (State != LockState.Dormant) return;
            float d = float.IsFinite(difficulty) && difficulty > 0 ? difficulty : 1f;
            Health.maxHealth = Mathf.Max(1, EnemyAI.RoundHp(BaseHp * d));
            Health.ResetVitals();
            Health.untargetable = false;
            State = LockState.Armed;
            Fx.Burst(transform.position, Halo, 12, 3f, 0.5f, 0.12f, 1f);
        }

        /// <summary>静默移除（55% 剩下的链全断时）：不派发 Broken，锁身碎开往下掉</summary>
        public void Purge()
        {
            Build();
            if (State is LockState.Broken or LockState.Purged) return;
            State = LockState.Purged;
            Highlight = false;
            Health.untargetable = true;
            Fx.Burst(transform.position, Hex.Rgb(0xffb050), 10, 6f, 0.7f, 0.2f, 10f);
            BeginCollapse();
        }

        /// <summary>测试 / 剧本：直接打碎（走伤害管线以外的路径，同样派发 Broken）。只在上膛中有效</summary>
        public void Shatter()
        {
            if (!Alive) return;
            Health.Kill(DamageInfo.Simple(Health.health + 1, DamageSource.Weapon, transform.position, -transform.forward));
        }

        void OnDied(DamageInfo info)
        {
            if (State != LockState.Armed) return;
            State = LockState.Broken;
            Highlight = false;
            var c = CoreTransform ? CoreTransform.position : transform.position;
            Fx.Burst(c, Hex.Rgb(0xffb050), 30, 8f, 0.8f, 0.3f, 14f);
            Fx.Burst(c, Hex.Rgb(0x3a2a20), 14, 5f, 0.9f, 0.35f, 16f);
            GameAudio.PlayAt("shield_break", c, 1f, 0.7f);
            CameraShake.Quake(c, 0.25f, 40f, 0.25f);
            BeginCollapse();
            if (Broken == null) return;
            try
            {
                Broken(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void BeginCollapse()
        {
            if (bodyCollider) bodyCollider.enabled = false;
            if (coreCollider) coreCollider.enabled = false;
            collapse = 0;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (collapse >= 0)
            {
                // 锁身碎开、往下掉（TS animateDeath）
                collapse += dt;
                float t = Mathf.Clamp01(collapse / CollapseTime);
                if (model)
                {
                    model.localPosition = new Vector3(0, -3f * t * t, 0);
                    model.localRotation = Quaternion.Euler(t * 80f, 0, 0);
                    model.localScale = Vector3.one * Mathf.Max(0.01f, 1 - t * 0.6f);
                    if (t >= 1f) model.gameObject.SetActive(false);
                }
                return;
            }
            // 发光：休眠暗、上膛慢闪、饮熔这一侧大亮快闪
            float want = State == LockState.Armed ? (Highlight ? 1f : 0.25f) : 0f;
            glowK += (want - glowK) * Mathf.Min(1f, dt * 5f);
            float k = 0.75f + 0.25f * Mathf.Sin(age * (4f + 6f * glowK) + index);
            if (halo) halo.localScale = Vector3.one * 1.4f * (0.6f + 0.25f * k) * (0.6f + 1.4f * glowK);
            if (coreVisual) coreVisual.localRotation = Quaternion.Euler(0, 0, 45 + age * (20f + 160f * glowK));
            if (coreRenderer) FxMaterials.Tint(coreRenderer, Core * (0.35f + 1.4f * glowK * k));
        }

        void OnDestroy()
        {
            if (Health) Health.Died -= OnDied;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.6f, 0.2f, 0.8f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, Size);
            Gizmos.matrix = Matrix4x4.identity;
        }
    }
}
