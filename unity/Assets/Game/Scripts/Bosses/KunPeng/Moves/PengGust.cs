using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹏 · 扇翼狂风（Three.js KunPeng.ts 'gust'，5.8 s；化鹏后的第一招）：
    ///   前摇 2.0 s：飞到冰窟上空（12.5 m）蓄力（act_gust）；前摇一开始环台外缘就亮起一圈冻风带的预警（<see cref="BossHazards.Zone"/>：r 外缘 − 5 … 外缘 + 1，
    ///     预警 = 整段前摇（TS 是 1.0 s 时才亮、预警 1 s，生效时刻相同；D21 整改：前摇最后一帧之前就要看得到），
    ///     之后 3.6 s 每 0.4 s 一跳 8 伤，脚底 3 m 以内）；
    ///   出手 3.4 s（2.0–5.4）：贴地风痕（<see cref="KunPengFx.Gust"/>），每 0.15 s 把玩家往外缘推一下（冰柱 / 矮墙 / 祭台背后不受风；冰窟边缘段不挡）；
    ///   收招 0.4 s。
    /// 推力同吞吸（每下最多 2.95 m/s，单位时间与 Three.js 每 0.18 s 3.6 m/s 相同），把人吹进冻风带里——躲到柱子后面。
    /// </summary>
    public sealed class PengGust : KunPengMove
    {
        public const string MoveId = "gust";
        public const float FlyIn = 1.6f, ZoneAt = 1f, ZoneArm = 1f, ZoneSeconds = 3.6f;

        public override string Id => MoveId;
        public override string Name => "鹏 · 扇翼狂风";

        /// <summary>本次推了几下 / 被掩体挡住几下；冻风带（测试用）；最近一下的方向</summary>
        public int Pushes { get; private set; }
        public int BlockedPushes { get; private set; }
        public HazardZone Band { get; private set; }
        public Vector3 LastPush { get; private set; }

        float pushAcc, shakeAcc;

        public PengGust()
        {
            forms = new[] { KunPengDef.PengForm };
            cooldown = 12f;
            recovery = 1.2f;
            firstDelay = 1.5f;
            weight = 2f;
            windup = 2f;
            active = 3.4f;
            recover = 0.4f;
        }

        protected override void OnStart()
        {
            // 扇翼片段 2.4 s 本身是循环的扇动，按原速播（整招 5.8 s 拉伸会慢到 0.4 倍）
            Act("gust", 2.4f);
            if (KP)
            {
                KP.HoverAlt = (KDef != null ? KDef.pengOverHole : 11.5f) + 1f;
                KP.Accel = 26f;
                KP.MovesSincePerch++;
            }
            pushAcc = shakeAcc = 0;
            Pushes = BlockedPushes = 0;
            Band = null;
        }

        /// <summary>前摇一开始就铺冻风带：预警（环形）= 整段前摇，前摇结束那一刻生效（与 TS 1.0 s + 预警 1 s 同一时刻）</summary>
        protected override void OnTelegraph()
        {
            float arm = Mathf.Max(ZoneArm, WindupTime);
            Band = Hazards.Zone(new BossZoneSpec(AtFloor(Hole.center), Hole.outer + 1f, ZoneSeconds, Dmg(8), KunPengDef.Gust)
            {
                innerRadius = Mathf.Max(Hole.radius + 4f, Hole.outer - 5f), arm = arm, interval = 0.4f, element = Element.None, maxHeight = 3f, embers = true,
                // 前摇里被打断（硬直 / 眩晕）就撤回：预警在招式组，冻风带在 OnEnd 里作废
                moveWarning = true,
            });
            CountWarning();
            CuedSfx("telegraph", 1f, 0.8f);
            KP?.TellOnce("gust", "鹏扇起狂风——躲到冰柱后面，别被吹到环台外缘的冻风带里！", Hex.Rgb(0xbfe9ff));
        }

        protected override void OnWindup(float dt)
        {
            if (KP)
            {
                if (StageT < FlyIn) KP.FlyTo(Hole.center, 14f, 1f);
                else KP.Hover();
            }
            Brain.Face(Brain.PlayerPosition, 115f, dt);
        }

        protected override void OnActiveBegin() => KP?.HoleFx?.Gust(true);

        protected override void OnActive(float dt)
        {
            KP?.Hover();
            Brain.Face(Brain.PlayerPosition, 115f, dt);
            float interval = KDef != null ? KDef.pullInterval : 0.15f;
            pushAcc += dt;
            while (pushAcc >= interval)
            {
                pushAcc -= interval;
                Push();
            }
            shakeAcc += dt;
            if (shakeAcc < 0.5f) return;
            shakeAcc = 0;
            Brain.Shake(0.12f, 0.3f);
            Sfx("enemy_charge", 0.5f, 0.4f);
        }

        /// <summary>从冰窟上空吹向外缘：从玩家方向的冰沿外 0.5 m、2 m 高连到玩家胸口，掩体挡住就不受风（冰窟里的不算）</summary>
        void Push()
        {
            var motor = KP ? KP.Motor : null;
            if (!motor || !PlayerFeet(out var feet)) return;
            var d = feet - Hole.center;
            d.y = 0;
            float dist = d.magnitude;
            if (dist < 1f) return;
            var src = Hole.Point(KunPengMath.Yaw(d), Hole.radius + 0.5f) + Vector3.up * 2f;
            if (dist > Hole.radius + 1f && KP.CoverBlocks(src, feet + Vector3.up * 1.2f))
            {
                BlockedPushes++;
                return;
            }
            LastPush = d / dist;
            motor.AddImpulse(LastPush * (KDef != null ? KDef.pullImpulse : 2.95f));
            Pushes++;
        }

        protected override void OnRecoverBegin() => KP?.HoleFx?.Gust(false);

        protected override void OnEnd(bool cancelled)
        {
            // 前摇里被打断：还没生效的冻风带作废（预警在招式组，已跟着撤回）
            if (cancelled && Band && !Band.Live && !Band.Ended) Band.Expire();
            KP?.HoleFx?.Gust(false);
            if (!KP) return;
            KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
            KP.Accel = KDef != null ? KDef.pengAccel : 22f;
        }
    }
}
