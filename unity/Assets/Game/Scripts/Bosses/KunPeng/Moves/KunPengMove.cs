using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏招式的基类：危险物集合（<see cref="BossHazards"/>）、冰窟几何、动作触发、伤害换算和几样地面 / 朝向工具（同 B1 参考招式与旱魃招式的写法）。
    /// 数值照 Three.js KunPeng.ts 原值：TS 写的是难度 1 的绝对伤害，<see cref="Dmg"/> 换算成本首领的招式伤害（含难度、狂怒）。
    /// 预警：地面圆 / 直线走 BossMove 的 WarnCircle / WarnLine（计 TelegraphCount）；扇形、长条、持续区、抛射落点走 BossHazards，用 <see cref="Warned"/> 记数。
    /// 时间轴：TS 的 at(t) 拆成前摇 / 出手 / 收招三段（每招的注释写了对照），段内时刻用 StageAt。角度一律世界 yaw（度），0 = +Z。
    /// </summary>
    public abstract class KunPengMove : BossMove
    {
        BossHazards hazards;
        static RunRng fallbackRng;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;

        protected BossHazards Hazards => hazards ? hazards : hazards = BossHazards.For(Brain);
        protected KunPengBrain KP => Brain as KunPengBrain;
        protected KunPengDef KDef => Brain.Def as KunPengDef;
        protected IceHoleInfo Hole => KP ? KP.Hole : IceHoleInfo.Fallback(Brain.Arena, Brain.transform.position);
        protected float Floor => Hole.FloorY;

        /// <summary>经 BossHazards 画的预警个数（扇形、长条、持续区、抛射落点；BossMove 自己的 WarnCircle / WarnLine 记在 TelegraphCount）</summary>
        public int ExtraWarnings { get; private set; }
        /// <summary>预警合计</summary>
        public int Warned => TelegraphCount + ExtraWarnings;

        /// <summary>记一个经 BossHazards 画的预警（同时让首领派发 MoveTelegraphed）</summary>
        protected void CountWarning()
        {
            ExtraWarnings++;
            Brain.NotifyTelegraph(this);
        }

        /// <summary>TS 原值伤害换算成本首领的招式伤害（含难度、狂怒）</summary>
        protected float Dmg(float tsBase) => Damage(tsBase / Mathf.Max(1f, Brain.Def != null ? Brain.Def.damage : 1f));

        /// <summary>播一个动作，拉伸到 seconds 秒播完（act_ 触发器或交叉淡入，见 <see cref="KunPengBrain.Act"/>）</summary>
        protected void Act(string state, float seconds)
        {
            if (KP) KP.Act(state, seconds);
            else Brain.PlayAct(state, seconds);
        }

        protected void Sfx(string id, float volume = 1f, float pitch = 1f) => Brain.PlaySfx(id, volume, pitch);

        /// <summary>片段的事件叠加表里已经有这个音效时（正式模型）不再手动播，见 <see cref="KunPengBrain.ClipsDriveSfx"/></summary>
        protected void CuedSfx(string id, float volume = 1f, float pitch = 1f)
        {
            if (KP && KP.ClipsDriveSfx) return;
            Brain.PlaySfx(id, volume, pitch);
        }

        protected static Vector3 Dir(float yawDeg) => KunPengMath.Dir(yawDeg);

        /// <summary>同一水平位置，高度放到环台地面</summary>
        protected Vector3 AtFloor(Vector3 p)
        {
            p.y = Floor;
            return p;
        }

        /// <summary>方向 / 落点的随机流（本局有种子时可复现）</summary>
        protected RunRng Rng => KP ? KP.Rng : RunState.Current != null ? RunState.Current.Stream("boss_kunpeng") : fallbackRng ??= new RunRng(System.Environment.TickCount);

        /// <summary>玩家的脚底点（没有玩家 / 已阵亡返回 false）</summary>
        protected static bool PlayerFeet(out Vector3 feet)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead)
            {
                feet = default;
                return false;
            }
            return BossHazards.PlayerBody(out feet, out _, out _);
        }

        /// <summary>首领模型上的一根骨骼的位置（包含匹配）；没有时用 fallback</summary>
        protected Vector3 BonePos(string bone, Vector3 fallback)
        {
            var t = Brain.Model?.FindBone(bone);
            return t ? t.position : fallback;
        }
    }
}
