using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 环境氛围特效巡检（特效打磨 D 路；bridge.sh playtest env-fx [关卡]）：不带关卡（默认 1-1）= 按 RunPlan 把 12 关都走一遍，带关卡 = 只拍那一关。
    /// 每关按场景里有什么自动挑主景：瀑布（2-1 冰瀑 / 3-2 熔瀑）&gt; 熔岩 &gt; 水面（1-4 月牙泉、2-3 冰窟窿、2-4 北冥海）&gt; 流沙 &gt; 火盆 / 灯笼 &gt; 出生点望向第一个场地；
    ///   截图：envfx_&lt;关&gt;_fp（主景第一人称）、envfx_&lt;关&gt;_top（主景俯瞰），另外有的再各拍一张：_flame（最近的火盆 / 灯笼）、_water、_lava；
    ///   1-4 再拍一张泉水抽到一半（_drain，HanbaSpring.SetLevel(0.45)，拍完放回）；
    ///   每张主景第一人称记 150 帧的平均 / 最长帧时间、同屏共享粒子数（FxBudget.Live）和场景里全部粒子系统的存活粒子数。
    /// 最后在 2-1、3-1 的主景机位按高 / 低两档各测 240 帧帧时间（性能对比用）。站位和机位只由场景几何决定，改前 / 改后同一个位置。
    /// 首领关的 BossEncounter 拍摄期间关掉（不触发登场），玩家无敌。
    /// </summary>
    public sealed class EnvFxSuite : PlaytestSuite
    {
        public override string Id => "env-fx";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        const float LoadTimeout = 90f;

        /// <summary>火盆 / 香炉 / 火坛 / 灯笼（ArtAssetInfo.assetId）</summary>
        static readonly string[] FlameProps =
        {
            "SM_Tripo_DesertBrazier", "SM_Prop_DesertIncenseBurner", "SM_Tripo_FrostIceLantern", "SM_Tripo_FrostSeaBoneLantern", "SM_Tripo_InfernoFireAltar",
        };

        struct View
        {
            public string kind;
            public Vector3 target;
            public float dist;
        }

        readonly Dictionary<string, (Vector3 stand, Vector3 look)> mainViews = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(2f);
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("没有 SceneFlow / 玩家（场景不是关卡？）");
                yield break;
            }
            // 拍「改前」对照：Library/SpiritfireBridge/envfx_baseline 存在时不挂环境特效（着色器要另外换回旧版）
            bool baseline = System.IO.File.Exists(System.IO.Path.Combine(Application.dataPath, "..", "Library", "SpiritfireBridge", "envfx_baseline"));
            if (baseline)
            {
                EnvFxHost.Enabled = false;
                EnvFxHost.Strip(flow.CurrentScene);
                Line("（改前对照模式：不挂环境特效）");
            }
            var start = flow.Current;
            var list = start == null || start.code == "1-1" ? RunPlan.Stages.Where(SceneFlow.CanLoad).ToList() : new List<StageSpec> { start };
            var q0 = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            Line($"环境特效巡检：{string.Join("、", list.Select(s => s.code))}（画质 高，原 {ArtQuality.Label(q0)}）");

            foreach (var stage in list)
            {
                yield return Enter(stage);
                if (SceneFlow.Instance?.Current != stage) continue;
                yield return Capture(stage);
            }

            // 固定机位帧时间：2-1、3-1，高 / 低两档
            foreach (var code in new[] { "2-1", "3-1" })
            {
                var stage = list.FirstOrDefault(s => s.code == code);
                if (stage == null || !mainViews.TryGetValue(code, out var v)) continue;
                yield return Enter(stage);
                if (SceneFlow.Instance?.Current != stage) continue;
                var rig = SceneFlow.Instance.Player;
                Prepare(rig);
                foreach (var q in new[] { ArtQualityLevel.High, ArtQualityLevel.Low })
                {
                    ArtQuality.Set(q, false);
                    Place(rig, v.stand, v.look);
                    // 等上一档发出的长寿命粒子（雪 6–8 s）落完
                    yield return new WaitForSecondsRealtime(8f);
                    yield return Measure(240, $"帧时间 {code}（画质 {ArtQuality.Label(q)}，固定机位）");
                }
                ArtQuality.Set(ArtQualityLevel.High, false);
            }
            ArtQuality.Set(q0, false);
        }

        // ───────────── 换关 ─────────────

        IEnumerator Enter(StageSpec stage)
        {
            var flow = SceneFlow.Instance;
            if (flow.Current == stage && flow.Player != null) yield break;
            int transitions = flow.Transitions;
            if (!flow.GoTo(stage))
            {
                Fail($"{stage.Label}：GoTo 失败（场景加载不了？）");
                yield break;
            }
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Transitions > transitions && f.Player != null && f.Player.root) break;
                yield return null;
            }
            flow = SceneFlow.Instance;
            if (!flow || flow.Busy || flow.Current != stage)
            {
                Fail($"{stage.Label}：{LoadTimeout:F0} s 内没换好关");
                yield break;
            }
            Line($"── {stage.Label}：{Time.realtimeSinceStartup - t0:F1} s 进关");
            yield return new WaitForSecondsRealtime(2.5f);
        }

        void Prepare(PlayerRig rig)
        {
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            if (rig.vitals) rig.vitals.invulnerableUntil = Time.time + 99999;
            foreach (var enc in FindObjectsByType<BossEncounter>())
                if (enc.State == BossEncounter.Phase.Waiting)
                    enc.enabled = false;
        }

        // ───────────── 拍摄 ─────────────

        IEnumerator Capture(StageSpec stage)
        {
            var rig = SceneFlow.Instance.Player;
            Prepare(rig);
            var spawn = rig.motor.transform.position;
            var views = FindViews(spawn);
            var main = views.Count > 0 ? views[0] : DefaultView(spawn);
            Line($"{stage.code} 主景：{main.kind}（{main.target.x:F0}, {main.target.y:F1}, {main.target.z:F0}）；另有 {string.Join("、", views.Skip(1).Select(v => v.kind))}");

            if (!StandOff(main.target, main.dist, spawn, out var stand))
            {
                Line($"  {main.kind}：找不到能看见它的站位，退回出生点");
                stand = spawn;
            }
            mainViews[stage.code] = (stand, main.target);
            Place(rig, stand, main.target);
            yield return new WaitForSecondsRealtime(1.6f);
            yield return EyeShot(rig, $"envfx_{stage.code}_fp");
            yield return Measure(150, $"  主景第一人称（{stand.x:F0}, {stand.y:F1}, {stand.z:F0}）");
            yield return TopShot(main.target, stand, main.dist, $"envfx_{stage.code}_top");

            // 环境特效挂了什么（改前跑时这些都是空的）
            var icefall = FindAnyObjectByType<EnvIcefall>();
            Line($"  环境特效：{EnvFxHost.LastScan}；氛围 {(EnvAmbience.Current ? EnvAmbience.Current.theme.ToString() : "无")}，动态火 {EnvFlame.Live.Count}（点光 {EnvFlame.LitCount}）" +
                 (icefall ? $"，冰瀑融水 {icefall.Streams} 条" : ""));

            // 水面扰动：主景是水就在水面中心扰动一下（鲲破水那一档），0.7 s 后拍涟漪
            if (main.kind == "water")
            {
                Place(rig, stand, main.target);
                Fx.WaterDisturb(main.target, 4f, 1.6f);
                yield return new WaitForSecondsRealtime(0.7f);
                yield return EyeShot(rig, $"envfx_{stage.code}_ripple");
                Line($"  水面扰动：涟漪 {EnvWater.RingCount} 道（累计 {EnvWater.RingsSpawned}）");
            }
            // 第一章：刮一阵沙帘
            if (EnvAmbience.Current && EnvAmbience.Current.theme == EnvTheme.Desert)
            {
                Place(rig, stand, main.target);
                EnvAmbience.Current.ForceGust();
                yield return new WaitForSecondsRealtime(1.3f);
                yield return EyeShot(rig, $"envfx_{stage.code}_gust");
                Line($"  沙帘：{(EnvAmbience.Current.Gusting ? "正在刮" : "没刮起来")}（累计 {EnvAmbience.Current.Gusts} 阵）");
            }

            foreach (var v in views.Skip(1))
            {
                if (!StandOff(v.target, v.dist, spawn, out var s2)) continue;
                Place(rig, s2, v.target);
                yield return new WaitForSecondsRealtime(1.3f);
                yield return EyeShot(rig, $"envfx_{stage.code}_{v.kind}");
            }

            // 1-4：泉水抽到一半
            if (stage.code == "1-4")
            {
                var arena = FindAnyObjectByType<BossArena>();
                var spring = arena ? HanbaSpring.Find(arena) : null;
                if (spring)
                {
                    float lv = spring.Level;
                    spring.SetLevel(0.45f);
                    Place(rig, stand, main.target);
                    yield return new WaitForSecondsRealtime(1.3f);
                    yield return EyeShot(rig, "envfx_1-4_drain");
                    spring.SetLevel(lv);
                    yield return null;
                }
                else Line("  1-4：没找到 HanbaSpring，跳过抽水截图");
            }
        }

        IEnumerator TopShot(Vector3 target, Vector3 stand, float dist, string name)
        {
            var away = stand - target;
            away.y = 0;
            if (away.sqrMagnitude < 0.01f) away = Vector3.back;
            away.Normalize();
            var rig = SceneFlow.Instance.Player;
            var cam = CloneCamera(rig.cam, "EnvFx Top Camera");
            cam.fieldOfView = 60;
            cam.transform.position = target + away * (dist * 0.7f + 4f) + Vector3.up * (dist * 0.9f + 12f);
            cam.transform.LookAt(target);
            yield return null;
            Shot(cam, name);
            Destroy(cam.gameObject);
        }

        /// <summary>
        /// 第一人称截图：在玩家相机的位置 / 朝向放一台同参数的临时相机（带后处理，不带 HUD、横幅和手上的枪）——只比较环境本身，
        /// 不被遭遇横幅、准星挡住
        /// </summary>
        IEnumerator EyeShot(PlayerRig rig, string name)
        {
            var cam = CloneCamera(rig.cam, "EnvFx Eye Camera");
            cam.transform.SetPositionAndRotation(rig.cam.transform.position, rig.cam.transform.rotation);
            yield return null;
            Shot(cam, name);
            Destroy(cam.gameObject);
        }

        static Camera CloneCamera(Camera src, string name)
        {
            var go = new GameObject(name);
            var cam = go.AddComponent<Camera>();
            cam.CopyFrom(src);
            cam.targetTexture = null;
            cam.cullingMask &= ~(1 << Layers.FirstPerson);
            var a = src.GetUniversalAdditionalCameraData();
            var b = cam.GetUniversalAdditionalCameraData();
            b.renderType = CameraRenderType.Base;
            b.renderPostProcessing = true;
            b.antialiasing = a.antialiasing;
            b.antialiasingQuality = a.antialiasingQuality;
            b.volumeLayerMask = a.volumeLayerMask;
            b.renderShadows = a.renderShadows;
            b.requiresDepthOption = a.requiresDepthOption;
            b.requiresColorOption = a.requiresColorOption;
            b.dithering = a.dithering;
            cam.enabled = false;
            return cam;
        }

        IEnumerator Measure(int frames, string label)
        {
            float sum = 0, max = 0;
            int live = 0, all = 0;
            for (int i = 0; i < frames; i++)
            {
                yield return null;
                float dt = Time.unscaledDeltaTime;
                sum += dt;
                max = Mathf.Max(max, dt);
                live = Mathf.Max(live, FxBudget.Live);
            }
            foreach (var ps in FindObjectsByType<ParticleSystem>())
                all += ps.particleCount;
            Line($"{label}：平均 {sum / frames * 1000:F2} ms、最长 {max * 1000:F1} ms；共享发射器粒子 {live}，场景粒子合计 {all}，点光 {CountLights()}");
        }

        static int CountLights()
        {
            int n = 0;
            foreach (var l in FindObjectsByType<Light>())
                if (l.isActiveAndEnabled && l.type != LightType.Directional && l.intensity > 0.01f)
                    n++;
            return n;
        }

        void Place(PlayerRig rig, Vector3 stand, Vector3 look)
        {
            Teleport(rig.motor, stand);
            Aim(rig.motor, rig.eye ? rig.eye : rig.cam.transform, look);
        }

        // ───────────── 找景 ─────────────

        List<View> FindViews(Vector3 spawn)
        {
            var list = new List<View>();
            // 瀑布
            foreach (var n in new[] { "Lava Fall", "冰瀑" })
            {
                var go = GameObject.Find(n);
                if (!go) continue;
                var b = Bounds(go);
                list.Add(new View { kind = "fall", target = new Vector3(b.center.x, b.min.y + b.size.y * 0.3f, b.center.z), dist = Mathf.Clamp(b.size.y * 0.6f, 14f, 30f) });
            }
            // 熔岩：最大的一片
            LavaVolume lava = null;
            float best = 0;
            foreach (var l in LavaVolume.Live)
            {
                if (!l || !l.surface) continue;
                float area = l.shape == LavaShape.Disc ? l.size.x * l.size.x * 3.14f : l.size.x * l.size.y;
                if (area > best)
                {
                    best = area;
                    lava = l;
                }
            }
            if (lava)
            {
                float ext = lava.shape == LavaShape.Disc ? lava.size.x : Mathf.Max(lava.size.x, lava.size.y) * 0.5f;
                list.Add(new View { kind = "lava", target = new Vector3(lava.transform.position.x, lava.Level, lava.transform.position.z), dist = Mathf.Clamp(ext * 0.5f + 6f, 8f, 20f) });
            }
            // 水面：Spiritfire/Water 的渲染器（不含流沙的旋涡模式），取最大的一片；目标点取离它包围盒中心最近的网格顶点（月牙泉是弯的，中心不在水上）
            Renderer water = null;
            best = 0;
            foreach (var r in FindObjectsByType<Renderer>())
            {
                if (!r || !r.enabled || !r.gameObject.activeInHierarchy) continue;
                var m = r.sharedMaterial;
                if (!m || !m.shader || m.shader.name != "Spiritfire/Water") continue;
                if (m.HasProperty("_Swirl") && m.GetFloat("_Swirl") > 0.01f) continue;
                float area = r.bounds.size.x * r.bounds.size.z;
                if (area > best)
                {
                    best = area;
                    water = r;
                }
            }
            if (water)
            {
                var b = water.bounds;
                var c = b.center;
                var mf = water.GetComponent<MeshFilter>();
                // 方块 / 方片（顶点只有角点）直接用包围盒中心；月牙泉这种弯的网格取离中心最近的顶面顶点
                if (mf && mf.sharedMesh && mf.sharedMesh.isReadable && mf.sharedMesh.vertexCount > 64)
                {
                    float bd = float.MaxValue;
                    foreach (var vtx in mf.sharedMesh.vertices)
                    {
                        var wv = water.transform.TransformPoint(vtx);
                        if (wv.y < b.max.y - 0.3f) continue;
                        float d = new Vector2(wv.x - b.center.x, wv.z - b.center.z).sqrMagnitude;
                        if (d < bd)
                        {
                            bd = d;
                            c = wv;
                        }
                    }
                }
                float ext = Mathf.Max(b.extents.x, b.extents.z);
                list.Add(new View { kind = "water", target = new Vector3(c.x, b.max.y, c.z), dist = Mathf.Clamp(ext * 0.35f + 4f, 6f, 16f) });
            }
            // 流沙
            // 关卡摆的流沙坑（「Quicksand (x, z)」）里最大的一个；运行时沙魇钻出来的小坑不算
            var sand = FindObjectsByType<Quicksand>().Where(q => q.name.StartsWith("Quicksand (")).OrderByDescending(q => q.radius).FirstOrDefault();
            if (sand) list.Add(new View { kind = "sand", target = sand.transform.position, dist = 9f });
            // 火盆 / 灯笼：离出生点最近的
            // 火盆 / 火坛 / 灯笼优先于香炉（FlameProps 的顺序），同一种取离出生点最近的
            ArtAssetInfo prop = null;
            best = float.MaxValue;
            int rank = int.MaxValue;
            foreach (var a in FindObjectsByType<ArtAssetInfo>())
            {
                int k = a ? System.Array.IndexOf(FlameProps, a.assetId) : -1;
                if (k < 0) continue;
                k = k == 1 ? 9 : k;
                float d = (a.transform.position - spawn).sqrMagnitude;
                if (k < rank || k == rank && d < best)
                {
                    rank = k;
                    best = d;
                    prop = a;
                }
            }
            if (prop)
            {
                float h = prop.designBounds.size.y * prop.transform.lossyScale.y;
                list.Add(new View { kind = "flame", target = prop.transform.position + Vector3.up * Mathf.Max(0.8f, h * 0.8f), dist = 5.5f });
            }
            return list;
        }

        View DefaultView(Vector3 spawn)
        {
            var meta = LevelMeta.Current;
            var sites = meta ? meta.pois.Where(p => p.kind == MapPoiKind.Site).ToList() : new List<LevelPoi>();
            var at = sites.Count > 0 ? sites[0].position : spawn + Vector3.forward * 30f;
            var dir = at - spawn;
            dir.y = 0;
            if (dir.sqrMagnitude < 1) dir = Vector3.forward;
            return new View { kind = "spawn", target = spawn + dir.normalized * 25f + Vector3.up * 1.5f, dist = 25f };
        }

        static Bounds Bounds(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return new Bounds(go.transform.position, Vector3.zero);
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b;
        }

        /// <summary>g 的正上方有水面（Spiritfire/Water 渲染器的包围盒罩着它、顶面比它高）</summary>
        static bool UnderWater(Vector3 g)
        {
            foreach (var r in FindObjectsByType<Renderer>())
            {
                if (!r || !r.enabled) continue;
                var m = r.sharedMaterial;
                if (!m || !m.shader || m.shader.name != "Spiritfire/Water") continue;
                var b = r.bounds;
                if (g.x >= b.min.x && g.x <= b.max.x && g.z >= b.min.z && g.z <= b.max.z && b.max.y > g.y) return true;
            }
            return false;
        }

        /// <summary>离 target dist 米、地面不是熔岩 / 水、眼高能直接看见 target 的站位（先试朝 prefer 的方向）</summary>
        static bool StandOff(Vector3 target, float dist, Vector3 prefer, out Vector3 stand)
        {
            var toward = prefer - target;
            toward.y = 0;
            float a0 = toward.sqrMagnitude > 0.01f ? Mathf.Atan2(toward.z, toward.x) : 0;
            foreach (float k in new[] { 1f, 0.7f, 1.4f, 2f })
            {
                for (int i = 0; i < 24; i++)
                {
                    float a = a0 + (i % 2 == 0 ? 1 : -1) * ((i + 1) / 2) * (Mathf.PI / 12f);
                    var p = target + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * dist * k;
                    if (!Physics.Raycast(new Vector3(p.x, target.y + 40f, p.z), Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    var g = hit.point;
                    if (hit.normal.y < 0.6f || Mathf.Abs(g.y - target.y) > 14f) continue;
                    if (LavaField.IsLavaAt(g) || WaterVolume.InWater(g + Vector3.up * 0.05f)) continue;
                    // 不站到水下（2-4 北冥海的水体底下还有地面）、不站在液面以下的坑里
                    if (g.y < target.y - 0.4f && UnderWater(g)) continue;
                    var eye = g + Vector3.up * 1.62f;
                    if (Physics.Linecast(eye, target, out var block, Layers.WorldMask, QueryTriggerInteraction.Ignore) && (block.point - target).magnitude > 3f) continue;
                    stand = g;
                    return true;
                }
            }
            stand = default;
            return false;
        }
    }
}
