using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 词条的运行时挂点：
    ///   · 输出修饰：登记一个 <see cref="Combat.Outgoing"/>，对带 weaponUid 的伤害找到玩家手上那把枪（两个槽里按 uid 找，同 TS host.find），
    ///     把它每条词条的 <see cref="IAffixEffect.Modifier"/> 乘起来（猎首、乘隙、化合、轮回、鼎沸…）；
    ///   · 触发派发（AF2）：持有 <see cref="AffixEffects"/>，把 GameEvents 的受伤 / 击杀 / 反应转进去，每帧开头 <see cref="AffixEffects.Flush"/>
    ///     执行上一帧排队的效果（执行顺序 −20：早于武器、投射物、状态与反应的更新，等价于 TS 在武器更新开头 flush）；换关时丢弃未执行的；
    ///   · 持握类词条：切枪 / 开局时把当前武器的「轻盈」登记成 weapon:held 来源的移速（同 TS WeaponSystem.applyHeldMods）。
    /// 开火 / 射速钩子不经过这里：状态机直接调 <see cref="WeaponRuntime.BeginShot"/> / <see cref="WeaponRuntime.RateMult"/>。
    /// </summary>
    [GameSystem(210)]
    [DefaultExecutionOrder(-20)]
    public sealed class AffixRuntime : MonoBehaviour
    {
        /// <summary>持握类词条登记到玩家属性表时用的来源名</summary>
        public const string HeldSource = "weapon:held";

        IDisposable outgoing;
        WeaponController controller;
        AffixEffects effects;

        /// <summary>触发派发器（第一次访问时建）</summary>
        public AffixEffects Effects => effects ??= new AffixEffects(new GameAffixEnv(this));

        void OnEnable()
        {
            outgoing = Combat.Outgoing.Add(Modifier);
            GameEvents.WeaponSwitched += OnSwitched;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.EnemyKilled += OnKilled;
            GameEvents.Reacted += OnReacted;
            GameEvents.StageLoaded += OnStageLoaded;
        }

        void OnDisable()
        {
            outgoing?.Dispose();
            outgoing = null;
            GameEvents.WeaponSwitched -= OnSwitched;
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.EnemyKilled -= OnKilled;
            GameEvents.Reacted -= OnReacted;
            GameEvents.StageLoaded -= OnStageLoaded;
            effects?.Clear();
        }

        void Start() => ApplyHeld(Controller()?.Active);

        /// <summary>上一帧排队的触发效果在这一帧开头执行</summary>
        void Update() => effects?.Flush();

        void OnDamaged(in HitEvent e) => Effects.OnDamaged(in e);
        void OnKilled(in KillEvent e) => Effects.OnKilled(in e);
        void OnReacted(in ReactionEvent e) => Effects.OnReaction(in e);
        void OnStageLoaded(StageSpec s) => effects?.Clear();

        /// <summary>玩家的武器控制器（玩家重建后重新找）</summary>
        internal WeaponController Controller()
        {
            if (!controller && PlayerVitals.Instance) controller = PlayerVitals.Instance.GetComponent<WeaponController>();
            return controller;
        }

        /// <summary>玩家两个槽里按 uid 找枪（换下 / 丢掉的枪找不到：它的投射物不再吃词条，同 TS）</summary>
        public WeaponInstance Find(int uid)
        {
            var wc = Controller();
            if (!wc || uid == 0) return null;
            foreach (var w in wc.slots)
                if (w != null && w.uid == uid) return w;
            return null;
        }

        void OnSwitched(WeaponInstance prev, WeaponInstance next) => ApplyHeld(next);

        static void ApplyHeld(WeaponInstance w)
        {
            var stats = WeaponStatsResolver.PlayerStats;
            if (stats == null) return;
            stats.BeginBatch();
            try
            {
                stats.Remove(HeldSource);
                if (w != null)
                {
                    var r = WeaponStatsResolver.Resolve(w, stats);
                    if (r.swift > 0) stats.Add(HeldSource, Stat.MoveSpeed, r.swift);
                }
            }
            finally { stats.EndBatch(); }
        }

        float Modifier(in HitContext c)
        {
            int uid = c.info.weaponUid;
            if (uid == 0) return 1;
            var w = Find(uid);
            if (w == null || w.affixes.Count == 0) return 1;
            return Apply(w, WeaponStatsResolver.Resolve(w, WeaponStatsResolver.PlayerStats), c, Effects);
        }

        /// <summary>
        /// 把这把枪每种词条（同 id 只算一次，取合计值）的输出倍率乘起来。fx = 派发器（读敌人状态、当前时间；null 时按游戏环境读、时间取 Time.time）
        /// </summary>
        public static float Apply(WeaponInstance w, ResolvedWeapon r, in HitContext c, AffixEffects fx = null)
        {
            float m = 1;
            float now = fx?.Now ?? Time.time;
            var list = w.affixes;
            for (int i = 0; i < list.Count; i++)
            {
                if (!AffixEffects.FirstOf(list, i)) continue;
                var id = list[i].id;
                var effect = AffixLibrary.Get(id)?.Effect;
                if (effect == null) continue;
                try { m *= effect.Modifier(new AffixHook(w, r, AffixEffects.ValueOf(w, r, id), fx, now), c); }
                catch (Exception e) { Debug.LogException(e); }
            }
            return m;
        }
    }
}
