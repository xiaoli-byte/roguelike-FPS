using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一次击杀的战果（<see cref="KillResolver.Rewarded"/>）</summary>
    public struct KillReward
    {
        public Damageable enemy;
        /// <summary>敌人定义（不是名册生成的单位为 null）</summary>
        public EnemyDef def;
        public Rank rank;
        /// <summary>这次给的魂晶（可能为 0：分身等）</summary>
        public int essence;
        /// <summary>致死的那一击</summary>
        public DamageInfo info;
    }

    /// <summary>
    /// 击杀结算（Three.js 版 Combat.kill 的战果部分）：由 <see cref="Combat.DamageEnemy"/> 在派发击杀事件之前调用。
    ///   魂晶：普通 = EnemyDef.essence（不是名册生成的单位 1），精英 ×5；首领 = EnemyDef.essence，没写（0）或没有定义时 60。
    ///   计数：本局击杀数 / 魂晶累计（局状态接入前的临时账本，<see cref="ResetRun"/> 清零）。
    ///   反馈：精英（非首领）死亡按距离震屏（半径 2、×0.8）；处决不震。
    /// 静默处决（<see cref="DamageTag.Purge"/>）与 noReward 的召唤物（蜃景分身…）没有战果，不派发 <see cref="Rewarded"/>。
    /// 灵石掉落、击杀回血回盾仍由 LootDirector 订阅击杀事件处理（经济单元接手）；局状态的钱包订阅 <see cref="Rewarded"/> 入账魂晶。
    /// </summary>
    public static class KillResolver
    {
        public const int BossEssence = 60, EliteEssenceMult = 5, DefaultEssence = 1;
        const float EliteShakeRadius = 2f, EliteShakeScale = 0.8f;

        static readonly EventChannel<InAction<KillReward>> rewarded = new();

        /// <summary>有战果的击杀结算完毕（在 GameEvents.EnemyKilled 之前派发，监听者互相隔离）</summary>
        public static event InAction<KillReward> Rewarded { add => rewarded.Add(value); remove => rewarded.Remove(value); }

        /// <summary>本局（上次 <see cref="ResetRun"/> 以来）有战果的击杀数</summary>
        public static int RunKills { get; private set; }
        /// <summary>本局（上次 <see cref="ResetRun"/> 以来）击杀得到的魂晶</summary>
        public static int RunEssence { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            rewarded.Clear();
            ResetRun();
        }

        /// <summary>新开一局：清零本局的击杀数与魂晶账本</summary>
        public static void ResetRun()
        {
            RunKills = 0;
            RunEssence = 0;
        }

        /// <summary>
        /// 这只敌人值多少魂晶：(定义的 essence，没有定义时普通 1 / 首领 60) × (精英 ? 5 : 1)；首领的定义没写（0）也按 60。
        /// 同 Three.js (def.essence ?? (isBoss ? 60 : 1)) × (isElite ? 5 : 1)。
        /// </summary>
        public static int EssenceFor(EnemyDef def, Rank rank)
        {
            int baseValue = rank == Rank.Boss
                ? (def != null && def.essence > 0 ? def.essence : BossEssence)
                : (def?.essence ?? DefaultEssence);
            return Mathf.Max(0, baseValue) * (rank == Rank.Elite ? EliteEssenceMult : 1);
        }

        /// <summary>这只敌人的定义：名册里的敌人，或首领（首领不进名册，取 BossDef 转出的那份，灵石 / 魂晶按首领奖励算）</summary>
        public static EnemyDef DefOf(Damageable d)
        {
            var ai = d ? d.GetComponent<EnemyAI>() : null;
            if (!ai) return null;
            if (ai is BossBrain boss && boss.Def != null) return boss.Def.ToEnemyDef();
            return EnemyRoster.Get(ai.enemyId);
        }

        /// <summary>结算一次击杀（Combat 调用；异常只报错，不打断击杀事件）</summary>
        internal static void Resolve(in KillEvent kill)
        {
            var d = kill.enemy;
            if (!d) return;
            try
            {
                if (!DamageCalc.IsExecute(kill.info) && d.rank == Rank.Elite)
                    Combat.ExplosionShake(ReactionSystem.CenterOf(d), EliteShakeRadius, EliteShakeScale);
                if (d.noReward || kill.info.Has(DamageTag.Purge)) return;
                var def = DefOf(d);
                int essence = EssenceFor(def, d.rank);
                RunKills++;
                RunEssence += essence;
                var reward = new KillReward { enemy = d, def = def, rank = d.rank, essence = essence, info = kill.info };
                rewarded.Raise(in reward);
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
            }
        }
    }
}
