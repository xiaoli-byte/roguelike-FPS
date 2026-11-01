using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>化蛇的色板（docs/art/vfx/huashe.md 第 0 节：见则其邑大水 / 湖 / 翼拍浪；圣湖是绿松石，和鲲鹏北冥的深青拉开）</summary>
    public static class HuashePalette
    {
        /// <summary>圣湖的水：白沫 / 绿松石 / 深湖青</summary>
        public static readonly Color Foam = Hex.Rgb(0xf4fffc), Water = Hex.Rgb(0x38c6c0), Deep = Hex.Rgb(0x16596a);
        /// <summary>嘴里的光、吼叫的声浪（腐化紫红）：近白 / 紫红 / 靛紫</summary>
        public static readonly Color MouthCore = Hex.Rgb(0xfff2fb), Mouth = Hex.Rgb(0xff5ad8), MouthEdge = Hex.Rgb(0x4a2a7a);
        /// <summary>涨水线、湖面漩涡：白沫 / 浅湖青</summary>
        public static readonly Color Shallow = Hex.Rgb(0x7fdcd6);
        /// <summary>湖岸湿泥</summary>
        public static readonly Color Mud = Hex.Rgb(0x6a5a48);
    }

    /// <summary>化蛇的招式特效（第四章移植 B1 路，设计单 docs/art/vfx/huashe.md）。只管外观，不碰判定</summary>
    public static partial class Fx
    {
        /// <summary>水花：一朵水冠（Surge 冠，绿松石 + 白沫）+ 一圈白沫团 + 水滴；size ≈ 1（水弹落地 2.6 m）</summary>
        public static void HuasheSplash(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            Surge.Crown(at, 1.1f * size, 1.8f * size, SurgeKind.Water, 0.6f, HuashePalette.Water, HuashePalette.Foam, 0.9f);
            LdMany("ToonSmoke", Mathf.RoundToInt(4 * size), i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (at + new Vector3(d.x, 0.2f, d.y) * size, new Vector3(d.x, 0.4f, d.y) * Random.Range(2f, 3.5f) * size, Random.Range(0.8f, 1.2f) * size, 0.5f);
            }, LdAlpha(HuashePalette.Foam, 0.9f));
            LdMany("Drop", Mathf.RoundToInt(12 * size), i => (at + Vector3.up * 0.3f, new Vector3(Random.Range(-1f, 1f), Random.Range(1.5f, 2.5f), Random.Range(-1f, 1f)) * 3.5f * size, Random.Range(0.1f, 0.18f), 0.7f),
                HuashePalette.Water);
            Ring(at + Vector3.up * 0.06f, 2.6f * size, HuashePalette.Foam, 0.45f, false);
        }

        /// <summary>水面的涟漪圈（潜游气泡串、登场水下黑影）：一圈白沫环 + 一两颗气泡</summary>
        public static void HuasheRipple(Vector3 at, float radius)
        {
            if (!Finite(at)) return;
            LdOne("RingFlat", at + Vector3.up * 0.04f, Vector3.zero, radius, 0.6f, LdAlpha(HuashePalette.Foam, 0.7f), false);
            LdMany("Mote", 2, i => (at + Random.insideUnitSphere * radius * 0.4f, Vector3.up * 1.2f, 0.18f, 0.5f), HuashePalette.Foam);
        }

        /// <summary>水下黑影（登场、潜游）：水面上一团深湖青的扁团，跟着位置挪（每帧调，自己衰减）</summary>
        public static void HuasheShadow(Vector3 at, float length, float yawDeg)
        {
            if (!Finite(at)) return;
            var d = LdDir(yawDeg);
            for (int i = 0; i < 3; i++)
                LdOne("ToonSmoke", at + d * (i - 1) * length * 0.3f + Vector3.up * 0.05f, Vector3.zero, length * 0.35f, 0.18f, LdAlpha(HuashePalette.Deep, 0.55f), false);
        }

        /// <summary>
        /// 破水而出 / 出水扑岸：一圈大水帘（Surge 冠）+ 水团四溅 + 涟漪大圈；size ≈ 1（扑岸）、1.6（登场）
        /// </summary>
        public static void HuasheBreach(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            Surge.Crown(at, 2f * size, 4.5f * size, SurgeKind.Water, 0.9f, HuashePalette.Water, HuashePalette.Foam, 0.95f);
            LdOne("ToonBurst", at + Vector3.up * 1.5f * size, Vector3.zero, 3.6f * size, 0.12f, HuashePalette.Foam);
            LdMany("ToonSmoke", Mathf.RoundToInt(8 * size), i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (at + new Vector3(d.x, 0.5f, d.y) * 1.5f * size, new Vector3(d.x * 4f, Random.Range(4f, 8f), d.y * 4f) * size, Random.Range(1f, 1.6f) * size, 0.7f);
            }, LdAlpha(HuashePalette.Foam, 0.9f));
            LdMany("Drop", Mathf.RoundToInt(24 * size), i => (at + Vector3.up, Random.onUnitSphere * 7f * size + Vector3.up * 6f, Random.Range(0.12f, 0.22f), 0.9f), HuashePalette.Water);
            Ring(at + Vector3.up * 0.05f, 6f * size, HuashePalette.Foam, 0.7f, false);
        }

        /// <summary>扑咬：上下两道月牙合拢（绿松石托 + 白刃）+ 爆闪</summary>
        public static void HuasheBite(Vector3 head, float yawDeg)
        {
            if (!Finite(head)) return;
            Slash(head + Vector3.up * 0.8f, yawDeg, 2.6f, 1.8f, 1, 0.35f, 0.55f, 0.25f, HuashePalette.Foam, true);
            Slash(head - Vector3.up * 0.2f, yawDeg, 2.6f, 1.8f, -1, -0.35f, 0.5f, 0.25f, HuashePalette.Water, true);
            LdOne("ToonBurst", head, Vector3.zero, 2.6f, 0.12f, HuashePalette.Foam);
        }

        /// <summary>翼拍浪：整圈低浪墙（1 m 高，白沫浪头 + 绿松石浪身）跟着冲击波往外推到 range；拍击点两团水冠</summary>
        public static void HuasheWave(Vector3 center, float range, float seconds, Vector3 wingL, Vector3 wingR)
        {
            if (!Finite(center)) return;
            float start = 2.5f;
            float hold = Mathf.Max(0.05f, seconds - 0.35f);
            Surge.Sheet(center, 0, start, 360f, 1.1f, SurgeKind.Water, 0.08f, hold, 0.3f, HuashePalette.Water, HuashePalette.Foam, 2.4f, 0.9f, range / start);
            Surge.Sheet(center, 0, start * 0.7f, 360f, 0.6f, SurgeKind.Water, 0.1f, hold, 0.35f, HuashePalette.Deep, HuashePalette.Water, 1.4f, 0.85f, (range - 2f) / (start * 0.7f));
            if (Finite(wingL)) HuasheSplash(new Vector3(wingL.x, center.y, wingL.z), 1.2f);
            if (Finite(wingR)) HuasheSplash(new Vector3(wingR.x, center.y, wingR.z), 1.2f);
        }

        /// <summary>尾扫：尾巴扫过的一扇水幕（120°、2 m 高）+ 水团</summary>
        public static void HuasheTailFan(Vector3 center, float yawDeg, float range)
        {
            if (!Finite(center)) return;
            Surge.Sheet(center, yawDeg, range * 0.5f, 120f, 2f, SurgeKind.Water, 0.06f, 0.25f, 0.3f, HuashePalette.Water, HuashePalette.Foam, 2.6f, 0.9f, 1.8f);
            LdMany("ToonSmoke", 10, i =>
            {
                var d = LdDir(yawDeg + Random.Range(-60f, 60f));
                return (center + d * range * Random.Range(0.3f, 0.9f) + Vector3.up * 0.5f, d * 4f + Vector3.up * 2f, Random.Range(0.9f, 1.4f), 0.6f);
            }, LdAlpha(HuashePalette.Foam, 0.9f));
        }

        /// <summary>嘴里的光（张嘴时每帧调）：紫红光芯 + 零星火星</summary>
        public static void HuasheMouth(Vector3 mouth, float dt, float k = 1f)
        {
            if (!Finite(mouth)) return;
            int n = LdRate(16f * k, dt);
            for (int i = 0; i < n; i++)
                LdOne("Spark", mouth + Random.insideUnitSphere * 0.3f, Random.onUnitSphere * 1.2f, Random.Range(0.08f, 0.14f), 0.2f, HuashePalette.Mouth, false);
            if (Random.value < dt * 8f) LdOne("Glow", mouth, Vector3.zero, 1.4f * k, 0.18f, LdAlpha(HuashePalette.Mouth, 0.7f), false);
        }

        /// <summary>吼叫的声浪：嘴前往外推的一道紫红细环（3 → 9 m，0.5 s）</summary>
        public static void HuasheRoarRing(Vector3 mouth)
        {
            if (!Finite(mouth)) return;
            LdOne("ToonRing", mouth, Vector3.zero, 9f, 0.5f, LdAlpha(HuashePalette.Mouth, 0.55f), false);
        }

        /// <summary>噎住：嘴里喷出一大团水（水冠倒着从嘴里出 + 水团）</summary>
        public static void HuasheChoke(Vector3 mouth)
        {
            if (!Finite(mouth)) return;
            LdMany("ToonSmoke", 12, i => (mouth, Random.onUnitSphere * 4f + Vector3.up * 5f, Random.Range(0.9f, 1.4f), 0.7f), LdAlpha(HuashePalette.Foam, 0.9f));
            LdMany("Drop", 20, i => (mouth, Random.onUnitSphere * 6f + Vector3.up * 6f, Random.Range(0.12f, 0.2f), 0.8f), HuashePalette.Water);
        }

        /// <summary>涨水线：涨水面边缘一圈白沫（在 at 处冒一团，沿岸每 0.5 s 一圈调）</summary>
        public static void HuasheFloodEdge(Vector3 at)
        {
            if (!Finite(at)) return;
            LdOne("ToonSmoke", at + Vector3.up * 0.1f, Random.insideUnitSphere * 0.4f, Random.Range(0.6f, 1f), 0.6f, LdAlpha(HuashePalette.Foam, 0.75f), false);
        }

        /// <summary>湖面漩涡（三阶段大水）：一张向心转的圆盘（Surge 圆盘，浅湖青 / 白沫），life 秒</summary>
        public static FxHandle HuasheWhirl(Vector3 center, float radius, float life) =>
            Finite(center) ? Surge.Disk(center + Vector3.up * 0.06f, radius, SurgeKind.Water, life, 70f, -1.4f, 1f, HuashePalette.Shallow, HuashePalette.Foam, 0.6f) : FxHandle.None;
    }
}
