using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英词缀的通用特效入口（Q 路，2026-10-31；设计单 docs/art/vfx/elite-affixes.md）。各章精英自己的攻击归各章，这里只管词缀这一层：
    ///   · <see cref="EliteFuse"/>：爆裂死亡的「蓄 → 爆」——死亡那一刻身上一闪（起手），脚下火药星纹样一边收缩一边越转越快、火星从预警圈边往圆心吸（蓄），
    ///     最后 0.12 s 白热闪烁（蓄力顶点），预警圈填满的同一帧由玩法回调 <see cref="EliteFuseFx.Detonate"/> 炸开：星芒向外甩成一圈尖刺（释放帧）；
    ///   · <see cref="EliteFrenzy"/>：狂暴触发（释放帧在前：锯齿血焰冲击环 + 往上窜的血焰 + 尖刺）；
    ///   · <see cref="EliteShieldBreak"/> / <see cref="EliteShieldRestore"/>：坚盾破盾（六角甲片崩飞）/ 回满（六角格一闪合拢）；
    ///   · <see cref="EliteWindStreak"/>：迅捷跑动的风线（流线），取代原来的光点残影。
    /// 粒子都过 FxBudget（数量先乘画质密度），低画质只少不丢主形。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>爆裂死亡的蓄力演出：ground = 预警圈圆心（地面），radius = 爆炸半径，fuse = 引信秒数。返回的演出在玩法炸开时调 Detonate</summary>
        public static EliteFuseFx EliteFuse(Vector3 ground, float radius, float fuse, Color color, Vector3 body)
        {
            if (!Finite(ground) || !Application.isPlaying) return null;
            // 起手：身上一闪（死了还有一口气），一团往外冒的火药烟
            var rt = FxRuntime.Ensure();
            if (rt)
            {
                var burst = rt.GetEmitter("ToonBurst");
                if (burst != null && FxBudget.Allow(1, true) > 0) rt.EmitOne(burst, body, Vector3.zero, 1.4f, 0.14f, new Color(1f, 0.85f, 0.55f), 0);
                int n = FxBudget.Allow(Mathf.RoundToInt(6 * Density), false);
                var spark = rt.GetEmitter("Spark");
                for (int i = 0; spark != null && i < n; i++)
                    rt.EmitOne(spark, body, Random.onUnitSphere * Random.Range(3f, 6f) + Vector3.up * 2f, Random.Range(0.08f, 0.12f), Random.Range(0.3f, 0.45f), color, 0);
            }
            return EliteFuseFx.Spawn(ground, radius, fuse, color);
        }

        /// <summary>狂暴触发：ground = 脚下，center = 身体中心，size = 身体半径（世界米）</summary>
        public static void EliteFrenzy(Vector3 ground, Vector3 center, float size, Color color)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.4f, size);
            var blood = new Color(color.r, color.g * 0.6f, color.b * 0.8f);
            // 主形：一圈贴地扩开的锯齿血环（ToonRing 的横环）+ 身上一闪
            var ring = rt.GetEmitter("ToonRing");
            if (ring != null && FxBudget.Allow(1, true) > 0) rt.EmitOne(ring, ground + Vector3.up * 0.12f, Vector3.zero, r * 2.6f, 0.32f, blood * 1.6f, 0);
            var pop = rt.GetEmitter("ToonBurst");
            if (pop != null && FxBudget.Allow(1, true) > 0) rt.EmitOne(pop, center, Vector3.zero, r * 2.2f, 0.12f, new Color(1f, 0.55f, 0.45f), 0);
            // 次级：往上窜的血焰（卡通火苗，S 形翻卷）
            var flame = rt.GetEmitter("ToonFlame");
            int n = FxBudget.Allow(Mathf.RoundToInt(8 * Density), false);
            for (int i = 0; flame != null && i < n; i++)
            {
                float a = i * Mathf.PI * 2f / Mathf.Max(1, n);
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                rt.EmitOne(flame, ground + d * r * 0.8f + Vector3.up * 0.2f, d * 1.5f + Vector3.up * Random.Range(4f, 6.5f), r * Random.Range(0.9f, 1.3f), Random.Range(0.35f, 0.5f),
                    blood * 1.3f, 0);
            }
            // 点缀：几根往外甩的尖刺（锯齿的形状语言）
            var shard = rt.GetEmitter("Shard");
            int m = FxBudget.Allow(Mathf.RoundToInt(10 * Density), false);
            for (int i = 0; shard != null && i < m; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                rt.EmitOne(shard, center, new Vector3(Mathf.Cos(a), Random.Range(0.1f, 0.6f), Mathf.Sin(a)) * Random.Range(6f, 9f), Random.Range(0.12f, 0.2f),
                    Random.Range(0.35f, 0.5f), blood, 0);
            }
            Flash(center, blood, 5f, 5f, 0.18f);
        }

        /// <summary>坚盾破盾：六角甲片从身上崩飞、一圈蓝环</summary>
        public static void EliteShieldBreak(Vector3 center, float size, Color color)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.4f, size);
            var hex = rt.GetEmitter("Hex");
            int n = FxBudget.Allow(Mathf.RoundToInt(9 * Density), false);
            for (int i = 0; hex != null && i < n; i++)
                rt.EmitOne(hex, center + Random.onUnitSphere * r * 0.8f, Random.onUnitSphere * Random.Range(2f, 4f), r * Random.Range(0.45f, 0.7f), Random.Range(0.3f, 0.45f), color, 0);
            var plate = rt.GetEmitter("Plate");
            int m = FxBudget.Allow(Mathf.RoundToInt(8 * Density), false);
            for (int i = 0; plate != null && i < m; i++)
                rt.EmitOne(plate, center, Random.onUnitSphere * Random.Range(4f, 7f) + Vector3.up * 3f, Random.Range(0.14f, 0.24f), Random.Range(0.7f, 1f),
                    Color.Lerp(color, Color.white, 0.3f), 0);
        }

        /// <summary>坚盾回满：一圈六角格往里一合、亮一下</summary>
        public static void EliteShieldRestore(Vector3 center, float size, Color color)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.4f, size);
            var hex = rt.GetEmitter("Hex");
            int n = FxBudget.Allow(Mathf.RoundToInt(6 * Density), false);
            for (int i = 0; hex != null && i < n; i++)
            {
                float a = i * Mathf.PI * 2f / Mathf.Max(1, n);
                var d = new Vector3(Mathf.Cos(a), 0.2f, Mathf.Sin(a));
                rt.EmitOne(hex, center + d * r * 1.3f, -d * r * 2.4f, r * 0.55f, 0.3f, color, 0);
            }
        }

        /// <summary>迅捷的风线：从 at 往 back 方向拖两三根青色拉丝（流线），不发光团</summary>
        public static void EliteWindStreak(Vector3 at, Vector3 back, float size, Color color)
        {
            if (!Finite(at) || !Finite(back)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var e = rt.GetEmitter("Spray");
            int n = FxBudget.Allow(Mathf.RoundToInt(3 * Mathf.Lerp(0.6f, 1f, Density)), false);
            back.y = 0;
            back = back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.back;
            var side = Vector3.Cross(Vector3.up, back);
            var c = new Color(Mathf.Lerp(color.r, 1f, 0.35f), Mathf.Lerp(color.g, 1f, 0.35f), Mathf.Lerp(color.b, 1f, 0.35f), 0.85f);
            for (int i = 0; e != null && i < n; i++)
            {
                var p = at + side * Random.Range(-size, size) + Vector3.up * Random.Range(-size * 0.6f, size * 0.9f);
                rt.EmitOne(e, p, back * Random.Range(7f, 11f) + Vector3.up * 0.4f, Random.Range(0.05f, 0.08f), Random.Range(0.18f, 0.26f), c, 0);
            }
        }
    }

    /// <summary>
    /// 爆裂死亡的引信演出（<see cref="Fx.EliteFuse"/>）：地上的火药星纹样从 0.42 × 爆炸半径收缩到 0.14 ×、越转越快、越来越亮，火星从预警圈边吸向圆心；
    /// 最后 0.12 s 白热闪烁（蓄力顶点）。<see cref="Detonate"/>（玩法在预警填满的同一帧调）= 星芒一下子甩到爆炸半径并淡掉、尖刺沿十六个芒向外飞。
    /// 玩法没调 Detonate（爆心被清场取消）时引信到点后 0.5 s 自己收掉。池化（最多同时 8 个，超出的不画）。
    /// </summary>
    public sealed class EliteFuseFx : MonoBehaviour
    {
        const int Max = 8;
        const float Hold = 0.12f, BlastTime = 0.2f;
        static readonly List<EliteFuseFx> pool = new();
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        Renderer star;
        MaterialPropertyBlock block;
        Vector3 ground;
        float radius, fuse, t, spin, emitAcc, blastT;
        Color color;
        bool live, detonated;

        /// <summary>正在蓄力（测试用）</summary>
        public bool Charging => live && !detonated;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => pool.Clear();

        internal static EliteFuseFx Spawn(Vector3 ground, float radius, float fuse, Color color)
        {
            pool.RemoveAll(p => !p);
            EliteFuseFx fx = null;
            foreach (var p in pool)
                if (!p.live)
                {
                    fx = p;
                    break;
                }
            if (!fx)
            {
                if (pool.Count >= Max) return null;
                var go = new GameObject("Elite Fuse Fx");
                fx = go.AddComponent<EliteFuseFx>();
                fx.Build();
                pool.Add(fx);
            }
            fx.Begin(ground, radius, fuse, color);
            return fx;
        }

        void Build()
        {
            block = new MaterialPropertyBlock();
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.name = "Fuse Star";
            q.layer = Layers.IgnoreRaycast;
            q.transform.SetParent(transform, false);
            q.transform.localRotation = Quaternion.Euler(90, 0, 0);
            star = q.GetComponent<Renderer>();
            star.sharedMaterial = EliteAura.SigilMaterialFor(EliteSigil.Volatile);
            star.shadowCastingMode = ShadowCastingMode.Off;
            star.receiveShadows = false;
        }

        void Begin(Vector3 g, float r, float f, Color c)
        {
            ground = g;
            radius = Mathf.Max(0.5f, r);
            fuse = Mathf.Max(0.2f, f);
            color = c;
            t = spin = emitAcc = blastT = 0;
            live = true;
            detonated = false;
            transform.position = g + Vector3.up * 0.07f;
            gameObject.SetActive(true);
            star.enabled = true;
            Apply();
        }

        /// <summary>炸开（玩法回调里调，和伤害、爆炸特效同一帧）</summary>
        public void Detonate()
        {
            if (!live || detonated) return;
            detonated = true;
            blastT = 0;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            // 十六芒方向甩出尖刺（长芒快、短芒慢）
            var shard = rt.GetEmitter("Shard");
            int n = FxBudget.Allow(Mathf.RoundToInt(16 * Mathf.Lerp(0.5f, 1f, Fx.Density)), false);
            for (int i = 0; shard != null && i < n; i++)
            {
                float a = (spin + i * 360f / n) * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Cos(a), 0.18f, Mathf.Sin(a));
                rt.EmitOne(shard, ground + Vector3.up * 0.5f, d * (i % 2 == 0 ? 15f : 10f), 0.22f, 0.35f, color * 1.4f, 0);
            }
        }

        void Update()
        {
            if (!live) return;
            float dt = Time.deltaTime;
            t += dt;
            if (detonated)
            {
                blastT += dt;
                if (blastT >= BlastTime) End();
                else Apply();
                return;
            }
            if (t > fuse + 0.5f)
            {
                End();
                return;
            }
            float k = Mathf.Clamp01(t / fuse);
            spin += dt * (40f + 720f * k * k);
            // 火星从预警圈边往圆心吸（蓄），越到后面越密
            emitAcc += dt * Mathf.Lerp(18f, 46f, k) * Mathf.Lerp(0.6f, 1f, Fx.Density);
            int n = Mathf.FloorToInt(emitAcc);
            emitAcc -= n;
            n = FxBudget.Allow(n, false);
            var rt = n > 0 ? FxRuntime.Ensure() : null;
            var e = rt ? rt.GetEmitter("Ember") : null;
            for (int i = 0; e != null && i < n; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                float life = Mathf.Clamp(fuse - t, 0.15f, 0.5f);
                var from = ground + d * radius * Random.Range(0.85f, 1f) + Vector3.up * Random.Range(0.15f, 0.5f);
                rt.EmitOne(e, from, -d * (radius * 0.85f / life), Random.Range(0.12f, 0.18f), life, color * 1.3f, 0);
            }
            Apply();
        }

        void Apply()
        {
            float k = Mathf.Clamp01(t / fuse);
            float size, bright, alpha = 1f;
            if (detonated)
            {
                float b = Mathf.Clamp01(blastT / BlastTime);
                size = Mathf.Lerp(radius * 0.3f, radius * 2.1f, 1f - (1f - b) * (1f - b));
                bright = 3.2f * (1f - b);
                alpha = 1f - b;
            }
            else
            {
                float e = k * k * (3f - 2f * k);
                size = Mathf.Lerp(radius * 0.84f, radius * 0.28f, e);
                bright = 1.1f + 1.8f * k * k;
                // 蓄力顶点：最后 0.12 s 白热闪烁
                if (fuse - t < Hold) bright = 3.2f + 1.2f * Mathf.Sin(t * 90f);
            }
            transform.localRotation = Quaternion.Euler(0, -spin, 0);
            star.transform.localScale = new Vector3(size, size, 1);
            float w = detonated ? 0.6f : Mathf.Clamp01((fuse - t) < Hold ? 0.55f : 0f);
            var c = new Color(color.r * bright + w, color.g * bright + w * 0.9f, color.b * bright + w * 0.6f, alpha);
            block.Clear();
            block.SetColor(BaseColorId, c);
            star.SetPropertyBlock(block);
        }

        void End()
        {
            live = false;
            if (star) star.enabled = false;
            gameObject.SetActive(false);
        }
    }
}
