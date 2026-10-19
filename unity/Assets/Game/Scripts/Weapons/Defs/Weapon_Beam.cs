using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>雷弧发射器（TS beam）：按住持续放电，电弧弹射 1 个敌人</summary>
    [Defs(80)]
    public sealed class Weapon_Beam : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "beam", name = "雷弧发射器", category = "光束", kind = WeaponKind.Beam, prefab = "SK_Weapon_Beam",
                mode = FireMode.Beam, reload = ReloadStyle.Cell, sfx = "shot_beam", sfxVolume = 0.35f,
                damage = 8, fireRate = 10, mag = 100, reserve = 400, reloadTime = 2.2f,
                spreadTs = new SpreadParams(0.012f, 0.006f, 0, 0, 1),
                spreadTuned = new SpreadParams(0.005f, 0.0025f, 0, 0, 1),
                recoilPitch = 0.0004f, recoilYaw = 0.0006f,
                critMult = 1.8f, range = 25, element = Element.Shock, elementChance = 0.1f, chainFraction = 0.4f, chainRange = 7,
                knockback = 0, kickBack = 0.003f, kickRot = 0.004f, shake = 0.012f, flash = 0.14f, aimFov = -10,
                tracerWidth = 0.07f, impactSize = 0.45f,
                viewHip = View(0.22f, -0.22f, -0.48f), viewAim = View(0.05f, -0.14f, -0.4f),
                rightHand = Grip(0, 0, 0), leftHand = Grip(0, 0, -0.17f),
                description = "释放持续雷弧的能量武器，电流会在敌群间跳跃。",
                notes = new[] { "按住持续放电，射程 25 米", "命中时电弧弹射至附近 1 名敌人（40% 伤害）" },
            };
        }
    }
}
