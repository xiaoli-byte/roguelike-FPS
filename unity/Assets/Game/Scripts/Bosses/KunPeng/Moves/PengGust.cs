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
    /// 动作 / 特效（K 路，docs/art/vfx/kunpeng.md 第 5 节）：gust 是手 K 片段、按整招 5.8 s 播——后仰收翅 → 两下慢扇爬升 → 1.8 s 举翅到顶（apex，翼尖冰晶星）
    /// → 2.0 s 第一下猛扇（释放帧，顿帧 0.06 s）→ 之后每 17 帧（0.57 s）一下（flap 事件）。每一下下扇：翼刃拖影、身下一圈贴地风环、螺旋往外的风线、卷起的雪
    /// （<see cref="Fx.PengFlap"/>）——扇一下推一下，节奏看得见。代理 / 占位体没有 flap 事件，按同样的周期兜底。
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

        float pushAcc, shakeAcc, lastFlap = -99f;
        bool apexed;
        /// <summary>下扇周期（片段 17 帧）、蓄力顶点（片段 54 帧）</summary>
        public const float FlapPeriod = 17f / 30f, ApexAt = 1.8f;
        /// <summary>本次下扇了几下（测试用）</summary>
        public int Flaps { get; private set; }

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
            // 手 K 的扇翼片段就是整招（前摇 2.0 + 出手 3.4 + 收招 0.4 = 5.8 s），按整招时长播：2.0 s 第一下猛扇对齐出手
            Act("gust", windup + active + recover);
            apexed = false;
            lastFlap = -99f;
            Flaps = 0;
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

        public override void OnAnimEvent(string name)
        {
            base.OnAnimEvent(name);
            if (name == "apex") Apex();
            else if (name == "flap" && Stage == MoveStage.Active) Flap(false);
        }

        /// <summary>举翅到顶：两侧翼尖各一颗冰晶星</summary>
        void Apex()
        {
            if (apexed || Stage != MoveStage.Windup) return;
            apexed = true;
            if (KP) Fx.PengWingGlints(KP.WingTip(true), KP.WingTip(false), 2f);
        }

        /// <summary>一下下扇的风（事件驱动；离上一下不到 0.2 s 的重复事件忽略）</summary>
        void Flap(bool strong)
        {
            if (Time.time - lastFlap < 0.2f) return;
            lastFlap = Time.time;
            Flaps++;
            var p = Brain.transform.position;
            var ground = new Vector3(p.x, Hole.found && Hole.OverHole(p) ? Hole.waterY : Floor, p.z);
            Fx.PengFlap(Brain.BodyCenter, ground, Brain.transform.eulerAngles.y, 4.5f, strong);
        }

        protected override void OnWindup(float dt)
        {
            if (!apexed && StageT >= ApexAt) Apex();
            if (KP)
            {
                if (StageT < FlyIn) KP.FlyTo(Hole.center, 14f, 1f);
                else KP.Hover();
            }
            Brain.Face(Brain.PlayerPosition, 115f, dt);
        }

        /// <summary>冻风带的风环（平放环带体积，飞快地转、条纹往外吹）</summary>
        FxHandle windBand;

        protected override void OnActiveBegin()
        {
            KP?.HoleFx?.Gust(true);
            // 扇翼狂风：环台外缘一圈飞快旋转的白色风带（冻风带那一圈），翅膀下一团往外炸的雪雾
            var c = AtFloor(Hole.center) + Vector3.up * 0.3f;
            float outer = Hole.outer + 1f, inner = Mathf.Max(Hole.radius + 4f, Hole.outer - 5f);
            windBand = Surge.Annulus(c, inner, outer, SurgeKind.Water, active, 260f, 1.4f, new Color(0.75f, 0.88f, 0.98f), Color.white, 0.45f);
            Fx.FrostVapour(Brain.BodyCenter, 2.5f, FrostPalette.Snow);
            // 释放帧：第一下猛扇（和片段的 gustStart / flap 同一帧），顿帧 + 震屏
            lastFlap = -99f;
            Flap(true);
            KP?.ImpactHold(0.06f);
            Brain.Shake(0.3f, 0.35f);
        }

        protected override void OnActive(float dt)
        {
            // 兜底：片段没有 flap 事件（代理 / 占位体 / 采样片段）时按周期扇
            if (Time.time - lastFlap > FlapPeriod * 1.35f) Flap(false);
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

        protected override void OnRecoverBegin()
        {
            KP?.HoleFx?.Gust(false);
            windBand.Cancel();
        }

        protected override void OnEnd(bool cancelled)
        {
            // 前摇里被打断：还没生效的冻风带作废（预警在招式组，已跟着撤回）
            if (cancelled && Band && !Band.Live && !Band.Ended) Band.Expire();
            KP?.HoleFx?.Gust(false);
            windBand.Cancel();
            if (!KP) return;
            KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
            KP.Accel = KDef != null ? KDef.pengAccel : 22f;
        }
    }
}
