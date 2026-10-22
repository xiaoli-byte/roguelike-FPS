using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 焚身的占位招式（BS5 落地之前，让 55% 的换形和二阶段能跑起来；BS5 用正式的 Burn* 招式替换，删掉本文件并从 QilinDef 拿掉这两招）。
    /// 焚身 · 跃击（占位，TS 三连俯冲踏地的一次）：前摇 0.9 s 在玩家（预判 0.5 s）脚下亮 4.2 m 预警圈，0.55 s 抛物线跃过去，
    /// 落地 4.2 m 内 30（火）+ 掀飞，炸出一圈贴地火环（13 m/s 扩到 15 m，16，跳起来躲）。
    /// </summary>
    public sealed class BurnPlaceholderStomp : QilinMove
    {
        public const string MoveId = "burn_stomp";
        public const float Radius = 4.2f, LeapHeight = 5f;

        public override string Id => MoveId;
        public override string Name => "焚身 · 跃击（占位）";

        public int Stomps { get; private set; }

        Vector3 from, at;

        public BurnPlaceholderStomp()
        {
            cooldown = 7f;
            recovery = 1f;
            weight = 2.2f;
            windup = 0.9f;
            active = 0.55f;
            recover = 0.6f;
            forms = new[] { QilinDef.BurnForm };
        }

        protected override void Prepare()
        {
            from = Brain.transform.position;
            at = OnFloor(Brain.ClampToArena(Brain.Predict(0.5f)));
            if (Qilin) Qilin.SampleNav(at, 3f, out at);
            else if (UnityEngine.AI.NavMesh.SamplePosition(at, out var hit, 3f, LavaField.WalkerFilter())) at = hit.position;
            Brain.Halt();
            Brain.BeginDash(Vector3.zero, 0);
        }

        protected override void OnTelegraph()
        {
            WarnCircle(at, Radius, WindupTime);
            Brain.PlayAct("tuck", WindupTime);
            Sfx("telegraph");
            Qilin?.Tell("burnStomp", "焚身跃击——落点会炸出一圈火环，跳起来躲", Hex.Rgb(0xffb070));
        }

        protected override void OnWindup(float dt) => TurnToward(YawTo(at), 240f, dt);

        protected override void OnActiveBegin()
        {
            Brain.PlayAct("stomp", active);
            Sfx("boss_roar", 0.8f, 1.4f);
        }

        protected override void OnActive(float dt)
        {
            float k = Mathf.Clamp01(StageT / Mathf.Max(0.05f, active));
            var p = Vector3.Lerp(from, at, k);
            p.y += Mathf.Sin(Mathf.PI * k) * LeapHeight;
            Brain.transform.position = p;
        }

        protected override void OnRecoverBegin()
        {
            Brain.transform.position = at;
            Brain.EndDash();
            Hazards.Blast(at, Radius, Dmg(30), new BossBlastOpts { maxHeight = 3f, knockback = 10f, knockUp = 6f, element = Element.Fire });
            Hazards.Wave(new BossWaveSpec(at, 13f, 15f, Dmg(16), QilinDef.Warn)
            {
                startRadius = 2f, width = 1f, height = 0.85f, knockback = 6f, element = Element.Fire, dust = true, dustColor = QilinDef.Ember,
            });
            Fx.Explosion(at + Vector3.up * 0.6f, 4f, QilinDef.Fire);
            Fx.Ring(at + Vector3.up * 0.1f, 8f, QilinDef.Warn, 0.7f);
            Brain.Shake(0.65f, 0.45f);
            Sfx("boss_slam");
            Stomps++;
        }

        protected override void OnEnd(bool cancelled) => Brain.EndDash();
    }

    /// <summary>焚身 · 麟火（占位）：同玄鳞的麟火，换 id、限焚身、18 m 内就出（BS5 换成落到熔池对岸扫一个象限的吐息）</summary>
    public sealed class BurnPlaceholderBreath : ScaleBreath
    {
        public const string BurnMoveId = "burn_breath";

        public override string Id => BurnMoveId;
        public override string Name => "焚身 · 麟火（占位）";

        public BurnPlaceholderBreath()
        {
            forms = new[] { QilinDef.BurnForm };
            weight = 2f;
            cooldown = 8f;
            firstDelay = 0;
            maxDistance = 18f;
        }
    }
}
