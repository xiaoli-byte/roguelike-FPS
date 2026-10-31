using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 韧性（第四章受击四层，combat 1.1）：<see cref="EnemyDef.poise"/> &gt; 0 或 <see cref="EnemyDef.hitch"/> &gt; 0 的敌人生成时由 <see cref="EnemyRoster"/> 挂上。
    /// 每次受伤按 <see cref="HitReaction.PoiseDamage"/> 累计（每秒回落韧性值的一半 = 2 秒窗口），超过韧性就 <see cref="EnemyAI.HitStagger"/>；
    /// 轻怪（hitch &gt; 0）每挨一下（持续伤害除外）<see cref="EnemyAI.Hitch"/>。前三章的敌人韧性都是 0，不挂这个组件。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Poise : MonoBehaviour
    {
        /// <summary>韧性值（0 = 不硬直，只顿）</summary>
        public float poise;
        /// <summary>硬直秒数</summary>
        public float staggerSeconds = 0.6f;
        /// <summary>每挨一枪顿多久（秒）</summary>
        public float hitch;

        Damageable hp;
        EnemyAI ai;
        PoiseMeter meter;

        /// <summary>当前累计的韧性伤害</summary>
        public float Accumulated => meter.value;
        /// <summary>韧性破过几次（测试用）</summary>
        public int Breaks { get; private set; }

        /// <summary>按定义挂上（生成时、物体还停用着的时候调）；定义不需要时什么都不做</summary>
        public static Poise Attach(GameObject go, EnemyDef def)
        {
            if (!go || def == null || !(def.poise > 0 || def.hitch > 0)) return null;
            var p = go.GetComponent<Poise>() ?? go.AddComponent<Poise>();
            p.poise = def.poise;
            p.staggerSeconds = def.staggerSeconds;
            p.hitch = def.hitch;
            return p;
        }

        void Awake()
        {
            hp = GetComponent<Damageable>();
            ai = GetComponent<EnemyAI>();
            if (hp) hp.Damaged += OnDamaged;
        }

        void OnDestroy()
        {
            if (hp) hp.Damaged -= OnDamaged;
        }

        void Update()
        {
            meter.poise = poise;
            meter.Tick(Time.deltaTime);
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (r.killed || r.total <= 0 || !ai || !hp || hp.Dead) return;
            bool dot = info.source == DamageSource.Status && !info.reaction && (info.tags & DamageTag.Reaction) == 0;
            if (hitch > 0 && !dot) ai.Hitch(hitch);
            meter.poise = poise;
            if (!meter.Add(HitReaction.PoiseDamage(info, r.total))) return;
            var from = info.direction.sqrMagnitude > 1e-6f ? transform.position - info.direction.normalized * 3f : info.point;
            if (ai.HitStagger(staggerSeconds, from, HitCause.Poise)) Breaks++;
        }
    }
}
