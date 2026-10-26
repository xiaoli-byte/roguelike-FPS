using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>曳光样式：普通（暖白）与三种元素（<see cref="FxLines"/> 类说明）</summary>
    public enum TracerKind
    {
        Plain,
        Fire,
        Shock,
        Corrode,
    }

    /// <summary>
    /// 线状特效（Three.js src/fx/Trails.ts）：弹道曳光、持续光束。全部池化的 LineRenderer（材质 M_Fx_Line：柔和横截面、HDR 偏亮），
    /// 每帧只改端点、宽度和顶点色，运行时零分配。闪电在 <see cref="Lightning"/>。
    ///   曳光：一条整段弹道 + 明亮的弹头拖尾，弹头在 0.033–0.055 s 内飞完全程（远距离稍长，保证看得见飞过）；整段弹道从枪口那一头最亮，
    ///     第一人称里看得到从枪口连向准星的一段。生成的那一帧不推进年龄（生成在 Update 里，这一帧的 dt 不属于它）——卡顿帧也至少画一帧。
    ///     元素曳光（<see cref="TracerKind"/>）形状和颜色都不一样，侧面一眼分得出来：
    ///       火 = 橙红弹头（尖端金黄、尾巴暗红）+ 红色光晕，弹头沿途甩出往上飘的火星；
    ///       雷 = 蓝白锯齿：弹头是一段每 0.025 s 重抖一次的折线、亮度一闪一闪，沿途迸电弧碎纹，寿命长一点让闪烁看得出来；
    ///       蚀 = 绿色长拖尾：整段弹道变粗、留 0.35 s 慢慢淡掉，沿途往下滴蚀液。
    ///     元素曳光下面另垫一道普通混合的暗色线（深红 / 深蓝 / 深绿，同敌方刀光的暗月牙）：纯加法的线在亮沙 / 雪地上会偏成黄白，
    ///     垫底把元素色托出来，火和蚀在亮地面上也分得开。
    ///   光束：外层光晕 + 中层 + 白热核心三层，宽度高频抖动；末端持续溅火花；每帧连续调用（同一发射点、同色）合并成同一条。
    ///   第一人称可读（特效打磨 A 路）：弹头刚出膛时按速度拉长（头 0.02 s 拉到 ~1.8 倍）、出膛那几帧整段弹道更亮；
    ///     离相机远的一端按距离加宽（最少约 0.45 mrad / 像素级不缩没，最多 2.6 倍）——第一人称里弹头一路飞向准星都看得见，
    ///     枪口那头（离相机 0.9 m）只在出膛那几帧加粗 1.5 倍、很快收回，不糊屏；整段弹道后半段从枪口那头往弹头方向收（追尾），读作一发子弹飞出去，而不是一根静止的线。
    /// </summary>
    public sealed class FxLines : MonoBehaviour
    {
        const int MaxTracers = 96, MaxBeams = 24;
        /// <summary>光束被提前结束后的淡出时长</summary>
        const float BeamCancelFade = 0.1f;
        /// <summary>雷曳光弹头折线的点数、重抖间隔（秒）</summary>
        const int JagPoints = 8;
        const float JagInterval = 0.025f;
        /// <summary>蚀曳光整段弹道的停留时长（秒）</summary>
        const float CorrodeLinger = 0.35f;

        sealed class TracerSlot : FxSlot
        {
            public LineRenderer trail, head, glow, back;
            public Vector3 a, dir, u, v;
            /// <summary>life = 整条的寿命；fly = 弹头飞完全程的时间；headLife = 弹头的寿命（之后只剩整段弹道在淡）</summary>
            public float dist, width, age, life, fly, headLife, lastHead, emitAcc, jitterAt, flicker = 1;
            public int born;
            public TracerKind kind;
            public Color color;
            public readonly Vector2[] jag = new Vector2[JagPoints];

            public override void CancelFx() => life = headLife = Mathf.Min(life, age + 0.03f);

            public override void RetargetFx(Vector3 from, Vector3 to)
            {
                var d = to - from;
                float len = d.magnitude;
                if (len < 0.05f) return;
                a = from;
                dir = d / len;
                dist = len;
                Basis(dir, out u, out v);
            }
        }

        /// <summary>垂直于 dir 的两根单位轴（锯齿往这两个方向抖）</summary>
        static void Basis(Vector3 dir, out Vector3 u, out Vector3 v)
        {
            u = Vector3.Cross(dir, Mathf.Abs(dir.y) > 0.95f ? Vector3.right : Vector3.up).normalized;
            v = Vector3.Cross(dir, u);
        }

        sealed class BeamSlot : FxSlot
        {
            public LineRenderer glow, mid, core;
            public Vector3 a, b;
            public Color color;
            public float width, age, duration, fadeWin, seed, sparkAcc;
            public int touchedFrame;
            public bool cancelled;

            public override void CancelFx()
            {
                if (!active || cancelled) return;
                cancelled = true;
                // 从当前亮度起线性淡出；剩余时间本来就不到淡出时长的保持原样
                float remain = Mathf.Max(0, duration - age);
                float fout = Mathf.Min(1, remain / fadeWin);
                float target = BeamCancelFade * fout;
                if (remain > target)
                {
                    duration = age + target;
                    fadeWin = BeamCancelFade;
                }
            }

            public override void RetargetFx(Vector3 from, Vector3 to)
            {
                a = from;
                b = to;
            }
        }

        readonly List<TracerSlot> tracers = new();
        readonly List<BeamSlot> beams = new();
        float time;
        /// <summary>这一帧的相机位置（远端加宽用）</summary>
        static Vector3 camPos;
        static bool hasCam;

        /// <summary>离相机越远越宽：8 m 内不变，之后按距离线性加宽，最多 2.6 倍（远处的弹头不缩成看不见的一点）</summary>
        static float Comp(Vector3 p) => hasCam ? Mathf.Clamp(Vector3.Distance(camPos, p) / 8f, 1f, 2.6f) : 1f;

        // ───────────── 曳光 ─────────────

        internal FxHandle Tracer(Vector3 from, Vector3 to, Color color, float width, TracerKind kind = TracerKind.Plain)
        {
            var d = to - from;
            float dist = d.magnitude;
            if (!(dist >= 0.05f)) return FxHandle.None;
            var t = TakeTracer();
            t.Claim();
            t.a = from;
            t.dir = d / dist;
            Basis(t.dir, out t.u, out t.v);
            t.dist = dist;
            t.color = color;
            t.kind = kind;
            t.width = Mathf.Clamp(width, 0.003f, 0.5f);
            t.age = 0;
            t.born = Time.frameCount;
            // 远距离稍长一点，保证能看见弹头飞过；元素的整段弹道留得久一点（雷要看得出闪烁、蚀是长拖尾）
            float baseLife = Mathf.Min(0.1f, 0.06f + dist * 0.0008f);
            t.fly = baseLife * 0.55f;
            t.headLife = kind == TracerKind.Shock ? baseLife * 1.6f : baseLife;
            t.life = kind switch
            {
                TracerKind.Fire => baseLife * 1.5f,
                TracerKind.Shock => baseLife * 1.8f,
                TracerKind.Corrode => Mathf.Max(CorrodeLinger, baseLife),
                _ => baseLife,
            };
            t.lastHead = 0;
            t.emitAcc = 0;
            t.jitterAt = JagInterval;
            t.flicker = 1;
            for (int i = 0; i < JagPoints; i++) t.jag[i] = Random.insideUnitCircle;
            var cam = Camera.main;
            hasCam = cam;
            if (hasCam) camPos = cam.transform.position;
            int heads = kind == TracerKind.Shock ? JagPoints : 2;
            if (t.head.positionCount != heads) t.head.positionCount = heads;
            t.trail.enabled = true;
            t.head.enabled = true;
            t.glow.enabled = t.back.enabled = kind != TracerKind.Plain;
            DrawTracer(t);
            return new FxHandle(t);
        }

        TracerSlot TakeTracer()
        {
            TracerSlot oldest = null;
            foreach (var t in tracers)
            {
                if (!t.active) return t;
                if (oldest == null || t.age / t.life > oldest.age / oldest.life) oldest = t;
            }
            if (tracers.Count < MaxTracers)
            {
                var t = new TracerSlot { back = MakeLine("Tracer Back", 2), trail = MakeLine("Tracer Trail", 2), head = MakeLine("Tracer Head", 2), glow = MakeLine("Tracer Glow", 2) };
                if (BackMaterial) t.back.sharedMaterial = BackMaterial;
                tracers.Add(t);
                return t;
            }
            return oldest;
        }

        static Color Rgba(Color c, float a) => new(c.r, c.g, c.b, a);

        static Color Hot(Color c, float k, float a) => new(Mathf.Min(1, c.r * k), Mathf.Min(1, c.g * k), Mathf.Min(1, c.b * k), a);

        static void DrawTracer(TracerSlot t)
        {
            float k = Mathf.Clamp01(t.age / t.life);
            float kh = Mathf.Clamp01(t.age / t.headLife);
            float head = t.dist * Mathf.Min(1, (t.age + 0.012f) / t.fly);
            // 速度拉伸：刚出膛的弹头更长（1.8 倍），之后收回常规长度
            float stretch = 1f + 0.8f * (1f - Mathf.Clamp01(kh * 2.2f));
            float streak = Mathf.Min(t.dist * 0.6f, (t.kind == TracerKind.Shock ? 3.5f : 5f) * stretch);
            float tail = Mathf.Max(0, head - streak);
            float w = t.width;
            float fade = kh < 0.6f ? 1 : Mathf.Max(0, 1 - (kh - 0.6f) / 0.4f);
            var c = t.color;
            var pHead = t.a + t.dir * head;
            var pTail = t.a + t.dir * tail;
            float compHead = Comp(pHead), compTail = Comp(pTail);
            // 出膛那几帧整段弹道更亮（前 35% 寿命从 1.6 倍降回 1）
            float birth = 1f + 0.6f * (1f - Mathf.Clamp01(k / 0.35f));
            // 追尾：整段弹道的起点在后半段寿命里从枪口往弹头收（蚀的长拖尾不收）
            float chase = t.kind == TracerKind.Corrode ? 0 : Mathf.Clamp01((k - 0.3f) / 0.7f);
            var pStart = t.a + t.dir * (head * 0.85f * chase * chase);
            // 起始段：出膛那几帧枪口一端加粗 1.5 倍（第一人称里读得出弹道从枪口出去），很快收回
            float compStart = Comp(pStart) * (1f + 0.5f * (1f - Mathf.Clamp01(k / 0.4f)));

            // 整条弹道：枪口那一头最亮——第一人称里这一段就是从枪口连向准星的那一截
            t.trail.SetPosition(0, pStart);
            t.trail.SetPosition(1, pHead);
            switch (t.kind)
            {
                case TracerKind.Corrode:
                {
                    // 绿色长拖尾：粗、留 0.35 s 慢慢淡掉（前 30% 不淡）
                    float linger = k < 0.3f ? 1 : 1 - (k - 0.3f) / 0.7f;
                    linger *= linger;
                    t.trail.startWidth = w * 0.7f * compStart;
                    t.trail.endWidth = w * 1.1f * compHead;
                    t.trail.startColor = Rgba(CorrodeGreen(c), 0.55f * linger * c.a);
                    t.trail.endColor = Rgba(CorrodeGreen(c), 0.7f * linger * c.a);
                    break;
                }
                case TracerKind.Fire:
                case TracerKind.Shock:
                    t.trail.startWidth = w * 0.45f * compStart;
                    t.trail.endWidth = w * 0.55f * compHead;
                    t.trail.startColor = Rgba(c, Mathf.Min(1, 0.45f * birth) * (1 - k) * t.flicker * c.a);
                    t.trail.endColor = Rgba(c, Mathf.Min(1, 0.4f * birth) * (1 - k) * t.flicker * c.a);
                    break;
                default:
                    t.trail.startWidth = w * 0.25f * compStart;
                    t.trail.endWidth = w * 0.45f * compHead;
                    t.trail.startColor = Rgba(c, 0.28f * birth * (1 - k) * c.a);
                    t.trail.endColor = Rgba(c, Mathf.Min(1, 0.45f * birth) * (1 - k) * c.a);
                    break;
            }

            // 明亮的弹头拖尾
            float hf = fade * t.flicker * c.a;
            switch (t.kind)
            {
                case TracerKind.Fire:
                    // 尾巴暗红 → 尖端橙黄（加法线在亮沙上会往黄白偏，尖端不再用金黄，靠下面的暗红垫底托住橙红）
                    t.head.SetPosition(0, pTail);
                    t.head.SetPosition(1, pHead);
                    t.head.startWidth = w * 0.45f * compTail;
                    t.head.endWidth = w * 1.15f * compHead;
                    t.head.startColor = new Color(0.85f, 0.12f, 0.03f, 0.35f * hf);
                    t.head.endColor = new Color(1f, 0.5f, 0.16f, hf);
                    break;
                case TracerKind.Shock:
                {
                    // 蓝白锯齿：折线每 0.025 s 重抖一次（两端不抖，弹头尖始终在弹道上）
                    float amp = Mathf.Max(0.06f, w * 1.6f);
                    for (int i = 0; i < JagPoints; i++)
                    {
                        float s = i / (JagPoints - 1f);
                        var p = Vector3.Lerp(pTail, pHead, s);
                        if (i > 0 && i < JagPoints - 1) p += (t.u * t.jag[i].x + t.v * t.jag[i].y) * amp;
                        t.head.SetPosition(i, p);
                    }
                    t.head.startWidth = w * 0.5f * compTail;
                    t.head.endWidth = w * 0.9f * compHead;
                    t.head.startColor = Rgba(Color.Lerp(c, Color.white, 0.1f), 0.6f * hf);
                    t.head.endColor = Rgba(Color.Lerp(c, Color.white, 0.35f), hf);
                    break;
                }
                case TracerKind.Corrode:
                    t.head.SetPosition(0, pTail);
                    t.head.SetPosition(1, pHead);
                    t.head.startWidth = w * 0.6f * compTail;
                    t.head.endWidth = w * compHead;
                    t.head.startColor = Rgba(CorrodeGreen(c), 0.3f * hf);
                    t.head.endColor = Hot(CorrodeGreen(c), 1.2f, hf);
                    break;
                default:
                    t.head.SetPosition(0, pTail);
                    t.head.SetPosition(1, pHead);
                    t.head.startWidth = w * 0.3f * compTail;
                    t.head.endWidth = w * 1.15f * compHead;
                    t.head.startColor = Rgba(c, 0);
                    t.head.endColor = Hot(c, 1.4f * Mathf.Min(1.3f, birth), fade * c.a);
                    break;
            }

            // 元素弹头外层的同色光晕（亮沙地上也看得出颜色）
            if (t.kind != TracerKind.Plain)
            {
                t.glow.SetPosition(0, pTail);
                t.glow.SetPosition(1, pHead);
                float gw = t.kind == TracerKind.Shock ? 3.4f : 3f;
                t.glow.startWidth = w * gw * 0.6f * compTail;
                t.glow.endWidth = w * gw * compHead;
                var gc = t.kind == TracerKind.Fire ? new Color(1f, 0.3f, 0.06f) : t.kind == TracerKind.Corrode ? CorrodeGreen(c) : c;
                t.glow.startColor = Rgba(gc, 0);
                t.glow.endColor = Rgba(gc, (t.kind == TracerKind.Shock ? 0.45f : 0.32f) * hf);

                // 普通混合的暗色垫底（同 SlashArc 敌方刀光的暗月牙）：纯加法的线在亮沙 / 雪地上加不出颜色，火、蚀都会偏成黄白——
                // 垫一道深红 / 深蓝 / 深绿把元素色托出来。弹头那一段跟着弹头（雷的锯齿也照描）；蚀的长拖尾整段都垫，淡得跟拖尾一样
                int n = t.head.positionCount;
                if (t.back.positionCount != n) t.back.positionCount = n;
                for (int i = 0; i < n; i++) t.back.SetPosition(i, t.head.GetPosition(i));
                // 雷的弹头偏白（加法叠上去就是白线），垫得更宽更浓，蓝色才托得出来
                float bw = t.kind == TracerKind.Shock ? 2.6f : 1.6f, ba = t.kind == TracerKind.Shock ? 0.8f : 0.6f;
                t.back.startWidth = t.head.startWidth * bw;
                t.back.endWidth = t.head.endWidth * bw;
                var bc = t.kind switch
                {
                    TracerKind.Fire => new Color(0.55f, 0.06f, 0.02f),
                    TracerKind.Shock => new Color(0.05f, 0.22f, 0.7f),
                    _ => new Color(0.08f, 0.42f, 0.06f),
                };
                t.back.startColor = Rgba(bc, ba * 0.35f * hf);
                t.back.endColor = Rgba(bc, ba * hf);
                if (t.kind == TracerKind.Corrode)
                {
                    float linger = k < 0.3f ? 1 : 1 - (k - 0.3f) / 0.7f;
                    linger *= linger;
                    if (t.back.positionCount != 2) t.back.positionCount = 2;
                    t.back.SetPosition(0, pStart);
                    t.back.SetPosition(1, pHead);
                    t.back.startWidth = w * 1.1f * compStart;
                    t.back.endWidth = w * 1.7f * compHead;
                    t.back.startColor = Rgba(bc, 0.35f * linger * c.a);
                    t.back.endColor = Rgba(bc, 0.55f * linger * c.a);
                }
            }
        }

        /// <summary>蚀曳光用的绿：元素色往纯绿偏（加法叠在亮沙上，偏黄的蚀绿看着和火的橙黄差不多）</summary>
        static Color CorrodeGreen(Color c) => new(c.r * 0.55f, c.g, c.b * 1.05f, c.a);

        static Material backMaterial;

        /// <summary>垫底线的材质：特效线同一个着色器（柔和横截面贴图），改成普通混合、排在加法线前面画（队列 +5 &lt; +6）</summary>
        static Material BackMaterial
        {
            get
            {
                if (backMaterial) return backMaterial;
                var line = FxMaterials.Line;
                if (!line) return null;
                backMaterial = new Material(line) { name = "M_Fx_LineBack (runtime)" };
                FxMaterials.SetupParticle(backMaterial, false, line.HasTexture("_BaseMap") ? line.GetTexture("_BaseMap") : null, 5, 1f, false);
                return backMaterial;
            }
        }

        /// <summary>元素曳光沿途的粒子（火星 / 电弧碎纹 / 蚀液滴）与雷曳光的重抖；弹头这一帧飞过的那一段上按距离撒</summary>
        static void TracerExtras(TracerSlot t, FxRuntime rt)
        {
            if (t.kind == TracerKind.Shock && t.age >= t.jitterAt)
            {
                t.jitterAt = t.age + JagInterval;
                for (int i = 0; i < JagPoints; i++) t.jag[i] = Random.insideUnitCircle;
                t.flicker = 0.45f + 0.55f * Random.value;
            }
            if (!rt || t.kind == TracerKind.Plain || t.color.a <= 0.01f) return;
            float head = t.dist * Mathf.Min(1, (t.age + 0.012f) / t.fly);
            float from = t.lastHead;
            t.lastHead = head;
            if (head <= from + 1e-3f) return;
            // 每隔 spacing 米撒一颗，一条曳光最多 cap 颗（冲锋枪一秒十几发也不刷屏）
            float spacing = t.kind == TracerKind.Fire ? 1.8f : t.kind == TracerKind.Shock ? 2.6f : 3f;
            int cap = t.kind == TracerKind.Fire ? 10 : 6;
            t.emitAcc += (head - from) / spacing * Fx.Density;
            string style = t.kind == TracerKind.Fire ? "Ember" : t.kind == TracerKind.Shock ? "Crackle" : "Drop";
            var e = t.emitAcc >= 1 ? rt.GetEmitter(style) : null;
            int n = 0;
            while (t.emitAcc >= 1)
            {
                t.emitAcc -= 1;
                if (e == null || n >= cap) continue;
                n++;
                var p = t.a + t.dir * Random.Range(from, head);
                switch (t.kind)
                {
                    case TracerKind.Fire:
                    {
                        var vel = (t.u * Random.Range(-1f, 1f) + t.v * Random.Range(-1f, 1f)) * 1.2f + Vector3.up * Random.Range(0.4f, 1.6f) + t.dir * Random.Range(0.5f, 2f);
                        var col = Random.value < 0.5f ? new Color(1f, 0.55f, 0.15f) : new Color(1f, 0.28f, 0.06f);
                        rt.EmitOne(e, p, vel, Random.Range(0.05f, 0.09f), Random.Range(0.25f, 0.5f), col, 0);
                        break;
                    }
                    case TracerKind.Shock:
                        rt.EmitOne(e, p, Vector3.zero, Random.Range(0.18f, 0.3f), Random.Range(0.06f, 0.11f), Color.Lerp(t.color, Color.white, 0.4f), 0);
                        break;
                    default:
                        rt.EmitOne(e, p, Vector3.down * Random.Range(0.2f, 0.8f), Random.Range(0.04f, 0.07f), Random.Range(0.35f, 0.6f), t.color, 0);
                        break;
                }
            }
        }

        // ───────────── 光束 ─────────────

        internal FxHandle Beam(Vector3 from, Vector3 to, Color color, float width, float duration)
        {
            int frame = Time.frameCount;
            // 连续每帧调用的光束（同一发射点、同色、上一两帧刚刷新过）合并为一条，只刷新端点与寿命，避免叠亮闪烁
            foreach (var bm in beams)
            {
                if (!bm.active || bm.cancelled || bm.touchedFrame == frame || bm.age <= 0) continue;
                if (frame - bm.touchedFrame > 3 || bm.color != color) continue;
                if ((bm.a - from).sqrMagnitude > 0.35f * 0.35f) continue;
                bm.a = from;
                bm.b = to;
                bm.width = width;
                bm.touchedFrame = frame;
                bm.duration = bm.age + Mathf.Max(bm.duration - bm.age, duration);
                bm.fadeWin = Mathf.Min(0.12f, Mathf.Max(0.02f, duration * 0.5f));
                return new FxHandle(bm);
            }
            var b = TakeBeam();
            b.Claim();
            b.a = from;
            b.b = to;
            b.color = color;
            b.width = width;
            b.age = 0;
            b.duration = Mathf.Max(0.03f, duration);
            b.fadeWin = Mathf.Min(0.12f, Mathf.Max(0.02f, b.duration * 0.5f));
            b.seed = Random.value * 100;
            b.sparkAcc = 0;
            b.touchedFrame = frame;
            b.cancelled = false;
            b.glow.enabled = b.mid.enabled = b.core.enabled = true;
            DrawBeam(b, 0.25f);
            return new FxHandle(b);
        }

        BeamSlot TakeBeam()
        {
            BeamSlot oldest = null, fading = null;
            foreach (var b in beams)
            {
                if (!b.active) return b;
                if (b.cancelled && fading == null) fading = b;
                if (oldest == null || b.age > oldest.age) oldest = b;
            }
            if (beams.Count < MaxBeams)
            {
                var b = new BeamSlot { glow = MakeLine("Beam Glow", 2), mid = MakeLine("Beam Mid", 2), core = MakeLine("Beam Core", 2) };
                beams.Add(b);
                return b;
            }
            return fading ?? oldest;
        }

        void DrawBeam(BeamSlot bm, float alpha)
        {
            float wob = 1 + 0.14f * Mathf.Sin(time * 70 + bm.seed) + 0.06f * Mathf.Sin(time * 131 + bm.seed * 3);
            float w = bm.width * wob;
            var c = bm.color;
            Set(bm.glow, bm.a, bm.b, w * 2.2f, w * 2.4f, new Color(c.r * 0.9f, c.g * 0.9f, c.b * 0.9f, alpha * 0.45f), alpha * 0.4f);
            Set(bm.mid, bm.a, bm.b, w, w * 1.05f, new Color(Mathf.Min(1, c.r * 1.3f), Mathf.Min(1, c.g * 1.3f), Mathf.Min(1, c.b * 1.3f), alpha * 0.8f), alpha * 0.75f);
            Set(bm.core, bm.a, bm.b, w * 0.3f, w * 0.3f, new Color(Mathf.Min(1, 0.8f + c.r * 0.4f), Mathf.Min(1, 0.8f + c.g * 0.4f), Mathf.Min(1, 0.8f + c.b * 0.4f), alpha), alpha);
        }

        static void Set(LineRenderer lr, Vector3 a, Vector3 b, float w0, float w1, Color c, float endAlpha)
        {
            lr.SetPosition(0, a);
            lr.SetPosition(1, b);
            lr.startWidth = w0;
            lr.endWidth = w1;
            lr.startColor = c;
            lr.endColor = new Color(c.r, c.g, c.b, endAlpha);
        }

        // ───────────── 推进 ─────────────

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            time += dt;
            var rt = FxRuntime.Ensure();
            int frame = Time.frameCount;
            var cam = Camera.main;
            hasCam = cam;
            if (hasCam) camPos = cam.transform.position;
            foreach (var t in tracers)
            {
                if (!t.active) continue;
                // 这一帧刚生成的不推进：它生在这一帧的 Update 里，dt 是上一帧到这一帧的间隔——卡顿帧（截图、加载）也至少画出一帧
                if (t.born != frame) t.age += dt;
                if (t.age >= t.life)
                {
                    t.active = false;
                    t.trail.enabled = t.head.enabled = t.glow.enabled = t.back.enabled = false;
                    continue;
                }
                TracerExtras(t, rt);
                DrawTracer(t);
            }
            foreach (var bm in beams)
            {
                if (!bm.active) continue;
                bm.age += dt;
                if (bm.age >= bm.duration)
                {
                    bm.active = false;
                    bm.glow.enabled = bm.mid.enabled = bm.core.enabled = false;
                    continue;
                }
                float fin = Mathf.Min(1, bm.age / 0.035f + 0.25f);
                float fout = Mathf.Min(1, (bm.duration - bm.age) / bm.fadeWin);
                DrawBeam(bm, fin * fout);
                if (bm.cancelled || !rt) continue;
                // 末端溅射火花与光团（被提前结束的光束只淡出，不再溅射）
                bm.sparkAcc += dt * 45 * Fx.Density;
                var sparks = bm.sparkAcc >= 1 ? rt.GetEmitter("StreakLight") : null;
                while (bm.sparkAcc >= 1)
                {
                    bm.sparkAcc -= 1;
                    if (sparks == null) continue;
                    var v = new Vector3(Random.Range(-5f, 5f), Random.Range(0f, 5f), Random.Range(-5f, 5f));
                    rt.EmitOne(sparks, bm.b, v, 0.04f, Random.Range(0.1f, 0.25f), bm.color, 0);
                }
                if (Random.value < dt * 30)
                {
                    var glow = rt.GetEmitter("Glow");
                    if (glow != null) rt.EmitOne(glow, bm.b, Vector3.zero, bm.width * 5 + 0.3f, 0.08f, bm.color, 0);
                    var spark = rt.GetEmitter("Spark");
                    if (spark != null) rt.EmitOne(spark, bm.a, Vector3.zero, bm.width * 2.5f + 0.15f, 0.06f, bm.color, 0);
                }
            }
        }

        LineRenderer MakeLine(string name, int points)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var lr = go.AddComponent<LineRenderer>();
            ConfigureLine(lr, points);
            lr.enabled = false;
            return lr;
        }

        /// <summary>特效线的公共设置（闪电也用）：世界坐标、面向相机、拉伸贴图、不投影、不受光</summary>
        internal static void ConfigureLine(LineRenderer lr, int points)
        {
            lr.useWorldSpace = true;
            lr.positionCount = points;
            lr.sharedMaterial = FxMaterials.Line;
            lr.alignment = LineAlignment.View;
            lr.textureMode = LineTextureMode.Stretch;
            lr.numCapVertices = 2;
            lr.numCornerVertices = 0;
            lr.shadowCastingMode = ShadowCastingMode.Off;
            lr.receiveShadows = false;
            lr.lightProbeUsage = LightProbeUsage.Off;
            lr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            lr.generateLightingData = false;
        }

        /// <summary>全部收起（换关清场）</summary>
        internal void Clear()
        {
            foreach (var t in tracers)
            {
                t.active = false;
                t.trail.enabled = t.head.enabled = t.glow.enabled = t.back.enabled = false;
            }
            foreach (var b in beams)
            {
                b.active = false;
                b.glow.enabled = b.mid.enabled = b.core.enabled = false;
            }
        }

        /// <summary>预热：在相机前画一帧全透明的曳光，让线材质的绘制状态提前编好</summary>
        internal void WarmUp(Vector3 at) => Tracer(at, at + Vector3.right * 0.5f, new Color(1, 1, 1, 0), 0.01f);
    }
}
