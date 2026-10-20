using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效门面（docs/unity-parity.md F1；对应 Three.js 的 IFx / src/fx/Fx.ts）。玩法代码只调这里：
    ///   Play（按预设 id）、Burst、Ring、EnemyHit、Explosion、Impact、Beam、Lightning、Tracer、Flash、Slash。
    /// 每个入口都返回 <see cref="FxHandle"/>（可取消、可改端点 / 位置；不需要就丢掉）。
    /// 背后是池化的 Shuriken 共享发射器（每种粒子风格一个，预设在 G/Fx/Presets，FxBuilder 生成预制体和材质）、
    /// 池化的线（<see cref="FxLines"/>、<see cref="Spiritfire.Game.Lightning"/>）、闪光灯（<see cref="FxLightPool"/>）、贴地环（<see cref="Telegraph"/>）。
    /// 所有入口丢弃非有限的位置 / 参数（NaN 写进灯或粒子会让整片画面出错）；编辑器非 Play 时什么都不做。
    /// 粒子数量乘画质密度（<see cref="Density"/>：低 0.45 / 中 0.75 / 高 1，同 Three.js）。
    /// 旧接口 ShotFx / Lightning.Spawn / SlashArc.Spawn / Telegraph.* 照常可用（ShotFx 是转发到这里的兼容层）。
    /// </summary>
    public static class Fx
    {
        // 默认颜色（Three.js Fx.ts）
        public static readonly Color ImpactColor = Hex.Rgb(0xffc98a);
        public static readonly Color HitColor = Hex.Rgb(0xffd2a0);
        public static readonly Color TracerColor = Hex.Rgb(0xffe0a0);
        public static readonly Color ExplosionColor = Hex.Rgb(0xff8a3a);
        public static readonly Color RingColor = Hex.Rgb(0xffd9a0);
        public static readonly Color WarningColor = Hex.Rgb(0xff3030);
        public static readonly Color BeamColor = Hex.Rgb(0x6fd8ff);
        public static readonly Color LightningColor = Hex.Rgb(0x8fe3ff);
        public static readonly Color EnemyColor = Hex.Rgb(0xff4455);

        /// <summary>冲击环的竖直光墙只给中小型环（2–8 m）：Boss 的 10–15 m 装饰大环若也立一圈光墙，会和真正要跳过的冲击波混淆</summary>
        public const float BandMinRadius = 2f, BandMaxRadius = 8f;

        /// <summary>粒子密度（数量倍率）：画质低 0.45 / 中 0.75 / 高 1</summary>
        public static float Density => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 0.45f,
            ArtQualityLevel.Medium => 0.75f,
            _ => 1f,
        };

        // ───────────── 按预设播放 ─────────────

        /// <summary>按预设 id 播放（G/Fx/Presets 里登记的 FxPreset）：scale 是规模（弹着点 = size，爆炸 = 半径）</summary>
        public static FxHandle Play(string presetId, Vector3 position, Vector3 normal, Color color, float scale = 1)
        {
            var p = Registry<FxPreset>.Get(presetId);
            if (p == null)
            {
                Debug.LogWarning($"[Fx] 没有特效预设「{presetId}」");
                return FxHandle.None;
            }
            return Play(p, position, normal, color, scale);
        }

        /// <summary>按预设播放，颜色用预设的默认色、法线朝上</summary>
        public static FxHandle Play(string presetId, Vector3 position, float scale = 1)
        {
            var p = Registry<FxPreset>.Get(presetId);
            return p == null ? FxHandle.None : Play(p, position, Vector3.up, p.DefaultColor, scale);
        }

        public static FxHandle Play(FxPreset preset, Vector3 position, Vector3 normal, Color color, float scale = 1)
        {
            if (preset == null || !Finite(position)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            return rt ? rt.Play(preset, position, Finite(normal) ? normal : Vector3.up, color, scale) : FxHandle.None;
        }

        // ───────────── 组合特效 ─────────────

        /// <summary>
        /// 弹着点（打在地形 / 建筑上）：反射火花、命中闪光、尘土、小碎屑。size 0.2–4（大命中速度、大小按 √size 变，数量按 size 变）。
        /// 预设 Presets/Impact.cs。
        /// </summary>
        public static FxHandle Impact(Vector3 point, Vector3 normal, Color color, float size = 1) =>
            Play("Impact", point, normal, color, size);

        public static FxHandle Impact(Vector3 point, Vector3 normal, float size = 1) => Impact(point, normal, ImpactColor, size);

        /// <summary>
        /// 打中敌人：闪光、带重力的能量溅射、敌人色碎块、火花；暴击再加金色星芒、白热核心、一圈水平拉丝（规模 ×1.7）。
        /// 预设 Presets/EnemyHit.cs、EnemyHitCrit.cs。
        /// </summary>
        public static FxHandle EnemyHit(Vector3 point, Color color, bool crit = false, float scale = 1) =>
            Play(crit ? "EnemyHitCrit" : "EnemyHit", point, Vector3.up, color, crit ? scale * 1.7f : scale);

        /// <summary>
        /// 爆炸：闪光球、白热核心、火团、火花、余烬、烟、碎石、贴地冲击环、闪光灯、按距离震屏。radius 0.4–12 m。
        /// 预设 Presets/Explosion.cs。
        /// </summary>
        public static FxHandle Explosion(Vector3 center, float radius, Color color) =>
            Play("Explosion", center, Vector3.up, color, radius);

        public static FxHandle Explosion(Vector3 center, float radius) => Explosion(center, radius, ExplosionColor);

        /// <summary>
        /// 参数化爆发（同 Three.js fx.burst）：count 颗发光粒子以 speed 向四周迸出，活 life 秒、直径约 size 米，gravity &gt; 0 下坠、&lt; 0 上浮；
        /// speed ≥ 5 时带拉丝火花，数量 ≥ 6 时中心一闪。沙 / 土 / 灰烟色（低彩度暖灰）自动改走普通混合的烟尘粒子。
        /// </summary>
        public static FxHandle Burst(Vector3 position, Color color, int count = 12, float speed = 4, float life = 0.5f, float size = 0.12f, float gravity = 0)
        {
            if (!Finite(position) || count < 1) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            speed = Finite(speed) ? Mathf.Max(0, speed) : 4;
            life = Mathf.Min(5, Positive(life, 0.5f));
            size = Mathf.Min(3, Positive(size, 0.12f));
            gravity = Finite(gravity) ? gravity : 0;
            return rt.Burst(position, color, count, speed, life, size, gravity);
        }

        /// <summary>
        /// 贴地扩散冲击环：duration 秒内缓出扩到 radius（读作「这一下的爆发范围」），中小型环（2–8 m）带一圈竖直光墙。
        /// 纯装饰（Boss 真正要跳的冲击波由 BossHazards 自己画）。
        /// </summary>
        public static FxHandle Ring(Vector3 center, float radius, Color color, float duration = 0.5f, bool band = true)
        {
            if (!Finite(center) || !(radius > 0) || !Finite(radius)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            radius = Mathf.Min(60, radius);
            duration = Mathf.Min(5, Positive(duration, 0.5f));
            var j = rt.TakeJob();
            j.ring = Telegraph.Ring(center, radius, duration, color);
            if (band && radius >= BandMinRadius && radius <= BandMaxRadius)
                j.extra = rt.Wall(center, radius, Mathf.Clamp(radius * 0.055f, 0.15f, 0.42f), color, duration, true);
            j.until = Time.time + duration;
            return new FxHandle(j);
        }

        // ───────────── 线状特效 ─────────────

        /// <summary>
        /// 持续光束（每帧调用会合并成同一条：同一发射点、同色）：外层光晕 + 中层 + 白热核心，宽度高频抖动，末端溅火花。
        /// 句柄可 Retarget（跟随枪口 / 目标）、Cancel（0.1 s 淡出）。
        /// </summary>
        public static FxHandle Beam(Vector3 from, Vector3 to, Color color, float width = 0.18f, float duration = 0.1f)
        {
            if (!Finite(from) || !Finite(to)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            return rt ? rt.Lines.Beam(from, to, color, Mathf.Min(2, Positive(width, 0.18f)), Mathf.Min(10, Positive(duration, 0.1f))) : FxHandle.None;
        }

        public static FxHandle Beam(Vector3 from, Vector3 to, float width = 0.18f, float duration = 0.1f) => Beam(from, to, BeamColor, width, duration);

        /// <summary>锯齿闪电（主干 + 分叉，0.035 s 重抖一次，约 0.17 s），两端溅电火花、落点闪灯。width 0.07 = 标准粗细</summary>
        public static FxHandle Lightning(Vector3 from, Vector3 to, Color color, float width = 0.07f) =>
            Spiritfire.Game.Lightning.Spawn(from, to, color, width);

        public static FxHandle Lightning(Vector3 from, Vector3 to) => Lightning(from, to, LightningColor);

        /// <summary>弹道曳光：淡淡的整段弹道 + 明亮的弹头拖尾（0.06–0.1 s）。width = 弹头宽度（米）</summary>
        public static FxHandle Tracer(Vector3 from, Vector3 to, Color color, float width = 0.05f)
        {
            if (!Finite(from) || !Finite(to)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            return rt ? rt.Lines.Tracer(from, to, color, width) : FxHandle.None;
        }

        /// <summary>刀光弧（见 <see cref="SlashArc.Spawn"/>）</summary>
        public static FxHandle Slash(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float duration, Color color) =>
            SlashArc.Spawn(center, yawDeg, radius, arc, dir, tilt, width, duration, color);

        /// <summary>闪光灯（池化点光源，起亮极快、二次衰减）：intensity = URP 灯光强度，range = 半径（米），life = 秒</summary>
        public static FxHandle Flash(Vector3 position, Color color, float intensity = 6, float range = 6, float life = 0.12f, Transform follow = null) =>
            FxLightPool.Flash(position, color, intensity, range, life, follow);

        // ───────────── 管理 ─────────────

        /// <summary>全部清场（换关时自动调用；手动调用用于过场 / 结算）</summary>
        public static void Clear()
        {
            var rt = FxRuntime.Ensure();
            if (rt) rt.ClearAll();
        }

        /// <summary>预热着色器变体与每种粒子风格的绘制状态（换关时自动调用）</summary>
        public static void WarmUp()
        {
            var rt = FxRuntime.Ensure();
            if (rt) rt.WarmUp();
        }

        // ───────────── 工具 ─────────────

        public static bool Finite(float v) => !float.IsNaN(v) && !float.IsInfinity(v);

        public static bool Finite(Vector3 v) => Finite(v.x) && Finite(v.y) && Finite(v.z);

        static float Positive(float v, float fallback) => Finite(v) && v > 0 ? v : fallback;

        /// <summary>p 正下方（不高于 p.y + 0.1）的地面高度；maxDrop 米内没有地面返回负无穷</summary>
        public static float GroundY(Vector3 p, float maxDrop = 20f) =>
            Physics.Raycast(p + Vector3.up * 0.1f, Vector3.down, out var h, maxDrop + 0.1f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? h.point.y
                : float.NegativeInfinity;

        /// <summary>
        /// 「尘土 / 烟」色判定（Three.js isDustColor）：不太亮、低彩度、偏暖（沙、土、灰烟）。
        /// Burst 用它把尘土类颜色改走普通混合的烟尘粒子——加法混合的灰褐色看起来像发光雾而不是尘土。
        /// </summary>
        public static bool IsDustColor(Color c)
        {
            float max = Mathf.Max(c.r, Mathf.Max(c.g, c.b)), min = Mathf.Min(c.r, Mathf.Min(c.g, c.b));
            return max < 0.9f && max - min < 0.4f && c.r >= c.b - 0.02f;
        }
    }
}
