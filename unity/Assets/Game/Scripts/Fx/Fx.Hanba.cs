using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃的招式特效（首领与精英动作 · 特效调优 H 路；设计单 docs/art/vfx/hanba.md）。母题：赤地千里、日轮、龟裂、热浪、焦土。
    /// 色阶统一三阶（docs/art/fx-style.md §2.1 火 · 日火）：亮芯 <see cref="HanbaCore"/> 近白暖金 / 主色 <see cref="HanbaGold"/> 日火金 / 暗边 <see cref="HanbaOchre"/> 赭红；
    /// 尘按第一章底色走暖砂（<see cref="HanbaDust"/>），泉珠的「打这里」标记用泉水的青白（<see cref="HanbaPearl"/>）。
    /// 形状语言：圆 / 环 = 日轮的范围和能量（聚光、日冕珠、收缩的灼点印），尖角 / 锯齿 = 切割与危险（裂口的火头、龟裂星），
    /// 方块 = 土石的重量（按掌崩起的石块），流线 = 风（旱风的月牙热浪前沿、往里吸的沙线）。
    /// 大形用卡通序列帧风格（ToonBurst / ToonPop / ToonRing / ToonSeal / ToonDust / ToonSmoke / ToonFlame），小粒子只做点缀、数量少个头大；
    /// 每一层都过 <see cref="FxBudget"/>（数量先乘画质密度，满了按剩余空间缩；释放帧的亮芯是 essential，低画质也留着）。
    /// 只管外观，不碰判定；出手那一帧（释放帧）由招式在 Cue（动画出手事件）那一帧调用。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>旱魃日火三阶：亮芯 / 主色 / 暗边；暖砂尘；泉珠青白</summary>
        public static readonly Color HanbaCore = Hex.Rgb(0xfff4d6), HanbaGold = Hex.Rgb(0xffc24a), HanbaOchre = Hex.Rgb(0xc8642a),
            HanbaDust = Hex.Rgb(0xdcb880), HanbaPearl = Hex.Rgb(0xa8ecff);

        // ───────────── 工具 ─────────────

        /// <summary>按 dt 和每秒速率算这一帧发几颗（小数部分按概率进位），乘画质密度、过预算</summary>
        static int HanbaCount(float perSecond, float dt)
        {
            if (!(dt > 0) || !(perSecond > 0)) return 0;
            float expected = perSecond * dt * Mathf.Lerp(0.5f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            return FxBudget.Allow(n, false);
        }

        /// <summary>发一颗（大形：essential，预算满了也留着）</summary>
        static void HanbaOne(FxRuntime rt, string style, Vector3 p, Vector3 v, float size, float life, Color c, bool essential = true)
        {
            var e = rt.GetEmitter(style);
            if (e == null || FxBudget.Allow(1, essential) < 1) return;
            rt.EmitOne(e, p, v, size, life, c, 0);
        }

        /// <summary>一次发 n 颗点缀（乘密度、过预算），每颗的位置 / 速度由 make 给</summary>
        static void HanbaMany(FxRuntime rt, string style, int n, System.Func<int, (Vector3 p, Vector3 v, float size, float life)> make, Color c)
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

        // ───────────── 日轮扫射 ─────────────

        /// <summary>
        /// 日轮聚光（前摇里每帧调）：光点从轮缘的八根辐条尖沿辐条收进轮毂，k（0..1 蓄力进度）越大越密、越亮；
        /// 轮毂一团越来越亮的白金芯。right / up = 轮面的两根轴，radius = 轮半径（米）
        /// </summary>
        public static void HanbaRingGather(Vector3 hub, Vector3 right, Vector3 up, float radius, float k, float dt)
        {
            if (!Finite(hub) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            k = Mathf.Clamp01(k);
            float s = radius / 3f;
            int n = HanbaCount(Mathf.Lerp(10f, 46f, k), dt);
            var e = rt.GetEmitter("StreakLight");
            var mote = rt.GetEmitter("Mote");
            float life = Mathf.Lerp(0.42f, 0.26f, k);
            var c = Color.Lerp(HanbaGold, HanbaCore, k);
            for (int i = 0; e != null && i < n; i++)
            {
                float a = Random.Range(0, 8) * Mathf.PI * 0.25f + Random.Range(-0.08f, 0.08f);
                var dir = right * Mathf.Cos(a) + up * Mathf.Sin(a);
                var p = hub + dir * radius * Random.Range(0.85f, 1.05f);
                // 一半是沿辐条往里冲的金丝，一半是大一号的光珠（远处也看得到「光往轮毂收」）
                if ((i & 1) == 0 || mote == null) rt.EmitOne(e, p, -dir * radius / life, Random.Range(0.14f, 0.2f) * s, life, c, 0);
                else rt.EmitOne(mote, p, -dir * radius / life, Random.Range(0.35f, 0.5f) * s, life, c, 0);
            }
            // 轮毂芯：柔光 + 四芒星，尺寸随蓄力涨（越到顶点越亮越大），读作「能量往中间聚」
            if (Random.value < dt * 30f) HanbaOne(rt, "Glow", hub, Vector3.zero, (1.0f + 2.2f * k) * s, 0.12f, c, false);
            if (k > 0.3f && Random.value < dt * 12f) HanbaOne(rt, "Flare", hub, Vector3.zero, (1.2f + 2.6f * k) * s, 0.12f, HanbaCore, false);
        }

        /// <summary>
        /// 灼点印：光束第一下落点的地上一圈收紧的日火刻符环（ToonSeal：从 radius 收到不到一半），seconds 正好收完——倒计时，收紧到底就是释放帧
        /// </summary>
        public static void HanbaFocusSeal(Vector3 ground, float radius, float seconds)
        {
            if (!Finite(ground) || !(radius > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonSeal", ground + Vector3.up * 0.08f, Vector3.zero, radius * 2f, Mathf.Max(0.2f, seconds), HanbaCore);
            HanbaOne(rt, "ToonSeal", ground + Vector3.up * 0.07f, Vector3.zero, radius * 2.6f, Mathf.Max(0.2f, seconds), HanbaGold);
        }

        /// <summary>
        /// 光束释放帧：轮毂一记白金爆闪星 + 「啪」的冲击环 + 闪光灯，落点一记爆闪、贴地冲击环、往上溅的金丝、一圈暖砂尘团、日火裂痕。
        /// 亮芯第一帧到峰值，0.15 s 交代完，尘团 0.5 s 内退场
        /// </summary>
        public static void HanbaSunStrike(Vector3 hub, Vector3 ground, float ringRadius)
        {
            if (!Finite(hub) || !Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float s = Mathf.Max(0.5f, ringRadius / 3f);
            HanbaOne(rt, "ToonBurst", hub, Vector3.zero, 5.2f * s, 0.14f, HanbaCore);
            HanbaOne(rt, "ToonPop", hub, Vector3.zero, 3.4f * s, 0.24f, HanbaGold);
            Flash(hub, HanbaGold, 9f, 20f * s, 0.2f);
            HanbaOne(rt, "ToonBurst", ground + Vector3.up * 0.4f, Vector3.zero, 2.6f, 0.12f, HanbaCore);
            HanbaOne(rt, "ToonRing", ground + Vector3.up * 0.05f, Vector3.zero, 2.2f, 0.32f, HanbaGold);
            HanbaOne(rt, "ToonDust", ground + Vector3.up * 0.05f, Vector3.zero, 2.8f, 0.55f, HanbaDust);
            HanbaMany(rt, "StreakLight", 14, i =>
            {
                var d = Random.insideUnitSphere;
                d.y = Mathf.Abs(d.y) + 0.6f;
                return (ground + Vector3.up * 0.2f, d.normalized * Random.Range(7f, 13f), Random.Range(0.07f, 0.11f), Random.Range(0.22f, 0.38f));
            }, HanbaGold);
            FxDecals.Fire(ground + Vector3.up * 0.02f, 1.3f, 3.2f, FireBed.Sunfire);
        }

        /// <summary>
        /// 光束犁地的前沿（持续段每帧调）：落点一颗白金热芯、顺着扫的方向甩出去的金丝和沙线、偶尔一簇往上冲的日火苗——看得出光束正往哪边扫、扫得多快
        /// </summary>
        public static void HanbaBeamEdge(Vector3 ground, Vector3 sweepDir, float dt)
        {
            if (!Finite(ground) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            sweepDir.y = 0;
            sweepDir = sweepDir.sqrMagnitude > 1e-4f ? sweepDir.normalized : Vector3.forward;
            if (Random.value < dt * 24f) HanbaOne(rt, "Glow", ground + Vector3.up * 0.25f, Vector3.up * 0.4f, 1.1f, 0.12f, HanbaCore, false);
            int n = HanbaCount(40f, dt);
            var spark = rt.GetEmitter("StreakLight");
            for (int i = 0; spark != null && i < n; i++)
            {
                var v = (sweepDir * Random.Range(0.6f, 1.2f) + Vector3.up * Random.Range(0.5f, 1.3f) + Random.insideUnitSphere * 0.35f) * Random.Range(5f, 9f);
                rt.EmitOne(spark, ground + Vector3.up * 0.15f, v, Random.Range(0.06f, 0.09f), Random.Range(0.18f, 0.32f), HanbaGold, 0);
            }
            int m = HanbaCount(14f, dt);
            var sand = rt.GetEmitter("Spray");
            var sc = HanbaDust;
            sc.a = 0.9f;
            for (int i = 0; sand != null && i < m; i++)
            {
                var v = (sweepDir + Vector3.up * Random.Range(0.6f, 1.4f) + Random.insideUnitSphere * 0.4f) * Random.Range(4f, 7f);
                rt.EmitOne(sand, ground + Vector3.up * 0.1f, v, Random.Range(0.1f, 0.16f), Random.Range(0.35f, 0.55f), sc, 0);
            }
            if (Random.value < dt * 5f) HanbaOne(rt, "ToonFlame", ground, Vector3.up * 0.8f, Random.Range(0.7f, 1.0f), 0.45f, HanbaGold, false);
        }

        /// <summary>光束熄灭的余韵：沿光束一串往上飘的金色光点、轮毂一颗缩回去的柔光（0.4 s 内退场）</summary>
        public static void HanbaBeamFade(Vector3 hub, Vector3 ground)
        {
            if (!Finite(hub) || !Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaMany(rt, "Mote", 10, i =>
            {
                var p = Vector3.Lerp(hub, ground, (i + Random.value) / 10f);
                return (p, Vector3.up * Random.Range(0.4f, 1.2f) + Random.insideUnitSphere * 0.3f, Random.Range(0.18f, 0.3f), Random.Range(0.3f, 0.45f));
            }, HanbaGold);
            HanbaOne(rt, "Glow", hub, Vector3.zero, 2.2f, 0.3f, HanbaGold, false);
        }

        // ───────────── 旱风 ─────────────

        /// <summary>
        /// 旱风的吸气（前摇里每帧调）：她身前两侧 5–10 m 的沙被往她脚下吸——一道道沙线往里收，脚下卷一团沙；k = 蓄力进度
        /// </summary>
        public static void HanbaGaleInhale(Vector3 feet, float yaw, float halfAngle, float k, float dt)
        {
            if (!Finite(feet) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            k = Mathf.Clamp01(k);
            int n = HanbaCount(Mathf.Lerp(16f, 46f, k), dt);
            var sand = rt.GetEmitter("Spray");
            // 沙线用暗一阶的赭砂：亮沙地上浅沙色的线看不出来（fx-style §2.2 第一章底色的暗边）
            var sc = Color.Lerp(HanbaDust, HanbaOchre, 0.45f);
            sc.a = 0.95f;
            for (int i = 0; sand != null && i < n; i++)
            {
                float a = (yaw + Random.Range(-halfAngle - 40f, halfAngle + 40f)) * Mathf.Deg2Rad;
                var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                float r = Random.Range(5f, 10f);
                float life = Random.Range(0.35f, 0.5f);
                var p = feet + dir * r + Vector3.up * Random.Range(0.2f, 1.6f);
                rt.EmitOne(sand, p, -dir * (r - 1.2f) / life + Vector3.up * 1.2f, Random.Range(0.14f, 0.22f), life, sc, 0);
            }
            if (Random.value < dt * (3f + 6f * k))
            {
                var d = Random.insideUnitCircle.normalized * 1.4f;
                HanbaOne(rt, "ToonSmoke", feet + new Vector3(d.x, 0.3f, d.y), new Vector3(-d.y, 0.6f, d.x) * 1.4f, Random.Range(0.9f, 1.3f), 0.55f, HanbaDust, false);
            }
        }

        /// <summary>
        /// 旱风释放帧：掌前一记爆闪、一道贴地的月牙热浪前沿（敌方刀光：暗月牙托出亮刃，弧 = 扇区张角）、脚下一圈沙尘团、暖色闪光灯。
        /// 主形就是那道月牙——缩到 25% 也读得出「一片扇形往外推」
        /// </summary>
        public static void HanbaGaleFront(Vector3 origin, Vector3 palms, float yaw, float halfAngle)
        {
            if (!Finite(origin)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Finite(palms))
            {
                HanbaOne(rt, "ToonBurst", palms, Vector3.zero, 2.4f, 0.12f, HanbaCore);
                HanbaOne(rt, "ToonPop", palms, Vector3.zero, 2.6f, 0.22f, HanbaGold);
                Flash(palms, HanbaGold, 6f, 12f, 0.18f);
            }
            float arc = halfAngle * 2f * Mathf.Deg2Rad;
            Slash(origin + Vector3.up * 1.3f, yaw, 4.2f, arc, 1, 0.08f, 1.4f, 0.36f, HanbaGold, true);
            Slash(origin + Vector3.up * 0.6f, yaw, 3.2f, arc * 0.9f, -1, -0.06f, 1.0f, 0.3f, Color.Lerp(HanbaDust, HanbaOchre, 0.4f), true);
            HanbaOne(rt, "ToonDust", origin + Vector3.up * 0.05f, Vector3.zero, 4f, 0.6f, HanbaDust);
        }

        // ───────────── 焦裂 ─────────────

        /// <summary>焦裂前摇：扬起的手攥着一团日火（每帧调），k = 蓄力进度：火团涨大、光点往掌心收</summary>
        public static void HanbaPalmCharge(Vector3 palm, float k, float dt)
        {
            if (!Finite(palm) || !(dt > 0)) return;
            k = Mathf.Clamp01(k);
            Wisp(palm, Color.Lerp(HanbaGold, HanbaCore, k * 0.6f), 0.5f + 0.7f * k, dt);
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Random.value < dt * 20f) HanbaOne(rt, "Glow", palm, Vector3.zero, 0.8f + 1.2f * k, 0.12f, HanbaGold, false);
            if (k > 0.5f && Random.value < dt * 10f) HanbaOne(rt, "Flare", palm, Vector3.zero, 1.2f + 1.6f * k, 0.12f, HanbaCore, false);
            int n = HanbaCount(Mathf.Lerp(6f, 22f, k), dt);
            var e = rt.GetEmitter("Mote");
            for (int i = 0; e != null && i < n; i++)
            {
                var d = Random.onUnitSphere;
                float r = Random.Range(0.9f, 1.6f), life = 0.3f;
                rt.EmitOne(e, palm + d * r, -d * r / life, Random.Range(0.12f, 0.2f), life, HanbaGold, 0);
            }
        }

        /// <summary>
        /// 按掌释放帧：掌下白金爆闪 + 贴地冲击环 + 一圈龟裂星（尖角）+ 崩起的石块（方块）+ 矮宽的沙尘团 + 砸地（尘浪、裂痕贴花）+ 橙金闪光灯。
        /// 冲击环和尘团贴地、不盖住俯下来的身体
        /// </summary>
        public static void HanbaPalmSlam(Vector3 ground, float yaw)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonBurst", ground + Vector3.up * 0.5f, Vector3.zero, 3.4f, 0.12f, HanbaCore);
            HanbaOne(rt, "ToonRing", ground + Vector3.up * 0.05f, Vector3.zero, 3.4f, 0.36f, HanbaGold);
            HanbaOne(rt, "ToonCrack", ground + Vector3.up * 0.6f, Vector3.zero, 3.0f, 0.2f, HanbaGold);
            HanbaOne(rt, "ToonDust", ground + Vector3.up * 0.05f, Vector3.zero, 4.2f, 0.6f, HanbaDust);
            Flash(ground + Vector3.up * 0.6f, HanbaGold, 8f, 14f, 0.22f);
            HanbaMany(rt, "Chunk", 10, i =>
            {
                float a = (yaw + Random.Range(-110f, 110f)) * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                return (ground + d * Random.Range(0.3f, 1.2f) + Vector3.up * 0.2f, d * Random.Range(2.5f, 5f) + Vector3.up * Random.Range(5f, 8f),
                    Random.Range(0.18f, 0.32f), Random.Range(0.7f, 1.0f));
            }, Hex.Rgb(0xa7804f));
            HanbaMany(rt, "StreakLight", 12, i =>
            {
                var d = Random.insideUnitSphere;
                d.y = Mathf.Abs(d.y) * 0.6f + 0.3f;
                return (ground + Vector3.up * 0.3f, d.normalized * Random.Range(8f, 14f), Random.Range(0.07f, 0.1f), Random.Range(0.2f, 0.35f));
            }, HanbaGold);
            Slam(ground, 3.2f, HanbaDust);
        }

        /// <summary>裂缝的火头（每裂开一段调一次）：一颗白金热芯 + 两颗顺着裂开方向甩出的火星——看得出裂缝往哪走、走多快</summary>
        public static void HanbaCrackHead(Vector3 p, Vector3 dir)
        {
            if (!Finite(p)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            HanbaOne(rt, "Glow", p + Vector3.up * 0.2f, dir * 2f, 1.0f, 0.14f, HanbaCore, false);
            HanbaMany(rt, "StreakLight", 3, i => (p + Vector3.up * 0.15f, (dir * Random.Range(1f, 1.6f) + Vector3.up * Random.Range(0.4f, 1f)) * Random.Range(6f, 10f),
                Random.Range(0.06f, 0.09f), Random.Range(0.15f, 0.25f)), HanbaGold);
        }

        /// <summary>拔掌（收招第一拍，fx:palmOut）：掌下一小团沙尘 + 掌上往下掉的火星——余韵</summary>
        public static void HanbaPalmOut(Vector3 palm, Vector3 ground)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonDust", ground + Vector3.up * 0.05f, Vector3.zero, 2.2f, 0.5f, HanbaDust, false);
            if (Finite(palm))
                HanbaMany(rt, "Ember", 8, i => (palm + Random.insideUnitSphere * 0.3f, Random.insideUnitSphere * 1.2f + Vector3.down * 0.5f,
                    Random.Range(0.08f, 0.14f), Random.Range(0.5f, 0.8f)), HanbaGold);
        }

        // ───────────── 召沙魇 / 飞天之殇 ─────────────

        /// <summary>召沙魇释放帧：掌心砸向地面——脚下一圈压出去的沙尘团 + 贴地沙色冲击环</summary>
        public static void HanbaSummonPress(Vector3 feet)
        {
            if (!Finite(feet)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonDust", feet + Vector3.up * 0.05f, Vector3.zero, 6f, 0.7f, HanbaDust);
            HanbaOne(rt, "ToonRing", feet + Vector3.up * 0.05f, Vector3.zero, 4.5f, 0.4f, HanbaDust);
        }

        /// <summary>飞天之殇释放帧：心口一记金色「啪」环 + 爆闪（双臂展开的那一下）</summary>
        public static void HanbaHeartBloom(Vector3 chest)
        {
            if (!Finite(chest)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonBurst", chest, Vector3.zero, 2.2f, 0.12f, HanbaCore);
            HanbaOne(rt, "ToonPop", chest, Vector3.zero, 3.2f, 0.26f, HanbaGold);
        }

        // ───────────── 日蚀 ─────────────

        /// <summary>
        /// 日冕倒计时珠：黑盘外圈一根辐条尖上的一颗金珠。lit = 这一颗刚亮（一记星芒）；之后招式每 0.12 s 再调一次续上（短命柔光接力，
        /// 亮度不随时间褪）——八颗亮满就是强光
        /// </summary>
        public static void HanbaCoronaBead(Vector3 at, float size, bool lit)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "Glow", at, Vector3.zero, size * 2.4f, 0.2f, HanbaGold);
            if (lit) HanbaOne(rt, "Flare", at, Vector3.zero, size * 3.4f, 0.2f, HanbaCore);
        }

        /// <summary>
        /// 泉珠「打这里」标记（日蚀窗口里每帧调）：两颗绕泉珠转的青白光点 + 一颗随颤抖呼吸的柔光芯；t = 窗口里的时间
        /// </summary>
        public static void HanbaPearlMark(Vector3 pearl, Vector3 right, Vector3 up, float t, float dt)
        {
            if (!Finite(pearl) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Random.value < dt * 20f)
            {
                float pulse = 0.5f + 0.5f * Mathf.Sin(t * 9f);
                HanbaOne(rt, "Glow", pearl, Vector3.zero, 0.55f + 0.35f * pulse, 0.1f, HanbaPearl, false);
            }
            if (Random.value < dt * 30f)
            {
                float a = t * 7f + (Random.value < 0.5f ? 0 : Mathf.PI);
                var p = pearl + (right * Mathf.Cos(a) + up * Mathf.Sin(a)) * 0.42f;
                HanbaOne(rt, "Glow", p, Vector3.zero, 0.22f, 0.16f, Color.white, false);
            }
        }

        /// <summary>
        /// 强光的前兆（fx:gather：窗口快结束、她往里一缩）：脚下一圈日火光点往身上收、一圈收紧的灼点印（seconds 后正好收完 = 复燃）
        /// </summary>
        public static void HanbaFlareGather(Vector3 feet, Vector3 chest, float radius, float seconds)
        {
            if (!Finite(feet) || !Finite(chest)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonSeal", feet + Vector3.up * 0.06f, Vector3.zero, radius * 2f, Mathf.Max(0.15f, seconds), HanbaGold);
            HanbaMany(rt, "StreakLight", 18, i =>
            {
                float a = i / 18f * Mathf.PI * 2f;
                var p = feet + new Vector3(Mathf.Sin(a), 0.2f, Mathf.Cos(a)) * radius;
                float life = Mathf.Max(0.15f, seconds);
                return (p, (chest - p) / life, Random.Range(0.1f, 0.14f), life);
            }, HanbaGold);
        }

        /// <summary>
        /// 复燃（日蚀的释放帧）：日轮一记巨大的白金爆闪星 + 冲击环，她身上一记「啪」，脚下一圈贴地的金环往外扩、放射的金丝，闪光灯。
        /// hubSize = 日轮的世界半径（升顶后放大），feetRadius = 地面金环的半径
        /// </summary>
        public static void HanbaFlare(Vector3 hub, float hubSize, Vector3 chest, Vector3 feet, float feetRadius)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            if (Finite(hub))
            {
                HanbaOne(rt, "ToonBurst", hub, Vector3.zero, hubSize * 3.2f, 0.18f, HanbaCore);
                HanbaOne(rt, "ToonPop", hub, Vector3.zero, hubSize * 2.4f, 0.3f, HanbaGold);
            }
            if (Finite(chest))
            {
                HanbaOne(rt, "ToonPop", chest, Vector3.zero, 5f, 0.26f, HanbaCore);
                Flash(chest, HanbaCore, 12f, 26f, 0.3f);
                HanbaMany(rt, "StreakLight", 24, i =>
                {
                    float a = i / 24f * Mathf.PI * 2f;
                    var d = new Vector3(Mathf.Sin(a), Random.Range(0.1f, 0.5f), Mathf.Cos(a));
                    return (chest, d.normalized * Random.Range(14f, 20f), Random.Range(0.1f, 0.14f), Random.Range(0.3f, 0.45f));
                }, HanbaGold);
            }
            if (Finite(feet))
            {
                HanbaOne(rt, "ToonRing", feet + Vector3.up * 0.06f, Vector3.zero, feetRadius * 0.6f, 0.45f, HanbaGold);
                HanbaOne(rt, "ToonDust", feet + Vector3.up * 0.05f, Vector3.zero, feetRadius * 0.7f, 0.6f, HanbaDust);
            }
        }
    }
}
