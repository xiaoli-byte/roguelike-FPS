using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 4-1 领主登场的公用镜头（docs/art/ch4-boss-intros.json 的 land：切到玩家身后的过肩机位、再平滑推进眼睛）
    /// </summary>
    public static class LordIntros
    {
        /// <summary>过肩机位那一镜的时长：一切到这里就开始落回（BossIntroDirector 的落回从最后一镜的姿态起算）</summary>
        public const float ShoulderShot = 0.12f;

        /// <summary>
        /// 加最后两段：过肩机位（玩家眼睛后 3.2 m、上 0.9 m、右 0.9 m，看着首领身体）硬切一镜 → 落回第一人称 landSeconds − 0.12 秒。
        /// 整段 land 的起止和镜头表一致（6.6–8.0 这类），交还零误差由导演保证
        /// </summary>
        public static void AddLand(BossIntroScript s, float landSeconds)
        {
            s.shots.Add(IntroShot.Make("land", ShoulderShot)
                .Hold(IntroPoint.At(IntroAnchors.Eye, LordCinema.ShoulderRight, LordCinema.ShoulderUp, -LordCinema.ShoulderBack))
                .Look(IntroPoint.At(IntroAnchors.Body))
                .Fov(LordCinema.ShoulderFov).Handheld(0f).NoClearance());
            s.landSeconds = Mathf.Max(0.6f, landSeconds - ShoulderShot);
        }
    }

    /// <summary>
    /// 夔 · 登场「雷暴压境」（8.0 s，镜头表 docs/art/ch4-boss-intros.json kui；chuanzang-combat-v1.md 4.1）：
    ///   0.0–2.3 establish 山头全景，绕残鼓慢慢环绕（距 40 m、高 17 m）；开头起高原雷暴（天色 3 s 压暗、下雨），0.9 / 1.4 / 1.9 s 三道雷劈在残鼓上
    ///   2.3     生成（KuiBrain 的登场：2.3–4.5 s 从残鼓里一节节长出来，4.5 s 一足落地 + 双拳砸地，之后仰头吼）
    ///   2.3–4.9 reveal 贴地低机位仰拍残鼓（距 11 → 9.5 m、高 1.3 m），看点跟着长高
    ///   4.9–6.6 closeup 正面略低特写（过渡 0.5 s），5.0 s 名字卡「夔 · 一足之雷」
    ///   6.6–8.0 land 过肩机位 → 平滑推进眼睛（零误差交还）
    /// 锚点 drum = 残鼓（场地里摆的 KuiDrum，没摆时在首领出生点立一个占位鼓）。
    /// </summary>
    [Defs]
    public sealed class KuiIntro : BossIntroScript
    {
        public const string Drum = "drum";

        public KuiIntro()
        {
            id = KuiDef.Id;
            spawnAt = 2.3f;
            epithet = "4-1 · 经幡山头";
            anchors[Drum] = c =>
            {
                var d = FindDrum(c);
                return d ? d.Center : c.Spawn + Vector3.up * 0.9f;
            };
            // 夹角都以「残鼓 → 玩家」为 0（决斗坐标里是 −Z）；a 弧度往左转
            shots.Add(IntroShot.Make("establish", 2.3f)
                .Move(Around(1.05f, 40f, 17f), Around(0.85f, 40f, 17f))
                .Look(IntroPoint.At(Drum, 0, 2f, 0))
                .Fov(50f).Orbit().BlendIn(0.5f).Handheld(0.12f));
            shots.Add(IntroShot.Make("reveal", 2.6f)
                .Move(Around(0.35f, 11f, 0.4f), Around(0.35f, 9.5f, 0.4f))
                .Look(IntroPoint.At(Drum, 0, -0.4f, 0), IntroPoint.At(Drum, 0, 3.4f, 0))
                .Fov(48f).Handheld(0.25f));
            shots.Add(IntroShot.Make("closeup", 1.7f)
                .Move(Around(0.12f, 7.5f, 1.7f), Around(0.12f, 6.9f, 1.7f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, -0.4f, 0))
                .Fov(44f).BlendIn(0.5f).Handheld(0.3f));
            LordIntros.AddLand(this, 1.4f);

            // 高原雷暴（夔的出场条件）：开演就压境，夔死后退场
            cues.Add(IntroCue.Call(0f, "storm", c => KuiBrain.EnsureStorm(c.Arena ? c.Arena.Center : c.Spawn), true));
            foreach (float at in new[] { 0.9f, 1.4f, 1.9f })
                cues.Add(IntroCue.Call(at, "bolt on drum", c =>
                {
                    var d = FindDrum(c);
                    var p = d ? d.transform.position : c.Spawn;
                    LightningStrike.Strike(p, new StrikeOptions { warn = 0, noTelegraph = true, ignoreConductors = true, damage = 0, height = 45f });
                    if (d) d.Strike();
                    CameraShake.Add(0.2f, 0.35f);
                }));
            cues.Add(IntroCue.Every(2.3f, 4.5f, 0.12f, "storm clouds", c => Fx.KuiCloud(c.Anchor(Drum) + Vector3.up * 1.5f, 1.6f, 1, true)));
            cues.Add(IntroCue.NameCard(5.0f, 2.6f));
            fxShots.Add((1.45f, "bolt"));
            fxShots.Add((4.55f, "land"));
        }

        static IntroPoint Around(float a, float r, float h) => IntroPoint.At(Drum, -Mathf.Sin(a) * r, h, -Mathf.Cos(a) * r);

        static KuiDrum FindDrum(BossIntroContext c)
        {
            if (c.Bag.TryGetValue("drum", out var v) && v is KuiDrum k && k) return k;
            if (!Application.isPlaying) return null;
            var d = KuiDrum.Ensure(c.Arena, c.Spawn, Quaternion.LookRotation(Flat(c.Forward * -1f)));
            c.Bag["drum"] = d;
            return d;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-4f ? v.normalized : Vector3.forward;
        }
    }
}
