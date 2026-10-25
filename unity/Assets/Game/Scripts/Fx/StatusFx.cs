using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 状态外观（FX2「身体着色（MPB）+ 骨骼上挂粒子」，取代 F1 之前的那一张光晕面片）。敌人第一次挂上状态时由 FxDirector 加上，每帧读 EnemyStatus：
    ///   灼烧：身体染橙、随层数加深并跳动；骨骼上往上窜火舌（每层更多）+ 零星火星；
    ///   感电：一闪一闪的蓝白（随机频闪）；骨骼上噼啪的电弧碎纹 + 轻拉丝电火花，偶尔在两根骨头之间劈一道小闪电（全场限流）；
    ///   蚀化：身体泛绿、缓慢起伏；骨骼上往下滴蚀液 + 冒绿泡；
    ///   眩晕：淡黄；头顶三颗绕圈的小金星；
    ///   减速（冻）：冰白（不是雷蓝：两者原来几乎同色相，远处分不开），身上闪冰晶星芒、往下飘冰晶光点和细雪；
    /// 着色走 EnemyBody 的覆盖色通道「status」（多个状态按强度混色，受击闪白更强时盖过它）；粒子发进共享发射器，
    /// 全场每帧上限 <see cref="FxBudget.StatusEmitPerFrame"/>，再乘画质密度。死亡 / 状态全部结束时清掉着色、停发。
    /// 颜色全部是 Three.js 的元素色（<see cref="Fx.ElementColor"/>）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StatusFx : MonoBehaviour
    {
        const string Channel = "status";
        /// <summary>减速的冰白：比雷元素的天蓝（6fd8ff）白得多，靠明度和冰晶星芒区分</summary>
        static readonly Color StunColor = Hex.Rgb(0xffe27a), FrostColor = Hex.Rgb(0xdff5ff);
        /// <summary>小闪电（两根骨头之间）全场每秒最多几道</summary>
        const float ArcsPerSecond = 8f;

        static int budgetFrame = -1, budgetLeft;
        static float arcTokens;
        static int arcFrame = -1;

        Damageable hp;
        EnemyBody body;
        EnemyStatus status;
        Transform[] bones;
        Transform head;
        Collider col;
        float flameAcc, sparkAcc, crackAcc, dropAcc, frostAcc, glintAcc, snowAcc, arcAcc, flicker, flickerT, starPhase;
        bool tinted;
        float phaseSeed;

        /// <summary>此刻在显示的状态（测试用）</summary>
        public StatusMask Showing { get; private set; }

        /// <summary>挂上（已有就返回 false）</summary>
        public static bool Ensure(Damageable d)
        {
            if (!d || d.TryGetComponent(out StatusFx _)) return false;
            if (!d.GetComponent<EnemyBody>()) return false;
            d.gameObject.AddComponent<StatusFx>();
            return true;
        }

        void Awake()
        {
            hp = GetComponent<Damageable>();
            body = GetComponent<EnemyBody>();
            col = GetComponent<Collider>();
            phaseSeed = Random.value * 10f;
            CollectBones();
        }

        /// <summary>粒子挂点：蒙皮网格的骨骼（去掉根骨、手指脚趾这类太小太密的末端靠随机均摊），没有骨骼时用碰撞体包围盒</summary>
        void CollectBones()
        {
            var set = new HashSet<Transform>();
            foreach (var smr in GetComponentsInChildren<SkinnedMeshRenderer>())
                foreach (var b in smr.bones)
                    if (b && b != smr.rootBone) set.Add(b);
            bones = new Transform[set.Count];
            set.CopyTo(bones);
            var anim = body ? body.Animator : null;
            head = anim && anim.isHuman ? anim.GetBoneTransform(HumanBodyBones.Head) : null;
            if (!head)
                foreach (var b in bones)
                    if (b.name.ToLowerInvariant().Contains("head"))
                    {
                        head = b;
                        break;
                    }
        }

        Vector3 RandomPoint()
        {
            if (bones != null && bones.Length > 0)
            {
                var b = bones[Random.Range(0, bones.Length)];
                if (b) return b.position + Random.insideUnitSphere * 0.08f;
            }
            if (col && col.enabled)
            {
                var bb = col.bounds;
                return new Vector3(Random.Range(bb.min.x, bb.max.x), Random.Range(bb.min.y, bb.max.y), Random.Range(bb.min.z, bb.max.z));
            }
            return transform.position + Vector3.up + Random.insideUnitSphere * 0.4f;
        }

        Vector3 HeadTop()
        {
            if (head) return head.position + Vector3.up * 0.35f;
            if (col && col.enabled) return new Vector3(col.bounds.center.x, col.bounds.max.y + 0.25f, col.bounds.center.z);
            return transform.position + Vector3.up * 2f;
        }

        /// <summary>全场共享的每帧发射预算：返回这次能发几颗</summary>
        static int Take(int want)
        {
            if (Time.frameCount != budgetFrame)
            {
                budgetFrame = Time.frameCount;
                budgetLeft = FxBudget.StatusEmitPerFrame;
            }
            int n = Mathf.Min(want, budgetLeft);
            budgetLeft -= n;
            return n;
        }

        void LateUpdate()
        {
            if (!status) status = GetComponent<EnemyStatus>();
            if (!hp || hp.Dead || !status)
            {
                Clear();
                if (!hp || hp.Dead) enabled = false;
                return;
            }
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            var mask = status.Mask;
            bool burn = status.Burning, shock = status.Shocked, corrode = status.Corroded, stun = status.Stunned;
            bool frost = status.SlowMult < 0.95f && !corrode;
            Showing = mask;
            if (!burn && !shock && !corrode && !stun && !frost)
            {
                Clear();
                return;
            }
            Tint(burn, shock, corrode, stun, frost, dt);
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float density = Fx.Density;
            if (burn) Burn(rt, status.BurnStacks, dt, density);
            if (shock) Shock(rt, status.ShockStacks, dt, density);
            if (corrode) Corrode(rt, dt, density);
            if (stun) Stun(rt, dt);
            if (frost) Frost(rt, dt, density);
        }

        // ───────────── 着色 ─────────────

        void Tint(bool burn, bool shock, bool corrode, bool stun, bool frost, float dt)
        {
            float t = Time.time;
            Color sum = Color.black;
            float w = 0, amount = 0;
            void Add(Color c, float a)
            {
                sum += c * a;
                w += a;
                amount = Mathf.Max(amount, a);
            }
            if (burn) Add(Fx.ElementColor(Element.Fire), 0.2f + 0.06f * status.BurnStacks + 0.08f * Mathf.Sin(t * 13f + phaseSeed));
            if (shock)
            {
                // 随机频闪：每 0.05–0.12 s 换一次亮度
                flickerT -= dt;
                if (flickerT <= 0)
                {
                    flickerT = Random.Range(0.05f, 0.12f);
                    // 频闪拉开明暗：亮的那一下接近满色，暗的时候几乎不染——「一闪一闪」本身就是感电的识别特征
                    flicker = Random.value < 0.4f ? Random.Range(0.5f, 0.75f) : Random.Range(0.05f, 0.14f);
                }
                Add(Fx.ElementColor(Element.Shock), flicker);
            }
            if (corrode) Add(Fx.ElementColor(Element.Corrode), 0.22f + 0.06f * Mathf.Sin(t * 4f));
            if (stun) Add(StunColor, 0.14f + 0.06f * Mathf.Sin(t * 9f));
            if (frost) Add(FrostColor, 0.34f);
            if (w <= 0)
            {
                Clear();
                return;
            }
            var c = sum / w;
            c.a = 1;
            body.SetOverlay(Channel, c, Mathf.Clamp01(amount));
            tinted = true;
        }

        void Clear()
        {
            Showing = StatusMask.None;
            if (!tinted || !body) return;
            body.ClearOverlay(Channel);
            tinted = false;
        }

        void OnDisable() => Clear();

        // ───────────── 粒子 ─────────────

        void Burn(FxRuntime rt, int stacks, float dt, float density)
        {
            flameAcc += dt * (9f + 7f * stacks) * density;
            int n = Take((int)flameAcc);
            flameAcc -= (int)flameAcc;
            var flame = n > 0 ? rt.GetEmitter("Flame") : null;
            var fire = Fx.ElementColor(Element.Fire);
            var hot = Hex.Rgb(0xffd24a);
            for (int i = 0; i < n && flame != null; i++)
            {
                var c = Color.Lerp(fire, hot, Random.value * 0.6f);
                rt.EmitOne(flame, RandomPoint(), new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.4f, 1.1f), Random.Range(-0.2f, 0.2f)),
                    Random.Range(0.3f, 0.48f) * (0.85f + 0.1f * stacks), Random.Range(0.35f, 0.6f), c, 0);
            }
            sparkAcc += dt * 3f * stacks * density;
            int m = Take((int)sparkAcc);
            sparkAcc -= (int)sparkAcc;
            var ember = m > 0 ? rt.GetEmitter("Ember") : null;
            for (int i = 0; i < m && ember != null; i++)
                rt.EmitOne(ember, RandomPoint(), new Vector3(Random.Range(-0.6f, 0.6f), Random.Range(1.2f, 2.6f), Random.Range(-0.6f, 0.6f)),
                    Random.Range(0.05f, 0.09f), Random.Range(0.5f, 0.9f), hot, 0);
        }

        void Shock(FxRuntime rt, int stacks, float dt, float density)
        {
            var blue = Fx.ElementColor(Element.Shock);
            crackAcc += dt * (6f + 3f * stacks) * density;
            int n = Take((int)crackAcc);
            crackAcc -= (int)crackAcc;
            var crack = n > 0 ? rt.GetEmitter("Crackle") : null;
            var streak = n > 0 ? rt.GetEmitter("StreakLight") : null;
            for (int i = 0; i < n; i++)
            {
                var p = RandomPoint();
                if (crack != null) rt.EmitOne(crack, p, Vector3.zero, Random.Range(0.4f, 0.65f), Random.Range(0.09f, 0.16f), Color.Lerp(blue, Color.white, 0.5f), 0);
                if (streak != null && Random.value < 0.6f)
                    rt.EmitOne(streak, p, Random.onUnitSphere * Random.Range(2f, 4.5f), 0.035f, Random.Range(0.08f, 0.16f), blue, 0);
            }
            // 两根骨头之间劈小闪电（全场限流：闪电池只有 40 道）——一秒一两道才认得出是「电」
            arcAcc += dt * (1.4f + 0.7f * stacks);
            if (arcAcc < 1 || bones == null || bones.Length < 2) return;
            arcAcc = 0;
            if (Time.frameCount != arcFrame)
            {
                arcFrame = Time.frameCount;
                arcTokens = Mathf.Min(ArcsPerSecond, arcTokens + dt * ArcsPerSecond);
            }
            if (arcTokens < 1) return;
            arcTokens -= 1;
            var a = RandomPoint();
            var b = RandomPoint();
            if ((a - b).sqrMagnitude < 0.09f) b = a + Random.onUnitSphere * 0.5f;
            Lightning.Spawn(a, b, Color.Lerp(blue, Color.white, 0.25f), 0.045f);
        }

        void Corrode(FxRuntime rt, float dt, float density)
        {
            var green = Fx.ElementColor(Element.Corrode);
            dropAcc += dt * 12f * density;
            int n = Take((int)dropAcc);
            dropAcc -= (int)dropAcc;
            var drop = n > 0 ? rt.GetEmitter("Drop") : null;
            var bubble = n > 0 ? rt.GetEmitter("GlowRise") : null;
            for (int i = 0; i < n; i++)
            {
                var p = RandomPoint();
                if (Random.value < 0.65f)
                {
                    if (drop != null) rt.EmitOne(drop, p, new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(-0.4f, 0.2f), Random.Range(-0.2f, 0.2f)),
                        Random.Range(0.09f, 0.14f), Random.Range(0.45f, 0.7f), Color.Lerp(green, Color.black, Random.value * 0.25f), 0);
                }
                else if (bubble != null)
                    rt.EmitOne(bubble, p, new Vector3(0, Random.Range(0.3f, 0.8f), 0), Random.Range(0.1f, 0.18f), Random.Range(0.35f, 0.55f), green, 0);
            }
        }

        void Stun(FxRuntime rt, float dt)
        {
            // 每帧在头顶的圆上补三颗短命的星：连起来就是绕着转的三颗星
            starPhase += dt * 6f;
            int n = Take(3);
            var star = n > 0 ? rt.GetEmitter("Star") : null;
            if (star == null) return;
            var top = HeadTop();
            float r = col ? Mathf.Clamp(Mathf.Max(col.bounds.extents.x, col.bounds.extents.z) * 0.6f, 0.25f, 0.8f) : 0.35f;
            for (int i = 0; i < n; i++)
            {
                float a = starPhase + i * Mathf.PI * 2 / 3;
                var p = top + new Vector3(Mathf.Cos(a) * r, Mathf.Sin(a * 2) * 0.05f, Mathf.Sin(a) * r);
                rt.EmitOne(star, p, Vector3.zero, 0.16f, Mathf.Max(0.04f, dt * 1.6f), StunColor, 0);
            }
        }

        void Frost(FxRuntime rt, float dt, float density)
        {
            frostAcc += dt * 10f * density;
            int n = Take((int)frostAcc);
            frostAcc -= (int)frostAcc;
            var glow = n > 0 ? rt.GetEmitter("GlowFall") : null;
            for (int i = 0; i < n && glow != null; i++)
                rt.EmitOne(glow, RandomPoint(), new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(-0.2f, 0.4f), Random.Range(-0.2f, 0.2f)),
                    Random.Range(0.06f, 0.11f), Random.Range(0.4f, 0.7f), FrostColor, 0);
            // 冰晶星芒（FX3 Twinkle）：贴在身上一闪一闪的白点，远处也读得出「结霜」
            glintAcc += dt * 5f * density;
            int g = Take((int)glintAcc);
            glintAcc -= (int)glintAcc;
            var tw = g > 0 ? rt.GetEmitter("Twinkle") : null;
            for (int i = 0; i < g && tw != null; i++)
                rt.EmitOne(tw, RandomPoint(), Vector3.zero, Random.Range(0.14f, 0.22f), Random.Range(0.25f, 0.4f), Color.white, 0);
            // 细雪（FX3 Snow）：从身上往下飘
            snowAcc += dt * 3f * density;
            int sn = Take((int)snowAcc);
            snowAcc -= (int)snowAcc;
            var snow = sn > 0 ? rt.GetEmitter("Snow") : null;
            for (int i = 0; i < sn && snow != null; i++)
                rt.EmitOne(snow, RandomPoint(), new Vector3(Random.Range(-0.15f, 0.15f), -0.35f, Random.Range(-0.15f, 0.15f)),
                    Random.Range(0.05f, 0.08f), Random.Range(0.8f, 1.2f), FrostColor, 0);
        }
    }
}
