using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔铜流（FX4；Three.js InfernoSupportFx.MoltenStream / InfernoTankFx.moltenArc）：沿抛物线（两端连线再抬 4·apex·u·(1−u)，同 TS pourArc）
    /// 甩出去的一股稠液——两条叠着的液流带（LineRenderer，头最粗最亮、尾巴变细转深红）：底下一条普通透明的实心芯（亮天空下加法色会被洗成粉白，
    /// 熔铜得是不透明的橙），上面一条更宽的加法 HDR 光晕吃 Bloom；沿途往下滴熔滴、冒火星，液流头落地 / 落到目标时溅开。
    ///   <see cref="Pour"/>：熔铜匠浇铜——液流头 flight 秒内从流嘴推到同伴头顶，停 hold 秒，尾巴再追过去；起点 / 终点每帧取（跟着流嘴和同伴走）。
    ///   <see cref="Arc"/>：一团熔铁沿抛物线飞过去（熔炉铁牛的熔铁喷吐），只拖一小截尾巴，落地溅开。
    /// 纯视觉（伤害由调用方结算）。对象池复用，挂在常驻的特效根下，换关清场；句柄可提前收掉（0.15 s 淡出）。
    /// </summary>
    public sealed class MoltenStream : MonoBehaviour
    {
        const int Points = 18;

        static readonly List<MoltenStream> live = new();
        static readonly Stack<MoltenStream> pool = new();
        static readonly Vector3[] pts = new Vector3[Points];

        LineRenderer line, core;
        Func<Vector3> from, to;
        Vector3 fromFixed, toFixed;
        float age, flight, hold, apex, width, kill = -1, dripAcc;
        bool arc, splashed;
        Color hot, mid, cold;
        Action landed;
        internal int gen;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            pool.Clear();
        }

        /// <summary>场上的液流数（测试用）</summary>
        public static int ActiveCount
        {
            get
            {
                live.RemoveAll(s => !s);
                return live.Count;
            }
        }

        /// <summary>
        /// 浇铜：from / to 每帧取（流嘴、同伴头顶）；flight = 液流头飞到的时间，hold = 停留，size = 粗细倍率；landed = 液流头到了（浇上铜甲的时刻）
        /// </summary>
        public static MoltenStream Pour(Func<Vector3> from, Func<Vector3> to, float flight, float hold = 0.35f, float size = 1f, Action landed = null)
        {
            if (from == null || to == null || !Application.isPlaying) return null;
            var s = Take();
            if (!s) return null;
            s.from = from;
            s.to = to;
            s.arc = false;
            s.flight = Mathf.Max(0.05f, flight);
            s.hold = Mathf.Max(0, hold);
            s.width = 0.2f * Mathf.Max(0.3f, size);
            s.landed = landed;
            s.SetColors(Hex.Rgb(0xffb040), InfernoPalette.Molten, Hex.Rgb(0x9a2a0a));
            s.Begin();
            return s;
        }

        /// <summary>一团熔铁沿抛物线 from → to 飞 duration 秒（arcHeight = 抬高），落地溅开</summary>
        public static MoltenStream Arc(Vector3 from, Vector3 to, float duration, float size = 1f, float arcHeight = 2f, Action landed = null)
        {
            if (!Fx.Finite(from) || !Fx.Finite(to) || !Application.isPlaying) return null;
            var s = Take();
            if (!s) return null;
            s.fromFixed = from;
            s.toFixed = to;
            s.from = null;
            s.to = null;
            s.arc = true;
            s.flight = Mathf.Max(0.05f, duration);
            s.hold = 0;
            s.apex = arcHeight;
            s.width = 0.32f * Mathf.Max(0.3f, size);
            s.landed = landed;
            s.SetColors(Hex.Rgb(0xffa030), Hex.Rgb(0xff6a1a), Hex.Rgb(0x8a1e08));
            s.Begin();
            return s;
        }

        /// <summary>提前收掉（0.15 s 淡出，不溅）</summary>
        public void Cancel()
        {
            if (kill < 0) kill = age;
            splashed = true;
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            foreach (var s in live)
                if (s)
                {
                    s.gameObject.SetActive(false);
                    pool.Push(s);
                }
            live.Clear();
        }

        static MoltenStream Take()
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            MoltenStream s = null;
            while (pool.Count > 0 && !s) s = pool.Pop();
            if (!s)
            {
                var go = new GameObject("Molten Stream");
                go.transform.SetParent(rt.transform, false);
                s = go.AddComponent<MoltenStream>();
                s.line = go.AddComponent<LineRenderer>();
                s.line.useWorldSpace = true;
                s.line.sharedMaterial = FxMaterials.Line;
                s.line.positionCount = Points;
                s.line.numCapVertices = 3;
                s.line.numCornerVertices = 2;
                s.line.textureMode = LineTextureMode.Stretch;
                s.line.alignment = LineAlignment.View;
                s.line.shadowCastingMode = ShadowCastingMode.Off;
                s.line.receiveShadows = false;
                var c = new GameObject("Core");
                c.transform.SetParent(go.transform, false);
                s.core = c.AddComponent<LineRenderer>();
                s.core.useWorldSpace = true;
                s.core.sharedMaterial = FxMaterials.AlphaBlend;
                s.core.positionCount = Points;
                s.core.numCapVertices = 3;
                s.core.numCornerVertices = 2;
                s.core.alignment = LineAlignment.View;
                s.core.shadowCastingMode = ShadowCastingMode.Off;
                s.core.receiveShadows = false;
            }
            s.gameObject.SetActive(true);
            s.gen++;
            live.Add(s);
            return s;
        }

        void SetColors(Color h, Color m, Color c)
        {
            hot = h;
            mid = m;
            cold = c;
        }

        void Begin()
        {
            age = 0;
            kill = -1;
            dripAcc = 0;
            splashed = false;
            line.enabled = false;
            core.enabled = false;
            Step(0);
        }

        Vector3 From => from != null ? from() : fromFixed;
        Vector3 To => to != null ? to() : toFixed;

        Vector3 At(Vector3 a, Vector3 b, float u) => Vector3.Lerp(a, b, u) + Vector3.up * (4 * apex * u * (1 - u));

        void Step(float dt)
        {
            age += dt;
            var a = From;
            var b = To;
            if (!arc) apex = 1 + Vector3.Distance(a, b) * 0.12f;
            float head = Mathf.Clamp01(age / flight);
            float tail = arc ? Mathf.Max(0, head - 0.22f) : Mathf.Clamp01((age - flight - hold) / (flight * 0.7f));
            float fade = kill >= 0 ? Mathf.Clamp01(1 - (age - kill) / 0.15f) : 1;
            if (head >= 1 && !splashed)
            {
                splashed = true;
                Fx.MoltenSplash(b, arc ? width * 4f : 0.8f);
                try
                {
                    landed?.Invoke();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            bool done = (arc ? head >= 1 && age > flight + 0.05f : tail >= 1) || (kill >= 0 && age - kill > 0.15f);
            if (done)
            {
                gameObject.SetActive(false);
                live.Remove(this);
                pool.Push(this);
                return;
            }
            if (head - tail < 0.005f)
            {
                line.enabled = false;
                core.enabled = false;
                return;
            }
            line.enabled = true;
            core.enabled = true;
            for (int i = 0; i < Points; i++) pts[i] = At(a, b, Mathf.Lerp(tail, head, i / (Points - 1f)));
            line.SetPositions(pts);
            core.SetPositions(pts);
            // 尾细头粗；液流头前后抖一点（稠液甩出去的一股一股）
            float wob = 1 + 0.12f * Mathf.Sin(age * 31f);
            line.widthCurve = new AnimationCurve(new Keyframe(0, width * 0.25f), new Keyframe(0.7f, width * 0.8f), new Keyframe(1, width * 1.25f * wob));
            var g = new Gradient();
            g.SetKeys(
                new[] { new GradientColorKey(cold, 0), new GradientColorKey(mid, 0.55f), new GradientColorKey(hot, 1) },
                new[] { new GradientAlphaKey(0.55f * fade, 0), new GradientAlphaKey(fade, 0.5f), new GradientAlphaKey(fade, 1) });
            line.colorGradient = g;
            // 实心芯：比光晕细一半，颜色压回 LDR（熔铜本身的橙，尾巴暗红），不透明度跟着淡出
            core.widthCurve = new AnimationCurve(new Keyframe(0, width * 0.14f), new Keyframe(0.7f, width * 0.45f), new Keyframe(1, width * 0.7f * wob));
            var gc = new Gradient();
            gc.SetKeys(
                new[] { new GradientColorKey(cold * 0.8f, 0), new GradientColorKey(Clamp01(mid), 0.55f), new GradientColorKey(Clamp01(Color.Lerp(mid, hot, 0.6f)), 1) },
                new[] { new GradientAlphaKey(0.7f * fade, 0), new GradientAlphaKey(fade, 0.4f), new GradientAlphaKey(fade, 1) });
            core.colorGradient = gc;
            // 沿途往下滴熔滴、液流头冒火星；液流头一团亮橙的光晕
            var rt = FxRuntime.Ensure();
            if (!rt || dt <= 0 || kill >= 0) return;
            var glow = rt.GetEmitter("Glow");
            if (glow != null && head < 1) rt.EmitOne(glow, At(a, b, head), Vector3.zero, width * 4f, 0.06f, mid, 0);
            dripAcc += dt * (arc ? 30f : 22f) * Fx.Density;
            var drop = dripAcc >= 1 ? rt.GetEmitter("Molten") : null;
            var spark = dripAcc >= 1 ? rt.GetEmitter("Ember") : null;
            while (dripAcc >= 1)
            {
                dripAcc -= 1;
                float u = arc ? head : Mathf.Lerp(tail, head, Random.value);
                var p = At(a, b, u) + Random.insideUnitSphere * width * 0.5f;
                if (drop != null && Random.value < 0.65f)
                    rt.EmitOne(drop, p, new Vector3(Random.Range(-0.4f, 0.4f), Random.Range(-0.5f, 0.6f), Random.Range(-0.4f, 0.4f)),
                        width * Random.Range(0.4f, 0.75f), Random.Range(0.35f, 0.6f), Color.Lerp(mid, hot, Random.value), 0);
                else if (spark != null)
                    rt.EmitOne(spark, p, new Vector3(Random.Range(-0.5f, 0.5f), Random.Range(0.6f, 1.6f), Random.Range(-0.5f, 0.5f)),
                        Random.Range(0.04f, 0.08f), Random.Range(0.4f, 0.8f), Color.Lerp(InfernoPalette.Ember, Color.white, Random.value * 0.3f), 0);
            }
        }

        static Color Clamp01(Color c) => new(Mathf.Clamp01(c.r), Mathf.Clamp01(c.g), Mathf.Clamp01(c.b), 1);

        void LateUpdate() => Step(Time.deltaTime);
    }
}
