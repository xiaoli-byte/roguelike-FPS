using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 1-4 沙壁爬不上去（bridge.sh playtest dune-wall；场景 1-4 鸣沙山月牙泉，docs/level-design/maps/1-4.md 第 4 节）：
    /// 环形沙山离盆底边缘 28 ± 3 m 起是 50–52° 的沙壁，比角色的坡度上限（45°）陡；陡坡上不算站稳（MotorCore：碰到地面但超过坡度上限 = 滑落，不重置土狼时间和空中跳次数），
    /// 所以连跳也爬不上去。这里用虚拟手柄（真输入：GameInput → PlayerMotor → MotorCore，和玩家按键走同一条路）在一圈壁脚上逐处硬爬：
    ///   · 推着摇杆往壁上走；
    ///   · 边走边连跳（每 0.14 s 按一次跳）；
    ///   · 跳起冲刺（每 0.6 s 一轮）；
    ///   · 开一次空中再跳（「额外跳跃」秘卷 / 鼯）：跳 → 二段跳 → 冲刺（每 0.8 s 一轮）。
    /// 壁脚：从盆底中心 (10, 2) 每 20° 一条径向线往外找（驼道、观景台一带的路堑边坡跳过），地面坡度连续 1.5 m 超过 47° 的地方；人站在壁脚往回 3.5 m 的折角上，面朝外。
    /// 另加观景台背后（往北顶沙壁）和驼道上坡一侧两处（人站在台面 / 路面上，壁脚从那里往外找）。软边界（风沙推回会把人推下来，测的就不是地形）和首领关流程先关掉，测完恢复。
    /// 不合格：在比壁脚高 <see cref="StandAllowance"/> 米以上的地方站稳过、或松手 1.5 s 后停在那么高（壁上有能歇脚的地方 = 能一段段跳上去）；
    /// 或者脚底比站稳过的最高处又高出 <see cref="Allowance"/> 米以上（超过一轮跳够得着的高度 = 在往上爬）。
    /// </summary>
    public sealed class DuneWallSuite : PlaytestSuite
    {
        public override string Id => "dune-wall";
        /// <summary>1-4 鸣沙山月牙泉（与编辑器里 Level_1_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";

        /// <summary>盆底椭圆中心（Level_1_4.FloorCenter）</summary>
        static readonly Vector2 FloorCenter = new(10, 2);
        /// <summary>
        /// 一轮跳够得着的高度（米，相对站稳过的最高处）：离开 45° 以内的地面后还有 0.1 s 土狼时间，顶着 45–47° 的折角往上走一步再起跳（约 0.8 m），
        /// 跳 1.42 + 二段跳 1.26 m，再加冲刺顶进沙壁时角色控制器沿面把人推上去一段（一次冲刺 2 m 上下；冲刺 1.6 s 才回一格，推完就滑下来）——实测最多 5.5 m。
        /// 壁高（壁脚到脊）至少 12 m、壁上没有能站的地方（L5 白盒自查壁面最缓 48°），一轮够不着任何新的落脚点。
        /// 爬得上去的话会一轮比一轮高（修好 MotorCore 之前跳冲刺能冲上 10–20 m），超过这个数就不合格
        /// </summary>
        const float Allowance = 7f;
        /// <summary>站稳过 / 松手后停下的地方最多比壁脚高多少（米）：径向线上量的壁脚和人实际贴着的那一处差一点</summary>
        const float StandAllowance = 1.5f;
        const float WallSlope = 47f;

        PlayerMotor motor;
        Gamepad pad;
        int jumps, airJumps, dashes;
        /// <summary>全部尝试里「最高 − 站过的最高处」的最大值</summary>
        float worstLift = float.NegativeInfinity;
        readonly List<string> bad = new();

        protected override IEnumerator Steps()
        {
            float r0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - r0 < 90f)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSeconds(0.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            if (!motor || !vitals)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals}（场景不是 1-4？先 bridge.sh level 1-4）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.stats.Add("playtest_dunewall", Stat.MaxHp, 50000);
            vitals.Heal(999999);

            // 关掉软边界（推回 + 兜底环）和首领关流程：只看地形本身挡不挡得住
            var boundary = FindAnyObjectByType<BoundaryZone>();
            var boundaryRoot = boundary ? boundary.gameObject : null;
            if (boundaryRoot) boundaryRoot.SetActive(false);
            var enc = FindAnyObjectByType<BossEncounter>();
            if (enc) enc.enabled = false;
            int airJumps0 = motor.airJumps;
            motor.Jumped += OnJumped;
            motor.Dashed += OnDashed;
            pad = InputSystem.AddDevice<Gamepad>("DuneWall Test Pad");
            try
            {
                Line($"壁脚判定：地面坡度连续 1.5 m > {WallSlope}°；不合格线：比壁脚高 {StandAllowance} m 以上站稳过 / 停下，或比站稳过的最高处又高出 {Allowance} m（一轮跳够得着的高度）");
                for (int deg = 0; deg < 360; deg += 20)
                {
                    var dir = new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad));
                    if (!FindFoot(FloorCenter, dir, 35f, true, out float wallR, out float wallY))
                    {
                        Line($"· 方位 {deg}°：径向线上没找到沙壁（> {WallSlope}°；观景台、驼道一带由下面单独几处测）");
                        continue;
                    }
                    yield return Spot($"方位 {deg}°（壁脚离盆底中心 {wallR:F0} m）", Ground(FloorCenter + dir * (wallR - 3.5f)), Yaw(dir), wallY);
                }
                // 观景台背后（台面北沿往北顶沙壁）、驼道上坡一侧（顺径向往外顶）：人站在台面 / 路面上，壁脚从这里往外找
                foreach (var (name, at, dir) in new[]
                         {
                             ("观景台背后", new Vector2(24, 86.5f), Vector2.up),
                             ("驼道 (2, 78) 上坡一侧", new Vector2(2, 78), (new Vector2(2, 78) - FloorCenter).normalized),
                             ("驼道 (-12, 68) 上坡一侧", new Vector2(-12, 68), (new Vector2(-12, 68) - FloorCenter).normalized),
                         })
                {
                    if (!FindFoot(at, dir, 0.5f, false, out float wallR, out float wallY))
                    {
                        Fail($"{name}：往外没找到沙壁（> {WallSlope}°）");
                        continue;
                    }
                    yield return Spot($"{name}（壁脚在 {wallR:F1} m 外）", Ground(at), Yaw(dir), wallY);
                }
            }
            finally
            {
                if (pad != null) InputSystem.RemoveDevice(pad);
                pad = null;
                motor.Jumped -= OnJumped;
                motor.Dashed -= OnDashed;
                motor.airJumps = airJumps0;
                if (boundaryRoot) boundaryRoot.SetActive(true);
                if (enc) enc.enabled = true;
                vitals.stats.Remove("playtest_dunewall");
            }
            Line($"合计：起跳 {jumps} 次、空中再跳 {airJumps} 次、冲刺 {dashes} 次；离开站稳处最多往上 {worstLift:F1} m（一轮跳上限 {Allowance} m）");
            if (jumps == 0) Fail("虚拟手柄的跳没进到 PlayerMotor（一次起跳都没有）：输入没接上，测试不算数");
            foreach (var b in bad) Fail(b);
            if (bad.Count == 0 && jumps > 0) Line("✓ 走、连跳、跳冲刺、二段跳冲刺都爬不上沙壁");
        }

        void OnJumped(bool air)
        {
            if (air) airJumps++;
            else jumps++;
        }

        void OnDashed() => dashes++;

        static float Yaw(Vector2 dir) => Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;

        static Vector3 Ground(Vector2 p) =>
            Physics.Raycast(new Vector3(p.x, 150f, p.y), Vector3.down, out var hit, 300f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point
                : new Vector3(p.x, 0, p.y);

        /// <summary>驼道折线、观景台（Level_1_4.TrailPath / Platform）：这一带的陡坎是路切进壁面的边坡，壁脚往外再找</summary>
        static readonly Vector2[] Trail = { new(14.5f, 81), new(2, 78), new(-12, 68), new(-20, 56), new(-21, 45) };
        static readonly Vector2 Platform = new(24, 78);

        static bool NearPaths(Vector2 p)
        {
            if (Vector2.Distance(p, Platform) < 14f) return true;
            for (int i = 0; i + 1 < Trail.Length; i++)
            {
                var a = Trail[i];
                var ab = Trail[i + 1] - a;
                float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / ab.sqrMagnitude);
                if (Vector2.Distance(p, a + ab * t) < 9f) return true;
            }
            return false;
        }

        /// <summary>从 origin 沿 dir 往外（rFrom 米起）找壁脚：坡度连续 1.5 m 超过 WallSlope 的第一处（skipPaths：驼道、观景台一带的路堑边坡不算）</summary>
        static bool FindFoot(Vector2 origin, Vector2 dir, float rFrom, bool skipPaths, out float wallR, out float wallY)
        {
            wallY = wallR = 0;
            int run = 0;
            for (float r = rFrom; r < 170f; r += 0.5f)
            {
                var p = origin + dir * r;
                if (!Physics.Raycast(new Vector3(p.x, 150f, p.y), Vector3.down, out var hit, 300f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (Vector3.Angle(hit.normal, Vector3.up) <= WallSlope || (skipPaths && NearPaths(p)))
                {
                    run = 0;
                    continue;
                }
                if (++run < 4) continue;
                wallR = r - 1.5f;
                wallY = Ground(origin + dir * wallR).y;
                return true;
            }
            return false;
        }

        /// <summary>
        /// 一处：四种爬法各试一遍。每帧记脚底最高到哪（top）、站在可走地面上（OnWalkableGround）时最高到哪（stand）、松手 1.5 s 后停在哪（end）
        /// </summary>
        IEnumerator Spot(string label, Vector3 start, float yaw, float wallY)
        {
            var parts = new List<string>();
            bool ok = true;
            foreach (var (name, seconds, plan) in new (string, float, int)[] { ("走", 2.5f, 0), ("连跳", 4f, 1), ("跳冲刺", 4f, 2), ("二段跳冲刺", 4f, 3) })
            {
                motor.airJumps = plan == 3 ? 1 : 0;
                motor.Teleport(start + Vector3.up * 0.05f, yaw);
                Press(Vector2.zero);
                yield return null;
                yield return null;
                float top = float.NegativeInfinity, stand = start.y, t0 = Time.time, cycle = plan switch { 1 => 0.14f, 2 => 0.6f, 3 => 0.8f, _ => 1f };
                void Track()
                {
                    float y = motor.transform.position.y;
                    top = Mathf.Max(top, y);
                    if (motor.OnWalkableGround) stand = Mathf.Max(stand, y);
                }
                while (Time.time - t0 < seconds)
                {
                    float t = (Time.time - t0) % cycle;
                    bool south = false, east = false;
                    if (plan == 1) south = t < cycle * 0.5f;
                    else if (plan == 2) { south = t < 0.08f; east = t > 0.2f && t < 0.28f; }
                    else if (plan == 3) { south = t < 0.08f || (t > 0.34f && t < 0.42f); east = t > 0.48f && t < 0.56f; }
                    Press(Vector2.up, south, east);
                    Track();
                    yield return null;
                }
                // 松手 1.5 s：陡坡上站不住，应滑回壁脚
                Press(Vector2.zero);
                float s0 = Time.time;
                while (Time.time - s0 < 1.5f)
                {
                    Track();
                    yield return null;
                }
                float end = motor.transform.position.y;
                worstLift = Mathf.Max(worstLift, top - stand);
                parts.Add($"{name} 站过 {stand - wallY:+0.0;-0.0} m、最高 {top - wallY:+0.0;-0.0} m、停在 {end - wallY:+0.0;-0.0} m");
                var at = At(motor.transform.position);
                if (stand - wallY > StandAllowance)
                {
                    ok = false;
                    bad.Add($"{label}：{name}时在比壁脚高 {stand - wallY:F1} m 的地方站稳过（> {StandAllowance} m：壁上有能歇脚的地方）@ {at}");
                }
                if (end - wallY > StandAllowance)
                {
                    ok = false;
                    bad.Add($"{label}：{name}之后停在比壁脚高 {end - wallY:F1} m 的地方（没滑下来）@ {at}");
                }
                if (top - stand > Allowance)
                {
                    ok = false;
                    bad.Add($"{label}：{name}比站过的最高处又高出 {top - stand:F1} m（> {Allowance} m：一轮跳之外还在往上爬）@ {at}");
                }
            }
            Line($"{(ok ? "✓" : "✗")} {label}，起点 {At(start)}、壁脚高 {wallY:F1} m：{string.Join("；", parts)}");
        }

        void Press(Vector2 stick, bool south = false, bool east = false)
        {
            if (pad == null) return;
            var s = new GamepadState { leftStick = stick };
            if (south) s = s.WithButton(GamepadButton.South);
            if (east) s = s.WithButton(GamepadButton.East);
            InputSystem.QueueStateEvent(pad, s);
        }

        static string At(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";
    }
}
