using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 登场演出共用的特效小件（特效打磨 C 路）：镜头转场的风（视觉部分）、液面高度。各首领的 *Intro.cs 在镜头表之后调用。
    /// </summary>
    public static class IntroFx
    {
        /// <summary>
        /// 镜头转场的风：从玩家眼中拔起的那一下（第一镜的过渡）、每次硬切、落回第一人称那一下，各在镜头前横扫过一阵淡色风线 + 几缕尘。
        /// 拔起 / 落回的那两下更强。tint = 场地色（沙黄 / 冰白 / 余烬橙）
        /// </summary>
        public static void Wind(BossIntroScript script, Color tint)
        {
            if (script == null || script.shots.Count == 0) return;
            script.cues.Add(IntroCue.Call(0.08f, "wind:lift", c => Gust(c, tint, 1.3f, true)));
            for (int i = 1; i < script.shots.Count; i++)
            {
                int n = i;
                script.cues.Add(IntroCue.Call(script.ShotStart(i) + 0.02f, "wind:cut" + n, c => Gust(c, tint, 0.7f, n % 2 == 0)));
            }
            script.cues.Add(IntroCue.Call(script.ShotsSeconds + 0.05f, "wind:land", c => Gust(c, tint, 1.2f, false)));
        }

        static void Gust(BossIntroContext c, Color tint, float strength, bool leftToRight)
        {
            var cam = c.Camera;
            if (!cam) return;
            var t = cam.transform;
            var sweep = (leftToRight ? t.right : -t.right) + t.forward * 0.25f;
            Fx.WindGust(t.position, t.forward, sweep, tint, strength);
        }

        /// <summary>p 处的水面高度（p 在某个水体里）；没有水体返回 false</summary>
        public static bool WaterSurface(Vector3 p, out float y)
        {
            var w = WaterVolume.At(p + Vector3.up * 0.1f, out _);
            if (!w)
            {
                // 出生点在泉心凸顶上（略高于水面）：往下找一下
                w = WaterVolume.At(p - Vector3.up * 0.6f, out _);
            }
            y = w ? w.Surface : p.y;
            return w;
        }
    }
}
