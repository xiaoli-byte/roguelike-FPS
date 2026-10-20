using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 喷火器的火焰锥（WC2，朱雀吐息）。Three.js 每跳发一枚 flame 投射物（14 跳 / 秒 → 每秒生成 14 个物体）；这里不再生成任何东西：
    ///   · 结算：每跳（控制器的一次 Shoot，耗 1 发、发 WeaponFired，词条照常）沿准星做一次 OverlapCapsule，
    ///     锥长 = 弹速 × 寿命（24 × 0.42 ≈ 10 m，弹速词条 / 属性会拉长，撞墙截短），半径从投射物半径 0.32 线性张到锥口（半角 <see cref="HalfAngle"/>）；
    ///     锥内的敌人按距离排序，前 1 + 穿透 名各吃一次（投射物穿透不衰减，同 TS），被地形挡住的不算、也不占名额；
    ///     伤害 / 元素 / 暴击走 <see cref="Ballistics.HitInfo"/>（火 8% 附着 = 灼烧），不按弱点算（火舌整团包住身体，不是点射）；
    ///     出生中 / 遁地中（不可选中）的跳过，免得每秒十几个「免疫」字样。
    ///   · 表现：两个共享的世界空间 Shuriken 发射器（加法火舌 + 透明烟），每跳从枪口逐颗 Emit，寿命按撞墙距离截短；
    ///     命中点偶尔舔一簇火星。整个武器生命周期只有这两个常驻物体。
    /// 由 WeaponController 在开火时转过来（<see cref="Handles"/>）；定义里的 projectile 只当数据（速度、寿命、半径、上浮、颜色）。
    /// </summary>
    public static class FlameCone
    {
        /// <summary>投射物外观 id：定义的 projectile.visual 是它、且是连发武器时由火焰锥接管</summary>
        public const string Visual = "flame";
        /// <summary>锥的半角（弧度）：比 TS 单枚火团（0.32 m 的球）略宽，10 m 处半径约 0.9 m——近战武器要好打中</summary>
        public const float HalfAngle = 0.06f;
        /// <summary>锥从眼前多远开始（米）：贴脸的敌人也要烧到</summary>
        public const float StartOffset = 0.15f;

        const int MaxColliders = 64;
        static readonly Collider[] overlap = new Collider[MaxColliders];
        static readonly List<Candidate> cands = new(16);

        struct Candidate
        {
            public Damageable target;
            public Collider collider;
            public Vector3 point;
            public float along;
        }

        static GameObject root;
        static ParticleSystem flames, smoke;
        static ParticleSystem.EmitParams ep;
        static int tick;
        static bool burning;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            root = null;
            flames = null;
            smoke = null;
            tick = 0;
            burning = false;
            cands.Clear();
        }

        /// <summary>这把枪的开火由火焰锥接管（喷火器）</summary>
        public static bool Handles(WeaponDef d) => d != null && d.projectile != null && d.projectile.visual == Visual && d.mode == FireMode.Auto;

        /// <summary>锥长（米）：弹速（含弹速加成）× 寿命，不超过定义射程</summary>
        public static float Reach(in ShotContext s)
        {
            var def = s.Def;
            var spec = def.projectile;
            float speed = s.stats != null && s.stats.projectileSpeed > 0 ? s.stats.projectileSpeed : spec.speed;
            return Mathf.Min(speed * spec.lifetime, def.range);
        }

        /// <summary>距锥起点 along 米处的锥半径</summary>
        public static float RadiusAt(WeaponDef def, float along) => def.projectile.radius + Mathf.Max(0, along) * Mathf.Tan(HalfAngle);

        /// <summary>
        /// 一跳：origin / dir = 眼睛与（已按散布偏过的）准星方向，muzzle = 火舌的视觉起点。
        /// 返回这一跳烧到的敌人数
        /// </summary>
        public static int Emit(Ballistics ballistics, in ShotContext s, Vector3 origin, Vector3 dir, Vector3 muzzle)
        {
            var def = s.Def;
            if (def?.projectile == null || ballistics == null) return 0;
            float reach = Reach(in s);
            // 撞墙截短：火焰不穿墙
            if (Physics.Raycast(origin, dir, out var wall, reach, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                reach = Mathf.Max(StartOffset + 0.05f, wall.distance);
            int hit = Burn(ballistics, in s, origin, dir, reach);
            Draw(in s, origin, dir, muzzle, reach);
            return hit;
        }

        static int Burn(Ballistics ballistics, in ShotContext s, Vector3 origin, Vector3 dir, float reach)
        {
            // 结算里的伤害事件万一同步又开了一枪（重入），用临时表，不踩正在遍历的共享表
            if (burning) return Burn(ballistics, in s, origin, dir, reach, new List<Candidate>(8));
            burning = true;
            try { return Burn(ballistics, in s, origin, dir, reach, cands); }
            finally { burning = false; }
        }

        static int Burn(Ballistics ballistics, in ShotContext s, Vector3 origin, Vector3 dir, float reach, List<Candidate> cands)
        {
            var def = s.Def;
            var p0 = origin + dir * StartOffset;
            var p1 = origin + dir * reach;
            float rMax = RadiusAt(def, reach);
            int n = Physics.OverlapCapsuleNonAlloc(p0, p1, rMax, overlap, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            cands.Clear();
            for (int i = 0; i < n; i++)
            {
                var c = overlap[i];
                overlap[i] = null;
                if (!c || !c.enabled) continue;
                var hb = c.GetComponent<Hitbox>();
                var target = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                if (!target || target.Dead || target.untargetable) continue;
                // 碰撞体上离锥轴最近的点：先取包围盒中心在轴上的投影，再让碰撞体给出离它最近的表面点
                float a = Mathf.Clamp(Vector3.Dot(c.bounds.center - origin, dir), StartOffset, reach);
                var axis = origin + dir * a;
                var q = c is MeshCollider { convex: false } ? c.bounds.ClosestPoint(axis) : c.ClosestPoint(axis);
                float along = Vector3.Dot(q - origin, dir);
                if (along < 0 || along > reach) continue;
                float off = (q - (origin + dir * along)).magnitude;
                if (off > RadiusAt(def, along) + 1e-3f) continue;
                int k = IndexOf(cands, target);
                if (k < 0) cands.Add(new Candidate { target = target, collider = c, point = q, along = along });
                else if (along < cands[k].along) cands[k] = new Candidate { target = target, collider = c, point = q, along = along };
            }
            if (cands.Count == 0) return 0;
            cands.Sort((x, y) => x.along.CompareTo(y.along));
            int limit = 1 + Mathf.Max(0, s.pierce), burned = 0;
            for (int i = 0; i < cands.Count && burned < limit; i++)
            {
                var cnd = cands[i];
                if (!cnd.target || cnd.target.Dead) continue;
                if (Combat.Blocked(origin, cnd.point, cnd.collider)) continue;
                var info = ballistics.HitInfo(in s, s.damage, cnd.point, dir);
                info.weakpoint = false;
                Combat.DamageEnemy(cnd.target, info);
                burned++;
                if ((tick + i) % 3 == 0) Lick(cnd.point, dir, TintOf(in s));
            }
            cands.Clear();
            return burned;
        }

        static int IndexOf(List<Candidate> cands, Damageable d)
        {
            for (int i = 0; i < cands.Count; i++)
                if (cands[i].target == d) return i;
            return -1;
        }

        // ───────────── 表现 ─────────────

        /// <summary>火舌颜色：带元素时用元素色（喷火器缺省是火），否则投射物颜色</summary>
        static Color TintOf(in ShotContext s) => s.element != Element.None ? DamageTable.ElementColor(s.element) : s.Def.projectile.color;

        static bool Ensure()
        {
            if (flames && smoke) return true;
            if (!Application.isPlaying) return false;
            // 常驻（跨关不卸载）：Core 场景之外叠加加载的关卡卸掉时火舌不跟着没
            if (!root)
            {
                root = new GameObject("FlameCone");
                Object.DontDestroyOnLoad(root);
            }
            if (!flames)
            {
                flames = Make(root.transform, "Flames", new FxParticle
                {
                    blend = FxBlend.Additive, texture = FxTexture.Glow, gravity = -3, drag = 1.2f, grow = 5.5f, fade = FxFade.Smoke,
                    alpha = 0.95f, maxParticles = 400, sortOrder = 2,
                }, FxMaterials.ParticleAdd);
                // 白热 → 橙 → 暗红：顶点色（元素色）再乘这条渐变
                var col = flames.colorOverLifetime;
                var g = new Gradient();
                g.SetKeys(
                    new[] { new GradientColorKey(new Color(1f, 0.95f, 0.8f), 0), new GradientColorKey(new Color(1f, 0.75f, 0.45f), 0.3f), new GradientColorKey(new Color(0.75f, 0.28f, 0.14f), 1) },
                    new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(0.95f, 0.1f), new GradientAlphaKey(0.7f, 0.55f), new GradientAlphaKey(0, 1) });
                col.color = new ParticleSystem.MinMaxGradient(g);
            }
            if (!smoke)
            {
                smoke = Make(root.transform, "Smoke", new FxParticle
                {
                    blend = FxBlend.Alpha, texture = FxTexture.Smoke, gravity = -2.2f, drag = 1.8f, grow = 3.2f, fade = FxFade.Smoke,
                    alpha = 0.32f, maxParticles = 120, sortOrder = 0,
                }, FxMaterials.ParticleAlpha);
            }
            return flames && smoke;
        }

        static ParticleSystem Make(Transform parent, string name, FxParticle style, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();
            FxSetup.Configure(ps, style, mat);
            ps.Play(true);
            return ps;
        }

        /// <summary>一跳的火舌：火团 5 颗（乘画质密度，至少 2 颗）、烟 1 颗（隔跳）；寿命按撞墙距离截短</summary>
        static void Draw(in ShotContext s, Vector3 origin, Vector3 dir, Vector3 muzzle, float reach)
        {
            if (!Ensure()) return;
            tick++;
            var spec = s.Def.projectile;
            var color = TintOf(in s);
            float speed = s.stats != null && s.stats.projectileSpeed > 0 ? s.stats.projectileSpeed : spec.speed;
            // 火舌从枪口出发，指向准星方向上锥的末端（枪口在右下，直接沿 dir 会和准星错开）
            var end = origin + dir * reach;
            var heading = (end - muzzle).normalized;
            float life = Mathf.Max(0.08f, Mathf.Min(spec.lifetime, Vector3.Distance(muzzle, end) / Mathf.Max(1, speed)));
            var right = Vector3.Cross(Vector3.up, heading);
            right = right.sqrMagnitude < 1e-6f ? Vector3.right : right.normalized;
            var up = Vector3.Cross(heading, right);
            int count = Mathf.Max(2, Mathf.RoundToInt(5 * Fx.Density));
            ep.applyShapeToPosition = false;
            for (int i = 0; i < count; i++)
            {
                var d = Ballistics.Scatter(heading, right, up, HalfAngle * 1.25f);
                ep.position = muzzle + heading * Random.Range(0f, 0.25f);
                ep.velocity = d * speed * Random.Range(0.82f, 1.05f);
                ep.startSize = spec.radius * spec.scale * Random.Range(0.35f, 0.6f);
                ep.startLifetime = life * Random.Range(0.8f, 1.1f);
                ep.startColor = Mix(color, Random.Range(0.1f, 0.45f));
                ep.rotation = Random.value * 360f;
                flames.Emit(ep, 1);
            }
            if (tick % 2 == 0)
            {
                ep.position = muzzle + heading * (reach * 0.35f);
                ep.velocity = heading * speed * 0.35f + Vector3.up * 0.8f;
                ep.startSize = 0.45f;
                ep.startLifetime = 0.7f;
                ep.startColor = new Color(0.22f, 0.18f, 0.16f, 1);
                ep.rotation = Random.value * 360f;
                smoke.Emit(ep, 1);
            }
        }

        /// <summary>命中点舔一簇小火星（隔几跳一次，免得十几跳 / 秒刷满屏）</summary>
        static void Lick(Vector3 point, Vector3 dir, Color color)
        {
            if (!Ensure()) return;
            ep.applyShapeToPosition = false;
            for (int i = 0; i < 2; i++)
            {
                ep.position = point - dir * 0.1f;
                ep.velocity = (Random.onUnitSphere + Vector3.up * 0.8f).normalized * Random.Range(1f, 2.5f);
                ep.startSize = Random.Range(0.25f, 0.45f);
                ep.startLifetime = Random.Range(0.18f, 0.3f);
                ep.startColor = Mix(color, 0.3f);
                ep.rotation = Random.value * 360f;
                flames.Emit(ep, 1);
            }
        }

        static Color Mix(Color c, float white)
        {
            var m = UnityEngine.Color.Lerp(c, UnityEngine.Color.white, white);
            m.a = 1;
            return m;
        }
    }
}
