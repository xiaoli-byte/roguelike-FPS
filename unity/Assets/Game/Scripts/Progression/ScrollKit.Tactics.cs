using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷效果碰外界的接缝（Three.js 秘卷里 ctx.player / ctx.weapons / ctx.combat / ctx.enemies 的那一部分）：
    /// 战术秘卷（Progression/Scrolls/Tactics）与反应秘卷（Progression/Scrolls/Reaction）只经它读写玩家、武器、技能冷却、反应系统、
    /// 范围查询、爆炸与投射物。默认 <see cref="GameScrollHost"/> 接真实组件；EditMode 测试换成假的（同 <see cref="IReactionEnv"/> 的做法），
    /// 不需要场景、玩家、反应系统实例和物理。对敌人的直接伤害仍走 <see cref="Combat.DamageEnemy"/>（EditMode 下可用）。
    /// </summary>
    public interface IScrollHost
    {
        // ── 玩家 ──

        /// <summary>玩家存在且活着（同 TS ctx.player.alive）</summary>
        bool Alive { get; }
        /// <summary>玩家脚底位置</summary>
        Vector3 Position { get; }
        float Shield { get; }
        /// <summary>护盾上限（实际值，可以为 0）</summary>
        float MaxShield { get; }
        /// <summary>补充护盾（不超过上限）：返回实际补充量</summary>
        float AddShield(float amount);
        /// <summary>立即回复技能冷却（slot = null 时两个槽都回；同 TS reduceCooldowns(…, 'both')）</summary>
        void ReduceCooldowns(float seconds, SkillSlot? slot);

        // ── 武器 ──

        /// <summary>手上的武器（没有为 null）</summary>
        WeaponInstance ActiveWeapon { get; }
        /// <summary>正在换弹（实际换弹状态，同 TS weapons.isReloading）</summary>
        bool Reloading { get; }
        /// <summary>某把武器的实际弹匣容量（吃弹匣属性与词条）</summary>
        int MagCapacity(WeaponInstance w);
        /// <summary>近战形态 / 被接管的武器（碎刃）：不能装填</summary>
        bool IsMelee(WeaponInstance w);

        // ── 敌人查询 ──

        /// <summary>center 半径内（按身体中心）活着、可选中、不是 exclude 的敌人写进 results（先清空），返回个数；顺序不保证</summary>
        int Near(Vector3 center, float radius, Damageable exclude, List<Damageable> results);
        /// <summary>from 到敌人身体中心之间被地形挡住</summary>
        bool Blocked(Vector3 from, Damageable target);
        /// <summary>准星所指 range 米内的敌人；没有则玩家 fallbackRange 米内最近的敌人；都没有为 null（劫火）</summary>
        Damageable AimTarget(float range, float fallbackRange);
        /// <summary>敌人身上有没有某元素的状态（灼烧 / 雷殛 / 蚀化，同 <see cref="EnemyStatus.Has(Damageable, Element)"/>）</summary>
        bool HasStatus(Damageable target, Element element);

        // ── 战斗 / 反应 ──

        /// <summary>按概率 p 掷一次（秘卷触发流，同 TS ctx.rng.chance）</summary>
        bool Chance(float p);
        /// <summary>范围爆炸（<see cref="Combat.Explode(in ExplosionOptions)"/>）：返回造成伤害的敌人数</summary>
        int Explode(in ExplosionOptions o);
        /// <summary>发射一枚玩家投射物（<see cref="PlayerProjectile.Spawn(in PlayerProjectileSpec)"/>）</summary>
        void SpawnProjectile(in PlayerProjectileSpec spec);
        /// <summary>直接挂元素并判定反应（<see cref="ReactionSystem.ApplyStatus"/>）：power = 状态强度（不含元素 / 精英 / 首领加成）</summary>
        Reaction? ApplyStatus(Damageable target, Element element, float power, in StatusApplyOpts opts);
        /// <summary>引爆敌人身上的元素状态（<see cref="Combat.Detonate"/>）：被冷却 / 预算拒绝时为 null</summary>
        DetonateOutcome? Detonate(Damageable target, in DetonateOpts opts);
        /// <summary>强制反应（<see cref="Combat.TriggerReaction"/>）：被拒绝时为 null</summary>
        Reaction? Trigger(Damageable target, Reaction id, in TriggerOpts opts);
        /// <summary>眩晕（<see cref="EnemyStatus.Stun"/>：精英 / 首领自动缩放，取较长值）</summary>
        bool Stun(Damageable target, float seconds);
    }

    /// <summary>运行时的 <see cref="IScrollHost"/>：读 <see cref="PlayerVitals.Instance"/> 及其身上的 WeaponController / HeroSkills / PlayerMotor</summary>
    public sealed class GameScrollHost : IScrollHost
    {
        public static readonly GameScrollHost Instance = new();

        static PlayerVitals Player => PlayerVitals.Instance;

        static WeaponController Weapons
        {
            get
            {
                var p = Player;
                return p ? p.GetComponent<WeaponController>() : null;
            }
        }

        public bool Alive
        {
            get
            {
                var p = Player;
                return p && !p.Dead;
            }
        }

        public Vector3 Position
        {
            get
            {
                var p = Player;
                return p ? p.transform.position : Vector3.zero;
            }
        }

        public float Shield
        {
            get
            {
                var p = Player;
                return p ? p.shield : 0;
            }
        }

        public float MaxShield
        {
            get
            {
                var p = Player;
                return p ? p.MaxShield : 0;
            }
        }

        public float AddShield(float amount)
        {
            var p = Player;
            return p && amount > 0 ? p.AddShield(amount) : 0;
        }

        public void ReduceCooldowns(float seconds, SkillSlot? slot)
        {
            var p = Player;
            var skills = p ? p.GetComponent<HeroSkills>() : null;
            if (skills) skills.ReduceCooldowns(seconds, slot);
        }

        public WeaponInstance ActiveWeapon
        {
            get
            {
                var wc = Weapons;
                return wc ? wc.Active : null;
            }
        }

        public bool Reloading
        {
            get
            {
                var wc = Weapons;
                return wc && wc.Reloading;
            }
        }

        public int MagCapacity(WeaponInstance w) => w != null ? WeaponStatsResolver.Resolve(w).magCap : 0;

        public bool IsMelee(WeaponInstance w) => w != null && (w.def == null || w.def.IsBlade || WeaponTakeovers.Find(w) != null);

        static bool Targetable(Damageable d) => d && !d.Dead && !d.untargetable && d.isActiveAndEnabled;

        public int Near(Vector3 center, float radius, Damageable exclude, List<Damageable> results)
        {
            results.Clear();
            float r2 = radius * radius;
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
            {
                var ai = all[i];
                var d = ai ? ai.Health : null;
                if (d == exclude || !Targetable(d)) continue;
                if ((ReactionSystem.CenterOf(d) - center).sqrMagnitude <= r2) results.Add(d);
            }
            return results.Count;
        }

        public bool Blocked(Vector3 from, Damageable target) =>
            !target || Combat.Blocked(from, ReactionSystem.CenterOf(target), target.GetComponent<Collider>());

        static RaycastHit[] aimHits = new RaycastHit[32];
        static readonly List<Damageable> aimNear = new();

        public Damageable AimTarget(float range, float fallbackRange)
        {
            var p = Player;
            if (!p) return null;
            var motor = p.GetComponent<PlayerMotor>();
            var eye = motor ? motor.eye : null;
            if (eye)
            {
                int n;
                while ((n = Physics.RaycastNonAlloc(eye.position, eye.forward, aimHits, range, Layers.ShotMask, QueryTriggerInteraction.Ignore)) >= aimHits.Length)
                    aimHits = new RaycastHit[aimHits.Length * 2];
                Array.Sort(aimHits, 0, n, HitDistance.Instance);
                for (int i = 0; i < n; i++)
                {
                    var c = aimHits[i].collider;
                    if (!c || c.GetComponentInParent<PlayerVitals>()) continue;
                    var hb = c.GetComponent<Hitbox>();
                    var d = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                    if (d)
                    {
                        if (Targetable(d)) return d;
                        continue; // 死掉 / 不可选中的敌人不挡准星
                    }
                    if (hb && !hb.blocksSight) continue;
                    break; // 地形挡住
                }
                Array.Clear(aimHits, 0, n);
            }
            return TacticsKit.Nearest(this, p.transform.position, fallbackRange, null, aimNear);
        }

        sealed class HitDistance : IComparer<RaycastHit>
        {
            public static readonly HitDistance Instance = new();
            public int Compare(RaycastHit a, RaycastHit b) => a.distance.CompareTo(b.distance);
        }

        public bool HasStatus(Damageable target, Element element) => EnemyStatus.Has(target, element);

        public bool Chance(float p) => ScrollKit.Chance(p);

        public int Explode(in ExplosionOptions o) => Combat.Explode(in o);

        public void SpawnProjectile(in PlayerProjectileSpec spec) => PlayerProjectile.Spawn(in spec);

        public Reaction? ApplyStatus(Damageable target, Element element, float power, in StatusApplyOpts opts) =>
            ReactionSystem.ApplyStatus(target, element, power, opts);

        public DetonateOutcome? Detonate(Damageable target, in DetonateOpts opts) => Combat.Detonate(target, opts);

        public Reaction? Trigger(Damageable target, Reaction id, in TriggerOpts opts) => Combat.TriggerReaction(target, id, opts);

        public bool Stun(Damageable target, float seconds) => EnemyStatus.Stun(target, seconds);
    }

    /// <summary>
    /// 战术秘卷的共用机制（Three.js 版 src/progression/scrolls/defsTactics.ts 的 battleBuff / onSwitch / pulse，以及 docs/scroll-tactics.md 的实现边界）：
    ///   · 接缝 <see cref="Host"/>（缺省 <see cref="GameScrollHost"/>，测试可换）；玩家活着 = 作用域的玩家活着 ∧ Host.Alive；
    ///   · 判定：武器命中 = 来源 Weapon / Melee（碎刃斩击同 TS 沿用武器；武器投射物的爆炸来源仍是 Weapon，同 TS 的 'weapon' + explosion 标签），
    ///     直接命中再要求深度 0、不是秘卷 / 词条衍生（Proc）、不是静默处决（Purge）；
    ///   · 帧号 <see cref="Frame"/>（同帧霰弹 / 穿透命中算一次：凝神装填、追猎印记）：Play 模式为 Time.frameCount，EditMode 为秘卷时钟；
    ///   · 切枪 <see cref="OnSwitch"/>：前后武器都在且 uid 不同（初始化、空槽、同一把枪的重复事件、换关恢复都不算）；
    ///   · 震击波 <see cref="Pulse"/>：玩家胸口为心，固定基础伤害 × 强度成长，半径吃爆炸范围，爆炸伤害吃爆炸伤害，深度 1、不暴击、击退 8、不伤玩家；
    ///   · 装填 <see cref="LoadFromReserve"/>：从备弹直接搬进弹匣（守恒、不超过容量、不发换弹事件）；
    ///   · 特效 / 音效（<see cref="FxRing"/> 等）只在 Play 模式下播。
    /// 限时战斗增益用 <see cref="ScrollScope.BattleBuff"/>（换关 / 阵亡清空，刷新时长不叠数值）。
    /// </summary>
    public static class TacticsKit
    {
        static IScrollHost host;

        /// <summary>秘卷碰外界的接缝（缺省 <see cref="GameScrollHost.Instance"/>）；测试设成假的，TearDown 设回 null</summary>
        public static IScrollHost Host
        {
            get => host ?? GameScrollHost.Instance;
            set => host = value;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => host = null;

        /// <summary>当前帧号（同帧去重用）：Play 模式 Time.frameCount；EditMode 用秘卷时钟（测试里每次 Step 算新的一帧）</summary>
        public static double Frame => Application.isPlaying ? Time.frameCount : ScrollTicker.Now;

        /// <summary>玩家活着：作用域绑的玩家（没有按活着）且接缝说活着</summary>
        public static bool Alive(ScrollScope s) => s != null && s.Alive && Host.Alive;

        // ───────────── 判定 ─────────────

        /// <summary>武器伤害（同 TS req.source === 'weapon'）：来源 Weapon 或近战 Melee，含武器投射物的爆炸与武器词条的衍生</summary>
        public static bool IsWeaponHit(in DamageInfo i) => i.source is DamageSource.Weapon or DamageSource.Melee;

        /// <summary>武器直接命中（同 TS isDirectWeaponHit，即 <see cref="ScrollKit.IsDirectWeaponHit"/>）：武器 / 近战、深度 0、不是衍生（Proc）、不是静默处决</summary>
        public static bool IsDirectWeaponHit(in DamageInfo i) => ScrollKit.IsDirectWeaponHit(i);

        /// <summary>英雄技能直接伤害（术法回流）：来源 Skill、深度 0、不是反应 / 衍生 / 静默处决</summary>
        public static bool IsDirectSkillHit(in DamageInfo i) =>
            i.source == DamageSource.Skill && i.depth == 0 && !DamageCalc.IsReaction(i) && !i.Has(DamageTag.Proc) && !i.Has(DamageTag.Purge);

        /// <summary>命中弱点（爆头，或被改判为弱点）</summary>
        public static bool IsWeak(in DamageInfo i) => i.weakpoint || i.forcedWeakpoint;

        // ───────────── 切枪 ─────────────

        /// <summary>
        /// 切到另一把武器时调用 fn（同 TS onSwitch）：前后都有武器、uid 不同、玩家活着。
        /// 初始化 / 换关恢复（prev 为空）、拾取替换同一把、重复派发都不算；切换碎刃近远程形态不发切枪事件，也不算。
        /// </summary>
        public static void OnSwitch(ScrollScope s, Action fn)
        {
            if (s == null || fn == null) return;
            s.OnWeaponSwitched((prev, next) =>
            {
                if (prev == null || next == null || ReferenceEquals(prev, next) || prev.uid == next.uid) return;
                if (Alive(s)) fn();
            });
        }

        // ───────────── 震击波 ─────────────

        /// <summary>
        /// 以玩家胸口（脚底 + 0.9 m）为心的击退波（同 TS pulse）：半径 = radius × 爆炸范围，伤害 = baseDamage × 强度成长（爆炸伤害由 Combat 乘），
        /// 来源 Scroll、深度 1、不暴击、击退 8、不伤玩家；不播爆炸特效，改画一圈地面波纹。返回造成伤害的敌人数
        /// </summary>
        public static int Pulse(ScrollScope s, float radius, float baseDamage, Color color)
        {
            var h = Host;
            var pos = h.Position;
            var center = pos + Vector3.up * 0.9f;
            float r = ScrollKit.BlastRadius(radius);
            var info = ScrollKit.ProcInfo(s?.Id, DamageSource.Scroll, baseDamage * ScrollKit.ProcScale(), Element.None, 1, center, Vector3.up);
            info.knockback = 8;
            var o = new ExplosionOptions(center, r, info) { noFx = true, color = color };
            int hits = h.Explode(in o);
            FxRing(new Vector3(pos.x, pos.y + 0.1f, pos.z), r, color, 0.35f);
            Sfx("skill_earth", center, 0.45f);
            return hits;
        }

        // ───────────── 弹匣 ─────────────

        /// <summary>
        /// 从备弹搬 want 发进当前弹匣（滑步装填）：不超过实际弹匣容量、实际扣除备弹，不发换弹事件。
        /// 没有武器 / 近战形态 / 已满 / 没备弹返回 0（不改任何东西）；否则返回搬了几发
        /// </summary>
        public static int LoadFromReserve(IScrollHost h, WeaponInstance w, int want)
        {
            if (h == null || w == null || want <= 0 || h.IsMelee(w)) return 0;
            int take = Mathf.Min(want, Mathf.Max(0, h.MagCapacity(w) - w.mag), Mathf.Max(0, w.reserve));
            if (take <= 0) return 0;
            w.mag += take;
            w.reserve -= take;
            return take;
        }

        /// <summary>只算能搬几发（不改弹药）：用来在消耗冷却之前判断</summary>
        public static int LoadableFromReserve(IScrollHost h, WeaponInstance w, int want)
        {
            if (h == null || w == null || want <= 0 || h.IsMelee(w)) return 0;
            return Mathf.Max(0, Mathf.Min(want, Mathf.Max(0, h.MagCapacity(w) - w.mag), Mathf.Max(0, w.reserve)));
        }

        // ───────────── 查询 ─────────────

        /// <summary>center 半径内离 center（身体中心）最近、不是 exclude 的敌人；没有为 null。buffer 是调用方给的临时表</summary>
        public static Damageable Nearest(IScrollHost h, Vector3 center, float radius, Damageable exclude, List<Damageable> buffer)
        {
            if (h == null || buffer == null) return null;
            h.Near(center, radius, exclude, buffer);
            Damageable best = null;
            float bestD = float.PositiveInfinity;
            for (int i = 0; i < buffer.Count; i++)
            {
                var d = buffer[i];
                if (!d || d.Dead || d == exclude) continue;
                float sq = (ScrollKit.BodyCenter(d) - center).sqrMagnitude;
                if (sq < bestD)
                {
                    bestD = sq;
                    best = d;
                }
            }
            buffer.Clear();
            return best;
        }

        // ───────────── 特效（只在 Play 模式） ─────────────

        /// <summary>地面扩散波纹（同 TS fx.ring）：duration 秒扩到 radius</summary>
        public static void FxRing(Vector3 at, float radius, Color color, float duration)
        {
            if (!Application.isPlaying || !(radius > 0)) return;
            Telegraph.Wave(at, radius, radius / Mathf.Max(0.05f, duration), color);
        }

        /// <summary>一团火花（同 TS fx.burst 的用途）</summary>
        public static void FxBurst(Vector3 at, float size = 1.5f)
        {
            if (!Application.isPlaying) return;
            var fx = ShotFx.Instance;
            if (fx) fx.Impact(at, Vector3.up, false, size);
        }

        /// <summary>一道电弧</summary>
        public static void FxLightning(Vector3 from, Vector3 to, Color color)
        {
            if (!Application.isPlaying) return;
            Lightning.Spawn(from, to, color);
        }

        /// <summary>音效（at 为 null 时不定位）</summary>
        public static void Sfx(string id, Vector3? at, float volume = 1, float pitch = 1)
        {
            if (!Application.isPlaying || string.IsNullOrEmpty(id)) return;
            if (at.HasValue) GameAudio.PlayAt(id, at.Value, volume, pitch);
            else GameAudio.Play(id, volume, pitch);
        }
    }
}
