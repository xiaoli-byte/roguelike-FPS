using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出生法阵 + 显形（FX2，Three.js Fx.ts spawnEffect；docs/unity-parity.md「出生表现：溶解显形 + 沙旋」）。
    /// EnemyAI.Spawn 发 EnemySpawned 时由 FxDirector 挂上，和敌人 0.7 s 的出生无敌（spawn 状态）同步：
    ///   脚下：法阵贴花（双环 + 刻度 + 转动的符段 + 六芒星，敌人色；空中出生的画一个水平光环）+ 一圈升起的光墙；
    ///   身上：SF_StylizedLit 溶解反着走（1 → 0），高度渐变让脚先出现、头最后，前沿一圈敌人色的 HDR 发光；
    ///   周围：从法阵边缘螺旋上升的光点（42 颗 / 秒 × 密度）+ 按脚下地表卷起的沙旋 / 雪旋 / 尘旋；
    ///   显形完成前 0.1 s：<see cref="SpawnFinalePreset"/>（闪光 + 外扩光粒 + 升起的符文 + 贴地小环）。
    /// 材质不支持溶解的渲染器（毛发壳层…）先不画，显形过半再画。精英的法阵是金色。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SpawnMaterialize : MonoBehaviour
    {
        /// <summary>显形时长：与 EnemyAI 的出生无敌（spawn 状态 0.7 s）一致</summary>
        public const float Duration = 0.7f;
        static readonly Color EliteGold = Hex.Rgb(0xffd24a);

        EnemyAI ai;
        readonly List<Renderer> targets = new(), others = new();
        MaterialPropertyBlock block;
        Color color, edge, swirlColor;
        Vector3 ground;
        float t0, radius, height, ringR, emitAcc, swirlAcc;
        bool finale, done, air;
        /// <summary>本章法阵主题（C 路 <see cref="SpawnThemes"/>：画了主题法阵就不画通用法阵，出了地表卷尘就不卷通用沙旋）</summary>
        SpawnTheme theme;

        /// <summary>此刻的溶解量（测试用）：1 = 还看不见，0 = 完全显形</summary>
        public float Amount { get; private set; }
        public bool Done => done;

        /// <summary>开始显形；返回是否真的开始了（敌人已死 / 已销毁时 false）</summary>
        public static bool Begin(EnemyAI ai)
        {
            if (!ai || !ai.Health || ai.Health.Dead) return false;
            if (!ai.TryGetComponent(out SpawnMaterialize sm)) sm = ai.gameObject.AddComponent<SpawnMaterialize>();
            sm.ai = ai;
            sm.Restart();
            return true;
        }

        void Restart()
        {
            var hp = ai.Health;
            color = ai.elite ? EliteGold : FxDirector.EnemyColor(hp);
            // 显形前沿：HDR 敌人色 + 一点白热底（B 路打磨亮了一档；风格审查又压回一些：前沿是一道亮边，不是整个人发白）
            edge = new Color(color.r * 2.8f + 0.25f, color.g * 2.8f + 0.22f, color.b * 2.8f + 0.2f, 1);
            DeathDissolve.Collect(gameObject, targets, others);
            var b = DeathDissolve.BoundsOf(targets, transform.position + Vector3.up);
            radius = Mathf.Clamp(Mathf.Max(b.extents.x, b.extents.z), 0.3f, 4f);
            height = Mathf.Max(0.5f, b.size.y);
            var feet = transform.position;
            float gy = Fx.GroundY(feet + Vector3.up * 0.5f, 6f);
            air = float.IsNegativeInfinity(gy) || feet.y - gy > 1.2f;
            ground = air ? feet : new Vector3(feet.x, gy, feet.z);
            ringR = Mathf.Max(1.35f, radius * 1.6f);
            block ??= new MaterialPropertyBlock();
            Amount = 1;
            Write(1);
            foreach (var r in others)
                if (r) r.forceRenderingOff = true;

            // 脚下的法阵 + 光墙
            var rt = FxRuntime.Ensure();
            theme = SpawnThemes.For(ai);
            if (!air && !SpawnThemes.Begin(theme, ground, ringR, color, Duration + 0.25f, ai.elite)) FxDecals.Rune(ground + Vector3.up * 0.02f, ringR, color, Duration + 0.25f);
            if (rt)
            {
                if (air)
                {
                    var flat = rt.GetEmitter("RingFlat");
                    if (flat != null) rt.EmitOne(flat, ground, Vector3.zero, ringR * 0.9f, Duration + 0.15f, color, 0);
                }
                // 光墙压暗一档（风格审查：白金色的柔光柱比旁边的模型亮一截）
                rt.Wall(ground, Mathf.Max(0.6f, radius * 1.1f), Mathf.Max(2.2f, height * 1.4f), color * 0.6f, Duration + 0.1f, false);
            }
            swirlColor = SwirlColor();
            t0 = Time.time;
            emitAcc = swirlAcc = 0;
            finale = done = false;
            enabled = true;
        }

        /// <summary>沙旋的颜色按脚下地表：沙黄 / 雪白 / 灰土；空中出生不卷</summary>
        Color SwirlColor()
        {
            if (air) return Color.clear;
            if (!Physics.Raycast(ground + Vector3.up * 0.3f, Vector3.down, out var hit, 1f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return Hex.Rgb(0x8c8274);
            return Surfaces.Classify(in hit) switch
            {
                SurfaceKind.Sand => Hex.Rgb(0xc9a676),
                SurfaceKind.Ice => Hex.Rgb(0xeef8ff),
                _ => Hex.Rgb(0x8c8274),
            };
        }

        void Write(float amount)
        {
            // 脚先出现：g = (顶 − y) / 高（底部 g 大、先显形），权重 0.75；前沿宽 0.12
            float top = transform.position.y + height;
            DeathDissolve.Apply(targets, block, amount, new Vector4(top, -1f / height, 0, 0), 0.75f, edge, 0.15f);
        }

        void Update()
        {
            if (done || !ai) return;
            float t = (Time.time - t0) / Duration;
            if (ai.Dead)
            {
                Finish();
                return;
            }
            float k = Mathf.Clamp01(t);
            float amount = 1f - Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((k - 0.05f) / 0.9f));
            Amount = amount;
            Write(amount);
            if (k > 0.55f)
                foreach (var r in others)
                    if (r) r.forceRenderingOff = false;
            Emit(k);
            if (!finale && Time.time - t0 >= Duration - 0.1f)
            {
                finale = true;
                var c = DeathDissolve.BoundsOf(targets, transform.position + Vector3.up).center;
                Fx.Play("SpawnFinale", c, Vector3.up, color, Mathf.Clamp(radius * 2, 0.6f, 6f));
                SpawnThemes.Finale(theme, c, Mathf.Clamp(radius * 2, 0.6f, 6f), color);
            }
            if (t >= 1f) Finish();
        }

        void Emit(float k)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float dt = Time.deltaTime;
            // 从法阵边缘螺旋上升的光点（切向 + 向内，形成旋涡）
            emitAcc += dt * 42f * Fx.Density * Mathf.Clamp(ringR / 1.35f, 1f, 2.5f);
            var mote = emitAcc >= 1 ? rt.GetEmitter("Mote") : null;
            while (emitAcc >= 1)
            {
                emitAcc -= 1;
                if (mote == null) continue;
                float a = Random.value * Mathf.PI * 2;
                float rr = Random.Range(0.26f, 0.93f) * ringR;
                var p = ground + new Vector3(Mathf.Cos(a) * rr, 0.05f, Mathf.Sin(a) * rr);
                var v = new Vector3(-Mathf.Sin(a) * 1.4f - Mathf.Cos(a) * 0.6f, Random.Range(1.8f, 4.2f), Mathf.Cos(a) * 1.4f - Mathf.Sin(a) * 0.6f);
                rt.EmitOne(mote, p, v, Random.Range(0.07f, 0.14f), Random.Range(0.45f, 0.85f), color, 0);
            }
            // 沙旋：贴地打转的尘团（前 70%）；本章主题自己出了地表卷尘就不卷通用的
            if (!air && SpawnThemes.Tick(theme, ground, ringR, k, dt, color)) return;
            if (swirlColor.a <= 0 || k > 0.7f) return;
            swirlAcc += dt * 14f * Fx.Density;
            var dust = swirlAcc >= 1 ? rt.GetEmitter(swirlColor.b > 0.95f ? "Powder" : "Dust") : null;
            while (swirlAcc >= 1)
            {
                swirlAcc -= 1;
                if (dust == null) continue;
                float a = Random.value * Mathf.PI * 2;
                float rr = Random.Range(0.6f, 1f) * ringR;
                var p = ground + new Vector3(Mathf.Cos(a) * rr, 0.1f, Mathf.Sin(a) * rr);
                var v = new Vector3(-Mathf.Sin(a) * 3f - Mathf.Cos(a), Random.Range(0.4f, 1.2f), Mathf.Cos(a) * 3f - Mathf.Sin(a));
                rt.EmitOne(dust, p, v, Random.Range(0.35f, 0.6f), Random.Range(0.5f, 0.8f), swirlColor, 0);
            }
        }

        void Finish()
        {
            done = true;
            Amount = 0;
            if (block != null) DeathDissolve.Apply(targets, block, 0, Vector4.zero, 0, Color.black, 0.1f);
            foreach (var r in others)
                if (r) r.forceRenderingOff = false;
            enabled = false;
        }

        void OnDisable()
        {
            // 中途被停用（换关清场、回收）也不能把敌人留成半透明
            if (!done && block != null) Finish();
        }
    }
}
