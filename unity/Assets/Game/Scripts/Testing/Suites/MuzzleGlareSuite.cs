using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 原作枪口特效连射不糊屏：TestArena 里拿原作武器连射 1.5 s，量画面平均亮度相对开火前涨了多少，
    /// 同时查枪口粒子里有没有材质在采样空贴图槽（Original Particle 着色器的空槽是白图，整片方片 × HDR 主色叠上去就是满屏黄白）。
    /// </summary>
    public class MuzzleGlareSuite : PlaytestSuite
    {
        public override string Id => "muzzleglare";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        // 2026-11-08 实测（TestArena，冲锋枪连射 1.5 s）：修前 +0.279 / +0.294；材质修好、枪口不缩放 +0.126 / +0.262；缩放 0.3 → +0.037 / +0.061；0.12 → +0.024 / +0.041
        const float MaxMeanRise = 0.06f, MaxPeakRise = 0.15f;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var systems = SystemsBootstrap.Find();
            if (!arena || !systems)
            {
                Fail("缺少 TestArena 刷怪台或 Game Systems");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            var baked = FindAnyObjectByType<PlayerVitals>();
            if (baked)
            {
                baked.gameObject.SetActive(false);
                Destroy(baked.gameObject);
            }
            yield return null;
            var pos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            var rot = arena.playerSpawn ? arena.playerSpawn.rotation : Quaternion.identity;
            var rig = PlayerFactory.Create(HeroLibrary.Get(HeroLibrary.DefaultHero), pos, rot);
            PlayerFactory.Bind(systems, rig);
            SystemsBootstrap.Setup();
            yield return null;
            rig.vitals.invulnerableUntil = Time.time + 9999;
            float muzzleScale = GunfireOriginalAnimation.MuzzleScale;
            try
            {
                // 冲锋枪先扫几档枪口缩放，只记数据不判定（看缩放对糊屏的影响），最后按当前默认缩放逐把判定
                foreach (float scale in new[] { 1f, 0.3f, 0.15f, 0.08f })
                {
                    GunfireOriginalAnimation.MuzzleScale = scale;
                    yield return WeaponCase(rig, "smg", $"x{scale:0.##}", false);
                }
                GunfireOriginalAnimation.MuzzleScale = muzzleScale;
                foreach (var weaponId in new[] { "smg", "revolver", "railgun" })
                    yield return WeaponCase(rig, weaponId, "default", true);
            }
            finally
            {
                GunfireOriginalAnimation.MuzzleScale = muzzleScale;
            }
            rig.weapons.testFire = false;
        }

        IEnumerator WeaponCase(PlayerRig rig, string weaponId, string label, bool judge)
        {
            var wc = rig.weapons;
            var def = WeaponLibrary.Get(weaponId);
            var instance = new WeaponInstance(def);
            instance.mag = 999;
            wc.Give(instance);
            yield return new WaitForSeconds(0.8f);
            var view = wc.rigs.FirstOrDefault(r => r.weaponId == weaponId)?.view;
            var gun = WeaponRigParts.GunOf(view ? view.transform : null, def.prefab);
            var original = gun ? gun.GetComponent<GunfireOriginalAnimation>() : null;
            if (!original)
            {
                Line($"{weaponId}：不是原作武器，跳过");
                yield break;
            }
            float baseline = MeanLuma(rig.cam);
            if (judge) Shot(rig.cam, $"glare_{weaponId}_idle");
            var aimRest = rig.cam.transform.rotation;
            float yawRest = rig.motor.Yaw, pitchRest = rig.motor.Pitch;
            int fireBefore = original.fireCount;
            wc.testFire = true;
            float start = Time.time, sum = 0, peak = 0;
            int samples = 0, emptyRenderers = 0;
            bool shotMid = false;
            while (Time.time - start < 1.5f)
            {
                instance.mag = 999;
                // 半自动 / 蓄力武器按住只打一发：每 0.25 s 松一帧扳机再按
                wc.testFire = def.mode == FireMode.Auto || Mathf.Repeat(Time.time - start, 0.25f) > Time.deltaTime;
                // 后坐会把视线抬向天空、亮度跟着变：每帧拉回原视线，只量枪口特效本身
                rig.motor.SetLook(yawRest, pitchRest);
                yield return new WaitForEndOfFrame();
                float l = MeanLuma(rig.cam);
                sum += l;
                peak = Mathf.Max(peak, l);
                samples++;
                emptyRenderers = Mathf.Max(emptyRenderers, CountEmptyTextureRenderers(original.transform, weaponId, samples == 20));
                if (!shotMid && Time.time - start > 0.9f)
                {
                    shotMid = true;
                    Shot(rig.cam, $"glare_{weaponId}_{label}_firing");
                }
            }
            wc.testFire = false;
            int shots = original.fireCount - fireBefore;
            float mean = samples > 0 ? sum / samples : 0;
            float drift = Quaternion.Angle(aimRest, rig.cam.transform.rotation);
            Line($"{weaponId}（枪口缩放 {label} = {GunfireOriginalAnimation.MuzzleScale:0.###}）：连射 {shots} 发，开火前亮度 {baseline:F3}，开火中平均 {mean:F3}（涨 {mean - baseline:+0.000;-0.000}）、峰值 {peak:F3}（涨 {peak - baseline:+0.000;-0.000}），采样空贴图的粒子渲染器 {emptyRenderers}，后坐把视线抬了 {drift:F1}°");
            rig.motor.SetLook(yawRest, pitchRest);
            yield return new WaitForSeconds(1.2f);
            if (!judge) yield break;
            if (shots < (def.mode == FireMode.Auto ? 6 : 2)) Fail($"{weaponId}：连射只打出 {shots} 发");
            if (emptyRenderers > 0) Fail($"{weaponId}：枪口粒子有 {emptyRenderers} 个渲染器在采样空贴图（会画成整片方块）");
            if (mean - baseline > MaxMeanRise) Fail($"{weaponId}：连射时画面平均亮度涨 {mean - baseline:F3}，超过 {MaxMeanRise}（糊屏）");
            if (peak - baseline > MaxPeakRise) Fail($"{weaponId}：连射时画面峰值亮度涨 {peak - baseline:F3}，超过 {MaxPeakRise}（闪白）");
        }

        int CountEmptyTextureRenderers(Transform root, string weaponId, bool log)
        {
            int count = 0;
            foreach (var r in root.GetComponentsInChildren<ParticleSystemRenderer>())
            {
                if (!r.enabled || !r.isVisible) continue;
                var m = r.sharedMaterial;
                if (!m || !m.shader || m.shader.name != "Spiritfire/Gunfire/Original Particle") continue;
                bool particleSlot = m.GetFloat("_EffectMode") < 0.5f && m.GetFloat("_UseParticleTexture") > 0.5f;
                var tex = m.GetTexture(particleSlot ? "_ParticleTexture" : "_MainTex");
                if (tex || m.GetFloat("_Alpha") * m.GetFloat("_AlphaFactor") <= 0) continue;
                count++;
                if (log) Line($"{weaponId}：{r.name} 材质 {m.name} 采样空的 {(particleSlot ? "_ParticleTexture" : "_MainTex")}");
            }
            return count;
        }

        static float MeanLuma(Camera cam)
        {
            const int W = 160, H = 90;
            var rt = RenderTexture.GetTemporary(W, H, 24);
            var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            cam.targetTexture = prev;
            var active = RenderTexture.active;
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tex.Apply();
            RenderTexture.active = active;
            RenderTexture.ReleaseTemporary(rt);
            double sum = 0;
            foreach (var c in tex.GetPixels32()) sum += (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255.0;
            Destroy(tex);
            return (float)(sum / (W * H));
        }
    }
}
