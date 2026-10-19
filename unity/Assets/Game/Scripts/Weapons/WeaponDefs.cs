using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>Semi 单发、Auto 连发、Beam 按住持续放电（每秒 fireRate 跳）</summary>
    public enum FireMode { Semi, Auto, Beam }

    /// <summary>投射物武器（榴弹、蛊弹）：不走射线，发射 <see cref="PlayerProjectile"/></summary>
    public sealed class ProjectileSpec
    {
        public float speed = 30, gravity, radius = 0.15f, explosionRadius, lifetime = 3f, scale = 1f;
        /// <summary>撞墙 / 地面反弹次数；用完后 rollAfter = true 时贴地滚动到时间耗尽再炸，否则下一次触地就炸</summary>
        public int bounces;
        public bool rollAfter, explodeOnExpire = true;
        public Color color = Color.white;
        /// <summary>外观：grenade 榴弹 / orb 蛊弹</summary>
        public string visual = "grenade";
    }
    public enum ReloadStyle { Magazine, Shell }

    /// <summary>
    /// 武器定义（数值来自 Three.js 版 src/weapons/WeaponDefs.ts，散布已按「射得爽」收紧到约 40%；角度一律是半角弧度，射速 = 发 / 秒）。
    /// 视图偏移 viewHip / viewAim 用 Three.js 的相机空间坐标（x 右、y 上、z 前为负），在 Unity 里 z 取反。
    /// </summary>
    public sealed class WeaponDef
    {
        public string id, name, prefab;
        public FireMode mode;
        public ReloadStyle reload;
        public float damage, fireRate, reloadTime, shellTime, reloadStart;
        public int mag, reserve, pellets = 1;
        public float pelletCone;
        public float spreadHip, spreadAim, spreadPerShot, spreadMax, spreadRecovery;
        public float recoilPitch, recoilYaw, recoilBias, recoilClimb;
        public float critMult = 2f, range = 80f;
        /// <summary>伤害衰减：start 米内全额，end 米处降到 mult，之后保持</summary>
        public float falloffStart = 999, falloffEnd = 1000, falloffMult = 1f;
        public float knockback, kickBack, kickRot, shake, flash;
        /// <summary>枪声（GameAudio 的 SfxId）与音量（同 Three.js WeaponDefs 的 sfx / sfxVolume）</summary>
        public string sfx = "shot_pistol";
        public float sfxVolume = 1f;
        /// <summary>开镜视角变化（度，负数 = 放大）</summary>
        public float aimFov;
        public Element element;
        public float elementChance;
        /// <summary>固有副元素（青冥雷蛊「副·雷」40%）：命中时另掷一次</summary>
        public Element subElement;
        public float subChance;
        public ProjectileSpec projectile;
        /// <summary>光束弹射：命中后向 chainRange 米内最近的 1 个敌人放电，伤害 × chainFraction</summary>
        public float chainFraction, chainRange;
        public Vector3 viewHip, viewAim;
        /// <summary>第一人称握持（枪模局部坐标，已换算成 Unity：x 取反）</summary>
        public Vector3 rightHand, leftHand;
        public float rightPitch, leftRoll;
        public string description;

        public float Falloff(float dist)
        {
            if (dist <= falloffStart) return 1;
            if (dist >= falloffEnd) return falloffMult;
            return Mathf.Lerp(1, falloffMult, (dist - falloffStart) / (falloffEnd - falloffStart));
        }
    }

    public static class WeaponLibrary
    {
        /// <summary>品质倍率：普通 / 精良 / 稀有 / 史诗 / 传说</summary>
        public static readonly float[] RarityDamage = { 1f, 1.15f, 1.35f, 1.6f, 1.9f };
        public static readonly string[] RarityName = { "普通", "精良", "稀有", "史诗", "传说" };
        public static readonly Color[] RarityColor =
        {
            new(0.85f, 0.85f, 0.85f), new(0.45f, 0.85f, 0.45f), new(0.4f, 0.65f, 1f), new(0.75f, 0.45f, 1f), new(1f, 0.7f, 0.25f),
        };
        public const int MaxUpgrade = 5;
        public const float UpgradeStep = 0.12f;

        static readonly Dictionary<string, WeaponDef> defs = new();
        public static IEnumerable<WeaponDef> All => defs.Values;

        public static WeaponDef Get(string id) => defs.TryGetValue(id, out var d) ? d : null;

        static void Add(WeaponDef d) => defs[d.id] = d;

        // Three.js 视图偏移（z 为负 = 前方）→ Unity 相机局部（z 为正 = 前方）
        static Vector3 V(float x, float y, float z) => new(x, y, -z);
        // 握点：Three.js 枪模局部 → Unity（导入时 X 取反）
        static Vector3 H(float x, float y, float z) => new(-x, y, z);

        static WeaponLibrary()
        {
            Add(new WeaponDef
            {
                id = "smg", sfx = "shot_smg", sfxVolume = 0.6f, name = "蜂鸣冲锋枪", prefab = "SK_Weapon_Smg", mode = FireMode.Auto, reload = ReloadStyle.Magazine,
                damage = 11, fireRate = 13, mag = 36, reserve = 252, reloadTime = 1.7f,
                spreadHip = 0.012f, spreadAim = 0.005f, spreadPerShot = 0.001f, spreadMax = 0.026f, spreadRecovery = 0.6f,
                recoilPitch = 0.0045f, recoilYaw = 0.0026f, recoilBias = 0.0002f, recoilClimb = 0.015f,
                critMult = 2, range = 45, falloffStart = 16, falloffEnd = 40, falloffMult = 0.55f,
                knockback = 0.25f, kickBack = 0.012f, kickRot = 0.03f, shake = 0.035f, flash = 0.12f, aimFov = -10,
                elementChance = 0.08f, viewHip = V(0.21f, -0.2f, -0.46f), viewAim = V(0, -0.1f, -0.36f),
                rightHand = H(0, 0, 0), leftHand = H(0, 0.02f, -0.235f), leftRoll = 0.04f,
                description = "嗡鸣不止的轻型冲锋枪，近距离弹幕压制。",
            });
            Add(new WeaponDef
            {
                id = "revolver", sfx = "shot_pistol", sfxVolume = 1f, name = "赤铜左轮", prefab = "SK_Weapon_Revolver", mode = FireMode.Semi, reload = ReloadStyle.Magazine,
                damage = 38, fireRate = 3.5f, mag = 8, reserve = 64, reloadTime = 1.6f,
                spreadHip = 0.003f, spreadAim = 0.001f, spreadPerShot = 0.005f, spreadMax = 0.014f, spreadRecovery = 0.4f,
                recoilPitch = 0.022f, recoilYaw = 0.004f,
                critMult = 2.5f, range = 80, falloffStart = 35, falloffEnd = 80, falloffMult = 0.7f,
                knockback = 1.5f, kickBack = 0.06f, kickRot = 0.22f, shake = 0.09f, flash = 0.12f, aimFov = -12,
                elementChance = 0.3f, viewHip = V(0.2f, -0.17f, -0.42f), viewAim = V(0, -0.089f, -0.34f),
                rightHand = H(0, -0.003f, 0), rightPitch = -0.02f, leftHand = H(-0.034f, -0.04f, 0.035f), leftRoll = 0.65f,
                description = "赤铜铸就的八膛转轮手枪，弹道笔直，爆头倍率极高。",
            });
            Add(new WeaponDef
            {
                id = "shotgun", sfx = "shot_shotgun", sfxVolume = 0.9f, name = "碎岩霰弹", prefab = "SK_Weapon_Shotgun", mode = FireMode.Semi, reload = ReloadStyle.Shell,
                damage = 12, pellets = 9, pelletCone = 0.06f, fireRate = 1.4f, mag = 6, reserve = 42,
                reloadTime = 3.6f, shellTime = 0.48f, reloadStart = 0.4f,
                spreadHip = 0.004f, spreadAim = 0.002f, spreadPerShot = 0.004f, spreadMax = 0.012f, spreadRecovery = 0.3f,
                recoilPitch = 0.035f, recoilYaw = 0.006f,
                critMult = 2, range = 32, falloffStart = 9, falloffEnd = 30, falloffMult = 0.35f,
                knockback = 0.9f, kickBack = 0.085f, kickRot = 0.22f, shake = 0.22f, flash = 0.24f, aimFov = -10,
                elementChance = 0.06f, viewHip = V(0.22f, -0.22f, -0.5f), viewAim = V(0, -0.096f, -0.4f),
                rightHand = H(0, 0.006f, 0.02f), rightPitch = -0.12f, leftHand = H(0, -0.002f, -0.3f),
                description = "以碎岩为铳管衬里的泵动霰弹枪，贴脸一击足以撼山。",
            });
            // ── 元素武器 ──
            Add(new WeaponDef
            {
                id = "launcher", sfx = "shot_launcher", sfxVolume = 0.9f, name = "焚城榴弹", prefab = "SK_Weapon_Launcher", mode = FireMode.Semi, reload = ReloadStyle.Magazine,
                damage = 110, fireRate = 1.1f, mag = 4, reserve = 20, reloadTime = 2.4f,
                spreadHip = 0.005f, spreadAim = 0.002f, spreadPerShot = 0.005f, spreadMax = 0.012f, spreadRecovery = 0.3f,
                recoilPitch = 0.03f, recoilYaw = 0.004f,
                critMult = 1.8f, range = 120, element = Element.Fire, elementChance = 0.6f,
                projectile = new ProjectileSpec { speed = 34, gravity = 9, radius = 0.14f, explosionRadius = 4, lifetime = 3.2f, scale = 1.1f, color = new Color(1f, 0.54f, 0.23f), visual = "grenade" },
                knockback = 7, kickBack = 0.07f, kickRot = 0.14f, shake = 0.16f, flash = 0.26f, aimFov = -10,
                viewHip = V(0.23f, -0.24f, -0.52f), viewAim = V(0.1f, -0.18f, -0.44f),
                rightHand = H(0, 0, 0), leftHand = H(0, -0.01f, -0.27f),
                description = "发射燃烧榴弹的转轮发射器，所过之处尽成火海。",
            });
            Add(new WeaponDef
            {
                id = "beam", sfx = "shot_beam", sfxVolume = 0.35f, name = "雷弧发射器", prefab = "SK_Weapon_Beam", mode = FireMode.Beam, reload = ReloadStyle.Magazine,
                damage = 8, fireRate = 10, mag = 100, reserve = 400, reloadTime = 2.2f,
                spreadHip = 0.005f, spreadAim = 0.0025f, spreadPerShot = 0, spreadMax = 0, spreadRecovery = 1,
                recoilPitch = 0.0004f, recoilYaw = 0.0006f,
                critMult = 1.8f, range = 25, element = Element.Shock, elementChance = 0.1f, chainFraction = 0.4f, chainRange = 7,
                knockback = 0, kickBack = 0.003f, kickRot = 0.004f, shake = 0.012f, flash = 0.14f, aimFov = -10,
                viewHip = V(0.22f, -0.22f, -0.48f), viewAim = V(0.05f, -0.14f, -0.4f),
                rightHand = H(0, 0, 0), leftHand = H(0, 0, -0.17f),
                description = "释放持续雷弧的能量武器，电流会在敌群间跳跃。",
            });
            Add(new WeaponDef
            {
                id = "stormpod", sfx = "shot_launcher", sfxVolume = 0.5f, name = "青冥雷蛊", prefab = "SK_Weapon_Stormpod", mode = FireMode.Semi, reload = ReloadStyle.Magazine,
                damage = 95, fireRate = 1.2f, mag = 5, reserve = 30, reloadTime = 2.5f,
                spreadHip = 0.005f, spreadAim = 0.002f, spreadPerShot = 0.005f, spreadMax = 0.012f, spreadRecovery = 0.3f,
                recoilPitch = 0.04f, recoilYaw = 0.008f,
                critMult = 1.6f, range = 90, element = Element.Corrode, elementChance = 0.6f, subElement = Element.Shock, subChance = 0.4f,
                projectile = new ProjectileSpec { speed = 30, gravity = 14, radius = 0.15f, explosionRadius = 3.2f, lifetime = 1.8f, scale = 0.9f, bounces = 2, rollAfter = true, color = new Color(0.62f, 1f, 0.29f), visual = "orb" },
                knockback = 4, kickBack = 0.06f, kickRot = 0.12f, shake = 0.13f, flash = 0.2f, aimFov = -10,
                viewHip = V(0.23f, -0.24f, -0.52f), viewAim = V(0.08f, -0.17f, -0.44f),
                rightHand = H(0, 0, 0), leftHand = H(0, -0.02f, -0.2f),
                description = "以青铜蛊罐封存雷蛊与蚀毒的弹跳榴弹，落地翻滚，炸开一片青雷。",
            });
        }
    }

    /// <summary>一把具体的枪：品质、强化等级、弹匣与备弹</summary>
    public sealed class WeaponInstance
    {
        public readonly WeaponDef def;
        public int rarity, level;
        public int mag, reserve;

        public WeaponInstance(WeaponDef def, int rarity = 0)
        {
            this.def = def;
            this.rarity = rarity;
            mag = def.mag;
            reserve = def.reserve;
        }

        public float DamageMult => WeaponLibrary.RarityDamage[Mathf.Clamp(rarity, 0, 4)] * (1 + level * WeaponLibrary.UpgradeStep);
        public string Title => level > 0 ? $"{def.name} +{level}" : def.name;
    }
}
