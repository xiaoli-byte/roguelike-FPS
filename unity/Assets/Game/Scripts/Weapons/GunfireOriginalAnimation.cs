using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    public sealed class GunfireOriginalAnimation : MonoBehaviour
    {
        public string weaponId;
        public GameObject muzzlePrefab;
        public AudioClip[] shotClips = System.Array.Empty<AudioClip>();
        public AudioClip[] reloadClips = System.Array.Empty<AudioClip>();
        public AudioClip[] reloadDetailClips = System.Array.Empty<AudioClip>();
        public int fireCount, reloadCount;
        public string lastTrigger;

        /// <summary>
        /// 枪口特效整体缩放：1926_muzzle 是原作的通用枪口（材质混着 Boss / 怪物 / 技能特效），按原尺寸挂到第一人称枪口上，
        /// 烟团 2 m 多、光晕 4 m，而枪口离镜头只有约 0.45 m，连射叠起来满屏发白。粒子缩放模式是 Hierarchy，整体缩小即按比例缩小
        /// </summary>
        public static float MuzzleScale = 0.12f;

        WeaponController controller;
        Animator[] animators = System.Array.Empty<Animator>();
        AudioSource audioSource;
        Light[] fireLights = System.Array.Empty<Light>();
        float lightOffAt;
        bool fullCharge, charging;

        public void Bind(WeaponController weapon)
        {
            if (controller)
            {
                controller.Fired -= OnFired;
                controller.Noted -= OnNoted;
            }
            controller = weapon;
            Cache();
            if (!controller) return;
            controller.Fired += OnFired;
            controller.Noted += OnNoted;
        }

        void Awake()
        {
            Cache();
            if (!audioSource)
            {
                audioSource = gameObject.AddComponent<AudioSource>();
                audioSource.playOnAwake = false;
                audioSource.spatialBlend = 0;
                audioSource.volume = 0.8f;
            }
            fireLights = GetComponentsInChildren<Light>(true);
            foreach (var light in fireLights) light.enabled = false;
        }

        void Start() => Bind(GetComponentInParent<WeaponController>());

        void Cache()
        {
            animators = GetComponentsInChildren<Animator>(true);
            foreach (var animator in animators) animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        }

        void Update()
        {
            if (weaponId == "1008" && controller)
            {
                var charge = controller.ActiveMode as ChargeMode;
                fullCharge = charge != null && charge.Full;
                bool active = charge != null && charge.Charge > 0;
                if (active && !charging) Trigger("ForceSaving");
                charging = active;
                foreach (var animator in animators)
                    if (animator && HasParameter(animator, "ForceSaving")) animator.SetBool("ForceSaving", charging);
            }
            if (lightOffAt > 0 && Time.time >= lightOffAt)
            {
                foreach (var light in fireLights) if (light) light.enabled = false;
                lightOffAt = 0;
            }
        }

        void OnDestroy()
        {
            if (!controller) return;
            controller.Fired -= OnFired;
            controller.Noted -= OnNoted;
        }

        bool Owns(WeaponInstance weapon) => weapon?.def != null && weapon.def.prefab == $"SK_Weapon_Gunfire{weaponId}";

        void OnFired(WeaponInstance weapon)
        {
            if (!Owns(weapon)) return;
            fireCount++;
            Trigger(weaponId == "1008" && fullCharge ? "ForceShot" : "Fire");
            var muzzle = WeaponSockets.FindDeep(transform, WeaponSockets.Muzzle);
            if (muzzlePrefab && muzzle)
            {
                var fx = Instantiate(muzzlePrefab, muzzle, false);
                fx.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                fx.transform.localScale = Vector3.one * MuzzleScale;
                PlayerFactory.SetLayer(fx, Layers.FirstPerson);
                foreach (var particles in fx.GetComponentsInChildren<ParticleSystem>(true)) particles.Play(false);
                Destroy(fx, 3f);
            }
            foreach (var light in fireLights) if (light) light.enabled = true;
            lightOffAt = Time.time + 0.06f;
            if (shotClips.Length > 0 && audioSource)
                audioSource.PlayOneShot(shotClips[Random.Range(0, shotClips.Length)]);
        }

        void OnNoted(WeaponNote note, WeaponInstance weapon)
        {
            if (note != WeaponNote.ReloadStarted || !Owns(weapon)) return;
            float duration = WeaponStatsResolver.Resolve(weapon, controller.GetComponent<PlayerVitals>()?.stats).reloadTime;
            foreach (var animator in animators)
            {
                if (!animator || !animator.runtimeAnimatorController || !HasParameter(animator, "ReloadSpeed")) continue;
                float length = 0;
                foreach (var clip in animator.runtimeAnimatorController.animationClips)
                    if (clip && clip.name.Contains("Reload")) length = Mathf.Max(length, clip.length);
                animator.SetFloat("ReloadSpeed", length > 0 && duration > 0 ? length / duration : 1f);
            }
            Trigger("Reload");
            reloadCount++;
            if (audioSource)
            {
                if (reloadClips.Length > 0) audioSource.PlayOneShot(reloadClips[Random.Range(0, reloadClips.Length)]);
                if (reloadDetailClips.Length > 0) audioSource.PlayOneShot(reloadDetailClips[Random.Range(0, reloadDetailClips.Length)]);
            }
        }

        void Trigger(string name)
        {
            lastTrigger = name;
            foreach (var animator in animators)
            {
                if (!animator || !animator.runtimeAnimatorController) continue;
                if ((name == "Reload" || name == "ForceSaving") && animator.name.EndsWith("_Left", System.StringComparison.Ordinal)) continue;
                string state = name == "Fire" && animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "LeftFire" : name;
                if (name == "Fire" && weaponId == "1008") state = "1008_Fire";
                if (name == "Fire" && weaponId == "1004") state = "1004_Fire01";
                if (name == "Fire" && weaponId is "1003" or "1013" or "1014")
                    state = animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "1003_L_Fire02" : "1003_Fire02";
                state = "Base Layer." + state;
                float clipLength = 0;
                foreach (var clip in animator.runtimeAnimatorController.animationClips)
                    if (clip && clip.name.Contains(name == "Fire" && animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "_L_Fire" : name)) clipLength = Mathf.Max(clipLength, clip.length);
                lastTrigger += $":{animator.name}={state},enabled={animator.isActiveAndEnabled},clip={clipLength},speed={animator.speed}";
                animator.CrossFade(state, 0.02f, 0, 0f);
                lastTrigger += $",当前={animator.GetCurrentAnimatorStateInfo(0).shortNameHash},下一={animator.GetNextAnimatorStateInfo(0).shortNameHash}";
            }
        }

        static bool HasParameter(Animator animator, string name)
        {
            foreach (var parameter in animator.parameters)
                if (parameter.name == name) return true;
            return false;
        }
    }
}
