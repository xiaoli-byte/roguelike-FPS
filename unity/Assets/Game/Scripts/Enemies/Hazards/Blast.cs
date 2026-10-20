using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌方爆炸 / 冲击的公共结算（Three.js 版 src/enemies/Hazards.ts 的 blastPlayer，以及连环爆对其他敌人的那一下）：
    ///   <see cref="Player"/>：球形爆炸对玩家——伤害按爆心到玩家胶囊（脚底到头顶）表面的距离线性衰减到边缘 edge；胸口和眼睛两点都被墙挡住时不受伤；
    ///     冲刺无敌 / 无敌期间整个不影响（不扣血也不被掀开，同 <see cref="Combat.BlastPlayer"/>）；
    ///     命中时把玩家向外推：水平 knock × k、向上 knock × 0.45 × k（米/秒，k = 衰减系数，同 TS）；
    ///     远处也震一下：shake × (1 − 爆心到胸口距离 / (半径 × 3.2))，0.35 s（同 TS fx.shake），不管有没有打到。
    ///   <see cref="Enemies"/>：对其他敌人的爆炸——走玩家方伤害管线（<see cref="Combat.Explode(in ExplosionOptions)"/>：算玩家战果、带爆炸标签、
    ///     不暴击、深度 1、伤害和击退按距离衰减、墙后不受伤），不播爆炸特效（外观由调用方负责）。
    ///   <see cref="Shake"/>：以某点为中心、按水平距离衰减的震屏（<see cref="CameraShake.Quake"/>）。
    /// 边缘比例 edge 是 Unity 的约定（边缘剩多少）：TS 的 falloff = 1 − edge（TS falloff 0.5 → edge 0.5，镇墓兽踏地 falloff 0.3 → edge 0.7）。
    /// </summary>
    public static class Blast
    {
        /// <summary>震屏时长、震屏距离（× 半径）、向上冲量占水平冲量的比例（同 TS）</summary>
        public const float ShakeTime = 0.35f, ShakeRange = 3.2f, KnockUp = 0.45f;

        /// <summary>
        /// 爆炸波及玩家，返回实际扣除量。damage 是爆心处的伤害（已含等级 / 精英倍率）；source = 出手者（受伤修饰器、PlayerHit 事件里的 source）。
        /// </summary>
        public static float Player(Vector3 center, float radius, float damage, Element element = Element.None, Object source = null,
            float edge = 0.5f, float shake = 0.6f, float knock = 5.5f)
        {
            var p = PlayerVitals.Instance;
            if (!p || !(radius > 0) || float.IsInfinity(radius) || !float.IsFinite(center.x + center.y + center.z)) return 0;
            var pos = p.transform.position;
            var cc = p.GetComponent<CharacterController>();
            float r = cc ? cc.radius : 0.35f, h = cc ? cc.height : 1.8f;
            float feet = cc ? pos.y + cc.center.y - h * 0.5f : pos.y;
            var chest = new Vector3(pos.x, feet + Mathf.Min(1.1f, h * 0.6f), pos.z);
            if (shake > 0) CameraShake.Add(shake * Mathf.Clamp01(1 - Vector3.Distance(center, chest) / (radius * ShakeRange)), ShakeTime);
            if (p.Dead || !(damage > 0)) return 0;
            // 胶囊轴线上离爆心最近的点 → 到胶囊表面的距离
            var axis = new Vector3(pos.x, Mathf.Clamp(center.y, feet + r, feet + Mathf.Max(r, h - r)), pos.z);
            float surf = Mathf.Max(0, Vector3.Distance(axis, center) - r);
            if (surf > radius) return 0;
            var motor = p.GetComponent<PlayerMotor>();
            var eye = motor && motor.eye ? motor.eye.position : new Vector3(pos.x, feet + h * 0.9f, pos.z);
            if (!Combat.LineClear(chest, center) && !Combat.LineClear(eye, center)) return 0;
            if (p.Invulnerable) return 0;
            float k = Falloff(surf, radius, edge);
            // 冲击方向先算好：DamagePlayer 会同步派发受伤事件，监听者可能重入
            var dir = new Vector3(axis.x - center.x, 0, axis.z - center.z);
            float flat = dir.magnitude;
            dir = flat > 1e-3f ? dir / flat : Vector3.zero;
            float dealt = Combat.DamagePlayer(damage * k, center, element, source);
            if (!p.Dead && motor && knock > 0) motor.AddImpulse(new Vector3(dir.x * knock * k, knock * KnockUp * k, dir.z * knock * k));
            return dealt;
        }

        /// <summary>距离衰减：爆心 1 → 半径处 edge（线性，距离夹到 [0, 半径]）</summary>
        public static float Falloff(float distance, float radius, float edge)
        {
            if (!(radius > 0)) return 1;
            return 1 - (1 - Mathf.Clamp01(edge)) * Mathf.Clamp01(distance / radius);
        }

        /// <summary>
        /// 对其他敌人的爆炸（不伤玩家、不播特效），返回造成了伤害的敌人数。baseDamage 是爆心处的伤害（已含等级 / 精英倍率），knockback 是爆心处的击退（米/秒）。
        /// exclude：不吃这次爆炸的（爆炸的主人、正被连锁引爆的同类）；instigator：出手者（伤害请求里的 instigator）。
        /// </summary>
        public static int Enemies(Vector3 center, float radius, float baseDamage, float knockback, float edge = 0.5f,
            ICollection<Damageable> exclude = null, Object instigator = null, Element element = Element.None)
        {
            if (!(radius > 0) || !(baseDamage > 0)) return 0;
            var info = DamageInfo.Simple(baseDamage, DamageSource.Explosion, center, Vector3.up);
            info.noCrit = true;
            info.depth = 1;
            info.knockback = Mathf.Max(0, knockback);
            info.element = element;
            info.instigator = instigator;
            var o = new ExplosionOptions(center, radius, info) { falloff = edge, noFx = true, exclude = exclude };
            return Combat.Explode(in o);
        }

        /// <summary>以 at 为中心的震屏：玩家水平距离越远越弱，range 米外没有</summary>
        public static void Shake(Vector3 at, float strength, float range, float duration = 0.3f) => CameraShake.Quake(at, strength, range, duration);
    }
}
