using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 追魂连弩（TS crossbow）：高速弩箭，穿透 3 名敌人（投射物穿透：每个敌人只吃一次、伤害不衰减，见 <see cref="PlayerProjectile"/>）。
    /// 弩弦与弩箭是程序化零件（美术枪模按约定不画弦和箭）：开枪后弦松、箭消失，按射击冷却重新上弦，上满弦才露出下一支箭（<see cref="CrossbowString"/>）。
    /// 握持取 TS WeaponHandling（boltClip：顶置箭匣），左手托在 TS 枪模的前托点。
    /// </summary>
    [Defs(70)]
    public sealed class Weapon_Crossbow : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "crossbow", name = "追魂连弩", category = "弩", kind = WeaponKind.Crossbow, prefab = "SK_Weapon_Crossbow",
                mode = FireMode.Semi, reload = ReloadStyle.Magazine, sfx = "shot_bow", sfxVolume = 0.8f,
                damage = 55, fireRate = 2, mag = 10, reserve = 60, reloadTime = 2.1f,
                spreadTs = new SpreadParams(0.008f, 0.0015f, 0.008f, 0.03f, 0.12f),
                recoilPitch = 0.012f, recoilYaw = 0.002f,
                critMult = 2.2f, range = 150, pierce = 3,
                projectile = new ProjectileSpec
                {
                    speed = 95, gravity = 3, radius = 0.09f, lifetime = 1.6f, visual = "arrow", color = Hex.Rgb(0xd8e6ff),
                },
                elementChance = 0.3f, aimFov = -18,
                knockback = 2, kickBack = 0.03f, kickRot = 0.06f, shake = 0.05f, flash = 0,
                tracerWidth = 0, impactSize = 0.7f,
                viewHip = View(0.22f, -0.21f, -0.5f), viewAim = View(0, -0.16f, -0.36f),
                rightHand = Grip(0, -0.004f, 0.008f), rightPitch = 0.02f, leftHand = Grip(0, 0.01f, -0.25f), leftRoll = -0.1f,
                description = "机括连发的重弩，弩箭破风而出，连穿数敌。",
                notes = new[] { "弩箭高速飞行，可贯穿多名敌人" },
            };
        }
    }
}
