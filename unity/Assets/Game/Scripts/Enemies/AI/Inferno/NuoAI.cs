using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 变脸傩巫（Three.js 版 src/enemies/types/Nuo.ts，第三章辅助）：戴整张脸大的木雕傩面（面具是头部的一部分），跳火傩给同伴加光环，
    /// 川剧变脸一样隔一阵换一张脸。三张脸见 <see cref="Faces"/>（<see cref="FaceDef"/>）：
    ///   赤面（怒）伤害 ×1.35、攻速 ×1.25；黑面（刚）受伤 ×0.6；金面（疾）移速 ×1.3、每秒回 2% 最大生命。
    ///   光环：16 m 内（+ 同伴身体半径）的同伴每 0.25 s 登记 / 续期一次（每张脸一个加成通道：几只傩巫同脸不叠加、不同脸相乘），
    ///     离开范围、换脸、碎面、她被眩晕 / 死亡时撤掉；同伴脚下一圈和面具同色的光环（黑面是暗环 + 一圈紫边）。
    ///   跳傩：离玩家 12–20 m、躲在同伴身后踩鼓点（每 0.75 s 一拍：脚下一圈小光环、隔拍腰铃响）。
    ///   变脸（7.5–8.5 s）：大袖往脸上一抹 0.5 s（这一下脸被袖子挡住，面具不算弱点），中点换成下一张没碎的脸，一团火光盖住。
    ///   碎面：当前这张脸累计吃到最大生命 25%（只算从正面打中面具、换脸时清零）→ 这张脸的加成立刻撤掉、以后不再换回来，
    ///     捂脸踉跄 2 s，6 s 内不能变脸（锁定一结束马上换下一张）；三张都碎了就只剩吐火。
    ///   吐火（玩家进 7 m、高差 2 m 内，拿近战名额）：后仰蓄火 0.55 s（面前半圆预警）→ 面具嘴里喷 6 m 火柱，1 s 内从玩家那一侧的反面扫到另一侧（半圈），
    ///     被墙挡住就到墙为止；火柱上每 0.1 s 烫一下（每秒伤害 × 2.5），落地那一头每 0.3 s 留一小片余火（祸斗能吃）。
    ///   弱点：面具（mask 骨），只能从正面打（朝向门 cos ≥ −0.2：从背后打到头算身体）。
    /// 状态机：enter → dance → wipe → dance；spitWindup → spit → dance；碎面时 cover → dance。
    /// 动作片段：enter / wipe / cover / spitWindup / spit + Locomotion（傩舞 = 待机 / 移动步态）。面具的分区换色归 FX4（本类给出 <see cref="FaceChanged"/>）。
    /// </summary>
    public sealed class NuoAI : EnemyAI, IBuffSource
    {
        /// <summary>一张脸：光环倍率、回血、光环颜色（黑面另有一圈紫边）、眼睛 / 面前火光的颜色、换脸着色（FX4 的面具分区用；null = 原贴图）</summary>
        public sealed class FaceDef
        {
            public string id, name;
            public BuffMods aura;
            /// <summary>每秒回复同伴最大生命的比例</summary>
            public float regen;
            public Color ring, accent, eye;
            public Color? paint, trim;
            /// <summary>这张脸的加成通道（几只傩巫同脸不叠加）</summary>
            public string Channel => "nuo.face." + id;
            /// <summary>贴地光环 / 鼓点的显示色（黑面用紫边，暗环在亮地上才读得出）</summary>
            public Color Readable => accent.a > 0 ? accent : ring;
        }

        public static readonly FaceDef[] Faces =
        {
            new() { id = "red", name = "赤面", aura = new BuffMods(1.35f, 1.25f, 1, 1), ring = Hex.Rgb(0xff3a1a), eye = Hex.Rgb(0xffa040) },
            new()
            {
                id = "black", name = "黑面", aura = new BuffMods(1, 1, 1, 0.6f), ring = Hex.Rgb(0x140a10), accent = Hex.Rgb(0x7040c0), eye = Hex.Rgb(0xc080ff),
                paint = new Color(0.03f, 0.025f, 0.035f), trim = new Color(0.85f, 0.6f, 0.18f),
            },
            new()
            {
                id = "gold", name = "金面", aura = new BuffMods(1, 1, 1.3f, 1), regen = 0.02f, ring = Hex.Rgb(0xffc840), eye = Hex.Rgb(0xfff2a0),
                paint = new Color(1f, 0.6f, 0.1f), trim = new Color(1f, 0.92f, 0.7f),
            },
        };

        /// <summary>跳傩：光环半径、离玩家的距离带、鼓点间隔、退到同伴后方多远</summary>
        public const float AuraRange = 16, KeepMin = 12, KeepMax = 20, Beat = 0.75f, Behind = 3;
        /// <summary>变脸间隔带、抹脸时长；碎面阈值（最大生命比例）、捂脸、禁变脸</summary>
        public const float FaceEveryMin = 7.5f, FaceEveryMax = 8.5f, Wipe = 0.5f, MaskBreak = 0.25f, CoverTime = 2, LockTime = 6;
        /// <summary>吐火：触发距离、射程、前摇、扫一遍的时长、半弧（弧度）、判定角宽、判定间隔、每秒伤害倍率、冷却</summary>
        public const float SpitTrigger = 7, SpitRange = 6, SpitWindup = 0.55f, SpitSweep = 1f, SpitHalfArc = Mathf.PI / 2, SpitWidth = 0.3f, SpitTick = 0.1f, SpitDps = 2.5f, SpitCd = 5;
        /// <summary>火柱余火：间隔、半径、持续、每跳伤害倍率</summary>
        public const float EmberEvery = 0.3f, EmberRadius = 0.7f, EmberLife = 2.5f, EmberMult = 0.2f;
        const float EnterTime = 0.8f, AuraTick = 0.25f, AuraHold = 0.6f;

        /// <summary>模型空间（Three.js 坐标，未缩放）：嘴</summary>
        static readonly Vector3 Mouth = new(0, 1.27f, 0.21f);
        static readonly Color EmberColor = Hex.Rgb(0xff6a20), MoltenColor = Hex.Rgb(0xffa030), WoodChip = Hex.Rgb(0xb08050);

        int face;
        readonly bool[] broken = new bool[3];
        float faceTimer, lockUntil = -9, maskDamage, spitCd, windTime = 1, spitYaw, spitSign = 1, spitTick, emberTimer, auraTimer, strafeSign = 1, strafeTimer;
        int beatIndex = -1;
        bool swapped, entered, enterPlayed, placed;
        TelegraphHandle spitMark;
        Transform mouthBone, faceGlow;
        Vector3 mouthLocal;
        List<EnemyAI> auraNow = new(), auraPrev = new();
        readonly List<EnemyAI> scratch = new();
        readonly Dictionary<EnemyAI, HazardDecal[]> rings = new();
        readonly List<EnemyAI> ringStale = new();
        static readonly Dictionary<EnemyAI, int> regenFrame = new();

        /// <summary>换了一张脸（新脸的下标）：FX4 的面具分区着色订阅它</summary>
        public event System.Action<NuoAI, int> FaceChanged;

        public int FaceIndex => face;
        public FaceDef CurrentFace => Faces[face];
        public bool IsBroken(int i) => i >= 0 && i < broken.Length && broken[i];
        public bool AllBroken => broken[0] && broken[1] && broken[2];
        /// <summary>面具在换脸那一下被袖子挡住</summary>
        public bool MaskCovered => state == "wipe";
        /// <summary>当前这张脸累计受伤占碎面阈值的比例</summary>
        public float MaskCrack => Mathf.Clamp01(maskDamage / Mathf.Max(1, hp.maxHealth * MaskBreak));
        /// <summary>正在加成的同伴</summary>
        public IReadOnlyList<EnemyAI> AuraTargets => auraPrev;

        /// <summary>还能给加成：活着、当前这张脸没碎、没被眩晕（<see cref="IBuffSource"/>）</summary>
        public bool BuffActive => this && !Dead && !broken[face] && !Stunned;

        protected override string InitialState => entered ? "dance" : "enter";

        /// <summary>下一张没碎的脸（从 current 的下一张起轮，全碎了留在 current）</summary>
        public static int NextFace(int current, IReadOnlyList<bool> brokenFaces)
        {
            for (int k = 1; k <= 3; k++)
            {
                int next = (current + k) % 3;
                if (brokenFaces == null || !brokenFaces[next]) return next;
            }
            return current;
        }

        /// <summary>火柱的水平角（弧度，0 = +Z）：u = 0..1 从 start − sign·半弧 平滑扫到 start + sign·半弧</summary>
        public static float JetYaw(float startYaw, float sign, float u)
        {
            float t = Mathf.Clamp01(u);
            float s = t * t * (3 - 2 * t);
            return startYaw + sign * (-SpitHalfArc + 2 * SpitHalfArc * s);
        }

        /// <summary>
        /// 火柱打到玩家（水平部分，纯函数）：水平距离 ≤ 射程 + 玩家半径 + 0.3、高差 ≤ 2.5、和火柱方向的夹角 ≤ 判定角宽 + atan(玩家半径 / max(0.5, 距离))
        /// </summary>
        public static bool JetCovers(Vector3 self, float yaw, float reach, Vector3 playerFeet, float playerRadius = 0.35f)
        {
            float dx = playerFeet.x - self.x, dz = playerFeet.z - self.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d > reach + playerRadius + 0.3f || Mathf.Abs(playerFeet.y - self.y) > 2.5f) return false;
            float off = Mathf.Abs(Mathf.DeltaAngle(Mathf.Atan2(dx, dz) * Mathf.Rad2Deg, yaw * Mathf.Rad2Deg)) * Mathf.Deg2Rad;
            return off <= SpitWidth + Mathf.Atan2(playerRadius, Mathf.Max(0.5f, d));
        }

        protected override void Awake()
        {
            base.Awake();
            faceTimer = Random.Range(FaceEveryMin, FaceEveryMax);
            spitCd = Random.Range(1f, 2f);
            hp.Died += OnDeath;
            GlowStyle(0.15f, 0.05f, 2.5f, 0.8f, false);
        }

        protected override void Start()
        {
            base.Start();
            PlaceParts();
        }

        Vector3 ModelPoint(Vector3 three) => transform.TransformPoint(new Vector3(-three.x, three.y, three.z));

        /// <summary>嘴的插槽、面具弱点的朝向门（只认正面）、碎面计数；面前一团随脸换色的火光（只在 Play 里建）</summary>
        void PlaceParts()
        {
            if (placed) return;
            placed = true;
            if (!GetComponent<PlaceholderBody>())
            {
                Transform head = null;
                foreach (var t in GetComponentsInChildren<Transform>(true))
                {
                    if (t.name == "mouth") mouthBone = t;
                    else if (t.name == "head") head = t;
                }
                mouthBone ??= head;
            }
            if (mouthBone) mouthLocal = mouthBone.InverseTransformPoint(ModelPoint(Mouth));
            var wz = body.WeakZone;
            if (wz)
            {
                wz.facing = ZoneFacing.Front;
                wz.facingCos = -0.2f;
                wz.Damaged += OnMaskHit;
            }
            if (Application.isPlaying && body.WeakPoint)
            {
                var w = body.WeakPoint;
                faceGlow = FxMaterials.GlowSprite(w, 0.7f * Size / Mathf.Max(1e-3f, w.lossyScale.x), CurrentFace.eye);
                faceGlowBase = faceGlow.localScale.x;
            }
            ApplyFace();
        }

        /// <summary>嘴（世界）：火柱的起点</summary>
        public Vector3 MouthWorld => mouthBone ? mouthBone.TransformPoint(mouthLocal) : ModelPoint(Mouth);

        // ───────────── AI ─────────────

        protected override void Update()
        {
            strafeTimer -= Time.deltaTime;
            if (strafeTimer <= 0)
            {
                strafeSign = -strafeSign;
                strafeTimer = Random.Range(1.5f, 3.2f);
            }
            base.Update();
        }

        protected override void Think(float dt)
        {
            spitCd -= dt * auraAttackRate;
            if (Time.time >= lockUntil && !AllBroken) faceTimer -= dt;
            switch (state)
            {
                case "enter":
                    Stop();
                    if (!enterPlayed)
                    {
                        enterPlayed = true;
                        Play("enter", 0.05f);
                    }
                    FacePlayer(115, dt);
                    if (stateTime >= EnterTime)
                    {
                        entered = true;
                        PlayLocomotion();
                        SetState("dance");
                    }
                    break;
                case "dance":
                {
                    Glow = 0.3f + 0.2f * Mathf.Max(0, Mathf.Sin(age * Mathf.PI * 2 / Beat));
                    SetGlow(1, 0);
                    if (spitCd <= 0 && DistToPlayer < SpitTrigger && Mathf.Abs(PlayerPos.y - transform.position.y) <= 2
                        && RequestAttack(AttackTokens.Kind.Melee, SpitWindup + SpitSweep + 0.4f))
                    {
                        BeginSpit();
                        break;
                    }
                    if (faceTimer <= 0 && !AllBroken && Time.time >= lockUntil)
                    {
                        swapped = false;
                        PlayTimed("wipe", Wipe);
                        Sfx("skill_fire", 0.45f, 1.4f);
                        SetState("wipe");
                        break;
                    }
                    Dance();
                    FacePlayer(172, dt);
                    BeatStep();
                    break;
                }
                case "wipe":
                    Stop();
                    FacePlayer(172, dt);
                    if (!swapped && stateTime >= Wipe * 0.5f) SwapFace();
                    if (stateTime >= Wipe)
                    {
                        faceTimer = Random.Range(FaceEveryMin, FaceEveryMax);
                        PlayLocomotion();
                        SetState("dance");
                    }
                    break;
                case "cover":
                    Stop();
                    if (stateTime >= CoverTime)
                    {
                        PlayLocomotion();
                        SetState("dance");
                    }
                    break;
                case "spitWindup":
                {
                    Stop();
                    float k = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.5f + 0.5f * k;
                    SetGlow(1, k);
                    if (stateTime >= windTime)
                    {
                        spitMark = default;
                        spitTick = 0;
                        emberTimer = EmberEvery * 0.5f;
                        Play("spit", 0.05f);
                        GameAudio.PlayAt("skill_fire", MouthWorld, 0.9f, 0.8f);
                        SetState("spit");
                    }
                    break;
                }
                case "spit":
                    Stop();
                    SetGlow(1, 1);
                    UpdateJet(dt);
                    if (stateTime >= SpitSweep)
                    {
                        SetGlow(1, 0);
                        ReleaseAttack();
                        spitCd = SpitCd;
                        PlayLocomotion();
                        SetState("dance");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("dance");
                    break;
            }
        }

        /// <summary>躲在同伴身后（12 m 外、退到重心后 3 m）；没有同伴就和玩家保持 12–20 m</summary>
        void Dance()
        {
            var spot = FounderAI.BehindAlliesSpot(this, PlayerPos, KeepMin, Behind, scratch);
            if (spot == null)
            {
                KeepRange(KeepMin, KeepMax, moveSpeed, strafeSign);
                return;
            }
            var to = spot.Value - transform.position;
            to.y = 0;
            if (to.magnitude > 1.8f) MoveTo(spot.Value, moveSpeed);
            else Stop();
        }

        /// <summary>傩舞的鼓点：每拍一跺脚（脚下一圈小光环），隔拍腰铃响</summary>
        void BeatStep()
        {
            int i = Mathf.FloorToInt(age / Beat);
            if (i == beatIndex) return;
            beatIndex = i;
            float side = i % 2 == 0 ? 1 : -1;
            var foot = transform.TransformPoint(new Vector3(side * 0.15f, 0.05f, 0.05f));
            if (!broken[face] && Application.isPlaying) Fx.Ring(foot, 0.9f, CurrentFace.Readable, 0.3f, false);
            GameAudio.PlayAt(i % 2 == 0 ? "pickup_coin" : "footstep", transform.position, 0.22f, i % 2 == 0 ? 0.55f : 0.8f);
        }

        // ───────────── 光环 ─────────────

        /// <summary>
        /// 光环（每 0.25 s）：16 m 内（+ 同伴身体半径）的其他敌人（首领除外）登记 / 续期当前这张脸的加成，离开范围的撤掉；
        /// 金面每帧给范围内的同伴回血（同一只同伴一帧只回一次）；脚下光环贴片跟着同伴走
        /// </summary>
        void LateUpdate()
        {
            if (!placed) return;
            if (body.WeakZone) body.WeakZone.SetWeakPoint(!MaskCovered);
            if (faceGlow)
            {
                faceGlow.gameObject.SetActive(!Dead && !broken[face]);
                float flare = state == "wipe" ? 1.6f : state is "spitWindup" or "spit" ? 1.3f : 1f;
                faceGlow.localScale = Vector3.one * faceGlowBase * flare * (0.9f + 0.1f * Mathf.Sin(Time.time * 6f));
            }
            if (!BuffActive)
            {
                if (auraPrev.Count > 0) DropAura();
                return;
            }
            float dt = Time.deltaTime;
            var f = CurrentFace;
            if (f.regen > 0)
                foreach (var e in auraPrev)
                {
                    if (!e || e.Dead || !e.Health || e.Health.health >= e.Health.maxHealth) continue;
                    if (regenFrame.TryGetValue(e, out int fr) && fr == Time.frameCount) continue;
                    regenFrame[e] = Time.frameCount;
                    e.Health.Heal(e.Health.maxHealth * f.regen * dt);
                }
            if (regenFrame.Count > 256) regenFrame.Clear();
            auraTimer -= dt;
            if (auraTimer > 0)
            {
                PulseRings();
                return;
            }
            auraTimer = AuraTick;
            EnemyRegistry.InRadius(transform.position, AuraRange + 1.5f, auraNow, EnemyQuery.Alive, this);
            for (int i = auraNow.Count - 1; i >= 0; i--)
            {
                var e = auraNow[i];
                var d = e.transform.position - transform.position;
                d.y = 0;
                if (!e.Health || e.Health.IsBoss || d.magnitude > AuraRange + EnemyRegistry.BodyRadius(e)) auraNow.RemoveAt(i);
            }
            foreach (var e in auraNow) e.Buffs.Set(f.Channel, this, f.aura, AuraHold);
            foreach (var e in auraPrev)
                if (e && !auraNow.Contains(e))
                    e.Buffs.Remove(f.Channel, this);
            (auraPrev, auraNow) = (auraNow, auraPrev);
            auraNow.Clear();
            SyncRings();
        }

        float faceGlowBase = 1;

        /// <summary>撤下给出的全部加成与光环贴片</summary>
        void DropAura()
        {
            foreach (var e in auraPrev)
                if (e)
                    e.Buffs.RemoveSource(this);
            auraPrev.Clear();
            auraTimer = 0;
            ClearRings();
        }

        void SyncRings()
        {
            if (!Application.isPlaying) return;
            ringStale.Clear();
            foreach (var kv in rings)
                if (!kv.Key || kv.Key.Dead || !auraPrev.Contains(kv.Key))
                    ringStale.Add(kv.Key);
            foreach (var e in ringStale) DestroyRings(e);
            var f = CurrentFace;
            foreach (var e in auraPrev)
            {
                if (!e || rings.ContainsKey(e)) continue;
                float r = Mathf.Max(0.8f, EnemyRegistry.BodyRadius(e) * 2.2f);
                var p = e.transform.position;
                var list = new List<HazardDecal> { HazardDecal.Create(e.transform, p, r, new Color(f.ring.r, f.ring.g, f.ring.b, 0.75f)) };
                if (f.accent.a > 0) list.Add(HazardDecal.Create(e.transform, p + Vector3.up * 0.01f, r + 0.08f, new Color(f.accent.r, f.accent.g, f.accent.b, 0.6f)));
                rings[e] = list.ToArray();
            }
            PulseRings();
        }

        void PulseRings()
        {
            float a = 0.75f + 0.25f * Mathf.Sin(Time.time * 2.6f);
            foreach (var kv in rings)
                foreach (var d in kv.Value)
                    d?.SetAlpha(a);
        }

        void DestroyRings(EnemyAI e)
        {
            if (!rings.TryGetValue(e, out var list)) return;
            rings.Remove(e);
            foreach (var d in list)
                if (d != null && d.Transform)
                    Destroy(d.Transform.gameObject);
        }

        void ClearRings()
        {
            ringStale.Clear();
            ringStale.AddRange(rings.Keys);
            foreach (var e in ringStale) DestroyRings(e);
            rings.Clear();
        }

        // ───────────── 变脸 / 碎面 ─────────────

        /// <summary>换到下一张没碎的脸：旧脸的光环撤下，一团火光盖住换脸</summary>
        public void SwapFace()
        {
            swapped = true;
            DropAura();
            face = NextFace(face, broken);
            maskDamage = 0;
            ApplyFace();
            if (!Application.isPlaying) return;
            var p = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up * 1.4f * Size;
            Fx.Burst(p, EmberColor, 22, 2.6f, 0.45f, 0.09f, -2);
            Fx.Burst(p, CurrentFace.Readable, 12, 1.8f, 0.5f, 0.07f, -1);
            GameAudio.PlayAt("skill_fire", p, 0.7f, 1.2f);
        }

        /// <summary>把当前的脸画到面前的火光上（面具本身的分区换色归 FX4，订阅 <see cref="FaceChanged"/>）</summary>
        void ApplyFace()
        {
            if (faceGlow)
            {
                var c = CurrentFace.eye;
                FxMaterials.Tint(faceGlow.GetComponent<Renderer>(), new Color(c.r, c.g, c.b, 0.55f));
            }
            try
            {
                FaceChanged?.Invoke(this, face);
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
            }
        }

        /// <summary>面具中弹：只算从正面打中、没被袖子挡住、这张脸没碎</summary>
        void OnMaskHit(HitZone z, DamageInfo info, DamageResult r)
        {
            if (Dead || !info.weakpoint || MaskCovered || broken[face] || r.total <= 0) return;
            maskDamage += r.total;
            if (maskDamage >= hp.maxHealth * MaskBreak) BreakFace();
            else GameAudio.PlayAt("hit_armor", info.point, 0.6f, 1.4f);
        }

        /// <summary>碎面：这张脸的加成立刻撤掉、以后不再换回来；捂脸踉跄 2 s，6 s 内不能变脸</summary>
        public void BreakFace()
        {
            broken[face] = true;
            maskDamage = 0;
            DropAura();
            InterruptAttack();
            lockUntil = Time.time + LockTime;
            // 锁定一结束就换下一张脸（碎掉的这张没有加成）
            faceTimer = 0;
            ApplyFace();
            var p = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up * 1.4f * Size;
            if (Application.isPlaying)
            {
                Fx.Burst(p, WoodChip, 18, 3.5f, 0.8f, 0.07f, 12);
                Fx.Burst(p, EmberColor, 14, 2.5f, 0.5f, 0.07f, 2);
                GameUI.FloatText(p + Vector3.up * 0.3f, Faces[face].name + "碎了", Faces[face].Readable, 1f);
            }
            GameAudio.PlayAt("shield_break", p, 0.9f, 1.2f);
            Sfx("boss_roar", 0.3f, 2.4f);
            Play("cover", 0.06f);
            SetState("cover");
        }

        // ───────────── 吐火 ─────────────

        void BeginSpit()
        {
            windTime = Windup(SpitWindup, 0.35f);
            spitYaw = transform.eulerAngles.y * Mathf.Deg2Rad;
            // 从玩家那一侧的反面扫起（扫过玩家）
            var to = PlayerPos - transform.position;
            float rel = Mathf.DeltaAngle(spitYaw * Mathf.Rad2Deg, Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg);
            spitSign = rel >= 0 ? 1 : -1;
            SetState("spitWindup");
            PlayTimed("spitWindup", windTime);
            if (Application.isPlaying) spitMark = Telegraph.Sector(transform.position, spitYaw * Mathf.Rad2Deg, 90, SpitRange, windTime, EmberColor, 0.6f);
            Sfx("telegraph", 0.5f, 1.3f);
        }

        /// <summary>火柱：从嘴到 6 m（或第一堵墙）；玩家在火柱上、视线没被挡就每 0.1 s 烫一下；落地那一头留余火</summary>
        void UpdateJet(float dt)
        {
            float yaw = JetYaw(spitYaw, spitSign, stateTime / SpitSweep);
            transform.rotation = Quaternion.Euler(0, spitYaw * Mathf.Rad2Deg, 0);
            var m = MouthWorld;
            var dir = new Vector3(Mathf.Sin(yaw), -0.08f, Mathf.Cos(yaw)).normalized;
            float reach = Physics.Raycast(m, dir, out var wall, SpitRange, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? wall.distance : SpitRange;
            var end = m + dir * reach;
            if (Application.isPlaying)
            {
                Fx.Beam(m, end, EmberColor, 0.32f * Size, 0.1f);
                for (int i = 0; i < 2; i++) Fx.Burst(m + dir * (reach * Random.value), i == 1 ? EmberColor : MoltenColor, 1, 1.2f, 0.3f, 0.12f, -2);
            }
            emberTimer -= dt;
            if (emberTimer <= 0)
            {
                emberTimer += EmberEvery;
                var e = m + dir * (reach * 0.85f);
                float gy = GroundY(e + Vector3.up * 0.5f);
                if (m.y - gy < 3 && Application.isPlaying) FloorFire.Spawn(new Vector3(e.x, gy + 0.02f, e.z), EmberRadius, EmberLife, Damage * EmberMult, 0.5f, this);
            }
            spitTick -= dt;
            if (spitTick > 0) return;
            spitTick += SpitTick;
            if (!JetCovers(transform.position, yaw, reach, PlayerPos)) return;
            var chest = PlayerPos + Vector3.up * 1.15f;
            if (!Combat.LineClear(m, chest)) return;
            if (Taunted) DecoyBlocked(Target);
            else Combat.DamagePlayer(Damage * SpitDps * SpitTick, m, Element.Fire, this);
        }

        // ───────────── 打断 / 死亡 ─────────────

        protected override void CancelAttack()
        {
            SetGlow(0, 0);
            SetGlow(1, 0);
            spitMark.Cancel();
            spitMark = default;
            if (!Dead && state is "spitWindup" or "spit")
            {
                PlayLocomotion();
                SetState("dance");
            }
        }

        void OnDeath(DamageInfo info)
        {
            DropAura();
            if (faceGlow) faceGlow.gameObject.SetActive(false);
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge) || !Application.isPlaying) return;
            var p = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up * 1.4f * Size;
            Fx.Burst(p, WoodChip, 16, 3, 0.9f, 0.07f, 12);
            Fx.Burst(EnemyRegistry.Center(this), EmberColor, 22, 2.5f, 1.2f, 0.08f, -1);
        }

        void OnDisable() => DropAura();
    }
}
