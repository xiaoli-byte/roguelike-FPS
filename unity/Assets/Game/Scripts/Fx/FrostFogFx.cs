using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冻雾的外观（FX3；Three.js FrostSkirmishFx.spawnFrostFog）：地面一块流动霜纹（<see cref="FxDecals.Frost"/>）+ 一直续着的几团贴地翻滚的冷雾
    /// （FrostMist，缓慢打旋、往外散）+ 雾里一闪一闪的冰粒 + 零星飘落的雪花。持续 duration 秒，最后 0.8 s 不再续雾、让剩下的自己散掉。
    /// 挂在冻雾（<see cref="FrostFog"/>）物体上，冻雾提前结束 / 销毁时霜纹一起化掉。纯装饰，减速由 FrostFog 结算。
    /// </summary>
    public sealed class FrostFogFx : MonoBehaviour
    {
        Vector3 ground;
        float radius, duration, age, mistAcc, twinkleAcc, snowAcc, swirl;
        FxHandle decal;
        HazardZone zone;

        /// <summary>雾团数（测试用）</summary>
        public int Puffs { get; private set; }

        // 收尾一轮（fx-style ②「雪雾偏冷白，不要纯白糊屏」）：原来霜纹浓度 1.1、雾团是近白的 Mist、同时约 5 + 1.5r 团，
        // 冰面 / 雪地上整片发白（鲲鹏倒下的余韵那一格几乎整幅浅蓝白）。现在霜纹淡一半、雾团偏冰蓝灰、数量少三成五
        const float DecalDensity = 0.6f, MistRate = 0.65f;
        static readonly Color MistTint = new(0.66f, 0.79f, 0.92f);

        /// <summary>给 host 加冻雾外观：ground = 雾心（地面），radius、duration 同冻雾</summary>
        public static FrostFogFx Attach(GameObject host, Vector3 ground, float radius, float duration)
        {
            if (!host || !Application.isPlaying) return null;
            var f = host.AddComponent<FrostFogFx>();
            f.ground = ground;
            f.radius = Mathf.Max(0.5f, radius);
            f.duration = Mathf.Max(0.5f, duration);
            f.zone = host.GetComponent<HazardZone>();
            f.swirl = Random.value < 0.5f ? -1 : 1;
            f.decal = FxDecals.Frost(ground + Vector3.up * 0.02f, f.radius, f.duration + 0.4f, DecalDensity);
            // 一开始就铺几团，不要等雾慢慢续上
            f.mistAcc = (3 + f.radius) * MistRate;
            return f;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            bool ended = zone && zone.Ended;
            if (ended && decal.Alive) decal.Cancel();
            float left = duration - age;
            if (ended || left < 0.8f) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float dens = Fx.Density;
            // 冷雾：同时约 (5 + 1.5r) × 0.65 团，平均寿命 2.1 s
            mistAcc += dt * (5 + 1.5f * radius) / 2.1f * dens * MistRate;
            var mist = mistAcc >= 1 ? rt.GetEmitter("FrostMist") : null;
            while (mistAcc >= 1)
            {
                mistAcc -= 1;
                if (mist == null) break;
                var o = Random.insideUnitCircle * radius * 0.72f;
                var p = ground + new Vector3(o.x, Random.Range(0.2f, 0.45f) + radius * 0.06f, o.y);
                var outward = new Vector3(o.x, 0, o.y);
                var tangent = new Vector3(-o.y, 0, o.x) * swirl;
                var v = outward * 0.12f + tangent * 0.25f + Vector3.up * Random.Range(0f, 0.08f);
                float life = Mathf.Min(Random.Range(1.7f, 2.6f), left + 0.6f);
                rt.EmitOne(mist, p, v, radius * Random.Range(0.42f, 0.62f), life, MistTint, 0);
                Puffs++;
            }
            twinkleAcc += dt * (4 + 2 * radius) * dens;
            var tw = twinkleAcc >= 1 ? rt.GetEmitter("Twinkle") : null;
            while (twinkleAcc >= 1)
            {
                twinkleAcc -= 1;
                if (tw == null) break;
                var o = Random.insideUnitCircle * radius * 0.85f;
                rt.EmitOne(tw, ground + new Vector3(o.x, Random.Range(0.1f, 1.1f), o.y), new Vector3(0, Random.Range(0.05f, 0.25f), 0),
                    Random.Range(0.07f, 0.13f), Random.Range(0.5f, 1.0f), FrostPalette.IceHot, 0);
            }
            snowAcc += dt * (1.5f + radius) * dens;
            var snow = snowAcc >= 1 ? rt.GetEmitter("Snow") : null;
            while (snowAcc >= 1)
            {
                snowAcc -= 1;
                if (snow == null) break;
                var o = Random.insideUnitCircle * radius * 0.8f;
                rt.EmitOne(snow, ground + new Vector3(o.x, Random.Range(1.4f, 2.2f), o.y), new Vector3(Random.Range(-0.2f, 0.2f), -0.3f, Random.Range(-0.2f, 0.2f)),
                    Random.Range(0.05f, 0.09f), Random.Range(1.2f, 1.8f), FrostPalette.Snow, 0);
            }
        }

        void OnDestroy()
        {
            if (decal.Alive) decal.Cancel();
        }
    }
}
