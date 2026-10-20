using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹰隼狙击（TS sniper）：栓动、穿透 2、开镜 −45°（过渡 aimSpeed 11）。
    /// 开镜（视角层 &lt; −30°，同 TS SCOPE_KICK）时：狙击镜遮罩 <see cref="ScopeOverlay"/>、隐藏枪模（<see cref="SightPart"/>）、
    /// 散布归零（控制器按 <see cref="WeaponSight.Scoped"/>）、准星收起；换弹时控制器不允许开镜，所以换弹即退镜。
    /// 握持取 TS WeaponHandling.sniper 与枪模 leftHand；瞄准镜在美术网格里（不是 PROCEDURAL_PARTS），开镜时枪模整体隐藏。
    /// </summary>
    [Defs(50)]
    public sealed class Weapon_Sniper : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "sniper", name = "鹰隼狙击", category = "狙击枪", kind = WeaponKind.Sniper, prefab = "SK_Weapon_Sniper",
                mode = FireMode.Semi, reload = ReloadStyle.Magazine, sfx = "shot_sniper", sfxVolume = 1f,
                damage = 160, fireRate = 0.9f, mag = 5, reserve = 30, reloadTime = 3.2f,
                spreadTs = new SpreadParams(0.028f, 0, 0.03f, 0.07f, 0.12f),
                recoilPitch = 0.042f, recoilYaw = 0.005f,
                critMult = 3, range = 220, pierce = 2,
                knockback = 5, kickBack = 0.09f, kickRot = 0.2f, shake = 0.2f, flash = 0.26f, aimFov = -45, aimSpeed = 11,
                tracerWidth = 0.06f, impactSize = 1.4f, worldScale = 1.05f,
                elementChance = 0.7f, viewHip = View(0.22f, -0.22f, -0.52f), viewAim = View(0, -0.12f, -0.3f),
                rightHand = Grip(0, -0.001f, 0.01f), rightPitch = -0.06f, leftHand = Grip(0, 0.004f, -0.3f), leftRoll = -0.06f,
                description = "鹰眼般的栓动狙击枪，开镜后弹无虚发。",
                notes = new[] { "开镜后零散布", "子弹可贯穿多名敌人" },
            };
        }
    }
}
