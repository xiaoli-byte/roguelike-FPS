using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 图鉴收录（I5）：[GameSystem]，挂在 Core 的 Game Systems 上，把局内「首次获得 / 首次交手」记进 <see cref="Codex.For"/>(当前局) 的图鉴。
    ///   · 敌人：第一次打中它、被它打中、打死它，或首领登场（<see cref="GameEvents.BossSpawned"/>）；
    ///   · 秘卷：<see cref="GameEvents.ScrollAcquired"/>；
    ///   · 武器、灵宠、读档 / 换关恢复的秘卷：每 0.5 s（不缩放时间）看一眼手上两把枪、当前灵宠、秘卷清单——
    ///     拾取 / 购买 / 宝箱 / 首领奖励 / 开局武器 / 读档都走得到，不用在每个发放点挂钩子（WeaponAcquired 事件目前没有人发）。
    /// 新收录时右上角提示一行「图鉴新收录 · xx」（冒烟测试的 TestMode 期间不提示，免得挡截图）。
    /// </summary>
    [GameSystem(80)]
    public sealed class CodexTracker : MonoBehaviour
    {
        const float PollInterval = 0.5f;
        float nextPoll;

        void OnEnable()
        {
            GameEvents.EnemyDamaged += OnEnemyDamaged;
            GameEvents.EnemyKilled += OnEnemyKilled;
            GameEvents.BossSpawned += OnBossSpawned;
            GameEvents.ScrollAcquired += OnScroll;
            GameEvents.PlayerHit += OnPlayerHit;
            GameEvents.StageLoaded += OnStageLoaded;
            Codex.Unlocked += OnUnlocked;
        }

        void OnDisable()
        {
            GameEvents.EnemyDamaged -= OnEnemyDamaged;
            GameEvents.EnemyKilled -= OnEnemyKilled;
            GameEvents.BossSpawned -= OnBossSpawned;
            GameEvents.ScrollAcquired -= OnScroll;
            GameEvents.PlayerHit -= OnPlayerHit;
            GameEvents.StageLoaded -= OnStageLoaded;
            Codex.Unlocked -= OnUnlocked;
        }

        static Codex Book => RunState.Current != null ? Codex.For(RunState.Current) : null;

        static void Unlock(CodexKind kind, string id)
        {
            if (string.IsNullOrEmpty(id)) return;
            Book?.Unlock(kind, id);
        }

        void OnEnemyDamaged(in HitEvent e) => Unlock(CodexKind.Enemy, CodexCatalog.EnemyIdOf(e.enemy));
        void OnEnemyKilled(in KillEvent e) => Unlock(CodexKind.Enemy, CodexCatalog.EnemyIdOf(e.enemy));
        void OnBossSpawned(BossBrain b) => Unlock(CodexKind.Enemy, CodexCatalog.EnemyIdOf(b));
        void OnScroll(ScrollDef def, int stacks) => Unlock(CodexKind.Scroll, def?.id);

        void OnPlayerHit(in PlayerHitEvent e)
        {
            var c = e.source as Component;
            if (!c) return;
            var ai = c.GetComponentInParent<EnemyAI>();
            if (ai) Unlock(CodexKind.Enemy, CodexCatalog.EnemyIdOf(ai));
        }

        void OnStageLoaded(StageSpec s) => Poll();

        void Update()
        {
            if (Time.unscaledTime < nextPoll) return;
            nextPoll = Time.unscaledTime + PollInterval;
            Poll();
        }

        /// <summary>看一眼手上的枪、灵宠、秘卷清单，没收录的收录（测试也直接调）</summary>
        public static void Poll()
        {
            var book = Book;
            if (book == null) return;
            var pv = PlayerVitals.Instance;
            if (pv)
            {
                var wc = pv.GetComponent<WeaponController>();
                if (wc)
                    foreach (var w in wc.slots)
                        if (w?.def != null)
                            book.Unlock(CodexKind.Weapon, w.def.id);
            }
            var pet = PetOwner.Instance;
            if (pet && pet.Current && pet.Current.def != null) book.Unlock(CodexKind.Pet, pet.Current.def.id);
            var loot = LootDirector.Instance;
            if (loot != null && loot)
                foreach (var id in loot.scrolls.Order)
                    book.Unlock(CodexKind.Scroll, id);
        }

        static void OnUnlocked(CodexKind kind, string id)
        {
            if (WeaponController.TestMode) return;
            var e = CodexCatalog.Find(kind, id);
            if (e == null) return;
            GameUI.Toast($"图鉴新收录 · {CodexCatalog.KindName(kind)}「{e.name}」", UITheme.GoldHi, 2.2f);
        }
    }
}
