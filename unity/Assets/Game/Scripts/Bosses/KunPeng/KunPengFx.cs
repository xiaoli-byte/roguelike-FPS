using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏的场景特效（Three.js KunPengFx 的 Unity 版；每只鲲鹏一份，不挂在首领身上——溃散演出隐去首领模型时它不受影响）：
    ///   · 水面翻涌 <see cref="SetAgitation"/>：冰窟水面的波高 / 波速 / 泡沫（MaterialPropertyBlock，不复制材质）+ 按翻涌程度冒泡、升寒雾；
    ///   · 吞吸气流 <see cref="Suction"/>：扇形里一道道冰屑曳光被吸向鲲口；
    ///   · 狂风 <see cref="Gust"/>：贴地的白色风痕从冰沿向外缘飞掠；
    ///   · 冰雾爆闪 <see cref="Flash"/>：冰窟上方一团加色光晕（几片朝相机的光晕片）+ 白雾，化鹏时盖住换模型。
    /// 首领没了（被回收 / 倒下后延时）就自己收掉；首领自建的虚拟冰窟也一起收掉。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class KunPengFx : MonoBehaviour
    {
        static readonly int WaveHeightId = Shader.PropertyToID("_WaveHeight"), WaveSpeedId = Shader.PropertyToID("_WaveSpeed"),
            FoamId = Shader.PropertyToID("_FoamAmount");
        static readonly Color Streak = new(0.85f, 0.96f, 1f), Mist = new(0.86f, 0.94f, 1f), FogTint = new(0.82f, 0.93f, 1f);

        KunPengBrain owner;
        IceHole hole;
        bool ownsHole, suction, gust, released;
        float agitation, agitationTarget, bubbleAcc, mistAcc, suctionAcc, gustAcc, releaseAt = float.PositiveInfinity;
        Vector3 mouth;
        float suctionYaw;
        MaterialPropertyBlock block;
        readonly List<Renderer> fog = new();

        /// <summary>当前水面翻涌程度 0..1、冰雾浓度 0..1</summary>
        public float Agitation => agitation;
        public float FlashLevel { get; private set; }
        public bool SuctionOn => suction;
        public bool GustOn => gust;
        /// <summary>累计放出的吞吸冰屑 / 狂风风痕（测试用）</summary>
        public int SuctionStreaks { get; private set; }
        public int GustStreaks { get; private set; }

        IceHoleInfo Info => owner ? owner.Hole : hole ? hole.Info : default;

        public void Bind(KunPengBrain b, IceHole h, bool owns)
        {
            owner = b;
            hole = h;
            ownsHole = owns;
            transform.position = h ? h.Center : b.transform.position;
            BuildFog();
        }

        /// <summary>水面翻涌程度 0..1（平滑过渡）</summary>
        public void SetAgitation(float k) => agitationTarget = Mathf.Clamp01(k);

        /// <summary>吞吸气流：冰屑从 yaw（度）方向的扇形里被吸向 mouthPoint</summary>
        public void Suction(bool on, Vector3 mouthPoint = default, float yawDeg = 0)
        {
            suction = on;
            if (!on) return;
            mouth = mouthPoint;
            suctionYaw = yawDeg;
        }

        /// <summary>狂风：贴地风痕从冰沿往外缘飞掠</summary>
        public void Gust(bool on) => gust = on;

        /// <summary>冰雾爆闪浓度 0..1（立即生效，由首领逐帧驱动）</summary>
        public void Flash(float k)
        {
            FlashLevel = Mathf.Clamp01(k);
            block ??= new MaterialPropertyBlock();
            foreach (var r in fog)
            {
                if (!r) continue;
                r.enabled = FlashLevel > 0.01f;
                if (r.enabled) FxMaterials.Tint(r, new Color(FogTint.r, FogTint.g, FogTint.b, 0.55f * FlashLevel));
            }
        }

        /// <summary>首领倒下后 seconds 秒收掉（水面先平静下来）</summary>
        public void ReleaseAfter(float seconds)
        {
            released = true;
            releaseAt = Time.time + Mathf.Max(0.5f, seconds);
            suction = gust = false;
            SetAgitation(0.15f);
        }

        void BuildFog()
        {
            var info = Info;
            float r = Mathf.Max(4f, info.radius);
            for (int i = 0; i < 6; i++)
            {
                float a = i / 6f * Mathf.PI * 2;
                var t = FxMaterials.GlowSprite(transform, r * (i == 0 ? 2.4f : 1.6f), FogTint);
                t.localPosition = i == 0 ? new Vector3(0, r * 0.35f, 0) : new Vector3(Mathf.Sin(a) * r * 0.45f, r * (0.15f + 0.1f * (i % 2)), Mathf.Cos(a) * r * 0.45f);
                var rend = t.GetComponent<Renderer>();
                if (!rend) continue;
                rend.enabled = false;
                fog.Add(rend);
            }
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (!owner && !released) ReleaseAfter(0.5f);
            if (released && Time.time >= releaseAt)
            {
                if (ownsHole && hole) Destroy(hole.gameObject);
                Destroy(gameObject);
                return;
            }
            var info = Info;
            agitation = Mathf.MoveTowards(agitation, agitationTarget, dt * 1.5f);
            WriteWater();
            if (!(dt > 0)) return;

            // 冒泡与寒雾：越翻涌越密
            bubbleAcc += dt * Mathf.Lerp(1.5f, 12f, agitation);
            while (bubbleAcc >= 1f)
            {
                bubbleAcc -= 1f;
                var p = RandomOnWater(info, 0.85f);
                Fx.Burst(p, Mist, 3 + (int)(agitation * 4), 2f + agitation * 3f, 0.5f, 0.22f, 4f);
            }
            mistAcc += dt * Mathf.Lerp(0.8f, 3f, agitation);
            while (mistAcc >= 1f)
            {
                mistAcc -= 1f;
                var p = RandomOnWater(info, 0.7f) + Vector3.up * 0.4f;
                Fx.Burst(p, Mist, 4, 0.8f, 1.8f, 0.9f, -0.6f);
            }

            if (suction)
            {
                suctionAcc += dt;
                while (suctionAcc >= 0.04f)
                {
                    suctionAcc -= 0.04f;
                    // 扇形里（半角 35°、离口 6–22 m）取一点，曳光往口部飞三分之一程
                    float yaw = suctionYaw + Random.Range(-35f, 35f);
                    var from = mouth + KunPengMath.Dir(yaw) * Random.Range(6f, 22f);
                    from.y = info.FloorY + Random.Range(0.4f, 3f);
                    var to = Vector3.Lerp(from, mouth, Random.Range(0.25f, 0.45f));
                    Fx.Tracer(from, to, Streak, 0.08f);
                    SuctionStreaks++;
                }
            }
            if (gust)
            {
                gustAcc += dt;
                while (gustAcc >= 0.05f)
                {
                    gustAcc -= 0.05f;
                    float a = Random.Range(0f, 360f), r0 = Random.Range(info.radius + 0.5f, Mathf.Max(info.radius + 1f, info.outer - 4f));
                    var from = info.Point(a, r0) + Vector3.up * Random.Range(0.3f, 1.4f);
                    var to = info.Point(a, r0 + Random.Range(3f, 5f)) + Vector3.up * (from.y - info.FloorY);
                    Fx.Tracer(from, to, Streak, 0.1f);
                    if (Random.value < 0.25f) Fx.Burst(to, Mist, 3, 1.5f, 0.5f, 0.3f, 0.5f);
                    GustStreaks++;
                }
            }
        }

        /// <summary>水面的波高 / 波速 / 泡沫按翻涌程度（MaterialPropertyBlock）</summary>
        void WriteWater()
        {
            var r = hole ? hole.WaterSurface : null;
            if (!r) return;
            block ??= new MaterialPropertyBlock();
            r.GetPropertyBlock(block);
            block.SetFloat(WaveHeightId, Mathf.Lerp(0.035f, 0.22f, agitation));
            block.SetFloat(WaveSpeedId, Mathf.Lerp(0.6f, 2.2f, agitation));
            block.SetFloat(FoamId, Mathf.Lerp(0.35f, 0.85f, agitation));
            r.SetPropertyBlock(block);
        }

        static Vector3 RandomOnWater(in IceHoleInfo info, float within)
        {
            float a = Random.Range(0f, 360f), d = Mathf.Sqrt(Random.value) * info.radius * within;
            var p = info.Point(a, d);
            p.y = info.waterY + 0.05f;
            return p;
        }

        void OnDestroy()
        {
            if (ownsHole && hole) Destroy(hole.gameObject);
        }
    }
}
