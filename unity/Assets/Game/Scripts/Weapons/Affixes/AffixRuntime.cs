using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 词条的运行时挂点（AF1 部分）：
    ///   · 输出修饰：登记一个 <see cref="Combat.Outgoing"/>，对带 weaponUid 的伤害找到玩家手上那把枪（两个槽里按 uid 找，同 TS host.find），
    ///     把它每条词条的 <see cref="IAffixEffect.Modifier"/> 乘起来（「猎首」；AF2 / AF3 的「乘隙」「化合」「鼎沸」… 也走这里）；
    ///   · 持握类词条：切枪 / 开局时把当前武器的「轻盈」登记成 weapon:held 来源的移速（同 TS WeaponSystem.applyHeldMods）。
    /// OnFire / OnHit / OnKill / OnReaction 的派发（下一帧排队、同帧合并）由 AF2 的 AffixEffects 接上。
    /// </summary>
    [GameSystem(210)]
    public sealed class AffixRuntime : MonoBehaviour
    {
        /// <summary>持握类词条登记到玩家属性表时用的来源名</summary>
        public const string HeldSource = "weapon:held";

        IDisposable outgoing;
        WeaponController controller;

        void OnEnable()
        {
            outgoing = Combat.Outgoing.Add(Modifier);
            GameEvents.WeaponSwitched += OnSwitched;
        }

        void OnDisable()
        {
            outgoing?.Dispose();
            outgoing = null;
            GameEvents.WeaponSwitched -= OnSwitched;
        }

        void Start() => ApplyHeld(Controller()?.Active);

        WeaponController Controller()
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
            return Apply(w, WeaponStatsResolver.Resolve(w, WeaponStatsResolver.PlayerStats), c);
        }

        /// <summary>把这把枪每种词条（同 id 只算一次，取合计值）的输出倍率乘起来</summary>
        public static float Apply(WeaponInstance w, ResolvedWeapon r, in HitContext c)
        {
            float m = 1;
            var list = w.affixes;
            for (int i = 0; i < list.Count; i++)
            {
                var id = list[i].id;
                bool seen = false;
                for (int j = 0; j < i && !seen; j++) seen = list[j].id == id;
                if (seen) continue;
                var effect = AffixLibrary.Get(id)?.Effect;
                if (effect == null) continue;
                float value = id == r.legendary ? r.legendaryValue : r.Total(id);
                try { m *= effect.Modifier(new AffixHook(w, r, value), c); }
                catch (Exception e) { Debug.LogException(e); }
            }
            return m;
        }
    }
}
