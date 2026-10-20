using System.Collections.Generic;
using static Spiritfire.Game.WeaponDef;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜂群飞弹（TS swarm）：扣一下耗 1 发，间隔 0.06 s 依次射出 5 枚追踪火箭（projectile.count &gt; 1 → <see cref="VolleyMode"/>），
    /// 随机散开 0.16 rad 并略微上抬；追踪 4.5 rad/s 由弹体自己做（C4：0.1 s 后启动、0.25 s 重选目标），到期也爆（半径 1.8）。
    /// 握持取 TS WeaponHandling.swarm 与枪模 leftHand。
    /// </summary>
    [Defs(100)]
    public sealed class Weapon_Swarm : IDefSource<WeaponDef>
    {
        public IEnumerable<WeaponDef> Create()
        {
            yield return new WeaponDef
            {
                id = "swarm", name = "蜂群飞弹", category = "发射器", kind = WeaponKind.Launcher, prefab = "SK_Weapon_Swarm",
                mode = FireMode.Semi, reload = ReloadStyle.Tube, sfx = "shot_launcher", sfxVolume = 0.5f,
                damage = 30, fireRate = 0.75f, mag = 4, reserve = 20, reloadTime = 2.8f,
                spreadTs = new SpreadParams(0.02f, 0.01f, 0.01f, 0.03f, 0.1f),
                recoilPitch = 0.009f, recoilYaw = 0.003f,
                critMult = 1.8f, range = 150, elementChance = 0.25f,
                projectile = new ProjectileSpec
                {
                    speed = 24, radius = 0.12f, explosionRadius = 1.8f, lifetime = 3.5f, scale = 0.6f, explodeOnExpire = true,
                    homing = 4.5f, count = 5, stagger = 0.06f, fan = 0.16f, color = Hex.Rgb(0xffc860), visual = "rocket",
                },
                knockback = 3, kickBack = 0.035f, kickRot = 0.06f, shake = 0.06f, flash = 0.14f, aimFov = -12,
                tracerWidth = 0, impactSize = 0.8f, worldScale = 1.5f,
                viewHip = View(0.23f, -0.24f, -0.52f), viewAim = View(0.1f, -0.2f, -0.44f),
                rightHand = Grip(0, -0.006f, 0.008f), rightPitch = 0.06f, leftHand = Grip(0, 0, -0.2f), leftRoll = 0.3f,
                description = "蜂巢式火箭匣，一次齐射五枚会自行寻敌的小型飞弹。",
                notes = new[] { "一次齐射 5 枚追踪火箭" },
            };
        }
    }
}
