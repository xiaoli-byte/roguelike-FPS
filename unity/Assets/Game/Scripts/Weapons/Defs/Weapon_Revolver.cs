using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>赤铜左轮（TS revolver）。音量 1.0 是 Unity 手调值（TS 缺省 0.8）</summary>
    [Defs(0)]
    public sealed class Weapon_Revolver : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "revolver", name = "赤铜左轮", category = "手枪", kind = WeaponKind.Pistol, prefab = "SK_Weapon_Revolver",
                mode = FireMode.Semi, reload = ReloadStyle.Cylinder, sfx = "shot_pistol", sfxVolume = 1f,
                damage = 38, fireRate = 3.5f, mag = 8, reserve = 64, reloadTime = 1.6f,
                spreadTs = new SpreadParams(0.004f, 0.0012f, 0.014f, 0.04f, 0.16f),
                spreadTuned = new SpreadParams(0.003f, 0.001f, 0.005f, 0.014f, 0.4f),
                recoilPitch = 0.022f, recoilYaw = 0.004f,
                critMult = 2.5f, range = 80, falloffStart = 35, falloffEnd = 80, falloffMult = 0.7f,
                knockback = 1.5f, kickBack = 0.06f, kickRot = 0.22f, shake = 0.09f, flash = 0.12f, aimFov = -12,
                tracerWidth = 0.03f, impactSize = 0.9f, worldScale = 1.9f,
                elementChance = 0.3f, viewHip = View(0.2f, -0.17f, -0.42f), viewAim = View(0, -0.089f, -0.34f),
                rightHand = Grip(0, -0.003f, 0), rightPitch = -0.02f, leftHand = Grip(-0.034f, -0.04f, 0.035f), leftRoll = 0.65f,
                description = "赤铜铸就的八膛转轮手枪，弹道笔直，爆头倍率极高。",
                notes = new[] { "弹道极准，适合点射爆头" },
            };
        }
    }
}
