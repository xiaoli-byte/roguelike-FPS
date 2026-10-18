using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡出口（出口祭坛门洞里的传送门）：requires 里的场地全部肃清前是熄灭的（提示「肃清全部区域后开启」），
    /// 开启时亮起门面光幕 + 光柱、横幅提示；按 F 进入 → GameSession 结算本关。
    /// </summary>
    public sealed class ExitPortal : MonoBehaviour, IInteractable
    {
        public EncounterSite[] requires = System.Array.Empty<EncounterSite>();
        public string nextStage = "1-2 · 雅丹迷城";
        public Vector2 doorSize = new(3.2f, 4.6f);

        bool open, used;
        Transform door, beam;
        Renderer doorR;
        float openedAt;
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
            if (open) return;
            foreach (var s in requires)
                if (s && s.phase != EncounterSite.Phase.Cleared) return;
            open = true;
            openedAt = Time.time;
            beam.gameObject.SetActive(true);
            if (requires.Length > 0)
            {
                Hud.Instance?.Banner("出口已开启");
                Hud.Instance?.SetObjective("前往出口祭坛");
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
        public string Prompt => open ? $"进入下一关 · {nextStage}" : "出口未开启 · 先肃清全部区域";

        public void Interact()
        {
            if (!open || used) return;
            used = true;
            ShotFx.Instance?.Impact(Focus, Vector3.up, false, 8f);
            GameSession.Instance?.CompleteStage(nextStage);
        }
    }
}
