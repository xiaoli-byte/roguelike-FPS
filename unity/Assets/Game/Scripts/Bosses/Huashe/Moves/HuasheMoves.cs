using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>化蛇招式的底座：嘴张没张（出招第一帧按招式定，结束时合上）、水位、游线</summary>
    public abstract class HuasheMove : LordMove
    {
        protected HuasheBrain Hua => Brain as HuasheBrain;
        protected HuasheDef HDef => Brain.Def as HuasheDef;
        protected float Level => Hua && Hua.Lake != null ? Hua.Lake.Level : Brain.transform.position.y;
        protected Vector3 Mouth => LordB.BonePos(HuasheDef.MouthBone);
        protected Vector3 Head => LordB.BonePos("head");

        /// <summary>这一招张嘴（嘴是弱点、破防条只在张嘴时填）</summary>
        protected virtual bool OpensMouth => false;

        protected override void Prepare()
        {
            if (Hua) Hua.MouthForced = OpensMouth;
            HuashePrepare();
        }

        protected virtual void HuashePrepare() { }

        protected override void OnEnd(bool cancelled)
        {
            if (Hua)
            {
                Hua.MouthForced = false;
                Hua.Driven = false;
            }
            HuasheEnd(cancelled);
        }

        protected virtual void HuasheEnd(bool cancelled) { }

        /// <summary>浮到水面附近（出招中）</summary>
        protected void Float(float depth, float dt)
        {
            var p = Brain.transform.position;
            p.y += (Level + depth - p.y) * Mathf.Min(1, dt * 4f);
            Brain.transform.position = p;
        }

        protected void Glint(float at)
        {
            if (Cue("glint", at)) Fx.LdOne("Star", Mouth, Vector3.zero, 1.3f, 0.2f, HuashePalette.MouthCore);
        }
    }

    /// <summary>
    /// 吐水弹（spit，0.6 / 1.35 / 0.6，冷却 3 s）：浮起来、仰头、张嘴（嘴 ×3 露出来）；连吐三发（0.6 / 1.05 / 1.5 s，片段 release）：
    /// 每发瞄玩家（带一点提前量和散布），落点危险圈 2.6 m 在吐出的那一刻出现、飞 1.1 s 填满，落地 2.6 m 溅射 12（网页值）
    /// </summary>
    public sealed class HuasheSpit : HuasheMove
    {
        public const string MoveId = "spit";
        public override string Id => MoveId;
        public override string Name => "吐水弹";
        public const float Flight = 1.1f, Splash = 2.6f, WebDamage = 12f, Gravity = 20f;
        public static readonly float[] Releases = { 0.6f, 1.05f, 1.5f };

        public int Fired { get; private set; }

        public HuasheSpit()
        {
            windup = 0.6f;
            active = 1.35f;
            recover = 0.6f;
            cooldown = 3f;
            recovery = 0.7f;
            weight = 1f;
        }

        protected override bool OpensMouth => true;

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 60f ? weight : 0f;

        protected override void OnWindup(float dt)
        {
            Float(-0.1f, dt);
            TurnToward(YawToPlayer, 115f, dt);
        }

        protected override void OnActiveBegin()
        {
            MarkRelease();
            Spit();
        }

        protected override void OnActive(float dt)
        {
            Float(-0.1f, dt);
            TurnToward(YawToPlayer, 115f, dt);
            for (int i = 1; i < Releases.Length; i++)
                if (At(Releases[i])) Spit();
        }

        void Spit()
        {
            var from = Mouth;
            if (!LordBrain.PlayerFeet(out var feet)) feet = Brain.PlayerPosition;
            var lead = Brain.Predict(0.8f) - Brain.PlayerPosition;
            lead.y = 0;
            var to = feet + lead + new Vector3(Random.Range(-2.5f, 2.5f), 0, Random.Range(-2.5f, 2.5f));
            to = OnGround(to);
            if (Hua && Hua.Lake != null && to.y < Level) to.y = Level;
            WarnCircle(to, Splash, Flight);
            var v = (to - from) / Flight + Vector3.up * (0.5f * Gravity * Flight);
            EnemyProjectile.Spawn(new EnemyProjectileSpec(from, v, Dmg(WebDamage), 0.45f, Flight + 0.6f)
            {
                gravity = Gravity, explosionRadius = Splash, explosionFalloff = 0.6f, visual = "orb", color = HuashePalette.Water, scale = 2.2f,
                source = Brain, blockable = true, trail = ProjectileTrail.On,
                onImpact = (at, hitPlayer) =>
                {
                    Fx.HuasheSplash(at, 1f);
                    if (hitPlayer) Hits++;
                },
            });
            Fired++;
            Fx.HuasheSplash(from, 0.4f);
        }
    }

    /// <summary>
    /// 扑岸（lunge，0.7 / 0.35 / 1.2，冷却 4 s）：玩家在岸边 9 m 内；头往后缩成 S 形，危险扑线指向岸上；0.45 s 嘴里白星；拉直扑出 = 出手（片段 hit）：
    /// 冲上岸 8 m（最多 10），咬 20 + 击退；**搁浅在岸上 1.2 s**：头胸都在陆地上，最大的窗口（最后 30% 滑回水里）。
    /// 第三个打的领主：扑岸接翼拍浪（变体）
    /// </summary>
    public class HuasheLunge : HuasheMove
    {
        public const string MoveId = "lunge";
        public override string Id => MoveId;
        public override string Name => "扑岸";
        public const float Reach = 10f, Width = 3.4f, BiteRadius = 4.5f, WebDamage = 20f;

        protected Vector3 from, to;
        protected float yaw;
        bool bit;

        /// <summary>最近一次扑到的点、咬到人了没</summary>
        public Vector3 Landed => to;
        public bool Bit => bit;

        public HuasheLunge()
        {
            windup = 0.7f;
            active = 0.35f;
            recover = 1.2f;
            cooldown = 4f;
            recovery = 0.6f;
            weight = 3f;
        }

        protected override bool OpensMouth => true;

        public override float Weight(BossBrain b) => Near(b) < 10f ? weight : 0f;

        /// <summary>从 p 沿 dir 往前第一处地面高出水面 0.1 m（上岸）的距离；max 米内没有岸为 −1（测试场的虚拟湖地面 = 水位，永远没有岸）</summary>
        protected float ShoreAhead(Vector3 p, Vector3 dir, float max)
        {
            for (float s = 0.5f; s <= max; s += 0.5f)
                if (LordB.GroundAt(p + dir * s) > Level + 0.1f)
                    return s;
            return -1f;
        }

        protected static float Near(BossBrain b)
        {
            var lb = b as LordBrain;
            var h = lb ? lb.BonePos("head") : b.transform.position;
            var p = b.PlayerPosition;
            h.y = p.y = 0;
            return Vector3.Distance(h, p);
        }

        protected override void HuashePrepare()
        {
            if (Hua) Hua.Driven = true;
            from = Brain.transform.position;
            var head = Head;
            if (!LordBrain.PlayerFeet(out var feet)) feet = Brain.PlayerPosition;
            var d = feet - head;
            d.y = 0;
            float reach = Mathf.Min(Reach, d.magnitude + 1f);
            yaw = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            // 游线贴着湖岸（3–5.5 m）时「头到人 + 1 m」可能不够冲上岸：至少冲到岸上 3 m（最多 10 m），头胸都搁浅在岸上
            float shore = ShoreAhead(from, Dir(yaw), 12f);
            if (shore >= 0) reach = Mathf.Min(Reach, Mathf.Max(reach, shore + 3f));
            to = from + Dir(yaw) * reach;
            float g = LordB.GroundAt(to);
            to.y = Mathf.Max(g, Level) - 0.2f;
            bit = false;
        }

        protected override void Telegraph()
        {
            var head = Head;
            head.y = Level;
            WarnLine(head, head + Dir(yaw) * (Flat(from, to) + 2f), Width, WindupTime);
        }

        protected override void OnWindup(float dt)
        {
            TurnToward(yaw, 230f, dt);
            Float(-0.2f, dt);
            Glint(WindupTime - 0.25f);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            SetFacing(yaw);
            Fx.HuasheBreach(new Vector3(Brain.transform.position.x, Level, Brain.transform.position.z), 0.8f);
        }

        protected override void OnActive(float dt)
        {
            float k = Mathf.Clamp01(StageT / Mathf.Max(0.05f, active));
            var p = Vector3.Lerp(from, to, k);
            p.y = Mathf.Max(p.y, LordB.GroundAt(p) - 0.1f);
            Brain.transform.position = p;
            SetFacing(yaw);
            if (bit || !LordBrain.PlayerFeet(out var feet)) return;
            var head = Head;
            if (Flat(feet, head) > BiteRadius) return;
            bit = true;
            Fx.HuasheBite(head, yaw);
            var d = feet - head;
            d.y = 0;
            d = d.sqrMagnitude > 1e-4f ? d.normalized : Dir(yaw);
            HurtPlayer(Dmg(WebDamage), Element.None, head, d * 9f + Vector3.up * 4f);
        }

        protected override void OnRecoverBegin()
        {
            Brain.transform.position = to;
            Fx.LdMany("ToonSmoke", 4, i => (to + Random.insideUnitSphere * 1.5f, Random.insideUnitSphere * 2f + Vector3.up, Random.Range(0.8f, 1.2f), 0.5f),
                Fx.LdAlpha(HuashePalette.Mud, 0.75f));
        }

        protected override void OnRecover(float dt)
        {
            float k = StageT / Mathf.Max(0.05f, recover);
            // 搁浅：最后 30% 滑回水里
            if (k > 0.7f)
            {
                float s = Mathf.SmoothStep(0, 1, (k - 0.7f) / 0.3f);
                Brain.transform.position = Vector3.Lerp(to, from, s);
            }
            else if (Random.value < dt * 2.5f) Fx.LdOne("ToonSmoke", to + Random.insideUnitSphere, Vector3.up, 0.7f, 0.4f, Fx.LdAlpha(HuashePalette.Mud, 0.7f), false);
        }

        protected override void HuasheEnd(bool cancelled)
        {
            if (Hua && Hua.Lake != null) Hua.SwimAngle = Hua.Lake.AngleOf(Brain.transform.position);
            if (!cancelled && Hua && Hua.Variant && Id == MoveId) Brain.QueueMove(HuasheWingSlap.MoveId);
        }
    }

    /// <summary>
    /// 潜游突袭（dive，二阶段起，1.5 / 0.35 / 1.2，冷却 7 s）：沉下去，一串气泡涟漪朝玩家最近的岸边游过来（前摇里挪 60% 的路）；危险扑线；1.25 s 白星；
    /// 破水扑出 = 出手（片段 hit），之后同扑岸（咬、搁浅）。玩家离 10–30 m 时出
    /// </summary>
    public sealed class HuasheDive : HuasheLunge
    {
        public new const string MoveId = "dive";
        public override string Id => MoveId;
        public override string Name => "潜游突袭";

        Vector3 start;
        float bubbleAcc;

        public HuasheDive()
        {
            windup = 1.5f;
            active = 0.35f;
            recover = 1.2f;
            cooldown = 7f;
            minPhase = 1;
            weight = 1.2f;
        }

        public override float Weight(BossBrain b)
        {
            float d = Near(b);
            return d > 10f && d < 30f ? weight : 0f;
        }

        protected override void HuashePrepare()
        {
            base.HuashePrepare();
            start = from;
            if (Hua) Hua.MouthForced = false;
        }

        protected override void OnWindup(float dt)
        {
            float k = StageT / Mathf.Max(0.05f, WindupTime);
            var p = Vector3.Lerp(start, to, k * 0.6f);
            p.y = Level - 2.5f;
            Brain.transform.position = p;
            SetFacing(yaw);
            from = p;
            bubbleAcc += dt;
            if (bubbleAcc > 0.12f)
            {
                bubbleAcc = 0;
                Fx.HuasheRipple(new Vector3(p.x, Level, p.z) + Dir(yaw) * 3f, 1.1f);
            }
            if (k > 0.9f && Hua) Hua.MouthForced = true;
            Glint(WindupTime - 0.25f);
        }

        protected override void OnActiveBegin()
        {
            if (Hua) Hua.MouthForced = true;
            from = Brain.transform.position;
            from.y = Level - 0.3f;
            base.OnActiveBegin();
            Fx.HuasheBreach(new Vector3(from.x, Level, from.z), 1.2f);
        }
    }

    /// <summary>
    /// 翼拍浪（wingslap，0.8 / 0.4 / 0.6，冷却 5 s）：双翼高高举起（剪影最宽）；脚下 6 m 危险圈；双翼拍在水面 = 出手（片段 hit）：
    /// 一圈 1 m 高的浪往岸上推到 30 m（BossHazards.Wave，环经过时在地上就挨 10 + 推开，跳过）
    /// </summary>
    public sealed class HuasheWingSlap : HuasheMove
    {
        public const string MoveId = "wingslap";
        public override string Id => MoveId;
        public override string Name => "翼拍浪";
        public const float Range = 30f, Seconds = 1.6f, WebDamage = 10f, Warn = 6f;

        public int Waves { get; private set; }

        public HuasheWingSlap()
        {
            windup = 0.8f;
            active = 0.4f;
            recover = 0.6f;
            cooldown = 5f;
            recovery = 0.7f;
            weight = 1f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 26f ? weight : 0.2f;

        protected override void Telegraph()
        {
            var o = Brain.transform.position;
            o.y = Level;
            WarnCircle(o, Warn, WindupTime);
        }

        protected override void OnWindup(float dt)
        {
            Float(-0.1f, dt);
            TurnToward(YawToPlayer, 90f, dt);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            var c = Brain.transform.position;
            c.y = Level;
            var spec = new BossWaveSpec(c, Range / Seconds, Range, Dmg(WebDamage), HuashePalette.Water)
            {
                startRadius = 2.5f, width = 1.4f, height = 1.0f, knockback = 9f,
            };
            Hazards.Wave(spec);
            Waves++;
            Fx.HuasheWave(c, Range, Seconds, LordB.BonePos("wing_3_L"), LordB.BonePos("wing_3_R"));
            Brain.Shake(0.25f, 0.3f, 40f);
            LordB?.ImpactHold(0.06f);
        }
    }

    /// <summary>
    /// 吼叫涨水（roar，二阶段起，0.6 / 2.4 / 0.8，冷却 12 s，霸体）：昂首、嘴张到最大（整段嘴 ×3）；湖水 2.4 s 内再涨 0.8 m，6 s 后退回。
    /// 前摇 / 吼叫中打满破防条就噎住、不涨水（BossBrain 的破防打断霸体招）
    /// </summary>
    public sealed class HuasheRoar : HuasheMove
    {
        public const string MoveId = "roar";
        public override string Id => MoveId;
        public override string Name => "吼叫涨水";

        float ringAcc;

        public HuasheRoar()
        {
            windup = 0.6f;
            active = 2.4f;
            recover = 0.8f;
            cooldown = 12f;
            recovery = 0.8f;
            weight = 1f;
            minPhase = 1;
            stunnable = false;
        }

        protected override bool OpensMouth => true;

        public override float Weight(BossBrain b) => b is HuasheBrain h && h.Lake != null && h.Lake.Surge > 0.05f ? 0f : b.Phase >= 2 ? 2f : 1f;

        protected override void Telegraph() => Hua?.Tell("huashe_roar", "化蛇张嘴吼叫——湖水要涨了，打它的嘴！", HuashePalette.Mouth, 14f, 2.2f);

        protected override void OnWindup(float dt)
        {
            Float(-0.1f, dt);
            TurnToward(YawToPlayer, 90f, dt);
        }

        protected override void OnActiveBegin() => MarkRelease();

        protected override void OnActive(float dt)
        {
            Float(-0.1f, dt);
            var h = HDef;
            if (Hua && Hua.Lake != null && h != null)
            {
                Hua.Lake.Surge = Mathf.Min(h.surge, Hua.Lake.Surge + dt * h.surge / Mathf.Max(0.1f, active));
                Hua.SurgeHold = h.surgeHold;
            }
            ringAcc += dt;
            if (ringAcc >= 0.4f)
            {
                ringAcc = 0;
                Fx.HuasheRoarRing(Mouth);
            }
        }
    }

    /// <summary>
    /// 尾扫（tailsweep，三阶段，0.7 / 0.5 / 0.8，冷却 5 s）：尾鳍高高翘出水面；危险扇形 120° / 14 m（朝尾巴那一侧）；尾巴横扫 = 出手（片段 hit）：
    /// 扇形里、站在地上的人挨 14 + 推开（跳 / 冲刺躲）
    /// </summary>
    public sealed class HuasheTailSweep : HuasheMove
    {
        public const string MoveId = "tailsweep";
        public override string Id => MoveId;
        public override string Name => "尾扫";
        public const float Range = 14f, HalfAngle = 60f, WebDamage = 14f;

        float yaw;

        public HuasheTailSweep()
        {
            windup = 0.7f;
            active = 0.5f;
            recover = 0.8f;
            cooldown = 5f;
            recovery = 0.7f;
            weight = 1.2f;
            minPhase = 2;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < Range ? weight : 0f;

        protected override void HuashePrepare()
        {
            var tail = LordB.BonePos("tail_6");
            yaw = YawTo(tail);
        }

        protected override void Telegraph()
        {
            var o = Brain.transform.position;
            o.y = Level;
            Hazards.SectorWarning(o, yaw, HalfAngle, Range, WindupTime, WarnTint);
            CountWarning();
        }

        protected override void OnWindup(float dt) => Float(-0.1f, dt);

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            var o = Brain.transform.position;
            o.y = Level;
            Fx.HuasheTailFan(o, yaw, Range);
            Brain.Shake(0.2f, 0.3f, 30f);
            if (!LordBrain.PlayerFeet(out var feet) || !LordBrain.PlayerGrounded) return;
            if (Flat(feet, o) > Range || Mathf.Abs(Mathf.DeltaAngle(yaw, YawTo(feet))) > HalfAngle) return;
            var d = feet - o;
            d.y = 0;
            HurtPlayer(Dmg(WebDamage), Element.None, o, d.normalized * 10f + Vector3.up * 4f);
        }
    }
}
