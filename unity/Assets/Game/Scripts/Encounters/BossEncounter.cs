using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领关流程（docs/unity-parity.md 3.9「首领关流程：补给营、门槛触发、登场、溃散、结算、拴绳 → BossEncounter + SafeZone」，B2；
    /// Three.js StageDirector 的 boss 分支 + tests/boss-supply.test.mjs）。挂在首领场里（关卡构建器放，或测试运行时挂），一场首领战一个：
    ///   等待：玩家在补给营（<see cref="SafeZone"/>）里随便逛多久都不会开打；暂停 / 模态时不触发。
    ///   门槛：玩家走进首领场地（<see cref="BossArena"/> 往里 <see cref="thresholdInset"/> 米，或指定的 <see cref="threshold"/> 触发体）、不在安全区里 → 开战（每关只一次）。
    ///   封门（可选）：<see cref="gates"/> 从地下升起（0.8 s），首领倒下结算后落回去。
    ///   登场预警：首领出生点亮 <see cref="warnSeconds"/> 秒的圆形预警 + 震屏 + 提示「……」，切 boss 配乐，然后生成首领（<see cref="Bosses.Spawn(string, BossArena, float, Transform)"/>，
    ///     名字卡由首领自己的登场横幅打——定义关掉横幅时这里补一张「首领名 / 称号」），目标栏「击败 首领名」。
    ///     有登场演出（<see cref="BossIntroDirector"/>，docs/level-design/boss-intros.md）时由演出接管镜头：不画预警圈、不弹提示，演出到生成时刻再刷首领，名字卡由演出打。
    ///   拴绳：首领被打 / 推 / 冲出场地 <see cref="tetherSlack"/> 米以上、掉到场地地面 8 m 以下、或位置非法 → 拉回首领出生点（场地内的走位由 BossBrain 自己夹）。
    ///   溃散：首领倒下（<see cref="GameEvents.BossDefeated"/>，溃散演出由 BossDefeatSequence 播）→ 1.2 s 时场上残余的敌人一起溃散（静默处决、不掉落），
    ///   结算（2.6 s，溃散演出最后一下大爆炸前后）：回满生命与护盾、本关魂晶（<see cref="EconomyConfig.EssencePerStage"/>）、保底武器宝箱（首领档：第一章史诗起、第二章起传说，
    ///     <see cref="EconomyConfig.ApplyTier"/>）、横幅「区域肃清 · 首领伏诛 · 生命已完全恢复」；
    ///   然后：最后一关 → 胜利链（横幅「灵火破晓 · 深渊已平 · 凯旋而归」、无敌 5 s，4 s 后 <see cref="GameSession.CompleteStage"/> 结算整局）；
    ///         否则 → 出口升起（关卡里的 <see cref="ExitPortal"/>，没有就在场地远端立一座），进门后由 <see cref="SceneFlow"/> 进下一关（换章时是章节卡）。
    ///   打完再回补给营、再进场地不会再开一场（同 TS：cannot repeat after returning to shop）；本局记一个标记，重来本关会从进关快照恢复。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BossEncounter : MonoBehaviour
    {
        public enum Phase { Waiting, Warning, Fighting, Collapsing, Settled }

        /// <summary>结算之后去哪：最后一关 → 胜利；否则 → 出口（下一关 / 下一章）</summary>
        public enum Outcome { NextStage, Victory }

        /// <summary>首领倒下后多久残余敌人溃散、多久结算（秒，同 TS BOSS_CLEANUP_DELAY / BOSS_CLEAR_HOLD）；结算后多久开出口；胜利横幅停留</summary>
        public const float CleanupDelay = 1.2f, SettleDelay = 2.6f, PortalDelay = 1.4f, VictoryDelay = 4f;

        [Tooltip("首领（BossDef.id）")] public string bossId = ProxyBossDef.Id;
        [Tooltip("首领场地（空 = 按 bossId 找场景里的 BossArena）")] public BossArena arena;
        [Tooltip("难度（≤ 0 = 本局当前关的难度）")] public float difficulty;
        [Header("门槛")]
        [Tooltip("触发体（空 = 走进场地边界往里 thresholdInset 米）")] public Collider threshold;
        public float thresholdInset = 2f;
        [Header("封门")]
        [Tooltip("开战时从地下升起、结算后落回去的门（可以空）")] public GameObject[] gates = Array.Empty<GameObject>();
        public float gateRise = 0.8f;
        [Header("登场")]
        public float warnSeconds = 2.5f;
        [TextArea] public string warnText = "大地震颤——首领即将现身！";
        [Header("拴绳")]
        [Tooltip("出场地多远就拉回（米）")] public float tetherSlack = 8f;
        [Header("结算")]
        [Tooltip("宝箱落点（空 = 场地中心）")] public Transform rewardPoint;
        [Tooltip("出口（空 = 场景里的 ExitPortal；再没有就在场地远端立一座）")] public ExitPortal exit;
        [Tooltip("没有出口时立在这里（空 = 场地远端）")] public Transform exitPoint;

        static readonly List<EnemyAI> buffer = new();

        float phaseAt, gateT = 1f;
        bool gatesUp, cleaned, essenceGiven;
        Vector3[] gateRest;
        TelegraphHandle warn;
        /// <summary>登场演出（docs/level-design/boss-intros.md）：有的话由它决定何时刷首领，预警圈 / 提示不画</summary>
        BossIntroDirector intro;

        /// <summary>这一场的登场演出（没有 / 已结束为 null）</summary>
        public BossIntroDirector Intro => intro ? intro : null;

        public Phase State { get; private set; }
        public BossBrain Boss { get; private set; }
        public BossDef Def => Bosses.Get(bossId);
        public Chest RewardChest { get; private set; }
        public ExitPortal OpenedExit { get; private set; }
        /// <summary>把首领拉回场地的次数</summary>
        public int Tethers { get; private set; }
        /// <summary>溃散时处决的残余敌人数</summary>
        public int Dispersed { get; private set; }
        public Outcome Result { get; private set; }

        public event Action<BossEncounter> Started, Spawned, Defeated, Settled;

        /// <summary>本局「这一关的首领已经打过」的标记 key</summary>
        public string ClearedFlag => $"boss_cleared:{RunState.Current?.stageCode ?? SceneManager.GetActiveScene().name}:{bossId}";

        void Start()
        {
            if (!arena) arena = BossArena.Find(bossId, transform.position);
            EnsureGateRest();
            foreach (var g in gates ?? Array.Empty<GameObject>())
                if (g && !gatesUp)
                    g.SetActive(false);
            if (RunState.Current != null && RunState.Current.Flag(ClearedFlag) > 0) State = Phase.Settled;
        }

        void OnEnable() => GameEvents.BossDefeated += OnBossDefeated;
        void OnDisable() => GameEvents.BossDefeated -= OnBossDefeated;

        // ───────────── 门槛 ─────────────

        /// <summary>玩家在不在门槛里（场地内往里 inset 米、上下 6 m；或在触发体里），且不在安全区</summary>
        public bool PlayerAtThreshold(Vector3 feet)
        {
            if (SafeZone.Contains(feet)) return false;
            if (threshold) return threshold.bounds.Contains(feet + Vector3.up * 0.5f);
            return arena && arena.Contains(feet, thresholdInset) && Mathf.Abs(feet.y - arena.FloorY) < 6f;
        }

        void Update()
        {
            float now = Time.time;
            StepGates(Time.deltaTime);
            switch (State)
            {
                case Phase.Waiting:
                {
                    var pv = PlayerVitals.Instance;
                    if (!pv || pv.Dead || !GameStateMachine.IsPlaying) return;
                    if (PlayerAtThreshold(pv.transform.position)) Begin();
                    break;
                }
                case Phase.Warning:
                    // 有登场演出时按演出的生成时刻；演出没了（被打断）退回预警计时
                    if (intro ? intro.SpawnDue : now - phaseAt >= warnSeconds) SpawnBoss();
                    break;
                case Phase.Fighting:
                    Tether();
                    break;
                case Phase.Collapsing:
                    if (!cleaned && now - phaseAt >= CleanupDelay) Disperse();
                    if (now - phaseAt >= SettleDelay) Settle();
                    break;
            }
        }

        /// <summary>开战（门槛触发；测试 / 剧本可以直接调）。只在等待中有效</summary>
        public void Begin()
        {
            if (State != Phase.Waiting) return;
            var def = Def;
            if (def == null)
            {
                Debug.LogWarning($"[BossEncounter] 没有登记首领 {bossId}");
                enabled = false;
                return;
            }
            State = Phase.Warning;
            phaseAt = Time.time;
            SealGates(true);
            var at = arena ? arena.BossSpawnPoint : transform.position;
            // 登场演出接管镜头（测试开关关着 / 没有玩家镜头时为 null，照旧预警）：演出里不画预警圈、不弹提示
            intro = BossIntroDirector.Play(this);
            if (!intro) warn = Telegraph.Circle(at, Mathf.Max(3f, def.radius * 3f), Mathf.Max(0.2f, warnSeconds), def.WarnColor);
            CameraShake.Quake(at, 0.35f, 80f, Mathf.Max(0.6f, warnSeconds * 0.8f));
            GameAudio.PlayAt("boss_roar", at + Vector3.up * 2f, 0.6f, 0.7f);
            GameAudio.SetMusic("boss");
            if (!intro && !string.IsNullOrEmpty(warnText)) GameUI.Toast(warnText, def.color, Mathf.Max(2f, warnSeconds));
            Raise(Started);
            if (!intro && warnSeconds <= 0) SpawnBoss();
        }

        void SpawnBoss()
        {
            var def = Def;
            warn.End();
            Boss = Bosses.Spawn(bossId, arena, difficulty, transform.parent);
            if (!Boss)
            {
                Debug.LogWarning($"[BossEncounter] 首领 {bossId} 生成失败，直接结算");
                State = Phase.Collapsing;
                phaseAt = Time.time - SettleDelay;
                return;
            }
            State = Phase.Fighting;
            phaseAt = Time.time;
            if (def != null && !def.intro.banner && !intro) GameUI.Banner(def.name, def.title ?? "首领", 3f);
            if (def != null) GameUI.SetObjective($"击败 {def.name}");
            Raise(Spawned);
        }

        // ───────────── 拴绳 ─────────────

        /// <summary>首领要不要被拉回：位置非法、掉到场地地面 8 m 以下、或水平方向出场地 slack 米以上</summary>
        public static bool NeedsTether(BossArena arena, Vector3 p, float slack)
        {
            if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)) return true;
            if (!arena) return false;
            if (p.y < arena.FloorY - 8f) return true;
            return !arena.Contains(p, -Mathf.Max(0, slack));
        }

        void Tether()
        {
            if (!Boss || Boss.Dead || !arena) return;
            if (!NeedsTether(arena, Boss.transform.position, tetherSlack)) return;
            var target = arena.BossSpawnPoint;
            if (NavMesh.SamplePosition(target, out var hit, 4f, NavMesh.AllAreas)) target = hit.position;
            Boss.AbortMove();
            Boss.EndDash();
            var agent = Boss.GetComponent<NavMeshAgent>();
            Boss.transform.position = target;
            if (agent && agent.enabled && agent.isOnNavMesh) agent.Warp(target);
            var loco = Boss.GetComponentInChildren<CreatureLocomotion>();
            if (loco) loco.Teleported();
            Tethers++;
            Fx.Burst(target + Vector3.up, Def?.color ?? Color.white, 24, 6f, 0.7f, 0.2f, 2f);
        }

        // ───────────── 倒下 → 溃散 → 结算 ─────────────

        void OnBossDefeated(BossBrain b)
        {
            if (!b || b != Boss || State != Phase.Fighting) return;
            State = Phase.Collapsing;
            phaseAt = Time.time;
            cleaned = false;
            // 最后一关：胜利已定，不再因残留的弹幕 / 危险区判负
            if (Decide(CurrentStage) == Outcome.Victory) Protect(SettleDelay + VictoryDelay + 1f);
            Raise(Defeated);
        }

        /// <summary>残余敌人（爪牙、场地里的杂兵）一起溃散：静默处决、不掉落</summary>
        void Disperse()
        {
            cleaned = true;
            buffer.Clear();
            var c = arena ? arena.Center : transform.position;
            float r = (arena ? arena.Extent : 30f) + 15f;
            EnemyRegistry.InRadius(c, r, buffer);
            foreach (var e in buffer)
            {
                if (!e || e.Dead || !e.Health) continue;
                e.Health.noReward = true;
                Combat.Execute(e.Health, true);
                Dispersed++;
            }
            buffer.Clear();
        }

        /// <summary>结算（只一次）：回满、魂晶、保底武器宝箱、横幅，然后胜利链或出口</summary>
        void Settle()
        {
            if (State == Phase.Settled) return;
            if (!cleaned) Disperse();
            State = Phase.Settled;
            var def = Def;
            var run = RunState.Ensure();
            run.SetFlag(ClearedFlag, 1);
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead && (def?.rewards?.healPlayer ?? true))
            {
                pv.Heal(pv.MaxHealth);
                pv.AddShield(pv.MaxShield);
            }
            if (!essenceGiven)
            {
                essenceGiven = true;
                run.CreditEssence(EconomyConfig.EssencePerStage, "boss_clear");
            }
            SpawnChest(def);
            SealGates(false);
            GameUI.SetObjective("");
            GameAudio.SetMusic("calm");
            Result = Decide(CurrentStage);
            if (Result == Outcome.Victory)
            {
                GameUI.Banner("灵火破晓", "深渊已平 · 凯旋而归", VictoryDelay);
                Protect(VictoryDelay + 1f);
                Invoke(nameof(FinishRun), VictoryDelay);
            }
            else
            {
                GameUI.Banner("区域肃清", "首领伏诛 · 生命已完全恢复", 2.8f);
                Invoke(nameof(OpenExit), PortalDelay);
            }
            Raise(Settled);
        }

        /// <summary>这一关打完首领之后：最后一关 → 胜利，否则 → 出口（纯函数）</summary>
        public static Outcome Decide(StageSpec stage) => stage != null && RunPlan.IsFinal(stage) ? Outcome.Victory : Outcome.NextStage;

        StageSpec CurrentStage => GameSession.Instance && GameSession.Instance.Stage != null ? GameSession.Instance.Stage : RunPlan.ForScene(gameObject.scene.path);

        void Protect(float seconds)
        {
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead) pv.invulnerableUntil = Mathf.Max(pv.invulnerableUntil, Time.time + seconds);
        }

        void SpawnChest(BossDef def)
        {
            var rewards = def?.rewards ?? new BossRewards();
            if (string.IsNullOrEmpty(rewards.chest) || rewards.chest == "none") return;
            var p = rewardPoint ? rewardPoint.position : arena ? arena.Center : transform.position;
            if (NavMesh.SamplePosition(p, out var hit, 6f, NavMesh.AllAreas)) p = hit.position;
            var pv = PlayerVitals.Instance;
            var face = pv ? pv.transform.position : p + Vector3.back;
            RewardChest = Chest.Spawn(p, rewards.chest, face, rewards.chestTier);
            if (RewardChest && gameObject.scene.IsValid() && RewardChest.gameObject.scene != gameObject.scene)
                SceneManager.MoveGameObjectToScene(RewardChest.gameObject, gameObject.scene);
            GameUI.Toast($"首领宝箱 · {Chest.Line(RewardChest ? RewardChest.EffectiveReward : rewards.chest)}", Hex.Rgb(0xffd98a));
        }

        void OpenExit()
        {
            var e = exit ? exit : FindAnyObjectByType<ExitPortal>();
            if (!e)
            {
                var at = ExitSpot();
                var go = new GameObject("Exit Portal (boss)");
                if (gameObject.scene.IsValid()) SceneManager.MoveGameObjectToScene(go, gameObject.scene);
                go.transform.position = at;
                var toCenter = (arena ? arena.Center : transform.position) - at;
                toCenter.y = 0;
                go.transform.rotation = toCenter.sqrMagnitude > 1e-3f ? Quaternion.LookRotation(-toCenter) : Quaternion.identity;
                e = go.AddComponent<ExitPortal>();
                e.buildFrame = true;
                e.clearReward = "none";
            }
            // 首领关的清关宝箱已经由这里落过：出口只升起，不再落一个（ForceOpen 不落清关宝箱）
            e.ForceOpen();
            OpenedExit = e;
            var next = RunPlan.Next(CurrentStage);
            GameUI.Banner("出口已开启", next != null ? $"下一关 · {next.Label}" : null, 2.4f);
            GameUI.SetObjective("前往出口");
        }

        /// <summary>立出口的位置：指定点 → 场地远端（首领出生点那一侧、离边界 3 m），贴到导航网格</summary>
        Vector3 ExitSpot()
        {
            if (exitPoint) return exitPoint.position;
            if (!arena) return transform.position + transform.forward * 8f;
            var dir = arena.BossSpawnPoint - arena.PlayerEntryPoint;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-3f ? dir.normalized : arena.transform.forward;
            var p = arena.Center + dir * Mathf.Max(3f, arena.Extent - 3f);
            p.y = arena.FloorY;
            return NavMesh.SamplePosition(p, out var hit, 6f, NavMesh.AllAreas) ? hit.position : p;
        }

        void FinishRun()
        {
            var s = GameSession.Instance;
            if (s && !s.Completed) s.CompleteStage();
        }

        // ───────────── 门 ─────────────

        /// <summary>记下每扇门立起来时的本地位置（门在 Start 之后才赋值也行）</summary>
        void EnsureGateRest()
        {
            int n = gates?.Length ?? 0;
            if (gateRest != null && gateRest.Length == n) return;
            gateRest = new Vector3[n];
            for (int i = 0; i < n; i++)
                if (gates[i])
                    gateRest[i] = gates[i].transform.localPosition;
        }

        void SealGates(bool up)
        {
            if (gates == null || gates.Length == 0 || gatesUp == up) return;
            EnsureGateRest();
            gatesUp = up;
            gateT = 0;
            foreach (var g in gates)
                if (g)
                    g.SetActive(true);
            StepGates(0);
            if (up) GameAudio.PlayAt("boss_slam", transform.position, 0.5f, 0.6f);
        }

        void StepGates(float dt)
        {
            if (gates == null || gates.Length == 0 || gateT >= 1f) return;
            EnsureGateRest();
            gateT = Mathf.Min(1f, gateT + dt / Mathf.Max(0.05f, gateRise));
            float k = gatesUp ? gateT : 1f - gateT;
            for (int i = 0; i < gates.Length; i++)
            {
                var g = gates[i];
                if (!g) continue;
                float h = GateHeight(g);
                g.transform.localPosition = gateRest[i] + Vector3.down * h * (1f - Mathf.SmoothStep(0, 1, k));
                if (!gatesUp && gateT >= 1f) g.SetActive(false);
            }
        }

        static float GateHeight(GameObject g)
        {
            var r = g.GetComponentInChildren<Renderer>();
            return r ? Mathf.Max(1f, r.bounds.size.y) : 4f;
        }

        /// <summary>门都立着（测试用）</summary>
        public bool GatesSealed => gatesUp;

        void Raise(Action<BossEncounter> ev)
        {
            if (ev == null) return;
            try
            {
                ev(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void OnDrawGizmos()
        {
            if (!arena) return;
            Gizmos.color = new Color(1f, 0.3f, 0.2f, 0.8f);
            Gizmos.DrawWireSphere(arena.BossSpawnPoint, 1.5f);
        }
    }
}
