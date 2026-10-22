using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏的行为（<see cref="KunPengDef"/>；首领框架 <see cref="BossBrain"/> 的子类，招式在 KunPeng/Moves/）。在框架之上加五层：
    ///   · 冰窟（<see cref="IceHoleInfo"/>）：场景里的 <see cref="IceHole"/> 标记（2-4），没有就按场地建一个虚拟冰窟（水面片 + 遮罩），首领倒下 / 回收时一起收掉。
    ///   · 不走导航：鲲的逻辑位置钉在冰窟里（方位 <see cref="Theta"/>、离圆心 <see cref="KunRing"/>，y = 环台地面），鹏在空中按速度积分
    ///     （水平按 <see cref="Accel"/> 追期望速度，竖直按目标高度 <see cref="HoverAlt"/>，飞越冰窟时不低于 11.5 m）；生成器挂的 NavMeshAgent 生成后停用。
    ///   · 运行时姿态层（模型根节点，LateUpdate 在动画之后写）：
    ///       鲲：沉浮 <see cref="Sunk"/>（0 = 露出水面，1 = 完全沉下去 13 m）。E5 的采样片段把 Three.js「鲲绕水线俯仰升降」的宿主运动烘进了根骨骼——
    ///         以完全沉下去的位置为参照（根骨骼抬高 10 个模型单位 = 13 m），所以正式模型的根节点放在水下 14 m、只叠加沉浮；
    ///         代理 / 占位体（片段里没有这段抬升，按根骨骼实测判断）按状态表做俯仰 / 抬身，并按 <see cref="KunPengMath.CutCeiling"/> 把切口压在水面下 0.3 m。
    ///         <see cref="CutTop"/> 是平切口一圈最高点离水面多高（测试用，正常 ≤ −0.2）。角色胶囊跟着沉浮往下挪。
    ///       鹏：转换时从雾里升起（<see cref="RiseOffset"/>）。
    ///     水面以下由冰窟的不透明遮罩挡住（水面遮罩切口，<see cref="IceHole"/>）；模型的蒙皮包围盒每帧重算、动画不因离屏停更（根节点在水下 14 m，包围盒不能留在那里）。
    ///   · 鲛珠：两个形态的弱点都是额头的 pearl 骨骼，平时微光，猛砸趴台 / 落台歇翼 / 撞柱硬直时大亮（<see cref="PearlBright"/>，发光通道 0）。
    ///   · 特效（<see cref="KunPengFx"/>）：水面翻涌、吞吸气流、狂风风痕、冰雾爆闪。
    /// 动作：<see cref="Act"/> 优先走 act_&lt;状态&gt; 触发器（先按片段时长设 ActScale），没有就按状态名交叉淡入；出手时刻由招式的 Cue 跟动画事件走。
    /// 换形：框架在转换演出的 1.55 s 换模型，这里 <see cref="EnemyBody.Rebind"/> 把受伤体的 Animator / CreatureRig / 着色渲染器换到鹏的模型上
    /// （EnemyBody 在 Awake 时只缓存了当时激活的那份模型）。
    /// </summary>
    public class KunPengBrain : BossBrain
    {
        static readonly int ActScaleId = Animator.StringToHash("ActScale");

        public KunPengDef KDef => Def as KunPengDef;
        public IceHoleInfo Hole { get; private set; }
        /// <summary>冰窟标记（场景里的，或自己建的虚拟冰窟）</summary>
        public IceHole HoleMarker { get; private set; }
        public KunPengFx HoleFx { get; private set; }

        public bool IsKun => Form != null && Form.id == KunPengDef.KunForm;
        public bool IsPeng => Form != null && Form.id == KunPengDef.PengForm;

        // ───────────── 鲲 ─────────────

        /// <summary>鲲在冰窟的哪个方位（相对圆心的 yaw，度）</summary>
        public float Theta { get; set; }
        /// <summary>0 = 露出水面，1 = 完全沉没（视觉）</summary>
        public float Sunk { get; set; } = 1f;
        /// <summary>沉在水下：不可选中（潜袭）</summary>
        public bool Submerged { get; set; }
        /// <summary>75% 以下：猛砸连掀两道冰浪、吐冰多一块、喘息 × 0.8</summary>
        public bool KunFury { get; private set; }
        /// <summary>鲲身体中心所在的圈（冰窟半径 − 4.6）</summary>
        public float KunRing => Mathf.Max(1f, Hole.radius - (KDef != null ? KDef.kunInset : 4.6f));
        /// <summary>平切口一圈最高点离水面多高（米；露出水面时 &gt; 0）</summary>
        public float CutTop { get; private set; } = float.NegativeInfinity;
        /// <summary>当前模型的片段里烘了「绕水线升降」的宿主运动（正式美术的鲲）</summary>
        public bool BakedHost { get; private set; }

        // ───────────── 鹏 ─────────────

        /// <summary>目标高度（离环台地面）</summary>
        public float HoverAlt { get; set; }
        /// <summary>水平加速度（米/秒²）</summary>
        public float Accel { get; set; } = 22f;
        public Vector3 FlyVelocity => flyVel;
        /// <summary>上次落台歇翼之后出过几招（≥ 2 才会落台）</summary>
        public int MovesSincePerch { get; set; }
        /// <summary>转换演出里鹏从雾里升起的偏移（米，负 = 在下面）</summary>
        public float RiseOffset { get; set; }
        /// <summary>落台歇翼中（站在环台上，不做悬浮起伏）</summary>
        public bool Perched { get; set; }
        /// <summary>俯冲贴地中（不做悬浮起伏）</summary>
        public bool Diving { get; set; }

        // ───────────── 鲛珠 / 动作 / 统计 ─────────────

        public bool PearlBright { get; set; }
        public float PearlGlow { get; private set; } = 0.3f;
        public string LastAct { get; private set; }
        public string LastActPath { get; private set; }
        public int ActsFired { get; private set; }
        /// <summary>首次提示过的事（吞吸 / 狂风 / 落台…，每场一次）</summary>
        readonly HashSet<string> told = new();

        Vector3 flyVel, desiredVel;
        bool hasDesired, rigged, fogTold;
        float orbit, orbitDir = 1, orbitTimer = 6f, transPrev = -1f, pitchNow, riseNow, rollNow;
        readonly Dictionary<BossModel, ModelInfo> modelInfo = new();
        readonly Dictionary<RuntimeAnimatorController, (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale)> animInfo = new();
        CapsuleCollider capsuleCol;
        RunRng rng;

        sealed class ModelInfo
        {
            public Transform rootBone;
            public Vector3[] cutLocal;
            public Vector3 capsuleBase;
            public bool baked;
        }

        static readonly RaycastHit[] hitBuf = new RaycastHit[16];

        // ───────────── 生成 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            if (Def == null) return;
            SetupRuntimeLayer();
        }

        void SetupRuntimeLayer()
        {
            var d = KDef;
            rng = RunState.Current != null ? RunState.Current.Stream("boss_kunpeng_brain") : new RunRng(Environment.TickCount);
            // 不走导航：鲲在冰窟里、鹏在空中，逻辑位置都由这里写
            if (agent) agent.enabled = false;
            capsuleCol = GetComponent<CapsuleCollider>();
            Hole = IceHole.Resolve(Arena, transform.position, out var marker);
            HoleMarker = marker;
            if (!marker) HoleMarker = IceHole.CreateVirtual(Hole, transform.parent);
            var fxGo = new GameObject("KunPeng Fx");
            fxGo.transform.SetParent(transform.parent, false);
            HoleFx = fxGo.AddComponent<KunPengFx>();
            HoleFx.Bind(this, HoleMarker, !marker);

            float dist = Hole.Distance(transform.position);
            Theta = dist > 0.5f ? Hole.Angle(transform.position) : 0;
            Sunk = 1f;
            PlaceKun();
            SetFacing(Theta);
            HoverAlt = d != null ? d.pengHover : 13.5f;
            Accel = d != null ? d.pengAccel : 22f;
            orbit = Theta;
            if (models != null)
                foreach (var m in models)
                    PrepareModel(m);
            MoveEnded -= OnOwnMoveEnded;
            MoveEnded += OnOwnMoveEnded;
            rigged = true;
            HoleFx.SetAgitation(1f);
        }

        void OnOwnMoveEnded(BossBrain b, BossMove m) => ClearActTriggers();

        /// <summary>
        /// 每份模型：脚步 IK 关掉（鲲没有腿、鹏在空中），动画不因离屏停更、蒙皮包围盒每帧重算（鲲的根节点在水下 14 m），
        /// 记下根骨骼与平切口一圈在根骨骼里的位置（静止姿势，还没播动画），以及角色胶囊的原始中心
        /// </summary>
        void PrepareModel(BossModel m)
        {
            if (m == null || !m.root || modelInfo.ContainsKey(m)) return;
            var info = new ModelInfo { capsuleBase = m.capsuleCenter };
            if (m.rig) m.rig.feetIK = false;
            if (m.animator) m.animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            foreach (var smr in m.root.GetComponentsInChildren<SkinnedMeshRenderer>(true)) smr.updateWhenOffscreen = true;
            foreach (var t in m.root.GetComponentsInChildren<Transform>(true))
                if (t.name == "root")
                {
                    info.rootBone = t;
                    break;
                }
            var basis = info.rootBone ? info.rootBone : m.root.transform;
            var mr = m.root.transform;
            info.cutLocal = new Vector3[KunPengMath.CutRim.Length];
            for (int i = 0; i < KunPengMath.CutRim.Length; i++)
            {
                var q = KunPengMath.CutRim[i];
                info.cutLocal[i] = basis.InverseTransformPoint(mr.TransformPoint(new Vector3(q.x, 0, q.y)));
            }
            modelInfo[m] = info;
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Def == null || !rigged || Dead) return;
            float dt = Time.deltaTime;
            if (IsKun) StepKun(dt);
            else StepPeng(dt);
            float want = PearlBright || Staggered ? 1f : 0.3f;
            PearlGlow += (want - PearlGlow) * Mathf.Min(1f, dt * 4f);
            Glow(0, PearlGlow);
        }

        /// <summary>鲲：逻辑位置钉在冰窟里；不在潜袭 / 转换 / 登场里时慢慢浮出水面（Three.js sunk −= dt × 2）</summary>
        void StepKun(float dt)
        {
            if (IntroDone && !Transitioning && !(Current is KunDive)) Sunk = Mathf.Max(0, Sunk - dt * 2f);
            PlaceKun();
        }

        /// <summary>鹏：水平按加速度追期望速度（这一帧没人给就悬停），竖直追目标高度（招式间隙飞越冰窟时不低于 11.5 m，盘旋时上下起伏 0.5 m）</summary>
        void StepPeng(float dt)
        {
            var d = KDef;
            var want = hasDesired ? desiredVel : Vector3.zero;
            hasDesired = false;
            want.y = 0;
            var flat = new Vector3(flyVel.x, 0, flyVel.z);
            flat = Vector3.MoveTowards(flat, want, Mathf.Max(1f, Accel) * dt);
            float floor = Hole.FloorY;
            float alt = Current != null || Transitioning || Staggered ? HoverAlt : OverHoleAlt(HoverAlt);
            bool low = Perched || Diving || Staggered || alt <= 0.7f;
            float bob = low ? 0 : Mathf.Sin(age * 1.3f) * 0.5f;
            float targetY = floor + alt + bob;
            float climb = moveSpeed * (d != null ? d.pengClimb : 1.5f);
            float vy = Mathf.Clamp((targetY - transform.position.y) * 3f, -climb, climb);
            flyVel = new Vector3(flat.x, Mathf.MoveTowards(flyVel.y, vy, 40f * dt), flat.z);
            var p = transform.position + flyVel * dt;
            // 不钻地：脚下（双爪）不低于地面
            float ground = GroundBelow(p);
            if (p.y < ground)
            {
                p.y = ground;
                if (flyVel.y < 0) flyVel.y = 0;
            }
            if (Arena && !Arena.Contains(p, -2f)) p = Arena.Clamp(p, -2f);
            if (float.IsFinite(p.x) && float.IsFinite(p.y) && float.IsFinite(p.z)) transform.position = p;
            else flyVel = Vector3.zero;
        }

        /// <summary>
        /// 姿态层：动画之后写模型根节点（鲲的沉浮 / 代理体的俯仰抬身、鹏的升起），角色胶囊跟着挪；顺带量平切口离水面多高
        /// </summary>
        void LateUpdate()
        {
            if (Def == null || !rigged || Dead || Model == null || !Model.root) return;
            if (!modelInfo.TryGetValue(Model, out var info))
            {
                PrepareModel(Model);
                if (!modelInfo.TryGetValue(Model, out info)) return;
            }
            var mr = Model.root.transform;
            float s = Mathf.Max(0.01f, Model.scale);
            float dt = Time.deltaTime;
            if (IsKun)
            {
                // 片段里有没有烘进「绕水线升降」：根骨骼离模型原点 4 个模型单位以上就算（正式鲲约 10）
                if (!info.baked && info.rootBone && mr.InverseTransformPoint(info.rootBone.position).y > 4f) info.baked = true;
                BakedHost = info.baked;
                float waterRel = Hole.waterY - transform.position.y;
                float drop = (KunPengDef.KunSunkY - KunPengDef.KunBaseY) * Sunk;
                float y;
                if (info.baked)
                {
                    // 片段以完全沉下去的位置为参照：根节点放在 KunSunkY，片段把它抬到 KunBaseY（± 俯仰抬身），这里只叠加沉浮；水面高低按 Three.js 的 +0.06 换算
                    y = KunPengDef.KunSunkY + drop + (waterRel - KunPengDef.TsWaterLevel);
                    mr.localRotation = Quaternion.identity;
                }
                else
                {
                    ProcKunPose(dt);
                    float ceiling = waterRel + KunPengMath.CutCeiling(pitchNow, rollNow, s);
                    y = Mathf.Min(KunPengDef.KunBaseY + riseNow + drop, ceiling + drop);
                    mr.localRotation = Quaternion.Euler(pitchNow * Mathf.Rad2Deg, 0, rollNow * Mathf.Rad2Deg);
                }
                mr.localPosition = new Vector3(0, y / s, 0);
                if (capsuleCol)
                {
                    // 胶囊只包躯干，额头的鲛珠在弱点窗口里（见 KunPengDef.kunBodyRadius）；跟着沉浮往下挪
                    capsuleCol.center = info.capsuleBase + Vector3.up * (drop / s);
                    capsuleCol.radius = (KDef != null ? KDef.kunBodyRadius : 1.8f) / s;
                }
                // 平切口一圈最高点（相对水面）
                var basis = info.rootBone ? info.rootBone : mr;
                float top = float.NegativeInfinity;
                foreach (var q in info.cutLocal) top = Mathf.Max(top, basis.TransformPoint(q).y);
                CutTop = top - Hole.waterY;
            }
            else
            {
                mr.localPosition = new Vector3(0, RiseOffset / s, 0);
                // 鹏的片段只烘了俯仰（根骨骼的旋转），静止姿势的根骨骼本来就带着轴向换算，量不出来：正式美术就算烘过
                info.baked = Model.source == BossModelSource.Art;
                BakedHost = info.baked;
                if (!info.baked) mr.localRotation = Quaternion.Euler(ProcPengPitch() * Mathf.Rad2Deg, 0, 0);
                else mr.localRotation = Quaternion.identity;
                if (capsuleCol) capsuleCol.center = info.capsuleBase + Vector3.up * (RiseOffset / s);
            }
        }

        /// <summary>
        /// 代理 / 占位体的鲲（片段里没有宿主运动）：按当前动作的状态表做俯仰 / 抬身（Three.js animateKun 的 pitch / rise），按 lam 阻尼过渡
        /// </summary>
        void ProcKunPose(float dt)
        {
            float pitch = 0, rise = 0, lam = 6;
            switch (LastAct)
            {
                case "inhale": pitch = -0.12f; lam = 5; break;
                case "slamWind": pitch = -0.25f; rise = 1.6f; lam = 4; break;
                case "spit": pitch = 0.12f; lam = 9; break;
                case "roar":
                case "rise": pitch = -0.08f; break;
                case "erupt": rise = 1.2f; lam = 8; break;
            }
            if (Current is KunSlam slam && slam.Stage == MoveStage.Active)
            {
                pitch = 0.42f;
                rise = -0.6f;
                lam = 20;
            }
            else if (Current is KunInhale inh && inh.Stage == MoveStage.Recover)
            {
                pitch = 0.35f;
                rise = -0.4f;
                lam = 16;
            }
            float k = 1 - Mathf.Exp(-lam * dt);
            pitchNow = Mathf.Lerp(pitchNow, pitch + Mathf.Sin(age * 0.7f) * 0.02f, k);
            riseNow = Mathf.Lerp(riseNow, rise, k);
            rollNow = Mathf.Sin(age * 0.45f) * 0.03f;
        }

        /// <summary>代理 / 占位体的鹏：飞行时前倾、俯冲压低、歇翼直立（Three.js animatePeng 的 pitch）</summary>
        float ProcPengPitch()
        {
            float pitch = Diving ? 0.85f : Perched ? 0 : Staggered ? 0.5f : LastAct == "swoopReady" ? 0.45f : 0.3f;
            pitchNow = Mathf.Lerp(pitchNow, pitch, 1 - Mathf.Exp(-6f * Time.deltaTime));
            return pitchNow;
        }

        // ───────────── 鲲：位置 / 朝向 ─────────────

        /// <summary>把鲲钉在冰窟里当前方位（离圆心 KunRing，y = 环台地面）</summary>
        public void PlaceKun()
        {
            var p = Hole.Point(Theta, KunRing);
            transform.position = new Vector3(p.x, Hole.FloorY, p.z);
        }

        public float Facing => transform.eulerAngles.y;
        public void SetFacing(float yawDeg) => transform.rotation = Quaternion.Euler(0, yawDeg, 0);

        /// <summary>首领 → 目标的 yaw（度）</summary>
        public float YawToPlayer
        {
            get
            {
                var d = PlayerPosition - transform.position;
                d.y = 0;
                return d.sqrMagnitude > 1e-4f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : Facing;
            }
        }

        /// <summary>目标在冰窟的哪个方位（度）</summary>
        public float PlayerAngle => Hole.Angle(PlayerPosition);

        /// <summary>转向目标，但不超出冰窟外法线两侧 51.6°（鲲不会背对冰沿；Three.js aimKunAtPlayer）；k = 偏转比例</summary>
        public void AimKunAtPlayer(float k)
        {
            float lim = KDef != null ? KDef.kunAimLimit : 51.57f;
            float want = Mathf.Clamp(Mathf.DeltaAngle(Theta, YawToPlayer), -lim, lim);
            SetFacing(Theta + want * k);
        }

        /// <summary>按角速度把头转向目标（同样夹在外法线两侧）</summary>
        public void TurnKunToward(float degPerSec, float dt)
        {
            float lim = KDef != null ? KDef.kunAimLimit : 51.57f;
            float want = Theta + Mathf.Clamp(Mathf.DeltaAngle(Theta, YawToPlayer), -lim, lim);
            SetFacing(Mathf.MoveTowardsAngle(Facing, want, degPerSec * dt));
        }

        /// <summary>口部投影到地面（吞吸气流的终点；Three.js computeMouth：往前 3.4 × 体型，高 4.2）</summary>
        public Vector3 MouthPoint => transform.position + KunPengMath.Dir(Facing) * (3.4f * KunPengDef.KunScale) + Vector3.up * 4.2f;

        /// <summary>吞吸收尾那一口咬在冰沿上的位置（Three.js biteSpot：往前 kunInset + 1.6）</summary>
        public Vector3 BiteSpot
        {
            get
            {
                var p = transform.position + KunPengMath.Dir(Facing) * ((KDef != null ? KDef.kunInset : 4.6f) + 1.6f);
                p.y = Hole.FloorY;
                return p;
            }
        }

        /// <summary>嘴 / 喙（吐冰的出手点）：头骨往前一点，没有骨骼时身体中心往上</summary>
        public Vector3 Muzzle
        {
            get
            {
                var head = Model?.FindBone("head");
                if (head) return head.position + KunPengMath.Dir(Facing) * 1.2f;
                return BodyCenter + Vector3.up * 2f + KunPengMath.Dir(Facing) * BodyRadius;
            }
        }

        // ───────────── 鹏：飞行 ─────────────

        /// <summary>这一帧想往 target 飞（水平，speed 米/秒，arrive 米内减速）；返回是否已到</summary>
        public bool FlyTo(Vector3 target, float speed, float arrive)
        {
            var d = target - transform.position;
            d.y = 0;
            float dist = d.magnitude;
            if (dist < 1e-3f)
            {
                Hover();
                return true;
            }
            float v = speed * Mathf.Clamp01(dist / Mathf.Max(0.5f, arrive * 2f));
            desiredVel = d / dist * Mathf.Max(v, Mathf.Min(speed, 2f));
            hasDesired = true;
            return dist <= arrive;
        }

        /// <summary>这一帧按给定的水平速度飞（俯冲）</summary>
        public void FlyVelocityTo(Vector3 v)
        {
            v.y = 0;
            desiredVel = v;
            hasDesired = true;
        }

        public void Hover()
        {
            desiredVel = Vector3.zero;
            hasDesired = true;
        }

        /// <summary>立刻改速度（俯冲开始时先往下压、落台时收住冲过头的速度）</summary>
        public void SetFlyVelocity(Vector3 v) => flyVel = v;

        /// <summary>飞越冰窟上空时至少多高（Three.js overHoleAlt）</summary>
        public float OverHoleAlt(float alt)
        {
            float over = KDef != null ? KDef.pengOverHole : 11.5f;
            return Hole.found && Hole.Distance(transform.position) < Hole.radius + BodyRadius + 1f ? Mathf.Max(alt, over) : alt;
        }

        /// <summary>某点正下方的地面（射线打世界层，打不到时环台地面）</summary>
        public float GroundBelow(Vector3 p)
        {
            float from = Mathf.Max(p.y, Hole.FloorY) + 3f;
            int n = Physics.RaycastNonAlloc(new Vector3(p.x, from, p.z), Vector3.down, hitBuf, from - Hole.FloorY + 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            float best = float.NegativeInfinity;
            for (int i = 0; i < n; i++)
            {
                var h = hitBuf[i];
                if (!h.collider || h.collider.transform.IsChildOf(transform)) continue;
                if (h.point.y > best) best = h.point.y;
            }
            return float.IsFinite(best) ? best : (Hole.OverHole(p) ? float.NegativeInfinity : Hole.FloorY);
        }

        /// <summary>
        /// 鹏脚下（整个碰撞方块范围内）最高的地面：平地 = 环台地面，压到祭台 / 冰柱时 = 台顶（Three.js groundUnder，脚印半径 = 身体半径 × 0.85）
        /// </summary>
        public float GroundUnder(Vector3 p, float footprint = -1)
        {
            float r = footprint > 0 ? footprint : BodyRadius * 0.85f;
            float best = Hole.FloorY;
            for (int i = 0; i < 9; i++)
            {
                var q = i == 0 ? p : p + KunPengMath.Dir(i * 45f) * r;
                q.y = Hole.FloorY + 8f;
                float g = GroundBelow(q);
                if (float.IsFinite(g) && g < Hole.FloorY + 8f) best = Mathf.Max(best, g);
            }
            return best;
        }

        // ───────────── 掩体判定 ─────────────

        /// <summary>
        /// 从 a 到 b 被地形 / 建筑挡住（冰柱、矮墙、祭台）：忽略冰窟边缘段（气流和狂风是越过冰沿吹出来的）、首领自己、角色层
        /// </summary>
        public bool CoverBlocks(Vector3 a, Vector3 b)
        {
            var d = b - a;
            float len = d.magnitude;
            if (len < 0.05f) return false;
            int n = Physics.RaycastNonAlloc(a, d / len, hitBuf, len, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
            {
                var c = hitBuf[i].collider;
                if (!c || c.transform.IsChildOf(transform)) continue;
                if (HoleMarker && HoleMarker.IsRim(c)) continue;
                return true;
            }
            return false;
        }

        /// <summary>玩家的移动组件（推拉用）</summary>
        public PlayerMotor Motor
        {
            get
            {
                var pv = PlayerVitals.Instance;
                return pv && !pv.Dead ? pv.GetComponent<PlayerMotor>() : null;
            }
        }

        /// <summary>每场第一次的提示（同一件事只说一次）</summary>
        public void TellOnce(string key, string text, Color color)
        {
            if (string.IsNullOrEmpty(key) || !told.Add(key)) return;
            GameUI.Toast(text, color, 3.2f);
        }

        public bool Told(string key) => told.Contains(key);

        /// <summary>方向 / 落点的随机流（本局有种子时可复现）</summary>
        public RunRng Rng => rng ??= new RunRng(Environment.TickCount);

        // ───────────── 动作 ─────────────

        /// <summary>
        /// 播一个动作并拉伸到 seconds 秒播完：Animator 有 act_&lt;状态&gt; 触发器（E5 的 AC_SK_Boss_Kun / AC_SK_Boss_Peng）就先按片段时长设 ActScale、再触发；
        /// 没有（代理 / 占位体、没有触发器的接续段）就按状态名交叉淡入（框架的 PlayAct，缺状态只警告一次）
        /// </summary>
        public void Act(string state, float seconds)
        {
            if (string.IsNullOrEmpty(state)) return;
            LastAct = state;
            ActsFired++;
            if (anim && anim.isActiveAndEnabled && anim.runtimeAnimatorController)
            {
                var info = AnimInfo(anim);
                string trigger = "act_" + state;
                if (info.triggers.Contains(trigger))
                {
                    if (info.actScale)
                    {
                        float len = info.clips.TryGetValue(state, out var l) ? l : 0;
                        anim.SetFloat(ActScaleId, len > 0 && seconds > 0.05f ? Mathf.Clamp(len / seconds, 0.4f, 2.5f) : 1f);
                    }
                    foreach (var t in info.triggers)
                        if (t != trigger)
                            anim.ResetTrigger(t);
                    anim.SetTrigger(trigger);
                    LastActPath = "trigger";
                    return;
                }
            }
            LastActPath = "crossfade";
            PlayAct(state, seconds);
        }

        (HashSet<string> triggers, Dictionary<string, float> clips, bool actScale) AnimInfo(Animator a)
        {
            var ctrl = a.runtimeAnimatorController;
            if (animInfo.TryGetValue(ctrl, out var info)) return info;
            var triggers = new HashSet<string>();
            bool actScale = false;
            foreach (var p in a.parameters)
            {
                if (p.type == AnimatorControllerParameterType.Trigger && p.name.StartsWith("act_", StringComparison.Ordinal)) triggers.Add(p.name);
                if (p.nameHash == ActScaleId) actScale = true;
            }
            var clips = new Dictionary<string, float>();
            foreach (var c in ctrl.animationClips)
            {
                if (!c) continue;
                int us = c.name.LastIndexOf('_');
                clips[us >= 0 ? c.name.Substring(us + 1) : c.name] = c.length;
            }
            info = (triggers, clips, actScale);
            animInfo[ctrl] = info;
            return info;
        }

        /// <summary>
        /// 正式模型的采样片段自带音效事件（events.json 叠加表里的 sfx:…，由框架在动画事件里播）：这时招式里同一个音效不再手动播，免得响两遍。
        /// 代理 / 占位体 / Animator 关掉时没有这些事件，招式照常手动播
        /// </summary>
        public bool ClipsDriveSfx => anim && anim.isActiveAndEnabled && anim.runtimeAnimatorController && Model != null && Model.source == BossModelSource.Art;

        /// <summary>收招 / 被打断后清掉没被消费的触发器</summary>
        void ClearActTriggers()
        {
            if (!anim || !anim.isActiveAndEnabled || !anim.runtimeAnimatorController) return;
            foreach (var t in AnimInfo(anim).triggers) anim.ResetTrigger(t);
        }

        // ───────────── 框架钩子 ─────────────

        protected override bool UsesNavMesh => false;

        protected override bool ExtraUntargetable => Submerged;

        protected override void IntroTick(float t, float dt)
        {
            // 鲲从冰窟里升起：水面翻涌、冰沿炸起冰屑，升到一半时吼叫（Three.js entrance）
            Sunk = 1 - KunPengMath.EaseOutCubic(KunPengMath.Span(t, 0.1f, 0.8f));
            AimKunAtPlayer(0.5f);
            if (t < 0.8f && Rng.Value < dt / 0.08f)
            {
                var p = Hole.Point(Theta + Rng.Range(-23f, 23f), KunRing + Rng.Value * 3f);
                p.y = Hole.waterY + 0.3f;
                Fx.Burst(p, KunPengDef.Ice, 6, 6f, 0.7f, 0.35f, 10f);
            }
            if (t >= 0.72f && !told.Contains("intro_roar"))
            {
                told.Add("intro_roar");
                Act("roar", 2.4f);
                if (!ClipsDriveSfx) PlaySfx("boss_roar", 1f, 0.75f);
                var ring = Hole.Point(Theta, Hole.radius + 1f);
                Fx.Ring(new Vector3(ring.x, Hole.FloorY + 0.1f, ring.z), 12f, KunPengDef.Warn, 1f);
                Shake(0.6f, 1f);
            }
        }

        protected override void OnIntroEnd()
        {
            PlayLocomotion();
            HoleFx?.SetAgitation(0.35f);
            // 名字卡已由登场横幅打过，这里补一条弱点提示
            TellOnce("intro", "北冥之鲲——它会从冰窟各处探头，额头的鲛珠是弱点", Hex.Rgb(0x8fe3ff));
        }

        /// <summary>
        /// 招式间隙：鲲在冰窟里慢慢绕到玩家那一侧、转头盯着玩家；鹏绕冰窟盘旋（环台中线上空），隔 5–9 s 掉头
        /// </summary>
        protected override void Idle(float dt)
        {
            var d = KDef;
            if (IsKun)
            {
                Theta = Mathf.MoveTowardsAngle(Theta, PlayerAngle, (d != null ? d.kunCircleRate : 6.875f) * dt);
                PlaceKun();
                TurnKunToward(d != null ? d.kunTurnRate : 68.75f, dt);
                return;
            }
            orbitTimer -= dt;
            if (orbitTimer <= 0)
            {
                orbitDir = -orbitDir;
                var flip = d != null ? d.pengOrbitFlip : new Vector2(5, 9);
                orbitTimer = Rng.Range(flip.x, flip.y);
            }
            orbit += orbitDir * (d != null ? d.pengOrbitRate : 13.75f) * dt;
            FlyTo(Hole.Point(orbit, Hole.MidRing), moveSpeed * 0.95f, 1.5f);
            Face(PlayerPosition, 126f, dt);
            HoverAlt = OverHoleAlt(d != null ? d.pengHover : 13.5f);
        }

        protected override void Passive(float dt)
        {
            // 鹏狂怒（25%）：只在鹏形态（鲲形态的刻度只画在血条上）
            if (IsPeng && !Enraged && PhaseFraction <= KunPengDef.RageAt) Enrage("health");
            if (HoleFx)
            {
                bool churn = IsKun && (Current is KunInhale || Current is KunDive);
                HoleFx.SetAgitation(IsKun ? (churn ? 1f : 0.35f) : 0.25f);
            }
        }

        public override void OnMark(string markId)
        {
            if (markId != KunPengDef.FuryMark || KunFury) return;
            KunFury = true;
            // 鲲怒：喘息 × 0.8（Three.js restFactor），猛砸连掀两道冰浪、吐冰多一块（招式里读 KunFury）
            foreach (var m in Moves)
                if (m.forms != null && Array.IndexOf(m.forms, KunPengDef.KunForm) >= 0)
                    m.recovery *= 0.8f;
            if (IsKun) TellOnce("fury", "鲲怒了——猛砸会连掀两道冰浪", Hex.Rgb(0x8fe3ff));
        }

        protected override void OnPhase(int phase)
        {
            transPrev = -1f;
            Submerged = false;
            ClearActTriggers();
            HoleFx?.Suction(false);
            HoleFx?.Gust(false);
            HoleFx?.SetAgitation(1f);
        }

        /// <summary>
        /// 化鹏（Three.js transitionTick）：鲲边吼边沉（0.6–1.4 s）→ 1.3 s 冰海炸开（整圈冰浪 + 冰屑冲天）→ 冰雾 1.2–1.55 s 涌满、保持到 2.6 s、4.0 s 散尽，
        /// 框架在最浓的 1.55 s 换模型 → 鹏从雾里升起（1.55–4.0 s），3.6 s 一声长啸
        /// </summary>
        protected override void TransitionTick(float t, float dt)
        {
            float was = transPrev;
            transPrev = t;
            bool Crossed(float x) => was < x && t >= x;
            var c = Hole.center;
            if (IsKun)
            {
                PlaceKun();
                AimKunAtPlayer(0.6f);
                Sunk = KunPengMath.Span(t, 0.6f, 1.4f);
            }
            if (Crossed(1.3f))
            {
                var at = c + Vector3.up * 1.5f;
                Fx.Explosion(at, Mathf.Max(6f, Hole.radius * 0.6f), KunPengDef.Ice);
                Fx.Burst(at, KunPengDef.Ice, 60, 16f, 1.4f, 0.6f, 12f);
                Fx.Burst(c + Vector3.up * 4f, Color.white, 40, 10f, 1.6f, 0.8f, -2f);
                CameraShake.Quake(c, 0.85f, 90f, 1f);
                BossHazards.For(this).Wave(new BossWaveSpec(new Vector3(c.x, Hole.FloorY, c.z), 16f, Hole.outer + 2f, MoveDamage(10f / Mathf.Max(1f, Def.damage)), KunPengDef.Warn)
                {
                    startRadius = Hole.radius, width = 1.2f, height = 1f, knockback = 8f, dust = true, dustColor = KunPengDef.Ice,
                });
                GameAudio.PlayAt("explosion", c, 1f, 0.55f);
                GameAudio.PlayAt("shield_break", c, 1f, 0.5f);
            }
            float fog = t < 1.2f ? 0 : t < 1.55f ? (t - 1.2f) / 0.35f : t < 2.6f ? 1 : Mathf.Max(0, 1 - (t - 2.6f) / 1.4f);
            HoleFx?.Flash(fog);
            if (IsPeng)
            {
                RiseOffset = -14f * (1 - KunPengMath.EaseOutCubic(KunPengMath.Span(t, KunPengDef.TransitionSwap, 4f)));
                Face(PlayerPosition, 86f, dt);
                HoverAlt = (KDef != null ? KDef.pengOverHole : 11.5f) + 1f;
            }
            if (Crossed(3.6f))
            {
                PlaySfx("boss_roar", 1f, 1.45f);
                Shake(0.4f, 0.8f);
                Fx.Burst(BodyCenter, KunPengDef.Ice, 30, 10f, 1f, 0.4f, 0f);
            }
        }

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            RiseOffset = 0;
            HoleFx?.Flash(0);
            if (IsPeng) HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
        }

        /// <summary>
        /// 换了形态（框架已换好模型、弱点、命中区）：受伤体的 Animator / CreatureRig / 着色渲染器重新绑到新模型（<see cref="EnemyBody.Rebind"/>），
        /// 鹏落在冰窟正上方 12.5 m、从水下 14 m 升起；护盾重凝、第一招狂风由形态定义给
        /// </summary>
        protected override void OnFormChanged(BossFormDef previous, BossFormDef next)
        {
            if (Model != null && Model.root) body.Rebind(Model.root);
            PrepareModel(Model);
            Diving = Perched = false;
            if (next != null && next.id == KunPengDef.PengForm)
            {
                var d = KDef;
                Sunk = 1f;
                float alt = (d != null ? d.pengOverHole : 11.5f) + 1f;
                transform.position = new Vector3(Hole.center.x, Hole.FloorY + alt, Hole.center.z);
                flyVel = Vector3.zero;
                HoverAlt = alt;
                RiseOffset = -14f;
                orbit = PlayerAngle + 180f;
                Accel = d != null ? d.pengAccel : 22f;
                float left = Def != null && Def.phases.Count > 0 ? Mathf.Max(0.5f, Def.phases[0].seconds - KunPengDef.TransitionSwap) : 3f;
                Act("roar", left);
                HoleFx?.SetAgitation(0.5f);
                TellOnce("peng", "北冥之鲲化而为鹏——它累了会落到环台上歇翼，额头的鲛珠仍是弱点", Hex.Rgb(0xbfe9ff));
            }
        }

        protected override void OnStaggered(float seconds)
        {
            ClearActTriggers();
            Diving = false;
            if (IsPeng) HoverAlt = Mathf.Max(0, GroundUnder(transform.position) - Hole.FloorY);
        }

        protected override void OnDefeated(DamageInfo info)
        {
            ClearActTriggers();
            Submerged = false;
            if (HoleFx)
            {
                HoleFx.Suction(false);
                HoleFx.Gust(false);
                HoleFx.Flash(0);
                HoleFx.SetAgitation(1f);
                HoleFx.ReleaseAfter(Def != null ? Def.defeat.seconds + Def.defeat.despawnAfter : 5f);
            }
            GameUI.Toast(IsKun ? "北冥之鲲沉入了冰海" : "鹏坠入北冥——冰海重归平静", Hex.Rgb(0xbfe9ff), 3.2f);
            var death = gameObject.AddComponent<KunPengDeath>();
            death.Begin(this, Model, IsKun, Def != null ? Def.defeat.seconds : 3.2f, Hole);
        }
    }

    /// <summary>
    /// 鲲鹏的倒下演出（行为组件倒下后就停用了，模型动画交给它；Three.js animateDeath）：
    ///   鲲：仰头长啸后沉回冰窟（0.25 → 1 的比例里沉到底）；鹏：收翼坠落（模型往下掉到地面高度、往前栽），逻辑位置钉住。
    /// 最后 18% 由 <see cref="BossDefeatSequence"/> 炸开并隐去模型。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class KunPengDeath : MonoBehaviour
    {
        BossModel model;
        bool kun;
        float seconds, t, drop, startY, startPitch;
        IceHoleInfo hole;

        public bool Running => model != null && t < seconds;

        public void Begin(KunPengBrain b, BossModel m, bool isKun, float duration, IceHoleInfo h)
        {
            model = m;
            kun = isKun;
            seconds = Mathf.Max(0.2f, duration);
            hole = h;
            if (m == null || !m.root) return;
            float s = Mathf.Max(0.01f, m.scale);
            startY = m.root.transform.localPosition.y * s;
            startPitch = m.root.transform.localEulerAngles.x;
            drop = Mathf.Max(0, b.transform.position.y - hole.FloorY);
            if (m.animator && m.animator.HasState(0, Animator.StringToHash("roar"))) m.animator.CrossFadeInFixedTime("roar", 0.15f);
        }

        void Update()
        {
            if (model == null || !model.root) return;
            t += Time.deltaTime;
            float k = Mathf.Clamp01(t / seconds);
            var mr = model.root.transform;
            float s = Mathf.Max(0.01f, model.scale);
            if (kun)
            {
                float sink = KunPengMath.EaseInOut(KunPengMath.Span(k, 0.25f, 1f));
                mr.localPosition = new Vector3(0, (startY + (KunPengDef.KunSunkY - KunPengDef.KunBaseY) * sink) / s, 0);
            }
            else
            {
                float e = k * k;
                mr.localPosition = new Vector3(0, -drop * Mathf.Min(1f, e * 1.2f) / s, 0);
                mr.localRotation = Quaternion.Euler(startPitch + k * Mathf.Rad2Deg, 0, Mathf.Sin(k * 9f) * 0.2f * (1 - k) * Mathf.Rad2Deg);
            }
        }
    }
}
