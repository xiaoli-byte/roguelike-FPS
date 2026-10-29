using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>燎 · 爆竹游侠（Three.js 版 src/player/skills/fox.ts）的数值与共用外观</summary>
    public static class LiaoSkills
    {
        public const float EmberBonus = 0.2f;
        public static readonly Color Fire = new(1f, 0.45f, 0.12f), FireCore = new(1f, 0.85f, 0.45f), Ember = new(1f, 0.6f, 0.2f);

        /// <summary>燎的技能伤害：火元素、必定灼烧</summary>
        public static DamageInfo SkillHit(float amount) => SkillFx.SkillHit(amount, Element.Fire, 1f);

        /// <summary>
        /// 火灵外观（HC3，按 docs/art/fx-style.md）：一团卡通火苗（SF_FxFlame 火舌：白热芯 / 橙 / 赭红尖三段，往上翻、顶端分舌）
        /// 底下一颗小小的金色热核。原来是发白的热核 + 5 倍柔光晕，读成一团发光球（准则：形状先于细节、不用发光团）。
        /// 火舌按世界尺寸画（不随父物体缩放），出场的缩放 / 淡入由调用方用 <see cref="FlameTongue.Set(float)"/> 给
        /// </summary>
        public static GameObject Orb(float size)
        {
            var go = new GameObject("Foxfire");
            var core = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Object.Destroy(core.GetComponent<Collider>());
            core.transform.SetParent(go.transform, false);
            core.transform.localScale = Vector3.one * size;
            var r = core.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(r, FireCore);
            FlameTongue.Attach(go.transform, Vector3.down * size * 0.4f, new Vector3(size * 2.6f, size * 3.4f, 1f),
                Hex.Rgb(0xfff1c0), Hex.Rgb(0xff8a24), Hex.Rgb(0xc8401a));
            return go;
        }
    }

    /// <summary>被动 · 余烬：对处于灼烧状态的敌人造成的所有伤害提高 20%</summary>
    public sealed class LiaoEmber : HeroPassive
    {
        public override string Name => "余烬";
        public override string Description => $"对处于灼烧状态的敌人造成的所有伤害提高 {LiaoSkills.EmberBonus * 100:F0}%。";

        protected override void Install() =>
            session.Track(Combat.Outgoing.Add((in HitContext c) => EnemyStatus.IsBurning(c.target) ? 1 + LiaoSkills.EmberBonus : 1f));
    }

    /// <summary>
    /// E · 燃爆雷：掷出一枚爆竹手雷（21 m/s、上抛 3.2、重力 20，继承 35% 的玩家水平速度），触地或命中敌人爆炸，
    /// 4.5 m（× 爆炸范围）内 120 点火焰伤害、必定灼烧、击退 7。2 次充能，每次 8 s。
    /// 落点：火星、地面裂纹、扩散环、余火（爆炸本身的伤害 / 音效 / 震屏由投射物的 Combat.Explode 结算）。
    /// </summary>
    public sealed class LiaoBlazeGrenade : Skill
    {
        const float Radius = 4.5f, Damage = 120, Speed = 21, Lift = 3.2f, Gravity = 20, Lifetime = 4, Knockback = 7, ProjectileRadius = 0.2f;

        public LiaoBlazeGrenade()
        {
            id = "fox_blaze_grenade";
            name = "燃爆雷";
            cooldown = 8;
            maxCharges = 2;
            description = $"掷出一枚爆竹手雷，触地或命中敌人即爆炸，对 {Radius} 米内敌人造成 {Damage} 点火焰伤害，并必定附加灼烧。{maxCharges} 次充能，每次充能 {cooldown} 秒。";
        }

        public override bool Activate()
        {
            if (owner == null || !owner.Vitals || owner.Vitals.Dead) return false;
            var pos = owner.HandOrigin(1, ProjectileRadius);
            var vel = SkillFx.ThrowVelocity(owner, Speed, Lift);
            float r = Radius * SkillFx.RadiusScale(owner);
            var dmg = LiaoSkills.SkillHit(Damage);
            dmg.knockback = Knockback;
            var p = PlayerProjectile.Spawn(pos, vel, dmg, ProjectileRadius, Lifetime, Gravity, r);
            BuildCracker(p.transform);
            GameAudio.Play("skill_throw", 0.9f);
            p.onImpact = point => ImpactFx(point, r);
            return true;
        }

        /// <summary>
        /// Three.js grenadeImpactFx 的 Unity 版：爆炸本体（火团 / 祥云烟 / 闪光）由 Combat.Explode 的 Fx.Explosion 出，这里只补
        /// 少量大颗火星、贴地时的地面裂纹、扩散环和余火。HC3 风格整改：去掉叠在爆炸上的 6 倍枪口闪光（亮沙上白成一团）、
        /// 两层 48 颗细火星减到 12 颗大一点的，余火从零碎火星团换成纸灰地火（爆竹的红纸灰、边缘还在烧）+ 几簇卡通火苗
        /// </summary>
        static void ImpactFx(Vector3 point, float r)
        {
            GameAudio.PlayAt("skill_fire", point, 0.9f);
            SkillFx.Burst(point, SkillFx.Ember, 12, 7, 0.7f, 0.13f, 0.6f);
            float gy = Physics.Raycast(point + Vector3.up * 0.35f, Vector3.down, out var hit, 3f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : point.y - 10;
            bool nearGround = point.y - gy < 1.2f;
            var feet = nearGround ? new Vector3(point.x, gy, point.z) : point;
            if (nearGround) SkillFx.GroundCrack(feet, r * 0.55f, LiaoSkills.Fire, 1.4f);
            SkillFx.Ring(feet, r, LiaoSkills.Fire, 0.4f);
            if (nearGround) Afterburn(feet, r);
        }

        /// <summary>余火：落点一摊纸灰地火（1.6 s）+ 四簇卡通火苗（0.9 s，同 Three.js 的余火时长）</summary>
        static void Afterburn(Vector3 feet, float r)
        {
            FxDecals.Fire(feet + Vector3.up * 0.02f, r * 0.5f, 1.6f, FireBed.PaperAsh);
            FlameTongues.Ground(feet, r * 0.4f, 4, 0.9f, 0.6f, Hex.Rgb(0xfff1c0), Hex.Rgb(0xff8a24), Hex.Rgb(0xc8401a));
        }

        /// <summary>朱红纸筒 + 金色封口 + 冒火星的引信（沿飞行方向）</summary>
        static void BuildCracker(Transform parent)
        {
            var root = new GameObject("Firecracker").transform;
            root.SetParent(parent, false);
            root.localRotation = Quaternion.Euler(90, 0, 0);
            void Part(PrimitiveType type, Vector3 pos, Vector3 scale, Color c)
            {
                var go = GameObject.CreatePrimitive(type);
                Object.Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(root, false);
                go.transform.localPosition = pos;
                go.transform.localScale = scale;
                var rend = go.GetComponent<Renderer>();
                var block = new MaterialPropertyBlock();
                block.SetColor("_BaseColor", c);
                rend.SetPropertyBlock(block);
            }
            Part(PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.15f, 0.13f, 0.15f), new Color(0.78f, 0.14f, 0.1f));
            Part(PrimitiveType.Cylinder, Vector3.up * 0.12f, new Vector3(0.158f, 0.02f, 0.158f), new Color(0.85f, 0.64f, 0.25f));
            Part(PrimitiveType.Cylinder, Vector3.down * 0.12f, new Vector3(0.158f, 0.02f, 0.158f), new Color(0.85f, 0.64f, 0.25f));
            // 引信头一小簇卡通火苗（原来是 0.35 m 的柔光片，HC3 按特效风格准则换成和火灵同一套的火舌）
            var spark = new GameObject("Spark").transform;
            spark.SetParent(root, false);
            spark.localPosition = Vector3.up * 0.2f;
            FlameTongue.Attach(spark, Vector3.zero, new Vector3(0.22f, 0.26f, 1f), Hex.Rgb(0xfff1c0), Hex.Rgb(0xffa030), Hex.Rgb(0xd8401a));
        }
    }

    /// <summary>
    /// Q · 尾焰火灵：唤出九团绕身的火灵，3 s 内依次射向前方敌人并追踪（17 m/s、转向 7 rad/s），
    /// 每团 60 点火焰伤害并附加灼烧，优先分散到不同目标。冷却 20 s。
    /// 持续型技能（<see cref="TimedSkill"/>）：九团都发射完即结束；阵亡 / 换关时没发出去的火灵随撤销栈一起清掉。
    /// </summary>
    public sealed class LiaoNineTails : TimedSkill
    {
        const int Count = 9;
        const float Duration = 3, First = 0.3f, Interval = (Duration - First) / (Count - 1);
        const float Damage = 60, Speed = 17, Homing = 7, Range = 45, ProjectileRadius = 0.3f;

        readonly List<GameObject> orbs = new();
        readonly Dictionary<Damageable, int> targeted = new();
        int launched;

        public LiaoNineTails()
        {
            id = "fox_nine_tails";
            name = "尾焰火灵";
            cooldown = 20;
            duration = 0; // 九团发射完由 OnTick 结束（最后一团在 3 s 时发出）
            description = $"唤出九团绕尾而行的火灵，{Duration} 秒内依次射向前方敌人并自动追踪，每团造成 {Damage} 点火焰伤害并附加灼烧，会优先分散到不同目标。冷却 {cooldown} 秒。";
        }

        protected override bool OnBegin()
        {
            launched = 0;
            targeted.Clear();
            orbs.Clear();
            for (int i = 0; i < Count; i++)
            {
                var o = LiaoSkills.Orb(0.14f);
                o.transform.position = OrbPosition(i, 0);
                o.transform.localScale = Vector3.one * 0.01f;
                orbs.Add(o);
            }
            // 没发出去的火灵在结束 / 被打断时清掉（发出去的已经挂在投射物下，随投射物结束）
            Track(DestroyUnlaunched);
            var p = owner.transform.position;
            SkillFx.Burst(p + Vector3.up * 1.1f, LiaoSkills.Fire, 26, 4, 0.6f, 0.1f, -0.4f);
            SkillFx.Ring(p, 3.2f, LiaoSkills.Fire, 0.45f);
            GameAudio.Play("skill_buff", 0.7f, 1.1f);
            GameAudio.Play("skill_fire", 0.8f, 0.8f);
            return true;
        }

        Vector3 OrbPosition(int i, float t)
        {
            var p = owner.transform.position;
            float a = t * 2.6f + i / (float)Count * Mathf.PI * 2;
            float r = 1f + 0.08f * Mathf.Sin(t * 5 + i);
            return new Vector3(p.x + Mathf.Sin(a) * r, owner.Eye.position.y - 0.42f + 0.1f * Mathf.Sin(t * 4 + i * 1.3f), p.z + Mathf.Cos(a) * r);
        }

        protected override void OnTick(float dt)
        {
            float t = Elapsed;
            float grow = Mathf.Min(1, t / 0.25f);
            for (int i = launched; i < orbs.Count; i++)
            {
                if (!orbs[i]) continue;
                orbs[i].transform.position = OrbPosition(i, t);
                orbs[i].transform.localScale = Vector3.one * grow * (0.9f + 0.15f * Mathf.Sin(t * 12 + i * 2.1f));
                // 火舌按世界尺寸画、不跟父物体缩放：出场时用亮度淡入
                var tongue = orbs[i].GetComponentInChildren<FlameTongue>();
                if (tongue) tongue.Set(grow);
            }
            while (launched < Count && t >= First + launched * Interval) Launch(launched++);
            if (launched >= Count) End(SkillEnd.Natural);
        }

        protected override void OnEnd(SkillEnd reason)
        {
            orbs.Clear();
            targeted.Clear();
        }

        void Launch(int i)
        {
            var orb = orbs[i];
            if (!orb) return;
            var eye = owner.Eye;
            var pos = orb.transform.position;
            // 贴墙时火灵可能在墙里，改从手边发出（手边的出手点自己会停在墙前）
            if (Combat.Blocked(eye.position, pos, null)) pos = owner.HandOrigin(i % 2 == 0 ? 1 : -1, ProjectileRadius);
            var target = SkillFx.PickTarget(eye.position, eye.forward, Range, d => targeted.TryGetValue(d, out var n) ? 0.3f * n : 0);
            Vector3 dir;
            if (target)
            {
                targeted[target] = targeted.TryGetValue(target, out var n) ? n + 1 : 1;
                dir = (PlayerProjectile.Center(target) - pos).normalized;
            }
            else dir = eye.forward;
            // 先向外、向上甩出一道弧线，再由追踪拐向目标
            var outward = pos - owner.transform.position;
            outward.y = 0;
            var vel = dir * Speed + outward.normalized * 4f + Vector3.up * 2.5f;
            var p = PlayerProjectile.Spawn(pos, vel, LiaoSkills.SkillHit(Damage), ProjectileRadius, 3.5f, 0, 0, Homing, target);
            orb.transform.SetParent(p.transform, false);
            orb.transform.localPosition = Vector3.zero;
            orb.transform.localScale = Vector3.one * 1.3f;
            var trail = p.gameObject.AddComponent<TrailRenderer>();
            trail.time = 0.25f;
            trail.startWidth = 0.22f;
            trail.endWidth = 0;
            trail.sharedMaterial = FxMaterials.Additive;
            trail.startColor = new Color(LiaoSkills.Fire.r, LiaoSkills.Fire.g, LiaoSkills.Fire.b, 0.9f);
            trail.endColor = new Color(1f, 0.25f, 0.05f, 0);
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            p.onImpact = point => SkillFx.Burst(point, SkillFx.Ember, 12, 4.5f, 0.4f, 0.08f, 0.4f);
            SkillFx.Burst(pos, SkillFx.FireCore, 6, 2, 0.25f, 0.06f);
            GameAudio.Play("skill_fire", 0.45f, 1.15f + Random.value * 0.25f);
        }

        void DestroyUnlaunched()
        {
            foreach (var o in orbs)
                if (o && !o.GetComponentInParent<PlayerProjectile>())
                    Object.Destroy(o);
        }
    }
}
