using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 飞廉 · 登场「风涡」（7.8 s，镜头表 docs/art/ch4-boss-intros.json feilian；chuanzang-combat-v1.md 4.2）：
    ///   0.0–2.2 establish 冰舌下方仰拍风涡柱（距 34 m、高 5 m，看点从 30 m 降到 26 m）：风声骤起，风涡柱收紧（螺旋带往里卷）
    ///   1.0     生成（FeilianBrain 的登场：1.0–4.0 s 从 40 m 高的风涡里盘旋落下，4.0 s 落地炸开一圈雪，之后人立长嘶）
    ///   2.2–4.4 reveal 跟拍盘旋落下（过渡 0.5 s，距 18 m、高 4 m，看着模型）
    ///   4.4–6.4 closeup 正面 3/4 特写（过渡 0.45 s），4.6 s 名字卡「飞廉 · 风伯」
    ///   6.4–7.8 land 过肩机位 → 平滑推进眼睛
    /// 锚点 land = 落地点（首领出生点）。
    /// </summary>
    [Defs]
    public sealed class FeilianIntro : BossIntroScript
    {
        public const string Land = "land";

        public FeilianIntro()
        {
            id = FeilianDef.Id;
            spawnAt = 1.0f;
            epithet = "4-1 · 冰川口";
            anchors[Land] = c => c.Spawn;
            shots.Add(IntroShot.Make("establish", 2.2f)
                .Move(Around(0.55f, 34f, 5f), Around(0.40f, 34f, 5f))
                .Look(IntroPoint.At(Land, 0, 30f, 0), IntroPoint.At(Land, 0, 26f, 0))
                .Fov(56f).Orbit().BlendIn(0.5f).Handheld(0.15f));
            shots.Add(IntroShot.Make("reveal", 2.2f)
                .Move(Around(0.3f, 18f, 4f), Around(0.3f, 18f, 4f))
                .Look(IntroPoint.At(IntroAnchors.Model, 0, 2f, 0))
                .Fov(50f).BlendIn(0.5f).Handheld(0.25f));
            shots.Add(IntroShot.Make("closeup", 2.0f)
                .Move(Around(0.25f, 9f, 3.2f), Around(0.25f, 8.2f, 3.2f))
                .Look(IntroPoint.At(IntroAnchors.Head))
                .Fov(45f).BlendIn(0.45f).Handheld(0.3f));
            LordIntros.AddLand(this, 1.4f);

            // 风声骤起：开演就在落地点卷雪、风线往风涡收
            cues.Add(IntroCue.Every(0f, 4f, 0.1f, "vortex gather", c => Fx.FeilianGather(c.Anchor(Land) + Vector3.up * 14f, null, 16f, 0.6f, 0.1f)));
            cues.Add(IntroCue.Shake(4.0f, 0.4f, 0.5f));
            cues.Add(IntroCue.NameCard(4.6f, 2.6f));
            fxShots.Add((3.2f, "descend"));
            fxShots.Add((4.05f, "land"));
        }

        static IntroPoint Around(float a, float r, float h) => IntroPoint.At(Land, -Mathf.Sin(a) * r, h, -Mathf.Cos(a) * r);
    }
}
