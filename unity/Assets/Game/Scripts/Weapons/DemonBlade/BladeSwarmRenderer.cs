using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 世界刃群的画面（Three.js BladeSwarm.ts 的表现部分）。每帧（LateUpdate，第一人称 rig 摆好之后）先推进 <see cref="BladeShards"/>，再画：
    ///   · 碎片本体：一个蒙皮渲染器，128 根骨骼就是 128 片碎刃（与手里的刀同一网格、同一材质，离刀后外形不变；一次绘制，不用自写着色器）。
    ///     不在世界里的碎片骨骼缩放 0；包围盒每帧按在外的碎片重算。
    ///   · 每片一团柔光 + 沿速度的拉丝拖尾：<see cref="Graphics.RenderMeshInstanced{T}"/> 一次画完（同一四边形 × 128 个实例，按远近分三档透明度，
    ///     屏幕尺寸有上下限：远处保底 6 像素读作一团旋转的紫光，近处封顶 90 像素不糊住视线）。平台 / 材质不支持实例化时逐个画。
    ///   · 旋涡：中心紫色雾光 + 地面判定范围光盘；圆盾：盾面光膜 + 挡弹处局部闪光；刃球：中心光核（越压越亮）。
    /// 只管表现，不做判定；由 <see cref="DemonBladeController"/> 建在 Game Systems 下，世界坐标与父节点无关。
    /// </summary>
    [DefaultExecutionOrder(60)]
    public sealed class BladeSwarmRenderer : MonoBehaviour
    {
        /// <summary>拖尾：长度 = 速度 × StreakTime（上限 StreakMax）</summary>
        const float StreakTime = 0.05f, StreakMax = 1.1f;
        static readonly Color GlowColor = Hex.Rgb(0xb88cff), CoreColor = Hex.Rgb(0xb98aff), HazeColor = Hex.Rgb(0x8a50ff);

        public BladeShards Shards { get; private set; }
        /// <summary>false = 不推进也不画（武器收起时由控制器关掉，碎片已瞬间归刀）</summary>
        public bool Live { get; set; }

        SkinnedMeshRenderer body;
        Transform[] bones;
        Transform boundsAnchor;
        MaterialPropertyBlock bodyBlock, fxBlock;
        Mesh quad;
        Material glowInstanced;
        bool instancingFailed;
        readonly Matrix4x4[][] glowBuckets = { new Matrix4x4[BladeShards.Count], new Matrix4x4[BladeShards.Count], new Matrix4x4[BladeShards.Count] };
        readonly int[] glowCounts = new int[3];
        readonly Matrix4x4[][] streakBuckets = { new Matrix4x4[BladeShards.Count], new Matrix4x4[BladeShards.Count] };
        readonly int[] streakCounts = new int[2];
        float ringAlpha, membraneAlpha;

        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), ColorId = Shader.PropertyToID("_Color");

        /// <summary>在 parent 下建一份（parent 可以为 null）</summary>
        public static BladeSwarmRenderer Create(Transform parent, BladeShards shards)
        {
            var go = new GameObject("DemonBlade Swarm");
            if (parent) go.transform.SetParent(parent, false);
            var r = go.AddComponent<BladeSwarmRenderer>();
            r.Shards = shards;
            r.Build();
            return r;
        }

        void Build()
        {
            var boneRoot = new GameObject("Bones").transform;
            boneRoot.SetParent(transform, false);
            bones = new Transform[BladeShards.Count];
            for (int i = 0; i < bones.Length; i++)
            {
                var b = new GameObject($"S{i:000}").transform;
                b.SetParent(boneRoot, false);
                b.localScale = Vector3.zero;
                bones[i] = b;
            }
            boundsAnchor = new GameObject("Bounds").transform;
            boundsAnchor.SetParent(transform, false);
            var go = new GameObject("Shards");
            go.transform.SetParent(transform, false);
            body = go.AddComponent<SkinnedMeshRenderer>();
            body.sharedMesh = BladeAssets.ShardMesh;
            body.sharedMaterial = BladeAssets.ShardMaterial;
            body.bones = bones;
            body.rootBone = boundsAnchor;
            body.updateWhenOffscreen = false;
            body.skinnedMotionVectors = false;
            body.shadowCastingMode = ShadowCastingMode.Off;
            body.receiveShadows = false;
            body.enabled = false;
            bodyBlock = new MaterialPropertyBlock();
            fxBlock = new MaterialPropertyBlock();
            quad = BuildQuad();
            var glow = FxMaterials.Glow;
            if (glow)
            {
                glowInstanced = new Material(glow) { name = "M_DemonBlade_Glow (instanced)", enableInstancing = true, hideFlags = HideFlags.DontSave };
            }
        }

        void OnDestroy()
        {
            if (glowInstanced) Destroy(glowInstanced);
            if (quad) Destroy(quad);
        }

        static Mesh BuildQuad()
        {
            var m = new Mesh { name = "DemonBlade Quad", hideFlags = HideFlags.DontSave };
            m.SetVertices(new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) });
            m.SetUVs(0, new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) });
            m.SetColors(new[] { Color.white, Color.white, Color.white, Color.white });
            m.SetNormals(new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back });
            m.SetTriangles(new[] { 0, 2, 1, 0, 3, 2 }, 0);
            m.RecalculateBounds();
            return m;
        }

        void LateUpdate()
        {
            if (!Live || Shards == null)
            {
                if (body && body.enabled) body.enabled = false;
                return;
            }
            float dt = Time.deltaTime;
            bool anyAway = Shards.Update(dt, Time.time);
            var cam = Camera.main;
            DrawBody();
            if (cam) DrawGlows(cam, dt);
            DrawAuras(cam, dt, anyAway);
        }

        // ───────────── 碎片本体 ─────────────

        void DrawBody()
        {
            var s = Shards;
            Vector3 min = new(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity), max = -min;
            int shown = 0;
            for (int i = 0; i < BladeShards.Count; i++)
            {
                var b = bones[i];
                float sc = s.scale[i];
                if (sc > 0 && s.departed[i])
                {
                    var p = s.pos[i];
                    b.SetPositionAndRotation(p, s.rot[i]);
                    b.localScale = new Vector3(sc, sc, sc);
                    min = Vector3.Min(min, p);
                    max = Vector3.Max(max, p);
                    shown++;
                }
                else if (b.localScale.x != 0) b.localScale = Vector3.zero;
            }
            bool on = shown > 0;
            if (body.enabled != on) body.enabled = on;
            if (!on) return;
            var c = (min + max) * 0.5f;
            boundsAnchor.SetPositionAndRotation(c, Quaternion.identity);
            // 碎片最大约 6 cm × 世界缩放 3.4：外放 0.4 m
            body.localBounds = new Bounds(Vector3.zero, max - min + Vector3.one * 0.8f);
            body.GetPropertyBlock(bodyBlock);
            bodyBlock.SetColor(BladeMeshes.EmissionColorId, BladeMeshes.ShardEmission * (1 + BladeShards.WorldGlow + s.boost));
            body.SetPropertyBlock(bodyBlock);
        }

        // ───────────── 柔光与拖尾（实例化） ─────────────

        void DrawGlows(Camera cam, float dt)
        {
            var s = Shards;
            var camPos = cam.transform.position;
            var camRot = cam.transform.rotation;
            float tanHalf = Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);
            float h = Mathf.Max(1, cam.pixelHeight);
            glowCounts[0] = glowCounts[1] = glowCounts[2] = 0;
            streakCounts[0] = streakCounts[1] = 0;
            for (int i = 0; i < BladeShards.Count; i++)
            {
                if (!(s.scale[i] > 0) || !s.departed[i]) continue;
                var p = s.pos[i];
                bool fly = s.flying[i];
                float dist = Mathf.Max(0.1f, Vector3.Dot(p - camPos, cam.transform.forward));
                // 世界尺寸 → 屏幕像素：远处保底 6 像素，近处封顶 90 像素（同 TS GlowPoints）；圆盾就在眼前，柔光收小
                float size = s.formation == SwarmFormation.Shield ? 0.05f : (fly ? 0.5f : 0.42f) * (1 + 0.5f * s.boost);
                float worldPerPx = 2 * dist * tanHalf / h;
                size = Mathf.Clamp(size, 6 * worldPerPx, 90 * worldPerPx);
                int bucket = dist < 3 ? 0 : dist < 8 ? 1 : 2;
                glowBuckets[bucket][glowCounts[bucket]++] = Matrix4x4.TRS(p, camRot, new Vector3(size, size, size));

                // 拖尾：沿速度方向的细长光条，正对相机
                var v = dt > 0 ? (p - s.prev[i]) / dt : Vector3.zero;
                float sp = v.magnitude;
                if (sp > 0.5f)
                {
                    float len = Mathf.Min(StreakMax, sp * StreakTime);
                    var axis = v / sp;
                    var mid = p - axis * (len * 0.5f);
                    var toCam = camPos - mid;
                    var side = Vector3.Cross(axis, toCam);
                    if (side.sqrMagnitude < 1e-8f) continue;
                    side.Normalize();
                    var normal = Vector3.Cross(side, axis);
                    float width = 0.035f * s.scale[i] * 2.2f;
                    var m = new Matrix4x4();
                    m.SetColumn(0, side * width);
                    m.SetColumn(1, axis * len);
                    m.SetColumn(2, normal);
                    m.SetColumn(3, new Vector4(mid.x, mid.y, mid.z, 1));
                    int sb = fly ? 0 : 1;
                    streakBuckets[sb][streakCounts[sb]++] = m;
                }
            }
            var mat = glowInstanced ? glowInstanced : FxMaterials.Glow;
            if (!mat) return;
            var bounds = new Bounds(s.center, Vector3.one * 60);
            float boost = 1 + 0.5f * s.boost;
            // 近处淡（不糊住画面），远处浓（远处靠它读出刃群）：同 TS clamp(dist / 10, 0.12, 0.9)
            float[] alpha = { 0.16f, 0.5f, 0.85f };
            for (int b = 0; b < 3; b++)
                Draw(mat, glowBuckets[b], glowCounts[b], WithAlpha(GlowColor * boost, alpha[b]), bounds);
            Draw(mat, streakBuckets[0], streakCounts[0], WithAlpha(BladeMeshes.Purple * 1.4f * boost, 0.9f), bounds);
            Draw(mat, streakBuckets[1], streakCounts[1], WithAlpha(BladeMeshes.Purple * 1.2f * boost, 0.6f), bounds);
        }

        static Color WithAlpha(Color c, float a) => new(c.r, c.g, c.b, a);

        void Draw(Material mat, Matrix4x4[] list, int count, Color color, Bounds bounds)
        {
            if (count <= 0) return;
            fxBlock.Clear();
            fxBlock.SetColor(BaseColorId, color);
            fxBlock.SetColor(ColorId, color);
            var rp = new RenderParams(mat)
            {
                layer = gameObject.layer, shadowCastingMode = ShadowCastingMode.Off, receiveShadows = false, matProps = fxBlock, worldBounds = bounds,
            };
            if (!instancingFailed && mat.enableInstancing && SystemInfo.supportsInstancing)
            {
                try
                {
                    Graphics.RenderMeshInstanced(rp, quad, 0, list, count);
                    return;
                }
                catch (Exception e)
                {
                    instancingFailed = true;
                    Debug.LogWarning($"[DemonBlade] 刃群柔光改为逐个绘制（实例化不可用：{e.Message}）");
                }
            }
            for (int i = 0; i < count; i++) Graphics.RenderMesh(rp, quad, 0, list[i]);
        }

        // ───────────── 旋涡雾光 / 范围光盘 / 圆盾光膜 / 刃球光核 ─────────────

        void DrawAuras(Camera cam, float dt, bool anyAway)
        {
            var s = Shards;
            var mat = FxMaterials.Glow;
            if (!mat) return;
            float t = s.Now;
            var camRot = cam ? cam.transform.rotation : Quaternion.identity;
            // 旋涡：判定范围（地面光盘）+ 中心雾光，随碎片到齐浮现；离镜头近时减弱
            float want = anyAway && s.formation == SwarmFormation.Vortex ? s.FormedFraction() : 0;
            ringAlpha += (want - ringAlpha) * Mathf.Min(1, dt * 8);
            if (ringAlpha > 0.01f)
            {
                float near = cam ? Mathf.Min(1, Vector3.Distance(s.center, cam.transform.position) / 8) : 1;
                var ground = s.center + Vector3.down * 0.55f;
                Aura(mat, Matrix4x4.TRS(ground, Quaternion.Euler(90, t * 40f, 0), Vector3.one * s.hitRadius * 2.1f), HazeColor, ringAlpha * 0.45f);
                Aura(mat, Matrix4x4.TRS(s.center, camRot * Quaternion.Euler(0, 0, t * 143f), Vector3.one * s.hitRadius * 2.2f), HazeColor,
                    ringAlpha * (0.32f + 0.08f * Mathf.Sin(t * 7)) * near);
            }
            // 圆盾光膜：朝向玩家的圆形光幕，挡弹时局部闪光
            float wantShield = anyAway && s.formation == SwarmFormation.Shield ? s.FormedFraction() : 0;
            membraneAlpha += (wantShield - membraneAlpha) * Mathf.Min(1, dt * 12);
            if (membraneAlpha > 0.01f)
            {
                var face = Quaternion.LookRotation(-s.shieldNormal, s.shieldUp);
                Aura(mat, Matrix4x4.TRS(s.shieldCenter, face, Vector3.one * s.shieldRadius * 2.3f), BladeMeshes.Purple, membraneAlpha * 0.35f);
                if (s.membraneHit >= 0)
                {
                    var hit = s.shieldCenter + s.shieldRight * (s.hitLocal.x * s.shieldRadius) + s.shieldUp * (s.hitLocal.y * s.shieldRadius);
                    float k = Mathf.Max(0, 1 - s.membraneHit * 4);
                    Aura(mat, Matrix4x4.TRS(hit - s.shieldNormal * 0.02f, face, Vector3.one * 0.7f), Color.white, k * 0.9f);
                }
            }
            // 刃球光核：越压越大越亮
            if (anyAway && s.formation == SwarmFormation.Ball)
            {
                float k = s.ballCompress;
                Aura(mat, Matrix4x4.TRS(s.center, camRot, Vector3.one * (0.6f + 2.2f * k * k)), CoreColor, 0.35f + 0.65f * k);
            }
        }

        void Aura(Material mat, Matrix4x4 m, Color c, float alpha)
        {
            fxBlock.Clear();
            var col = WithAlpha(c, Mathf.Clamp01(alpha));
            fxBlock.SetColor(BaseColorId, col);
            fxBlock.SetColor(ColorId, col);
            var rp = new RenderParams(mat) { layer = gameObject.layer, shadowCastingMode = ShadowCastingMode.Off, receiveShadows = false, matProps = fxBlock };
            Graphics.RenderMesh(rp, quad, 0, m);
        }
    }
}
