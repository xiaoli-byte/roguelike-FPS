using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 裂风步枪（TS rifle）：全自动、中远距离均衡。散布按 D11 = TS 原值 × 0.4（不手调）。
    /// 握持取 TS WeaponHandling.rifle（右手 / 右腕俯仰 / 左腕侧倾）与枪模 leftHand；红点瞄具在美术里被管线排除（PROCEDURAL_PARTS），
    /// 第一人称由 <see cref="Handling_Rifle"/> 补一个程序红点（WC1）。
    /// </summary>
    [Defs(20)]
    public sealed class Weapon_Rifle : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "rifle", name = "裂风步枪", category = "步枪", kind = WeaponKind.Rifle, prefab = "SK_Weapon_Rifle",
                mode = FireMode.Auto, reload = ReloadStyle.Magazine, sfx = "shot_rifle", sfxVolume = 0.7f,
                damage = 18, fireRate = 8, mag = 30, reserve = 210, reloadTime = 2.4f,
                spreadTs = new SpreadParams(0.016f, 0.004f, 0.003f, 0.045f, 0.14f),
                recoilPitch = 0.0062f, recoilYaw = 0.0018f, recoilBias = 0.0003f, recoilClimb = 0.02f,
                critMult = 2, range = 90, falloffStart = 40, falloffEnd = 90, falloffMult = 0.75f,
                knockback = 0.4f, kickBack = 0.018f, kickRot = 0.045f, shake = 0.05f, flash = 0.14f, aimFov = -16,
                tracerWidth = 0.024f, impactSize = 0.75f,
                elementChance = 0.12f, viewHip = View(0.22f, -0.21f, -0.5f), viewAim = View(0, -0.1f, -0.38f),
                rightHand = Grip(0, -0.001f, 0.012f), rightPitch = -0.05f, leftHand = Grip(0, 0.006f, -0.36f), leftRoll = -0.08f,
                description = "可靠的制式突击步枪，中远距离表现均衡。",
                notes = new[] { "全距离表现均衡" },
            };
        }
    }
}
