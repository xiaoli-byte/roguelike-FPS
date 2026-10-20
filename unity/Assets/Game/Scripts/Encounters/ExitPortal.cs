using UnityEngine;
using UnityEngine.AI;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡出口（出口祭坛门洞里的传送门）：关卡目标（<see cref="LevelObjective"/>：必清场地任意顺序、N 选 M 灵火坛）完成前是熄灭的，
    /// 提示里带着目标进度；完成时传送门升起——光幕从地面长到门顶、光柱升起、地面一圈冲击波、镜头轻震，横幅「出口已开启 · 下一关」；
    /// 升起之后在门旁落一个清关宝箱（奖励读 RunPlan 本关的 clearReward，首领关是首领档）。
    /// 按 F 进入 → GameSession 结算本关，结算面板上再按 F 由 <see cref="SceneFlow"/> 进下一关。
    /// 下一关读 <see cref="RunPlan"/>（本关 = 会话当前关，旧式场景按场景路径查）；下一关场景还没生成时提示「制作中」，
    /// SceneFlow 带着本局进度再走一遍本关。<see cref="nextStage"/> 只是不在 RunPlan 里的关卡的兜底文字。
    /// 没有 LevelObjective 的旧场景照旧：<see cref="requires"/> 里的场地全部肃清后开启。
    /// 关卡没有出口祭坛模型时可以 <see cref="buildFrame"/>：自己立一座半埋在地里的石门框，开启时随传送门一起升起。
    /// </summary>
    public sealed class ExitPortal : MonoBehaviour, IInteractable
    {
        [Tooltip("关卡目标（空 = 本场景的 LevelObjective；场景里也没有就按 requires）")]
        public LevelObjective objective;
        [Tooltip("旧式：这些场地全部肃清后开启（没有 LevelObjective 的旧场景）")]
        public EncounterSite[] requires = System.Array.Empty<EncounterSite>();
        [Tooltip("不在 RunPlan 里的关卡：提示里的下一关名字（RunPlan 里的关卡自动读下一关，不用填）")]
        public string nextStage = "";
        public Vector2 doorSize = new(3.2f, 4.6f);
        [Tooltip("没有出口祭坛模型时自己立一座石门框（半埋在地里，开启时一起升起）")]
        public bool buildFrame;
        [Tooltip("升起动画时长（秒）")]
        public float riseTime = 2.2f;
        [Tooltip("清关宝箱奖励（空 = RunPlan 本关的 clearReward；none = 不落）")]
        public string clearReward = "";

        bool open, used, forced, rewarded, animate;
        Transform door, beam, frame;
        Renderer doorR;
        float openedAt;
        float frameDepth;
        string nextPrompt;
        static readonly Color Gate = new(0.55f, 0.85f, 1f);

        public bool IsOpen => open;
        /// <summary>升起动画已经播完</summary>
        public bool Risen => open && (!animate || Time.time - openedAt >= riseTime);
        /// <summary>升起进度 0–1</summary>
        public float Rise => !open ? 0 : !animate || riseTime <= 0 ? 1 : Mathf.Clamp01((Time.time - openedAt) / riseTime);
        /// <summary>落下的清关宝箱（没有为 null）</summary>
        public Chest ClearChest { get; private set; }

        void Start()
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.name = "Portal Door";
            door = q.transform;
            door.SetParent(transform, false);
            door.localPosition = Vector3.zero;
            door.localScale = new Vector3(doorSize.x, 0.001f, 1);
            doorR = q.GetComponent<Renderer>();
            doorR.sharedMaterial = FxMaterials.Glow;
            FxMaterials.Tint(doorR, new Color(Gate.r, Gate.g, Gate.b, 0.08f));
            q.SetActive(false);
            beam = FxMaterials.BeamSprite(transform, 2.2f, 14f, new Color(Gate.r, Gate.g, Gate.b, 0.3f));
            beam.gameObject.SetActive(false);
            if (buildFrame) BuildFrame();
            Interaction.Add(this);
            if (!objective) objective = LevelObjective.For(gameObject.scene);
            if (objective) objective.Completed += OnObjectiveCompleted;
            else EncounterSite.AnySiteCleared += OnSiteCleared;
            Check();
        }

        void OnDestroy()
        {
            Interaction.Remove(this);
            EncounterSite.AnySiteCleared -= OnSiteCleared;
            if (objective) objective.Completed -= OnObjectiveCompleted;
        }

        /// <summary>半埋的石门框：两根门柱 + 门楣，关着时只有门楣和柱头露出地面</summary>
        void BuildFrame()
        {
            frame = new GameObject("Gate Frame").transform;
            frame.SetParent(transform, false);
            var stone = new Color(0.55f, 0.5f, 0.45f);
            var trim = new Color(0.36f, 0.62f, 0.7f);
            float w = doorSize.x, h = doorSize.y;
            foreach (int side in new[] { -1, 1 })
            {
                PropBits.Box(frame, side < 0 ? "Post L" : "Post R", new Vector3(side * (w * 0.5f + 0.4f), (h + 0.6f) * 0.5f, 0), new Vector3(0.8f, h + 0.6f, 0.9f), stone, true);
                PropBits.Box(frame, side < 0 ? "Inlay L" : "Inlay R", new Vector3(side * (w * 0.5f + 0.02f), h * 0.5f, 0), new Vector3(0.06f, h * 0.9f, 0.5f), trim);
            }
            PropBits.Box(frame, "Lintel", new Vector3(0, h + 0.9f, 0), new Vector3(w + 2.2f, 0.7f, 1.1f), stone, true);
            frameDepth = h * 0.85f;
            frame.localPosition = Vector3.down * frameDepth;
        }

        void OnSiteCleared(EncounterSite s) => Check();

        void OnObjectiveCompleted(LevelObjective o) => Check();

        /// <summary>旧式：requires 全部肃清</summary>
        bool LegacyReady()
        {
            if (requires == null) return true;
            foreach (var s in requires)
                if (s && s.phase != EncounterSite.Phase.Cleared) return false;
            return true;
        }

        bool HasGoals => objective ? objective.RequiredTotal > 0 || objective.AltarsNeeded > 0 : requires != null && requires.Length > 0;

        void Check()
        {
            if (open || !door) return;
            if (!forced && !(objective ? objective.Complete : LegacyReady())) return;
            open = true;
            openedAt = Time.time;
            // 开局就开着的出口（没有目标）直接立好，不演升起、不落清关宝箱
            animate = forced || HasGoals;
            door.gameObject.SetActive(true);
            beam.gameObject.SetActive(true);
            if (!animate)
            {
                rewarded = true;
                return;
            }
            Telegraph.Wave(transform.position, 7f, 9f, Gate);
            CameraShake.Quake(transform.position, 0.3f, 40f, 0.8f);
            GameAudio.PlayAt("portal", Focus, 0.8f, 0.7f);
            if (forced) return;
            var next = RunPlan.Next(Stage);
            GameUI.Banner("出口已开启", next != null ? $"下一关 · {next.Label}" : string.IsNullOrEmpty(nextStage) ? null : $"下一关 · {nextStage}");
            GameUI.SetObjective("前往出口祭坛");
        }

        void Update()
        {
            if (!open || !doorR) return;
            float e = Mathf.SmoothStep(0, 1, Rise);
            float pulse = 0.85f + 0.15f * Mathf.Sin(Time.time * 3.1f);
            FxMaterials.Tint(doorR, new Color(Gate.r, Gate.g, Gate.b, Mathf.Lerp(0.08f, 0.9f, e) * pulse));
            float h = Mathf.Max(0.001f, doorSize.y * e);
            door.localScale = new Vector3(doorSize.x * (0.96f + 0.04f * pulse), h, 1);
            door.localPosition = Vector3.up * h * 0.5f;
            beam.localScale = new Vector3(1, Mathf.Max(0.01f, e), 1);
            if (frame) frame.localPosition = Vector3.down * frameDepth * (1 - e);
            if (e < 1)
            {
                // 升起时门脚扬尘
                if (Random.value < Time.deltaTime * 14)
                    ShotFx.Instance?.Impact(transform.position + transform.right * Random.Range(-doorSize.x * 0.7f, doorSize.x * 0.7f) + Vector3.up * 0.2f, Vector3.up, false, 1.4f);
            }
            else
            {
                if (!rewarded)
                {
                    rewarded = true;
                    SpawnClearChest();
                }
                if (Random.value < Time.deltaTime * 8)
                    ShotFx.Instance?.Impact(door.position + transform.right * Random.Range(-1f, 1f) + Vector3.up * Random.Range(-2f, 2f), Vector3.up, false, 0.6f);
            }
        }

        /// <summary>清关宝箱：门的一侧、靠玩家来的那面（离门正前方的进门站位够远，交互不会抢门的提示）</summary>
        void SpawnClearChest()
        {
            if (forced || used) return;
            var stage = Stage;
            string r = !string.IsNullOrEmpty(clearReward) ? clearReward : stage?.clearReward;
            if (string.IsNullOrEmpty(r) || r == "none") return;
            var front = -transform.forward;
            front.y = 0;
            front = front.sqrMagnitude > 1e-4f ? front.normalized : Vector3.back;
            var right = Vector3.Cross(Vector3.up, front);
            Vector3 at = transform.position + front * 2.5f + right * 4.5f;
            bool found = false;
            foreach (float side in new[] { 1f, -1f })
            {
                foreach (float fwd in new[] { 2.5f, 4f, 1f })
                {
                    var p = transform.position + front * fwd + right * (4.5f * side);
                    if (!NavMesh.SamplePosition(p, out var hit, 2f, NavMesh.AllAreas)) continue;
                    if (!SpawnStations.BodyClear(hit.position, 0.8f, 1.2f)) continue;
                    at = hit.position;
                    found = true;
                    break;
                }
                if (found) break;
            }
            var tier = stage != null && stage.IsBoss ? ChestTier.Boss : ChestTier.Normal;
            ClearChest = Chest.Spawn(at, r, transform.position + front * 8f, tier);
            if (ClearChest && gameObject.scene.IsValid() && ClearChest.gameObject.scene != gameObject.scene)
                SceneManager.MoveGameObjectToScene(ClearChest.gameObject, gameObject.scene);
            GameUI.Toast("清关奖励 · 宝箱出现在出口旁", new Color(1f, 0.85f, 0.51f));
        }

        // ── IInteractable ──
        public Vector3 Focus => transform.position + Vector3.up * doorSize.y * 0.5f;
        public float Radius => 4.5f;
        public bool CanInteract => !used;

        public string Prompt
        {
            get
            {
                if (open) return NextPrompt;
                if (objective)
                {
                    var d = objective.Describe();
                    return string.IsNullOrEmpty(d) ? "出口未开启" : $"出口未开启 · {d}";
                }
                return "出口未开启 · 先肃清全部区域";
            }
        }

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

        /// <summary>调试 / 冒烟测试：不等关卡目标，直接开启（演升起，不落清关宝箱）</summary>
        public void ForceOpen()
        {
            forced = true;
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
