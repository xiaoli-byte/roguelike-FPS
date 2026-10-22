using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏登场（2-4 北冥冰台，docs/level-design/boss-intros.md「鲲鹏」）：约 7.6 s。
    ///   0.0–2.3 abyss   从玩家眼中拔起，高处环绕俯拍环形冰台和中央冰窟：水面翻涌、一圈圈涟漪，深处一声闷吼
    ///   1.8             生成（鲲在水下 13 m；KunPengBrain 的登场：0.3–2.4 s 升起、2.16 s 吼叫并在冰沿炸一圈）
    ///   2.3–4.3 breach  贴着水面的低机位、正对破水点：水柱炸开，鲲破水而出（升起是 KunPengBrain 的 Sunk，这里补水柱、飞沫、短慢动作）
    ///   4.3–6.2 pearl   仰拍头部和额前的鲛珠（弱点），名字卡
    ///   6.2–7.6         拉回玩家眼睛
    /// 锚点：hole = 冰窟圆心（水面高度），breach = 鲲升起的位置（出生点那一侧、离圆心 KunRing，水面高度）——都按 <see cref="IceHole.Resolve"/>，测试场里是虚拟冰窟。
    /// </summary>
    [Defs]
    public sealed class KunPengIntro : BossIntroScript
    {
        public const string Hole = "hole", Breach = "breach";
        static readonly Color Foam = Hex.Rgb(0xeefcff);

        public KunPengIntro()
        {
            id = KunPengDef.Id;
            spawnAt = 1.8f;
            landSeconds = 1.4f;
            epithet = "第二章 · 北冥冰台";
            anchors[Hole] = c => Info(c).center + Vector3.up * (Info(c).waterY - Info(c).center.y);
            anchors[Breach] = c =>
            {
                var h = Info(c);
                float theta = h.Distance(c.Spawn) > 0.5f ? h.Angle(c.Spawn) : 0f;
                var p = h.Point(theta, Mathf.Max(1f, h.radius - 4.6f));
                return new Vector3(p.x, h.waterY, p.z);
            };

            shots.Add(IntroShot.Make("abyss", 2.3f)
                .Move(IntroPoint.At(Hole, -14f, 22f, -26f), IntroPoint.At(Hole, -4f, 17f, -24f))
                .Look(IntroPoint.At(Hole), IntroPoint.At(Hole, 0, 0, 2f))
                .Fov(56f, 50f).Orbit().BlendIn(0.8f).Handheld(0.12f));
            shots.Add(IntroShot.Make("breach", 2.0f)
                .Move(IntroPoint.At(Breach, 7f, 1.2f, -12f), IntroPoint.At(Breach, 5.5f, 1.6f, -10f))
                .Look(IntroPoint.At(Breach, 0, 1f, 0), IntroPoint.At(IntroAnchors.Head, 0, 0.5f, 0))
                .Fov(50f, 44f).Ease(IntroEase.Out).Handheld(0.4f));
            shots.Add(IntroShot.Make("pearl", 1.9f)
                // 鲲的头离水面只有 4 m 上下：机位压得不深（体型大时乘出来也不至于钻进水里）
                .Move(IntroPoint.Sized(IntroAnchors.Head, -2.2f, -0.7f, -7.5f), IntroPoint.Sized(IntroAnchors.Head, -1.4f, -0.45f, -5.6f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, 0.6f, 0))
                .Fov(40f, 34f).Handheld(0.35f));

            // 水面翻涌：冰窟里到处冒水花，隔一会儿一圈涟漪
            cues.Add(IntroCue.Every(0.3f, 2.3f, 0.1f, "churn", c =>
            {
                var h = Info(c);
                float a = c.Random(0, Mathf.PI * 2), r = Mathf.Sqrt(c.Random(0f, 1f)) * h.radius * 0.8f;
                var p = new Vector3(h.center.x + Mathf.Sin(a) * r, h.waterY + 0.15f, h.center.z + Mathf.Cos(a) * r);
                Fx.Burst(p, KunPengDef.Ice, 6, 3.5f, 0.7f, 0.22f, 8f);
            }));
            cues.Add(IntroCue.Every(0.6f, 2.3f, 0.45f, "ripples", c =>
            {
                var h = Info(c);
                float a = c.Random(0, Mathf.PI * 2), r = c.Random(0.2f, 0.7f) * h.radius;
                Fx.Ring(new Vector3(h.center.x + Mathf.Sin(a) * r, h.waterY + 0.05f, h.center.z + Mathf.Cos(a) * r), c.Random(2.5f, 4.5f), KunPengDef.Warn, 0.9f);
            }));
            cues.Add(IntroCue.Shake(0.8f, 0.2f, 0.8f));
            cues.Add(IntroCue.Sfx(0.9f, "boss_roar", Hole, 0.5f, 0.45f));
            cues.Add(IntroCue.Shake(1.7f, 0.35f, 0.6f));
            // 破水：鲲从 2.1 s（生成后 0.3 s）开始往上冲
            cues.Add(IntroCue.Call(2.15f, "breach", c =>
            {
                var at = c.Anchor(Breach) + Vector3.up * 0.3f;
                Fx.Burst(at, Foam, 60, 12f, 1.2f, 0.36f, 9f);
                Fx.Burst(at, KunPengDef.Ice, 30, 7f, 1.4f, 0.5f, 5f);
                Fx.Ring(at, 10f, KunPengDef.Warn, 1f);
                GameAudio.PlayAt("boss_slam", at, 0.8f, 0.55f);
                CameraShake.Add(0.5f, 0.7f);
                GameUI.ScreenFlash(new Color(0.75f, 0.95f, 1f, 0.22f), 0.35f);
            }));
            cues.Add(IntroCue.Every(2.2f, 3.6f, 0.07f, "spray", c =>
            {
                float a = c.Random(0, Mathf.PI * 2), r = c.Random(2.5f, 5.5f) * Mathf.Max(0.8f, c.Size * 0.6f);
                var p = c.Anchor(Breach) + new Vector3(Mathf.Sin(a) * r, 0.2f, Mathf.Cos(a) * r);
                Fx.Burst(p, Foam, 5, 5f, 0.8f, 0.25f, 10f);
            }));
            cues.Add(IntroCue.SlowMo(3.0f, 0.4f, 0.35f));
            cues.Add(IntroCue.NameCard(4.5f, 2.5f));
        }

        static IceHoleInfo Info(BossIntroContext c)
        {
            if (c.Bag.TryGetValue("hole", out var v)) return (IceHoleInfo)v;
            var h = IceHole.Resolve(c.Arena, c.Spawn, out _);
            c.Bag["hole"] = h;
            return h;
        }
    }
}
