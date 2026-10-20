using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 贯虹灵炮（TS railgun）：蓄力命中扫描（<see cref="ChargeMode"/>）。按住 0.9 s 蓄满（射速加成同时加快蓄力），松手发射；
    /// 伤害倍率 0.2 + 0.8·t²，反馈强度 0.4 + 0.6·t；满蓄额外穿透 3（基础穿透 1，共 4），命中引爆目标身上的元素状态
    /// （<see cref="ReactionSystem.Detonate"/>，威力 = 本击伤害，上限最大生命 50%），弹道追加虹光（<see cref="RailgunBeam"/>）。
    /// 第一人称：线圈随蓄力加速旋转、枪口聚光、枪身灵纹增亮、满蓄后闪烁（<see cref="RailgunCharge"/>）。
    /// </summary>
    [Defs(150)]
    public sealed class Weapon_Railgun : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "railgun", name = "贯虹灵炮", category = "蓄能炮", kind = WeaponKind.Rifle, prefab = "SK_Weapon_Railgun",
                mode = FireMode.Charge, reload = ReloadStyle.Cell, sfx = "shot_sniper", sfxVolume = 0.9f,
                damage = 155, fireRate = 2, mag = 6, reserve = 36, reloadTime = 2.4f,
                chargeTime = 0.9f, chargeMinMult = 0.2f, chargeFullPierce = 3, chargeDetonate = true,
                spreadTs = new SpreadParams(0.01f, 0, 0.02f, 0.05f, 0.15f),
                recoilPitch = 0.05f, recoilYaw = 0.008f,
                critMult = 2.5f, range = 200, pierce = 1,
                element = Element.None, elementChance = 0.35f,
                aimFov = -24, aimSpeed = 12,
                knockback = 4, kickBack = 0.08f, kickRot = 0.16f, shake = 0.18f, flash = 0.2f,
                tracerWidth = 0.09f, impactSize = 1.3f, worldScale = 1.1f, dropWeight = 0.8f,
                viewHip = View(0.22f, -0.22f, -0.52f), viewAim = View(0, -0.13f, -0.36f),
                rightHand = Grip(0, -0.001f, 0.01f), rightPitch = 0, leftHand = Grip(0, -0.02f, -0.32f), leftRoll = -0.18f,
                description = "以双轨灵纹束缚长虹的蓄能炮，一击贯穿，引万象归一。",
                notes = new[] { "按住蓄力 0.9 秒，松开发射；蓄力越满伤害越高（20%–100%）", "满蓄：额外穿透 3 名敌人，并「引爆」命中目标身上的元素状态" },
            };
        }
    }
}
