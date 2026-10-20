using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 爆焰（Three.js 版 defsReaction.ts rx_tf_scatter）：直接引发的「焚雷」爆炸时向四周溅出 3 枚火星（0.3 s 内置冷却），
    /// 各在落点 2 米内造成每层 18 点火焰伤害（× 强度成长），50% 概率附加灼烧。火星：抛物线（重力 16）、1.2 s 到期即炸、不暴击、深度 +1。
    /// 出生点推到中心敌人身体之外，免得一出膛就撞上它原地爆开。
    /// </summary>
    [Defs(511)]
    public sealed class RxTfScatter : ScrollDef
    {
        public const int Sparks = 3;
        static readonly Color SparkColor = Hex.Rgb(0xffa040);

        public RxTfScatter()
        {
            id = "rx_tf_scatter";
            name = "爆焰";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "元素", "反应", "焚雷", "爆炸" };
            description = "「焚雷」爆炸时向四周溅出 3 枚火星，各在落点 2 米内造成每层 18 点火焰伤害（随关卡强度成长），50% 概率附加灼烧。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnReacted((in ReactionEvent ev) =>
            {
                if (ev.id != Reaction.Thunderfire || ev.depth != 0 || !s.Ready("sc", 0.3f)) return;
                var o = ev.point;
                float push = (ev.enemy && !ev.enemy.Dead ? ReactionScrollKit.Radius(ev.enemy) : 0) + 0.25f;
                float dmg = 18 * n * ScrollKit.ProcScale();
                var rng = ScrollKit.Rng;
                var h = TacticsKit.Host;
                float a0 = rng.Range(0, Mathf.PI * 2);
                for (int i = 0; i < Sparks; i++)
                {
                    float a = a0 + i * Mathf.PI * 2 / Sparks + rng.Range(-0.4f, 0.4f);
                    var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                    float speed = rng.Range(4f, 6f);
                    var vel = new Vector3(dir.x * speed, rng.Range(6f, 8f), dir.z * speed);
                    var p = o + dir * push + Vector3.up * 0.3f;
                    var info = ScrollKit.ProcInfo(id, DamageSource.Scroll, dmg, Element.Fire, ev.depth + 1, p, dir);
                    info.statusChance = 0.5f;
                    var spec = new PlayerProjectileSpec(p, vel, info, 0.12f, 1.2f)
                    {
                        gravity = 16, explosionRadius = 2, visual = ProjectileVisuals.Fallback, scale = 0.6f, color = SparkColor,
                    };
                    h.SpawnProjectile(in spec);
                }
                s.Proc();
            });
        }
    }
}
