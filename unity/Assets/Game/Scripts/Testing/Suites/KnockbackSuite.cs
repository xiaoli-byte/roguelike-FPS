using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 击退不穿地（bridge.sh playtest knockback；场景 TestArena）。根因：角色控制器的重叠恢复把胶囊沿最短方向推出压着它的静态碰撞体
    /// （敌人根节点的角色胶囊没有刚体），方向朝下时不扫掠、直接推进地形；PlayerMotor 的防穿地（GroundRescues）把人放回地面。
    ///   · 冲量扫描：平地上 AddImpulse / Launch 各种强度、各种方向（含向下分量、纯向下 60 m/s），每次看 1.2 s——扫掠本来就挡得住，不该触发托回；
    ///   · 身体压顶：静态胶囊 / 运动学刚体横躺着瞬移到玩家头顶、压住上半身——静态的那种以前把人挤进地里 0.62 m，现在要托回、不陷地；
    ///     站在 35° 坡板上被压顶：托回要贴着坡面放（不能一半埋进坡里）；
    ///   · 不误救（这几种中间没有被挤穿的地面，或者胶囊不和世界几何重叠，托回次数必须不变）：
    ///     跟着下降 / 上升的平台（静态碰撞体逐帧挪 + 运动学刚体 MovePosition），3-2 炉坛升降台（ForgeWellLift 真组件）载人下行，
    ///     通用移动平台（MovingPlatform 真组件）竖直 / 斜着 / 先平移再下降，从台边走下去 / 冲刺冲下去 / 击飞飞下去，
    ///     走下台阶、走下 35° 坡、从 60° 陡坡滑下、走过 8 cm 厚的薄桥再从桥头 / 桥侧掉下去，第三章铸坊的白盒桥（0.4 m 厚、比床面高 5 cm）上下、横穿，
    ///     大位移（30 m/s 横飞 + 42 m/s 下坠）擦过一块悬空楼板的边——不能被放到楼板上；
    ///   · 冰甲旋龟复现：玩家站在旋龟正前方 14 m，等它缩壳旋转撞飞玩家、过热翻倒、翻回来，三轮。
    /// 每帧量脚底到地形的高度；不合格：任何一帧脚底低于地形 0.15 m 以上、不该托回的情况托回了、该托回的没托回。
    /// </summary>
    public sealed class KnockbackSuite : PlaytestSuite
    {
        public override string Id => "knockback";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const float SinkTolerance = 0.15f, Walk = 7.5f;

        ArenaSpawner arena;
        PlayerMotor motor;
        PlayerVitals vitals;
        CharacterController cc;
        Vector3 away, side, spot;
        float worstSink;
        string worstAt = "";
        int sinkLogs;
        readonly List<GameObject> temp = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？）");
                yield break;
            }
            cc = motor.GetComponent<CharacterController>();
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Add("playtest_knockback", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            spot = arena.Center + away * 20f;

            yield return ImpulseSweep();
            yield return BodyOverlap();
            yield return Platforms();
            yield return Edges();
            yield return StairsSlopesBridge();
            yield return Overhang();
            yield return XuanGuiSpin();

            Cleanup();
            vitals.stats.Remove("playtest_knockback");
            arena.Clear();
            Line($"合计：最深陷地 {worstSink:F2} m{(worstSink > SinkTolerance ? $"（{worstAt}）" : " ✓")}，防穿地托回共 {motor.GroundRescues} 次");
            if (worstSink > SinkTolerance) Fail($"玩家被推到地面以下 {worstSink:F2} m：{worstAt}");
        }

        // ───────────── 量地面 ─────────────

        /// <summary>脚底低于地形多少米（负 = 在地形以上）；不在地形上方返回 NaN（只认地形：楼板、台子下面不算陷地）</summary>
        float SinkDepth()
        {
            var p = motor.transform.position;
            foreach (var t in Terrain.activeTerrains)
            {
                if (!t || !t.terrainData) continue;
                var o = t.GetPosition();
                var s = t.terrainData.size;
                if (p.x < o.x || p.z < o.z || p.x > o.x + s.x || p.z > o.z + s.z) continue;
                return o.y + t.SampleHeight(p) - p.y;
            }
            return float.NaN;
        }

        /// <summary>每帧记一次；陷进去时打印现场（每段最多 4 行）</summary>
        void Measure(string label, string extra = null)
        {
            float d = SinkDepth();
            if (!float.IsFinite(d)) return;
            if (d > worstSink)
            {
                worstSink = d;
                worstAt = $"{label}{(extra != null ? " " + extra : "")}";
            }
            if (d > SinkTolerance && sinkLogs < 4)
            {
                sinkLogs++;
                Line($"  ✗ {label}：陷地 {d:F2} m，速度 {motor.Velocity}，压着 {Overlaps()}{(extra != null ? "，" + extra : "")}");
            }
        }

        string Overlaps()
        {
            var p = motor.transform.position;
            float r = cc.radius, h = cc.height;
            var a = p + cc.center - Vector3.up * (h * 0.5f - r);
            var b = p + cc.center + Vector3.up * (h * 0.5f - r);
            var hits = Physics.OverlapCapsule(a, b, r + 0.02f, ~0, QueryTriggerInteraction.Ignore)
                .Where(c => c && c.gameObject != motor.gameObject && !c.transform.IsChildOf(motor.transform))
                .Select(c => $"{c.name}({c.GetType().Name}{(c.attachedRigidbody ? c.attachedRigidbody.isKinematic ? ",运动学" : ",刚体" : ",静态")})").ToList();
            return hits.Count > 0 ? string.Join("、", hits) : "无";
        }

        float GroundY(Vector3 at) =>
            Physics.Raycast(new Vector3(at.x, at.y + 30, at.z), Vector3.down, out var hit, 80, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : at.y;

        void Stand(Vector3 feet, float yaw = 0) => motor.Teleport(feet + Vector3.up * 0.02f, yaw);

        void StandOnGround(Vector3 at, float yaw = 0) => Stand(new Vector3(at.x, GroundY(at), at.z), yaw);

        /// <summary>临时场景件（立方体，Default 层，带碰撞体）；kinematic = 加运动学刚体</summary>
        GameObject Box(string name, Vector3 center, Vector3 size, Quaternion? rot = null, bool kinematic = false)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Knockback Test · " + name;
            go.layer = 0;
            go.transform.SetPositionAndRotation(center, rot ?? Quaternion.identity);
            go.transform.localScale = size;
            if (kinematic)
            {
                var rb = go.AddComponent<Rigidbody>();
                rb.isKinematic = true;
                rb.useGravity = false;
                rb.interpolation = RigidbodyInterpolation.None;
            }
            temp.Add(go);
            Physics.SyncTransforms();
            return go;
        }

        void Cleanup()
        {
            foreach (var g in temp) if (g) Destroy(g);
            temp.Clear();
        }

        /// <summary>按住一个水平速度走 seconds 秒（每帧把水平速度设回去，竖直速度照旧）——测试里没有键盘输入，用它代替走路</summary>
        IEnumerator Drive(Vector3 horizontal, float seconds, string label, System.Func<bool> stop = null)
        {
            float t0 = Time.time;
            while (Time.time - t0 < seconds && (stop == null || !stop()))
            {
                motor.Launch(new Vector3(horizontal.x, Mathf.Min(0, motor.Velocity.y), horizontal.z));
                Measure(label);
                yield return null;
            }
        }

        /// <summary>不该托回：这一段托回次数必须不变</summary>
        void ExpectNoRescue(string label, int before, List<string> bad)
        {
            int n = motor.GroundRescues - before;
            if (n > 0) bad.Add($"{label} 托回了 {n} 次（最近一次深 {motor.LastRescueDepth:F2} m）");
        }

        // ───────────── 冲量扫描 ─────────────

        IEnumerator ImpulseSweep()
        {
            sinkLogs = 0;
            var cases = new List<(string name, Vector3 v, bool launch)>();
            foreach (float k in new[] { 6f, 11f, 20f, 35f })
            {
                cases.Add(($"水平 {k}", away * k, false));
                cases.Add(($"上抛 {k}", away * k + Vector3.up * 5f, false));
                cases.Add(($"斜下 {k}", side * k + Vector3.down * k * 0.6f, false));
                cases.Add(($"抛射斜下 {k}", away * k + Vector3.down * k, true));
            }
            cases.Add(("纯向下 60", Vector3.down * 60f, false));
            cases.Add(("抛射纯向下 60", Vector3.down * 60f, true));
            cases.Add(("连击 上 + 下", Vector3.up * 8f, false));
            float before = worstSink;
            int bad = 0, r0 = motor.GroundRescues;
            foreach (var c in cases)
            {
                StandOnGround(spot);
                yield return null;
                yield return null;
                float w0 = worstSink;
                if (c.launch) motor.Launch(c.v);
                else motor.AddImpulse(c.v);
                float t0 = Time.time;
                bool second = c.name.StartsWith("连击");
                while (Time.time - t0 < 1.2f)
                {
                    if (second && Time.time - t0 > 0.25f)
                    {
                        second = false;
                        motor.AddImpulse(Vector3.down * 40f);
                    }
                    Measure($"冲量 {c.name}");
                    yield return null;
                }
                if (worstSink > w0 && worstSink > SinkTolerance) bad++;
            }
            int rescues = motor.GroundRescues - r0;
            Line($"冲量扫描 {cases.Count} 种：{(bad == 0 ? "全都没陷地 ✓" : $"{bad} 种陷地 ✗")}（最深 {Mathf.Max(0, worstSink - Mathf.Max(0, before)):F2} m），托回 {rescues} 次{(rescues == 0 ? " ✓" : " ✗")}");
            if (rescues > 0) Fail($"平地上的冲量不该触发防穿地托回（托回了 {rescues} 次）");
        }

        // ───────────── 敌人身体压过来 ─────────────

        IEnumerator BodyOverlap()
        {
            sinkLogs = 0;
            int bad = 0, rescued = 0;
            // 静态胶囊（敌人根节点的角色胶囊）和运动学刚体（弱点球 / 布娃娃骨骼）各一种，横躺着瞬移到玩家头顶、下沿低于头顶
            foreach (bool kinematic in new[] { false, true })
            foreach (float bottom in new[] { 1.2f, 1.6f, 2.0f })
            {
                StandOnGround(spot);
                yield return null;
                var go = new GameObject(kinematic ? "Knockback Test Body (kinematic)" : "Knockback Test Body (static)");
                go.layer = Layers.Character;
                var cap = go.AddComponent<CapsuleCollider>();
                cap.direction = 0;
                cap.radius = 0.8f;
                cap.height = 5f;
                if (kinematic)
                {
                    var rb = go.AddComponent<Rigidbody>();
                    rb.isKinematic = true;
                    rb.useGravity = false;
                }
                var feet = motor.transform.position;
                go.transform.position = feet + Vector3.up * (bottom + cap.radius);
                Physics.SyncTransforms();
                float w0 = worstSink;
                int r0 = motor.GroundRescues;
                float t0 = Time.time;
                while (Time.time - t0 < 0.8f)
                {
                    Measure($"身体压顶（{(kinematic ? "运动学" : "静态")}，下沿 {bottom} m）");
                    yield return null;
                }
                if (motor.GroundRescues > r0) rescued++;
                Destroy(go);
                yield return null;
                if (worstSink > w0 && worstSink > SinkTolerance) bad++;
            }
            Line($"身体压顶 6 种：{(bad == 0 ? "都没把玩家挤进地里 ✓" : $"{bad} 种挤进地里 ✗")}，其中 {rescued} 种靠防穿地托回");

            // 站在 35° 坡板上被压顶：坡板是盒子（不是地形），按坡面量；托回要贴着坡面放，不能一半埋进坡里
            var at = spot - side * 8f + away * 6f;
            float g = GroundY(at);
            const float deg = 35f;
            var rot = Quaternion.Euler(0, 0, -deg);
            var up = rot * Vector3.up;
            var ramp = Box("压顶坡板 35°", new Vector3(at.x, g + 1.4f, at.z) - up * 0.2f, new Vector3(6f, 0.4f, 4f), rot);
            float SurfaceY(Vector3 p) =>
                Physics.Raycast(new Vector3(p.x, g + 8f, p.z), Vector3.down, out var h, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore) && h.collider.gameObject == ramp
                    ? h.point.y : float.NaN;
            var foot = new Vector3(at.x, 0, at.z);
            foot.y = SurfaceY(foot);
            var worst = new List<string>();
            foreach (float bottom in new[] { 1.2f, 1.6f })
            {
                Stand(foot + Vector3.up * 0.05f, 90);
                yield return null;
                yield return null;
                var body = new GameObject("Knockback Test Body (static, on ramp)") { layer = Layers.Character };
                var cap = body.AddComponent<CapsuleCollider>();
                cap.direction = 0;
                cap.radius = 0.8f;
                cap.height = 5f;
                body.transform.position = motor.transform.position + Vector3.up * (bottom + cap.radius);
                Physics.SyncTransforms();
                int r0 = motor.GroundRescues;
                float deepest = float.NegativeInfinity, t0 = Time.time;
                while (Time.time - t0 < 0.8f)
                {
                    float s = SurfaceY(motor.transform.position);
                    if (float.IsFinite(s)) deepest = Mathf.Max(deepest, s - motor.transform.position.y);
                    Measure($"坡板上压顶（下沿 {bottom} m）");
                    yield return null;
                }
                Destroy(body);
                yield return null;
                Line($"  坡板上压顶（下沿 {bottom} m）：脚底最深低于坡面 {(float.IsFinite(deepest) ? deepest : 0):F2} m，托回 {motor.GroundRescues - r0} 次");
                if (deepest > SinkTolerance) worst.Add($"坡板上压顶（下沿 {bottom} m）：脚底低于坡面 {deepest:F2} m");
            }
            temp.Remove(ramp);
            Destroy(ramp);
            yield return null;
            Report("坡板上压顶", worst);
        }

        // ───────────── 不误救：平台 ─────────────

        IEnumerator Platforms()
        {
            sinkLogs = 0;
            var bad = new List<string>();
            var at = spot + side * 8f;
            float g = GroundY(at);
            foreach (bool kinematic in new[] { false, true })
            foreach (float speed in new[] { -2f, -6f, 3f })
            {
                string label = $"{(kinematic ? "运动学" : "静态")}平台{(speed < 0 ? "下降" : "上升")} {Mathf.Abs(speed)} m/s";
                const float top0 = 3f, thick = 0.4f;
                var plat = Box(label, new Vector3(at.x, g + top0 - thick * 0.5f, at.z), new Vector3(4f, thick, 4f), null, kinematic);
                var rb = plat.GetComponent<Rigidbody>();
                Stand(new Vector3(at.x, g + top0, at.z));
                yield return null;
                yield return null;
                int r0 = motor.GroundRescues;
                float minGap = float.PositiveInfinity, travel = 0;
                // 下降 2.4 m（不钻进地形）、上升 2 m
                float limit = speed < 0 ? 2.4f : 2f;
                while (travel < limit)
                {
                    float step = Mathf.Min(limit - travel, Mathf.Abs(speed) * Time.deltaTime);
                    travel += step;
                    var p = plat.transform.position + Vector3.up * Mathf.Sign(speed) * step;
                    if (rb) rb.MovePosition(p);
                    else
                    {
                        plat.transform.position = p;
                        Physics.SyncTransforms();
                    }
                    yield return null;
                    float top = plat.transform.position.y + thick * 0.5f;
                    minGap = Mathf.Min(minGap, motor.transform.position.y - top);
                    Measure(label);
                }
                // 停下来站稳
                for (int i = 0; i < 10; i++)
                {
                    yield return null;
                    minGap = Mathf.Min(minGap, motor.transform.position.y - (plat.transform.position.y + thick * 0.5f));
                }
                float endGap = motor.transform.position.y - (plat.transform.position.y + thick * 0.5f);
                ExpectNoRescue(label, r0, bad);
                if (minGap < -0.1f) bad.Add($"{label}：脚底一度低于台面 {-minGap:F2} m");
                if (Mathf.Abs(endGap) > 0.15f) bad.Add($"{label}：停下后没站在台面上（离台面 {endGap:F2} m）");
                Line($"  {label}：最低离台面 {minGap:F2} m，停下后 {endGap:F2} m，托回 {motor.GroundRescues - r0} 次");
                temp.Remove(plat);
                Destroy(plat);
                yield return null;
            }
            Report("跟着平台升降", bad);
            yield return RealLift();
            yield return RealMovingPlatform();
        }

        /// <summary>
        /// 通用移动平台（真组件 MovingPlatform / PlatformCarrier，OnRide）载人：竖直下行 6 m/s、斜着下行（下 4.5 m 同时横移 5 m）、
        /// 先平移再下降的折线——都不该触发托回，脚底一直贴着台面
        /// </summary>
        IEnumerator RealMovingPlatform()
        {
            var bad = new List<string>();
            var at = spot + side * 14f - away * 4f;
            float g = GroundY(at);
            const float thick = 0.5f;
            var cases = new (string name, Vector3[] path, float speed)[]
            {
                ("移动平台竖直下行 6 m/s", new[] { new Vector3(at.x, g + 6f, at.z), new Vector3(at.x, g + 0.6f, at.z) }, 6f),
                ("移动平台斜着下行", new[] { new Vector3(at.x, g + 5.1f, at.z), new Vector3(at.x + 5f, g + 0.6f, at.z) }, 4f),
                ("移动平台先平移再下降", new[] { new Vector3(at.x, g + 5.1f, at.z), new Vector3(at.x + 4f, g + 5.1f, at.z), new Vector3(at.x + 4f, g + 0.6f, at.z + 3f) }, 4f),
            };
            foreach (var (name, path, speed) in cases)
            {
                var go = new GameObject("Knockback Test · " + name);
                go.SetActive(false);
                go.transform.position = path[0];
                var box = go.AddComponent<BoxCollider>();
                box.size = new Vector3(4f, thick, 4f);
                box.center = new Vector3(0, -thick * 0.5f, 0);
                var mp = go.AddComponent<MovingPlatform>();
                mp.deck = go.transform;
                mp.deckSize = new Vector2(4f, 4f);
                mp.deckThickness = thick;
                mp.path = path;
                mp.mode = MovingPlatform.Mode.OnRide;
                mp.speed = speed;
                mp.accel = 6f;
                mp.departDelay = 0.4f;
                mp.startPowered = true;
                mp.poweredToast = mp.blockedToast = "";
                temp.Add(go);
                go.SetActive(true);
                Physics.SyncTransforms();
                yield return null;
                Stand(path[0], 90);
                int r0 = motor.GroundRescues, trips0 = mp.Trips;
                float minGap = float.PositiveInfinity, t0 = Time.time;
                bool moved = false;
                while (!(mp.Trips > trips0 && !mp.Moving) && Time.time - t0 < 10f)
                {
                    yield return null;
                    moved |= mp.Moving;
                    if (mp.Moving) minGap = Mathf.Min(minGap, motor.transform.position.y - mp.deck.position.y);
                    Measure(name);
                }
                for (int i = 0; i < 10; i++) yield return null;
                float endGap = motor.transform.position.y - mp.deck.position.y;
                bool onDeck = mp.Carrying(cc);
                Line($"  {name}（MovingPlatform）：{(mp.Trips > trips0 ? "到站" : moved ? "没到站" : "没开")}，途中脚底最低离台面 {(float.IsFinite(minGap) ? minGap : 0):F2} m，" +
                     $"到站后 {endGap:F2} m、{(onDeck ? "还在台上" : "不在台上")}，托回 {motor.GroundRescues - r0} 次");
                if (!moved) bad.Add($"{name}：站上去 10 s 没开（测试布置不对）");
                else if (mp.Trips == trips0) bad.Add($"{name}：10 s 内没到站");
                ExpectNoRescue(name, r0, bad);
                if (minGap < -0.1f) bad.Add($"{name}：脚底一度低于台面 {-minGap:F2} m");
                if (Mathf.Abs(endGap) > 0.15f || !onDeck) bad.Add($"{name}：到站后没站在台面上（离台面 {endGap:F2} m）");
                temp.Remove(go);
                Destroy(go);
                yield return null;
            }
            Report("通用移动平台载人", bad);
        }

        /// <summary>3-2 炉坛升降台（真组件 ForgeWellLift）载人下行 5.4 m：台面先挪、乘客按同样的位移 Move 下来，不该触发托回</summary>
        IEnumerator RealLift()
        {
            var bad = new List<string>();
            var at = spot + side * 8f - away * 7f;
            float g = GroundY(at);
            const float thick = 0.5f;
            var high = new Vector3(at.x, g + 6f, at.z);
            var low = new Vector3(at.x, g + 0.6f, at.z);
            var go = new GameObject("Knockback Test · 炉坛升降台");
            go.SetActive(false);
            go.transform.position = high;
            var box = go.AddComponent<BoxCollider>();
            box.size = new Vector3(4f, thick, 4f);
            box.center = new Vector3(0, -thick * 0.5f, 0);
            var lift = go.AddComponent<ForgeWellLift>();
            lift.deck = go.transform;
            lift.deckSize = new Vector2(4f, 4f);
            lift.deckThickness = thick;
            lift.lowPosition = low;
            lift.highPosition = high;
            lift.poweredToast = lift.blockedToast = "";
            temp.Add(go);
            go.SetActive(true);
            Physics.SyncTransforms();
            yield return null;
            Stand(high, 90);
            int r0 = motor.GroundRescues, trips0 = lift.Trips;
            float minGap = float.PositiveInfinity, t0 = Time.time;
            bool moved = false;
            while (!(lift.AtLow && lift.Trips > trips0) && Time.time - t0 < 8f)
            {
                yield return null;
                moved |= lift.Moving;
                if (lift.Moving) minGap = Mathf.Min(minGap, motor.transform.position.y - lift.deck.position.y);
                Measure("炉坛升降台下行");
            }
            for (int i = 0; i < 10; i++) yield return null;
            float endGap = motor.transform.position.y - lift.deck.position.y;
            Line($"  炉坛升降台（ForgeWellLift）载人下行：{(lift.AtLow ? "到了下站" : moved ? "没到下站" : "没开")}，途中脚底最低离台面 {(float.IsFinite(minGap) ? minGap : 0):F2} m，" +
                 $"停下后 {endGap:F2} m，托回 {motor.GroundRescues - r0} 次");
            if (!moved) bad.Add("炉坛升降台：站上去 8 s 没开（测试布置不对）");
            else if (!lift.AtLow) bad.Add("炉坛升降台：8 s 内没到下站");
            ExpectNoRescue("炉坛升降台载人下行", r0, bad);
            if (minGap < -0.1f) bad.Add($"炉坛升降台下行：脚底一度低于台面 {-minGap:F2} m");
            if (Mathf.Abs(endGap) > 0.15f) bad.Add($"炉坛升降台下行：到站后没站在台面上（离台面 {endGap:F2} m）");
            temp.Remove(go);
            Destroy(go);
            yield return null;
            Report("炉坛升降台载人下行", bad);
        }

        // ───────────── 不误救：从台边下去 ─────────────

        IEnumerator Edges()
        {
            sinkLogs = 0;
            var bad = new List<string>();
            var at = spot - side * 8f;
            float g = GroundY(at);
            const float h = 2.5f;
            var block = Box("台子 2.5 m", new Vector3(at.x, g + h * 0.5f, at.z), new Vector3(4f, h, 4f));
            // 台面上离东沿 0.6 m 处起步，朝东下去
            var start = new Vector3(at.x + 1.4f, g + h, at.z);
            foreach (var (name, speed, up) in new[] { ("走下台边", Walk, 0f), ("冲刺冲下台边", 22f, 0f), ("击飞飞下台边", 35f, 5f), ("贴边慢慢挪下去", 1.2f, 0f) })
            {
                Stand(start, 90);
                yield return null;
                yield return null;
                int r0 = motor.GroundRescues;
                if (up > 0)
                {
                    motor.Launch(new Vector3(speed, up, 0));
                    float t0 = Time.time;
                    while (Time.time - t0 < 1.4f)
                    {
                        Measure(name);
                        yield return null;
                    }
                }
                else yield return Drive(new Vector3(speed, 0, 0), speed < 2 ? 2.2f : 1.2f, name);
                ExpectNoRescue(name, r0, bad);
                bool down = motor.transform.position.y < g + 0.5f;
                if (!down) bad.Add($"{name}：没下到地面（脚底 {motor.transform.position.y - g:F2} m）");
                Line($"  {name}：落到 {motor.transform.position.y - g:F2} m，托回 {motor.GroundRescues - r0} 次");
            }
            temp.Remove(block);
            Destroy(block);
            yield return null;
            Report("从台边下去", bad);
        }

        // ───────────── 不误救：台阶、坡、薄桥 ─────────────

        IEnumerator StairsSlopesBridge()
        {
            sinkLogs = 0;
            var bad = new List<string>();
            var at = spot + away * 10f;
            float g = GroundY(at);
            // 台阶：6 级、每级高 0.3 m 深 0.6 m，从 1.8 m 往东一级级下到地面
            for (int i = 0; i < 6; i++)
            {
                float top = 1.8f - 0.3f * i;
                Box($"台阶 {i + 1}", new Vector3(at.x + 0.6f * i, g + top * 0.5f, at.z), new Vector3(0.6f, top, 3f));
            }
            Stand(new Vector3(at.x - 0.1f, g + 1.8f, at.z), 90);
            yield return null;
            int r0 = motor.GroundRescues;
            yield return Drive(new Vector3(Walk, 0, 0), 1.0f, "走下台阶");
            ExpectNoRescue("走下台阶", r0, bad);
            Line($"  走下台阶：落到 {motor.transform.position.y - g:F2} m，托回 {motor.GroundRescues - r0} 次");
            // 冲刺冲下台阶
            Stand(new Vector3(at.x - 0.1f, g + 1.8f, at.z), 90);
            yield return null;
            r0 = motor.GroundRescues;
            yield return Drive(new Vector3(22f, 0, 0), 0.5f, "冲刺冲下台阶");
            ExpectNoRescue("冲刺冲下台阶", r0, bad);
            Cleanup();
            yield return null;

            // 坡：35°（走得下去）、60°（滑下去）的斜板，坡顶 2.5 m
            foreach (float deg in new[] { 35f, 60f })
            {
                float len = 2.5f / Mathf.Sin(deg * Mathf.Deg2Rad);
                var rot = Quaternion.Euler(0, 0, -deg);
                var dirDown = rot * Vector3.right;
                var mid = new Vector3(at.x, g + 1.25f, at.z) - rot * Vector3.up * 0.2f;
                Box($"坡 {deg}°", mid, new Vector3(len + 0.6f, 0.4f, 3f), rot);
                var topPt = new Vector3(at.x, g + 1.25f, at.z) - dirDown * (len * 0.5f - 0.3f);
                Stand(topPt + Vector3.up * 0.05f, 90);
                yield return null;
                r0 = motor.GroundRescues;
                string label = deg < 45 ? "走下 35° 坡" : "从 60° 陡坡滑下";
                if (deg < 45) yield return Drive(new Vector3(Walk, 0, 0), 1.0f, label);
                else
                {
                    float t0 = Time.time;
                    while (Time.time - t0 < 1.5f)
                    {
                        Measure(label);
                        yield return null;
                    }
                }
                ExpectNoRescue(label, r0, bad);
                Line($"  {label}：落到 {motor.transform.position.y - g:F2} m，托回 {motor.GroundRescues - r0} 次");
                Cleanup();
                yield return null;
            }

            // 薄桥：8 cm 厚、8 m 长、1.2 m 高的木板（两头悬空），从西头走到东头再掉下去
            Box("薄桥", new Vector3(at.x, g + 1.2f - 0.04f, at.z), new Vector3(8f, 0.08f, 1.6f));
            Stand(new Vector3(at.x - 3.6f, g + 1.2f, at.z), 90);
            yield return null;
            r0 = motor.GroundRescues;
            float minOnBridge = float.PositiveInfinity;
            yield return Drive(new Vector3(Walk, 0, 0), 1.6f, "走过薄桥", () =>
            {
                if (motor.transform.position.x < at.x + 3.6f) minOnBridge = Mathf.Min(minOnBridge, motor.transform.position.y - (g + 1.2f));
                return false;
            });
            ExpectNoRescue("走过薄桥再掉下去", r0, bad);
            if (minOnBridge < -0.1f) bad.Add($"走过薄桥：在桥上时脚底一度低于桥面 {-minOnBridge:F2} m");
            Line($"  薄桥：桥上最低离桥面 {minOnBridge:F2} m，最后落到 {motor.transform.position.y - g:F2} m，托回 {motor.GroundRescues - r0} 次");
            // 从桥中间往侧面走出去 / 冲刺冲出去（脚下从桥面换成 1.2 m 下面的地面，射线擦过桥沿）
            foreach (var (name, speed) in new[] { ("从薄桥侧面走下去", Walk), ("从薄桥侧面冲刺冲下去", 22f) })
            {
                Stand(new Vector3(at.x, g + 1.2f, at.z + 0.4f), 0);
                yield return null;
                yield return null;
                r0 = motor.GroundRescues;
                yield return Drive(new Vector3(0, 0, speed), speed > 10 ? 0.5f : 1.0f, name);
                for (int i = 0; i < 20; i++)
                {
                    Measure(name);
                    yield return null;
                }
                ExpectNoRescue(name, r0, bad);
                if (motor.transform.position.y > g + 0.5f) bad.Add($"{name}：没落到地面（脚底 {motor.transform.position.y - g:F2} m）");
                Line($"  {name}：落到 {motor.transform.position.y - g:F2} m，托回 {motor.GroundRescues - r0} 次");
            }
            Cleanup();
            yield return null;

            // 第三章铸坊的白盒桥（Level_3_3 PlaceOrBox）：0.4 m 厚的盒子、桥面比床面高 5 cm、压在床面上——从地面走上桥、走过去、从桥侧面下来、冲刺横穿
            const float deckTop = 0.05f;
            var deckGo = Box("铸坊白盒桥", new Vector3(at.x, g + deckTop - 0.2f, at.z), new Vector3(12f, 0.4f, 8f));
            foreach (var (name, origin, vel, time) in new[]
                     {
                         ("走上白盒桥走到头", new Vector3(at.x - 7.5f, 0, at.z), new Vector3(Walk, 0, 0), 2.6f),
                         ("从白盒桥侧面走下来", new Vector3(at.x, 0, at.z + 2.5f), new Vector3(0, 0, Walk), 1.0f),
                         ("冲刺横穿白盒桥", new Vector3(at.x - 7.5f, 0, at.z - 1f), new Vector3(22f, 0, 0), 0.8f),
                     })
            {
                StandOnGround(origin, Mathf.Atan2(vel.x, vel.z) * Mathf.Rad2Deg);
                yield return null;
                yield return null;
                r0 = motor.GroundRescues;
                float minOnDeck = float.PositiveInfinity;
                var b = deckGo.GetComponent<Collider>().bounds;
                yield return Drive(vel, time, name, () =>
                {
                    var p = motor.transform.position;
                    if (p.x > b.min.x + 0.4f && p.x < b.max.x - 0.4f && p.z > b.min.z + 0.4f && p.z < b.max.z - 0.4f)
                        minOnDeck = Mathf.Min(minOnDeck, p.y - b.max.y);
                    return false;
                });
                ExpectNoRescue(name, r0, bad);
                if (minOnDeck < -0.1f) bad.Add($"{name}：在桥上时脚底一度低于桥面 {-minOnDeck:F2} m");
                Line($"  {name}：桥上最低离桥面 {(float.IsFinite(minOnDeck) ? minOnDeck : 0):F2} m，托回 {motor.GroundRescues - r0} 次");
            }
            Cleanup();
            yield return null;
            Report("台阶 / 坡 / 薄桥 / 白盒桥", bad);
        }

        // ───────────── 不误救：大位移擦过悬空楼板 ─────────────

        IEnumerator Overhang()
        {
            sinkLogs = 0;
            var bad = new List<string>();
            var at = spot - away * 6f;
            float g = GroundY(at);
            // 悬空楼板：顶面 3 m、厚 0.3 m，占 x ∈ [at.x, at.x + 6]
            const float slabTop = 3f;
            Box("悬空楼板", new Vector3(at.x + 3f, g + slabTop - 0.15f, at.z), new Vector3(6f, 0.3f, 6f));
            foreach (var (name, startY, v) in new[]
                     {
                         ("横飞下坠擦过楼板边", slabTop + 0.3f, new Vector3(30f, -42f, 0)),
                         ("从楼板下沿高度横飞钻到楼板底下", slabTop - 2.4f, new Vector3(30f, -6f, 0)),
                         ("击飞从楼板旁边往上飞", 0.02f, new Vector3(20f, 14f, 0)),
                     })
            {
                Stand(new Vector3(at.x - 0.8f, g + startY, at.z), 90);
                motor.Launch(v);
                int r0 = motor.GroundRescues;
                float t0 = Time.time;
                while (Time.time - t0 < 1.2f)
                {
                    Measure(name);
                    yield return null;
                }
                ExpectNoRescue(name, r0, bad);
                Line($"  {name}：停在 {motor.transform.position.y - g:F2} m（楼板顶 {slabTop} m），托回 {motor.GroundRescues - r0} 次");
            }
            Cleanup();
            yield return null;
            Report("大位移擦过悬空楼板", bad);
        }

        void Report(string what, List<string> bad)
        {
            Line($"{what}：{(bad.Count == 0 ? "都没误救、没陷进去 ✓" : string.Join("；", bad))}");
            foreach (var b in bad) Fail(b);
        }

        // ───────────── 冰甲旋龟复现 ─────────────

        IEnumerator XuanGuiSpin()
        {
            sinkLogs = 0;
            if (!ArenaSpawner.IsRegistered("xuangui"))
            {
                Line("冰甲旋龟：名册里没有，跳过");
                yield break;
            }
            int runs = 0, hits = 0, overheats = 0, r0 = motor.GroundRescues;
            float sink0 = worstSink, deepest = 0;
            for (int round = 0; round < 3; round++)
            {
                arena.Clear();
                AttackTokens.Reset();
                PackCoordinator.Reset();
                yield return new WaitForSeconds(0.3f);
                var ai = arena.Spawn("xuangui", round == 2, Vector3.zero) as XuanGuiAI;
                if (!ai)
                {
                    Fail("冰甲旋龟生成失败");
                    yield break;
                }
                runs++;
                var fwd = ai.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : away;
                StandOnGround(ai.transform.position + fwd * 14f, Quaternion.LookRotation(-fwd).eulerAngles.y);
                float t0 = Time.time;
                bool struck = false, sawOverheat = false;
                int rr = motor.GroundRescues;
                while (Time.time - t0 < 16f)
                {
                    if (!ai || ai.Dead) break;
                    if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(999999);
                    if (ai.Spinning && ai.Struck && !struck)
                    {
                        struck = true;
                        hits++;
                    }
                    if (ai.State == "overheat") sawOverheat = true;
                    if (motor.GroundRescues > rr)
                    {
                        rr = motor.GroundRescues;
                        deepest = Mathf.Max(deepest, motor.LastRescueDepth);
                        if (sinkLogs < 4)
                        {
                            sinkLogs++;
                            var d = motor.transform.position - ai.transform.position;
                            Line($"  旋龟第 {round + 1} 轮 托回：本来要陷 {motor.LastRescueDepth:F2} m，旋龟 {ai.State}，水平距离 {new Vector2(d.x, d.z).magnitude:F1} m、高差 {d.y:F2} m，压着 {Overlaps()}");
                        }
                    }
                    Measure($"旋龟第 {round + 1} 轮", $"旋龟 {ai.State}，距离 {Vector3.Distance(ai.transform.position, motor.transform.position):F1} m");
                    if (sawOverheat && ai.State == "advance") break;
                    yield return null;
                }
                if (sawOverheat) overheats++;
            }
            arena.Clear();
            int rescues = motor.GroundRescues - r0;
            Line($"冰甲旋龟 {runs} 轮：旋壳撞中 {hits} 次，过热翻倒 {overheats} 次；防穿地托回 {rescues} 次（最深本来要陷 {deepest:F2} m），期间最深陷地 {(worstSink > sink0 ? worstSink : 0):F2} m");
            if (hits == 0) Line("  （这几轮旋壳都没撞中玩家，复现不充分）");
        }
    }
}
