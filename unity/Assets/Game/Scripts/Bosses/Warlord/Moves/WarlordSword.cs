using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将 · 剑士化 v2（docs/art/vfx/warlord.md 第 13 章）的共用常量与判定几何。
    ///   · 片段里出手事件的位置（art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py 生成，EditMode 测试 WarlordVfxTests 对 events.json 守着）：
    ///     招式按「出手事件在片段里的位置」把片段拉伸到实际时间轴（<see cref="WarlordBrain.Act"/> 的 ActScale），刀到 / 收刀 / 剑气出手那一帧和判定同一帧；
    ///   · 狂怒熔铜长刃的射程倍率；
    ///   · 判定几何是纯函数（EditMode 测试 WarlordSwordTests 守着）：扇形、长条、环带，都按玩家胶囊半径放宽，脚底高差在 [−down, up]。
    /// </summary>
    public static class WarlordSword
    {
        /// <summary>连斩每一刀（slashA / slashB / slashUp / slashC，25 帧）的刀到在第 15 帧</summary>
        public const float SlashHitAt = 15f / 25f;
        /// <summary>居合 iai（48 帧）：第 24 帧拔刀突进、第 36 帧收刀「咔」= 刀光现形（hit）</summary>
        public const float IaiDashAt = 24f / 48f, IaiHitAt = 36f / 48f;
        /// <summary>一道竖剑气 waveSlash（30 帧）：第 19 帧出手</summary>
        public const float WaveHitAt = 19f / 30f;
        /// <summary>横竖两刀 waveCross（40 帧）：第 15 帧横斩出横剑气（hit）、第 23 帧竖劈出竖剑气（impact）</summary>
        public const float CrossHitAt = 15f / 40f, CrossImpactAt = 23f / 40f;
        /// <summary>突刺收刀横斩 thrustCut（27 帧）：第 12 帧刀到</summary>
        public const float ThrustCutHitAt = 12f / 27f;
        /// <summary>回旋斩 spin（36 帧）：第 18 帧刀扫过正前方；二连 spinTwice（54 帧）：第 18 / 32 帧</summary>
        public const float SpinHitAt = 18f / 36f;
        public const float SpinTwiceHitAt = 18f / 54f, SpinTwiceImpactAt = 32f / 54f;

        /// <summary>狂怒熔铜长刃：刀光、剑气、回旋的射程倍率</summary>
        public const float FuryReach = 1.15f;
        /// <summary>居合突进用时（秒）</summary>
        public const float IaiDash = 0.14f;

        public static readonly Color Warn = WarlordRef.Warn, Fire = WarlordRef.Fire;

        public static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        public static float Yaw(Vector3 dir) => Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;

        /// <summary>
        /// 扇形判定：玩家脚底离 origin 水平距离 ≤ radius + 玩家半径的一半、方位偏离 ≤ 半角 + 玩家半径对应的角度、脚底高差在 [−down, up]
        /// （同参考连斩的写法：预警画多大，判定就多大）
        /// </summary>
        public static bool InSector(Vector3 origin, float yawDeg, float halfDeg, float radius, Vector3 feet, float pr, float up, float down = 1.5f)
        {
            float dx = feet.x - origin.x, dz = feet.z - origin.z, dy = feet.y - origin.y;
            if (dy > up || dy < -down) return false;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d > radius + pr * 0.5f) return false;
            if (d < 0.05f) return true;
            float off = Mathf.Abs(Mathf.DeltaAngle(yawDeg, Mathf.Atan2(dx, dz) * Mathf.Rad2Deg));
            return off <= halfDeg + Mathf.Atan2(pr, Mathf.Max(0.5f, d)) * Mathf.Rad2Deg;
        }

        /// <summary>长条判定：from 沿水平方向 dir 长 length、半宽 halfWidth（+ 玩家半径），脚底高差在 [−down, up]</summary>
        public static bool InLane(Vector3 from, Vector3 dir, float length, float halfWidth, Vector3 feet, float pr, float up, float down = 1.5f)
        {
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-6f) return false;
            dir.Normalize();
            var r = feet - from;
            if (r.y > up || r.y < -down) return false;
            r.y = 0;
            float along = Vector3.Dot(r, dir);
            if (along < -pr || along > length + pr) return false;
            float side = Mathf.Abs(r.x * dir.z - r.z * dir.x);
            return side <= halfWidth + pr;
        }

        /// <summary>环带判定：水平距离在 [inner − 玩家半径, outer + 玩家半径]，脚底高差在 [−down, up]</summary>
        public static bool InRing(Vector3 center, float inner, float outer, Vector3 feet, float pr, float up, float down = 1.5f)
        {
            float dy = feet.y - center.y;
            if (dy > up || dy < -down) return false;
            float dx = feet.x - center.x, dz = feet.z - center.z, d = Mathf.Sqrt(dx * dx + dz * dz);
            return d >= inner - pr && d <= outer + pr;
        }

        /// <summary>
        /// 飞行剑气这一帧扫过的范围：剑气前沿从 s0 走到 s1（沿 dir），宽 halfWidth、离地 [floor − 1.5, floor + top]；
        /// 玩家胶囊和这一段扫过的长方体相交即算（横剑气 top 低：跳得过；竖剑气窄而高：侧移躲）
        /// </summary>
        public static bool WaveSweeps(Vector3 origin, Vector3 dir, float s0, float s1, float halfWidth, float floorY, float top, Vector3 feet, float pr)
        {
            float dy = feet.y - floorY;
            if (dy > top || dy < -1.5f) return false;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-6f) return false;
            dir.Normalize();
            var r = feet - origin;
            r.y = 0;
            float along = Vector3.Dot(r, dir);
            if (along < s0 - pr - 0.35f || along > s1 + pr) return false;
            return Mathf.Abs(r.x * dir.z - r.z * dir.x) <= halfWidth + pr;
        }
    }

    /// <summary>
    /// 剑士化 v2 招式的基类：动作导演走 <see cref="Lord"/>（片段照放，不受特效对照开关影响），出手特效走 <see cref="LordFx"/>
    /// （<see cref="WarlordBrain.LegacyFx"/> 或危险物样机时为 null，退回通用刀光）。狂怒（20%）后熔铜长刃：射程 × <see cref="WarlordSword.FuryReach"/>
    /// </summary>
    public abstract class WarlordSwordMove : ReferenceMove
    {
        /// <summary>魔将的大脑（动作导演）；样机 / 代理首领上为 null</summary>
        protected WarlordBrain Lord => Brain as WarlordBrain;
        /// <summary>出手特效（领主战）；对照开关打开时 null</summary>
        protected WarlordBrain LordFx => WarlordRef.Lord(Brain);
        /// <summary>狂怒：熔铜长刃、剑气变多、节奏压缩</summary>
        protected bool Fury => Brain.Enraged || Phase >= 2;
        protected float Reach => Fury ? WarlordSword.FuryReach : 1f;

        protected void Act(string state, float seconds) => Lord?.Act(state, seconds);

        /// <summary>交叉淡入（上一段片段可能正在退回待机时：连招里紧接着的下一段）</summary>
        protected void ActCrossfade(string state, float seconds) => Lord?.ActCrossfade(state, seconds);

        /// <summary>玩家胶囊（脚底、半径）；没有玩家或已倒下返回 false</summary>
        protected static bool Player(out Vector3 feet, out float pr)
        {
            var pv = PlayerVitals.Instance;
            feet = default;
            pr = 0.35f;
            return pv && !pv.Dead && BossHazards.PlayerBody(out feet, out pr, out _);
        }

        /// <summary>打中玩家：扣血 + 冲量（米/秒）。返回是否真的扣到了（冲刺无敌、无敌帧算没中）</summary>
        protected bool Strike(float damage, Vector3 from, Vector3 impulse)
        {
            if (Hazards.Hurt(damage, Element.Fire, from) <= 0) return false;
            var pv = PlayerVitals.Instance;
            var motor = pv ? pv.GetComponent<PlayerMotor>() : null;
            if (motor && impulse.sqrMagnitude > 0.01f) motor.AddImpulse(impulse);
            return true;
        }

        /// <summary>地面上的起点（场地地面高度）</summary>
        protected Vector3 Feet
        {
            get
            {
                var p = Brain.transform.position;
                p.y = Floor;
                return p;
            }
        }
    }
}
