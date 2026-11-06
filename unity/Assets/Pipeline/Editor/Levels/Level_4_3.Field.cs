using System;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // 彩林海子 · 地貌：纯函数（世界 XZ → 高度 + 分层倾向），地形、散树、细节、水体都从这里取，互相对齐
    public static partial class Level_4_3
    {
        // ───────────── 噪声 ─────────────
        static float Fbm(float x, float z, int oct, int seed) => (float)LevelKit.PlateauNoise.Fbm(x, z, oct, seed);
        static float Ridged(float x, float z, int oct, int seed) => (float)LevelKit.PlateauNoise.Ridged(x, z, oct, seed);
        static float S(float a, float b, float x) => Landform.Smooth(a, b, x);

        // ───────────── 谷形 ─────────────

        /// <summary>谷轴的 x（湖以北往西偏：从出生点看，谷口的雪峰落在画面中间偏左）</summary>
        static float AxisX(float z) => z <= 0 ? 0 : -0.2f * z;

        /// <summary>谷底半宽：湖一带最宽，往北收窄成 V 形谷口，往南（出生点身后）略收</summary>
        static float HalfWidth(float z) => 235 - 135 * S(-20, 640, z) - 30 * S(-200, -520, z);

        /// <summary>谷底高程（湖面 = 0）：湖边 1.4 m，往北缓缓抬升到谷口垭口，往南抬成身后的林坡</summary>
        static float FloorY(float z) => 1.4f + 78 * Mathf.Pow(S(60, 760, z), 1.4f) + 55 * S(-170, -700, z);

        // ───────────── 湖 ─────────────

        /// <summary>湖的归一化半径（&lt; 1 = 湖里）：转过的椭圆 + 岸线噪声（岸线有凹有凸，不是规整椭圆）</summary>
        static float LakeR(float x, float z)
        {
            float dx = x - LakeCenter.x, dz = z - LakeCenter.y;
            float c = Mathf.Cos(LakeYaw), s = Mathf.Sin(LakeYaw);
            float lx = dx * c - dz * s, lz = dx * s + dz * c;
            float r = Mathf.Sqrt(lx * lx / (LakeRadius.x * LakeRadius.x) + lz * lz / (LakeRadius.y * LakeRadius.y));
            float a = Mathf.Atan2(lz, lx);
            float wob = (Fbm(Mathf.Cos(a) * 2.2f + 11, Mathf.Sin(a) * 2.2f - 5, 3, 501) - 0.5f) * 0.22f
                        + (Fbm(x * 0.03f, z * 0.03f, 2, 503) - 0.5f) * 0.1f;
            return r * (1 + wob);
        }

        // ───────────── 车路（沿东岸、山脚）─────────────

        static readonly Vector2[] RoadCtrl =
        {
            new(150, -470), new(178, -330), new(196, -210), new(204, -100), new(200, 10), new(188, 120), new(166, 240), new(132, 360), new(86, 480), new(30, 610),
        };

        static System.Collections.Generic.List<Vector2> road;

        static float RoadDistance(Vector2 p) => p.x < -10 || p.x > 250 ? 999 : Landform.Polyline(p, road).dist;

        // ───────────── 高度 ─────────────

        public struct Ground
        {
            public float y, snow, gravel, rock, fluid, road, lakeR, floorMask, east, west;
        }

        /// <summary>
        /// 世界高度（米，湖面 = 0）和分层倾向。
        /// 东岸：林坡裙（0–140 m 起 95 m）→ 花岗岩大崖（150–300 m 起 290 m，带扶壁与冲沟）→ 顶部缓穹；西岸：圆缓的林坡；北：谷口抬升成垭口；南：身后的林坡
        /// </summary>
        static Ground Eval(float x, float z)
        {
            var g = new Ground();
            float ax = AxisX(z), W = HalfWidth(z), u = x - ax;
            float floor = FloorY(z);
            // 谷底微起伏（离湖越远越明显）
            float lr = LakeR(x, z);
            float undul = (Fbm(x * 0.012f, z * 0.012f, 4, 511) - 0.5f) * 6f * S(1.15f, 2.2f, lr);
            float y = floor + undul;

            // 东岸大山
            float eastAlong = 0.55f + 0.45f * S(-650, -60, z) * (1 - 0.35f * S(450, 900, z));
            float ej = (Fbm(z * 0.006f, 3.1f, 3, 521) - 0.5f) * 70 + (Fbm(z * 0.02f, 9.7f, 2, 523) - 0.5f) * 18;
            float e = u - W + ej;
            float east = 0;
            if (e > -20)
            {
                // 林坡裙：从山脚一直铺到 160 m 上下（最陡约 40°，树长得住，照片里金林一直爬到半山）
                float skirt = 165 * S(-10, 300, e);
                // 山脊：从山顶往谷底拉下来的一道道支脊，中间夹着沟（噪声沿谷向变化 → 脊线顺坡向下）
                float spur = (Ridged(z * 0.0065f + e * 0.0012f, 1.7f, 4, 535) - 0.45f) * 120 * S(30, 260, e);
                float buttress = Ridged(z * 0.011f, e * 0.004f, 4, 531);
                float cliffStart = 270 + (Fbm(z * 0.008f, 1.3f, 2, 533) - 0.5f) * 90;
                // 花岗岩崖带：只占上半截，扶壁一块块凸出
                float cliff = 250 * S(cliffStart, cliffStart + 170 + 40 * buttress, e);
                float dome = 90 * S(cliffStart + 150, cliffStart + 400, e);
                // 冲沟：沿坡向下的竖槽（崖面上一道道暗缝），只在崖带
                float gully = Mathf.Pow(Ridged(z * 0.025f, e * 0.003f, 3, 537), 2.2f) * 70 * S(cliffStart - 40, cliffStart + 60, e) * (1 - S(cliffStart + 220, cliffStart + 340, e));
                float bulge = (buttress - 0.45f) * 100 * S(cliffStart, cliffStart + 100, e);
                east = (skirt + spur + cliff + dome + bulge - gully) * eastAlong;
                east += (Ridged(x * 0.004f, z * 0.004f, 5, 539) - 0.4f) * 60 * S(cliffStart + 80, cliffStart + 300, e);
                east = Mathf.Max(0, east);
                g.east = S(cliffStart - 30, cliffStart + 40, e);
            }

            // 西岸林坡
            float wj = (Fbm(z * 0.007f, 5.3f, 3, 541) - 0.5f) * 60;
            float w = -u - W + wj;
            float west = 0;
            if (w > -20)
            {
                float rid = Ridged(x * 0.006f, z * 0.006f, 4, 543);
                west = 55 * S(-10, 140, w) + 190 * S(90, 420, w) + (rid - 0.4f) * 70 * S(60, 260, w) + 80 * S(380, 520, w) * S(-300, 500, z);
                west = Mathf.Max(0, west);
                g.west = S(60, 200, w);
            }
            y += east + west;

            // 谷口：北边地形边缘抬成一道垭口（地平线从这里接上远景雪峰）
            y += 70 * S(520, 700, z) * (0.6f + 0.4f * Fbm(x * 0.01f, 2.2f, 2, 547));

            // 车路：路面压平到谷底高程 + 0.6 m（路在东岸山脚，挖进林坡裙一点）
            float rd = RoadDistance(new Vector2(x, z));
            if (rd < 12)
            {
                float roadY = floor + 0.6f;
                float k = 1 - S(3.5f, 11, rd);
                y = Mathf.Lerp(y, roadY + (y - roadY) * 0.15f * (1 - k), k);
                g.road = 1 - S(3.2f, 4.6f, rd);
            }

            // 湖：湖底下凹，湖岸缓缓接到谷底
            if (lr < 1.6f)
            {
                float bed = -0.4f - 6.5f * Mathf.Pow(Mathf.Clamp01(1 - lr * lr), 0.55f);
                float shoreY = 0.35f + (y - 0.35f) * S(1.02f, 1.45f, lr);
                float k = S(0.9f, 1.03f, lr);
                y = Mathf.Lerp(bed, shoreY, k);
                // 岸边有几块伸进水里的碎石滩
                y += (Fbm(x * 0.08f, z * 0.08f, 2, 551) - 0.55f) * 0.9f * S(0.93f, 1.0f, lr) * (1 - S(1.0f, 1.08f, lr));
            }
            g.lakeR = lr;
            g.fluid = 1 - S(0.97f, 1.0f, lr);
            g.y = y;

            // 分层倾向
            // 湖岸卵石滩：水线上下一圈；路面
            g.gravel = Mathf.Max(g.road, (1 - S(1.03f, 1.09f, lr + (Fbm(x * 0.05f, z * 0.05f, 2, 553) - 0.5f) * 0.06f)) * S(0.9f, 0.97f, lr));
            // 雪：雪线以上（东边高、西边低一点）、西岸近水处的霜雪斑（照片左下）
            // 东岸大山只有山顶一点雪（照片里右边是一整面灰白花岗岩），西岸低一些
            float snowLine = 300 + 130 * S(150, 330, x) + (Fbm(x * 0.01f, z * 0.01f, 3, 557) - 0.5f) * 80 - 30 * S(-100, -300, x);
            float snowHigh = S(snowLine - 20, snowLine + 30, y);
            float frost = S(-40, -140, x) * S(1.45f, 1.0f, lr) * S(0.98f, 1.02f, lr) * S(0.55f, 0.7f, Fbm(x * 0.05f, z * 0.05f, 3, 559));
            float frostPatch = S(-60, -200, x) * S(0.66f, 0.78f, Fbm(x * 0.03f, z * 0.03f, 3, 561)) * S(1.1f, 1.5f, lr) * (1 - g.west * 0.5f) * S(260, 0, y);
            g.snow = Mathf.Max(snowHigh, Mathf.Max(frost, frostPatch * 0.85f));
            // 岩：东岸崖带强制岩石（坡度规则在分层里另算）
            g.rock = g.east * 0.85f * S(60, 120, y);
            g.floorMask = 1 - S(-0.05f, 0.25f, Mathf.Max(e, w) / 60f);
            return g;
        }

        /// <summary>地形取样（LevelKit 的样本格式）：gravelBias = 林下地被、packed = 卵石 / 路、sand = 雪、rock = 岩</summary>
        static LevelKit.Sample Sample(Vector2 p)
        {
            var g = Eval(p.x, p.y);
            return new LevelKit.Sample { h = g.y + BaseHeight, packed = g.gravel, sand = g.snow, rock = g.rock, fluid = g.fluid, shore = g.gravel };
        }

        /// <summary>分层：岩（坡度 &gt; 36° 渐入 + 强制岩）先占，再雪（陡处挂不住）、卵石 / 路 / 湖床，剩下是林下地被</summary>
        static Vector4 Splat(in LevelKit.Sample s, in LevelKit.SplatContext c)
        {
            float rock = Mathf.Max(s.rock * S(28, 40, c.slope), S(36, 50, c.slope));
            float snow = s.sand * (1 - S(42, 58, c.slope)) * (1 - rock * 0.6f);
            float gravel = Mathf.Max(s.packed, s.fluid);
            float left = 1;
            float wr = Mathf.Min(left, rock);
            left -= wr;
            float ws = Mathf.Min(left, snow);
            left -= ws;
            float wg = Mathf.Min(left, gravel);
            left -= wg;
            return new Vector4(left, wg, ws, wr);
        }

        /// <summary>某点的地面高度（世界 y，按地形实际插值）</summary>
        static float GroundY(float x, float z) => ts != null ? ts.GroundY(x, z) : Eval(x, z).y;
    }
}
