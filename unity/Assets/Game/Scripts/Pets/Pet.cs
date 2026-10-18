using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灵宠本体（docs/pet-system.md 第 3、6 节）：
    ///   状态：跟随（玩家身后 2.5–3.5 m；飞行宠物在肩后上方）→ 交战（玩家 18 m 内有敌人：打玩家正在打的那个，否则离玩家最近的）
    ///        → 归位（离玩家超过 22 m 或卡住 3 s：灵火一闪瞬移回身边）。
    ///   移动：地面宠物用 NavMeshAgent（让路优先级 90，朝向自己管），找不到网格就贴地飘；飞行宠物插值飞行，遇墙抬高。
    ///   灵体：没有碰撞体，不挡玩家、不挡子弹、不受伤。
    ///   程序动画（只动 Visual 子节点）：呼吸、悬浮起伏、跑动颠步、转身倾斜、攻击前冲 + 挤压拉伸、扇翅 / 甩尾、出场弹出、升级闪光。
    ///   灵契：1–5 级，经验 6 / 10 / 16 / 24；每级伤害 +15%、灵技冷却 −6%；3 级觉醒。
    /// 攻击统一走 <see cref="Hit"/> / <see cref="AoE"/>：DamageSource.Pet、instigator = 本体、深度 0（能引发元素反应）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Pet : MonoBehaviour
    {
        public const float EngageRange = 18f, LeashRange = 22f, StuckTime = 3f, TargetMemory = 3f;
        public const int MaxLevel = 5, AwakenLevel = 3;
        static readonly int[] XpNeed = { 6, 10, 16, 24 };

        public enum Mode { Follow, Engage, Return }

        public PetDef def;
        public PetOwner Owner { get; private set; }
        public PetBehaviour Behaviour { get; private set; }
        public Mode State { get; private set; }
        public int Level { get; private set; } = 1;
        public float Xp { get; private set; }
        /// <summary>升到下一级还需要的总经验（满级 0）</summary>
        public float XpNext => Level >= MaxLevel ? 0 : XpNeed[Level - 1];
        public bool Awakened => Level >= AwakenLevel;
        public float DamageMult => 1 + 0.15f * (Level - 1);
        public float CooldownMult => 1 - 0.06f * (Level - 1);
        public float SkillCooldown => def.skillCooldown * CooldownMult;
        public float SkillLeft { get; private set; }
        /// <summary>灵技冷却好了（正在普攻也算好：按 G 会排队，动作一结束就放）</summary>
        public bool SkillReady => SkillLeft <= 0;
        public bool Busy => busy > 0;
        public Damageable Target { get; private set; }
        /// <summary>本体造成的伤害合计（测试统计）</summary>
        public float DamageDealt { get; private set; }
        public float Height => model != null ? model.height : def.height;
        public Transform Visual => visual;
        public event Action<Pet> LeveledUp;

        Transform visual;
        PetModel model;
        NavMeshAgent agent;
        Transform aura;
        Vector3 flyVel, lastPos, lastGoal, lungeDir;
        float side = 1, age, attackTimer, retargetTimer, stuckTimer, repath, returnCooldown, agentRetry = 2f;
        float speedSm, bank, lastYaw, hopPhase, popT, flashT = -1, lungeT = -1, lungeDur, lungeDist, whipT = -1, queuedCast;
        bool moving, released;
        int busy, manual;
        Damageable playerTarget;
        float playerTargetUntil;

        // ───────────── 生成 / 销毁 ─────────────
        /// <summary>skillLeft = 灵技剩余冷却（换宠再换回来时接着算，不刷新）</summary>
        public static Pet Spawn(PetDef def, PetOwner owner, Vector3 pos, Quaternion rot, int level = 1, float xp = 0, float skillLeft = 0)
        {
            var go = new GameObject($"灵宠 · {def.name}");
            go.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, rot.eulerAngles.y, 0));
            var pet = go.AddComponent<Pet>();
            pet.SkillLeft = Mathf.Max(0, skillLeft);
            pet.Init(def, owner, Mathf.Clamp(level, 1, MaxLevel), xp);
            return pet;
        }

        void Init(PetDef d, PetOwner o, int lvl, float xp)
        {
            def = d;
            Owner = o;
            Level = lvl;
            Xp = xp;
            side = d.followSide >= 0 ? 1 : -1;
            visual = new GameObject("Visual").transform;
            visual.SetParent(transform, false);
            model = PetVisuals.Build(d, visual);
            aura = FxMaterials.GlowSprite(visual, Mathf.Max(0.8f, model.size * 1.6f), new Color(d.RarityColor.r, d.RarityColor.g, d.RarityColor.b, d.rarity == PetRarity.Mythic ? 0.32f : 0.18f));
            aura.localPosition = Vector3.up * Height * 0.5f;
            if (d.flying) transform.position = FlyGoal();
            else SetupAgent();
            lastPos = transform.position;
            lastYaw = transform.eulerAngles.y;
            popT = 0;
            visual.localScale = Vector3.one * 0.01f;
            PetFx.Burst(transform.position + Vector3.up * Height * 0.5f, d.RarityColor, 2.5f + model.size, 0.6f);
            ShotFx.Instance?.Impact(transform.position + Vector3.up * 0.3f, Vector3.up, false, 2f);
            Behaviour = d.create();
            Behaviour.Bind(this);
            if (Awakened) Behaviour.OnAwaken();
        }

        void SetupAgent()
        {
            if (!NavMesh.SamplePosition(transform.position, out var hit, 3f, NavMesh.AllAreas)) return;
            transform.position = hit.position;
            agent = gameObject.AddComponent<NavMeshAgent>();
            agent.baseOffset = 0; // 默认 1 m：模型脚底在 y=0，悬浮高度由 Visual 子节点管
            agent.radius = Mathf.Clamp(def.height * 0.35f, 0.2f, 0.45f);
            agent.height = Mathf.Max(0.5f, def.height);
            agent.speed = def.moveSpeed;
            agent.acceleration = 40;
            agent.angularSpeed = 0;
            agent.updateRotation = false;
            agent.autoBraking = true;
            agent.stoppingDistance = 0.35f;
            agent.avoidancePriority = 90;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.LowQualityObstacleAvoidance;
            agent.Warp(hit.position);
        }

        bool AgentOk => agent && agent.enabled && agent.isOnNavMesh;

        /// <summary>代理因落点不在网格上被关掉后：脚下 1.5 m 内找到网格就重新挂上</summary>
        bool Reattach()
        {
            if (!agent || def.flying || !NavMesh.SamplePosition(transform.position, out var h, 1.5f, NavMesh.AllAreas)) return false;
            transform.position = h.position;
            if (!agent.enabled) agent.enabled = true;
            return agent.Warp(h.position);
        }

        void OnEnable() => Combat.EnemyDamaged += OnEnemyDamaged;
        void OnDisable() => Combat.EnemyDamaged -= OnEnemyDamaged;
        void OnDestroy() => Release();

        /// <summary>解除结契：撤销被动加成、事件、修正（可重复调用）。换宠时先调它，再销毁</summary>
        public void Release()
        {
            if (released) return;
            released = true;
            Combat.EnemyDamaged -= OnEnemyDamaged;
            Behaviour?.Unbind();
            Decoys.Remove(transform);
        }

        void OnEnemyDamaged(Damageable d, DamageInfo info, DamageResult r)
        {
            if (info.instigator == this)
            {
                DamageDealt += r.total;
                return;
            }
            // 玩家正在打的目标：记 3 s
            if (!info.reaction && d && !d.Dead && info.source is DamageSource.Weapon or DamageSource.Skill or DamageSource.Explosion)
            {
                playerTarget = d;
                playerTargetUntil = Time.time + TargetMemory;
            }
        }

        // ───────────── 灵契 ─────────────
        public void AddXp(float amount)
        {
            if (Level >= MaxLevel || amount <= 0) return;
            Xp += amount;
            while (Level < MaxLevel && Xp >= XpNeed[Level - 1])
            {
                Xp -= XpNeed[Level - 1];
                Level++;
                flashT = 0;
                PetFx.Burst(Center, PetRarities.Gold, 3f + model.size, 0.7f);
                Say($"灵契 Lv.{Level}", PetRarities.Gold, 1.35f);
                if (Level == AwakenLevel)
                {
                    Behaviour.OnAwaken();
                    Hud.Instance?.Banner($"灵契觉醒 · {def.name}", 2.2f);
                    Hud.Instance?.Toast(def.awakenDesc, 3f);
                    PetFx.Pillar(transform.position, PetRarities.Gold, 1.2f, 8f, 1.4f);
                }
                LeveledUp?.Invoke(this);
            }
            if (Level >= MaxLevel) Xp = 0;
        }

        // ───────────── 灵技 ─────────────
        /// <summary>按 G：冷却好了就放；正在普攻就排队（1.6 s 内动作结束即放）。返回是否放出 / 已排队</summary>
        public bool TryCast()
        {
            if (SkillLeft > 0 || Behaviour == null || released) return false;
            if (Busy || manual > 0)
            {
                queuedCast = Time.time + 1.6f;
                return true;
            }
            return Cast();
        }

        bool Cast()
        {
            queuedCast = 0;
            if (!Behaviour.Skill()) return false;
            SkillLeft = SkillCooldown;
            flashT = 0;
            return true;
        }

        // ───────────── 每帧 ─────────────
        void Update()
        {
            if (released) return; // 已解除结契、本帧末销毁：不再出手 / 嘲讽
            if (!Owner)
            {
                Destroy(gameObject);
                return;
            }
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            age += dt;
            SkillLeft = Mathf.Max(0, SkillLeft - dt);
            attackTimer -= dt;
            returnCooldown -= dt;
            Behaviour.Tick(dt);
            if (queuedCast > 0 && !Busy && manual == 0)
            {
                if (Time.time <= queuedCast && SkillLeft <= 0) Cast();
                queuedCast = 0;
            }

            if (manual == 0 && !Busy) Think(dt);
            Animate(dt);
        }

        void Think(float dt)
        {
            var ppos = Owner.transform.position;
            if (!def.flying && (!agent || !agent.enabled))
            {
                agentRetry -= dt;
                if (agentRetry <= 0)
                {
                    agentRetry = agent ? 0.5f : 2f;
                    if (agent) Reattach();
                    else SetupAgent();
                }
            }
            retargetTimer -= dt;
            if (retargetTimer <= 0)
            {
                retargetTimer = 0.25f;
                Target = PickTarget(ppos);
            }
            else if (Target && !Valid(Target, ppos)) Target = null;

            // 归位：离玩家太远 / 卡住
            if (Flat(transform.position - ppos) > LeashRange || stuckTimer > StuckTime)
            {
                if (returnCooldown <= 0) Teleport(FollowGoal());
                return;
            }
            State = Target ? Mode.Engage : Mode.Follow;
            var goal = FollowGoal();
            if (Target && Behaviour.EngagePoint(Target) is { } ep) goal = ep;

            float speed = def.moveSpeed;
            float dist = def.flying ? Vector3.Distance(transform.position, goal) : Flat(goal - transform.position);
            if (Flat(transform.position - ppos) > 7f) speed *= 1.6f; // 落后太多就追
            // 迟滞：离目标点 1.4 m 外才起步，0.6 m 内停下（不在原地抖）
            if (dist > 1.4f) moving = true;
            else if (dist < 0.6f) moving = false;
            if (moving) MoveTowards(goal, speed, dt);
            else Halt(dt);

            // 卡住检测：想走却几乎不动
            float actual = Flat(transform.position - lastPos) / dt;
            stuckTimer = moving && dist > 2f && actual < 0.4f ? stuckTimer + dt : 0;

            // 朝向：交战看目标，走路看前进方向，停下时随玩家视线
            if (Target && (!moving || dist < 3f)) Face(ReactionSystem.CenterOf(Target) - transform.position, 540, dt);
            else if (moving) Face(transform.position - lastPos, 480, dt);
            else Face(Owner.Forward, 120, dt);

            if (Target && attackTimer <= 0 && Behaviour.CanAttack(Target))
            {
                Behaviour.Attack(Target);
                attackTimer = Behaviour.AttackInterval;
            }
        }

        // ───────────── 目标 ─────────────
        bool Valid(Damageable d, Vector3 ppos) =>
            d && !d.Dead && !d.untargetable && !d.noReward && Flat(d.transform.position - ppos) <= EngageRange;

        /// <summary>玩家最近 3 s 打过的敌人优先；否则离玩家最近、灵宠（或玩家）看得见的</summary>
        Damageable PickTarget(Vector3 ppos)
        {
            if (playerTarget && Time.time < playerTargetUntil && Valid(playerTarget, ppos)) return playerTarget;
            Damageable best = null, fallback = null;
            float bestD = float.MaxValue, fallD = float.MaxValue;
            var eye = Owner.Eye ? Owner.Eye.position : ppos + Vector3.up * 1.6f;
            foreach (var ai in EnemyAI.All)
            {
                if (!ai) continue;
                var d = ai.Health;
                if (!Valid(d, ppos)) continue;
                float dist = Flat(d.transform.position - ppos);
                if (d == Target) dist -= 2f; // 粘住当前目标，免得来回换
                var c = ReactionSystem.CenterOf(d);
                var col = d.GetComponent<Collider>();
                if (dist < bestD && !Combat.Blocked(Center, c, col)) { bestD = dist; best = d; }
                else if (dist < fallD && !Combat.Blocked(eye, c, col)) { fallD = dist; fallback = d; }
            }
            return best ? best : fallback;
        }

        // ───────────── 移动 ─────────────
        /// <summary>跟随位：地面 = 玩家身后侧方；飞行 = 肩后上方</summary>
        public Vector3 FollowGoal() => def.flying ? FlyGoal() : GroundGoal();

        Vector3 GroundGoal()
        {
            var p = Owner.transform.position;
            var f = Owner.Forward;
            var r = new Vector3(f.z, 0, -f.x);
            return p - f * def.followBack + r * (Mathf.Abs(def.followSide) * side);
        }

        Vector3 FlyGoal()
        {
            var p = Owner.transform.position;
            var f = Owner.Forward;
            var r = new Vector3(f.z, 0, -f.x);
            return p + Vector3.up * def.flyHeight - f * 1.3f + r * (Mathf.Abs(def.followSide) * side) + Vector3.up * Mathf.Sin(age * 0.9f) * 0.15f;
        }

        void MoveTowards(Vector3 goal, float speed, float dt)
        {
            if (def.flying)
            {
                FlyTowards(goal, speed, dt);
                return;
            }
            if (AgentOk)
            {
                agent.speed = speed;
                agent.isStopped = false;
                repath -= dt;
                if (repath <= 0 || (goal - lastGoal).sqrMagnitude > 0.36f)
                {
                    repath = 0.25f;
                    lastGoal = goal;
                    if (NavMesh.SamplePosition(goal, out var hit, 3f, NavMesh.AllAreas)) agent.SetDestination(hit.position);
                }
                return;
            }
            HoverTowards(goal, speed, dt);
        }

        void Halt(float dt)
        {
            if (AgentOk && !agent.isStopped)
            {
                agent.isStopped = true;
                agent.velocity = Vector3.zero;
            }
            if (def.flying)
            {
                // 悬停时也轻轻贴着跟随位
                flyVel = Vector3.MoveTowards(flyVel, Vector3.zero, 20f * dt);
                transform.position += flyVel * dt;
            }
        }

        /// <summary>飞行：朝目标插值，前方有墙就先抬高越过去；离地不低于 0.6 m</summary>
        void FlyTowards(Vector3 goal, float speed, float dt)
        {
            var pos = transform.position;
            if (Physics.Linecast(pos, goal, out var h, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                var dir = goal - pos;
                dir.y = 0;
                dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
                var probe = h.point + dir * 0.5f;
                float top = Physics.Raycast(probe + Vector3.up * 30f, Vector3.down, out var t, 40f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? t.point.y : h.point.y + 3f;
                goal = new Vector3(pos.x, top + 1.5f, pos.z) + dir * 0.4f;
            }
            var to = goal - pos;
            float d = to.magnitude;
            var want = d > 0.05f ? to / d * Mathf.Min(speed, d * 2.5f) : Vector3.zero;
            flyVel = Vector3.MoveTowards(flyVel, want, 30f * dt);
            pos += flyVel * dt;
            float ground = GroundY(pos);
            if (pos.y < ground + 0.6f) pos.y = Mathf.MoveTowards(pos.y, ground + 0.6f, 8f * dt);
            transform.position = pos;
        }

        /// <summary>没有导航网格时的地面宠物：贴地飘过去，撞墙就停（卡住会触发归位）</summary>
        void HoverTowards(Vector3 goal, float speed, float dt)
        {
            var pos = transform.position;
            var to = goal - pos;
            to.y = 0;
            float d = to.magnitude;
            if (d < 0.01f) return;
            var step = to / d * Mathf.Min(d, speed * dt);
            if (Physics.Raycast(pos + Vector3.up * 0.4f, step.normalized, out var w, step.magnitude + 0.3f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && w.normal.y < 0.5f)
                return;
            pos += step;
            pos.y = Mathf.MoveTowards(pos.y, GroundY(pos), 12f * dt);
            transform.position = pos;
        }

        void Face(Vector3 dir, float rateDeg, float dt)
        {
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(dir), rateDeg * dt);
        }

        /// <summary>灵火一闪：原地光晕 → 瞬移 → 落点光晕 + 小弹出</summary>
        public void Teleport(Vector3 to)
        {
            PetFx.Burst(Center, def.RarityColor, 1.5f + model.size, 0.4f);
            if (def.flying) to.y = Mathf.Max(to.y, GroundY(to) + 0.6f);
            else if (NavMesh.SamplePosition(to, out var hit, 3f, NavMesh.AllAreas)) to = hit.position;
            else to.y = GroundY(to);
            if (AgentOk)
            {
                // 落点不在网格上（玩家站在岩顶 / 网格外）：关掉代理贴地飘，回到网格附近再挂上
                if (!agent.Warp(to))
                {
                    agent.enabled = false;
                    transform.position = to;
                }
            }
            else
            {
                transform.position = to;
                Reattach();
            }
            flyVel = Vector3.zero;
            lastPos = transform.position;
            stuckTimer = 0;
            returnCooldown = 1f;
            moving = false;
            State = Mode.Return;
            PetFx.Burst(transform.position + Vector3.up * Height * 0.5f, def.RarityColor, 1.8f + model.size, 0.5f);
            ShotFx.Instance?.Impact(transform.position + Vector3.up * 0.2f, Vector3.up, false, 1f);
            popT = 0.2f;
        }

        /// <summary>
        /// 冲刺（冲撞、扑击、穿刺）：脚本接管位置，按 speed 冲向 dest，撞墙停下；每步回调 (上一点, 这一点) 做路径判定。
        /// 用法：在 <see cref="Act"/> 里 yield return pet.DashTo(...)
        /// </summary>
        public IEnumerator DashTo(Vector3 dest, float speed, Action<Vector3, Vector3> onStep = null, float maxTime = 1.5f)
        {
            manual++;
            if (agent)
            {
                if (AgentOk) agent.isStopped = true;
                agent.updatePosition = false;
            }
            float t = 0;
            try
            {
                while (t < maxTime)
                {
                    float dt = Time.deltaTime;
                    t += dt;
                    var pos = transform.position;
                    var to = dest - pos;
                    if (!def.flying) to.y = 0;
                    float d = to.magnitude;
                    if (d < 0.05f) break;
                    var step = to / d * Mathf.Min(d, speed * dt);
                    if (!def.flying && Physics.Raycast(pos + Vector3.up * 0.4f, step.normalized, out var w, step.magnitude + 0.3f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                        && w.normal.y < 0.5f) break;
                    var next = pos + step;
                    if (!def.flying) next.y = GroundY(next);
                    Face(step, 1440, dt);
                    transform.position = next;
                    onStep?.Invoke(pos, next);
                    yield return null;
                }
            }
            finally
            {
                manual--;
                if (manual == 0 && agent)
                {
                    var p = transform.position;
                    bool onMesh = NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas);
                    if (onMesh) p = hit.position;
                    if (agent.enabled && onMesh && agent.Warp(p)) agent.updatePosition = true;
                    else
                    {
                        // 冲到网格外：关掉代理（否则恢复 updatePosition 会把本体拽回冲刺前的位置）
                        agent.enabled = false;
                        agent.updatePosition = true;
                    }
                    transform.position = p;
                }
                lastPos = transform.position;
            }
        }

        /// <summary>做一个动作（冲撞、连抓、灵技演出）：期间不跟随、不普攻</summary>
        public Coroutine Act(IEnumerator routine) => StartCoroutine(ActRoutine(routine));

        IEnumerator ActRoutine(IEnumerator routine)
        {
            busy++;
            try
            {
                while (routine.MoveNext()) yield return routine.Current;
            }
            finally
            {
                busy--;
            }
        }

        // ───────────── 程序动画 ─────────────
        void Animate(float dt)
        {
            var pos = transform.position;
            var v = (pos - lastPos) / dt;
            lastPos = pos;
            float flat = new Vector2(v.x, v.z).magnitude;
            if (flat > 40f) flat = 0; // 瞬移那一帧
            speedSm = Mathf.Lerp(speedSm, flat, 1 - Mathf.Exp(-10f * dt));
            float yaw = transform.eulerAngles.y;
            float yawRate = Mathf.DeltaAngle(lastYaw, yaw) / dt;
            lastYaw = yaw;
            bank = Mathf.Lerp(bank, Mathf.Clamp(-yawRate * 0.05f, -25f, 25f) * (def.flying ? 1f : 0.35f), 1 - Mathf.Exp(-6f * dt));

            float h = Height;
            float move = Mathf.Clamp01(speedSm / 3.5f);
            float breath = 1 + Mathf.Sin(age * 2.4f) * 0.025f;
            Vector3 offset = Vector3.up * def.hover;
            float pitch = 0;
            if (def.flying)
            {
                offset += Vector3.up * (Mathf.Sin(age * 2.2f) * 0.08f * Mathf.Max(0.5f, h));
                pitch = Mathf.Clamp(speedSm * 1.2f, 0, 14f);
            }
            else
            {
                // 跳步：步频跟速度走，个子越小步子越快
                hopPhase += dt * speedSm * Mathf.Clamp(2.4f / Mathf.Max(0.3f, h), 2f, 7f);
                offset += Vector3.up * (Mathf.Abs(Mathf.Sin(hopPhase)) * move * h * 0.12f);
                pitch = Mathf.Sin(hopPhase * 2f) * 4f * move;
                if (def.hover > 0) offset += Vector3.up * Mathf.Sin(age * 1.8f) * 0.05f;
            }

            // 攻击前冲 + 挤压拉伸
            float stretch = 1;
            if (lungeT >= 0)
            {
                lungeT += dt;
                float k = Mathf.Clamp01(lungeT / lungeDur);
                float s = Mathf.Sin(k * Mathf.PI);
                offset += transform.InverseTransformDirection(lungeDir) * (s * lungeDist);
                stretch = 1 + s * 0.22f;
                if (k >= 1) lungeT = -1;
            }
            // 出场弹出 / 升级闪光
            float pop = 1;
            if (popT >= 0)
            {
                popT += dt;
                pop = popT < 0.45f ? EaseOutBack(popT / 0.45f) : 1;
                if (popT >= 0.45f) popT = -1;
            }
            if (flashT >= 0)
            {
                flashT += dt;
                pop *= 1 + Mathf.Sin(Mathf.Clamp01(flashT / 0.5f) * Mathf.PI) * 0.25f;
                if (flashT >= 0.5f) flashT = -1;
            }
            visual.localPosition = offset;
            visual.localRotation = Quaternion.Euler(pitch, 0, bank);
            // 体积大致守恒：沿前后拉长时横向、竖向收一点；呼吸只鼓竖向
            float thin = 1f / Mathf.Sqrt(stretch);
            visual.localScale = Mathf.Max(0.01f, pop) * new Vector3(thin, breath * thin, stretch / Mathf.Sqrt(breath));
            if (aura) aura.localScale = Vector3.one * Mathf.Max(0.8f, model.size * 1.6f) * (1 + Mathf.Sin(age * 3f) * 0.08f);

            // 扇翅（飞得越快扇得越快）、甩尾、龙身波动
            float flap = Mathf.Sin(age * (8f + speedSm * 0.8f)) * 38f;
            foreach (var (t, sgn) in model.wings)
                if (t) t.localRotation = Quaternion.Euler(0, 0, sgn * flap);
            bool whip = whipT >= 0;
            if (whip)
            {
                whipT += dt;
                if (whipT > 0.5f) whipT = -1;
            }
            for (int i = 0; i < model.tails.Count; i++)
            {
                var (t, rest) = model.tails[i];
                if (!t) continue;
                float sway = whip ? Mathf.Sin(age * 40f + i * 1.7f) * 40f : Mathf.Sin(age * 3f + i * 1.3f) * (8f + move * 10f);
                t.localRotation = rest * Quaternion.Euler(whip ? sway : 0, sway, 0);
            }
            for (int i = 0; i < model.spine.Count; i++)
            {
                var (t, rest) = model.spine[i];
                if (t) t.localPosition = rest + new Vector3(Mathf.Sin(age * 3.2f - i * 0.7f) * 0.06f, Mathf.Sin(age * 2.4f - i * 0.5f) * 0.03f, 0);
            }
        }

        static float EaseOutBack(float k)
        {
            const float c1 = 1.70158f, c3 = c1 + 1;
            return 1 + c3 * Mathf.Pow(k - 1, 3) + c1 * Mathf.Pow(k - 1, 2);
        }

        /// <summary>攻击前冲：沿 dir 冲出 dist 米再收回（dur 秒），带挤压拉伸</summary>
        public void Lunge(Vector3 dir, float dist = 0.35f, float dur = 0.22f)
        {
            lungeDir = dir.sqrMagnitude > 1e-4f ? dir.normalized : transform.forward;
            lungeDist = dist * Mathf.Max(0.6f, Height);
            lungeDur = dur;
            lungeT = 0;
        }

        /// <summary>尾巴连抽（狰、讙）</summary>
        public void WhipTails() => whipT = 0;

        // ───────────── 攻击工具 ─────────────
        public Vector3 Center => visual ? visual.position + Vector3.up * Height * 0.5f : transform.position + Vector3.up * 0.5f;
        /// <summary>出手点：头部前方</summary>
        public Vector3 Mouth => visual ? visual.position + transform.forward * model.size * 0.35f + Vector3.up * Height * 0.7f : Center;
        public static Vector3 CenterOf(Damageable d) => ReactionSystem.CenterOf(d);
        /// <summary>到目标碰撞体表面的距离（大个子敌人近战也够得着）</summary>
        public float DistTo(Damageable d)
        {
            if (!d) return float.MaxValue;
            var c = Center;
            var col = d.GetComponent<Collider>();
            return Vector3.Distance(c, col && col.enabled ? col.ClosestPoint(c) : CenterOf(d));
        }

        /// <summary>目标的水平半径（站位、冲刺落点留出身位）</summary>
        public static float RadiusOf(Damageable d)
        {
            var col = d ? d.GetComponent<Collider>() : null;
            return col && col.enabled ? Mathf.Min(col.bounds.extents.x, col.bounds.extents.z) : 0.4f;
        }
        public bool Sees(Damageable d) => d && !Combat.Blocked(Mouth, CenterOf(d), d.GetComponent<Collider>());

        /// <summary>灵宠伤害请求：数值 × 灵契倍率，来源 Pet，instigator = 本体</summary>
        public DamageInfo Info(float amount, Element element, float statusChance, Vector3 point, Vector3 dir, int depth = 0)
        {
            var info = DamageInfo.Simple(amount * DamageMult, DamageSource.Pet, point, dir);
            info.element = element;
            info.statusChance = statusChance;
            info.depth = depth;
            info.instigator = this;
            return info;
        }

        public DamageResult Hit(Damageable target, float amount, Element element = Element.None, float statusChance = 0, float knockback = 0,
            bool forceCrit = false, Vector3? from = null, int depth = 0)
        {
            if (!target || target.Dead) return default;
            var c = CenterOf(target);
            var o = from ?? Center;
            var info = Info(amount, element, statusChance, c, (c - o).normalized, depth);
            info.knockback = knockback;
            info.forceCrit = forceCrit;
            return Combat.DamageEnemy(target, info);
        }

        /// <summary>范围伤害：墙后不受伤，中心 100% → 边缘 edge</summary>
        public void AoE(Vector3 center, float radius, float amount, Element element = Element.None, float statusChance = 0, float edge = 0.5f,
            List<Damageable> hits = null)
        {
            Combat.Explode(center, radius, Info(amount, element, statusChance, center, Vector3.up), true, 0, null, edge, hits);
        }

        /// <summary>center 周围 radius 内活着、可选中的敌人（按距离排序）</summary>
        public static List<Damageable> EnemiesNear(Vector3 center, float radius, bool skipSummons = true)
        {
            var list = ReactionSystem.Nearest(center, radius, 64, null, false);
            if (skipSummons) list.RemoveAll(d => d.noReward);
            return list;
        }

        /// <summary>玩家准星指着的敌人（range 内，被地形挡住就没有）</summary>
        public Damageable AimedEnemy(float range)
        {
            var eye = Owner.Eye;
            if (!eye) return null;
            var hits = Physics.RaycastAll(eye.position, eye.forward, range, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            foreach (var h in hits)
            {
                if (h.collider.GetComponentInParent<PlayerVitals>()) continue;
                var hb = h.collider.GetComponent<Hitbox>();
                var d = hb ? hb.owner : h.collider.GetComponentInParent<Damageable>();
                if (!d) return null; // 先打到地形
                if (d.Dead || d.untargetable) continue;
                return d;
            }
            return null;
        }

        /// <summary>准星落点（打到地形 / 敌人，否则 range 米外）</summary>
        public Vector3 AimPoint(float range)
        {
            var eye = Owner.Eye;
            if (!eye) return transform.position;
            foreach (var h in SortedHits(eye.position, eye.forward, range))
                if (!h.collider.GetComponentInParent<PlayerVitals>()) return h.point;
            return eye.position + eye.forward * range;
        }

        static RaycastHit[] SortedHits(Vector3 from, Vector3 dir, float range)
        {
            var hits = Physics.RaycastAll(from, dir, range, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            return hits;
        }

        /// <summary>头顶浮字（灵契升级、学舌、怒吼）</summary>
        public void Say(string text, Color c, float scale = 1.1f) =>
            Hud.Instance?.FloatText(transform.position + Vector3.up * (Height + def.hover + 0.45f), text, c, scale);

        public static float GroundY(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var hit, 40f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;

        public static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
    }
}
