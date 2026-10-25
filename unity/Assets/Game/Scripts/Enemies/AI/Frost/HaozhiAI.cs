using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰棘豪彘（Three.js 版 src/enemies/types/Haozhi.ts）：地面自爆怪，伤害靠飞出去的冰刺——要用掩体挡、或跳起来躲。
    ///   小跑：追玩家；冷却没好时贴到 2.5 m 就停下拱地，不往玩家身上撞
    ///   刨地：16 m 内、看得见、高差 ≤ 1.2 m、导航直线畅通（4 m 内不查）→ 低头刨地 0.45 s（前摇，攻速加成最多缩到 30%）
    ///   冲锋：直线猛冲，速度 5 m/s 起每秒 +16、封顶 10.5（精英 ×1.1）；转向迟钝 1.1 rad/s（精英 ×1.25）——横移能甩开
    ///   蓄刺：冲进 6 m（高差 ≤ 1.8 m）或本来就在 6 m 内 → 急停竖刺 0.7 s，地面亮出 16 条辐条，其中一条正对玩家，缝隙是安全方向
    ///   冰刺新星：16 根水平冰刺（离地 0.62 × 体型、20 m/s、射程 12 m、半径 0.16，掩体能挡、跳起来能躲），本体死亡（不算玩家击杀、不掉落）；
    ///         爆点留下残刺阵 4 s（半径 2.4、精英 ×1.2），每 0.5 s 扎一下站在里面的玩家（冰刺伤害 × 0.3）
    ///   冲空：冲满 2.4 s 还没到 6 m 内、或撞墙 → 甩头愣 0.8 s，冷却 1.4–2.4 s 再追
    ///   提前打死（新星之前）：只射出一半（8 根，错开 22.5°）、伤害减半，不留残刺；清场（静默处决）时什么都不放
    /// 新星身亡是自爆（<see cref="ISelfDestruct"/>，<see cref="Detonated"/> = true）：同 TS 不经过伤害结算，没有击杀事件、不掉落；
    /// 被玩家打死（含新星之前打死放半圈）照常走伤害管线、派发击杀事件。
    /// 冲锋用 NavMeshAgent.Move 贴着导航网格推进（不会冲下悬崖），实际位移明显小于应走的距离 = 撞墙。
    /// </summary>
    public sealed class HaozhiAI : EnemyAI, ISelfDestruct
    {
        public const float ChargeRange = 16, ScrapeTime = 0.45f, ChargeSpeed = 10.5f, ChargeStart = 5, ChargeRamp = 16, ChargeTurn = 1.1f, ChargeMaxTime = 2.4f;
        public const float NovaRange = 6, BristleTime = 0.7f, StaggerTime = 0.8f, ApproachStop = 2.5f;
        public const int Quills = 16;
        public const float QuillSpeed = 20, QuillRange = 12, QuillY = 0.62f, QuillRadius = 0.16f, QuillSpawnOffset = 0.35f;
        public const float FieldRadius = 2.4f, FieldTime = 4, FieldTick = 0.5f, FieldRatio = 0.3f;
        /// <summary>提前打死：射出的根数比例、伤害比例、起始方向偏转（弧度）</summary>
        public const float EarlyDamageRatio = 0.5f, EarlyYawOffset = Mathf.PI / 8f;

        static readonly Color SpokeColor = Hex.Rgb(0xb6a6ff), QuillColor = Hex.Rgb(0xcfe6ff), RootColor = Hex.Rgb(0xd8ccff);
        static readonly Color FieldColor = new(0.72f, 0.7f, 1f, 0.9f), SteamColor = Hex.Rgb(0xeef6ff), SnowColor = Hex.Rgb(0xf2f8ff);
        const string BristleOverlay = "haozhi.bristle";

        float scrapeTime = ScrapeTime, bristleTime = BristleTime, clearTimer, novaYaw, steamAcc;
        bool pathClear, detonated, novaFired;

        /// <summary>死于自己的冰刺新星（自爆：不算玩家击杀）；被打死的为 false</summary>
        public bool Detonated => novaFired;
        Vector3 chargeDir, lastPos;
        TelegraphHandle spokes;

        protected override string InitialState => "chase";

        protected override void Awake()
        {
            base.Awake();
            // FX3：贴图上画好的冰 / 玉 / 狐火按发光通道亮起来（_E 发光遮罩）
            GlowMask.Attach(this);
            GlowStyle(0.08f, 0.03f, 2.6f, 0.9f);
            hp.Died += OnDiedEarly;
        }

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>冲锋速度：从 5 m/s 起每秒 +16，封顶 10.5（精英 ×1.1）</summary>
        public static float ChargeSpeedAt(float t, bool elite) => Mathf.Min(ChargeSpeed * (elite ? 1.1f : 1f), ChargeStart + Mathf.Max(0, t) * ChargeRamp);

        /// <summary>第 i 根冰刺的水平方向：从 yaw0（弧度，atan2(x, z)）起均分一周</summary>
        public static Vector3 QuillDirection(float yaw0, int i, int count)
        {
            float a = yaw0 + i / (float)Mathf.Max(1, count) * Mathf.PI * 2f;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        /// <summary>from 指向 to 的水平朝向（弧度，atan2(dx, dz)，同 TS facing）</summary>
        public static float YawTo(Vector3 from, Vector3 to) => Mathf.Atan2(to.x - from.x, to.z - from.z);

        /// <summary>冰刺的飞行时间（射程 / 速度）</summary>
        public static float QuillLifetime => QuillRange / QuillSpeed;

        /// <summary>
        /// 射出一圈冰刺（新星 / 提前打死的半圈）：从 feet 往外 0.35 × 体型、离地 0.62 × 体型，水平飞 20 m/s、0.6 s。
        /// spirit = 出手者被嘲讽中（冰刺不伤玩家）。静态：提前打死时延后 0.05 s 发射，本体可能已经不在了
        /// </summary>
        public static void SprayQuills(Vector3 feet, float size, int count, float damage, float yaw0, Object source, bool spirit)
        {
            float y = feet.y + QuillY * size;
            for (int i = 0; i < count; i++)
            {
                var dir = QuillDirection(yaw0, i, count);
                var p = new Vector3(feet.x + dir.x * QuillSpawnOffset * size, y, feet.z + dir.z * QuillSpawnOffset * size);
                EnemyProjectile.Spawn(new EnemyProjectileSpec(p, dir * QuillSpeed, damage, QuillRadius, QuillLifetime)
                {
                    visual = "quill", color = QuillColor, scale = 1.7f, source = source, spirit = spirit,
                });
            }
            GameAudio.PlayAt("enemy_shot", feet + Vector3.up * y, 0.9f, 0.7f);
        }

        // ───────────── 行为 ─────────────

        Vector3 BodyCenter => transform.position + Vector3.up * 0.38f * Size;

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            float dy = Mathf.Abs(PlayerPos.y - transform.position.y);
            switch (state)
            {
                case "chase":
                {
                    Glow = 0.15f;
                    clearTimer -= dt;
                    if (clearTimer <= 0)
                    {
                        clearTimer = 0.2f;
                        pathClear = sees && d <= ChargeRange && dy <= 1.2f && (d < 4 || !NavMesh.Raycast(transform.position, PlayerPos, out _, NavMesh.AllAreas));
                    }
                    if (cooldown <= 0 && sees && dy <= 1.6f && d <= NovaRange)
                    {
                        StartBristle();
                        break;
                    }
                    if (cooldown <= 0 && pathClear && d <= ChargeRange)
                    {
                        scrapeTime = Windup(ScrapeTime, 0.3f);
                        Stop();
                        Sfx("telegraph", 0.7f, 0.8f);
                        PlayTimed("scrape", scrapeTime, 0.06f);
                        SetState("scrape");
                        break;
                    }
                    if (d > ApproachStop)
                    {
                        MoveTo(PlayerPos, moveSpeed);
                        FaceMovement(460, dt);
                    }
                    else
                    {
                        Stop();
                        FacePlayer(290, dt);
                    }
                    break;
                }
                case "scrape":
                    // 刨地：低头对准玩家，前蹄往后刨，鼻孔喷白气
                    Stop();
                    FacePlayer(400, dt);
                    Glow = 0.3f + 0.4f * Mathf.Clamp01(stateTime / scrapeTime);
                    Steam(dt, 6);
                    if (stateTime >= scrapeTime) StartCharge();
                    break;
                case "charge":
                    ChargeStep(dt, d, dy);
                    break;
                case "bristle":
                {
                    // 急停竖刺：朝向锁死（辐条与冰刺方向一致）
                    Stop();
                    float t = Mathf.Clamp01(stateTime / bristleTime);
                    Glow = 0.5f + 0.5f * t;
                    body.SetOverlay(BristleOverlay, new Color(0.48f, 0.42f, 1f), t * 0.45f);
                    if (stateTime >= bristleTime) Nova();
                    break;
                }
                case "stagger":
                    Stop();
                    Glow = 0.1f;
                    if (stateTime >= StaggerTime)
                    {
                        RollCooldown(1.4f, 2.4f);
                        PlayLocomotion();
                        SetState("chase");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("chase");
                    break;
            }
        }

        void StartCharge()
        {
            chargeDir = transform.forward;
            chargeDir.y = 0;
            chargeDir = chargeDir.sqrMagnitude > 1e-4f ? chargeDir.normalized : Vector3.forward;
            lastPos = transform.position;
            Play("charge", 0.06f);
            SetState("charge");
            Sfx("enemy_charge", 0.8f, 1.3f);
            FrostKit.SnowPuff(transform.TransformPoint(new Vector3(0, 0.1f, 0.3f)), Size, 8);
        }

        void ChargeStep(float dt, float d, float dy)
        {
            // 迟钝转向：每秒 1.1 rad 追玩家方向（横移能甩开）
            var to = PlayerPos - transform.position;
            to.y = 0;
            if (to.sqrMagnitude > 1e-4f) chargeDir = Vector3.RotateTowards(chargeDir, to.normalized, ChargeTurn * (elite ? 1.25f : 1f) * dt, 0);
            transform.rotation = Quaternion.LookRotation(chargeDir);
            float v = ChargeSpeedAt(stateTime, elite) * SpeedMult;
            Glow = 0.6f;
            if (d <= NovaRange && dy <= 1.8f)
            {
                StartBristle();
                return;
            }
            // 撞墙：上一帧应走的距离只走出不到四成（导航网格边缘就是墙 / 掩体）
            var moved = transform.position - lastPos;
            moved.y = 0;
            bool wall = stateTime > 0.3f && dt > 0 && moved.magnitude < v * dt * 0.4f;
            if (wall || stateTime >= ChargeMaxTime)
            {
                Stagger(wall);
                return;
            }
            lastPos = transform.position;
            if (agent.isOnNavMesh)
            {
                agent.isStopped = true;
                agent.Move(chargeDir * v * dt);
            }
            Steam(dt, 2);
            // 冲锋扬雪
            if (v > 6 && Random.value < dt * 14f)
                FrostKit.SnowPuff(transform.TransformPoint(new Vector3((Random.value - 0.5f) * 0.4f, 0.05f, -0.3f)), 0.5f * Size, 3);
        }

        void Steam(float dt, float rate)
        {
            steamAcc += dt * rate;
            if (steamAcc < 0.3f) return;
            steamAcc = 0;
            Fx.Burst(transform.TransformPoint(new Vector3(0, 0.3f, 0.55f)), SteamColor, 3, 0.8f, 0.5f, 0.09f * Size, -0.6f);
        }

        void StartBristle()
        {
            bristleTime = Windup(BristleTime, 0.5f);
            Stop();
            // 一条辐条正对玩家：站着不动必中，横移进缝隙或找掩体
            novaYaw = YawTo(transform.position, PlayerPos);
            spokes.Cancel();
            spokes = Telegraph.Spokes(transform.position, Quills, QuillRange, 0.24f, novaYaw * Mathf.Rad2Deg, bristleTime, SpokeColor, 0.3f * Size);
            Sfx("telegraph", 1f, 1.1f);
            Fx.FrostGlint(BodyCenter + Vector3.up * 0.3f * Size, 1.2f * Size, RootColor);
            PlayTimed("bristle", bristleTime, 0.06f);
            SetState("bristle");
        }

        void Stagger(bool wall)
        {
            Play("stagger", 0.06f);
            SetState("stagger");
            if (!wall) return;
            var at = transform.TransformPoint(new Vector3(0, 0.4f, 0.5f));
            FrostKit.Shatter(at, 0.8f * Size, Hex.Rgb(0xdff6ff), 14, 4);
            GameAudio.PlayAt("land", at, 0.7f, 0.8f);
            CameraShake.Quake(at, 0.2f, 14f, 0.2f);
        }

        /// <summary>冰刺新星：射出整圈冰刺、留下残刺阵，自身死亡（不经过伤害结算：不算玩家击杀、不掉落）</summary>
        void Nova()
        {
            if (detonated || Dead) return;
            detonated = true;
            novaFired = true;
            spokes.End();
            body.ClearOverlay(BristleOverlay);
            SprayQuills(transform.position, Size, Quills, Damage, novaYaw, this, Taunted);
            var c = BodyCenter;
            // FX3：冰刺新星——青紫冰爆 + 一圈冰刺冒出又缩回（真正扎人的残刺阵是下面的 SpikeField）
            Fx.FrostNova(c, 1.6f * Size, RootColor);
            Fx.IceRing(transform.position, QuillRange * 0.35f, 12);
            CameraShake.Quake(c, 0.35f, 22f, 0.25f);
            GameAudio.PlayAt("explosion", c, 0.7f, 1.5f);
            LeaveField(c);
            var info = DamageInfo.Simple(0, DamageSource.Explosion, c, Vector3.up);
            hp.noReward = true;
            hp.Kill(info);
        }

        /// <summary>残刺阵：爆点脚下的地面（离地超过 2.5 m 的空中爆点不留），斜插一圈冰刺 + 每 0.5 s 扎一下的危险区</summary>
        void LeaveField(Vector3 center)
        {
            float gy = Fx.GroundY(center + Vector3.up * 0.5f, 6f);
            if (!float.IsFinite(gy)) gy = transform.position.y;
            var ground = new Vector3(center.x, Mathf.Min(gy, center.y), center.z);
            if (center.y - ground.y > 2.5f) return;
            float r = FieldRadius * (elite ? 1.2f : 1f);
            SpikeField.Spawn(new SpikeField.Spec(ground, r, FieldTime, 0.62f) { count = elite ? 18 : 14, color = QuillColor, block = false });
            HazardZone.Spawn(new HazardZone.Spec(ground, r, FieldTime, Damage * FieldRatio)
            {
                interval = FieldTick, firstTick = FieldTick, pad = 0.18f, minRise = -0.6f, maxRise = 1.2f,
                color = FieldColor, source = this, telegraph = false,
            });
        }

        /// <summary>新星之前被打死：延后 0.05 s 射出半圈冰刺（伤害减半），不留残刺；静默清场时什么都不放</summary>
        void OnDiedEarly(DamageInfo info)
        {
            spokes.Cancel();
            if (body) body.ClearOverlay(BristleOverlay);
            if (detonated || EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            detonated = true;
            float yaw0 = Mathf.Atan2(transform.forward.x, transform.forward.z) + EarlyYawOffset;
            float dmg = Damage * EarlyDamageRatio;
            var feet = transform.position;
            float size = Size;
            bool spirit = Taunted;
            FrostKit.Shatter(BodyCenter, 0.9f * size, RootColor, 14, 3);
            HazardClock.Delay(0.05f, () => SprayQuills(feet, size, Quills / 2, dmg, yaw0, null, spirit));
        }

        protected override void CancelAttack()
        {
            // 眩晕 / 清理 / 玩家阵亡：刺收回去，冷却后再追
            spokes.Cancel();
            body.ClearOverlay(BristleOverlay);
            if (!Dead && state is "scrape" or "charge" or "bristle") RollCooldown(1.2f, 2.2f);
        }
    }
}
