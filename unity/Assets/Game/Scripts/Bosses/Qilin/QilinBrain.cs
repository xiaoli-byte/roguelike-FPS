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
    ///     1.9 s 在熔岩柱里换成焚身（框架换形；角色胶囊瞬移到熔池另一侧的落点），2.2 s 起从熔岩里冲出、跃回岸上；鳞甲炸飞（护甲清零）。
    ///   · 走位：玄鳞在外环跑道上小跑、绕到玩家那一侧（TS idle）；焚身先用框架默认的保持距离（BS5 换成踏云绕殿）。
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

        static readonly string[] CrackZones = { "head", "neck", "chest", "back", "hips" };
        static readonly string[] HoofBones = { "fhoof_L", "hhoof_R", "fhoof_R", "hhoof_L" };

        readonly List<QilinLock> locks = new();
        readonly List<HazardZone> prints = new();
        readonly HashSet<string> told = new();
        readonly Transform[] hooves = new Transform[4];
        Transform jaw, head, chest, hips;
        int pendingCorner = -1;
        bool wastedPending, introRoared, landWarped, wired;
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

        /// <summary>瞬移到 p（贴导航网格；招式间的走位，不经过脚本位移）</summary>
        public void WarpTo(Vector3 p)
        {
            if (NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas)) p = hit.position;
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
            // 火珠：平时微光；人立、被砸晕、鳞甲崩裂时大亮
            bool bright = Staggered || Cracked || (Current is ScaleBlades && Current.Stage == MoveStage.Windup);
            pearlGlow += ((bright ? 1f : 0.35f) - pearlGlow) * Mathf.Min(1f, dt * 4f);
            Glow(0, pearlGlow * (0.75f + 0.25f * Mathf.Sin(Time.time * 5f)));
            ManeHeat = Mathf.Max(0, ManeHeat - dt * 0.02f);
        }

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
            landAt = c + toPlayer.normalized * ((f ? f.poolRadius : 7f) + 4.5f);
            landAt.y = FloorY;
            landWarped = false;
            transPrev = -1;
        }

        /// <summary>
        /// 化焚身（TS transitionTick）：0.2–1.1 s 跃向池心、1.1–1.9 s 沉下去；熔岩柱 1.0 → 1.6 s 冲满、保持到 3.4 s、4.6 s 落下；
        /// 1.9 s 框架换形时角色胶囊瞬移到上岸点；2.2–3.6 s 从熔岩里冲出、3.6–4.6 s 跃回岸上
        /// </summary>
        protected override void TransitionTick(float t, float dt)
        {
            float was = transPrev;
            transPrev = t;
            bool Crossed(float x) => was < x && t >= x;
            var f = Furnace;
            float col = t < 1f ? 0 : t < 1.6f ? (t - 1f) / 0.6f : t < 3.4f ? 1f : Mathf.Max(0, 1f - (t - 3.4f) / 1.2f);
            if (Effects) Effects.Eruption(col, true);
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
            if (!landWarped)
            {
                landWarped = true;
                WarpTo(landAt);
            }
            float rise = EaseOutCubic(Span(t, 2.2f, 3.6f)), hop = EaseInOut(Span(t, 3.6f, 4.6f));
            var risen = diveAt;
            risen.y = FloorY - 9f + 13f * rise;
            var p = Vector3.Lerp(risen, transform.position, hop);
            p.y = Mathf.Lerp(risen.y, transform.position.y, hop) + Mathf.Sin(Mathf.PI * hop) * 3f;
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

        protected override void OnTransitionEnd(BossPhaseDef phase)
        {
            ApplyOffset(Vector3.zero);
            if (Effects) Effects.Eruption(0);
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
            GameUI.Toast("火麒麟化为焚身——角根火珠与胸口火心是弱点", Hex.Rgb(0xffb070), 3.5f);
        }

        /// <summary>
        /// 招式间隙：玄鳞沿外环跑道小跑，绕到玩家那一侧（玩家方位 ± 34°，每步最多 20°），到位了就停下盯着玩家；
        /// 焚身（BS5 之前）用框架默认的保持距离
        /// </summary>
        protected override void Idle(float dt)
        {
            var f = Furnace;
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
