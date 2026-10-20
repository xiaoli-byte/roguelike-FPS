using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 疾影破军（传说，Three.js 版 defsTactics.ts tac_dash_capstone）：冲刺蓄能（冷却 4 秒），3 秒内首次武器直接命中（造成伤害、不是静默处决）
    /// 在命中点引发 3 米（× 爆炸范围）爆炸，伤害 = 该次实际伤害 × 70%（物理、来源 Scroll、深度 1、不暴击，吃爆炸伤害）。
    /// 爆炸之前先消费蓄能：爆炸派发的嵌套命中（深度 1）本来就不算直接命中，也不会再次触发。换关 / 阵亡清空蓄能。
    /// </summary>
    [Defs(618)]
    public sealed class TacDashCapstone : ScrollDef
    {
        public const float PrimeSeconds = 3f, PrimeCooldown = 4f, Radius = 3f, Ratio = 0.7f;
        static readonly Color BlastColor = Hex.Rgb(0xb7eaff);

        public TacDashCapstone()
        {
            id = "tac_dash_capstone";
            name = "疾影破军";
            rarity = 4;
            maxStacks = 1;
            tags = new[] { "传说", "机动", "爆炸" };
            description = "冲刺后 3 秒内首次武器直接命中引发 3 米爆炸，造成该次伤害 70% 的物理伤害，范围受爆炸范围加成影响；蓄能冷却 4 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            float until = float.NegativeInfinity;
            s.OnStageLoaded(_ => until = float.NegativeInfinity);
            s.OnPlayerDied(() => until = float.NegativeInfinity);
            s.OnPlayerDashed(_ =>
            {
                if (TacticsKit.Alive(s) && s.Ready("prime", PrimeCooldown)) until = s.Now + PrimeSeconds;
            });
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (!TacticsKit.Alive(s) || s.Now >= until || !TacticsKit.IsDirectWeaponHit(e.info) || !(e.result.total > 0)) return;
                until = float.NegativeInfinity; // 先消费蓄能，避免爆炸派发的嵌套命中再次触发
                var d = e.enemy;
                var center = e.info.point != Vector3.zero || !d ? e.info.point : ScrollKit.BodyCenter(d);
                var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, e.result.total * Ratio, Element.None, 1, center, e.info.direction);
                var o = new ExplosionOptions(center, ScrollKit.BlastRadius(Radius), info) { color = BlastColor };
                TacticsKit.Host.Explode(in o);
                s.Proc();
            });
        }
    }
}
