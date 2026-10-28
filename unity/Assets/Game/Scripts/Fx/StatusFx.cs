using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 状态外观（FX2「身体着色（MPB）+ 骨骼上挂粒子」；特效打磨 B 路加了状态皮、身上的真火、贴骨电弧）。敌人第一次挂上状态时由 FxDirector 加上，每帧读 EnemyStatus：
    ///   灼烧：身体染橙、随层数加深并跳动；几根骨头上挂真的火舌（<see cref="FlameTongue"/>，层数越多越多、越高）+ 卡通火苗粒子 + 零星火星；皮上发亮的炭火裂纹；
    ///   感电：一闪一闪的蓝白；电弧沿着骨骼链（一根骨头 → 父骨 → 父骨…）贴着身体跳（<see cref="Lightning.Chain"/>）+ 电弧碎纹 + 电火花；皮上乱窜的电纹；
    ///   蚀化：身体泛绿、缓慢起伏；皮上一块块腐蚀斑（暗绿芯 + 亮酸绿边、冒泡）、往下淌的蚀液条纹；骨骼上往下滴蚀液 + 冒绿泡；
    ///   眩晕：淡黄；头顶三颗绕圈的大金星（拖着光尾）；
    ///   减速（冻）：冰白；从脚往上长的冰壳（皮，按减速强度长多高）+ 冰晶星芒 + 冰晶光点 + 细雪。
    /// 远处读颜色：状态皮自带一圈状态色的 HDR 轮廓光（火橙红 / 雷天蓝闪烁 / 蚀酸绿 / 眩晕金黄 / 冻冰白），15–20 m 外只看剪影边的颜色也分得清。
    /// 着色走 EnemyBody 的覆盖色通道「status」（多个状态按强度混色，受击闪白更强时盖过它）；粒子发进共享发射器，
    /// 全场每帧上限 <see cref="FxBudget.StatusEmitPerFrame"/>，再乘画质密度；状态皮 / 火舌 / 贴骨电弧各有全场上限。死亡 / 状态全部结束时清掉。
    /// 颜色全部是 Three.js 的元素色（<see cref="Fx.ElementColor"/>）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StatusFx : MonoBehaviour
    {
        const string Channel = "status";
        /// <summary>减速的冰白：比雷元素的天蓝（6fd8ff）白得多，靠明度和冰晶星芒区分</summary>
        // 风格审查：冻住的身上染冰蓝（原来近白，整只怪刷白），轮廓光也收到元素色表的冰蓝 / 鲜绿，不发白
        static readonly Color StunColor = Hex.Rgb(0xffe27a), FrostColor = Hex.Rgb(0x9fd2f2);
        /// <summary>贴骨电弧全场每秒最多几道</summary>
        const float ArcsPerSecond = 16f;
        /// <summary>身上一个敌人最多几片火舌</summary>
        const int MaxTongues = 5;

        // 轮廓光（线性 HDR）：远处只看颜色就分得清
        static readonly Color RimBurn = new(2.4f, 0.62f, 0.1f), RimShock = new(0.3f, 0.95f, 3.2f), RimCorrode = new(0.5f, 1.35f, 0.1f),
            RimStun = new(2.2f, 1.7f, 0.25f), RimFrost = new(0.55f, 1.15f, 1.9f);

        static int budgetFrame = -1, budgetLeft;
        static float arcTokens;
        static int arcFrame = -1;
        static int tonguesLive;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            budgetFrame = arcFrame = -1;
            budgetLeft = 0;
            arcTokens = 0;
            tonguesLive = 0;
            Lean = false;
        }

        /// <summary>
        /// 精简外观（压力测试做对照用，也可以当低配开关）：不挂状态皮、不挂身上火舌、电弧退回随机两点——即 B 路打磨之前的样子
        /// </summary>
        public static bool Lean;

        /// <summary>全场身上火舌上限：高 40 / 中 30 / 低 20</summary>
        public static int TongueCap => Mathf.Max(12, Mathf.RoundToInt(40 * FxBudget.StyleCapScale));

        Damageable hp;
        EnemyBody body;
        EnemyStatus status;
        Transform[] bones;
        Transform[] parentOf;
        Transform head;
        Collider col;
        float flameAcc, sparkAcc, crackAcc, dropAcc, frostAcc, glintAcc, snowAcc, arcAcc, flicker, flickerT, starPhase, starTrailAcc;
        bool tinted;
        float phaseSeed;

        readonly StatusSkin skin = new();
        Vector4 skinAmt;
        float stunAmt;
        readonly List<(FlameTongue t, Transform bone, float phase)> tongues = new();
        int tonguesShown;
        static readonly Vector3[] chain = new Vector3[6];

        /// <summary>此刻在显示的状态（测试用）</summary>
        public StatusMask Showing { get; private set; }

        /// <summary>状态皮是否挂着（测试用）</summary>
        public bool SkinShowing => skin.Showing;

        /// <summary>身上亮着的火舌片数（测试用）</summary>
        public int TonguesShowing => tonguesShown;

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

        void OnDestroy()
        {
            HideTongues(true);
        }

        /// <summary>粒子挂点：蒙皮网格的骨骼（去掉根骨、手指脚趾这类太小太密的末端靠随机均摊），没有骨骼时用碰撞体包围盒</summary>
        void CollectBones()
        {
            var set = new HashSet<Transform>();
            foreach (var smr in GetComponentsInChildren<SkinnedMeshRenderer>())
                foreach (var b in smr.bones)
                    if (b && b != smr.rootBone)
                        set.Add(b);
            bones = new Transform[set.Count];
            set.CopyTo(bones);
            // 骨骼链：每根骨头在集合里的父骨（贴骨电弧沿着它走）
            parentOf = new Transform[bones.Length];
            for (int i = 0; i < bones.Length; i++)
            {
                var p = bones[i].parent;
                parentOf[i] = p && set.Contains(p) ? p : null;
            }
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

        float BodyHeight => col && col.enabled ? Mathf.Clamp(col.bounds.size.y, 0.4f, 8f) : 1.6f;

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
            if (Lean)
            {
                skin.Hide();
                HideTongues(false);
            }
            else UpdateSkin(burn, shock, corrode, stun, frost, dt);
            if (!burn && !shock && !corrode && !stun && !frost)
            {
                ClearTint();
                HideTongues(false);
                return;
            }
            Tint(burn, shock, corrode, stun, frost, dt);
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float density = Fx.Density;
            if (burn) Burn(rt, status.BurnStacks, dt, density);
            if (!burn || Lean) HideTongues(false);
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
            if (burn) Add(Fx.ElementColor(Element.Fire), 0.16f + 0.05f * status.BurnStacks + 0.07f * Mathf.Sin(t * 13f + phaseSeed));
            if (shock)
            {
                // 随机频闪：每 0.05–0.12 s 换一次亮度
                flickerT -= dt;
                if (flickerT <= 0)
                {
                    flickerT = Random.Range(0.05f, 0.12f);
                    // 频闪拉开明暗：亮的那一下接近满色，暗的时候几乎不染——「一闪一闪」本身就是感电的识别特征
                    // B 路：亮的那一下也不染满（身上的电纹和蓝色轮廓光接手辨认），免得整个人刷成浅蓝、和冻住的冰白混在一起
                    flicker = Random.value < 0.4f ? Random.Range(0.32f, 0.48f) : Random.Range(0.04f, 0.1f);
                }
                Add(Fx.ElementColor(Element.Shock), flicker);
            }
            if (corrode) Add(Fx.ElementColor(Element.Corrode), 0.2f + 0.05f * Mathf.Sin(t * 4f));
            if (stun) Add(StunColor, 0.14f + 0.06f * Mathf.Sin(t * 9f));
            if (frost) Add(FrostColor, 0.3f);
            if (w <= 0)
            {
                ClearTint();
                return;
            }
            var c = sum / w;
            c.a = 1;
            body.SetOverlay(Channel, c, Mathf.Clamp01(amount));
            tinted = true;
        }

        void ClearTint()
        {
            if (!tinted || !body) return;
            body.ClearOverlay(Channel);
            tinted = false;
        }

        void Clear()
        {
            Showing = StatusMask.None;
            ClearTint();
            skinAmt = Vector4.zero;
            stunAmt = 0;
            skin.Hide();
            HideTongues(false);
        }

        void OnDisable() => Clear();

        // ───────────── 状态皮 ─────────────

        void UpdateSkin(bool burn, bool shock, bool corrode, bool stun, bool frost, float dt)
        {
            // 目标强度：冰按减速强度（减速 50% = 冻满），火 / 雷按层数
            var want = new Vector4(
                frost ? Mathf.Clamp01((1 - status.SlowMult) / 0.5f) : 0,
                corrode ? 1 : 0,
                shock ? Mathf.Clamp01(0.65f + 0.15f * status.ShockStacks) : 0,
                burn ? Mathf.Clamp01(0.5f + 0.17f * status.BurnStacks) : 0);
            float up = 1 - Mathf.Exp(-6f * dt), down = 1 - Mathf.Exp(-3f * dt);
            for (int i = 0; i < 4; i++) skinAmt[i] = Mathf.Lerp(skinAmt[i], want[i], want[i] > skinAmt[i] ? up : down);
            stunAmt = Mathf.Lerp(stunAmt, stun ? 1 : 0, stun ? up : down);
            float max = Mathf.Max(Mathf.Max(skinAmt.x, skinAmt.y), Mathf.Max(Mathf.Max(skinAmt.z, skinAmt.w), stunAmt));
            if (max < 0.01f)
            {
                skin.Hide();
                return;
            }
            if (!skin.Showing && !skin.Show(gameObject)) return;
            // 轮廓光：按强度混色；雷跟着频闪
            Color rim = Color.black;
            float wsum = 0;
            void Add(Color c, float a)
            {
                rim += c * a;
                wsum += a;
            }
            Add(RimFrost, skinAmt.x);
            Add(RimCorrode, skinAmt.y);
            Add(RimShock, skinAmt.z * (0.35f + 1.3f * flicker));
            Add(RimBurn, skinAmt.w * (0.85f + 0.15f * Mathf.Sin(Time.time * 13f + phaseSeed)));
            Add(RimStun, stunAmt);
            if (wsum > 0) rim /= Mathf.Max(1, wsum);
            rim.a = 1.0f * max;
            float h = BodyHeight;
            float ground = col && col.enabled ? col.bounds.min.y : transform.position.y;
            skin.Write(skinAmt, new Vector4(stunAmt, phaseSeed, ground, 1f / h), rim);
        }

        // ───────────── 粒子 / 火舌 / 电弧 ─────────────

        void Burn(FxRuntime rt, int stacks, float dt, float density)
        {
            if (!Lean) ShowTongues(stacks);
            flameAcc += dt * (6f + 5f * stacks) * density;
            int n = Take((int)flameAcc);
            flameAcc -= (int)flameAcc;
            var flame = n > 0 ? rt.GetEmitter("ToonFlame") ?? rt.GetEmitter("Flame") : null;
            var fire = Fx.ElementColor(Element.Fire);
            var hot = Hex.Rgb(0xffd24a);
            float hk = Mathf.Clamp(BodyHeight / 1.6f, 0.6f, 2.5f);
            for (int i = 0; i < n && flame != null; i++)
            {
                var c = Color.Lerp(fire, hot, Random.value * 0.4f);
                rt.EmitOne(flame, RandomPoint(), new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.5f, 1.2f), Random.Range(-0.2f, 0.2f)),
                    Random.Range(0.32f, 0.5f) * (0.85f + 0.1f * stacks) * hk, Random.Range(0.4f, 0.65f), c, 0);
            }
            sparkAcc += dt * 3f * stacks * density;
            int m = Take((int)sparkAcc);
            sparkAcc -= (int)sparkAcc;
            var ember = m > 0 ? rt.GetEmitter("Ember") : null;
            for (int i = 0; i < m && ember != null; i++)
                rt.EmitOne(ember, RandomPoint(), new Vector3(Random.Range(-0.6f, 0.6f), Random.Range(1.2f, 2.6f), Random.Range(-0.6f, 0.6f)),
                    Random.Range(0.05f, 0.09f), Random.Range(0.5f, 0.9f), hot, 0);
        }

        /// <summary>身上的真火：几根骨头上挂火舌（按身高排开，层数越多片数越多、越高）</summary>
        void ShowTongues(int stacks)
        {
            if (bones == null || bones.Length == 0) return;
            if (tongues.Count == 0)
            {
                // 选骨：按世界高度排序，取身体中上部的几根（腰、背、肩、头附近），左右错开
                var sorted = new List<Transform>(bones);
                sorted.RemoveAll(b => !b);
                if (sorted.Count == 0) return;
                sorted.Sort((a, b) => a.position.y.CompareTo(b.position.y));
                float[] q = { 0.45f, 0.62f, 0.78f, 0.9f, 0.55f };
                for (int i = 0; i < MaxTongues; i++)
                {
                    var bone = sorted[Mathf.Clamp(Mathf.RoundToInt(q[i] * (sorted.Count - 1)), 0, sorted.Count - 1)];
                    var t = FlameTongue.Attach(bone, Vector3.zero, Vector3.one * 0.01f);
                    if (!t) break;
                    t.Set(0);
                    tongues.Add((t, bone, Random.value * 10f));
                }
            }
            int want = Mathf.Clamp(2 + stacks, 2, MaxTongues);
            int allow = Mathf.Max(0, TongueCap - tonguesLive + tonguesShown);
            want = Mathf.Min(want, allow);
            float h = BodyHeight;
            float now = Time.time;
            float alpha = Mathf.Clamp01(skinAmt.w * 1.6f);
            int shown = 0;
            for (int i = 0; i < tongues.Count; i++)
            {
                var (t, bone, phase) = tongues[i];
                if (!t) continue;
                if (i >= want)
                {
                    t.Set(0);
                    continue;
                }
                float flick = 1 + 0.14f * Mathf.Sin(now * 13f + phase) + 0.08f * Mathf.Sin(now * 29f + phase * 2);
                float size = h * (0.42f + 0.05f * stacks) * (i == 0 ? 1.15f : 0.85f + 0.1f * (i % 2));
                t.Set(alpha, new Vector3(size * 0.95f, size * flick, size));
                shown++;
            }
            tonguesLive += shown - tonguesShown;
            tonguesShown = shown;
        }

        void HideTongues(bool destroying)
        {
            foreach (var (t, _, _) in tongues)
                if (t)
                    t.Set(0);
            tonguesLive = Mathf.Max(0, tonguesLive - tonguesShown);
            tonguesShown = 0;
        }

        void Shock(FxRuntime rt, int stacks, float dt, float density)
        {
            var blue = Fx.ElementColor(Element.Shock);
            crackAcc += dt * (5f + 2.5f * stacks) * density;
            int n = Take((int)crackAcc);
            crackAcc -= (int)crackAcc;
            var crack = n > 0 ? rt.GetEmitter("Crackle") : null;
            var streak = n > 0 ? rt.GetEmitter("StreakLight") : null;
            for (int i = 0; i < n; i++)
            {
                var p = RandomPoint();
                if (crack != null) rt.EmitOne(crack, p, Vector3.zero, Random.Range(0.4f, 0.65f), Random.Range(0.09f, 0.16f), Color.Lerp(blue, Color.white, 0.5f), 0);
                if (streak != null && Random.value < 0.5f)
                    rt.EmitOne(streak, p, Random.onUnitSphere * Random.Range(2f, 4.5f), 0.035f, Random.Range(0.08f, 0.16f), blue, 0);
            }
            // 贴骨电弧：一秒三四道，沿骨骼链跳（全场限流）
            arcAcc += dt * (2.6f + 1.2f * stacks);
            if (arcAcc < 1 || bones == null || bones.Length < 2) return;
            arcAcc = 0;
            if (Time.frameCount != arcFrame)
            {
                arcFrame = Time.frameCount;
                arcTokens = Mathf.Min(ArcsPerSecond, arcTokens + dt * ArcsPerSecond);
            }
            if (arcTokens < 1) return;
            arcTokens -= 1;
            int count = Lean ? 0 : BoneChain(Random.Range(3, 6));
            var c = Color.Lerp(blue, Color.white, 0.3f);
            if (count >= 2) Lightning.Chain(chain, count, c, 0.045f);
            else
            {
                var a = RandomPoint();
                Lightning.Spawn(a, a + Random.onUnitSphere * 0.5f, c, 0.045f);
            }
        }

        /// <summary>从一根随机骨头沿父骨往上走，最多 want 个点（贴着皮肤稍微往外偏一点）；返回点数</summary>
        int BoneChain(int want)
        {
            for (int attempt = 0; attempt < 4; attempt++)
            {
                int i = Random.Range(0, bones.Length);
                var b = bones[i];
                if (!b) continue;
                int n = 0;
                var center = col && col.enabled ? col.bounds.center : transform.position + Vector3.up;
                Vector3 last = Vector3.positiveInfinity;
                int idx = i;
                while (b && n < want)
                {
                    var p = b.position;
                    // 相邻两点太近（手指、脊椎的细分骨）就跳过
                    if (n == 0 || (p - last).sqrMagnitude > 0.012f)
                    {
                        var outDir = p - center;
                        outDir.y = 0;
                        chain[n++] = p + (outDir.sqrMagnitude > 1e-4f ? outDir.normalized * 0.05f : Vector3.zero);
                        last = p;
                    }
                    var parent = parentOf[idx];
                    if (!parent) break;
                    idx = System.Array.IndexOf(bones, parent);
                    if (idx < 0) break;
                    b = parent;
                }
                if (n >= 2) return n;
            }
            return 0;
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
                    if (drop != null)
                        rt.EmitOne(drop, p, new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(-0.4f, 0.2f), Random.Range(-0.2f, 0.2f)),
                            Random.Range(0.1f, 0.16f), Random.Range(0.45f, 0.7f), Color.Lerp(green, Color.black, Random.value * 0.25f), 0);
                }
                else if (bubble != null)
                    rt.EmitOne(bubble, p, new Vector3(0, Random.Range(0.3f, 0.8f), 0), Random.Range(0.1f, 0.18f), Random.Range(0.35f, 0.55f), green, 0);
            }
        }

        void Stun(FxRuntime rt, float dt)
        {
            // 每帧在头顶的圆上补三颗短命的大星：连起来就是绕着转的三颗星；再每隔一会儿留一颗淡淡的光点当尾巴
            starPhase += dt * 6f;
            int n = Take(3);
            var star = n > 0 ? rt.GetEmitter("Star") : null;
            if (star == null) return;
            var top = HeadTop();
            float r = col ? Mathf.Clamp(Mathf.Max(col.bounds.extents.x, col.bounds.extents.z) * 0.7f, 0.3f, 0.9f) : 0.4f;
            float size = Mathf.Clamp(BodyHeight * 0.16f, 0.22f, 0.5f);
            var hot = Hex.Rgb(0xffd848);
            // 星尾的光点少一点（风格审查：一串细碎的柔光点）
            starTrailAcc += dt * 12f;
            var trail = starTrailAcc >= 1 ? rt.GetEmitter("Glow") : null;
            bool emitTrail = starTrailAcc >= 1;
            if (emitTrail) starTrailAcc -= 1;
            for (int i = 0; i < n; i++)
            {
                float a = starPhase + i * Mathf.PI * 2 / 3;
                var p = top + new Vector3(Mathf.Cos(a) * r, Mathf.Sin(a * 2) * 0.06f, Mathf.Sin(a) * r);
                rt.EmitOne(star, p, Vector3.zero, size, Mathf.Max(0.04f, dt * 1.6f), hot, 0);
                if (emitTrail && trail != null) rt.EmitOne(trail, p, Vector3.zero, size * 0.9f, 0.22f, StunColor, 0);
            }
        }

        void Frost(FxRuntime rt, float dt, float density)
        {
            frostAcc += dt * 4f * density;
            int n = Take((int)frostAcc);
            frostAcc -= (int)frostAcc;
            var glow = n > 0 ? rt.GetEmitter("GlowFall") : null;
            for (int i = 0; i < n && glow != null; i++)
                rt.EmitOne(glow, RandomPoint(), new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(-0.2f, 0.4f), Random.Range(-0.2f, 0.2f)),
                    Random.Range(0.06f, 0.11f), Random.Range(0.4f, 0.7f), FrostColor, 0);
            // 冰晶星芒（FX3 Twinkle）：贴在身上一闪一闪的白点，远处也读得出「结霜」
            glintAcc += dt * 2f * density;
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
