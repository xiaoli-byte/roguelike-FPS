using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟登场（3-4 祝融炉心，docs/level-design/boss-intros.md「火麒麟」）：约 7.0 s。
    ///   0.0–2.4 furnace 从玩家眼中拔起，殿内中景：熔池咕嘟冒泡、一圈圈热浪，镜头仰到悬在池上的青铜巨鼎——鼎被地底的震动晃起来、链子哐当
    ///   2.0             生成（QilinBrain 的登场：熔池喷出熔岩柱，0.38–1.44 s 从池心跃起划一道 7 m 高的弧落到出生点，落地人立长啸）
    ///   2.4–3.8 leap    侧面机位跟拍跃出的弧线（看点 = 模型），弧顶短慢动作、带出的熔浆往下滴，鼎被带得猛晃
    ///   3.8–5.7 rear    仰拍人立长啸的麒麟，巨鼎在它头顶后方，名字卡
    ///   5.7–7.0         拉回玩家眼睛
    /// 锚点：pool = 熔池圆心（QilinFurnace；测试场里首领生成时才建，之前退回场地中心——两者重合），cauldron = 吊鼎的鼎身（没有就熔池上方 7.2 m）。
    /// </summary>
    [Defs]
    public sealed class QilinIntro : BossIntroScript
    {
        public const string Pool = "pool", Cauldron = "cauldron";

        public QilinIntro()
        {
            id = QilinDef.Id;
            spawnAt = 2.0f;
            landSeconds = 1.3f;
            epithet = "第三章 · 祝融炉心";
            anchors[Pool] = c =>
            {
                var f = QilinFurnace.For(c.Arena);
                if (f) return f.Center;
                if (c.Arena) return c.Arena.Center;
                return null;
            };
            anchors[Cauldron] = c =>
            {
                var ding = FindCauldron(c)?.Ding;
                return ding ? ding.position : c.Anchor(Pool) + Vector3.up * 7.2f;
            };

            // 殿内中景、正对熔池、比柱头略高：熔池在下半、整只吊鼎连同链子在上半，玩家身前那两根饕餮柱在画面两边当框，
            // 镜头从池面慢慢仰到鼎腹（原来机位太近太低，钻到鼎底下；偏到一边时又有一根柱子挡掉三分之一画面）
            shots.Add(IntroShot.Make("furnace", 2.4f)
                .Move(IntroPoint.At(Pool, 0.5f, 5.2f, -17.5f), IntroPoint.At(Pool, -1f, 5.8f, -15.5f))
                .Look(IntroPoint.At(Pool, 0, 2f, 0), IntroPoint.At(Cauldron, 0, -2f, 0))
                .Fov(56f, 50f).BlendIn(0.7f).Handheld(0.2f));
            shots.Add(IntroShot.Make("leap", 1.4f)
                .Move(IntroPoint.At(Pool, 12f, 1.6f, -3f), IntroPoint.At(Pool, 11f, 2.2f, -1.5f))
                .Look(IntroPoint.At(IntroAnchors.Model))
                .Fov(54f, 50f).Ease(IntroEase.Out).Handheld(0.3f));
            shots.Add(IntroShot.Make("rear", 1.9f)
                .Move(IntroPoint.Sized(IntroAnchors.Head, -2.0f, -1.8f, -5.8f), IntroPoint.Sized(IntroAnchors.Head, -1.3f, -1.5f, -4.4f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, 0.3f, 0))
                .Fov(42f, 36f).Handheld(0.35f));

            // 熔池涌动
            cues.Add(IntroCue.Every(0.2f, 2.4f, 0.09f, "lava bubbles", c =>
            {
                float r = PoolRadius(c);
                float a = c.Random(0, Mathf.PI * 2), d = Mathf.Sqrt(c.Random(0f, 1f)) * r * 0.85f;
                var p = c.Anchor(Pool) + new Vector3(Mathf.Sin(a) * d, 0.1f, Mathf.Cos(a) * d);
                Fx.Burst(p, c.Random(0f, 1f) < 0.5f ? QilinDef.Fire : QilinDef.Hot, 5, 3f, 0.7f, 0.22f, 7f);
            }));
            cues.Add(IntroCue.Every(0.4f, 2.4f, 0.35f, "heat rings", c =>
                Fx.Ring(c.Anchor(Pool) + Vector3.up * 0.1f, PoolRadius(c) * c.Random(0.5f, 1f), QilinDef.Warn, 0.8f)));
            // 吊鼎被地底的震动晃起来
            cues.Add(IntroCue.Call(0.5f, "cauldron sway", c =>
            {
                FindCauldron(c)?.Rattle(2.5f);
                GameAudio.PlayAt("boss_slam", c.Anchor(Cauldron), 0.35f, 0.5f);
            }));
            cues.Add(IntroCue.Shake(0.6f, 0.2f, 0.7f));
            cues.Add(IntroCue.Call(1.5f, "cauldron jolt", c =>
            {
                FindCauldron(c)?.Rattle(3.5f);
                GameAudio.PlayAt("explosion", c.Anchor(Pool), 0.5f, 0.5f);
                CameraShake.Add(0.35f, 0.6f);
            }));
            // 熔池炸开、麒麟跃出
            cues.Add(IntroCue.Call(2.0f, "eruption", c =>
            {
                var at = c.Anchor(Pool) + Vector3.up * 0.3f;
                Fx.Burst(at, QilinDef.Fire, 50, 10f, 1.0f, 0.32f, 8f);
                Fx.Burst(at, QilinDef.Hot, 24, 6f, 1.2f, 0.45f, 4f);
                GameAudio.PlayAt("explosion", at, 0.7f, 0.6f);
                CameraShake.Add(0.4f, 0.6f);
            }));
            cues.Add(IntroCue.Every(2.4f, 3.4f, 0.06f, "lava drips", c =>
                Fx.Burst(c.Anchor(IntroAnchors.Model), QilinDef.Fire, 5, 2.5f, 0.6f, 0.2f, 12f)));
            cues.Add(IntroCue.SlowMo(2.9f, 0.4f, 0.3f));
            cues.Add(IntroCue.Call(2.95f, "cauldron swing", c => FindCauldron(c)?.Rattle(4f)));
            cues.Add(IntroCue.NameCard(4.0f, 2.5f));
        }

        static QilinCauldron FindCauldron(BossIntroContext c)
        {
            if (c.Bag.TryGetValue("cauldron", out var v) && v is QilinCauldron k && k) return k;
            var found = QilinCauldron.Nearest(c.Anchor(Pool));
            // 太远的不是这座殿的（同 QilinBrain：离熔池 10 m 以内）
            if (found)
            {
                var d = found.transform.position - c.Anchor(Pool);
                d.y = 0;
                if (d.magnitude > 10f) found = null;
            }
            if (found) c.Bag["cauldron"] = found;
            return found;
        }

        static float PoolRadius(BossIntroContext c)
        {
            var f = QilinFurnace.For(c.Arena);
            return f ? f.poolRadius : 6f;
        }
    }
}
