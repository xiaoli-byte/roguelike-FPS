using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜂鸣冲锋枪（TS smg）。燎的初始武器。
    /// [Defs(order)] 用 TS WEAPON_DEFS 的下标 × 10：revolver 0 · smg 10 · rifle 20 · burst 30 · shotgun 40 · sniper 50 · launcher 60 ·
    /// crossbow 70 · beam 80 · minigun 90 · swarm 100 · flamer 110 · stormpod 120 · magmashot 130 · trinity 140 · railgun 150 ·
    /// lantern 160 · demon_blade 170。
    /// </summary>
    [Defs(10)]
    public sealed class Weapon_Smg : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "smg", name = "蜂鸣冲锋枪", category = "冲锋枪", kind = WeaponKind.Smg, prefab = "SK_Weapon_Smg",
                mode = FireMode.Auto, reload = ReloadStyle.Magazine, sfx = "shot_smg", sfxVolume = 0.6f,
                damage = 11, fireRate = 13, mag = 36, reserve = 252, reloadTime = 1.7f,
                spreadTs = new SpreadParams(0.03f, 0.016f, 0.0035f, 0.07f, 0.2f),
                spreadTuned = new SpreadParams(0.012f, 0.005f, 0.001f, 0.026f, 0.6f),
                recoilPitch = 0.0045f, recoilYaw = 0.0026f, recoilBias = 0.0002f, recoilClimb = 0.015f,
                critMult = 2, range = 45, falloffStart = 16, falloffEnd = 40, falloffMult = 0.55f,
                knockback = 0.25f, kickBack = 0.012f, kickRot = 0.03f, shake = 0.035f, flash = 0.12f, aimFov = -10,
                tracerWidth = 0.02f, impactSize = 0.6f, worldScale = 1.45f,
                elementChance = 0.08f, viewHip = View(0.21f, -0.2f, -0.46f), viewAim = View(0, -0.1f, -0.36f),
                rightHand = Grip(0, 0, 0), leftHand = Grip(0, 0.02f, -0.235f), leftRoll = 0.04f,
                description = "嗡鸣不止的轻型冲锋枪，近距离弹幕压制。",
                notes = new[] { "高射速，远距离伤害衰减明显" },
            };
        }
    }
}
