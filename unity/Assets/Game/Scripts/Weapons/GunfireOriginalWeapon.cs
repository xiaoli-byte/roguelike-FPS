using System;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    public static class GunfireOriginalWeapon
    {
        public static string SourceId(Transform root)
        {
            const string prefix = "SK_Weapon_Gunfire";
            return root && root.name.StartsWith(prefix, StringComparison.Ordinal) ? root.name.Substring(prefix.Length) : null;
        }

        public static GameObject Instantiate(string weaponId, Transform parent, float scale)
        {
            if (weaponId is "1001" or "1106" or "1301") return null;
            var prefab = Resources.Load<GameObject>($"Gunfire/Weapons/{weaponId}");
            if (!prefab) return null;
            var go = UnityEngine.Object.Instantiate(prefab, parent, false);
            go.name = $"SK_Weapon_Gunfire{weaponId}";
            go.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            go.transform.localScale = new Vector3(-0.24f, 0.24f, 0.24f);
            foreach (Transform child in go.transform)
            {
                if (child.name.EndsWith("_Drop", StringComparison.Ordinal) || child.name.EndsWith("_Show", StringComparison.Ordinal))
                    child.gameObject.SetActive(false);
            }
            foreach (var collider in go.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (var renderer in go.GetComponentsInChildren<Renderer>(true))
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var sockets = go.GetComponent<WeaponSockets>() ?? go.AddComponent<WeaponSockets>();
            sockets.weaponId = weaponId;
            if (!sockets.muzzle) sockets.muzzle = WeaponSockets.FindDeep(go.transform, WeaponSockets.Muzzle);
            return go;
        }

        public static void ApplyOriginalMaterials(string weaponId, GameObject gun)
        {
            var main = Resources.Load<Material>($"Gunfire/Materials/{weaponId}");
            if (!main) return;
            var shell = weaponId == "1301" ? Resources.Load<Material>("Gunfire/Materials/1301_shell") : null;
            foreach (var renderer in gun.GetComponentsInChildren<Renderer>(true))
            {
                var materials = renderer.sharedMaterials;
                for (int i = 0; i < materials.Length; i++)
                    materials[i] = shell && materials[i] && materials[i].name.Contains("shell", StringComparison.OrdinalIgnoreCase) ? shell : main;
                renderer.sharedMaterials = materials;
            }
        }

        public static void PlayMuzzle(Transform socket)
        {
            if (!socket) return;
            var prefab = Resources.Load<GameObject>("Gunfire/Effects/1926_muzzle");
            if (!prefab) return;
            var fx = UnityEngine.Object.Instantiate(prefab, socket, false);
            fx.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            foreach (var particles in fx.GetComponentsInChildren<ParticleSystem>(true)) particles.Play(false);
            UnityEngine.Object.Destroy(fx, 3f);
        }

        public static bool PlayShotAudio(string weaponId, Transform socket)
        {
            if (weaponId != "1202" || !socket) return false;
            int shot = UnityEngine.Random.Range(1, 4);
            var clip = Resources.Load<AudioClip>($"Gunfire/Audio/weapon_1202_1p_shot{shot}");
            if (!clip) return false;
            AudioSource.PlayClipAtPoint(clip, socket.position, 0.8f);
            return true;
        }
    }
}
