using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃登场（1-4 鸣沙山月牙泉，docs/level-design/boss-intros.md「旱魃」）：约 7.9 s。
    ///   0.0–2.6 basin   从玩家眼中拔起，摇臂下压俯拍沙山盆地：月牙泉、泉南的月牙阁都在画里，泉心开始冒泡、沙山闷响
    ///   2.2             生成旱魃（它自己的 intro 片段：蜷起 → 舒展长啸，4 s；HanbaBrain 的长啸在片段 58% = 4.5 s，日轮炸亮 + 慢动作）
    ///   2.6–4.5 emerge  泉边贴水面的低机位微微抬起、仰拍：泉心炸开，旱魃从水下 6 m 缓缓升起（代码驱动模型位移，没有专用破水片段），身后的日轮跟着升起，水沙飞溅、身上金光褪去
    ///   4.5–6.5 roar    正面略偏的特写推近，机位和头差不多高：竖悬在头顶后方的日轮（SunRing 跟随支点，身后 1.8 m）正好衬在头后、头冠落在轮毂上，
    ///                   月牙阁在更远处；长啸（日轮炸亮、震屏、闪屏、慢动作由 HanbaBrain 自己放），名字卡
    ///   6.5–7.9         沿着决斗线拉回玩家眼睛
    /// 首领出生点就是月牙泉凸顶（关卡构建器 BossSpawn = 泉心），所以「泉」锚点 = 出生点；泉水组件（HanbaSpring）只用来判断有没有水花可放。
    /// </summary>
    [Defs]
    public sealed class HanbaIntro : BossIntroScript
    {
        /// <summary>从泉下升起：起始深度（米）与用时（秒，从生成算起）</summary>
        public const float RiseDepth = 6f, RiseSeconds = 1.6f;
        static readonly Color Water = Hex.Rgb(0xbfe6e0), Gold = Hex.Rgb(0xffd27a);

        public HanbaIntro()
        {
            id = HanbaDef.Id;
            spawnAt = 2.2f;
            landSeconds = 1.4f;
            epithet = "第一章 · 鸣沙山月牙泉";

            shots.Add(IntroShot.Make("basin", 2.6f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, -16f, 30f, -52f), IntroPoint.At(IntroAnchors.Spawn, -7f, 20f, -38f))
                .Look(IntroPoint.At(IntroAnchors.Spawn, 0, 1f, 8f), IntroPoint.At(IntroAnchors.Spawn, 0, 2f, 0))
                .Fov(52f, 46f).BlendIn(0.9f).Handheld(0.12f));
            // 贴着水面的低机位微微抬起、仰拍她和身后的日轮一起升出水面（日轮竖悬在身后，不挡脸，机位不用再躲）
            shots.Add(IntroShot.Make("emerge", 1.9f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, 6.5f, 0.8f, -11.5f), IntroPoint.At(IntroAnchors.Spawn, 5f, 2.0f, -10f))
                .Look(IntroPoint.At(IntroAnchors.Spawn, 0, 1.5f, 0), IntroPoint.At(IntroAnchors.Head, 0, -0.6f, 0))
                .Fov(48f, 44f).Ease(IntroEase.Out).Handheld(0.3f));
            // 光环构图：日轮竖悬在头顶后方 1.8 m、轮心略高于脸。机位和头差不多高、只偏一点点，轮毂正好落在头冠后面，轮辐从头后放射出去；
            // 偏得多了轮毂会因为视差滑到一边（身后 1.8 m），所以推近时一路收回到决斗线上
            shots.Add(IntroShot.Make("roar", 2.0f)
                .Move(IntroPoint.Sized(IntroAnchors.Head, 1.6f, 0f, -6.6f), IntroPoint.Sized(IntroAnchors.Head, 0.7f, 0f, -5.0f))
                .Look(IntroPoint.At(IntroAnchors.Head, 0, 0.3f, 0))
                .Fov(42f, 36f).Handheld(0.3f));

            // 泉心冒泡、沙山闷响
            cues.Add(IntroCue.Every(0.5f, 2.2f, 0.14f, "spring bubbles", c =>
            {
                var p = c.Spawn + new Vector3(c.Random(-1.5f, 1.5f), 0.2f, c.Random(-1.5f, 1.5f));
                Fx.Burst(p, HasSpring(c) ? Water : HanbaDef.Sand, 5, 2.5f, 0.6f, 0.18f, 6f);
            }));
            cues.Add(IntroCue.Shake(0.7f, 0.2f, 0.8f));
            cues.Add(IntroCue.Sfx(1.2f, "boss_roar", IntroAnchors.Spawn, 0.45f, 0.5f));
            cues.Add(IntroCue.Shake(1.8f, 0.35f, 0.6f));
            // 生成那一刻：泉心炸开
            cues.Add(IntroCue.Call(2.2f, "spring burst", c =>
            {
                var at = c.Spawn + Vector3.up * 0.4f;
                Fx.Burst(at, HasSpring(c) ? Water : HanbaDef.Sand, 40, 9f, 1.0f, 0.32f, 7f);
                Fx.Burst(at, HanbaDef.Sand, 24, 6f, 1.2f, 0.4f, 3f);
                Fx.Ring(c.Spawn + Vector3.up * 0.1f, 8f, HanbaDef.Sand, 0.8f);
                GameAudio.PlayAt("boss_slam", at, 0.7f, 0.6f);
                CameraShake.Add(0.45f, 0.6f);
            }));
            // 升起时水线上一圈飞溅
            cues.Add(IntroCue.Every(2.25f, 2.2f + RiseSeconds, 0.08f, "rise spray", c =>
            {
                float a = c.Random(0, Mathf.PI * 2), r = c.Random(1.2f, 2.8f) * Mathf.Max(0.8f, c.Size);
                var p = c.Spawn + new Vector3(Mathf.Sin(a) * r, 0.3f, Mathf.Cos(a) * r);
                Fx.Burst(p, HasSpring(c) ? Water : HanbaDef.Sand, 6, 4f, 0.7f, 0.2f, 9f);
            }));
            cues.Add(IntroCue.NameCard(4.8f, 2.6f));

            onTick = (c, dt) =>
            {
                if (!c.Boss) return;
                float s = c.SinceSpawn;
                // 没有破水片段：模型从泉下 RiseDepth 米升起（ease-out），身上的金光跟着褪去。
                // 跳过时（首领在跳过那一刻才生成）按落地进度赶完，交还镜头时已经升到位，不会在玩家眼前跳一下
                float rise = s / RiseSeconds, fade = s / 2.4f;
                if (c.Skipped)
                {
                    rise = Mathf.Max(rise, c.LandProgress);
                    fade = Mathf.Max(fade, c.LandProgress);
                }
                float k = IntroMath.Ease(IntroEase.Out, rise);
                if (k < 1f) c.OffsetModel(Vector3.down * (RiseDepth * (1f - k)));
                c.Overlay(Gold, Mathf.Clamp01(1f - fade) * 0.55f);
            };
        }

        /// <summary>场地里有月牙泉的水（1-4）：水花用水色，测试场用沙色。只看水体名字，不去挂 HanbaSpring（那是二阶段的事）</summary>
        static bool HasSpring(BossIntroContext c)
        {
            if (c.Bag.TryGetValue("spring", out var v)) return (bool)v;
            bool has = false;
            foreach (var w in WaterVolume.All)
                if (w && HanbaSpring.IsSpringWater(w))
                {
                    has = true;
                    break;
                }
            c.Bag["spring"] = has;
            return has;
        }
    }
}
