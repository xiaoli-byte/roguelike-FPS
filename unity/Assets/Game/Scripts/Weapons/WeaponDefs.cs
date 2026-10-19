using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 开火模式（同 Three.js 版 FireMode）：Semi 单发、Auto 连发、Beam 按住持续放电（每秒 fireRate 跳）；
    /// Burst 点射（burstCount 发 / 轮）、Spinup 预热（机炮）、Charge 蓄力松手发射——这三种由 W1 的开火框架实现，之前按 Auto 处理。
    /// </summary>
    public enum FireMode { Semi, Auto, Beam, Burst, Spinup, Charge }

    /// <summary>武器类别（同 Three.js 版 WeaponKind）：词条准入、描述、换弹动作按它分</summary>
    public enum WeaponKind { Pistol, Smg, Rifle, Shotgun, Sniper, Launcher, Crossbow, Beam, Heavy, Blade }

    /// <summary>
    /// 换弹风格（同 Three.js 版 ReloadStyle：mag / shell / cylinder / tube / cell / box）。
    /// 逐发装填只认 Shell（WeaponController 按它走逐发流程，其余都是整匣）；其余几种目前只区分第一人称动作，W1 / W4 接上。
    /// </summary>
    public enum ReloadStyle { Magazine, Shell, Cylinder, Tube, Cell, Box }

    /// <summary>投射物武器（榴弹、蛊弹、飞弹、弩箭）：不走射线，发射 <see cref="PlayerProjectile"/>。默认值同 Three.js 版 def() 的 projectile 缺省</summary>
    public sealed class ProjectileSpec
    {
        public float speed = 30, gravity, radius = 0.1f, explosionRadius, lifetime = 3f, scale = 1f;
        /// <summary>撞墙 / 地面反弹次数；用完后 rollAfter = true 时贴地滚动到时间耗尽再炸，否则下一次触地就炸</summary>
        public int bounces;
        /// <summary>Unity 独有：反弹用完后贴地滚动（青冥雷蛊）</summary>
        public bool rollAfter;
        public bool explodeOnExpire;
        /// <summary>无元素时弹体颜色（TS 缺省 #ffd9a0）</summary>
        public Color color = new(1f, 0.851f, 0.627f);
        /// <summary>外观：grenade 榴弹 / orb 蛊弹 / rocket / bolt / arrow / shard / flame</summary>
        public string visual = "grenade";
        /// <summary>追踪转向速率（弧度 / 秒）</summary>
        public float homing;
        /// <summary>每次扣扳机发射的弹体数（蜂群 5）、多发间隔（秒）、扇形散开半角</summary>
        public int count = 1;
        public float stagger, fan;
        /// <summary>固定扇形（碎刃）：count 发均匀分布在 [−fan, +fan]，不做随机锥形；false = 蜂群式随机散开</summary>
        public bool fanFixed;
    }

    /// <summary>散布五项：锥角为半角弧度，恢复 = 停火后每秒收回的弧度</summary>
    [Serializable]
    public struct SpreadParams
    {
        public float hip, aim, perShot, max, recovery;

        public SpreadParams(float hip, float aim, float perShot, float max, float recovery)
        {
            this.hip = hip;
            this.aim = aim;
            this.perShot = perShot;
            this.max = max;
            this.recovery = recovery;
        }
    }

    /// <summary>
    /// 武器定义（数值来自 Three.js 版 src/weapons/WeaponDefs.ts，字段与 TS 的 WeaponDef 一一对应；角度一律是半角弧度，射速 = 发 / 秒）。
    /// 每把一个文件 Weapons/Defs/Weapon_&lt;Id&gt;.cs（<see cref="IDefSource{T}"/> + [Defs]），由 <see cref="Registry{T}"/> 收集。
    /// 散布（D11）：spreadTs 照抄 TS 原值，有效值 = 原值 × spreadScale；D11 之前手调过的 6 把把手调值放在 spreadTuned，原样生效。
    /// 视图偏移 viewHip / viewAim 用 Three.js 的相机空间坐标（x 右、y 上、z 前为负），在 Unity 里 z 取反（<see cref="View"/>）。
    /// TS 里嵌套的字段在这里摊平：recoil → recoilPitch…，kick → kickBack / kickRot，falloff → falloffStart / End / Mult，
    /// viewOffset / aimOffset → viewHip / viewAim。缺省值同 TS 的 def()。
    /// </summary>
    public sealed class WeaponDef : IDef
    {
        public string id, name, prefab;
        /// <summary>类别中文名（「手枪」「冲锋枪」…）</summary>
        public string category;
        public WeaponKind kind;
        public FireMode mode;
        public ReloadStyle reload;
        /// <summary>单发 / 单弹丸 / 单跳基础伤害</summary>
        public float damage, fireRate = 1;
        /// <summary>整匣换弹时间；逐发装填：每发耗时 shellTime、开始前准备 reloadStart</summary>
        public float reloadTime, shellTime, reloadStart;
        public int mag, reserve, pellets = 1;
        /// <summary>点射：每轮发数与轮内间隔（秒）</summary>
        public int burstCount = 1;
        public float burstInterval;
        /// <summary>霰弹弹丸锥角（半角）</summary>
        public float pelletCone;
        /// <summary>穿透敌人数（0 = 不穿透）</summary>
        public int pierce;

        /// <summary>散布原值（照抄 TS，D11）</summary>
        public SpreadParams spreadTs;
        /// <summary>D11：有效散布 = TS 原值 × spreadScale（锥角四项；恢复速度不缩）。收紧到约 40% 是为了「射得爽」</summary>
        public float spreadScale = 0.4f;
        /// <summary>手调覆盖：有值时直接用（D11 之前 6 把逐项按手感调过，比例并不统一）；新武器留空</summary>
        public SpreadParams? spreadTuned;
        public float spreadHip => spreadTuned?.hip ?? spreadTs.hip * spreadScale;
        public float spreadAim => spreadTuned?.aim ?? spreadTs.aim * spreadScale;
        public float spreadPerShot => spreadTuned?.perShot ?? spreadTs.perShot * spreadScale;
        public float spreadMax => spreadTuned?.max ?? spreadTs.max * spreadScale;
        public float spreadRecovery => spreadTuned?.recovery ?? spreadTs.recovery;

        /// <summary>后坐（TS recoil）：每发上跳、水平随机、水平固定偏移、连射累计系数</summary>
        public float recoilPitch, recoilYaw, recoilBias, recoilClimb;
        public float critMult = 2f, range = 80f;
        /// <summary>伤害衰减（TS falloff）：start 米内全额，end 米处降到 mult，之后保持；缺省 = 无衰减</summary>
        public float falloffStart = 999, falloffEnd = 1000, falloffMult = 1f;
        /// <summary>击退冲量（米 / 秒，每弹丸）；第一人称后坐 kickBack / kickRot（TS kick）；每发屏震；枪口火焰尺寸</summary>
        public float knockback, kickBack, kickRot, shake, flash;
        /// <summary>曳光宽度、命中特效尺寸（FX 单元接上）</summary>
        public float tracerWidth, impactSize = 1f;
        /// <summary>枪声（GameAudio 的 SfxId）与音量（同 Three.js WeaponDefs 的 sfx / sfxVolume）</summary>
        public string sfx = "shot_pistol";
        public float sfxVolume = 0.8f;
        /// <summary>开镜视角变化（度，负数 = 放大）与开镜过渡速度（damp lambda）</summary>
        public float aimFov, aimSpeed = 16f;
        /// <summary>默认元素与命中附着几率</summary>
        public Element element;
        public float elementChance;
        /// <summary>固有副元素（青冥雷蛊「副·雷」40%）：命中时另掷一次。词条框架（AF）接管 innate 后撤掉</summary>
        public Element subElement;
        public float subChance;
        /// <summary>固有词条（TS innate）：生成实例时放在词条最前，不占名额、不随稀有度放大。AF 单元之前只是数据</summary>
        public WeaponAffix[] innate = Array.Empty<WeaponAffix>();
        /// <summary>元素轮转（三才转轮）；null = 不轮转</summary>
        public Element[] cycle;
        public ProjectileSpec projectile;
        /// <summary>光束弹射：命中后向 chainRange 米内最近的 1 个敌人放电，伤害 × chainFraction</summary>
        public float chainFraction, chainRange;
        /// <summary>机炮预热秒数；开火时移速惩罚</summary>
        public float spinup, moveSlow;
        /// <summary>蓄力：满蓄秒数（0 = 非蓄力）、未满最低倍率、满蓄额外穿透、满蓄引爆元素状态</summary>
        public float chargeTime, chargeMinMult = 0.2f;
        public int chargeFullPierce;
        public bool chargeDetonate;
        /// <summary>随机掉落权重；地上的枪的模型缩放</summary>
        public float dropWeight = 1f, worldScale = 1.25f;
        /// <summary>碎刃 v2 的玩法参数；null = 普通武器</summary>
        public DemonBladeSpec blade;

        public Vector3 viewHip, viewAim;
        /// <summary>第一人称握持（枪模局部坐标，已换算成 Unity：x 取反，见 <see cref="Grip"/>）</summary>
        public Vector3 rightHand, leftHand;
        public float rightPitch, leftRoll;
        public string description;
        /// <summary>固有特性（显示在描述里）</summary>
        public string[] notes = Array.Empty<string>();

        string IDef.Id => id;

        public bool IsHitscan => projectile == null && mode != FireMode.Beam;
        public bool IsExplosive => projectile != null && projectile.explosionRadius > 0;
        public bool IsBlade => blade != null;
        /// <summary>每次扣扳机（或每跳）的伤害单位数：弹丸数 × 弹体数（TS hitsPerShot）</summary>
        public int HitsPerShot => pellets * (projectile != null ? projectile.count : 1);
        /// <summary>每秒「射击次数」（点射算每发；TS shotsPerSecond）。rate &lt; 0 = 用定义射速</summary>
        public float ShotsPerSecond(float rate = -1) => (rate < 0 ? fireRate : rate) * burstCount;
        /// <summary>碎刃三段连斩一轮的总时长（秒，未计攻速）；非碎刃为 0（TS comboCycleTime）</summary>
        public float ComboCycleTime
        {
            get
            {
                if (blade == null) return 0;
                float t = 0;
                foreach (var s in blade.combo) t += s.duration;
                return t;
            }
        }

        public float Falloff(float dist)
        {
            if (dist <= falloffStart) return 1;
            if (dist >= falloffEnd) return falloffMult;
            return Mathf.Lerp(1, falloffMult, (dist - falloffStart) / (falloffEnd - falloffStart));
        }

        /// <summary>Three.js 视图偏移（z 为负 = 前方）→ Unity 相机局部（z 为正 = 前方）</summary>
        public static Vector3 View(float x, float y, float z) => new(x, y, -z);
        /// <summary>握点：Three.js 枪模局部 → Unity（导入时 X 取反）</summary>
        public static Vector3 Grip(float x, float y, float z) => new(-x, y, z);
    }

    /// <summary>碎刃 v2 的一段斩击（同 TS BladeSlash；时间为未计攻速的秒数）</summary>
    public sealed class BladeSlash
    {
        public float damage, windup, duration, range, halfAngle, knockback, shake, stretch = 1f;
    }

    /// <summary>碎刃 v2 的全部玩法参数（同 TS DemonBladeParams，docs/demon-blade-v2.md）；WC5–WC7 填值并实现</summary>
    public sealed class DemonBladeSpec
    {
        public BladeSlash[] combo = Array.Empty<BladeSlash>();
        public float comboReset, reachBelow, reachAbove;
        public QiSpec qi = new();
        public SwarmSpec swarm = new();
        public ShieldSpec shield = new();
        public BurstSpec burst = new();
        public IntentSpec intent = new();
        public UnionSpec union = new();
        public EyeSpec eye = new();

        /// <summary>刃气：上限、回复延迟、每秒回复、每次斩击命中回复</summary>
        public sealed class QiSpec { public float max, regenDelay, regen, perSlashHit; }
        /// <summary>千刃出窍：射程、刃群半径、结算间隔、每次伤害、目标上限、刃气每秒消耗、追随速度、元素附着系数</summary>
        public sealed class SwarmSpec { public float range, radius, tick, damage; public int maxTargets; public float drain, follow, elementScale; }
        /// <summary>碎刃屏障：盾心距眼睛、半径、刃气每秒消耗、每挡一发额外消耗、受伤减免、移速惩罚</summary>
        public sealed class ShieldSpec { public float distance, radius, drain, perBlock, reduction, moveSlow; }
        /// <summary>杀气爆发：射程、聚合时长、半径、伤害、击退、冷却</summary>
        public sealed class BurstSpec { public float range, gather, radius, damage, knockback, cooldown; }
        /// <summary>杀意：上限与各项获得量，脱战衰减</summary>
        public sealed class IntentSpec { public float max, slashHit, swarmHit, kill, block, decayDelay, decay; }
        /// <summary>人刀合一：时长、强化爆发倍率与半径、斩波射程 / 伤害比例、刃群半径倍率、移速加成、刀身常态伸长</summary>
        public sealed class UnionSpec { public float duration, burstMult, burstRadius, waveRange, waveFrac, swarmRadiusMult, moveSpeed, stretch; }
        /// <summary>噬灵鬼眼：击杀回复（最大生命比例：普通 / 精英 / 首领）与睁眼时长</summary>
        public sealed class EyeSpec { public float heal, healElite, healBoss, open; }
    }

    /// <summary>
    /// 武器表门面：读 <see cref="Registry{T}"/>，外部调用（WeaponController、掉落、测试）不用改。
    /// 品质倍率与强化同 TS 的 RARITY_DAMAGE / MAX_LEVEL / LEVEL_DAMAGE；稀有度名字与颜色统一走 <see cref="Rarity"/>（D10）。
    /// 强化费用同 TS WeaponSystem.upgradeCost：50 × (等级 + 1) × (1 + 0.3 × 章)，四舍五入；满级（+5）返回 null。
    /// </summary>
    public static class WeaponLibrary
    {
        /// <summary>品质倍率：普通 / 精良 / 稀有 / 史诗 / 传说</summary>
        public static readonly float[] RarityDamage = { 1f, 1.15f, 1.35f, 1.6f, 1.9f };
        public static readonly string[] RarityName = Rarity.Names;
        public static readonly Color[] RarityColor = Rarity.Colors;
        public const int MaxUpgrade = 5;
        public const float UpgradeStep = 0.12f;
        /// <summary>强化费用：基数 50 灵石 × (等级 + 1)，每章 +30%</summary>
        public const int UpgradeBaseCost = 50;
        public const float UpgradeChapterStep = 0.3f;

        /// <summary>全部武器（按 TS 的 WEAPON_DEFS 顺序，见 Weapons/Defs 里各文件的 [Defs(order)]）</summary>
        public static IReadOnlyList<WeaponDef> All => Registry<WeaponDef>.All;

        public static WeaponDef Get(string id) => Registry<WeaponDef>.Get(id);

        /// <summary>
        /// 强化到下一级的费用（灵石）；已满级返回 null。chapter 从 0 起（0 = 第一章），负数按 0。
        /// 例：第一章 +0→+1 = 50，+4→+5 = 250；第三章 +0→+1 = 80
        /// </summary>
        public static int? UpgradeCost(WeaponInstance w, int chapter)
        {
            if (w == null || w.level >= MaxUpgrade) return null;
            return Mathf.FloorToInt(UpgradeBaseCost * (w.level + 1) * (1 + UpgradeChapterStep * Mathf.Max(0, chapter)) + 0.5f);
        }

        /// <summary>强化一级（满级时不变）；返回是否升了级</summary>
        public static bool Upgrade(WeaponInstance w)
        {
            if (w == null || w.level >= MaxUpgrade) return false;
            w.level++;
            return true;
        }

        /// <summary>武器显示名（不含强化等级，HUD / 提示自己拼 +N）。词条框架（AF1）接上传说前缀「天命·赤铜左轮」</summary>
        public static string DisplayName(WeaponInstance w) => w?.def?.name ?? "";
    }
}
