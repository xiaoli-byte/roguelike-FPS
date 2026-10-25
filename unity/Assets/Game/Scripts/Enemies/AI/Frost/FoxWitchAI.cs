using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 九尾狐巫（Three.js 版 src/enemies/types/FoxWitch.ts）：辅助，不近战，靠改变战场帮同伴。铜镜（socket_mirror 挂点上的 SM_EnemyPart_FoxWitchMirror）是弱点。
    ///   出场：尾巴从收拢到展开 0.9 s（enter）
    ///   保持距离：躲在同伴（20 m 内）质心后方 4 m、离玩家至少 12 m；没有同伴就和玩家保持 12–18 m。
    ///   闪身：玩家逼近到 7 m 内、或刚挨了重击（短时间内累计 15% 最大生命）→ 向侧后方（背离玩家 ±0.9 / ±1.5 rad）闪开 5 m（0.28 s），冷却 5 s
    ///   立冰壁（冷却 9–11 s，前摇 0.9 s）：在交火中的同伴（离她 22 m 内、离玩家 5–30 m，取离玩家最近的至多三只的质心；没有就是她自己）
    ///         和玩家之间立一道 <see cref="FoxIceWall"/>（<see cref="PlanIceWall"/>：离同伴两者距离的 40%、夹在 2.5–6 m，离玩家至少 3.5 m）；
    ///         墙线两端和中心要在导航网格上、玩家不在墙体里，否则沿连线往玩家挪 0.8 m 重试（共 3 次）。每只狐巫最多 2 道，第三道起最老的先碎
    ///   霜甲（冷却 7–9 s，前摇 0.8 s，12 m 内有没结霜甲 / 快到期的同伴才放）：12 m 内同伴承伤 ×0.7，5 s——登记到 <see cref="EnemyBuffs"/> 的
    ///         <see cref="FrostArmor"/> 通道（多只狐巫不叠加）；碎镜 / 死亡时她给的霜甲立刻失效（<see cref="IBuffSource"/>）
    ///   照妖镜（冷却 5.5–6.5 s，有视线、30 m 内、拿到远程名额）：镜面蓄光 0.8 s，一道细光线以 1.6 rad/s 跟着玩家胸口扫（横移够快能甩开），
    ///         出手：光束到第一个遮挡（墙、冰壁、掩体）；玩家在光束上（离轴 ≤ 玩家半径 + 0.25 m）且镜子到胸口没有遮挡 → 伤害 + 寒意 70% 1.5 s
    ///   碎镜：铜镜累计吃到她最大生命 30% → 炸碎、哀鸣 1.2 s；此后不再立冰壁、照镜、加霜甲，改放狐火（冷却 4–5 s，前摇 0.7 s：
    ///         三团追踪狐火 8.5 m/s、伤害 ×0.7、追踪 2.4 rad/s），弱点挪到头上
    /// 状态机：enter → stalk → wallWindup | armorWindup | mirrorCharge | foxfireWindup | blink → stalk
    /// </summary>
    public sealed class FoxWitchAI : EnemyAI, IBuffSource
    {
        /// <summary>霜甲的加成通道（同一时间只认最强的一个来源，多只狐巫不叠加）</summary>
        public const string FrostArmor = "fox.armor";
        /// <summary>霜甲：承伤 ×0.7（不改输出）</summary>
        public static readonly BuffMods ArmorMods = new(1, 1, 1, 0.7f);

        public const float WallAlongFrac = 0.4f, WallAlongMin = 2.5f, WallAlongMax = 6f, WallPlayerGap = 3.5f, WallRetryShift = 0.8f, WallWindup = 0.9f;
        public const int MaxWalls = 2;
        public const float ArmorRange = 12, ArmorWindup = 0.8f, ArmorDuration = 5;
        public const float MirrorRange = 30, MirrorCharge = 0.8f, MirrorTrack = 1.6f, MirrorSlow = 0.7f, MirrorSlowTime = 1.5f, MirrorBreak = 0.3f, MirrorPad = 0.25f;
        public const float FoxfireWindup = 0.7f, FoxfireSpeed = 8.5f, FoxfireMult = 0.7f, FoxfireHoming = 2.4f;
        public const float BlinkRange = 7, BlinkDist = 5, BlinkTime = 0.28f, BlinkCooldown = 5, HurtBlink = 0.15f;
        public const float KeepMin = 12, KeepMax = 18, BehindAllies = 4, AllyRange = 20, WallAllyRange = 22, EnterTime = 0.9f, ScreamTime = 1.2f;
        /// <summary>铜镜挂点（模型空间设计尺寸）：找不到 socket_mirror 时用</summary>
        static readonly Vector3 MirrorHome = new(0, 1.1f, 0.52f);
        static readonly float[] BlinkOffsets = { 0.9f, -0.9f, 1.5f, -1.5f };
        /// <summary>选址时检查的墙线位置（沿墙走向：中心、两端各收进 0.3 m）</summary>
        static readonly float[] WallProbes = { 0f, -FoxIceWall.Width * 0.5f + 0.3f, FoxIceWall.Width * 0.5f - 0.3f };

        static readonly Color FrostColor = Hex.Rgb(0x9fdcff), ArmorColor = Hex.Rgb(0xb8ecff), BeamColor = Hex.Rgb(0x8fe6ff), FoxfireColor = Hex.Rgb(0x7fd8ff);
        static readonly Color ShardColor = Hex.Rgb(0xa89a68), JadeHot = Hex.Rgb(0xd8fff8);

        float wallCd, armorCd, mirrorCd, fireCd, blinkCd = 1, windTime = 1, mirrorDamage, screamTime, hurtWindow, strafeTimer, strafeSign = 1;
        bool entered, enterPlayed, silenced;
        Vector3 planCenter, aimDir = Vector3.forward, blinkVel;
        float planYaw;
        Transform mirror;
        TelegraphHandle wallWarn;
        FxHandle aimLine;
        readonly List<FoxIceWall> walls = new();
        readonly List<EnemyAI> scratch = new(), allies = new();

        /// <summary>被结霜甲的同伴 → 它的 Ended 监听（霜甲没了就收起冰壳覆盖色；全场共用，多只狐巫给同一个同伴也只挂一次）</summary>
        static readonly Dictionary<EnemyAI, Action<string, object>> shells = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => shells.Clear();

        /// <summary>碎镜（或死亡）后为 true：不再立冰壁、照镜、加霜甲</summary>
        public bool Silenced => silenced;
        /// <summary>还能给霜甲：活着、铜镜没碎</summary>
        public bool BuffActive => this && !Dead && !silenced;
        /// <summary>本狐巫维持着的冰壁（老的在前）</summary>
        public IReadOnlyList<FoxIceWall> Walls => walls;
        /// <summary>铜镜累计受伤占碎镜阈值的比例</summary>
        public float MirrorCrack => hp && hp.maxHealth > 0 ? Mathf.Clamp01(mirrorDamage / (hp.maxHealth * MirrorBreak)) : 0;

        protected override string InitialState => entered ? "stalk" : "enter";

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.08f, 0.03f, 2.5f, 0.8f);
            wallCd = Random.Range(3f, 5f);
            armorCd = Random.Range(1.5f, 3f);
            mirrorCd = Random.Range(2.5f, 4f);
            fireCd = Random.Range(1f, 2f);
            strafeSign = Random.value < 0.5f ? -1 : 1;
            hp.Damaged += OnHurt;
            hp.Died += OnFoxDied;
        }

        protected override void Start()
        {
            base.Start();
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == "socket_mirror") { mirror = t; break; }
        }

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>
        /// 冰壁选址（同 TS planIceWall）：从被保护的一方 a 往玩家 p 走「两者距离的 40%（夹在 2.5–6 m）」再加 shift，但离玩家至少留 3.5 m；
        /// 两者太近（&lt; 6 m，站不下一道墙）或可用距离不到 1.5 m 返回 false。center 的 y 取 a.y；yaw = 墙面朝向（atan2(dx, dz)，朝玩家）
        /// </summary>
        public static bool PlanIceWall(Vector3 a, Vector3 p, out Vector3 center, out float yaw, float shift = 0)
        {
            center = a;
            yaw = 0;
            float dx = p.x - a.x, dz = p.z - a.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d < WallAlongMin + WallPlayerGap) return false;
            float along = Mathf.Clamp(d * WallAlongFrac, WallAlongMin, WallAlongMax) + shift;
            along = Mathf.Min(along, d - WallPlayerGap);
            if (along < 1.5f) return false;
            center = new Vector3(a.x + dx / d * along, a.y, a.z + dz / d * along);
            yaw = Mathf.Atan2(dx, dz);
            return true;
        }

        /// <summary>墙的走向（墙面法线 yaw 的垂直方向，= 根节点 +X）</summary>
        public static Vector3 WallAxis(float yaw) => new(Mathf.Cos(yaw), 0, -Mathf.Sin(yaw));

        /// <summary>照妖镜判定：瞄准方向 dir 上，胸口在镜前、在射程 reach 内、离光束轴 ≤ 玩家半径 + 0.25 m（遮挡另查）</summary>
        public static bool MirrorBeamHits(Vector3 from, Vector3 dir, float reach, Vector3 chest, float playerRadius)
        {
            var w = chest - from;
            float along = Vector3.Dot(w, dir);
            if (along <= 0 || along > reach) return false;
            return (w - dir * along).magnitude <= playerRadius + MirrorPad;
        }

        // ───────────── 行为 ─────────────

        Vector3 MirrorPos => mirror && mirror.gameObject.activeInHierarchy ? mirror.position : transform.TransformPoint(MirrorHome);
        Vector3 Chest => Taunted ? PlayerEye : PlayerPos + Vector3.up * 1.1f;

        protected override void Think(float dt)
        {
            float rate = auraAttackRate;
            wallCd -= dt * rate;
            armorCd -= dt * rate;
            mirrorCd -= dt * rate;
            fireCd -= dt * rate;
            blinkCd -= dt;
            hurtWindow = Mathf.Max(0, hurtWindow - dt * 0.5f);
            bool screaming = screamTime > 0;
            screamTime = Mathf.Max(0, screamTime - dt);
            if (screaming && screamTime <= 0 && state == "stalk") PlayLocomotion();
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(1.8f, 3.2f);
                strafeSign = -strafeSign;
            }
            for (int i = walls.Count - 1; i >= 0; i--)
                if (!walls[i] || !walls[i].Alive)
                    walls.RemoveAt(i);
            float d = DistToPlayer;
            switch (state)
            {
                case "enter":
                    Stop();
                    FacePlayer(115, dt);
                    if (!enterPlayed)
                    {
                        enterPlayed = true;
                        PlayTimed("enter", EnterTime, 0.05f);
                    }
                    if (stateTime >= EnterTime)
                    {
                        entered = true;
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                case "stalk":
                {
                    if (TryBlink(d)) break;
                    Glow = silenced ? 0 : 0.25f + 0.1f * Mathf.Sin(age * 2.5f);
                    if (screamTime > 0)
                    {
                        // 碎镜哀鸣：捂脸站住
                        Stop();
                        FacePlayer(115, dt);
                        break;
                    }
                    PositionBehindAllies();
                    // 横移 / 后撤时身体偏向走向、头由 CreatureRig 盯着玩家（不太空步）
                    FaceAimTravel(172, dt);
                    if (!silenced)
                    {
                        if (wallCd <= 0 && PickWallSpot())
                        {
                            BeginCast("wallWindup", WallWindup);
                            var u = WallAxis(planYaw);
                            wallWarn = Telegraph.Lane(planCenter - u * FoxIceWall.Width * 0.5f, planCenter + u * FoxIceWall.Width * 0.5f,
                                FoxIceWall.Thick * 1.5f, windTime, FrostColor);
                        }
                        else if (armorCd <= 0 && CountArmorTargets() > 0) BeginCast("armorWindup", ArmorWindup);
                        else if (mirrorCd <= 0 && sees && d <= MirrorRange && RequestAttack(AttackTokens.Kind.Ranged, MirrorCharge + 0.8f))
                        {
                            BeginCast("mirrorCharge", MirrorCharge);
                            var from = MirrorPos;
                            aimDir = (Chest - from).normalized;
                            aimLine = Fx.Beam(from, from + aimDir * 2f, BeamColor, 0.03f, windTime + 0.2f);
                        }
                    }
                    else if (fireCd <= 0 && sees && d <= MirrorRange && RequestAttack(AttackTokens.Kind.Ranged, FoxfireWindup + 0.5f))
                        BeginCast("foxfireWindup", FoxfireWindup);
                    break;
                }
                case "wallWindup":
                    Stop();
                    FaceTowards(planCenter, 172, dt);
                    Glow = 0.5f + 0.5f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime)
                    {
                        RaiseWall();
                        wallCd = Random.Range(9f, 11f);
                        EndCast();
                    }
                    break;
                case "armorWindup":
                    Stop();
                    FacePlayer(115, dt);
                    Glow = 0.6f + 0.4f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime)
                    {
                        CastArmor();
                        armorCd = Random.Range(7f, 9f);
                        EndCast();
                    }
                    break;
                case "mirrorCharge":
                {
                    Stop();
                    FacePlayer(143, dt);
                    TrackAim(dt);
                    float k = Mathf.Clamp01(stateTime / windTime);
                    SetGlow(1, k);
                    Glow = 0.4f + 0.6f * k;
                    if (stateTime >= windTime)
                    {
                        FireMirror();
                        ReleaseAttack();
                        mirrorCd = Random.Range(5.5f, 6.5f);
                        EndCast();
                    }
                    break;
                }
                case "foxfireWindup":
                    Stop();
                    FacePlayer(172, dt);
                    if (stateTime >= windTime)
                    {
                        CastFoxfire();
                        ReleaseAttack();
                        fireCd = Random.Range(4f, 5f);
                        EndCast();
                    }
                    break;
                case "blink":
                    // 闪身：保持冲刺速度直线滑开（贴着导航网格），到点收住
                    if (agent.isOnNavMesh) agent.Move(blinkVel * dt);
                    FacePlayer(229, dt);
                    if (stateTime >= BlinkTime)
                    {
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState(InitialState);
                    break;
            }
        }

        void BeginCast(string s, float windup)
        {
            windTime = Windup(windup, windup * 0.6f);
            Stop();
            Sfx("telegraph", 0.45f, s == "mirrorCharge" ? 1.5f : 1.15f);
            PlayTimed(s, windTime, 0.08f);
            SetState(s);
        }

        void EndCast()
        {
            PlayLocomotion();
            SetState("stalk");
        }

        /// <summary>同伴：range 内活着的其他敌人，不含首领（冰壁不是敌人，自然不在里面）</summary>
        List<EnemyAI> Allies(float range)
        {
            EnemyRegistry.InRadius(transform.position, range, scratch, EnemyQuery.Alive, this);
            allies.Clear();
            foreach (var e in scratch)
                if (e && e.Health && !e.Health.IsBoss)
                    allies.Add(e);
            scratch.Clear();
            return allies;
        }

        /// <summary>躲在同伴身后：同伴质心再往远离玩家的方向退 4 m，离玩家至少 12 m；没有同伴就和玩家保持 12–18 m</summary>
        void PositionBehindAllies()
        {
            var list = Allies(AllyRange);
            if (list.Count == 0)
            {
                KeepRange(KeepMin, KeepMax, moveSpeed, strafeSign);
                return;
            }
            var q = Vector3.zero;
            foreach (var e in list) q += e.transform.position;
            q /= list.Count;
            var p = PlayerPos;
            var away = q - p;
            away.y = 0;
            float d = away.magnitude;
            var dir = d > 1e-3f ? away / d : -transform.forward;
            q += dir * BehindAllies;
            away = q - p;
            away.y = 0;
            if (away.magnitude < KeepMin) q = new Vector3(p.x, q.y, p.z) + dir * KeepMin;
            var flat = q - transform.position;
            flat.y = 0;
            if (flat.magnitude > 1.8f) MoveTo(q, moveSpeed);
            else Stop();
        }

        /// <summary>玩家逼近（或刚挨了重击）时向侧后方闪身：背离玩家偏 ±0.9 / ±1.5 rad 的 5 m 处，要在导航网格上、0.6 m 高的直线无遮挡</summary>
        bool TryBlink(float d)
        {
            if (blinkCd > 0 || screamTime > 0) return false;
            if (d >= BlinkRange && hurtWindow < HurtBlink) return false;
            var pos = transform.position;
            float away = Mathf.Atan2(pos.x - PlayerPos.x, pos.z - PlayerPos.z);
            foreach (float off in BlinkOffsets)
            {
                float a = away + off * strafeSign;
                var t = new Vector3(pos.x + Mathf.Sin(a) * BlinkDist, pos.y, pos.z + Mathf.Cos(a) * BlinkDist);
                if (!NavMesh.SamplePosition(t, out var hit, 1f, NavMesh.AllAreas)) continue;
                if (new Vector2(hit.position.x - t.x, hit.position.z - t.z).magnitude > 0.6f) continue;
                if (Combat.Blocked(pos + Vector3.up * 0.6f, hit.position + Vector3.up * 0.6f, null)) continue;
                float v = BlinkDist / BlinkTime;
                blinkVel = new Vector3(Mathf.Sin(a) * v, 0, Mathf.Cos(a) * v);
                blinkCd = BlinkCooldown;
                hurtWindow = 0;
                Stop();
                Play("blink", 0.04f);
                SetState("blink");
                Fx.Burst(transform.position + Vector3.up * 0.9f * Size, FoxfireColor, 18, 3, 0.5f, 0.08f, -1);
                Sfx("dash", 0.5f, 1.3f);
                return true;
            }
            blinkCd = 1;
            return false;
        }

        // ───────────── 冰壁 ─────────────

        /// <summary>在交火中的同伴和玩家之间选址；没有同伴就挡在自己前面</summary>
        bool PickWallSpot()
        {
            var p = PlayerPos;
            var list = Allies(WallAllyRange);
            list.RemoveAll(e =>
            {
                var f = e.transform.position - p;
                f.y = 0;
                float dd = f.magnitude;
                return dd <= 5 || dd >= 30;
            });
            list.Sort((x, y) => (x.transform.position - p).sqrMagnitude.CompareTo((y.transform.position - p).sqrMagnitude));
            int n = Mathf.Min(3, list.Count);
            var q = Vector3.zero;
            if (n == 0) q = transform.position;
            else
            {
                for (int i = 0; i < n; i++) q += list[i].transform.position;
                q /= n;
            }
            for (int attempt = 0; attempt < 3; attempt++)
            {
                if (!PlanIceWall(q, p, out planCenter, out planYaw, attempt * WallRetryShift)) return false;
                if (WallSpotClear()) return true;
            }
            return false;
        }

        /// <summary>选址检查：墙中心和两端在导航网格上，玩家不在墙体里（墙不会把玩家关进去）；墙的 y 取中心处网格的高度</summary>
        bool WallSpotClear()
        {
            var u = WallAxis(planYaw);
            float groundY = planCenter.y;
            foreach (float s in WallProbes)
            {
                var at = planCenter + u * s;
                if (!NavMesh.SamplePosition(at, out var hit, 1.5f, NavMesh.AllAreas)) return false;
                if (new Vector2(hit.position.x - at.x, hit.position.z - at.z).magnitude > 0.5f) return false;
                if (s == 0) groundY = hit.position.y;
            }
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            float pr = cc ? cc.radius : 0.35f;
            var dd = PlayerPos - planCenter;
            float along = dd.x * u.x + dd.z * u.z, across = dd.x * Mathf.Sin(planYaw) + dd.z * Mathf.Cos(planYaw);
            if (Mathf.Abs(along) < FoxIceWall.Width * 0.5f + 0.6f && Mathf.Abs(across) < FoxIceWall.Thick * 0.5f + pr + 0.6f) return false;
            planCenter.y = groundY;
            return true;
        }

        void RaiseWall()
        {
            wallWarn.End();
            // 超过上限：最老的那道先碎
            while (walls.Count >= MaxWalls)
            {
                var old = walls[0];
                walls.RemoveAt(0);
                if (old) old.Expire();
            }
            walls.Add(FoxIceWall.Raise(this, planCenter, planYaw, level));
            var to = planCenter + Vector3.up * 1.2f;
            Fx.Beam(MirrorPos, to, FrostColor, 0.06f, 0.35f);
            GameAudio.PlayAt("shield_break", to, 0.6f, 0.6f);
        }

        // ───────────── 霜甲 ─────────────

        /// <summary>12 m 内、还没有霜甲（或剩不到 1.5 s）的同伴数</summary>
        int CountArmorTargets()
        {
            int n = 0;
            foreach (var e in Allies(ArmorRange))
            {
                var src = e.Buffs.SourceOf(FrostArmor);
                if (src == null || e.Buffs.Until(FrostArmor, src) - Time.time < 1.5f) n++;
            }
            return n;
        }

        void CastArmor()
        {
            var from = MirrorPos;
            Fx.Ring(transform.position + Vector3.up * 0.05f, ArmorRange, ArmorColor, 0.8f);
            GameAudio.PlayAt("skill_buff", from, 0.7f, 1.2f);
            foreach (var e in Allies(ArmorRange))
            {
                e.Buffs.Set(FrostArmor, this, ArmorMods, ArmorDuration);
                var c = EnemyRegistry.Center(e);
                Fx.Beam(from, c, ArmorColor, 0.04f, 0.4f);
                Fx.FrostGlint(c, 0.9f, ArmorColor);
                AddShell(e);
            }
        }

        /// <summary>
        /// 冰壳：结了霜甲的同伴罩一层 FX3 霜甲壳（<see cref="FrostShell"/>：从脚下往上冻的多面冰）+ 淡淡的冰蓝覆盖色；
        /// 霜甲没了（到期、来源碎镜 / 死亡）就碎掉收起
        /// </summary>
        static void AddShell(EnemyAI e)
        {
            if (!e || !e.Body) return;
            e.Body.SetOverlay(FrostArmor, ArmorColor, 0.15f);
            FrostShell.Cover(e.Health);
            if (shells.ContainsKey(e)) return;
            Action<string, object> h = null;
            h = (channel, source) =>
            {
                if (channel != FrostArmor) return;
                if (e && !e.Dead && e.Buffs.Has(FrostArmor)) return;
                if (e)
                {
                    e.Buffs.Ended -= h;
                    if (e.Body) e.Body.ClearOverlay(FrostArmor);
                    FrostShell.Shatter(e.Health, !e.Dead);
                }
                shells.Remove(e);
            };
            shells[e] = h;
            e.Buffs.Ended += h;
        }

        // ───────────── 照妖镜 / 狐火 ─────────────

        /// <summary>蓄光：瞄准方向以 1.6 rad/s 跟着玩家胸口转，细光线从镜心画到第一个遮挡</summary>
        void TrackAim(float dt)
        {
            var from = MirrorPos;
            var want = Chest - from;
            if (want.sqrMagnitude > 1e-6f) aimDir = Vector3.RotateTowards(aimDir, want.normalized, MirrorTrack * dt, 0).normalized;
            FuzhuAI.WorldRay(from, aimDir, MirrorRange + 5, out float dist);
            aimLine.Retarget(from, from + aimDir * dist);
        }

        /// <summary>出手：光束到第一个遮挡；目标在光束上且镜子到胸口没有遮挡才算命中（伤害 + 寒意 70% 1.5 s）</summary>
        void FireMirror()
        {
            aimLine.Cancel();
            SetGlow(1, 0);
            var from = MirrorPos;
            var dir = aimDir;
            FuzhuAI.WorldRay(from, dir, MirrorRange + 5, out float reach);
            var chest = Chest;
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            float pr = Taunted ? 0.4f : cc ? cc.radius : 0.35f;
            bool hit = MirrorBeamHits(from, dir, reach, chest, pr) && !Combat.Blocked(from, chest, null);
            var end = from + dir * (hit ? Vector3.Dot(chest - from, dir) : reach);
            Fx.Beam(from, end, BeamColor, 0.14f, 0.3f);
            Fx.FrostGlint(from, 1.2f, BeamColor);
            FrostKit.Shatter(end, 0.5f, FrostColor, 12, 4);
            GameAudio.PlayAt("shot_beam", from, 0.75f, 1.4f);
            if (hit && HitTarget(Damage, from))
            {
                PlayerStatus.Chill(MirrorSlow, MirrorSlowTime);
                FrostKit.Vapour(chest, 0.8f, 6, ArmorColor);
            }
        }

        /// <summary>碎镜后：三团追踪狐火，从尾尖散开射出（先往两侧绕，再被追踪拉回目标）</summary>
        void CastFoxfire()
        {
            var chest = Chest;
            var right = transform.right;
            for (int i = 0; i < 3; i++)
            {
                float lat = (i - 1) * 2.6f;
                var p = transform.TransformPoint(new Vector3((i - 1) * 0.55f, 1.45f + (i == 1 ? 0.3f : 0), -0.25f));
                var q = chest + right * lat + Vector3.up * 1.2f;
                var dir = (q - p).normalized;
                EnemyProjectile.Spawn(new EnemyProjectileSpec(p, dir * FoxfireSpeed, Damage * FoxfireMult, 0.28f, 5f)
                {
                    homing = FoxfireHoming, visual = "orb", color = FoxfireColor, scale = 1.4f, source = this, spirit = Taunted,
                });
                Fx.Burst(p, FoxfireColor, 8, 1.5f, 0.4f, 0.07f, -1);
            }
            GameAudio.PlayAt("enemy_shot", transform.position + Vector3.up * 1.5f * Size, 0.6f, 1.2f);
        }

        // ───────────── 受击 / 碎镜 / 死亡 ─────────────

        void OnHurt(DamageInfo info, DamageResult r)
        {
            if (Dead || !hp || hp.maxHealth <= 0) return;
            hurtWindow += r.total / hp.maxHealth;
            if (silenced || !info.weakpoint || r.total <= 0) return;
            mirrorDamage += r.total;
            if (mirrorDamage >= hp.maxHealth * MirrorBreak)
            {
                BreakMirror();
                return;
            }
            GameAudio.PlayAt("hit_armor", MirrorPos, 0.7f, 1.3f);
        }

        void BreakMirror()
        {
            var at = MirrorPos;
            silenced = true;
            // 正在施的法收起；此后她给的霜甲立刻失效（BuffActive = false）
            InterruptAttack();
            if (state is "wallWindup" or "armorWindup" or "mirrorCharge") EndCast();
            // 弱点挪到头上，再藏起铜镜
            body.SetWeakPoint("head", new Vector3(0, 0.1f, 0.05f), 0.2f);
            if (mirror)
                foreach (var rr in mirror.GetComponentsInChildren<Renderer>(true))
                    rr.enabled = false;
            // 铜镜炸碎：铜片（甲片风格）+ 镜面冰晶碎片 + 一记星芒
            Fx.Play("ArmorChip", at, Vector3.up, ShardColor, 0.5f);
            FrostKit.Shatter(at, 0.8f, JadeHot, 16, 5);
            Fx.FrostGlint(at, 1.6f, JadeHot);
            for (int i = 0; i < 3; i++)
                Fx.Lightning(at, at + new Vector3(Random.Range(-1f, 1f), Random.Range(-0.45f, 1.05f), Random.Range(-1f, 1f)), FrostColor);
            GameAudio.PlayAt("shield_break", at, 1f, 0.8f);
            Sfx("boss_roar", 0.4f, 2.2f);
            GameUI.Toast("铜镜已碎 · 九尾狐巫沉默");
            screamTime = ScreamTime;
            Stop();
            Play("scream", 0.06f);
            fireCd = Mathf.Max(fireCd, 1.5f);
        }

        void OnFoxDied(DamageInfo info)
        {
            silenced = true;
            aimLine.Cancel();
            wallWarn.Cancel();
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            var c = transform.position + Vector3.up * 0.9f * Size;
            FrostKit.Vapour(c, 1.2f, 8, FrostColor);
            Fx.Burst(c, FoxfireColor, 14, 2, 1.4f, 0.07f, -1);
            if (mirror && mirror.gameObject.activeInHierarchy)
            {
                Fx.Play("ArmorChip", mirror.position, Vector3.up, ShardColor, 0.4f);
                FrostKit.Shatter(mirror.position, 0.6f, JadeHot, 12, 4);
            }
        }

        protected override void CancelAttack()
        {
            wallWarn.Cancel();
            aimLine.Cancel();
            SetGlow(1, 0);
        }
    }
}
