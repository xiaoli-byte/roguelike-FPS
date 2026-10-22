using System;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 3-3 铸范大坊的终点：神范台上的熔心魔将领主战（docs/level-design/maps/3-3.md 第 6 节，D5）。
    /// 领主战本身是 B2 的 <see cref="BossEncounter"/>（门槛触发、熔铁闸封桥、名字卡、溃散、结算、出口）；这里只管「什么时候能打」和清关宝箱：
    ///   · 关卡目标（四处必清场地）完成之前，首领关流程停用（BossEncounter 的组件关着，走进神范台不会开打），
    ///     玩家提前踏上神范台时每 6 s 提示一次「先肃清铸坊」；
    ///   · 目标完成 → 启用首领关流程，横幅「神范台 · 熔心魔将苏醒」，目标栏写「前往神范台 · 击败熔心魔将」；
    ///   · 领主战结算后（首领宝箱、回满、出口由 BossEncounter 落）→ 在神范前再落本关的清关宝箱（RunPlan 3-3 的 clearReward）——
    ///     BossEncounter 立出口用的是 ForceOpen，不落清关宝箱；3-3 是开放图，不是章末首领关，清关奖励照常给。
    /// 场景里不放 ExitPortal：出口由 BossEncounter 结算后在神范里立（同 1-4）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FoundryLordGate : MonoBehaviour
    {
        [Tooltip("关卡目标（空 = 本场景的 LevelObjective）")]
        public LevelObjective objective;
        [Tooltip("神范台的领主战（目标完成前关着）")]
        public BossEncounter encounter;
        [Tooltip("清关宝箱落点（空 = 首领宝箱落点旁 3 m）")]
        public Transform clearChestPoint;
        [TextArea] public string lockedHint = "熔心魔将还在神范里沉睡——先肃清铸坊（肃清据点后它才会醒来）";
        public string wakeTitle = "神范台", wakeSub = "熔心魔将苏醒 · 守范之主在等你";

        /// <summary>首领关流程已启用</summary>
        public bool Unlocked { get; private set; }
        /// <summary>领主战结算后落的清关宝箱（没有为 null）</summary>
        public Chest ClearChest { get; private set; }
        /// <summary>提前踏上神范台被提示的次数</summary>
        public int LockedHints { get; private set; }

        public event Action<FoundryLordGate> Unlocking;

        float hintAt;

        void Awake()
        {
            // 目标完成前首领关流程停用（场景里本来就是关着的；有人手动打开了也关回去）
            if (encounter && !Unlocked) encounter.enabled = false;
        }

        void Start()
        {
            if (!objective) objective = LevelObjective.For(gameObject.scene);
            if (objective) objective.Completed += OnObjectiveCompleted;
            if (encounter) encounter.Settled += OnSettled;
            if (!objective || objective.Complete) Unlock(false);
        }

        void OnDestroy()
        {
            if (objective) objective.Completed -= OnObjectiveCompleted;
            if (encounter) encounter.Settled -= OnSettled;
        }

        void OnObjectiveCompleted(LevelObjective o) => Unlock(true);

        /// <summary>启用领主战（目标完成时；测试 / 调试命令可以直接调）。announce = 横幅 + 目标栏</summary>
        public void Unlock(bool announce = true)
        {
            if (Unlocked) return;
            Unlocked = true;
            if (encounter) encounter.enabled = true;
            if (announce)
            {
                GameUI.Banner(wakeTitle, wakeSub, 3f);
                if (encounter && encounter.arena) GameAudio.PlayAt("boss_roar", encounter.arena.BossSpawnPoint + Vector3.up * 3f, 0.55f, 0.6f);
            }
            if (encounter && encounter.State == BossEncounter.Phase.Waiting) GameUI.SetObjective("前往神范台 · 击败熔心魔将");
            if (Unlocking == null) return;
            try
            {
                Unlocking(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void Update()
        {
            if (Unlocked || !encounter || !encounter.arena) return;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !GameStateMachine.IsPlaying || Time.time < hintAt) return;
            var feet = pv.transform.position;
            if (!encounter.arena.Contains(feet, 2f) || Mathf.Abs(feet.y - encounter.arena.FloorY) > 6f) return;
            hintAt = Time.time + 6f;
            LockedHints++;
            GameUI.Toast(lockedHint, new Color(1f, 0.55f, 0.3f));
        }

        void OnSettled(BossEncounter e) => SpawnClearChest();

        /// <summary>清关宝箱：RunPlan 本关的 clearReward（3-3 = 秘卷），落在神范前，朝着玩家</summary>
        void SpawnClearChest()
        {
            if (ClearChest) return;
            var stage = GameSession.Instance && GameSession.Instance.Stage != null ? GameSession.Instance.Stage : RunPlan.ForScene(gameObject.scene.path);
            string reward = stage?.clearReward;
            if (string.IsNullOrEmpty(reward) || reward == "none") return;
            Vector3 p;
            if (clearChestPoint) p = clearChestPoint.position;
            else if (encounter && encounter.rewardPoint) p = encounter.rewardPoint.position + encounter.rewardPoint.right * 3f;
            else p = transform.position;
            if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
            var pv = PlayerVitals.Instance;
            var face = pv ? pv.transform.position : p + Vector3.back;
            ClearChest = Chest.Spawn(p, reward, face, ChestTier.Normal);
            if (ClearChest && gameObject.scene.IsValid() && ClearChest.gameObject.scene != gameObject.scene)
                SceneManager.MoveGameObjectToScene(ClearChest.gameObject, gameObject.scene);
            GameUI.Toast("清关奖励 · 宝箱出现在神范前", new Color(1f, 0.85f, 0.51f));
        }
    }
}
