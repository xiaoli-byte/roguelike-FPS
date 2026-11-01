using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 拄拳（knuckle，— / 3 步 × 1.3 s / —）：长臂当拐——拳先往前撑住，身体和腿从两拳之间荡过去，蹄落地，拳再往前伸。不攻击，绕拉则挪位（2.5 m/s），
    /// 胸口低到约 2.5 m：窗口。片段三步可循环，每步落蹄有 step 事件（按 1.3 / 2.6 / 3.9 s 兜底）。远于 12 m 时偶尔出
    /// </summary>
    public sealed class KuiKnuckle : KuiMove
    {
        public const string MoveId = "knuckle";
        public override string Id => MoveId;
        public override string Name => "拄拳";
        public const float Speed = 2.5f, StepSeconds = 1.3f;

        float angle, radius, dir;
        bool dashing;
        int steps;

        /// <summary>这次挪了多远（米，测试用）</summary>
        public float Travelled { get; private set; }

        public KuiKnuckle()
        {
            windup = 0f;
            active = 3.9f;
            recover = 0f;
            cooldown = 5f;
            recovery = 0.35f;
            weight = 0.6f;
            stunnable = true;
            firstDelay = 2f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 12f ? weight : 0f;

        protected override void KuiPrepare()
        {
            var c = Brain.Arena ? Brain.Arena.Center : Brain.transform.position + Brain.transform.forward * 8f;
            var o = Brain.transform.position - c;
            o.y = 0;
            radius = Mathf.Max(8f, o.magnitude);
            angle = Mathf.Atan2(o.x, o.z);
            // 往玩家那一侧绕
            var p = Brain.PlayerPosition - c;
            float pa = Mathf.Atan2(p.x, p.z);
            dir = Mathf.Sign(Mathf.DeltaAngle(angle * Mathf.Rad2Deg, pa * Mathf.Rad2Deg));
            if (dir == 0) dir = 1;
            steps = 0;
            Travelled = 0;
        }

        protected override void OnActiveBegin()
        {
            Brain.BeginDash(Vector3.zero, 0);
            dashing = true;
        }

        protected override void OnActive(float dt)
        {
            var c = Brain.Arena ? Brain.Arena.Center : Brain.transform.position;
            angle += dir * dt * Speed / radius;
            var t = c + new Vector3(Mathf.Sin(angle) * radius, 0, Mathf.Cos(angle) * radius);
            t = OnGround(Brain.ClampToArena(t));
            var prev = Brain.transform.position;
            TurnToward(YawTo(t), 180f, dt);
            Brain.transform.position = t;
            Travelled += Flat(prev, t);
            for (int i = 1; i <= 3; i++)
                if (StageAt(StepSeconds * i - 0.01f))
                {
                    steps++;
                    var fl = LordB.BonePos("fist_L");
                    var fr = LordB.BonePos("fist_R");
                    Fx.KuiDust(OnGround(fl), 0.5f, 2);
                    Fx.KuiDust(OnGround(fr), 0.5f, 2);
                }
            Fx.KuiCoreGlow(LordB.BonePos(KuiDef.WeakBone), dt, 0.5f);
        }

        protected override void OnEnd(bool cancelled)
        {
            if (!dashing) return;
            dashing = false;
            Brain.EndDash();
        }
    }

    /// <summary>
    /// 雷掌（clap，0.6 / 0.2 / 0.6，冷却 4 s）：正面 8 m 内——双臂往两边张开（胸前空门大开、剪影一个「T」），扇形预警 60° / 8 m；0.35 s 鼓心白星；
    /// 双掌合拢 = 出手（片段 hit 事件）：两掌之间一道竖直雷缝 + 扇面电弧，正前 60° 扇形 8 m 内 16 + 雷殛 + 击退。
    /// 第三个打的领主：雷掌接小跳（变体，C4-6）
    /// </summary>
    public sealed class KuiClap : KuiMove
    {
        public const string MoveId = "clap";
        public override string Id => MoveId;
        public override string Name => "雷掌";
        public const float Range = 8f, HalfAngle = 30f, WebDamage = 16f;

        float yaw;

        public KuiClap()
        {
            windup = 0.6f;
            active = 0.2f;
            recover = 0.6f;
            cooldown = 4f;
            recovery = 0.35f;
            weight = 4f;
            stunnable = true;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < Range ? weight : 0f;

        protected override void KuiPrepare()
        {
            Brain.Halt();
            yaw = YawToPlayer;
        }

        protected override void Telegraph()
        {
            Hazards.SectorWarning(Brain.transform.position, yaw, HalfAngle, Range, WindupTime, WarnTint);
            CountWarning();
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(YawToPlayer, 115f, dt);
            yaw = Facing;
            Fx.KuiPalmCharge(LordB.BonePos("fist_L"), LordB.BonePos("fist_R"), StageT / Mathf.Max(0.05f, WindupTime), dt);
            if (Cue("glint", WindupTime - 0.25f)) Fx.LdOne("Star", LordB.BonePos(KuiDef.WeakBone), Vector3.zero, 1.4f, 0.2f, KuiPalette.ThunderCore);
        }

        protected override bool WindupDone => Cue("hit", WindupTime);

        protected override void OnActiveBegin()
        {
            MarkRelease();
            var palms = (LordB.BonePos("fist_L") + LordB.BonePos("fist_R")) * 0.5f;
            Fx.KuiClap(palms, yaw, Range);
            Brain.Shake(0.3f, 0.3f, 20f);
            LordB?.ImpactHold(0.06f);
            if (!LordBrain.PlayerFeet(out var feet)) return;
            var o = Brain.transform.position;
            if (Flat(feet, o) > Range) return;
            if (Mathf.Abs(Mathf.DeltaAngle(yaw, YawTo(feet))) > HalfAngle + 11f) return;
            var d = Dir(YawTo(feet));
            HurtPlayer(Dmg(WebDamage), Element.Shock, o, d * 12f + Vector3.up * 4f);
        }

        protected override void OnEnd(bool cancelled)
        {
            if (!cancelled && Kui && Kui.Variant) Brain.QueueMove(KuiHop.MoveId);
        }
    }

    /// <summary>
    /// 捶胸引雷（drum，二阶段起，0.8 / 3 下 × 0.6 / 1.0；三阶段 drum5 五下）：人立、双拳举起、鼓面张开发亮（鼓心 × 3.5，霸体）；
    /// 每捶一下（0.8 / 1.4 / 2.0 s…，片段 beat 事件同一时刻）：玩家脚下 + 随机一处各一道雷（F 路 LightningStrike：1.2 s 预警、3.2 m、18；落点 5 m 内有经幡杆就劈杆）。
    /// 破防条满了照样破鼓（BossBrain 的破防打断霸体招）
    /// </summary>
    public class KuiChestDrum : KuiMove
    {
        public const string MoveId = "drum";
        public override string Id => MoveId;
        public override string Name => "捶胸引雷";
        public const float Warn = 1.2f, BoltRadius = 3.2f, WebDamage = 18f, Interval = 0.6f;

        protected int beats = 3;
        Transform drumBone;
        Vector3 drumScale = Vector3.one;

        /// <summary>这一招引下来的雷（测试用）</summary>
        public int Bolts { get; private set; }
        public int Beats { get; private set; }

        public KuiChestDrum()
        {
            windup = 0.8f;
            active = 1.8f;
            recover = 1.0f;
            cooldown = 3f;
            recovery = 0.35f;
            weight = 50f;
            minPhase = 1;
            maxPhase = 1;
            stunnable = false;
        }

        public override float Weight(BossBrain b)
        {
            var k = b as KuiBrain;
            return k && k.SinceDrum >= Every ? weight : 0f;
        }

        protected virtual int Every => KDef != null ? KDef.drumEvery : 5;

        protected override void Prepare()
        {
            if (Kui) Kui.SinceDrum = 0;
            Brain.Halt();
            Beats = 0;
            drumBone = LordB.Bone("drum");
            if (drumBone && drumBone.name.Contains("core")) drumBone = null;
            if (drumBone) drumScale = drumBone.localScale;
        }

        protected override void Telegraph()
        {
            Kui?.Tell("kui_drum", "夔在捶胸——鼓面张开（鼓心最痛）；快去经幡杆旁躲雷", KuiDef.Thunder, 20f, 2.2f);
        }

        protected override void OnWindup(float dt)
        {
            Brain.Halt();
            TurnToward(YawToPlayer, 115f, dt);
        }

        protected override void OnActiveBegin()
        {
            MarkRelease();
            Beat(false);
        }

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            for (int i = 1; i < beats; i++)
                if (StageAt(i * Interval)) Beat(i == beats - 1 && beats > 3);
            // 鼓面一震（采样器不采骨骼缩放：这里每捶一下缩骨）
            if (drumBone)
            {
                float ph = (StageT % Interval) / Interval;
                float s = ph < 0.15f ? Mathf.Lerp(1f, 0.94f, ph / 0.15f) : ph < 0.4f ? Mathf.Lerp(0.94f, 1.08f, (ph - 0.15f) / 0.25f) : Mathf.Lerp(1.08f, 1f, (ph - 0.4f) / 0.6f);
                drumBone.localScale = drumScale * s;
            }
        }

        void Beat(bool big)
        {
            Beats++;
            var core = LordB.BonePos(KuiDef.WeakBone);
            Fx.KuiDrumBeat(core, big);
            Brain.Shake(big ? 0.25f : 0.12f, 0.2f, 30f);
            LordB?.ImpactHold(0.04f);
            if (!LordBrain.PlayerFeet(out var feet)) feet = Brain.PlayerPosition;
            for (int k = 0; k < 2; k++)
            {
                float a = Random.value * Mathf.PI * 2, r = k == 0 ? 0 : Random.Range(3f, 8f);
                var p = feet + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                LightningStrike.Strike(p, new StrikeOptions { warn = Warn, radius = BoltRadius, damage = Dmg(WebDamage), source = Brain });
                Bolts++;
            }
        }

        protected override void OnEnd(bool cancelled)
        {
            if (drumBone) drumBone.localScale = drumScale;
        }
    }

    /// <summary>捶胸引雷（五下，三阶段）：0.8 / 3.0 / 1.0，五捶在 0.8 / 1.4 / 2.0 / 2.6 / 3.2 s，最后一捶双拳一起砸、鼓皮环大一号</summary>
    public sealed class KuiChestDrum5 : KuiChestDrum
    {
        public new const string MoveId = "drum5";
        public override string Id => MoveId;
        public override string Name => "捶胸引雷（五下）";

        public KuiChestDrum5()
        {
            active = 3.0f;
            minPhase = 2;
            maxPhase = int.MaxValue;
            beats = 5;
        }

        protected override int Every => KDef != null ? KDef.drumEvery3 : 4;
    }
}
