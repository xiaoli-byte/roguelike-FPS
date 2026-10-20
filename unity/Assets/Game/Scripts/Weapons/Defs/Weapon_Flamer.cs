using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 朱雀吐息（TS flamer）：全自动 14 跳 / 秒、穿透 3、火 8%。
    /// TS 每跳发一枚 flame 投射物（速度 24、上浮 3、半径 0.32、寿命 0.42 → 射程约 10 m）；Unity 不再每跳生成物体：
    /// projectile 只当数据，开火由 <see cref="FlameCone"/> 接管——共享粒子锥 + 每跳一次 OverlapCapsule 结算（最多命中 1 + 穿透 名敌人，各一次）。
    /// 握持取 TS WeaponHandling.flamer 与枪模 leftHand。
    /// </summary>
    [Defs(110)]
    public sealed class Weapon_Flamer : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "flamer", name = "朱雀吐息", category = "喷火器", kind = WeaponKind.Heavy, prefab = "SK_Weapon_Flamer",
                mode = FireMode.Auto, reload = ReloadStyle.Cell, sfx = "shot_beam", sfxVolume = 0.3f,
                damage = 7.5f, fireRate = 14, mag = 70, reserve = 280, reloadTime = 2.6f,
                spreadTs = new SpreadParams(0.05f, 0.035f, 0, 0.05f, 0.3f),
                recoilPitch = 0.0012f, recoilYaw = 0.0015f,
                critMult = 1.5f, range = 11, pierce = 3, element = Element.Fire, elementChance = 0.08f,
                projectile = new ProjectileSpec
                {
                    speed = 24, gravity = -3, radius = 0.32f, lifetime = 0.42f, scale = 1.1f, color = Hex.Rgb(0xff7a2a), visual = FlameCone.Visual,
                },
                knockback = 0, kickBack = 0.004f, kickRot = 0.006f, shake = 0.012f, flash = 0.09f, aimFov = -6,
                tracerWidth = 0, impactSize = 0.4f, worldScale = 1.3f,
                viewHip = View(0.24f, -0.25f, -0.54f), viewAim = View(0.12f, -0.2f, -0.48f),
                rightHand = Grip(0, -0.003f, 0.014f), rightPitch = -0.04f, leftHand = Grip(0, -0.03f, -0.26f), leftRoll = 0.45f,
                description = "朱雀衔火的喷焰枪，烈焰扑面，贯穿成群之敌。",
                notes = new[] { "近距离持续喷射火焰，射程约 10 米", "火焰可贯穿 3 名敌人" },
            };
        }
    }
}
