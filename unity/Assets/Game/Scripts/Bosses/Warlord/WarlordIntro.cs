using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将登场（3-3 铸范大坊 · 神范台，docs/level-design/boss-intros.md「熔心魔将」）：约 6.5 s。
    ///   0.0–1.9 dais    从玩家眼中拔起，贴地仰拍：越过出生点望向身后的神范台，镜头一路仰到天上——余烬往上飘，高处一团火光
    ///   1.6             生成（WarlordBrain 的登场：从 34 m 高处 1.04 s 砸下来、身后拖火，落地爆炸 + 火环 + 重震；70% = 3.4 s 时咆哮）
    ///   1.9–3.3 impact  侧面低机位跟拍下坠（看点 = 模型，胶囊不动），2.66 s 落地：熔铜四溅、地面一圈火环、闪屏、短慢动作
    ///   3.3–5.2 roar    仰拍特写，咆哮，余烬绕身，名字卡
    ///   5.2–6.5         拉回玩家眼睛
    /// 魔将还没有动作片段（部件骨架，ART8）：下坠、落地、咆哮的身体姿态都缺，这里只有位移和特效。
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

            shots.Add(IntroShot.Make("dais", 1.9f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, 5f, 0.9f, -15f), IntroPoint.At(IntroAnchors.Spawn, 4f, 0.8f, -12.5f))
                .Look(IntroPoint.At(IntroAnchors.Spawn, 0, 5f, 10f), IntroPoint.At(IntroAnchors.Spawn, 0, 24f, 4f))
                .Fov(58f, 54f).BlendIn(0.7f).Handheld(0.2f));
            shots.Add(IntroShot.Make("impact", 1.4f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, 12f, 1.4f, -10f), IntroPoint.At(IntroAnchors.Spawn, 10.5f, 1.8f, -9f))
                .Look(IntroPoint.At(IntroAnchors.Model, 0, 0, 0), IntroPoint.At(IntroAnchors.Model, 0, -0.3f, 0))
                .Fov(55f, 50f).Ease(IntroEase.Out).Handheld(0.3f));
            shots.Add(IntroShot.Make("roar", 1.9f)
                .Move(IntroPoint.Sized(IntroAnchors.Head, 1.8f, -1.6f, -5.2f), IntroPoint.Sized(IntroAnchors.Head, 1.1f, -1.3f, -4.0f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, 0.2f, 0))
                .Fov(42f, 36f).Handheld(0.35f));

            // 余烬从神范台那边往上飘，高处闷雷
            cues.Add(IntroCue.Every(0.2f, 1.9f, 0.12f, "embers", c =>
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
                Fx.Flash(sky, WarlordDef.Fire, 8f, 30f, 0.5f);
            }));
            // 落地（生成后 1.04 s）：熔铜四溅
            cues.Add(IntroCue.Call(2.66f, "copper splash", c =>
            {
                for (int i = 0; i < 7; i++)
                {
                    float a = i / 7f * Mathf.PI * 2 + c.Random(-0.3f, 0.3f), r = c.Random(1.5f, 4.5f) * Mathf.Max(0.8f, c.Size);
                    var p = c.Spawn + new Vector3(Mathf.Sin(a) * r, 0.3f, Mathf.Cos(a) * r);
                    Fx.Burst(p, i % 2 == 0 ? Copper : Slag, 14, 9f, 1.1f, 0.24f, 16f);
                }
                Fx.Ring(c.Spawn + Vector3.up * 0.1f, 18f, WarlordDef.Fire, 1f);
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
        }
    }
}
