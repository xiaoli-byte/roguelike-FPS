using System.Linq;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    public sealed class GunfireExtraSuite : GunfireOriginalSuite
    {
        public override string Id => "gunfireextra";
        protected override bool IncludeBase => false;
        protected override bool IncludeExtra => true;

        protected override void PrepareRigs(PlayerRig rig)
        {
            var rigs = rig.weapons.rigs.ToList();
            foreach (string sourceId in new[] { "1003", "1004", "1005", "1006", "1009", "1010", "1013", "1014", "1101", "1102" })
            {
                var def = Definition($"gf{sourceId}", sourceId);
                var view = PlayerFactory.BuildWeaponRig(def, HeroLibrary.Get(HeroLibrary.DefaultHero), rig.cam.transform);
                if (view) rigs.Add(new WeaponController.Rig { weaponId = def.id, view = view });
            }
            rig.weapons.rigs = rigs.ToArray();
        }

        protected override WeaponDef Definition(string weaponId, string sourceId)
        {
            string baseId = sourceId switch
            {
                "1005" or "1009" or "1101" => "sniper",
                "1013" or "1014" => "revolver",
                "1102" => "shotgun",
                _ => "rifle",
            };
            var def = JsonUtility.FromJson<WeaponDef>(JsonUtility.ToJson(WeaponLibrary.Get(baseId)));
            def.id = weaponId;
            def.prefab = $"SK_Weapon_Gunfire{sourceId}";
            def.name = $"Gunfire {sourceId}（美术验收）";
            return def;
        }
    }
}
