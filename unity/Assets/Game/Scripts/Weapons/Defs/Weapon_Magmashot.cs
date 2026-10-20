using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 赤蛟霰铳（TS magmashot）：双管霰弹，一次 8 枚弹丸，火属；固有「副·蚀」6%（<see cref="Affix_SubCorrode"/>，同 TS innate：
    /// 每颗弹丸命中各掷一次，同一发对同一敌人只附着一次），火蚀双属易引发「熔金」。
    /// 换弹：连开两枪后逐发装填（准备 0.3 s、每发 0.55 s，装完上膛 0.3 s，装填中开火可打断）；第一人称折开枪管（<see cref="BreakAction"/>，
    /// 美术枪模还没有枪管关节——W3 拆出前整枪绕铰链点低头代替）。弹丸锥角取 TS 原值 0.09（散布四项按 D11 × 0.4）。
    /// </summary>
    [Defs(130)]
    public sealed class Weapon_Magmashot : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "magmashot", name = "赤蛟霰铳", category = "霰弹枪", kind = WeaponKind.Shotgun, prefab = "SK_Weapon_Magmashot",
                mode = FireMode.Semi, reload = ReloadStyle.Shell, sfx = "shot_shotgun", sfxVolume = 1.0f,
                damage = 11, pellets = 8, pelletCone = 0.09f, fireRate = 2.5f, mag = 2, reserve = 36,
                reloadTime = 1.4f, shellTime = 0.55f, reloadStart = 0.3f,
                spreadTs = new SpreadParams(0.01f, 0.005f, 0.015f, 0.035f, 0.12f),
                recoilPitch = 0.06f, recoilYaw = 0.014f,
                critMult = 2, range = 28, falloffStart = 8, falloffEnd = 26, falloffMult = 0.35f,
                element = Element.Fire, elementChance = 0.07f,
                innate = new[] { new WeaponAffix(Affix_SubCorrode.Id, 0.06f) },
                aimFov = -8,
                knockback = 1.0f, kickBack = 0.09f, kickRot = 0.25f, shake = 0.24f, flash = 0.28f,
                tracerWidth = 0.014f, impactSize = 0.5f, worldScale = 1.3f,
                viewHip = View(0.22f, -0.22f, -0.5f), viewAim = View(0, -0.075f, -0.4f),
                rightHand = Grip(0, 0.006f, 0.02f), rightPitch = -0.1f, leftHand = Grip(0, -0.02f, -0.16f), leftRoll = -0.12f,
                description = "双管并列的赤蛟霰铳，铁砂裹着熔火与蚀液，专剥重甲。",
                notes = new[] { "双管：连开两枪后逐发装填，装填中开火可打断", "一次射出 8 枚弹丸", "火蚀双属，易引发「熔金」" },
            };
        }
    }
}
