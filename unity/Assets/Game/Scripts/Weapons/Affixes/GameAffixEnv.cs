using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 触发效果的游戏环境（<see cref="IAffixEnv"/>）：时间 = Time.time，随机 = UnityEngine.Random，找枪走 <see cref="AffixRuntime.Find"/>（玩家两个槽），
    /// 伤害 / 爆炸走 <see cref="Combat"/>，挂状态走 <see cref="ReactionSystem.ApplyStatus"/>（带 reactionScale），引爆 / 强制反应走 Combat 的入口，
    /// 回填弹匣同 TS WeaponSystem.refill（不超过容量，一声轻响），护盾加给 <see cref="PlayerVitals"/>。
    /// 词条衍生的伤害把出手者记成玩家的武器控制器（与直接命中一致：灵宠挂的元素不算玩家的，玩家的算）。
    /// </summary>
    public sealed class GameAffixEnv : IAffixEnv
    {
        readonly AffixRuntime host;
        readonly List<Damageable> near = new(1);

        public GameAffixEnv(AffixRuntime host) => this.host = host;

        public float Now => Time.time;
        public float Random() => UnityEngine.Random.value;
        public WeaponInstance Find(int uid) => host ? host.Find(uid) : null;
        public ResolvedWeapon Resolve(WeaponInstance w) => WeaponStatsResolver.Resolve(w);
        public StatusMask Statuses(Damageable e) => StatusesOf(e);
        public float ReactionHaste => WeaponStatsResolver.PlayerStats?.Get(Stat.ReactionHaste) ?? 0;
        public Vector3 Center(Damageable e) => ReactionSystem.CenterOf(e);

        /// <summary>敌人身上此刻的状态；已死的加上死亡瞬间的状态（状态在死后下一次更新才清空）</summary>
        public static StatusMask StatusesOf(Damageable e)
        {
            var s = EnemyStatus.Of(e);
            if (!s) return StatusMask.None;
            return e.Dead ? s.Mask | s.DiedWith : s.Mask;
        }

        public Damageable Nearest(Vector3 from, float range, Damageable exclude)
        {
            ReactionSystem.Nearest(from, range, 1, exclude, false, near);
            var d = near.Count > 0 ? near[0] : null;
            near.Clear();
            return d;
        }

        public void Refill(WeaponInstance w, int rounds)
        {
            if (w == null || rounds <= 0) return;
            int cap = WeaponStatsResolver.Resolve(w).magCap;
            if (w.mag >= cap) return;
            w.mag = Mathf.Min(cap, w.mag + rounds);
            GameAudio.Play("reload_end", 0.3f, 1.6f);
        }

        public void AddShield(float amount)
        {
            var p = PlayerVitals.Instance;
            if (p && !p.Dead && amount > 0) p.AddShield(amount);
        }

        public void Explode(in ExplosionOptions o, bool ring)
        {
            var opts = o;
            if (!opts.info.instigator) opts.info.instigator = Instigator;
            Combat.Explode(in opts);
            // 殉爆：另画一圈 0.45 s 扩散到爆炸半径的冲击波
            if (ring) Telegraph.Wave(opts.center, opts.radius, opts.radius / 0.45f, opts.color ?? Color.white);
        }

        public void Strike(Damageable target, in DamageInfo info, Vector3 from, Color tracer)
        {
            if (!target || target.Dead) return;
            var hit = info;
            if (!hit.instigator) hit.instigator = Instigator;
            ShotFx.Instance?.Tracer(from, hit.point, tracer, 0.02f);
            Combat.DamageEnemy(target, hit);
        }

        public void ApplyStatus(Damageable e, Element element, float power, in StatusApplyOpts o)
        {
            var opts = o;
            if (!opts.instigator) opts.instigator = Instigator;
            ReactionSystem.ApplyStatus(e, element, power, in opts);
        }

        public void Detonate(Damageable e, in DetonateOpts o) => Combat.Detonate(e, in o);

        public bool Trigger(Damageable e, Reaction id, in TriggerOpts o) => Combat.TriggerReaction(e, id, in o) != null;

        public void Beam(Vector3 from, Vector3 to, Color color) => Lightning.Spawn(from, to, color, 0.06f);

        Object Instigator => host ? host.Controller() : null;
    }
}
