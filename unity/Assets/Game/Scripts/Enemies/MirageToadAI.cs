using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜃楼蟾（Three.js 版 src/enemies/types/MirageToad.ts）：炮兵。
    ///   站位：13–26 m，太近（7 m 内）快速跳开；看不见玩家时 24 m 内也能隔着掩体盲吐
    ///   吐火：拿重击名额 → 鼓囊 1 s → 抛物线火球（飞行 1.2–1.8 s，落点预判玩家 45% 的位移，落点 3.2 m 预警）→ 爆炸 3.2 m
    ///         精英连吐两颗（第二颗偏开 2.5–4 m）
    ///   蜃景：每 13–17 s 引气 0.8 s，在身边投出 2 个分身（30 血、吐假火球、10 s 后或本体死亡时消散，不给奖励）
    /// </summary>
    public sealed class MirageToadAI : EnemyAI
    {
        const float MinRange = 13, MaxRange = 26, BlindRange = 24, PuffTime = 1f, BallGravity = 16, BallRadius = 3.2f;
        const float MirageChannel = 0.8f, DecoyLife = 10f;

        public bool isDecoy;
        public MirageToadAI caster;
        float mirageCd, windTime, recoverTime, strafeTimer, strafeSign = 1;
        int shots;
        Transform sac;

        protected override string InitialState => "move";

        protected override void Awake()
        {
            base.Awake();
            mirageCd = Random.Range(4f, 7f);
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name.EndsWith("sac")) { sac = t; break; }
        }

        protected override void Start()
        {
            base.Start();
            if (isDecoy)
            {
                hp.noReward = true;
                body.despawnAfter = 0.3f;
                // 蜃景：冷色、半透明感（实例色调偏青）
                var block = new MaterialPropertyBlock();
                foreach (var r in GetComponentsInChildren<Renderer>())
                {
                    r.GetPropertyBlock(block);
                    block.SetColor("_Tint", new Color(0.7f, 0.92f, 1.15f, 1f));
                    r.SetPropertyBlock(block);
                }
            }
        }

        protected override void Think(float dt)
        {
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
                    bool canLob = sees || d <= BlindRange;
                    if (!isDecoy && mirageCd <= 0 && sees && d <= MaxRange + 6)
                    {
                        Stop();
                        Play("mirage", 0.08f);
                        SetState("mirage");
                        break;
                    }
                    KeepRange(MinRange, MaxRange, d < 7 ? moveSpeed * 1.4f : moveSpeed, strafeSign);
                    FacePlayer(170, dt);
                    if (cooldown <= 0 && canLob && d >= 5 && d <= 32)
                    {
                        if (isDecoy || RequestAttack(AttackTokens.Kind.Heavy, PuffTime + 1.2f))
                        {
                            windTime = Windup(PuffTime, 0.6f);
                            Stop();
                            Play("puff", 0.08f);
                            SetState("puff");
                        }
                        else cooldown = Random.Range(0.5f, 1f);
                    }
                    break;
                }
                case "puff":
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
                    if (stateTime >= MirageChannel)
                    {
                        CastMirage();
                        mirageCd = Random.Range(13f, 17f);
                        recoverTime = 0.4f;
                        SetState("recover");
                    }
                    break;
                case "recover":
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
            var color = isDecoy ? new Color(0.65f, 0.9f, 1f) : new Color(1f, 0.55f, 0.18f);
            Telegraph.Circle(target, BallRadius, T, isDecoy ? new Color(0.6f, 0.85f, 1f) : new Color(1f, 0.45f, 0.15f));
            EnemyProjectile.Spawn(from, v, BallGravity, Damage, 0.32f * transform.localScale.x, BallRadius, color, T + 1.5f, Element.Fire, isDecoy);
        }

        void CastMirage()
        {
            int want = elite ? 3 : 2;
            for (int i = 0; i < want; i++)
            {
                var c = Random.insideUnitCircle.normalized * Random.Range(3f, 6f);
                var p = transform.position + new Vector3(c.x, 0, c.y);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) continue;
                var decoy = EnemyRoster.Spawn("mirage_toad_decoy", hit.position, transform.rotation, level, false, transform.parent);
                ShotFx.Instance?.Impact(hit.position + Vector3.up, Vector3.up, false, 4f);
                if (decoy is MirageToadAI m)
                {
                    m.isDecoy = true;
                    m.caster = this;
                }
            }
        }
    }
}
