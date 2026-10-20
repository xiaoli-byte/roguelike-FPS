using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一只精英身上的词缀（<see cref="EliteAffixes.Dress"/> 挂上）：活着时每帧推进控制器，转发受伤；死亡时（清场 / 静默处决除外）触发死亡效果，
    /// 之后不再推进；物体销毁时回收控制器（撤加成、销毁外观）。<see cref="EnemyBars.AffixOf"/> 读 <see cref="AffixId"/>
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EliteAffixRuntime : MonoBehaviour
    {
        Damageable hp;
        bool dead;

        public string AffixId { get; private set; }
        public EliteAffix Affix { get; private set; }
        public EliteAffixController Controller { get; private set; }

        internal void Install(EnemyAI ai, EliteAffix affix)
        {
            Affix = affix;
            AffixId = affix.Id;
            hp = ai.Health;
            Controller = EliteAffixes.Attach(EliteHost.Of(ai), affix.Id);
            if (!hp) return;
            hp.Damaged += OnDamaged;
            hp.Died += OnDied;
        }

        void Update()
        {
            if (dead || Controller == null) return;
            Controller.Tick(Time.deltaTime, Time.time);
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (dead || Controller == null) return;
            Controller.OnDamaged(info, r, Time.time);
        }

        void OnDied(DamageInfo info)
        {
            if (dead) return;
            dead = true;
            if (Controller == null || EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            Controller.OnDeath(info);
        }

        void OnDestroy()
        {
            if (hp)
            {
                hp.Damaged -= OnDamaged;
                hp.Died -= OnDied;
            }
            Controller?.Dispose();
            Controller = null;
        }
    }
}
