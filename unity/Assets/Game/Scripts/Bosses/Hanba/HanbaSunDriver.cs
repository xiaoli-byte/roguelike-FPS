using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 太阳（场景主方向光）的驱动：旱魃战里由代码调太阳的高度和亮度，影子跟着真的变。挂在主光自己的物体上（不挂在首领身上）——
    /// 首领倒下、物体回收之后，复原的那一段还能接着跑完；随关卡场景一起卸载。
    ///   · 高度（<see cref="DriveTo"/>）：保持方位角，把仰角在几秒内平滑推到目标值。一阶段要「午后的低太阳」（沙丘背阴面、楼阁拖出长影子 = 荫蔽）：
    ///     关卡本身就是低太阳时不动它；露天场地的太阳高过 <see cref="HanbaDef.lowSunMax"/> 时，登场演出里压到 <see cref="HanbaDef.lowSunElevation"/>。
    ///     三阶段「赤地千里」推到约 85°（<see cref="HanbaDef.risenElevation"/>）：影子缩到脚下，只剩楼阁里、沙丘檐下的深影。
    ///   · 亮度（<see cref="SetDim"/> / <see cref="Flash"/>）：日蚀时压到一成多（天暗下来），复燃时猛地一亮再落回。都是相对原亮度的倍率。
    ///     压暗（倍率 &lt; 1）时环境一起暗：环境光、反射、雾色、天空盒曝光按 <see cref="EnvAt"/> 缩（只压暗主光的话，晴空的环境光还是把场地照得亮堂堂的，看不出日蚀）；
    ///     天空盒用一份运行时副本改曝光（不碰材质资产），组件销毁时把原来的天空盒和环境光还回去。复燃的强光只亮主光。
    ///   · 复原（<see cref="Restore"/>）：回到第一次接手时的仰角和亮度（旱魃倒下后影子慢慢回来）。
    /// 日晒判定（<see cref="SunExposure"/>）每次都读主光的当前朝向（<see cref="SunShaft.ToSun"/>），这里改了朝向，判定和真实阴影同时跟上。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HanbaSunDriver : MonoBehaviour
    {
        Light sun;
        Quaternion originalRot;
        float originalIntensity = 1f, originalElevation;
        float fromElev, toElev, azimuth, moveT, moveSeconds;
        float dim = 1f, dimFrom = 1f, dimTo = 1f, dimT, dimSeconds, flashBack = -1f, flashHold;
        bool moving, dimming;

        /// <summary>主光压到最暗（倍率 0）时环境亮度留几成</summary>
        public const float EnvFloor = 0.3f;
        static readonly int ExposureId = Shader.PropertyToID("_Exposure");
        bool envCaptured;
        float envNow = 1f, origReflection, origExposure;
        Color origSkyCol, origEquator, origGround, origAmbient, origFog;
        UnityEngine.Rendering.SphericalHarmonicsL2 origProbe;
        UnityEngine.Rendering.AmbientMode origMode;
        Material origSky, skyCopy;

        /// <summary>接手的主光</summary>
        public Light Sun => sun;
        /// <summary>太阳当前的仰角（度，0 = 地平线，90 = 头顶）与方位角（度，0 = +Z）</summary>
        public float Elevation => ElevationOf(ToSun);
        public float Azimuth => AzimuthOf(ToSun);
        /// <summary>第一次接手时的仰角（复原的目标）</summary>
        public float OriginalElevation => originalElevation;
        /// <summary>当前的亮度倍率（相对原亮度）</summary>
        public float Dim => dim;
        /// <summary>当前的环境亮度倍率（环境光 / 反射 / 雾 / 天空，1 = 原样）</summary>
        public float Env => envNow;

        /// <summary>主光倍率 → 环境倍率：压暗时按 <see cref="EnvFloor"/> 到 1 插值，亮过原亮度（复燃强光）时环境不跟着亮</summary>
        public static float EnvAt(float dim) => dim >= 1f ? 1f : Mathf.Lerp(EnvFloor, 1f, Mathf.Clamp01(dim));
        /// <summary>正在推仰角 / 已经推到目标</summary>
        public bool Moving => moving;
        public float TargetElevation => toElev;
        /// <summary>推过几次仰角（测试用）</summary>
        public int Drives { get; private set; }

        Vector3 ToSun => sun ? -sun.transform.forward : Vector3.up;

        /// <summary>场景主光的驱动（没有方向光返回 null）；第一次要的时候挂到主光上并记下原朝向、原亮度</summary>
        public static HanbaSunDriver Find() => For(SunShaft.Sun);

        public static HanbaSunDriver For(Light l)
        {
            if (!l) return null;
            var d = l.GetComponent<HanbaSunDriver>();
            if (!d) d = l.gameObject.AddComponent<HanbaSunDriver>();
            d.Capture(l);
            return d;
        }

        void Capture(Light l)
        {
            if (sun == l) return;
            sun = l;
            originalRot = l.transform.rotation;
            originalIntensity = l.intensity;
            originalElevation = ElevationOf(-l.transform.forward);
            toElev = originalElevation;
        }

        public static float ElevationOf(Vector3 toSun) => Mathf.Asin(Mathf.Clamp(toSun.normalized.y, -1f, 1f)) * Mathf.Rad2Deg;
        public static float AzimuthOf(Vector3 toSun) => Mathf.Atan2(toSun.x, toSun.z) * Mathf.Rad2Deg;

        /// <summary>仰角 / 方位角（度）→ 指向太阳的单位向量</summary>
        public static Vector3 Direction(float elevationDeg, float azimuthDeg)
        {
            float e = elevationDeg * Mathf.Deg2Rad, a = azimuthDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Cos(e) * Mathf.Sin(a), Mathf.Sin(e), Mathf.Cos(e) * Mathf.Cos(a));
        }

        /// <summary>保持方位角，seconds 秒内把仰角推到 elevationDeg（1–89°）</summary>
        public void DriveTo(float elevationDeg, float seconds)
        {
            if (!sun) return;
            fromElev = Elevation;
            toElev = Mathf.Clamp(elevationDeg, 1f, 89f);
            azimuth = Azimuth;
            moveT = 0;
            moveSeconds = Mathf.Max(0.01f, seconds);
            moving = true;
            Drives++;
            if (seconds <= 0.01f) Step(0.02f);
        }

        /// <summary>亮度倍率在 seconds 秒内变到 k</summary>
        public void SetDim(float k, float seconds)
        {
            flashBack = -1f;
            dimFrom = dim;
            dimTo = Mathf.Max(0, k);
            dimT = 0;
            dimSeconds = Mathf.Max(0.01f, seconds);
            dimming = true;
        }

        /// <summary>猛地亮到 peak 倍、停 hold 秒，再用 back 秒落回 1</summary>
        public void Flash(float peak, float hold, float back)
        {
            dimming = false;
            dim = Mathf.Max(dim, peak);
            Apply();
            flashHold = Mathf.Max(0, hold);
            flashBack = Mathf.Max(0.01f, back);
        }

        /// <summary>seconds 秒内回到第一次接手时的仰角与亮度</summary>
        public void Restore(float seconds)
        {
            if (!sun) return;
            DriveTo(originalElevation, seconds);
            azimuth = AzimuthOf(-(originalRot * Vector3.forward));
            SetDim(1f, seconds);
        }

        void Update() => Step(Time.deltaTime);

        void Step(float dt)
        {
            if (!sun || !(dt > 0)) return;
            if (moving)
            {
                moveT += dt;
                float u = Mathf.Clamp01(moveT / moveSeconds);
                float e = Mathf.Lerp(fromElev, toElev, u * u * (3 - 2 * u));
                var dir = Direction(e, azimuth);
                sun.transform.rotation = Quaternion.LookRotation(-dir, Mathf.Abs(dir.y) > 0.999f ? Vector3.forward : Vector3.up);
                if (u >= 1f) moving = false;
            }
            if (flashBack > 0)
            {
                flashHold -= dt;
                if (flashHold <= 0) SetDimAfterFlash();
            }
            else if (dimming)
            {
                dimT += dt;
                float u = Mathf.Clamp01(dimT / dimSeconds);
                dim = Mathf.Lerp(dimFrom, dimTo, u);
                if (u >= 1f) dimming = false;
            }
            Apply();
        }

        void SetDimAfterFlash()
        {
            float back = flashBack;
            flashBack = -1f;
            SetDim(1f, back);
        }

        void Apply()
        {
            if (sun) sun.intensity = originalIntensity * dim;
            ApplyEnv(EnvAt(dim));
        }

        /// <summary>环境跟着主光暗下去 / 亮回来（第一次压暗时才记原值）</summary>
        void ApplyEnv(float k)
        {
            if (Mathf.Abs(k - envNow) < 1e-3f) return;
            if (!envCaptured) CaptureEnv();
            envNow = k;
            switch (origMode)
            {
                case UnityEngine.Rendering.AmbientMode.Trilight:
                    RenderSettings.ambientSkyColor = origSkyCol * k;
                    RenderSettings.ambientEquatorColor = origEquator * k;
                    RenderSettings.ambientGroundColor = origGround * k;
                    break;
                case UnityEngine.Rendering.AmbientMode.Flat:
                    RenderSettings.ambientLight = origAmbient * k;
                    break;
            }
            // 渐变 / 单色环境光改颜色后引擎会重算球谐；直接再给一份缩过的球谐，两条路都盖住（天空盒环境光只有这一条路）
            RenderSettings.ambientProbe = origProbe * k;
            RenderSettings.reflectionIntensity = origReflection * k;
            var fog = origFog * k;
            fog.a = origFog.a;
            RenderSettings.fogColor = fog;
            if (skyCopy) skyCopy.SetFloat(ExposureId, origExposure * k);
        }

        void CaptureEnv()
        {
            envCaptured = true;
            origMode = RenderSettings.ambientMode;
            origSkyCol = RenderSettings.ambientSkyColor;
            origEquator = RenderSettings.ambientEquatorColor;
            origGround = RenderSettings.ambientGroundColor;
            origAmbient = RenderSettings.ambientLight;
            origProbe = RenderSettings.ambientProbe;
            origReflection = RenderSettings.reflectionIntensity;
            origFog = RenderSettings.fogColor;
            origSky = RenderSettings.skybox;
            if (origSky && origSky.HasProperty(ExposureId))
            {
                origExposure = origSky.GetFloat(ExposureId);
                skyCopy = new Material(origSky) { name = origSky.name + " (Hanba)" };
                RenderSettings.skybox = skyCopy;
            }
        }

        /// <summary>
        /// 把环境还原（原天空盒、环境光、反射、雾色），丢掉天空盒副本。RenderSettings 跟着当前活动场景走：
        /// 关卡已经切走（活动场景的天空盒不是这份副本 / 活动场景不是主光所在的场景）时不去改别的场景的环境
        /// </summary>
        void RestoreEnv()
        {
            if (!envCaptured) return;
            bool ours = skyCopy ? RenderSettings.skybox == skyCopy : UnityEngine.SceneManagement.SceneManager.GetActiveScene() == gameObject.scene;
            if (ours)
            {
                ApplyEnv(1f);
                if (skyCopy) RenderSettings.skybox = origSky;
            }
            if (skyCopy) Destroy(skyCopy);
            skyCopy = null;
            envCaptured = false;
            envNow = 1f;
        }

        void OnDestroy() => RestoreEnv();
    }
}
