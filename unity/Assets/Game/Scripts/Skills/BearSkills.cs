using System;
using System.Collections;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>
    /// 磐 · 工匠武僧（Three.js 版 src/player/skills/bear.ts）的数值与共用外观。
    /// 被动「厚皮」<see cref="BearThickHide"/>、E 裂地重击 <see cref="BearEarthSplitter"/>、Q 磐石壁垒 <see cref="BearBastion"/>。
    /// 三处冲击波都走 <see cref="SkillFx.Shockwave"/>：砸地不是爆炸（不吃爆炸加成），lift 经 <see cref="EnemyAI.LaunchUp"/> 把敌人震上半空。
    /// </summary>
    public static class BearSkills
    {
        /// <summary>厚皮：护盾恢复延迟 −1 s；破盾冲击波 6 m、60 伤害、击退 16、上抛 6、内置冷却 8 s</summary>
        public const float HideRegenDelay = -1f, HideWaveRadius = 6, HideWaveDamage = 60, HideWaveKnockback = 16, HideWaveLift = 6, HideWaveIcd = 8;
        public const string PassiveSource = "passive:bear";

        /// <summary>破盾冲击波的内置冷却到了没有</summary>
        public static bool HideWaveReady(float now, float lastWave) => now - lastWave >= HideWaveIcd;

        static Mesh ringOuter, ringInner, ringCore;

        /// <summary>
        /// 脚下旋转的金色符阵（Three.js getRune）：外圈 48 段圆环、内圈六边形环、中心三角环，加色、两面可见。
        /// 返回根物体与要转动的外圈 / 内圈。
        /// </summary>
        internal static Transform BuildRune(out Transform outer, out Transform inner)
        {
            ringOuter ??= RingMesh(1.15f, 1.3f, 48, "Rune Outer");
            ringInner ??= RingMesh(0.72f, 0.8f, 6, "Rune Inner");
            ringCore ??= RingMesh(0.35f, 0.4f, 3, "Rune Core");
            var root = new GameObject("Bastion Rune").transform;
            var color = new Color(SkillFx.Gold.r, SkillFx.Gold.g, SkillFx.Gold.b, 0.7f);
            outer = Part(root, ringOuter, color);
            inner = Part(root, ringInner, color);
            Part(root, ringCore, color);
            return root;
        }

        static Transform Part(Transform parent, Mesh mesh, Color color)
        {
            var go = new GameObject(mesh.name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = FxMaterials.Additive;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", color);
            r.SetPropertyBlock(block);
            return go.transform;
        }

        /// <summary>XZ 平面上的圆环（inner–outer，segments 段；3 段 = 三角环、6 段 = 六边形环）</summary>
        static Mesh RingMesh(float inner, float outer, int segments, string name)
        {
            var v = new Vector3[segments * 2];
            var tris = new int[segments * 6];
            for (int i = 0; i < segments; i++)
            {
                float a = i / (float)segments * Mathf.PI * 2 + Mathf.PI / 2;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v[i * 2] = dir * inner;
                v[i * 2 + 1] = dir * outer;
                int n = (i + 1) % segments, t = i * 6;
                tris[t] = i * 2;
                tris[t + 1] = n * 2 + 1;
                tris[t + 2] = i * 2 + 1;
                tris[t + 3] = i * 2;
                tris[t + 4] = n * 2;
                tris[t + 5] = n * 2 + 1;
            }
            var m = new Mesh { name = name, vertices = v, triangles = tris };
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>以脚底为圆心的砸地冲击波（土黄 / 金两色、地面裂纹），半径吃爆炸范围；返回造成伤害的敌人数</summary>
        internal static int Wave(HeroSkills owner, float radius, float damage, float knockback, float lift, float falloff, Color color, Color secondary, float stun = 0)
        {
            if (owner == null) return 0;
            var o = new ShockwaveOptions(radius * SkillFx.RadiusScale(owner), damage, color)
            {
                knockback = knockback, lift = lift, stun = stun, falloff = falloff, secondaryColor = secondary, crack = true,
            };
            return SkillFx.Shockwave(owner.transform.position, in o);
        }
    }

    /// <summary>
    /// 被动 · 厚皮：护盾恢复延迟缩短 1 s；护盾被击破时释放震地冲击波，对 6 m 内敌人造成 60 点伤害并击退、掀起（内置冷却 8 s）。
    /// 冲击波推迟到下一帧再放（同 TS：不在敌人攻击结算途中重入战斗系统）；撤销时连同还没放出的那一下一起取消。
    /// </summary>
    public sealed class BearThickHide : HeroPassive
    {
        public override string Name => "厚皮";
        public override string Description =>
            $"护盾恢复延迟缩短 {Mathf.Abs(BearSkills.HideRegenDelay)} 秒；护盾被击破时释放震地冲击波，对 {BearSkills.HideWaveRadius} 米内敌人造成 " +
            $"{BearSkills.HideWaveDamage} 点伤害并将其击退（内置冷却 {BearSkills.HideWaveIcd} 秒）。";

        float lastWave = float.NegativeInfinity;
        Coroutine pending;

        /// <summary>放过几次破盾冲击波（测试读取）</summary>
        public int Waves { get; private set; }

        protected override void Install()
        {
            var stats = owner ? owner.Stats : null;
            if (stats != null)
            {
                stats.Add(BearSkills.PassiveSource, Stat.ShieldRegenDelay, BearSkills.HideRegenDelay);
                session.Track(() => stats.Remove(BearSkills.PassiveSource));
            }
            var vitals = owner ? owner.Vitals : null;
            if (vitals)
            {
                Action onBroken = OnShieldBroken;
                vitals.ShieldBroken += onBroken;
                session.Track(() =>
                {
                    if (vitals) vitals.ShieldBroken -= onBroken;
                });
            }
            session.Track(CancelPending);
        }

        void OnShieldBroken()
        {
            if (!owner || !owner.Vitals || owner.Vitals.Dead || !owner.isActiveAndEnabled) return;
            float now = Time.time;
            if (!BearSkills.HideWaveReady(now, lastWave)) return;
            lastWave = now;
            CancelPending();
            pending = owner.StartCoroutine(Deferred());
        }

        IEnumerator Deferred()
        {
            yield return null;
            pending = null;
            if (!owner || !owner.Vitals || owner.Vitals.Dead) yield break;
            Waves++;
            BearSkills.Wave(owner, BearSkills.HideWaveRadius, BearSkills.HideWaveDamage, BearSkills.HideWaveKnockback, BearSkills.HideWaveLift, 0.4f,
                SkillFx.Earth, SkillFx.Gold);
            CameraShake.Add(0.4f, 0.25f);
            GameAudio.Play("skill_earth", 0.85f, 0.9f);
        }

        void CancelPending()
        {
            if (pending != null && owner) owner.StopCoroutine(pending);
            pending = null;
        }
    }

    /// <summary>
    /// E · 裂地重击：向前跃起（水平 8、上抛 7 m/s）后重砸地面；在空中释放则水平速度留 40%、以 22 m/s 向下猛砸。
    /// 下落段额外 +20 m/s² 重力（砸得更有分量），期间锁冲刺（冲刺会托住下落、吞掉砸地）。
    /// 落地（地面起跳要先离地 0.12 s，防止起跳当帧误判）或 1.8 s 兜底时以脚底为圆心砸出冲击波：6 m（× 爆炸范围）内 150 点伤害（边缘 35%）、
    /// 击退 15、上抛 7（敌人被震上半空）、眩晕 1.2 s。2 次充能，每次 9 s。
    /// 地面 / 空中按「脚下 0.35 m 内有地面、竖直速度在 −2…0.5 m/s 之间」也算站在地上：贴着敌人站时角色控制器会被敌人胶囊顶得这一帧没踩实地，
    /// 以前会被当成空中释放——原地 −22 m/s 下砸、下一帧就砸完，没有跃起（真正从空中落下时竖直速度早就低于 −2，照旧立即下砸）。
    /// 持续型技能：跃起期间不能再放；阵亡 / 换关时撤掉修饰器、不砸。
    /// </summary>
    public sealed class BearEarthSplitter : TimedSkill
    {
        public const float Radius = 6, Damage = 150, Stun = 1.2f, Knockback = 15, Lift = 7, Falloff = 0.35f;
        public const float LeapForward = 8, LeapUp = 7, DownSpeed = 22, ExtraGravity = 20, MinAir = 0.12f, MaxLeap = 1.8f, AirKeep = 0.4f;

        /// <summary>脚下这么近有地面且几乎没有竖直速度，就按地面起跳</summary>
        public const float GroundSnap = 0.35f;

        bool fromAir;

        /// <summary>上一次砸地命中的敌人数（测试读取）；-1 = 还没砸过</summary>
        public int LastHits { get; private set; } = -1;
        /// <summary>上一次是按空中释放（直接下砸）放的（测试读取）</summary>
        public bool LastFromAir => fromAir;

        public BearEarthSplitter()
        {
            id = "bear_earth_splitter";
            name = "裂地重击";
            cooldown = 9;
            maxCharges = 2;
            duration = 0; // 落地即砸，由 OnTick 结束
            description = $"向前跃起后重砸地面，对 {Radius} 米内敌人造成 {Damage} 点伤害、强力击退并眩晕 {Stun} 秒；在空中释放则立即向下猛砸。" +
                          $"{maxCharges} 次充能，每次充能 {cooldown} 秒。";
        }

        protected override bool OnBegin()
        {
            var m = owner.Motor;
            if (!m) return false;
            fromAir = !OnGround(m);
            if (!fromAir)
            {
                var f = owner.transform.forward;
                f.y = 0;
                f = f.sqrMagnitude > 1e-6f ? f.normalized : Vector3.forward;
                // Launch 先结束冲刺再设速度（冲刺会每帧覆盖速度，不打断的话起跳会被吞掉）
                m.Launch(new Vector3(f.x * LeapForward, LeapUp, f.z * LeapForward));
                GameAudio.Play("jump", 0.8f, 0.75f);
            }
            else
            {
                var v = m.Velocity;
                m.Launch(new Vector3(v.x * AirKeep, -DownSpeed, v.z * AirKeep));
            }
            GameAudio.Play("dash", 0.7f, 0.65f);
            float g = Mathf.Max(1f, m.gravity);
            AddMotor(MotorMods.From((ref MotorFrame fr) =>
            {
                fr.locks |= MotorLock.Dash;
                if (fr.velocity.y < 0) fr.gravityScale *= 1 + ExtraGravity / g;
            }));
            return true;
        }

        /// <summary>按地面起跳：踩着地面，或者脚下 <see cref="GroundSnap"/> 内就是地面、竖直速度在 −2…0.5 m/s（被敌人胶囊顶起一点、下台阶的那一帧）</summary>
        static bool OnGround(PlayerMotor m)
        {
            if (m.Grounded) return true;
            float vy = m.Velocity.y;
            if (vy > 0.5f || vy < -2f) return false;
            return Physics.Raycast(m.transform.position + Vector3.up * 0.1f, Vector3.down, GroundSnap + 0.1f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        protected override void OnTick(float dt)
        {
            var m = owner.Motor;
            bool landed = m && m.Grounded && Elapsed > (fromAir ? 0 : MinAir);
            if (!landed && Elapsed <= MaxLeap) return;
            LastHits = BearSkills.Wave(owner, Radius, Damage, Knockback, Lift, Falloff, SkillFx.Earth, SkillFx.Gold, Stun);
            CameraShake.Add(0.8f, 0.35f);
            GameAudio.Play("skill_earth", 1f);
            GameAudio.Play("explosion", 0.5f, 0.6f);
            End(SkillEnd.Natural);
        }
    }

    /// <summary>
    /// Q · 磐石壁垒：立即回满护盾，8 s 内受到的伤害 −50%、伤害 +25%，脚下金色符阵随行（最后 1 s 闪烁）；
    /// 结束时释放冲击波：7 m（× 爆炸范围）内 100 点伤害（边缘 40%）、击退 13、上抛 5。冷却 22 s。
    /// Unity 加强：生效期间身边立一道球形挡弹罩（<see cref="ProjectileWard"/>，胸口为心、半径 1.6 m），从外面飞来的敌方投射物撞上即碎（爆炸弹在罩面引爆）——
    /// 「站桩扛首领大招」的定位落到实处，TS 只有减伤。持续型技能：减伤、加成、挡弹罩、符阵都在撤销栈里，被打断时只撤销、不放收尾冲击波。
    /// </summary>
    public sealed class BearBastion : TimedSkill
    {
        public const float Duration = 8, Reduction = 0.5f, DamagePct = 0.25f;
        public const float WaveRadius = 7, WaveDamage = 100, WaveKnockback = 13, WaveLift = 5, WaveFalloff = 0.4f;
        public const float WardRadius = 1.6f, WardHeight = 1f;

        Transform rune, runeOuter, runeInner;
        float sparkTimer;

        /// <summary>生效中的挡弹罩（没生效时为 null）</summary>
        public ProjectileWard Ward { get; private set; }
        /// <summary>本次挡下了几发（测试读取）</summary>
        public int Blocked { get; private set; }
        /// <summary>上一次收尾冲击波命中的敌人数；-1 = 还没放过</summary>
        public int LastWaveHits { get; private set; } = -1;

        public BearBastion()
        {
            id = "bear_bastion";
            name = "磐石壁垒";
            cooldown = 22;
            maxCharges = 1;
            duration = Duration;
            description = $"立即回满护盾，{Duration} 秒内受到的伤害降低 {Reduction * 100:F0}%、武器伤害提高 {DamagePct * 100:F0}%，并挡下飞来的敌方投射物；" +
                          $"结束时释放冲击波，对 {WaveRadius} 米内敌人造成 {WaveDamage} 点伤害并击退。冷却 {cooldown} 秒。";
        }

        protected override bool OnBegin()
        {
            var v = owner.Vitals;
            Blocked = 0;
            sparkTimer = 0;
            AddIncoming((in IncomingHit _) => 1 - Reduction);
            AddStat(Stat.DamagePct, DamagePct);
            v.AddShield(v.MaxShield);

            // 挡弹罩：挂在玩家身上随行；撤销时先停用（立刻不挡），再销毁
            var wardGo = new GameObject("Bastion Ward");
            wardGo.transform.SetParent(owner.transform, false);
            wardGo.transform.localPosition = Vector3.up * WardHeight;
            var ward = wardGo.AddComponent<ProjectileWard>();
            ward.shape = ProjectileWard.Shape.Sphere;
            ward.radius = WardRadius;
            ward.Blocked += OnWardBlocked;
            Ward = ward;
            Track(() =>
            {
                Ward = null;
                if (!wardGo) return;
                wardGo.SetActive(false);
                Object.Destroy(wardGo);
            });

            rune = Own(BearSkills.BuildRune(out runeOuter, out runeInner));
            PlaceRune(0.2f);

            var p = owner.transform.position;
            SkillFx.Ring(p, 5, SkillFx.Gold, 0.5f);
            SkillFx.Burst(p + Vector3.up, SkillFx.Gold, 32, 4.5f, 0.6f, 0.08f, 0.6f);
            CameraShake.Add(0.3f, 0.25f);
            GameAudio.Play("skill_buff", 0.9f, 0.85f);
            GameAudio.Play("skill_earth", 0.6f, 1.3f);
            return true;
        }

        void OnWardBlocked(ProjectileWard w, Vector3 point, float damage)
        {
            Blocked++;
            SkillFx.Burst(point, SkillFx.Gold, 8, 2.5f, 0.3f, 0.05f);
            GameAudio.PlayAt("hit_armor", point, 0.6f, 1.2f);
        }

        void PlaceRune(float scale)
        {
            if (!rune) return;
            rune.position = owner.transform.position + Vector3.up * 0.05f;
            rune.localScale = Vector3.one * scale;
        }

        protected override void OnTick(float dt)
        {
            float t = Elapsed;
            float open = Mathf.Min(1, t / 0.3f);
            // 最后 1 秒闪烁提示即将结束
            float blink = Remaining < 1 ? 0.75f + 0.25f * Mathf.Sin(t * 30) : 1;
            PlaceRune((0.2f + 0.8f * (1 - Mathf.Pow(1 - open, 3))) * (1 + 0.03f * Mathf.Sin(t * 6)) * blink);
            if (runeOuter) runeOuter.Rotate(0, dt * 0.9f * Mathf.Rad2Deg, 0, Space.Self);
            if (runeInner) runeInner.Rotate(0, -dt * 1.6f * Mathf.Rad2Deg, 0, Space.Self);

            sparkTimer -= dt;
            if (sparkTimer > 0) return;
            sparkTimer = 0.4f;
            float a = UnityEngine.Random.value * Mathf.PI * 2;
            var p = owner.transform.position;
            SkillFx.Burst(new Vector3(p.x + Mathf.Cos(a) * 0.9f, p.y + 0.3f, p.z + Mathf.Sin(a) * 0.9f), SkillFx.Gold, 5, 1.2f, 0.6f, 0.05f, 0.6f);
        }

        protected override void OnEnd(SkillEnd reason)
        {
            rune = runeOuter = runeInner = null;
            if (reason != SkillEnd.Natural || owner == null || !owner.Vitals || owner.Vitals.Dead) return;
            LastWaveHits = BearSkills.Wave(owner, WaveRadius, WaveDamage, WaveKnockback, WaveLift, WaveFalloff, SkillFx.Gold, SkillFx.Earth);
            CameraShake.Add(0.5f, 0.3f);
            GameAudio.Play("skill_earth", 0.9f, 1.1f);
        }
    }
}
