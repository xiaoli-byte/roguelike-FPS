using System;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 帝江（第四章近战·自爆；combat 3.7，设计单第 7 节）：「浑敦无面目，是识歌舞」的红皮囊，六足四翼，两到四只一群。太轻：不硬直，被打退半步。
    ///   · 歌舞（移动）：一边转圈一边蹦着过来，15 m 外每 0.5 s 一蹦、8–15 m 每 0.33 s、8 m 内每 0.25 s——鼓点越来越快（每次落地一小圈尘 + 两颗紫红火花）；
    ///     前面挡着走不过去时一大跳（2.2 m 高、多跳 2.5 m）跃过矮掩体或河。
    ///   · 球雷 <c>swell</c>（贴到 2.5 m）：原地越转越快、胀大 1.5 倍、白闪越来越快 0.8 s → 炸成 4 m 球状闪电，22 + 击退，自己死。胀大时带电。
    ///   · 爆囊（被打死）：炸 4 m，对周围敌人 40、对 2.5 m 内的玩家 10；6 m 内的帝江 0.15 s 后一个接一个引爆。被火打死的是一团紫红火球。
    /// </summary>
    public sealed class DijiangAI : PlateauEnemyAI
    {
        public const float SwellRange = 2.5f, SelfRadius = 4f, SelfDamage = 22f, PopRadius = 4f, PopFoeDamage = 40f, PopPlayerRadius = 2.5f, PopPlayerDamage = 10f;
        public const float ChainRadius = 6f, ChainDelay = 0.15f, HopHigh = 2.2f;

        public bool Popped { get; private set; }
        public bool SelfPop { get; private set; }
        public int Hops { get; private set; }
        public int BigHops { get; private set; }

        Transform bodyBone;
        Vector3 bodyRest = Vector3.one, hopFrom, hopTo;
        float hopT, hopLen = 0.5f, hopH = 0.6f, spinYaw, swellK, chainAt = -1;
        IDisposable swellHold;
        Renderer[] renderers;

        protected override void Awake()
        {
            glowBoneName = "core";
            glowSize = 1.2f;
            sight = 30f;
            centerY = 0.5f;
            base.Awake();
            bodyBone = Bone("body");
            if (bodyBone) bodyRest = bodyBone.localScale;
            renderers = GetComponentsInChildren<Renderer>(true);
            hp.Damaged += (info, r) =>
            {
                // 太轻：被打退半步
                if (r.total > 0 && !Dead && info.source != DamageSource.Status)
                {
                    var d = transform.position - (info.point.sqrMagnitude > 0 ? info.point : PlayerPos);
                    d.y = 0;
                    if (d.sqrMagnitude > 1e-4f) hopTo += d.normalized * 0.12f;
                }
            };
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            hopFrom = hopTo = transform.position;
        }

        protected override void Fight(float dt, float dist)
        {
            if (chainAt > 0) return;
            if (dist < SwellRange * Mathf.Max(1, Size / 1.2f) && TakeToken(PlateauPack.Token.Melee, AttackTokens.Kind.Melee, 1.2f))
            {
                Begin(PlateauMoves.DijiangSwell);
                return;
            }
            Dance(dt, dist);
        }

        /// <summary>歌舞：一蹦一蹦地过来，越近蹦得越快</summary>
        void Dance(float dt, float dist)
        {
            if (!dancing)
            {
                dancing = true;
                hopFrom = hopTo = transform.position;
                BeginManualMotion(Vector3.zero, 0);
            }
            hopT += dt * SpeedMult * HasteMult;
            float interval = dist > 15 ? 0.5f : dist > 8 ? 0.33f : 0.25f;
            if (hopT >= hopLen)
            {
                // 落地：鼓点（一小圈尘 + 两颗紫红火花）
                Fx.Play("ToonDust", transform.position + Vector3.up * 0.03f, Vector3.up, PlateauPalette.Dust, 0.5f);
                Fx.PlateauSparks(transform.position + Vector3.up * 0.2f, 2, 1.5f, 0.05f);
                hopT = 0;
                hopLen = interval;
                hopFrom = transform.position;
                float step = moveSpeed * interval;
                var to = PlayerPos - transform.position;
                to.y = 0;
                float a = Mathf.Atan2(to.x, to.z) + Random.Range(-0.25f, 0.25f);
                var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                float len = Mathf.Min(step, Mathf.Max(0.5f, dist - 1.5f));
                var next = transform.position + dir * len;
                hopH = 0.6f;
                if (NavMesh.Raycast(transform.position, next, out var hit, NavMesh.AllAreas))
                {
                    // 挡着：前面 1.2 m 以下的矮掩体 / 河——往前多跳 2.5 m、跳 2.2 m 高；跳不过去就按路径走下一个路点
                    var far = transform.position + dir * (step + 2.5f);
                    bool low = !Physics.Raycast(transform.position + Vector3.up * 1.4f, dir, step + 2.5f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
                    if (low && NavMesh.SamplePosition(far, out var land, 1f, NavMesh.AllAreas))
                    {
                        next = land.position;
                        hopH = HopHigh;
                        hopLen = interval * 1.8f;
                        BigHops++;
                    }
                    else
                    {
                        var path = new NavMeshPath();
                        next = NavMesh.CalculatePath(transform.position, PlayerPos, NavMesh.AllAreas, path) && path.corners.Length > 1
                            ? transform.position + Vector3.ClampMagnitude(path.corners[1] - transform.position, step)
                            : hit.position;
                    }
                }
                next.y = Ground(next);
                hopTo = next;
                Hops++;
            }
            float k = Mathf.Clamp01(hopT / hopLen);
            var p = Vector3.Lerp(hopFrom, hopTo, k);
            p.y = Mathf.Lerp(hopFrom.y, hopTo.y, k) + hopH * 4 * k * (1 - k);
            transform.position = p;
            // 一边转圈一边往前
            spinYaw += dt * 5f;
            float face = Mathf.Atan2(PlayerPos.x - p.x, PlayerPos.z - p.z) + Mathf.Sin(spinYaw) * 1.2f;
            transform.rotation = Quaternion.Euler(0, face * Mathf.Rad2Deg, 0);
            Loco();
        }

        bool dancing;

        protected override void OnStunned() => dancing = false;

        protected override void OnMoveBegin(PlateauMove m)
        {
            if (m.id == "swell")
            {
                // 落地站定，原地转圈
                var p = transform.position;
                p.y = Ground(p);
                transform.position = p;
                swellHold = Charge.Hold(hp, this);
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            if (id != "swell") return;
            if (evt == "warn") Warn(Telegraph.Circle(transform.position, SelfRadius, PlateauMoves.DijiangSwell.windup / HasteMult, TelegraphPalette.Danger));
            else if (evt == "hit") Pop(true);
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            if (Move.Id != "swell") return;
            swellK = stage == MoveStage.Windup ? k : 1f;
            spinYaw += dt * (6f + 14f * swellK);
            transform.rotation = Quaternion.Euler(0, spinYaw * Mathf.Rad2Deg, 0);
            // 白闪越来越快
            float f = 0.4f + 0.4f * Mathf.Sin(Move.T * (10f + 30f * swellK));
            body.SetOverlay("dijiang.swell", PlateauPalette.Core, Mathf.Clamp01(f) * 0.6f);
        }

        protected override void LateUpdate()
        {
            base.LateUpdate();
            if (!bodyBone || Dead) return;
            // 胀大：采样不记骨骼缩放，这里在动画之后缩 body 骨
            float g = Move.Id == "swell" ? swellK : 0;
            bodyBone.localScale = bodyRest * (1f + 0.5f * g);
        }

        protected override void Update()
        {
            base.Update();
            if (!Dead && chainAt > 0 && Time.time >= chainAt)
            {
                chainAt = -1;
                Pop(false);
            }
        }

        /// <summary>
        /// 炸：self = 自己胀爆（打玩家 22），否则是被打死的爆囊（打周围敌人 40、打 2.5 m 内的玩家 10）；6 m 内的帝江 0.15 s 后接着引爆
        /// </summary>
        public void Pop(bool self)
        {
            if (Popped) return;
            Popped = true;
            SelfPop = self;
            var at = Center;
            bool fire = EnemyStatus.IsBurning(hp);
            Fx.PlateauBallLightning(at, (self ? SelfRadius : PopRadius) * 0.9f, fire);
            Fx.Burst(at, PlateauPalette.Skin, 14, 7f, 0.6f, 0.14f, 10);
            Quake(0.3f, 20f);
            float dist = Vector3.Distance(PlateauPack.Flat(PlayerPos), PlateauPack.Flat(transform.position));
            if (self)
            {
                if (dist < SelfRadius && !PlayerInvulnerable)
                    Strike(SelfDamage, at, Element.Shock, PlateauGeo.Knock(PlayerPos, transform.position, 10f, 5f));
            }
            else if (dist < PopPlayerRadius && !PlayerInvulnerable)
                Strike(PopPlayerDamage, at, Element.None, PlateauGeo.Knock(PlayerPos, transform.position, 6f, 3f));
            foreach (var e in EnemyAI.All.ToArray())
            {
                if (!e || e == this || e.Dead) continue;
                float d = Vector3.Distance(e.transform.position, transform.position);
                if (!self && d < PopRadius)
                {
                    var info = DamageInfo.Simple(PopFoeDamage, DamageSource.Explosion, e.transform.position + Vector3.up * 0.5f, (e.transform.position - at).normalized);
                    info.tags = DamageTag.Explosion;
                    info.knockback = 4f;
                    Combat.DamageEnemy(e.Health, info);
                }
                if (e is DijiangAI dj && !dj.Popped && d < ChainRadius && dj.chainAt < 0) dj.chainAt = Time.time + ChainDelay;
            }
            if (!Dead)
            {
                var info = DamageInfo.Simple(hp.health + hp.armor + hp.shield + 1, DamageSource.Explosion, at, Vector3.up);
                info.tags = DamageTag.Explosion;
                info.noCrit = true;
                hp.noReward = self;
                hp.Kill(info);
            }
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            swellHold?.Dispose();
            swellHold = null;
            body.ClearOverlay("dijiang.swell");
            // 被打死（不是自己胀爆）：爆囊
            if (!Popped) Pop(false);
            // 都是炸：皮囊不留尸体
            foreach (var r in renderers)
                if (r)
                    r.enabled = false;
            var rag = GetComponent<Spiritfire.Art.CreatureRagdoll>();
            if (rag)
                foreach (var p in rag.parts)
                    if (p.body)
                        p.body.isKinematic = true;
        }

        protected override void OnInterrupt(string id)
        {
            if (id == "swell")
            {
                swellHold?.Dispose();
                swellHold = null;
                body.ClearOverlay("dijiang.swell");
            }
        }

        /// <summary>强制胀爆（试玩套件 / 节拍条）</summary>
        public void ForceSwell()
        {
            Notice(false);
            Begin(PlateauMoves.DijiangSwell);
        }
    }
}
