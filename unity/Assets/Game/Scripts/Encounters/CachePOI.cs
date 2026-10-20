using System;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 支路藏宝点（docs/unity-parity.md 3.10「支路藏宝」；TS StageDirector.discoverSites + ChallengeEntrance）：不在主线上的可选奖励。
    ///   发现：玩家走到 <see cref="discoverRadius"/> 以内、眼睛看得到它（地形 / 建筑不挡；贴到 2.5 m 以内不看视线）→ 提示「发现 xx · 按 F 调查」，亮起标记；
    ///   调查：按交互键。有守军（<see cref="guard"/>，一般是 autoTrigger 关掉的小场地）且还没肃清 → 惊动守军开战，肃清后宝箱出现；
    ///         没有守军 / 守军已清 → 宝箱立刻从地里冒出来。奖励只给一次（<see cref="reward"/>，奖励串同宝箱）。
    /// 模型先用程序化体块（半埋的箱角 + 沙堆），物体下有名为 Model 的子物体时用美术资产。
    /// </summary>
    public sealed class CachePOI : MonoBehaviour, IInteractable
    {
        public static readonly Color Gold = new(1f, 0.85f, 0.51f);

        public string title = "支路物资";
        [Tooltip("奖励串（同宝箱：weapon[:id] / scroll / coins / heal / pet …）")]
        public string reward = "coins";
        [Tooltip("多近能发现（米，还要看得见）")]
        public float discoverRadius = 14f;
        [Tooltip("守军场地（可选）：调查时惊动，肃清后才出宝箱")]
        public EncounterSite guard;
        [Tooltip("发现时的提示（空 = 「按 F 调查」）")]
        public string hint = "";

        public bool Discovered { get; private set; }
        /// <summary>已经调查过（守军可能还在打）</summary>
        public bool Investigated { get; private set; }
        /// <summary>奖励宝箱已经出现</summary>
        public bool Claimed { get; private set; }
        /// <summary>出现的宝箱（测试用）</summary>
        public Chest RewardChest { get; private set; }

        public static event Action<CachePOI> AnyDiscovered, AnyClaimed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            AnyDiscovered = null;
            AnyClaimed = null;
        }

        const float CloseEnough = 2.5f, CheckEvery = 0.2f;
        float nextCheck;
        Transform glow, beam, model;

        void Start()
        {
            if (!PropBits.HasModel(transform)) BuildModel();
            var at = new GameObject("Glint").transform;
            at.SetParent(transform, false);
            at.localPosition = Vector3.up * 0.7f;
            glow = FxMaterials.GlowSprite(at, 0.9f, new Color(Gold.r, Gold.g, Gold.b, 0.18f));
            beam = FxMaterials.BeamSprite(transform, 0.7f, 5f, new Color(Gold.r, Gold.g, Gold.b, 0.3f));
            beam.gameObject.SetActive(false);
            Interaction.Add(this);
        }

        void OnDestroy()
        {
            Interaction.Remove(this);
            if (guard) guard.Cleared -= OnGuardCleared;
        }

        void BuildModel()
        {
            var root = new GameObject("Cache (placeholder)").transform;
            root.SetParent(transform, false);
            model = root;
            var sand = new Color(0.76f, 0.62f, 0.42f);
            var wood = new Color(0.36f, 0.2f, 0.12f);
            var bronze = new Color(0.78f, 0.58f, 0.28f);
            var mound = PropBits.Cylinder(root, "Mound", new Vector3(0, 0.05f, 0), new Vector3(2.2f, 0.3f, 1.8f), sand);
            mound.transform.localRotation = Quaternion.Euler(0, 25, 0);
            var corner = PropBits.Box(root, "Buried Crate", new Vector3(0.15f, 0.25f, 0), new Vector3(0.9f, 0.5f, 0.6f), wood);
            corner.transform.localRotation = Quaternion.Euler(12, 30, -18);
            PropBits.Box(corner.transform, "Band", new Vector3(0, 0, 0), new Vector3(1.04f, 1.04f, 0.12f), bronze);
        }

        void Update()
        {
            if (Discovered)
            {
                if (glow && !Claimed) glow.localScale = Vector3.one * (0.9f + 0.15f * Mathf.Sin(Time.time * 4f));
                return;
            }
            if (Time.time < nextCheck) return;
            nextCheck = Time.time + CheckEvery;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var eye = pv.transform.position + Vector3.up * 1.6f;
            if (CanSee(eye)) Discover();
        }

        /// <summary>从 eye 能发现它：在发现半径内、高差不大，并且看得见（贴得很近不看视线）</summary>
        public bool CanSee(Vector3 eye)
        {
            var d = Focus - eye;
            if (Mathf.Abs(d.y) > 6f) return false;
            float flat = new Vector2(d.x, d.z).magnitude;
            if (flat > discoverRadius) return false;
            return flat <= CloseEnough || !Combat.Blocked(eye, Focus, null);
        }

        void Discover()
        {
            if (Discovered) return;
            Discovered = true;
            if (glow) FxMaterials.Tint(glow.GetComponent<Renderer>(), new Color(Gold.r, Gold.g, Gold.b, 0.85f));
            if (beam) beam.gameObject.SetActive(true);
            GameUI.Toast(string.IsNullOrEmpty(hint) ? $"发现 {title} · 按 F 调查" : $"发现 {title} · {hint}", Gold);
            GameAudio.PlayAt("pickup_coin", Focus, 0.6f, 0.8f);
            AnyDiscovered?.Invoke(this);
        }

        bool GuardPending => guard && guard.phase != EncounterSite.Phase.Cleared;

        void OnGuardCleared(EncounterSite s)
        {
            if (guard) guard.Cleared -= OnGuardCleared;
            GiveReward();
        }

        void GiveReward()
        {
            if (Claimed) return;
            Claimed = true;
            if (beam) beam.gameObject.SetActive(false);
            if (glow) glow.gameObject.SetActive(false);
            if (model) model.gameObject.SetActive(false); // 占位的半埋箱角换成真宝箱
            var pv = PlayerVitals.Instance;
            var face = pv ? pv.transform.position : transform.position + transform.forward;
            if (!string.IsNullOrEmpty(reward) && reward != "none")
            {
                RewardChest = Chest.Spawn(transform.position, reward, face, ChestTier.Normal);
                if (RewardChest && gameObject.scene.IsValid() && RewardChest.gameObject.scene != gameObject.scene)
                    SceneManager.MoveGameObjectToScene(RewardChest.gameObject, gameObject.scene);
            }
            GameUI.Toast($"{title} · 物资已出现", Gold);
            AnyClaimed?.Invoke(this);
        }

        // ── IInteractable ──
        public Vector3 Focus => transform.position + Vector3.up * 0.6f;
        public float Radius => 3f;
        public bool CanInteract => Discovered && !Investigated;
        public string Prompt => $"调查 · {title}";

        public InteractPrompt PromptCard => new()
        {
            title = title,
            subtitle = "调查",
            lines = new[] { guard && guard.phase == EncounterSite.Phase.Idle ? "看起来有人守着这里" : "翻开看看埋着什么" },
            color = Gold,
        };

        public void Interact()
        {
            if (Investigated) return;
            if (!Discovered) Discover();
            Investigated = true;
            ShotFx.Instance?.Impact(Focus, Vector3.up, false, 2f);
            if (GuardPending)
            {
                guard.Cleared += OnGuardCleared;
                if (guard.phase == EncounterSite.Phase.Idle) guard.Activate();
                GameUI.Toast($"有埋伏 · 击败守军后收取{title}", new Color(1f, 0.6f, 0.45f));
                return;
            }
            GiveReward();
        }

        void OnDrawGizmos()
        {
            Gizmos.color = Gold;
            Gizmos.DrawWireCube(transform.position + Vector3.up * 0.3f, new Vector3(1, 0.6f, 1));
            Gizmos.color = new Color(Gold.r, Gold.g, Gold.b, 0.25f);
            Gizmos.DrawWireSphere(transform.position, discoverRadius);
        }
    }
}
