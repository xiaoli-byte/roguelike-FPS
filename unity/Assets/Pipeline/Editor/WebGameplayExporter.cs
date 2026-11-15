using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    public static class WebGameplayExporter
    {
        public static void ExportAll()
        {
            const string directory = "../public/assets/unity-gameplay";
            Directory.CreateDirectory(directory);
            var document = new JObject
            {
                ["schema"] = 1,
                ["heroes"] = new JArray(HeroLibrary.All.Select(hero => new JObject
                {
                    ["id"] = hero.id,
                    ["name"] = hero.name,
                    ["title"] = hero.title,
                    ["description"] = hero.description,
                    ["maxHp"] = hero.maxHp,
                    ["maxShield"] = hero.maxShield,
                    ["moveSpeed"] = hero.moveSpeed,
                    ["startWeapon"] = hero.startWeapon,
                    ["armR"] = hero.armR,
                    ["armL"] = hero.armL,
                    ["passiveName"] = hero.passiveName,
                    ["passiveDescription"] = hero.passiveDescription,
                })),
                ["enemies"] = new JArray(EnemyRoster.All.Select(enemy => new JObject
                {
                    ["id"] = enemy.id,
                    ["prefab"] = enemy.prefab,
                    ["name"] = enemy.name,
                    ["hp"] = enemy.hp,
                    ["armor"] = enemy.armor,
                    ["shield"] = enemy.shield,
                    ["speed"] = enemy.speed,
                    ["damage"] = enemy.damage,
                    ["knockbackResist"] = enemy.knockbackResist,
                    ["scale"] = enemy.scale,
                    ["weakBone"] = enemy.weakBone,
                    ["weakRadius"] = enemy.weakRadius,
                    ["placementRole"] = (int)enemy.placementRole,
                    ["flying"] = enemy.flying,
                    ["groundOnly"] = enemy.groundOnly,
                    ["charger"] = enemy.charger,
                    ["coins"] = new JArray(enemy.coins.x, enemy.coins.y),
                    ["essence"] = enemy.essence,
                    ["poise"] = enemy.poise,
                    ["staggerSeconds"] = enemy.staggerSeconds,
                    ["hitch"] = enemy.hitch,
                    ["radius"] = enemy.radius,
                    ["height"] = enemy.height,
                    ["weakHeight"] = enemy.WeakHeight,
                })),
                ["weapons"] = new JArray(WeaponLibrary.All.Select(weapon => JObject.Parse(JsonUtility.ToJson(weapon)))),
                ["bosses"] = new JArray(Bosses.All.Select(boss => JObject.Parse(JsonUtility.ToJson(boss)))),
            };
            File.WriteAllText(Path.Combine(directory, "defs.json"), document.ToString(Formatting.Indented));
        }
    }
}
