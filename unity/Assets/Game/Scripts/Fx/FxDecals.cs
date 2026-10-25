using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>贴花图集 T_Fx_DecalAtlas 的格子（4 × 2，第 0 格在左上），见 <see cref="FxTextures.DecalAtlas"/></summary>
    public enum FxDecalKind
    {
        /// <summary>石面弹坑：黑芯、焦边、放射裂纹</summary>
        HoleStone = 0,
        /// <summary>沙面浅坑：软凹 + 翻起的亮沙边</summary>
        HoleSand = 1,
        /// <summary>冰面：小黑点 + 崩白 + 星状白裂纹</summary>
        HoleIce = 2,
        /// <summary>金属：浅坑 + 亮擦痕 + 烧红的芯</summary>
        HoleMetal = 3,
        /// <summary>爆炸焦痕（带零星火星）</summary>
        Scorch = 4,
        /// <summary>蚀液溅痕（发绿光的液面）</summary>
        Splat = 5,
        /// <summary>地裂（缝里发红）</summary>
        Crack = 6,
        /// <summary>霜斑</summary>
        Frost = 7,
    }

    /// <summary>
    /// 战斗贴花池（FX1 弹孔 / 焦痕，FX2 熔池 / 出生法阵 / 归墟涡旋）：池化的 URP DecalProjector + 共享材质（SF_FxDecal，见着色器头注释）。
    /// 每个投影器的参数（格号、余热、颜色、进度）写进 DecalProjector 的 fadeFactor / uvScale / uvBias，着色器从 _NormalToWorld 里读，
    /// 所以同一种贴花只有一份材质、能合批；参数只在变化超过阈值时才写（写一次 = 贴花系统更新一次这个实体）。
    ///   弹孔：寿命 11 s，余热 1 s 内冷却，最后 2 s 淡出；上限按画质（低 40 / 中 80 / 高 140），满了替换最老的。
    ///   焦痕：寿命 16 s，余热 3 s 冷却。熔池 / 法阵 / 涡旋：句柄可取消（0.15 s 淡出），熔池和涡旋自己往外冒粒子（余烬 / 收拢的三色光点）。
    /// 渲染器没有贴花特性、或材质缺失时什么都不画（纯装饰）。换关清场。
    /// </summary>
    public sealed class FxDecals : MonoBehaviour
    {
        public const float HoleLife = 11f, ScorchLife = 16f, FadeOutTime = 2f;
        const int MaxGround = 32;

        internal sealed class Slot : FxSlot
        {
            public FxDecals owner;
            public GameObject go;
            public DecalProjector proj;
            public FxMaterialKind kind;
            public float age, life, fadeOut, heat0, coolRate, radius, emitAcc, seed;
            public int cell, glow;
            public float sandMix;
            public Color color;
            public Vector3 center;
            public Vector4 sent = new(float.NaN, 0, 0, 0);
            public float sentFade = -1;
            public int stamp;

            public override void CancelFx()
            {
                if (!active) return;
                life = Mathf.Min(life, age + 0.15f);
                fadeOut = Mathf.Min(fadeOut, 0.15f);
            }

            public override void MoveFx(Vector3 position)
            {
                center = position;
                if (go) go.transform.position = position;
            }
        }

        static FxDecals instance;
        readonly List<Slot> sprites = new(), ground = new();
        int stamp;

        static FxDecals Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<FxDecals>();
            return instance;
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        /// <summary>当前画质下同时存在的弹孔 / 焦痕上限</summary>
        public static int SpriteCap => FxBudget.DecalCap;

        /// <summary>此刻亮着的贴花数（统计用）</summary>
        public static int ActiveCount
        {
            get
            {
                if (!instance) return 0;
                int n = 0;
                foreach (var s in instance.sprites) if (s.active) n++;
                foreach (var s in instance.ground) if (s.active) n++;
                return n;
            }
        }

        /// <summary>此刻亮着的某一格贴花数（测试用：爆炸留没留焦痕）</summary>
        public static int ActiveOf(FxDecalKind cell)
        {
            if (!instance) return 0;
            int n = 0;
            foreach (var s in instance.sprites)
                if (s.active && s.cell == (int)cell)
                    n++;
            return n;
        }

        static bool Usable(FxMaterialKind kind) => Telegraph.DecalsSupported && FxMaterials.Decal(kind);

        // ───────────── 入口 ─────────────

        /// <summary>弹孔：按地表选格；size = 直径（米）；heat = 初始余热 0..1（金属、石头发红，冰不发光）</summary>
        public static FxHandle Hole(Vector3 point, Vector3 normal, float size, SurfaceKind surface, float heat = 0.8f)
        {
            var (cell, glow, sand) = surface switch
            {
                SurfaceKind.Sand => (FxDecalKind.HoleSand, 0, 1f),
                SurfaceKind.Ice => (FxDecalKind.HoleIce, 1, 0f),
                SurfaceKind.Metal => (FxDecalKind.HoleMetal, 0, 0f),
                _ => (FxDecalKind.HoleStone, 0, 0.35f),
            };
            if (surface == SurfaceKind.Ice) heat = 0;
            return Sprite(cell, point, normal, size, heat, HoleLife, glow, sand, Mathf.Max(0.12f, size * 0.6f), 2.5f);
        }

        /// <summary>焦痕（爆炸）：贴地，直径 diameter 米；投影盒深度随大小加深，坡上也贴得住</summary>
        public static FxHandle Scorch(Vector3 groundPoint, Vector3 normal, float diameter, float heat = 1f, float life = ScorchLife) =>
            Sprite(FxDecalKind.Scorch, groundPoint, normal, diameter, heat, life, 0, 0, Mathf.Clamp(diameter * 0.45f, 0.8f, 5f), 0.8f);

        /// <summary>图集里任意一格（地裂、霜斑、溅痕…）</summary>
        public static FxHandle Sprite(FxDecalKind cell, Vector3 point, Vector3 normal, float size, float heat, float life, int glow, float sandMix,
            float depth, float coolRate)
        {
            if (!Fx.Finite(point) || !(size > 0.01f) || !Usable(FxMaterialKind.DecalSprite)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            var n = normal.sqrMagnitude > 1e-6f ? normal.normalized : Vector3.up;
            var s = self.Take(self.sprites, FxMaterialKind.DecalSprite, Mathf.Max(4, SpriteCap));
            if (s == null) return FxHandle.None;
            s.cell = (int)cell;
            s.glow = glow;
            s.sandMix = sandMix;
            s.heat0 = Mathf.Clamp01(heat);
            s.coolRate = coolRate;
            s.life = life;
            s.fadeOut = Mathf.Min(FadeOutTime, life * 0.3f);
            float sz = size * Random.Range(0.88f, 1.12f);
            Place(s, point, n, new Vector3(sz, sz, depth), Random.value * 360f);
            s.proj.drawDistance = Mathf.Clamp(40f + size * 12f, 50f, 160f);
            self.Push(s);
            return new FxHandle(s);
        }

        /// <summary>熔池（熔金反应）：半径 radius 米、持续 duration 秒；流动的熔铜 + 蚀绿冒泡，往上冒余烬</summary>
        public static FxHandle Pool(Vector3 center, float radius, float duration)
        {
            if (!Fx.Finite(center) || !(radius > 0) || !Usable(FxMaterialKind.DecalPool)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            var s = self.Take(self.ground, FxMaterialKind.DecalPool, MaxGround);
            if (s == null) return FxHandle.None;
            s.life = Mathf.Max(0.3f, duration + 0.35f);
            s.fadeOut = 0.35f;
            s.radius = radius;
            s.seed = Random.value * 10f;
            Place(s, center, Vector3.up, new Vector3(radius * 2.1f, radius * 2.1f, 2.2f), Random.value * 360f);
            self.Push(s);
            return new FxHandle(s);
        }

        /// <summary>出生法阵：半径 radius、敌人色、duration 秒（缓出放大 → 脉动 → 收尾闪一下 → 淡出）</summary>
        public static FxHandle Rune(Vector3 center, float radius, Color color, float duration)
        {
            if (!Fx.Finite(center) || !(radius > 0) || !Usable(FxMaterialKind.DecalRune)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            var s = self.Take(self.ground, FxMaterialKind.DecalRune, MaxGround);
            if (s == null) return FxHandle.None;
            s.life = Mathf.Max(0.2f, duration);
            s.fadeOut = 0.01f;
            s.radius = radius;
            s.color = color;
            Place(s, center, Vector3.up, new Vector3(radius * 2, radius * 2, 1.8f), Random.value * 360f);
            self.Push(s);
            return new FxHandle(s);
        }

        /// <summary>归墟涡旋：三色旋臂向中心收拢、越转越快，同时往中心吸三色光点</summary>
        public static FxHandle Vortex(Vector3 center, float radius, float duration)
        {
            if (!Fx.Finite(center) || !(radius > 0)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            bool decal = Usable(FxMaterialKind.DecalVortex);
            var s = self.Take(self.ground, FxMaterialKind.DecalVortex, MaxGround);
            if (s == null) return FxHandle.None;
            s.life = Mathf.Max(0.2f, duration);
            s.fadeOut = 0.01f;
            s.radius = radius;
            Place(s, center, Vector3.up, new Vector3(radius * 2, radius * 2, 2f), Random.value * 360f);
            if (!decal) s.proj.material = null;
            self.Push(s);
            return new FxHandle(s);
        }

        // ───────────── 槽位 ─────────────

        Slot Take(List<Slot> list, FxMaterialKind kind, int cap)
        {
            Slot free = null, oldest = null;
            foreach (var s in list)
            {
                if (!s.active && s.kind == kind && free == null) free = s;
                if (s.active && (oldest == null || s.stamp < oldest.stamp)) oldest = s;
            }
            int live = 0;
            foreach (var s in list) if (s.active) live++;
            if (live >= cap && oldest != null) free = oldest;
            if (free == null)
            {
                foreach (var s in list)
                    if (!s.active)
                    {
                        free = s;
                        break;
                    }
            }
            if (free == null) free = Make(list);
            if (free.kind != kind || free.proj.material == null)
            {
                free.kind = kind;
                free.proj.material = FxMaterials.Decal(kind);
            }
            free.Claim();
            free.age = 0;
            free.emitAcc = 0;
            free.sent = new Vector4(float.NaN, 0, 0, 0);
            free.sentFade = -1;
            return free;
        }

        Slot Make(List<Slot> list)
        {
            var go = new GameObject("Fx Decal");
            go.transform.SetParent(transform, false);
            var p = go.AddComponent<DecalProjector>();
            p.enabled = false;
            p.pivot = Vector3.zero;
            p.scaleMode = DecalScaleMode.ScaleInvariant;
            p.fadeScale = 0.9f;
            p.startAngleFade = 180;
            p.endAngleFade = 180;
            var s = new Slot { owner = this, go = go, proj = p, kind = (FxMaterialKind)(-1) };
            list.Add(s);
            return s;
        }

        void Push(Slot s)
        {
            s.stamp = ++stamp;
            Write(s);
            // 涡旋在没有贴花支持时只发粒子：投影器不开
            s.proj.enabled = s.proj.material && Telegraph.DecalsSupported;
        }

        static void Place(Slot s, Vector3 point, Vector3 normal, Vector3 size, float roll)
        {
            var up = Mathf.Abs(Vector3.Dot(normal, Vector3.up)) > 0.95f ? Vector3.forward : Vector3.up;
            var rot = Quaternion.LookRotation(-normal, up) * Quaternion.Euler(0, 0, roll);
            s.center = point;
            s.go.transform.SetPositionAndRotation(point, rot);
            s.proj.size = size;
        }

        /// <summary>按年龄算参数，变化超过阈值才写进投影器</summary>
        static void Write(Slot s)
        {
            float t = s.life > 0 ? Mathf.Clamp01(s.age / s.life) : 1;
            float fade = s.fadeOut > 0 ? Mathf.Clamp01((s.life - s.age) / s.fadeOut) : 1;
            Vector4 P;
            switch (s.kind)
            {
                case FxMaterialKind.DecalSprite:
                    P = new Vector4(s.cell, s.heat0 * Mathf.Exp(-s.age * s.coolRate), s.glow, s.sandMix);
                    break;
                case FxMaterialKind.DecalPool:
                    P = new Vector4(t, s.seed, 0, 0);
                    fade = 1;
                    break;
                case FxMaterialKind.DecalRune:
                    P = new Vector4(t, s.color.r, s.color.g, s.color.b);
                    fade = 1;
                    break;
                default:
                    P = new Vector4(t, 0, 0, 0);
                    fade = 1;
                    break;
            }
            if (Mathf.Abs(fade - s.sentFade) > 0.02f || fade <= 0 && s.sentFade != 0)
            {
                s.sentFade = fade;
                s.proj.fadeFactor = fade;
            }
            if (float.IsNaN(s.sent.x) || (P - s.sent).sqrMagnitude > 0.0004f)
            {
                s.sent = P;
                s.proj.uvScale = new Vector2(P.x, P.y);
                s.proj.uvBias = new Vector2(P.z, P.w);
            }
        }

        void Release(Slot s)
        {
            s.active = false;
            if (s.proj) s.proj.enabled = false;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            Tick(sprites, dt);
            Tick(ground, dt);
        }

        void Tick(List<Slot> list, float dt)
        {
            var rt = FxRuntime.Ensure();
            for (int i = 0; i < list.Count; i++)
            {
                var s = list[i];
                if (!s.active) continue;
                s.age += dt;
                if (s.age >= s.life || !s.proj)
                {
                    Release(s);
                    continue;
                }
                // 弹孔：余热冷却完、还没开始淡出的时候参数不变，跳过写入
                bool settled = s.kind == FxMaterialKind.DecalSprite && s.age > 3f / Mathf.Max(0.1f, s.coolRate) && s.age < s.life - s.fadeOut;
                if (!settled) Write(s);
                if (rt) Emit(rt, s, dt);
            }
        }

        /// <summary>熔池往上冒余烬和蚀绿气泡；涡旋往中心吸三色光点</summary>
        static void Emit(FxRuntime rt, Slot s, float dt)
        {
            float t = s.age / Mathf.Max(0.01f, s.life);
            if (s.kind == FxMaterialKind.DecalPool)
            {
                if (t > 0.85f) return;
                s.emitAcc += dt * (10f + 3f * s.radius) * Fx.Density;
                var ember = s.emitAcc >= 1 ? rt.GetEmitter("Ember") : null;
                var glow = s.emitAcc >= 1 ? rt.GetEmitter("GlowRise") : null;
                while (s.emitAcc >= 1)
                {
                    s.emitAcc -= 1;
                    var o = Random.insideUnitCircle * s.radius * 0.85f;
                    var p = s.center + new Vector3(o.x, 0.08f, o.y);
                    if (Random.value < 0.7f)
                    {
                        if (ember != null) rt.EmitOne(ember, p, new Vector3(Random.Range(-0.3f, 0.3f), Random.Range(1.2f, 2.8f), Random.Range(-0.3f, 0.3f)),
                            Random.Range(0.06f, 0.12f), Random.Range(0.6f, 1.1f), Color.Lerp(PoolEmber, Color.white, Random.value * 0.3f), 0);
                    }
                    else if (glow != null)
                        rt.EmitOne(glow, p, new Vector3(0, Random.Range(0.4f, 1f), 0), Random.Range(0.12f, 0.22f), Random.Range(0.35f, 0.6f), CorrodeBubble, 0);
                }
            }
            else if (s.kind == FxMaterialKind.DecalVortex)
            {
                if (t > 0.92f) return;
                s.emitAcc += dt * (30f + 30f * t) * Fx.Density;
                var mote = s.emitAcc >= 1 ? rt.GetEmitter("Glow") : null;
                while (s.emitAcc >= 1)
                {
                    s.emitAcc -= 1;
                    if (mote == null) continue;
                    float a = Random.value * Mathf.PI * 2;
                    float r = s.radius * Random.Range(0.85f, 1.25f);
                    var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                    var tangent = new Vector3(-dir.z, 0, dir.x);
                    var p = s.center + dir * r + Vector3.up * Random.Range(0.1f, 1.4f);
                    // 切向 + 向内：大约 0.45 s 卷到中心
                    var v = (-dir * r / 0.45f) + tangent * (r * 2.2f) + Vector3.down * 0.4f;
                    var c = Fx.ElementColor(TriElements[Random.Range(0, 3)]);
                    rt.EmitOne(mote, p, v, Random.Range(0.1f, 0.2f), Random.Range(0.3f, 0.45f), c, 0);
                }
            }
        }

        static readonly Element[] TriElements = { Element.Fire, Element.Shock, Element.Corrode };
        static readonly Color PoolEmber = Hex.Rgb(0xffa040);
        static readonly Color CorrodeBubble = Hex.Rgb(0x9dff4a);

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (!instance) return;
            foreach (var s in instance.sprites) instance.Release(s);
            foreach (var s in instance.ground) instance.Release(s);
        }

        /// <summary>画质降档：超出弹孔上限的最老几个立刻收掉</summary>
        internal static void Trim()
        {
            if (!instance) return;
            var live = instance.sprites.FindAll(s => s.active);
            live.Sort((a, b) => b.stamp.CompareTo(a.stamp));
            for (int i = SpriteCap; i < live.Count; i++) instance.Release(live[i]);
        }
    }
}
