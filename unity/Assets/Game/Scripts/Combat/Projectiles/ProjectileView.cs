using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>一次发射的外观参数（颜色、敌我、整体缩放、拖尾、灯）</summary>
    public struct ProjectileLook
    {
        public Color color;
        /// <summary>敌方：光晕更大更亮、箭杆骨白（同 TS setup(hostile)）</summary>
        public bool hostile;
        /// <summary>整体缩放（<see cref="ProjectileVisuals.ViewSize"/>）</summary>
        public float size;
        /// <summary>拖尾宽度（世界米，0 = 不要拖尾）与存留时长</summary>
        public float trailWidth, trailTime;
        /// <summary>拖尾颜色（a = 0 时取 color）</summary>
        public Color trailColor;
        /// <summary>点光源（0 = 不要）：敌方爆炸弹的火光</summary>
        public float lightRange, lightIntensity;
        /// <summary>内核亮度倍率（敌方弹 1.3：亮背景下也醒目）</summary>
        public float coreBoost;
    }

    /// <summary>
    /// 投射物外观实例（Three.js 版 ProjectileView 的移植）：按 <see cref="ProjectileVisualRecipe"/> 搭一次，之后由 <see cref="ProjectileVisuals"/> 对象池复用。
    /// 层级：根（位置 + 朝向 + 整体缩放）→ spin（自转 / 翻滚 / 摇摆）→ 各部件；拖尾挂在根下的 Tail（中心后方 tailOffset × size）。
    /// 部件按角色上色：Core 不透明内核（向白色混）、Glow / Accent 加色光层、Halo 朝相机的光晕片、Solid 固定色受光件（金属、岩块）、Shaft 箭杆（我方木色 / 敌方骨白）。
    /// 投射物结束时 <see cref="Release"/>：部件立刻隐藏，拖尾停止发射、淡完再回池。
    /// </summary>
    public sealed class ProjectileView : MonoBehaviour
    {
        enum Role { Core, Glow, Accent, Halo, Solid, Shaft }

        struct Part
        {
            public Renderer r;
            public Role role;
            public Color solid;
        }

        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        static readonly Color Wood = new(0.42f, 0.32f, 0.22f), Bone = new(0.85f, 0.8f, 0.69f);
        static readonly Color Warm = new(1f, 0.851f, 0.627f);
        static MaterialPropertyBlock block;
        static Material lit;

        readonly List<Part> parts = new();
        Transform spin, tail, glow, accent, halo;
        TrailRenderer trail;
        Light lamp;
        Color color;
        bool hostile;
        float size = 1, phase, coreBoost = 1, haloBase = 1, dieAt = -1, nearK = 1;
        Vector3 accentScale = Vector3.one, glowScale = Vector3.one;
        Stack<ProjectileView> home;

        public ProjectileVisualRecipe Recipe { get; private set; }
        /// <summary>自转层：recipe.build 把部件挂在它下面</summary>
        public Transform Spin => spin;
        /// <summary>正在使用（没回池、也不在淡出拖尾）</summary>
        public bool InUse { get; private set; }

        /// <summary>受光的固定色件用的默认 Lit 材质（取自内置几何体，打包时一定在）</summary>
        static Material Lit
        {
            get
            {
                if (lit) return lit;
                var probe = GameObject.CreatePrimitive(PrimitiveType.Cube);
                probe.SetActive(false); // Destroy 要到帧末才生效：先停用，免得它的碰撞体这一帧挡子弹
                lit = probe.GetComponent<Renderer>().sharedMaterial;
                ProjectilePools.SafeDestroy(probe);
                return lit;
            }
        }

        internal void Build(ProjectileVisualRecipe recipe, Stack<ProjectileView> pool)
        {
            Recipe = recipe;
            home = pool;
            name = "PV_" + recipe.id;
            spin = new GameObject("Spin").transform;
            spin.SetParent(transform, false);
            tail = new GameObject("Tail").transform;
            tail.SetParent(transform, false);
            tail.localPosition = new Vector3(0, 0, -recipe.tailOffset);
            recipe.build?.Invoke(this);
        }

        // ───────────── 搭建（recipe.build 调用）─────────────

        Transform AddPart(Mesh mesh, Material mat, Role role, Color solid, Vector3 scale, Vector3 pos, Vector3 euler)
        {
            var go = new GameObject(role.ToString());
            go.transform.SetParent(spin, false);
            go.transform.localPosition = pos;
            go.transform.localRotation = Quaternion.Euler(euler);
            go.transform.localScale = scale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            parts.Add(new Part { r = r, role = role, solid = solid });
            return go.transform;
        }

        /// <summary>不透明内核：颜色 = 投射物颜色向白色混 recipe.coreWhiten</summary>
        public Transform AddCore(Mesh mesh, Vector3 scale, Vector3 pos = default, Vector3 euler = default) =>
            AddPart(mesh, FxMaterials.Unlit, Role.Core, default, scale, pos, euler);

        /// <summary>加色光层（不透明度 recipe.glowOpacity）；第一个光层参与脉动动画</summary>
        public Transform AddGlow(Mesh mesh, Vector3 scale, Vector3 pos = default, Vector3 euler = default)
        {
            var t = AddPart(mesh, FxMaterials.Additive, Role.Glow, default, scale, pos, euler);
            if (!glow)
            {
                glow = t;
                glowScale = scale;
            }
            return t;
        }

        /// <summary>点缀光（尾焰、闪灯、箭羽光）；第一个参与闪烁动画（z 轴长度 × recipe.accentLen）</summary>
        public Transform AddAccent(Mesh mesh, Vector3 scale, Vector3 pos = default, Vector3 euler = default)
        {
            var t = AddPart(mesh, FxMaterials.Additive, Role.Accent, default, scale, pos, euler);
            if (!accent)
            {
                accent = t;
                accentScale = scale;
            }
            return t;
        }

        /// <summary>固定色受光件（金属壳、岩块）</summary>
        public Transform AddSolid(Mesh mesh, Color c, Vector3 scale, Vector3 pos = default, Vector3 euler = default) =>
            AddPart(mesh, Lit, Role.Solid, c, scale, pos, euler);

        /// <summary>箭杆 / 矛杆：我方木色、敌方骨白</summary>
        public Transform AddShaft(Mesh mesh, Vector3 scale, Vector3 pos = default, Vector3 euler = default) =>
            AddPart(mesh, Lit, Role.Shaft, default, scale, pos, euler);

        /// <summary>朝相机的光晕片（大小 recipe.haloScale，z = 沿飞行方向的偏移）</summary>
        public void AddHalo(float z = 0)
        {
            if (halo) return;
            halo = FxMaterials.GlowSprite(spin, 1f, Color.white);
            halo.localPosition = new Vector3(0, 0, z);
            // GlowSprite 用 Destroy 删面片的碰撞体（帧末才生效）：先关掉，免得投射物第一帧的扫掠打中自己的光晕
            var col = halo.GetComponent<Collider>();
            if (col) col.enabled = false;
            var r = halo.GetComponent<Renderer>();
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            parts.Add(new Part { r = r, role = Role.Halo });
        }

        // ───────────── 使用 ─────────────

        /// <summary>激活：上色、缩放、拖尾 / 灯，放到 pos 朝向 heading（拖尾从这里开始画）</summary>
        public void Setup(in ProjectileLook look, Vector3 pos, Vector3 heading)
        {
            var r = Recipe;
            color = look.color;
            hostile = look.hostile;
            size = Mathf.Max(1e-3f, look.size);
            coreBoost = look.coreBoost > 0 ? look.coreBoost : 1f;
            phase = Random.value * Mathf.PI * 2;
            haloBase = r.haloScale * (hostile ? 1.35f : 1f);
            dieAt = -1;
            InUse = true;
            spin.localPosition = Vector3.zero;
            spin.localRotation = Quaternion.identity;
            if (glow) glow.localScale = glowScale;
            if (accent) accent.localScale = new Vector3(accentScale.x, accentScale.y, accentScale.z * r.accentLen);
            if (halo) halo.localScale = Vector3.one * haloBase;
            for (int i = 0; i < parts.Count; i++)
            {
                parts[i].r.enabled = true;
                Paint(parts[i], 1f);
            }
            transform.SetPositionAndRotation(pos, Orientation(heading));
            transform.localScale = Vector3.one * size;
            nearK = 1;
            if (NearFades)
            {
                float k = NearK(pos);
                transform.localScale *= Mathf.Lerp(0.45f, 1f, k);
                ApplyNear(k);
            }

            if (look.trailWidth > 0)
            {
                if (!trail)
                {
                    trail = tail.gameObject.AddComponent<TrailRenderer>();
                    trail.sharedMaterial = FxMaterials.Additive;
                    trail.shadowCastingMode = ShadowCastingMode.Off;
                    trail.receiveShadows = false;
                    trail.minVertexDistance = 0.08f;
                }
                var tc = look.trailColor.a > 0 ? look.trailColor : new Color(color.r, color.g, color.b, 0.85f);
                trail.enabled = true;
                trail.time = look.trailTime > 0 ? look.trailTime : 0.22f;
                trail.startWidth = look.trailWidth;
                trail.endWidth = 0;
                trail.startColor = tc;
                trail.endColor = new Color(tc.r, tc.g, tc.b, 0);
                trail.Clear();
                trail.emitting = true;
            }
            else if (trail)
            {
                trail.emitting = false;
                trail.Clear();
                trail.enabled = false;
            }

            if (look.lightRange > 0)
            {
                if (!lamp)
                {
                    lamp = gameObject.AddComponent<Light>();
                    lamp.type = LightType.Point;
                    lamp.shadows = LightShadows.None;
                }
                lamp.enabled = true;
                lamp.color = color;
                lamp.range = look.lightRange;
                lamp.intensity = look.lightIntensity > 0 ? look.lightIntensity : 2f;
            }
            else if (lamp) lamp.enabled = false;
        }

        Quaternion Orientation(Vector3 heading) =>
            Recipe.orient && heading.sqrMagnitude > 1e-8f ? Quaternion.LookRotation(heading) : Quaternion.identity;

        void Paint(in Part p, float alphaMul)
        {
            var r = Recipe;
            Color c;
            switch (p.role)
            {
                case Role.Core:
                    c = Color.Lerp(color, Color.white, r.coreWhiten) * coreBoost;
                    c.a = 1;
                    break;
                case Role.Glow:
                    c = color;
                    c.a = Mathf.Min(1, r.glowOpacity * (hostile ? 1.25f : 1f)) * alphaMul;
                    break;
                case Role.Accent:
                    c = r.accentTint switch
                    {
                        AccentTint.Warm => Color.Lerp(color, Warm, 0.55f),
                        AccentTint.White => Color.Lerp(color, Color.white, 0.35f),
                        _ => color,
                    };
                    c.a = 0.9f * alphaMul;
                    break;
                case Role.Halo:
                    c = color;
                    c.a = (hostile ? 1f : 0.85f) * alphaMul;
                    break;
                case Role.Shaft:
                    c = hostile ? Bone : Wood;
                    break;
                default:
                    c = p.solid;
                    break;
            }
            block ??= new MaterialPropertyBlock();
            block.Clear();
            block.SetColor(BaseColor, c);
            p.r.SetPropertyBlock(block);
        }

        void PaintRole(Role role, float alphaMul)
        {
            for (int i = 0; i < parts.Count; i++)
                if (parts[i].role == role)
                    Paint(parts[i], alphaMul);
        }

        /// <summary>
        /// 每帧：跟随投射物（位置、朝向）并播放造型动画（同 TS animate）。fade ∈ [0, 1] 为到期淡出（1 = 正常）
        /// </summary>
        public void Pose(Vector3 pos, Vector3 heading, float age, float lifetime, float dt, float fade)
        {
            if (!InUse) return;
            transform.SetPositionAndRotation(pos, Orientation(heading));
            float amp = hostile ? 0.18f : 0.1f;
            float grow = 1;
            switch (Recipe.motion)
            {
                case ProjectileMotion.Orb:
                    if (glow) glow.localScale = glowScale * (1 + 0.12f * Mathf.Sin(age * 18 + phase));
                    SetHalo(1 + amp * Mathf.Sin(age * 11 + phase));
                    break;
                case ProjectileMotion.Bolt:
                case ProjectileMotion.Arrow:
                case ProjectileMotion.Spear:
                    SetHalo(1 + amp * Mathf.Sin(age * 14 + phase));
                    StretchAccent(0.85f + 0.3f * Random.value);
                    break;
                case ProjectileMotion.Shard:
                    spin.localRotation *= Quaternion.Euler(0, 0, dt * 9 * Mathf.Rad2Deg);
                    SetHalo(1 + amp * Mathf.Sin(age * 12 + phase));
                    break;
                case ProjectileMotion.Rocket:
                    StretchAccent(0.8f + Random.value * 0.5f);
                    SetHalo(0.85f + 0.3f * Random.value);
                    break;
                case ProjectileMotion.Grenade:
                {
                    spin.localRotation *= Quaternion.Euler(dt * 13 * Mathf.Rad2Deg, dt * 4 * Mathf.Rad2Deg, 0);
                    float rate = lifetime - age < 1 ? 14 : 5;
                    bool on = Mathf.Sin(age * rate * Mathf.PI * 2 + phase) > 0;
                    PaintRole(Role.Accent, on ? 1f : 0.12f);
                    SetHalo(on ? 1.15f : 0.7f);
                    break;
                }
                case ProjectileMotion.Flame:
                {
                    float t = Mathf.Clamp01(age / Mathf.Max(0.05f, lifetime));
                    grow = 0.7f + 1.1f * t;
                    float flick = 0.9f + Random.value * 0.2f;
                    if (glow) glow.localScale = glowScale * flick;
                    if (accent) accent.localScale = new Vector3(accentScale.x * flick, accentScale.y * flick, accentScale.z * (0.8f + Random.value * 0.5f));
                    float o = 1 - Mathf.Clamp01((t - 0.6f) / 0.4f);
                    PaintRole(Role.Glow, o);
                    PaintRole(Role.Accent, o);
                    PaintRole(Role.Halo, o);
                    SetHalo(flick);
                    break;
                }
                case ProjectileMotion.Lantern:
                    spin.localRotation = Quaternion.Euler(0, age * 40, Mathf.Sin(age * 3 + phase) * 12);
                    spin.localPosition = new Vector3(0, Mathf.Sin(age * 5 + phase) * 0.08f, 0);
                    if (glow) glow.localScale = glowScale * (1 + 0.15f * Mathf.Sin(age * 7 + phase));
                    SetHalo(1 + amp * Mathf.Sin(age * 7 + phase));
                    break;
                case ProjectileMotion.Feather:
                    spin.localRotation = Quaternion.Euler(0, 0, Mathf.Sin(age * 9 + phase) * 35);
                    SetHalo(1 + amp * Mathf.Sin(age * 10 + phase));
                    break;
                case ProjectileMotion.Chunk:
                    spin.localRotation *= Quaternion.Euler(dt * 7 * Mathf.Rad2Deg, dt * 3 * Mathf.Rad2Deg, 0);
                    SetHalo(1 + amp * Mathf.Sin(age * 6 + phase));
                    break;
            }
            if (NearFades)
            {
                float k = NearK(pos);
                grow *= Mathf.Lerp(0.45f, 1f, k);
                ApplyNear(k);
            }
            transform.localScale = Vector3.one * (size * grow * fade);
        }

        bool NearFades => Recipe.nearFade > 0 && !hostile;

        /// <summary>离镜头的远近：0.5 m 内 = 0，recipe.nearFade 外 = 1（见 <see cref="ProjectileVisualRecipe.nearFade"/>）</summary>
        float NearK(Vector3 pos)
        {
            var cam = Camera.main;
            if (!cam) return 1;
            float d = Vector3.Distance(cam.transform.position, pos);
            return Mathf.SmoothStep(0, 1, Mathf.InverseLerp(0.5f, Recipe.nearFade, d));
        }

        /// <summary>近处光晕缩小、光层变淡（颜色只在变化够大时重刷，飞远后就不再每帧刷）</summary>
        void ApplyNear(float k)
        {
            if (halo) halo.localScale *= Mathf.Lerp(0.2f, 1f, k);
            if (Mathf.Abs(k - nearK) < 0.03f && (k < 1 || nearK >= 1)) return;
            nearK = k;
            PaintRole(Role.Glow, k);
            PaintRole(Role.Halo, k);
        }

        void SetHalo(float k)
        {
            if (halo) halo.localScale = Vector3.one * (haloBase * k);
        }

        void StretchAccent(float k)
        {
            if (accent) accent.localScale = new Vector3(accentScale.x, accentScale.y, accentScale.z * Recipe.accentLen * k);
        }

        /// <summary>投射物结束：部件立刻隐藏；有拖尾时停止发射、淡完再回池，否则马上回池</summary>
        public void Release()
        {
            if (!InUse) return;
            InUse = false;
            for (int i = 0; i < parts.Count; i++) parts[i].r.enabled = false;
            if (lamp) lamp.enabled = false;
            if (trail && trail.enabled && trail.emitting && Application.isPlaying)
            {
                trail.emitting = false;
                dieAt = Time.time + trail.time;
                return;
            }
            Recycle();
        }

        void Update()
        {
            if (dieAt >= 0 && Time.time >= dieAt) Recycle();
        }

        void Recycle()
        {
            dieAt = -1;
            if (trail)
            {
                trail.Clear();
                trail.enabled = false;
            }
            if (home != null) ProjectilePools.Give(home, this);
            else ProjectilePools.SafeDestroy(gameObject);
        }

        /// <summary>换关时强制回收（不等拖尾）</summary>
        internal void ForceRecycle()
        {
            InUse = false;
            Recycle();
        }
    }
}
