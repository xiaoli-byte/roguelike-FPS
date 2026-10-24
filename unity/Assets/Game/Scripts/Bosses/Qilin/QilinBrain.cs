using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟的行为（<see cref="QilinDef"/>；首领框架 <see cref="BossBrain"/> 的子类，招式在 Qilin/Moves/）。在框架之上加：
    ///   · 场地：炉心殿几何（<see cref="QilinFurnace"/>，关卡标记；测试场按场地推一份）、吊鼎与四个锁扣（<see cref="QilinCauldron"/> / <see cref="QilinLock"/>，
    ///     关卡里摆好的，没有就在熔池上方运行时建一套）、熔岩柱（<see cref="QilinFx"/>）；熔岩免疫，导航上把 Lava 区代价改成 1（齐地的熔岩渠直接跨过去）。
    ///   · 登场：从池心的熔岩柱里跃出，落在熔池北沿（模型根节点偏移，角色胶囊不动），落地人立长啸；登场结束锁扣上膛（110 × 难度）。
    ///   · 饮熔：85% / 70% 两道生命刻度（<see cref="OnMark"/>）排上饮熔（<see cref="ScaleDrink"/>，正在出招就等这一招收完）。
    ///   · 锁扣砸鼎：锁扣碎了 → 鼎那一角坠下（<see cref="QilinCauldron.DropCorner"/>）。正在饮熔、打的正是它身后那个锁扣 → 鼎角砸下那一刻
    ///     <see cref="CornerHit"/>：护甲清零、硬直 4 s（受伤 × 2，<see cref="BossBrain.Stagger"/>）、鳞甲崩裂（身体和五个受击球全算弱点），饮熔被打断；否则砸空，提示白费了一个。
    ///   · 转换（55%，5.2 s）：剩下的链全断、锁扣静默移除、巨鼎坠池（落定后是池中掩体，冲出一圈火浪）；麒麟跳进熔池沉下去，
    ///     1.9 s 在熔岩柱里换成焚身（框架换形），2.2 s 起从熔岩里冲出、跃回熔池另一侧的岸上；鳞甲炸飞（护甲清零）。
    ///     角色胶囊跟着模型落脚的地方瞬移（扎进熔池时到池里、落地时到上岸点），演出中不会在原地 / 上岸点留一根看不见的柱子。
    ///   · 走位：玄鳞在外环跑道上小跑、绕到玩家那一侧（TS idle）。
    ///   · 焚身踏云（BS5，同鹏的写法）：换形时停用导航代理，位置由这里积分——水平按 30 m/s² 追招式给的期望速度（这一帧没人给就悬停），
    ///     竖直追 <see cref="SkyTarget"/>（招式间隙 4.5 m、俯冲蓄势 / 火云雨 7.5 m、喘息 / 吐息落地 0），身下有石柱、倒鼎时自动抬过去；夹在殿墙以内。
    ///     招式间隙沿外环跑道上空绕殿弧线奔跑（半径 = 窄桥外端与殿墙的中点 − 1 m），5–9 s 掉一次头；在空中时蹄下冒火云、动画按奔跑速度播。
    ///     俯冲落地 / 喘息降落这类直接驱动位置的段落用 <see cref="SkyPlace"/>。
    ///   · 熔流轮转（<see cref="QilinFlood"/>）由这里推进；狂怒（15%）时排上 <see cref="BurnRage"/>（长啸、火浪、熔流重开且更快）。
    ///   · 胸口火心：焚身胸前一团光晕 + 点光，喘息时大亮（<see cref="HeartBright"/>，二阶段主要的输出窗口）。
    ///   · 倒下时还在空中就落到地上（溃散演出在地面炸）。
    /// 动作：E5 的 AC_SK_Boss_Qilin(Burn) 按状态名交叉淡入、拉伸到实际时长（框架 PlayAct；缺状态只警告一次，代理 / 占位体照常出招）。
    /// </summary>
    public class QilinBrain : BossBrain
    {
        public QilinDef QDef => Def as QilinDef;
        public QilinFurnace Furnace { get; private set; }
        public QilinCauldron Cauldron { get; private set; }
        public QilinFx Effects { get; private set; }
        public BossHazards Hazards { get; private set; }
        public IReadOnlyList<QilinLock> Locks => locks;

        /// <summary>玄鳞形态（一阶段）</summary>
        public bool IsXuan => Form != null && Form.id == QilinDef.XuanForm;
        /// <summary>正在低头饮熔（鼎角砸下来能砸中）与饮熔的象限</summary>
        public bool Sipping { get; private set; }
        public int DrinkQuadrant { get; private set; } = -1;
        /// <summary>饮熔时打碎了它身后的锁扣、鼎角还在落（饮熔等它砸下来）</summary>
        public bool CornerPending => pendingCorner >= 0;
        /// <summary>累计：排上的饮熔、开始低头的、喝完（鳞甲回满）的；鼎角砸中、砸空</summary>
        public int DrinksQueued { get; private set; }
        public int DrinksStarted { get; private set; }
        public int DrinksFinished { get; internal set; }
        public int CauldronHits { get; private set; }
        public int WastedCorners { get; private set; }
        /// <summary>鳞甲崩裂还剩几秒（&gt; 0 时全身都算弱点）</summary>
        public float CrackLeft { get; private set; }
        public bool Cracked => CrackLeft > 0;
        /// <summary>火鬃热度（0–1，饮熔时涨）</summary>
        public float ManeHeat { get; internal set; }
        /// <summary>蹄印（燃烧的持续区）累计数</summary>
        public int PrintsDropped { get; private set; }

        // ───── 焚身（BS5）─────

        /// <summary>焚身踏云的离地高度（米，蹄下；TS SKY_ALT）、俯冲蓄势 / 火云雨的高度、竖直速度上限、水平加速度、绕殿速度</summary>
        public const float SkyAlt = 4.5f, HighAlt = 7.5f, Climb = 12f, SkyAccel = 30f, OrbitSpeed = 11f;
        /// <summary>踏云时身下离石柱顶、倒鼎顶至少多高（米）</summary>
        public const float Clearance = 0.7f;

        /// <summary>焚身形态（二阶段）</summary>
        public bool IsBurn => Form != null && Form.id == QilinDef.BurnForm;
        /// <summary>熔流轮转（焚身才有）</summary>
        public QilinFlood Flood { get; private set; }
        /// <summary>踏云的目标高度（离殿内地面，蹄下）：招式间隙 4.5，俯冲蓄势 / 火云雨 7.5，喘息 / 吐息落地 0</summary>
        public float SkyTarget { get; set; } = SkyAlt;
        /// <summary>离殿内地面多高（蹄下）</summary>
        public float Altitude => transform.position.y - FloorY;
        /// <summary>焚身正在半空</summary>
        public bool Airborne => IsBurn && Altitude > 1f;
        /// <summary>踏云的当前速度</summary>
        public Vector3 SkyVelocity => skyVel;
        /// <summary>胸口火心的亮度（0.3 平时，喘息时 1）与「大亮」开关（喘息招式写）</summary>
        public float HeartGlow { get; private set; } = 0.3f;
        public bool HeartBright { get; set; }
        /// <summary>踏云的水平加速度（米/秒²；俯冲时 40，TS accel）</summary>
        public float Accel { get; set; } = SkyAccel;
        /// <summary>招式间隙也待在地上（俯冲三踏之后、喘息之前那一下喘息）</summary>
        public bool HoldGround { get; set; }
        /// <summary>焚身累计：狂怒长啸次数、召出的神火飞鸦</summary>
        public int RageRoars { get; internal set; }
        public int CrowsSummoned { get; private set; }
        /// <summary>最近一批神火飞鸦出生时最低离地多高（测试用）</summary>
        public float LastCrowAltitude { get; private set; } = float.NaN;

        Vector3 skyVel, desiredVel;
        bool hasDesired, skyPlaced;
        float orbit, orbitTimer, orbitDir = 1, cloudAcc;
        Transform heartFx;
        Light heartLight;
        Renderer heartSprite;

        static readonly string[] CrackZones = { "head", "neck", "chest", "back", "hips" };
        static readonly string[] HoofBones = { "fhoof_L", "hhoof_R", "fhoof_R", "hhoof_L" };

        readonly List<QilinLock> locks = new();
        readonly List<HazardZone> prints = new();
        readonly HashSet<string> told = new();
        readonly Transform[] hooves = new Transform[4];
        Transform jaw, head, chest, hips;
        int pendingCorner = -1;
        bool wastedPending, introRoared, diveWarped, landWarped, wired;
        float pearlGlow = 0.3f, transPrev = -1;
        Vector3 leapFrom, diveAt, landAt;

        // ───────────── 生成 ─────────────

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            if (Def == null) return;
            Hazards = BossHazards.For(this);
            SetupArena();
            CacheBones();
            // 熔岩免疫：齐地的熔岩渠、熔池在导航上是高代价区，火麒麟直接跨过去
            if (agent && LavaField.LavaArea >= 0) agent.SetAreaCost(LavaField.LavaArea, 1f);
            if (Model?.rig) Model.rig.feetIK = false;
            introRoared = false;
            IntroTick(0, 0);
        }

        /// <summary>炉心殿、吊鼎、锁扣、熔岩柱：关卡里有就用，没有就在场地上建一套（测试场 / 调试命令）</summary>
        void SetupArena()
        {
            if (!arena)
            {
                var fwd = transform.forward;
                arena = BossArena.CreateRuntime(transform.position, 22f, fwd.sqrMagnitude > 1e-4f ? fwd : Vector3.forward, QilinDef.Id, transform.parent);
            }
            Furnace = QilinFurnace.For(arena);
            if (!Furnace || Flat(Furnace.Center - arena.Center).sqrMagnitude > 30f * 30f) Furnace = QilinFurnace.CreateRuntime(arena);
            Cauldron = QilinCauldron.Nearest(Furnace.Center);
            if (!Cauldron || Flat(Cauldron.transform.position - Furnace.Center).sqrMagnitude > 10f * 10f)
                Cauldron = QilinCauldron.CreateRuntime(Furnace, QDef != null ? QDef.lockHeight : 12f, transform.parent);
            Cauldron.Build();
            locks.Clear();
            if (Cauldron.locks != null)
                foreach (var l in Cauldron.locks)
                    if (l)
                    {
                        l.Build();
                        locks.Add(l);
                    }
            Effects = QilinFx.Create(Furnace.Center, Furnace.poolRadius, transform.parent);
            Wire(true);
        }

        void Wire(bool on)
        {
            if (on == wired) return;
            wired = on;
            foreach (var l in locks)
            {
                if (!l) continue;
                l.Broken -= OnLockBroken;
                if (on) l.Broken += OnLockBroken;
            }
            if (!Cauldron) return;
            Cauldron.Impact -= OnCauldronImpact;
            if (on) Cauldron.Impact += OnCauldronImpact;
        }

        void OnDestroy()
        {
            Wire(false);
            if (Effects) Destroy(Effects.gameObject);
            Flood?.Dispose();
            if (heartFx) Destroy(heartFx.gameObject);
        }

        /// <summary>当前模型的骨骼：四蹄（蹄印）、下颌（吐息）、头、胸、臀（冲撞判定）。代理 / 占位体找不到时为 null，招式退回按身体估算</summary>
        void CacheBones()
        {
            for (int i = 0; i < 4; i++) hooves[i] = Model?.FindBone(HoofBones[i]);
            jaw = Model?.FindBone("jaw");
            head = Model?.FindBone("head");
            chest = Model?.FindBone("chest");
            hips = Model?.FindBone("hips");
        }

        // ───────────── 给招式用的点 ─────────────

        /// <summary>殿内地面高度</summary>
        public float FloorY => arena ? arena.FloorY : transform.position.y;

        public Vector3 OnFloor(Vector3 p)
        {
            p.y = FloorY;
            return p;
        }

        /// <summary>口部（吐息发射点）</summary>
        public Vector3 MouthPoint => jaw ? jaw.position : BodyCenter + transform.forward * (BodyRadius + 1.6f) + Vector3.up * 1.4f;
        public Vector3 HeadPoint => head ? head.position : BodyCenter + transform.forward * (BodyRadius + 1f) + Vector3.up * 2f;
        public Vector3 ChestPoint => chest ? chest.position : BodyCenter + transform.forward * 1.8f;
        public Vector3 HipsPoint => hips ? hips.position : BodyCenter - transform.forward * 1.8f;

        /// <summary>第 i 只蹄（0 左前、1 右后、2 右前、3 左后：横向跑步的落蹄顺序）的地面点</summary>
        public Vector3 HoofPoint(int i)
        {
            var h = hooves[((i % 4) + 4) % 4];
            if (h) return OnFloor(h.position);
            float side = i % 2 == 0 ? (i == 0 ? -0.5f : 0.5f) : (i == 1 ? 0.6f : -0.6f);
            float along = i % 2 == 0 ? 1.8f : -1.2f;
            return OnFloor(transform.position + transform.right * side + transform.forward * along);
        }

        /// <summary>招式伤害：TS 写的是难度 1 的绝对伤害，换算成本首领的招式伤害（含难度、狂怒）</summary>
        public float Dmg(float tsBase) => MoveDamage(tsBase / Mathf.Max(1f, Def != null ? Def.damage : 16f));

        /// <summary>落一个燃烧的蹄印（持续区：4 s，玩家贴地踩到每 0.4 s 烧一下）</summary>
        public void DropPrint(Vector3 at)
        {
            var d = QDef;
            float life = d?.printLife ?? 4f, r = d?.printRadius ?? 0.95f;
            var z = Hazards.Zone(new BossZoneSpec(OnFloor(at) + Vector3.up * 0.02f, r, life, Dmg(d?.printDamage ?? 7f), QilinDef.Ember)
            {
                arm = 0, interval = d?.printInterval ?? 0.4f, maxHeight = 0.5f, element = Element.Fire, embers = true,
            });
            if (!z) return;
            prints.RemoveAll(p => !p);
            prints.Add(z);
            PrintsDropped++;
        }

        /// <summary>还在烧的蹄印个数</summary>
        public int LivePrints
        {
            get
            {
                int n = 0;
                foreach (var p in prints)
                    if (p && !p.Ended)
                        n++;
                return n;
            }
        }

        void ClearPrints()
        {
            foreach (var p in prints)
                if (p)
                    p.Expire();
            prints.Clear();
        }

        /// <summary>只提示一次</summary>
        public void Tell(string key, string text, Color? color = null)
        {
            if (!told.Add(key)) return;
            GameUI.Toast(text, color ?? Hex.Rgb(0xffb070), 3.2f);
        }

        /// <summary>
        /// 贴首领自己的导航网格：按 agent 的代理类型过滤（熔池、护城渠里另有一张火鼍的 LavaSwimmer 网格，不带过滤会落到那张上，agent 瞬移不过去）。
        /// 采不到时 at = p，返回 false
        /// </summary>
        public bool SampleNav(Vector3 p, float radius, out Vector3 at)
        {
            var filter = agent ? new NavMeshQueryFilter { agentTypeID = agent.agentTypeID, areaMask = NavMesh.AllAreas } : LavaField.WalkerFilter();
            if (NavMesh.SamplePosition(p, out var hit, radius, filter))
            {
                at = hit.position;
                return true;
            }
            at = p;
            return false;
        }

        /// <summary>瞬移到 p（贴导航网格；招式间的走位，不经过脚本位移）</summary>
        public void WarpTo(Vector3 p)
        {
            SampleNav(p, 4f, out p);
            if (agent && agent.enabled && agent.isOnNavMesh) agent.Warp(p);
            else transform.position = p;
            var loco = Model?.locomotion;
            if (loco) loco.Teleported();
        }

        /// <summary>模型根节点相对角色胶囊的世界偏移（登场跃出、跳池换形；平时为 0）</summary>
        void ApplyOffset(Vector3 world)
        {
            if (Model == null || !Model.root) return;
            float s = Mathf.Max(0.01f, Model.scale);
            Model.root.transform.localPosition = Quaternion.Inverse(transform.rotation) * world / s;
        }

        // ───────────── 饮熔（ScaleDrink 调）─────────────

        /// <summary>饮熔：选象限（离自己最近、锁扣还在、链还拴着的；都没了取自己所在的象限）</summary>
        public int PickDrinkQuadrant()
        {
            var f = Furnace;
            if (!f) return 0;
            float me = f.YawOf(transform.position);
            int best = -1;
            float bestD = float.PositiveInfinity;
            for (int i = 0; i < f.QuadrantCount; i++)
            {
                if (!LockAlive(i) || (Cauldron && !Cauldron.ChainIntact(i))) continue;
                float d = Mathf.Abs(Mathf.DeltaAngle(me, f.QuadrantYaw(i)));
                if (d >= bestD) continue;
                bestD = d;
                best = i;
            }
            return best >= 0 ? best : f.QuadrantOf(transform.position);
        }

        /// <summary>象限 i 的锁扣还挂着、可以打</summary>
        public bool LockAlive(int i)
        {
            foreach (var l in locks)
                if (l && l.index == i)
                    return l.Alive;
            return false;
        }

        public QilinLock LockAt(int i)
        {
            foreach (var l in locks)
                if (l && l.index == i)
                    return l;
            return null;
        }

        internal void BeginSip(int quadrant)
        {
            Sipping = true;
            DrinkQuadrant = quadrant;
            DrinksStarted++;
            var l = LockAt(quadrant);
            if (l) l.Highlight = true;
        }

        internal void EndSip()
        {
            var l = LockAt(DrinkQuadrant);
            if (l) l.Highlight = false;
            Sipping = false;
            DrinkQuadrant = -1;
            if (Effects) Effects.Eruption(0);
        }

        // ───────────── 锁扣 / 吊鼎 ─────────────

        void OnLockBroken(QilinLock l)
        {
            if (Dead || !l || Phase > 0 || !Cauldron) return;
            if (!Cauldron.DropCorner(l.index, out _)) return;
            if (Sipping && DrinkQuadrant == l.index) pendingCorner = l.index;
            else
            {
                wastedPending = true;
                WastedCorners++;
            }
        }

        void OnCauldronImpact(QilinCauldron c, bool fallen, Vector3 at)
        {
            Fx.Explosion(at, fallen ? 6f : 3.5f, QilinDef.Fire);
            Fx.Burst(at, QilinDef.Ember, fallen ? 60 : 30, fallen ? 14f : 9f, 1.1f, 0.4f, 12f);
            CameraShake.Quake(at, fallen ? 0.95f : 0.6f, 70f, fallen ? 1f : 0.5f);
            GameAudio.PlayAt("boss_slam", at, 1f, fallen ? 0.5f : 0.75f);
            GameAudio.PlayAt("explosion", at, 0.9f, 0.6f);
            if (fallen)
            {
                // 巨鼎砸进熔池：熔岩冲天，一圈火浪从池边扫到殿墙（跳过去）
                if (Effects) Effects.Burst();
                var f = Furnace;
                if (f && !Dead)
                    Hazards.Wave(new BossWaveSpec(f.Center, 15f, f.wallRadius + 1f, Dmg(12), QilinDef.Warn)
                    {
                        startRadius = f.poolRadius, width = 1.1f, height = 0.95f, knockback = 7f, element = Element.Fire, dust = true, dustColor = QilinDef.Ember,
                    });
                return;
            }
            if (pendingCorner >= 0 && Sipping && !Dead && Phase == 0)
            {
                pendingCorner = -1;
                CornerHit();
            }
            else if (wastedPending)
            {
                wastedPending = false;
                pendingCorner = -1;
                GameUI.Toast("鼎角砸空——白费了一个锁扣。等它饮熔时再打它身后那一个", Hex.Rgb(0xc8a070), 3.2f);
            }
        }

        /// <summary>鼎角砸中饮熔的麒麟：护甲清零、鳞甲崩裂（全身弱点）、硬直 4 s（受伤 × 2）。饮熔被打断</summary>
        void CornerHit()
        {
            var d = QDef;
            float secs = QilinDef.StunSeconds;
            CauldronHits++;
            hp.armor = 0;
            var h = HeadPoint;
            Fx.Burst(h, QilinDef.ScaleDark, 40, 10f, 1.2f, 0.35f, 16f);
            Fx.Burst(h, QilinDef.Hot, 30, 9f, 0.8f, 0.3f, 6f);
            GameAudio.PlayAt("shield_break", h, 1f, 0.6f);
            PlaySfx("boss_roar", 1f, 0.65f);
            GameUI.Toast("巨鼎砸中火麒麟！鳞甲崩裂——全身都是弱点、伤害翻倍，4 秒！", Hex.Rgb(0xffe08a), 3.5f);
            Stagger(secs, "stun", QilinDef.CrackTakenMult);
            StartCrack(secs);
        }

        void StartCrack(float seconds)
        {
            CrackLeft = Mathf.Max(CrackLeft, seconds);
            SetCrackWeak(true);
        }

        void EndCrack()
        {
            if (CrackLeft <= 0 && !crackWeak) return;
            CrackLeft = 0;
            SetCrackWeak(false);
        }

        bool crackWeak;

        /// <summary>鳞甲崩裂：身体（角色胶囊）和五个受击球都算弱点；结束后回到只有火珠</summary>
        void SetCrackWeak(bool on)
        {
            crackWeak = on;
            var bodyZone = body ? body.Zone("body") : null;
            if (bodyZone) bodyZone.SetWeakPoint(on);
            foreach (var id in CrackZones)
            {
                var z = Zone(id);
                if (z) z.SetWeakPoint(on);
            }
        }

        /// <summary>某个受击区此刻算不算弱点（测试用）</summary>
        public bool ZoneWeak(string id)
        {
            var z = id == "body" ? (body ? body.Zone("body") : null) : Zone(id);
            return z && z.weakpoint;
        }

        // ───────────── 每帧 ─────────────

        protected override void Update()
        {
            base.Update();
            if (Def == null || Dead) return;
            float dt = Time.deltaTime;
            if (CrackLeft > 0)
            {
                CrackLeft -= dt;
                if (CrackLeft <= 0) EndCrack();
            }
            // 火珠：平时微光；人立、被砸晕、鳞甲崩裂、喘息时大亮
            bool bright = Staggered || Cracked || HeartBright || (Current is ScaleBlades && Current.Stage == MoveStage.Windup);
            pearlGlow += ((bright ? 1f : 0.35f) - pearlGlow) * Mathf.Min(1f, dt * 4f);
            Glow(0, pearlGlow * (0.75f + 0.25f * Mathf.Sin(Time.time * 5f)));
            ManeHeat = Mathf.Max(0, ManeHeat - dt * 0.02f);
            if (IsBurn && IntroDone && !Transitioning) StepSky(dt);
            Flood?.Tick(dt);
            HeartGlow += ((HeartBright ? 1f : 0.3f) - HeartGlow) * Mathf.Min(1f, dt * 4f);
            if (IsBurn) HoofClouds(dt);
        }

        void LateUpdate()
        {
            if (Def == null || Dead) return;
            UpdateHeartFx();
        }

        // ───────────── 焚身：踏云 ─────────────

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

        /// <summary>这一帧悬停（水平速度收向 0）</summary>
        public void Hover()
        {
            desiredVel = Vector3.zero;
            hasDesired = true;
        }

        /// <summary>立刻收住水平速度（蓄势悬停时不往前滑）</summary>
        public void Brake(float keep = 0.2f)
        {
            skyVel.x *= keep;
            skyVel.z *= keep;
        }

        /// <summary>这一帧直接把位置放到 p（俯冲、降落这类脚本轨迹）：踏云积分跳过这一帧，速度清零</summary>
        public void SkyPlace(Vector3 p)
        {
            if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)) return;
            transform.position = p;
            skyVel = Vector3.zero;
            skyPlaced = true;
            hasDesired = false;
        }

        /// <summary>踏云积分：水平追期望速度、竖直追目标高度（身下有石柱 / 倒鼎时抬过去），夹在殿墙以内；动画按奔跑速度播</summary>
        void StepSky(float dt)
        {
            if (!(dt > 0)) return;
            var loco = Model?.locomotion;
            if (skyPlaced)
            {
                skyPlaced = false;
                if (loco) loco.speedOverride = Airborne ? loco.maxClipSpeed * 0.9f : -1f;
                return;
            }
            var want = hasDesired ? desiredVel : Vector3.zero;
            hasDesired = false;
            var flat = Vector3.MoveTowards(new Vector3(skyVel.x, 0, skyVel.z), new Vector3(want.x, 0, want.z), Mathf.Max(1f, Accel) * dt);
            var p = transform.position;
            float floor = FloorY;
            float alt = Mathf.Max(0, SkyTarget);
            float bob = alt > 1f ? Mathf.Sin(age * 1.6f) * 0.9f : 0;
            float targetY = floor + alt + bob;
            if (alt > 0.5f)
            {
                // 身下（含前方 0.4 s 的落点）有石柱、倒鼎：抬过去
                float under = Mathf.Max(GroundUnder(p), GroundUnder(p + flat * 0.4f));
                targetY = Mathf.Max(targetY, under + Clearance);
            }
            float vy = Mathf.Clamp((targetY - p.y) * 3f, -Climb, Climb);
            skyVel = new Vector3(flat.x, Mathf.MoveTowards(skyVel.y, vy, 40f * dt), flat.z);
            p += skyVel * dt;
            float ground = GroundUnder(p);
            if (p.y < ground)
            {
                p.y = ground;
                if (skyVel.y < 0) skyVel.y = 0;
            }
            p = KeepInHall(p);
            if (float.IsFinite(p.x) && float.IsFinite(p.y) && float.IsFinite(p.z)) transform.position = p;
            else skyVel = Vector3.zero;
            if (loco) loco.speedOverride = Airborne ? loco.maxClipSpeed * 0.9f : -1f;
        }

        /// <summary>夹在殿墙以内（身体半径 + 0.5 m）</summary>
        public Vector3 KeepInHall(Vector3 p)
        {
            var f = Furnace;
            if (f)
            {
                float max = Mathf.Max(2f, f.wallRadius - BodyRadius - 0.5f);
                var d = p - f.Center;
                d.y = 0;
                if (d.sqrMagnitude > max * max)
                {
                    var q = f.Center + d.normalized * max;
                    p.x = q.x;
                    p.z = q.z;
                }
            }
            else if (arena) p = arena.Clamp(p, ArenaMargin);
            return p;
        }

        static readonly RaycastHit[] groundHits = new RaycastHit[12];

        /// <summary>
        /// p 正下方（身体半径的六成以内）最高的朝上表面：石柱顶、倒鼎、地面；打不到时殿内地面。熔池里取池面（不钻进熔岩）
        /// </summary>
        public float GroundUnder(Vector3 p)
        {
            float floor = FloorY;
            float top = Mathf.Max(p.y, floor) + 12f;
            float r = Mathf.Clamp(BodyRadius * 0.6f, 0.4f, 2f);
            int n = Physics.SphereCastNonAlloc(new Vector3(p.x, top, p.z), r, Vector3.down, groundHits, top - floor + 3f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            float best = float.NegativeInfinity;
            for (int i = 0; i < n; i++)
            {
                var h = groundHits[i];
                if (h.collider && h.collider.transform.IsChildOf(transform)) continue;
                // 起点就在碰撞体里的（distance 0）点没有意义
                if (h.distance <= 0 || h.normal.y < 0.3f) continue;
                best = Mathf.Max(best, h.point.y);
            }
            if (LavaField.TrySurfaceHeight(p, out float lava)) best = Mathf.Max(best, lava);
            return float.IsNegativeInfinity(best) ? floor : Mathf.Max(best, floor - 1.2f);
        }

        /// <summary>招式间隙（焚身）：沿外环跑道上空绕殿弧线奔跑，隔 5–9 s 掉头；面朝奔跑方向（头由骨骼看向盯着玩家）</summary>
        void SkyIdle(float dt)
        {
            var f = Furnace;
            if (HoldGround)
            {
                SkyTarget = 0;
                Hover();
                Face(PlayerPosition, 90f, dt);
                return;
            }
            SkyTarget = SkyAlt;
            orbitTimer -= dt;
            if (orbitTimer <= 0)
            {
                orbitDir = -orbitDir;
                orbitTimer = Random.Range(5f, 9f);
            }
            orbit += orbitDir * 31.5f * dt;
            var target = f ? f.Point(orbit, (f.bridgeOuter + f.wallRadius) * 0.5f - 1f) : PlayerPosition;
            FlyTo(target, OrbitSpeed, 1f);
            var v = skyVel;
            v.y = 0;
            if (v.sqrMagnitude > 0.25f) transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(v), 172f * dt);
            else Face(PlayerPosition, 115f, dt);
        }

        /// <summary>
        /// 焚身找落脚点（喘息、吐息）：贴人形导航网格、只取非熔岩区（涨着的熔流已经从网格上挖掉），不落进熔池 / 倒鼎、不压石柱。找不到返回 near 的地面点
        /// </summary>
        public Vector3 LandingSpot(Vector3 near)
        {
            var p = OnFloor(near);
            var f = Furnace;
            if (f)
            {
                float r = f.RadiusOf(p);
                float minR = f.poolRadius + BodyRadius * 0.7f + 0.6f;
                float maxR = f.wallRadius - BodyRadius - 0.6f;
                float yaw = r > 0.5f ? f.YawOf(p) : f.YawOf(PlayerPosition);
                if (r < minR) p = f.Point(yaw, minR);
                else if (r > maxR) p = f.Point(yaw, maxR);
            }
            var filter = LavaField.WalkerFilter(LavaField.DryAreaMask);
            foreach (float radius in new[] { 1.5f, 3f, 5f, 8f })
            {
                if (!NavMesh.SamplePosition(p, out var hit, radius, filter)) continue;
                var at = hit.position;
                if (LavaField.IsLavaAt(at) || (Flood != null && Flood.Flooded(at)) || !BodyFits(at)) continue;
                if (f && f.RadiusOf(at) < f.poolRadius + 0.5f) continue;
                return at;
            }
            return p;
        }

        /// <summary>身子放在 feet 这里会不会插进石柱 / 墙（离地 0.6 m 以上、半径 = 身体半径的七成）</summary>
        public bool BodyFits(Vector3 feet)
        {
            float r = Mathf.Clamp(BodyRadius * 0.7f, 0.4f, 2.2f);
            var a = feet + Vector3.up * (r + 0.6f);
            var b = feet + Vector3.up * Mathf.Max(r + 0.7f, 4f);
            int n = Physics.OverlapCapsuleNonAlloc(a, b, r, overlapBuf, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
                if (overlapBuf[i] && !overlapBuf[i].transform.IsChildOf(transform))
                    return false;
            return true;
        }

        static readonly Collider[] overlapBuf = new Collider[8];

        /// <summary>把落点从石柱 / 墙里推出来（最多推 4 m；推不出来原样返回）</summary>
        public Vector3 PushClear(Vector3 feet)
        {
            if (BodyFits(feet)) return feet;
            var f = Furnace;
            var c = f ? f.Center : transform.position;
            for (int ring = 1; ring <= 8; ring++)
            {
                float step = ring * 0.5f;
                for (int k = 0; k < 8; k++)
                {
                    float a = k * 45f + ring * 17f;
                    var q = feet + Quaternion.Euler(0, a, 0) * Vector3.forward * step;
                    if (f && f.RadiusOf(q) > f.wallRadius - BodyRadius - 0.5f) continue;
                    if (BodyFits(q)) return q;
                }
            }
            return feet;
        }

        /// <summary>焚身在空中时蹄下冒火云</summary>
        void HoofClouds(float dt)
        {
            if (!Airborne) return;
            cloudAcc += dt;
            if (cloudAcc < 0.08f) return;
            cloudAcc = 0;
            for (int i = 0; i < 4; i++)
            {
                if (Random.value < 0.4f) continue;
                var h = hooves[i];
                var at = h ? h.position : transform.position + Vector3.up * 0.4f;
                Fx.Burst(at, Random.value < 0.35f ? QilinDef.Hot : QilinDef.Fire, 2, 1.2f, 0.55f, 0.35f + Random.value * 0.3f, 1.2f);
            }
        }

        /// <summary>胸口火心：焚身胸前的光晕 + 点光（喘息时大亮）。没有胸骨时取身体中心往前</summary>
        void UpdateHeartFx()
        {
            if (!IsBurn)
            {
                if (heartFx) heartFx.gameObject.SetActive(false);
                return;
            }
            if (!heartFx)
            {
                var go = new GameObject("Qilin Heart Glow");
                go.transform.SetParent(transform.parent, false);
                heartFx = go.transform;
                var sprite = FxMaterials.GlowSprite(heartFx, 1f, new Color(1f, 0.55f, 0.15f, 0.8f));
                heartSprite = sprite ? sprite.GetComponent<Renderer>() : null;
                var lgo = new GameObject("Heart Light");
                lgo.transform.SetParent(heartFx, false);
                heartLight = lgo.AddComponent<Light>();
                heartLight.type = LightType.Point;
                heartLight.color = new Color(1f, 0.55f, 0.2f);
                heartLight.shadows = LightShadows.None;
                heartLight.range = 9f;
            }
            heartFx.gameObject.SetActive(true);
            float g = HeartGlow * (0.85f + 0.15f * Mathf.Sin(Time.time * 7f));
            heartFx.position = ChestPoint + transform.forward * 1.1f + Vector3.up * 0.15f;
            var s = heartSprite ? heartSprite.transform : null;
            if (s) s.localScale = Vector3.one * (1.2f + 2.2f * g);
            if (heartSprite) FxMaterials.Tint(heartSprite, new Color(1f, 0.5f + 0.25f * g, 0.15f, 0.35f + 0.6f * g));
            if (heartLight) heartLight.intensity = 1.5f + 6f * g;
        }

        // ───────────── 焚身：神火飞鸦 ─────────────

        /// <summary>
        /// 火云雨时高处排烟口飞出神火飞鸦（TS summonCrows）：关卡的排烟口（3-4 西南偏南 / 东南偏南、离地 12 m）各分一半；没有就在玩家对面两侧的殿墙边 10 m 高处。
        /// 受首领召唤上限（6，含还没收掉的炭童）约束；出生后放回排烟口的高度。返回召出的个数
        /// </summary>
        public int SummonCrows(int count)
        {
            var d = QDef;
            string id = d?.crowId ?? "fire_crow";
            if (count <= 0 || Dead || EnemyRoster.Get(id) == null) return 0;
            var pts = CrowPoints();
            if (pts.Count == 0) return 0;
            var f = Furnace;
            // 先在场地的召唤点（炉口，地面上有导航网格）生成，再放回排烟口的高度：直接在半空生成的话，飞鸦的导航代理会报「离导航网格太远」
            var o = SummonOptions.Default;
            o.warn = 0;
            o.usePoints = true;
            int before = Summons.TotalSpawned;
            Summons.Spawn(id, count, o);
            int made = Summons.TotalSpawned - before;
            var live = Summons.Live;
            float low = float.PositiveInfinity;
            for (int k = 0; k < made && k < live.Count; k++)
            {
                var ai = live[live.Count - 1 - k];
                // 同一个排烟口第二只往旁边错开 1.8 m（沿殿墙切向）
                var at = pts[k % pts.Count];
                int slot = k / pts.Count;
                if (slot > 0 && f)
                {
                    var radial = at - f.Center;
                    radial.y = 0;
                    at += Vector3.Cross(Vector3.up, radial.normalized) * (1.8f * slot);
                }
                if (ai is FlyingEnemyAI fly) fly.PlaceInAir(at);
                else if (ai) ai.transform.position = at;
                if (ai) low = Mathf.Min(low, ai.transform.position.y - FloorY);
                Fx.Burst(at, QilinDef.Ember, 18, 6f, 0.6f, 0.25f, 3f);
            }
            LastCrowAltitude = float.IsPositiveInfinity(low) ? float.NaN : low;
            CrowsSummoned += made;
            if (made > 0) Tell("crows", "高处排烟口飞出神火飞鸦——在空中打爆它们", Hex.Rgb(0xffb070));
            return made;
        }

        readonly List<Vector3> crowPts = new();

        List<Vector3> CrowPoints()
        {
            crowPts.Clear();
            var f = Furnace;
            if (f && f.vents != null)
                foreach (var v in f.vents)
                {
                    if (!v) continue;
                    // 排烟口的标记贴着殿墙：往殿里挪 2.5 m，飞鸦不卡在墙里
                    var radial = f.Center - v.position;
                    radial.y = 0;
                    crowPts.Add(v.position + (radial.sqrMagnitude > 1e-4f ? radial.normalized * 2.5f : Vector3.zero));
                }
            if (crowPts.Count > 0) return crowPts;
            float pa = f ? f.YawOf(PlayerPosition) : transform.eulerAngles.y;
            foreach (float side in new[] { -1f, 1f })
            {
                var p = f ? f.Point(pa + 180f + side * 34.4f, f.wallRadius - 1f) : transform.position + Quaternion.Euler(0, side * 60f, 0) * -transform.forward * 12f;
                p.y = FloorY + 10f;
                crowPts.Add(p);
            }
            return crowPts;
        }

        /// <summary>熔池上空朝 p 那一侧的悬停点（离圆心 = 熔池半径 × 0.75）：熔流开闸、狂怒长啸时悬在这里，不钻进池心的熔岩柱里</summary>
        public Vector3 PoolEdgeToward(Vector3 p)
        {
            var f = Furnace;
            if (!f) return transform.position;
            var d = p - f.Center;
            d.y = 0;
            if (d.sqrMagnitude < 1e-4f) d = transform.position - f.Center;
            d.y = 0;
            if (d.sqrMagnitude < 1e-4f) d = Vector3.forward;
            return f.Center + d.normalized * (f.poolRadius * 0.75f);
        }

        /// <summary>某一点在不在玩家可走的地面上（测试用：人形导航网格、非熔岩区）</summary>
        public static bool OnWalkable(Vector3 p, float radius = 0.6f) =>
            NavMesh.SamplePosition(p, out var hit, radius, LavaField.WalkerFilter(LavaField.DryAreaMask)) && Mathf.Abs(hit.position.y - p.y) < 1.5f;

        // ───────────── 框架钩子 ─────────────

        /// <summary>登场：熔池里冲起熔岩柱，麒麟从池心跃出，落在出生点（熔池北沿）人立长啸（TS entrance）</summary>
        protected override void IntroTick(float t, float dt)
        {
            var f = Furnace;
            if (!f) return;
            if (Effects) Effects.Eruption(t < 0.3f ? 0.7f : 0f);
            float k = EaseInOut(Span(t, 0.12f, 0.45f));
            float lift = Mathf.Sin(Mathf.PI * k) * 7f - 8f * (1f - Span(t, 0f, 0.14f));
            ApplyOffset(Flat(f.Center - transform.position) * (1f - k) + Vector3.up * lift);
            if (k >= 1f && !introRoared)
            {
                introRoared = true;
                PlayAct("rear", 1.2f);
                PlaySfx("boss_roar", 1f, 0.8f);
                Fx.Ring(OnFloor(transform.position) + Vector3.up * 0.1f, 12f, QilinDef.Warn, 1f);
                Shake(0.6f, 1f);
            }
        }

        protected override void OnIntroEnd()
        {
            ApplyOffset(Vector3.zero);
            if (Effects) Effects.Eruption(0);
            foreach (var l in locks)
                if (l)
                    l.Arm(level);
            Tell("intro", "火麒麟·玄鳞——角根的火珠是弱点；它饮熔时，打碎它身后外墙上的锁扣，让巨鼎砸它");
        }

        /// <summary>85% / 70% 饮熔线：正在出招（或硬直）就排队，空着就立刻出</summary>
        public override void OnMark(string markId)
        {
            if (markId != QilinDef.DrinkMarkA && markId != QilinDef.DrinkMarkB) return;
            if (Phase > 0 || !IsXuan || Transitioning || PhaseFraction <= QilinDef.TransformAt) return;
            DrinksQueued++;
            if (Current == null && !Staggered && !Stunned && IntroDone) ForceMove(ScaleDrink.MoveId);
            else QueueMove(ScaleDrink.MoveId);
        }

        /// <summary>55%：链全断、锁扣移除、巨鼎坠池；记下跳池的起点、池心落点、换形后的上岸点</summary>
        protected override void OnPhase(int phase)
        {
            if (phase != 1) return;
            EndCrack();
            if (Sipping) EndSip();
            pendingCorner = -1;
            wastedPending = false;
            ClearPrints();
            foreach (var l in locks)
                if (l)
                    l.Purge();
            if (Cauldron) Cauldron.Fall();
            var f = Furnace;
            leapFrom = transform.position;
            var c = f ? f.Center : transform.position;
            var away = Flat(transform.position - c);
            if (away.sqrMagnitude < 1e-4f) away = Vector3.forward;
            // 跳进池心偏自己这一侧（巨鼎砸在正中）；上岸点在熔池另一侧、朝玩家的池沿外 4.5 m
            diveAt = c + away.normalized * Mathf.Min(3f, (f ? f.poolRadius : 7f) * 0.45f);
            var toPlayer = Flat(PlayerPosition - c);
            if (toPlayer.sqrMagnitude < 1e-4f) toPlayer = -away;
            float landR = (f ? f.poolRadius : 7f) + 4.5f;
            landAt = c + toPlayer.normalized * landR;
            // 玩家正好站在上岸点上：往旁边让 40°，别落在玩家身上（角色胶囊落地会和玩家叠在一起）
            if (Flat(PlayerPosition - landAt).sqrMagnitude < 4.5f * 4.5f)
                landAt = c + Quaternion.Euler(0, 40f, 0) * toPlayer.normalized * landR;
            landAt.y = FloorY;
            diveWarped = landWarped = false;
            transPrev = -1;
        }

        /// <summary>
        /// 化焚身（TS transitionTick）：0.2–1.1 s 跃向池心、1.1–1.9 s 沉下去；熔岩柱 1.0 → 1.6 s 冲满、保持到 3.4 s、4.6 s 落下；
        /// 2.2–3.6 s 从熔岩里冲出、3.6–4.6 s 跃回岸上。模型走根节点偏移；角色胶囊跟着模型「落脚」的地方走：
        /// 1.1 s 扎进熔池时瞬移到池里的落点（熔池里没人站，演出中不会有一根看不见的柱子挡在原地 / 上岸点），4.6 s 落地时再瞬移到上岸点
        /// </summary>
        protected override void TransitionTick(float t, float dt)
        {
            float was = transPrev;
            transPrev = t;
            bool Crossed(float x) => was < x && t >= x;
            var f = Furnace;
            float col = t < 1f ? 0 : t < 1.6f ? (t - 1f) / 0.6f : t < 3.4f ? 1f : Mathf.Max(0, 1f - (t - 3.4f) / 1.2f);
            if (Effects) Effects.Eruption(col, true);
            if (t >= 1.1f && !diveWarped)
            {
                diveWarped = true;
                WarpTo(diveAt);
            }
            if (t < 1.9f)
            {
                float k = EaseInOut(Span(t, 0.2f, 1.1f));
                var pos = Vector3.Lerp(leapFrom, diveAt, k);
                pos.y = FloorY + Mathf.Sin(Mathf.PI * k) * 7f - 9f * EaseInOut(Span(t, 1.1f, 1.9f));
                ApplyOffset(pos - transform.position);
                if (Crossed(0.2f)) PlayAct("tuck", 0.9f);
                if (Crossed(1.1f) && f)
                {
                    Fx.Burst(f.Center + Vector3.up * 0.5f, QilinDef.Fire, 50, 12f, 1.2f, 0.5f, 8f);
                    GameAudio.PlayAt("explosion", f.Center, 1f, 0.5f);
                }
                return;
            }
            float rise = EaseOutCubic(Span(t, 2.2f, 3.6f)), hop = EaseInOut(Span(t, 3.6f, 4.6f));
            if (hop >= 1f) LandWarp();
            var risen = diveAt;
            risen.y = FloorY - 9f + 13f * rise;
            var p = Vector3.Lerp(risen, landAt, hop);
            p.y = Mathf.Lerp(risen.y, landAt.y, hop) + Mathf.Sin(Mathf.PI * hop) * 3f;
            ApplyOffset(p - transform.position);
            if (Crossed(2.4f))
            {
                // 玄铁鳞片炸飞
                Fx.Burst(p + Vector3.up * 2f, QilinDef.ScaleDark, 60, 14f, 1.4f, 0.4f, 14f);
                Fx.Burst(p + Vector3.up * 2f, QilinDef.Hot, 40, 10f, 1f, 0.35f, 4f);
                Shake(0.6f, 0.8f);
            }
            if (Crossed(3.6f)) PlayAct("leap", 1f);
            if (Crossed(3.8f)) PlaySfx("boss_roar", 1f, 1.2f);
        }

        /// <summary>跃回岸上落地：角色胶囊瞬移到上岸点（贴导航网格后的点记回 landAt，模型偏移跟着归零）</summary>
        void LandWarp()
        {
            if (landWarped) return;
            landWarped = true;
            WarpTo(landAt);
            landAt = transform.position;
        }

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            if (phase != null && phase.form == QilinDef.BurnForm) LandWarp();
            ApplyOffset(Vector3.zero);
            if (Effects) Effects.Eruption(0);
            if (!IsBurn) return;
            // 落在岸上之后踏云升空（第一招熔流轮转飞向池心上空）
            skyVel = Vector3.zero;
            SkyTarget = SkyAlt;
            var f = Furnace;
            orbit = f ? f.YawOf(transform.position) : 0;
            orbitTimer = Random.Range(5f, 9f);
        }

        protected override void OnFormChanged(BossFormDef previous, BossFormDef next)
        {
            if (previous != null && Model != null)
                foreach (var m in models)
                    if (m != Model && m.root)
                        m.root.transform.localPosition = Vector3.zero;
            CacheBones();
            if (Model?.rig) Model.rig.feetIK = false;
            // 换形发生在转换演出这一帧的 TransitionTick 之后：新模型立刻放到熔岩下面（池心），免得在上岸点闪一帧
            if (Transitioning)
            {
                var under = diveAt;
                under.y = FloorY - 9f;
                ApplyOffset(under - transform.position);
            }
            if (next == null || next.id != QilinDef.BurnForm) return;
            // 玄铁鳞甲炸飞
            hp.armor = 0;
            EndCrack();
            // 踏云：不走导航（位置由 StepSky 积分；演出里还是根节点偏移 + 瞬移）
            if (agent) agent.enabled = false;
            skyVel = desiredVel = Vector3.zero;
            hasDesired = skyPlaced = false;
            SkyTarget = 0;
            Flood ??= new QilinFlood(this);
            GameUI.Toast("火麒麟化为焚身——它会在半空踏云奔跑；三次俯冲后落地喘息，胸口火心和角根火珠是弱点", Hex.Rgb(0xffb070), 3.5f);
        }

        /// <summary>狂怒（15%）：焚身排上狂怒长啸（火浪、熔流重开且更快）；熔流轮转、俯冲蓄势、火云雨在狂怒里本来就按狂怒的数值走</summary>
        protected override void OnEnrage(string reason)
        {
            if (!IsBurn) return;
            QueueMove(BurnRage.MoveId);
        }

        /// <summary>
        /// 招式间隙：玄鳞沿外环跑道小跑，绕到玩家那一侧（玩家方位 ± 34°，每步最多 20°），到位了就停下盯着玩家；
        /// 焚身在外环跑道上空绕殿弧线奔跑（<see cref="SkyIdle"/>）
        /// </summary>
        protected override void Idle(float dt)
        {
            var f = Furnace;
            if (IsBurn)
            {
                SkyIdle(dt);
                return;
            }
            if (!IsXuan || !f)
            {
                base.Idle(dt);
                return;
            }
            float me = f.YawOf(transform.position), pa = f.YawOf(PlayerPosition);
            float want = pa + 34.4f * (Mathf.DeltaAngle(pa, me) >= 0 ? 1f : -1f);
            float step = Mathf.Clamp(Mathf.DeltaAngle(me, want), -20f, 20f);
            float r = f.RadiusOf(transform.position);
            if (Mathf.Abs(Mathf.DeltaAngle(me, want)) > 8.6f || Mathf.Abs(r - f.trackRadius) > 1.5f)
            {
                MoveToward(f.Point(me + step, f.trackRadius));
                FaceAimTravel(180f, dt, 0.4f);
            }
            else
            {
                Halt();
                Face(PlayerPosition, 115f, dt);
            }
        }

        protected override void OnDefeated(DamageInfo info)
        {
            ApplyOffset(Vector3.zero);
            EndCrack();
            if (Sipping) EndSip();
            foreach (var l in locks)
                if (l)
                    l.Purge();
            if (Effects) Effects.Burst(0.5f);
            PlayAct("stun", Def != null ? Def.defeat.seconds : 3.4f);
            // 焚身：熔流退回地下、火心熄灭；还在半空就落到地上（本组件已停用，协程照跑）
            Flood?.Stop();
            HeartBright = false;
            if (heartFx) heartFx.gameObject.SetActive(false);
            var loco = Model?.locomotion;
            if (loco) loco.speedOverride = -1f;
            if (IsBurn && Altitude > 0.3f && gameObject.activeInHierarchy) StartCoroutine(FallToFloor());
        }

        /// <summary>倒下时从半空落到地上（0.55 s 加速下落，落地震一下）</summary>
        System.Collections.IEnumerator FallToFloor()
        {
            var from = transform.position;
            var to = LandingSpot(from);
            if (Mathf.Abs(to.y - FloorY) > 1.5f) to = OnFloor(from);
            const float dur = 0.55f;
            for (float t = 0; t < dur; t += Time.deltaTime)
            {
                float k = t / dur;
                var p = Vector3.Lerp(from, to, k);
                p.y = Mathf.Lerp(from.y, to.y, k * k);
                transform.position = p;
                yield return null;
            }
            transform.position = to;
            CameraShake.Quake(to, 0.5f, 50f, 0.4f);
            Fx.Burst(to + Vector3.up * 0.4f, QilinDef.Ember, 30, 8f, 0.8f, 0.3f, 10f);
        }

        // ───────────── 工具 ─────────────

        public static float Span(float t, float a, float b) => Mathf.Clamp01((t - a) / Mathf.Max(1e-4f, b - a));
        public static float EaseInOut(float k) => k * k * (3f - 2f * k);
        public static float EaseOutCubic(float k) => 1f - Mathf.Pow(1f - k, 3f);

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v;
        }
    }
}
