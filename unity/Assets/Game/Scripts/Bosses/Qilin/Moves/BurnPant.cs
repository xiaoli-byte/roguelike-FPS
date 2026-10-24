using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 落地喘息（TS Qilin 'pant'）：不按权重出，只在踏云俯冲三踏之后排上（<see cref="BurnDives"/>）。二阶段主要的输出窗口：
    ///   降落 0.8 s：落点 = 脚下最近的能站的地面（人形导航网格、非熔岩区，涨着的熔流已从网格上挖掉；不落进熔池 / 倒鼎、不压石柱），亮 5 m 预警圈；
    ///   落地：5 m 内 16 + 掀开；喘 3.5 s——胸口火心大亮（光晕 + 点光），角根火珠也亮，贴着地面最好打；
    ///   起飞前 0.8 s 脚下亮 6 m 预警圈（TS 0.5 s，这里放宽一点，贴脸输出的人来得及退）→ 起飞：6 m 内 12（火）+ 击退，回到 4.5 m 踏云。
    /// </summary>
    public sealed class BurnPant : QilinMove
    {
        public const string MoveId = "burn_pant";
        /// <summary>喘息时长（秒）、落地 / 起飞的范围与伤害（TS 原值，难度 1）、起飞预警（秒）</summary>
        public const float Rest = 3.5f, LandRadius = 5f, LandDamage = 16f, TakeoffRadius = 6f, TakeoffDamage = 12f, TakeoffWarn = 0.8f;

        public override string Id => MoveId;
        public override string Name => "落地喘息";

        /// <summary>本次的落点；累计：落地次数、起飞次数、本次落地时离地面多高（测试）</summary>
        public Vector3 Spot { get; private set; }
        public int Landed { get; private set; }
        public int Takeoffs { get; private set; }

        Vector3 from;

        public BurnPant()
        {
            cooldown = 0;
            recovery = 0.6f;
            weight = 0;
            windup = 0.8f;
            active = Rest;
            recover = 0.7f;
            forms = new[] { QilinDef.BurnForm };
        }

        public override float Weight(BossBrain b) => 0;

        protected override void Prepare()
        {
            from = Brain.transform.position;
            Spot = Qilin ? Qilin.LandingSpot(from) : OnFloor(from);
            if (Qilin) Qilin.SkyTarget = 0;
        }

        protected override void OnTelegraph()
        {
            WarnCircle(Spot, LandRadius, WindupTime);
            Brain.PlayAct("stomp", WindupTime + 0.2f);
        }

        protected override void OnWindup(float dt)
        {
            // 降落：水平缓入、竖直加速落下（脚本轨迹）
            float k = Mathf.Clamp01(StageT / Mathf.Max(0.05f, WindupTime));
            var p = Vector3.Lerp(from, Spot, QilinBrain.EaseInOut(k));
            p.y = Mathf.Lerp(from.y, Spot.y, k * k);
            if (Qilin) Qilin.SkyPlace(p);
            else Brain.transform.position = p;
            TurnToward(YawToPlayer, 120f, dt);
        }

        protected override void OnActiveBegin()
        {
            if (Qilin)
            {
                Qilin.SkyPlace(Spot);
                Qilin.SkyTarget = 0;
                Qilin.HeartBright = true;
            }
            else Brain.transform.position = Spot;
            Landed++;
            Brain.PlayAct("pant", active);
            Hazards.Blast(Spot, LandRadius, Dmg(LandDamage), new BossBlastOpts { maxHeight = 3f, knockback = 8f, knockUp = 4f });
            Fx.Burst(Spot + Vector3.up * 0.3f, QilinDef.Ember, 26, 8f, 0.8f, 0.3f, 10f);
            Brain.Shake(0.45f, 0.35f);
            Sfx("boss_slam", 1f, 1.1f);
            Qilin?.Tell("pant", "焚身落地喘息——胸口火心大亮，现在是输出时机！", Hex.Rgb(0xffe08a));
        }

        protected override void OnActive(float dt)
        {
            if (Qilin)
            {
                Qilin.SkyTarget = 0;
                Qilin.Hover();
            }
            TurnToward(YawToPlayer, 34f, dt);
            if (StageAt(Mathf.Max(0, active - TakeoffWarn)))
            {
                WarnCircle(OnFloor(Brain.transform.position), TakeoffRadius, TakeoffWarn);
                Sfx("telegraph", 1f, 1.1f);
            }
        }

        protected override void OnRecoverBegin()
        {
            var feet = OnFloor(Brain.transform.position);
            if (Qilin)
            {
                Qilin.HeartBright = false;
                Qilin.SkyTarget = QilinBrain.SkyAlt;
            }
            Takeoffs++;
            Brain.PlayAct("tuck", recover);
            Hazards.Blast(feet, TakeoffRadius, Dmg(TakeoffDamage), new BossBlastOpts { maxHeight = 4f, knockback = 12f, knockUp = 5f, element = Element.Fire });
            Fx.Ring(feet + Vector3.up * 0.1f, 7f, QilinDef.Warn, 0.6f);
            Fx.Burst(feet + Vector3.up * 0.5f, QilinDef.Fire, 30, 9f, 0.7f, 0.35f, 2f);
            Sfx("boss_roar", 0.8f, 1.3f);
        }

        protected override void OnRecover(float dt)
        {
            if (Qilin) Qilin.Hover();
        }

        protected override void OnEnd(bool cancelled)
        {
            if (!Qilin) return;
            Qilin.HeartBright = false;
            Qilin.SkyTarget = QilinBrain.SkyAlt;
        }
    }
}
