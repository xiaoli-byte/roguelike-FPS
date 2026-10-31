using System;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏的招式特效（首领与精英动作 · 特效调优 K 路；设计单 docs/art/vfx/kunpeng.md）。母题《逍遥游》：北冥有鱼、化而为鸟、水击三千里、扶摇直上九万里。
    ///   · 鲲重而沉：水、冰、浪的**块面**——冰板 / 冰块（IceChunk 晶块）、整堵的浪墙（Surge 弧幕）、北冥水冠、漩涡；
    ///   · 鹏轻而疾：风、羽刃、气流的**流线**——弯的风线（Spray 拉丝，切向 + 径向速度 = 螺旋）、扶摇气旋柱、翼刃 / 爪风月牙（SlashArc）、雪羽。
    /// 色阶三阶（fx-style §2.1 冰 / 霜）：冰 <see cref="KunCore"/> 亮芯 / <see cref="KunIce"/> 冰蓝 / <see cref="KunEdge"/> 蓝灰；
    /// 北冥的水 <see cref="KunDeep"/> 深青 / <see cref="KunWater"/> 水青 / <see cref="KunFoam"/> 白沫；风 <see cref="PengLine"/> 风线（比雪面暗一档，冰面上读得出）/ <see cref="PengWind"/> 风青；
    /// 雪雾按第二章底色冷白 <see cref="KunMist"/>，不用纯白、不铺满屏。预警不在这里（统一危险色，TelegraphTone）。
    /// 大形一颗一个形（ToonBurst / ToonRing / RingPop / IceStar，essential，低画质也留着）；点缀乘画质密度、过 <see cref="FxBudget"/>。
    /// 只管外观，不碰判定；释放帧由招式在 Cue / 动画事件那一帧调。
    /// </summary>
    public static partial class Fx
    {
        public static readonly Color KunCore = Hex.Rgb(0xf0fbff), KunIce = Hex.Rgb(0x7fd8ff), KunEdge = Hex.Rgb(0x4a6a8a);
        public static readonly Color KunDeep = Hex.Rgb(0x1f5a74), KunWater = Hex.Rgb(0x3f8fb0), KunFoam = Hex.Rgb(0xf4fdff);
        public static readonly Color PengWind = Hex.Rgb(0xbfe9ff), PengLine = Hex.Rgb(0x8fb8dc), KunMist = Hex.Rgb(0xd6e6f4);

        // ───────────── 工具 ─────────────

        /// <summary>按 dt 和每秒速率算这一帧发几颗（小数部分按概率进位），乘画质密度、过预算</summary>
        static int KpCount(float perSecond, float dt)
        {
            if (!(dt > 0) || !(perSecond > 0)) return 0;
            float expected = perSecond * dt * Mathf.Lerp(0.5f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            return FxBudget.Allow(n, false);
        }

        /// <summary>发一颗大形（essential：预算满了也留着）</summary>
        static void KpOne(FxRuntime rt, string style, Vector3 p, Vector3 v, float size, float life, Color c, bool essential = true)
        {
            var e = rt.GetEmitter(style);
            if (e == null || FxBudget.Allow(1, essential) < 1) return;
            rt.EmitOne(e, p, v, size, life, c, 0);
        }

        /// <summary>一次发 n 颗点缀（乘密度、过预算）</summary>
        static void KpMany(FxRuntime rt, string style, int n, Func<int, (Vector3 p, Vector3 v, float size, float life)> make, Color c)
        {
            var e = rt.GetEmitter(style);
            if (e == null) return;
            n = FxBudget.Allow(Mathf.RoundToInt(n * Density), false);
            for (int i = 0; i < n; i++)
            {
                var (p, v, size, life) = make(i);
                rt.EmitOne(e, p, v, size, life, c, 0);
            }
        }

        static Vector3 KpDir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        static Color KpAlpha(Color c, float a) => new(c.r, c.g, c.b, a);

        // ───────────── 鲲 · 猛砸冰浪 ─────────────

        /// <summary>
        /// 猛砸 / 吞吸的起手：身上的水往下泻（BodyStream 水），鲲身下的水面往它身下退（向心的漩涡圆盘）——「水退 = 要来大的」。
        /// water = 鲲身下的水面点，seconds = 前摇
        /// </summary>
        public static void KunRear(GameObject model, Vector3 water, float seconds, float radius = 6f)
        {
            if (model) BodyStream(model, StreamKind.Water, Mathf.Max(0.3f, seconds), 70f, KunWater);
            if (!Finite(water)) return;
            Surge.Disk(water + Vector3.up * 0.05f, radius, SurgeKind.Water, Mathf.Max(0.4f, seconds + 0.2f), 110f, -1.6f, 1f, KunDeep, KunFoam, 0.7f);
        }

        /// <summary>
        /// 猛砸的蓄力（前摇里每帧调）：落点四周的冰屑 / 雪往落点收、往上浮，k = 前摇进度（越到顶点越密）；
        /// 这一层是「打哪里」的第二个读点，预警本身不动
        /// </summary>
        public static void KunSlamGather(Vector3 impact, float radius, float k, float dt)
        {
            if (!Finite(impact) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            int n = KpCount(Mathf.Lerp(8f, 36f, Mathf.Clamp01(k)), dt);
            var e = rt.GetEmitter("ShardIce");
            for (int i = 0; e != null && i < n; i++)
            {
                var d = Random.insideUnitCircle.normalized;
                var p = impact + new Vector3(d.x, 0, d.y) * radius * Random.Range(0.8f, 1.15f) + Vector3.up * 0.15f;
                var v = (impact - p) * Random.Range(1.6f, 2.2f) + Vector3.up * Random.Range(2f, 4f);
                rt.EmitOne(e, p, v, Random.Range(0.12f, 0.2f), Random.Range(0.35f, 0.5f), KunIce, 0);
            }
        }

        /// <summary>猛砸的蓄力顶点（apex 事件）：落点一记冰晶星「叮」+ 一圈冷白雾，告诉玩家「就砸这里」</summary>
        public static void KunSlamApex(Vector3 impact, float radius)
        {
            if (!Finite(impact)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "IceStar", impact + Vector3.up * 0.6f, Vector3.zero, radius * 0.8f, 0.24f, KunCore);
            KpMany(rt, "ToonSmoke", 5, i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (impact + new Vector3(d.x, 0.2f, d.y) * radius * 0.6f, new Vector3(-d.x, 0.4f, -d.y) * 1.2f, Random.Range(1.1f, 1.6f), Random.Range(0.45f, 0.6f));
            }, KpAlpha(KunMist, 0.7f));
        }

        /// <summary>
        /// 猛砸的释放帧（「水击三千里」）：砸点白热冰晶星 + 爆闪 + 冷光；北冥水冠；顺着浪的方向抛出一扇冰板（块面）；贴地冲击环、霜斑；
        /// 浪墙本体（双层弧幕）和浪头的白沫碎冰由 <see cref="KunWave"/> 出。yaw / half = 浪的朝向与半角（度）
        /// </summary>
        public static void KunSlamImpact(Vector3 impact, float yaw, float half, float size = 1f)
        {
            if (!Finite(impact)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "ToonBurst", impact + Vector3.up * 0.8f, Vector3.zero, 5.2f * size, 0.13f, KunCore);
            KpOne(rt, "IceStar", impact + Vector3.up * 1.3f, Vector3.zero, 4.4f * size, 0.2f, KunCore);
            KpOne(rt, "ToonRing", impact + Vector3.up * 0.07f, Vector3.zero, 6.5f * size, 0.38f, KunCore);
            Flash(impact + Vector3.up * 1.5f, KunIce, 7f, 14f * size, 0.16f);
            Surge.Crown(impact, 3f * size, 4.2f * size, SurgeKind.Water, 0.8f, KunWater, KunFoam);
            // 冰板扇：顺浪的方向抛出去的大冰块（方块 = 重量），近处的高、远处的平
            KpMany(rt, "IceChunk", 12, i =>
            {
                var d = KpDir(yaw + Random.Range(-half, half) * 0.85f);
                float s = Random.Range(0f, 1f);
                return (impact + d * (0.8f + s) + Vector3.up * 0.4f, d * Mathf.Lerp(5f, 11f, s) + Vector3.up * Mathf.Lerp(8f, 4f, s),
                    Random.Range(0.55f, 0.95f) * size, Random.Range(0.75f, 1f));
            }, KunCore);
            KpMany(rt, "ShardIce", 14, i =>
            {
                var d = Random.onUnitSphere;
                d.y = Mathf.Abs(d.y) + 0.4f;
                return (impact + Vector3.up * 0.6f, d.normalized * Random.Range(6f, 12f), Random.Range(0.14f, 0.24f), Random.Range(0.4f, 0.65f));
            }, KunIce);
            KpMany(rt, "ToonSmoke", 4, i =>
            {
                var d = KpDir(yaw + Random.Range(-half, half));
                return (impact + d * 2f + Vector3.up * 0.4f, d * Random.Range(3f, 5f) + Vector3.up * 0.8f, Random.Range(1.4f, 2f) * size, Random.Range(0.55f, 0.75f));
            }, KpAlpha(KunMist, 0.75f));
            FrostPatch(impact + Vector3.up * 0.03f, 4.5f * size, 5f);
        }

        /// <summary>
        /// 北冥浪墙（猛砸、潜袭、落台的冰浪、化形的整圈浪）：前沿一堵翻白沫的浪头（弧幕，高 height）+ 后面低一层的深青浪身，
        /// 和冲击波同速往外推（start → range，speed 米 / 秒）；浪头一路翻白沫团、甩碎冰（<see cref="KunWaveCrest"/>）。arcDeg = 弧长（度，360 = 整圈）
        /// </summary>
        public static void KunWave(Vector3 center, float yaw, float arcDeg, float start, float range, float speed, float height = 2.6f)
        {
            if (!Finite(center) || !(range > start) || !(speed > 0)) return;
            float life = (range - start) / speed;
            float hold = Mathf.Max(0.05f, life - 0.4f);
            Surge.Sheet(center, yaw, start, arcDeg, height, SurgeKind.Water, 0.1f, hold, 0.3f, KunWater, KunFoam, 2.8f, 0.95f, grow: range / start);
            float back = Mathf.Max(0.6f, start * 0.65f);
            Surge.Sheet(center, yaw, back, arcDeg, height * 0.55f, SurgeKind.Water, 0.12f, hold, 0.35f, KunDeep, KunWater, 1.6f, 0.9f,
                grow: Mathf.Max(1.05f, (range - 2.5f) / back));
            KunWaveCrest.Run(center, yaw, arcDeg, start, range, speed);
        }

        // ───────────── 鲲 · 吞吸 / 扑咬 ─────────────

        /// <summary>吞吸起手（吸气）：口前一团冷白雾往回收 + 一颗冰晶星点亮（吸气点）</summary>
        public static void KunInhaleCue(Vector3 mouth, Vector3 forward)
        {
            if (!Finite(mouth)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            forward.y = 0;
            forward = forward.sqrMagnitude > 1e-4f ? forward.normalized : Vector3.forward;
            KpOne(rt, "IceStar", mouth, Vector3.zero, 2.6f, 0.3f, KunCore);
            KpMany(rt, "ToonSmoke", 6, i =>
            {
                var p = mouth + forward * Random.Range(3f, 6f) + Random.insideUnitSphere * 1.5f;
                return (p, (mouth - p) * 1.4f, Random.Range(1.1f, 1.6f), Random.Range(0.5f, 0.7f));
            }, KpAlpha(KunMist, 0.65f));
        }

        /// <summary>
        /// 扑咬的释放帧：上下两道敌方月牙（暗托亮刃）对着合拢（上颚从左往右、下颚从右往左，一高一低、各倾一点）+ 爆闪 + 冰屑；size ≈ 1
        /// </summary>
        public static void KunBite(Vector3 spot, float yaw, float size = 1f)
        {
            if (!Finite(spot)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = 3.4f * size;
            Slash(spot + Vector3.up * 2.1f * size, yaw, r, 1.9f, 1, 0.35f, 0.75f * size, 0.3f, KunCore, true);
            Slash(spot + Vector3.up * 0.5f * size, yaw, r, 1.9f, -1, -0.35f, 0.65f * size, 0.3f, KunIce, true);
            KpOne(rt, "ToonBurst", spot + Vector3.up * 1.2f * size, Vector3.zero, 3.6f * size, 0.12f, KunCore);
            KpOne(rt, "ToonRing", spot + Vector3.up * 0.07f, Vector3.zero, 4.2f * size, 0.32f, KunCore);
            Flash(spot + Vector3.up * 1.2f, KunIce, 5f, 9f, 0.13f);
        }

        // ───────────── 鲲 · 潜袭 / 吐冰 ─────────────

        /// <summary>破冰前的水面隆起（穹顶，seconds 秒鼓起）：「要从这里出来」</summary>
        public static FxHandle KunBreachDome(Vector3 water, float radius, float seconds) =>
            Finite(water) ? Surge.Dome(water, radius, 1.7f, SurgeKind.Water, Mathf.Max(0.1f, seconds), 0.04f, 0.22f, KunDeep, KunFoam, 0.95f) : FxHandle.None;

        /// <summary>破冰而出：冰沿崩起一圈冰板（块面）+ 爆闪 + 冷光；水柱 / 水冠由招式自己出</summary>
        public static void KunBreach(Vector3 rim, float yaw)
        {
            if (!Finite(rim)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "ToonBurst", rim + Vector3.up * 1f, Vector3.zero, 4.6f, 0.13f, KunCore);
            Flash(rim + Vector3.up * 1.5f, KunIce, 6f, 12f, 0.15f);
            KpMany(rt, "IceChunk", 10, i =>
            {
                var d = KpDir(yaw + Random.Range(-70f, 70f));
                return (rim + d * Random.Range(0.3f, 1.5f) + Vector3.up * 0.3f, d * Random.Range(3f, 7f) + Vector3.up * Random.Range(6f, 10f),
                    Random.Range(0.5f, 0.9f), Random.Range(0.75f, 1f));
            }, KunCore);
        }

        /// <summary>吐冰出手：口前一记冰晶星 + 一束往前喷的冰屑和拉丝</summary>
        public static void KunSpit(Vector3 mouth, Vector3 dir)
        {
            if (!Finite(mouth)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var f = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            KpOne(rt, "IceStar", mouth, Vector3.zero, 3f, 0.18f, KunCore);
            KpOne(rt, "ToonBurst", mouth, Vector3.zero, 2.2f, 0.1f, KunCore);
            KpMany(rt, "Spray", 12, i => (mouth, (f + Random.insideUnitSphere * 0.25f).normalized * Random.Range(10f, 16f), Random.Range(0.08f, 0.12f), Random.Range(0.25f, 0.4f)),
                KunIce);
            KpMany(rt, "ShardIce", 6, i => (mouth, (f + Random.insideUnitSphere * 0.35f).normalized * Random.Range(6f, 10f), Random.Range(0.14f, 0.22f), Random.Range(0.35f, 0.5f)),
                KunCore);
        }

        // ───────────── 鹏 · 扇翼 / 俯冲 / 起落 ─────────────

        /// <summary>
        /// 扇翼的一下下扇（flap 事件；狂风、俯冲随势、起飞）：翼尖两道竖起的翼刃拖影（月牙）、身下地面一圈往外扩的风环、
        /// 一圈螺旋往外的风线（切向 + 径向速度）、卷起的雪。body = 胸口，ground = 正下方地面，facing = 鹏的朝向（度），span = 半翼展（米）；
        /// strong = 第一下 / 释放帧（更大、多 50%）
        /// </summary>
        public static void PengFlap(Vector3 body, Vector3 ground, float facing, float span, bool strong, int spin = 1)
        {
            if (!Finite(body)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float k = strong ? 1.35f : 1f;
            // 翼刃拖影：中线朝两侧翼尖，竖着倾 70°，从上往下扫
            foreach (int s in new[] { -1, 1 })
                Slash(body + Vector3.up * 0.6f, facing + 90f * s, span * 0.85f, 1.3f, s, 1.2f * s, 0.55f * k, 0.18f, PengWind);
            if (Finite(ground) && body.y - ground.y < 24f)
            {
                KpOne(rt, "ToonRing", ground + Vector3.up * 0.1f, Vector3.zero, 9f * k, 0.55f, PengWind);
                KpOne(rt, "RingFlat", ground + Vector3.up * 0.12f, Vector3.zero, 12f * k, 0.6f, KpAlpha(PengLine, 0.9f));
                // 螺旋流线：一道道三段折线的风线（暗一档的风青 → 亮白），从身下往外、顺着旋向绕出去——拉丝粒子在 30 m 外太细，读不出来
                int arcs = FxBudget.Allow(Mathf.RoundToInt((strong ? 10 : 7) * Density), false);
                for (int i = 0; i < arcs; i++)
                {
                    float a = Random.Range(0f, 360f), r0 = Random.Range(2f, 4f), h = Random.Range(0.25f, 1.1f);
                    float step = Random.Range(2.4f, 3.6f) * k, turn = Random.Range(10f, 16f) * spin;
                    var p0 = ground + KpDir(a) * r0 + Vector3.up * h;
                    var p1 = ground + KpDir(a + turn) * (r0 + step) + Vector3.up * h;
                    var p2 = ground + KpDir(a + turn * 2f) * (r0 + step * 2f) + Vector3.up * h;
                    var p3 = ground + KpDir(a + turn * 3f) * (r0 + step * 3f) + Vector3.up * h * 0.8f;
                    Tracer(p0, p1, PengLine, 0.14f);
                    Tracer(p1, p2, PengWind, 0.13f);
                    Tracer(p2, p3, KunCore, 0.11f);
                }
                KpMany(rt, "Snow", strong ? 12 : 8, i =>
                {
                    var d = KpDir(Random.Range(0f, 360f));
                    return (ground + d * Random.Range(3f, 7f) + Vector3.up * 0.3f, d * Random.Range(3f, 6f) + Vector3.up * Random.Range(2f, 4f),
                        Random.Range(0.2f, 0.32f), Random.Range(0.8f, 1.2f));
                }, KunCore);
            }
            KpMany(rt, "Snow", 6, i => (body + Random.insideUnitSphere * span * 0.6f, Vector3.down * Random.Range(3f, 6f) + Random.insideUnitSphere * 2f,
                Random.Range(0.2f, 0.3f), Random.Range(0.6f, 0.9f)), KunCore);
        }

        /// <summary>翼尖的冰晶星（俯冲蓄满、狂风蓄力顶点）</summary>
        public static void PengWingGlints(Vector3 tipL, Vector3 tipR, float size = 1.6f)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Finite(tipL)) KpOne(rt, "IceStar", tipL, Vector3.zero, size, 0.3f, KunCore);
            if (Finite(tipR)) KpOne(rt, "IceStar", tipR, Vector3.zero, size, 0.3f, KunCore);
        }

        /// <summary>俯冲的释放帧（破空）：一记白环 + 爆闪，往后甩一束风线</summary>
        public static void PengSwoopLaunch(Vector3 at, Vector3 dir)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var f = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            KpOne(rt, "RingPop", at, Vector3.zero, 6.5f, 0.26f, KunCore);
            KpOne(rt, "ToonBurst", at, Vector3.zero, 3.4f, 0.1f, KunCore);
            KpMany(rt, "Spray", 16, i => (at + Random.insideUnitSphere * 1.2f, (-f + Random.insideUnitSphere * 0.3f).normalized * Random.Range(10f, 18f),
                Random.Range(0.08f, 0.11f), Random.Range(0.25f, 0.4f)), KpAlpha(PengLine, 0.9f));
        }

        /// <summary>
        /// 俯冲中（每帧调）：两侧翼尖拉出的风线尾迹（这一帧翼尖扫过的一段曳光，前后连成两条流线，prevL / prevR = 上一帧的翼尖）；
        /// 离地 3 m 以内时，身下两侧扬起 V 形的雪浪尾流。vel = 鹏的速度，altitude = 离地高度
        /// </summary>
        public static void PengSwoopTrail(Vector3 tipL, Vector3 tipR, Vector3 prevL, Vector3 prevR, Vector3 talons, Vector3 vel, float altitude, float dt)
        {
            if (!(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Finite(tipL) && Finite(prevL) && (tipL - prevL).sqrMagnitude > 0.01f) Tracer(prevL, tipL, PengWind, 0.16f);
            if (Finite(tipR) && Finite(prevR) && (tipR - prevR).sqrMagnitude > 0.01f) Tracer(prevR, tipR, PengWind, 0.16f);
            var spray = rt.GetEmitter("Spray");
            if (spray == null) return;
            if (!(altitude < 3f) || !Finite(talons)) return;
            var flat = new Vector3(vel.x, 0, vel.z);
            var f = flat.sqrMagnitude > 1e-3f ? flat.normalized : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, f);
            var ground = new Vector3(talons.x, talons.y - altitude, talons.z);
            int m = KpCount(40f, dt);
            for (int i = 0; i < m; i++)
            {
                float s = Random.value < 0.5f ? -1f : 1f;
                var v = side * s * Random.Range(4f, 8f) + Vector3.up * Random.Range(3f, 6f) - f * Random.Range(1f, 3f);
                rt.EmitOne(spray, ground + side * s * Random.Range(0.5f, 1.5f) + Vector3.up * 0.2f, v, Random.Range(0.08f, 0.12f), Random.Range(0.35f, 0.55f),
                    KpAlpha(KunCore, 0.95f), 0);
            }
        }

        /// <summary>俯冲掠过玩家的扑击姿势（strike 事件）：左右两道敌方月牙爪风横着扫过 + 爪尖一记爆闪</summary>
        public static void PengStrike(Vector3 talons, float yaw)
        {
            if (!Finite(talons)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            Slash(talons + Vector3.up * 0.4f, yaw, 3.4f, 2.1f, 1, 0.22f, 0.5f, 0.2f, PengWind, true);
            Slash(talons + Vector3.up * 0.9f, yaw, 3.6f, 2.1f, -1, -0.22f, 0.5f, 0.2f, KunCore, true);
            KpOne(rt, "ToonBurst", talons + Vector3.up * 0.5f, Vector3.zero, 2.8f, 0.1f, KunCore);
        }

        /// <summary>
        /// 扶摇：一股螺旋上升的风线（切向 + 向上 + 往里一点），围着 axis 半径 radius；rate = 每秒几道（每帧调，dt）或一次 n 道（dt ≤ 0 时 count 道）
        /// </summary>
        public static void PengSpiralUp(Vector3 axis, float radius, float rate, float dt, int count = 0, float speed = 1f)
        {
            if (!Finite(axis)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var e = rt.GetEmitter("Spray");
            if (e == null) return;
            int n = dt > 0 ? KpCount(rate, dt) : FxBudget.Allow(Mathf.RoundToInt(count * Density), false);
            for (int i = 0; i < n; i++)
            {
                float a = Random.Range(0f, 360f);
                var radial = KpDir(a);
                var tangent = KpDir(a + 90f);
                var p = axis + radial * radius * Random.Range(0.85f, 1.15f) + Vector3.up * Random.Range(0f, 3f);
                var v = (tangent * Random.Range(9f, 13f) + Vector3.up * Random.Range(12f, 18f) - radial * Random.Range(1f, 2.5f)) * speed;
                rt.EmitOne(e, p, v, Random.Range(0.09f, 0.13f), Random.Range(0.5f, 0.8f), KpAlpha(PengWind, 0.9f), 0);
            }
        }

        /// <summary>落台的下压气流（敛翼）：贴地风环 + 雪冠 + 雪往外飞</summary>
        public static void PengDowndraft(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.08f, Vector3.zero, radius * 1.4f, 0.45f, PengWind);
            Surge.Crown(ground, radius * 0.45f, 1.6f, SurgeKind.Water, 0.6f, KunMist, Color.white, 0.85f);
            KpMany(rt, "Spray", 20, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (ground + d * radius * 0.4f + Vector3.up * 0.3f, d * Random.Range(9f, 14f) + Vector3.up * Random.Range(0.5f, 2f), 0.09f, Random.Range(0.35f, 0.5f));
            }, KpAlpha(PengLine, 0.85f));
        }

        /// <summary>羽刃出手：从翼尖顺着出手方向一条短风线（羽刃破风）</summary>
        public static void PengFeatherLaunch(Vector3 tip, Vector3 target)
        {
            if (!Finite(tip) || !Finite(target)) return;
            var d = target - tip;
            if (d.sqrMagnitude < 0.01f) return;
            Tracer(tip, tip + d.normalized * Mathf.Min(4f, d.magnitude * 0.3f), KunCore, 0.06f);
        }

        // ───────────── 第二批 A 路：潜袭 / 吐冰 / 羽刃雨 / 落台 / 起飞 / 鹏倒下（设计单第 12–17 节）─────────────

        /// <summary>
        /// 潜袭 · 下潜（plunge 事件）：鲲侧身一头扎进水里的那一下——一圈往外翻的水冠 + 白沫团 + 大涟漪（块面：整片水被压下去再翻上来）
        /// </summary>
        public static void KunPlunge(Vector3 water, float size = 1f)
        {
            if (!Finite(water)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            Surge.Crown(water, 2.6f * size, 3.2f * size, SurgeKind.Water, 0.75f, KunWater, KunFoam);
            Splash(water, 3.2f * size, NorthSea);
            WaterDisturb(water, 7f * size, 1.4f);
            KpOne(rt, "ToonRing", water + Vector3.up * 0.08f, Vector3.zero, 6f * size, 0.45f, KpAlpha(KunFoam, 0.9f));
            KpMany(rt, "ToonSmoke", 6, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (water + d * Random.Range(1.5f, 3f) + Vector3.up * 0.3f, d * Random.Range(2f, 4f) + Vector3.up * 1.2f, Random.Range(1.1f, 1.6f) * size,
                    Random.Range(0.5f, 0.7f));
            }, KpAlpha(KunFoam, 0.85f));
        }

        /// <summary>
        /// 潜袭 · 破水而出（breach 事件，扑咬前 0.4 s）：穹顶炸开——一根往上冲的水柱（鲲就在柱子里出来）+ 水冠 + 白沫 + 碎冰；
        /// 原来这几样放在扑咬那一帧，那时鲲还整只沉在水下，玩家只看得到一团水
        /// </summary>
        public static void KunBreachOut(Vector3 water, float size = 1f)
        {
            if (!Finite(water)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            Surge.Column(water, 3f * size, 10f * size, SurgeKind.Water, 0.16f, 0.22f, 0.6f, KunWater, KunFoam, 2.6f);
            Surge.Crown(water, 3.4f * size, 3.6f * size, SurgeKind.Water, 0.8f, KunWater, KunFoam);
            Splash(water, 3.8f * size, NorthSea);
            WaterDisturb(water, 8f * size, 1.6f);
            KpMany(rt, "ShardIce", 10, i =>
            {
                var d = Random.onUnitSphere;
                d.y = Mathf.Abs(d.y) + 0.8f;
                return (water + Vector3.up * 0.5f, d.normalized * Random.Range(6f, 11f), Random.Range(0.14f, 0.22f), Random.Range(0.45f, 0.7f));
            }, KunIce);
        }

        /// <summary>
        /// 潜袭 · 潜游：水下的鲲从原来的方位顺着冰窟游到破冰的那一侧——水面上一道往前推的 V 形白沫尾迹 + 一路的暗涌（<see cref="KunSwimWake"/>）。
        /// center = 冰窟中心（水面高），ring = 游的那一圈半径，fromYaw → toYaw（相对圆心的方位，度），seconds 秒游完
        /// </summary>
        public static void KunSwim(Vector3 center, float ring, float fromYaw, float toYaw, float seconds) => KunSwimWake.Run(center, ring, fromYaw, toYaw, seconds);

        /// <summary>吐冰 · 蓄冰珠（前摇每帧调）：口前一锥冷雾和冰屑往嘴里收，k = 前摇进度（越到出手越密）</summary>
        public static void KunSpitGather(Vector3 mouth, Vector3 forward, float k, float dt)
        {
            if (!Finite(mouth) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            forward.y = 0;
            forward = forward.sqrMagnitude > 1e-4f ? forward.normalized : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, forward);
            int n = KpCount(Mathf.Lerp(10f, 40f, Mathf.Clamp01(k)), dt);
            var shard = rt.GetEmitter("ShardIce");
            for (int i = 0; shard != null && i < n; i++)
            {
                var p = mouth + forward * Random.Range(2.5f, 5f) + side * Random.Range(-2.5f, 2.5f) + Vector3.up * Random.Range(-1.5f, 1.5f);
                rt.EmitOne(shard, p, (mouth - p) * Random.Range(2.2f, 2.8f), Random.Range(0.1f, 0.16f), Random.Range(0.3f, 0.4f), KunIce, 0);
            }
            if (Random.value < dt * 6f)
                KpMany(rt, "ToonSmoke", 1, i =>
                {
                    var p = mouth + forward * Random.Range(3f, 5f) + Random.insideUnitSphere * 1.2f;
                    return (p, (mouth - p) * 1.6f, Random.Range(0.9f, 1.3f), Random.Range(0.45f, 0.6f));
                }, KpAlpha(KunMist, 0.55f));
        }

        /// <summary>吐冰 · 蓄力顶点（apex 事件）：口里冰珠到最亮的那一下「叮」：一颗冰晶星 + 一圈小白环</summary>
        public static void KunSpitApex(Vector3 mouth)
        {
            if (!Finite(mouth)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "IceStar", mouth, Vector3.zero, 2.4f, 0.22f, KunCore);
            KpOne(rt, "RingPop", mouth, Vector3.zero, 2.8f, 0.2f, KpAlpha(KunCore, 0.9f));
        }

        /// <summary>落台 · 敛翼（fold 事件）：收翅时从两翼抖落的雪 + 一小团冷白雪雾</summary>
        public static void PengFoldShake(Vector3 tipL, Vector3 tipR, Vector3 ground)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            foreach (var tip in new[] { tipL, tipR })
            {
                if (!Finite(tip)) continue;
                KpMany(rt, "Snow", 7, i => (tip + Random.insideUnitSphere * 1.2f, Vector3.down * Random.Range(2f, 4f) + Random.insideUnitSphere * 1.5f,
                    Random.Range(0.22f, 0.34f), Random.Range(0.8f, 1.2f)), KunCore);
            }
            if (Finite(ground))
                KpMany(rt, "ToonSmoke", 3, i =>
                {
                    var d = KpDir(Random.Range(0f, 360f));
                    return (ground + d * Random.Range(1f, 2.2f) + Vector3.up * 0.3f, d * 1.2f + Vector3.up * 0.5f, Random.Range(1.2f, 1.6f), Random.Range(0.5f, 0.7f));
                }, KpAlpha(KunMist, 0.6f));
        }

        /// <summary>起飞 · 蓄力（起飞前摇每帧调）：脚下一圈的雪和短风线往爪下收、往上卷，k = 蓄力进度；和起飞预警一起读「它要从这里起来」</summary>
        public static void PengTakeoffGather(Vector3 ground, float radius, float k, float dt)
        {
            if (!Finite(ground) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var snow = rt.GetEmitter("Snow");
            int n = KpCount(Mathf.Lerp(10f, 34f, Mathf.Clamp01(k)), dt);
            for (int i = 0; snow != null && i < n; i++)
            {
                var d = KpDir(Random.Range(0f, 360f));
                var p = ground + d * radius * Random.Range(0.75f, 1.05f) + Vector3.up * 0.2f;
                var tangent = KpDir(Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg + 90f);
                rt.EmitOne(snow, p, (ground - p) * Random.Range(1.2f, 1.6f) + tangent * 3f + Vector3.up * Random.Range(1f, 2.5f), Random.Range(0.18f, 0.28f),
                    Random.Range(0.5f, 0.7f), KunCore, 0);
            }
            if (Random.value < dt * Mathf.Lerp(3f, 9f, Mathf.Clamp01(k)) * Mathf.Lerp(0.5f, 1f, Density) && FxBudget.Allow(1, false) > 0)
            {
                float a = Random.Range(0f, 360f), r0 = radius * Random.Range(0.8f, 1.1f);
                var p0 = ground + KpDir(a) * r0 + Vector3.up * 0.35f;
                var p1 = ground + KpDir(a + 18f) * r0 * 0.6f + Vector3.up * 0.5f;
                Tracer(p0, p1, PengLine, 0.1f);
            }
        }

        /// <summary>鹏倒下 · 翼折（wingBreak 事件）：左翼中弹折断的那一下——一记冰晶星 + 碎冰羽往外崩 + 一团雪羽 + 冷白雾</summary>
        public static void PengWingBreak(Vector3 wing)
        {
            if (!Finite(wing)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "IceStar", wing, Vector3.zero, 2.4f, 0.2f, KunCore);
            KpOne(rt, "ToonBurst", wing, Vector3.zero, 2f, 0.1f, KunCore);
            KpMany(rt, "ShardIce", 12, i => (wing, Random.onUnitSphere * Random.Range(5f, 10f), Random.Range(0.14f, 0.24f), Random.Range(0.45f, 0.7f)), KunIce);
            KpMany(rt, "Snow", 14, i => (wing + Random.insideUnitSphere * 0.8f, Random.insideUnitSphere * 5f + Vector3.down * 1.5f, Random.Range(0.28f, 0.42f),
                Random.Range(1f, 1.5f)), KunCore);
            KpMany(rt, "ToonSmoke", 2, i => (wing, Random.insideUnitSphere * 1.5f, Random.Range(1.2f, 1.6f), Random.Range(0.4f, 0.55f)), KpAlpha(KunMist, 0.6f));
        }

        /// <summary>鹏倒下 · 坠落（每帧调）：折了的那只翅膀一路掉雪羽，乱扑（flail 事件，burst = true）时一把撒出去</summary>
        public static void PengFeatherShed(Vector3 wing, float dt, bool burst = false)
        {
            if (!Finite(wing)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var snow = rt.GetEmitter("Snow");
            if (snow == null) return;
            int n = burst ? FxBudget.Allow(Mathf.RoundToInt(10 * Density), false) : KpCount(22f, dt);
            for (int i = 0; i < n; i++)
                rt.EmitOne(snow, wing + Random.insideUnitSphere * 1.2f, Random.insideUnitSphere * (burst ? 4f : 1.5f) + Vector3.up * Random.Range(1f, 3f),
                    Random.Range(0.26f, 0.4f), Random.Range(1.2f, 1.8f), KunCore, 0);
        }

        /// <summary>
        /// 鹏倒下 · 落地（land 事件）：砸在冰面上 = 一圈贴地风环 + 雪羽往四周拍出去 + 冷白雪雾；坠进北冥 = 水冠 + 水柱 + 大涟漪 + 往下吸的小漩涡
        /// （碎冰、冰环、震屏、闷响由 KunPengDeath 同一帧出）
        /// </summary>
        public static void PengCrash(Vector3 ground, bool water)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (water)
            {
                Surge.Crown(ground, 3.2f, 4.5f, SurgeKind.Water, 0.9f, KunWater, KunFoam);
                Surge.Column(ground, 2.2f, 7f, SurgeKind.Water, 0.15f, 0.2f, 0.6f, KunWater, KunFoam, 2.4f);
                Splash(ground, 4.5f, NorthSea);
                WaterDisturb(ground, 10f, 2f);
                KunVortex(ground, 5f, 2.4f);
            }
            else
            {
                KpOne(rt, "ToonRing", ground + Vector3.up * 0.1f, Vector3.zero, 10f, 0.5f, PengWind);
                KpOne(rt, "RingFlat", ground + Vector3.up * 0.12f, Vector3.zero, 13f, 0.6f, KpAlpha(PengLine, 0.85f));
            }
            KpMany(rt, "Snow", 22, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (ground + d * Random.Range(1f, 3f) + Vector3.up * 0.6f, d * Random.Range(4f, 9f) + Vector3.up * Random.Range(2f, 5f), Random.Range(0.28f, 0.42f),
                    Random.Range(1f, 1.6f));
            }, KunCore);
            KpMany(rt, "ToonSmoke", 5, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (ground + d * Random.Range(1.5f, 3f) + Vector3.up * 0.4f, d * Random.Range(2f, 3.5f) + Vector3.up * 0.6f, Random.Range(1.6f, 2.2f),
                    Random.Range(0.6f, 0.85f));
            }, KpAlpha(KunMist, 0.75f));
        }

        /// <summary>鹏倒下 · 最后一声（lastCry 事件）：抬头朝北冥的那一下，额头鲛珠一记冷光 + 一小圈雪雾</summary>
        public static void PengLastCry(Vector3 head)
        {
            if (!Finite(head)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            FrostGlint(head, 1.8f);
            Flash(head, KunIce, 3f, 8f, 0.25f);
            KpMany(rt, "ToonSmoke", 3, i => (head + Random.insideUnitSphere * 0.6f, Vector3.up * 1.2f + Random.insideUnitSphere, Random.Range(1f, 1.4f), Random.Range(0.6f, 0.8f)),
                KpAlpha(KunMist, 0.55f));
        }

        /// <summary>
        /// 鹏倒下 · 归冥（溃散之后）：「化而为鸟」倒着走一遍——身子散成的雪羽顺着一股往下旋的风流回冰窟，落进北冥的那一刻水面转起一个小漩涡、
        /// 一圈涟漪荡开、一点冷光沉下去，之后冰海平静（<see cref="PengReturnRun"/>）。from = 溃散的位置，water = 冰窟中心的水面点
        /// </summary>
        public static void PengReturnToSea(Vector3 from, Vector3 water, float holeRadius, Action onArrive = null) =>
            PengReturnRun.Run(from, water, holeRadius, onArrive);

        // ───────────── 化形 ─────────────

        /// <summary>北冥漩涡（鲲沉的时候）：冰窟水面一个往里卷的大漩涡圆盘</summary>
        public static FxHandle KunVortex(Vector3 water, float radius, float seconds) =>
            Finite(water) ? Surge.Disk(water + Vector3.up * 0.08f, radius, SurgeKind.Water, Mathf.Max(0.5f, seconds), 240f, -1.9f, 1f, KunDeep, KunFoam, 0.85f)
                : FxHandle.None;

        /// <summary>
        /// 「水击三千里」：冰窟中心白热爆闪 + 冷光；冰沿一圈 columns 根水柱；冰板往外抛；整圈浪墙（<see cref="KunWave"/> 360°）推到外缘
        /// </summary>
        public static void KunWaterStrike(Vector3 center, float waterY, float holeRadius, float outer, int columns = 8)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var w = new Vector3(center.x, waterY, center.z);
            KpOne(rt, "ToonBurst", w + Vector3.up * 2f, Vector3.zero, 10f, 0.16f, KunCore);
            KpOne(rt, "IceStar", w + Vector3.up * 3f, Vector3.zero, 9f, 0.24f, KunCore);
            Flash(w + Vector3.up * 4f, KunIce, 10f, Mathf.Max(30f, outer), 0.25f);
            float a0 = Random.Range(0f, 360f);
            for (int i = 0; i < columns; i++)
            {
                var p = w + KpDir(a0 + i * 360f / columns) * Mathf.Max(1f, holeRadius - 1.2f);
                Surge.Column(p, 1.4f, Random.Range(9f, 13f), SurgeKind.Water, 0.18f, 0.3f, 0.65f, KunWater, KunFoam, 2.2f);
            }
            KpMany(rt, "IceChunk", 20, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (w + d * holeRadius + Vector3.up * 0.4f, d * Random.Range(5f, 10f) + Vector3.up * Random.Range(7f, 12f), Random.Range(0.6f, 1f),
                    Random.Range(0.9f, 1.2f));
            }, KunCore);
            var floor = new Vector3(center.x, center.y, center.z);
            KunWave(floor, 0f, 360f, Mathf.Max(1f, holeRadius), outer + 2f, 16f, 5f);
        }

        /// <summary>
        /// 扶摇柱：冰窟中心拔起两层水风柱（外层半透明、内层更实），条纹往上飞快地流。hold = 停留秒数；返回外 / 内两个句柄（展翅时 Cancel 进入塌落）
        /// </summary>
        public static (FxHandle outer, FxHandle inner) KunPengUpdraft(Vector3 water, float height, float hold)
        {
            if (!Finite(water)) return (FxHandle.None, FxHandle.None);
            var o = Surge.Column(water, 5.5f, height, SurgeKind.Water, 0.35f, hold, 0.9f, KunWater, KunFoam, 3.6f, 0.6f);
            var i = Surge.Column(water, 3.2f, height * 0.85f, SurgeKind.Water, 0.3f, hold, 0.8f, PengWind, Color.white, 4.6f, 0.85f);
            return (o, i);
        }

        /// <summary>
        /// 化而为鸟（展翅的释放帧）：鹏的高度上一圈快转的风环（环带体积 3 → 18 m）、径向风线、雪羽、白热爆闪 + 冷光
        /// </summary>
        public static void PengSpreadBurst(Vector3 body, float span = 9f)
        {
            if (!Finite(body)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "ToonBurst", body, Vector3.zero, 8.5f, 0.15f, KunCore);
            KpOne(rt, "RingPop", body, Vector3.zero, 14f, 0.32f, KunCore);
            Flash(body, KunIce, 9f, 40f, 0.22f);
            Surge.Annulus(body, 3f, span * 2f, SurgeKind.Water, 1.1f, 420f, 2.4f, PengWind, Color.white, 0.6f);
            KpMany(rt, "Spray", 40, i =>
            {
                var d = KpDir(Random.Range(0f, 360f));
                return (body + d * Random.Range(1f, 3f) + Vector3.up * Random.Range(-1f, 1f), d * Random.Range(16f, 24f) + Vector3.up * Random.Range(-1f, 2f),
                    Random.Range(0.1f, 0.14f), Random.Range(0.4f, 0.6f));
            }, KpAlpha(PengWind, 0.95f));
            KpMany(rt, "Snow", 20, i => (body + Random.insideUnitSphere * span * 0.5f, Random.insideUnitSphere * 6f + Vector3.down * 1.5f, Random.Range(0.3f, 0.45f),
                Random.Range(1.2f, 1.8f)), KunCore);
        }
    }

    /// <summary>
    /// 浪头跑马（<see cref="Fx.KunWave"/> 带出来的）：浪墙的前沿按 start + speed × t 往外走，每 0.08 s 在前沿上挑几点翻起白沫团、甩几片碎冰，
    /// 走到 range 就收掉。一道浪一个，不进对象池（整场最多同时 3–4 道）；数量乘画质密度、过预算
    /// </summary>
    public sealed class KunWaveCrest : MonoBehaviour
    {
        Vector3 center;
        float yaw, arc, start, range, speed, t, acc;

        /// <summary>场上正在跑的浪头（测试用）</summary>
        public static int Live { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Live = 0;

        public static void Run(Vector3 center, float yaw, float arcDeg, float start, float range, float speed)
        {
            if (!Application.isPlaying) return;
            var go = new GameObject("KunPeng Wave Crest");
            var c = go.AddComponent<KunWaveCrest>();
            c.center = center;
            c.yaw = yaw;
            c.arc = Mathf.Clamp(arcDeg, 10f, 360f);
            c.start = start;
            c.range = range;
            c.speed = speed;
            Live++;
        }

        void OnDestroy() => Live = Mathf.Max(0, Live - 1);

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            float r = start + speed * t;
            if (r >= range)
            {
                Destroy(gameObject);
                return;
            }
            acc += dt;
            if (acc < 0.08f) return;
            acc = 0;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var foam = rt.GetEmitter("ToonSmoke");
            var shard = rt.GetEmitter("ShardIce");
            // 每一跳的点数随弧长：整圈 8 点、窄扇 3 点
            int pts = FxBudget.Allow(Mathf.RoundToInt(Mathf.Lerp(3f, 8f, arc / 360f) * Fx.Density), false);
            for (int i = 0; i < pts; i++)
            {
                float a = yaw + Random.Range(-arc * 0.5f, arc * 0.5f);
                float rad = a * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Sin(rad), 0, Mathf.Cos(rad));
                var p = center + d * r + Vector3.up * Random.Range(0.6f, 1.6f);
                if (foam != null)
                    rt.EmitOne(foam, p, d * speed * 0.5f + Vector3.up * 1.6f, Random.Range(0.9f, 1.4f), Random.Range(0.35f, 0.5f), new Color(Fx.KunFoam.r, Fx.KunFoam.g, Fx.KunFoam.b, 0.85f), 0);
                if (shard != null && Random.value < 0.6f)
                    rt.EmitOne(shard, p, d * speed * 0.7f + Vector3.up * Random.Range(3f, 6f), Random.Range(0.14f, 0.22f), Random.Range(0.35f, 0.5f), Fx.KunIce, 0);
            }
        }
    }

    /// <summary>
    /// 潜袭的潜游尾迹（<see cref="Fx.KunSwim"/>）：水下的鲲从 fromYaw 顺着冰窟的一圈游到 toYaw（走短的那一边），水面上的头部一路推出 V 形的白沫
    /// （两侧往外散的白沫团 + 正上方一圈白沫环）和一路暗涌（EnvWater 扰动）。一次潜袭一个，不进对象池；数量乘画质密度、过预算
    /// </summary>
    public sealed class KunSwimWake : MonoBehaviour
    {
        Vector3 center;
        float ring, from, delta, seconds, t, acc;

        public static void Run(Vector3 center, float ring, float fromYaw, float toYaw, float seconds)
        {
            if (!Application.isPlaying || !Fx.Finite(center) || !(seconds > 0.05f)) return;
            var go = new GameObject("KunPeng Swim Wake");
            var w = go.AddComponent<KunSwimWake>();
            w.center = center;
            w.ring = Mathf.Max(1f, ring);
            w.from = fromYaw;
            w.delta = Mathf.DeltaAngle(fromYaw, toYaw);
            w.seconds = seconds;
        }

        Vector3 At(float k)
        {
            float a = (from + delta * k) * Mathf.Deg2Rad;
            return center + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * ring;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            float k = Mathf.Clamp01(t / seconds);
            // 先快后慢（冲到那一侧、减速停住），停住后再留 0.15 s 收尾
            float e = 1 - (1 - k) * (1 - k);
            var head = At(e);
            if (t >= seconds + 0.15f)
            {
                Destroy(gameObject);
                return;
            }
            acc += dt;
            if (acc < 0.05f || k >= 1f) return;
            acc = 0;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var ahead = At(Mathf.Min(1f, e + 0.02f)) - head;
            ahead.y = 0;
            var f = ahead.sqrMagnitude > 1e-4f ? ahead.normalized : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, f);
            var foam = rt.GetEmitter("ToonSmoke");
            int n = FxBudget.Allow(Mathf.RoundToInt(4 * Fx.Density), false);
            for (int i = 0; foam != null && i < n; i++)
            {
                float s = i % 2 == 0 ? 1f : -1f;
                var p = head - f * Random.Range(0.5f, 2f) + side * s * Random.Range(0.8f, 1.8f) + Vector3.up * 0.25f;
                rt.EmitOne(foam, p, side * s * Random.Range(2f, 4f) - f * 1.5f + Vector3.up * 0.6f, Random.Range(0.9f, 1.4f), Random.Range(0.5f, 0.75f),
                    new Color(Fx.KunFoam.r, Fx.KunFoam.g, Fx.KunFoam.b, 0.85f), 0);
            }
            var ring = rt.GetEmitter("RingFlat");
            if (ring != null && FxBudget.Allow(1, false) > 0)
                rt.EmitOne(ring, head + Vector3.up * 0.08f, Vector3.zero, Random.Range(3.5f, 4.5f), 0.5f, new Color(Fx.KunFoam.r, Fx.KunFoam.g, Fx.KunFoam.b, 0.7f), 0);
            Fx.WaterDisturb(head, 3.5f, 0.8f);
        }
    }

    /// <summary>
    /// 鹏倒下后的归冥（<see cref="Fx.PengReturnToSea"/>）：1.3 s 里一股雪羽 + 风线从溃散处起、先往上扬再往冰窟中心落（绕着路径打旋），
    /// 到了水面：小漩涡、涟漪、一点冷光沉下去，回调 onArrive（KunPengDeath 用它把冰窟水面的翻涌收到平静）。离冰窟很近（坠进北冥）时直接在水面收尾
    /// </summary>
    public sealed class PengReturnRun : MonoBehaviour
    {
        const float Flight = 1.3f;
        Vector3 from, water, mid;
        float t, acc, holeRadius;
        bool arrived;
        Action onArrive;

        public static void Run(Vector3 from, Vector3 water, float holeRadius, Action onArrive)
        {
            if (!Application.isPlaying || !Fx.Finite(from) || !Fx.Finite(water)) return;
            var go = new GameObject("KunPeng Return To Sea");
            var r = go.AddComponent<PengReturnRun>();
            r.from = from;
            r.water = water;
            r.holeRadius = Mathf.Max(3f, holeRadius);
            r.onArrive = onArrive;
            var flat = new Vector2(water.x - from.x, water.z - from.z).magnitude;
            r.mid = Vector3.Lerp(from, water, 0.5f) + Vector3.up * Mathf.Clamp(flat * 0.35f, 2f, 7f);
            if (flat < 3f) r.t = Flight;
        }

        Vector3 Path(float k)
        {
            float u = 1 - k;
            return u * u * from + 2 * u * k * mid + k * k * water;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            if (!arrived && t >= Flight)
            {
                arrived = true;
                Arrive();
            }
            if (t >= Flight + 0.2f)
            {
                Destroy(gameObject);
                return;
            }
            if (arrived) return;
            acc += dt;
            if (acc < 0.04f) return;
            acc = 0;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float k = Mathf.Clamp01(t / Flight);
            var head = Path(k);
            var next = Path(Mathf.Min(1f, k + 0.04f));
            var fwd = next - head;
            var f = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.down;
            var side = Vector3.Cross(Vector3.up, f).sqrMagnitude > 1e-4f ? Vector3.Cross(Vector3.up, f).normalized : Vector3.right;
            var up = Vector3.Cross(f, side);
            var snow = rt.GetEmitter("Snow");
            int n = FxBudget.Allow(Mathf.RoundToInt(5 * Fx.Density), false);
            float spin = t * 900f;
            for (int i = 0; snow != null && i < n; i++)
            {
                float a = (spin + i * 72f) * Mathf.Deg2Rad;
                var off = (side * Mathf.Cos(a) + up * Mathf.Sin(a)) * Random.Range(0.6f, 1.4f);
                rt.EmitOne(snow, head + off, f * Random.Range(6f, 10f) + off * 2f, Random.Range(0.24f, 0.36f), Random.Range(0.4f, 0.6f), Fx.KunCore, 0);
            }
            if (FxBudget.Allow(1, false) > 0)
            {
                float a = spin * 1.3f * Mathf.Deg2Rad;
                var off = (side * Mathf.Cos(a) + up * Mathf.Sin(a)) * 1.1f;
                Fx.Tracer(head + off, next + off * 0.8f, Fx.PengWind, 0.1f);
            }
        }

        void Arrive()
        {
            var rt = FxRuntime.Ensure();
            Fx.KunVortex(water, Mathf.Min(6f, holeRadius * 0.4f), 2.2f);
            Fx.WaterDisturb(water, Mathf.Max(8f, holeRadius * 0.7f), 1.2f);
            Fx.FrostGlint(water + Vector3.up * 0.4f, 2.2f);
            if (rt)
            {
                var e = rt.GetEmitter("ToonRing");
                if (e != null && FxBudget.Allow(1, true) > 0) rt.EmitOne(e, water + Vector3.up * 0.08f, Vector3.zero, Mathf.Max(8f, holeRadius * 0.8f), 1.2f,
                    new Color(Fx.KunFoam.r, Fx.KunFoam.g, Fx.KunFoam.b, 0.7f), 0);
            }
            try { onArrive?.Invoke(); }
            catch (Exception e) { Debug.LogException(e); }
        }
    }
}
