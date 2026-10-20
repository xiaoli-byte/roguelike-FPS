using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英词缀的定义（Three.js 版 src/enemies/Affixes.ts 的 AffixId / AFFIX_NAMES / AFFIX_COLORS + createAffix；docs/unity-parity.md 3.7、EN4）：
    /// 每种词缀一个文件 Enemies/Affixes/EliteAffix_&lt;Name&gt;.cs（[Defs] 的非抽象子类，由 <see cref="Registry{T}"/> 收集），
    /// 只描述「是什么」——id、显示名、颜色、说明；每只带词缀的精英由 <see cref="Create"/> 造一个自己的 <see cref="EliteAffixController"/>，
    /// 管数值、外观与死亡效果。注意和武器词条（Weapons/Affixes 的 AffixDef）是两回事。
    /// </summary>
    public abstract class EliteAffix : IDef
    {
        /// <summary>词缀 id（swift / shielded / volatile / frenzied…，遭遇的 WaveEntry.affix、EncounterSpec.squadAffix 写的就是它）</summary>
        public abstract string Id { get; }
        /// <summary>显示名（名字前缀「精英·迅捷 跳鼠刀兵」、头顶血条的词缀标签）</summary>
        public abstract string Name { get; }
        /// <summary>词缀色（外观、精英金环里的内圈）</summary>
        public abstract Color Color { get; }
        /// <summary>一句话说明（图鉴 / 提示）</summary>
        public virtual string Hint => "";

        /// <summary>给一只敌人造一个控制器（每只一个，不共享状态）</summary>
        public abstract EliteAffixController Create();
    }

    /// <summary>
    /// 词缀装到的那只敌人（控制器只通过它读写，EditMode 测试可以不经 EnemyAI 直接拼一个）：
    /// 受伤体（护盾 / 生命）、加成登记（移速 / 攻速 / 伤害走 <see cref="EnemyBuffs"/> 的通道）、身体（着色通道，可为空）、根节点、设计尺寸、伤害倍率。
    /// </summary>
    public sealed class EliteHost
    {
        public Damageable hp;
        public EnemyBuffs buffs;
        public EnemyBody body;
        public Transform transform;
        public EnemyAI ai;
        /// <summary>设计尺寸（放大前，根节点的缩放会再乘上去）：身体半径、身高</summary>
        public float radius = 0.4f, height = 1.8f;
        /// <summary>没有 AI 时用的伤害倍率（测试）</summary>
        public float damageMult = 1f;

        /// <summary>当前伤害倍率（等级 × 精英 × 光环；没有 AI 时取 <see cref="damageMult"/>）</summary>
        public float DamageMult => ai ? ai.DamageMult : damageMult;

        public bool Alive => hp && !hp.Dead;

        /// <summary>从一只已经生成好的敌人拼出来（设计尺寸取名册定义）</summary>
        public static EliteHost Of(EnemyAI ai)
        {
            var def = ai ? EnemyRoster.Get(ai.enemyId) : null;
            return new EliteHost
            {
                ai = ai, hp = ai ? ai.Health : null, buffs = ai ? ai.Buffs : null, body = ai ? ai.Body : null, transform = ai ? ai.transform : null,
                radius = def?.radius ?? 0.4f, height = def?.height ?? 1.8f,
            };
        }

        /// <summary>根节点局部（设计尺寸）的点 → 世界</summary>
        public Vector3 Local(float x, float y, float z) => transform ? transform.TransformPoint(new Vector3(x, y, z)) : new Vector3(x, y, z);

        /// <summary>身体中心（世界）</summary>
        public Vector3 Center => ai ? EnemyRegistry.Center(ai) : Local(0, height * 0.5f, 0);
    }

    /// <summary>
    /// 一只精英身上的词缀运行时（TS AffixController）：装上时改数值 / 挂外观（<see cref="Install"/>），每帧 <see cref="Tick"/>，
    /// 受伤 <see cref="OnDamaged"/>，死亡（清场除外）<see cref="OnDeath"/>，回收 <see cref="Dispose"/>。
    /// 外观只在 Play 里建（EditMode 测试只跑数值）。由 <see cref="EliteAffixRuntime"/> 驱动。
    /// </summary>
    public abstract class EliteAffixController
    {
        public EliteAffix Affix { get; internal set; }
        public EliteHost Host { get; private set; }

        /// <summary>装到 host 上（数值立刻生效）</summary>
        public void Install(EliteHost host)
        {
            Host = host ?? throw new ArgumentNullException(nameof(host));
            OnInstall();
        }

        protected abstract void OnInstall();

        /// <summary>每帧（活着时）：dt 秒、当前时刻 now</summary>
        public virtual void Tick(float dt, float now) { }

        public virtual void OnDamaged(in DamageInfo info, in DamageResult r, float now) { }

        /// <summary>死亡（清场 / 静默处决不调）</summary>
        public virtual void OnDeath(in DamageInfo info) { }

        /// <summary>回收：撤掉加成、销毁外观</summary>
        public virtual void Dispose()
        {
            Host?.buffs?.RemoveSource(this);
            ClearOverlay();
        }

        // ───────────── 外观小工具（只在 Play 里） ─────────────

        /// <summary>挂在根节点下的光晕片（设计尺寸的局部位置；尺寸是世界米）</summary>
        protected Transform Glow(Vector3 local, float size, Color c)
        {
            if (!Application.isPlaying || Host?.transform == null) return null;
            var t = FxMaterials.GlowSprite(Host.transform, size / Mathf.Max(1e-3f, Host.transform.lossyScale.x), c);
            t.localPosition = local;
            t.gameObject.layer = Layers.IgnoreRaycast;
            return t;
        }

        protected static void Kill(Transform t)
        {
            if (!t) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(t.gameObject);
            else UnityEngine.Object.DestroyImmediate(t.gameObject);
        }

        protected static void Tint(Transform t, Color c)
        {
            if (t) FxMaterials.Tint(t.GetComponent<Renderer>(), c);
        }

        /// <summary>词缀的覆盖色通道（「affix」）：身上泛一层词缀色</summary>
        protected void Overlay(Color c, float amount)
        {
            if (Host != null && Host.body) Host.body.SetOverlay("affix", c, amount);
        }

        protected void ClearOverlay()
        {
            if (Host != null && Host.body) Host.body.ClearOverlay("affix");
        }
    }
}
