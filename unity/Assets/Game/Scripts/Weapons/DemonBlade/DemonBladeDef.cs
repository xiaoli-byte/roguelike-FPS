using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>碎片的去向：在手里（左键斩）/ 千刃出窍（右键）/ 碎刃屏障（R）/ 杀气爆发（V）</summary>
    public enum BladeMode { Hand, Swarm, Shield, Burst }

    /// <summary>
    /// 碎刃 v2 的数值与常量（docs/demon-blade-v2.md 第 3–8 节；Three.js WeaponDefs.ts 的 blade 块 + DemonBlade.ts 顶部常量）。
    /// 武器表条目在 Defs/Weapon_DemonBlade.cs，玩法参数由 <see cref="CreateSpec"/> 给出；判定用的纯函数（扇形、冷却）放这里，EditMode 可测。
    /// 伤害一律是基础值 × 本武器伤害倍率（品质 × 强化 × 伤害词条）；Combat 再乘玩家「武器伤害」等乘区。
    /// 来源：斩击与斩波 = DamageSource.Weapon + DamageTag.Melee（TS 里来源就是 'weapon'、标签 'slash'：吸血、灵宠、传说秘卷「只认武器」的效果照常吃到，
    /// 词条按 <see cref="AffixEffects.IsSlash"/> 认出斩击做 meleeHitScale 归一）；刃群绞杀、杀气爆发 = DamageSource.Weapon（不是斩击）。
    /// </summary>
    public static class DemonBladeDef
    {
        public const string WeaponId = "demon_blade";
        /// <summary>武器技能 id（weapon:skillUsed）</summary>
        public const string SkillBurst = "demon_burst", SkillUnion = "demon_union";

        /// <summary>准星「攻击距离内」检测间隔（帧）</summary>
        public const int InRangeEvery = 3;
        /// <summary>贴身（胶囊表面距离 ≤ 此值）时不判扇形角度，只排除正后方</summary>
        public const float MeleeClose = 0.35f;
        /// <summary>每段最多播几处命中特效</summary>
        public const int MaxHitFx = 6;
        /// <summary>斩击输入缓冲</summary>
        public const float SlashBuffer = 0.35f;
        /// <summary>碎片在外时按下左键：先收刃，这么久之内碎片回得差不多就接上斩击</summary>
        public const float RecallSlashWindow = 1f;
        /// <summary>还有不超过这么多片在飞回（刀尖附近最后回）时就可以出刀</summary>
        public const int SlashReadyAway = 14;
        /// <summary>碎片到齐多少比例后开始绞杀 / 挡弹</summary>
        public const float FormedToAct = 0.35f;
        /// <summary>刃群中心离墙面的距离</summary>
        public const float WallPullback = 0.6f;
        /// <summary>杀气爆发：炸散后多久开始归刀</summary>
        public const float ScatterTime = 0.24f;
        /// <summary>斩波飞行时长</summary>
        public const float WaveTime = 0.42f;
        /// <summary>移速基准（属性表默认 MoveSpeed 7.5）：人刀合一 / 屏障按比例加减</summary>
        public const float BaseMove = 7.5f;
        /// <summary>属性来源：屏障（减伤、减速）、人刀合一（加速）</summary>
        public const string SrcShield = "weapon:bladeShield", SrcUnion = "weapon:bladeUnion";
        /// <summary>三段挥砍的音高</summary>
        public static readonly float[] SwingPitch = { 1.08f, 0.96f, 0.78f };
        /// <summary>人刀合一时斩击的距离加成</summary>
        public const float UnionReach = 1.15f;
        /// <summary>刃群追随速度在人刀合一时的倍率</summary>
        public const float UnionFollow = 1.4f;
        /// <summary>斩波的横向判定：基础半宽 + 随飞行距离张开</summary>
        public const float WaveHalfWidth = 1.4f, WaveSpread = 1.6f;

        /// <summary>
        /// 玩法参数（同 TS demon_blade.blade）：一轮 1.1 秒、三段 30 / 30 / 60（单体约 109 秒伤）；刃群每 0.1 秒 6 点（60 秒伤）、刃气 20 / 秒（满刃气 5 秒）；
        /// 屏障 1.15 米、半径 0.85、25 / 秒 + 每挡一发 6、减伤 30%、减速 20%；杀气爆发 25 米、聚合 0.5 秒、半径 6、240、击退 8、冷却 15 秒；
        /// 杀意：斩中 +4、绞杀 +0.5、击杀 +10、挡弹 +5，脱战 5 秒后每秒 −5；人刀合一 8 秒（强化爆发 ×1.5 半径 8、斩波 12 米 50%、刃群半径 ×1.5、移速 +15%、刀身 ×1.3）；
        /// 鬼眼：回复最大生命 2% / 精英 5% / 首领 12%，睁眼 1.2 秒。
        /// </summary>
        public static DemonBladeSpec CreateSpec() => new()
        {
            combo = new[]
            {
                new BladeSlash { damage = 30, windup = 0.08f, duration = 0.3f, range = 3.2f, halfAngle = 0.9599f /* 55° */, knockback = 1.5f, shake = 0.2f, stretch = 1 },
                new BladeSlash { damage = 30, windup = 0.08f, duration = 0.3f, range = 3.2f, halfAngle = 0.9599f, knockback = 1.5f, shake = 0.2f, stretch = 1 },
                // 伸刃：碎片沿刀线展开到 2.2 倍，横扫 6 米
                new BladeSlash { damage = 60, windup = 0.16f, duration = 0.5f, range = 6, halfAngle = 0.6981f /* 40° */, knockback = 5, shake = 0.45f, stretch = 2.2f },
            },
            comboReset = 0.6f, reachBelow = 0.3f, reachAbove = 0.6f,
            qi = new DemonBladeSpec.QiSpec { max = 100, regenDelay = 0.5f, regen = 50, perSlashHit = 8 },
            swarm = new DemonBladeSpec.SwarmSpec { range = 22, radius = 2.2f, tick = 0.1f, damage = 6, maxTargets = 8, drain = 20, follow = 18, elementScale = 0.35f },
            shield = new DemonBladeSpec.ShieldSpec { distance = 1.15f, radius = 0.85f, drain = 25, perBlock = 6, reduction = 0.3f, moveSlow = 0.2f },
            burst = new DemonBladeSpec.BurstSpec { range = 25, gather = 0.5f, radius = 6, damage = 240, knockback = 8, cooldown = 15 },
            intent = new DemonBladeSpec.IntentSpec { max = 100, slashHit = 4, swarmHit = 0.5f, kill = 10, block = 5, decayDelay = 5, decay = 5 },
            union = new DemonBladeSpec.UnionSpec
            {
                duration = 8, burstMult = 1.5f, burstRadius = 8, waveRange = 12, waveFrac = 0.5f, swarmRadiusMult = 1.5f, moveSpeed = 0.15f, stretch = 1.3f,
            },
            eye = new DemonBladeSpec.EyeSpec { heal = 0.02f, healElite = 0.05f, healBoss = 0.12f, open = 1.2f },
        };

        // ───────────── 纯函数 ─────────────

        /// <summary>杀气爆发的实际冷却（吃技能急速：基础 ÷ max(0.2, 1 + 急速)，下限 0.1 秒）</summary>
        public static float CooldownTotal(DemonBladeSpec p, float skillHaste)
        {
            float b = p != null ? p.burst.cooldown : 15;
            return Mathf.Max(0.1f, b / Mathf.Max(0.2f, 1 + skillHaste));
        }

        /// <summary>三段斩的单体理论秒伤（基础值、未计攻速）</summary>
        public static float SlashDps(WeaponDef d)
        {
            if (d?.blade == null || d.ComboCycleTime <= 0) return 0;
            float sum = 0;
            foreach (var s in d.blade.combo) sum += s.damage;
            return sum / d.ComboCycleTime;
        }

        /// <summary>千刃出窍的单体理论秒伤（基础值）</summary>
        public static float SwarmDps(WeaponDef d) => d?.blade == null || d.blade.swarm.tick <= 0 ? 0 : d.blade.swarm.damage / d.blade.swarm.tick;

        /// <summary>
        /// 斩击扇形（TS sector 的几何部分，不含视线）：玩家前方水平扇形（距离按敌人胶囊表面、角度按敌人角半径放宽）+ 高度带。
        /// feet = 玩家脚底，forward = 水平朝向（会被压平归一），playerHeight = 身高；敌人给脚底位置、身体半径、身高。
        /// 贴身（表面距离 ≤ <see cref="MeleeClose"/>）只排除正后方。
        /// </summary>
        public static bool InSector(Vector3 feet, Vector3 forward, float playerHeight, float range, float halfAngle, float reachBelow, float reachAbove,
            Vector3 enemyFeet, float enemyRadius, float enemyHeight)
        {
            var f = new Vector3(forward.x, 0, forward.z);
            if (f.sqrMagnitude < 1e-8f) f = Vector3.forward;
            f.Normalize();
            float dx = enemyFeet.x - feet.x, dz = enemyFeet.z - feet.z;
            float dist = Mathf.Sqrt(dx * dx + dz * dz);
            float surface = dist - enemyRadius;
            if (surface > range) return false;
            float yLo = feet.y - reachBelow, yHi = feet.y + playerHeight + reachAbove;
            if (enemyFeet.y > yHi || enemyFeet.y + enemyHeight < yLo) return false;
            if (dist <= 1e-4f) return true;
            float cos = (dx * f.x + dz * f.z) / dist;
            if (surface > MeleeClose)
            {
                float allow = halfAngle + Mathf.Asin(Mathf.Min(1, enemyRadius / dist));
                return cos >= Mathf.Cos(Mathf.Min(Mathf.PI, allow));
            }
            return cos >= -0.3f;
        }

        // ───────────── 技能文字 ─────────────

        public static string SkillName(bool union) => union ? "人刀合一" : "杀气爆发";
        public static string SkillGlyph(bool union) => union ? "合" : "爆";

        public static string SkillDescription(bool union) => union
            ? "强化杀气爆发后进入 8 秒人刀合一：斩击放出碎刃斩波，千刃出窍不耗刃气，刃群更大，移速提升。"
            : "碎片聚于准星落点压缩成刃球后炸开，范围内敌人受到重创并被击退。杀意满时变为人刀合一。";

        /// <summary>HUD 开火模式 id：在手里是近战（准星换成弧形括号），其余按去向</summary>
        public static string ModeId(BladeMode m) => m switch
        {
            BladeMode.Hand => "blade",
            BladeMode.Swarm => "swarm",
            BladeMode.Shield => "shield",
            BladeMode.Burst => "burst",
            _ => throw new ArgumentOutOfRangeException(nameof(m)),
        };
    }
}
