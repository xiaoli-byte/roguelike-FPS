using System;
using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    public class GunfireOriginalSuite : PlaytestSuite
    {
        public override string Id => "gunfireoriginal";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected virtual bool IncludeBase => true;
        protected virtual bool IncludeExtra => false;
        protected virtual WeaponDef Definition(string weaponId, string sourceId) => WeaponLibrary.Get(weaponId);
        protected virtual void PrepareRigs(PlayerRig rig) { }

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
            PrepareRigs(rig);
            PlayerFactory.Bind(systems, rig);
            SystemsBootstrap.Setup();
            yield return null;
            rig.vitals.invulnerableUntil = Time.time + 9999;
            if (IncludeBase)
            {
                yield return ForwardHitCase(rig);
                foreach (var (weapon, source) in new[] { ("rifle", "1001"), ("smg", "1002"), ("revolver", "1202"), ("railgun", "1008"), ("sniper", "1106"), ("shotgun", "1301") })
                    yield return WeaponCase(rig, weapon, source);
            }
            if (IncludeExtra)
                foreach (var (weapon, source) in new[] { ("gf1003", "1003"), ("gf1004", "1004"), ("gf1005", "1005"), ("gf1006", "1006"), ("gf1009", "1009"), ("gf1010", "1010"), ("gf1013", "1013"), ("gf1014", "1014"), ("gf1101", "1101"), ("gf1102", "1102") })
                    yield return WeaponCase(rig, weapon, source);
            rig.weapons.testFire = false;
            rig.weapons.testReload = false;
            rig.weapons.testAim = false;
        }

        IEnumerator ForwardHitCase(PlayerRig rig)
        {
            var wc = rig.weapons;
            wc.Give(new WeaponInstance(WeaponLibrary.Get("smg")));
            yield return new WaitForSeconds(0.7f);
            var aim = wc.Aim;
            var target = new GameObject("Gunfire Forward Hit Target");
            target.layer = Layers.Character;
            target.transform.SetPositionAndRotation(aim.position + aim.forward * 5, aim.rotation);
            var box = target.AddComponent<BoxCollider>();
            box.size = new Vector3(2, 2, 0.2f);
            var health = target.AddComponent<Damageable>();
            health.prop = true;
            health.noReward = true;
            int hits = 0;
            float direction = -1;
            health.Damaged += (info, result) =>
            {
                hits++;
                direction = Vector3.Dot(info.direction, aim.forward);
            };
            wc.testFire = true;
            float start = Time.time;
            while (hits == 0 && Time.time - start < 5f) yield return null;
            wc.testFire = false;
            Line($"实际前方命中：次数={hits}，命中方向与视线点积={direction:F3}，目标剩余生命={health.health:F0}");
            if (hits == 0 || direction < 0.99f) Fail("1002：实际射击没有命中前方目标");
            Destroy(target);
            yield return null;
        }

        IEnumerator ProgrammaticCase(PlayerRig rig, string weaponId, string sourceId, FirstPersonViewmodel view)
        {
            var motion = view ? view.GetComponent<GunfireOriginalMotion>() : null;
            if (!motion || !motion.HasMotion) yield break;
            var wc = rig.weapons;
            wc.testFire = true;
            float start = Time.time;
            while (motion.fireCount == 0 && Time.time - start < 5f) yield return null;
            wc.testFire = false;
            yield return new WaitForSeconds(0.12f);
            var data = motion.source.motion;
            bool hasLocalRecoil = data.MotionPositionRecoil.sqrMagnitude > 0 || data.MotionRotationRecoil.sqrMagnitude > 0;
            Line($"{sourceId}：原后坐事件 {motion.fireCount}，位移={motion.RecoilPosition}，旋转={motion.RecoilRotation}，配置={data.MotionPositionRecoil}/{data.MotionRotationRecoil}");
            if (motion.fireCount == 0) Fail($"{sourceId}：原运动没有收到开火事件");
            if (hasLocalRecoil && motion.RecoilPosition.magnitude < 1e-6f && motion.RecoilRotation.magnitude < 1e-4f) Fail($"{sourceId}：原后坐没有驱动骨架");
            if (!hasLocalRecoil) Line($"{sourceId}：原武器本地后坐为零，镜头配置={motion.source.camera.RecoilMax_X}/{motion.source.camera.RecoilMax_Y}");
            Shot(rig.cam, $"original_{sourceId}_motion");
        }

        IEnumerator WeaponCase(PlayerRig rig, string weaponId, string sourceId)
        {
            var wc = rig.weapons;
            var def = Definition(weaponId, sourceId);
            var instance = new WeaponInstance(def);
            wc.Give(instance);
            yield return new WaitForSeconds(0.7f);
            var view = wc.rigs.FirstOrDefault(r => r.weaponId == weaponId)?.view;
            var gun = WeaponRigParts.GunOf(view ? view.transform : null, def.prefab);
            var original = gun ? gun.GetComponent<GunfireOriginalAnimation>() : null;
            if (gun)
            {
                int visibleGunMeshes = gun.GetComponentsInChildren<SkinnedMeshRenderer>().Count(r => r.enabled && r.sharedMesh && !r.name.StartsWith("hero_fpp_", StringComparison.Ordinal));
                int visibleLeftGunMeshes = gun.transform.Cast<Transform>().Where(t => t.name.EndsWith("_Left", StringComparison.Ordinal))
                    .Sum(t => t.GetComponentsInChildren<SkinnedMeshRenderer>().Count(r => r.enabled && r.sharedMesh && !r.name.StartsWith("hero_fpp_", StringComparison.Ordinal)));
                if (original && visibleLeftGunMeshes > 0) Fail($"{sourceId}：左侧枪模仍在显示 {visibleLeftGunMeshes} 个网格");
                if (original)
                {
                    var arms = gun.GetComponentsInChildren<SkinnedMeshRenderer>().Where(r => r.name.StartsWith("hero_fpp_", StringComparison.Ordinal)).ToArray();
                    Line($"{sourceId}：角色手臂 {arms.Length} 套，可见枪身网格 {visibleGunMeshes}");
                    if (arms.Length < 2 || arms.Any(r => !r.enabled || !r.sharedMesh || r.bones.Length == 0 || r.bones.Any(b => !b)))
                        Fail($"{sourceId}：原角色手臂网格或骨骼绑定不完整");
                }
                float forwardDot = Vector3.Dot(gun.transform.forward, rig.cam.transform.forward);
                bool correctFacing = view.sourceFacesForward ? forwardDot > 0.99f : forwardDot < -0.99f;
                Line($"{sourceId}：枪模与视线方向点积={forwardDot:F3}，原生正向={view.sourceFacesForward}");
                if (!correctFacing) Fail($"{sourceId}：枪模朝向与源模型定义不符");
            }
            var characterMaterials = gun
                ? gun.GetComponentsInChildren<Renderer>(true).SelectMany(r => r.sharedMaterials)
                    .Where(m => m && m.shader && m.shader.name == "Spiritfire/Gunfire/Original Character").Distinct().ToArray()
                : new Material[0];
            if (characterMaterials.Length == 0) Fail($"{sourceId}：缺少原角色 Shader 材质");
            foreach (var material in characterMaterials)
            {
                if (material.GetTexture("_MetallicGlossMap") != material.IsKeywordEnabled("_METALLICSPECGLOSSMAP")) Fail($"{sourceId}：金属贴图变体不匹配 {material.name}");
                if (material.GetTexture("_OcclusionMap") != material.IsKeywordEnabled("_OCCLUSIONMAP")) Fail($"{sourceId}：遮蔽贴图变体不匹配 {material.name}");
                bool emission = material.GetTexture("_EmissionMap") && material.GetColor("_EmissionColor").maxColorComponent > 0;
                if (emission != material.IsKeywordEnabled("_EMISSION")) Fail($"{sourceId}：自发光变体不匹配 {material.name}");
            }
            var originalMotion = view ? view.GetComponent<GunfireOriginalMotion>() : null;
            if (!originalMotion || !originalMotion.HasMotion) Fail($"{sourceId}：没有加载原运动配置");
            if (sourceId is "1001" or "1106" or "1301" or "1005" or "1009")
            {
                Line($"{sourceId}：使用原程序化运动配置；该武器没有原 AnimationClip");
                yield return ProgrammaticCase(rig, weaponId, sourceId, view);
                yield break;
            }
            if (!original || original.weaponId != sourceId)
            {
                Fail($"{sourceId}：没有加载原生 Prefab");
                yield break;
            }
            var animators = original.GetComponentsInChildren<Animator>(true);
            int meshes = original.GetComponentsInChildren<Renderer>(true).Count(r => r is SkinnedMeshRenderer || r is MeshRenderer);
            int clips = animators.Sum(a => a.runtimeAnimatorController ? a.runtimeAnimatorController.animationClips.Length : 0);
            Line($"原生 {sourceId}：Animator {animators.Length}，控制器动画 {clips}，网格渲染器 {meshes}，原枪声 {original.shotClips.Length}；" +
                 string.Join(" | ", animators.Select(a => $"{a.name} Avatar有效={a.avatar && a.avatar.isValid}")));
            if (animators.Length == 0 || clips == 0 || meshes == 0) Fail($"{sourceId}：原生网格或动画引用不完整");
            if (animators.Any(a => !a.runtimeAnimatorController)) Fail($"{sourceId}：Animator 缺控制器");
            Shot(rig.cam, $"original_{sourceId}_hip");

            var probes = animators.Select(a => WeaponSockets.FindDeep(a.transform, "1102_Bone003") ?? WeaponSockets.FindDeep(a.transform, "Bip001 L Hand") ?? WeaponSockets.FindDeep(a.transform, "Bip001") ?? a.transform).ToArray();
            var restPositions = probes.Select(t => t.position).ToArray();
            var restRotations = probes.Select(t => t.rotation).ToArray();
            int fireBefore = original.fireCount;
            wc.testFire = true;
            float fireStart = Time.time;
            while (original.fireCount <= fireBefore && Time.time - fireStart < 5f) yield return null;
            wc.testFire = false;
            yield return new WaitForEndOfFrame();
            bool fireState = animators.Any(a =>
                a.GetCurrentAnimatorStateInfo(0).IsName("Fire") || a.GetNextAnimatorStateInfo(0).IsName("Fire") ||
                a.GetCurrentAnimatorStateInfo(0).IsName("1008_Fire") || a.GetNextAnimatorStateInfo(0).IsName("1008_Fire") ||
                a.GetCurrentAnimatorStateInfo(0).IsName("1003_Fire02") || a.GetNextAnimatorStateInfo(0).IsName("1003_Fire02") ||
                a.GetCurrentAnimatorStateInfo(0).IsName("1003_L_Fire02") || a.GetNextAnimatorStateInfo(0).IsName("1003_L_Fire02") ||
                a.GetCurrentAnimatorStateInfo(0).IsName("1004_Fire01") || a.GetNextAnimatorStateInfo(0).IsName("1004_Fire01") ||
                a.GetCurrentAnimatorStateInfo(0).IsName("ForceShot") || a.GetNextAnimatorStateInfo(0).IsName("ForceShot"));
            Line($"开火状态 Fire={fireState}，收到开火事件 {original.fireCount}，弹药 {instance.mag}，Fire哈希={Animator.StringToHash("Fire")}，时间倍率={Time.timeScale}，调用 {original.lastTrigger}；" + string.Join(" | ", animators.Select(a =>
            {
                var state = a.GetCurrentAnimatorStateInfo(0);
                var currentClips = a.GetCurrentAnimatorClipInfo(0);
                return $"{a.name} state={state.shortNameHash} 参数={string.Join("/", a.parameters.Select(p => p.name))} clips={string.Join(",", currentClips.Select(c => c.clip ? c.clip.name : "null"))}";
            })));
            if (!fireState) Fail($"{sourceId}：开火没有进入原 Fire 状态");
            int muzzleParticles = original.GetComponentsInChildren<ParticleSystem>().Length;
            var fireLights = original.GetComponentsInChildren<Light>(true);
            bool fireLight = fireLights.Any(l => l.enabled);
            bool originalAudio = original.GetComponent<AudioSource>() && original.GetComponent<AudioSource>().isPlaying;
            Line($"配套效果：枪口粒子 {muzzleParticles}，FireLight={fireLight}（节点 {fireLights.Length}），原声播放={originalAudio}");
            if (muzzleParticles == 0) Fail($"{sourceId}：原枪口粒子没有生成");
            if (fireLights.Length > 0 && !fireLight) Fail($"{sourceId}：原 FireLight 没有闪烁");
            if (original.shotClips.Length > 0 && !originalAudio) Fail($"{sourceId}：原枪声没有播放");
            Shot(rig.cam, $"original_{sourceId}_fire");
            yield return new WaitForSeconds(0.35f);

            instance.mag = Mathf.Max(0, instance.mag - 1);
            wc.testReload = true;
            float start = Time.time;
            while (!wc.Reloading && Time.time - start < 1f) yield return null;
            if (!wc.Reloading)
            {
                Fail($"{sourceId}：换弹未开始");
                yield break;
            }
            wc.testReload = false;
            yield return new WaitForSeconds(0.15f);
            bool reloadState = animators.Any(a => a.GetCurrentAnimatorStateInfo(0).IsName("Reload"));
            bool moved = probes.Where((t, i) => Quaternion.Angle(t.rotation, restRotations[i]) > 0.01f || Vector3.Distance(t.position, restPositions[i]) > 0.0001f).Any();
            Line($"换弹状态 Reload={reloadState}，双手/武器骨骼变化={moved}，原换弹音={original.reloadClips.Length}+{original.reloadDetailClips.Length}");
            if (!reloadState) Fail($"{sourceId}：没有进入原 Reload 状态");
            if (!moved) Fail($"{sourceId}：原骨骼没有实际运动");
            if (original.reloadClips.Length > 0 && (original.reloadCount == 0 || !original.GetComponent<AudioSource>().isPlaying)) Fail($"{sourceId}：原换弹音没有播放");
            start = Time.time;
            bool captured = false;
            while (wc.Reloading && Time.time - start < 8f)
            {
                if (!captured && wc.ReloadProgress >= 0.5f)
                {
                    captured = true;
                    Shot(rig.cam, $"original_{sourceId}_reload");
                }
                yield return null;
            }
            if (!captured) Fail($"{sourceId}：换弹未完成");
        }
    }
}
