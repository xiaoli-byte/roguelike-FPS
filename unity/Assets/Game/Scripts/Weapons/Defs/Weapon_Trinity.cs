using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三才转轮（TS trinity）：六膛转轮，每发按 灼烧 → 雷殛 → 蚀化 轮转覆盖本发元素（<see cref="WeaponStateMachine"/> 取 cycle[cycleIndex] 后推进一格），
    /// 每次换弹从灼烧重新开始。实例元素固定为火（不掷随机元素；副元素词条与「轮回」不会抽到，见各词条的准入）。
    /// 第一人称：枪身灵纹显示下一发的元素色，弹巢转到下一发所在膛位，换弹时甩出快转（<see cref="TrinityCycle"/>）；HUD 元素徽记读 <see cref="IWeaponHudSource.NextElement"/>。
    /// </summary>
    [Defs(140)]
    public sealed class Weapon_Trinity : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "trinity", name = "三才转轮", category = "手枪", kind = WeaponKind.Pistol, prefab = "SK_Weapon_Trinity",
                mode = FireMode.Semi, reload = ReloadStyle.Cylinder, sfx = "shot_pistol", sfxVolume = 0.95f,
                damage = 42, fireRate = 3.0f, mag = 6, reserve = 54, reloadTime = 1.8f,
                spreadTs = new SpreadParams(0.005f, 0.0015f, 0.016f, 0.045f, 0.16f),
                recoilPitch = 0.04f, recoilYaw = 0.009f,
                critMult = 2.4f, range = 80, falloffStart = 35, falloffEnd = 80, falloffMult = 0.7f,
                element = Element.Fire, cycle = new[] { Element.Fire, Element.Shock, Element.Corrode }, elementChance = 0.45f,
                aimFov = -12,
                knockback = 2, kickBack = 0.07f, kickRot = 0.26f, shake = 0.1f, flash = 0.14f,
                tracerWidth = 0.035f, impactSize = 1.0f, worldScale = 1.9f, dropWeight = 0.8f,
                viewHip = View(0.2f, -0.17f, -0.42f), viewAim = View(0, -0.09f, -0.34f),
                rightHand = Grip(0, -0.003f, 0), rightPitch = -0.02f, leftHand = Grip(-0.034f, -0.04f, 0.03f), leftRoll = 0.58f,
                description = "天、地、人三才分镌于转轮弹巢，火、雷、蚀依次出膛。",
                notes = new[] { "弹巢按 灼烧 → 雷殛 → 蚀化 轮转出膛", "枪身灵纹显示下一发的元素", "每次换弹从灼烧重新开始" },
            };
        }
    }
}
