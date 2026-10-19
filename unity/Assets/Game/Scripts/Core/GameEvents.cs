using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>按只读引用传递载荷的事件（载荷是较大的 struct：伤害、击杀、反应）</summary>
    public delegate void InAction<T>(in T e);

    /// <summary>
    /// 事件订阅表：写时复制（派发途中增删订阅不影响本次派发，和 C# 多播委托的语义一致），
    /// 派发时逐个调用、互相隔离——一个监听者抛异常只报错，不影响其他监听者，也不打断派发方（伤害结算、换弹）。
    /// </summary>
    public sealed class EventChannel<T> where T : Delegate
    {
        T[] handlers = Array.Empty<T>();

        /// <summary>当前订阅者快照（派发方遍历它）</summary>
        public T[] Handlers => handlers;

        public void Add(T h)
        {
            if (h == null) return;
            var a = handlers;
            var n = new T[a.Length + 1];
            Array.Copy(a, n, a.Length);
            n[a.Length] = h;
            handlers = n;
        }

        /// <summary>撤销最后一次登记的同一委托（同 C# 事件的 -=）</summary>
        public void Remove(T h)
        {
            if (h == null) return;
            var a = handlers;
            for (int i = a.Length - 1; i >= 0; i--)
            {
                if (!a[i].Equals(h)) continue;
                var n = new T[a.Length - 1];
                Array.Copy(a, 0, n, 0, i);
                Array.Copy(a, i + 1, n, i, a.Length - i - 1);
                handlers = n;
                return;
            }
        }

        public void Clear() => handlers = Array.Empty<T>();
    }

    /// <summary>按委托签名派发 <see cref="EventChannel{T}"/>（逐个调用、隔离异常）</summary>
    public static class EventChannelExtensions
    {
        public static void Raise(this EventChannel<Action> c)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](); }
                catch (Exception e) { Debug.LogException(e); }
        }

        public static void Raise<A>(this EventChannel<Action<A>> c, A a)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](a); }
                catch (Exception e) { Debug.LogException(e); }
        }

        public static void Raise<A, B>(this EventChannel<Action<A, B>> c, A a, B b)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](a, b); }
                catch (Exception e) { Debug.LogException(e); }
        }

        public static void Raise<A, B, C>(this EventChannel<Action<A, B, C>> c, A a, B b, C cc)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](a, b, cc); }
                catch (Exception e) { Debug.LogException(e); }
        }

        public static void Raise<A, B, C, D, E>(this EventChannel<Action<A, B, C, D, E>> c, A a, B b, C cc, D d, E e)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](a, b, cc, d, e); }
                catch (Exception ex) { Debug.LogException(ex); }
        }

        public static void Raise<A>(this EventChannel<InAction<A>> c, in A a)
        {
            var hs = c.Handlers;
            for (int i = 0; i < hs.Length; i++)
                try { hs[i](in a); }
                catch (Exception e) { Debug.LogException(e); }
        }
    }

    /// <summary>敌人受到一次伤害（含免疫 / 格挡：total 为 0 但 immune / blocked 为 true）</summary>
    public struct HitEvent
    {
        public Damageable enemy;
        public DamageInfo info;
        public DamageResult result;
    }

    /// <summary>敌人被打死（经伤害管线；<see cref="Damageable.Kill"/> 直接处死的不发）</summary>
    public struct KillEvent
    {
        public Damageable enemy;
        public DamageInfo info;
        public DamageResult result;
    }

    /// <summary>玩家受到一次伤害（在死亡判定之前派发：监听者可以把生命还回去免死）</summary>
    public struct PlayerHitEvent
    {
        /// <summary>减伤与受伤修饰器之后的伤害（护盾 + 生命共扣这么多，生命不够时多出来的不计入 toHp）</summary>
        public float amount;
        public float toShield, toHp;
        public Element element;
        /// <summary>出手者（敌人 AI、投射物来源…，可能为 null）</summary>
        public UnityEngine.Object source;
        /// <summary>伤害来自的位置（受击方向指示）</summary>
        public Vector3 from;
    }

    /// <summary>
    /// 全局事件总线（Three.js 版 src/core/EventBus.ts + GameEvents）：静态 C# 事件 + struct 载荷。
    /// 订阅方 += / -=（MonoBehaviour 在 OnEnable / OnDisable 里成对写）；派发方调 Raise*。
    /// 监听者互相隔离：抛异常只报错。SubsystemRegistration 时清空全部订阅（关掉 Domain Reload 也不会重复订阅）。
    /// 旧的分散事件（Combat.EnemyDamaged / EnemyKilled / PlayerDamaged、ReactionSystem.Reacted、EncounterSite.AnySiteCleared）
    /// 照常派发，第 4 批再删。局 / 关卡 / 首领类事件（RunStarted、StageLoaded、BossPhase…）由定义那些类型的单元追加。
    /// </summary>
    public static partial class GameEvents
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            enemySpawned.Clear();
            enemyDamaged.Clear();
            enemyKilled.Clear();
            statusApplied.Clear();
            enemyShieldBroken.Clear();
            enemyArmorBroken.Clear();
            reacted.Clear();
            playerHit.Clear();
            playerHealed.Clear();
            playerShieldBroken.Clear();
            playerDied.Clear();
            playerDashed.Clear();
            playerJumped.Clear();
            playerLanded.Clear();
            weaponFired.Clear();
            reloadStarted.Clear();
            reloaded.Clear();
            weaponSwitched.Clear();
            weaponAcquired.Clear();
            weaponSkillUsed.Clear();
            skillUsed.Clear();
            scrollAcquired.Clear();
            scrollProc.Clear();
            encounterStarted.Clear();
            encounterCleared.Clear();
            coinsChanged.Clear();
            essenceChanged.Clear();
            pickedUp.Clear();
        }

        // ───────────── 战斗 ─────────────

        static readonly EventChannel<Action<EnemyAI>> enemySpawned = new();
        static readonly EventChannel<InAction<HitEvent>> enemyDamaged = new();
        static readonly EventChannel<InAction<KillEvent>> enemyKilled = new();
        static readonly EventChannel<Action<Damageable, StatusId, int>> statusApplied = new();
        static readonly EventChannel<Action<Damageable>> enemyShieldBroken = new();
        static readonly EventChannel<Action<Damageable>> enemyArmorBroken = new();
        static readonly EventChannel<InAction<ReactionEvent>> reacted = new();

        /// <summary>敌人生成完毕（出生无敌开始时）</summary>
        public static event Action<EnemyAI> EnemySpawned { add => enemySpawned.Add(value); remove => enemySpawned.Remove(value); }
        /// <summary>敌人受到伤害（元素附着 / 反应判定之后：result.statusApplied、result.reaction 已写好）</summary>
        public static event InAction<HitEvent> EnemyDamaged { add => enemyDamaged.Add(value); remove => enemyDamaged.Remove(value); }
        /// <summary>敌人被打死（此时它身上的状态还在：<see cref="EnemyStatus.DiedWith"/>）</summary>
        public static event InAction<KillEvent> EnemyKilled { add => enemyKilled.Add(value); remove => enemyKilled.Remove(value); }
        /// <summary>敌人挂上状态（敌人, 状态, 当前层数）</summary>
        public static event Action<Damageable, StatusId, int> StatusApplied { add => statusApplied.Add(value); remove => statusApplied.Remove(value); }
        public static event Action<Damageable> EnemyShieldBroken { add => enemyShieldBroken.Add(value); remove => enemyShieldBroken.Remove(value); }
        public static event Action<Damageable> EnemyArmorBroken { add => enemyArmorBroken.Add(value); remove => enemyArmorBroken.Remove(value); }
        /// <summary>元素反应执行完毕（在伤害管线之外派发，监听者可以直接造成伤害）</summary>
        public static event InAction<ReactionEvent> Reacted { add => reacted.Add(value); remove => reacted.Remove(value); }

        public static void RaiseEnemySpawned(EnemyAI ai) => enemySpawned.Raise(ai);
        public static void RaiseEnemyDamaged(in HitEvent e) => enemyDamaged.Raise(in e);
        public static void RaiseEnemyKilled(in KillEvent e) => enemyKilled.Raise(in e);
        public static void RaiseStatusApplied(Damageable d, StatusId id, int stacks) => statusApplied.Raise(d, id, stacks);
        public static void RaiseEnemyShieldBroken(Damageable d) => enemyShieldBroken.Raise(d);
        public static void RaiseEnemyArmorBroken(Damageable d) => enemyArmorBroken.Raise(d);
        public static void RaiseReacted(in ReactionEvent e) => reacted.Raise(in e);

        // ───────────── 玩家 ─────────────

        static readonly EventChannel<InAction<PlayerHitEvent>> playerHit = new();
        static readonly EventChannel<Action<float>> playerHealed = new();
        static readonly EventChannel<Action> playerShieldBroken = new();
        static readonly EventChannel<Action> playerDied = new();
        static readonly EventChannel<Action<Vector3>> playerDashed = new();
        static readonly EventChannel<Action<bool>> playerJumped = new();
        static readonly EventChannel<Action<float>> playerLanded = new();

        /// <summary>玩家受伤：在死亡判定之前派发（绝处逢生类效果可以在这里把生命还回去）</summary>
        public static event InAction<PlayerHitEvent> PlayerHit { add => playerHit.Add(value); remove => playerHit.Remove(value); }
        /// <summary>玩家回复生命（实际回复量 &gt; 0 时；护盾恢复不发）</summary>
        public static event Action<float> PlayerHealed { add => playerHealed.Add(value); remove => playerHealed.Remove(value); }
        public static event Action PlayerShieldBroken { add => playerShieldBroken.Add(value); remove => playerShieldBroken.Remove(value); }
        public static event Action PlayerDied { add => playerDied.Add(value); remove => playerDied.Remove(value); }
        /// <summary>冲刺（冲刺方向，水平单位向量）</summary>
        public static event Action<Vector3> PlayerDashed { add => playerDashed.Add(value); remove => playerDashed.Remove(value); }
        /// <summary>起跳（true = 空中再跳）</summary>
        public static event Action<bool> PlayerJumped { add => playerJumped.Add(value); remove => playerJumped.Remove(value); }
        /// <summary>落地（落地前的下落速度 m/s）</summary>
        public static event Action<float> PlayerLanded { add => playerLanded.Add(value); remove => playerLanded.Remove(value); }

        public static void RaisePlayerHit(in PlayerHitEvent e) => playerHit.Raise(in e);
        public static void RaisePlayerHealed(float actual) => playerHealed.Raise(actual);
        public static void RaisePlayerShieldBroken() => playerShieldBroken.Raise();
        public static void RaisePlayerDied() => playerDied.Raise();
        public static void RaisePlayerDashed(Vector3 dir) => playerDashed.Raise(dir);
        public static void RaisePlayerJumped(bool air) => playerJumped.Raise(air);
        public static void RaisePlayerLanded(float fallSpeed) => playerLanded.Raise(fallSpeed);

        // ───────────── 武器 / 技能 / 秘卷 ─────────────

        static readonly EventChannel<Action<WeaponInstance>> weaponFired = new();
        static readonly EventChannel<Action<WeaponInstance>> reloadStarted = new();
        static readonly EventChannel<Action<WeaponInstance>> reloaded = new();
        static readonly EventChannel<Action<WeaponInstance, WeaponInstance>> weaponSwitched = new();
        static readonly EventChannel<Action<WeaponInstance>> weaponAcquired = new();
        static readonly EventChannel<Action<WeaponInstance, string>> weaponSkillUsed = new();
        static readonly EventChannel<Action<SkillSlot, string>> skillUsed = new();
        static readonly EventChannel<Action<ScrollDef, int>> scrollAcquired = new();
        static readonly EventChannel<Action<string>> scrollProc = new();

        /// <summary>开了一枪（霰弹一发算一次，光束每跳一次）</summary>
        public static event Action<WeaponInstance> WeaponFired { add => weaponFired.Add(value); remove => weaponFired.Remove(value); }
        public static event Action<WeaponInstance> ReloadStarted { add => reloadStarted.Add(value); remove => reloadStarted.Remove(value); }
        /// <summary>换弹完成（逐发装填被打断时，已经压进一发以上也算完成）</summary>
        public static event Action<WeaponInstance> Reloaded { add => reloaded.Add(value); remove => reloaded.Remove(value); }
        /// <summary>切枪（之前手上的, 现在手上的）；拾取替换当前槽时 prev 是被换下来的那把</summary>
        public static event Action<WeaponInstance, WeaponInstance> WeaponSwitched { add => weaponSwitched.Add(value); remove => weaponSwitched.Remove(value); }
        /// <summary>得到一把枪（拾取、宝箱），在放进槽位之前派发</summary>
        public static event Action<WeaponInstance> WeaponAcquired { add => weaponAcquired.Add(value); remove => weaponAcquired.Remove(value); }
        /// <summary>武器技能（碎刃「杀气爆发」「人刀合一」）：(武器, 技能 id)</summary>
        public static event Action<WeaponInstance, string> WeaponSkillUsed { add => weaponSkillUsed.Add(value); remove => weaponSkillUsed.Remove(value); }
        /// <summary>英雄技能放出去了（槽位, 技能 id）</summary>
        public static event Action<SkillSlot, string> SkillUsed { add => skillUsed.Add(value); remove => skillUsed.Remove(value); }
        /// <summary>得到秘卷（秘卷, 现在的层数）</summary>
        public static event Action<ScrollDef, int> ScrollAcquired { add => scrollAcquired.Add(value); remove => scrollAcquired.Remove(value); }
        /// <summary>秘卷 / 词条触发了一次（id），HUD 闪图标用</summary>
        public static event Action<string> ScrollProc { add => scrollProc.Add(value); remove => scrollProc.Remove(value); }

        public static void RaiseWeaponFired(WeaponInstance w) => weaponFired.Raise(w);
        public static void RaiseReloadStarted(WeaponInstance w) => reloadStarted.Raise(w);
        public static void RaiseReloaded(WeaponInstance w) => reloaded.Raise(w);
        public static void RaiseWeaponSwitched(WeaponInstance prev, WeaponInstance next) => weaponSwitched.Raise(prev, next);
        public static void RaiseWeaponAcquired(WeaponInstance w) => weaponAcquired.Raise(w);
        public static void RaiseWeaponSkillUsed(WeaponInstance w, string skillId) => weaponSkillUsed.Raise(w, skillId);
        public static void RaiseSkillUsed(SkillSlot slot, string skillId) => skillUsed.Raise(slot, skillId);
        public static void RaiseScrollAcquired(ScrollDef def, int stacks) => scrollAcquired.Raise(def, stacks);
        public static void RaiseScrollProc(string id) => scrollProc.Raise(id);

        // ───────────── 局 / 关卡 ─────────────

        static readonly EventChannel<Action<EncounterSite>> encounterStarted = new();
        static readonly EventChannel<Action<EncounterSite>> encounterCleared = new();
        static readonly EventChannel<Action<int, int>> coinsChanged = new();
        static readonly EventChannel<Action<int, int>> essenceChanged = new();
        static readonly EventChannel<Action<Pickup.Kind, float>> pickedUp = new();

        /// <summary>场地开战（玩家进入触发范围）</summary>
        public static event Action<EncounterSite> EncounterStarted { add => encounterStarted.Add(value); remove => encounterStarted.Remove(value); }
        /// <summary>场地肃清</summary>
        public static event Action<EncounterSite> EncounterCleared { add => encounterCleared.Add(value); remove => encounterCleared.Remove(value); }
        /// <summary>灵石变化（变化量, 现在的总数）</summary>
        public static event Action<int, int> CoinsChanged { add => coinsChanged.Add(value); remove => coinsChanged.Remove(value); }
        /// <summary>魂晶变化（变化量, 现在的总数）：局外货币接入后由 RunState 派发</summary>
        public static event Action<int, int> EssenceChanged { add => essenceChanged.Add(value); remove => essenceChanged.Remove(value); }
        /// <summary>捡到东西（种类, 数量：灵石个数 / 弹药比例 / 生命量）</summary>
        public static event Action<Pickup.Kind, float> PickedUp { add => pickedUp.Add(value); remove => pickedUp.Remove(value); }

        public static void RaiseEncounterStarted(EncounterSite site) => encounterStarted.Raise(site);
        public static void RaiseEncounterCleared(EncounterSite site) => encounterCleared.Raise(site);
        public static void RaiseCoinsChanged(int delta, int total) => coinsChanged.Raise(delta, total);
        public static void RaiseEssenceChanged(int delta, int total) => essenceChanged.Raise(delta, total);
        public static void RaisePickedUp(Pickup.Kind kind, float amount) => pickedUp.Raise(kind, amount);
    }
}
