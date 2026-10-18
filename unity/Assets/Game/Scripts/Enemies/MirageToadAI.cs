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
    /// </summary>
    public sealed class MirageToadAI : EnemyAI
    {
        const float MinRange = 13, MaxRange = 26, BlindRange = 24, PuffTime = 1f, BallGravity = 16, BallRadius = 3.2f;
        const float MirageChannel = 0.8f, DecoyLife = 10f;
        // 腾空判定：root 骨骼比站立高出 2–10 cm（设计尺寸）之间渐入；倍率按 Move 片段积分，整跳平均移速 = 1 倍
        const float HopLiftLo = 0.02f, HopLiftHi = 0.1f, HopAirSpeed = 2.8f, HopGroundSpeed = 0.2f;

        public bool isDecoy;
        public MirageToadAI caster;
        float mirageCd, windTime, recoverTime, strafeTimer, strafeSign = 1;
        int shots;
        Transform sac, hopBone;
        float hopRest, hopAir;
        CreatureLocomotion loco;
        readonly List<MirageToadAI> decoys = new();
        Renderer[] ghost;
        MaterialPropertyBlock ghostBlock;
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
            ghostBlock = new MaterialPropertyBlock();
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

        /// <summary>半透明闪烁：0.42 ± 0.16 的慢呼吸，偶尔一下猛地变淡（同 Three.js）</summary>
        void Flicker()
        {
            if (ghost == null) return;
            float a = 0.42f + 0.16f * Mathf.Sin(age * 9 + flickerSeed) + (Mathf.Sin(age * 31) > 0.85f ? -0.2f : 0);
            var tint = new Color(0.75f, 0.93f, 1.1f, Mathf.Clamp01(a));
            foreach (var r in ghost)
            {
                if (!r) continue;
                r.GetPropertyBlock(ghostBlock);
                ghostBlock.SetColor("_Tint", tint);
                r.SetPropertyBlock(ghostBlock);
            }
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
                        Stop();
                        Play("mirage", 0.08f);
                        SetState("mirage");
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

        Vector3 Mouth()
        {
            float k = transform.localScale.x;
            var basePos = sac ? sac.position : transform.position + Vector3.up * 0.8f * k;
            return basePos + transform.forward * 0.4f * k + Vector3.up * 0.4f * k;
        }

        void Spit(int index)
        {
            var from = Mouth();
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
            if (isDecoy)
            {
                // 幻影火球：不给落点预警（这就是分辨真假的线索），冷色，飞到 55% 就碎成一阵冷光
                EnemyProjectile.Spawn(from, v, BallGravity, 0, 0.32f * transform.localScale.x, BallRadius, new Color(0.82f, 0.94f, 1f), T * 0.55f, Element.None, true);
                return;
            }
            Telegraph.Circle(target, BallRadius, T, new Color(1f, 0.45f, 0.15f));
            EnemyProjectile.Spawn(from, v, BallGravity, Damage, 0.32f * transform.localScale.x, BallRadius, new Color(1f, 0.55f, 0.18f), T + 1.5f, Element.Fire, false, Taunted);
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
                var decoy = EnemyRoster.Spawn("mirage_toad_decoy", hit.position, transform.rotation, level, false, transform.parent);
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
