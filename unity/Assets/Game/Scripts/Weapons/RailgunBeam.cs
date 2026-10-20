using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 满蓄一击的「贯虹」（<see cref="Ballistics.Hitscan"/> 在 ShotContext.full 时调 <see cref="Spawn"/>）：
    ///   主光束：同 TS Firing.trace 的 fx.beam(枪口, 落点, 元素色 / 物理虹紫, tracerWidth × 0.7, 0.16 s)，走 <see cref="Fx.Beam"/>；
    ///   虹光（Unity 新增）：三股彩虹丝沿弹道缠绕（每股色相沿长度走一整圈彩虹、三股错开 1/3），两端收拢到枪口和落点，
    ///   0.38 s 内一边旋转一边散开、变细、淡出。
    /// 对象池：每条虹光一个物体（3 个 LineRenderer），用完回池；换场景被销毁的池对象取出时跳过。
    /// </summary>
    public sealed class RailgunBeam : MonoBehaviour
    {
        public const int Strands = 3, Points = 32;
        /// <summary>寿命（秒）、初始缠绕半径（米）、整段缠绕圈数、旋转速度（弧度 / 秒）</summary>
        public const float Life = 0.38f, Radius = 0.05f, Turns = 2.5f, SpinSpeed = 9f;

        static readonly Stack<RailgunBeam> pool = new();

        LineRenderer[] lines;
        Gradient[] gradients;
        GradientColorKey[][] colorKeys;
        readonly GradientAlphaKey[] alphaKeys = new GradientAlphaKey[2];
        readonly Vector3[] points = new Vector3[Points];
        Vector3 from, to;
        float age, width;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => pool.Clear();

        /// <summary>满蓄弹道：主光束 + 虹光。width = 武器曳光宽度（TS tracerWidth）</summary>
        public static void Spawn(Vector3 from, Vector3 to, Element element, float width)
        {
            if (!Fx.Finite(from) || !Fx.Finite(to) || (to - from).sqrMagnitude < 0.04f) return;
            width = Mathf.Clamp(width, 0.02f, 0.3f);
            Fx.Beam(from, to, RailgunCharge.EnergyColor(element), width * 0.7f, 0.16f);
            var b = Acquire();
            if (b) b.Play(from, to, width);
        }

        /// <summary>彩虹色（u 任意，按 1 取模）：色相 u、饱和 0.8、明度 1。顶点色是 8 位的，不能给 HDR（会被截成发白的淡色），亮度交给 Line 材质</summary>
        public static Color Rainbow(float u) => Color.HSVToRGB(Mathf.Repeat(u, 1f), 0.8f, 1f);

        /// <summary>两端收拢：t = 0（枪口）和 1（落点）处为 0，离两端 1/8 段长之外为 1</summary>
        public static float Taper(float t) => Mathf.Clamp01(t * 8f) * Mathf.Clamp01((1 - t) * 8f);

        static RailgunBeam Acquire()
        {
            while (pool.Count > 0)
            {
                var b = pool.Pop();
                if (!b) continue;
                b.gameObject.SetActive(true);
                return b;
            }
            var go = new GameObject("RailgunBeam");
            var beam = go.AddComponent<RailgunBeam>();
            beam.Init();
            return beam;
        }

        void Init()
        {
            lines = new LineRenderer[Strands];
            gradients = new Gradient[Strands];
            colorKeys = new GradientColorKey[Strands][];
            for (int s = 0; s < Strands; s++)
            {
                var child = new GameObject($"Strand{s}");
                child.transform.SetParent(transform, false);
                var line = child.AddComponent<LineRenderer>();
                line.useWorldSpace = true;
                line.positionCount = Points;
                line.sharedMaterial = FxMaterials.Line;
                line.shadowCastingMode = ShadowCastingMode.Off;
                line.receiveShadows = false;
                line.numCapVertices = 2;
                line.textureMode = LineTextureMode.Stretch;
                line.alignment = LineAlignment.View;
                lines[s] = line;
                // 7 个色键：色相沿弹道走一整圈，股与股错开 1/3
                var keys = new GradientColorKey[7];
                for (int k = 0; k < keys.Length; k++)
                {
                    float t = k / (keys.Length - 1f);
                    keys[k] = new GradientColorKey(Rainbow(t + s / (float)Strands), t);
                }
                colorKeys[s] = keys;
                gradients[s] = new Gradient { mode = GradientMode.Blend };
            }
        }

        void Play(Vector3 a, Vector3 b, float w)
        {
            from = a;
            to = b;
            width = w;
            age = 0;
            Draw();
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= Life)
            {
                gameObject.SetActive(false);
                pool.Push(this);
                return;
            }
            Draw();
        }

        void Draw()
        {
            float k = Mathf.Clamp01(age / Life);
            float fade = 1 - Smooth(k);
            var d = to - from;
            var dir = d.normalized;
            var side = Vector3.Cross(dir, Vector3.up);
            if (side.sqrMagnitude < 1e-6f) side = Vector3.Cross(dir, Vector3.right);
            side.Normalize();
            var up = Vector3.Cross(side, dir);
            float radius = Radius * (1 + 1.5f * k);
            alphaKeys[0] = new GradientAlphaKey(fade, 0);
            alphaKeys[1] = new GradientAlphaKey(fade * 0.7f, 1);
            for (int s = 0; s < Strands; s++)
            {
                float phase = s * (Mathf.PI * 2 / Strands) + age * SpinSpeed;
                for (int i = 0; i < Points; i++)
                {
                    float t = i / (Points - 1f);
                    float a = phase + t * Turns * Mathf.PI * 2;
                    points[i] = from + d * t + (side * Mathf.Cos(a) + up * Mathf.Sin(a)) * (radius * Taper(t));
                }
                var line = lines[s];
                line.SetPositions(points);
                line.widthMultiplier = width * 0.55f * (1 - 0.6f * k);
                var g = gradients[s];
                g.SetKeys(colorKeys[s], alphaKeys);
                line.colorGradient = g;
            }
        }

        static float Smooth(float x) => x * x * (3 - 2 * x);
    }
}
