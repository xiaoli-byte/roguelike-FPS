using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>沙暴巨像（Three.js src/enemies/bosses/Colossus.ts）的颜色与尺寸常量</summary>
    public static class ColossusRef
    {
        public static readonly Color Warn = Hex.Rgb(0xff7a2a), Sand = Hex.Rgb(0xd9b27a), BeamColor = Hex.Rgb(0xffa040), WaveColor = Hex.Rgb(0xffb060),
            AimColor = Hex.Rgb(0xff5020);
        /// <summary>扫射光束：离地高度、判定半径、起点（身前距离）与射程</summary>
        public const float BeamY = 0.55f, BeamRadius = 0.22f, BeamStart = 3f, BeamRange = 36f;
        /// <summary>裂地岩刺：单根半径、扇形间隔（弧度）、首根破土前的预警、沿线逐根间隔</summary>
        public const float SpikeRadius = 1.15f, FissureSpread = 0.42f, FissureWarn = 0.85f, FissureStep = 0.075f;
    }

    /// <summary>
    /// 巨像 · 砸地冲击波：双拳高举（身前 3.3 m 亮 3.6 m 圆形预警）→ 砸地：落点重击（击飞）+ 低矮扩散冲击波环（跳过）；二阶段起前摇 0.8 s、0.6 s 后第二道波。
    /// 被落点重击砸飞的玩家落地前跳不起来，紧随其后的第一道波不再追加伤害（spare）
    /// </summary>
    public sealed class ColossusSlam : ReferenceMove
    {
        public override string Id => "colossus_slam";
        public override string Name => "巨像 · 砸地冲击波";

        Vector3 point;
        float wind;
        bool second;

        public ColossusSlam()
        {
            cooldown = 5.5f;
            recovery = 1.3f;
            windup = 1f;
            recover = 0.2f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 22f ? 3f : 1.6f;

        protected override void OnStart()
        {
            wind = (Phase >= 1 ? 0.8f : 1f) * Brain.WindupScale;
            second = false;
            point = OnGround(Brain.transform.position + Dir(Facing) * 3.3f);
            Brain.Halt();
        }

        protected override void OnTelegraph()
        {
            WarnCircle(point, 3.6f, wind, ColossusRef.Warn);
            Sfx("telegraph");
        }

        protected override bool WindupDone => StageT >= wind;
        protected override void OnActiveBegin() => Impact(true);

        protected override void OnActive(float dt)
        {
            if (Phase >= 1 && !second && StageT >= 0.6f)
            {
                second = true;
                Impact(false);
            }
        }

        protected override bool ActiveDone => StageT >= (Phase >= 1 ? 1.2f : 0.75f);

        void Impact(bool first)
        {
            bool crushed = false;
            if (first)
            {
                crushed = Hazards.Blast(point, 3.6f, Dmg(30), new BossBlastOpts { maxHeight = 2.2f, knockback = 9, knockUp = 5 });
                Fx.Explosion(point + Vector3.up * 0.3f, 3.2f, ColossusRef.Sand);
                Brain.Shake(0.7f, 0.5f);
                Sfx("boss_slam");
            }
            else
            {
                Brain.Shake(0.35f, 0.3f);
                Sfx("boss_slam", 0.7f, 1.2f);
            }
            Fx.Burst(point + Vector3.up * 0.3f, ColossusRef.Sand, 22, 8f, 1f, 0.2f, 14f);
            Hazards.Wave(new BossWaveSpec(point, Phase >= 1 ? 13f : 11.5f, 34f, Dmg(20), ColossusRef.WaveColor)
            {
                startRadius = 1.5f, width = 0.9f, height = 0.85f, knockback = 5, dust = true, dustColor = ColossusRef.Sand, spare = crushed,
            });
        }
    }

    /// <summary>
    /// 巨像 · 巨石投掷：蹲身掬石（0.8 s 转向玩家）→ 每 0.14 s 甩出一颗带落点预警的抛物巨石，共 5（二阶段 7）颗：首颗预判玩家 0.8 s 后的位置，其余落在玩家周围 2.5–8.5 m
    /// </summary>
    public sealed class ColossusBoulders : ReferenceMove
    {
        public override string Id => "colossus_boulders";
        public override string Name => "巨像 · 巨石投掷";

        int count, thrown;

        public ColossusBoulders()
        {
            cooldown = 7f;
            recovery = 1.1f;
            windup = 0.85f;
            recover = 0.2f;
            windupAnim = "blessWindup";
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 9f ? 3f : 1f;

        protected override void OnStart()
        {
            count = Phase >= 1 ? 7 : 5;
            thrown = 0;
            Brain.Halt();
            Sfx("telegraph");
        }

        protected override void OnWindup(float dt)
        {
            if (StageT < 0.8f) Brain.Face(Brain.PlayerPosition, 115f, dt);
        }

        protected override void OnActiveBegin() => Throw(thrown++);

        protected override void OnActive(float dt)
        {
            while (thrown < count && StageT >= thrown * 0.14f) Throw(thrown++);
        }

        protected override bool ActiveDone => thrown >= count && StageT >= count * 0.14f + 0.45f;

        void Throw(int i)
        {
            var rng = Rng;
            Vector3 to;
            if (i == 0) to = Brain.Predict(0.8f);
            else
            {
                float a = rng.Range(0, Mathf.PI * 2), r = rng.Range(2.5f, 8.5f);
                to = Brain.PlayerPosition + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
            }
            to = OnGround(Brain.ClampToArena(to, 2f));
            var from = Hand(i % 2 == 0);
            float dist = new Vector2(to.x - from.x, to.z - from.z).magnitude;
            Hazards.Lob(new BossLobSpec(from, to, 1.05f + dist * 0.022f + i * 0.02f, 5f + dist * 0.28f, 3f, Dmg(22), ColossusRef.Warn, LobKind.Boulder));
            Fx.Burst(from, ColossusRef.Sand, 6, 4f, 0.5f, 0.16f, 10f);
            Sfx("skill_throw", 0.8f, 0.55f);
        }
    }

    /// <summary>
    /// 巨像 · 眼部扫射：独眼蓄力（1.2 s，二阶段 0.95 s），两条瞄准线从眼睛到膝高起点、再沿地面射出，转向起始角（玩家方向偏开 1.25 rad）；
    /// 然后膝盖高度的水平光束绕身旋转一圈多（一阶段 2π + 1.25，二阶段起 1.2 圈），角速度 1.35 / 1.7 / 1.95 rad/s。
    /// 判定每 0.5 s 至多一次：眼睛到起点的斜光束（线段打胶囊）或本帧扫过的扇区（<see cref="BossHazards.BeamSweepHits(Vector3, float, float, float, float, float, float, float)"/>，
    /// 低帧率也不漏），跳起（脚底离地约 0.77 m 以上）或躲到掩体后可躲
    /// </summary>
    public sealed class ColossusBeam : ReferenceMove
    {
        public override string Id => "colossus_beam";
        public override string Name => "巨像 · 眼部扫射";

        float charge, angle, prevAngle, sign, speed, sweep, nextHit, fxAcc, soundAcc;
        BossBeam aimA, aimB, main, slant;

        /// <summary>本次扫了多少弧度、打中几次（测试用）</summary>
        public float Swept { get; private set; }
        public int Hits { get; private set; }

        public ColossusBeam()
        {
            cooldown = 13f;
            recovery = 1.4f;
            windup = 1.2f;
            recover = 0.2f;
            weight = 2.4f;
            windupAnim = "bloomWindup";
        }

        protected override void OnStart()
        {
            charge = (Phase >= 1 ? 0.95f : 1.2f) * Brain.WindupScale;
            sign = UnityEngine.Random.value < 0.5f ? -1f : 1f;
            angle = YawToPlayer * Mathf.Deg2Rad - sign * 1.25f;
            prevAngle = angle;
            speed = Phase >= 2 ? 1.95f : Phase >= 1 ? 1.7f : 1.35f;
            sweep = Mathf.PI * 2f * (Phase >= 1 ? 1.2f : 1f) + 1.25f;
            nextHit = 0;
            Swept = 0;
            Brain.Halt();
            aimA = Hazards.Beam(ColossusRef.AimColor);
            aimB = Hazards.Beam(ColossusRef.AimColor);
            Sfx("telegraph", 1f, 0.8f);
            Sfx("enemy_charge", 1f, 0.6f);
        }

        protected override void OnTelegraph()
        {
            // 沿起始角的地面长条（Unity 补的：瞄准线之外再给一条贴地提示，强光下也读得出来）
            var (a, _) = Endpoints(angle);
            Hazards.LineWarning(a, angle * Mathf.Rad2Deg, ColossusRef.BeamRange * 0.5f, 0.6f, charge, ColossusRef.AimColor);
        }

        protected override bool WindupDone => StageT >= charge;

        protected override void OnWindup(float dt)
        {
            TurnToward(angle * Mathf.Rad2Deg, 3f * Mathf.Rad2Deg, dt);
            float u = Mathf.Clamp01(StageT / Mathf.Max(0.01f, charge));
            Brain.Glow(0, u);
            var (a, b) = Endpoints(angle);
            aimA?.Set(Eye, a, 0.025f + 0.035f * u);
            aimB?.Set(a, b, 0.025f + 0.035f * u);
        }

        protected override void OnActiveBegin()
        {
            Hazards.ReleaseBeam(aimA);
            Hazards.ReleaseBeam(aimB);
            aimA = aimB = null;
            prevAngle = angle;
            main = Hazards.Beam(ColossusRef.BeamColor);
            slant = Hazards.Beam(ColossusRef.BeamColor);
            Sfx("shot_beam", 0.9f, 0.5f);
            Brain.Shake(0.25f, 0.3f);
        }

        protected override void OnActive(float dt)
        {
            prevAngle = angle;
            angle += sign * speed * dt;
            Swept += speed * dt;
            SetFacing(angle * Mathf.Rad2Deg);
            Brain.Glow(0, 1);
            var (a, b) = Endpoints(angle);
            var eye = Eye;
            main?.Set(a, b, 0.26f);
            slant?.Set(eye, a, 0.22f);
            if (Time.time >= nextHit && (Hazards.SegmentHitsPlayer(eye, a, 0.24f)
                || Hazards.BeamSweepHits(Brain.transform.position, Floor, prevAngle, angle, ColossusRef.BeamY, ColossusRef.BeamRadius, ColossusRef.BeamStart, ColossusRef.BeamRange)))
            {
                if (Hazards.Hurt(Dmg(16), Element.Fire, eye) > 0) Hits++;
                nextHit = Time.time + 0.5f;
            }
            fxAcc += dt;
            if (fxAcc >= 0.05f)
            {
                fxAcc = 0;
                Fx.Burst(b, ColossusRef.BeamColor, 3, 4f, 0.35f, 0.14f, 6f);
                Fx.Burst(a, ColossusRef.Sand, 2, 3f, 0.4f, 0.14f, 4f);
            }
            soundAcc += dt;
            if (soundAcc >= 0.35f)
            {
                soundAcc = 0;
                Sfx("shot_beam", 0.4f, 0.55f);
            }
        }

        protected override bool ActiveDone => Swept >= sweep;

        /// <summary>膝高光束的起点（身前 3 m、离地 0.55 m）与终点（射程内打到的第一处地形）</summary>
        (Vector3 a, Vector3 b) Endpoints(float yawRad)
        {
            var dir = new Vector3(Mathf.Sin(yawRad), 0, Mathf.Cos(yawRad));
            var p = Brain.transform.position;
            var a = new Vector3(p.x, Floor + ColossusRef.BeamY, p.z) + dir * ColossusRef.BeamStart;
            float len = Physics.Raycast(a, dir, out var hit, ColossusRef.BeamRange, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.distance : ColossusRef.BeamRange;
            return (a, a + dir * len);
        }

        protected override void OnEnd(bool cancelled)
        {
            Hazards.ReleaseBeam(aimA);
            Hazards.ReleaseBeam(aimB);
            Hazards.ReleaseBeam(main);
            Hazards.ReleaseBeam(slant);
            aimA = aimB = main = slant = null;
            Brain.Glow(0, 0);
        }
    }

    /// <summary>
    /// 巨像 · 践踏（反贴身）：抬腿，脚下亮 6.2 m 圆形预警（0.78 s，二阶段 0.62 s）→ 震地重击 + 强击退（看准时机起跳可躲：高度上限 1.1 m）；
    /// 二阶段起再从 6.2 m 处扩散一道冲击波到 16 m
    /// </summary>
    public sealed class ColossusStomp : ReferenceMove
    {
        public override string Id => "colossus_stomp";
        public override string Name => "巨像 · 践踏";

        float wind;

        public ColossusStomp()
        {
            cooldown = 4.5f;
            recovery = 0.9f;
            windup = 0.78f;
            active = 0.7f;
            recover = 0.1f;
            windupAnim = "chordWindup";
        }

        /// <summary>贴身越近越想踩（TS 用贴身计时 closeTime &gt; 0.9 s 时权重 8；这里按距离近似）</summary>
        public override float Weight(BossBrain b) => b.DistanceToPlayer < 4f ? 8f : b.DistanceToPlayer < 6.5f ? 3f : 0f;

        protected override void OnStart()
        {
            wind = (Phase >= 1 ? 0.62f : 0.78f) * Brain.WindupScale;
            Brain.Halt();
        }

        protected override void OnTelegraph()
        {
            WarnCircle(OnGround(Brain.transform.position), 6.2f, wind, ColossusRef.Warn);
            Sfx("telegraph");
        }

        protected override bool WindupDone => StageT >= wind;

        protected override void OnActiveBegin()
        {
            var c = OnGround(Brain.transform.position);
            bool crushed = Hazards.Blast(c, 6.2f, Dmg(24), new BossBlastOpts { maxHeight = 1.1f, knockback = 13, knockUp = 6 });
            Fx.Ring(c + Vector3.up * 0.1f, 6.5f, ColossusRef.Sand, 0.5f);
            Fx.Burst(c + Vector3.up * 0.3f, ColossusRef.Sand, 26, 9f, 0.9f, 0.2f, 14f);
            Brain.Shake(0.6f, 0.45f);
            Sfx("boss_slam");
            if (Phase >= 1)
                Hazards.Wave(new BossWaveSpec(c, 12f, 16f, Dmg(16), ColossusRef.WaveColor)
                {
                    startRadius = 6.2f, width = 0.8f, height = 0.8f, dust = true, dustColor = ColossusRef.Sand, spare = crushed,
                });
        }
    }

    /// <summary>
    /// 巨像 · 裂地岩刺（二阶段起）：双拳捶地，3（三阶段 5）道岩刺沿扇形（间隔 0.42 rad）由近到远依次破土，每道最多 12 根、到场地边缘为止。
    /// 每道一条长条预警（hazard 组：填满后保持到最后一根破土；地刺已排好破土任务，招式被打断后照常破土），不给每根刺单独画圆。同一次施放最多命中玩家一次
    /// </summary>
    public sealed class ColossusFissure : ReferenceMove
    {
        public override string Id => "colossus_fissure";
        public override string Name => "巨像 · 裂地岩刺";

        /// <summary>上一次排进的地刺数（测试用）</summary>
        public int LastSpikes { get; private set; }

        public ColossusFissure()
        {
            cooldown = 8f;
            recovery = 1.2f;
            windup = 0.62f;
            active = 0.73f;
            recover = 0.1f;
            windupAnim = "chordWindup";
        }

        public override float Weight(BossBrain b) => b.Phase >= 1 ? 2.8f : 0f;

        protected override void OnStart()
        {
            Brain.Halt();
            Sfx("telegraph");
        }

        protected override void OnWindup(float dt)
        {
            if (StageT < 0.45f) Brain.Face(Brain.PlayerPosition, 140f, dt);
        }

        protected override void OnActiveBegin()
        {
            int lines = Phase >= 2 ? 5 : 3;
            float mid = (lines - 1) * 0.5f;
            var volley = new HazardVolley();
            var pos = Brain.transform.position;
            float floor = Floor;
            LastSpikes = 0;
            for (int l = 0; l < lines; l++)
            {
                float yaw = Facing + (l - mid) * ColossusRef.FissureSpread * Mathf.Rad2Deg;
                var dir = Dir(yaw);
                float maxD = ToEdge(pos, dir, 1.5f);
                int n = 0;
                for (int j = 0; j < 12; j++)
                {
                    float d = 3.2f + j * 2.1f;
                    if (d > maxD) break;
                    var p = pos + dir * d;
                    p.y = floor;
                    p.y = GroundY(p);
                    Hazards.Erupt(new BossEruptSpec(p, ColossusRef.SpikeRadius, ColossusRef.FissureWarn + j * ColossusRef.FissureStep, Dmg(20), ColossusRef.Warn, SpikeKind.Rock)
                    {
                        sound = l == Mathf.FloorToInt(mid) && j % 3 == 0, warn = false, volley = volley,
                    });
                    n++;
                }
                LastSpikes += n;
                if (n <= 0) continue;
                float start = 3.2f - ColossusRef.SpikeRadius, len = 2.1f * (n - 1) + ColossusRef.SpikeRadius * 2;
                var from = pos + dir * start;
                from.y = floor;
                Hazards.LineWarning(from, yaw, len, ColossusRef.SpikeRadius, ColossusRef.FissureWarn, ColossusRef.Warn, (n - 1) * ColossusRef.FissureStep + 0.1f, WarnKind.Hazard);
            }
            var fist = Brain.BodyCenter + Dir(Facing) * (Brain.BodyRadius + 1f);
            fist.y = floor + 0.2f;
            Fx.Explosion(fist, 2.2f, ColossusRef.Sand);
            Brain.Shake(0.5f, 0.35f);
            Sfx("boss_slam", 1f, 0.9f);
        }
    }
}
