using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 命中 / 击杀的声音反馈（Three.js 版 src/combat/Feedback.ts 的 hitSound / breakSound / killSound）：
    ///   命中：按第一层吃到伤害的层出声（护盾 hit_shield / 护甲 hit_armor / 生命 hit），暴击 hit_crit；每帧最多 2 声、同 id 至少隔 0.03 s
    ///   破层：护盾 / 护甲这一击被打穿，在敌人身上再响一声更低沉的
    ///   击杀：kill（精英更重）+ 敌人身上的 enemy_death
    /// 持续伤害（灼烧 / 蚀化跳伤）不出命中声（它们有自己的跳伤声，见 EnemyStatus）。
    /// </summary>
    public static class CombatSounds
    {
        const int MaxHitsPerFrame = 2;
        const float SameGap = 0.03f;

        static bool hooked;
        static int frame = -1, hits, crits, kills;
        static float lastHit, lastCrit, lastShield, lastArmor;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Reset() => hooked = false;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Hook()
        {
            if (hooked) return;
            hooked = true;
            Combat.EnemyDamaged += OnDamaged;
            Combat.EnemyKilled += OnKilled;
        }

        static void Sync()
        {
            if (frame == Time.frameCount) return;
            frame = Time.frameCount;
            hits = crits = kills = 0;
        }

        static void OnDamaged(Damageable target, DamageInfo info, DamageResult r)
        {
            if (!target || r.total <= 0) return;
            if (info.source == DamageSource.Status && !info.reaction) return;
            if (info.source == DamageSource.Enemy) return;
            Sync();
            var at = PlayerProjectile.Center(target);
            // 破层：这一击把护盾 / 护甲打空了
            if (r.shield > 0 && target.shield <= 0 && target.maxShield > 0) GameAudio.PlayAt("hit_shield", at, 0.95f, 0.7f);
            else if (r.armor > 0 && target.armor <= 0 && target.maxArmor > 0) GameAudio.PlayAt("hit_armor", at, 0.95f, 0.7f);
            if (hits >= MaxHitsPerFrame) return;
            float now = Time.unscaledTime;
            float pet = info.source == DamageSource.Pet ? 0.6f : 1f;
            if (r.crit)
            {
                if (crits >= 1 || now - lastCrit < SameGap) return;
                lastCrit = now;
                crits++;
                hits++;
                GameAudio.Play("hit_crit", 0.8f * pet, 0.96f + Random.value * 0.08f);
                return;
            }
            string id = r.shield > 0 ? "hit_shield" : r.armor > 0 ? "hit_armor" : "hit";
            ref float last = ref (id == "hit_shield" ? ref lastShield : ref id == "hit_armor" ? ref lastArmor : ref lastHit);
            if (now - last < SameGap) return;
            last = now;
            hits++;
            GameAudio.Play(id, 0.55f * pet, 0.93f + Random.value * 0.14f);
        }

        static void OnKilled(Damageable target, DamageInfo info)
        {
            if (!target) return;
            Sync();
            GameAudio.PlayAt("enemy_death", PlayerProjectile.Center(target));
            if (kills >= 1 || target.noReward) return;
            kills++;
            bool big = target.elite;
            GameAudio.Play("kill", big ? 1f : 0.8f, big ? 0.85f : 0.97f + Random.value * 0.06f);
        }
    }
}
