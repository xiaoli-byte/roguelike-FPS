using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 吐冰（Three.js KunPeng.ts 'spit'，1.3 s）：只在玩家离得远（&gt; 12 m）时出。
    ///   前摇 0.7 s：扬头蓄力（act_spit，projectile 事件），一路转头盯着玩家；前摇一开始就亮出各块的落点预警，跟着瞄准点挪，出手时锁定（D21 整改：前摇里就看得到落点）；
    ///   出手：朝玩家 0.6 s 后的位置和两侧（± 3.2 m，鲲怒时再加一块 6.2 m）各吐一块抛物线冰弹（1.15 s 落地、拱高 7 m、落点 2.6 m、16 伤），
    ///     落点都有预警，都夹在环台上（冰窟外 1 m、外缘内 1.5 m）；
    ///   收招 0.5 s。
    /// 特效（K 路，docs/art/vfx/kunpeng.md 第 4 节）：前摇里口里一颗冰晶星越来越亮（挂在头骨上），出手口前一记冰晶星 + 一束往前喷的冰屑（<see cref="Fx.KunSpit"/>）。
    /// 动作（第二批 A 路，第 13 节的节拍表）：spit 是手 K 片段（1.3 s = 前摇 0.7 + 出手 0.1 + 收招 0.5）——起手往后一抽 → 仰头挺胸蓄冰珠（口前冷雾冰屑往嘴里收，
    /// <see cref="Fx.KunSpitGather"/>）→ 第 16 帧 apex 冰珠最亮「叮」（<see cref="Fx.KunSpitApex"/>）→ 2 帧拖影 → 第 21 帧 projectile 头往前一送喷出（= 前摇结束）→ 后坐回弹。
    /// </summary>
    public sealed class KunSpit : KunPengMove
    {
        public const string MoveId = "spit";
        public const float MinRange = 12f, Lead = 0.6f, Flight = 1.15f, Arc = 7f, Radius = 2.6f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 吐冰";

        /// <summary>本次吐了几块；累计</summary>
        public int Lobs { get; private set; }
        public int TotalLobs { get; private set; }

        public KunSpit()
        {
            forms = new[] { KunPengDef.KunForm };
            cooldown = 5f;
            recovery = 0.9f;
            firstDelay = 3f;
            weight = 1.6f;
            windup = 0.7f;
            active = 0.1f;
            recover = 0.5f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > MinRange ? weight : 0;

        /// <summary>口里的冰珠（前摇里变大变亮，出手后熄）</summary>
        FrostGlint orb;

        void Orb(float level)
        {
            if (!orb)
            {
                if (!(level > 0.01f)) return;
                var head = Brain.Model?.FindBone("head");
                if (!head) return;
                orb = FrostGlint.Attach(head, head.InverseTransformPoint(KP ? KP.Muzzle : head.position), 1.6f, Fx.KunCore);
            }
            if (orb) orb.Set(level, 0.5f + level * 1.2f);
        }

        protected override void OnStart()
        {
            Lobs = 0;
            apexed = false;
            Act("spit", WindupTime + active + recover);
            CuedSfx("enemy_charge", 1f, 0.7f);
        }

        /// <summary>前摇里就画好的落点预警（跟着瞄准点挪，出手时交给冰弹）</summary>
        readonly List<TelegraphHandle> marks = new(4);
        readonly List<Vector3> targets = new(4);

        int Count => KP && KP.KunFury ? 4 : 3;

        /// <summary>此刻出手的话各块冰弹的落点：玩家 0.6 s 后的位置和两侧（± 3.2 m，再一块 6.2 m），夹在环台上</summary>
        void Plan(int n)
        {
            targets.Clear();
            var aim = AtFloor(Brain.Predict(Lead));
            var to = aim - Brain.transform.position;
            to.y = 0;
            float yaw = to.sqrMagnitude > 1e-4f ? KunPengMath.Yaw(to) : Brain.transform.eulerAngles.y;
            var side = Dir(yaw + 90f);
            for (int i = 0; i < n; i++)
            {
                float s = i == 0 ? 0 : (i % 2 == 1 ? 1 : -1) * (3.2f + Mathf.Floor((i - 1) / 2f) * 3f);
                var target = aim + side * s;
                if (Hole.found) target = Hole.ClampToRing(target);
                targets.Add(target);
            }
        }

        /// <summary>前摇一开始就画落点：预警时长 = 前摇 + 飞行（出手时按飞行时间重新计时），前摇里跟着鲲的瞄准挪</summary>
        protected override void OnTelegraph()
        {
            marks.Clear();
            Plan(Count);
            foreach (var t in targets)
            {
                marks.Add(Hazards.AimWarning(t, Radius, WindupTime + Flight, KunPengDef.Warn));
                CountWarning();
            }
        }

        bool apexed;

        public override void OnAnimEvent(string name)
        {
            base.OnAnimEvent(name);
            if (name == "apex" && !apexed && Stage == MoveStage.Windup)
            {
                apexed = true;
                Fx.KunSpitApex(KP ? KP.Muzzle : Brain.BodyCenter + Vector3.up * 2f);
            }
        }

        protected override void OnWindup(float dt)
        {
            float k = Mathf.Clamp01(StageT / Mathf.Max(0.1f, WindupTime));
            Orb(k);
            // 蓄冰珠：口前冷雾、冰屑往嘴里收（最后 0.1 s 拖影 + 喷出前停）
            if (StageT < WindupTime - 0.1f) Fx.KunSpitGather(KP ? KP.Muzzle : Brain.BodyCenter + Vector3.up * 2f, Brain.transform.forward, k, dt);
            if (KP)
            {
                KP.TurnKunToward(69f, dt);
                KP.PlaceKun();
            }
            if (marks.Count == 0) return;
            Plan(marks.Count);
            for (int i = 0; i < marks.Count; i++) marks[i].MoveTo(targets[i]);
        }

        protected override bool WindupDone => Cue("projectile", WindupTime);

        protected override void OnActiveBegin()
        {
            var from = KP ? KP.Muzzle : Brain.BodyCenter + Vector3.up * 2f;
            Plan(Count);
            for (int i = 0; i < targets.Count; i++)
            {
                var mark = i < marks.Count ? marks[i] : TelegraphHandle.None;
                Hazards.Lob(new BossLobSpec(from, targets[i], Flight, Arc, Radius, Dmg(16), KunPengDef.Warn, LobKind.Ice) { scale = 1.4f }, mark);
                if (!mark.Alive) CountWarning();
                Lobs++;
                TotalLobs++;
            }
            for (int i = targets.Count; i < marks.Count; i++) marks[i].Cancel();
            marks.Clear();
            Sfx("enemy_shot", 0.9f, 0.6f);
            Fx.KunSpit(from, targets.Count > 0 ? targets[0] - from : Brain.transform.forward);
            Orb(0);
        }

        protected override void OnEnd(bool cancelled)
        {
            marks.Clear();
            if (orb) Object.Destroy(orb.gameObject);
            orb = null;
        }

        protected override void OnActive(float dt) => KP?.PlaceKun();
        protected override void OnRecover(float dt) => KP?.PlaceKun();
    }
}
