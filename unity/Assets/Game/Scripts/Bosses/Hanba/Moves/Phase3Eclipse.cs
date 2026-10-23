using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 日蚀（三阶段「赤地千里」，unity-maps-v1 第 3 节、D26：日轮短暂熄灭 3 秒，心口露出最后一滴泉水——弱点，伤害 ×3，这是输出窗口；
    /// 之后日轮爆发强光，覆盖全场）。三阶段演出结束后的第一招就是它（<see cref="BossPhaseDef.firstMove"/>）。
    /// 时间轴跟 ART2 的 eclipse 片段走、片段原速播（4.5 s；不随阶段节奏 / 狂怒缩短，3 s 窗口要对得上 eclipseStart / eclipseEnd）：
    ///   前摇 <see cref="Lead"/>（0.67 s）：双臂后展、挺胸，日轮迅速暗下去；她脚下亮起一圈 <see cref="WarnRadius"/> 米的预警，<see cref="Lead"/> + 3 s 填满——填满那一刻就是强光。
    ///     （不铺满全场：露天场地起伏大，整片场地的贴花投影盒高好几米，会把地面、楼阁台基连同她自己一起刷成白色，天暗下来反倒看不出来。强光覆盖全场由提示和天色交代）
    ///   出手 = 日蚀窗口 <see cref="HanbaDef.eclipseSeconds"/>（3 s，eclipseStart → eclipseEnd）：日轮熄灭（<see cref="SunRing.SetEclipse"/>：黑盘月影、不直射）；
    ///     露天场地里升到头顶的日轮就是太阳——主光压到 <see cref="HanbaDef.eclipseDim"/>，天暗下来，这 3 s 没有日晒（<see cref="SunExposure.SunOut"/>）；
    ///     泉珠露出，打在泉珠上的伤害再 × <see cref="HanbaDef.eclipseWeakMult"/>（在弱点必暴之外，<see cref="HanbaBrain.OpenEclipse"/>）；她原地颤抖、不动。
    ///   收招：日轮复燃（flare 事件，窗口结束后 0.27 s）——主光猛亮一下，强光覆盖全场：看得到太阳的人（<see cref="SunExposure.SeesSun"/>：胸口或眼睛朝太阳没被挡；
    ///     穴顶版另算到轮心的视线）受 <see cref="HanbaDef.flareDamage"/> 倍伤害、额外叠 <see cref="HanbaDef.flareBurn"/> 秒日晒，满屏白光；
    ///     躲在楼阁里、沙丘檐下深影里的人只看到一下闪光。
    ///     收招段泉珠照常露出（施法后摇，伤害不再 ×3）。
    /// 被打断（死亡）时日轮复原、窗口关闭，不放强光。
    /// </summary>
    public sealed class Phase3Eclipse : HanbaMove
    {
        public const string MoveId = "eclipse";
        /// <summary>片段原速：eclipseStart 在 0.667 s，eclipseEnd 在 3.667 s，flare 在 3.933 s，全长 4.5 s</summary>
        public const float Lead = 0.667f, FlareAfter = 0.267f, ClipSeconds = 4.5f;
        /// <summary>强光预警（倒计时）的半径：她脚下一圈</summary>
        public const float WarnRadius = 7f;
        static readonly Color FlareColor = Hex.Rgb(0xfff2c8), DarkColor = new(0.05f, 0.03f, 0.02f, 0.35f);

        public override string Id => MoveId;
        public override string Name => "日蚀";

        /// <summary>累计：窗口开过几次、强光打中 / 被影子挡住几次；最近一次窗口的实际时长</summary>
        public int Windows { get; private set; }
        public int FlareHits { get; private set; }
        public int FlareShaded { get; private set; }
        public float LastWindow { get; private set; }
        /// <summary>本次已经放过强光</summary>
        public bool Flared { get; private set; }

        float window, openAt;
        bool open;

        public Phase3Eclipse()
        {
            cooldown = 24f;
            recovery = 1.4f;
            weight = 1.8f;
            minPhase = 2;
            windup = Lead;
            active = 3f;
            recover = 1.2f;
        }

        /// <summary>时间轴固定（不吃节奏）：前摇 0.67 s + 窗口 + 收招</summary>
        public override HanbaMovePlan Plan(float pace) => new(Lead, active, recover);

        protected override void Prepare()
        {
            Brain.Halt();
            Brain.FaceNow(Brain.PlayerPosition);
            FixedWindup(Lead);
            window = Mathf.Max(0.5f, HDef?.eclipseSeconds ?? 3f);
            active = window;
            Flared = open = false;
            if (Ring) Ring.SetBlaze(0.05f, 0.3f);
        }

        protected override void OnTelegraph()
        {
            // 强光预警（倒计时）：她脚下一圈，前摇 + 窗口 + 强光前的那一小段填满（招式组：被打断就不放强光，预警随招式撤回）
            Hazards.GroundWarning(OnGround(Brain.transform.position), WarnRadius, Lead + window + FlareAfter, FlareColor);
            CountWarning();
            // 片段原速（4.5 s）：ActScale = 1，eclipseStart / eclipseEnd 正好隔 3 s
            Act("eclipse", ClipSeconds);
            Sfx("telegraph", 1f, 0.55f);
            Sfx("enemy_charge", 0.8f, 0.45f);
        }

        protected override bool WindupDone => Cue("eclipseStart", Lead);

        protected override void OnWindup(float dt) => Brain.Glow(0, 1f - Mathf.Clamp01(StageT / Lead));

        protected override void OnActiveBegin()
        {
            open = true;
            openAt = T;
            Windows++;
            if (Ring) Ring.SetEclipse(true);
            if (Hanba) Hanba.OpenEclipse(HDef?.eclipseWeakMult ?? 3f);
            Sky?.SetDim(HDef?.eclipseDim ?? 0.12f, 0.35f);
            GameUI.ScreenFlash(DarkColor, 0.5f);
            GameUI.Toast("日蚀！心口泉珠显露——集火！日轮复燃前躲进楼阁或沙丘檐下的深影", HanbaDef.Sun, window);
            Brain.Shake(0.3f, 0.3f);
            Sfx("boss_roar", 0.45f, 0.6f);
        }

        protected override void OnActive(float dt)
        {
            // 颤抖：泉珠一闪一闪
            Brain.Glow(0, 0.35f + 0.25f * Mathf.Sin(StageT * 18f));
            if (Rng.Value < 0.25f) Fx.Burst(Brain.BodyCenter + Brain.transform.forward * 0.5f, new Color(0.6f, 0.86f, 1f), 1, 0.6f, 0.5f, 0.1f, -0.3f);
        }

        protected override bool ActiveDone => StageT >= window;

        protected override void OnRecoverBegin()
        {
            LastWindow = T - openAt;
            Close();
            Brain.Glow(0, 0);
        }

        protected override void OnRecover(float dt)
        {
            if (!Flared && Cue("flare", Lead + window + FlareAfter)) Flare();
        }

        /// <summary>日轮复燃：强光覆盖全场（看得到轮心的人挨打 + 叠日晒，影子里的只闪一下）</summary>
        void Flare()
        {
            Flared = true;
            if (Ring)
            {
                Ring.Flash(1f);
                Ring.SetBlaze(1f, 3f);
            }
            var c = Ring ? Ring.Center : Brain.BodyCenter + Vector3.up * 3f;
            Sky?.Flash(HDef?.flareBright ?? 2.4f, 0.12f, 0.9f);
            Brain.Shake(0.7f, 0.6f, 90f);
            Sfx("boss_roar", 1f, 0.8f);
            Sfx("explosion", 0.8f, 0.5f);
            SkillFx.Burst(c, FlareColor, 40, 14f, 0.9f, 0.5f, 0f);
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || !SunExposure.Probes(out _, out var chest, out var head)) return;
            var ex = Exposure;
            bool lit = ex ? ex.SeesSun(chest) || ex.SeesSun(head) : Combat.LineClear(chest, c, 0.6f) || Combat.LineClear(head, c, 0.6f);
            if (!lit)
            {
                FlareShaded++;
                GameUI.ScreenFlash(new Color(1f, 0.95f, 0.8f, 0.3f), 0.4f);
                return;
            }
            GameUI.ScreenFlash(new Color(1f, 0.97f, 0.88f, 0.85f), 0.9f);
            if (pv.Invulnerable) return;
            if (Hazards.Hurt(Damage(HDef?.flareDamage ?? 1.6f), Element.Fire, c) > 0) FlareHits++;
            Exposure?.Burn(HDef?.flareBurn ?? 2.5f, c);
        }

        /// <summary>露天场地的太阳驱动（日轮升到头顶之后才有：没升顶、穴顶版都不动主光）</summary>
        HanbaSunDriver Sky => Hanba && Hanba.SunRise != null && Hanba.SunRise.Driver && Ring && Ring.Risen ? Hanba.SunRise.Driver : null;

        void Close()
        {
            if (!open) return;
            open = false;
            if (Ring) Ring.SetEclipse(false);
            if (Hanba) Hanba.CloseEclipse();
            // 天亮回来（正常收招时复燃的强光随后再猛闪一下）
            if (!Flared) Sky?.SetDim(1f, 0.3f);
        }

        protected override void OnEnd(bool cancelled)
        {
            Close();
            base.OnEnd(cancelled);
        }
    }
}
