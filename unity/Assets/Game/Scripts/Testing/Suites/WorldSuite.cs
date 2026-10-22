using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 世界系统冒烟（bridge.sh playtest world；场景 1-1 古道穿越戈壁，也能带 TestArena 跑；docs/unity-parity.md L3 / L8）：
    ///   · 软边界：场景里没有空气墙（Ignore Raycast 层上的实体碰撞体只在兜底环上，离等值线 ≥ failsafe − 3 m）；
    ///     把玩家放到起风线外 7 m（风力一半），不给输入：被推回到起风线以内，推回速度 ≈ (4 + 18 × 风力) m/s，期间有白化；
    ///     放到兜底环外：托回安全点；
    ///   · 拴绳：一只跳鼠被放到拴绳线外 6 m 的一块临时导航岛上（模拟界外的网格碎片 / 被击飞出界）：tetherGrace 秒后被拴回界内的主网格上；
    ///   · 天气：④ 的沙暴强制进入风暴期，玩家站在营地中心——远程锁定上限 ≤ 25 m、雾终点 ≤ 40 m、全局风力 ≥ 0.8、远幕盖上；
    ///     回到出生点：锁定不限、雾回到基础值；预警期从营地西北能看到天边的沙墙（截图）。
    ///   · 冰面：出生点附近找一条平的 4 × 24 m 走廊铺冰，同一处用 9.9 m/s（冲刺余速）抛出去、不给输入：冰上滑的距离 ≥ 平地的 4 倍且 ≥ 5 m；
    ///     站在冰上时运动帧的地面牵引 ≈ 冰面预设；冰上的跳鼠加速度降到 ×0.2，冰撤掉后恢复；
    ///   · 流沙：放在离圆心 4.5 m 处、不给输入：被拖向圆心、走路变慢、芯里锁跳，下沉度涨满后被吞并托回安全点；冰上 / 流沙里的跳鼠吃到减速；
    ///   · 水：0.8 m 深的水里走路速度 ≈ 涉水倍率；2 m 深的水里托回；水里的跳鼠吃到减速。测试场还要查冰 / 水条带挂上了组件。
    /// 玩家全程无敌；结束时把玩家送回出生点、风暴回到未计时，测试放的冰 / 流沙 / 水都撤掉。
    /// </summary>
    public sealed class WorldSuite : PlaytestSuite
    {
        public override string Id => "world";
        /// <summary>1-1 古道穿越戈壁（与编辑器里 Level_1_1.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        PlayerMotor motor;
        PlayerVitals vitals;
        Camera eye;
        Vector3 home;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindFirstObjectByType<PlayerMotor>();
            vitals = FindFirstObjectByType<PlayerVitals>();
            var weapons = FindFirstObjectByType<WeaponController>();
            if (!motor || !vitals)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals}");
                yield break;
            }
            eye = weapons && weapons.eye ? weapons.eye : Camera.main;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 9999;
            home = motor.transform.position;
            try
            {
                if (BoundaryZone.Active)
                {
                    yield return NoAirWall();
                    yield return PushBack();
                    yield return Failsafe();
                    yield return TetherCase();
                }
                else Line("场景里没有软边界（BoundaryZone）：跳过边界检查（TestArena 的围堤是地形边界）");
                if (WeatherDirector.Instance && WeatherDirector.Instance.regions.Length > 0) yield return Sandstorm();
                else Line("场景里没有区域风暴：跳过沙暴检查");
                motor.Teleport(home + Vector3.up * 0.05f);
                yield return new WaitForSeconds(0.3f);
                ArenaStrips();
                yield return IceCase();
                yield return QuicksandCase();
                yield return WaterCase();
            }
            finally
            {
                var d = WeatherDirector.Instance;
                if (d)
                    foreach (var r in d.regions)
                        r?.Force(StormPhase.Idle);
                foreach (var go in temp)
                    if (go)
                        Destroy(go);
                temp.Clear();
                EnemyRegistry.PurgeAll();
                if (motor) motor.Teleport(home + Vector3.up * 0.05f);
            }
        }

        // ───────────── 软边界 ─────────────

        /// <summary>没有空气墙：Ignore Raycast 层上的实体碰撞体（兜底环）离等值线都在 failsafe − 3 m 以外</summary>
        IEnumerator NoAirWall()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            Line($"── 软边界 ──（起风 +{t.softStart} m、风力 {t.windRamp} m 涨满、推回 {t.pushBase} + {t.pushGain} × 风力、兜底 +{t.failsafe} m、走路顶到 +{t.HoldDepth(7.5f):F1} m）");
            int walls = 0;
            float nearest = float.PositiveInfinity;
            string nearestName = null;
            foreach (var c in FindObjectsByType<Collider>())
            {
                if (!c.enabled || c.isTrigger || c.gameObject.layer != Layers.IgnoreRaycast) continue;
                if (c.GetComponentInParent<EnemyAI>()) continue; // 布娃娃
                walls++;
                float d = MinDistance(c);
                if (d < nearest)
                {
                    nearest = d;
                    nearestName = c.name;
                }
            }
            if (walls == 0) Fail("Ignore Raycast 层上没有兜底环（构建器应在 +failsafe 处立一圈）");
            else if (nearest < t.failsafe - 3f) Fail($"还有空气墙：{nearestName} 离等值线只有 {nearest:F1} m（兜底环应在 +{t.failsafe} m）");
            else Line($"✓ 没有空气墙：Ignore Raycast 层实体碰撞体 {walls} 个，最近的离等值线 {nearest:F1} m（{nearestName}）");
            yield return null;
        }

        static float MinDistance(Collider c)
        {
            float best = float.PositiveInfinity;
            if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
            {
                var verts = mc.sharedMesh.vertices;
                for (int i = 0; i < verts.Length; i += 2) best = Mathf.Min(best, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                return best;
            }
            var b = c.bounds;
            foreach (var p in new[] { b.center, new Vector3(b.min.x, 0, b.min.z), new Vector3(b.max.x, 0, b.min.z), new Vector3(b.min.x, 0, b.max.z), new Vector3(b.max.x, 0, b.max.z) })
                best = Mathf.Min(best, BoundaryZone.Distance(p));
            return best;
        }

        /// <summary>出生点附近沿梯度走到离等值线 d 米的地面点</summary>
        static Vector3 PointAt(Vector3 from, float d)
        {
            var f = BoundaryZone.Active.Field;
            var q = f.MoveToDistance(from.x, from.z, d, 10);
            return Ground(new Vector3(q.x, from.y, q.y));
        }

        /// <summary>地形表面（不落在道具顶上）；没有地形时向下打射线</summary>
        static Vector3 Ground(Vector3 p)
        {
            var t = Terrain.activeTerrain;
            if (t) p.y = t.SampleHeight(p) + t.transform.position.y;
            else if (Physics.Raycast(p + Vector3.up * 80, Vector3.down, out var hit, 200, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
            return p;
        }

        IEnumerator PushBack()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            float target = t.softStart + t.windRamp * 0.5f;
            var at = PointAt(home, target);
            var outward = zone.Field.Outward(at.x, at.z);
            motor.Teleport(at + Vector3.up * 0.05f, Mathf.Atan2(outward.x, outward.y) * Mathf.Rad2Deg);
            yield return null;
            float d0 = BoundaryZone.PlayerDistance, w0 = BoundaryZone.PlayerWind;
            var p0 = motor.transform.position;
            float t0 = Time.time;
            yield return new WaitForSeconds(0.25f);
            float speed = Flat(motor.transform.position - p0) / Mathf.Max(0.01f, Time.time - t0);
            float expect = t.Push(w0);
            Line($"放到 +{d0:F1} m（风力 {w0:F2}）：前 0.25 s 被推 {speed:F1} m/s（应约 {expect:F1}，风力随距离下降会略慢）");
            if (w0 < 0.25f) Fail($"放到 +{d0:F1} m 风力只有 {w0:F2}（应约 0.5）");
            if (speed < expect * 0.5f || speed > t.pushBase + t.pushGain + 1) Fail($"推回速度 {speed:F1} m/s 不对（应约 {expect:F1}）");
            yield return new WaitForSeconds(0.3f);
            float white = BoundaryZone.PlayerWhiteout, veil = WeatherDirector.Instance ? WeatherDirector.Instance.WhiteoutWeight : -1;
            Shot(eye, "world_whiteout");
            yield return new WaitForSeconds(1.2f);
            float d1 = BoundaryZone.PlayerDistance;
            Line($"白化 {white:F2}（天气导演 {veil:F2}）；1.75 s 后离等值线 {d1:+0.0;-0.0} m，风力 {BoundaryZone.PlayerWind:F2}");
            if (white < 0.3f) Fail($"起风线外 {d0:F1} m 白化只有 {white:F2}");
            if (d1 > t.softStart + 0.8f) Fail($"没被推回：1.75 s 后还在 +{d1:F1} m（起风线 +{t.softStart} m）");
            else Line("✓ 被风沙推回起风线以内，没有撞墙");
            if (vitals.Dead) Fail("被推回时死了");
        }

        IEnumerator Failsafe()
        {
            var zone = BoundaryZone.Active;
            int before = BoundaryZone.FailsafeRecoveries;
            var at = PointAt(home, zone.tuning.failsafe + 6f);
            motor.Teleport(at + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.4f);
            float d = BoundaryZone.Distance(motor.transform.position);
            if (BoundaryZone.FailsafeRecoveries <= before) Fail($"放到兜底环外 +{zone.tuning.failsafe + 6:F0} m 没被托回（现在 {d:+0.0;-0.0} m）");
            else if (d > zone.tuning.softStart + 0.5f) Fail($"兜底托回后还在起风线外 {d:F1} m（安全点不该记在风里）");
            else Line($"✓ 越过兜底环：托回安全点（离等值线 {d:F1} m）");
            motor.Teleport(home + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.6f);
        }

        /// <summary>
        /// 敌人站在拴绳线外的导航网格上（旧关卡 4 m 导航体块的网格伸到界外 +5.9 m、被冲撞 / 击飞后落在界外的网格碎片上），
        /// tetherGrace 秒后要被拴回界内的主网格。
        /// 现在的关卡网格只到界外 +2.5 m（拴绳线 navInset + tetherSlack 以内）：直接把 agent 关掉挪到 +10 m 再开，Unity 会把它就近吸回 +2.5 m 的网格边，
        /// 拴绳根本用不上、测不到。所以在 +10 m 处临时铺一块独立的导航岛（运行时 NavMeshBuilder，只有这一块平板）：agent Warp 上去之后
        /// 启用、updatePosition 开着、在网格上、离等值线 +10 m——正是拴绳要管的情形。拴绳坏了它就一直站在岛上，测试失败。
        /// AI 关着（不让它自己走 / 自己做离网恢复），只看 BoundaryZone 的拴绳
        /// </summary>
        IEnumerator TetherCase()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            var inside = PointAt(home, -6f);
            var ai = EnemyRoster.Spawn("jerboa_blade", inside, Quaternion.identity, 1, false);
            if (!ai)
            {
                Fail("刷不出跳鼠刀客（拴绳检查）");
                yield break;
            }
            ai.Health.maxHealth *= 50;
            ai.Health.ResetVitals();
            yield return new WaitForSeconds(1f);
            var agent = ai.GetComponent<NavMeshAgent>();
            float line = t.navInset + t.tetherSlack;
            var outside = PointAt(home, line + 6f);
            var island = NavIsland(agent.agentTypeID, outside, 8f);
            try
            {
                ai.enabled = false;
                if (agent.isOnNavMesh) agent.isStopped = true;
                bool warped = agent.Warp(outside);
                yield return null;
                float d0 = BoundaryZone.Distance(ai.transform.position);
                if (!warped || !agent.isOnNavMesh || !t.TetherOut(d0))
                {
                    Fail($"拴绳检查没摆好：Warp 到界外导航岛 {warped}、在网格上 {agent.isOnNavMesh}、离等值线 {d0:+0.0;-0.0} m（拴绳线 +{line:F1} m）");
                    yield break;
                }
                int before = BoundaryZone.Tethered;
                int ticks0 = BoundaryZone.TetherTicks, marked0 = BoundaryZone.TetherMarkedOut;
                float waited = 0;
                while (BoundaryZone.Tethered == before && waited < t.tetherGrace + 1.5f)
                {
                    waited += Time.deltaTime;
                    yield return null;
                }
                float d1 = BoundaryZone.Distance(ai.transform.position);
                if (BoundaryZone.Tethered == before)
                    Fail($"跳鼠站在界外 +{d0:F1} m 的导航岛上（拴绳线 +{line:F1} m）、{waited:F1} s 没被拴回，现在在 {d1:+0.0;-0.0} m" +
                         $"（agent 启用 {agent.enabled}、在网格上 {agent.isOnNavMesh}、updatePosition {agent.updatePosition}）；" +
                         $"拴绳检查 {BoundaryZone.TetherTicks - ticks0} 轮、判出界 {BoundaryZone.TetherMarkedOut - marked0} 次；" +
                         $"最近看到：{BoundaryZone.LastTetherSeen ?? "无"}；最近失败：{BoundaryZone.LastTetherFailure ?? "无（拴绳没被调用）"}");
                else if (d1 > t.navInset + 0.5f || !agent.isOnNavMesh) Fail($"拴回后在 {d1:+0.0;-0.0} m、在网格上 {agent.isOnNavMesh}（应在 +{t.navInset:F1} m 以内的网格上）");
                else if (waited < t.tetherGrace - 0.3f) Fail($"拴得太早：{waited:F1} s（宽限 {t.tetherGrace:F1} s）");
                else Line($"✓ 拴绳：跳鼠站在界外 +{d0:F1} m 的导航岛上（拴绳线 +{line:F1} m），{waited:F1} s 后拴回 {d1:+0.0;-0.0} m 的网格上");
            }
            finally
            {
                island.Remove();
                if (ai) ai.enabled = true;
            }
            yield return new WaitForSeconds(0.3f);
            EnemyRegistry.PurgeAll();
        }

        /// <summary>在 at 处临时铺一块 size × size 的平板导航网格（独立的一块，不连主网格）；用完 Remove</summary>
        static NavMeshDataInstance NavIsland(int agentTypeId, Vector3 at, float size)
        {
            var settings = NavMesh.GetSettingsByID(agentTypeId);
            var src = new NavMeshBuildSource
            {
                shape = NavMeshBuildSourceShape.Box,
                size = new Vector3(size, 0.2f, size),
                transform = Matrix4x4.TRS(at - Vector3.up * 0.1f, Quaternion.identity, Vector3.one),
                area = 0,
            };
            var bounds = new Bounds(at, new Vector3(size + 4f, 8f, size + 4f));
            var data = NavMeshBuilder.BuildNavMeshData(settings, new List<NavMeshBuildSource> { src }, bounds, Vector3.zero, Quaternion.identity);
            return NavMesh.AddNavMeshData(data);
        }

        // ───────────── 天气 ─────────────

        IEnumerator Sandstorm()
        {
            var dir = WeatherDirector.Instance;
            var r = dir.regions[0];
            var prof = WeatherProfiles.Get(r.profile);
            Line($"── 天气 ──（区域「{r.name}」{r.profile}：半径 {r.radius} m，能见度 {prof?.visibility} m；基础雾 {dir.baseFogStart:F0}–{dir.baseFogEnd:F0} m）");
            var center = Ground(r.center);

            // 风暴期：营地中心
            r.Force(StormPhase.Storm, 3f);
            motor.Teleport(center + Vector3.up * 0.05f, Mathf.Atan2(r.from.x, r.from.y) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(1f);
            float storm = WeatherDirector.StormAt(motor.transform.position);
            float lockR = WeatherDirector.LockOnRange(center);
            var wind = Shader.GetGlobalVector("_WindDir");
            float fogEnd = RenderSettings.fogEndDistance;
            bool near = WeatherDirector.CanLockOn(center, center + Vector3.right * 20f), far = WeatherDirector.CanLockOn(center, center + Vector3.right * 30f);
            Line($"风暴中：强度 {storm:F2}，锁定上限 {lockR:F1} m（20 m {(near ? "能" : "不能")}锁、30 m {(far ? "能" : "不能")}锁），雾 {RenderSettings.fogStartDistance:F0}–{fogEnd:F0} m，" +
                 $"风 ({wind.x:F2}, {wind.y:F2}) × {wind.z:F2}，远幕 {dir.Current.dome:F2}");
            Shot(eye, "world_sandstorm");
            if (storm < 0.9f) Fail($"营地中心风暴强度 {storm:F2}（应 ≥ 0.9）");
            if (prof != null && lockR > prof.visibility + 0.5f) Fail($"沙暴里锁定上限 {lockR:F1} m（应 ≤ {prof.visibility} m）");
            if (!near || far) Fail($"CanLockOn 不对：20 m {near}、30 m {far}");
            if (fogEnd > 40f) Fail($"沙暴里雾终点 {fogEnd:F0} m（应 ≤ 40）");
            if (wind.z < 0.8f) Fail($"沙暴里全局风力 {wind.z:F2}（应 ≥ 0.8）");
            if (dir.Current.dome < 0.9f) Fail($"沙暴里远幕 {dir.Current.dome:F2}（应盖满）");

            // 出生点：晴
            motor.Teleport(home + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.5f);
            float clearLock = WeatherDirector.LockOnRange(home);
            float clearFog = RenderSettings.fogEndDistance;
            Line($"出生点：锁定上限 {(float.IsPositiveInfinity(clearLock) ? "不限" : clearLock.ToString("F0") + " m")}，雾终点 {clearFog:F0} m");
            if (!float.IsPositiveInfinity(clearLock)) Fail($"出生点在沙暴外，锁定上限却是 {clearLock:F0} m");
            if (clearFog < dir.baseFogEnd * 0.9f) Fail($"出生点雾终点 {clearFog:F0} m，没回到基础值 {dir.baseFogEnd:F0} m");

            // 预警期：沙墙在营地上风处立起来；从营地西北 60 m 朝营地看
            r.Force(StormPhase.Warning, r.warn * 0.85f);
            var look = Ground(center + new Vector3(-45f, 0, 40f));
            var to = center - look;
            motor.Teleport(look + Vector3.up * 0.05f, Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(0.6f);
            var walls = dir.GetComponentsInChildren<MeshRenderer>().Where(m => m.name.StartsWith("Sand Wall")).ToList();
            bool wallUp = walls.Any(m => m.gameObject.activeInHierarchy);
            Line($"预警：沙墙 {(wallUp ? "已升起" : "没有")}，风暴强度 {r.Intensity:F2}");
            Shot(eye, "world_sandwall");
            if (!wallUp) Fail("预警期没有沙墙");
        }

        // ───────────── 地表（L8） ─────────────

        readonly List<GameObject> temp = new();

        /// <summary>测试场：冰 / 水条带挂上了地表组件</summary>
        void ArenaStrips()
        {
            var arena = FindAnyObjectByType<ArenaSpawner>();
            if (!arena) return;
            var ice = arena.iceStrip ? arena.iceStrip.GetComponent<SurfaceZone>() : null;
            var water = arena.waterStrip ? arena.waterStrip.GetComponent<WaterVolume>() : null;
            Line($"测试场条带：冰面 {(ice ? "SurfaceZone ✓" : "没有组件")}，水面 {(water ? $"WaterVolume ✓（水面 y {water.Surface:F2}）" : "没有组件")}");
            if (!ice) Fail("测试场的冰面条带没有 SurfaceZone（重新生成测试场：bridge.sh level arena）");
            if (!water) Fail("测试场的水面条带没有 WaterVolume（重新生成测试场：bridge.sh level arena）");
        }

        /// <summary>
        /// 出生点附近找一块平地：中心离出生点 6–42 m、离等值线 ≥ 10 m、离各场地触发圈够远、不压着前面测试放的东西；
        /// 半尺寸 (hx, hz)，每 22.5° 试一个朝向；地形起伏 ≤ maxRise，上方 0.4–2.2 m 没有墙和道具
        /// </summary>
        bool FlatSpot(float hx, float hz, float maxRise, out Vector3 center, out float yaw)
        {
            var sites = FindObjectsByType<EncounterSite>();
            float reach = Mathf.Max(hx, hz);
            for (float r = 6; r <= 42; r += 3)
            for (int k = 0; k < 24; k++)
            {
                float a = k * Mathf.PI * 2 / 24;
                var c = Ground(home + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r);
                if (BoundaryZone.Distance(c) > -10) continue;
                if (sites.Any(s => s && Flat(s.transform.position - c) < s.triggerRadius + reach + 4)) continue;
                if (temp.Any(g => g && Flat(g.transform.position - c) < reach * 2 + 8)) continue;
                for (float y = 0; y < 180f; y += 22.5f)
                {
                    if (!Level(c, hx, hz, y, maxRise) || Blocked(c, hx, hz, y)) continue;
                    center = c;
                    yaw = y;
                    return true;
                }
            }
            center = default;
            yaw = 0;
            return false;
        }

        static bool Level(Vector3 c, float hx, float hz, float yaw, float maxRise)
        {
            var rot = Quaternion.Euler(0, yaw, 0);
            float lo = float.MaxValue, hi = float.MinValue;
            for (int i = -2; i <= 2; i++)
            for (int j = -4; j <= 4; j++)
            {
                float y = Ground(c + rot * new Vector3(hx * i / 2f, 0, hz * j / 4f)).y;
                lo = Mathf.Min(lo, y);
                hi = Mathf.Max(hi, y);
            }
            return hi - lo <= maxRise;
        }

        static bool Blocked(Vector3 c, float hx, float hz, float yaw)
        {
            var hits = Physics.OverlapBox(c + Vector3.up * 1.3f, new Vector3(hx + 0.5f, 0.9f, hz + 0.5f), Quaternion.Euler(0, yaw, 0), Layers.WorldMask,
                QueryTriggerInteraction.Ignore);
            return hits.Any(h => !(h is TerrainCollider));
        }

        /// <summary>站到 start、面朝 dir 停稳，再以 9.9 m/s（冲刺余速）沿 dir 抛出去、不给输入，量滑到停下的水平距离</summary>
        IEnumerator SlideRun(Vector3 start, Vector3 dir, System.Action<float> result, System.Action each = null)
        {
            motor.Teleport(start + Vector3.up * 0.05f, Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(0.35f);
            var p0 = motor.transform.position;
            motor.Launch(dir * 9.9f);
            float t = 0;
            while (t < 4f)
            {
                yield return null;
                t += Time.deltaTime;
                each?.Invoke();
                if (t > 0.1f && MotorCore.Flat(motor.Velocity).magnitude < 0.05f) break;
            }
            result(Flat(motor.transform.position - p0));
        }

        IEnumerator IceCase()
        {
            Line("── 冰面 ──");
            if (!FlatSpot(2.5f, 12.5f, 0.6f, out var c, out float yaw))
            {
                Fail("出生点附近找不到 5 × 25 m 的平地铺冰");
                yield break;
            }
            var dir = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
            var a = c - dir * 12f;
            var zone = SurfaceZone.SpawnStrip(a, c + dir * 12f, 2f, 0, SurfaceProfile.Ice);
            temp.Add(zone.gameObject);

            // 同一处先撤掉冰量平地，再铺上冰量冰面
            zone.enabled = false;
            float normal = 0;
            var slideFrom = Ground(a + dir * 2f);
            yield return SlideRun(slideFrom, dir, v => normal = v);
            zone.enabled = true;
            float ice = 0, accel = 1, friction = 1;
            bool onIce = false;
            yield return SlideRun(slideFrom, dir, v => ice = v, () =>
            {
                if (!SurfaceZone.PlayerOnSurface) return;
                onIce = true;
                accel = motor.Frame.groundAccelMult;
                friction = motor.Frame.groundFrictionMult;
            });
            Line($"9.9 m/s 抛出、不给输入：平地滑 {normal:F2} m，冰面滑 {ice:F2} m；冰上运动帧的地面牵引 加速 ×{accel:F2}、刹车 ×{friction:F2}");
            if (!onIce) Fail("站在冰面上，SurfaceZone.PlayerOnSurface 一直是 false（牵引修饰器没挂上？）");
            else if (Mathf.Abs(accel - SurfaceProfile.Ice.accel) > 0.02f || Mathf.Abs(friction - SurfaceProfile.Ice.friction) > 0.02f)
                Fail($"冰上的地面牵引 ×{accel:F2} / ×{friction:F2}，应为 ×{SurfaceProfile.Ice.accel} / ×{SurfaceProfile.Ice.friction}");
            if (ice < 5f || ice < normal * 4f) Fail($"冰面滑行 {ice:F2} m 不够（平地 {normal:F2} m；应 ≥ 5 m 且 ≥ 4 倍）");
            else Line("✓ 冰面：冲刺余速滑得远");
            motor.Teleport(Ground(a + dir * 1f) + Vector3.up * 0.05f, Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(0.3f);
            Shot(eye, "world_ice");

            // 冰上的敌人：加速度 ×0.2，冰撤掉后恢复
            var ai = EnemyRoster.Spawn("jerboa_blade", c, Quaternion.LookRotation(-dir), 1, false);
            if (!ai) Fail("刷不出跳鼠刀客（冰面敌人检查）");
            else
            {
                ai.Health.maxHealth *= 50;
                ai.Health.ResetVitals();
                var agent = ai.GetComponent<NavMeshAgent>();
                yield return new WaitForSeconds(0.5f);
                float onIceAccel = agent.acceleration;
                Destroy(zone.gameObject);
                yield return new WaitForSeconds(0.25f);
                float restored = agent.acceleration;
                Line($"冰上的跳鼠：加速度 {onIceAccel:F1}，冰撤掉后 {restored:F1}");
                if (Mathf.Abs(onIceAccel - restored * SurfaceProfile.Ice.enemyAccel) > 0.5f)
                    Fail($"冰上的敌人加速度 {onIceAccel:F1}，应为 {restored:F1} × {SurfaceProfile.Ice.enemyAccel}");
                EnemyRegistry.PurgeAll();
            }
            if (zone) Destroy(zone.gameObject);
        }

        IEnumerator QuicksandCase()
        {
            Line("── 流沙 ──");
            if (!FlatSpot(7.5f, 7.5f, 0.6f, out var c, out _))
            {
                Fail("出生点附近找不到 15 × 15 m 的平地放流沙");
                yield break;
            }
            var q = Quicksand.Create(c, 6f);
            temp.Add(q.gameObject);
            yield return null;
            int swallowed0 = Quicksand.Swallowed;
            var start = Ground(c + Vector3.right * 4.5f);
            motor.Teleport(start + Vector3.up * 0.05f, -90f);
            yield return new WaitForSeconds(0.6f);
            float d1 = Flat(motor.transform.position - c);
            float slow = motor.Frame.speedMult;
            Line($"放在离圆心 4.5 m：0.6 s 后 {d1:F2} m（被拖向圆心），走路速度 ×{slow:F2}，下沉度 {Quicksand.PlayerSink:F2}");
            Shot(eye, "world_quicksand");
            if (d1 > 4.5f - 0.6f) Fail($"流沙没把人往圆心拖：0.6 s 后还在 {d1:F2} m");
            if (slow > 0.85f) Fail($"流沙里走路速度 ×{slow:F2}（应明显变慢）");

            float maxSink = 0, waited = 0;
            bool jumpLocked = false;
            while (Quicksand.Swallowed == swallowed0 && waited < 8f)
            {
                yield return null;
                waited += Time.deltaTime;
                maxSink = Mathf.Max(maxSink, Quicksand.PlayerSink);
                if (motor.Frame.Locked(MotorLock.Jump)) jumpLocked = true;
            }
            Line($"芯里：跳跃{(jumpLocked ? "被锁" : "没锁")}，下沉度最高 {maxSink:F2}，{(Quicksand.Swallowed > swallowed0 ? $"{waited:F1} s 后被吞" : "8 s 没被吞")}");
            if (!jumpLocked) Fail("流沙芯里没锁跳");
            if (Quicksand.Swallowed == swallowed0) Fail("在流沙芯里 8 s 没被吞");
            yield return new WaitForSeconds(1.3f);
            var after = motor.transform.position;
            if (Quicksand.At(after, out _)) Fail($"被吞后没托出流沙（{after}）");
            else Line($"✓ 被吞后托回安全点（离圆心 {Flat(after - c):F1} m）");

            var ai = EnemyRoster.Spawn("jerboa_blade", Ground(c + Vector3.forward * 3f), Quaternion.identity, 1, false);
            if (ai)
            {
                ai.Health.maxHealth *= 50;
                ai.Health.ResetVitals();
                yield return new WaitForSeconds(0.5f);
                float sp = ai.Buffs.Total.speed;
                Line($"流沙里的跳鼠：移速 ×{sp:F2}");
                if (sp > 0.95f) Fail("流沙里的敌人没减速");
                EnemyRegistry.PurgeAll();
            }
            Destroy(q.gameObject);
            yield return null;
        }

        IEnumerator WaterCase()
        {
            Line("── 水 ──");
            if (!FlatSpot(5.5f, 5.5f, 0.4f, out var c, out _))
            {
                Fail("出生点附近找不到 11 × 11 m 的平地放水");
                yield break;
            }
            // 水底压到地面下 0.5 m（地形有起伏），水面在地面上 0.8 m
            var w = WaterVolume.Create(c - Vector3.up * 0.5f, new Vector3(10, 1.3f, 10));
            temp.Add(w.gameObject);
            motor.Teleport(Ground(c + Vector3.back * 3f) + Vector3.up * 0.05f, 0);
            yield return new WaitForSeconds(0.5f);
            float depth = WaterVolume.PlayerDepth, mult = motor.Frame.speedMult, expect = w.SlowAt(depth);
            Line($"0.8 m 深的水：脚下水深 {depth:F2} m，走路速度 ×{mult:F2}（涉水倍率 ×{expect:F2}）");
            Shot(eye, "world_water");
            if (depth < 0.3f || depth > 1.25f) Fail($"水深读数 {depth:F2} m 不对（应约 0.8）");
            if (Mathf.Abs(mult - expect) > 0.03f || mult > 0.9f) Fail($"涉水减速 ×{mult:F2}，应为 ×{expect:F2}");

            var ai = EnemyRoster.Spawn("jerboa_blade", Ground(c + Vector3.right * 2f), Quaternion.identity, 1, false);
            if (ai)
            {
                ai.Health.maxHealth *= 50;
                ai.Health.ResetVitals();
                yield return new WaitForSeconds(0.5f);
                float sp = ai.Buffs.Total.speed;
                Line($"水里的跳鼠：移速 ×{sp:F2}");
                if (sp > 0.95f) Fail("水里的敌人没减速");
                EnemyRegistry.PurgeAll();
            }
            Destroy(w.gameObject);
            yield return null;

            // 深水：没有游泳，托回
            int drowned = WaterVolume.Drowned;
            var deep = WaterVolume.Create(c - Vector3.up * 0.5f, new Vector3(8, 2.5f, 8));
            temp.Add(deep.gameObject);
            motor.Teleport(c + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.4f);
            bool back = !WaterVolume.InWater(motor.transform.position);
            Line($"2 m 深的水：{(WaterVolume.Drowned > drowned ? "托回" : "没托回")}，现在{(back ? "不在水里" : "还在水里")}");
            if (WaterVolume.Drowned == drowned || !back) Fail("掉进深水没托回安全点");
            Destroy(deep.gameObject);
            yield return null;
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
    }
}
