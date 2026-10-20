using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// ScrollScope 的事件订阅（<see cref="GameEvents"/> 的每个事件一个 OnXxx）：立即订阅、卸载时退订；
    /// 回调包了一层「已卸载就不调」——同一次派发的快照里还留着旧回调时，叠层后的旧作用域不会再响应。
    /// TS 事件名对照：enemy:damaged → <see cref="OnEnemyDamaged"/> · enemy:killed → <see cref="OnKill"/>（跳过静默处决）·
    /// enemy:reaction → <see cref="OnReacted"/> · player:damaged → <see cref="OnPlayerHit"/> · player:dashed / died / healed / landed ·
    /// skill:used → <see cref="OnSkillUsed"/> · stage:loaded → <see cref="OnStageLoaded"/> · wave:started → <see cref="OnEncounterStarted"/> ·
    /// weapon:reloaded / switched → <see cref="OnReloaded"/> / <see cref="OnWeaponSwitched"/>。
    /// </summary>
    public sealed partial class ScrollScope
    {
        bool Live => !Disposed && !DryRun;

        // ───────────── 战斗 ─────────────

        public void OnEnemySpawned(Action<EnemyAI> fn)
        {
            if (!Live || fn == null) return;
            Action<EnemyAI> h = a => { if (!Disposed) fn(a); };
            GameEvents.EnemySpawned += h;
            OnUninstall(() => GameEvents.EnemySpawned -= h);
        }

        /// <summary>敌人受到伤害（含免疫 / 格挡）</summary>
        public void OnEnemyDamaged(InAction<HitEvent> fn)
        {
            if (!Live || fn == null) return;
            InAction<HitEvent> h = (in HitEvent e) => { if (!Disposed) fn(in e); };
            GameEvents.EnemyDamaged += h;
            OnUninstall(() => GameEvents.EnemyDamaged -= h);
        }

        /// <summary>全部击杀（含静默处决）。「击杀时」效果请用 <see cref="OnKill"/></summary>
        public void OnEnemyKilled(InAction<KillEvent> fn)
        {
            if (!Live || fn == null) return;
            InAction<KillEvent> h = (in KillEvent e) => { if (!Disposed) fn(in e); };
            GameEvents.EnemyKilled += h;
            OnUninstall(() => GameEvents.EnemyKilled -= h);
        }

        /// <summary>「击杀时」效果（同 TS onKill）：跳过静默处决（<see cref="DamageTag.Purge"/>：清场、首领倒下时一并清掉的爪牙）</summary>
        public void OnKill(InAction<KillEvent> fn)
        {
            if (!Live || fn == null) return;
            InAction<KillEvent> h = (in KillEvent e) =>
            {
                if (!Disposed && !ScrollKit.IsPurgeKill(in e)) fn(in e);
            };
            GameEvents.EnemyKilled += h;
            OnUninstall(() => GameEvents.EnemyKilled -= h);
        }

        public void OnStatusApplied(Action<Damageable, StatusId, int> fn)
        {
            if (!Live || fn == null) return;
            Action<Damageable, StatusId, int> h = (d, s, n) => { if (!Disposed) fn(d, s, n); };
            GameEvents.StatusApplied += h;
            OnUninstall(() => GameEvents.StatusApplied -= h);
        }

        public void OnEnemyShieldBroken(Action<Damageable> fn)
        {
            if (!Live || fn == null) return;
            Action<Damageable> h = d => { if (!Disposed) fn(d); };
            GameEvents.EnemyShieldBroken += h;
            OnUninstall(() => GameEvents.EnemyShieldBroken -= h);
        }

        public void OnEnemyArmorBroken(Action<Damageable> fn)
        {
            if (!Live || fn == null) return;
            Action<Damageable> h = d => { if (!Disposed) fn(d); };
            GameEvents.EnemyArmorBroken += h;
            OnUninstall(() => GameEvents.EnemyArmorBroken -= h);
        }

        /// <summary>元素反应执行完毕（同 TS enemy:reaction）</summary>
        public void OnReacted(InAction<ReactionEvent> fn)
        {
            if (!Live || fn == null) return;
            InAction<ReactionEvent> h = (in ReactionEvent e) => { if (!Disposed) fn(in e); };
            GameEvents.Reacted += h;
            OnUninstall(() => GameEvents.Reacted -= h);
        }

        // ───────────── 玩家 ─────────────

        /// <summary>玩家受伤（死亡判定之前：可以把生命还回去免死）</summary>
        public void OnPlayerHit(InAction<PlayerHitEvent> fn)
        {
            if (!Live || fn == null) return;
            InAction<PlayerHitEvent> h = (in PlayerHitEvent e) => { if (!Disposed) fn(in e); };
            GameEvents.PlayerHit += h;
            OnUninstall(() => GameEvents.PlayerHit -= h);
        }

        public void OnPlayerHealed(Action<float> fn)
        {
            if (!Live || fn == null) return;
            Action<float> h = v => { if (!Disposed) fn(v); };
            GameEvents.PlayerHealed += h;
            OnUninstall(() => GameEvents.PlayerHealed -= h);
        }

        public void OnPlayerShieldBroken(Action fn)
        {
            if (!Live || fn == null) return;
            Action h = () => { if (!Disposed) fn(); };
            GameEvents.PlayerShieldBroken += h;
            OnUninstall(() => GameEvents.PlayerShieldBroken -= h);
        }

        public void OnPlayerDied(Action fn)
        {
            if (!Live || fn == null) return;
            Action h = () => { if (!Disposed) fn(); };
            GameEvents.PlayerDied += h;
            OnUninstall(() => GameEvents.PlayerDied -= h);
        }

        public void OnPlayerDashed(Action<Vector3> fn)
        {
            if (!Live || fn == null) return;
            Action<Vector3> h = d => { if (!Disposed) fn(d); };
            GameEvents.PlayerDashed += h;
            OnUninstall(() => GameEvents.PlayerDashed -= h);
        }

        public void OnPlayerJumped(Action<bool> fn)
        {
            if (!Live || fn == null) return;
            Action<bool> h = air => { if (!Disposed) fn(air); };
            GameEvents.PlayerJumped += h;
            OnUninstall(() => GameEvents.PlayerJumped -= h);
        }

        /// <summary>落地（落地前的下落速度 m/s）</summary>
        public void OnPlayerLanded(Action<float> fn)
        {
            if (!Live || fn == null) return;
            Action<float> h = v => { if (!Disposed) fn(v); };
            GameEvents.PlayerLanded += h;
            OnUninstall(() => GameEvents.PlayerLanded -= h);
        }

        // ───────────── 武器 / 技能 / 秘卷 ─────────────

        public void OnWeaponFired(Action<WeaponInstance> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance> h = w => { if (!Disposed) fn(w); };
            GameEvents.WeaponFired += h;
            OnUninstall(() => GameEvents.WeaponFired -= h);
        }

        public void OnReloadStarted(Action<WeaponInstance> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance> h = w => { if (!Disposed) fn(w); };
            GameEvents.ReloadStarted += h;
            OnUninstall(() => GameEvents.ReloadStarted -= h);
        }

        public void OnReloaded(Action<WeaponInstance> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance> h = w => { if (!Disposed) fn(w); };
            GameEvents.Reloaded += h;
            OnUninstall(() => GameEvents.Reloaded -= h);
        }

        /// <summary>切枪（之前手上的, 现在手上的）</summary>
        public void OnWeaponSwitched(Action<WeaponInstance, WeaponInstance> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance, WeaponInstance> h = (a, b) => { if (!Disposed) fn(a, b); };
            GameEvents.WeaponSwitched += h;
            OnUninstall(() => GameEvents.WeaponSwitched -= h);
        }

        public void OnWeaponAcquired(Action<WeaponInstance> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance> h = w => { if (!Disposed) fn(w); };
            GameEvents.WeaponAcquired += h;
            OnUninstall(() => GameEvents.WeaponAcquired -= h);
        }

        public void OnWeaponSkillUsed(Action<WeaponInstance, string> fn)
        {
            if (!Live || fn == null) return;
            Action<WeaponInstance, string> h = (w, id) => { if (!Disposed) fn(w, id); };
            GameEvents.WeaponSkillUsed += h;
            OnUninstall(() => GameEvents.WeaponSkillUsed -= h);
        }

        /// <summary>英雄技能放出（槽位, 技能 id）</summary>
        public void OnSkillUsed(Action<SkillSlot, string> fn)
        {
            if (!Live || fn == null) return;
            Action<SkillSlot, string> h = (s, id) => { if (!Disposed) fn(s, id); };
            GameEvents.SkillUsed += h;
            OnUninstall(() => GameEvents.SkillUsed -= h);
        }

        /// <summary>得到秘卷（任意一卷，含自己叠层）</summary>
        public void OnScrollAcquired(Action<ScrollDef, int> fn)
        {
            if (!Live || fn == null) return;
            Action<ScrollDef, int> h = (d, n) => { if (!Disposed) fn(d, n); };
            GameEvents.ScrollAcquired += h;
            OnUninstall(() => GameEvents.ScrollAcquired -= h);
        }

        // ───────────── 局 / 关卡 ─────────────

        /// <summary>场地开战（同 TS wave:started）</summary>
        public void OnEncounterStarted(Action<EncounterSite> fn)
        {
            if (!Live || fn == null) return;
            Action<EncounterSite> h = s => { if (!Disposed) fn(s); };
            GameEvents.EncounterStarted += h;
            OnUninstall(() => GameEvents.EncounterStarted -= h);
        }

        public void OnEncounterCleared(Action<EncounterSite> fn)
        {
            if (!Live || fn == null) return;
            Action<EncounterSite> h = s => { if (!Disposed) fn(s); };
            GameEvents.EncounterCleared += h;
            OnUninstall(() => GameEvents.EncounterCleared -= h);
        }

        /// <summary>灵石变化（变化量, 总数）</summary>
        public void OnCoinsChanged(Action<int, int> fn)
        {
            if (!Live || fn == null) return;
            Action<int, int> h = (d, t) => { if (!Disposed) fn(d, t); };
            GameEvents.CoinsChanged += h;
            OnUninstall(() => GameEvents.CoinsChanged -= h);
        }

        public void OnPickedUp(Action<Pickup.Kind, float> fn)
        {
            if (!Live || fn == null) return;
            Action<Pickup.Kind, float> h = (k, a) => { if (!Disposed) fn(k, a); };
            GameEvents.PickedUp += h;
            OnUninstall(() => GameEvents.PickedUp -= h);
        }

        public void OnRunStarted(Action<RunState> fn)
        {
            if (!Live || fn == null) return;
            Action<RunState> h = s => { if (!Disposed) fn(s); };
            GameEvents.RunStarted += h;
            OnUninstall(() => GameEvents.RunStarted -= h);
        }

        /// <summary>关卡就绪（同 TS stage:loaded：换关清空临时战斗状态）</summary>
        public void OnStageLoaded(Action<StageSpec> fn)
        {
            if (!Live || fn == null) return;
            Action<StageSpec> h = s => { if (!Disposed) fn(s); };
            GameEvents.StageLoaded += h;
            OnUninstall(() => GameEvents.StageLoaded -= h);
        }

        public void OnStageCleared(Action<StageSpec> fn)
        {
            if (!Live || fn == null) return;
            Action<StageSpec> h = s => { if (!Disposed) fn(s); };
            GameEvents.StageCleared += h;
            OnUninstall(() => GameEvents.StageCleared -= h);
        }
    }
}
