using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出场方式的声光预告（S1，ch3-v2 4.1 第 7 条：每种出场 ≥ 0.8 s 的预告；熔岩地面上的预警用品红）：
    ///   余烬起身 <see cref="EmberPile"/>：一堆冒烟的炭（同 <see cref="TantongEmberAI"/> 的炭块），炭缝光越闪越快 + 噼啪声，到点爆一团火星站起来；
    ///   熔岩爬出 <see cref="LavaBubble"/>：熔岩面鼓泡（往上冒熔岩团）+ 品红危险圈；
    ///   飞临 <see cref="FlyCry"/>：入场点一声叫 + 一团火星（之后飞行轨迹拖尾焰，见 <see cref="SpawnEntrance"/>）；
    ///   增援门 <see cref="GateGlow"/>：门缝发光（门底一排火星往上冒）+ 开门声；
    ///   埋伏苏醒 <see cref="Wake"/>：头顶「！」+ 一声吼；跃下落地 <see cref="Land"/>：落地一震（灰圈 + 声）。
    /// 全是一次性的表现件（没有碰撞、不挡人），到点自己收掉。
    /// </summary>
    public static class SpawnCues
    {
        /// <summary>余烬起身的预告时长（ch3-v2 4.2：1.0 s 闪光 + 噼啪声）</summary>
        public const float EmberTime = 1.0f;
        /// <summary>熔岩爬出的预告时长（0.8 s 鼓泡 + 品红圈）</summary>
        public const float LavaTime = 0.8f;
        /// <summary>增援门的预告时长（门缝发光 + 开门声 ≥ 1 s）</summary>
        public const float GateTime = 1.1f;
        /// <summary>飞临：入场点叫一声后多久开飞</summary>
        public const float FlyTime = 0.8f;

        static readonly Color Bubble = Hex.Rgb(0xff8a2a), GateLight = Hex.Rgb(0xffc060), Alert = Hex.Rgb(0xffd24a);

        /// <summary>余烬炭堆：返回炭堆物体（duration 秒后自己爆开收掉）</summary>
        public static GameObject EmberPile(Vector3 ground, float duration = EmberTime, float scale = 1.3f)
        {
            var go = new GameObject("Spawn Cue · 余烬");
            go.transform.position = ground;
            go.transform.rotation = Quaternion.Euler(0, UnityEngine.Random.value * 360f, 0);
            go.transform.localScale = Vector3.one * scale;
            go.AddComponent<EmberPileCue>().Begin(duration);
            GameAudio.PlayAt("burn_tick", ground, 0.5f, 0.7f);
            return go;
        }

        /// <summary>熔岩面鼓泡 + 品红危险圈（at = 熔岩里的冒出点）</summary>
        public static void LavaBubble(Vector3 at, float radius, float duration = LavaTime)
        {
            float y = LavaField.TrySurfaceHeight(at, out float s) ? s : at.y;
            var p = new Vector3(at.x, y + 0.05f, at.z);
            Telegraph.Circle(p, Mathf.Max(1.1f, radius), duration, InfernoKit.WarnTank, TelegraphTone.Danger);
            GameAudio.PlayAt("burn_tick", p, 0.7f, 0.55f);
            TimedCue.Run("Spawn Cue · 熔岩鼓泡", p, duration, 0.08f, (k, pos) =>
            {
                var r = UnityEngine.Random.insideUnitCircle * radius * 0.7f;
                var q = pos + new Vector3(r.x, 0, r.y);
                Fx.Burst(q, Bubble, 2 + (int)(k * 4), 2f + 3f * k, 0.45f, 0.12f + 0.08f * k, 7f);
                if (UnityEngine.Random.value < 0.25f) Fx.Burst(q, InfernoKit.Smoke, 1, 0.4f, 1f, 0.3f, -1f);
            });
        }

        /// <summary>飞临的入场点：一声叫 + 一团火星</summary>
        public static void FlyCry(Vector3 at)
        {
            GameAudio.PlayAt("enemy_alert", at, 0.9f, 1.25f);
            Fx.Burst(at, InfernoKit.Spark, 14, 4f, 0.6f, 0.1f, 0);
        }

        /// <summary>增援门：门底一排火星往上冒 + 开门声；width = 门宽（米），face = 门朝场地的方向</summary>
        public static void GateGlow(Vector3 gate, float width, Vector3 face, float duration = GateTime)
        {
            face.y = 0;
            var side = face.sqrMagnitude > 1e-4f ? Vector3.Cross(Vector3.up, face.normalized) : Vector3.right;
            GameAudio.PlayAt("hit_armor", gate, 0.9f, 0.5f);
            GameAudio.PlayAt("enemy_charge", gate, 0.6f, 0.7f);
            Telegraph.Circle(gate + Vector3.up * 0.05f, Mathf.Max(1.5f, width * 0.45f), duration, GateLight, TelegraphTone.Own);
            TimedCue.Run("Spawn Cue · 增援门", gate, duration, 0.06f, (k, pos) =>
            {
                var q = pos + side * ((UnityEngine.Random.value - 0.5f) * width) + Vector3.up * 0.1f;
                Fx.Burst(q, GateLight, 2, 1.5f + 2f * k, 0.5f, 0.07f, -3f);
            });
        }

        /// <summary>埋伏苏醒：头顶「！」+ 一声吼（精英换首领吼）</summary>
        public static void Wake(EnemyAI ai)
        {
            if (!ai) return;
            var top = ai.transform.position + Vector3.up * HeadHeight(ai);
            GameUI.FloatText(top + Vector3.up * 0.4f, "！", Alert, 1.4f);
            GameAudio.PlayAt(ai.elite ? "boss_roar" : "enemy_alert", top, ai.elite ? 0.5f : 0.8f, ai.elite ? 1.3f : 1f);
            Fx.Burst(top, Alert, 8, 2.5f, 0.4f, 0.08f, 0);
        }

        /// <summary>跃下落地一震：灰圈 + 落地声 + 碎石</summary>
        public static void Land(Vector3 at, float radius)
        {
            Fx.Ring(at + Vector3.up * 0.05f, Mathf.Max(1.2f, radius), InfernoKit.Ash, 0.45f);
            Fx.Burst(at + Vector3.up * 0.2f, InfernoKit.Ash, 10, 3f, 0.5f, 0.12f, 6f);
            GameAudio.PlayAt("land", at, 1f, 0.7f);
            GameAudio.PlayAt("boss_slam", at, 0.35f, 1.5f);
        }

        /// <summary>余烬站起：火星 + 火圈 + 火声（同炭堆复燃）</summary>
        public static void EmberRise(Vector3 at)
        {
            Fx.Burst(at + Vector3.up * 0.3f, InfernoKit.Spark, 24, 4, 0.5f, 0.08f, 1);
            Fx.Ring(at + Vector3.up * 0.05f, 1.4f, InfernoKit.Ember, 0.35f);
            for (int i = 0; i < 5; i++)
                Fx.Burst(at + Vector3.up * (0.15f + 0.15f * i), InfernoKit.Coal, 2, 1.5f, 0.35f, 0.1f, -1);
            GameAudio.PlayAt("skill_fire", at, 0.6f, 1.3f);
        }

        /// <summary>熔岩爬出：熔岩溅起</summary>
        public static void LavaSplash(Vector3 at)
        {
            Fx.Burst(at + Vector3.up * 0.2f, InfernoKit.LavaColor, 18, 5f, 0.6f, 0.12f, 9f);
            Fx.Burst(at + Vector3.up * 0.2f, InfernoKit.Hot, 8, 3f, 0.4f, 0.08f, 6f);
            GameAudio.PlayAt("skill_fire", at, 0.5f, 0.8f);
        }

        static float HeadHeight(EnemyAI ai)
        {
            var c = ai.GetComponent<Collider>();
            return c ? Mathf.Max(1f, c.bounds.max.y - ai.transform.position.y) : 1.8f;
        }

        // ───────────── 内部 ─────────────

        /// <summary>定时的一次性表现：每 interval 秒调一次 tick(进度 0–1, 位置)，到点收掉</summary>
        sealed class TimedCue : MonoBehaviour
        {
            float t0, duration, interval, acc;
            Action<float, Vector3> tick;

            public static void Run(string name, Vector3 at, float duration, float interval, Action<float, Vector3> tick)
            {
                var go = new GameObject(name);
                go.transform.position = at;
                var c = go.AddComponent<TimedCue>();
                c.t0 = Time.time;
                c.duration = Mathf.Max(0.05f, duration);
                c.interval = Mathf.Max(0.02f, interval);
                c.tick = tick;
            }

            void Update()
            {
                float k = (Time.time - t0) / duration;
                if (k >= 1f)
                {
                    Destroy(gameObject);
                    return;
                }
                acc += Time.deltaTime;
                while (acc >= interval)
                {
                    acc -= interval;
                    try
                    {
                        tick?.Invoke(k, transform.position);
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                        Destroy(gameObject);
                        return;
                    }
                }
            }
        }
    }

    /// <summary>余烬起身的炭堆表现（不是敌人）：5 块炭 + 炭缝光（1.5 → 9 Hz 越闪越快）+ 顶上火苗越蹿越高 + 冒烟；到点爆开、自毁</summary>
    public sealed class EmberPileCue : MonoBehaviour
    {
        static readonly Vector3[] ChunkAt =
        {
            new(0, 0.07f, 0), new(0.1f, 0.05f, 0.04f), new(-0.09f, 0.05f, -0.03f), new(0.02f, 0.05f, -0.11f), new(0, 0.15f, 0.02f),
        };
        static readonly float[] ChunkR = { 0.1f, 0.07f, 0.08f, 0.065f, 0.055f };

        readonly List<Renderer> glows = new();
        readonly List<Transform> chunks = new();
        FlameTongue tongue;
        float t0, duration = SpawnCues.EmberTime, flicker, smokeAcc;

        /// <summary>剩余秒数（测试用）</summary>
        public float Remaining => Mathf.Max(0, duration - (Time.time - t0));

        public void Begin(float seconds)
        {
            duration = Mathf.Max(0.2f, seconds);
            t0 = Time.time;
            var root = new GameObject("Pile").transform;
            root.SetParent(transform, false);
            for (int i = 0; i < ChunkAt.Length; i++)
            {
                var g = new GameObject("Chunk" + i).transform;
                g.SetParent(root, false);
                g.localPosition = ChunkAt[i] * 2.2f;
                g.localRotation = Quaternion.Euler(i * 74f, i * 120f, i * 40f);
                InfernoKit.Primitive(PrimitiveType.Cube, "Coal", g, Vector3.zero, Vector3.one * ChunkR[i] * 3.4f, InfernoKit.Coal);
                glows.Add(InfernoKit.Primitive(PrimitiveType.Sphere, "Glow", g, Vector3.zero, Vector3.one * ChunkR[i] * 4.4f, InfernoKit.Crack * 0.4f, true));
                chunks.Add(g);
            }
            tongue = FlameTongue.Attach(root, new Vector3(0, 0.25f, 0), Vector3.one * 0.01f, Hex.Rgb(0xfff0c0), Hex.Rgb(0xff9a30), Hex.Rgb(0xd8401a));
        }

        void LateUpdate()
        {
            float u = Mathf.Clamp01((Time.time - t0) / duration);
            float freq = 1.5f + 7.5f * Mathf.Pow(u, 1.2f);
            flicker += Time.deltaTime * freq * Mathf.PI * 2;
            float pulse = 0.5f + 0.5f * Mathf.Sin(flicker);
            float heat = Mathf.Clamp01(0.35f + 0.65f * pulse * (0.4f + 0.6f * u));
            var c = Color.Lerp(InfernoKit.Crack, InfernoKit.CrackHot, heat * heat) * (0.4f + 0.8f * heat);
            foreach (var g in glows)
                if (g)
                    FxMaterials.Tint(g, c);
            if (tongue)
            {
                float s = 0.1f + 0.45f * u * u + 0.06f * pulse;
                tongue.Set(0.5f + 0.5f * heat, new Vector3(s * 0.9f, s, s) * Mathf.Abs(transform.lossyScale.x));
            }
            float shake = u > 0.5f ? (u - 0.5f) * 0.08f * Mathf.Sin(Time.time * 50) : 0;
            for (int i = 0; i < chunks.Count; i++)
                if (chunks[i])
                    chunks[i].localPosition = ChunkAt[i] * 2.2f + Vector3.up * Mathf.Abs(shake) * (i % 2 == 1 ? 1 : 0.5f);
            smokeAcc += Time.deltaTime * (2f + 6f * u);
            if (smokeAcc > 0.25f)
            {
                smokeAcc = 0;
                var p = transform.position + new Vector3(UnityEngine.Random.value - 0.5f, 0, UnityEngine.Random.value - 0.5f) * 0.4f + Vector3.up * 0.3f;
                Fx.Burst(p, InfernoKit.Smoke, 1, 0.4f, 1.2f, 0.3f, -0.9f);
                Fx.Burst(p, InfernoKit.Spark, 2 + (int)(4 * u), 1.4f, 0.4f, 0.05f, -2.5f);
            }
            if (u >= 1f) Destroy(gameObject);
        }
    }
}
