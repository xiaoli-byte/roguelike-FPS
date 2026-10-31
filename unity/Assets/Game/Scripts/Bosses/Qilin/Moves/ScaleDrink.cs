using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 饮熔（TS Qilin 'drink'）：不按权重出，只由 85% / 70% 两道生命刻度排上（<see cref="QilinBrain.OnMark"/>）。
    ///   选点：离自己最近、锁扣还在、链还拴着的象限（都没了取自己所在的象限），饮熔点在那个象限中线上、池外 3.1 m，背朝锁扣、脸朝熔池；
    ///   前摇 1 s：抛物线跃向饮熔点（高 6 m），落点亮 4.5 m 预警圈；
    ///   落地：4.5 m 内 24 + 掀开；两座炉口共钻出 4 只炭童；它身后那面墙上的锁扣大亮（该打哪一个）；
    ///   低头饮熔 4 s：熔岩从池面吸进嘴里、熔岩柱翻涌、火鬃越来越旺。
    ///   这 4 s 里打碎那个锁扣 → 鼎角坠下 → 砸中（<see cref="QilinBrain"/> 的 CornerHit：硬直 4 s、鳞甲崩裂），饮熔被打断；
    ///   锁扣碎了、鼎角还在落时饮熔等它砸下来（最多多等 2 s）；
    ///   喝完：鳞甲回满、伤害 × 1.08、火鬃满。
    /// 第二批 B 路（2026-10-31，设计单 §2.9）：跃起 / 饮熔是手 K 片段（leap → drink 连段）；前摇前 28% 先在原地蹲身蓄跳（片段 f0–f8），
    /// 抛物线在剩下的 72% 里跳完（落地时刻、落点、伤害都不变）——起跳那一帧后蹄还在地上，不再是一开始就腾空、在半空里做下蹲。
    /// </summary>
    public sealed class ScaleDrink : QilinMove
    {
        public const string MoveId = "drink";
        public const float LeapHeight = 6f, LandRadius = 4.5f;
        /// <summary>前摇里先蹲身蓄跳的比例（leap 片段第 8 / 30 帧起跳）</summary>
        public const float CrouchFrac = 0.28f;

        public override string Id => MoveId;
        public override string Name => "饮熔";

        /// <summary>本次的象限、饮熔点；本次排进的炭童；累计喝完的次数</summary>
        public int Quadrant { get; private set; } = -1;
        public Vector3 Spot { get; private set; }
        public int Summoned { get; private set; }
        public int Completed { get; private set; }
        /// <summary>本次已经在低头饮熔（落地之后）</summary>
        public bool Sipping => Stage == MoveStage.Active && !finished;

        Vector3 from;
        float faceYaw, fxAcc;
        bool finished;

        public ScaleDrink()
        {
            cooldown = 1f;
            recovery = 0.6f;
            weight = 0;
            windup = 1f;
            active = 9f;
            recover = 0.6f;
            forms = new[] { QilinDef.XuanForm };
        }

        public override float Weight(BossBrain b) => 0;

        protected override void Prepare()
        {
            finished = false;
            Summoned = 0;
            var f = Furnace;
            from = Brain.transform.position;
            if (f && Qilin)
            {
                Quadrant = Qilin.PickDrinkQuadrant();
                float qy = f.QuadrantYaw(Quadrant);
                var spot = f.Point(qy, f.poolRadius + (QDef?.drinkSpotOut ?? 3.1f));
                Qilin.SampleNav(spot, 2.5f, out spot);
                Spot = spot;
                faceYaw = qy + 180f;
            }
            else
            {
                Quadrant = -1;
                Spot = from;
                faceYaw = Facing;
            }
            Brain.BeginDash(Vector3.zero, 0);
        }

        protected override void OnTelegraph()
        {
            WarnCircle(Spot, LandRadius, WindupTime);
            Brain.PlayAct("leap", WindupTime);
            Sfx("boss_roar", 1f, 0.85f);
        }

        protected override void OnWindup(float dt)
        {
            // 先在原地蹲身蓄跳，再抛物线跃向池边（直接驱动位置：脚本位移速度为 0，不受导航推挤）
            float wind = Mathf.Max(0.05f, WindupTime), crouch = wind * CrouchFrac;
            float k = QilinBrain.EaseInOut(Mathf.Clamp01((StageT - crouch) / Mathf.Max(0.05f, wind - crouch)));
            var p = Vector3.Lerp(from, Spot, k);
            p.y += Mathf.Sin(Mathf.PI * k) * LeapHeight;
            Brain.transform.position = p;
            TurnToward(faceYaw, 290f, dt);
        }

        protected override void OnActiveBegin()
        {
            Brain.transform.position = Spot;
            Brain.EndDash();
            SetFacing(faceYaw);
            Brain.Halt();
            Brain.PlayAct("drink", QDef?.drinkSeconds ?? 4f);
            Hazards.Blast(Spot, LandRadius, Dmg(24), new BossBlastOpts { maxHeight = 3f, knockback = 9f, knockUp = 5f });
            Brain.Shake(0.5f, 0.4f);
            Fx.QilinStamp(Spot, LandRadius * 0.7f);
            Sfx("boss_slam", 1f, 0.9f);
            SummonTantong();
            if (Qilin && Quadrant >= 0) Qilin.BeginSip(Quadrant);
            Qilin?.Tell("drink", "火麒麟在熔池边饮熔——打碎它身后外墙上发亮的锁扣，让巨鼎砸它！", Hex.Rgb(0xffe08a));
        }

        /// <summary>两座炉口各钻出 2 只炭童（场地召唤点 = 炉口；受首领召唤上限约束）</summary>
        void SummonTantong()
        {
            var d = QDef;
            var o = SummonOptions.Default;
            o.warn = 0.6f;
            o.minRadius = 4f;
            o.maxRadius = 9f;
            o.warnColor = QilinDef.Ember;
            Summoned = Brain.Summons.Spawn(d?.tantongId ?? "tantong", d?.drinkTantong ?? 4, o);
        }

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            var q = Qilin;
            float drink = QDef?.drinkSeconds ?? 4f;
            if (q)
            {
                if (q.Effects) q.Effects.Eruption(0.18f);
                q.ManeHeat = Mathf.Min(1f, q.ManeHeat + dt / drink * 0.5f);
            }
            fxAcc += dt;
            if (fxAcc >= 0.06f && Furnace)
            {
                // 熔岩从池面被吸进嘴里
                fxAcc = 0;
                var f = Furnace;
                var src = f.Point(f.QuadrantYaw(Mathf.Max(0, Quadrant)) + Rng.Range(-14f, 14f), f.poolRadius * Rng.Range(0.4f, 0.9f)) + Vector3.up * 0.2f;
                var mouth = q ? q.MouthPoint : Brain.BodyCenter;
                Fx.Burst(Vector3.Lerp(src, mouth, Rng.Value), Rng.Value < 0.5f ? QilinDef.Hot : QilinDef.Fire, 2, 1.5f, 0.4f, 0.25f, -1f);
            }
            bool pending = q && q.CornerPending;
            if ((StageT >= drink && !pending) || StageT >= drink + 2f) Finish();
        }

        /// <summary>喝完：鳞甲回满、伤害 × 1.08、火鬃满</summary>
        void Finish()
        {
            if (finished) return;
            finished = true;
            var hp = Brain.Health;
            hp.armor = hp.maxArmor;
            Brain.damage *= QDef?.drinkDamageGrowth ?? 1.08f;
            Completed++;
            var q = Qilin;
            if (q)
            {
                q.ManeHeat = 1f;
                q.DrinksFinished++;
                if (q.Sipping) q.EndSip();
            }
            // 鳞甲回满：鳞缝一齐亮起暗金鳞光（同人立顶点的鳞光）
            Fx.QilinRearPeak(Brain.BodyCenter + Vector3.up, q ? q.HeadPoint + Vector3.up * 0.5f : Brain.BodyCenter + Vector3.up * 3f);
            Sfx("boss_roar", 1f, 0.95f);
            GameUI.Toast("火麒麟饮完熔岩——鳞甲回满，火鬃更旺了", Hex.Rgb(0xff9a4a), 3f);
            EndActive();
        }

        protected override void OnEnd(bool cancelled)
        {
            var q = Qilin;
            if (q && q.Sipping) q.EndSip();
            Brain.EndDash();
        }
    }
}
