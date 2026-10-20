using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡出口（出口祭坛门洞里的传送门）：requires 里的场地全部肃清前是熄灭的（提示「肃清全部区域后开启」），
    /// 开启时亮起门面光幕 + 光柱、横幅提示；按 F 进入 → GameSession 结算本关，结算面板上再按 F 由 <see cref="SceneFlow"/> 进下一关。
    /// 下一关读 <see cref="RunPlan"/>（本关 = 会话当前关，旧式场景按场景路径查）；下一关场景还没生成时提示「制作中」，
    /// SceneFlow 带着本局进度再走一遍本关。<see cref="nextStage"/> 只是不在 RunPlan 里的关卡的兜底文字。
    /// </summary>
    public sealed class ExitPortal : MonoBehaviour, IInteractable
    {
        public EncounterSite[] requires = System.Array.Empty<EncounterSite>();
        [Tooltip("不在 RunPlan 里的关卡：提示里的下一关名字（RunPlan 里的关卡自动读下一关，不用填）")]
        public string nextStage = "";
        public Vector2 doorSize = new(3.2f, 4.6f);

        bool open, used;
        Transform door, beam;
        Renderer doorR;
        float openedAt;
        string nextPrompt;
        static readonly Color Gate = new(0.55f, 0.85f, 1f);

        public bool IsOpen => open;

        void Start()
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.name = "Portal Door";
            door = q.transform;
            door.SetParent(transform, false);
            door.localPosition = Vector3.up * doorSize.y * 0.5f;
            door.localScale = new Vector3(doorSize.x, doorSize.y, 1);
            doorR = q.GetComponent<Renderer>();
            doorR.sharedMaterial = FxMaterials.Glow;
            FxMaterials.Tint(doorR, new Color(Gate.r, Gate.g, Gate.b, 0.08f));
            beam = FxMaterials.BeamSprite(transform, 2.2f, 14f, new Color(Gate.r, Gate.g, Gate.b, 0.3f));
            beam.gameObject.SetActive(false);
            Interaction.Add(this);
            EncounterSite.AnySiteCleared += OnSiteCleared;
            Check();
        }

        void OnDestroy()
        {
            Interaction.Remove(this);
            EncounterSite.AnySiteCleared -= OnSiteCleared;
        }

        void OnSiteCleared(EncounterSite s) => Check();

        void Check()
        {
            if (open || !beam) return;
            foreach (var s in requires)
                if (s && s.phase != EncounterSite.Phase.Cleared) return;
            open = true;
            openedAt = Time.time;
            beam.gameObject.SetActive(true);
            if (requires.Length > 0)
            {
                GameUI.Banner("出口已开启");
                GameUI.SetObjective("前往出口祭坛");
            }
        }

        void Update()
        {
            if (!open || !doorR) return;
            float k = Mathf.Clamp01((Time.time - openedAt) / 1.2f);
            float pulse = 0.85f + 0.15f * Mathf.Sin(Time.time * 3.1f);
            FxMaterials.Tint(doorR, new Color(Gate.r, Gate.g, Gate.b, Mathf.Lerp(0.08f, 0.9f, k) * pulse));
            door.localScale = new Vector3(doorSize.x * (0.96f + 0.04f * pulse), doorSize.y, 1);
            if (Random.value < Time.deltaTime * 8)
                ShotFx.Instance?.Impact(door.position + new Vector3(Random.Range(-1f, 1f), Random.Range(-2f, 2f), 0), Vector3.up, false, 0.6f);
        }

        // ── IInteractable ──
        public Vector3 Focus => door ? door.position : transform.position + Vector3.up * 2;
        public float Radius => 4.5f;
        public bool CanInteract => !used;
        public string Prompt => open ? NextPrompt : "出口未开启 · 先肃清全部区域";

        /// <summary>本关（会话当前关；旧式场景按场景路径查 RunPlan）</summary>
        StageSpec Stage => GameSession.Instance && GameSession.Instance.Stage != null ? GameSession.Instance.Stage : RunPlan.ForScene(gameObject.scene.path);

        /// <summary>开启后的提示（下一关读 RunPlan，算一次缓存：本关在出口存在期间不会变）</summary>
        string NextPrompt
        {
            get
            {
                if (nextPrompt != null) return nextPrompt;
                var stage = Stage;
                var next = RunPlan.Next(stage);
                if (stage != null && RunPlan.IsFinal(stage)) nextPrompt = "完成本关 · 全部关卡完成";
                else if (next == null) nextPrompt = string.IsNullOrEmpty(nextStage) ? "完成本关" : $"进入下一关 · {nextStage}";
                else nextPrompt = SceneFlow.CanLoad(next) ? $"进入下一关 · {next.Label}" : $"完成本关 · 下一关 {next.Label} 制作中";
                return nextPrompt;
            }
        }

        /// <summary>调试 / 冒烟测试：不等场地肃清，直接开启</summary>
        public void ForceOpen()
        {
            requires = System.Array.Empty<EncounterSite>();
            Check();
        }

        public void Interact()
        {
            if (!open || used) return;
            used = true;
            ShotFx.Instance?.Impact(Focus, Vector3.up, false, 8f);
            GameAudio.Play("portal");
            var next = RunPlan.Next(Stage);
            GameSession.Instance?.CompleteStage(next != null ? next.Label : nextStage);
        }
    }
}
