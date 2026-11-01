using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 化蛇 · 登场「湖动」（7.8 s，镜头表 docs/art/ch4-boss-intros.json huashe；chuanzang-combat-v1.md 4.3）：
    ///   0.0–2.0 establish 玩家身后高处俯瞰湖面（身后 10 m、高 12 → 10 m），看点从湖心移到冒头的地方：湖面起涟漪、冒泡，水下一道长黑影 S 形游向岸边
    ///   0.4     生成（HuasheBrain 的登场：水下游 2.2 s，2.6 s 破水而出、张翼，之后张嘴吼）
    ///   2.0–4.2 reveal 贴水面低机位（离冒头点 15 m、侧 4 m、高出水面 1 m），看点从水面升到头
    ///   4.2–6.4 closeup 人面特写（过渡 0.4 s），4.4 s 名字卡「化蛇 · 人面豺身，鸟翼蛇行」
    ///   6.4–7.8 land 过肩机位 → 平滑推进眼睛
    /// 锚点 lake = 湖心（水面高度），rise = 冒头的地方（首领出生点；生成后 = 首领位置）。
    /// </summary>
    [Defs]
    public sealed class HuasheIntro : BossIntroScript
    {
        public const string LakeAnchor = "lake", Rise = "rise";

        public HuasheIntro()
        {
            id = HuasheDef.Id;
            spawnAt = 0.4f;
            epithet = "4-1 · 圣湖海子";
            anchors[LakeAnchor] = c => c.Arena ? c.Arena.Center : c.Spawn;
            anchors[Rise] = c => c.Boss ? c.Boss.transform.position : c.Spawn;
            shots.Add(IntroShot.Make("establish", 2.0f)
                .Move(IntroPoint.At(IntroAnchors.Player, 0, 12f, -10f), IntroPoint.At(IntroAnchors.Player, 0, 10f, -10f))
                .Look(IntroPoint.At(LakeAnchor), IntroPoint.At(Rise))
                .Fov(55f).BlendIn(0.5f).Handheld(0.1f));
            shots.Add(IntroShot.Make("reveal", 2.2f)
                .Move(IntroPoint.At(Rise, 4f, 1.3f, -15f), IntroPoint.At(Rise, 4f, 1.3f, -14f))
                .Look(IntroPoint.At(Rise, 0, 0.5f, 0), IntroPoint.At(IntroAnchors.Head))
                .Fov(50f).Handheld(0.25f));
            shots.Add(IntroShot.Make("closeup", 2.2f)
                .Move(IntroPoint.At(IntroAnchors.Head, 0, 0.4f, -6.5f), IntroPoint.At(IntroAnchors.Head, 0, 0.4f, -5.8f))
                .Look(IntroPoint.At(IntroAnchors.Head))
                .Fov(44f).BlendIn(0.4f).Handheld(0.3f));
            LordIntros.AddLand(this, 1.4f);

            cues.Add(IntroCue.Every(0f, 2.6f, 0.15f, "lake bubbles", c =>
            {
                var p = c.Anchor(LakeAnchor) + new Vector3(c.Random(-12f, 12f), 0.05f, c.Random(-12f, 12f));
                Fx.HuasheRipple(p, c.Random(0.8f, 1.6f));
            }));
            cues.Add(IntroCue.NameCard(4.4f, 2.6f));
            fxShots.Add((1.4f, "shadow"));
            fxShots.Add((2.7f, "breach"));
        }
    }
}
