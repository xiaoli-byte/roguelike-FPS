using System.Collections.Generic;
using UnityEngine;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>焚城榴弹（TS launcher）：抛物线燃烧榴弹</summary>
    [Defs(60)]
    public sealed class Weapon_Launcher : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "launcher", name = "焚城榴弹", category = "发射器", kind = WeaponKind.Launcher, prefab = "SK_Weapon_Launcher",
                mode = FireMode.Semi, reload = ReloadStyle.Tube, sfx = "shot_launcher", sfxVolume = 0.9f,
                damage = 110, fireRate = 1.1f, mag = 4, reserve = 20, reloadTime = 2.4f,
                spreadTs = new SpreadParams(0.012f, 0.005f, 0.012f, 0.03f, 0.1f),
                spreadTuned = new SpreadParams(0.005f, 0.002f, 0.005f, 0.012f, 0.3f),
                recoilPitch = 0.03f, recoilYaw = 0.004f,
                critMult = 1.8f, range = 120, element = Element.Fire, elementChance = 0.6f,
                projectile = new ProjectileSpec
                {
                    speed = 34, gravity = 9, radius = 0.14f, explosionRadius = 4, lifetime = 3.2f, scale = 1.1f, explodeOnExpire = true,
                    color = new Color(1f, 0.54f, 0.23f), visual = "grenade",
                },
                knockback = 7, kickBack = 0.07f, kickRot = 0.14f, shake = 0.16f, flash = 0.26f, aimFov = -10,
                tracerWidth = 0, impactSize = 1, worldScale = 1.35f,
                viewHip = View(0.23f, -0.24f, -0.52f), viewAim = View(0.1f, -0.18f, -0.44f),
                rightHand = Grip(0, 0, 0), leftHand = Grip(0, -0.01f, -0.27f),
                description = "发射燃烧榴弹的转轮发射器，所过之处尽成火海。",
                notes = new[] { "榴弹沿抛物线飞行，命中或落地后爆炸" },
            };
        }
    }
}
