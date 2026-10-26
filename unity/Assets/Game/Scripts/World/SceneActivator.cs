using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 能被机关开关驱动的场景件（L6）：<see cref="MovingPlatform"/>（通电 / 开往另一头）、<see cref="BreakableSpan"/>（断）、<see cref="Destructible"/>（碎）、
    /// 另一个 <see cref="SceneActivator"/>（连锁）。on = 开关的新状态（拨杆式开关可开可关；一次性 / 按钮式每次都是 true）
    /// </summary>
    public interface IActivatable
    {
        void OnActivated(SceneActivator source, bool on);
    }

    /// <summary>
    /// 机关开关（L6 场景件；parity 表里叫 Activator，和 System.Activator 重名会让 using System 的文件编不过，所以叫 SceneActivator）：射一下或按 F 都能触发，触发时通知 <see cref="targets"/>（<see cref="IActivatable"/>）并发 <see cref="Activated"/> 事件。
    ///   · 射击：根节点上的 <see cref="Damageable"/>（不给奖励、不计击杀、血量无限：每一下之后回满）——命中盒（<see cref="Hitbox"/>，挡视线）挂在靶子上，
    ///     子弹 / 近战 / 技能 / 爆炸 / 秘卷 / 灵宠打中、单次伤害 ≥ <see cref="minShotDamage"/> 就触发；持续伤害跳字、敌人和环境的伤害不算。
    ///   · 交互：<see cref="IInteractable"/>，靠近按 F；<see cref="byInteract"/> 关掉就只能射。
    ///   · 种类：按钮（每次发「开」）/ 拨杆（<see cref="toggle"/>：开关来回切，发新状态）/ 一次性（<see cref="oneShot"/>）；两次触发之间至少隔 <see cref="cooldown"/> 秒。
    ///   · 锁：<see cref="lockedBy"/> 场地肃清前拉不动、射不响（提示一次）。
    ///   · 外观：<see cref="swing"/>（锣面 / 拉杆）被触发时摆一下，<see cref="lamps"/> 按开 / 关换色发光；关卡没给模型（没有 Model 子物体）时运行时拼一个
    ///     占位：木架 + 一面铜锣（锣面带碰撞和命中盒）+ 顶上一盏灯（4.11 占位策略）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SceneActivator : MonoBehaviour, IInteractable, IActivatable
    {
        public enum Cause { Shot, Interact, Signal, Script }

        [Header("触发")]
        public bool byShot = true, byInteract = true;
        [Tooltip("射击：单次伤害至少这么多才算（过滤溅射擦边）")]
        public float minShotDamage = 1f;
        [Tooltip("拨杆：每次触发在开 / 关之间切，发出的信号 = 新状态；否则每次都发「开」")]
        public bool toggle;
        [Tooltip("只能触发一次")]
        public bool oneShot;
        [Tooltip("两次触发之间至少隔多久（秒）")]
        public float cooldown = 0.6f;
        [Tooltip("这个场地肃清前锁着（空 = 不锁）")]
        public EncounterSite lockedBy;
        public string lockedHint = "机关被锁死了 · 先肃清附近的守军";

        [Header("驱动")]
        [Tooltip("触发时通知的件（要实现 IActivatable：MovingPlatform、BreakableSpan、Destructible、另一个 SceneActivator）")]
        public MonoBehaviour[] targets = Array.Empty<MonoBehaviour>();

        [Header("外观 / 提示")]
        [Tooltip("触发时摆一下的部件（锣面 / 拉杆），绕本地 X 轴")]
        public Transform swing;
        [Tooltip("按开 / 关换色发光的灯")]
        public Renderer[] lamps = Array.Empty<Renderer>();
        public Color onColor = new(1f, 0.72f, 0.3f), offColor = new(0.32f, 0.3f, 0.28f);
        public string title = "机关", verb = "敲响";
        [Tooltip("提示卡上的说明（这个机关会做什么）")]
        public string hint = "";
        [Tooltip("触发时的提示（空 = 不提示）")]
        public string toast = "";
        [Tooltip("交互点离根节点多高、交互半径")]
        public float focusHeight = 1.4f, interactRadius = 3f;

        static readonly List<SceneActivator> all = new();
        /// <summary>场上的机关（测试用）</summary>
        public static IReadOnlyList<SceneActivator> All => all;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), EmissionId = Shader.PropertyToID("_EmissionColor");

        /// <summary>拨杆的当前状态（按钮式：触发过一次后为 true）</summary>
        public bool On { get; private set; }
        /// <summary>触发过几次、最近一次的方式 / 时刻</summary>
        public int Count { get; private set; }
        public Cause LastCause { get; private set; }
        public float LastActivatedAt { get; private set; } = -1;
        public Damageable Health { get; private set; }
        public bool Locked => lockedBy && lockedBy.phase != EncounterSite.Phase.Cleared;
        /// <summary>一次性的已经用掉了</summary>
        public bool Spent => oneShot && Count > 0;
        public bool Ready => !Spent && !Locked && (LastActivatedAt < 0 || Time.time - LastActivatedAt >= cooldown);

        /// <summary>触发（开关、新状态）</summary>
        public event Action<SceneActivator, bool> Activated;

        MaterialPropertyBlock block;
        float swingT = -1, lockHintAt;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake()
        {
            if (!PropBits.HasModel(transform)) BuildPlaceholder();
            Health = GetComponent<Damageable>();
            if (!Health) Health = gameObject.AddComponent<Damageable>();
            Health.maxHealth = 1e6f;
            Health.displayName = title;
            Health.noReward = true;
            Health.ResetVitals();
            Health.Damaged += OnDamaged;
            // 关卡给的靶子碰撞体没挂命中盒的，补上（挡视线：它是实心的锣 / 拉杆）
            foreach (var c in GetComponentsInChildren<Collider>(true))
            {
                if (c.isTrigger) continue;
                var hb = c.GetComponent<Hitbox>();
                if (!hb) hb = c.gameObject.AddComponent<Hitbox>();
                if (!hb.owner) hb.owner = Health;
                hb.blocksSight = true;
            }
            block = new MaterialPropertyBlock();
            Tint(0);
        }

        void OnEnable()
        {
            all.Add(this);
            Interaction.Add(this);
        }

        void OnDisable()
        {
            all.Remove(this);
            Interaction.Remove(this);
        }

        void OnDestroy()
        {
            if (Health) Health.Damaged -= OnDamaged;
        }

        // ───────────── 触发 ─────────────

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            // 血量无限：每一下之后回满（不会被打死、不掉落）
            if (Health) Health.ResetVitals();
            if (!byShot || DamageCalc.IsDot(info) || info.source is DamageSource.Enemy or DamageSource.Environment or DamageSource.Status) return;
            if (r.total < minShotDamage && info.amount < minShotDamage) return;
            Activate(Cause.Shot);
        }

        /// <summary>触发一次（射击 / 交互 / 信号 / 脚本）。force = 不看锁、冷却和一次性。返回是否真的触发了</summary>
        public bool Activate(Cause cause = Cause.Script, bool force = false)
        {
            if (!force && !Ready)
            {
                if (Locked && Time.time >= lockHintAt && cause != Cause.Signal)
                {
                    lockHintAt = Time.time + 1.5f;
                    GameUI.Toast(lockedHint, new Color(1f, 0.6f, 0.45f));
                    GameAudio.PlayAt("enemy_melee", Focus, 0.4f, 0.6f);
                }
                return false;
            }
            Count++;
            LastCause = cause;
            LastActivatedAt = Time.time;
            On = toggle ? !On : true;
            swingT = 0;
            Tint(1);
            GameAudio.PlayAt("hit_armor", Focus, 0.9f, 0.55f);
            GameAudio.PlayAt("ui_confirm", Focus, 0.5f, On ? 1f : 0.8f);
            Fx.Burst(swing ? swing.position : Focus, On ? onColor : offColor, 10, 3f, 0.4f, 0.08f, 3f);
            if (!string.IsNullOrEmpty(toast)) GameUI.Toast(toast, onColor);
            foreach (var t in targets)
            {
                if (!t || t == this || t is not IActivatable a) continue;
                try
                {
                    a.OnActivated(this, On);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (Activated != null)
                try
                {
                    Activated(this, On);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            return true;
        }

        /// <summary>被别的机关串着触发（连锁）：不看冷却</summary>
        public void OnActivated(SceneActivator source, bool on)
        {
            if (source == this) return;
            if (toggle && On == on) return;
            Activate(Cause.Signal, true);
        }

        // ───────────── 交互 ─────────────

        public Vector3 Focus => transform.position + Vector3.up * focusHeight;
        public float Radius => interactRadius;
        public bool CanInteract => byInteract && !Spent;
        public string Prompt => Locked ? $"{title} · 锁着" : toggle ? $"{(On ? "关上" : "打开")}{title}" : $"{verb}{title}";

        public InteractPrompt PromptCard => new()
        {
            title = title,
            subtitle = Locked ? "锁着" : toggle ? (On ? "关上" : "打开") : verb,
            lines = Locked ? new[] { lockedHint } : string.IsNullOrEmpty(hint) ? null : new[] { hint },
            color = onColor,
        };

        public void Interact() => Activate(Cause.Interact);

        // ───────────── 外观 ─────────────

        void Update()
        {
            if (swingT < 0) return;
            swingT += Time.deltaTime;
            // 衰减的摆动（锣面被敲 / 拉杆回弹）
            float k = Mathf.Exp(-swingT * 3.2f);
            if (swing) swing.localRotation = Quaternion.Euler(28f * k * Mathf.Sin(swingT * 15f), 0, 0);
            // 灯：一闪之后落到开 / 关的常亮
            Tint(Mathf.Max(0, k));
            if (k < 0.01f)
            {
                swingT = -1;
                if (swing) swing.localRotation = Quaternion.identity;
                Tint(0);
            }
        }

        void Tint(float flash)
        {
            if (block == null) return;
            bool lit = On || flash > 0.01f;
            var c = On ? onColor : offColor;
            foreach (var r in lamps)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor(BaseColorId, c);
                block.SetColor(EmissionId, lit ? onColor * (On ? 1.6f + 2.4f * flash : 3f * flash) : Color.black);
                r.SetPropertyBlock(block);
            }
        }

        /// <summary>占位：木架（两根立柱 + 横梁）+ 挂在横梁下的铜锣（锣面带碰撞）+ 顶上一盏灯</summary>
        void BuildPlaceholder()
        {
            var wood = new Color(0.42f, 0.27f, 0.16f);
            foreach (int side in new[] { -1, 1 })
                PropBits.Box(transform, side < 0 ? "Post L" : "Post R", new Vector3(side * 0.75f, 1.1f, 0), new Vector3(0.16f, 2.2f, 0.16f), wood, true);
            PropBits.Box(transform, "Beam", new Vector3(0, 2.15f, 0), new Vector3(1.7f, 0.14f, 0.18f), wood);
            var pivot = new GameObject("Swing").transform;
            pivot.SetParent(transform, false);
            pivot.localPosition = new Vector3(0, 2.05f, 0);
            swing = pivot;
            var gong = PropBits.Cylinder(pivot, "Gong", new Vector3(0, -0.7f, 0), new Vector3(1f, 0.08f, 1f), new Color(0.78f, 0.55f, 0.22f));
            gong.transform.localRotation = Quaternion.Euler(90, 0, 0);
            var box = gong.gameObject.AddComponent<BoxCollider>();
            box.size = new Vector3(1f, 1f, 1f);
            var lamp = PropBits.Box(transform, "Lamp", new Vector3(0, 2.35f, 0), new Vector3(0.24f, 0.24f, 0.24f), offColor);
            if (lamp.sharedMaterial) lamp.material.EnableKeyword("_EMISSION");
            lamps = new[] { lamp };
            focusHeight = 1.35f;
        }
    }
}
