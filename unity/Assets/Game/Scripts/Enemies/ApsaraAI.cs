using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 邪飞天（Three.js 版 src/enemies/types/Apsara.ts + SupportBuffs.ts）：悬浮的辅助，自己不打人。
    ///   站位：同伴的重心后方 4 m，离玩家 14–20 m（没有同伴时就保持这个距离）；悬浮 0.9 m
    ///   光环：16 m 内的其他敌人（含别的邪飞天）伤害 / 攻速 ×1.35、移速 ×1.2、承伤 ×0.75，多只不叠加：
    ///         每 0.25 s 登记 / 续期到对方的 <see cref="EnemyBuffs"/>（通道 <see cref="EnemyBuffs.ApsaraAura"/>），离开范围即撤；她死亡 / 被沉默时立刻失效
    ///   和弦（7–9 s，前摇 1.1 s）：光环内同伴获得 50% 最大生命的护盾，8 s
    ///   花开（9–11 s，前摇 1.5 s）：同伴回复 25% 生命（有人掉血才放）
    ///   赐福（14–18 s，前摇 1.3 s）：生命最高的同伴 伤害 ×1.6、攻速 ×1.5、移速 ×1.15、承伤 ×0.5，10 s（通道 <see cref="EnemyBuffs.ApsaraBless"/>，与光环相乘）
    ///   琵琶：打琵琶（弱点）累计到她最大生命的 30% → 琴碎、沉默 20 s（光环与施法全停）——玩家的优先目标
    ///         每打掉 1/4 崩断一根弦（断弦声 + 火星 + 细电光，同 TS snapString）；琴碎后弱点挪到胸口（打胸口照样暴击，同 TS），
    ///         仰头哀鸣 1.4 s，之后退到更远处（14–20 m → 18–26 m，同 TS）
    ///   重凝（同 TS reform）：沉默最后 3 s 胸前聚起越来越密的金光（预警：趁现在杀她）→ 重凝 1.6 s（举臂、琵琶由无到有）→ 弦复原、弱点回到琵琶、加成恢复
    ///   登场（同 TS enter）：出生起从约 2.6 m 高处旋身飘落 1.8 s（含出生无敌的 0.7 s），落定时一圈金环、一声扫弦；落定前不施法。
    ///         光环从出生就开着（同伴马上有加成提示，测试场的金丝检查不用等她落地）——和 TS 不同
    ///   精英：护盾 / 回复量 ×1.3（同 TS）；冷却按攻速倍率走；和弦只在有同伴还没护盾时放，花开在有同伴掉到 85% 以下时放（同 TS）
    ///   悬浮起伏 ±0.1 m（1.5 rad/s，同 TS BOB）
    ///   提示：琵琶到光环内同伴的金丝、同伴脚下的光圈、被赐福者的金莲与头顶光环由 <see cref="SupportFx"/> 画
    /// </summary>
    public sealed class ApsaraAI : EnemyAI, IBuffSource
    {
        public static readonly List<ApsaraAI> Active = new();
        public const float AuraRange = 16f;
        const float Hover = 0.9f, PipaBreak = 0.3f, PipaReform = 20f;
        /// <summary>登场飘落用时（从出生算起）与起始高度、重凝预警 / 重凝用时、琴碎后哀鸣、精英加成倍率</summary>
        public const float Entrance = 1.8f, EntranceHeight = 2.6f, ReformWarn = 3f, ReformTime = 1.6f, ScreamTime = 1.4f, EliteBoost = 1.3f;
        /// <summary>光环每隔多久登记一次、每次续多久（续期比间隔长，中途不会断档）</summary>
        const float AuraTick = 0.25f, AuraHold = 0.6f, BlessTime = 10f;

        /// <summary>光环：伤害 / 攻速 ×1.35、移速 ×1.2、承伤 ×0.75</summary>
        public static readonly BuffMods AuraMods = new(1.35f, 1.35f, 1.2f, 0.75f);
        /// <summary>赐福：伤害 ×1.6、攻速 ×1.5、移速 ×1.15、承伤 ×0.5</summary>
        public static readonly BuffMods BlessMods = new(1.6f, 1.5f, 1.15f, 0.5f);

        float chordCd, bloomCd, blessCd, castTime, pipaDamage, silencedUntil = -1, strafeTimer, strafeSign = 1, auraTimer;
        string casting;
        Transform pipa, model;
        Vector3 pipaScale = Vector3.one, modelPos;
        Quaternion modelRot = Quaternion.identity;
        bool entered, reforming, broken;
        int stringsBroken;
        float screamUntil, warnAcc;
        EnemyAI blessTarget;

        /// <summary>累计：放了几次和弦 / 花开 / 赐福、琴碎几次、重凝几次、断了几根弦；最近一次和弦给一个同伴的护盾量（测试用）</summary>
        public int Chords { get; private set; }
        public int Blooms { get; private set; }
        public int Blessings { get; private set; }
        public int Shatters { get; private set; }
        public int Reforms { get; private set; }
        public int StringsSnapped { get; private set; }
        public float LastChordShield { get; private set; }
        /// <summary>落定了（登场演完）</summary>
        public bool Entered => entered;
        List<EnemyAI> auraNow = new(), auraPrev = new();
        readonly List<EnemyAI> scratch = new();

        /// <summary>沉默中：琴碎起，到重凝完成（20 s 沉默 + 1.6 s 重凝）</summary>
        public bool Silenced => broken;
        /// <summary>还能给加成：活着、没被沉默（<see cref="IBuffSource"/>）</summary>
        public bool BuffActive => this && !Dead && !Silenced;
        /// <summary>光环内的同伴（0.3 s 缓存）</summary>
        public List<Damageable> AuraAllies => Allies();
        /// <summary>金丝的起点：琵琶（琴碎时退到胸前）</summary>
        public Vector3 TetherOrigin => pipa && pipa.gameObject.activeInHierarchy ? pipa.position : transform.position + Vector3.up * 1.35f * transform.localScale.y;
        protected override string InitialState => entered ? "hover" : "enter";

        protected override void Awake()
        {
            base.Awake();
            agent.baseOffset = Hover;
            chordCd = Random.Range(3f, 5f);
            bloomCd = Random.Range(6f, 8f);
            blessCd = Random.Range(8f, 11f);
            hp.Damaged += OnPipaHit;
        }

        void OnEnable()
        {
            Active.Add(this);
            SupportFx.Ensure();
        }

        void OnDisable()
        {
            Active.Remove(this);
            DropAura();
        }

        /// <summary>
        /// 光环登记：每 0.25 s 把 16 m 内的其他敌人（根节点距离，含出生中的）登记 / 续期一次，离开范围的撤掉。
        /// 出生中、眩晕中、玩家阵亡时照样给（同原来按距离轮询的语义）；死亡 / 沉默时停，已登记的由对方按 <see cref="BuffActive"/> 立刻撤掉
        /// </summary>
        void LateUpdate()
        {
            PoseModel();
            if (!BuffActive)
            {
                if (auraPrev.Count > 0) DropAura();
                return;
            }
            auraTimer -= Time.deltaTime;
            if (auraTimer > 0) return;
            auraTimer = AuraTick;
            EnemyRegistry.InRadius(transform.position, AuraRange, auraNow, EnemyQuery.Alive, this);
            foreach (var e in auraNow) e.Buffs.Set(EnemyBuffs.ApsaraAura, this, AuraMods, AuraHold);
            foreach (var e in auraPrev)
                if (e && !auraNow.Contains(e)) e.Buffs.Remove(EnemyBuffs.ApsaraAura, this);
            (auraPrev, auraNow) = (auraNow, auraPrev);
            auraNow.Clear();
        }

        void DropAura()
        {
            foreach (var e in auraPrev)
                if (e) e.Buffs.Remove(EnemyBuffs.ApsaraAura, this);
            auraPrev.Clear();
            auraTimer = 0;
        }

        protected override void Start()
        {
            base.Start();
            foreach (var t in GetComponentsInChildren<Transform>(true))
                if (t.name == "socket_pipa") { pipa = t; break; }
            if (pipa) pipaScale = pipa.localScale;
            model = anim ? anim.transform : null;
            if (model)
            {
                modelPos = model.localPosition;
                modelRot = model.localRotation;
            }
        }

        /// <summary>
        /// 登场飘落 + 悬浮起伏 + 重凝时琵琶由无到有（动画写完之后再改模型子物体的位置 / 朝向，片段里没有这些曲线）。
        /// 模型子物体的局部位移随根节点体型放大，所以世界高度除以体型
        /// </summary>
        void PoseModel()
        {
            if (!model) return;
            float k = Mathf.Max(0.01f, transform.localScale.y);
            float bob = Dead ? 0 : 0.1f * Mathf.Sin(age * 1.5f);
            float fall = 0, spin = 0;
            if (!entered && !Dead)
            {
                float u = Mathf.Clamp01(EntranceAge / Entrance);
                float f = 1 - u;
                fall = EntranceHeight * f * f * f;
                // 旋身两圈，越落越慢
                spin = 720f * f * f;
            }
            model.localPosition = modelPos + new Vector3(0, (fall + bob) / k, 0);
            model.localRotation = Quaternion.Euler(0, spin, 0) * modelRot;
            if (pipa && reforming) pipa.localScale = pipaScale * DesertKit.Smooth(stateTime / (ReformTime * 0.55f));
        }

        /// <summary>出生起的秒数（出生阶段 stateTime 从 0 起，之后登场状态接着算）</summary>
        float EntranceAge => state == "spawn" ? stateTime : state == "enter" ? 0.7f + stateTime : Entrance;

        void OnPipaHit(DamageInfo info, DamageResult r)
        {
            if (!info.weakpoint || Silenced || Dead) return;
            pipaDamage += r.total;
            float need = hp.maxHealth * PipaBreak;
            if (pipaDamage < need)
            {
                // 每 1/4 的琴碎伤害崩断一根弦（第四根随琴碎一起断）；没断弦的这一下就是闷响
                int want = Mathf.Min(3, Mathf.FloorToInt(pipaDamage / need * 4));
                bool snapped = false;
                while (stringsBroken < want)
                {
                    SnapString();
                    snapped = true;
                }
                if (!snapped) GameAudio.PlayAt("pipa_hit", info.point, 0.8f);
                return;
            }
            // 琴碎：沉默 20 s，打断正在念的曲子
            Shatters++;
            broken = true;
            pipaDamage = 0;
            stringsBroken = 0;
            silencedUntil = Time.time + PipaReform;
            screamUntil = Time.time + ScreamTime;
            warnAcc = 0;
            var at = pipa ? pipa.position : info.point;
            if (pipa) pipa.gameObject.SetActive(false);
            // 弱点挪到胸口（琵琶没了，打胸口照样算弱点，同 TS setHeadAnchor(chest)）
            body.SetWeakPoint("chest", Vector3.zero, 0.24f);
            ShotFx.Instance?.Impact(info.point, -info.direction, false, 6f);
            Fx.Burst(at, Hex.Rgb(0x7a4a2a), 18, 5f, 0.9f, 0.07f, 14f);
            Fx.Burst(at, Hex.Rgb(0xfff2b8), 12, 4f, 0.5f, 0.06f, 6f);
            for (int i = 0; i < 4; i++) Fx.Lightning(at, at + new Vector3(Random.Range(-1f, 1f), Random.Range(-0.45f, 1.05f), Random.Range(-1f, 1f)), Hex.Rgb(0xffd890));
            GameUI.Toast("琵琶已碎 · 邪飞天沉默");
            // 断弦崩裂 + 哀鸣
            GameAudio.PlayAt("pipa_snap", info.point, 1f, 0.8f);
            GameAudio.PlayAt("shield_break", info.point, 0.9f, 1.5f);
            Sfx("boss_roar", 0.45f, 2f);
            if (state != "hover")
            {
                PlayLocomotion();
                SetState("hover");
            }
        }

        /// <summary>崩断一根弦：断弦声、火星、一道细电光</summary>
        void SnapString()
        {
            stringsBroken++;
            StringsSnapped++;
            var p = TetherOrigin;
            Fx.Burst(p, Hex.Rgb(0xfff2b8), 10, 2.5f, 0.4f, 0.04f, 6f);
            Fx.Lightning(p, p + transform.up * 0.5f * Size + transform.right * Random.Range(-0.3f, 0.3f) * Size, Hex.Rgb(0xffd890), 0.04f);
            GameAudio.PlayAt("pipa_snap", p, 0.9f);
        }

        /// <summary>开始重凝：双臂举过头，琵琶在胸前由无到有</summary>
        void BeginReform()
        {
            reforming = true;
            Stop();
            if (pipa)
            {
                pipa.gameObject.SetActive(true);
                pipa.localScale = pipaScale * 0.01f;
            }
            Fx.Burst(TetherOrigin, Hex.Rgb(0xffd890), 20, 2f, 0.8f, 0.07f, -1f);
            GameAudio.PlayAt("pipa_bloom", TetherOrigin, 0.7f, 0.9f);
            PlayTimed("chordWindup", ReformTime, 0.1f);
            SetState("reform");
        }

        /// <summary>重凝完成：弦复原、弱点回到琵琶、恢复弹奏和加成</summary>
        void FinishReform()
        {
            reforming = false;
            broken = false;
            silencedUntil = -1;
            pipaDamage = 0;
            stringsBroken = 0;
            Reforms++;
            if (pipa)
            {
                pipa.gameObject.SetActive(true);
                pipa.localScale = pipaScale;
            }
            body.SetWeakPoint("socket_pipa", Vector3.zero, 0.3f);
            body.SetWeakPointActive(true);
            GameAudio.PlayAt("pipa_chord", TetherOrigin, 0.9f);
            Fx.Ring(DesertKit.OnGround(transform.position) + Vector3.up * 0.05f, 3f, Hex.Rgb(0xffd890), 0.7f);
            Fx.Burst(TetherOrigin, Hex.Rgb(0xfff2b8), 14, 2.5f, 0.6f, 0.06f, 2f);
        }

        /// <summary>落定：脚下一圈金环、花瓣散开、第一声扫弦</summary>
        void LandEntrance()
        {
            entered = true;
            GameAudio.PlayAt("pipa_chord", TetherOrigin, 0.6f);
            Fx.Ring(DesertKit.OnGround(transform.position) + Vector3.up * 0.05f, 2.2f, Hex.Rgb(0xffd890), 0.7f);
            Fx.Burst(TetherOrigin, Hex.Rgb(0xffd27a), 16, 2.5f, 1.2f, 0.08f, -0.5f);
        }

        /// <summary>重凝被打断（眩晕、玩家阵亡）：琵琶已经现身了，直接完成，不留一把看得见却不弹的琴（同 TS cancelAttack）</summary>
        protected override void CancelAttack()
        {
            Glow = 0;
            if (state == "reform") FinishReform();
            // 登场中被打断（眩晕、玩家阵亡）：直接落定；死了就不演落定
            if (state == "enter")
            {
                if (Dead) entered = true;
                else LandEntrance();
            }
        }

        // 轮指：每 0.6 s 弹旋律的下一个音（同 Three.js：D5 = 74 为基准，0 = 休止；十六轮一句）
        static readonly int[] Melody = { 81, 78, 76, 74, 76, 78, 81, 0, 86, 83, 81, 78, 76, 78, 74, 0 };
        const float Lunzhi = 0.6f;
        float lunzhiAt;
        int melodyStep;

        void PlayMelody()
        {
            if (Silenced || Dead || state == "spawn" || Time.time < lunzhiAt) return;
            lunzhiAt = Time.time + Lunzhi;
            int note = Melody[melodyStep];
            melodyStep = (melodyStep + 1) % Melody.Length;
            if (note == 0) return;
            float detune = 1 + Random.Range(-0.004f, 0.004f);
            GameAudio.PlayAt("pipa_roll", TetherOrigin, 0.32f, Mathf.Pow(2, (note - 74) / 12f) * detune);
        }

        protected override void Think(float dt)
        {
            PlayMelody();
            chordCd -= dt * auraAttackRate;
            bloomCd -= dt * auraAttackRate;
            blessCd -= dt * auraAttackRate;
            strafeTimer -= dt;
            if (strafeTimer <= 0)
            {
                strafeTimer = Random.Range(2.5f, 4f);
                strafeSign = -strafeSign;
            }
            switch (state)
            {
                case "enter":
                    // 飞天降临：原地旋身飘落，落定前不施法（花瓣一路往下飘）
                    Stop();
                    FacePlayer(90, dt);
                    Glow = 0.3f;
                    warnAcc += dt * 14;
                    while (warnAcc > 1)
                    {
                        warnAcc -= 1;
                        var p = TetherOrigin + new Vector3(Random.Range(-0.4f, 0.4f), 0, Random.Range(-0.4f, 0.4f)) * Size;
                        Fx.Burst(p, Random.value < 0.5f ? Hex.Rgb(0xffd27a) : Hex.Rgb(0xffb0b8), 1, 0.8f, 1.6f, 0.07f, -0.2f);
                    }
                    if (0.7f + stateTime >= Entrance)
                    {
                        warnAcc = 0;
                        LandEntrance();
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                case "reform":
                    Stop();
                    FacePlayer(115, dt);
                    Glow = 0.4f + 0.6f * Mathf.Clamp01(stateTime / ReformTime);
                    if (stateTime >= ReformTime)
                    {
                        FinishReform();
                        PlayLocomotion();
                        SetState("hover");
                    }
                    break;
                case "hover":
                {
                    Position(dt);
                    Glow = Silenced ? 0 : 0.12f + 0.06f * Mathf.Sin(age * 3);
                    if (broken)
                    {
                        if (Time.time < screamUntil || reforming) break;
                        // 琴碎后：最后几秒胸前聚起越来越密的金光（给玩家的预警：趁现在杀掉她），到点开始重凝
                        float left = silencedUntil - Time.time;
                        if (left <= 0)
                        {
                            BeginReform();
                            break;
                        }
                        if (left < ReformWarn)
                        {
                            warnAcc += dt * (4 + 14 * (1 - left / ReformWarn));
                            while (warnAcc > 1)
                            {
                                warnAcc -= 1;
                                var p = TetherOrigin + Random.insideUnitSphere * 0.25f * Size;
                                Fx.Burst(p, Random.value < 0.6f ? Hex.Rgb(0xffd890) : Hex.Rgb(0x7a4a2a), 1, 0.3f, 0.6f, 0.1f, 0);
                            }
                        }
                        break;
                    }
                    var allies = Allies();
                    if (allies.Count == 0) break;
                    if (chordCd <= 0 && allies.Exists(a => !a.HasTimedShield)) BeginCast("chord", 1.1f);
                    else if (bloomCd <= 0 && allies.Exists(a => a.Fraction < 0.85f)) BeginCast("bloom", 1.5f);
                    else if (blessCd <= 0 && (blessTarget = PickBlessTarget())) BeginCast("bless", 1.3f);
                    break;
                }
                case "cast":
                    Stop();
                    if (casting == "bless" && blessTarget && !blessTarget.Dead) FaceTowards(blessTarget.transform.position, 170, dt);
                    else FacePlayer(115, dt);
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
            if (Silenced)
            {
                // 琴碎后只会躲：离玩家更远（同 TS KEEP_RANGE + 4 / + 6）
                KeepRange(18f, 26f, moveSpeed, strafeSign);
                FaceAimTravel(230, dt);
                return;
            }
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
            EnemyRegistry.InRadius(transform.position, AuraRange, scratch, EnemyQuery.Alive, this);
            foreach (var e in scratch)
                if (e is not ApsaraAI) list.Add(e.Health);
            scratch.Clear();
            return list;
        }

        /// <summary>范围内最强（最大生命最高）的、还没被赐福的同伴（不含别的邪飞天）</summary>
        EnemyAI PickBlessTarget()
        {
            EnemyAI best = null;
            float bestHp = -1;
            EnemyRegistry.InRadius(transform.position, AuraRange, scratch, EnemyQuery.Alive, this);
            foreach (var e in scratch)
            {
                if (e is ApsaraAI || e.Blessed) continue;
                var h = e.Health;
                if (h.maxHealth > bestHp) { bestHp = h.maxHealth; best = e; }
            }
            scratch.Clear();
            return best;
        }

        void BeginCast(string spell, float windup)
        {
            casting = spell;
            castTime = Windup(windup, 0.6f);
            PlayTimed(spell + "Windup", castTime, 0.1f);
            GameAudio.PlayAt("pipa_roll", TetherOrigin, 0.55f, 1.2f);
            SetState("cast");
            Telegraph.Circle(transform.position, 1.2f, castTime, spell == "bless" ? new Color(1f, 0.8f, 0.3f) : new Color(0.6f, 1f, 0.75f));
        }

        void Release(string spell)
        {
            var allies = Allies();
            switch (spell)
            {
                case "chord":
                {
                    GameAudio.PlayAt("pipa_chord", TetherOrigin, 0.9f);
                    float k = elite ? EliteBoost : 1f;
                    foreach (var a in allies)
                    {
                        LastChordShield = EnemyAI.RoundHp(a.maxHealth * 0.5f * k);
                        a.AddTimedShield(LastChordShield, 8f);
                    }
                    Fx.Ring(DesertKit.OnGround(transform.position) + Vector3.up * 0.05f, AuraRange, Hex.Rgb(0xffd070), 0.9f);
                    chordCd = Random.Range(7f, 9f);
                    Chords++;
                    break;
                }
                case "bloom":
                    GameAudio.PlayAt("pipa_bloom", TetherOrigin, 0.85f);
                    foreach (var a in allies) a.Heal(a.maxHealth * 0.25f * (elite ? EliteBoost : 1f));
                    Fx.Burst(TetherOrigin, Hex.Rgb(0xffd27a), 30, 4f, 1.6f, 0.09f, -0.4f);
                    Fx.Burst(TetherOrigin, Hex.Rgb(0xffb0b8), 24, 3.5f, 1.8f, 0.08f, -0.3f);
                    bloomCd = Random.Range(9f, 11f);
                    Blooms++;
                    break;
                case "bless":
                {
                    GameAudio.PlayAt("pipa_bless", TetherOrigin, 0.9f);
                    var best = blessTarget && !blessTarget.Dead && !blessTarget.Blessed ? blessTarget : PickBlessTarget();
                    if (best)
                    {
                        best.Buffs.Set(EnemyBuffs.ApsaraBless, this, BlessMods, BlessTime);
                        ShotFx.Instance?.Impact(best.transform.position + Vector3.up * 1.5f, Vector3.up, true, 5f);
                        Fx.Beam(TetherOrigin, best.transform.position + Vector3.up * 1.2f, Hex.Rgb(0xffe08a), 0.12f, 0.8f);
                        Blessings++;
                    }
                    blessTarget = null;
                    blessCd = Random.Range(14f, 18f);
                    break;
                }
            }
            foreach (var a in allies) ShotFx.Instance?.Impact(a.transform.position + Vector3.up, Vector3.up, false, 1.5f);
        }
    }
}
