using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 图鉴缩略图（I5）：运行时把美术 Prefab 摆进一个看不见的小摄影棚，拍成 256² 的透明底贴图，按条目缓存（一次会话拍一次）。
    ///   · 摄影棚：远在 y = −4000 的正交相机 + 三盏平行光（主光、补光、轮廓光），模型和相机都在第 30 层（没人用的层，场景相机看不到）；
    ///     拍的那一下临时关掉场景里别的灯、关雾、把环境光换成中性灰，拍完立刻还原（同一帧里，场景画面不受影响）。
    ///   · 透明底：URP 的中间缓冲不一定保留 alpha，所以用差分抠像——黑底、白底各拍一次（2 倍超采样），
    ///     透明度 = 1 −（白底 − 黑底），颜色 = 黑底 / 透明度（线性空间里算），再 2×2 下采样。
    ///   · 机位：武器从右侧看枪身（枪口朝右，略带俯视）；敌人、首领、灵宠从前方偏右上 3/4 角看。正交相机按包围盒在画面里的投影取景。
    ///   · 模型：武器 = LootCatalog 的世界模型（带元素纹路）；敌人 = 名册 Prefab + 挂件（琵琶、弩…）；首领 = 第一形态的模型（缺失时用代理）；
    ///     灵宠 = <see cref="PetVisuals.Build"/>（含发光件 / 占位体）。Animator 先求一次第 0 帧，免得拍到绑定姿势。秘卷没有模型，返回 null。
    /// 未收录的条目在界面上把同一张图染成黑色就是剪影（-unity-background-image-tint-color）。
    /// </summary>
    public static class CodexThumbs
    {
        public const int Size = 256;
        const int Super = 2;
        const int Layer = 30;
        static readonly Vector3 Origin = new(0, -4000, 0);

        static readonly Dictionary<string, Texture2D> cache = new();
        static readonly HashSet<string> missing = new();
        static GameObject rig;
        static Camera cam;
        static Light key, fill, rim;
        static RenderTexture rt;
        static Texture2D readBlack, readWhite;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Clear();
            missing.Clear();
        }

        /// <summary>这一类条目有没有模型可拍（秘卷没有）</summary>
        public static bool HasModel(CodexEntry e) => e != null && e.kind != CodexKind.Scroll;

        /// <summary>已经拍过（或确认拍不了）</summary>
        public static bool Ready(CodexEntry e) => e == null || !HasModel(e) || cache.ContainsKey(e.Key) || missing.Contains(e.Key);

        /// <summary>缓存里的缩略图（还没拍 / 拍不了为 null）</summary>
        public static Texture2D Peek(CodexEntry e) => e != null && cache.TryGetValue(e.Key, out var t) && t ? t : null;

        /// <summary>取缩略图：没拍过就现在拍（同步，一张约几毫秒）；没有模型返回 null</summary>
        public static Texture2D Get(CodexEntry e)
        {
            if (!HasModel(e) || missing.Contains(e.Key)) return null;
            var t = Peek(e);
            if (t) return t;
            t = Render(e);
            if (t) cache[e.Key] = t;
            else missing.Add(e.Key);
            return t;
        }

        /// <summary>拍过的张数（测试用）</summary>
        public static int Count => cache.Count;

        /// <summary>丢掉全部缩略图和摄影棚</summary>
        public static void Clear()
        {
            foreach (var t in cache.Values)
                if (t) Object.Destroy(t);
            cache.Clear();
            ReleaseRig();
        }

        /// <summary>拆掉摄影棚（图鉴关上时；缓存的贴图留着）</summary>
        public static void ReleaseRig()
        {
            if (rig) Object.Destroy(rig);
            rig = null;
            cam = null;
            key = fill = rim = null;
            if (rt)
            {
                rt.Release();
                Object.Destroy(rt);
            }
            rt = null;
            if (readBlack) Object.Destroy(readBlack);
            if (readWhite) Object.Destroy(readWhite);
            readBlack = readWhite = null;
        }

        // ───────────── 摄影棚 ─────────────

        static void EnsureRig()
        {
            if (rig && cam) return;
            ReleaseRig();
            rig = new GameObject("[CodexThumbs]") { hideFlags = HideFlags.HideAndDontSave };
            rig.transform.position = Origin;
            var camGo = new GameObject("Camera") { hideFlags = HideFlags.HideAndDontSave };
            camGo.transform.SetParent(rig.transform, false);
            cam = camGo.AddComponent<Camera>();
            cam.enabled = false;
            cam.orthographic = true;
            cam.cullingMask = 1 << Layer;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 200f;
            cam.allowHDR = false;
            cam.allowMSAA = false;
            cam.useOcclusionCulling = false;
            var data = cam.GetUniversalAdditionalCameraData();
            if (data)
            {
                data.renderPostProcessing = false;
                data.antialiasing = AntialiasingMode.None;
                data.renderShadows = false;
                // 深度 / 颜色贴图跟管线设置走：屏幕空间贴花那一趟要深度，关掉会在渲染图里报空引用
            }
            key = MakeLight("Key", new Color(1f, 0.95f, 0.86f), 1.55f, new Vector3(38, -35, 0));
            fill = MakeLight("Fill", new Color(0.7f, 0.8f, 1f), 0.55f, new Vector3(12, 150, 0));
            rim = MakeLight("Rim", new Color(1f, 0.86f, 0.62f), 0.9f, new Vector3(20, 180 + 25, 0));
            int px = Size * Super;
            rt = new RenderTexture(px, px, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { name = "CodexThumbRT", hideFlags = HideFlags.HideAndDontSave };
            rt.Create();
            cam.targetTexture = rt;
            readBlack = new Texture2D(px, px, TextureFormat.RGBA32, false, false) { hideFlags = HideFlags.HideAndDontSave };
            readWhite = new Texture2D(px, px, TextureFormat.RGBA32, false, false) { hideFlags = HideFlags.HideAndDontSave };
        }

        static Light MakeLight(string name, Color color, float intensity, Vector3 euler)
        {
            var go = new GameObject(name) { hideFlags = HideFlags.HideAndDontSave };
            go.transform.SetParent(rig.transform, false);
            go.transform.rotation = Quaternion.Euler(euler);
            var l = go.AddComponent<Light>();
            l.type = LightType.Directional;
            l.color = color;
            l.intensity = intensity;
            l.shadows = LightShadows.None;
            l.cullingMask = 1 << Layer;
            l.enabled = false;
            return l;
        }

        // ───────────── 模型 ─────────────

        static GameObject Spawn(CodexEntry e, out bool side)
        {
            side = false;
            var holder = new GameObject("CodexModel " + e.Key) { hideFlags = HideFlags.HideAndDontSave };
            holder.transform.position = Origin;
            GameObject prefab = null;
            switch (e.def)
            {
                case WeaponDef w:
                    side = true;
                    prefab = LootCatalog.WeaponModel(w.prefab);
                    if (!prefab) break;
                    var gun = Object.Instantiate(prefab, holder.transform, false);
                    foreach (var a in gun.GetComponentsInChildren<Animator>(true)) a.enabled = false;
                    WeaponTint.Apply(gun, w.element, 0);
                    return holder;
                case EnemyDef d:
                    prefab = EnemyCatalog.Prefab(d.prefab);
                    if (!prefab) break;
                    Pose(AttachParts(Object.Instantiate(prefab, holder.transform, false)));
                    return holder;
                case BossDef b:
                    if (b.forms.Count == 0) break;
                    var form = b.forms[0];
                    prefab = GameDatabase.Enemy(form.prefab) ?? GameDatabase.Enemy(form.proxyPrefab);
                    if (!prefab) break;
                    Pose(AttachParts(Object.Instantiate(prefab, holder.transform, false)));
                    return holder;
                case PetDef p:
                    var m = PetVisuals.Build(p, holder.transform);
                    if (m.root && m.Rigged) Pose(m.root.gameObject);
                    return holder;
            }
            Object.Destroy(holder);
            return null;
        }

        /// <summary>挂件：同 EnemyRoster 生成时的规则（bind 来源 + id 对上本体的挂到 socket_&lt;bindAttachment&gt;）</summary>
        static GameObject AttachParts(GameObject go)
        {
            var info = go.GetComponent<ArtAssetInfo>();
            if (!info) return go;
            foreach (var part in EnemyCatalog.Attachments)
            {
                var pi = part ? part.GetComponent<ArtAssetInfo>() : null;
                if (!pi || pi.bindSource != info.bindSource || pi.bindId != info.bindId) continue;
                foreach (var t in go.GetComponentsInChildren<Transform>(true))
                    if (t.name == "socket_" + pi.bindAttachment)
                    {
                        Object.Instantiate(part, t, false);
                        break;
                    }
            }
            return go;
        }

        static readonly int TintId = Shader.PropertyToID("_Tint");

        /// <summary>
        /// Animator 立即求第 0 帧（默认状态的待机姿势）；发光壳（名字带 GlowShell 的外壳网格，平时由 EnemyBody 每帧写透明度）
        /// 给一个柔和的固定透明度，不然它按材质缺省值整层盖在身上，模型拍出来一片黑
        /// </summary>
        static void Pose(GameObject go)
        {
            var block = new MaterialPropertyBlock();
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r.name.Contains("GlowShell")) continue;
                r.GetPropertyBlock(block);
                block.SetColor(TintId, new Color(1, 1, 1, 0.4f));
                r.SetPropertyBlock(block);
            }
            foreach (var a in go.GetComponentsInChildren<Animator>(true))
            {
                if (!a.runtimeAnimatorController) continue;
                a.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                a.Update(0f);
            }
        }

        static bool Framed(Renderer r) => r.enabled && r.gameObject.activeInHierarchy && r is not ParticleSystemRenderer && r is not TrailRenderer && r is not LineRenderer;

        // ───────────── 拍 ─────────────

        static Texture2D Render(CodexEntry e)
        {
            GameObject model = null;
            var lights = new List<Light>();
            bool fog = RenderSettings.fog;
            var probe = RenderSettings.ambientProbe;
            try
            {
                EnsureRig();
                model = Spawn(e, out bool side);
                if (!model) return null;
                foreach (var t in model.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = Layer;
                var renderers = model.GetComponentsInChildren<Renderer>();
                Bounds b = default;
                bool any = false;
                foreach (var r in renderers)
                {
                    if (!Framed(r)) continue;
                    r.shadowCastingMode = ShadowCastingMode.Off;
                    if (r is SkinnedMeshRenderer smr) smr.updateWhenOffscreen = true;
                    if (!any) b = r.bounds;
                    else b.Encapsulate(r.bounds);
                    any = true;
                }
                if (!any || b.size.sqrMagnitude < 1e-6f) return null;

                // 机位：武器侧面（枪口朝右），其余前方偏右上 3/4
                var dir = side ? new Vector3(1f, 0.22f, -0.08f).normalized : new Vector3(0.62f, 0.3f, 1f).normalized;
                var rot = Quaternion.LookRotation(-dir, Vector3.up);
                float radius = b.extents.magnitude;
                cam.transform.SetPositionAndRotation(b.center + dir * (radius * 3f + 1f), rot);
                // 正交取景：包围盒八个角在相机平面上的投影
                var inv = Quaternion.Inverse(rot);
                Vector2 min = new(float.MaxValue, float.MaxValue), max = new(float.MinValue, float.MinValue);
                for (int i = 0; i < 8; i++)
                {
                    var c = b.center + Vector3.Scale(b.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    var p = inv * (c - b.center);
                    min = Vector2.Min(min, p);
                    max = Vector2.Max(max, p);
                }
                var mid = (min + max) * 0.5f;
                cam.transform.position += rot * new Vector3(mid.x, mid.y, 0);
                float half = Mathf.Max(max.x - min.x, max.y - min.y) * 0.5f;
                cam.orthographicSize = Mathf.Max(0.05f, half * (side ? 1.06f : 1.1f));
                cam.nearClipPlane = 0.01f;
                cam.farClipPlane = radius * 8f + 4f;
                // 主光从相机左上方打过来
                key.transform.rotation = rot * Quaternion.Euler(28, 32, 0);
                fill.transform.rotation = rot * Quaternion.Euler(8, -55, 0);
                rim.transform.rotation = rot * Quaternion.Euler(18, 170, 0);

                // 只留摄影棚的灯、关雾、中性环境光
                foreach (var l in Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                    if (l.enabled && l != key && l != fill && l != rim)
                    {
                        l.enabled = false;
                        lights.Add(l);
                    }
                key.enabled = fill.enabled = rim.enabled = true;
                RenderSettings.fog = false;
                var sh = new SphericalHarmonicsL2();
                sh.AddAmbientLight(new Color(0.36f, 0.34f, 0.33f));
                RenderSettings.ambientProbe = sh;

                Shoot(Color.black, readBlack);
                Shoot(Color.white, readWhite);
                return Compose();
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning($"[CodexThumbs] 拍 {e.Key} 失败：{ex.Message}");
                return null;
            }
            finally
            {
                foreach (var l in lights)
                    if (l) l.enabled = true;
                if (key) key.enabled = fill.enabled = rim.enabled = false;
                RenderSettings.fog = fog;
                RenderSettings.ambientProbe = probe;
                if (model)
                {
                    model.SetActive(false);
                    Object.Destroy(model);
                }
            }
        }

        static void Shoot(Color background, Texture2D into)
        {
            cam.backgroundColor = background;
            cam.Render();
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            into.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0, false);
            RenderTexture.active = prev;
        }

        /// <summary>差分抠像 + 2×2 下采样（线性空间里算透明度与颜色，结果按 sRGB 存）</summary>
        static Texture2D Compose()
        {
            var bk = readBlack.GetPixels32();
            var wh = readWhite.GetPixels32();
            int src = Size * Super;
            var outPx = new Color32[Size * Size];
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
            {
                float r = 0, g = 0, bl = 0, a = 0;
                for (int sy = 0; sy < Super; sy++)
                for (int sx = 0; sx < Super; sx++)
                {
                    int i = (y * Super + sy) * src + x * Super + sx;
                    float br = Lin(bk[i].r), bg = Lin(bk[i].g), bb = Lin(bk[i].b);
                    float alpha = 1f - ((Lin(wh[i].r) - br) + (Lin(wh[i].g) - bg) + (Lin(wh[i].b) - bb)) / 3f;
                    alpha = Mathf.Clamp01(alpha);
                    // 预乘累加：黑底上的颜色就是 颜色 × 透明度
                    r += br;
                    g += bg;
                    bl += bb;
                    a += alpha;
                }
                const float n = Super * Super;
                a /= n;
                if (a < 1f / 255f)
                {
                    outPx[y * Size + x] = new Color32(0, 0, 0, 0);
                    continue;
                }
                r /= n * a;
                g /= n * a;
                bl /= n * a;
                outPx[y * Size + x] = new Color32(Gam(r), Gam(g), Gam(bl), (byte)Mathf.RoundToInt(a * 255f));
            }
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, false, false)
            {
                name = "CodexThumb", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear, hideFlags = HideFlags.DontSave,
            };
            tex.SetPixels32(outPx);
            tex.Apply(false, true);
            return tex;
        }

        static float[] toLinear;

        static float Lin(byte v)
        {
            if (toLinear == null)
            {
                toLinear = new float[256];
                for (int i = 0; i < 256; i++) toLinear[i] = Mathf.GammaToLinearSpace(i / 255f);
            }
            return toLinear[v];
        }

        static byte Gam(float v) => (byte)Mathf.Clamp(Mathf.RoundToInt(Mathf.LinearToGammaSpace(Mathf.Clamp01(v)) * 255f), 0, 255);
    }
}
