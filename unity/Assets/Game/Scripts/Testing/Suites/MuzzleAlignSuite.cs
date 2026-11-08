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
        // 喷出物（相机空间的火星 / 刺 / 烟）重心要朝开火时的射向；跟枪的火光里光晕在枪口前、光环沿枪管往后滑，所以只要求最靠前的子系统在枪口前方。
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
            var emitAnchor = cam.InverseTransformPoint(fxAnchor.position);
            var emitForward = cam.InverseTransformDirection(original.MuzzleForward);
            // 枪管口用网格最前端顶点估（会被准星 / 击锤带偏几 cm），所以不要求挂点与它重合，只要求后坐过程中两者相对位置不变（挂点刚性跟着枪走）
            var restRel = restAnchor - restTip;
            float follow = 0, maxAngle = 0, tipTravel = 0, anchorTravel = 0, spread = -1, flashAhead = 0;
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
                    Shot(rig.cam, $"align_{weaponId}_shot");
                    Line($"{weaponId}：开火第 2 帧 屏幕 枪管口 {Screen(tip)} 挂点 {Screen(anchor)}");
                }
                if (frame == 3) spread = ParticleSpread(original.LastMuzzleFx, cam, anchor, forward, emitAnchor, emitForward, weaponId, out flashAhead);
            }
            Line($"{weaponId}：开火 24 帧内 枪管口后坐位移 {tipTravel * 100:F1} cm，挂点位移 {anchorTravel * 100:F1} cm，挂点相对枪管口最多漂 {follow * 100:F1} cm，射向与枪管夹角最大 {maxAngle:F1}°");
            if (restRel.magnitude > MaxRestOffset) Fail($"{weaponId}：枪口特效挂点离枪管口 {restRel.magnitude * 100:F1} cm（> {MaxRestOffset * 100:F0} cm）");
            if (follow > MaxFollow) Fail($"{weaponId}：后坐时枪口特效挂点没跟住枪管口（相对漂 {follow * 100:F1} cm > {MaxFollow * 100:F1} cm）");
            if (spread < 0 || spread > MaxSpread) Fail($"{weaponId}：枪口喷出的火星 / 刺 / 烟没有朝枪管前方（重心夹角 {spread:F0}° > {MaxSpread}°）");
            if (flashAhead < MinFlashAhead) Fail($"{weaponId}：跟枪的火光没有在枪口前方（最靠前的子系统只在前 {flashAhead * 100:F1} cm < {MinFlashAhead * 100:F0} cm）");
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
            Vector3 sumLocal = Vector3.zero, sumDetached = Vector3.zero;
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
                 $"相机空间粒子 {nDetached} 个重心与开火时射向夹角 {angleDetached:F0}°（前 {(nDetached > 0 ? Vector3.Dot(sumDetached / nDetached, axisEmit) * 100 : 0):F1} cm）｜" + string.Join("；", parts));
            return nDetached > 0 ? angleDetached : -1;
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
