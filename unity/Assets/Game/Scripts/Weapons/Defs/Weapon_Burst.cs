using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三叠点射枪（TS burst）：扣一下 3 连发（轮内 0.065 s，射速 = 每秒 1.6 轮，见 <see cref="BurstMode"/>）。
    /// 握持取 TS WeaponHandling.burst 与枪模 leftHand；筒式瞄具由 <see cref="Handling_Burst"/> 补程序网格（WC1），开镜视线从筒中间穿过。
    /// </summary>
    [Defs(30)]
    public sealed class Weapon_Burst : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "burst", name = "三叠点射枪", category = "步枪", kind = WeaponKind.Rifle, prefab = "SK_Weapon_Burst",
                mode = FireMode.Burst, reload = ReloadStyle.Magazine, sfx = "shot_rifle", sfxVolume = 0.7f,
                damage = 24, fireRate = 1.6f, burstCount = 3, burstInterval = 0.065f, mag = 24, reserve = 168, reloadTime = 2.1f,
                spreadTs = new SpreadParams(0.012f, 0.003f, 0.004f, 0.035f, 0.14f),
                recoilPitch = 0.007f, recoilYaw = 0.0014f, recoilBias = 0.0002f, recoilClimb = 0.01f,
                critMult = 2.2f, range = 90, falloffStart = 45, falloffEnd = 90, falloffMult = 0.75f,
                knockback = 0.5f, kickBack = 0.02f, kickRot = 0.05f, shake = 0.06f, flash = 0.14f, aimFov = -16,
                tracerWidth = 0.026f, impactSize = 0.8f,
                elementChance = 0.14f, viewHip = View(0.22f, -0.21f, -0.5f), viewAim = View(0, -0.132f, -0.38f),
                rightHand = Grip(0, 0, 0), leftHand = Grip(0, -0.005f, -0.24f), leftRoll = 0.1f,
                description = "三管叠列的点射步枪，一次扣动打出三发精准弹丸。",
                notes = new[] { "每次扣动扳机打出三连发" },
            };
        }
    }
}
