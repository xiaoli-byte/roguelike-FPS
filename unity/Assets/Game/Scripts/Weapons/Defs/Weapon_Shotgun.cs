using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>碎岩霰弹（TS shotgun）：逐发装填。弹丸锥角 0.06 是 Unity 手调值（TS 0.075）</summary>
    [Defs(40)]
    public sealed class Weapon_Shotgun : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "shotgun", name = "碎岩霰弹", category = "霰弹枪", kind = WeaponKind.Shotgun, prefab = "SK_Weapon_Shotgun",
                mode = FireMode.Semi, reload = ReloadStyle.Shell, sfx = "shot_shotgun", sfxVolume = 0.9f,
                damage = 12, pellets = 9, pelletCone = 0.06f, fireRate = 1.4f, mag = 6, reserve = 42,
                reloadTime = 3.6f, shellTime = 0.48f, reloadStart = 0.4f,
                spreadTs = new SpreadParams(0.008f, 0.004f, 0.012f, 0.03f, 0.1f),
                spreadTuned = new SpreadParams(0.004f, 0.002f, 0.004f, 0.012f, 0.3f),
                recoilPitch = 0.035f, recoilYaw = 0.006f,
                critMult = 2, range = 32, falloffStart = 9, falloffEnd = 30, falloffMult = 0.35f,
                knockback = 0.9f, kickBack = 0.085f, kickRot = 0.22f, shake = 0.22f, flash = 0.24f, aimFov = -10,
                tracerWidth = 0.014f, impactSize = 0.5f,
                elementChance = 0.06f, viewHip = View(0.22f, -0.22f, -0.5f), viewAim = View(0, -0.096f, -0.4f),
                rightHand = Grip(0, 0.006f, 0.02f), rightPitch = -0.12f, leftHand = Grip(0, -0.002f, -0.3f),
                description = "以碎岩为铳管衬里的泵动霰弹枪，贴脸一击足以撼山。",
                notes = new[] { "一次射出 9 枚弹丸，近距离威力巨大", "逐发装填，装填中开火可打断" },
            };
        }
    }
}
