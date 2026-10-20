using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灵火坛（第四章开放图规则 D27，docs/level-design/chuanzang-v1.md 2.6：「据点任意顺序，点亮 M 处里的 N 处灵火开出口」）：
    ///   未点亮是暗的余烬；守卫场地（<see cref="guard"/>）肃清前点不着，提示「守卫未清」；
    ///   按住交互键 <see cref="kindleTime"/> 秒点亮（离开或松手就断，测试模式下不用按住）；领主据点可设 <see cref="lightOnGuardCleared"/>：打败守卫直接点亮。
    ///   点亮 = 青金色灵火 + 回满生命与护盾，记为最近点亮的灵火（<see cref="LastLit"/>，复活点单元用）；进度由 <see cref="LevelObjective"/> 计数。
    /// 模型先用程序化体块（石台 + 火盆），物体下有名为 Model 的子物体时用美术资产。
    /// </summary>
    public sealed class SpiritAltar : MonoBehaviour, IInteractable
    {
        /// <summary>灵火色（青金，「灵火破晓」）</summary>
        public static readonly Color FlameColor = new(0.62f, 0.94f, 1f);
        static readonly Color Ember = new(1f, 0.42f, 0.16f);

        public string title = "灵火坛";
        [Tooltip("守卫场地：肃清前点不着")]
        public EncounterSite guard;
        [Tooltip("领主据点：守卫肃清时直接点亮")]
        public bool lightOnGuardCleared;
        [Tooltip("按住几秒点亮")]
        public float kindleTime = 1.2f;
        [Tooltip("点亮时回满生命与护盾")]
        public bool healOnLight = true;

        public bool Lit { get; private set; }
        /// <summary>正在点（按住中）</summary>
        public bool Kindling { get; private set; }
        public float Progress => Lit ? 1 : Kindling ? Mathf.Clamp01(kindleT / Mathf.Max(0.05f, kindleTime)) : 0;

        public event Action<SpiritAltar> Lighted;
        public static event Action<SpiritAltar> AnyLit;
        /// <summary>最近点亮的灵火（复活点）</summary>
        public static SpiritAltar LastLit { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            AnyLit = null;
            LastLit = null;
        }

        float kindleT;
        Transform flame, beam;
        Renderer flameR, emberR;

        void Start()
        {
            if (!PropBits.HasModel(transform)) BuildModel();
            var glowAt = new GameObject("Flame").transform;
            glowAt.SetParent(transform, false);
            glowAt.localPosition = Vector3.up * 1.35f;
            flame = FxMaterials.GlowSprite(glowAt, 1.1f, new Color(Ember.r, Ember.g, Ember.b, 0.45f));
            flameR = flame.GetComponent<Renderer>();
            beam = FxMaterials.BeamSprite(transform, 1.2f, 9f, new Color(FlameColor.r, FlameColor.g, FlameColor.b, 0.35f));
            beam.gameObject.SetActive(false);
            Interaction.Add(this);
            if (guard) guard.Cleared += OnGuardCleared;
        }

        void OnDestroy()
        {
            Interaction.Remove(this);
            if (guard) guard.Cleared -= OnGuardCleared;
        }

        void BuildModel()
        {
            var root = new GameObject("Altar (placeholder)").transform;
            root.SetParent(transform, false);
            var stone = new Color(0.5f, 0.47f, 0.44f);
            var dark = new Color(0.22f, 0.2f, 0.2f);
            PropBits.Cylinder(root, "Base", new Vector3(0, 0.2f, 0), new Vector3(1.8f, 0.4f, 1.8f), stone, true);
            PropBits.Cylinder(root, "Pillar", new Vector3(0, 0.75f, 0), new Vector3(0.55f, 0.8f, 0.55f), stone, true);
            PropBits.Cylinder(root, "Bowl", new Vector3(0, 1.22f, 0), new Vector3(1.15f, 0.22f, 1.15f), dark, true);
            emberR = PropBits.Cylinder(root, "Embers", new Vector3(0, 1.34f, 0), new Vector3(0.8f, 0.04f, 0.8f), Ember * 0.6f);
        }

        void OnGuardCleared(EncounterSite s)
        {
            if (lightOnGuardCleared && !Lit) Light();
        }

        bool GuardBlocks => guard && guard.phase != EncounterSite.Phase.Cleared;

        void Update()
        {
            if (flame)
            {
                float t = Time.time;
                if (Lit)
                {
                    float flick = 0.85f + 0.15f * Mathf.Sin(t * 9.3f) * Mathf.Sin(t * 5.1f + 1.3f);
                    flame.localScale = Vector3.one * 2.2f * flick;
                }
                else
                {
                    float k = Kindling ? Progress : 0;
                    flame.localScale = Vector3.one * Mathf.Lerp(1.1f, 2f, k) * (0.9f + 0.1f * Mathf.Sin(t * 3f));
                    FxMaterials.Tint(flameR, Color.Lerp(new Color(Ember.r, Ember.g, Ember.b, 0.4f), new Color(FlameColor.r, FlameColor.g, FlameColor.b, 0.8f), k));
                }
            }
            if (!Kindling) return;
            var pv = PlayerVitals.Instance;
            bool holding = Interactor.TestMode || GameInput.Down(GameAction.Interact);
            if (!pv || pv.Dead || GuardBlocks || !holding || Vector3.Distance(pv.transform.position + Vector3.up * 1.6f, Focus) > Radius + 1f)
            {
                Kindling = false;
                kindleT = 0;
                return;
            }
            kindleT += Time.deltaTime;
            if (kindleT >= kindleTime) Light();
        }

        /// <summary>点亮（交互按满、领主被打败、脚本 / 测试）</summary>
        public void Light()
        {
            if (Lit) return;
            Lit = true;
            Kindling = false;
            LastLit = this;
            if (flameR) FxMaterials.Tint(flameR, new Color(FlameColor.r, FlameColor.g, FlameColor.b, 0.95f));
            if (emberR) PropBits.Tint(emberR, FlameColor);
            if (beam) beam.gameObject.SetActive(true);
            var pv = PlayerVitals.Instance;
            if (healOnLight && pv && !pv.Dead)
            {
                pv.Heal(pv.MaxHealth);
                pv.AddShield(pv.MaxShield);
            }
            ShotFx.Instance?.Impact(Focus, Vector3.up, false, 5f);
            Telegraph.Wave(transform.position, 6f, 9f, FlameColor);
            GameAudio.PlayAt("shield_recharge", Focus);
            GameUI.FloatText(Focus + Vector3.up * 0.8f, "灵火点亮", FlameColor, 1.6f);
            Lighted?.Invoke(this);
            AnyLit?.Invoke(this);
        }

        // ── IInteractable ──
        public Vector3 Focus => transform.position + Vector3.up * 1.2f;
        public float Radius => 3.2f;
        public bool CanInteract => !Lit;

        public string Prompt =>
            Lit ? "灵火已点亮"
            : GuardBlocks ? $"守卫未清 · 先肃清{guard.title}"
            : Kindling ? $"点亮灵火 · {Mathf.RoundToInt(Progress * 100)}%"
            : "点亮灵火（按住）";

        public InteractPrompt PromptCard => new()
        {
            title = title,
            subtitle = Lit ? "已点亮" : GuardBlocks ? "守卫未清" : Kindling ? $"点燃中 {Mathf.RoundToInt(Progress * 100)}%" : "按住点亮",
            lines = GuardBlocks ? new[] { $"先肃清「{guard.title}」" } : new[] { "点亮：回满生命与护盾" },
            color = GuardBlocks ? new Color(1f, 0.6f, 0.45f) : FlameColor,
        };

        public void Interact()
        {
            if (Lit || Kindling) return;
            if (GuardBlocks)
            {
                GameAudio.Play("ui_deny");
                GameUI.Toast($"{title}：守卫还在，先肃清「{guard.title}」", new Color(1f, 0.71f, 0.49f));
                return;
            }
            Kindling = true;
            kindleT = 0;
        }

        void OnDrawGizmos()
        {
            Gizmos.color = Lit ? FlameColor : Ember;
            Gizmos.DrawWireSphere(transform.position + Vector3.up * 1.2f, 0.6f);
            if (guard)
            {
                Gizmos.color = new Color(1, 0.5f, 0.2f, 0.5f);
                Gizmos.DrawLine(transform.position + Vector3.up, guard.transform.position + Vector3.up);
            }
        }
    }
}
