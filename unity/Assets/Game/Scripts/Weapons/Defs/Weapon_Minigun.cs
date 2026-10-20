using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旋风机炮（TS minigun）：按住预热 0.6 s 才开火（<see cref="SpinupMode"/>），转满开火期间移速 −2——
    /// 由控制器登记成属性来源 <see cref="WeaponController.SlowSource"/>（W1），定义只给 spinup / moveSlow。
    /// 握持取 TS WeaponHandling.minigun（右手偏下、左手侧握提把）与枪模 leftHand。
    /// </summary>
    [Defs(90)]
    public sealed class Weapon_Minigun : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "minigun", name = "旋风机炮", category = "重武器", kind = WeaponKind.Heavy, prefab = "SK_Weapon_Minigun",
                mode = FireMode.Spinup, reload = ReloadStyle.Box, sfx = "shot_heavy", sfxVolume = 0.55f,
                damage = 7.5f, fireRate = 20, mag = 120, reserve = 480, reloadTime = 3.4f, spinup = 0.6f, moveSlow = 2,
                spreadTs = new SpreadParams(0.04f, 0.028f, 0.0012f, 0.065f, 0.2f),
                recoilPitch = 0.003f, recoilYaw = 0.0022f, recoilClimb = 0.005f,
                critMult = 1.8f, range = 60, falloffStart = 25, falloffEnd = 60, falloffMult = 0.6f,
                knockback = 0.3f, kickBack = 0.01f, kickRot = 0.012f, shake = 0.05f, flash = 0.16f, aimFov = -10,
                tracerWidth = 0.022f, impactSize = 0.6f, worldScale = 1.25f,
                elementChance = 0.06f, viewHip = View(0.24f, -0.26f, -0.56f), viewAim = View(0.14f, -0.22f, -0.5f),
                rightHand = Grip(0, -0.012f, -0.005f), rightPitch = 0.12f, leftHand = Grip(-0.085f, 0.03f, -0.2f), leftRoll = 0.6f,
                description = "六管旋转机炮，转起来便是一场钢铁风暴。",
                notes = new[] { "按住预热 0.6 秒后开火", "开火时移动速度降低" },
            };
        }
    }
}
