using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃二阶段「焦土」的场地变化（unity-maps-v1 第 3 节：她把剩下的泉水吸干，泉床龟裂，裂缝间歇喷出热气（地面预警））。
    /// 不是招式：转阶段演出开始时由 <see cref="HanbaBrain"/> 调 <see cref="Begin"/>，之后每帧（招式间隙和出招中，转换 / 硬直时不走）调 <see cref="Tick"/>，三阶段照常喷、喷得更勤。
    ///   · 吸干：<see cref="HanbaSpring"/> 的每段浅水在演出的前 80% 降到底、停用，水珠沿路飘向她的心口（泉珠）——之后日晒判定认不出浅水，踩水减半没了。
    ///   · 龟裂：沿泉床最低处（各段水的底面中心，没有泉水时取场地中心一圈）铺一串发光的裂缝（不挡路、不挡子弹的细条），隔一段亮一个裂口——喷气裂缝的位置。
    ///   · 喷气：每 <see cref="HanbaDef.ventEvery"/> 秒（按阶段）挑 <see cref="HanbaDef.ventCount"/> 个裂口（离玩家最近、14 m 以内的那个必选，其余随机且互相隔开 5 m），
    ///     先亮 <see cref="HanbaDef.ventWarn"/> 秒圆形地面预警（危险物组：打断招式也照常兑现），再喷：半径 <see cref="HanbaDef.ventRadius"/>、
    ///     4 m 高以内的人被灼伤并掀起来（不看掩体——从脚下冒出来），泉水喷柱再喷 1.2 s。
    /// 躲法：看地面预警走开；喷气把人掀起来时正好躲开贴地的旱风热浪。
    /// </summary>
    public sealed class Phase2Scorch
    {
        static readonly Color Steam = new(0.95f, 0.93f, 0.88f), CrackGlow = Hex.Rgb(0xff8a2a), VentWarn = Hex.Rgb(0xffb070);
        /// <summary>两个裂口之间最短多远（米）；吸干占转阶段演出的比例；一次喷发时白汽柱冒多久</summary>
        public const float VentSpacing = 5f, DrainShare = 0.8f, PlumeSeconds = 1.2f, NearPlayer = 14f;

        readonly HanbaBrain boss;
        readonly List<Vector3> vents = new();
        readonly List<Renderer> glows = new();
        Transform root;
        float timer, glowT;

        /// <summary>场地变化已经开始（吸干 / 龟裂）</summary>
        public bool Begun { get; private set; }
        public HanbaSpring Spring { get; private set; }
        /// <summary>裂口位置（地面）</summary>
        public IReadOnlyList<Vector3> Vents => vents;
        /// <summary>累计：喷发轮数、画过的预警、喷出的裂口、打中玩家的次数</summary>
        public int Bursts { get; private set; }
        public int Warned { get; private set; }
        public int Erupted { get; private set; }
        public int PlayerHits { get; private set; }
        /// <summary>龟裂的发光细条数（测试用）</summary>
        public int Cracks => glows.Count;

        public Phase2Scorch(HanbaBrain b) => boss = b;

        BossHazards Hazards => BossHazards.For(boss);
        HanbaDef Def => boss ? boss.HDef : null;

        /// <summary>开始吸干 + 龟裂（seconds = 转阶段演出时长）。只做一次</summary>
        public void Begin(float seconds)
        {
            if (Begun || !boss) return;
            Begun = true;
            Spring = HanbaSpring.Find(boss.Arena);
            if (Spring) Spring.Drain(Mathf.Max(0.3f, seconds * DrainShare), boss.BodyCenter + Vector3.up * 0.4f);
            PickVents();
            BuildCracks();
            timer = (Def?.ventWarn ?? 1.1f) + seconds;
            GameAudio.PlayAt("shield_recharge", boss.BodyCenter, 0.9f, 0.5f);
        }

        /// <summary>裂口：泉床各段水的底面中心（太近的合并）；没有泉水时在场地中心外 55% 半径排一圈 8 个</summary>
        void PickVents()
        {
            vents.Clear();
            if (Spring && Spring.Beds.Count > 0)
            {
                foreach (var p in Spring.Beds)
                {
                    bool close = false;
                    foreach (var v in vents)
                        if ((v - p).sqrMagnitude < VentSpacing * VentSpacing * 0.5f)
                        {
                            close = true;
                            break;
                        }
                    if (!close) vents.Add(Ground(p));
                }
                return;
            }
            var arena = boss.Arena;
            var c = arena ? arena.Center : boss.transform.position;
            float r = (arena ? arena.Extent : 16f) * 0.55f;
            for (int i = 0; i < 8; i++)
            {
                float a = i * Mathf.PI / 4f + 0.3f;
                vents.Add(Ground(c + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r));
            }
        }

        static Vector3 Ground(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var h, 10f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point : p;

        /// <summary>龟裂：相邻裂口之间（9 m 以内）连一条发光细条，每个裂口再放射三条短裂缝</summary>
        void BuildCracks()
        {
            var parent = Spring ? Spring.transform : boss.transform.parent;
            root = new GameObject("Scorched Bed (runtime)").transform;
            root.SetParent(parent, false);
            for (int i = 0; i < vents.Count; i++)
            {
                var a = vents[i];
                for (int k = 0; k < 3; k++)
                {
                    float yaw = (i * 47 + k * 120) % 360;
                    var d = new Vector3(Mathf.Sin(yaw * Mathf.Deg2Rad), 0, Mathf.Cos(yaw * Mathf.Deg2Rad));
                    Crack(a, Ground(a + d * 1.8f), 0.12f);
                }
                if (i + 1 < vents.Count && (vents[i + 1] - a).sqrMagnitude < 81f) Crack(a, vents[i + 1], 0.16f);
            }
        }

        void Crack(Vector3 a, Vector3 b, float width)
        {
            var d = b - a;
            float len = d.magnitude;
            if (len < 0.2f) return;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var col = go.GetComponent<Collider>();
            if (col)
            {
                col.enabled = false;
                Object.Destroy(col);
            }
            go.name = "Crack";
            go.layer = Layers.IgnoreRaycast;
            go.transform.SetParent(root, true);
            go.transform.SetPositionAndRotation((a + b) * 0.5f + Vector3.up * 0.04f, Quaternion.LookRotation(d / len, Vector3.up));
            go.transform.localScale = new Vector3(width, 0.03f, len);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(r, CrackGlow * 0.2f);
            glows.Add(r);
        }

        /// <summary>每帧（阶段 ≥ 二）：裂缝明暗呼吸，到点挑裂口喷气</summary>
        public void Tick(float dt)
        {
            if (!Begun || !boss || boss.Dead) return;
            glowT += dt;
            // 演出期间裂缝慢慢亮起来，之后一呼一吸
            float on = Mathf.Clamp01(glowT / 2.5f);
            float k = on * (0.65f + 0.35f * Mathf.Sin(glowT * 2.2f));
            if (Time.frameCount % 3 == 0)
                foreach (var r in glows)
                    if (r)
                        FxMaterials.Tint(r, CrackGlow * (0.2f + 1.4f * k));
            if (vents.Count == 0) return;
            timer -= dt;
            if (timer > 0) return;
            var d = Def;
            timer = d != null ? d.VentEveryAt(boss.Phase) : 4f;
            Burst(d != null ? d.VentCountAt(boss.Phase) : 2);
        }

        static readonly List<int> picks = new();

        /// <summary>挑 count 个裂口喷（测试可以直接调）；返回实际排上的个数</summary>
        public int Burst(int count)
        {
            if (!boss || boss.Dead || vents.Count == 0 || count <= 0) return 0;
            picks.Clear();
            var player = boss.PlayerPosition;
            int near = -1;
            float best = NearPlayer * NearPlayer;
            for (int i = 0; i < vents.Count; i++)
            {
                float dd = (vents[i] - player).sqrMagnitude;
                if (dd >= best) continue;
                best = dd;
                near = i;
            }
            if (near >= 0) picks.Add(near);
            for (int tries = 0; picks.Count < count && tries < 24; tries++)
            {
                int i = Random.Range(0, vents.Count);
                bool ok = true;
                foreach (var j in picks)
                    if (j == i || (vents[j] - vents[i]).sqrMagnitude < VentSpacing * VentSpacing)
                    {
                        ok = false;
                        break;
                    }
                if (ok) picks.Add(i);
            }
            var d = Def;
            float warn = d?.ventWarn ?? 1.1f;
            foreach (var i in picks)
            {
                var p = vents[i];
                Hazards.GroundWarning(p, d?.ventRadius ?? 2.2f, warn, VentWarn, WarnKind.Hazard);
                Warned++;
                boss.NotifyVent();
                Fx.Burst(p + Vector3.up * 0.2f, Steam, 4, 1.2f, 0.6f, 0.25f, -0.4f);
                // 要喷了：泉床上一块发亮的裂口，一直亮到喷完
                FxDecals.Fire(p + Vector3.up * 0.02f, (d?.ventRadius ?? 2.2f) * 0.6f, warn + 1.2f, FireBed.Sunfire);
                Hazards.Later(warn, () => Erupt(p));
            }
            Bursts++;
            return picks.Count;
        }

        void Erupt(Vector3 p)
        {
            if (!boss || boss.Dead) return;
            var d = Def;
            Erupted++;
            float dmg = boss.MoveDamage(d?.ventDamage ?? 0.6f);
            if (Hazards.Blast(p, d?.ventRadius ?? 2.2f, dmg, new BossBlastOpts { maxHeight = 4f, knockUp = 7.5f, element = Element.Fire, ignoreCover = true }))
                PlayerHits++;
            Fx.Burst(p + Vector3.up * 0.2f, CrackGlow, 8, 4f, 0.5f, 0.15f, 6f);
            // 喷泉：泉床裂口里冲出一根月牙泉水柱（收尾一轮：原来是灰白半透明的汽柱，亮沙上读成一根灰柱子；
            // 改成风格化的泉水——深青水身 / 泉水主色 / 白沫块，柱顶一蓬白沫团和水珠，柱脚一圈水花团 + 白沫涟漪圈）
            float r = Def?.ventRadius ?? 2.2f;
            Fx.SpringSpout(p, r * 0.45f, 6.5f, 0.6f, 3.4f);
            CameraShake.Quake(p, 0.25f, 18f, 0.25f);
            GameAudio.PlayAt("skill_fire", p + Vector3.up * 0.5f, 0.7f, 1.7f);
            GameAudio.PlayAt("shot_beam", p + Vector3.up * 0.5f, 0.35f, 1.9f);
            // 喷着的时候柱顶再翻几蓬白沫
            Hazards.Repeat(0.3f, PlumeSeconds, () => Fx.Play("SpringSplash", p + Vector3.up * Random.Range(4.2f, 5.6f), Vector3.up, Fx.SpringMain, 0.6f));
        }

        /// <summary>首领倒下：裂缝熄掉（裂口的预警 / 喷发由危险物清场取消）</summary>
        public void End()
        {
            if (root) Object.Destroy(root.gameObject);
            glows.Clear();
        }
    }
}
