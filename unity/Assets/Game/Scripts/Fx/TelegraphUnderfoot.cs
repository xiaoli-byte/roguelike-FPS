using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 脚下有危险预警时的第一人称提示（D21 预警整改，见 docs/art/review/unity-combat 问题清单）：
    /// 玩家脚底落在还在倒计时的危险预警里（<see cref="Telegraph.DangerAt(Vector3, float, out Vector3)"/>），画面底边泛起一道危险色（<see cref="TelegraphPalette.Danger"/>）的渐变光带，
    /// 随预警进度变亮、缓慢脉动；走出预警 / 预警兑现或撤回后 0.15 s 褪掉。
    /// 方向：预警的核心（落点圆心、长条 / 扇形的中轴）在玩家左边，光带左半边更亮、右半边压暗，反之亦然——往暗的一侧躲；核心就在脚下或正前 / 正后方时左右均匀。
    /// 为什么要它：落点预警常常就画在玩家脚下（吐冰、火云雨砸玩家的预判位置），看着高处的首领时脚下这一圈在视野下沿以外，地面预警画得再醒目也看不到。
    /// 和 F4 屏效叠加：强度乘「屏幕特效」设置（关掉时只留 35% 的淡提示——它是躲招信息，不全关）；低血量暗角起来时再压低最多 45%，不把低血量的红色暗角染成一片。
    /// 画在枪模叠加相机（只渲染 FirstPerson 层）近裁面前：只有玩家的第一人称画面有，旁观 / 演出相机没有。由 <see cref="Telegraph"/> 第一次用时挂到 FxRuntime 上。
    /// </summary>
    public sealed class TelegraphUnderfoot : MonoBehaviour
    {
        /// <summary>光带占画面高度的比例、亮侧底边的最大不透明度、淡入 / 淡出（秒）</summary>
        public const float BandHeight = 0.2f, MaxAlpha = 0.45f, FadeIn = 0.08f, FadeOut = 0.15f;
        /// <summary>「屏幕特效」关掉时保留的比例、低血量暗角满时压低的比例</summary>
        public const float EffectsOffFloor = 0.35f, LowHealthDuck = 0.45f;
        /// <summary>均匀时（没有方向）整条的亮度、有方向时暗侧的亮度（相对亮侧）</summary>
        const float FlatLevel = 0.72f, DimSide = 0.4f;

        /// <summary>当前强度 0..1（0 = 不显示；测试 / 截图用）</summary>
        public static float Level { get; private set; }
        /// <summary>当前方向 −1（左侧亮）… 0（均匀）… 1（右侧亮）（测试 / 截图用）</summary>
        public static float Side { get; private set; }

        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int BaseMapStId = Shader.PropertyToID("_BaseMap_ST");
        static readonly int MainTexStId = Shader.PropertyToID("_MainTex_ST");
        static Texture2D gradient;
        static Mesh mesh;

        Camera host;
        float nextLookup, phase, shown, side;
        GameObject band;
        Material mat;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Level = 0;
            Side = 0;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            float danger = -1;
            var core = Vector3.zero;
            var feet = Vector3.zero;
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead && BossHazards.PlayerBody(out feet, out float radius, out _)) danger = Telegraph.DangerAt(feet, radius, out core);
            float target = danger >= 0 ? Mathf.Lerp(0.55f, 1f, danger * danger) : 0;
            shown = Mathf.MoveTowards(shown, target, dt / (target > shown ? FadeIn : FadeOut));
            Level = shown;
            if (shown <= 0.001f || !Attach())
            {
                if (band && band.activeSelf) band.SetActive(false);
                return;
            }

            // 方向：核心相对视线的左右（水平面），离核心不到 0.4 m 时不分左右；平滑跟随，转头时不跳
            float want = 0;
            if (danger >= 0)
            {
                var v = core - feet;
                v.y = 0;
                var right = host.transform.right;
                right.y = 0;
                if (v.sqrMagnitude > 0.16f && right.sqrMagnitude > 1e-4f)
                    want = Mathf.Clamp(Vector3.Dot(v.normalized, right.normalized) * 1.4f, -1f, 1f) * Mathf.Clamp01((v.magnitude - 0.4f) / 0.8f);
            }
            side = Mathf.MoveTowards(side, want, dt * 4f);
            Side = side;

            // 脉动：0.8 → 1.9 Hz、±15%（别闪得太频繁）
            float u = Mathf.Max(0, danger);
            phase += dt * (5f + 7f * u * u);
            float effects = Mathf.Clamp01(GameSettings.ScreenEffects.Value);
            float lowHp = GameplayVolumes.Instance ? GameplayVolumes.Instance.LowHealthWeight : 0;
            float a = MaxAlpha * shown * (0.85f + 0.15f * Mathf.Sin(phase)) * Mathf.Lerp(EffectsOffFloor, 1f, effects) * (1f - LowHealthDuck * Mathf.Clamp01(lowHp));
            var c = TelegraphPalette.Danger;
            c.a = a;
            mat.SetColor(BaseColorId, c);
            mat.SetColor(ColorId, c);
            // 贴图横向三段：[0, 1/3] 左亮右暗、[1/3, 2/3] 均匀、[2/3, 1] 左暗右亮；按方向滑动取景窗
            var st = new Vector4(1f / 3f, 1f, (1f + side) / 3f, 0f);
            mat.SetVector(BaseMapStId, st);
            mat.SetVector(MainTexStId, st);
            Fit();
            if (!band.activeSelf) band.SetActive(true);
        }

        /// <summary>挂到当前主相机的枪模叠加相机下（没有玩家相机时返回 false）</summary>
        bool Attach()
        {
            if (!host || !host.isActiveAndEnabled)
            {
                if (Time.unscaledTime < nextLookup) return false;
                nextLookup = Time.unscaledTime + 0.5f;
                host = FindViewmodelCamera();
                if (!host) return false;
            }
            if (!band) Build();
            if (band.transform.parent != host.transform) band.transform.SetParent(host.transform, false);
            return true;
        }

        static Camera FindViewmodelCamera()
        {
            var main = Camera.main;
            if (!main) return null;
            var data = main.GetUniversalAdditionalCameraData();
            if (data == null) return null;
            foreach (var c in data.cameraStack)
                if (c && c.cullingMask == 1 << Layers.FirstPerson)
                    return c;
            return null;
        }

        /// <summary>按相机视角 / 画幅把光带铺满底边（近裁面外一点点，挡在枪模前面）</summary>
        void Fit()
        {
            float z = Mathf.Max(host.nearClipPlane * 2f, 0.012f);
            float h = 2f * z * Mathf.Tan(host.fieldOfView * 0.5f * Mathf.Deg2Rad);
            float w = h * Mathf.Max(0.5f, host.aspect) * 1.04f;
            var t = band.transform;
            t.SetLocalPositionAndRotation(new Vector3(0, -h * 0.5f + h * BandHeight * 0.5f, z), Quaternion.identity);
            t.localScale = new Vector3(w, h * BandHeight, 1f);
        }

        void Build()
        {
            band = new GameObject("Telegraph Underfoot Band") { layer = Layers.FirstPerson };
            band.AddComponent<MeshFilter>().sharedMesh = BandMesh();
            var r = band.AddComponent<MeshRenderer>();
            // 光带随玩家相机一起销毁（换关），材质留着下次接着用
            if (!mat)
            {
                mat = FxMaterials.MakeAlpha(Gradient());
                mat.name = "Telegraph Underfoot (instance)";
                mat.hideFlags = HideFlags.DontSave;
                mat.renderQueue = (int)RenderQueue.Overlay;
            }
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            r.allowOcclusionWhenDynamic = false;
            band.SetActive(false);
        }

        /// <summary>
        /// 竖直方向：底边不透明、往上按 (1 − v)^1.7 褪到 0。横向三段（取景窗宽 1/3，见 LateUpdate）：
        /// 左段从左端 1 降到 DimSide，中段恒为 FlatLevel，右段从 DimSide 升到右端 1——窗口滑到哪段就是哪种方向，中间连续过渡
        /// </summary>
        static Texture2D Gradient()
        {
            if (gradient) return gradient;
            const int W = 96, H = 64;
            gradient = new Texture2D(W, H, TextureFormat.RGBA32, false) { name = "Telegraph Underfoot Gradient", wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.DontSave };
            var px = new Color32[W * H];
            for (int x = 0; x < W; x++)
            {
                float t = (x + 0.5f) / W;
                float k;
                if (t < 1f / 3f) k = Mathf.Lerp(1f, DimSide, Mathf.SmoothStep(0, 1, t * 3f));
                else if (t > 2f / 3f) k = Mathf.Lerp(DimSide, 1f, Mathf.SmoothStep(0, 1, (t - 2f / 3f) * 3f));
                else k = FlatLevel;
                for (int y = 0; y < H; y++)
                {
                    float a = Mathf.Pow(1f - y / (H - 1f), 1.7f) * k;
                    px[y * W + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(255 * a));
                }
            }
            gradient.SetPixels32(px);
            gradient.Apply(false, true);
            return gradient;
        }

        /// <summary>XY 平面 1×1 方片（uv 0..1），正面朝 −z（对着相机）</summary>
        static Mesh BandMesh()
        {
            if (mesh) return mesh;
            mesh = new Mesh { name = "Telegraph Underfoot Band", hideFlags = HideFlags.DontSave };
            mesh.vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0) };
            mesh.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) };
            mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            mesh.RecalculateBounds();
            return mesh;
        }

        void OnDestroy()
        {
            if (band) Destroy(band);
            if (mat) Destroy(mat);
            Level = 0;
            Side = 0;
        }
    }
}
