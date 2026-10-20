using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鼯 · 雷鼓机关师（Three.js 版 src/player/skills/falcon.ts）的数值、判定与共用外观。
    /// 被动「凌空」<see cref="FalconSkyborne"/>、E 雷鼓信标 <see cref="FalconStormBeacon"/>（落地展开成 <see cref="ThunderBeacon"/>）、Q 雷目·裁决 <see cref="FalconHawkVerdict"/>。
    /// </summary>
    public static class FalconSkills
    {
        /// <summary>凌空：身处空中时造成的伤害 +15%</summary>
        public const float AirBonus = 0.15f;

        /// <summary>雷鼓配色：青铜三脚架、红漆鼓身、鼓皮</summary>
        public static readonly Color Bronze = Hex.Rgb(0xb5823a), Lacquer = Hex.Rgb(0x8e1f1a), Hide = Hex.Rgb(0xe6d2a8);

        /// <summary>
        /// 凌空的输出倍率：在空中时，玩家打出的伤害（武器 / 技能 / 爆炸 / 秘卷 / 近战）× 1.15。
        /// 持续伤害跳伤不吃（同 TS：source ≠ status）；灵宠（只吃灵宠伤害加成）、环境、敌人自己打自己的也不吃。
        /// </summary>
        public static float AirMultiplier(bool airborne, in DamageInfo info)
        {
            if (!airborne || info.Has(DamageTag.Dot) || info.Has(DamageTag.Pet)) return 1f;
            return info.source is DamageSource.Weapon or DamageSource.Skill or DamageSource.Explosion or DamageSource.Scroll or DamageSource.Melee
                ? 1 + AirBonus
                : 1f;
        }

        /// <summary>武器造成的伤害（直接命中，或武器投射物的爆炸：来源 Explosion + 武器标签）——雷目·裁决只认这种命中弹射</summary>
        public static bool IsWeaponHit(in DamageInfo info) =>
            info.source == DamageSource.Weapon || (info.source == DamageSource.Explosion && info.Has(DamageTag.Weapon));

        /// <summary>雷目·裁决的弹射伤害：该次实际伤害 × 55%，至少 6 点</summary>
        public static float ChainDamage(float dealt) => Mathf.Max(6f, dealt * FalconHawkVerdict.ChainRatio);

        /// <summary>
        /// center 附近 radius 内（到身体：TS queryRadius）可选中的敌人，按脚底到 center 的距离由近到远取前 max 个写进 into（先清空）。
        /// needLos：center 到身体中心不被地形 / 建筑挡住。
        /// </summary>
        public static List<EnemyAI> NearestEnemies(Vector3 center, float radius, int max, List<EnemyAI> into, bool needLos)
        {
            EnemyRegistry.Overlapping(center, radius, into);
            if (needLos)
                for (int i = into.Count - 1; i >= 0; i--)
                {
                    var e = into[i];
                    if (Combat.Blocked(center, EnemyRegistry.Center(e), e.GetComponent<Collider>())) into.RemoveAt(i);
                }
            int k = Mathf.Min(Mathf.Max(0, max), into.Count);
            for (int i = 0; i < k; i++)
            {
                int best = i;
                float bd = (into[i].transform.position - center).sqrMagnitude;
                for (int j = i + 1; j < into.Count; j++)
                {
                    float d = (into[j].transform.position - center).sqrMagnitude;
                    if (d < bd)
                    {
                        bd = d;
                        best = j;
                    }
                }
                if (best != i) (into[i], into[best]) = (into[best], into[i]);
            }
            if (into.Count > k) into.RemoveRange(k, into.Count - k);
            return into;
        }

        // ───────────── 外观（占位：基本体拼装，美术到位后换 Prefab）─────────────

        /// <summary>一个去掉碰撞体、按颜色着色的基本体</summary>
        internal static GameObject Prim(PrimitiveType type, Transform parent, Vector3 pos, Vector3 scale, Color color, Quaternion? rot = null, bool shadow = false)
        {
            var go = GameObject.CreatePrimitive(type);
            var col = go.GetComponent<Collider>();
            if (col)
            {
                // 运行时 Destroy 要到帧末才生效：先停掉，这一帧的射线 / 扫掠不会打到道具
                col.enabled = false;
                Object.Destroy(col);
            }
            go.transform.SetParent(parent, false);
            go.transform.SetLocalPositionAndRotation(pos, rot ?? Quaternion.identity);
            go.transform.localScale = scale;
            var r = go.GetComponent<Renderer>();
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", color);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = shadow ? ShadowCastingMode.On : ShadowCastingMode.Off;
            return go;
        }

        /// <summary>水平的加色圆环（本地坐标，随父物体转动）</summary>
        internal static LineRenderer Ring(Transform parent, float radius, float width, Color color, int segments = 40)
        {
            var go = new GameObject("Ring");
            go.transform.SetParent(parent, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.loop = true;
            lr.positionCount = segments;
            for (int i = 0; i < segments; i++)
            {
                float a = i / (float)segments * Mathf.PI * 2;
                lr.SetPosition(i, new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius));
            }
            lr.widthMultiplier = width;
            lr.sharedMaterial = FxMaterials.Additive;
            lr.startColor = lr.endColor = color;
            lr.shadowCastingMode = ShadowCastingMode.Off;
            lr.receiveShadows = false;
            return lr;
        }

        /// <summary>
        /// 一面雷鼓（鼯腰间那面）：红漆鼓身 + 上下青铜箍 + 上下鼓皮 + 鼓面一圈青色雷纹。鼓心在 parent 原点、鼓轴朝本地 Y，高 0.3 × scale。
        /// 信标与抛出去的小鼓共用。
        /// </summary>
        internal static Transform BuildDrum(Transform parent, float scale)
        {
            var drum = new GameObject("Thunder Drum").transform;
            drum.SetParent(parent, false);
            drum.localScale = Vector3.one * scale;
            Prim(PrimitiveType.Cylinder, drum, Vector3.zero, new Vector3(0.6f, 0.15f, 0.6f), Lacquer, null, true);
            foreach (float y in new[] { -0.15f, 0.15f })
            {
                Prim(PrimitiveType.Cylinder, drum, new Vector3(0, y, 0), new Vector3(0.66f, 0.022f, 0.66f), Bronze);
                Prim(PrimitiveType.Cylinder, drum, new Vector3(0, y + Mathf.Sign(y) * 0.012f, 0), new Vector3(0.56f, 0.004f, 0.56f), Hide);
            }
            Ring(drum, 0.21f, 0.025f, new Color(SkillFx.Shock.r, SkillFx.Shock.g, SkillFx.Shock.b, 0.85f), 24).transform.localPosition = Vector3.up * 0.17f;
            return drum;
        }
    }

    /// <summary>
    /// 被动 · 凌空：可在空中额外跳跃 1 次（英雄基础属性「额外跳跃」，不在这里）；身处空中时造成的伤害提高 15%；
    /// 下落时按住跳跃键张开飞膜滑翔（<see cref="Glide"/> 运动修饰器）。撤销时修饰器一并撤掉。
    /// </summary>
    public sealed class FalconSkyborne : HeroPassive
    {
        public override string Name => "凌空";
        public override string Description =>
            $"可在空中额外跳跃 1 次；身处空中时造成的伤害提高 {FalconSkills.AirBonus * 100:F0}%；下落时按住跳跃键可张开飞膜滑翔，大幅减缓下落。";

        /// <summary>装上的滑翔修饰器（没有运动组件时为 null）</summary>
        public Glide Glider { get; private set; }

        protected override void Install()
        {
            var motor = owner ? owner.Motor : null;
            // 脚下碰到地面（含陡坡）就不算滞空；玩家销毁后 motor 判空为假，修饰器返回 1
            session.Track(Combat.Outgoing.Add((in HitContext c) => FalconSkills.AirMultiplier(motor && !motor.Grounded, in c.info)));
            if (!motor) return;
            Glider = new Glide();
            session.Track(motor.AddModifier(Glider, Glide.Priority));
            session.Track(() => Glider = null);
        }
    }

    /// <summary>
    /// E · 雷鼓信标：掷出一面小雷鼓（19 m/s、上抛 3.5、重力 22，继承 35% 的玩家水平速度，翻滚飞行），
    /// 碰到敌人 / 地面（或 6 s 到期）就在落点正下方的地面展开成 <see cref="ThunderBeacon"/>。2 次充能，每次 10 s。
    /// 结算伤害的是一颗看不见的「载体」投射物（没有伤害、没有爆炸，效果全在落地回调里），小鼓挂在它下面跟着飞。
    /// </summary>
    public sealed class FalconStormBeacon : Skill
    {
        public const float Speed = 19, Lift = 3.5f, Gravity = 22, ThrowLifetime = 6, ProjectileRadius = 0.2f, Spin = 9;

        public FalconStormBeacon()
        {
            id = "falcon_storm_beacon";
            name = "雷鼓信标";
            cooldown = 10;
            maxCharges = 2;
            description = $"投出雷鼓信标，落地后持续 {ThunderBeacon.Duration} 秒，每 {ThunderBeacon.Interval} 秒电击 {ThunderBeacon.Radius} 米内最多 {ThunderBeacon.Targets} 个敌人，" +
                          $"造成 {ThunderBeacon.Damage} 点雷电伤害并必定附加雷殛（可叠层眩晕，但不会触发雷殛弹射）。{maxCharges} 次充能，每次充能 {cooldown} 秒。";
        }

        public override bool Activate()
        {
            if (owner == null || !owner.Vitals || owner.Vitals.Dead) return false;
            var pos = owner.HandOrigin(1, ProjectileRadius);
            var vel = SkillFx.ThrowVelocity(owner, Speed, Lift);
            var p = PlayerProjectile.Spawn(pos, vel, default, ProjectileRadius, ThrowLifetime, Gravity);
            p.color = SkillFx.Shock;
            var drum = FalconSkills.BuildDrum(p.transform, 0.55f);
            drum.gameObject.AddComponent<SpinX>().rate = Spin;
            var by = owner;
            p.onImpact = point => ThunderBeacon.Deploy(point, SkillFx.RadiusScale(by));
            GameAudio.Play("skill_throw", 0.9f, 1.1f);
            return true;
        }

        /// <summary>绕本地 X 轴翻滚（抛出去的小鼓）</summary>
        sealed class SpinX : MonoBehaviour
        {
            public float rate;
            void Update() => transform.Rotate(Vector3.right, rate * Mathf.Rad2Deg * Time.deltaTime, Space.Self);
        }
    }

    /// <summary>
    /// 展开的雷鼓信标（Three.js deployBeacon）：落点正下方的地面上立起三脚铜架托着的雷鼓，0.22 s 内升起；
    /// 0.25 s 起每 0.5 s 一跳（共 10 跳），从鼓顶电光（离地 1.05 m）电击 7 m（× 爆炸范围）内看得见的最近 4 个敌人，
    /// 每个 45 点雷电伤害、必定附加雷殛，按「连锁伤害」结算（深度 1：雷殛照常叠层眩晕，但不再向周围弹射——否则 4 目标 × 每跳弹射，输出约为设计值的 2.5 倍）。
    /// 空放时偶尔向地面打一道电弧噼啪。5 s 后收起。挂在当前关卡场景里，换关随场景卸载。
    /// 外观是占位（基本体 + 加色线框），雷鼓道具美术到位后换 Prefab。
    /// </summary>
    public sealed class ThunderBeacon : MonoBehaviour
    {
        public const float Radius = 7, Duration = 5, Interval = 0.5f, FirstZap = 0.25f, Damage = 45, Top = 1.05f, OpenTime = 0.22f;
        public const int Targets = 4;

        static readonly List<ThunderBeacon> live = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        /// <summary>场上展开着的信标数</summary>
        public static int LiveCount => live.Count;
        public static IReadOnlyList<ThunderBeacon> Live => live;

        /// <summary>生效半径（已乘爆炸范围）</summary>
        public float EffectRadius { get; private set; }
        /// <summary>已经跳了几次 / 一共电到过几次敌人（测试读取）</summary>
        public int Zaps { get; private set; }
        public int Hits { get; private set; }

        readonly List<EnemyAI> targets = new();
        Vector3 center, top;
        Transform mast, orb, spin;
        LineRenderer area;
        float t, next = FirstZap, pulse;

        /// <summary>在 point 正下方的地面展开一座信标（找不到地面时就地展开）</summary>
        public static ThunderBeacon Deploy(Vector3 point, float radiusScale = 1f)
        {
            if (!float.IsFinite(point.x + point.y + point.z)) return null;
            float gy = Physics.Raycast(point + Vector3.up * 0.35f, Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : point.y;
            var go = new GameObject("Thunder Beacon");
            var b = go.AddComponent<ThunderBeacon>();
            b.Build(new Vector3(point.x, gy, point.z), Radius * (float.IsFinite(radiusScale) && radiusScale > 0 ? radiusScale : 1f));
            return b;
        }

        void OnEnable()
        {
            if (!live.Contains(this)) live.Add(this);
        }

        void OnDisable() => live.Remove(this);

        void Build(Vector3 c, float radius)
        {
            center = c;
            top = c + Vector3.up * Top;
            EffectRadius = radius;
            transform.position = c;

            mast = new GameObject("Mast").transform;
            mast.SetParent(transform, false);
            for (int i = 0; i < 3; i++)
            {
                float a = i / 3f * Mathf.PI * 2;
                var rot = Quaternion.Euler(Mathf.Sin(a) * 0.3f * Mathf.Rad2Deg, 0, -Mathf.Cos(a) * 0.3f * Mathf.Rad2Deg);
                FalconSkills.Prim(PrimitiveType.Cylinder, mast, new Vector3(Mathf.Cos(a) * 0.2f, 0.34f, Mathf.Sin(a) * 0.2f), new Vector3(0.06f, 0.36f, 0.06f),
                    FalconSkills.Bronze, rot, true);
            }
            FalconSkills.BuildDrum(mast, 1f).localPosition = Vector3.up * 0.78f;
            orb = FalconSkills.Prim(PrimitiveType.Sphere, mast, Vector3.up * Top, Vector3.one * 0.2f, SkillFx.ShockCore * 1.3f).transform;
            orb.GetComponent<Renderer>().sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(orb.GetComponent<Renderer>(), SkillFx.ShockCore * 1.3f);
            FxMaterials.GlowSprite(orb, 5f, new Color(SkillFx.Shock.r, SkillFx.Shock.g, SkillFx.Shock.b, 0.55f));
            spin = new GameObject("Spin").transform;
            spin.SetParent(mast, false);
            spin.localPosition = Vector3.up * 0.88f;
            var line = new Color(SkillFx.Shock.r, SkillFx.Shock.g, SkillFx.Shock.b, 0.9f);
            FalconSkills.Ring(spin, 0.42f, 0.03f, line).transform.localRotation = Quaternion.Euler(0.35f * Mathf.Rad2Deg, 0, 0);
            FalconSkills.Ring(spin, 0.336f, 0.03f, line).transform.localRotation = Quaternion.Euler(-0.35f * Mathf.Rad2Deg, 0, 0);
            mast.localScale = new Vector3(1, 0.01f, 1);

            // 范围边线：贴着地形（一圈 72 个点各打一条向下的射线），坡地上不会悬空或埋进地里
            var ag = new GameObject("Area");
            ag.transform.SetParent(transform, false);
            area = ag.AddComponent<LineRenderer>();
            area.useWorldSpace = true;
            area.loop = true;
            const int seg = 72;
            area.positionCount = seg;
            for (int i = 0; i < seg; i++)
            {
                float a = i / (float)seg * Mathf.PI * 2;
                var p = c + new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius);
                if (Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var h, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = h.point.y;
                area.SetPosition(i, p + Vector3.up * 0.06f);
            }
            area.widthMultiplier = 0.07f;
            area.sharedMaterial = FxMaterials.Additive;
            area.startColor = area.endColor = new Color(SkillFx.Shock.r, SkillFx.Shock.g, SkillFx.Shock.b, 0.8f);
            area.shadowCastingMode = ShadowCastingMode.Off;
            area.receiveShadows = false;

            SkillFx.Ring(c, radius, SkillFx.Shock, 0.5f);
            SkillFx.Burst(top, SkillFx.Shock, 22, 5, 0.5f, 0.06f, -0.4f);
            GameAudio.PlayAt("skill_shock", c, 0.9f);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            float open = Mathf.Min(1, t / OpenTime);
            mast.localScale = new Vector3(1, 1 - Mathf.Pow(1 - open, 3) + 0.01f, 1);
            spin.localRotation = Quaternion.Euler(0, t * 5 * Mathf.Rad2Deg, 0);
            spin.localPosition = Vector3.up * (0.88f + Mathf.Sin(t * 6) * 0.05f);
            pulse = Mathf.Max(0, pulse - dt * 4);
            orb.localScale = Vector3.one * (0.2f * (1 + pulse * 0.9f + Mathf.Sin(t * 20) * 0.05f));
            area.widthMultiplier = 0.07f * (1 + pulse * 0.8f);
            if (t >= next && next <= Duration)
            {
                next += Interval;
                if (Zap() > 0) pulse = 1;
                else pulse = Mathf.Max(pulse, 0.35f);
            }
            if (t >= Duration)
            {
                SkillFx.Burst(top, SkillFx.Shock, 16, 3.5f, 0.45f, 0.05f, -0.6f);
                SkillFx.Burst(center, SkillFx.ShockCore, 8, 2, 0.3f, 0.04f);
                Destroy(gameObject);
            }
        }

        /// <summary>一跳：电击范围内看得见的最近 4 个敌人；返回电到的个数</summary>
        int Zap()
        {
            Zaps++;
            FalconSkills.NearestEnemies(top, EffectRadius, Targets, targets, true);
            int n = 0;
            // 伤害结算会同步派发事件：先拷出目标再逐个结算（监听者可能嵌套查询敌人）
            var list = targets.ToArray();
            targets.Clear();
            foreach (var e in list)
            {
                if (!e || e.Dead || !e.Health) continue;
                var body = EnemyRegistry.Center(e);
                Lightning.Spawn(top, body, SkillFx.Shock);
                var info = SkillFx.SkillHit(Damage, Element.Shock, 1f);
                info.depth = 1;
                info.point = body;
                info.direction = (body - top).normalized;
                Combat.DamageEnemy(e.Health, info);
                n++;
            }
            Hits += n;
            if (n > 0) GameAudio.PlayAt("shock_zap", top, 0.65f);
            else if (Random.value < 0.55f)
            {
                // 空放时的电弧噼啪
                float a = Random.value * Mathf.PI * 2, r = 0.6f + Random.value * 1.2f;
                Lightning.Spawn(top, new Vector3(top.x + Mathf.Cos(a) * r, center.y + 0.05f, top.z + Mathf.Sin(a) * r), SkillFx.Shock, 0.05f);
            }
            return n;
        }
    }

    /// <summary>
    /// Q · 雷目·裁决：8 s 内射击不消耗弹匣（<see cref="WeaponController.AddInfiniteAmmo"/>）、射速 +40%，
    /// 武器每次命中（直接命中或武器投射物的爆炸，深度 0、实际造成了伤害）都从命中点向 10 m 内另一名看得见的敌人弹射闪电，
    /// 造成该次伤害 55%（至少 6）的雷电技能伤害（25% 附着雷殛、不暴击、深度 1：不会再弹）。冷却 25 s。
    /// 持续型技能：加成、订阅、无限弹药都登记在撤销栈里，结束 / 阵亡 / 换关时干净撤销；自然结束时放一圈收尾电光。
    /// </summary>
    public sealed class FalconHawkVerdict : TimedSkill
    {
        public const float Duration = 8, FireRate = 0.4f, ChainRange = 10, ChainRatio = 0.55f, ChainStatusChance = 0.25f, SparkInterval = 0.28f;

        float spark, lastChainSound = -1;

        /// <summary>本次已经弹射了几道闪电（测试读取）</summary>
        public int Chains { get; private set; }

        public FalconHawkVerdict()
        {
            id = "falcon_hawk_verdict";
            name = "雷目·裁决";
            cooldown = 25;
            maxCharges = 1;
            duration = Duration;
            description = $"{Duration} 秒内射击不消耗弹匣、射速提高 {FireRate * 100:F0}%，武器每次命中都会向 {ChainRange} 米内另一名敌人弹射闪电，" +
                          $"造成该次伤害 {ChainRatio * 100:F0}% 的雷电伤害。冷却 {cooldown} 秒。";
        }

        protected override bool OnBegin()
        {
            spark = 0;
            Chains = 0;
            AddStat(Stat.FireRatePct, FireRate);
            var weapons = owner.GetComponent<WeaponController>();
            if (weapons)
            {
                weapons.AddInfiniteAmmo();
                Track(() =>
                {
                    if (weapons) weapons.RemoveInfiniteAmmo();
                });
            }
            InAction<HitEvent> onHit = OnHit;
            GameEvents.EnemyDamaged += onHit;
            Track(() => GameEvents.EnemyDamaged -= onHit);

            var p = owner.transform.position;
            SkillFx.Ring(p, 4, SkillFx.Shock, 0.45f);
            SkillFx.Burst(p + Vector3.up * 1.2f, SkillFx.Shock, 30, 5, 0.55f, 0.06f, 0.4f);
            // 天雷落在身前
            var fwd = owner.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-6f ? fwd.normalized : Vector3.forward;
            var strike = p + fwd * 2.2f + Vector3.up * 0.05f;
            Lightning.Spawn(strike + Vector3.up * 11, strike, SkillFx.ShockCore, 0.12f);
            SkillFx.Burst(strike, SkillFx.Shock, 12, 3, 0.35f, 0.05f, -0.8f);
            CameraShake.Add(0.2f, 0.2f);
            GameAudio.Play("skill_buff", 0.8f, 1.15f);
            GameAudio.Play("skill_shock", 0.7f);
            return true;
        }

        protected override void OnTick(float dt)
        {
            spark -= dt;
            if (spark > 0) return;
            spark = SparkInterval;
            SkillFx.Burst(owner.HandOrigin(), SkillFx.Shock, 3, 1.4f, 0.25f, 0.03f);
        }

        protected override void OnEnd(SkillEnd reason)
        {
            if (reason != SkillEnd.Natural || owner == null) return;
            GameAudio.Play("skill_buff", 0.5f, 0.7f);
            SkillFx.Burst(owner.transform.position + Vector3.up * 1.1f, SkillFx.Shock, 12, 2.5f, 0.4f, 0.05f);
        }

        void OnHit(in HitEvent e)
        {
            if (!Active || !e.enemy) return;
            var info = e.info;
            if (!FalconSkills.IsWeaponHit(in info) || info.depth > 0 || !(e.result.total > 0)) return;
            var from = info.point != Vector3.zero ? info.point : ProjectileTargeting.Center(e.enemy);
            var self = e.enemy.GetComponentInParent<EnemyAI>();
            var other = EnemyRegistry.NearestOne(from, ChainRange, EnemyQuery.Targetable, false, self);
            if (!other || !other.Health || other.Health == e.enemy) return;
            var to = EnemyRegistry.Center(other);
            if (Combat.Blocked(from, to, other.GetComponent<Collider>())) return;
            Lightning.Spawn(from, to, SkillFx.Shock);
            float now = Time.time;
            if (now - lastChainSound > 0.08f)
            {
                lastChainSound = now;
                GameAudio.PlayAt("shock_zap", to, 0.45f, 1.2f);
            }
            var chain = SkillFx.SkillHit(FalconSkills.ChainDamage(e.result.total), Element.Shock, ChainStatusChance);
            chain.noCrit = true;
            chain.depth = 1;
            chain.point = to;
            chain.direction = (to - from).normalized;
            Chains++;
            Combat.DamageEnemy(other.Health, chain);
        }
    }
}
