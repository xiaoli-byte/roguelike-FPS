using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 参考招式的基类（D6：沙暴巨像、霜翼妖后、熔心魔将不移植成首领，它们的招式沉淀为 <see cref="BossHazards"/> 原语的参考实现）。
    /// 正式首领（旱魃 / 鲲鹏 / 火麒麟 / 魔将领主战）照这些写法组合危险物；参考招式本身由「危险物样机」<see cref="ReferenceBossDef"/> 装上，
    /// 冒烟套件 BossHazardsSuite 逐个强制出一次。
    /// 数值照 Three.js 原值：TS 写的是难度 1 的绝对伤害（再 × owner.damageMult），这里用 <see cref="Dmg"/> 换算成本首领的招式伤害
    /// （= TS 原值 × 难度倍率 × 狂怒倍率），所以换哪只首领装这些招式，伤害都和 TS 一致。
    /// 时间轴：TS 的 at(t) 时刻点改成「段内计数器」（<see cref="BossMove.StageT"/> 越过第 i 个时刻就做第 i 件事），掉帧也不漏。
    /// 角度一律世界 yaw（度），0 = +Z（同 TS facing = atan2(dx, dz)）。
    /// </summary>
    public abstract class ReferenceMove : BossMove
    {
        BossHazards hazards;

        /// <summary>本首领的危险物集合</summary>
        protected BossHazards Hazards => hazards ? hazards : hazards = BossHazards.For(Brain);

        /// <summary>TS 原值伤害换算成本首领的招式伤害（含难度、狂怒）</summary>
        protected float Dmg(float tsBase) => Damage(tsBase / Mathf.Max(1f, Brain.Def != null ? Brain.Def.damage : 1f));

        /// <summary>当前阶段（0 起）</summary>
        protected int Phase => Brain.Phase;

        /// <summary>首领脚下的地面高度（场地中心高度；没有场地时取首领脚下）</summary>
        protected float Floor => Brain.Arena ? Brain.Arena.FloorY : GroundY(Brain.transform.position);

        /// <summary>首领朝向（世界 yaw，度）</summary>
        protected float Facing => Brain.transform.eulerAngles.y;

        /// <summary>首领 → 目标的 yaw（度）</summary>
        protected float YawToPlayer
        {
            get
            {
                var d = Brain.PlayerPosition - Brain.transform.position;
                d.y = 0;
                return d.sqrMagnitude > 1e-4f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : Facing;
            }
        }

        /// <summary>yaw（度）→ 水平单位向量</summary>
        protected static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        /// <summary>把朝向立刻设成 yaw（度）</summary>
        protected void SetFacing(float yawDeg) => Brain.transform.rotation = Quaternion.Euler(0, yawDeg, 0);

        /// <summary>朝 yaw（度）转，角速度 degPerSec</summary>
        protected void TurnToward(float yawDeg, float degPerSec, float dt)
        {
            float cur = Facing;
            SetFacing(Mathf.MoveTowardsAngle(cur, yawDeg, degPerSec * dt));
        }

        /// <summary>(x, z) 处、参考高度 refY 附近的地面高度（打不到时 refY）</summary>
        protected static float GroundY(Vector3 p, float above = 4f) =>
            Physics.Raycast(p + Vector3.up * above, Vector3.down, out var h, above + 20f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        /// <summary>贴到地面上的点（参考高度用场地地面）</summary>
        protected Vector3 OnGround(Vector3 p)
        {
            p.y = Floor;
            p.y = GroundY(p, 30f);
            return p;
        }

        /// <summary>首领「眼睛」：头骨（代理 / 占位体的头），没有时身体中心往上 1 m</summary>
        protected Vector3 Eye
        {
            get
            {
                var head = Brain.Model?.Head;
                return head ? head.position : Brain.BodyCenter + Vector3.up;
            }
        }

        /// <summary>首领的「手」：身体中心往前 1 m、往上 0.3 × 身高，左右交替</summary>
        protected Vector3 Hand(bool right)
        {
            var t = Brain.transform;
            var cap = Brain.GetComponent<CapsuleCollider>();
            float h = cap ? cap.height * Mathf.Abs(t.lossyScale.y) : 4f;
            return Brain.BodyCenter + t.forward * (Brain.BodyRadius + 0.6f) + Vector3.up * h * 0.3f + t.right * (right ? 1f : -1f) * Brain.BodyRadius;
        }

        /// <summary>从 from 沿水平方向 dir 走到场地边界（留 margin）的距离；没有场地时 fallback</summary>
        protected float ToEdge(Vector3 from, Vector3 dir, float margin, float fallback = 30f) =>
            Brain.Arena ? Brain.Arena.DistanceToEdge(from, dir, margin) : fallback;

        /// <summary>首领发一颗弹（伤害已是最终值）</summary>
        protected void Shoot(Vector3 from, Vector3 dir, float speed, float damage, Color color, string visual, float radius = 0.28f, float lifetime = 2.8f,
            float scale = 1.2f, Element element = Element.None)
        {
            if (dir.sqrMagnitude < 1e-6f) return;
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, dir.normalized * speed, damage, radius, lifetime)
            {
                color = color, visual = visual, scale = scale, element = element, source = Brain, blockable = true,
            });
        }

        protected void Sfx(string id, float volume = 1f, float pitch = 1f) => Brain.PlaySfx(id, volume, pitch);

        static RunRng fallbackRng;

        /// <summary>落点 / 方向的随机流（本局有种子时可复现）</summary>
        protected static RunRng Rng => RunState.Current != null ? RunState.Current.Stream("boss_ref") : fallbackRng ??= new RunRng(System.Environment.TickCount);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;
    }
}
