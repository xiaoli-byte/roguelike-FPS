using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火浣鼠（Three.js 版 src/enemies/types/FireRat.ts）：自爆突袭。
    ///   逼近：冲一段（0.4–0.8 s，×1.3 速）顿一下（0.12–0.3 s），每段方向偏一点
    ///   火球：14 m 内、看得见、路上没挡 → 蜷身 0.65 s → 滚动（5 m/s 起，加速到 11 m/s，转向 126°/s，最多 3 s）
    ///         1.6 m 内自爆（3.2 m 火爆，伤害 26，留 1.6 m 余火 3 s）；撞墙 / 滚满时玩家在 3.5 m 内照样炸，否则撞晕 0.8 s
    ///   被打死：留余火；滚动中被打爆，火球照样炸开但只伤其他敌人（32 × 等级 火伤）
    ///   自爆不算玩家击杀、不给奖励
    ///   换球：蜷身过半（前 55% 人立）身体换成美术火球（挂点 socket_fire_ball，平时缩到 0.01），换的一瞬间爆一团火盖住；
    ///         滚动时火球按实际速度滚（同 Three.js 的 rollAngle），被打断 / 撞晕 / 死亡时换回身体
    ///   读招（同 TS）：火毛发光随状态（窜行呼吸 / 蜷身 0.4→1 / 滚动全亮 / 撞晕 0.3），蜷身时身体越烧越红（覆盖色 ×0.45）；
    ///         尾尖一直冒火星（尾火）、滚动时火球外面裹一层翻卷的火（火球壳）、身后拖火尾
    ///   出手条件（同 TS）：和玩家高差 1.2 m 内才蜷身；撞墙 / 滚满时还要高差 1.8 m 内才就地炸
    ///   滚空：撞墙往回弹一小段（同 TS ×−0.35），火星 + 火团
    ///   爆炸（同 TS blastPlayer）：边缘剩一半、掀开玩家 5.5、按距离震屏 0.7；贴地火环 + 上冲火柱 + 焦痕（8 s，比余火久）
    /// </summary>
    public sealed class FireRatAI : EnemyAI, ISelfDestruct
    {
        const float RollRange = 14, CurlTime = 0.65f, RollSpeed = 11, RollStart = 5, RollRamp = 18, RollTurn = 126f, RollMaxTime = 3f;
        const float ObstacleBlastRange = 3.5f, DizzyTime = 0.8f, WallArmTime = 0.3f, TriggerRange = 1.6f, BlastRadius = 3.2f;
        const float DeathBlastBase = 32, BurnRadius = 1.6f, BurnTime = 3f, BurnRatio = 0.12f;
        const float RearFrac = 0.55f, BallR = 0.3f;

        float dashTimer, dashYaw, curlTime;
        bool dashing, detonated;
        /// <summary>已经自爆（同 Three.js：自爆死亡不派发击杀事件、不给奖励）</summary>
        public bool Detonated => detonated;
        Vector3 rollDir;
        Transform ballSocket, ball;
        Renderer[] bodyRenderers;
        Renderer ballRenderer;
        Quaternion ballRest;
        bool ballInit, balled;
        float rollAngle, emberAt, shellAt;
        Transform tailTip;

        /// <summary>累计：撞空几次、自爆几次（测试用）</summary>
        public int Bonks { get; private set; }
        public int Detonations { get; private set; }
        /// <summary>蜷身时身体的覆盖色通道</summary>
        public const string CurlChannel = "fireRatCurl";
        static readonly Color CurlColor = Hex.Rgb(0xff6a1a), TrailColor = Hex.Rgb(0xffb040), EmberColor = Hex.Rgb(0xff6a1a), FlameColor = Hex.Rgb(0xff8a2a);

        /// <summary>现在是火球形态（测试用）</summary>
        public bool Balled => balled;
        /// <summary>火球累计滚过的角度（度，测试用）</summary>
        public float RollAngle => rollAngle;

        protected override void Awake()
        {
            base.Awake();
            hp.Died += OnKilledByPlayer;
            GlowStyle(0.1f, 0.05f, 6f, 0.7f);
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == "tail_5") { tailTip = t; break; }
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            switch (state)
            {
                case "chase":
                {
                    Glow = 0.2f + 0.1f * Mathf.Sin(age * 6);
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    bool reach = Mathf.Abs(PlayerPos.y - transform.position.y) <= 1.2f;
                    if (cooldown <= 0 && sees && reach && d <= RollRange && (d < 4 || !Combat.Blocked(transform.position + Vector3.up * 0.4f, PlayerPos + Vector3.up * 0.4f, null)))
                    {
                        curlTime = Windup(CurlTime, 0.4f);
                        Stop();
                        PlayTimed("curl", curlTime, 0.06f);
                        Sfx("telegraph", 0.8f, 1.7f);
                        SetState("curl");
                        break;
                    }
                    dashTimer -= dt;
                    if (dashTimer <= 0)
                    {
                        dashing = !dashing || d < 3;
                        dashTimer = dashing ? Random.Range(0.4f, 0.8f) : Random.Range(0.12f, 0.3f);
                        dashYaw = Random.Range(-28f, 28f);
                    }
                    if (!dashing)
                    {
                        Stop();
                        FacePlayer(340, dt);
                        break;
                    }
                    var dir = d > 4 && sees ? Quaternion.Euler(0, dashYaw, 0) * to.normalized : to.normalized;
                    MoveTo(d > 4 && sees ? transform.position + dir * 4f : PlayerPos, moveSpeed * 1.3f);
                    FaceMovement(800, dt);
                    break;
                }
                case "curl":
                {
                    FacePlayer(460, dt);
                    float t = Mathf.Clamp01(stateTime / Mathf.Max(0.05f, curlTime));
                    Glow = 0.4f + 0.6f * t;
                    body.SetOverlay(CurlChannel, CurlColor, t * 0.45f);
                    if (stateTime >= curlTime)
                    {
                        rollDir = transform.forward;
                        HitWall = false;
                        BeginManualMotion(rollDir * RollStart, 26f);
                        Play("roll", 0.05f);
                        SetState("roll");
                        Fx.Burst(Center, TrailColor, 10, 3.5f, 0.35f, 0.18f, -1f);
                    }
                    break;
                }
                case "roll":
                {
                    var to = PlayerPos - transform.position;
                    to.y = 0;
                    if (to.sqrMagnitude > 0.01f)
                        rollDir = Vector3.RotateTowards(rollDir, to.normalized, RollTurn * (elite ? 1.3f : 1f) * Mathf.Deg2Rad * dt, 0);
                    float v = Mathf.Min(RollSpeed * (elite ? 1.15f : 1f), RollStart + stateTime * RollRamp);
                    SetManualVelocity(new Vector3(rollDir.x * v, ManualVelocity.y, rollDir.z * v));
                    transform.rotation = Quaternion.LookRotation(rollDir);
                    Glow = 1;
                    if (Random.value < dt * 20) ShotFx.Instance?.Impact(transform.position + Vector3.up * 0.2f, Vector3.up, true, 0.6f);
                    bool vert = Mathf.Abs(PlayerPos.y - transform.position.y) < 1.8f;
                    bool near = d <= TriggerRange && vert;
                    bool wall = HitWall && stateTime > WallArmTime;
                    if (near) Detonate();
                    else if (wall || stateTime >= RollMaxTime)
                    {
                        if (d <= ObstacleBlastRange && vert) Detonate();
                        else Bonk(wall);
                    }
                    break;
                }
                case "dizzy":
                    Glow = 0.3f;
                    Stop();
                    if (stateTime >= DizzyTime)
                    {
                        RollCooldown(1.5f, 2.5f);
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

        Vector3 Center => transform.position + Vector3.up * 0.35f * transform.localScale.y;

        /// <summary>滚空了（撞墙 / 滚满时玩家不在附近）：撞得一弹（撞墙往回弹）、舒展开愣 0.8 s，不在半路爆炸</summary>
        void Bonk(bool wall)
        {
            EndManualMotion();
            body.ClearOverlay(CurlChannel);
            if (wall) Knockback(-rollDir * 4f);
            Play("dizzy", 0.06f);
            Sfx("land", 0.6f, 1.4f);
            var c = Center;
            Fx.Burst(c, EmberColor, 12, 3.5f, 0.6f, 0.06f, 6f);
            Fx.Burst(c, TrailColor, 6, 2f, 0.3f, 0.25f * Size, -1f);
            Bonks++;
            SetState("dizzy");
        }

        protected override void CancelAttack()
        {
            body.ClearOverlay(CurlChannel);
            Glow = 0;
        }

        /// <summary>尾火（尾尖一直冒火星）、火球壳（滚动时火球外面翻卷的火）、火尾</summary>
        void FlameFx()
        {
            if (Dead) return;
            float now = Time.time;
            if (tailTip && !balled && now >= emberAt)
            {
                emberAt = now + Random.Range(0.07f, 0.12f);
                Fx.Burst(tailTip.position, Random.value < 0.6f ? FlameColor : Hex.Rgb(0xffd27a), 1, 0.6f, 0.45f, 0.07f * Size, -2.5f);
            }
            if (balled && now >= shellAt)
            {
                shellAt = now + 0.04f;
                var c = Center + Random.insideUnitSphere * 0.25f * Size;
                Fx.Burst(c, FlameColor, 2, 0.9f, 0.28f, 0.22f * Size, -3f);
                if (state == "roll") Fx.Burst(Center - rollDir * 0.3f * Size, TrailColor, 1, 0.3f, 0.5f, 0.2f * Size, -1.5f);
            }
        }

        void InitBall()
        {
            ballInit = true;
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == "socket_fire_ball") { ballSocket = t; break; }
            if (!ballSocket) return;
            ball = ballSocket.childCount > 0 ? ballSocket.GetChild(0) : null;
            if (ball)
            {
                ballRest = ball.localRotation;
                ballRenderer = ball.GetComponentInChildren<Renderer>();
            }
            var list = new List<Renderer>();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (!r.transform.IsChildOf(ballSocket)) list.Add(r);
            bodyRenderers = list.ToArray();
        }

        // 动画写完之后再改挂点缩放 / 火球滚动（片段里没有缩放曲线，挂点缩放由这里全权负责）
        void LateUpdate()
        {
            if (!ballInit) InitBall();
            FlameFx();
            if (!ballSocket) return;
            float curlK = state == "curl" ? Mathf.Clamp01((stateTime / Mathf.Max(0.05f, curlTime) - RearFrac) / (1 - RearFrac)) : 0;
            float c = state == "roll" ? 1 : curlK;
            bool want = !Dead && c > 0.5f;
            if (want != balled)
            {
                balled = want;
                foreach (var r in bodyRenderers) if (r) r.enabled = !want;
                var at = Center;
                ShotFx.Instance?.Impact(at, Vector3.up, true, 3.5f * transform.localScale.x);
                ShotFx.Instance?.MuzzleFlash(at, 1.5f);
            }
            ballSocket.localScale = Vector3.one * (balled ? 0.75f + 0.25f * Mathf.Clamp01((c - 0.5f) / 0.25f) : 0.01f);
            if (state == "roll")
            {
                var v = ManualVelocity;
                v.y = 0;
                rollAngle += v.magnitude * Time.deltaTime / (BallR * transform.localScale.x) * Mathf.Rad2Deg;
            }
            else rollAngle = 0;
            if (!ball) return;
            ball.localRotation = Quaternion.AngleAxis(rollAngle, ballSocket.InverseTransformDirection(transform.right)) * ballRest;
            ball.localPosition = Vector3.zero;
            // 火球贴地：挂点在蜷身姿势里的高度和美术火球的半径对不上，按火球实际包围盒把最低点放到地面上
            if (balled && ballRenderer)
            {
                float lift = transform.position.y + 0.02f - ballRenderer.bounds.min.y;
                ball.position += Vector3.up * lift;
            }
        }

        /// <summary>自爆：伤玩家（火）、留余火，自身死亡但不算玩家击杀</summary>
        void Detonate()
        {
            if (detonated || Dead) return;
            detonated = true;
            Detonations++;
            var c = Center;
            var info = DamageInfo.Simple(0, DamageSource.Enemy, c, Vector3.up);
            info.element = Element.Fire;
            // 被嘲讽时扑的是灵体诱饵：炸不到玩家（照样震屏）
            if (Taunted)
            {
                DecoyBlocked(Target);
                Spiritfire.Game.Blast.Shake(c, 0.7f, BlastRadius * 3.2f);
            }
            else Spiritfire.Game.Blast.Player(c, BlastRadius, Damage, Element.Fire, this, 0.5f, 0.7f, 5.5f);
            GameAudio.PlayAt("explosion", c, 1f, 1.15f);
            Fx.Explosion(c, BlastRadius, Hex.Rgb(0xff8a2a));
            Blast(c);
            hp.noReward = true;
            hp.Kill(info);
        }

        void OnKilledByPlayer(DamageInfo info)
        {
            // 静默清场（EnemyRegistry.PurgeAll）：不留余火、不炸（同 TS attackDirector.purging）
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            var c = Center;
            body.ClearOverlay(CurlChannel);
            FireZone.Spawn(transform.position, BurnRadius * (elite ? 1.25f : 1f), BurnTime, Damage * BurnRatio);
            if (detonated) return;
            detonated = true;
            if (state != "roll")
            {
                // 走路 / 蜷身时被打死：火毛散成一团火星
                Fx.Burst(c, TrailColor, 12, 3f, 0.45f, 0.16f * Size, -2f);
                Fx.Burst(c, EmberColor, 14, 4f, 0.9f, 0.06f, 3f);
                return;
            }
            // 滚动中被打爆：火球照样炸开，只伤其他敌人
            var blast = DamageInfo.Simple(DeathBlastBase * level * (elite ? 1.5f : 1f), DamageSource.Explosion, c, Vector3.up);
            blast.tags = DamageTag.Explosion;
            blast.element = Element.Fire;
            blast.knockback = 6;
            Blast(c);
            Combat.Explode(c, BlastRadius, blast, true, 0);
        }

        /// <summary>爆炸的附加层（同 TS blastFx）：贴地火环冲击波 + 上冲的火柱 + 焦痕（比余火久）+ 火团、余烬</summary>
        void Blast(Vector3 c)
        {
            var ground = DesertKit.OnGround(c);
            if (ground.y > c.y) ground.y = transform.position.y;
            ShotFx.Instance?.Impact(c, Vector3.up, true, 10f);
            ShotFx.Instance?.MuzzleFlash(c, 4f);
            Telegraph.Wave(c, BlastRadius * 1.05f, 18f, new Color(1f, 0.5f, 0.15f));
            DesertKit.FireRing(ground, BlastRadius * 1.05f);
            DesertKit.FlamePillar(ground, 0.9f, 2.6f * (elite ? 1.2f : 1f));
            DesertKit.Scorch(ground, BlastRadius * 0.6f, 8f);
            Fx.Burst(ground + Vector3.up * 0.3f, TrailColor, 10, 2.2f, 0.5f, 0.4f, -6f);
            Fx.Burst(c, EmberColor, 24, 6f, 1.2f, 0.06f, 4f);
        }
    }
}
