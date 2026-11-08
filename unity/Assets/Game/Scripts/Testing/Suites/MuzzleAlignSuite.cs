using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 原作武器的枪口特效要贴着枪管口、顺着枪管方向，开火动画后坐时跟着枪走：
    /// 每把枪烘焙枪身网格找枪管口（相机空间最靠前的一圈顶点的中心），开一枪逐帧比对特效挂点与枪管口的距离 / 朝向，
    /// 记录屏幕坐标、截图（开火后第 2 帧，火光可见）。
    /// </summary>
    public class MuzzleAlignSuite : PlaytestSuite
    {
        public override string Id => "muzzlealign";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        // 网格前端主轴估的枪管方向会被准星 / 护木带偏（电磁炮估成竖直），射向夹角只记不判；挂点用原作 Att（枪骨骼上的枪口点）
        // 2026-11-08：原 muzzle 节点（不动）后坐时相对枪管口漂 7.9 cm；改挂 Att 后 ≤ 1.6 cm（剩下是网格前端估算的抖动）
        // 喷出的火星 / 刺（相机空间）平均速度要朝开火时的射向；跟枪的火光里光晕在枪口前、光环沿枪管往后滑，所以只要求最靠前的子系统在枪口前方。
        // 2026-11-08 特效没转正时：喷出物与射向夹 60°–113°、光晕只在前 0.5 cm（整团朝枪管侧面炸开）；转正后 11°–25°、光晕在前 7.6 cm
        const float MaxRestOffset = 0.05f, MaxFollow = 0.025f, MaxSpread = 50f, MinFlashAhead = 0.03f;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var systems = SystemsBootstrap.Find();
            if (!arena || !systems)
            {
                Fail("缺少 TestArena 刷怪台或 Game Systems");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            var baked = FindAnyObjectByType<PlayerVitals>();
            if (baked)
            {
                baked.gameObject.SetActive(false);
                Destroy(baked.gameObject);
            }
            yield return null;
            var pos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            var rot = arena.playerSpawn ? arena.playerSpawn.rotation : Quaternion.identity;
            var rig = PlayerFactory.Create(HeroLibrary.Get(HeroLibrary.DefaultHero), pos, rot);
            PlayerFactory.Bind(systems, rig);
            SystemsBootstrap.Setup();
            yield return null;
            rig.vitals.invulnerableUntil = Time.time + 9999;
            foreach (var weaponId in new[] { "smg", "revolver", "railgun" })
                yield return WeaponCase(rig, weaponId);
            rig.weapons.testFire = false;
        }

        IEnumerator WeaponCase(PlayerRig rig, string weaponId)
        {
            var wc = rig.weapons;
            var def = WeaponLibrary.Get(weaponId);
            if (def == null)
            {
                Line($"{weaponId}：武器库里没有，跳过");
                yield break;
            }
            var instance = new WeaponInstance(def);
            instance.mag = 999;
            wc.Give(instance);
            yield return new WaitForSeconds(0.8f);
            var view = wc.rigs.FirstOrDefault(r => r.weaponId == weaponId)?.view;
            var gun = WeaponRigParts.GunOf(view ? view.transform : null, def.prefab);
            var original = gun ? gun.GetComponent<GunfireOriginalAnimation>() : null;
            if (!original)
            {
                Line($"{weaponId}：不是原作武器，跳过");
                yield break;
            }
            var meshes = original.GetComponentsInChildren<SkinnedMeshRenderer>()
                .Where(r => r.enabled && r.sharedMesh && !r.name.StartsWith("hero_fpp_", System.StringComparison.Ordinal)).ToArray();
            if (meshes.Length == 0)
            {
                Fail($"{weaponId}：找不到枪身网格");
                yield break;
            }
            var cam = rig.cam.transform;
            var fxAnchor = original.MuzzleAnchor;
            if (!fxAnchor)
            {
                Fail($"{weaponId}：没有枪口特效挂点");
                yield break;
            }
            // 曳光 / 光束的起点（WeaponController.MuzzleSocket）要和枪口特效同一点；枪口灯光也挂在这里、只留一盏
            if (wc.MuzzleSocket != fxAnchor) Fail($"{weaponId}：曳光起点 {(wc.MuzzleSocket ? wc.MuzzleSocket.name + "@" + wc.MuzzleSocket.parent?.name : "无")} 不是枪口特效挂点 {fxAnchor.name}");
            var lights = original.GetComponentsInChildren<Light>(true);
            int anchoredLights = lights.Count(l => l.transform.parent == fxAnchor);
            Line($"{weaponId}：曳光起点 {(wc.MuzzleSocket ? wc.MuzzleSocket.name : "无")}，枪口灯光 {lights.Length} 盏（挂在特效挂点上 {anchoredLights} 盏）");
            if (anchoredLights != 1) Fail($"{weaponId}：枪口灯光应在特效挂点上恰好一盏，实际 {anchoredLights}");
            Line($"{weaponId}：枪口挂点父骨骼 {fxAnchor.parent?.name}，枪管口顶点主要蒙在 {TipBones(meshes, fxAnchor)}");
            var restTip = Tip(meshes, cam, out var restAxis);
            var restAnchor = cam.InverseTransformPoint(fxAnchor.position);
            var oldSocket = WeaponSockets.FindDeep(original.transform, WeaponSockets.Muzzle);
            Line($"{weaponId}：静止 枪管口 {Fmt(restTip)} 枪管方向 {Fmt(restAxis)}｜特效挂点 {fxAnchor.name}@{fxAnchor.parent?.name} {Fmt(restAnchor)} 距枪管口 {(restAnchor - restTip).magnitude * 100:F1} cm，" +
                 $"射向夹角 {Vector3.Angle(cam.InverseTransformDirection(original.MuzzleForward), restAxis):F1}°｜原 muzzle 节点 {(oldSocket ? Fmt(cam.InverseTransformPoint(oldSocket.position)) : "无")}，屏幕 枪管口 {Screen(restTip)} 挂点 {Screen(restAnchor)}");

            int fireBefore = original.fireCount;
            wc.testFire = true;
            float start = Time.time;
            while (original.fireCount == fireBefore && Time.time - start < 3f) yield return null;
            wc.testFire = false;
            float restScale = fxAnchor.lossyScale.y, maxScale = restScale;
            var emitAnchor = cam.InverseTransformPoint(fxAnchor.position);
            var emitForward = cam.InverseTransformDirection(original.MuzzleForward);
            // 枪管口用网格最前端顶点估（会被准星 / 击锤带偏几 cm），所以不要求挂点与它重合，只要求后坐过程中两者相对位置不变（挂点刚性跟着枪走）
            var restRel = restAnchor - restTip;
            float follow = 0, maxAngle = 0, tipTravel = 0, anchorTravel = 0, spread = -1, flashAhead = float.NegativeInfinity;
            for (int frame = 0; frame < 24; frame++)
            {
                yield return new WaitForEndOfFrame();
                var tip = Tip(meshes, cam, out var axis);
                var anchor = cam.InverseTransformPoint(fxAnchor.position);
                var forward = cam.InverseTransformDirection(original.MuzzleForward);
                follow = Mathf.Max(follow, (anchor - tip - restRel).magnitude);
                maxAngle = Mathf.Max(maxAngle, Vector3.Angle(forward, axis));
                tipTravel = Mathf.Max(tipTravel, (tip - restTip).magnitude);
                anchorTravel = Mathf.Max(anchorTravel, (anchor - restAnchor).magnitude);
                if (frame == 1)
                {
                    // 截图那帧很慢（读回整张图），之后游戏时间被拉长、0.1–0.35 s 的火光会播完：粒子分布在截图前量
                    ParticleSpread(original.LastMuzzleFx, cam, anchor, forward, emitAnchor, emitForward, weaponId, out _);
                    Shot(rig.cam, $"align_{weaponId}_shot");
                    Line($"{weaponId}：开火第 2 帧 屏幕 枪管口 {Screen(tip)} 挂点 {Screen(anchor)}");
                }
                maxScale = Mathf.Max(maxScale, fxAnchor.lossyScale.y);
                // 火星 / 刺有的晚一两帧才喷：取开火后第一帧有它们的速度方向
                if (spread < 0 && frame < 10) spread = SparkAngle(original.LastMuzzleFx, cam, emitForward);
                // 跟枪的火光（局部空间）有的晚一两帧出：开火后 10 帧内最靠前的子系统
                if (frame < 10) flashAhead = Mathf.Max(flashAhead, LocalAhead(original.LastMuzzleFx, cam, anchor, forward));
                if (frame < 14 && original.LastMuzzleFx)
                    foreach (var ps in original.LastMuzzleFx.GetComponentsInChildren<ParticleSystem>())
                    {
                        if (ps.particleCount == 0) continue;
                        var b = ps.GetComponent<ParticleSystemRenderer>().bounds;
                        float size = Mathf.Max(b.size.x, b.size.y, b.size.z);
                        string key = ps.name;
                        if (!sizes.TryGetValue(key, out float old) || size > old) sizes[key] = size;
                    }
            }
            float barrel = BarrelDiameter(meshes, cam), runtimeBarrel = original.BarrelDiameter;
            Line($"{weaponId}：枪管口直径 测试量 {barrel * 100:F1} cm / 运行时量 {runtimeBarrel * 100:F1} cm；枪口特效各子系统开火后 14 帧内包围盒最大 " +
                 string.Join("，", sizes.OrderByDescending(kv => kv.Value).Select(kv => $"{kv.Key} {kv.Value * 100:F1} cm（{kv.Value / Mathf.Max(barrel, 1e-4f):F1} 倍）")));
            // 测试这边按相机 z 取最前一圈（会被准星 / 护套带偏），只作对照；尺寸判定按运行时以 Att 为轴量的枪管口
            if (runtimeBarrel <= 0.005f || runtimeBarrel > 0.1f) Fail($"{weaponId}：运行时量的枪管口直径 {runtimeBarrel * 100:F1} cm 不合理");
            barrel = runtimeBarrel;
            Line($"{weaponId}：枪口挂点缩放 静止 {restScale:F3}，开火中最大 {maxScale:F3}（{maxScale / Mathf.Max(restScale, 1e-6f):F2} 倍）；封顶时 {original.FitDebug}；现在 挂点 {fxAnchor.lossyScale} 特效根 {(original.LastMuzzleFx ? original.LastMuzzleFx.transform.lossyScale.ToString() : "无")}");
            if (original.LastMuzzleFx)
                foreach (var ps in original.LastMuzzleFx.GetComponentsInChildren<ParticleSystem>())
                {
                    int cap = System.Array.FindIndex(GunfireOriginalAnimation.SizeCaps, c => c.name == ps.name);
                    if (cap < 0) continue;
                    // 左轮开火动画对枪骨骼做挤压拉伸（沿枪管拉长到 1.25 倍），特效跟着拉伸是原作的冲击感，判定时扣掉
                    var s = fxAnchor.lossyScale;
                    float stretch = Mathf.Max(Mathf.Abs(s.x), Mathf.Abs(s.y), Mathf.Abs(s.z)) / Mathf.Max(restScale, 1e-6f);
                    float limit = GunfireOriginalAnimation.SizeCaps[cap].ratio * runtimeBarrel, size = GunfireOriginalAnimation.MaxVisualSize(ps) / stretch;
                    if (size > limit * 1.02f) Fail($"{weaponId}：{ps.name} 最大 {size * 100:F1} cm，超过枪管口 {GunfireOriginalAnimation.SizeCaps[cap].ratio} 倍（{limit * 100:F1} cm）");
                }
            foreach (var ring in RingSystems)
                if (sizes.TryGetValue(ring, out float s) && s > MaxRingRatio * barrel)
                    Fail($"{weaponId}：枪口光环 {ring} 包围盒最大 {s * 100:F1} cm，是枪管口的 {s / barrel:F1} 倍（> {MaxRingRatio} 倍）");
            sizes.Clear();
            Line($"{weaponId}：开火 24 帧内 枪管口后坐位移 {tipTravel * 100:F1} cm，挂点位移 {anchorTravel * 100:F1} cm，挂点相对枪管口最多漂 {follow * 100:F1} cm，射向与枪管夹角最大 {maxAngle:F1}°");
            if (restRel.magnitude > MaxRestOffset) Fail($"{weaponId}：枪口特效挂点离枪管口 {restRel.magnitude * 100:F1} cm（> {MaxRestOffset * 100:F0} cm）");
            if (follow > MaxFollow) Fail($"{weaponId}：后坐时枪口特效挂点没跟住枪管口（相对漂 {follow * 100:F1} cm > {MaxFollow * 100:F1} cm）");
            if (spread < 0 || spread > MaxSpread) Fail($"{weaponId}：枪口喷出的火星 / 刺 / 烟没有朝枪管前方（重心夹角 {spread:F0}° > {MaxSpread}°）");
            if (flashAhead < MinFlashAhead) Fail($"{weaponId}：跟枪的火光没有在枪口前方（最靠前的子系统只在前 {flashAhead * 100:F1} cm < {MinFlashAhead * 100:F0} cm）");
            yield return new WaitForSeconds(0.6f);

            // 再开一枪，在星芒长到最大的时刻（开火后约 0.08 s）拍一张，看射线 / 光晕的大小（第 2 帧时它们还没长开）
            int peakBefore = original.fireCount;
            wc.testFire = true;
            start = Time.time;
            while (original.fireCount == peakBefore && Time.time - start < 3f) yield return null;
            wc.testFire = false;
            float firedAt = Time.time;
            while (Time.time - firedAt < 0.08f) yield return null;
            Shot(rig.cam, $"align_{weaponId}_peak");
            yield return new WaitForSeconds(0.6f);
        }

        /// <summary>开火第 4 帧所有活粒子相对挂点的分布：返回重心方向与射向的夹角（没有粒子返回 -1），记各子系统的重心 / 速度（相机空间）</summary>
        /// <remarks>局部空间的粒子跟着枪，按当前挂点 / 射向量；相机空间的粒子喷出后留在原处（后坐时与枪拉开），按开火那帧的挂点 / 射向量</remarks>
        float ParticleSpread(GameObject fx, Transform cam, Vector3 anchorNow, Vector3 axisNow, Vector3 anchorEmit, Vector3 axisEmit, string weaponId, out float localAhead)
        {
            localAhead = float.NegativeInfinity;
            if (!fx)
            {
                Line($"{weaponId}：没拿到枪口特效实例");
                return -1;
            }
            Vector3 sumLocal = Vector3.zero, sumDetached = Vector3.zero, sparkVelocity = Vector3.zero;
            int nLocal = 0, nDetached = 0;
            var parts = new List<string>();
            var buffer = new ParticleSystem.Particle[256];
            foreach (var ps in fx.GetComponentsInChildren<ParticleSystem>())
            {
                int n = ps.GetParticles(buffer);
                if (n == 0) continue;
                var main = ps.main;
                var space = main.simulationSpace == ParticleSystemSimulationSpace.World ? null
                    : main.simulationSpace == ParticleSystemSimulationSpace.Custom ? main.customSimulationSpace : ps.transform;
                bool detached = main.simulationSpace != ParticleSystemSimulationSpace.Local;
                var anchor = detached ? anchorEmit : anchorNow;
                var axis = detached ? axisEmit : axisNow;
                var c = Vector3.zero;
                var vFx = Vector3.zero;
                var vCam = Vector3.zero;
                for (int i = 0; i < n; i++)
                {
                    var world = space ? space.TransformPoint(buffer[i].position) : buffer[i].position;
                    c += cam.InverseTransformPoint(world);
                    var v = space ? space.TransformVector(buffer[i].velocity) : buffer[i].velocity;
                    vFx += fx.transform.InverseTransformVector(v).normalized;
                    vCam += cam.InverseTransformVector(v).normalized;
                }
                if (detached && ps.name.IndexOf("smoke", System.StringComparison.OrdinalIgnoreCase) < 0) sparkVelocity += vCam;
                if (detached) { sumDetached += c - anchor * n; nDetached += n; }
                else { sumLocal += c - anchor * n; nLocal += n; }
                c /= n;
                if (!detached) localAhead = Mathf.Max(localAhead, Vector3.Dot(c - anchor, axis));
                string vel = vCam.sqrMagnitude > 1e-6f ? $" 速度(特效系){Fmt(vFx / n)} 与枪管 {Vector3.Angle(vCam, axis):F0}°" : "";
                parts.Add($"{ps.name}×{n}({main.simulationSpace}) 前 {Vector3.Dot(c - anchor, axis) * 100:F1}cm 偏 {Vector3.ProjectOnPlane(c - anchor, axis).magnitude * 100:F1}cm{vel}");
            }
            if (nLocal + nDetached == 0)
            {
                Line($"{weaponId}：第 4 帧没有活粒子");
                return -1;
            }
            float angleLocal = nLocal > 0 ? Vector3.Angle(sumLocal / nLocal, axisNow) : 0;
            float angleDetached = nDetached > 0 ? Vector3.Angle(sumDetached / nDetached, axisEmit) : 0;
            Line($"{weaponId}：跟枪粒子 {nLocal} 个重心与当前射向夹角 {angleLocal:F0}°（前 {(nLocal > 0 ? Vector3.Dot(sumLocal / nLocal, axisNow) * 100 : 0):F1} cm），" +
                 $"相机空间粒子 {nDetached} 个重心与开火时射向夹角 {angleDetached:F0}°（前 {(nDetached > 0 ? Vector3.Dot(sumDetached / nDetached, axisEmit) * 100 : 0):F1} cm），" +
                 $"火星 / 刺平均速度与射向夹角 {(sparkVelocity.sqrMagnitude > 1e-6f ? Vector3.Angle(sparkVelocity, axisEmit) : -1):F0}°｜" + string.Join("；", parts));
            // 喷出方向按火星 / 刺的速度判（烟本来就绕枪口径向散开，按重心判会抖）
            return sparkVelocity.sqrMagnitude > 1e-6f ? Vector3.Angle(sparkVelocity, axisEmit) : -1;
        }

        /// <summary>局部空间（跟枪）子系统里最靠前那个的粒子重心在射向上离挂点多远（m）；没有粒子返回 -∞</summary>
        static float LocalAhead(GameObject fx, Transform cam, Vector3 anchor, Vector3 axis)
        {
            float best = float.NegativeInfinity;
            if (!fx) return best;
            var buffer = new ParticleSystem.Particle[64];
            foreach (var ps in fx.GetComponentsInChildren<ParticleSystem>())
            {
                if (ps.main.simulationSpace != ParticleSystemSimulationSpace.Local) continue;
                int n = ps.GetParticles(buffer);
                if (n == 0) continue;
                var c = Vector3.zero;
                for (int i = 0; i < n; i++) c += cam.InverseTransformPoint(ps.transform.TransformPoint(buffer[i].position));
                best = Mathf.Max(best, Vector3.Dot(c / n - anchor, axis));
            }
            return best;
        }

        /// <summary>火星 / 刺（相机空间、名字不含 smoke）平均速度方向与开火时射向的夹角；还没有就返回 -1</summary>
        static float SparkAngle(GameObject fx, Transform cam, Vector3 axisEmit)
        {
            if (!fx) return -1;
            var sum = Vector3.zero;
            var buffer = new ParticleSystem.Particle[256];
            foreach (var ps in fx.GetComponentsInChildren<ParticleSystem>())
            {
                var main = ps.main;
                if (main.simulationSpace == ParticleSystemSimulationSpace.Local || ps.name.IndexOf("smoke", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                var space = main.simulationSpace == ParticleSystemSimulationSpace.Custom ? main.customSimulationSpace : null;
                int n = ps.GetParticles(buffer);
                for (int i = 0; i < n; i++)
                {
                    var v = space ? space.TransformVector(buffer[i].velocity) : buffer[i].velocity;
                    sum += cam.InverseTransformVector(v).normalized;
                }
            }
            return sum.sqrMagnitude > 1e-6f ? Vector3.Angle(sum, axisEmit) : -1;
        }

        /// <summary>枪管口一圈顶点（离挂点 3 cm 内）的骨骼权重排行</summary>
        static string TipBones(SkinnedMeshRenderer[] meshes, Transform anchor)
        {
            var weight = new Dictionary<string, float>();
            var mesh = new Mesh();
            foreach (var smr in meshes)
            {
                smr.BakeMesh(mesh, true);
                mesh.GetVertices(verts);
                var m = smr.transform.localToWorldMatrix;
                var bw = smr.sharedMesh.boneWeights;
                var bones = smr.bones;
                for (int i = 0; i < verts.Count && i < bw.Length; i++)
                {
                    if ((m.MultiplyPoint3x4(verts[i]) - anchor.position).sqrMagnitude > 0.03f * 0.03f) continue;
                    void Add(int index, float w)
                    {
                        if (w <= 0 || index < 0 || index >= bones.Length || !bones[index]) return;
                        weight.TryGetValue(bones[index].name, out float old);
                        weight[bones[index].name] = old + w;
                    }
                    Add(bw[i].boneIndex0, bw[i].weight0);
                    Add(bw[i].boneIndex1, bw[i].weight1);
                    Add(bw[i].boneIndex2, bw[i].weight2);
                    Add(bw[i].boneIndex3, bw[i].weight3);
                }
            }
            Destroy(mesh);
            return weight.Count == 0 ? "（挂点 3 cm 内没有顶点）" : string.Join("、", weight.OrderByDescending(kv => kv.Value).Take(3).Select(kv => $"{kv.Key} {kv.Value:F0}"));
        }

        readonly Dictionary<string, float> sizes = new();
        // 2026-11-08 封顶前包围盒实测：ring_01 (2) 是枪管口 16–20 倍、ring_01 (1) 8–11 倍、kuosan 13–22 倍
        static readonly string[] RingSystems = { "ring_01 (1)", "ring_01 (2)", "kuosan" };
        // 包围盒偏保守，左轮开火动画还把枪沿枪管拉长 1.25 倍，所以判定线放在 4 倍（封顶后实测 1.6–3.7 倍）
        const float MaxRingRatio = 4f;

        /// <summary>枪管口直径：枪身网格最前 1.5 cm 顶点在相机 xy 平面上离中心的距离（取 80 分位）× 2</summary>
        static float BarrelDiameter(SkinnedMeshRenderer[] meshes, Transform cam)
        {
            var all = new List<Vector3>();
            var mesh = new Mesh();
            foreach (var smr in meshes)
            {
                smr.BakeMesh(mesh, true);
                mesh.GetVertices(verts);
                var m = smr.transform.localToWorldMatrix;
                foreach (var v in verts) all.Add(cam.InverseTransformPoint(m.MultiplyPoint3x4(v)));
            }
            Destroy(mesh);
            float maxZ = all.Max(v => v.z);
            var front = all.Where(v => v.z > maxZ - 0.015f).ToList();
            var c = front.Aggregate(Vector3.zero, (a, v) => a + v) / front.Count;
            var d = front.Select(v => new Vector2(v.x - c.x, v.y - c.y).magnitude).OrderBy(x => x).ToList();
            return d[Mathf.Clamp((int)(d.Count * 0.8f), 0, d.Count - 1)] * 2;
        }

        static readonly List<Vector3> verts = new();

        /// <summary>枪管口（相机空间）：枪身网格在相机前方最远的 2 cm 内顶点的中心；axis = 从枪身中段指向枪管口</summary>
        static Vector3 Tip(SkinnedMeshRenderer[] meshes, Transform cam, out Vector3 axis)
        {
            var all = new List<Vector3>();
            var mesh = new Mesh();
            foreach (var smr in meshes)
            {
                smr.BakeMesh(mesh, true);
                mesh.GetVertices(verts);
                var m = smr.transform.localToWorldMatrix;
                foreach (var v in verts) all.Add(cam.InverseTransformPoint(m.MultiplyPoint3x4(v)));
            }
            Destroy(mesh);
            float maxZ = all.Max(v => v.z);
            var front = all.Where(v => v.z > maxZ - 0.02f).ToList();
            var tip = front.Aggregate(Vector3.zero, (a, v) => a + v) / front.Count;
            // 枪管方向：枪身最前 8 cm 顶点的主轴（协方差最大特征向量，幂迭代），朝前为正
            var nose = all.Where(v => v.z > maxZ - 0.08f).ToList();
            var mean = nose.Aggregate(Vector3.zero, (a, v) => a + v) / nose.Count;
            float xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
            foreach (var p in nose)
            {
                var d = p - mean;
                xx += d.x * d.x; xy += d.x * d.y; xz += d.x * d.z; yy += d.y * d.y; yz += d.y * d.z; zz += d.z * d.z;
            }
            axis = Vector3.forward;
            for (int i = 0; i < 32; i++)
                axis = new Vector3(xx * axis.x + xy * axis.y + xz * axis.z, xy * axis.x + yy * axis.y + yz * axis.z, xz * axis.x + yz * axis.y + zz * axis.z).normalized;
            if (axis.z < 0) axis = -axis;
            return tip;
        }

        static string Fmt(Vector3 v) => $"({v.x:F3}, {v.y:F3}, {v.z:F3})";

        /// <summary>枪模 pass 的屏幕坐标（竖直 FOV 60°，1600×900，左上为原点）</summary>
        static string Screen(Vector3 local)
        {
            float tanV = Mathf.Tan(Fx.ViewmodelFov * 0.5f * Mathf.Deg2Rad), aspect = 16f / 9f;
            float x = 0.5f + local.x / (local.z * tanV * aspect) * 0.5f, y = 0.5f - local.y / (local.z * tanV) * 0.5f;
            return $"[{x * 1600:F0},{y * 900:F0}]";
        }
    }
}
