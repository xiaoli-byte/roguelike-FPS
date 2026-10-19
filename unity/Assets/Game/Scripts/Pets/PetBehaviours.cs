using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一只灵宠的能力（docs/pet-system.md 第 4 节）：普攻（<see cref="Attack"/>，按 AttackInterval 由 <see cref="Pet"/> 调度）、
    /// 被动（<see cref="OnBind"/> 登记、<see cref="Tick"/> 每帧）、灵技 G（<see cref="Skill"/>，冷却由 Pet 管）、3 级觉醒（<see cref="OnAwaken"/>）。
    /// 玩家身上的加成一律登记在来源 "pet:&lt;id&gt;" 下；静态事件、<see cref="Combat.OutgoingModifiers"/> 在 <see cref="Unbind"/> 里撤掉
    /// （静态列表跨场景存活，漏撤会一直生效）。数值为灵契 1 级，伤害再乘 <see cref="Pet.DamageMult"/>。
    /// 动作：出手时 <see cref="Pet.PlayAct"/>（状态名见 docs/pet-system.md 7.3），玩法时机仍由这里的代码决定；
    /// 程序前冲 / 甩尾照常叠上（骨骼动画灵宠的前冲自动缩小，占位体全靠它们动）。特效出处优先用挂点（<see cref="Pet.SocketPos"/>）。
    /// </summary>
    public abstract class PetBehaviour
    {
        protected Pet pet;
        protected PetDef Def => pet.def;
        protected string Source => "pet:" + pet.def.id;
        protected PetOwner Owner => pet.Owner;
        protected PlayerVitals Vitals => pet.Owner ? pet.Owner.Vitals : null;
        protected StatSheet Stats => Vitals ? Vitals.stats : null;
        protected Vector3 PlayerPos => pet.Owner ? pet.Owner.transform.position : pet.transform.position;
        protected Color Fx => pet.def.fx;

        public virtual float AttackInterval => 1f;
        public virtual float AttackRange => 2f;

        public void Bind(Pet p)
        {
            pet = p;
            OnBind();
        }

        protected virtual void OnBind() { }

        /// <summary>撤销被动（可重复调用）</summary>
        public virtual void Unbind() => Stats?.Remove(Source);

        public virtual void Tick(float dt) { }
        /// <summary>交战时站哪儿；null = 留在跟随位</summary>
        public virtual Vector3? EngagePoint(Damageable target) => null;
        public virtual bool CanAttack(Damageable t) => pet.DistTo(t) <= AttackRange && pet.Sees(t);
        public abstract void Attack(Damageable target);
        /// <summary>灵技：返回 false 表示没放出去（不进冷却）</summary>
        public abstract bool Skill();
        public virtual void OnAwaken() { }

        // ── 工具 ──
        /// <summary>站在目标朝灵宠这一侧、离它身体表面 dist 米处</summary>
        protected Vector3 Approach(Damageable t, float dist)
        {
            dist += Pet.RadiusOf(t);
            var c = t.transform.position;
            var from = pet.transform.position - c;
            from.y = 0;
            if (from.sqrMagnitude < 0.01f) from = PlayerPos - c;
            from.y = 0;
            return c + (from.sqrMagnitude > 0.01f ? from.normalized : Vector3.forward) * dist;
        }

        protected static Vector3 Flatten(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }

        /// <summary>离玩家 range 内、离 near 最近的若干个敌人</summary>
        protected List<Damageable> EnemiesAround(Vector3 near, float range, float playerRange)
        {
            var list = Pet.EnemiesNear(near, range);
            list.RemoveAll(d => Pet.Flat(d.transform.position - PlayerPos) > playerRange);
            return list;
        }

        protected void NoTarget() => pet.Say("没有目标", new Color(0.8f, 0.8f, 0.8f), 0.9f);
    }

    // ═════════════ 凡灵 ═════════════

    /// <summary>当康：冲撞眩晕；清场后拱出一袋灵石；灵技「丰年冲」沿准星冲 18 米</summary>
    public sealed class DangkangBehaviour : PetBehaviour
    {
        const float ChargeRange = 12, ChargeDamage = 22, ChargeStun = 0.5f, AwakenStun = 0.3f, ChargeSpeed = 16;
        const float RushLength = 18, RushDamage = 90, RushStun = 1.2f, RushSpeed = 26, RushWidth = 1.6f;

        public override float AttackInterval => 2.4f;
        public override float AttackRange => ChargeRange;
        float Stun(float s) => s + (pet.Awakened ? AwakenStun : 0);

        protected override void OnBind() => EncounterSite.AnySiteCleared += OnSiteCleared;

        public override void Unbind()
        {
            EncounterSite.AnySiteCleared -= OnSiteCleared;
            base.Unbind();
        }

        public override Vector3? EngagePoint(Damageable t) =>
            Pet.Flat(t.transform.position - pet.transform.position) > 9f ? Approach(t, 6f) : pet.transform.position;

        public override void Attack(Damageable t) => pet.Act(Charge(t));

        IEnumerator Charge(Damageable t)
        {
            var dir = Flatten(t.transform.position - pet.transform.position);
            pet.PlayAct("chargeWindup", 0.18f);
            pet.Lunge(-dir, 0.25f, 0.25f); // 蓄力后坐
            ShotFx.Instance?.Impact(pet.transform.position, Vector3.up, false, 0.8f);
            yield return new WaitForSeconds(0.18f);
            if (!t || t.Dead) yield break;
            var c = t.transform.position;
            dir = Flatten(c - pet.transform.position);
            float reach = Pet.Flat(c - pet.transform.position);
            float run = Mathf.Max(0, reach - 0.6f - Pet.RadiusOf(t));
            float dust = 0;
            var dashFrom = pet.transform.position;
            // 冲撞片段（蓄力之后接着播）对到冲刺 + 撞上的时长
            pet.PlayAct("ram", run / ChargeSpeed + 0.2f);
            yield return pet.DashTo(pet.transform.position + dir * run, ChargeSpeed, (a, b) =>
            {
                dust += Vector3.Distance(a, b);
                if (dust < 0.8f) return;
                dust = 0;
                ShotFx.Instance?.Impact(b, Vector3.up, false, 0.5f);
            }, 1.2f);
            if (!t || t.Dead || pet.DistTo(t) > 1.8f) yield break;
            pet.PlayAct("ram"); // 撞上：冲撞片段还在播就不重来
            pet.Lunge(dir, 0.45f, 0.2f);
            pet.Hit(t, ChargeDamage, knockback: 4);
            EnemyStatus.Stun(t, Stun(ChargeStun));
            ShotFx.Instance?.Impact(Pet.CenterOf(t), -dir, false, 2f);
            PetFx.Burst(Pet.CenterOf(t), Fx, 1.4f, 0.3f);
            PetFx.Beam(dashFrom + Vector3.up * 0.4f, pet.transform.position + Vector3.up * 0.4f, Fx, 0.12f, 0.25f);
            yield return new WaitForSeconds(0.15f);
        }

        void OnSiteCleared(EncounterSite site)
        {
            if (pet) pet.StartCoroutine(Harvest());
        }

        /// <summary>丰穰：拱一拱地，拱出一袋灵石（觉醒附带回血球），稍后吸向玩家</summary>
        IEnumerator Harvest()
        {
            yield return new WaitForSeconds(0.6f);
            if (!pet) yield break;
            pet.PlayAct("dig", 0.6f, priority: true);
            for (int i = 0; i < 3; i++)
            {
                pet.Lunge(pet.transform.forward + Vector3.down * 0.6f, 0.25f, 0.18f);
                ShotFx.Instance?.Impact(pet.transform.position + pet.transform.forward * 0.4f, Vector3.up, false, 1.2f);
                yield return new WaitForSeconds(0.2f);
            }
            var at = pet.transform.position + pet.transform.forward * 0.5f + Vector3.up * 0.3f;
            int amount = Random.Range(20, 36);
            LootDirector.DropCoins(at, amount, 1.2f);
            if (pet.Awakened) Pickup.Spawn(Pickup.Kind.Health, at, 0, 0.8f);
            PetFx.Burst(pet.SocketPos("coin", pet.Center), new Color(1f, 0.85f, 0.4f), 1.2f, 0.35f); // 铜钱坠一闪
            pet.Say($"丰穰 +{amount}", new Color(1f, 0.85f, 0.4f), 1.2f);
            Telegraph.Wave(at, 2.5f, 8f, new Color(1f, 0.85f, 0.4f));
            yield return new WaitForSeconds(1.1f);
            Pickup.Vacuum();
        }

        public override bool Skill()
        {
            var dir = Owner.Forward;
            var right = new Vector3(dir.z, 0, -dir.x);
            var start = PlayerPos + right * 0.9f + dir * 0.5f;
            Telegraph.Line(start, start + dir * RushLength, RushWidth * 2, 0.35f, Fx);
            pet.Act(Rush(start, dir));
            return true;
        }

        IEnumerator Rush(Vector3 start, Vector3 dir)
        {
            if (Pet.Flat(pet.transform.position - start) > 1.5f) pet.Teleport(start);
            pet.Say("丰年冲！", Fx, 1.2f);
            pet.PlayAct("chargeWindup", 0.2f, priority: true);
            pet.Lunge(-dir, 0.3f, 0.2f);
            yield return new WaitForSeconds(0.2f);
            pet.PlayAct("ram", RushLength / RushSpeed, priority: true);
            var hit = new HashSet<Damageable>();
            float dust = 0;
            yield return pet.DashTo(pet.transform.position + dir * RushLength, RushSpeed, (a, b) =>
            {
                dust += Vector3.Distance(a, b);
                if (dust > 0.7f)
                {
                    dust = 0;
                    ShotFx.Instance?.Impact(b, Vector3.up, false, 0.8f);
                }
                foreach (var d in Pet.EnemiesNear(b, RushWidth + 1.5f, false))
                {
                    if (hit.Contains(d) || SegmentDistance(d.transform.position, a, b) > RushWidth) continue;
                    hit.Add(d);
                    pet.Hit(d, RushDamage, knockback: 8, from: a);
                    EnemyStatus.Stun(d, Stun(RushStun));
                    ShotFx.Instance?.Impact(Pet.CenterOf(d), dir, false, 3f);
                    ShotFx.Instance?.MuzzleFlash(Pet.CenterOf(d), 1.5f);
                    PetFx.Burst(Pet.CenterOf(d), Fx, 1.8f, 0.35f);
                }
            }, 1.4f);
        }

        static float SegmentDistance(Vector3 p, Vector3 a, Vector3 b)
        {
            p.y = a.y = b.y = 0;
            var ab = b - a;
            float t = ab.sqrMagnitude > 1e-6f ? Mathf.Clamp01(Vector3.Dot(p - a, ab) / ab.sqrMagnitude) : 0;
            return Vector3.Distance(p, a + ab * t);
        }
    }

    /// <summary>讙：三连爪击；每 10 秒学舌嘲讽 10 米内敌人 3 秒；灵技「百声惑」嘲讽 16 米 5 秒且受伤 +25%；觉醒被嘲讽者减速 30%</summary>
    public sealed class HuanBehaviour : PetBehaviour
    {
        const float ClawDamage = 4, MimicEvery = 10, MimicRadius = 10, MimicTime = 3, SkillRadius = 16, SkillTime = 5, SkillTaken = 1.25f, AwakenSlow = 0.3f;
        const int Claws = 3;
        static readonly string[] Phrases = { "这边！", "来打我呀～", "喵！", "看这儿看这儿！", "（学你说话）", "嘿，打不着！" };

        public override float AttackInterval => 1f;
        public override float AttackRange => 1.9f;
        float mimicTimer = 4f, cleanTimer;
        readonly Dictionary<Damageable, float> amplified = new();
        Func<Damageable, DamageInfo, float> modifier;

        protected override void OnBind()
        {
            modifier = (d, info) => amplified.TryGetValue(d, out var until) && Time.time < until ? SkillTaken : 1f;
            Combat.OutgoingModifiers.Add(modifier);
        }

        public override void Unbind()
        {
            if (modifier != null) Combat.OutgoingModifiers.Remove(modifier);
            modifier = null;
            if (pet) Decoys.Remove(pet.transform);
            base.Unbind();
        }

        public override Vector3? EngagePoint(Damageable t) => Approach(t, 1.2f);

        public override void Attack(Damageable t) => pet.Act(ClawRound(t));

        IEnumerator ClawRound(Damageable t)
        {
            for (int i = 0; i < Claws; i++)
            {
                if (!t || t.Dead) yield break;
                var dir = Pet.CenterOf(t) - pet.Center;
                pet.PlayAct("claw", 0.12f, restart: true, fade: 0.04f); // 每一爪从头播
                pet.Lunge(dir, 0.28f, 0.13f);
                pet.Hit(t, ClawDamage);
                ShotFx.Instance?.Impact(Pet.CenterOf(t), -dir.normalized, true, 0.5f);
                PetFx.Beam(Pet.CenterOf(t) + Vector3.up * 0.3f + pet.transform.right * (i - 1) * 0.15f, Pet.CenterOf(t) - Vector3.up * 0.3f, Fx, 0.03f, 0.1f);
                yield return new WaitForSeconds(0.12f);
            }
        }

        public override void Tick(float dt)
        {
            mimicTimer -= dt;
            if (mimicTimer <= 0)
                // 附近没有敌人就过 1 秒再看，学到了才进 10 秒间隔
                mimicTimer = Mimic(MimicRadius, MimicTime, false) > 0 ? MimicEvery : 1f;
            cleanTimer -= dt;
            if (cleanTimer <= 0 && amplified.Count > 0)
            {
                cleanTimer = 2f;
                var dead = new List<Damageable>();
                foreach (var (d, until) in amplified)
                    if (!d || d.Dead || Time.time >= until) dead.Add(d);
                foreach (var d in dead) amplified.Remove(d);
            }
        }

        /// <summary>夺百声：学玩家说话，radius 内敌人改打讙 seconds 秒（灵体：打它无效）</summary>
        int Mimic(float radius, float seconds, bool skill)
        {
            int n = 0;
            float eye = Mathf.Max(0.4f, pet.Height * 0.6f);
            foreach (var ai in EnemyAI.All.ToArray())
            {
                if (!ai || ai.Dead || !ai.Health || ai.Health.untargetable) continue;
                if (Pet.Flat(ai.transform.position - pet.transform.position) > radius) continue;
                ai.Taunt(pet.transform, seconds, eye);
                if (pet.Awakened) EnemyStatus.Slow(ai.Health, AwakenSlow, seconds);
                if (skill) amplified[ai.Health] = Time.time + seconds;
                n++;
            }
            if (n == 0 && !skill) return 0;
            if (n > 0) Decoys.Set(pet.transform, 0.55f, Mathf.Max(1.4f, pet.Height + 0.5f), Time.time + seconds);
            Telegraph.Wave(pet.transform.position, radius, radius * 2.4f, Fx);
            pet.PlayAct("taunt", 0, priority: skill);
            pet.Lunge(Vector3.up, 0.3f, 0.3f);
            pet.WhipTails();
            pet.Say(Phrases[Random.Range(0, Phrases.Length)], Fx, 1.1f);
            return n;
        }

        public override bool Skill()
        {
            if (Pet.EnemiesNear(pet.transform.position, SkillRadius, false).Count == 0)
            {
                NoTarget();
                return false;
            }
            Mimic(SkillRadius, SkillTime, true);
            pet.Say("百声惑！", new Color(1f, 0.85f, 0.5f), 1.4f);
            ShotFx.Instance?.MuzzleFlash(pet.Center, 2f);
            return true;
        }
    }

    /// <summary>精卫：飞到目标上空投火石；灵技「衔石填海」准星处 2 秒落 10 颗；觉醒火石范围 2.8 米</summary>
    public sealed class JingweiBehaviour : PetBehaviour
    {
        const float StoneDamage = 16, StoneBurn = 0.5f, RainDamage = 24, RainRadius = 5, Gravity = 22, PebbleRegrow = 0.6f, PebbleSize = 0.16f;
        const int RainCount = 10;
        static readonly Color Fire = new(1f, 0.45f, 0.12f);
        float Radius => pet.Awakened ? 2.8f : 2f;

        public override float AttackInterval => 1.3f;

        public override Vector3? EngagePoint(Damageable t)
        {
            var c = t.transform.position;
            var toPlayer = Flatten(PlayerPos - c);
            return new Vector3(c.x, PetFx.TopOf(t) + 2.6f, c.z) + toPlayer * 0.8f;
        }

        public override bool CanAttack(Damageable t) =>
            Pet.Flat(t.transform.position - pet.transform.position) < 2.6f && pet.transform.position.y > Pet.CenterOf(t).y + 0.8f && pet.Sees(t);

        public override void Attack(Damageable t)
        {
            var from = pet.PartPos(pet.SocketPos("pebble", pet.Mouth)); // 口中衔的火石
            var to = Pet.CenterOf(t);
            pet.PlayAct("drop");
            pet.Lunge(Vector3.down, 0.3f, 0.2f);
            pet.HidePart(PebbleRegrow); // 松口：嘴里的火石扔出去了，过一会儿再衔一颗
            DropStone(from, to, StoneDamage, StoneBurn, 0.35f);
        }

        void DropStone(Vector3 from, Vector3 to, float dmg, float burn, float flight)
        {
            var vel = EnemyProjectile.Ballistic(from, to, flight, Gravity);
            var info = pet.Info(dmg, Element.Fire, burn, to, Vector3.down);
            float r = Radius;
            var p = PlayerProjectile.Spawn(from, vel, info, 0.15f, flight + 1.5f, Gravity, r);
            Pebble().SetParent(p.transform, false);
            p.onImpact = at =>
            {
                ShotFx.Instance?.Impact(at, Vector3.up, true, 1.8f);
                ShotFx.Instance?.MuzzleFlash(at + Vector3.up * 0.3f, 0.8f);
                Telegraph.Wave(at, r, r * 7f, Fire);
            };
        }

        /// <summary>
        /// 火石：精卫衔的那颗发光件模型（Resources/Pets/Parts，放大到约 0.16 米好认），没有就用灰色小球；外加火光 + 余烬拖尾
        /// </summary>
        Transform Pebble()
        {
            GameObject go = PetVisuals.InstantiatePart(Def.partId);
            float scale;
            if (go)
            {
                go.transform.rotation = Random.rotation;
                var rs = go.GetComponentsInChildren<Renderer>();
                var b = rs.Length > 0 ? rs[0].bounds : new Bounds(go.transform.position, Vector3.one * PebbleSize);
                foreach (var rr in rs) b.Encapsulate(rr.bounds);
                scale = PebbleSize / Mathf.Max(1e-3f, Mathf.Max(b.size.x, b.size.y, b.size.z));
                go.transform.localScale = Vector3.one * scale;
            }
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                UnityEngine.Object.Destroy(go.GetComponent<Collider>());
                scale = PebbleSize;
                go.transform.localScale = Vector3.one * scale;
                var r = go.GetComponent<Renderer>();
                var block = new MaterialPropertyBlock();
                block.SetColor("_BaseColor", new Color(0.45f, 0.42f, 0.4f));
                r.SetPropertyBlock(block);
            }
            go.name = "Fire Pebble";
            FxMaterials.GlowSprite(go.transform, 0.8f / scale, new Color(Fire.r, Fire.g, Fire.b, 0.8f));
            var trail = go.AddComponent<TrailRenderer>();
            trail.time = 0.25f;
            trail.startWidth = 0.14f;
            trail.endWidth = 0;
            trail.sharedMaterial = FxMaterials.Additive;
            trail.startColor = new Color(1f, 0.7f, 0.3f, 0.9f);
            trail.endColor = new Color(1f, 0.3f, 0.1f, 0);
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go.transform;
        }

        public override bool Skill()
        {
            // 落点：准星落点往下找地面；朝天瞄（准星没打到东西、下方也没地面）就落在玩家前方 20 米
            var point = pet.AimPoint(60f);
            if (Physics.Raycast(point + Vector3.up * 2f, Vector3.down, out var g, 200f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                point = g.point;
            else
            {
                point = PlayerPos + Owner.Forward * 20f;
                point.y = Pet.GroundY(point + Vector3.up * 30f);
            }
            Telegraph.Circle(point, RainRadius, 2.4f, Fire);
            pet.Act(Rain(point));
            return true;
        }

        IEnumerator Rain(Vector3 point)
        {
            pet.Say("衔石填海！", Fire, 1.3f);
            yield return pet.DashTo(point + Vector3.up * 6f, 24f, null, 0.8f);
            for (int i = 0; i < RainCount; i++)
            {
                var c = Random.insideUnitCircle * RainRadius;
                var g = point + new Vector3(c.x, 0, c.y);
                g.y = Pet.GroundY(g + Vector3.up * 2f);
                var from = g + new Vector3(Random.Range(-1f, 1f), 9f, Random.Range(-1f, 1f));
                DropStone(from, g, RainDamage, 1f, 0.4f);
                pet.PlayAct("drop"); // 0.2 秒一颗：片段没播到 90% 就不重来
                pet.HidePart(PebbleRegrow); // 落完最后一颗 0.6 秒后嘴里才再有
                pet.Lunge(Vector3.down, 0.2f, 0.15f);
                yield return new WaitForSeconds(0.2f);
            }
        }
    }

    // ═════════════ 灵兽 ═════════════

    /// <summary>重明鸟：双瞳雷光；重瞳标记准星下的敌人（受伤 +15% / 觉醒 +25%）；灵技「辟邪」连锁闪电 8 跳</summary>
    public sealed class ChongmingBehaviour : PetBehaviour
    {
        const float BoltDamage = 9, BoltShock = 0.4f, Range = 20, Bounce = 8, ChainDamage = 60, ChainRange = 12;
        const int Bolts = 2, ChainHops = 8;
        static readonly Color Shock = DamageTable.ElementColor(Element.Shock);

        public override float AttackInterval => 0.7f;
        public override float AttackRange => Range;
        Damageable mark;
        float markHold;
        Transform marker;
        Func<Damageable, DamageInfo, float> modifier;
        float MarkBonus => pet.Awakened ? 1.25f : 1.15f;

        protected override void OnBind()
        {
            marker = PetFx.Marker(Shock, true);
            marker.gameObject.SetActive(false);
            modifier = (d, info) => d && d == mark && !d.Dead ? MarkBonus : 1f;
            Combat.OutgoingModifiers.Add(modifier);
        }

        public override void Unbind()
        {
            if (modifier != null) Combat.OutgoingModifiers.Remove(modifier);
            modifier = null;
            if (marker) UnityEngine.Object.Destroy(marker.gameObject);
            base.Unbind();
        }

        public override void Tick(float dt)
        {
            // 重瞳：准星指着的敌人；移开后保留 0.3 s，免得标记闪烁
            var aimed = pet.AimedEnemy(80f);
            if (aimed)
            {
                mark = aimed;
                markHold = Time.time + 0.3f;
            }
            else if (Time.time > markHold) mark = null;
            if (mark && mark.Dead) mark = null;
            if (!marker) return;
            marker.gameObject.SetActive(mark);
            if (mark)
            {
                var p = mark.transform.position;
                marker.position = new Vector3(p.x, PetFx.TopOf(mark) + 0.5f, p.z);
                marker.localScale = Vector3.one * ((pet.Awakened ? 1.15f : 1f) + Mathf.Sin(Time.time * 7f) * 0.08f);
            }
        }

        public override void Attack(Damageable t)
        {
            var c = Pet.CenterOf(t);
            pet.PlayAct("gaze");
            var eye = pet.SocketPos("eyefx", pet.Mouth); // 双瞳
            var eyeL = eye - pet.transform.right * 0.07f;
            var eyeR = eye + pet.transform.right * 0.07f;
            Lightning.Spawn(eyeL, c, Shock, 0.05f);
            Lightning.Spawn(eyeR, c, Shock, 0.05f);
            for (int i = 0; i < Bolts; i++) pet.Hit(t, BoltDamage, Element.Shock, BoltShock);
            pet.Lunge(c - pet.Center, 0.15f, 0.15f);
            if (!pet.Awakened) return;
            // 觉醒：雷光再弹一个敌人
            Damageable extra = null;
            foreach (var d in Pet.EnemiesNear(c, Bounce))
                if (d != t && !Combat.Blocked(c, Pet.CenterOf(d), d.GetComponent<Collider>())) { extra = d; break; }
            if (!extra) return;
            Lightning.Spawn(c, Pet.CenterOf(extra), Shock, 0.04f);
            for (int i = 0; i < Bolts; i++) pet.Hit(extra, BoltDamage, Element.Shock, BoltShock, from: c, depth: 1);
        }

        public override bool Skill()
        {
            var first = mark && !mark.Dead ? mark : pet.Target;
            if (!first)
            {
                var near = EnemiesAround(PlayerPos, 25f, 25f);
                if (near.Count > 0) first = near[0];
            }
            if (!first)
            {
                NoTarget();
                return false;
            }
            pet.StartCoroutine(Chain(first));
            return true;
        }

        /// <summary>辟邪：从重明鸟出发连跳 8 次，每跳 60 + 必定雷殛；敌人不够时可以跳回打过的</summary>
        IEnumerator Chain(Damageable first)
        {
            pet.Say("辟邪！", Shock, 1.3f);
            pet.PlayAct("cry", 0, priority: true);
            var visited = new HashSet<Damageable>();
            var from = pet.Mouth;
            var cur = first;
            for (int hop = 0; hop < ChainHops && cur; hop++)
            {
                var c = Pet.CenterOf(cur);
                Lightning.Spawn(from, c, Shock, 0.12f);
                pet.Hit(cur, ChainDamage, Element.Shock, 1f, from: from);
                ShotFx.Instance?.Impact(c, (from - c).normalized, false, 1.5f);
                visited.Add(cur);
                from = c;
                Damageable next = null, revisit = null;
                foreach (var d in Pet.EnemiesNear(c, ChainRange))
                {
                    if (d == cur || Combat.Blocked(c, Pet.CenterOf(d), d.GetComponent<Collider>())) continue;
                    if (!visited.Contains(d)) { next = d; break; }
                    revisit ??= d;
                }
                cur = next ? next : revisit;
                yield return new WaitForSeconds(0.09f);
            }
        }
    }

    /// <summary>狻猊：吐蚀香锥形持续伤害；护主（护盾上限 +20、破盾怒吼）；灵技「镇宅狮吼」；觉醒蚀香留下蚀雾</summary>
    public sealed class SuanniBehaviour : PetBehaviour
    {
        const float ConeRange = 6, ConeHalfAngle = 32, TickDamage = 4, CorrodeChance = 0.25f, ShieldBonus = 20;
        const float RoarShield = 30, RoarRadius = 5, RoarStun = 1, RoarCooldown = 15;
        const float SkillRadius = 10, SkillStun = 1.5f, SkillReduction = 0.4f, SkillBuff = 5;
        const float MistEvery = 1f, MistRadius = 2.2f, MistTime = 3f;
        static readonly Color Corrode = DamageTable.ElementColor(Element.Corrode);

        public override float AttackInterval => 0.25f;
        public override float AttackRange => ConeRange;
        float roarReady, buffUntil, mistTimer;
        ParticleSystem smoke;
        PetZone mist;
        PlayerVitals subscribed;
        string BuffSource => Source + ":roar";

        protected override void OnBind()
        {
            // 只加上限、不顺带回盾（否则反复换宠就能白回 20 护盾）
            var v = Vitals;
            float before = v ? v.shield : 0;
            Stats?.Add(Source, Stat.MaxShield, ShieldBonus);
            if (v) v.shield = Mathf.Min(before, v.MaxShield);
            subscribed = Vitals;
            if (subscribed) subscribed.ShieldBroken += OnShieldBroken;
            smoke = BuildSmoke();
        }

        public override void Unbind()
        {
            if (subscribed) subscribed.ShieldBroken -= OnShieldBroken;
            subscribed = null;
            Stats?.Remove(BuffSource);
            base.Unbind();
        }

        public override Vector3? EngagePoint(Damageable t) =>
            Pet.Flat(t.transform.position - pet.transform.position) > ConeRange - 1.5f ? Approach(t, 3.5f) : pet.transform.position;

        public override void Attack(Damageable t)
        {
            var mouth = pet.Mouth;
            var dir = (Pet.CenterOf(t) - mouth).normalized;
            pet.PlayAct("breathe"); // 0.25 秒一跳：片段没播到 90% 就不重来，连着吐就是一口长气
            if (smoke)
            {
                smoke.transform.SetPositionAndRotation(mouth, Quaternion.LookRotation(dir));
                smoke.Emit(5);
            }
            foreach (var d in Pet.EnemiesNear(mouth, ConeRange + 0.5f))
            {
                var to = Pet.CenterOf(d) - mouth;
                if (Vector3.Angle(dir, to) > ConeHalfAngle && to.magnitude > 1.2f) continue;
                if (Combat.Blocked(mouth, Pet.CenterOf(d), d.GetComponent<Collider>())) continue;
                pet.Hit(d, TickDamage, Element.Corrode, CorrodeChance, from: mouth);
            }
            // 觉醒：蚀香在目标脚下留一片蚀雾
            mistTimer -= AttackInterval;
            if (pet.Awakened && mistTimer <= 0)
            {
                mistTimer = MistEvery;
                var g = t.transform.position;
                g.y = Pet.GroundY(g + Vector3.up);
                // 目标还在上一片蚀雾里就续期，不叠第二片（同一处最多一片）
                if (mist && mist.Alive && Pet.Flat(t.transform.position - mist.transform.position) <= MistRadius) mist.Refresh(MistTime);
                else mist = PetZone.Spawn(pet, g, MistRadius, MistTime, TickDamage, Element.Corrode, CorrodeChance, Corrode);
            }
        }

        public override void Tick(float dt)
        {
            if (buffUntil > 0 && Time.time >= buffUntil)
            {
                buffUntil = 0;
                Stats?.Remove(BuffSource);
            }
        }

        /// <summary>护主：护盾被打破时怒吼——补 30 护盾、震晕玩家 5 米内的敌人 1 秒（15 秒冷却）</summary>
        void OnShieldBroken()
        {
            if (!pet || Time.time < roarReady || !Vitals || Vitals.Dead) return;
            roarReady = Time.time + RoarCooldown;
            Vitals.AddShield(RoarShield);
            foreach (var d in Pet.EnemiesNear(PlayerPos + Vector3.up, RoarRadius + 1f, false))
                if (Pet.Flat(d.transform.position - PlayerPos) <= RoarRadius) EnemyStatus.Stun(d, RoarStun);
            Telegraph.Wave(PlayerPos, RoarRadius, 16f, Corrode);
            pet.PlayAct("roar", 0, priority: true);
            pet.Lunge(PlayerPos - pet.transform.position, 0.3f, 0.25f);
            pet.Say("护主！", Corrode, 1.3f);
            Hud.Instance?.Toast($"狻猊怒吼：护盾 +{RoarShield:F0}", 1.6f);
        }

        public override bool Skill()
        {
            pet.Act(Roar());
            return true;
        }

        IEnumerator Roar()
        {
            // 离玩家远就先瞬移回身边再吼
            if (Pet.Flat(pet.transform.position - PlayerPos) > 5f) pet.Teleport(PlayerPos + Owner.Forward * 1.5f);
            pet.PlayAct("roar", 0, priority: true);
            pet.Lunge(-pet.transform.forward, 0.25f, 0.2f);
            yield return new WaitForSeconds(0.15f);
            var c = pet.transform.position;
            pet.Lunge(pet.transform.forward, 0.5f, 0.35f);
            pet.Say("镇宅狮吼！", Corrode, 1.4f);
            Telegraph.Wave(c, SkillRadius, 22f, Corrode);
            ShotFx.Instance?.MuzzleFlash(pet.Mouth, 2.5f);
            if (smoke)
            {
                // 香炉喷出一大团烟（没有 ember 挂点就从嘴里）
                smoke.transform.SetPositionAndRotation(pet.SocketPos("ember", pet.Mouth), Quaternion.LookRotation(Vector3.up));
                smoke.Emit(40);
            }
            foreach (var d in Pet.EnemiesNear(c + Vector3.up, SkillRadius + 1f, false))
            {
                if (Pet.Flat(d.transform.position - c) > SkillRadius) continue;
                EnemyStatus.Stun(d, SkillStun);
                Combat.ApplyElement(d, Element.Corrode, 40f * pet.DamageMult, 0, pet);
            }
            Stats?.Remove(BuffSource);
            Stats?.Add(BuffSource, Stat.DamageReduction, SkillReduction);
            buffUntil = Time.time + SkillBuff;
            Hud.Instance?.Toast($"伤害减免 +{SkillReduction * 100:F0}%（{SkillBuff:F0} 秒）", 1.8f);
            yield return new WaitForSeconds(0.3f);
        }

        ParticleSystem BuildSmoke()
        {
            var go = new GameObject("Incense");
            go.transform.SetParent(pet.transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = false;
            main.playOnAwake = false;
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.5f, 0.85f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(5f, 8.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.35f, 0.65f);
            main.startColor = new Color(Corrode.r, Corrode.g, Corrode.b, 0.5f);
            main.gravityModifier = -0.05f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = 300;
            var em = ps.emission;
            em.rateOverTime = 0;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 26;
            shape.radius = 0.08f;
            var sol = ps.sizeOverLifetime;
            sol.enabled = true;
            sol.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0, 0.6f, 1, 2.8f));
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(new Color(0.7f, 0.8f, 0.7f), 1) },
                new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(1, 0.15f), new GradientAlphaKey(0, 1) });
            col.color = g;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = FxMaterials.Glow;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return ps;
        }
    }

    /// <summary>狰：扑击 + 五尾连抽（吃玩家暴击率）；击石（附近击杀给射速）；灵技「五尾裂石」；觉醒一轮 7 尾</summary>
    public sealed class ZhengBehaviour : PetBehaviour
    {
        const float TailDamage = 7, PounceRange = 8, StoneRange = 6, StoneRate = 0.08f, StoneTime = 5, RendDamage = 100, RendRange = 18, RendSpeed = 34;
        const int StoneMax = 3, RendTargets = 5;
        int Tails => pet.Awakened ? 7 : 5;

        public override float AttackInterval => 1.4f;
        public override float AttackRange => PounceRange;
        readonly List<float> stacks = new();
        string StoneSource => Source + ":stone";

        protected override void OnBind() => Combat.EnemyKilled += OnKilled;

        public override void Unbind()
        {
            Combat.EnemyKilled -= OnKilled;
            Stats?.Remove(StoneSource);
            stacks.Clear();
            base.Unbind();
        }

        public override Vector3? EngagePoint(Damageable t) => Approach(t, 1.6f);

        public override void Attack(Damageable t) => pet.Act(Flurry(t));

        IEnumerator Flurry(Damageable t)
        {
            if (pet.DistTo(t) > 1.8f)
            {
                // 扑击：低伏一下再扑上去（片段对到伏身 + 扑过去的时长）
                var dir = Flatten(t.transform.position - pet.transform.position);
                float leap = Mathf.Min(0.6f, Mathf.Max(0, Pet.Flat(t.transform.position - pet.transform.position) - 0.9f - Pet.RadiusOf(t)) / 20f);
                pet.PlayAct("pounce", 0.12f + leap);
                pet.Lunge(-dir, 0.2f, 0.15f);
                yield return new WaitForSeconds(0.12f);
                if (!t || t.Dead) yield break;
                var dest = t.transform.position - Flatten(t.transform.position - pet.transform.position) * (0.9f + Pet.RadiusOf(t));
                yield return pet.DashTo(dest, 20f, null, 0.6f);
            }
            pet.PlayAct("tailLash", Tails * 0.07f, restart: true); // 五尾（觉醒七尾）连抽，片段对到整轮
            pet.WhipTails();
            var stats = Stats;
            for (int i = 0; i < Tails; i++)
            {
                if (!t || t.Dead || pet.DistTo(t) > 2.6f)
                {
                    // 目标倒了：顺手抽旁边的
                    var near = Pet.EnemiesNear(pet.Center, 3f);
                    if (near.Count == 0) yield break;
                    t = near[0];
                }
                bool crit = Random.value < (stats?.Get(Stat.CritChance) ?? 0.05f);
                var c = Pet.CenterOf(t);
                var side = pet.transform.right * (i % 2 == 0 ? 0.5f : -0.5f);
                PetFx.Beam(pet.Center - pet.transform.forward * 0.3f + side + Vector3.up * 0.4f, c, Fx, 0.05f, 0.12f);
                pet.Hit(t, TailDamage, forceCrit: crit);
                ShotFx.Instance?.Impact(c, (pet.Center - c).normalized, false, crit ? 1.5f : 0.7f);
                pet.Lunge(c - pet.Center, 0.12f, 0.08f);
                yield return new WaitForSeconds(0.07f);
            }
        }

        /// <summary>击石：狰附近 6 米内的击杀给玩家射速 +8%（5 秒，最多 3 层，层数各自计时）</summary>
        void OnKilled(Damageable d, DamageInfo info)
        {
            if (!pet || !d || d.noReward || Pet.Flat(d.transform.position - pet.transform.position) > StoneRange) return;
            stacks.Add(Time.time + StoneTime);
            if (stacks.Count > StoneMax) stacks.RemoveAt(0);
            Refresh();
            pet.Say($"击石 ×{stacks.Count}", Fx, 0.95f);
        }

        public override void Tick(float dt)
        {
            if (stacks.Count > 0 && stacks.RemoveAll(t => Time.time >= t) > 0) Refresh();
        }

        void Refresh()
        {
            var s = Stats;
            if (s == null) return;
            s.Remove(StoneSource);
            if (stacks.Count > 0) s.Add(StoneSource, Stat.FireRatePct, StoneRate * stacks.Count);
        }

        public override bool Skill()
        {
            // 从狰出发，每次挑离上一个最近的，最多 5 个
            var picked = new List<Damageable>();
            var from = pet.transform.position;
            for (int i = 0; i < RendTargets; i++)
            {
                Damageable best = null;
                float bestD = float.MaxValue;
                foreach (var d in EnemiesAround(from, RendRange * 1.5f, RendRange))
                {
                    if (picked.Contains(d)) continue;
                    float dist = Pet.Flat(d.transform.position - from);
                    if (dist < bestD) { bestD = dist; best = d; }
                }
                if (!best) break;
                picked.Add(best);
                from = best.transform.position;
            }
            if (picked.Count == 0)
            {
                NoTarget();
                return false;
            }
            pet.Act(Rend(picked));
            return true;
        }

        IEnumerator Rend(List<Damageable> targets)
        {
            pet.Say("五尾裂石！", Fx, 1.3f);
            pet.WhipTails();
            foreach (var t in targets)
            {
                if (!t || t.Dead) continue;
                var start = pet.transform.position;
                var dir = Flatten(t.transform.position - start);
                var dest = t.transform.position + dir * (1.2f + Pet.RadiusOf(t));
                // 每一次穿刺从头播裂石，片段对到这一段冲刺；残影沿角尖走（没有挂点就离地 0.5 米）
                pet.PlayAct("rend", Mathf.Min(0.7f, Pet.Flat(dest - start) / RendSpeed) + 0.1f, priority: true, restart: true, fade: 0.05f);
                var hornFrom = pet.SocketPos("horntip", start + Vector3.up * 0.5f);
                yield return pet.DashTo(dest, RendSpeed, null, 0.7f);
                PetFx.Beam(hornFrom, pet.SocketPos("horntip", pet.transform.position + Vector3.up * 0.5f), Fx, 0.12f, 0.3f);
                if (t && !t.Dead)
                {
                    pet.Hit(t, RendDamage, forceCrit: true, knockback: 6, from: start);
                    ShotFx.Instance?.Impact(Pet.CenterOf(t), dir, false, 3f);
                    ShotFx.Instance?.MuzzleFlash(Pet.CenterOf(t), 1.2f);
                }
                yield return new WaitForSeconds(0.06f);
            }
        }
    }

    // ═════════════ 神兽 ═════════════

    /// <summary>
    /// 白泽：万鬼图（玩家每一次命中都算弱点、暴击伤害 +50% / 觉醒 +80%）、洞悉（25 米内敌人受玩家伤害 +20%）、
    /// 金光三连射、灵技「白泽图」（30 米眩晕 1.5 秒、8 秒受伤 +60%、玩家技能冷却减半）、觉醒自动吸取 25 米掉落物
    /// </summary>
    public sealed class BaizeBehaviour : PetBehaviour
    {
        const float CritBonus = 0.5f, AwakenCritBonus = 0.8f, InsightRange = 25, InsightBonus = 1.2f;
        const float ShotDamage = 30, ShotRange = 25, ScrollRadius = 30, ScrollStun = 1.5f, ScrollTaken = 1.6f, ScrollTime = 8, VacuumRange = 25;
        const int Shots = 3;
        static readonly Color Gold = new(1f, 0.78f, 0.32f), GoldRed = new(1f, 0.45f, 0.3f);

        public override float AttackInterval => 1f;
        public override float AttackRange => ShotRange;
        Func<Damageable, DamageInfo, bool> weakpoint;
        Func<Damageable, DamageInfo, float> modifier;
        readonly Dictionary<Damageable, float> exposed = new();
        float vacuumTimer, cleanTimer;

        protected override void OnBind()
        {
            weakpoint = (d, info) => true;
            Combat.ForceWeakpoint.Add(weakpoint);
            modifier = (d, info) =>
            {
                float m = 1;
                if (info.source != DamageSource.Pet && d && Pet.Flat(d.transform.position - PlayerPos) <= InsightRange) m *= InsightBonus;
                if (d && exposed.TryGetValue(d, out var until) && Time.time < until) m *= ScrollTaken;
                return m;
            };
            Combat.OutgoingModifiers.Add(modifier);
            ApplyCrit();
        }

        public override void OnAwaken() => ApplyCrit();

        void ApplyCrit()
        {
            var s = Stats;
            if (s == null) return;
            s.Remove(Source);
            s.Add(Source, Stat.CritDamagePct, pet.Awakened ? AwakenCritBonus : CritBonus);
        }

        public override void Unbind()
        {
            if (weakpoint != null) Combat.ForceWeakpoint.Remove(weakpoint);
            if (modifier != null) Combat.OutgoingModifiers.Remove(modifier);
            weakpoint = null;
            modifier = null;
            base.Unbind();
        }

        public override void Tick(float dt)
        {
            if (pet.Awakened)
            {
                vacuumTimer -= dt;
                if (vacuumTimer <= 0)
                {
                    vacuumTimer = 0.4f;
                    Pickup.Attract(PlayerPos, VacuumRange);
                }
            }
            cleanTimer -= dt;
            if (cleanTimer <= 0 && exposed.Count > 0)
            {
                cleanTimer = 2f;
                var dead = new List<Damageable>();
                foreach (var (d, until) in exposed)
                    if (!d || d.Dead || Time.time >= until) dead.Add(d);
                foreach (var d in dead) exposed.Remove(d);
            }
        }

        /// <summary>金光三连射：额上第三只眼同时射出三道金光，各打一个目标</summary>
        public override void Attack(Damageable t)
        {
            pet.PlayAct("gaze");
            var eye = pet.SocketPos("eyefx", pet.Mouth + Vector3.up * 0.15f); // 额上第三只眼
            var targets = new List<Damageable> { t };
            foreach (var d in Pet.EnemiesNear(Pet.CenterOf(t), ShotRange))
            {
                if (targets.Count >= Shots) break;
                if (targets.Contains(d) || Vector3.Distance(eye, Pet.CenterOf(d)) > ShotRange || !pet.Sees(d)) continue;
                targets.Add(d);
            }
            PetFx.Burst(eye, Gold, 0.9f, 0.25f);
            ShotFx.Instance?.MuzzleFlash(eye, 1f);
            foreach (var d in targets)
            {
                var c = Pet.CenterOf(d);
                PetFx.Beam(eye, c, Color.Lerp(Gold, GoldRed, Random.value * 0.5f), 0.07f, 0.18f);
                pet.Hit(d, ShotDamage, from: eye);
                ShotFx.Instance?.Impact(c, (eye - c).normalized, false, 1.2f);
            }
            pet.Lunge(Pet.CenterOf(t) - pet.Center, 0.12f, 0.15f);
        }

        public override bool Skill()
        {
            var center = PlayerPos;
            int n = 0;
            foreach (var d in Pet.EnemiesNear(center + Vector3.up, ScrollRadius + 1f, false))
            {
                if (Pet.Flat(d.transform.position - center) > ScrollRadius) continue;
                EnemyStatus.Stun(d, ScrollStun);
                exposed[d] = Time.time + ScrollTime;
                PetFx.TimedMarker(d, Gold, ScrollTime);
                n++;
            }
            // 你的技能冷却立刻减半（剩余冷却）
            var skills = Owner.GetComponent<HeroSkills>();
            if (skills)
                foreach (var s in new[] { skills.primary, skills.secondary })
                    if (s != null && s.charges < s.maxCharges) s.recharge += (s.cooldown - s.recharge) * 0.5f;
            pet.PlayAct("scroll", 0, priority: true);
            Telegraph.Wave(center, ScrollRadius, 40f, Gold);
            PetFx.Pillar(pet.transform.position, Gold, 2f, 14f, 1.2f);
            PetFx.Burst(pet.Center, Gold, 6f, 0.6f);
            pet.Lunge(Vector3.up, 0.4f, 0.4f);
            PetHud.Instance?.Flash(new Color(1f, 0.85f, 0.45f, 0.35f), 0.5f);
            Hud.Instance?.Toast($"白泽图 · 万鬼现形（{n}）", 2f);
            return true;
        }
    }

    /// <summary>
    /// 应龙：布雨（每 0.6 / 觉醒 0.4 秒对 28 米内随机敌人降天雷 50 + 必定雷殛，每第 3 道附蚀化）、龙息雷光（每秒 5 × 20）、
    /// 灵技「杀蚩尤」（6 秒雷暴，每秒 12 道 70 伤害，火 → 雷 → 蚀轮转；释放时护盾回满）
    /// </summary>
    public sealed class YinglongBehaviour : PetBehaviour
    {
        const float RainRange = 28, RainDamage = 50, BreathDamage = 20, BreathRange = 22, BreathShock = 0.15f;
        const float StormTime = 6, StormRate = 12, StormDamage = 70, StormRange = 30;
        const float PearlRise = 0.4f, PearlHeight = 1.5f, PearlReturn = 0.35f, PearlSpin = 90f;
        static readonly Color Shock = DamageTable.ElementColor(Element.Shock);
        static readonly Element[] Cycle = { Element.Fire, Element.Shock, Element.Corrode };

        public override float AttackInterval => 0.2f;
        public override float AttackRange => BreathRange;
        float rainTimer = 0.6f;
        int rainCount;

        public override void Tick(float dt)
        {
            rainTimer -= dt;
            if (rainTimer > 0) return;
            rainTimer = pet.Awakened ? 0.4f : 0.6f;
            var list = EnemiesAround(PlayerPos + Vector3.up, RainRange + 2f, RainRange);
            if (list.Count == 0) return;
            rainCount++;
            Strike(list[Random.Range(0, list.Count)], RainDamage, Element.Shock, rainCount % 3 == 0 ? Element.Corrode : Element.None);
        }

        /// <summary>
        /// 天雷：从高空劈到敌人身上（sub = 副元素，必定附着：蚀雨）。source = 雷的出处（杀蚩尤时悬在头顶的宝珠）：
        /// 主雷从它劈出，另有一道细白雷照旧从天上落下
        /// </summary>
        void Strike(Damageable d, float dmg, Element element, Element sub, Vector3? source = null)
        {
            var c = Pet.CenterOf(d);
            var sky = c + new Vector3(Random.Range(-2f, 2f), 16f, Random.Range(-2f, 2f));
            var color = sub == Element.Corrode ? Color.Lerp(Shock, DamageTable.ElementColor(Element.Corrode), 0.6f) : DamageTable.ElementColor(element);
            Lightning.Spawn(source ?? sky, c, color, 0.16f);
            Lightning.Spawn(sky + Vector3.right * 0.3f, c, Color.white, 0.05f);
            ShotFx.Instance?.Impact(d.transform.position + Vector3.up * 0.1f, Vector3.up, false, 1.5f);
            var info = pet.Info(dmg, element, 1f, c, Vector3.down);
            if (sub != Element.None)
            {
                info.subElement = sub;
                info.subChance = 1f;
            }
            Combat.DamageEnemy(d, info);
        }

        /// <summary>龙息雷光：张口一道粗雷光，0.2 秒一跳</summary>
        public override void Attack(Damageable t)
        {
            var mouth = pet.Mouth;
            var c = Pet.CenterOf(t);
            pet.PlayAct("breath"); // 0.2 秒一跳：片段没播到 90% 就不重来
            PetFx.Beam(mouth, c, Shock, 0.14f, 0.2f);
            // 细雷从爪中宝珠窜出（雷暴时从头顶悬着的宝珠）；没有宝珠就从嘴里
            if (Random.value < 0.5f) Lightning.Spawn(pet.PartPos(mouth), c, Color.white, 0.04f);
            PetFx.Burst(mouth, Shock, 0.8f, 0.18f);
            pet.Hit(t, BreathDamage, Element.Shock, BreathShock, from: mouth);
        }

        public override bool Skill()
        {
            if (Vitals) Vitals.AddShield(Vitals.MaxShield);
            // 雷暴期间还会照常吐龙息：priority 让兴云布雨的动作播完再被龙息接上
            pet.PlayAct("storm", 0, priority: true);
            PetFx.Burst(pet.PartPos(pet.SocketPos("pearl", pet.Center)), Shock, 1.6f, 0.45f); // 爪中宝珠一亮
            pet.StartCoroutine(Storm());
            return true;
        }

        IEnumerator Storm()
        {
            pet.Say("杀蚩尤！", PetRarities.Gold, 1.5f);
            Hud.Instance?.Toast("杀蚩尤 · 雷暴 6 秒，护盾回满", 2f);
            PetHud.Instance?.Flash(new Color(0.45f, 0.6f, 1f, 0.3f), 0.6f);
            Telegraph.Wave(PlayerPos, StormRange, 45f, Shock);
            float start = Time.time, end = start + StormTime, next = start;
            int i = 0;
            // 宝珠离爪：0.4 秒升到龙头上方 1.5 米，雷暴期间悬着慢慢转、发亮，天雷从它劈出；结束后飞回爪中
            var pearl = pet.DetachPart();
            var pearlFrom = pearl ? pearl.position : Vector3.zero;
            while (Time.time < end && pet)
            {
                if (pearl)
                {
                    float k = Mathf.Clamp01((Time.time - start) / PearlRise);
                    var hover = PearlHover();
                    pearl.position = k < 1 ? Vector3.Lerp(pearlFrom, hover, 1 - (1 - k) * (1 - k))
                        : Vector3.Lerp(pearl.position, hover, 1 - Mathf.Exp(-12f * Time.deltaTime));
                    pearl.Rotate(0, PearlSpin * Time.deltaTime, 0, Space.World);
                    if (pet.PartGlow) pet.PartGlow.boost = k;
                }
                while (Time.time >= next)
                {
                    next += 1f / StormRate;
                    var element = Cycle[i++ % Cycle.Length];
                    Vector3? source = pearl ? pearl.position : null;
                    var list = EnemiesAround(PlayerPos + Vector3.up, StormRange + 2f, StormRange);
                    if (list.Count > 0) Strike(list[Random.Range(0, list.Count)], StormDamage, element, Element.None, source);
                    else
                    {
                        // 没敌人也照样打雷（只有特效）
                        var r = Random.insideUnitCircle * 12f;
                        var g = PlayerPos + new Vector3(r.x, 0, r.y);
                        g.y = Pet.GroundY(g + Vector3.up * 2f);
                        Lightning.Spawn(source ?? g + Vector3.up * 16f, g, DamageTable.ElementColor(element), 0.12f);
                    }
                }
                yield return null;
            }
            if (!pearl || !pet) yield break;
            // 飞回爪中（挂点跟着龙在动：每帧追当前位置）
            var back = pearl.position;
            for (float t = 0; t < PearlReturn && pearl; t += Time.deltaTime)
            {
                float k = t / PearlReturn;
                pearl.position = Vector3.Lerp(back, pet.PartHomePos, k * k);
                if (pet.PartGlow) pet.PartGlow.boost = 1 - k;
                yield return null;
            }
            pet.ReattachPart();
            if (pet.Part) PetFx.Burst(pet.Part.position, Shock, 0.6f, 0.25f);
        }

        /// <summary>宝珠悬停点：龙头上方 1.5 米，轻轻起伏</summary>
        Vector3 PearlHover() =>
            pet.SocketPos("head", pet.Center + Vector3.up * pet.Height * 0.4f) + Vector3.up * (PearlHeight + Mathf.Sin(Time.time * 2.2f) * 0.08f);
    }

    /// <summary>灵宠留在地上的持续伤害区（狻猊觉醒的蚀雾）：radius 内每 0.5 秒结算一次；灵宠没了就散</summary>
    public sealed class PetZone : MonoBehaviour
    {
        Pet owner;
        float radius, until, damage, chance, next, circleUntil;
        Element element;
        Color color;

        public bool Alive => Time.time < until;

        /// <summary>续期到 seconds 秒后；上一圈预警快结束时再画一圈</summary>
        public void Refresh(float seconds)
        {
            until = Mathf.Max(until, Time.time + seconds);
            if (Time.time < circleUntil - 0.1f) return;
            Telegraph.Circle(transform.position, radius, until - Time.time, new Color(color.r, color.g, color.b, 0.5f));
            circleUntil = until;
        }

        public static PetZone Spawn(Pet pet, Vector3 center, float radius, float duration, float damage, Element element, float chance, Color color)
        {
            var go = new GameObject("Pet Zone");
            go.transform.position = center;
            var z = go.AddComponent<PetZone>();
            z.owner = pet;
            z.radius = radius;
            z.until = Time.time + duration;
            z.damage = damage;
            z.element = element;
            z.chance = chance;
            z.next = Time.time + 0.25f;
            z.color = color;
            z.circleUntil = z.until;
            Telegraph.Circle(center, radius, duration, new Color(color.r, color.g, color.b, 0.5f));
            var glow = FxMaterials.GlowSprite(go.transform, radius * 2.4f, new Color(color.r, color.g, color.b, 0.25f));
            glow.localPosition = Vector3.up * 0.4f;
            return z;
        }

        void Update()
        {
            if (!owner || Time.time >= until)
            {
                Destroy(gameObject);
                return;
            }
            if (Time.time < next) return;
            next += 0.5f;
            var c = transform.position;
            foreach (var d in Pet.EnemiesNear(c + Vector3.up * 0.5f, radius + 1.5f, false))
                if (Pet.Flat(d.transform.position - c) <= radius) owner.Hit(d, damage, element, chance, from: c + Vector3.up);
        }
    }
}
