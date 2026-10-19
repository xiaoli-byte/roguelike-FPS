using System.Collections.Generic;
using UnityEngine;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 青冥雷蛊（TS stormpod）：弹跳蛊弹，蚀雷双属。固有「副·雷」40% 目前走 subElement / subChance（innate 只是数据，AF 接管后二选一）。
    /// 音量 0.5 是 Unity 手调值（TS 0.8）；反弹用完贴地滚动（rollAfter）是 Unity 独有。
    /// </summary>
    [Defs(120)]
    public sealed class Weapon_Stormpod : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "stormpod", name = "青冥雷蛊", category = "发射器", kind = WeaponKind.Launcher, prefab = "SK_Weapon_Stormpod",
                mode = FireMode.Semi, reload = ReloadStyle.Cylinder, sfx = "shot_launcher", sfxVolume = 0.5f,
                damage = 95, fireRate = 1.2f, mag = 5, reserve = 30, reloadTime = 2.5f,
                spreadTs = new SpreadParams(0.012f, 0.005f, 0.012f, 0.03f, 0.1f),
                spreadTuned = new SpreadParams(0.005f, 0.002f, 0.005f, 0.012f, 0.3f),
                recoilPitch = 0.04f, recoilYaw = 0.008f,
                critMult = 1.6f, range = 90, element = Element.Corrode, elementChance = 0.6f, subElement = Element.Shock, subChance = 0.4f,
                innate = new[] { new WeaponAffix("subShock", 0.4f) },
                projectile = new ProjectileSpec
                {
                    speed = 30, gravity = 14, radius = 0.15f, explosionRadius = 3.2f, lifetime = 1.8f, scale = 0.9f, bounces = 2, rollAfter = true,
                    explodeOnExpire = true, color = new Color(0.62f, 1f, 0.29f), visual = "orb",
                },
                knockback = 4, kickBack = 0.06f, kickRot = 0.12f, shake = 0.13f, flash = 0.2f, aimFov = -10,
                tracerWidth = 0, impactSize = 0.9f, worldScale = 1.4f,
                viewHip = View(0.23f, -0.24f, -0.52f), viewAim = View(0.08f, -0.17f, -0.44f),
                rightHand = Grip(0, 0, 0), leftHand = Grip(0, -0.02f, -0.2f),
                description = "以青铜蛊罐封存雷蛊与蚀毒的弹跳榴弹，落地翻滚，炸开一片青雷。",
                notes = new[] { "蛊弹撞墙反弹 2 次，触敌或 1.8 秒后爆炸", "蚀雷双属，易引发「封脉」" },
            };
        }
    }
}
