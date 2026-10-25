using Spiritfire.Art;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜃楼蟾（Three.js 版 src/enemies/types/MirageToad.ts）：炮兵。
    ///   站位：13–26 m，太近（7 m 内）快速跳开；看不见玩家时 24 m 内也能隔着掩体盲吐
    ///   吐火：拿重击名额 → 鼓囊 1 s → 抛物线火球（飞行 1.2–1.8 s，落点预判玩家 45% 的位移，落点 3.2 m 预警）→ 爆炸 3.2 m
    ///         精英连吐两颗（第二颗偏开 2.5–4 m）
    ///   蜃景：每 13–17 s 引气 0.8 s，在身边投出分身补到 2 个（精英 3 个；30 血、10 s 后或本体死亡时消散，不给奖励）。
    ///         分身半透明闪烁（同 Three.js MirageToadDecoy）；吐的是幻影火球：没有落点预警、冷色半透明、飞到一半碎成热浪
    ///   跳着走：只在腾空段前进（同 Three.js 的 HOP_AIR_SPEED / HOP_GROUND_SPEED）。腾空与否直接看动画里 root 骨骼
    ///         抬起的高度，不另算相位——混合、过渡、加速播放时位移都和看到的跳跃对得上；落地前不起手吐火 / 施幻术
    ///   寻视线（同 TS seekSight）：盲吐够不着（24 m 外又看不见）时去玩家 10–26 m 环带里一个看得见的站位
    ///   喉囊鼓起（同 TS NATIVE_SAC_SWELL）：鼓囊前摇里喉囊（弱点）胀大到 ×1.32、往前下方鼓出、末段高频颤动；吐出时一缩
    ///   蜃火珠（同 TS MirageFireball）：真火珠 flame 外观（白金芯 + 橙红火焰 + 拖尾），落点金色预警圈；
    ///         落地爆炸（边缘剩一半、掀开玩家）+ 冲击环 + 「炽沙」余火 1.9 m、2.6 s、每 0.5 s 一跳 12% 伤害（地火，祸斗能吃）+ 焦痕；
    ///         幻影火珠：冷白半透明 orb、没有预警圈、飞到 55% 碎成冷光
    ///   被打断（眩晕 / 玩家阵亡）：已经吐出的火珠照样落地；冷却重摇 1.5–2.5 s（同 TS cancelAttack）
    /// </summary>
    public sealed class MirageToadAI : EnemyAI
    {
        const float MinRange = 13, MaxRange = 26, BlindRange = 24, PuffTime = 1f, BallGravity = 16, BallRadius = 3.2f;
        const float MirageChannel = 0.8f, DecoyLife = 10f;
        // 腾空判定：root 骨骼比站立高出 2–10 cm（设计尺寸）之间渐入；倍率按 Move 片段积分，整跳平均移速 = 1 倍
        const float HopLiftLo = 0.02f, HopLiftHi = 0.1f, HopAirSpeed = 2.8f, HopGroundSpeed = 0.2f;

        /// <summary>鼓囊最大胀大量（同 TS NATIVE_SAC_SWELL）、余火半径 / 时长 / 每跳比例</summary>
        public const float SacSwell = 0.32f, BurnRadius = 1.9f, BurnTime = 2.6f, BurnRatio = 0.12f;

        public bool isDecoy;
        public MirageToadAI caster;
        float mirageCd, windTime, recoverTime, strafeTimer, strafeSign = 1, spitAge = 99;
        Vector3 sacRest;
        bool sacInit;
        readonly SightSeeker seeker = new();

        /// <summary>当前喉囊缩放（1 = 平时；测试用）、吐过几颗真火珠、炸过几次、寻视线挪过几次站位</summary>
        public float SacScale { get; private set; } = 1;
        public int Spits { get; private set; }
        public int Blasts { get; private set; }
        public int SightMoves { get; private set; }
        int shots;
        Transform sac, hopBone;
        float hopRest, hopAir;
        CreatureLocomotion loco;
        readonly List<MirageToadAI> decoys = new();
        Renderer[] ghost;
        float flickerSeed;

        /// <summary>腾空程度 0..1（动画里身体离地）</summary>
        public float HopAir => hopAir;
        bool Landed => hopAir < 0.05f;
        protected override float GaitMult => Mathf.Lerp(HopGroundSpeed, HopAirSpeed, hopAir);

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            mirageCd = Random.Range(4f, 7f);
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                if (!sac && t.name.EndsWith("sac")) sac = t;
                if (!hopBone && t.name == "root") hopBone = t;
            }
            // 预制体里是绑定姿势：记下 root 骨骼的站立高度（设计尺寸；名册体型在 Awake 之后才乘上）
            if (hopBone) hopRest = (hopBone.position.y - transform.position.y) / Mathf.Max(0.01f, transform.lossyScale.y);
            loco = GetComponent<CreatureLocomotion>();
            // 一冲一停：腾空段要很快提到 2.8 倍速、落地很快刹住，不然跳与跳之间会滑
            agent.acceleration = 90;
            GlowStyle(0.05f, 0.03f, 2.4f, 0.5f);
        }

        void SampleHop()
        {
            if (!hopBone) { hopAir = 0; return; }
            float lift = (hopBone.position.y - transform.position.y) / Mathf.Max(0.01f, transform.lossyScale.y) - hopRest;
            float t = Mathf.Clamp01((lift - HopLiftLo) / (HopLiftHi - HopLiftLo));
            float was = hopAir;
            hopAir = t * t * (3 - 2 * t);
            // 落地：驮着半座佛塔的巨蟾一跳一落，脚下扬一团沙（Three.js 没有，这里补上落地的分量感）
            if (was > 0.5f && hopAir < 0.05f && !isDecoy && state == "move")
                ShotFx.Instance?.Impact(transform.position + transform.forward * 0.3f * Size, Vector3.up, false, 1.6f * Size);
        }

        protected override void Start()
        {
            base.Start();
            if (isDecoy)
            {
                hp.noReward = true;
                body.despawnAfter = 0.3f;
                MakeGhost();
            }
        }

        /// <summary>蜃景的身体：材质实例切到 alpha 混合（保留深度写入，身体内部不透出来），不投影；发光件保持叠加</summary>
        void MakeGhost()
        {
            ghost = System.Array.FindAll(GetComponentsInChildren<Renderer>(), r => !r.name.Contains("GlowShell"));
            flickerSeed = Random.value * 10f;
            foreach (var r in ghost)
            {
                r.shadowCastingMode = ShadowCastingMode.Off;
                var mats = r.materials;
                foreach (var m in mats)
                {
                    if (!m || m.IsKeywordEnabled("_ADDITIVE") || !m.HasProperty("_SrcBlend")) continue;
                    m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                    m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                    m.SetOverrideTag("RenderType", "Transparent");
                    m.renderQueue = (int)RenderQueue.Transparent;
                }
                r.materials = mats;
            }
            Flicker();
        }

        /// <summary>半透明闪烁：0.42 ± 0.16 的慢呼吸，偶尔一下猛地变淡（同 Three.js）。走身体的着色通道「ghost」（和其他着色来源相乘，不互相覆盖）</summary>
        void Flicker()
        {
            if (ghost == null) return;
            float a = 0.42f + 0.16f * Mathf.Sin(age * 9 + flickerSeed) + (Mathf.Sin(age * 31) > 0.85f ? -0.2f : 0);
            body.SetTint("ghost", new Color(0.75f, 0.93f, 1.1f, Mathf.Clamp01(a)));
        }

        protected override void Think(float dt)
        {
            SampleHop();
            if (isDecoy) Flicker();
            // 只有 move 状态在走：其余状态（鼓囊、吐火、施法、收招）混合树回到待机
            if (loco) loco.speedOverride = 0;
            float d = DistToPlayer;
            if (!isDecoy && mirageCd > 0) mirageCd -= dt;
            // 分身：时间到或本体死了就消散
            if (isDecoy && (age > DecoyLife || !caster || caster.Dead))
            {
                ShotFx.Instance?.Impact(transform.position + Vector3.up, Vector3.up, false, 3f);
                Destroy(gameObject);
                return;
            }
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(2f, 3.5f);
                strafeSign = -strafeSign;
            }
            switch (state)
            {
                case "move":
                {
                    Glow = 0.2f + 0.1f * Mathf.Sin(age * 2.4f);
                    bool canLob = sees || d <= BlindRange;
                    float speed = d < 7 ? moveSpeed * 1.4f : moveSpeed;
                    // 混合树按名义速度播跳跃（实际位移随跳跃一冲一停）
                    if (loco) loco.speedOverride = speed * SpeedMult;
                    if (!isDecoy && mirageCd <= 0 && sees && d <= MaxRange + 6 && Landed)
                    {
                        Sfx("telegraph", 0.6f, 1.4f);
                        Stop();
                        Play("mirage", 0.08f);
                        SetState("mirage");
                        break;
                    }
                    // 寻视线：盲吐够不着时去一个看得见的站位（真身才找；分身只是虚张声势）
                    if (!canLob && !isDecoy && seeker.Tick(sees, dt, new SightQuery(PlayerPos, PlayerEye, transform.position, MinRange - 3, MaxRange, 1.4f * Size)))
                    {
                        if (seeker.HasSpot)
                        {
                            MoveTo(seeker.Spot, moveSpeed);
                            if (seeker.Arrived(transform.position))
                            {
                                seeker.Reached();
                                SightMoves++;
                            }
                        }
                        else MoveTo(PlayerPos, moveSpeed);
                        FaceMovement(200, dt);
                        break;
                    }
                    KeepRange(MinRange, MaxRange, speed, strafeSign);
                    // 跳着横移：身体偏向跳的方向（蟾蜍横着蹦很怪），头继续盯着玩家
                    FaceAimTravel(170, dt, 0.6f);
                    if (cooldown <= 0 && canLob && d >= 5 && d <= 32 && Landed)
                    {
                        if (isDecoy || RequestAttack(AttackTokens.Kind.Heavy, PuffTime + 1.2f))
                        {
                            windTime = Windup(PuffTime, 0.6f);
                            Sfx("telegraph", 0.75f, 0.55f);
                            Stop();
                            PlayTimed("puff", windTime, 0.08f);
                            SetState("puff");
                        }
                        else cooldown = Random.Range(0.5f, 1f);
                    }
                    break;
                }
                case "puff":
                    Glow = 0.3f + 0.7f * Mathf.Clamp01(stateTime / windTime);
                    FacePlayer(230, dt);
                    if (Random.value < dt * (6 + stateTime / windTime * 20)) ShotFx.Instance?.Impact(Mouth(), Vector3.up, !isDecoy, 0.4f);
                    if (stateTime >= windTime)
                    {
                        shots = 0;
                        SetState("spit");
                    }
                    break;
                case "spit":
                {
                    Glow = 1;
                    FacePlayer(230, dt);
                    int count = elite && !isDecoy ? 2 : 1;
                    if (shots < count && stateTime >= shots * 0.32f)
                    {
                        Spit(shots);
                        shots++;
                    }
                    if (shots >= count)
                    {
                        recoverTime = 0.7f;
                        SetState("recover");
                    }
                    break;
                }
                case "mirage":
                    Glow = 0.6f + 0.4f * Mathf.Sin(stateTime * 30);
                    if (stateTime >= MirageChannel)
                    {
                        CastMirage();
                        mirageCd = Random.Range(13f, 17f);
                        recoverTime = 0.4f;
                        SetState("recover");
                    }
                    break;
                case "recover":
                    Glow = 0.2f;
                    FacePlayer(140, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(auraAttackRate))
                    {
                        ReleaseAttack();
                        if (cooldown <= 0.5f) RollCooldown(3.5f, 5f);
                        PlayLocomotion();
                        SetState("move");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("move");
                    break;
            }
        }

        protected override void OnStunned()
        {
            if (loco) loco.speedOverride = 0;
        }

        protected override void CancelAttack()
        {
            Glow = 0;
            if (state is "puff" or "spit" or "mirage" or "recover") RollCooldown(1.5f, 2.5f);
        }

        /// <summary>
        /// 喉囊鼓起（动画写完之后再改骨骼缩放：片段里没有缩放曲线）：鼓囊前摇 t 0..1 → ×(1 + 0.32 t)，竖直略扁、前后略鼓，
        /// 末段叠高频颤动；吐出后 0.15 s 里一缩。弱点球挂在喉囊骨上，一起变大
        /// </summary>
        void LateUpdate()
        {
            if (!sac) return;
            if (!sacInit)
            {
                sacInit = true;
                sacRest = sac.localScale;
            }
            spitAge += Time.deltaTime;
            float t = state == "puff" && !Dead ? Mathf.Clamp01(stateTime / Mathf.Max(0.05f, windTime)) : 0;
            float kick = Mathf.Exp(-spitAge * 7f);
            float k = 1 + 0.03f * Mathf.Sin(age * 2.2f) + t * SacSwell + t * 0.035f * Mathf.Sin(age * 30f) - kick * 0.25f;
            k = Mathf.Max(0.65f, k);
            SacScale = k;
            sac.localScale = new Vector3(sacRest.x * k, sacRest.y * Mathf.Max(0.65f, k * (1 - 0.1f * t)), sacRest.z * Mathf.Max(0.65f, k * (1 + 0.06f * t)));
        }

        Vector3 Mouth()
        {
            float k = transform.localScale.x;
            var basePos = sac ? sac.position : transform.position + Vector3.up * 0.8f * k;
            return basePos + transform.forward * 0.4f * k + Vector3.up * 0.4f * k;
        }

        void Spit(int index)
        {
            var from = Mouth();
            GameAudio.PlayAt("shot_launcher", from, 0.8f, 0.55f);
            var to = PlayerPos - from;
            to.y = 0;
            float T = Mathf.Clamp(1.2f + to.magnitude / 30f * 0.6f, 1.2f, 1.8f);
            var target = PredictPlayer(T * 0.45f);
            if (index > 0)
            {
                var c = Random.insideUnitCircle.normalized * Random.Range(2.5f, 4f);
                target += new Vector3(c.x, 0, c.y);
            }
            target.y = GroundY(target);
            var v = EnemyProjectile.Ballistic(from, target, T, BallGravity);
            spitAge = 0;
            float k = transform.localScale.x;
            if (isDecoy)
            {
                // 幻影火球：不给落点预警（这就是分辨真假的线索），冷白半透明，飞到 55% 就碎成一阵冷光
                EnemyProjectile.Spawn(new EnemyProjectileSpec(from, v, 0, 0.32f * k, T * 0.55f)
                {
                    gravity = BallGravity, explosionRadius = BallRadius, color = new Color(0.82f, 0.94f, 1f, 0.45f), visual = "orb", scale = 1.1f,
                    fake = true, source = this, trail = ProjectileTrail.Off,
                });
                return;
            }
            Telegraph.Circle(target, BallRadius, T, new Color(1f, 0.69f, 0.19f));
            float dmg = Damage;
            float size = Size;
            var self = this;
            bool spirit = Taunted;
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, v, dmg, 0.32f * k, T + 1.5f)
            {
                gravity = BallGravity, explosionRadius = BallRadius, explosionFalloff = 0.5f, element = Element.Fire,
                color = new Color(1f, 0.55f, 0.18f), visual = "flame", scale = 1.6f, source = this, spirit = Taunted,
                onImpact = (at, _) => FireballLanded(self, at, dmg, size, spirit),
            });
            Spits++;
        }

        /// <summary>真火珠落地（爆炸伤害由投射物结算）：火团、冲击环、按距离震屏、「炽沙」余火（地火）、焦痕</summary>
        static void FireballLanded(MirageToadAI owner, Vector3 at, float damage, float size, bool spirit)
        {
            var ground = DesertKit.OnGround(at);
            if (ground.y > at.y) ground.y = at.y;
            Fx.Explosion(at, BallRadius, new Color(1f, 0.63f, 0.19f));
            DesertKit.FireRing(ground, BallRadius * 1.15f);
            Fx.Burst(ground + Vector3.up * 0.4f, Hex.Rgb(0xffc050), 16, 2.6f, 0.65f, 0.55f * size, -7f);
            Fx.Burst(ground, DesertKit.Dust, 8, 4f, 0.6f, 0.1f * size, 15f);
            CameraShake.Quake(at, 0.7f, BallRadius * 3.2f, 0.35f);
            // 被嘲讽时吐向灵体诱饵：不留伤人的余火
            if (!spirit) FireZone.Spawn(ground, BurnRadius * size, BurnTime, damage * BurnRatio);
            DesertKit.Scorch(ground, BallRadius * 0.6f, 7f);
            if (owner) owner.Blasts++;
        }

        /// <summary>投出分身补到上限（还活着的不重复投）：在身体两侧展开成扇形，4–7 m</summary>
        void CastMirage()
        {
            decoys.RemoveAll(m => !m || m.Dead);
            int want = (elite ? 3 : 2) - decoys.Count;
            float facing = transform.eulerAngles.y * Mathf.Deg2Rad;
            for (int i = 0; i < want; i++)
            {
                float a = facing + (i - (want - 1) / 2f) * 1.9f + Random.Range(-0.3f, 0.3f) + Mathf.PI / 2;
                float r = Random.Range(4f, 7f) * Size;
                var p = transform.position + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                if (!NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) continue;
                var decoy = EnemyRoster.Spawn("mirage_toad_decoy", hit.position, transform.rotation, level, false, new SpawnOptions { parent = transform.parent });
                ShotFx.Instance?.Impact(hit.position + Vector3.up, Vector3.up, false, 4f);
                if (decoy is MirageToadAI m)
                {
                    m.isDecoy = true;
                    m.caster = this;
                    m.cooldown = Random.Range(0.6f, 1.8f);
                    decoys.Add(m);
                }
            }
            Telegraph.Wave(transform.position, 7f * Size, 14f, new Color(1f, 0.88f, 0.62f));
        }

        /// <summary>活着的分身（测试用）</summary>
        public int DecoyCount
        {
            get
            {
                decoys.RemoveAll(m => !m || m.Dead);
                return decoys.Count;
            }
        }
    }
}
