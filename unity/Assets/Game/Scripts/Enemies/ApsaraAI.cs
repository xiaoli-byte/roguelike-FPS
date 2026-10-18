using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 邪飞天（Three.js 版 src/enemies/types/Apsara.ts + SupportBuffs.ts）：悬浮的辅助，自己不打人。
    ///   站位：同伴的重心后方 4 m，离玩家 14–20 m（没有同伴时就保持这个距离）；悬浮 0.9 m
    ///   光环：16 m 内的同伴 伤害 / 攻速 ×1.35、移速 ×1.2、承伤 ×0.75（在 EnemyAI.RefreshBuffs 里结算）
    ///   和弦（7–9 s，前摇 1.1 s）：光环内同伴获得 50% 最大生命的护盾，8 s
    ///   花开（9–11 s，前摇 1.5 s）：同伴回复 25% 生命（有人掉血才放）
    ///   赐福（14–18 s，前摇 1.3 s）：生命最高的同伴 伤害 ×1.6、承伤 ×0.5，10 s
    ///   琵琶：打琵琶（弱点）累计到她最大生命的 30% → 琴碎、沉默 20 s（光环与施法全停）——玩家的优先目标
    /// </summary>
    public sealed class ApsaraAI : EnemyAI
    {
        public static readonly List<ApsaraAI> Active = new();
        public const float AuraRange = 16f;
        const float Hover = 0.9f, PipaBreak = 0.3f, PipaReform = 20f;

        float chordCd, bloomCd, blessCd, castTime, pipaDamage, silencedUntil = -1, strafeTimer, strafeSign = 1;
        string casting;
        Transform pipa;

        public bool Silenced => Time.time < silencedUntil;
        protected override string InitialState => "hover";

        protected override void Awake()
        {
            base.Awake();
            agent.baseOffset = Hover;
            chordCd = Random.Range(3f, 5f);
            bloomCd = Random.Range(6f, 8f);
            blessCd = Random.Range(8f, 11f);
            hp.Damaged += OnPipaHit;
        }

        void OnEnable() => Active.Add(this);
        void OnDisable() => Active.Remove(this);

        protected override void Start()
        {
            base.Start();
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == "socket_pipa") { pipa = t; break; }
        }

        void OnPipaHit(DamageInfo info, DamageResult r)
        {
            if (!info.weakpoint || Silenced || Dead) return;
            pipaDamage += r.total;
            if (pipaDamage < hp.maxHealth * PipaBreak) return;
            // 琴碎：沉默 20 s，打断正在念的曲子
            pipaDamage = 0;
            silencedUntil = Time.time + PipaReform;
            if (pipa) pipa.gameObject.SetActive(false);
            if (body.WeakPoint) body.WeakPoint.gameObject.SetActive(false);
            ShotFx.Instance?.Impact(info.point, -info.direction, false, 6f);
            Hud.Instance?.Toast("琵琶已碎 · 邪飞天沉默");
            if (state != "hover")
            {
                PlayLocomotion();
                SetState("hover");
            }
        }

        protected override void Think(float dt)
        {
            if (!Silenced && pipa && !pipa.gameObject.activeSelf)
            {
                // 琵琶重铸
                pipa.gameObject.SetActive(true);
                if (body.WeakPoint) body.WeakPoint.gameObject.SetActive(true);
            }
            chordCd -= dt;
            bloomCd -= dt;
            blessCd -= dt;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(2.5f, 4f);
                strafeSign = -strafeSign;
            }
            Position(dt);
            switch (state)
            {
                case "hover":
                    if (Silenced) break;
                    var allies = Allies();
                    if (allies.Count == 0) break;
                    if (blessCd <= 0) BeginCast("bless", 1.3f);
                    else if (chordCd <= 0) BeginCast("chord", 1.1f);
                    else if (bloomCd <= 0 && allies.Exists(a => a.Fraction < 0.9f)) BeginCast("bloom", 1.5f);
                    break;
                case "cast":
                    if (stateTime >= castTime)
                    {
                        Release(casting);
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("hover");
                    break;
            }
        }

        void Position(float dt)
        {
            var allies = Allies();
            Vector3 dest;
            var p = PlayerPos;
            if (allies.Count > 0)
            {
                var c = Vector3.zero;
                foreach (var a in allies) c += a.transform.position;
                c /= allies.Count;
                var away = c - p;
                away.y = 0;
                dest = c + (away.sqrMagnitude > 0.01f ? away.normalized : -transform.forward) * 4f;
                var fromPlayer = dest - p;
                fromPlayer.y = 0;
                float d = Mathf.Clamp(fromPlayer.magnitude, 14f, 20f);
                dest = p + fromPlayer.normalized * d + new Vector3(-fromPlayer.z, 0, fromPlayer.x).normalized * strafeSign * 2f;
                MoveTo(dest, moveSpeed);
            }
            else KeepRange(14f, 20f, moveSpeed, strafeSign);
            FacePlayer(230, dt);
        }

        List<Damageable> allyCache = new();
        float allyCacheTime = -1;

        List<Damageable> Allies()
        {
            if (Time.time - allyCacheTime < 0.3f)
            {
                allyCache.RemoveAll(a => !a || a.Dead);
                return allyCache;
            }
            allyCacheTime = Time.time;
            var list = allyCache;
            list.Clear();
            foreach (var e in FindObjectsByType<EnemyAI>())
            {
                if (e == this || e.Dead || e is ApsaraAI) continue;
                if ((e.transform.position - transform.position).sqrMagnitude > AuraRange * AuraRange) continue;
                list.Add(e.GetComponent<Damageable>());
            }
            return list;
        }

        void BeginCast(string spell, float windup)
        {
            casting = spell;
            castTime = Windup(windup, 0.6f);
            Play(spell + "Windup", 0.1f);
            SetState("cast");
            Telegraph.Circle(transform.position, 1.2f, castTime, spell == "bless" ? new Color(1f, 0.8f, 0.3f) : new Color(0.6f, 1f, 0.75f));
        }

        void Release(string spell)
        {
            var allies = Allies();
            switch (spell)
            {
                case "chord":
                    foreach (var a in allies) a.AddTimedShield(a.maxHealth * 0.5f, 8f);
                    chordCd = Random.Range(7f, 9f);
                    break;
                case "bloom":
                    foreach (var a in allies) a.Heal(a.maxHealth * 0.25f);
                    bloomCd = Random.Range(9f, 11f);
                    break;
                case "bless":
                {
                    EnemyAI best = null;
                    float bestHp = -1;
                    foreach (var e in FindObjectsByType<EnemyAI>())
                    {
                        if (e == this || e.Dead || e is ApsaraAI || e.Blessed) continue;
                        if ((e.transform.position - transform.position).sqrMagnitude > AuraRange * AuraRange) continue;
                        var h = e.GetComponent<Damageable>();
                        if (h.maxHealth > bestHp) { bestHp = h.maxHealth; best = e; }
                    }
                    if (best)
                    {
                        best.blessedBy = this;
                        best.blessedUntil = Time.time + 10f;
                        ShotFx.Instance?.Impact(best.transform.position + Vector3.up * 1.5f, Vector3.up, true, 5f);
                    }
                    blessCd = Random.Range(14f, 18f);
                    break;
                }
            }
            foreach (var a in allies) ShotFx.Instance?.Impact(a.transform.position + Vector3.up, Vector3.up, false, 1.5f);
        }
    }
}
