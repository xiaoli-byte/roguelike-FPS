using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将登场（3-3 铸范大坊 · 神范台，docs/level-design/boss-intros.md「熔心魔将」）：约 6.5 s（回程远时落地按路程拉长，3-3 实际约 7.1 s）。
    ///   0.0–2.0 vista   贴地后退的 establish：熔池、圆环与塔顶同框，沿竖直熔岩柱慢慢仰起——余烬往上飘，高处一团火光，魔将拖火下坠
    ///   1.6             生成（WarlordBrain 的登场：从 34 m 高处 1.04 s 砸下来、身后拖火，落地爆炸 + 火环 + 重震；70% = 3.4 s 时咆哮）
    ///   2.0–3.3 impact  首领后侧低机位 reveal 跟拍下坠，王座留在背景（看点 = 模型，胶囊不动），2.66 s 落地：熔铜四溅、地面一圈火环、闪屏、短慢动作
    ///   3.3–5.2 roar    略低于头的特写（角盔露全），咆哮，余烬绕身，名字卡
    ///   5.2–6.5         拉回玩家眼睛
    /// 人形手 K 片段负责下坠、落地与咆哮的身体姿态；火尾、熔铜冠、裂纹和余烬只加强这些关键姿势，不用光团遮模型。
    /// 咆哮靠肩头火柱 + 脚下残火（WarlordBrain.BeginDropFx / Land / RoarFx）。镜头转场的风见 <see cref="IntroFx.Wind"/>。
    /// </summary>
    [Defs]
    public sealed class WarlordIntro : BossIntroScript
    {
        static readonly Color Copper = Hex.Rgb(0xffb347), Slag = Hex.Rgb(0xff7a1a);

        public WarlordIntro()
        {
            id = WarlordDef.Id;
            spawnAt = 1.6f;
            landSeconds = 1.3f;
            epithet = "第三章 · 铸范大坊 · 神范台";
            const string throne = "fireGodThrone";
            anchors[throne] = c => c.Arena ? c.Arena.Center + Vector3.up * 31f : c.Spawn + Vector3.up * 31f;

            // establish：贴地后退，熔池在画面下沿、圆环与 65 m 高的塔顶都在画里，视线沿熔岩柱慢慢抬升。
            shots.Add(IntroShot.Make("vista", 2.0f)
                .Move(IntroPoint.At(IntroAnchors.Player, 0, 2f, -18f), IntroPoint.At(IntroAnchors.Player, 2f, 2.5f, -22f))
                .Look(IntroPoint.At(throne, 0, -12f, 0), IntroPoint.At(throne, 0, 0, 0))
                .Fov(58f, 54f).BlendIn(0.9f).Handheld(0.15f));
            // reveal：从首领后侧低机位跟拍，首领与王座、圆环、熔岩柱同向；只改机位，不改下坠与落地事件。
            shots.Add(IntroShot.Make("impact", 1.3f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, 7f, 1.2f, 15f), IntroPoint.At(IntroAnchors.Spawn, 5f, 1.5f, 13f))
                .Look(IntroPoint.At(IntroAnchors.Model, 0, 2f, 0), IntroPoint.At(IntroAnchors.Model, 0, -0.3f, 0))
                .Fov(58f, 54f).Ease(IntroEase.Out).Handheld(0.3f));
            // 角盔是弱点，要露全：机位只比头低一点（太低时胸甲、肩甲把头盔挡掉）
            shots.Add(IntroShot.Make("roar", 1.9f)
                .Move(IntroPoint.Sized(IntroAnchors.Head, 2.0f, -0.6f, -5.8f), IntroPoint.Sized(IntroAnchors.Head, 1.2f, -0.4f, -4.4f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, 0.15f, 0))
                .Fov(42f, 36f).Handheld(0.35f));

            // 余烬从神范台那边往上飘，高处闷雷
            cues.Add(IntroCue.Every(0.2f, 2.0f, 0.12f, "embers", c =>
            {
                var p = c.Spawn + c.Duel(c.Random(-6f, 6f), c.Random(0.2f, 1.5f), c.Random(-2f, 10f));
                Fx.Burst(p, WarlordDef.Embers, 4, 1.6f, 1.4f, 0.12f, -2.5f);
            }));
            cues.Add(IntroCue.Shake(0.6f, 0.2f, 0.7f));
            cues.Add(IntroCue.Sfx(1.2f, "skill_fire", IntroAnchors.Spawn, 0.55f, 0.6f));
            cues.Add(IntroCue.Call(1.45f, "sky glow", c =>
            {
                var sky = c.Spawn + Vector3.up * 30f;
                Fx.Burst(sky, WarlordDef.Fire, 30, 4f, 0.8f, 0.6f, -1f);
                Fx.SunFlare(sky, 3.5f, WarlordDef.Fire);
                Fx.Flash(sky, WarlordDef.Fire, 8f, 30f, 0.5f);
            }));
            // 落地（生成后 1.04 s）：砸地本身在 WarlordBrain.Land；这里再往外甩一圈远一点的熔铜（落在 5–8 m）
            cues.Add(IntroCue.Call(2.66f, "copper splash", c =>
            {
                for (int i = 0; i < 5; i++)
                {
                    float a = i / 5f * Mathf.PI * 2 + c.Random(-0.4f, 0.4f), r = c.Random(5f, 8f) * Mathf.Max(0.8f, c.Size);
                    var p = c.Spawn + new Vector3(Mathf.Sin(a) * r, 0.3f, Mathf.Cos(a) * r);
                    Fx.MoltenSplash(p, 1.1f, i % 2 == 0 ? Copper : Slag);
                }
                // 冲击环由砸地预设里的卡通粗环出（不再叠一道细白环）
                GameUI.ScreenFlash(new Color(1f, 0.55f, 0.2f, 0.32f), 0.35f);
            }));
            cues.Add(IntroCue.SlowMo(2.68f, 0.3f, 0.35f));
            cues.Add(IntroCue.Every(2.75f, 3.3f, 0.09f, "droplets", c =>
            {
                float a = c.Random(0, Mathf.PI * 2), r = c.Random(3f, 8f);
                var p = c.Spawn + new Vector3(Mathf.Sin(a) * r, 0.2f, Mathf.Cos(a) * r);
                Fx.Burst(p, Copper, 5, 4f, 0.6f, 0.16f, 14f);
            }));
            cues.Add(IntroCue.Every(3.3f, 5.2f, 0.15f, "rage embers", c =>
            {
                if (!c.Boss) return;
                float a = c.Random(0, Mathf.PI * 2), r = c.Random(0.8f, 2.2f) * Mathf.Max(0.8f, c.Size);
                var p = c.Boss.transform.position + new Vector3(Mathf.Sin(a) * r, c.Random(0.2f, 1.5f), Mathf.Cos(a) * r);
                Fx.Burst(p, WarlordDef.Embers, 3, 1.4f, 1.1f, 0.1f, -3f);
            }));
            cues.Add(IntroCue.NameCard(3.6f, 2.5f));
            IntroFx.Wind(this, WarlordDef.Embers);
            fxShots.Add((2.3f, "fall"));
            fxShots.Add((2.7f, "slam"));
            fxShots.Add((3.1f, "after"));
        }
    }
}
