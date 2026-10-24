using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟招式的基类：危险物集合（<see cref="BossHazards"/>）、炉心殿几何、TS 原值伤害换算（<see cref="Dmg"/>）和几样朝向 / 地面 / 玩家工具（同旱魃、B1 参考招式的写法）。
    /// 预警：地面圆 / 直线走 BossMove 的 WarnCircle / WarnLine（计 TelegraphCount）；扇形等走 BossHazards 的招式组预警，用 <see cref="CountWarning"/> 记数。
    /// 喘息：一阶段生命 70% 以下 × 0.85（TS restFactor），出招第一帧按当时的血量算。
    /// 角度一律世界 yaw（度），0 = +Z。
    /// </summary>
    public abstract class QilinMove : BossMove
    {
        BossHazards hazards;
        float baseRecovery = -1;

        protected BossHazards Hazards => hazards ? hazards : hazards = BossHazards.For(Brain);
        protected QilinBrain Qilin => Brain as QilinBrain;
        protected QilinDef QDef => Brain.Def as QilinDef;
        protected QilinFurnace Furnace => Qilin ? Qilin.Furnace : null;

        /// <summary>经 BossHazards 画的预警个数（扇形…；WarnCircle / WarnLine 记在 TelegraphCount）</summary>
        public int ExtraWarnings { get; private set; }
        /// <summary>预警合计</summary>
        public int Warned => TelegraphCount + ExtraWarnings;

        protected void CountWarning()
        {
            ExtraWarnings++;
            Brain.NotifyTelegraph(this);
        }

        /// <summary>出招第一帧：按血量定喘息，再交给子类</summary>
        protected sealed override void OnStart()
        {
            if (baseRecovery < 0) baseRecovery = recovery;
            recovery = baseRecovery * (Brain.Phase == 0 && Brain.PhaseFraction <= 0.7f ? 0.85f : 1f);
            // 俯冲三踏之后「待在地上等喘息」只管到下一招开始
            if (Qilin) Qilin.HoldGround = false;
            Prepare();
        }

        /// <summary>子类的出招第一帧</summary>
        protected virtual void Prepare() { }

        /// <summary>TS 原值伤害（难度 1 的绝对值）→ 本首领的招式伤害（含难度、狂怒）</summary>
        protected float Dmg(float tsBase) => Damage(tsBase / Mathf.Max(1f, Brain.Def != null ? Brain.Def.damage : 16f));

        protected float Floor => Qilin ? Qilin.FloorY : Brain.transform.position.y;
        protected float Facing => Brain.transform.eulerAngles.y;

        protected float YawToPlayer => YawTo(Brain.PlayerPosition);

        protected float YawTo(Vector3 p)
        {
            var d = p - Brain.transform.position;
            d.y = 0;
            return d.sqrMagnitude > 1e-4f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : Facing;
        }

        protected static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        protected void SetFacing(float yawDeg) => Brain.transform.rotation = Quaternion.Euler(0, yawDeg, 0);

        protected void TurnToward(float yawDeg, float degPerSec, float dt) => SetFacing(Mathf.MoveTowardsAngle(Facing, yawDeg, degPerSec * dt));

        protected Vector3 OnFloor(Vector3 p)
        {
            p.y = Floor;
            return p;
        }

        protected void Sfx(string id, float volume = 1f, float pitch = 1f) => Brain.PlaySfx(id, volume, pitch);

        /// <summary>玩家的脚底点（没有玩家时为首领位置）</summary>
        protected static bool PlayerFeet(out Vector3 feet) => BossHazards.PlayerBody(out feet, out _, out _);

        /// <summary>给玩家一下冲量（击退 / 掀飞）</summary>
        protected static void Push(Vector3 impulse)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var m = pv.GetComponent<PlayerMotor>();
            if (m) m.AddImpulse(impulse);
        }

        static RunRng fallbackRng;

        /// <summary>方向 / 时长的随机流（本局有种子时可复现）</summary>
        protected static RunRng Rng => RunState.Current != null ? RunState.Current.Stream("boss_qilin") : fallbackRng ??= new RunRng(System.Environment.TickCount);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;
    }
}
