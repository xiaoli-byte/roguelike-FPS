using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 线状特效（Three.js src/fx/Trails.ts）：弹道曳光、持续光束。全部池化的 LineRenderer（材质 M_Fx_Line：柔和横截面、HDR 偏亮），
    /// 每帧只改端点、宽度和顶点色，运行时零分配。闪电在 <see cref="Lightning"/>。
    ///   曳光：一条淡淡的整段弹道 + 明亮的弹头拖尾，弹头在前 55% 寿命内飞完全程，远距离寿命稍长（保证看得见飞过）。
    ///   光束：外层光晕 + 中层 + 白热核心三层，宽度高频抖动；末端持续溅火花；每帧连续调用（同一发射点、同色）合并成同一条。
    /// </summary>
    public sealed class FxLines : MonoBehaviour
    {
        const int MaxTracers = 96, MaxBeams = 24;
        /// <summary>光束被提前结束后的淡出时长</summary>
        const float BeamCancelFade = 0.1f;

        sealed class TracerSlot : FxSlot
        {
            public LineRenderer trail, head;
            public Vector3 a, dir;
            public float dist, width, age, life;
            public Color color;

            public override void CancelFx() => life = Mathf.Min(life, age + 0.03f);

            public override void RetargetFx(Vector3 from, Vector3 to)
            {
                var d = to - from;
                float len = d.magnitude;
                if (len < 0.05f) return;
                a = from;
                dir = d / len;
                dist = len;
            }
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

        // ───────────── 曳光 ─────────────

        internal FxHandle Tracer(Vector3 from, Vector3 to, Color color, float width)
        {
            var d = to - from;
            float dist = d.magnitude;
            if (!(dist >= 0.05f)) return FxHandle.None;
            var t = TakeTracer();
            t.Claim();
            t.a = from;
            t.dir = d / dist;
            t.dist = dist;
            t.color = color;
            t.width = Mathf.Clamp(width, 0.003f, 0.5f);
            t.age = 0;
            // 远距离稍长一点，保证能看见弹头飞过
            t.life = Mathf.Min(0.1f, 0.06f + dist * 0.0008f);
            t.trail.enabled = true;
            t.head.enabled = true;
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
                var t = new TracerSlot { trail = MakeLine("Tracer Trail", 2), head = MakeLine("Tracer Head", 2) };
                tracers.Add(t);
                return t;
            }
            return oldest;
        }

        static void DrawTracer(TracerSlot t)
        {
            float k = Mathf.Clamp01(t.age / t.life);
            float head = t.dist * Mathf.Min(1, (t.age + 0.012f) / (t.life * 0.55f));
            float streak = Mathf.Min(t.dist * 0.5f, 5f);
            float tail = Mathf.Max(0, head - streak);
            float w = t.width;
            float fade = k < 0.6f ? 1 : 1 - (k - 0.6f) / 0.4f;
            var c = t.color;
            var pHead = t.a + t.dir * head;
            // 整条淡淡的弹道
            t.trail.SetPosition(0, t.a);
            t.trail.SetPosition(1, pHead);
            t.trail.startWidth = w * 0.15f;
            t.trail.endWidth = w * 0.45f;
            t.trail.startColor = new Color(c.r, c.g, c.b, 0.05f * (1 - k) * c.a);
            t.trail.endColor = new Color(c.r, c.g, c.b, 0.28f * (1 - k) * c.a);
            // 明亮的弹头拖尾
            t.head.SetPosition(0, t.a + t.dir * tail);
            t.head.SetPosition(1, pHead);
            t.head.startWidth = w * 0.3f;
            t.head.endWidth = w;
            t.head.startColor = new Color(c.r, c.g, c.b, 0);
            t.head.endColor = new Color(Mathf.Min(1, c.r * 1.4f), Mathf.Min(1, c.g * 1.4f), Mathf.Min(1, c.b * 1.4f), fade * c.a);
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
            foreach (var t in tracers)
            {
                if (!t.active) continue;
                t.age += dt;
                if (t.age >= t.life)
                {
                    t.active = false;
                    t.trail.enabled = t.head.enabled = false;
                    continue;
                }
                DrawTracer(t);
            }
            var rt = FxRuntime.Ensure();
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
                t.trail.enabled = t.head.enabled = false;
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
