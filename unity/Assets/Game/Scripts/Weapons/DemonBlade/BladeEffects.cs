using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃的世界特效（Three.js BladeEffects.ts）：人刀合一的碎刃斩波（新月光带，立在垂直于飞行方向的平面里，弧顶扫过准星高度）、
    /// 噬灵鬼眼的魂力光点（从尸体沿上弯的弧线飞向刀根）。斩波的伤害由控制器按 <see cref="WaveFront"/> 结算，这里只管表现。
    /// 每帧用 Graphics.RenderMesh 直接画（不建物体）；暂停时控制器不调用，自然停住。
    /// </summary>
    public sealed class BladeEffects : IDisposable
    {
        const int WavePool = 4, WispPool = 10;
        /// <summary>魂力从尸体飞到刀根的时长</summary>
        public const float WispTime = 0.38f;

        struct WaveSlot
        {
            public Vector3 origin, dir;
            public float roll, range, t, dur;
        }

        struct WispSlot
        {
            public Vector3 from, at;
            public float t;
        }

        readonly WaveSlot[] waves = new WaveSlot[WavePool];
        readonly WispSlot[] wisps = new WispSlot[WispPool];
        readonly Mesh crescent, quad;
        readonly MaterialPropertyBlock block = new();
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), ColorId = Shader.PropertyToID("_Color");
        static readonly Color WispColor = Hex.Rgb(0xc9a2ff);

        public BladeEffects()
        {
            for (int i = 0; i < WavePool; i++) waves[i].t = 1;
            for (int i = 0; i < WispPool; i++) wisps[i].t = 1;
            crescent = Crescent();
            quad = Quad();
        }

        public void Dispose()
        {
            if (crescent) UnityEngine.Object.Destroy(crescent);
            if (quad) UnityEngine.Object.Destroy(quad);
        }

        /// <summary>新月形弧带（半径 1，张角 ±60°，宽度从中间向两端收窄），在 XY 平面、朝 +Y 凸出；顶点色 = 亮度（两端淡）</summary>
        static Mesh Crescent()
        {
            const int seg = 28;
            var pos = new Vector3[(seg + 1) * 2];
            var col = new Color[pos.Length];
            var idx = new int[seg * 6];
            for (int i = 0; i <= seg; i++)
            {
                float t = (float)i / seg;
                float a = (t - 0.5f) * (Mathf.PI * 2 / 3);
                float w = 0.28f * Mathf.Sin(Mathf.PI * t);
                float ix = Mathf.Sin(a), iy = Mathf.Cos(a);
                pos[2 * i] = new Vector3(ix * (1 - w), iy * (1 - w), 0);
                pos[2 * i + 1] = new Vector3(ix, iy, 0);
                float k = Mathf.Sin(Mathf.PI * t);
                col[2 * i] = new Color(0, 0, 0, 0);
                col[2 * i + 1] = new Color(k, k, k, k);
                if (i < seg)
                {
                    int o = i * 6;
                    idx[o] = 2 * i;
                    idx[o + 1] = 2 * i + 1;
                    idx[o + 2] = 2 * i + 2;
                    idx[o + 3] = 2 * i + 1;
                    idx[o + 4] = 2 * i + 3;
                    idx[o + 5] = 2 * i + 2;
                }
            }
            var m = new Mesh { name = "DemonBlade Crescent", hideFlags = HideFlags.DontSave };
            m.SetVertices(pos);
            m.SetColors(col);
            m.SetTriangles(idx, 0);
            m.RecalculateBounds();
            return m;
        }

        static Mesh Quad()
        {
            var m = new Mesh { name = "DemonBlade Wisp", hideFlags = HideFlags.DontSave };
            m.SetVertices(new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) });
            m.SetUVs(0, new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) });
            m.SetColors(new[] { Color.white, Color.white, Color.white, Color.white });
            m.SetTriangles(new[] { 0, 2, 1, 0, 3, 2 }, 0);
            m.RecalculateBounds();
            return m;
        }

        /// <summary>
        /// 斩波：从 origin 沿 dir 飞出 range 米、耗时 dur 秒；roll 为新月相对水平的倾斜（与挥砍方向一致）。
        /// 返回槽位（控制器据此读进度结算伤害），池满时覆盖飞得最远的
        /// </summary>
        public int LaunchWave(Vector3 origin, Vector3 dir, float roll, float range, float dur)
        {
            int k = -1;
            for (int i = 0; i < WavePool && k < 0; i++)
                if (waves[i].t >= 1) k = i;
            if (k < 0)
            {
                k = 0;
                for (int i = 1; i < WavePool; i++)
                    if (waves[i].t > waves[k].t) k = i;
            }
            waves[k] = new WaveSlot { origin = origin, dir = dir.normalized, roll = roll, range = range, t = 0, dur = Mathf.Max(0.01f, dur) };
            return k;
        }

        /// <summary>斩波当前飞到的距离（米）；已结束为 −1</summary>
        public float WaveFront(int k)
        {
            if (k < 0 || k >= WavePool || waves[k].t >= 1) return -1;
            float t = waves[k].t;
            return waves[k].range * (1 - (1 - t) * (1 - t));
        }

        /// <summary>魂力光点：从 from 飞向刀根（每帧由 target 给出，随镜头移动）</summary>
        public void Wisp(Vector3 from)
        {
            int k = 0;
            for (int i = 0; i < WispPool; i++)
                if (wisps[i].t >= 1)
                {
                    k = i;
                    break;
                }
            wisps[k] = new WispSlot { from = from, at = from, t = 0 };
        }

        /// <summary>每帧：推进并画；target = 刀根世界坐标（没有第一人称时 null，光点直接结束）</summary>
        public void Tick(float dt, Vector3? target, Camera cam)
        {
            var additive = FxMaterials.Additive;
            for (int i = 0; i < WavePool; i++)
            {
                ref var w = ref waves[i];
                if (w.t >= 1) continue;
                w.t = Mathf.Min(1, w.t + dt / w.dur);
                float e = 1 - (1 - w.t) * (1 - w.t);
                // 新月立在垂直于飞行方向的平面里（局部 Z = 飞行方向），弧顶朝上；按 roll 绕飞行方向倾斜成挥砍的角度
                var x = Vector3.Cross(Vector3.up, w.dir);
                if (x.sqrMagnitude < 1e-6f) x = Vector3.right;
                x = Quaternion.AngleAxis(w.roll * Mathf.Rad2Deg, w.dir) * x.normalized;
                var y = Vector3.Cross(w.dir, x).normalized;
                float r = 1.2f + 1.4f * e;
                // 弧心放在视线下方一点，新月的弧顶正好扫过准星高度
                var p = w.origin + w.dir * (w.range * e) - y * (r * 0.62f);
                float fade = w.t < 0.12f ? w.t / 0.12f : 1 - Mathf.Max(0, (w.t - 0.55f) / 0.45f);
                if (additive && fade > 0.01f)
                    Draw(additive, crescent, Matrix4x4.TRS(p, Quaternion.LookRotation(w.dir, y), new Vector3(r * 1.3f, r * 0.7f, r)), BladeMeshes.Purple * (1.6f * fade));
            }
            var glow = FxMaterials.Glow;
            var camRot = cam ? cam.transform.rotation : Quaternion.identity;
            for (int i = 0; i < WispPool; i++)
            {
                ref var w = ref wisps[i];
                if (w.t >= 1) continue;
                w.t = Mathf.Min(1, w.t + dt / WispTime);
                if (target == null)
                {
                    w.t = 1;
                    continue;
                }
                float e = w.t * w.t;
                // 向上弯一点的弧线
                w.at = Vector3.Lerp(w.from, target.Value, e) + Vector3.up * (Mathf.Sin(Mathf.PI * w.t) * 0.8f);
                float s = 0.55f * (1 - 0.6f * w.t);
                var c = WispColor;
                c.a = Mathf.Min(1, (1 - w.t) * 3);
                if (glow) Draw(glow, quad, Matrix4x4.TRS(w.at, camRot, Vector3.one * s), c);
            }
        }

        /// <summary>收刀 / 换关：全部结束</summary>
        public void Clear()
        {
            for (int i = 0; i < WavePool; i++) waves[i].t = 1;
            for (int i = 0; i < WispPool; i++) wisps[i].t = 1;
        }

        void Draw(Material mat, Mesh mesh, Matrix4x4 m, Color c)
        {
            block.Clear();
            block.SetColor(BaseColorId, c);
            block.SetColor(ColorId, c);
            var rp = new RenderParams(mat) { shadowCastingMode = ShadowCastingMode.Off, receiveShadows = false, matProps = block };
            Graphics.RenderMesh(rp, mesh, 0, m);
        }
    }
}
