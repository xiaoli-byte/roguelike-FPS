using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蚀蛊灯（TS lantern）：缓缓上飘的追踪蛊灯（发射 0.1 s 后开始转向、穿过追踪目标后立刻换下一个），穿透 6 名敌人。
    /// 蛊种全部来自固有词条「蛊种」50%（<see cref="Affix_Seed"/>，同 TS innate：不随稀有度放大，同 id 不会再抽到）：
    /// 每个被灯直接穿过的活敌人都种下 6 s 蛊种，它发生任何元素反应时以 50% 威力传染给 8 m 内另一名敌人。
    /// TS 里没有秘卷直接读蛊种，Unity 同样只走词条派发（<see cref="AffixEffects.OnReaction"/>）。
    /// 外观用 Unity 新增的「lantern」弹体（TS 是 orb）；换弹是 cell 风格（灯芯，TS WeaponHandling 的 wick）。
    /// </summary>
    [Defs(160)]
    public sealed class Weapon_Lantern : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "lantern", name = "蚀蛊灯", category = "蛊灯", kind = WeaponKind.Launcher, prefab = "SK_Weapon_Lantern",
                mode = FireMode.Semi, reload = ReloadStyle.Cell, sfx = "shot_launcher", sfxVolume = 0.4f,
                damage = 55, fireRate = 1.6f, mag = 8, reserve = 48, reloadTime = 2.0f,
                spreadTs = new SpreadParams(0.01f, 0.004f, 0.006f, 0.02f, 0.1f),
                recoilPitch = 0.012f, recoilYaw = 0.004f,
                critMult = 1.8f, range = 60, pierce = 6,
                projectile = new ProjectileSpec
                {
                    speed = 14, gravity = -0.3f, radius = 0.38f, lifetime = 3.2f, visual = "lantern", scale = 1.5f, homing = 2.2f,
                    color = Hex.Rgb(0x9dff4a),
                },
                element = Element.Corrode, elementChance = 0.6f,
                innate = new[] { new WeaponAffix(Affix_Seed.Id, 0.5f) },
                aimFov = -8,
                knockback = 0.6f, kickBack = 0.03f, kickRot = 0.07f, shake = 0.04f, flash = 0.1f,
                tracerWidth = 0, impactSize = 0.8f, worldScale = 1.4f, dropWeight = 0.8f,
                viewHip = View(0.24f, -0.22f, -0.5f), viewAim = View(0.06f, -0.15f, -0.42f),
                rightHand = Grip(0, 0.008f, 0.004f), rightPitch = 0.12f, leftHand = Grip(0, -0.02f, -0.12f), leftRoll = 0.2f,
                description = "南疆巫祝的养蛊铜灯，灯火所照之处，瘴疠横生。",
                notes = new[] { "发射缓缓飘行的蛊灯，自动寻敌并穿透多名敌人" },
            };
        }
    }
}
