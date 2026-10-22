using System;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 沙山（1-4 鸣沙山月牙泉新增，其他沙漠图也能用）：弧形月牙（泉床遮罩）、新月形沙丘（barchan）、环形沙山（盆地四周的尖脊大沙山）。归 L4。
    // Landform.Crescent 是「大圆减小圆」的月牙（内圆半径固定 0.86 r），只能做粗胖的 C 形；这里的弧形月牙沿一段圆弧铺开、两头收尖，
    // 能做真实月牙泉那样长宽比 4 : 1 上下的细长弯月。
    public static partial class LevelKit
    {
        // ───────────── 弧形月牙 ─────────────

        /// <summary>
        /// 弧形月牙：中线是以 center 为圆心、radius 为半径的一段圆弧，凸顶朝 facing，两个尖角各离凸顶 halfSpan 度；
        /// 半宽在凸顶最大（halfWidth），往两头按 cos(along × 90°)^taper 收成尖。凹侧（圆心那边）就是「月牙怀里」。
        /// </summary>
        public struct CrescentArc
        {
            /// <summary>弧的圆心（世界 XZ，在月牙凹侧）</summary>
            public Vector2 center;
            /// <summary>中线半径（米）</summary>
            public float radius;
            /// <summary>凸顶方向（度，0 = +X，90 = +Z）</summary>
            public float facing;
            /// <summary>半张角（度）：尖角离凸顶多少度</summary>
            public float halfSpan;
            /// <summary>凸顶处的半宽（米）</summary>
            public float halfWidth;
            /// <summary>收尖指数（0.6 左右像月牙；越大越早收细）</summary>
            public float taper;

            public CrescentArc(Vector2 center, float radius, float facing, float halfSpan, float halfWidth, float taper = 0.6f)
            {
                this.center = center;
                this.radius = radius;
                this.facing = facing;
                this.halfSpan = halfSpan;
                this.halfWidth = halfWidth;
                this.taper = taper;
            }

            static Vector2 Dir(float deg) => new(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad));

            /// <summary>along（−1…1，0 = 凸顶；正 = 从凸顶逆时针那一侧）处中线外偏 across 米（朝凸侧为正）的点</summary>
            public readonly Vector2 At(float along, float across = 0) => center + Dir(facing + along * halfSpan) * (radius + across);

            /// <summary>along 处沿中线的方向（along 增大的方向，单位向量）</summary>
            public readonly Vector2 Tangent(float along)
            {
                var d = Dir(facing + along * halfSpan);
                return new Vector2(-d.y, d.x);
            }

            /// <summary>along 处的半宽（米；尖角以外为 0）</summary>
            public readonly float HalfWidthAt(float along) =>
                Mathf.Abs(along) >= 1 ? 0 : halfWidth * Mathf.Pow(Mathf.Cos(along * Mathf.PI * 0.5f), taper);

            /// <summary>中线全长（米）</summary>
            public readonly float Length => radius * 2 * halfSpan * Mathf.Deg2Rad;
        }

        /// <summary>
        /// 弧形月牙的局部坐标：along（−1…1 在月牙里，超出 = 尖角外）、across（离中线的米数，朝凸侧为正）、该处半宽（尖角以外为 0）
        /// </summary>
        public static void CrescentLocal(Vector2 p, in CrescentArc c, out float along, out float across, out float halfWidth)
        {
            var d = p - c.center;
            float ang = Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg;
            along = Mathf.DeltaAngle(c.facing, ang) / Mathf.Max(1e-3f, c.halfSpan);
            across = d.magnitude - c.radius;
            halfWidth = c.HalfWidthAt(along);
        }

        /// <summary>月牙遮罩：半宽内 1，feather 米内落到 0；尖角以外 0</summary>
        public static float CrescentMask(Vector2 p, in CrescentArc c, float feather)
        {
            CrescentLocal(p, c, out _, out float across, out float hw);
            if (hw <= 0) return 0;
            return 1 - Smooth(hw - feather, hw, Mathf.Abs(across));
        }

        // ───────────── 新月形沙丘 ─────────────

        /// <summary>
        /// 新月形沙丘（barchan）：迎风背缓、落沙坡陡，两只角顺风拖出去。crest = 落沙坡顶（脊线正中），wind = 风吹去的方向（落沙坡、两角朝这边）；
        /// height 脊高、halfWidth 半宽（两角之间）、windward 迎风背长、horn 两角比脊线正中多往下风拖多远、slip 落沙坡角（度）。
        /// 落沙坡比太阳仰角陡才有影子，而影子只是一道薄楔：坡脚处厚 height × (1 − tan 日光仰角 / tan 落沙坡角)——太阳 31°、落沙坡 36° 时约 0.17 × 高。
        /// </summary>
        public struct Barchan
        {
            public Vector2 crest, wind;
            public float height, halfWidth, windward, horn, slip;
            public int seed;

            public Barchan(Vector2 crest, Vector2 wind, float height, float halfWidth, float windward, float horn, float slip, int seed)
            {
                this.crest = crest;
                this.wind = wind.sqrMagnitude > 1e-6f ? wind.normalized : Vector2.right;
                this.height = height;
                this.halfWidth = halfWidth;
                this.windward = windward;
                this.horn = horn;
                this.slip = slip;
                this.seed = seed;
            }

            /// <summary>落沙坡水平宽（米）</summary>
            public readonly float SlipRun => height / Mathf.Tan(slip * Mathf.Deg2Rad);

            /// <summary>脊线正中往下风 distance 米的点（落沙坡上 / 坡脚：掩体点、影子）</summary>
            public readonly Vector2 Lee(float distance) => crest + wind * distance;

            /// <summary>脊线正中往上风 distance 米的点（迎风背）</summary>
            public readonly Vector2 Back(float distance) => crest - wind * distance;

            /// <summary>包围盒外扩 margin 米（逐点求值时先剔掉远处）</summary>
            public readonly bool Near(Vector2 p, float margin)
            {
                var d = p - crest;
                float u = Vector2.Dot(d, wind), v = Vector2.Dot(d, new Vector2(-wind.y, wind.x));
                return u > -windward - margin && u < SlipRun + horn + margin && Mathf.Abs(v) < halfWidth + margin;
            }
        }

        /// <summary>
        /// 新月形沙丘高度（0–height）：横向 t = 离中线 / 半宽，脊高 height × (1 − t²)^1.5（两侧最陡约 atan(1.5 × 高 / 半宽)，到两角切线放平）、脊线顺风弯出 horn × t²（两角拖在下风）；
        /// 脊线上风是迎风背 crest × (1 − d / 背长)^1.3（坡脚切线水平、近脊最陡 1.3 × 高 / 背长），下风是 slip 度的直坡落到 0。
        /// 脊线位置叠 ±0.8 m 噪声，读起来不是尺子画的。slipFace = 落沙坡遮罩（分层、散布用）。
        /// </summary>
        public static float BarchanHeight(Vector2 p, in Barchan b, out float slipFace)
        {
            slipFace = 0;
            if (!b.Near(p, 2f)) return 0;
            var d = p - b.crest;
            float u = Vector2.Dot(d, b.wind) + 0.8f * Fbm(p, 10, 2, b.seed);
            float v = Vector2.Dot(d, new Vector2(-b.wind.y, b.wind.x));
            float t = v / Mathf.Max(0.1f, b.halfWidth);
            if (Mathf.Abs(t) >= 1) return 0;
            float t2 = t * t;
            float crestH = b.height * Mathf.Pow(1 - t2, 1.5f);
            float uc = b.horn * t2;
            if (u <= uc)
            {
                float back = b.windward * (1 - 0.35f * t2);
                return crestH * Mathf.Pow(Mathf.Clamp01(1 - (uc - u) / Mathf.Max(0.1f, back)), 1.3f);
            }
            float h = Mathf.Max(0, crestH - (u - uc) * Mathf.Tan(b.slip * Mathf.Deg2Rad));
            slipFace = h > 0.2f ? 1 : 0;
            return h;
        }

        // ───────────── 环形沙山 ─────────────

        /// <summary>
        /// 环形沙山：盆底是一个边缘不规则的椭圆，四周一圈尖脊大沙山。每个方位上：内坡从盆底边缘起，先是一段凹形坡脚（apron），再直坡升到脊；
        /// 外坡从脊直落到环外地面（outside）。坡角按风向分：坡面朝下风的是落沙坡（陡），朝上风的是迎风坡（缓）——
        /// 风从西南偏西吹来时，西环的内坡（朝东）是落沙坡，下午的太阳从背后照不到，影子落在它的坡脚。
        /// 内外坡在脊线上直接相交，脊是刀刃一样的尖脊（鸣沙山的样子），不是圆包。
        /// </summary>
        public sealed class DuneRingSpec
        {
            /// <summary>盆底椭圆：中心、半轴（米）</summary>
            public Vector2 center, axes;
            /// <summary>盆底边缘的不规则（半径比例）</summary>
            public float floorNoise = 0.05f;
            /// <summary>风吹去的方向（单位向量）</summary>
            public Vector2 wind = Vector2.right;
            /// <summary>内坡：迎风坡角、落沙坡角；外坡：迎风坡角、落沙坡角（度）</summary>
            public float innerWindward = 27f, innerSlip = 36f, outerWindward = 16f, outerSlip = 32f;
            /// <summary>内坡底部凹形坡脚占内坡宽的比例</summary>
            public float apron = 0.2f;
            /// <summary>方位角（弧度，0 = +X、逆时针）→ 脊高（米，相对盆底）</summary>
            public Func<float, float> crest;
            /// <summary>脊线前后摆动（米）：同样的脊高，内坡宽一点窄一点</summary>
            public float crestWobble = 7f;
            /// <summary>环外地面（沙海）高度；null = 0</summary>
            public Func<Vector2, float> outside;
            /// <summary>坡面上的细小起伏（米）</summary>
            public float faceNoise = 0.6f;
            public int seed;
        }

        /// <summary>环形沙山在某点的局部量</summary>
        public struct DuneRingPoint
        {
            /// <summary>离盆底边缘的米数（盆内为负）</summary>
            public float u;
            /// <summary>该方位的内坡水平宽、脊高（米）、内坡坡角（度）、方位角（弧度）</summary>
            public float width, crest, innerSlope, angle;
            /// <summary>该方位的盆底边缘半径（米，离 center）</summary>
            public float floorRadius;
            /// <summary>0–1：在内坡上（坡脚 0 → 脊 1）；外坡 / 环外为 1</summary>
            public readonly float Rise => width > 0 ? Mathf.Clamp01(u / width) : 0;
        }

        /// <summary>盆底边缘离中心多远（方位角 angle 弧度）</summary>
        public static float DuneRingFloorRadius(DuneRingSpec s, float angle)
        {
            float c = Mathf.Cos(angle) / Mathf.Max(1, s.axes.x), sn = Mathf.Sin(angle) / Mathf.Max(1, s.axes.y);
            return 1 / Mathf.Sqrt(c * c + sn * sn) * (1 + s.floorNoise * Loop(angle, 5, 2, s.seed + 3));
        }

        /// <summary>坡角（度）：坡面朝下风（下坡方向 downhill 与风向同向）的取落沙坡角，逆风的取迎风坡角</summary>
        static float FaceAngle(Vector2 downhill, Vector2 wind, float windward, float slip) =>
            Mathf.Lerp(windward, slip, Smooth(0.15f, 0.75f, Vector2.Dot(downhill, wind)));

        /// <summary>环形沙山高度（相对盆底，盆内 0）；q = 局部量（分层、可玩区、验收用）</summary>
        public static float DuneRing(Vector2 p, DuneRingSpec s, out DuneRingPoint q)
        {
            var d = p - s.center;
            float r = d.magnitude, ang = Mathf.Atan2(d.y, d.x);
            var radial = r > 1e-4f ? d / r : Vector2.right;
            float rf = DuneRingFloorRadius(s, ang);
            float crest = s.crest != null ? s.crest(ang) : 30f;
            float slopeIn = FaceAngle(-radial, s.wind, s.innerWindward, s.innerSlip);
            float slopeOut = FaceAngle(radial, s.wind, s.outerWindward, s.outerSlip);
            float width = crest / (Mathf.Tan(slopeIn * Mathf.Deg2Rad) * (1 - s.apron * 0.5f)) + s.crestWobble * Loop(ang, 6, 2, s.seed + 17);
            width = Mathf.Max(crest * 0.9f, width);
            float u = r - rf;
            q = new DuneRingPoint { u = u, width = width, crest = crest, innerSlope = slopeIn, angle = ang, floorRadius = rf };
            if (u <= 0) return 0;
            float h;
            if (u < width)
            {
                // 凹形坡脚（二次）接直坡：坡脚切线水平，脊下是 slopeIn 的直坡
                float t = u / width, a = Mathf.Max(1e-3f, s.apron);
                float g = t < a ? t * t / (2 * a) : t - a * 0.5f;
                h = crest * g / (1 - a * 0.5f);
                // 坡面上的细小起伏，不碰坡脚和脊线
                h += s.faceNoise * Fbm(p, 14, 2, s.seed + 9) * Smooth(0, 6, u) * (1 - Smooth(width - 6, width, u));
            }
            else
            {
                float ground = s.outside != null ? s.outside(p) : 0;
                h = Mathf.Max(crest - (u - width) * Mathf.Tan(slopeOut * Mathf.Deg2Rad), ground);
            }
            return h;
        }
    }
}
